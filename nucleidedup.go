package main

// nucleidedup.go — 模板去重模块.
// 跟 nucleiautofix.go 里的 dedupTemplateIds 不同, 这套面向 "用户主动审阅 → 移走 / 删掉" 的场景:
//   1. ScanDuplicateTemplates 扫一个目录, 按 (id 同) ∪ (canonical 文件名同) 把文件分组.
//      连接关系是并集 (union-find): 文件 A 跟 B 同 id, B 跟 C 同名, 三者最终在一组.
//   2. MoveTemplateDuplicates 接收一组路径 + 目标目录, 把这些文件搬走 (mv 而非删, 用户随时可恢复).
//      同名冲突按 OnConflict 策略走 (默认 rename, 加 _dup_N 后缀).
//
// 设计约束:
//  - 完全离线, 不调用 nuclei.
//  - 跟 autofix 共用 skipDirNames / extractTopLevelId / maxFixFiles, 行为对齐 (避免一会扫 25000 一会 50000 让用户惊讶).
//  - 大目录 (1w 文件级) 必须 OK: 用 union-find 而非 O(n²) 两两比较.

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// DupTemplate 单个 yaml 文件在去重视图里的表现.
type DupTemplate struct {
	Path    string `json:"path"`    // 绝对路径
	RelPath string `json:"relPath"` // 相对扫描根目录的相对路径 (前端展示更短)
	Name    string `json:"name"`    // basename (含 .yaml/.yml 后缀)
	Id      string `json:"id"`      // 提取的顶层 id, 缺失为 ""
	NameKey string `json:"nameKey"` // canonical 化后的名字键 (剥扩展 / copy 后缀 / _数字 / 全小写), 用于分组
	Size    int64  `json:"size"`    // 字节数, 给前端可视化
}

// DupGroup 一组互为 "同一漏洞" 的文件.
//   - 同组内部按 Path 升序, 让前端做 "保留首个" 时定义稳定.
//   - SharedIds / SharedNames 给前端展示该组是 "因为什么" 被合并的, UI 上能解释 "为什么觉得它们是同一个漏洞".
type DupGroup struct {
	GroupKey    string        `json:"groupKey"`    // 给该组挑一个稳定的人类可读标签 (用第一个 id, 没就用 nameKey, 都没就用首个文件名)
	Reason      string        `json:"reason"`      // "id" / "name" / "id+name" / "transitive" — 解释"为什么这一组在一起"
	SharedIds   []string      `json:"sharedIds"`   // 该组中出现过的全部 id (去重排序), 给前端展示
	SharedNames []string      `json:"sharedNames"` // 该组中出现过的全部 nameKey (去重排序)
	Templates   []DupTemplate `json:"templates"`   // 长度 ≥ 2
}

// DupScanResult 扫描结果.
type DupScanResult struct {
	Folder         string     `json:"folder"`
	Total          int        `json:"total"`          // 扫到的 yaml 总数 (含未重复的)
	DuplicateCount int        `json:"duplicateCount"` // 冗余文件数 = Σ(size-1) per group, 即 "如果按 keep-first 移走可少多少文件"
	Groups         []DupGroup `json:"groups"`         // 仅含 size ≥ 2 的组, 按 Templates[0].Path 升序
	Elapsed        string     `json:"elapsed"`
}

// MoveDuplicatesRequest 移动请求. 前端用 dryRun 预览.
type MoveDuplicatesRequest struct {
	Paths      []string `json:"paths"`     // 要移走的源文件绝对路径
	TargetDir  string   `json:"targetDir"` // 目标目录 (不存在自动 mkdir -p)
	DryRun     bool     `json:"dryRun"`
	OnConflict string   `json:"onConflict"` // "rename" (默认) / "skip" / "overwrite"
}

// MoveResult 单个文件的移动结果.
type MoveResult struct {
	SrcPath string `json:"srcPath"`
	DstPath string `json:"dstPath"` // 实际写入的目标路径 (rename 时会带 _dup_N 后缀)
	Skipped bool   `json:"skipped"`
	Reason  string `json:"reason,omitempty"` // skip 原因, 例如 "目标已存在 + onConflict=skip" / "源不存在"
}

// MoveDuplicatesResult 移动汇总.
type MoveDuplicatesResult struct {
	TargetDir string       `json:"targetDir"` // 解析 / 创建后的绝对目录, 给前端打印
	Moved     int          `json:"moved"`
	Skipped   int          `json:"skipped"`
	DryRun    bool         `json:"dryRun"`
	Items     []MoveResult `json:"items"`
	Elapsed   string       `json:"elapsed"`
}

