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
.compose .counter .stats { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
.body { max-height: 360px; overflow: auto; }
.empty { padding: 16px 14px; color: #8a8a94; font-size: 12px; text-align: center; }
.item { padding: 7px 10px 8px; border-bottom: 1px solid #232329; }
.item:last-child { border-bottom: 0; }
.item.selected { background: #18181d; }
.item.selected .txt { color: #e8e8ea; }
.itemHead {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 18px;
    color: #80808a;
    font-size: 11px;
    user-select: none;
    cursor: pointer;
}
.itemHead .meta { color: #80808a; font-variant-numeric: tabular-nums; }
.itemHead .dur { color: #b9b9c2; font-variant-numeric: tabular-nums; }
.item[data-live] .dur { color: #d8b46a; animation: tts-pulse 1.2s ease-in-out infinite; }
@keyframes tts-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.itemHead .segCount { color: #6f6f79; font-size: 10px; }
.itemHead .more {
    width: 20px;
    height: 18px;
    line-height: 18px;
    border-radius: 5px;
    color: #7f7f89;
    font-size: 14px;
    opacity: .65;
}
.item:hover .more, .item.menuOpen .more, .more:focus-visible { opacity: 1; }
.itemHead .more:hover { background: #2c2c33; color: #fff; }
.itemHead .itemPlay {
    width: 20px;
    height: 18px;
    padding: 0;
    border-radius: 5px;
    color: #a9a9b3;
    font-size: 9px;
}
.itemHead .itemPlay:hover { background: #2c2c33; color: #fff; }
.itemHead .itemPlay.playing { background: #2d4a33; color: #a9e6b8; }
/* 整条重生成：原地逐段重合成，和逐段图标同一套旋转反馈 */
.itemHead .itemRegen {
    width: 20px;
    height: 18px;
    padding: 0;
    border-radius: 5px;
    color: #a9a9b3;
    font-size: 13px;
    line-height: 18px;
}
.itemHead .itemRegen:hover { background: #2c2c33; color: #fff; }
.itemHead .itemRegen.busy { animation: tts-spin 1s linear infinite; }
@keyframes tts-spin { to { transform: rotate(360deg); } }
.menu {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    min-width: 132px;
    padding: 4px;
    border: 1px solid #2c2c33;
    border-radius: 8px;
    background: #1d1d22;
    color: #e8e8ea;
    font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
    box-shadow: 0 8px 24px rgba(0, 0, 0, .45);
}
.menu[hidden] { display: none; }
.menu .menuInfo {
    padding: 4px 7px 6px;
    margin-bottom: 3px;
    border-bottom: 1px solid #2a2a30;
    color: #6f6f79;
    font-size: 10px;
}
.menu button {
    height: 24px;
    padding: 0 8px;
    border-radius: 5px;
    text-align: left;
    color: #d5d5dd;
    font-size: 11px;
}
.menu button:hover { background: #2a2a32; color: #fff; }
.menu button.danger { color: #d98a8a; }
.menu button.danger:hover { background: #3a2226; color: #ff9a9a; }
.txt {
    margin-top: 2px;
    color: #b9b9c2;
    font-size: 12px;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
    cursor: pointer;
}
.segList { margin-top: 4px; }
.segBox {
    border-left: 2px solid transparent;
    padding-left: 2px;
    border-radius: 5px;
}
.segBox.expanded { border-left-color: #5a9e6b; background: #1b1b20; }
.seg {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 23px;
    padding-right: 1px;
    border-radius: 5px;
    font-size: 11px;
    cursor: pointer;
}
.seg:hover { background: #202026; }
.seg.selected { background: #26262e; }
.seg.selected .segText { color: #fff; }
.seg .idx { width: 14px; flex: none; text-align: right; color: #6f6f79; font-variant-numeric: tabular-nums; }
.seg .segText {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: #a9a9b3;
}
.seg[data-active] .segText { color: #e8e8ea; }
.seg .segDur { flex: none; color: #80808a; font-variant-numeric: tabular-nums; }
.seg[data-state="pending"] .segDur { color: #6f6f79; }
.seg[data-state="active"] .segDur { color: #d8b46a; animation: tts-pulse 1.2s ease-in-out infinite; }
.seg[data-state="failed"] .segDur, .seg[data-state="skipped"] .segDur { color: #c97a7a; }
.segPlay {
    flex: none;
    width: 20px;
    height: 18px;
    padding: 0;
    border-radius: 5px;
    background: #2a2a32;
    color: #c9c9d1;
    font-size: 9px;
}
.segPlay:hover { background: #35353f; color: #fff; }
.segPlay.playing { background: #2d4a33; color: #a9e6b8; }
/* 单段「重生成」紧挨播放键：图标按钮，目标与状态放 title/aria */
.segRegen {
    flex: none;
    width: 20px;
    height: 18px;
    padding: 0;
    border-radius: 5px;
    background: #2a2a32;
    color: #c9c9d1;
    font-size: 12px;
}
.segRegen:hover { background: #35353f; color: #fff; }
.segRegen.busy { animation: tts-spin 1s linear infinite; }
.segRegen.failed { background: #3a2226; color: #ff9a9a; }
.segCaret {
    flex: none;
    width: 8px;
    color: #5a5a64;
    font-size: 10px;
    text-align: center;
    transition: transform .12s;
}
.segBox.expanded .segCaret { transform: rotate(90deg); color: #8a8a94; }
.segPanel { display: none; padding: 0 0 5px; }
.segBox.expanded .segPanel { display: block; }
.segBar {
    height: 3px;
    margin: 0 2px 4px 18px;
    border-radius: 2px;
    background: #2a2a32;
    overflow: hidden;
    cursor: pointer;
}
.segBar .fill { height: 100%; width: 0; background: #5a9e6b; transition: width .1s linear; }
.segControls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 3px;
    padding-left: 18px;
}
.segTime {
    flex: none;
    margin-right: 2px;
    color: #80808a;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
}
.segAction {
    flex: none;
    height: 19px;
    padding: 0 5px;
    border-radius: 5px;
    background: #2a2a32;
    color: #c9c9d1;
    font-size: 10px;
}
.segAction:hover { background: #35353f; color: #fff; }
.segAction.playing { background: #2d4a33; color: #a9e6b8; }
.segAction.synth { color: #d8b46a; }
.segAction.synth:hover { background: #3a3022; color: #f0cd8a; }
@media (max-width: 480px) {
    .panel { width: calc(100vw - 24px); }
}
button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible {
    outline: 2px solid #5a9e6b;
    outline-offset: 1px;
}
`;
