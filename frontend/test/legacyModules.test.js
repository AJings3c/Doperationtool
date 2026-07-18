import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const legacyDirectory = new URL('../src/features/legacy/', import.meta.url);
const expectedExports = [
    'renderFilenameExtract',
    'renderNucleiValidator',
    'renderPocConverter',
    'renderTemplateClassify',
    'renderTemplateDedup',
    'renderYamlCollect',
    'renderYamlConverter',
];

test('legacy tool barrel keeps every preserved tool importable', async () => {
    const legacy = await import('../src/features/legacy/index.js');
    assert.deepEqual(Object.keys(legacy).sort(), expectedExports);
    for (const name of expectedExports) assert.equal(typeof legacy[name], 'function');
});

test('legacy tools remain split into bounded feature modules', async () => {
    const files = (await readdir(legacyDirectory)).filter((file) => file.endsWith('.js'));
    assert.ok(files.length >= expectedExports.length + 2);

    for (const file of files) {
        const source = await readFile(new URL(file, legacyDirectory), 'utf8');
        const lineCount = source.split(/\r?\n/).length;
        assert.ok(lineCount < 1300, `${file} regressed to ${lineCount} lines`);
    }
});

test('shared legacy panel state is explicit and DOM-safe', async () => {
    const { panelState, setPanelCollapsed } = await import('../src/features/legacy/panelState.js');
    const toggles = [];
    const documentRef = {
        querySelector(selector) {
            return { classList: { toggle: (name, enabled) => toggles.push({ selector, name, enabled }) } };
        },
    };

    const previous = panelState.source;
    setPanelCollapsed('source', !previous, documentRef);
    assert.equal(panelState.source, !previous);
    assert.deepEqual(toggles, [{ selector: '.yaml-panel-source', name: 'collapsed', enabled: !previous }]);
    setPanelCollapsed('source', previous, null);
});
