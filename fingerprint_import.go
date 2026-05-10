package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

type FingerprintImportPreviewResult struct {
	SourceDir            string                       `json:"sourceDir"`
	ProjectRoot          string                       `json:"projectRoot"`
	TargetFingerPath     string                       `json:"targetFingerPath"`
	ScannedFiles         int                          `json:"scannedFiles"`
	ParsedFiles          int                          `json:"parsedFiles"`
	SkippedFiles         int                          `json:"skippedFiles"`
	CandidateCount       int                          `json:"candidateCount"`
	ProductCount         int                          `json:"productCount"`
	RuleCount            int                          `json:"ruleCount"`
	HighConfidenceCount  int                          `json:"highConfidenceCount"`
	GenericRuleCount     int                          `json:"genericRuleCount"`
	DuplicateRuleCount   int                          `json:"duplicateRuleCount"`
	MergeSuggestionCount int                          `json:"mergeSuggestionCount"`
	Items                []FingerprintImportItem      `json:"items"`
	DuplicateRules       []FingerprintRuleDup         `json:"duplicateRules"`
	MergeSuggestions     []FingerprintMergeSuggestion `json:"mergeSuggestions"`
	Skipped              []FingerprintImportSkip      `json:"skipped"`
	DDDDYaml             string                       `json:"ddddYaml"`
	PatchPreview         string                       `json:"patchPreview"`
	Elapsed              string                       `json:"elapsed"`
}

type FingerprintImportApplyRequest struct {
	ProjectRoot  string `json:"projectRoot"`
	DDDDYaml     string `json:"ddddYaml"`
	Confirm      bool   `json:"confirm"`
	Confirmation string `json:"confirmation"`
}

type FingerprintImportApplyResult struct {
	TargetFingerPath string   `json:"targetFingerPath"`
	BackupPath       string   `json:"backupPath"`
	ProductsCreated  int      `json:"productsCreated"`
	ProductsMerged   int      `json:"productsMerged"`
	RulesAdded       int      `json:"rulesAdded"`
	RulesSkipped     int      `json:"rulesSkipped"`
	ChangedProducts  []string `json:"changedProducts"`
	Elapsed          string   `json:"elapsed"`
}

type FingerprintImportItem struct {
	Product           string                  `json:"product"`
	NormalizedProduct string                  `json:"normalizedProduct"`
	SourcePath        string                  `json:"sourcePath"`
	RelPath           string                  `json:"relPath"`
	SourceFormat      string                  `json:"sourceFormat"`
	QualityScore      int                     `json:"qualityScore"`
	Quality           string                  `json:"quality"`
	Rules             []FingerprintImportRule `json:"rules"`
	Warnings          []string                `json:"warnings"`
}

type FingerprintImportRule struct {
	Expression string   `json:"expression"`
	Field      string   `json:"field"`
	Operator   string   `json:"operator"`
	Value      string   `json:"value"`
	Weight     int      `json:"weight"`
	Quality    string   `json:"quality"`
	Generic    bool     `json:"generic"`
	Reasons    []string `json:"reasons"`
	Original   string   `json:"original"`
	Source     string   `json:"source"`
}

type FingerprintMergeSuggestion struct {
	NormalizedProduct string   `json:"normalizedProduct"`
	Products          []string `json:"products"`
	Existing          []string `json:"existing"`
	Imported          []string `json:"imported"`
}

type FingerprintImportSkip struct {
	Path    string `json:"path"`
	RelPath string `json:"relPath"`
	Reason  string `json:"reason"`
}

type rawFingerprintImport struct {
	Product string
	Rules   []rawFingerprintRule
	Path    string
	RelPath string
	Format  string
}

type rawFingerprintRule struct {
	Expression string
	Original   string
	Source     string
}

const (
	fingerprintImportLimit     = 50000
	fingerprintImportListLimit = 500
	fingerprintImportMaxBytes  = 4 * 1024 * 1024
)

var (
	reDDDDExprClause      = regexp.MustCompile(`(?i)(body_hash|icon_hash|body|title|header|banner|cert)\s*(=|~=)\s*"([^"]*)"`)
	reWhitespace          = regexp.MustCompile(`\s+`)
	reProductNoise        = regexp.MustCompile(`(?i)^(name|product|app|cms|rules?|fingerprints?|matches|matchers|keywords?|headers?|html|scripts?|meta|description|version|author|type|condition|logic)$`)
	rePossibleRuleKey     = regexp.MustCompile(`(?i)(body|html|title|header|banner|cert|favicon|icon|hash|keyword|keywords|regex|regexp|rules?|match|matcher|fingerprint|fofa|hunter|condition|expression)`)
	reGenericSplit        = regexp.MustCompile(`[\r\n]+`)
	reQuoteValue          = regexp.MustCompile(`"([^"]{3,})"`)
	reSingleQuoteValue    = regexp.MustCompile(`'([^']{3,})'`)
	reNumericHash         = regexp.MustCompile(`^-?\d{4,}$`)
	reHexHash             = regexp.MustCompile(`(?i)^[a-f0-9]{16,64}$`)
	reCommonVersionSuffix = regexp.MustCompile(`(?i)\s+(v?\d+(?:\.\d+){0,3}|community|enterprise|ce|ee|open source|商业版|企业版)$`)
	reKnownExprField      = regexp.MustCompile(`(?i)\b(favicon_hash|favicon|iconhash|icon|bodyhash|body_hash|html|keyword|keywords|body|title|header|banner|cert)\s*(=|~=)\s*"`)
	reContainsCall        = regexp.MustCompile(`(?i)(contains|regex)\s*\(\s*(body|html|title|header|banner|cert)\s*,\s*["']([^"']+)["']\s*\)`)
	reAfrogResponseCall   = regexp.MustCompile(`(?is)response\.(body|raw_header|header|headers\[[^\]]+\]|content_type|title|cert|banner)\s*\.\s*([a-z_]*contains|[a-z_]*matches|regex)\s*\(\s*b?\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`)
	reAfrogReverseMatch   = regexp.MustCompile(`(?is)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\.\s*([a-z_]*matches|regex)\s*\(\s*response\.(body|raw_header|header|headers\[[^\]]+\]|content_type|title|cert|banner)\s*\)`)
	reAfrogResponseEquals = regexp.MustCompile(`(?is)response\.(body|raw_header|header|headers\[[^\]]+\]|content_type|title|cert|banner)\s*(==|=~)\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`)
	reHTMLTitleValue      = regexp.MustCompile(`(?is)<title>\s*(.*?)\s*</title>`)
)

