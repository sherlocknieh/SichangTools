// 接管官方「删除消息」：点按钮先弹选项，再决定删单条还是删后续。
// 单条删除仍是先 DELETE 截断，再用 /api/conversations/import 补回后面的消息；
// 删后续直接走官方 DELETE 截断语义，不补回尾部。
// 成功后把剩余消息写回官方前端的 React 状态，由官方自己立即重绘，避免整页刷新。
import {
    CONVERSATION_IMPORT_MAX_CHARS,
    OFFICIAL_MESSAGE_DELETE_SELECTOR,
} from './constants.js';
import { clearBusyIcons, setBusyIcon } from './busy-icon.js';
import {
    errorMessage,
    importMessages,
    loadConversation,
    loadMessages,
    readConversationId,
    request,
} from './conversation-api.js';
import { messageText } from './conversation-copy.js';
import { officialContext } from './official-page.js';

const MENU_SELECTOR = '[data-sichang-delete-menu]';
const MODE_SELECTOR = '[data-sichang-delete-mode]';
const MENU_STYLE_ID = 'sichang-delete-menu-style';
const MENU_CSS = `
.sichang-delete-menu {
    position: fixed;
    z-index: 2147483647;
    min-width: 150px;
    padding: 4px;
    border: 1px solid var(--border, rgba(127, 127, 127, .28));
    border-radius: 12px;
    background: var(--card, #fff);
    box-shadow: 0 10px 28px rgba(0, 0, 0, .18);
    color: var(--foreground, #111);
    font: inherit;
}
.sichang-delete-menu button {
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
.sichang-delete-menu button:hover { background: var(--muted, rgba(127, 127, 127, .15)); }
.sichang-delete-menu button[data-sichang-delete-mode="one"] { color: #c0392b; }
`;

