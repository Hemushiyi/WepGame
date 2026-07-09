// ===== 全局设置（音乐/音效/振动/减少动效），持久化在 localStorage =====
// 自洽模块：不依赖项目内其它文件。各游戏/UI 读取这里的标志位。

const KEY = 'pd-settings-v1';

export interface Settings {
  music: boolean; // 背景音乐开关
  musicVol: number; // 音乐音量 0..1
  sfx: boolean; // 音效开关（与 audio.ts 的 enabled 同步）
  haptics: boolean; // 振动反馈（移动端）
  reduceMotion: boolean; // 减少动效（无障碍：关震屏/粒子/闪光）
}

const DEFAULT: Settings = {
  music: true,
  musicVol: 0.5,
  sfx: true,
  haptics: true,
  reduceMotion: false,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      // 首次：尊重系统「减少动效」无障碍偏好
      const reduce =
        typeof matchMedia === 'function' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches;
      return { ...DEFAULT, reduceMotion: reduce };
    }
    return { ...DEFAULT, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT };
  }
}

let s: Settings = load();
const listeners = new Set<() => void>();

export const settings = {
  get(): Settings {
    return s;
  },
  update(patch: Partial<Settings>): void {
    s = { ...s, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* 静默 */
    }
    for (const fn of listeners) fn();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