func (a *App) PreviewFingerprintImport(projectRoot, sourceDir string) (*FingerprintImportPreviewResult, error) {
	start := time.Now()
	source := strings.TrimSpace(sourceDir)
	if source == "" {
		return nil, fmt.Errorf("指纹来源目录为空")
	}
	info, err := os.Stat(source)
	if err != nil {
		return nil, fmt.Errorf("指纹来源目录不可访问: %v", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("不是目录: %s", source)
	}

	root := strings.TrimSpace(projectRoot)
	targetFingerPath := ""
	var existing []fingerEntry
	if root != "" {
		if st, statErr := os.Stat(root); statErr != nil {
			return nil, fmt.Errorf("dddd 根目录不可访问: %v", statErr)
		} else if !st.IsDir() {
			return nil, fmt.Errorf("dddd 根目录不是目录: %s", root)
		}
		targetFingerPath = filepath.Join(root, "common", "config", "finger.yaml")
		if _, statErr := os.Stat(targetFingerPath); statErr == nil {
			existing, err = loadFingerEntries(context.Background(), targetFingerPath)
			if err != nil {
				return nil, err
			}
		}
	}

	ctx, pe, cleanup := a.beginTask("fingerprint:import:progress", "scanning", 0)
	defer cleanup()
	defer pe.finish("导入预览完成")

	res := &FingerprintImportPreviewResult{
		SourceDir:        source,
		ProjectRoot:      root,
		TargetFingerPath: targetFingerPath,
		Items:            []FingerprintImportItem{},
		DuplicateRules:   []FingerprintRuleDup{},
		MergeSuggestions: []FingerprintMergeSuggestion{},
		Skipped:          []FingerprintImportSkip{},
	}

	rawItems, err := scanImportFingerprints(ctx, pe, source, res)
	if err != nil {
		return nil, err
	}
	if ctx.Err() != nil {
		return nil, fmt.Errorf("已取消")
	}
	pe.switchPhase("analyzing", 0)
	pe.forceEmit(0, "归一化与质量评分")
	buildImportPreview(res, rawItems, existing)
	res.Elapsed = time.Since(start).Truncate(10 * time.Millisecond).String()
	return res, nil
}

func (a *App) ApplyFingerprintImport(req FingerprintImportApplyRequest) (*FingerprintImportApplyResult, error) {
	start := time.Now()
	if !req.Confirm || strings.TrimSpace(req.Confirmation) != "APPLY_FINGERPRINT_IMPORT" {
		return nil, fmt.Errorf("需要显式确认 APPLY_FINGERPRINT_IMPORT")
	}
	root := strings.TrimSpace(req.ProjectRoot)
	if root == "" {
		return nil, fmt.Errorf("dddd 根目录为空")
	}
	info, err := os.Stat(root)
	if err != nil {
		return nil, fmt.Errorf("dddd 根目录不可访问: %v", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("dddd 根目录不是目录: %s", root)
	}
	target := filepath.Join(root, "common", "config", "finger.yaml")
	raw, err := os.ReadFile(target)
	if err != nil {
		return nil, fmt.Errorf("读取 finger.yaml 失败: %v", err)
	}
	imported, err := parseFingerEntriesFromYAML([]byte(req.DDDDYaml), "导入 YAML")
	if err != nil {
		return nil, err
	}
	if len(imported) == 0 {
		return nil, fmt.Errorf("导入 YAML 中没有可写入的指纹")
	}
	existing, err := parseFingerEntriesFromYAML(raw, "finger.yaml")
	if err != nil {
		return nil, err
	}
	merged, result := mergeFingerEntriesForApply(existing, imported)
	backupPath := target + "." + time.Now().Format("20060102-150405") + ".bak"
	if err := os.WriteFile(backupPath, raw, 0o644); err != nil {
		return nil, fmt.Errorf("备份 finger.yaml 失败: %v", err)
	}
	out := renderFingerEntriesYAML(merged)
	if err := os.WriteFile(target, []byte(out), 0o644); err != nil {
		return nil, fmt.Errorf("写回 finger.yaml 失败: %v", err)
	}
	result.TargetFingerPath = target
	result.BackupPath = backupPath
	result.Elapsed = time.Since(start).Truncate(10 * time.Millisecond).String()
	return result, nil
}

func scanImportFingerprints(ctx context.Context, pe *progressEmitter, source string, res *FingerprintImportPreviewResult) ([]rawFingerprintImport, error) {
	out := []rawFingerprintImport{}
	err := filepath.WalkDir(source, func(path string, d os.DirEntry, walkErr error) error {
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
		if res.ScannedFiles >= fingerprintImportLimit {
			return filepath.SkipAll
		}
		res.ScannedFiles++
		rel, relErr := filepath.Rel(source, path)
		if relErr != nil {
			rel = name
		}
		items, skip := parseImportFingerprintFile(path, rel)
		if skip.Reason != "" {
			res.SkippedFiles++
			if len(res.Skipped) < fingerprintImportListLimit {
				res.Skipped = append(res.Skipped, skip)
			}
			pe.tick(res.ScannedFiles, fmt.Sprintf("已扫描 %d 个文件", res.ScannedFiles))
			return nil
		}
		res.ParsedFiles++
		out = append(out, items...)
		pe.tick(res.ScannedFiles, fmt.Sprintf("已扫描 %d 个文件", res.ScannedFiles))
		return nil
	})
	if ctx.Err() != nil {
		return nil, fmt.Errorf("已取消")
	}
	return out, err
}

func parseImportFingerprintFile(path, rel string) ([]rawFingerprintImport, FingerprintImportSkip) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, FingerprintImportSkip{Path: path, RelPath: rel, Reason: err.Error()}
	}
	if info.Size() > fingerprintImportMaxBytes {
		return nil, FingerprintImportSkip{Path: path, RelPath: rel, Reason: "文件过大"}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, FingerprintImportSkip{Path: path, RelPath: rel, Reason: err.Error()}
	}
	if len(raw) == 0 {
		return nil, FingerprintImportSkip{Path: path, RelPath: rel, Reason: "空文件"}
	}
	if !utf8.Valid(raw) || strings.ContainsRune(string(raw), '\x00') {
		return nil, FingerprintImportSkip{Path: path, RelPath: rel, Reason: "非文本文件"}
	}
	content := string(raw)
	ext := strings.ToLower(filepath.Ext(path))
	fallback := productNameFromFilename(filepath.Base(path))
	var node any
	format := strings.TrimPrefix(ext, ".")
	if ext == ".json" {
		if err := json.Unmarshal(raw, &node); err != nil {
			return parseImportPlainText(content, path, rel, fallback, "text"), FingerprintImportSkip{}
		}
		return collectImportFingerprints(node, path, rel, "json", fallback), FingerprintImportSkip{}
	}
	if ext == ".yaml" || ext == ".yml" {
		if err := yaml.Unmarshal(raw, &node); err != nil {
			return parseImportPlainText(content, path, rel, fallback, "text"), FingerprintImportSkip{}
		}
		return collectImportFingerprints(node, path, rel, "yaml", fallback), FingerprintImportSkip{}
	}
	items := parseImportPlainText(content, path, rel, fallback, format)
	if len(items) == 0 {
		return nil, FingerprintImportSkip{Path: path, RelPath: rel, Reason: "未识别到指纹规则"}
	}
	return items, FingerprintImportSkip{}
}

