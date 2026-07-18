import {
    ClassifyExternalPocsByDDDD,
    RevealInFileManager,
    SaveExternalPocReview,
    SelectDirectory,
} from '../../../wailsjs/go/main/App.js';
import { navigate } from '../../app/navigation.js';
import { copyToClipboard, openWithDefault, showContextMenu, toast } from '../../core/feedback.js';
import { escapeHtml, isTaskCancelledError } from '../../core/format.js';
import { progressTracker } from '../../core/progress.js';
import { createRouteScope } from '../../core/routeScope.js';
import { fingerGovState, pushFingerHistory, renderFingerHistoryChips, saveFingerGovState } from './state.js';
import { renderFingerprintPocDetailTable, renderFingerprintSection, renderPocCatalogGroups } from './views.js';

function renderPocCatalog(container) {
    container.innerHTML = `
    <div class="fingerprint-governance poc-catalog">
        <div class="extractor-tip">
            🧩 这里加载外部 POC 目录，先按 <code>id / 内容哈希 / 文件名</code> 去重，再按 dddd <code>finger.yaml ∪ dir.yaml</code> 的可识别产品归类，方便判断外部 POC 覆盖哪些 dddd 组件。
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
            <button class="btn btn-primary" id="pc-run">▶️ 去重并按 dddd 识别入口归类</button>
            <button class="btn" id="pc-save-review">保存审核结果</button>
        </div>
        <div class="nv-history" id="pc-src-history"></div>
        <div class="fg-summary" id="pc-summary"></div>
        <div class="fg-result" id="pc-result"></div>
    </div>`;
    return setupPocCatalog();
}

