import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CAPABILITY_WRITE_KIND,
    CAPABILITY_WRITE_STATE_KEY,
    CapabilityWriteConflictError,
    createCapabilityWriteStore,
} from '../src/features/capability/writeState.js';

function memoryStorage(maxLength = Number.POSITIVE_INFINITY) {
    const values = new Map();
    return {
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) {
            if (value.length > maxLength) throw new Error('QuotaExceededError');
            values.set(key, value);
        },
        values,
    };
}

function testStore(storage) {
    let tick = 0;
    return createCapabilityWriteStore({
        storage,
        now: () => `2026-07-18T00:00:0${tick++}.000Z`,
        makeId: (kind, sequence) => `${kind}:${sequence}`,
    });
}

test('write results settle and persist after the page subscriber is disposed', async () => {
    const storage = memoryStorage();
    const store = testStore(storage);
    const events = [];
    const unsubscribe = store.subscribe(({ operation }) => events.push(operation.status));
    let finishWrite;
    const backendWrite = new Promise((resolve) => { finishWrite = resolve; });

    const pending = store.run(
        CAPABILITY_WRITE_KIND.EXTERNAL_APPLY,
        { projectRoot: 'D:/dddd' },
        () => backendWrite,
    );
    assert.equal(store.get(CAPABILITY_WRITE_KIND.EXTERNAL_APPLY).status, 'running');

    unsubscribe();
    finishWrite({ fingerBackupPath: 'D:/dddd/finger.yaml.bak' });
    await pending;

    assert.deepEqual(events, ['running']);
    assert.equal(store.get(CAPABILITY_WRITE_KIND.EXTERNAL_APPLY).status, 'succeeded');
    assert.equal(
        store.getLastSuccess(CAPABILITY_WRITE_KIND.EXTERNAL_APPLY).result.fingerBackupPath,
        'D:/dddd/finger.yaml.bak',
    );

    const restoredStore = testStore(storage);
    assert.equal(restoredStore.get(CAPABILITY_WRITE_KIND.EXTERNAL_APPLY).status, 'succeeded');
    assert.equal(
        restoredStore.getLastSuccess(CAPABILITY_WRITE_KIND.EXTERNAL_APPLY).result.fingerBackupPath,
        'D:/dddd/finger.yaml.bak',
    );
});

test('a failed retry retains the last successful backup result', async () => {
    const storage = memoryStorage();
    const store = testStore(storage);
    await store.run(
        CAPABILITY_WRITE_KIND.FINGERPRINT_IMPORT_APPLY,
        { projectRoot: 'D:/dddd' },
        async () => ({ backupPath: 'D:/dddd/finger.yaml.bak' }),
    );

    await assert.rejects(
        store.run(
            CAPABILITY_WRITE_KIND.FINGERPRINT_IMPORT_APPLY,
            { projectRoot: 'D:/other' },
            async () => { throw new Error('write failed'); },
        ),
        /write failed/,
    );

    assert.equal(store.get(CAPABILITY_WRITE_KIND.FINGERPRINT_IMPORT_APPLY).status, 'failed');
    assert.equal(
        store.getLastSuccess(CAPABILITY_WRITE_KIND.FINGERPRINT_IMPORT_APPLY).result.backupPath,
        'D:/dddd/finger.yaml.bak',
    );
    const restoredStore = testStore(storage);
    assert.equal(restoredStore.get(CAPABILITY_WRITE_KIND.FINGERPRINT_IMPORT_APPLY).status, 'failed');
    assert.match(restoredStore.get(CAPABILITY_WRITE_KIND.FINGERPRINT_IMPORT_APPLY).error, /write failed/);
    assert.equal(
        restoredStore.getLastSuccess(CAPABILITY_WRITE_KIND.FINGERPRINT_IMPORT_APPLY).result.backupPath,
        'D:/dddd/finger.yaml.bak',
    );
});

