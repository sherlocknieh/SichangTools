# 会话克隆：实现与接口

对应代码：`src/sichang/clone-conversation.js`，复制实现抽在 `conversation-copy.js`，官方接口封装在 `conversation-api.js`。这份文档记录入口、接口组合、校验和失败清理；站点改版时先核对这里。

## 结论

官方没有“克隆会话”接口。脚本用两个官方接口组合出副本：

1. `GET /api/conversations/{id}` 读取会话元数据；
2. `GET /api/conversations/{id}/messages` 分页读取全部消息；
3. `POST /api/conversations` 用新 ID 建一条空会话；
4. `POST /api/conversations/import` 把消息换成新 ID、重排 `seq` 后导入；
5. 重新 `GET` 副本消息校验条数、角色和正文。

匿名 `conv__anonymous__` 会话同样按普通会话处理：服务端接受创建和导入匿名前缀的会话，统一走 `create + import`，不再退回本地复制。成功后整页进入副本；任一步失败时删除刚建的副本，原会话不变，失败信息只写控制台。

## 入口与顶栏按钮

选择器集中在 `src/sichang/constants.js`：

```js
export const OFFICIAL_CHAT_HEADER_SELECTOR = 'div.h-14';
export const OFFICIAL_HEADER_HISTORY_SELECTOR = 'button[aria-label="会话历史"], button[title="会话历史"]';
export const OFFICIAL_NEW_CHAT_SELECTOR = 'button[aria-label="新建对话"], button[title="新建对话"]';
export const CLONE_BUTTON_SELECTOR = 'button[data-sichang-clone]';
```

- 顶栏是同时含「会话历史」和「新建对话」的 `div.h-14`，侧栏的新建对话不在其中。
- 按钮复制官方「新建对话」按钮的 class，再插入它左侧，随站点主题/尺寸自动变化；图标是内联 SVG，`aria-label`/`title` 都是「克隆会话」。
- 点击用文档级委托，React 重绘换掉按钮节点后仍能收到事件。
- 克隆期间按钮加上 `data-sichang-busy`（共享 `busy-icon.js`），原图标替换成旋转箭头并禁用，避免重复提交。
- 官方是 Next.js SPA，切会话或窗口变化会重绘顶栏并移除脚本节点；脚本用 `MutationObserver` 监听 `document.body` 的 childList，去抖 120ms 后补插，不做轮询。
- `dispose` 断开 observer、清定时器并移除按钮。

## 官方接口组合

`conversation-api.js` 是删除、克隆、fork 共用的封装：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/conversations/{conversationId}` | 读取标题、scope、characterId、model、webSearch/reasoning、createdAt |
| `GET` | `/api/conversations/{conversationId}/messages?limit=500&before=` | 按 `prevCursor` 向前翻页读取全部消息 |
| `POST` | `/api/conversations` | 新建空会话，返回 201 |
| `POST` | `/api/conversations/import` | 向会话追加消息；对已存在会话只增不改不删 |
| `DELETE` | `/api/conversations/{conversationId}` | 失败时删除半成品副本 |

`POST /api/conversations` 请求体：

```json
{
  "id": "conv__<owner>__<newId>",
  "title": "原标题（副本）",
  "model": "gemma-4-uncensored",
  "scope": "general",
  "characterId": null,
  "createdAt": 1700000000000,
  "webSearch": false,
  "reasoning": false
}
```

`webSearch`/`reasoning` 只在元数据里是布尔值时发送。

import 请求体沿用迁移格式，每条消息只带 `id/seq/role/model/content/createdAt/state`；`state` 固定 `complete`。模块按 `CONVERSATION_IMPORT_BATCH`（400）分批。

## ID 生成

官方前端生成 ID 的格式是：

```js
`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
```

会话 ID 为 `conv__<owner>__<newId>`，消息 ID 为 `msg__<owner>__<newId>`。克隆时：

- 从源会话 ID 中取 `owner`（`conv__` 与最后一个 `__` 之间的部分），匿名会话就是 `anonymous`；
- 副本生成全新的 `newId`，消息也逐条生成新 ID，避免与原会话 ID 冲突；
- 消息 `seq` 从 0 连续重排，保证导入顺序。

## 校验与失败清理

克隆前拒绝：

- 没有会话 ID；
- 没有任何消息；
- 消息数超过 `CONVERSATION_IMPORT_MAX_MESSAGES`（500）；
- 任一条正文超过 `CONVERSATION_IMPORT_MAX_CHARS`（20000 字）。

空正文不再拒绝：官方 import 会跳过空字符串，`conversation-copy.js` 用零宽空格（`\u200B`）占位，保证气泡仍能复制。

**没有确认框**：点击即执行。分支变体、思考、网页来源不会复制；图片和附件不会作为官方结构复制，但会把地址以 Markdown 追加到正文（见下节）。

写入后重新读取副本，逐条比对 `content` 与 `role`，条数也必须一致；不一致视为失败。失败时：

- 如果副本已经创建，调用 `DELETE /api/conversations/{newId}` 删除它；
- 删除也失败时只写控制台错误，侧栏可能留下空副本，手动删除即可；
- 原会话全程只读，不会改动。

成功后 `window.location.assign('/chat/<newId>')` 整页进入副本，确保官方侧栏和消息按服务端最新状态渲染。

## 图片与附件

官方 import 不接收 `meta`/`attachments`，图片、生成图和上传附件无法作为官方结构写入副本。`conversation-copy.js` 的 `messageMediaMarkdown()` 会从消息里找出这些地址，按 Markdown 追加到正文末尾：

- 识别字段：`attachments`、`files`、`images`、`generatedImages`、`imageSuggestions`，消息本体和 `message.meta` 下的同名数组都读；
- 每个条目的地址依次取 `url`/`src`/`href`/`imageUrl`/`image`/`fileUrl`/`downloadUrl`，也兼容 `{ image: { url } }` 这类嵌套写法；
- 相对地址按 `window.location.origin` 补全，`data:`/`blob:` 地址离开页面即失效，直接跳过；
- 按扩展名（或条目的 `type`/`mimeType`）判断是否图片：图片写成 `![名称](地址)`，其余写成 `[名称](地址)`；地址里的空格和括号会转义；
- 同一地址在同一消息里只写一次；
- 追加后正文超过 `CONVERSATION_IMPORT_MAX_CHARS` 时只复制纯文本并写控制台，避免整次复刻失败；
- 有媒体链接时复制入口写一条 `[SichangTools]` 控制台日志，说明保留了几条消息里的媒体地址。

这样副本里能继续看到原图，但链接不是官方附件结构，不能重新编辑或基于它再次生成；单条删除的尾部重建不走这条逻辑，仍会丢附件。

## 限制

- 官方 import 一次最多 500 条消息，超过上限的会话需要先拆分。
- import 不接收 `meta`/`attachments`，副本只保留纯文本历史；图片/附件仅以 Markdown 链接形式保留。
- 依赖官方顶栏 class、按钮 aria-label、create/import 请求格式；任一项改版都会表现为按钮缺失或克隆失败。
- 没有失败弹窗，出错时看控制台的 `[SichangTools]` 前缀。

## 验证记录

2026-11-27 在临时会话中验证：

- 顶栏按钮注入在「新建对话」左侧，React 重绘被移除后能自动补回；
- 2 条消息的会话克隆成功，副本标题为「原标题（副本）」，消息 ID 全新、顺序与正文一致；
- 匿名 `conv__anonymous__` 会话克隆成功，副本仍是匿名前缀、6 条消息完整；
- 测试会话与副本均已通过 `DELETE /api/conversations/{id}` 删除。
