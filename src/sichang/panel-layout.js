// 面板的位置与折叠：贴底避让站点输入框、拖动、双击复位、窗口尺寸变化。
// 只依赖面板 DOM 和两个外部回调（关菜单、输入框长高），不参与记录与播放逻辑。
import { FOLD_STORE_KEY, POS_STORE_KEY } from './constants.js';

export function createPanelLayout(host) {
    const { ui } = host;

    function applyFold(folded) {
        ui.panel.classList.toggle('folded', folded);
        ui.fold.textContent = folded ? '+' : '−';
        ui.fold.setAttribute('aria-label', folded ? '展开' : '收起');
        try {
            localStorage.setItem(FOLD_STORE_KEY, folded ? '1' : '0');
        } catch {}
        if (!folded) host.autoGrowInput();
    }
    ui.fold.addEventListener('click', () => applyFold(!ui.panel.classList.contains('folded')));
    try {
        if (localStorage.getItem(FOLD_STORE_KEY) === '1') applyFold(true);
    } catch {}

    // 手动拖过的位置优先于自动避让；双击标题复位后恢复自动贴底
    let manualPosition = false;
    function clampPosition(left, top) {
        const rect = ui.host.getBoundingClientRect();
        return {
            left: Math.max(4, Math.min(window.innerWidth - rect.width - 4, left)),
            top: Math.max(4, Math.min(window.innerHeight - rect.height - 4, top)),
        };
    }
    function applyPosition(position) {
        ui.host.style.left = `${Math.round(position.left)}px`;
        ui.host.style.top = `${Math.round(position.top)}px`;
        ui.host.style.right = 'auto';
        ui.host.style.bottom = 'auto';
    }
    function resetPosition() {
        manualPosition = false;
        try {
            localStorage.removeItem(POS_STORE_KEY);
        } catch {}
        ui.host.style.left = '';
        ui.host.style.top = '';
        ui.host.style.right = '16px';
        ui.host.style.bottom = '16px';
        placePanel();
    }

    // 站点把输入框钉在底部，300 宽的面板会正好盖住发送按钮；
    // 检测到贴底输入框时把面板抬到它上方，没有输入框的页面维持 16px
    function placePanel() {
        if (manualPosition) return;
        const box = [...document.querySelectorAll('textarea, [contenteditable="true"]')].find(element => {
            const rect = element.getBoundingClientRect();
            return rect.width > 160 && rect.bottom > window.innerHeight - 160;
        });
        const bottom = box ? Math.max(16, window.innerHeight - box.getBoundingClientRect().top + 12) : 16;
        ui.host.style.bottom = `${Math.round(bottom)}px`;
    }

    try {
        const saved = JSON.parse(localStorage.getItem(POS_STORE_KEY) || 'null');
        if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
            applyPosition(clampPosition(saved.left, saved.top));
            manualPosition = true;
        }
    } catch {}
    placePanel();

    // 拖动标题栏移动面板，单击收起/展开，双击复位；按钮和下拉不参与，避免误触
    let drag = null;
    let ignoreClick = false;
    ui.head.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target.closest('button, select')) return;
        const rect = ui.host.getBoundingClientRect();
        drag = {
            dx: event.clientX - rect.left,
            dy: event.clientY - rect.top,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
        };
        ui.head.setPointerCapture(event.pointerId);
        ui.panel.classList.add('dragging');
    });
    ui.head.addEventListener('pointermove', event => {
        if (!drag) return;
        // 抖动几个像素不算拖动，否则单击永远到不了 click
        if (!drag.moved) {
            const distance = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
            if (distance < 6) return;
            drag.moved = true;
        }
        applyPosition(clampPosition(event.clientX - drag.dx, event.clientY - drag.dy));
    });
    function endDrag() {
        if (!drag) return;
        const moved = drag.moved;
        drag = null;
        ui.panel.classList.remove('dragging');
        if (!moved) return;
        // 拖动结束后浏览器仍可能补一个 click，别让它把面板折叠掉
        ignoreClick = true;
        setTimeout(() => { ignoreClick = false; }, 0);
        manualPosition = true;
        const rect = ui.host.getBoundingClientRect();
        try {
            localStorage.setItem(POS_STORE_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
        } catch {}
    }
    ui.head.addEventListener('pointerup', endDrag);
    ui.head.addEventListener('pointercancel', endDrag);
    ui.head.addEventListener('click', event => {
        if (event.target.closest('button, select')) return;
        if (ignoreClick) {
            ignoreClick = false;
            return;
        }
        applyFold(!ui.panel.classList.contains('folded'));
    });
    ui.head.addEventListener('dblclick', event => {
        if (event.target.closest('button, select')) return;
        resetPosition();
    });

    const onResize = () => {
        if (!manualPosition) {
            placePanel();
            return;
        }
        const rect = ui.host.getBoundingClientRect();
        applyPosition(clampPosition(rect.left, rect.top));
    };
    window.addEventListener('resize', onResize);

    return {
        api: { applyFold, placePanel, resetPosition },
        dispose: () => window.removeEventListener('resize', onResize),
    };
}
