import {
    ApplyTemplateCategories,
    RevealInFileManager,
    ScanTemplateCategories,
    SelectDirectory,
} from '../../../wailsjs/go/main/App.js';
import { toast } from '../../core/feedback.js';
import { escapeHtml } from '../../core/format.js';

// ============================================================
// 模块: 模板分类 (支撑工具 / 模板分类)
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

export { renderTemplateClassify };
