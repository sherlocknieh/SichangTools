// 思畅 AI 的「朗读」接口契约与分段策略：站点改版时先动这里。
export const TTS_PATH = '/api/tts';
// 官方没有单条消息删除接口；单条删除靠「截断 + import 补回」，
// 单次导入上限按官方匿名迁移接口的约束取值
export const CONVERSATION_MESSAGE_PAGE_SIZE = 500;
// 官方消息按钮没有消息 ID；接管时按按钮与官方消息的文档顺序对应，数量不一致时拒绝操作。
export const OFFICIAL_MESSAGE_DELETE_SELECTOR = [
    'button[aria-label="删除消息"]',
    'button[title="删除消息"]',
    'button[aria-label="Delete message"]',
    'button[title="Delete message"]',
].join(', ');
export const CONVERSATION_IMPORT_BATCH = 400;
export const CONVERSATION_IMPORT_MAX_CHARS = 20000;
// 官方 import 迁移一次最多接收 500 条消息，超出部分会被服务端跳过；克隆后按实际条数校验
export const CONVERSATION_IMPORT_MAX_MESSAGES = 500;
// 官方聊天页顶栏：克隆按钮插在「新建对话」左侧。选择器集中在这里，站点改版时只改这一处。
export const OFFICIAL_CHAT_HEADER_SELECTOR = 'div.h-14';
export const OFFICIAL_HEADER_HISTORY_SELECTOR = 'button[aria-label="会话历史"], button[title="会话历史"]';
export const OFFICIAL_NEW_CHAT_SELECTOR = 'button[aria-label="新建对话"], button[title="新建对话"]';
export const CLONE_BUTTON_SELECTOR = 'button[data-sichang-clone]';
export const CLONE_BUTTON_LABEL = '克隆会话';
export const CLONE_TITLE_SUFFIX = '（副本）';
// 官方输入区：加号按钮插在「发送消息」左侧，输入内容来自同一个 textarea。
export const OFFICIAL_SEND_SELECTOR = 'button[aria-label="发送消息"], button[title="发送消息"]';
export const OFFICIAL_ATTACH_SELECTOR = 'button[aria-label="发送附件"], button[title="发送附件"]';
export const ADD_BUBBLE_BUTTON_SELECTOR = 'button[data-sichang-add-bubble]';
export const ADD_BUBBLE_BUTTON_LABEL = '添加消息气泡';
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
export const PLAYBACK_RATE_STORE_KEY = 'sichang-tts-playback-rate';
export const FOLD_STORE_KEY = 'sichang-tts-folded';
export const DRAFT_STORE_KEY = 'sichang-tts-draft';
export const POS_STORE_KEY = 'sichang-tts-pos';
// 只用于已下载完成的分段音频；实时时间线不跟随
export const PLAYBACK_RATES = [1, 1.25, 1.5, 2];
