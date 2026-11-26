// ==UserScript==
// @name         SichangTools
// @namespace    https://github.com/sherlocknieh/
// @version      2026.11.26.1747
// @description  接管思畅 AI 朗读，分段合成、边下边播并保存 WAV
// @icon         https://sichang.xyz/favicon.ico
// @match        https://sichang.xyz/*
// @grant        none
// ==/UserScript==

(function() {
	"use strict";
	var TTS_PATH = "/api/tts";
	var PANEL_ID = "sichang-tts-capture";
	var DEFAULT_SAMPLE_RATE = 24e3;
	var SEGMENT_HEADER = "X-Sichang-Segment";
	var DEFAULT_INPUT_TEXT = "你好，我是思畅，今天天气不错。";
	var VOICE_STORE_KEY = "sichang-tts-voice";
	var RATE_STORE_KEY = "sichang-tts-rate";
	var FOLD_STORE_KEY = "sichang-tts-folded";
	var DRAFT_STORE_KEY = "sichang-tts-draft";
	var POS_STORE_KEY = "sichang-tts-pos";
	var VOICE_GROUPS = [{
		label: "中文",
		voices: [
			{
				id: "mimo_default",
				label: "默认"
			},
			{
				id: "冰糖",
				label: "冰糖（女声）"
			},
			{
				id: "茉莉",
				label: "茉莉（女声）"
			},
			{
				id: "苏打",
				label: "苏打（男声）"
			},
			{
				id: "白桦",
				label: "白桦（男声）"
			}
		]
	}, {
		label: "English",
		voices: [
			{
				id: "Mia",
				label: "Mia（女声）"
			},
			{
				id: "Chloe",
				label: "Chloe（女声）"
			},
			{
				id: "Milo",
				label: "Milo（男声）"
			},
			{
				id: "Dean",
				label: "Dean（男声）"
			}
		]
	}];
	var VOICE_LABELS = new Map(VOICE_GROUPS.flatMap((group) => group.voices.map((voice) => [voice.id, voice.label])));
	var PANEL_CSS = `
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
.compose { display: flex; flex-direction: column; gap: 6px; padding: 9px 10px; border-bottom: 1px solid #232329; }
.compose .inputWrap { position: relative; }
.compose textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 44px;
    max-height: 132px;
    padding: 7px 26px 7px 8px;
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
.compose .clearInput {
    position: absolute;
    top: 5px;
    right: 5px;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    color: #6f6f79;
    font-size: 14px;
    line-height: 18px;
    text-align: center;
}
.compose .clearInput:hover { background: #2c2c33; color: #fff; }
.compose .clearInput[hidden] { display: none; }
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
.compose .go.paused { background: #4a3a22; color: #f0cd8a; }
.compose .go.paused:hover { background: #5a4728; color: #fff; }
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
	function createPanel() {
		const host = document.createElement("div");
		host.id = PANEL_ID;
		host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
		const root = host.attachShadow({ mode: "open" });
		if ("adoptedStyleSheets" in root) {
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(PANEL_CSS);
			root.adoptedStyleSheets = [sheet];
		} else {
			const style = document.createElement("style");
			style.textContent = PANEL_CSS;
			root.appendChild(style);
		}
		const panel = document.createElement("div");
		panel.className = "panel";
		panel.innerHTML = `
        <div class="head" title="拖动移动，双击复位">
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
                <select class="voice" aria-label="音色">${VOICE_GROUPS.map((group) => `
        <optgroup label="${group.label}">
            ${group.voices.map((voice) => `<option value="${voice.id}">${voice.label}</option>`).join("")}
        </optgroup>
    `).join("")}</select>
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
			head: panel.querySelector(".head"),
			body: panel.querySelector(".body"),
			list: panel.querySelector(".list"),
			empty: panel.querySelector(".empty"),
			count: panel.querySelector(".count"),
			clear: panel.querySelector(".clear"),
			fold: panel.querySelector(".fold"),
			compose: panel.querySelector(".compose"),
			input: panel.querySelector(".input"),
			stats: panel.querySelector(".stats"),
			clearInput: panel.querySelector(".clearInput"),
			voice: panel.querySelector(".voice"),
			rate: panel.querySelector(".rate"),
			go: panel.querySelector(".go")
		};
	}
	function copyText(text, button, idle = "复制") {
		const done = () => {
			button.textContent = "已复制";
			clearTimeout(button.copyTimer);
			button.copyTimer = setTimeout(() => {
				button.textContent = idle;
			}, 1200);
		};
		const fallback = () => {
			const area = document.createElement("textarea");
			area.value = text;
			area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
			document.body.appendChild(area);
			area.select();
			let copied = false;
			try {
				copied = document.execCommand("copy");
			} catch {}
			area.remove();
			if (copied) done();
		};
		if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
		else fallback();
	}
	function createPanelLayout(host) {
		const { ui } = host;
		function applyFold(folded) {
			ui.panel.classList.toggle("folded", folded);
			ui.fold.textContent = folded ? "+" : "−";
			ui.fold.setAttribute("aria-label", folded ? "展开" : "收起");
			try {
				localStorage.setItem(FOLD_STORE_KEY, folded ? "1" : "0");
			} catch {}
			if (!folded) host.autoGrowInput();
		}
		ui.fold.addEventListener("click", () => applyFold(!ui.panel.classList.contains("folded")));
		try {
			if (localStorage.getItem("sichang-tts-folded") === "1") applyFold(true);
		} catch {}
		let manualPosition = false;
		function clampPosition(left, top) {
			const rect = ui.host.getBoundingClientRect();
			return {
				left: Math.max(4, Math.min(window.innerWidth - rect.width - 4, left)),
				top: Math.max(4, Math.min(window.innerHeight - rect.height - 4, top))
			};
		}
		function applyPosition(position) {
			ui.host.style.left = `${Math.round(position.left)}px`;
			ui.host.style.top = `${Math.round(position.top)}px`;
			ui.host.style.right = "auto";
			ui.host.style.bottom = "auto";
		}
		function resetPosition() {
			manualPosition = false;
			try {
				localStorage.removeItem(POS_STORE_KEY);
			} catch {}
			ui.host.style.left = "";
			ui.host.style.top = "";
			ui.host.style.right = "16px";
			ui.host.style.bottom = "16px";
			placePanel();
		}
		function placePanel() {
			if (manualPosition) return;
			const box = [...document.querySelectorAll("textarea, [contenteditable=\"true\"]")].find((element) => {
				const rect = element.getBoundingClientRect();
				return rect.width > 160 && rect.bottom > window.innerHeight - 160;
			});
			const bottom = box ? Math.max(16, window.innerHeight - box.getBoundingClientRect().top + 12) : 16;
			ui.host.style.bottom = `${Math.round(bottom)}px`;
		}
		try {
			const saved = JSON.parse(localStorage.getItem("sichang-tts-pos") || "null");
			if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
				applyPosition(clampPosition(saved.left, saved.top));
				manualPosition = true;
			}
		} catch {}
		placePanel();
		let drag = null;
		ui.head.addEventListener("pointerdown", (event) => {
			if (event.button !== 0 || event.target.closest("button, select")) return;
			host.closeMenus();
			const rect = ui.host.getBoundingClientRect();
			drag = {
				dx: event.clientX - rect.left,
				dy: event.clientY - rect.top
			};
			ui.head.setPointerCapture(event.pointerId);
			ui.panel.classList.add("dragging");
		});
		ui.head.addEventListener("pointermove", (event) => {
			if (!drag) return;
			applyPosition(clampPosition(event.clientX - drag.dx, event.clientY - drag.dy));
		});
		function endDrag() {
			if (!drag) return;
			drag = null;
			ui.panel.classList.remove("dragging");
			manualPosition = true;
			const rect = ui.host.getBoundingClientRect();
			try {
				localStorage.setItem(POS_STORE_KEY, JSON.stringify({
					left: rect.left,
					top: rect.top
				}));
			} catch {}
		}
		ui.head.addEventListener("pointerup", endDrag);
		ui.head.addEventListener("pointercancel", endDrag);
		ui.head.addEventListener("dblclick", (event) => {
			if (event.target.closest("button, select")) return;
			resetPosition();
		});
		const onResize = () => {
			host.closeMenus();
			if (!manualPosition) {
				placePanel();
				return;
			}
			const rect = ui.host.getBoundingClientRect();
			applyPosition(clampPosition(rect.left, rect.top));
		};
		window.addEventListener("resize", onResize);
		return {
			api: {
				applyFold,
				placePanel,
				resetPosition
			},
			dispose: () => window.removeEventListener("resize", onResize)
		};
	}
	function formatDuration(seconds) {
		const total = Math.max(0, Math.round(seconds));
		return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
	}
	function formatSegmentDuration(seconds) {
		if (seconds < 10) return `${seconds.toFixed(1)}s`;
		return formatDuration(seconds);
	}
	function formatRate(rate) {
		const value = Number(rate);
		if (!Number.isFinite(value) || value <= 0) return "1×";
		return `${Math.round(value * 10) / 10}×`;
	}
	function previewText(text) {
		return text.replace(/\[[^\]]{1,10}\]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
	}
	function splitText(text) {
		const normalized = String(text || "").replace(/\r/g, "").trim();
		if (!normalized) return [];
		const parts = normalized.split(/(?<=[。！？!?；;…\n])/).filter((part) => part.trim());
		const chunks = [];
		let current = "";
		const flush = () => {
			if (current.trim()) chunks.push(current.trim());
			current = "";
		};
		for (let part of parts) {
			while (part.length > 160) {
				flush();
				chunks.push(part.slice(0, 160));
				part = part.slice(160);
			}
			if (current.length + part.length > 160) flush();
			current += part;
		}
		flush();
		return chunks;
	}
	function splitInHalf(text) {
		if (text.length < 40) return null;
		const middle = Math.floor(text.length / 2);
		const before = text.lastIndexOf("，", middle);
		const cut = before > text.length * .3 ? before + 1 : middle;
		return [text.slice(0, cut), text.slice(cut)];
	}
	function createCompose(host) {
		const { ui } = host;
		ui.voice.addEventListener("change", () => {
			try {
				localStorage.setItem(VOICE_STORE_KEY, ui.voice.value);
			} catch {}
		});
		function currentTts() {
			return {
				voice: ui.voice.value || "mimo_default",
				rate: Math.min(2, Math.max(.5, Number(ui.rate.value) || 1))
			};
		}
		function activeSynthesis() {
			const session = host.activeSession;
			if (!session || session.stopped || !session.record) return null;
			if (!host.records.includes(session.record)) return null;
			if (session.record.state !== "capturing") return null;
			return session;
		}
		function syncGoButton() {
			const session = activeSynthesis();
			if (session) {
				const paused = Boolean(session.synthesisPaused);
				ui.go.textContent = paused ? "继续" : "暂停";
				ui.go.classList.toggle("paused", paused);
				ui.go.disabled = false;
				const label = paused ? "继续合成" : "暂停合成";
				ui.go.title = label;
				ui.go.setAttribute("aria-label", label);
				return;
			}
			ui.go.textContent = "合成";
			ui.go.classList.remove("paused");
			ui.go.title = "合成";
			ui.go.setAttribute("aria-label", "合成");
			ui.go.disabled = !ui.input.value.trim();
		}
		function autoGrowInput() {
			if (ui.panel.classList.contains("folded")) return;
			ui.input.style.height = "auto";
			ui.input.style.height = `${Math.min(ui.input.scrollHeight + 2, 132)}px`;
		}
		let inputIsDefault = false;
		function setInputDefault(isDefault) {
			inputIsDefault = isDefault;
			if (isDefault) host.inputTyping = false;
			ui.input.classList.toggle("is-default", isDefault);
		}
		function saveDraft() {
			try {
				localStorage.setItem(DRAFT_STORE_KEY, inputIsDefault ? "" : ui.input.value);
			} catch {}
		}
		function setInputText(text) {
			ui.input.value = text;
			host.inputTyping = false;
			setInputDefault(false);
			autoGrowInput();
			updateComposeMeta();
			saveDraft();
		}
		function updateComposeMeta() {
			const text = ui.input.value.trim();
			const chars = text.replace(/\s/g, "").length;
			const segments = splitText(text).length;
			let hint = "";
			if (host.selection.record) {
				if (host.selection.segment) {
					const index = host.selection.record.segments.indexOf(host.selection.segment);
					if (index >= 0) hint = ` · 编辑第 ${index + 1} 段`;
				} else hint = " · 整条";
			}
			ui.stats.textContent = `${chars} 字 · ${segments} 段${hint}`;
			ui.clearInput.hidden = inputIsDefault || !ui.input.value;
			syncGoButton();
		}
		function onInputChange() {
			autoGrowInput();
			updateComposeMeta();
			saveDraft();
		}
		ui.input.addEventListener("input", () => {
			host.inputTyping = true;
			setInputDefault(false);
			onInputChange();
		});
		ui.input.addEventListener("focus", () => {
			if (!inputIsDefault) return;
			ui.input.value = "";
			host.inputTyping = false;
			setInputDefault(false);
			autoGrowInput();
			updateComposeMeta();
		});
		ui.input.addEventListener("blur", () => {
			if (host.selection.record) return;
			if (ui.input.value.trim()) return;
			ui.input.value = DEFAULT_INPUT_TEXT;
			setInputDefault(true);
			autoGrowInput();
			updateComposeMeta();
			saveDraft();
		});
		ui.clearInput.addEventListener("click", () => {
			ui.input.value = "";
			host.inputTyping = false;
			setInputDefault(false);
			host.applySelection(null, null);
			onInputChange();
			ui.input.focus();
		});
		ui.rate.addEventListener("change", () => {
			const { rate } = currentTts();
			ui.rate.value = String(rate);
			try {
				localStorage.setItem(RATE_STORE_KEY, String(rate));
			} catch {}
		});
		try {
			const savedVoice = localStorage.getItem(VOICE_STORE_KEY);
			if (savedVoice && [...ui.voice.options].some((option) => option.value === savedVoice)) ui.voice.value = savedVoice;
			const savedRate = Number(localStorage.getItem(RATE_STORE_KEY));
			if (savedRate >= .5 && savedRate <= 2) ui.rate.value = String(savedRate);
		} catch {}
		try {
			const draft = localStorage.getItem(DRAFT_STORE_KEY);
			if (draft && draft.trim()) {
				ui.input.value = draft;
				setInputDefault(false);
			} else {
				ui.input.value = DEFAULT_INPUT_TEXT;
				setInputDefault(true);
			}
		} catch {
			ui.input.value = DEFAULT_INPUT_TEXT;
			setInputDefault(true);
		}
		autoGrowInput();
		updateComposeMeta();
		function submitCompose() {
			const text = ui.input.value.trim();
			if (!text) {
				ui.input.focus();
				return;
			}
			const { voice, rate } = currentTts();
			try {
				localStorage.setItem(VOICE_STORE_KEY, voice);
				localStorage.setItem(RATE_STORE_KEY, String(rate));
			} catch {}
			host.inputTyping = true;
			host.startSession({
				text,
				voice,
				rate,
				format: "pcm16"
			});
			syncGoButton();
		}
		function triggerCompose() {
			if (activeSynthesis()) {
				host.toggleSynthesisPause?.();
				return;
			}
			submitCompose();
		}
		ui.go.addEventListener("click", triggerCompose);
		ui.compose.addEventListener("keydown", (event) => {
			event.stopPropagation();
			if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				submitCompose();
			}
		});
		ui.compose.addEventListener("keyup", (event) => event.stopPropagation());
		return { api: {
			currentTts,
			autoGrowInput,
			setInputDefault,
			saveDraft,
			setInputText,
			updateComposeMeta,
			onInputChange,
			submitCompose,
			activeSynthesis,
			syncGoButton
		} };
	}
	function pcmToWav(pcm, sampleRate) {
		const dataLength = pcm.byteLength;
		const buffer = new ArrayBuffer(44 + dataLength);
		const view = new DataView(buffer);
		const write = (offset, text) => {
			for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
		};
		write(0, "RIFF");
		view.setUint32(4, 36 + dataLength, true);
		write(8, "WAVE");
		write(12, "fmt ");
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, 1, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * 2, true);
		view.setUint16(32, 2, true);
		view.setUint16(34, 16, true);
		write(36, "data");
		view.setUint32(40, dataLength, true);
		new Uint8Array(buffer, 44).set(pcm);
		return new Blob([buffer], { type: "audio/wav" });
	}
	function pcmToSamples(pcm) {
		const count = Math.floor(pcm.byteLength / 2);
		const view = new DataView(pcm.buffer, pcm.byteOffset, count * 2);
		const samples = new Float32Array(count);
		for (let i = 0; i < count; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
		return samples;
	}
	function joinedPcm(chunks, length) {
		const pcm = new Uint8Array(length);
		let offset = 0;
		for (const chunk of chunks) {
			if (offset >= length) break;
			const part = chunk.subarray(0, Math.min(chunk.length, length - offset));
			pcm.set(part, offset);
			offset += part.length;
		}
		return pcm;
	}
	function createRecordView(host) {
		const { ui, records } = host;
		function updateCount() {
			ui.count.textContent = String(records.length);
			ui.clear.hidden = records.length === 0;
			ui.empty.style.display = records.length ? "none" : "";
		}
		function closeMenus(keep) {
			for (const record of records) {
				if (!record.menu || record.menu === keep || record.menu.hidden) continue;
				hideMenu(record);
			}
		}
		function hideMenu(record) {
			record.menu.hidden = true;
			record.row.classList.remove("menuOpen");
		}
		function placeMenu(record) {
			const anchor = record.moreButton.getBoundingClientRect();
			const box = record.menu.getBoundingClientRect();
			const margin = 6;
			let left = anchor.right - box.width;
			let top = anchor.bottom + 3;
			if (top + box.height > window.innerHeight - margin) top = anchor.top - box.height - 3;
			left = Math.max(margin, Math.min(window.innerWidth - box.width - margin, left));
			top = Math.max(margin, Math.min(window.innerHeight - box.height - margin, top));
			record.menu.style.left = `${Math.round(left)}px`;
			record.menu.style.top = `${Math.round(top)}px`;
		}
		function openMenu(record) {
			closeMenus(record.menu);
			record.menu.hidden = false;
			record.row.classList.add("menuOpen");
			placeMenu(record);
		}
		function toggleMenu(record) {
			if (record.menu.hidden) openMenu(record);
			else hideMenu(record);
		}
		function syncRecordRegenButton(record) {
			const button = record.regenAllButton;
			if (!button) return;
			const allowed = record.state === "ready" || record.state === "playing" || record.state === "paused";
			const hasText = record.segments.some((segment) => String(segment.text || "").trim());
			button.disabled = !allowed || record.regenerating || !hasText;
			button.classList.toggle("busy", Boolean(record.regeneratingAll));
			button.title = record.regeneratingAll ? "正在重生成整条" : "重生成整条（逐段复用）";
			button.setAttribute("aria-label", button.title);
		}
		function createSegment(record, text, after) {
			const segment = {
				text,
				chunks: [],
				bytes: 0,
				busy: false,
				complete: false,
				status: "pending",
				mode: "segment",
				record
			};
			const index = after ? record.segments.indexOf(after) + 1 : record.segments.length;
			record.segments.splice(index, 0, segment);
			const box = document.createElement("div");
			box.className = "segBox";
			const row = document.createElement("div");
			row.className = "seg";
			row.dataset.state = "pending";
			const idx = document.createElement("span");
			idx.className = "idx";
			const label = document.createElement("span");
			label.className = "segText";
			const segDuration = document.createElement("span");
			segDuration.className = "segDur";
			segDuration.textContent = "待合成";
			const playButton = document.createElement("button");
			playButton.className = "segPlay";
			playButton.textContent = "▶";
			playButton.setAttribute("aria-label", "从本段开始顺序播放");
			playButton.disabled = true;
			const regenButton = document.createElement("button");
			regenButton.className = "segRegen";
			regenButton.textContent = "↻";
			regenButton.title = "重生成这一段";
			regenButton.setAttribute("aria-label", "重生成这一段");
			regenButton.disabled = true;
			const caret = document.createElement("span");
			caret.className = "segCaret";
			caret.textContent = "›";
			caret.setAttribute("aria-hidden", "true");
			const panel = document.createElement("div");
			panel.className = "segPanel";
			const bar = document.createElement("div");
			bar.className = "segBar";
			bar.setAttribute("role", "progressbar");
			const fill = document.createElement("div");
			fill.className = "fill";
			bar.appendChild(fill);
			const controls = document.createElement("div");
			controls.className = "segControls";
			const timeEl = document.createElement("span");
			timeEl.className = "segTime";
			timeEl.textContent = "0:00 / 0:00";
			const toggleButton = document.createElement("button");
			toggleButton.className = "segAction";
			toggleButton.textContent = "播放";
			const stopButton = document.createElement("button");
			stopButton.className = "segAction";
			stopButton.textContent = "停止";
			stopButton.hidden = true;
			const synthButton = document.createElement("button");
			synthButton.className = "segAction synth";
			synthButton.textContent = "停止合成";
			synthButton.hidden = true;
			const replayButton = document.createElement("button");
			replayButton.className = "segAction";
			replayButton.textContent = "重播";
			const copyButton = document.createElement("button");
			copyButton.className = "segAction";
			copyButton.textContent = "复制";
			const downloadButton = document.createElement("button");
			downloadButton.className = "segAction";
			downloadButton.textContent = "下载";
			downloadButton.disabled = true;
			controls.append(timeEl, toggleButton, stopButton, synthButton, replayButton, copyButton, downloadButton);
			panel.append(bar, controls);
			row.append(idx, label, segDuration, playButton, regenButton, caret);
			box.append(row, panel);
			if (after) record.segList.insertBefore(box, after.box.nextSibling);
			else record.segList.appendChild(box);
			Object.assign(segment, {
				box,
				row,
				idx,
				label,
				durationEl: segDuration,
				playButton,
				regenButton,
				caret,
				panel,
				bar,
				fill,
				timeEl,
				toggleButton,
				stopButton,
				synthButton,
				replayButton,
				copyButton,
				downloadButton
			});
			host.setSegmentLabel(segment, text);
			host.renumberSegments(record);
			row.addEventListener("click", (event) => {
				if (event.target.closest("button")) return;
				host.selectSegment(record, segment);
				if (record.expandedSegment === segment) {
					host.closeSegmentPanel(record, segment);
					return;
				}
				host.openSegmentPanel(record, segment, host.panelModeFor(record, segment));
			});
			playButton.addEventListener("click", () => host.toggleSegmentPlay(record, segment));
			regenButton.addEventListener("click", (event) => {
				event.stopPropagation();
				host.regenerateSegment(record, segment);
			});
			toggleButton.addEventListener("click", () => {
				if (segment.mode === "live") {
					if (record.state === "paused") host.resumeTimeline(record);
					else host.pauseTimeline(record);
					return;
				}
				if (record.chain?.segment === segment) {
					if (segment.audio && !segment.audio.paused) host.pauseChain(record);
					else host.resumeChain(record);
					return;
				}
				host.playChainSegment(record, segment);
			});
			stopButton.addEventListener("click", () => {
				if (segment.mode === "live") {
					if (record.state === "capturing") record.session?.stop();
					else host.stopTimeline(record);
					return;
				}
				if (record.chain) {
					host.stopChain(record);
					return;
				}
				if (segment.audio) {
					segment.audio.pause();
					segment.audio.currentTime = 0;
				}
				host.idleSegmentTime(record, segment);
				host.syncSegmentPlayState(segment);
			});
			synthButton.addEventListener("click", () => record.session?.stop());
			replayButton.addEventListener("click", () => {
				if (!segment.complete || !segment.bytes || segment.busy) return;
				if (record.chain?.segment === segment && segment.audio) {
					segment.audio.currentTime = 0;
					if (segment.audio.paused) host.resumeChain(record);
					return;
				}
				host.playChainSegment(record, segment);
			});
			copyButton.addEventListener("click", () => host.copyText(segment.text, copyButton, "复制"));
			downloadButton.addEventListener("click", () => host.downloadSegment(record, segment));
			bar.addEventListener("click", (event) => {
				if (!segment.complete || !segment.bytes || segment.busy) return;
				if (record.state === "failed") return;
				const rect = bar.getBoundingClientRect();
				const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
				host.seekSegment(record, segment, ratio);
			});
			return segment;
		}
		function setRecordFold(record, folded) {
			record.row.classList.toggle("folded", folded);
			record.head.setAttribute("aria-expanded", String(!folded));
			record.head.title = folded ? "点击展开分段" : "点击收起分段";
		}
		function toggleRecordFold(record) {
			setRecordFold(record, !record.row.classList.contains("folded"));
		}
		function beginRecord(text, tts) {
			const record = {
				text,
				tts,
				time: Date.now(),
				state: "capturing",
				segments: [],
				bytes: 0,
				seconds: 0,
				url: null,
				sampleRate: DEFAULT_SAMPLE_RATE,
				chain: null,
				expandedSegment: null,
				autoSegment: null
			};
			const row = document.createElement("div");
			row.className = "item";
			row.setAttribute("data-live", "");
			const head = document.createElement("div");
			head.className = "itemHead";
			head.setAttribute("aria-expanded", "true");
			head.title = "点击收起分段";
			const caret = document.createElement("span");
			caret.className = "itemCaret";
			caret.textContent = "›";
			caret.setAttribute("aria-hidden", "true");
			const meta = document.createElement("span");
			meta.className = "meta";
			meta.textContent = new Date(record.time).toLocaleTimeString("zh-CN", {
				hour: "2-digit",
				minute: "2-digit"
			});
			const duration = document.createElement("span");
			duration.className = "dur";
			duration.textContent = "捕获中";
			const spacer = document.createElement("span");
			spacer.className = "spacer";
			const segCount = document.createElement("span");
			segCount.className = "segCount";
			segCount.textContent = "0 段";
			const playButton = document.createElement("button");
			playButton.className = "itemPlay";
			playButton.textContent = "▶";
			playButton.title = "播放整条";
			playButton.setAttribute("aria-label", "播放整条");
			playButton.disabled = true;
			const regenAllButton = document.createElement("button");
			regenAllButton.className = "itemRegen";
			regenAllButton.textContent = "↻";
			regenAllButton.title = "重生成整条（逐段复用）";
			regenAllButton.setAttribute("aria-label", "重生成整条");
			regenAllButton.disabled = true;
			const moreButton = document.createElement("button");
			moreButton.className = "more";
			moreButton.textContent = "⋯";
			moreButton.setAttribute("aria-label", "更多操作");
			const menu = document.createElement("div");
			menu.className = "menu";
			menu.hidden = true;
			const menuInfo = document.createElement("div");
			menuInfo.className = "menuInfo";
			menuInfo.textContent = `${VOICE_LABELS.get(tts.voice) || tts.voice || "默认音色"} · ${formatRate(tts.rate)}`;
			const copyButton = document.createElement("button");
			copyButton.textContent = "复制原文";
			const downloadButton = document.createElement("button");
			downloadButton.textContent = "下载 WAV";
			downloadButton.disabled = true;
			const deleteButton = document.createElement("button");
			deleteButton.className = "danger";
			deleteButton.textContent = "删除";
			menu.append(menuInfo, copyButton, downloadButton, deleteButton);
			head.append(caret, meta, duration, spacer, segCount, playButton, regenAllButton, moreButton);
			ui.panel.getRootNode().appendChild(menu);
			const txt = document.createElement("div");
			txt.className = "txt";
			txt.textContent = previewText(text) || "（无文本）";
			txt.title = "点击选中整条文本";
			const segList = document.createElement("div");
			segList.className = "segList";
			row.append(head, txt, segList);
			ui.list.insertBefore(row, ui.list.firstChild);
			Object.assign(record, {
				row,
				head,
				caret,
				txt,
				duration,
				segCount,
				playButton,
				regenAllButton,
				moreButton,
				menu,
				downloadButton,
				segList
			});
			playButton.addEventListener("click", (event) => {
				event.stopPropagation();
				host.toggleRecordPlayback(record);
			});
			regenAllButton.addEventListener("click", (event) => {
				event.stopPropagation();
				host.regenerateRecord(record);
			});
			moreButton.addEventListener("click", (event) => {
				event.stopPropagation();
				toggleMenu(record);
			});
			for (const button of [
				copyButton,
				downloadButton,
				deleteButton
			]) button.addEventListener("click", () => hideMenu(record));
			copyButton.addEventListener("click", () => host.copyText(record.text, copyButton, "复制原文"));
			downloadButton.addEventListener("click", () => downloadRecord(record));
			deleteButton.addEventListener("click", () => removeRecord(record));
			row.addEventListener("click", (event) => {
				if (event.target.closest(".segBox, button")) return;
				host.selectRecord(record);
				if (event.target.closest(".itemHead")) toggleRecordFold(record);
			});
			records.push(record);
			while (records.length > 20) removeRecord(records[0]);
			updateCount();
			return record;
		}
		function removeRecord(record) {
			const index = records.indexOf(record);
			if (index >= 0) records.splice(index, 1);
			if (host.selection.record === record) host.applySelection(null, null);
			host.stopChain(record);
			if (host.activeTimeline === record) host.activeTimeline = null;
			clearTimeout(record.timelineTimer);
			clearInterval(record.timelineTicker);
			record.session?.abort();
			for (const segment of record.segments) {
				if (segment.audio) {
					if (segment.audio === host.activeAudio) host.activeAudio = null;
					segment.audio.pause();
					segment.audio = null;
				}
				if (segment.url) URL.revokeObjectURL(segment.url);
			}
			if (host.activeSession?.record === record) host.activeSession = null;
			if (record.url) URL.revokeObjectURL(record.url);
			record.menu?.remove();
			record.row.remove();
			updateCount();
		}
		function downloadRecord(record) {
			if (!record.url) return;
			const link = document.createElement("a");
			link.href = record.url;
			link.download = `sichang-tts-${new Date(record.time).toISOString().replace(/[:.]/g, "-")}.wav`;
			document.body.appendChild(link);
			link.click();
			link.remove();
		}
		function downloadSegment(record, segment) {
			if (!segment.bytes) return;
			const link = document.createElement("a");
			link.href = host.ensureSegmentUrl(record, segment);
			link.download = `sichang-tts-${new Date(record.time).toISOString().replace(/[:.]/g, "-")}-seg${host.segmentIndex(record, segment) + 1}.wav`;
			document.body.appendChild(link);
			link.click();
			link.remove();
		}
		function rebuildRecord(record) {
			if (record.url) URL.revokeObjectURL(record.url);
			record.url = null;
			const total = record.segments.reduce((sum, segment) => sum + segment.bytes, 0);
			const even = total - total % 2;
			if (!even) {
				host.markFailed(record);
				return;
			}
			const chunks = [];
			for (const segment of record.segments) chunks.push(...segment.chunks);
			const pcm = joinedPcm(chunks, even);
			record.url = URL.createObjectURL(pcmToWav(pcm, record.sampleRate));
			record.bytes = even;
			record.seconds = even / 2 / record.sampleRate;
			record.duration.textContent = formatDuration(record.seconds);
			record.downloadButton.disabled = false;
		}
		const onDocumentPointerDown = (event) => {
			const path = event.composedPath();
			for (const record of records) {
				if (!record.menu || record.menu.hidden) continue;
				if (path.includes(record.menu) || path.includes(record.moreButton)) continue;
				hideMenu(record);
			}
		};
		document.addEventListener("pointerdown", onDocumentPointerDown, true);
		const onWindowScroll = () => closeMenus();
		window.addEventListener("scroll", onWindowScroll, true);
		ui.body.addEventListener("scroll", onWindowScroll, { passive: true });
		ui.clear.addEventListener("click", () => {
			if (!records.length) return;
			if (!window.confirm(`确定清空全部 ${records.length} 条语音记录？此操作不可撤销。`)) return;
			for (const record of [...records]) removeRecord(record);
			host.activeAudio = null;
		});
		updateCount();
		return {
			api: {
				updateCount,
				closeMenus,
				hideMenu,
				placeMenu,
				openMenu,
				toggleMenu,
				syncRecordRegenButton,
				beginRecord,
				createSegment,
				removeRecord,
				downloadRecord,
				downloadSegment,
				rebuildRecord
			},
			dispose: () => {
				document.removeEventListener("pointerdown", onDocumentPointerDown, true);
				window.removeEventListener("scroll", onWindowScroll, true);
				ui.body.removeEventListener("scroll", onWindowScroll);
			}
		};
	}
	function createSegments(host) {
		const { ui } = host;
		function sampleRateOf(record) {
			return record.sampleRate || 24e3;
		}
		function segmentIndex(record, segment) {
			return record.segments.indexOf(segment);
		}
		function syncSegmentRegenButton(record, segment) {
			const button = segment.regenButton;
			if (!button) return;
			const index = segmentIndex(record, segment) + 1;
			button.disabled = !(record.state === "ready" || record.state === "playing" || record.state === "paused" || record.state === "capturing") || record.regenerating || segment.busy || !segment.complete || !segment.bytes;
			if (button.classList.contains("failed")) return;
			button.textContent = "↻";
			button.classList.toggle("busy", Boolean(record.regenerating && segment.busy));
			if (record.regenerating && segment.busy) button.title = `正在重生成第 ${index} 段`;
			else if (host.selection.record === record && host.selection.segment === segment) button.title = `按输入框里的文本重生成第 ${index} 段`;
			else button.title = `重生成第 ${index} 段`;
			button.setAttribute("aria-label", button.title);
		}
		function flashSegmentRegenButton(segment, message) {
			const button = segment.regenButton;
			if (!button) return;
			button.textContent = "!";
			button.title = message;
			button.setAttribute("aria-label", message);
			button.classList.add("failed");
			button.classList.remove("busy");
			clearTimeout(button.flashTimer);
			button.flashTimer = setTimeout(() => {
				button.classList.remove("failed");
				refreshSegmentControls(segment.record);
			}, 1500);
		}
		function segmentSpans(record) {
			const starts = [];
			let total = 0;
			const sampleRate = sampleRateOf(record);
			for (const segment of record.segments) {
				starts.push(total);
				total += segment.bytes / 2 / sampleRate;
			}
			return {
				starts,
				total
			};
		}
		function segmentAt(record, seconds) {
			const { starts } = segmentSpans(record);
			let index = -1;
			for (let i = 0; i < record.segments.length; i++) {
				if (!record.segments[i].bytes) break;
				if (seconds >= starts[i]) index = i;
				else break;
			}
			const segment = record.segments[index];
			if (!segment || !segment.bytes) return null;
			return {
				segment,
				start: starts[index],
				duration: segment.bytes / 2 / sampleRateOf(record)
			};
		}
		function updateSegmentTime(record, segment, current, duration) {
			if (!Number.isFinite(duration) || duration <= 0) {
				segment.timeEl.textContent = "0:00 / 0:00";
				segment.fill.style.width = "0%";
				return;
			}
			const ratio = Math.min(1, Math.max(0, current / duration));
			segment.fill.style.width = `${ratio * 100}%`;
			segment.timeEl.textContent = `${formatSegmentDuration(current)} / ${formatSegmentDuration(duration)}`;
		}
		function idleSegmentTime(record, segment) {
			if (segment.audio && !segment.audio.paused) return;
			updateSegmentTime(record, segment, 0, segment.bytes / 2 / sampleRateOf(record));
		}
		function refreshSegmentControls(record) {
			const playable = record.state !== "failed";
			for (const segment of record.segments) {
				segment.playButton.disabled = !playable || segment.busy || !segment.complete || !segment.bytes;
				syncSegmentRegenButton(record, segment);
				segment.copyButton.disabled = !segment.text;
				segment.downloadButton.disabled = !segment.bytes || segment.busy;
				if (record.expandedSegment === segment) syncSegmentPanel(record, segment);
			}
			record.downloadButton.disabled = Boolean(record.regenerating) || !record.url;
			host.syncRecordPlayButton(record);
			host.syncRecordRegenButton(record);
		}
		function setSegmentLabel(segment, text) {
			segment.text = text;
			segment.label.textContent = previewText(text).slice(0, 24) || "（无文本）";
			segment.label.title = text;
		}
		function refreshRecordText(record) {
			record.text = record.segments.map((segment) => segment.text || "").join("");
			record.txt.textContent = previewText(record.text) || "（无文本）";
			record.txt.title = "点击选中整条文本";
		}
		function setSegmentState(record, segment, state) {
			segment.status = state;
			segment.complete = state === "done";
			segment.row.dataset.state = state;
			const seconds = segment.bytes / 2 / sampleRateOf(record);
			if (state === "pending") segment.durationEl.textContent = "待合成";
			else if (state === "active") segment.durationEl.textContent = `${formatSegmentDuration(seconds)}…`;
			else if (state === "done") segment.durationEl.textContent = formatSegmentDuration(seconds);
			else if (state === "failed") segment.durationEl.textContent = "失败";
			else segment.durationEl.textContent = "未合成";
			idleSegmentTime(record, segment);
			refreshSegmentControls(record);
			if (record.chain?.waitingFor === segment) {
				if (state === "done") host.playChainSegment(record, segment);
				else if (state === "failed" || state === "skipped") host.advanceChain(record, segmentIndex(record, segment));
			}
		}
		function renumberSegments(record) {
			record.segments.forEach((segment, index) => {
				segment.idx.textContent = String(index + 1);
			});
			record.segCount.textContent = `${record.segments.length} 段`;
		}
		function panelModeFor(record, segment) {
			if (record.chain?.segment === segment) return "segment";
			if ((record.state === "playing" || record.state === "paused" || record.state === "capturing") && record.autoSegment === segment) return "live";
			return "local";
		}
		function openSegmentPanel(record, segment, mode) {
			const switching = record.expandedSegment !== segment;
			if (switching && record.expandedSegment) closeSegmentPanel(record, record.expandedSegment);
			record.expandedSegment = segment;
			if (mode) segment.mode = mode;
			segment.box.classList.add("expanded");
			segment.row.dataset.active = "true";
			segment.row.setAttribute("aria-expanded", "true");
			if (segment.mode !== "live" && segment.audio && Number.isFinite(segment.audio.duration) && segment.audio.duration) updateSegmentTime(record, segment, segment.audio.currentTime, segment.audio.duration);
			if (switching) keepSegmentVisible(segment);
			syncSegmentPanel(record, segment);
		}
		function closeSegmentPanel(record, segment) {
			if (!segment) return;
			segment.box.classList.remove("expanded");
			segment.row.removeAttribute("data-active");
			segment.row.setAttribute("aria-expanded", "false");
			updateSegmentTime(record, segment, 0, segment.bytes / 2 / sampleRateOf(record));
			if (record.expandedSegment === segment) record.expandedSegment = null;
		}
		function keepSegmentVisible(segment) {
			if (!segment.box.getClientRects().length) return;
			const body = ui.body;
			const bodyRect = body.getBoundingClientRect();
			const boxRect = segment.box.getBoundingClientRect();
			if (boxRect.top < bodyRect.top) body.scrollTop -= bodyRect.top - boxRect.top;
			else if (boxRect.bottom > bodyRect.bottom) body.scrollTop += boxRect.bottom - bodyRect.bottom;
		}
		function syncSegmentPanel(record, segment) {
			if (record.expandedSegment !== segment) return;
			const live = segment.mode === "live";
			const capturing = live && record.state === "capturing";
			const synthesizing = record.state === "capturing" && Boolean(record.session);
			const paused = record.state === "paused";
			const audio = live ? null : segment.audio;
			const playing = Boolean(audio && !audio.paused);
			const waiting = !live && record.chain?.waitingFor && record.expandedSegment === segment;
			const enabled = segment.complete && segment.bytes && !segment.busy && record.state !== "failed";
			if (live) {
				segment.toggleButton.hidden = capturing;
				segment.toggleButton.disabled = false;
				segment.toggleButton.textContent = paused ? "继续" : "暂停";
				segment.toggleButton.classList.toggle("playing", !capturing && !paused);
				segment.stopButton.hidden = false;
				segment.stopButton.textContent = capturing ? "停止合成" : "停止";
				segment.stopButton.classList.toggle("synth", capturing);
				segment.synthButton.hidden = true;
				segment.replayButton.hidden = true;
			} else if (waiting) {
				segment.toggleButton.hidden = false;
				segment.toggleButton.disabled = true;
				segment.toggleButton.textContent = "等待下一段";
				segment.toggleButton.classList.remove("playing");
				segment.stopButton.hidden = false;
				segment.stopButton.textContent = "停止";
				segment.stopButton.classList.remove("synth");
				segment.synthButton.hidden = !synthesizing;
				segment.replayButton.hidden = false;
				segment.replayButton.disabled = !enabled;
			} else {
				segment.toggleButton.hidden = false;
				segment.toggleButton.disabled = !enabled;
				segment.toggleButton.textContent = playing ? "暂停" : audio ? "继续" : "播放";
				segment.toggleButton.classList.toggle("playing", playing);
				segment.stopButton.hidden = !audio;
				segment.stopButton.textContent = "停止";
				segment.stopButton.classList.remove("synth");
				segment.synthButton.hidden = !synthesizing;
				segment.replayButton.hidden = false;
				segment.replayButton.disabled = !enabled;
			}
			segment.copyButton.disabled = !segment.text;
			segment.downloadButton.disabled = !segment.bytes || segment.busy;
		}
		function syncSegmentPlayState(segment) {
			const playing = Boolean(segment.audio && !segment.audio.paused);
			segment.playButton.textContent = playing ? "⏸" : "▶";
			segment.playButton.setAttribute("aria-label", playing ? "暂停顺序播放" : "从本段开始顺序播放");
			segment.playButton.classList.toggle("playing", playing);
			if (segment.record?.expandedSegment === segment) syncSegmentPanel(segment.record, segment);
		}
		return { api: {
			sampleRateOf,
			segmentIndex,
			syncSegmentRegenButton,
			flashSegmentRegenButton,
			segmentSpans,
			segmentAt,
			updateSegmentTime,
			idleSegmentTime,
			refreshSegmentControls,
			setSegmentLabel,
			refreshRecordText,
			setSegmentState,
			renumberSegments,
			panelModeFor,
			openSegmentPanel,
			closeSegmentPanel,
			keepSegmentVisible,
			syncSegmentPanel,
			syncSegmentPlayState
		} };
	}
	function createChain(host) {
		const { records } = host;
		function stopActive() {
			if (host.activeAudio && !host.activeAudio.paused) host.activeAudio.pause();
		}
		function recordIsPlaying(record) {
			const current = record.chain?.segment;
			if (current?.audio && !current.audio.paused) return true;
			if (record.chain?.waitingFor) return false;
			if (record.state === "playing") return true;
			if (record.state === "capturing") return Boolean(record.session && !record.session.paused);
			return false;
		}
		function syncRecordPlayButton(record) {
			const button = record?.playButton;
			if (!button) return;
			const waiting = Boolean(record.chain?.waitingFor);
			const playing = recordIsPlaying(record);
			const liveReady = record.state === "playing" || record.state === "paused" || record.state === "capturing" && Boolean(record.session);
			const chainReady = Boolean(record.chain);
			const segmentReady = record.segments.some((segment) => segment.complete && segment.bytes && !segment.busy);
			button.disabled = record.state === "failed" || waiting || !liveReady && !chainReady && !segmentReady;
			if (waiting) {
				button.textContent = "▶";
				button.classList.remove("playing");
				button.title = "等待下一段";
				button.setAttribute("aria-label", "等待下一段");
				button.setAttribute("aria-pressed", "false");
				return;
			}
			button.textContent = playing ? "⏸" : "▶";
			button.classList.toggle("playing", playing);
			button.title = playing ? "暂停整条" : "播放整条";
			button.setAttribute("aria-label", button.title);
			button.setAttribute("aria-pressed", playing ? "true" : "false");
		}
		function toggleRecordPlayback(record) {
			if (record.state === "failed") return;
			if (record.chain) {
				const current = record.chain.segment;
				if (current?.audio && !current.audio.paused) {
					pauseChain(record);
					return;
				}
				if (current?.audio) {
					resumeChain(record);
					return;
				}
				return;
			}
			if (record.state === "playing") {
				host.pauseTimeline(record);
				return;
			}
			if (record.state === "paused") {
				host.resumeTimeline(record);
				return;
			}
			if (record.state === "capturing") {
				const session = record.session;
				if (!session) return;
				if (session.paused) host.resumeLiveCapture(record);
				else host.pauseLiveCapture(record);
				return;
			}
			const first = record.segments.find((segment) => segment.complete && segment.bytes && !segment.busy);
			if (first) playChainSegment(record, first);
		}
		function ensureSegmentUrl(record, segment) {
			if (!segment.url) {
				const even = segment.bytes - segment.bytes % 2;
				segment.url = URL.createObjectURL(pcmToWav(joinedPcm(segment.chunks, even), host.sampleRateOf(record)));
			}
			return segment.url;
		}
		function clearSegmentAudio(segment) {
			if (segment.audio) {
				if (segment.audio === host.activeAudio) host.activeAudio = null;
				segment.audio.pause();
				segment.audio = null;
			}
			if (segment.url) {
				URL.revokeObjectURL(segment.url);
				segment.url = null;
			}
			host.idleSegmentTime(segment.record, segment);
			host.syncSegmentPlayState(segment);
		}
		function ensureSegmentAudio(record, segment) {
			if (!segment.audio) {
				const audio = new Audio(ensureSegmentUrl(record, segment));
				audio.addEventListener("pause", () => host.syncSegmentPlayState(segment));
				audio.addEventListener("play", () => syncRecordPlayButton(record));
				audio.addEventListener("ended", () => {
					audio.currentTime = 0;
					host.idleSegmentTime(record, segment);
					host.syncSegmentPlayState(segment);
					if (record.chain?.segment === segment) advanceChain(record, host.segmentIndex(record, segment));
				});
				audio.addEventListener("timeupdate", () => {
					if (!Number.isFinite(audio.duration) || !audio.duration) return;
					host.updateSegmentTime(record, segment, audio.currentTime, audio.duration);
					if (record.expandedSegment === segment) host.syncSegmentPanel(record, segment);
				});
				segment.audio = audio;
			}
			return segment.audio;
		}
		function toggleSegmentPlay(record, segment) {
			if (!segment.complete || !segment.bytes || segment.busy) return;
			if (record.state === "failed") return;
			if (segment.audio && !segment.audio.paused) {
				segment.audio.pause();
				return;
			}
			playChainSegment(record, segment);
		}
		function prepareRecordPlayback(record) {
			if (record.state === "playing" || record.state === "paused") host.stopTimeline(record);
			else if (record.state === "capturing") host.pauseLiveCapture(record);
			if (host.activeTimeline && host.activeTimeline !== record) host.stopTimeline(host.activeTimeline);
			stopActive();
			stopOtherChains(record);
		}
		function playChainSegment(record, segment) {
			if (!segment || !segment.complete || !segment.bytes || segment.busy) return;
			if (!record.chain) prepareRecordPlayback(record);
			const previous = record.chain?.segment;
			if (previous && previous !== segment && previous.audio) {
				previous.audio.pause();
				previous.audio.currentTime = 0;
				host.idleSegmentTime(record, previous);
				host.syncSegmentPlayState(previous);
			}
			stopActive();
			const audio = ensureSegmentAudio(record, segment);
			record.chain = { segment };
			record.autoSegment = segment;
			host.activeAudio = audio;
			host.openSegmentPanel(record, segment, "segment");
			host.mirrorPlayingText(record, segment);
			syncRecordPlayButton(record);
			audio.play().then(() => {
				host.syncSegmentPlayState(segment);
				syncRecordPlayButton(record);
			}, () => {
				host.syncSegmentPlayState(segment);
				syncRecordPlayButton(record);
			});
		}
		function advanceChain(record, fromIndex) {
			if (!record.chain) return;
			for (let i = fromIndex + 1; i < record.segments.length; i++) {
				const next = record.segments[i];
				if (next.complete && next.bytes && !next.busy) {
					playChainSegment(record, next);
					return;
				}
				if (!next.complete) {
					if (record.state === "capturing" && next.status !== "failed" && next.status !== "skipped") {
						record.chain = { waitingFor: next };
						const previous = record.segments[fromIndex];
						if (previous) host.syncSegmentPanel(record, previous);
						syncRecordPlayButton(record);
						return;
					}
					continue;
				}
			}
			stopChain(record);
		}
		function pauseChain(record) {
			const segment = record.chain?.segment;
			if (!segment?.audio || segment.audio.paused) return;
			segment.audio.pause();
			syncRecordPlayButton(record);
		}
		function resumeChain(record) {
			const segment = record.chain?.segment;
			if (!segment?.audio) return;
			stopActive();
			host.activeAudio = segment.audio;
			host.openSegmentPanel(record, segment, "segment");
			host.mirrorPlayingText(record, segment);
			syncRecordPlayButton(record);
			segment.audio.play().then(() => {
				host.syncSegmentPlayState(segment);
				syncRecordPlayButton(record);
			}, () => {
				host.syncSegmentPlayState(segment);
				syncRecordPlayButton(record);
			});
		}
		function stopChain(record) {
			if (!record.chain) return;
			const current = record.chain.segment || null;
			if (current?.audio) {
				if (current.audio === host.activeAudio) host.activeAudio = null;
				current.audio.pause();
				current.audio.currentTime = 0;
				host.idleSegmentTime(record, current);
				host.syncSegmentPlayState(current);
			}
			record.chain = null;
			record.autoSegment = null;
			if (record.expandedSegment?.mode !== "live") {
				const expanded = record.expandedSegment;
				if (expanded) host.closeSegmentPanel(record, expanded);
			}
			syncRecordPlayButton(record);
		}
		function stopOtherChains(keep) {
			for (const record of records) if (record !== keep && record.chain) stopChain(record);
		}
		function seekSegment(record, segment, ratio) {
			const duration = segment.bytes / 2 / host.sampleRateOf(record);
			if (segment.mode === "live") {
				const { starts } = host.segmentSpans(record);
				host.seekTimeline(record, starts[host.segmentIndex(record, segment)] + ratio * duration);
				return;
			}
			const audio = ensureSegmentAudio(record, segment);
			const seek = () => {
				if (!Number.isFinite(audio.duration) || !audio.duration) return;
				audio.currentTime = ratio * audio.duration;
				host.updateSegmentTime(record, segment, audio.currentTime, audio.duration);
			};
			if (audio.readyState >= 1) seek();
			else audio.addEventListener("loadedmetadata", seek, { once: true });
		}
		return { api: {
			stopActive,
			recordIsPlaying,
			syncRecordPlayButton,
			toggleRecordPlayback,
			ensureSegmentUrl,
			clearSegmentAudio,
			ensureSegmentAudio,
			toggleSegmentPlay,
			prepareRecordPlayback,
			playChainSegment,
			advanceChain,
			pauseChain,
			resumeChain,
			stopChain,
			stopOtherChains,
			seekSegment
		} };
	}
	function createTimeline(host) {
		function ensureAudioContext() {
			if (!host.audioContext || host.audioContext.state === "closed") host.audioContext = new (window.AudioContext || window.webkitAudioContext)();
			if (host.audioContext.state === "suspended") host.audioContext.resume().catch(() => {});
			return host.audioContext;
		}
		function stopTimeline(record) {
			if (!record || record.state !== "playing" && record.state !== "paused") return;
			clearTimeout(record.timelineTimer);
			clearInterval(record.timelineTicker);
			record.timelineTimer = null;
			record.timelineTicker = null;
			if (record.session) record.session.paused = false;
			record.session?.abort();
			if (host.activeSession && host.activeSession.record === record) host.activeSession = null;
			record.session = null;
			if (host.activeTimeline === record) host.activeTimeline = null;
			record.state = "ready";
			record.duration.textContent = formatDuration(record.seconds);
			record.autoSegment = null;
			if (record.expandedSegment?.mode === "live") host.closeSegmentPanel(record, record.expandedSegment);
			host.refreshSegmentControls(record);
		}
		function livePosition(session) {
			if (session.paused) return session.pausedOffset || 0;
			if (session.timelineStart === null) return session.startOffset || 0;
			const elapsed = Math.max(0, session.context.currentTime - session.timelineStart);
			const position = session.startOffset + elapsed;
			return Math.min(session.receivedSeconds, Math.max(0, position));
		}
		function showLiveSegment(record, session, position) {
			const info = host.segmentAt(record, position);
			if (!info || !info.segment.bytes) return;
			const { segment, start, duration } = info;
			if (record.autoSegment !== segment) {
				record.autoSegment = segment;
				host.openSegmentPanel(record, segment, "live");
				host.mirrorPlayingText(record, segment);
			} else if (record.expandedSegment === segment && segment.mode === "live") {
				host.updateSegmentTime(record, segment, position - start, duration);
				host.syncSegmentPanel(record, segment);
			}
		}
		function startTimelineTicker(record, session) {
			clearInterval(record.timelineTicker);
			const tick = () => {
				if (record.state !== "playing" && record.state !== "capturing") return;
				if (session.paused) return;
				showLiveSegment(record, session, livePosition(session));
			};
			tick();
			record.timelineTicker = setInterval(tick, 250);
		}
		function armTimelineEnd(record) {
			const session = record.session;
			clearTimeout(record.timelineTimer);
			record.timelineTimer = null;
			if (!session || record.state !== "playing") return;
			const remaining = Math.max(0, session.receivedSeconds - livePosition(session));
			record.timelineTimer = setTimeout(() => stopTimeline(record), remaining * 1e3 + 120);
		}
		function pcmFromBytes(record, startByte) {
			const from = Math.min(Math.max(0, startByte), record.bytes);
			const out = new Uint8Array(record.bytes - from);
			let written = 0;
			let cursor = 0;
			for (const segment of record.segments) for (const chunk of segment.chunks) {
				const end = cursor + chunk.length;
				if (end > from) {
					const begin = Math.max(0, from - cursor);
					out.set(chunk.subarray(begin), written);
					written += chunk.length - begin;
				}
				cursor = end;
			}
			return out.subarray(0, written);
		}
		function rescheduleTimeline(record, offset) {
			const session = record.session;
			if (!session) return;
			const context = ensureAudioContext();
			session.context = context;
			stopSources(session);
			session.pending = [];
			session.pendingBytes = 0;
			const sampleRate = session.sampleRate || record.sampleRate;
			const pcm = pcmFromBytes(record, Math.round(offset * sampleRate) * 2);
			const count = Math.floor(pcm.byteLength / 2);
			if (!count) {
				session.started = false;
				session.timelineStart = null;
				session.playhead = 0;
				session.startOffset = offset;
				return;
			}
			const buffer = context.createBuffer(1, count, sampleRate);
			buffer.copyToChannel(pcmToSamples(pcm), 0);
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.connect(context.destination);
			const startAt = context.currentTime + .06;
			source.start(startAt);
			source.onended = () => {
				const index = session.sources.indexOf(source);
				if (index >= 0) session.sources.splice(index, 1);
			};
			session.sources.push(source);
			session.started = true;
			session.timelineStart = startAt;
			session.startOffset = offset;
			session.playhead = startAt + buffer.duration;
		}
		function pauseTimeline(record) {
			const session = record.session;
			if (!session || record.state !== "playing") return;
			const position = livePosition(session);
			session.paused = true;
			session.pausedOffset = position;
			stopSources(session);
			clearInterval(record.timelineTicker);
			clearTimeout(record.timelineTimer);
			record.timelineTicker = null;
			record.timelineTimer = null;
			record.state = "paused";
			if (record.expandedSegment?.mode === "live") host.syncSegmentPanel(record, record.expandedSegment);
			host.syncRecordPlayButton(record);
		}
		function resumeTimeline(record) {
			const session = record.session;
			if (!session || record.state !== "paused") return;
			host.stopActive();
			session.paused = false;
			const offset = Math.min(session.pausedOffset || 0, session.receivedSeconds);
			session.pausedOffset = offset;
			rescheduleTimeline(record, offset);
			record.state = "playing";
			record.autoSegment = null;
			startTimelineTicker(record, session);
			armTimelineEnd(record);
			host.syncRecordPlayButton(record);
		}
		function pauseLiveCapture(record) {
			const session = record.session;
			if (!session || session.stopped || session.paused) return;
			session.pausedOffset = livePosition(session);
			session.paused = true;
			stopSources(session);
			clearInterval(record.timelineTicker);
			record.timelineTicker = null;
			host.syncRecordPlayButton(record);
		}
		function resumeLiveCapture(record) {
			const session = record.session;
			if (!session || session.stopped || !session.paused || record.state !== "capturing") return;
			session.paused = false;
			const offset = Math.min(session.pausedOffset || 0, session.receivedSeconds);
			session.pausedOffset = offset;
			record.autoSegment = null;
			rescheduleTimeline(record, offset);
			startTimelineTicker(record, session);
			host.syncRecordPlayButton(record);
		}
		function seekTimeline(record, seconds) {
			const session = record.session;
			if (!session) return;
			const position = Math.min(Math.max(0, seconds), session.receivedSeconds);
			session.pausedOffset = position;
			if (!session.paused) {
				rescheduleTimeline(record, position);
				armTimelineEnd(record);
			}
			showLiveSegment(record, session, position);
		}
		function startSource(session, bytes, audioStart) {
			const count = Math.floor(bytes.byteLength / 2);
			if (!count) return;
			const context = ensureAudioContext();
			session.context = context;
			const buffer = context.createBuffer(1, count, session.sampleRate);
			buffer.copyToChannel(pcmToSamples(bytes), 0);
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.connect(context.destination);
			const startAt = Math.max(session.playhead, context.currentTime + .06);
			if (session.timelineStart === null || startAt > session.playhead + .005) {
				session.timelineStart = startAt;
				session.startOffset = audioStart;
			}
			source.start(startAt);
			session.playhead = startAt + buffer.duration;
			source.onended = () => {
				const index = session.sources.indexOf(source);
				if (index >= 0) session.sources.splice(index, 1);
			};
			session.sources.push(source);
		}
		function flushPending(session) {
			if (session.stopped || session.paused || session.started || !session.pendingBytes) return;
			const merged = new Uint8Array(session.pendingBytes);
			let offset = 0;
			for (const part of session.pending) {
				merged.set(part, offset);
				offset += part.length;
			}
			session.pending = [];
			session.pendingBytes = 0;
			session.started = true;
			startSource(session, merged, session.startOffset || 0);
		}
		function schedulePcm(session, bytes, audioStart) {
			if (session.paused) return;
			if (!session.started) {
				session.pending.push(bytes);
				session.pendingBytes += bytes.length;
				if (session.pendingBytes < session.sampleRate * 2 * .5) return;
				flushPending(session);
				return;
			}
			startSource(session, bytes, audioStart);
		}
		function stopSources(session) {
			for (const source of session.sources) try {
				source.stop();
			} catch {}
			session.sources.length = 0;
		}
		return { api: {
			ensureAudioContext,
			stopTimeline,
			livePosition,
			showLiveSegment,
			startTimelineTicker,
			armTimelineEnd,
			pcmFromBytes,
			rescheduleTimeline,
			pauseTimeline,
			resumeTimeline,
			pauseLiveCapture,
			resumeLiveCapture,
			seekTimeline,
			startSource,
			flushPending,
			schedulePcm,
			stopSources
		} };
	}
	function createSynthesis(host) {
		const { records, ui } = host;
		function waitWhilePaused(session) {
			if (!session.synthesisPaused || session.stopped) return Promise.resolve();
			return new Promise((resolve) => session.holdResolvers.push(resolve));
		}
		function releaseHold(session) {
			const waiters = session.holdResolvers.splice(0);
			for (const resolve of waiters) resolve();
		}
		function setSynthesisPaused(session, paused) {
			if (!session || session.stopped || session.synthesisPaused === paused) return;
			session.synthesisPaused = paused;
			const record = session.record;
			if (paused) {
				const chainSegment = record.chain?.segment;
				if (chainSegment?.audio && !chainSegment.audio.paused) {
					session.resumeChainOnUnpause = true;
					host.pauseChain(record);
				} else if (!session.paused) {
					session.resumeTimelineOnUnpause = true;
					host.pauseLiveCapture(record);
				}
			} else {
				releaseHold(session);
				if (session.resumeChainOnUnpause) {
					session.resumeChainOnUnpause = false;
					if ((record.chain?.segment)?.audio?.paused) host.resumeChain(record);
				}
				if (session.resumeTimelineOnUnpause) {
					session.resumeTimelineOnUnpause = false;
					if (!record.chain && session.paused && record.state === "capturing") host.resumeLiveCapture(record);
				}
			}
			host.syncGoButton?.();
		}
		function toggleSynthesisPause() {
			const session = host.activeSession;
			if (!session || session.stopped || session.record?.state !== "capturing") return;
			setSynthesisPaused(session, !session.synthesisPaused);
		}
		function updateProgress(record, done, total) {
			if (!records.includes(record)) return;
			record.duration.textContent = total > 1 ? `${done}/${total}` : "合成中";
		}
		function markFailed(record) {
			if (!records.includes(record)) return;
			clearInterval(record.timelineTicker);
			record.timelineTicker = null;
			host.stopChain(record);
			record.state = "failed";
			record.session = null;
			record.row.removeAttribute("data-live");
			record.duration.textContent = "失败";
			record.downloadButton.disabled = true;
			if (record.expandedSegment) host.closeSegmentPanel(record, record.expandedSegment);
			record.autoSegment = null;
			for (const segment of record.segments) if (segment.status === "pending" || segment.status === "active") host.setSegmentState(record, segment, segment.bytes ? "done" : "skipped");
			host.refreshSegmentControls(record);
			host.syncGoButton?.();
		}
		function finalizeRecord(record) {
			if (!records.includes(record) || record.state !== "capturing") return;
			clearInterval(record.timelineTicker);
			record.timelineTicker = null;
			const evenLength = record.bytes - record.bytes % 2;
			const session = record.session;
			record.session = null;
			if (!evenLength) {
				markFailed(record);
				return;
			}
			const chunks = [];
			for (const segment of record.segments) chunks.push(...segment.chunks);
			const pcm = joinedPcm(chunks, evenLength);
			record.url = URL.createObjectURL(pcmToWav(pcm, record.sampleRate));
			record.seconds = evenLength / 2 / record.sampleRate;
			record.state = "ready";
			record.row.removeAttribute("data-live");
			record.duration.textContent = formatDuration(record.seconds);
			record.downloadButton.disabled = false;
			for (const segment of record.segments) if (segment.status === "pending" || segment.status === "active") host.setSegmentState(record, segment, segment.bytes ? "done" : "skipped");
			host.refreshSegmentControls(record);
			if (session && !session.stopped && session.paused === false && session.sources.length && session.playhead > session.context.currentTime + .05) {
				if (host.activeTimeline && host.activeTimeline !== record) host.stopTimeline(host.activeTimeline);
				record.state = "playing";
				record.session = session;
				host.activeTimeline = record;
				host.startTimelineTicker(record, session);
				host.armTimelineEnd(record);
			} else {
				if (record.expandedSegment?.mode === "live") host.closeSegmentPanel(record, record.expandedSegment);
				record.autoSegment = null;
			}
			host.syncRecordPlayButton(record);
			host.syncGoButton?.();
		}
		function startSession({ text, voice, rate, format }) {
			host.stopTimeline(host.activeTimeline);
			host.activeSession?.stop();
			host.stopActive();
			host.stopOtherChains(null);
			const tasks = splitText(text).map((segmentText) => ({ text: segmentText }));
			if (!tasks.length) return null;
			const record = host.beginRecord(text, {
				voice,
				rate,
				format
			});
			host.applySelection(null, null);
			for (const task of tasks) task.segment = host.createSegment(record, task.text);
			host.refreshSegmentControls(record);
			host.ensureAudioContext();
			const session = {
				record,
				stopped: false,
				playhead: 0,
				started: false,
				pending: [],
				pendingBytes: 0,
				timelineStart: null,
				startOffset: 0,
				receivedSeconds: 0,
				paused: false,
				pausedOffset: 0,
				synthesisPaused: false,
				holdResolvers: [],
				resumeTimelineOnUnpause: false,
				resumeChainOnUnpause: false,
				context: null,
				sources: [],
				sampleRate: DEFAULT_SAMPLE_RATE,
				controller: new AbortController(),
				total: tasks.length,
				done: 0
			};
			record.session = session;
			host.activeSession = session;
			host.syncGoButton?.();
			updateProgress(record, 0, session.total);
			host.startTimelineTicker(record, session);
			host.syncRecordPlayButton(record);
			const requestSegment = (segmentText) => window.fetch(TTS_PATH, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					[SEGMENT_HEADER]: "1"
				},
				body: JSON.stringify({
					text: segmentText,
					voice,
					rate,
					format
				}),
				signal: session.controller.signal
			}).then((response) => {
				if (!response.ok) throw new Error(`tts ${response.status}`);
				const sampleRate = Number(response.headers.get("X-Sample-Rate")) || 24e3;
				session.sampleRate = sampleRate;
				record.sampleRate = sampleRate;
				return response;
			});
			let prefetch = null;
			const startPrefetch = (piece) => {
				if (prefetch || session.synthesisPaused || session.stopped) return;
				const promise = requestSegment(piece.text);
				promise.catch(() => {});
				prefetch = {
					piece,
					promise
				};
			};
			const takePrefetch = (piece) => {
				if (prefetch && prefetch.piece === piece) {
					const { promise } = prefetch;
					prefetch = null;
					return promise;
				}
				return requestSegment(piece.text);
			};
			const consume = async (response, piece) => {
				const reader = response.body.getReader();
				const segment = piece.segment;
				let leftover = new Uint8Array(0);
				host.setSegmentState(record, segment, "active");
				try {
					for (;;) {
						await waitWhilePaused(session);
						if (session.stopped) break;
						const { done, value } = await reader.read();
						if (done) break;
						await waitWhilePaused(session);
						if (session.stopped) break;
						if (!value || !value.length) continue;
						if (record.bytes + value.length > 67108864) continue;
						let data = value;
						if (leftover.length) {
							data = new Uint8Array(leftover.length + value.length);
							data.set(leftover);
							data.set(value, leftover.length);
						}
						const evenLength = data.length - data.length % 2;
						if (evenLength) {
							const part = data.subarray(0, evenLength);
							segment.chunks.push(part);
							segment.bytes += evenLength;
							record.bytes += evenLength;
							host.schedulePcm(session, part, session.receivedSeconds);
							session.receivedSeconds += evenLength / 2 / session.sampleRate;
							segment.durationEl.textContent = `${formatSegmentDuration(segment.bytes / 2 / session.sampleRate)}…`;
						}
						leftover = data.subarray(evenLength);
					}
				} finally {
					if (segment.bytes) host.setSegmentState(record, segment, "done");
					else host.setSegmentState(record, segment, "pending");
				}
				host.flushPending(session);
			};
			const speak = async (piece) => {
				const segment = piece.segment;
				const bytesBefore = segment.bytes;
				for (let attempt = 0; attempt < 2; attempt++) try {
					await waitWhilePaused(session);
					if (session.stopped) return "done";
					const response = await takePrefetch(piece);
					await waitWhilePaused(session);
					if (session.stopped) return "done";
					if (tasks.length) startPrefetch(tasks[0]);
					await consume(response, piece);
					return "done";
				} catch (error) {
					if (session.stopped || session.controller.signal.aborted) return "done";
					if (segment.bytes > bytesBefore) return "done";
				}
				if (segment.bytes > bytesBefore) return "done";
				const halves = splitInHalf(piece.text);
				if (!halves) {
					host.setSegmentState(record, segment, "failed");
					return "failed";
				}
				host.setSegmentLabel(segment, halves[0]);
				host.setSegmentState(record, segment, "pending");
				const second = host.createSegment(record, halves[1], segment);
				tasks.unshift({
					text: halves[0],
					segment
				}, {
					text: halves[1],
					segment: second
				});
				session.total += halves.length - 1;
				updateProgress(record, session.done, session.total);
				return "split";
			};
			(async () => {
				startPrefetch(tasks[0]);
				while (tasks.length && !session.stopped) {
					await waitWhilePaused(session);
					if (session.stopped) break;
					const piece = tasks.shift();
					const result = await speak(piece);
					if (session.stopped) break;
					if (result !== "split") session.done += 1;
					updateProgress(record, session.done, session.total);
				}
				if (session.stopped) return;
				finalizeRecord(record);
			})().catch(() => {
				if (!session.stopped) finalizeRecord(record);
			});
			session.stop = () => {
				if (session.stopped) return;
				session.stopped = true;
				releaseHold(session);
				try {
					session.controller.abort();
				} catch {}
				host.stopSources(session);
				if (host.activeSession === session) host.activeSession = null;
				if (record.state === "playing" || record.state === "paused") {
					host.stopTimeline(record);
					host.syncGoButton?.();
					return;
				}
				finalizeRecord(record);
			};
			session.abort = () => {
				session.stopped = true;
				releaseHold(session);
				try {
					session.controller.abort();
				} catch {}
				host.stopSources(session);
				if (host.activeSession === session) host.activeSession = null;
				host.syncGoButton?.();
			};
			return session;
		}
		function parseRequest(init) {
			if (!init || typeof init.body !== "string") return null;
			try {
				const data = JSON.parse(init.body);
				return {
					text: data.text || "",
					voice: data.voice,
					rate: data.rate,
					format: data.format || "pcm16"
				};
			} catch {
				return null;
			}
		}
		function isSegmentRequest(init) {
			const headers = init && init.headers;
			if (!headers) return false;
			if (typeof headers.get === "function") return headers.get(SEGMENT_HEADER) === "1";
			return headers[SEGMENT_HEADER] === "1";
		}
		function silentResponse() {
			const stream = new ReadableStream({ start(controller) {
				controller.enqueue(new Uint8Array(2));
				controller.close();
			} });
			return new Response(stream, {
				status: 200,
				headers: {
					"Content-Type": "audio/pcm",
					"X-Sample-Rate": String(DEFAULT_SAMPLE_RATE)
				}
			});
		}
		const originalFetch = window.fetch;
		window.fetch = function(input, init) {
			if (!(typeof input === "string" ? input : input?.url || "").includes("/api/tts") || isSegmentRequest(init)) return originalFetch.apply(this, arguments);
			const request = parseRequest(init);
			if (request && request.text) startSession({
				...request,
				voice: ui.voice.value || "mimo_default"
			});
			return Promise.resolve(silentResponse());
		};
		return {
			api: {
				startSession,
				updateProgress,
				markFailed,
				finalizeRecord,
				toggleSynthesisPause
			},
			dispose: () => {
				window.fetch = originalFetch;
			}
		};
	}
	async function requestSegmentAudio({ text, voice, rate, format }) {
		const response = await window.fetch(TTS_PATH, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				[SEGMENT_HEADER]: "1"
			},
			body: JSON.stringify({
				text,
				voice,
				rate,
				format
			})
		});
		if (!response.ok) throw new Error(`tts ${response.status}`);
		const sampleRate = Number(response.headers.get("X-Sample-Rate")) || 24e3;
		const reader = response.body.getReader();
		const chunks = [];
		let bytes = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value || !value.length) continue;
			chunks.push(value);
			bytes += value.length;
		}
		if (!bytes) throw new Error("empty");
		if (bytes % 2) {
			const last = chunks[chunks.length - 1];
			chunks[chunks.length - 1] = last.subarray(0, last.length - 1);
			bytes -= 1;
		}
		return {
			chunks,
			bytes,
			sampleRate
		};
	}
	function createRegenerator(host) {
		const { records, selection, input, sampleRateOf, segmentIndex, segmentSpans, livePosition, rescheduleTimeline, clearSegmentAudio, setSegmentState, setSegmentLabel, refreshRecordText, rebuildRecord, refreshSegmentControls, stopTimeline, stopChain, openSegmentPanel, playChainSegment, flashSegmentRegenButton, currentTts } = host;
		async function regenerateSegment(record, segment, options = {}) {
			const { text: textOverride, autoPlay = true, keepLock = false, allowEmpty = false, deferRebuild = false } = options;
			if (!segment || !records.includes(record) || segment.busy) return false;
			if (!keepLock && record.regenerating) return false;
			if (!allowEmpty && (!segment.complete || !segment.bytes)) return false;
			const editing = selection.record === record && selection.segment === segment;
			const text = String(textOverride ?? (editing ? input.value : segment.text) ?? "").trim();
			if (!text) {
				flashSegmentRegenButton(segment, "文本为空");
				return false;
			}
			if (!keepLock) {
				if (record.state === "playing" || record.state === "paused") stopTimeline(record);
				if (record.state !== "ready" && record.state !== "capturing") return false;
			}
			if (record.chain && (record.chain.segment === segment || record.chain.waitingFor === segment)) {
				stopChain(record);
				openSegmentPanel(record, segment, "segment");
			}
			segment.busy = true;
			if (!keepLock) record.regenerating = true;
			refreshSegmentControls(record);
			let failed = false;
			let ok = false;
			try {
				const { chunks, bytes, sampleRate } = await requestSegmentAudio({
					text,
					voice: currentTts?.().voice || record.tts.voice,
					rate: record.tts.rate,
					format: record.tts.format
				});
				if (sampleRate !== record.sampleRate) throw new Error("sample rate mismatch");
				if (!records.includes(record)) return false;
				const sampleRateNow = sampleRateOf(record);
				const session = record.state === "capturing" && Boolean(record.session) ? record.session : null;
				const targetIndex = segmentIndex(record, segment);
				const targetStart = segmentSpans(record).starts[targetIndex];
				const oldDuration = segment.bytes / 2 / sampleRateNow;
				const deltaDuration = (bytes - segment.bytes) / 2 / sampleRateNow;
				const position = session ? livePosition(session) : 0;
				clearSegmentAudio(segment);
				segment.chunks = chunks;
				segment.bytes = bytes;
				if (text !== segment.text) {
					setSegmentLabel(segment, text);
					refreshRecordText(record);
				}
				setSegmentState(record, segment, "done");
				if (session) {
					record.bytes = record.segments.reduce((sum, part) => sum + part.bytes, 0);
					session.receivedSeconds = record.bytes / 2 / sampleRateNow;
					let next = position;
					if (targetStart + oldDuration <= position) next += deltaDuration;
					else if (position > targetStart) next = targetStart;
					next = Math.min(Math.max(0, next), session.receivedSeconds);
					session.pausedOffset = next;
					if (!session.paused) rescheduleTimeline(record, next);
				} else if (record.state === "capturing") {
					record.bytes = record.segments.reduce((sum, part) => sum + part.bytes, 0);
					record.seconds = record.bytes / 2 / sampleRateNow;
				} else if (!deferRebuild) rebuildRecord(record);
				ok = true;
			} catch (error) {
				failed = true;
			} finally {
				segment.busy = false;
				if (!keepLock) record.regenerating = false;
				refreshSegmentControls(record);
				if (failed) flashSegmentRegenButton(segment, "失败");
				else if (autoPlay && ok && records.includes(record) && record.state !== "failed") playChainSegment(record, segment);
			}
			return ok;
		}
		async function regenerateRecord(record) {
			if (!record || !records.includes(record) || record.regenerating) return;
			if (record.state !== "ready" && record.state !== "playing" && record.state !== "paused") return;
			if (record.state === "playing" || record.state === "paused") stopTimeline(record);
			if (record.chain) stopChain(record);
			const targets = record.segments.filter((segment) => String(segment.text || "").trim());
			if (!targets.length) return;
			let texts = null;
			if (selection.record === record && !selection.segment) {
				const edited = splitText(input.value);
				if (edited.length === record.segments.length) texts = edited;
			}
			record.regenerating = true;
			record.regeneratingAll = true;
			refreshSegmentControls(record);
			let anyOk = false;
			try {
				for (const segment of targets) {
					if (await regenerateSegment(record, segment, {
						text: texts ? texts[segmentIndex(record, segment)] : segment.text,
						autoPlay: false,
						keepLock: true,
						allowEmpty: true,
						deferRebuild: true
					})) anyOk = true;
					if (!records.includes(record)) return;
				}
			} finally {
				record.regenerating = false;
				record.regeneratingAll = false;
				if (records.includes(record) && record.state !== "capturing" && record.state !== "failed") rebuildRecord(record);
				refreshSegmentControls(record);
			}
			const first = record.segments.find((segment) => segment.complete && segment.bytes && !segment.busy);
			if (anyOk && first && records.includes(record) && record.state !== "failed") playChainSegment(record, first);
		}
		return {
			regenerateSegment,
			regenerateRecord
		};
	}
	function initSichangHandler() {
		if (window.location.hostname !== "sichang.xyz") return;
		const ui = createPanel();
		const host = {
			ui,
			records: [],
			selection: {
				record: null,
				segment: null
			},
			activeAudio: null,
			activeSession: null,
			activeTimeline: null,
			audioContext: null,
			inputTyping: false
		};
		function applySelection(record, segment) {
			host.selection.record = record;
			host.selection.segment = segment;
			for (const item of host.records) {
				item.row.classList.toggle("selected", item === record);
				for (const part of item.segments) {
					const chosen = Boolean(segment && part === segment);
					part.row.classList.toggle("selected", chosen);
				}
			}
			host.updateComposeMeta();
		}
		function selectRecord(record) {
			if (host.selection.record === record && !host.selection.segment) return;
			applySelection(record, null);
			host.setInputText(record.text || "");
		}
		function selectSegment(record, segment) {
			if (host.selection.record === record && host.selection.segment === segment) return;
			applySelection(record, segment);
			host.setInputText(segment.text || "");
		}
		function mirrorPlayingText(record, segment) {
			if (!segment || !String(segment.text || "").trim()) return;
			if (host.selection.record === record && host.selection.segment === segment) return;
			if (host.inputTyping || ui.input.getRootNode().activeElement === ui.input) return;
			applySelection(record, segment);
			host.setInputText(segment.text);
		}
		Object.assign(host, {
			applySelection,
			selectRecord,
			selectSegment,
			mirrorPlayingText,
			copyText
		});
		const disposers = [];
		const adopt = ({ api, dispose }) => {
			Object.assign(host, api);
			if (typeof dispose === "function") disposers.push(dispose);
		};
		adopt(createCompose(host));
		adopt(createRecordView(host));
		adopt(createSegments(host));
		adopt(createChain(host));
		adopt(createTimeline(host));
		Object.assign(host, createRegenerator({
			records: host.records,
			selection: host.selection,
			input: ui.input,
			sampleRateOf: host.sampleRateOf,
			segmentIndex: host.segmentIndex,
			segmentSpans: host.segmentSpans,
			livePosition: host.livePosition,
			rescheduleTimeline: host.rescheduleTimeline,
			clearSegmentAudio: host.clearSegmentAudio,
			setSegmentState: host.setSegmentState,
			setSegmentLabel: host.setSegmentLabel,
			refreshRecordText: host.refreshRecordText,
			rebuildRecord: host.rebuildRecord,
			refreshSegmentControls: host.refreshSegmentControls,
			stopTimeline: host.stopTimeline,
			stopChain: host.stopChain,
			openSegmentPanel: host.openSegmentPanel,
			playChainSegment: host.playChainSegment,
			flashSegmentRegenButton: host.flashSegmentRegenButton,
			currentTts: host.currentTts
		}));
		adopt(createSynthesis(host));
		adopt(createPanelLayout(host));
		return () => {
			for (const dispose of disposers.splice(0).reverse()) try {
				dispose();
			} catch (error) {
				console.warn("[SichangTools] 清理失败", error);
			}
			for (const record of [...host.records]) host.removeRecord(record);
			host.activeAudio = null;
			host.activeSession = null;
			host.activeTimeline = null;
			if (host.audioContext && host.audioContext.state !== "closed") try {
				host.audioContext.close();
			} catch {}
			ui.host.remove();
		};
	}
	var disposers = [];
	var runtime = { initialized: false };
	function run(init) {
		const cleanup = init();
		if (typeof cleanup === "function") disposers.push(cleanup);
	}
	function dispose() {
		for (const cleanup of disposers.splice(0).reverse()) try {
			cleanup();
		} catch (error) {
			console.warn("[SichangTools] 清理失败", error);
		}
		runtime.initialized = false;
	}
	function initialize() {
		if (runtime.initialized) dispose();
		runtime.initialized = true;
		run(initSichangHandler);
	}
	var host = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
	if (typeof host.__USERSCRIPT_TEARDOWN__ === "function") host.__USERSCRIPT_TEARDOWN__();
	initialize();
	host.__USERSCRIPT_TEARDOWN__ = dispose;
})();
