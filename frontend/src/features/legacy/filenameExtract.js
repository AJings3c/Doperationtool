import { toast } from '../../core/feedback.js';

// ============================================================
// 模块 1: 文件名提取
// ============================================================

// 跨页持久化的状态: 用户切到别的工具再切回来不会丢失之前的结果
const extractState = { input: '', output: '', count: 0 };

function renderFilenameExtract(container) {
    container.innerHTML = `
    <div class="extractor">
        <div class="extractor-tip">
            💡 在 Finder 中选中多个文件 <kbd>⌘ C</kbd> &nbsp;→&nbsp; 点击下方左侧区域 &nbsp;→&nbsp; <kbd>⌘ V</kbd>
            即可批量提取文件名 (一行一个, 保留原顺序). 也支持直接将文件拖入左侧区域.
        </div>
        <div class="extractor-grid">
            <div class="panel">
                <div class="panel-header">
                    <span>📥 粘贴 / 拖入文件</span>
                    <div class="panel-actions">
                        <button class="btn btn-danger" id="btn-clear-input">清空</button>
                    </div>
                </div>
                <div class="dropzone" id="dropzone">
                    <textarea id="input-area" spellcheck="false"
                        autocomplete="off" autocorrect="off" autocapitalize="off"></textarea>
                    <div class="dropzone-placeholder" id="placeholder">
                        <div class="dropzone-icon">📁</div>
                        <div>粘贴 (⌘V) 或 拖入文件到此处</div>
                        <div class="dropzone-hint">支持 Finder 选中多个文件后直接粘贴 · 也支持纯路径文本</div>
                    </div>
                </div>
                <div class="panel-footer">
                    <span id="input-stat">就绪</span>
                    <span style="opacity:.7">输入区</span>
                </div>
            </div>
            <div class="panel">
                <div class="panel-header">
                    <span>📤 提取的文件名</span>
                    <div class="panel-actions">
                        <button class="btn" id="btn-copy">复制</button>
                        <button class="btn btn-danger" id="btn-clear-output">清空</button>
                    </div>
                </div>
                <textarea class="output-area" id="output-area" spellcheck="false"
                    autocomplete="off" autocorrect="off" autocapitalize="off"
                    placeholder="提取结果将显示在这里, 一行一个, 保留原顺序"></textarea>
                <div class="panel-footer">
                    <span id="output-stat">0 个文件名</span>
                    <span style="opacity:.7">输出区</span>
                </div>
            </div>
        </div>
    </div>`;
    setupFilenameExtract();
}

function setupFilenameExtract() {
    const dropzone    = document.getElementById('dropzone');
    const inputArea   = document.getElementById('input-area');
    const outputArea  = document.getElementById('output-area');
    const placeholder = document.getElementById('placeholder');
    const inputStat   = document.getElementById('input-stat');
    const outputStat  = document.getElementById('output-stat');

    // 还原跨页状态
    inputArea.value = extractState.input;
    outputArea.value = extractState.output;
    placeholder.classList.toggle('hidden', !!extractState.input);
    inputStat.textContent = extractState.count > 0 ? `已识别 ${extractState.count} 个项目` : '就绪';
    outputStat.textContent = `${extractState.count} 个文件名`;

    /** 任意路径 / URI / 文件名 → basename */
    function basename(p) {
        if (!p) return '';
        p = String(p).trim();
        if (!p) return '';
        if (p.startsWith('file://')) {
            p = p.replace(/^file:\/\//, '');
            try { p = decodeURIComponent(p); } catch (e) { /* ignore */ }
        }
        p = p.replace(/[?#].*$/, '').replace(/[\/\\]+$/, '');
        if (!p) return '';
        const parts = p.split(/[\/\\]/);
        return parts[parts.length - 1].trim();
    }

    /** 从 ClipboardEvent / DragEvent 中提取文件名列表 */
    function extractFromTransfer(e, kind) {
        const dt = kind === 'paste' ? e.clipboardData : e.dataTransfer;
        if (!dt) return [];
        const names = [];
        if (dt.files && dt.files.length > 0) {
            for (const f of dt.files) if (f && f.name) names.push(f.name);
        }
        if (names.length === 0 && dt.items) {
            for (const item of dt.items) {
                if (item && item.kind === 'file') {
                    const f = item.getAsFile();
                    if (f && f.name) names.push(f.name);
                }
            }
        }
        if (names.length === 0) {
            const text = (dt.getData && dt.getData('text/plain')) || '';
            if (text) {
                for (const line of text.split(/[\r\n\t]+/)) {
                    const b = basename(line);
                    if (b) names.push(b);
                }
            }
        }
        return names;
    }

    function commit(names) {
        const pad = String(Math.max(names.length, 1)).length;
        const echo = names.map((n, i) => `[${String(i + 1).padStart(pad, ' ')}] ${n}`).join('\n');
        const out = names.join('\n');
        inputArea.value = echo;
        outputArea.value = out;
        placeholder.classList.toggle('hidden', names.length > 0);
        inputStat.textContent = names.length > 0 ? `已识别 ${names.length} 个项目` : '就绪';
        outputStat.textContent = `${names.length} 个文件名`;
        extractState.input = echo;
        extractState.output = out;
        extractState.count = names.length;
    }

    inputArea.addEventListener('paste', (e) => {
        e.preventDefault();
        const names = extractFromTransfer(e, 'paste');
        if (names.length > 0) {
            commit(names);
            toast(`已提取 ${names.length} 个文件名`);
        } else {
            toast('剪贴板未识别到文件或路径', 'error');
        }
    });
    inputArea.addEventListener('input', () => {
        placeholder.classList.toggle('hidden', !!inputArea.value);
        extractState.input = inputArea.value;
    });
    outputArea.addEventListener('input', () => {
        extractState.output = outputArea.value;
    });

    dropzone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', (e) => {
        if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('drag-over');
    });
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        const names = extractFromTransfer(e, 'drop');
        if (names.length > 0) {
            commit(names);
            toast(`已提取 ${names.length} 个文件名`);
        } else {
            toast('未识别到文件', 'error');
        }
    });

    document.getElementById('btn-clear-input').addEventListener('click', () => {
        commit([]);
        inputArea.focus();
    });
    document.getElementById('btn-clear-output').addEventListener('click', () => {
        outputArea.value = '';
        outputStat.textContent = '0 个文件名';
        extractState.output = '';
    });
    document.getElementById('btn-copy').addEventListener('click', async () => {
        const text = outputArea.value;
        if (!text) { toast('结果为空', 'error'); return; }
        try {
            await navigator.clipboard.writeText(text);
            const count = text.split('\n').filter(Boolean).length;
            toast(`已复制 ${count} 个文件名到剪贴板`);
        } catch (err) {
            outputArea.select();
            document.execCommand('copy');
            toast('已复制 (退化模式)');
        }
    });
}

export { renderFilenameExtract };
