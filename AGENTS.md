# SichangTools

Vite 构建的浏览器用户脚本（原生 ES modules，无框架），接管思畅 AI 的朗读请求；产物 `dist/sichang-tools.user.js`。

## 文档地图

| 要知道什么 | 去哪里 |
| --- | --- |
| 目录、文件职责、入口生命周期 | `docs/architecture.md` |
| 改代码的写法约定（handler、清理、注释） | `docs/conventions.md` |
| 开发环境、热更新、版本号与发布机制 | `docs/development.md` |
| 站点改版、选择器失效、脚本不生效 | `docs/known-issues.md` |
| 功能行为与接口契约 | `docs/features/sichang.md` |
| 接管与流式播放机制 | `docs/logic/pcm-stream-capture.md` |
| 单条删除实现、官方 API 与即时同步 | `docs/logic/message-delete.md` |
| 会话克隆实现、顶栏入口与接口组合 | `docs/logic/conversation-clone.md` |
| 手动添加消息气泡与即时同步 | `docs/logic/add-bubble.md` |
| 消息级复刻（fork）与位置映射 | `docs/logic/fork-message.md` |

## 开工流程

1. 定位：按文档地图找承载文件，只动相关文件。
2. 约定：改源码前读 `docs/conventions.md`。
3. 实现：按职责改 `src/sichang/` 下对应模块，`src/handler.js` 只做装配；确需新模块时用 `createX(host)` 注入共享状态并在 handler 里登记。
4. 验证：`npm run build` 通过；真机验证（开浏览器、打开 `sichang.xyz`、点击面板）先弹窗问用户，同意后再做。
5. 记录：变更同步到对应文档（功能 → `features/`，机制 → `logic/`，改版 → `known-issues.md`）。
6. 提交：`npm run release "<type>: <说明>"`。

## 调试约定

- 不要自行启动浏览器调试：改完代码只用 `npm run build`、静态检查等命令验证。
- 启动浏览器、打开目标站点，或对已共享页面做 reload、点击、输入、截图，都必须先弹窗询问；简单的视觉变化交给用户自己看。
- 用户同意后按 `docs/development.md` 的方式调试，产物只写 `.dev/build/`，不动 `dist/`。

## 自动提交

每轮对话后自行提交（除非只有单处微小细节改动）；仓库有发布脚本时走发布脚本，不先单独 `git commit`。

## 维护

目录、职责、命令变化时同步更新 `docs/` 并在本文件更新指针。
