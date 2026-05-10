package main

// nucleiautofix.go
// 把 `nuclei -validate` 报的常见 ERR/WRN 一键修掉. 一切以 nuclei v3 官方文档为准:
//   - severity 合法枚举: undefined / info / low / medium / high / critical / unknown
//     (https://github.com/projectdiscovery/nuclei/blob/dev/SYNTAX-REFERENCE.md#severityholder)
//   - info 块顶层合法字段: name, author, tags, description, impact, reference,
//     severity, metadata, classification, remediation
//     (任何其它字段必须挪到 info.metadata 这个 freeform map 里)
//   - matcher 里 word 字段是错的, 必须是 words (复数)
//   - 模板 id 必须匹配正则 ^([a-zA-Z0-9]+[-_])*[a-zA-Z0-9]+$
//
// 实现选了 line-based 而不是 yaml.v3 round-trip, 因为:
//   - 用户人审 yaml 时关心格式 / 注释 / 键序; round-trip 会全部洗一遍
//   - nuclei 模板格式高度规整, 缩进固定 2 空格, 顶层键有限可枚举, line-based 足够稳
//   - 单文件改动只动报错的几行, diff 干净, 用户回滚也容易

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// 校验后端: 用 yaml.v3 解析修过的内容, 跑通了说明语法没坏 (业务字段对错由 nuclei 验证).
// 不校验 nuclei schema, 那是 nuclei 自己的活, 我们只保证不写出语法损坏的 yaml.

// AutoFixOptions 是一次自动修复的开关合集. 默认全 false, 调用方按需打开.
//   - DryRun 为 true 时只统计/收集 changes, 完全不写盘 (前端预览必走)
//   - Backup 为 true 时改前先 cp 一份到 <path>.bak.<unix> (可放心)
//   - SeverityValue 为空时落 "unknown" (nuclei 合法占位, 前端可指定 "info"/"medium" 等)
type AutoFixOptions struct {
	DryRun          bool   `json:"dryRun"`
	Backup          bool   `json:"backup"`
	FixSeverity     bool   `json:"fixSeverity"`
	SeverityValue   string `json:"severityValue"`
	FixInfoFields   bool   `json:"fixInfoFields"`
	FixMatcherWord  bool   `json:"fixMatcherWord"`
	FixRequestsHTTP bool   `json:"fixRequestsHTTP"`
	FixId           bool   `json:"fixId"`
	DedupId         bool   `json:"dedupId"`
}

// AutoFixResult 是整体报告. Changes 列每个被改动的文件做了哪些修复, 给前端做 diff 预览/确认弹窗.
type AutoFixResult struct {
	Folder       string          `json:"folder"`
	Total        int             `json:"total"`     // 扫描的 yaml 文件总数
	Fixed        int             `json:"fixed"`     // 实际有改动 (含 dry-run 的"将要改")
	Unchanged    int             `json:"unchanged"` // 没动到的
	Failed       int             `json:"failed"`    // 修完后再 parse 仍失败 / IO 错的
	DryRun       bool            `json:"dryRun"`
	Changes      []FileFixChange `json:"changes"`
	DedupRenames []DedupRename   `json:"dedupRenames"`
	Elapsed      string          `json:"elapsed"`
}

// FileFixChange 是单文件改动报告.
type FileFixChange struct {
	Path         string   `json:"path"`
	AppliedFixes []string `json:"appliedFixes"` // ["insert severity: unknown", "rename issues -> reference", ...]
	OriginalSize int      `json:"originalSize"`
	NewSize      int      `json:"newSize"`
	BackupPath   string   `json:"backupPath,omitempty"`
	Skipped      bool     `json:"skipped"`
	SkipReason   string   `json:"skipReason,omitempty"`
}

// DedupRename 是 dedup 跨文件重命名的记录.
type DedupRename struct {
	Path  string `json:"path"`
	OldId string `json:"oldId"`
	NewId string `json:"newId"`
}

const (
	// 单次扫描的安全上限. 25000 个 yaml 也都能容纳; 防误选 home 走废.
	maxFixFiles = 50000
	// dedup 时给 nuclei id 加的最大尝试次数. 同一个 id 最多兜 999 个变体, 实际远用不到.
	maxDedupSuffix = 999
)

// validSeverities 严格按官方 SYNTAX-REFERENCE.md severity.Holder 的 Enum Values.
var validSeverities = map[string]struct{}{
	"undefined": {}, "info": {}, "low": {}, "medium": {},
	"high": {}, "critical": {}, "unknown": {},
}

// nuclei id 合法正则 (跟 nuclei 自己用的一致, 错误信息里就这串).
var reNucleiId = regexp.MustCompile(`^([a-zA-Z0-9]+[-_])*[a-zA-Z0-9]+$`)

// metadataKeyMoves 列出 "本来不在 info 顶层但用户常写错" 的字段, 一律挪到 info.metadata.
// 这些都是 nuclei v3 schema 不接受的顶层字段, 但 metadata 是 map[string]interface{} 自由
// key-value, 挪进去就合法了, 数据也保留下来.
var metadataKeyMoves = map[string]bool{
	"vendor": true, "source": true, "software": true, "edb": true,
	"product": true, "version": true, "category": true,
}

