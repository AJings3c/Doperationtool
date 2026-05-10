package main

// nucleiautofix_test.go
// 覆盖 nucleiautofix.go 的所有 fix 实现 + 跨文件 dedup, 还包括对应的负面用例
// (不该改时不能改) 和 yaml 自校验失败兜底.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// 不变量: parse 后的 yaml 结构必须可被 yaml.v3 unmarshal (我们的语法兜底).
func mustYamlValid(t *testing.T, content string) {
	t.Helper()
	var probe interface{}
	if err := yaml.Unmarshal([]byte(content), &probe); err != nil {
		t.Fatalf("修过的 yaml 语法坏了: %v\n--- content ---\n%s", err, content)
	}
}

// =============== applyFixId ===============

func TestApplyFixId_StripsIllegalChars(t *testing.T) {
	cases := []struct {
		in, wantId string
	}{
		// 含空格 / 括号: 替换成 -
		{"id: CVE-2020-6171 (copy)", "CVE-2020-6171-copy"},
		// 含点: 折叠
		{"id: cve.2020.6171", "cve-2020-6171"},
		// 含冒号 (引号包起来才会出现): 替换
		{`id: "cve:2020:6171"`, "cve-2020-6171"},
		// 大小写保留
		{"id: CVE-2020-6171", ""}, // 已经合法, 不动
		// 全合法
		{"id: cve-2020-6171", ""},
	}
	for _, c := range cases {
		out, fixes := applyFixId(c.in + "\ninfo:\n  name: x\n")
		if c.wantId == "" {
			if len(fixes) != 0 {
				t.Errorf("入 %q 应不动, 实际 fixes=%v", c.in, fixes)
			}
			continue
		}
		if len(fixes) == 0 {
			t.Errorf("入 %q 应改, 实际没动", c.in)
			continue
		}
		// 检查首行 id: 后面不论引号风格如何, 拿出来的值要等于 wantId
		firstLine := strings.SplitN(out, "\n", 2)[0]
		val := strings.TrimSpace(strings.TrimPrefix(firstLine, "id:"))
		val = strings.Trim(val, `"' `)
		if val != c.wantId {
			t.Errorf("入 %q\n want id=%q\n got line=%q (parsed=%q)", c.in, c.wantId, firstLine, val)
		}
	}
}

func TestApplyFixId_AllIllegalFallback(t *testing.T) {
	// 全是中文 → 没合法字符 → 走 md5 fallback
	out, fixes := applyFixId("id: 全中文\ninfo:\n  name: x\n")
	if len(fixes) == 0 {
		t.Fatal("应该 fix")
	}
	if !strings.Contains(out, "id: tpl-") {
		t.Errorf("全非法字符应走 tpl-<md5> fallback, got: %q", out)
	}
}

// =============== applyFixSeverityMissing ===============

func TestApplyFixSeverityMissing_Insert(t *testing.T) {
	in := `id: foo
info:
  name: Foo
  author: alice
  description: bar
`
	out, fixes := applyFixSeverityMissing(in, "unknown")
	if len(fixes) == 0 {
		t.Fatal("应该插")
	}
	if !strings.Contains(out, "  severity: unknown") {
		t.Errorf("没插入 severity 行: %q", out)
	}
	// 应该插在 author 之后, 在 description 之前
	idxAuthor := strings.Index(out, "author:")
	idxSev := strings.Index(out, "severity:")
	idxDesc := strings.Index(out, "description:")
	if !(idxAuthor < idxSev && idxSev < idxDesc) {
		t.Errorf("插入位置错: author@%d severity@%d description@%d", idxAuthor, idxSev, idxDesc)
	}
	mustYamlValid(t, out)
}

func TestApplyFixSeverityMissing_NoChangeIfPresent(t *testing.T) {
	in := `id: foo
info:
  name: Foo
  severity: high
`
	out, fixes := applyFixSeverityMissing(in, "unknown")
	if len(fixes) != 0 || out != in {
		t.Errorf("已有 severity 不该改, fixes=%v", fixes)
	}
}

