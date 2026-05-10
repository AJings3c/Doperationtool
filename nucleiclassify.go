package main

// nucleiclassify.go — 模板归类 (按厂商 / 产品 自动分组).
//
// 用户场景: 一坨 yaml 模板里有 adobe.yaml / adobecq-xxx.yaml / adobe-experience.yaml,
// 实际上都是 "adobe 厂商的模板", 想自动归到 adobe/ 子文件夹.
//
// 算法 (两步):
//   1. extractCategoryToken: 从文件名 / id 抽出一个 "主词" token, 跳过 cve / 纯数字 / 太短片段.
//   2. inferCategoryMap: 按前缀做 union, 让 {adobe, adobecq, adobe-experience} 全部归到 "adobe".
//      规则: 前缀 P 能 anchor token T (P 是 T 前缀) 当且仅当满足下列任一:
//        (a) P == T 且 len(P) >= 2  (token 自身可作为 anchor)
//        (b) T[len(P)] 是 '-' 或 '_' 且 len(P) >= 2 且 P 末尾不是 '-' '_' (干净的词边界)
//        (c) len(P) >= 5 (字母-字母衔接也允许, 但要够长才算"有意义")
//      处理顺序: 候选前缀按长度降序, 长度相同按字典序; 先匹配更具体的 anchor.
//      只有 "anchor 至少覆盖 2 个不同 token" 才生效, 否则各自独立.
//
// 输出: targetDir/<category>/<basename>; 同名冲突走 OnConflict (rename/skip/overwrite).
// 跨盘 rename 失败 fallback 到 copy + remove (复用 nucleidedup.go 的 copyFileAndRemove).

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// CategoryFile 单个文件在分类视图里的表现.
type CategoryFile struct {
	Path    string `json:"path"`
	RelPath string `json:"relPath"`
	Name    string `json:"name"`
	Id      string `json:"id"`
	Token   string `json:"token"` // 提取出来的分类主词, 空表示无法分类
	Size    int64  `json:"size"`
}

// ProposedCategory 一个自动推断出来的分类.
type ProposedCategory struct {
	Name   string         `json:"name"`   // anchor 前缀 (会作为目录名), 比如 "adobe"
	Tokens []string       `json:"tokens"` // 该分类下出现过的原始 token (升序, 去重)
	Files  []CategoryFile `json:"files"`  // 属于该分类的全部文件 (按 Path 升序)
}

// CategoryScanResult 扫描结果.
type CategoryScanResult struct {
	Folder        string             `json:"folder"`
	Total         int                `json:"total"`         // 扫到的 yaml 总数
	Categories    []ProposedCategory `json:"categories"`    // 按文件数降序; 单文件分类也保留, 让用户自己决定
	Uncategorized []CategoryFile     `json:"uncategorized"` // token 为空的 (纯 cve-XXXX-YYYY / 异形命名)
	Elapsed       string             `json:"elapsed"`
}

// CategoryAssignment 用户在 UI 上确认 / 编辑后的最终归属 (前端构造).
//   - Name: 最终目录名 (会做 sanitization, 不允许 / 和 .. 等)
//   - Paths: 该目录下要搬过去的源文件绝对路径
type CategoryAssignment struct {
	Name  string   `json:"name"`
	Paths []string `json:"paths"`
}

// ApplyCategoriesRequest 应用归类请求.
type ApplyCategoriesRequest struct {
	TargetDir   string               `json:"targetDir"`
	Assignments []CategoryAssignment `json:"assignments"`
	DryRun      bool                 `json:"dryRun"`
	OnConflict  string               `json:"onConflict"` // "rename" / "skip" / "overwrite"
}

// ApplyResult 单个文件的归类结果.
type ApplyResult struct {
	SrcPath  string `json:"srcPath"`
	DstPath  string `json:"dstPath"`
	Category string `json:"category"`
	Skipped  bool   `json:"skipped"`
	Reason   string `json:"reason,omitempty"`
}

// ApplyCategoriesResult 批量结果汇总.
type ApplyCategoriesResult struct {
	TargetDir string        `json:"targetDir"`
	Moved     int           `json:"moved"`
	Skipped   int           `json:"skipped"`
	DryRun    bool          `json:"dryRun"`
	Items     []ApplyResult `json:"items"`
	Elapsed   string        `json:"elapsed"`
}

// reSepSplit 用 [-_\s.]+ 切分文件名 / id, 涵盖大部分命名风格 (kebab/snake/dot).
var reSepSplit = regexp.MustCompile(`[-_\s.]+`)

