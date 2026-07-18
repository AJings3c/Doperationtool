import test from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml, formatBytes, isTaskCancelledError, joinPath } from '../src/core/format.js';

test('escapeHtml escapes markup-sensitive characters', () => {
    assert.equal(escapeHtml(`<a x="1">Tom & 'Ada'</a>`), '&lt;a x=&quot;1&quot;&gt;Tom &amp; &#39;Ada&#39;&lt;/a&gt;');
});

test('formatBytes preserves the existing display thresholds', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(1024), '1.0 KB');
    assert.equal(formatBytes(1024 * 1024), '1.0 MB');
    assert.equal(formatBytes(undefined), '?');
});

test('joinPath and cancellation detection cover platform-neutral UI behavior', () => {
    assert.equal(joinPath('/tmp/root', 'a.yaml'), '/tmp/root/a.yaml');
    assert.equal(joinPath('/tmp/root/', 'a.yaml'), '/tmp/root/a.yaml');
    assert.equal(isTaskCancelledError('context canceled'), true);
    assert.equal(isTaskCancelledError('普通错误'), false);
});
