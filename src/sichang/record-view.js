// 记录条目：列表行、摘要、下载与删除。
// 记录头只做收纳，播放/重生成逻辑都通过 host 注入的回调触发。
import { DEFAULT_SAMPLE_RATE, MAX_RECORDS } from './constants.js';
import { SEGMENT_ICONS } from './segments.js';
import { voiceName } from './voices.js';
import { formatDuration, previewText } from './text.js';
import { joinedPcm, pcmToWav } from './audio.js';

export function createRecordView(host) {
    const { ui, records } = host;

    // 清空全部记录不再弹系统确认框：第一次点击把按钮改成「确认清空」，
    // 3 秒内再点一次才真正删除；点别处或超时都回到普通状态
    let clearTimer = null;
    function resetClearConfirm() {
        clearTimeout(clearTimer);
        clearTimer = null;
        ui.clear.classList.remove('confirm');
        ui.clear.textContent = '清空';
        ui.clear.title = '清空全部记录';
        ui.clear.setAttribute('aria-label', '清空全部记录');
    }
    function armClearConfirm() {
        ui.clear.classList.add('confirm');
        ui.clear.textContent = '确认清空';
        ui.clear.title = '再次点击确认清空全部记录';
        ui.clear.setAttribute('aria-label', '再次点击确认清空全部记录');
        clearTimeout(clearTimer);
        clearTimer = setTimeout(resetClearConfirm, 3000);
    }

    function updateCount() {
        resetClearConfirm();
        ui.clear.hidden = records.length === 0;
        // 没有记录时不展开 body，面板只保留顶栏；提示文字也省掉，避免占高度
        ui.panel.classList.toggle('empty', records.length === 0);
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
        // 删除这一段：合成中删掉还没轮到的段就不再发请求，被删的跳过
        const deleteButton = document.createElement('button');
        deleteButton.className = 'segDelete';
        deleteButton.textContent = '✕';
        deleteButton.title = '删除这一段';
        deleteButton.setAttribute('aria-label', '删除这一段');
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
        // 进度条左侧标出这一段实际使用的音色
        const voiceEl = document.createElement('span');
        voiceEl.className = 'segVoice';
        voiceEl.textContent = voiceName(record.tts.voice);
        const toggleButton = document.createElement('button');
        toggleButton.className = 'segAction';
        toggleButton.textContent = SEGMENT_ICONS.play;
        toggleButton.title = '播放本段';
        toggleButton.setAttribute('aria-label', '播放本段');
        const stopButton = document.createElement('button');
        stopButton.className = 'segAction';
        stopButton.textContent = SEGMENT_ICONS.stop;
        stopButton.title = '停止播放';
        stopButton.setAttribute('aria-label', '停止播放');
        stopButton.hidden = true;
        const synthButton = document.createElement('button');
        synthButton.className = 'segAction synth';
        synthButton.textContent = SEGMENT_ICONS.synthStop;
        synthButton.title = '停止合成';
        synthButton.setAttribute('aria-label', '停止合成');
        synthButton.hidden = true;
        const replayButton = document.createElement('button');
        replayButton.className = 'segAction';
        replayButton.textContent = SEGMENT_ICONS.replay;
        replayButton.title = '重播本段';
        replayButton.setAttribute('aria-label', '重播本段');
        const downloadButton = document.createElement('button');
        downloadButton.className = 'segAction';
        downloadButton.textContent = SEGMENT_ICONS.download;
        downloadButton.title = '下载本段';
        downloadButton.setAttribute('aria-label', '下载本段');
        downloadButton.disabled = true;
        controls.append(toggleButton, timeEl, voiceEl, bar, stopButton, replayButton, downloadButton, synthButton);
        panel.append(controls);

        row.append(caret, idx, label, segDuration, playButton, regenButton, deleteButton);
        box.append(row, panel);
        if (after) record.segList.insertBefore(box, after.box.nextSibling);
        else record.segList.appendChild(box);
        Object.assign(segment, {
            box, row, idx, label, durationEl: segDuration, playButton, regenButton, deleteButton, caret,
            panel, bar, fill, timeEl, voiceEl, toggleButton, stopButton, synthButton, replayButton,
            downloadButton,
        });
        host.setSegmentVoice(segment, record.tts.voice);
        host.setSegmentLabel(segment, text);
        host.renumberSegments(record);

        row.addEventListener('click', event => {
            if (event.target.closest('button')) return;
            host.selectSegment(record, segment);
            if (record.expandedSegment === segment) {
                host.closeSegmentPanel(record, segment);
                return;
            }
            host.openSegmentPanel(record, segment, host.panelModeFor(record, segment));
        });
        playButton.addEventListener('click', () => host.toggleSegmentPlay(record, segment));
        regenButton.addEventListener('click', event => {
            event.stopPropagation();
            host.regenerateSegment(record, segment);
        });
        deleteButton.addEventListener('click', event => {
            event.stopPropagation();
            deleteSegment(record, segment);
        });
        toggleButton.addEventListener('click', () => {
            if (segment.mode === 'live') {
                if (record.state === 'paused') host.resumeTimeline(record);
                else host.pauseTimeline(record);
                return;
            }
            if (record.chain?.segment === segment) {
                if (segment.audio && !segment.audio.paused) host.pauseChain(record);
                else host.resumeChain(record);
                return;
            }
            host.playChainSegment(record, segment);
        });
        stopButton.addEventListener('click', () => {
            if (segment.mode === 'live') {
                if (record.state === 'capturing') record.session?.stop();
                else host.stopTimeline(record);
                return;
            }
            if (record.chain) {
                host.stopChain(record);
                return;
            }
            if (segment.audio) {
                segment.audio.pause();
                segment.audio.currentTime = 0;
            }
            host.idleSegmentTime(record, segment);
            host.syncSegmentPlayState(segment);
        });
        // 合成中切到分段顺序播放后，实时面板会收起；这里保留整个合成的停止入口
        synthButton.addEventListener('click', () => record.session?.stop());
        replayButton.addEventListener('click', () => {
            if (!segment.complete || !segment.bytes || segment.busy) return;
            if (record.chain?.segment === segment && segment.audio) {
                segment.audio.currentTime = 0;
                if (segment.audio.paused) host.resumeChain(record);
                return;
            }
            host.playChainSegment(record, segment);
        });
        downloadButton.addEventListener('click', () => host.downloadSegment(record, segment));
        // 分段进度条自己跳转；还没播过时按需建 audio，停在目标位置
        bar.addEventListener('click', event => {
            if (!segment.complete || !segment.bytes || segment.busy) return;
            if (record.state === 'failed') return;
            const rect = bar.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            host.seekSegment(record, segment, ratio);
        });
        return segment;
    }

    // 删除单个分段：合成中删掉还没轮到的段就不再发请求（被删的跳过），
    // 已收到数据的段删除后从整条账本里扣掉并重拼；删光分段等同于删除整条记录
    function deleteSegment(record, segment) {
        if (!segment || !record.segments.includes(segment)) return;
        if (segment.busy || record.regenerating) return;
        const session = record.state === 'capturing' && record.session && !record.session.stopped
            ? record.session
            : null;
        const index = record.segments.indexOf(segment);
        const sampleRate = host.sampleRateOf(record);
        const duration = segment.bytes / 2 / sampleRate;
        const start = session ? host.segmentSpans(record).starts[index] : 0;
        const position = session ? host.livePosition(session) : 0;
        // 还没完成的段直接跳过，不再计入合成进度分母
        if (session && !segment.complete) {
            session.total = Math.max(0, session.total - 1);
            host.updateProgress?.(record, session.done, session.total);
        }
        segment.removed = true;
        // 这一段正在生成：立即断开读流，停止继续收数据
        if (segment.reader) {
            try { segment.reader.cancel(); } catch {}
            segment.reader = null;
        }
        // 顺序播放正播到或正等待这一段：播到该段时按剩余列表继续或停下
        if (record.chain?.segment === segment) host.stopChain(record);
        else if (record.chain?.waitingFor === segment) host.advanceChain(record, index);
        if (record.expandedSegment === segment) host.closeSegmentPanel(record, segment);
        if (host.selection.record === record && host.selection.segment === segment) host.applySelection(record, null);
        if (record.autoSegment === segment) record.autoSegment = null;
        // 释放这一段自己的音频与 blob URL
        if (segment.audio) {
            if (segment.audio === host.activeAudio) host.activeAudio = null;
            segment.audio.pause();
            segment.audio = null;
        }
        if (segment.url) URL.revokeObjectURL(segment.url);
        segment.url = null;
        // 从列表和 DOM 移除并重排编号；整条摘要跟着剩余文本走
        record.segments.splice(index, 1);
        segment.box.remove();
        record.bytes = Math.max(0, record.bytes - segment.bytes);
        host.renumberSegments(record);
        host.refreshRecordText(record);
        host.refreshSegmentControls(record);

        if (!record.segments.length) {
            removeRecord(record);
            return;
        }

        if (session) {
            // 实时时间线按剩余分段重排：被删段在当前位置之前时后面内容前移，
            // 正落在被删段内就从该段起点接着播
            if (segment.bytes) {
                session.receivedSeconds = Math.max(0, session.receivedSeconds - duration);
                let next = position;
                if (start + duration <= position) next -= duration;
                else if (position > start) next = start;
                next = Math.min(Math.max(0, next), session.receivedSeconds);
                session.pausedOffset = next;
                if (!session.paused) host.rescheduleTimeline(record, next);
            }
        } else if (record.state === 'playing' || record.state === 'paused') {
            // 下载完但时间线还在播：停掉旧时间线，按剩余分段重建整条 WAV
            host.stopTimeline(record);
            host.rebuildRecord(record);
        } else if (record.state !== 'failed') {
            host.rebuildRecord(record);
        }
    }

    // 记录头同时是折叠开关：点一下收起或展开该条下方的分段列表，
    // 摘要仍留一行，折叠后整条记录只占头部和摘要两行
    function setRecordFold(record, folded) {
        record.row.classList.toggle('folded', folded);
        record.head.setAttribute('aria-expanded', String(!folded));
        record.head.title = folded ? '点击展开分段' : '点击收起分段';
    }

    function toggleRecordFold(record) {
        setRecordFold(record, !record.row.classList.contains('folded'));
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
        head.setAttribute('aria-expanded', 'true');
        head.title = '点击收起分段';
        // 折叠箭头放在最前面，和分段行的小箭头保持同一套视觉
        const caret = document.createElement('span');
        caret.className = 'itemCaret';
        caret.textContent = '›';
        caret.setAttribute('aria-hidden', 'true');
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = new Date(record.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const duration = document.createElement('span');
        duration.className = 'dur';
        duration.textContent = '捕获中';
        const txt = document.createElement('div');
        txt.className = 'txt';
        const preview = previewText(text) || '（无文本）';
        txt.textContent = preview;
        txt.title = '点击选中整条并收起/展开分段';
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
        const downloadButton = document.createElement('button');
        downloadButton.className = 'itemDownload';
        downloadButton.textContent = '↓';
        downloadButton.title = '下载整条 WAV';
        downloadButton.setAttribute('aria-label', '下载整条 WAV');
        downloadButton.disabled = true;
        const deleteButton = document.createElement('button');
        deleteButton.className = 'itemDelete';
        deleteButton.textContent = '✕';
        deleteButton.title = '删除这条记录';
        deleteButton.setAttribute('aria-label', '删除这条记录');
        // 记录头一行放完摘要与整条操作，摘要占据中间剩余宽度并单行截断
        head.append(caret, meta, txt, duration, segCount, playButton, regenAllButton, downloadButton, deleteButton);

        const segList = document.createElement('div');
        segList.className = 'segList';

        row.append(head, segList);
        ui.list.insertBefore(row, ui.list.firstChild);

        Object.assign(record, {
            row, head, caret, txt, duration, segCount, playButton, regenAllButton,
            downloadButton, deleteButton, segList,
        });

        playButton.addEventListener('click', event => {
            event.stopPropagation();
            host.toggleRecordPlayback(record);
        });
        regenAllButton.addEventListener('click', event => {
            event.stopPropagation();
            host.regenerateRecord(record);
        });
        downloadButton.addEventListener('click', event => {
            event.stopPropagation();
            downloadRecord(record);
        });
        deleteButton.addEventListener('click', event => {
            event.stopPropagation();
            removeRecord(record);
        });
        // 点记录头（含摘要标题）都算选中整条，并折叠/展开分段列表；
        // 分段区域和按钮只做自己的事
        row.addEventListener('click', event => {
            if (event.target.closest('.segBox, button')) return;
            host.selectRecord(record);
            if (event.target.closest('.itemHead')) toggleRecordFold(record);
        });

        records.push(record);
        while (records.length > MAX_RECORDS) removeRecord(records[0]);
        updateCount();
        return record;
    }

    function removeRecord(record) {
        const index = records.indexOf(record);
        if (index >= 0) records.splice(index, 1);
        if (host.selection.record === record) host.applySelection(null, null);
        host.stopChain(record);
        if (host.activeTimeline === record) host.activeTimeline = null;
        clearTimeout(record.timelineTimer);
        clearInterval(record.timelineTicker);
        record.session?.abort();
        for (const segment of record.segments) {
            if (segment.audio) {
                if (segment.audio === host.activeAudio) host.activeAudio = null;
                segment.audio.pause();
                segment.audio = null;
            }
            if (segment.url) URL.revokeObjectURL(segment.url);
        }
        if (host.activeSession?.record === record) host.activeSession = null;
        if (record.url) URL.revokeObjectURL(record.url);
        record.row.remove();
        updateCount();
        // 删掉正在播的记录后顶栏控件可能该隐藏，统一按剩余记录重算
        host.syncPlaybackBar?.();
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
        link.href = host.ensureSegmentUrl(record, segment);
        const stamp = new Date(record.time).toISOString().replace(/[:.]/g, '-');
        link.download = `sichang-tts-${stamp}-seg${host.segmentIndex(record, segment) + 1}.wav`;
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    // 某一段被替换后整条 WAV 要重拼：旧的 blob URL 作废，播放位置归零
    function rebuildRecord(record) {
        if (record.url) URL.revokeObjectURL(record.url);
        record.url = null;
        const total = record.segments.reduce((sum, segment) => sum + segment.bytes, 0);
        const even = total - (total % 2);
        if (!even) {
            host.markFailed(record);
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

    const onDocumentPointerDown = event => {
        // 点了清空按钮以外的地方就撤销二次确认
        if (ui.clear.classList.contains('confirm') && !event.composedPath().includes(ui.clear)) {
            resetClearConfirm();
        }
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);

    ui.clear.addEventListener('click', () => {
        if (!records.length) return;
        if (!ui.clear.classList.contains('confirm')) {
            armClearConfirm();
            return;
        }
        resetClearConfirm();
        for (const record of [...records]) removeRecord(record);
        host.activeAudio = null;
        // 记录和输入框文字是同一份编辑上下文，清空记录时把官方输入框也一并清空
        host.setInputText('');
    });

    updateCount();

    return {
        api: {
            updateCount,
            syncRecordRegenButton,
            beginRecord,
            createSegment,
            deleteSegment,
            removeRecord,
            downloadRecord,
            downloadSegment,
            rebuildRecord,
        },
        dispose: () => {
            clearTimeout(clearTimer);
            document.removeEventListener('pointerdown', onDocumentPointerDown, true);
        },
    };
}
