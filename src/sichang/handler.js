// 思畅 AI 的「朗读」请求 POST /api/tts，拿回 24kHz 单声道 PCM16 流由页面边下边播。
// 这里直接接管这个请求：官方不会再整段合成，而是按句子分批请求、边下边播；
// 每段的 PCM 同时累积起来拼成一条 WAV，供面板下载。
// 面板以分段为播放单位：点哪段就从哪段开始顺序播放，播到谁谁展开控制面板。
// 分段是为了长文本更稳：整段失败就什么都没了，分段后单段失败还能重试或再拆开。

import {
    TTS_PATH,
    PANEL_ID,
    DEFAULT_SAMPLE_RATE,
    MAX_RECORDS,
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
} from './constants.js';
import { VOICE_GROUPS, VOICE_LABELS, DEFAULT_VOICE } from './voices.js';
import { PANEL_CSS } from './styles.js';
import { pcmToWav, pcmToSamples, joinedPcm } from './audio.js';
import {
    formatDuration,
    formatRate,
    formatSegmentDuration,
    previewText,
    splitText,
    splitInHalf,
} from './text.js';
import { createRegenerator } from './regenerate.js';

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
        body: panel.querySelector('.body'),
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



// 剪贴板 API 在非安全上下文或权限被拒时不可用，退回临时 textarea
function copyRecordText(text, button, idle = '复制') {
    const done = () => {
        button.textContent = '已复制';
        clearTimeout(button.copyTimer);
        button.copyTimer = setTimeout(() => {
            button.textContent = idle;
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
        closeMenus();
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
        closeMenus();
        if (!manualPosition) {
            placePanel();
            return;
        }
        const rect = ui.host.getBoundingClientRect();
        applyPosition(clampPosition(rect.left, rect.top));
    };
    window.addEventListener('resize', onResize);
    const records = [];
    const selection = { record: null, segment: null };
    let activeAudio = null;
    // 输入框里是否有用户尚未提交的手动改动：播放自动跟随遇到它就停下，不覆盖草稿
    let inputTyping = false;
    let activeSession = null;
    let activeTimeline = null;
    let audioContext = null;
    let playRate = 1;

    // 「更多」菜单同一时间只开一个；菜单挂在 shadow root 上，避免被面板滚动区裁掉
    function closeMenus(keep) {
        for (const record of records) {
            if (!record.menu || record.menu === keep || record.menu.hidden) continue;
            hideMenu(record);
        }
    }
    function hideMenu(record) {
        record.menu.hidden = true;
        record.row.classList.remove('menuOpen');
    }
    function placeMenu(record) {
        const anchor = record.moreButton.getBoundingClientRect();
        const box = record.menu.getBoundingClientRect();
        const margin = 6;
        let left = anchor.right - box.width;
        let top = anchor.bottom + 3;
        // 下方放不下就翻到按钮上方；水平靠右对齐，再夹在视口内
        if (top + box.height > window.innerHeight - margin) top = anchor.top - box.height - 3;
        left = Math.max(margin, Math.min(window.innerWidth - box.width - margin, left));
        top = Math.max(margin, Math.min(window.innerHeight - box.height - margin, top));
        record.menu.style.left = `${Math.round(left)}px`;
        record.menu.style.top = `${Math.round(top)}px`;
    }
    function openMenu(record) {
        closeMenus(record.menu);
        record.menu.hidden = false;
        record.row.classList.add('menuOpen');
        placeMenu(record);
    }
    function toggleMenu(record) {
        if (record.menu.hidden) openMenu(record);
        else hideMenu(record);
    }
    // 选中整条或某一段时，把对应文本放进输入框；再次点同一条不覆盖正在编辑的内容
    function applySelection(record, segment) {
        selection.record = record;
        selection.segment = segment;
        for (const item of records) {
            item.row.classList.toggle('selected', item === record);
            for (const part of item.segments) {
                const chosen = Boolean(segment && part === segment);
                part.row.classList.toggle('selected', chosen);
            }
        }
        updateComposeMeta();
    }
    function selectRecord(record) {
        if (selection.record === record && !selection.segment) return;
        applySelection(record, null);
        setInputText(record.text || '');
    }
    function selectSegment(record, segment) {
        if (selection.record === record && selection.segment === segment) return;
        applySelection(record, segment);
        setInputText(segment.text || '');
    }
    // 播放到哪段就把哪段文本填进输入框，选中状态一起跟着走，重生成也就能直接用这段文字。
    // 输入框正被编辑或存着用户未提交的改动时让位，避免每换一段就冲掉正在写的内容
    function mirrorPlayingText(record, segment) {
        if (!segment || !String(segment.text || '').trim()) return;
        if (selection.record === record && selection.segment === segment) return;
        if (inputTyping || ui.input.getRootNode().activeElement === ui.input) return;
        applySelection(record, segment);
        setInputText(segment.text);
    }
    const onDocumentPointerDown = event => {
        const path = event.composedPath();
        for (const record of records) {
            if (!record.menu || record.menu.hidden) continue;
            if (path.includes(record.menu) || path.includes(record.moreButton)) continue;
            hideMenu(record);
        }
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    const onWindowScroll = () => closeMenus();
    window.addEventListener('scroll', onWindowScroll, true);
    ui.body.addEventListener('scroll', onWindowScroll, { passive: true });
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
        // 正在播放的分段立即换速；实时时间线按当前位置重排
        for (const record of records) {
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
            // 切到分段播放后时间线保持暂停，换速只影响分段 <audio>，不再重排时间线
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

    // 主条目的播放按钮：有队列就暂停/继续队列，否则从第一段开始顺序播放
    function recordIsPlaying(record) {
        const current = record.chain?.segment;
        if (current?.audio && !current.audio.paused) return true;
        if (record.chain?.waitingFor) return false;
        if (record.state === 'playing') return true;
        if (record.state === 'capturing') return Boolean(record.session && !record.session.paused);
        return false;
    }

    function syncRecordPlayButton(record) {
        const button = record?.playButton;
        if (!button) return;
        const waiting = Boolean(record.chain?.waitingFor);
        const playing = recordIsPlaying(record);
        const liveReady = record.state === 'playing'
            || record.state === 'paused'
            || (record.state === 'capturing' && Boolean(record.session));
        const chainReady = Boolean(record.chain);
        const segmentReady = record.segments.some(segment => segment.complete && segment.bytes && !segment.busy);
        button.disabled = record.state === 'failed' || waiting || (!liveReady && !chainReady && !segmentReady);
        if (waiting) {
            button.textContent = '▶';
            button.classList.remove('playing');
            button.title = '等待下一段';
            button.setAttribute('aria-label', '等待下一段');
            button.setAttribute('aria-pressed', 'false');
            return;
        }
        button.textContent = playing ? '⏸' : '▶';
        button.classList.toggle('playing', playing);
        button.title = playing ? '暂停整条' : '播放整条';
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-pressed', playing ? 'true' : 'false');
    }

    // 记录头「整条重生成」：只做原地重合成，不允许和逐段重生成同时跑
    function syncRecordRegenButton(record) {
        const button = record.regenAllButton;
        if (!button) return;
        const allowed = record.state === 'ready' || record.state === 'playing' || record.state === 'paused';
        const hasText = record.segments.some(segment => String(segment.text || '').trim());
        button.disabled = !allowed || record.regenerating || !hasText;
        button.classList.toggle('busy', Boolean(record.regeneratingAll));
        button.title = record.regeneratingAll ? '正在重生成整条' : '重生成整条（逐段复用）';
        button.setAttribute('aria-label', button.title);
    }

    function toggleRecordPlayback(record) {
        if (record.state === 'failed') return;
        if (record.chain) {
            const current = record.chain.segment;
            if (current?.audio && !current.audio.paused) {
                pauseChain(record);
                return;
            }
            if (current?.audio) {
                resumeChain(record);
                return;
            }
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
        if (record.state === 'capturing') {
            const session = record.session;
            if (!session) return;
            if (session.paused) resumeLiveCapture(record);
            else pauseLiveCapture(record);
            return;
        }
        const first = record.segments.find(segment => segment.complete && segment.bytes && !segment.busy);
        if (first) playChainSegment(record, first);
    }

    // 实时时间线播完后，声音归还给下一段；停止时只复位时间线，不影响顺序播放队列
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
        record.duration.textContent = formatDuration(record.seconds);
        record.autoSegment = null;
        if (record.expandedSegment?.mode === 'live') closeSegmentPanel(record, record.expandedSegment);
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

    // 播到哪一段就展开哪一段；用户手动点开别的分段时，不强行抢回来
    function showLiveSegment(record, session, position) {
        const info = segmentAt(record, position);
        if (!info || !info.segment.bytes) return;
        const { segment, start, duration } = info;
        if (record.autoSegment !== segment) {
            record.autoSegment = segment;
            openSegmentPanel(record, segment, 'live');
            mirrorPlayingText(record, segment);
        } else if (record.expandedSegment === segment && segment.mode === 'live') {
            updateSegmentTime(record, segment, position - start, duration);
            syncSegmentPanel(record, segment);
        }
    }

    function startTimelineTicker(record, session) {
        clearInterval(record.timelineTicker);
        const tick = () => {
            if (record.state !== 'playing' && record.state !== 'capturing') return;
            if (session.paused) return;
            showLiveSegment(record, session, livePosition(session));
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
        if (record.expandedSegment?.mode === 'live') syncSegmentPanel(record, record.expandedSegment);
        syncRecordPlayButton(record);
    }

    function resumeTimeline(record) {
        const session = record.session;
        if (!session || record.state !== 'paused') return;
        // 继续时间线前先停掉分段播放，避免两路声音叠在一起
        stopActive();
        session.paused = false;
        const offset = Math.min(session.pausedOffset || 0, session.receivedSeconds);
        session.pausedOffset = offset;
        rescheduleTimeline(record, offset);
        record.state = 'playing';
        record.autoSegment = null;
        startTimelineTicker(record, session);
        armTimelineEnd(record);
        syncRecordPlayButton(record);
    }

    // 合成中改用分段顺序播放：实时时间线只停在当前位置，不中止合成、不改变捕获状态
    function pauseLiveCapture(record) {
        const session = record.session;
        if (!session || session.stopped || session.paused) return;
        session.pausedOffset = livePosition(session);
        session.paused = true;
        stopSources(session);
        clearInterval(record.timelineTicker);
        record.timelineTicker = null;
        syncRecordPlayButton(record);
    }

    function resumeLiveCapture(record) {
        const session = record.session;
        if (!session || session.stopped || !session.paused || record.state !== 'capturing') return;
        session.paused = false;
        const offset = Math.min(session.pausedOffset || 0, session.receivedSeconds);
        session.pausedOffset = offset;
        record.autoSegment = null;
        rescheduleTimeline(record, offset);
        startTimelineTicker(record, session);
        syncRecordPlayButton(record);
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
        showLiveSegment(record, session, position);
    }

    function removeRecord(record) {
        const index = records.indexOf(record);
        if (index >= 0) records.splice(index, 1);
        if (selection.record === record) applySelection(null, null);
        stopChain(record);
        if (activeTimeline === record) activeTimeline = null;
        clearTimeout(record.timelineTimer);
        clearInterval(record.timelineTicker);
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
        record.menu?.remove();
        record.row.remove();
        updateCount();
    }

    // 记录头只做收纳：时间、时长/合成进度、段数、整条播放和单段重生成入口。
    // 每段播放与控制挂在分段子条目上
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
            sampleRate: DEFAULT_SAMPLE_RATE,
            chain: null,
            expandedSegment: null,
            autoSegment: null,
        };

        const row = document.createElement('div');
        row.className = 'item';
        row.setAttribute('data-live', '');

        const head = document.createElement('div');
        head.className = 'itemHead';
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = new Date(record.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const duration = document.createElement('span');
        duration.className = 'dur';
        duration.textContent = '捕获中';
        const spacer = document.createElement('span');
        spacer.className = 'spacer';
        const segCount = document.createElement('span');
        segCount.className = 'segCount';
        segCount.textContent = '0 段';
        const playButton = document.createElement('button');
        playButton.className = 'itemPlay';
        playButton.textContent = '▶';
        playButton.title = '播放整条';
        playButton.setAttribute('aria-label', '播放整条');
        playButton.disabled = true;
        // 整条重生成：复用逐段重生成，原地替换所有分段，不再新建记录
        const regenAllButton = document.createElement('button');
        regenAllButton.className = 'itemRegen';
        regenAllButton.textContent = '↻';
        regenAllButton.title = '重生成整条（逐段复用）';
        regenAllButton.setAttribute('aria-label', '重生成整条');
        regenAllButton.disabled = true;
        const moreButton = document.createElement('button');
        moreButton.className = 'more';
        moreButton.textContent = '⋯';
        moreButton.setAttribute('aria-label', '更多操作');

        const menu = document.createElement('div');
        menu.className = 'menu';
        menu.hidden = true;
        const menuInfo = document.createElement('div');
        menuInfo.className = 'menuInfo';
        // 音色和语速只在这里露出，记录头保持精简
        menuInfo.textContent = `${VOICE_LABELS.get(tts.voice) || tts.voice || '默认音色'} · ${formatRate(tts.rate)}`;
        const copyButton = document.createElement('button');
        copyButton.textContent = '复制原文';
        const downloadButton = document.createElement('button');
        downloadButton.textContent = '下载 WAV';
        downloadButton.disabled = true;
        const deleteButton = document.createElement('button');
        deleteButton.className = 'danger';
        deleteButton.textContent = '删除';
        menu.append(menuInfo, copyButton, downloadButton, deleteButton);
        head.append(meta, duration, spacer, segCount, playButton, regenAllButton, moreButton);
        // 挂到 shadow root 而不是面板内，菜单才能盖出滚动区
        ui.panel.getRootNode().appendChild(menu);

        const txt = document.createElement('div');
        txt.className = 'txt';
        const preview = previewText(text) || '（无文本）';
        txt.textContent = preview;
        txt.title = '点击选中整条文本';

        const segList = document.createElement('div');
        segList.className = 'segList';

        row.append(head, txt, segList);
        ui.list.insertBefore(row, ui.list.firstChild);

        Object.assign(record, {
            row, head, txt, duration, segCount, playButton, regenAllButton,
            moreButton, menu, downloadButton, segList,
        });

        playButton.addEventListener('click', event => {
            event.stopPropagation();
            toggleRecordPlayback(record);
        });
        regenAllButton.addEventListener('click', event => {
            event.stopPropagation();
            regenerateRecord(record);
        });
        moreButton.addEventListener('click', event => {
            event.stopPropagation();
            toggleMenu(record);
        });
        for (const button of [copyButton, downloadButton, deleteButton]) {
            button.addEventListener('click', () => hideMenu(record));
        }
        copyButton.addEventListener('click', () => copyRecordText(record.text, copyButton, '复制原文'));
        downloadButton.addEventListener('click', () => downloadRecord(record));
        deleteButton.addEventListener('click', () => removeRecord(record));
        // 点记录头或摘要都算选中整条；分段区域有自己的选中逻辑
        row.addEventListener('click', event => {
            if (event.target.closest('.segBox, button')) return;
            selectRecord(record);
        });

        records.push(record);
        while (records.length > MAX_RECORDS) removeRecord(records[0]);
        updateCount();
        return record;
    }

    function downloadRecord(record) {
        if (!record.url) return;
        const link = document.createElement('a');
        link.href = record.url;
        link.download = `sichang-tts-${new Date(record.time).toISOString().replace(/[:.]/g, '-')}.wav`;
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    function downloadSegment(record, segment) {
        if (!segment.bytes) return;
        const link = document.createElement('a');
        link.href = ensureSegmentUrl(record, segment);
        const stamp = new Date(record.time).toISOString().replace(/[:.]/g, '-');
        link.download = `sichang-tts-${stamp}-seg${segmentIndex(record, segment) + 1}.wav`;
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    function sampleRateOf(record) {
        return record.sampleRate || DEFAULT_SAMPLE_RATE;
    }

    function segmentIndex(record, segment) {
        return record.segments.indexOf(segment);
    }

    // 每段自己的「重生成」图标：合成中、播放/暂停中都能重生成已完成段
    function syncSegmentRegenButton(record, segment) {
        const button = segment.regenButton;
        if (!button) return;
        const index = segmentIndex(record, segment) + 1;
        const allowed = record.state === 'ready' || record.state === 'playing'
            || record.state === 'paused' || record.state === 'capturing';
        button.disabled = !allowed || record.regenerating || segment.busy
            || !segment.complete || !segment.bytes;
        // 失败/空文本的短暂反馈优先显示，不要被中途的刷新覆盖
        if (button.classList.contains('failed')) return;
        button.textContent = '↻';
        button.classList.toggle('busy', Boolean(record.regenerating && segment.busy));
        if (record.regenerating && segment.busy) {
            button.title = `正在重生成第 ${index} 段`;
        } else if (selection.record === record && selection.segment === segment) {
            button.title = `按输入框里的文本重生成第 ${index} 段`;
        } else {
            button.title = `重生成第 ${index} 段`;
        }
        button.setAttribute('aria-label', button.title);
    }

    function flashSegmentRegenButton(segment, message) {
        const button = segment.regenButton;
        if (!button) return;
        button.textContent = '!';
        button.title = message;
        button.setAttribute('aria-label', message);
        button.classList.add('failed');
        button.classList.remove('busy');
        clearTimeout(button.flashTimer);
        button.flashTimer = setTimeout(() => {
            button.classList.remove('failed');
            refreshSegmentControls(segment.record);
        }, 1500);
    }

    // 分段顺序就是播放顺序；把累计字节约成秒数，用来判断当前播到哪一段
    function segmentSpans(record) {
        const starts = [];
        let total = 0;
        const sampleRate = sampleRateOf(record);
        for (const segment of record.segments) {
            starts.push(total);
            total += segment.bytes / 2 / sampleRate;
        }
        return { starts, total };
    }

    function segmentAt(record, seconds) {
        const { starts } = segmentSpans(record);
        let index = -1;
        for (let i = 0; i < record.segments.length; i++) {
            // 尾部还没收到数据的段起点相同，不能把它们当成当前段
            if (!record.segments[i].bytes) break;
            if (seconds >= starts[i]) index = i;
            else break;
        }
        const segment = record.segments[index];
        if (!segment || !segment.bytes) return null;
        return {
            segment,
            start: starts[index],
            duration: segment.bytes / 2 / sampleRateOf(record),
        };
    }

    function updateSegmentTime(record, segment, current, duration) {
        if (!Number.isFinite(duration) || duration <= 0) {
            segment.timeEl.textContent = '0:00 / 0:00';
            segment.fill.style.width = '0%';
            return;
        }
        const ratio = Math.min(1, Math.max(0, current / duration));
        segment.fill.style.width = `${ratio * 100}%`;
        segment.timeEl.textContent = `${formatSegmentDuration(current)} / ${formatSegmentDuration(duration)}`;
    }

    function idleSegmentTime(record, segment) {
        if (segment.audio && !segment.audio.paused) return;
        updateSegmentTime(record, segment, 0, segment.bytes / 2 / sampleRateOf(record));
    }

    // 分段按钮的可用性只看这一段自己的状态：一完成就能点，不必等整条合成结束。
    // 重生成只锁目标段（busy）；其他段 PCM 独立，仍可照常播放
    function refreshSegmentControls(record) {
        const playable = record.state !== 'failed';
        for (const segment of record.segments) {
            segment.playButton.disabled = !playable || segment.busy || !segment.complete || !segment.bytes;
            syncSegmentRegenButton(record, segment);
            segment.copyButton.disabled = !segment.text;
            segment.downloadButton.disabled = !segment.bytes || segment.busy;
            if (record.expandedSegment === segment) syncSegmentPanel(record, segment);
        }
        // 整条 WAV 在重生成期间还是旧的，下载先锁住，避免拿到过期文件
        record.downloadButton.disabled = Boolean(record.regenerating) || !record.url;
        syncRecordPlayButton(record);
        syncRecordRegenButton(record);
    }

    function setSegmentLabel(segment, text) {
        segment.text = text;
        segment.label.textContent = previewText(text).slice(0, 24) || '（无文本）';
        segment.label.title = text;
    }

    // 某段文本被改过后，整条摘要、复制原文和「重新合成」都要跟着用新文本
    function refreshRecordText(record) {
        record.text = record.segments.map(segment => segment.text || '').join('');
        record.txt.textContent = previewText(record.text) || '（无文本）';
        record.txt.title = '点击选中整条文本';
    }

    // 每段的状态直接写进子条目：待合成 → 合成中（时长随数据增长）→ 完成/失败
    function setSegmentState(record, segment, state) {
        segment.status = state;
        segment.complete = state === 'done';
        segment.row.dataset.state = state;
        const seconds = segment.bytes / 2 / sampleRateOf(record);
        if (state === 'pending') segment.durationEl.textContent = '待合成';
        else if (state === 'active') segment.durationEl.textContent = `${formatSegmentDuration(seconds)}…`;
        else if (state === 'done') segment.durationEl.textContent = formatSegmentDuration(seconds);
        else if (state === 'failed') segment.durationEl.textContent = '失败';
        else segment.durationEl.textContent = '未合成';
        idleSegmentTime(record, segment);
        refreshSegmentControls(record);
        // 顺序播放正停在上一段等这一段：一完成就自动接上
        if (record.chain?.waitingFor === segment) {
            if (state === 'done') playChainSegment(record, segment);
            else if (state === 'failed' || state === 'skipped') advanceChain(record, segmentIndex(record, segment));
        }
    }

    function renumberSegments(record) {
        record.segments.forEach((segment, index) => {
            segment.idx.textContent = String(index + 1);
        });
        record.segCount.textContent = `${record.segments.length} 段`;
    }

    // 点击分段行时决定打开哪种面板：顺序播放中的段用分段控制，
    // 实时时间线正在播/暂停在当前段时回到时间线控制，其余按普通分段面板打开
    function panelModeFor(record, segment) {
        if (record.chain?.segment === segment) return 'segment';
        const live = record.state === 'playing' || record.state === 'paused' || record.state === 'capturing';
        if (live && record.autoSegment === segment) return 'live';
        return 'local';
    }

    // 同一时刻只展开一个分段面板。自动跟随播放位置，手动点开则停在用户选中的那一段
    function openSegmentPanel(record, segment, mode) {
        const switching = record.expandedSegment !== segment;
        if (switching && record.expandedSegment) closeSegmentPanel(record, record.expandedSegment);
        record.expandedSegment = segment;
        if (mode) segment.mode = mode;
        segment.box.classList.add('expanded');
        segment.row.dataset.active = 'true';
        segment.row.setAttribute('aria-expanded', 'true');
        // 暂停后收起再打开，进度条要回到暂停位置，而不是显示 0
        if (segment.mode !== 'live' && segment.audio && Number.isFinite(segment.audio.duration) && segment.audio.duration) {
            updateSegmentTime(record, segment, segment.audio.currentTime, segment.audio.duration);
        }
        if (switching) keepSegmentVisible(segment);
        syncSegmentPanel(record, segment);
    }

    function closeSegmentPanel(record, segment) {
        if (!segment) return;
        segment.box.classList.remove('expanded');
        segment.row.removeAttribute('data-active');
        segment.row.setAttribute('aria-expanded', 'false');
        updateSegmentTime(record, segment, 0, segment.bytes / 2 / sampleRateOf(record));
        if (record.expandedSegment === segment) record.expandedSegment = null;
    }

    // 让正在播放的分段留在列表可视区里，但不打断用户自己滚动
    function keepSegmentVisible(segment) {
        const body = ui.body;
        const bodyRect = body.getBoundingClientRect();
        const boxRect = segment.box.getBoundingClientRect();
        if (boxRect.top < bodyRect.top) body.scrollTop -= bodyRect.top - boxRect.top;
        else if (boxRect.bottom > bodyRect.bottom) body.scrollTop += boxRect.bottom - bodyRect.bottom;
    }

    function syncSegmentPanel(record, segment) {
        if (record.expandedSegment !== segment) return;
        const live = segment.mode === 'live';
        const capturing = live && record.state === 'capturing';
        const synthesizing = record.state === 'capturing' && Boolean(record.session);
        const paused = record.state === 'paused';
        const audio = live ? null : segment.audio;
        const playing = Boolean(audio && !audio.paused);
        const waiting = !live && record.chain?.waitingFor && record.expandedSegment === segment;
        const enabled = segment.complete && segment.bytes && !segment.busy && record.state !== 'failed';

        if (live) {
            segment.toggleButton.hidden = capturing;
            segment.toggleButton.disabled = false;
            segment.toggleButton.textContent = paused ? '继续' : '暂停';
            segment.toggleButton.classList.toggle('playing', !capturing && !paused);
            segment.stopButton.hidden = false;
            segment.stopButton.textContent = capturing ? '停止合成' : '停止';
            segment.stopButton.classList.toggle('synth', capturing);
            segment.synthButton.hidden = true;
            segment.replayButton.hidden = true;
        } else if (waiting) {
            segment.toggleButton.hidden = false;
            segment.toggleButton.disabled = true;
            segment.toggleButton.textContent = '等待下一段';
            segment.toggleButton.classList.remove('playing');
            segment.stopButton.hidden = false;
            segment.stopButton.textContent = '停止';
            segment.stopButton.classList.remove('synth');
            segment.synthButton.hidden = !synthesizing;
            segment.replayButton.hidden = false;
            segment.replayButton.disabled = !enabled;
        } else {
            segment.toggleButton.hidden = false;
            segment.toggleButton.disabled = !enabled;
            segment.toggleButton.textContent = playing ? '暂停' : audio ? '继续' : '播放';
            segment.toggleButton.classList.toggle('playing', playing);
            segment.stopButton.hidden = !audio;
            segment.stopButton.textContent = '停止';
            segment.stopButton.classList.remove('synth');
            segment.synthButton.hidden = !synthesizing;
            segment.replayButton.hidden = false;
            segment.replayButton.disabled = !enabled;
        }
        segment.copyButton.disabled = !segment.text;
        segment.downloadButton.disabled = !segment.bytes || segment.busy;
    }

    // 每段一建就占一条子条目（先显示「待合成」），合成进度与最终 WAV 顺序都按列表排列；
    // after 用于失败长句拆两半时把后半插在前半后面
    function createSegment(record, text, after) {
        const segment = {
            text,
            chunks: [],
            bytes: 0,
            busy: false,
            complete: false,
            status: 'pending',
            mode: 'segment',
            record,
        };
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
        playButton.setAttribute('aria-label', '从本段开始顺序播放');
        playButton.disabled = true;
        // 单段重生成紧挨该段的播放键，用图标避免挤占文本宽度
        const regenButton = document.createElement('button');
        regenButton.className = 'segRegen';
        regenButton.textContent = '↻';
        regenButton.title = '重生成这一段';
        regenButton.setAttribute('aria-label', '重生成这一段');
        regenButton.disabled = true;
        // 可展开的小箭头：不点播放也能发现每段自己的控制面板
        const caret = document.createElement('span');
        caret.className = 'segCaret';
        caret.textContent = '›';
        caret.setAttribute('aria-hidden', 'true');

        const panel = document.createElement('div');
        panel.className = 'segPanel';
        const bar = document.createElement('div');
        bar.className = 'segBar';
        bar.setAttribute('role', 'progressbar');
        const fill = document.createElement('div');
        fill.className = 'fill';
        bar.appendChild(fill);
        const controls = document.createElement('div');
        controls.className = 'segControls';
        const timeEl = document.createElement('span');
        timeEl.className = 'segTime';
        timeEl.textContent = '0:00 / 0:00';
        const toggleButton = document.createElement('button');
        toggleButton.className = 'segAction';
        toggleButton.textContent = '播放';
        const stopButton = document.createElement('button');
        stopButton.className = 'segAction';
        stopButton.textContent = '停止';
        stopButton.hidden = true;
        const synthButton = document.createElement('button');
        synthButton.className = 'segAction synth';
        synthButton.textContent = '停止合成';
        synthButton.hidden = true;
        const replayButton = document.createElement('button');
        replayButton.className = 'segAction';
        replayButton.textContent = '重播';
        const copyButton = document.createElement('button');
        copyButton.className = 'segAction';
        copyButton.textContent = '复制';
        const downloadButton = document.createElement('button');
        downloadButton.className = 'segAction';
        downloadButton.textContent = '下载';
        downloadButton.disabled = true;
        controls.append(timeEl, toggleButton, stopButton, synthButton, replayButton, copyButton, downloadButton);
        panel.append(bar, controls);

        row.append(idx, label, segDuration, playButton, regenButton, caret);
        box.append(row, panel);
        if (after) record.segList.insertBefore(box, after.box.nextSibling);
        else record.segList.appendChild(box);
        Object.assign(segment, {
            box, row, idx, label, durationEl: segDuration, playButton, regenButton, caret,
            panel, bar, fill, timeEl, toggleButton, stopButton, synthButton, replayButton,
            copyButton, downloadButton,
        });
        setSegmentLabel(segment, text);
        renumberSegments(record);

        row.addEventListener('click', event => {
            if (event.target.closest('button')) return;
            selectSegment(record, segment);
            if (record.expandedSegment === segment) {
                closeSegmentPanel(record, segment);
                return;
            }
            openSegmentPanel(record, segment, panelModeFor(record, segment));
        });
        playButton.addEventListener('click', () => toggleSegmentPlay(record, segment));
        regenButton.addEventListener('click', event => {
            event.stopPropagation();
            regenerateSegment(record, segment);
        });
        toggleButton.addEventListener('click', () => {
            if (segment.mode === 'live') {
                if (record.state === 'paused') resumeTimeline(record);
                else pauseTimeline(record);
                return;
            }
            if (record.chain?.segment === segment) {
                if (segment.audio && !segment.audio.paused) pauseChain(record);
                else resumeChain(record);
                return;
            }
            playChainSegment(record, segment);
        });
        stopButton.addEventListener('click', () => {
            if (segment.mode === 'live') {
                if (record.state === 'capturing') record.session?.stop();
                else stopTimeline(record);
                return;
            }
            if (record.chain) {
                stopChain(record);
                return;
            }
            if (segment.audio) {
                segment.audio.pause();
                segment.audio.currentTime = 0;
            }
            idleSegmentTime(record, segment);
            syncSegmentPlayState(segment);
        });
        // 合成中切到分段顺序播放后，实时面板会收起；这里保留整个合成的停止入口
        synthButton.addEventListener('click', () => record.session?.stop());
        replayButton.addEventListener('click', () => {
            if (!segment.complete || !segment.bytes || segment.busy) return;
            if (record.chain?.segment === segment && segment.audio) {
                segment.audio.currentTime = 0;
                if (segment.audio.paused) resumeChain(record);
                return;
            }
            playChainSegment(record, segment);
        });
        copyButton.addEventListener('click', () => copyRecordText(segment.text, copyButton, '复制'));
        downloadButton.addEventListener('click', () => downloadSegment(record, segment));
        // 分段进度条自己跳转；还没播过时按需建 audio，停在目标位置
        bar.addEventListener('click', event => {
            if (!segment.complete || !segment.bytes || segment.busy) return;
            if (record.state === 'failed') return;
            const rect = bar.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            seekSegment(record, segment, ratio);
        });
        return segment;
    }

    function seekSegment(record, segment, ratio) {
        const duration = segment.bytes / 2 / sampleRateOf(record);
        // 实时时间线按分段起点换算成整条时间线上的位置
        if (segment.mode === 'live') {
            const { starts } = segmentSpans(record);
            seekTimeline(record, starts[segmentIndex(record, segment)] + ratio * duration);
            return;
        }
        const audio = ensureSegmentAudio(record, segment);
        const seek = () => {
            if (!Number.isFinite(audio.duration) || !audio.duration) return;
            audio.currentTime = ratio * audio.duration;
            updateSegmentTime(record, segment, audio.currentTime, audio.duration);
        };
        if (audio.readyState >= 1) seek();
        else audio.addEventListener('loadedmetadata', seek, { once: true });
    }

    function syncSegmentPlayState(segment) {
        const playing = Boolean(segment.audio && !segment.audio.paused);
        segment.playButton.textContent = playing ? '⏸' : '▶';
        segment.playButton.setAttribute('aria-label', playing ? '暂停顺序播放' : '从本段开始顺序播放');
        segment.playButton.classList.toggle('playing', playing);
        if (segment.record?.expandedSegment === segment) syncSegmentPanel(segment.record, segment);
    }

    // 段的 WAV 按需生成：没点播放就不复制 PCM，避免长记录成倍占内存
    function ensureSegmentUrl(record, segment) {
        if (!segment.url) {
            const even = segment.bytes - (segment.bytes % 2);
            segment.url = URL.createObjectURL(pcmToWav(joinedPcm(segment.chunks, even), sampleRateOf(record)));
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
        idleSegmentTime(segment.record, segment);
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
            audio.addEventListener('play', () => syncRecordPlayButton(record));
            audio.addEventListener('ended', () => {
                audio.currentTime = 0;
                idleSegmentTime(record, segment);
                syncSegmentPlayState(segment);
                // 顺序播放：这一段播完就接下一段，播到谁谁展开
                if (record.chain?.segment === segment) advanceChain(record, segmentIndex(record, segment));
            });
            audio.addEventListener('timeupdate', () => {
                if (!Number.isFinite(audio.duration) || !audio.duration) return;
                updateSegmentTime(record, segment, audio.currentTime, audio.duration);
                if (record.expandedSegment === segment) syncSegmentPanel(record, segment);
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
            return;
        }
        // 点哪段就从哪段开始顺序播放；面板随播放段落切换
        playChainSegment(record, segment);
    }

    // 把这条记录从实时时间线切换到分段顺序播放。合成中只暂停声音，不中止合成
    function prepareRecordPlayback(record) {
        if (record.state === 'playing' || record.state === 'paused') stopTimeline(record);
        else if (record.state === 'capturing') pauseLiveCapture(record);
        if (activeTimeline && activeTimeline !== record) stopTimeline(activeTimeline);
        stopActive();
        stopOtherChains(record);
    }

    function playChainSegment(record, segment) {
        if (!segment || !segment.complete || !segment.bytes || segment.busy) return;
        if (!record.chain) prepareRecordPlayback(record);
        // 顺序播放只有一个当前段：换段时把上一段的位置归零，避免按钮显示「继续」却从头播
        const previous = record.chain?.segment;
        if (previous && previous !== segment && previous.audio) {
            previous.audio.pause();
            previous.audio.currentTime = 0;
            idleSegmentTime(record, previous);
            syncSegmentPlayState(previous);
        }
        stopActive();
        const audio = ensureSegmentAudio(record, segment);
        record.chain = { segment };
        record.autoSegment = segment;
        activeAudio = audio;
        openSegmentPanel(record, segment, 'segment');
        mirrorPlayingText(record, segment);
        syncRecordPlayButton(record);
        audio.play().then(
            () => { syncSegmentPlayState(segment); syncRecordPlayButton(record); },
            () => { syncSegmentPlayState(segment); syncRecordPlayButton(record); },
        );
    }

    // 当前段播完，按列表顺序找下一段；还没合成完且仍在合成，就停在等待状态
    function advanceChain(record, fromIndex) {
        if (!record.chain) return;
        for (let i = fromIndex + 1; i < record.segments.length; i++) {
            const next = record.segments[i];
            if (next.complete && next.bytes && !next.busy) {
                playChainSegment(record, next);
                return;
            }
            if (!next.complete) {
                if (record.state === 'capturing' && next.status !== 'failed' && next.status !== 'skipped') {
                    record.chain = { waitingFor: next };
                    const previous = record.segments[fromIndex];
                    if (previous) syncSegmentPanel(record, previous);
                    syncRecordPlayButton(record);
                    return;
                }
                continue;
            }
        }
        stopChain(record);
    }

    function pauseChain(record) {
        const segment = record.chain?.segment;
        if (!segment?.audio || segment.audio.paused) return;
        segment.audio.pause();
        syncRecordPlayButton(record);
    }

    function resumeChain(record) {
        const segment = record.chain?.segment;
        if (!segment?.audio) return;
        stopActive();
        activeAudio = segment.audio;
        openSegmentPanel(record, segment, 'segment');
        mirrorPlayingText(record, segment);
        syncRecordPlayButton(record);
        segment.audio.play().then(
            () => { syncSegmentPlayState(segment); syncRecordPlayButton(record); },
            () => { syncSegmentPlayState(segment); syncRecordPlayButton(record); },
        );
    }

    function stopChain(record) {
        if (!record.chain) return;
        const current = record.chain.segment || null;
        if (current?.audio) {
            if (current.audio === activeAudio) activeAudio = null;
            current.audio.pause();
            current.audio.currentTime = 0;
            idleSegmentTime(record, current);
            syncSegmentPlayState(current);
        }
        record.chain = null;
        record.autoSegment = null;
        if (record.expandedSegment?.mode !== 'live') {
            const expanded = record.expandedSegment;
            if (expanded) closeSegmentPanel(record, expanded);
        }
        syncRecordPlayButton(record);
    }

    function stopOtherChains(keep) {
        for (const record of records) {
            if (record !== keep && record.chain) stopChain(record);
        }
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

    // 重生成流程拆到 regenerate.js：这里只注入记录、播放和 UI 同步能力
    const { regenerateSegment, regenerateRecord } = createRegenerator({
        records,
        selection,
        input: ui.input,
        sampleRateOf,
        segmentIndex,
        segmentSpans,
        livePosition,
        rescheduleTimeline,
        clearSegmentAudio,
        setSegmentState,
        setSegmentLabel,
        refreshRecordText,
        rebuildRecord,
        refreshSegmentControls,
        stopTimeline,
        stopChain,
        openSegmentPanel,
        playChainSegment,
        flashSegmentRegenButton,
    });

    function updateProgress(record, done, total) {
        if (!records.includes(record)) return;
        record.duration.textContent = total > 1 ? `${done}/${total}` : '合成中';
    }

    function markFailed(record) {
        if (!records.includes(record)) return;
        clearInterval(record.timelineTicker);
        record.timelineTicker = null;
        stopChain(record);
        record.state = 'failed';
        record.session = null;
        record.row.removeAttribute('data-live');
        record.duration.textContent = '失败';
        record.downloadButton.disabled = true;
        if (record.expandedSegment) closeSegmentPanel(record, record.expandedSegment);
        record.autoSegment = null;
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
        clearInterval(record.timelineTicker);
        record.timelineTicker = null;
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
        record.duration.textContent = formatDuration(record.seconds);
        record.downloadButton.disabled = false;
        // 停止或失败时还没轮到的段标成「未合成」，已收到部分数据的段照常可播。
        // 顺序播放正等着的段也会在这里一完成就接上
        for (const segment of record.segments) {
            if (segment.status === 'pending' || segment.status === 'active') {
                setSegmentState(record, segment, segment.bytes ? 'done' : 'skipped');
            }
        }
        refreshSegmentControls(record);

        // 数据下完了，但实时时间线还在播：可能还要播几分钟，控制面板留在正在播放的分段上
        if (session && !session.stopped && session.paused === false && session.sources.length && session.playhead > session.context.currentTime + 0.05) {
            if (activeTimeline && activeTimeline !== record) stopTimeline(activeTimeline);
            record.state = 'playing';
            record.session = session;
            activeTimeline = record;
            startTimelineTicker(record, session);
            armTimelineEnd(record);
        } else {
            if (record.expandedSegment?.mode === 'live') closeSegmentPanel(record, record.expandedSegment);
            record.autoSegment = null;
        }
        syncRecordPlayButton(record);
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
        if (isDefault) inputTyping = false;
        ui.input.classList.toggle('is-default', isDefault);
    }

    function saveDraft() {
        try {
            localStorage.setItem(DRAFT_STORE_KEY, inputIsDefault ? '' : ui.input.value);
        } catch {}
    }

    // 选中整条/分段后把文本写进输入框，走和手动输入相同的统计与草稿逻辑
    function setInputText(text) {
        ui.input.value = text;
        inputTyping = false;
        setInputDefault(false);
        autoGrowInput();
        updateComposeMeta();
        saveDraft();
    }

    // 字数和分段数就是这次会发出的请求数，提前给个心理预期；
    // 选中记录或分段时再补一个来源提示，说明「重生成」会用这里的文本
    function updateComposeMeta() {
        const text = ui.input.value.trim();
        const chars = text.replace(/\s/g, '').length;
        const segments = splitText(text).length;
        let hint = '';
        if (selection.record) {
            if (selection.segment) {
                const index = selection.record.segments.indexOf(selection.segment);
                if (index >= 0) hint = ` · 编辑第 ${index + 1} 段`;
            } else {
                hint = ' · 整条';
            }
        }
        ui.stats.textContent = `${chars} 字 · ${segments} 段${hint}`;
        ui.go.disabled = !text;
    }

    function onInputChange() {
        autoGrowInput();
        updateComposeMeta();
        saveDraft();
    }
    ui.input.addEventListener('input', () => {
        inputTyping = true;
        setInputDefault(false);
        onInputChange();
    });
    // 聚焦即进入编辑：清掉预填的试听文本，让用户从空框开始打
    ui.input.addEventListener('focus', () => {
        if (!inputIsDefault) return;
        ui.input.value = '';
        inputTyping = false;
        setInputDefault(false);
        autoGrowInput();
        updateComposeMeta();
    });
    // 失焦后仍为空就恢复预填，保证空框里始终有段试听文本；
    // 正在编辑选中记录/分段时保持空框，不能把试听文本塞进重生成请求
    ui.input.addEventListener('blur', () => {
        if (selection.record) return;
        if (ui.input.value.trim()) return;
        ui.input.value = DEFAULT_INPUT_TEXT;
        setInputDefault(true);
        autoGrowInput();
        updateComposeMeta();
        saveDraft();
    });
    ui.clearInput.addEventListener('click', () => {
        ui.input.value = '';
        inputTyping = false;
        setInputDefault(false);
        applySelection(null, null);
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
        // 不清空输入：换音色后可以直接再点合成，反复试听。
        // 这段文本是用户刚写的，标记成手输内容，实时播放跟随不能覆盖它
        inputTyping = true;
        startSession({ text, voice, rate, format: 'pcm16' });
    }

    ui.go.addEventListener('click', submitCompose);
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
        // 实时播放只能用 Web Audio 变速（会连音高一起变）；分段 WAV 走 <audio> 保音高
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
        // 官方朗读和面板播放互斥，避免两路声音叠在一起
        stopActive();
        stopOtherChains(null);
        const tasks = splitText(text).map(segmentText => ({ text: segmentText }));
        if (!tasks.length) return null;

        const record = beginRecord(text, { voice, rate, format });
        // 开始新的合成后，输入框不再承担某一段的编辑目标
        applySelection(null, null);
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
        // 合成一开始就盯住实时播放位置，播到哪段就展开哪段
        startTimelineTicker(record, session);
        syncRecordPlayButton(record);

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
        document.removeEventListener('pointerdown', onDocumentPointerDown, true);
        window.removeEventListener('scroll', onWindowScroll, true);
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
