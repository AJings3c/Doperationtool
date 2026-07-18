import {
    ConvertMarkdownBatch,
    ConvertMarkdownFile,
    DeletePath,
    LoadDirectory,
    LoadMarkdownDirectory,
    LoadFile,
    SaveYamlBatch,
    SelectDirectory,
    SelectFile,
    ValidateNucleiTemplates,
} from '../../../wailsjs/go/main/App.js';
import { navigate } from '../../app/navigation.js';
import { copyToClipboard, openWithDefault, revealOnDisk, showContextMenu, toast } from '../../core/feedback.js';
import { escapeHtml, joinPath } from '../../core/format.js';
import { progressTracker } from '../../core/progress.js';

import { renderNucleiValidateResult } from './nucleiValidation.js';
import { panelState, setPanelCollapsed } from './panelState.js';

// ============================================================
// 模块 3: POC 转换 (MD → nuclei YAML)
// 复用三栏 yaml-panel 布局 + 通用样式. 流程:
//   1) 加载 .md 文件夹/单文件 → 列表
//   2) 选中要转的, 点 "批量转换" → 后端逐个 ConvertMarkdownFile
//   3) 转换结果出现在 "转换结果" 面板, 用户可逐个编辑 yaml
//   4) 选输出目录, "批量保存" → 写盘
// ============================================================

// 跨页持久化状态
const pocState = {
    folder: '',           // 输入 MD 文件夹路径
    mdFiles: [],          // [{path, name, relPath, content}]
    activeMdIdx: -1,      // 当前查看哪个 MD
    selectedMd: new Set(),// 勾选要转换的 md 索引
    // 折叠的目录 path 集合 (相对所选根, 例如 "CMS漏洞" / "Web应用漏洞/Discuz").
    // 默认加载完后会把所有一级 / 子目录加进来, 大仓库下避免一打开就洗 1k+ 行 DOM,
    // 用户按需展开. 搜索激活时 CSS 会强制展开 (data-searching=true).
    collapsedDirs: new Set(),
    results: [],          // [{...ConvertResult, dirty}]
    activeResIdx: -1,     // 当前编辑哪个结果
    selectedRes: new Set(),
    targetFolder: '',     // 输出目录
};

function renderPocConverter(container) {
    container.innerHTML = `
    <div class="yaml-converter poc-converter">
        <div class="yaml-tip">
            💡 <b>流程</b>: 加载 MD POC → 勾选 → <b>批量转换为 nuclei YAML</b> → 检查/微调 → <b>保存到目标 pocs</b> → <b>验证 / 一键修复</b>
            &nbsp;·&nbsp; 启发式从 MD 推断 id / severity / tags, 自动替换 Host 为 <code>{{Hostname}}</code>, matchers 给占位需人工补齐.
        </div>
        <div class="poc-dddd-card">
            <div class="nv-toolbar">
                <input type="text" class="yaml-path-input" id="poc-dddd-root"
                    placeholder="可选：选择目标项目目录，输出目录可自动设为 common/config/pocs" spellcheck="false" />
                <button class="btn" id="poc-dddd-pick">选择目标项目</button>
                <button class="btn" id="poc-dddd-use-pocs">输出到 pocs</button>
                <button class="btn" id="poc-dddd-audit">关联审计</button>
            </div>
            <div class="nv-history" id="poc-dddd-history"></div>
        </div>
        <div class="yaml-grid">

            <!-- ===== 面板 1: MD 源 ===== -->
            <section class="yaml-panel yaml-panel-source${panelState.source ? ' collapsed' : ''}">
                <div class="panel-header">
                    <div class="panel-header-title" data-panel-poc="source">
                        <span class="panel-header-chevron">▾</span>
                        <span>📂 MD 源</span>
                    </div>
                    <div class="panel-actions">
                        <button class="btn" id="btn-poc-md-file">打开文件</button>
                        <button class="btn" id="btn-poc-md-folder">打开文件夹</button>
                        <button class="btn btn-primary" id="btn-poc-convert">🔄 批量转换 (0)</button>
                    </div>
                </div>
                <input type="text" class="yaml-path-input" id="poc-md-path"
                    placeholder="输入或粘贴 MD 文件夹路径, 按 Enter 加载"
                    title="未选择"
                    autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
                <div class="yaml-panel-body">
                    <div class="yaml-list-pane">
                        <div class="yaml-search-bar">
                            <input class="yaml-search-input" id="poc-md-search" type="search"
                                placeholder="🔍 搜索文件名"
                                autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
                            <button class="btn" id="btn-poc-md-selall" title="全选当前过滤后的文件">全选</button>
                            <button class="btn" id="btn-poc-md-selnone" title="清空所有勾选">清空</button>
                        </div>
                        <div class="yaml-list" id="poc-md-list"></div>
                    </div>
                    <div class="yaml-editor-pane">
                        <input class="yaml-name" id="poc-md-name" placeholder="选择左侧 MD 文件预览" disabled />
                        <textarea class="yaml-content" id="poc-md-content"
                            placeholder="选中左侧 MD 文件预览原文..."
                            readonly
                            spellcheck="false"></textarea>
                    </div>
                </div>
                <div class="panel-footer">
                    <span id="poc-md-stat">未加载</span>
                    <span style="opacity:.7">MD 源</span>
                </div>
            </section>

            <!-- ===== 面板 2: 转换结果 (yaml) ===== -->
            <section class="yaml-panel yaml-panel-buffer${panelState.buffer ? ' collapsed' : ''}">
                <div class="panel-header">
                    <div class="panel-header-title" data-panel-poc="buffer">
                        <span class="panel-header-chevron">▾</span>
                        <span>🔄 转换结果</span>
                    </div>
                    <div class="panel-actions">
                        <button class="btn" id="btn-poc-res-selall">全选</button>
                        <button class="btn" id="btn-poc-res-selnone">清空</button>
                        <button class="btn btn-danger" id="btn-poc-res-remove">移除</button>
                        <button class="btn btn-primary" id="btn-poc-save">💾 保存 (0)</button>
                    </div>
                </div>
                <div class="yaml-path" id="poc-res-banner">转换结果 · 仅在内存中, 编辑后点保存才会落盘</div>
                <div class="yaml-panel-body">
                    <div class="yaml-list-pane">
                        <div class="yaml-list" id="poc-res-list"></div>
                    </div>
                    <div class="yaml-editor-pane">
                        <input class="yaml-name" id="poc-res-name" placeholder="文件名 (保存为 .yaml)" disabled />
                        <textarea class="yaml-content" id="poc-res-content"
                            placeholder="点左侧批量转换后, 结果出现在这, 这里可以直接编辑..."
                            spellcheck="false" disabled></textarea>
                    </div>
                </div>
                <div class="panel-footer">
                    <span id="poc-res-stat">0 个结果</span>
                    <span id="poc-res-warn" style="opacity:.7"></span>
                </div>
            </section>

            <!-- ===== 面板 3: 输出目录 ===== -->
            <section class="yaml-panel yaml-panel-target${panelState.target ? ' collapsed' : ''}">
                <div class="panel-header">
                    <div class="panel-header-title" data-panel-poc="target">
                        <span class="panel-header-chevron">▾</span>
                        <span>📤 输出目录</span>
                    </div>
                    <div class="panel-actions">
                        <button class="btn" id="btn-poc-target-pick">选择目录</button>
                        <button class="btn" id="btn-poc-validate" title="对输出目录运行 nuclei -validate, 检查该目录下所有 yaml">🛡️ 验证</button>
                    </div>
                </div>
                <input type="text" class="yaml-path-input" id="poc-target-path"
                    placeholder="输入或粘贴输出目录绝对路径, 也可点右上 '选择目录'"
                    title="未选择"
                    autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
                <div class="yaml-target-summary" id="poc-target-summary">
                    <div class="yaml-empty">勾选转换结果, 选好目录后, 点结果面板的 "💾 保存" 写入此目录</div>
                </div>
                <div class="poc-validate-result" id="poc-validate-result" hidden></div>
                <div class="panel-footer">
                    <span id="poc-target-stat">就绪</span>
                    <span style="opacity:.7">目标</span>
                </div>
            </section>
        </div>
    </div>`;
    setupPocConverter();
}

