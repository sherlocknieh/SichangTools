# 已知坑

现象 → 原因 → 规避方式。遇到新的站点改版或环境问题，先在这里追加，再改代码。

## 脚本装了却完全没反应

**现象**：开发时 `npm run dev` 已启动、管理器里也看到了脚本，但目标页没有任何效果，控制台报 `violates the following Content Security Policy directive` 或 `Refused to load the script`。

**原因**：目标站点的 CSP 拦掉 `localhost:5173` 注入，脚本根本没执行。

**规避**：按 `development.md` 的说明，把 userscript-dev 技能里的 `dev-kit.mjs` 拷到 `.dev/`，用「拉取构建产物再注入」的方式调试；构建产物写 `.dev/build/`，不动要提交的 `dist/`。

## 热更新后出现两份面板

**现象**：改一次源码，页面上出现两套面板，或朗读请求被接管两次导致递归。

**原因**：脚本管理器重新执行同一份脚本时，上一轮的监听器、注入节点和 `fetch` 包装还在。

**规避**：入口通过 `unsafeWindow.__USERSCRIPT_TEARDOWN__` 拆除上一轮再初始化；handler 必须返回清理函数并还原 `window.fetch`。

## 面板失败或没有声音

**现象**：点击朗读或「合成」后提示失败，或完全无声。

**原因**：站点接口变化。先看 Network 里的 `/api/tts`：路径、请求体字段、`X-Sample-Rate` 头或音频格式任一变化都会失效。

**规避**：按 `features/sichang.md` 的「接口契约」逐项核对；只改 handler 顶部的常量，不要把新契约散落到业务代码里。

## 扩展面板里脚本图标变成白球

**现象**：部分脚本管理器的面板把图标整体刷白，黑圆白字只剩白圆。

**原因**：不透明黑圆被反色或滤镜处理，字母与圆一起变白。

**规避**：`src/assets/icon.js` 的圆填充留 25% 透明，靠透明度差异保住字母。

## 实时播放换速会变调

**现象**：合成还没播完时切换播放倍速，人声音高跟着一起变。

**原因**：实时时间线用 Web Audio 的 `AudioBufferSourceNode.playbackRate`，它没有 `preservesPitch`；保音高只有 `<audio>` 能做，但 `<audio>` 播不了还在到达的 PCM 流。

**规避**：需要保音高时，等整条合成结束、按钮变成「播放」后再用面板 WAV 或分段试听；实时播放的倍速按变调处理。
