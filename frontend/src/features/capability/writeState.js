const CAPABILITY_WRITE_STATE_KEY = 'doperationtool.capability_writes';

const CAPABILITY_WRITE_KIND = Object.freeze({
    EXTERNAL_APPLY: 'externalCapabilityApply',
    EXTERNAL_RESTORE: 'externalCapabilityRestore',
    FINGERPRINT_IMPORT_APPLY: 'fingerprintImportApply',
});

const KNOWN_KINDS = new Set(Object.values(CAPABILITY_WRITE_KIND));
const KNOWN_STATUSES = new Set(['running', 'succeeded', 'failed', 'interrupted']);
const EXTERNAL_WRITE_KINDS = new Set([
    CAPABILITY_WRITE_KIND.EXTERNAL_APPLY,
    CAPABILITY_WRITE_KIND.EXTERNAL_RESTORE,
]);
const RESULT_FIELDS = Object.freeze({
    [CAPABILITY_WRITE_KIND.EXTERNAL_APPLY]: [
        'fingerBackupPath',
        'dirBackupPath',
        'workflowBackupPath',
        'pocTargetDir',
        'logPath',
        'rulesAdded',
        'dirPathsAdded',
        'pocsCopied',
        'postAuditError',
    ],
    [CAPABILITY_WRITE_KIND.EXTERNAL_RESTORE]: [
        'restoredFinger',
        'restoredDir',
        'restoredWorkflow',
        'fingerCurrentBackupPath',
        'dirCurrentBackupPath',
        'workflowCurrentBackupPath',
        'logPath',
    ],
    [CAPABILITY_WRITE_KIND.FINGERPRINT_IMPORT_APPLY]: [
        'targetFingerPath',
        'backupPath',
        'productsCreated',
        'productsMerged',
        'rulesAdded',
    ],
});
const POST_AUDIT_FIELDS = [
    'passed',
    'issueCount',
    'missingPocCount',
    'virtualPocCount',
    'incompletePocCount',
    'pocWithoutFingerCount',
    'fingerWithoutPocCount',
    'recognitionWithoutWorkflowCount',
    'fingerWithoutWorkflowCount',
    'workflowWithoutRecognitionCount',
    'workflowWithoutFingerCount',
];

class CapabilityWriteConflictError extends Error {
    constructor(kind, conflictingKind) {
        super(`Capability write ${kind} conflicts with running operation ${conflictingKind}`);
        this.name = 'CapabilityWriteConflictError';
        this.code = 'CAPABILITY_WRITE_CONFLICT';
        this.kind = kind;
        this.conflictingKind = conflictingKind;
    }
}

function resolveStorage() {
    try {
        return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
    } catch (error) {
        return null;
    }
}

function emptyState() {
    return Object.fromEntries([...KNOWN_KINDS].map((kind) => [kind, null]));
}

function copyFields(value, fields) {
    if (!value || typeof value !== 'object') return null;
    const copy = {};
    for (const field of fields) {
        const fieldValue = value[field];
        if (fieldValue === undefined || fieldValue === null) continue;
        copy[field] = typeof fieldValue === 'string' ? fieldValue.slice(0, 4096) : fieldValue;
    }
    return copy;
}

function compactResult(kind, result) {
    const compact = copyFields(result, RESULT_FIELDS[kind] || []);
    if (!compact) return null;
    if (kind === CAPABILITY_WRITE_KIND.EXTERNAL_APPLY && result.postAudit) {
        compact.postAudit = copyFields(result.postAudit, POST_AUDIT_FIELDS);
    }
    return compact;
}

function compactOperation(kind, operation, includeLastSucceeded = true) {
    if (!operation) return null;
    const context = copyFields(operation.context, ['projectRoot', 'sourceDir', 'applyOperationId']) || {};
    return {
        id: String(operation.id || '').slice(0, 512),
        status: operation.status,
        context,
        result: compactResult(kind, operation.result),
        error: String(operation.error || '').slice(0, 4096),
        startedAt: operation.startedAt || '',
        finishedAt: operation.finishedAt || '',
        lastSucceeded: includeLastSucceeded
            ? compactOperation(kind, operation.lastSucceeded, false)
            : null,
    };
}

