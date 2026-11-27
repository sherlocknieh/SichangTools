# 消息级复刻（fork）：实现与接口

对应代码：`src/sichang/fork-message.js`，复制实现与整条克隆共用 `conversation-copy.js`。这份文档记录入口、消息映射和安全拒绝条件。

## 结论

fork 是“把当前会话截到某条消息为止，再复制成新会话”。它不调用官方不存在的接口，而是复用整条克隆的 `create + import`：

1. 通过官方 React context 的 `activeConversation.messages` 确定被点的是第几条消息；
2. 用 `GET /api/conversations/{id}/messages` 读取完整消息列表（匿名会话同样支持）；
3. 截取到目标消息为止，重新生成消息 ID、`seq` 从 0 连续重排；
4. 新建会话并 import；
5. 校验后进入副本。

原会话只读，不会改动。

## 入口与按钮注入

选择器集中在 `src/sichang/constants.js`：

```js
export const OFFICIAL_COPY_SELECTOR = 'button[aria-label="复制消息"], button[title="复制消息"], button[aria-label="Copy message"], button[title="Copy message"]';
export const FORK_BUTTON_SELECTOR = 'button[data-sichang-fork]';
```

- 以每条消息操作行里的「复制消息」按钮为锚点；操作行是 `span.inline-flex` 的父级 `div`（同排还有朗读、编辑、删除）。
- 复制官方按钮外壳（`span` + `button`），替换图标和 `aria-label/title` 为「复刻到这条消息」，插在「复制消息」前面。
- 用文档级点击委托，React 重绘换掉节点后点击仍有效。
- `MutationObserver` 监听 `document.body` 的 childList，去抖 120ms 后给还没有 fork 按钮的操作行补插；不做轮询。
- `dispose` 断开 observer、清定时器并移除所有注入的按钮外壳。

## 消息映射

官方按钮不携带消息 ID，脚本按文档顺序映射：

- 取当前页面全部「复制消息」按钮的文档顺序；
- 与官方 context 的 `activeConversation.messages` 一一对应；
- 要求按钮数量与本地消息数量完全一致，且目标下标有效；
- 数量不一致（消息还在加载、正在流式回复、列表刚变化）时拒绝操作，不猜位置；
- 通过被点消息的 `id`（找不到时用 `seq`）在完整消息列表里定位，截取 `slice(0, index + 1)`。

这样即使云端只加载了最近 100 条消息、更早的消息没渲染，也能正确定位到完整列表中的位置。

## 复制与标题

- 直接调用 `copyConversation({ sourceCid, context, meta, messages, title })`。
- 标题为「原标题（前N条）」，N 是复刻包含的消息条数。
- 云端和匿名会话优先走官方 `create + import`；纯本地匿名会话在接口不可达时退回 context 的本地复制。
- 空正文用零宽空格占位；分支变体、思考、图片建议、网页来源、附件不会复制。
- 失败时只写控制台 `[SichangTools]`，不弹窗。

## 跳转

- 服务端副本：`window.location.assign('/chat/<newId>')` 整页进入，保证侧栏与消息都按服务端状态渲染。
- 本地匿名副本：`history.replaceState` 只改地址，官方 context 已经切换到新会话，避免中断异步落盘。

## 限制

- 依赖官方「复制消息」按钮选择器、操作行层级、`activeConversation.messages` 顺序；站点改版可能导致按钮缺失或映射拒绝。
- 一次最多导入 500 条消息；单条正文超过 20000 字会拒绝。
- 正在流式回复、消息列表变化时不执行，需要等页面稳定后重试。

## 验证记录

2026-11-27 在临时云端会话中验证：

- 6 条消息的会话出现 6 个 fork 按钮，位置在「复制消息」前面；
- 对第 2 条消息 fork，生成标题「fork测试（前2条）」的新会话，只包含前 2 条消息，顺序和正文一致；
- 空内容消息（零宽空格）出现在操作行里时，fork 按钮数量与消息数量仍一致；
- 测试会话与副本均已删除。
