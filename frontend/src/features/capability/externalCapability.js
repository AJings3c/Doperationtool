import {
    ApplyExternalCapability,
    RestoreExternalCapabilityBackup,
    RevealInFileManager,
    ScanExternalCapability,
    SelectDirectory,
} from '../../../wailsjs/go/main/App.js';
import { openWithDefault, showContextMenu, toast } from '../../core/feedback.js';
import { escapeHtml, isTaskCancelledError } from '../../core/format.js';
import { progressTracker } from '../../core/progress.js';
import { createRouteScope } from '../../core/routeScope.js';
import {
    buildExternalCapabilitySelection as buildExternalCapabilitySelectionState,
    isExternalDirSelected as isExternalDirSelectedState,
    isExternalFingerSelected as isExternalFingerSelectedState,
    isExternalPocSelected as isExternalPocSelectedState,
    renderExternalDirYaml,
    renderExternalFingerYaml,
    selectedExternalCapability as selectedExternalCapabilityState,
    selectedPocPlan as selectedPocPlanState,
    toggleExternalCapabilitySelectionState,
    updateExternalCapabilitySelectionState,
} from './reviewState.js';
import {
    capabilityRuntime,
    clearExternalCapabilityRuntime,
    fingerGovState,
    pushFingerHistory,
    renderFingerHistoryChips,
    saveFingerGovState,
} from './state.js';
import { renderFingerprintSection } from './views.js';
import { CAPABILITY_WRITE_KIND, capabilityWriteStore } from './writeState.js';

function renderExternalCapability(container) {
    container.innerHTML = `
    <div class="fingerprint-governance external-capability">
        <div class="extractor-tip">
            🧩 扫描已审核的 <code>日期_poc</code> / <code>日期_finger</code> / <code>日期_dir</code>，只展示相对 dddd 新增的识别入口和 POC；确认后再补充到 <code>finger.yaml</code>、<code>dir.yaml</code>、<code>workflow.yaml</code> 与 POC YAML。
        </div>
        <div class="fg-control-card">
            <div class="nv-toolbar">
                <input type="text" class="yaml-path-input" id="ec-root" placeholder="选择 dddd 根目录" spellcheck="false" />
                <button class="btn" id="ec-root-pick">选择 dddd</button>
            </div>
            <div class="nv-history" id="ec-root-history"></div>
            <div class="nv-toolbar">
                <input type="text" class="yaml-path-input" id="ec-poc" placeholder="选择已保存的 日期_poc 目录，可为空" spellcheck="false" />
                <button class="btn" id="ec-poc-pick">选择 日期_poc</button>
            </div>
            <div class="nv-history" id="ec-poc-history"></div>
            <div class="nv-toolbar">
                <input type="text" class="yaml-path-input" id="ec-finger" placeholder="选择已保存的 日期_finger 目录，可为空" spellcheck="false" />
                <button class="btn" id="ec-finger-pick">选择 日期_finger</button>
            </div>
            <div class="nv-history" id="ec-finger-history"></div>
            <div class="nv-toolbar">
                <input type="text" class="yaml-path-input" id="ec-dir" placeholder="选择已保存的 日期_dir 目录，可为空" spellcheck="false" />
                <button class="btn" id="ec-dir-pick">选择 日期_dir</button>
                <button class="btn btn-primary" id="ec-scan">严格对比新增能力</button>
            </div>
            <div class="nv-history" id="ec-dir-history"></div>
        </div>
        <div class="fg-summary" id="ec-summary"></div>
        <div class="fg-result" id="ec-result"></div>
    </div>`;
    return setupExternalCapability();
}

