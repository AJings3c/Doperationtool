# Frontend Architecture

The frontend is a Vite-powered, framework-free ES module application embedded by Wails.

## Application Layers

- `src/main.js` is the bootstrap only. It mounts the shell, registers routes, and connects navigation lifecycle cleanup.
- `src/app/` owns the application shell, navigation bridge, and router.
- `src/core/` contains shared infrastructure such as progress events, feedback overlays, formatting, and route scopes.
- `src/features/capability/` owns the four active dddd workflows. Each route has its own module; shared review state and result renderers stay inside the feature boundary.
- `src/features/legacy/` preserves the previous YAML, Nuclei, and POC support tools. These tools are intentionally not registered in the current navigation and are excluded from the active bundle.
- `src/styles/` separates foundations, shell, shared controls, feedback, and active capability styles. `src/style.css` is the ordered active-bundle manifest.
- `src/styles/legacy.css` is the optional extension manifest for the preserved support tools. Load it after `src/style.css` only when those routes are registered.

## Route Contract

A route exposes a synchronous `mount(container)` function. It may return a disposer function or an object with `dispose()`.

Read-only and page-owned Wails calls are wrapped with a route scope:

```js
const scope = createRouteScope();
const result = await scope.guard(SomeWailsCall());
return () => scope.dispose();
```

This prevents a result from a page that has already been left from mutating detached DOM or publishing stale feedback.

Calls with filesystem side effects use `features/capability/writeState.js` instead. The write store receives and persists the backend result independently of the route lifetime; the route scope only gates DOM updates and page-local feedback:

```js
const result = await capabilityWriteStore.run(
    CAPABILITY_WRITE_KIND.EXTERNAL_APPLY,
    { projectRoot },
    () => ApplyExternalCapability(payload),
);
if (scope.active) renderResult(result);
```

Application-level progress is also independent of a route. `progressTracker.start()` returns a task handle; callers must end that handle in their own error path so an old route cannot hide a newer task.

## Interaction Motion

Motion serves state and direct manipulation rather than decoration. Timing and easing tokens live in `styles/foundation.css`; active UI uses short, non-bouncing ease-out transitions. Sidebar resizing follows Pointer Events with pointer capture and disables interpolation while the pointer is down. Route entry effects run only after a successful synchronous mount and never delay or lock navigation.

Every motion surface must provide a `prefers-reduced-motion` fallback. Material-like surfaces also retain solid-color fallbacks for reduced transparency and stronger borders for increased contrast.

## Interaction Motion

Motion communicates state without delaying work. Shared timing and easing tokens live in `styles/foundation.css`; active interactions use 100-220 ms ease-out transitions with no decorative bounce. Route entry remains synchronous, and its CSS animation starts only after a successful mount.

The sidebar resizer uses Pointer Events and pointer capture for direct 1:1 tracking. Transitions are disabled while it is being dragged, and the separator exposes equivalent keyboard controls. Any new motion must include a `prefers-reduced-motion` fallback; floating surfaces must also remain legible with reduced transparency and increased contrast preferences.

## Shared State

Persistent path history lives in `features/capability/state.js`. Review selection and YAML serialization are pure functions in `features/capability/reviewState.js`; keep them DOM-free so they remain directly testable with Node.

## Verification

Run these checks after frontend changes:

```bash
npm test
npm run build
```

The repository-level Go tests remain the contract for Wails backend behavior:

```bash
go test ./...
```
