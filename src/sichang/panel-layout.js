// 面板挂载与折叠：嵌进官方输入卡片顶部，输入区被水合/切会话换掉后自动重新挂载。
// 只依赖面板 DOM 和 host 的输入绑定，不参与记录与播放逻辑。
import { FOLD_STORE_KEY } from './constants.js';
import { findComposer } from './official-page.js';

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

    // 没有输入区（例如会话列表页）就整块隐藏，等聊天页渲染出来再挂载
    function placePanel() {
        const composer = findComposer();
        if (!composer) {
            ui.host.style.display = 'none';
            return;
        }
        ui.host.style.display = 'block';
        const { container, textarea } = composer;
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

    placePanel();

    return {
        api: { applyFold, expandPanel, placePanel },
        dispose: () => {
            observer.disconnect();
            if (timer) window.clearTimeout(timer);
        },
    };
}
