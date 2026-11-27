// 面板挂载与折叠：等站点水合完成后嵌进官方输入卡片顶部，输入区被换掉后自动重新挂载。
// 只依赖面板 DOM 和 host 的输入绑定，不参与记录与播放逻辑。
import { FOLD_STORE_KEY } from './constants.js';
import { findComposer } from './official-page.js';

// React 水合完成前不要把面板插进它管理的 DOM：多出的节点会触发客户端重渲染，
// 连带清掉其它脚本挂在页面上的节点（例如 deepseek-web-toolkit 的消息导航）。
const HYDRATION_RETRY_MS = 200;
// fiber 一直不出现（非 React 页面/站点改版）时，load 后兜底等待这么久再强制挂载
const HYDRATION_FALLBACK_MS = 5000;

function hasReactFiber(element) {
    return Boolean(element)
        && Object.getOwnPropertyNames(element).some(key => key.startsWith('__reactFiber$'));
}

export function createPanelLayout(host) {
    const { ui } = host;

    function applyFold(folded, persist = true) {
        ui.panel.classList.toggle('folded', folded);
        ui.fold.textContent = folded ? '+' : '−';
        ui.fold.setAttribute('aria-label', folded ? '展开' : '收起');
        if (!persist) return;
        try {
            localStorage.setItem(FOLD_STORE_KEY, folded ? '1' : '0');
        } catch {}
    }
    // 合成开始自动展开面板，方便看到分段进度；这只是临时展开，不改用户记住的折叠状态
    function expandPanel() {
        applyFold(false, false);
    }
    ui.fold.addEventListener('click', () => applyFold(!ui.panel.classList.contains('folded')));
    // 默认收起；只有用户手动展开过（存了 0）才保持展开
    let savedFold = null;
    try {
        savedFold = localStorage.getItem(FOLD_STORE_KEY);
    } catch {}
    if (savedFold !== '0') applyFold(true);

    // 单击标题栏收起/展开；按钮和下拉不参与，避免误触
    ui.head.addEventListener('click', event => {
        if (event.target.closest('button, select')) return;
        applyFold(!ui.panel.classList.contains('folded'));
    });

    // 等水合完成后才挂进输入卡片；没有输入区（例如会话列表页）时保持不挂载
    let hydrationFallback = false;
    let retryTimer = 0;
    function scheduleRetry() {
        if (retryTimer) return;
        retryTimer = window.setTimeout(() => {
            retryTimer = 0;
            placePanel();
        }, HYDRATION_RETRY_MS);
    }

    function placePanel() {
        const composer = findComposer();
        if (!composer) {
            ui.host.remove();
            return;
        }
        const { container, textarea } = composer;
        const hydrated = hasReactFiber(container) && hasReactFiber(textarea);
        // readyState 结束前即使 fiber 已经挂上，也可能仍有子树在排队水合；完成后才动手
        if (!hydrationFallback && (document.readyState !== 'complete' || !hydrated)) {
            ui.host.remove();
            scheduleRetry();
            return;
        }
        // 水合或切换会话可能换掉整张输入卡片；不在当前卡片最前面就重新插回去
        if (ui.host.parentElement !== container || container.firstElementChild !== ui.host) {
            container.insertBefore(ui.host, container.firstChild);
        }
        host.bindInput(textarea);
    }

    // 输入区随时会被 React 重渲染；合并成一次延迟检查，不轮询
    let timer = 0;
    function schedulePlace() {
        if (timer) return;
        timer = window.setTimeout(() => {
            timer = 0;
            placePanel();
        }, 120);
    }
    const observer = new MutationObserver(schedulePlace);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // 站点改版或非 React 页面上 fiber 可能一直不出现；页面加载完再兜底一段时间后照常挂载
    let fallbackTimer = 0;
    function armFallback() {
        fallbackTimer = window.setTimeout(() => {
            hydrationFallback = true;
            placePanel();
        }, HYDRATION_FALLBACK_MS);
    }
    if (document.readyState === 'complete') armFallback();
    else window.addEventListener('load', armFallback, { once: true });

    placePanel();

    return {
        api: { applyFold, expandPanel, placePanel },
        dispose: () => {
            observer.disconnect();
            if (timer) window.clearTimeout(timer);
            if (retryTimer) window.clearTimeout(retryTimer);
            window.clearTimeout(fallbackTimer);
            window.removeEventListener('load', armFallback);
        },
    };
}