function setupPocCatalog() {
    const scope = createRouteScope();
    const elRoot = document.getElementById('pc-root');
    const elSrc = document.getElementById('pc-src');
    const elPick = document.getElementById('pc-pick');
    const elSrcPick = document.getElementById('pc-src-pick');
    const elAudit = document.getElementById('pc-open-audit');
    const elRun = document.getElementById('pc-run');
    const elSaveReview = document.getElementById('pc-save-review');
    const elHist = document.getElementById('pc-history');
    const elSrcHist = document.getElementById('pc-src-history');
    const elSummary = document.getElementById('pc-summary');
    const elResult = document.getElementById('pc-result');
    let currentReview = null;
    let removedPocs = [];

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
            const f = await scope.guard(SelectDirectory());
            if (!f) return;
            elRoot.value = f;
            pushFingerHistory('history', 'root', f);
            renderHistory();
        } catch (err) {
            if (!isTaskCancelledError(err)) toast(`选择失败: ${err}`, 'error');
        }
    });
    elSrcPick.addEventListener('click', async () => {
        try {
            const f = await scope.guard(SelectDirectory());
            if (!f) return;
            elSrc.value = f;
            pushFingerHistory('pocHistory', 'pocDir', f);
            renderHistory();
        } catch (err) {
            if (!isTaskCancelledError(err)) toast(`选择失败: ${err}`, 'error');
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
    elSaveReview.addEventListener('click', savePocReview);
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
    elResult.addEventListener('dblclick', (e) => {
        const row = e.target.closest && e.target.closest('[data-poc-path]');
        if (!row || !elResult.contains(row)) return;
        RevealInFileManager(row.dataset.pocPath).catch((err) => toast(String(err), 'error'));
    });
    elResult.addEventListener('contextmenu', (e) => {
        const row = e.target.closest && e.target.closest('[data-poc-path]');
        if (!row || !elResult.contains(row)) return;
        e.preventDefault();
        const path = row.dataset.pocPath || '';
        const relPath = row.dataset.pocRel || path;
        showContextMenu(e.clientX, e.clientY, [
            { label: '在文件管理器中定位', onClick: () => RevealInFileManager(path).catch((err) => toast(String(err), 'error')) },
            { label: '用默认应用打开', onClick: () => openWithDefault(path) },
            { separator: true },
            { label: '从本次审核结果中移除', danger: true, onClick: () => removePocFromReview(path, relPath) },
        ]);
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
        elResult.innerHTML = `<div class="yaml-empty">正在扫描 ${escapeHtml(sourceDir)}，并按 ${escapeHtml(root)} 的 dddd 识别入口归类…</div>`;
        const progressTask = progressTracker.start('fingerprint:external_poc_catalog:progress', '外部 POC 归类');
        try {
            const r = await scope.guard(ClassifyExternalPocsByDDDD(root, sourceDir));
            currentReview = r;
            removedPocs = [];
            renderPocCatalogResult(r, elSummary, elResult);
            pushFingerHistory('history', 'root', root);
            pushFingerHistory('pocHistory', 'pocDir', sourceDir);
            renderHistory();
            const score = (r.duplicatePocCount || 0) + (r.unmatchedPocCount || 0) + (r.incompletePocCount || 0);
            toast(score > 0 ? `⚠️ 归类完成: 发现 ${score} 个重点问题 (${r.elapsed})` : `✅ 归类完成 (${r.elapsed})`, score > 0 ? 'error' : 'success');
        } catch (err) {
            progressTask.end();
            if (!scope.active) return;
            const msg = String(err);
            if (isTaskCancelledError(err)) {
                elResult.innerHTML = `<div class="yaml-empty">已取消外部 POC 归类。</div>`;
                toast('已取消外部 POC 归类', 'info');
            } else {
                elResult.innerHTML = `<div class="poc-validate-fail">❌ 归类失败: ${escapeHtml(msg)}</div>`;
                toast(msg, 'error');
            }
        } finally {
            if (scope.active) {
                elRun.disabled = false;
                elPick.disabled = false;
                elSrcPick.disabled = false;
                elRun.textContent = oldLabel;
            }
        }
    }

    function removePocFromReview(path, relPath) {
        if (!currentReview) return;
        removedPocs.push({ path, relPath, reason: '人工从本次加载结果移除' });
        currentReview = filterPocCatalogResult(currentReview, path);
        renderPocCatalogResult(currentReview, elSummary, elResult);
        toast(`已从本次结果移除: ${relPath}`, 'info');
    }

    async function savePocReview() {
        if (!currentReview || !(currentReview.allPocs || []).length) {
            toast('请先完成一次外部 POC 归类', 'error');
            return;
        }
        elSaveReview.disabled = true;
        try {
            const r = await scope.guard(SaveExternalPocReview({
                projectRoot: elRoot.value.trim(),
                sourceDir: elSrc.value.trim(),
                items: currentReview.allPocs || [],
                duplicates: currentReview.duplicatePocs || [],
                removed: removedPocs,
            }));
            pushFingerHistory('pocReviewHistory', 'pocReviewDir', r.dir || '');
            toast(`✅ POC 审核结果已保存: ${r.dir}`, 'success');
        } catch (err) {
            if (!isTaskCancelledError(err)) toast(`保存失败: ${err}`, 'error');
        } finally {
            if (scope.active) elSaveReview.disabled = false;
        }
    }

    return () => scope.dispose();
}

function renderPocCatalogResult(r, elSummary, elResult) {
    const stat = (label, value, tone = '') => `
        <div class="fg-stat ${tone}">
            <div class="fg-stat-value">${escapeHtml(value)}</div>
            <div class="fg-stat-label">${escapeHtml(label)}</div>
        </div>`;
    elSummary.innerHTML = `
        <div class="fg-stat-grid">
            ${stat('finger 产品', r.fingerCount || 0)}
            ${stat('dir 产品', r.dirCount || 0)}
            ${stat('dir 路径', r.dirPathCount || 0)}
            ${stat('可识别产品', r.recognitionProductCount || r.fingerCount || 0, 'fg-good')}
            ${stat('扫描 POC 文件', r.pocFileCount || 0)}
            ${stat('去重后 POC', r.uniquePocCount || r.pocFileCount || 0, 'fg-good')}
            ${stat('重复 POC', r.duplicatePocCount || 0, (r.duplicatePocCount || 0) ? 'fg-warn' : 'fg-good')}
            ${stat('已按识别入口归类', r.classifiedPocCount || 0, (r.classifiedPocCount || 0) ? 'fg-good' : '')}
            ${stat('组件分组', r.componentCount || 0)}
            ${stat('未匹配识别入口 POC', r.unmatchedPocCount || 0, (r.unmatchedPocCount || 0) ? 'fg-bad' : 'fg-good')}
            ${stat('残缺 POC', r.incompletePocCount || 0, (r.incompletePocCount || 0) ? 'fg-bad' : 'fg-good')}
        </div>
        <div class="fg-paths">
            <div><b>dddd:</b> <code>${escapeHtml(r.projectRoot || '')}</code></div>
            <div><b>finger:</b> <code>${escapeHtml(r.fingerPath || '')}</code></div>
            <div><b>dir:</b> <code>${escapeHtml(r.dirPath || '')}</code></div>
            <div><b>source:</b> <code>${escapeHtml(r.sourceDir || r.pocDir || '')}</code></div>
        </div>`;
    elResult.innerHTML = [
        renderPocCatalogGroups(r.groups || [], r.sourceType || 'external'),
        `<div class="fg-result-grid">
            ${renderFingerprintPocDetailTable('去重后外部 POC', r.uniquePocCount || (r.allPocs || []).length, r.allPocs)}
            ${renderPocDuplicateTable('重复 POC', r.duplicatePocCount, r.duplicatePocs)}
            ${renderFingerprintPocDetailTable('未匹配 dddd 识别入口的外部 POC', r.unmatchedPocCount, r.unmatchedPocs)}
            ${renderFingerprintPocDetailTable('残缺不完整外部 POC', r.incompletePocCount, r.incompletePocs)}
        </div>`,
    ].join('');
}

function filterPocCatalogResult(result, path) {
    const r = { ...result };
    const same = (x) => (x && x.path) === path;
    r.allPocs = (result.allPocs || []).filter((x) => !same(x));
    r.unmatchedPocs = (result.unmatchedPocs || []).filter((x) => !same(x));
    r.virtualPocs = (result.virtualPocs || []).filter((x) => !same(x));
    r.incompletePocs = (result.incompletePocs || []).filter((x) => !same(x));
    r.duplicatePocs = (result.duplicatePocs || []).filter((x) => (x && x.duplicatePath) !== path && (x && x.keptPath) !== path);
    r.groups = (result.groups || []).map((g) => {
        const pocs = (g.pocs || []).filter((x) => !same(x));
        return {
            ...g,
            pocs,
            pocCount: pocs.length,
            referencedPocCount: pocs.filter((x) => x.referencedByWorkflow).length,
            unreferencedPocCount: pocs.filter((x) => !x.referencedByWorkflow).length,
            incompletePocCount: pocs.filter((x) => x.incomplete).length,
        };
    }).filter((g) => (g.pocs || []).length > 0);
    r.pocFileCount = r.allPocs.length;
    r.uniquePocCount = r.allPocs.filter((x) => !x.duplicate).length;
    r.duplicatePocCount = r.duplicatePocs.length;
    r.classifiedPocCount = r.groups.reduce((n, g) => n + (g.pocCount || 0), 0);
    r.unmatchedPocCount = r.unmatchedPocs.length;
    r.virtualPocCount = r.virtualPocs.length;
    r.incompletePocCount = r.incompletePocs.length;
    r.componentCount = r.groups.length;
    return r;
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
        <div class="fg-table-wrap">
        <table class="fg-table">
            <thead><tr><th>原因</th><th>保留</th><th>重复</th><th>去重键</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>` : '';
    return renderFingerprintSection(title, total || 0, body, list.length);
}

export { renderPocCatalog };
