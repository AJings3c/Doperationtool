package main

import (
	"context"
	"crypto/sha1"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"gopkg.in/yaml.v3"
)

type FingerprintAuditResult struct {
	ProjectRoot                     string                          `json:"projectRoot"`
	FingerPath                      string                          `json:"fingerPath"`
	DirPath                         string                          `json:"dirPath"`
	WorkflowPath                    string                          `json:"workflowPath"`
	PocDir                          string                          `json:"pocDir"`
	FingerCount                     int                             `json:"fingerCount"`
	FingerRuleCount                 int                             `json:"fingerRuleCount"`
	DirCount                        int                             `json:"dirCount"`
	DirPathCount                    int                             `json:"dirPathCount"`
	RecognitionProductCount         int                             `json:"recognitionProductCount"`
	FingerOnlyProductCount          int                             `json:"fingerOnlyProductCount"`
	DirOnlyProductCount             int                             `json:"dirOnlyProductCount"`
	FingerDirProductCount           int                             `json:"fingerDirProductCount"`
	WorkflowCount                   int                             `json:"workflowCount"`
	WorkflowPocRefCount             int                             `json:"workflowPocRefCount"`
	PocFileCount                    int                             `json:"pocFileCount"`
	PocWithIDCount                  int                             `json:"pocWithIdCount"`
	MissingPocCount                 int                             `json:"missingPocCount"`
	OrphanPocCount                  int                             `json:"orphanPocCount"`
	FingerWithoutWorkflowCount      int                             `json:"fingerWithoutWorkflowCount"`
	WorkflowWithoutFingerCount      int                             `json:"workflowWithoutFingerCount"`
	RecognitionWithoutWorkflowCount int                             `json:"recognitionWithoutWorkflowCount"`
	WorkflowWithoutRecognitionCount int                             `json:"workflowWithoutRecognitionCount"`
	FingerWithoutPocCount           int                             `json:"fingerWithoutPocCount"`
	PocWithFingerCount              int                             `json:"pocWithFingerCount"`
	PocWithFingerWorkflowCount      int                             `json:"pocWithFingerWorkflowCount"`
	PocWithFingerNoWorkflowCount    int                             `json:"pocWithFingerNoWorkflowCount"`
	PocWithoutFingerCount           int                             `json:"pocWithoutFingerCount"`
	VirtualPocCount                 int                             `json:"virtualPocCount"`
	IncompletePocCount              int                             `json:"incompletePocCount"`
	ClassifiedPocCount              int                             `json:"classifiedPocCount"`
	UnmatchedPocCount               int                             `json:"unmatchedPocCount"`
	ComponentCount                  int                             `json:"componentCount"`
	WeakRuleCount                   int                             `json:"weakRuleCount"`
	DuplicateRuleGroupCount         int                             `json:"duplicateRuleGroupCount"`
	DuplicateProductGroupCount      int                             `json:"duplicateProductGroupCount"`
	WorkflowSuggestionCount         int                             `json:"workflowSuggestionCount"`
	AssetOnlyProductCount           int                             `json:"assetOnlyProductCount"`
	MissingPocs                     []FingerprintWorkflowPoc        `json:"missingPocs"`
	OrphanPocs                      []FingerprintPocInfo            `json:"orphanPocs"`
	FingerWithoutWorkflow           []string                        `json:"fingerWithoutWorkflow"`
	WorkflowWithoutFinger           []string                        `json:"workflowWithoutFinger"`
	RecognitionWithoutWorkflow      []string                        `json:"recognitionWithoutWorkflow"`
	WorkflowWithoutRecognition      []string                        `json:"workflowWithoutRecognition"`
	FingerWithoutPoc                []string                        `json:"fingerWithoutPoc"`
	PocWithFinger                   []FingerprintPocFingerMatch     `json:"pocWithFinger"`
	PocWithFingerWorkflow           []FingerprintPocFingerMatch     `json:"pocWithFingerWorkflow"`
	PocWithFingerNoWorkflow         []FingerprintPocFingerMatch     `json:"pocWithFingerNoWorkflow"`
	PocWithoutFinger                []FingerprintPocInfo            `json:"pocWithoutFinger"`
	VirtualPocs                     []FingerprintPocInfo            `json:"virtualPocs"`
	IncompletePocs                  []FingerprintPocInfo            `json:"incompletePocs"`
	AllPocs                         []FingerprintPocInfo            `json:"allPocs"`
	PocGroups                       []FingerprintPocComponentGroup  `json:"pocGroups"`
	WeakRules                       []FingerprintRuleIssue          `json:"weakRules"`
	DuplicateRules                  []FingerprintRuleDup            `json:"duplicateRules"`
	DuplicateProducts               []FingerprintNameDup            `json:"duplicateProducts"`
	WorkflowSuggestions             []FingerprintWorkflowSuggestion `json:"workflowSuggestions"`
	AssetOnlyProducts               []string                        `json:"assetOnlyProducts"`
	TopWorkflowProducts             []FingerprintCoverage           `json:"topWorkflowProducts"`
	TopFingerProducts               []FingerprintCoverage           `json:"topFingerProducts"`
	Elapsed                         string                          `json:"elapsed"`
}

type FingerprintWorkflowPoc struct {
	Product string `json:"product"`
	Poc     string `json:"poc"`
}

type FingerprintPocInfo struct {
	Path                 string   `json:"path"`
	RelPath              string   `json:"relPath"`
	Name                 string   `json:"name"`
	ID                   string   `json:"id"`
	InfoName             string   `json:"infoName"`
	Severity             string   `json:"severity"`
	Tags                 []string `json:"tags"`
	ReferencedByWorkflow bool     `json:"referencedByWorkflow"`
	WorkflowProducts     []string `json:"workflowProducts"`
	MatchedProduct       string   `json:"matchedProduct"`
	MatchSource          string   `json:"matchSource,omitempty"`
	MatchConfidence      int      `json:"matchConfidence"`
	MatchReason          string   `json:"matchReason"`
	Incomplete           bool     `json:"incomplete"`
	Issues               []string `json:"issues"`
	ContentHash          string   `json:"contentHash,omitempty"`
	Duplicate            bool     `json:"duplicate,omitempty"`
	DuplicateKey         string   `json:"duplicateKey,omitempty"`
	DuplicateReason      string   `json:"duplicateReason,omitempty"`
	DuplicateOf          string   `json:"duplicateOf,omitempty"`
}

type FingerprintPocFingerMatch struct {
	Product    string `json:"product"`
	Poc        string `json:"poc"`
	PocID      string `json:"pocId"`
	PocRelPath string `json:"pocRelPath"`
	Confidence int    `json:"confidence"`
	Reason     string `json:"reason"`
	Path       string `json:"path"`
	Source     string `json:"source,omitempty"`
}

type FingerprintRuleIssue struct {
	Product string `json:"product"`
	Rule    string `json:"rule"`
	Reason  string `json:"reason"`
}

type FingerprintRuleDup struct {
	Rule     string   `json:"rule"`
	Products []string `json:"products"`
}

type FingerprintNameDup struct {
	Name     string   `json:"name"`
	Products []string `json:"products"`
}

type FingerprintCoverage struct {
	Product     string `json:"product"`
	FingerRules int    `json:"fingerRules"`
	Pocs        int    `json:"pocs"`
}

type FingerprintWorkflowSuggestion struct {
	Product    string `json:"product"`
	Poc        string `json:"poc"`
	PocID      string `json:"pocId"`
	PocRelPath string `json:"pocRelPath"`
	Confidence int    `json:"confidence"`
	Reason     string `json:"reason"`
}

