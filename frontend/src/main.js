import './style.css';
import logoLight from './assets/images/logo-light.png';
import logoDark from './assets/images/logo-dark.png';
import {
    ApplyTemplateCategories,
    ApplyYamlCollection,
    ApplyFingerprintImport,
    AutoFixNucleiTemplates,
    AuditFingerprintKnowledge,
    CancelCurrentTask,
    ClassifyExternalPocsByDDDD,
    ConvertMarkdownBatch,
    ConvertMarkdownFile,
    ConvertMarkdownFolder,
    ConvertMarkdownText,
    DeletePath,
    ExtractBaseNames,
    LoadDirectory,
    LoadMarkdownDirectory,
    LoadFile,
    MoveTemplateDuplicates,
    OpenWithDefaultApp,
    PreviewFingerprintImport,
    RevealInFileManager,
    SaveSourceFile,
    SaveYamlBatch,
    ScanDuplicateTemplates,
    ScanTemplateCategories,
    ScanYamlCollection,
    SelectDirectory,
    SelectFile,
    SendBufferToFolder,
    ValidateNucleiTemplates,
} from '../wailsjs/go/main/App';
import { WindowToggleMaximise, EventsOn, EventsOff } from '../wailsjs/runtime/runtime';

/* ============================================================
 * Doperationtool - 渗透测试辅助工具集
 *   · 辅助模块 / 文件名提取  (浏览器侧 ClipboardEvent.files)
 *   · 转换模块 / YAML 转换   (Wails 后端读写本地文件)
 * 单文件全部 UI 渲染 + 路由切换. 模块状态在切换间保留.
 * ============================================================ */

const THEME_KEY = 'doperationtool.theme';
const themeState = { current: 'dark' };
try {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === 'light' || savedTheme === 'dark') themeState.current = savedTheme;
} catch (e) {}
function themeLogo() {
    return themeState.current === 'light' ? logoLight : logoDark;
}
function saveThemeState() {
    try { localStorage.setItem(THEME_KEY, themeState.current); } catch (e) {}
}
function applyTheme(theme = themeState.current) {
    themeState.current = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = themeState.current;
    const logo = document.getElementById('sidebar-logo');
    if (logo) logo.src = themeLogo();
    const icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = themeState.current === 'light' ? '☀' : '☾';
    const btn = document.getElementById('btn-theme-toggle');
    if (btn) {
        const next = themeState.current === 'light' ? '深色' : '浅色';
        btn.title = `当前${themeState.current === 'light' ? '浅色' : '深色'}模式，点击切换${next}模式`;
        btn.setAttribute('aria-label', `切换${next}模式`);
    }
}
applyTheme();

// ============ 侧栏持久化状态 ============
// 宽度 + 模块折叠状态, 写入 localStorage 让用户跨次启动保留偏好.
const SIDEBAR_KEY = 'doperationtool.sidebar';
const sidebarState = {
    width: 220,
    collapsed: { convert: false, aux: false },
    hidden: false,   // 整个侧栏隐藏 (只留主区 + 头部按钮)
};
try {
    const saved = JSON.parse(localStorage.getItem(SIDEBAR_KEY) || '{}');
    if (typeof saved.width === 'number' && saved.width >= 160 && saved.width <= 420) {
        sidebarState.width = saved.width;
    }
    if (saved.collapsed && typeof saved.collapsed === 'object') {
        Object.assign(sidebarState.collapsed, saved.collapsed);
    }
    if (typeof saved.hidden === 'boolean') sidebarState.hidden = saved.hidden;
} catch (e) { /* localStorage 损坏忽略 */ }
function saveSidebarState() {
    try { localStorage.setItem(SIDEBAR_KEY, JSON.stringify(sidebarState)); } catch (e) {}
}

// ============ 渲染应用骨架 ============
document.querySelector('#app').innerHTML = `
<div class="app-titlebar"></div>
<aside class="sidebar${sidebarState.hidden ? ' hidden' : ''}" id="sidebar" style="width:${sidebarState.width}px">
    <div class="sidebar-header">
        <div class="sidebar-brand">
            <img class="sidebar-logo" id="sidebar-logo" src="${themeLogo()}" alt="Doperationtool" />
            <div class="sidebar-brand-text">
                <div class="sidebar-title">Doperationtool</div>
                <div class="sidebar-subtitle">v0.2 · Doperationtool</div>
            </div>
        </div>
        <button class="sidebar-collapse" id="btn-sidebar-collapse" title="收起侧栏" aria-label="收起侧栏">‹</button>
    </div>
    <ul class="module-list" id="module-list">
        <li class="module-item" data-tool="fingerprint-governance"><span class="module-icon">A</span><span class="module-label">dddd 能力对比</span></li>
        <li class="module-item" data-tool="poc-catalog"><span class="module-icon">P</span><span class="module-label">外部 POC 归类</span></li>
        <li class="module-item" data-tool="dddd-fingerprint-converter"><span class="module-icon">F</span><span class="module-label">外部指纹导入</span></li>
    </ul>
    <div class="sidebar-footer">© 2026 Doperationtool</div>
    <div class="sidebar-resizer" id="sidebar-resizer" title="拖动调整宽度"></div>
</aside>
<main class="main">
    <header class="main-header">
        <button class="sidebar-toggle" id="btn-sidebar-toggle"
            title="收起/展开侧栏 (⌘B)"
            aria-label="toggle sidebar">☰</button>
        <div class="breadcrumb">
            <span class="breadcrumb-current" id="bc-current">YAML 转换</span>
        </div>
        <div class="header-actions">
            <button class="theme-toggle" id="btn-theme-toggle" title="切换浅色/深色模式" aria-label="切换浅色/深色模式"><span class="theme-icon" id="theme-icon">${themeState.current === 'light' ? '☀' : '☾'}</span></button>
        </div>
    </header>
    <div class="main-content" id="main-content"></div>
</main>
<div class="toast" id="toast"></div>
<div class="global-progress" id="global-progress" hidden>
    <div class="gp-head">
        <span class="gp-title" id="gp-title">…</span>
        <span class="gp-elapsed" id="gp-elapsed"></span>
        <button class="gp-cancel" id="gp-cancel" title="取消当前任务" aria-label="取消">✕</button>
    </div>
    <div class="gp-bar"><div class="gp-fill" id="gp-fill"></div></div>
    <div class="gp-meta">
        <span class="gp-phase" id="gp-phase"></span>
        <span class="gp-label" id="gp-label"></span>
    </div>
</div>
`;

// ============ 全局长任务进度卡片 (右下角浮动) ============
// 后端 dedup / autofix / validator 跑 5-30s 时, 用户只看到"按钮 disabled" 不知道
// 还有多少, 容易反复猜疑卡死. 这个 tracker 对外提供 progressTracker.start/stop:
//   - start(eventName, title): 注册 wails event 监听器, 显示卡片, 实时更新进度
//   - stop(): 强制收起 (调用方 finally 里调, 防止后端没正常 emit done 时残留)
// 单例: 同时只跟踪一个长任务. 如果调 start 时已有任务在跑, 替换之 (不会同时跑两个).
const progressTracker = (() => {
    const elCard = () => document.getElementById('global-progress');
    const elTitle = () => document.getElementById('gp-title');
    const elElapsed = () => document.getElementById('gp-elapsed');
    const elFill = () => document.getElementById('gp-fill');
    const elPhase = () => document.getElementById('gp-phase');
    const elLabel = () => document.getElementById('gp-label');
    const elCancel = () => document.getElementById('gp-cancel');

    let currentEvent = '';
    let cancelFn = null;        // EventsOn 返回的 cancel
    // 自动收起 timer: 后端 emit Done=true 后 800ms 隐藏卡片, 让用户看到 100% 一会儿
    let hideTimer = null;
    let elapsedTimer = null;
    let startedAt = 0;
    // 用户点过取消按钮 → 后续 update 不再覆盖 label, 防止 indeterminate 心跳消息盖掉"取消中…"
    let cancelRequested = false;

    // phase 名 → 中文显示. 后端 emit 的 phase 是英文 key, 这里翻成给人看的字.
    const phaseLabels = {
        scanning:   '扫描中',
        analyzing:  '分析中',
        deduping:   '去重中',
        fixing:     '修复中',
        previewing: '预览中',
        moving:     '移动中',
        applying:   '应用中',
        validating: '验证中',
        auditing:   '审计中',
    };

    function formatElapsed(ms) {
        if (ms < 1000) return `${Math.max(0, Math.floor(ms / 100) * 100)}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        const sec = Math.floor(ms / 1000);
        const min = Math.floor(sec / 60);
        const rest = String(sec % 60).padStart(2, '0');
        return `${min}m ${rest}s`;
    }

    function refreshElapsed() {
        if (!startedAt) return;
        elElapsed().textContent = formatElapsed(Date.now() - startedAt);
    }

    function show(title) {
        const c = elCard();
        if (!c) return;
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
        startedAt = Date.now();
        cancelRequested = false;
        elTitle().textContent = title || '处理中';
        refreshElapsed();
        elPhase().textContent = '';
        elLabel().textContent = '';
        const fill = elFill();
        fill.style.width = '0%';
        fill.classList.remove('indeterminate', 'done', 'cancelled');
        const cancel = elCancel();
        if (cancel) {
            cancel.disabled = false;
            cancel.textContent = '✕';
        }
        c.hidden = false;
        elapsedTimer = setInterval(refreshElapsed, 100);
    }

    function update(p) {
        if (!p || typeof p !== 'object') return;
        const fill = elFill();
        if (p.done) {
            elElapsed().textContent = p.elapsed || elElapsed().textContent;
        } else {
            refreshElapsed();
        }
        elPhase().textContent = phaseLabels[p.phase] || p.phase || '';
        // 用户点取消后, 期间收到的"取消中…"以外的 indeterminate 心跳别盖回去
        if (!cancelRequested) {
            elLabel().textContent = p.label || '';
        }
        if (p.percent < 0 || p.total === 0) {
            // indeterminate: CSS 走条纹动画
            fill.classList.add('indeterminate');
            fill.style.width = '100%';
        } else {
            fill.classList.remove('indeterminate');
            const pct = Math.max(0, Math.min(100, p.percent || 0));
            fill.style.width = pct.toFixed(1) + '%';
        }
        if (p.done) {
            if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
            fill.classList.remove('indeterminate');
            fill.style.width = '100%';
            if (p.cancelled) {
                fill.classList.add('cancelled');
                elLabel().textContent = '已取消';
            } else {
                fill.classList.add('done');
            }
            const cancel = elCancel();
            if (cancel) cancel.disabled = true;
            // 让用户看见 100% / 完成文案再收
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(stop, 800);
        }
    }

    // 用户点 ✕: 立刻视觉反馈 + 调后端 CancelCurrentTask. 后端会 cancel ctx, 长任务
    // 循环检测到 ctx.Err() 主动退出, defer 的 pe.finish 会发 Done+Cancelled=true 的事件,
    // 上面 update 处理后续 hide.
    async function requestCancel() {
        if (!currentEvent || cancelRequested) return;
        cancelRequested = true;
        const cancel = elCancel();
        if (cancel) {
            cancel.disabled = true;
            cancel.textContent = '⏳';
        }
        elLabel().textContent = '正在取消…';
        try { await CancelCurrentTask(); } catch (e) {
            // "当前没有正在运行的任务" 之类: 可能后端先一步完成. 不报错, 等后端 Done.
            console.warn('[progress] cancel failed:', e);
        }
    }

    function start(eventName, title) {
        // 已有别的任务在跑: 先 stop 释放监听器
        if (currentEvent) stop();
        currentEvent = eventName;
        show(title);
        // 一次性给取消按钮挂 onclick (用 onclick 赋值天然替换旧 handler, 不会泄漏)
        const cancel = elCancel();
        if (cancel) cancel.onclick = requestCancel;
        try {
            cancelFn = EventsOn(eventName, (p) => update(p));
        } catch (e) {
            // 没在 wails 环境 (例如纯 web 开发) 静默
            console.warn('[progress] EventsOn failed:', e);
            cancelFn = null;
        }
    }

    function stop() {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
        startedAt = 0;
        if (cancelFn) { try { cancelFn(); } catch (e) {} cancelFn = null; }
        if (currentEvent) {
            try { EventsOff(currentEvent); } catch (e) {}
            currentEvent = '';
        }
        cancelRequested = false;
        const cancel = elCancel();
        if (cancel) cancel.onclick = null;
        const c = elCard();
        if (c) c.hidden = true;
    }

    return { start, stop };
})();

// ============ 侧栏: 模块折叠 / 右边缘拖动 resize ============
document.querySelectorAll('.module-item[data-tool]').forEach((el) => {
    el.addEventListener('click', (e) => {
        e.stopPropagation();
        navigate(el.dataset.tool);
    });
});

(() => {
    const sidebar = document.getElementById('sidebar');
    const resizer = document.getElementById('sidebar-resizer');
    if (!sidebar || !resizer) return;
    let resizing = false;
    resizer.addEventListener('mousedown', (e) => {
        if (sidebarState.hidden) return;
        resizing = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
        if (!resizing) return;
        // 限定宽度区间: 太窄看不见标签, 太宽吃主区
        const w = Math.min(420, Math.max(160, e.clientX));
        sidebar.style.width = w + 'px';
        sidebarState.width = w;
    });
    window.addEventListener('mouseup', () => {
        if (!resizing) return;
        resizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        saveSidebarState();
    });
})();

// 头部 ☰ 按钮: 整体收起/展开侧栏
(() => {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('btn-sidebar-toggle');
    const collapseBtn = document.getElementById('btn-sidebar-collapse');
    if (!sidebar || !btn) return;
    function syncSidebarHidden() {
        sidebar.classList.toggle('hidden', sidebarState.hidden);
        if (collapseBtn) {
            collapseBtn.textContent = sidebarState.hidden ? '›' : '‹';
            collapseBtn.title = sidebarState.hidden ? '展开侧栏' : '收起侧栏';
            collapseBtn.setAttribute('aria-label', collapseBtn.title);
        }
    }
    function toggleSidebar() {
        sidebarState.hidden = !sidebarState.hidden;
        syncSidebarHidden();
        saveSidebarState();
    }
    btn.addEventListener('click', toggleSidebar);
    if (collapseBtn) collapseBtn.addEventListener('click', toggleSidebar);
    syncSidebarHidden();
})();

(() => {
    const btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;
    applyTheme();
    btn.addEventListener('click', () => {
        themeState.current = themeState.current === 'light' ? 'dark' : 'light';
        saveThemeState();
        applyTheme();
    });
})();

// ============ YAML 面板折叠状态 ============
// 默认: source 展开, buffer + target 折叠 (节省屏幕给编辑器). 用户改后写 localStorage.
const PANEL_KEY = 'doperationtool.panel-collapsed';
const panelState = { source: false, buffer: true, target: true };
try {
    const saved = JSON.parse(localStorage.getItem(PANEL_KEY) || '{}');
    Object.assign(panelState, saved);
} catch (e) { /* localStorage 损坏忽略 */ }
function savePanelState() {
    try { localStorage.setItem(PANEL_KEY, JSON.stringify(panelState)); } catch (e) {}
}
// 设置某个面板的折叠状态, 同步更新 DOM 和 localStorage
function setPanelCollapsed(name, collapsed) {
    panelState[name] = collapsed;
    savePanelState();
    const el = document.querySelector(`.yaml-panel-${name}`);
    if (el) el.classList.toggle('collapsed', collapsed);
}

// ============ 全局键盘快捷键 ============
// Cmd+S / Ctrl+S 触发当前激活页的 "保存" 按钮 (目前只有 yaml 转换页提供 #btn-src-save).
// Cmd+Shift+F / Ctrl+Shift+F 切换窗口最大化 (代替双击标题栏的 macOS 习惯).
// 放在模块顶层只绑一次, 跨页切换不会重复叠加.
document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    // Cmd+Shift+F → 切换最大化 (作为双击标题栏的快捷键替代)
    if (e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        try { WindowToggleMaximise(); } catch (err) { /* 非 wails 环境忽略 */ }
        return;
    }

    // Cmd+S → 保存
    if (e.key === 's' && !e.shiftKey) {
        const btn = document.getElementById('btn-src-save');
        if (!btn) return;        // 不在 yaml 页, 让浏览器默认行为... wails 里其实也没默认, 但稳妥一点
        e.preventDefault();
        if (!btn.disabled) btn.click();
        return;
    }

    // Cmd+B → 收起/展开侧栏 (VS Code 习惯)
    if ((e.key === 'b' || e.key === 'B') && !e.shiftKey) {
        const btn = document.getElementById('btn-sidebar-toggle');
        if (btn) {
            e.preventDefault();
            btn.click();
        }
    }
});

// 双击窗口最顶部的拖动条 (.app-titlebar) → 切换最大化, 复制 macOS 标题栏的原生体验.
// Wails 的 TitleBarHiddenInset 让标题栏不可见, 默认双击不会被 macOS 接管, 这里手动桥一下.
document.addEventListener('dblclick', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    // 只响应 app-titlebar / sidebar-header / main-header 上的双击 (它们都是 drag 区)
    if (target.closest('.app-titlebar, .sidebar-header, .main-header')) {
        try { WindowToggleMaximise(); } catch (err) { /* 非 wails 环境忽略 */ }
    }
});

// ============ 通用工具 ============
// HTML 转义: 文件名 / 路径里偶尔会出现 < > & "不转会碎渲染.
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// 字节数 → 人友好字符串. dedup / collect 卡片元数据都要用, 提到模块级.
function formatBytes(n) {
    if (!n && n !== 0) return '?';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
}

// 把 NucleiValidateResult 渲染到指定容器. 提到模块级是为了让 POC 转换页和独立的
// "Nuclei 验证" 页共用一套展示, 单点维护配色和折叠交互.
//
//  folder: 验证的目录 (autofix 需要它). 缺失则 autofix 按钮不可用.
//  onRevalidate: 修复完调用, 通常重新跑一次 ValidateNucleiTemplates 刷新结果.
function renderNucleiValidateResult(container, r, folder, onRevalidate) {
    // 后端理论上把 errors/warnings 初始化为空 slice (序列化成 []), 但万一旧版/异常情况
    // 出现 null, 这里兜底成 [], 不能让 .length 炸掉整个验证 UI.
    const errors = Array.isArray(r.errors) ? r.errors : [];
    const warnings = Array.isArray(r.warnings) ? r.warnings : [];

    // 分析: 警告里有多少是 "duplicate template ID" — 这种我们能一键 dedup.
    // nuclei 的警告文本: "Found duplicate template ID during validation '/x.yaml' => '/y.yaml'"
    const dupWrnCount = warnings.filter((w) => /duplicate template id/i.test(w.cause || w.line || '')).length;

    const head = r.ok
        ? `<div class="poc-validate-pass">✅ 全部通过 · ${errors.length} 错 · ${warnings.length} 警告 · ${escapeHtml(r.elapsed || '')} · ${escapeHtml(r.version || 'nuclei')}</div>`
        : `<div class="poc-validate-fail">❌ ${errors.length} 错 · ${warnings.length} 警告 · ${escapeHtml(r.elapsed || '')} · ${escapeHtml(r.version || 'nuclei')}</div>`;
    const issueRow = (kind, iss) => `
        <li class="poc-validate-item poc-validate-${kind}">
            <span class="poc-validate-tag">${kind === 'err' ? 'ERR' : 'WRN'}</span>
            ${iss.path ? `<span class="poc-validate-path" title="${escapeHtml(iss.path)}">${escapeHtml(iss.path.split('/').pop())}</span>` : ''}
            <span class="poc-validate-cause">${escapeHtml(iss.cause || '')}</span>
        </li>`;
    // 操作条: 复制 / 修复. autofix 按钮只在 folder 已知时出现, 避免点完了不知道改谁.
    const canFix = !!folder;
    const actions = (errors.length || warnings.length)
        ? `<div class="poc-validate-actions">
             ${errors.length ? `<button class="btn btn-tiny" data-act="copy-err">📋 复制错误 (${errors.length})</button>` : ''}
             ${warnings.length ? `<button class="btn btn-tiny" data-act="copy-wrn">📋 复制警告 (${warnings.length})</button>` : ''}
             ${r.raw ? `<button class="btn btn-tiny" data-act="copy-raw">📋 复制原始</button>` : ''}
             ${canFix && errors.length ? `<button class="btn btn-tiny btn-fix" data-act="autofix-err">🔧 一键修复错误 (${errors.length})</button>` : ''}
             ${canFix && dupWrnCount > 0 ? `<button class="btn btn-tiny btn-fix" data-act="autofix-wrn">🔧 去重 ${dupWrnCount} 个重复 id</button>` : ''}
           </div>`
        : '';
    const errs = errors.length
        ? `<details class="poc-validate-block" open><summary>错误 (${errors.length})</summary>
             <ul class="poc-validate-list">${errors.map((i) => issueRow('err', i)).join('')}</ul>
           </details>`
        : '';
    const wrns = warnings.length
        ? `<details class="poc-validate-block"${errors.length ? '' : ' open'}><summary>警告 (${warnings.length})</summary>
             <ul class="poc-validate-list">${warnings.map((i) => issueRow('wrn', i)).join('')}</ul>
           </details>`
        : '';
    const raw = r.raw
        ? `<details class="poc-validate-block"><summary>原始输出${r.rawTruncated ? ' (已截断)' : ''}</summary>
             <pre class="poc-validate-raw">${escapeHtml(r.raw)}</pre>
           </details>`
        : '';
    container.innerHTML = head + actions + errs + wrns + raw;

    container.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const act = btn.dataset.act;
            if (act === 'copy-err') {
                const text = errors.map((i) => `[ERR]\t${i.path || ''}\t${i.cause || ''}`).join('\n');
                copyToClipboard(text, `${errors.length} 条错误`);
            } else if (act === 'copy-wrn') {
                const text = warnings.map((i) => `[WRN]\t${i.path || ''}\t${i.cause || ''}`).join('\n');
                copyToClipboard(text, `${warnings.length} 条警告`);
            } else if (act === 'copy-raw') {
                copyToClipboard(r.raw || '', '原始输出');
            } else if (act === 'autofix-err') {
                runAutoFixWithPreview(folder, {
                    fixSeverity: true,
                    severityValue: 'unknown',
                    fixInfoFields: true,
                    fixMatcherWord: true,
                    fixRequestsHTTP: true,
                    fixId: true,
                    backup: true,
                }, '修复错误', onRevalidate);
            } else if (act === 'autofix-wrn') {
                runAutoFixWithPreview(folder, {
                    dedupId: true,
                    backup: true,
                }, `去重 ${dupWrnCount} 个重复 id`, onRevalidate);
            }
        });
    });
}

// ============ Nuclei autofix 预览 + 确认流程 ============
// 两步: 先 dry-run 拿改动清单 → 弹 modal 让用户审 → 用户确认后实际执行.
// 流程的关键不变量:
//   - 实际写盘的那次调用一定开了 backup (传入 opts 已强制), 用户回得去
//   - 任何 fix 失败 (Skipped) 不阻塞其它文件, 全跑完一次性报告
//   - 修完后调 onRevalidate (通常就是再跑一次 nuclei -validate), 让用户看到效果
async function runAutoFixWithPreview(folder, opts, title, onRevalidate) {
    if (!folder) {
        toast('未知目录, 无法修复', 'error');
        return;
    }
    // dry-run: 只统计, 不写盘. 用 backup=false 避免 dry-run 也建空备份.
    const previewOpts = { ...opts, dryRun: true, backup: false };
    let preview;
    progressTracker.start('autofix:progress', '预览自动修复 (dry-run)');
    try {
        preview = await AutoFixNucleiTemplates(folder, previewOpts);
    } catch (err) {
        progressTracker.stop();
        toast('预览失败: ' + err, 'error');
        return;
    }
    const changes = Array.isArray(preview.changes) ? preview.changes : [];
    const renames = Array.isArray(preview.dedupRenames) ? preview.dedupRenames : [];
    const willTouch = changes.length + renames.length;
    if (willTouch === 0) {
        toast('没有可自动修复的项 (或都已修过)', 'success');
        return;
    }
    showAutoFixConfirmModal({
        title,
        folder,
        preview,
        onConfirm: async () => {
            const realOpts = { ...opts, dryRun: false };
            let real;
            progressTracker.start('autofix:progress', '正在自动修复');
            try {
                real = await AutoFixNucleiTemplates(folder, realOpts);
            } catch (err) {
                progressTracker.stop();
                toast('修复失败: ' + err, 'error');
                return;
            }
            const fixed = real.fixed || 0;
            const failed = real.failed || 0;
            const renamed = (real.dedupRenames || []).length;
            let msg = `已修复 ${fixed} 个文件`;
            if (renamed) msg += ` · 去重 ${renamed} 个 id`;
            if (failed) msg += ` · ${failed} 个失败`;
            msg += ` · ${real.elapsed || ''}`;
            toast(msg, failed > 0 ? 'error' : 'success');
            if (typeof onRevalidate === 'function') onRevalidate();
        },
    });
}

// 弹一个简单的 modal 显示 dry-run 结果, 给确认按钮.
// 用 fixed-position overlay + 居中卡片实现, 不依赖第三方组件库.
function showAutoFixConfirmModal({ title, folder, preview, onConfirm }) {
    // 移除可能残留的旧 modal
    document.querySelectorAll('.autofix-modal-overlay').forEach((n) => n.remove());

    const changes = Array.isArray(preview.changes) ? preview.changes : [];
    const renames = Array.isArray(preview.dedupRenames) ? preview.dedupRenames : [];
    const skipped = changes.filter((c) => c.skipped);

    // 单文件 fix 行
    const changeRows = changes.slice(0, 200).map((c) => {
        if (c.skipped) {
            return `<li class="autofix-row skip"><span class="autofix-path" title="${escapeHtml(c.path)}">${escapeHtml(c.path.split('/').pop())}</span><span class="autofix-fixes">⚠️ 跳过: ${escapeHtml(c.skipReason || '')}</span></li>`;
        }
        const fixes = (c.appliedFixes || []).join(' · ');
        return `<li class="autofix-row"><span class="autofix-path" title="${escapeHtml(c.path)}">${escapeHtml(c.path.split('/').pop())}</span><span class="autofix-fixes">${escapeHtml(fixes)}</span></li>`;
    }).join('');
    const moreChanges = changes.length > 200 ? `<li class="autofix-row more">… 另有 ${changes.length - 200} 个文件未列出</li>` : '';

    // dedup rename 行
    const renameRows = renames.slice(0, 200).map((r) =>
        `<li class="autofix-row"><span class="autofix-path" title="${escapeHtml(r.path)}">${escapeHtml(r.path.split('/').pop())}</span><span class="autofix-fixes">id: <code>${escapeHtml(r.oldId)}</code> → <code>${escapeHtml(r.newId)}</code></span></li>`
    ).join('');
    const moreRenames = renames.length > 200 ? `<li class="autofix-row more">… 另有 ${renames.length - 200} 个 rename 未列出</li>` : '';

    const overlay = document.createElement('div');
    overlay.className = 'autofix-modal-overlay';
    overlay.innerHTML = `
      <div class="autofix-modal">
        <div class="autofix-modal-head">
          <span class="autofix-modal-title">🔧 ${escapeHtml(title)} · 预览</span>
          <button class="autofix-modal-close" type="button" aria-label="关闭">✕</button>
        </div>
        <div class="autofix-modal-body">
          <div class="autofix-summary">
            目录: <code>${escapeHtml(folder)}</code><br/>
            将改动 <b>${preview.fixed || 0}</b> 个文件
            ${renames.length ? ` · 去重 <b>${renames.length}</b> 个 id` : ''}
            ${skipped.length ? ` · <span class="autofix-warn">⚠️ ${skipped.length} 跳过 (parse 失败等)</span>` : ''}
            · 预览耗时 ${escapeHtml(preview.elapsed || '')}<br/>
            <span class="autofix-note">实际执行时会自动写 <code>.bak.<时间戳></code> 备份, 改坏可还原.</span>
          </div>
          ${changes.length ? `<details open><summary>文件修改 (${changes.length})</summary><ul class="autofix-list">${changeRows}${moreChanges}</ul></details>` : ''}
          ${renames.length ? `<details ${changes.length ? '' : 'open'}><summary>id 重命名 (${renames.length})</summary><ul class="autofix-list">${renameRows}${moreRenames}</ul></details>` : ''}
        </div>
        <div class="autofix-modal-foot">
          <button class="btn" data-act="cancel">取消</button>
          <button class="btn btn-primary" data-act="confirm">✅ 确认修复</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.autofix-modal-close').addEventListener('click', close);
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        // 点 overlay 空白关闭, 点 modal 内不关
        if (e.target === overlay) close();
    });
    overlay.querySelector('[data-act="confirm"]').addEventListener('click', async () => {
        close();
        await onConfirm();
    });
    // Esc 关闭
    const onEsc = (e) => {
        if (e.key === 'Escape') {
            close();
            document.removeEventListener('keydown', onEsc);
        }
    };
    document.addEventListener('keydown', onEsc);
}

