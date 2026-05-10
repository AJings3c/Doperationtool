package main

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// 跑两个真实样本验证转换不炸 + 关键字段在.
// 不强校验完整 yaml 内容, 避免对样本细节强耦合; 重点检查:
//   - id 非空且小写
//   - severity 在合法集合
//   - yaml 包含 nuclei 必备的 id: / info: / requests: 段
//   - poc 段的 Host 已被替换为 {{Hostname}}
func TestConvertSamples(t *testing.T) {
	samples := []string{
		"/Users/ki10Moc/readteam/AI/Scan/poc/POC/wpoc/\u79d1\u8363AIO/\u79d1\u8363AIO\u7ba1\u7406\u7cfb\u7edfendTime\u53c2\u6570\u5b58\u5728SQL\u6ce8\u5165\u6f0f\u6d1e.md",
		"/Users/ki10Moc/readteam/AI/Scan/poc/POC/wpoc/\u79d1\u8363AIO/\u79d1\u8363AIO-moffice\u63a5\u53e3\u5b58\u5728SQL\u6ce8\u5165\u6f0f\u6d1e.md",
	}
	a := &App{}
	for _, p := range samples {
		if _, err := os.Stat(p); err != nil {
			t.Skipf("sample 不存在跳过: %s", p)
		}
		r, err := a.ConvertMarkdownFile(p)
		if err != nil {
			t.Fatalf("ConvertMarkdownFile(%s) err=%v", p, err)
		}
		if r.Id == "" {
			t.Errorf("[%s] id 为空", p)
		}
		if strings.ToLower(r.Id) != r.Id {
			t.Errorf("[%s] id 不是小写: %q", p, r.Id)
		}
		validSev := map[string]bool{"info": true, "low": true, "medium": true, "high": true, "critical": true}
		if !validSev[r.Severity] {
			t.Errorf("[%s] severity 不合法: %q", p, r.Severity)
		}
		for _, want := range []string{"id: ", "info:", "http:"} {
			if !strings.Contains(r.Yaml, want) {
				t.Errorf("[%s] yaml 缺字段 %q", p, want)
			}
		}
		// SQL 注入样本应该 severity 是 high
		if strings.Contains(r.Title, "SQL\u6ce8\u5165") && r.Severity != "high" {
			t.Errorf("[%s] SQL 注入应为 high, 实际 %q", p, r.Severity)
		}
		// 如果原 MD 含 Host: 行, 输出应已替换为 {{Hostname}}
		raw, _ := os.ReadFile(p)
		if strings.Contains(string(raw), "Host:") && !strings.Contains(r.Yaml, "Host: {{Hostname}}") {
			t.Errorf("[%s] Host 没被替换为 {{Hostname}}", p)
		}
		t.Logf("[%s] id=%s severity=%s tags=%v warnings=%v",
			p, r.Id, r.Severity, r.Tags, r.Warnings)
	}
}

func TestSlugify(t *testing.T) {
	cases := []struct{ in, want string }{
		{"\u79d1\u8363AIO endTime SQL\u6ce8\u5165", "aio-endtime-sql"},
		{"Apache Solr 9.0.0 RCE", "apache-solr-9-0-0-rce"},
		{"CVE-2024-11335", "cve-2024-11335"},
		{"\u7eaf\u4e2d\u6587\u6f0f\u6d1e", ""},
	}
	for _, c := range cases {
		got := slugifyAscii(c.in)
		if got != c.want {
			t.Errorf("slugifyAscii(%q) = %q want %q", c.in, got, c.want)
		}
	}
}

