// 面板顶栏、记录头和分段行共用的图标：同一套 24 视框、2px 圆头描边，颜色跟随 currentColor。
// 统一放这里，避免各模块各写一份字形，字号和粗细对不齐。
const shape = body => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const solid = body => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor" stroke="none">${body}</svg>`;

export const ICONS = {
    play: solid('<path d="M8.2 5.4v13.2L19 12z"/>'),
    pause: solid('<rect x="7.4" y="5.4" width="3.4" height="13.2" rx="1.7"/><rect x="13.2" y="5.4" width="3.4" height="13.2" rx="1.7"/>'),
    regen: shape('<path d="M20 12a8 8 0 1 1-8-8c2.2 0 4.3.9 5.9 2.4L20 8.5"/><path d="M20 3.5v5h-5"/>'),
    chevron: shape('<path d="m9 6 6 6-6 6"/>'),
    download: shape('<path d="M12 4.5v10"/><path d="m7.8 10.6 4.2 4.2 4.2-4.2"/><path d="M5.5 19h13"/>'),
    close: shape('<path d="m7 7 10 10M17 7 7 17"/>'),
    synth: shape('<path d="M11 5 6.5 9H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.5L11 19z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a9 9 0 0 1 0 12"/>'),
    waiting: shape('<circle cx="6.6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="17.4" cy="12" r="1.3" fill="currentColor"/>'),
};
