import {
    MoveTemplateDuplicates,
    RevealInFileManager,
    ScanDuplicateTemplates,
    SelectDirectory,
} from '../../../wailsjs/go/main/App.js';
import { toast } from '../../core/feedback.js';
import { escapeHtml, formatBytes } from '../../core/format.js';
import { progressTracker } from '../../core/progress.js';

// ============================================================
// 模块: 模板去重 (支撑工具 / 模板去重)
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

export { renderTemplateDedup };