type FingerprintPocCatalogResult struct {
	ProjectRoot             string                         `json:"projectRoot"`
	SourceType              string                         `json:"sourceType"`
	SourceDir               string                         `json:"sourceDir"`
	FingerPath              string                         `json:"fingerPath"`
	DirPath                 string                         `json:"dirPath"`
	WorkflowPath            string                         `json:"workflowPath"`
	PocDir                  string                         `json:"pocDir"`
	FingerCount             int                            `json:"fingerCount"`
	DirCount                int                            `json:"dirCount"`
	DirPathCount            int                            `json:"dirPathCount"`
	RecognitionProductCount int                            `json:"recognitionProductCount"`
	WorkflowCount           int                            `json:"workflowCount"`
	PocFileCount            int                            `json:"pocFileCount"`
	UniquePocCount          int                            `json:"uniquePocCount"`
	DuplicatePocCount       int                            `json:"duplicatePocCount"`
	ClassifiedPocCount      int                            `json:"classifiedPocCount"`
	UnmatchedPocCount       int                            `json:"unmatchedPocCount"`
	WorkflowPocCount        int                            `json:"workflowPocCount"`
	VirtualPocCount         int                            `json:"virtualPocCount"`
	IncompletePocCount      int                            `json:"incompletePocCount"`
	ComponentCount          int                            `json:"componentCount"`
	AllPocs                 []FingerprintPocInfo           `json:"allPocs"`
	Groups                  []FingerprintPocComponentGroup `json:"groups"`
	UnmatchedPocs           []FingerprintPocInfo           `json:"unmatchedPocs"`
	VirtualPocs             []FingerprintPocInfo           `json:"virtualPocs"`
	IncompletePocs          []FingerprintPocInfo           `json:"incompletePocs"`
	DuplicatePocs           []FingerprintPocDuplicate      `json:"duplicatePocs"`
	Elapsed                 string                         `json:"elapsed"`
}

type FingerprintPocDuplicate struct {
	Key              string `json:"key"`
	Reason           string `json:"reason"`
	KeptPath         string `json:"keptPath"`
	KeptRelPath      string `json:"keptRelPath"`
	DuplicatePath    string `json:"duplicatePath"`
	DuplicateRelPath string `json:"duplicateRelPath"`
}

type FingerprintPocComponentGroup struct {
	Product              string               `json:"product"`
	NormalizedProduct    string               `json:"normalizedProduct"`
	FingerRuleCount      int                  `json:"fingerRuleCount"`
	WorkflowPocCount     int                  `json:"workflowPocCount"`
	PocCount             int                  `json:"pocCount"`
	ReferencedPocCount   int                  `json:"referencedPocCount"`
	UnreferencedPocCount int                  `json:"unreferencedPocCount"`
	IncompletePocCount   int                  `json:"incompletePocCount"`
	Pocs                 []FingerprintPocInfo `json:"pocs"`
}

type fingerEntry struct {
	Product string
	Rules   []string
}

type dirEntry struct {
	Product string
	Paths   []string
}

type workflowEntry struct {
	Product string
	Types   []string
	Pocs    []string
}

const fingerprintAuditListLimit = 200

var reFingerClause = regexp.MustCompile(`(?i)(body|title|header|banner|cert)\s*(?:=|~=)\s*"([^"]*)"`)
var auditTokenSplitRE = regexp.MustCompile(`[^a-z0-9]+`)
var auditWhitespaceRE = regexp.MustCompile(`\s+`)

type fingerprintPocTemplateMeta struct {
	ID           string
	InfoName     string
	Severity     string
	Tags         []string
	HasRequest   bool
	HasMatcher   bool
	HasExtractor bool
	ParseError   string
}

func (a *App) AuditFingerprintKnowledge(projectRoot string) (*FingerprintAuditResult, error) {
	start := time.Now()
	root := strings.TrimSpace(projectRoot)
	if root == "" {
		return nil, fmt.Errorf("dddd 根目录为空")
	}
	info, err := os.Stat(root)
	if err != nil {
		return nil, fmt.Errorf("dddd 根目录不可访问: %v", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("不是目录: %s", root)
	}

	fingerPath := filepath.Join(root, "common", "config", "finger.yaml")
	dirPath := filepath.Join(root, "common", "config", "dir.yaml")
	workflowPath := filepath.Join(root, "common", "config", "workflow.yaml")
	pocDir := filepath.Join(root, "common", "config", "pocs")
	for _, p := range []string{fingerPath, dirPath, workflowPath, pocDir} {
		if _, statErr := os.Stat(p); statErr != nil {
			return nil, fmt.Errorf("缺少 dddd 配置路径 %s: %v", p, statErr)
		}
	}

	ctx, pe, cleanup := a.beginTask("fingerprint:audit:progress", "scanning", 0)
	defer cleanup()
	defer pe.finish("审计完成")

	pe.forceEmit(0, "读取 finger.yaml")
	fingers, err := loadFingerEntries(ctx, fingerPath)
	if err != nil {
		return nil, err
	}
	if ctx.Err() != nil {
		return nil, fmt.Errorf("已取消")
	}
	pe.forceEmit(0, "读取 dir.yaml")
	dirs, err := loadDirEntries(ctx, dirPath)
	if err != nil {
		return nil, err
	}
	if ctx.Err() != nil {
		return nil, fmt.Errorf("已取消")
	}
	pe.forceEmit(0, "读取 workflow.yaml")
	workflows, err := loadWorkflowEntries(ctx, workflowPath)
	if err != nil {
		return nil, err
	}
	if ctx.Err() != nil {
		return nil, fmt.Errorf("已取消")
	}
	pe.forceEmit(0, "扫描 POC 目录")
	pocs, err := scanFingerprintPocs(ctx, pe, pocDir)
	if err != nil {
		return nil, err
	}
	if ctx.Err() != nil {
		return nil, fmt.Errorf("已取消")
	}

	pe.switchPhase("analyzing", len(pocs))
	pe.forceEmit(0, fmt.Sprintf("分析 %d 个 POC 与 %d 个识别产品", len(pocs), len(recognitionEntries(fingers, dirs))))
	res, err := buildFingerprintAudit(root, fingerPath, dirPath, workflowPath, pocDir, fingers, dirs, workflows, pocs, pe)
	if err != nil {
		return nil, err
	}
	res.Elapsed = time.Since(start).Truncate(10 * time.Millisecond).String()
	return res, nil
}

func (a *App) ClassifyDDDDBuiltinPocs(projectRoot string) (*FingerprintPocCatalogResult, error) {
	start := time.Now()
	root := strings.TrimSpace(projectRoot)
	if root == "" {
		return nil, fmt.Errorf("dddd 根目录为空")
	}
	info, err := os.Stat(root)
	if err != nil {
		return nil, fmt.Errorf("dddd 根目录不可访问: %v", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("不是目录: %s", root)
	}

	fingerPath := filepath.Join(root, "common", "config", "finger.yaml")
	dirPath := filepath.Join(root, "common", "config", "dir.yaml")
	workflowPath := filepath.Join(root, "common", "config", "workflow.yaml")
	pocDir := filepath.Join(root, "common", "config", "pocs")
	for _, p := range []string{fingerPath, dirPath, workflowPath, pocDir} {
		if _, statErr := os.Stat(p); statErr != nil {
			return nil, fmt.Errorf("缺少 dddd 配置路径 %s: %v", p, statErr)
		}
	}

	ctx, pe, cleanup := a.beginTask("fingerprint:poc_catalog:progress", "scanning", 0)
	defer cleanup()
	defer pe.finish("POC 归类完成")

	pe.forceEmit(0, "读取 finger.yaml")
	fingers, err := loadFingerEntries(ctx, fingerPath)
	if err != nil {
		return nil, err
	}
	pe.forceEmit(0, "读取 dir.yaml")
	dirs, err := loadDirEntries(ctx, dirPath)
	if err != nil {
		return nil, err
	}
	pe.forceEmit(0, "读取 workflow.yaml")
	workflows, err := loadWorkflowEntries(ctx, workflowPath)
	if err != nil {
		return nil, err
	}
	pe.forceEmit(0, "扫描内置 POC")
	pocs, err := scanFingerprintPocs(ctx, pe, pocDir)
	if err != nil {
		return nil, err
	}
	if ctx.Err() != nil {
		return nil, fmt.Errorf("已取消")
	}
	pe.switchPhase("analyzing", len(pocs))
	pe.forceEmit(0, fmt.Sprintf("按组件指纹归类 %d 个 POC", len(pocs)))
	res, err := buildFingerprintPocCatalog(root, fingerPath, dirPath, workflowPath, pocDir, fingers, dirs, workflows, pocs, pe)
	if err != nil {
		return nil, err
	}
	res.Elapsed = time.Since(start).Truncate(10 * time.Millisecond).String()
	return res, nil
}

func loadFingerEntries(ctx context.Context, path string) ([]fingerEntry, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取 finger.yaml 失败: %v", err)
	}
	var node yaml.Node
	if err := yaml.Unmarshal(raw, &node); err != nil {
		return nil, fmt.Errorf("解析 finger.yaml 失败: %v", err)
	}
	root := unwrapYAMLDoc(&node)
	if root == nil || root.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("finger.yaml 顶层必须是 mapping")
	}
	entries := make([]fingerEntry, 0, len(root.Content)/2)
	for i := 0; i+1 < len(root.Content); i += 2 {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		key := strings.TrimSpace(root.Content[i].Value)
		val := root.Content[i+1]
		rules := yamlStringSeq(val)
		entries = append(entries, fingerEntry{Product: key, Rules: rules})
	}
	return entries, nil
}

