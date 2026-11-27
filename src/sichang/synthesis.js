// 流式合成：把一次朗读拆成句子任务，逐段请求 /api/tts，边收边排进实时时间线，
// 全部结束后拼成整条 WAV。同时接管官方的同名请求，用一帧静音顶替。
import {
    DEFAULT_SAMPLE_RATE,
    MAX_ATTEMPTS,
    MAX_PCM_BYTES,
    SEGMENT_HEADER,
    TTS_PATH,
} from './constants.js';
import { DEFAULT_VOICE } from './voices.js';
import { formatDuration, formatSegmentDuration, splitInHalf, splitText } from './text.js';
import { joinedPcm, pcmToWav } from './audio.js';

export function createSynthesis(host) {
    const { records, ui } = host;

    // 合成暂停用一道闸门：消费循环停在读流之前，请求与数据都留在原地，
    // 继续时从同一段同一条流接着读
    function waitWhilePaused(session) {
        if (!session.synthesisPaused || session.stopped) return Promise.resolve();
        return new Promise(resolve => session.holdResolvers.push(resolve));
    }

    function releaseHold(session) {
        const waiters = session.holdResolvers.splice(0);
        for (const resolve of waiters) resolve();
    }

    // 暂停时先把当前出声的那一路停住；继续时只恢复原本正在播的那一路，
    // 用户自己按过暂停的播放状态保持不变
    function setSynthesisPaused(session, paused) {
        if (!session || session.stopped || session.synthesisPaused === paused) return;
        session.synthesisPaused = paused;
        const record = session.record;
        if (paused) {
            const chainSegment = record.chain?.segment;
            if (chainSegment?.audio && !chainSegment.audio.paused) {
                session.resumeChainOnUnpause = true;
                host.pauseChain(record);
            } else if (!session.paused) {
                session.resumeTimelineOnUnpause = true;
                host.pauseLiveCapture(record);
            }
        } else {
            releaseHold(session);
            if (session.resumeChainOnUnpause) {
                session.resumeChainOnUnpause = false;
                // 暂停期间用户可能已经自己继续播放，别重复 resume 打断当前段
                const chainSegment = record.chain?.segment;
                if (chainSegment?.audio?.paused) host.resumeChain(record);
            }
            if (session.resumeTimelineOnUnpause) {
                session.resumeTimelineOnUnpause = false;
                // 暂停期间用户可能切到了分段顺序播放，别再把时间线叠回去
                if (!record.chain && session.paused && record.state === 'capturing') {
                    host.resumeLiveCapture(record);
                }
            }
        }
        host.syncGoButton?.();
    }

    function toggleSynthesisPause() {
        const session = host.activeSession;
        if (!session || session.stopped || session.record?.state !== 'capturing') return;
        setSynthesisPaused(session, !session.synthesisPaused);
    }

    // 还没发请求的段跟着面板当前音色走；已经发出请求的段由 segment.voiceLocked 固定
    function currentVoice() {
        return ui.voice.value || DEFAULT_VOICE;
    }

    function syncPendingVoices() {
        const session = host.activeSession;
        const record = session?.record;
        if (!record || record.state !== 'capturing') return;
        const voice = currentVoice();
        for (const segment of record.segments) {
            if (segment.voiceLocked || segment.status !== 'pending') continue;
            host.setSegmentVoice(segment, voice);
        }
    }

    ui.voice.addEventListener('change', syncPendingVoices);

    function updateProgress(record, done, total) {
        if (!records.includes(record)) return;
        record.duration.textContent = total > 1 ? `${done}/${total}` : '合成中';
    }

    function markFailed(record) {
        if (!records.includes(record)) return;
        clearInterval(record.timelineTicker);
        record.timelineTicker = null;
        host.stopChain(record);
        record.state = 'failed';
        record.session = null;
        record.row.removeAttribute('data-live');
        record.duration.textContent = '失败';
        record.downloadButton.disabled = true;
        if (record.expandedSegment) host.closeSegmentPanel(record, record.expandedSegment);
        record.autoSegment = null;
        for (const segment of record.segments) {
            if (segment.status === 'pending' || segment.status === 'active') {
                host.setSegmentState(record, segment, segment.bytes ? 'done' : 'skipped');
            }
        }
        host.refreshSegmentControls(record);
        host.syncGoButton?.();
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
                host.setSegmentState(record, segment, segment.bytes ? 'done' : 'skipped');
            }
        }
        host.refreshSegmentControls(record);

        // 数据下完了，但实时时间线还在播：可能还要播几分钟，控制面板留在正在播放的分段上
        if (session && !session.stopped && session.paused === false && session.sources.length && session.playhead > session.context.currentTime + 0.05) {
            if (host.activeTimeline && host.activeTimeline !== record) host.stopTimeline(host.activeTimeline);
            record.state = 'playing';
            record.session = session;
            host.activeTimeline = record;
            host.startTimelineTicker(record, session);
            host.armTimelineEnd(record);
        } else {
            if (record.expandedSegment?.mode === 'live') host.closeSegmentPanel(record, record.expandedSegment);
            record.autoSegment = null;
        }
        host.syncRecordPlayButton(record);
        host.syncGoButton?.();
    }

    function startSession({ text, voice, rate, format }) {
        // 上一条如果只剩时间线在播，先把它停干净；否则新朗读会和旧音频叠在一起
        host.stopTimeline(host.activeTimeline);
        host.activeSession?.stop();
        // 官方朗读和面板播放互斥，避免两路声音叠在一起
        host.stopActive();
        host.stopOtherChains(null);
        const tasks = splitText(text).map(segmentText => ({ text: segmentText }));
        if (!tasks.length) return null;
        // 面板默认收起，合成一开始就展开，分段进度和播放控件都能直接看到
        host.expandPanel?.();

        const record = host.beginRecord(text, { voice, rate, format });
        // 开始新的合成后，输入框不再承担某一段的编辑目标
        host.applySelection(null, null);
        // 先把每段的子条目建出来：合成期间就能逐段看到「待合成/合成中/完成」，
        // 也保证列表顺序与最终 WAV 的拼接顺序一致
        for (const task of tasks) task.segment = host.createSegment(record, task.text);
        host.refreshSegmentControls(record);
        // 在点击的同一个任务里解锁音频上下文，后面数据到了才能直接出声
        host.ensureAudioContext();
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
            paused: false,
            pausedOffset: 0,
            synthesisPaused: false,
            holdResolvers: [],
            resumeTimelineOnUnpause: false,
            resumeChainOnUnpause: false,
            context: null,
            sources: [],
            sampleRate: DEFAULT_SAMPLE_RATE,
            controller: new AbortController(),
            total: tasks.length,
            done: 0,
        };
        record.session = session;
        host.activeSession = session;
        host.syncGoButton?.();
        updateProgress(record, 0, session.total);
        // 合成一开始就盯住实时播放位置，播到哪段就展开哪段
        host.startTimelineTicker(record, session);
        host.syncRecordPlayButton(record);

        const requestSegment = (segmentText, segmentVoice) => window.fetch(TTS_PATH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', [SEGMENT_HEADER]: '1' },
            body: JSON.stringify({ text: segmentText, voice: segmentVoice, rate, format }),
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
            if (prefetch || session.synthesisPaused || session.stopped) return;
            if (!piece || piece.segment.removed) return;
            // 预取即视为这一段已经开始生成，音色在此刻固定
            const voice = piece.voice || currentVoice();
            piece.voice = voice;
            host.setSegmentVoice(piece.segment, voice, true);
            const promise = requestSegment(piece.text, voice);
            promise.catch(() => {});
            prefetch = { piece, promise };
        };
        const takePrefetch = (piece, voice) => {
            if (prefetch && prefetch.piece === piece) {
                const { promise } = prefetch;
                prefetch = null;
                return promise;
            }
            return requestSegment(piece.text, voice);
        };
        // 被删段如果已经预取过，把请求连同响应体一起丢掉
        const dropPrefetch = piece => {
            if (!prefetch || prefetch.piece !== piece) return;
            const { promise } = prefetch;
            prefetch = null;
            promise.then(response => {
                try { response.body?.cancel(); } catch {}
            }).catch(() => {});
        };

        const consume = async (response, piece) => {
            const reader = response.body.getReader();
            const segment = piece.segment;
            let leftover = new Uint8Array(0);
            // 记下当前读流，删除这一段时可以从外面立即断开，不用等下一块数据
            segment.reader = reader;
            if (!segment.removed) host.setSegmentState(record, segment, 'active');
            try {
                for (;;) {
                    await waitWhilePaused(session);
                    if (session.stopped || segment.removed) break;
                    const { done, value } = await reader.read();
                    if (done) break;
                    // 读流期间用户可能刚按下暂停：先挂住这一块，不写进时间线
                    await waitWhilePaused(session);
                    if (session.stopped || segment.removed) break;
                    if (!value || !value.length) continue;
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
                        host.schedulePcm(session, part, session.receivedSeconds);
                        session.receivedSeconds += evenLength / 2 / session.sampleRate;
                        // 合成中的段也持续显示已拿到的时长，作为这一段自己的进度
                        segment.durationEl.textContent = `${formatSegmentDuration(segment.bytes / 2 / session.sampleRate)}…`;
                    }
                    leftover = data.subarray(evenLength);
                }
            } finally {
                if (segment.reader === reader) segment.reader = null;
                if (segment.removed) {
                    // 这一段被删掉了，停止读流，别再把数据写进已移除的条目
                    try { reader.cancel(); } catch {}
                } else if (segment.bytes) {
                    // 一收到就解锁这一段的播放，不用等整条合成结束
                    host.setSegmentState(record, segment, 'done');
                } else {
                    host.setSegmentState(record, segment, 'pending');
                }
            }
            // 整段比预缓冲还短时也要起播，不能一直攒着
            if (!segment.removed) host.flushPending(session);
        };

        const speak = async piece => {
            const segment = piece.segment;
            if (segment.removed) return 'removed';
            const bytesBefore = segment.bytes;
            for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                try {
                    await waitWhilePaused(session);
                    if (session.stopped) return 'done';
                    if (segment.removed) return 'removed';
                    const voice = piece.voice || currentVoice();
                    piece.voice = voice;
                    host.setSegmentVoice(segment, voice, true);
                    const response = await takePrefetch(piece, voice);
                    await waitWhilePaused(session);
                    if (session.stopped) return 'done';
                    if (segment.removed) {
                        try { response.body?.cancel(); } catch {}
                        return 'removed';
                    }
                    // 当前段开始播时就把下一段发出去，缩短段间等待
                    if (tasks.length) startPrefetch(tasks[0]);
                    await consume(response, piece);
                    return segment.removed ? 'removed' : 'done';
                } catch (error) {
                    if (session.stopped || session.controller.signal.aborted) return 'done';
                    if (segment.removed) return 'removed';
                    // 这一轮已经收到过数据就不再重试，否则同一段会重复拼进 WAV
                    if (segment.bytes > bytesBefore) return 'done';
                }
            }
            if (segment.removed) return 'removed';
            // 已经收到过一部分数据就把这半段当作完成，避免重复播放开头
            if (segment.bytes > bytesBefore) return 'done';
            const halves = splitInHalf(piece.text);
            if (!halves) {
                host.setSegmentState(record, segment, 'failed');
                return 'failed';
            }
            // 失败的长句拆成两半再排到队首：原条目留给前半，后半紧插在它后面，
            // 保证列表顺序、请求顺序与 WAV 拼接顺序一致
            host.setSegmentLabel(segment, halves[0]);
            host.setSegmentState(record, segment, 'pending');
            host.setSegmentVoice(segment, currentVoice());
            const second = host.createSegment(record, halves[1], segment);
            host.setSegmentVoice(second, currentVoice());
            tasks.unshift({ text: halves[0], segment }, { text: halves[1], segment: second });
            session.total += halves.length - 1;
            updateProgress(record, session.done, session.total);
            return 'split';
        };

        (async () => {
            startPrefetch(tasks[0]);
            while (tasks.length && !session.stopped) {
                await waitWhilePaused(session);
                if (session.stopped) break;
                const piece = tasks.shift();
                // 合成中被删掉的段直接跳过，不发请求也不计入完成数
                if (piece.segment.removed) {
                    dropPrefetch(piece);
                    updateProgress(record, session.done, session.total);
                    continue;
                }
                const result = await speak(piece);
                if (session.stopped) break;
                if (result === 'removed') {
                    dropPrefetch(piece);
                } else if (result !== 'split') {
                    session.done += 1;
                }
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
            releaseHold(session);
            try {
                session.controller.abort();
            } catch {}
            host.stopSources(session);
            if (host.activeSession === session) host.activeSession = null;
            // 合成已结束、只剩时间线在播时，按停止要把按钮和进度一起复位
            if (record.state === 'playing' || record.state === 'paused') {
                host.stopTimeline(record);
                host.syncGoButton?.();
                return;
            }
            finalizeRecord(record);
        };
        session.abort = () => {
            session.stopped = true;
            releaseHold(session);
            try {
                session.controller.abort();
            } catch {}
            host.stopSources(session);
            if (host.activeSession === session) host.activeSession = null;
            host.syncGoButton?.();
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

    return {
        api: { startSession, updateProgress, markFailed, finalizeRecord, toggleSynthesisPause },
        dispose: () => {
            window.fetch = originalFetch;
            ui.voice.removeEventListener('change', syncPendingVoices);
        },
    };
}
