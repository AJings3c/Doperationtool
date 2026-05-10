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

type FingerprintAuditResult struct {
	ProjectRoot                  string                          `json:"projectRoot"`
	FingerPath                   string                          `json:"fingerPath"`
	WorkflowPath                 string                          `json:"workflowPath"`
	PocDir                       string                          `json:"pocDir"`
	FingerCount                  int                             `json:"fingerCount"`
	FingerRuleCount              int                             `json:"fingerRuleCount"`
	WorkflowCount                int                             `json:"workflowCount"`
	WorkflowPocRefCount          int                             `json:"workflowPocRefCount"`
	PocFileCount                 int                             `json:"pocFileCount"`
	PocWithIDCount               int                             `json:"pocWithIdCount"`
	MissingPocCount              int                             `json:"missingPocCount"`
	OrphanPocCount               int                             `json:"orphanPocCount"`
	FingerWithoutWorkflowCount   int                             `json:"fingerWithoutWorkflowCount"`
	WorkflowWithoutFingerCount   int                             `json:"workflowWithoutFingerCount"`
	FingerWithoutPocCount        int                             `json:"fingerWithoutPocCount"`
	PocWithFingerNoWorkflowCount int                             `json:"pocWithFingerNoWorkflowCount"`
	PocWithoutFingerCount        int                             `json:"pocWithoutFingerCount"`
	WeakRuleCount                int                             `json:"weakRuleCount"`
	DuplicateRuleGroupCount      int                             `json:"duplicateRuleGroupCount"`
	DuplicateProductGroupCount   int                             `json:"duplicateProductGroupCount"`
	WorkflowSuggestionCount      int                             `json:"workflowSuggestionCount"`
	AssetOnlyProductCount        int                             `json:"assetOnlyProductCount"`
	MissingPocs                  []FingerprintWorkflowPoc        `json:"missingPocs"`
	OrphanPocs                   []FingerprintPocInfo            `json:"orphanPocs"`
	FingerWithoutWorkflow        []string                        `json:"fingerWithoutWorkflow"`
	WorkflowWithoutFinger        []string                        `json:"workflowWithoutFinger"`
	FingerWithoutPoc             []string                        `json:"fingerWithoutPoc"`
	PocWithFingerNoWorkflow      []FingerprintPocFingerMatch     `json:"pocWithFingerNoWorkflow"`
	PocWithoutFinger             []FingerprintPocInfo            `json:"pocWithoutFinger"`
	WeakRules                    []FingerprintRuleIssue          `json:"weakRules"`
	DuplicateRules               []FingerprintRuleDup            `json:"duplicateRules"`
	DuplicateProducts            []FingerprintNameDup            `json:"duplicateProducts"`
	WorkflowSuggestions          []FingerprintWorkflowSuggestion `json:"workflowSuggestions"`
	AssetOnlyProducts            []string                        `json:"assetOnlyProducts"`
	TopWorkflowProducts          []FingerprintCoverage           `json:"topWorkflowProducts"`
	TopFingerProducts            []FingerprintCoverage           `json:"topFingerProducts"`
	Elapsed                      string                          `json:"elapsed"`
}

type FingerprintWorkflowPoc struct {
	Product string `json:"product"`
	Poc     string `json:"poc"`
}

type FingerprintPocInfo struct {
	Path    string `json:"path"`
	RelPath string `json:"relPath"`
	Name    string `json:"name"`
	ID      string `json:"id"`
}

