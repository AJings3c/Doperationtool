package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestPreviewDirImportSupportsNativeAndPlainPaths(t *testing.T) {
	source := t.TempDir()
	writeTestFile(t, filepath.Join(source, "dir.yaml"), "Alpha:\n  - /alpha/login\n  - /alpha/login\n")
	writeTestFile(t, filepath.Join(source, "Beta.txt"), "/beta/login\nnot-a-path\n/api/beta/status\n")
	writeTestFile(t, filepath.Join(source, "paths.txt"), "/orphan\n")

	res, err := NewApp().PreviewDirImport("", source)
	if err != nil {
		t.Fatalf("PreviewDirImport returned error: %v", err)
	}
	if res.ProductCount != 2 || res.PathCount != 3 || res.DuplicatePathCount != 0 {
		t.Fatalf("dir preview stats = products %d paths %d dup %d, items=%#v", res.ProductCount, res.PathCount, res.DuplicatePathCount, res.Items)
	}
	if !strings.Contains(res.DirYaml, "Alpha:") || !strings.Contains(res.DirYaml, "/alpha/login") || !strings.Contains(res.DirYaml, "Beta:") || !strings.Contains(res.DirYaml, "/api/beta/status") {
		t.Fatalf("dir yaml missing expected entries:\n%s", res.DirYaml)
	}
	if len(res.Skipped) != 1 || !strings.Contains(res.Skipped[0].Reason, "无法归属") {
		t.Fatalf("expected orphan paths to be skipped for manual review: %#v", res.Skipped)
	}
}
