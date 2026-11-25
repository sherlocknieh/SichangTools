# SichangTools

思畅 AI（`sichang.xyz`）聊天页的油猴脚本。

功能:

- 接管官方「朗读」：不再整段合成，改为按句分段请求、边下边播，官方播放器不会出声
- 长文本分段更稳：单段失败可重试或再拆，不影响其他段落
- 右下角面板：手动输入文本合成、记录最近的合成结果、试听与下载 WAV
- 播放倍速（0.5×–2×；WAV/分段保音高，实时播放会变调）、实时播放暂停/继续/跳转、分段试听、单段重生成、面板拖动与折叠

安装地址: https://github.com/sherlocknieh/SichangTools/raw/main/dist/sichang-tools.user.js

## 开发

见 [docs/development.md](./docs/development.md)，代码定位见 [AGENTS.md](./AGENTS.md)。