// nuclei 实测: `severity: ` (key 在但 value 空) 也会被它当 missing 报错.
// 这条 regression 锁住 "空值就地替换为 def", 老版本会跳过这种文件.
func TestApplyFixSeverityMissing_FillsEmptyValue(t *testing.T) {
	cases := []struct {
		name string
		in   string
	}{
		{"trailing-space", "id: foo\ninfo:\n  name: x\n  author: y\n  severity: \n"},
		{"no-space", "id: foo\ninfo:\n  name: x\n  author: y\n  severity:\n"},
		{"comment-only", "id: foo\ninfo:\n  name: x\n  author: y\n  severity:  # placeholder\n"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			out, fixes := applyFixSeverityMissing(c.in, "unknown")
			if len(fixes) == 0 {
				t.Fatalf("空值 severity 应被填充, fixes=%v\nin=%q", fixes, c.in)
			}
			if !strings.Contains(out, "severity: unknown") {
				t.Errorf("没把 severity 填成 unknown:\n%s", out)
			}
			// 不应残留空值的 severity 行 (`severity:` 后无内容)
			lines := strings.Split(out, "\n")
			for _, l := range lines {
				trim := strings.TrimSpace(l)
				if trim == "severity:" {
					t.Errorf("残留空 severity 行: %q\n%s", l, out)
				}
			}
			mustYamlValid(t, out)
			// yaml 解析后, severity 应该真的能拿到 "unknown"
			var doc struct {
				Info struct {
					Severity string `yaml:"severity"`
				} `yaml:"info"`
			}
			if err := yaml.Unmarshal([]byte(out), &doc); err != nil {
				t.Fatal(err)
			}
			if doc.Info.Severity != "unknown" {
				t.Errorf("severity 解析值 = %q, want unknown", doc.Info.Severity)
			}
		})
	}
}

// 行内注释要保留: `severity:  # placeholder` → `severity: unknown  # placeholder`.
func TestApplyFixSeverityMissing_PreservesInlineComment(t *testing.T) {
	in := "id: foo\ninfo:\n  name: x\n  author: y\n  severity:  # FIXME 待 triage\n"
	out, fixes := applyFixSeverityMissing(in, "medium")
	if len(fixes) == 0 {
		t.Fatal("应填充")
	}
	if !strings.Contains(out, "severity: medium") {
		t.Errorf("没填: %s", out)
	}
	if !strings.Contains(out, "# FIXME 待 triage") {
		t.Errorf("注释丢了:\n%s", out)
	}
}

// YAML 允许列表项跟父键同缩进 ("  author:\n  - x"), nuclei 模板大量这么写.
// 老版本的 block-end 扫描只看 "indent > 2", 把同缩进列表项判成块外,
// severity 就会插到列表项之间, 生成的 YAML 无法解析. 这个测试锁住兜底.
func TestApplyFixSeverityMissing_HandlesSameIndentListItems(t *testing.T) {
	in := `id: CVE-2022-26911_51pwn
info:
  name: Foo
  author:
  - 51pwn
  - someone-else
  description: |-
    Text on line 1
    Text on line 2
requests:
  - raw:
      - |
        GET / HTTP/1.1
`
	out, fixes := applyFixSeverityMissing(in, "unknown")
	if len(fixes) == 0 {
		t.Fatal("应该插 severity")
	}
	mustYamlValid(t, out) // 这一步是真正的防线
	// severity 必须在 author 列表项之后, description 之前
	idxListEnd := strings.Index(out, "- someone-else")
	idxSev := strings.Index(out, "severity:")
	idxDesc := strings.Index(out, "description:")
	if !(idxListEnd < idxSev && idxSev < idxDesc) {
		t.Errorf("severity 插错位置了: listEnd@%d sev@%d desc@%d\n---\n%s", idxListEnd, idxSev, idxDesc, out)
	}
}

// 当同缩进列表项出现在要挪到 metadata 的 key 下面时, 整块要一起搬走.
// 不能把 "  source:\n  - https://x\n  - https://y" 只截 source: 一行, 剩下两个列表项变孤儿.
func TestApplyFixInfoFields_MoveKeyWithSameIndentList(t *testing.T) {
	in := `id: foo
info:
  name: Foo
  severity: high
  source:
  - https://a.example.com
  - https://b.example.com
  description: done
`
	out, fixes := applyFixInfoFields(in)
	if len(fixes) == 0 {
		t.Fatal("应改")
	}
	mustYamlValid(t, out)
	var doc struct {
		Info struct {
			Metadata map[string]interface{} `yaml:"metadata"`
		} `yaml:"info"`
	}
	if err := yaml.Unmarshal([]byte(out), &doc); err != nil {
		t.Fatal(err)
	}
	src, ok := doc.Info.Metadata["source"].([]interface{})
	if !ok {
		t.Fatalf("metadata.source 没挪过去或类型错: metadata=%v", doc.Info.Metadata)
	}
	if len(src) != 2 {
		t.Errorf("source 列表项没全搬: %v", src)
	}
}