// ============ Toast ============
const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg, type = 'success') {
    toastEl.textContent = msg;
    toastEl.className = `toast ${type} show`;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1900);
}

// ============ 右键菜单 ============
// 通用上下文菜单: showContextMenu(x, y, items) 在 (x,y) 显示一个浮层菜单.
// items 形如 [{label, danger?, onClick}]. 点空白 / Esc / 选项后关闭.
// 同一时刻只允许一个菜单在屏 (调用前自动清掉旧的), 避免连点出现幽灵菜单.
let activeContextMenu = null;
function closeContextMenu() {
    if (activeContextMenu) {
        activeContextMenu.remove();
        activeContextMenu = null;
    }
}
function showContextMenu(x, y, items) {
    closeContextMenu();
    if (!items || items.length === 0) return;
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    // 先插进 body 渲染一次再算尺寸, 避免靠右边时溢出屏外
    menu.style.left = '-9999px';
    menu.style.top = '-9999px';
    menu.innerHTML = items.map((it, i) => {
        if (it.separator) return `<div class="context-menu-sep"></div>`;
        const cls = it.danger ? 'context-menu-item danger' : 'context-menu-item';
        return `<div class="${cls}" data-i="${i}">${escapeHtml(it.label)}</div>`;
    }).join('');
    document.body.appendChild(menu);
    activeContextMenu = menu;

    // 调位置 (右 / 下溢出时夹到屏内)
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = x, top = y;
    if (left + rect.width > vw) left = Math.max(4, vw - rect.width - 4);
    if (top + rect.height > vh) top = Math.max(4, vh - rect.height - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    menu.querySelectorAll('.context-menu-item').forEach((el) => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = Number(el.dataset.i);
            closeContextMenu();
            const it = items[idx];
            if (it && typeof it.onClick === 'function') it.onClick();
        });
    });

    // 点空白 / 滚动 / Esc 关闭. 用一次性监听器, 自动 cleanup.
    const closer = (e) => {
        if (e.type === 'keydown' && e.key !== 'Escape') return;
        closeContextMenu();
        document.removeEventListener('mousedown', closer, true);
        document.removeEventListener('keydown', closer, true);
        window.removeEventListener('blur', closer);
        window.removeEventListener('resize', closer);
    };
    setTimeout(() => {
        // 延后绑, 避免本次右键事件冒泡到 mousedown 直接关掉自己
        document.addEventListener('mousedown', closer, true);
        document.addEventListener('keydown', closer, true);
        window.addEventListener('blur', closer);
        window.addEventListener('resize', closer);
    }, 0);
}

// 文件管理器/默认应用/剪贴板的薄包装. 多个模块 (POC 源, POC 结果, YAML 源) 都用,
// 共享一份兜底逻辑避免行为漂. 失败统一 toast, 不抛.
async function revealOnDisk(absPath) {
    try { await RevealInFileManager(absPath); }
    catch (err) { toast(`打开失败: ${err}`, 'error'); }
}
async function openWithDefault(absPath) {
    try { await OpenWithDefaultApp(absPath); }
    catch (err) { toast(`打开失败: ${err}`, 'error'); }
}
// 剪贴板: WebView 支持 navigator.clipboard, 老 webview 退化用 textarea hack.
async function copyToClipboard(text, label) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        toast(`已复制${label}`, 'info');
    } catch (err) {
        toast(`复制失败: ${err}`, 'error');
    }
}
// 拼绝对路径. 假设 mac/linux 用 '/', windows explorer 也接受 '/'.
function joinPath(a, b) {
    if (!a) return b;
    if (a.endsWith('/')) return a + b;
    return a + '/' + b;
}

// ============================================================
// 模块 1: 文件名提取
// ============================================================

// 跨页持久化的状态: 用户切到别的工具再切回来不会丢失之前的结果
const extractState = { input: '', output: '', count: 0 };

function renderFilenameExtract(container) {
    container.innerHTML = `
    <div class="extractor">
        <div class="extractor-tip">
            💡 在 Finder 中选中多个文件 <kbd>⌘ C</kbd> &nbsp;→&nbsp; 点击下方左侧区域 &nbsp;→&nbsp; <kbd>⌘ V</kbd>
            即可批量提取文件名 (一行一个, 保留原顺序). 也支持直接将文件拖入左侧区域.
        </div>
        <div class="extractor-grid">
            <div class="panel">
                <div class="panel-header">
                    <span>📥 粘贴 / 拖入文件</span>
                    <div class="panel-actions">
                        <button class="btn btn-danger" id="btn-clear-input">清空</button>
                    </div>
                </div>
                <div class="dropzone" id="dropzone">
                    <textarea id="input-area" spellcheck="false"
                        autocomplete="off" autocorrect="off" autocapitalize="off"></textarea>
                    <div class="dropzone-placeholder" id="placeholder">
                        <div class="dropzone-icon">📁</div>
                        <div>粘贴 (⌘V) 或 拖入文件到此处</div>
                        <div class="dropzone-hint">支持 Finder 选中多个文件后直接粘贴 · 也支持纯路径文本</div>
                    </div>
                </div>
                <div class="panel-footer">
                    <span id="input-stat">就绪</span>
                    <span style="opacity:.7">输入区</span>
                </div>
            </div>
            <div class="panel">
                <div class="panel-header">
                    <span>📤 提取的文件名</span>
                    <div class="panel-actions">
                        <button class="btn" id="btn-copy">复制</button>
                        <button class="btn btn-danger" id="btn-clear-output">清空</button>
                    </div>
                </div>
                <textarea class="output-area" id="output-area" spellcheck="false"
                    autocomplete="off" autocorrect="off" autocapitalize="off"
                    placeholder="提取结果将显示在这里, 一行一个, 保留原顺序"></textarea>
                <div class="panel-footer">
                    <span id="output-stat">0 个文件名</span>
                    <span style="opacity:.7">输出区</span>
                </div>
            </div>
        </div>
    </div>`;
    setupFilenameExtract();
}

function setupFilenameExtract() {
    const dropzone    = document.getElementById('dropzone');
    const inputArea   = document.getElementById('input-area');
    const outputArea  = document.getElementById('output-area');
    const placeholder = document.getElementById('placeholder');
    const inputStat   = document.getElementById('input-stat');
    const outputStat  = document.getElementById('output-stat');

    // 还原跨页状态
    inputArea.value = extractState.input;
    outputArea.value = extractState.output;
    placeholder.classList.toggle('hidden', !!extractState.input);
    inputStat.textContent = extractState.count > 0 ? `已识别 ${extractState.count} 个项目` : '就绪';
    outputStat.textContent = `${extractState.count} 个文件名`;

    /** 任意路径 / URI / 文件名 → basename */
    function basename(p) {
        if (!p) return '';
        p = String(p).trim();
        if (!p) return '';
        if (p.startsWith('file://')) {
            p = p.replace(/^file:\/\//, '');
            try { p = decodeURIComponent(p); } catch (e) { /* ignore */ }
        }
        p = p.replace(/[?#].*$/, '').replace(/[\/\\]+$/, '');
        if (!p) return '';
        const parts = p.split(/[\/\\]/);
        return parts[parts.length - 1].trim();
    }

    /** 从 ClipboardEvent / DragEvent 中提取文件名列表 */
    function extractFromTransfer(e, kind) {
        const dt = kind === 'paste' ? e.clipboardData : e.dataTransfer;
        if (!dt) return [];
        const names = [];
        if (dt.files && dt.files.length > 0) {
            for (const f of dt.files) if (f && f.name) names.push(f.name);
        }
        if (names.length === 0 && dt.items) {
            for (const item of dt.items) {
                if (item && item.kind === 'file') {
                    const f = item.getAsFile();
                    if (f && f.name) names.push(f.name);
                }
            }
        }
        if (names.length === 0) {
            const text = (dt.getData && dt.getData('text/plain')) || '';
            if (text) {
                for (const line of text.split(/[\r\n\t]+/)) {
                    const b = basename(line);
                    if (b) names.push(b);
                }
            }
        }
        return names;
    }

    function commit(names) {
        const pad = String(Math.max(names.length, 1)).length;
        const echo = names.map((n, i) => `[${String(i + 1).padStart(pad, ' ')}] ${n}`).join('\n');
        const out = names.join('\n');
        inputArea.value = echo;
        outputArea.value = out;
        placeholder.classList.toggle('hidden', names.length > 0);
        inputStat.textContent = names.length > 0 ? `已识别 ${names.length} 个项目` : '就绪';
        outputStat.textContent = `${names.length} 个文件名`;
        extractState.input = echo;
        extractState.output = out;
        extractState.count = names.length;
    }

    inputArea.addEventListener('paste', (e) => {
        e.preventDefault();
        const names = extractFromTransfer(e, 'paste');
        if (names.length > 0) {
            commit(names);
            toast(`已提取 ${names.length} 个文件名`);
        } else {
            toast('剪贴板未识别到文件或路径', 'error');
        }
    });
    inputArea.addEventListener('input', () => {
        placeholder.classList.toggle('hidden', !!inputArea.value);
        extractState.input = inputArea.value;
    });
    outputArea.addEventListener('input', () => {
        extractState.output = outputArea.value;
    });

    dropzone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', (e) => {
        if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('drag-over');
    });
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        const names = extractFromTransfer(e, 'drop');
        if (names.length > 0) {
            commit(names);
            toast(`已提取 ${names.length} 个文件名`);
        } else {
            toast('未识别到文件', 'error');
        }
    });

    document.getElementById('btn-clear-input').addEventListener('click', () => {
        commit([]);
        inputArea.focus();
    });
    document.getElementById('btn-clear-output').addEventListener('click', () => {
        outputArea.value = '';
        outputStat.textContent = '0 个文件名';
        extractState.output = '';
    });
    document.getElementById('btn-copy').addEventListener('click', async () => {
        const text = outputArea.value;
        if (!text) { toast('结果为空', 'error'); return; }
        try {
            await navigator.clipboard.writeText(text);
            const count = text.split('\n').filter(Boolean).length;
            toast(`已复制 ${count} 个文件名到剪贴板`);
        } catch (err) {
            outputArea.select();
            document.execCommand('copy');
            toast('已复制 (退化模式)');
        }
    });
}

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


// ============================================================
// 模块 4: Nuclei 验证 (任意 yaml 目录跑 nuclei -validate)
// 单页两段式: 顶部目录选择条 + 下方结果区. 跟 POC 转换页里那个内嵌验证按钮共享
// 后端方法 ValidateNucleiTemplates 和渲染函数 renderNucleiValidateResult,
// 区别是这里独立, 不需要先做 md→yaml 也不绑输出目录概念.
// ============================================================

