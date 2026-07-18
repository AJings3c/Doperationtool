import {
    DeletePath,
    LoadDirectory,
    LoadFile,
    SaveSourceFile,
    SelectDirectory,
    SelectFile,
    SendBufferToFolder,
} from '../../../wailsjs/go/main/App.js';
import { copyToClipboard, openWithDefault, revealOnDisk, showContextMenu, toast } from '../../core/feedback.js';
import { escapeHtml, joinPath } from '../../core/format.js';
import { panelState, setPanelCollapsed } from './panelState.js';

// ============================================================
// 模块 2: YAML 转换 (三栏: 源 / 缓冲区 / 目标)
// ============================================================

/**
 * 跨页持久化的状态.
 * source.files: { name, originalName, path, relPath, content, originalContent, dirty, category, extractedId, severity }
 * source.collapsedDirs: Set<string>  当前折叠的子目录 (相对于 source.folder)
 * source.collapsedCats: Set<string>  按类归纳视图里折叠的分类 (含特殊键 "__pending__")
 * source.viewMode: 'tree' | 'category'  源列表展示模式
 * source.searchQuery: string         源列表的搜索过滤词 (空表示不过滤)
 * buffer.files: { name, content }    // 纯内存副本, 与磁盘无关
 */
const yamlState = {
    source: {
        folder: '', files: [], activeIdx: -1,
        collapsedDirs: new Set(),
        collapsedCats: new Set(),
        viewMode: 'tree',
        searchQuery: '',
        nucleiOnly: true,    // 默认只看 nuclei poc, 点上面 toggle 可取消
        selected: new Set(), // 已勾选的源文件 idx (用于 "从源同步" 时只搬这些)
    },
    buffer: { files: [], activeIdx: -1 },
    target: { folder: '' },
};

