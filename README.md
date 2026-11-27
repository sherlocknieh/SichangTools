# SichangTools

思畅 AI（`sichang.xyz`）聊天页的油猴脚本。

功能:

- 接管官方「朗读」：不再整段合成，改为按句分段请求、边下边播，官方播放器不会出声
- 长文本分段更稳：单段失败可重试或再拆，不影响其他段落
- 右下角面板：手动输入文本合成、记录最近的合成结果、试听与下载 WAV
- 实时播放暂停/继续/跳转、合成中暂停/继续、已下载音频倍速、分段试听、单段重生成、面板拖动与折叠、记录分段列表折叠
- 对话结构管理：接管官方单条删除按钮，支持删除中间消息或整轮、插入、移动/嫁接，直接写回官方；会重建分歧点之后的消息，变体与附件会丢失

安装地址: https://github.com/sherlocknieh/SichangTools/raw/main/dist/sichang-tools.user.js

## 开发

见 [docs/development.md](./docs/development.md)，代码定位见 [AGENTS.md](./AGENTS.md)。
