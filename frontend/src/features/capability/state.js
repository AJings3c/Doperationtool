import { escapeHtml } from '../../core/format.js';

const FINGER_GOV_KEY = 'doperationtool.fingerprint_governance';
function loadFingerGovState() {
    try {
        const raw = localStorage.getItem(FINGER_GOV_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { root: '', history: [], importDir: '', importHistory: [], pocDir: '', pocHistory: [], pocReviewDir: '', pocReviewHistory: [], fingerReviewDir: '', fingerReviewHistory: [], dirReviewDir: '', dirReviewHistory: [] };
}
function saveFingerGovState(s) {
    try {
        localStorage.setItem(FINGER_GOV_KEY, JSON.stringify({
            root: s.root || '',
            history: s.history || [],
            importDir: s.importDir || '',
            importHistory: s.importHistory || [],
            pocDir: s.pocDir || '',
            pocHistory: s.pocHistory || [],
            pocReviewDir: s.pocReviewDir || '',
            pocReviewHistory: s.pocReviewHistory || [],
            fingerReviewDir: s.fingerReviewDir || '',
            fingerReviewHistory: s.fingerReviewHistory || [],
            dirReviewDir: s.dirReviewDir || '',
            dirReviewHistory: s.dirReviewHistory || [],
        }));
    } catch (e) {}
}
const fingerGovState = loadFingerGovState();
const capabilityRuntime = {
    lastFingerprintImportPreview: null,
    lastFingerprintReview: null,
    lastCapabilityScan: null,
    lastCapabilitySelection: null,
    lastCapabilityApplyResult: null,
};

function clearFingerprintReviewRuntime() {
    capabilityRuntime.lastFingerprintImportPreview = null;
    capabilityRuntime.lastFingerprintReview = null;
}

function clearExternalCapabilityRuntime() {
    capabilityRuntime.lastCapabilityScan = null;
    capabilityRuntime.lastCapabilitySelection = null;
    capabilityRuntime.lastCapabilityApplyResult = null;
}

function fingerShortPath(p) {
    const parts = String(p || '').split(/[\\/]+/).filter(Boolean);
    if (parts.length <= 2) return p;
    return '…/' + parts.slice(-2).join('/');
}

function pushFingerHistory(listName, valueName, path) {
    const p = String(path || '').trim();
    if (!p) return;
    const list = (fingerGovState[listName] || []).filter((x) => x !== p);
    list.unshift(p);
    fingerGovState[listName] = list.slice(0, 6);
    fingerGovState[valueName] = p;
    saveFingerGovState(fingerGovState);
}

function renderFingerHistoryChips(container, list, onPick) {
    if (!container) return;
    if (!list || list.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = `<span class="nv-hist-label">最近:</span>` +
        list.map((p) =>
            `<button class="nv-hist-chip" title="${escapeHtml(p)}" data-path="${escapeHtml(p)}">${escapeHtml(fingerShortPath(p))}</button>`
        ).join('');
    container.querySelectorAll('.nv-hist-chip').forEach((b) => {
        b.addEventListener('click', () => onPick(b.dataset.path || ''));
    });
}

export {
    capabilityRuntime,
    clearExternalCapabilityRuntime,
    clearFingerprintReviewRuntime,
    fingerGovState,
    fingerShortPath,
    pushFingerHistory,
    renderFingerHistoryChips,
    saveFingerGovState,
};
