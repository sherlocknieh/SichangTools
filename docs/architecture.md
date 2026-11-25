# 架构与文件职责

用户脚本由 `src/main.js` 初始化 handler，handler 直接操作页面 DOM；没有框架、没有状态管理，也没有常驻后台。

## 入口与生命周期

- `src/main.js` 是唯一运行入口，只初始化思畅 handler。
- handler 的初始化函数返回清理函数，入口把它们登记进 `disposers`，重复注入时按注册逆序执行清理。
- 入口把清理函数挂到 `unsafeWindow.__USERSCRIPT_TEARDOWN__`；脚本管理器重新执行同一份脚本时先调用它，避免监听器、注入节点和 `fetch` 包装叠加成多份。
- `runtime.initialized` 只表示当前是否已初始化，重复调用 `initialize()` 会先 `dispose()` 再重建。

## 目录与职责

一个站点一个目录，入口与它的依赖放在一起；`main.js` 只做装配。

```text
src/
  main.js              # 唯一入口：注册 handler、登记清理、处理重复注入
  sichang/             # 思畅站点实现的全部代码
    handler.js         # 接管 /api/tts、面板、播放与分段
    constants.js       # 接口路径、分段阈值、localStorage key、倍速
    voices.js          # 音色列表
    styles.js          # 面板样式（PANEL_CSS）
    audio.js           # PCM16/WAV 转换与拼接（纯函数）
  assets/
    icon.js            # 脚本图标 SVG
```

- `src/main.js`：入口；注册 handler、登记清理函数、处理重复注入。
- `src/sichang/handler.js`：判断 `sichang.xyz` 域名后接管 `/api/tts`；按句分段合成、边下边播，并把各段 PCM16 合并成 WAV 供面板试听与下载。面板也可直接输入文本发起同一流程，支持播放倍速、实时播放暂停/继续/跳转、分段试听与单段重生成，并区分「下载完成」与「时间线播完」。详见 `features/sichang.md`，机制见 `logic/pcm-stream-capture.md`。
- `src/sichang/` 其余文件：handler 的无状态依赖，按职责分文件，改哪块只读哪块。
  - `constants.js`：接口路径 `TTS_PATH`、分段阈值、`localStorage` key、播放倍速等契约常量。
  - `voices.js`：站点音色列表 `VOICE_GROUPS` 与 `VOICE_LABELS`。
  - `styles.js`：面板 `PANEL_CSS`，Shadow DOM 里注入的全部样式。
  - `audio.js`：PCM16/WAV 转换与拼接（`pcmToWav`、`pcmToSamples`、`joinedPcm`），纯函数。
- `src/assets/icon.js`：脚本图标 SVG；黑圆白字，圆的填充留 25% 透明（原因见 `known-issues.md`）。
- `vite.config.js`：userscript 元数据、匹配域名与构建产物配置。
- `dist/sichang-tools.user.js`：构建产物，由构建脚本生成。
- `.dev/`：开发构建相关代码。
  - `bump-and-build.mjs`：升版本 + 构建，提交前钩子调用。
  - `release.mjs`：发布（升版本 → 构建 → commit → tag → push）。
  - `githooks/pre-commit`：提交前自动升版本 + 构建并 `git add vite.config.js dist`。
  - `build/`：调试构建产物，已在 `.gitignore` 中。

## 受支持的站点

只匹配 `https://sichang.xyz/*`。匹配列表写在 `vite.config.js`，handler 内再用 `window.location.hostname` 兜底判断。

## 构建、版本与发布

机制细节见 `development.md`（开发环境、热更新、CSP 调试、版本号规则），此处只记边界：

- `vite.config.js` 的 `userscript.version` 由 `.dev/bump-and-build.mjs` 按本地时间写入，格式 `YYYY.MM.DD.HHmm`。
- `npm run build` 只构建；`npm run release "<msg>"` 升版本、构建、commit、tag、push。
- 源码、版本号与 `dist/sichang-tools.user.js` 始终在同一个提交里。
