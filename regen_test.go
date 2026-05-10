package main

import (
	"os"
	"strings"
	"testing"
)

// 一次性: 把 wpoc 整个目录重新转一遍, 写到 test2/ 覆盖旧文件.
// 跑法: REGEN=1 go test -run TestRegenAllYAML -v
// 跑完用户拿 `nuclei -validate -t /Users/ki10Moc/readteam/AI/Scan/poc/POC/test2/` 验证.
// 平时被 REGEN 门禁挡住, 不会污染 CI.
func TestRegenAllYAML(t *testing.T) {
	if os.Getenv("REGEN") == "" {
		t.Skip("set REGEN=1 to enable (writes to disk)")
	}
	src := "/Users/ki10Moc/readteam/AI/Scan/poc/POC/wpoc"
	dst := "/Users/ki10Moc/readteam/AI/Scan/poc/POC/test2"
	if _, err := os.Stat(src); err != nil {
		t.Skip(err)
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		t.Fatal(err)
	}
	a := &App{}
	out, err := a.ConvertMarkdownFolder(src)
	if err != nil {
		t.Fatal(err)
	}
	// 直接走 SaveYamlBatch 复用其同名去重逻辑, 避免与生产路径行为漂移
	files := make([]YamlOutFile, 0, len(out.Results))
	for _, r := range out.Results {
		name := r.Suggested
		if name == "" {
			name = r.Id
		}
		files = append(files, YamlOutFile{Name: name, Content: r.Yaml})
	}
	r, err := a.SaveYamlBatch(dst, files)
	if err != nil {
		t.Fatal(err)
	}
	// 数原始名字里的重复, 用来证明 dedup 逻辑确实生效了
	seen := map[string]int{}
	collide := 0
	for _, f := range files {
		seen[strings.ToLower(f.Name)]++
		if seen[strings.ToLower(f.Name)] > 1 {
			collide++
		}
	}
	t.Logf("wrote=%d / input=%d (renamed=%d, skip-content=%d, skip-payload=%d, 输入侧名重复=%d)",
		r.Written, len(files), r.Renamed, r.SkippedDupContent, r.SkippedDupPayload, collide)
}
