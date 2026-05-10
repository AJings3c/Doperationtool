package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// 解析 nuclei 真实输出, 验证 ERR/WRN/INF 都正确分桶 + 路径/cause 抽取
func TestParseValidateOutput_Mixed(t *testing.T) {
	sample := `
                     __     _
   ____  __  _______/ /__  (_)
  / __ \/ / / / ___/ / _ \/ /
 / / / / /_/ / /__/ /  __/ /
/_/ /_/\__,_/\___/_/\___/_/   v3.8.0

[VER] Started metrics server at localhost:9092
[ERR] Error occurred loading template /tmp/test/cve-1.yaml: cause="yaml: control characters are not allowed"
[ERR] Error occurred loading template /tmp/test/file2.yaml: cause="yaml: line 13: did not find expected alphabetic or numeric character"
[WRN] Found duplicate template ID during validation '/tmp/a.yaml' => '/tmp/b.yaml': dup-id-foo
[WRN] The given path (/tmp/test/) is outside the default template directory path (/Users/x/nuclei-templates)!
[FTL] Could not validate templates: errors occurred during template validation
`
	res := &NucleiValidateResult{}
	parseValidateOutput(sample, res)

	if res.OK {
		t.Errorf("OK 应为 false, 因为有 ERR/FTL")
	}
	if len(res.Errors) != 3 { // 2 ERR + 1 FTL
		t.Errorf("Errors 期望 3 个, 实际 %d: %+v", len(res.Errors), res.Errors)
	}
	if len(res.Warnings) != 1 { // 1 真 WRN, 1 个 outside default 被过滤
		t.Errorf("Warnings 期望 1 个 (过滤掉 outside-default-templates), 实际 %d", len(res.Warnings))
	}
	if res.Errors[0].Path != "/tmp/test/cve-1.yaml" {
		t.Errorf("path 没抽出来: %q", res.Errors[0].Path)
	}
	if !strings.Contains(res.Errors[0].Cause, "control characters") {
		t.Errorf("cause 没抽出来: %q", res.Errors[0].Cause)
	}
}

// 嵌套 cause="...cause=\"...\"" 必须完整解析, 不能在第一个 \" 就截断.
// 这是截图上看到的 UI 显示 "cause=\" 的根因.
func TestParseValidateOutput_NestedCause(t *testing.T) {
	// 模拟 nuclei 真实输出: fmt.Errorf + %q 会产生下面这种嵌套 \" 转义
	sample := `[ERR] Error occurred loading template /p/cve/CVE-2021-24997_4.yaml: cause="Could not load template /p/cve/CVE-2021-24997_4.yaml: cause=\"field 'severity' is missing\""
[ERR] Error occurred loading template /p/other/ruijie.yaml: cause="Could not load template /p/other/ruijie.yaml: yaml: unmarshal errors:\n  line 8: field vendor not found in type model.Info"
`
	res := &NucleiValidateResult{}
	parseValidateOutput(sample, res)
	if len(res.Errors) != 2 {
		t.Fatalf("期望 2 个错误, 实际 %d", len(res.Errors))
	}
	// 第 1 条: cause 应含完整的 "field 'severity' is missing", 且 \" 被还原成 "
	c1 := res.Errors[0].Cause
	if !strings.Contains(c1, "field 'severity' is missing") {
		t.Errorf("嵌套 cause 解析失败, 没抓到 'field severity is missing': %q", c1)
	}
	if strings.Contains(c1, `\"`) {
		t.Errorf("cause 里还残留 \\\" 未还原: %q", c1)
	}
	// 第 2 条: 换行应被替换成空格
	c2 := res.Errors[1].Cause
	if !strings.Contains(c2, "field vendor not found in type model.Info") {
		t.Errorf("第 2 条 cause 解析不到 field vendor: %q", c2)
	}
	if strings.Contains(c2, "\n") {
		t.Errorf("cause 里的 \\n 应被替换成空格: %q", c2)
	}
}

