import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));

function read(relativePath) {
    return readFileSync(`${frontendRoot}${relativePath}`, 'utf8');
}

function capabilitySource() {
    const featureDirectory = `${frontendRoot}src/features/capability`;
    return readdirSync(featureDirectory)
        .filter((name) => name.endsWith('.js'))
        .map((name) => readFileSync(`${featureDirectory}/${name}`, 'utf8'))
        .join('\n');
}

function activeStyles() {
    const manifest = read('src/style.css');
    return [...manifest.matchAll(/@import\s+['"]\.\/([^'"]+)['"]/g)]
        .map(([, relativePath]) => read(`src/${relativePath}`))
        .join('\n');
}

function variablesFrom(css, selectorPattern) {
    const block = css.match(new RegExp(`${selectorPattern}\\s*\\{([\\s\\S]*?)\\}`));
    assert.ok(block, `missing CSS variable block: ${selectorPattern}`);
    return Object.fromEntries(
        [...block[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)]
            .map(([, name, value]) => [name, value]),
    );
}

function luminance(hex) {
    const channels = [1, 3, 5]
        .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
        .map((channel) => channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4);
    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(foreground, background) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

test('primary navigation uses native keyboard-operable controls', () => {
    const shell = read('src/app/shell.js');
    const shellStyles = read('src/styles/shell.css');
    const navigationButtons = [...shell.matchAll(/<button\b[^>]*class="module-item"[^>]*data-tool="([^"]+)"[^>]*>/g)];
    const moduleItemRule = shellStyles.match(/\.module-item\s*\{([^}]*)\}/);
    const activeRule = shellStyles.match(/\.module-item\.active\s*\{([^}]*)\}/);

    assert.match(shell, /<nav\b[^>]*aria-label="主要功能"/);
    assert.equal(navigationButtons.length, 4);
    assert.deepEqual(
        navigationButtons.map((match) => match[1]),
        ['fingerprint-governance', 'poc-catalog', 'dddd-fingerprint-converter', 'external-capability'],
    );
    for (const [tag] of navigationButtons) assert.match(tag, /type="button"/);
    assert.doesNotMatch(shell, /<li\b[^>]*class="module-item"/);
    assert.ok(moduleItemRule);
    assert.ok(activeRule);
    assert.doesNotMatch(moduleItemRule[1], /border-left/);
    assert.doesNotMatch(activeRule[1], /border-left/);
    assert.doesNotMatch(shellStyles, /border-left(?:-color)?:/);
    assert.match(activeRule[1], /box-shadow:\s*inset 0 0 0 1px var\(--accent\)/);
});

test('save shortcut only intercepts when the legacy save control is available', () => {
    const shell = read('src/app/shell.js');

    assert.match(shell, /event\.key\.toLowerCase\(\) === 's'/);
    assert.match(shell, /getElementById\('btn-src-save'\)/);
    assert.match(shell, /if \(!saveButton \|\| saveButton\.disabled\) return;/);
    assert.match(shell, /event\.preventDefault\(\);\s*saveButton\.click\(\);/);
});

test('active CSS manifest does not load preserved legacy feature styles', () => {
    const activeManifest = read('src/style.css');
    const legacyManifest = read('src/styles/legacy.css');

    assert.match(activeManifest, /shared-controls\.css/);
    for (const stylesheet of ['yaml-workbench.css', 'validation.css', 'template-tools.css', 'compat.css', 'yaml-browser.css']) {
        assert.doesNotMatch(activeManifest, new RegExp(stylesheet.replace('.', '\\.')));
        assert.match(legacyManifest, new RegExp(stylesheet.replace('.', '\\.')));
    }
});

test('active status surfaces avoid thick side-stripe borders', () => {
    assert.doesNotMatch(activeStyles(), /border-(?:left|right):\s*(?:[2-9]|\d{2,})px\b/);
});

test('every static active capability class is covered by the active CSS manifest', () => {
    const source = capabilitySource();
    const styles = activeStyles();
    const hookOnlyClasses = new Set([
        'ec-toggle-all',
        'external-capability',
        'fg-apply-section',
        'fg-import-remove',
        'fg-import-restore',
        'poc-catalog',
    ]);
    const classes = new Set();

    for (const match of source.matchAll(/class="([^"]+)"/g)) {
        for (const token of match[1].split(/\s+/)) {
            if (/^[a-z][a-z0-9_-]*$/i.test(token)) classes.add(token);
        }
    }

    const missing = [...classes]
        .filter((className) => !hookOnlyClasses.has(className))
        .filter((className) => !new RegExp(`\\.${className}(?![a-z0-9_-])`, 'i').test(styles))
        .sort();
    assert.deepEqual(missing, []);
});

test('muted text and placeholder tokens meet WCAG AA against every theme surface', () => {
    const foundation = read('src/styles/foundation.css');
    const sharedControls = read('src/styles/shared-controls.css');
    const themes = [
        ['dark', variablesFrom(foundation, ':root')],
        ['light', variablesFrom(foundation, ':root\\[data-theme="light"\\]')],
    ];
    const activePlaceholderElements = [...capabilitySource().matchAll(/<(?:input|textarea)\b[^>]*placeholder="[^"]*"[^>]*>/gs)];

    assert.match(foundation, /input::placeholder,\s*textarea::placeholder\s*\{[^}]*opacity:\s*1;/s);
    assert.match(sharedControls, /\.yaml-path-input::placeholder\s*\{[^}]*color:\s*var\(--text-3\);/s);
    assert.ok(activePlaceholderElements.length > 0);
    for (const [element] of activePlaceholderElements) {
        assert.match(element, /class="[^"]*\byaml-path-input\b[^"]*"/);
    }
    for (const [theme, variables] of themes) {
        for (const token of ['text-2', 'text-3']) {
            for (const surface of ['bg-0', 'bg-1', 'bg-2', 'bg-3']) {
                const ratio = contrastRatio(variables[token], variables[surface]);
                assert.ok(ratio >= 4.5, `${theme} --${token} on --${surface} is only ${ratio.toFixed(2)}:1`);
            }
        }
    }
});
