// 单段重生成用的一次性请求：读完整个 PCM16 流再返回，交给调用方替换分段。
// 边下边播的流式消费在 handler 的分段合成流程里，不走这里。
import { TTS_PATH, SEGMENT_HEADER, DEFAULT_SAMPLE_RATE } from './constants.js';

export async function requestSegmentAudio({ text, voice, rate, format }) {
    const response = await window.fetch(TTS_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [SEGMENT_HEADER]: '1' },
        body: JSON.stringify({ text, voice, rate, format }),
    });
    if (!response.ok) throw new Error(`tts ${response.status}`);
    const sampleRate = Number(response.headers.get('X-Sample-Rate')) || DEFAULT_SAMPLE_RATE;
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || !value.length) continue;
        chunks.push(value);
        bytes += value.length;
    }
    if (!bytes) throw new Error('empty');
    // WAV 只接受偶数字节；丢掉最后多出的半采样
    if (bytes % 2) {
        const last = chunks[chunks.length - 1];
        chunks[chunks.length - 1] = last.subarray(0, last.length - 1);
        bytes -= 1;
    }
    return { chunks, bytes, sampleRate };
}
