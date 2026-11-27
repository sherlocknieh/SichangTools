// 与官方 React 页面打交道的共用工具：从 DOM 找 context、定位输入区、触发受控输入。
// 这里依赖脚本以页面世界运行（@grant none）；沙箱隔离时 fiber 不可见，调用方要能回退刷新。

import { OFFICIAL_ATTACH_SELECTOR, OFFICIAL_SEND_SELECTOR } from './constants.js';

// 官方输入区：先找有实际宽度的 textarea，再向上找同时包住附件/发送按钮的卡片。
// 不能只以「发送消息」为锚点：AI 回复期间它会变成「停止生成」，面板不能跟着消失。
// 水合、切会话都会替换这棵子树，调用方不能长期缓存返回的节点。
export function findComposer() {
    const candidates = [...document.querySelectorAll('textarea')]
        .filter(textarea => textarea.getBoundingClientRect().width > 0);
    for (const textarea of candidates) {
        let container = textarea.parentElement;
        for (let depth = 0; container && depth < 4; depth += 1) {
            const send = container.querySelector(OFFICIAL_SEND_SELECTOR);
            const attach = container.querySelector(OFFICIAL_ATTACH_SELECTOR);
            if (send || attach) {
                return { textarea, container, send, row: send?.parentElement ?? null };
            }
            container = container.parentElement;
        }
    }
    return null;
}

// 官方页面运行在 React，DOM 节点挂有 __reactFiber$* 属性。
// 从元素沿 return 向上找同时提供会话操作和当前会话的 context value。
export function officialContext(element) {
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

// 官方输入区是 React 受控 textarea；直接改 value 不会更新 state，
// 必须走原型 setter 再派发 input，才能让官方清空/改写输入框。
export function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
}
