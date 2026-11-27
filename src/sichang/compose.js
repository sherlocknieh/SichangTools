// 输入区：语音面板不再自带文本框，直接读写官方输入框里的文字。
// 选中记录/分段、播放跟随和重生成都走同一个 textarea；这里只负责绑定和同步按钮状态。
import { VOICE_STORE_KEY } from './constants.js';
import { DEFAULT_VOICE } from './voices.js';
import { ICONS } from './icons.js';
import { setNativeValue } from './official-page.js';

export function createCompose(host) {
    const { ui } = host;
    // 官方输入区会随水合/切会话整体替换，始终以最新绑定到的 textarea 为准
    let textarea = null;
    // 程序化写入时 setNativeValue 也会派发 input，用它区分“用户手输”
    let writing = false;

    // 选完立刻记住：官方按钮也走面板音色，不点「合成」也不会丢这次选择
    ui.voice.addEventListener('change', () => {
        try {
            localStorage.setItem(VOICE_STORE_KEY, ui.voice.value);
        } catch {}
    });

    // 生成选项只保留音色，合成语速固定 1×；播放倍速是另一套，只影响已下载音频
    function currentTts() {
        return { voice: ui.voice.value || DEFAULT_VOICE, rate: 1 };
    }

    // 合成期间「合成」按钮改为暂停/继续；只有还在流式合成的记录算活跃会话
    function activeSynthesis() {
        const session = host.activeSession;
        if (!session || session.stopped || !session.record) return null;
        if (!host.records.includes(session.record)) return null;
        if (session.record.state !== 'capturing') return null;
        return session;
    }

    function syncGoButton() {
        const session = activeSynthesis();
        if (session) {
            const paused = Boolean(session.synthesisPaused);
            ui.go.innerHTML = paused ? ICONS.play : ICONS.pause;
            ui.go.classList.toggle('paused', paused);
            ui.go.disabled = false;
            const label = paused ? '继续合成' : '暂停合成';
            ui.go.title = label;
            ui.go.setAttribute('aria-label', label);
            return;
        }
        ui.go.innerHTML = ICONS.synth;
        ui.go.classList.remove('paused');
        ui.go.title = '读取官方输入框文字合成语音';
        ui.go.setAttribute('aria-label', '合成语音');
        ui.go.disabled = !getInputText().trim();
    }

    function getInputText() {
        return textarea?.isConnected ? String(textarea.value || '') : '';
    }

    function isInputFocused() {
        return Boolean(textarea?.isConnected) && textarea.getRootNode().activeElement === textarea;
    }

    // 输入框里有用户还没提交的草稿时才挡播放跟随；官方发送后清空输入框会自动解除
    function hasPendingInput() {
        if (!host.inputTyping) return false;
        if (!getInputText().trim()) {
            host.inputTyping = false;
            return false;
        }
        return true;
    }

    // 选中记录/分段或播放跟随时写回官方输入框；必须走原生 setter，React 受控值才不会回弹
    function setInputText(text) {
        if (!textarea?.isConnected) return;
        writing = true;
        try {
            setNativeValue(textarea, String(text ?? ''));
        } finally {
            writing = false;
        }
        host.inputTyping = false;
        syncGoButton();
    }

    function onUserInput() {
        if (writing) return;
        host.inputTyping = true;
        syncGoButton();
    }

    function onKeydown(event) {
        // Ctrl/Cmd+Enter 改成“合成语音”；冒泡阶段拦下，官方 Enter 发送逻辑不受影响
        if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        event.stopPropagation();
        submitCompose();
    }

    // 面板每次重新挂载到官方输入卡片时，把事件绑到当前的 textarea 上
    function bindInput(next) {
        if (!next || next === textarea) {
            syncGoButton();
            return;
        }
        if (textarea) {
            textarea.removeEventListener('input', onUserInput);
            textarea.removeEventListener('keydown', onKeydown);
        }
        textarea = next;
        textarea.addEventListener('input', onUserInput);
        textarea.addEventListener('keydown', onKeydown);
        host.inputTyping = false;
        syncGoButton();
    }

    try {
        const savedVoice = localStorage.getItem(VOICE_STORE_KEY);
        if (savedVoice && [...ui.voice.options].some(option => option.value === savedVoice)) ui.voice.value = savedVoice;
    } catch {}

    // 还没有输入区（会话列表页）时保持禁用，挂载后由 bindInput 刷新
    syncGoButton();

    function submitCompose() {
        const text = getInputText().trim();
        if (!text) {
            textarea?.focus();
            return;
        }
        const { voice, rate } = currentTts();
        try {
            localStorage.setItem(VOICE_STORE_KEY, voice);
        } catch {}
        // 不清空输入：换音色后可以直接再点合成，反复试听。
        // 这段文本是用户刚写的，标记成手输内容，实时播放跟随不能覆盖它
        host.inputTyping = true;
        host.startSession({ text, voice, rate, format: 'pcm16' });
        syncGoButton();
    }

    // 合成进行中按钮就是暂停开关；快捷键 Ctrl/Cmd+Enter 仍直接发起新合成
    function triggerCompose() {
        if (activeSynthesis()) {
            host.toggleSynthesisPause?.();
            return;
        }
        submitCompose();
    }

    ui.go.addEventListener('click', triggerCompose);

    return {
        api: {
            currentTts,
            setInputText,
            getInputText,
            isInputFocused,
            hasPendingInput,
            bindInput,
            syncGoButton,
            submitCompose,
            activeSynthesis,
        },
    };
}
