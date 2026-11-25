# 代码约定

改 `src/` 之前先读这一页；它记录的是代码里看不出来的约定，不是文件清单（文件清单见 `architecture.md`）。

## 新增功能

- 优先扩展 `src/handlers/sichang.js`，只有职责明显不同才新建 handler，并在 `src/main.js` 的 `initialize()` 里注册。
- 与 handler 生命周期无关的常量、音色、样式和纯函数放 `src/sichang/`，按职责建文件；不要为了少一个 import 把新逻辑塞回 handler 顶部。
- handler 的初始化函数返回清理函数：自己添加的事件监听、observer、定时器、注入节点和改过的原型方法（含 `window.fetch`）都要能撤销。
- handler 先判断当前 hostname，不匹配就直接返回，不执行 DOM 修改。
- 同一个功能只保留一处实现。

## 选择器

- 站点选择器集中放在 handler 的契约处或 `src/sichang/constants.js`；面板自己的选择器只出现在 `styles.js` 和 `createPanel()` 里，业务逻辑里不散落 class 选择器，改版时才能一处改完。
- 本项目尽量不依赖站点 DOM：朗读入口通过接口接管，面板使用自己的 Shadow DOM。

## 动态 DOM

- 页面内容随时会插入；只监听少量必要事件（如 `resize`），不轮询 DOM。
- 插入 UI 前先判断是否已存在，保证幂等。

## 语言与风格

- 原生 ES module、单引号、无框架、无新增运行时依赖。
- 注释写目的与约束（为什么这样做、改版时注意什么），不写步骤复述。

## 配置与产物

- 匹配域名改 `vite.config.js`；产物 `dist/` 由构建脚本生成。
- 版本号由 `.dev/bump-and-build.mjs` 写入 `vite.config.js`，格式 `YYYY.MM.DD.HHmm`；源码、版本号与 `dist` 在同一提交里。
