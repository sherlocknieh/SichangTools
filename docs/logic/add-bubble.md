# 手动添加消息气泡：实现与接口

对应代码：`src/sichang/add-bubble.js`，官方接口封装在 `conversation-api.js`，React 页面工具在 `official-page.js`。这份文档记录入口、写入流程、即时同步和限制；站点改版时先核对这里。

## 结论

官方没有“只追加一条消息”的接口。脚本用下面几步把输入框文字变成一条持久的用户气泡：

1. 读取 `GET /api/conversations/{id}` 元数据和 `GET /api/conversations/{id}/messages` 全部消息；
2. 按官方 `nextSeq` 规则计算新消息的 `seq`，生成新的 `msg__<owner>__<id>`；
3. 用 `POST /api/conversations/import` 写入这条 `user` 消息；
4. 空会话时用 `PATCH /api/conversations/{id}` 把标题改成正文前 30 字；空正文用零宽空格占位；
5. 通过官方 React context 的 `upsertConversation` 立即插入气泡；
6. 通过原生 setter + `input` 事件清空官方受控 textarea。

全程**不请求 `/api/chat`**，所以不会触发 AI 回复。

## 入口与按钮

选择器集中在 `src/sichang/constants.js`：

```js
export const OFFICIAL_SEND_SELECTOR = 'button[aria-label="发送消息"], button[title="发送消息"]';
export const OFFICIAL_ATTACH_SELECTOR = 'button[aria-label="发送附件"], button[title="发送附件"]';
export const ADD_BUBBLE_BUTTON_SELECTOR = 'button[data-sichang-add-bubble]';
export const ADD_BUBBLE_BUTTON_LABEL = '添加消息气泡';
```

- 以官方「发送消息」按钮为锚点，向上最多 5 层找到同时包住 `textarea` 的输入区容器。
- 加号插在「发送消息」左侧，复用官方「发送附件」按钮的 class（没有附件按钮时用发送按钮）；图标是内联 SVG。
- AI 回复期间官方把发送按钮换成「停止生成」，`findComposer` 找不到发送按钮，点击加号只写控制台，不弹窗。
- 输入区会随会话切换、回复状态重绘；`MutationObserver` 监听 `document.body` 的 childList，去抖 120ms 后补插，不做轮询。
- `dispose` 断开 observer、清定时器并移除按钮。

## 为什么不用官方 addMessage

官方 React context 的 `addMessage` 只会更新本地状态；云端的 `appendMessage` 是空实现，真正的持久化发生在 `/api/chat` 里（发送用户消息和空助手消息，再流式回填）。因此：

- 直接调用 `addMessage` 不会写入服务端；
- 走 `/api/chat` 会触发 AI 回复。

脚本选择直接用 import 持久化，再手动把同一条消息写回官方 React 状态。

## 消息与序号

- 角色按**提问/回答轮流**决定：读取服务端全部消息，最后一条是 `user` 就补 `assistant`，否则（包括空会话）补 `user`。
- 正文取输入框内容 `trim()`。**空内容允许**：官方 import 会跳过空字符串，脚本改用零宽空格 `\u200B` 占位，气泡视觉上为空；角色仍按轮流规则决定。
- 按钮的 `title` 会提示「提问/回答轮流」。
- 消息 ID：`msg__<owner>__<newId>`，`owner` 从当前 URL 的 `conv__<owner>__<raw>` 里取。
- `seq` 使用官方同款 `nextSeq`：从最后一条带 `seq` 的服务端消息往后数，没有 `seq` 时退回本地消息条数。
- import 每条消息只带 `id/seq/role/content/createdAt/state`，`state` 固定 `complete`。

## 标题

空会话添加第一条**提问**时：

- 本地和服务端标题都改成 `deriveTitle(content)`：`trim()` 后取前 30 字，超出加省略号，空文本则「新对话」；
- 先 `PATCH /api/conversations/{id}` 写标题（失败不阻断），import 时也带上同一个标题；
- 非空会话、以及空会话里的第一条回答都保持原标题。

## 即时同步与清空输入

写入成功后：

1. 用 `officialContext(sendButton)` 沿 React fiber 找到带 `upsertConversation`、`activeConversation`、`conversations` 的 context；
2. 把 `{ ...message }` 追加到 `activeConversation.messages`，更新 `title/updatedAt`，调用 `upsertConversation`；
3. 用 `setNativeValue(textarea, '')` 触发受控输入更新，清空输入框。

如果 context 不存在、当前会话不匹配或 `upsertConversation` 抛错，就 `window.location.reload()`，以服务端为准。输入框只在写入成功后清空，失败时保留用户已经输入的文字。

## 限制

- 只支持 `conv__` 开头的云端会话；匿名/本地对话只写控制台。
- 只添加纯文本，不携带附件、图片或文档。
- 正文超过 20000 字时拒绝，避免官方 import 静默截断；空正文自动占位。
- 依赖官方发送按钮 aria-label、输入区层级、React context 结构和 import 请求格式；任一改版都可能表现为按钮缺失、点击无响应或整页刷新。

## 验证记录

2026-11-27 在临时云端会话中验证：

- 加号注入在「发送消息」左侧（36×36，与附件按钮同款）；
- 输入文字后点击加号，气泡立即出现、输入框清空，服务端新增一条 `user` 消息；
- 连续添加三次，角色依次为 `user → assistant → user`，标题保持第一条提问；
- 输入框为空时点击加号，服务端新增一条零宽空格消息，页面显示为空气泡；
- 空会话第一条气泡把标题改成正文前 30 字；
- 刷新页面后气泡仍在；连续添加第二条得到 `seq=1`，标题保持第一条内容；
- 测试会话已通过 `DELETE /api/conversations/{id}` 删除。
