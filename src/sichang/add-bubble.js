// 官方的「添加消息气泡」入口有两处：
// - 输入框右侧的加号：把输入文字追加到当前会话末尾；
// - 每条消息操作行里的加号：把输入文字插入到该条消息下方。
// 两者都弹出「添加提问 / 添加回答」，选中后按该角色写入，不请求 AI 回复。
// 追加直接用 import；插入中间位置要先 DELETE 截断，再用 import 补回新消息和原尾部。
// 写入成功后通过 React context 立即更新气泡并清空输入。
// 输入区、消息操作行或按钮改版时优先核对 constants.js 里的发送/附件/复制选择器。
import {
    ADD_BUBBLE_BUTTON_LABEL,
    ADD_BUBBLE_BUTTON_SELECTOR,
    CONVERSATION_IMPORT_MAX_CHARS,
    INSERT_BUBBLE_BUTTON_LABEL,
    INSERT_BUBBLE_BUTTON_SELECTOR,
    OFFICIAL_ATTACH_SELECTOR,
    OFFICIAL_COPY_SELECTOR,
} from './constants.js';
import { clearBusyIcons, setBusyIcon } from './busy-icon.js';
import { canMutate, onSettled } from './hydration.js';
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

function copyButtons() {
    return Array.from(document.querySelectorAll(OFFICIAL_COPY_SELECTOR));
}

function sameOrder(actual, expected) {
    if (actual.length !== expected.length) return false;
    for (let index = 0; index < actual.length; index += 1) {
        if (actual[index].id !== expected[index].id) return false;
        if (actual[index].content !== expected[index].content) return false;
        if (actual[index].role !== expected[index].role) return false;
    }
    return true;
}

