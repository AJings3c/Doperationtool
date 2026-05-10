package main

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// 加载目录时的安全上限, 防止用户误选 home 目录 / 整盘扫描卡死 UI.
// 100000 足以覆盖常见的大型 nuclei poc 仓库 (templates 纯官方 ~9000, 社区合集可达 30000+).
// 一旦到顶, 返回结果中 Truncated=true, 前端会 toast 警告.
const maxLoadFiles = 100000

// 递归扫描时跳过的常见 "大目录", 几乎肯定不放业务 yaml.
var skipDirNames = map[string]struct{}{
	"node_modules": {}, ".git": {}, ".svn": {}, ".hg": {},
	"build": {}, "dist": {}, "out": {}, "target": {},
	"vendor": {}, "__pycache__": {}, ".venv": {}, "venv": {},
	".idea": {}, ".vscode": {}, ".cache": {},
}

// App struct
//
// taskMu / taskCancel / taskName: 当前正在跑的长任务 (dedup / autofix / classify /
// validate) 的 cancel 句柄. 用户点"取消"按钮时前端会调 CancelCurrentTask 触发它.
// 单任务约束: 一个 App 实例同时只跑一个长任务 (前端按钮也设 disabled). 如果调
// beginTask 时已有任务在跑, 旧任务会被先 cancel.
type App struct {
	ctx context.Context

	taskMu     sync.Mutex
	taskCancel context.CancelFunc
	taskName   string // 当前任务的事件名, e.g. "dedup:progress"
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved so we can call the runtime methods.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// beginTask 给长任务函数顶部用. 返回:
//   - 一个可取消的子 ctx (派生自 a.ctx, 用户取消或函数 finish 时被 cancel)
//   - 一个 progressEmitter, 已经绑到该子 ctx, emit 时仍能正常推到 wails 事件总线
//   - cleanup func, 函数 defer 它就行: 释放 cancel 资源 + 清掉 a 上的注册
//
// 用法:
//
//	ctx, pe, cleanup := a.beginTask("dedup:progress", "scanning", 0)
//	defer cleanup()
//	defer pe.finish("扫描完成")  // finish 内部会自动看 ctx 状态打 Cancelled 标记
//	// ... loop, 每轮检查 ctx.Err() != nil 主动跳出
func (a *App) beginTask(event, phase string, total int) (context.Context, *progressEmitter, func()) {
	parent := a.ctx
	if parent == nil {
		parent = context.Background() // 单测兜底
	}
	ctx, cancel := context.WithCancel(parent)

	a.taskMu.Lock()
	// 把上一个未结束的任务先 cancel (防御: 不该发生, 因为前端只允许同时跑一个)
	if a.taskCancel != nil {
		a.taskCancel()
	}
	a.taskCancel = cancel
	a.taskName = event
	a.taskMu.Unlock()

	pe := newProgressEmitter(ctx, event, phase, total)
	cleanup := func() {
		a.taskMu.Lock()
		// 只清 "我注册时这个 cancel" 的位置, 避免把后来的任务注册抹掉.
		if a.taskName == event && a.taskCancel != nil {
			a.taskName = ""
			a.taskCancel = nil
		}
		a.taskMu.Unlock()
		cancel()
	}
	return ctx, pe, cleanup
}

// CancelCurrentTask 用户在前端点"取消"时调用. 触发当前 beginTask 注册的 cancel,
// 长任务的循环会通过 ctx.Err() != nil 检测到并尽快返回. 没有任务在跑时报错.
//
// 返回当前被取消任务的事件名 (前端可用来弹 toast "已取消 dedup 扫描" 等).
func (a *App) CancelCurrentTask() (string, error) {
	a.taskMu.Lock()
	defer a.taskMu.Unlock()
	if a.taskCancel == nil {
		return "", fmt.Errorf("当前没有正在运行的任务")
	}
	name := a.taskName
	a.taskCancel()
	// 不立即清空 taskName/taskCancel: 让长任务的 cleanup func 在 defer 时统一清,
	// 避免这里清完后长任务还没退出, 又有新任务起来用同名 event.
	return name, nil
}

// ExtractBaseNames 把多行 (路径/URI/文件名) 文本统一抽取出文件名 (basename), 一行一个, 保留原顺序.
// 主要作为后端备用接口; 当前前端通过浏览器原生 ClipboardEvent.files API 直接拿到文件名,
// 这里仅在前端无法解析剪贴板内容、退化到纯文本时才有用. 也方便未来扩展更多辅助小工具.
func (a *App) ExtractBaseNames(input string) []string {
	out := make([]string, 0)
	input = strings.ReplaceAll(input, "\r\n", "\n")
	for _, line := range strings.Split(input, "\n") {
		s := strings.TrimSpace(line)
		if s == "" {
			continue
		}
		// 处理 file:// URI (TrimPrefix 在前缀不存在时返回原串)
		s = strings.TrimPrefix(s, "file://")
		// 去掉末尾分隔符 (目录路径)
		s = strings.TrimRight(s, "/\\")
		out = append(out, filepath.Base(s))
	}
	return out
}

// ============================================================
// YAML 转换模块 - 文件读写 / 目录浏览 / 原生选择对话框
// 仅在桌面端 (Wails) 可用; 浏览器调试模式下文件对话框会拿不到结果.
// ============================================================

// YamlFile 是一个轻量的文件描述, 同时承担 "在内存里的修改副本" 的角色.
// Path 仅用于源面板 (从磁盘读出来时记录原始绝对路径); 缓冲区面板可以让其为空.
type YamlFile struct {
	Name    string `json:"name"`    // 当前文件名 (可被用户修改)
	Path    string `json:"path"`    // 源磁盘绝对路径 (缓冲区/目标场景可以为空)
	Content string `json:"content"` // 文件内容
	// RelPath 是相对所选根目录的相对路径 (含子目录), 例如 "sub/a.yaml".
	// 单文件场景下等于 Name. 前端用它构建文件树.
	RelPath string `json:"relPath"`
}

// SelectFile 弹出系统原生 "打开文件" 对话框, 默认筛选 yaml 类型, 同时允许 "全部文件".
// 返回选中文件的绝对路径; 用户取消时返回 ("", nil).
func (a *App) SelectFile() (string, error) {
	return wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "选择 YAML 文件",
		Filters: []wruntime.FileFilter{
			{DisplayName: "YAML (*.yaml;*.yml)", Pattern: "*.yaml;*.yml"},
			{DisplayName: "全部文件 (*.*)", Pattern: "*.*"},
		},
	})
}

