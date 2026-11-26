// 分段重生成：单段原地替换，以及整条按段复用同一流程。
// 这里只负责重生成流程；记录/UI/播放状态的读写通过 host 注入的回调完成。
import { requestSegmentAudio } from './tts.js';
import { splitText } from './text.js';

export function createRegenerator(host) {
    const {
        records,
        selection,
        input,
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
        currentTts,
    } = host;

    // 单独重生成一段：替换它的 PCM，再重建整条 WAV。合成中也可以替换已完成的段，
    // 但要把实时时间线的字节偏移一起换算；播放/暂停时会先停掉时间线或目标段。
    // keepLock 供整条重生成复用：外层统一持有 record.regenerating，不再逐段解锁
    async function regenerateSegment(record, segment, options = {}) {
        const {
            text: textOverride,
            autoPlay = true,
            keepLock = false,
            allowEmpty = false,
            deferRebuild = false,
        } = options;
        if (!segment || !records.includes(record) || segment.busy) return false;
        if (!keepLock && record.regenerating) return false;
        if (!allowEmpty && (!segment.complete || !segment.bytes)) return false;
        // 选中这一段时以输入框里的文本为准；否则仍用这一段保存的原文
        const editing = selection.record === record && selection.segment === segment;
        const text = String(textOverride ?? (editing ? input.value : segment.text) ?? '').trim();
        if (!text) {
            flashSegmentRegenButton(segment, '文本为空');
            return false;
        }
        if (!keepLock) {
            // 时间线还在播（或暂停）时直接重生成：先停下播放再替换，不留下旧声音
            if (record.state === 'playing' || record.state === 'paused') stopTimeline(record);
            // 合成中可以只替换目标段，不动正在进行的请求
            if (record.state !== 'ready' && record.state !== 'capturing') return false;
        }
        // 顺序播放正播到或正等待这一段时，先停下队列；其他段可以继续播。
        // 停下队列会收起面板，这里重新展开目标段，让「重生成中」保持可见
        if (record.chain && (record.chain.segment === segment || record.chain.waitingFor === segment)) {
            stopChain(record);
            openSegmentPanel(record, segment, 'segment');
        }
        // 先标目标段 busy 再刷新，保证它自己的播放键和「重生成」立即锁上，
        // 其他段仍保持可播
        segment.busy = true;
        if (!keepLock) record.regenerating = true;
        refreshSegmentControls(record);
        let failed = false;
        let ok = false;
        try {
            // 音色跟随面板当前选择；语速与格式沿用这条记录创建时的设置
            const voice = currentTts?.().voice || record.tts.voice;
            const { chunks, bytes, sampleRate } = await requestSegmentAudio({
                text,
                voice,
                rate: record.tts.rate,
                format: record.tts.format,
            });
            // 采样率变了就没法直接拼进同一条 WAV
            if (sampleRate !== record.sampleRate) throw new Error('sample rate mismatch');
            // 记录可能在合成途中被删掉或被挤出列表
            if (!records.includes(record)) return false;

            // 合成中替换会改变整条 PCM 的长度：先按旧数据记下目标段与当前播放位置，
            // 替换后按长度差重排时间线，后面到达的数据才不会接到错误的偏移上
            const sampleRateNow = sampleRateOf(record);
            const capturing = record.state === 'capturing' && Boolean(record.session);
            const session = capturing ? record.session : null;
            const targetIndex = segmentIndex(record, segment);
            const targetStart = segmentSpans(record).starts[targetIndex];
            const oldDuration = segment.bytes / 2 / sampleRateNow;
            const deltaDuration = (bytes - segment.bytes) / 2 / sampleRateNow;
            const position = session ? livePosition(session) : 0;

            clearSegmentAudio(segment);
            segment.chunks = chunks;
            segment.bytes = bytes;
            // 编辑过的文本要写回分段和整条记录，音频与文字才不会对不上
            if (text !== segment.text) {
                setSegmentLabel(segment, text);
                refreshRecordText(record);
            }
            // 被跳过或失败的段重生成成功后也要恢复成可播状态
            setSegmentState(record, segment, 'done');

            if (session) {
                record.bytes = record.segments.reduce((sum, part) => sum + part.bytes, 0);
                session.receivedSeconds = record.bytes / 2 / sampleRateNow;
                // 目标段整段在当前位置之前：后面内容的绝对位置整体平移；
                // 当前位置落在目标段内：从该段开头重排，直接听到新音频
                let next = position;
                if (targetStart + oldDuration <= position) next += deltaDuration;
                else if (position > targetStart) next = targetStart;
                next = Math.min(Math.max(0, next), session.receivedSeconds);
                session.pausedOffset = next;
                if (!session.paused) rescheduleTimeline(record, next);
            } else if (record.state === 'capturing') {
                // 捕获刚开始或会话已收尾，先只维护字节账；WAV 留给 finalize 建
                record.bytes = record.segments.reduce((sum, part) => sum + part.bytes, 0);
                record.seconds = record.bytes / 2 / sampleRateNow;
            } else if (!deferRebuild) {
                rebuildRecord(record);
            }
            ok = true;
        } catch (error) {
            failed = true;
        } finally {
            segment.busy = false;
            if (!keepLock) record.regenerating = false;
            refreshSegmentControls(record);
            if (failed) {
                flashSegmentRegenButton(segment, '失败');
            } else if (autoPlay && ok && records.includes(record) && record.state !== 'failed') {
                // 重生成成功后直接播放新音频；合成中会自动切到分段播放
                playChainSegment(record, segment);
            }
        }
        return ok;
    }

    // 整条重生成：按分段顺序原地复用 regenerateSegment，不新建记录。
    // 整条被选中且编辑后的全文分段数一致时，用输入框文本覆盖各段；
    // 全部完成后重拼一次 WAV，并从第一段开始自动播放。
    async function regenerateRecord(record) {
        if (!record || !records.includes(record) || record.regenerating) return;
        if (record.state !== 'ready' && record.state !== 'playing' && record.state !== 'paused') return;
        if (record.state === 'playing' || record.state === 'paused') stopTimeline(record);
        // 整条重做期间不保留队列，结束后从第一段重新播
        if (record.chain) stopChain(record);
        const targets = record.segments.filter(segment => String(segment.text || '').trim());
        if (!targets.length) return;
        let texts = null;
        if (selection.record === record && !selection.segment) {
            const edited = splitText(input.value);
            if (edited.length === record.segments.length) texts = edited;
        }
        record.regenerating = true;
        record.regeneratingAll = true;
        refreshSegmentControls(record);
        let anyOk = false;
        try {
            for (const segment of targets) {
                const text = texts ? texts[segmentIndex(record, segment)] : segment.text;
                const ok = await regenerateSegment(record, segment, {
                    text,
                    autoPlay: false,
                    keepLock: true,
                    allowEmpty: true,
                    deferRebuild: true,
                });
                if (ok) anyOk = true;
                if (!records.includes(record)) return;
            }
        } finally {
            record.regenerating = false;
            record.regeneratingAll = false;
            if (records.includes(record) && record.state !== 'capturing' && record.state !== 'failed') {
                rebuildRecord(record);
            }
            refreshSegmentControls(record);
        }
        const first = record.segments.find(segment => segment.complete && segment.bytes && !segment.busy);
        if (anyOk && first && records.includes(record) && record.state !== 'failed') {
            playChainSegment(record, first);
        }
    }

    return { regenerateSegment, regenerateRecord };
}
