// 输入区：草稿、预填试听文本、字数/分段统计与「合成」入口。
// 选中记录或分段后由 selection 侧调用 setInputText 把文本填进来。
import {
    DEFAULT_INPUT_TEXT,
    DRAFT_STORE_KEY,
    RATE_STORE_KEY,
    VOICE_STORE_KEY,
} from './constants.js';
import { DEFAULT_VOICE } from './voices.js';
import { splitText } from './text.js';

export function createCompose(host) {
    const { ui } = host;

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
        if (isDefault) host.inputTyping = false;
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
        host.inputTyping = false;
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
        if (host.selection.record) {
            if (host.selection.segment) {
                const index = host.selection.record.segments.indexOf(host.selection.segment);
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
        host.inputTyping = true;
        setInputDefault(false);
        onInputChange();
    });
    // 聚焦即进入编辑：清掉预填的试听文本，让用户从空框开始打
    ui.input.addEventListener('focus', () => {
        if (!inputIsDefault) return;
        ui.input.value = '';
        host.inputTyping = false;
        setInputDefault(false);
        autoGrowInput();
        updateComposeMeta();
    });
    // 失焦后仍为空就恢复预填，保证空框里始终有段试听文本；
    // 正在编辑选中记录/分段时保持空框，不能把试听文本塞进重生成请求
    ui.input.addEventListener('blur', () => {
        if (host.selection.record) return;
        if (ui.input.value.trim()) return;
        ui.input.value = DEFAULT_INPUT_TEXT;
        setInputDefault(true);
        autoGrowInput();
        updateComposeMeta();
        saveDraft();
    });
    ui.clearInput.addEventListener('click', () => {
        ui.input.value = '';
        host.inputTyping = false;
        setInputDefault(false);
        host.applySelection(null, null);
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
        const savedVoice = localStorage.getItem(VOICE_STORE_KEY);
        if (savedVoice && [...ui.voice.options].some(option => option.value === savedVoice)) ui.voice.value = savedVoice;
        const savedRate = Number(localStorage.getItem(RATE_STORE_KEY));
        if (savedRate >= 0.5 && savedRate <= 2) ui.rate.value = String(savedRate);
    } catch {}

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
        host.inputTyping = true;
        host.startSession({ text, voice, rate, format: 'pcm16' });
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

    return {
        api: {
            currentTts,
            autoGrowInput,
            setInputDefault,
            saveDraft,
            setInputText,
            updateComposeMeta,
            onInputChange,
            submitCompose,
        },
    };
}
