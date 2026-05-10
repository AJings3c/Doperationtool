package main

// pocconvert.go
// MD → nuclei YAML 转换器.
//
// 输入 MD 文档结构 (来自 wy876/POC 风格的中文漏洞文档):
//   # 标题 (任意 # 级别)
//   描述段落...
//   ## fofa
//   ```
//   fofa 指纹
//   ```
//   ## poc
//   ```
//   HTTP 原始请求
//   ```
//   {可选: 截图, 补充说明}
//
// 输出 nuclei YAML (info + requests + matchers 骨架).
// 所有启发式 (id 推断 / severity / tags / Host 替换) 都集中在这里, 修改逻辑只动一个文件.

import (
	"crypto/md5"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

// ConvertResult 是单次 MD → YAML 转换的结果.
//   - Yaml:     生成的 nuclei yaml 文本 (用户可在 UI 里继续编辑)
//   - Suggested: 建议的输出文件名 (基于 id, 不含后缀, 调用方拼 .yaml)
//   - Title/Severity/Tags/Id: 解析/推断出的元信息, 给 UI 列表展示用
//   - SourcePath: 原 MD 文件路径 (为空表示纯文本输入)
//   - Warnings: 转换中遇到的 "并非致命但建议人工核对" 的问题列表
type ConvertResult struct {
	Yaml       string   `json:"yaml"`
	Suggested  string   `json:"suggested"` // 推荐文件名 (无 .yaml 后缀)
	Id         string   `json:"id"`
	Title      string   `json:"title"`
	Severity   string   `json:"severity"`
	Tags       []string `json:"tags"`
	SourcePath string   `json:"sourcePath"`
	SourceName string   `json:"sourceName"` // 源 md 文件名 (basename)
	Warnings   []string `json:"warnings"`
	// PayloadHash 是 raw HTTP 请求部分的 md5 (parsedMd.poc 原文 normalize 后).
	// 空 poc 块 (没识别到) 会都是同一个哈希, 供 SaveYamlBatch 去重占位模板用.
	// 这个字段是“转换时”算出的快照; 实际去重以实际存盘内容为准 (用户可能在 UI 里改过).
	PayloadHash string `json:"payloadHash"`
}

// ConvertedBatch 是 ConvertMarkdownFolder 的返回, 包含每个文件的结果 + 全局统计.
type ConvertedBatch struct {
	Results []ConvertResult `json:"results"`
	Total   int             `json:"total"`
	Failed  int             `json:"failed"` // 完全失败 (parse 不出来) 的数量
}

// ============ 解析 ============

// parsedMd 是 MD 文档解析后的中间结构, 喂给 emitter 拼 yaml.
type parsedMd struct {
	title       string
	description string
	fofa        string
	poc         string
	references  []string // 文档里出现的 http(s) URL
}

var (
	// 匹配 markdown 标题行: 行首 1~6 个 # + 空格 + 文字
	reHeading = regexp.MustCompile(`^(#{1,6})\s+(.+?)\s*$`)
	// 抓取 http(s) URL (用于 reference 字段). 限制后缀字符避免吃到中文标点
	reURL = regexp.MustCompile(`https?://[^\s'"<>\)\]\}\x{3000}-\x{303F}\x{FF00}-\x{FFEF}]+`)
	// CVE / CNVD / CNNVD 编号
	reCveLike = regexp.MustCompile(`(?i)(CVE-\d{4}-\d{4,7}|CNVD-\d{4}-\d{4,7}|CNNVD-\d{6,12})`)
)

// parseMarkdown 把 MD 拆成 title/description/fofa/poc/references.
// 它是宽松解析: 优先按 ## 分节, 节内的第一个三反引号代码块就是该节内容.
func parseMarkdown(md string) parsedMd {
	out := parsedMd{}
	lines := strings.Split(md, "\n")

	// 第一遍: 找 title (第一个出现的 heading)
	titleIdx := -1
	for i, ln := range lines {
		if m := reHeading.FindStringSubmatch(ln); m != nil {
			out.title = strings.TrimSpace(m[2])
			titleIdx = i
			break
		}
	}

	// 第二遍: 按 heading 分节, 收集每节的纯文本 / 代码块
	type section struct {
		name  string // 标题文本 (lower)
		text  []string
		code  []string // 第一段 ``` 包围的内容
		level int
	}
	var sections []section
	var cur *section
	inCode := false
	codeBuf := []string{}
	startLine := titleIdx + 1
	if startLine < 0 {
		startLine = 0
	}
	for i := startLine; i < len(lines); i++ {
		ln := lines[i]
		// 代码块切换 (兼容 ``` 后跟语言标识)
		trim := strings.TrimSpace(ln)
		if strings.HasPrefix(trim, "```") {
			if inCode {
				// 结束代码块: 写到当前 section.code (只取第一段)
				if cur != nil && len(cur.code) == 0 {
					cur.code = append([]string{}, codeBuf...)
				}
				codeBuf = codeBuf[:0]
				inCode = false
			} else {
				inCode = true
			}
			continue
		}
		if inCode {
			codeBuf = append(codeBuf, ln)
			continue
		}
		// heading 切换
		if m := reHeading.FindStringSubmatch(ln); m != nil {
			lvl := len(m[1])
			name := strings.ToLower(strings.TrimSpace(m[2]))
			s := section{name: name, level: lvl}
			sections = append(sections, s)
			cur = &sections[len(sections)-1]
			continue
		}
		// 普通正文行
		if cur == nil {
			// 还没遇到二级标题, 累积到 description
			if trim != "" {
				out.description += ln + "\n"
			}
		} else {
			cur.text = append(cur.text, ln)
		}
	}

	// 提取 fofa / poc 节
	for _, s := range sections {
		nm := s.name
		if out.fofa == "" && (strings.Contains(nm, "fofa") || strings.Contains(nm, "\u6307\u7eb9") || strings.Contains(nm, "\u6307\u7eb9\u4fe1\u606f")) {
			if len(s.code) > 0 {
				out.fofa = strings.Join(s.code, "\n")
			}
		}
		if out.poc == "" && (strings.Contains(nm, "poc") || strings.Contains(nm, "\u8be6\u60c5") || strings.Contains(nm, "\u8bf7\u6c42") || strings.Contains(nm, "exp")) {
			if len(s.code) > 0 {
				out.poc = strings.Join(s.code, "\n")
			}
		}
	}

	// 提取所有 URL (去重排序)
	urlSet := map[string]struct{}{}
	for _, m := range reURL.FindAllString(md, -1) {
		// 去掉结尾常见标点
		u := strings.TrimRight(m, ".,;)")
		urlSet[u] = struct{}{}
	}
	for u := range urlSet {
		out.references = append(out.references, u)
	}
	sort.Strings(out.references)

	out.description = strings.TrimSpace(out.description)
	out.title = cleanTitle(out.title)
	return out
}

// cleanTitle 去掉 markdown 装饰 (`**`, `__`, 首尾单个 `*`/`_`/“ ` “) 以及控制字符.
// 重要: title 后续会被切成 vendor tag, 如果保留 `**` 会让该 tag
// 未加引号时被 YAML 误读为 alias 引用 (`*xxx`), 触发 nuclei 加载失败.
func cleanTitle(s string) string {
	s = stripControl(s)
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "**", "")
	s = strings.ReplaceAll(s, "__", "")
	s = strings.Trim(s, "*_` \t")
	return strings.TrimSpace(s)
}

