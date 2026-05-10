package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// Awesome-POC 类目录里有大量 png/jpg, 之前 POC 转换页用 LoadDirectory(folder, true)
// 会把所有二进制都读进内存, 撑爆 wails IPC 桥导致 "打开失败".
// LoadMarkdownDirectory 必须在 walk 阶段就按后缀过滤, 不读 png/jpg 内容.
func TestLoadMarkdownDirectory_SkipsBinaries(t *testing.T) {
	tmp := t.TempDir()
	mustWrite := func(rel, body string) {
		full := filepath.Join(tmp, rel)
		_ = os.MkdirAll(filepath.Dir(full), 0o755)
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite("a.md", "# A")
	mustWrite("sub/b.md", "# B")
	mustWrite("sub/c.markdown", "# C")
	// 一个 1MB 的伪 png, 如果被读进来 fingerprint 会泄漏到结果里
	bigPng := make([]byte, 1<<20)
	copy(bigPng, []byte("\x89PNG\r\n\x1a\nFAKE_PNG_DO_NOT_LOAD"))
	if err := os.WriteFile(filepath.Join(tmp, "sub/x.png"), bigPng, 0o644); err != nil {
		t.Fatal(err)
	}
	mustWrite("sub/y.jpg", "fake jpg bytes")
	mustWrite("README.txt", "should be filtered out")

	a := &App{}
	r, err := a.LoadMarkdownDirectory(tmp)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Files) != 3 {
		t.Errorf("应只加载 3 个 md (a.md / sub/b.md / sub/c.markdown), 实际 %d", len(r.Files))
		for _, f := range r.Files {
			t.Logf("  got: %s", f.RelPath)
		}
	}
	for _, f := range r.Files {
		ext := filepath.Ext(f.Name)
		if ext != ".md" && ext != ".markdown" {
			t.Errorf("非 md 文件混进来了: %s", f.RelPath)
		}
		// png 内容不能出现在任何文件 content 里
		if len(f.Content) > 100 && string(f.Content[:8]) == "\x89PNG\r\n\x1a\n" {
			t.Errorf("%s 居然包含 png 字节!", f.RelPath)
		}
	}
}

// LoadDirectory(folder, false) 旧路径不受影响: 只读 yaml/yml.
func TestLoadDirectory_YamlOnly_StillWorks(t *testing.T) {
	tmp := t.TempDir()
	_ = os.WriteFile(filepath.Join(tmp, "a.yaml"), []byte("id: a"), 0o644)
	_ = os.WriteFile(filepath.Join(tmp, "b.yml"), []byte("id: b"), 0o644)
	_ = os.WriteFile(filepath.Join(tmp, "c.md"), []byte("# c"), 0o644)
	a := &App{}
	r, err := a.LoadDirectory(tmp, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Files) != 2 {
		t.Errorf("只该读 .yaml/.yml 共 2 个, 实际 %d", len(r.Files))
	}
}