// referenceAliases 是 "本来想写 reference 但写错了" 的同义键, 一律改名为 reference.
//   - issues 是 GitHub 风格习惯, 但 nuclei 不认
//   - references (复数) 是直觉拼写, nuclei 也不认 (只认单数)
//   - refrense 是常见拼写错
var referenceAliases = map[string]bool{
	"issues": true, "references": true, "refrense": true,
}

// AutoFixNucleiTemplates 主入口: 扫 folder 下所有 .yaml/.yml, 按 opts 跑修复.
// 不在 PATH 上调 nuclei, 完全离线; 修完后用 yaml.v3 自校验语法不坏.
func (a *App) AutoFixNucleiTemplates(folder string, opts AutoFixOptions) (*AutoFixResult, error) {
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
	if opts.SeverityValue != "" {
		if _, ok := validSeverities[opts.SeverityValue]; !ok {
			return nil, fmt.Errorf("severity 值 %q 不在合法枚举里 (合法值: undefined/info/low/medium/high/critical/unknown)", opts.SeverityValue)
		}
	} else {
		opts.SeverityValue = "unknown"
	}

	res := &AutoFixResult{
		Folder:  folder,
		DryRun:  opts.DryRun,
		Changes: []FileFixChange{},
	}

	// 进度 + 取消: 三阶段 (scanning indeterminate → deduping → fixing). 每阶段
	// 入口 + 循环顶部检 ctx.Err.
	ctx, pe, cleanup := a.beginTask("autofix:progress", "scanning", 0)
	defer cleanup()
	defer pe.finish("修复完成")

	// 先收集所有 yaml 路径 (sorted, 让 dedup 有稳定的 "首次出现" 定义)
	var paths []string
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
		if len(paths) >= maxFixFiles {
			return filepath.SkipAll
		}
		paths = append(paths, path)
		pe.tick(len(paths), fmt.Sprintf("已扫描 %d 个 yaml", len(paths)))
		return nil
	})
	if werr != nil {
		return nil, werr
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	sort.Strings(paths)
	res.Total = len(paths)

	// dedup 单独走一遍 (它依赖跨文件视图, 跟单文件 fix 是不同维度).
	// 注: dedupTemplateIds 内部是个紧凑循环, 没接 ctx (改动它要传参), 这里在它前后
	// 各加 ctx 检查; 用户在 dedup 阶段中点取消最坏要等到这一阶段跑完才生效, 但 dedup
	// 通常 < 1s, 可接受.
	if opts.DedupId {
		pe.switchPhase("deduping", len(paths))
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		renames, err := dedupTemplateIds(paths, opts)
		if err != nil {
			return nil, err
		}
		res.DedupRenames = renames
	}

	// 单文件 fix loop. 串行以避免 dedup 改写后跟单文件 fix 之间的竞态;
	// 25000 个文件 line-based 处理也就 1-2s, 不必并发.
	pe.switchPhase("fixing", len(paths))
	for i, p := range paths {
		if ctx.Err() != nil {
			break
		}
		pe.tick(i+1, fmt.Sprintf("已处理 %d/%d", i+1, len(paths)))
		ch := fixOneYaml(p, opts)
		if ch == nil {
			continue // 没扫的 (例如 dedup 阶段已删/改名)
		}
		if ch.Skipped {
			res.Failed++
		} else if len(ch.AppliedFixes) == 0 {
			res.Unchanged++
		} else {
			res.Fixed++
		}
		// 只把 "有动到" 或 "skip" 的项收进 changes, 全 unchanged 不污染前端列表
		if len(ch.AppliedFixes) > 0 || ch.Skipped {
			res.Changes = append(res.Changes, *ch)
		}
	}

	res.Elapsed = time.Since(start).Truncate(time.Millisecond).String()
	return res, nil
}

