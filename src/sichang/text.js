// 文本切分与展示格式化：都是不碰 DOM、不碰音频状态的纯函数。
import { MAX_SEGMENT_CHARS } from './constants.js';

export function formatDuration(seconds) {
    const total = Math.max(0, Math.round(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function formatSegmentDuration(seconds) {
    if (seconds < 10) return `${seconds.toFixed(1)}s`;
    return formatDuration(seconds);
}

export function previewText(text) {
    // 只做标记清理和空白压缩，不按长度截断；显示宽度交给各行的 CSS 换行处理
    return text.replace(/\[[^\]]{1,10}\]/g, '').replace(/\s+/g, ' ').trim();
}

// 先按句末标点和换行切开，再把短句攒到接近上限，避免一句话被硬生生截断
export function splitText(text) {
    const normalized = String(text || '').replace(/\r/g, '').trim();
    if (!normalized) return [];
    const parts = normalized.split(/(?<=[。！？!?；;…\n])/).filter(part => part.trim());
    const chunks = [];
    let current = '';
    const flush = () => {
        if (current.trim()) chunks.push(current.trim());
        current = '';
    };
    for (let part of parts) {
        while (part.length > MAX_SEGMENT_CHARS) {
            flush();
            chunks.push(part.slice(0, MAX_SEGMENT_CHARS));
            part = part.slice(MAX_SEGMENT_CHARS);
        }
        if (current.length + part.length > MAX_SEGMENT_CHARS) flush();
        current += part;
    }
    flush();
    return chunks;
}

export function splitInHalf(text) {
    if (text.length < 40) return null;
    const middle = Math.floor(text.length / 2);
    // 尽量在标点处断开，找不到就硬切
    const before = text.lastIndexOf('，', middle);
    const cut = before > text.length * 0.3 ? before + 1 : middle;
    return [text.slice(0, cut), text.slice(cut)];
}
