// 面板样式：注入 Shadow DOM，选择器都在这里维护。
export const PANEL_CSS = `
:host { all: initial; display: block; margin: 0 0 6px; }
.panel {
    box-sizing: border-box;
    width: 100%;
    background: #16161a;
    color: #e8e8ea;
    border: 1px solid #2c2c33;
    border-radius: 10px;
    font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
    overflow: hidden;
}
.head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 6px 10px;
    background: #1d1d22;
    border-bottom: 1px solid #2c2c33;
    cursor: pointer;
    user-select: none;
}
.title { font-size: 12px; font-weight: 600; }
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
.head .rateCycle { min-width: 34px; text-align: center; font-variant-numeric: tabular-nums; }
.head .clear.confirm { background: #3a2226; color: #ff9a9a; }
.head .clear.confirm:hover { background: #4a2a30; color: #ffb3b3; }
.compose { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-top: 1px solid #232329; }
.compose select:focus { outline: 1px solid #4a4a56; border-color: #4a4a56; }
.compose .row { display: flex; align-items: center; gap: 6px; }
.compose select {
    height: 26px;
    padding: 0 6px;
    border: 1px solid #2c2c33;
    border-radius: 6px;
    background: #1d1d22;
    color: #d5d5dd;
    font: 12px system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.compose select { flex: 1; min-width: 0; }
.compose .go {
    height: 26px;
    padding: 0 14px;
    border-radius: 6px;
    background: #2d4a33;
    color: #a9e6b8;
    font-size: 12px;
}
.compose .go:hover { background: #3a5f43; color: #fff; }
.compose .go.paused { background: #4a3a22; color: #f0cd8a; }
.compose .go.paused:hover { background: #5a4728; color: #fff; }
.panel.folded .compose, .panel.folded .body { display: none; }
.panel.folded .head { border-bottom: 0; }
.body { max-height: min(360px, 42vh); overflow: auto; }
.empty { padding: 16px 14px; color: #8a8a94; font-size: 12px; text-align: center; }
.item { padding: 7px 10px 8px; border-bottom: 1px solid #232329; }
.item:last-child { border-bottom: 0; }
.item.selected { background: #18181d; }
.item.selected .txt { color: #e8e8ea; }
.itemHead {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 18px;
    color: #80808a;
    font-size: 11px;
    user-select: none;
    cursor: pointer;
}
.itemHead .itemCaret {
    flex: none;
    width: 8px;
    color: #5a5a64;
    font-size: 10px;
    text-align: center;
    transition: transform .12s;
}
.item:not(.folded) .itemCaret { transform: rotate(90deg); }
.item:hover .itemCaret { color: #8a8a94; }
.itemHead .meta { flex: none; color: #80808a; font-variant-numeric: tabular-nums; }
.itemHead .dur { flex: none; color: #b9b9c2; font-variant-numeric: tabular-nums; }
.item[data-live] .dur { color: #d8b46a; animation: tts-pulse 1.2s ease-in-out infinite; }
@keyframes tts-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.itemHead .segCount { flex: none; color: #6f6f79; font-size: 10px; }
.itemHead .itemDownload, .itemHead .itemDelete {
    flex: none;
    width: 20px;
    height: 18px;
    padding: 0;
    border-radius: 5px;
    color: #a9a9b3;
    font-size: 13px;
    line-height: 18px;
    text-align: center;
}
.itemHead .itemDownload:hover { background: #2c2c33; color: #fff; }
.itemHead .itemDelete { font-size: 11px; color: #8a8a94; }
.itemHead .itemDelete:hover { background: #3a2226; color: #ff9a9a; }
.itemHead .itemPlay {
    flex: none;
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
    flex: none;
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
.itemHead .txt {
    flex: 1 1 auto;
    min-width: 0;
    color: #b9b9c2;
    font-size: 12px;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
    cursor: pointer;
}
.segList { margin-top: 4px; }
.item.folded .segList { display: none; }
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
.segControls {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 3px;
    padding: 2px 0 0 18px;
}
.segBar {
    flex: 1 1 auto;
    min-width: 24px;
    height: 4px;
    margin: 0 2px;
    border-radius: 2px;
    background: #2a2a32;
    overflow: hidden;
    cursor: pointer;
}
.segBar .fill { height: 100%; width: 0; background: #5a9e6b; transition: width .1s linear; }
.segTime {
    flex: none;
    margin-right: 1px;
    color: #80808a;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
.segVoice {
    flex: none;
    max-width: 40px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #8a8a94;
    font-size: 9px;
}
.segAction {
    flex: none;
    width: 20px;
    height: 18px;
    padding: 0;
    border-radius: 5px;
    background: #2a2a32;
    color: #c9c9d1;
    font-size: 10px;
    line-height: 18px;
    text-align: center;
}
.segAction:hover { background: #35353f; color: #fff; }
.segAction.playing { background: #2d4a33; color: #a9e6b8; }
.segAction.synth { color: #d8b46a; }
.segAction.synth:hover { background: #3a3022; color: #f0cd8a; }
@media (max-width: 480px) {
    .body { max-height: 38vh; }
}
button:focus-visible, select:focus-visible, input:focus-visible {
    outline: 2px solid #5a9e6b;
    outline-offset: 1px;
}
`;
