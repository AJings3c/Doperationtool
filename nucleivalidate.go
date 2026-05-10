package main

// nucleivalidate.go
// 后端封装: 调用本地 `nuclei -validate -t <folder>` 子进程, 把结果解析成结构化报告
// 喂给前端展示. 设计原则:
//   - 不假设 nuclei 在 PATH: 若找不到 binary, 返回明确的可读错误而不是命令错误
//   - 解析容错: nuclei 输出格式可能随版本变, 解析失败也保留 raw 给用户人眼看
//   - 输出限长: 大批量错误时 raw 可能数 MB, 截断到 ~256KB 避免前端卡死

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// NucleiValidateResult 是一次验证的完整报告. 字段名走小写+驼峰是为了 wails 直接 JSON 化给前端.
type NucleiValidateResult struct {
	Folder   string          `json:"folder"`
	OK       bool            `json:"ok"`           // 是否全部 PASS (没有 [ERR]/[FTL])
	Errors   []ValidateIssue `json:"errors"`       // [ERR] / [FTL] 行
	Warnings []ValidateIssue `json:"warnings"`     // [WRN] 行 (排除 "outside default template directory" 这类无意义提示)
	Raw      string          `json:"raw"`          // 原始 stdout+stderr 合并 (限长)
	RawTrunc bool            `json:"rawTruncated"` // raw 被截断
	Elapsed  string          `json:"elapsed"`      // 耗时, e.g. "1.2s"
	Binary   string          `json:"binary"`       // nuclei 可执行文件的绝对路径
	Version  string          `json:"version"`      // 解析到的 nuclei 版本 (尽力而为)
}

// ValidateIssue 是一条具体的报错/警告.
type ValidateIssue struct {
	Path  string `json:"path"`  // 出错文件绝对路径 (能从行里提到则填)
	Cause string `json:"cause"` // 原因 (尽量是 nuclei 给的 cause= 部分, 否则整行)
	Line  string `json:"line"`  // 完整原始行, 备查
}

const (
	// 限制 raw 输出大小, 避免一次几千个错误把前端塞爆
	maxRawBytes = 256 * 1024
	// 给 nuclei 设个超时, 大目录需要长一点
	validateTimeout = 5 * time.Minute
)

var (
	// nuclei 输出格式范例:
	//   [ERR] Error occurred loading template /a/b/c.yaml: cause="..."
	//   [WRN] Found duplicate template ID during validation '/a.yaml' => '/b.yaml': xxx
	//   [INF] All templates validated successfully
	//   [FTL] Could not validate templates: errors occurred during template validation
	//   [VER] Started metrics server at localhost:9092
	//   v3.8.0 (出现在 banner 区)
	reLogLine = regexp.MustCompile(`^\[(ERR|WRN|INF|FTL|VER|DBG)\]\s+(.*)$`)
	// 优先抓 cause="..." 引号内容.
	// nuclei 报嵌套错误时会走 fmt 的 %q, 把内层 " 转义成 \", 整行长这样:
	//   [ERR] ... cause="Could not load template X: cause=\"field 'severity' is missing\""
	// 所以捕获组必须允许 \" 这种转义序列, 否则会在第一个 \" 就停.
	// RE2 模式: ([^"\\]|\\.)*  = 任意非引号非反斜杠字符 | 反斜杠跟任意一个字符.
	reCause = regexp.MustCompile(`cause="((?:[^"\\]|\\.)*)"`)
	// 抓行里第一个看着像绝对/相对 yaml 路径的部分
	rePath = regexp.MustCompile(`(/[^\s'":]+\.ya?ml|[A-Za-z]:\\[^\s'":]+\.ya?ml)`)
	// 版本: nuclei -version 或 banner 里的 vX.Y.Z
	reVersion = regexp.MustCompile(`v(\d+\.\d+\.\d+)`)
)

