package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ============== classifyOneFile ==============

func TestClassifyOneFile(t *testing.T) {
	cases := []struct {
		name, id   string
		wantBucket string
		wantKind   string
		desc       string
	}{
		// 产品桶 (优先级最高)
		{"wordpress-plugin-rce.yaml", "", "wordpress", "product", "kebab"},
		{"WP-XSS.yaml", "", "wordpress", "product", "wp 别名"},
		{"apache-druid-rce.yaml", "apache-druid-cve-2021-25646", "apache", "product", "filename 命中"},
		{"struts2-s2-001.yaml", "", "struts", "product", "struts2 别名"},
		{"k8s-secret-leak.yaml", "", "kubernetes", "product", "k8s 别名"},
		{"thinkphp_5x_rce.yaml", "", "thinkphp", "product", "snake case"},
		{"VMware-vCenter-CVE-2021.yaml", "", "vmware", "product", "首个 token 命中"},
		{"hikvision-camera-rce.yaml", "", "hikvision", "product", "海康 IPC"},
		{"dahua-dvr-auth-bypass.yaml", "", "dahua", "product", "大华 DVR"},
		{"uniview-nvr-cve.yaml", "", "uniview", "product", "宇视 NVR"},

		// 漏洞编号桶 (无产品命中时)
		{"CVE-2021-44228.yaml", "", "CVE-2021", "vuln-id", "cve 带年份"},
		{"cnvd-2020-12345.yaml", "", "CNVD-2020", "vuln-id", "cnvd 带年份"},
		{"ghsa-9wq6-cv6m-x44h.yaml", "", "GHSA", "vuln-id", "ghsa 无年份 (后接非数字)"},
		{"cve-no-year.yaml", "", "CVE", "vuln-id", "cve 后非数字"},

		// 优先级: 产品 > 编号. 即使有 cve token, 产品命中应胜出.
		{"wordpress-cve-2021-1234.yaml", "", "wordpress", "product", "产品 + cve 共存优先产品"},

		// id 字段 fallback
		{"random-name-xx.yaml", "wordpress-plugin-leak", "wordpress", "product", "filename 没产品, id 有"},
		{"random-name-xx.yaml", "cve-2022-0001", "CVE-2022", "vuln-id", "filename 普通 + id 是 cve"},

		// token-anchor fallback (取首个 ≥3 字符 token, 'my' 太短被跳)
		{"my-custom-test.yaml", "", "custom", "token", "都非产品非编号, 跳 'my' (<3)"},
		{"unknown.yaml", "", "unknown", "token", "单 token"},

		// uncategorized
		{"a.yaml", "", "", "uncategorized", "全部 < 2 字符 / 没 token"},
		{"01-02.yaml", "", "", "uncategorized", "全数字"},
	}

	for _, c := range cases {
		gotB, gotK := classifyOneFile(c.name, c.id)
		if gotB != c.wantBucket || gotK != c.wantKind {
			t.Errorf("[%s] classifyOneFile(%q, %q) = (%q,%q), want (%q,%q)",
				c.desc, c.name, c.id, gotB, gotK, c.wantBucket, c.wantKind)
		}
	}
}

// ============== ScanYamlCollection ==============

func TestScanYamlCollection_BasicMix(t *testing.T) {
	dir := t.TempDir()
	files := map[string]string{
		"wordpress-plugin-1.yaml": "id: wordpress-plugin-1\ninfo:\n  name: x\n",
		"wp-xss.yaml":             "id: wp-xss\n",
		"CVE-2021-44228.yaml":     "id: CVE-2021-44228\n",
		"cve-2021-23017.yaml":     "id: cve-2021-23017\n",
		"cnvd-2020-12345.yaml":    "id: cnvd-2020-12345\n",
		"my-custom-detect.yaml":   "id: my-custom-detect\n",
		"a.yml":                   "", // 太短 → uncategorized
		"README.md":               "应当被忽略",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	app := &App{}
	res, err := app.ScanYamlCollection(dir)
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 7 {
		t.Errorf("Total=%d want 7 (8 - 1 .md)", res.Total)
	}

	// wordpress 桶应有 2 个 (wordpress-plugin-1, wp-xss 别名)
	wp := findGroup(res.Groups, "wordpress")
	if wp == nil || len(wp.Files) != 2 {
		t.Errorf("wordpress 桶: got=%v, want 2 文件", wp)
	}
	if wp != nil && wp.Kind != "product" {
		t.Errorf("wordpress.Kind=%q want product", wp.Kind)
	}

	// CVE-2021 桶: 2 文件
	cve := findGroup(res.Groups, "CVE-2021")
	if cve == nil || len(cve.Files) != 2 {
		t.Errorf("CVE-2021 桶: got=%v want 2 文件", cve)
	}

	// CNVD-2020 桶: 1 文件
	cnvd := findGroup(res.Groups, "CNVD-2020")
	if cnvd == nil || len(cnvd.Files) != 1 {
		t.Errorf("CNVD-2020 桶: got=%v want 1 文件", cnvd)
	}

	// custom 桶 (token kind, 因 'my' < 3 被跳, 取首个 ≥3 字符 token) 1 文件
	custom := findGroup(res.Groups, "custom")
	if custom == nil || custom.Kind != "token" {
		t.Errorf("custom 桶 (token kind) 缺失 / kind 错: %v", custom)
	}

	// uncategorized: a.yml (太短)
	if len(res.Uncategorized) != 1 || !strings.HasSuffix(res.Uncategorized[0].Name, "a.yml") {
		t.Errorf("Uncategorized: %v want 1 个 a.yml", res.Uncategorized)
	}

	// 排序: product 在前
	if len(res.Groups) >= 2 && res.Groups[0].Kind != "product" {
		t.Errorf("Groups[0].Kind=%q want product (排序错)", res.Groups[0].Kind)
	}
}

func findGroup(groups []CollectGroup, name string) *CollectGroup {
	for i := range groups {
		if groups[i].Name == name {
			return &groups[i]
		}
	}
	return nil
}

// ============== ApplyYamlCollection ==============
// 逻辑跟 classify 共用 applyAssignmentsInternal, 已被 nucleiclassify_test 覆盖到核心
// 行为. 这里只跑一个 smoke test 确认 wails event 名变了不会回归.

func TestApplyYamlCollection_Smoke(t *testing.T) {
	src := t.TempDir()
	tgt := t.TempDir()
	srcFile := filepath.Join(src, "wordpress-rce.yaml")
	if err := os.WriteFile(srcFile, []byte("id: wp-x\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	res, err := app.ApplyYamlCollection(ApplyCategoriesRequest{
		TargetDir: tgt,
		Assignments: []CategoryAssignment{
			{Name: "wordpress", Paths: []string{srcFile}},
		},
		DryRun: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Moved != 1 {
		t.Errorf("Moved=%d want 1", res.Moved)
	}
	want := filepath.Join(tgt, "wordpress", "wordpress-rce.yaml")
	if _, err := os.Stat(want); err != nil {
		t.Errorf("expected file at %s, stat err: %v", want, err)
	}
}