function setupExternalCapability() {
    const scope = createRouteScope();
    const elRoot = document.getElementById('ec-root');
    const elPoc = document.getElementById('ec-poc');
    const elFinger = document.getElementById('ec-finger');
    const elDir = document.getElementById('ec-dir');
    const elRootPick = document.getElementById('ec-root-pick');
    const elPocPick = document.getElementById('ec-poc-pick');
    const elFingerPick = document.getElementById('ec-finger-pick');
    const elDirPick = document.getElementById('ec-dir-pick');
    const elScan = document.getElementById('ec-scan');
    const elRootHist = document.getElementById('ec-root-history');
    const elPocHist = document.getElementById('ec-poc-history');
    const elFingerHist = document.getElementById('ec-finger-history');
    const elDirHist = document.getElementById('ec-dir-history');
    const elSummary = document.getElementById('ec-summary');
    const elResult = document.getElementById('ec-result');

    elRoot.value = fingerGovState.root || '';
    elPoc.value = fingerGovState.pocReviewDir || '';
    elFinger.value = fingerGovState.fingerReviewDir || '';
    elDir.value = fingerGovState.dirReviewDir || '';

    function renderHistories() {
        renderFingerHistoryChips(elRootHist, fingerGovState.history, (p) => { elRoot.value = p; fingerGovState.root = p; saveFingerGovState(fingerGovState); });
        renderFingerHistoryChips(elPocHist, fingerGovState.pocReviewHistory, (p) => { elPoc.value = p; fingerGovState.pocReviewDir = p; saveFingerGovState(fingerGovState); });
        renderFingerHistoryChips(elFingerHist, fingerGovState.fingerReviewHistory, (p) => { elFinger.value = p; fingerGovState.fingerReviewDir = p; saveFingerGovState(fingerGovState); });
        renderFingerHistoryChips(elDirHist, fingerGovState.dirReviewHistory, (p) => { elDir.value = p; fingerGovState.dirReviewDir = p; saveFingerGovState(fingerGovState); });
    }
    renderHistories();

    const pickTo = async (el, listName, valueName) => {
        try {
            const f = await scope.guard(SelectDirectory());
            if (!f) return;
            el.value = f;
            pushFingerHistory(listName, valueName, f);
            renderHistories();
        } catch (err) {
            if (!isTaskCancelledError(err)) toast(`选择失败: ${err}`, 'error');
        }
    };
    elRootPick.addEventListener('click', () => pickTo(elRoot, 'history', 'root'));
    elPocPick.addEventListener('click', () => pickTo(elPoc, 'pocReviewHistory', 'pocReviewDir'));
    elFingerPick.addEventListener('click', () => pickTo(elFinger, 'fingerReviewHistory', 'fingerReviewDir'));
    elDirPick.addEventListener('click', () => pickTo(elDir, 'dirReviewHistory', 'dirReviewDir'));
    elRoot.addEventListener('input', () => { fingerGovState.root = elRoot.value.trim(); saveFingerGovState(fingerGovState); });
    elPoc.addEventListener('input', () => { fingerGovState.pocReviewDir = elPoc.value.trim(); saveFingerGovState(fingerGovState); });
    elFinger.addEventListener('input', () => { fingerGovState.fingerReviewDir = elFinger.value.trim(); saveFingerGovState(fingerGovState); });
    elDir.addEventListener('input', () => { fingerGovState.dirReviewDir = elDir.value.trim(); saveFingerGovState(fingerGovState); });
    elScan.addEventListener('click', () => runScan());
    elResult.addEventListener('click', async (e) => {
        const toggleBtn = e.target.closest && e.target.closest('.ec-toggle-all');
        if (toggleBtn && elResult.contains(toggleBtn)) {
            toggleExternalCapabilitySelection(toggleBtn.dataset.kind, toggleBtn.dataset.checked === 'true');
            renderExternalCapabilityResult(capabilityRuntime.lastCapabilityScan, elSummary, elResult);
            return;
        }
        const applyBtn = e.target.closest && e.target.closest('#ec-apply');
        if (applyBtn && elResult.contains(applyBtn)) {
            await applyCapability();
            return;
        }
        const restoreBtn = e.target.closest && e.target.closest('#ec-restore');
        if (restoreBtn && elResult.contains(restoreBtn)) {
            await restoreCapabilityBackup();
            return;
        }
        const btn = e.target.closest && e.target.closest('.fg-reveal');
        if (!btn || !elResult.contains(btn)) return;
        RevealInFileManager(btn.dataset.path).catch((err) => toast(String(err), 'error'));
    });
    elResult.addEventListener('change', (e) => {
        const check = e.target.closest && e.target.closest('.ec-select-item');
        if (!check || !elResult.contains(check)) return;
        updateExternalCapabilitySelection(check);
        renderExternalCapabilityResult(capabilityRuntime.lastCapabilityScan, elSummary, elResult);
    });
    elResult.addEventListener('contextmenu', (e) => {
        const row = e.target.closest && e.target.closest('[data-poc-path]');
        if (!row || !elResult.contains(row)) return;
        e.preventDefault();
        const path = row.dataset.pocPath || '';
        showContextMenu(e.clientX, e.clientY, [
            { label: '在文件管理器中定位', onClick: () => RevealInFileManager(path).catch((err) => toast(String(err), 'error')) },
            { label: '用默认应用打开', onClick: () => openWithDefault(path) },
        ]);
    });

    const unsubscribeWriteState = capabilityWriteStore.subscribe(({ kind }) => {
        if (!scope.active || (kind !== CAPABILITY_WRITE_KIND.EXTERNAL_APPLY && kind !== CAPABILITY_WRITE_KIND.EXTERNAL_RESTORE)) return;
        refreshExternalCapabilityWriteStatus(elResult, Boolean(capabilityRuntime.lastCapabilityScan));
    });
    if (capabilityRuntime.lastCapabilityScan) {
        renderExternalCapabilityResult(capabilityRuntime.lastCapabilityScan, elSummary, elResult);
    }
    refreshExternalCapabilityWriteStatus(elResult, Boolean(capabilityRuntime.lastCapabilityScan));

    async function runScan() {
        if (capabilityWriteStore.get(CAPABILITY_WRITE_KIND.EXTERNAL_APPLY)?.status === 'running'
            || capabilityWriteStore.get(CAPABILITY_WRITE_KIND.EXTERNAL_RESTORE)?.status === 'running') {
            toast('写入或恢复仍在执行，请等待当前操作完成后再重新对比', 'error');
            return;
        }
        const root = elRoot.value.trim();
        const pocDir = elPoc.value.trim();
        const fingerDir = elFinger.value.trim();
        const dirDir = elDir.value.trim();
        if (!root) {
            toast('请先选择 dddd 根目录', 'error');
            return;
        }
        if (!pocDir && !fingerDir && !dirDir) {
            toast('至少选择一个 日期_poc、日期_finger 或 日期_dir 目录', 'error');
            return;
        }
        elScan.disabled = true;
        elResult.innerHTML = `<div class="yaml-empty">正在严格对比新增识别入口和 POC…</div>`;
        elSummary.innerHTML = '';
        const progressTask = progressTracker.start('fingerprint:external_capability:progress', '新增能力严格对比');
        clearExternalCapabilityRuntime();
        try {
            const r = await scope.guard(ScanExternalCapability(root, pocDir, fingerDir, dirDir));
            capabilityRuntime.lastCapabilityScan = r;
            capabilityRuntime.lastCapabilitySelection = buildExternalCapabilitySelection(r);
            pushFingerHistory('history', 'root', root);
            if (pocDir) pushFingerHistory('pocReviewHistory', 'pocReviewDir', pocDir);
            if (fingerDir) pushFingerHistory('fingerReviewHistory', 'fingerReviewDir', fingerDir);
            if (dirDir) pushFingerHistory('dirReviewHistory', 'dirReviewDir', dirDir);
            renderHistories();
            renderExternalCapabilityResult(r, elSummary, elResult);
            toast(`对比完成: 新增指纹 ${r.newFingerProducts || 0} 产品 / ${r.newFingerRules || 0} 规则，新增接口 ${r.newDirProducts || 0} 产品 / ${r.newDirPaths || 0} 路径，新增 POC ${r.newPocCount || 0}`, 'success');
        } catch (err) {
            if (!scope.active) return;
            elResult.innerHTML = `<div class="poc-validate-fail">❌ 对比失败: ${escapeHtml(err)}</div>`;
            toast(String(err), 'error');
        } finally {
            progressTask.end();
            if (scope.active) {
                elScan.disabled = false;
            }
        }
    }

    async function applyCapability() {
        if (!capabilityRuntime.lastCapabilityScan) {
            toast('请先完成一次新增能力对比', 'error');
            return;
        }
        if (capabilityWriteStore.get(CAPABILITY_WRITE_KIND.EXTERNAL_APPLY)?.status === 'running') {
            toast('新增能力仍在写入，请等待当前操作完成', 'error');
            return;
        }
        const selected = selectedExternalCapability(capabilityRuntime.lastCapabilityScan);
        if (!selected.fingers.length && !selected.dirs.length && !selected.pocs.length) {
            toast('请至少选择一项指纹规则、接口路径或 POC 再写回', 'error');
            return;
        }
        const input = elResult.querySelector('#ec-confirm');
        const confirmation = (input && input.value || '').trim();
        if (confirmation !== 'APPLY_EXTERNAL_CAPABILITY') {
            toast('请输入 APPLY_EXTERNAL_CAPABILITY 后再写回', 'error');
            return;
        }
        const btn = elResult.querySelector('#ec-apply');
        if (btn) btn.disabled = true;
        const projectRoot = elRoot.value.trim();
        try {
            const r = await capabilityWriteStore.run(
                CAPABILITY_WRITE_KIND.EXTERNAL_APPLY,
                { projectRoot },
                () => ApplyExternalCapability({
                    projectRoot,
                    newFingerYaml: renderExternalFingerYaml(selected.fingers),
                    newDirYaml: renderExternalDirYaml(selected.dirs),
                    newPocs: selected.pocs,
                    confirm: true,
                    confirmation,
                }),
            );
            capabilityRuntime.lastCapabilityApplyResult = r;
            if (!scope.active) return;
            toast(`✅ 接入完成: 指纹规则 +${r.rulesAdded || 0}，接口路径 +${r.dirPathsAdded || 0}，POC +${r.pocsCopied || 0}`, 'success');
        } catch (err) {
            if (scope.active && !isTaskCancelledError(err)) toast(`接入失败: ${err}`, 'error');
        } finally {
            if (scope.active && btn) btn.disabled = false;
        }
    }

    async function restoreCapabilityBackup() {
        const applyOperation = capabilityWriteStore.get(CAPABILITY_WRITE_KIND.EXTERNAL_APPLY);
        if (applyOperation?.status === 'running') {
            toast('新增能力仍在写入，完成后才能恢复备份', 'error');
            return;
        }
        const successfulApply = capabilityWriteStore.getLastSuccess(CAPABILITY_WRITE_KIND.EXTERNAL_APPLY);
        const applyResult = successfulApply?.result || null;
        if (!applyResult || (!applyResult.fingerBackupPath && !applyResult.dirBackupPath && !applyResult.workflowBackupPath)) {
            toast('没有可恢复的本次接入备份', 'error');
            return;
        }
        if (capabilityWriteStore.get(CAPABILITY_WRITE_KIND.EXTERNAL_RESTORE)?.status === 'running') {
            toast('备份恢复仍在执行，请等待当前操作完成', 'error');
            return;
        }
        const input = elResult.querySelector('#ec-restore-confirm');
        const confirmation = (input && input.value || '').trim();
        if (confirmation !== 'RESTORE_EXTERNAL_CAPABILITY') {
            toast('请输入 RESTORE_EXTERNAL_CAPABILITY 后再恢复', 'error');
            return;
        }
        const btn = elResult.querySelector('#ec-restore');
        if (btn) btn.disabled = true;
        const projectRoot = elRoot.value.trim() || successfulApply.context?.projectRoot || '';
        try {
            await capabilityWriteStore.run(
                CAPABILITY_WRITE_KIND.EXTERNAL_RESTORE,
                { projectRoot, applyOperationId: successfulApply.id },
                () => RestoreExternalCapabilityBackup({
                    projectRoot,
                    fingerBackupPath: applyResult.fingerBackupPath || '',
                    dirBackupPath: applyResult.dirBackupPath || '',
                    workflowBackupPath: applyResult.workflowBackupPath || '',
                    confirm: true,
                    confirmation,
                }),
            );
            if (!scope.active) return;
            toast('已恢复本次接入前的 finger/dir/workflow 备份', 'success');
        } catch (err) {
            if (scope.active && !isTaskCancelledError(err)) toast(`恢复失败: ${err}`, 'error');
        } finally {
            if (scope.active && btn) btn.disabled = false;
        }
    }

    return () => {
        unsubscribeWriteState();
        scope.dispose();
    };
}