func collectImportFingerprints(v any, path, rel, format, fallback string) []rawFingerprintImport {
	items := []rawFingerprintImport{}
	collectImportFingerprintsInto(v, path, rel, format, fallback, &items, 0)
	if len(items) == 0 {
		if rules := rulesFromAny(v, "root"); len(rules) > 0 && fallback != "" {
			items = append(items, rawFingerprintImport{Product: fallback, Rules: rules, Path: path, RelPath: rel, Format: format})
		}
	}
	return mergeRawImportItems(items)
}

func collectImportFingerprintsInto(v any, path, rel, format, fallback string, out *[]rawFingerprintImport, depth int) {
	if depth > 12 {
		return
	}
	if m, ok := asStringMap(v); ok {
		if items := afrogImportsFromTemplate(m, path, rel, format, fallback); len(items) > 0 {
			*out = append(*out, items...)
			return
		}
		product := explicitProductName(m)
		if product != "" {
			if rules := rulesFromMap(m); len(rules) > 0 {
				*out = append(*out, rawFingerprintImport{Product: product, Rules: rules, Path: path, RelPath: rel, Format: format})
				return
			}
		}
		if looksLikeProductRuleMap(m) {
			keys := sortedStringMapKeys(m)
			added := false
			for _, key := range keys {
				val := m[key]
				if reProductNoise.MatchString(key) || rePossibleRuleKey.MatchString(key) {
					continue
				}
				if rules := rulesFromAny(val, key); len(rules) > 0 {
					*out = append(*out, rawFingerprintImport{Product: normalizeProductDisplay(key), Rules: rules, Path: path, RelPath: rel, Format: format})
					added = true
				}
			}
			if added {
				return
			}
		}
		for _, key := range sortedStringMapKeys(m) {
			collectImportFingerprintsInto(m[key], path, rel, format, fallback, out, depth+1)
		}
		return
	}
	if arr, ok := asSlice(v); ok {
		if allImportItemsAreScalar(arr) {
			if rules := rulesFromAny(arr, "list"); len(rules) > 0 && fallback != "" {
				*out = append(*out, rawFingerprintImport{Product: fallback, Rules: rules, Path: path, RelPath: rel, Format: format})
			}
			return
		}
		before := len(*out)
		for _, item := range arr {
			collectImportFingerprintsInto(item, path, rel, format, fallback, out, depth+1)
		}
		if len(*out) == before && depth == 0 {
			if rules := rulesFromAny(arr, "list"); len(rules) > 0 && fallback != "" {
				*out = append(*out, rawFingerprintImport{Product: fallback, Rules: rules, Path: path, RelPath: rel, Format: format})
			}
		}
	}
}

func parseImportPlainText(content, path, rel, product, format string) []rawFingerprintImport {
	rules := []rawFingerprintRule{}
	for _, line := range reGenericSplit.Split(content, -1) {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "//") {
			continue
		}
		if r := normalizeImportRule(line, "line"); r.Expression != "" {
			rules = append(rules, r)
		}
	}
	if len(rules) == 0 {
		return nil
	}
	return []rawFingerprintImport{{Product: product, Rules: rules, Path: path, RelPath: rel, Format: format}}
}

func rulesFromMap(m map[string]any) []rawFingerprintRule {
	rules := []rawFingerprintRule{}
	for _, key := range sortedStringMapKeys(m) {
		lower := strings.ToLower(strings.TrimSpace(key))
		if lower == "name" || lower == "product" || lower == "app" || lower == "cms" || lower == "service" || lower == "title" && !isRuleLikeValue(m[key]) {
			continue
		}
		rules = append(rules, rulesFromKeyValue(lower, m[key])...)
	}
	return dedupRawRules(rules)
}

func rulesFromAny(v any, source string) []rawFingerprintRule {
	if s, ok := asString(v); ok {
		if r := normalizeImportRule(s, source); r.Expression != "" {
			return []rawFingerprintRule{r}
		}
		return nil
	}
	if arr, ok := asSlice(v); ok {
		rules := []rawFingerprintRule{}
		for _, item := range arr {
			rules = append(rules, rulesFromAny(item, source)...)
		}
		return dedupRawRules(rules)
	}
	if m, ok := asStringMap(v); ok {
		return rulesFromMap(m)
	}
	return nil
}

func rulesFromKeyValue(key string, v any) []rawFingerprintRule {
	if s, ok := asString(v); ok {
		return ruleStringsFromKeyValue(key, []string{s})
	}
	if arr, ok := asSlice(v); ok {
		vals := []string{}
		for _, item := range arr {
			if s, ok := asString(item); ok {
				vals = append(vals, s)
			} else {
				return rulesFromAny(arr, key)
			}
		}
		return ruleStringsFromKeyValue(key, vals)
	}
	if m, ok := asStringMap(v); ok {
		if strings.Contains(key, "header") || key == "headers" {
			rules := []rawFingerprintRule{}
			for _, hk := range sortedStringMapKeys(m) {
				if hv, ok := asString(m[hk]); ok {
					rules = append(rules, makeImportRule("header", "=", strings.TrimSpace(hk)+": "+strings.TrimSpace(hv), key, hk+": "+hv))
				}
			}
			return dedupRawRules(rules)
		}
		return rulesFromMap(m)
	}
	return nil
}