type FingerprintPocFingerMatch struct {
	Product    string `json:"product"`
	Poc        string `json:"poc"`
	PocID      string `json:"pocId"`
	PocRelPath string `json:"pocRelPath"`
	Confidence int    `json:"confidence"`
	Reason     string `json:"reason"`
	Path       string `json:"path"`
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

type fingerEntry struct {
	Product string
	Rules   []string
}

type workflowEntry struct {
	Product string
	Types   []string
	Pocs    []string
}

const fingerprintAuditListLimit = 200

var reFingerClause = regexp.MustCompile(`(?i)(body|title|header|banner|cert)\s*(?:=|~=)\s*"([^"]*)"`)

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
	workflowPath := filepath.Join(root, "common", "config", "workflow.yaml")
	pocDir := filepath.Join(root, "common", "config", "pocs")
	for _, p := range []string{fingerPath, workflowPath, pocDir} {
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

	pe.switchPhase("analyzing", 0)
	pe.forceEmit(0, "分析指纹 / workflow / POC 关联")
	res := buildFingerprintAudit(root, fingerPath, workflowPath, pocDir, fingers, workflows, pocs)
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
		id := ""
		if raw, readErr := os.ReadFile(path); readErr == nil {
			id = extractTopLevelId(string(raw))
		}
		pocs = append(pocs, FingerprintPocInfo{Path: path, RelPath: rel, Name: name, ID: id})
		pe.tick(len(pocs), fmt.Sprintf("已扫描 %d 个 POC", len(pocs)))
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

func buildFingerprintAudit(root, fingerPath, workflowPath, pocDir string, fingers []fingerEntry, workflows []workflowEntry, pocs []FingerprintPocInfo) *FingerprintAuditResult {
	res := &FingerprintAuditResult{
		ProjectRoot:             root,
		FingerPath:              fingerPath,
		WorkflowPath:            workflowPath,
		PocDir:                  pocDir,
		FingerCount:             len(fingers),
		WorkflowCount:           len(workflows),
		PocFileCount:            len(pocs),
		MissingPocs:             []FingerprintWorkflowPoc{},
		OrphanPocs:              []FingerprintPocInfo{},
		FingerWithoutWorkflow:   []string{},
		WorkflowWithoutFinger:   []string{},
		FingerWithoutPoc:        []string{},
		PocWithFingerNoWorkflow: []FingerprintPocFingerMatch{},
		PocWithoutFinger:        []FingerprintPocInfo{},
		WeakRules:               []FingerprintRuleIssue{},
		DuplicateRules:          []FingerprintRuleDup{},
		DuplicateProducts:       []FingerprintNameDup{},
		WorkflowSuggestions:     []FingerprintWorkflowSuggestion{},
		AssetOnlyProducts:       []string{},
		TopWorkflowProducts:     []FingerprintCoverage{},
		TopFingerProducts:       []FingerprintCoverage{},
	}

	fingerByNorm := map[string]fingerEntry{}
	workflowByNorm := map[string]workflowEntry{}
	productNames := map[string][]string{}
	ruleOwners := map[string]map[string]struct{}{}
	fingerRuleCountsByNorm := map[string]int{}
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
	for _, w := range workflows {
		for _, poc := range w.Pocs {
			key := normalizePocAuditKey(poc)
			if key == "" {
				continue
			}
			referencedPocs[key] = struct{}{}
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

	for _, p := range pocs {
		keys := []string{normalizePocAuditKey(strings.TrimSuffix(p.Name, filepath.Ext(p.Name)))}
		if p.ID != "" {
			keys = append(keys, normalizePocAuditKey(p.ID))
		}
		referenced := false
		for _, key := range keys {
			if _, ok := referencedPocs[key]; ok {
				referenced = true
				break
			}
		}
		if !referenced {
			res.OrphanPocCount++
			if len(res.OrphanPocs) < fingerprintAuditListLimit {
				res.OrphanPocs = append(res.OrphanPocs, p)
			}
			if match, ok := bestFingerMatchForPoc(p, fingers); ok {
				res.PocWithFingerNoWorkflowCount++
				if len(res.PocWithFingerNoWorkflow) < fingerprintAuditListLimit {
					res.PocWithFingerNoWorkflow = append(res.PocWithFingerNoWorkflow, match)
				}
			} else {
				res.PocWithoutFingerCount++
				if len(res.PocWithoutFinger) < fingerprintAuditListLimit {
					res.PocWithoutFinger = append(res.PocWithoutFinger, p)
				}
			}
		}
	}
	sort.Slice(res.PocWithFingerNoWorkflow, func(i, j int) bool {
		if res.PocWithFingerNoWorkflow[i].Product == res.PocWithFingerNoWorkflow[j].Product {
			return res.PocWithFingerNoWorkflow[i].PocRelPath < res.PocWithFingerNoWorkflow[j].PocRelPath
		}
		return res.PocWithFingerNoWorkflow[i].Product < res.PocWithFingerNoWorkflow[j].Product
	})
	sort.Slice(res.PocWithoutFinger, func(i, j int) bool {
		return res.PocWithoutFinger[i].RelPath < res.PocWithoutFinger[j].RelPath
	})

	suggestedProducts := map[string]struct{}{}
	for _, f := range fingers {
		norm := normalizeFingerAuditName(f.Product)
		if workflowResolvedPocCountsByNorm[norm] == 0 {
			res.FingerWithoutPocCount++
			if len(res.FingerWithoutPoc) < fingerprintAuditListLimit {
				res.FingerWithoutPoc = append(res.FingerWithoutPoc, f.Product)
			}
		}
		if _, ok := workflowByNorm[norm]; !ok {
			res.FingerWithoutWorkflowCount++
			if len(res.FingerWithoutWorkflow) < fingerprintAuditListLimit {
				res.FingerWithoutWorkflow = append(res.FingerWithoutWorkflow, f.Product)
			}
			if s, ok := bestWorkflowSuggestionForProduct(f.Product, pocs, referencedPocs); ok {
				res.WorkflowSuggestionCount++
				suggestedProducts[norm] = struct{}{}
				if len(res.WorkflowSuggestions) < fingerprintAuditListLimit {
					res.WorkflowSuggestions = append(res.WorkflowSuggestions, s)
				}
			}
		}
	}
	for _, w := range workflows {
		if _, ok := fingerByNorm[normalizeFingerAuditName(w.Product)]; !ok {
			res.WorkflowWithoutFingerCount++
			if len(res.WorkflowWithoutFinger) < fingerprintAuditListLimit {
				res.WorkflowWithoutFinger = append(res.WorkflowWithoutFinger, w.Product)
			}
		}
	}
	sort.Strings(res.FingerWithoutWorkflow)
	sort.Strings(res.FingerWithoutPoc)
	sort.Strings(res.WorkflowWithoutFinger)
	sort.Slice(res.WorkflowSuggestions, func(i, j int) bool {
		if res.WorkflowSuggestions[i].Confidence == res.WorkflowSuggestions[j].Confidence {
			return res.WorkflowSuggestions[i].Product < res.WorkflowSuggestions[j].Product
		}
		return res.WorkflowSuggestions[i].Confidence > res.WorkflowSuggestions[j].Confidence
	})
	for _, product := range res.FingerWithoutWorkflow {
		if _, ok := suggestedProducts[normalizeFingerAuditName(product)]; ok {
			continue
		}
		res.AssetOnlyProductCount++
		if len(res.AssetOnlyProducts) < fingerprintAuditListLimit {
			res.AssetOnlyProducts = append(res.AssetOnlyProducts, product)
		}
	}

	for _, w := range workflows {
		res.TopWorkflowProducts = append(res.TopWorkflowProducts, FingerprintCoverage{Product: w.Product, FingerRules: fingerRuleCountsByNorm[normalizeFingerAuditName(w.Product)], Pocs: len(w.Pocs)})
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
	sort.Slice(res.TopFingerProducts, func(i, j int) bool {
		if res.TopFingerProducts[i].FingerRules == res.TopFingerProducts[j].FingerRules {
			return res.TopFingerProducts[i].Product < res.TopFingerProducts[j].Product
		}
		return res.TopFingerProducts[i].FingerRules > res.TopFingerProducts[j].FingerRules
	})
	if len(res.TopFingerProducts) > 50 {
		res.TopFingerProducts = res.TopFingerProducts[:50]
	}

	return res
}

func appendLimitedRuleIssue(items []FingerprintRuleIssue, issue FingerprintRuleIssue) []FingerprintRuleIssue {
	if len(items) >= fingerprintAuditListLimit {
		return items
	}
	return append(items, issue)
}

func bestWorkflowSuggestionForProduct(product string, pocs []FingerprintPocInfo, referenced map[string]struct{}) (FingerprintWorkflowSuggestion, bool) {
	prodNorm := normalizeFingerAuditName(product)
	if prodNorm == "" {
		return FingerprintWorkflowSuggestion{}, false
	}
	best := FingerprintWorkflowSuggestion{}
	bestScore := 0
	for _, poc := range pocs {
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
		return FingerprintWorkflowSuggestion{}, false
	}
	return best, true
}

func bestFingerMatchForPoc(poc FingerprintPocInfo, fingers []fingerEntry) (FingerprintPocFingerMatch, bool) {
	best := FingerprintPocFingerMatch{}
	bestScore := 0
	for _, f := range fingers {
		score, reason := workflowSuggestionScore(normalizeFingerAuditName(f.Product), poc)
		if score > bestScore {
			bestScore = score
			pocName := strings.TrimSuffix(poc.Name, filepath.Ext(poc.Name))
			if poc.ID != "" {
				pocName = poc.ID
			}
			best = FingerprintPocFingerMatch{Product: f.Product, Poc: pocName, PocID: poc.ID, PocRelPath: poc.RelPath, Confidence: score, Reason: reason, Path: poc.Path}
		}
	}
	if bestScore < 55 {
		return FingerprintPocFingerMatch{}, false
	}
	return best, true
}

func workflowSuggestionScore(productNorm string, poc FingerprintPocInfo) (int, string) {
	candidates := []string{
		normalizeFingerAuditName(strings.TrimSuffix(poc.Name, filepath.Ext(poc.Name))),
		normalizeFingerAuditName(poc.ID),
		normalizeFingerAuditName(poc.RelPath),
	}
	best := 0
	reason := ""
	for _, cand := range candidates {
		if cand == "" {
			continue
		}
		score := 0
		switch {
		case cand == productNorm:
			score = 95
			reason = "POC 名称/ID 与产品归一化名称完全匹配"
		case strings.Contains(cand, productNorm):
			score = 82
			reason = "POC 名称/路径包含产品归一化名称"
		case strings.Contains(productNorm, cand) && len([]rune(cand)) >= 4:
			score = 72
			reason = "产品名包含 POC 归一化名称"
		default:
			score = tokenOverlapScore(productNorm, cand)
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
	parts := regexp.MustCompile(`[^a-z0-9]+`).Split(strings.ToLower(s), -1)
	out := []string{}
	for _, part := range parts {
		if len(part) >= 3 {
			out = append(out, part)
		}
	}
	return out
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
	s = regexp.MustCompile(`\s+`).ReplaceAllString(s, " ")
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

func sortedKeys(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
