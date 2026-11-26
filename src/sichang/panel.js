// 面板外壳：Shadow DOM 里的骨架与剪贴板兜底。这里只关心 DOM，不碰播放和合成状态。
import { PANEL_ID } from './constants.js';
import { VOICE_GROUPS } from './voices.js';
import { PANEL_CSS } from './styles.js';

export function createPanel() {
    const host = document.createElement('div');
    host.id = PANEL_ID;
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
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
        <div class="head" title="单击收起/展开，拖动移动，双击复位">
            <span class="grip" aria-hidden="true">⠿</span>
            <span class="title">语音捕获</span>
            <span class="count">0</span>
            <span class="spacer"></span>
            <button class="rateCycle" aria-label="播放倍速" title="播放倍速（仅已下载音频）">1×</button>
            <button class="clear" hidden aria-label="清空全部记录">清空</button>
            <button class="fold" aria-label="收起">−</button>
        </div>
        <div class="body">
            <div class="empty">点消息下的「朗读」，或在下方输入文本合成</div>
            <div class="list"></div>
        </div>
        <div class="compose">
            <div class="inputWrap">
                <textarea class="input" rows="2" placeholder="输入或粘贴文本，Ctrl+Enter 合成"></textarea>
                <button class="clearInput" hidden aria-label="清空输入" title="清空输入">×</button>
            </div>
            <div class="row">
                <select class="voice" aria-label="音色">${groups}</select>
                <button class="go">合成</button>
            </div>
        </div>
    `;
    root.appendChild(panel);
    document.documentElement.appendChild(host);
    return {
        host,
        panel,
        head: panel.querySelector('.head'),
        body: panel.querySelector('.body'),
        list: panel.querySelector('.list'),
        empty: panel.querySelector('.empty'),
        count: panel.querySelector('.count'),
        rateCycle: panel.querySelector('.rateCycle'),
        clear: panel.querySelector('.clear'),
        fold: panel.querySelector('.fold'),
        compose: panel.querySelector('.compose'),
        input: panel.querySelector('.input'),
        clearInput: panel.querySelector('.clearInput'),
        voice: panel.querySelector('.voice'),
        go: panel.querySelector('.go'),
    };
}
