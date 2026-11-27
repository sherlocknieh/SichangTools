// 站点水合门禁：React 水合完成前不要往它管理的 DOM 里插节点。
// 多出来的节点会让 React 放弃当前子树的水合、改为整页客户端重渲染，
// 连带清掉其它脚本挂在页面上的节点（例如 deepseek-web-toolkit 的消息导航）。
// 面板、加号、克隆和 fork 按钮都先经 canMutate() 判断，再决定是否插入。

const RETRY_MS = 200;
// 站点改版或非 React 页面：load 后等这么久仍没有 fiber 就强制放行，避免功能整体失效
const FALLBACK_MS = 5000;

export function hasReactFiber(element) {
    return Boolean(element)
        && Object.getOwnPropertyNames(element).some(key => key.startsWith('__reactFiber$'));
}

let forced = false;
let settled = false;
let retryTimer = 0;
let fallbackTimer = 0;
const listeners = new Set();

// element 即将被修改的 React 管理节点；水合前返回 false，调用方应放弃本次插入等下一次触发。
// 兜底放行后一律返回 true。
export function canMutate(element) {
    if (forced) return true;
    return document.readyState === 'complete' && hasReactFiber(element);
}

// 用聊天页的 textarea 作为水合采样点；没有输入区的页面退回根节点的第一个元素
function sampleNode() {
    return document.querySelector('textarea') || document.body?.firstElementChild || null;
}

function settle() {
    if (settled) return;
    settled = true;
    window.clearTimeout(retryTimer);
    window.clearTimeout(fallbackTimer);
    retryTimer = 0;
    fallbackTimer = 0;
    for (const fn of [...listeners]) {
        listeners.delete(fn);
        try {
            fn();
        } catch (error) {
            console.warn('[SichangTools] 水合后回调失败', error);
        }
    }
}

function check() {
    if (settled) return;
    if (document.readyState !== 'complete') return;
    if (!hasReactFiber(sampleNode())) return;
    settle();
}

function retry() {
    retryTimer = 0;
    if (settled) return;
    check();
    if (settled) return;
    retryTimer = window.setTimeout(retry, RETRY_MS);
}

function arm() {
    check();
    if (settled) return;
    retry();
    // 一直没有 fiber：照旧放行，功能优先
    fallbackTimer = window.setTimeout(() => {
        forced = true;
        settle();
    }, FALLBACK_MS);
}

// 水合完成（或兜底放行）后回调一次；已经完成时立即回调。
// 返回取消订阅函数，模块 dispose 时调用。
export function onSettled(callback) {
    if (settled) {
        callback();
        return () => {};
    }
    listeners.add(callback);
    return () => listeners.delete(callback);
}

if (document.readyState === 'complete') arm();
else window.addEventListener('load', arm, { once: true });