// stripControl 去掉 YAML 1.2 不允许出现在 scalar 里的控制字符.
// 参考 YAML 1.2 §5.4 c-printable: 允许的控制字符是 \t(0x09) \n(0x0A) \r(0x0D) 和 NEL(0x85).
// 其它 C0 (0x00-0x1F 除上述) 和 C1 (0x80-0x9F 除 NEL) 以及 DEL(0x7F) 都不允许.
// 实际样本中常见的 "control characters are not allowed" 错误就来自 md 里的
// 二进制垃圾 (碎片 body, 拷贝出错的 \x00\x01..., 或 PUA 区) — 在这里统一过滤.
func stripControl(s string) string {
	var sb strings.Builder
	sb.Grow(len(s))
	for _, r := range s {
		switch r {
		case '\t', '\n', '\r', '\u0085':
			sb.WriteRune(r)
		default:
			if r < 0x20 || r == 0x7F || (r >= 0x80 && r <= 0x9F) {
				continue
			}
			sb.WriteRune(r)
		}
	}
	return sb.String()
}

// ============ 启发推断 ============

// 关键词 → severity 映射. 按优先级从高到低 (越靠前越严重).
var severityRules = []struct {
	keywords []string
	severity string
	tags     []string
}{
	{[]string{"\u8fdc\u7a0b\u547d\u4ee4\u6267\u884c", "\u547d\u4ee4\u6267\u884c", "\u8fdc\u7a0b\u4ee3\u7801\u6267\u884c", "RCE", "rce", "\u53cd\u5e8f\u5217\u5316"}, "critical", []string{"rce"}},
	{[]string{"sql\u6ce8\u5165", "SQL\u6ce8\u5165", "sqli", "SQLI", "SQL Injection"}, "high", []string{"sqli"}},
	{[]string{"\u4efb\u610f\u6587\u4ef6\u4e0a\u4f20", "\u6587\u4ef6\u4e0a\u4f20", "fileupload", "Upload"}, "high", []string{"fileupload"}},
	{[]string{"\u4efb\u610f\u6587\u4ef6\u8bfb\u53d6", "\u6587\u4ef6\u8bfb\u53d6", "\u76ee\u5f55\u904d\u5386", "LFI", "lfi", "\u8def\u5f84\u7a7f\u8d8a"}, "medium", []string{"lfi"}},
	{[]string{"\u4efb\u610f\u6587\u4ef6\u5199\u5165", "\u6587\u4ef6\u5199\u5165"}, "high", []string{"file-write"}},
	{[]string{"\u672a\u6388\u6743\u8bbf\u95ee", "\u672a\u6388\u6743", "\u6743\u9650\u7ed5\u8fc7", "\u8eab\u4efd\u9a8c\u8bc1\u7ed5\u8fc7", "auth bypass"}, "high", []string{"unauth"}},
	{[]string{"\u4fe1\u606f\u6cc4\u9732", "\u6570\u636e\u6cc4\u9732", "Sensitive Data", "info disclosure"}, "medium", []string{"disclosure"}},
	{[]string{"SSRF", "ssrf"}, "medium", []string{"ssrf"}},
	{[]string{"XSS", "xss", "\u8de8\u7ad9\u811a\u672c"}, "medium", []string{"xss"}},
	{[]string{"XXE", "xxe"}, "high", []string{"xxe"}},
	{[]string{"CSRF", "csrf"}, "low", []string{"csrf"}},
	{[]string{"\u62d2\u7edd\u670d\u52a1", "DOS", "dos"}, "medium", []string{"dos"}},
}

