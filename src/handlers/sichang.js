// 思畅 AI 的「朗读」请求 POST /api/tts，拿回 24kHz 单声道 PCM16 流由页面边下边播。
// 这里直接接管这个请求：官方不会再整段合成，而是按句子分批请求、边下边播；
// 每段的 PCM 同时拼成一条 WAV 放进右下角面板，供试听和下载。
// 分段是为了长文本更稳：整段失败就什么都没了，分段后单段失败还能重试或再拆开。
const TTS_PATH = '/api/tts';
const PANEL_ID = 'sichang-tts-capture';
const DEFAULT_SAMPLE_RATE = 24000;
const MAX_RECORDS = 20;
// 单段上限：太短会切碎语气，太长又容易让合成失败，取 160 字
const MAX_SEGMENT_CHARS = 160;
const MAX_ATTEMPTS = 2;
// 单条最长约 22 分钟；超出后不再累积，避免长对话把内存吃满
const MAX_PCM_BYTES = 64 * 1024 * 1024;
// 脚本自己发的分段请求带这个头，用来和官方请求区分，避免无限接管
const SEGMENT_HEADER = 'X-Sichang-Segment';
// 首段先攒这么多秒再起播：开头几个网络块常比实时慢，直接播会在第一句里留小段补白
const MIN_START_SECONDS = 0.5;
// 站点自带的音色列表（与官方朗读使用同一接口参数），id 直接作为 voice 传给接口
const VOICE_GROUPS = [
    {
        label: '中文',
        voices: [
            { id: 'mimo_default', label: '默认' },
            { id: '冰糖', label: '冰糖（女声）' },
            { id: '茉莉', label: '茉莉（女声）' },
            { id: '苏打', label: '苏打（男声）' },
            { id: '白桦', label: '白桦（男声）' },
        ],
    },
    {
        label: 'English',
        voices: [
            { id: 'Mia', label: 'Mia（女声）' },
            { id: 'Chloe', label: 'Chloe（女声）' },
            { id: 'Milo', label: 'Milo（男声）' },
            { id: 'Dean', label: 'Dean（男声）' },
        ],
    },
];
const DEFAULT_VOICE = 'mimo_default';
const VOICE_LABELS = new Map(VOICE_GROUPS.flatMap(group => group.voices.map(voice => [voice.id, voice.label])));
// 输入框预填的试听文本：短到一次合成就能听完，方便换音色反复试
const DEFAULT_INPUT_TEXT = '你好，我是思畅，今天天气不错。';
const VOICE_STORE_KEY = 'sichang-tts-voice';
const RATE_STORE_KEY = 'sichang-tts-rate';
const FOLD_STORE_KEY = 'sichang-tts-folded';
const PLAY_RATE_STORE_KEY = 'sichang-tts-play-rate';
const DRAFT_STORE_KEY = 'sichang-tts-draft';
const POS_STORE_KEY = 'sichang-tts-pos';
// 播放倍速（不是合成语速）：只作用于面板 WAV 试听，实时时间线固定 1×
const PLAY_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const PANEL_CSS = `
:host { all: initial; }
.panel {
    width: 300px;
    background: #16161a;
    color: #e8e8ea;
    border: 1px solid #2c2c33;
    border-radius: 12px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, .45);
    font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
    overflow: hidden;
}
.head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 8px 7px 10px;
    background: #1d1d22;
    border-bottom: 1px solid #2c2c33;
    cursor: move;
    user-select: none;
    touch-action: none;
}
.panel.dragging { opacity: .92; }
.title { font-size: 12px; font-weight: 600; }
.grip { color: #5a5a64; font-size: 11px; letter-spacing: -1px; }
.count {
    min-width: 18px;
    padding: 0 5px;
    height: 16px;
    line-height: 16px;
    text-align: center;
    border-radius: 8px;
    background: #3a3a44;
    color: #c9c9d1;
    font-size: 10px;
}
.spacer { flex: 1; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
button:disabled { opacity: .4; cursor: default; pointer-events: none; }
.head button {
    height: 20px;
    padding: 0 6px;
    border-radius: 6px;
    color: #a9a9b3;
    font-size: 11px;
}
.head button:hover { background: #2c2c33; color: #fff; }
.head select {
    height: 20px;
    padding: 0 3px;
    border: 0;
    border-radius: 6px;
    background: #2a2a32;
    color: #a9a9b3;
    font: 10px system-ui, -apple-system, 'Segoe UI', sans-serif;
    cursor: pointer;
}
.compose { display: flex; flex-direction: column; gap: 6px; padding: 9px 10px; border-bottom: 1px solid #232329; }
.compose textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 44px;
    max-height: 132px;
    padding: 7px 8px;
    border: 1px solid #2c2c33;
    border-radius: 7px;
    background: #101014;
    color: #e8e8ea;
    font: 12px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
    resize: none;
}
.compose .counter {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    color: #6f6f79;
    font-size: 10px;
}
.compose .counter .clearInput { color: #8a8a94; font-size: 10px; padding: 0 2px; }
.compose .counter .clearInput:hover { color: #d5d5dd; }
.compose textarea:focus, .compose select:focus, .compose input:focus { outline: 1px solid #4a4a56; border-color: #4a4a56; }
.compose textarea::placeholder { color: #6f6f79; }
.compose .row { display: flex; align-items: center; gap: 6px; }
.compose select, .compose input {
    height: 26px;
    padding: 0 6px;
    border: 1px solid #2c2c33;
    border-radius: 6px;
    background: #1d1d22;
    color: #d5d5dd;
    font: 12px system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.compose select { flex: 1; min-width: 0; }
.compose input.rate { width: 48px; padding: 0 4px; text-align: center; }
.compose .rateUnit { color: #80808a; font-size: 11px; margin-left: -3px; }
.compose .go {
    height: 26px;
    padding: 0 14px;
    border-radius: 6px;
    background: #2d4a33;
    color: #a9e6b8;
    font-size: 12px;
}
.compose .go:hover { background: #3a5f43; color: #fff; }
.panel.folded { width: auto; }
.panel.folded .compose, .panel.folded .body { display: none; }
.panel.folded .head { border-bottom: 0; }
.body { max-height: 340px; overflow: auto; }
.empty { padding: 16px 14px; color: #8a8a94; font-size: 12px; text-align: center; }
.item { display: flex; gap: 9px; padding: 9px 10px 9px 12px; border-bottom: 1px solid #232329; }
.item:last-child { border-bottom: 0; }
.meta { width: 38px; flex: none; padding-top: 1px; color: #80808a; font-size: 11px; }
.meta .dur { display: block; color: #b9b9c2; }
.item[data-live] .dur { color: #d8b46a; animation: tts-pulse 1.2s ease-in-out infinite; }
@keyframes tts-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.mid { flex: 1; min-width: 0; }
.txt {
    margin-bottom: 6px;
    color: #c9c9d1;
    font-size: 12px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    cursor: zoom-in;
}
.txt.expanded { display: block; overflow: visible; white-space: pre-wrap; cursor: zoom-out; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.tag {
    padding: 0 5px;
    height: 15px;
    line-height: 15px;
    border-radius: 4px;
    background: #24242b;
    color: #8a8a94;
    font-size: 10px;
}
.acts { display: flex; flex-wrap: wrap; gap: 5px; }
.acts button {
    height: 24px;
    padding: 0 8px;
    border-radius: 6px;
    background: #2a2a32;
    color: #d5d5dd;
    font-size: 12px;
}
.acts button:hover { background: #35353f; color: #fff; }
.acts .del { padding: 0 6px; color: #8a8a94; }
.acts .del:hover { background: #3a2226; color: #ff9a9a; }
.acts .playing { background: #2d4a33; color: #a9e6b8; }
.bar {
    display: none;
    height: 3px;
    margin-top: 7px;
    border-radius: 2px;
    background: #2a2a32;
    overflow: hidden;
    cursor: pointer;
}
.bar.show { display: block; }
.bar .fill { height: 100%; width: 0; background: #5a9e6b; transition: width .15s linear; }
.item[data-live] .bar .fill { width: 35%; background: #d8b46a; animation: tts-slide 1.1s ease-in-out infinite; }
.item[data-live] .bar.determinate .fill { animation: none; }
@keyframes tts-slide { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
.segs { margin-top: 5px; }
.segs summary {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #8a8a94;
    font-size: 11px;
    cursor: pointer;
    list-style: none;
    user-select: none;
}
.segs summary::-webkit-details-marker { display: none; }
.segs summary::before { content: '▸'; font-size: 9px; transition: transform .15s; }
.segs[open] summary::before { transform: rotate(90deg); }
.segs .segCount { color: #b9b9c2; }
.segBox { border-top: 1px solid #1f1f25; padding: 2px 0; }
.segBox:first-child { border-top: 0; }
.seg {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
}
.seg .idx { width: 16px; flex: none; text-align: right; color: #6f6f79; }
.seg .segText {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: #a9a9b3;
}
.seg .segDur { flex: none; color: #80808a; }
.seg button {
    flex: none;
    height: 18px;
    padding: 0 5px;
    border-radius: 5px;
    background: #2a2a32;
    color: #c9c9d1;
    font-size: 10px;
}
.seg button:hover { background: #35353f; color: #fff; }
.seg .segPlay { width: 20px; padding: 0; font-size: 9px; }
.seg .segPlay.playing { background: #2d4a33; color: #a9e6b8; }
.segBar {
    display: none;
    height: 2px;
    margin: 2px 0 3px 20px;
    border-radius: 1px;
    background: #2a2a32;
    overflow: hidden;
    cursor: pointer;
}
.segBar.show { display: block; }
.segBar .fill { height: 100%; width: 0; background: #5a9e6b; transition: width .1s linear; }
@media (max-width: 480px) {
    .panel { width: calc(100vw - 24px); }
}
button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible {
    outline: 2px solid #5a9e6b;
    outline-offset: 1px;
}
`;

