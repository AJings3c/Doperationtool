export function yamlSingleQuote(s) {
    return `'${String(s || '').replace(/'/g, "''")}'`;
}

export function createFingerprintReviewState(preview) {
    const items = (preview && preview.items || []).map((x) => ({ ...x }));
    const state = {
        ...preview,
        allItems: items,
        removedKeys: new Set(),
        removedItems: [],
        removed: [],
    };
    return rebuildFingerprintReviewState(state);
}

export function fingerprintReviewItemKey(itemOrProduct, relPath) {
    if (typeof itemOrProduct === 'object') {
        return `${itemOrProduct.product || ''}\u0000${itemOrProduct.relPath || itemOrProduct.path || ''}`;
    }
    return `${itemOrProduct || ''}\u0000${relPath || ''}`;
}

export function rebuildFingerprintReviewState(state) {
    const active = (state.allItems || []).filter((x) => !state.removedKeys.has(fingerprintReviewItemKey(x)));
    const removedItems = (state.allItems || []).filter((x) => state.removedKeys.has(fingerprintReviewItemKey(x)));
    state.items = active;
    state.removedItems = removedItems;
    state.removed = removedItems.map((x) => ({
        path: x.path || '',
        relPath: x.relPath || x.product || '',
        reason: '人工从本次指纹审核移除',
    }));
    state.ddddYaml = renderFingerprintReviewYaml(active);
    state.candidateCount = active.length;
    state.productCount = active.length;
    state.ruleCount = active.reduce((n, x) => n + ((x.rules || []).length), 0);
    state.highConfidenceCount = active.filter((x) => x.quality === 'high').length;
    state.genericRuleCount = active.reduce((n, x) => n + ((x.rules || []).filter((rule) => rule && rule.generic).length), 0);
    return state;
}

export function renderFingerprintReviewYaml(items) {
    const list = (items || []).filter((x) => x && x.product && (x.rules || []).length);
    if (!list.length) return '';
    return list.map((item) => [
        `${yamlSingleQuote(item.product)}:`,
        ...(item.rules || []).map((rule) => `  - ${yamlSingleQuote(rule.expression || rule.original || '')}`),
    ].join('\n')).join('\n\n') + '\n';
}

export function buildExternalCapabilitySelection(r) {
    return {
        fingerProducts: new Set((r.newFingers || []).map((x) => x.product || '').filter(Boolean)),
        pocPaths: new Set((r.newPocs || []).map((x) => x.path || '').filter(Boolean)),
    };
}

export function isExternalFingerSelected(selection, product) {
    return !!(selection && selection.fingerProducts && selection.fingerProducts.has(product || ''));
}

export function isExternalPocSelected(selection, path) {
    return !!(selection && selection.pocPaths && selection.pocPaths.has(path || ''));
}

export function updateExternalCapabilitySelectionState(selection, kind, key, checked) {
    const next = selection || { fingerProducts: new Set(), pocPaths: new Set() };
    const set = kind === 'finger' ? next.fingerProducts : next.pocPaths;
    if (!key) return next;
    if (checked) set.add(key);
    else set.delete(key);
    return next;
}

export function toggleExternalCapabilitySelectionState(scan, selection, kind, checked) {
    const next = selection || buildExternalCapabilitySelection(scan);
    if (kind === 'finger') {
        next.fingerProducts = checked
            ? new Set((scan.newFingers || []).map((x) => x.product || '').filter(Boolean))
            : new Set();
    } else if (kind === 'poc') {
        next.pocPaths = checked
            ? new Set((scan.newPocs || []).map((x) => x.path || '').filter(Boolean))
            : new Set();
    }
    return next;
}

export function selectedExternalCapability(scan, selection) {
    const effective = selection || buildExternalCapabilitySelection(scan);
    return {
        fingers: (scan.newFingers || []).filter((x) => isExternalFingerSelected(effective, x.product)),
        pocs: (scan.newPocs || []).filter((x) => isExternalPocSelected(effective, x.path)),
    };
}

export function selectedPocPlan(scan, selection) {
    const effective = selection || buildExternalCapabilitySelection(scan);
    return (scan.pocApplyPlan || []).filter((x) => isExternalPocSelected(effective, x.sourcePath));
}

export function renderExternalFingerYaml(fingers) {
    const list = (fingers || []).filter((x) => x && x.product && (x.rules || []).length);
    if (!list.length) return '';
    return list.map((entry) => [
        `${yamlSingleQuote(entry.product)}:`,
        ...(entry.rules || []).map((rule) => `  - ${yamlSingleQuote(rule)}`),
    ].join('\n')).join('\n\n') + '\n';
}
