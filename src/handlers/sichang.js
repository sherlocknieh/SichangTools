// 思畅 AI 的「朗读」请求 POST /api/tts，拿回 24kHz 单声道 PCM16 流由页面边下边播。
// 这里直接接管这个请求：官方不会再整段合成，而是按句子分批请求、边下边播；
// 每段的 PCM 同时拼成一条 WAV 放进右下角面板，供试听和下载。
// 分段是为了长文本更稳：整段失败就什么都没了，分段后单段失败还能重试或再拆开。

import {
    TTS_PATH,
    PANEL_ID,
    DEFAULT_SAMPLE_RATE,
    MAX_RECORDS,
    MAX_SEGMENT_CHARS,
    MAX_ATTEMPTS,
    MAX_PCM_BYTES,
    SEGMENT_HEADER,
    MIN_START_SECONDS,
    DEFAULT_INPUT_TEXT,
    VOICE_STORE_KEY,
    RATE_STORE_KEY,
    FOLD_STORE_KEY,
    PLAY_RATE_STORE_KEY,
    DRAFT_STORE_KEY,
    POS_STORE_KEY,
    PLAY_RATES,
} from '../sichang/constants.js';
import { VOICE_GROUPS, VOICE_LABELS, DEFAULT_VOICE } from '../sichang/voices.js';
import { PANEL_CSS } from '../sichang/styles.js';
import { pcmToWav, pcmToSamples, joinedPcm } from '../sichang/audio.js';

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
            <select class="speed" aria-label="播放倍速" title="播放倍速（试听保持音高，实时播放会变调）">${speeds}</select>
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
            // 实时时间线没有 preservesPitch，换速会连音高一起变；按当前位置重排
            const session = record.session;
            if (!session) continue;
            const live = record.state === 'playing' || record.state === 'paused' || record.state === 'capturing';
            if (!live) continue;
            const position = livePosition(session);
            session.rate = value;
            session.pausedOffset = position;
            // 合成中试听分段时时间线是暂停的，换速只记下，等回到实时播放再重排，避免叠音
            if (!session.paused) {
                rescheduleTimeline(record, position);
                if (record.state === 'playing') armTimelineEnd(record);
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
        if (!record || (record.state !== 'playing' && record.state !== 'paused')) return;
        clearTimeout(record.timelineTimer);
        clearInterval(record.timelineTicker);
        record.timelineTimer = null;
        record.timelineTicker = null;
        if (record.session) record.session.paused = false;
        record.session?.abort();
        if (activeSession && activeSession.record === record) activeSession = null;
        record.session = null;
        if (activeTimeline === record) activeTimeline = null;
        record.state = 'ready';
        record.playButton.textContent = '播放';
        record.playButton.setAttribute('aria-label', '播放');
        record.playButton.classList.remove('playing');
        record.stopButton.hidden = true;
        record.bar.classList.remove('show');
        record.fill.style.width = '0%';
        record.duration.textContent = formatDuration(record.seconds);
        refreshSegmentControls(record);
    }

    // 实时播放的当前进度（秒）：暂停时停在暂停点，播放时从锚点按倍速线性推进
    function livePosition(session) {
        if (session.paused) return session.pausedOffset || 0;
        if (session.timelineStart === null) return session.startOffset || 0;
        const elapsed = Math.max(0, session.context.currentTime - session.timelineStart);
        const position = session.startOffset + elapsed * session.rate;
        return Math.min(session.receivedSeconds, Math.max(0, position));
    }

    function startTimelineTicker(record, session) {
        clearInterval(record.timelineTicker);
        const tick = () => {
            if (record.state !== 'playing') return;
            const total = session.receivedSeconds || record.seconds;
            const ratio = total ? Math.min(1, livePosition(session) / total) : 0;
            record.fill.style.width = `${ratio * 100}%`;
        };
        tick();
        record.timelineTicker = setInterval(tick, 250);
    }

    // 结束定时器只在数据全部下完后才有意义；暂停、跳转、换速都要重算
    function armTimelineEnd(record) {
        const session = record.session;
        clearTimeout(record.timelineTimer);
        record.timelineTimer = null;
        if (!session || record.state !== 'playing') return;
        const remaining = Math.max(0, session.receivedSeconds - livePosition(session)) / session.rate;
        record.timelineTimer = setTimeout(() => stopTimeline(record), remaining * 1000 + 120);
    }

    // 从整条已收到的 PCM 里切出 startByte 之后的部分；各段 chunks 按到达顺序排列
    function pcmFromBytes(record, startByte) {
        const from = Math.min(Math.max(0, startByte), record.bytes);
        const out = new Uint8Array(record.bytes - from);
        let written = 0;
        let cursor = 0;
        for (const segment of record.segments) {
            for (const chunk of segment.chunks) {
                const end = cursor + chunk.length;
                if (end > from) {
                    const begin = Math.max(0, from - cursor);
                    out.set(chunk.subarray(begin), written);
                    written += chunk.length - begin;
                }
                cursor = end;
            }
        }
        return out.subarray(0, written);
    }

    // 暂停继续、进度跳转、换速都走「按 PCM 重排」：不保留每个块的 AudioBuffer，
    // 否则长文本播放时会攒出上百兆的 Float32
    function rescheduleTimeline(record, offset) {
        const session = record.session;
        if (!session) return;
        const context = ensureAudioContext();
        session.context = context;
        stopSources(session);
        // 预缓冲队列里的字节已经包含在 record.segments 里，重排后不能再用旧队列
        session.pending = [];
        session.pendingBytes = 0;
        const sampleRate = session.sampleRate || record.sampleRate;
        const pcm = pcmFromBytes(record, Math.round(offset * sampleRate) * 2);
        const count = Math.floor(pcm.byteLength / 2);
        if (!count) {
            session.started = false;
            session.timelineStart = null;
            session.playhead = 0;
            session.startOffset = offset;
            return;
        }
        const buffer = context.createBuffer(1, count, sampleRate);
        buffer.copyToChannel(pcmToSamples(pcm), 0);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = session.rate;
        source.connect(context.destination);
        const startAt = context.currentTime + 0.06;
        source.start(startAt);
        source.onended = () => {
            const index = session.sources.indexOf(source);
            if (index >= 0) session.sources.splice(index, 1);
        };
        session.sources.push(source);
        session.started = true;
        session.timelineStart = startAt;
        session.startOffset = offset;
        session.playhead = startAt + buffer.duration / session.rate;
    }

    // 实时播放可能要好几分钟；暂停只停声音，合成照常继续，继续时从暂停点重排
    function pauseTimeline(record) {
        const session = record.session;
        if (!session || record.state !== 'playing') return;
        const position = livePosition(session);
        session.paused = true;
        session.pausedOffset = position;
        stopSources(session);
        clearInterval(record.timelineTicker);
        clearTimeout(record.timelineTimer);
        record.timelineTicker = null;
        record.timelineTimer = null;
        record.state = 'paused';
        record.playButton.textContent = '继续';
        record.playButton.setAttribute('aria-label', '继续播放');
        record.playButton.classList.remove('playing');
    }

    function resumeTimeline(record) {
        const session = record.session;
        if (!session || record.state !== 'paused') return;
        // 继续时间线前先停掉分段试听，避免两路声音叠在一起
        stopActive();
        session.paused = false;
        const offset = Math.min(session.pausedOffset || 0, session.receivedSeconds);
        session.pausedOffset = offset;
        rescheduleTimeline(record, offset);
        record.state = 'playing';
        record.playButton.textContent = '暂停';
        record.playButton.setAttribute('aria-label', '暂停播放');
        record.playButton.classList.add('playing');
        startTimelineTicker(record, session);
        armTimelineEnd(record);
    }

    // 合成还在进行时试听某一段：实时时间线先停在当前位置（不终止合成、不改变捕获状态），
    // 分段播完再从这里继续；期间到达的 PCM 照常累积，继续时随重排一起接上
    function pauseLiveCapture(record) {
        const session = record.session;
        if (!session || session.stopped || session.paused) return;
        session.pausedOffset = livePosition(session);
        session.paused = true;
        stopSources(session);
    }

    function resumeLiveCapture(record) {
        const session = record.session;
        if (!session || session.stopped || !session.paused || record.state !== 'capturing') return;
        session.paused = false;
        const offset = Math.min(session.pausedOffset || 0, session.receivedSeconds);
        session.pausedOffset = offset;
        rescheduleTimeline(record, offset);
    }

    function seekTimeline(record, seconds) {
        const session = record.session;
        if (!session) return;
        const position = Math.min(Math.max(0, seconds), session.receivedSeconds);
        session.pausedOffset = position;
        if (!session.paused) {
            rescheduleTimeline(record, position);
            armTimelineEnd(record);
        }
        const ratio = session.receivedSeconds ? position / session.receivedSeconds : 0;
        record.fill.style.width = `${ratio * 100}%`;
    }

    // 单条播放结束或被打断时，把按钮文字和状态一起改回来；捕获中的行不参与
    function syncPlayState() {
        for (const record of records) {
            if (record.state !== 'ready' || !record.playButton) continue;
            const playing = Boolean(record.audio && !record.audio.paused);
            record.playButton.textContent = playing ? '暂停' : '播放';
            record.playButton.setAttribute('aria-label', playing ? '暂停播放' : '播放');
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
        // 实时播放单独给一个「停止」：主按钮在播放/暂停之间切换，停不下来会很难受
        const stopButton = document.createElement('button');
        stopButton.textContent = '停止';
        stopButton.setAttribute('aria-label', '停止播放');
        stopButton.hidden = true;
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
        acts.append(playButton, stopButton, copyButton, regenButton, downloadButton, deleteButton);

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

        Object.assign(record, { row, duration, playButton, stopButton, downloadButton, bar, fill, segs, segList, segCount });

        // 进度条点击跳转：实时时间线按已收到音频的长度换算，播放整条 WAV 时直接改 currentTime
        bar.addEventListener('click', event => {
            const rect = bar.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            if (record.state === 'playing' || record.state === 'paused') {
                seekTimeline(record, ratio * (record.session?.receivedSeconds || 0));
                return;
            }
            const audio = record.audio;
            if (!audio || !Number.isFinite(audio.duration) || !audio.duration) return;
            audio.currentTime = ratio * audio.duration;
            fill.style.width = `${ratio * 100}%`;
        });

        playButton.addEventListener('click', () => {
            if (record.state === 'capturing') {
                record.session?.stop();
                return;
            }
            if (record.state === 'playing') {
                pauseTimeline(record);
                return;
            }
            if (record.state === 'paused') {
                resumeTimeline(record);
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
        stopButton.addEventListener('click', () => stopTimeline(record));
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

    // 分段按钮的可用性只看这一段自己的状态：一完成就能点，不必等整条合成结束。
    // 重生成只锁目标段（busy）和所有「重生成」按钮；其他段 PCM 独立，仍可照常试听
    function refreshSegmentControls(record) {
        const playable = record.state !== 'failed';
        for (const segment of record.segments) {
            segment.playButton.disabled = !playable || segment.busy || !segment.complete || !segment.bytes;
            segment.regenButton.disabled = record.state !== 'ready' || record.regenerating || segment.busy;
        }
    }

    function setSegmentLabel(segment, text) {
        segment.text = text;
        segment.label.textContent = previewText(text).slice(0, 24) || '（无文本）';
        segment.label.title = text;
    }

    // 每段的状态直接写进子条目：待合成 → 合成中（时长随数据增长）→ 完成/失败
    function setSegmentState(record, segment, state) {
        segment.status = state;
        segment.complete = state === 'done';
        segment.row.dataset.state = state;
        const seconds = segment.bytes / 2 / (record.sampleRate || DEFAULT_SAMPLE_RATE);
        if (state === 'pending') segment.durationEl.textContent = '待合成';
        else if (state === 'active') segment.durationEl.textContent = `${formatSegmentDuration(seconds)}…`;
        else if (state === 'done') segment.durationEl.textContent = formatSegmentDuration(seconds);
        else if (state === 'failed') segment.durationEl.textContent = '失败';
        else segment.durationEl.textContent = '未合成';
        refreshSegmentControls(record);
    }

    function renumberSegments(record) {
        record.segments.forEach((segment, index) => {
            segment.idx.textContent = String(index + 1);
        });
        record.segCount.textContent = String(record.segments.length);
    }

    // 每段一建就占一条子条目（先显示「待合成」），合成进度与最终 WAV 顺序都按列表排列；
    // after 用于失败长句拆两半时把后半插在前半后面
    function createSegment(record, text, after) {
        const segment = { text, chunks: [], bytes: 0, busy: false, complete: false, status: 'pending' };
        const index = after ? record.segments.indexOf(after) + 1 : record.segments.length;
        record.segments.splice(index, 0, segment);
        const box = document.createElement('div');
        box.className = 'segBox';
        const row = document.createElement('div');
        row.className = 'seg';
        row.dataset.state = 'pending';
        const idx = document.createElement('span');
        idx.className = 'idx';
        const label = document.createElement('span');
        label.className = 'segText';
        const segDuration = document.createElement('span');
        segDuration.className = 'segDur';
        segDuration.textContent = '待合成';
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
        if (after) record.segList.insertBefore(box, after.box.nextSibling);
        else record.segList.appendChild(box);
        Object.assign(segment, { box, row, idx, label, durationEl: segDuration, playButton, regenButton, bar, fill });
        setSegmentLabel(segment, text);
        renumberSegments(record);
        playButton.addEventListener('click', () => toggleSegmentPlay(record, segment));
        regenButton.addEventListener('click', () => regenerateSegment(record, segment));
        // 分段进度条自己跳转；还没播过时按需建 audio，停在目标位置
        bar.addEventListener('click', event => {
            // 合成中就播过的段也有进度条，状态不再限制成 ready/paused；重生成只锁目标段
            if (!segment.complete || !segment.bytes || segment.busy) return;
            if (record.state === 'failed') return;
            const rect = bar.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            const audio = ensureSegmentAudio(record, segment);
            const seek = () => {
                if (!Number.isFinite(audio.duration) || !audio.duration) return;
                audio.currentTime = ratio * audio.duration;
                segment.bar.classList.add('show');
                fill.style.width = `${ratio * 100}%`;
            };
            if (audio.readyState >= 1) seek();
            else audio.addEventListener('loadedmetadata', seek, { once: true });
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

    // 第一次播放或拖动进度时才生成 WAV blob；变速保持不变调
    function ensureSegmentAudio(record, segment) {
        if (!segment.audio) {
            const audio = new Audio(ensureSegmentUrl(record, segment));
            audio.preservesPitch = true;
            audio.mozPreservesPitch = true;
            audio.webkitPreservesPitch = true;
            audio.addEventListener('pause', () => syncSegmentPlayState(segment));
            audio.addEventListener('ended', () => {
                audio.currentTime = 0;
                segment.bar.classList.remove('show');
                segment.fill.style.width = '0%';
                syncSegmentPlayState(segment);
                // 合成还没结束时，分段试听完自动回到整条的实时播放
                if (record.state === 'capturing') resumeLiveCapture(record);
            });
            audio.addEventListener('timeupdate', () => {
                if (!Number.isFinite(audio.duration) || !audio.duration) return;
                segment.fill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
            });
            segment.audio = audio;
        }
        segment.audio.playbackRate = playRate;
        return segment.audio;
    }

    function toggleSegmentPlay(record, segment) {
        // 正在重生成的那一段不能播，其他段不受影响
        if (!segment.complete || !segment.bytes || segment.busy) return;
        if (record.state === 'failed') return;
        if (segment.audio && !segment.audio.paused) {
            segment.audio.pause();
            // 合成中暂停试听也回到整条的实时播放，不留一段静默的捕获
            if (record.state === 'capturing') resumeLiveCapture(record);
            return;
        }
        // 实时播放中点某一段：先暂停整条时间线（不终止合成），避免两路声音叠在一起
        if (record.state === 'playing') pauseTimeline(record);
        else if (record.state === 'capturing') pauseLiveCapture(record);
        stopActive();
        if (activeTimeline && activeTimeline !== record) stopTimeline(activeTimeline);
        const audio = ensureSegmentAudio(record, segment);
        activeAudio = audio;
        segment.bar.classList.add('show');
        audio.play().then(() => syncSegmentPlayState(segment), () => syncSegmentPlayState(segment));
    }

    // 只停整条 WAV 的试听：整条 URL 会重拼，但分段各有自己的 PCM 与 blob，
    // 重生成某一段时其他段的播放不必跟着停
    function dropRecordAudio(record) {
        if (record.audio) {
            if (record.audio === activeAudio) activeAudio = null;
            record.audio.pause();
            record.audio = null;
        }
        record.fill.style.width = '0%';
        record.bar.classList.remove('show');
        record.playButton.textContent = '播放';
        record.playButton.setAttribute('aria-label', '播放');
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
        // 时间线还在播（或暂停）时直接重生成：先停下播放再替换，不留下旧声音
        if (record.state === 'playing' || record.state === 'paused') stopTimeline(record);
        if (record.state !== 'ready') return;
        // 先标目标段 busy 再刷新，保证它自己的播放/重生成按钮立即锁上，
        // 其他段仍保持可播
        segment.busy = true;
        segment.regenButton.textContent = '重生成中';
        record.regenerating = true;
        refreshSegmentControls(record);
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
            dropRecordAudio(record);
            segment.chunks = chunks;
            segment.bytes = bytes;
            // 被跳过或失败的段重生成成功后也要恢复成可播状态
            setSegmentState(record, segment, 'done');
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
            refreshSegmentControls(record);
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
        record.playButton.setAttribute('aria-label', '播放');
        record.playButton.disabled = true;
        record.downloadButton.disabled = true;
        for (const segment of record.segments) {
            if (segment.status === 'pending' || segment.status === 'active') {
                setSegmentState(record, segment, segment.bytes ? 'done' : 'skipped');
            }
        }
        refreshSegmentControls(record);
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
        record.playButton.setAttribute('aria-label', '播放');
        record.playButton.disabled = false;
        record.downloadButton.disabled = false;
        // 停止或失败时还没轮到的段标成「未合成」，已收到部分数据的段照常可播
        for (const segment of record.segments) {
            if (segment.status === 'pending' || segment.status === 'active') {
                setSegmentState(record, segment, segment.bytes ? 'done' : 'skipped');
            }
        }
        refreshSegmentControls(record);

        // 数据下完了，但整条音频还在时间线上播：这段可能长达数分钟，
        // 按钮先给「暂停」并单独留一个「停止」，播完再由定时器切回「播放」
        if (session && !session.stopped && session.sources.length && session.playhead > session.context.currentTime + 0.05) {
            if (activeTimeline && activeTimeline !== record) stopTimeline(activeTimeline);
            record.state = 'playing';
            record.session = session;
            activeTimeline = record;
            record.playButton.textContent = '暂停';
            record.playButton.setAttribute('aria-label', '暂停播放');
            record.playButton.classList.add('playing');
            record.stopButton.hidden = false;
            record.bar.classList.add('show');
            record.bar.classList.add('determinate');
            startTimelineTicker(record, session);
            armTimelineEnd(record);
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

    // 预填的试听文本不是用户草稿，落库时按空处理；灰暗显示提示它不是用户内容
    let inputIsDefault = false;

    function setInputDefault(isDefault) {
        inputIsDefault = isDefault;
        ui.input.classList.toggle('is-default', isDefault);
    }

    function saveDraft() {
        try {
            localStorage.setItem(DRAFT_STORE_KEY, inputIsDefault ? '' : ui.input.value);
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
    ui.input.addEventListener('input', () => {
        setInputDefault(false);
        onInputChange();
    });
    // 聚焦即进入编辑：清掉预填的试听文本，让用户从空框开始打
    ui.input.addEventListener('focus', () => {
        if (!inputIsDefault) return;
        ui.input.value = '';
        setInputDefault(false);
        autoGrowInput();
        updateComposeMeta();
    });
    // 失焦后仍为空就恢复预填，保证空框里始终有段试听文本
    ui.input.addEventListener('blur', () => {
        if (ui.input.value.trim()) return;
        ui.input.value = DEFAULT_INPUT_TEXT;
        setInputDefault(true);
        autoGrowInput();
        updateComposeMeta();
        saveDraft();
    });
    ui.clearInput.addEventListener('click', () => {
        ui.input.value = '';
        setInputDefault(false);
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
        if (draft && draft.trim()) {
            ui.input.value = draft;
            setInputDefault(false);
        } else {
            ui.input.value = DEFAULT_INPUT_TEXT;
            setInputDefault(true);
        }
    } catch {
        ui.input.value = DEFAULT_INPUT_TEXT;
        setInputDefault(true);
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

    // 把一段 PCM 排进 Web Audio 的播放时间线，段与段之间按上一段的结束时间接续。
    // audioStart 是这段在整条音频里的起点（秒），数据来晚时用它重锚进度
    function startSource(session, bytes, audioStart) {
        const count = Math.floor(bytes.byteLength / 2);
        if (!count) return;
        const context = ensureAudioContext();
        session.context = context;
        const buffer = context.createBuffer(1, count, session.sampleRate);
        buffer.copyToChannel(pcmToSamples(bytes), 0);
        const source = context.createBufferSource();
        source.buffer = buffer;
        // 实时播放只能用 Web Audio 变速（会连音高一起变）；合成完成后的 WAV 走 <audio> 保音高
        source.playbackRate.value = session.rate;
        source.connect(context.destination);
        const startAt = Math.max(session.playhead, context.currentTime + 0.06);
        // 数据比实时慢时会晚于原计划起播，重锚一次进度，避免进度条跑到声音前面
        if (session.timelineStart === null || startAt > session.playhead + 0.005) {
            session.timelineStart = startAt;
            session.startOffset = audioStart;
        }
        source.start(startAt);
        session.playhead = startAt + buffer.duration / session.rate;
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
        if (session.stopped || session.paused || session.started || !session.pendingBytes) return;
        const merged = new Uint8Array(session.pendingBytes);
        let offset = 0;
        for (const part of session.pending) {
            merged.set(part, offset);
            offset += part.length;
        }
        session.pending = [];
        session.pendingBytes = 0;
        session.started = true;
        // 暂停后重排但当时还没拿到数据时，起播点要从重排位置算，不能归零
        startSource(session, merged, session.startOffset || 0);
    }

    function schedulePcm(session, bytes, audioStart) {
        // 暂停期间照常收数据，但不排时间线；继续时统一按 PCM 重排
        if (session.paused) return;
        if (!session.started) {
            session.pending.push(bytes);
            session.pendingBytes += bytes.length;
            if (session.pendingBytes < session.sampleRate * 2 * MIN_START_SECONDS) return;
            flushPending(session);
            return;
        }
        startSource(session, bytes, audioStart);
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
        const tasks = splitText(text).map(segmentText => ({ text: segmentText }));
        if (!tasks.length) return null;

        const record = beginRecord(text, { voice, rate, format });
        // 先把每段的子条目建出来：合成期间就能逐段看到「待合成/合成中/完成」，
        // 也保证列表顺序与最终 WAV 的拼接顺序一致
        for (const task of tasks) task.segment = createSegment(record, task.text);
        refreshSegmentControls(record);
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
            startOffset: 0,
            receivedSeconds: 0,
            rate: 1,
            paused: false,
            pausedOffset: 0,
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
            const promise = requestSegment(piece.text);
            promise.catch(() => {});
            prefetch = { piece, promise };
        };
        const takePrefetch = piece => {
            if (prefetch && prefetch.piece === piece) {
                const { promise } = prefetch;
                prefetch = null;
                return promise;
            }
            return requestSegment(piece.text);
        };

        const consume = async (response, piece) => {
            const reader = response.body.getReader();
            const segment = piece.segment;
            let leftover = new Uint8Array(0);
            setSegmentState(record, segment, 'active');
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
                        segment.chunks.push(part);
                        segment.bytes += evenLength;
                        record.bytes += evenLength;
                        schedulePcm(session, part, session.receivedSeconds);
                        session.receivedSeconds += evenLength / 2 / session.sampleRate;
                        // 合成中的段也持续显示已拿到的时长，作为这一段自己的进度
                        segment.durationEl.textContent = `${formatSegmentDuration(segment.bytes / 2 / session.sampleRate)}…`;
                    }
                    leftover = data.subarray(evenLength);
                }
            } finally {
                // 一收到就解锁这一段的播放，不用等整条合成结束
                if (segment.bytes) setSegmentState(record, segment, 'done');
                else setSegmentState(record, segment, 'pending');
            }
            // 整段比预缓冲还短时也要起播，不能一直攒着
            flushPending(session);
        };

        const speak = async piece => {
            const segment = piece.segment;
            const bytesBefore = segment.bytes;
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
                    if (segment.bytes > bytesBefore) return 'done';
                }
            }
            // 已经收到过一部分数据就把这半段当作完成，避免重复播放开头
            if (segment.bytes > bytesBefore) return 'done';
            const halves = splitInHalf(piece.text);
            if (!halves) {
                setSegmentState(record, segment, 'failed');
                return 'failed';
            }
            // 失败的长句拆成两半再排到队首：原条目留给前半，后半紧插在它后面，
            // 保证列表顺序、请求顺序与 WAV 拼接顺序一致
            setSegmentLabel(segment, halves[0]);
            setSegmentState(record, segment, 'pending');
            const second = createSegment(record, halves[1], segment);
            tasks.unshift({ text: halves[0], segment }, { text: halves[1], segment: second });
            session.total += halves.length - 1;
            updateProgress(record, session.done, session.total);
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
            if (record.state === 'playing' || record.state === 'paused') {
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