// SelectDirectory 弹出系统原生 "选择文件夹" 对话框, 用户取消时返回 ("", nil).
func (a *App) SelectDirectory() (string, error) {
	return wruntime.OpenDirectoryDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "选择目录",
	})
}

// LoadFile 读取单个文件并打包成 YamlFile.
func (a *App) LoadFile(path string) (YamlFile, error) {
	if path == "" {
		return YamlFile{}, fmt.Errorf("路径为空")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return YamlFile{}, err
	}
	name := filepath.Base(path)
	return YamlFile{
		Name:    name,
		Path:    path,
		RelPath: name, // 单文件场景下与 Name 相同
		Content: string(data),
	}, nil
}

// LoadDirectoryResult 是 LoadDirectory 的返回结果, 除了文件列表还携带重要的元数据:
//   - Truncated: 是否因达到 maxLoadFiles 上限被中途截断 (重要!否则用户会错以为扫完了)
//   - Limit:     当前限额, 供前端 toast 提示用
type LoadDirectoryResult struct {
	Files     []YamlFile `json:"files"`
	Truncated bool       `json:"truncated"`
	Limit     int        `json:"limit"`
}

// LoadDirectory 递归列出目录下所有 yaml 文件 (默认), 当 includeAll=true 时不做扩展名过滤.
// 跳过:
//   - 隐藏文件 / 隐藏目录 (以 . 开头)
//   - 常见的大目录 (node_modules / .git / build / vendor 等, 见 skipDirNames)
//
// 总文件数达到 maxLoadFiles 时停止扫描, 返回 Truncated=true 让前端提示用户.
// 结果按 RelPath 排序, 这样前端构建文件树时同目录下文件有稳定顺序.
// LoadMarkdownDirectory 是 LoadDirectory 的 .md 专用版.
// POC 转换流程只关心 markdown 文件; 之前用 LoadDirectory(folder, true) 是图省事,
// 但当用户的目录包含大量 png/jpg 图片 (例如 wiki 仓库的 images/ 子目录) 时, 后端会把
// 几百 MB 的二进制全读进内存再 JSON 化经 wails IPC 桥过去, 导致内存暴涨, encoding/json
// 处理非 UTF-8 字节出错, 桥传输超时, 前端拿到空结果.
//
// 这里在 walk 阶段就按扩展名过滤, 只读 .md/.markdown 的内容; 同时跳掉 README /
// LICENSE / CHANGELOG 等项目元数据 md (跟 PoC 无关, 还可能很大, 例如 Awesome-POC
// 的 README 68KB), 避免把噪音和占位结果带进来.
func (a *App) LoadMarkdownDirectory(folder string) (*LoadDirectoryResult, error) {
	return loadDirectoryByExt(folder,
		map[string]struct{}{".md": {}, ".markdown": {}},
		isProjectMetaMd)
}

