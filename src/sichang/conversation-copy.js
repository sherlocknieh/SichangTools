// 会话复制的共用实现：整条克隆和消息级 fork 都走这里。
// 优先用官方 create + import（匿名会话也支持）；接口不可达时退回官方 React context 的本地存储。
import {
    CONVERSATION_IMPORT_MAX_CHARS,
    CONVERSATION_IMPORT_MAX_MESSAGES,
} from './constants.js';
import {
    conversationOwner,
    createConversation,
    deleteConversation,
    importMessages,
    loadConversation,
    loadMessages,
    newId,
} from './conversation-api.js';

// 官方 import 会跳过空正文；用零宽空格保留一条视觉上为空的消息。
export const EMPTY_MESSAGE_TEXT = '\u200B';

export function messageText(content) {
    const text = String(content ?? '');
    return text.length ? text : EMPTY_MESSAGE_TEXT;
}

function roleOf(message) {
    return message.role === 'system' ? 'system' : message.role === 'user' ? 'user' : 'assistant';
}

function sameMessages(actual, expected) {
    if (actual.length !== expected.length) return false;
    for (let index = 0; index < actual.length; index += 1) {
        if (actual[index].content !== expected[index].content) return false;
        if (actual[index].role !== expected[index].role) return false;
    }
    return true;
}

export function validateCopyMessages(messages) {
    if (!messages.length) throw new Error('没有可复制的消息。');
    if (messages.length > CONVERSATION_IMPORT_MAX_MESSAGES) {
        throw new Error(`消息超过官方导入一次最多 ${CONVERSATION_IMPORT_MAX_MESSAGES} 条的限制。`);
    }
    const tooLong = messages.find(message => messageText(message.content).length > CONVERSATION_IMPORT_MAX_CHARS);
    if (tooLong) {
        throw new Error(`第 #${tooLong.seq} 条消息超过 ${CONVERSATION_IMPORT_MAX_CHARS} 字，官方导入接口会截断。`);
    }
}

// 服务端复制：新会话使用同一个 owner 前缀（云端或 conv__anonymous__），消息换新 ID。
export async function copyConversationByApi({ owner, meta, messages, title }) {
    if (!owner) throw new Error('无法识别会话归属，暂不支持复制。');
    validateCopyMessages(messages);
    const targetCid = `conv__${owner}__${newId()}`;
    const now = Date.now();
    const targetMeta = {
        ...meta,
        title,
        createdAt: now,
        updatedAt: now,
    };
    const copied = messages.map((message, index) => ({
        ...message,
        id: `msg__${owner}__${newId()}`,
        seq: index,
        role: roleOf(message),
        content: messageText(message.content),
        createdAt: message.createdAt || now,
    }));

    let created = false;
    try {
        await createConversation(targetCid, targetMeta);
        created = true;
        await importMessages(targetCid, targetMeta, copied);
        const actual = await loadMessages(targetCid);
        if (!sameMessages(actual, copied)) {
            throw new Error('写入后校验失败：副本消息与服务端不一致，可能受导入上限或并发影响。');
        }
        return { cid: targetCid, local: false };
    } catch (error) {
        // 只建了空壳就失败时删掉，避免侧栏留下半截会话。
        if (created) {
            try {
                await deleteConversation(targetCid);
            } catch {}
        }
        throw error;
    }
}

// 本地复制：未登录或接口不可达时，用官方 context 的 createConversation/addMessage 写 IndexedDB。
// 这些方法同步更新 React 状态、异步落盘，所以不需要也不应该整页跳转。
export function copyConversationLocally({ context, meta, messages, title }) {
    validateCopyMessages(messages);
    const created = context?.createConversation?.(meta.model || 'gemma-4-uncensored');
    if (!created?.id) throw new Error('无法创建本地副本会话。');
    const owner = conversationOwner(created.id);
    for (const message of messages) {
        context.addMessage(created.id, {
            id: `msg__${owner}__${newId()}`,
            role: roleOf(message),
            content: messageText(message.content),
            createdAt: message.createdAt || Date.now(),
            ...(message.model ? { model: message.model } : {}),
        });
    }
    // 放到最后：addMessage 会在空会话第一条用户消息时自动改标题，这里统一覆盖成分支标题。
    context.renameConversation?.(created.id, title);
    return { cid: created.id, local: true };
}

// 读取源会话：云端/匿名优先走接口；接口失败且当前 context 里就是这条会话时退回本地消息。
export async function readConversationForCopy(sourceCid, context) {
    try {
        const [meta, messages] = await Promise.all([
            loadConversation(sourceCid),
            loadMessages(sourceCid),
        ]);
        return { meta, messages, remote: true };
    } catch (error) {
        const active = context?.activeConversation;
        if (active?.id === sourceCid && Array.isArray(active.messages) && active.messages.length) {
            return { meta: active, messages: active.messages, remote: false };
        }
        throw error;
    }
}

// 统一入口：能走服务端就走服务端；匿名本地对话在接口不可用时退回 context。
export async function copyConversation({ sourceCid, context, meta, messages, title }) {
    const owner = conversationOwner(sourceCid);
    try {
        return await copyConversationByApi({ owner, meta, messages, title });
    } catch (error) {
        if (owner === 'anonymous' && context?.activeConversation?.id === sourceCid) {
            return copyConversationLocally({ context, meta, messages, title });
        }
        throw error;
    }
}
