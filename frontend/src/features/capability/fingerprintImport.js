import {
    ApplyFingerprintImport,
    PreviewFingerprintImport,
    RevealInFileManager,
    SaveExternalFingerprintReview,
    SelectDirectory,
} from '../../../wailsjs/go/main/App.js';
import { navigate } from '../../app/navigation.js';
import { copyToClipboard, showContextMenu, toast } from '../../core/feedback.js';
import { escapeHtml, isTaskCancelledError } from '../../core/format.js';
import { progressTracker } from '../../core/progress.js';
import { createRouteScope } from '../../core/routeScope.js';
import {
    createFingerprintReviewState,
    fingerprintReviewItemKey,
    rebuildFingerprintReviewState,
} from './reviewState.js';
import {
    capabilityRuntime,
    clearFingerprintReviewRuntime,
    fingerGovState,
    pushFingerHistory,
    renderFingerHistoryChips,
    saveFingerGovState,
} from './state.js';
import { renderFingerprintSection, renderFingerprintTable } from './views.js';
import { CAPABILITY_WRITE_KIND, capabilityWriteStore } from './writeState.js';

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
                <button class="btn" id="df-save-review">保存审核结果</button>
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
    return setupDDDDFingerprintConverter();
}

function setupDDDDFingerprintConverter() {
    const scope = createRouteScope();
    const elRoot = document.getElementById('df-root');
    const elRootPick = document.getElementById('df-root-pick');
    const elAudit = document.getElementById('df-open-audit');
    const elRootHist = document.getElementById('df-root-history');
    const elSrc = document.getElementById('df-src');
    const elSrcPick = document.getElementById('df-src-pick');
    const elRun = document.getElementById('df-run');
    const elSaveReview = document.getElementById('df-save-review');
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
            const f = await scope.guard(SelectDirectory());
            if (!f) return;
            elRoot.value = f;
            pushFingerHistory('history', 'root', f);
            renderHistories();
        } catch (err) {
            if (!isTaskCancelledError(err)) toast(`选择失败: ${err}`, 'error');
        }
    });
    elSrcPick.addEventListener('click', async () => {
        try {
            const f = await scope.guard(SelectDirectory());
            if (!f) return;
            elSrc.value = f;
            fingerGovState.importDir = f;
            saveFingerGovState(fingerGovState);
            renderHistories();
        } catch (err) {
            if (!isTaskCancelledError(err)) toast(`选择失败: ${err}`, 'error');
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
    elSaveReview.addEventListener('click', saveFingerprintReview);
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
        const removeBtn = e.target.closest && e.target.closest('.fg-import-remove');
        if (removeBtn && elResult.contains(removeBtn)) {
            removeFingerprintReviewItem(removeBtn.dataset.product || '', removeBtn.dataset.rel || '');
            renderFingerprintImportPreview(capabilityRuntime.lastFingerprintReview, elSummary, elResult);
            return;
        }
        const restoreBtn = e.target.closest && e.target.closest('.fg-import-restore');
        if (restoreBtn && elResult.contains(restoreBtn)) {
            restoreFingerprintReviewItem(restoreBtn.dataset.product || '', restoreBtn.dataset.rel || '');
            renderFingerprintImportPreview(capabilityRuntime.lastFingerprintReview, elSummary, elResult);
            return;
        }
        const btn = e.target.closest && e.target.closest('button[data-copy]');
        if (!btn || !elResult.contains(btn)) return;
        const text = btn.dataset.copy === 'yaml'
            ? (capabilityRuntime.lastFingerprintReview && capabilityRuntime.lastFingerprintReview.ddddYaml) || ''
            : (capabilityRuntime.lastFingerprintReview && capabilityRuntime.lastFingerprintReview.patchPreview) || '';
        if (text) copyToClipboard(text, btn.dataset.copy === 'yaml' ? 'finger.yaml' : 'Patch 预览');
    });
    elResult.addEventListener('contextmenu', (e) => {
        const row = e.target.closest && e.target.closest('[data-finger-product]');
        if (!row || !elResult.contains(row)) return;
        e.preventDefault();
        const product = row.dataset.fingerProduct || '';
        const rel = row.dataset.fingerRel || '';
        showContextMenu(e.clientX, e.clientY, [
            { label: '从本次指纹审核中移除', danger: true, onClick: () => {
                removeFingerprintReviewItem(product, rel);
                renderFingerprintImportPreview(capabilityRuntime.lastFingerprintReview, elSummary, elResult);
            } },
        ]);
    });

    const unsubscribeWriteState = capabilityWriteStore.subscribe(({ kind }) => {
        if (!scope.active || kind !== CAPABILITY_WRITE_KIND.FINGERPRINT_IMPORT_APPLY) return;
        refreshFingerprintImportWriteStatus(elResult, Boolean(capabilityRuntime.lastFingerprintReview));
    });
    if (capabilityRuntime.lastFingerprintReview) {
        renderFingerprintImportPreview(capabilityRuntime.lastFingerprintReview, elSummary, elResult);
    }
    refreshFingerprintImportWriteStatus(elResult, Boolean(capabilityRuntime.lastFingerprintReview));

    async function runPreview(sourceDir) {
        if (capabilityWriteStore.get(CAPABILITY_WRITE_KIND.FINGERPRINT_IMPORT_APPLY)?.status === 'running') {
            toast('finger.yaml 仍在写回，请等待当前操作完成后再生成新预览', 'error');
            return;
        }
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
        const progressTask = progressTracker.start('fingerprint:import:progress', '外部指纹导入预览');
        clearFingerprintReviewRuntime();
        try {
            const r = await scope.guard(PreviewFingerprintImport(root, sourceDir));
            capabilityRuntime.lastFingerprintImportPreview = r;
            capabilityRuntime.lastFingerprintReview = createFingerprintReviewState(r);
            renderFingerprintImportPreview(capabilityRuntime.lastFingerprintReview, elSummary, elResult);
            if (root) pushFingerHistory('history', 'root', root);
            pushFingerHistory('importHistory', 'importDir', sourceDir);
            renderHistories();
            toast(`✅ 导入预览完成: ${r.productCount || 0} 个产品 · ${r.ruleCount || 0} 条规则 (${r.elapsed || ''})`, 'success');
        } catch (err) {
            progressTask.end();
            if (!scope.active) return;
            const msg = String(err);
            elResult.innerHTML = `<div class="poc-validate-fail">❌ 导入预览失败: ${escapeHtml(msg)}</div>`;
            toast(msg, 'error');
        } finally {
            if (scope.active) {
                elRun.disabled = false;
                elSrcPick.disabled = false;
                elRun.textContent = oldLabel;
            }
        }
    }

    async function applyImport(projectRoot) {
        if (!capabilityRuntime.lastFingerprintReview || !capabilityRuntime.lastFingerprintReview.ddddYaml) {
            toast('请先完成一次转换预览', 'error');
            return;
        }
        if (!projectRoot) {
            toast('请先选择目标项目目录后再写回', 'error');
            return;
        }
        if (capabilityWriteStore.get(CAPABILITY_WRITE_KIND.FINGERPRINT_IMPORT_APPLY)?.status === 'running') {
            toast('finger.yaml 仍在写回，请等待当前操作完成', 'error');
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
            const r = await capabilityWriteStore.run(
                CAPABILITY_WRITE_KIND.FINGERPRINT_IMPORT_APPLY,
                { projectRoot, sourceDir: elSrc.value.trim() },
                () => ApplyFingerprintImport({
                    projectRoot,
                    ddddYaml: capabilityRuntime.lastFingerprintReview.ddddYaml,
                    confirm: true,
                    confirmation,
                }),
            );
            pushFingerHistory('history', 'root', projectRoot);
            if (!scope.active) return;
            renderHistories();
            toast(`✅ 写回完成: 新增 ${r.productsCreated || 0} 产品，合并 ${r.productsMerged || 0} 产品，新增 ${r.rulesAdded || 0} 规则`, 'success');
        } catch (err) {
            if (scope.active && !isTaskCancelledError(err)) toast(`写回失败: ${err}`, 'error');
        } finally {
            if (scope.active && btn) btn.disabled = false;
        }
    }

    async function saveFingerprintReview() {
        if (!capabilityRuntime.lastFingerprintReview || !capabilityRuntime.lastFingerprintReview.ddddYaml) {
            toast('请先完成一次转换预览', 'error');
            return;
        }
        elSaveReview.disabled = true;
        try {
            const r = await scope.guard(SaveExternalFingerprintReview({
                projectRoot: elRoot.value.trim(),
                sourceDir: elSrc.value.trim(),
                items: capabilityRuntime.lastFingerprintReview.items || [],
                ddddYaml: capabilityRuntime.lastFingerprintReview.ddddYaml,
                removed: capabilityRuntime.lastFingerprintReview.removed || [],
            }));
            pushFingerHistory('fingerReviewHistory', 'fingerReviewDir', r.dir || '');
            toast(`✅ 指纹审核结果已保存: ${r.dir}`, 'success');
        } catch (err) {
            if (!isTaskCancelledError(err)) toast(`保存失败: ${err}`, 'error');
        } finally {
            if (scope.active) elSaveReview.disabled = false;
        }
    }

    return () => {
        unsubscribeWriteState();
        scope.dispose();
    };
}

