package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// ============== extractCategoryToken ==============

func TestExtractCategoryToken(t *testing.T) {
	cases := []struct {
		name, id, want string
		desc           string
	}{
		// 标准: 文件名第一个有意义词
		{"adobe.yaml", "", "adobe", "纯单词文件名"},
		{"adobe-coldfusion-cve-2023-12345.yaml", "", "adobe", "kebab + cve 后缀"},
		{"adobe_experience_manager.yaml", "", "adobe", "snake case"},
		{"adobecq-auth-bypass.yaml", "", "adobecq", "无分隔符厂商名 (会被 inferCategoryMap 进一步合并)"},
		{"WordPress-Plugin.yaml", "", "wordpress", "大小写混用"},
		{"foo.bar.yaml", "", "foo", "用 . 也能切"},

		// 跳停用词
		{"cve-2023-1234.yaml", "vendor-x-leak", "vendor", "纯 cve 文件名 → 退到 id"},
		{"poc-adobe-rce.yaml", "", "adobe", "首个是停用词 poc, 跳到 adobe"},
		{"nuclei-template-wordpress.yaml", "", "wordpress", "跳两个停用词"},

		// 跳数字
		{"2023-adobe.yaml", "", "adobe", "首个是年份"},
		{"01-adobe.yaml", "", "adobe", "首个是数字编号"},

		// id fallback (extractTopLevelId 已经剥了 'id:' 前缀, 这里传纯值)
		{"cve-2023-1234.yaml", "vendor-x", "vendor", "文件名抽不到 → id"},
		{"unknown.yaml", "", "unknown", "id 也空 → 用文件名 (unknown 长度 ≥2 不是停用词)"},

		// 抽不到
		{"cve-2020-1234.yaml", "cve-2020-1234", "", "全是停用词/数字"},
		{"01-02-03.yaml", "", "", "全数字"},
		{"a.yaml", "", "", "首字母只 1 字符 (<2) 不算"},
		{".yaml", "", "", "空名"},
	}
	for _, c := range cases {
		got := extractCategoryToken(c.name, c.id)
		if got != c.want {
			t.Errorf("[%s] extractCategoryToken(%q, %q) = %q, want %q", c.desc, c.name, c.id, got, c.want)
		}
	}
}

// ============== inferCategoryMap ==============

// 经典场景: adobe / adobecq / adobe-experience 自动合到 adobe.
func TestInferCategoryMap_AdobeFamily(t *testing.T) {
	tokens := map[string]int{
		"adobe":            5,
		"adobecq":          3,
		"adobe-experience": 4, // 注意 inferCategoryMap 处理的是 token (单词), 这里 token 通常没有 -;
		// 但用户文件名可能产生这种 token (如果没有进一步切分). 不影响算法测试.
		"apache":    10,
		"wordpress": 20,
	}
	m := inferCategoryMap(tokens)
	if m["adobe"] != "adobe" {
		t.Errorf("adobe 应保留为 adobe, 实际 %q", m["adobe"])
	}
	if m["adobecq"] != "adobe" {
		t.Errorf("adobecq 应合并到 adobe, 实际 %q", m["adobecq"])
	}
	if m["adobe-experience"] != "adobe" {
		t.Errorf("adobe-experience 应合并到 adobe, 实际 %q", m["adobe-experience"])
	}
	if m["apache"] != "apache" {
		t.Errorf("apache 应保留, 实际 %q", m["apache"])
	}
	if m["wordpress"] != "wordpress" {
		t.Errorf("wordpress 应保留, 实际 %q", m["wordpress"])
	}
}

