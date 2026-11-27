// 标题栏播放控件：只要有一路声音在响（实时时间线、顺序播放、单段播放），
// 就在顶栏给出统一的播放/暂停和倍速入口；完全空闲时两者隐藏，顶栏保持精简。
// 这里只做「找当前声音 → 转调各模块的暂停/继续」，不自己持有播放状态。
import { ICONS } from './icons.js';

export function createPlaybackBar(host) {
    const { ui } = host;

    // 声音只可能来自一路：顺序播放的 <audio>、实时时间线或合成中的实时流。
    // 优先返回正在出声的一路；都停住时才返回停在原位的那一路，让按钮显示「继续」
    function findPlayback() {
        let paused = null;
        for (const record of host.records) {
            const chain = record.chain;
            const audio = chain?.segment?.audio;
            if (audio) {
                if (!audio.paused) return { record, kind: 'chain', playing: true };
                if (!paused) paused = { record, kind: 'chain', playing: false };
                continue;
            }
            // 顺序播放等着下一段时没有声音，不算正在播放
            if (chain?.waitingFor) continue;
            // 有顺序播放队列就不再走实时时间线，避免切换瞬间误判成两路都在播
            if (chain) continue;
            if (record.state === 'playing') return { record, kind: 'timeline', playing: true };
            if (record.state === 'paused') {
                if (!paused) paused = { record, kind: 'timeline', playing: false };
                continue;
            }
            if (record.state === 'capturing' && record.session) {
                if (!record.session.paused) return { record, kind: 'live', playing: true };
                if (!paused) paused = { record, kind: 'live', playing: false };
            }
        }
        return paused;
    }

    function syncPlaybackBar() {
        const current = findPlayback();
        const visible = Boolean(current);
        ui.playToggle.hidden = !visible;
        ui.rateCycle.hidden = !visible;
        if (!visible) return;
        const playing = current.playing;
        ui.playToggle.innerHTML = playing ? ICONS.pause : ICONS.play;
        ui.playToggle.classList.toggle('playing', playing);
        const label = playing ? '暂停播放' : '继续播放';
        ui.playToggle.title = label;
        ui.playToggle.setAttribute('aria-label', label);
        ui.playToggle.setAttribute('aria-pressed', playing ? 'true' : 'false');
    }

    function togglePlayback() {
        const current = findPlayback();
        if (!current) return;
        const { record, kind, playing } = current;
        if (kind === 'chain') {
            if (playing) host.pauseChain(record);
            else host.resumeChain(record);
        } else if (kind === 'timeline') {
            if (playing) host.pauseTimeline(record);
            else host.resumeTimeline(record);
        } else if (playing) {
            host.pauseLiveCapture(record);
        } else {
            host.resumeLiveCapture(record);
        }
        syncPlaybackBar();
    }

    ui.playToggle.addEventListener('click', togglePlayback);

    return {
        api: { syncPlaybackBar, togglePlayback },
        dispose() {
            ui.playToggle.removeEventListener('click', togglePlayback);
        },
    };
}