function removeFingerprintReviewItem(product, relPath) {
    if (!capabilityRuntime.lastFingerprintReview) return;
    const key = fingerprintReviewItemKey(product, relPath);
    capabilityRuntime.lastFingerprintReview.removedKeys.add(key);
    rebuildFingerprintReviewState(capabilityRuntime.lastFingerprintReview);
    toast(`已从本次指纹审核移除: ${product || relPath}`, 'info');
}

function restoreFingerprintReviewItem(product, relPath) {
    if (!capabilityRuntime.lastFingerprintReview) return;
    const key = fingerprintReviewItemKey(product, relPath);
    capabilityRuntime.lastFingerprintReview.removedKeys.delete(key);
    rebuildFingerprintReviewState(capabilityRuntime.lastFingerprintReview);
    toast(`已恢复到本次指纹审核: ${product || relPath}`, 'success');
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
            ${stat('已移除', (r.removedItems || []).length || 0, (r.removedItems || []).length ? 'fg-warn' : 'fg-good')}
        </div>
        <div class="fg-paths">
            <div><b>source:</b> <code>${escapeHtml(r.sourceDir || '')}</code></div>
            <div><b>target:</b> <code>${escapeHtml(r.targetFingerPath || '未选择目标项目目录，仅生成独立预览')}</code></div>
        </div>`;

    const itemRows = (r.items || []).map((x) => {
        const firstRules = (x.rules || []).slice(0, 3).map((rule) => rule.expression).join('\n');
        const warn = (x.warnings || []).join('\n');
        return `
        <tr data-finger-product="${escapeHtml(x.product || '')}" data-finger-rel="${escapeHtml(x.relPath || x.path || '')}">
            <td title="${escapeHtml(x.product || '')}">${escapeHtml(x.product || '')}</td>
            <td title="${escapeHtml(x.normalizedProduct || '')}">${escapeHtml(x.normalizedProduct || '')}</td>
            <td><span class="fg-quality fg-quality-${escapeHtml(x.quality || 'low')}">${escapeHtml(x.quality || '')} ${escapeHtml(x.qualityScore || 0)}</span></td>
            <td>${escapeHtml((x.rules || []).length)}</td>
            <td title="${escapeHtml(x.relPath || '')}">${escapeHtml(x.relPath || '')}</td>
            <td title="${escapeHtml(firstRules)}">${escapeHtml(firstRules || '-')}</td>
            <td title="${escapeHtml(warn)}">${escapeHtml(warn || '-')}</td>
            <td><button class="fg-copy-object fg-import-remove" data-product="${escapeHtml(x.product || '')}" data-rel="${escapeHtml(x.relPath || x.path || '')}">移除</button></td>
        </tr>`;
    }).join('');
    const itemsBody = itemRows ? `
        <div class="fg-table-wrap">
        <table class="fg-table fg-import-items">
            <thead><tr><th>产品</th><th>归一化</th><th>质量</th><th>规则</th><th>来源</th><th>规则示例</th><th>提示</th><th>操作</th></tr></thead>
            <tbody>${itemRows}</tbody>
        </table></div>` : '';

    const mergeBody = renderFingerprintTable('合并建议', r.mergeSuggestionCount, r.mergeSuggestions, ['归一化名称', '已有产品', '导入产品'], (x) => [
        x.normalizedProduct,
        (x.existing || []).join(', ') || '-',
        (x.imported || []).join(', ') || '-',
    ]);
    const duplicateBody = renderFingerprintTable('导入重复规则', r.duplicateRuleCount, r.duplicateRules, ['规则', '产品'], (x) => [x.rule, (x.products || []).join(', ')]);
    const skippedBody = renderFingerprintTable('跳过文件', r.skippedFiles, r.skipped, ['文件', '原因'], (x) => [x.relPath || x.path, x.reason]);
    const removedRows = (r.removedItems || []).map((x) => `
        <tr>
            <td title="${escapeHtml(x.product || '')}">${escapeHtml(x.product || '')}</td>
            <td title="${escapeHtml(x.relPath || x.path || '')}">${escapeHtml(x.relPath || x.path || '-')}</td>
            <td>${escapeHtml((x.rules || []).length)}</td>
            <td><button class="fg-copy-object fg-import-restore" data-product="${escapeHtml(x.product || '')}" data-rel="${escapeHtml(x.relPath || x.path || '')}">恢复</button></td>
        </tr>`).join('');
    const removedBody = removedRows ? renderFingerprintSection('已移除指纹候选', (r.removedItems || []).length, `
        <div class="fg-table-wrap">
        <table class="fg-table">
            <thead><tr><th>产品</th><th>来源</th><th>规则</th><th>操作</th></tr></thead>
            <tbody>${removedRows}</tbody>
        </table></div>`, (r.removedItems || []).length) : '';
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
    const patchBlock = (r.removedItems || []).length ? `
        <details class="fg-section fg-code-section">
            <summary>Patch / 写回预览 <span>已人工调整</span></summary>
            <div class="fg-empty">已移除部分指纹候选，原始 dry-run patch 不再展示；写回和保存会使用当前 finger.yaml 预览内容。</div>
        </details>` : `
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
                <div id="fg-import-apply-status">${renderFingerprintImportWriteStatus()}</div>
            </div>
        </details>`;

    elResult.innerHTML = [
        renderFingerprintClassView(r),
        `<div class="fg-result-grid">
            ${renderFingerprintSection('导入候选', (r.items || []).length, itemsBody, (r.items || []).length)}
            ${mergeBody}
            ${duplicateBody}
            ${skippedBody}
            ${removedBody}
        </div>`,
        yamlBlock,
        patchBlock,
        applyBlock,
    ].join('');
}

function renderFingerprintImportWriteStatus() {
    const operation = capabilityWriteStore.get(CAPABILITY_WRITE_KIND.FINGERPRINT_IMPORT_APPLY);
    if (!operation) return '';
    if (operation.status === 'running') {
        return '<div class="fg-apply-ok">finger.yaml 正在后台写回。离开本页不会取消操作，返回后可查看最终结果。</div>';
    }

    const successfulApply = capabilityWriteStore.getLastSuccess(CAPABILITY_WRITE_KIND.FINGERPRINT_IMPORT_APPLY);
    const status = operation.status === 'failed'
        ? `<div class="poc-validate-fail">最近一次写回失败: ${escapeHtml(operation.error || '未知错误')}</div>`
        : operation.status === 'interrupted'
            ? `<div class="poc-validate-fail">${escapeHtml(operation.error || '最近一次写回状态未知')}</div>`
            : '';
    if (!successfulApply?.result) return status;

    const r = successfulApply.result;
    const projectRoot = successfulApply.context?.projectRoot || '';
    return `${status}
        <div class="fg-apply-ok">最近一次写回已完成${projectRoot ? `: <code>${escapeHtml(projectRoot)}</code>` : ''}</div>
        <div class="fg-apply-ok">已写回 <code>${escapeHtml(r.targetFingerPath || '')}</code></div>
        <div class="fg-apply-ok">备份文件 <code>${escapeHtml(r.backupPath || '')}</code></div>
        <div class="fg-apply-ok">新增 ${escapeHtml(r.productsCreated || 0)} 个产品，合并 ${escapeHtml(r.productsMerged || 0)} 个产品，新增 ${escapeHtml(r.rulesAdded || 0)} 条规则。</div>
        <div class="fg-apply-ok">可切换到“指纹治理”执行关联审计。</div>`;
}

function refreshFingerprintImportWriteStatus(elResult, hasReview) {
    const html = renderFingerprintImportWriteStatus();
    const status = elResult.querySelector('#fg-import-apply-status');
    if (status) {
        status.innerHTML = html;
    } else if (!hasReview && html) {
        elResult.innerHTML = `<div class="fg-apply-box">${html}</div>`;
    }
    const applying = capabilityWriteStore.get(CAPABILITY_WRITE_KIND.FINGERPRINT_IMPORT_APPLY)?.status === 'running';
    const applyButton = elResult.querySelector('#fg-import-apply');
    if (applyButton) applyButton.disabled = applying;
}

export { renderDDDDFingerprintConverter };
