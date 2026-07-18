import { AutoFixNucleiTemplates, ValidateNucleiTemplates } from '../../../wailsjs/go/main/App.js';
import { copyToClipboard, toast } from '../../core/feedback.js';
import { escapeHtml } from '../../core/format.js';
import { progressTracker } from '../../core/progress.js';

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

export { renderNucleiValidateResult };
