// 对话结构管理：官方只提供「从某条起全部删除」，没有单条删除、插入或移动消息的接口。
// 唯一能补充消息的写入口是 /api/conversations/import（原本用于匿名数据迁移）：
// 先找到目标结构与官方当前消息的第一个分歧点，从那里 DELETE 截断，
// 再用 import 把新尾部补回。重新导入能保留 id/seq/role/content/model/createdAt，
// 但 variants、thinking、图片建议、网页来源和附件会被丢掉，所以尾部有这些数据时先确认。
import {
    CONVERSATION_IMPORT_BATCH,
    CONVERSATION_IMPORT_MAX_CHARS,
    CONVERSATION_MESSAGE_PAGE_SIZE,
} from './constants.js';
import { previewText } from './text.js';

const CHAT_PATH_RE = /^\/chat\/(conv__[^/?#]+)/;
const ROLE_LABELS = { user: '你', assistant: 'AI', system: '系统' };
const MAX_HISTORY = 5;

export function createConversation(host) {
    const { ui } = host;
    const state = {
        open: false,
        busy: false,
        cid: '',
        meta: null,
        messages: [],
        startId: null,
        endId: null,
        pendingMove: false,
        form: '',
        formRendered: '',
        insertRole: 'user',
        insertPosition: 'after',
        insertText: '',
        status: '',
        statusKind: 'info',
        dirty: false,
        history: [],
        recovery: '',
        scrollToId: '',
    };
    const overlay = document.createElement('div');
    overlay.className = 'convOverlay';
    overlay.hidden = true;
    overlay.innerHTML = `
        <div class="convBox" role="dialog" aria-modal="true" aria-label="对话结构管理">
            <div class="convHead">
                <span class="convTitle">对话结构管理</span>
                <span class="convSub" data-role="sub"></span>
                <span class="convSpacer"></span>
                <button type="button" data-action="refresh" title="重新读取官方消息">刷新</button>
                <button type="button" data-action="close" title="关闭">×</button>
            </div>
            <div class="convNote">
                修改直接写入官方。结构修改会从分歧点截断并重建尾部：文本、角色、模型、时间和 ID 保留，
                <b>变体、思考、图片建议、网页来源和附件会丢失</b>。
            </div>
            <div class="convStatus" data-role="status" data-kind="info"></div>
            <div class="convRecovery" data-role="recovery" hidden>
                <span>自动恢复失败，修改前的消息已保存在页面内。</span>
                <button type="button" data-action="download-recovery">下载备份 JSON</button>
            </div>
            <div class="convList" data-role="list" role="listbox" aria-label="消息列表" aria-multiselectable="true"></div>
            <div class="convForm" data-role="form" hidden></div>
            <div class="convBar">
                <span class="convSel" data-role="selection"></span>
                <span class="convSpacer"></span>
                <button type="button" data-action="insert-before">插入到此前</button>
                <button type="button" data-action="insert-after">插入到此后</button>
                <button type="button" data-action="delete">删除选中</button>
                <button type="button" data-action="delete-turn">删除整轮</button>
                <button type="button" data-action="move">移动/嫁接</button>
                <button type="button" data-action="move-end" hidden>移到末尾</button>
                <button type="button" data-action="undo" hidden>撤销</button>
                <button type="button" data-action="reload" class="primary" hidden>刷新页面</button>
            </div>
        </div>
    `;
    ui.root.appendChild(overlay);

    const dom = {
        sub: overlay.querySelector('[data-role="sub"]'),
        status: overlay.querySelector('[data-role="status"]'),
        recovery: overlay.querySelector('[data-role="recovery"]'),
        list: overlay.querySelector('[data-role="list"]'),
        form: overlay.querySelector('[data-role="form"]'),
        selection: overlay.querySelector('[data-role="selection"]'),
        undo: overlay.querySelector('[data-action="undo"]'),
        reload: overlay.querySelector('[data-action="reload"]'),
        moveEnd: overlay.querySelector('[data-action="move-end"]'),
        move: overlay.querySelector('[data-action="move"]'),
    };

    const events = new AbortController();
    const read = new AbortController();
    let formFocus = false;

    // ---------- 读取官方数据 ----------

    function readConversationId() {
        const match = CHAT_PATH_RE.exec(window.location.pathname);
        return match ? decodeURIComponent(match[1]) : '';
    }

    async function request(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'same-origin',
            cache: 'no-store',
            ...options,
        });
        if (!response.ok) {
            let detail = '';
            try {
                detail = (await response.text()).slice(0, 160);
            } catch {}
            const error = new Error(`${url} ${response.status}${detail ? `: ${detail}` : ''}`);
            error.status = response.status;
            throw error;
        }
        return response;
    }

    async function requestJson(url, options = {}) {
        const response = await request(url, options);
        return response.json();
    }

    async function loadMeta(cid) {
        return requestJson(`/api/conversations/${encodeURIComponent(cid)}`, { signal: read.signal });
    }

    // 官方接口默认按 before 向前翻页；不传 before 会从最早一页开始，
    // 所以这里固定先取最近一页，再用 prevCursor 一页页补更早的消息。
    async function loadMessages(cid) {
        let before = '';
        const pages = [];
        const seen = new Set();
        for (let page = 0; page < 40; page += 1) {
            const params = new URLSearchParams({
                limit: String(CONVERSATION_MESSAGE_PAGE_SIZE),
                before,
            });
            const data = await requestJson(
                `/api/conversations/${encodeURIComponent(cid)}/messages?${params.toString()}`,
                { signal: read.signal },
            );
            const items = Array.isArray(data.items) ? data.items : [];
            pages.push(items);
            if (!data.prevCursor || items.length === 0) break;
            const cursor = String(data.prevCursor);
            if (seen.has(cursor)) break;
            seen.add(cursor);
            before = cursor;
        }
        return pages.reverse().flat().sort((a, b) => a.seq - b.seq);
    }

    // ---------- 结构操作 ----------

    function indexOfId(list, id) {
        return list.findIndex(item => item.id === id);
    }

    function newMessageId(cid) {
        const owner = cid.split('__')[1] || 'user';
        const random = typeof globalThis.crypto?.randomUUID === 'function'
            ? globalThis.crypto.randomUUID().slice(0, 8)
            : Math.random().toString(36).slice(2, 10);
        return `msg__${owner}__${Date.now().toString(36)}-${random}`;
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

    function firstDifference(current, desired) {
        const length = Math.max(current.length, desired.length);
        for (let index = 0; index < length; index += 1) {
            const a = current[index];
            const b = desired[index];
            if (!a || !b) return index;
            if (a.id !== b.id || a.content !== b.content || a.role !== b.role) return index;
        }
        return -1;
    }

    function describeLoss(tail) {
        let variants = 0;
        let thinking = 0;
        let suggestions = 0;
        let sources = 0;
        let attachments = 0;
        for (const message of tail) {
            if (message.meta?.variants?.length > 1) variants += 1;
            if (message.meta?.thinking) thinking += 1;
            if (message.meta?.imageSuggestions?.length) suggestions += 1;
            if (message.meta?.webSources?.length) sources += 1;
            if (message.attachments?.length) attachments += message.attachments.length;
        }
        const parts = [];
        if (variants) parts.push(`分支变体（${variants} 条消息）`);
        if (thinking) parts.push(`思考内容（${thinking} 条消息）`);
        if (suggestions) parts.push(`图片建议（${suggestions} 条消息）`);
        if (sources) parts.push(`网页来源（${sources} 条消息）`);
        if (attachments) parts.push(`附件/生成图（${attachments} 个）`);
        return parts;
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

    function buildDesired(fresh, meta, operation) {
        const idx = id => indexOfId(fresh, id);
        if (operation.type === 'restore') {
            return operation.messages.map(message => ({ ...message }));
        }
        if (operation.type === 'insert') {
            const anchor = idx(operation.anchorId);
            if (anchor < 0) throw new Error('选中的消息已不存在，请刷新后重试。');
            const at = operation.position === 'before' ? anchor : anchor + 1;
            const message = {
                id: newMessageId(state.cid),
                seq: at,
                role: operation.role,
                content: operation.content,
                createdAt: Date.now(),
                ...(operation.role === 'assistant' ? { model: meta.model } : {}),
            };
            return [...fresh.slice(0, at), message, ...fresh.slice(at)];
        }
        if (operation.type === 'move' || operation.type === 'move-end') {
            const start = idx(operation.startId);
            const end = idx(operation.endId || operation.startId);
            if (start < 0 || end < 0) throw new Error('选中的消息已不存在，请刷新后重试。');
            const [from, to] = start <= end ? [start, end] : [end, start];
            const range = fresh.slice(from, to + 1);
            const rest = [...fresh.slice(0, from), ...fresh.slice(to + 1)];
            if (operation.type === 'move-end') return [...rest, ...range];
            const target = idx(operation.targetId);
            if (target < 0) throw new Error('目标消息已不存在，请刷新后重试。');
            if (target >= from && target <= to) throw new Error('目标不能落在被移动的区间内。');
            const at = target > to ? target - range.length : target;
            return [...rest.slice(0, at), ...range, ...rest.slice(at)];
        }
        // delete / delete-turn
        let start = idx(operation.startId);
        let end = idx(operation.endId || operation.startId);
        if (start < 0 || end < 0) throw new Error('选中的消息已不存在，请刷新后重试。');
        if (start > end) [start, end] = [end, start];
        if (operation.type === 'delete-turn') {
            while (start > 0 && fresh[start].role !== 'user') start -= 1;
            let next = end + 1;
            while (next < fresh.length && fresh[next].role !== 'user') next += 1;
            end = next - 1;
        }
        return [...fresh.slice(0, start), ...fresh.slice(end + 1)];
    }

    function planBaseSeq(fresh, firstDiff) {
        if (firstDiff < fresh.length) return fresh[firstDiff].seq;
        return fresh.length ? fresh[fresh.length - 1].seq + 1 : 0;
    }

    function toImportMessage(message, seq) {
        return {
            id: message.id,
            seq,
            role: message.role === 'system' ? 'system' : message.role === 'user' ? 'user' : 'assistant',
            ...(message.model ? { model: message.model } : {}),
            content: message.content,
            createdAt: message.createdAt || Date.now(),
            state: 'complete',
        };
    }

    function importConversation(meta) {
        return {
            id: state.cid,
            scope: meta.scope === 'character' ? 'character' : 'general',
            characterId: meta.scope === 'character' ? meta.characterId ?? null : null,
            title: meta.title || '新对话',
            model: meta.model || 'gemma-4-uncensored',
            createdAt: meta.createdAt || Date.now(),
            updatedAt: Date.now(),
        };
    }

    async function importMessages(meta, messages) {
        const conversation = importConversation(meta);
        for (let offset = 0; offset < messages.length; offset += CONVERSATION_IMPORT_BATCH) {
            const chunk = messages.slice(offset, offset + CONVERSATION_IMPORT_BATCH);
            await request('/api/conversations/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversations: [{
                        ...conversation,
                        updatedAt: Date.now(),
                        messages: chunk.map((message, index) => toImportMessage(message, message.seq ?? offset + index)),
                    }],
                }),
            });
        }
    }

    function operationLabel(operation, fresh, desired, firstDiff) {
        const seqOf = id => {
            const index = indexOfId(fresh, id);
            return index >= 0 ? fresh[index].seq : '?';
        };
        if (operation.type === 'insert') {
            return `在 #${seqOf(operation.anchorId)} ${operation.position === 'before' ? '之前' : '之后'}插入 1 条${ROLE_LABELS[operation.role] || '消息'}`;
        }
        if (operation.type === 'delete') {
            const a = seqOf(operation.startId);
            const b = seqOf(operation.endId || operation.startId);
            return a === b ? `删除 #${a}` : `删除 #${a}–#${b}`;
        }
        if (operation.type === 'delete-turn') {
            return '删除选中消息所在的整轮';
        }
        if (operation.type === 'move') {
            return `把 #${seqOf(operation.startId)}–#${seqOf(operation.endId || operation.startId)} 移到 #${seqOf(operation.targetId)} 之前`;
        }
        if (operation.type === 'move-end') {
            return `把 #${seqOf(operation.startId)}–#${seqOf(operation.endId || operation.startId)} 移到末尾`;
        }
        if (operation.type === 'restore') {
            return '撤销到上一次结构修改之前';
        }
        return firstDiff < fresh.length ? `从 #${fresh[firstDiff].seq} 起重建` : `在末尾追加 ${desired.length - fresh.length} 条`;
    }

    function confirmPlan(label, fresh, desired, firstDiff) {
        const freshIds = new Set(fresh.map(message => message.id));
        const desiredIds = new Set(desired.slice(firstDiff).map(message => message.id));
        const removed = fresh.slice(firstDiff).filter(message => !desiredIds.has(message.id));
        const kept = fresh.slice(firstDiff).filter(message => desiredIds.has(message.id));
        const inserted = desired.slice(firstDiff).filter(message => !freshIds.has(message.id));
        const loss = describeLoss(kept);
        const lines = [`${label}，修改后共 ${desired.length} 条消息。`];
        if (firstDiff < fresh.length) {
            const counts = [];
            if (removed.length) counts.push(`删除 ${removed.length} 条`);
            if (kept.length) counts.push(`保留 ${kept.length} 条`);
            if (inserted.length) counts.push(`新增 ${inserted.length} 条`);
            lines.push(`将从 #${fresh[firstDiff]?.seq ?? firstDiff} 起截断并重建：${counts.join('、')}。`);
        } else if (inserted.length) {
            lines.push(`在末尾新增 ${inserted.length} 条消息。`);
        }
        if (loss.length) {
            lines.push(`以下内容会丢失：${loss.join('、')}。文本、角色、模型、时间和消息 ID 会保留。`);
        }
        if (hasAdjacentSameRole(desired)) {
            lines.push('注意：修改后会出现连续的同角色消息，官方对话通常是用户/助手交替，模型可能表现异常。建议按「整轮」删除或插入。');
        }
        lines.push('修改直接写入官方，无法从官方界面恢复。继续？');
        return window.confirm(lines.join('\n\n'));
    }

    async function applyOperation(operation, options = {}) {
        if (state.busy || !state.cid) return false;
        state.busy = true;
        state.status = '读取最新消息…';
        state.statusKind = 'info';
        render();
        await new Promise(resolve => setTimeout(resolve, 0));

        let fresh = [];
        let desired = [];
        let firstDiff = -1;
        let deleted = false;
        let pushed = false;
        try {
            fresh = await loadMessages(state.cid);
            const meta = await loadMeta(state.cid);
            state.meta = meta;
            desired = buildDesired(fresh, meta, operation);
            firstDiff = firstDifference(fresh, desired);
            if (firstDiff < 0) {
                state.status = '结构没有变化。';
                state.statusKind = 'info';
                return false;
            }
            const baseSeq = planBaseSeq(fresh, firstDiff);
            const newTail = desired.slice(firstDiff).map((message, index) => ({
                ...message,
                seq: baseSeq + index,
            }));
            const tooLong = newTail.find(message => String(message.content || '').length > CONVERSATION_IMPORT_MAX_CHARS);
            if (tooLong) {
                throw new Error(`第 #${tooLong.seq} 条消息超过 ${CONVERSATION_IMPORT_MAX_CHARS} 字，官方导入接口会截断，已取消。请把修改点放到这条之后。`);
            }
            const empty = newTail.find(message => String(message.content || '').length === 0);
            if (empty) {
                throw new Error(`第 #${empty.seq} 条消息没有文本内容，官方导入接口无法补回，已取消。请把修改点放到这条之后。`);
            }
            const label = operationLabel(operation, fresh, desired, firstDiff);
            if (!confirmPlan(label, fresh, desired, firstDiff)) {
                state.status = '已取消。';
                state.statusKind = 'info';
                return false;
            }

            if (options.pushHistory !== false) {
                state.history.push({ messages: fresh, at: Date.now() });
                if (state.history.length > MAX_HISTORY) state.history.shift();
                pushed = true;
            }

            if (firstDiff < fresh.length) {
                await request(
                    `/api/conversations/${encodeURIComponent(state.cid)}/messages/${encodeURIComponent(fresh[firstDiff].id)}`,
                    { method: 'DELETE' },
                );
                deleted = true;
            }

            if (newTail.length) await importMessages(meta, newTail);

            const after = await loadMessages(state.cid);
            if (!sameOrder(after, desired)) {
                throw new Error('写入后校验失败：官方消息顺序与预期不一致，可能被其他窗口改动了。');
            }
            state.messages = after;
            state.startId = null;
            state.endId = null;
            state.pendingMove = false;
            state.form = '';
            state.formRendered = '';
            state.insertText = '';
            state.recovery = '';
            state.dirty = true;
            state.status = `已同步到官方：${label}。刷新页面后官方聊天视图才会更新。`;
            state.statusKind = 'success';
            return true;
        } catch (error) {
            const message = errorMessage(error);
            if (deleted) {
                try {
                    const originalTail = fresh.slice(firstDiff).map((item, index) => ({
                        ...item,
                        seq: planBaseSeq(fresh, firstDiff) + index,
                    }));
                    if (originalTail.length) await importMessages(state.meta, originalTail);
                    if (pushed) {
                        state.history.pop();
                        pushed = false;
                    }
                    state.status = `写入失败：${message}。已尝试把原来的尾部补回，请刷新页面确认。`;
                } catch (restoreError) {
                    state.recovery = JSON.stringify({ conversation: state.meta, messages: fresh }, null, 2);
                    state.status = `写入失败：${message}；自动补回尾部也失败：${errorMessage(restoreError)}。备份已保存在页面内，请先下载备份并不要刷新。`;
                }
                state.statusKind = 'error';
                return false;
            }
            if (pushed) state.history.pop();
            state.status = message;
            state.statusKind = 'error';
            return false;
        } finally {
            state.busy = false;
            render();
        }
    }

    function errorMessage(error) {
        if (error?.status === 401) return '未登录或登录已失效，无法同步到官方。';
        if (error?.status === 404) return '这个对话不在云端（可能是未登录时的本地对话），无法同步到官方。';
        return error?.message || String(error);
    }

    // ---------- 状态与渲染 ----------

    function setStatus(message, kind = 'info') {
        state.status = message;
        state.statusKind = kind;
        render();
    }

    function selectionRange() {
        const start = indexOfId(state.messages, state.startId);
        const end = indexOfId(state.messages, state.endId || state.startId);
        if (start < 0) return null;
        const [from, to] = start <= end ? [start, end] : [end, start];
        return { from, to };
    }

    function metadataBadges(message) {
        const parts = [];
        if (message.meta?.variants?.length > 1) parts.push(`变体${message.meta.variants.length}`);
        if (message.attachments?.length) parts.push(`附件${message.attachments.length}`);
        if (message.meta?.thinking) parts.push('思考');
        if (message.meta?.imageSuggestions?.length) parts.push(`图建议${message.meta.imageSuggestions.length}`);
        if (message.meta?.webSources?.length) parts.push(`来源${message.meta.webSources.length}`);
        return parts.join(' · ');
    }

    function renderList() {
        const range = selectionRange();
        const top = dom.list.scrollTop;
        dom.list.textContent = '';
        if (!state.messages.length) {
            const empty = document.createElement('div');
            empty.className = 'convEmpty';
            empty.textContent = state.busy ? '读取中…' : '没有读到消息。';
            dom.list.appendChild(empty);
            return;
        }
        const fragment = document.createDocumentFragment();
        state.messages.forEach((message, index) => {
            const row = document.createElement('div');
            row.className = 'convRow';
            row.dataset.id = message.id;
            row.tabIndex = 0;
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', range && index >= range.from && index <= range.to ? 'true' : 'false');
            row.title = `#${message.seq} ${ROLE_LABELS[message.role] || message.role}\n${String(message.content || '').slice(0, 600)}`;
            if (range && index >= range.from && index <= range.to) row.classList.add('selected');
            if (range && index === range.from) row.classList.add('selStart');
            if (range && index === range.to) row.classList.add('selEnd');

            const idx = document.createElement('span');
            idx.className = 'convIdx';
            idx.textContent = `#${message.seq}`;

            const role = document.createElement('span');
            role.className = `convRole ${message.role}`;
            role.textContent = ROLE_LABELS[message.role] || message.role;

            const text = document.createElement('span');
            text.className = 'convText';
            text.textContent = previewText(String(message.content || '')) || '（空）';

            const badges = document.createElement('span');
            const badgeText = metadataBadges(message);
            badges.className = badgeText ? 'convBadges warn' : 'convBadges';
            badges.textContent = badgeText;

            row.append(idx, role, text, badges);
            fragment.appendChild(row);
        });
        dom.list.appendChild(fragment);
        if (state.scrollToId) {
            const target = dom.list.querySelector(`[data-id="${CSS.escape(state.scrollToId)}"]`);
            if (target) target.scrollIntoView({ block: 'nearest' });
            state.scrollToId = '';
        } else {
            dom.list.scrollTop = top;
        }
    }

    function renderSelection() {
        if (state.pendingMove) {
            dom.selection.textContent = '移动中：点击目标位置，或点「移到末尾」';
            return;
        }
        const range = selectionRange();
        if (!range) {
            dom.selection.textContent = '先点一条；Shift+点可选区间';
            return;
        }
        const from = state.messages[range.from];
        const to = state.messages[range.to];
        dom.selection.textContent = range.from === range.to
            ? `已选 #${from.seq} ${ROLE_LABELS[from.role] || from.role}`
            : `已选 #${from.seq}–#${to.seq}（${range.to - range.from + 1} 条）`;
    }

    function renderForm() {
        if (!state.form) {
            dom.form.hidden = true;
            dom.form.textContent = '';
            state.formRendered = '';
            return;
        }
        dom.form.hidden = false;
        if (state.formRendered === state.form) return;
        state.formRendered = state.form;
        dom.form.innerHTML = `
            <div class="convFormRow">
                <span>位置</span>
                <select data-field="position">
                    <option value="before">选中消息之前</option>
                    <option value="after">选中消息之后</option>
                </select>
                <span>角色</span>
                <select data-field="role">
                    <option value="user">用户</option>
                    <option value="assistant">助手</option>
                </select>
                <span class="convSpacer"></span>
                <button type="button" data-action="cancel-form">取消</button>
                <button type="button" data-action="apply-insert" class="primary">插入</button>
            </div>
            <textarea data-field="text" rows="4" placeholder="输入要插入的消息内容"></textarea>
        `;
        const position = dom.form.querySelector('[data-field="position"]');
        const role = dom.form.querySelector('[data-field="role"]');
        const text = dom.form.querySelector('[data-field="text"]');
        position.value = state.insertPosition;
        role.value = state.insertRole;
        text.value = state.insertText;
        if (formFocus) {
            formFocus = false;
            text.focus();
        }
    }

    function render() {
        overlay.hidden = !state.open;
        if (!state.open) return;
        dom.sub.textContent = state.meta
            ? `${state.meta.title || '未命名对话'} · ${state.messages.length} 条`
            : state.cid || '';
        dom.status.textContent = state.status || (state.busy ? '处理中…' : '');
        dom.status.dataset.kind = state.statusKind;
        dom.recovery.hidden = !state.recovery;
        dom.reload.hidden = !state.dirty;
        dom.undo.hidden = state.history.length === 0;
        dom.undo.textContent = state.history.length > 1 ? `撤销 (${state.history.length})` : '撤销';
        dom.moveEnd.hidden = !state.pendingMove;
        dom.move.textContent = state.pendingMove ? '取消移动' : '移动/嫁接';

        const hasSelection = Boolean(selectionRange());
        for (const button of overlay.querySelectorAll('button[data-action]')) {
            const action = button.dataset.action;
            if (action === 'refresh' || action === 'close') {
                button.disabled = state.busy;
            } else if (['insert-before', 'insert-after', 'delete', 'delete-turn'].includes(action)) {
                button.disabled = state.busy || !hasSelection;
            } else if (action === 'move') {
                button.disabled = state.busy || (!hasSelection && !state.pendingMove);
            } else if (action === 'move-end') {
                button.disabled = state.busy;
            } else if (action === 'undo') {
                button.disabled = state.busy || state.history.length === 0;
            } else if (action === 'apply-insert') {
                button.disabled = state.busy;
            }
        }
        renderSelection();
        renderList();
        renderForm();
    }

    // ---------- 交互 ----------

    async function refresh(options = {}) {
        if (!state.cid) {
            setStatus('当前页面不是对话页，请先打开一个对话。', 'error');
            return;
        }
        state.busy = true;
        setStatus('读取官方消息…');
        try {
            const [meta, messages] = await Promise.all([loadMeta(state.cid), loadMessages(state.cid)]);
            state.meta = meta;
            state.messages = messages;
            if (!options.keepSelection) {
                state.startId = null;
                state.endId = null;
            }
            state.status = `已读取 ${messages.length} 条消息。`;
            state.statusKind = 'info';
        } catch (error) {
            state.status = errorMessage(error);
            state.statusKind = 'error';
        } finally {
            state.busy = false;
            render();
        }
    }

    function open() {
        if (state.open) return;
        state.open = true;
        state.cid = readConversationId();
        state.meta = null;
        state.messages = [];
        state.startId = null;
        state.endId = null;
        state.pendingMove = false;
        state.form = '';
        state.formRendered = '';
        state.insertText = '';
        state.status = '';
        state.statusKind = 'info';
        state.dirty = false;
        state.history = [];
        state.recovery = '';
        overlay.hidden = false;
        render();
        if (state.cid) refresh();
        else setStatus('当前页面不是对话页，请先打开一个对话。', 'error');
    }

    function close() {
        if (state.busy) return;
        if (state.dirty) {
            if (!window.confirm('结构修改已同步到官方，但当前页面还是旧视图。关闭后刷新页面显示最新内容？')) return;
            window.location.reload();
            return;
        }
        state.open = false;
        state.form = '';
        state.formRendered = '';
        render();
    }

    function startInsert(position) {
        if (!state.startId) return setStatus('先选中一条消息。', 'error');
        state.form = 'insert';
        state.formRendered = '';
        state.insertPosition = position;
        state.insertText = '';
        state.pendingMove = false;
        formFocus = true;
        setStatus(position === 'before' ? '在选中消息之前插入。' : '在选中消息之后插入。');
    }

    function applyInsert() {
        const content = state.insertText.trim();
        if (!content) return setStatus('插入内容不能为空。', 'error');
        if (!state.startId) return setStatus('先选中一条消息。', 'error');
        applyOperation({
            type: 'insert',
            anchorId: state.startId,
            position: state.insertPosition,
            role: state.insertRole,
            content,
        });
    }

    function deleteSelected() {
        const range = selectionRange();
        if (!range) return setStatus('先选中一条消息。', 'error');
        applyOperation({
            type: 'delete',
            startId: state.messages[range.from].id,
            endId: state.messages[range.to].id,
        });
    }

    function deleteTurn() {
        const range = selectionRange();
        if (!range) return setStatus('先选中一条消息。', 'error');
        applyOperation({
            type: 'delete-turn',
            startId: state.messages[range.from].id,
            endId: state.messages[range.to].id,
        });
    }

    function toggleMove() {
        if (state.pendingMove) {
            state.pendingMove = false;
            setStatus('已取消移动。');
            return;
        }
        const range = selectionRange();
        if (!range) return setStatus('先选中要移动的消息。', 'error');
        state.pendingMove = true;
        state.form = '';
        state.formRendered = '';
        setStatus('点击目标位置：选中的消息会插入到目标消息之前。');
    }

    function moveEnd() {
        const range = selectionRange();
        if (!range) return setStatus('先选中要移动的消息。', 'error');
        applyOperation({
            type: 'move-end',
            startId: state.messages[range.from].id,
            endId: state.messages[range.to].id,
        });
    }

    async function handleRowClick(id, shiftKey) {
        if (state.busy) return;
        if (state.pendingMove) {
            const range = selectionRange();
            const target = indexOfId(state.messages, id);
            if (!range || target < 0) return;
            if (target >= range.from && target <= range.to) {
                setStatus('目标不能落在被移动的区间内。', 'error');
                return;
            }
            state.scrollToId = id;
            await applyOperation({
                type: 'move',
                startId: state.messages[range.from].id,
                endId: state.messages[range.to].id,
                targetId: id,
            });
            return;
        }
        if (shiftKey && state.startId) {
            state.endId = id;
        } else {
            state.startId = id;
            state.endId = id;
        }
        state.form = '';
        state.formRendered = '';
        state.scrollToId = id;
        setStatus('');
    }

    function downloadRecovery() {
        if (!state.recovery) return;
        const blob = new Blob([state.recovery], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `sichang-conversation-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function undo() {
        if (!state.history.length) return;
        const snapshot = state.history[state.history.length - 1];
        const ok = await applyOperation(
            { type: 'restore', messages: snapshot.messages },
            { pushHistory: false },
        );
        if (ok) {
            state.history.pop();
            state.dirty = true;
            render();
        }
    }

    function onClick(event) {
        const button = event.target.closest('button[data-action]');
        if (button) {
            const action = button.dataset.action;
            if (state.busy && !['close'].includes(action)) return;
            if (action === 'refresh') refresh();
            else if (action === 'close') close();
            else if (action === 'insert-before') startInsert('before');
            else if (action === 'insert-after') startInsert('after');
            else if (action === 'delete') deleteSelected();
            else if (action === 'delete-turn') deleteTurn();
            else if (action === 'move') toggleMove();
            else if (action === 'move-end') moveEnd();
            else if (action === 'undo') undo();
            else if (action === 'download-recovery') downloadRecovery();
            else if (action === 'apply-insert') applyInsert();
            else if (action === 'cancel-form') {
                state.form = '';
                state.formRendered = '';
                state.insertText = '';
                render();
            } else if (action === 'reload') window.location.reload();
            return;
        }
        const row = event.target.closest('.convRow');
        if (row) {
            handleRowClick(row.dataset.id, event.shiftKey);
            return;
        }
        if (event.target === overlay) close();
    }

    function onInput(event) {
        const field = event.target.closest('[data-field]');
        if (field?.dataset.field === 'text') state.insertText = field.value;
    }

    function onChange(event) {
        const field = event.target.closest('[data-field]');
        if (!field) return;
        if (field.dataset.field === 'role') state.insertRole = field.value;
        if (field.dataset.field === 'position') state.insertPosition = field.value;
    }

    function onKeydown(event) {
        if (event.key === 'Escape' && state.open) {
            event.preventDefault();
            close();
        }
    }

    function onRowKeydown(event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const row = event.target.closest('.convRow');
        if (!row) return;
        event.preventDefault();
        handleRowClick(row.dataset.id, event.shiftKey);
    }

    overlay.addEventListener('click', onClick, { signal: events.signal });
    overlay.addEventListener('keydown', onRowKeydown, { signal: events.signal });
    overlay.addEventListener('input', onInput, { signal: events.signal });
    overlay.addEventListener('change', onChange, { signal: events.signal });
    ui.conv.addEventListener('click', open, { signal: events.signal });
    document.addEventListener('keydown', onKeydown, { signal: events.signal });

    return {
        api: {},
        dispose: () => {
            events.abort();
            read.abort();
            overlay.remove();
        },
    };
}