func loadDirEntries(ctx context.Context, path string) ([]dirEntry, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取 dir.yaml 失败: %v", err)
	}
	return parseDirEntriesFromYAML(ctx, raw, "dir.yaml")
}

func parseDirEntriesFromYAML(ctx context.Context, raw []byte, label string) ([]dirEntry, error) {
	var node yaml.Node
	if err := yaml.Unmarshal(raw, &node); err != nil {
		return nil, fmt.Errorf("解析 %s 失败: %v", label, err)
	}
	root := unwrapYAMLDoc(&node)
	if root == nil {
		return nil, nil
	}
	if root.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("%s 顶层必须是 mapping", label)
	}
	entries := make([]dirEntry, 0, len(root.Content)/2)
	for i := 0; i+1 < len(root.Content); i += 2 {
		if ctx != nil && ctx.Err() != nil {
			return nil, ctx.Err()
		}
		product := strings.TrimSpace(root.Content[i].Value)
		paths := normalizeDirPaths(yamlStringSeq(root.Content[i+1]))
		entries = append(entries, dirEntry{Product: product, Paths: paths})
	}
	return entries, nil
}

func loadWorkflowEntries(ctx context.Context, path string) ([]workflowEntry, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取 workflow.yaml 失败: %v", err)
	}
	var node yaml.Node
	if err := yaml.Unmarshal(raw, &node); err != nil {
		return nil, fmt.Errorf("解析 workflow.yaml 失败: %v", err)
	}
	root := unwrapYAMLDoc(&node)
	if root == nil || root.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("workflow.yaml 顶层必须是 mapping")
	}
	entries := make([]workflowEntry, 0, len(root.Content)/2)
	for i := 0; i+1 < len(root.Content); i += 2 {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		product := strings.TrimSpace(root.Content[i].Value)
		entry := workflowEntry{Product: product}
		val := root.Content[i+1]
		if val != nil && val.Kind == yaml.MappingNode {
			for j := 0; j+1 < len(val.Content); j += 2 {
				field := strings.TrimSpace(strings.ToLower(val.Content[j].Value))
				switch field {
				case "type":
					entry.Types = yamlStringSeq(val.Content[j+1])
				case "pocs":
					entry.Pocs = yamlStringSeq(val.Content[j+1])
				}
			}
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

func unwrapYAMLDoc(node *yaml.Node) *yaml.Node {
	if node == nil {
		return nil
	}
	if node.Kind == yaml.DocumentNode && len(node.Content) > 0 {
		return node.Content[0]
	}
	return node
}

func yamlStringSeq(node *yaml.Node) []string {
	if node == nil {
		return nil
	}
	switch node.Kind {
	case yaml.SequenceNode:
		out := make([]string, 0, len(node.Content))
		for _, item := range node.Content {
			v := strings.TrimSpace(item.Value)
			if v != "" {
				out = append(out, v)
			}
		}
		return out
	case yaml.ScalarNode:
		v := strings.TrimSpace(node.Value)
		if v == "" {
			return nil
		}
		return []string{v}
	default:
		return nil
	}
}

func scanFingerprintPocs(ctx context.Context, pe *progressEmitter, dir string) ([]FingerprintPocInfo, error) {
	var pocs []FingerprintPocInfo
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, walkErr error) error {
		if ctx.Err() != nil {
			return filepath.SkipAll
		}
		if walkErr != nil {
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d == nil {
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
		ext := strings.ToLower(filepath.Ext(name))
		if ext != ".yaml" && ext != ".yml" {
			return nil
		}
		rel, relErr := filepath.Rel(dir, path)
		if relErr != nil {
			rel = name
		}
		meta := fingerprintPocTemplateMeta{}
		contentHash := ""
		if raw, readErr := os.ReadFile(path); readErr == nil {
			sum := sha1.Sum(raw)
			contentHash = fmt.Sprintf("%x", sum[:])
			meta = parseFingerprintPocTemplateMeta(raw)
		}
		issues := fingerprintPocIncompleteIssues(meta)
		pocs = append(pocs, FingerprintPocInfo{Path: path, RelPath: rel, Name: name, ID: meta.ID, InfoName: meta.InfoName, Severity: meta.Severity, Tags: meta.Tags, Incomplete: len(issues) > 0, Issues: issues, ContentHash: contentHash})
		if pe != nil {
			pe.tick(len(pocs), fmt.Sprintf("已扫描 %d 个 POC", len(pocs)))
		}
		return nil
	})
	if ctx.Err() != nil {
		return nil, fmt.Errorf("已取消")
	}
	if err != nil {
		return nil, err
	}
	sort.Slice(pocs, func(i, j int) bool { return pocs[i].RelPath < pocs[j].RelPath })
	return pocs, nil
}

func parseFingerprintPocTemplateMeta(raw []byte) fingerprintPocTemplateMeta {
	meta := fingerprintPocTemplateMeta{ID: extractTopLevelId(string(raw))}
	var node yaml.Node
	if err := yaml.Unmarshal(raw, &node); err != nil {
		meta.ParseError = err.Error()
		return meta
	}
	root := unwrapYAMLDoc(&node)
	if root == nil || root.Kind != yaml.MappingNode {
		meta.ParseError = "顶层不是 YAML mapping"
		return meta
	}
	if id := yamlMapScalar(root, "id"); id != "" {
		meta.ID = id
	}
	if info := yamlMapNode(root, "info"); info != nil && info.Kind == yaml.MappingNode {
		meta.InfoName = yamlMapScalar(info, "name")
		meta.Severity = yamlMapScalar(info, "severity")
		meta.Tags = yamlStringList(yamlMapNode(info, "tags"))
	}
	for _, key := range []string{"requests", "http", "network", "dns", "ssl", "tcp", "udp", "websocket", "headless", "javascript", "code", "file"} {
		if yamlMapNode(root, key) != nil {
			meta.HasRequest = true
			break
		}
	}
	meta.HasMatcher = yamlContainsMapKey(root, "matchers")
	meta.HasExtractor = yamlContainsMapKey(root, "extractors")
	return meta
}

func fingerprintPocIncompleteIssues(meta fingerprintPocTemplateMeta) []string {
	issues := []string{}
	if meta.ParseError != "" {
		issues = append(issues, "YAML 解析失败: "+meta.ParseError)
	}
	if meta.ID == "" {
		issues = append(issues, "缺少顶层 id")
	}
	if meta.InfoName == "" {
		issues = append(issues, "缺少 info.name")
	}
	if meta.Severity == "" {
		issues = append(issues, "缺少 info.severity")
	}
	if !meta.HasRequest {
		issues = append(issues, "缺少可执行请求块")
	}
	if !meta.HasMatcher && !meta.HasExtractor {
		issues = append(issues, "缺少 matchers/extractors")
	}
	return issues
}

func yamlMapNode(node *yaml.Node, key string) *yaml.Node {
	if node == nil || node.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if strings.EqualFold(strings.TrimSpace(node.Content[i].Value), key) {
			return node.Content[i+1]
		}
	}
	return nil
}

func yamlMapScalar(node *yaml.Node, key string) string {
	child := yamlMapNode(node, key)
	if child == nil {
		return ""
	}
	return strings.TrimSpace(child.Value)
}

func yamlStringList(node *yaml.Node) []string {
	if node == nil {
		return nil
	}
	out := []string{}
	switch node.Kind {
	case yaml.SequenceNode:
		for _, item := range node.Content {
			for _, part := range strings.Split(item.Value, ",") {
				part = strings.TrimSpace(part)
				if part != "" {
					out = append(out, part)
				}
			}
		}
	case yaml.ScalarNode:
		for _, part := range strings.Split(node.Value, ",") {
			part = strings.TrimSpace(part)
			if part != "" {
				out = append(out, part)
			}
		}
	}
	return uniqueSortedStrings(out)
}

func yamlContainsMapKey(node *yaml.Node, key string) bool {
	if node == nil {
		return false
	}
	if node.Kind == yaml.MappingNode {
		for i := 0; i+1 < len(node.Content); i += 2 {
			if strings.EqualFold(strings.TrimSpace(node.Content[i].Value), key) {
				return true
			}
			if yamlContainsMapKey(node.Content[i+1], key) {
				return true
			}
		}
		return false
	}
	for _, child := range node.Content {
		if yamlContainsMapKey(child, key) {
			return true
		}
	}
	return false
}

func buildFingerprintAudit(root, fingerPath, dirPath, workflowPath, pocDir string, fingers []fingerEntry, dirs []dirEntry, workflows []workflowEntry, pocs []FingerprintPocInfo, pe *progressEmitter) (*FingerprintAuditResult, error) {
	res := &FingerprintAuditResult{
		ProjectRoot:                root,
		FingerPath:                 fingerPath,
		DirPath:                    dirPath,
		WorkflowPath:               workflowPath,
		PocDir:                     pocDir,
		FingerCount:                len(fingers),
		DirCount:                   len(dirs),
		WorkflowCount:              len(workflows),
		PocFileCount:               len(pocs),
		MissingPocs:                []FingerprintWorkflowPoc{},
		OrphanPocs:                 []FingerprintPocInfo{},
		FingerWithoutWorkflow:      []string{},
		WorkflowWithoutFinger:      []string{},
		RecognitionWithoutWorkflow: []string{},
		WorkflowWithoutRecognition: []string{},
		FingerWithoutPoc:           []string{},
		PocWithFinger:              []FingerprintPocFingerMatch{},
		PocWithFingerWorkflow:      []FingerprintPocFingerMatch{},
		PocWithFingerNoWorkflow:    []FingerprintPocFingerMatch{},
		PocWithoutFinger:           []FingerprintPocInfo{},
		VirtualPocs:                []FingerprintPocInfo{},
		IncompletePocs:             []FingerprintPocInfo{},
		AllPocs:                    []FingerprintPocInfo{},
		WeakRules:                  []FingerprintRuleIssue{},
		DuplicateRules:             []FingerprintRuleDup{},
		DuplicateProducts:          []FingerprintNameDup{},
		WorkflowSuggestions:        []FingerprintWorkflowSuggestion{},
		AssetOnlyProducts:          []string{},
		TopWorkflowProducts:        []FingerprintCoverage{},
		TopFingerProducts:          []FingerprintCoverage{},
	}

	fingerByNorm := map[string]fingerEntry{}
	dirByNorm := map[string]dirEntry{}
	workflowByNorm := map[string]workflowEntry{}
	recognitionByNorm := map[string]fingerprintMatchCandidate{}
	productNames := map[string][]string{}
	ruleOwners := map[string]map[string]struct{}{}
	fingerRuleCountsByNorm := map[string]int{}
	dirPathCountsByNorm := map[string]int{}
	workflowPocCountsByNorm := map[string]int{}
	workflowResolvedPocCountsByNorm := map[string]int{}

	for _, f := range fingers {
		norm := normalizeFingerAuditName(f.Product)
		if norm != "" {
			if _, ok := fingerByNorm[norm]; !ok {
				fingerByNorm[norm] = f
			}
			productNames[norm] = append(productNames[norm], f.Product)
		}
		fingerRuleCountsByNorm[norm] += len(f.Rules)
		res.FingerRuleCount += len(f.Rules)
		for _, rule := range f.Rules {
			r := strings.TrimSpace(rule)
			if r == "" {
				res.WeakRuleCount++
				res.WeakRules = appendLimitedRuleIssue(res.WeakRules, FingerprintRuleIssue{Product: f.Product, Rule: rule, Reason: "空规则"})
				continue
			}
			if ruleOwners[r] == nil {
				ruleOwners[r] = map[string]struct{}{}
			}
			ruleOwners[r][f.Product] = struct{}{}
			if reason := weakFingerprintRuleReason(r); reason != "" {
				res.WeakRuleCount++
				res.WeakRules = appendLimitedRuleIssue(res.WeakRules, FingerprintRuleIssue{Product: f.Product, Rule: r, Reason: reason})
			}
		}
	}

	for _, d := range dirs {
		norm := normalizeFingerAuditName(d.Product)
		if norm != "" {
			if _, ok := dirByNorm[norm]; !ok {
				dirByNorm[norm] = d
			}
			res.DirPathCount += len(d.Paths)
			dirPathCountsByNorm[norm] += len(d.Paths)
			productNames[norm] = append(productNames[norm], d.Product)
		}
	}

	for _, c := range recognitionEntries(fingers, dirs) {
		recognitionByNorm[c.Norm] = c
	}
	res.RecognitionProductCount = len(recognitionByNorm)
	for norm := range recognitionByNorm {
		_, inFinger := fingerByNorm[norm]
		_, inDir := dirByNorm[norm]
		switch {
		case inFinger && inDir:
			res.FingerDirProductCount++
		case inFinger:
			res.FingerOnlyProductCount++
		case inDir:
			res.DirOnlyProductCount++
		}
	}

	for norm, names := range productNames {
		uniq := uniqueSortedStrings(names)
		if len(uniq) > 1 {
			res.DuplicateProductGroupCount++
			if len(res.DuplicateProducts) < fingerprintAuditListLimit {
				res.DuplicateProducts = append(res.DuplicateProducts, FingerprintNameDup{Name: norm, Products: uniq})
			}
		}
	}
	sort.Slice(res.DuplicateProducts, func(i, j int) bool { return res.DuplicateProducts[i].Name < res.DuplicateProducts[j].Name })

	for rule, owners := range ruleOwners {
		if len(owners) <= 1 {
			continue
		}
		res.DuplicateRuleGroupCount++
		if len(res.DuplicateRules) < fingerprintAuditListLimit {
			res.DuplicateRules = append(res.DuplicateRules, FingerprintRuleDup{Rule: rule, Products: sortedKeys(owners)})
		}
	}
	sort.Slice(res.DuplicateRules, func(i, j int) bool {
		if len(res.DuplicateRules[i].Products) == len(res.DuplicateRules[j].Products) {
			return res.DuplicateRules[i].Rule < res.DuplicateRules[j].Rule
		}
		return len(res.DuplicateRules[i].Products) > len(res.DuplicateRules[j].Products)
	})

	for _, w := range workflows {
		norm := normalizeFingerAuditName(w.Product)
		if norm != "" {
			if _, ok := workflowByNorm[norm]; !ok {
				workflowByNorm[norm] = w
			}
		}
		workflowPocCountsByNorm[norm] += len(w.Pocs)
		res.WorkflowPocRefCount += len(w.Pocs)
	}

	pocKeys := map[string]FingerprintPocInfo{}
	for _, p := range pocs {
		if p.ID != "" {
			res.PocWithIDCount++
			pocKeys[normalizePocAuditKey(p.ID)] = p
		}
		base := strings.TrimSuffix(strings.TrimSuffix(p.Name, filepath.Ext(p.Name)), ".")
		pocKeys[normalizePocAuditKey(base)] = p
	}

	referencedPocs := map[string]struct{}{}
	referencedPocProducts := map[string]map[string]struct{}{}
	for _, w := range workflows {
		for _, poc := range w.Pocs {
			key := normalizePocAuditKey(poc)
			if key == "" {
				continue
			}
			referencedPocs[key] = struct{}{}
			if referencedPocProducts[key] == nil {
				referencedPocProducts[key] = map[string]struct{}{}
			}
			referencedPocProducts[key][w.Product] = struct{}{}
			if _, ok := pocKeys[key]; !ok {
				res.MissingPocCount++
				if len(res.MissingPocs) < fingerprintAuditListLimit {
					res.MissingPocs = append(res.MissingPocs, FingerprintWorkflowPoc{Product: w.Product, Poc: poc})
				}
			} else {
				workflowResolvedPocCountsByNorm[normalizeFingerAuditName(w.Product)]++
			}
		}
	}
	sort.Slice(res.MissingPocs, func(i, j int) bool {
		if res.MissingPocs[i].Product == res.MissingPocs[j].Product {
			return res.MissingPocs[i].Poc < res.MissingPocs[j].Poc
		}
		return res.MissingPocs[i].Product < res.MissingPocs[j].Product
	})

	recognitionCandidates := recognitionEntries(fingers, dirs)
	enrichedPocs, err := enrichFingerprintPocs(pocs, recognitionCandidates, referencedPocProducts, pe, "匹配 POC 与识别入口")
	if err != nil {
		return nil, err
	}
	res.AllPocs = enrichedPocs
	for _, p := range enrichedPocs {
		if p.Incomplete {
			res.IncompletePocCount++
			if len(res.IncompletePocs) < fingerprintAuditListLimit {
				res.IncompletePocs = append(res.IncompletePocs, p)
			}
		}
		if !p.ReferencedByWorkflow {
			res.OrphanPocCount++
			res.VirtualPocCount++
			if len(res.OrphanPocs) < fingerprintAuditListLimit {
				res.OrphanPocs = append(res.OrphanPocs, p)
			}
			if len(res.VirtualPocs) < fingerprintAuditListLimit {
				res.VirtualPocs = append(res.VirtualPocs, p)
			}
		}
		if p.MatchedProduct != "" {
			match := fingerprintPocInfoMatch(p)
			res.PocWithFingerCount++
			if len(res.PocWithFinger) < fingerprintAuditListLimit {
				res.PocWithFinger = append(res.PocWithFinger, match)
			}
			if p.ReferencedByWorkflow {
				res.PocWithFingerWorkflowCount++
				if len(res.PocWithFingerWorkflow) < fingerprintAuditListLimit {
					res.PocWithFingerWorkflow = append(res.PocWithFingerWorkflow, match)
				}
			} else {
				res.PocWithFingerNoWorkflowCount++
				if len(res.PocWithFingerNoWorkflow) < fingerprintAuditListLimit {
					res.PocWithFingerNoWorkflow = append(res.PocWithFingerNoWorkflow, match)
				}
			}
		} else {
			res.PocWithoutFingerCount++
			if len(res.PocWithoutFinger) < fingerprintAuditListLimit {
				res.PocWithoutFinger = append(res.PocWithoutFinger, p)
			}
		}
	}
	sortFingerprintPocInfos(res.OrphanPocs)
	sortFingerprintPocInfos(res.VirtualPocs)
	sortFingerprintPocInfos(res.PocWithoutFinger)
	sortFingerprintPocInfos(res.IncompletePocs)
	sortFingerprintPocMatches(res.PocWithFinger)
	sortFingerprintPocMatches(res.PocWithFingerWorkflow)
	if catalog, err := buildFingerprintPocCatalogWithEnriched(root, fingerPath, dirPath, workflowPath, pocDir, fingers, dirs, workflows, pocs, enrichedPocs, nil); err != nil {
		return nil, err
	} else if catalog != nil {
		res.PocGroups = catalog.Groups
		res.ClassifiedPocCount = catalog.ClassifiedPocCount
		res.UnmatchedPocCount = catalog.UnmatchedPocCount
		res.ComponentCount = catalog.ComponentCount
	}
	sort.Slice(res.PocWithFingerNoWorkflow, func(i, j int) bool {
		if res.PocWithFingerNoWorkflow[i].Product == res.PocWithFingerNoWorkflow[j].Product {
			return res.PocWithFingerNoWorkflow[i].PocRelPath < res.PocWithFingerNoWorkflow[j].PocRelPath
		}
		return res.PocWithFingerNoWorkflow[i].Product < res.PocWithFingerNoWorkflow[j].Product
	})

	suggestedProducts := map[string]struct{}{}
	if pe != nil {
		pe.switchPhase("analyzing", len(recognitionCandidates))
		pe.forceEmit(0, fmt.Sprintf("检查 %d 个识别产品的 workflow 与 POC 覆盖", len(recognitionCandidates)))
	}
	for i, entry := range recognitionCandidates {
		if progressCancelled(pe) {
			return nil, fmt.Errorf("已取消")
		}
		norm := entry.Norm
		if workflowResolvedPocCountsByNorm[norm] == 0 {
			res.FingerWithoutPocCount++
			if len(res.FingerWithoutPoc) < fingerprintAuditListLimit {
				res.FingerWithoutPoc = append(res.FingerWithoutPoc, entry.Product)
			}
		}
		if _, ok := workflowByNorm[norm]; !ok {
			res.RecognitionWithoutWorkflowCount++
			if len(res.RecognitionWithoutWorkflow) < fingerprintAuditListLimit {
				res.RecognitionWithoutWorkflow = append(res.RecognitionWithoutWorkflow, entry.Product)
			}
			if s, ok, err := bestWorkflowSuggestionForProduct(entry.Product, pocs, referencedPocs, pe); err != nil {
				return nil, err
			} else if ok {
				res.WorkflowSuggestionCount++
				suggestedProducts[norm] = struct{}{}
				if len(res.WorkflowSuggestions) < fingerprintAuditListLimit {
					res.WorkflowSuggestions = append(res.WorkflowSuggestions, s)
				}
			}
		}
		if pe != nil {
			pe.tick(i+1, fmt.Sprintf("已检查 %d/%d 个识别产品", i+1, len(recognitionCandidates)))
		}
	}
	for _, w := range workflows {
		if _, ok := recognitionByNorm[normalizeFingerAuditName(w.Product)]; !ok {
			res.WorkflowWithoutRecognitionCount++
			if len(res.WorkflowWithoutRecognition) < fingerprintAuditListLimit {
				res.WorkflowWithoutRecognition = append(res.WorkflowWithoutRecognition, w.Product)
			}
		}
	}
	res.FingerWithoutWorkflowCount = res.RecognitionWithoutWorkflowCount
	res.FingerWithoutWorkflow = append([]string{}, res.RecognitionWithoutWorkflow...)
	res.WorkflowWithoutFingerCount = res.WorkflowWithoutRecognitionCount
	res.WorkflowWithoutFinger = append([]string{}, res.WorkflowWithoutRecognition...)
	sort.Strings(res.FingerWithoutWorkflow)
	sort.Strings(res.FingerWithoutPoc)
	sort.Strings(res.WorkflowWithoutFinger)
	sort.Strings(res.RecognitionWithoutWorkflow)
	sort.Strings(res.WorkflowWithoutRecognition)
	sort.Slice(res.WorkflowSuggestions, func(i, j int) bool {
		if res.WorkflowSuggestions[i].Confidence == res.WorkflowSuggestions[j].Confidence {
			return res.WorkflowSuggestions[i].Product < res.WorkflowSuggestions[j].Product
		}
		return res.WorkflowSuggestions[i].Confidence > res.WorkflowSuggestions[j].Confidence
	})
	for _, product := range res.RecognitionWithoutWorkflow {
		if _, ok := suggestedProducts[normalizeFingerAuditName(product)]; ok {
			continue
		}
		res.AssetOnlyProductCount++
		if len(res.AssetOnlyProducts) < fingerprintAuditListLimit {
			res.AssetOnlyProducts = append(res.AssetOnlyProducts, product)
		}
	}

	for _, w := range workflows {
		norm := normalizeFingerAuditName(w.Product)
		res.TopWorkflowProducts = append(res.TopWorkflowProducts, FingerprintCoverage{Product: w.Product, FingerRules: fingerRuleCountsByNorm[norm] + dirPathCountsByNorm[norm], Pocs: len(w.Pocs)})
	}
	sort.Slice(res.TopWorkflowProducts, func(i, j int) bool {
		if res.TopWorkflowProducts[i].Pocs == res.TopWorkflowProducts[j].Pocs {
			return res.TopWorkflowProducts[i].Product < res.TopWorkflowProducts[j].Product
		}
		return res.TopWorkflowProducts[i].Pocs > res.TopWorkflowProducts[j].Pocs
	})
	if len(res.TopWorkflowProducts) > 50 {
		res.TopWorkflowProducts = res.TopWorkflowProducts[:50]
	}

	for _, f := range fingers {
		res.TopFingerProducts = append(res.TopFingerProducts, FingerprintCoverage{Product: f.Product, FingerRules: len(f.Rules), Pocs: workflowPocCountsByNorm[normalizeFingerAuditName(f.Product)]})
	}
	for _, d := range dirs {
		norm := normalizeFingerAuditName(d.Product)
		if _, ok := fingerByNorm[norm]; ok {
			continue
		}
		res.TopFingerProducts = append(res.TopFingerProducts, FingerprintCoverage{Product: d.Product, FingerRules: len(d.Paths), Pocs: workflowPocCountsByNorm[norm]})
	}
	sort.Slice(res.TopFingerProducts, func(i, j int) bool {
		if res.TopFingerProducts[i].FingerRules == res.TopFingerProducts[j].FingerRules {
			return res.TopFingerProducts[i].Product < res.TopFingerProducts[j].Product
		}
		return res.TopFingerProducts[i].FingerRules > res.TopFingerProducts[j].FingerRules
	})
	if len(res.TopFingerProducts) > 50 {
		res.TopFingerProducts = res.TopFingerProducts[:50]
	}

	return res, nil
}

func buildFingerprintPocCatalog(root, fingerPath, dirPath, workflowPath, pocDir string, fingers []fingerEntry, dirs []dirEntry, workflows []workflowEntry, pocs []FingerprintPocInfo, pe *progressEmitter) (*FingerprintPocCatalogResult, error) {
	return buildFingerprintPocCatalogWithEnriched(root, fingerPath, dirPath, workflowPath, pocDir, fingers, dirs, workflows, pocs, nil, pe)
}

func buildFingerprintPocCatalogWithEnriched(root, fingerPath, dirPath, workflowPath, pocDir string, fingers []fingerEntry, dirs []dirEntry, workflows []workflowEntry, pocs []FingerprintPocInfo, enriched []FingerprintPocInfo, pe *progressEmitter) (*FingerprintPocCatalogResult, error) {
	referencedPocProducts := map[string]map[string]struct{}{}
	workflowPocCountsByNorm := map[string]int{}
	workflowRefCount := 0
	for _, w := range workflows {
		norm := normalizeFingerAuditName(w.Product)
		workflowPocCountsByNorm[norm] += len(w.Pocs)
		workflowRefCount += len(w.Pocs)
		for _, poc := range w.Pocs {
			key := normalizePocAuditKey(poc)
			if key == "" {
				continue
			}
			if referencedPocProducts[key] == nil {
				referencedPocProducts[key] = map[string]struct{}{}
			}
			referencedPocProducts[key][w.Product] = struct{}{}
		}
	}
	fingerRulesByNorm := map[string]int{}
	fingerProductByNorm := map[string]string{}
	for _, f := range fingers {
		norm := normalizeFingerAuditName(f.Product)
		fingerRulesByNorm[norm] += len(f.Rules)
		if _, ok := fingerProductByNorm[norm]; !ok {
			fingerProductByNorm[norm] = f.Product
		}
	}
	dirPathsByNorm := map[string]int{}
	for _, d := range dirs {
		norm := normalizeFingerAuditName(d.Product)
		dirPathsByNorm[norm] += len(d.Paths)
		if _, ok := fingerProductByNorm[norm]; !ok {
			fingerProductByNorm[norm] = d.Product
		}
	}
	if enriched == nil {
		var err error
		enriched, err = enrichFingerprintPocs(pocs, recognitionEntries(fingers, dirs), referencedPocProducts, pe, "匹配 POC 与识别入口")
		if err != nil {
			return nil, err
		}
	}
	res := &FingerprintPocCatalogResult{
		ProjectRoot:      root,
		FingerPath:       fingerPath,
		DirPath:          dirPath,
		WorkflowPath:     workflowPath,
		PocDir:           pocDir,
		FingerCount:      len(fingers),
		DirCount:         len(dirs),
		WorkflowCount:    len(workflows),
		PocFileCount:     len(enriched),
		WorkflowPocCount: workflowRefCount,
		AllPocs:          enriched,
		Groups:           []FingerprintPocComponentGroup{},
		UnmatchedPocs:    []FingerprintPocInfo{},
		VirtualPocs:      []FingerprintPocInfo{},
		IncompletePocs:   []FingerprintPocInfo{},
	}
	for _, d := range dirs {
		res.DirPathCount += len(d.Paths)
	}
	res.RecognitionProductCount = len(recognitionEntries(fingers, dirs))
	groupByNorm := map[string]*FingerprintPocComponentGroup{}
	for _, p := range enriched {
		if progressCancelled(pe) {
			return nil, fmt.Errorf("已取消")
		}
		if p.Incomplete {
			res.IncompletePocCount++
			res.IncompletePocs = append(res.IncompletePocs, p)
		}
		if !p.ReferencedByWorkflow {
			res.VirtualPocCount++
			res.VirtualPocs = append(res.VirtualPocs, p)
		}
		if p.MatchedProduct == "" {
			res.UnmatchedPocCount++
			res.UnmatchedPocs = append(res.UnmatchedPocs, p)
			continue
		}
		res.ClassifiedPocCount++
		norm := normalizeFingerAuditName(p.MatchedProduct)
		g := groupByNorm[norm]
		if g == nil {
			product := fingerProductByNorm[norm]
			if product == "" {
				product = p.MatchedProduct
			}
			g = &FingerprintPocComponentGroup{Product: product, NormalizedProduct: norm, FingerRuleCount: fingerRulesByNorm[norm] + dirPathsByNorm[norm], WorkflowPocCount: workflowPocCountsByNorm[norm], Pocs: []FingerprintPocInfo{}}
			groupByNorm[norm] = g
		}
		g.Pocs = append(g.Pocs, p)
		g.PocCount++
		if p.ReferencedByWorkflow {
			g.ReferencedPocCount++
		} else {
			g.UnreferencedPocCount++
		}
		if p.Incomplete {
			g.IncompletePocCount++
		}
	}
	for _, g := range groupByNorm {
		sortFingerprintPocInfos(g.Pocs)
		res.Groups = append(res.Groups, *g)
	}
	sort.Slice(res.Groups, func(i, j int) bool {
		if res.Groups[i].PocCount == res.Groups[j].PocCount {
			return res.Groups[i].Product < res.Groups[j].Product
		}
		return res.Groups[i].PocCount > res.Groups[j].PocCount
	})
	res.ComponentCount = len(res.Groups)
	sortFingerprintPocInfos(res.UnmatchedPocs)
	sortFingerprintPocInfos(res.VirtualPocs)
	sortFingerprintPocInfos(res.IncompletePocs)
	return res, nil
}

type fingerprintMatchCandidate struct {
	Product string
	Norm    string
	Tokens  []string
	Source  string
}

type fingerprintPocMatchCandidate struct {
	Norm     string
	RuneLen  int
	TokenSet map[string]struct{}
}

func enrichFingerprintPocs(pocs []FingerprintPocInfo, recognition []fingerprintMatchCandidate, referenced map[string]map[string]struct{}, pe *progressEmitter, label string) ([]FingerprintPocInfo, error) {
	total := len(pocs)
	out := make([]FingerprintPocInfo, total)
	if total == 0 {
		return out, nil
	}
	workers := fingerprintAuditParallelism(total)
	candidates := recognition
	if pe != nil {
		pe.forceEmit(0, fmt.Sprintf("%s 0/%d，并发 %d", label, total, workers))
	}
	var next atomic.Int64
	var wg sync.WaitGroup
	results := make(chan error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				if progressCancelled(pe) {
					return
				}
				idx := int(next.Add(1) - 1)
				if idx >= total {
					return
				}
				cp, err := enrichFingerprintPoc(pocs[idx], candidates, referenced, pe)
				if err != nil {
					results <- err
					return
				}
				out[idx] = cp
				results <- nil
			}
		}()
	}
	go func() {
		wg.Wait()
		close(results)
	}()
	completed := 0
	var firstErr error
	for err := range results {
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		completed++
		if pe != nil {
			pe.tick(completed, fmt.Sprintf("%s %d/%d，并发 %d", label, completed, total, workers))
		}
	}
	if firstErr != nil {
		return nil, firstErr
	}
	if progressCancelled(pe) {
		return nil, fmt.Errorf("已取消")
	}
	sortFingerprintPocInfos(out)
	return out, nil
}