func ruleStringsFromKeyValue(key string, values []string) []rawFingerprintRule {
	rules := []rawFingerprintRule{}
	field := ""
	op := "="
	lower := strings.ToLower(strings.TrimSpace(key))
	switch {
	case lower == "expression" || lower == "condition" || lower == "rule" || lower == "rules" || lower == "match" || lower == "matches" || lower == "matcher" || lower == "matchers" || lower == "fofa" || lower == "hunter":
		for _, v := range values {
			if r := normalizeImportRule(v, key); r.Expression != "" {
				rules = append(rules, r)
			}
		}
		return dedupRawRules(rules)
	case strings.Contains(lower, "body_hash"):
		field = "body_hash"
	case strings.Contains(lower, "favicon") || strings.Contains(lower, "icon"):
		field = "icon_hash"
	case strings.Contains(lower, "hash"):
		field = "body_hash"
	case strings.Contains(lower, "title"):
		field = "title"
	case strings.Contains(lower, "header"):
		field = "header"
	case strings.Contains(lower, "banner"):
		field = "banner"
	case strings.Contains(lower, "cert"):
		field = "cert"
	case strings.Contains(lower, "regex") || strings.Contains(lower, "regexp"):
		field = "body"
		op = "~="
	case strings.Contains(lower, "html") || strings.Contains(lower, "body") || strings.Contains(lower, "keyword") || strings.Contains(lower, "script") || strings.Contains(lower, "match") || strings.Contains(lower, "fingerprint"):
		field = "body"
	}
	if field == "" {
		return nil
	}
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		rules = append(rules, makeImportRule(field, op, v, key, v))
	}
	return dedupRawRules(rules)
}

func normalizeImportRule(s, source string) rawFingerprintRule {
	orig := strings.TrimSpace(s)
	if orig == "" {
		return rawFingerprintRule{}
	}
	if expr := convertKnownExpressionClauses(orig); expr != "" {
		return rawFingerprintRule{Expression: expr, Original: orig, Source: source}
	}
	for _, m := range reContainsCall.FindAllStringSubmatch(orig, -1) {
		field := normalizeImportField(m[2])
		op := "="
		if strings.EqualFold(m[1], "regex") {
			op = "~="
		}
		if field == "html" {
			field = "body"
		}
		if rule := makeImportRule(field, op, m[3], source, orig); rule.Expression != "" {
			return rule
		}
	}
	lower := strings.ToLower(orig)
	if strings.Contains(lower, "title=") || strings.Contains(lower, "title:") {
		if val := firstQuotedOrAfterSep(orig); val != "" {
			return makeImportRule("title", "=", val, source, orig)
		}
	}
	if strings.Contains(lower, "header=") || strings.Contains(lower, "header:") {
		if val := firstQuotedOrAfterSep(orig); val != "" {
			return makeImportRule("header", "=", val, source, orig)
		}
	}
	if strings.Contains(lower, "body=") || strings.Contains(lower, "body:") || strings.Contains(lower, "html=") || strings.Contains(lower, "keyword") {
		if val := firstQuotedOrAfterSep(orig); val != "" {
			return makeImportRule("body", "=", val, source, orig)
		}
	}
	if reNumericHash.MatchString(orig) || reHexHash.MatchString(orig) {
		return makeImportRule("icon_hash", "=", orig, source, orig)
	}
	if len([]rune(orig)) >= 4 && len([]rune(orig)) <= 160 {
		return makeImportRule("body", "=", orig, source, orig)
	}
	return rawFingerprintRule{}
}

func makeImportRule(field, op, value, source, original string) rawFingerprintRule {
	field = normalizeImportField(field)
	value = strings.TrimSpace(value)
	if field == "" || value == "" {
		return rawFingerprintRule{}
	}
	return rawFingerprintRule{Expression: field + op + strconv.Quote(value), Original: original, Source: source}
}

func normalizeExistingExpression(expr string) string {
	expr = strings.TrimSpace(expr)
	expr = reWhitespace.ReplaceAllString(expr, " ")
	expr = strings.ReplaceAll(expr, "favicon_hash", "icon_hash")
	expr = strings.ReplaceAll(expr, "favicon", "icon_hash")
	expr = strings.ReplaceAll(expr, "iconhash", "icon_hash")
	expr = strings.ReplaceAll(expr, "bodyhash", "body_hash")
	expr = strings.ReplaceAll(expr, "html", "body")
	expr = strings.ReplaceAll(expr, "keywords", "body")
	expr = strings.ReplaceAll(expr, "keyword", "body")
	expr = strings.ReplaceAll(expr, "==", "=")
	expr = strings.ReplaceAll(expr, " = ", "=")
	expr = strings.ReplaceAll(expr, " ~= ", "~=")
	expr = strings.ReplaceAll(expr, " and ", " && ")
	expr = strings.ReplaceAll(expr, " AND ", " && ")
	expr = strings.ReplaceAll(expr, " or ", " || ")
	expr = strings.ReplaceAll(expr, " OR ", " || ")
	return expr
}

func convertKnownExpressionClauses(expr string) string {
	converted := normalizeExistingExpression(expr)
	if reDDDDExprClause.MatchString(converted) || reKnownExprField.MatchString(converted) {
		return converted
	}
	return ""
}

func afrogImportsFromTemplate(m map[string]any, path, rel, format, fallback string) []rawFingerprintImport {
	rulesNode, ok := valueByFoldedKey(m, "rules")
	if !ok {
		return nil
	}
	product := afrogTemplateProduct(m, fallback)
	items := []rawFingerprintImport{}
	collectAfrogRuleExpressions(rulesNode, product, path, rel, format, &items, 0)
	return mergeRawImportItems(items)
}

func afrogTemplateProduct(m map[string]any, fallback string) string {
	for _, key := range []string{"id", "name"} {
		if v, ok := valueByFoldedKey(m, key); ok {
			if s, ok := asString(v); ok && strings.TrimSpace(s) != "" {
				return normalizeProductDisplay(s)
			}
		}
	}
	if infoNode, ok := valueByFoldedKey(m, "info"); ok {
		if info, ok := asStringMap(infoNode); ok {
			if name, ok := valueByFoldedKey(info, "name"); ok {
				if s, ok := asString(name); ok && strings.TrimSpace(s) != "" {
					return normalizeProductDisplay(s)
				}
			}
		}
	}
	return normalizeProductDisplay(fallback)
}

