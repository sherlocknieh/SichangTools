// 面板样式：注入 Shadow DOM，选择器都在这里维护。
export const PANEL_CSS = `
:host { all: initial; }
.panel {
    width: 300px;
    background: #16161a;
    color: #e8e8ea;
    border: 1px solid #2c2c33;
    border-radius: 12px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, .45);
    font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
    overflow: hidden;
}
.head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 8px 7px 10px;
    background: #1d1d22;
    border-bottom: 1px solid #2c2c33;
    cursor: move;
    user-select: none;
    touch-action: none;
}
.panel.dragging { opacity: .92; }
.title { font-size: 12px; font-weight: 600; }
.grip { color: #5a5a64; font-size: 11px; letter-spacing: -1px; }
.count {
    min-width: 18px;
    padding: 0 5px;
    height: 16px;
    line-height: 16px;
    text-align: center;
    border-radius: 8px;
    background: #3a3a44;
    color: #c9c9d1;
    font-size: 10px;
}
.spacer { flex: 1; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
button:disabled { opacity: .4; cursor: default; pointer-events: none; }
.head button {
    height: 20px;
    padding: 0 6px;
    border-radius: 6px;
    color: #a9a9b3;
    font-size: 11px;
}
.head button:hover { background: #2c2c33; color: #fff; }
.head select {
    height: 20px;
    padding: 0 3px;
    border: 0;
    border-radius: 6px;
    background: #2a2a32;
    color: #a9a9b3;
    font: 10px system-ui, -apple-system, 'Segoe UI', sans-serif;
    cursor: pointer;
}
.compose { display: flex; flex-direction: column; gap: 6px; padding: 9px 10px; border-bottom: 1px solid #232329; }
.compose textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 44px;
    max-height: 132px;
    padding: 7px 8px;
    border: 1px solid #2c2c33;
    border-radius: 7px;
    background: #101014;
    color: #e8e8ea;
    font: 12px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
    resize: none;
}
.compose .counter {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    color: #6f6f79;
    font-size: 10px;
}
.compose .counter .clearInput { color: #8a8a94; font-size: 10px; padding: 0 2px; }
.compose .counter .clearInput:hover { color: #d5d5dd; }
.compose textarea:focus, .compose select:focus, .compose input:focus { outline: 1px solid #4a4a56; border-color: #4a4a56; }
.compose textarea::placeholder { color: #6f6f79; }
.compose textarea.is-default { color: #6f6f79; }
.compose .row { display: flex; align-items: center; gap: 6px; }
.compose select, .compose input {
    height: 26px;
    padding: 0 6px;
    border: 1px solid #2c2c33;
    border-radius: 6px;
    background: #1d1d22;
    color: #d5d5dd;
    font: 12px system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.compose select { flex: 1; min-width: 0; }
.compose input.rate { width: 48px; padding: 0 4px; text-align: center; }
.compose .rateUnit { color: #80808a; font-size: 11px; margin-left: -3px; }
.compose .go {
    height: 26px;
    padding: 0 14px;
    border-radius: 6px;
    background: #2d4a33;
    color: #a9e6b8;
    font-size: 12px;
}
.compose .go:hover { background: #3a5f43; color: #fff; }
.panel.folded { width: auto; }
.panel.folded .compose, .panel.folded .body { display: none; }
.panel.folded .head { border-bottom: 0; }
.body { max-height: 340px; overflow: auto; }
.empty { padding: 16px 14px; color: #8a8a94; font-size: 12px; text-align: center; }
.item { display: flex; gap: 9px; padding: 9px 10px 9px 12px; border-bottom: 1px solid #232329; }
.item:last-child { border-bottom: 0; }
.meta { width: 38px; flex: none; padding-top: 1px; color: #80808a; font-size: 11px; }
.meta .dur { display: block; color: #b9b9c2; }
.item[data-live] .dur { color: #d8b46a; animation: tts-pulse 1.2s ease-in-out infinite; }
@keyframes tts-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.mid { flex: 1; min-width: 0; }
.txt {
    margin-bottom: 6px;
    color: #c9c9d1;
    font-size: 12px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    cursor: zoom-in;
}
.txt.expanded { display: block; overflow: visible; white-space: pre-wrap; cursor: zoom-out; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.tag {
    padding: 0 5px;
    height: 15px;
    line-height: 15px;
    border-radius: 4px;
    background: #24242b;
    color: #8a8a94;
    font-size: 10px;
}
.acts { display: flex; flex-wrap: wrap; gap: 5px; }
.acts button {
    height: 24px;
    padding: 0 8px;
    border-radius: 6px;
    background: #2a2a32;
    color: #d5d5dd;
    font-size: 12px;
}
.acts button:hover { background: #35353f; color: #fff; }
.acts .del { padding: 0 6px; color: #8a8a94; }
.acts .del:hover { background: #3a2226; color: #ff9a9a; }
.acts .playing { background: #2d4a33; color: #a9e6b8; }
.bar {
    display: none;
    height: 3px;
    margin-top: 7px;
    border-radius: 2px;
    background: #2a2a32;
    overflow: hidden;
    cursor: pointer;
}
.bar.show { display: block; }
.bar .fill { height: 100%; width: 0; background: #5a9e6b; transition: width .15s linear; }
.item[data-live] .bar .fill { width: 35%; background: #d8b46a; animation: tts-slide 1.1s ease-in-out infinite; }
.item[data-live] .bar.determinate .fill { animation: none; }
@keyframes tts-slide { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
.segs { margin-top: 5px; }
.segs summary {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #8a8a94;
    font-size: 11px;
    cursor: pointer;
    list-style: none;
    user-select: none;
}
.segs summary::-webkit-details-marker { display: none; }
.segs summary::before { content: '▸'; font-size: 9px; transition: transform .15s; }
.segs[open] summary::before { transform: rotate(90deg); }
.segs .segCount { color: #b9b9c2; }
.segBox { border-top: 1px solid #1f1f25; padding: 2px 0; }
.segBox:first-child { border-top: 0; }
.seg {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
}
.seg .idx { width: 16px; flex: none; text-align: right; color: #6f6f79; }
.seg .segText {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: #a9a9b3;
}
.seg .segDur { flex: none; color: #80808a; }
.seg[data-state="pending"] .segDur { color: #6f6f79; }
.seg[data-state="active"] .segDur { color: #d8b46a; animation: tts-pulse 1.2s ease-in-out infinite; }
.seg[data-state="failed"] .segDur, .seg[data-state="skipped"] .segDur { color: #c97a7a; }
.seg button {
    flex: none;
    height: 18px;
    padding: 0 5px;
    border-radius: 5px;
    background: #2a2a32;
    color: #c9c9d1;
    font-size: 10px;
}
.seg button:hover { background: #35353f; color: #fff; }
.seg .segPlay { width: 20px; padding: 0; font-size: 9px; }
.seg .segPlay.playing { background: #2d4a33; color: #a9e6b8; }
.segBar {
    display: none;
    height: 2px;
    margin: 2px 0 3px 20px;
    border-radius: 1px;
    background: #2a2a32;
    overflow: hidden;
    cursor: pointer;
}
.segBar.show { display: block; }
.segBar .fill { height: 100%; width: 0; background: #5a9e6b; transition: width .1s linear; }
@media (max-width: 480px) {
    .panel { width: calc(100vw - 24px); }
}
button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible {
    outline: 2px solid #5a9e6b;
    outline-offset: 1px;
}
`;
