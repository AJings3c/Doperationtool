import {
    ApplyYamlCollection,
    RevealInFileManager,
    ScanYamlCollection,
    SelectDirectory,
} from '../../../wailsjs/go/main/App.js';
import { toast } from '../../core/feedback.js';
import { escapeHtml, formatBytes } from '../../core/format.js';
import { progressTracker } from '../../core/progress.js';

// ============================================================
// 模块: YAML 采集 (支撑工具 / YAML 采集)
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

export { renderYamlCollect };