// reCopySuffix / reTrailNumSuffix — canonicalNameKey 用. 剥常见 "副本 / 复制版" 标记.
//   - " (copy)" / " (copy 1)" / " (copy 12)" — Finder / 文件管理器风格
//   - "_1" / "_2" / "_99" — 用户脚本批量 dump 时的递增后缀
//
// 注意: "-数字" 不剥 (CVE-2018-18326 整体含大量 "-数字" 段, 剥了会把 cve id 错合并)
var (
	reCopySuffix     = regexp.MustCompile(`\s*\(copy(?:\s+\d+)?\)\s*$`)
	reTrailNumSuffix = regexp.MustCompile(`_\d+$`)
)

// canonicalNameKey 把一个文件名 (含或不含扩展名都行) 折成稳定的 "同漏洞名" 键.
// 步骤:
//  1. 去 .yaml / .yml 扩展名
//  2. 反复剥 (copy) / (copy N) / 末尾 _数字 直到收敛 (有时两个一起用)
//  3. 全小写, 收掉前后空白
//  4. 还剩 "" 时返回 "" (调用方自己判断空值)
func canonicalNameKey(filename string) string {
	s := filename
	if i := strings.LastIndex(s, "."); i >= 0 {
		ext := strings.ToLower(s[i:])
		if ext == ".yaml" || ext == ".yml" {
			s = s[:i]
		}
	}
	// 反复剥, 直到不再变化. 避免 "foo (copy 1)_2.yaml" 这种叠合后缀漏剥.
	for {
		old := s
		s = reCopySuffix.ReplaceAllString(s, "")
		s = reTrailNumSuffix.ReplaceAllString(s, "")
		if s == old {
			break
		}
	}
	return strings.TrimSpace(strings.ToLower(s))
}