// fixOneYaml 跑单个文件的所有开启的 fix, 返回 change report. 发生 IO / parse 错时填 Skipped.
//
// 行结尾处理: 全部 fix 函数都用 LF (`\n`) 做行扫描和精确匹配 (例如 `l == "info:"`).
// 如果文件是 Windows / 混合 CRLF, 每行末尾会留 `\r`, 把所有 line-equality 检查都击溃,
// 表现为 "fix 看上去没生效". 这里在入口统一把 CRLF 折成 LF, 出口再按原约定写回.
// 全 LF / 全 CRLF / 混合 CRLF 三种情况都按 "原文件含 CRLF 就回写 CRLF, 否则 LF" 处理,
// 数据上等价、视觉上回归正常 (不会突然出现一文件混 endings).
func fixOneYaml(path string, opts AutoFixOptions) *FileFixChange {
	raw, err := os.ReadFile(path)
	if err != nil {
		return &FileFixChange{Path: path, Skipped: true, SkipReason: "读文件失败: " + err.Error()}
	}
	orig := string(raw)
	hadCRLF := strings.Contains(orig, "\r\n")
	cur := orig
	if hadCRLF {
		// 注意先 \r\n → \n, 再清残留的孤儿 \r (rare). 顺序反过来会把孤儿 \r 跟后面的 \n
		// 错误粘成 \r\n 再被替换成 \n, 行号关系变了.
		cur = strings.ReplaceAll(cur, "\r\n", "\n")
		cur = strings.ReplaceAll(cur, "\r", "\n")
	}
	normalized := cur // 记录归一化后的入口内容, 用于 "是否真有变化" 比较
	var applied []string

	if opts.FixId {
		next, fixes := applyFixId(cur)
		if len(fixes) > 0 {
			cur = next
			applied = append(applied, fixes...)
		}
	}
	if opts.FixSeverity {
		next, fixes := applyFixSeverityMissing(cur, opts.SeverityValue)
		if len(fixes) > 0 {
			cur = next
			applied = append(applied, fixes...)
		}
	}
	if opts.FixInfoFields {
		next, fixes := applyFixInfoFields(cur)
		if len(fixes) > 0 {
			cur = next
			applied = append(applied, fixes...)
		}
	}
	if opts.FixMatcherWord {
		next, fixes := applyFixMatcherWord(cur)
		if len(fixes) > 0 {
			cur = next
			applied = append(applied, fixes...)
		}
	}
	if opts.FixRequestsHTTP {
		next, fixes := applyFixRequestsHTTP(cur)
		if len(fixes) > 0 {
			cur = next
			applied = append(applied, fixes...)
		}
	}

	// 对外暴露的 size 用 "归一化后" 的字符数, 跟 fix 在内部看到的内容一致.
	ch := &FileFixChange{
		Path:         path,
		AppliedFixes: applied,
		OriginalSize: len(orig),
		NewSize:      len(cur),
	}
	if cur == normalized || len(applied) == 0 {
		// 没改, 不写盘也不备份, 返回空 changes (即便原文是 CRLF 也别动它)
		ch.AppliedFixes = nil
		return ch
	}

	// 修完做 yaml 语法自校验. 这一步是防线: 万一某个 fix 函数生出语法损坏的 yaml,
	// 我们要立刻发现并跳过该文件 (Skipped + SkipReason), 不能写出去坏盘.
	var probe interface{}
	if err := yaml.Unmarshal([]byte(cur), &probe); err != nil {
		ch.Skipped = true
		ch.SkipReason = "fix 后 yaml 语法失败: " + err.Error()
		ch.AppliedFixes = nil
		return ch
	}

	if opts.DryRun {
		return ch
	}

	if opts.Backup {
		bak := fmt.Sprintf("%s.bak.%d", path, time.Now().Unix())
		if err := os.WriteFile(bak, raw, 0o644); err != nil {
			ch.Skipped = true
			ch.SkipReason = "备份失败: " + err.Error()
			ch.AppliedFixes = nil
			return ch
		}
		ch.BackupPath = bak
	}
	// 写回时按原 endings 还原: 原本是 CRLF 就 LF→CRLF, 否则就保持 LF.
	out := cur
	if hadCRLF {
		out = strings.ReplaceAll(out, "\n", "\r\n")
	}
	if err := os.WriteFile(path, []byte(out), 0o644); err != nil {
		ch.Skipped = true
		ch.SkipReason = "写文件失败: " + err.Error()
		ch.AppliedFixes = nil
		return ch
	}
	ch.NewSize = len(out)
	return ch
}

// =============== 单文件 fix 实现 ===============

// applyFixId 把首个 ^id: VALUE 行的 VALUE slugify 成合法 nuclei id, 不改大小写 (nuclei 接受大写).
// 不动多文档分隔符 (`---`) 之后的内容, nuclei 模板都是单文档.
func applyFixId(content string) (string, []string) {
	lines := strings.Split(content, "\n")
	for i, l := range lines {
		// 顶层 id: 必须没缩进
		if !strings.HasPrefix(l, "id:") && !strings.HasPrefix(l, "id ") {
			continue
		}
		// 拆 "id: VALUE [#comment]"
		rest := strings.TrimSpace(strings.TrimPrefix(l, "id:"))
		// 处理可能的引号
		quote := ""
		val := rest
		// 末尾行内注释 (rare but possible)
		var trail string
		if hashIdx := indexOfUnquotedHash(val); hashIdx >= 0 {
			trail = " " + val[hashIdx:]
			val = strings.TrimSpace(val[:hashIdx])
		}
		if (strings.HasPrefix(val, `"`) && strings.HasSuffix(val, `"`)) ||
			(strings.HasPrefix(val, `'`) && strings.HasSuffix(val, `'`)) {
			quote = string(val[0])
			val = val[1 : len(val)-1]
		}
		if reNucleiId.MatchString(val) {
			return content, nil // 已合法, 不动
		}
		newId := slugifyNucleiId(val)
		if newId == "" {
			// 整个 id 都没合法字符 → 用文件名 fallback (调用方应当先做更好的 fallback,
			// 但这里至少让生成的 yaml 自身合法). 用 md5 前缀防撞.
			h := md5.Sum([]byte(val))
			newId = "tpl-" + hex.EncodeToString(h[:4])
		}
		newLine := "id: " + quote + newId + quote + trail
		lines[i] = newLine
		return strings.Join(lines, "\n"), []string{fmt.Sprintf("rename id: %q → %q", val, newId)}
	}
	return content, nil
}