// inferSeverityAndTags 看标题命中的第一条规则.
// 返回 severity, baseTags(漏洞类型), 例如 ("critical", ["rce"]).
func inferSeverityAndTags(title string) (string, []string) {
	for _, r := range severityRules {
		for _, kw := range r.keywords {
			if strings.Contains(title, kw) {
				return r.severity, append([]string(nil), r.tags...)
			}
		}
	}
	return "medium", []string{"vuln"}
}

// 厂商/产品提取: 启发式截取标题前缀作为 vendor tag.
// 大多数中文 POC 标题都以 "<产品名> <漏洞描述>" 开头, 取前 N 字 (限 8 字内) + 简单清洗.
// 标题后缀裁剪: 检到这些词就把它们及后面的内容丢掉, 只留前缀作为 vendor 标签.
var reTrimSuffix = regexp.MustCompile(`(存在|漏洞|未授权|任意|接口|参数|系统|平台|管理系统|接口存在|\.action|\.do|\.aspx|\.php|\.jsp|\.html).*$`)

func extractVendorTag(title string) string {
	t := strings.TrimSpace(title)
	if t == "" {
		return ""
	}
	// 去掉 ()、[] 内的 CVE/CNVD 等附注
	t = regexp.MustCompile(`[\(（\[].*?[\)）\]]`).ReplaceAllString(t, "")
	t = strings.TrimSpace(t)
	// 砍掉 "存在 / 漏洞 / 接口 / 系统" 等通用后缀
	t = reTrimSuffix.ReplaceAllString(t, "")
	t = strings.TrimSpace(t)
	// 限长. 中文每字 3 字节, 用 rune 计数
	rs := []rune(t)
	if len(rs) > 12 {
		rs = rs[:12]
	}
	return string(rs)
}

// ============ id 生成 ============

// 把任意标题转成 nuclei id 风格: 小写 ASCII + 中划线.
// 中文优先用 CVE/CNVD 编号; 没有就用文件名 (basename) 转 ascii; 实在没有就 sha1 前 8 位.
func makeId(title, sourceName string) string {
	// 1) CVE / CNVD 编号优先
	if m := reCveLike.FindString(title); m != "" {
		return strings.ToLower(m)
	}
	// 2) 用文件名 (去后缀) 当 id 基础
	base := strings.TrimSuffix(sourceName, filepath.Ext(sourceName))
	if id := slugifyAscii(base); id != "" {
		return id
	}
	// 3) 用标题里能抠出的 ASCII 段
	if id := slugifyAscii(title); id != "" {
		return id
	}
	// 4) 兜底: poc-<hash>
	h := sha1.Sum([]byte(title + "|" + sourceName))
	return fmt.Sprintf("poc-%x", h[:4])
}

