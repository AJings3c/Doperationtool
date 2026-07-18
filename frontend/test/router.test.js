import test from 'node:test';
import assert from 'node:assert/strict';

import { createRouter } from '../src/app/router.js';

function navItem(tool) {
    const classes = new Set();
    return {
        dataset: { tool },
        classList: {
            toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
            contains(name) { return classes.has(name); },
        },
    };
}

function animatedContainer(markup = '') {
    const classes = new Set();
    const mutations = [];
    let layoutReads = 0;
    return {
        innerHTML: markup,
        classList: {
            add(name) {
                mutations.push(`add:${name}`);
                classes.add(name);
            },
            remove(name) {
                mutations.push(`remove:${name}`);
                classes.delete(name);
            },
            contains(name) { return classes.has(name); },
        },
        get offsetWidth() {
            layoutReads += 1;
            return 0;
        },
        get classMutations() { return mutations; },
        get layoutReads() { return layoutReads; },
    };
}

test('router restores a valid route and disposes it after the next mount succeeds', () => {
    const calls = [];
    const storage = new Map([['route', 'audit']]);
    const container = { innerHTML: 'old' };
    const breadcrumb = { textContent: '' };
    const auditNav = navItem('audit');
    const importNav = navItem('import');
    const router = createRouter({
        routes: {
            audit: { name: '审计', mount: () => { calls.push('mount:audit'); return () => calls.push('dispose:audit'); } },
            import: { name: '导入', render: () => calls.push('mount:import') },
        },
        container,
        breadcrumb,
        navItems: [auditNav, importNav],
        storage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
        storageKey: 'route',
        defaultRoute: 'audit',
        onBeforeNavigate: ({ to }) => calls.push(`before:${to}`),
    });

    assert.equal(router.start(), true);
    assert.equal(breadcrumb.textContent, '审计');
    assert.equal(auditNav.classList.contains('active'), true);
    assert.equal(router.navigate('import'), true);
    assert.deepEqual(calls, ['before:audit', 'mount:audit', 'before:import', 'mount:import', 'dispose:audit']);
    assert.equal(storage.get('route'), 'import');
    assert.equal(importNav.classList.contains('active'), true);
});

test('router replays the route entry state after each successful mount', () => {
    const container = animatedContainer();
    const router = createRouter({
        routes: {
            audit: { name: 'Audit', mount: (host) => { host.innerHTML = '<section>audit</section>'; } },
            import: { name: 'Import', mount: (host) => { host.innerHTML = '<section>import</section>'; } },
        },
        container,
        breadcrumb: { textContent: '' },
        storage: null,
        defaultRoute: 'audit',
    });

    assert.equal(router.start(), true);
    assert.equal(router.navigate('import'), true);
    assert.deepEqual(container.classMutations, [
        'remove:route-entering',
        'add:route-entering',
        'remove:route-entering',
        'add:route-entering',
    ]);
    assert.equal(container.layoutReads, 2);
    assert.equal(container.classList.contains('route-entering'), true);
});

test('router rejects unknown routes without disturbing the current page', () => {
    const router = createRouter({
        routes: { audit: { name: '审计', render: () => undefined } },
        container: { innerHTML: '' },
        breadcrumb: { textContent: '' },
        storage: null,
        defaultRoute: 'audit',
    });
    router.start();
    assert.equal(router.navigate('missing'), false);
    assert.equal(router.currentRoute, 'audit');
});

test('router restores the current page when the next route fails to mount', () => {
    const calls = [];
    const storage = new Map();
    const storageWrites = [];
    const container = { innerHTML: '' };
    const breadcrumb = { textContent: '' };
    const auditNav = navItem('audit');
    const brokenNav = navItem('broken');
    const router = createRouter({
        routes: {
            audit: {
                name: '审计',
                mount: (host) => {
                    host.innerHTML = '<section>audit</section>';
                    return () => calls.push('dispose:audit');
                },
            },
            broken: {
                name: '故障页',
                mount: (host) => {
                    host.innerHTML = '<section>partial</section>';
                    throw new Error('mount failed');
                },
            },
        },
        container,
        breadcrumb,
        navItems: [auditNav, brokenNav],
        storage: {
            getItem: (key) => storage.get(key),
            setItem: (key, value) => {
                storageWrites.push(value);
                storage.set(key, value);
            },
        },
        storageKey: 'route',
        defaultRoute: 'audit',
    });

    router.start();

    assert.throws(() => router.navigate('broken'), /mount failed/);
    assert.equal(container.innerHTML, '<section>audit</section>');
    assert.equal(router.currentRoute, 'audit');
    assert.equal(storage.get('route'), 'audit');
    assert.equal(breadcrumb.textContent, '审计');
    assert.equal(auditNav.classList.contains('active'), true);
    assert.equal(brokenNav.classList.contains('active'), false);
    assert.deepEqual(storageWrites, ['audit']);
    assert.deepEqual(calls, []);
});

test('router preserves the route entry state when the next mount fails', () => {
    const container = animatedContainer('<section>before</section>');
    const router = createRouter({
        routes: {
            audit: {
                name: 'Audit',
                mount: (host) => { host.innerHTML = '<section>audit</section>'; },
            },
            broken: {
                name: 'Broken',
                mount: (host) => {
                    host.innerHTML = '<section>partial</section>';
                    throw new Error('mount failed');
                },
            },
        },
        container,
        breadcrumb: { textContent: '' },
        storage: null,
        defaultRoute: 'audit',
    });

    router.start();
    const mutationsAfterStart = [...container.classMutations];
    const layoutReadsAfterStart = container.layoutReads;

    assert.throws(() => router.navigate('broken'), /mount failed/);
    assert.deepEqual(container.classMutations, mutationsAfterStart);
    assert.equal(container.layoutReads, layoutReadsAfterStart);
    assert.equal(container.classList.contains('route-entering'), true);
    assert.equal(container.innerHTML, '<section>audit</section>');
});