test('a persisted in-flight operation is marked unknown after an app reload', () => {
    const storage = memoryStorage();
    storage.setItem(CAPABILITY_WRITE_STATE_KEY, JSON.stringify({
        [CAPABILITY_WRITE_KIND.EXTERNAL_RESTORE]: {
            id: 'restore:1',
            status: 'running',
            context: { projectRoot: 'D:/dddd' },
            startedAt: '2026-07-18T00:00:00.000Z',
        },
    }));

    const store = testStore(storage);
    assert.equal(store.get(CAPABILITY_WRITE_KIND.EXTERNAL_RESTORE).status, 'interrupted');
    assert.match(store.get(CAPABILITY_WRITE_KIND.EXTERNAL_RESTORE).error, /无法确认/);
    assert.equal(
        JSON.parse(storage.getItem(CAPABILITY_WRITE_STATE_KEY))[CAPABILITY_WRITE_KIND.EXTERNAL_RESTORE].status,
        'interrupted',
    );
});

test('external apply and restore cannot run at the same time', async () => {
    const store = testStore(memoryStorage());
    let finishApply;
    const applyPending = store.run(
        CAPABILITY_WRITE_KIND.EXTERNAL_APPLY,
        { projectRoot: 'D:/dddd' },
        () => new Promise((resolve) => { finishApply = resolve; }),
    );
    let restoreStarted = false;

    await assert.rejects(
        store.run(
            CAPABILITY_WRITE_KIND.EXTERNAL_RESTORE,
            { projectRoot: 'D:/dddd' },
            async () => { restoreStarted = true; },
        ),
        (error) => error instanceof CapabilityWriteConflictError
            && error.code === 'CAPABILITY_WRITE_CONFLICT'
            && error.conflictingKind === CAPABILITY_WRITE_KIND.EXTERNAL_APPLY,
    );
    assert.equal(restoreStarted, false);

    finishApply({ fingerBackupPath: 'D:/dddd/finger.yaml.bak' });
    await applyPending;
    let finishRestore;
    const restorePending = store.run(
        CAPABILITY_WRITE_KIND.EXTERNAL_RESTORE,
        { projectRoot: 'D:/dddd' },
        () => new Promise((resolve) => { finishRestore = resolve; }),
    );
    await assert.rejects(
        store.run(
            CAPABILITY_WRITE_KIND.EXTERNAL_APPLY,
            { projectRoot: 'D:/dddd' },
            async () => ({ fingerBackupPath: 'unused' }),
        ),
        (error) => error instanceof CapabilityWriteConflictError
            && error.conflictingKind === CAPABILITY_WRITE_KIND.EXTERNAL_RESTORE,
    );
    finishRestore({ restoredFinger: true });
    await restorePending;
    assert.equal(store.get(CAPABILITY_WRITE_KIND.EXTERNAL_RESTORE).status, 'succeeded');
});

test('large apply plans are omitted from storage without losing backup metadata', async () => {
    const storage = memoryStorage(4096);
    const store = testStore(storage);
    const pocApplyPlan = Array.from({ length: 2000 }, (_, index) => ({
        sourcePath: `D:/reviews/${index}/`.padEnd(160, 'x'),
        targetPath: `D:/dddd/pocs/${index}/`.padEnd(160, 'y'),
    }));

    await store.run(
        CAPABILITY_WRITE_KIND.EXTERNAL_APPLY,
        { projectRoot: 'D:/dddd' },
        async () => ({
            fingerBackupPath: 'D:/dddd/finger.yaml.bak',
            workflowBackupPath: 'D:/dddd/workflow.yaml.bak',
            rulesAdded: 12,
            pocApplyPlan,
        }),
    );

    assert.equal(store.get(CAPABILITY_WRITE_KIND.EXTERNAL_APPLY).result.pocApplyPlan.length, 2000);
    const persisted = storage.getItem(CAPABILITY_WRITE_STATE_KEY);
    assert.ok(persisted.length < 4096);
    assert.doesNotMatch(persisted, /sourcePath/);

    const restoredStore = testStore(storage);
    const restored = restoredStore.getLastSuccess(CAPABILITY_WRITE_KIND.EXTERNAL_APPLY).result;
    assert.equal(restored.fingerBackupPath, 'D:/dddd/finger.yaml.bak');
    assert.equal(restored.workflowBackupPath, 'D:/dddd/workflow.yaml.bak');
    assert.equal(restored.rulesAdded, 12);
    assert.equal(restored.pocApplyPlan, undefined);
});
