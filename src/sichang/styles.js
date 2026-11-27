// 面板样式：注入 Shadow DOM，选择器都在这里维护。
export const PANEL_CSS = `
:host { all: initial; display: block; margin: 0 0 18px; }
.panel {
    box-sizing: border-box;
    width: 100%;
    background: #16161a;
    color: #e8e8ea;
    border: 1px solid #2c2c33;
    border-radius: 10px;
    font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
    overflow: hidden;
    /* 按钮统一尺寸与配色，头部、记录头和分段行共用 */
    --btn-radius: 6px;
    --btn-bg: #26262f;
    --btn-bg-hover: #32323d;
    --accent: #5a9e6b;
    --accent-soft: #2d4a33;
    --accent-ink: #a9e6b8;
    --danger-soft: #3a2226;
    --danger-ink: #ff9a9a;
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
.title { font-size: 12px; font-weight: 600; flex: none; }
.spacer { flex: 1; }
button {
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    cursor: pointer;
    padding: 0;
    border-radius: var(--btn-radius);
    transition: background-color .12s ease, color .12s ease, opacity .12s ease;
    -webkit-tap-highlight-color: transparent;
}
button:disabled { opacity: .36; cursor: default; pointer-events: none; }
button:not(:disabled):active { filter: brightness(1.18); }
.head button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 22px;
    padding: 0 7px;
    border-radius: var(--btn-radius);
    color: #a9a9b3;
    font-size: 11px;
    line-height: 1;
}
.head button:hover { background: var(--btn-bg-hover); color: #fff; }
.head .rateCycle { min-width: 36px; text-align: center; font-variant-numeric: tabular-nums; }
.head .playToggle { min-width: 28px; text-align: center; font-size: 11px; }
.head .playToggle.playing { background: var(--accent-soft); color: var(--accent-ink); }
.head .clear.confirm { background: var(--danger-soft); color: var(--danger-ink); }
.head .clear.confirm:hover { background: #4a2a30; color: #ffb3b3; }
.head .voice {
    flex: 0 1 132px;
    min-width: 64px;
    height: 24px;
    padding: 0 4px;
    border: 1px solid #2c2c33;
    border-radius: var(--btn-radius);
    background: #1d1d22;
    color: #d5d5dd;
    font: 11px system-ui, -apple-system, 'Segoe UI', sans-serif;
    cursor: pointer;
}
.head .voice:focus { outline: 1px solid #4a4a56; border-color: #4a4a56; }
.head .go {
    flex: none;
    height: 24px;
    padding: 0 10px;
    border-radius: var(--btn-radius);
    background: #2d4a33;
    color: #a9e6b8;
    font-size: 11px;
}
.head .go:hover { background: #3a5f43; color: #fff; }
.head .go.paused { background: #4a3a22; color: #f0cd8a; }
.head .go.paused:hover { background: #5a4728; color: #fff; }
.panel.folded .body { display: none; }
.panel.folded .head { border-bottom: 0; }
/* 没有记录时 body 不占高度，顶栏下面也不留分隔线 */
.panel.empty .body { display: none; }
.panel.empty .head { border-bottom: 0; }
.body { max-height: min(360px, 42vh); overflow: auto; padding-bottom: 6px; }
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
/* 记录头图标按钮：透明底，悬停才亮，和分段行的实底图标区分层级 */
.itemHead .itemPlay,
.itemHead .itemRegen,
.itemHead .itemDownload,
.itemHead .itemDelete {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 20px;
    padding: 0;
    border-radius: var(--btn-radius);
    color: #a9a9b3;
    line-height: 1;
}
.itemHead .itemPlay { font-size: 9px; }
.itemHead .itemPlay:hover { background: var(--btn-bg-hover); color: #fff; }
.itemHead .itemPlay.playing {
    background: var(--accent-soft);
    color: var(--accent-ink);
    box-shadow: inset 0 0 0 1px rgba(169, 230, 184, .22);
}
.itemHead .itemRegen { font-size: 13px; }
.itemHead .itemRegen:hover { background: var(--btn-bg-hover); color: #fff; }
.itemHead .itemRegen.busy { animation: tts-spin 1s linear infinite; }
@keyframes tts-spin { to { transform: rotate(360deg); } }
.itemHead .itemDownload { font-size: 13px; }
.itemHead .itemDownload:hover { background: var(--btn-bg-hover); color: #fff; }
.itemHead .itemDelete { font-size: 11px; color: #8a8a94; }
.itemHead .itemDelete:hover { background: var(--danger-soft); color: var(--danger-ink); }
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
.segBox { border-radius: 5px; }
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
.seg.selected .segBar .fill { background: #7ec48f; }
.seg .idx { width: 14px; flex: none; text-align: right; color: #6f6f79; font-variant-numeric: tabular-nums; }
/* 音色标签：紧挨进度条/预览文字前面 */
.seg .segVoice {
    flex: none;
    max-width: 44px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #8a8a94;
    font-size: 9px;
}
.seg .segText {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: #a9a9b3;
}
.seg .segDur { flex: none; color: #80808a; font-variant-numeric: tabular-nums; }
.seg[data-state="pending"] .segDur { color: #6f6f79; }
.seg[data-state="active"] .segDur { color: #d8b46a; animation: tts-pulse 1.2s ease-in-out infinite; }
.seg[data-state="failed"] .segDur, .seg[data-state="skipped"] .segDur { color: #c97a7a; }
/* 分段行图标按钮：实底，尺寸/圆角统一，播放中带绿色高亮 */
.segAction,
.segRegen,
.segDelete {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 20px;
    padding: 0;
    border-radius: var(--btn-radius);
    background: var(--btn-bg);
    color: #c9c9d1;
    line-height: 1;
}
.segAction { font-size: 10px; }
.segRegen { font-size: 12px; }
.segAction:hover,
.segRegen:hover { background: var(--btn-bg-hover); color: #fff; }
.segRegen.busy { animation: tts-spin 1s linear infinite; }
.segRegen.failed { background: var(--danger-soft); color: var(--danger-ink); }
/* 分段删除：合成中删掉还没轮到的段就不再请求，直接跳过 */
.segDelete { font-size: 10px; }
.segDelete:hover { background: var(--danger-soft); color: var(--danger-ink); }
/* 播放中：进度条顶替预览文字，占同一块空间 */
.segBar {
    display: none;
    flex: 1 1 auto;
    min-width: 24px;
    height: 5px;
    margin: 0 3px;
    border-radius: 3px;
    background: var(--btn-bg);
    overflow: hidden;
    cursor: pointer;
}
.seg.showProgress .segText { display: none; }
.seg.showProgress .segBar { display: block; }
.segBar .fill { height: 100%; width: 0; background: var(--accent); transition: width .1s linear; }
.segAction.playing {
    background: var(--accent-soft);
    color: var(--accent-ink);
    box-shadow: inset 0 0 0 1px rgba(169, 230, 184, .22);
}
@media (max-width: 480px) {
    .body { max-height: 38vh; }
}
button:focus-visible, select:focus-visible, input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
}
`;
