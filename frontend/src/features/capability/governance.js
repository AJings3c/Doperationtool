import {
    AuditFingerprintKnowledge,
    RevealInFileManager,
    SelectDirectory,
} from '../../../wailsjs/go/main/App.js';
import { copyToClipboard, toast } from '../../core/feedback.js';
import { escapeHtml, isTaskCancelledError } from '../../core/format.js';
import { progressTracker } from '../../core/progress.js';
import { createRouteScope } from '../../core/routeScope.js';
import { fingerGovState, pushFingerHistory, renderFingerHistoryChips, saveFingerGovState } from './state.js';
import {
    renderFingerprintList,
    renderFingerprintPocDetailTable,
    renderFingerprintPocFingerTable,
    renderFingerprintSection,
    renderFingerprintTable,
    renderPocCatalogGroups,
} from './views.js';

function renderFingerprintGovernance(container) {
    container.innerHTML = `
    <div class="fingerprint-governance">
        <div class="extractor-tip">
            🧬 这里检查 dddd 三文件识别链路: 对比 <code>common/config/finger.yaml</code>、
            <code>common/config/dir.yaml</code>、<code>workflow.yaml</code> 与 <code>common/config/pocs</code>，找出识别入口无 workflow、workflow 无识别入口、虚空 POC、残缺 POC 和命名不一致问题。
        </div>
        <div class="fg-control-card">
            <div class="nv-toolbar">
                <input type="text" class="yaml-path-input" id="fg-root"
                    placeholder="选择 dddd 根目录, 例如 D:\\AI\\scan\\dddd" spellcheck="false" />
                <button class="btn" id="fg-pick">选择目录</button>
                <button class="btn btn-primary" id="fg-run">▶️ 开始审计</button>
            </div>
            <div class="nv-history" id="fg-history"></div>
        </div>
        <div class="fg-summary" id="fg-summary"></div>
        <div class="fg-result" id="fg-result"></div>
    </div>`;
    return setupFingerprintGovernance();
}