// ValidateNucleiTemplates 跑 `nuclei -validate -t <folder>` 并解析输出.
// 入参 folder 必须是已存在的目录 (调用方保证, 我们再 check 一次防御).
//
// 进度: nuclei 是子进程, 我们无法精准看到 N/total. 改成"心跳"式: 启 goroutine
// 每 500ms emit 一次 elapsed + indeterminate, 子进程 Wait 返回后 stop ticker.
// 用户能看到秒数滚动 + spinner, 知道还在跑没卡死, 比纯 disabled 强一截.
func (a *App) ValidateNucleiTemplates(folder string) (*NucleiValidateResult, error) {
	if strings.TrimSpace(folder) == "" {
		return nil, fmt.Errorf("目录为空")
	}
	bin, lookErr := findNucleiBinary()
	if bin == "" {
		return nil, fmt.Errorf("找不到 nuclei 可执行文件: %v\n请安装 nuclei (https://github.com/projectdiscovery/nuclei) 后, 或设置环境变量 NUCLEI_BIN=<绝对路径>", lookErr)
	}

	// 进度 + 取消: 用 beginTask 派生的 cancellable ctx 喂 exec.CommandContext, 用户
	// 点取消时 ctx 会被 cancel → exec 把子进程 SIGKILL, cmd.Run 立刻返回.
	// 再叠一层 timeout ctx 防 nuclei 卡死无响应.
	taskCtx, pe, cleanup := a.beginTask("validate:progress", "validating", 0)
	defer cleanup()

	ctx, cancelTimeout := context.WithTimeout(taskCtx, validateTimeout)
	defer cancelTimeout()

	start := time.Now()
	// 心跳 goroutine: 每 500ms 强制 emit 一次, 让前端进度条 elapsed 滚动.
	hbDone := make(chan struct{})
	go func() {
		t := time.NewTicker(500 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-hbDone:
				return
			case <-t.C:
				el := time.Since(start).Truncate(100 * time.Millisecond)
				pe.forceEmit(0, fmt.Sprintf("正在验证 · 已耗时 %s", el))
			}
		}
	}()
	defer func() {
		close(hbDone)
		pe.finish("验证完成")
	}()

	// -nc 关掉颜色码, 输出纯文本好解析; -silent 不一定有, 不强制
	cmd := exec.CommandContext(ctx, bin, "-validate", "-t", folder, "-nc")
	var combined bytes.Buffer
	cmd.Stdout = &combined
	cmd.Stderr = &combined

	runErr := cmd.Run()
	elapsed := time.Since(start)

	out := combined.String()
	res := &NucleiValidateResult{
		Folder:  folder,
		Binary:  bin,
		Elapsed: elapsed.Truncate(10 * time.Millisecond).String(),
		// 显式空 slice. Go 的 nil slice 经 encoding/json 序列化成 `null`,
		// 前端就会 `r.errors.length` 抛 TypeError. 用 []ValidateIssue{} 才会序列化成 `[]`.
		Errors:   []ValidateIssue{},
		Warnings: []ValidateIssue{},
	}

	// 截断 raw
	if len(out) > maxRawBytes {
		res.Raw = out[:maxRawBytes] + "\n... (已截断)"
		res.RawTrunc = true
	} else {
		res.Raw = out
	}

	// 版本号: 从 banner 里抓
	if m := reVersion.FindStringSubmatch(out); m != nil {
		res.Version = "v" + m[1]
	}

	parseValidateOutput(out, res)

	// runErr != nil 不一定代表验证失败 — nuclei 有 [FTL] 时会返回非零退出码,
	// 但我们的解析已经把 [FTL] 抓到 Errors 里了. 这里只把 "压根没跑起来" 的错误抛出去.
	if runErr != nil && len(res.Errors) == 0 && !res.OK && ctx.Err() == nil {
		// 没有解析到任何 ERR/FTL/INF, 说明真的命令本身就失败了 (例如目录不存在被 nuclei 拒绝)
		return res, fmt.Errorf("nuclei 执行失败: %v\n输出: %s", runErr, firstLines(out, 10))
	}
	if ctx.Err() == context.DeadlineExceeded {
		return res, fmt.Errorf("nuclei 超时 (>%s), 已中止", validateTimeout)
	}
	// taskCtx canceled (而非 timeout) = 用户主动点取消. 也走错误返回, 让前端 toast.
	if taskCtx.Err() == context.Canceled {
		return res, fmt.Errorf("已取消")
	}
	return res, nil
}

