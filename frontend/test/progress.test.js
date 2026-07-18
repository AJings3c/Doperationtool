import test from 'node:test';
import assert from 'node:assert/strict';

import { createProgressTracker } from '../src/core/progress.js';

function createElement() {
    const classes = new Set();
    return {
        hidden: true,
        disabled: false,
        textContent: '',
        onclick: null,
        style: {},
        classList: {
            add(...names) { names.forEach((name) => classes.add(name)); },
            remove(...names) { names.forEach((name) => classes.delete(name)); },
            contains(name) { return classes.has(name); },
        },
    };
}

function createDocument() {
    const elements = new Map([
        ['global-progress', createElement()],
        ['gp-title', createElement()],
        ['gp-phase', createElement()],
        ['gp-label', createElement()],
        ['gp-fill', createElement()],
        ['gp-cancel', createElement()],
        ['gp-elapsed', createElement()],
    ]);
    return {
        elements,
        getElementById(id) { return elements.get(id) || null; },
    };
}

test('progress remains globally visible and cancellable until the task ends', async () => {
    const documentRef = createDocument();
    let cancelCalls = 0;
    let unsubscribeCalls = 0;
    const eventsOffCalls = [];
    const tracker = createProgressTracker({
        documentRef,
        cancelCurrentTask: async () => { cancelCalls += 1; },
        eventsOn: () => () => { unsubscribeCalls += 1; },
        eventsOff: (eventName) => eventsOffCalls.push(eventName),
    });

    tracker.start('audit:progress', '审计中');

    const card = documentRef.elements.get('global-progress');
    const cancel = documentRef.elements.get('gp-cancel');
    assert.equal(card.hidden, false);
    assert.equal(typeof cancel.onclick, 'function');

    // Route changes do not own this application-level tracker, so it stays usable.
    await cancel.onclick();
    assert.equal(cancelCalls, 1);
    assert.equal(card.hidden, false);
    assert.equal(unsubscribeCalls, 0);

    tracker.endTask();
    assert.equal(card.hidden, true);
    assert.equal(cancel.onclick, null);
    assert.equal(unsubscribeCalls, 1);
    assert.deepEqual(eventsOffCalls, ['audit:progress']);
});

test('disposing the tracker tears down an active application-level task view', () => {
    const documentRef = createDocument();
    let unsubscribeCalls = 0;
    const tracker = createProgressTracker({
        documentRef,
        eventsOn: () => () => { unsubscribeCalls += 1; },
        eventsOff: () => {},
    });

    tracker.start('scan:progress', '扫描中');
    tracker.dispose();

    assert.equal(documentRef.elements.get('global-progress').hidden, true);
    assert.equal(unsubscribeCalls, 1);
});

test('a completed old task cannot hide a newer task', () => {
    const documentRef = createDocument();
    let unsubscribeCalls = 0;
    const tracker = createProgressTracker({
        documentRef,
        eventsOn: () => () => { unsubscribeCalls += 1; },
        eventsOff: () => {},
    });

    const oldTask = tracker.start('old:progress', 'Old task');
    const newTask = tracker.start('new:progress', 'New task');

    assert.equal(oldTask.active, false);
    assert.equal(newTask.active, true);
    assert.equal(oldTask.end(), false);
    assert.equal(documentRef.elements.get('global-progress').hidden, false);
    assert.equal(newTask.end(), true);
    assert.equal(documentRef.elements.get('global-progress').hidden, true);
    assert.equal(unsubscribeCalls, 2);
});