const NUCLEI_VAL_KEY = 'nuclei_validator_state_v1';
// 跨页持久化: 上次选的目录 + 历史目录 (最多 6 条).
// 用 try/catch 包 localStorage, 部分场景下会抛 (无痕模式或权限问题).
function loadNucleiValState() {
    try {
        const raw = localStorage.getItem(NUCLEI_VAL_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { folder: '', history: [] };
}
function saveNucleiValState(s) {
    try { localStorage.setItem(NUCLEI_VAL_KEY, JSON.stringify(s)); } catch (e) {}
}
const nucleiValState = loadNucleiValState();

function renderNucleiValidator(container) {
    container.innerHTML = `
    <div class="nuclei-validator">
        <div class="extractor-tip">
            🛡️ 对任意 yaml 目录跑 <code>nuclei -validate</code>, 检查模板是否能被 nuclei 正确加载.
            选目录 → 点验证, 不需要先做 MD→YAML 转换.
        </div>
        <div class="nv-toolbar">
            <input type="text" class="yaml-path-input" id="nv-path"
                placeholder="点右侧选目录, 或粘贴绝对路径" spellcheck="false" />
            <button class="btn" id="nv-pick">选择目录</button>
            <button class="btn btn-primary" id="nv-run">▶️ 验证</button>
        </div>
        <div class="nv-history" id="nv-history"></div>
        <div class="nv-result" id="nv-result"></div>
    </div>`;
    setupNucleiValidator();
}

function setupNucleiValidator() {
    const elPath    = document.getElementById('nv-path');
    const elPick    = document.getElementById('nv-pick');
    const elRun     = document.getElementById('nv-run');
    const elHist    = document.getElementById('nv-history');
    const elResult  = document.getElementById('nv-result');

    elPath.value = nucleiValState.folder || '';

    function renderHistory() {
        if (!nucleiValState.history || nucleiValState.history.length === 0) {
            elHist.innerHTML = '';
            return;
        }
        elHist.innerHTML = `<span class="nv-hist-label">最近:</span>` +
            nucleiValState.history.map((p) =>
                `<button class="nv-hist-chip" title="${escapeHtml(p)}" data-path="${escapeHtml(p)}">${escapeHtml(shortPath(p))}</button>`
            ).join('');
        elHist.querySelectorAll('.nv-hist-chip').forEach((b) => {
            b.addEventListener('click', () => {
                const p = b.dataset.path;
                elPath.value = p;
                runValidate(p);
            });
        });
    }
    function shortPath(p) {
        // 路径太长压扁: /a/b/c/d/e/f.yml → ".../e/f.yml" (保留最后两段)
        const parts = p.split('/').filter(Boolean);
        if (parts.length <= 2) return p;
        return '…/' + parts.slice(-2).join('/');
    }
    function pushHistory(p) {
        const list = (nucleiValState.history || []).filter((x) => x !== p);
        list.unshift(p);
        nucleiValState.history = list.slice(0, 6);
        nucleiValState.folder = p;
        saveNucleiValState(nucleiValState);
        renderHistory();
    }
    renderHistory();

    elPick.addEventListener('click', async () => {
        try {
            const f = await SelectDirectory();
            if (!f) return;
            elPath.value = f;
            nucleiValState.folder = f;
            saveNucleiValState(nucleiValState);
        } catch (err) {
            toast(`选择失败: ${err}`, 'error');
        }
    });

    elPath.addEventListener('input', () => {
        nucleiValState.folder = elPath.value.trim();
        // 不每次输入都写, 用一个轻节流; 这里直接写也无所谓 (字符串小)
        saveNucleiValState(nucleiValState);
    });

    elRun.addEventListener('click', () => runValidate(elPath.value.trim()));

    // 回车直接验证, 习惯路径粘贴后按 Enter
    elPath.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runValidate(elPath.value.trim());
    });

    async function runValidate(folder) {
        if (!folder) {
            toast('请先选择或粘贴一个目录', 'error');
            return;
        }
        elRun.disabled = true;
        elPick.disabled = true;
        const oldLabel = elRun.textContent;
        elRun.textContent = '⏳ 验证中…';
        elResult.innerHTML = `<div class="yaml-empty">正在对 ${escapeHtml(folder)} 运行 nuclei -validate…</div>`;
        progressTracker.start('validate:progress', '运行 nuclei -validate');
        try {
            const r = await ValidateNucleiTemplates(folder);
            // autofix 完成后, 用同一个 folder 再跑一次 — 这正好就是 runValidate 自己
            renderNucleiValidateResult(elResult, r, folder, () => runValidate(folder));
            pushHistory(folder);
            if (r.ok) toast(`✅ 验证通过 (${r.elapsed})`);
            else toast(`⚠️ 验证有 ${r.errors.length} 个错误`, 'error');
        } catch (err) {
            const msg = String(err);
            elResult.innerHTML = `<div class="poc-validate-fail">❌ 无法运行 nuclei: ${escapeHtml(msg)}</div>`;
            toast(msg, 'error');
            progressTracker.stop();
        } finally {
            elRun.disabled = false;
            elPick.disabled = false;
            elRun.textContent = oldLabel;
        }
    }
}


// ============================================================
// 模块: 模板去重 (辅助模块 / 模板去重)
// ============================================================
//
// 工作流: 选源目录 → 扫描 (后端按 id ∪ canonical 文件名 union-find 分组) → 看分组卡片
//        → 每组默认勾选除首个外的全部 → 选目标目录 → 移动 (默认 rename 兜冲突).
//
// 跨页持久化:
//   folder       — 上次扫的源目录
//   targetDir    — 上次选的目标目录
//   onConflict   — 上次选的冲突策略 ("rename" / "skip" / "overwrite")
//   lastResult   — 上次扫描的结果 (DupScanResult), 切回页面能直接看, 不用重扫
//   selection    — Set<path> 用户的勾选状态 (路径 -> 选中)
//
// 跟 nuclei-validator 同款骨架 (toolbar / history-chips / result-area), 视觉上保持一致.

function loadDedupState() {
    try {
        const raw = localStorage.getItem('doperationtool.dedup');
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) { return null; }
}
function saveDedupState(s) {
    try {
        const cp = { ...s };
        // selection / lastResult 在大目录场景 (1w 组级) 序列化能轻松撑过 localStorage 配额 (5-10MB), 直接 quota exceeded.
        // 阈值 (5000 文件) 内存里仍保留, 只是不持久化, 切页回来要重扫. 比卡死强得多.
        const selSize = (s.selection && s.selection.size) || 0;
        cp.selection = selSize > 5000 ? [] : Array.from(s.selection || []);
        const lr = s.lastResult;
        const totalTpl = lr && Array.isArray(lr.groups)
            ? lr.groups.reduce((a, g) => a + (g.templates ? g.templates.length : 0), 0)
            : 0;
        if (totalTpl > 5000) cp.lastResult = null;
        localStorage.setItem('doperationtool.dedup', JSON.stringify(cp));
    } catch (e) { /* quota / 序列化失败都忽略 */ }
}

const dedupState = (() => {
    const loaded = loadDedupState();
    return {
        folder:     loaded?.folder || '',
        targetDir:  loaded?.targetDir || '',
        onConflict: loaded?.onConflict || 'rename',
        history:    Array.isArray(loaded?.history) ? loaded.history : [],
        targetHist: Array.isArray(loaded?.targetHist) ? loaded.targetHist : [],
        lastResult: loaded?.lastResult || null,
        selection:  new Set(Array.isArray(loaded?.selection) ? loaded.selection : []),
    };
})();

function renderTemplateDedup(container) {
    container.innerHTML = `
    <div class="template-dedup">
        <div class="extractor-tip">
            🧹 扫描目录, 按 <b>顶层 <code>id</code></b> 与 <b>canonical 文件名</b> (剥 <code>(copy)</code> / <code>_数字</code> 后缀)
            判定 "同一漏洞", 把多余的副本搬到指定目录. 不删, 随时可恢复.
        </div>
        <div class="nv-toolbar">
            <input type="text" class="yaml-path-input" id="dd-src"
                placeholder="源目录: 点右侧选, 或粘贴绝对路径" spellcheck="false" />
            <button class="btn" id="dd-pick-src">选择源目录</button>
            <button class="btn btn-primary" id="dd-scan">▶️ 扫描重复</button>
        </div>
        <div class="nv-history" id="dd-src-hist"></div>
        <div class="dd-summary" id="dd-summary"></div>
        <div class="dd-actionbar" id="dd-actionbar"></div>
        <div class="nv-toolbar dd-target-bar" id="dd-target-bar" style="display:none">
            <input type="text" class="yaml-path-input" id="dd-tgt"
                placeholder="目标目录 (重复文件搬到这里, 不存在自动创建)" spellcheck="false" />
            <button class="btn" id="dd-pick-tgt">选择目标目录</button>
            <select class="dd-conflict" id="dd-conflict" title="同名冲突时的处理策略">
                <option value="rename">同名 → 重命名 (_dup_N)</option>
                <option value="skip">同名 → 跳过</option>
                <option value="overwrite">同名 → 覆盖</option>
            </select>
            <button class="btn btn-primary" id="dd-move">📦 移动选中</button>
        </div>
        <div class="nv-history" id="dd-tgt-hist"></div>
        <div class="dd-result" id="dd-result"></div>
    </div>`;
    setupTemplateDedup();
}

function setupTemplateDedup() {
    const elSrc       = document.getElementById('dd-src');
    const elTgt       = document.getElementById('dd-tgt');
    const elPickSrc   = document.getElementById('dd-pick-src');
    const elPickTgt   = document.getElementById('dd-pick-tgt');
    const elScan      = document.getElementById('dd-scan');
    const elMove      = document.getElementById('dd-move');
    const elConflict  = document.getElementById('dd-conflict');
    const elSrcHist   = document.getElementById('dd-src-hist');
    const elTgtHist   = document.getElementById('dd-tgt-hist');
    const elSummary   = document.getElementById('dd-summary');
    const elActionBar = document.getElementById('dd-actionbar');
    const elTargetBar = document.getElementById('dd-target-bar');
    const elResult    = document.getElementById('dd-result');

    elSrc.value = dedupState.folder;
    elTgt.value = dedupState.targetDir;
    elConflict.value = dedupState.onConflict;

    function pushHist(arr, p, max = 6) {
        const list = (arr || []).filter((x) => x !== p);
        list.unshift(p);
        return list.slice(0, max);
    }
    function shortPath(p) {
        const parts = p.split('/').filter(Boolean);
        if (parts.length <= 2) return p;
        return '…/' + parts.slice(-2).join('/');
    }
    function renderHistChips(container, list, onPick) {
        if (!list || list.length === 0) { container.innerHTML = ''; return; }
        container.innerHTML = `<span class="nv-hist-label">最近:</span>` +
            list.map((p) =>
                `<button class="nv-hist-chip" title="${escapeHtml(p)}" data-path="${escapeHtml(p)}">${escapeHtml(shortPath(p))}</button>`
            ).join('');
        container.querySelectorAll('.nv-hist-chip').forEach((b) => {
            b.addEventListener('click', () => onPick(b.dataset.path));
        });
    }
    renderHistChips(elSrcHist, dedupState.history, (p) => { elSrc.value = p; runScan(p); });
    renderHistChips(elTgtHist, dedupState.targetHist, (p) => { elTgt.value = p; dedupState.targetDir = p; saveDedupState(dedupState); });

    // 还原上次扫描结果, 切回页面能直接看
    if (dedupState.lastResult) {
        renderScanResult(dedupState.lastResult);
    } else {
        elResult.innerHTML = `<div class="yaml-empty">扫描结果会显示在这里</div>`;
    }

    // ---- 输入 / 选目录 ----
    elPickSrc.addEventListener('click', async () => {
        try {
            const f = await SelectDirectory();
            if (!f) return;
            elSrc.value = f;
            dedupState.folder = f;
            saveDedupState(dedupState);
        } catch (err) { toast(`选择失败: ${err}`, 'error'); }
    });
    elPickTgt.addEventListener('click', async () => {
        try {
            const f = await SelectDirectory();
            if (!f) return;
            elTgt.value = f;
            dedupState.targetDir = f;
            saveDedupState(dedupState);
        } catch (err) { toast(`选择失败: ${err}`, 'error'); }
    });
    elSrc.addEventListener('input', () => { dedupState.folder = elSrc.value.trim(); saveDedupState(dedupState); });
    elTgt.addEventListener('input', () => { dedupState.targetDir = elTgt.value.trim(); saveDedupState(dedupState); });
    elSrc.addEventListener('keydown', (e) => { if (e.key === 'Enter') runScan(elSrc.value.trim()); });
    elScan.addEventListener('click', () => runScan(elSrc.value.trim()));
    elMove.addEventListener('click', () => runMove());
    elConflict.addEventListener('change', () => {
        dedupState.onConflict = elConflict.value;
        saveDedupState(dedupState);
    });

    // ---- 扫描 ----
    async function runScan(folder) {
        if (!folder) { toast('请先选择或粘贴源目录', 'error'); return; }
        elScan.disabled = true;
        const oldLabel = elScan.textContent;
        elScan.textContent = '⏳ 扫描中…';
        elResult.innerHTML = `<div class="yaml-empty">正在扫描 ${escapeHtml(folder)} …</div>`;
        elSummary.innerHTML = '';
        elActionBar.innerHTML = '';
        elTargetBar.style.display = 'none';
        progressTracker.start('dedup:progress', '扫描重复模板');
        try {
            const r = await ScanDuplicateTemplates(folder);
            dedupState.lastResult = r;
            dedupState.history = pushHist(dedupState.history, folder);
            // 默认选中: 每组除首个外全部勾选
            dedupState.selection = new Set();
            (r.groups || []).forEach((g) => {
                (g.templates || []).forEach((t, idx) => {
                    if (idx > 0) dedupState.selection.add(t.path);
                });
            });
            saveDedupState(dedupState);
            renderHistChips(elSrcHist, dedupState.history, (p) => { elSrc.value = p; runScan(p); });
            renderScanResult(r);
            const dups = r.duplicateCount || 0;
            const groups = (r.groups || []).length;
            if (groups === 0) toast(`✅ 没有发现重复 (扫描 ${r.total} 个文件, ${r.elapsed})`);
            else toast(`找到 ${groups} 组 / ${dups} 个冗余 (${r.elapsed})`);
        } catch (err) {
            elResult.innerHTML = `<div class="poc-validate-fail">❌ 扫描失败: ${escapeHtml(String(err))}</div>`;
            toast(String(err), 'error');
            progressTracker.stop();
        } finally {
            elScan.disabled = false;
            elScan.textContent = oldLabel;
            // 不主动 stop: 后端 emit Done=true 后 tracker 自己 800ms 收尾, 让用户看见 100%.
            // 但出错路径上面已 stop, 防止卡片残留.
        }
    }

    // ---- 渲染扫描结果 ----
    function renderScanResult(r) {
        const groups = Array.isArray(r.groups) ? r.groups : [];
        const total = r.total || 0;
        const dups = r.duplicateCount || 0;

        if (groups.length === 0) {
            elSummary.innerHTML = `<div class="poc-validate-pass">✅ 没有发现重复 · 扫描 ${total} 个文件 · ${escapeHtml(r.elapsed || '')}</div>`;
            elActionBar.innerHTML = '';
            elTargetBar.style.display = 'none';
            elResult.innerHTML = `<div class="yaml-empty">该目录下没有重复模板</div>`;
            return;
        }

        elSummary.innerHTML = `
          <div class="dd-summary-line">
            🔍 扫描 <b>${total}</b> 个文件 · 找到 <b>${groups.length}</b> 个重复组 ·
            <span class="dd-warn">${dups}</span> 个冗余可移动 · ${escapeHtml(r.elapsed || '')}
          </div>`;

        elActionBar.innerHTML = `
          <button class="btn btn-tiny" data-act="select-all">全选所有冗余</button>
          <button class="btn btn-tiny" data-act="select-none">全部取消</button>
          <button class="btn btn-tiny" data-act="invert">反选</button>
          <span class="dd-sel-count" id="dd-sel-count"></span>`;
        elActionBar.querySelector('[data-act=select-all]').addEventListener('click', () => {
            groups.forEach((g) => g.templates.forEach((t, i) => { if (i > 0) dedupState.selection.add(t.path); }));
            saveDedupState(dedupState);
            updateSelectionUI();
            syncCheckboxesFromSelection();
        });
        elActionBar.querySelector('[data-act=select-none]').addEventListener('click', () => {
            dedupState.selection = new Set();
            saveDedupState(dedupState);
            updateSelectionUI();
            syncCheckboxesFromSelection();
        });
        elActionBar.querySelector('[data-act=invert]').addEventListener('click', () => {
            groups.forEach((g) => g.templates.forEach((t) => {
                if (dedupState.selection.has(t.path)) dedupState.selection.delete(t.path);
                else dedupState.selection.add(t.path);
            }));
            saveDedupState(dedupState);
            updateSelectionUI();
            syncCheckboxesFromSelection();
        });

        elTargetBar.style.display = '';

        // 渲染分组卡片
        const reasonLabel = (rs) => ({
            'id': '同 id', 'name': '同文件名',
            'id+name': '同 id 且同文件名', 'transitive': '通过 id/名 间接关联',
        }[rs] || rs);
        const buildGroupHtml = (g, gi) => {
            const headTags = [];
            if (g.sharedIds && g.sharedIds.length) {
                headTags.push(`<span class="dd-tag dd-tag-id" title="组内出现的 id">id: ${g.sharedIds.map(escapeHtml).join(', ')}</span>`);
            }
            if (g.sharedNames && g.sharedNames.length) {
                headTags.push(`<span class="dd-tag dd-tag-name" title="组内出现的 canonical 文件名">name: ${g.sharedNames.map(escapeHtml).join(', ')}</span>`);
            }
            const rows = (g.templates || []).map((t, ti) => {
                const checked = dedupState.selection.has(t.path);
                const isFirst = ti === 0;
                const badge = isFirst
                    ? `<span class="dd-badge dd-badge-keep" title="默认保留">保留</span>`
                    : `<span class="dd-badge dd-badge-dup" title="默认作为冗余移走">冗余</span>`;
                return `
                <li class="dd-row${isFirst ? ' dd-row-first' : ''}">
                    <input type="checkbox" class="dd-check" data-path="${escapeHtml(t.path)}" ${checked ? 'checked' : ''} />
                    ${badge}
                    <span class="dd-name" title="${escapeHtml(t.path)}">${escapeHtml(t.name)}</span>
                    <span class="dd-rel" title="${escapeHtml(t.relPath)}">${escapeHtml(t.relPath)}</span>
                    <span class="dd-meta">id: <code>${escapeHtml(t.id || '—')}</code> · ${formatBytes(t.size)}</span>
                    <button class="dd-reveal" data-path="${escapeHtml(t.path)}" title="在文件管理器中显示">📂</button>
                </li>`;
            }).join('');
            return `
            <div class="dd-group" data-gi="${gi}">
                <div class="dd-group-head">
                    <span class="dd-group-key" title="该组的标签 (id 优先, 否则 canonical 文件名)">${escapeHtml(g.groupKey || '?')}</span>
                    <span class="dd-group-reason" title="判定依据">${reasonLabel(g.reason)}</span>
                    <span class="dd-group-count">${(g.templates || []).length} 个</span>
                    ${headTags.join(' ')}
                </div>
                <ul class="dd-group-list">${rows}</ul>
            </div>`;
        };

        // 分批渲染: 1 万组 (~3 万行) 一次性 innerHTML 注入会冻死主线程几十秒.
        // 默认前 INITIAL_BATCH 立即显示, 多余的塞 "加载更多" 按钮按需 append.
        // 每批渲染完用 requestAnimationFrame 让浏览器有机会处理事件 / 重绘 / 滚动.
        const INITIAL_BATCH = 200;
        const CHUNK_SIZE = 500;
        let renderedCount = 0;
        elResult.innerHTML = '';

        function appendBatch(n) {
            const slice = groups.slice(renderedCount, renderedCount + n);
            if (slice.length === 0) return;
            // 用 DocumentFragment + insertAdjacentHTML 比 += innerHTML 快得多 (避免重新解析整片)
            const html = slice.map((g, i) => buildGroupHtml(g, renderedCount + i)).join('');
            const more = document.getElementById('dd-load-more');
            if (more) more.remove();
            elResult.insertAdjacentHTML('beforeend', html);
            renderedCount += slice.length;
            if (renderedCount < groups.length) {
                const btn = document.createElement('button');
                btn.id = 'dd-load-more';
                btn.className = 'btn btn-tiny dd-load-more';
                btn.textContent = `▼ 加载剩余 ${groups.length - renderedCount} 组 (每次 ${CHUNK_SIZE})`;
                btn.addEventListener('click', () => {
                    btn.disabled = true;
                    btn.textContent = '⏳ 加载中…';
                    requestAnimationFrame(() => appendBatch(CHUNK_SIZE));
                });
                elResult.appendChild(btn);
            }
        }
        appendBatch(INITIAL_BATCH);

        // 事件委托: 把 1.6w checkbox + 1.6w reveal-btn 的 listener 注册压成单一委托.
        // 必须用 elResult._delegated 标志位防止 setupTemplateDedup 切回页面后重复挂.
        if (!elResult._dedupDelegated) {
            elResult.addEventListener('change', (e) => {
                const cb = e.target.closest && e.target.closest('.dd-check');
                if (!cb || !elResult.contains(cb)) return;
                const p = cb.dataset.path;
                if (cb.checked) dedupState.selection.add(p);
                else dedupState.selection.delete(p);
                saveDedupState(dedupState);
                updateSelectionUI();
            });
            elResult.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('.dd-reveal');
                if (!b || !elResult.contains(b)) return;
                e.preventDefault();
                RevealInFileManager(b.dataset.path).catch((err) => toast(`无法打开: ${err}`, 'error'));
            });
            elResult._dedupDelegated = true;
        }

        updateSelectionUI();
    }

    function updateSelectionUI() {
        const cnt = dedupState.selection.size;
        const elC = document.getElementById('dd-sel-count');
        if (elC) elC.textContent = cnt > 0 ? `已选 ${cnt} 个待移动` : '未选中任何文件';
        elMove.disabled = cnt === 0;
        // 注意: 单条 checkbox 切换时它自己已经是正确的 checked 状态, 不需要全量同步 DOM.
        // 全选/反选/全不选 这种"批量改 selection"的操作得另外调 syncCheckboxesFromSelection().
    }

    // 全选/反选/全不选 后, 把所有可见 checkbox 跟 dedupState.selection 对齐.
    // HTMLCollection (live) + 直接赋值 .checked, 比 querySelectorAll + forEach 快.
    function syncCheckboxesFromSelection() {
        const all = elResult.getElementsByClassName('dd-check');
        for (let i = 0; i < all.length; i++) {
            const cb = all[i];
            const want = dedupState.selection.has(cb.dataset.path);
            if (cb.checked !== want) cb.checked = want;
        }
    }

    // ---- 移动 ----
    async function runMove() {
        const tgt = elTgt.value.trim();
        if (!tgt) { toast('请先选择或粘贴目标目录', 'error'); return; }
        const paths = Array.from(dedupState.selection);
        if (paths.length === 0) { toast('未选中任何文件', 'error'); return; }
        const policy = elConflict.value;

        // dry-run 预览 (走一次进度条, 通常很快)
        let preview;
        progressTracker.start('dedup:progress', '预览移动 (dry-run)');
        try {
            preview = await MoveTemplateDuplicates({
                paths, targetDir: tgt, dryRun: true, onConflict: policy,
            });
        } catch (err) {
            progressTracker.stop();
            toast(`预览失败: ${err}`, 'error');
            return;
        }

        const willMove = preview.moved || 0;
        const willSkip = preview.skipped || 0;
        const renamePreview = (preview.items || []).filter((it) => !it.skipped && it.dstPath && it.dstPath.split('/').pop() !== it.srcPath.split('/').pop());
        const summary = `将搬走 ${willMove} 个, 跳过 ${willSkip} 个; 其中 ${renamePreview.length} 个会因同名冲突被重命名 (策略: ${policy}).`;

        if (!confirm(`${summary}\n\n目标目录: ${tgt}\n\n继续吗?`)) return;

        // 真跑
        elMove.disabled = true;
        const oldLabel = elMove.textContent;
        elMove.textContent = '⏳ 移动中…';
        progressTracker.start('dedup:progress', '移动重复模板');
        try {
            const r = await MoveTemplateDuplicates({
                paths, targetDir: tgt, dryRun: false, onConflict: policy,
            });
            dedupState.targetHist = pushHist(dedupState.targetHist, r.targetDir || tgt);
            saveDedupState(dedupState);
            renderHistChips(elTgtHist, dedupState.targetHist, (p) => { elTgt.value = p; dedupState.targetDir = p; saveDedupState(dedupState); });
            const moved = r.moved || 0;
            const skipped = r.skipped || 0;
            toast(`✅ 移动完成: ${moved} 个搬走 · ${skipped} 个跳过 · ${r.elapsed || ''}`, skipped > 0 ? 'error' : 'success');
            // 重新扫一遍, 让分组刷新 (移走后冗余应当少了)
            await runScan(elSrc.value.trim());
        } catch (err) {
            toast(`移动失败: ${err}`, 'error');
            progressTracker.stop();
        } finally {
            elMove.disabled = false;
            elMove.textContent = oldLabel;
        }
    }
}