function createPanel() {
    const host = document.createElement('div');
    host.id = PANEL_ID;
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    // 构造式样式表不受页面 style-src 限制，站点收紧 CSP 时面板样式也不会失效
    if ('adoptedStyleSheets' in root) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(PANEL_CSS);
        root.adoptedStyleSheets = [sheet];
    } else {
        const style = document.createElement('style');
        style.textContent = PANEL_CSS;
        root.appendChild(style);
    }
    const panel = document.createElement('div');
    panel.className = 'panel';
    const groups = VOICE_GROUPS.map(group => `
        <optgroup label="${group.label}">
            ${group.voices.map(voice => `<option value="${voice.id}">${voice.label}</option>`).join('')}
        </optgroup>
    `).join('');
    const speeds = PLAY_RATES.map(rate => `<option value="${rate}">${rate}×</option>`).join('');
    panel.innerHTML = `
        <div class="head" title="拖动移动，双击复位">
            <span class="grip" aria-hidden="true">⠿</span>
            <span class="title">语音捕获</span>
            <span class="count">0</span>
            <span class="spacer"></span>
            <select class="speed" aria-label="播放倍速" title="播放倍速（仅面板试听，保持音高）">${speeds}</select>
            <button class="clear" hidden aria-label="清空全部记录">清空</button>
            <button class="fold" aria-label="收起">−</button>
        </div>
        <div class="compose">
            <textarea class="input" rows="2" placeholder="输入或粘贴文本，Ctrl+Enter 合成"></textarea>
            <div class="counter">
                <span class="stats">0 字 · 0 段</span>
                <button class="clearInput" aria-label="清空输入">清空</button>
            </div>
            <div class="row">
                <select class="voice" aria-label="音色">${groups}</select>
                <input class="rate" type="number" min="0.5" max="2" step="0.1" value="1" aria-label="语速" title="语速">
                <span class="rateUnit" aria-hidden="true">×</span>
                <button class="go">合成</button>
            </div>
        </div>
        <div class="body">
            <div class="empty">点消息下的「朗读」，或在上方输入文本合成</div>
            <div class="list"></div>
        </div>
    `;
    root.appendChild(panel);
    document.documentElement.appendChild(host);
    return {
        host,
        panel,
        head: panel.querySelector('.head'),
        list: panel.querySelector('.list'),
        empty: panel.querySelector('.empty'),
        count: panel.querySelector('.count'),
        clear: panel.querySelector('.clear'),
        fold: panel.querySelector('.fold'),
        speed: panel.querySelector('.speed'),
        compose: panel.querySelector('.compose'),
        input: panel.querySelector('.input'),
        stats: panel.querySelector('.stats'),
        clearInput: panel.querySelector('.clearInput'),
        voice: panel.querySelector('.voice'),
        rate: panel.querySelector('.rate'),
        go: panel.querySelector('.go'),
    };
}

function pcmToWav(pcm, sampleRate) {
    const dataLength = pcm.byteLength;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    const write = (offset, text) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    write(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, dataLength, true);
    new Uint8Array(buffer, 44).set(pcm);
    return new Blob([buffer], { type: 'audio/wav' });
}

