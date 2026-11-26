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
            <button class="clear" hidden aria-label="清空全部记录">清空</button>
            <button class="fold" aria-label="收起">−</button>
        </div>
        <div class="compose">
            <div class="inputWrap">
                <textarea class="input" rows="2" placeholder="输入或粘贴文本，Ctrl+Enter 合成"></textarea>
                <button class="clearInput" hidden aria-label="清空输入" title="清空输入">×</button>
            </div>
            <div class="counter">
                <span class="stats">0 字 · 0 段</span>
            </div>
            <div class="row">
                <select class="voice" aria-label="音色">${groups}</select>
                <input class="rate" type="number" min="0.5" max="2" step="0.1" value="1" aria-label="语速" title="语速">
                <span class="rateUnit" aria-hidden="true">×</span>
                <button class="go">合成</button>
            </div>
        </div>
        <div class="body">
            <div class="empty">点消息下的「朗读」，或在上方输入文本合成</div>
            <div class="list"></div>
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
        clear: panel.querySelector('.clear'),
        fold: panel.querySelector('.fold'),
        compose: panel.querySelector('.compose'),
        input: panel.querySelector('.input'),
        stats: panel.querySelector('.stats'),
        clearInput: panel.querySelector('.clearInput'),
        voice: panel.querySelector('.voice'),
        rate: panel.querySelector('.rate'),
        go: panel.querySelector('.go'),
    };
}

// 剪贴板 API 在非安全上下文或权限被拒时不可用，退回临时 textarea
export function copyText(text, button, idle = '复制') {
    const done = () => {
        button.textContent = '已复制';
        clearTimeout(button.copyTimer);
        button.copyTimer = setTimeout(() => {
            button.textContent = idle;
        }, 1200);
    };
    const fallback = () => {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
        document.body.appendChild(area);
        area.select();
        let copied = false;
        try {
            copied = document.execCommand('copy');
        } catch {}
        area.remove();
        if (copied) done();
    };
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
    } else {
        fallback();
    }
}
