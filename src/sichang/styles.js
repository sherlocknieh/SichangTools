// 面板样式：注入 Shadow DOM，选择器都在这里维护。
export const PANEL_CSS = `
:host { all: initial; display: block; margin: 0 0 18px; }
.panel {
    box-sizing: border-box;
    width: 100%;
    background: linear-gradient(180deg, #17171d, #141419);
    color: #e9e9ee;
    border: 1px solid #2b2b34;
    border-radius: 12px;
    font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
    overflow: hidden;
    /* 按钮统一尺寸与配色，头部、记录头和分段行共用 */
    --btn-radius: 7px;
    --btn-bg: #23232b;
    --btn-bg-hover: #2f2f3a;
    --icon-ink: #a8a8b2;
    --accent: #6cbf82;
    --accent-soft: #24392b;
    --accent-ink: #b7f0c4;
    --danger-soft: #3a2226;
    --danger-ink: #ff9a9a;
}
[hidden] { display: none !important; }
.head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 8px 7px 10px;
    background: linear-gradient(180deg, #202028, #1b1b21);
    border-bottom: 1px solid #2b2b34;
    cursor: pointer;
    user-select: none;
}
.title { font-size: 12px; font-weight: 600; letter-spacing: .2px; flex: none; }
.spacer { flex: 1; }
button {
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    cursor: pointer;
    padding: 0;
    border-radius: var(--btn-radius);
    transition: background-color .12s ease, color .12s ease, opacity .12s ease, box-shadow .12s ease;
    -webkit-tap-highlight-color: transparent;
}
/* 图标统一尺寸和基线，避免各字形自带留白导致高低不齐 */
button > svg { display: block; width: 13px; height: 13px; pointer-events: none; }
button:disabled { opacity: .34; cursor: default; pointer-events: none; }
button:not(:disabled):active { filter: brightness(1.16); }
.head button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 26px;
    padding: 0 9px;
    border-radius: var(--btn-radius);
    color: var(--icon-ink);
    font-size: 11px;
    line-height: 1;
}
.head button:hover { background: var(--btn-bg-hover); color: #fff; }
.head .fold {
    width: 20px;
    padding: 0;
    color: #5a5a64;
    /* 图标本身垂直居中，不靠字形基线；展开时整体旋转 90° */
    transition: transform .12s, color .12s ease;
}
.head .fold > svg { width: 11px; height: 11px; }
/* 收起时箭头朝右，展开时和分段行一样转 90° 朝下 */
.panel:not(.folded) .head .fold { transform: rotate(90deg); }
/* 折叠按钮只变图标颜色，不加悬停底色 */
.head .fold:hover { background: none; color: #a8a8b2; }
.head .rateCycle {
    min-width: 38px;
    padding: 0 7px;
    background: #23232b;
    color: #bcbcc6;
    font-variant-numeric: tabular-nums;
}
.head .rateCycle:hover { background: var(--btn-bg-hover); color: #fff; }
.head .playToggle {
    min-width: 28px;
    padding: 0 6px;
    background: var(--accent-soft);
    color: var(--accent-ink);
}
.head .playToggle.playing { background: #2c4734; color: #c8f6d2; }
.head .playToggle:hover { background: #35543e; color: #fff; }
.head .clear {
    padding: 0 10px;
    background: var(--btn-bg);
    color: #a9a9b3;
    font-weight: 500;
}
.head .clear:hover { background: var(--btn-bg-hover); color: #fff; }
/* 点开「清空」后原地换成两个选项，再点任一项立即执行 */
.head .clearOptions {
    display: inline-flex;
    gap: 4px;
}
.head .clearOption {
    padding: 0 9px;
    background: var(--danger-soft);
    color: var(--danger-ink);
    font-weight: 500;
    white-space: nowrap;
}
.head .clearOption:hover { background: #4a2a30; color: #ffb3b3; }
.head .voice {
    flex: 0 1 132px;
    min-width: 64px;
    height: 26px;
    padding: 0 20px 0 8px;
    border: 1px solid #30303a;
    border-radius: var(--btn-radius);
    background-color: #1a1a21;
    /* 自绘小箭头，和按钮里的线条图标同粗细 */
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2385858f' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 6px center;
    background-size: 11px;
    color: #d7d7de;
    font: 11px system-ui, -apple-system, 'Segoe UI', sans-serif;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    transition: border-color .12s ease, background-color .12s ease;
}
.head .voice:hover { border-color: #3c3c47; }
.head .voice:focus { outline: 1px solid #4a4a56; border-color: #4a4a56; }
.panel.folded .body { display: none; }
.panel.folded .head { border-bottom: 0; }
/* 没有记录时 body 不占高度，顶栏下面也不留分隔线 */
.panel.empty .body { display: none; }
.panel.empty .head { border-bottom: 0; }
.body { max-height: min(360px, 42vh); overflow: auto; padding-bottom: 6px; }
.item { padding: 7px 10px 8px; border-bottom: 1px solid #232329; }
.item:last-child { border-bottom: 0; }
.item.selected { background: #18181d; }
.item.selected .txt { color: #e9e9ee; }
.itemHead {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 22px;
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
    line-height: 1;
    text-align: center;
    transition: transform .12s;
}
.item:not(.folded) .itemCaret { transform: rotate(90deg); }
.item:hover .itemCaret { color: #8a8a94; }
.itemHead .dur { flex: none; color: #b9b9c2; font-variant-numeric: tabular-nums; }
.item[data-live] .dur { color: #d8b46a; animation: tts-pulse 1.2s ease-in-out infinite; }
@keyframes tts-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.itemHead .segCount { flex: none; color: #6f6f79; font-size: 10px; }
/* 记录头与分段行共用同一套图标按钮：同尺寸、同圆角、同底色，右侧操作列才能对齐 */
.itemHead .itemPlay,
.itemHead .itemRegen,
.itemHead .itemDownload,
.itemHead .itemDelete,
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
    border-radius: 6px;
    background: var(--btn-bg);
    color: #c2c2cb;
    line-height: 1;
}
.itemHead .itemPlay > svg,
.segAction > svg { width: 11px; height: 11px; }
.itemHead .itemRegen > svg,
.itemHead .itemDownload > svg,
.segRegen > svg { width: 12px; height: 12px; }
.itemHead .itemDelete > svg,
.segDelete > svg { width: 10px; height: 10px; }
.itemHead .itemPlay:hover,
.itemHead .itemRegen:hover,
.itemHead .itemDownload:hover,
.segAction:hover,
.segRegen:hover { background: var(--btn-bg-hover); color: #fff; }
.itemHead .itemPlay.playing,
.segAction.playing { background: #2f5239; color: #c8f6d2; }
.itemHead .itemRegen.busy svg,
.segRegen.busy svg { animation: tts-spin 1s linear infinite; }
@keyframes tts-spin { to { transform: rotate(360deg); } }
/* 删除键常驻软底，不用悬停也能看见；悬停再转危险色 */
.itemHead .itemDelete,
.segDelete { background: var(--btn-bg); color: #80808a; }
.itemHead .itemDelete:hover,
.segDelete:hover { background: var(--danger-soft); color: var(--danger-ink); }
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
.segBox { border-radius: 6px; }
.seg {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 25px;
    padding: 1px 0;
    border-radius: 6px;
    font-size: 11px;
    cursor: pointer;
}
.seg:hover { background: #1e1e25; }
.seg.selected { background: #26262e; }
.seg.selected .segText { color: #fff; }
.seg.selected .segBar .fill { background: #7ec48f; }
.seg .idx { width: 14px; flex: none; text-align: right; color: #6f6f79; font-variant-numeric: tabular-nums; }
/* 音色标签：紧挨进度条/预览文字前面 */
.seg .segVoice {
    flex: none;
    max-width: 50px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #8a8a94;
    font-size: 9px;
}
.seg .segText {
    flex: 1;
    min-width: 0;
    /* 标题保持单行，超出行宽的部分省略，不按字符数预先截断 */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #a9a9b3;
}.seg .segDur { flex: none; color: #80808a; font-variant-numeric: tabular-nums; }
.seg[data-state="pending"] .segDur { color: #6f6f79; }
.seg[data-state="active"] .segDur { color: #d8b46a; animation: tts-pulse 1.2s ease-in-out infinite; }
.seg[data-state="failed"] .segDur, .seg[data-state="skipped"] .segDur { color: #c97a7a; }
/* 分段重生成失败时的短暂反馈 */
.segRegen.failed { background: var(--danger-soft); color: var(--danger-ink); }
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
    background: #2f5239;
    color: #c8f6d2;
}
@media (max-width: 480px) {
    .body { max-height: 38vh; }
}
button:focus-visible, select:focus-visible, input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
}
`;