function setupPocConverter() {
    // ---- DOM 引用 ----
    const elPath        = document.getElementById('poc-md-path');
    const elMdList      = document.getElementById('poc-md-list');
    const elMdSearch    = document.getElementById('poc-md-search');
    const elMdName      = document.getElementById('poc-md-name');
    const elMdContent   = document.getElementById('poc-md-content');
    const elMdStat      = document.getElementById('poc-md-stat');
    const elResList     = document.getElementById('poc-res-list');
    const elResName     = document.getElementById('poc-res-name');
    const elResContent  = document.getElementById('poc-res-content');
    const elResStat     = document.getElementById('poc-res-stat');
    const elResWarn     = document.getElementById('poc-res-warn');
    const elTargetPath  = document.getElementById('poc-target-path');
    const elTargetSum   = document.getElementById('poc-target-summary');
    const elTargetStat  = document.getElementById('poc-target-stat');
    const elBtnConvert  = document.getElementById('btn-poc-convert');
    const elBtnSave     = document.getElementById('btn-poc-save');
    const elDdddRoot    = document.getElementById('poc-dddd-root');
    const elDdddPick    = document.getElementById('poc-dddd-pick');
    const elDdddUsePocs = document.getElementById('poc-dddd-use-pocs');
    const elDdddAudit   = document.getElementById('poc-dddd-audit');
    const elDdddHist    = document.getElementById('poc-dddd-history');

    elDdddRoot.value = fingerGovState.root || '';
    const renderDdddHistory = () => {
        renderFingerHistoryChips(elDdddHist, fingerGovState.history, (p) => {
            elDdddRoot.value = p;
            fingerGovState.root = p;
            saveFingerGovState(fingerGovState);
        });
    };
    const ddddPocsDir = (root) => {
        const base = String(root || '').trim().replace(/[\\/]+$/, '');
        return base ? `${base}/common/config/pocs` : '';
    };
    renderDdddHistory();

    // ---- 面板折叠 (复用全局 panelState; key 跟 yaml 页一致, 双向同步) ----
    document.querySelectorAll('.poc-converter [data-panel-poc]').forEach((titleEl) => {
        titleEl.addEventListener('click', () => {
            const k = titleEl.dataset.panelPoc;       // 'source' | 'buffer' | 'target'
            if (!(k in panelState)) return;
            const willCollapse = !panelState[k];
            // setPanelCollapsed 只更新 .yaml-panel-{k} 的 class, 这只匹配当前页的面板.
            // 跨页保留状态由 panelState 持久化承担.
            setPanelCollapsed(k, willCollapse);
        });
    });

    elDdddPick.addEventListener('click', async () => {
        try {
            const f = await SelectDirectory();
            if (!f) return;
            elDdddRoot.value = f;
            pushFingerHistory('history', 'root', f);
            renderDdddHistory();
        } catch (err) {
            toast(`选择失败: ${err}`, 'error');
        }
    });
    elDdddRoot.addEventListener('input', () => {
        fingerGovState.root = elDdddRoot.value.trim();
        saveFingerGovState(fingerGovState);
    });
    elDdddRoot.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            pushFingerHistory('history', 'root', elDdddRoot.value.trim());
            renderDdddHistory();
        }
    });
    elDdddUsePocs.addEventListener('click', () => {
        const root = elDdddRoot.value.trim();
        const target = ddddPocsDir(root);
        if (!target) {
            toast('请先选择或粘贴目标项目目录', 'error');
            return;
        }
        pocState.targetFolder = target;
        elTargetPath.value = target;
        elTargetPath.title = target;
        pushFingerHistory('history', 'root', root);
        renderDdddHistory();
        renderTargetSummary();
        if (panelState.target) setPanelCollapsed('target', false);
        toast('输出目录已设为目标项目 common/config/pocs');
    });
    elDdddAudit.addEventListener('click', () => {
        const root = elDdddRoot.value.trim();
        if (root) pushFingerHistory('history', 'root', root);
        navigate('fingerprint-governance');
    });

    // ---- 一些渲染辅助 ----
    function getFilteredMd() {
        const q = (elMdSearch.value || '').trim().toLowerCase();
        if (!q) return pocState.mdFiles.map((f, idx) => ({ f, idx }));
        return pocState.mdFiles
            .map((f, idx) => ({ f, idx }))
            .filter(({ f }) => f.name.toLowerCase().includes(q) || (f.relPath || '').toLowerCase().includes(q));
    }

    // ---- 目录树 ----
    // 把 items ({f, idx}) 按 relPath 切段构建成 { dirs: Map, files: [] } 节点树.
    // 复用了 yaml 转换页 buildSrcTree 的思路, 但 item 形状不同 (POC 这里 idx 是
    // pocState.mdFiles 索引, 不是 yaml file).
    function buildPocTree(items) {
        const root = { dirs: new Map(), files: [] };
        for (const item of items) {
            const rel = item.f.relPath || item.f.name;
            const segs = rel.split(/[\/\\]/).filter(Boolean);
            const dirSegs = segs.slice(0, -1);
            let cur = root;
            for (const seg of dirSegs) {
                if (!cur.dirs.has(seg)) cur.dirs.set(seg, { dirs: new Map(), files: [] });
                cur = cur.dirs.get(seg);
            }
            cur.files.push(item);
        }
        return root;
    }

    function countPocTreeFiles(node) {
        let n = node.files.length;
        for (const child of node.dirs.values()) n += countPocTreeFiles(child);
        return n;
    }

    // 收集 mdFiles 里所有出现过的目录 path (相对根, 不含文件名).
    // 用于初次加载时把所有目录塞进 collapsedDirs, 默认全收起.
    function collectAllDirPaths(mdFiles) {
        const out = new Set();
        for (const f of mdFiles) {
            const rel = f.relPath || f.name;
            const segs = rel.split(/[\/\\]/).filter(Boolean);
            for (let i = 1; i < segs.length; i++) {
                out.add(segs.slice(0, i).join('/'));
            }
        }
        return out;
    }

    // 单文件行 HTML. paddingLeft 由树深度决定.
    function renderPocFileRow({ f, idx }, paddingLeft) {
        const active = idx === pocState.activeMdIdx ? ' active' : '';
        const sel = pocState.selectedMd.has(idx) ? ' selected' : '';
        const checked = pocState.selectedMd.has(idx) ? ' checked' : '';
        return `
            <div class="tree-file yaml-list-item${active}${sel}"
                 data-idx="${idx}"
                 style="padding-left:${paddingLeft}px"
                 title="${escapeHtml(f.path)}">
                <input type="checkbox" class="file-check" data-idx="${idx}"${checked} />
                <span class="tree-file-icon">📄</span>
                <span class="yaml-list-name">${escapeHtml(f.name)}</span>
            </div>`;
    }

    function renderPocTreeNode(node, depth, dirPath) {
        const PAD = 14;
        let html = '';
        const dirNames = Array.from(node.dirs.keys()).sort();
        for (const name of dirNames) {
            const subPath = dirPath ? `${dirPath}/${name}` : name;
            const child = node.dirs.get(name);
            const isCollapsed = pocState.collapsedDirs.has(subPath);
            const total = countPocTreeFiles(child);
            html += `
                <div class="tree-folder${isCollapsed ? ' collapsed' : ''}" data-dir-path="${escapeHtml(subPath)}">
                    <div class="tree-folder-header" style="padding-left:${6 + depth * PAD}px">
                        <span class="tree-chevron">▶</span>
                        <span class="tree-folder-icon">📁</span>
                        <span class="tree-folder-name">${escapeHtml(name)}</span>
                        <span class="tree-folder-count">${total}</span>
                    </div>
                    <div class="tree-folder-body">${renderPocTreeNode(child, depth + 1, subPath)}</div>
                </div>`;
        }
        for (const item of node.files) {
            html += renderPocFileRow(item, 10 + depth * PAD);
        }
        return html;
    }

    function renderMdList() {
        if (pocState.mdFiles.length === 0) {
            elMdList.innerHTML = '<div class="yaml-empty">尚未加载 MD 文件</div>';
            return;
        }
        const items = getFilteredMd();
        if (items.length === 0) {
            elMdList.innerHTML = '<div class="yaml-empty">无匹配文件</div>';
            return;
        }
        const tree = buildPocTree(items);
        elMdList.innerHTML = `<div class="yaml-tree">${renderPocTreeNode(tree, 0, '')}</div>`;
        // 折叠 / 文件 click+change+contextmenu 全走委托, 见 bindMdListEvents.
        bindMdListEvents();
    }

    // 切换 activeMdIdx 时只 toggle .active, 不 renderMdList() 全画.
    // 大目录场景下用户每点一个 md 都全树重画 + 重挂监听器会卡几秒, 改成 DOM 局部更新.
    function setActiveMdIdx(idx) {
        const old = pocState.activeMdIdx;
        if (old === idx) return;
        pocState.activeMdIdx = idx;
        renderMdEditor();
        if (old >= 0) {
            const oldRow = elMdList.querySelector(`.tree-file[data-idx="${old}"]`);
            if (oldRow) oldRow.classList.remove('active');
        }
        if (idx >= 0) {
            const newRow = elMdList.querySelector(`.tree-file[data-idx="${idx}"]`);
            if (newRow) newRow.classList.add('active');
        }
    }

    // 单一委托: folder-header 折叠 + tree-file click + checkbox change + 文件/目录右键.
    // 跟 yaml 转换页 bindFileRowEvents 同款思路.
    function bindMdListEvents() {
        if (elMdList._mdDelegated) return;

        elMdList.addEventListener('click', (e) => {
            const t = e.target;
            if (!(t instanceof HTMLElement)) return;
            // 目录折叠
            const folderH = t.closest('.tree-folder-header');
            if (folderH && elMdList.contains(folderH)) {
                const folder = folderH.closest('.tree-folder');
                const dirPath = folder ? folder.dataset.dirPath : '';
                if (!dirPath) return;
                if (pocState.collapsedDirs.has(dirPath)) pocState.collapsedDirs.delete(dirPath);
                else pocState.collapsedDirs.add(dirPath);
                if (folder) folder.classList.toggle('collapsed');
                return;
            }
            // checkbox: 让 native toggle 走自己, change 由下面委托处理
            if (t.classList && t.classList.contains('file-check')) return;
            // 文件行体: 切 activeMdIdx
            const row = t.closest('.tree-file');
            if (row && elMdList.contains(row)) {
                const idx = Number(row.dataset.idx);
                if (!Number.isNaN(idx)) setActiveMdIdx(idx);
            }
        });

        elMdList.addEventListener('change', (e) => {
            const cb = e.target && e.target.closest && e.target.closest('.file-check');
            if (!cb || !elMdList.contains(cb)) return;
            const idx = Number(cb.dataset.idx);
            if (Number.isNaN(idx)) return;
            if (cb.checked) pocState.selectedMd.add(idx);
            else pocState.selectedMd.delete(idx);
            const row = cb.closest('.tree-file');
            if (row) row.classList.toggle('selected', cb.checked);
            updateMdSelUi();
        });

        elMdList.addEventListener('contextmenu', (e) => {
            const t = e.target;
            if (!(t instanceof HTMLElement)) return;
            // 文件右键
            const fileRow = t.closest('.tree-file');
            if (fileRow && elMdList.contains(fileRow)) {
                e.preventDefault();
                const idx = Number(fileRow.dataset.idx);
                const f = pocState.mdFiles[idx];
                if (!f) return;
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
                        onClick: () => deleteMdEntry(f.path, false, f.name),
                    },
                ]);
                return;
            }
            // 目录右键
            const folderH = t.closest('.tree-folder-header');
            if (folderH && elMdList.contains(folderH)) {
                e.preventDefault();
                const folder = folderH.closest('.tree-folder');
                const dirPath = folder ? folder.dataset.dirPath : '';
                if (!dirPath) return;
                const absDir = joinPath(pocState.folder, dirPath);
                const count = pocState.mdFiles.filter((f) =>
                    f.path === absDir || f.path.startsWith(absDir + '/')
                ).length;
                showContextMenu(e.clientX, e.clientY, [
                    { label: '在 Finder 中打开', onClick: () => revealOnDisk(absDir) },
                    { separator: true },
                    { label: '复制完整路径', onClick: () => copyToClipboard(absDir, '路径') },
                    { label: '复制目录名', onClick: () => copyToClipboard(dirPath, '目录名') },
                    { separator: true },
                    {
                        label: `🗑 删除目录: ${dirPath} (含 ${count} 个 md)`,
                        danger: true,
                        onClick: () => deleteMdEntry(absDir, true, dirPath),
                    },
                ]);
            }
        });

        elMdList._mdDelegated = true;
    }

    // 从 mdFiles 里剔除 keep(f) === false 的项, 同步修正 selectedMd 索引和 activeMdIdx.
    // 返回被剔除的数量.
    function pruneMdFiles(keepFn) {
        const newArr = [];
        const newSelected = new Set();
        let newActive = -1;
        let removed = 0;
        for (let i = 0; i < pocState.mdFiles.length; i++) {
            const f = pocState.mdFiles[i];
            if (!keepFn(f)) { removed++; continue; }
            const newIdx = newArr.length;
            newArr.push(f);
            if (pocState.selectedMd.has(i)) newSelected.add(newIdx);
            if (pocState.activeMdIdx === i) newActive = newIdx;
        }
        pocState.mdFiles = newArr;
        pocState.selectedMd = newSelected;
        pocState.activeMdIdx = newActive;
        return removed;
    }

    // 删除入口: 弹 confirm → 调后端 DeletePath → 剔除内存状态 → 重渲染.
    // isDir=true 时 absPath 是目录, 删除会递归 (后端 RemoveAll).
    async function deleteMdEntry(absPath, isDir, displayName) {
        const noun = isDir ? '目录' : '文件';
        if (!window.confirm(`确认删除${noun}吗?\n\n${absPath}\n\n此操作不可撤销.`)) return;
        try {
            await DeletePath(absPath);
        } catch (err) {
            toast(`删除失败: ${err}`, 'error');
            return;
        }
        // 内存状态: 文件直接按 path 等; 目录按前缀
        let removed;
        if (isDir) {
            removed = pruneMdFiles((f) => !(f.path === absPath || f.path.startsWith(absPath + '/')));
        } else {
            removed = pruneMdFiles((f) => f.path !== absPath);
        }
        renderAll();
        toast(`已删除${noun} ${displayName} (列表移除 ${removed} 项)`);
    }

    function renderMdEditor() {
        const f = pocState.mdFiles[pocState.activeMdIdx];
        if (!f) {
            elMdName.value = '';
            elMdContent.value = '';
            return;
        }
        elMdName.value = f.name;
        elMdContent.value = f.content || '';
    }

    function renderMdStat() {
        const total = pocState.mdFiles.length;
        const sel = pocState.selectedMd.size;
        elMdStat.textContent = total === 0
            ? '未加载'
            : `${total} 个 MD${sel > 0 ? ` · 已选 ${sel}` : ''}`;
    }

    function updateMdSelUi() {
        const n = pocState.selectedMd.size;
        elBtnConvert.textContent = `🔄 批量转换 (${n})`;
        renderMdStat();
    }

    // 渲染结果列表 HTML, 不绑事件. 给大批量转换时的节流预览用 (避免每 150ms 重新
    // querySelectorAll + addEventListener N 次, 2400+ 项时会主线程卡顿).
    // 转换结束时再调一次 renderResList() 完整绑监听.
    function renderResListHTML() {
        if (pocState.results.length === 0) {
            elResList.innerHTML = '<div class="yaml-empty">尚无转换结果, 在上面 MD 源面板勾选后点转换</div>';
            return;
        }
        elResList.innerHTML = pocState.results.map((r, idx) => {
            const active = idx === pocState.activeResIdx ? ' active' : '';
            const sel = pocState.selectedRes.has(idx) ? ' selected' : '';
            const checked = pocState.selectedRes.has(idx) ? ' checked' : '';
            const sev = r.severity
                ? `<span class="sev-dot sev-${r.severity}" title="severity: ${r.severity}"></span>`
                : '';
            const dirty = r.dirty ? ' ●' : '';
            const warn = (r.warnings && r.warnings.length > 0) ? ' ⚠' : '';
            return `
            <div class="yaml-list-item${active}${sel}" data-idx="${idx}">
                <input type="checkbox" class="file-check" data-idx="${idx}"${checked} disabled />
                ${sev}
                <span class="yaml-list-name">${escapeHtml((r.suggested || r.id) + '.yaml')}${dirty}${warn}</span>
            </div>`;
        }).join('');
    }

    function renderResList() {
        if (pocState.results.length === 0) {
            elResList.innerHTML = '<div class="yaml-empty">尚无转换结果, 在上面 MD 源面板勾选后点转换</div>';
            return;
        }
        elResList.innerHTML = pocState.results.map((r, idx) => {
            const active = idx === pocState.activeResIdx ? ' active' : '';
            const sel = pocState.selectedRes.has(idx) ? ' selected' : '';
            const checked = pocState.selectedRes.has(idx) ? ' checked' : '';
            const sev = r.severity
                ? `<span class="sev-dot sev-${r.severity}" title="severity: ${r.severity}"></span>`
                : '';
            const dirty = r.dirty ? ' ●' : '';
            const warn = (r.warnings && r.warnings.length > 0) ? ' ⚠' : '';
            const tipParts = [];
            if (r.sourcePath) tipParts.push(r.sourcePath);
            tipParts.push(`id: ${r.id || '?'}`);
            if (r.severity) tipParts.push(`severity: ${r.severity}`);
            if (r.warnings && r.warnings.length > 0) tipParts.push(`⚠ ${r.warnings.join(' · ')}`);
            return `
            <div class="yaml-list-item${active}${sel}" data-idx="${idx}" title="${escapeHtml(tipParts.join('\n'))}">
                <input type="checkbox" class="file-check" data-idx="${idx}"${checked} />
                ${sev}
                <span class="yaml-list-name">${escapeHtml((r.suggested || r.id) + '.yaml')}${dirty}${warn}</span>
            </div>`;
        }).join('');
        bindResListEvents();
    }

    // 切 activeResIdx 时只 toggle .active, 不全列表重画.
    // 大批量转换 (2400+ poc) 时点切就卡几秒, 改 DOM 局部更新.
    function setActiveResIdx(idx) {
        const old = pocState.activeResIdx;
        if (old === idx) return;
        pocState.activeResIdx = idx;
        renderResEditor();
        if (old >= 0) {
            const oldRow = elResList.querySelector(`.yaml-list-item[data-idx="${old}"]`);
            if (oldRow) oldRow.classList.remove('active');
        }
        if (idx >= 0) {
            const newRow = elResList.querySelector(`.yaml-list-item[data-idx="${idx}"]`);
            if (newRow) newRow.classList.add('active');
        }
    }

    // 单一委托: 列表 click + checkbox change + 列表项 contextmenu, 跟 yaml/md 列表同款思路.
    function bindResListEvents() {
        if (elResList._resDelegated) return;

        elResList.addEventListener('click', (e) => {
            const t = e.target;
            if (!(t instanceof HTMLElement)) return;
            // checkbox 自己 toggle, change 由下面委托处理
            if (t.classList && t.classList.contains('file-check')) return;
            const row = t.closest('.yaml-list-item');
            if (row && elResList.contains(row)) {
                const idx = Number(row.dataset.idx);
                if (!Number.isNaN(idx)) setActiveResIdx(idx);
            }
        });

        elResList.addEventListener('change', (e) => {
            const cb = e.target && e.target.closest && e.target.closest('.file-check');
            if (!cb || !elResList.contains(cb)) return;
            const idx = Number(cb.dataset.idx);
            if (Number.isNaN(idx)) return;
            if (cb.checked) pocState.selectedRes.add(idx);
            else pocState.selectedRes.delete(idx);
            const row = cb.closest('.yaml-list-item');
            if (row) row.classList.toggle('selected', cb.checked);
            updateResSelUi();
        });

        elResList.addEventListener('contextmenu', (e) => {
            const t = e.target;
            if (!(t instanceof HTMLElement)) return;
            const row = t.closest('.yaml-list-item');
            if (!row || !elResList.contains(row)) return;
            e.preventDefault();
            const idx = Number(row.dataset.idx);
            const r = pocState.results[idx];
            if (!r) return;
            const items = [
                {
                    label: '复制 yaml 内容',
                    onClick: () => copyToClipboard(r.yaml || '', 'yaml'),
                },
                {
                    label: `复制 id: ${r.id || '(空)'}`,
                    onClick: () => copyToClipboard(r.id || '', 'id'),
                },
            ];
            if (r.sourcePath) {
                items.push({ separator: true });
                items.push({
                    label: '在 Finder 中显示源 md',
                    onClick: () => revealOnDisk(r.sourcePath),
                });
                items.push({
                    label: '用默认应用打开源 md',
                    onClick: () => openWithDefault(r.sourcePath),
                });
                items.push({
                    label: '复制源 md 路径',
                    onClick: () => copyToClipboard(r.sourcePath, '源路径'),
                });
            }
            items.push({ separator: true });
            items.push({
                label: '从结果列表移除 (不影响磁盘)',
                danger: true,
                onClick: () => removeResEntry(idx),
            });
            showContextMenu(e.clientX, e.clientY, items);
        });

        elResList._resDelegated = true;
    }

    // 从结果列表移除单项. 跟"批量删除选中"按钮共用 prune 思路: 重建数组 + 修复
    // selectedRes 和 activeResIdx 索引偏移. 不弹 confirm (不动磁盘, 撤销代价低).
    function removeResEntry(idx) {
        const r = pocState.results[idx];
        if (!r) return;
        const newArr = [];
        const newSelected = new Set();
        let newActive = -1;
        for (let i = 0; i < pocState.results.length; i++) {
            if (i === idx) continue;
            const newIdx = newArr.length;
            newArr.push(pocState.results[i]);
            if (pocState.selectedRes.has(i)) newSelected.add(newIdx);
            if (pocState.activeResIdx === i) newActive = newIdx;
        }
        pocState.results = newArr;
        pocState.selectedRes = newSelected;
        pocState.activeResIdx = newActive;
        renderResList();
        renderResEditor();
        renderResStat();
        updateResSelUi();
        toast(`已从列表移除: ${r.suggested || r.id || '(无名)'}`, 'info');
    }

    function renderResEditor() {
        const r = pocState.results[pocState.activeResIdx];
        if (!r) {
            elResName.value = '';
            elResName.disabled = true;
            elResContent.value = '';
            elResContent.disabled = true;
            elResWarn.textContent = '';
            return;
        }
        elResName.value = r.suggested || r.id || '';
        elResName.disabled = false;
        elResContent.value = r.yaml || '';
        elResContent.disabled = false;
        if (r.warnings && r.warnings.length > 0) {
            elResWarn.textContent = `⚠ ${r.warnings.join('; ')}`;
            elResWarn.title = r.warnings.join('\n');
            elResWarn.style.opacity = '1';
            elResWarn.style.color = 'var(--warn, #d29922)';
        } else {
            elResWarn.textContent = '';
            elResWarn.title = '';
            elResWarn.style.color = '';
        }
    }

    function renderResStat() {
        const n = pocState.results.length;
        const dirty = pocState.results.filter((r) => r.dirty).length;
        const sel = pocState.selectedRes.size;
        elResStat.textContent = `${n} 个结果${sel > 0 ? ` · 已选 ${sel}` : ''}${dirty > 0 ? ` · ${dirty} 个已修改` : ''}`;
    }

    function updateResSelUi() {
        const n = pocState.selectedRes.size;
        elBtnSave.textContent = `💾 保存 (${n})`;
        renderResStat();
        // 选择变化 → 连动刷新 输出目录 面板里的待保存清单
        renderTargetSummary();
    }

    function renderTargetSummary() {
        const indices = Array.from(pocState.selectedRes).sort((a, b) => a - b);
        if (indices.length === 0) {
            elTargetSum.innerHTML = '<div class="yaml-empty">勾选转换结果, 选好目录后, 点结果面板的 "💾 保存" 写入此目录</div>';
            elTargetStat.textContent = '就绪';
            return;
        }
        elTargetSum.innerHTML = `
            <div class="yaml-target-title">将保存 ${indices.length} 个 yaml:</div>
            ${indices.map((i) => {
                const r = pocState.results[i];
                const name = `${r.suggested || r.id}.yaml`;
                return `<div class="yaml-target-item">📄 ${escapeHtml(name)}</div>`;
            }).join('')}
        `;
        elTargetStat.textContent = `${indices.length} 个待保存`;
    }

    function renderAll() {
        elPath.value = pocState.folder || '';
        elPath.title = pocState.folder || '未选择';
        // 输出目录是可编辑 input: 只在与当前状态不同时才赋值, 避免用户边输边被重渲染覆写.
        if (elTargetPath.value !== (pocState.targetFolder || '')) {
            elTargetPath.value = pocState.targetFolder || '';
        }
        elTargetPath.title = pocState.targetFolder || '未选择';
        renderMdList();
        renderMdEditor();
        renderMdStat();
        updateMdSelUi();
        renderResList();
        renderResEditor();
        renderResStat();
        updateResSelUi();
        renderTargetSummary();
    }

    // ---- MD 加载 ----
    async function loadMdFolder(folder) {
        if (!folder) return;
        try {
            elPath.value = folder;
            elPath.title = folder;
            elMdList.innerHTML = '<div class="yaml-loading">正在递归扫描 .md 文件, 请稍候…</div>';
            // 专用接口 LoadMarkdownDirectory: 后端 walk 阶段就按后缀过滤, 避免读进
            // png/jpg 这类二进制文件损坠 IPC. 之前用 LoadDirectory(folder, includeAll=true)
            // 遇到 Awesome-POC 类 1k+ 图片的仓库会加载 800+ MB 二进制直接炸掉.
            const result = await LoadMarkdownDirectory(folder);
            const files = (result && result.files) || [];
            pocState.folder = folder;
            pocState.mdFiles = files.map((f) => ({
                path: f.path, name: f.name, relPath: f.relPath, content: f.content,
            }));
            pocState.activeMdIdx = -1;
            pocState.selectedMd = new Set();
            // 大仓库 (Awesome-POC ~1100 文件 / 20+ 类) 默认全收起, 用户按需展开,
            // 否则一进来要滚很久才能定位下一步.
            pocState.collapsedDirs = collectAllDirPaths(pocState.mdFiles);
            renderAll();
            const truncated = !!(result && result.truncated);
            if (truncated) {
                toast(`⚠️ 扫描达到上限 ${result.limit}, 可能还有未扫到的文件`, 'error');
            }
            toast(`已加载 ${files.length} 个 MD 文件`);
        } catch (err) {
            toast(`加载失败: ${err}`, 'error');
        }
    }

    document.getElementById('btn-poc-md-folder').addEventListener('click', async () => {
        try {
            const f = await SelectDirectory();
            if (!f) return;
            await loadMdFolder(f);
        } catch (err) { toast(`选择失败: ${err}`, 'error'); }
    });

    document.getElementById('btn-poc-md-file').addEventListener('click', async () => {
        try {
            const path = await SelectFile();
            if (!path) return;
            const f = await LoadFile(path);
            if (!/\.md$/i.test(f.name)) {
                toast(`这不是一个 .md 文件: ${f.name}`, 'error');
                return;
            }
            pocState.folder = path;
            pocState.mdFiles = [{ path, name: f.name, relPath: f.name, content: f.content }];
            pocState.activeMdIdx = 0;
            pocState.selectedMd = new Set([0]);
            renderAll();
            toast(`已打开 ${f.name}`);
        } catch (err) { toast(`打开失败: ${err}`, 'error'); }
    });

    elPath.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const f = elPath.value.trim();
            if (f) await loadMdFolder(f);
        } else if (e.key === 'Escape') {
            elPath.value = pocState.folder || '';
            elPath.blur();
        }
    });

    elMdSearch.addEventListener('input', () => {
        // 搜索激活时给容器打 data-searching=true, CSS 会强制展开所有匹配到的 .tree-folder,
        // 让用户不用手动点开就能看到命中. 退出搜索 (input 清空) 后还原折叠.
        elMdList.dataset.searching = elMdSearch.value.trim() ? 'true' : 'false';
        renderMdList();
    });

    document.getElementById('btn-poc-md-selall').addEventListener('click', () => {
        for (const { idx } of getFilteredMd()) pocState.selectedMd.add(idx);
        renderMdList();
        updateMdSelUi();
    });
    document.getElementById('btn-poc-md-selnone').addEventListener('click', () => {
        pocState.selectedMd.clear();
        renderMdList();
        updateMdSelUi();
    });

    // ---- 批量转换 ----
    // 走后端 ConvertMarkdownBatch (单次 IPC + goroutine 并行 parse), 不再前端 for-await 逐个调.
    // 之前 1127 个 MD 要走 1127 次 IPC, 单次 ~3-5ms = 总 3-6s 纯 IPC 开销.
    // 改成单次 IPC 后, 后端 8 核并行 parse, 1127 个通常 <1s 完成.
    elBtnConvert.addEventListener('click', async () => {
        const indices = Array.from(pocState.selectedMd).sort((a, b) => a - b);
        if (indices.length === 0) {
            toast('请先在左侧勾选要转换的 MD 文件', 'error');
            return;
        }
        elBtnConvert.disabled = true;
        elBtnConvert.textContent = `🔄 转换中 (${indices.length})…`;
        // 把选中文件打包成 batch items. 内容已经在 mdFiles 里 (LoadMarkdownDirectory
        // 时读好), 直接传过去, 避免后端再 ReadFile 一遍.
        const items = indices.map((i) => {
            const f = pocState.mdFiles[i];
            return { name: f.name, content: f.content || '', sourcePath: f.path || '' };
        });
        const t0 = performance.now();
        let added = 0;
        let failed = 0;
        let elapsedSrv = '';
        try {
            const r = await ConvertMarkdownBatch(items);
            const results = Array.isArray(r.results) ? r.results : [];
            failed = r.failed || 0;
            elapsedSrv = r.elapsed || '';
            for (const it of results) {
                if (!it) continue;
                it.dirty = false;
                pocState.results.push(it);
                added++;
            }
        } catch (err) {
            console.warn('批量转换失败:', err);
            elBtnConvert.disabled = false;
            elBtnConvert.textContent = `🔄 批量转换 (${pocState.selectedMd.size})`;
            toast(`批量转换失败: ${err}`, 'error');
            return;
        }
        const elapsedClient = ((performance.now() - t0) / 1000).toFixed(2) + 's';
        elBtnConvert.disabled = false;
        // 转换完默认聚焦到刚追加的第一条
        if (added > 0 && pocState.activeResIdx < 0) {
            pocState.activeResIdx = pocState.results.length - added;
        }
        renderAll();
        const tail = elapsedSrv ? ` · 后端 ${elapsedSrv} · 总 ${elapsedClient}` : ` · ${elapsedClient}`;
        if (failed > 0) toast(`已转换 ${added} 个, ${failed} 个失败${tail}`, 'error');
        else toast(`已转换 ${added} 个 MD → YAML${tail}, 进入"转换结果"面板检查`);
        if (added > 0 && panelState.buffer) setPanelCollapsed('buffer', false);
    });

    // ---- 结果编辑 ----
    elResName.addEventListener('input', () => {
        const r = pocState.results[pocState.activeResIdx];
        if (!r) return;
        r.suggested = elResName.value;
        r.dirty = true;
        renderResList();
        renderResStat();
    });
    elResContent.addEventListener('input', () => {
        const r = pocState.results[pocState.activeResIdx];
        if (!r) return;
        const wasDirty = r.dirty;
        r.yaml = elResContent.value;
        r.dirty = true;
        if (!wasDirty) renderResList();
        renderResStat();
    });

    document.getElementById('btn-poc-res-selall').addEventListener('click', () => {
        for (let i = 0; i < pocState.results.length; i++) pocState.selectedRes.add(i);
        renderResList();
        updateResSelUi();
    });
    document.getElementById('btn-poc-res-selnone').addEventListener('click', () => {
        pocState.selectedRes.clear();
        renderResList();
        updateResSelUi();
    });
    document.getElementById('btn-poc-res-remove').addEventListener('click', () => {
        if (pocState.selectedRes.size === 0) {
            toast('请先勾选要移除的结果', 'error');
            return;
        }
        const keep = [];
        pocState.results.forEach((r, i) => { if (!pocState.selectedRes.has(i)) keep.push(r); });
        const removed = pocState.results.length - keep.length;
        pocState.results = keep;
        pocState.selectedRes.clear();
        if (pocState.activeResIdx >= keep.length) pocState.activeResIdx = -1;
        renderAll();
        toast(`已移除 ${removed} 个 (仅从列表移除, 不影响磁盘)`);
    });

    // ---- 选输出目录 + 批量保存 ----
    document.getElementById('btn-poc-target-pick').addEventListener('click', async () => {
        try {
            const f = await SelectDirectory();
            if (!f) return;
            pocState.targetFolder = f;
            elTargetPath.value = f;
            elTargetPath.title = f;
            renderTargetSummary();
            // 选了目录后贴心展开该面板, 让用户看到待保存清单
            if (panelState.target) setPanelCollapsed('target', false);
        } catch (err) { toast(`选择失败: ${err}`, 'error'); }
    });

    // 用户直接在输出目录路径里输入/粘贴: 同步到状态. 不做存在性校验, 让保存或验证时再报错,
    // 这样粘贴一个尚未创建的目录路径用户可以先看, 后续 SaveYamlBatch 自己会 mkdir.
    elTargetPath.addEventListener('input', () => {
        pocState.targetFolder = elTargetPath.value.trim();
        elTargetPath.title = pocState.targetFolder || '未选择';
    });
    elTargetPath.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            elTargetPath.blur();
            renderTargetSummary();
        } else if (e.key === 'Escape') {
            elTargetPath.value = pocState.targetFolder || '';
            elTargetPath.blur();
        }
    });

    // ---- nuclei -validate 一键验证当前输出目录 ----
    const elValidateBtn = document.getElementById('btn-poc-validate');
    const elValidateOut = document.getElementById('poc-validate-result');
    elValidateBtn.addEventListener('click', async () => {
        if (!pocState.targetFolder) {
            toast('请先选择输出目录', 'error');
            return;
        }
        // 抽出来给 autofix 完成后回调复用 — fix 完直接再跑一次, 不用用户手点
        const runValidate = async () => {
            elValidateBtn.disabled = true;
            const oldLabel = elValidateBtn.textContent;
            elValidateBtn.textContent = '⏳ 验证中…';
            elValidateOut.hidden = false;
            elValidateOut.innerHTML = `<div class="yaml-empty">正在对 ${escapeHtml(pocState.targetFolder)} 运行 nuclei -validate…</div>`;
            elTargetStat.textContent = '验证中…';
            progressTracker.start('validate:progress', '运行 nuclei -validate');
            try {
                const r = await ValidateNucleiTemplates(pocState.targetFolder);
                renderNucleiValidateResult(elValidateOut, r, pocState.targetFolder, runValidate);
                if (r.ok) {
                    toast(`✅ 验证通过 (${r.elapsed}, ${r.warnings.length} warning)`);
                    elTargetStat.textContent = `验证通过 · ${r.elapsed}`;
                } else {
                    toast(`⚠️ 验证有 ${r.errors.length} 个错误`, 'error');
                    elTargetStat.textContent = `${r.errors.length} 错 · ${r.warnings.length} 警告`;
                }
            } catch (err) {
                const msg = String(err);
                elValidateOut.innerHTML = `<div class="poc-validate-fail">❌ 无法运行 nuclei: ${escapeHtml(msg)}</div>`;
                toast(msg, 'error');
                elTargetStat.textContent = '验证失败';
                progressTracker.stop();
            } finally {
                elValidateBtn.disabled = false;
                elValidateBtn.textContent = oldLabel;
            }
        };
        await runValidate();
    });

    elBtnSave.addEventListener('click', async () => {
        if (!pocState.targetFolder) {
            toast('请先在底部"输出目录"面板选择目录', 'error');
            return;
        }
        const indices = Array.from(pocState.selectedRes).sort((a, b) => a - b);
        if (indices.length === 0) {
            toast('请先勾选要保存的结果', 'error');
            return;
        }
        const files = indices.map((i) => {
            const r = pocState.results[i];
            return { name: r.suggested || r.id, content: r.yaml || '' };
        });
        try {
            elBtnSave.disabled = true;
            // 后端返回 SaveYamlBatchResult: {written, renamed, skippedDupContent, skippedDupPayload, ...}
            // 三层去重 (整文相同 → requests 相同 → 文件名后缀), 用户大概率有占位 yaml
            // 被批量跳过 (没识别到 ## poc 的那批), 这里把统计数据如实告诉他.
            const r = await SaveYamlBatch(pocState.targetFolder, files);
            const written = (r && r.written) || 0;
            const skipC = (r && r.skippedDupContent) || 0;
            const skipP = (r && r.skippedDupPayload) || 0;
            const renamed = (r && r.renamed) || 0;
            // 标记保存完的为非 dirty (这里粗粒度: 全部勾选项标干净, 即使部分被跳过也无所谓,
            // 反正用户不需要再 "保存" 那些了)
            indices.forEach((i) => { pocState.results[i].dirty = false; });
            renderResList();
            renderResStat();

            const parts = [`已保存 ${written} / ${files.length}`];
            if (renamed > 0) parts.push(`同名重命名 ${renamed}`);
            if (skipC > 0)   parts.push(`整文重复跳过 ${skipC}`);
            if (skipP > 0)   parts.push(`requests 重复跳过 ${skipP}`);
            parts.push('可点验证检查 nuclei 语法');
            elTargetStat.textContent = `已保存 ${written} 个 · 待验证`;
            toast(parts.join(' · '), (skipC + skipP) > 0 ? 'warn' : 'info');

            // 跳过项写到 console, 用户回头能查
            if (r && r.skippedItems && r.skippedItems.length > 0) {
                console.warn('[SaveYamlBatch] 跳过项:', r.skippedItems);
            }
        } catch (err) {
            toast(`保存失败: ${err}`, 'error');
        } finally {
            elBtnSave.disabled = false;
        }
    });

    // ---- 初始渲染 (跨页保留状态) ----
    renderAll();
}

export { renderPocConverter };