func fingerprintAuditParallelism(total int) int {
	workers := runtime.NumCPU()
	if workers < 1 {
		workers = 1
	}
	runtime.GOMAXPROCS(workers)
	if total > 0 && workers > total {
		return total
	}
	return workers
}

func fingerprintMatchCandidates(fingers []fingerEntry) []fingerprintMatchCandidate {
	out := make([]fingerprintMatchCandidate, 0, len(fingers))
	for _, f := range fingers {
		norm := normalizeFingerAuditName(f.Product)
		if norm == "" {
			continue
		}
		out = append(out, fingerprintMatchCandidate{Product: f.Product, Norm: norm, Tokens: splitAuditTokens(norm)})
	}
	return out
}

func recognitionEntries(fingers []fingerEntry, dirs []dirEntry) []fingerprintMatchCandidate {
	byNorm := map[string]fingerprintMatchCandidate{}
	for _, f := range fingers {
		norm := normalizeFingerAuditName(f.Product)
		if norm == "" {
			continue
		}
		c := byNorm[norm]
		if c.Product == "" {
			c = fingerprintMatchCandidate{Product: f.Product, Norm: norm, Tokens: splitAuditTokens(norm), Source: "finger"}
		} else if !strings.Contains(c.Source, "finger") {
			c.Source = c.Source + "+finger"
		}
		byNorm[norm] = c
	}
	for _, d := range dirs {
		norm := normalizeFingerAuditName(d.Product)
		if norm == "" {
			continue
		}
		c := byNorm[norm]
		if c.Product == "" {
			c = fingerprintMatchCandidate{Product: d.Product, Norm: norm, Tokens: splitAuditTokens(norm), Source: "dir"}
		} else if !strings.Contains(c.Source, "dir") {
			c.Source = c.Source + "+dir"
		}
		byNorm[norm] = c
	}
	out := make([]fingerprintMatchCandidate, 0, len(byNorm))
	for _, c := range byNorm {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Product < out[j].Product })
	return out
}

