// 分段视图与状态：时长时间、状态文案、展开面板、按钮可用性。
// 记录级播放/合成流程通过 host 注入的回调完成，这里只负责把状态映射到 DOM。
import { DEFAULT_SAMPLE_RATE } from './constants.js';
import { formatSegmentDuration, previewText } from './text.js';
import { VOICE_LABELS, voiceName } from './voices.js';

// 分段控制按钮的字形统一放这里，文字说明由 title/aria-label 承担
export const SEGMENT_ICONS = {
    play: '▶',
    pause: '⏸',
    stop: '■',
    replay: '↺',
    synthStop: '✕',
    waiting: '…',
};

export function createSegments(host) {
    const { ui } = host;

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
        } else if (host.selection.record === record && host.selection.segment === segment) {
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
        for (const segment of record.segments) {
            syncSegmentRegenButton(record, segment);
            if (segment.deleteButton) segment.deleteButton.disabled = Boolean(record.regenerating) || segment.busy;
            // 播放/停止按钮在分段行里常驻，每次刷新都要同步，不能只在展开时更新
            syncSegmentButtons(record, segment);
        }
        // 整条 WAV 在重生成期间还是旧的，下载先锁住，避免拿到过期文件
        record.downloadButton.disabled = Boolean(record.regenerating) || !record.url;
        host.syncRecordPlayButton(record);
        host.syncRecordRegenButton(record);
    }

    function setSegmentLabel(segment, text) {
        segment.text = text;
        segment.label.textContent = previewText(text).slice(0, 24) || '（无文本）';
        segment.label.title = text;
    }

    // 记录这一段实际使用的音色；locked 表示请求已经发出，之后切换音色不再改它
    function setSegmentVoice(segment, voice, locked = false) {
        segment.voice = voice;
        if (locked) segment.voiceLocked = true;
        segment.voiceEl.textContent = voiceName(voice);
        segment.voiceEl.title = `音色：${VOICE_LABELS.get(voice) || voice || '默认音色'}`;
    }

    // 某段文本被改过后，整条摘要、复制原文和「重新合成」都要跟着用新文本
    function refreshRecordText(record) {
        record.text = record.segments.map(segment => segment.text || '').join('');
        record.txt.textContent = previewText(record.text) || '（无文本）';
        record.txt.title = '点击选中整条并收起/展开分段';
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
            if (state === 'done') host.playChainSegment(record, segment);
            else if (state === 'failed' || state === 'skipped') host.advanceChain(record, segmentIndex(record, segment));
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
        syncSegmentButtons(record, segment);
    }

    function closeSegmentPanel(record, segment) {
        if (!segment) return;
        segment.box.classList.remove('expanded');
        segment.row.removeAttribute('data-active');
        segment.row.setAttribute('aria-expanded', 'false');
        updateSegmentTime(record, segment, 0, segment.bytes / 2 / sampleRateOf(record));
        if (record.expandedSegment === segment) record.expandedSegment = null;
    }

    // 让正在播放的分段留在列表可视区里，但不打断用户自己滚动。
    // 记录被折叠时分段没有布局尺寸，跳过，避免把面板滚到看不见的位置
    function keepSegmentVisible(segment) {
        if (!segment.box.getClientRects().length) return;
        const body = ui.body;
        const bodyRect = body.getBoundingClientRect();
        const boxRect = segment.box.getBoundingClientRect();
        if (boxRect.top < bodyRect.top) body.scrollTop -= bodyRect.top - boxRect.top;
        else if (boxRect.bottom > bodyRect.bottom) body.scrollTop += boxRect.bottom - bodyRect.bottom;
    }

    // 分段行和展开面板共用这批按钮：播放/暂停和停止在行里，重播/停止合成在面板里。
    // 行内按钮不依赖面板展开，所以这里按当前播放模式直接刷新，不做展开判断
    function syncSegmentButtons(record, segment) {
        const live = panelModeFor(record, segment) === 'live';
        const capturing = live && record.state === 'capturing';
        const synthesizing = record.state === 'capturing' && Boolean(record.session);
        const paused = record.state === 'paused';
        const audio = live ? null : segment.audio;
        const playing = Boolean(audio && !audio.paused);
        const waiting = !live && record.chain?.waitingFor === segment;
        const enabled = record.state !== 'failed' && segment.complete && segment.bytes && !segment.busy;

        if (live) {
            segment.toggleButton.hidden = capturing;
            segment.toggleButton.disabled = false;
            setAction(segment.toggleButton, paused ? SEGMENT_ICONS.play : SEGMENT_ICONS.pause,
                paused ? '继续播放' : '暂停播放');
            segment.toggleButton.classList.toggle('playing', !capturing && !paused);
            // 生成中的分段不再保留「停止合成」入口：要跳过这一段直接删它
            segment.stopButton.hidden = capturing;
            setAction(segment.stopButton, SEGMENT_ICONS.stop, capturing ? '停止合成' : '停止播放');
            segment.stopButton.classList.toggle('synth', capturing);
            segment.synthButton.hidden = true;
            segment.replayButton.hidden = true;
        } else if (waiting) {
            segment.toggleButton.hidden = false;
            segment.toggleButton.disabled = true;
            setAction(segment.toggleButton, SEGMENT_ICONS.waiting, '等待下一段');
            segment.toggleButton.classList.remove('playing');
            segment.stopButton.hidden = false;
            setAction(segment.stopButton, SEGMENT_ICONS.stop, '停止播放');
            segment.stopButton.classList.remove('synth');
            segment.synthButton.hidden = !synthesizing;
            segment.replayButton.hidden = false;
            segment.replayButton.disabled = !enabled;
        } else {
            segment.toggleButton.hidden = false;
            segment.toggleButton.disabled = !enabled;
            setAction(segment.toggleButton, playing ? SEGMENT_ICONS.pause : SEGMENT_ICONS.play,
                playing ? '暂停播放' : audio ? '继续播放' : '播放本段');
            segment.toggleButton.classList.toggle('playing', playing);
            segment.stopButton.hidden = !audio;
            setAction(segment.stopButton, SEGMENT_ICONS.stop, '停止播放');
            segment.stopButton.classList.remove('synth');
            segment.synthButton.hidden = !synthesizing;
            segment.replayButton.hidden = false;
            segment.replayButton.disabled = !enabled;
        }
    }

    function setAction(button, icon, label) {
        button.textContent = icon;
        button.title = label;
        button.setAttribute('aria-label', label);
    }

    function syncSegmentPlayState(segment) {
        if (segment.record) syncSegmentButtons(segment.record, segment);
    }

    return {
        api: {
            sampleRateOf,
            segmentIndex,
            syncSegmentRegenButton,
            flashSegmentRegenButton,
            segmentSpans,
            segmentAt,
            updateSegmentTime,
            idleSegmentTime,
            refreshSegmentControls,
            setSegmentLabel,
            setSegmentVoice,
            refreshRecordText,
            setSegmentState,
            renumberSegments,
            panelModeFor,
            openSegmentPanel,
            closeSegmentPanel,
            keepSegmentVisible,
            syncSegmentButtons,
            syncSegmentPlayState,
        },
    };
}