// ============ YAML 元信息提取 ============
// 一次性扫一遍 yaml 文件文本, 同时提取:
//   - id          : 文件唯一 id (nuclei poc 必有)
//   - severity    : critical / high / medium / low / info (nuclei poc 的 info.severity)
//   - category    : 用于 "按类归纳" 视图的分组键
// category 多策略, 第一个命中就用:
//   1) id 是 CVE-YYYY-NNNN   → "CVE-YYYY"
//   2) id 首段 (按 - / _ 切) → 常用作 vendor/product, 比如 apache / jboss / weblogic
//   3) tags 第一项           → 常见分类 rce / sqli / xss / lfi
//   4) 文件名首段            → 退化方案
//   5) 都不成功              → null, 调用方把它归入 "待处理"
function extractYamlMeta(content, name) {
    const safeContent = content || '';
    const idMatch = safeContent.match(/^[ \t]*id[ \t]*:[ \t]*["']?([^"'\r\n#]+)/m);
    const rawId = idMatch ? idMatch[1].trim() : '';

    const sevMatch = safeContent.match(/^[ \t]*severity[ \t]*:[ \t]*["']?(critical|high|medium|low|info)\b/im);
    const severity = sevMatch ? sevMatch[1].toLowerCase() : '';

    const tagsMatch = safeContent.match(/^[ \t]*tags[ \t]*:[ \t]*["']?([^"'\r\n#]+)/m);

    // 是不是 nuclei poc:
    //   1) 顶层有 id: 字段 (不缩进)
    //   2) 顶层有 info: 块 (不缩进, 后面不跟值 → 是个块)
    //   3) 有至少一个顶层 模板类型块 (http/requests/network/dns/file/headless/tcp/ssl/code/javascript/workflows)
    // 三个条件都满足才算 nuclei poc.
    const hasTopLevelId = /^id[ \t]*:/m.test(safeContent);
    const hasInfoBlock = /^info[ \t]*:[ \t]*$/m.test(safeContent);
    const hasMatcher = /^(http|requests|network|dns|file|headless|tcp|ssl|code|javascript|workflows)[ \t]*:[ \t]*$/m.test(safeContent)
        || /^(http|requests|network|dns|file|headless|tcp|ssl|code|javascript|workflows)[ \t]*:[ \t]*\[/m.test(safeContent);
    const isNuclei = hasTopLevelId && hasInfoBlock && hasMatcher;

    let category = null;
    const cveMatch = rawId.match(/^CVE[-_](\d{4})[-_]/i);
    if (cveMatch) {
        category = `CVE-${cveMatch[1]}`;
    } else if (rawId) {
        const seg = rawId.split(/[-_.]/)[0];
        if (isValidCategoryKey(seg)) category = seg.toLowerCase();
    }
    if (!category && tagsMatch) {
        const firstTag = tagsMatch[1].split(',')[0].trim();
        if (isValidCategoryKey(firstTag)) category = firstTag.toLowerCase();
    }
    if (!category) {
        const base = (name || '').replace(/\.(ya?ml)$/i, '');
        const fnSeg = base.split(/[-_.]/)[0];
        if (isValidCategoryKey(fnSeg)) category = fnSeg.toLowerCase();
    }

    return { category, id: rawId, severity, isNuclei };
}

// 判定一个候选类别键是否 "像个分类" (过短/过长/含奇怪字符都拒绝).
function isValidCategoryKey(s) {
    if (!s) return false;
    const t = s.trim();
    if (t.length < 2 || t.length > 30) return false;
    return /^[A-Za-z][A-Za-z0-9]*$/.test(t);
}

function renderYamlConverter(container) {
    container.innerHTML = `
    <div class="yaml-converter">
        <div class="yaml-tip">
            💡 <b>源目录</b>: 直接读写磁盘文件 &nbsp;·&nbsp;
            <b>缓冲区</b>: 内存中独立副本, 改动不影响磁盘 &nbsp;·&nbsp;
            <b>目标目录</b>: 把缓冲区当前所有文件写入指定目录 (同名覆盖)
        </div>
        <div class="yaml-grid">
            <!-- ===== 源 ===== -->
            <section class="yaml-panel yaml-panel-source${panelState.source ? ' collapsed' : ''}">
                <div class="panel-header">
                    <div class="panel-header-title" data-panel="source">
                        <span class="panel-header-chevron">▾</span>
                        <span>📂 源目录</span>
                    </div>
                    <div class="panel-actions">
                        <button class="btn" id="btn-src-file">打开文件</button>
                        <button class="btn" id="btn-src-folder">打开文件夹</button>
                        <button class="btn btn-primary" id="btn-src-save">保存</button>
                    </div>
                </div>
                <input type="text" class="yaml-path-input" id="src-path"
                    placeholder="输入或粘贴目录路径, 按 Enter 加载 (也可以点右侧「打开文件夹」选择)"
                    title="未选择"
                    autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
                <div class="yaml-panel-body">
                    <div class="yaml-list-pane">
                        <div class="yaml-search-bar">
                            <input class="yaml-search-input" id="src-search" type="search"
                                placeholder="🔍 搜索文件名 / id / 路径 / 类别"
                                autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
                            <button class="yaml-filter-toggle active" id="btn-nuclei-only"
                                title="仅显示 nuclei POC (同时具备 id / info / http·requests 等块才算)">
                                <span class="nuclei-dot"></span>nuclei
                            </button>
                            <span class="yaml-search-count" id="src-search-count"></span>
                        </div>
                        <div class="yaml-view-bar">
                            <div class="yaml-view-tabs">
                                <button class="yaml-view-tab active" data-view="tree">🌳 目录树</button>
                                <button class="yaml-view-tab" data-view="category">📦 按类归纳</button>
                            </div>
                            <div class="yaml-view-actions">
                                <button class="yaml-view-action" id="btn-select-visible" title="勾选当前过滤后所有可见文件">☑ 全选</button>
                                <button class="yaml-view-action" id="btn-select-clear" title="清空所有勾选">☐ 清空</button>
                                <span class="yaml-view-divider"></span>
                                <button class="yaml-view-action" id="btn-expand-all" title="全部展开">⇲</button>
                                <button class="yaml-view-action" id="btn-collapse-all" title="全部折叠">⇱</button>
                            </div>
                        </div>
                        <div class="yaml-list" id="src-list"></div>
                    </div>
                    <div class="yaml-editor-pane">
                        <input class="yaml-name" id="src-name" placeholder="文件名 (按 Enter 保存)" disabled />
                        <textarea class="yaml-content" id="src-content"
                            placeholder="选择左侧文件后即可编辑内容"
                            spellcheck="false" autocomplete="off" autocorrect="off"
                            autocapitalize="off" disabled></textarea>
                    </div>
                </div>
                <div class="panel-footer">
                    <span id="src-stat">未加载</span>
                    <span style="opacity:.7">源</span>
                </div>
            </section>

            <!-- ===== 缓冲区 ===== -->
            <section class="yaml-panel yaml-panel-buffer${panelState.buffer ? ' collapsed' : ''}">
                <div class="panel-header">
                    <div class="panel-header-title" data-panel="buffer">
                        <span class="panel-header-chevron">▾</span>
                        <span>📋 缓冲区</span>
                    </div>
                    <div class="panel-actions">
                        <button class="btn" id="btn-buf-sync">从源同步</button>
                        <button class="btn" id="btn-buf-add">新建</button>
                        <button class="btn btn-danger" id="btn-buf-remove">删除</button>
                    </div>
                </div>
                <div class="yaml-path" id="buf-path">缓冲区 · 仅在内存中, 不影响磁盘</div>
                <div class="yaml-panel-body">
                    <div class="yaml-list-pane">
                        <div class="yaml-list" id="buf-list"></div>
                    </div>
                    <div class="yaml-editor-pane">
                        <input class="yaml-name" id="buf-name" placeholder="文件名" disabled />
                        <textarea class="yaml-content" id="buf-content"
                            placeholder="点 “从源同步” 拷贝源文件, 或点 “新建” 创建一个空文件"
                            spellcheck="false" autocomplete="off" autocorrect="off"
                            autocapitalize="off" disabled></textarea>
                    </div>
                </div>
                <div class="panel-footer">
                    <span id="buf-stat">0 个文件</span>
                    <span style="opacity:.7">缓冲</span>
                </div>
            </section>

            <!-- ===== 目标 ===== -->
            <section class="yaml-panel yaml-panel-target${panelState.target ? ' collapsed' : ''}">
                <div class="panel-header">
                    <div class="panel-header-title" data-panel="target">
                        <span class="panel-header-chevron">▾</span>
                        <span>📤 目标目录</span>
                    </div>
                    <div class="panel-actions">
                        <button class="btn" id="btn-tgt-pick">选择目录</button>
                        <button class="btn btn-primary" id="btn-tgt-send">发送</button>
                    </div>
                </div>
                <div class="yaml-path" id="tgt-path" title="未选择">未选择</div>
                <div class="yaml-target-summary" id="tgt-summary">
                    <div class="yaml-empty">缓冲区为空</div>
                </div>
                <div class="panel-footer">
                    <span id="tgt-stat">就绪</span>
                    <span style="opacity:.7">目标</span>
                </div>
            </section>
        </div>
    </div>`;
    setupYamlConverter();
}

function setupYamlConverter() {
    // ---- 引用 ----
    const elSrcPath    = document.getElementById('src-path');
    const elSrcList    = document.getElementById('src-list');
    const elSrcName    = document.getElementById('src-name');
    const elSrcContent = document.getElementById('src-content');
    const elSrcStat    = document.getElementById('src-stat');

    const elBufPath    = document.getElementById('buf-path');
    const elBufList    = document.getElementById('buf-list');
    const elBufName    = document.getElementById('buf-name');
    const elBufContent = document.getElementById('buf-content');
    const elBufStat    = document.getElementById('buf-stat');

    const elTgtPath    = document.getElementById('tgt-path');
    const elTgtSummary = document.getElementById('tgt-summary');
    const elTgtStat    = document.getElementById('tgt-stat');

    // ---- 工具 ----
    function deepCopyForBuffer(srcFiles) {
        // 缓冲区独立, 只保留 name/content 两个字段, 与源完全解耦
        return srcFiles.map((f) => ({ name: f.name, content: f.content }));
    }

    // 根据过滤条件过滤出 items, 保留原始 idx (指向 yamlState.source.files 中的位置),
    // 以便点击后能正确定位. 过滤顺序: nuclei 开关 → 搜索词.
    function getFilteredItems() {
        const { files, searchQuery, nucleiOnly } = yamlState.source;
        let items = files.map((f, idx) => ({ idx, file: f }));
        if (nucleiOnly) {
            items = items.filter(({ file }) => file.isNuclei);
        }
        const q = (searchQuery || '').toLowerCase().trim();
        if (q) {
            items = items.filter(({ file }) =>
                (file.name || '').toLowerCase().includes(q)
                || (file.extractedId || '').toLowerCase().includes(q)
                || (file.relPath || '').toLowerCase().includes(q)
                || (file.category || '').toLowerCase().includes(q)
            );
        }
        return items;
    }

    // ---- 渲染: 源 (文件树视图) ----
    // 树结构: { dirs: Map<name, node>, files: [{idx, file}] }
    function buildSrcTree(items) {
        const root = { dirs: new Map(), files: [] };
        for (const item of items) {
            const rel = item.file.relPath || item.file.name;
            const segments = rel.split(/[\/\\]/).filter(Boolean);
            const dirSegs = segments.slice(0, -1);   // 最后一段是文件名, 不算目录
            let cur = root;
            for (const seg of dirSegs) {
                if (!cur.dirs.has(seg)) cur.dirs.set(seg, { dirs: new Map(), files: [] });
                cur = cur.dirs.get(seg);
            }
            cur.files.push(item);
        }
        return root;
    }

    // 递归算子树文件总数 (用于在文件夹标签上显示数量)
    function countTreeFiles(node) {
        let n = node.files.length;
        for (const child of node.dirs.values()) n += countTreeFiles(child);
        return n;
    }

    // 生成一个文件行的 HTML, tree 和 category 视图都复用这个, 在同一个地方控制 severity / dirty / tooltip
    function renderFileRow({ idx, file }, paddingLeft) {
        const active = idx === yamlState.source.activeIdx ? ' active' : '';
        const dirtyCls = file.dirty ? ' dirty' : '';
        const isSelected = yamlState.source.selected.has(idx);
        const selectedCls = isSelected ? ' selected' : '';
        const sev = file.severity
            ? `<span class="sev-dot sev-${file.severity}" title="severity: ${file.severity}"></span>`
            : '';
        const tipParts = [];
        if (file.path) tipParts.push(file.path);
        if (file.extractedId) tipParts.push(`id: ${file.extractedId}`);
        if (file.severity) tipParts.push(`severity: ${file.severity}`);
        const title = escapeHtml(tipParts.join('\n'));
        return `
            <div class="tree-file yaml-list-item${active}${dirtyCls}${selectedCls}"
                 data-idx="${idx}"
                 style="padding-left:${paddingLeft}px"
                 title="${title}">
                <input type="checkbox" class="file-check" data-idx="${idx}"${isSelected ? ' checked' : ''} />
                <span class="tree-file-icon">📄</span>
                ${sev}
                <span class="yaml-list-name">${escapeHtml(file.name)}</span>
                ${file.dirty ? '<span class="yaml-dot" title="未保存改动"></span>' : ''}
            </div>
        `;
    }

    // 递归渲染树节点为 HTML.
    //   depth   : 缩进层级
    //   dirPath : 当前目录从根算起的相对路径 (用于 collapsedDirs 查询)
    function renderTreeNode(node, depth, dirPath) {
        const { collapsedDirs } = yamlState.source;
        const PAD_PER_DEPTH = 14;
        let html = '';
        // 子目录按名字排序
        const dirNames = Array.from(node.dirs.keys()).sort();
        for (const dirName of dirNames) {
            const subPath = dirPath ? `${dirPath}/${dirName}` : dirName;
            const child = node.dirs.get(dirName);
            const isCollapsed = collapsedDirs.has(subPath);
            const totalCount = countTreeFiles(child);
            html += `
                <div class="tree-folder${isCollapsed ? ' collapsed' : ''}" data-dir-path="${escapeHtml(subPath)}">
                    <div class="tree-folder-header" style="padding-left:${6 + depth * PAD_PER_DEPTH}px">
                        <span class="tree-chevron">▶</span>
                        <span class="tree-folder-icon">📁</span>
                        <span class="tree-folder-name">${escapeHtml(dirName)}</span>
                        <span class="tree-folder-count">${totalCount}</span>
                    </div>
                    <div class="tree-folder-body">${renderTreeNode(child, depth + 1, subPath)}</div>
                </div>
            `;
        }
        // 当前目录下文件
        for (const item of node.files) {
            html += renderFileRow(item, 10 + depth * PAD_PER_DEPTH);
        }
        return html;
    }

    // ---- 渲染: 按类归纳 ----
    // 把传入的 items 按 file.category 分桶; category == null 的归到 "待处理".
    function groupFilesByCategory(items) {
        const groups = new Map();    // Map<categoryKey, items[]>
        const pending = [];
        for (const item of items) {
            if (item.file.category) {
                if (!groups.has(item.file.category)) groups.set(item.file.category, []);
                groups.get(item.file.category).push(item);
            } else {
                pending.push(item);
            }
        }
        return { groups, pending };
    }

    function renderCategoryFiles(items) {
        return items.map((item) => renderFileRow(item, 28)).join('');
    }

    function renderCategoryView() {
        const { collapsedCats } = yamlState.source;
        const allItems = getFilteredItems();
        const items = allItems.slice(0, 5000);
        if (items.length === 0) {
            elSrcList.innerHTML = '<div class="yaml-empty">没有匹配的文件</div>';
            return;
        }
        const limitNote = allItems.length > items.length
            ? `<div class="yaml-empty yaml-limit-note">结果过多，仅渲染前 ${items.length} / ${allItems.length} 个，请用搜索缩小范围。</div>`
            : '';
        const { groups, pending } = groupFilesByCategory(items);
        const catNames = Array.from(groups.keys()).sort();

        let html = limitNote + '<div class="yaml-categories">';
        for (const cat of catNames) {
            const catItems = groups.get(cat);
            const isCollapsed = collapsedCats.has(cat);
            html += `
                <div class="yaml-cat-group${isCollapsed ? ' collapsed' : ''}" data-cat="${escapeHtml(cat)}">
                    <div class="yaml-cat-header">
                        <span class="tree-chevron">▶</span>
                        <span class="yaml-cat-icon">📦</span>
                        <span class="yaml-cat-name">${escapeHtml(cat)}</span>
                        <span class="yaml-cat-count">${catItems.length}</span>
                    </div>
                    <div class="yaml-cat-body">${renderCategoryFiles(catItems)}</div>
                </div>
            `;
        }
        if (pending.length > 0) {
            const isCollapsed = collapsedCats.has('__pending__');
            html += `
                <div class="yaml-cat-group yaml-cat-pending${isCollapsed ? ' collapsed' : ''}" data-cat="__pending__">
                    <div class="yaml-cat-header">
                        <span class="tree-chevron">▶</span>
                        <span class="yaml-cat-icon">⚠️</span>
                        <span class="yaml-cat-name">待处理 · 未识别类别</span>
                        <span class="yaml-cat-count">${pending.length}</span>
                    </div>
                    <div class="yaml-cat-body">${renderCategoryFiles(pending)}</div>
                </div>
            `;
        }
        html += '</div>';
        elSrcList.innerHTML = html;
        // 折叠 / 文件 click+change+contextmenu 全走委托, 见 bindFileRowEvents.
        bindFileRowEvents();
    }

    // ---- 渲染: 目录树 ----
    function renderTreeView() {
        const allItems = getFilteredItems();
        const items = allItems.slice(0, 5000);
        if (items.length === 0) {
            elSrcList.innerHTML = '<div class="yaml-empty">没有匹配的文件</div>';
            return;
        }
        const tree = buildSrcTree(items);
        const limitNote = allItems.length > items.length
            ? `<div class="yaml-empty yaml-limit-note">结果过多，仅渲染前 ${items.length} / ${allItems.length} 个，请用搜索缩小范围。</div>`
            : '';
        elSrcList.innerHTML = `${limitNote}<div class="yaml-tree">${renderTreeNode(tree, 0, '')}</div>`;
        // 折叠 / 文件 click+change+contextmenu 全走委托, 见 bindFileRowEvents.
        bindFileRowEvents();
    }

    // 切换 activeIdx 时只 toggle .active 类, 不全树重画.
    // 关键修复: 大目录 (1w yaml) 时, 用户每点一次文件如果走 renderSrcList() 全画 + 重挂
    // 4w 监听器, 单次点击就卡 5+ 秒. 改为单纯 DOM 局部变更, 点击瞬时响应.
    function setActiveSrcIdx(idx) {
        const old = yamlState.source.activeIdx;
        if (old === idx) return;
        yamlState.source.activeIdx = idx;
        renderSrcEditor();
        if (old >= 0) {
            const oldRow = elSrcList.querySelector(`.tree-file[data-idx="${old}"]`);
            if (oldRow) oldRow.classList.remove('active');
        }
        if (idx >= 0) {
            const newRow = elSrcList.querySelector(`.tree-file[data-idx="${idx}"]`);
            if (newRow) newRow.classList.add('active');
        }
    }

    // 单一委托: cat-header / folder-header 折叠 + tree-file click + checkbox change
    // + tree-file/folder-header contextmenu, 全部从 elSrcList 冒泡上来分发.
    // 跟去重页同款: 1w 文件场景下把 4w 个 listener 注册压成 3 个.
    // _yamlDelegated 标志: setupYamlPage 切回时 elSrcList 是新节点, 标志不存在会重挂;
    //   同一节点上的 renderTreeView/renderCategoryView 多次重画都不会重挂.
    function bindFileRowEvents() {
        if (elSrcList._yamlDelegated) return;

        elSrcList.addEventListener('click', (e) => {
            const t = e.target;
            if (!(t instanceof HTMLElement)) return;
            // (1) 类别折叠头
            const catH = t.closest('.yaml-cat-header');
            if (catH && elSrcList.contains(catH)) {
                const group = catH.closest('.yaml-cat-group');
                if (!group) return;
                const cat = group.dataset.cat;
                if (yamlState.source.collapsedCats.has(cat)) yamlState.source.collapsedCats.delete(cat);
                else yamlState.source.collapsedCats.add(cat);
                group.classList.toggle('collapsed');
                return;
            }
            // (2) 目录折叠头
            const folderH = t.closest('.tree-folder-header');
            if (folderH && elSrcList.contains(folderH)) {
                const folder = folderH.closest('.tree-folder');
                const dirPath = folder ? folder.dataset.dirPath : '';
                if (!dirPath) return;
                if (yamlState.source.collapsedDirs.has(dirPath)) yamlState.source.collapsedDirs.delete(dirPath);
                else yamlState.source.collapsedDirs.add(dirPath);
                if (folder) folder.classList.toggle('collapsed');
                return;
            }
            // (3) 文件 checkbox: 让 native toggle 正常进行, change 由下面的委托处理
            if (t.classList && t.classList.contains('file-check')) return;
            // (4) 文件行体: 切 activeIdx (轻量, 不全画)
            const row = t.closest('.tree-file');
            if (row && elSrcList.contains(row)) {
                const idx = Number(row.dataset.idx);
                if (!Number.isNaN(idx)) setActiveSrcIdx(idx);
            }
        });

        elSrcList.addEventListener('change', (e) => {
            const cb = e.target && e.target.closest && e.target.closest('.file-check');
            if (!cb || !elSrcList.contains(cb)) return;
            const idx = Number(cb.dataset.idx);
            if (Number.isNaN(idx)) return;
            if (cb.checked) yamlState.source.selected.add(idx);
            else yamlState.source.selected.delete(idx);
            const row = cb.closest('.tree-file');
            if (row) row.classList.toggle('selected', cb.checked);
            updateSelectionUi();
        });

        elSrcList.addEventListener('contextmenu', (e) => {
            const t = e.target;
            if (!(t instanceof HTMLElement)) return;
            // 文件右键: Finder 显示 / 默认应用打开 / 复制 / 删除
            const fileRow = t.closest('.tree-file');
            if (fileRow && elSrcList.contains(fileRow)) {
                e.preventDefault();
                const idx = Number(fileRow.dataset.idx);
                const f = yamlState.source.files[idx];
                if (!f || !f.path) return;
                showContextMenu(e.clientX, e.clientY, [
                    { label: '在 Finder 中显示', onClick: () => revealOnDisk(f.path) },
                    { label: '用默认应用打开', onClick: () => openWithDefault(f.path) },
                    { separator: true },
                    { label: '复制完整路径', onClick: () => copyToClipboard(f.path, '路径') },
                    { label: '复制文件名', onClick: () => copyToClipboard(f.name, '文件名') },
                    { separator: true },
                    {
                        label: `🗑 删除文件: ${f.name}`,
                        danger: true,
                        onClick: () => deleteSrcEntry(f.path, false, f.name),
                    },
                ]);
                return;
            }
            // 目录右键: Finder 打开 / 复制 / 递归删除
            const folderH = t.closest('.tree-folder-header');
            if (folderH && elSrcList.contains(folderH)) {
                e.preventDefault();
                const folder = folderH.closest('.tree-folder');
                const dirPath = folder ? folder.dataset.dirPath : '';
                if (!dirPath || !yamlState.source.folder) return;
                const absDir = joinPath(yamlState.source.folder, dirPath);
                const count = yamlState.source.files.filter((f) =>
                    f.path && (f.path === absDir || f.path.startsWith(absDir + '/'))
                ).length;
                showContextMenu(e.clientX, e.clientY, [
                    { label: '在 Finder 中打开', onClick: () => revealOnDisk(absDir) },
                    { separator: true },
                    { label: '复制完整路径', onClick: () => copyToClipboard(absDir, '路径') },
                    { label: '复制目录名', onClick: () => copyToClipboard(dirPath, '目录名') },
                    { separator: true },
                    {
                        label: `🗑 删除目录: ${dirPath} (含 ${count} 个 yaml)`,
                        danger: true,
                        onClick: () => deleteSrcEntry(absDir, true, dirPath),
                    },
                ]);
            }
        });

        elSrcList._yamlDelegated = true;
    }

    // 从 yamlState.source.files 里剔除, 同步修正 selected / activeIdx 索引.
    // 跟 POC 源面板的 pruneMdFiles 是同一个套路, 但作用在 yamlState 上.
    function pruneSrcFiles(keepFn) {
        const newArr = [];
        const newSelected = new Set();
        let newActive = -1;
        let removed = 0;
        const oldFiles = yamlState.source.files;
        for (let i = 0; i < oldFiles.length; i++) {
            if (!keepFn(oldFiles[i])) { removed++; continue; }
            const newIdx = newArr.length;
            newArr.push(oldFiles[i]);
            if (yamlState.source.selected.has(i)) newSelected.add(newIdx);
            if (yamlState.source.activeIdx === i) newActive = newIdx;
        }
        yamlState.source.files = newArr;
        yamlState.source.selected = newSelected;
        yamlState.source.activeIdx = newActive;
        return removed;
    }

    // 删除 yaml 源文件 / 目录: 弹 confirm → DeletePath → 同步内存 → 重渲染.
    async function deleteSrcEntry(absPath, isDir, displayName) {
        const noun = isDir ? '目录' : '文件';
        if (!window.confirm(`确认删除${noun}吗?\n\n${absPath}\n\n此操作不可撤销.`)) return;
        try {
            await DeletePath(absPath);
        } catch (err) {
            toast(`删除失败: ${err}`, 'error');
            return;
        }
        const removed = pruneSrcFiles((f) => {
            if (!f.path) return true;
            if (isDir) return !(f.path === absPath || f.path.startsWith(absPath + '/'));
            return f.path !== absPath;
        });
        renderSrcAll();
        toast(`已删除${noun} ${displayName} (列表移除 ${removed} 项)`);
    }

    // 选择变化后同步 UI: 同步按钮上的 (N) 徽标, 可能还有其他地方
    function updateSelectionUi() {
        const btn = document.getElementById('btn-buf-sync');
        if (!btn) return;
        const n = yamlState.source.selected.size;
        btn.textContent = n > 0 ? `从源同步 (${n})` : '从源同步';
    }

    // 全选当前过滤后可见的文件 (nuclei + 搜索后留下的那些)
    function selectAllVisible() {
        for (const item of getFilteredItems()) {
            yamlState.source.selected.add(item.idx);
        }
        renderSrcList();
        updateSelectionUi();
    }

    // 清空所有勾选 (包括不在当前过滤中的)
    function clearSelection() {
        yamlState.source.selected.clear();
        renderSrcList();
        updateSelectionUi();
    }

    function renderSrcList() {
        const { files, viewMode, searchQuery } = yamlState.source;
        if (files.length === 0) {
            elSrcList.innerHTML = '<div class="yaml-empty">尚未打开任何文件</div>';
            updateSearchCount(0, 0);
            return;
        }
        // 搜索有值时在列表上打个 data-searching, CSS 会强制全部展开
        elSrcList.dataset.searching = searchQuery ? 'true' : 'false';
        if (viewMode === 'category') {
            renderCategoryView();
        } else {
            renderTreeView();
        }
        // 更新搜索计数
        const matched = getFilteredItems().length;
        updateSearchCount(matched, files.length);
    }

    function updateSearchCount(matched, total) {
        const el = document.getElementById('src-search-count');
        if (!el) return;
        if (yamlState.source.searchQuery) {
            el.textContent = `${matched} / ${total}`;
            el.classList.toggle('warn', matched === 0);
        } else {
            el.textContent = '';
            el.classList.remove('warn');
        }
    }

    function renderSrcEditor() {
        const { files, activeIdx } = yamlState.source;
        if (activeIdx < 0 || activeIdx >= files.length) {
            elSrcName.value = '';
            elSrcContent.value = '';
            elSrcName.disabled = true;
            elSrcContent.disabled = true;
            return;
        }
        const f = files[activeIdx];
        elSrcName.value = f.name;
        elSrcContent.value = f.content;
        elSrcName.disabled = false;
        elSrcContent.disabled = false;
    }

    function renderSrcStat() {
        const { files } = yamlState.source;
        const dirty = files.filter((f) => f.dirty).length;
        elSrcStat.textContent = `${files.length} 个文件${dirty > 0 ? ` · ${dirty} 个未保存` : ''}`;
    }

    function renderSrcAll() {
        elSrcPath.value = yamlState.source.folder || '';
        elSrcPath.title = yamlState.source.folder || '未选择';
        renderSrcList();
        renderSrcEditor();
        renderSrcStat();
    }

    // ---- 渲染: 缓冲区 ----
    function renderBufList() {
        const { files, activeIdx } = yamlState.buffer;
        if (files.length === 0) {
            elBufList.innerHTML = '<div class="yaml-empty">缓冲区为空</div>';
            return;
        }
        const shown = files.slice(0, 2000);
        const more = files.length > shown.length ? `<div class="yaml-empty yaml-limit-note">缓冲区文件过多，仅显示前 ${shown.length} / ${files.length} 个。</div>` : '';
        elBufList.innerHTML = shown.map((f, i) => `
            <div class="yaml-list-item${i === activeIdx ? ' active' : ''}" data-idx="${i}">
                <span class="yaml-list-name">${escapeHtml(f.name)}</span>
            </div>
        `).join('') + more;
        // 委托一次, 替换原来"每行单挂 listener" 写法. 缓冲区通常 < 100 行, 但路径上
        // 跟其他列表统一委托模型, 顺手把潜在的高数量场景 (用户从 1w 源同步) 也 cover 掉.
        bindBufListEvents();
    }

    // 切 buffer activeIdx 时只 toggle .active.
    function setActiveBufIdx(idx) {
        const old = yamlState.buffer.activeIdx;
        if (old === idx) return;
        yamlState.buffer.activeIdx = idx;
        renderBufEditor();
        if (old >= 0) {
            const oldRow = elBufList.querySelector(`.yaml-list-item[data-idx="${old}"]`);
            if (oldRow) oldRow.classList.remove('active');
        }
        if (idx >= 0) {
            const newRow = elBufList.querySelector(`.yaml-list-item[data-idx="${idx}"]`);
            if (newRow) newRow.classList.add('active');
        }
    }

    function bindBufListEvents() {
        if (elBufList._bufDelegated) return;
        elBufList.addEventListener('click', (e) => {
            const t = e.target;
            if (!(t instanceof HTMLElement)) return;
            const row = t.closest('.yaml-list-item');
            if (row && elBufList.contains(row)) {
                const idx = Number(row.dataset.idx);
                if (!Number.isNaN(idx)) setActiveBufIdx(idx);
            }
        });
        elBufList._bufDelegated = true;
    }

    function renderBufEditor() {
        const { files, activeIdx } = yamlState.buffer;
        if (activeIdx < 0 || activeIdx >= files.length) {
            elBufName.value = '';
            elBufContent.value = '';
            elBufName.disabled = true;
            elBufContent.disabled = true;
            return;
        }
        const f = files[activeIdx];
        elBufName.value = f.name;
        elBufContent.value = f.content;
        elBufName.disabled = false;
        elBufContent.disabled = false;
    }

    function renderBufStat() {
        elBufStat.textContent = `${yamlState.buffer.files.length} 个文件`;
    }

    function renderBufAll() {
        renderBufList();
        renderBufEditor();
        renderBufStat();
        renderTgtSummary();   // 目标面板的待发送列表跟着缓冲区走
    }

    // ---- 渲染: 目标 ----
    function renderTgtSummary() {
        const files = yamlState.buffer.files;
        elTgtPath.textContent = yamlState.target.folder || '未选择';
        elTgtPath.title = yamlState.target.folder || '未选择';
        if (files.length === 0) {
            elTgtSummary.innerHTML = '<div class="yaml-empty">缓冲区为空, 没有可发送的文件</div>';
            return;
        }
        const shown = files.slice(0, 500);
        const more = files.length > shown.length ? `<div class="yaml-target-item yaml-limit-note">… 另有 ${files.length - shown.length} 个文件未展示</div>` : '';
        elTgtSummary.innerHTML = `
            <div class="yaml-target-title">将发送 ${files.length} 个文件:</div>
            ${shown.map((f) => `<div class="yaml-target-item">📄 ${escapeHtml(f.name)}</div>`).join('')}
            ${more}
        `;
    }

    // escapeHtml 已提到模块级别 (供 POC 转换页也复用)

    // ============ 源 · 事件 ============
    document.getElementById('btn-src-file').addEventListener('click', async () => {
        try {
            const path = await SelectFile();
            if (!path) return;  // 用户取消
            const f = await LoadFile(path);
            yamlState.source.folder = path;   // 单文件场景, path 既是路径也是 "源"
            yamlState.source.files = [normalizeSrcFile(f)];
            yamlState.source.activeIdx = 0;
            yamlState.source.collapsedDirs = new Set();
            renderSrcAll();
            toast(`已打开 ${f.name}`);
        } catch (err) {
            toast(`打开失败: ${err}`, 'error');
        }
    });

    // 抽出加载逻辑, 让 dialog 选择 / 手动输入路径 / 以后可能的“最近打开” 都复用同一条路径
    async function loadSourceFolder(folder) {
        if (!folder) return;
        try {
            // 扫描中状态 (大目录可能十几秒)
            elSrcPath.value = folder;
            elSrcPath.title = folder;
            elSrcList.innerHTML = '<div class="yaml-loading">正在递归扫描目录, 请稍候…</div>';

            // 后端现在返回 { files, truncated, limit }
            const result = await LoadDirectory(folder, false);
            const files = (result && result.files) || [];
            const truncated = !!(result && result.truncated);
            const limit = (result && result.limit) || 0;

            yamlState.source.folder = folder;
            yamlState.source.files = files.map(normalizeSrcFile);
            // 加载后默认不预选 (避免预选到 nuclei 过滤掉的隐藏文件), 用户点击列表再激活
            yamlState.source.activeIdx = -1;
            yamlState.source.collapsedDirs = new Set();
            yamlState.source.collapsedCats = new Set();
            yamlState.source.searchQuery = '';
            yamlState.source.selected = new Set();   // 重加目录, 清空上一批勾选
            const searchInput = document.getElementById('src-search');
            if (searchInput) searchInput.value = '';
            renderSrcAll();
            updateSelectionUi();

            const n = files.length;
            if (n === 0) {
                toast(`该目录递归扫描后未找到 YAML 文件`, 'error');
                return;
            }
            // 达上限 → 单独一个醒目的警告 toast, 不要淹没在常规提示里
            if (truncated) {
                toast(`⚠️ 扫描设了 ${limit} 个文件上限已被触发, 可能还有未扫到的文件. 请选个更小的子目录, 或告诉我提高上限.`, 'error');
            }
            // 顺手统计 nuclei / 未分类情况
            const nucleiCount = yamlState.source.files.filter((f) => f.isNuclei).length;
            const unknown = yamlState.source.files.filter((f) => !f.category).length;
            let msg = `已加载 ${n} 个 YAML, 其中 ${nucleiCount} 个是 nuclei POC`;
            if (yamlState.source.nucleiOnly && nucleiCount < n) {
                msg += ` (其余 ${n - nucleiCount} 个被 "仅 nuclei" 过滤掉)`;
            }
            if (unknown > 0) {
                msg += `; ${unknown} 个未分类, 见"待处理"`;
            }
            toast(msg);
        } catch (err) {
            // 路径不存在 / 不是目录 / 权限不足 都会走到这里
            toast(`加载失败: ${err}`, 'error');
        }
    }

    document.getElementById('btn-src-folder').addEventListener('click', async () => {
        try {
            const folder = await SelectDirectory();
            if (!folder) return;
            await loadSourceFolder(folder);
        } catch (err) {
            toast(`选择失败: ${err}`, 'error');
        }
    });

    // 路径 input: Enter 加载, Escape 还原. Tab/blur 不触发, 避免误操作.
    elSrcPath.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const folder = elSrcPath.value.trim();
            if (!folder) return;
            await loadSourceFolder(folder);
        } else if (e.key === 'Escape') {
            elSrcPath.value = yamlState.source.folder || '';
            elSrcPath.blur();
        }
    });

    document.getElementById('btn-src-save').addEventListener('click', async () => {
        const { files, activeIdx } = yamlState.source;
        if (activeIdx < 0 || activeIdx >= files.length) {
            toast('请先选择一个文件', 'error');
            return;
        }
        const f = files[activeIdx];
        if (!f.path) {
            toast('该文件没有磁盘路径, 无法保存', 'error');
            return;
        }
        try {
            const newPath = await SaveSourceFile(f.path, f.name, f.content);
            f.path = newPath;
            f.originalName = f.name;
            f.originalContent = f.content;
            f.dirty = false;
            renderSrcAll();
            toast(`已保存: ${f.name}`);
        } catch (err) {
            toast(`保存失败: ${err}`, 'error');
        }
    });

    elSrcName.addEventListener('input', () => {
        const { files, activeIdx } = yamlState.source;
        if (activeIdx < 0) return;
        files[activeIdx].name = elSrcName.value;
        files[activeIdx].dirty = isDirty(files[activeIdx]);
        renderSrcList();
        renderSrcStat();
    });
    elSrcContent.addEventListener('input', () => {
        const { files, activeIdx } = yamlState.source;
        if (activeIdx < 0) return;
        const f = files[activeIdx];
        const wasDirty = f.dirty;
        f.content = elSrcContent.value;
        f.dirty = isDirty(f);
        // 性能: 内容输入不影响文件名, 所以只在 dirty 状态翻转时才重画列表 (更新指示点).
        // 大树 (上千个文件) 下避免每键击都 rebuild DOM, 输入手感快很多.
        if (wasDirty !== f.dirty) renderSrcList();
        renderSrcStat();
    });

    function normalizeSrcFile(f) {
        const { category, id: extractedId, severity, isNuclei } = extractYamlMeta(f.content, f.name);
        return {
            name: f.name,
            originalName: f.name,
            path: f.path,
            relPath: f.relPath || f.name,
            content: f.content,
            originalContent: f.content,
            dirty: false,
            category,
            extractedId,
            severity,
            isNuclei,
        };
    }
    function isDirty(f) {
        return f.name !== f.originalName || f.content !== f.originalContent;
    }

    // ============ 缓冲区 · 事件 ============
    document.getElementById('btn-buf-sync').addEventListener('click', () => {
        const { files, selected } = yamlState.source;
        if (files.length === 0) {
            toast('源为空, 无法同步', 'error');
            return;
        }
        if (selected.size === 0) {
            toast('请在源列表中勾选要同步的文件 (文件名前复选框), 或点 “☑ 全选”', 'error');
            return;
        }
        // 只同步已勾选的, 过滤掉越界 idx (防范偶发场景)
        const selectedFiles = Array.from(selected)
            .filter((i) => i >= 0 && i < files.length)
            .sort((a, b) => a - b)
            .map((i) => files[i]);
        yamlState.buffer.files = deepCopyForBuffer(selectedFiles);
        yamlState.buffer.activeIdx = selectedFiles.length > 0 ? 0 : -1;
        renderBufAll();
        // 同步完自动展开 buffer 面板, 让用户看到结果
        setPanelCollapsed('buffer', false);
        toast(`已同步 ${selectedFiles.length} 个勾选文件到缓冲区`);
    });

    document.getElementById('btn-buf-add').addEventListener('click', () => {
        // 自动避免重名
        const base = 'new';
        let name = `${base}.yaml`;
        let n = 1;
        const taken = new Set(yamlState.buffer.files.map((f) => f.name));
        while (taken.has(name)) { name = `${base}-${n++}.yaml`; }
        yamlState.buffer.files.push({ name, content: '' });
        yamlState.buffer.activeIdx = yamlState.buffer.files.length - 1;
        renderBufAll();
    });

    document.getElementById('btn-buf-remove').addEventListener('click', () => {
        const { files, activeIdx } = yamlState.buffer;
        if (activeIdx < 0 || activeIdx >= files.length) {
            toast('请先选择要删除的文件', 'error');
            return;
        }
        files.splice(activeIdx, 1);
        yamlState.buffer.activeIdx = files.length === 0
            ? -1
            : Math.min(activeIdx, files.length - 1);
        renderBufAll();
    });

    elBufName.addEventListener('input', () => {
        const { files, activeIdx } = yamlState.buffer;
        if (activeIdx < 0) return;
        files[activeIdx].name = elBufName.value;
        renderBufList();
        renderTgtSummary();
    });
    elBufContent.addEventListener('input', () => {
        const { files, activeIdx } = yamlState.buffer;
        if (activeIdx < 0) return;
        files[activeIdx].content = elBufContent.value;
    });

    // ============ 目标 · 事件 ============
    document.getElementById('btn-tgt-pick').addEventListener('click', async () => {
        try {
            const folder = await SelectDirectory();
            if (!folder) return;
            yamlState.target.folder = folder;
            renderTgtSummary();
            // 选完目标自动展开 target 面板, 让用户看到待发文件概要
            setPanelCollapsed('target', false);
            toast(`目标目录: ${folder}`);
        } catch (err) {
            toast(`选择失败: ${err}`, 'error');
        }
    });

    document.getElementById('btn-tgt-send').addEventListener('click', async () => {
        if (!yamlState.target.folder) {
            toast('请先选择目标目录', 'error');
            return;
        }
        if (yamlState.buffer.files.length === 0) {
            toast('缓冲区为空, 没有可发送的文件', 'error');
            return;
        }
        elTgtStat.textContent = '发送中...';
        try {
            const payload = yamlState.buffer.files.map((f) => ({
                name: f.name, path: '', content: f.content,
            }));
            const n = await SendBufferToFolder(yamlState.target.folder, payload);
            elTgtStat.textContent = `已发送 ${n} 个文件`;
            toast(`已发送 ${n} 个文件到目标目录`);
        } catch (err) {
            elTgtStat.textContent = '发送失败';
            toast(`发送失败: ${err}`, 'error');
        }
    });

    // ============ 搜索框 / nuclei 过滤 · 事件 ============
    const elSrcSearch = document.getElementById('src-search');
    if (elSrcSearch) {
        elSrcSearch.value = yamlState.source.searchQuery;   // 还原跨页状态
        elSrcSearch.addEventListener('input', () => {
            yamlState.source.searchQuery = elSrcSearch.value;
            renderSrcList();
        });
        // ESC 清空
        elSrcSearch.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && elSrcSearch.value) {
                e.preventDefault();
                elSrcSearch.value = '';
                yamlState.source.searchQuery = '';
                renderSrcList();
            }
        });
    }
    // ============ 面板折叠 · 事件 ============
    document.querySelectorAll('.panel-header-title').forEach((el) => {
        el.addEventListener('click', () => {
            const name = el.dataset.panel;
            if (!name) return;
            setPanelCollapsed(name, !panelState[name]);
        });
    });

    // ============ 全选 / 清空 勾选 · 事件 ============
    const elBtnSelectVisible = document.getElementById('btn-select-visible');
    if (elBtnSelectVisible) elBtnSelectVisible.addEventListener('click', selectAllVisible);
    const elBtnSelectClear = document.getElementById('btn-select-clear');
    if (elBtnSelectClear) elBtnSelectClear.addEventListener('click', clearSelection);

    // 页初始化时跨页还原同步徽标 (如果之前有勾选)
    updateSelectionUi();

    // 仅 nuclei toggle
    const elNucleiBtn = document.getElementById('btn-nuclei-only');
    if (elNucleiBtn) {
        elNucleiBtn.classList.toggle('active', yamlState.source.nucleiOnly);   // 跨页还原
        elNucleiBtn.addEventListener('click', () => {
            yamlState.source.nucleiOnly = !yamlState.source.nucleiOnly;
            elNucleiBtn.classList.toggle('active', yamlState.source.nucleiOnly);
            renderSrcList();
        });
    }

    // ============ 源视图切换 · 事件 ============
    // 视图 tab
    document.querySelectorAll('.yaml-view-tab').forEach((el) => {
        el.addEventListener('click', () => {
            const mode = el.dataset.view;
            if (!mode || mode === yamlState.source.viewMode) return;
            yamlState.source.viewMode = mode;
            document.querySelectorAll('.yaml-view-tab').forEach((x) => {
                x.classList.toggle('active', x.dataset.view === mode);
            });
            renderSrcList();
        });
    });
    // 全部展开
    document.getElementById('btn-expand-all').addEventListener('click', () => {
        yamlState.source.collapsedDirs.clear();
        yamlState.source.collapsedCats.clear();
        renderSrcList();
    });
    // 全部折叠 (需要算出所有目录路径 / 所有类别)
    document.getElementById('btn-collapse-all').addEventListener('click', () => {
        const { files, viewMode } = yamlState.source;
        if (viewMode === 'tree') {
            // 收集所有目录路径
            const dirs = new Set();
            files.forEach((f) => {
                const rel = f.relPath || f.name;
                const segs = rel.split(/[\/\\]/).filter(Boolean);
                for (let i = 1; i < segs.length; i++) {
                    dirs.add(segs.slice(0, i).join('/'));
                }
            });
            yamlState.source.collapsedDirs = dirs;
        } else {
            const cats = new Set();
            let hasPending = false;
            files.forEach((f) => {
                if (f.category) cats.add(f.category);
                else hasPending = true;
            });
            if (hasPending) cats.add('__pending__');
            yamlState.source.collapsedCats = cats;
        }
        renderSrcList();
    });

    // 切 yaml 页面后, 按当前 viewMode 同步 tab 的 active 状态 (首次进入是 tree, 后续从缓存回来可能是 category)
    document.querySelectorAll('.yaml-view-tab').forEach((x) => {
        x.classList.toggle('active', x.dataset.view === yamlState.source.viewMode);
    });

    // ============ 初始渲染 (从持久化状态) ============
    renderSrcAll();
    renderBufAll();
}

export { renderYamlConverter };