func collectAfrogRuleExpressions(v any, defaultProduct, path, rel, format string, out *[]rawFingerprintImport, depth int) {
	if depth > 10 {
		return
	}
	if m, ok := asStringMap(v); ok {
		if exprNode, ok := valueByFoldedKey(m, "expression"); ok {
			for _, expr := range stringsFromAny(exprNode) {
				appendAfrogExpressionImport(expr, defaultProduct, path, rel, format, out)
			}
		}
		if exprsNode, ok := valueByFoldedKey(m, "expressions"); ok {
			for _, expr := range stringsFromAny(exprsNode) {
				appendAfrogExpressionImport(expr, defaultProduct, path, rel, format, out)
			}
		}
		for _, key := range sortedStringMapKeys(m) {
			lower := strings.ToLower(strings.TrimSpace(key))
			if lower == "request" || lower == "requests" || lower == "expression" || lower == "expressions" {
				continue
			}
			collectAfrogRuleExpressions(m[key], defaultProduct, path, rel, format, out, depth+1)
		}
		return
	}
	if arr, ok := asSlice(v); ok {
		for _, item := range arr {
			collectAfrogRuleExpressions(item, defaultProduct, path, rel, format, out, depth+1)
		}
	}
}

func appendAfrogExpressionImport(expr, defaultProduct, path, rel, format string, out *[]rawFingerprintImport) {
	product, body := splitAfrogProductMarker(expr)
	if product == "" {
		product = defaultProduct
	}
	rule := afrogRuleFromExpression(body)
	if product == "" || rule.Expression == "" {
		return
	}
	*out = append(*out, rawFingerprintImport{Product: product, Rules: []rawFingerprintRule{rule}, Path: path, RelPath: rel, Format: format})
}

func afrogRuleFromExpression(expr string) rawFingerprintRule {
	orig := strings.TrimSpace(expr)
	if orig == "" {
		return rawFingerprintRule{}
	}
	clauses := []string{}
	for _, m := range reAfrogResponseCall.FindAllStringSubmatch(orig, -1) {
		field, op := afrogFieldAndOperator(m[1], m[2])
		if rule := makeAfrogImportRule(field, op, m[1], m[3], orig); rule.Expression != "" {
			clauses = append(clauses, rule.Expression)
		}
	}
	for _, m := range reAfrogReverseMatch.FindAllStringSubmatch(orig, -1) {
		field, op := afrogFieldAndOperator(m[3], m[2])
		if rule := makeAfrogImportRule(field, op, m[3], m[1], orig); rule.Expression != "" {
			clauses = append(clauses, rule.Expression)
		}
	}
	for _, m := range reAfrogResponseEquals.FindAllStringSubmatch(orig, -1) {
		field, op := afrogFieldAndOperator(m[1], m[2])
		if rule := makeAfrogImportRule(field, op, m[1], m[3], orig); rule.Expression != "" {
			clauses = append(clauses, rule.Expression)
		}
	}
	clauses = uniqueSortedStrings(clauses)
	if len(clauses) == 0 {
		return rawFingerprintRule{}
	}
	return rawFingerprintRule{Expression: strings.Join(clauses, " && "), Original: orig, Source: "afrog"}
}

func afrogFieldAndOperator(field, method string) (string, string) {
	lowerField := strings.ToLower(strings.TrimSpace(field))
	lowerMethod := strings.ToLower(strings.TrimSpace(method))
	outField := "body"
	switch {
	case strings.HasPrefix(lowerField, "headers") || lowerField == "header" || lowerField == "raw_header" || lowerField == "content_type":
		outField = "header"
	case lowerField == "title":
		outField = "title"
	case lowerField == "cert":
		outField = "cert"
	case lowerField == "banner":
		outField = "banner"
	}
	op := "="
	if strings.Contains(lowerMethod, "match") || strings.Contains(lowerMethod, "regex") || lowerMethod == "=~" {
		op = "~="
	}
	return outField, op
}

func makeAfrogImportRule(field, op, originalField, literal, orig string) rawFingerprintRule {
	value := afrogFieldValue(originalField, literal)
	if field == "body" {
		if title := htmlTitleValue(value); title != "" {
			field = "title"
			value = title
		}
	}
	return makeImportRule(field, op, value, "afrog", orig)
}

func afrogFieldValue(field, literal string) string {
	value := unquoteLoose(literal)
	lowerField := strings.ToLower(strings.TrimSpace(field))
	if strings.HasPrefix(lowerField, "headers[") {
		if key := headerKeyFromAfrogField(lowerField); key != "" && !strings.Contains(strings.ToLower(value), key+":") {
			return key + ": " + value
		}
	}
	if lowerField == "content_type" && !strings.Contains(strings.ToLower(value), "content-type") {
		return "Content-Type: " + value
	}
	return value
}

func htmlTitleValue(value string) string {
	m := reHTMLTitleValue.FindStringSubmatch(value)
	if m == nil {
		return ""
	}
	return strings.TrimSpace(m[1])
}

func splitAfrogProductMarker(expr string) (string, string) {
	s := strings.TrimSpace(expr)
	product, next, ok := readLooseQuoted(s, 0)
	if !ok {
		return "", s
	}
	i := skipSpaces(s, next)
	if !strings.HasPrefix(s[i:], "!=") {
		return "", s
	}
	i = skipSpaces(s, i+2)
	empty, next, ok := readLooseQuoted(s, i)
	if !ok || strings.TrimSpace(empty) != "" {
		return "", s
	}
	i = skipSpaces(s, next)
	if strings.HasPrefix(s[i:], "&&") {
		return normalizeProductDisplay(product), strings.TrimSpace(s[i+2:])
	}
	return normalizeProductDisplay(product), strings.TrimSpace(s[i:])
}

func stringsFromAny(v any) []string {
	if s, ok := asString(v); ok {
		return []string{s}
	}
	if arr, ok := asSlice(v); ok {
		out := []string{}
		for _, item := range arr {
			out = append(out, stringsFromAny(item)...)
		}
		return out
	}
	return nil
}

func valueByFoldedKey(m map[string]any, key string) (any, bool) {
	if v, ok := m[key]; ok {
		return v, true
	}
	for k, v := range m {
		if strings.EqualFold(strings.TrimSpace(k), key) {
			return v, true
		}
	}
	return nil, false
}

