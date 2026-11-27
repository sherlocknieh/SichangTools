import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

// 只服务思畅 AI 一个站点；handler 内还会再判断 hostname，防止误注入
const MATCH_PATTERNS = ['https://sichang.xyz/*'];

// 图标直接用站点自己的 favicon，随站点更新，不额外维护本地图标资源
const ICON_URL = 'https://sichang.xyz/favicon.ico';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.js',
      build: { fileName: 'sichang-tools.user.js' },
      userscript: {
        name: 'SichangTools',
        namespace: 'https://github.com/sherlocknieh/',
        version: '2026.11.28.0122',
        description: '接管思畅 AI 朗读，分段合成、边下边播；支持单条删除、会话克隆、消息 fork、手动添加消息与 WAV 保存',
        icon: ICON_URL,
        match: MATCH_PATTERNS,
        grant: 'none',
      },
    }),
  ],
  server: {
    open: true,
  },
});