// Synthetic anchor: anchor token 不存在为独立 token, 但多个长 token 共享前缀.
// 用户场景: {adobecq, adobe-experience, adobe-acrobat} 没有 'adobe' 这个独立模板, 但都该归到 adobe.
func TestInferCategoryMap_SyntheticAnchor(t *testing.T) {
	tokens := map[string]int{
		"adobecq":          3,
		"adobe-experience": 4,
		"adobe-acrobat":    2,
	}
	m := inferCategoryMap(tokens)
	for tok, want := range map[string]string{
		"adobecq":          "adobe",
		"adobe-experience": "adobe",
		"adobe-acrobat":    "adobe",
	} {
		if m[tok] != want {
			t.Errorf("%s 应合到 %s, 实际 %q", tok, want, m[tok])
		}
	}
}

// 词边界场景: {wp-content, wp-admin, wp-config} 应在 "wp" 下合并 (虽然只有 2 字符, 但词边界处放行).
func TestInferCategoryMap_ShortWithSeparator(t *testing.T) {
	tokens := map[string]int{
		"wp-content": 5,
		"wp-admin":   3,
		"wp-config":  2,
	}
	m := inferCategoryMap(tokens)
	for k, v := range m {
		if v != "wp" {
			t.Errorf("%s 应合到 wp, 实际 %q", k, v)
		}
	}
}

// 反例: {ab, abc, abd} 不应错误合并 (字母-字母衔接长度不足).
func TestInferCategoryMap_NoFalseMerges(t *testing.T) {
	tokens := map[string]int{
		"ab":  1,
		"abc": 1,
		"abd": 1,
	}
	m := inferCategoryMap(tokens)
	for k := range tokens {
		if m[k] != k {
			t.Errorf("%s 应 standalone, 实际 %q", k, m[k])
		}
	}
}

// 反例: {wpa, wp} 不应让 wp 吞掉 wpa (wp 没有词边界跟到 wpa, 字母衔接但 wp len<5).
func TestInferCategoryMap_NoSubstringSwallow(t *testing.T) {
	tokens := map[string]int{
		"wp":  5,
		"wpa": 3,
	}
	m := inferCategoryMap(tokens)
	if m["wp"] != "wp" {
		t.Errorf("wp 应 standalone, 实际 %q", m["wp"])
	}
	if m["wpa"] != "wpa" {
		t.Errorf("wpa 应 standalone, 实际 %q", m["wpa"])
	}
}

// 单 token 不构成分类, 各自独立.
func TestInferCategoryMap_Singletons(t *testing.T) {
	tokens := map[string]int{
		"adobe":     1,
		"apache":    1,
		"wordpress": 1,
	}
	m := inferCategoryMap(tokens)
	if len(m) != 3 {
		t.Fatalf("应有 3 项, 实际 %d", len(m))
	}
	for k, v := range m {
		if v != k {
			t.Errorf("%s 应 standalone, 实际 %q", k, v)
		}
	}
}

// 长前缀优先: {adobecq, adobecqxxx} 应在 "adobecq" 下合并, 不应被更短的虚假前缀截走.
func TestInferCategoryMap_LongerPrefixWins(t *testing.T) {
	tokens := map[string]int{
		"adobecq":    2,
		"adobecqxxx": 3,
	}
	m := inferCategoryMap(tokens)
	// 期望都归到 "adobecq" (而不是某个更短或更长的中间前缀, 也不是 "adobe")
	if m["adobecq"] != "adobecq" || m["adobecqxxx"] != "adobecq" {
		t.Errorf("应都合到 adobecq, 实际 %v", m)
	}
}

// 空输入.
func TestInferCategoryMap_Empty(t *testing.T) {
	m := inferCategoryMap(map[string]int{})
	if len(m) != 0 {
		t.Errorf("空输入应返回空 map, 实际 %v", m)
	}
}

// ============== sanitizeCategoryName ==============