// slugifyNucleiId 按 nuclei id 正则的字符集做白名单过滤, 保留大小写.
//   - 合法字符: a-zA-Z0-9 - _
//   - 其它字符全部替换成 "-", 然后去掉首尾 "-_", 折叠连续 "-".
func slugifyNucleiId(s string) string {
	var sb strings.Builder
	prevDash := true
	for _, r := range s {
		switch {
		case (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			sb.WriteRune(r)
			prevDash = false
		case r == '-' || r == '_':
			if !prevDash {
				sb.WriteRune(r)
				prevDash = true
			}
		default:
			if !prevDash {
				sb.WriteByte('-')
				prevDash = true
			}
		}
	}
	return strings.Trim(sb.String(), "-_")
}

// indexOfUnquotedHash 返回字符串里第一个 "不在引号里" 的 # 位置. 没找到返回 -1.
// 给 id 行剥行尾注释用. 简单状态机, 跟 yaml/JSON parser 不一回事, 但 id 行不会出现 escape.
func indexOfUnquotedHash(s string) int {
	inSingle, inDouble := false, false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '\'' && !inDouble:
			inSingle = !inSingle
		case c == '"' && !inSingle:
			inDouble = !inDouble
		case c == '#' && !inSingle && !inDouble:
			return i
		}
	}
	return -1
}

// applyFixSeverityMissing 处理 nuclei 报的 "field 'severity' is missing", 包含两种现实场景:
//  1. info 块里压根没 severity 行 → 在 author/name 块尾后插一行 `severity: <def>`.
//  2. severity 行存在但值为空 (常见: `severity:` / `severity: ` / `severity:  # comment`)
//     → 把空值就地替换成 def. nuclei 的 enum 校验把空值视为 missing, 不就地填值的话
//     "一键修复" 跑完该模板仍会被 nuclei 拒载, 用户体验上等于没修.
//
// def 必须是 validSeverities 里的合法值, 调用方在主入口已 validate.
func applyFixSeverityMissing(content, def string) (string, []string) {
	lines := strings.Split(content, "\n")
	iStart, iEnd, ind := scanInfoBlock(lines)
	if iStart < 0 || ind == "" {
		return content, nil
	}
	// 找已存在的 severity 行 (含 "key 在但 value 为空" 的非法形态)
	sevIdx := -1
	for i := iStart + 1; i < iEnd; i++ {
		if isKeyLine(lines[i], ind, "severity") {
			sevIdx = i
			break
		}
	}
	if sevIdx >= 0 {
		// 已有 severity 行, 看 value 是否真的有内容. 空值或只有行内注释都算缺失.
		line := lines[sevIdx]
		// 解析: 剥前导 indent 后, 去掉 "severity:" 前缀, 余下的就是 value 部分 (含可能注释).
		afterColon := strings.TrimPrefix(strings.TrimLeft(line, " \t"), "severity:")
		valuePart := afterColon
		if hashIdx := indexOfUnquotedHash(valuePart); hashIdx >= 0 {
			valuePart = valuePart[:hashIdx]
		}
		if strings.TrimSpace(valuePart) != "" {
			return content, nil // 已经有合法 (或至少非空) 值, 不动
		}
		// 重建行: indent + "severity: " + def, 再把原行的注释 (rare) 接回行尾.
		newLine := ind + "severity: " + def
		if hashIdx := indexOfUnquotedHash(line); hashIdx >= 0 {
			newLine += "  " + line[hashIdx:]
		}
		lines[sevIdx] = newLine
		return strings.Join(lines, "\n"), []string{"set empty severity → " + def}
	}
	// 找 author 行块尾, 否则 name 行块尾, 否则紧跟 info 行.
	insertAt := iStart + 1
	for _, want := range []string{"author", "name"} {
		k, blockEnd := findKeyLineInBlock(lines, iStart+1, iEnd, ind, want)
		if k >= 0 {
			insertAt = blockEnd
			break
		}
	}
	newLine := ind + "severity: " + def
	out := make([]string, 0, len(lines)+1)
	out = append(out, lines[:insertAt]...)
	out = append(out, newLine)
	out = append(out, lines[insertAt:]...)
	return strings.Join(out, "\n"), []string{"insert severity: " + def}
}

