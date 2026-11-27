# 手动添加 / 插入消息气泡：实现与接口

对应代码：`src/sichang/add-bubble.js`，官方接口封装在 `conversation-api.js`，React 页面工具在 `official-page.js`。这份文档记录入口、追加与插入流程、即时同步和限制；站点改版时先核对这里。

## 结论

官方没有“只追加一条消息”或“在中间插入一条消息”的接口。脚本分两种写入方式，全程**不请求 `/api/chat`**，所以不会触发 AI 回复：

- **追加（输入框右侧加号）**：读取会话元数据和全部消息，按官方 `nextSeq` 规则生成 `seq`，用 `POST /api/conversations/import` 写入一条 `user`/`assistant` 消息；空会话时用 `PATCH /api/conversations/{id}` 把标题改成正文前 30 字。
- **插入（每条消息操作行加号）**：读出全部消息，确定目标消息位置，用 `DELETE /api/conversations/{id}/messages/{尾部第一条}` 截断目标之后的消息，再用 `POST /api/conversations/import` 按新顺序写回“新消息 + 原尾部”。
- 两者写入成功后都通过官方 React context 的 `upsertConversation` 立即更新气泡，再用原生 setter + `input` 事件清空官方受控 textarea。

## 入口与按钮

选择器集中在 `src/sichang/constants.js`：

```js
export const OFFICIAL_SEND_SELECTOR = 'button[aria-label="发送消息"], button[title="发送消息"]';
export const OFFICIAL_ATTACH_SELECTOR = 'button[aria-label="发送附件"], button[title="发送附件"]';
export const ADD_BUBBLE_BUTTON_SELECTOR = 'button[data-sichang-add-bubble]';
export const ADD_BUBBLE_BUTTON_LABEL = '添加消息气泡';
export const OFFICIAL_COPY_SELECTOR = 'button[aria-label="复制消息"], button[title="复制消息"], button[aria-label="Copy message"], button[title="Copy message"]';
export const INSERT_BUBBLE_BUTTON_SELECTOR = 'button[data-sichang-insert-bubble]';
export const INSERT_BUBBLE_BUTTON_LABEL = '在下方插入消息';
```

- **输入区加号**：以官方「发送消息」按钮为锚点，向上最多 5 层找到同时包住 `textarea` 的输入区容器；加号插在「发送消息」右侧（按钮组顺序：发送 → 加号 → 生成语音），复用官方「发送附件」按钮的 class（没有附件按钮时用发送按钮）；图标是内联 SVG。
- **消息操作行加号**：以每条消息的「复制消息」按钮为锚点，复制官方按钮外壳（`span` + `button`），替换成加号图标后插在「复制消息」前面；与 fork 按钮同排，`aria-label`/`title` 为「在下方插入消息」。
- AI 回复期间官方把发送按钮换成「停止生成」，`findComposer` 找不到发送按钮，点击任一加号只写控制台，不弹窗。
- 输入区和消息列表会随会话切换、回复状态重绘；`MutationObserver` 监听 `document.body` 的 childList，去抖 120ms 后补插，不做轮询。
- 加号点击只负责开/关菜单，不直接写入；菜单项点击才触发写入。
- 写入期间被点的加号加上 `data-sichang-busy`（由共享的 `busy-icon.js` 注入样式），原图标替换成旋转箭头并禁用；同类加号（输入区、所有消息操作行）同时禁用，防止并发操作。
- `dispose` 断开 observer、清定时器并移除按钮与菜单样式。


## 为什么不用官方 addMessage

官方 React context 的 `addMessage` 只会更新本地状态；云端的 `appendMessage` 是空实现，真正的持久化发生在 `/api/chat` 里（发送用户消息和空助手消息，再流式回填）。因此：

- 直接调用 `addMessage` 不会写入服务端；
- 走 `/api/chat` 会触发 AI 回复。

脚本选择直接用 import 持久化，再手动把同一条消息写回官方 React 状态。

## 消息与序号

- 角色由用户选择：点击加号弹出「添加提问」（`user`）/「添加回答」（`assistant`）两个子选项，选哪个就用哪个角色；消息操作行的菜单文案是「在下方插入提问 / 在下方插入回答」。
- 菜单渲染在 `document.body`，`position: fixed` 定位在加号上方；顶部空间不足时改到按钮下方。样式写在注入的 `<style id="sichang-add-bubble-style">` 里；点菜单外、Esc、页面滚动或窗口 resize 时关闭。
- 正文取输入框内容 `trim()`。**空内容允许**：官方 import 会跳过空字符串，脚本改用零宽空格 `\u200B` 占位，气泡视觉上为空。
- 消息 ID：`msg__<owner>__<newId>`，`owner` 从当前 URL 的 `conv__<owner>__<raw>` 里取。
- 追加时 `seq` 使用官方同款 `nextSeq`：从最后一条带 `seq` 的服务端消息往后数，没有 `seq` 时退回本地消息条数。
- 插入时 `seq` 表示排序位置，`createdAt` 表示时间位置；官方页面刷新后按 `createdAt` 合并排序，所以新消息时间必须紧跟在目标消息之后（目标时间 + 1ms），否则会掉到会话底部。
- import 每条消息只带 `id/seq/role/content/createdAt/state`，`state` 固定 `complete`。