func (a *App) LoadDirectory(folder string, includeAll bool) (*LoadDirectoryResult, error) {
	if includeAll {
		return loadDirectoryByExt(folder, nil, nil) // nil = 不过滤
	}
	return loadDirectoryByExt(folder, map[string]struct{}{".yaml": {}, ".yml": {}}, nil)
}

// 项目元数据风格的 markdown 文件名 (大小写不敏感). 它们不是漏洞 PoC,
// 加进来会污染 POC 转换结果列表 (而且常常因为没 ## poc 块, 全转成同一个占位 yaml).
// 列表来自 GitHub 标准社区文件惯例 + 常见中文仓库的命名.
var skipMdBaseNames = map[string]struct{}{
	"readme":                {},
	"license":               {},
	"contributing":          {},
	"changelog":             {},
	"changes":               {},
	"code_of_conduct":       {},
	"codeofconduct":         {},
	"issue_template":        {},
	"pull_request_template": {},
	"security":              {},
	"support":               {},
	"authors":               {},
	"maintainers":           {},
	"todo":                  {},
}

// isProjectMetaMd: 文件名 (含扩展) 看上去像 README/LICENSE 这种项目元数据.
// 接受 README.md / readme / readme.markdown 等变体; 不区分大小写.
func isProjectMetaMd(name string) bool {
	lower := strings.ToLower(name)
	base := strings.TrimSuffix(strings.TrimSuffix(lower, ".markdown"), ".md")
	_, ok := skipMdBaseNames[base]
	return ok
}

// loadDirectoryByExt 是 LoadDirectory / LoadMarkdownDirectory 的共享内核.
// allowedExt 为 nil 表示不过滤 (任何扩展名都算); 否则只读 map 中扩展名匹配的文件.
//
// 实现走两段:
//  1. 顺序 walk 仅收集元数据 (path/name/relPath), 不读文件内容. 这一段是 IO bound
//     但每条只 stat 一次, 很快.
//  2. 工作池并行 ReadFile. POC 大目录 (上千个 md 文件) 这步占大头, 多核能压时间.
//
// 关键点: 扩展名过滤要在 walk 阶段就做, 不能等读完再丢, 否则 png/jpg 大文件白白
// 读进内存撑爆 wails IPC 桥. allowedExt 的 key 必须是小写带点 (e.g. ".md").
//
// extraSkip 是扩展名过滤之后再走一道的 (name → 是否跳过) 函数. 为 nil 则不跳.
// LoadMarkdownDirectory 用它跳掉 README/LICENSE/CHANGELOG 等项目元数据 md.
func loadDirectoryByExt(folder string, allowedExt map[string]struct{}, extraSkip func(name string) bool) (*LoadDirectoryResult, error) {
	if folder == "" {
		return nil, fmt.Errorf("路径为空")
	}
	info, err := os.Stat(folder)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("不是目录: %s", folder)
	}

	// 第一阶段: walk 收集 candidates, 此时不 ReadFile.
	type candidate struct{ path, name, rel string }
	candidates := make([]candidate, 0, 256)
	truncated := false
	walkErr := filepath.WalkDir(folder, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if path == folder {
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
		if allowedExt != nil {
			ext := strings.ToLower(filepath.Ext(name))
			if _, ok := allowedExt[ext]; !ok {
				return nil
			}
		}
		if extraSkip != nil && extraSkip(name) {
			return nil
		}
		if len(candidates) >= maxLoadFiles {
			truncated = true
			return filepath.SkipAll
		}
		rel, relErr := filepath.Rel(folder, path)
		if relErr != nil {
			rel = name
		}
		candidates = append(candidates, candidate{path: path, name: name, rel: rel})
		return nil
	})
	if walkErr != nil {
		return nil, walkErr
	}

	// 第二阶段: 工作池并行 ReadFile. 用 GOMAXPROCS, 上限 16 (再多对 IO 也没意义).
	out := make([]YamlFile, len(candidates))
	workers := runtime.GOMAXPROCS(0)
	if workers < 2 {
		workers = 2
	}
	if workers > 16 {
		workers = 16
	}
	if len(candidates) < workers {
		workers = len(candidates)
	}

	if workers > 0 {
		jobs := make(chan int, workers*2)
		var wg sync.WaitGroup
		for w := 0; w < workers; w++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for i := range jobs {
					c := candidates[i]
					data, readErr := os.ReadFile(c.path)
					if readErr != nil {
						// 单文件读失败用占位内容, 不阻塞整个加载.
						out[i] = YamlFile{
							Name:    c.name,
							Path:    c.path,
							RelPath: c.rel,
							Content: fmt.Sprintf("// 读取失败: %v", readErr),
						}
						continue
					}
					out[i] = YamlFile{
						Name:    c.name,
						Path:    c.path,
						RelPath: c.rel,
						Content: string(data),
					}
				}
			}()
		}
		for i := range candidates {
			jobs <- i
		}
		close(jobs)
		wg.Wait()
	}

	// 按 RelPath 排序: 同目录下文件相邻, 子目录排在父目录文件之后.
	sort.Slice(out, func(i, j int) bool { return out[i].RelPath < out[j].RelPath })
	return &LoadDirectoryResult{
		Files:     out,
		Truncated: truncated,
		Limit:     maxLoadFiles,
	}, nil
}

