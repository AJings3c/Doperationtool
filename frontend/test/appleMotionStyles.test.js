import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));

function read(relativePath) {
    return readFileSync(`${frontendRoot}${relativePath}`, 'utf8');
}

const foundation = read('src/styles/foundation.css');
const shell = read('src/styles/shell.css');
const feedback = read('src/styles/feedback.css');
const primitives = read('src/styles/primitives.css');
const motionStyles = [foundation, shell, feedback, primitives].join('\n');

test('shared motion tokens define restrained, non-bouncing timing', () => {
    assert.match(foundation, /--motion-fast:\s*100ms;/);
    assert.match(foundation, /--motion-standard:\s*180ms;/);
    assert.match(foundation, /--motion-slow:\s*220ms;/);
    assert.match(foundation, /--motion-ease-out-quart:\s*cubic-bezier\(0\.25,\s*1,\s*0\.5,\s*1\);/);
    assert.match(foundation, /--motion-ease-out-quint:\s*cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\);/);
    assert.doesNotMatch(motionStyles, /\b(?:bounce|spring)\b/i);
});

test('press feedback is compositor-only and excludes disabled controls', () => {
    const pressRule = foundation.match(/:where\(button, \.btn\):not\(:disabled\):active\s*\{([^}]*)\}/);

    assert.ok(pressRule);
    assert.match(pressRule[1], /transform:\s*scale\(0\.97\);/);
    assert.match(pressRule[1], /var\(--motion-fast\)/);
    assert.doesNotMatch(pressRule[1], /(?:width|height|margin|padding):/);
    assert.match(primitives, /\.btn\s*\{[^}]*transform var\(--motion-fast\)/s);
    assert.match(shell, /\.module-item\s*\{[^}]*transform var\(--motion-fast\)/s);
    assert.match(shell, /\.theme-toggle:hover:not\(:disabled\):active\s*\{[^}]*rotate\(-12deg\) scale\(0\.97\);/s);
});

test('sidebar and route motion stay interruptible and do not block input', () => {
    assert.match(shell, /\.sidebar\s*\{[^}]*width var\(--motion-standard\)[^}]*opacity var\(--motion-fast\)/s);
    assert.match(shell, /\.sidebar\.resizing\s*\{\s*transition:\s*none;/s);
    assert.match(shell, /\.sidebar-resizer\s*\{[^}]*touch-action:\s*none;/s);

    const routeRule = shell.match(/\.main-content\.route-entering > \*\s*\{([^}]*)\}/);
    assert.ok(routeRule);
    assert.match(routeRule[1], /route-content-enter var\(--motion-slow\)/);
    assert.doesNotMatch(routeRule[1], /pointer-events|animation-delay/);
    assert.match(shell, /@keyframes route-content-enter\s*\{[\s\S]*opacity:\s*0\.94;[\s\S]*translateY\(4px\)/);
});

test('feedback surfaces materialize without translucent materials', () => {
    assert.match(feedback, /\.toast\s*\{[^}]*translateY\(8px\) scale\(0\.98\)[^}]*var\(--motion-standard\)/s);
    assert.match(feedback, /\.global-progress\s*\{[^}]*feedback-materialize var\(--motion-slow\)/s);
    assert.match(feedback, /@keyframes feedback-materialize\s*\{[\s\S]*translateY\(6px\) scale\(0\.98\)/);

    for (const match of motionStyles.matchAll(/(?:-webkit-)?backdrop-filter:\s*([^;]+);/g)) {
        assert.equal(match[1].trim(), 'none');
    }
});

test('motion and material accessibility preferences have explicit fallbacks', () => {
    assert.match(motionStyles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    assert.match(motionStyles, /@media\s*\(prefers-reduced-transparency:\s*reduce\)/);
    assert.match(motionStyles, /@media\s*\(prefers-contrast:\s*more\)/);
    assert.match(shell, /prefers-reduced-motion:[\s\S]*\.main-content\.route-entering > \*\s*\{\s*animation:\s*none;/);
    assert.match(feedback, /prefers-reduced-motion:[\s\S]*\.gp-fill\.indeterminate\s*\{\s*animation:\s*none;/);
});

test('touched style layers use zero tracking', () => {
    const declarations = [...motionStyles.matchAll(/letter-spacing:\s*([^;]+);/g)]
        .map((match) => match[1].trim());

    assert.ok(declarations.length > 0);
    assert.deepEqual(new Set(declarations), new Set(['0']));
});
