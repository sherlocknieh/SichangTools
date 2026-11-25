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

## 开工流程

1. 定位：按文档地图找承载文件，只动相关文件。
2. 约定：改源码前读 `docs/conventions.md`。
3. 实现：能改现有 handler 就不新增文件。
4. 验证：`npm run build` 通过；行为在 `sichang.xyz` 聊天页实测。
5. 记录：变更同步到对应文档（功能 → `features/`，机制 → `logic/`，改版 → `known-issues.md`）。
6. 提交：`npm run release "<type>: <说明>"`。

## 自动提交

每轮对话后自行提交（除非只有单处微小细节改动）；仓库有发布脚本时走发布脚本，不先单独 `git commit`。

## 维护

目录、职责、命令变化时同步更新 `docs/` 并在本文件更新指针。
