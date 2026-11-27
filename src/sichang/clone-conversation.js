// 克隆官方会话：读取当前云端对话的元数据和全部消息，新建一个副本再逐条导入。
// 入口是聊天页顶栏「新建对话」左侧的按钮；官方没有克隆接口，这里走 create + import 组合。
// 站点改版时优先核对 conversation-api.js 里的接口契约和顶栏选择器。
import {
    CLONE_BUTTON_LABEL,
    CLONE_BUTTON_SELECTOR,
    CLONE_TITLE_SUFFIX,
    CONVERSATION_IMPORT_MAX_CHARS,
    CONVERSATION_IMPORT_MAX_MESSAGES,
    OFFICIAL_CHAT_HEADER_SELECTOR,
    OFFICIAL_HEADER_HISTORY_SELECTOR,
    OFFICIAL_NEW_CHAT_SELECTOR,
} from './constants.js';
import {
    createConversation,
    deleteConversation,
    describeLoss,
    errorMessage,
    importMessages,
    loadConversation,
    loadMessages,
    readConversationId,
} from './conversation-api.js';

const COPY_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
    </svg>
`;

// 与官方 newId() 同格式，避免新会话/消息 ID 在站点里显得异常
function newId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function splitConversationId(cid) {
    const parts = cid.split('__');
    if (parts.length < 3 || parts[0] !== 'conv' || !parts[1]) return null;
    return { owner: parts[1] };
}

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
        next.addEventListener('click', onCloneClick);
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

    function validateCid(cid) {
        if (!cid || cid.startsWith('conv__anonymous__')) {
            throw new Error('当前是未登录的本地对话，消息不在云端，暂不支持克隆。请登录后打开云端对话。');
        }
    }

    function validateMessages(messages) {
        if (!messages.length) throw new Error('当前对话还没有消息，无需克隆。');
        if (messages.length > CONVERSATION_IMPORT_MAX_MESSAGES) {
            throw new Error(`当前对话有 ${messages.length} 条消息，超过官方导入一次最多 ${CONVERSATION_IMPORT_MAX_MESSAGES} 条的限制，已取消。`);
        }
        const empty = messages.find(message => String(message.content || '').length === 0);
        if (empty) throw new Error(`第 #${empty.seq} 条消息没有文本内容，官方导入接口无法复制，请先删除它。`);
        const tooLong = messages.find(message => String(message.content || '').length > CONVERSATION_IMPORT_MAX_CHARS);
        if (tooLong) {
            throw new Error(`第 #${tooLong.seq} 条消息超过 ${CONVERSATION_IMPORT_MAX_CHARS} 字，官方导入接口会截断，已取消。`);
        }
    }

    function confirmClone(meta, messages) {
        const loss = describeLoss(messages);
        const lines = [
            `克隆「${meta.title || '新对话'}」的 ${messages.length} 条消息为一个新会话？`,
            '副本会保留消息顺序、角色、正文、模型和创建时间，并生成新的会话和消息 ID。',
        ];
        if (loss.length) {
            lines.push(`副本会丢失：${loss.join('、')}。`);
        }
        lines.push('完成后会打开副本；原会话不变。继续？');
        return window.confirm(lines.join('\n\n'));
    }

    function sameMessages(actual, expected) {
        if (actual.length !== expected.length) return false;
        for (let index = 0; index < actual.length; index += 1) {
            if (actual[index].content !== expected[index].content) return false;
            if (actual[index].role !== expected[index].role) return false;
        }
        return true;
    }

    async function applyClone() {
        const sourceCid = readConversationId();
        const ids = splitConversationId(sourceCid);
        validateCid(sourceCid);
        if (!ids) throw new Error('无法识别当前会话 ID，暂不支持克隆。');
        if (ids.owner === 'anonymous') {
            throw new Error('当前是未登录的本地对话，消息不在云端，暂不支持克隆。请登录后打开云端对话。');
        }

        const [meta, messages] = await Promise.all([
            loadConversation(sourceCid),
            loadMessages(sourceCid),
        ]);
        validateMessages(messages);
        if (!confirmClone(meta, messages)) return { cancelled: true };

        const targetCid = `conv__${ids.owner}__${newId()}`;
        const now = Date.now();
        const targetMeta = {
            ...meta,
            title: cloneTitle(meta.title),
            createdAt: now,
            updatedAt: now,
        };
        const copied = messages.map((message, index) => ({
            ...message,
            id: `msg__${ids.owner}__${newId()}`,
            seq: index,
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
            return { ok: true, cid: targetCid };
        } catch (error) {
            // 副本已经建出来但导入失败时删掉，避免侧栏留下半截会话。
            if (created) {
                try {
                    await deleteConversation(targetCid);
                } catch {}
            }
            throw error;
        }
    }

    async function onCloneClick(event) {
        event.preventDefault();
        event.stopPropagation();
        if (state.busy) return;
        setBusy(true);
        try {
            const result = await applyClone();
            if (!result?.ok) return;
            // 官方是 Next.js SPA，直接整页进入副本，保证侧栏和消息都按服务端最新状态渲染。
            window.location.assign(`/chat/${encodeURIComponent(result.cid)}`);
        } catch (error) {
            window.alert(`SichangTools：克隆失败：${errorMessage(error)}`);
        } finally {
            setBusy(false);
        }
    }

    ensureButton();
    // SPA 切会话/窗口尺寸变化时官方会重绘顶栏，按钮可能被 React 一并移除；只做去抖后的补插。
    state.observer = new MutationObserver(scheduleEnsure);
    state.observer.observe(document.body, { childList: true, subtree: true });

    return {
        api: {},
        dispose: () => {
            state.observer?.disconnect();
            state.observer = null;
            if (state.timer) window.clearTimeout(state.timer);
            state.timer = 0;
            button?.removeEventListener('click', onCloneClick);
            button?.remove();
            button = null;
        },
    };
}