function setupFingerprintGovernance() {
    const scope = createRouteScope();
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
            const f = await scope.guard(SelectDirectory());
            if (!f) return;
            elRoot.value = f;
            pushFingerHistory('history', 'root', f);
            renderHistory();
        } catch (err) {
            if (!isTaskCancelledError(err)) toast(`选择失败: ${err}`, 'error');
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
    elResult.addEventListener('click', async (e) => {
        const copyBtn = e.target.closest && e.target.closest('.fg-copy-object');
        if (copyBtn && elResult.contains(copyBtn)) {
            e.preventDefault();
            e.stopPropagation();
            await copyToClipboard(copyBtn.dataset.copyObject || '', '对象名');
            return;
        }
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
        const progressTask = progressTracker.start('fingerprint:audit:progress', '指纹知识库审计');
        try {
            const r = await scope.guard(AuditFingerprintKnowledge(root));
            renderFingerprintAudit(r, elSummary, elResult);
            pushFingerHistory('history', 'root', root);
            renderHistory();
            const score = (r.missingPocCount || 0) + (r.weakRuleCount || 0) + (r.duplicateRuleGroupCount || 0);
            toast(score > 0 ? `⚠️ 审计完成: 发现 ${score} 个重点问题 (${r.elapsed})` : `✅ 审计完成 (${r.elapsed})`, score > 0 ? 'error' : 'success');
        } catch (err) {
            progressTask.end();
            if (!scope.active) return;
            const msg = String(err);
            if (isTaskCancelledError(err)) {
                elResult.innerHTML = `<div class="yaml-empty">已取消 dddd 能力对比审计。</div>`;
                toast('已取消 dddd 能力对比审计', 'info');
            } else {
                elResult.innerHTML = `<div class="poc-validate-fail">❌ 审计失败: ${escapeHtml(msg)}</div>`;
                toast(msg, 'error');
            }
        } finally {
            if (scope.active) {
                elRun.disabled = false;
                elPick.disabled = false;
                elRun.textContent = oldLabel;
            }
        }
    }

    return () => scope.dispose();
}

function renderFingerprintAudit(r, elSummary, elResult) {
    const stat = (label, value, tone = '') => `
        <div class="fg-stat ${tone}">
            <div class="fg-stat-value">${escapeHtml(value)}</div>
            <div class="fg-stat-label">${escapeHtml(label)}</div>
        </div>`;
    elSummary.innerHTML = `
        <div class="fg-stat-grid">
            ${stat('finger 产品', r.fingerCount || 0)}
            ${stat('指纹规则', r.fingerRuleCount || 0)}
            ${stat('dir 产品', r.dirCount || 0)}
            ${stat('dir 路径', r.dirPathCount || 0)}
            ${stat('可识别产品', r.recognitionProductCount || r.fingerCount || 0, 'fg-good')}
            ${stat('Workflow 产品', r.workflowCount || 0)}
            ${stat('可验证产品', r.pocWithFingerWorkflowCount || 0, (r.pocWithFingerWorkflowCount || 0) ? 'fg-good' : '')}
            ${stat('Workflow POC 引用', r.workflowPocRefCount || 0)}
            ${stat('POC 文件', r.pocFileCount || 0)}
            ${stat('POC 带 ID', r.pocWithIdCount || 0)}
            ${stat('缺失 POC', r.missingPocCount || 0, (r.missingPocCount || 0) ? 'fg-bad' : 'fg-good')}
            ${stat('虚空 POC', r.virtualPocCount || r.orphanPocCount || 0, (r.virtualPocCount || r.orphanPocCount || 0) ? 'fg-warn' : 'fg-good')}
            ${stat('POC 有指纹', r.pocWithFingerCount || 0, (r.pocWithFingerCount || 0) ? 'fg-good' : '')}
            ${stat('POC 有指纹且可调用', r.pocWithFingerWorkflowCount || 0, (r.pocWithFingerWorkflowCount || 0) ? 'fg-good' : '')}
            ${stat('指纹无 POC', r.fingerWithoutPocCount || 0, (r.fingerWithoutPocCount || 0) ? 'fg-bad' : 'fg-good')}
            ${stat('POC 有指纹未进 Workflow', r.pocWithFingerNoWorkflowCount || 0, (r.pocWithFingerNoWorkflowCount || 0) ? 'fg-warn' : 'fg-good')}
            ${stat('POC 无识别入口/无效', r.pocWithoutFingerCount || 0, (r.pocWithoutFingerCount || 0) ? 'fg-bad' : 'fg-good')}
            ${stat('残缺 POC', r.incompletePocCount || 0, (r.incompletePocCount || 0) ? 'fg-bad' : 'fg-good')}
            ${stat('识别入口无 Workflow', r.recognitionWithoutWorkflowCount || r.fingerWithoutWorkflowCount || 0, (r.recognitionWithoutWorkflowCount || r.fingerWithoutWorkflowCount || 0) ? 'fg-warn' : 'fg-good')}
            ${stat('Workflow 无识别入口', r.workflowWithoutRecognitionCount || r.workflowWithoutFingerCount || 0, (r.workflowWithoutRecognitionCount || r.workflowWithoutFingerCount || 0) ? 'fg-bad' : 'fg-good')}
            ${stat('弱规则', r.weakRuleCount || 0, (r.weakRuleCount || 0) ? 'fg-bad' : 'fg-good')}
            ${stat('重复/共用规则', r.duplicateRuleGroupCount || 0, (r.duplicateRuleGroupCount || 0) ? 'fg-warn' : 'fg-good')}
            ${stat('Workflow 建议', r.workflowSuggestionCount || 0, (r.workflowSuggestionCount || 0) ? 'fg-good' : '')}
            ${stat('疑似误识别/资产类', r.assetOnlyProductCount || 0, (r.assetOnlyProductCount || 0) ? 'fg-warn' : '')}
        </div>
        <div class="fg-paths">
            <div><b>dddd:</b> <code>${escapeHtml(r.projectRoot || '')}</code></div>
            <div><b>finger:</b> <code>${escapeHtml(r.fingerPath || '')}</code></div>
            <div><b>dir:</b> <code>${escapeHtml(r.dirPath || '')}</code></div>
            <div><b>workflow:</b> <code>${escapeHtml(r.workflowPath || '')}</code></div>
            <div><b>pocs:</b> <code>${escapeHtml(r.pocDir || '')}</code></div>
        </div>`;

    elResult.innerHTML = [
        renderFingerprintFixGuide(r),
        renderFingerprintAuditIssueSections(r),
        `<div class="fg-reference-head">参考数据</div>`,
        renderPocCatalogGroups(r.pocGroups || [], 'builtin', false),
        `<div class="fg-result-grid fg-reference-grid">` + [
            renderFingerprintPocFingerTable('POC 有指纹且可调用', r.pocWithFingerWorkflowCount, r.pocWithFingerWorkflow, false),
            renderFingerprintPocFingerTable('POC 有指纹全集', r.pocWithFingerCount, r.pocWithFinger, false),
            renderFingerprintPocDetailTable('全部内置 POC', (r.allPocs || []).length, r.allPocs, false),
            renderFingerprintTable('POC 覆盖 Top 50', (r.topWorkflowProducts || []).length, r.topWorkflowProducts, ['产品', '指纹规则', 'POC'], (x) => [x.product, x.fingerRules, x.pocs], false),
            renderFingerprintTable('指纹规则 Top 50', (r.topFingerProducts || []).length, r.topFingerProducts, ['产品', '指纹规则', 'POC'], (x) => [x.product, x.fingerRules, x.pocs], false),
        ].join('') + `</div>`,
    ].join('');
}

function renderFingerprintFixGuide(r) {
    const workflowWithoutRecognition = r.workflowWithoutRecognitionCount || r.workflowWithoutFingerCount || 0;
    const recognitionWithoutWorkflow = r.recognitionWithoutWorkflowCount || r.fingerWithoutWorkflowCount || 0;
    const high = (r.fingerWithoutPocCount || 0) + (r.pocWithoutFingerCount || 0) + workflowWithoutRecognition + (r.weakRuleCount || 0);
    const medium = (r.virtualPocCount || r.orphanPocCount || 0) + (r.pocWithFingerNoWorkflowCount || 0) + recognitionWithoutWorkflow + (r.duplicateRuleGroupCount || 0) + (r.assetOnlyProductCount || 0);
    const suggestion = r.workflowSuggestionCount || 0;
    return `
        <div class="fg-fix-guide">
            <div>
                <b>整改入口</b>
                <span>下面优先展示所有非 0 问题；每行都标出原因、需要改的文件和建议动作。</span>
            </div>
            <div class="fg-fix-guide-stats">
                <span class="fg-severity fg-severity-high">高优先级 ${escapeHtml(high)}</span>
                <span class="fg-severity fg-severity-medium">中优先级 ${escapeHtml(medium)}</span>
                <span class="fg-severity fg-severity-info">自动建议 ${escapeHtml(suggestion)}</span>
            </div>
        </div>`;
}

function renderFingerprintAuditIssueSections(r) {
    const fingerPath = r.fingerPath || '';
    const dirPath = r.dirPath || '';
    const workflowPath = r.workflowPath || '';
    const pocDir = r.pocDir || '';
    const sections = [
        renderFingerprintIssueTable('识别入口无 POC：finger.yaml / dir.yaml 有产品但没有可用 POC', r.fingerWithoutPocCount, (r.fingerWithoutPoc || []).map((product) => ({
            level: '高',
            object: product,
            reason: '可识别产品没有任何已解析 workflow POC 覆盖',
            target: 'common/config/workflow.yaml / common/config/pocs',
            fix: '为该产品补 workflow.pocs 并创建或关联对应 POC；若只是资产识别，转入误识别/资产类核对。',
            path: workflowPath || pocDir,
        }))),
        renderFingerprintIssueTable('POC 无识别入口/疑似无效：POC 无法匹配 finger.yaml / dir.yaml 产品', r.pocWithoutFingerCount, (r.pocWithoutFinger || []).map((p) => ({
            level: '高',
            object: p.relPath || p.name || p.id || '-',
            reason: 'POC 的 id / info.name / 文件名无法匹配现有 finger 或 dir 产品',
            target: 'common/config/finger.yaml / common/config/dir.yaml / POC YAML',
            fix: '补充对应产品的 finger 指纹或 dir 路径，或修正 POC 的 id、info.name、文件名，使其能匹配真实产品。',
            path: p.path || fingerPath,
        }))),
        renderFingerprintIssueTable('Workflow 无识别入口：workflow.yaml 有产品但 finger.yaml / dir.yaml 都没有', r.workflowWithoutRecognitionCount || r.workflowWithoutFingerCount, (r.workflowWithoutRecognition || r.workflowWithoutFinger || []).map((product) => ({
            level: '高',
            object: product,
            reason: 'workflow 产品无法匹配任何识别入口产品',
            target: 'common/config/finger.yaml / common/config/dir.yaml / workflow.yaml',
            fix: '为该产品补 finger.yaml 指纹或 dir.yaml 路径，或统一 workflow 产品名与识别入口产品名。',
            path: fingerPath || dirPath || workflowPath,
        }))),
        renderFingerprintIssueTable('弱规则：容易误报或泛匹配', r.weakRuleCount, (r.weakRules || []).map((x) => ({
            level: '高',
            object: x.product || '-',
            reason: x.reason || '弱规则',
            target: 'common/config/finger.yaml',
            fix: x.rule || '-',
            path: fingerPath,
        }))),
        renderFingerprintIssueTable('虚空 POC：common/config/pocs 存在但 workflow 不可调用', r.virtualPocCount || r.orphanPocCount, (r.virtualPocs || r.orphanPocs || []).map((p) => ({
            level: '中',
            object: p.relPath || p.name || p.id || '-',
            reason: 'POC 文件未被 workflow.yaml 引用，实战扫描不会调用',
            target: 'common/config/workflow.yaml',
            fix: '确认有效则把 POC id 加入对应产品 workflow.pocs；无效则删除或归档。',
            path: p.path || workflowPath,
        }))),
        renderFingerprintIssueTable('POC 有指纹但未进 Workflow：可直接补调用链', r.pocWithFingerNoWorkflowCount, (r.pocWithFingerNoWorkflow || []).map((x) => ({
            level: '中',
            object: x.product || '-',
            reason: x.pocRelPath || x.poc || '-',
            target: 'common/config/workflow.yaml',
            fix: '把该 POC 加入匹配产品的 workflow.pocs，让已有 POC 可被调用。',
            path: x.path || workflowPath,
        }))),
        renderFingerprintIssueTable('残缺不完整 POC：字段或结构需要补齐', r.incompletePocCount, (r.incompletePocs || []).map((p) => ({
            level: '高',
            object: p.relPath || p.name || p.id || '-',
            reason: (p.issues || []).join('；') || 'POC 不完整',
            target: 'POC YAML',
            fix: '补齐 id、info.name、severity、requests 等关键字段，避免无法归类或无法调用。',
            path: p.path || pocDir,
        }))),
        renderFingerprintIssueTable('识别入口无 Workflow：有识别能力但没有调用配置', r.recognitionWithoutWorkflowCount || r.fingerWithoutWorkflowCount, (r.recognitionWithoutWorkflow || r.fingerWithoutWorkflow || []).map((product) => ({
            level: '中',
            object: product,
            reason: 'finger.yaml 或 dir.yaml 有产品，但 workflow.yaml 没有对应产品入口',
            target: 'common/config/workflow.yaml',
            fix: '若需要漏洞验证，补 workflow 产品与 pocs；若仅资产识别，保留并在误识别/资产类中确认。',
            path: workflowPath,
        }))),
        renderFingerprintIssueTable('重复/共用规则：多个产品命中同一规则', r.duplicateRuleGroupCount, (r.duplicateRules || []).map((x) => ({
            level: '中',
            object: (x.products || []).join(', ') || '-',
            reason: '同一条规则被多个产品共用，可能造成误识别',
            target: 'common/config/finger.yaml',
            fix: x.rule || '-',
            path: fingerPath,
        }))),
        renderFingerprintIssueTable('疑似重复产品名：归一化后产品名冲突', r.duplicateProductGroupCount, (r.duplicateProducts || []).map((x) => ({
            level: '中',
            object: x.name || '-',
            reason: (x.products || []).join(', ') || '-',
            target: 'finger.yaml / workflow.yaml',
            fix: '合并同义产品名或统一命名，避免覆盖统计被拆散。',
            path: fingerPath || workflowPath,
        }))),
        renderFingerprintIssueTable('Workflow 自动建议：可参考补 workflow.pocs', r.workflowSuggestionCount, (r.workflowSuggestions || []).map((x) => ({
            level: '建议',
            object: x.product || '-',
            reason: `${x.pocRelPath || x.poc || '-'} · ${x.confidence || 0}`,
            target: 'common/config/workflow.yaml',
            fix: x.reason || '候选 POC 与产品名相近，可人工确认后加入 workflow。',
            path: workflowPath,
        }))),
        renderFingerprintIssueTable('疑似误识别/资产识别类：需要人工确认是否应有 POC', r.assetOnlyProductCount, (r.assetOnlyProducts || []).map((product) => ({
            level: '中',
            object: product,
            reason: '有指纹但无 workflow 建议，可能只是资产识别或产品命名不准',
            target: 'finger.yaml / workflow.yaml',
            fix: '如果只用于资产识别可标记为资产类；如果需要验证能力，则补 workflow 与 POC。',
            path: fingerPath || workflowPath,
        }))),
        renderFingerprintIssueTable('缺失 POC：workflow.yaml 引用了不存在的 POC', r.missingPocCount, (r.missingPocs || []).map((x) => ({
            level: '高',
            object: x.product || '-',
            reason: x.poc || '-',
            target: 'common/config/pocs / workflow.yaml',
            fix: '创建对应 POC YAML，或从 workflow.pocs 中移除/改正错误引用。',
            path: workflowPath || pocDir,
        }))),
    ].filter(Boolean).join('');
    return `<div class="fg-problem-grid">${sections || '<div class="fg-empty">没有需要整改的问题。</div>'}</div>`;
}

function renderFingerprintIssueTable(title, total, items) {
    const list = (items || []).filter(Boolean);
    if (!(total || 0) && list.length === 0) return '';
    const rows = list.map((x) => {
        const object = x.object || '-';
        return `
        <tr data-poc-path="${escapeHtml(x.path || '')}" data-poc-rel="${escapeHtml(x.relPath || x.name || '')}">
            <td><span class="fg-severity fg-severity-${fingerprintIssueSeverityClass(x.level)}">${escapeHtml(x.level || '-')}</span></td>
            <td title="${escapeHtml(object)}">
                <div class="fg-copy-cell">
                    <span class="fg-copy-value">${escapeHtml(object)}</span>
                    <button class="fg-copy-object" data-copy-object="${escapeHtml(object)}" title="复制对象名" aria-label="复制对象名">复制</button>
                </div>
            </td>
            <td title="${escapeHtml(x.reason || '')}">${escapeHtml(x.reason || '-')}</td>
            <td title="${escapeHtml(x.target || '')}">${escapeHtml(x.target || '-')}</td>
            <td title="${escapeHtml(x.fix || '')}">${escapeHtml(x.fix || '-')}</td>
            <td>${x.path ? `<button class="fg-reveal" data-path="${escapeHtml(x.path)}">定位</button>` : '-'}</td>
        </tr>`;
    }).join('');
    const body = rows ? `
        <div class="fg-table-wrap">
        <table class="fg-table fg-issue-table">
            <thead><tr><th>级别</th><th>对象</th><th>原因</th><th>改哪里</th><th>怎么改</th><th>操作</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>` : '';
    return renderFingerprintSection(title, total || 0, body, list.length, true);
}

function fingerprintIssueSeverityClass(level) {
    if (level === '高') return 'high';
    if (level === '中') return 'medium';
    return 'info';
}

export { renderFingerprintGovernance };