// 全部 PASS 的输出
func TestParseValidateOutput_AllPass(t *testing.T) {
	sample := `[VER] starting...
[INF] All templates validated successfully`
	res := &NucleiValidateResult{}
	parseValidateOutput(sample, res)
	if !res.OK {
		t.Errorf("应为 OK")
	}
	if len(res.Errors) != 0 || len(res.Warnings) != 0 {
		t.Errorf("不应有 issue: %+v %+v", res.Errors, res.Warnings)
	}
}

// 模拟 wails GUI 进程的精简 PATH (没有 /opt/homebrew/bin), 验证 findNucleiBinary
// 仍能通过 fallback 找到. 这是 issue#2 的核心回归点.
func TestFindNucleiBinary_FallbackPaths(t *testing.T) {
	// 备份后清理
	oldPath := os.Getenv("PATH")
	oldBin := os.Getenv("NUCLEI_BIN")
	defer func() {
		os.Setenv("PATH", oldPath)
		os.Setenv("NUCLEI_BIN", oldBin)
	}()
	os.Setenv("PATH", "/usr/bin:/bin:/usr/sbin:/sbin") // GUI app 风格的 PATH
	os.Unsetenv("NUCLEI_BIN")
	bin, err := findNucleiBinary()
	if err != nil {
		// 没装 nuclei 跳过, 不算失败
		t.Skipf("本机未装 nuclei, 跳过: %v", err)
	}
	t.Logf("找到 nuclei: %s", bin)
	if bin == "" {
		t.Errorf("PATH 残缺时 fallback 应该找到 nuclei (你机器上 /opt/homebrew/bin 有), 实际为空")
	}
}

// 验证 NUCLEI_BIN env 优先级
func TestFindNucleiBinary_EnvOverride(t *testing.T) {
	oldBin := os.Getenv("NUCLEI_BIN")
	defer os.Setenv("NUCLEI_BIN", oldBin)
	// 用一个一定存在的可执行文件 (任意都行) 验证优先级
	os.Setenv("NUCLEI_BIN", "/bin/ls")
	bin, err := findNucleiBinary()
	if err != nil || bin != "/bin/ls" {
		t.Errorf("NUCLEI_BIN env 没生效: bin=%q err=%v", bin, err)
	}
}

// 验证: 验证全 PASS 时 errors/warnings 序列化必须是 [], 不能是 null.
// nil slice JSON 化是 null, 会让前端 r.errors.length 抛 TypeError. 这里钉死.
func TestValidateResult_JSONShape_NoNullSlices(t *testing.T) {
	a := &App{}
	folder := "/Users/ki10Moc/readteam/AI/Scan/poc/POC/test2"
	r, err := a.ValidateNucleiTemplates(folder)
	if err != nil {
		t.Skipf("环境跳过: %v", err)
	}
	b, _ := json.Marshal(r)
	s := string(b)
	if strings.Contains(s, `"errors":null`) {
		t.Errorf("errors 不能序列化成 null (前端 .length 会炸): %s", s)
	}
	if strings.Contains(s, `"warnings":null`) {
		t.Errorf("warnings 不能序列化成 null: %s", s)
	}
	if !strings.Contains(s, `"errors":[`) || !strings.Contains(s, `"warnings":[`) {
		t.Errorf("errors/warnings 期望是数组 (即使空也得是 []): %s", s)
	}
}

// 实地跑一次 (依赖本机有 nuclei + 之前那批 yaml)
func TestValidateNucleiTemplates_Live(t *testing.T) {
	a := &App{}
	folder := "/Users/ki10Moc/readteam/AI/Scan/poc/POC/test2"
	r, err := a.ValidateNucleiTemplates(folder)
	if err != nil {
		// nuclei 不在 PATH 或目录不存在: 跳过, 不算失败
		t.Skipf("环境跳过: %v", err)
	}
	t.Logf("ok=%v errors=%d warnings=%d elapsed=%s version=%s",
		r.OK, len(r.Errors), len(r.Warnings), r.Elapsed, r.Version)
	if !r.OK {
		t.Errorf("nuclei 报告失败, 前 3 个错误: %+v", first(r.Errors, 3))
	}
}

func first[T any](s []T, n int) []T {
	if len(s) < n {
		return s
	}
	return s[:n]
}
