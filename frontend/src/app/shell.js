import logoDark from '../assets/images/logo-dark.png';
import logoLight from '../assets/images/logo-light.png';
import { WindowToggleMaximise } from '../../wailsjs/runtime/runtime.js';
import { navigate } from './navigation.js';

const THEME_KEY = 'doperationtool.theme';
const SIDEBAR_KEY = 'doperationtool.sidebar';
const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_KEYBOARD_STEP = 8;

function clampSidebarWidth(width) {
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function readTheme() {
    try {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved === 'light' || saved === 'dark') return saved;
    } catch (error) { /* storage is optional */ }
    return 'dark';
}

function readSidebarState() {
    const state = { width: 220, hidden: false };
    try {
        const saved = JSON.parse(localStorage.getItem(SIDEBAR_KEY) || '{}');
        if (typeof saved.width === 'number' && saved.width >= SIDEBAR_MIN_WIDTH && saved.width <= SIDEBAR_MAX_WIDTH) {
            state.width = saved.width;
        }
        if (typeof saved.hidden === 'boolean') state.hidden = saved.hidden;
    } catch (error) { /* storage is optional */ }
    return state;
}

export function mountAppShell(root = document.querySelector('#app')) {
    const themeState = { current: readTheme() };
    const sidebarState = readSidebarState();
    document.documentElement.dataset.theme = themeState.current;

    const themeLogo = () => themeState.current === 'light' ? logoLight : logoDark;
    root.innerHTML = `
<div class="app-titlebar"></div>
<aside class="sidebar${sidebarState.hidden ? ' hidden' : ''}" id="sidebar" style="width:${sidebarState.width}px"${sidebarState.hidden ? ' inert aria-hidden="true"' : ' aria-hidden="false"'}>
    <div class="sidebar-header">
        <div class="sidebar-brand">
            <img class="sidebar-logo" id="sidebar-logo" src="${themeLogo()}" alt="Doperationtool" />
            <div class="sidebar-brand-text">
                <div class="sidebar-title">Doperationtool</div>
                <div class="sidebar-subtitle">v0.2 · dddd 运维台</div>
            </div>
        </div>
        <button class="sidebar-collapse" id="btn-sidebar-collapse" title="收起侧栏" aria-label="收起侧栏" aria-controls="sidebar" aria-expanded="${!sidebarState.hidden}">‹</button>
    </div>
    <nav class="module-list" id="module-list" aria-label="主要功能">
        <button type="button" class="module-item" data-tool="fingerprint-governance"><span class="module-icon">A</span><span class="module-label">dddd 能力对比</span></button>
        <button type="button" class="module-item" data-tool="poc-catalog"><span class="module-icon">P</span><span class="module-label">外部 POC 归类</span></button>
        <button type="button" class="module-item" data-tool="dddd-fingerprint-converter"><span class="module-icon">F</span><span class="module-label">外部指纹导入</span></button>
        <button type="button" class="module-item" data-tool="external-capability"><span class="module-icon">I</span><span class="module-label">能力接入</span></button>
    </nav>
    <div class="sidebar-footer">© 2026 Doperationtool</div>
    <div class="sidebar-resizer" id="sidebar-resizer" title="拖动调整宽度" role="separator" tabindex="0" aria-orientation="vertical" aria-valuemin="${SIDEBAR_MIN_WIDTH}" aria-valuemax="${SIDEBAR_MAX_WIDTH}" aria-valuenow="${sidebarState.width}" aria-label="调整侧栏宽度"></div>
</aside>
<main class="main">
    <header class="main-header">
        <button class="sidebar-toggle" id="btn-sidebar-toggle" title="收起/展开侧栏 (⌘B)" aria-label="收起或展开侧栏" aria-controls="sidebar" aria-expanded="${!sidebarState.hidden}">☰</button>
        <div class="breadcrumb"><span class="breadcrumb-current" id="bc-current">dddd 能力对比</span></div>
        <div class="header-actions">
            <button class="theme-toggle" id="btn-theme-toggle" title="切换浅色/深色模式" aria-label="切换浅色或深色模式"><span class="theme-icon" id="theme-icon"></span></button>
        </div>
    </header>
    <div class="main-content" id="main-content"></div>
</main>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<div class="global-progress" id="global-progress" hidden role="status" aria-live="polite">
    <div class="gp-head">
        <span class="gp-title" id="gp-title">…</span>
        <span class="gp-elapsed" id="gp-elapsed"></span>
        <button class="gp-cancel" id="gp-cancel" title="取消当前任务" aria-label="取消当前任务">✕</button>
    </div>
    <div class="gp-bar"><div class="gp-fill" id="gp-fill"></div></div>
    <div class="gp-meta"><span class="gp-phase" id="gp-phase"></span><span class="gp-label" id="gp-label"></span></div>
</div>`;

    const sidebar = document.getElementById('sidebar');
    const resizer = document.getElementById('sidebar-resizer');
    const toggleButton = document.getElementById('btn-sidebar-toggle');
    const collapseButton = document.getElementById('btn-sidebar-collapse');
    const themeButton = document.getElementById('btn-theme-toggle');
    let resizeSession = null;

    function saveSidebar() {
        try { localStorage.setItem(SIDEBAR_KEY, JSON.stringify(sidebarState)); } catch (error) { /* optional */ }
    }

    function applyTheme() {
        document.documentElement.dataset.theme = themeState.current;
        document.getElementById('sidebar-logo').src = themeLogo();
        document.getElementById('theme-icon').textContent = themeState.current === 'light' ? '☀' : '☾';
        const next = themeState.current === 'light' ? '深色' : '浅色';
        themeButton.title = `当前${themeState.current === 'light' ? '浅色' : '深色'}模式，点击切换${next}模式`;
        themeButton.setAttribute('aria-label', `切换${next}模式`);
    }

    function setSidebarWidth(width) {
        const nextWidth = clampSidebarWidth(width);
        sidebarState.width = nextWidth;
        sidebar.style.width = `${nextWidth}px`;
        resizer.setAttribute('aria-valuenow', String(nextWidth));
    }

    function syncSidebar() {
        if (sidebarState.hidden && sidebar.contains(document.activeElement)) {
            toggleButton.focus({ preventScroll: true });
        }
        sidebar.classList.toggle('hidden', sidebarState.hidden);
        sidebar.toggleAttribute('inert', sidebarState.hidden);
        sidebar.setAttribute('aria-hidden', String(sidebarState.hidden));
        toggleButton.setAttribute('aria-expanded', String(!sidebarState.hidden));
        collapseButton.setAttribute('aria-expanded', String(!sidebarState.hidden));
        collapseButton.textContent = sidebarState.hidden ? '›' : '‹';
        collapseButton.title = sidebarState.hidden ? '展开侧栏' : '收起侧栏';
        collapseButton.setAttribute('aria-label', collapseButton.title);
    }

    function toggleSidebar() {
        sidebarState.hidden = !sidebarState.hidden;
        syncSidebar();
        saveSidebar();
    }

    function onPointerDown(event) {
        if (sidebarState.hidden || event.button !== 0 || resizeSession) return;
        const bounds = sidebar.getBoundingClientRect();
        resizeSession = {
            pointerId: event.pointerId,
            grabOffset: event.clientX - bounds.right,
            sidebarLeft: bounds.left,
            bodyCursor: document.body.style.cursor,
            bodyUserSelect: document.body.style.userSelect,
        };
        if (typeof resizer.setPointerCapture === 'function') {
            resizer.setPointerCapture(event.pointerId);
        }
        resizer.focus({ preventScroll: true });
        sidebar.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        event.preventDefault();
    }

    function onPointerMove(event) {
        if (!resizeSession || event.pointerId !== resizeSession.pointerId) return;
        const width = event.clientX - resizeSession.grabOffset - resizeSession.sidebarLeft;
        setSidebarWidth(width);
        event.preventDefault();
    }

    function finishResize(event) {
        if (!resizeSession) return;
        if (event?.pointerId !== undefined && event.pointerId !== resizeSession.pointerId) return;

        const session = resizeSession;
        resizeSession = null;
        sidebar.classList.remove('resizing');
        document.body.style.cursor = session.bodyCursor;
        document.body.style.userSelect = session.bodyUserSelect;
        saveSidebar();

        if (event?.type !== 'lostpointercapture'
            && typeof resizer.hasPointerCapture === 'function'
            && resizer.hasPointerCapture(session.pointerId)
            && typeof resizer.releasePointerCapture === 'function') {
            resizer.releasePointerCapture(session.pointerId);
        }
    }

    function onResizerKeyDown(event) {
        if (sidebarState.hidden) return;
        let nextWidth;
        if (event.key === 'ArrowLeft') nextWidth = sidebarState.width - SIDEBAR_KEYBOARD_STEP;
        else if (event.key === 'ArrowRight') nextWidth = sidebarState.width + SIDEBAR_KEYBOARD_STEP;
        else if (event.key === 'Home') nextWidth = SIDEBAR_MIN_WIDTH;
        else if (event.key === 'End') nextWidth = SIDEBAR_MAX_WIDTH;
        else return;

        event.preventDefault();
        setSidebarWidth(nextWidth);
        saveSidebar();
    }

    function onKeyDown(event) {
        const modifier = event.metaKey || event.ctrlKey;
        if (!modifier) return;
        if (event.shiftKey && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            try { WindowToggleMaximise(); } catch (error) { /* browser preview */ }
            return;
        }
        if (!event.shiftKey && event.key.toLowerCase() === 's') {
            const saveButton = document.getElementById('btn-src-save');
            if (!saveButton || saveButton.disabled) return;
            event.preventDefault();
            saveButton.click();
            return;
        }
        if (!event.shiftKey && event.key.toLowerCase() === 'b') {
            event.preventDefault();
            toggleSidebar();
        }
    }

    function onDoubleClick(event) {
        if (!(event.target instanceof HTMLElement)) return;
        if (!event.target.closest('.app-titlebar, .sidebar-header, .main-header')) return;
        try { WindowToggleMaximise(); } catch (error) { /* browser preview */ }
    }

    resizer.addEventListener('pointerdown', onPointerDown);
    resizer.addEventListener('pointermove', onPointerMove);
    resizer.addEventListener('pointerup', finishResize);
    resizer.addEventListener('pointercancel', finishResize);
    resizer.addEventListener('lostpointercapture', finishResize);
    resizer.addEventListener('keydown', onResizerKeyDown);
    toggleButton.addEventListener('click', toggleSidebar);
    collapseButton.addEventListener('click', toggleSidebar);
    themeButton.addEventListener('click', () => {
        themeState.current = themeState.current === 'light' ? 'dark' : 'light';
        try { localStorage.setItem(THEME_KEY, themeState.current); } catch (error) { /* optional */ }
        applyTheme();
    });
    document.querySelectorAll('.module-item[data-tool]').forEach((item) => {
        item.addEventListener('click', () => navigate(item.dataset.tool));
    });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('dblclick', onDoubleClick);
    syncSidebar();
    applyTheme();

    return {
        dispose() {
            finishResize();
            resizer.removeEventListener('pointerdown', onPointerDown);
            resizer.removeEventListener('pointermove', onPointerMove);
            resizer.removeEventListener('pointerup', finishResize);
            resizer.removeEventListener('pointercancel', finishResize);
            resizer.removeEventListener('lostpointercapture', finishResize);
            resizer.removeEventListener('keydown', onResizerKeyDown);
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('dblclick', onDoubleClick);
        },
    };
}
