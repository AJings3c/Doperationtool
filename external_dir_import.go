package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type DirImportPreviewResult struct {
	SourceDir          string                  `json:"sourceDir"`
	ProjectRoot        string                  `json:"projectRoot"`
	TargetDirPath      string                  `json:"targetDirPath"`
	ScannedFiles       int                     `json:"scannedFiles"`
	ParsedFiles        int                     `json:"parsedFiles"`
	SkippedFiles       int                     `json:"skippedFiles"`
	ProductCount       int                     `json:"productCount"`
	PathCount          int                     `json:"pathCount"`
	DuplicatePathCount int                     `json:"duplicatePathCount"`
	Items              []dirEntryView          `json:"items"`
	Skipped            []FingerprintImportSkip `json:"skipped"`
	DirYaml            string                  `json:"dirYaml"`
	Elapsed            string                  `json:"elapsed"`
}

var rePlainPathLine = regexp.MustCompile(`^/(?:[A-Za-z0-9._~!$&'()*+,;=:@%-]+/?)+$`)

func (a *App) PreviewDirImport(projectRoot, sourceDir string) (*DirImportPreviewResult, error) {
	source := strings.TrimSpace(sourceDir)
	if source == "" {
		return nil, fmt.Errorf("外部接口/路径目录为空")
	}
	info, err := os.Stat(source)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("外部接口/路径来源必须是目录")
	}
	start := time.Now()
	ctx, pe, cleanup := a.beginTask("fingerprint:external_dir_import:progress", "scanning", 0)
	defer cleanup()
	defer pe.finish("接口路径预览完成")
	res := &DirImportPreviewResult{
		SourceDir:     source,
		ProjectRoot:   strings.TrimSpace(projectRoot),
		TargetDirPath: filepath.Join(strings.TrimSpace(projectRoot), "common", "config", "dir.yaml"),
		Items:         []dirEntryView{},
		Skipped:       []FingerprintImportSkip{},
	}
	imported, err := scanImportDirs(ctx, pe, source, res)
	if err != nil {
		return nil, err
	}
	merged, duplicates := collapseDirEntries(imported)
	res.DuplicatePathCount = duplicates
	for _, entry := range merged {
		res.Items = append(res.Items, dirEntryView{Product: entry.Product, Paths: entry.Paths})
		res.PathCount += len(entry.Paths)
	}
	res.ProductCount = len(res.Items)
	res.DirYaml = renderDirEntriesYAML(merged)
	res.Elapsed = time.Since(start).Round(time.Millisecond).String()
	return res, nil
}

func scanImportDirs(ctx context.Context, pe *progressEmitter, source string, res *DirImportPreviewResult) ([]dirEntry, error) {
	out := []dirEntry{}
	err := filepath.WalkDir(source, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if ctx.Err() != nil {
			return fmt.Errorf("已取消")
		}
		if d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".yaml" && ext != ".yml" && ext != ".txt" {
			return nil
		}
		res.ScannedFiles++
		rel, _ := filepath.Rel(source, path)
		rel = filepath.ToSlash(rel)
		items, skip := parseImportDirFile(path, rel)
		if skip.Reason != "" {
			res.SkippedFiles++
			res.Skipped = append(res.Skipped, skip)
			return nil
		}
		if len(items) == 0 {
			res.SkippedFiles++
			res.Skipped = append(res.Skipped, FingerprintImportSkip{Path: path, RelPath: rel, Reason: "未识别到可归属产品的路径"})
			return nil
		}
		res.ParsedFiles++
		out = append(out, items...)
		if pe != nil {
			pe.forceEmit(0, fmt.Sprintf("解析接口路径 %d", res.ScannedFiles))
		}
		return nil
	})
	return out, err
}

func parseImportDirFile(path, rel string) ([]dirEntry, FingerprintImportSkip) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, FingerprintImportSkip{Path: path, RelPath: rel, Reason: err.Error()}
	}
	if len(raw) == 0 {
		return nil, FingerprintImportSkip{Path: path, RelPath: rel, Reason: "空文件"}
	}
	if len(raw) > 8*1024*1024 {
		return nil, FingerprintImportSkip{Path: path, RelPath: rel, Reason: "文件过大"}
	}
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".yaml" || ext == ".yml" {
		var root yaml.Node
		if err := yaml.Unmarshal(raw, &root); err == nil {
			if entries := collectDirEntriesFromYAMLNode(&root); len(entries) > 0 {
				return entries, FingerprintImportSkip{}
			}
		}
	}
	product := dirImportProductFromPath(path)
	if product == "" || strings.EqualFold(product, "unknown") || strings.EqualFold(product, "dir") {
		return nil, FingerprintImportSkip{Path: path, RelPath: rel, Reason: "路径存在但无法归属到产品"}
	}
	paths := collectPlainPaths(string(raw))
	if len(paths) == 0 {
		return nil, FingerprintImportSkip{Path: path, RelPath: rel, Reason: "未识别到路径值"}
	}
	return []dirEntry{{Product: product, Paths: paths}}, FingerprintImportSkip{}
}

func collectDirEntriesFromYAMLNode(root *yaml.Node) []dirEntry {
	if root == nil {
		return nil
	}
	node := root
	if node.Kind == yaml.DocumentNode && len(node.Content) > 0 {
		node = node.Content[0]
	}
	if node.Kind != yaml.MappingNode {
		return nil
	}
	out := []dirEntry{}
	for i := 0; i+1 < len(node.Content); i += 2 {
		product := strings.TrimSpace(node.Content[i].Value)
		paths := normalizeDirPaths(yamlStringSeq(node.Content[i+1]))
		if product == "" || len(paths) == 0 {
			continue
		}
		out = append(out, dirEntry{Product: product, Paths: paths})
	}
	return out
}

func collectPlainPaths(content string) []string {
	paths := []string{}
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(strings.Trim(line, "\"'`"))
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "//") {
			continue
		}
		if rePlainPathLine.MatchString(line) {
			paths = append(paths, line)
		}
	}
	return normalizeDirPaths(paths)
}

func dirImportProductFromPath(path string) string {
	base := productNameFromFilename(filepath.Base(path))
	if strings.EqualFold(base, "dir") || strings.EqualFold(base, "paths") || strings.EqualFold(base, "path") || strings.EqualFold(base, "urls") {
		return ""
	}
	if base != "" && base != "unknown" {
		return base
	}
	parent := filepath.Base(filepath.Dir(path))
	if parent == "" || parent == "." {
		return ""
	}
	return productNameFromFilename(parent)
}

func collapseDirEntries(entries []dirEntry) ([]dirEntry, int) {
	byNorm := map[string]*dirEntry{}
	seen := map[string]map[string]struct{}{}
	duplicates := 0
	for _, entry := range entries {
		norm := normalizeImportProductName(entry.Product)
		paths := normalizeDirPaths(entry.Paths)
		if norm == "" || len(paths) == 0 {
			continue
		}
		if byNorm[norm] == nil {
			cp := dirEntry{Product: entry.Product}
			byNorm[norm] = &cp
			seen[norm] = map[string]struct{}{}
		}
		for _, path := range paths {
			if _, ok := seen[norm][path]; ok {
				duplicates++
				continue
			}
			seen[norm][path] = struct{}{}
			byNorm[norm].Paths = append(byNorm[norm].Paths, path)
		}
	}
	out := make([]dirEntry, 0, len(byNorm))
	for _, entry := range byNorm {
		entry.Paths = uniqueSortedStrings(entry.Paths)
		out = append(out, *entry)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Product < out[j].Product })
	return out, duplicates
}