// applyFixInfoFields 处理两类 info 块的非法子键:
//  1. issues / references / refrense → 优先 rename 成 reference (reference 不存在时);
//     已有 reference 时把 alias 整块挪到 info.metadata.<alias> (老版本是只记 skip 不动手,
//     但 alias 字段会让 nuclei 整模板拒载, 等于没修. 挪到 metadata 后数据不丢、nuclei 通过,
//     用户事后再手动合并到 reference 也方便).
//  2. vendor / source / software / edb / product → 整块挪到 metadata 下 (没 metadata 就建).
//
// 实现把两类合并: 第一步先决定哪些 referenceAlias 需要 "rename" / 哪些需要 "moveToMetadata",
// 第二步统一按 keysToMove 把所有需要搬走的键 (含 metadataKeyMoves + alias-with-reference) 一次性
// 摘走再塞进 metadata.
func applyFixInfoFields(content string) (string, []string) {
	lines := strings.Split(content, "\n")
	iStart, iEnd, ind := scanInfoBlock(lines)
	if iStart < 0 || ind == "" {
		return content, nil
	}
	var fixes []string

	// 默认要搬到 metadata 的键集合; 第一步可能再加上 "alias-with-existing-reference".
	keysToMove := make(map[string]bool, len(metadataKeyMoves)+len(referenceAliases))
	for k := range metadataKeyMoves {
		keysToMove[k] = true
	}

	// ---- 第一步: 处理 referenceAliases ----
	// 没 reference: rename alias → reference (首个 alias 转正即可, 后续 alias 走 metadata 路径).
	// 有 reference: 把 alias 入队搬到 metadata.
	hasReference := false
	if k, _ := findKeyLineInBlock(lines, iStart+1, iEnd, ind, "reference"); k >= 0 {
		hasReference = true
	}
	for alias := range referenceAliases {
		k, _ := findKeyLineInBlock(lines, iStart+1, iEnd, ind, alias)
		if k < 0 {
			continue
		}
		if hasReference {
			// 已有 reference: 入队走 metadata. 第二步会按 keysToMove 找到 alias 行并搬走.
			keysToMove[alias] = true
			fixes = append(fixes, fmt.Sprintf("move info.%s → info.metadata.%s (已有 reference, 自动避让)", alias, alias))
			continue
		}
		// 直接把 key 部分换名, value 那部分 (含子项) 不动
		old := lines[k]
		// 保留首部 indent, 替换 key 为 reference (注意 alias 后面紧跟 ":")
		// 行可能是 "  issues:" 或 "  issues: ..." 或 "  issues:  # comment"
		colon := strings.Index(old, ":")
		if colon < 0 {
			continue
		}
		// 要求 colon 之前剥掉 indent 后正好等于 alias (防止 "issues_old:" 被误改)
		head := old[:colon]
		// head = "  issues" 必须 == ind + alias
		if strings.TrimLeft(head, " \t") != alias {
			continue
		}
		lines[k] = ind + "reference" + old[colon:]
		fixes = append(fixes, fmt.Sprintf("rename %s → reference", alias))
		hasReference = true // 已经造出来了, 后续 alias 不再 rename
		// 重新算 iEnd (理论不变, 但保险起见)
		_, iEnd, _ = scanInfoBlock(lines)
	}

	// ---- 第二步: 按 keysToMove 把对应键挪到 metadata ----
	// 收集 (key, raw lines, original startIdx, originalEndIdx) 然后从 lines 删掉,
	// 最后把它们整体 (递增缩进 2) 塞到 metadata 块尾部.
	type movedKey struct {
		name     string
		rawLines []string // 含 key 行 + 子行, 已经按原缩进保留
	}
	var moved []movedKey

	// 反向遍历: 删行不破坏前面行的 index
	for i := iEnd - 1; i > iStart; i-- {
		l := lines[i]
		// 必须是直接子级 (indent 严格等于 info 子缩进, 不是孙级)
		if !strings.HasPrefix(l, ind) {
			continue
		}
		if strings.HasPrefix(l, ind+" ") || strings.HasPrefix(l, ind+"\t") {
			continue // 是孙级
		}
		colon := strings.Index(l, ":")
		if colon <= len(ind) {
			continue
		}
		key := strings.TrimLeft(l[:colon], " \t")
		if !keysToMove[key] {
			continue
		}
		// 块结尾: 走 blockEndOfKey, 含同缩进 "- item" 列表项 (YAML 合法形式).
		// 若不含, vendor/source 这种挪动会只截到一半, 剩下的列表项变成孤儿.
		blockEnd := blockEndOfKey(lines, i, len(lines), ind)
		// 摘出来
		raw := append([]string{}, lines[i:blockEnd]...)
		moved = append([]movedKey{{name: key, rawLines: raw}}, moved...)
		lines = append(lines[:i], lines[blockEnd:]...)
	}

	if len(moved) > 0 {
		// 删过行, 重新定位 info 块
		iStart, iEnd, ind = scanInfoBlock(lines)
		if iStart < 0 {
			// 不应该发生, 兜底
			return strings.Join(lines, "\n"), fixes
		}
		// 找 metadata 块, 不存在就在 info 末尾建
		mStart, mEnd := findKeyLineInBlock(lines, iStart+1, iEnd, ind, "metadata")
		if mStart < 0 {
			// 在 info 末尾插 "  metadata:"
			insertAt := iEnd
			lines = insertLine(lines, insertAt, ind+"metadata:")
			mStart = insertAt
			mEnd = mStart + 1
		}
		// 把 moved 的每条 rawLines 缩进 +2 后追加到 mEnd 之前.
		// 注意: alias-with-reference 在第一步已经写过 fix 描述, 这里只为 metadataKeyMoves
		// 的键补描述, 避免双计数.
		extra := make([]string, 0)
		for _, mk := range moved {
			for _, rl := range mk.rawLines {
				if rl == "" {
					extra = append(extra, "")
				} else {
					extra = append(extra, "  "+rl)
				}
			}
			if metadataKeyMoves[mk.name] {
				fixes = append(fixes, fmt.Sprintf("move info.%s → info.metadata.%s", mk.name, mk.name))
			}
		}
		lines = insertLines(lines, mEnd, extra)
	}

	if len(fixes) == 0 {
		return content, nil
	}
	return strings.Join(lines, "\n"), fixes
}