// slugifyAscii 抽出字符串里的 ASCII 字母数字片段, 拼成 nuclei 风格 id.
// "科荣AIO endTime SQL注入" → "endtime-sql"; "Apache Solr-9.0.0-RCE" → "apache-solr-9-0-0-rce".
func slugifyAscii(s string) string {
	var sb strings.Builder
	prevDash := true
	for _, r := range s {
		switch {
		case r >= 'A' && r <= 'Z':
			sb.WriteRune(r + 32)
			prevDash = false
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			sb.WriteRune(r)
			prevDash = false
		default:
			if !prevDash {
				sb.WriteByte('-')
				prevDash = true
			}
		}
	}
	out := strings.Trim(sb.String(), "-")
	// 限长避免太长
	if len(out) > 60 {
		out = out[:60]
		out = strings.TrimRight(out, "-")
	}
	return out
}

// ============ raw 请求处理 ============

var (
	// 匹配 Host: 行 (大小写不敏感).
	// 注意: 这里**故意**用 [ \t] 而不是 \s, 因为 RE2 的 \s 包含 \n —— 用 \s* 会让正则
	// 跨过 "Host:" 后面的换行符, 把下一行 (常常是 User-Agent) 一并吃掉. 见单测
	// TestNormalizeRawEmptyHost 的回归用例.
	reHostLine = regexp.MustCompile(`(?im)^[ \t]*Host[ \t]*:[ \t]*[^\r\n]*`)
)

// normalizeRaw 把原始 HTTP 请求规整为 nuclei raw 块的内容:
//   - Host: 行替换为 Host: {{Hostname}}
//   - 行尾 \r 去掉 (yaml 多行块用 \n 即可)
//   - 丢掉 ASCII 控制字符 (除 \t \n), 避免 YAML 1.2 "control characters are not allowed" 报错
//   - 修剪首尾空行
func normalizeRaw(raw string) string {
	// 去 \r
	raw = strings.ReplaceAll(raw, "\r", "")
	// 去控制字符 (二进制垃圾会让 yaml.v3 报错, nuclei 也用 yaml.v3 加载模板)
	raw = stripControl(raw)
	// Host 替换
	raw = reHostLine.ReplaceAllString(raw, "Host: {{Hostname}}")
	// 修首尾空行
	raw = strings.TrimSpace(raw)
	return raw
}

// ============ YAML 拼装 ============