// ScanDuplicateTemplates 主入口: 扫 folder 下所有 yaml, 按 (id) ∪ (canonical name) 分组,
// 只返回 size ≥ 2 的组. 扫描限额跟 autofix 一致 (maxFixFiles), 并跳过同样的 skipDirNames.
//
// 进度: 走 "dedup:progress" event, 两阶段 (scanning indeterminate + analyzing 已知 total).
// scanning 阶段 walk + readFile 占绝大部分时间 (1.6w yaml 在 SSD 上 ~5s), analyzing 阶段
// union-find + 分组组装通常 < 50ms, 所以 analyzing 不打 tick, 只在终点 finish.
func (a *App) ScanDuplicateTemplates(folder string) (*DupScanResult, error) {
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

	// 进度 + 取消: total=0 indeterminate, walk 边走边 tick. ctx canceled 时 walk
	// 会在下一次回调时 return SkipAll, 函数尽快返回.
	ctx, pe, cleanup := a.beginTask("dedup:progress", "scanning", 0)
	defer cleanup()
	defer pe.finish("扫描完成")

	// 第一步: 收路径 + 提 id + 算 nameKey
	type rawFile struct {
		path    string
		name    string
		relPath string
		id      string
		nameKey string
		size    int64
	}
	var files []rawFile
	werr := filepath.WalkDir(folder, func(path string, d os.DirEntry, walkErr error) error {
		// 取消检测: 用户点取消后 ctx.Done(), walk 在下一次回调里直接 SkipAll 终止.
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
			nameKey: canonicalNameKey(d.Name()),
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

	// 路径升序, 让 "保留首个" 的语义稳定.
	sort.Slice(files, func(i, j int) bool { return files[i].path < files[j].path })

	res := &DupScanResult{
		Folder: folder,
		Total:  len(files),
	}

	// 第二步: union-find 把文件按 (id 同) ∪ (nameKey 同) 串起来.
	// 节点空间: 每个文件独立节点 + 每个 id 独立节点 + 每个 nameKey 独立节点.
	// 这样一文件 → 自己 id 节点 → 共享同 id 的别的文件, 链路天然连通.
	parent := make(map[string]string, len(files)*3)
	rank := make(map[string]int, len(files)*3)
	var find func(string) string
	find = func(x string) string {
		if parent[x] == x || parent[x] == "" {
			return x
		}
		root := find(parent[x])
		parent[x] = root
		return root
	}
	union := func(a, b string) {
		ra, rb := find(a), find(b)
		if ra == rb {
			return
		}
		if rank[ra] < rank[rb] {
			parent[ra] = rb
		} else if rank[ra] > rank[rb] {
			parent[rb] = ra
		} else {
			parent[rb] = ra
			rank[ra]++
		}
	}
	addNode := func(s string) {
		if _, ok := parent[s]; !ok {
			parent[s] = s
		}
	}

	for i, f := range files {
		fileNode := fmt.Sprintf("file::%d", i)
		addNode(fileNode)
		if f.id != "" {
			idNode := "id::" + f.id
			addNode(idNode)
			union(fileNode, idNode)
		}
		if f.nameKey != "" {
			nameNode := "name::" + f.nameKey
			addNode(nameNode)
			union(fileNode, nameNode)
		}
	}

	// 第三步: 按 root 把 file 节点聚合, 抛掉 size < 2 的组.
	roots := make(map[string][]int)
	for i := range files {
		root := find(fmt.Sprintf("file::%d", i))
		roots[root] = append(roots[root], i)
	}

	for _, indices := range roots {
		if len(indices) < 2 {
			continue
		}
		// 组内文件按路径升序 (与全局排序一致, 这里其实已经是 sorted, 但显式保险)
		sort.Ints(indices)
		// 收集组内全部 id / nameKey, 用于 Reason 判定 + 前端展示
		idSet := make(map[string]struct{})
		nameSet := make(map[string]struct{})
		tpls := make([]DupTemplate, 0, len(indices))
		for _, i := range indices {
			f := files[i]
			if f.id != "" {
				idSet[f.id] = struct{}{}
			}
			if f.nameKey != "" {
				nameSet[f.nameKey] = struct{}{}
			}
			tpls = append(tpls, DupTemplate{
				Path:    f.path,
				RelPath: f.relPath,
				Name:    f.name,
				Id:      f.id,
				NameKey: f.nameKey,
				Size:    f.size,
			})
		}
		ids := make([]string, 0, len(idSet))
		for k := range idSet {
			ids = append(ids, k)
		}
		sort.Strings(ids)
		names := make([]string, 0, len(nameSet))
		for k := range nameSet {
			names = append(names, k)
		}
		sort.Strings(names)

		// Reason 判定: 这组是因为 id 一致 / 名字一致 / 两者都一致 / 还是传递性 (混合) 才被合并.
		// 三种基本场景:
		//  - 所有文件都共享同一个 id, 没别的依据 → "id"
		//  - 所有文件都共享同一个 nameKey → "name"
		//  - 全组只有 1 个 id 且 1 个 nameKey, 且每个文件都同时拥有这俩 → "id+name"
		//  - 否则: 多 id 或多 nameKey 通过 union-find 合并 → "transitive"
		reason := "transitive"
		switch {
		case len(ids) == 1 && len(names) == 1 && allHaveBoth(tpls):
			reason = "id+name"
		case len(ids) == 1 && len(names) == 0:
			reason = "id"
		case len(names) == 1 && len(ids) == 0:
			reason = "name"
		case len(ids) == 1 && len(names) >= 1 && allHaveSameId(tpls):
			// 所有文件 id 都一样, 只是 nameKey 多样 / 部分缺失 — 主因还是 id
			reason = "id"
		case len(names) == 1 && len(ids) >= 1 && allHaveSameNameKey(tpls):
			reason = "name"
		}

		// 给组挑一个标签
		groupKey := ""
		switch {
		case len(ids) > 0:
			groupKey = ids[0]
		case len(names) > 0:
			groupKey = names[0]
		default:
			groupKey = tpls[0].Name
		}

		res.Groups = append(res.Groups, DupGroup{
			GroupKey:    groupKey,
			Reason:      reason,
			SharedIds:   ids,
			SharedNames: names,
			Templates:   tpls,
		})
		res.DuplicateCount += len(tpls) - 1
	}

	// 组之间: 按首个文件路径升序, 让 UI 里展示稳定.
	sort.Slice(res.Groups, func(i, j int) bool {
		return res.Groups[i].Templates[0].Path < res.Groups[j].Templates[0].Path
	})

	res.Elapsed = time.Since(start).Truncate(time.Millisecond).String()
	return res, nil
}

// allHaveSameId / allHaveSameNameKey / allHaveBoth — Reason 判定的小帮手.
func allHaveSameId(tpls []DupTemplate) bool {
	first := ""
	for _, t := range tpls {
		if t.Id == "" {
			return false
		}
		if first == "" {
			first = t.Id
		} else if t.Id != first {
			return false
		}
	}
	return first != ""
}
func allHaveSameNameKey(tpls []DupTemplate) bool {
	first := ""
	for _, t := range tpls {
		if t.NameKey == "" {
			return false
		}
		if first == "" {
			first = t.NameKey
		} else if t.NameKey != first {
			return false
		}
	}
	return first != ""
}
func allHaveBoth(tpls []DupTemplate) bool {
	for _, t := range tpls {
		if t.Id == "" || t.NameKey == "" {
			return false
		}
	}
	return true
}

// MoveTemplateDuplicates 把 req.Paths 里的文件搬到 req.TargetDir.
//   - 目标目录不存在则 mkdir -p
//   - 同名冲突 OnConflict=rename(默认): 在 stem 后追加 _dup_N (N 从 1 起, 找空位); skip: 不动; overwrite: 覆盖
//   - dryRun: 全程不写盘, 但还原计算所有 dst 路径 (含 rename 后的最终名), 给前端预览
//   - 任何单文件错误都不阻塞别的, 走 Items 汇报
func (a *App) MoveTemplateDuplicates(req MoveDuplicatesRequest) (*MoveDuplicatesResult, error) {
	start := time.Now()
	if strings.TrimSpace(req.TargetDir) == "" {
		return nil, fmt.Errorf("目标目录为空")
	}
	if len(req.Paths) == 0 {
		return nil, fmt.Errorf("待移动文件列表为空")
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

	// 防御: 同一批 paths 内部去重 (避免前端重复传入同一路径导致 _dup_N 浪费)
	seen := make(map[string]bool, len(req.Paths))
	uniq := make([]string, 0, len(req.Paths))
	for _, p := range req.Paths {
		if p == "" || seen[p] {
			continue
		}
		seen[p] = true
		uniq = append(uniq, p)
	}

	res := &MoveDuplicatesResult{
		TargetDir: targetDir,
		DryRun:    req.DryRun,
		Items:     make([]MoveResult, 0, len(uniq)),
	}

	// 进度 + 取消: dryRun "previewing" / 真跑 "moving". 循环顶部检 ctx.Err 提前退出.
	phase := "moving"
	finishLabel := "移动完成"
	if req.DryRun {
		phase = "previewing"
		finishLabel = "预览完成"
	}
	ctx, pe, cleanup := a.beginTask("dedup:progress", phase, len(uniq))
	defer cleanup()
	defer pe.finish(finishLabel)

	// "本批已写入目标" 的名字集, 用于 dryRun 和 rename 策略下连续生成不撞车的 _dup_N.
	usedNames := make(map[string]bool)
	for i, src := range uniq {
		// 取消检测: 一旦 ctx.Done(), 立刻退出循环 (defer 的 finish 会发 Cancelled=true).
		if ctx.Err() != nil {
			break
		}
		// 进度 tick 放循环顶部, 不论后续走 skip 还是 move 分支都能正常推进进度.
		pe.tick(i+1, fmt.Sprintf("已处理 %d/%d", i+1, len(uniq)))
		mr := MoveResult{SrcPath: src}
		// 源校验
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
		// 防自旋: src 已经在 targetDir 下且最终目标就是它自己时, 不动
		srcAbs, _ := filepath.Abs(src)
		if filepath.Dir(srcAbs) == targetDir {
			mr.Skipped = true
			mr.Reason = "源已在目标目录, 跳过"
			res.Items = append(res.Items, mr)
			res.Skipped++
			continue
		}

		base := filepath.Base(src)
		dst := filepath.Join(targetDir, base)
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
				// 走下面统一移动逻辑, dst 不变
			case "rename":
				// 在 stem 后加 _dup_N 直到空位 (上限 999, 跟 dedup id 对齐)
				stem, ext := splitNameExt(base)
				renamed := ""
				for n := 1; n <= maxDedupSuffix; n++ {
					cand := filepath.Join(targetDir, fmt.Sprintf("%s_dup_%d%s", stem, n, ext))
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
		// 实际搬运: 优先 rename (同盘 atomic), 跨盘失败时 fallback 到 copy + remove.
		if err := os.Rename(src, dst); err != nil {
			// 用 copy + remove 兜跨盘
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

	res.Elapsed = time.Since(start).Truncate(time.Millisecond).String()
	return res, nil
}

// splitNameExt 把 "foo.yaml" 拆成 ("foo", ".yaml"); 没扩展返回 (name, "").
// 不依赖 filepath.Ext 大小写, 但保留原大小写写回.
func splitNameExt(name string) (string, string) {
	i := strings.LastIndex(name, ".")
	if i < 0 {
		return name, ""
	}
	return name[:i], name[i:]
}

func pathExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// copyFileAndRemove 是 os.Rename 跨盘失败时的 fallback. 不保留 mtime / mode 比 mode bits 更激进
// (实际场景: 移到普通用户目录, 默认 0o644 反而更合理).
func copyFileAndRemove(src, dst string) error {
	raw, err := os.ReadFile(src)
	if err != nil {
		return fmt.Errorf("读源: %v", err)
	}
	if err := os.WriteFile(dst, raw, 0o644); err != nil {
		return fmt.Errorf("写目标: %v", err)
	}
	if err := os.Remove(src); err != nil {
		return fmt.Errorf("删源: %v", err)
	}
	return nil
}
