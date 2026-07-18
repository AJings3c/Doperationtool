import { CancelCurrentTask } from '../../wailsjs/go/main/App.js';
import { EventsOff, EventsOn } from '../../wailsjs/runtime/runtime.js';

const phaseLabels = {
    scanning: '扫描中',
    analyzing: '分析中',
    deduping: '去重中',
    fixing: '修复中',
    previewing: '预览中',
    moving: '移动中',
    applying: '应用中',
    validating: '验证中',
    auditing: '审计中',
};

export function createProgressTracker({
    documentRef = typeof document === 'undefined' ? null : document,
    cancelCurrentTask = CancelCurrentTask,
    eventsOn = EventsOn,
    eventsOff = EventsOff,
} = {}) {
    const byId = (id) => documentRef?.getElementById(id) || null;
    let currentEvent = '';
    let cancelSubscription = null;
    let hideTimer = null;
    let elapsedTimer = null;
    let startedAt = 0;
    let cancelRequested = false;
    let taskSequence = 0;
    let currentTaskId = 0;

    function formatElapsed(milliseconds) {
        if (milliseconds < 1000) return `${Math.max(0, Math.floor(milliseconds / 100) * 100)}ms`;
        if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(1)}s`;
        const seconds = Math.floor(milliseconds / 1000);
        return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
    }

    function refreshElapsed() {
        const elapsed = byId('gp-elapsed');
        if (elapsed && startedAt) elapsed.textContent = formatElapsed(Date.now() - startedAt);
    }

    function show(title) {
        const card = byId('global-progress');
        if (!card) return;
        if (hideTimer) clearTimeout(hideTimer);
        if (elapsedTimer) clearInterval(elapsedTimer);
        hideTimer = null;
        elapsedTimer = null;
        startedAt = Date.now();
        cancelRequested = false;
        byId('gp-title').textContent = title || '处理中';
        byId('gp-phase').textContent = '';
        byId('gp-label').textContent = '';
        const fill = byId('gp-fill');
        fill.style.width = '0%';
        fill.classList.remove('indeterminate', 'done', 'cancelled');
        const cancel = byId('gp-cancel');
        cancel.disabled = false;
        cancel.textContent = '✕';
        card.hidden = false;
        refreshElapsed();
        elapsedTimer = setInterval(refreshElapsed, 100);
    }

    function update(progress) {
        if (!progress || typeof progress !== 'object') return;
        const fill = byId('gp-fill');
        if (!fill) return;
        if (progress.done) {
            byId('gp-elapsed').textContent = progress.elapsed || byId('gp-elapsed').textContent;
        } else {
            refreshElapsed();
        }
        byId('gp-phase').textContent = phaseLabels[progress.phase] || progress.phase || '';
        if (!cancelRequested) byId('gp-label').textContent = progress.label || '';

        if (progress.percent < 0 || progress.total === 0) {
            fill.classList.add('indeterminate');
            fill.style.width = '100%';
        } else {
            fill.classList.remove('indeterminate');
            const percent = Math.max(0, Math.min(100, progress.percent || 0));
            fill.style.width = `${percent.toFixed(1)}%`;
        }

        if (!progress.done) return;
        if (elapsedTimer) clearInterval(elapsedTimer);
        elapsedTimer = null;
        fill.classList.remove('indeterminate');
        fill.style.width = '100%';
        if (progress.cancelled) {
            fill.classList.add('cancelled');
            byId('gp-label').textContent = '已取消';
        } else {
            fill.classList.add('done');
        }
        byId('gp-cancel').disabled = true;
        if (hideTimer) clearTimeout(hideTimer);
        const completedTaskId = currentTaskId;
        hideTimer = setTimeout(() => endTask(completedTaskId), 800);
    }

    async function requestCancel() {
        if (!currentEvent || cancelRequested) return;
        cancelRequested = true;
        const cancel = byId('gp-cancel');
        if (cancel) {
            cancel.disabled = true;
            cancel.textContent = '…';
        }
        const label = byId('gp-label');
        if (label) label.textContent = '正在取消…';
        try { await cancelCurrentTask(); } catch (error) {
            console.warn('[progress] cancel failed:', error);
        }
    }

    function start(eventName, title) {
        if (currentEvent) endTask();
        const taskId = ++taskSequence;
        currentTaskId = taskId;
        currentEvent = eventName;
        show(title);
        const cancel = byId('gp-cancel');
        if (cancel) cancel.onclick = requestCancel;
        try {
            cancelSubscription = eventsOn(eventName, (progress) => {
                if (currentTaskId === taskId) update(progress);
            });
        } catch (error) {
            console.warn('[progress] EventsOn failed:', error);
            cancelSubscription = null;
        }
        return Object.freeze({
            end: () => endTask(taskId),
            get active() { return currentTaskId === taskId; },
        });
    }

    function endTask(expectedTaskId) {
        if (expectedTaskId !== undefined && expectedTaskId !== currentTaskId) return false;
        if (hideTimer) clearTimeout(hideTimer);
        if (elapsedTimer) clearInterval(elapsedTimer);
        hideTimer = null;
        elapsedTimer = null;
        startedAt = 0;
        if (cancelSubscription) {
            try { cancelSubscription(); } catch (error) { /* already detached */ }
            cancelSubscription = null;
        }
        if (currentEvent) {
            try { eventsOff(currentEvent); } catch (error) { /* browser preview */ }
            currentEvent = '';
        }
        cancelRequested = false;
        currentTaskId = 0;
        const cancel = byId('gp-cancel');
        if (cancel) cancel.onclick = null;
        const card = byId('global-progress');
        if (card) card.hidden = true;
        return true;
    }

    function dispose() {
        endTask();
    }

    return { start, stop: endTask, endTask, dispose, update };
}

export const progressTracker = createProgressTracker();