// emitYaml 拼最终的 nuclei YAML 文本. 故意手写而非用 yaml 库, 因为:
//  1. nuclei 模板有约定的字段顺序 (id, info, requests), 库会按字母排
//  2. raw 块需要保持 |- 多行字面量风格, 库的输出可能用单行 + 转义, 不方便人读
//  3. 注释支持: 在生成的骨架里塞 # TODO 提示
func emitYaml(p parsedMd, sourceName string) ConvertResult {
	res := ConvertResult{
		SourceName: sourceName,
		Title:      p.title,
	}

	// id / severity / tags
	res.Id = makeId(p.title, sourceName)
	sev, baseTags := inferSeverityAndTags(p.title)
	res.Severity = sev
	tagSet := map[string]struct{}{}
	for _, t := range baseTags {
		tagSet[t] = struct{}{}
	}
	if v := extractVendorTag(p.title); v != "" {
		// vendor 标签里如果是中文也保留, nuclei 支持中文 tag
		tagSet[v] = struct{}{}
	}
	for t := range tagSet {
		res.Tags = append(res.Tags, t)
	}
	sort.Strings(res.Tags)

	// suggested 文件名: 用 id 即可, 调用方加 .yaml
	res.Suggested = res.Id

	// 转换时快照 hash: 只看原始 poc 文本 (normalize 后). 同样占位 (p.poc=="")
	// 的所有结果都会拿到同一个哈希, SaveYamlBatch 会只留首个、跳后续.
	res.PayloadHash = md5Hex(normalizeRaw(p.poc))

	// 警告收集
	if p.title == "" {
		res.Warnings = append(res.Warnings, "未识别到标题 (没找到 # 标题行), info.name 留空")
	}
	if p.poc == "" {
		res.Warnings = append(res.Warnings, "未识别到 ## poc 块, requests.raw 仅给出占位")
	}
	if p.fofa == "" {
		res.Warnings = append(res.Warnings, "未识别到 ## fofa 块, info.metadata.fofa-query 已省略")
	}

	// ---- 拼 yaml ----
	var sb strings.Builder
	wf := func(format string, args ...interface{}) { fmt.Fprintf(&sb, format, args...) }

	wf("id: %s\n\n", res.Id)
	sb.WriteString("info:\n")
	wf("  name: %s\n", yamlInline(p.title))
	sb.WriteString("  author: Doperationtool\n")
	wf("  severity: %s\n", res.Severity)
	if desc := stripControl(p.description); desc != "" {
		sb.WriteString("  description: |\n")
		for _, ln := range strings.Split(desc, "\n") {
			wf("    %s\n", ln)
		}
	}
	if len(p.references) > 0 {
		sb.WriteString("  reference:\n")
		for _, u := range p.references {
			// 每条 URL 必须引号: URL 可能含 ':' (如 ...Accept-Encoding:) 会被 YAML
			// 误解为 {key: null} map, 导致 nuclei 读取 reference 列表时 "!!map into string".
			wf("    - %s\n", yamlInline(u))
		}
	}
	if len(res.Tags) > 0 {
		// tags 必须引号: 中文原文可能包含 YAML 特殊字符 (例如 markdown 遗留的 `*`)
		wf("  tags: %s\n", yamlInline(strings.Join(res.Tags, ",")))
	}
	// metadata.fofa-query
	if p.fofa != "" {
		sb.WriteString("  metadata:\n")
		sb.WriteString("    verified: true\n")
		// fofa 单行优先; 多行用块字面量
		fofaTrim := strings.TrimSpace(p.fofa)
		if strings.Contains(fofaTrim, "\n") {
			sb.WriteString("    fofa-query: |\n")
			for _, ln := range strings.Split(fofaTrim, "\n") {
				wf("      %s\n", ln)
			}
		} else {
			wf("    fofa-query: %s\n", yamlInline(fofaTrim))
		}
	}

	// requests
	sb.WriteString("\nhttp:\n")
	sb.WriteString("  - raw:\n")
	if p.poc != "" {
		sb.WriteString("      - |\n")
		raw := normalizeRaw(p.poc)
		for _, ln := range strings.Split(raw, "\n") {
			wf("        %s\n", ln)
		}
	} else {
		// 占位, 让 yaml 仍然合法, 用户后填
		sb.WriteString("      - |\n")
		sb.WriteString("        # TODO: 未在 MD 中识别到 ## poc 代码块, 在此填入 HTTP 请求\n")
		sb.WriteString("        GET / HTTP/1.1\n")
		sb.WriteString("        Host: {{Hostname}}\n")
	}

	sb.WriteString("\n    matchers-condition: and\n")
	sb.WriteString("    matchers:\n")
	sb.WriteString("      - type: status\n")
	sb.WriteString("        status:\n")
	sb.WriteString("          - 200\n")
	sb.WriteString("\n      # TODO: 根据响应特征调整下面的 word matcher (这里只是占位)\n")
	sb.WriteString("      - type: word\n")
	sb.WriteString("        part: body\n")
	sb.WriteString("        words:\n")
	sb.WriteString("          - \"REPLACE_ME\"\n")

	res.Yaml = sb.String()
	return res
}

// yamlInline 输出 YAML 双引号风格的标量, 并转义反斜杠/双引号/控制字符.
// 为什么不试图省引号? 输入是中文漏洞描述原文, 边界条件多 (中文冲号、
// 末尾冲号、嘴边冲、`*` 等被 YAML 看作 flow 的字符), 不如一律加引号、
// 都走同一套转义输出路径, 能避开 "alias 引用" / "隐含类型推断" 两类坍。
func yamlInline(s string) string {
	s = stripControl(s)
	if s == "" {
		return "\"\""
	}
	esc := strings.ReplaceAll(s, "\\", "\\\\")
	esc = strings.ReplaceAll(esc, "\"", "\\\"")
	return "\"" + esc + "\""
}

// ============ App 方法绑定 ============

// ConvertMarkdownText 接受 MD 文本字符串, 返回单条转换结果.
// 给前端 "粘贴 MD 现场转" 用. sourceName 可为空.
func (a *App) ConvertMarkdownText(markdown, sourceName string) (*ConvertResult, error) {
	p := parseMarkdown(markdown)
	r := emitYaml(p, sourceName)
	r.SourcePath = ""
	return &r, nil
}

