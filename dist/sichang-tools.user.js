// ==UserScript==
// @name         SichangTools
// @namespace    https://github.com/sherlocknieh/
// @version      2026.11.27.2327
// @description  接管思畅 AI 朗读，分段合成、边下边播；支持单条删除、会话克隆、消息 fork、手动添加消息与 WAV 保存
// @icon         https://sichang.xyz/favicon.ico
// @match        https://sichang.xyz/*
// @grant        none
// ==/UserScript==

(function() {
	"use strict";
	var TTS_PATH = "/api/tts";
	var OFFICIAL_MESSAGE_DELETE_SELECTOR = [
		"button[aria-label=\"删除消息\"]",
		"button[title=\"删除消息\"]",
		"button[aria-label=\"Delete message\"]",
		"button[title=\"Delete message\"]"
	].join(", ");
	var CONVERSATION_IMPORT_MAX_CHARS = 2e4;
	var OFFICIAL_CHAT_HEADER_SELECTOR = "div.h-14";
	var OFFICIAL_NEW_CHAT_SELECTOR = "button[aria-label=\"新建对话\"], button[title=\"新建对话\"]";
	var CLONE_BUTTON_SELECTOR = "button[data-sichang-clone]";
	var CLONE_BUTTON_LABEL = "克隆会话";
	var CLONE_TITLE_SUFFIX = "（副本）";
	var OFFICIAL_SEND_SELECTOR = "button[aria-label=\"发送消息\"], button[title=\"发送消息\"]";
	var OFFICIAL_ATTACH_SELECTOR = "button[aria-label=\"发送附件\"], button[title=\"发送附件\"]";
	var ADD_BUBBLE_BUTTON_SELECTOR = "button[data-sichang-add-bubble]";
	var ADD_BUBBLE_BUTTON_LABEL = "添加消息气泡";
	var OFFICIAL_COPY_SELECTOR = "button[aria-label=\"复制消息\"], button[title=\"复制消息\"], button[aria-label=\"Copy message\"], button[title=\"Copy message\"]";
	var FORK_BUTTON_SELECTOR = "button[data-sichang-fork]";
	var FORK_BUTTON_LABEL = "复刻到这条消息";
	var PANEL_ID = "sichang-tts-capture";
	var DEFAULT_SAMPLE_RATE = 24e3;
	var SEGMENT_HEADER = "X-Sichang-Segment";
	var VOICE_STORE_KEY = "sichang-tts-voice";
	var PLAYBACK_RATE_STORE_KEY = "sichang-tts-playback-rate";
	var FOLD_STORE_KEY = "sichang-tts-folded";
	var PLAYBACK_RATES = [
		1,
		1.25,
		1.5,
		2
	];
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
	function voiceName(voice) {
		const label = VOICE_LABELS.get(voice) || voice || "默认";
		return label.replace(/（.*?）/g, "").replace(/\(.*?\)/g, "") || label;
	}
	var PANEL_CSS = `
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
.head .voice {
    flex: 0 1 132px;
    min-width: 64px;
    height: 24px;
    padding: 0 4px;
    border: 1px solid #2c2c33;
    border-radius: 6px;
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
    border-radius: 6px;
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
	function createPanel() {
		const host = document.createElement("div");
		host.id = PANEL_ID;
		host.style.cssText = "display:block; margin:0 0 18px;";
		for (const type of [
			"click",
			"pointerdown",
			"keydown",
			"keyup",
			"change"
		]) host.addEventListener(type, (event) => event.stopPropagation());
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
        <div class="head" title="单击收起/展开">
            <button class="fold" aria-label="收起">−</button>
            <span class="title">语音合成</span>
            <span class="spacer"></span>
            <button class="rateCycle" aria-label="播放倍速" title="播放倍速（仅已下载音频）">1×</button>
            <select class="voice" aria-label="音色">${VOICE_GROUPS.map((group) => `
        <optgroup label="${group.label}">
            ${group.voices.map((voice) => `<option value="${voice.id}">${voice.label}</option>`).join("")}
        </optgroup>
    `).join("")}</select>
            <button class="go" title="读取官方输入框文字合成语音">合成</button>
            <button class="clear" hidden aria-label="清空全部记录">清空</button>
        </div>
        <div class="body">
            <div class="list"></div>
        </div>
    `;
		root.appendChild(panel);
		return {
			host,
			root,
			panel,
			head: panel.querySelector(".head"),
			body: panel.querySelector(".body"),
			list: panel.querySelector(".list"),
			rateCycle: panel.querySelector(".rateCycle"),
			clear: panel.querySelector(".clear"),
			fold: panel.querySelector(".fold"),
			voice: panel.querySelector(".voice"),
			go: panel.querySelector(".go"),
			dispose() {
				host.remove();
			}
		};
	}
	var RETRY_MS = 200;
	var FALLBACK_MS = 5e3;
	function hasReactFiber(element) {
		return Boolean(element) && Object.getOwnPropertyNames(element).some((key) => key.startsWith("__reactFiber$"));
	}
	var forced = false;
	var settled = false;
	var retryTimer = 0;
	var fallbackTimer = 0;
	var listeners = new Set();
	function canMutate(element) {
		if (forced) return true;
		return document.readyState === "complete" && hasReactFiber(element);
	}
	function sampleNode() {
		return document.querySelector("textarea") || document.body?.firstElementChild || null;
	}
	function settle() {
		if (settled) return;
		settled = true;
		window.clearTimeout(retryTimer);
		window.clearTimeout(fallbackTimer);
		retryTimer = 0;
		fallbackTimer = 0;
		for (const fn of [...listeners]) {
			listeners.delete(fn);
			try {
				fn();
			} catch (error) {
				console.warn("[SichangTools] 水合后回调失败", error);
			}
		}
	}
	function check() {
		if (settled) return;
		if (document.readyState !== "complete") return;
		if (!hasReactFiber(sampleNode())) return;
		settle();
	}
	function retry() {
		retryTimer = 0;
		if (settled) return;
		check();
		if (settled) return;
		retryTimer = window.setTimeout(retry, RETRY_MS);
	}
	function arm() {
		check();
		if (settled) return;
		retry();
		fallbackTimer = window.setTimeout(() => {
			forced = true;
			settle();
		}, FALLBACK_MS);
	}
	function onSettled(callback) {
		if (settled) {
			callback();
			return () => {};
		}
		listeners.add(callback);
		return () => listeners.delete(callback);
	}
	if (document.readyState === "complete") arm();
	else window.addEventListener("load", arm, { once: true });
	function findComposer() {
		const candidates = [...document.querySelectorAll("textarea")].filter((textarea) => textarea.getBoundingClientRect().width > 0);
		for (const textarea of candidates) {
			let container = textarea.parentElement;
			for (let depth = 0; container && depth < 4; depth += 1) {
				const send = container.querySelector(OFFICIAL_SEND_SELECTOR);
				const attach = container.querySelector(OFFICIAL_ATTACH_SELECTOR);
				if (send || attach) return {
					textarea,
					container,
					send,
					row: send?.parentElement ?? null
				};
				container = container.parentElement;
			}
		}
		return null;
	}
	function officialContext(element) {
		let fiber = null;
		for (const key of Object.getOwnPropertyNames(element)) if (key.startsWith("__reactFiber$")) {
			fiber = element[key];
			break;
		}
		for (let depth = 0; fiber && depth < 500; depth += 1) {
			const value = fiber.memoizedProps?.value;
			if (value && typeof value.upsertConversation === "function" && typeof value.activeConversation === "object" && Array.isArray(value.conversations)) return value;
			fiber = fiber.return;
		}
		return null;
	}
	function setNativeValue(element, value) {
		const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
		const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
		if (setter) setter.call(element, value);
		else element.value = value;
		element.dispatchEvent(new Event("input", { bubbles: true }));
	}
	function createPanelLayout(host) {
		const { ui } = host;
		function applyFold(folded, persist = true) {
			ui.panel.classList.toggle("folded", folded);
			ui.fold.textContent = folded ? "+" : "−";
			ui.fold.setAttribute("aria-label", folded ? "展开" : "收起");
			if (!persist) return;
			try {
				localStorage.setItem(FOLD_STORE_KEY, folded ? "1" : "0");
			} catch {}
		}
		function expandPanel() {
			applyFold(false, false);
		}
		ui.fold.addEventListener("click", () => applyFold(!ui.panel.classList.contains("folded")));
		let savedFold = null;
		try {
			savedFold = localStorage.getItem(FOLD_STORE_KEY);
		} catch {}
		if (savedFold !== "0") applyFold(true);
		ui.head.addEventListener("click", (event) => {
			if (event.target.closest("button, select")) return;
			applyFold(!ui.panel.classList.contains("folded"));
		});
		function placePanel() {
			const composer = findComposer();
			if (!composer) {
				ui.host.remove();
				return;
			}
			const { container, textarea } = composer;
			if (!canMutate(container) || !canMutate(textarea)) {
				ui.host.remove();
				return;
			}
			if (ui.host.parentElement !== container || container.firstElementChild !== ui.host) container.insertBefore(ui.host, container.firstChild);
			host.bindInput(textarea);
		}
		let timer = 0;
		function schedulePlace() {
			if (timer) return;
			timer = window.setTimeout(() => {
				timer = 0;
				placePanel();
			}, 120);
		}
		const observer = new MutationObserver(schedulePlace);
		observer.observe(document.documentElement, {
			childList: true,
			subtree: true
		});
		const unsubscribeSettled = onSettled(schedulePlace);
		placePanel();
		return {
			api: {
				applyFold,
				expandPanel,
				placePanel
			},
			dispose: () => {
				observer.disconnect();
				unsubscribeSettled();
				if (timer) window.clearTimeout(timer);
			}
		};
	}
	function createCompose(host) {
		const { ui } = host;
		let textarea = null;
		let writing = false;
		ui.voice.addEventListener("change", () => {
			try {
				localStorage.setItem(VOICE_STORE_KEY, ui.voice.value);
			} catch {}
		});
		function currentTts() {
			return {
				voice: ui.voice.value || "mimo_default",
				rate: 1
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
			ui.go.title = "读取官方输入框文字合成语音";
			ui.go.setAttribute("aria-label", "合成语音");
			ui.go.disabled = !getInputText().trim();
		}
		function getInputText() {
			return textarea?.isConnected ? String(textarea.value || "") : "";
		}
		function isInputFocused() {
			return Boolean(textarea?.isConnected) && textarea.getRootNode().activeElement === textarea;
		}
		function hasPendingInput() {
			if (!host.inputTyping) return false;
			if (!getInputText().trim()) {
				host.inputTyping = false;
				return false;
			}
			return true;
		}
		function setInputText(text) {
			if (!textarea?.isConnected) return;
			writing = true;
			try {
				setNativeValue(textarea, String(text ?? ""));
			} finally {
				writing = false;
			}
			host.inputTyping = false;
			syncGoButton();
		}
		function onUserInput() {
			if (writing) return;
			host.inputTyping = true;
			syncGoButton();
		}
		function onKeydown(event) {
			if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
			event.preventDefault();
			event.stopPropagation();
			submitCompose();
		}
		function bindInput(next) {
			if (!next || next === textarea) {
				syncGoButton();
				return;
			}
			if (textarea) {
				textarea.removeEventListener("input", onUserInput);
				textarea.removeEventListener("keydown", onKeydown);
			}
			textarea = next;
			textarea.addEventListener("input", onUserInput);
			textarea.addEventListener("keydown", onKeydown);
			host.inputTyping = false;
			syncGoButton();
		}
		try {
			const savedVoice = localStorage.getItem(VOICE_STORE_KEY);
			if (savedVoice && [...ui.voice.options].some((option) => option.value === savedVoice)) ui.voice.value = savedVoice;
		} catch {}
		syncGoButton();
		function submitCompose() {
			const text = getInputText().trim();
			if (!text) {
				textarea?.focus();
				return;
			}
			const { voice, rate } = currentTts();
			try {
				localStorage.setItem(VOICE_STORE_KEY, voice);
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
		return { api: {
			currentTts,
			setInputText,
			getInputText,
			isInputFocused,
			hasPendingInput,
			bindInput,
			syncGoButton,
			submitCompose,
			activeSynthesis
		} };
	}
	function formatDuration(seconds) {
		const total = Math.max(0, Math.round(seconds));
		return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
	}
	function formatSegmentDuration(seconds) {
		if (seconds < 10) return `${seconds.toFixed(1)}s`;
		return formatDuration(seconds);
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
	var SEGMENT_ICONS = {
		play: "▶",
		pause: "⏸",
		stop: "■",
		replay: "↺",
		download: "↓",
		synthStop: "✕",
		waiting: "…"
	};
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
		function setSegmentVoice(segment, voice, locked = false) {
			segment.voice = voice;
			if (locked) segment.voiceLocked = true;
			segment.voiceEl.textContent = voiceName(voice);
			segment.voiceEl.title = `音色：${VOICE_LABELS.get(voice) || voice || "默认音色"}`;
		}
		function refreshRecordText(record) {
			record.text = record.segments.map((segment) => segment.text || "").join("");
			record.txt.textContent = previewText(record.text) || "（无文本）";
			record.txt.title = "点击选中整条并收起/展开分段";
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
				setAction(segment.toggleButton, paused ? SEGMENT_ICONS.play : SEGMENT_ICONS.pause, paused ? "继续播放" : "暂停播放");
				segment.toggleButton.classList.toggle("playing", !capturing && !paused);
				segment.stopButton.hidden = false;
				setAction(segment.stopButton, SEGMENT_ICONS.stop, capturing ? "停止合成" : "停止播放");
				segment.stopButton.classList.toggle("synth", capturing);
				segment.synthButton.hidden = true;
				segment.replayButton.hidden = true;
			} else if (waiting) {
				segment.toggleButton.hidden = false;
				segment.toggleButton.disabled = true;
				setAction(segment.toggleButton, SEGMENT_ICONS.waiting, "等待下一段");
				segment.toggleButton.classList.remove("playing");
				segment.stopButton.hidden = false;
				setAction(segment.stopButton, SEGMENT_ICONS.stop, "停止播放");
				segment.stopButton.classList.remove("synth");
				segment.synthButton.hidden = !synthesizing;
				segment.replayButton.hidden = false;
				segment.replayButton.disabled = !enabled;
			} else {
				segment.toggleButton.hidden = false;
				segment.toggleButton.disabled = !enabled;
				setAction(segment.toggleButton, playing ? SEGMENT_ICONS.pause : SEGMENT_ICONS.play, playing ? "暂停播放" : audio ? "继续播放" : "播放本段");
				segment.toggleButton.classList.toggle("playing", playing);
				segment.stopButton.hidden = !audio;
				setAction(segment.stopButton, SEGMENT_ICONS.stop, "停止播放");
				segment.stopButton.classList.remove("synth");
				segment.synthButton.hidden = !synthesizing;
				segment.replayButton.hidden = false;
				segment.replayButton.disabled = !enabled;
			}
			segment.downloadButton.disabled = !segment.bytes || segment.busy;
		}
		function setAction(button, icon, label) {
			button.textContent = icon;
			button.title = label;
			button.setAttribute("aria-label", label);
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
			setSegmentVoice,
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
		let clearTimer = null;
		function resetClearConfirm() {
			clearTimeout(clearTimer);
			clearTimer = null;
			ui.clear.classList.remove("confirm");
			ui.clear.textContent = "清空";
			ui.clear.title = "清空全部记录";
			ui.clear.setAttribute("aria-label", "清空全部记录");
		}
		function armClearConfirm() {
			ui.clear.classList.add("confirm");
			ui.clear.textContent = "确认清空";
			ui.clear.title = "再次点击确认清空全部记录";
			ui.clear.setAttribute("aria-label", "再次点击确认清空全部记录");
			clearTimeout(clearTimer);
			clearTimer = setTimeout(resetClearConfirm, 3e3);
		}
		function updateCount() {
			resetClearConfirm();
			ui.clear.hidden = records.length === 0;
			ui.panel.classList.toggle("empty", records.length === 0);
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
			const voiceEl = document.createElement("span");
			voiceEl.className = "segVoice";
			voiceEl.textContent = voiceName(record.tts.voice);
			const toggleButton = document.createElement("button");
			toggleButton.className = "segAction";
			toggleButton.textContent = SEGMENT_ICONS.play;
			toggleButton.title = "播放本段";
			toggleButton.setAttribute("aria-label", "播放本段");
			const stopButton = document.createElement("button");
			stopButton.className = "segAction";
			stopButton.textContent = SEGMENT_ICONS.stop;
			stopButton.title = "停止播放";
			stopButton.setAttribute("aria-label", "停止播放");
			stopButton.hidden = true;
			const synthButton = document.createElement("button");
			synthButton.className = "segAction synth";
			synthButton.textContent = SEGMENT_ICONS.synthStop;
			synthButton.title = "停止合成";
			synthButton.setAttribute("aria-label", "停止合成");
			synthButton.hidden = true;
			const replayButton = document.createElement("button");
			replayButton.className = "segAction";
			replayButton.textContent = SEGMENT_ICONS.replay;
			replayButton.title = "重播本段";
			replayButton.setAttribute("aria-label", "重播本段");
			const downloadButton = document.createElement("button");
			downloadButton.className = "segAction";
			downloadButton.textContent = SEGMENT_ICONS.download;
			downloadButton.title = "下载本段";
			downloadButton.setAttribute("aria-label", "下载本段");
			downloadButton.disabled = true;
			controls.append(toggleButton, timeEl, voiceEl, bar, stopButton, replayButton, downloadButton, synthButton);
			panel.append(controls);
			row.append(caret, idx, label, segDuration, playButton, regenButton);
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
				voiceEl,
				toggleButton,
				stopButton,
				synthButton,
				replayButton,
				downloadButton
			});
			host.setSegmentVoice(segment, record.tts.voice);
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
			const txt = document.createElement("div");
			txt.className = "txt";
			txt.textContent = previewText(text) || "（无文本）";
			txt.title = "点击选中整条并收起/展开分段";
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
			const downloadButton = document.createElement("button");
			downloadButton.className = "itemDownload";
			downloadButton.textContent = "↓";
			downloadButton.title = "下载整条 WAV";
			downloadButton.setAttribute("aria-label", "下载整条 WAV");
			downloadButton.disabled = true;
			const deleteButton = document.createElement("button");
			deleteButton.className = "itemDelete";
			deleteButton.textContent = "✕";
			deleteButton.title = "删除这条记录";
			deleteButton.setAttribute("aria-label", "删除这条记录");
			head.append(caret, meta, txt, duration, segCount, playButton, regenAllButton, downloadButton, deleteButton);
			const segList = document.createElement("div");
			segList.className = "segList";
			row.append(head, segList);
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
				downloadButton,
				deleteButton,
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
			downloadButton.addEventListener("click", (event) => {
				event.stopPropagation();
				downloadRecord(record);
			});
			deleteButton.addEventListener("click", (event) => {
				event.stopPropagation();
				removeRecord(record);
			});
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
			if (ui.clear.classList.contains("confirm") && !event.composedPath().includes(ui.clear)) resetClearConfirm();
		};
		document.addEventListener("pointerdown", onDocumentPointerDown, true);
		ui.clear.addEventListener("click", () => {
			if (!records.length) return;
			if (!ui.clear.classList.contains("confirm")) {
				armClearConfirm();
				return;
			}
			resetClearConfirm();
			for (const record of [...records]) removeRecord(record);
			host.activeAudio = null;
			host.setInputText("");
		});
		updateCount();
		return {
			api: {
				updateCount,
				syncRecordRegenButton,
				beginRecord,
				createSegment,
				removeRecord,
				downloadRecord,
				downloadSegment,
				rebuildRecord
			},
			dispose: () => {
				clearTimeout(clearTimer);
				document.removeEventListener("pointerdown", onDocumentPointerDown, true);
			}
		};
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
				audio.preservesPitch = true;
				audio.mozPreservesPitch = true;
				audio.webkitPreservesPitch = true;
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
			segment.audio.playbackRate = host.playbackRate;
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
		function playChainSegment(record, segment, options = {}) {
			const { offset = 0, autoPlay = true } = options;
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
			const applyOffset = () => {
				if (!(offset > 0)) return;
				const duration = Number.isFinite(audio.duration) ? audio.duration : offset;
				try {
					audio.currentTime = Math.min(offset, duration);
				} catch {}
				host.updateSegmentTime(record, segment, audio.currentTime, duration);
			};
			const begin = () => {
				applyOffset();
				audio.play().then(() => {
					host.syncSegmentPlayState(segment);
					syncRecordPlayButton(record);
				}, () => {
					host.syncSegmentPlayState(segment);
					syncRecordPlayButton(record);
				});
			};
			if (offset > 0 && audio.readyState < 1) {
				audio.addEventListener("loadedmetadata", autoPlay ? begin : applyOffset, { once: true });
				if (!autoPlay) {
					host.syncSegmentPlayState(segment);
					syncRecordPlayButton(record);
				}
				return;
			}
			if (autoPlay) begin();
			else {
				applyOffset();
				host.syncSegmentPlayState(segment);
				syncRecordPlayButton(record);
			}
		}
		function switchToChainAt(record, position, autoPlay) {
			const info = host.segmentAt(record, position);
			if (!info) return false;
			const offset = Math.max(0, Math.min(info.duration, position - info.start));
			host.stopTimeline(record);
			playChainSegment(record, info.segment, {
				offset,
				autoPlay
			});
			return true;
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
			switchToChainAt,
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
		function currentVoice() {
			return ui.voice.value || "mimo_default";
		}
		function syncPendingVoices() {
			const record = host.activeSession?.record;
			if (!record || record.state !== "capturing") return;
			const voice = currentVoice();
			for (const segment of record.segments) {
				if (segment.voiceLocked || segment.status !== "pending") continue;
				host.setSegmentVoice(segment, voice);
			}
		}
		ui.voice.addEventListener("change", syncPendingVoices);
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
			host.expandPanel?.();
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
			const requestSegment = (segmentText, segmentVoice) => window.fetch(TTS_PATH, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					[SEGMENT_HEADER]: "1"
				},
				body: JSON.stringify({
					text: segmentText,
					voice: segmentVoice,
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
				const voice = piece.voice || currentVoice();
				piece.voice = voice;
				host.setSegmentVoice(piece.segment, voice, true);
				const promise = requestSegment(piece.text, voice);
				promise.catch(() => {});
				prefetch = {
					piece,
					promise
				};
			};
			const takePrefetch = (piece, voice) => {
				if (prefetch && prefetch.piece === piece) {
					const { promise } = prefetch;
					prefetch = null;
					return promise;
				}
				return requestSegment(piece.text, voice);
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
					const voice = piece.voice || currentVoice();
					piece.voice = voice;
					host.setSegmentVoice(segment, voice, true);
					const response = await takePrefetch(piece, voice);
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
				host.setSegmentVoice(segment, currentVoice());
				const second = host.createSegment(record, halves[1], segment);
				host.setSegmentVoice(second, currentVoice());
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
				ui.voice.removeEventListener("change", syncPendingVoices);
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
		const { records, selection, inputText, sampleRateOf, segmentIndex, segmentSpans, livePosition, rescheduleTimeline, clearSegmentAudio, setSegmentState, setSegmentLabel, refreshRecordText, rebuildRecord, refreshSegmentControls, stopTimeline, stopChain, openSegmentPanel, playChainSegment, flashSegmentRegenButton, currentTts } = host;
		async function regenerateSegment(record, segment, options = {}) {
			const { text: textOverride, autoPlay = true, keepLock = false, allowEmpty = false, deferRebuild = false } = options;
			if (!segment || !records.includes(record) || segment.busy) return false;
			if (!keepLock && record.regenerating) return false;
			if (!allowEmpty && (!segment.complete || !segment.bytes)) return false;
			const editing = selection.record === record && selection.segment === segment;
			const text = String(textOverride ?? (editing ? inputText?.() ?? "" : segment.text) ?? "").trim();
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
				const edited = splitText(inputText?.() ?? "");
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
	var BUSY_ATTR = "data-sichang-busy";
	var STYLE_ID = "sichang-busy-icon-style";
	var CSS = `
@keyframes sichang-busy-spin { to { transform: rotate(360deg); } }
button[${BUSY_ATTR}] {
    --sichang-busy-arrow: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8'/%3E%3Cpath d='M21 3v5h-5'/%3E%3C/svg%3E");
    position: relative;
    pointer-events: none;
}
button[${BUSY_ATTR}] > * { visibility: hidden; }
button[${BUSY_ATTR}]::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    background: currentColor;
    -webkit-mask: var(--sichang-busy-arrow) center / contain no-repeat;
    mask: var(--sichang-busy-arrow) center / contain no-repeat;
    animation: sichang-busy-spin .8s linear infinite;
}
`;
	function ensureBusyIconStyle() {
		if (document.getElementById(STYLE_ID)) return;
		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = CSS;
		document.head.appendChild(style);
	}
	function setBusyIcon(button, busy) {
		if (!button || busy && !button.isConnected) return;
		ensureBusyIconStyle();
		if (busy) button.setAttribute(BUSY_ATTR, "");
		else button.removeAttribute(BUSY_ATTR);
		button.setAttribute("aria-busy", busy ? "true" : "false");
	}
	function clearBusyIcons() {
		for (const button of document.querySelectorAll(`[${BUSY_ATTR}]`)) {
			button.removeAttribute(BUSY_ATTR);
			button.setAttribute("aria-busy", "false");
		}
	}
	var CHAT_PATH_RE = /^\/chat\/(conv__[^/?#]+)/;
	function readConversationId() {
		const match = CHAT_PATH_RE.exec(window.location.pathname);
		return match ? decodeURIComponent(match[1]) : "";
	}
	async function request(url, options = {}) {
		const response = await fetch(url, {
			credentials: "same-origin",
			cache: "no-store",
			...options
		});
		if (!response.ok) {
			let detail = "";
			try {
				detail = (await response.text()).slice(0, 160);
			} catch {}
			const error = new Error(`${url} ${response.status}${detail ? `: ${detail}` : ""}`);
			error.status = response.status;
			throw error;
		}
		return response;
	}
	async function requestJson(url, options = {}) {
		return (await request(url, options)).json();
	}
	function loadConversation(cid) {
		return requestJson(`/api/conversations/${encodeURIComponent(cid)}`);
	}
	function createConversation(cid, meta) {
		const body = {
			id: cid,
			title: meta.title || "新对话",
			model: meta.model || "gemma-4-uncensored",
			scope: meta.scope === "character" ? "character" : "general",
			characterId: meta.scope === "character" ? meta.characterId ?? null : null,
			createdAt: meta.createdAt || Date.now()
		};
		if (typeof meta.webSearch === "boolean") body.webSearch = meta.webSearch;
		if (typeof meta.reasoning === "boolean") body.reasoning = meta.reasoning;
		return request("/api/conversations", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		});
	}
	function deleteConversation(cid) {
		return request(`/api/conversations/${encodeURIComponent(cid)}`, { method: "DELETE" });
	}
	async function loadMessages(cid) {
		let before = "";
		const pages = [];
		const seen = new Set();
		for (let page = 0; page < 40; page += 1) {
			const params = new URLSearchParams({
				limit: String(500),
				before
			});
			const data = await requestJson(`/api/conversations/${encodeURIComponent(cid)}/messages?${params.toString()}`);
			const items = Array.isArray(data.items) ? data.items : [];
			pages.push(items);
			if (!data.prevCursor || items.length === 0) break;
			const cursor = String(data.prevCursor);
			if (seen.has(cursor)) break;
			seen.add(cursor);
			before = cursor;
		}
		return pages.reverse().flat().sort((a, b) => a.seq - b.seq);
	}
	function toImportMessage(message, seq) {
		return {
			id: message.id,
			seq,
			role: message.role === "system" ? "system" : message.role === "user" ? "user" : "assistant",
			...message.model ? { model: message.model } : {},
			content: message.content,
			createdAt: message.createdAt || Date.now(),
			state: "complete"
		};
	}
	function newId() {
		return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	}
	function conversationOwner(cid) {
		const parts = String(cid || "").split("__");
		if (parts.length < 3 || parts[0] !== "conv" || !parts[1]) return "";
		return parts[1];
	}
	function nextSeq(messages) {
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const seq = messages[index].seq;
			if (typeof seq === "number") return seq + (messages.length - index);
		}
		return messages.length;
	}
	async function importMessages(cid, meta, messages) {
		const conversation = {
			id: cid,
			scope: meta.scope === "character" ? "character" : "general",
			characterId: meta.scope === "character" ? meta.characterId ?? null : null,
			title: meta.title || "新对话",
			model: meta.model || "gemma-4-uncensored",
			createdAt: meta.createdAt || Date.now(),
			updatedAt: Date.now()
		};
		for (let offset = 0; offset < messages.length; offset += 400) {
			const chunk = messages.slice(offset, offset + 400);
			await request("/api/conversations/import", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ conversations: [{
					...conversation,
					updatedAt: Date.now(),
					messages: chunk.map((message, index) => toImportMessage(message, message.seq ?? offset + index))
				}] })
			});
		}
	}
	function errorMessage(error) {
		if (error?.status === 401) return "未登录或登录已失效，无法同步到官方。";
		if (error?.status === 404) return "这个对话不在云端（可能是未登录时的本地对话），无法同步到官方。";
		return error?.message || String(error);
	}
	var MEDIA_FIELDS = [
		["attachments", "附件"],
		["files", "附件"],
		["images", "图片"],
		["generatedImages", "图片"],
		["imageSuggestions", "图片"]
	];
	var MEDIA_URL_KEYS = [
		"url",
		"src",
		"href",
		"imageUrl",
		"image",
		"fileUrl",
		"downloadUrl"
	];
	var IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#]|$)/i;
	function messageText(content) {
		const text = String(content ?? "");
		return text.length ? text : "​";
	}
	function mediaItemsOf(message) {
		const items = [];
		for (const [key, label] of MEDIA_FIELDS) for (const holder of [message, message?.meta]) {
			const value = holder?.[key];
			if (Array.isArray(value)) for (const item of value) items.push({
				label,
				item
			});
		}
		return items;
	}
	function mediaUrlOf(item) {
		if (typeof item === "string") return item;
		if (!item || typeof item !== "object") return "";
		for (const key of MEDIA_URL_KEYS) {
			const value = item[key];
			if (typeof value === "string" && value) return value;
			if (value && typeof value === "object" && typeof value.url === "string" && value.url) return value.url;
		}
		return "";
	}
	function absoluteMediaUrl(url) {
		const raw = String(url || "").trim();
		if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return "";
		try {
			return new URL(raw, window.location.origin).href;
		} catch {
			return "";
		}
	}
	function escapeMarkdownUrl(url) {
		return url.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
	}
	function isImageMedia(item, url, fallbackLabel) {
		const type = typeof item === "object" ? String(item?.type || item?.mimeType || item?.mime || item?.contentType || "") : "";
		if (type.startsWith("image/")) return true;
		if (IMAGE_URL_RE.test(url)) return true;
		return fallbackLabel === "图片" && !type;
	}
	function messageMediaMarkdown(message) {
		const seen = new Set();
		const lines = [];
		for (const { label, item } of mediaItemsOf(message)) {
			const url = absoluteMediaUrl(mediaUrlOf(item));
			if (!url || seen.has(url)) continue;
			seen.add(url);
			const name = typeof item === "object" ? String(item?.name || item?.filename || item?.title || "") : "";
			const image = isImageMedia(item, url, label);
			const text = (image ? name || "图片" : name || label).replace(/[[\]]/g, "");
			lines.push(`${image ? "!" : ""}[${text}](${escapeMarkdownUrl(url)})`);
		}
		return lines.join("\n");
	}
	function copyMessageText(message) {
		const text = messageText(message.content);
		const media = messageMediaMarkdown(message);
		if (!media) return text;
		const merged = `${text}\n\n${media}`;
		if (merged.length > 2e4) {
			console.warn(`[SichangTools] 消息 #${message.seq} 附加媒体链接后超出导入上限，只复制正文。`);
			return text;
		}
		return merged;
	}
	function roleOf(message) {
		return message.role === "system" ? "system" : message.role === "user" ? "user" : "assistant";
	}
	function sameMessages(actual, expected) {
		if (actual.length !== expected.length) return false;
		for (let index = 0; index < actual.length; index += 1) {
			if (actual[index].content !== expected[index].content) return false;
			if (actual[index].role !== expected[index].role) return false;
		}
		return true;
	}
	function validateCopyMessages(messages) {
		if (!messages.length) throw new Error("没有可复制的消息。");
		if (messages.length > 500) throw new Error(`消息超过官方导入一次最多 500 条的限制。`);
		const tooLong = messages.find((message) => messageText(message.content).length > CONVERSATION_IMPORT_MAX_CHARS);
		if (tooLong) throw new Error(`第 #${tooLong.seq} 条消息超过 ${CONVERSATION_IMPORT_MAX_CHARS} 字，官方导入接口会截断。`);
	}
	async function copyConversationByApi({ owner, meta, messages, title }) {
		if (!owner) throw new Error("无法识别会话归属，暂不支持复制。");
		validateCopyMessages(messages);
		const targetCid = `conv__${owner}__${newId()}`;
		const now = Date.now();
		const targetMeta = {
			...meta,
			title,
			createdAt: now,
			updatedAt: now
		};
		const copied = messages.map((message, index) => ({
			...message,
			id: `msg__${owner}__${newId()}`,
			seq: index,
			role: roleOf(message),
			content: copyMessageText(message),
			createdAt: message.createdAt || now
		}));
		let created = false;
		try {
			await createConversation(targetCid, targetMeta);
			created = true;
			await importMessages(targetCid, targetMeta, copied);
			if (!sameMessages(await loadMessages(targetCid), copied)) throw new Error("写入后校验失败：副本消息与服务端不一致，可能受导入上限或并发影响。");
			return {
				cid: targetCid,
				local: false
			};
		} catch (error) {
			if (created) try {
				await deleteConversation(targetCid);
			} catch {}
			throw error;
		}
	}
	function copyConversationLocally({ context, meta, messages, title }) {
		validateCopyMessages(messages);
		const created = context?.createConversation?.(meta.model || "gemma-4-uncensored");
		if (!created?.id) throw new Error("无法创建本地副本会话。");
		const owner = conversationOwner(created.id);
		for (const message of messages) context.addMessage(created.id, {
			id: `msg__${owner}__${newId()}`,
			role: roleOf(message),
			content: copyMessageText(message),
			createdAt: message.createdAt || Date.now(),
			...message.model ? { model: message.model } : {}
		});
		context.renameConversation?.(created.id, title);
		return {
			cid: created.id,
			local: true
		};
	}
	async function readConversationForCopy(sourceCid, context) {
		try {
			const [meta, messages] = await Promise.all([loadConversation(sourceCid), loadMessages(sourceCid)]);
			return {
				meta,
				messages,
				remote: true
			};
		} catch (error) {
			const active = context?.activeConversation;
			if (active?.id === sourceCid && Array.isArray(active.messages) && active.messages.length) return {
				meta: active,
				messages: active.messages,
				remote: false
			};
			throw error;
		}
	}
	async function copyConversation({ sourceCid, context, meta, messages, title }) {
		const owner = conversationOwner(sourceCid);
		const withMedia = messages.filter((message) => messageMediaMarkdown(message)).length;
		if (withMedia) console.info(`[SichangTools] 已把 ${withMedia} 条消息里的图片/附件地址以 Markdown 链接写入副本。`);
		try {
			return await copyConversationByApi({
				owner,
				meta,
				messages,
				title
			});
		} catch (error) {
			if (owner === "anonymous" && context?.activeConversation?.id === sourceCid) return copyConversationLocally({
				context,
				meta,
				messages,
				title
			});
			throw error;
		}
	}
	var MENU_SELECTOR$1 = "[data-sichang-delete-menu]";
	var MODE_SELECTOR = "[data-sichang-delete-mode]";
	var MENU_STYLE_ID$1 = "sichang-delete-menu-style";
	var MENU_CSS$1 = `
.sichang-delete-menu {
    position: fixed;
    z-index: 2147483647;
    min-width: 150px;
    padding: 4px;
    border: 1px solid var(--border, rgba(127, 127, 127, .28));
    border-radius: 12px;
    background: var(--card, #fff);
    box-shadow: 0 10px 28px rgba(0, 0, 0, .18);
    color: var(--foreground, #111);
    font: inherit;
}
.sichang-delete-menu button {
    display: block;
    width: 100%;
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    text-align: left;
    font-size: 13px;
    line-height: 1.2;
    cursor: pointer;
}
.sichang-delete-menu button:hover { background: var(--muted, rgba(127, 127, 127, .15)); }
.sichang-delete-menu button[data-sichang-delete-mode="one"] { color: #c0392b; }
`;
	function createMessageDelete(host) {
		const state = {
			busy: false,
			cid: "",
			menu: null,
			anchor: null
		};
		function ensureMenuStyle() {
			if (document.getElementById(MENU_STYLE_ID$1)) return;
			const style = document.createElement("style");
			style.id = MENU_STYLE_ID$1;
			style.textContent = MENU_CSS$1;
			document.head.appendChild(style);
		}
		function closeMenu() {
			state.menu?.remove();
			state.menu = null;
			state.anchor = null;
		}
		function positionMenu() {
			if (!state.menu || !state.anchor?.isConnected) return;
			const rect = state.anchor.getBoundingClientRect();
			const menuHeight = state.menu.offsetHeight;
			if (rect.top < menuHeight + 12) {
				state.menu.style.top = `${rect.bottom + 8}px`;
				state.menu.style.bottom = "";
			} else {
				state.menu.style.top = "";
				state.menu.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 8)}px`;
			}
			state.menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
		}
		function openMenu(anchor) {
			ensureMenuStyle();
			closeMenu();
			const menu = document.createElement("div");
			menu.setAttribute("data-sichang-delete-menu", "");
			menu.className = "sichang-delete-menu";
			menu.setAttribute("role", "menu");
			menu.innerHTML = `
            <button type="button" role="menuitem" data-sichang-delete-mode="one">删除本条</button>
            <button type="button" role="menuitem" data-sichang-delete-mode="after">删除后续（走官方）</button>
        `;
			document.body.appendChild(menu);
			state.menu = menu;
			state.anchor = anchor;
			positionMenu();
		}
		function indexOfId(list, id) {
			return list.findIndex((item) => item.id === id);
		}
		function sameOrder(actual, expected) {
			if (actual.length !== expected.length) return false;
			for (let index = 0; index < actual.length; index += 1) {
				if (actual[index].id !== expected[index].id) return false;
				if (actual[index].content !== expected[index].content) return false;
				if (actual[index].role !== expected[index].role) return false;
			}
			return true;
		}
		function planBaseSeq(fresh, firstDiff) {
			if (firstDiff < fresh.length) return fresh[firstDiff].seq;
			return fresh.length ? fresh[fresh.length - 1].seq + 1 : 0;
		}
		function downloadBackup(meta, messages) {
			const blob = new Blob([JSON.stringify({
				conversation: meta,
				messages
			}, null, 2)], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `sichang-message-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
			anchor.click();
			setTimeout(() => URL.revokeObjectURL(url), 1e3);
		}
		async function applyDelete(resolveTarget) {
			if (state.busy || !state.cid) return null;
			state.busy = true;
			let fresh = [];
			let meta = null;
			let firstDiff = -1;
			let deleted = false;
			try {
				fresh = await loadMessages(state.cid);
				meta = await loadConversation(state.cid);
				const target = resolveTarget(fresh);
				const index = indexOfId(fresh, target.id);
				if (index < 0) throw new Error("选中的消息已不存在，请刷新后重试。");
				firstDiff = index;
				const desired = [...fresh.slice(0, index), ...fresh.slice(index + 1).map((message) => ({
					...message,
					content: messageText(message.content)
				}))];
				const baseSeq = planBaseSeq(fresh, firstDiff);
				const newTail = desired.slice(firstDiff).map((message, offset) => ({
					...message,
					seq: baseSeq + offset,
					content: messageText(message.content)
				}));
				const tooLong = newTail.find((message) => String(message.content || "").length > CONVERSATION_IMPORT_MAX_CHARS);
				if (tooLong) throw new Error(`第 #${tooLong.seq} 条消息超过 ${CONVERSATION_IMPORT_MAX_CHARS} 字，官方导入接口会截断，已取消。`);
				deleted = true;
				await request(`/api/conversations/${encodeURIComponent(state.cid)}/messages/${encodeURIComponent(target.id)}`, { method: "DELETE" });
				if (newTail.length) await importMessages(state.cid, meta, newTail);
				const after = await loadMessages(state.cid);
				if (!sameOrder(after, desired)) throw new Error("写入后校验失败：官方消息顺序与预期不一致，可能被其他窗口改动了。");
				return {
					ok: true,
					messages: after,
					targetId: target.id
				};
			} catch (error) {
				const message = errorMessage(error);
				if (deleted) try {
					const originalTail = fresh.slice(firstDiff).map((item, offset) => ({
						...item,
						seq: planBaseSeq(fresh, firstDiff) + offset,
						content: messageText(item.content)
					}));
					if (originalTail.length) await importMessages(state.cid, meta, originalTail);
					if (!sameOrder(await loadMessages(state.cid), [...fresh.slice(0, firstDiff), ...fresh.slice(firstDiff).map((message) => ({
						...message,
						content: messageText(message.content)
					}))])) throw new Error("补回后校验失败");
					return {
						ok: false,
						message: `删除失败：${message}。已尝试补回原消息，请确认页面内容。`
					};
				} catch (restoreError) {
					downloadBackup(meta, fresh);
					return {
						ok: false,
						message: `删除失败：${message}；自动补回也失败：${errorMessage(restoreError)}。已自动下载备份，刷新前请保留。`
					};
				}
				return {
					ok: false,
					message
				};
			} finally {
				state.busy = false;
			}
		}
		async function applyDeleteAfter(resolveTarget) {
			if (state.busy || !state.cid) return null;
			state.busy = true;
			try {
				const fresh = await loadMessages(state.cid);
				const target = resolveTarget(fresh);
				const index = indexOfId(fresh, target.id);
				if (index < 0) throw new Error("选中的消息已不存在，请刷新后重试。");
				await request(`/api/conversations/${encodeURIComponent(state.cid)}/messages/${encodeURIComponent(target.id)}`, { method: "DELETE" });
				const after = await loadMessages(state.cid);
				if (!sameOrder(after, fresh.slice(0, index))) throw new Error("删除后续失败：官方消息列表与预期不一致，可能被其他窗口改动了。");
				return {
					ok: true,
					messages: after,
					targetId: target.id
				};
			} catch (error) {
				return {
					ok: false,
					message: `删除后续失败：${errorMessage(error)}`
				};
			} finally {
				state.busy = false;
			}
		}
		function syncOfficialPage(context, conversation, messages, targetId) {
			if (!context || !conversation || conversation.id !== state.cid) return false;
			const byId = new Map(messages.map((message) => [message.id, message]));
			const next = [];
			for (const message of conversation.messages) {
				const latest = byId.get(message.id);
				if (!latest) continue;
				next.push(latest.seq === message.seq ? message : {
					...message,
					seq: latest.seq
				});
			}
			if (next.length === conversation.messages.length || next.some((message) => message.id === targetId)) return false;
			try {
				context.upsertConversation({
					...conversation,
					messages: next
				});
				return true;
			} catch {
				return false;
			}
		}
		function officialDeleteButtons() {
			return Array.from(document.querySelectorAll(OFFICIAL_MESSAGE_DELETE_SELECTOR));
		}
		function resolveTarget(button, fresh, buttonsAtClick, indexAtClick) {
			if (!button.isConnected || buttonsAtClick[indexAtClick] !== button) throw new Error("官方消息列表已变化，已取消删除，请刷新后重试。");
			const buttonsNow = officialDeleteButtons();
			if (!(buttonsNow.length === buttonsAtClick.length && buttonsNow.every((item, index) => item === buttonsAtClick[index])) || buttonsNow[indexAtClick] !== button) throw new Error("官方消息列表已变化，已取消删除，请刷新后重试。");
			if (buttonsNow.length !== fresh.length || indexAtClick < 0 || indexAtClick >= fresh.length) throw new Error("无法安全对应官方删除按钮与消息 ID，已取消删除，不会回退到官方截断。");
			return fresh[indexAtClick];
		}
		async function runMode(mode) {
			const anchor = state.anchor;
			closeMenu();
			if (!anchor || state.busy) return;
			const cid = readConversationId();
			if (!cid || cid.startsWith("conv__anonymous__")) return;
			state.cid = cid;
			const buttonsAtClick = officialDeleteButtons();
			const indexAtClick = buttonsAtClick.indexOf(anchor);
			if (indexAtClick < 0) {
				console.warn("[SichangTools] 官方消息列表已变化，已取消删除，请刷新后重试。");
				return;
			}
			const context = officialContext(anchor);
			const conversation = context?.activeConversation ?? null;
			const resolve = (fresh) => resolveTarget(anchor, fresh, buttonsAtClick, indexAtClick);
			setBusyIcon(anchor, true);
			try {
				const result = mode === "after" ? await applyDeleteAfter(resolve) : await applyDelete(resolve);
				if (!result) return;
				if (!result.ok) {
					console.warn(`[SichangTools] ${result.message}`);
					return;
				}
				if (syncOfficialPage(context, conversation, result.messages, result.targetId)) return;
				window.location.reload();
			} finally {
				setBusyIcon(anchor, false);
			}
		}
		function onOfficialDeleteClick(event) {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const option = target.closest(MODE_SELECTOR);
			if (option) {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				runMode(option.getAttribute("data-sichang-delete-mode") === "after" ? "after" : "one");
				return;
			}
			const button = target.closest(OFFICIAL_MESSAGE_DELETE_SELECTOR);
			if (!button) {
				if (state.menu && !target.closest(MENU_SELECTOR$1)) closeMenu();
				return;
			}
			const cid = readConversationId();
			if (!cid || cid.startsWith("conv__anonymous__")) return;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			if (state.busy) {
				console.warn("[SichangTools] 正在删除上一条消息，请稍后再试。");
				return;
			}
			if (state.menu && state.anchor === button) closeMenu();
			else openMenu(button);
		}
		function onMenuKeyDown(event) {
			if (event.key === "Escape" && state.menu) closeMenu();
		}
		window.addEventListener("click", onOfficialDeleteClick, { capture: true });
		window.addEventListener("keydown", onMenuKeyDown, true);
		window.addEventListener("scroll", closeMenu, true);
		window.addEventListener("resize", closeMenu);
		return {
			api: {},
			dispose: () => {
				window.removeEventListener("click", onOfficialDeleteClick, { capture: true });
				window.removeEventListener("keydown", onMenuKeyDown, true);
				window.removeEventListener("scroll", closeMenu, true);
				window.removeEventListener("resize", closeMenu);
				closeMenu();
				document.getElementById(MENU_STYLE_ID$1)?.remove();
				clearBusyIcons();
			}
		};
	}
	var COPY_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
    </svg>
`;
	function cloneTitle(title) {
		return `${title || "新对话"}${CLONE_TITLE_SUFFIX}`;
	}
	function createConversationClone() {
		const state = {
			busy: false,
			observer: null,
			timer: 0
		};
		let button = null;
		function findHeader() {
			for (const element of document.querySelectorAll(OFFICIAL_CHAT_HEADER_SELECTOR)) if (element.querySelector("button[aria-label=\"会话历史\"], button[title=\"会话历史\"]") && element.querySelector("button[aria-label=\"新建对话\"], button[title=\"新建对话\"]")) return element;
			return null;
		}
		function setBusy(busy) {
			state.busy = busy;
			if (!button) return;
			button.disabled = busy;
			setBusyIcon(button, busy);
		}
		function ensureButton() {
			if (button?.isConnected) {
				setBusy(state.busy);
				return;
			}
			const header = findHeader();
			if (!header) return;
			if (!canMutate(header)) return;
			const existing = header.querySelector(CLONE_BUTTON_SELECTOR);
			if (existing) {
				button = existing;
				setBusy(state.busy);
				return;
			}
			const source = header.querySelector(OFFICIAL_NEW_CHAT_SELECTOR);
			if (!source) return;
			const next = source.cloneNode(false);
			next.setAttribute("data-sichang-clone", "");
			next.setAttribute("aria-label", CLONE_BUTTON_LABEL);
			next.title = CLONE_BUTTON_LABEL;
			next.innerHTML = COPY_ICON;
			source.parentElement.insertBefore(next, source);
			button = next;
			setBusy(state.busy);
		}
		function scheduleEnsure() {
			if (state.timer) return;
			state.timer = window.setTimeout(() => {
				state.timer = 0;
				ensureButton();
			}, 120);
		}
		async function applyClone() {
			const sourceCid = readConversationId();
			if (!sourceCid) throw new Error("当前没有可克隆的会话。");
			const anchor = findHeader()?.querySelector(OFFICIAL_NEW_CHAT_SELECTOR);
			const context = anchor ? officialContext(anchor) : null;
			const { meta, messages } = await readConversationForCopy(sourceCid, context);
			return copyConversation({
				sourceCid,
				context,
				meta,
				messages,
				title: cloneTitle(meta.title)
			});
		}
		async function onCloneClick(event) {
			const target = event.target;
			if (!(target instanceof Element) || !target.closest("button[data-sichang-clone]")) return;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			if (state.busy) return;
			setBusy(true);
			try {
				const result = await applyClone();
				const path = `/chat/${encodeURIComponent(result.cid)}`;
				if (result.local) window.history.replaceState(null, "", path);
				else window.location.assign(path);
			} catch (error) {
				console.warn("[SichangTools] 克隆失败：", error);
			} finally {
				setBusy(false);
			}
		}
		ensureButton();
		document.addEventListener("click", onCloneClick, { capture: true });
		state.observer = new MutationObserver(scheduleEnsure);
		state.observer.observe(document.body, {
			childList: true,
			subtree: true
		});
		const unsubscribeSettled = onSettled(scheduleEnsure);
		return {
			api: {},
			dispose: () => {
				document.removeEventListener("click", onCloneClick, { capture: true });
				state.observer?.disconnect();
				state.observer = null;
				unsubscribeSettled();
				if (state.timer) window.clearTimeout(state.timer);
				state.timer = 0;
				button?.remove();
				button = null;
				clearBusyIcons();
			}
		};
	}
	var PLUS_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <path d="M5 12h14"></path>
        <path d="M12 5v14"></path>
    </svg>
`;
	var MENU_SELECTOR = "[data-sichang-add-menu]";
	var ROLE_SELECTOR = "[data-sichang-add-role]";
	var MENU_STYLE_ID = "sichang-add-bubble-style";
	var MENU_CSS = `
.sichang-add-menu {
    position: fixed;
    z-index: 2147483647;
    min-width: 132px;
    padding: 4px;
    border: 1px solid var(--border, rgba(127, 127, 127, .28));
    border-radius: 12px;
    background: var(--card, #fff);
    box-shadow: 0 10px 28px rgba(0, 0, 0, .18);
    color: var(--foreground, #111);
    font: inherit;
}
.sichang-add-menu button {
    display: block;
    width: 100%;
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    text-align: left;
    font-size: 13px;
    line-height: 1.2;
    cursor: pointer;
}
.sichang-add-menu button:hover { background: var(--muted, rgba(127, 127, 127, .15)); }
.sichang-add-menu button:disabled { opacity: .5; cursor: not-allowed; }
`;
	function deriveTitle(content) {
		const text = String(content || "").trim();
		return text ? `${text.slice(0, 30)}${text.length > 30 ? "…" : ""}` : "新对话";
	}
	function createAddBubble() {
		const state = {
			busy: false,
			observer: null,
			timer: 0,
			menu: null
		};
		let button = null;
		function setBusy(busy) {
			state.busy = busy;
			if (!button) return;
			button.disabled = busy;
			setBusyIcon(button, busy);
			for (const option of state.menu?.querySelectorAll(ROLE_SELECTOR) ?? []) option.disabled = busy;
		}
		function ensureMenuStyle() {
			if (document.getElementById(MENU_STYLE_ID)) return;
			const style = document.createElement("style");
			style.id = MENU_STYLE_ID;
			style.textContent = MENU_CSS;
			document.head.appendChild(style);
		}
		function closeMenu() {
			state.menu?.remove();
			state.menu = null;
		}
		function positionMenu() {
			if (!state.menu || !button?.isConnected) return;
			const rect = button.getBoundingClientRect();
			state.menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
			state.menu.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 8)}px`;
		}
		function openMenu() {
			ensureMenuStyle();
			if (state.menu) {
				positionMenu();
				return;
			}
			const menu = document.createElement("div");
			menu.setAttribute("data-sichang-add-menu", "");
			menu.className = "sichang-add-menu";
			menu.setAttribute("role", "menu");
			menu.innerHTML = `
            <button type="button" role="menuitem" data-sichang-add-role="user"${state.busy ? " disabled" : ""}>添加提问</button>
            <button type="button" role="menuitem" data-sichang-add-role="assistant"${state.busy ? " disabled" : ""}>添加回答</button>
        `;
			document.body.appendChild(menu);
			state.menu = menu;
			positionMenu();
		}
		function ensureButton() {
			if (button?.isConnected) {
				setBusy(state.busy);
				return;
			}
			const composer = findComposer();
			if (!composer?.send || !composer.row) return;
			if (!canMutate(composer.row)) return;
			const existing = composer.row.querySelector(ADD_BUBBLE_BUTTON_SELECTOR);
			if (existing) {
				button = existing;
				setBusy(state.busy);
				return;
			}
			const next = (composer.row.querySelector("button[aria-label=\"发送附件\"], button[title=\"发送附件\"]") || composer.send).cloneNode(false);
			next.setAttribute("data-sichang-add-bubble", "");
			next.setAttribute("aria-label", ADD_BUBBLE_BUTTON_LABEL);
			next.title = `${ADD_BUBBLE_BUTTON_LABEL}（选择提问或回答）`;
			next.setAttribute("aria-haspopup", "menu");
			next.innerHTML = PLUS_ICON;
			composer.send.parentElement.insertBefore(next, composer.send);
			button = next;
			setBusy(state.busy);
		}
		function scheduleEnsure() {
			if (state.timer) return;
			state.timer = window.setTimeout(() => {
				state.timer = 0;
				ensureButton();
				if (state.menu) {
					if (button?.isConnected) positionMenu();
					else closeMenu();
				}
			}, 120);
		}
		function readInput(textarea) {
			if (textarea.disabled) throw new Error("输入框当前不可用，请等页面初始化完成。");
			const content = String(textarea.value || "").trim();
			if (content.length > 2e4) throw new Error(`正文超过 ${CONVERSATION_IMPORT_MAX_CHARS} 字，官方导入接口会截断。`);
			return content;
		}
		async function addBubble(role) {
			const composer = findComposer();
			if (!composer?.send) throw new Error("AI 正在回复或输入区不可用，请等当前回复结束后再添加。");
			const content = readInput(composer.textarea);
			const cid = readConversationId();
			const owner = conversationOwner(cid);
			if (!cid || !owner) throw new Error("当前还没有云端会话，先正常发送一条消息创建会话。");
			if (owner === "anonymous") throw new Error("当前是未登录的本地对话，暂不支持写入消息。请登录后打开云端对话。");
			const [meta, messages] = await Promise.all([loadConversation(cid), loadMessages(cid)]);
			const title = !messages.length && role === "user" ? deriveTitle(content) : meta.title;
			const message = {
				id: `msg__${owner}__${newId()}`,
				seq: nextSeq(messages),
				role,
				content: messageText(content),
				createdAt: Date.now(),
				state: "complete"
			};
			if (!messages.length) try {
				await request(`/api/conversations/${encodeURIComponent(cid)}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ title })
				});
			} catch {}
			await importMessages(cid, {
				...meta,
				title
			}, [message]);
			const context = officialContext(composer.send);
			const conversation = context?.activeConversation;
			let synced = false;
			if (conversation && conversation.id === cid) try {
				context.upsertConversation({
					...conversation,
					title,
					messages: [...conversation.messages, { ...message }],
					updatedAt: message.createdAt
				});
				synced = true;
			} catch {}
			setNativeValue(composer.textarea, "");
			return synced;
		}
		async function runAdd(role) {
			closeMenu();
			if (state.busy) return;
			setBusy(true);
			try {
				if (!await addBubble(role)) window.location.reload();
			} catch (error) {
				console.warn(`[SichangTools] 添加消息失败：${errorMessage(error)}`);
			} finally {
				setBusy(false);
			}
		}
		function onAddClick(event) {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const option = target.closest(ROLE_SELECTOR);
			if (option) {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				runAdd(option.getAttribute("data-sichang-add-role") === "assistant" ? "assistant" : "user");
				return;
			}
			if (target.closest("button[data-sichang-add-bubble]")) {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				if (state.busy) return;
				if (state.menu) closeMenu();
				else openMenu();
				return;
			}
			if (state.menu && !target.closest(MENU_SELECTOR)) closeMenu();
		}
		function onMenuKeyDown(event) {
			if (event.key === "Escape" && state.menu) closeMenu();
		}
		ensureButton();
		document.addEventListener("click", onAddClick, { capture: true });
		window.addEventListener("keydown", onMenuKeyDown, true);
		window.addEventListener("scroll", closeMenu, true);
		window.addEventListener("resize", closeMenu);
		state.observer = new MutationObserver(scheduleEnsure);
		state.observer.observe(document.body, {
			childList: true,
			subtree: true
		});
		const unsubscribeSettled = onSettled(scheduleEnsure);
		return {
			api: {},
			dispose: () => {
				document.removeEventListener("click", onAddClick, { capture: true });
				window.removeEventListener("keydown", onMenuKeyDown, true);
				window.removeEventListener("scroll", closeMenu, true);
				window.removeEventListener("resize", closeMenu);
				closeMenu();
				document.getElementById(MENU_STYLE_ID)?.remove();
				state.observer?.disconnect();
				state.observer = null;
				unsubscribeSettled();
				if (state.timer) window.clearTimeout(state.timer);
				state.timer = 0;
				button?.remove();
				button = null;
			}
		};
	}
	var FORK_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="18" r="3"></circle>
        <circle cx="6" cy="6" r="3"></circle>
        <circle cx="18" cy="6" r="3"></circle>
        <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"></path>
        <path d="M12 12v3"></path>
    </svg>