func headerKeyFromAfrogField(field string) string {
	start := strings.Index(field, "[")
	end := strings.LastIndex(field, "]")
	if start < 0 || end <= start+1 {
		return ""
	}
	key := strings.TrimSpace(field[start+1 : end])
	return strings.ToLower(unquoteLoose(key))
}

func readLooseQuoted(s string, pos int) (string, int, bool) {
	i := skipSpaces(s, pos)
	if i < len(s) && s[i] == 'b' && i+1 < len(s) && (s[i+1] == '"' || s[i+1] == '\'') {
		i++
	}
	if i >= len(s) || (s[i] != '"' && s[i] != '\'') {
		return "", pos, false
	}
	quote := s[i]
	var b strings.Builder
	for j := i + 1; j < len(s); j++ {
		ch := s[j]
		if ch == '\\' && j+1 < len(s) {
			j++
			switch s[j] {
			case 'n':
				b.WriteByte('\n')
			case 'r':
				b.WriteByte('\r')
			case 't':
				b.WriteByte('\t')
			default:
				b.WriteByte(s[j])
			}
			continue
		}
		if ch == quote {
			return b.String(), j + 1, true
		}
		b.WriteByte(ch)
	}
	return "", pos, false
}

func unquoteLoose(s string) string {
	v, _, ok := readLooseQuoted(strings.TrimSpace(s), 0)
	if ok {
		return strings.TrimSpace(v)
	}
	return strings.Trim(strings.TrimSpace(s), `"'`)
}

func skipSpaces(s string, pos int) int {
	for pos < len(s) {
		switch s[pos] {
		case ' ', '\t', '\n', '\r':
			pos++
		default:
			return pos
		}
	}
	return pos
}

func firstQuotedOrAfterSep(s string) string {
	if m := reQuoteValue.FindStringSubmatch(s); m != nil {
		return strings.TrimSpace(m[1])
	}
	if m := reSingleQuoteValue.FindStringSubmatch(s); m != nil {
		return strings.TrimSpace(m[1])
	}
	if idx := strings.IndexAny(s, "=:"); idx >= 0 && idx+1 < len(s) {
		return strings.Trim(strings.TrimSpace(s[idx+1:]), `"'`)
	}
	return strings.Trim(s, `"'`)
}

func buildImportPreview(res *FingerprintImportPreviewResult, rawItems []rawFingerprintImport, existing []fingerEntry) {
	itemMap := map[string]*FingerprintImportItem{}
	order := []string{}
	ruleOwners := map[string]map[string]struct{}{}
	existingNames := map[string][]string{}
	existingRules := map[string]map[string]struct{}{}
	for _, e := range existing {
		norm := normalizeImportProductName(e.Product)
		existingNames[norm] = append(existingNames[norm], e.Product)
		if existingRules[norm] == nil {
			existingRules[norm] = map[string]struct{}{}
		}
		for _, r := range e.Rules {
			existingRules[norm][strings.TrimSpace(r)] = struct{}{}
		}
	}
	importedNames := map[string][]string{}
	for _, raw := range rawItems {
		product := normalizeProductDisplay(raw.Product)
		if product == "" {
			product = productNameFromFilename(filepath.Base(raw.Path))
		}
		norm := normalizeImportProductName(product)
		if norm == "" {
			continue
		}
		key := norm + "\x00" + raw.RelPath
		item := itemMap[key]
		if item == nil {
			item = &FingerprintImportItem{Product: product, NormalizedProduct: norm, SourcePath: raw.Path, RelPath: raw.RelPath, SourceFormat: raw.Format, Rules: []FingerprintImportRule{}, Warnings: []string{}}
			itemMap[key] = item
			order = append(order, key)
		}
		importedNames[norm] = append(importedNames[norm], product)
		seen := map[string]struct{}{}
		for _, rr := range raw.Rules {
			expr := strings.TrimSpace(rr.Expression)
			if expr == "" {
				continue
			}
			if _, ok := seen[expr]; ok {
				continue
			}
			seen[expr] = struct{}{}
			if existingRules[norm] != nil {
				if _, ok := existingRules[norm][expr]; ok {
					item.Warnings = append(item.Warnings, "目标 finger.yaml 中已存在相同规则")
				}
			}
			rule := scoreImportRule(expr, rr.Original, rr.Source)
			item.Rules = append(item.Rules, rule)
			if ruleOwners[expr] == nil {
				ruleOwners[expr] = map[string]struct{}{}
			}
			ruleOwners[expr][product] = struct{}{}
		}
	}
	for _, key := range order {
		item := itemMap[key]
		if item == nil || len(item.Rules) == 0 {
			continue
		}
		score := 0
		for _, r := range item.Rules {
			score += r.Weight
			res.RuleCount++
			if r.Weight >= 80 {
				res.HighConfidenceCount++
			}
			if r.Generic {
				res.GenericRuleCount++
			}
		}
		item.QualityScore = score / len(item.Rules)
		item.Quality = qualityLabel(item.QualityScore)
		if len(res.Items) < fingerprintImportListLimit {
			res.Items = append(res.Items, *item)
		}
	}
	res.CandidateCount = len(rawItems)
	res.ProductCount = len(uniqueImportProducts(importedNames))
	for rule, owners := range ruleOwners {
		if len(owners) <= 1 {
			continue
		}
		res.DuplicateRuleCount++
		if len(res.DuplicateRules) < fingerprintImportListLimit {
			res.DuplicateRules = append(res.DuplicateRules, FingerprintRuleDup{Rule: rule, Products: sortedKeys(owners)})
		}
	}
	sort.Slice(res.DuplicateRules, func(i, j int) bool { return res.DuplicateRules[i].Rule < res.DuplicateRules[j].Rule })
	mergeNorms := map[string]struct{}{}
	for norm, names := range importedNames {
		merged := uniqueSortedStrings(append([]string{}, names...))
		ex := uniqueSortedStrings(existingNames[norm])
		if len(merged) > 1 || len(ex) > 0 {
			mergeNorms[norm] = struct{}{}
			if len(res.MergeSuggestions) < fingerprintImportListLimit {
				res.MergeSuggestions = append(res.MergeSuggestions, FingerprintMergeSuggestion{NormalizedProduct: norm, Products: uniqueSortedStrings(append(append([]string{}, ex...), merged...)), Existing: ex, Imported: merged})
			}
		}
	}
	res.MergeSuggestionCount = len(mergeNorms)
	sort.Slice(res.MergeSuggestions, func(i, j int) bool {
		return res.MergeSuggestions[i].NormalizedProduct < res.MergeSuggestions[j].NormalizedProduct
	})
	res.DDDDYaml = buildImportDDDDYaml(itemMap, order)
	res.PatchPreview = buildImportPatchPreview(res.TargetFingerPath, res.DDDDYaml, len(existing) > 0)
}