func TestMakeIdFallbacks(t *testing.T) {
	// CVE 优先
	if got := makeId("Apache HTTP Server CVE-2024-1234 RCE", "apache.md"); got != "cve-2024-1234" {
		t.Errorf("CVE 优先级失败: %q", got)
	}
	// 文件名 fallback
	if got := makeId("\u7eaf\u4e2d\u6587\u6807\u9898", "apache-solr-rce.md"); got != "apache-solr-rce" {
		t.Errorf("文件名 fallback 失败: %q", got)
	}
	// hash 兜底
	got := makeId("\u7eaf\u4e2d\u6587\u6807\u9898", "\u4e2d\u6587\u540d.md")
	if !strings.HasPrefix(got, "poc-") {
		t.Errorf("hash 兜底失败: %q", got)
	}
}

// TestDumpFullYaml 不是断言, 用来人眼确认转出来的 yaml 长什么样.
// 手动跑: go test -v -run TestDumpFullYaml
func TestDumpFullYaml(t *testing.T) {
	if os.Getenv("DUMP") == "" {
		t.Skip("set DUMP=1 to enable")
	}
	a := &App{}
	for _, p := range []string{
		"/Users/ki10Moc/readteam/AI/Scan/poc/POC/wpoc/\u79d1\u8363AIO/\u79d1\u8363AIO\u7ba1\u7406\u7cfb\u7edfendTime\u53c2\u6570\u5b58\u5728SQL\u6ce8\u5165\u6f0f\u6d1e.md",
		"/Users/ki10Moc/readteam/AI/Scan/poc/POC/wpoc/EDU/EDU\u667a\u6167\u5e73\u53f0PersonalDayInOutSchoolData\u5b58\u5728SQL\u6ce8\u5165\u6f0f\u6d1e.md",
	} {
		if _, err := os.Stat(p); err != nil {
			continue
		}
		r, _ := a.ConvertMarkdownFile(p)
		t.Logf("\n===== %s =====\n%s", p, r.Yaml)
	}
}

func TestNormalizeRaw(t *testing.T) {
	in := "GET /foo HTTP/1.1\r\nHost: 127.0.0.1\r\nUser-Agent: x\r\n"
	got := normalizeRaw(in)
	if !strings.Contains(got, "Host: {{Hostname}}") {
		t.Errorf("Host 未替换: %q", got)
	}
	if strings.Contains(got, "\r") {
		t.Errorf("\\r 未去掉: %q", got)
	}
	// 关键回归: 不能误吞掉 User-Agent 等其它头
	if !strings.Contains(got, "User-Agent: x") {
		t.Errorf("User-Agent 被误删: %q", got)
	}
}

// nuclei 用 yaml.v3 + 类型严格的 schema 加载模板, 这里用同样的方式
// 把整个测试目录滚一遍, 任何能让 yaml.v3 报错的输出都视为缺陷.
// 这是抓 "**vendor", "URL: 末尾冒号", "二进制控制字符" 三类历史 bug 的兜底回归.
func TestConvertedYamlIsValidYAML(t *testing.T) {
	root := "/Users/ki10Moc/readteam/AI/Scan/poc/POC/wpoc"
	if _, err := os.Stat(root); err != nil {
		t.Skipf("样本目录不存在跳过: %s", root)
	}
	a := &App{}
	out, err := a.ConvertMarkdownFolder(root)
	if err != nil {
		t.Fatalf("ConvertMarkdownFolder err=%v", err)
	}
	if len(out.Results) == 0 {
		t.Skip("样本目录里没找到 .md")
	}
	// 我们关心 nuclei 那个最小子集: info.reference 必须 []string, info.tags 必须 string
	type infoT struct {
		Name      string   `yaml:"name"`
		Reference []string `yaml:"reference"`
		Tags      string   `yaml:"tags"`
	}
	type tmplT struct {
		ID   string `yaml:"id"`
		Info infoT  `yaml:"info"`
	}
	bad := 0
	for _, r := range out.Results {
		var tmpl tmplT
		if err := yaml.Unmarshal([]byte(r.Yaml), &tmpl); err != nil {
			bad++
			t.Errorf("[%s] yaml.Unmarshal err: %v sourcePath=%s", r.SourceName, err, r.SourcePath)
			// 找控制字节
			for i, b := range []byte(r.Yaml) {
				if b == '\t' || b == '\n' || b == '\r' {
					continue
				}
				if b < 0x20 || b == 0x7F {
					start := i - 30
					if start < 0 {
						start = 0
					}
					end := i + 30
					if end > len(r.Yaml) {
						end = len(r.Yaml)
					}
					t.Logf("  CTRL 0x%02x off=%d ctx=%q", b, i, r.Yaml[start:end])
					break
				}
			}
		}
	}
	t.Logf("scanned=%d bad=%d", len(out.Results), bad)
}