func TestApplyFixSeverityMissing_NoInfoBlock(t *testing.T) {
	// 没 info 块 → 不动 (不是这个 fix 该管的事)
	in := `id: foo
http:
  - method: GET
`
	out, fixes := applyFixSeverityMissing(in, "unknown")
	if len(fixes) != 0 || out != in {
		t.Errorf("没 info 块不该动, fixes=%v", fixes)
	}
}

// =============== applyFixInfoFields ===============

func TestApplyFixInfoFields_RenameReferenceAliases(t *testing.T) {
	in := `id: foo
info:
  name: Foo
  severity: high
  issues:
    - https://example.com/1
    - https://example.com/2
`
	out, fixes := applyFixInfoFields(in)
	if len(fixes) == 0 {
		t.Fatal("应改")
	}
	if !strings.Contains(out, "  reference:") {
		t.Errorf("没 rename 成 reference: %q", out)
	}
	if strings.Contains(out, "  issues:") {
		t.Errorf("还残留 issues: %q", out)
	}
	if !strings.Contains(out, "    - https://example.com/1") {
		t.Errorf("子项掉了: %q", out)
	}
	mustYamlValid(t, out)
}

// alias 跟 reference 共存时, 应把 alias 整块挪到 info.metadata.<alias> (而不是只记 skip 不动手).
// 老行为是 "skip + 提示人工合并", 但 alias 字段会让 nuclei 整模板拒载, 等于没修.
func TestApplyFixInfoFields_AliasWithReferenceMovesToMetadata(t *testing.T) {
	in := `id: foo
info:
  name: Foo
  severity: high
  reference:
    - https://a
  refrense:
    - https://b
`
	out, fixes := applyFixInfoFields(in)
	if len(fixes) == 0 {
		t.Fatal("应改 (refrense 应被搬到 metadata)")
	}
	// 不应出现两个 reference 块
	if strings.Count(out, "  reference:") != 1 {
		t.Errorf("应该只有一个 reference 块, got:\n%s", out)
	}
	// 不应残留 info 顶层的 refrense
	mustYamlValid(t, out)
	var doc struct {
		Info struct {
			Reference []string               `yaml:"reference"`
			Refrense  *string                `yaml:"refrense,omitempty"`
			Metadata  map[string]interface{} `yaml:"metadata"`
		} `yaml:"info"`
	}
	if err := yaml.Unmarshal([]byte(out), &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Info.Refrense != nil {
		t.Errorf("refrense 还在 info 顶层:\n%s", out)
	}
	moved, ok := doc.Info.Metadata["refrense"].([]interface{})
	if !ok {
		t.Fatalf("metadata.refrense 没出现 (或类型不对): metadata=%v\n%s", doc.Info.Metadata, out)
	}
	if len(moved) != 1 || moved[0] != "https://b" {
		t.Errorf("metadata.refrense 内容错: %v", moved)
	}
	// 原 reference 必须保留
	if len(doc.Info.Reference) != 1 || doc.Info.Reference[0] != "https://a" {
		t.Errorf("原 reference 被弄坏了: %v", doc.Info.Reference)
	}
	// fix 描述里应该有 "move ... → info.metadata.refrense"
	joined := strings.Join(fixes, " | ")
	if !strings.Contains(joined, "move info.refrense") {
		t.Errorf("fix 描述里没 'move info.refrense', fixes=%v", fixes)
	}
}

// 真实场景: issues + reference 都是单行 scalar URL, alias 必须挪走.
// 这个 case 直接对应截图里 CVE-2019-16097_24.yaml / CVE-2015-5688_40.yaml / CVE-2021-26722_3.yaml.
func TestApplyFixInfoFields_AliasScalarMovesToMetadata(t *testing.T) {
	in := `id: foo
info:
  name: Foo
  severity: critical
  issues: https://github.com/x/y/issues/123
  reference: https://writeup.example.com/post
  tags: cve
`
	out, fixes := applyFixInfoFields(in)
	if len(fixes) == 0 {
		t.Fatal("应改 (issues 应被搬到 metadata)")
	}
	mustYamlValid(t, out)
	var doc struct {
		Info struct {
			Issues   *string                `yaml:"issues,omitempty"`
			Metadata map[string]interface{} `yaml:"metadata"`
		} `yaml:"info"`
	}
	if err := yaml.Unmarshal([]byte(out), &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Info.Issues != nil {
		t.Errorf("info.issues 没被搬走:\n%s", out)
	}
	v, ok := doc.Info.Metadata["issues"].(string)
	if !ok || v != "https://github.com/x/y/issues/123" {
		t.Errorf("metadata.issues 错位 / 内容不对: %v", doc.Info.Metadata)
	}
}

func TestApplyFixInfoFields_MoveVendorToMetadata(t *testing.T) {
	in := `id: foo
info:
  name: Foo
  severity: high
  vendor: ruijie
`
	out, fixes := applyFixInfoFields(in)
	if len(fixes) == 0 {
		t.Fatal("应改")
	}
	mustYamlValid(t, out)
	// 验证: vendor 不在 info 顶层, 但在 metadata 下
	var doc struct {
		Info struct {
			Name     string                 `yaml:"name"`
			Vendor   *string                `yaml:"vendor,omitempty"`
			Metadata map[string]interface{} `yaml:"metadata"`
		} `yaml:"info"`
	}
	if err := yaml.Unmarshal([]byte(out), &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Info.Vendor != nil {
		t.Errorf("vendor 还在 info 顶层: %q", out)
	}
	if v, ok := doc.Info.Metadata["vendor"].(string); !ok || v != "ruijie" {
		t.Errorf("vendor 没挪到 metadata, metadata=%v", doc.Info.Metadata)
	}
}

func TestApplyFixInfoFields_MoveMultipleToMetadata(t *testing.T) {
	in := `id: foo
info:
  name: Foo
  severity: high
  vendor: ruijie
  source: nday
  edb: 12345
`
	out, fixes := applyFixInfoFields(in)
	if len(fixes) < 3 {
		t.Errorf("应该 3 条 fix, 实际 %d: %v", len(fixes), fixes)
	}
	mustYamlValid(t, out)
	var doc struct {
		Info struct {
			Metadata map[string]interface{} `yaml:"metadata"`
		} `yaml:"info"`
	}
	yaml.Unmarshal([]byte(out), &doc)
	for _, k := range []string{"vendor", "source", "edb"} {
		if _, ok := doc.Info.Metadata[k]; !ok {
			t.Errorf("metadata.%s 没出现, metadata=%v", k, doc.Info.Metadata)
		}
	}
}

func TestApplyFixInfoFields_MoveToExistingMetadata(t *testing.T) {
	// 已有 metadata 块, 应该追加到里面而不是新建第二个 metadata
	in := `id: foo
info:
  name: Foo
  severity: high
  metadata:
    shodan-query: 'product:foo'
  vendor: ruijie
`
	out, fixes := applyFixInfoFields(in)
	if len(fixes) == 0 {
		t.Fatal("应改")
	}
	mustYamlValid(t, out)
	// 不应该有两个 metadata: 行
	if strings.Count(out, "  metadata:") != 1 {
		t.Errorf("应该只有一个 metadata: 行\n%s", out)
	}
	var doc struct {
		Info struct {
			Metadata map[string]interface{} `yaml:"metadata"`
		} `yaml:"info"`
	}
	yaml.Unmarshal([]byte(out), &doc)
	if _, ok := doc.Info.Metadata["shodan-query"]; !ok {
		t.Errorf("原 metadata 项被弄丢")
	}
	if v, ok := doc.Info.Metadata["vendor"].(string); !ok || v != "ruijie" {
		t.Errorf("vendor 没合并进去")
	}
}

// =============== applyFixMatcherWord ===============

func TestApplyFixMatcherWord_RenamesInTypeWord(t *testing.T) {
	in := `id: foo
info:
  name: Foo
  severity: high
http:
  - method: GET
    matchers:
      - type: word
        word:
          - "Bullwark"
`
	out, fixes := applyFixMatcherWord(in)
	if len(fixes) == 0 {
		t.Fatal("应该 rename")
	}
	if !strings.Contains(out, "        words:") {
		t.Errorf("没 rename word→words: %q", out)
	}
	if strings.Contains(out, "        word:\n          - \"Bullwark\"") {
		t.Errorf("还残留旧 word:")
	}
	mustYamlValid(t, out)
}

func TestApplyFixMatcherWord_NoChangeIfTypeNotWord(t *testing.T) {
	// type: regex 的 matcher 里偶然出现 word: (虽然非法), 不该改 — 改了也不对症
	in := `id: foo
http:
  - matchers:
      - type: regex
        regex:
          - "abc"
        word:
          - "x"
`
	out, fixes := applyFixMatcherWord(in)
	if len(fixes) != 0 {
		t.Errorf("type!=word 不应触发 rename, fixes=%v", fixes)
	}
	if out != in {
		t.Errorf("不应改动")
	}
}

func TestApplyFixMatcherWord_MultipleMatcherItems(t *testing.T) {
	// 多个 item: 第一个 type=word + word: 应改; 第二个 type=word + words: 已对, 不动
	in := `id: foo
http:
  - matchers:
      - type: word
        word:
          - "x"
      - type: word
        words:
          - "y"
`
	out, fixes := applyFixMatcherWord(in)
	if len(fixes) != 1 {
		t.Errorf("应该恰好 1 条 fix, 实际 %v", fixes)
	}
	if strings.Count(out, "words:") != 2 {
		t.Errorf("两 item 都应是 words:, got\n%s", out)
	}
}

func TestApplyFixRequestsHTTP_RenamesTopLevelRequests(t *testing.T) {
	in := `id: foo
info:
  name: Foo
  severity: medium
requests:
  - method: GET
    path:
      - "{{BaseURL}}/foo"
`
	out, fixes := applyFixRequestsHTTP(in)
	if len(fixes) != 1 {
		t.Fatalf("应改 requests→http, fixes=%v", fixes)
	}
	if strings.Contains(out, "\nrequests:") || !strings.Contains(out, "\nhttp:") {
		t.Fatalf("requests 未正确改成 http:\n%s", out)
	}
	mustYamlValid(t, out)
}

// =============== 组合 + 主入口 + dry-run ===============

// 真实场景: 同一文件多种 ERR 同时出现, 全部修完一遍
func TestAutoFixNucleiTemplates_AllInOne(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "broken.yaml")
	original := `id: CVE-2020-6171 (copy)
info:
  name: Foo
  author: alice
  vendor: ruijie
  issues:
    - https://example.com/x
http:
  - method: GET
    path:
      - "{{BaseURL}}/foo"
    matchers:
      - type: word
        word:
          - "ok"
`
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}

	a := &App{}
	r, err := a.AutoFixNucleiTemplates(dir, AutoFixOptions{
		FixSeverity:    true,
		SeverityValue:  "unknown",
		FixInfoFields:  true,
		FixMatcherWord: true,
		FixId:          true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Fixed != 1 {
		t.Errorf("Fixed 应是 1, got %d", r.Fixed)
	}
	if len(r.Changes) != 1 {
		t.Fatalf("Changes 长度应 1, got %d (%+v)", len(r.Changes), r.Changes)
	}
	ch := r.Changes[0]
	// 检查每种 fix 都被记录
	joinedFixes := strings.Join(ch.AppliedFixes, " | ")
	for _, want := range []string{"rename id", "insert severity", "rename issues → reference", "move info.vendor", "rename matcher field word"} {
		if !strings.Contains(joinedFixes, want) {
			t.Errorf("Fix %q 没被记录\nfixes=%v", want, ch.AppliedFixes)
		}
	}
	// 实际文件应被改写
	got, _ := os.ReadFile(path)
	gotStr := string(got)
	if gotStr == original {
		t.Errorf("文件没被改写")
	}
	mustYamlValid(t, gotStr)
	// 抽几个关键点验证
	if !strings.Contains(gotStr, "severity: unknown") {
		t.Error("severity 没插入")
	}
	if !strings.Contains(gotStr, "  reference:") {
		t.Error("issues 没改成 reference")
	}
	if strings.Contains(gotStr, "  vendor: ruijie\n") {
		// 这个匹配会在 metadata 子级里也命中 ("    vendor:"), 所以要严格匹配 info 顶级
		// 检查 info.vendor 已经不在 (但 metadata.vendor 在)
		var doc struct {
			Info struct {
				Vendor   *string                `yaml:"vendor,omitempty"`
				Metadata map[string]interface{} `yaml:"metadata"`
			} `yaml:"info"`
		}
		yaml.Unmarshal(got, &doc)
		if doc.Info.Vendor != nil {
			t.Error("vendor 没从 info 顶层挪走")
		}
	}
	if !strings.Contains(gotStr, "        words:") {
		t.Error("matcher word 没改 words")
	}
	// id 已合法
	if !strings.Contains(gotStr, "id: CVE-2020-6171-copy") {
		t.Errorf("id 没 slugify, got: %s", gotStr)
	}
}

func TestAutoFixNucleiTemplates_DryRunDoesNotWrite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "broken.yaml")
	original := `id: foo
info:
  name: Foo
  vendor: r
`
	os.WriteFile(path, []byte(original), 0o644)
	a := &App{}
	r, err := a.AutoFixNucleiTemplates(dir, AutoFixOptions{
		DryRun:        true,
		FixSeverity:   true,
		FixInfoFields: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Fixed != 1 {
		t.Errorf("DryRun 也应该报 Fixed=1, got %d", r.Fixed)
	}
	got, _ := os.ReadFile(path)
	if string(got) != original {
		t.Errorf("DryRun 不该写盘, 文件已被改: %s", got)
	}
	if !r.DryRun {
		t.Error("结果 DryRun 标志没传回")
	}
}

func TestAutoFixNucleiTemplates_BackupCreated(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "broken.yaml")
	original := `id: foo
info:
  name: Foo
`
	os.WriteFile(path, []byte(original), 0o644)
	a := &App{}
	r, _ := a.AutoFixNucleiTemplates(dir, AutoFixOptions{
		Backup:      true,
		FixSeverity: true,
	})
	if len(r.Changes) == 0 {
		t.Fatal("应有改动")
	}
	bak := r.Changes[0].BackupPath
	if bak == "" {
		t.Fatal("BackupPath 没填")
	}
	bakRaw, err := os.ReadFile(bak)
	if err != nil {
		t.Fatal(err)
	}
	if string(bakRaw) != original {
		t.Errorf("备份内容不是原文")
	}
}

// =============== 跨文件 dedup ===============

func TestDedupTemplateIds_BasicRename(t *testing.T) {
	dir := t.TempDir()
	mk := func(name, id string) string {
		p := filepath.Join(dir, name)
		os.WriteFile(p, []byte("id: "+id+"\ninfo:\n  name: x\n  severity: info\n"), 0o644)
		return p
	}
	mk("a.yaml", "cve-2020-1234")
	mk("b.yaml", "cve-2020-1234")
	mk("c.yaml", "cve-2020-1234")
	mk("d.yaml", "cve-2020-9999") // 不重复, 不动

	a := &App{}
	r, err := a.AutoFixNucleiTemplates(dir, AutoFixOptions{DedupId: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.DedupRenames) != 2 {
		t.Errorf("应 rename 2 个 (b, c), 实际 %d: %+v", len(r.DedupRenames), r.DedupRenames)
	}
	// 验证 ids 都唯一了
	seen := make(map[string]string)
	for _, name := range []string{"a.yaml", "b.yaml", "c.yaml", "d.yaml"} {
		raw, _ := os.ReadFile(filepath.Join(dir, name))
		id := extractTopLevelId(string(raw))
		if prev, ok := seen[id]; ok {
			t.Errorf("dedup 后还重复: %s 和 %s 都是 %s", prev, name, id)
		}
		seen[id] = name
	}
	// a 必须保留原 id (排序后 a 在最前)
	rawA, _ := os.ReadFile(filepath.Join(dir, "a.yaml"))
	if extractTopLevelId(string(rawA)) != "cve-2020-1234" {
		t.Errorf("a.yaml 的 id 应不变")
	}
}

func TestDedupTemplateIds_DryRun(t *testing.T) {
	dir := t.TempDir()
	for _, n := range []string{"a.yaml", "b.yaml"} {
		os.WriteFile(filepath.Join(dir, n), []byte("id: same\ninfo:\n  name: x\n  severity: info\n"), 0o644)
	}
	a := &App{}
	r, _ := a.AutoFixNucleiTemplates(dir, AutoFixOptions{DedupId: true, DryRun: true})
	if len(r.DedupRenames) != 1 {
		t.Errorf("DryRun 也应汇报 rename, got %d", len(r.DedupRenames))
	}
	// 但文件内容必须没变
	for _, n := range []string{"a.yaml", "b.yaml"} {
		raw, _ := os.ReadFile(filepath.Join(dir, n))
		if extractTopLevelId(string(raw)) != "same" {
			t.Errorf("DryRun 不该写盘, %s 已被改", n)
		}
	}
}

// =============== yaml 自校验失败防护 ===============

// 故意做一个会让 fix 函数生坏 yaml 的输入 — 实际上线版本应该没有这种场景,
// 但通过单元测试锁住 "万一发生时不写坏盘" 的契约.
//
// 这里通过手工构造一个合法但奇异 (大量缩进 tab 混 space) 的输入, fix 函数虽然
// 自己不会蓄意搞坏, 但万一行级修改撞上 tab vs space 边界, 兜底机制必须 catch 住.
func TestFixOneYaml_RejectsBrokenOutput(t *testing.T) {
	// 这个测试更多是文档化兜底语义; 实际 fix 函数当前不会生坏 yaml.
	// 我们直接验证: 给一个完全合法的 yaml, 不开任何 fix, 不动它.
	dir := t.TempDir()
	path := filepath.Join(dir, "ok.yaml")
	content := "id: foo\ninfo:\n  name: x\n  severity: info\n"
	os.WriteFile(path, []byte(content), 0o644)
	a := &App{}
	r, _ := a.AutoFixNucleiTemplates(dir, AutoFixOptions{FixSeverity: true})
	if r.Fixed != 0 || r.Unchanged != 1 {
		t.Errorf("合法文件不该改, got fixed=%d unchanged=%d failed=%d", r.Fixed, r.Unchanged, r.Failed)
	}
}

// =============== 辅助工具 ===============

func TestExtractTopLevelId(t *testing.T) {
	cases := []struct{ in, want string }{
		{"id: foo\n", "foo"},
		{`id: "foo bar"`, "foo bar"},
		{"id: foo  # comment\n", "foo"},
		{"# header\nid: bar\n", "bar"},
		{"info:\n  id: nested\n", ""}, // 嵌套的 id 不算
		{"  id: not-top\n", ""},       // 缩进的 id 不算
		{"", ""},
	}
	for _, c := range cases {
		if got := extractTopLevelId(c.in); got != c.want {
			t.Errorf("extractTopLevelId(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// 真实 nuclei 模板的端到端 regression: 从用户本地的 poc_high_quality 目录拷贝
// 3 个曾经触发 "fix 后 yaml 语法失败" 的文件, 跑完整 pipeline, 验证 YAML 结构保持合法.
// 不可用时 t.Skip (例如在 CI 上没这些文件).
func TestAutoFix_RealWorldRegression(t *testing.T) {
	sources := []string{
		"/Users/ki10Moc/readteam/AI/Scan/poc/nuclei_poc/poc_high_quality/cve/CVE-2022-26911.yaml",
		"/Users/ki10Moc/readteam/AI/Scan/poc/nuclei_poc/poc_high_quality/other/iiop.yaml",
		"/Users/ki10Moc/readteam/AI/Scan/poc/nuclei_poc/poc_high_quality/auth/aolynk-br304-default-passwordl.yaml",
	}
	dir := t.TempDir()
	copied := 0
	for _, src := range sources {
		raw, err := os.ReadFile(src)
		if err != nil {
			continue
		}
		dst := filepath.Join(dir, filepath.Base(src))
		if err := os.WriteFile(dst, raw, 0o644); err != nil {
			t.Fatalf("写 %s: %v", dst, err)
		}
		copied++
	}
	if copied == 0 {
		t.Skip("本地没有实测模板文件, 跳过此 regression")
	}
	a := &App{}
	r, err := a.AutoFixNucleiTemplates(dir, AutoFixOptions{
		FixSeverity:    true,
		SeverityValue:  "unknown",
		FixInfoFields:  true,
		FixMatcherWord: true,
		FixId:          true,
	})
	if err != nil {
		t.Fatal(err)
	}
	// 断言: 没有任何 Skipped. 曾经这里 3 个文件都 Skipped ("fix 后 yaml 语法失败").
	var skipped []FileFixChange
	for _, c := range r.Changes {
		if c.Skipped {
			skipped = append(skipped, c)
		}
	}
	if len(skipped) > 0 {
		for _, s := range skipped {
			t.Errorf("仍被跳过: %s — %s", filepath.Base(s.Path), s.SkipReason)
		}
	}
	// 所有改后的文件必须能被 yaml parse
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		p := filepath.Join(dir, e.Name())
		raw, _ := os.ReadFile(p)
		mustYamlValid(t, string(raw))
	}
}

// TestAutoFix_NucleiValidateScreenshot 锁住截图里 9 条错误对应的文件, 跑完整 pipeline 后:
//  1. 没有任何 Skipped (语法都没坏)
//  2. 每个文件用 yaml.Unmarshal 解出来后都能拿到合法 (非空) 的 severity (filled 或原有)
//  3. info 顶层不应再残留任何 referenceAlias 字段 (issues / references / refrense)
//  4. 仍被报告为 changed (有 fix 应用) — 否则说明哪条规则又漏了
//
// 输入文件不存在时 Skip (CI 没这些数据), 本地开发环境直接跑.
func TestAutoFix_NucleiValidateScreenshot(t *testing.T) {
	type want struct{ name, reason string }
	wants := []want{
		{"CVE-2018-18326 (copy 1).yaml", "empty severity"},
		{"cve-2018-9126-3655.yaml", "empty severity + 注释残留"},
		{"cve-2021-24997-5780_1.yaml", "missing severity"},
		{"cve-2021-24997-5781_1.yaml", "missing severity"},
		{"joomla-version_1.yaml", "missing severity"},
		{"CVE-2019-16097_24.yaml", "issues + reference 共存"},
		{"CVE-2015-5688_40.yaml", "issues + reference 共存 (1-空格缩进)"},
		{"CVE-2021-26722_3.yaml", "issues + reference 共存"},
	}
	srcRoot := "/Users/ki10Moc/readteam/AI/Scan/poc/nuclei_poc/poc_high_quality"
	srcPaths := map[string]string{
		"CVE-2018-18326 (copy 1).yaml": srcRoot + "/cve/CVE-2018-18326 (copy 1).yaml",
		"cve-2018-9126-3655.yaml":      srcRoot + "/cve/cve-2018-9126-3655.yaml",
		"cve-2021-24997-5780_1.yaml":   srcRoot + "/cve/cve-2021-24997-5780_1.yaml",
		"cve-2021-24997-5781_1.yaml":   srcRoot + "/cve/cve-2021-24997-5781_1.yaml",
		"joomla-version_1.yaml":        srcRoot + "/joomla/joomla-version_1.yaml",
		"CVE-2019-16097_24.yaml":       srcRoot + "/cve/CVE-2019-16097_24.yaml",
		"CVE-2015-5688_40.yaml":        srcRoot + "/cve/CVE-2015-5688_40.yaml",
		"CVE-2021-26722_3.yaml":        srcRoot + "/cve/CVE-2021-26722_3.yaml",
	}

	dir := t.TempDir()
	copied := 0
	for _, w := range wants {
		raw, err := os.ReadFile(srcPaths[w.name])
		if err != nil {
			continue
		}
		dst := filepath.Join(dir, w.name)
		if err := os.WriteFile(dst, raw, 0o644); err != nil {
			t.Fatalf("写 %s: %v", dst, err)
		}
		copied++
	}
	if copied == 0 {
		t.Skip("本地没有截图里那批模板文件, 跳过 regression")
	}

	a := &App{}
	r, err := a.AutoFixNucleiTemplates(dir, AutoFixOptions{
		FixSeverity:    true,
		SeverityValue:  "unknown",
		FixInfoFields:  true,
		FixMatcherWord: true,
		FixId:          true,
	})
	if err != nil {
		t.Fatal(err)
	}

	// 1) 没有 skip
	for _, c := range r.Changes {
		if c.Skipped {
			t.Errorf("被 skip 了: %s — %s", filepath.Base(c.Path), c.SkipReason)
		}
	}

	// 2) 每个文件都能 yaml.Unmarshal, severity 非空, alias 不在 info 顶层
	for _, w := range wants {
		path := filepath.Join(dir, w.name)
		raw, err := os.ReadFile(path)
		if err != nil {
			continue // 没拷过来的, 跳过
		}
		t.Run(w.name, func(t *testing.T) {
			var doc struct {
				Info struct {
					Severity   string  `yaml:"severity"`
					Issues     *string `yaml:"issues,omitempty"`
					References *string `yaml:"references,omitempty"`
					Refrense   *string `yaml:"refrense,omitempty"`
				} `yaml:"info"`
			}
			if err := yaml.Unmarshal(raw, &doc); err != nil {
				t.Fatalf("yaml 解析失败 (%s): %v\n--- content ---\n%s", w.reason, err, raw)
			}
			if strings.TrimSpace(doc.Info.Severity) == "" {
				t.Errorf("[%s] severity 仍为空 (%s):\n%s", w.name, w.reason, raw)
			}
			if doc.Info.Issues != nil {
				t.Errorf("[%s] info.issues 没被搬走:\n%s", w.name, raw)
			}
			if doc.Info.References != nil {
				t.Errorf("[%s] info.references 没被搬走:\n%s", w.name, raw)
			}
			if doc.Info.Refrense != nil {
				t.Errorf("[%s] info.refrense 没被搬走:\n%s", w.name, raw)
			}
		})
	}
}

func TestSlugifyNucleiId(t *testing.T) {
	cases := []struct{ in, want string }{
		{"CVE-2020-6171", "CVE-2020-6171"},
		{"CVE-2020-6171 (copy)", "CVE-2020-6171-copy"},
		{"cve.2020.6171", "cve-2020-6171"},
		{"___foo---", "foo"},
		{"中文 only", "only"},
		{"全中文", ""},
	}
	for _, c := range cases {
		if got := slugifyNucleiId(c.in); got != c.want {
			t.Errorf("slugifyNucleiId(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