export function createAddBubble() {
    const state = {
        busy: false,
        observer: null,
        timer: 0,
        menu: null,
        anchor: null,
        target: null,
        activeButton: null,
    };
    // 输入区右侧的加号；消息操作行里的加号按需补插，不长期缓存。
    let button = null;

    function setBusy(busy, active = null) {
        state.busy = busy;
        state.activeButton = busy ? active : null;
        const buttons = [
            ...(button ? [button] : []),
            ...document.querySelectorAll(INSERT_BUBBLE_BUTTON_SELECTOR),
        ];
        for (const item of buttons) {
            item.disabled = busy;
            setBusyIcon(item, busy && item === state.activeButton);
        }
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
        state.anchor = null;
        state.target = null;
    }

    function positionMenu() {
        if (!state.menu || !state.anchor?.isConnected) return;
        const rect = state.anchor.getBoundingClientRect();
        const menuHeight = state.menu.offsetHeight;
        // 默认向上弹；顶部空间不足时改到按钮下方，避免菜单被视口裁掉。
        if (rect.top < menuHeight + 12) {
            state.menu.style.top = `${rect.bottom + 8}px`;
            state.menu.style.bottom = '';
        } else {
            state.menu.style.top = '';
            state.menu.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 8)}px`;
        }
        state.menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    }

    function openMenu(anchor, target) {
        ensureMenuStyle();
        closeMenu();
        const insert = target.kind === 'insert';
        const menu = document.createElement('div');
        menu.setAttribute('data-sichang-add-menu', '');
        menu.className = 'sichang-add-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `
            <button type="button" role="menuitem" data-sichang-add-role="user"${state.busy ? ' disabled' : ''}>${insert ? '在下方插入提问' : '添加提问'}</button>
            <button type="button" role="menuitem" data-sichang-add-role="assistant"${state.busy ? ' disabled' : ''}>${insert ? '在下方插入回答' : '添加回答'}</button>
        `;
        document.body.appendChild(menu);
        state.menu = menu;
        state.anchor = anchor;
        state.target = target;
        positionMenu();
    }

    function ensureComposerButton() {
        const composer = findComposer();
        if (!composer?.send || !composer.row) return;
        // 水合完成前不要往官方输入行插节点，否则会触发 React 整页重渲染
        if (!canMutate(composer.row)) return;
        const existing = composer.row.querySelector(ADD_BUBBLE_BUTTON_SELECTOR);
        // 加号紧贴发送按钮左侧；被 React 重绘打乱时也重新归位
        if (existing) {
            if (existing.nextElementSibling !== composer.send) {
                composer.send.parentElement.insertBefore(existing, composer.send);
            }
            button = existing;
            setBusy(state.busy, state.activeButton);
            return;
        }
        if (button?.isConnected) {
            setBusy(state.busy, state.activeButton);
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
        // 按钮组顺序：语音 → 加号 → 发送，加号紧贴在发送按钮左侧
        composer.send.parentElement.insertBefore(next, composer.send);
        button = next;
        setBusy(state.busy);
    }

    // 每条消息操作行复制一份官方按钮外壳，插在「复制消息」前面。
    function ensureMessageButtons() {
        for (const copy of copyButtons()) {
            const span = copy.parentElement;
            const row = span?.parentElement;
            if (!span || !row || row.querySelector(INSERT_BUBBLE_BUTTON_SELECTOR)) continue;
            // 水合完成前不要往消息操作行插节点，否则会触发 React 整页重渲染
            if (!canMutate(row)) continue;
            const wrapper = span.cloneNode(true);
            const insert = wrapper.querySelector('button');
            if (!insert) continue;
            insert.setAttribute('data-sichang-insert-bubble', '');
            insert.setAttribute('aria-label', INSERT_BUBBLE_BUTTON_LABEL);
            insert.title = `${INSERT_BUBBLE_BUTTON_LABEL}（选择插入提问或回答）`;
            insert.setAttribute('aria-haspopup', 'menu');
            insert.innerHTML = PLUS_ICON;
            insert.disabled = state.busy;
            row.insertBefore(wrapper, span);
        }
    }

    function scheduleEnsure() {
        if (state.timer) return;
        state.timer = window.setTimeout(() => {
            state.timer = 0;
            ensureComposerButton();
            ensureMessageButtons();
            if (state.menu) {
                if (state.anchor?.isConnected) positionMenu();
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

    function readTarget(cid) {
        const composer = findComposer();
        if (!composer?.send) throw new Error('AI 正在回复或输入区不可用，请等当前回复结束后再添加。');
        const content = readInput(composer.textarea);
        const owner = conversationOwner(cid);
        if (!cid || !owner) throw new Error('当前还没有云端会话，先正常发送一条消息创建会话。');
        return { composer, content, owner };
    }

    async function addBubble(role) {
        const cid = readConversationId();
        const { composer, content, owner } = readTarget(cid);

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

    // 插入成功但 React 状态同步失败时没法只重绘，返回 false 让调用方整页刷新。
    function syncOfficialPage(context, conversation, after, inserted, targetId) {
        if (!context || !conversation) return false;
        const latest = new Map(after.map(message => [message.id, message]));
        const next = [];
        let insertedFound = false;
        for (const message of conversation.messages) {
            const server = latest.get(message.id);
            if (!server) continue;
            // 保留官方前端的本地对象（媒体、变体等结构不被重导入破坏），只校正被重排后的 seq/createdAt。
            const moved = server.seq !== message.seq || server.createdAt !== message.createdAt;
            next.push(moved ? { ...message, seq: server.seq, createdAt: server.createdAt } : message);
            if (message.id === targetId) {
                // 新消息在服务端已经存在；用服务端对象插到目标消息后面。
                next.push({ ...inserted });
                insertedFound = true;
            }
        }
        if (!insertedFound) return false;
        try {
            context.upsertConversation({ ...conversation, messages: next, updatedAt: Date.now() });
            return true;
        } catch {
            return false;
        }
    }

    function downloadBackup(meta, messages) {
        const blob = new Blob([JSON.stringify({ conversation: meta, messages }, null, 2)], {
            type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `sichang-message-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // 新消息占用 seq 位置；官方刷新后会按 createdAt 合并排序，所以时间必须紧跟目标。
    // 尾部保持原时间，只有和目标撞在同一毫秒时才依次后移 1ms。
    function planInsertedMessage({ role, content, owner, seq, target, tailMessages }) {
        const targetAt = Number(target.createdAt);
        const baseAt = Number.isFinite(targetAt) && targetAt > 0 ? targetAt : Date.now();
        const insertedAt = baseAt + 1;
        const message = {
            id: `msg__${owner}__${newId()}`,
            seq,
            role,
            content: messageText(content),
            createdAt: insertedAt,
            state: 'complete',
        };
        let previousAt = insertedAt;
        const tail = tailMessages.map((item, offset) => {
            const originalAt = Number(item.createdAt) || 0;
            const createdAt = originalAt > previousAt ? originalAt : previousAt + 1;
            previousAt = createdAt;
            return {
                ...item,
                seq: seq + 1 + offset,
                createdAt,
                content: messageText(item.content),
            };
        });
        return { message, tail };
    }

    // 在 target 指向的消息后面插入一条：先截断原尾部，再按新顺序 import。
    async function insertBubble(role, target) {
        const cid = readConversationId();
        const { composer, content, owner } = readTarget(cid);
        const context = officialContext(target.copy);
        const conversation = context?.activeConversation;
        if (!conversation || conversation.id !== cid) {
            throw new Error('无法读取官方当前会话，请等消息加载完成。');
        }
        // 按钮和消息按文档顺序一一对应；数量和节点变化时不猜位置。
        const buttonsNow = copyButtons();
        const sameButtons = buttonsNow.length === target.buttonsAtClick.length
            && buttonsNow.every((item, index) => item === target.buttonsAtClick[index]);
        if (!sameButtons
            || conversation.messages.length !== target.buttonsAtClick.length
            || target.indexAtClick < 0
            || target.indexAtClick >= conversation.messages.length) {
            throw new Error('消息列表已变化，请等页面稳定后重试。');
        }
        const local = conversation.messages[target.indexAtClick];

        const [meta, fresh] = await Promise.all([
            loadConversation(cid),
            loadMessages(cid),
        ]);
        let index = fresh.findIndex(message => message.id === local.id);
        if (index < 0 && typeof local.seq === 'number') {
            index = fresh.findIndex(message => message.seq === local.seq);
        }
        if (index < 0) throw new Error('在会话里找不到这条消息，请刷新后重试。');

        // 新消息占用原尾部第一条的位置；没有尾部时接在最后。
        const insertSeq = fresh[index + 1] ? fresh[index + 1].seq : nextSeq(fresh);
        const originalTail = fresh.slice(index + 1);
        const { message, tail } = planInsertedMessage({
            role,
            content,
            owner,
            seq: insertSeq,
            target: fresh[index],
            tailMessages: originalTail,
        });
        const tooLong = tail.find(item => String(item.content || '').length > CONVERSATION_IMPORT_MAX_CHARS);
        if (tooLong) {
            throw new Error(`第 #${tooLong.seq} 条消息超过 ${CONVERSATION_IMPORT_MAX_CHARS} 字，官方导入接口会截断，已取消。`);
        }
        const expected = [
            ...fresh.slice(0, index + 1),
            message,
            ...tail,
        ];

        let deleted = false;
        try {
            // DELETE 的语义是“从目标起全部删除”，所以从原尾部第一条开始截断。
            if (originalTail.length) {
                deleted = true;
                await request(
                    `/api/conversations/${encodeURIComponent(cid)}/messages/${encodeURIComponent(originalTail[0].id)}`,
                    { method: 'DELETE' },
                );
            }
            await importMessages(cid, meta, [message, ...tail]);

            const after = await loadMessages(cid);
            if (!sameOrder(after, expected)) {
                throw new Error('写入后校验失败：官方消息顺序与预期不一致，可能被其他窗口改动了。');
            }
            const inserted = after.find(item => item.id === message.id) || message;
            // 清空官方受控输入框；放到最后，避免写入失败时白丢用户已经输入的文字。
            setNativeValue(composer.textarea, '');
            return syncOfficialPage(context, conversation, after, inserted, local.id);
        } catch (error) {
            if (!deleted) throw error;
            // DELETE 已发出：尝试把原尾部按原 seq 补回，避免截断后留下半截会话。
            try {
                const restoredTail = originalTail.map((item, offset) => ({
                    ...item,
                    seq: originalTail[0].seq + offset,
                    content: messageText(item.content),
                }));
                if (restoredTail.length) await importMessages(cid, meta, restoredTail);
                const restored = await loadMessages(cid);
                const original = fresh.map(item => ({ ...item, content: messageText(item.content) }));
                if (!sameOrder(restored, original)) throw new Error('补回后校验失败');
            } catch (restoreError) {
                downloadBackup(meta, fresh);
                throw new Error(
                    `插入失败：${errorMessage(error)}；自动补回也失败：${errorMessage(restoreError)}。已自动下载备份，刷新前请保留。`,
                );
            }
            throw new Error(`插入失败：${errorMessage(error)}。已尝试补回原消息，请确认页面内容。`);
        }
    }

    async function runRole(role) {
        const target = state.target;
        closeMenu();
        if (state.busy) return;
        const active = target?.kind === 'insert' ? target.button : button;
        const inserting = target?.kind === 'insert';
        setBusy(true, active);
        try {
            const synced = inserting
                ? await insertBubble(role, target)
                : await addBubble(role);
            // 拿不到官方 React 状态时整页刷新，保证服务端和页面一致。
            if (!synced) window.location.reload();
        } catch (error) {
            console.warn(`[SichangTools] ${inserting ? '插入' : '添加'}消息失败：${errorMessage(error)}`);
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
            runRole(role);
            return;
        }

        // 消息操作行里的加号：记录目标消息，再开菜单。
        const insert = target.closest(INSERT_BUBBLE_BUTTON_SELECTOR);
        if (insert) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (state.busy) return;
            if (state.menu && state.anchor === insert) {
                closeMenu();
                return;
            }
            const row = insert.parentElement?.parentElement;
            const copy = row?.querySelector(OFFICIAL_COPY_SELECTOR);
            if (!copy) return;
            const buttonsAtClick = copyButtons();
            const indexAtClick = buttonsAtClick.indexOf(copy);
            if (indexAtClick < 0) {
                console.warn('[SichangTools] 官方消息列表已变化，已取消插入，请刷新后重试。');
                return;
            }
            openMenu(insert, { kind: 'insert', button: insert, copy, buttonsAtClick, indexAtClick });
            return;
        }

        // 输入区加号：开/关追加菜单。
        const plus = target.closest(ADD_BUBBLE_BUTTON_SELECTOR);
        if (plus) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (state.busy) return;
            if (state.menu && state.anchor === plus) {
                closeMenu();
                return;
            }
            openMenu(plus, { kind: 'append', button: plus });
            return;
        }

        // 点菜单外关闭，不拦截页面自己的点击。
        if (state.menu && !target.closest(MENU_SELECTOR)) closeMenu();
    }

    function onMenuKeyDown(event) {
        if (event.key === 'Escape' && state.menu) closeMenu();
    }

    ensureComposerButton();
    ensureMessageButtons();
    // 用文档级委托而不是直接绑在按钮上：官方重绘可能换掉按钮节点，委托仍能收到点击。
    document.addEventListener('click', onAddClick, { capture: true });
    window.addEventListener('keydown', onMenuKeyDown, true);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    // 输入区和消息列表会随会话切换/回复状态重绘，加号被官方一并移除时补插；不做轮询。
    state.observer = new MutationObserver(scheduleEnsure);
    state.observer.observe(document.body, { childList: true, subtree: true });
    // 水合完成时不一定有 DOM 变化，补一次插入检查
    const unsubscribeSettled = onSettled(scheduleEnsure);

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
            unsubscribeSettled();
            if (state.timer) window.clearTimeout(state.timer);
            state.timer = 0;
            button?.remove();
            button = null;
            for (const item of document.querySelectorAll(INSERT_BUBBLE_BUTTON_SELECTOR)) {
                item.parentElement?.remove();
            }
            clearBusyIcons();
        },
    };
}
