// 站点自带的音色列表（与官方朗读使用同一接口参数），id 直接作为 voice 传给接口。
export const VOICE_GROUPS = [
    {
        label: '中文',
        voices: [
            { id: 'mimo_default', label: '默认' },
            { id: '冰糖', label: '冰糖（女声）' },
            { id: '茉莉', label: '茉莉（女声）' },
            { id: '苏打', label: '苏打（男声）' },
            { id: '白桦', label: '白桦（男声）' },
        ],
    },
    {
        label: 'English',
        voices: [
            { id: 'Mia', label: 'Mia（女声）' },
            { id: 'Chloe', label: 'Chloe（女声）' },
            { id: 'Milo', label: 'Milo（男声）' },
            { id: 'Dean', label: 'Dean（男声）' },
        ],
    },
];
export const DEFAULT_VOICE = 'mimo_default';
export const VOICE_LABELS = new Map(VOICE_GROUPS.flatMap(group => group.voices.map(voice => [voice.id, voice.label])));

// 分段行空间有限，只显示音色名，去掉「（女声）」这类括注；完整名称放 title
export function voiceName(voice) {
    const label = VOICE_LABELS.get(voice) || voice || '默认';
    return label.replace(/（.*?）/g, '').replace(/\(.*?\)/g, '') || label;
}
