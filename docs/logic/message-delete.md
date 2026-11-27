# 单条消息删除：实现、接口与即时同步

对应代码：`src/sichang/delete-message.js`（官方接口封装在 `src/sichang/conversation-api.js`）。这份文档记录官方接口契约、删除/恢复流程，以及为什么能在不刷新页面的情况下立即更新官方聊天视图。站点改版时先核对这里的接口和 React context 结构。

## 结论

官方没有“删除单条消息”的 API，只有“从某条起全部删除”。脚本接管官方删除按钮，点击后先弹两个选项：

- **删除本条**：读取官方最新消息，从目标消息 `DELETE` 截断，再用 `/api/conversations/import` 把目标之后的消息按原 ID 补回；写后重新 GET 校验，最后把剩余消息同步进官方 React 状态。
- **删除后续（走官方）**：直接调用官方 `DELETE` 截断接口，删除目标及其后的全部消息，不补回尾部；成功后同样同步官方 React 状态。

两个选项执行期间都会通过共享的 `busy-icon.js` 给被点的官方删除按钮加上 `data-sichang-busy`，把原图标替换成持续旋转的箭头图标，并阻止再次点击，让用户知道操作正在进行。

全程不依赖脚本自己的面板；入口只有官方每条消息上的「删除消息」按钮。

## 入口与按钮映射

官方按钮的选择器集中在 `src/sichang/constants.js`：

```js
export const OFFICIAL_MESSAGE_DELETE_SELECTOR = [
    'button[aria-label="删除消息"]',
    'button[title="删除消息"]',
    'button[aria-label="Delete message"]',
    'button[title="Delete message"]',
].join(', ');
```

`delete-message.js` 在 `window` 的捕获阶段监听 `click`，命中官方按钮后立即：

- `preventDefault()`；
- `stopPropagation()`；
- `stopImmediatePropagation()`；
- 在按钮旁弹出「删除本条 / 删除后续（走官方）」菜单。

这样官方 React handler 不会直接执行原生“从这条起全部删除”；只有用户明确选择“删除后续（走官方）”时才调用官方 DELETE 接口。

菜单项点击后：

- 关闭菜单，重新读取当前会话 ID；
- 快照当前官方删除按钮列表，确认被点的按钮仍在该列表中；
- 给按钮加 `data-sichang-busy`，用伪元素显示旋转箭头图标；
- 按选项执行单条删除或删除后续；
- 结束时移除动画属性；同步失败则整页刷新兜底。

菜单是脚本自己注入的固定定位节点，点外部、滚动、`resize` 或 `Escape` 都会关闭。

官方按钮本身不带消息 ID。映射方式：

- 取当前文档里所有官方删除按钮的文档顺序；
- 与 `GET /api/conversations/{id}/messages` 返回并按 `seq` 升序排列的消息一一对应；
- 要求按钮数量、消息数量、被点按钮位置一致；
- 操作锁期间再次确认按钮列表没有变化；
- 任一项不一致就拒绝，不猜测消息 ID。

匿名/本地对话（`conv__anonymous__`）不拦截，仍走官方本地删除。

