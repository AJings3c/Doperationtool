function normalizeDisposer(result) {
    if (typeof result === 'function') return result;
    if (result && typeof result.dispose === 'function') return () => result.dispose();
    return null;
}

function detachContainerContent(container) {
    if (!container) return () => {};

    const documentRef = container.ownerDocument;
    if (documentRef && typeof documentRef.createDocumentFragment === 'function') {
        const fragment = documentRef.createDocumentFragment();
        while (container.firstChild) fragment.appendChild(container.firstChild);
        return () => {
            if (typeof container.replaceChildren === 'function') {
                container.replaceChildren(fragment);
                return;
            }
            container.innerHTML = '';
            container.appendChild(fragment);
        };
    }

    const previousMarkup = container.innerHTML;
    container.innerHTML = '';
    return () => { container.innerHTML = previousMarkup; };
}

function clearContainer(container) {
    if (!container) return;
    if (typeof container.replaceChildren === 'function') {
        container.replaceChildren();
        return;
    }
    container.innerHTML = '';
}

function replayRouteEntry(container) {
    const classList = container?.classList;
    if (!classList || typeof classList.remove !== 'function' || typeof classList.add !== 'function') return;

    classList.remove('route-entering');
    void container.offsetWidth;
    classList.add('route-entering');
}

export function createRouter({
    routes,
    container,
    breadcrumb,
    navItems = [],
    storage = globalThis.localStorage,
    storageKey = 'doperationtool.route',
    defaultRoute,
    onBeforeNavigate,
    onAfterNavigate,
}) {
    let currentRoute = '';
    let currentDisposer = null;

    function saveRoute(toolId) {
        try { storage?.setItem(storageKey, toolId); } catch (error) { /* storage is optional */ }
    }

    function loadRoute() {
        try { return storage?.getItem(storageKey) || ''; } catch (error) { return ''; }
    }

    function disposeCurrent() {
        if (!currentDisposer) return;
        try { currentDisposer(); } finally { currentDisposer = null; }
    }

    function navigate(toolId) {
        const route = routes[toolId];
        if (!route) return false;

        if (typeof onBeforeNavigate === 'function') {
            onBeforeNavigate({ from: currentRoute, to: toolId });
        }

        const mount = route.mount || route.render;
        const previousDisposer = currentDisposer;
        const restorePreviousContent = detachContainerContent(container);
        let nextDisposer = null;
        try {
            nextDisposer = normalizeDisposer(mount ? mount(container) : null);
        } catch (error) {
            clearContainer(container);
            restorePreviousContent();
            throw error;
        }

        currentDisposer = nextDisposer;
        currentRoute = toolId;
        if (previousDisposer) previousDisposer();

        saveRoute(toolId);
        for (const item of navItems) {
            item.classList.toggle('active', item.dataset.tool === toolId);
        }
        if (breadcrumb) breadcrumb.textContent = route.name;

        replayRouteEntry(container);

        if (typeof onAfterNavigate === 'function') {
            onAfterNavigate({ current: toolId });
        }
        return true;
    }

    function start() {
        const saved = loadRoute();
        return navigate(saved && routes[saved] ? saved : defaultRoute);
    }

    function dispose() {
        disposeCurrent();
        currentRoute = '';
    }

    return {
        navigate,
        start,
        dispose,
        get currentRoute() { return currentRoute; },
    };
}
