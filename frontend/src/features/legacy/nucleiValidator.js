import { SelectDirectory, ValidateNucleiTemplates } from '../../../wailsjs/go/main/App.js';
import { toast } from '../../core/feedback.js';
import { escapeHtml } from '../../core/format.js';
import { progressTracker } from '../../core/progress.js';

import { renderNucleiValidateResult } from './nucleiValidation.js';

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

export { renderNucleiValidator };