// ============================================================
// 模块: 模板分类 (辅助模块 / 模板分类)
// ============================================================
//
// 工作流: 选源目录 → 扫描 (后端按 token 提取 + 前缀合并自动分组)
//        → 看分组卡片 (可重命名 / 合并 / 排除) → 选目标目录 → 应用分类 → 后端搬到 targetDir/<分类>/
//
// 跨页持久化:
//   folder, targetDir, onConflict — 同去重页风格
//   lastResult                     — 上次扫描结果, 切回页面立刻看
//   overrides                      — Map<原分类名 → 用户改后的分类名>; 跟着 lastResult 一起存
//   excluded                       — Set<file path> 用户主动排除的文件 (不参与本次应用)
//
// UI 同款骨架: extractor-tip / nv-toolbar / nv-history / dd-result.

function loadClassifyState() {
    try {
        const raw = localStorage.getItem('doperationtool.classify');
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) { return null; }
}
function saveClassifyState(s) {
    try {
        const cp = {
            ...s,
            overrides: s.overrides ? Object.fromEntries(s.overrides) : {},
        };
        // excluded 和 lastResult 大目录会撑爆 localStorage, 跟 dedup 同样阈值.
        const excSize = (s.excluded && s.excluded.size) || 0;
        cp.excluded = excSize > 5000 ? [] : Array.from(s.excluded || []);
        const lr = s.lastResult;
        const totalFiles = lr
            ? ((Array.isArray(lr.categories) ? lr.categories.reduce((a, c) => a + ((c.files && c.files.length) || 0), 0) : 0)
              + (Array.isArray(lr.uncategorized) ? lr.uncategorized.length : 0))
            : 0;
        if (totalFiles > 5000) cp.lastResult = null;
        localStorage.setItem('doperationtool.classify', JSON.stringify(cp));
    } catch (e) { /* quota / 序列化失败都忽略 */ }
}

const classifyState = (() => {
    const loaded = loadClassifyState();
    return {
        folder:     loaded?.folder || '',
        targetDir:  loaded?.targetDir || '',
        onConflict: loaded?.onConflict || 'rename',
        history:    Array.isArray(loaded?.history) ? loaded.history : [],
        targetHist: Array.isArray(loaded?.targetHist) ? loaded.targetHist : [],
        lastResult: loaded?.lastResult || null,
        overrides:  new Map(Object.entries(loaded?.overrides || {})),
        excluded:   new Set(Array.isArray(loaded?.excluded) ? loaded.excluded : []),
    };
})();

function renderTemplateClassify(container) {
    container.innerHTML = `
    <div class="template-classify">
        <div class="extractor-tip">
            🗂️ 扫描目录, 按 <b>文件名 / id 主词</b> 自动归类 (例 <code>adobe</code> / <code>adobecq</code> / <code>adobe-experience</code> 合并为 <b>adobe</b>).
            可在卡片上重命名 / 排除 / 把多类合并到一个目录, 然后整体搬到目标目录的子文件夹.
        </div>
        <div class="nv-toolbar">
            <input type="text" class="yaml-path-input" id="cls-src"
                placeholder="源目录: 点右侧选, 或粘贴绝对路径" spellcheck="false" />
            <button class="btn" id="cls-pick-src">选择源目录</button>
            <button class="btn btn-primary" id="cls-scan">▶️ 扫描分类</button>
        </div>
        <div class="nv-history" id="cls-src-hist"></div>
        <div class="dd-summary" id="cls-summary"></div>
        <div class="nv-toolbar dd-target-bar" id="cls-target-bar" style="display:none">
            <input type="text" class="yaml-path-input" id="cls-tgt"
                placeholder="目标目录 (会在下面自动建 <分类>/ 子文件夹)" spellcheck="false" />
            <button class="btn" id="cls-pick-tgt">选择目标目录</button>
            <select class="dd-conflict" id="cls-conflict" title="同名冲突时的处理策略">
                <option value="rename">同名 → 重命名 (_dup_N)</option>
                <option value="skip">同名 → 跳过</option>
                <option value="overwrite">同名 → 覆盖</option>
            </select>
            <button class="btn btn-primary" id="cls-apply">📂 应用分类</button>
        </div>
        <div class="nv-history" id="cls-tgt-hist"></div>
        <div class="dd-result" id="cls-result"></div>
    </div>`;
    setupTemplateClassify();
}

function setupTemplateClassify() {
    const elSrc       = document.getElementById('cls-src');
    const elTgt       = document.getElementById('cls-tgt');
    const elPickSrc   = document.getElementById('cls-pick-src');
    const elPickTgt   = document.getElementById('cls-pick-tgt');
    const elScan      = document.getElementById('cls-scan');
    const elApply     = document.getElementById('cls-apply');
    const elConflict  = document.getElementById('cls-conflict');
    const elSrcHist   = document.getElementById('cls-src-hist');
    const elTgtHist   = document.getElementById('cls-tgt-hist');
    const elSummary   = document.getElementById('cls-summary');
    const elTargetBar = document.getElementById('cls-target-bar');
    const elResult    = document.getElementById('cls-result');

    elSrc.value = classifyState.folder;
    elTgt.value = classifyState.targetDir;
    elConflict.value = classifyState.onConflict;

    function pushHist(arr, p, max = 6) {
        const list = (arr || []).filter((x) => x !== p);
        list.unshift(p);
        return list.slice(0, max);
    }
    function shortPath(p) {
        const parts = p.split('/').filter(Boolean);
        if (parts.length <= 2) return p;
        return '…/' + parts.slice(-2).join('/');
    }
    function renderHistChips(container, list, onPick) {
        if (!list || list.length === 0) { container.innerHTML = ''; return; }
        container.innerHTML = `<span class="nv-hist-label">最近:</span>` +
            list.map((p) =>
                `<button class="nv-hist-chip" title="${escapeHtml(p)}" data-path="${escapeHtml(p)}">${escapeHtml(shortPath(p))}</button>`
            ).join('');
        container.querySelectorAll('.nv-hist-chip').forEach((b) => {
            b.addEventListener('click', () => onPick(b.dataset.path));
        });
    }
    renderHistChips(elSrcHist, classifyState.history, (p) => { elSrc.value = p; runScan(p); });
    renderHistChips(elTgtHist, classifyState.targetHist, (p) => { elTgt.value = p; classifyState.targetDir = p; saveClassifyState(classifyState); });

    if (classifyState.lastResult) {
        renderScanResult(classifyState.lastResult);
    } else {
        elResult.innerHTML = `<div class="yaml-empty">扫描结果会显示在这里</div>`;
    }

    // ---- 输入 / 选目录 ----
    elPickSrc.addEventListener('click', async () => {
        try {
            const f = await SelectDirectory();
            if (!f) return;
            elSrc.value = f;
            classifyState.folder = f;
            saveClassifyState(classifyState);
        } catch (err) { toast(`选择失败: ${err}`, 'error'); }
    });
    elPickTgt.addEventListener('click', async () => {
        try {
            const f = await SelectDirectory();
            if (!f) return;
            elTgt.value = f;
            classifyState.targetDir = f;
            saveClassifyState(classifyState);
        } catch (err) { toast(`选择失败: ${err}`, 'error'); }
    });
    elSrc.addEventListener('input', () => { classifyState.folder = elSrc.value.trim(); saveClassifyState(classifyState); });
    elTgt.addEventListener('input', () => { classifyState.targetDir = elTgt.value.trim(); saveClassifyState(classifyState); });
    elSrc.addEventListener('keydown', (e) => { if (e.key === 'Enter') runScan(elSrc.value.trim()); });
    elScan.addEventListener('click', () => runScan(elSrc.value.trim()));
    elApply.addEventListener('click', () => runApply());
    elConflict.addEventListener('change', () => {
        classifyState.onConflict = elConflict.value;
        saveClassifyState(classifyState);
    });

    // ---- 扫描 ----
    async function runScan(folder) {
        if (!folder) { toast('请先选择或粘贴源目录', 'error'); return; }
        elScan.disabled = true;
        const oldLabel = elScan.textContent;
        elScan.textContent = '⏳ 扫描中…';
        elResult.innerHTML = `<div class="yaml-empty">正在扫描 ${escapeHtml(folder)} …</div>`;
        elSummary.innerHTML = '';
        elTargetBar.style.display = 'none';
        try {
            const r = await ScanTemplateCategories(folder);
            classifyState.lastResult = r;
            classifyState.history = pushHist(classifyState.history, folder);
            // 重置编辑态: 新结果 → 清掉旧的覆盖映射 / 排除集
            classifyState.overrides = new Map();
            classifyState.excluded = new Set();
            saveClassifyState(classifyState);
            renderHistChips(elSrcHist, classifyState.history, (p) => { elSrc.value = p; runScan(p); });
            renderScanResult(r);
            const cats = (r.categories || []).length;
            const unc = (r.uncategorized || []).length;
            toast(`扫描完成: ${cats} 个分类 · ${unc} 个无法分类 · ${r.elapsed || ''}`);
        } catch (err) {
            elResult.innerHTML = `<div class="poc-validate-fail">❌ 扫描失败: ${escapeHtml(String(err))}</div>`;
            toast(String(err), 'error');
        } finally {
            elScan.disabled = false;
            elScan.textContent = oldLabel;
        }
    }

    // ---- 用户改后的最终分类名 ----
    function effectiveName(origName) {
        const o = classifyState.overrides.get(origName);
        return (o && o.trim()) ? o.trim() : origName;
    }

    // ---- 渲染 ----
    function renderScanResult(r) {
        const cats = Array.isArray(r.categories) ? r.categories : [];
        const unc  = Array.isArray(r.uncategorized) ? r.uncategorized : [];
        const total = r.total || 0;

        if (cats.length === 0 && unc.length === 0) {
            elSummary.innerHTML = `<div class="yaml-empty">目录里没有 yaml/yml 文件</div>`;
            elTargetBar.style.display = 'none';
            elResult.innerHTML = '';
            return;
        }

        elSummary.innerHTML = `
          <div class="dd-summary-line">
            🔍 扫描 <b>${total}</b> 个文件 · 推断出 <b>${cats.length}</b> 个分类 ·
            <span class="dd-warn">${unc.length}</span> 个无法分类 · ${escapeHtml(r.elapsed || '')}
          </div>`;
        elTargetBar.style.display = '';

        // 渲染分类卡片
        const renderCard = (c) => {
            const eff = effectiveName(c.name);
            const fileCount = (c.files || []).filter((f) => !classifyState.excluded.has(f.path)).length;
            const tokens = (c.tokens || []).map(escapeHtml).join(', ');
            const filesHtml = (c.files || []).map((f) => {
                const ex = classifyState.excluded.has(f.path);
                return `
                <li class="cls-file${ex ? ' cls-file-excluded' : ''}">
                    <input type="checkbox" class="cls-file-check" data-path="${escapeHtml(f.path)}" ${ex ? '' : 'checked'} />
                    <span class="cls-file-name" title="${escapeHtml(f.path)}">${escapeHtml(f.name)}</span>
                    <span class="cls-file-token" title="提取出的分类 token">${escapeHtml(f.token || '—')}</span>
                    <span class="cls-file-rel" title="${escapeHtml(f.relPath)}">${escapeHtml(f.relPath)}</span>
                    <button class="dd-reveal" data-path="${escapeHtml(f.path)}" title="在文件管理器中显示">📂</button>
                </li>`;
            }).join('');
            return `
            <div class="cls-card" data-orig="${escapeHtml(c.name)}">
                <div class="cls-card-head">
                    <input type="text" class="cls-name-input" data-orig="${escapeHtml(c.name)}"
                        value="${escapeHtml(eff)}" title="编辑分类名 (会作为目标目录下的子文件夹名)" />
                    <span class="cls-card-count" data-count-for="${escapeHtml(c.name)}">${fileCount} / ${(c.files || []).length} 个</span>
                    <span class="cls-card-tokens" title="该分类下出现过的原始 token">tokens: ${tokens}</span>
                    <div class="cls-card-actions">
                        <button class="btn btn-tiny" data-act="select-all">全选</button>
                        <button class="btn btn-tiny" data-act="select-none">全不选</button>
                        <button class="btn btn-tiny" data-act="merge" title="把这个分类的文件并入另一个分类">↪ 合并到…</button>
                    </div>
                </div>
                <ul class="cls-file-list">${filesHtml}</ul>
            </div>`;
        };

        const uncCard = unc.length > 0 ? (() => {
            const eff = effectiveName('__uncategorized__');
            const fileCount = unc.filter((f) => !classifyState.excluded.has(f.path)).length;
            const filesHtml = unc.map((f) => {
                const ex = classifyState.excluded.has(f.path);
                return `
                <li class="cls-file${ex ? ' cls-file-excluded' : ''}">
                    <input type="checkbox" class="cls-file-check" data-path="${escapeHtml(f.path)}" ${ex ? '' : 'checked'} />
                    <span class="cls-file-name" title="${escapeHtml(f.path)}">${escapeHtml(f.name)}</span>
                    <span class="cls-file-token">—</span>
                    <span class="cls-file-rel" title="${escapeHtml(f.relPath)}">${escapeHtml(f.relPath)}</span>
                    <button class="dd-reveal" data-path="${escapeHtml(f.path)}" title="在文件管理器中显示">📂</button>
                </li>`;
            }).join('');
            return `
            <div class="cls-card cls-card-unc" data-orig="__uncategorized__">
                <div class="cls-card-head">
                    <input type="text" class="cls-name-input" data-orig="__uncategorized__"
                        value="${escapeHtml(eff)}" title="无法分类的文件会进这个目录" />
                    <span class="cls-card-count" data-count-for="__uncategorized__">${fileCount} / ${unc.length} 个</span>
                    <span class="cls-card-tokens">无法从文件名/id 抽出有效 token</span>
                    <div class="cls-card-actions">
                        <button class="btn btn-tiny" data-act="select-all">全选</button>
                        <button class="btn btn-tiny" data-act="select-none">全不选</button>
                        <button class="btn btn-tiny" data-act="merge">↪ 合并到…</button>
                    </div>
                </div>
                <ul class="cls-file-list">${filesHtml}</ul>
            </div>`;
        })() : '';

        // 整片一次性 innerHTML 注入: 分类数 (cats) 通常 <数百, 跟 dedup 不同, 不需要分批.
        // 但如果某个分类下有上千文件, 文件 row 数能轻易上万 — 后面的事件绑定如果还按
        // querySelectorAll forEach 给每个 row 单独 addEventListener, 同样会卡死.
        // 改成单次委托.
        elResult.innerHTML = cats.map(renderCard).join('') + uncCard;

        // 事件委托: input(重命名) / change(checkbox) / click(reveal & 卡片三按钮) 各挂一次.
        if (!elResult._classifyDelegated) {
            elResult.addEventListener('input', (e) => {
                const inp = e.target.closest && e.target.closest('.cls-name-input');
                if (!inp || !elResult.contains(inp)) return;
                const orig = inp.dataset.orig;
                const v = inp.value.trim();
                if (v && v !== orig) classifyState.overrides.set(orig, v);
                else classifyState.overrides.delete(orig);
                saveClassifyState(classifyState);
            });
            elResult.addEventListener('change', (e) => {
                const cb = e.target.closest && e.target.closest('.cls-file-check');
                if (!cb || !elResult.contains(cb)) return;
                const p = cb.dataset.path;
                if (cb.checked) classifyState.excluded.delete(p);
                else classifyState.excluded.add(p);
                const li = cb.closest('.cls-file');
                if (li) li.classList.toggle('cls-file-excluded', !cb.checked);
                saveClassifyState(classifyState);
                updateCounts();
            });
            elResult.addEventListener('click', (e) => {
                // reveal 按钮
                const rev = e.target.closest && e.target.closest('.dd-reveal');
                if (rev && elResult.contains(rev)) {
                    e.preventDefault();
                    RevealInFileManager(rev.dataset.path).catch((err) => toast(`无法打开: ${err}`, 'error'));
                    return;
                }
                // 卡片操作 (全选/全不选/合并) 按 data-act 分发
                const act = e.target.closest && e.target.closest('[data-act]');
                if (!act || !elResult.contains(act)) return;
                const card = act.closest('.cls-card');
                if (!card) return;
                const orig = card.dataset.orig;
                const action = act.dataset.act;
                if (action === 'merge') {
                    mergeIntoPrompt(orig);
                    return;
                }
                if (action === 'select-all' || action === 'select-none') {
                    const checked = action === 'select-all';
                    // 对当前卡片的所有 file checkbox 批量改, 用 HTMLCollection 比 querySelectorAll 快
                    const checks = card.getElementsByClassName('cls-file-check');
                    for (let i = 0; i < checks.length; i++) {
                        const cb = checks[i];
                        const p = cb.dataset.path;
                        if (cb.checked !== checked) cb.checked = checked;
                        if (checked) classifyState.excluded.delete(p);
                        else classifyState.excluded.add(p);
                        const li = cb.closest('.cls-file');
                        if (li) li.classList.toggle('cls-file-excluded', !checked);
                    }
                    saveClassifyState(classifyState);
                    updateCounts();
                }
            });
            elResult._classifyDelegated = true;
        }
    }

    // 把 origCat 这一类整体改名到另一个 effective name (合并). 实际只是把 overrides[orig]=newName.
    function mergeIntoPrompt(orig) {
        // 收集所有候选分类名 (effective)
        const r = classifyState.lastResult;
        if (!r) return;
        const allNames = [...(r.categories || []).map((c) => effectiveName(c.name))];
        if ((r.uncategorized || []).length > 0) allNames.push(effectiveName('__uncategorized__'));
        const myEff = effectiveName(orig);
        const others = allNames.filter((n) => n !== myEff);
        if (others.length === 0) {
            toast('没有其它分类可合并', 'error');
            return;
        }
        const target = prompt(
            `把 "${myEff}" 合并到哪个分类? 直接输入目标分类名 (从下面任选, 或自定义新名字):\n\n${others.map((n) => '  · ' + n).join('\n')}`,
            others[0]
        );
        if (target === null) return;
        const t = target.trim();
        if (!t) return;
        classifyState.overrides.set(orig, t);
        saveClassifyState(classifyState);
        renderScanResult(classifyState.lastResult);
    }

    function updateCounts() {
        const r = classifyState.lastResult;
        if (!r) return;
        (r.categories || []).forEach((c) => {
            const el = elResult.querySelector(`[data-count-for="${cssEsc(c.name)}"]`);
            if (!el) return;
            const total = c.files.length;
            const live = c.files.filter((f) => !classifyState.excluded.has(f.path)).length;
            el.textContent = `${live} / ${total} 个`;
        });
        if ((r.uncategorized || []).length > 0) {
            const el = elResult.querySelector(`[data-count-for="__uncategorized__"]`);
            if (el) {
                const total = r.uncategorized.length;
                const live = r.uncategorized.filter((f) => !classifyState.excluded.has(f.path)).length;
                el.textContent = `${live} / ${total} 个`;
            }
        }
    }
    // CSS.escape 兼容包装 (老 wails 嵌入引擎可能没有)
    function cssEsc(s) {
        if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
        return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }

    // ---- 应用分类 ----
    function buildAssignments() {
        const r = classifyState.lastResult;
        if (!r) return [];
        // 把 (effective name) → set of paths 累计起来; 同名分类的文件合到一起
        const byName = new Map();
        const addOne = (name, p) => {
            if (classifyState.excluded.has(p)) return;
            if (!byName.has(name)) byName.set(name, []);
            byName.get(name).push(p);
        };
        (r.categories || []).forEach((c) => {
            const name = effectiveName(c.name);
            (c.files || []).forEach((f) => addOne(name, f.path));
        });
        if ((r.uncategorized || []).length > 0) {
            const name = effectiveName('__uncategorized__');
            r.uncategorized.forEach((f) => addOne(name, f.path));
        }
        const out = [];
        for (const [name, paths] of byName) {
            if (!paths || paths.length === 0) continue;
            out.push({ name, paths });
        }
        return out;
    }

    async function runApply() {
        const tgt = elTgt.value.trim();
        if (!tgt) { toast('请先选择或粘贴目标目录', 'error'); return; }
        const assignments = buildAssignments();
        if (assignments.length === 0) { toast('没有可应用的文件 (全部被排除?)', 'error'); return; }
        const totalFiles = assignments.reduce((s, a) => s + a.paths.length, 0);
        const policy = elConflict.value;

        // dry-run 预览
        let preview;
        try {
            preview = await ApplyTemplateCategories({
                targetDir: tgt, dryRun: true, onConflict: policy, assignments,
            });
        } catch (err) { toast(`预览失败: ${err}`, 'error'); return; }
        const willMove = preview.moved || 0;
        const willSkip = preview.skipped || 0;
        const renamePreview = (preview.items || []).filter((it) => !it.skipped && it.dstPath
            && it.dstPath.split('/').pop() !== it.srcPath.split('/').pop());

        const summary = `共 ${totalFiles} 个文件分到 ${assignments.length} 个分类:\n` +
            assignments.map((a) => `  · ${a.name}/  (${a.paths.length} 个)`).join('\n') +
            `\n\n预览: ${willMove} 个会搬走, ${willSkip} 个会跳过, ${renamePreview.length} 个因同名冲突会被重命名 (策略: ${policy}).`;
        if (!confirm(`${summary}\n\n目标根目录: ${tgt}\n\n继续吗?`)) return;

        elApply.disabled = true;
        const oldLabel = elApply.textContent;
        elApply.textContent = '⏳ 应用中…';
        try {
            const r = await ApplyTemplateCategories({
                targetDir: tgt, dryRun: false, onConflict: policy, assignments,
            });
            classifyState.targetHist = pushHist(classifyState.targetHist, r.targetDir || tgt);
            saveClassifyState(classifyState);
            renderHistChips(elTgtHist, classifyState.targetHist, (p) => { elTgt.value = p; classifyState.targetDir = p; saveClassifyState(classifyState); });
            const moved = r.moved || 0;
            const skipped = r.skipped || 0;
            toast(`✅ 分类完成: ${moved} 个搬走 · ${skipped} 个跳过 · ${r.elapsed || ''}`, skipped > 0 ? 'error' : 'success');
            // 重新扫一遍源目录, 让卡片刷新 (移走后剩多少)
            await runScan(elSrc.value.trim());
        } catch (err) {
            toast(`应用失败: ${err}`, 'error');
        } finally {
            elApply.disabled = false;
            elApply.textContent = oldLabel;
        }
    }
}