// classifyStopwords token 提取时跳过的"无信息"词.
//   - cve / ghsa / cnvd: 漏洞编号前缀, 出现率高但没分类价值
//   - poc / exp / detect / scan / test / template / nuclei: 命名习惯里的通用词
//   - http / web / api: 协议层级标识, 太宽
//
// 这个列表保守点; 太激进会把 "wp-test" 这种正常命名也跳掉.
var classifyStopwords = map[string]bool{
	"cve": true, "ghsa": true, "cnvd": true, "cnnvd": true,
	"poc": true, "exp": true, "exploit": true,
	"nuclei": true, "template": true, "templates": true,
}

// reAllDigits 检查纯数字 (年份 / cve 编号片段).
var reAllDigits = regexp.MustCompile(`^\d+$`)

// extractCategoryToken 从文件名 + id 提取分类主词.
// 优先文件名 (用户对它更熟); 文件名抽不到再退到 id.
// 返回小写 token, 抽不到返回 "".
func extractCategoryToken(name, id string) string {
	if t := tokenFromString(name); t != "" {
		return t
	}
	return tokenFromString(id)
}

// tokenFromString 从一个字符串里抽出第一个有意义的词.
//   - 先剥 .yaml / .yml 扩展
//   - 全小写, 去前后空白
//   - 用 reSepSplit 切分
//   - 跳过停用词 / 纯数字 / 长度 < 2 的片段
//   - 返回第一个剩下的; 全空返回 ""
func tokenFromString(s string) string {
	if s == "" {
		return ""
	}
	if i := strings.LastIndex(s, "."); i >= 0 {
		ext := strings.ToLower(s[i:])
		if ext == ".yaml" || ext == ".yml" {
			s = s[:i]
		}
	}
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return ""
	}
	for _, p := range reSepSplit.Split(s, -1) {
		if len(p) < 2 {
			continue
		}
		if classifyStopwords[p] {
			continue
		}
		if reAllDigits.MatchString(p) {
			continue
		}
		return p
	}
	return ""
}

// 前缀 anchor 规则用的常量.
//
// MIN_PREFIX_LEN_AT_SEP: 词边界处 (P 后是 -/_) 允许的最小 P 长度.
//
//	2 够把 {wp-foo, wp-bar} 合到 "wp" — 用户对短前缀的合并通常乐于接受 (前提是边界对齐).
//
// MIN_PREFIX_LEN_NO_SEP: 字母-字母衔接处允许的最小 P 长度.
//
//	5 是经验值, 让 {adobe, adobecq} 能合, 但 {ab, abc} 不会瞎合.
const (
	classifyMinPrefixAtSep = 2
	classifyMinPrefixNoSep = 5
)

