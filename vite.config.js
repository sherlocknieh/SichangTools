import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import { ICON_SVG } from './src/assets/icon.js';

// 只服务思畅 AI 一个站点；handler 内还会再判断 hostname，防止误注入
const MATCH_PATTERNS = ['https://sichang.xyz/*'];

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.js',
      build: { fileName: 'sichang-tools.user.js' },
      userscript: {
        name: 'SichangTools',
        namespace: 'https://github.com/sherlocknieh/',
        version: '2026.11.25.1732',
        description: '接管思畅 AI 朗读，分段合成、边下边播并保存 WAV',
        icon: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(ICON_SVG),
        match: MATCH_PATTERNS,
        grant: 'none',
      },
    }),
  ],
  server: {
    open: true,
  },
});