func TestSanitizeCategoryName(t *testing.T) {
	cases := []struct{ in, want string }{
		{"adobe", "adobe"},
		{"  adobe  ", "adobe"},
		{"", "uncategorized"},
		{"   ", "uncategorized"},
		{"adobe/cf", "adobe_cf"},
		// '../etc' 依次走 / → _, 然后 .. → _; 两道替换都命中了 → __etc.
		// 在路径安全上这不重要 (重点是干掉任何 / 和 .. 跳出目录), 双下划线是合理产物.
		{"../etc", "__etc"},
		{".", "uncategorized"},
		{"a:b", "a_b"},
	}
	for _, c := range cases {
		if got := sanitizeCategoryName(c.in); got != c.want {
			t.Errorf("sanitizeCategoryName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// ============== ScanTemplateCategories ==============

func writeTplCls(t *testing.T, dir, name, id string) string {
	t.Helper()
	body := "info:\n  name: x\n  severity: info\n"
	if id != "" {
		body = "id: " + id + "\n" + body
	}
	p := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

// 完整端到端: 几个 adobe 文件 + 几个 wordpress + 一个无法分类的 cve.
func TestScanCategories_EndToEnd(t *testing.T) {
	dir := t.TempDir()
	writeTplCls(t, dir, "adobe.yaml", "adobe-rce")
	writeTplCls(t, dir, "adobe-coldfusion.yaml", "adobe-cf")
	writeTplCls(t, dir, "adobecq-bypass.yaml", "adobecq")
	writeTplCls(t, dir, "wordpress.yaml", "wp-1")
	writeTplCls(t, dir, "wordpress-plugin.yaml", "wp-2")
	writeTplCls(t, dir, "cve-2020-1111.yaml", "")              // 无 id, token 抽不到 → uncategorized
	writeTplCls(t, dir, "lonely-vendor.yaml", "lonely-vendor") // 单 token, standalone

	a := &App{}
	r, err := a.ScanTemplateCategories(dir)
	if err != nil {
		t.Fatal(err)
	}
	if r.Total != 7 {
		t.Errorf("Total=%d, want 7", r.Total)
	}
	if len(r.Uncategorized) != 1 {
		t.Errorf("Uncategorized 应为 1 (cve-2020-1111.yaml), 实际 %d: %+v", len(r.Uncategorized), r.Uncategorized)
	}

	byName := map[string]ProposedCategory{}
	for _, c := range r.Categories {
		byName[c.Name] = c
	}
	if c, ok := byName["adobe"]; !ok || len(c.Files) != 3 {
		t.Errorf("adobe 分类应 3 个文件, 实际: %+v", c)
	}
	if c, ok := byName["wordpress"]; !ok || len(c.Files) != 2 {
		t.Errorf("wordpress 分类应 2 个文件, 实际: %+v", c)
	}
	if c, ok := byName["lonely"]; !ok || len(c.Files) != 1 {
		t.Errorf("lonely 分类应 1 个文件 (standalone), 实际: %+v", c)
	}
	// 排序: 文件数降序, adobe(3) 应在 wordpress(2) 前
	if r.Categories[0].Name != "adobe" {
		t.Errorf("第一个分类应是 adobe, 实际 %q", r.Categories[0].Name)
	}
}

// 没文件的目录.
func TestScanCategories_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	a := &App{}
	r, err := a.ScanTemplateCategories(dir)
	if err != nil {
		t.Fatal(err)
	}
	if r.Total != 0 || len(r.Categories) != 0 {
		t.Errorf("空目录应一无所获, 实际 %+v", r)
	}
}

// 错误参数.
func TestScanCategories_BadInput(t *testing.T) {
	a := &App{}
	if _, err := a.ScanTemplateCategories(""); err == nil {
		t.Error("空目录应报错")
	}
	if _, err := a.ScanTemplateCategories("/nonexistent_dir_12345"); err == nil {
		t.Error("不存在的目录应报错")
	}
}

// 跳过隐藏 / vendor 目录, 跟其它扫描行为一致.
func TestScanCategories_SkipsHiddenAndVendor(t *testing.T) {
	dir := t.TempDir()
	writeTplCls(t, dir, "adobe.yaml", "adobe")
	writeTplCls(t, dir, ".git/adobe.yaml", "adobe")
	writeTplCls(t, dir, "node_modules/adobe.yaml", "adobe")
	a := &App{}
	r, err := a.ScanTemplateCategories(dir)
	if err != nil {
		t.Fatal(err)
	}
	if r.Total != 1 {
		t.Errorf("Total = %d, want 1 (.git / node_modules 应跳过)", r.Total)
	}
}

// ============== ApplyTemplateCategories ==============

func TestApplyCategories_Basic(t *testing.T) {
	src := t.TempDir()
	tgt := t.TempDir()
	p1 := writeTplCls(t, src, "adobe-rce.yaml", "adobe")
	p2 := writeTplCls(t, src, "adobe-cf.yaml", "adobe")
	p3 := writeTplCls(t, src, "wordpress-1.yaml", "wp")

	a := &App{}
	r, err := a.ApplyTemplateCategories(ApplyCategoriesRequest{
		TargetDir: tgt,
		Assignments: []CategoryAssignment{
			{Name: "adobe", Paths: []string{p1, p2}},
			{Name: "wordpress", Paths: []string{p3}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Moved != 3 || r.Skipped != 0 {
		t.Fatalf("Moved=%d Skipped=%d, want 3/0; items=%+v", r.Moved, r.Skipped, r.Items)
	}
	for _, want := range []string{"adobe/adobe-rce.yaml", "adobe/adobe-cf.yaml", "wordpress/wordpress-1.yaml"} {
		if !pathExists(filepath.Join(tgt, want)) {
			t.Errorf("应已搬到 %s", want)
		}
	}
	if pathExists(p1) || pathExists(p2) || pathExists(p3) {
		t.Error("源应已移走")
	}
}

func TestApplyCategories_ConflictRename(t *testing.T) {
	src := t.TempDir()
	tgt := t.TempDir()
	p1 := writeTplCls(t, src, "adobe.yaml", "adobe")
	// 在目标目录预先放一个同路径文件 (走 rename 兜)
	writeTplCls(t, filepath.Join(tgt, "adobe"), "adobe.yaml", "preexisting")

	a := &App{}
	r, err := a.ApplyTemplateCategories(ApplyCategoriesRequest{
		TargetDir: tgt,
		Assignments: []CategoryAssignment{
			{Name: "adobe", Paths: []string{p1}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Moved != 1 {
		t.Fatalf("Moved=%d, want 1; items=%+v", r.Moved, r.Items)
	}
	if !pathExists(filepath.Join(tgt, "adobe", "adobe_dup_1.yaml")) {
		t.Errorf("应生成 adobe/adobe_dup_1.yaml")
	}
	// 原来的不应被覆盖
	raw, _ := os.ReadFile(filepath.Join(tgt, "adobe", "adobe.yaml"))
	if !strings.Contains(string(raw), "preexisting") {
		t.Error("原 adobe.yaml 不应被覆盖")
	}
}

func TestApplyCategories_DryRun(t *testing.T) {
	src := t.TempDir()
	tgt := t.TempDir()
	p1 := writeTplCls(t, src, "adobe.yaml", "adobe")
	a := &App{}
	r, err := a.ApplyTemplateCategories(ApplyCategoriesRequest{
		TargetDir:   tgt,
		DryRun:      true,
		Assignments: []CategoryAssignment{{Name: "adobe", Paths: []string{p1}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Moved != 1 {
		t.Errorf("DryRun 应汇报 1 个 Moved, 实际 %d", r.Moved)
	}
	if !pathExists(p1) {
		t.Error("DryRun 不应实际搬动文件")
	}
	if pathExists(filepath.Join(tgt, "adobe", "adobe.yaml")) {
		t.Error("DryRun 不应在目标目录创建文件")
	}
}

// 同一个源文件被多个分类引用: 应只搬一次, 取首次出现的分类
func TestApplyCategories_DedupSrc(t *testing.T) {
	src := t.TempDir()
	tgt := t.TempDir()
	p1 := writeTplCls(t, src, "adobe.yaml", "adobe")
	a := &App{}
	r, err := a.ApplyTemplateCategories(ApplyCategoriesRequest{
		TargetDir: tgt,
		Assignments: []CategoryAssignment{
			{Name: "adobe", Paths: []string{p1}},
			{Name: "duplicates-of-adobe", Paths: []string{p1}}, // 重复引用
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Moved != 1 {
		t.Errorf("同源文件多次引用应只搬一次, 实际 Moved=%d", r.Moved)
	}
	// 应到 adobe/, 不应到 duplicates-of-adobe/
	if !pathExists(filepath.Join(tgt, "adobe", "adobe.yaml")) {
		t.Error("应搬到 adobe/")
	}
	if pathExists(filepath.Join(tgt, "duplicates-of-adobe", "adobe.yaml")) {
		t.Error("不应同时存在于第二个分类")
	}
}

// 自定义分类名 (用户在 UI 里改名 / 合并后传入), 含非法字符的 sanitization.
func TestApplyCategories_CustomNameSanitization(t *testing.T) {
	src := t.TempDir()
	tgt := t.TempDir()
	p := writeTplCls(t, src, "x.yaml", "x")
	a := &App{}
	r, err := a.ApplyTemplateCategories(ApplyCategoriesRequest{
		TargetDir: tgt,
		Assignments: []CategoryAssignment{
			{Name: "weird/cat:name", Paths: []string{p}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Moved != 1 {
		t.Fatalf("Moved=%d, want 1", r.Moved)
	}
	if !pathExists(filepath.Join(tgt, "weird_cat_name", "x.yaml")) {
		t.Errorf("应清洗成 weird_cat_name/")
	}
}

// 错误参数.
func TestApplyCategories_BadInput(t *testing.T) {
	a := &App{}
	if _, err := a.ApplyTemplateCategories(ApplyCategoriesRequest{}); err == nil {
		t.Error("空 TargetDir 应报错")
	}
	if _, err := a.ApplyTemplateCategories(ApplyCategoriesRequest{TargetDir: "/tmp/x"}); err == nil {
		t.Error("空 Assignments 应报错")
	}
	if _, err := a.ApplyTemplateCategories(ApplyCategoriesRequest{
		TargetDir:   "/tmp/x",
		Assignments: []CategoryAssignment{{Name: "a", Paths: []string{"/nope"}}},
		OnConflict:  "explode",
	}); err == nil {
		t.Error("非法 OnConflict 应报错")
	}
}

// 单分类内 batch 撞名 (两个不同源同 basename)
func TestApplyCategories_BatchInternalConflict(t *testing.T) {
	srcA := t.TempDir()
	srcB := t.TempDir()
	tgt := t.TempDir()
	p1 := writeTplCls(t, srcA, "adobe.yaml", "adobe-1")
	p2 := writeTplCls(t, srcB, "adobe.yaml", "adobe-2")

	a := &App{}
	r, err := a.ApplyTemplateCategories(ApplyCategoriesRequest{
		TargetDir: tgt,
		Assignments: []CategoryAssignment{
			{Name: "adobe", Paths: []string{p1, p2}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Moved != 2 {
		t.Errorf("Moved=%d, want 2", r.Moved)
	}
	// 一个 adobe.yaml + 一个 adobe_dup_1.yaml
	have := []string{}
	ents, _ := os.ReadDir(filepath.Join(tgt, "adobe"))
	for _, e := range ents {
		have = append(have, e.Name())
	}
	sort.Strings(have)
	want := []string{"adobe.yaml", "adobe_dup_1.yaml"}
	sort.Strings(want)
	if strings.Join(have, ",") != strings.Join(want, ",") {
		t.Errorf("文件列表应是 %v, 实际 %v", want, have)
	}
}