// ============================================================
// 模块: YAML 采集 (辅助模块 / YAML 采集)
// ============================================================
//
// 跟"模板分类"区别:
//   classify (前): token-anchor 通用合并, 输出 ProposedCategory[].
//                  适合已经按厂商命名的 nuclei 模板库.
//   collect (这):  优先识别"产品名" (内置词表 wordpress/apache/...),
//                  没产品但有 CVE/CNVD/... → 按 "前缀-年份" 桶 (CVE-2021),
//                  啥都没有 → token fallback.
//                  适合一坨杂 yaml — 文件名 / id 形态混乱时能聚成干净几个桶.
//
// 工作流: 选源目录 → 扫描 (后端按 product > vuln-id > token 分桶)
//        → 看分组卡片 (可重命名 / 排除 / 合并到一个目录) → 选目标目录 → 应用
//
// 跨页持久化: folder, targetDir, onConflict, lastResult, overrides, excluded
//   存 key: doperationtool.collect (跟 classify 隔离)
//
// UI 复用 classify 同款骨架 (.template-classify / .cls-card / .cls-file),
// 多加一个 .col-kind 标签让用户一眼看出该桶是 "产品" / "编号" / "Token".

function loadCollectState() {
    try {
        const raw = localStorage.getItem('doperationtool.collect');
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) { return null; }
}
function saveCollectState(s) {
    try {
        const cp = {
            ...s,
            overrides: s.overrides ? Object.fromEntries(s.overrides) : {},
        };
        const excSize = (s.excluded && s.excluded.size) || 0;
        cp.excluded = excSize > 5000 ? [] : Array.from(s.excluded || []);
        const lr = s.lastResult;
        const totalFiles = lr
            ? ((Array.isArray(lr.groups) ? lr.groups.reduce((a, g) => a + ((g.files && g.files.length) || 0), 0) : 0)
              + (Array.isArray(lr.uncategorized) ? lr.uncategorized.length : 0))
            : 0;
        if (totalFiles > 5000) cp.lastResult = null;
        localStorage.setItem('doperationtool.collect', JSON.stringify(cp));
    } catch (e) { /* quota / 序列化失败忽略 */ }
}

const collectState = (() => {
    const loaded = loadCollectState();
    return {
        folder:     loaded?.folder || '',
        targetDir:  loaded?.targetDir || '',
        onConflict: loaded?.onConflict || 'rename',
        history:    Array.isArray(loaded?.history) ? loaded.history : [],
        targetHist: Array.isArray(loaded?.targetHist) ? loaded.targetHist : [],
        lastResult: loaded?.lastResult || null,
        overrides:  new Map(Object.entries(loaded?.overrides || {})),
        excluded:   new Set(Array.isArray(loaded?.excluded) ? loaded.excluded : []),
    };
})();

function renderYamlCollect(container) {
    container.innerHTML = `
    <div class="template-classify">
        <div class="extractor-tip">
            📦 扫描目录, 优先按 <b>产品名</b> (wordpress / apache / weblogic …) 自动归类;
            没产品但有 <code>CVE</code> / <code>CNVD</code> 等漏洞编号 → 按"前缀-年份"分桶 (例 <b>CVE-2021</b>).
            可在卡片上重命名 / 排除, 然后整体搬到目标目录的子文件夹.
        </div>
        <div class="nv-toolbar">
            <input type="text" class="yaml-path-input" id="col-src"
                placeholder="源目录 (回车扫描)" spellcheck="false" />
            <button class="btn" id="col-pick-src">选择源目录</button>
            <button class="btn btn-primary" id="col-scan">▶ 扫描采集</button>
        </div>
        <div class="nv-history" id="col-src-hist"></div>
        <div class="dd-summary" id="col-summary"></div>
        <div class="nv-toolbar dd-target-bar" id="col-target-bar" style="display:none">
            <input type="text" class="yaml-path-input" id="col-tgt"
                placeholder="目标目录 (按桶名建子目录, 不存在自动创建)" spellcheck="false" />
            <button class="btn" id="col-pick-tgt">选择目标目录</button>
            <select class="dd-conflict" id="col-conflict" title="同名冲突策略">
                <option value="rename">同名 → 加 _dup_N</option>
                <option value="skip">同名 → 跳过</option>
                <option value="overwrite">同名 → 覆盖</option>
            </select>
            <button class="btn btn-primary" id="col-apply">📦 应用采集</button>
        </div>
        <div class="nv-history" id="col-tgt-hist"></div>
        <div class="dd-result" id="col-result"></div>
    </div>`;
    setupYamlCollect();
}

