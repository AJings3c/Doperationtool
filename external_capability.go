package main

import (
	"context"
	"crypto/sha1"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type ReviewRemovedItem struct {
	Path    string `json:"path"`
	RelPath string `json:"relPath"`
	Reason  string `json:"reason"`
}

type SavedReviewResult struct {
	Dir     string `json:"dir"`
	Kind    string `json:"kind"`
	Count   int    `json:"count"`
	LogPath string `json:"logPath"`
}

type SaveExternalPocReviewRequest struct {
	ProjectRoot string                    `json:"projectRoot"`
	SourceDir   string                    `json:"sourceDir"`
	Items       []FingerprintPocInfo      `json:"items"`
	Duplicates  []FingerprintPocDuplicate `json:"duplicates"`
	Removed     []ReviewRemovedItem       `json:"removed"`
}

type storedPocReview struct {
	Kind        string                    `json:"kind"`
	CreatedAt   string                    `json:"createdAt"`
	ProjectRoot string                    `json:"projectRoot"`
	SourceDir   string                    `json:"sourceDir"`
	Items       []FingerprintPocInfo      `json:"items"`
	Duplicates  []FingerprintPocDuplicate `json:"duplicates"`
	Removed     []ReviewRemovedItem       `json:"removed"`
}

type SaveExternalFingerprintReviewRequest struct {
	ProjectRoot string                  `json:"projectRoot"`
	SourceDir   string                  `json:"sourceDir"`
	Items       []FingerprintImportItem `json:"items"`
	DDDDYaml    string                  `json:"ddddYaml"`
	Removed     []ReviewRemovedItem     `json:"removed"`
}

type storedFingerReview struct {
	Kind        string                  `json:"kind"`
	CreatedAt   string                  `json:"createdAt"`
	ProjectRoot string                  `json:"projectRoot"`
	SourceDir   string                  `json:"sourceDir"`
	Items       []FingerprintImportItem `json:"items"`
	DDDDYaml    string                  `json:"ddddYaml"`
	Removed     []ReviewRemovedItem     `json:"removed"`
}

type ExternalCapabilityScanResult struct {
	ProjectRoot       string               `json:"projectRoot"`
	PocReviewDir      string               `json:"pocReviewDir"`
	FingerReviewDir   string               `json:"fingerReviewDir"`
	NewFingerProducts int                  `json:"newFingerProducts"`
	NewFingerRules    int                  `json:"newFingerRules"`
	NewPocCount       int                  `json:"newPocCount"`
	NewFingerYaml     string               `json:"newFingerYaml"`
	NewFingers        []fingerEntryView    `json:"newFingers"`
	NewPocs           []ExternalPocNewItem `json:"newPocs"`
	PocApplyPlan      []ExternalPocPlan    `json:"pocApplyPlan"`
	LogPath           string               `json:"logPath"`
}

type fingerEntryView struct {
	Product string   `json:"product"`
	Rules   []string `json:"rules"`
}

type ExternalPocNewItem struct {
	Path            string `json:"path"`
	RelPath         string `json:"relPath"`
	Name            string `json:"name"`
	ID              string `json:"id"`
	InfoName        string `json:"infoName"`
	MatchedProduct  string `json:"matchedProduct"`
	MatchConfidence int    `json:"matchConfidence"`
	ContentHash     string `json:"contentHash"`
	Duplicate       bool   `json:"duplicate"`
}

type ExternalPocPlan struct {
	SourcePath      string `json:"sourcePath"`
	SourceRelPath   string `json:"sourceRelPath"`
	TargetPath      string `json:"targetPath"`
	TargetName      string `json:"targetName"`
	Product         string `json:"product"`
	ID              string `json:"id"`
	ConflictRenamed bool   `json:"conflictRenamed"`
}

type ApplyExternalCapabilityRequest struct {
	ProjectRoot   string               `json:"projectRoot"`
	NewFingerYaml string               `json:"newFingerYaml"`
	NewPocs       []ExternalPocNewItem `json:"newPocs"`
	Confirm       bool                 `json:"confirm"`
	Confirmation  string               `json:"confirmation"`
}

type ApplyExternalCapabilityResult struct {
	FingerBackupPath   string                          `json:"fingerBackupPath"`
	WorkflowBackupPath string                          `json:"workflowBackupPath"`
	PocTargetDir       string                          `json:"pocTargetDir"`
	ProductsCreated    int                             `json:"productsCreated"`
	ProductsMerged     int                             `json:"productsMerged"`
	RulesAdded         int                             `json:"rulesAdded"`
	RulesSkipped       int                             `json:"rulesSkipped"`
	PocsCopied         int                             `json:"pocsCopied"`
	WorkflowProducts   int                             `json:"workflowProducts"`
	LogPath            string                          `json:"logPath"`
	ChangedProducts    []string                        `json:"changedProducts"`
	PocApplyPlan       []ExternalPocPlan               `json:"pocApplyPlan"`
	PostAudit          *ExternalCapabilityAuditSummary `json:"postAudit,omitempty"`
	PostAuditError     string                          `json:"postAuditError,omitempty"`
}

type ExternalCapabilityAuditSummary struct {
	Passed                     bool   `json:"passed"`
	IssueCount                 int    `json:"issueCount"`
	MissingPocCount            int    `json:"missingPocCount"`
	VirtualPocCount            int    `json:"virtualPocCount"`
	IncompletePocCount         int    `json:"incompletePocCount"`
	PocWithoutFingerCount      int    `json:"pocWithoutFingerCount"`
	FingerWithoutPocCount      int    `json:"fingerWithoutPocCount"`
	WorkflowSuggestionCount    int    `json:"workflowSuggestionCount"`
	FingerWithoutWorkflowCount int    `json:"fingerWithoutWorkflowCount"`
	WorkflowWithoutFingerCount int    `json:"workflowWithoutFingerCount"`
	Elapsed                    string `json:"elapsed"`
}

func (a *App) SaveExternalPocReview(req SaveExternalPocReviewRequest) (*SavedReviewResult, error) {
	if len(req.Items) == 0 {
		return nil, fmt.Errorf("没有可保存的 POC 审核项")
	}
	dir, err := datedReviewDir("poc")
	if err != nil {
		return nil, err
	}
	pocDir := filepath.Join(dir, "pocs")
	if err := os.MkdirAll(pocDir, 0o755); err != nil {
		return nil, err
	}
	copied := make([]FingerprintPocInfo, 0, len(req.Items))
	used := map[string]int{}
	for _, item := range req.Items {
		if strings.TrimSpace(item.Path) == "" {
			continue
		}
		product := item.MatchedProduct
		if product == "" {
			product = "unmatched"
		}
		targetDir := filepath.Join(pocDir, safePathName(product))
		if err := os.MkdirAll(targetDir, 0o755); err != nil {
			return nil, err
		}
		name := safePathName(filepath.Base(item.Path))
		if name == "" || name == "." {
			name = "poc.yaml"
		}
		target := uniqueTargetPath(targetDir, name, used)
		if err := copyFile(item.Path, target); err != nil {
			return nil, fmt.Errorf("复制 POC 失败 %s: %v", item.Path, err)
		}
		cp := item
		cp.Path = target
		if rel, relErr := filepath.Rel(dir, target); relErr == nil {
			cp.RelPath = filepath.ToSlash(rel)
		}
		copied = append(copied, cp)
	}
	review := storedPocReview{
		Kind:        "poc",
		CreatedAt:   time.Now().Format(time.RFC3339),
		ProjectRoot: req.ProjectRoot,
		SourceDir:   req.SourceDir,
		Items:       copied,
		Duplicates:  req.Duplicates,
		Removed:     req.Removed,
	}
	if err := writeJSON(filepath.Join(dir, "review.json"), review); err != nil {
		return nil, err
	}
	logPath := filepath.Join(dir, "operation_log.jsonl")
	appendReviewLog(logPath, "save_poc_review", map[string]any{"sourceDir": req.SourceDir, "kept": len(copied), "removed": len(req.Removed), "duplicates": len(req.Duplicates)})
	return &SavedReviewResult{Dir: dir, Kind: "poc", Count: len(copied), LogPath: logPath}, nil
}

func (a *App) SaveExternalFingerprintReview(req SaveExternalFingerprintReviewRequest) (*SavedReviewResult, error) {
	if strings.TrimSpace(req.DDDDYaml) == "" {
		return nil, fmt.Errorf("没有可保存的指纹 YAML")
	}
	dir, err := datedReviewDir("finger")
	if err != nil {
		return nil, err
	}
	yamlText := strings.TrimRight(req.DDDDYaml, "\n") + "\n"
	if err := os.WriteFile(filepath.Join(dir, "finger.yaml"), []byte(yamlText), 0o644); err != nil {
		return nil, err
	}
	review := storedFingerReview{
		Kind:        "finger",
		CreatedAt:   time.Now().Format(time.RFC3339),
		ProjectRoot: req.ProjectRoot,
		SourceDir:   req.SourceDir,
		Items:       req.Items,
		DDDDYaml:    yamlText,
		Removed:     req.Removed,
	}
	if err := writeJSON(filepath.Join(dir, "review.json"), review); err != nil {
		return nil, err
	}
	logPath := filepath.Join(dir, "operation_log.jsonl")
	appendReviewLog(logPath, "save_finger_review", map[string]any{"sourceDir": req.SourceDir, "products": len(req.Items), "removed": len(req.Removed)})
	return &SavedReviewResult{Dir: dir, Kind: "finger", Count: len(req.Items), LogPath: logPath}, nil
}

func (a *App) ScanExternalCapability(projectRoot, pocReviewDir, fingerReviewDir string) (*ExternalCapabilityScanResult, error) {
	root := strings.TrimSpace(projectRoot)
	if root == "" {
		return nil, fmt.Errorf("dddd 根目录为空")
	}
	fingerPath := filepath.Join(root, "common", "config", "finger.yaml")
	pocDir := filepath.Join(root, "common", "config", "pocs")
	existingFingers, err := loadFingerEntries(context.Background(), fingerPath)
	if err != nil {
		return nil, err
	}
	existingPocs, err := scanFingerprintPocs(context.Background(), nil, pocDir)
	if err != nil {
		return nil, err
	}
	res := &ExternalCapabilityScanResult{
		ProjectRoot:     root,
		PocReviewDir:    strings.TrimSpace(pocReviewDir),
		FingerReviewDir: strings.TrimSpace(fingerReviewDir),
		NewFingers:      []fingerEntryView{},
		NewPocs:         []ExternalPocNewItem{},
	}
	if res.FingerReviewDir != "" {
		imported, err := loadReviewedFingerEntries(res.FingerReviewDir)
		if err != nil {
			return nil, err
		}
		diff := diffFingerEntries(existingFingers, imported)
		for _, entry := range diff {
			res.NewFingers = append(res.NewFingers, fingerEntryView{Product: entry.Product, Rules: entry.Rules})
			res.NewFingerRules += len(entry.Rules)
		}
		res.NewFingerProducts = len(res.NewFingers)
		res.NewFingerYaml = renderFingerEntriesYAML(diff)
	}
	if res.PocReviewDir != "" {
		review, err := loadReviewedPocs(res.PocReviewDir)
		if err != nil {
			return nil, err
		}
		existingKeys := pocKeySet(existingPocs)
		for _, p := range review.Items {
			if p.Duplicate {
				continue
			}
			if pocExistsInSet(p, existingKeys) {
				continue
			}
			res.NewPocs = append(res.NewPocs, ExternalPocNewItem{
				Path:            p.Path,
				RelPath:         p.RelPath,
				Name:            p.Name,
				ID:              p.ID,
				InfoName:        p.InfoName,
				MatchedProduct:  p.MatchedProduct,
				MatchConfidence: p.MatchConfidence,
				ContentHash:     p.ContentHash,
				Duplicate:       p.Duplicate,
			})
		}
		sort.Slice(res.NewPocs, func(i, j int) bool { return res.NewPocs[i].RelPath < res.NewPocs[j].RelPath })
		res.NewPocCount = len(res.NewPocs)
		res.PocApplyPlan = planExternalPocCopies(root, res.NewPocs)
	}
	if res.PocReviewDir != "" {
		res.LogPath = filepath.Join(res.PocReviewDir, "operation_log.jsonl")
	} else if res.FingerReviewDir != "" {
		res.LogPath = filepath.Join(res.FingerReviewDir, "operation_log.jsonl")
	}
	if res.LogPath != "" {
		appendReviewLog(res.LogPath, "scan_external_capability", map[string]any{"projectRoot": root, "newFingerProducts": res.NewFingerProducts, "newFingerRules": res.NewFingerRules, "newPocs": res.NewPocCount})
	}
	return res, nil
}

func (a *App) ApplyExternalCapability(req ApplyExternalCapabilityRequest) (*ApplyExternalCapabilityResult, error) {
	if !req.Confirm || strings.TrimSpace(req.Confirmation) != "APPLY_EXTERNAL_CAPABILITY" {
		return nil, fmt.Errorf("需要显式确认 APPLY_EXTERNAL_CAPABILITY")
	}
	root := strings.TrimSpace(req.ProjectRoot)
	if root == "" {
		return nil, fmt.Errorf("dddd 根目录为空")
	}
	start := time.Now()
	fingerPath := filepath.Join(root, "common", "config", "finger.yaml")
	workflowPath := filepath.Join(root, "common", "config", "workflow.yaml")
	rawFinger, err := os.ReadFile(fingerPath)
	if err != nil {
		return nil, fmt.Errorf("读取 finger.yaml 失败: %v", err)
	}
	existingFingers, err := parseFingerEntriesFromYAML(rawFinger, "finger.yaml")
	if err != nil {
		return nil, err
	}
	importedFingers := []fingerEntry{}
	if strings.TrimSpace(req.NewFingerYaml) != "" {
		importedFingers, err = parseFingerEntriesFromYAML([]byte(req.NewFingerYaml), "新增 finger.yaml")
		if err != nil {
			return nil, err
		}
	}
	mergedFingers, fingerResult := mergeFingerEntriesForApply(existingFingers, importedFingers)
	res := &ApplyExternalCapabilityResult{ChangedProducts: fingerResult.ChangedProducts}
	if len(importedFingers) > 0 {
		fingerBackup := fingerPath + "." + start.Format("20060102-150405") + ".bak"
		if err := os.WriteFile(fingerBackup, rawFinger, 0o644); err != nil {
			return nil, fmt.Errorf("备份 finger.yaml 失败: %v", err)
		}
		if err := os.WriteFile(fingerPath, []byte(renderFingerEntriesYAML(mergedFingers)), 0o644); err != nil {
			return nil, fmt.Errorf("写回 finger.yaml 失败: %v", err)
		}
		res.FingerBackupPath = fingerBackup
		res.ProductsCreated = fingerResult.ProductsCreated
		res.ProductsMerged = fingerResult.ProductsMerged
		res.RulesAdded = fingerResult.RulesAdded
		res.RulesSkipped = fingerResult.RulesSkipped
	}
	if len(req.NewPocs) > 0 {
		targetDir := filepath.Join(root, "common", "config", "pocs")
		if err := os.MkdirAll(targetDir, 0o755); err != nil {
			return nil, err
		}
		plan := planExternalPocCopies(root, req.NewPocs)
		res.PocApplyPlan = plan
		copiedNamesByProduct := map[string][]string{}
		for i, p := range req.NewPocs {
			if i >= len(plan) {
				break
			}
			dst := plan[i].TargetPath
			if err := copyFile(p.Path, dst); err != nil {
				return nil, fmt.Errorf("复制 POC 失败 %s: %v", p.Path, err)
			}
			pocName := strings.TrimSuffix(filepath.Base(dst), filepath.Ext(dst))
			product := plan[i].Product
			if product != "" {
				copiedNamesByProduct[product] = append(copiedNamesByProduct[product], pocName)
			}
			res.PocsCopied++
		}
		res.PocTargetDir = targetDir
		if len(copiedNamesByProduct) > 0 {
			rawWorkflow, err := os.ReadFile(workflowPath)
			if err != nil {
				return nil, fmt.Errorf("读取 workflow.yaml 失败: %v", err)
			}
			workflows, err := loadWorkflowEntries(context.Background(), workflowPath)
			if err != nil {
				return nil, err
			}
			mergedWorkflows, changed := mergeWorkflowPocs(workflows, copiedNamesByProduct)
			if changed > 0 {
				workflowBackup := workflowPath + "." + start.Format("20060102-150405") + ".bak"
				if err := os.WriteFile(workflowBackup, rawWorkflow, 0o644); err != nil {
					return nil, fmt.Errorf("备份 workflow.yaml 失败: %v", err)
				}
				if err := os.WriteFile(workflowPath, []byte(renderWorkflowEntriesYAML(mergedWorkflows)), 0o644); err != nil {
					return nil, fmt.Errorf("写回 workflow.yaml 失败: %v", err)
				}
				res.WorkflowBackupPath = workflowBackup
				res.WorkflowProducts = changed
			}
		}
	}
	logPath := filepath.Join(root, "Doperationtool-merge-"+start.Format("20060102")+".jsonl")
	appendReviewLog(logPath, "apply_external_capability", map[string]any{"productsCreated": res.ProductsCreated, "productsMerged": res.ProductsMerged, "rulesAdded": res.RulesAdded, "pocsCopied": res.PocsCopied, "workflowProducts": res.WorkflowProducts})
	res.LogPath = logPath
	if audit, auditErr := a.AuditFingerprintKnowledge(root); auditErr != nil {
		res.PostAuditError = auditErr.Error()
	} else {
		res.PostAudit = summarizeExternalCapabilityAudit(audit)
		appendReviewLog(logPath, "post_apply_audit", map[string]any{"passed": res.PostAudit.Passed, "issues": res.PostAudit.IssueCount, "missingPocs": res.PostAudit.MissingPocCount, "virtualPocs": res.PostAudit.VirtualPocCount, "incompletePocs": res.PostAudit.IncompletePocCount})
	}
	return res, nil
}

func planExternalPocCopies(root string, pocs []ExternalPocNewItem) []ExternalPocPlan {
	targetDir := filepath.Join(root, "common", "config", "pocs")
	used := map[string]int{}
	plans := make([]ExternalPocPlan, 0, len(pocs))
	for _, p := range pocs {
		name := safeExternalPocTargetName(p)
		target := uniqueAvailableTargetPath(targetDir, name, used)
		product := p.MatchedProduct
		if product == "" {
			product = productNameFromFilename(strings.TrimSuffix(filepath.Base(target), filepath.Ext(target)))
		}
		plans = append(plans, ExternalPocPlan{
			SourcePath:      p.Path,
			SourceRelPath:   p.RelPath,
			TargetPath:      target,
			TargetName:      filepath.Base(target),
			Product:         product,
			ID:              p.ID,
			ConflictRenamed: filepath.Base(target) != name,
		})
	}
	return plans
}

func safeExternalPocTargetName(p ExternalPocNewItem) string {
	name := safePathName(filepath.Base(p.Path))
	if strings.TrimSpace(p.ID) != "" {
		name = safePathName(p.ID)
		if filepath.Ext(name) == "" {
			name += ".yaml"
		}
	}
	if name == "" || name == "." {
		name = "poc.yaml"
	}
	return name
}

func summarizeExternalCapabilityAudit(audit *FingerprintAuditResult) *ExternalCapabilityAuditSummary {
	if audit == nil {
		return nil
	}
	issueCount := audit.MissingPocCount +
		audit.VirtualPocCount +
		audit.IncompletePocCount +
		audit.PocWithoutFingerCount +
		audit.FingerWithoutPocCount +
		audit.WorkflowSuggestionCount +
		audit.FingerWithoutWorkflowCount +
		audit.WorkflowWithoutFingerCount
	return &ExternalCapabilityAuditSummary{
		Passed:                     issueCount == 0,
		IssueCount:                 issueCount,
		MissingPocCount:            audit.MissingPocCount,
		VirtualPocCount:            audit.VirtualPocCount,
		IncompletePocCount:         audit.IncompletePocCount,
		PocWithoutFingerCount:      audit.PocWithoutFingerCount,
		FingerWithoutPocCount:      audit.FingerWithoutPocCount,
		WorkflowSuggestionCount:    audit.WorkflowSuggestionCount,
		FingerWithoutWorkflowCount: audit.FingerWithoutWorkflowCount,
		WorkflowWithoutFingerCount: audit.WorkflowWithoutFingerCount,
		Elapsed:                    audit.Elapsed,
	}
}

func datedReviewDir(kind string) (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	base := filepath.Join(cwd, time.Now().Format("20060102")+"_"+kind)
	dir := base
	if _, err := os.Stat(dir); err == nil {
		dir = base + "_" + time.Now().Format("150405")
	}
	return dir, os.MkdirAll(dir, 0o755)
}

func writeJSON(path string, v any) error {
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(raw, '\n'), 0o644)
}

