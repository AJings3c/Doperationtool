import './style.css';

import { createRouter } from './app/router.js';
import { setNavigator } from './app/navigation.js';
import { mountAppShell } from './app/shell.js';
import { closeContextMenu } from './core/feedback.js';
import { progressTracker } from './core/progress.js';
import {
    renderDDDDFingerprintConverter,
    renderExternalCapability,
    renderFingerprintGovernance,
    renderPocCatalog,
} from './features/capability/index.js';

const routes = {
    'fingerprint-governance': {
        module: 'dddd 运维',
        name: 'dddd 能力对比',
        mount: renderFingerprintGovernance,
    },
    'poc-catalog': {
        module: 'dddd 运维',
        name: '外部 POC 归类',
        mount: renderPocCatalog,
    },
    'dddd-fingerprint-converter': {
        module: 'dddd 运维',
        name: '外部指纹导入',
        mount: renderDDDDFingerprintConverter,
    },
    'external-capability': {
        module: 'dddd 运维',
        name: '能力接入',
        mount: renderExternalCapability,
    },
};

const shell = mountAppShell();
const router = createRouter({
    routes,
    container: document.getElementById('main-content'),
    breadcrumb: document.getElementById('bc-current'),
    navItems: document.querySelectorAll('.module-item[data-tool]'),
    defaultRoute: 'fingerprint-governance',
    onBeforeNavigate() {
        closeContextMenu();
    },
});

setNavigator(router.navigate);
router.start();

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        router.dispose();
        shell.dispose();
        closeContextMenu();
        progressTracker.dispose();
        setNavigator(null);
    });
}