function setupYamlCollect() {
    const elSrc       = document.getElementById('col-src');
    const elTgt       = document.getElementById('col-tgt');
    const elPickSrc   = document.getElementById('col-pick-src');
    const elPickTgt   = document.getElementById('col-pick-tgt');
    const elScan      = document.getElementById('col-scan');
    const elApply     = document.getElementById('col-apply');
    const elConflict  = document.getElementById('col-conflict');
    const elSrcHist   = document.getElementById('col-src-hist');
    const elTgtHist   = document.getElementById('col-tgt-hist');
    const elSummary   = document.getElementById('col-summary');
    const elTargetBar = document.getElementById('col-target-bar');
    const elResult    = document.getElementById('col-result');

    elSrc.value = collectState.folder;
    elTgt.value = collectState.targetDir;
    elConflict.value = collectState.onConflict;

    function pushHist(arr, p, max = 6) {
        const list = (arr || []).filter((x) => x !== p);
        list.unshift(p);
        return list.slice(0, max);
    }
    function renderHistChips(host, list, onPick) {
        if (!host) return;
        host.innerHTML = (list || []).map((p) =>
            `<button class="nv-hist-chip" data-path="${escapeHtml(p)}" title="${escapeHtml(p)}">${escapeHtml(p)}</button>`
        ).join('');
        host.querySelectorAll('.nv-hist-chip').forEach((b) => {
            b.addEventListener('click', () => onPick(b.dataset.path));
        });
    }
    renderHistChips(elSrcHist, collectState.history, (p) => { elSrc.value = p; runScan(p); });
    renderHistChips(elTgtHist, collectState.targetHist, (p) => { elTgt.value = p; collectState.targetDir = p; saveCollectState(collectState); });

    if (collectState.lastResult) {
        renderScanResult(collectState.lastResult);
    } else {
        elResult.innerHTML = `<div class="yaml-empty">扫描结果会显示在这里</div>`;
    }

    // ---- 输入 / 选目录 ----
    elPickSrc.addEventListener('click', async () => {
        try {
            const f = await SelectDirectory();
            if (!f) return;
            elSrc.value = f;
            collectState.folder = f;
            saveCollectState(collectState);
        } catch (err) { toast(`选择失败: ${err}`, 'error'); }
    });
    elPickTgt.addEventListener('click', async () => {
        try {
            const f = await SelectDirectory();
            if (!f) return;
            elTgt.value = f;
            collectState.targetDir = f;
            saveCollectState(collectState);
        } catch (err) { toast(`选择失败: ${err}`, 'error'); }
    });
    elSrc.addEventListener('input', () => { collectState.folder = elSrc.value.trim(); saveCollectState(collectState); });
    elTgt.addEventListener('input', () => { collectState.targetDir = elTgt.value.trim(); saveCollectState(collectState); });
    elSrc.addEventListener('keydown', (e) => { if (e.key === 'Enter') runScan(elSrc.value.trim()); });
    elScan.addEventListener('click', () => runScan(elSrc.value.trim()));
    elApply.addEventListener('click', () => runApply());
    elConflict.addEventListener('change', () => {
        collectState.onConflict = elConflict.value;
        saveCollectState(collectState);
    });

    // ---- 扫描 ----
    async function runScan(folder) {
        if (!folder) { toast('请先选择或输入源目录', 'error'); return; }
        elScan.disabled = true;
        const oldLabel = elScan.textContent;
        elScan.textContent = '⏳ 扫描中…';
        elResult.innerHTML = `<div class="yaml-empty">正在扫描 ${escapeHtml(folder)} …</div>`;
        elSummary.innerHTML = '';
        elTargetBar.style.display = 'none';
        progressTracker.start('collect:progress', '扫描 YAML 采集');
        try {
            const r = await ScanYamlCollection(folder);
            collectState.lastResult = r;
            collectState.history = pushHist(collectState.history, folder);
            collectState.overrides = new Map();
            collectState.excluded = new Set();
            saveCollectState(collectState);
            renderHistChips(elSrcHist, collectState.history, (p) => { elSrc.value = p; runScan(p); });
            renderScanResult(r);
            const groups = (r.groups || []).length;
            const unc = (r.uncategorized || []).length;
            if (groups === 0 && unc === 0) toast(`✅ 没扫到 yaml (${r.elapsed})`);
            else toast(`找到 ${groups} 个分类桶 · ${unc} 个未归类 (${r.elapsed})`);
        } catch (err) {
            elResult.innerHTML = `<div class="poc-validate-fail">❌ 扫描失败: ${escapeHtml(String(err))}</div>`;
            toast(String(err), 'error');
            progressTracker.stop();
        } finally {
            elScan.disabled = false;
            elScan.textContent = oldLabel;
        }
    }

    // ---- 用户改后的最终分类名 ----
    function effectiveName(orig) {
        const o = collectState.overrides.get(orig);
        return (o && o.trim()) ? o.trim() : orig;
    }

    // ---- 渲染 ----
    function renderScanResult(r) {
        const groups = Array.isArray(r.groups) ? r.groups : [];
        const unc = Array.isArray(r.uncategorized) ? r.uncategorized : [];
        const total = r.total || 0;

        if (groups.length === 0 && unc.length === 0) {
            elSummary.innerHTML = `<div class="poc-validate-pass">✅ 没扫到 yaml · ${escapeHtml(r.elapsed || '')}</div>`;
            elTargetBar.style.display = 'none';
            elResult.innerHTML = `<div class="yaml-empty">该目录下没有 yaml 文件</div>`;
            return;
        }

        // 按 kind 拆数: product / vuln-id / token
        const kindCount = { product: 0, 'vuln-id': 0, token: 0 };
        groups.forEach((g) => { if (kindCount[g.kind] !== undefined) kindCount[g.kind] += 1; });

        elSummary.innerHTML = `
          <div class="dd-summary-line">
            🔍 扫描 <b>${total}</b> 个 yaml · <b>${groups.length}</b> 个桶
            (产品 <span class="col-stat-prod">${kindCount.product}</span> · 编号 <span class="col-stat-vuln">${kindCount['vuln-id']}</span> · Token <span class="col-stat-tok">${kindCount.token}</span>)
            · <span class="dd-warn">${unc.length}</span> 未归类 · ${escapeHtml(r.elapsed || '')}
          </div>`;

        elTargetBar.style.display = '';

        const kindLabel = (k) => ({ 'product': '产品', 'vuln-id': '编号', 'token': 'Token' }[k] || k);

        // 渲染策略:
        //   桶可能上千 (实测 50000 yaml → 2500+ 桶), 每桶 li 列表全部 innerHTML 一把梭
        //   会让浏览器内存爆炸 + 首屏卡死. 这里改成 "懒展开":
        //   - 卡片头永远先渲染 (轻量, 几千个 head 也就几千个 dom node, 没事)
        //   - 卡片体 ul 默认是 placeholder (空), 用户点 ▸ 展开才真填充
        //   首屏只构造 ~3000 dom node (head 集合), 流畅滚动.
        //
        //   每个文件项的 HTML 跟 classify 同款 5 列 grid: checkbox / name / token / rel / reveal.
        //   token 列我复用为 yaml id 展示 (这模块没 product token 概念).
        const renderFileLi = (f) => {
            const ex = collectState.excluded.has(f.path);
            return `
                <li class="cls-file${ex ? ' cls-file-excluded' : ''}">
                    <input type="checkbox" class="cls-file-check" data-path="${escapeHtml(f.path)}" ${ex ? '' : 'checked'} />
                    <span class="cls-file-name" title="${escapeHtml(f.path)}">${escapeHtml(f.name)}</span>
                    <span class="cls-file-token" title="yaml id">${escapeHtml(f.id || '—')}</span>
                    <span class="cls-file-rel" title="${escapeHtml(f.relPath)}">${escapeHtml(f.relPath)}</span>
                    <button class="dd-reveal" data-path="${escapeHtml(f.path)}" title="在文件管理器中显示">📂</button>
                </li>`;
        };

        const renderCard = (g) => {
            const eff = effectiveName(g.name);
            const fileCount = (g.files || []).filter((f) => !collectState.excluded.has(f.path)).length;
            const totalSize = (g.files || []).reduce((a, f) => a + (f.size || 0), 0);
            return `
            <div class="cls-card cls-card-collapsed" data-orig="${escapeHtml(g.name)}" data-kind="bucket">
                <div class="cls-card-head">
                    <button class="cls-card-toggle" data-act="toggle" title="点击展开/收起">▸</button>
                    <span class="col-kind col-kind-${g.kind.replace(/[^a-z]/g, '')}">${kindLabel(g.kind)}</span>
                    <input type="text" class="cls-name-input" data-orig="${escapeHtml(g.name)}"
                           value="${escapeHtml(eff)}" placeholder="${escapeHtml(g.name)}" title="重命名后写入此目录" />
                    <span class="cls-card-count">${fileCount} / ${(g.files || []).length} 个</span>
                    <span class="cls-card-tokens" title="文件总大小">${formatBytes(totalSize)}</span>
                    <div class="cls-card-actions">
                        <button class="btn btn-tiny" data-act="select-all">全选</button>
                        <button class="btn btn-tiny" data-act="select-none">全不选</button>
                    </div>
                </div>
                <ul class="cls-file-list" data-loaded="0"></ul>
            </div>`;
        };

        const uncCard = unc.length > 0 ? (() => {
            const eff = effectiveName('__uncategorized__');
            const fileCount = unc.filter((f) => !collectState.excluded.has(f.path)).length;
            const totalSize = unc.reduce((a, f) => a + (f.size || 0), 0);
            return `
            <div class="cls-card cls-card-unc cls-card-collapsed" data-orig="__uncategorized__" data-kind="unc">
                <div class="cls-card-head">
                    <button class="cls-card-toggle" data-act="toggle" title="点击展开/收起">▸</button>
                    <span class="col-kind col-kind-unc">未归类</span>
                    <input type="text" class="cls-name-input" data-orig="__uncategorized__"
                           value="${escapeHtml(eff === '__uncategorized__' ? 'uncategorized' : eff)}"
                           placeholder="uncategorized" title="重命名后写入此目录" />
                    <span class="cls-card-count">${fileCount} / ${unc.length} 个</span>
                    <span class="cls-card-tokens">${formatBytes(totalSize)}</span>
                    <div class="cls-card-actions">
                        <button class="btn btn-tiny" data-act="select-all">全选</button>
                        <button class="btn btn-tiny" data-act="select-none">全不选</button>
                    </div>
                </div>
                <ul class="cls-file-list" data-loaded="0"></ul>
            </div>`;
        })() : '';

        elResult.innerHTML = groups.map(renderCard).join('') + uncCard;

        // 懒填充: 给每个 cls-card 关联它的 files 数组, 点开时再 innerHTML 填进 ul.
        // 用 dataset/全局 map: 直接 in-memory 关联避免再扫 r.groups.
        const cardData = new Map(); // origName → files[]
        for (const g of groups) cardData.set(g.name, g.files || []);
        if (unc.length > 0) cardData.set('__uncategorized__', unc);
        elResult._collectCardData = cardData;

        // 事件委托: input(重命名) / change(checkbox) / click(reveal & 卡片选择)
        if (!elResult._collectDelegated) {
            elResult.addEventListener('input', (e) => {
                const inp = e.target.closest && e.target.closest('.cls-name-input');
                if (!inp || !elResult.contains(inp)) return;
                const orig = inp.dataset.orig;
                const v = inp.value.trim();
                if (v && v !== orig) collectState.overrides.set(orig, v);
                else collectState.overrides.delete(orig);
                saveCollectState(collectState);
            });
            elResult.addEventListener('change', (e) => {
                const cb = e.target.closest && e.target.closest('.cls-file-check');
                if (!cb || !elResult.contains(cb)) return;
                const p = cb.dataset.path;
                if (cb.checked) collectState.excluded.delete(p);
                else collectState.excluded.add(p);
                // 切换 li 视觉态
                const li = cb.closest('.cls-file');
                if (li) li.classList.toggle('cls-file-excluded', !cb.checked);
                // 卡片头计数刷新
                const card = cb.closest('.cls-card');
                if (card) {
                    const total = card.querySelectorAll('.cls-file-check').length;
                    const checked = card.querySelectorAll('.cls-file-check:checked').length;
                    const cnt = card.querySelector('.cls-card-count');
                    if (cnt) cnt.textContent = `${checked} / ${total} 个`;
                }
                saveCollectState(collectState);
            });
            elResult.addEventListener('click', (e) => {
                const reveal = e.target.closest && e.target.closest('.dd-reveal');
                if (reveal && elResult.contains(reveal)) {
                    RevealInFileManager(reveal.dataset.path).catch((err) => toast(String(err), 'error'));
                    return;
                }
                const btn = e.target.closest && e.target.closest('button[data-act]');
                if (!btn || !elResult.contains(btn)) return;
                const card = btn.closest('.cls-card');
                if (!card) return;
                const orig = card.dataset.orig;
                const dataMap = elResult._collectCardData;
                const files = (dataMap && dataMap.get(orig)) || [];
                const ul = card.querySelector('.cls-file-list');

                // 1) 展开/收起: 首次展开时把 li 真填进去 (lazy)
                if (btn.dataset.act === 'toggle') {
                    const wasCollapsed = card.classList.contains('cls-card-collapsed');
                    if (wasCollapsed && ul && ul.dataset.loaded !== '1') {
                        ul.innerHTML = files.map(renderFileLi).join('');
                        ul.dataset.loaded = '1';
                    }
                    card.classList.toggle('cls-card-collapsed');
                    btn.textContent = card.classList.contains('cls-card-collapsed') ? '▸' : '▾';
                    return;
                }

                // 2) 全选/全不选: 即使 ul 还没展开 (没填 li), 也要按 files 数据更新 excluded set,
                //    让 buildAssignments 拿到正确状态. UI 端的 checkbox 只在已展开时同步.
                const setAll = btn.dataset.act === 'select-all';
                for (const f of files) {
                    if (setAll) collectState.excluded.delete(f.path);
                    else collectState.excluded.add(f.path);
                }
                if (ul && ul.dataset.loaded === '1') {
                    ul.querySelectorAll('.cls-file-check').forEach((cb) => {
                        cb.checked = setAll;
                        const li = cb.closest('.cls-file');
                        if (li) li.classList.toggle('cls-file-excluded', !setAll);
                    });
                }
                const total = files.length;
                const checked = setAll ? total : 0;
                const cnt = card.querySelector('.cls-card-count');
                if (cnt) cnt.textContent = `${checked} / ${total} 个`;
                saveCollectState(collectState);
            });
            elResult._collectDelegated = true;
        }
    }

    // ---- 应用 ----
    function buildAssignments() {
        const r = collectState.lastResult;
        if (!r) return [];
        const out = [];
        const merged = new Map(); // effName → paths[]
        for (const g of (r.groups || [])) {
            const eff = effectiveName(g.name);
            const paths = (g.files || [])
                .map((f) => f.path)
                .filter((p) => !collectState.excluded.has(p));
            if (paths.length === 0) continue;
            if (!merged.has(eff)) merged.set(eff, []);
            merged.get(eff).push(...paths);
        }
        const unc = (r.uncategorized || []).filter((f) => !collectState.excluded.has(f.path)).map((f) => f.path);
        if (unc.length > 0) {
            const eff = effectiveName('__uncategorized__');
            const name = (eff === '__uncategorized__' ? 'uncategorized' : eff);
            if (!merged.has(name)) merged.set(name, []);
            merged.get(name).push(...unc);
        }
        for (const [name, paths] of merged) {
            out.push({ name, paths });
        }
        return out;
    }

    async function runApply() {
        const tgt = elTgt.value.trim();
        if (!tgt) { toast('请先选择或粘贴目标目录', 'error'); return; }
        const assignments = buildAssignments();
        if (assignments.length === 0) { toast('没有可搬动的文件 (全部排除了?)', 'error'); return; }
        const policy = elConflict.value;

        // dry-run 预览
        let preview;
        progressTracker.start('collect:progress', '预览采集 (dry-run)');
        try {
            preview = await ApplyYamlCollection({
                targetDir: tgt, assignments, dryRun: true, onConflict: policy,
            });
        } catch (err) {
            progressTracker.stop();
            toast(`预览失败: ${err}`, 'error');
            return;
        }
        const willMove = preview.moved || 0;
        const willSkip = preview.skipped || 0;
        const summary = `将搬走 ${willMove} 个, 跳过 ${willSkip} 个; 共 ${assignments.length} 个分类桶 (策略: ${policy}).`;
        if (!confirm(`${summary}\n\n目标目录: ${tgt}\n\n继续吗?`)) return;

        elApply.disabled = true;
        const oldLabel = elApply.textContent;
        elApply.textContent = '⏳ 应用中…';
        progressTracker.start('collect:progress', '应用采集');
        try {
            const r = await ApplyYamlCollection({
                targetDir: tgt, assignments, dryRun: false, onConflict: policy,
            });
            collectState.targetHist = pushHist(collectState.targetHist, r.targetDir || tgt);
            saveCollectState(collectState);
            renderHistChips(elTgtHist, collectState.targetHist, (p) => { elTgt.value = p; collectState.targetDir = p; saveCollectState(collectState); });
            const moved = r.moved || 0;
            const skipped = r.skipped || 0;
            toast(`✅ 采集完成: ${moved} 个搬走 · ${skipped} 个跳过 · ${r.elapsed || ''}`, skipped > 0 ? 'error' : 'success');
            await runScan(elSrc.value.trim());
        } catch (err) {
            toast(`应用失败: ${err}`, 'error');
        } finally {
            elApply.disabled = false;
            elApply.textContent = oldLabel;
        }
    }
}


