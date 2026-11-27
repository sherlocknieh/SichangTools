// 官方输入框右侧的加号：弹出「添加提问 / 添加回答」两个子选项，
// 选中后把输入框文字按该角色写成一条气泡，不请求 AI 回复。
// 官方没有“只追加消息”的接口，这里复用 import；写入成功后通过 React context 立即插入气泡并清空输入。
// 输入区或按钮改版时优先核对 constants.js 里的发送/附件选择器。
import {
    ADD_BUBBLE_BUTTON_LABEL,
    ADD_BUBBLE_BUTTON_SELECTOR,
    CONVERSATION_IMPORT_MAX_CHARS,
    OFFICIAL_ATTACH_SELECTOR,
} from './constants.js';
import { setBusyIcon } from './busy-icon.js';
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
import { findComposer, officialContext, setNativeValue } from './official-page.js';

const PLUS_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <path d="M5 12h14"></path>
        <path d="M12 5v14"></path>
    </svg>
`;

const MENU_SELECTOR = '[data-sichang-add-menu]';
const ROLE_SELECTOR = '[data-sichang-add-role]';
const MENU_STYLE_ID = 'sichang-add-bubble-style';
const MENU_CSS = `
.sichang-add-menu {
    position: fixed;
    z-index: 2147483647;
    min-width: 132px;
    padding: 4px;
    border: 1px solid var(--border, rgba(127, 127, 127, .28));
    border-radius: 12px;
    background: var(--card, #fff);
    box-shadow: 0 10px 28px rgba(0, 0, 0, .18);
    color: var(--foreground, #111);
    font: inherit;
}
.sichang-add-menu button {
    display: block;
    width: 100%;
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    text-align: left;
    font-size: 13px;
    line-height: 1.2;
    cursor: pointer;
}
.sichang-add-menu button:hover { background: var(--muted, rgba(127, 127, 127, .15)); }
.sichang-add-menu button:disabled { opacity: .5; cursor: not-allowed; }
`;

// 官方建会话时的标题规则：取正文前 30 字，超出加省略号。
function deriveTitle(content) {
    const text = String(content || '').trim();
    return text ? `${text.slice(0, 30)}${text.length > 30 ? '…' : ''}` : '新对话';
}

export function createAddBubble() {
    const state = {
        busy: false,
        observer: null,
        timer: 0,
        menu: null,
    };
    let button = null;

    function setBusy(busy) {
        state.busy = busy;
        if (!button) return;
        button.disabled = busy;
        setBusyIcon(button, busy);
        for (const option of state.menu?.querySelectorAll(ROLE_SELECTOR) ?? []) {
            option.disabled = busy;
        }
    }

    function ensureMenuStyle() {
        if (document.getElementById(MENU_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = MENU_STYLE_ID;
        style.textContent = MENU_CSS;
        document.head.appendChild(style);
    }

    function closeMenu() {
        state.menu?.remove();
        state.menu = null;
    }

    function positionMenu() {
        if (!state.menu || !button?.isConnected) return;
        const rect = button.getBoundingClientRect();
        state.menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
        state.menu.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 8)}px`;
    }

    function openMenu() {
        ensureMenuStyle();
        if (state.menu) {
            positionMenu();
            return;
        }
        const menu = document.createElement('div');
        menu.setAttribute('data-sichang-add-menu', '');
        menu.className = 'sichang-add-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `
            <button type="button" role="menuitem" data-sichang-add-role="user"${state.busy ? ' disabled' : ''}>添加提问</button>
            <button type="button" role="menuitem" data-sichang-add-role="assistant"${state.busy ? ' disabled' : ''}>添加回答</button>
        `;
        document.body.appendChild(menu);
        state.menu = menu;
        positionMenu();
    }

    function ensureButton() {
        if (button?.isConnected) {
            setBusy(state.busy);
            return;
        }
        const composer = findComposer();
        if (!composer?.send || !composer.row) return;
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
        next.title = `${ADD_BUBBLE_BUTTON_LABEL}（选择提问或回答）`;
        next.setAttribute('aria-haspopup', 'menu');
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
            if (state.menu) {
                if (button?.isConnected) positionMenu();
                else closeMenu();
            }
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

    async function addBubble(role) {
        const composer = findComposer();
        if (!composer?.send) throw new Error('AI 正在回复或输入区不可用，请等当前回复结束后再添加。');
        const content = readInput(composer.textarea);
        const cid = readConversationId();
        const owner = conversationOwner(cid);
        if (!cid || !owner) throw new Error('当前还没有云端会话，先正常发送一条消息创建会话。');
        if (owner === 'anonymous') throw new Error('当前是未登录的本地对话，暂不支持写入消息。请登录后打开云端对话。');

        const [meta, messages] = await Promise.all([
            loadConversation(cid),
            loadMessages(cid),
        ]);
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

    async function runAdd(role) {
        closeMenu();
        if (state.busy) return;
        setBusy(true);
        try {
            const synced = await addBubble(role);
            // 拿不到官方 React 状态时整页刷新，保证服务端和页面一致。
            if (!synced) window.location.reload();
        } catch (error) {
            console.warn(`[SichangTools] 添加消息失败：${errorMessage(error)}`);
        } finally {
            setBusy(false);
        }
    }

    function onAddClick(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;

        // 菜单项：按选中角色写入。
        const option = target.closest(ROLE_SELECTOR);
        if (option) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const role = option.getAttribute('data-sichang-add-role') === 'assistant' ? 'assistant' : 'user';
            runAdd(role);
            return;
        }

        // 加号：开/关菜单。
        const plus = target.closest(ADD_BUBBLE_BUTTON_SELECTOR);
        if (plus) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (state.busy) return;
            if (state.menu) closeMenu();
            else openMenu();
            return;
        }

        // 点菜单外关闭，不拦截页面自己的点击。
        if (state.menu && !target.closest(MENU_SELECTOR)) closeMenu();
    }

    function onMenuKeyDown(event) {
        if (event.key === 'Escape' && state.menu) closeMenu();
    }

    ensureButton();
    // 用文档级委托而不是直接绑在按钮上：官方重绘可能换掉按钮节点，委托仍能收到点击。
    document.addEventListener('click', onAddClick, { capture: true });
    window.addEventListener('keydown', onMenuKeyDown, true);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    // 输入区会随会话切换/回复状态重绘，加号被官方一并移除时补插；不做轮询。
    state.observer = new MutationObserver(scheduleEnsure);
    state.observer.observe(document.body, { childList: true, subtree: true });

    return {
        api: {},
        dispose: () => {
            document.removeEventListener('click', onAddClick, { capture: true });
            window.removeEventListener('keydown', onMenuKeyDown, true);
            window.removeEventListener('scroll', closeMenu, true);
            window.removeEventListener('resize', closeMenu);
            closeMenu();
            document.getElementById(MENU_STYLE_ID)?.remove();
            state.observer?.disconnect();
            state.observer = null;
            if (state.timer) window.clearTimeout(state.timer);
            state.timer = 0;
            button?.remove();
            button = null;
        },
    };
}
