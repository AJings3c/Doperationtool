import { OpenWithDefaultApp, RevealInFileManager } from '../../wailsjs/go/main/App.js';
import { escapeHtml } from './format.js';

let toastTimer = null;
let activeContextMenu = null;
let contextCleanup = null;
let contextBindTimer = null;

export function toast(message, type = 'success') {
    const element = document.getElementById('toast');
    if (!element) return;
    element.textContent = message;
    element.className = `toast ${type} show`;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 1900);
}

export function closeContextMenu() {
    if (contextBindTimer) clearTimeout(contextBindTimer);
    contextBindTimer = null;
    if (contextCleanup) contextCleanup();
    contextCleanup = null;
    if (activeContextMenu) activeContextMenu.remove();
    activeContextMenu = null;
}

export function showContextMenu(x, y, items) {
    closeContextMenu();
    if (!items?.length) return;

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = '-9999px';
    menu.style.top = '-9999px';
    menu.innerHTML = items.map((item, index) => {
        if (item.separator) return '<div class="context-menu-sep"></div>';
        const className = item.danger ? 'context-menu-item danger' : 'context-menu-item';
        return `<div class="${className}" data-i="${index}">${escapeHtml(item.label)}</div>`;
    }).join('');
    document.body.appendChild(menu);
    activeContextMenu = menu;

    const rect = menu.getBoundingClientRect();
    menu.style.left = `${x + rect.width > window.innerWidth ? Math.max(4, window.innerWidth - rect.width - 4) : x}px`;
    menu.style.top = `${y + rect.height > window.innerHeight ? Math.max(4, window.innerHeight - rect.height - 4) : y}px`;

    menu.querySelectorAll('.context-menu-item').forEach((element) => {
        element.addEventListener('click', (event) => {
            event.stopPropagation();
            const item = items[Number(element.dataset.i)];
            closeContextMenu();
            if (typeof item?.onClick === 'function') item.onClick();
        });
    });

    const closer = (event) => {
        if (event.type === 'keydown' && event.key !== 'Escape') return;
        closeContextMenu();
    };
    contextCleanup = () => {
        document.removeEventListener('mousedown', closer, true);
        document.removeEventListener('keydown', closer, true);
        window.removeEventListener('blur', closer);
        window.removeEventListener('resize', closer);
    };
    contextBindTimer = setTimeout(() => {
        contextBindTimer = null;
        document.addEventListener('mousedown', closer, true);
        document.addEventListener('keydown', closer, true);
        window.addEventListener('blur', closer);
        window.addEventListener('resize', closer);
    }, 0);
}

export async function revealOnDisk(path) {
    try { await RevealInFileManager(path); } catch (error) { toast(`打开失败: ${error}`, 'error'); }
}

export async function openWithDefault(path) {
    try { await OpenWithDefaultApp(path); } catch (error) { toast(`打开失败: ${error}`, 'error'); }
}

export async function copyToClipboard(text, label) {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        }
        toast(`已复制${label}`, 'info');
    } catch (error) {
        toast(`复制失败: ${error}`, 'error');
    }
}
