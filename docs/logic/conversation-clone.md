# 会话克隆：实现与接口

对应代码：`src/sichang/clone-conversation.js`，官方接口封装在 `conversation-api.js`。这份文档记录入口、接口组合、校验和失败清理；站点改版时先核对这里。

## 结论

官方没有“克隆会话”接口。脚本用两个官方接口组合出副本：

1. `GET /api/conversations/{id}` 读取会话元数据；
2. `GET /api/conversations/{id}/messages` 分页读取全部消息；
3. `POST /api/conversations` 用新 ID 建一条空会话；
4. `POST /api/conversations/import` 把消息换成新 ID、重排 `seq` 后导入；
5. 重新 `GET` 副本消息校验条数、角色和正文。

成功后整页进入副本；任一步失败时删除刚建的副本，原会话不变。

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
- 官方是 Next.js SPA，切会话或窗口变化会重绘顶栏并移除脚本节点；脚本用 `MutationObserver` 监听 `document.body` 的 childList，去抖 120ms 后补插，不做轮询。
- `dispose` 断开 observer、清定时器并移除按钮。

## 官方接口组合

`conversation-api.js` 是删除与克隆共用的封装：

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

- 从当前 URL 的会话 ID 中取 `owner`（`conv__` 与最后一个 `__` 之间的部分）；
- 副本生成全新的 `newId`，消息也逐条生成新 ID，避免与原会话 ID 冲突；
- 消息 `seq` 从 0 连续重排，保证导入顺序。

## 校验与失败清理

克隆前拒绝：

- 没有会话 ID、匿名/本地 `conv__anonymous__` 会话；
- 没有任何消息；
- 消息数超过 `CONVERSATION_IMPORT_MAX_MESSAGES`（500）；
- 任一条正文为空；
- 任一条正文超过 `CONVERSATION_IMPORT_MAX_CHARS`（20000 字）。

确认框列出会话标题、消息数，以及 import 会丢掉的分支变体、思考、图片建议、网页来源、附件/生成图。

写入后重新读取副本，逐条比对 `content` 与 `role`，条数也必须一致；不一致视为失败。失败时：

- 如果副本已经创建，调用 `DELETE /api/conversations/{newId}` 删除它；
- 删除也失败时只提示原错误，侧栏可能留下空副本，手动删除即可；
- 原会话全程只读，不会改动。

成功后 `window.location.assign('/chat/<newId>')` 整页进入副本，确保官方侧栏和消息按服务端最新状态渲染。

## 限制

- 只支持 `conv__` 开头的云端会话；匿名/本地对话在 IndexedDB，脚本不直接读取。
- import 不接收 `meta`/`attachments`，副本只保留纯文本历史。
- 官方 import 一次最多 500 条消息，超过上限的会话需要先拆分。
- 依赖官方顶栏 class、按钮 aria-label、create/import 请求格式；任一项改版都会表现为按钮缺失或克隆失败。

## 验证记录

2026-11-27 在临时云端会话中验证：

- 顶栏按钮注入在「新建对话」左侧，React 重绘被移除后能自动补回；
- 2 条消息的会话克隆成功，副本标题为「原标题（副本）」，消息 ID 全新、顺序与正文一致；
- 测试会话与副本均已通过 `DELETE /api/conversations/{id}` 删除。