func scoreImportRule(expr, original, source string) FingerprintImportRule {
	out := FingerprintImportRule{Expression: expr, Original: original, Source: source, Weight: 25, Quality: "low", Reasons: []string{}}
	matches := reDDDDExprClause.FindAllStringSubmatch(expr, -1)
	if len(matches) == 0 {
		out.Reasons = append(out.Reasons, "无法识别字段，需人工确认")
		return out
	}
	best := 0
	for _, m := range matches {
		field, op, value := normalizeImportField(m[1]), m[2], strings.TrimSpace(m[3])
		weight := fieldWeight(field, op, value)
		if weight > best {
			best = weight
			out.Field = field
			out.Operator = op
			out.Value = value
		}
		if reason := weakFingerprintRuleReason(field + op + strconv.Quote(value)); reason != "" {
			out.Generic = true
			out.Reasons = append(out.Reasons, reason)
		}
	}
	if len(matches) > 1 && strings.Contains(expr, "&&") {
		best += 8
	}
	if len(matches) > 1 && strings.Contains(expr, "||") {
		best += 3
	}
	if best > 100 {
		best = 100
	}
	out.Weight = best
	out.Quality = qualityLabel(best)
	return out
}

func fieldWeight(field, op, value string) int {
	switch field {
	case "icon_hash":
		return 92
	case "body_hash":
		return 88
	case "cert":
		return 78
	case "header":
		if op == "~=" {
			return 72
		}
		return 64
	case "title":
		if op == "~=" {
			return 62
		}
		return 52
	case "banner":
		return 70
	case "body":
		if op == "~=" {
			return 66
		}
		if len([]rune(value)) >= 18 {
			return 58
		}
		return 42
	default:
		return 25
	}
}

func qualityLabel(score int) string {
	if score >= 80 {
		return "high"
	}
	if score >= 55 {
		return "medium"
	}
	return "low"
}