// inferCategoryMap 把 token 列表按前缀合并, 返回 token -> categoryName.
//   - 输入: tokens (含每个 token 的文件数, 用于稳定排序但不影响合并逻辑)
//   - 输出: 每个 token 应归到哪个 category (anchor 前缀)
//     · 若没合并, category 就是 token 自己
//     · category 是 "synthetic anchor" 时也允许 (例如 {adobecq, adobe-x} 合到 "adobe", "adobe" 不存在为独立 token)
func inferCategoryMap(tokenCounts map[string]int) map[string]string {
	if len(tokenCounts) == 0 {
		return map[string]string{}
	}
	tokens := make([]string, 0, len(tokenCounts))
	for t := range tokenCounts {
		tokens = append(tokens, t)
	}
	sort.Strings(tokens)

	// candidates[prefix] = set of tokens that this prefix can anchor.
	candidates := make(map[string]map[string]bool)
	add := func(prefix, tok string) {
		if candidates[prefix] == nil {
			candidates[prefix] = make(map[string]bool)
		}
		candidates[prefix][tok] = true
	}

	for _, t := range tokens {
		// rule (a): self-anchor
		if len(t) >= classifyMinPrefixAtSep {
			add(t, t)
		}
		// 枚举所有 P = t[:L], L 从 MIN_PREFIX_LEN_AT_SEP 到 len(t)-1.
		// sepSeen: 一旦在 t[:L-1] 里碰过 -/_, rule (c) 就不再生效 — 它只在"首词内"
		// 的字母-字母衔接处放行, 防止 {wp-content, wp-admin} 被中间前缀 "wp-co" 抢走 "wp" anchor.
		sepSeen := false
		for L := classifyMinPrefixAtSep; L < len(t); L++ {
			if L > 0 && (t[L-1] == '-' || t[L-1] == '_') {
				// 跳过末尾是分隔符的前缀 (例 "adobe-" 不应作为候选, 用 "adobe" 代替)
				sepSeen = true
				continue
			}
			prefix := t[:L]
			next := t[L]
			if next == '-' || next == '_' {
				// rule (b): 词边界处, 短到 2 也行
				add(prefix, t)
			} else if !sepSeen && L >= classifyMinPrefixNoSep {
				// rule (c): 字母-字母衔接, 仅限首词内 (没跨过 -/_)
				add(prefix, t)
			}
		}
	}

	// 收集所有 candidate prefix, 按 (长度降序, 字典升序) 排, 长前缀优先 ("adobecq" 比 "adobe" 更具体先处理)
	type pc struct {
		prefix string
		count  int
	}
	cands := make([]pc, 0, len(candidates))
	for p, set := range candidates {
		cands = append(cands, pc{p, len(set)})
	}
	sort.Slice(cands, func(i, j int) bool {
		if len(cands[i].prefix) != len(cands[j].prefix) {
			return len(cands[i].prefix) > len(cands[j].prefix)
		}
		return cands[i].prefix < cands[j].prefix
	})

	// 贪心分配: 候选必须能 anchor ≥ 2 个不同 token 才生效; 已被更具体 anchor 占用的 token 不再分配.
	assigned := make(map[string]string)
	for _, c := range cands {
		if c.count < 2 {
			continue
		}
		for tok := range candidates[c.prefix] {
			if _, has := assigned[tok]; !has {
				assigned[tok] = c.prefix
			}
		}
	}
	// 剩余 token 自己作为 standalone category
	for _, t := range tokens {
		if _, has := assigned[t]; !has {
			assigned[t] = t
		}
	}
	return assigned
}

// sanitizeCategoryName 把用户编辑过的 category 名清洗成合法目录名.
//   - 去掉路径分隔符 / .. / 控制字符
//   - 去前后空白
//   - 空字符串返回 "uncategorized"
func sanitizeCategoryName(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "uncategorized"
	}
	// 替换非法字符
	bad := []string{"/", "\\", "..", ":", "\x00"}
	for _, b := range bad {
		s = strings.ReplaceAll(s, b, "_")
	}
	s = strings.TrimSpace(s)
	if s == "" || s == "." {
		return "uncategorized"
	}
	return s
}

