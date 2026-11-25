import initSichangHandler from './handlers/sichang.js';

// handler 返回清理函数，这里统一登记；热更新或重复注入时按逆序执行
const disposers = [];
const runtime = { initialized: false };

function run(init) {
    const cleanup = init();
    if (typeof cleanup === 'function') disposers.push(cleanup);
}

function dispose() {
    for (const cleanup of disposers.splice(0).reverse()) {
        try {
            cleanup();
        } catch (error) {
            console.warn('[SichangTools] 清理失败', error);
        }
    }
    runtime.initialized = false;
}

function initialize() {
    if (runtime.initialized) dispose();
    runtime.initialized = true;
    run(initSichangHandler);
}

// 脚本管理器重新执行同一份脚本时，先拆掉上一轮的监听器和注入节点，
// 否则热更新会叠加出多份面板和 fetch 包装，形成递归接管
const host = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
if (typeof host.__USERSCRIPT_TEARDOWN__ === 'function') host.__USERSCRIPT_TEARDOWN__();
initialize();
host.__USERSCRIPT_TEARDOWN__ = dispose;
