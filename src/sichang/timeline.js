// 实时时间线：边下边播、暂停继续与进度跳转。
// 它以整条 PCM 为源，和分段顺序播放共用「当前段」的进度展示，但播放通道完全独立。
import { MIN_START_SECONDS } from './constants.js';
import { pcmToSamples } from './audio.js';

export function createTimeline(host) {
    function ensureAudioContext() {
        if (!host.audioContext || host.audioContext.state === 'closed') {
            host.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (host.audioContext.state === 'suspended') host.audioContext.resume().catch(() => {});
        return host.audioContext;
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
        if (host.activeSession && host.activeSession.record === record) host.activeSession = null;
        record.session = null;
        if (host.activeTimeline === record) host.activeTimeline = null;
        record.state = 'ready';
        host.resetRecordTime(record);
        record.autoSegment = null;
        host.refreshSegmentControls(record);
    }

    // 实时播放的当前进度（秒）：暂停时停在暂停点，播放时从锚点线性推进
    function livePosition(session) {
        if (session.paused) return session.pausedOffset || 0;
        if (session.timelineStart === null) return session.startOffset || 0;
        const elapsed = Math.max(0, session.context.currentTime - session.timelineStart);
        const position = session.startOffset + elapsed;
        return Math.min(session.receivedSeconds, Math.max(0, position));
    }

    // 实时播放换段时只更新行内：当前段显示进度条，上一段退回预览文字
    function showLiveSegment(record, session, position) {
        const info = host.segmentAt(record, position);
        if (!info || !info.segment.bytes) return;
        const { segment, start, duration } = info;
        if (record.autoSegment !== segment) {
            // 换段后上一段退回预览文字，别留着一条停住的进度条
            const previous = record.autoSegment;
            record.autoSegment = segment;
            if (previous) host.syncSegmentButtons(record, previous);
            host.mirrorPlayingText(record, segment);
        }
        // 行内进度条按实时播放位置推进，同时也刷新播放/停止按钮状态
        host.updateSegmentTime(record, segment, position - start, duration);
        host.updateRecordTime(record, position);
        host.syncSegmentButtons(record, segment);
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

    // 结束定时器只在数据全部下完后才有意义；暂停、跳转都要重算
    function armTimelineEnd(record) {
        const session = record.session;
        clearTimeout(record.timelineTimer);
        record.timelineTimer = null;
        if (!session || record.state !== 'playing') return;
        const remaining = Math.max(0, session.receivedSeconds - livePosition(session));
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

    // 暂停继续、进度跳转都走「按 PCM 重排」：不保留每个块的 AudioBuffer，
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
        session.playhead = startAt + buffer.duration;
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
        if (record.autoSegment) host.syncSegmentButtons(record, record.autoSegment);
        host.syncRecordPlayButton(record);
    }

    function resumeTimeline(record) {
        const session = record.session;
        if (!session || record.state !== 'paused') return;
        // 继续时间线前先停掉分段播放，避免两路声音叠在一起
        host.stopActive();
        session.paused = false;
        const offset = Math.min(session.pausedOffset || 0, session.receivedSeconds);
        session.pausedOffset = offset;
        rescheduleTimeline(record, offset);
        record.state = 'playing';
        record.autoSegment = null;
        startTimelineTicker(record, session);
        armTimelineEnd(record);
        host.syncRecordPlayButton(record);
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
        host.syncRecordPlayButton(record);
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
        host.syncRecordPlayButton(record);
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
        source.connect(context.destination);
        const startAt = Math.max(session.playhead, context.currentTime + 0.06);
        // 数据比实时慢时会晚于原计划起播，重锚一次进度，避免进度条跑到声音前面
        if (session.timelineStart === null || startAt > session.playhead + 0.005) {
            session.timelineStart = startAt;
            session.startOffset = audioStart;
        }
        source.start(startAt);
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

    return {
        api: {
            ensureAudioContext,
            stopTimeline,
            livePosition,
            showLiveSegment,
            startTimelineTicker,
            armTimelineEnd,
            pcmFromBytes,
            rescheduleTimeline,
            pauseTimeline,
            resumeTimeline,
            pauseLiveCapture,
            resumeLiveCapture,
            seekTimeline,
            startSource,
            flushPending,
            schedulePcm,
            stopSources,
        },
    };
}
