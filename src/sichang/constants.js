// 思畅 AI 的「朗读」接口契约与分段策略：站点改版时先动这里。
export const TTS_PATH = '/api/tts';
export const PANEL_ID = 'sichang-tts-capture';
export const DEFAULT_SAMPLE_RATE = 24000;
export const MAX_RECORDS = 20;
// 单段上限：太短会切碎语气，太长又容易让合成失败，取 160 字
export const MAX_SEGMENT_CHARS = 160;
export const MAX_ATTEMPTS = 2;
// 单条最长约 22 分钟；超出后不再累积，避免长对话把内存吃满
export const MAX_PCM_BYTES = 64 * 1024 * 1024;
// 脚本自己发的分段请求带这个头，用来和官方请求区分，避免无限接管
export const SEGMENT_HEADER = 'X-Sichang-Segment';
// 首段先攒这么多秒再起播：开头几个网络块常比实时慢，直接播会在第一句里留小段补白
export const MIN_START_SECONDS = 0.5;

// 输入框空着时的试听文本：短到一次合成就能听完，方便换音色反复试；
// 只是占位用的预填，聚焦进入编辑就清掉，也不写入草稿
export const DEFAULT_INPUT_TEXT = '你好，我是思畅，今天天气不错。';
export const VOICE_STORE_KEY = 'sichang-tts-voice';
export const RATE_STORE_KEY = 'sichang-tts-rate';
export const FOLD_STORE_KEY = 'sichang-tts-folded';
export const DRAFT_STORE_KEY = 'sichang-tts-draft';
export const POS_STORE_KEY = 'sichang-tts-pos';