// DeletePath 删除单个文件或递归删除一个目录. 给前端"右键 → 删除"用.
//
// 安全考虑:
//   - 拒绝空路径 / 不存在的路径 (os.Stat 失败直接抛)
//   - 拒绝过短路径 (<= 1 字符), 防误删根目录
//   - 不做"必须在某根之下"的边界检查: 调用方传的本来就是从我们 LoadXxx 拿到的绝对路径
//   - 不做回收站, 直接物理删. 调用方应当先弹确认
//
// 删除目录走 RemoveAll, 文件走 Remove. 两者错误信息透传, 方便前端 toast 显示.
func (a *App) DeletePath(path string) error {
	if path == "" {
		return fmt.Errorf("路径为空")
	}
	clean := filepath.Clean(path)
	if len(clean) <= 1 {
		// 防 "/" / "." / "C:" 这种顶层
		return fmt.Errorf("路径过短, 拒绝删除: %s", clean)
	}
	info, err := os.Stat(clean)
	if err != nil {
		return fmt.Errorf("路径不存在或无法访问: %v", err)
	}
	if info.IsDir() {
		return os.RemoveAll(clean)
	}
	return os.Remove(clean)
}

// RevealInFileManager 在系统文件管理器中显示指定路径.
//   - macOS: 文件用 `open -R` (打开 Finder 父目录并选中); 目录用 `open` 直接进去
//   - Linux: xdg-open 父目录 (xdg 不支持选中文件); 目录直接 xdg-open
//   - Windows: 文件 explorer /select,<path>; 目录 explorer <path>
//
// 用 cmd.Start() 不阻塞: 文件管理器是用户态长生命周期进程, Wait 没意义还会卡 IPC.
func (a *App) RevealInFileManager(path string) error {
	if path == "" {
		return fmt.Errorf("路径为空")
	}
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("路径不存在: %v", err)
	}
	cmd, err := buildRevealCmd(path, info.IsDir())
	if err != nil {
		return err
	}
	return cmd.Start()
}

// OpenWithDefaultApp 用系统默认应用打开 (file:// 协议关联).
// .md 一般会用用户配的 Markdown 编辑器 (Typora / VS Code / Obsidian) 打开,
// 比内嵌的 textarea 编辑器舒服, 适合"我要在外部 IDE 改一改再回来转换"的场景.
//
// 目录走这个 API 在三大平台行为都退化成 "在文件管理器打开", 跟 RevealInFileManager
// 的目录分支等价; 所以前端目录右键不会暴露这一项.
func (a *App) OpenWithDefaultApp(path string) error {
	if path == "" {
		return fmt.Errorf("路径为空")
	}
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("路径不存在: %v", err)
	}
	cmd, err := buildOpenCmd(path)
	if err != nil {
		return err
	}
	return cmd.Start()
}