function renderExternalCapabilityResult(r, elSummary, elResult) {
    if (!r) return;
    if (!capabilityRuntime.lastCapabilitySelection) capabilityRuntime.lastCapabilitySelection = buildExternalCapabilitySelection(r);
    const selected = selectedExternalCapability(r);
    const selectedRuleCount = selected.fingers.reduce((n, x) => n + ((x.rules || []).length), 0);
    const selectedDirPathCount = selected.dirs.reduce((n, x) => n + ((x.paths || []).length), 0);
    const stat = (label, value, tone = '') => `
        <div class="fg-stat ${tone}">
            <div class="fg-stat-value">${escapeHtml(value)}</div>
            <div class="fg-stat-label">${escapeHtml(label)}</div>
        </div>`;
    elSummary.innerHTML = `
        <div class="fg-stat-grid">
            ${stat('新增指纹产品', r.newFingerProducts || 0, (r.newFingerProducts || 0) ? 'fg-good' : '')}
            ${stat('新增指纹规则', r.newFingerRules || 0, (r.newFingerRules || 0) ? 'fg-good' : '')}
            ${stat('新增接口产品', r.newDirProducts || 0, (r.newDirProducts || 0) ? 'fg-good' : '')}
            ${stat('新增接口路径', r.newDirPaths || 0, (r.newDirPaths || 0) ? 'fg-good' : '')}
            ${stat('新增 POC', r.newPocCount || 0, (r.newPocCount || 0) ? 'fg-good' : '')}
            ${stat('已选择', `${selected.fingers.length} 指纹产品 / ${selected.dirs.length} 接口产品 / ${selected.pocs.length} POC`, (selected.fingers.length || selected.dirs.length || selected.pocs.length) ? 'fg-good' : 'fg-bad')}
        </div>
        <div class="fg-paths">
            <div><b>dddd:</b> <code>${escapeHtml(r.projectRoot || '')}</code></div>
            <div><b>poc:</b> <code>${escapeHtml(r.pocReviewDir || '')}</code></div>
            <div><b>finger:</b> <code>${escapeHtml(r.fingerReviewDir || '')}</code></div>
            <div><b>dir:</b> <code>${escapeHtml(r.dirReviewDir || '')}</code></div>
        </div>`;
    const fingerRows = (r.newFingers || []).map((x) => `
        <tr>
            <td><input type="checkbox" class="ec-select-item" data-kind="finger" data-key="${escapeHtml(x.product || '')}" ${isExternalFingerSelected(x.product) ? 'checked' : ''} /></td>
            <td title="${escapeHtml(x.product || '')}">${escapeHtml(x.product || '')}</td>
            <td title="${escapeHtml((x.rules || []).join('\n'))}">${escapeHtml((x.rules || []).join('\n'))}</td>
        </tr>`).join('');
    const dirRows = (r.newDirs || []).map((x) => `
        <tr>
            <td><input type="checkbox" class="ec-select-item" data-kind="dir" data-key="${escapeHtml(x.product || '')}" ${isExternalDirSelected(x.product) ? 'checked' : ''} /></td>
            <td title="${escapeHtml(x.product || '')}">${escapeHtml(x.product || '')}</td>
            <td title="${escapeHtml((x.paths || []).join('\n'))}">${escapeHtml((x.paths || []).join('\n'))}</td>
        </tr>`).join('');
    const pocRows = (r.newPocs || []).map((x) => `
        <tr data-poc-path="${escapeHtml(x.path || '')}" data-poc-rel="${escapeHtml(x.relPath || x.name || '')}">
            <td><input type="checkbox" class="ec-select-item" data-kind="poc" data-key="${escapeHtml(x.path || '')}" ${isExternalPocSelected(x.path) ? 'checked' : ''} /></td>
            <td title="${escapeHtml(x.matchedProduct || '')}">${escapeHtml(x.matchedProduct || '-')}</td>
            <td title="${escapeHtml(x.relPath || x.name || '')}">${x.duplicate ? '<span class="fg-dup-mark">重复</span> ' : ''}${escapeHtml(x.relPath || x.name || '')}</td>
            <td title="${escapeHtml(x.id || '')}">${escapeHtml(x.id || '-')}</td>
            <td>${escapeHtml(x.matchConfidence || 0)}</td>
            <td><button class="fg-reveal" data-path="${escapeHtml(x.path || '')}">定位</button></td>
        </tr>`).join('');
    elResult.innerHTML = `
        <div class="fg-result-grid">
            ${renderFingerprintSection('新增指纹规则', r.newFingerProducts || 0, fingerRows ? `
                ${renderExternalCapabilitySelectionToolbar('finger')}
                <div class="fg-table-wrap"><table class="fg-table"><thead><tr><th>选择</th><th>产品</th><th>新增规则</th></tr></thead><tbody>${fingerRows}</tbody></table></div>` : '', (r.newFingers || []).length)}
            ${renderFingerprintSection('新增接口路径', r.newDirProducts || 0, dirRows ? `
                ${renderExternalCapabilitySelectionToolbar('dir')}
                <div class="fg-table-wrap"><table class="fg-table"><thead><tr><th>选择</th><th>产品</th><th>新增路径</th></tr></thead><tbody>${dirRows}</tbody></table></div>` : '', (r.newDirs || []).length)}
            ${renderFingerprintSection('新增 POC', r.newPocCount || 0, pocRows ? `
                ${renderExternalCapabilitySelectionToolbar('poc')}
                <div class="fg-table-wrap"><table class="fg-table fg-poc-finger-table"><thead><tr><th>选择</th><th>建议产品</th><th>POC</th><th>ID</th><th>置信</th><th>操作</th></tr></thead><tbody>${pocRows}</tbody></table></div>` : '', (r.newPocs || []).length)}
            ${renderExternalCapabilityPlanTable('写入前 POC 复制计划', selectedPocPlan(r))}
        </div>
        <details class="fg-section fg-apply-section" ${(r.newFingerRules || r.newDirPaths || r.newPocCount) ? 'open' : ''}>
            <summary>确认接入 dddd <span>会备份 finger.yaml / dir.yaml / workflow.yaml</span></summary>
            <div class="fg-apply-box">
                <div class="fg-apply-selection">本次将写入 ${escapeHtml(selected.fingers.length)} 个指纹产品 / ${escapeHtml(selectedRuleCount)} 条规则，${escapeHtml(selected.dirs.length)} 个接口产品 / ${escapeHtml(selectedDirPathCount)} 条路径，${escapeHtml(selected.pocs.length)} 个 POC。</div>
                <input id="ec-confirm" class="yaml-path-input" placeholder="输入 APPLY_EXTERNAL_CAPABILITY 后才能写回" spellcheck="false" />
                <button id="ec-apply" class="btn btn-primary">写入新增能力</button>
                <div id="ec-apply-status">${renderExternalCapabilityWriteStatus()}</div>
            </div>
        </details>`;
}

