// 官方会话接口的共享封装：删除消息和克隆会话都读写同一组 /api/conversations 契约。
// 站点改版时先核对这里的路径、分页字段和 import 请求体，业务模块不再各写一份。
import {
    CONVERSATION_IMPORT_BATCH,
    CONVERSATION_MESSAGE_PAGE_SIZE,
} from './constants.js';

const CHAT_PATH_RE = /^\/chat\/(conv__[^/?#]+)/;

export function readConversationId() {
    const match = CHAT_PATH_RE.exec(window.location.pathname);
    return match ? decodeURIComponent(match[1]) : '';
}

export async function request(url, options = {}) {
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

export async function requestJson(url, options = {}) {
    const response = await request(url, options);
    return response.json();
}

export function loadConversation(cid) {
    return requestJson(`/api/conversations/${encodeURIComponent(cid)}`);
}

// 克隆先建空会话，再用 import 追加消息；只传官方 createConversation 认识的字段。
export function createConversation(cid, meta) {
    const body = {
        id: cid,
        title: meta.title || '新对话',
        model: meta.model || 'gemma-4-uncensored',
        scope: meta.scope === 'character' ? 'character' : 'general',
        characterId: meta.scope === 'character' ? meta.characterId ?? null : null,
        createdAt: meta.createdAt || Date.now(),
    };
    if (typeof meta.webSearch === 'boolean') body.webSearch = meta.webSearch;
    if (typeof meta.reasoning === 'boolean') body.reasoning = meta.reasoning;
    return request('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

export function deleteConversation(cid) {
    return request(`/api/conversations/${encodeURIComponent(cid)}`, { method: 'DELETE' });
}

// 官方接口默认按 before 向前翻页；不传 before 会从最早一页开始，
// 所以这里固定先取最近一页，再用 prevCursor 一页页补更早的消息。
export async function loadMessages(cid) {
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

export function toImportMessage(message, seq) {
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

// 与官方 newId() 同格式，避免新会话/消息 ID 在站点里显得异常。
export function newId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function conversationOwner(cid) {
    const parts = String(cid || '').split('__');
    if (parts.length < 3 || parts[0] !== 'conv' || !parts[1]) return '';
    return parts[1];
}

// 官方 nextSeq：以最后一条带 seq 的消息为基准，按本地消息数补齐。
export function nextSeq(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const seq = messages[index].seq;
        if (typeof seq === 'number') return seq + (messages.length - index);
    }
    return messages.length;
}

// import 对已存在会话只增不改不删；克隆时先建空会话再导入，删除时用截断后的尾部补回。
export async function importMessages(cid, meta, messages) {
    const conversation = {
        id: cid,
        scope: meta.scope === 'character' ? 'character' : 'general',
        characterId: meta.scope === 'character' ? meta.characterId ?? null : null,
        title: meta.title || '新对话',
        model: meta.model || 'gemma-4-uncensored',
        createdAt: meta.createdAt || Date.now(),
        updatedAt: Date.now(),
    };
    for (let offset = 0; offset < messages.length; offset += CONVERSATION_IMPORT_BATCH) {
        const chunk = messages.slice(offset, offset + CONVERSATION_IMPORT_BATCH);
        await request('/api/conversations/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversations: [{
                    ...conversation,
                    updatedAt: Date.now(),
                    messages: chunk.map((message, index) => (
                        toImportMessage(message, message.seq ?? offset + index)
                    )),
                }],
            }),
        });
    }
}

export function errorMessage(error) {
    if (error?.status === 401) return '未登录或登录已失效，无法同步到官方。';
    if (error?.status === 404) return '这个对话不在云端（可能是未登录时的本地对话），无法同步到官方。';
    return error?.message || String(error);
}