func enrichFingerprintPoc(p FingerprintPocInfo, fingers []fingerprintMatchCandidate, referenced map[string]map[string]struct{}, pe *progressEmitter) (FingerprintPocInfo, error) {
	if progressCancelled(pe) {
		return FingerprintPocInfo{}, fmt.Errorf("已取消")
	}
	cp := p
	productSet := map[string]struct{}{}
	for _, key := range pocAuditKeys(p) {
		for product := range referenced[key] {
			productSet[product] = struct{}{}
		}
	}
	cp.WorkflowProducts = sortedKeys(productSet)
	cp.ReferencedByWorkflow = len(cp.WorkflowProducts) > 0
	if match, ok, err := bestFingerMatchForPoc(cp, fingers, pe); err != nil {
		return FingerprintPocInfo{}, err
	} else if ok {
		cp.MatchedProduct = match.Product
		cp.MatchSource = match.Source
		cp.MatchConfidence = match.Confidence
		cp.MatchReason = match.Reason
	}
	return cp, nil
}

func pocAuditKeys(p FingerprintPocInfo) []string {
	keys := []string{normalizePocAuditKey(strings.TrimSuffix(p.Name, filepath.Ext(p.Name)))}
	if p.ID != "" {
		keys = append(keys, normalizePocAuditKey(p.ID))
	}
	return uniqueSortedStrings(keys)
}