func buildImportDDDDYaml(itemMap map[string]*FingerprintImportItem, order []string) string {
	byProduct := map[string][]string{}
	productOrder := []string{}
	seenProduct := map[string]struct{}{}
	for _, key := range order {
		item := itemMap[key]
		if item == nil {
			continue
		}
		if _, ok := seenProduct[item.Product]; !ok {
			seenProduct[item.Product] = struct{}{}
			productOrder = append(productOrder, item.Product)
		}
		for _, r := range item.Rules {
			byProduct[item.Product] = append(byProduct[item.Product], r.Expression)
		}
	}
	var b strings.Builder
	for _, product := range productOrder {
		rules := uniqueSortedStrings(byProduct[product])
		if len(rules) == 0 {
			continue
		}
		b.WriteString(yamlKey(product))
		b.WriteString(":\n")
		for _, r := range rules {
			b.WriteString("  - '")
			b.WriteString(strings.ReplaceAll(r, "'", "''"))
			b.WriteString("'\n")
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

func buildImportPatchPreview(target, yamlText string, hasExisting bool) string {
	if strings.TrimSpace(yamlText) == "" {
		return ""
	}
	var b strings.Builder
	if target != "" {
		b.WriteString("Target: ")
		b.WriteString(target)
		b.WriteString("\n")
	}
	if hasExisting {
		b.WriteString("Action: append/merge after manual confirmation\n\n")
	} else {
		b.WriteString("Action: create or append after manual confirmation\n\n")
	}
	b.WriteString(yamlText)
	return b.String()
}

func parseFingerEntriesFromYAML(raw []byte, label string) ([]fingerEntry, error) {
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
	out := make([]fingerEntry, 0, len(root.Content)/2)
	for i := 0; i+1 < len(root.Content); i += 2 {
		product := strings.TrimSpace(root.Content[i].Value)
		if product == "" {
			continue
		}
		rules := yamlStringSeq(root.Content[i+1])
		out = append(out, fingerEntry{Product: product, Rules: uniqueSortedStrings(rules)})
	}
	return out, nil
}

func mergeFingerEntriesForApply(existing, imported []fingerEntry) ([]fingerEntry, *FingerprintImportApplyResult) {
	res := &FingerprintImportApplyResult{ChangedProducts: []string{}}
	merged := make([]fingerEntry, len(existing))
	copy(merged, existing)
	normIndex := map[string]int{}
	for i, entry := range merged {
		norm := normalizeImportProductName(entry.Product)
		if norm != "" {
			normIndex[norm] = i
		}
	}
	changed := map[string]struct{}{}
	for _, entry := range imported {
		product := normalizeProductDisplay(entry.Product)
		if product == "" {
			continue
		}
		norm := normalizeImportProductName(product)
		rules := uniqueSortedStrings(entry.Rules)
		if len(rules) == 0 {
			continue
		}
		if idx, ok := normIndex[norm]; ok {
			added, skipped := mergeRuleList(&merged[idx].Rules, rules)
			res.RulesAdded += added
			res.RulesSkipped += skipped
			if added > 0 {
				res.ProductsMerged++
				changed[merged[idx].Product] = struct{}{}
			}
			continue
		}
		merged = append(merged, fingerEntry{Product: product, Rules: rules})
		normIndex[norm] = len(merged) - 1
		res.ProductsCreated++
		res.RulesAdded += len(rules)
		changed[product] = struct{}{}
	}
	res.ChangedProducts = sortedKeys(changed)
	return merged, res
}

func mergeRuleList(dst *[]string, incoming []string) (int, int) {
	seen := map[string]struct{}{}
	for _, rule := range *dst {
		rule = strings.TrimSpace(rule)
		if rule != "" {
			seen[rule] = struct{}{}
		}
	}
	added, skipped := 0, 0
	for _, rule := range incoming {
		rule = strings.TrimSpace(rule)
		if rule == "" {
			continue
		}
		if _, ok := seen[rule]; ok {
			skipped++
			continue
		}
		seen[rule] = struct{}{}
		*dst = append(*dst, rule)
		added++
	}
	*dst = uniqueSortedStrings(*dst)
	return added, skipped
}

func renderFingerEntriesYAML(entries []fingerEntry) string {
	var b bytes.Buffer
	for i, entry := range entries {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(yamlKey(entry.Product))
		b.WriteString(":\n")
		for _, rule := range uniqueSortedStrings(entry.Rules) {
			b.WriteString("  - '")
			b.WriteString(strings.ReplaceAll(rule, "'", "''"))
			b.WriteString("'\n")
		}
	}
	return strings.TrimRight(b.String(), "\n") + "\n"
}

func yamlKey(s string) string {
	if s == "" {
		return `""`
	}
	if strings.ContainsAny(s, ":#{}[],&*?|-<>=!%@`\"'\n\r\t") || strings.HasPrefix(s, " ") || strings.HasSuffix(s, " ") {
		return strconv.Quote(s)
	}
	return s
}

func explicitProductName(m map[string]any) string {
	for _, key := range []string{"product", "name", "app", "cms", "service", "title"} {
		if v, ok := m[key]; ok {
			if s, ok := asString(v); ok && strings.TrimSpace(s) != "" {
				return normalizeProductDisplay(s)
			}
		}
	}
	for k, v := range m {
		lower := strings.ToLower(k)
		if lower == "product" || lower == "name" || lower == "app" || lower == "cms" || lower == "service" {
			if s, ok := asString(v); ok {
				return normalizeProductDisplay(s)
			}
		}
	}
	return ""
}

func allImportItemsAreScalar(items []any) bool {
	if len(items) == 0 {
		return false
	}
	for _, item := range items {
		if _, ok := asString(item); !ok {
			return false
		}
	}
	return true
}

func looksLikeProductRuleMap(m map[string]any) bool {
	if len(m) == 0 || len(m) > 5000 {
		return false
	}
	hits := 0
	for key, val := range m {
		if reProductNoise.MatchString(key) || rePossibleRuleKey.MatchString(key) {
			continue
		}
		if len(rulesFromAny(val, key)) > 0 {
			hits++
			if hits >= 1 {
				return true
			}
		}
	}
	return false
}

func isRuleLikeValue(v any) bool {
	return len(rulesFromAny(v, "title")) > 0
}

func normalizeProductDisplay(s string) string {
	s = strings.TrimSpace(s)
	s = strings.Trim(s, `"'`)
	s = reWhitespace.ReplaceAllString(s, " ")
	return s
}

func normalizeImportProductName(s string) string {
	s = strings.ToLower(normalizeProductDisplay(s))
	s = strings.ReplaceAll(s, "_", "-")
	s = strings.ReplaceAll(s, "/", "-")
	s = strings.ReplaceAll(s, "\\", "-")
	s = strings.TrimSuffix(s, "-optimize")
	s = reCommonVersionSuffix.ReplaceAllString(s, "")
	s = strings.TrimSpace(s)
	return s
}

func productNameFromFilename(name string) string {
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	base = strings.ReplaceAll(base, "_", "-")
	base = strings.TrimSpace(base)
	if base == "" {
		return "unknown"
	}
	return base
}

func normalizeImportField(field string) string {
	field = strings.ToLower(strings.TrimSpace(field))
	switch field {
	case "favicon", "favicon_hash", "icon", "iconhash", "icon_hash":
		return "icon_hash"
	case "bodyhash", "body_hash", "hash":
		return "body_hash"
	case "html", "keyword", "keywords":
		return "body"
	}
	if field == "body" || field == "title" || field == "header" || field == "banner" || field == "cert" {
		return field
	}
	return field
}

func asString(v any) (string, bool) {
	switch x := v.(type) {
	case string:
		return x, true
	case fmt.Stringer:
		return x.String(), true
	case int:
		return strconv.Itoa(x), true
	case int64:
		return strconv.FormatInt(x, 10), true
	case float64:
		if x == float64(int64(x)) {
			return strconv.FormatInt(int64(x), 10), true
		}
		return strconv.FormatFloat(x, 'f', -1, 64), true
	case bool:
		return strconv.FormatBool(x), true
	default:
		return "", false
	}
}

func asSlice(v any) ([]any, bool) {
	switch x := v.(type) {
	case []any:
		return x, true
	case []string:
		out := make([]any, len(x))
		for i := range x {
			out[i] = x[i]
		}
		return out, true
	default:
		return nil, false
	}
}

func asStringMap(v any) (map[string]any, bool) {
	switch x := v.(type) {
	case map[string]any:
		return x, true
	case map[any]any:
		out := map[string]any{}
		for k, val := range x {
			out[fmt.Sprint(k)] = val
		}
		return out, true
	case map[string]string:
		out := map[string]any{}
		for k, val := range x {
			out[k] = val
		}
		return out, true
	default:
		return nil, false
	}
}

func sortedStringMapKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func dedupRawRules(rules []rawFingerprintRule) []rawFingerprintRule {
	seen := map[string]struct{}{}
	out := make([]rawFingerprintRule, 0, len(rules))
	for _, r := range rules {
		expr := strings.TrimSpace(r.Expression)
		if expr == "" {
			continue
		}
		if _, ok := seen[expr]; ok {
			continue
		}
		seen[expr] = struct{}{}
		r.Expression = expr
		out = append(out, r)
	}
	return out
}

func mergeRawImportItems(items []rawFingerprintImport) []rawFingerprintImport {
	merged := map[string]*rawFingerprintImport{}
	order := []string{}
	for _, item := range items {
		product := normalizeProductDisplay(item.Product)
		if product == "" || len(item.Rules) == 0 {
			continue
		}
		key := normalizeImportProductName(product) + "\x00" + item.RelPath
		if merged[key] == nil {
			cp := item
			cp.Product = product
			cp.Rules = nil
			merged[key] = &cp
			order = append(order, key)
		}
		merged[key].Rules = append(merged[key].Rules, item.Rules...)
	}
	out := make([]rawFingerprintImport, 0, len(order))
	for _, key := range order {
		item := merged[key]
		item.Rules = dedupRawRules(item.Rules)
		out = append(out, *item)
	}
	return out
}

func uniqueImportProducts(m map[string][]string) []string {
	out := []string{}
	for norm := range m {
		if norm != "" {
			out = append(out, norm)
		}
	}
	sort.Strings(out)
	return out
}