function renderExternalCapabilityPlanTable(title, plans) {
    const list = plans || [];
    if (!list.length) return '';
    const rows = list.map((x) => `
        <tr>
            <td title="${escapeHtml(x.product || '')}">${escapeHtml(x.product || '-')}</td>
            <td title="${escapeHtml(x.sourceRelPath || x.sourcePath || '')}">${escapeHtml(x.sourceRelPath || x.sourcePath || '-')}</td>
            <td title="${escapeHtml(x.targetPath || '')}">${escapeHtml(x.targetName || x.targetPath || '-')}</td>
            <td>${x.conflictRenamed ? '<span class="fg-dup-mark">已避让同名</span>' : '-'}</td>
        </tr>`).join('');
    return renderFingerprintSection(title, list.length, `
        <div class="fg-table-wrap">
            <table class="fg-table fg-poc-finger-table">
                <thead><tr><th>产品</th><th>来源</th><th>目标文件</th><th>冲突</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`, list.length);
}

function buildExternalCapabilitySelection(r) {
    return buildExternalCapabilitySelectionState(r);
}

function isExternalFingerSelected(product) {
    return isExternalFingerSelectedState(capabilityRuntime.lastCapabilitySelection, product);
}

function isExternalDirSelected(product) {
    return isExternalDirSelectedState(capabilityRuntime.lastCapabilitySelection, product);
}