function formatDuration(seconds) {
    const total = Math.max(0, Math.round(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatRate(rate) {
    const value = Number(rate);
    if (!Number.isFinite(value) || value <= 0) return '1×';
    return `${Math.round(value * 10) / 10}×`;
}

// 剪贴板 API 在非安全上下文或权限被拒时不可用，退回临时 textarea
function copyRecordText(text, button) {
    const done = () => {
        button.textContent = '已复制';
        clearTimeout(button.copyTimer);
        button.copyTimer = setTimeout(() => {
            button.textContent = '复制';
        }, 1200);
    };
    const fallback = () => {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
        document.body.appendChild(area);
        area.select();
        let copied = false;
        try {
            copied = document.execCommand('copy');
        } catch {}
        area.remove();
        if (copied) done();
    };
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
    } else {
        fallback();
    }
}

function previewText(text) {
    return text.replace(/\[[^\]]{1,10}\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function joinedPcm(chunks, length) {
    const pcm = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        if (offset >= length) break;
        const part = chunk.subarray(0, Math.min(chunk.length, length - offset));
        pcm.set(part, offset);
        offset += part.length;
    }
    return pcm;
}

// 先按句末标点和换行切开，再把短句攒到接近上限，避免一句话被硬生生截断
function splitText(text) {
    const normalized = String(text || '').replace(/\r/g, '').trim();
    if (!normalized) return [];
    const parts = normalized.split(/(?<=[。！？!?；;…\n])/).filter(part => part.trim());
    const chunks = [];
    let current = '';
    const flush = () => {
        if (current.trim()) chunks.push(current.trim());
        current = '';
    };
    for (let part of parts) {
        while (part.length > MAX_SEGMENT_CHARS) {
            flush();
            chunks.push(part.slice(0, MAX_SEGMENT_CHARS));
            part = part.slice(MAX_SEGMENT_CHARS);
        }
        if (current.length + part.length > MAX_SEGMENT_CHARS) flush();
        current += part;
    }
    flush();
    return chunks;
}

function splitInHalf(text) {
    if (text.length < 40) return null;
    const middle = Math.floor(text.length / 2);
    // 尽量在标点处断开，找不到就硬切
    const before = text.lastIndexOf('，', middle);
    const cut = before > text.length * 0.3 ? before + 1 : middle;
    return [text.slice(0, cut), text.slice(cut)];
}

export default function initSichangHandler() {
    if (window.location.hostname !== 'sichang.xyz') return;

    const ui = createPanel();

    function applyFold(folded) {
        ui.panel.classList.toggle('folded', folded);
        ui.fold.textContent = folded ? '+' : '−';
        ui.fold.setAttribute('aria-label', folded ? '展开' : '收起');
        try {
            localStorage.setItem(FOLD_STORE_KEY, folded ? '1' : '0');
        } catch {}
        if (!folded) autoGrowInput();
    }
    ui.fold.addEventListener('click', () => applyFold(!ui.panel.classList.contains('folded')));
    try {
        if (localStorage.getItem(FOLD_STORE_KEY) === '1') applyFold(true);
    } catch {}

    // 手动拖过的位置优先于自动避让；双击标题复位后恢复自动贴底
    let manualPosition = false;
    function clampPosition(left, top) {
        const rect = ui.host.getBoundingClientRect();
        return {
            left: Math.max(4, Math.min(window.innerWidth - rect.width - 4, left)),
            top: Math.max(4, Math.min(window.innerHeight - rect.height - 4, top)),
        };
    }
    function applyPosition(position) {
        ui.host.style.left = `${Math.round(position.left)}px`;
        ui.host.style.top = `${Math.round(position.top)}px`;
        ui.host.style.right = 'auto';
        ui.host.style.bottom = 'auto';
    }
    function resetPosition() {
        manualPosition = false;
        try {
            localStorage.removeItem(POS_STORE_KEY);
        } catch {}
        ui.host.style.left = '';
        ui.host.style.top = '';
        ui.host.style.right = '16px';
        ui.host.style.bottom = '16px';
        placePanel();
    }

    // 站点把输入框钉在底部，300 宽的面板会正好盖住发送按钮；
    // 检测到贴底输入框时把面板抬到它上方，没有输入框的页面维持 16px
    function placePanel() {
        if (manualPosition) return;
        const box = [...document.querySelectorAll('textarea, [contenteditable="true"]')].find(element => {
            const rect = element.getBoundingClientRect();
            return rect.width > 160 && rect.bottom > window.innerHeight - 160;
        });
        const bottom = box ? Math.max(16, window.innerHeight - box.getBoundingClientRect().top + 12) : 16;
        ui.host.style.bottom = `${Math.round(bottom)}px`;
    }

    try {
        const saved = JSON.parse(localStorage.getItem(POS_STORE_KEY) || 'null');
        if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
            applyPosition(clampPosition(saved.left, saved.top));
            manualPosition = true;
        }
    } catch {}
    placePanel();

    // 拖动标题栏移动面板，双击复位；按钮和下拉不参与，避免误触
    let drag = null;
    ui.head.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target.closest('button, select')) return;
        const rect = ui.host.getBoundingClientRect();
        drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
        ui.head.setPointerCapture(event.pointerId);
        ui.panel.classList.add('dragging');
    });
    ui.head.addEventListener('pointermove', event => {
        if (!drag) return;
        applyPosition(clampPosition(event.clientX - drag.dx, event.clientY - drag.dy));
    });
    function endDrag() {
        if (!drag) return;
        drag = null;
        ui.panel.classList.remove('dragging');
        manualPosition = true;
        const rect = ui.host.getBoundingClientRect();
        try {
            localStorage.setItem(POS_STORE_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
        } catch {}
    }
    ui.head.addEventListener('pointerup', endDrag);
    ui.head.addEventListener('pointercancel', endDrag);
    ui.head.addEventListener('dblclick', event => {
        if (event.target.closest('button, select')) return;
        resetPosition();
    });

    const onResize = () => {
        if (!manualPosition) {
            placePanel();
            return;
        }
        const rect = ui.host.getBoundingClientRect();
        applyPosition(clampPosition(rect.left, rect.top));
    };
    window.addEventListener('resize', onResize);
    const records = [];
    let activeAudio = null;
    let activeSession = null;
    let activeTimeline = null;
    let audioContext = null;
    let playRate = 1;
    try {
        const savedPlayRate = Number(localStorage.getItem(PLAY_RATE_STORE_KEY));
        if (PLAY_RATES.includes(savedPlayRate)) playRate = savedPlayRate;
    } catch {}
    ui.speed.value = String(playRate);
    ui.speed.addEventListener('change', () => {
        const value = Number(ui.speed.value);
        if (!PLAY_RATES.includes(value)) return;
        playRate = value;
        try {
            localStorage.setItem(PLAY_RATE_STORE_KEY, String(value));
        } catch {}
        // 正在试听的 WAV/分段立即换速
        for (const record of records) {
            if (record.audio) record.audio.playbackRate = value;
            for (const segment of record.segments) {
                if (segment.audio) segment.audio.playbackRate = value;
            }
        }
    });

    function ensureAudioContext() {
        if (!audioContext || audioContext.state === 'closed') {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
        return audioContext;
    }

    function updateCount() {
        ui.count.textContent = String(records.length);
        ui.clear.hidden = records.length === 0;
        ui.empty.style.display = records.length ? 'none' : '';
    }

    function stopActive() {
        if (activeAudio && !activeAudio.paused) activeAudio.pause();
    }

    // 合成结束时整条音频已经排进 Web Audio 的时间线，可能还要播很久；
    // 这段时间必须留着「停止」，否则用户既停不下来，点「播放」还会和它叠音
    function stopTimeline(record) {
        if (!record || record.state !== 'playing') return;
        clearTimeout(record.timelineTimer);
        clearInterval(record.timelineTicker);
        record.timelineTimer = null;
        record.timelineTicker = null;
        record.session?.abort();
        if (activeSession && activeSession.record === record) activeSession = null;
        record.session = null;
        if (activeTimeline === record) activeTimeline = null;
        record.state = 'ready';
        record.playButton.textContent = '播放';
        record.playButton.classList.remove('playing');
        record.bar.classList.remove('show');
        record.fill.style.width = '0%';
        record.duration.textContent = formatDuration(record.seconds);
        setSegmentsEnabled(record, true);
    }

    function startTimelineTicker(record, session) {
        const total = session.playhead - session.timelineStart;
        const tick = () => {
            if (record.state !== 'playing') return;
            const elapsed = session.context.currentTime - session.timelineStart;
            const ratio = Math.min(1, Math.max(0, elapsed / total));
            record.fill.style.width = `${ratio * 100}%`;
        };
        tick();
        record.timelineTicker = setInterval(tick, 250);
        record.timelineTimer = setTimeout(
            () => stopTimeline(record),
            Math.max(0, session.playhead - session.context.currentTime) * 1000 + 80,
        );
    }

    // 单条播放结束或被打断时，把按钮文字和状态一起改回来；捕获中的行不参与
    function syncPlayState() {
        for (const record of records) {
            if (record.state !== 'ready' || !record.playButton) continue;
            const playing = Boolean(record.audio && !record.audio.paused);
            record.playButton.textContent = playing ? '暂停' : '播放';
            record.playButton.classList.toggle('playing', playing);
        }
    }

    function removeRecord(record) {
        const index = records.indexOf(record);
        if (index >= 0) records.splice(index, 1);
        if (record.audio === activeAudio) activeAudio = null;
        if (activeTimeline === record) activeTimeline = null;
        clearTimeout(record.timelineTimer);
        clearInterval(record.timelineTicker);
        record.audio?.pause();
        record.session?.abort();
        for (const segment of record.segments) {
            if (segment.audio) {
                if (segment.audio === activeAudio) activeAudio = null;
                segment.audio.pause();
                segment.audio = null;
            }
            if (segment.url) URL.revokeObjectURL(segment.url);
        }
        if (activeSession?.record === record) activeSession = null;
        if (record.url) URL.revokeObjectURL(record.url);
        record.row.remove();
        updateCount();
    }

    // 请求一返回就先占一行；segments 保存每段文本和 PCM，供子条目展示与重生成
    function beginRecord(text, tts) {
        const record = {
            text,
            tts,
            time: Date.now(),
            state: 'capturing',
            segments: [],
            bytes: 0,
            seconds: 0,
            url: null,
            audio: null,
            sampleRate: DEFAULT_SAMPLE_RATE,
        };

        const row = document.createElement('div');
        row.className = 'item';
        row.setAttribute('data-live', '');
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = new Date(record.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const duration = document.createElement('span');
        duration.className = 'dur';
        duration.textContent = '捕获中';
        meta.appendChild(duration);

        const mid = document.createElement('div');
        mid.className = 'mid';
        const txt = document.createElement('div');
        txt.className = 'txt';
        const preview = previewText(text) || '（无文本）';
        txt.textContent = preview;
        txt.title = '点击展开或收起全文';
        // 记下这条用的音色和语速，重合成时也照着它提示，避免对不上
        const tags = document.createElement('div');
        tags.className = 'tags';
        const voiceTag = document.createElement('span');
        voiceTag.className = 'tag';
        voiceTag.textContent = VOICE_LABELS.get(tts.voice) || tts.voice || '默认';
        const rateTag = document.createElement('span');
        rateTag.className = 'tag';
        rateTag.textContent = `${formatRate(tts.rate)} 语速`;
        tags.append(voiceTag, rateTag);

        const bar = document.createElement('div');
        bar.className = 'bar';
        bar.setAttribute('role', 'progressbar');
        const fill = document.createElement('div');
        fill.className = 'fill';
        bar.appendChild(fill);

        const acts = document.createElement('div');
        acts.className = 'acts';
        const playButton = document.createElement('button');
        playButton.textContent = '停止';
        playButton.setAttribute('aria-label', '停止合成');
        const copyButton = document.createElement('button');
        copyButton.textContent = '复制';
        copyButton.setAttribute('aria-label', '复制原文');
        const regenButton = document.createElement('button');
        regenButton.textContent = '重合成';
        regenButton.setAttribute('aria-label', '用面板当前音色重新合成');
        const downloadButton = document.createElement('button');
        downloadButton.textContent = '下载';
        downloadButton.setAttribute('aria-label', '下载 WAV');
        downloadButton.disabled = true;
        const deleteButton = document.createElement('button');
        deleteButton.className = 'del';
        deleteButton.textContent = '✕';
        deleteButton.setAttribute('aria-label', '删除');
        acts.append(playButton, copyButton, regenButton, downloadButton, deleteButton);

        const segs = document.createElement('details');
        segs.className = 'segs';
        segs.open = true;
        const segSummary = document.createElement('summary');
        segSummary.append('分段 ');
        const segCount = document.createElement('span');
        segCount.className = 'segCount';
        segCount.textContent = '0';
        segSummary.appendChild(segCount);
        const segList = document.createElement('div');
        segList.className = 'segList';
        segs.append(segSummary, segList);

        mid.append(txt, tags, acts, bar, segs);
        row.append(meta, mid);
        ui.list.insertBefore(row, ui.list.firstChild);
        bar.classList.add('show');

        Object.assign(record, { row, duration, playButton, downloadButton, bar, fill, segs, segList, segCount });

        // 进度条点击跳转只认当前 audio，重建 WAV 后自动换成新的那条
        bar.addEventListener('click', event => {
            const audio = record.audio;
            if (!audio || !Number.isFinite(audio.duration) || !audio.duration) return;
            const rect = bar.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            audio.currentTime = ratio * audio.duration;
            fill.style.width = `${ratio * 100}%`;
        });

        playButton.addEventListener('click', () => {
            if (record.state === 'capturing') {
                record.session?.stop();
                return;
            }
            if (record.state === 'playing') {
                stopTimeline(record);
                return;
            }
            if (record.audio && !record.audio.paused) {
                record.audio.pause();
                return;
            }
            if (!record.url) return;
            // 同一时间只放一条，避免边听边叠音
            stopActive();
            stopTimeline(activeTimeline);
            if (!record.audio) {
                const audio = new Audio(record.url);
                // 变速不变调；不同浏览器前缀都设一遍
                audio.preservesPitch = true;
                audio.mozPreservesPitch = true;
                audio.webkitPreservesPitch = true;
                audio.addEventListener('pause', syncPlayState);
                audio.addEventListener('ended', () => {
                    fill.style.width = '0%';
                    bar.classList.remove('show');
                    syncPlayState();
                });
                audio.addEventListener('timeupdate', () => {
                    if (!Number.isFinite(audio.duration) || !audio.duration) return;
                    fill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
                });
                record.audio = audio;
            }
            record.audio.playbackRate = playRate;
            activeAudio = record.audio;
            bar.classList.add('show');
            record.audio.play().then(syncPlayState, syncPlayState);
        });
        downloadButton.addEventListener('click', () => {
            if (!record.url) return;
            const link = document.createElement('a');
            link.href = record.url;
            link.download = `sichang-tts-${new Date(record.time).toISOString().replace(/[:.]/g, '-')}.wav`;
            document.body.appendChild(link);
            link.click();
            link.remove();
        });
        deleteButton.addEventListener('click', () => removeRecord(record));
        copyButton.addEventListener('click', () => copyRecordText(record.text, copyButton));
        regenButton.addEventListener('click', () => resynthesizeRecord(record));
        txt.addEventListener('click', () => {
            const expanded = txt.classList.toggle('expanded');
            txt.textContent = expanded ? text || '（无文本）' : preview;
        });

        records.push(record);
        while (records.length > MAX_RECORDS) removeRecord(records[0]);
        updateCount();
        return record;
    }

    function formatSegmentDuration(seconds) {
        if (seconds < 10) return `${seconds.toFixed(1)}s`;
        return formatDuration(seconds);
    }

    function setSegmentsEnabled(record, enabled) {
        for (const segment of record.segments) {
            segment.regenButton.disabled = !enabled || segment.busy;
            segment.playButton.disabled = !enabled || segment.busy || !segment.complete;
        }
    }

    // 每段一落数据就建一条子条目，顺序与 WAV 拼接顺序一致
    function createSegment(record, text) {
        const segment = { text, chunks: [], bytes: 0, busy: false, complete: false };
        record.segments.push(segment);
        const box = document.createElement('div');
        box.className = 'segBox';
        const row = document.createElement('div');
        row.className = 'seg';
        const idx = document.createElement('span');
        idx.className = 'idx';
        idx.textContent = String(record.segments.length);
        const label = document.createElement('span');
        label.className = 'segText';
        label.textContent = previewText(text).slice(0, 24) || '（无文本）';
        label.title = text;
        const segDuration = document.createElement('span');
        segDuration.className = 'segDur';
        segDuration.textContent = '…';
        const playButton = document.createElement('button');
        playButton.className = 'segPlay';
        playButton.textContent = '▶';
        playButton.setAttribute('aria-label', '播放本段');
        playButton.disabled = true;
        const regenButton = document.createElement('button');
        regenButton.textContent = '重生成';
        regenButton.disabled = true;
        const bar = document.createElement('div');
        bar.className = 'segBar';
        bar.setAttribute('role', 'progressbar');
        const fill = document.createElement('div');
        fill.className = 'fill';
        bar.appendChild(fill);
        row.append(idx, label, segDuration, playButton, regenButton);
        box.append(row, bar);
        record.segList.appendChild(box);
        record.segCount.textContent = String(record.segments.length);
        Object.assign(segment, { box, row, durationEl: segDuration, playButton, regenButton, bar, fill });
        playButton.addEventListener('click', () => toggleSegmentPlay(record, segment));
        regenButton.addEventListener('click', () => regenerateSegment(record, segment));
        // 分段进度条自己跳转，只操作本段的 audio
        bar.addEventListener('click', event => {
            const audio = segment.audio;
            if (!audio || !Number.isFinite(audio.duration) || !audio.duration) return;
            const rect = bar.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            audio.currentTime = ratio * audio.duration;
            fill.style.width = `${ratio * 100}%`;
        });
        return segment;
    }

    function syncSegmentPlayState(segment) {
        const playing = Boolean(segment.audio && !segment.audio.paused);
        segment.playButton.textContent = playing ? '⏸' : '▶';
        segment.playButton.setAttribute('aria-label', playing ? '暂停本段' : '播放本段');
        segment.playButton.classList.toggle('playing', playing);
    }

    // 段的 WAV 按需生成：没点播放就不复制 PCM，避免长记录成倍占内存
    function ensureSegmentUrl(record, segment) {
        if (!segment.url) {
            const even = segment.bytes - (segment.bytes % 2);
            segment.url = URL.createObjectURL(pcmToWav(joinedPcm(segment.chunks, even), record.sampleRate));
        }
        return segment.url;
    }

    function clearSegmentAudio(segment) {
        if (segment.audio) {
            if (segment.audio === activeAudio) activeAudio = null;
            segment.audio.pause();
            segment.audio = null;
        }
        if (segment.url) {
            URL.revokeObjectURL(segment.url);
            segment.url = null;
        }
        segment.bar.classList.remove('show');
        segment.fill.style.width = '0%';
        syncSegmentPlayState(segment);
    }

    function toggleSegmentPlay(record, segment) {
        if (!segment.complete || segment.busy || record.regenerating) return;
        // 时间线还在播时点某一段，先停整体播放，避免两路声音叠在一起
        if (record.state === 'playing') stopTimeline(record);
        if (record.state !== 'ready') return;
        if (segment.audio && !segment.audio.paused) {
            segment.audio.pause();
            return;
        }
        stopActive();
        stopTimeline(activeTimeline);
        if (!segment.audio) {
            const audio = new Audio(ensureSegmentUrl(record, segment));
            audio.preservesPitch = true;
            audio.mozPreservesPitch = true;
            audio.webkitPreservesPitch = true;
            audio.addEventListener('pause', () => syncSegmentPlayState(segment));
            audio.addEventListener('ended', () => {
                segment.bar.classList.remove('show');
                segment.fill.style.width = '0%';
                syncSegmentPlayState(segment);
            });
            audio.addEventListener('timeupdate', () => {
                if (!Number.isFinite(audio.duration) || !audio.duration) return;
                segment.fill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
            });
            segment.audio = audio;
        }
        segment.audio.playbackRate = playRate;
        activeAudio = segment.audio;
        segment.bar.classList.add('show');
        segment.audio.play().then(() => syncSegmentPlayState(segment), () => syncSegmentPlayState(segment));
    }

    function dropAudio(record) {
        if (record.audio) {
            if (record.audio === activeAudio) activeAudio = null;
            record.audio.pause();
            record.audio = null;
        }
        // 整条试听要停时，分段试听也一起停，避免残留声音
        for (const segment of record.segments) {
            if (segment.audio) {
                if (segment.audio === activeAudio) activeAudio = null;
                segment.audio.pause();
                segment.audio = null;
                segment.bar.classList.remove('show');
                segment.fill.style.width = '0%';
                syncSegmentPlayState(segment);
            }
        }
        record.fill.style.width = '0%';
        record.bar.classList.remove('show');
        record.playButton.textContent = '播放';
        record.playButton.classList.remove('playing');
    }

    // 某一段被替换后整条 WAV 要重拼：旧的 blob URL 作废，播放位置归零
    function rebuildRecord(record) {
        if (record.url) URL.revokeObjectURL(record.url);
        record.url = null;
        const total = record.segments.reduce((sum, segment) => sum + segment.bytes, 0);
        const even = total - (total % 2);
        if (!even) {
            markFailed(record);
            return;
        }
        const chunks = [];
        for (const segment of record.segments) chunks.push(...segment.chunks);
        const pcm = joinedPcm(chunks, even);
        record.url = URL.createObjectURL(pcmToWav(pcm, record.sampleRate));
        record.bytes = even;
        record.seconds = even / 2 / record.sampleRate;
        record.duration.textContent = formatDuration(record.seconds);
        record.downloadButton.disabled = false;
    }

    // 单独重生成一段：替换它的 PCM，再重建整条 WAV。只在 ready 状态可用，
    // 避免和正在进行的合成/时间线播放互相踩数据
    async function regenerateSegment(record, segment) {
        if (segment.busy || record.regenerating) return;
        // 时间线还在播时直接重生成：先停止播放再替换，不留下旧声音
        if (record.state === 'playing') stopTimeline(record);
        if (record.state !== 'ready') return;
        record.regenerating = true;
        setSegmentsEnabled(record, false);
        segment.busy = true;
        segment.regenButton.disabled = true;
        segment.regenButton.textContent = '重生成中';
        let ok = false;
        try {
            const response = await window.fetch(TTS_PATH, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', [SEGMENT_HEADER]: '1' },
                body: JSON.stringify({
                    text: segment.text,
                    voice: record.tts.voice,
                    rate: record.tts.rate,
                    format: record.tts.format,
                }),
            });
            if (!response.ok) throw new Error(`tts ${response.status}`);
            const sampleRate = Number(response.headers.get('X-Sample-Rate')) || DEFAULT_SAMPLE_RATE;
            // 采样率变了就没法直接拼进同一条 WAV
            if (sampleRate !== record.sampleRate) throw new Error('sample rate mismatch');
            const reader = response.body.getReader();
            const chunks = [];
            let bytes = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!value || !value.length) continue;
                chunks.push(value);
                bytes += value.length;
            }
            if (!bytes) throw new Error('empty');
            if (bytes % 2) {
                const last = chunks[chunks.length - 1];
                chunks[chunks.length - 1] = last.subarray(0, last.length - 1);
                bytes -= 1;
            }
            // 记录可能在合成途中被删掉或被挤出列表
            if (!records.includes(record)) return;
            clearSegmentAudio(segment);
            dropAudio(record);
            segment.chunks = chunks;
            segment.bytes = bytes;
            segment.durationEl.textContent = formatSegmentDuration(bytes / 2 / record.sampleRate);
            rebuildRecord(record);
            ok = true;
        } catch (error) {
            segment.regenButton.textContent = '失败';
            setTimeout(() => {
                if (segment.regenButton.textContent === '失败') segment.regenButton.textContent = '重生成';
            }, 1500);
        } finally {
            segment.busy = false;
            record.regenerating = false;
            if (ok) segment.regenButton.textContent = '重生成';
            setSegmentsEnabled(record, record.state === 'ready');
        }
    }

    function updateProgress(record, done, total) {
        if (!records.includes(record)) return;
        if (total > 1) {
            record.bar.classList.add('determinate');
            record.duration.textContent = `${done}/${total}`;
            record.fill.style.width = `${(done / total) * 100}%`;
        }
    }

    function markFailed(record) {
        if (!records.includes(record)) return;
        record.state = 'failed';
        record.session = null;
        record.row.removeAttribute('data-live');
        record.bar.classList.remove('show');
        record.duration.textContent = '失败';
        record.playButton.textContent = '播放';
        record.playButton.disabled = true;
        record.downloadButton.disabled = true;
        setSegmentsEnabled(record, false);
    }

    function finalizeRecord(record) {
        // 捕获中被删掉或被挤出列表的记录不再落盘
        if (!records.includes(record) || record.state !== 'capturing') return;
        const evenLength = record.bytes - (record.bytes % 2);
        const session = record.session;
        record.session = null;
        if (!evenLength) {
            markFailed(record);
            return;
        }
        const chunks = [];
        for (const segment of record.segments) chunks.push(...segment.chunks);
        const pcm = joinedPcm(chunks, evenLength);
        record.url = URL.createObjectURL(pcmToWav(pcm, record.sampleRate));
        record.seconds = evenLength / 2 / record.sampleRate;
        record.state = 'ready';
        record.row.removeAttribute('data-live');
        record.bar.classList.remove('show');
        record.bar.classList.remove('determinate');
        record.duration.textContent = formatDuration(record.seconds);
        record.playButton.textContent = '播放';
        record.playButton.disabled = false;
        record.downloadButton.disabled = false;
        for (const segment of record.segments) {
            segment.durationEl.textContent = formatSegmentDuration(segment.bytes / 2 / record.sampleRate);
        }
        setSegmentsEnabled(record, true);

        // 数据下完了，但整条音频还在时间线上播：这段可能长达数分钟，
        // 按钮保持「停止」，播完再由定时器切回「播放」
        if (session && !session.stopped && session.sources.length && session.playhead > session.context.currentTime + 0.05) {
            if (activeTimeline && activeTimeline !== record) stopTimeline(activeTimeline);
            record.state = 'playing';
            record.session = session;
            activeTimeline = record;
            record.playButton.textContent = '停止';
            record.bar.classList.add('show');
            record.bar.classList.add('determinate');
            startTimelineTicker(record, session);
        }
    }

    // 面板里的手动入口：走同一条分段合成、边下边播、落盘流程，不依赖站点的朗读按钮
    try {
        const savedVoice = localStorage.getItem(VOICE_STORE_KEY);
        if (savedVoice && [...ui.voice.options].some(option => option.value === savedVoice)) ui.voice.value = savedVoice;
        const savedRate = Number(localStorage.getItem(RATE_STORE_KEY));
        if (savedRate >= 0.5 && savedRate <= 2) ui.rate.value = String(savedRate);
    } catch {}

    // 选完立刻记住：官方按钮也走面板音色，不点「合成」也不会丢这次选择
    ui.voice.addEventListener('change', () => {
        try {
            localStorage.setItem(VOICE_STORE_KEY, ui.voice.value);
        } catch {}
    });

    function currentTts() {
        const voice = ui.voice.value || DEFAULT_VOICE;
        const rate = Math.min(2, Math.max(0.5, Number(ui.rate.value) || 1));
        return { voice, rate };
    }

    // 输入区随内容长高，超过上限就内部滚动
    function autoGrowInput() {
        if (ui.panel.classList.contains('folded')) return;
        ui.input.style.height = 'auto';
        ui.input.style.height = `${Math.min(ui.input.scrollHeight + 2, 132)}px`;
    }

    function saveDraft() {
        try {
            localStorage.setItem(DRAFT_STORE_KEY, ui.input.value);
        } catch {}
    }

    // 字数和分段数就是这次会发出的请求数，提前给个心理预期
    function updateComposeMeta() {
        const text = ui.input.value.trim();
        const chars = text.replace(/\s/g, '').length;
        const segments = splitText(text).length;
        ui.stats.textContent = `${chars} 字 · ${segments} 段`;
        ui.go.disabled = !text;
    }

    function onInputChange() {
        autoGrowInput();
        updateComposeMeta();
        saveDraft();
    }
    ui.input.addEventListener('input', onInputChange);
    ui.clearInput.addEventListener('click', () => {
        ui.input.value = '';
        onInputChange();
        ui.input.focus();
    });
    ui.rate.addEventListener('change', () => {
        const { rate } = currentTts();
        ui.rate.value = String(rate);
        try {
            localStorage.setItem(RATE_STORE_KEY, String(rate));
        } catch {}
    });

    try {
        const draft = localStorage.getItem(DRAFT_STORE_KEY);
        ui.input.value = draft === null ? DEFAULT_INPUT_TEXT : draft;
    } catch {
        ui.input.value = DEFAULT_INPUT_TEXT;
    }
    autoGrowInput();
    updateComposeMeta();

    function submitCompose() {
        const text = ui.input.value.trim();
        if (!text) {
            ui.input.focus();
            return;
        }
        const { voice, rate } = currentTts();
        try {
            localStorage.setItem(VOICE_STORE_KEY, voice);
            localStorage.setItem(RATE_STORE_KEY, String(rate));
        } catch {}
        // 不清空输入：换音色后可以直接再点合成，反复试听
        startSession({ text, voice, rate, format: 'pcm16' });
    }

    ui.go.addEventListener('click', submitCompose);
    // 换音色后不用重新粘贴文本：按面板当前音色和语速再合成一条
    function resynthesizeRecord(record) {
        if (!record.text) return;
        const { voice, rate } = currentTts();
        startSession({ text: record.text, voice, rate, format: 'pcm16' });
    }
    // 面板里的按键不要冒泡到站点，避免触发站点自己的输入/发送快捷键
    ui.compose.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submitCompose();
        }
    });
    ui.compose.addEventListener('keyup', event => event.stopPropagation());

    ui.clear.addEventListener('click', () => {
        if (!records.length) return;
        if (!window.confirm(`确定清空全部 ${records.length} 条语音记录？此操作不可撤销。`)) return;
        for (const record of [...records]) removeRecord(record);
        activeAudio = null;
    });

    // 把一段 PCM 排进 Web Audio 的播放时间线，段与段之间按上一段的结束时间接续
    function startSource(session, bytes) {
        const count = bytes.byteLength / 2;
        if (!count) return;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const samples = new Float32Array(count);
        for (let i = 0; i < count; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
        const context = ensureAudioContext();
        session.context = context;
        const buffer = context.createBuffer(1, count, session.sampleRate);
        buffer.copyToChannel(samples, 0);
        const source = context.createBufferSource();
        source.buffer = buffer;
        // 实时时间线不做变速：Web Audio 的 playbackRate 会连音高一起升，
        // 倍速只用于面板 WAV（<audio> 由浏览器做保音高变速）
        source.connect(context.destination);
        const startAt = Math.max(session.playhead, context.currentTime + 0.06);
        source.start(startAt);
        if (session.timelineStart === null) session.timelineStart = startAt;
        session.playhead = startAt + buffer.duration;
        // 播完就从时间线里摘掉，避免长文本攒下成千上万个节点
        source.onended = () => {
            const index = session.sources.indexOf(source);
            if (index >= 0) session.sources.splice(index, 1);
        };
        session.sources.push(source);
    }

    // 首段先攒够 MIN_START_SECONDS 再排时间线：开头几个块到得慢，
    // 直接起播会在第一句里留出可听出来的补白
    function flushPending(session) {
        if (session.stopped || session.started || !session.pendingBytes) return;
        const merged = new Uint8Array(session.pendingBytes);
        let offset = 0;
        for (const part of session.pending) {
            merged.set(part, offset);
            offset += part.length;
        }
        session.pending = [];
        session.pendingBytes = 0;
        session.started = true;
        startSource(session, merged);
    }

    function schedulePcm(session, bytes) {
        if (!session.started) {
            session.pending.push(bytes);
            session.pendingBytes += bytes.length;
            if (session.pendingBytes < session.sampleRate * 2 * MIN_START_SECONDS) return;
            flushPending(session);
            return;
        }
        startSource(session, bytes);
    }

    function stopSources(session) {
        for (const source of session.sources) {
            try {
                source.stop();
            } catch {}
        }
        session.sources.length = 0;
    }

    function startSession({ text, voice, rate, format }) {
        // 上一条如果只剩时间线在播，先把它停干净；否则新朗读会和旧音频叠在一起
        stopTimeline(activeTimeline);
        activeSession?.stop();
        // 官方朗读和面板试听互斥，避免两路声音叠在一起
        stopActive();
        const tasks = splitText(text);
        if (!tasks.length) return null;

        const record = beginRecord(text, { voice, rate, format });
        // 在点击的同一个任务里解锁音频上下文，后面数据到了才能直接出声
        ensureAudioContext();
        const session = {
            record,
            stopped: false,
            playhead: 0,
            started: false,
            pending: [],
            pendingBytes: 0,
            timelineStart: null,
            context: null,
            sources: [],
            sampleRate: DEFAULT_SAMPLE_RATE,
            controller: new AbortController(),
            total: tasks.length,
            done: 0,
        };
        record.session = session;
        activeSession = session;
        updateProgress(record, 0, session.total);

        const requestSegment = segmentText => window.fetch(TTS_PATH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', [SEGMENT_HEADER]: '1' },
            body: JSON.stringify({ text: segmentText, voice, rate, format }),
            signal: session.controller.signal,
        }).then(response => {
            if (!response.ok) throw new Error(`tts ${response.status}`);
            const sampleRate = Number(response.headers.get('X-Sample-Rate')) || DEFAULT_SAMPLE_RATE;
            session.sampleRate = sampleRate;
            record.sampleRate = sampleRate;
            return response;
        });

        // 一次预取下一段：当前段在播时，下一段已经在合成，接缝更短
        let prefetch = null;
        const startPrefetch = piece => {
            if (prefetch) return;
            const promise = requestSegment(piece);
            promise.catch(() => {});
            prefetch = { piece, promise };
        };
        const takePrefetch = piece => {
            if (prefetch && prefetch.piece === piece) {
                const { promise } = prefetch;
                prefetch = null;
                return promise;
            }
            return requestSegment(piece);
        };

        const consume = async (response, piece) => {
            const reader = response.body.getReader();
            let leftover = new Uint8Array(0);
            let segment = null;
            const ensureSegment = () => {
                if (!segment) segment = createSegment(record, piece);
                return segment;
            };
            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (!value || !value.length || session.stopped) continue;
                    if (record.bytes + value.length > MAX_PCM_BYTES) continue;

                    let data = value;
                    if (leftover.length) {
                        data = new Uint8Array(leftover.length + value.length);
                        data.set(leftover);
                        data.set(value, leftover.length);
                    }
                    const evenLength = data.length - (data.length % 2);
                    if (evenLength) {
                        const part = data.subarray(0, evenLength);
                        const target = ensureSegment();
                        target.chunks.push(part);
                        target.bytes += evenLength;
                        record.bytes += evenLength;
                        schedulePcm(session, part);
                    }
                    leftover = data.subarray(evenLength);
                }
            } finally {
                if (segment) {
                    segment.complete = true;
                    segment.durationEl.textContent = formatSegmentDuration(segment.bytes / 2 / record.sampleRate);
                }
            }
            // 整段比预缓冲还短时也要起播，不能一直攒着
            flushPending(session);
        };

        const speak = async piece => {
            const segmentsBefore = record.segments.length;
            for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                try {
                    const response = await takePrefetch(piece);
                    if (session.stopped) return 'done';
                    // 当前段开始播时就把下一段发出去，缩短段间等待
                    if (tasks.length) startPrefetch(tasks[0]);
                    await consume(response, piece);
                    return 'done';
                } catch (error) {
                    if (session.stopped || session.controller.signal.aborted) return 'done';
                    // 这一轮已经收到过数据就不再重试，否则同一段会重复拼进 WAV
                    if (record.segments.length > segmentsBefore) return 'done';
                }
            }
            // 已经收到过一部分数据就把这半段当作完成，避免重复播放开头
            if (record.segments.length > segmentsBefore) return 'done';
            const halves = splitInHalf(piece);
            if (!halves) return 'failed';
            // 失败的长句拆成两半再排到队首，总段数同步加一
            tasks.unshift(...halves);
            session.total += halves.length - 1;
            return 'split';
        };

        (async () => {
            startPrefetch(tasks[0]);
            while (tasks.length && !session.stopped) {
                const piece = tasks.shift();
                const result = await speak(piece);
                if (session.stopped) break;
                if (result !== 'split') session.done += 1;
                updateProgress(record, session.done, session.total);
            }
            if (session.stopped) return;
            finalizeRecord(record);
        })().catch(() => {
            if (!session.stopped) finalizeRecord(record);
        });

        session.stop = () => {
            if (session.stopped) return;
            session.stopped = true;
            try {
                session.controller.abort();
            } catch {}
            stopSources(session);
            if (activeSession === session) activeSession = null;
            // 合成已结束、只剩时间线在播时，按停止要把按钮和进度一起复位
            if (record.state === 'playing') {
                stopTimeline(record);
                return;
            }
            finalizeRecord(record);
        };
        session.abort = () => {
            session.stopped = true;
            try {
                session.controller.abort();
            } catch {}
            stopSources(session);
            if (activeSession === session) activeSession = null;
        };

        return session;
    }

    function parseRequest(init) {
        if (!init || typeof init.body !== 'string') return null;
        try {
            const data = JSON.parse(init.body);
            return { text: data.text || '', voice: data.voice, rate: data.rate, format: data.format || 'pcm16' };
        } catch {
            return null;
        }
    }

    function isSegmentRequest(init) {
        const headers = init && init.headers;
        if (!headers) return false;
        if (typeof headers.get === 'function') return headers.get(SEGMENT_HEADER) === '1';
        return headers[SEGMENT_HEADER] === '1';
    }

    // 官方播放器拿到的必须是一个能正常结束的响应，否则会弹「语音合成失败」；
    // 给它一帧静音，让状态机走完，真正的播放交给脚本自己的时间线
    function silentResponse() {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(2));
                controller.close();
            },
        });
        return new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'audio/pcm', 'X-Sample-Rate': String(DEFAULT_SAMPLE_RATE) },
        });
    }

    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (!url.includes(TTS_PATH) || isSegmentRequest(init)) {
            return originalFetch.apply(this, arguments);
        }
        const request = parseRequest(init);
        // 官方按钮也跟随面板音色：站点自己带的 voice 不参与，避免两处选择打架
        if (request && request.text) startSession({ ...request, voice: ui.voice.value || DEFAULT_VOICE });
        return Promise.resolve(silentResponse());
    };

    return () => {
        window.removeEventListener('resize', onResize);
        window.fetch = originalFetch;
        for (const record of [...records]) removeRecord(record);
        activeAudio = null;
        activeSession = null;
        activeTimeline = null;
        if (audioContext && audioContext.state !== 'closed') {
            try {
                audioContext.close();
            } catch {}
        }
        ui.host.remove();
    };
}