export function createMessageDelete(host) {
    const state = {
        busy: false,
        cid: '',
        menu: null,
        anchor: null,
    };

    // ---------- 菜单与操作中动画 ----------

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

    function openMenu(anchor) {
        ensureMenuStyle();
        closeMenu();
        const menu = document.createElement('div');
        menu.setAttribute('data-sichang-delete-menu', '');
        menu.className = 'sichang-delete-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `
            <button type="button" role="menuitem" data-sichang-delete-mode="one">删除本条</button>
            <button type="button" role="menuitem" data-sichang-delete-mode="after">删除后续（走官方）</button>
        `;
        document.body.appendChild(menu);
        state.menu = menu;
        state.anchor = anchor;
        positionMenu();
    }

    // ---------- 写入与恢复 ----------

    function indexOfId(list, id) {
        return list.findIndex(item => item.id === id);
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

    function planBaseSeq(fresh, firstDiff) {
        if (firstDiff < fresh.length) return fresh[firstDiff].seq;
        return fresh.length ? fresh[fresh.length - 1].seq + 1 : 0;
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

    async function applyDelete(resolveTarget) {
        if (state.busy || !state.cid) return null;
        state.busy = true;

        let fresh = [];
        let meta = null;
        let firstDiff = -1;
        let deleted = false;
        try {
            fresh = await loadMessages(state.cid);
            meta = await loadConversation(state.cid);
            const target = resolveTarget(fresh);
            const index = indexOfId(fresh, target.id);
            if (index < 0) throw new Error('选中的消息已不存在，请刷新后重试。');

            firstDiff = index;
            // import 不接受空正文；只有被重建的尾部换成零宽空格，头部保持原样。
            const desired = [
                ...fresh.slice(0, index),
                ...fresh.slice(index + 1).map(message => ({ ...message, content: messageText(message.content) })),
            ];
            const baseSeq = planBaseSeq(fresh, firstDiff);
            const newTail = desired.slice(firstDiff).map((message, offset) => ({
                ...message,
                seq: baseSeq + offset,
                content: messageText(message.content),
            }));
            const tooLong = newTail.find(message => String(message.content || '').length > CONVERSATION_IMPORT_MAX_CHARS);
            if (tooLong) {
                throw new Error(`第 #${tooLong.seq} 条消息超过 ${CONVERSATION_IMPORT_MAX_CHARS} 字，官方导入接口会截断，已取消。`);
            }
            // 请求失败也可能已经在服务端截断；先标记，失败时统一尝试补回原尾部。
            deleted = true;
            await request(
                `/api/conversations/${encodeURIComponent(state.cid)}/messages/${encodeURIComponent(target.id)}`,
                { method: 'DELETE' },
            );
            if (newTail.length) await importMessages(state.cid, meta, newTail);

            const after = await loadMessages(state.cid);
            if (!sameOrder(after, desired)) {
                throw new Error('写入后校验失败：官方消息顺序与预期不一致，可能被其他窗口改动了。');
            }
            return { ok: true, messages: after, targetId: target.id };
        } catch (error) {
            const message = errorMessage(error);
            if (deleted) {
                try {
                    const originalTail = fresh.slice(firstDiff).map((item, offset) => ({
                        ...item,
                        seq: planBaseSeq(fresh, firstDiff) + offset,
                        content: messageText(item.content),
                    }));
                    if (originalTail.length) await importMessages(state.cid, meta, originalTail);
                    const restored = await loadMessages(state.cid);
                    const original = [
                        ...fresh.slice(0, firstDiff),
                        ...fresh.slice(firstDiff).map(message => ({ ...message, content: messageText(message.content) })),
                    ];
                    if (!sameOrder(restored, original)) throw new Error('补回后校验失败');
                    return { ok: false, message: `删除失败：${message}。已尝试补回原消息，请确认页面内容。` };
                } catch (restoreError) {
                    downloadBackup(meta, fresh);
                    return {
                        ok: false,
                        message: `删除失败：${message}；自动补回也失败：${errorMessage(restoreError)}。已自动下载备份，刷新前请保留。`,
                    };
                }
            }
            return { ok: false, message };
        } finally {
            state.busy = false;
        }
    }

    async function applyDeleteAfter(resolveTarget) {
        if (state.busy || !state.cid) return null;
        state.busy = true;
        try {
            const fresh = await loadMessages(state.cid);
            const target = resolveTarget(fresh);
            const index = indexOfId(fresh, target.id);
            if (index < 0) throw new Error('选中的消息已不存在，请刷新后重试。');

            // 官方 DELETE 的语义就是“从目标起全部删除”，这里不补回尾部。
            await request(
                `/api/conversations/${encodeURIComponent(state.cid)}/messages/${encodeURIComponent(target.id)}`,
                { method: 'DELETE' },
            );
            const after = await loadMessages(state.cid);
            if (!sameOrder(after, fresh.slice(0, index))) {
                throw new Error('删除后续失败：官方消息列表与预期不一致，可能被其他窗口改动了。');
            }
            return { ok: true, messages: after, targetId: target.id };
        } catch (error) {
            return { ok: false, message: `删除后续失败：${errorMessage(error)}` };
        } finally {
            state.busy = false;
        }
    }

    // ---------- 让官方页面立即同步 ----------

    function syncOfficialPage(context, conversation, messages, targetId) {
        if (!context || !conversation || conversation.id !== state.cid) return false;
        const byId = new Map(messages.map(message => [message.id, message]));
        const next = [];
        for (const message of conversation.messages) {
            const latest = byId.get(message.id);
            if (!latest) continue;
            // 保留官方前端的本地对象（媒体、变体等结构不被重导入破坏），只校正被重排后的 seq。
            next.push(latest.seq === message.seq ? message : { ...message, seq: latest.seq });
        }
        // 目标必须确实从官方本地状态里消失，否则宁可整页刷新，也不留下错位的 DOM。
        if (next.length === conversation.messages.length || next.some(message => message.id === targetId)) return false;
        try {
            context.upsertConversation({ ...conversation, messages: next });
            return true;
        } catch {
            return false;
        }
    }

    function officialDeleteButtons() {
        return Array.from(document.querySelectorAll(OFFICIAL_MESSAGE_DELETE_SELECTOR));
    }

    // 按钮和消息按文档顺序一一对应；数量或节点变化时不猜 ID。
    function resolveTarget(button, fresh, buttonsAtClick, indexAtClick) {
        if (!button.isConnected || buttonsAtClick[indexAtClick] !== button) {
            throw new Error('官方消息列表已变化，已取消删除，请刷新后重试。');
        }
        const buttonsNow = officialDeleteButtons();
        const sameButtons = buttonsNow.length === buttonsAtClick.length
            && buttonsNow.every((item, index) => item === buttonsAtClick[index]);
        if (!sameButtons || buttonsNow[indexAtClick] !== button) {
            throw new Error('官方消息列表已变化，已取消删除，请刷新后重试。');
        }
        if (buttonsNow.length !== fresh.length || indexAtClick < 0 || indexAtClick >= fresh.length) {
            throw new Error('无法安全对应官方删除按钮与消息 ID，已取消删除，不会回退到官方截断。');
        }
        return fresh[indexAtClick];
    }

    async function runMode(mode) {
        const anchor = state.anchor;
        closeMenu();
        if (!anchor || state.busy) return;

        const cid = readConversationId();
        // 匿名/本地对话没有云端消息接口；菜单是脚本加的，这里直接放弃。
        if (!cid || cid.startsWith('conv__anonymous__')) return;
        state.cid = cid;

        const buttonsAtClick = officialDeleteButtons();
        const indexAtClick = buttonsAtClick.indexOf(anchor);
        if (indexAtClick < 0) {
            console.warn('[SichangTools] 官方消息列表已变化，已取消删除，请刷新后重试。');
            return;
        }
        const context = officialContext(anchor);
        const conversation = context?.activeConversation ?? null;

        const resolve = fresh => resolveTarget(anchor, fresh, buttonsAtClick, indexAtClick);
        setBusyIcon(anchor, true);
        try {
            const result = mode === 'after'
                ? await applyDeleteAfter(resolve)
                : await applyDelete(resolve);
            if (!result) return;
            if (!result.ok) {
                console.warn(`[SichangTools] ${result.message}`);
                return;
            }
            if (syncOfficialPage(context, conversation, result.messages, result.targetId)) return;
            // 官方内部状态结构变化时退回整页刷新，保证服务端和页面至少一致。
            window.location.reload();
        } finally {
            setBusyIcon(anchor, false);
        }
    }

    function onOfficialDeleteClick(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;

        // 菜单项：按用户选的模式执行。
        const option = target.closest(MODE_SELECTOR);
        if (option) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            runMode(option.getAttribute('data-sichang-delete-mode') === 'after' ? 'after' : 'one');
            return;
        }

        const button = target.closest(OFFICIAL_MESSAGE_DELETE_SELECTOR);
        if (!button) {
            // 点菜单外关闭，不拦截页面自己的点击。
            if (state.menu && !target.closest(MENU_SELECTOR)) closeMenu();
            return;
        }

        const cid = readConversationId();
        // 匿名/本地对话没有云端消息接口；不拦官方本地删除。
        if (!cid || cid.startsWith('conv__anonymous__')) return;

        // 必须在官方 React handler 之前同步截获，改成弹脚本菜单，失败时也绝不回退官方“全删到末尾”。
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (state.busy) {
            console.warn('[SichangTools] 正在删除上一条消息，请稍后再试。');
            return;
        }

        if (state.menu && state.anchor === button) closeMenu();
        else openMenu(button);
    }

    function onMenuKeyDown(event) {
        if (event.key === 'Escape' && state.menu) closeMenu();
    }

    window.addEventListener('click', onOfficialDeleteClick, { capture: true });
    window.addEventListener('keydown', onMenuKeyDown, true);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);

    return {
        api: {},
        dispose: () => {
            window.removeEventListener('click', onOfficialDeleteClick, { capture: true });
            window.removeEventListener('keydown', onMenuKeyDown, true);
            window.removeEventListener('scroll', closeMenu, true);
            window.removeEventListener('resize', closeMenu);
            closeMenu();
            document.getElementById(MENU_STYLE_ID)?.remove();
            clearBusyIcons();
        },
    };
}
