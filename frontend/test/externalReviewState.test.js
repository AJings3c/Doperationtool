import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildExternalCapabilitySelection,
    createFingerprintReviewState,
    fingerprintReviewItemKey,
    rebuildFingerprintReviewState,
    renderExternalDirYaml,
    renderExternalFingerYaml,
    selectedExternalCapability,
    selectedPocPlan,
    toggleExternalCapabilitySelectionState,
    updateExternalCapabilitySelectionState,
    yamlSingleQuote,
} from '../src/features/capability/reviewState.js';

test('fingerprint review state rebuilds counts, removals, and YAML', () => {
    const preview = {
        items: [
            { product: 'alpha', relPath: 'a.yml', quality: 'high', rules: [{ expression: 'title="Alpha"', generic: false }] },
            { product: 'beta', relPath: 'b.yml', quality: 'low', rules: [{ expression: 'body~="beta"', generic: true }] },
        ],
    };
    const state = createFingerprintReviewState(preview);
    assert.equal(state.candidateCount, 2);
    assert.equal(state.ruleCount, 2);
    assert.match(state.ddddYaml, /'alpha':/);

    state.removedKeys.add(fingerprintReviewItemKey(preview.items[1]));
    rebuildFingerprintReviewState(state);
    assert.equal(state.candidateCount, 1);
    assert.equal(state.removedItems[0].product, 'beta');
    assert.doesNotMatch(state.ddddYaml, /'beta':/);
});

test('capability selection supports item toggles and complete projections', () => {
    const scan = {
        newFingers: [{ product: 'alpha', rules: ['x'] }, { product: 'beta', rules: ['y'] }],
        newDirs: [{ product: 'alpha', paths: ['/admin'] }],
        newPocs: [{ path: 'a.yml' }, { path: 'b.yml' }],
        pocApplyPlan: [{ sourcePath: 'a.yml' }, { sourcePath: 'b.yml' }],
    };
    const selection = buildExternalCapabilitySelection(scan);
    updateExternalCapabilitySelectionState(selection, 'finger', 'beta', false);
    toggleExternalCapabilitySelectionState(scan, selection, 'poc', false);
    updateExternalCapabilitySelectionState(selection, 'poc', 'a.yml', true);

    const selected = selectedExternalCapability(scan, selection);
    assert.deepEqual(selected.fingers.map((item) => item.product), ['alpha']);
    assert.deepEqual(selected.dirs.map((item) => item.product), ['alpha']);
    assert.deepEqual(selected.pocs.map((item) => item.path), ['a.yml']);
    assert.deepEqual(selectedPocPlan(scan, selection).map((item) => item.sourcePath), ['a.yml']);
});

test('YAML helpers quote values and omit empty entries', () => {
    assert.equal(yamlSingleQuote("O'Reilly"), "'O''Reilly'");
    assert.equal(renderExternalFingerYaml([{ product: 'alpha', rules: ['title="A"'] }]), "'alpha':\n  - 'title=\"A\"'\n");
    assert.equal(renderExternalDirYaml([{ product: 'alpha', paths: ['/admin'] }, { product: 'empty', paths: [] }]), "'alpha':\n  - '/admin'\n");
});
