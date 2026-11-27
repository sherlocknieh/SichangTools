// 接管官方「删除消息」：官方只提供“从这条起全部删除”，这里改成只删这一条。
// 实现仍是先 DELETE 截断，再用 /api/conversations/import 补回后面的消息；
// 成功后把剩余消息写回官方前端的 React 状态，由官方自己立即重绘，避免整页刷新。
import {
    CONVERSATION_IMPORT_MAX_CHARS,
    OFFICIAL_MESSAGE_DELETE_SELECTOR,
} from './constants.js';
import {
    describeLoss,
    errorMessage,
    importMessages,
    loadConversation,
    loadMessages,
    readConversationId,
    request,
} from './conversation-api.js';
import { previewText } from './text.js';

const ROLE_LABELS = { user: '你', assistant: 'AI', system: '系统' };

export function createMessageDelete(host) {
    const state = {
        busy: false,
        cid: '',
    };

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

    function hasAdjacentSameRole(messages) {
        let previous = '';
        for (const message of messages) {
            const role = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'system';
            if (role === 'system') continue;
            if (role === previous) return true;
            previous = role;
        }
        return false;
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

    function confirmDelete(target, fresh, desired, newTail, index) {
        const loss = describeLoss(newTail);
        const lines = [
            `只删除 #${target.seq}（${ROLE_LABELS[target.role] || target.role}）：${previewText(String(target.content || '')) || '（空）'}`,
        ];
        const tailCount = fresh.length - index - 1;
        if (newTail.length) {
            lines.push(`后面的 ${Math.max(tailCount, 0)} 条消息会保留；为保证顺序，会从这条起截断并重建尾部 ${newTail.length} 条。`);
        } else {
            lines.push('这是最后一条，不会重建其他消息。');
        }
        if (loss.length) {
            lines.push(`重建会丢失：${loss.join('、')}。文本、角色、模型、时间和消息 ID 会保留。`);
        }
        if (hasAdjacentSameRole(desired)) {
            lines.push('注意：删除后会出现连续的同角色消息，官方对话通常用户/助手交替，模型表现可能异常。');
        }
        lines.push('修改直接写入官方，成功后当前页面会立即移除这条消息。继续？');
        return window.confirm(lines.join('\n\n'));
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
            const desired = [...fresh.slice(0, index), ...fresh.slice(index + 1)];
            const baseSeq = planBaseSeq(fresh, firstDiff);
            const newTail = desired.slice(firstDiff).map((message, offset) => ({
                ...message,
                seq: baseSeq + offset,
            }));
            const tooLong = newTail.find(message => String(message.content || '').length > CONVERSATION_IMPORT_MAX_CHARS);
            if (tooLong) {
                throw new Error(`第 #${tooLong.seq} 条消息超过 ${CONVERSATION_IMPORT_MAX_CHARS} 字，官方导入接口会截断，已取消。`);
            }
            const empty = newTail.find(message => String(message.content || '').length === 0);
            if (empty) {
                throw new Error(`第 #${empty.seq} 条消息没有文本内容，官方导入接口无法补回，已取消。`);
            }
            if (!confirmDelete(target, fresh, desired, newTail, index)) return { cancelled: true };

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
                    }));
                    if (originalTail.length) await importMessages(state.cid, meta, originalTail);
                    const restored = await loadMessages(state.cid);
                    if (!sameOrder(restored, fresh)) throw new Error('补回后校验失败');
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

    // ---------- 让官方页面立即同步 ----------

    function officialContext(element) {
        let fiber = null;
        for (const key of Object.getOwnPropertyNames(element)) {
            if (key.startsWith('__reactFiber$')) {
                fiber = element[key];
                break;
            }
        }
        for (let depth = 0; fiber && depth < 500; depth += 1) {
            const value = fiber.memoizedProps?.value;
            if (value
                && typeof value.upsertConversation === 'function'
                && typeof value.activeConversation === 'object'
                && Array.isArray(value.conversations)) {
                return value;
            }
            fiber = fiber.return;
        }
        return null;
    }

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

    async function interceptOfficialDelete(button, buttonsAtClick, indexAtClick, context, conversation) {
        const result = await applyDelete(fresh => {
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
        });

        if (!result || result.cancelled) return;
        if (!result.ok) {
            window.alert(`SichangTools：${result.message}`);
            return;
        }
        if (syncOfficialPage(context, conversation, result.messages, result.targetId)) return;
        // 官方内部状态结构变化时退回整页刷新，保证服务端和页面至少一致。
        window.location.reload();
    }

    function onOfficialDeleteClick(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest(OFFICIAL_MESSAGE_DELETE_SELECTOR);
        if (!button) return;

        const cid = readConversationId();
        // 匿名/本地对话没有云端消息接口；不拦官方本地删除。
        if (!cid || cid.startsWith('conv__anonymous__')) return;

        // 必须在官方 React handler 之前同步截获，失败时也绝不回退官方“全删到末尾”。
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (state.busy) {
            window.alert('SichangTools：正在删除上一条消息，请稍后再试。');
            return;
        }

        const buttonsAtClick = officialDeleteButtons();
        const indexAtClick = buttonsAtClick.indexOf(button);
        const context = officialContext(button);
        const conversation = context?.activeConversation ?? null;
        state.cid = cid;
        interceptOfficialDelete(button, buttonsAtClick, indexAtClick, context, conversation);
    }

    window.addEventListener('click', onOfficialDeleteClick, { capture: true });

    return {
        api: {},
        dispose: () => {
            window.removeEventListener('click', onOfficialDeleteClick, { capture: true });
        },
    };
}