// 同名 + 内容**不同**时, 走加 -2/-3 后缀 + 同步改 yaml 内部 `id:` 字段的路径.
// 验证: 三份同名但 body 不同 (raw 不同), 应该 3 份都落盘.
func TestSaveYamlBatchDedup_NameCollisionDifferentBody(t *testing.T) {
	tmp := t.TempDir()
	a := &App{}
	// 故意让 raw HTTP body 都不一样 (URL path 不同), 这样 contentHash + payloadHash 都不会撞.
	mkYaml := func(id, path string) string {
		return "id: " + id + "\n\ninfo:\n  name: x\n  severity: medium\n\nhttp:\n  - raw:\n      - |\n        GET " + path + " HTTP/1.1\n        Host: {{Hostname}}\n"
	}
	in := []YamlOutFile{
		{Name: "fileuploadservlet", Content: mkYaml("fileuploadservlet", "/a")},
		{Name: "fileuploadservlet", Content: mkYaml("fileuploadservlet", "/b")},
		{Name: "fileuploadservlet", Content: mkYaml("fileuploadservlet", "/c")},
		{Name: "OtherCase.yaml", Content: mkYaml("othercase", "/x")},
		{Name: "othercase", Content: mkYaml("othercase", "/y")}, // 大小写视作冲突
	}
	r, err := a.SaveYamlBatch(tmp, in)
	if err != nil {
		t.Fatal(err)
	}
	if r.Written != len(in) {
		t.Errorf("写入数量 want=%d got=%d (skip-content=%d, skip-payload=%d)",
			len(in), r.Written, r.SkippedDupContent, r.SkippedDupPayload)
	}
	if r.Renamed != 3 {
		// fileuploadservlet 第 2/3 次撞名 (-2 + -3) + othercase 撞 OtherCase.yaml (-2) = 3 次 rename
		t.Errorf("Renamed want=3 got=%d", r.Renamed)
	}
	want := map[string]string{
		"fileuploadservlet.yaml":   "id: fileuploadservlet\n",
		"fileuploadservlet-2.yaml": "id: fileuploadservlet-2\n",
		"fileuploadservlet-3.yaml": "id: fileuploadservlet-3\n",
		"OtherCase.yaml":           "id: othercase\n",
		"othercase-2.yaml":         "id: othercase-2\n",
	}
	for fn, wantID := range want {
		data, err := os.ReadFile(tmp + "/" + fn)
		if err != nil {
			t.Errorf("读 %s 失败: %v", fn, err)
			continue
		}
		if !strings.Contains(string(data), wantID) {
			t.Errorf("%s 内部 id 期望 %q, 实际首行: %q", fn, strings.TrimSpace(wantID), strings.SplitN(string(data), "\n", 2)[0])
		}
	}
}