function isExternalPocSelected(path) {
    return isExternalPocSelectedState(capabilityRuntime.lastCapabilitySelection, path);
}

function updateExternalCapabilitySelection(check) {
    capabilityRuntime.lastCapabilitySelection = updateExternalCapabilitySelectionState(capabilityRuntime.lastCapabilitySelection, check.dataset.kind, check.dataset.key || '', check.checked);
    capabilityRuntime.lastCapabilityApplyResult = null;
}

function toggleExternalCapabilitySelection(kind, checked) {
    if (!capabilityRuntime.lastCapabilityScan) return;
    capabilityRuntime.lastCapabilitySelection = toggleExternalCapabilitySelectionState(capabilityRuntime.lastCapabilityScan, capabilityRuntime.lastCapabilitySelection, kind, checked);
    capabilityRuntime.lastCapabilityApplyResult = null;
}

function selectedExternalCapability(r) {
    if (!capabilityRuntime.lastCapabilitySelection) capabilityRuntime.lastCapabilitySelection = buildExternalCapabilitySelection(r);
    return selectedExternalCapabilityState(r, capabilityRuntime.lastCapabilitySelection);
}

function selectedPocPlan(r) {
    if (!capabilityRuntime.lastCapabilitySelection) capabilityRuntime.lastCapabilitySelection = buildExternalCapabilitySelection(r);
    return selectedPocPlanState(r, capabilityRuntime.lastCapabilitySelection);
}