## 官方接口契约

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/conversations/{conversationId}` | 读取会话元数据，供 import 填写 scope/title/model/createdAt |
| `GET` | `/api/conversations/{conversationId}/messages?limit=500&before=` | 从最近一页开始，按 `prevCursor` 向前翻页读取全部消息 |
| `DELETE` | `/api/conversations/{conversationId}/messages/{messageId}` | 官方截断接口：删除目标消息及其后的全部消息 |
| `POST` | `/api/conversations/import` | 官方匿名迁移接口：给已存在会话补回消息，只增不改不删 |

读取消息时：

- `limit` 使用 `CONVERSATION_MESSAGE_PAGE_SIZE`（当前 500）；
- 响应字段为 `items`、`prevCursor`、`nextCursor`；
- 先取最近一页，再用 `prevCursor` 向更早翻页；最多 40 页；
- 最终按 `seq` 升序排列。

DELETE 的语义是“从目标起全部删除”，不是只删一条；这是必须先截断、再 import 补回的原因。

## import 请求格式

`importMessages(meta, messages)` 按 `CONVERSATION_IMPORT_BATCH`（当前 400 条）分批发送：

```json
{
  "conversations": [
    {
      "id": "conv__...",
      "scope": "general",
      "characterId": null,
      "title": "对话标题",
      "model": "gemma-4-uncensored",
      "createdAt": 1700000000000,
      "updatedAt": 1700000000000,
      "messages": [
        {
          "id": "msg__...",
          "seq": 3,
          "role": "assistant",
          "model": "gemma-4-uncensored",
          "content": "消息正文",
          "createdAt": 1700000000000,
          "state": "complete"
        }
      ]
    }
  ]
}
```

约束：

- 角色只发送 `user` / `assistant` / `system`；
- `state` 固定为 `complete`；
- 单条正文为空时用零宽空格占位后导入；
- 单条正文超过 `CONVERSATION_IMPORT_MAX_CHARS`（20000 字）会拒绝；
- import 只接收 `id/seq/role/content/model/createdAt/state`，不接收 `meta` 和 `attachments`。

## 删除流程

### 删除本条：`applyDelete(resolveTarget)`

1. 加操作锁，防止连续点击串操作。
2. 读取全部官方消息和会话元数据。
3. 由调用方解析目标消息；按钮映射失败在这里直接报错。
4. 计算目标之后需要补回的尾部，`seq` 从目标原位置开始重新编号。
5. 校验超长正文；空正文用零宽空格占位。
6. 直接执行删除；菜单选择即视为确认，不再弹第二次确认框。
7. 先标记“已进入删除”，再请求 DELETE（请求失败也可能已在服务端截断）。
8. 如果有尾部，调用 import 补回。
9. 重新 GET 全部消息，校验 ID、正文、角色和顺序。
10. 成功后返回 `{ ok, messages, targetId }`。

### 删除后续：`applyDeleteAfter(resolveTarget)`

1. 加操作锁，读取全部官方消息。
2. 由调用方解析目标消息；按钮映射失败直接报错。
3. 请求官方 `DELETE /api/conversations/{id}/messages/{messageId}`，一次删掉目标及其后的全部消息。
4. 重新 GET，校验剩余消息等于删除前列表的前缀。
5. 成功后返回 `{ ok, messages, targetId }`。

这条路径不涉及 import，也没有“补回尾部”的恢复动作：删后续本来就是用户要的结果。

## 失败恢复

「删除本条」任何步骤抛错时：

- 如果 DELETE 还没发出，只写控制台错误，不改数据。
- 如果已经进入 DELETE，尝试用原目标及原尾部重新 import 补回。
- 补回后再次 GET，与删除前的消息列表比对 ID/正文/角色。
- 补回失败或校验失败时，自动下载备份 JSON：
  - 内容为 `{ conversation, messages }`；
  - 文件名 `sichang-message-backup-*.json`；
  - 控制台提示用户保留备份。

这个恢复路径不能恢复 `variants/thinking/imageSuggestions/webSources/attachments`，因为官方 import 本身不接收这些字段。

「删除后续」不补回尾部；DELETE 请求或写后校验失败时只写控制台错误，不自动恢复。删除成功但 React 状态同步失败时，仍按通用回退整页刷新。

## 官方页面即时同步

### 为什么需要同步

DELETE + import 只改服务端。官方 React 本地消息数组不会自动更新，因此直接结束会看到旧消息，或者需要刷新。脚本不直接删 DOM，避免 React 状态和页面 DOM 脱节。

### 获取官方状态

官方页面运行在 React，DOM 节点挂有 `__reactFiber$*` 属性。`officialContext(button)`：

1. 从被点按钮的 DOM 节点取 React fiber；
2. 沿 `return` 向上遍历；
3. 找到 `memoizedProps.value` 同时包含：
   - `upsertConversation` 函数；
   - `activeConversation` 对象；
   - `conversations` 数组；
4. 返回这个 context value。

这依赖脚本以页面世界运行。本项目 `@grant none`，满足条件；如果脚本被沙箱隔离，fiber 属性不可见，会走刷新回退。

### 写回剩余消息

`syncOfficialPage(context, conversation, messages, targetId)`：

- 用服务端最新消息 ID 集合过滤官方本地消息，保留本地对象；这样不会用 import 后的简化消息覆盖掉图片、变体等本地结构；
- 把保留消息的 `seq` 校正为服务端最新值，避免后续发送沿用旧序号；
- 确认目标消息确实从本地数组消失；
- 调用 `context.upsertConversation({ ...conversation, messages: next })`。

官方 `upsertConversation` 更新 `conversations` 状态，React 随即重绘并移除目标消息，不需要整页刷新。

### 回退

如果 context 不存在、当前会话不匹配、目标仍在本地数组，或调用失败：

```js
window.location.reload();
```

回退保证服务端与页面最终一致，但会整页刷新。看到刷新说明官方内部结构可能改版，应优先检查 fiber/context 结构。

## 已知限制

- 只能删登录后的云端对话；匿名本地对话走官方逻辑，不弹脚本菜单。
- 没有撤销；「删除本条 / 删除后续」菜单选择即执行，不再有第二次确认，只能通过备份恢复。
- 「删除本条」会重建目标之后的尾部，尾部元数据可能丢失；「删除后续」不重建，但尾部会直接消失。
- 删除提问或回答都可能产生连续同角色消息。
- 同一对话在其他窗口并发修改时，写后校验可能失败；「删除本条」失败会尝试补回原尾部，「删除后续」不补回。
- 操作期间依赖按钮动画属性和官方 DOM 节点；官方重绘会移除动画，但操作本身不依赖动画节点。
- 依赖官方删除按钮选择器、DELETE 语义、import 格式和 React context；任一项改版都可能触发拒绝、回退刷新或失败。

## 验证记录

2026-11-27 在临时云端对话中验证（菜单加入前的版本）：

- 只删一条回答：服务端 6 → 5 条，官方页面立即少一条，无刷新；
- 只删一条提问：服务端 5 → 4 条，官方页面立即少一条，无刷新；
- 同步后本地消息 `seq` 与服务端一致；
- 当时点击官方「删除消息」直接执行单条删除，服务端 4 → 3 条；再删中间一条零宽空格消息，服务端 3 → 2 条，页面即时更新、无刷新、无弹窗；
- 临时对话验证后已通过 `DELETE /api/conversations/{id}` 删除。

加入「删除本条 / 删除后续（走官方）」菜单与操作中动画后，尚未在真机验证；下次打开站点时应确认菜单定位、两个选项、动画和即时同步。