// applyFixMatcherWord 把 matcher item 里写错的 `word:` 改名为 `words:`.
// 安全策略: 只当同 item 里有 `type: word` 兄弟时才改 (避免改到不相关的 yaml 上下文,
// 例如 metadata 里某人写了个叫 word 的字段).
func applyFixMatcherWord(content string) (string, []string) {
	lines := strings.Split(content, "\n")
	var fixes []string
	// 简化: 只看 matchers: 块内的 - type: word + word: 配对.
	// matchers 可能在 requests/http/network/etc 下, 任意深度. 我们用 "matchers:" 行 +
	// 后续若干同/孙级缩进探测.
	for i := 0; i < len(lines); i++ {
		l := lines[i]
		trimmed := strings.TrimLeft(l, " \t")
		// 兼容两种 matchers: 行形式:
		//   "matchers:"     — 列表项里的常规键, mIndent = leading spaces
		//   "- matchers:"   — 列表项首键内联在 dash 之后, mIndent = leading + 2 (跨过 dash + 空格)
		var mIndent int
		switch {
		case trimmed == "matchers:":
			mIndent = countLeadingSpaces(l)
		case trimmed == "- matchers:":
			mIndent = countLeadingSpaces(l) + 2
		default:
			continue
		}
		// matchers 的 item 用 `- type:` 形式, 缩进比 matchers: 多 2.
		// 我们扫到下一个同/更浅缩进的非空行为止.
		j := i + 1
		for j < len(lines) {
			ll := lines[j]
			if ll == "" {
				j++
				continue
			}
			leading := countLeadingSpaces(ll)
			if leading <= mIndent {
				break
			}
			j++
		}
		// 在 [i+1, j) 范围里按 "- " 行切 item.
		// 关键: 只有缩进 ==第一个 item head 缩进的 "- " 行才是 item head;
		// 子级数组里的 "- value" 缩进更深, 不能误识别为 item.
		itemStart := -1
		itemIndent := -1
		for k := i + 1; k <= j; k++ {
			isItemHead := false
			if k < j {
				ll := lines[k]
				if ll != "" {
					leading := countLeadingSpaces(ll)
					trimL := strings.TrimLeft(ll, " \t")
					if strings.HasPrefix(trimL, "- ") || trimL == "-" {
						if itemIndent < 0 {
							itemIndent = leading
							isItemHead = true
						} else if leading == itemIndent {
							isItemHead = true
						}
					}
				}
			}
			if isItemHead || k == j {
				if itemStart >= 0 {
					// [itemStart, k) 是上一个 item, 处理它
					fixMatcherItemWord(lines, itemStart, k, &fixes)
				}
				if isItemHead {
					itemStart = k
				}
			}
		}
		i = j - 1 // 跳过这块, 外层 i++ 会到 j
	}
	if len(fixes) == 0 {
		return content, nil
	}
	return strings.Join(lines, "\n"), fixes
}

func applyFixRequestsHTTP(content string) (string, []string) {
	lines := strings.Split(content, "\n")
	reqIdx := -1
	hasHTTP := false
	for i, l := range lines {
		trim := strings.TrimRight(l, " \t")
		switch trim {
		case "http:":
			if countLeadingSpaces(l) == 0 {
				hasHTTP = true
			}
		case "requests:":
			if countLeadingSpaces(l) == 0 && reqIdx < 0 {
				reqIdx = i
			}
		}
	}
	if reqIdx < 0 || hasHTTP {
		return content, nil
	}
	lines[reqIdx] = "http:"
	return strings.Join(lines, "\n"), []string{"rename top-level requests → http"}
}

// fixMatcherItemWord 在单个 matcher item ([start, end)) 内做 word→words rename.
// 修改 lines 原地. fixes 累加 rename 描述.
func fixMatcherItemWord(lines []string, start, end int, fixes *[]string) {
	hasTypeWord := false
	wordLineIdx := -1
	wordIndent := ""
	for k := start; k < end; k++ {
		l := lines[k]
		trim := strings.TrimLeft(l, " \t")
		// 兼容 item 首行的 "- type: word" 形式: 把 dash + 空格 剥掉再判键名.
		afterDash := strings.TrimPrefix(trim, "- ")
		if strings.HasPrefix(afterDash, "type:") {
			val := strings.TrimSpace(strings.TrimPrefix(afterDash, "type:"))
			val = strings.Trim(val, `"' `)
			if val == "word" {
				hasTypeWord = true
			}
		}
		// 完全匹配 "word:" (含可选行内 value), 排除 "words:".
		isWordKey := afterDash == "word:" ||
			strings.HasPrefix(afterDash, "word: ") ||
			strings.HasPrefix(afterDash, "word:\t")
		if isWordKey && !strings.HasPrefix(afterDash, "words:") {
			wordLineIdx = k
			wordIndent = l[:countLeadingSpaces(l)]
		}
	}
	if hasTypeWord && wordLineIdx >= 0 {
		old := lines[wordLineIdx]
		// 替换 "word" 为 "words" 仅在 key 部分
		colon := strings.Index(old, ":")
		if colon > 0 {
			lines[wordLineIdx] = wordIndent + "words" + old[colon:]
			*fixes = append(*fixes, "rename matcher field word → words")
		}
	}
}