## 插入到指定消息下方

消息操作行加号不追加到末尾，而是插入到被点消息之后：

1. 点击时按「复制消息」按钮的文档顺序记录目标下标与按钮列表快照；
2. 菜单项点击后重新确认按钮列表、官方 `activeConversation.messages` 数量与快照一致；不一致就直接拒绝，不猜位置；
3. 用官方消息 ID（找不到时退回 `seq`）在完整消息列表里定位目标，读取会话元数据和全部消息；
4. 新消息 `seq` 取原尾部第一条的 `seq`，原尾部整体后移一位并连续重排；目标已经是最后一条时用 `nextSeq` 追加；
5. 新消息 `createdAt` 取目标消息时间 + 1ms；官方刷新后会按 `createdAt` 合并排序本地与服务端消息，只改 `seq` 不够。尾部保持原时间，只有和目标撞在同一毫秒时才依次后移 1ms；
6. 如果目标后面还有消息，先 `DELETE /api/conversations/{id}/messages/{原尾部第一条 id}` 截断，再 `import` 新消息与原尾部；
7. 重新读取消息，校验 ID、正文和角色顺序；成功后把新消息插进官方 React 本地数组并校正尾部 `seq/createdAt`；
8. 清空输入框。React 同步失败时整页刷新。

失败恢复沿用删除逻辑：DELETE 已经发出后出错，会把原尾部按原 `seq` 重新 import 补回；补回失败自动下载 `sichang-message-backup-*.json` 备份。调整尾部顺序会重建目标之后的消息，这些消息原先的变体、思考内容、网页来源和附件元数据会丢失（import 不接收这些字段）。

所有会话（含匿名 `conv__anonymous__`）都按普通会话处理，走同一套 DELETE/import 流程，不再按会话类型分流；纯本地匿名对话如果服务端没有对应数据，会在读取或校验阶段失败，只在控制台报错。

## 标题

空会话添加第一条**提问**时：

- 本地和服务端标题都改成 `deriveTitle(content)`：`trim()` 后取前 30 字，超出加省略号，空文本则「新对话」；
- 先 `PATCH /api/conversations/{id}` 写标题（失败不阻断），import 时也带上同一个标题；
- 非空会话、以及空会话里的第一条回答都保持原标题。插入必然发生在已有消息之后，因此不改标题。

## 即时同步与清空输入

追加成功后：

1. 用 `officialContext(sendButton)` 沿 React fiber 找到带 `upsertConversation`、`activeConversation`、`conversations` 的 context；
2. 把 `{ ...message }` 追加到 `activeConversation.messages`，更新 `title/updatedAt`，调用 `upsertConversation`；
3. 用 `setNativeValue(textarea, '')` 触发受控输入更新，清空输入框。

插入成功后：

1. 也用 `officialContext(被点消息的复制按钮)` 取同一份 context；
2. 遍历官方本地 `activeConversation.messages`，保留原对象（媒体、变体等结构不被重导入破坏），只按服务端最新值校正被重排的 `seq/createdAt`；
3. 在目标消息后插入服务端返回的新消息，调用 `upsertConversation`；
4. 清空输入框。

如果 context 不存在、当前会话不匹配、目标消息不在本地数组或 `upsertConversation` 抛错，就 `window.location.reload()`，以服务端为准。输入框只在写入成功后清空，失败时保留用户已经输入的文字。

## 限制

- 两个加号对所有会话类型（含匿名 `conv__anonymous__`）一视同仁，统一走官方 import；纯本地匿名对话如果服务端没有对应数据，会在读取/校验阶段失败并在控制台报错。
- 只添加纯文本，不携带附件、图片或文档。
- 正文超过 20000 字时拒绝，避免官方 import 静默截断；空正文自动占位。
- 插入会重建目标之后的消息，尾部消息的变体、思考、网页来源和附件元数据会丢失。
- 依赖官方发送按钮、附件按钮和「复制消息」按钮的 aria-label、输入区/操作行层级、React context 结构和 import 请求格式；任一改版都可能表现为按钮缺失、点击无响应、安全拒绝或整页刷新。

## 验证记录

2026-11-27 在临时云端会话中验证（仅输入区追加版本）：

- 加号注入在「发送消息」右侧（36×36，与附件按钮同款），生成语音按钮再跟在加号后面；
- 点加号出现「添加提问 / 添加回答」两个选项；选提问写入 `user`，选回答写入 `assistant`，气泡立即出现、输入框清空；
- 点菜单外和按 Esc 都能关闭菜单；
- 输入框为空时选择任一选项，服务端新增一条零宽空格消息，页面显示为空气泡；
- 空会话第一条选择提问时，标题改成正文前 30 字；选择回答则保持「新对话」；
- 刷新页面后气泡仍在；连续添加第二条得到 `seq=1`，标题保持第一条内容；
- 测试会话已通过 `DELETE /api/conversations/{id}` 删除。

消息操作行插入加号尚未在真机验证；下次打开站点时应确认按钮位置、中间插入、尾部 `seq/createdAt` 重排、刷新后的顺序、即时同步，以及删除失败后的补回流程。
