// 分段顺序播放：从某一段开始连播、自动接下一段、暂停继续与停止，以及记录头的整条播放按钮。
// 实时时间线由 timeline.js 负责，这里只在切换时调用它。
import { joinedPcm, pcmToWav } from './audio.js';

export function createChain(host) {
    const { records } = host;

    function stopActive() {
        if (host.activeAudio && !host.activeAudio.paused) host.activeAudio.pause();
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
            host.pauseTimeline(record);
            return;
        }
        if (record.state === 'paused') {
            host.resumeTimeline(record);
            return;
        }
        if (record.state === 'capturing') {
            const session = record.session;
            if (!session) return;
            if (session.paused) host.resumeLiveCapture(record);
            else host.pauseLiveCapture(record);
            return;
        }
        const first = record.segments.find(segment => segment.complete && segment.bytes && !segment.busy);
        if (first) playChainSegment(record, first);
    }

    // 段的 WAV 按需生成：没点播放就不复制 PCM，避免长记录成倍占内存
    function ensureSegmentUrl(record, segment) {
        if (!segment.url) {
            const even = segment.bytes - (segment.bytes % 2);
            segment.url = URL.createObjectURL(pcmToWav(joinedPcm(segment.chunks, even), host.sampleRateOf(record)));
        }
        return segment.url;
    }

    function clearSegmentAudio(segment) {
        if (segment.audio) {
            if (segment.audio === host.activeAudio) host.activeAudio = null;
            segment.audio.pause();
            segment.audio = null;
        }
        if (segment.url) {
            URL.revokeObjectURL(segment.url);
            segment.url = null;
        }
        host.idleSegmentTime(segment.record, segment);
        host.syncSegmentPlayState(segment);
    }

    // 第一次播放或拖动进度时才生成 WAV blob；变速保持不变调
    function ensureSegmentAudio(record, segment) {
        if (!segment.audio) {
            const audio = new Audio(ensureSegmentUrl(record, segment));
            audio.preservesPitch = true;
            audio.mozPreservesPitch = true;
            audio.webkitPreservesPitch = true;
            audio.addEventListener('pause', () => host.syncSegmentPlayState(segment));
            audio.addEventListener('play', () => syncRecordPlayButton(record));
            audio.addEventListener('ended', () => {
                audio.currentTime = 0;
                host.idleSegmentTime(record, segment);
                host.syncSegmentPlayState(segment);
                // 顺序播放：这一段播完就接下一段，播到谁谁展开
                if (record.chain?.segment === segment) advanceChain(record, host.segmentIndex(record, segment));
            });
            audio.addEventListener('timeupdate', () => {
                if (!Number.isFinite(audio.duration) || !audio.duration) return;
                host.updateSegmentTime(record, segment, audio.currentTime, audio.duration);
                if (record.expandedSegment === segment) host.syncSegmentPanel(record, segment);
            });
            segment.audio = audio;
        }
        segment.audio.playbackRate = host.playRate;
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
        if (record.state === 'playing' || record.state === 'paused') host.stopTimeline(record);
        else if (record.state === 'capturing') host.pauseLiveCapture(record);
        if (host.activeTimeline && host.activeTimeline !== record) host.stopTimeline(host.activeTimeline);
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
            host.idleSegmentTime(record, previous);
            host.syncSegmentPlayState(previous);
        }
        stopActive();
        const audio = ensureSegmentAudio(record, segment);
        record.chain = { segment };
        record.autoSegment = segment;
        host.activeAudio = audio;
        host.openSegmentPanel(record, segment, 'segment');
        host.mirrorPlayingText(record, segment);
        syncRecordPlayButton(record);
        audio.play().then(
            () => { host.syncSegmentPlayState(segment); syncRecordPlayButton(record); },
            () => { host.syncSegmentPlayState(segment); syncRecordPlayButton(record); },
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
                    if (previous) host.syncSegmentPanel(record, previous);
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
        host.activeAudio = segment.audio;
        host.openSegmentPanel(record, segment, 'segment');
        host.mirrorPlayingText(record, segment);
        syncRecordPlayButton(record);
        segment.audio.play().then(
            () => { host.syncSegmentPlayState(segment); syncRecordPlayButton(record); },
            () => { host.syncSegmentPlayState(segment); syncRecordPlayButton(record); },
        );
    }

    function stopChain(record) {
        if (!record.chain) return;
        const current = record.chain.segment || null;
        if (current?.audio) {
            if (current.audio === host.activeAudio) host.activeAudio = null;
            current.audio.pause();
            current.audio.currentTime = 0;
            host.idleSegmentTime(record, current);
            host.syncSegmentPlayState(current);
        }
        record.chain = null;
        record.autoSegment = null;
        if (record.expandedSegment?.mode !== 'live') {
            const expanded = record.expandedSegment;
            if (expanded) host.closeSegmentPanel(record, expanded);
        }
        syncRecordPlayButton(record);
    }

    function stopOtherChains(keep) {
        for (const record of records) {
            if (record !== keep && record.chain) stopChain(record);
        }
    }

    function seekSegment(record, segment, ratio) {
        const duration = segment.bytes / 2 / host.sampleRateOf(record);
        // 实时时间线按分段起点换算成整条时间线上的位置
        if (segment.mode === 'live') {
            const { starts } = host.segmentSpans(record);
            host.seekTimeline(record, starts[host.segmentIndex(record, segment)] + ratio * duration);
            return;
        }
        const audio = ensureSegmentAudio(record, segment);
        const seek = () => {
            if (!Number.isFinite(audio.duration) || !audio.duration) return;
            audio.currentTime = ratio * audio.duration;
            host.updateSegmentTime(record, segment, audio.currentTime, audio.duration);
        };
        if (audio.readyState >= 1) seek();
        else audio.addEventListener('loadedmetadata', seek, { once: true });
    }

    return {
        api: {
            stopActive,
            recordIsPlaying,
            syncRecordPlayButton,
            toggleRecordPlayback,
            ensureSegmentUrl,
            clearSegmentAudio,
            ensureSegmentAudio,
            toggleSegmentPlay,
            prepareRecordPlayback,
            playChainSegment,
            advanceChain,
            pauseChain,
            resumeChain,
            stopChain,
            stopOtherChains,
            seekSegment,
        },
    };
}
