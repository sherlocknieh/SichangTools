// 共享的“操作中”按钮动画：把按钮内容换成持续旋转的箭头图标。
// 用伪元素而不是替换子节点，官方 React 管理的按钮和脚本自己注入的按钮都能安全使用。
const BUSY_ATTR = 'data-sichang-busy';
const STYLE_ID = 'sichang-busy-icon-style';
const CSS = `
@keyframes sichang-busy-spin { to { transform: rotate(360deg); } }
button[${BUSY_ATTR}] {
    --sichang-busy-arrow: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8'/%3E%3Cpath d='M21 3v5h-5'/%3E%3C/svg%3E");
    position: relative;
    pointer-events: none;
}
button[${BUSY_ATTR}] > * { visibility: hidden; }
button[${BUSY_ATTR}]::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    background: currentColor;
    -webkit-mask: var(--sichang-busy-arrow) center / contain no-repeat;
    mask: var(--sichang-busy-arrow) center / contain no-repeat;
    animation: sichang-busy-spin .8s linear infinite;
}
`;

export function ensureBusyIconStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}

export function setBusyIcon(button, busy) {
    if (!button || (busy && !button.isConnected)) return;
    ensureBusyIconStyle();
    if (busy) button.setAttribute(BUSY_ATTR, '');
    else button.removeAttribute(BUSY_ATTR);
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
}

export function clearBusyIcons() {
    for (const button of document.querySelectorAll(`[${BUSY_ATTR}]`)) {
        button.removeAttribute(BUSY_ATTR);
        button.setAttribute('aria-busy', 'false');
    }
}