function renderExternalCapabilitySelectionToolbar(kind) {
    return `
        <div class="ec-select-toolbar">
            <button class="fg-copy-object ec-toggle-all" data-kind="${escapeHtml(kind)}" data-checked="true">全选</button>
            <button class="fg-copy-object ec-toggle-all" data-kind="${escapeHtml(kind)}" data-checked="false">全不选</button>
        </div>`;
}

function renderExternalCapabilityPostAudit(audit, err) {
    if (err) {
        return `<div class="fg-apply-audit fg-apply-audit-bad">写入后审计失败: ${escapeHtml(err)}</div>`;
    }
    if (!audit) return '';
    const tone = audit.passed ? 'fg-apply-audit-ok' : 'fg-apply-audit-bad';
    const label = audit.passed ? '写入后审计通过' : `写入后审计发现 ${audit.issueCount || 0} 个问题`;
    return `
        <div class="fg-apply-audit ${tone}">
            <strong>${escapeHtml(label)}</strong>
            <span>缺失 POC ${escapeHtml(audit.missingPocCount || 0)} · 虚空 POC ${escapeHtml(audit.virtualPocCount || 0)} · 残缺 POC ${escapeHtml(audit.incompletePocCount || 0)} · 无识别入口 POC ${escapeHtml(audit.pocWithoutFingerCount || 0)} · 识别入口无 POC ${escapeHtml(audit.fingerWithoutPocCount || 0)} · 识别入口无 Workflow ${escapeHtml(audit.recognitionWithoutWorkflowCount || audit.fingerWithoutWorkflowCount || 0)} · Workflow 无识别入口 ${escapeHtml(audit.workflowWithoutRecognitionCount || audit.workflowWithoutFingerCount || 0)}</span>
        </div>`;
}

