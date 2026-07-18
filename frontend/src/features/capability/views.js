import { escapeHtml } from '../../core/format.js';

function renderFingerprintSection(title, total, body, shown = 0, defaultOpen) {
    const suffix = total > shown ? ` · 显示前 ${shown} 条` : '';
    const open = defaultOpen === false ? '' : ((total || 0) > 0 ? 'open' : '');
    return `
    <details class="fg-section" ${open}>
        <summary>${escapeHtml(title)} <span>${escapeHtml(total || 0)}${escapeHtml(suffix)}</span></summary>
        ${body || '<div class="fg-empty">暂无问题</div>'}
    </details>`;
}

function renderFingerprintTable(title, total, items, headers, rowFn, defaultOpen) {
    const list = items || [];
    const rows = list.map((item) => {
        const cols = rowFn(item).map((v) => `<td title="${escapeHtml(v)}">${escapeHtml(v)}</td>`).join('');
        return `<tr>${cols}</tr>`;
    }).join('');
    const body = rows ? `
        <div class="fg-table-wrap">
        <table class="fg-table">
            <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
        </table></div>` : '';
    return renderFingerprintSection(title, total || 0, body, list.length, defaultOpen);
}

function renderFingerprintPocTable(title, total, items, defaultOpen) {
    const list = items || [];
    const rows = list.map((x) => `
        <tr>
            <td title="${escapeHtml(x.relPath || x.name || '')}">${escapeHtml(x.relPath || x.name || '')}</td>
            <td title="${escapeHtml(x.id || '')}">${escapeHtml(x.id || '-')}</td>
            <td><button class="fg-reveal" data-path="${escapeHtml(x.path || '')}">定位</button></td>
        </tr>`).join('');
    const body = rows ? `
        <div class="fg-table-wrap">
        <table class="fg-table fg-poc-table">
            <thead><tr><th>文件</th><th>ID</th><th>操作</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>` : '';
    return renderFingerprintSection(title, total || 0, body, list.length, defaultOpen);
}

function renderFingerprintPocDetailTable(title, total, items, defaultOpen) {
    const list = items || [];
    const rows = list.map((x) => {
        const workflow = (x.workflowProducts || []).join(', ') || (x.referencedByWorkflow ? '已引用' : '未引用');
        const matched = x.matchedProduct ? `${x.matchedProduct} (${x.matchConfidence || 0})` : '-';
        const issues = (x.issues || []).join('\n') || (x.incomplete ? '不完整' : '-');
        return `
        <tr>
            <td title="${escapeHtml(x.relPath || x.name || '')}">${escapeHtml(x.relPath || x.name || '')}</td>
            <td title="${escapeHtml(x.id || '')}">${escapeHtml(x.id || '-')}</td>
            <td title="${escapeHtml(x.infoName || '')}">${escapeHtml(x.infoName || '-')}</td>
            <td title="${escapeHtml(matched)}">${escapeHtml(matched)}</td>
            <td title="${escapeHtml(workflow)}">${escapeHtml(workflow)}</td>
            <td title="${escapeHtml(issues)}">${x.duplicate ? '<span class="fg-dup-mark">重复</span> ' : ''}${escapeHtml(issues)}</td>
            <td><button class="fg-reveal" data-path="${escapeHtml(x.path || '')}">定位</button></td>
        </tr>`;
    }).join('');
    const body = rows ? `
        <div class="fg-table-wrap">
        <table class="fg-table fg-poc-detail-table">
            <thead><tr><th>文件</th><th>ID</th><th>info.name</th><th>匹配指纹</th><th>Workflow</th><th>问题</th><th>操作</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>` : '';
    return renderFingerprintSection(title, total || 0, body, list.length, defaultOpen);
}

