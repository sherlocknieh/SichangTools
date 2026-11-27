// 与官方 React 页面打交道的共用工具：从 DOM 找 context、触发受控输入。
// 这里依赖脚本以页面世界运行（@grant none）；沙箱隔离时 fiber 不可见，调用方要能回退刷新。

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