func fingerprintPocInfoMatch(p FingerprintPocInfo) FingerprintPocFingerMatch {
	pocName := strings.TrimSuffix(p.Name, filepath.Ext(p.Name))
	if p.ID != "" {
		pocName = p.ID
	}
	return FingerprintPocFingerMatch{Product: p.MatchedProduct, Poc: pocName, PocID: p.ID, PocRelPath: p.RelPath, Confidence: p.MatchConfidence, Reason: p.MatchReason, Path: p.Path, Source: p.MatchSource}
}

func sortFingerprintPocInfos(items []FingerprintPocInfo) {
	sort.Slice(items, func(i, j int) bool {
		return items[i].RelPath < items[j].RelPath
	})
}

func sortFingerprintPocMatches(items []FingerprintPocFingerMatch) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].Product == items[j].Product {
			return items[i].PocRelPath < items[j].PocRelPath
		}
		return items[i].Product < items[j].Product
	})
}

func appendLimitedRuleIssue(items []FingerprintRuleIssue, issue FingerprintRuleIssue) []FingerprintRuleIssue {
	if len(items) >= fingerprintAuditListLimit {
		return items
	}
	return append(items, issue)
}

func progressCancelled(pe *progressEmitter) bool {
	return pe != nil && pe.ctx != nil && pe.ctx.Err() != nil
}