// 内容完全相同 (整个 yaml 一字不差) → 第二份起跳过, 不存盘.
// 这个场景在前端"批量保存"反复点同一份结果时常见.
func TestSaveYamlBatchDedup_FullContent(t *testing.T) {
	tmp := t.TempDir()
	a := &App{}
	yaml := "id: foo\n\ninfo:\n  name: x\n\nhttp:\n  - raw:\n      - |\n        GET / HTTP/1.1\n"
	in := []YamlOutFile{
		{Name: "foo", Content: yaml},
		{Name: "foo", Content: yaml}, // 整文一致, 应跳
		{Name: "bar", Content: yaml}, // 整文一致 (虽然名字不同), 也应跳
	}
	r, err := a.SaveYamlBatch(tmp, in)
	if err != nil {
		t.Fatal(err)
	}
	if r.Written != 1 {
		t.Errorf("Written want=1 got=%d", r.Written)
	}
	if r.SkippedDupContent != 2 {
		t.Errorf("SkippedDupContent want=2 got=%d (items=%v)", r.SkippedDupContent, r.SkippedItems)
	}
	// 磁盘上只该有 foo.yaml
	entries, _ := os.ReadDir(tmp)
	if len(entries) != 1 {
		t.Errorf("只该写 1 份, 磁盘上有 %d 个: %v", len(entries), entries)
	}
}

// requests 块相同 (raw + matchers 一字不差), info 不同 → 视为 payload 重复, 跳后续.
// 这是用户最关心的场景: 一堆没识别到 ## poc 的占位 yaml 实际跑起来效果一样.
func TestSaveYamlBatchDedup_PayloadOnly(t *testing.T) {
	tmp := t.TempDir()
	a := &App{}
	// 共享同一份占位 requests, 但 info.name 各不相同
	requestsBlock := "\nhttp:\n  - raw:\n      - |\n        # TODO 占位\n        GET / HTTP/1.1\n        Host: {{Hostname}}\n\n    matchers-condition: and\n    matchers:\n      - type: status\n        status:\n          - 200\n"
	mk := func(id, name string) string {
		return "id: " + id + "\n\ninfo:\n  name: \"" + name + "\"\n  severity: medium\n" + requestsBlock
	}
	in := []YamlOutFile{
		{Name: "vuln-a", Content: mk("vuln-a", "Vuln A")},
		{Name: "vuln-b", Content: mk("vuln-b", "Vuln B")},
		{Name: "vuln-c", Content: mk("vuln-c", "Vuln C")},
	}
	r, err := a.SaveYamlBatch(tmp, in)
	if err != nil {
		t.Fatal(err)
	}
	if r.Written != 1 {
		t.Errorf("Written want=1 got=%d", r.Written)
	}
	if r.SkippedDupPayload != 2 {
		t.Errorf("SkippedDupPayload want=2 got=%d (items=%v)", r.SkippedDupPayload, r.SkippedItems)
	}
	// 跳过项要带 dupOf 指向 vuln-a.yaml
	for _, it := range r.SkippedItems {
		if it.Reason != "dup-payload" {
			t.Errorf("Reason want=dup-payload got=%q", it.Reason)
		}
		if it.DupOf != "vuln-a.yaml" {
			t.Errorf("DupOf want=vuln-a.yaml got=%q", it.DupOf)
		}
	}
}

// 验证 extractRequestsBlock: 同一份占位的两个 yaml info 不同, requests 段哈希必须一致.
// 反过来 requests 不同 (URL 不同) 时哈希必须不同.
func TestExtractRequestsBlock(t *testing.T) {
	a := "id: a\ninfo:\n  name: A\nrequests:\n  - raw:\n      - |\n        GET / HTTP/1.1\n"
	b := "id: b\ninfo:\n  name: B\nhttp:\n  - raw:\n      - |\n        GET / HTTP/1.1\n"
	c := "id: c\ninfo:\n  name: C\nhttp:\n  - raw:\n      - |\n        GET /admin HTTP/1.1\n"
	if extractRequestsBlock(a) != extractRequestsBlock(b) {
		t.Error("info 不同但 requests 一样, hash 应当相等")
	}
	if extractRequestsBlock(a) == extractRequestsBlock(c) {
		t.Error("requests 不同 (URL 变了), hash 应当不等")
	}
	// 没 requests 段的 yaml → 返回空, 不参与 payload 去重
	if got := extractRequestsBlock("id: x\ninfo:\n  name: x\n"); got != "" {
		t.Errorf("无 requests 段应返回空, 得到 %q", got)
	}
}