// LoadMarkdownDirectory 必须跳过 README / LICENSE 等项目元数据 md.
// Awesome-POC 那种仓库根目录有 68KB README.md 既不是 PoC 又会污染结果.
func TestLoadMarkdownDirectory_SkipsProjectMeta(t *testing.T) {
	tmp := t.TempDir()
	mustWrite := func(rel, body string) {
		full := filepath.Join(tmp, rel)
		_ = os.MkdirAll(filepath.Dir(full), 0o755)
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// 这些应当被跳过
	mustWrite("README.md", "# repo readme")
	mustWrite("readme.md", "lower-case readme") // 即便子目录里, 也跳
	mustWrite("LICENSE.md", "MIT")
	mustWrite("CONTRIBUTING.md", "guidelines")
	mustWrite("CHANGELOG.md", "v1")
	mustWrite("CODE_OF_CONDUCT.md", "be nice")
	mustWrite("sub/Readme.md", "sub readme") // 子目录的也跳, 大小写不敏感
	// 这些应当保留 (含 readme 子串但不是元数据)
	mustWrite("readme-attack-chain.md", "# 真 PoC 名字撞 readme")
	mustWrite("real-vuln.md", "# 真 PoC")
	mustWrite("sub/cve-2024-0001.md", "# CVE")

	a := &App{}
	r, err := a.LoadMarkdownDirectory(tmp)
	if err != nil {
		t.Fatal(err)
	}
	gotNames := map[string]bool{}
	for _, f := range r.Files {
		gotNames[f.Name] = true
	}
	if len(r.Files) != 3 {
		t.Errorf("应留 3 个 md, 实际 %d: %v", len(r.Files), gotNames)
	}
	for _, banned := range []string{"README.md", "readme.md", "LICENSE.md", "CONTRIBUTING.md", "CHANGELOG.md", "CODE_OF_CONDUCT.md", "Readme.md"} {
		if gotNames[banned] {
			t.Errorf("不该出现: %s", banned)
		}
	}
	for _, ok := range []string{"readme-attack-chain.md", "real-vuln.md", "cve-2024-0001.md"} {
		if !gotNames[ok] {
			t.Errorf("漏掉了: %s", ok)
		}
	}
}

// 验证 Reveal/Open 的命令构造跨平台 (实际 Start 不在 CI 里跑).
// 这层是只跨 GOOS 才出错的薄包装, 给个表驱动单测确保参数排列没漂.
func TestBuildRevealCmd(t *testing.T) {
	if runtime.GOOS == "darwin" {
		// 文件 → open -R <path>
		c, err := buildRevealCmd("/tmp/x.md", false)
		if err != nil {
			t.Fatal(err)
		}
		if got := c.Args; len(got) != 3 || got[0] != "open" || got[1] != "-R" || got[2] != "/tmp/x.md" {
			t.Errorf("darwin 文件 reveal 参数不对: %v", got)
		}
		// 目录 → open <path>
		c2, err := buildRevealCmd("/tmp/sub", true)
		if err != nil {
			t.Fatal(err)
		}
		if got := c2.Args; len(got) != 2 || got[0] != "open" || got[1] != "/tmp/sub" {
			t.Errorf("darwin 目录 reveal 参数不对: %v", got)
		}
	}
	// linux / windows 在 darwin CI 上不会跑 build, 跳过 (跨编译能 cover)
}

func TestBuildOpenCmd(t *testing.T) {
	if runtime.GOOS == "darwin" {
		c, err := buildOpenCmd("/tmp/x.md")
		if err != nil {
			t.Fatal(err)
		}
		if got := c.Args; len(got) != 2 || got[0] != "open" || got[1] != "/tmp/x.md" {
			t.Errorf("darwin open 参数不对: %v", got)
		}
	}
}

// DeletePath: 删文件 / 删目录 / 拒绝过短路径.
func TestDeletePath(t *testing.T) {
	tmp := t.TempDir()
	a := &App{}

	// 删单文件
	f := filepath.Join(tmp, "a.txt")
	if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := a.DeletePath(f); err != nil {
		t.Fatalf("删文件失败: %v", err)
	}
	if _, err := os.Stat(f); !os.IsNotExist(err) {
		t.Errorf("文件应已不存在: %v", err)
	}

	// 递归删目录 (含子文件)
	d := filepath.Join(tmp, "sub")
	_ = os.MkdirAll(filepath.Join(d, "deep"), 0o755)
	_ = os.WriteFile(filepath.Join(d, "x.md"), []byte("md"), 0o644)
	_ = os.WriteFile(filepath.Join(d, "deep", "y.md"), []byte("y"), 0o644)
	if err := a.DeletePath(d); err != nil {
		t.Fatalf("删目录失败: %v", err)
	}
	if _, err := os.Stat(d); !os.IsNotExist(err) {
		t.Errorf("目录应已不存在: %v", err)
	}

	// 拒绝过短路径
	if err := a.DeletePath("/"); err == nil {
		t.Error("应当拒绝删 /")
	}
	if err := a.DeletePath(""); err == nil {
		t.Error("应当拒绝空路径")
	}
	// 不存在路径返回错
	if err := a.DeletePath(filepath.Join(tmp, "nonexistent")); err == nil {
		t.Error("应当对不存在的路径报错")
	}
}

// 并行读不应破坏顺序 (输出按 RelPath 排序), 也不应丢内容.
// 写 200 个 md 各带不同 marker, 加载回来后逐一对比.
func TestLoadMarkdownDirectory_Concurrent_PreservesContent(t *testing.T) {
	tmp := t.TempDir()
	const n = 200
	for i := 0; i < n; i++ {
		body := fmt.Sprintf("MARKER_%05d", i)
		_ = os.WriteFile(filepath.Join(tmp, fmt.Sprintf("%05d.md", i)), []byte(body), 0o644)
	}
	a := &App{}
	r, err := a.LoadMarkdownDirectory(tmp)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Files) != n {
		t.Fatalf("want %d files, got %d", n, len(r.Files))
	}
	for i, f := range r.Files {
		want := fmt.Sprintf("MARKER_%05d", i)
		if f.Content != want {
			t.Errorf("idx %d: 内容串了, want %q got %q (rel=%s)", i, want, f.Content, f.RelPath)
			break
		}
	}
}