func bestWorkflowSuggestionForProduct(product string, pocs []FingerprintPocInfo, referenced map[string]struct{}, pe *progressEmitter) (FingerprintWorkflowSuggestion, bool, error) {
	prodNorm := normalizeFingerAuditName(product)
	if prodNorm == "" {
		return FingerprintWorkflowSuggestion{}, false, nil
	}
	best := FingerprintWorkflowSuggestion{}
	bestScore := 0
	for _, poc := range pocs {
		if progressCancelled(pe) {
			return FingerprintWorkflowSuggestion{}, false, fmt.Errorf("已取消")
		}
		keys := []string{normalizePocAuditKey(strings.TrimSuffix(poc.Name, filepath.Ext(poc.Name)))}
		if poc.ID != "" {
			keys = append(keys, normalizePocAuditKey(poc.ID))
		}
		isReferenced := false
		for _, key := range keys {
			if _, ok := referenced[key]; ok {
				isReferenced = true
				break
			}
		}
		if isReferenced {
			continue
		}
		score, reason := workflowSuggestionScore(prodNorm, poc)
		if score > bestScore {
			bestScore = score
			pocName := strings.TrimSuffix(poc.Name, filepath.Ext(poc.Name))
			if poc.ID != "" {
				pocName = poc.ID
			}
			best = FingerprintWorkflowSuggestion{Product: product, Poc: pocName, PocID: poc.ID, PocRelPath: poc.RelPath, Confidence: score, Reason: reason}
		}
	}
	if bestScore < 55 {
		return FingerprintWorkflowSuggestion{}, false, nil
	}
	return best, true, nil
}