// ConvertMarkdownBatch: 大批量并发转换, 顺序保证, 索引对位.
//
// 关键不变量:
//   - 输入 N 项, 输出 Results 长度也是 N (即使某项 panic 也填空 ConvertResult)
//   - Results[i] 必须对应 items[i] (按 SourceName 或 SourcePath 验证)
//   - 多个 worker 并发写不同 index, 不能撞
func TestConvertMarkdownBatch_PreservesOrder(t *testing.T) {
	a := &App{}
	// 准备 200 个虚拟 MD, 每个 id 不同, name 也不同, 转完 Results[i] 一定对应 items[i]
	const N = 200
	items := make([]ConvertBatchItem, N)
	for i := 0; i < N; i++ {
		items[i] = ConvertBatchItem{
			Name:       fmt.Sprintf("vuln-%04d.md", i),
			Content:    fmt.Sprintf("# CVE-2024-%04d Test\n\n## poc\n\n```http\nGET /test/%d HTTP/1.1\nHost: example.com\n```\n", i, i),
			SourcePath: fmt.Sprintf("/fake/path/vuln-%04d.md", i),
		}
	}
	r, err := a.ConvertMarkdownBatch(items)
	if err != nil {
		t.Fatalf("批量转换报错: %v", err)
	}
	if r.Total != N || len(r.Results) != N {
		t.Errorf("Total/Results 长度不对: total=%d len=%d 期望 %d", r.Total, len(r.Results), N)
	}
	if r.Failed != 0 {
		t.Errorf("不应有 failed (parseMarkdown 不会 panic 在合法输入上): %d", r.Failed)
	}
	// 顺序: 每个 Results[i] 的 SourcePath 必须等于 items[i].SourcePath.
	// 这是并发实现最容易翻车的点 (worker 写错 index 就乱了).
	for i := 0; i < N; i++ {
		if r.Results[i].SourcePath != items[i].SourcePath {
			t.Errorf("Results[%d].SourcePath=%q 期望 %q (并发顺序错乱)",
				i, r.Results[i].SourcePath, items[i].SourcePath)
		}
		// id 也应抓到 cve-2024-XXXX
		expectId := fmt.Sprintf("cve-2024-%04d", i)
		if r.Results[i].Id != expectId {
			t.Errorf("Results[%d].Id=%q 期望 %q", i, r.Results[i].Id, expectId)
		}
	}
	if r.Elapsed == "" {
		t.Errorf("Elapsed 没填")
	}
	t.Logf("批量转换 %d 个 MD 用时 %s", N, r.Elapsed)
}

// 空输入: 不能 panic, 返回长度 0 的合法结构.
func TestConvertMarkdownBatch_Empty(t *testing.T) {
	a := &App{}
	r, err := a.ConvertMarkdownBatch(nil)
	if err != nil {
		t.Fatal(err)
	}
	if r.Total != 0 || len(r.Results) != 0 || r.Failed != 0 {
		t.Errorf("空输入应该全 0, 实际 %+v", r)
	}
}

// 复现样本中的 "Host:\n" 空值后紧跟 User-Agent 的情况
func TestNormalizeRawEmptyHost(t *testing.T) {
	in := "GET /foo HTTP/1.1\nHost:\nUser-Agent: Mozilla/5.0 (Win)\nAccept: */*\n"
	got := normalizeRaw(in)
	t.Logf("got=\n%s\n---", got)
	if !strings.Contains(got, "Host: {{Hostname}}") {
		t.Errorf("Host: <empty> 没被替换: %q", got)
	}
	if !strings.Contains(got, "User-Agent: Mozilla/5.0 (Win)") {
		t.Errorf("User-Agent 被误删 (主要 bug): %q", got)
	}
	if !strings.Contains(got, "Accept: */*") {
		t.Errorf("Accept 被误删: %q", got)
	}
}