// ConvertBatchItem 是 ConvertMarkdownBatch 的单条输入. 前端从 mdFiles 里挑出来的项,
// 内容已经在内存里 (LoadMarkdownDirectory 时读好), 直接传过来避免后端再 ReadFile.
//
// SourcePath 透传 (后端不用, 仅作为返回结果里的关联键, 给前端把 result 对回 mdFiles 用).
type ConvertBatchItem struct {
	Name       string `json:"name"`
	Content    string `json:"content"`
	SourcePath string `json:"sourcePath"`
}

// ConvertBatchResult 是批量转换的整包返回.
//   - Results: 与输入顺序严格一致 (用 index 直接对位, 不靠 path/name 模糊匹配)
//   - Failed:  解析过程中 panic / 异常的条目数 (parseMarkdown 不会返回 err, 这里几乎为 0,
//     保留是因为后续若改成"严格 schema 校验"模式可能用上)
//   - Elapsed: 后端总耗时, 前端可显示"转换 1127 个用了 1.2s"
type ConvertBatchResult struct {
	Results []ConvertResult `json:"results"`
	Total   int             `json:"total"`
	Failed  int             `json:"failed"`
	Elapsed string          `json:"elapsed"`
}

// ConvertMarkdownBatch 一次性转换一批 MD 项, 内部用 goroutine pool 并行调 parseMarkdown + emitYaml.
//
// 为什么需要这个方法 (不直接前端 Promise.all 调 N 次 ConvertMarkdownText):
//   - 每次 wails IPC roundtrip 有固定开销 (~ms 量级), 1127 个 MD = 1127 次 roundtrip,
//     仅 IPC 时间就 ~3-5s, 哪怕 parse 本身只用 1ms.
//   - 走单次 IPC + 后端 goroutine pool, 1127 个 MD 在 8 核机上 ~300-500ms 完成.
//
// parseMarkdown 和 emitYaml 都是纯函数 (无共享可变状态, 用的是 package-level 只读编译正则),
// 直接并发安全. 单条转换不会失败 (parse 总会返回某种结果, 至少是占位), 所以这里没设错误聚合.
func (a *App) ConvertMarkdownBatch(items []ConvertBatchItem) (*ConvertBatchResult, error) {
	start := time.Now()
	res := &ConvertBatchResult{
		Total:   len(items),
		Results: make([]ConvertResult, len(items)),
	}
	if len(items) == 0 {
		res.Elapsed = time.Since(start).Truncate(time.Millisecond).String()
		return res, nil
	}

	workers := runtime.GOMAXPROCS(0)
	if workers < 2 {
		workers = 2
	}
	if workers > 16 {
		workers = 16
	}
	if len(items) < workers {
		workers = len(items)
	}

	jobs := make(chan int, workers*2)
	var wg sync.WaitGroup
	// failed 用 atomic 不必要 — 这里只是统计单个 worker 内的 panic recover 计数.
	// 实际并不预期会触发, 用 mu 兜底也没问题, 简单优先.
	var mu sync.Mutex
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				it := items[i]
				// 防御性 recover: 万一某个 MD 的形态把 parseMarkdown 里某个边界条件搞炸了,
				// 不能让一颗坏 MD 整批崩掉. 该项填空 ConvertResult, failed++.
				func() {
					defer func() {
						if rec := recover(); rec != nil {
							mu.Lock()
							res.Failed++
							mu.Unlock()
							res.Results[i] = ConvertResult{
								SourcePath: it.SourcePath,
								SourceName: it.Name,
								Warnings:   []string{fmt.Sprintf("解析异常: %v", rec)},
							}
						}
					}()
					p := parseMarkdown(it.Content)
					r := emitYaml(p, it.Name)
					r.SourcePath = it.SourcePath
					res.Results[i] = r
				}()
			}
		}()
	}
	for i := range items {
		jobs <- i
	}
	close(jobs)
	wg.Wait()

	res.Elapsed = time.Since(start).Truncate(time.Millisecond).String()
	return res, nil
}

