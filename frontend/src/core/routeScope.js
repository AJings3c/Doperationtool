export class RouteDisposedError extends Error {
    constructor() {
        super('route disposed');
        this.name = 'RouteDisposedError';
        this.code = 'ROUTE_DISPOSED';
    }
}

export function createRouteScope() {
    let active = true;

    return {
        get active() { return active; },
        async guard(promise) {
            try {
                const value = await promise;
                if (!active) throw new RouteDisposedError();
                return value;
            } catch (error) {
                if (!active && error?.code !== 'ROUTE_DISPOSED') throw new RouteDisposedError();
                throw error;
            }
        },
        dispose() {
            active = false;
        },
    };
}