function compactState(state) {
    return Object.fromEntries([...KNOWN_KINDS].map((kind) => [kind, compactOperation(kind, state[kind])]));
}

function loadState(storage, now) {
    const state = emptyState();
    let recoveredRunning = false;
    if (!storage) return { state, recoveredRunning };
    try {
        const parsed = JSON.parse(storage.getItem(CAPABILITY_WRITE_STATE_KEY) || '{}');
        for (const kind of KNOWN_KINDS) {
            const operation = parsed && parsed[kind];
            if (!operation || !KNOWN_STATUSES.has(operation.status)) continue;
            state[kind] = operation.status === 'running'
                ? {
                    ...operation,
                    status: 'interrupted',
                    error: '应用已重载，无法确认该操作的最终结果',
                    finishedAt: operation.finishedAt || now(),
                }
                : operation;
            if (operation.status === 'running') recoveredRunning = true;
        }
    } catch (error) {}
    return { state, recoveredRunning };
}

function createCapabilityWriteStore({
    storage = resolveStorage(),
    now = () => new Date().toISOString(),
    makeId,
} = {}) {
    let sequence = 0;
    const listeners = new Set();
    const loaded = loadState(storage, now);
    const state = loaded.state;

    function persist() {
        if (!storage) return;
        try {
            storage.setItem(CAPABILITY_WRITE_STATE_KEY, JSON.stringify(compactState(state)));
        } catch (error) {}
    }

    if (loaded.recoveredRunning) persist();

    function publish(kind) {
        const event = { kind, operation: state[kind] };
        for (const listener of listeners) {
            try { listener(event); } catch (error) {}
        }
    }

    function start(kind, context = {}) {
        if (!KNOWN_KINDS.has(kind)) throw new Error(`Unknown capability write kind: ${kind}`);
        const conflictingKinds = EXTERNAL_WRITE_KINDS.has(kind) ? EXTERNAL_WRITE_KINDS : [kind];
        for (const conflictingKind of conflictingKinds) {
            if (state[conflictingKind]?.status === 'running') {
                throw new CapabilityWriteConflictError(kind, conflictingKind);
            }
        }
        const startedAt = now();
        const previous = state[kind];
        const lastSucceeded = previous?.status === 'succeeded'
            ? previous
            : previous?.lastSucceeded || null;
        const operation = {
            id: makeId ? makeId(kind, ++sequence) : `${kind}:${startedAt}:${++sequence}`,
            status: 'running',
            context,
            result: null,
            error: '',
            startedAt,
            finishedAt: '',
            lastSucceeded,
        };
        state[kind] = operation;
        persist();
        publish(kind);
        return operation;
    }

    function settle(kind, id, patch) {
        const current = state[kind];
        if (!current || current.id !== id) return current;
        state[kind] = { ...current, ...patch, finishedAt: now() };
        persist();
        publish(kind);
        return state[kind];
    }

    async function run(kind, context, task) {
        if (typeof task !== 'function') throw new TypeError('Capability write task must be a function');
        const operation = start(kind, context);
        try {
            const result = await task();
            settle(kind, operation.id, { status: 'succeeded', result, error: '', lastSucceeded: null });
            return result;
        } catch (error) {
            settle(kind, operation.id, { status: 'failed', result: null, error: String(error) });
            throw error;
        }
    }

    return {
        get(kind) {
            return state[kind] || null;
        },
        getLastSuccess(kind) {
            const operation = state[kind];
            if (operation?.status === 'succeeded') return operation;
            return operation?.lastSucceeded || null;
        },
        run,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

const capabilityWriteStore = createCapabilityWriteStore();

export {
    CAPABILITY_WRITE_KIND,
    CAPABILITY_WRITE_STATE_KEY,
    CapabilityWriteConflictError,
    capabilityWriteStore,
    createCapabilityWriteStore,
};
