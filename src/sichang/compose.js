// 输入区：语音面板不再自带文本框，直接读写官方输入框里的文字。
// 选中记录/分段、播放跟随和重生成都走同一个 textarea；这里只负责绑定和同步按钮状态。
import {
    ADD_BUBBLE_BUTTON_SELECTOR,
    COMPOSE_BUTTON_LABEL,
    COMPOSE_BUTTON_SELECTOR,
    OFFICIAL_ATTACH_SELECTOR,
    VOICE_STORE_KEY,
} from './constants.js';
import { DEFAULT_VOICE } from './voices.js';
import { canMutate } from './hydration.js';
import { ICONS } from './icons.js';
import { findComposer, setNativeValue } from './official-page.js';

const GO_STYLE_ID = 'sichang-compose-style';
// 生成按钮在官方按钮组里，样式走文档级注入，避免依赖面板的 Shadow DOM
const GO_CSS = `
button[data-sichang-go] {
    background: #418a55 !important;
    color: #f2fff5 !important;
}
button[data-sichang-go] > svg { display: block; width: 16px; height: 16px; }
button[data-sichang-go]:hover:not(:disabled) { background: #4d9c63 !important; color: #fff !important; }
button[data-sichang-go].paused { background: #7a5f2e !important; color: #ffe6b8 !important; }
button[data-sichang-go].paused:hover:not(:disabled) { background: #8b6d35 !important; }
button[data-sichang-go]:disabled { opacity: .4 !important; cursor: default !important; }
`;

export function createCompose(host) {
    const { ui } = host;
    // 官方输入区会随水合/切会话整体替换，始终以最新绑定到的 textarea 为准
    let textarea = null;
    // 生成按钮跟着官方按钮组一起被 React 重绘，不在当前按钮行时重建
    let goButton = null;
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
        if (!goButton) return;
        const session = activeSynthesis();
        if (session) {
            const paused = Boolean(session.synthesisPaused);
            goButton.innerHTML = paused ? ICONS.play : ICONS.pause;
            goButton.classList.toggle('paused', paused);
            goButton.disabled = false;
            const label = paused ? '继续合成' : '暂停合成';
            goButton.title = label;
            goButton.setAttribute('aria-label', label);
            return;
        }
        goButton.innerHTML = ICONS.synth;
        goButton.classList.remove('paused');
        goButton.title = '读取官方输入框文字合成语音';
        goButton.setAttribute('aria-label', COMPOSE_BUTTON_LABEL);
        goButton.disabled = !getInputText().trim();
    }

    // 生成按钮和加号同属官方按钮行：发送 → 加号 → 生成。
    // 由 panel-layout 在每次挂载检查时调用；节点被 React 重绘掉后在这里重建。
    function ensureGoButton(composer = findComposer()) {
        if (!composer?.send || !composer.row) return;
        if (!canMutate(composer.row)) return;
        if (!document.getElementById(GO_STYLE_ID)) {
            const style = document.createElement('style');
            style.id = GO_STYLE_ID;
            style.textContent = GO_CSS;
            document.head.appendChild(style);
        }
        const existing = composer.row.querySelector(COMPOSE_BUTTON_SELECTOR);
        if (existing) {
            goButton = existing;
        } else {
            // 复用官方附件按钮的尺寸，没有附件按钮时退回发送按钮。
            const source = composer.row.querySelector(OFFICIAL_ATTACH_SELECTOR) || composer.send;
            const next = source.cloneNode(false);
            next.setAttribute('data-sichang-go', '');
            next.setAttribute('type', 'button');
            next.setAttribute('aria-label', COMPOSE_BUTTON_LABEL);
            next.title = '读取官方输入框文字合成语音';
            next.innerHTML = ICONS.synth;
            goButton = next;
        }
        // 加号插在发送按钮后面；生成始终紧跟加号，避免后插入的节点打乱顺序。
        const plus = composer.row.querySelector(ADD_BUBBLE_BUTTON_SELECTOR);
        const anchor = plus || composer.send;
        if (goButton.previousElementSibling !== anchor) {
            anchor.parentElement.insertBefore(goButton, anchor.nextSibling);
        }
        syncGoButton();
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

    // 按钮会随官方重绘换节点，用文档级委托，点击时不冒泡给官方输入区。
    function onGoClick(event) {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest(COMPOSE_BUTTON_SELECTOR)) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        triggerCompose();
    }
    document.addEventListener('click', onGoClick, true);

    return {
        api: {
            currentTts,
            setInputText,
            getInputText,
            isInputFocused,
            hasPendingInput,
            bindInput,
            syncGoButton,
            ensureGoButton,
            submitCompose,
            activeSynthesis,
        },
        dispose: () => {
            document.removeEventListener('click', onGoClick, true);
            document.getElementById(GO_STYLE_ID)?.remove();
            goButton?.remove();
            goButton = null;
        },
    };
}