// ScanTemplateCategories 主入口: 扫 folder, 提 token, 推断分类, 返回结果.
// 跟 ScanDuplicateTemplates 共用 skipDirNames / maxFixFiles, 行为一致.
//
// 进度: "classify:progress" event, 跟 dedup scan 同款两阶段
// (scanning indeterminate / analyzing).
func (a *App) ScanTemplateCategories(folder string) (*CategoryScanResult, error) {
	start := time.Now()
	if strings.TrimSpace(folder) == "" {
		return nil, fmt.Errorf("目录为空")
	}
	info, err := os.Stat(folder)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("不是目录: %s", folder)
	}

	ctx, pe, cleanup := a.beginTask("classify:progress", "scanning", 0)
	defer cleanup()
	defer pe.finish("扫描完成")

	type rawFile struct {
		path, name, relPath, id, token string
		size                           int64
	}
	var files []rawFile
	werr := filepath.WalkDir(folder, func(path string, d os.DirEntry, walkErr error) error {
		if ctx.Err() != nil {
			return filepath.SkipAll
		}
		if walkErr != nil {
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if strings.HasPrefix(name, ".") {
				return filepath.SkipDir
			}
			if _, skip := skipDirNames[name]; skip {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(d.Name()))
		if ext != ".yaml" && ext != ".yml" {
			return nil
		}
		if len(files) >= maxFixFiles {
			return filepath.SkipAll
		}
		raw, rerr := os.ReadFile(path)
		var id string
		var sz int64
		if rerr == nil {
			id = extractTopLevelId(string(raw))
			sz = int64(len(raw))
		}
		rel, rrErr := filepath.Rel(folder, path)
		if rrErr != nil {
			rel = path
		}
		files = append(files, rawFile{
			path:    path,
			name:    d.Name(),
			relPath: rel,
			id:      id,
			token:   extractCategoryToken(d.Name(), id),
			size:    sz,
		})
		pe.tick(len(files), fmt.Sprintf("已扫描 %d 个 yaml", len(files)))
		return nil
	})
	if werr != nil {
		return nil, werr
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	pe.switchPhase("analyzing", len(files))
	sort.Slice(files, func(i, j int) bool { return files[i].path < files[j].path })

	// 统计 token 计数, 喂给 inferCategoryMap
	tokenCounts := make(map[string]int)
	for _, f := range files {
		if f.token != "" {
			tokenCounts[f.token]++
		}
	}
	tok2cat := inferCategoryMap(tokenCounts)

	// 按 category 收集文件
	catFiles := make(map[string][]CategoryFile)
	catTokens := make(map[string]map[string]bool)
	uncategorized := make([]CategoryFile, 0)
	for _, f := range files {
		cf := CategoryFile{
			Path:    f.path,
			RelPath: f.relPath,
			Name:    f.name,
			Id:      f.id,
			Token:   f.token,
			Size:    f.size,
		}
		if f.token == "" {
			uncategorized = append(uncategorized, cf)
			continue
		}
		cat := tok2cat[f.token]
		if cat == "" {
			cat = f.token
		}
		catFiles[cat] = append(catFiles[cat], cf)
		if catTokens[cat] == nil {
			catTokens[cat] = make(map[string]bool)
		}
		catTokens[cat][f.token] = true
	}

	res := &CategoryScanResult{
		Folder:        folder,
		Total:         len(files),
		Uncategorized: uncategorized,
	}
	for name, fs := range catFiles {
		toks := make([]string, 0, len(catTokens[name]))
		for t := range catTokens[name] {
			toks = append(toks, t)
		}
		sort.Strings(toks)
		// files 已按 path 升序 (上面 sort 过 files), 这里也复一次保险
		sort.Slice(fs, func(i, j int) bool { return fs[i].Path < fs[j].Path })
		res.Categories = append(res.Categories, ProposedCategory{
			Name:   name,
			Tokens: toks,
			Files:  fs,
		})
	}
	// 文件数降序, 同数按名升序; 让 UI 上常见大类排前面
	sort.Slice(res.Categories, func(i, j int) bool {
		if len(res.Categories[i].Files) != len(res.Categories[j].Files) {
			return len(res.Categories[i].Files) > len(res.Categories[j].Files)
		}
		return res.Categories[i].Name < res.Categories[j].Name
	})

	res.Elapsed = time.Since(start).Truncate(time.Millisecond).String()
	return res, nil
}

// ApplyTemplateCategories 把用户确认后的 (category -> paths) 映射真实写入文件系统.
//   - 每个 category 对应 targetDir/<sanitized name>/, 不存在自动 mkdir -p
//   - 同名冲突按 OnConflict 走 (rename/_dup_N / skip / overwrite); 跟去重页对齐
//   - DryRun: 只算 dst 不写盘
func (a *App) ApplyTemplateCategories(req ApplyCategoriesRequest) (*ApplyCategoriesResult, error) {
	return a.applyAssignmentsInternal(req, "classify:progress")
}

// applyAssignmentsInternal 真正干活的核心. 抽出来是因为 YAML 采集模块 (nucleicollect.go)
// 完全复用同一套 (Name, Paths) → targetDir/<Name>/ 的搬迁语义, 只想换个 progress event
// 名让前端进度卡片标题区分 "采集应用" vs "分类应用".
func (a *App) applyAssignmentsInternal(req ApplyCategoriesRequest, eventName string) (*ApplyCategoriesResult, error) {
	start := time.Now()
	if strings.TrimSpace(req.TargetDir) == "" {
		return nil, fmt.Errorf("目标目录为空")
	}
	if len(req.Assignments) == 0 {
		return nil, fmt.Errorf("分类列表为空")
	}
	policy := strings.ToLower(strings.TrimSpace(req.OnConflict))
	if policy == "" {
		policy = "rename"
	}
	switch policy {
	case "rename", "skip", "overwrite":
	default:
		return nil, fmt.Errorf("OnConflict 取值非法: %q (合法: rename / skip / overwrite)", req.OnConflict)
	}

	targetDir, err := filepath.Abs(req.TargetDir)
	if err != nil {
		return nil, fmt.Errorf("解析目标目录失败: %v", err)
	}
	if !req.DryRun {
		if err := os.MkdirAll(targetDir, 0o755); err != nil {
			return nil, fmt.Errorf("创建目标目录失败: %v", err)
		}
	}

	totalPaths := 0
	for _, a := range req.Assignments {
		totalPaths += len(a.Paths)
	}
	res := &ApplyCategoriesResult{
		TargetDir: targetDir,
		DryRun:    req.DryRun,
		Items:     make([]ApplyResult, 0, totalPaths),
	}

	// 进度 + 取消: dryRun "previewing" / 真跑 "applying". 双层循环, processed 累计
	// 喂给 pe.tick 让前端百分比正确滚动.
	phase := "applying"
	finishLabel := "应用完成"
	if req.DryRun {
		phase = "previewing"
		finishLabel = "预览完成"
	}
	ctx, pe, cleanup := a.beginTask(eventName, phase, totalPaths)
	defer cleanup()
	defer pe.finish(finishLabel)

	// 全局 dedup: 同一个源被多个分类同时引用时, 只算一次 (取第一个出现的分类)
	seenSrc := make(map[string]bool)
	// "本批已写入目标" 的名字集 (跨分类), 用于 dryRun + rename 策略下不撞车
	usedNames := make(map[string]bool)
	processed := 0

	for _, asgn := range req.Assignments {
		if ctx.Err() != nil {
			break
		}
		catName := sanitizeCategoryName(asgn.Name)
		catDir := filepath.Join(targetDir, catName)
		if !req.DryRun {
			if err := os.MkdirAll(catDir, 0o755); err != nil {
				// 单个分类目录建失败也不阻塞别的; 把该批文件全部记成 skip
				for _, p := range asgn.Paths {
					if seenSrc[p] {
						continue
					}
					seenSrc[p] = true
					res.Items = append(res.Items, ApplyResult{
						SrcPath:  p,
						Category: catName,
						Skipped:  true,
						Reason:   fmt.Sprintf("创建分类目录失败: %v", err),
					})
					res.Skipped++
				}
				continue
			}
		}

		for _, src := range asgn.Paths {
			if ctx.Err() != nil {
				break
			}
			processed++
			pe.tick(processed, fmt.Sprintf("已处理 %d/%d", processed, totalPaths))
			if src == "" || seenSrc[src] {
				continue
			}
			seenSrc[src] = true
			mr := ApplyResult{SrcPath: src, Category: catName}

			srcInfo, sErr := os.Stat(src)
			if sErr != nil {
				mr.Skipped = true
				mr.Reason = "源不存在或无法读取: " + sErr.Error()
				res.Items = append(res.Items, mr)
				res.Skipped++
				continue
			}
			if srcInfo.IsDir() {
				mr.Skipped = true
				mr.Reason = "源是目录, 不支持"
				res.Items = append(res.Items, mr)
				res.Skipped++
				continue
			}
			srcAbs, _ := filepath.Abs(src)
			if filepath.Dir(srcAbs) == catDir {
				mr.Skipped = true
				mr.Reason = "源已在目标分类目录, 跳过"
				res.Items = append(res.Items, mr)
				res.Skipped++
				continue
			}

			base := filepath.Base(src)
			dst := filepath.Join(catDir, base)
			exists := pathExists(dst) || usedNames[dst]
			if exists {
				switch policy {
				case "skip":
					mr.Skipped = true
					mr.DstPath = dst
					mr.Reason = "目标已存在 + onConflict=skip"
					res.Items = append(res.Items, mr)
					res.Skipped++
					continue
				case "overwrite":
					// 落到下面统一移动逻辑, dst 不变
				case "rename":
					stem, ext := splitNameExt(base)
					renamed := ""
					for n := 1; n <= maxDedupSuffix; n++ {
						cand := filepath.Join(catDir, fmt.Sprintf("%s_dup_%d%s", stem, n, ext))
						if !pathExists(cand) && !usedNames[cand] {
							renamed = cand
							break
						}
					}
					if renamed == "" {
						mr.Skipped = true
						mr.DstPath = dst
						mr.Reason = "rename 999 个 _dup_N 都被占用, 跳过"
						res.Items = append(res.Items, mr)
						res.Skipped++
						continue
					}
					dst = renamed
				}
			}

			mr.DstPath = dst
			usedNames[dst] = true
			if req.DryRun {
				res.Items = append(res.Items, mr)
				res.Moved++
				continue
			}
			if err := os.Rename(src, dst); err != nil {
				if cerr := copyFileAndRemove(src, dst); cerr != nil {
					mr.Skipped = true
					mr.Reason = "移动失败: " + err.Error() + " / fallback: " + cerr.Error()
					res.Items = append(res.Items, mr)
					res.Skipped++
					continue
				}
			}
			res.Items = append(res.Items, mr)
			res.Moved++
		}
	}

	res.Elapsed = time.Since(start).Truncate(time.Millisecond).String()
	return res, nil
}
