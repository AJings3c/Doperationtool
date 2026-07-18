const PANEL_KEY = 'doperationtool.panel-collapsed';
const panelState = { source: false, buffer: true, target: true };

try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(PANEL_KEY) || '{}');
    Object.assign(panelState, saved);
} catch (error) { /* storage is optional */ }

function savePanelState() {
    try { globalThis.localStorage?.setItem(PANEL_KEY, JSON.stringify(panelState)); } catch (error) { /* storage is optional */ }
}

function setPanelCollapsed(name, collapsed, documentRef = globalThis.document) {
    if (!(name in panelState)) return;
    panelState[name] = Boolean(collapsed);
    savePanelState();
    documentRef?.querySelector(`.yaml-panel-${name}`)?.classList.toggle('collapsed', panelState[name]);
}

export { panelState, setPanelCollapsed };