func appendReviewLog(path, action string, details map[string]any) {
	if path == "" {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	entry := map[string]any{"time": time.Now().Format(time.RFC3339), "action": action, "details": details}
	raw, err := json.Marshal(entry)
	if err != nil {
		return
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(raw, '\n'))
}

func safePathName(s string) string {
	s = strings.TrimSpace(s)
	repl := strings.NewReplacer("\\", "_", "/", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	s = repl.Replace(s)
	s = strings.Trim(s, ". ")
	if len([]rune(s)) > 120 {
		rs := []rune(s)
		s = string(rs[:120])
	}
	return s
}

func uniqueTargetPath(dir, name string, used map[string]int) string {
	return uniqueTargetPathInternal(dir, name, used, false)
}

func uniqueAvailableTargetPath(dir, name string, used map[string]int) string {
	return uniqueTargetPathInternal(dir, name, used, true)
}

func uniqueTargetPathInternal(dir, name string, used map[string]int, avoidExisting bool) string {
	base := strings.TrimSuffix(name, filepath.Ext(name))
	ext := filepath.Ext(name)
	for n := 0; ; n++ {
		candidate := name
		if n > 0 {
			candidate = fmt.Sprintf("%s-%d%s", base, n+1, ext)
		}
		target := filepath.Join(dir, candidate)
		key := strings.ToLower(target)
		if used[key] > 0 {
			continue
		}
		if avoidExisting {
			if _, err := os.Stat(target); err == nil || !os.IsNotExist(err) {
				continue
			}
		}
		used[key] = 1
		return target
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

func loadReviewedFingerEntries(dir string) ([]fingerEntry, error) {
	path := filepath.Join(dir, "finger.yaml")
	if raw, err := os.ReadFile(path); err == nil {
		return parseFingerEntriesFromYAML(raw, path)
	}
	var review storedFingerReview
	if err := readJSON(filepath.Join(dir, "review.json"), &review); err != nil {
		return nil, err
	}
	return parseFingerEntriesFromYAML([]byte(review.DDDDYaml), filepath.Join(dir, "review.json"))
}

func loadReviewedPocs(dir string) (*storedPocReview, error) {
	var review storedPocReview
	if err := readJSON(filepath.Join(dir, "review.json"), &review); err != nil {
		return nil, err
	}
	return &review, nil
}

func readJSON(path string, v any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, v)
}

func diffFingerEntries(existing, imported []fingerEntry) []fingerEntry {
	existingByNorm := map[string]map[string]struct{}{}
	productByNorm := map[string]string{}
	for _, e := range existing {
		norm := normalizeImportProductName(e.Product)
		if norm == "" {
			continue
		}
		if existingByNorm[norm] == nil {
			existingByNorm[norm] = map[string]struct{}{}
			productByNorm[norm] = e.Product
		}
		for _, r := range e.Rules {
			existingByNorm[norm][strings.TrimSpace(r)] = struct{}{}
		}
	}
	out := []fingerEntry{}
	for _, entry := range imported {
		norm := normalizeImportProductName(entry.Product)
		if norm == "" {
			continue
		}
		product := entry.Product
		if productByNorm[norm] != "" {
			product = productByNorm[norm]
		}
		rules := []string{}
		for _, r := range uniqueSortedStrings(entry.Rules) {
			if _, ok := existingByNorm[norm][strings.TrimSpace(r)]; ok {
				continue
			}
			rules = append(rules, r)
		}
		if len(rules) > 0 {
			out = append(out, fingerEntry{Product: product, Rules: rules})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Product < out[j].Product })
	return out
}

func pocKeySet(pocs []FingerprintPocInfo) map[string]struct{} {
	out := map[string]struct{}{}
	for _, p := range pocs {
		for _, key := range pocAuditKeys(p) {
			out["key:"+key] = struct{}{}
		}
		if p.ContentHash != "" {
			out["sha1:"+p.ContentHash] = struct{}{}
		}
	}
	return out
}

func pocExistsInSet(p FingerprintPocInfo, set map[string]struct{}) bool {
	for _, key := range pocAuditKeys(p) {
		if _, ok := set["key:"+key]; ok {
			return true
		}
	}
	if p.ContentHash == "" && p.Path != "" {
		if raw, err := os.ReadFile(p.Path); err == nil {
			sum := sha1.Sum(raw)
			p.ContentHash = fmt.Sprintf("%x", sum[:])
		}
	}
	if p.ContentHash != "" {
		_, ok := set["sha1:"+p.ContentHash]
		return ok
	}
	return false
}

func mergeWorkflowPocs(existing []workflowEntry, incoming map[string][]string) ([]workflowEntry, int) {
	merged := make([]workflowEntry, len(existing))
	copy(merged, existing)
	index := map[string]int{}
	for i, w := range merged {
		norm := normalizeImportProductName(w.Product)
		if norm != "" {
			index[norm] = i
		}
	}
	changed := 0
	for product, pocs := range incoming {
		norm := normalizeImportProductName(product)
		if norm == "" {
			continue
		}
		idx, ok := index[norm]
		if !ok {
			merged = append(merged, workflowEntry{Product: product, Types: []string{"http"}, Pocs: uniqueSortedStrings(pocs)})
			index[norm] = len(merged) - 1
			changed++
			continue
		}
		before := len(merged[idx].Pocs)
		_, _ = mergeRuleList(&merged[idx].Pocs, pocs)
		if len(merged[idx].Pocs) > before {
			changed++
		}
		if len(merged[idx].Types) == 0 {
			merged[idx].Types = []string{"http"}
		}
	}
	sort.SliceStable(merged, func(i, j int) bool { return merged[i].Product < merged[j].Product })
	return merged, changed
}

func renderWorkflowEntriesYAML(entries []workflowEntry) string {
	var b strings.Builder
	for i, entry := range entries {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(yamlKey(entry.Product))
		b.WriteString(":\n")
		types := uniqueSortedStrings(entry.Types)
		if len(types) == 0 {
			types = []string{"http"}
		}
		b.WriteString("  type:\n")
		for _, t := range types {
			b.WriteString("    - ")
			b.WriteString(yamlKey(t))
			b.WriteByte('\n')
		}
		b.WriteString("  pocs:\n")
		for _, poc := range uniqueSortedStrings(entry.Pocs) {
			b.WriteString("    - ")
			b.WriteString(yamlKey(poc))
			b.WriteByte('\n')
		}
	}
	return strings.TrimRight(b.String(), "\n") + "\n"
}
