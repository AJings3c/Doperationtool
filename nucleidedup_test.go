package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// ============== canonicalNameKey ==============

func TestCanonicalNameKey(t *testing.T) {
	cases := []struct{ in, want string }{
		// 基础: 剥扩展 + 小写
		{"CVE-2018-18326.yaml", "cve-2018-18326"},
		{"cve-2018-18326.yml", "cve-2018-18326"},
		{"Foo.YAML", "foo"},

		// (copy) / (copy N) 后缀
		{"CVE-2018-18326 (copy).yaml", "cve-2018-18326"},
		{"CVE-2018-18326 (copy 1).yaml", "cve-2018-18326"},
		{"CVE-2018-18326 (copy 12).yaml", "cve-2018-18326"},

		// _数字 后缀
		{"joomla-version_1.yaml", "joomla-version"},
		{"joomla-version_99.yaml", "joomla-version"},
		{"joomla-version.yaml", "joomla-version"},

		// 关键: cve 编号的 -数字 部分不应该被剥, 否则两个不同 cve 错合一组
		{"cve-2021-24997-5780_1.yaml", "cve-2021-24997-5780"},
		{"cve-2021-24997-5781_1.yaml", "cve-2021-24997-5781"},

		// 叠加后缀: 既有 (copy) 又有 _N
		{"foo (copy 1)_2.yaml", "foo"},
		{"foo_2 (copy).yaml", "foo"},

		// 空 / 边界
		{"", ""},
		{".yaml", ""},
		{"_1.yaml", ""},
	}
	for _, c := range cases {
		if got := canonicalNameKey(c.in); got != c.want {
			t.Errorf("canonicalNameKey(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// ============== ScanDuplicateTemplates ==============

// helper: 在 dir 写一个 yaml. id 为 "" 时不写 id 行 (模拟没 id 的模板).
func writeTpl(t *testing.T, dir, name, id string) string {
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

// 三种基础场景: 同 id / 同 nameKey / 同 id+nameKey.
func TestScanDuplicates_BasicGrouping(t *testing.T) {
	dir := t.TempDir()
	// 组 A: 同 id, 名字不同
	writeTpl(t, dir, "a1.yaml", "shared-id-a")
	writeTpl(t, dir, "a2.yaml", "shared-id-a")
	// 组 B: 名字不同, id 不同, 但 canonical 名相同 (copy 后缀)
	writeTpl(t, dir, "b.yaml", "id-b1")
	writeTpl(t, dir, "b (copy 1).yaml", "id-b2")
	// 组 C: id 和 nameKey 都共享
	writeTpl(t, dir, "c.yaml", "shared-id-c")
	writeTpl(t, dir, "c_1.yaml", "shared-id-c")
	// 不重复: 单独存在的两个文件
	writeTpl(t, dir, "lonely1.yaml", "lonely-id-1")
	writeTpl(t, dir, "lonely2.yaml", "lonely-id-2")

	a := &App{}
	r, err := a.ScanDuplicateTemplates(dir)
	if err != nil {
		t.Fatal(err)
	}
	if r.Total != 8 {
		t.Errorf("Total = %d, want 8", r.Total)
	}
	if len(r.Groups) != 3 {
		t.Fatalf("应找到 3 个重复组, 实际 %d: %+v", len(r.Groups), r.Groups)
	}
	if r.DuplicateCount != 3 {
		t.Errorf("DuplicateCount = %d, want 3 (3 组每组 keep-first 移走 1 个)", r.DuplicateCount)
	}
	// 找每组确认 reason
	reasonByKey := map[string]string{} // groupKey -> reason
	for _, g := range r.Groups {
		reasonByKey[g.GroupKey] = g.Reason
	}
	if reasonByKey["shared-id-a"] != "id" {
		t.Errorf("a 组 reason 应为 id, 实际 %q", reasonByKey["shared-id-a"])
	}
	if reasonByKey["id-b1"] != "name" && reasonByKey["b"] != "name" {
		// groupKey 实际取 ids[0] 即 "id-b1"; reason 应该是 name (id 不同, nameKey 同)
		t.Errorf("b 组 reason 应为 name, 整组: %+v", r.Groups)
	}
	if reasonByKey["shared-id-c"] != "id+name" {
		t.Errorf("c 组 reason 应为 id+name, 实际 %q", reasonByKey["shared-id-c"])
	}
}

// 传递性: A↔B 通过 id, B↔C 通过 nameKey, A 跟 C 应在同一组.
func TestScanDuplicates_TransitiveUnion(t *testing.T) {
	dir := t.TempDir()
	writeTpl(t, dir, "alpha.yaml", "id-X")
	writeTpl(t, dir, "alpha (copy).yaml", "id-Y")  // 跟 alpha 同 nameKey ("alpha"), id 不同
	writeTpl(t, dir, "beta.yaml", "id-Y")          // 跟 alpha (copy) 同 id ("id-Y"), nameKey 不同

	a := &App{}
	r, err := a.ScanDuplicateTemplates(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Groups) != 1 {
		t.Fatalf("应聚成 1 组, 实际 %d: %+v", len(r.Groups), r.Groups)
	}
	g := r.Groups[0]
	if len(g.Templates) != 3 {
		t.Errorf("组内应 3 个文件, 实际 %d", len(g.Templates))
	}
	if g.Reason != "transitive" {
		t.Errorf("Reason 应为 transitive (id 多样 + nameKey 多样), 实际 %q", g.Reason)
	}
	// 数据完整性: 出现的 id / nameKey 都得列出
	if !sliceEqual(g.SharedIds, []string{"id-X", "id-Y"}) {
		t.Errorf("SharedIds = %v, want [id-X id-Y]", g.SharedIds)
	}
	if !sliceEqual(g.SharedNames, []string{"alpha", "beta"}) {
		t.Errorf("SharedNames = %v, want [alpha beta]", g.SharedNames)
	}
}

// 没 id 的模板靠 nameKey 也能分组 (例如截图里那种 severity 都缺的脏模板)
func TestScanDuplicates_NoIdGroupedByName(t *testing.T) {
	dir := t.TempDir()
	writeTpl(t, dir, "x.yaml", "")        // 无 id
	writeTpl(t, dir, "x (copy).yaml", "") // 无 id, 但 nameKey 同
	writeTpl(t, dir, "y.yaml", "")        // 无 id, nameKey 不同, 单飞

	a := &App{}
	r, err := a.ScanDuplicateTemplates(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Groups) != 1 || len(r.Groups[0].Templates) != 2 {
		t.Fatalf("无 id 但同 nameKey 应聚 1 组 2 文件, 实际: %+v", r.Groups)
	}
	if r.Groups[0].Reason != "name" {
		t.Errorf("Reason 应为 name, 实际 %q", r.Groups[0].Reason)
	}
}

// 无 id + 无可用 nameKey: 既不同名也不同 id, 全部独立.
func TestScanDuplicates_NoFalsePositives(t *testing.T) {
	dir := t.TempDir()
	writeTpl(t, dir, "alpha.yaml", "id-1")
	writeTpl(t, dir, "beta.yaml", "id-2")
	writeTpl(t, dir, "gamma.yaml", "id-3")

	a := &App{}
	r, err := a.ScanDuplicateTemplates(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Groups) != 0 {
		t.Errorf("不应有任何组, 实际: %+v", r.Groups)
	}
	if r.DuplicateCount != 0 {
		t.Errorf("DuplicateCount = %d, want 0", r.DuplicateCount)
	}
}

// 空目录 / 非目录的边界.
func TestScanDuplicates_BadInput(t *testing.T) {
	a := &App{}
	if _, err := a.ScanDuplicateTemplates(""); err == nil {
		t.Error("空目录应报错")
	}
	if _, err := a.ScanDuplicateTemplates("/nonexistent_dir_for_test_xyz"); err == nil {
		t.Error("不存在的目录应报错")
	}
	// 把一个文件当目录传入
	tmp := t.TempDir()
	f := filepath.Join(tmp, "a.yaml")
	os.WriteFile(f, []byte("id: x"), 0o644)
	if _, err := a.ScanDuplicateTemplates(f); err == nil {
		t.Error("传入文件路径应报错")
	}
}

// 子目录跳过策略对齐 autofix: .git / node_modules 等不扫.
func TestScanDuplicates_SkipsHiddenAndVendorDirs(t *testing.T) {
	dir := t.TempDir()
	writeTpl(t, dir, "a.yaml", "shared")
	writeTpl(t, dir, ".git/a.yaml", "shared") // 应被跳过
	writeTpl(t, dir, "node_modules/a.yaml", "shared")
	writeTpl(t, dir, "sub/a.yaml", "shared") // 普通子目录应被扫
	a := &App{}
	r, err := a.ScanDuplicateTemplates(dir)
	if err != nil {
		t.Fatal(err)
	}
	// 应只看到 dir/a.yaml + dir/sub/a.yaml = 2 个, 重复
	if r.Total != 2 {
		t.Errorf("Total = %d, want 2 (.git / node_modules 应跳过)", r.Total)
	}
	if len(r.Groups) != 1 || len(r.Groups[0].Templates) != 2 {
		t.Fatalf("应有 1 组 2 文件, 实际: %+v", r.Groups)
	}
}

// ============== MoveTemplateDuplicates ==============

func TestMoveDuplicates_BasicRename(t *testing.T) {
	src := t.TempDir()
	tgt := t.TempDir()
	p1 := writeTpl(t, src, "a.yaml", "id-1")
	p2 := writeTpl(t, src, "b.yaml", "id-2")
	// 在 tgt 已经放一个同名 a.yaml, 触发 rename
	writeTpl(t, tgt, "a.yaml", "preexisting")

	a := &App{}
	r, err := a.MoveTemplateDuplicates(MoveDuplicatesRequest{
		Paths:     []string{p1, p2},
		TargetDir: tgt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Moved != 2 || r.Skipped != 0 {
		t.Fatalf("Moved=%d Skipped=%d, want 2/0; items=%+v", r.Moved, r.Skipped, r.Items)
	}
	// 源应不存在 (已搬走)
	if pathExists(p1) || pathExists(p2) {
		t.Error("源文件应已搬走")
	}
	// 目标 a_dup_1.yaml 应存在
	expected := filepath.Join(tgt, "a_dup_1.yaml")
	if !pathExists(expected) {
		t.Errorf("a_dup_1.yaml 应已生成: %s", expected)
	}
	if !pathExists(filepath.Join(tgt, "b.yaml")) {
		t.Error("b.yaml 应直接移过来 (无冲突)")
	}
	// 原本 a.yaml 不应被覆盖
	pre, _ := os.ReadFile(filepath.Join(tgt, "a.yaml"))
	if !strings.Contains(string(pre), "preexisting") {
		t.Error("已存在的 a.yaml 被覆盖了, 不应该")
	}
}

func TestMoveDuplicates_DryRun(t *testing.T) {
	src := t.TempDir()
	tgt := t.TempDir()
	p1 := writeTpl(t, src, "a.yaml", "id-1")
	a := &App{}
	r, err := a.MoveTemplateDuplicates(MoveDuplicatesRequest{
		Paths:     []string{p1},
		TargetDir: tgt,
		DryRun:    true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Moved != 1 || r.Skipped != 0 {
		t.Errorf("DryRun 应汇报 1 个 Moved, 实际 Moved=%d Skipped=%d", r.Moved, r.Skipped)
	}
	if !pathExists(p1) {
		t.Error("DryRun 不应实际搬动文件")
	}
	if pathExists(filepath.Join(tgt, "a.yaml")) {
		t.Error("DryRun 不应在目标目录创建文件")
	}
}

func TestMoveDuplicates_OnConflict_Skip(t *testing.T) {
	src := t.TempDir()
	tgt := t.TempDir()
	p1 := writeTpl(t, src, "a.yaml", "id-1")
	writeTpl(t, tgt, "a.yaml", "preexisting")
	a := &App{}
	r, err := a.MoveTemplateDuplicates(MoveDuplicatesRequest{
		Paths:      []string{p1},
		TargetDir:  tgt,
		OnConflict: "skip",
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Moved != 0 || r.Skipped != 1 {
		t.Errorf("Moved=%d Skipped=%d, want 0/1", r.Moved, r.Skipped)
	}
	if !pathExists(p1) {
		t.Error("skip 策略下源应保留原地")
	}
}

func TestMoveDuplicates_OnConflict_Overwrite(t *testing.T) {
	src := t.TempDir()
	tgt := t.TempDir()
	p1 := writeTpl(t, src, "a.yaml", "id-1")
	writeTpl(t, tgt, "a.yaml", "preexisting")
	a := &App{}
	r, err := a.MoveTemplateDuplicates(MoveDuplicatesRequest{
		Paths:      []string{p1},
		TargetDir:  tgt,
		OnConflict: "overwrite",
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Moved != 1 {
		t.Errorf("Moved = %d, want 1", r.Moved)
	}
	raw, _ := os.ReadFile(filepath.Join(tgt, "a.yaml"))
	if !strings.Contains(string(raw), "id: id-1") {
		t.Errorf("overwrite 后内容应是新的, 实际: %s", raw)
	}
	if pathExists(p1) {
		t.Error("overwrite 后源应已删除")
	}
}

// 自动建目标目录: target 不存在时应 mkdir -p.
func TestMoveDuplicates_AutoMkdirTarget(t *testing.T) {
	src := t.TempDir()
	p1 := writeTpl(t, src, "a.yaml", "id-1")
	tgtRoot := t.TempDir()
	tgt := filepath.Join(tgtRoot, "deep", "nested", "trash")
	a := &App{}
	r, err := a.MoveTemplateDuplicates(MoveDuplicatesRequest{
		Paths:     []string{p1},
		TargetDir: tgt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Moved != 1 {
		t.Errorf("Moved = %d, want 1", r.Moved)
	}
	if !pathExists(filepath.Join(tgt, "a.yaml")) {
		t.Error("a.yaml 应被搬到自动创建的 target")
	}
}

// 同一批 paths 连续撞同名: 第二个文件名跟第一个同, 应自动 _dup_1 / _dup_2 ...
func TestMoveDuplicates_BatchInternalConflict(t *testing.T) {
	srcA := t.TempDir()
	srcB := t.TempDir()
	tgt := t.TempDir()
	p1 := writeTpl(t, srcA, "a.yaml", "id-1")
	p2 := writeTpl(t, srcB, "a.yaml", "id-2") // basename 跟 p1 一样, 但在不同源目录
	a := &App{}
	r, err := a.MoveTemplateDuplicates(MoveDuplicatesRequest{
		Paths:     []string{p1, p2},
		TargetDir: tgt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Moved != 2 {
		t.Fatalf("Moved=%d, want 2 (内部撞名应被 rename 自动避让)", r.Moved)
	}
	// 应该一个是 a.yaml, 另一个是 a_dup_1.yaml
	if !pathExists(filepath.Join(tgt, "a.yaml")) || !pathExists(filepath.Join(tgt, "a_dup_1.yaml")) {
		var have []string
		ents, _ := os.ReadDir(tgt)
		for _, e := range ents {
			have = append(have, e.Name())
		}
		t.Errorf("应有 a.yaml 和 a_dup_1.yaml, 实际: %v", have)
	}
}

// 防自旋: 源文件已经在目标目录, 应 skip 不动.
func TestMoveDuplicates_SkipsIfAlreadyInTarget(t *testing.T) {
	tgt := t.TempDir()
	p := writeTpl(t, tgt, "a.yaml", "id-1")
	a := &App{}
	r, err := a.MoveTemplateDuplicates(MoveDuplicatesRequest{
		Paths:     []string{p},
		TargetDir: tgt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Moved != 0 || r.Skipped != 1 {
		t.Errorf("Moved=%d Skipped=%d, want 0/1", r.Moved, r.Skipped)
	}
	if !pathExists(p) {
		t.Error("源已在目标目录时不应被动")
	}
}

// 错误参数.
func TestMoveDuplicates_BadInput(t *testing.T) {
	a := &App{}
	if _, err := a.MoveTemplateDuplicates(MoveDuplicatesRequest{}); err == nil {
		t.Error("空目标目录应报错")
	}
	if _, err := a.MoveTemplateDuplicates(MoveDuplicatesRequest{TargetDir: "/tmp/x"}); err == nil {
		t.Error("空 paths 应报错")
	}
	if _, err := a.MoveTemplateDuplicates(MoveDuplicatesRequest{
		TargetDir:  "/tmp/x",
		Paths:      []string{"/nope"},
		OnConflict: "explode",
	}); err == nil {
		t.Error("非法 OnConflict 应报错")
	}
}

// ============== 工具 ==============

func sliceEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	aa := append([]string{}, a...)
	bb := append([]string{}, b...)
	sort.Strings(aa)
	sort.Strings(bb)
	for i := range aa {
		if aa[i] != bb[i] {
			return false
		}
	}
	return true
}