const FINGER_GOV_KEY = 'doperationtool.fingerprint_governance';
function loadFingerGovState() {
    try {
        const raw = localStorage.getItem(FINGER_GOV_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { root: '', history: [], importDir: '', importHistory: [], pocDir: '', pocHistory: [] };
}
function saveFingerGovState(s) {
    try {
        localStorage.setItem(FINGER_GOV_KEY, JSON.stringify({
            root: s.root || '',
            history: s.history || [],
            importDir: s.importDir || '',
            importHistory: s.importHistory || [],
            pocDir: s.pocDir || '',
            pocHistory: s.pocHistory || [],
        }));
    } catch (e) {}
}
const fingerGovState = loadFingerGovState();
let lastFingerprintImportPreview = null;

function fingerShortPath(p) {
    const parts = String(p || '').split(/[\\/]+/).filter(Boolean);
    if (parts.length <= 2) return p;
    return '…/' + parts.slice(-2).join('/');
}

function pushFingerHistory(listName, valueName, path) {
    const p = String(path || '').trim();
    if (!p) return;
    const list = (fingerGovState[listName] || []).filter((x) => x !== p);
    list.unshift(p);
    fingerGovState[listName] = list.slice(0, 6);
    fingerGovState[valueName] = p;
    saveFingerGovState(fingerGovState);
}

function renderFingerHistoryChips(container, list, onPick) {
    if (!container) return;
    if (!list || list.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = `<span class="nv-hist-label">最近:</span>` +
        list.map((p) =>
            `<button class="nv-hist-chip" title="${escapeHtml(p)}" data-path="${escapeHtml(p)}">${escapeHtml(fingerShortPath(p))}</button>`
        ).join('');
    container.querySelectorAll('.nv-hist-chip').forEach((b) => {
        b.addEventListener('click', () => onPick(b.dataset.path || ''));
    });
}

function parseDDDDYamlClasses(yamlText) {
    const groups = [];
    let current = null;
    const unquote = (raw) => {
        const s = String(raw || '').trim();
        if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
            return s.slice(1, -1).replace(/''/g, "'");
        }
        if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
            try { return JSON.parse(s); } catch (e) { return s.slice(1, -1); }
        }
        return s;
    };
    for (const rawLine of String(yamlText || '').split(/\r?\n/)) {
        const line = rawLine.replace(/\s+$/, '');
        if (!line.trim()) continue;
        if (!/^\s/.test(line) && /:\s*$/.test(line)) {
            current = { product: unquote(line.replace(/:\s*$/, '')), rules: [] };
            groups.push(current);
            continue;
        }
        const m = line.match(/^\s*-\s*(.+?)\s*$/);
        if (m && current) current.rules.push(unquote(m[1]));
    }
    return groups;
}

function renderFingerprintClassView(r) {
    const groups = parseDDDDYamlClasses(r && r.ddddYaml);
    const totalRules = groups.reduce((sum, g) => sum + g.rules.length, 0);
    if (groups.length === 0) {
        return renderFingerprintSection('按指纹名归类展示', 0, '<div class="fg-empty">暂无可展示的指纹</div>', 0);
    }
    const shownGroups = groups.slice(0, 300);
    const nav = shownGroups.map((g, i) => `
        <a class="fg-class-nav-item" href="#fg-class-${i}" title="${escapeHtml(g.product)}">
            <span>${escapeHtml(g.product)}</span>
            <em>${escapeHtml(g.rules.length)}</em>
        </a>`).join('');
    const cards = shownGroups.map((g, i) => {
        const shownRules = g.rules.slice(0, 200);
        const more = g.rules.length > shownRules.length ? `\n... 另有 ${g.rules.length - shownRules.length} 条未展示，可复制 finger.yaml 查看完整内容` : '';
        return `
        <section class="fg-class-card" id="fg-class-${i}">
            <div class="fg-class-card-head">
                <b title="${escapeHtml(g.product)}">${escapeHtml(g.product)}</b>
                <span>${escapeHtml(g.rules.length)} 条指纹</span>
            </div>
            <pre>${escapeHtml(shownRules.map((rule) => `- ${rule}`).join('\n') + more)}</pre>
        </section>`;
    }).join('');
    const body = `
        <div class="fg-class-view">
            <div class="fg-class-nav">${nav}</div>
            <div class="fg-class-cards">${cards}</div>
        </div>`;
    return renderFingerprintSection('按指纹名归类展示', groups.length, body, shownGroups.length)
        .replace('</summary>', ` · <span>${escapeHtml(totalRules)} 条 finger.yaml 可用表达式，预览限流展示</span></summary>`);
}

function looksLikeDDDDFingerprintSource(p) {
    const s = String(p || '').toLowerCase();
    if (!s) return false;
    return /(^|[\\/])(fingerprinting|fingerprints|fingerprint)([\\/]|$)/.test(s)
        || /afrog-pocs[\\/]/.test(s)
        || /pocs[\\/].*(finger|fingerprint)/.test(s);
}

function looksLikeDDDDProjectRoot(p) {
    const s = String(p || '').toLowerCase();
    if (!s) return false;
    return /(^|[\\/])dddd([\\/]|-|_|$)/.test(s)
        || /dddd-yunwei/.test(s)
        || /common[\\/]config/.test(s)
        || /workflow\.ya?ml$/.test(s)
        || /config[\\/]pocs/.test(s);
}

function shouldSwapDDDDImportPaths(root, source) {
    return looksLikeDDDDFingerprintSource(root)
        && (!looksLikeDDDDFingerprintSource(source) || looksLikeDDDDProjectRoot(source));
}

function renderDDDDFingerprintConverter(container) {
    container.innerHTML = `
    <div class="fingerprint-governance dddd-fingerprint-converter">
        <div class="extractor-tip">
            🧬 选择待转换的第三方指纹目录，生成 <code>finger.yaml</code> 可直接使用的格式；目标项目目录是可选项，只在需要写回时使用。
        </div>
        <div class="fg-import-card">
            <div class="fg-import-head">
                <div>
                    <b>外部指纹导入与优化</b>
                    <span>支持 YAML / JSON / TXT 等来源，自动归一化产品名、去重、评分、提示弱规则，并可备份后写回目标项目。</span>
                </div>
            </div>
            <div class="nv-toolbar">
                <input type="text" class="yaml-path-input" id="df-src"
                    placeholder="选择待转换指纹目录，可包含 yaml / json / txt 等" spellcheck="false" />
                <button class="btn" id="df-src-pick">选择来源目录</button>
                <button class="btn btn-primary" id="df-run">🔎 转换预览</button>
            </div>
            <div class="nv-history" id="df-src-history"></div>
            <div class="nv-toolbar">
                <input type="text" class="yaml-path-input" id="df-root"
                    placeholder="可选：选择目标项目目录；写回目标为 common/config/finger.yaml，不填则只生成预览" spellcheck="false" />
                <button class="btn" id="df-root-pick">选择目标项目</button>
                <button class="btn" id="df-open-audit">关联审计</button>
            </div>
            <div class="nv-history" id="df-root-history"></div>
        </div>
        <div class="fg-import-summary" id="df-summary"></div>
        <div class="fg-import-result dddd-finger-result" id="df-result"></div>
    </div>`;
    setupDDDDFingerprintConverter();
}

function setupDDDDFingerprintConverter() {
    const elRoot = document.getElementById('df-root');
    const elRootPick = document.getElementById('df-root-pick');
    const elAudit = document.getElementById('df-open-audit');
    const elRootHist = document.getElementById('df-root-history');
    const elSrc = document.getElementById('df-src');
    const elSrcPick = document.getElementById('df-src-pick');
    const elRun = document.getElementById('df-run');
    const elSrcHist = document.getElementById('df-src-history');
    const elSummary = document.getElementById('df-summary');
    const elResult = document.getElementById('df-result');

    elRoot.value = fingerGovState.root || '';
    elSrc.value = fingerGovState.importDir || '';

    const renderHistories = () => {
        renderFingerHistoryChips(elRootHist, fingerGovState.history, (p) => {
            elRoot.value = p;
            fingerGovState.root = p;
            saveFingerGovState(fingerGovState);
        });
        renderFingerHistoryChips(elSrcHist, fingerGovState.importHistory, (p) => {
            elSrc.value = p;
            runPreview(p);
        });
    };
    renderHistories();

    elRootPick.addEventListener('click', async () => {
        try {
            const f = await SelectDirectory();
            if (!f) return;
            elRoot.value = f;
            pushFingerHistory('history', 'root', f);
            renderHistories();
        } catch (err) {
            toast(`选择失败: ${err}`, 'error');
        }
    });
    elSrcPick.addEventListener('click', async () => {
        try {
            const f = await SelectDirectory();
            if (!f) return;
            elSrc.value = f;
            fingerGovState.importDir = f;
            saveFingerGovState(fingerGovState);
            renderHistories();
        } catch (err) {
            toast(`选择失败: ${err}`, 'error');
        }
    });
    elRoot.addEventListener('input', () => {
        fingerGovState.root = elRoot.value.trim();
        saveFingerGovState(fingerGovState);
    });
    elSrc.addEventListener('input', () => {
        fingerGovState.importDir = elSrc.value.trim();
        saveFingerGovState(fingerGovState);
    });
    elRoot.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            pushFingerHistory('history', 'root', elRoot.value.trim());
            renderHistories();
        }
    });
    elSrc.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runPreview(elSrc.value.trim());
    });
    elRun.addEventListener('click', () => runPreview(elSrc.value.trim()));
    elAudit.addEventListener('click', () => {
        const root = elRoot.value.trim();
        if (root) pushFingerHistory('history', 'root', root);
        navigate('fingerprint-governance');
    });
    elResult.addEventListener('click', async (e) => {
        const applyBtn = e.target.closest && e.target.closest('#fg-import-apply');
        if (applyBtn && elResult.contains(applyBtn)) {
            await applyImport(elRoot.value.trim());
            return;
        }
        const btn = e.target.closest && e.target.closest('button[data-copy]');
        if (!btn || !elResult.contains(btn)) return;
        const text = btn.dataset.copy === 'yaml'
            ? (lastFingerprintImportPreview && lastFingerprintImportPreview.ddddYaml) || ''
            : (lastFingerprintImportPreview && lastFingerprintImportPreview.patchPreview) || '';
        if (text) copyToClipboard(text, btn.dataset.copy === 'yaml' ? 'finger.yaml' : 'Patch 预览');
    });

    async function runPreview(sourceDir) {
        sourceDir = String(sourceDir || '').trim();
        if (!sourceDir) {
            toast('请先选择或粘贴待转换指纹目录', 'error');
            return;
        }
        let root = elRoot.value.trim();
        if (shouldSwapDDDDImportPaths(root, sourceDir)) {
            const oldRoot = root;
            root = sourceDir;
            sourceDir = oldRoot;
            elRoot.value = root;
            elSrc.value = sourceDir;
            fingerGovState.root = root;
            fingerGovState.importDir = sourceDir;
            saveFingerGovState(fingerGovState);
            renderHistories();
            toast('检测到目标项目目录和指纹来源目录可能填反，已自动交换后继续转换', 'error');
        }
        elRun.disabled = true;
        elSrcPick.disabled = true;
        const oldLabel = elRun.textContent;
        elRun.textContent = '⏳ 转换中…';
        elSummary.innerHTML = '';
        elResult.innerHTML = `<div class="yaml-empty">正在解析 ${escapeHtml(sourceDir)} 并转换为 finger.yaml 指纹表达式…</div>`;
        progressTracker.start('fingerprint:import:progress', '外部指纹导入预览');
        try {
            const r = await PreviewFingerprintImport(root, sourceDir);
            lastFingerprintImportPreview = r;
            renderFingerprintImportPreview(r, elSummary, elResult);
            if (root) pushFingerHistory('history', 'root', root);
            pushFingerHistory('importHistory', 'importDir', sourceDir);
            renderHistories();
            toast(`✅ 导入预览完成: ${r.productCount || 0} 个产品 · ${r.ruleCount || 0} 条规则 (${r.elapsed || ''})`, 'success');
        } catch (err) {
            const msg = String(err);
            elResult.innerHTML = `<div class="poc-validate-fail">❌ 导入预览失败: ${escapeHtml(msg)}</div>`;
            toast(msg, 'error');
            progressTracker.stop();
        } finally {
            elRun.disabled = false;
            elSrcPick.disabled = false;
            elRun.textContent = oldLabel;
        }
    }

    async function applyImport(projectRoot) {
        if (!lastFingerprintImportPreview || !lastFingerprintImportPreview.ddddYaml) {
            toast('请先完成一次转换预览', 'error');
            return;
        }
        if (!projectRoot) {
            toast('请先选择目标项目目录后再写回', 'error');
            return;
        }
        const input = elResult.querySelector('#fg-import-confirm');
        const confirmation = (input && input.value || '').trim();
        if (confirmation !== 'APPLY_FINGERPRINT_IMPORT') {
            toast('请输入 APPLY_FINGERPRINT_IMPORT 后再写回', 'error');
            return;
        }
        const btn = elResult.querySelector('#fg-import-apply');
        if (btn) btn.disabled = true;
        try {
            const r = await ApplyFingerprintImport({
                projectRoot,
                ddddYaml: lastFingerprintImportPreview.ddddYaml,
                confirm: true,
                confirmation,
            });
            pushFingerHistory('history', 'root', projectRoot);
            renderHistories();
            toast(`✅ 写回完成: 新增 ${r.productsCreated || 0} 产品，合并 ${r.productsMerged || 0} 产品，新增 ${r.rulesAdded || 0} 规则`, 'success');
            const status = elResult.querySelector('#fg-import-apply-status');
            if (status) {
                status.innerHTML = `
                    <div class="fg-apply-ok">已写回 <code>${escapeHtml(r.targetFingerPath || '')}</code></div>
                    <div class="fg-apply-ok">备份文件 <code>${escapeHtml(r.backupPath || '')}</code></div>
                    <div class="fg-apply-ok">可切换到“指纹治理”执行关联审计。</div>`;
            }
        } catch (err) {
            toast(`写回失败: ${err}`, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }
}

function renderFingerprintGovernance(container) {
    container.innerHTML = `
    <div class="fingerprint-governance">
        <div class="extractor-tip">
            🧬 这里检查 dddd 的指纹与 POC 能力: 对比 <code>common/config/finger.yaml</code>、
            <code>workflow.yaml</code> 与 <code>config/pocs</code>，找出有指纹无 POC、有 POC 无指纹、虚空 POC、残缺 POC 和 workflow 不可调用问题。
        </div>
        <div class="nv-toolbar">
            <input type="text" class="yaml-path-input" id="fg-root"
                placeholder="选择 dddd 根目录, 例如 D:\\AI\\scan\\dddd" spellcheck="false" />
            <button class="btn" id="fg-pick">选择目录</button>
            <button class="btn btn-primary" id="fg-run">▶️ 开始审计</button>
        </div>
        <div class="nv-history" id="fg-history"></div>
        <div class="fg-summary" id="fg-summary"></div>
        <div class="fg-result" id="fg-result"></div>
    </div>`;
    setupFingerprintGovernance();
}

function renderPocCatalog(container) {
    container.innerHTML = `
    <div class="fingerprint-governance poc-catalog">
        <div class="extractor-tip">
            🧩 这里加载外部 POC 目录，先按 <code>id / 内容哈希 / 文件名</code> 去重，再按 dddd <code>finger.yaml</code> 的产品指纹归类，方便判断外部 POC 覆盖哪些 dddd 组件。
        </div>
        <div class="nv-toolbar">
            <input type="text" class="yaml-path-input" id="pc-root"
                placeholder="选择 dddd 根目录, 例如 D:\\AI\\scan\\dddd" spellcheck="false" />
            <button class="btn" id="pc-pick">选择 dddd 根目录</button>
            <button class="btn" id="pc-open-audit">指纹/POC 能力对比</button>
        </div>
        <div class="nv-history" id="pc-history"></div>
        <div class="nv-toolbar">
            <input type="text" class="yaml-path-input" id="pc-src"
                placeholder="选择外部 POC 目录，支持递归扫描 yaml / yml" spellcheck="false" />
            <button class="btn" id="pc-src-pick">选择外部 POC</button>
            <button class="btn btn-primary" id="pc-run">▶️ 去重并按 dddd 指纹归类</button>
        </div>
        <div class="nv-history" id="pc-src-history"></div>
        <div class="fg-summary" id="pc-summary"></div>
        <div class="fg-result" id="pc-result"></div>
    </div>`;
    setupPocCatalog();
}

function setupPocCatalog() {
    const elRoot = document.getElementById('pc-root');
    const elSrc = document.getElementById('pc-src');
    const elPick = document.getElementById('pc-pick');
    const elSrcPick = document.getElementById('pc-src-pick');
    const elAudit = document.getElementById('pc-open-audit');
    const elRun = document.getElementById('pc-run');
    const elHist = document.getElementById('pc-history');
    const elSrcHist = document.getElementById('pc-src-history');
    const elSummary = document.getElementById('pc-summary');
    const elResult = document.getElementById('pc-result');

    elRoot.value = fingerGovState.root || '';
    elSrc.value = fingerGovState.pocDir || '';

    function renderHistory() {
        renderFingerHistoryChips(elHist, fingerGovState.history, (p) => {
            elRoot.value = p;
            fingerGovState.root = p;
            saveFingerGovState(fingerGovState);
        });
        renderFingerHistoryChips(elSrcHist, fingerGovState.pocHistory, (p) => {
            elSrc.value = p;
            fingerGovState.pocDir = p;
            saveFingerGovState(fingerGovState);
        });
    }
    renderHistory();

    elPick.addEventListener('click', async () => {
        try {
            const f = await SelectDirectory();
            if (!f) return;
            elRoot.value = f;
            pushFingerHistory('history', 'root', f);
            renderHistory();
        } catch (err) {
            toast(`选择失败: ${err}`, 'error');
        }
    });
    elSrcPick.addEventListener('click', async () => {
        try {
            const f = await SelectDirectory();
            if (!f) return;
            elSrc.value = f;
            pushFingerHistory('pocHistory', 'pocDir', f);
            renderHistory();
        } catch (err) {
            toast(`选择失败: ${err}`, 'error');
        }
    });
    elRoot.addEventListener('input', () => {
        fingerGovState.root = elRoot.value.trim();
        saveFingerGovState(fingerGovState);
    });
    elSrc.addEventListener('input', () => {
        fingerGovState.pocDir = elSrc.value.trim();
        saveFingerGovState(fingerGovState);
    });
    elRoot.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runCatalog(elRoot.value.trim(), elSrc.value.trim());
    });
    elSrc.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runCatalog(elRoot.value.trim(), elSrc.value.trim());
    });
    elRun.addEventListener('click', () => runCatalog(elRoot.value.trim(), elSrc.value.trim()));
    elAudit.addEventListener('click', () => {
        const root = elRoot.value.trim();
        if (root) pushFingerHistory('history', 'root', root);
        navigate('fingerprint-governance');
    });
    elResult.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('.fg-reveal');
        if (!btn || !elResult.contains(btn)) return;
        RevealInFileManager(btn.dataset.path).catch((err) => toast(String(err), 'error'));
    });

    async function runCatalog(root, sourceDir) {
        if (!root) {
            toast('请先选择或粘贴 dddd 根目录', 'error');
            return;
        }
        if (!sourceDir) {
            toast('请先选择或粘贴外部 POC 目录', 'error');
            return;
        }
        elRun.disabled = true;
        elPick.disabled = true;
        elSrcPick.disabled = true;
        const oldLabel = elRun.textContent;
        elRun.textContent = '⏳ 归类中…';
        elSummary.innerHTML = '';
        elResult.innerHTML = `<div class="yaml-empty">正在扫描 ${escapeHtml(sourceDir)}，并按 ${escapeHtml(root)} 的产品指纹归类…</div>`;
        progressTracker.start('fingerprint:external_poc_catalog:progress', '外部 POC 归类');
        try {
            const r = await ClassifyExternalPocsByDDDD(root, sourceDir);
            renderPocCatalogResult(r, elSummary, elResult);
            pushFingerHistory('history', 'root', root);
            pushFingerHistory('pocHistory', 'pocDir', sourceDir);
            renderHistory();
            const score = (r.duplicatePocCount || 0) + (r.unmatchedPocCount || 0) + (r.incompletePocCount || 0);
            toast(score > 0 ? `⚠️ 归类完成: 发现 ${score} 个重点问题 (${r.elapsed})` : `✅ 归类完成 (${r.elapsed})`, score > 0 ? 'error' : 'success');
        } catch (err) {
            const msg = String(err);
            elResult.innerHTML = `<div class="poc-validate-fail">❌ 归类失败: ${escapeHtml(msg)}</div>`;
            toast(msg, 'error');
            progressTracker.stop();
        } finally {
            elRun.disabled = false;
            elPick.disabled = false;
            elSrcPick.disabled = false;
            elRun.textContent = oldLabel;
        }
    }
}

function setupFingerprintGovernance() {
    const elRoot = document.getElementById('fg-root');
    const elPick = document.getElementById('fg-pick');
    const elRun = document.getElementById('fg-run');
    const elHist = document.getElementById('fg-history');
    const elSummary = document.getElementById('fg-summary');
    const elResult = document.getElementById('fg-result');

    elRoot.value = fingerGovState.root || '';

    function renderHistory() {
        renderFingerHistoryChips(elHist, fingerGovState.history, (p) => {
            elRoot.value = p;
            fingerGovState.root = p;
            saveFingerGovState(fingerGovState);
            runAudit(p);
        });
    }
    renderHistory();

    elPick.addEventListener('click', async () => {
        try {
            const f = await SelectDirectory();
            if (!f) return;
            elRoot.value = f;
            pushFingerHistory('history', 'root', f);
            renderHistory();
        } catch (err) {
            toast(`选择失败: ${err}`, 'error');
        }
    });
    elRoot.addEventListener('input', () => {
        fingerGovState.root = elRoot.value.trim();
        saveFingerGovState(fingerGovState);
    });
    elRoot.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runAudit(elRoot.value.trim());
    });
    elRun.addEventListener('click', () => runAudit(elRoot.value.trim()));
    elResult.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('.fg-reveal');
        if (!btn || !elResult.contains(btn)) return;
        RevealInFileManager(btn.dataset.path).catch((err) => toast(String(err), 'error'));
    });

    async function runAudit(root) {
        if (!root) {
            toast('请先选择或粘贴 dddd 根目录', 'error');
            return;
        }
        elRun.disabled = true;
        elPick.disabled = true;
        const oldLabel = elRun.textContent;
        elRun.textContent = '⏳ 审计中…';
        elSummary.innerHTML = '';
        elResult.innerHTML = `<div class="yaml-empty">正在审计 ${escapeHtml(root)} 的指纹知识库…</div>`;
        progressTracker.start('fingerprint:audit:progress', '指纹知识库审计');
        try {
            const r = await AuditFingerprintKnowledge(root);
            renderFingerprintAudit(r, elSummary, elResult);
            pushFingerHistory('history', 'root', root);
            renderHistory();
            const score = (r.missingPocCount || 0) + (r.weakRuleCount || 0) + (r.duplicateRuleGroupCount || 0);
            toast(score > 0 ? `⚠️ 审计完成: 发现 ${score} 个重点问题 (${r.elapsed})` : `✅ 审计完成 (${r.elapsed})`, score > 0 ? 'error' : 'success');
        } catch (err) {
            const msg = String(err);
            elResult.innerHTML = `<div class="poc-validate-fail">❌ 审计失败: ${escapeHtml(msg)}</div>`;
            toast(msg, 'error');
            progressTracker.stop();
        } finally {
            elRun.disabled = false;
            elPick.disabled = false;
            elRun.textContent = oldLabel;
        }
    }
}

function renderFingerprintAudit(r, elSummary, elResult) {
    const stat = (label, value, tone = '') => `
        <div class="fg-stat ${tone}">
            <div class="fg-stat-value">${escapeHtml(value)}</div>
            <div class="fg-stat-label">${escapeHtml(label)}</div>
        </div>`;
    elSummary.innerHTML = `
        <div class="fg-stat-grid">
            ${stat('指纹产品', r.fingerCount || 0)}
            ${stat('指纹规则', r.fingerRuleCount || 0)}
            ${stat('Workflow 产品', r.workflowCount || 0)}
            ${stat('Workflow POC 引用', r.workflowPocRefCount || 0)}
            ${stat('POC 文件', r.pocFileCount || 0)}
            ${stat('POC 带 ID', r.pocWithIdCount || 0)}
            ${stat('缺失 POC', r.missingPocCount || 0, (r.missingPocCount || 0) ? 'fg-bad' : 'fg-good')}
            ${stat('虚空 POC', r.virtualPocCount || r.orphanPocCount || 0, (r.virtualPocCount || r.orphanPocCount || 0) ? 'fg-warn' : 'fg-good')}
            ${stat('POC 有指纹', r.pocWithFingerCount || 0, (r.pocWithFingerCount || 0) ? 'fg-good' : '')}
            ${stat('POC 有指纹且可调用', r.pocWithFingerWorkflowCount || 0, (r.pocWithFingerWorkflowCount || 0) ? 'fg-good' : '')}
            ${stat('指纹无 POC', r.fingerWithoutPocCount || 0, (r.fingerWithoutPocCount || 0) ? 'fg-bad' : 'fg-good')}
            ${stat('POC 有指纹未进 Workflow', r.pocWithFingerNoWorkflowCount || 0, (r.pocWithFingerNoWorkflowCount || 0) ? 'fg-warn' : 'fg-good')}
            ${stat('POC 无指纹', r.pocWithoutFingerCount || 0, (r.pocWithoutFingerCount || 0) ? 'fg-bad' : 'fg-good')}
            ${stat('残缺 POC', r.incompletePocCount || 0, (r.incompletePocCount || 0) ? 'fg-bad' : 'fg-good')}
            ${stat('指纹无 Workflow', r.fingerWithoutWorkflowCount || 0, (r.fingerWithoutWorkflowCount || 0) ? 'fg-warn' : 'fg-good')}
            ${stat('Workflow 无指纹', r.workflowWithoutFingerCount || 0, (r.workflowWithoutFingerCount || 0) ? 'fg-bad' : 'fg-good')}
            ${stat('弱规则', r.weakRuleCount || 0, (r.weakRuleCount || 0) ? 'fg-bad' : 'fg-good')}
            ${stat('重复规则组', r.duplicateRuleGroupCount || 0, (r.duplicateRuleGroupCount || 0) ? 'fg-warn' : 'fg-good')}
            ${stat('Workflow 建议', r.workflowSuggestionCount || 0, (r.workflowSuggestionCount || 0) ? 'fg-good' : '')}
            ${stat('资产识别类', r.assetOnlyProductCount || 0, (r.assetOnlyProductCount || 0) ? 'fg-warn' : '')}
        </div>
        <div class="fg-paths">
            <div><b>dddd:</b> <code>${escapeHtml(r.projectRoot || '')}</code></div>
            <div><b>finger:</b> <code>${escapeHtml(r.fingerPath || '')}</code></div>
            <div><b>workflow:</b> <code>${escapeHtml(r.workflowPath || '')}</code></div>
            <div><b>pocs:</b> <code>${escapeHtml(r.pocDir || '')}</code></div>
        </div>`;

    elResult.innerHTML = [
        renderPocCatalogGroups(r.pocGroups || [], 'builtin'),
        `<div class="fg-result-grid">` + [
            renderFingerprintTable('缺失 POC', r.missingPocCount, r.missingPocs, ['产品', 'POC'], (x) => [x.product, x.poc]),
            renderFingerprintPocDetailTable('虚空 POC：在 config/pocs 但 workflow 不可调用', r.virtualPocCount || r.orphanPocCount, r.virtualPocs || r.orphanPocs),
            renderFingerprintPocFingerTable('POC 有指纹且可调用', r.pocWithFingerWorkflowCount, r.pocWithFingerWorkflow),
            renderFingerprintPocFingerTable('POC 有指纹全集', r.pocWithFingerCount, r.pocWithFinger),
            renderFingerprintList('有指纹但无可用 POC', r.fingerWithoutPocCount, r.fingerWithoutPoc),
            renderFingerprintPocFingerTable('POC 有指纹但未加载 Workflow', r.pocWithFingerNoWorkflowCount, r.pocWithFingerNoWorkflow),
            renderFingerprintPocDetailTable('POC 无对应指纹', r.pocWithoutFingerCount, r.pocWithoutFinger),
            renderFingerprintPocDetailTable('残缺不完整 POC', r.incompletePocCount, r.incompletePocs),
            renderFingerprintList('有指纹但无 workflow', r.fingerWithoutWorkflowCount, r.fingerWithoutWorkflow),
            renderFingerprintList('有 workflow 但无指纹', r.workflowWithoutFingerCount, r.workflowWithoutFinger),
            renderFingerprintTable('弱规则候选', r.weakRuleCount, r.weakRules, ['产品', '原因', '规则'], (x) => [x.product, x.reason, x.rule]),
            renderFingerprintTable('重复规则组', r.duplicateRuleGroupCount, r.duplicateRules, ['规则', '产品'], (x) => [x.rule, (x.products || []).join(', ')]),
            renderFingerprintTable('疑似重复产品名', r.duplicateProductGroupCount, r.duplicateProducts, ['归一化名称', '产品'], (x) => [x.name, (x.products || []).join(', ')]),
            renderFingerprintTable('Workflow 自动建议', r.workflowSuggestionCount, r.workflowSuggestions, ['产品', '候选 POC', '置信度', '原因'], (x) => [x.product, x.pocRelPath || x.poc, x.confidence, x.reason]),
            renderFingerprintList('资产识别类产品', r.assetOnlyProductCount, r.assetOnlyProducts),
            renderFingerprintPocDetailTable('全部内置 POC', (r.allPocs || []).length, r.allPocs),
            renderFingerprintTable('POC 覆盖 Top 50', (r.topWorkflowProducts || []).length, r.topWorkflowProducts, ['产品', '指纹规则', 'POC'], (x) => [x.product, x.fingerRules, x.pocs]),
            renderFingerprintTable('指纹规则 Top 50', (r.topFingerProducts || []).length, r.topFingerProducts, ['产品', '指纹规则', 'POC'], (x) => [x.product, x.fingerRules, x.pocs]),
        ].join('') + `</div>`,
    ].join('');
}