function renderExternalCapabilityWriteStatus() {
    const operation = capabilityWriteStore.get(CAPABILITY_WRITE_KIND.EXTERNAL_APPLY);
    if (!operation) return '';
    if (operation.status === 'running') {
        return `<div class="fg-apply-ok">新增能力正在后台写入。离开本页不会取消操作，返回后可查看最终结果。</div>`;
    }

    const successfulApply = capabilityWriteStore.getLastSuccess(CAPABILITY_WRITE_KIND.EXTERNAL_APPLY);
    const status = operation.status === 'failed'
        ? `<div class="poc-validate-fail">最近一次接入失败: ${escapeHtml(operation.error || '未知错误')}</div>`
        : operation.status === 'interrupted'
            ? `<div class="poc-validate-fail">${escapeHtml(operation.error || '最近一次接入状态未知')}</div>`
            : '';
    if (!successfulApply?.result) return status;

    const r = successfulApply.result;
    const projectRoot = successfulApply.context?.projectRoot || '';
    return `${status}
        <div class="fg-apply-ok">最近一次接入已完成${projectRoot ? `: <code>${escapeHtml(projectRoot)}</code>` : ''}</div>
        <div class="fg-apply-ok">finger 备份: <code>${escapeHtml(r.fingerBackupPath || '未变更')}</code></div>
        <div class="fg-apply-ok">dir 备份: <code>${escapeHtml(r.dirBackupPath || '未变更')}</code></div>
        <div class="fg-apply-ok">workflow 备份: <code>${escapeHtml(r.workflowBackupPath || '未变更')}</code></div>
        <div class="fg-apply-ok">POC 目录: <code>${escapeHtml(r.pocTargetDir || '未复制')}</code></div>
        <div class="fg-apply-ok">日志: <code>${escapeHtml(r.logPath || '')}</code></div>
        ${renderExternalCapabilityPlanTable('实际 POC 写入结果', r.pocApplyPlan || [])}
        ${renderExternalCapabilityPostAudit(r.postAudit, r.postAuditError)}
        ${renderExternalCapabilityRestoreBox(r, successfulApply)}`;
}

