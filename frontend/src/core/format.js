export function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
    ));
}

export function formatBytes(value) {
    if (!value && value !== 0) return '?';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function joinPath(base, child) {
    if (!base) return child;
    if (base.endsWith('/')) return base + child;
    return `${base}/${child}`;
}

export function isTaskCancelledError(error) {
    if (error?.code === 'ROUTE_DISPOSED') return true;
    const message = String(error || '').toLowerCase();
    return message.includes('已取消')
        || message.includes('context canceled')
        || message.includes('cancelled')
        || message.includes('canceled');
}