// parseValidateOutput 把日志行扫一遍, 填到 res.Errors / res.Warnings / res.OK.
// 单独函数方便单测.
func parseValidateOutput(out string, res *NucleiValidateResult) {
	for _, ln := range strings.Split(out, "\n") {
		ln = strings.TrimRight(ln, "\r")
		m := reLogLine.FindStringSubmatch(strings.TrimSpace(ln))
		if m == nil {
			continue
		}
		level, body := m[1], m[2]
		switch level {
		case "INF":
			if strings.Contains(body, "All templates validated successfully") {
				res.OK = true
			}
		case "ERR", "FTL":
			res.Errors = append(res.Errors, parseIssue(body, ln))
		case "WRN":
			// 过滤掉一些不影响验证的提示, 让前端列表更聚焦
			if strings.Contains(body, "outside the default template directory") {
				continue
			}
			res.Warnings = append(res.Warnings, parseIssue(body, ln))
		}
	}
}

// parseIssue 从 nuclei 一行日志里挤出 path / cause.
func parseIssue(body, fullLine string) ValidateIssue {
	iss := ValidateIssue{Line: fullLine}
	if m := rePath.FindString(body); m != "" {
		iss.Path = m
	}
	if m := reCause.FindStringSubmatch(body); m != nil {
		// nuclei 用 %q 把嵌套 cause 转义成 \", 前端显示要还原.
		// 顺序: 先 \\ 再 \", 两顺序在良构 %q 输出下等价, 这里走保守.
		cause := strings.ReplaceAll(m[1], `\\`, `\`)
		cause = strings.ReplaceAll(cause, `\"`, `"`)
		// 有些 cause 里塞了原始换行 (\n), 也顺手换成空格, 避免在一行里显示错乱
		cause = strings.ReplaceAll(cause, "\n", " ")
		iss.Cause = cause
	} else {
		// 兜底: 用整段 body 当 cause, 截到 200 字符内
		iss.Cause = body
	}
	if len(iss.Cause) > 240 {
		iss.Cause = iss.Cause[:240] + "..."
	}
	return iss
}

// findNucleiBinary 兜底寻找 nuclei 可执行文件.
//
// macOS 上 GUI 应用 (Finder/Spotlight 启动) 继承的 PATH 极简, 通常只有
// /usr/bin:/bin:/usr/sbin:/sbin, 不包含 Homebrew/Go 的安装路径. 即使
// 用户终端里 `which nuclei` 能找到, exec.LookPath 在 wails 进程里仍会失败.
//
// 解决: 先 LookPath; 失败则查 NUCLEI_BIN 环境变量; 再失败按常见安装路径
// 逐个 stat. 找不到才放弃, 错误信息里把搜过的路径告诉用户.
func findNucleiBinary() (string, error) {
	// 1) 用户显式指定 (优先级最高)
	if env := strings.TrimSpace(os.Getenv("NUCLEI_BIN")); env != "" {
		return env, nil
	}
	// 2) 常规 PATH 查找
	if p, err := exec.LookPath("nuclei"); err == nil {
		return p, nil
	}
	// 3) 兜底: 扫常见安装路径
	candidates := []string{
		"/opt/homebrew/bin/nuclei", // Apple Silicon Homebrew
		"/usr/local/bin/nuclei",    // Intel Homebrew / 手装
		"/opt/local/bin/nuclei",    // MacPorts
		"/usr/bin/nuclei",
		"/snap/bin/nuclei", // Linux snap
	}
	if home, err := os.UserHomeDir(); err == nil {
		// `go install` 默认装在 $GOBIN 或 $GOPATH/bin, 后者默认 ~/go/bin
		gopath := strings.TrimSpace(os.Getenv("GOPATH"))
		if gopath == "" {
			gopath = filepath.Join(home, "go")
		}
		candidates = append(candidates,
			filepath.Join(gopath, "bin", "nuclei"),
			filepath.Join(home, "go", "bin", "nuclei"),
			filepath.Join(home, ".local", "bin", "nuclei"),
			filepath.Join(home, "bin", "nuclei"),
		)
	}
	for _, p := range candidates {
		if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
			return p, nil
		}
	}
	return "", fmt.Errorf("查过 PATH + NUCLEI_BIN + 常见路径 (%s) 都没找到", strings.Join(candidates, ", "))
}

// firstLines 取前 n 行, 调试错误信息用.
func firstLines(s string, n int) string {
	lines := strings.SplitN(s, "\n", n+1)
	if len(lines) > n {
		lines = lines[:n]
	}
	return strings.Join(lines, "\n")
}
