// 每条官方消息操作行里的「复刻到这条消息」：把当前会话截到该条为止复制成新会话。
// 按钮以官方「复制消息」按钮为锚点注入；点击顺序对应官方消息顺序，数量不一致时拒绝。
import { clearBusyIcons, setBusyIcon } from './busy-icon.js';
import { canMutate, onSettled } from './hydration.js';
import {
    FORK_BUTTON_LABEL,
    FORK_BUTTON_SELECTOR,
    OFFICIAL_COPY_SELECTOR,
} from './constants.js';
import { readConversationId } from './conversation-api.js';
import { copyConversation, readConversationForCopy } from './conversation-copy.js';
import { officialContext } from './official-page.js';

const FORK_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="18" r="3"></circle>
        <circle cx="6" cy="6" r="3"></circle>
        <circle cx="18" cy="6" r="3"></circle>
        <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"></path>
        <path d="M12 12v3"></path>
    </svg>
`;

function copyButtons() {
    return Array.from(document.querySelectorAll(OFFICIAL_COPY_SELECTOR));
}

function actionRowOf(copy) {
    const span = copy?.parentElement;
    return span?.parentElement ?? null;
}

export function createForkMessage() {
    const state = {
        busy: false,
        observer: null,
        timer: 0,
    };

    function setBusy(busy, active = null) {
        state.busy = busy;
        for (const button of document.querySelectorAll(FORK_BUTTON_SELECTOR)) {
            button.disabled = busy;
            setBusyIcon(button, busy && button === active);
        }
    }

    function ensureButtons() {
        for (const copy of copyButtons()) {
            const span = copy.parentElement;
            const row = actionRowOf(copy);
            if (!span || !row || row.querySelector(FORK_BUTTON_SELECTOR)) continue;
            // 水合完成前不要往消息操作行插节点，否则会触发 React 整页重渲染
            if (!canMutate(row)) continue;
            // 复制官方按钮外壳，尺寸、颜色和悬浮态都跟操作行一致。
            const wrapper = span.cloneNode(true);
            const button = wrapper.querySelector('button');
            if (!button) continue;
            button.setAttribute('data-sichang-fork', '');
            button.setAttribute('aria-label', FORK_BUTTON_LABEL);
            button.title = FORK_BUTTON_LABEL;
            button.innerHTML = FORK_ICON;
            button.disabled = state.busy;
            row.insertBefore(wrapper, span);
        }
    }

    function scheduleEnsure() {
        if (state.timer) return;
        state.timer = window.setTimeout(() => {
            state.timer = 0;
            ensureButtons();
        }, 120);
    }

    async function forkAt(copy, index) {
        const cid = readConversationId();
        if (!cid) throw new Error('当前没有可复刻的会话。');
        const context = officialContext(copy);
        const conversation = context?.activeConversation;
        if (!conversation || conversation.id !== cid) {
            throw new Error('无法读取官方当前会话，请等消息加载完成。');
        }
        const buttons = copyButtons();
        // 消息数量与操作行不一致时不猜映射，避免复刻到错误的位置。
        if (buttons.length !== conversation.messages.length || index < 0 || index >= conversation.messages.length) {
            throw new Error('消息列表已变化，请等页面稳定后重试。');
        }
        const target = conversation.messages[index];
        const source = await readConversationForCopy(cid, context);
        let fullIndex = source.messages.findIndex(message => message.id === target.id);
        if (fullIndex < 0 && typeof target.seq === 'number') {
            fullIndex = source.messages.findIndex(message => message.seq === target.seq);
        }
        if (fullIndex < 0) throw new Error('在会话里找不到这条消息，请刷新后重试。');
        const messages = source.messages.slice(0, fullIndex + 1);
        const title = `${source.meta.title || '新对话'}（前${messages.length}条）`;
        return copyConversation({ sourceCid: cid, meta: source.meta, messages, title });
    }

    async function onForkClick(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest(FORK_BUTTON_SELECTOR);
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (state.busy || button.disabled) return;

        const row = button.parentElement?.parentElement;
        const copy = row?.querySelector(OFFICIAL_COPY_SELECTOR);
        if (!copy) return;
        const index = copyButtons().indexOf(copy);
        setBusy(true, button);
        try {
            const result = await forkAt(copy, index);
            window.location.assign(`/chat/${encodeURIComponent(result.cid)}`);
        } catch (error) {
            console.warn('[SichangTools] 复刻失败：', error);
        } finally {
            setBusy(false);
        }
    }

    ensureButtons();
    // 消息列表会频繁重绘，委托点击避免按钮节点被换掉后丢事件。
    document.addEventListener('click', onForkClick, { capture: true });
    state.observer = new MutationObserver(scheduleEnsure);
    state.observer.observe(document.body, { childList: true, subtree: true });
    // 水合完成时不一定有 DOM 变化，补一次插入检查
    const unsubscribeSettled = onSettled(scheduleEnsure);

    return {
        api: {},
        dispose: () => {
            document.removeEventListener('click', onForkClick, { capture: true });
            state.observer?.disconnect();
            state.observer = null;
            unsubscribeSettled();
            if (state.timer) window.clearTimeout(state.timer);
            state.timer = 0;
            for (const button of document.querySelectorAll(FORK_BUTTON_SELECTOR)) {
                button.parentElement?.remove();
            }
            clearBusyIcons();
        },
    };
}