function renderPocCatalogResult(r, elSummary, elResult) {
    const stat = (label, value, tone = '') => `
        <div class="fg-stat ${tone}">
            <div class="fg-stat-value">${escapeHtml(value)}</div>
            <div class="fg-stat-label">${escapeHtml(label)}</div>
        </div>`;
    elSummary.innerHTML = `
        <div class="fg-stat-grid">
            ${stat('指纹产品', r.fingerCount || 0)}
            ${stat('扫描 POC 文件', r.pocFileCount || 0)}
            ${stat('去重后 POC', r.uniquePocCount || r.pocFileCount || 0, 'fg-good')}
            ${stat('重复 POC', r.duplicatePocCount || 0, (r.duplicatePocCount || 0) ? 'fg-warn' : 'fg-good')}
            ${stat('已按指纹归类', r.classifiedPocCount || 0, (r.classifiedPocCount || 0) ? 'fg-good' : '')}
            ${stat('组件分组', r.componentCount || 0)}
            ${stat('未匹配指纹 POC', r.unmatchedPocCount || 0, (r.unmatchedPocCount || 0) ? 'fg-bad' : 'fg-good')}
            ${stat('残缺 POC', r.incompletePocCount || 0, (r.incompletePocCount || 0) ? 'fg-bad' : 'fg-good')}
        </div>
        <div class="fg-paths">
            <div><b>dddd:</b> <code>${escapeHtml(r.projectRoot || '')}</code></div>
            <div><b>finger:</b> <code>${escapeHtml(r.fingerPath || '')}</code></div>
            <div><b>source:</b> <code>${escapeHtml(r.sourceDir || r.pocDir || '')}</code></div>
        </div>`;
    elResult.innerHTML = [
        renderPocCatalogGroups(r.groups || [], r.sourceType || 'external'),
        `<div class="fg-result-grid">
            ${renderFingerprintPocDetailTable('去重后外部 POC', r.uniquePocCount || (r.allPocs || []).length, r.allPocs)}
            ${renderPocDuplicateTable('重复 POC', r.duplicatePocCount, r.duplicatePocs)}
            ${renderFingerprintPocDetailTable('未匹配 dddd 指纹的外部 POC', r.unmatchedPocCount, r.unmatchedPocs)}
            ${renderFingerprintPocDetailTable('残缺不完整外部 POC', r.incompletePocCount, r.incompletePocs)}
        </div>`,
    ].join('');
}

function renderPocDuplicateTable(title, total, items) {
    const list = items || [];
    const rows = list.map((x) => `
        <tr>
            <td title="${escapeHtml(x.reason || '')}">${escapeHtml(x.reason || '')}</td>
            <td title="${escapeHtml(x.keptRelPath || x.keptPath || '')}">${escapeHtml(x.keptRelPath || x.keptPath || '')}</td>
            <td title="${escapeHtml(x.duplicateRelPath || x.duplicatePath || '')}">${escapeHtml(x.duplicateRelPath || x.duplicatePath || '')}</td>
            <td title="${escapeHtml(x.key || '')}">${escapeHtml(x.key || '')}</td>
        </tr>`).join('');
    const body = rows ? `
        <table class="fg-table">
            <thead><tr><th>原因</th><th>保留</th><th>重复</th><th>去重键</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>` : '';
    return renderFingerprintSection(title, total || 0, body, list.length);
}

function renderFingerprintImportPreview(r, elSummary, elResult) {
    const stat = (label, value, tone = '') => `
        <div class="fg-stat ${tone}">
            <div class="fg-stat-value">${escapeHtml(value)}</div>
            <div class="fg-stat-label">${escapeHtml(label)}</div>
        </div>`;
    elSummary.innerHTML = `
        <div class="fg-stat-grid">
            ${stat('扫描文件', r.scannedFiles || 0)}
            ${stat('解析文件', r.parsedFiles || 0)}
            ${stat('跳过文件', r.skippedFiles || 0, (r.skippedFiles || 0) ? 'fg-warn' : 'fg-good')}
            ${stat('候选项', r.candidateCount || 0)}
            ${stat('产品数', r.productCount || 0)}
            ${stat('规则数', r.ruleCount || 0)}
            ${stat('高置信规则', r.highConfidenceCount || 0, (r.highConfidenceCount || 0) ? 'fg-good' : '')}
            ${stat('泛化规则', r.genericRuleCount || 0, (r.genericRuleCount || 0) ? 'fg-warn' : 'fg-good')}
            ${stat('重复规则', r.duplicateRuleCount || 0, (r.duplicateRuleCount || 0) ? 'fg-warn' : 'fg-good')}
            ${stat('合并建议', r.mergeSuggestionCount || 0, (r.mergeSuggestionCount || 0) ? 'fg-warn' : 'fg-good')}
        </div>
        <div class="fg-paths">
            <div><b>source:</b> <code>${escapeHtml(r.sourceDir || '')}</code></div>
            <div><b>target:</b> <code>${escapeHtml(r.targetFingerPath || '未选择目标项目目录，仅生成独立预览')}</code></div>
        </div>`;

    const itemRows = (r.items || []).map((x) => {
        const firstRules = (x.rules || []).slice(0, 3).map((rule) => rule.expression).join('\n');
        const warn = (x.warnings || []).join('\n');
        return `
        <tr>
            <td title="${escapeHtml(x.product || '')}">${escapeHtml(x.product || '')}</td>
            <td title="${escapeHtml(x.normalizedProduct || '')}">${escapeHtml(x.normalizedProduct || '')}</td>
            <td><span class="fg-quality fg-quality-${escapeHtml(x.quality || 'low')}">${escapeHtml(x.quality || '')} ${escapeHtml(x.qualityScore || 0)}</span></td>
            <td>${escapeHtml((x.rules || []).length)}</td>
            <td title="${escapeHtml(x.relPath || '')}">${escapeHtml(x.relPath || '')}</td>
            <td title="${escapeHtml(firstRules)}">${escapeHtml(firstRules || '-')}</td>
            <td title="${escapeHtml(warn)}">${escapeHtml(warn || '-')}</td>
        </tr>`;
    }).join('');
    const itemsBody = itemRows ? `
        <table class="fg-table fg-import-items">
            <thead><tr><th>产品</th><th>归一化</th><th>质量</th><th>规则</th><th>来源</th><th>规则示例</th><th>提示</th></tr></thead>
            <tbody>${itemRows}</tbody>
        </table>` : '';

    const mergeBody = renderFingerprintTable('合并建议', r.mergeSuggestionCount, r.mergeSuggestions, ['归一化名称', '已有产品', '导入产品'], (x) => [
        x.normalizedProduct,
        (x.existing || []).join(', ') || '-',
        (x.imported || []).join(', ') || '-',
    ]);
    const duplicateBody = renderFingerprintTable('导入重复规则', r.duplicateRuleCount, r.duplicateRules, ['规则', '产品'], (x) => [x.rule, (x.products || []).join(', ')]);
    const skippedBody = renderFingerprintTable('跳过文件', r.skippedFiles, r.skipped, ['文件', '原因'], (x) => [x.relPath || x.path, x.reason]);
    const yamlText = r.ddddYaml || '';
    const patchText = r.patchPreview || '';
    const yamlPreview = yamlText.length > 200000 ? yamlText.slice(0, 200000) + '\n... (预览已截断，复制按钮仍复制完整 YAML)' : yamlText;
    const patchPreview = patchText.length > 120000 ? patchText.slice(0, 120000) + '\n... (预览已截断，复制按钮仍复制完整 Patch)' : patchText;
    const yamlBlock = `
        <details class="fg-section fg-code-section" ${yamlText.length > 200000 ? '' : 'open'}>
            <summary>finger.yaml 预览 <span>${escapeHtml(yamlText.split('\n').filter(Boolean).length)} 行${yamlText.length > yamlPreview.length ? ' · 已截断展示' : ''}</span></summary>
            <div class="fg-code-actions"><button class="fg-reveal" data-copy="yaml">复制 YAML</button></div>
            <pre id="fg-import-yaml" class="fg-code">${escapeHtml(yamlPreview)}</pre>
        </details>`;
    const patchBlock = `
        <details class="fg-section fg-code-section">
            <summary>Patch / 写回预览 <span>dry-run${patchText.length > patchPreview.length ? ' · 已截断展示' : ''}</span></summary>
            <div class="fg-code-actions"><button class="fg-reveal" data-copy="patch">复制 Patch 预览</button></div>
            <pre id="fg-import-patch" class="fg-code">${escapeHtml(patchPreview)}</pre>
        </details>`;
    const applyBlock = `
        <details class="fg-section fg-apply-section">
            <summary>人工确认写回 finger.yaml <span>需要备份 + 二次确认</span></summary>
            <div class="fg-apply-box">
                <div>写回会先备份目标 <code>finger.yaml</code>，再按归一化产品合并并去重规则。</div>
                <input id="fg-import-confirm" class="yaml-path-input" placeholder="输入 APPLY_FINGERPRINT_IMPORT 后才能写回" spellcheck="false" />
                <button id="fg-import-apply" class="btn btn-primary">写回 finger.yaml</button>
                <div id="fg-import-apply-status"></div>
            </div>
        </details>`;

    elResult.innerHTML = [
        renderFingerprintClassView(r),
        `<div class="fg-result-grid">
            ${renderFingerprintSection('导入候选', (r.items || []).length, itemsBody, (r.items || []).length)}
            ${mergeBody}
            ${duplicateBody}
            ${skippedBody}
        </div>`,
        yamlBlock,
        patchBlock,
        applyBlock,
    ].join('');
}

function renderFingerprintSection(title, total, body, shown = 0) {
    const suffix = total > shown ? ` · 显示前 ${shown} 条` : '';
    return `
    <details class="fg-section" open>
        <summary>${escapeHtml(title)} <span>${escapeHtml(total || 0)}${escapeHtml(suffix)}</span></summary>
        ${body || '<div class="fg-empty">暂无问题</div>'}
    </details>`;
}

function renderFingerprintTable(title, total, items, headers, rowFn) {
    const list = items || [];
    const rows = list.map((item) => {
        const cols = rowFn(item).map((v) => `<td title="${escapeHtml(v)}">${escapeHtml(v)}</td>`).join('');
        return `<tr>${cols}</tr>`;
    }).join('');
    const body = rows ? `
        <table class="fg-table">
            <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
        </table>` : '';
    return renderFingerprintSection(title, total || 0, body, list.length);
}

function renderFingerprintPocTable(title, total, items) {
    const list = items || [];
    const rows = list.map((x) => `
        <tr>
            <td title="${escapeHtml(x.relPath || x.name || '')}">${escapeHtml(x.relPath || x.name || '')}</td>
            <td title="${escapeHtml(x.id || '')}">${escapeHtml(x.id || '-')}</td>
            <td><button class="fg-reveal" data-path="${escapeHtml(x.path || '')}">定位</button></td>
        </tr>`).join('');
    const body = rows ? `
        <table class="fg-table fg-poc-table">
            <thead><tr><th>文件</th><th>ID</th><th>操作</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>` : '';
    return renderFingerprintSection(title, total || 0, body, list.length);
}

function renderFingerprintPocDetailTable(title, total, items) {
    const list = items || [];
    const rows = list.map((x) => {
        const workflow = (x.workflowProducts || []).join(', ') || (x.referencedByWorkflow ? '已引用' : '未引用');
        const matched = x.matchedProduct ? `${x.matchedProduct} (${x.matchConfidence || 0})` : '-';
        const issues = (x.issues || []).join('\n') || (x.incomplete ? '不完整' : '-');
        return `
        <tr>
            <td title="${escapeHtml(x.relPath || x.name || '')}">${escapeHtml(x.relPath || x.name || '')}</td>
            <td title="${escapeHtml(x.id || '')}">${escapeHtml(x.id || '-')}</td>
            <td title="${escapeHtml(x.infoName || '')}">${escapeHtml(x.infoName || '-')}</td>
            <td title="${escapeHtml(matched)}">${escapeHtml(matched)}</td>
            <td title="${escapeHtml(workflow)}">${escapeHtml(workflow)}</td>
            <td title="${escapeHtml(issues)}">${escapeHtml(issues)}</td>
            <td><button class="fg-reveal" data-path="${escapeHtml(x.path || '')}">定位</button></td>
        </tr>`;
    }).join('');
    const body = rows ? `
        <table class="fg-table fg-poc-detail-table">
            <thead><tr><th>文件</th><th>ID</th><th>info.name</th><th>匹配指纹</th><th>Workflow</th><th>问题</th><th>操作</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>` : '';
    return renderFingerprintSection(title, total || 0, body, list.length);
}

function renderFingerprintPocFingerTable(title, total, items) {
    const list = items || [];
    const rows = list.map((x) => `
        <tr>
            <td title="${escapeHtml(x.product || '')}">${escapeHtml(x.product || '')}</td>
            <td title="${escapeHtml(x.pocRelPath || x.poc || '')}">${escapeHtml(x.pocRelPath || x.poc || '')}</td>
            <td title="${escapeHtml(x.pocId || '')}">${escapeHtml(x.pocId || '-')}</td>
            <td title="${escapeHtml(x.confidence || 0)}">${escapeHtml(x.confidence || 0)}</td>
            <td title="${escapeHtml(x.reason || '')}">${escapeHtml(x.reason || '')}</td>
            <td><button class="fg-reveal" data-path="${escapeHtml(x.path || '')}">定位</button></td>
        </tr>`).join('');
    const body = rows ? `
        <table class="fg-table fg-poc-finger-table">
            <thead><tr><th>指纹</th><th>POC 文件</th><th>ID</th><th>置信</th><th>匹配依据</th><th>操作</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>` : '';
    return renderFingerprintSection(title, total || 0, body, list.length);
}

function renderPocCatalogGroups(groups, sourceType = 'builtin') {
    const list = groups || [];
    const isExternal = sourceType === 'external';
    const cards = list.map((g, i) => {
        const pocs = (g.pocs || []).slice(0, 80).map((p) => {
            const flags = (isExternal ? [
                p.incomplete ? '残缺' : '',
                p.matchConfidence ? `${p.matchConfidence}` : '',
            ] : [
                p.referencedByWorkflow ? 'workflow' : '虚空',
                p.incomplete ? '残缺' : '',
                p.matchConfidence ? `${p.matchConfidence}` : '',
            ]).filter(Boolean).join(' · ');
            return `
                <div class="fg-poc-mini-row">
                    <button class="fg-reveal" data-path="${escapeHtml(p.path || '')}">定位</button>
                    <span title="${escapeHtml(p.relPath || p.name || '')}">${escapeHtml(p.relPath || p.name || '')}</span>
                    <em>${escapeHtml(flags)}</em>
                </div>`;
        }).join('');
        const more = (g.pocs || []).length > 80 ? `<div class="fg-empty">还有 ${(g.pocs || []).length - 80} 个 POC 未展示，可看详情列表。</div>` : '';
        const meta = isExternal
            ? `指纹规则 ${escapeHtml(g.fingerRuleCount || 0)} · 外部 POC ${escapeHtml(g.pocCount || 0)} · 残缺 ${escapeHtml(g.incompletePocCount || 0)}`
            : `指纹规则 ${escapeHtml(g.fingerRuleCount || 0)} · workflow 引用 ${escapeHtml(g.workflowPocCount || 0)} · 可调用 ${escapeHtml(g.referencedPocCount || 0)} · 虚空 ${escapeHtml(g.unreferencedPocCount || 0)} · 残缺 ${escapeHtml(g.incompletePocCount || 0)}`;
        return `
        <section class="fg-class-card" id="pc-group-${i}">
            <div class="fg-class-card-head">
                <b title="${escapeHtml(g.product || '')}">${escapeHtml(g.product || '')}</b>
                <span>${escapeHtml(g.pocCount || 0)} 个 POC</span>
            </div>
            <div class="fg-poc-group-meta">
                ${meta}
            </div>
            <div class="fg-poc-mini-list">${pocs || '<div class="fg-empty">暂无 POC</div>'}${more}</div>
        </section>`;
    }).join('');
    const body = cards ? `<div class="fg-catalog-groups">${cards}</div>` : '';
    return renderFingerprintSection('按组件指纹归类', list.length, body, list.length);
}

function renderFingerprintList(title, total, items) {
    const list = items || [];
    const body = list.length
        ? `<div class="fg-chip-list">${list.map((x) => `<span class="fg-chip" title="${escapeHtml(x)}">${escapeHtml(x)}</span>`).join('')}</div>`
        : '';
    return renderFingerprintSection(title, total || 0, body, list.length);
}

// ============================================================
// 路由 / 侧栏
// ============================================================

const routes = {
    'fingerprint-governance': { module: '辅助模块', name: 'dddd 能力对比', render: renderFingerprintGovernance },
    'poc-catalog':       { module: '辅助模块', name: '外部 POC 归类', render: renderPocCatalog      },
    'dddd-fingerprint-converter': { module: '转换模块', name: '外部指纹导入', render: renderDDDDFingerprintConverter },
};

const moduleByTool = {
    'fingerprint-governance': 'aux',
    'poc-catalog':       'aux',
    'dddd-fingerprint-converter': 'convert',
};

// 持久化当前路由 key, 跨次启动 / wails dev 热重载后能回到上次的页面.
// 否则用户在 POC 转换页加载大目录时, 任何重载 (open file save / hot reload)
// 都会把页面甩回默认的 yaml-converter, 看起来像 "突然跳转".
const ROUTE_KEY = 'doperationtool.route';
function saveRoute(toolId) {
    try { localStorage.setItem(ROUTE_KEY, toolId); } catch (e) {}
}
function loadRoute() {
    try { return localStorage.getItem(ROUTE_KEY) || ''; } catch (e) { return ''; }
}

function navigate(toolId) {
    const route = routes[toolId];
    if (!route) return;
    // DIAG: 临时日志, 排查 "加载 Awesome-POC 时自动跳转" 问题. 把调用栈打出来.
    // 复现后看 console 第一条非用户点击触发的 navigate 是谁调的.
    try {
        console.log('[nav]', toolId, 'at', new Date().toISOString());
        console.trace('[nav-stack]');
    } catch (e) {}
    saveRoute(toolId);

    // 高亮侧栏
    document.querySelectorAll('.module-item[data-tool]').forEach((el) => {
        el.classList.toggle('active', el.dataset.tool === toolId);
    });

    // 面包屑
    document.getElementById('bc-current').textContent = route.name;

    // 渲染主区
    const container = document.getElementById('main-content');
    container.innerHTML = '';
    route.render(container);
}

// 侧栏点击
document.querySelectorAll('.submenu-item').forEach((el) => {
    el.addEventListener('click', (e) => {
        console.log('[submenu-click]', el.dataset.tool, 'event:', e.type, 'isTrusted:', e.isTrusted, 'target:', e.target);
        navigate(el.dataset.tool);
    });
});

// DIAG: 捕获捕获阶段的全局 click, 看到底是谁在点 submenu / 触发 nav.
// 真用户点击 isTrusted=true; 程序触发的 .click() / dispatchEvent 是 false.
document.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof HTMLElement) {
        const submenu = t.closest('.submenu-item');
        if (submenu) {
            console.log('[global-click] submenu hit', submenu.dataset.tool, 'isTrusted:', e.isTrusted, 'phase:', e.eventPhase);
            console.trace('[global-click-stack]');
        }
    }
}, true); // capture 阶段

// 全局未捕获异常和 promise reject 也记下来
window.addEventListener('error', (e) => console.error('[window-error]', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[unhandled-rejection]', e.reason));

// 启动: 优先恢复上次访问的页面, 否则默认进 dddd 能力对比.
// 用 routes 校验避免老 localStorage 残留指向已删的工具.
{
    const last = loadRoute();
    const target = last && routes[last] ? last : 'fingerprint-governance';
    console.log('[boot] last route =', last, '→ navigating to', target);
    navigate(target);
}
