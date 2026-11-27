// 面板外壳：Shadow DOM 里的骨架与剪贴板兜底。这里只关心 DOM，不碰播放和合成状态。
import { PANEL_ID } from './constants.js';
import { ICONS } from './icons.js';
import { VOICE_GROUPS } from './voices.js';
import { PANEL_CSS } from './styles.js';

export function createPanel() {
    const host = document.createElement('div');
    host.id = PANEL_ID;
    // 面板嵌在官方输入卡片顶部，位置和宽度交给卡片；没有输入区时由 panel-layout 隐藏
    // 间距必须内联：:host 的普通声明会被站点外层样式（Tailwind 的 margin:0 重置）盖掉
    host.style.cssText = 'display:block; margin:0 0 18px;';
    // 面板嵌在官方输入卡片里，交互不要冒泡给站点的输入区/快捷键
    for (const type of ['click', 'pointerdown', 'keydown', 'keyup', 'change']) {
        host.addEventListener(type, event => event.stopPropagation());
    }
    const root = host.attachShadow({ mode: 'open' });
    // 构造式样式表不受页面 style-src 限制，站点收紧 CSP 时面板样式也不会失效
    if ('adoptedStyleSheets' in root) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(PANEL_CSS);
        root.adoptedStyleSheets = [sheet];
    } else {
        const style = document.createElement('style');
        style.textContent = PANEL_CSS;
        root.appendChild(style);
    }
    const panel = document.createElement('div');
    panel.className = 'panel';
    const groups = VOICE_GROUPS.map(group => `
        <optgroup label="${group.label}">
            ${group.voices.map(voice => `<option value="${voice.id}">${voice.label}</option>`).join('')}
        </optgroup>
    `).join('');
    panel.innerHTML = `
        <div class="head" title="单击收起/展开">
            <button class="fold" aria-label="收起">−</button>
            <span class="title">语音合成</span>
            <span class="spacer"></span>
            <button class="playToggle" hidden aria-label="暂停播放" title="暂停播放">${ICONS.pause}</button>
            <button class="rateCycle" hidden aria-label="播放倍速" title="播放倍速">1×</button>
            <select class="voice" aria-label="音色">${groups}</select>
            <button class="go" title="读取官方输入框文字合成语音">合成</button>
            <button class="clear" hidden aria-label="清空全部记录">清空</button>
        </div>
        <div class="body">
            <div class="list"></div>
        </div>
    `;
    root.appendChild(panel);
    // 先不挂到页面上：由 panel-layout 等站点水合完成后再插进官方输入卡片，
    // 避免在 React 管理的水合期多出节点，触发客户端重渲染清掉其它脚本的节点。
    return {
        host,
        root,
        panel,
        head: panel.querySelector('.head'),
        body: panel.querySelector('.body'),
        list: panel.querySelector('.list'),
        rateCycle: panel.querySelector('.rateCycle'),
        playToggle: panel.querySelector('.playToggle'),
        clear: panel.querySelector('.clear'),
        fold: panel.querySelector('.fold'),
        voice: panel.querySelector('.voice'),
        go: panel.querySelector('.go'),
        dispose() {
            host.remove();
        },
    };
}