func bestFingerMatchForPoc(poc FingerprintPocInfo, fingers []fingerprintMatchCandidate, pe *progressEmitter) (FingerprintPocFingerMatch, bool, error) {
	best := FingerprintPocFingerMatch{}
	bestScore := 0
	candidates := fingerprintPocMatchCandidates(poc)
	for i, f := range fingers {
		if i%64 == 0 && progressCancelled(pe) {
			return FingerprintPocFingerMatch{}, false, fmt.Errorf("已取消")
		}
		score, reason := workflowSuggestionScoreCandidates(f, candidates)
		if score > bestScore {
			bestScore = score
			pocName := strings.TrimSuffix(poc.Name, filepath.Ext(poc.Name))
			if poc.ID != "" {
				pocName = poc.ID
			}
			best = FingerprintPocFingerMatch{Product: f.Product, Poc: pocName, PocID: poc.ID, PocRelPath: poc.RelPath, Confidence: score, Reason: reason, Path: poc.Path, Source: f.Source}
			if f.Source != "" {
				best.Reason = strings.TrimSpace(best.Reason + " · " + f.Source + " 产品命中")
			}
		}
	}
	if bestScore < 55 {
		return FingerprintPocFingerMatch{}, false, nil
	}
	return best, true, nil
}

func workflowSuggestionScore(productNorm string, poc FingerprintPocInfo) (int, string) {
	return workflowSuggestionScoreCandidates(fingerprintMatchCandidate{Norm: productNorm, Tokens: splitAuditTokens(productNorm)}, fingerprintPocMatchCandidates(poc))
}

func fingerprintPocMatchCandidates(poc FingerprintPocInfo) []fingerprintPocMatchCandidate {
	candidates := []string{
		normalizeFingerAuditName(strings.TrimSuffix(poc.Name, filepath.Ext(poc.Name))),
		normalizeFingerAuditName(poc.ID),
		normalizeFingerAuditName(poc.InfoName),
		normalizeFingerAuditName(poc.RelPath),
	}
	for _, tag := range poc.Tags {
		candidates = append(candidates, normalizeFingerAuditName(tag))
	}
	out := make([]fingerprintPocMatchCandidate, 0, len(candidates))
	seen := map[string]struct{}{}
	for _, cand := range candidates {
		if cand == "" {
			continue
		}
		if _, ok := seen[cand]; ok {
			continue
		}
		seen[cand] = struct{}{}
		out = append(out, fingerprintPocMatchCandidate{
			Norm:     cand,
			RuneLen:  len([]rune(cand)),
			TokenSet: auditTokenSet(cand),
		})
	}
	return out
}

func workflowSuggestionScoreCandidates(product fingerprintMatchCandidate, candidates []fingerprintPocMatchCandidate) (int, string) {
	if product.Norm == "" {
		return 0, ""
	}
	best := 0
	reason := ""
	for _, cand := range candidates {
		score := 0
		switch {
		case cand.Norm == product.Norm:
			score = 95
			reason = "POC 名称/ID 与产品归一化名称完全匹配"
		case strings.Contains(cand.Norm, product.Norm):
			score = 82
			reason = "POC 名称/路径包含产品归一化名称"
		case strings.Contains(product.Norm, cand.Norm) && cand.RuneLen >= 4:
			score = 72
			reason = "产品名包含 POC 归一化名称"
		default:
			score = tokenOverlapScorePrepared(product.Tokens, cand.TokenSet)
			if score > 0 {
				reason = "产品名与 POC 名称存在关键词重合"
			}
		}
		if score > best {
			best = score
		}
	}
	return best, reason
}

func tokenOverlapScore(a, b string) int {
	tokensA := splitAuditTokens(a)
	tokensB := map[string]struct{}{}
	for _, tok := range splitAuditTokens(b) {
		tokensB[tok] = struct{}{}
	}
	matches := 0
	for _, tok := range tokensA {
		if _, ok := tokensB[tok]; ok {
			matches++
		}
	}
	if matches == 0 {
		return 0
	}
	score := 45 + matches*10
	if score > 68 {
		score = 68
	}
	return score
}

func splitAuditTokens(s string) []string {
	parts := auditTokenSplitRE.Split(strings.ToLower(s), -1)
	out := []string{}
	for _, part := range parts {
		if len(part) >= 3 {
			out = append(out, part)
		}
	}
	return out
}

func auditTokenSet(s string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, tok := range splitAuditTokens(s) {
		out[tok] = struct{}{}
	}
	return out
}

func tokenOverlapScorePrepared(tokensA []string, tokensB map[string]struct{}) int {
	matches := 0
	for _, tok := range tokensA {
		if _, ok := tokensB[tok]; ok {
			matches++
		}
	}
	if matches == 0 {
		return 0
	}
	score := 45 + matches*10
	if score > 68 {
		score = 68
	}
	return score
}

func weakFingerprintRuleReason(rule string) string {
	for _, m := range reFingerClause.FindAllStringSubmatch(rule, -1) {
		field := strings.ToLower(m[1])
		value := strings.TrimSpace(m[2])
		if field == "body" && len([]rune(value)) < 4 {
			return "body 字符串过短，容易泛匹配"
		}
		if (field == "title" || field == "header" || field == "banner") && len([]rune(value)) < 5 {
			return field + " 字符串过短，容易泛匹配"
		}
		lower := strings.ToLower(value)
		if lower == "login" || lower == "admin" || lower == "index" || lower == "welcome" {
			return field + " 命中词过于通用"
		}
	}
	return ""
}

func normalizeFingerAuditName(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "_", "-")
	s = auditWhitespaceRE.ReplaceAllString(s, " ")
	s = strings.TrimSuffix(s, "-optimize")
	s = strings.TrimSpace(s)
	return s
}

func normalizePocAuditKey(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimSuffix(s, ".yaml")
	s = strings.TrimSuffix(s, ".yml")
	return s
}

func uniqueSortedStrings(items []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(items))
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
	}
	sort.Strings(out)
	return out
}

func normalizeDirPaths(paths []string) []string {
	out := []string{}
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if !strings.HasPrefix(p, "/") && !strings.HasPrefix(p, "http://") && !strings.HasPrefix(p, "https://") {
			continue
		}
		out = append(out, p)
	}
	return uniqueSortedStrings(out)
}

func renderDirEntriesYAML(entries []dirEntry) string {
	var b strings.Builder
	for i, entry := range entries {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(yamlKey(entry.Product))
		b.WriteString(":\n")
		for _, path := range normalizeDirPaths(entry.Paths) {
			b.WriteString("  - ")
			b.WriteString(yamlKey(path))
			b.WriteByte('\n')
		}
	}
	return b.String()
}

func mergeDirEntriesForApply(existing, imported []dirEntry) ([]dirEntry, FingerprintImportApplyResult) {
	merged := make([]dirEntry, len(existing))
	copy(merged, existing)
	index := map[string]int{}
	result := FingerprintImportApplyResult{}
	for i, entry := range merged {
		norm := normalizeImportProductName(entry.Product)
		if norm != "" {
			index[norm] = i
		}
	}
	for _, entry := range imported {
		norm := normalizeImportProductName(entry.Product)
		paths := normalizeDirPaths(entry.Paths)
		if norm == "" || len(paths) == 0 {
			continue
		}
		if idx, ok := index[norm]; ok {
			before := len(merged[idx].Paths)
			added, skipped := mergeRuleList(&merged[idx].Paths, paths)
			result.RulesSkipped += skipped
			if len(merged[idx].Paths) > before {
				result.ProductsMerged++
				result.RulesAdded += added
				result.ChangedProducts = append(result.ChangedProducts, merged[idx].Product)
			}
			continue
		}
		merged = append(merged, dirEntry{Product: entry.Product, Paths: paths})
		index[norm] = len(merged) - 1
		result.ProductsCreated++
		result.RulesAdded += len(paths)
		result.ChangedProducts = append(result.ChangedProducts, entry.Product)
	}
	sort.SliceStable(merged, func(i, j int) bool { return merged[i].Product < merged[j].Product })
	result.ChangedProducts = uniqueSortedStrings(result.ChangedProducts)
	return merged, result
}

func sortedKeys(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
