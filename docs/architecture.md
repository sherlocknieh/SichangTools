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
    panel-layout.js    # 挂载到官方输入卡片顶部、折叠与重渲染后重新挂载
    compose.js         # 读写官方输入框文字、合成/暂停入口
    record-view.js     # 记录条目与分段条目的 DOM、折叠、菜单、下载、删除
    segments.js        # 分段状态/时长/行内进度条与按钮可用性
    chain.js           # 分段顺序播放与记录头播放按钮
    timeline.js        # 实时时间线：边下边播、暂停继续、跳转
    playback-bar.js    # 顶栏播放控件：有声音时显示播放/暂停与倍速
    synthesis.js       # 流式分段合成与 /api/tts 接管
    regenerate.js      # 单段/整条重生成流程（整条复用逐段流程）
    conversation-api.js # 官方会话接口共享封装：读取、import、错误文案
    conversation-copy.js # 会话复制：云端/匿名接口复制与本地回退
    official-page.js   # 官方 React context、输入区定位与受控输入工具
    hydration.js       # 站点水合门禁：React 水合完成前不往 React 管理的 DOM 插节点
    busy-icon.js       # 共享「操作中」按钮动画：旋转箭头
    delete-message.js  # 接管官方删除按钮：菜单选择单条删除或删后续，同步官方视图
    clone-conversation.js # 顶栏「克隆会话」按钮：新建副本并导入全部消息
    add-bubble.js      # 加号添加/插入消息：输入区旁追加、每条消息操作行在下方插入
    fork-message.js    # 每条消息的 fork 按钮：复刻会话到该条为止
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
  - 模块统一导出 `createX(host)`，返回 `{ api, dispose }`；handler 用 `adopt()` 合并到 `host`，创建顺序为 compose → record-view → segments → chain → timeline → playback-bar → regenerate → synthesis → panel-layout → delete-message → clone-conversation → add-bubble → fork-message。跨模块调用一律 `host.fn()`，共享状态读写 `host.records` 等字段。
  - `panel.js` / `panel-layout.js`：面板骨架与挂载/折叠；面板嵌在官方输入卡片顶部，等 React 水合完成（`hydration.js` 的 `canMutate()` 放行）后才插入，输入区被水合或切会话替换后由 `findComposer()` 重新挂载，不碰记录和播放状态。
  - `compose.js`：把语音面板接到官方 textarea 上（`bindInput`/`getInputText`/`setInputText`）并管理「合成/暂停」入口；选中、播放跟随和重生成共用这一份文字，不再维护独立草稿。
  - `record-view.js`：记录条目与分段条目的 DOM、记录折叠、菜单、下载、删除。
  - `segments.js`：分段状态文案、时长进度、行内进度条与按钮可用性。
  - `chain.js`：分段顺序播放（自动接段、等待下一段）与记录头整条播放按钮。
  - `timeline.js`：实时时间线的 Web Audio 调度、暂停继续与跳转。
  - `playback-bar.js`：标题栏的统一播放控件。扫描 `host.records` 找出正在出声或停在原位的播放（顺序播放的 `<audio>` 优先于实时时间线/合成流），据此显示「暂停/继续播放」和倍速按钮；暂停/继续分别转调 chain 或 timeline 的对应函数，不自己保存播放状态。空闲时两个按钮都隐藏。
  - `synthesis.js`：按句分段请求 `/api/tts`、边收边播、整条 WAV 落盘与 `fetch` 接管。
  - `regenerate.js`：单段重生成与整条重生成流程；整条重生成原地复用逐段流程，不新建记录。记录/播放/UI 的读写通过 `createRegenerator(host)` 注入。
  - `delete-message.js`：在 `window` 捕获阶段接管官方「删除消息」按钮，先弹「删除本条 / 删除后续（走官方）」菜单，不再直接触发官方原生删除，按官方消息文档顺序安全映射消息 ID。单条删除用「从目标消息 DELETE 截断 + `/api/conversations/import` 补回尾部」，删后续直接走官方 DELETE 截断；重导入会丢掉 variants/thinking/图片建议/网页来源/附件。删除成功后通过官方 React context 的 `upsertConversation` 写回剩余消息，让官方页面立即更新；拿不到官方状态时回退整页刷新。映射不确定或操作失败时不回退官方删除，匿名/本地对话不拦截。接口契约、恢复流程和 React 同步细节见 `logic/message-delete.md`。
  - `conversation-api.js`：官方会话接口的共享封装（`readConversationId`、读取元数据与分页消息、`createConversation`、`importMessages`、`errorMessage`）。删除、克隆与 fork 都走这一份契约，站点改版时只改这里。
  - `conversation-copy.js`：会话复制实现，整条克隆与消息级 fork 共用；负责空正文占位、新 ID/seq、写入校验、失败清理，以及匿名/本地接口不可达时退回官方 context 写 IndexedDB。
  - `clone-conversation.js`：在官方聊天页顶栏「新建对话」左侧注入「克隆会话」按钮；读取当前会话（云端或匿名）的元数据和全部消息，经 `conversation-copy.js` 新建副本。成功后进入副本，失败只写控制台。实现与接口细节见 `logic/conversation-clone.md`。
  - `official-page.js`：官方 React 页面的共享工具（从 DOM fiber 找 context、`findComposer()` 定位输入卡片、通过原生 setter 改受控 textarea）。删除、加气泡和语音面板共用。
  - `hydration.js`：站点水合门禁。`canMutate(element)` 判断目标节点是否已经水合完成（`readyState === 'complete'` 且有 `__reactFiber$`），`onSettled(cb)` 在水合完成或 5 秒兜底放行后回调一次。面板、加号、克隆和 fork 按钮的插入都先过这里，避免水合期多出的节点让 React 整页重渲染、清掉其它脚本挂的节点。
  - `busy-icon.js`：共享的操作中按钮动画。通过 `data-sichang-busy` 和伪元素把按钮内容替换成旋转箭头，删除、加气泡、克隆和 fork 共用。
  - `add-bubble.js`：注入两个加号入口：官方输入区「发送消息」左侧的加号把输入框文字追加到会话末尾；每条消息操作行里的加号把文字插入到该条消息下方。两者都弹出「添加提问 / 添加回答」，不请求 AI 回复；云端会话走 import，匿名本地会话的插入走官方 context 的 `deleteFrom` + `addMessage` 写 IndexedDB。插入中间位置时先截断原尾部，再写回新消息和重排后的尾部。写入成功后立即更新气泡并清空输入框。细节见 `logic/add-bubble.md`。
  - `fork-message.js`：在每条官方消息的操作行注入 fork 按钮；按按钮文档顺序映射到消息，截取到该条为止后复用 `conversation-copy.js` 新建副本。映射数量不一致时安全拒绝。细节见 `logic/fork-message.md`。
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