function renderFingerprintPocFingerTable(title, total, items, defaultOpen) {
    const list = items || [];
    const rows = list.map((x) => `
        <tr>
            <td title="${escapeHtml(x.product || '')}">${escapeHtml(x.product || '')}</td>
            <td title="${escapeHtml(x.pocRelPath || x.poc || '')}">${escapeHtml(x.pocRelPath || x.poc || '')}</td>
            <td title="${escapeHtml(x.pocId || '')}">${escapeHtml(x.pocId || '-')}</td>
            <td title="${escapeHtml(x.confidence || 0)}">${escapeHtml(x.confidence || 0)}</td>
            <td title="${escapeHtml(x.reason || '')}">${escapeHtml(x.reason || '')}</td>
            <td><button class="fg-reveal" data-path="${escapeHtml(x.path || '')}">定位</button></td>
        </tr>`).join('');
    const body = rows ? `
        <div class="fg-table-wrap">
        <table class="fg-table fg-poc-finger-table">
            <thead><tr><th>指纹</th><th>POC 文件</th><th>ID</th><th>置信</th><th>匹配依据</th><th>操作</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>` : '';
    return renderFingerprintSection(title, total || 0, body, list.length, defaultOpen);
}

function renderPocCatalogGroups(groups, sourceType = 'builtin', defaultOpen) {
    const list = groups || [];
    const isExternal = sourceType === 'external';
    const cards = list.map((g, i) => {
        const pocs = (g.pocs || []).slice(0, 80).map((p) => {
            const flags = (isExternal ? [
                p.incomplete ? '残缺' : '',
                p.matchConfidence ? `${p.matchConfidence}` : '',
            ] : [
                p.referencedByWorkflow ? 'workflow' : '虚空',
                p.incomplete ? '残缺' : '',
                p.matchConfidence ? `${p.matchConfidence}` : '',
            ]).filter(Boolean).join(' · ');
            return `
                <div class="fg-poc-mini-row" data-poc-path="${escapeHtml(p.path || '')}" data-poc-rel="${escapeHtml(p.relPath || p.name || '')}">
                    <button class="fg-reveal" data-path="${escapeHtml(p.path || '')}">定位</button>
                    <span title="${escapeHtml(p.relPath || p.name || '')}">${escapeHtml(p.relPath || p.name || '')}</span>
                    <em>${p.duplicate ? '重复' : escapeHtml(flags)}</em>
                </div>`;
        }).join('');
        const more = (g.pocs || []).length > 80 ? `<div class="fg-empty">还有 ${(g.pocs || []).length - 80} 个 POC 未展示，可看详情列表。</div>` : '';
        const meta = isExternal
            ? `指纹规则 ${escapeHtml(g.fingerRuleCount || 0)} · 外部 POC ${escapeHtml(g.pocCount || 0)} · 残缺 ${escapeHtml(g.incompletePocCount || 0)}`
            : `指纹规则 ${escapeHtml(g.fingerRuleCount || 0)} · workflow 引用 ${escapeHtml(g.workflowPocCount || 0)} · 可调用 ${escapeHtml(g.referencedPocCount || 0)} · 虚空 ${escapeHtml(g.unreferencedPocCount || 0)} · 残缺 ${escapeHtml(g.incompletePocCount || 0)}`;
        return `
        <section class="fg-class-card" id="pc-group-${i}">
            <div class="fg-class-card-head">
                <b title="${escapeHtml(g.product || '')}">${escapeHtml(g.product || '')}</b>
                <span>${escapeHtml(g.pocCount || 0)} 个 POC</span>
            </div>
            <div class="fg-poc-group-meta">
                ${meta}
            </div>
            <div class="fg-poc-mini-list">${pocs || '<div class="fg-empty">暂无 POC</div>'}${more}</div>
        </section>`;
    }).join('');
    const body = cards ? `<div class="fg-catalog-groups">${cards}</div>` : '';
    return renderFingerprintSection('按组件指纹归类', list.length, body, list.length, defaultOpen);
}

function renderFingerprintList(title, total, items, defaultOpen) {
    const list = items || [];
    const body = list.length
        ? `<div class="fg-chip-list">${list.map((x) => `<span class="fg-chip" title="${escapeHtml(x)}">${escapeHtml(x)}</span>`).join('')}</div>`
        : '';
    return renderFingerprintSection(title, total || 0, body, list.length, defaultOpen);
}

export {
    renderFingerprintList,
    renderFingerprintPocDetailTable,
    renderFingerprintPocFingerTable,
    renderFingerprintPocTable,
    renderFingerprintSection,
    renderFingerprintTable,
    renderPocCatalogGroups,
};
