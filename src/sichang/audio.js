// PCM16 与 WAV 之间的转换工具，纯函数，不碰 DOM 状态。
export function pcmToWav(pcm, sampleRate) {
    const dataLength = pcm.byteLength;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    const write = (offset, text) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    write(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, dataLength, true);
    new Uint8Array(buffer, 44).set(pcm);
    return new Blob([buffer], { type: 'audio/wav' });
}

export function pcmToSamples(pcm) {
    const count = Math.floor(pcm.byteLength / 2);
    const view = new DataView(pcm.buffer, pcm.byteOffset, count * 2);
    const samples = new Float32Array(count);
    for (let i = 0; i < count; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
    return samples;
}

export function joinedPcm(chunks, length) {
    const pcm = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        if (offset >= length) break;
        const part = chunk.subarray(0, Math.min(chunk.length, length - offset));
        pcm.set(part, offset);
        offset += part.length;
    }
    return pcm;
}