// 命令构造抽出来, 方便单元测试 + 跨平台分支看清.
func buildRevealCmd(path string, isDir bool) (*exec.Cmd, error) {
	switch runtime.GOOS {
	case "darwin":
		if isDir {
			return exec.Command("open", path), nil
		}
		return exec.Command("open", "-R", path), nil
	case "linux":
		// xdg-open 不能"选中文件", 退化成打开父目录
		target := path
		if !isDir {
			target = filepath.Dir(path)
		}
		return exec.Command("xdg-open", target), nil
	case "windows":
		if isDir {
			return exec.Command("explorer", path), nil
		}
		// /select, 后面紧跟路径, 不能有空格 (Win 历史包袱)
		return exec.Command("explorer", "/select,"+path), nil
	default:
		return nil, fmt.Errorf("不支持的平台: %s", runtime.GOOS)
	}
}

func buildOpenCmd(path string) (*exec.Cmd, error) {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", path), nil
	case "linux":
		return exec.Command("xdg-open", path), nil
	case "windows":
		// `start` 是 cmd 内置, 必须经 cmd /c 调; 第二参数空字符串作 title 占位,
		// 否则 start 会把首个带引号的参数当窗口 title 吃掉.
		return exec.Command("cmd", "/c", "start", "", path), nil
	default:
		return nil, fmt.Errorf("不支持的平台: %s", runtime.GOOS)
	}
}

// SaveSourceFile 把源面板中已编辑的文件写回磁盘.
//   - oldPath : 当前在磁盘上的绝对路径 (用于定位/重命名)
//   - newName : 用户在 UI 中改后的文件名 (仅文件名, 不含目录)
//   - content : 文件最新内容
//
// 当 newName 与 oldPath 的 basename 不一致时, 会在同目录下重命名 (旧文件删除、新文件写入).
// 返回新的绝对路径.
func (a *App) SaveSourceFile(oldPath, newName, content string) (string, error) {
	if oldPath == "" {
		return "", fmt.Errorf("原路径为空")
	}
	if newName == "" {
		return "", fmt.Errorf("文件名不能为空")
	}
	if strings.ContainsAny(newName, `/\`) {
		return "", fmt.Errorf("文件名不能包含路径分隔符: %s", newName)
	}

	dir := filepath.Dir(oldPath)
	newPath := filepath.Join(dir, newName)

	// 先按新路径写入, 再按需删除旧路径; 避免中途失败导致用户两边都没有.
	if err := os.WriteFile(newPath, []byte(content), 0o644); err != nil {
		return "", err
	}
	if newPath != oldPath {
		if err := os.Remove(oldPath); err != nil {
			// 不致命: 新文件已经写好, 旧文件残留, 提示出去由用户决定.
			return newPath, fmt.Errorf("新文件已写入, 但旧文件删除失败: %v", err)
		}
	}
	return newPath, nil
}

// SendBufferToFolder 把缓冲区当前的所有文件 (用其当前文件名) 写入目标目录.
// 返回成功写入的文件数; 任意一个失败都立即返回错误并附带已写入计数, 方便前端提示.
// 已存在的同名文件会被覆盖 (符合"派发"场景的语义).
func (a *App) SendBufferToFolder(targetDir string, files []YamlFile) (int, error) {
	if targetDir == "" {
		return 0, fmt.Errorf("目标目录为空")
	}
	info, err := os.Stat(targetDir)
	if err != nil {
		return 0, fmt.Errorf("目标目录不可用: %v", err)
	}
	if !info.IsDir() {
		return 0, fmt.Errorf("目标路径不是目录: %s", targetDir)
	}

	written := 0
	for i, f := range files {
		name := strings.TrimSpace(f.Name)
		if name == "" {
			return written, fmt.Errorf("第 %d 个文件的文件名为空", i+1)
		}
		if strings.ContainsAny(name, `/\`) {
			return written, fmt.Errorf("第 %d 个文件名含路径分隔符: %s", i+1, name)
		}
		dest := filepath.Join(targetDir, name)
		if err := os.WriteFile(dest, []byte(f.Content), 0o644); err != nil {
			return written, fmt.Errorf("写入 %s 失败: %v", name, err)
		}
		written++
	}
	return written, nil
}
