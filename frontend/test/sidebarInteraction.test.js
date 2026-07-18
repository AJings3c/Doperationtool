import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const shellPath = fileURLToPath(new URL('../src/app/shell.js', import.meta.url));
const shell = readFileSync(shellPath, 'utf8');

test('sidebar resizer exposes the adjustable separator contract', () => {
    const separator = shell.match(/<div\b[^>]*class="sidebar-resizer"[^>]*>/)?.[0];

    assert.ok(separator, 'missing sidebar resizer');
    assert.match(separator, /role="separator"/);
    assert.match(separator, /tabindex="0"/);
    assert.match(separator, /aria-orientation="vertical"/);
    assert.match(separator, /aria-valuemin="\$\{SIDEBAR_MIN_WIDTH\}"/);
    assert.match(separator, /aria-valuemax="\$\{SIDEBAR_MAX_WIDTH\}"/);
    assert.match(separator, /aria-valuenow="\$\{sidebarState\.width\}"/);
    assert.match(separator, /aria-label="调整侧栏宽度"/);
    assert.match(shell, /resizer\.setAttribute\('aria-valuenow', String\([^)]*\)\)/);
});

test('sidebar drag uses pointer capture and preserves the grab offset', () => {
    assert.match(shell, /resizer\.setPointerCapture\(event\.pointerId\)/);
    assert.match(shell, /grabOffset:\s*event\.clientX\s*-\s*bounds\.right/);
    assert.match(shell, /const width = event\.clientX - resizeSession\.grabOffset - resizeSession\.sidebarLeft;/);
    assert.match(shell, /sidebar\.classList\.add\('resizing'\);/);
    assert.match(shell, /sidebar\.classList\.remove\('resizing'\);/);

    for (const eventName of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
        assert.match(shell, new RegExp(`resizer\\.addEventListener\\('${eventName}'`));
        assert.match(shell, new RegExp(`resizer\\.removeEventListener\\('${eventName}'`));
    }
    assert.doesNotMatch(shell, /addEventListener\('mouse(?:down|move|up)'/);
    assert.doesNotMatch(shell, /setTimeout\s*\(/);
});

test('sidebar separator has equivalent keyboard width controls', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
        assert.match(shell, new RegExp(`event\\.key === '${key}'`));
    }
    assert.match(shell, /resizer\.addEventListener\('keydown', onResizerKeyDown\)/);
    assert.match(shell, /setSidebarWidth\(nextWidth\);\s*saveSidebar\(\);/);
});

test('collapsed sidebar is inert and returns focus to its external toggle', () => {
    const controls = [...shell.matchAll(/<button\b[^>]*aria-controls="sidebar"[^>]*aria-expanded="\$\{!sidebarState\.hidden\}"[^>]*>/g)];

    assert.equal(controls.length, 2);
    assert.match(shell, /sidebar\.contains\(document\.activeElement\)[\s\S]*?toggleButton\.focus\(\{ preventScroll: true \}\);/);
    assert.match(shell, /sidebar\.toggleAttribute\('inert', sidebarState\.hidden\)/);
    assert.match(shell, /sidebar\.setAttribute\('aria-hidden', String\(sidebarState\.hidden\)\)/);
    assert.match(shell, /toggleButton\.setAttribute\('aria-expanded', String\(!sidebarState\.hidden\)\)/);
    assert.match(shell, /collapseButton\.setAttribute\('aria-expanded', String\(!sidebarState\.hidden\)\)/);
});

test('shell keeps desktop window and route behavior alongside pointer interaction', () => {
    assert.match(shell, /WindowToggleMaximise\(\)/);
    assert.match(shell, /event\.key\.toLowerCase\(\) === 'b'/);
    assert.match(shell, /event\.key\.toLowerCase\(\) === 's'/);
    assert.match(shell, /navigate\(item\.dataset\.tool\)/);
});