// =============== 跨文件 dedup ===============

// dedupTemplateIds 扫所有路径的 ^id: 字段, 同 id 的文件只让首个保留, 后续 rename id 字段.
//   - rename 后用 id-2, id-3 ... 直到找到 maxDedupSuffix 内还没被占用的
//   - dryRun 时只汇报, 不写盘
//   - 备份策略与单文件 fix 一致 (走 opts.Backup)
func dedupTemplateIds(paths []string, opts AutoFixOptions) ([]DedupRename, error) {
	type fileWithId struct {
		path string
		id   string
	}
	// 先扫一遍把 id 提出来. 不解析整 yaml, 只读首个 ^id: 行 (大文件性能).
	ids := make(map[string][]int) // id -> indices in files
	files := make([]fileWithId, 0, len(paths))
	for _, p := range paths {
		raw, err := os.ReadFile(p)
		if err != nil {
			files = append(files, fileWithId{path: p, id: ""})
			continue
		}
		id := extractTopLevelId(string(raw))
		files = append(files, fileWithId{path: p, id: id})
		if id != "" {
			ids[id] = append(ids[id], len(files)-1)
		}
	}

	// 用过的 id 集合 (含未冲突的): 给重命名时撞名查重用
	used := make(map[string]bool)
	for id := range ids {
		used[id] = true
	}

	var renames []DedupRename
	for _, indices := range ids {
		if len(indices) <= 1 {
			continue
		}
		// 第 0 个保留, 后面的换名
		for _, idx := range indices[1:] {
			old := files[idx].id
			newId := ""
			for s := 2; s <= maxDedupSuffix; s++ {
				cand := fmt.Sprintf("%s-%d", old, s)
				if !used[cand] {
					newId = cand
					break
				}
			}
			if newId == "" {
				continue // 极端情况: 同 id 999+ 个, 跳过
			}
			used[newId] = true
			renames = append(renames, DedupRename{Path: files[idx].path, OldId: old, NewId: newId})
			if opts.DryRun {
				continue
			}
			// 实际写盘: 读、改首行 id:、写
			rawBytes, err := os.ReadFile(files[idx].path)
			if err != nil {
				continue
			}
			content := replaceTopLevelId(string(rawBytes), newId)
			if content == string(rawBytes) {
				continue
			}
			if opts.Backup {
				bak := fmt.Sprintf("%s.bak.%d", files[idx].path, time.Now().Unix())
				_ = os.WriteFile(bak, rawBytes, 0o644)
			}
			_ = os.WriteFile(files[idx].path, []byte(content), 0o644)
		}
	}
	// renames 排序方便前端展示
	sort.Slice(renames, func(i, j int) bool { return renames[i].Path < renames[j].Path })
	return renames, nil
}

// extractTopLevelId 从 yaml 文本里抽出 `id:` 顶层值, 不存在返回 "".
// 比 yaml.Unmarshal 快很多, 适合扫几万个文件.
func extractTopLevelId(content string) string {
	// 只看头部 4KB, 防大文件
	head := content
	if len(head) > 4096 {
		head = head[:4096]
	}
	for _, l := range strings.Split(head, "\n") {
		if !strings.HasPrefix(l, "id:") {
			continue
		}
		val := strings.TrimSpace(strings.TrimPrefix(l, "id:"))
		if hashIdx := indexOfUnquotedHash(val); hashIdx >= 0 {
			val = strings.TrimSpace(val[:hashIdx])
		}
		if (strings.HasPrefix(val, `"`) && strings.HasSuffix(val, `"`)) ||
			(strings.HasPrefix(val, `'`) && strings.HasSuffix(val, `'`)) {
			val = val[1 : len(val)-1]
		}
		return val
	}
	return ""
}

// replaceTopLevelId 把 yaml 的首个顶层 `id:` 行的值替换成 newId. 找不到原行返回原文.
func replaceTopLevelId(content, newId string) string {
	lines := strings.Split(content, "\n")
	for i, l := range lines {
		if !strings.HasPrefix(l, "id:") {
			continue
		}
		// 保留行尾注释 (rare)
		var trail string
		body := strings.TrimPrefix(l, "id:")
		if hashIdx := indexOfUnquotedHash(body); hashIdx >= 0 {
			trail = body[hashIdx:]
		}
		// 保留可能的引号风格
		val := strings.TrimSpace(body)
		if hashIdx := indexOfUnquotedHash(val); hashIdx >= 0 {
			val = strings.TrimSpace(val[:hashIdx])
		}
		quote := ""
		if (strings.HasPrefix(val, `"`) && strings.HasSuffix(val, `"`)) ||
			(strings.HasPrefix(val, `'`) && strings.HasSuffix(val, `'`)) {
			quote = string(val[0])
		}
		newLine := "id: " + quote + newId + quote
		if trail != "" {
			newLine += "  " + trail
		}
		lines[i] = newLine
		break
	}
	return strings.Join(lines, "\n")
}

