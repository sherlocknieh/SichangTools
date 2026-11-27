// 官方输入框右侧的加号：把输入框文字直接变成一条用户气泡写入当前会话，不请求 AI 回复。
// 官方没有“只追加消息”的接口，这里复用 import；写入成功后通过 React context 立即插入气泡并清空输入。
// 输入区或按钮改版时优先核对 constants.js 里的发送/附件选择器。
import {
    ADD_BUBBLE_BUTTON_LABEL,
    ADD_BUBBLE_BUTTON_SELECTOR,
    CONVERSATION_IMPORT_MAX_CHARS,
    OFFICIAL_ATTACH_SELECTOR,
    OFFICIAL_SEND_SELECTOR,
} from './constants.js';
import {
    conversationOwner,
    errorMessage,
    importMessages,
    loadConversation,
    loadMessages,
    newId,
    nextSeq,
    readConversationId,
    request,
} from './conversation-api.js';
import { messageText } from './conversation-copy.js';
import { officialContext, setNativeValue } from './official-page.js';

const PLUS_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <path d="M5 12h14"></path>
        <path d="M12 5v14"></path>
    </svg>
`;

// 官方建会话时的标题规则：取正文前 30 字，超出加省略号。
function deriveTitle(content) {
    const text = String(content || '').trim();
    return text ? `${text.slice(0, 30)}${text.length > 30 ? '…' : ''}` : '新对话';
}

function findComposer() {
    for (const send of document.querySelectorAll(OFFICIAL_SEND_SELECTOR)) {
        const row = send.parentElement;
        if (!row) continue;
        // textarea 和发送按钮不在同一层：向上找最近的、同时包住两者的输入区容器。
        let container = row;
        for (let depth = 0; container && depth < 5; depth += 1) {
            const textarea = container.querySelector('textarea');
            if (textarea) return { send, row, textarea };
            container = container.parentElement;
        }
    }
    return null;
}

export function createAddBubble() {
    const state = {
        busy: false,
        observer: null,
        timer: 0,
    };
    let button = null;

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
        const composer = findComposer();
        if (!composer) return;
        const existing = composer.row.querySelector(ADD_BUBBLE_BUTTON_SELECTOR);
        if (existing) {
            button = existing;
            setBusy(state.busy);
            return;
        }
        // 复用官方附件按钮的 class，保持与输入区同尺寸；没有附件按钮时退回发送按钮样式。
        const source = composer.row.querySelector(OFFICIAL_ATTACH_SELECTOR) || composer.send;
        const next = source.cloneNode(false);
        next.setAttribute('data-sichang-add-bubble', '');
        next.setAttribute('aria-label', ADD_BUBBLE_BUTTON_LABEL);
        next.title = `${ADD_BUBBLE_BUTTON_LABEL}（提问/回答轮流）`;
        next.innerHTML = PLUS_ICON;
        composer.send.parentElement.insertBefore(next, composer.send);
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

    // 空输入也允许：官方 import 会跳过空正文，所以统一用零宽空格占位。
    function readInput(textarea) {
        if (textarea.disabled) throw new Error('输入框当前不可用，请等页面初始化完成。');
        const content = String(textarea.value || '').trim();
        if (content.length > CONVERSATION_IMPORT_MAX_CHARS) {
            throw new Error(`正文超过 ${CONVERSATION_IMPORT_MAX_CHARS} 字，官方导入接口会截断。`);
        }
        return content;
    }

    async function addBubble() {
        const composer = findComposer();
        if (!composer) throw new Error('AI 正在回复或输入区不可用，请等当前回复结束后再添加。');
        const content = readInput(composer.textarea);
        const cid = readConversationId();
        const owner = conversationOwner(cid);
        if (!cid || !owner) throw new Error('当前还没有云端会话，先正常发送一条消息创建会话。');
        if (owner === 'anonymous') throw new Error('当前是未登录的本地对话，暂不支持写入消息。请登录后打开云端对话。');

        const [meta, messages] = await Promise.all([
            loadConversation(cid),
            loadMessages(cid),
        ]);
        // 提问/回答轮流：最后一条是提问就补回答，否则补提问。
        const last = messages[messages.length - 1];
        const role = last?.role === 'user' ? 'assistant' : 'user';
        // 官方只在空会话的第一条用户消息上自动定标题；回答开头不抢标题。
        const title = !messages.length && role === 'user' ? deriveTitle(content) : meta.title;
        const message = {
            id: `msg__${owner}__${newId()}`,
            seq: nextSeq(messages),
            role,
            content: messageText(content),
            createdAt: Date.now(),
            state: 'complete',
        };

        if (!messages.length) {
            // 空会话的第一条消息决定标题；import 只追加消息，标题单独 PATCH，失败不阻断。
            try {
                await request(`/api/conversations/${encodeURIComponent(cid)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title }),
                });
            } catch {}
        }
        await importMessages(cid, { ...meta, title }, [message]);

        const context = officialContext(composer.send);
        const conversation = context?.activeConversation;
        let synced = false;
        if (conversation && conversation.id === cid) {
            try {
                context.upsertConversation({
                    ...conversation,
                    title,
                    messages: [...conversation.messages, { ...message }],
                    updatedAt: message.createdAt,
                });
                synced = true;
            } catch {}
        }
        // 清空官方受控输入框；放到最后，避免写入失败时白丢用户已经输入的文字。
        setNativeValue(composer.textarea, '');
        return synced;
    }

    async function onAddClick(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const hit = target.closest(ADD_BUBBLE_BUTTON_SELECTOR);
        if (!hit) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (state.busy || hit.disabled) return;
        setBusy(true);
        try {
            const synced = await addBubble();
            // 拿不到官方 React 状态时整页刷新，保证服务端和页面一致。
            if (!synced) window.location.reload();
        } catch (error) {
            console.warn(`[SichangTools] 添加消息失败：${errorMessage(error)}`);
        } finally {
            setBusy(false);
        }
    }

    ensureButton();
    // 用文档级委托而不是直接绑在按钮上：官方重绘可能换掉按钮节点，委托仍能收到点击。
    document.addEventListener('click', onAddClick, { capture: true });
    // 输入区会随会话切换/回复状态重绘，加号被官方一并移除时补插；不做轮询。
    state.observer = new MutationObserver(scheduleEnsure);
    state.observer.observe(document.body, { childList: true, subtree: true });

    return {
        api: {},
        dispose: () => {
            document.removeEventListener('click', onAddClick, { capture: true });
            state.observer?.disconnect();
            state.observer = null;
            if (state.timer) window.clearTimeout(state.timer);
            state.timer = 0;
            button?.remove();
            button = null;
        },
    };
}