`;
	function copyButtons() {
		return Array.from(document.querySelectorAll(OFFICIAL_COPY_SELECTOR));
	}
	function actionRowOf(copy) {
		return (copy?.parentElement)?.parentElement ?? null;
	}
	function createForkMessage() {
		const state = {
			busy: false,
			observer: null,
			timer: 0
		};
		function setBusy(busy, active = null) {
			state.busy = busy;
			for (const button of document.querySelectorAll(FORK_BUTTON_SELECTOR)) {
				button.disabled = busy;
				setBusyIcon(button, busy && button === active);
			}
		}
		function ensureButtons() {
			for (const copy of copyButtons()) {
				const span = copy.parentElement;
				const row = actionRowOf(copy);
				if (!span || !row || row.querySelector("button[data-sichang-fork]")) continue;
				if (!canMutate(row)) continue;
				const wrapper = span.cloneNode(true);
				const button = wrapper.querySelector("button");
				if (!button) continue;
				button.setAttribute("data-sichang-fork", "");
				button.setAttribute("aria-label", FORK_BUTTON_LABEL);
				button.title = FORK_BUTTON_LABEL;
				button.innerHTML = FORK_ICON;
				button.disabled = state.busy;
				row.insertBefore(wrapper, span);
			}
		}
		function scheduleEnsure() {
			if (state.timer) return;
			state.timer = window.setTimeout(() => {
				state.timer = 0;
				ensureButtons();
			}, 120);
		}
		async function forkAt(copy, index) {
			const cid = readConversationId();
			if (!cid) throw new Error("当前没有可复刻的会话。");
			const context = officialContext(copy);
			const conversation = context?.activeConversation;
			if (!conversation || conversation.id !== cid) throw new Error("无法读取官方当前会话，请等消息加载完成。");
			if (copyButtons().length !== conversation.messages.length || index < 0 || index >= conversation.messages.length) throw new Error("消息列表已变化，请等页面稳定后重试。");
			const target = conversation.messages[index];
			const source = await readConversationForCopy(cid, context);
			let fullIndex = source.messages.findIndex((message) => message.id === target.id);
			if (fullIndex < 0 && typeof target.seq === "number") fullIndex = source.messages.findIndex((message) => message.seq === target.seq);
			if (fullIndex < 0) throw new Error("在会话里找不到这条消息，请刷新后重试。");
			const messages = source.messages.slice(0, fullIndex + 1);
			const title = `${source.meta.title || "新对话"}（前${messages.length}条）`;
			return copyConversation({
				sourceCid: cid,
				context,
				meta: source.meta,
				messages,
				title
			});
		}
		async function onForkClick(event) {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const button = target.closest(FORK_BUTTON_SELECTOR);
			if (!button) return;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			if (state.busy || button.disabled) return;
			const copy = (button.parentElement?.parentElement)?.querySelector(OFFICIAL_COPY_SELECTOR);
			if (!copy) return;
			const index = copyButtons().indexOf(copy);
			setBusy(true, button);
			try {
				const result = await forkAt(copy, index);
				const path = `/chat/${encodeURIComponent(result.cid)}`;
				if (result.local) window.history.replaceState(null, "", path);
				else window.location.assign(path);
			} catch (error) {
				console.warn("[SichangTools] 复刻失败：", error);
			} finally {
				setBusy(false);
			}
		}
		ensureButtons();
		document.addEventListener("click", onForkClick, { capture: true });
		state.observer = new MutationObserver(scheduleEnsure);
		state.observer.observe(document.body, {
			childList: true,
			subtree: true
		});
		const unsubscribeSettled = onSettled(scheduleEnsure);
		return {
			api: {},
			dispose: () => {
				document.removeEventListener("click", onForkClick, { capture: true });
				state.observer?.disconnect();
				state.observer = null;
				unsubscribeSettled();
				if (state.timer) window.clearTimeout(state.timer);
				state.timer = 0;
				for (const button of document.querySelectorAll(FORK_BUTTON_SELECTOR)) button.parentElement?.remove();
				clearBusyIcons();
			}
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
			playbackRate: 1,
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
			host.syncGoButton();
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
			if (host.hasPendingInput() || host.isInputFocused()) return;
			applySelection(record, segment);
			host.setInputText(segment.text);
		}
		Object.assign(host, {
			applySelection,
			selectRecord,
			selectSegment,
			mirrorPlayingText
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
			inputText: () => host.getInputText(),
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
		adopt(createMessageDelete(host));
		adopt(createConversationClone());
		adopt(createAddBubble());
		adopt(createForkMessage());
		function syncPlaybackRateButton() {
			ui.rateCycle.textContent = `${host.playbackRate}×`;
			ui.rateCycle.title = `播放倍速 ${host.playbackRate}×（仅已下载音频）`;
			ui.rateCycle.setAttribute("aria-label", ui.rateCycle.title);
		}
		try {
			const savedRate = Number(localStorage.getItem(PLAYBACK_RATE_STORE_KEY));
			if (PLAYBACK_RATES.includes(savedRate)) host.playbackRate = savedRate;
		} catch {}
		syncPlaybackRateButton();
		ui.rateCycle.addEventListener("click", () => {
			const index = PLAYBACK_RATES.indexOf(host.playbackRate);
			host.playbackRate = PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length];
			try {
				localStorage.setItem(PLAYBACK_RATE_STORE_KEY, String(host.playbackRate));
			} catch {}
			syncPlaybackRateButton();
			for (const record of host.records) {
				for (const segment of record.segments) if (segment.audio) segment.audio.playbackRate = host.playbackRate;
				if (host.activeTimeline !== record) continue;
				if (record.state !== "playing" && record.state !== "paused") continue;
				const session = record.session;
				if (!session) continue;
				const position = host.livePosition(session);
				host.switchToChainAt(record, position, record.state === "playing");
			}
			if (host.activeAudio) host.activeAudio.playbackRate = host.playbackRate;
		});
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
			ui.dispose();
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