// =============== 行级辅助 ===============

// scanInfoBlock 找 ^info: 行, 返回:
//   - start: info 行的下标 (-1 表示没找到)
//   - end: info 块的 exclusive 结束下标 (下一个顶层键或 EOF)
//   - childIndent: 子级缩进 (如 "  ", "\t" 等; 空字符串表示没子级)
func scanInfoBlock(lines []string) (int, int, string) {
	start := -1
	for i, l := range lines {
		if l == "info:" || strings.HasPrefix(l, "info:") && !strings.HasPrefix(l, " ") && !strings.HasPrefix(l, "\t") {
			// 严格顶层 (无前导空白)
			if i == 0 || !strings.HasPrefix(l, " ") && !strings.HasPrefix(l, "\t") {
				if l == "info:" || strings.HasPrefix(l, "info: ") {
					if l == "info:" {
						start = i
						break
					}
				}
			}
		}
		if l == "info:" {
			start = i
			break
		}
	}
	if start < 0 {
		return -1, -1, ""
	}
	// 探测子级缩进: 首个 indented 非空行
	childIndent := ""
	for j := start + 1; j < len(lines); j++ {
		ll := lines[j]
		if ll == "" {
			continue
		}
		ind := countLeadingSpaces(ll)
		if ind == 0 {
			break
		}
		childIndent = ll[:ind]
		break
	}
	if childIndent == "" {
		// 空 info: 块
		return start, start + 1, ""
	}
	// 找 end: 第一个 leading 0 (新顶层键) 或 EOF
	end := len(lines)
	for j := start + 1; j < len(lines); j++ {
		ll := lines[j]
		if ll == "" {
			continue
		}
		if countLeadingSpaces(ll) == 0 {
			end = j
			break
		}
	}
	return start, end, childIndent
}

// findKeyLineInBlock 在 [start, end) 内找首个 `^{indent}{key}:` 行.
// 返回 (lineIdx, blockEnd) — blockEnd 是该 key 的 value 块 exclusive 结束位置 (含子行).
// 找不到返回 (-1, -1).
func findKeyLineInBlock(lines []string, start, end int, indent, key string) (int, int) {
	for i := start; i < end; i++ {
		if isKeyLine(lines[i], indent, key) {
			return i, blockEndOfKey(lines, i, end, indent)
		}
	}
	return -1, -1
}

// blockEndOfKey 计算从 keyLineIdx 开始的键的值块 exclusive 结束位置.
// YAML 允许两种列表写法:
//
//	key:
//	  - item          # 缩进 > key (常规)
//	key:
//	- item            # 缩进 == key (仍属 key 的值! 真实 nuclei 模板大量出现)
//
// 原来只用 `leading > len(keyIndent)` 判断会把第二种的列表项误判为块外,
// 导致 severity 插入位置错 / metadata 移动范围截断, 最终生成的 YAML 语法坏掉.
func blockEndOfKey(lines []string, keyLineIdx, scanEnd int, keyIndent string) int {
	be := keyLineIdx + 1
	for be < scanEnd {
		ll := lines[be]
		if ll == "" {
			be++
			continue
		}
		leading := countLeadingSpaces(ll)
		if leading > len(keyIndent) {
			be++
			continue
		}
		if leading == len(keyIndent) {
			trim := strings.TrimLeft(ll, " \t")
			if strings.HasPrefix(trim, "- ") || trim == "-" {
				be++
				continue
			}
		}
		break
	}
	return be
}

// isKeyLine 判断 line 是否就是 `{indent}{key}:` 开头, 且 indent + key 后紧跟 ":" (不是子串).
func isKeyLine(line, indent, key string) bool {
	if !strings.HasPrefix(line, indent+key) {
		return false
	}
	rest := line[len(indent)+len(key):]
	return strings.HasPrefix(rest, ":") || rest == ""
}

func countLeadingSpaces(s string) int {
	n := 0
	for i := 0; i < len(s); i++ {
		if s[i] == ' ' {
			n++
		} else {
			break
		}
	}
	return n
}

func insertLine(lines []string, at int, line string) []string {
	out := make([]string, 0, len(lines)+1)
	out = append(out, lines[:at]...)
	out = append(out, line)
	out = append(out, lines[at:]...)
	return out
}

func insertLines(lines []string, at int, extra []string) []string {
	if len(extra) == 0 {
		return lines
	}
	out := make([]string, 0, len(lines)+len(extra))
	out = append(out, lines[:at]...)
	out = append(out, extra...)
	out = append(out, lines[at:]...)
	return out
}