function renderExternalCapabilityRestoreStatus(operation) {
    if (!operation) return '';
    if (operation.status === 'running') {
        return '<div class="fg-apply-ok">正在后台恢复备份。离开本页不会取消操作。</div>';
    }
    if (operation.status === 'failed' || operation.status === 'interrupted') {
        return `<div class="poc-validate-fail">恢复失败或状态未知: ${escapeHtml(operation.error || '未知错误')}</div>`;
    }
    const r = operation.result || {};
    return `
        <div class="fg-apply-ok">备份恢复已完成</div>
        <div class="fg-apply-ok">恢复 finger: ${r.restoredFinger ? '是' : '否'}，当前版本备份: <code>${escapeHtml(r.fingerCurrentBackupPath || '无')}</code></div>
        <div class="fg-apply-ok">恢复 dir: ${r.restoredDir ? '是' : '否'}，当前版本备份: <code>${escapeHtml(r.dirCurrentBackupPath || '无')}</code></div>
        <div class="fg-apply-ok">恢复 workflow: ${r.restoredWorkflow ? '是' : '否'}，当前版本备份: <code>${escapeHtml(r.workflowCurrentBackupPath || '无')}</code></div>
        <div class="fg-apply-ok">日志: <code>${escapeHtml(r.logPath || '')}</code></div>`;
}

function renderExternalCapabilityRestoreBox(r, successfulApply) {
    if (!r || (!r.fingerBackupPath && !r.dirBackupPath && !r.workflowBackupPath)) return '';
    const currentRestore = capabilityWriteStore.get(CAPABILITY_WRITE_KIND.EXTERNAL_RESTORE);
    const restoreOperation = currentRestore?.context?.applyOperationId === successfulApply?.id ? currentRestore : null;
    const restoring = restoreOperation?.status === 'running';
    return `
        <div class="fg-restore-box">
            <div class="fg-restore-title">需要回滚本次接入时，可恢复写入前备份。</div>
            <input id="ec-restore-confirm" class="yaml-path-input" placeholder="输入 RESTORE_EXTERNAL_CAPABILITY 后才能恢复" spellcheck="false" />
            <button id="ec-restore" class="btn" ${restoring ? 'disabled' : ''}>恢复本次接入前备份</button>
            <div id="ec-restore-status">${renderExternalCapabilityRestoreStatus(restoreOperation)}</div>
        </div>`;
}

function refreshExternalCapabilityWriteStatus(elResult, hasScan) {
    const html = renderExternalCapabilityWriteStatus();
    const status = elResult.querySelector('#ec-apply-status');
    if (status) {
        status.innerHTML = html;
    } else if (!hasScan && html) {
        elResult.innerHTML = `<div class="fg-apply-box">${html}</div>`;
    }
    const applying = capabilityWriteStore.get(CAPABILITY_WRITE_KIND.EXTERNAL_APPLY)?.status === 'running';
    const restoring = capabilityWriteStore.get(CAPABILITY_WRITE_KIND.EXTERNAL_RESTORE)?.status === 'running';
    const applyButton = elResult.querySelector('#ec-apply');
    const restoreButton = elResult.querySelector('#ec-restore');
    if (applyButton) applyButton.disabled = applying;
    if (restoreButton) restoreButton.disabled = applying || restoring;
}

export { renderExternalCapability };
