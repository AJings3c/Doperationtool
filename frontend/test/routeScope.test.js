import test from 'node:test';
import assert from 'node:assert/strict';

import { createRouteScope, RouteDisposedError } from '../src/core/routeScope.js';

test('route scope suppresses results that arrive after disposal', async () => {
    const scope = createRouteScope();
    let resolve;
    const pending = new Promise((done) => { resolve = done; });
    const guarded = scope.guard(pending);
    scope.dispose();
    resolve('stale');
    await assert.rejects(guarded, RouteDisposedError);
});

test('route scope passes through results while active', async () => {
    const scope = createRouteScope();
    assert.equal(await scope.guard(Promise.resolve('fresh')), 'fresh');
    assert.equal(scope.active, true);
});