// ConvertMarkdownFile 读单个 md 文件 → 转换结果.
func (a *App) ConvertMarkdownFile(path string) (*ConvertResult, error) {
	if path == "" {
		return nil, fmt.Errorf("路径为空")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	p := parseMarkdown(string(data))
	r := emitYaml(p, filepath.Base(path))
	r.SourcePath = path
	return &r, nil
}

// ConvertMarkdownFolder 递归扫描目录下所有 .md 文件, 批量转换.
// 跟 LoadDirectory 共用 skipDirNames + maxLoadFiles 上限, 防误选 home.
func (a *App) ConvertMarkdownFolder(folder string) (*ConvertedBatch, error) {
	if folder == "" {
		return nil, fmt.Errorf("路径为空")
	}
	info, err := os.Stat(folder)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("不是目录: %s", folder)
	}
	out := &ConvertedBatch{}
	err = filepath.WalkDir(folder, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if path == folder {
			return nil
		}
		name := d.Name()
		if strings.HasPrefix(name, ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if _, skip := skipDirNames[name]; skip {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.ToLower(filepath.Ext(name)) != ".md" {
			return nil
		}
		if len(out.Results) >= maxLoadFiles {
			return filepath.SkipAll
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			out.Failed++
			return nil
		}
		p := parseMarkdown(string(data))
		r := emitYaml(p, name)
		r.SourcePath = path
		out.Results = append(out.Results, r)
		return nil
	})
	if err != nil {
		return nil, err
	}
	out.Total = len(out.Results)
	// 按 SourcePath 排序保证稳定显示
	sort.Slice(out.Results, func(i, j int) bool { return out.Results[i].SourcePath < out.Results[j].SourcePath })
	return out, nil
}

// SaveYamlBatch 把一批 (filename, content) 一次性写入指定目录.
// 跟 SendBufferToFolder 思路相同 (但不重用是因为 SendBufferToFolder 接受不同结构),
// 这里直接定义一个轻量 API.
//
// 三层去重 (优先级从高到低, 命中即停):
//  1. **整 yaml 内容相同** → 跳过. 100% 重复的不需要存第二份.
//  2. **requests 块 hash 相同** → 跳过. 通常是占位模板 (没识别到 ## poc),
//     跨多个 MD 都生成完全一致的 raw + matchers, 这种存 1 份就够.
//  3. **文件名冲突** → 加 -2/-3 后缀写入 (内容是真的不一样的, 不能丢弃).
//
// 决策顺序很重要: 先 1) 后 2) 后 3). 如果先按文件名后缀, 会把内容相同的两份都
// 写到磁盘 (foo.yaml + foo-2.yaml), 浪费空间且 nuclei 跑两次同样的检测.
type YamlOutFile struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

// SaveYamlBatchResult 是 SaveYamlBatch 的详细返回. 给前端 toast 显示用.
//   - Written: 实际写盘数
//   - Renamed: 因同名后缀加了 -N 的份数 (含在 Written 里)
//   - SkippedDupContent: 被 "整 yaml 完全相同" 跳过的份数
//   - SkippedDupPayload: 被 "requests 部分 (raw+matchers) 相同" 跳过的份数
//   - WrittenNames: 实际落盘的文件名列表 (按写入顺序)
//   - SkippedItems: 每条跳过项的 {name, reason, dupOf}, 给用户审计
type SaveYamlBatchResult struct {
	Written           int           `json:"written"`
	Renamed           int           `json:"renamed"`
	SkippedDupContent int           `json:"skippedDupContent"`
	SkippedDupPayload int           `json:"skippedDupPayload"`
	WrittenNames      []string      `json:"writtenNames"`
	SkippedItems      []SkippedItem `json:"skippedItems"`
}

type SkippedItem struct {
	Name   string `json:"name"`   // 输入时的原文件名
	Reason string `json:"reason"` // "dup-content" / "dup-payload"
	DupOf  string `json:"dupOf"`  // 跟谁重了 (实际写盘的那份)
}

func (a *App) SaveYamlBatch(folder string, files []YamlOutFile) (*SaveYamlBatchResult, error) {
	if folder == "" {
		return nil, fmt.Errorf("输出目录为空")
	}
	info, err := os.Stat(folder)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("不是目录: %s", folder)
	}

	// seen 三个集合按 hash → 已写盘的文件名映射, 给跳过项报告 dupOf 用.
	seenContent := map[string]string{} // contentHash → finalName
	seenPayload := map[string]string{} // payloadHash → finalName
	usedNames := map[string]struct{}{} // 已用文件名 (lowercase, 含后缀)

	res := &SaveYamlBatchResult{
		WrittenNames: make([]string, 0, len(files)),
		SkippedItems: make([]SkippedItem, 0),
	}

	for _, f := range files {
		if f.Name == "" {
			continue
		}

		// ---- 去重 1: 整 yaml 完全相同 ----
		contentHash := md5Hex(f.Content)
		if dupOf, ok := seenContent[contentHash]; ok {
			res.SkippedDupContent++
			res.SkippedItems = append(res.SkippedItems, SkippedItem{
				Name: f.Name, Reason: "dup-content", DupOf: dupOf,
			})
			continue
		}

		// ---- 去重 2: requests 部分 (raw+matchers) 相同 ----
		// 占位 yaml (无 ## poc) 全都共享同一个 payloadHash, 这一层会把它们留 1 份.
		payloadHash := md5Hex(extractRequestsBlock(f.Content))
		if payloadHash != "" {
			if dupOf, ok := seenPayload[payloadHash]; ok {
				res.SkippedDupPayload++
				res.SkippedItems = append(res.SkippedItems, SkippedItem{
					Name: f.Name, Reason: "dup-payload", DupOf: dupOf,
				})
				continue
			}
		}

		// ---- 名字冲突: 加 -2/-3 后缀, 不能丢 (内容是真不一样的) ----
		clean := filepath.Base(f.Name)
		base := clean
		ext := filepath.Ext(clean)
		if ext != "" {
			base = strings.TrimSuffix(clean, ext)
		}
		if !strings.EqualFold(ext, ".yaml") && !strings.EqualFold(ext, ".yml") {
			ext = ".yaml"
		}
		final := base + ext
		suffix := 0
		for i := 2; ; i++ {
			if _, dup := usedNames[strings.ToLower(final)]; !dup {
				break
			}
			final = fmt.Sprintf("%s-%d%s", base, i, ext)
			suffix = i
		}

		// 同步把 yaml 文件内部的 `id: <base>` 替换为 `id: <base>-<suffix>`,
		// 否则 nuclei 加载会报 "Found duplicate template ID" warning.
		// 只改首个 `id:` 行 (文档头, 缩进 0), 不动 raw 块内出现的 "id" 字样.
		content := f.Content
		if suffix > 0 {
			content = reIDLine.ReplaceAllString(content, fmt.Sprintf("id: %s-%d", base, suffix))
			res.Renamed++
			// 因为 id 改了, content / payload 哈希也变了, 用新的注册
			contentHash = md5Hex(content)
			payloadHash = md5Hex(extractRequestsBlock(content))
		}

		dst := filepath.Join(folder, final)
		if err := os.WriteFile(dst, []byte(content), 0o644); err != nil {
			return res, err
		}

		usedNames[strings.ToLower(final)] = struct{}{}
		seenContent[contentHash] = final
		if payloadHash != "" {
			// 注意: 只有 payloadHash 之前没注册过才注册, 留首份当 "代表"
			if _, ok := seenPayload[payloadHash]; !ok {
				seenPayload[payloadHash] = final
			}
		}
		res.Written++
		res.WrittenNames = append(res.WrittenNames, final)
	}
	return res, nil
}

