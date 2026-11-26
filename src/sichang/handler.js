// 思畅 AI 的「朗读」请求 POST /api/tts，拿回 24kHz 单声道 PCM16 流由页面边下边播。
// 这里只负责装配：共享状态、选中逻辑和模块接线；具体职责见同目录各模块。
// 面板以分段为播放单位：点哪段就从哪段开始顺序播放，播到谁谁展开控制面板。

import { PLAY_RATES, PLAY_RATE_STORE_KEY } from './constants.js';
import { createPanel, copyText } from './panel.js';
import { createPanelLayout } from './panel-layout.js';
import { createCompose } from './compose.js';
import { createRecordView } from './record-view.js';
import { createSegments } from './segments.js';
import { createChain } from './chain.js';
import { createTimeline } from './timeline.js';
import { createSynthesis } from './synthesis.js';
import { createRegenerator } from './regenerate.js';

export default function initSichangHandler() {
    if (window.location.hostname !== 'sichang.xyz') return;

    const ui = createPanel();
    // 模块之间共享的运行时状态：记录列表、选中目标、正在播的声音/会话/时间线。
    // 各模块通过 host 读写同一份状态，避免把大闭包里的函数互相注来注去
    const host = {
        ui,
        records: [],
        selection: { record: null, segment: null },
        activeAudio: null,
        activeSession: null,
        activeTimeline: null,
        audioContext: null,
        playRate: 1,
        // 输入框里是否有用户尚未提交的手动改动：播放自动跟随遇到它就停下，不覆盖草稿
        inputTyping: false,
    };

    // 选中整条或某一段时，把对应文本放进输入框；再次点同一条不覆盖正在编辑的内容
    function applySelection(record, segment) {
        host.selection.record = record;
        host.selection.segment = segment;
        for (const item of host.records) {
            item.row.classList.toggle('selected', item === record);
            for (const part of item.segments) {
                const chosen = Boolean(segment && part === segment);
                part.row.classList.toggle('selected', chosen);
            }
        }
        host.updateComposeMeta();
    }
    function selectRecord(record) {
        if (host.selection.record === record && !host.selection.segment) return;
        applySelection(record, null);
        host.setInputText(record.text || '');
    }
    function selectSegment(record, segment) {
        if (host.selection.record === record && host.selection.segment === segment) return;
        applySelection(record, segment);
        host.setInputText(segment.text || '');
    }
    // 播放到哪段就把哪段文本填进输入框，选中状态一起跟着走，重生成也就能直接用这段文字。
    // 输入框正被编辑或存着用户未提交的改动时让位，避免每换一段就冲掉正在写的内容
    function mirrorPlayingText(record, segment) {
        if (!segment || !String(segment.text || '').trim()) return;
        if (host.selection.record === record && host.selection.segment === segment) return;
        if (host.inputTyping || ui.input.getRootNode().activeElement === ui.input) return;
        applySelection(record, segment);
        host.setInputText(segment.text);
    }

    Object.assign(host, {
        applySelection,
        selectRecord,
        selectSegment,
        mirrorPlayingText,
        copyText,
    });

    // 模块按依赖顺序装配；dispose 逆序执行，fetch 包装与全局监听都能撤销
    const disposers = [];
    const adopt = ({ api, dispose }) => {
        Object.assign(host, api);
        if (typeof dispose === 'function') disposers.push(dispose);
    };

    adopt(createCompose(host));
    adopt(createRecordView(host));
    adopt(createSegments(host));
    adopt(createChain(host));
    adopt(createTimeline(host));
    // 重生成流程拆到 regenerate.js：这里只注入记录、播放和 UI 同步能力
    Object.assign(host, createRegenerator({
        records: host.records,
        selection: host.selection,
        input: ui.input,
        sampleRateOf: host.sampleRateOf,
        segmentIndex: host.segmentIndex,
        segmentSpans: host.segmentSpans,
        livePosition: host.livePosition,
        rescheduleTimeline: host.rescheduleTimeline,
        clearSegmentAudio: host.clearSegmentAudio,
        setSegmentState: host.setSegmentState,
        setSegmentLabel: host.setSegmentLabel,
        refreshRecordText: host.refreshRecordText,
        rebuildRecord: host.rebuildRecord,
        refreshSegmentControls: host.refreshSegmentControls,
        stopTimeline: host.stopTimeline,
        stopChain: host.stopChain,
        openSegmentPanel: host.openSegmentPanel,
        playChainSegment: host.playChainSegment,
        flashSegmentRegenButton: host.flashSegmentRegenButton,
    }));
    // 合成要覆盖 window.fetch；放在最后装配，确保开始新朗读时所有回调都已就位
    adopt(createSynthesis(host));
    adopt(createPanelLayout(host));

    try {
        const savedPlayRate = Number(localStorage.getItem(PLAY_RATE_STORE_KEY));
        if (PLAY_RATES.includes(savedPlayRate)) host.playRate = savedPlayRate;
    } catch {}
    ui.speed.value = String(host.playRate);
    ui.speed.addEventListener('change', () => {
        const value = Number(ui.speed.value);
        if (!PLAY_RATES.includes(value)) return;
        host.playRate = value;
        try {
            localStorage.setItem(PLAY_RATE_STORE_KEY, String(value));
        } catch {}
        // 正在播放的分段立即换速；实时时间线按当前位置重排
        for (const record of host.records) {
            for (const segment of record.segments) {
                if (segment.audio) segment.audio.playbackRate = value;
            }
            // 实时时间线没有 preservesPitch，换速会连音高一起变；按当前位置重排
            const session = record.session;
            if (!session) continue;
            const live = record.state === 'playing' || record.state === 'paused' || record.state === 'capturing';
            if (!live) continue;
            const position = host.livePosition(session);
            session.rate = value;
            session.pausedOffset = position;
            // 切到分段播放后时间线保持暂停，换速只影响分段 <audio>，不再重排时间线
            if (!session.paused) {
                host.rescheduleTimeline(record, position);
                if (record.state === 'playing') host.armTimelineEnd(record);
            }
        }
    });

    return () => {
        for (const dispose of disposers.splice(0).reverse()) {
            try {
                dispose();
            } catch (error) {
                console.warn('[SichangTools] 清理失败', error);
            }
        }
        for (const record of [...host.records]) host.removeRecord(record);
        host.activeAudio = null;
        host.activeSession = null;
        host.activeTimeline = null;
        if (host.audioContext && host.audioContext.state !== 'closed') {
            try {
                host.audioContext.close();
            } catch {}
        }
        ui.host.remove();
    };
}
