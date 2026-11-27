# 架构与文件职责

用户脚本由 `src/main.js` 初始化 handler，各模块直接操作页面 DOM；没有框架、没有状态管理库，也没有常驻后台，跨模块状态集中在 handler 的 `host` 对象上。

## 入口与生命周期

- `src/main.js` 是唯一运行入口，只初始化思畅 handler。
- handler 的初始化函数返回清理函数，入口把它们登记进 `disposers`，重复注入时按注册逆序执行清理。
- 入口把清理函数挂到 `unsafeWindow.__USERSCRIPT_TEARDOWN__`；脚本管理器重新执行同一份脚本时先调用它，避免监听器、注入节点和 `fetch` 包装叠加成多份。
- `runtime.initialized` 只表示当前是否已初始化，重复调用 `initialize()` 会先 `dispose()` 再重建。

## 目录与职责

入口层只放生命周期与站点装配：`main.js` 管重复注入与清理，`handler.js` 管思畅的 `host` 与模块接线；具体功能模块按站点收在 `sichang/` 下。

```text
src/
  main.js              # 唯一入口：注册 handler、登记清理、处理重复注入
  handler.js           # 装配：共享状态、选中逻辑、模块接线与清理
  sichang/             # 思畅站点的功能模块
    panel.js           # 面板骨架（Shadow DOM）与剪贴板兜底
    panel-layout.js    # 折叠、拖动、贴底避让与窗口尺寸变化
    compose.js         # 输入区：草稿、预填试听、合成/暂停入口
    record-view.js     # 记录条目与分段条目的 DOM、折叠、菜单、下载、删除
    segments.js        # 分段状态/时长/展开面板与按钮可用性
    chain.js           # 分段顺序播放与记录头播放按钮
    timeline.js        # 实时时间线：边下边播、暂停继续、跳转
    synthesis.js       # 流式分段合成与 /api/tts 接管
    regenerate.js      # 单段/整条重生成流程（整条复用逐段流程）
    tts.js             # 单段一次性 TTS 请求（重生成用）
    text.js            # 文本切分与展示格式化（纯函数）
    constants.js       # 接口路径、分段阈值、localStorage key
    voices.js          # 音色列表
    styles.js          # 面板样式（PANEL_CSS）
    audio.js           # PCM16/WAV 转换与拼接（纯函数）
```

- `src/main.js`：入口；注册 handler、登记清理函数、处理重复注入。
- `src/handler.js`：放在入口同层的装配层，判断 `sichang.xyz` 域名后创建 `host`（记录、选中、正在播放的音频/会话/时间线等共享状态），登记选中逻辑与各模块；清理时逆序撤销监听器与 `fetch` 包装。接管与播放行为见 `features/sichang.md`，机制见 `logic/pcm-stream-capture.md`。
- `src/sichang/`：按职责分文件，改哪块只读哪块。新增功能先判断属于哪个已有模块，不要往 handler 里堆。
  - 模块统一导出 `createX(host)`，返回 `{ api, dispose }`；handler 用 `adopt()` 合并到 `host`，创建顺序为 compose → record-view → segments → chain → timeline → regenerate → synthesis → panel-layout。跨模块调用一律 `host.fn()`，共享状态读写 `host.records` 等字段。
  - `panel.js` / `panel-layout.js`：面板骨架与位置/折叠，不碰记录和播放状态。
  - `compose.js`：输入区草稿、预填试听与「合成/暂停」入口。
  - `record-view.js`：记录条目与分段条目的 DOM、记录折叠、菜单、下载、删除。
  - `segments.js`：分段状态文案、时长进度、展开面板与按钮可用性。
  - `chain.js`：分段顺序播放（自动接段、等待下一段）与记录头整条播放按钮。
  - `timeline.js`：实时时间线的 Web Audio 调度、暂停继续与跳转。
  - `synthesis.js`：按句分段请求 `/api/tts`、边收边播、整条 WAV 落盘与 `fetch` 接管。
  - `regenerate.js`：单段重生成与整条重生成流程；整条重生成原地复用逐段流程，不新建记录。记录/播放/UI 的读写通过 `createRegenerator(host)` 注入。
  - `tts.js`：重生成用的一次性分段请求，负责读完整条 PCM16、丢弃多出的半采样并返回采样率。
  - `text.js`：分段（`splitText`/`splitInHalf`）、预览与时长格式化，纯函数。
  - `constants.js`：接口路径 `TTS_PATH`、分段阈值、`localStorage` key 等契约常量。
  - `voices.js`：站点音色列表 `VOICE_GROUPS`、`VOICE_LABELS` 与短名称 `voiceName`。
  - `styles.js`：面板 `PANEL_CSS`，Shadow DOM 里注入的全部样式。
  - `audio.js`：PCM16/WAV 转换与拼接（`pcmToWav`、`pcmToSamples`、`joinedPcm`），纯函数。
- `vite.config.js`：userscript 元数据、匹配域名与构建产物配置；`@icon` 直接指向站点 favicon（`https://sichang.xyz/favicon.ico`），不在仓库里维护本地图标资源。
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