// md5Hex 输出小写十六进制 md5. 给去重哈希用, 不需要密码学强度.
func md5Hex(s string) string {
	if s == "" {
		return ""
	}
	h := md5.Sum([]byte(s))
	return hex.EncodeToString(h[:])
}

// extractRequestsBlock 抠出 nuclei yaml 的 requests 段 (含 raw + matchers).
// 用于 payloadHash: 两份 yaml info 不同 (title/id 不同) 但 requests 一字不差,
// 实际跑起来效果一样, 视为同一份 PoC.
//
// 实现走最简: 找 "\nrequests:" 锚, 取后续到文件末; 行内规整 (去尾空白, 行内 \r,
// 去末尾空行). 不解析 yaml 结构, 误差只发生在用户在 requests 后又加了同级 key
// 的怪异格式上 (我们生成的 yaml 不会).
func extractRequestsBlock(yamlText string) string {
	lines := strings.Split(yamlText, "\n")
	start := -1
	for i, ln := range lines {
		line := strings.TrimRight(ln, " \t\r")
		if line == "http:" || line == "requests:" {
			start = i
			break
		}
	}
	if start < 0 {
		return ""
	}
	out := make([]string, 0, len(lines))
	for _, ln := range lines[start:] {
		out = append(out, strings.TrimRight(ln, " \t\r"))
	}
	if len(out) > 0 {
		out[0] = "http:"
	}
	// 去掉尾部空行
	for len(out) > 0 && out[len(out)-1] == "" {
		out = out[:len(out)-1]
	}
	return strings.Join(out, "\n")
}

// 匹配头部 `id: ...` 行 (锚定到行首, 限定一行).
// nuclei 模板里 id 总是文档首行, 0 缩进. 用 ^ 加 (?m) 起到锚定作用,
// 不会误伤 raw 块里出现 "        id: foo" (有缩进) 的形态.
var reIDLine = regexp.MustCompile(`(?m)^id:[ \t]*[^\r\n]+`)
