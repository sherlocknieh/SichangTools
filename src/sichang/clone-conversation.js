// 克隆官方会话：读取当前对话的元数据和全部消息，新建一个副本。
// 入口是聊天页顶栏「新建对话」左侧的按钮；官方没有克隆接口，复制实现见 conversation-copy.js。
// 站点改版时优先核对顶栏选择器与 conversation-api.js 里的接口契约。
import {
    CLONE_BUTTON_LABEL,
    CLONE_BUTTON_SELECTOR,
    CLONE_TITLE_SUFFIX,
    OFFICIAL_CHAT_HEADER_SELECTOR,
    OFFICIAL_HEADER_HISTORY_SELECTOR,
    OFFICIAL_NEW_CHAT_SELECTOR,
} from './constants.js';
import { readConversationId } from './conversation-api.js';
import { copyConversation, readConversationForCopy } from './conversation-copy.js';
import { officialContext } from './official-page.js';

const COPY_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
    </svg>
`;

function cloneTitle(title) {
    return `${title || '新对话'}${CLONE_TITLE_SUFFIX}`;
}

export function createConversationClone() {
    const state = {
        busy: false,
        observer: null,
        timer: 0,
    };
    let button = null;

    function findHeader() {
        for (const element of document.querySelectorAll(OFFICIAL_CHAT_HEADER_SELECTOR)) {
            if (element.querySelector(OFFICIAL_HEADER_HISTORY_SELECTOR)
                && element.querySelector(OFFICIAL_NEW_CHAT_SELECTOR)) {
                return element;
            }
        }
        return null;
    }

    function setBusy(busy) {
        state.busy = busy;
        if (!button) return;
        button.disabled = busy;
        button.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    function ensureButton() {
        if (button?.isConnected) {
            setBusy(state.busy);
            return;
        }
        const header = findHeader();
        if (!header) return;
        const existing = header.querySelector(CLONE_BUTTON_SELECTOR);
        if (existing) {
            button = existing;
            setBusy(state.busy);
            return;
        }
        const source = header.querySelector(OFFICIAL_NEW_CHAT_SELECTOR);
        if (!source) return;
        // 直接复制官方按钮的 class，站点换主题/尺寸时不用再维护一套 Tailwind。
        const next = source.cloneNode(false);
        next.setAttribute('data-sichang-clone', '');
        next.setAttribute('aria-label', CLONE_BUTTON_LABEL);
        next.title = CLONE_BUTTON_LABEL;
        next.innerHTML = COPY_ICON;
        source.parentElement.insertBefore(next, source);
        button = next;
        setBusy(state.busy);
    }

    function scheduleEnsure() {
        if (state.timer) return;
        state.timer = window.setTimeout(() => {
            state.timer = 0;
            ensureButton();
        }, 120);
    }

    async function applyClone() {
        const sourceCid = readConversationId();
        if (!sourceCid) throw new Error('当前没有可克隆的会话。');
        const anchor = findHeader()?.querySelector(OFFICIAL_NEW_CHAT_SELECTOR);
        const context = anchor ? officialContext(anchor) : null;
        const { meta, messages } = await readConversationForCopy(sourceCid, context);
        return copyConversation({
            sourceCid,
            context,
            meta,
            messages,
            title: cloneTitle(meta.title),
        });
    }

    async function onCloneClick(event) {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest(CLONE_BUTTON_SELECTOR)) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (state.busy) return;
        setBusy(true);
        try {
            const result = await applyClone();
            const path = `/chat/${encodeURIComponent(result.cid)}`;
            // 本地副本已经切换好 React 状态，只改地址；远端副本需要整页加载服务端数据。
            if (result.local) window.history.replaceState(null, '', path);
            else window.location.assign(path);
        } catch (error) {
            console.warn('[SichangTools] 克隆失败：', error);
        } finally {
            setBusy(false);
        }
    }

    ensureButton();
    // 用文档级委托，官方重绘换掉按钮节点后点击仍然有效。
    document.addEventListener('click', onCloneClick, { capture: true });
    // SPA 切会话/窗口尺寸变化时官方会重绘顶栏，按钮可能被 React 一并移除；只做去抖后的补插。
    state.observer = new MutationObserver(scheduleEnsure);
    state.observer.observe(document.body, { childList: true, subtree: true });

    return {
        api: {},
        dispose: () => {
            document.removeEventListener('click', onCloneClick, { capture: true });
            state.observer?.disconnect();
            state.observer = null;
            if (state.timer) window.clearTimeout(state.timer);
            state.timer = 0;
            button?.remove();
            button = null;
        },
    };
}
