// ===== 纯 WebAudio 合成音效引擎（零音频资源）=====
//
// 自洽模块：不依赖项目内其它文件。所有音效由 oscillator + gain 包络实时合成，
// 营造短促复古的 8-bit 像素风听感。AudioContext 不可用时所有方法安全 no-op。

export type SfxName =
  // 飞镖侧
  | 'throw'
  | 'hit'
  | 'bull'
  | 'miss'
  | 'combo'
  | 'comboTier' // 连击跨档里程碑
  | 'pet' // 宠物投镖
  // 金币 / 技能 / 解锁
  | 'coin'
  | 'coinBig' // 大额入账（彩票累加）
  | 'skill' // 购买/升级技能
  | 'buy' // 购买彩票
  | 'unlock' // 解锁里程碑
  // 彩票侧（一次性，经 sfx()）
  | 'lottoOpen' // 打开弹窗
  | 'tierSelect' // 选档（按档升 semi）
  | 'revealAll' // 一键揭晓
  | 'win' // match3 小奖
  | 'winLine' // line 中奖
  | 'winSum' // rush 中奖
  | 'jackpot' // 头奖（各档，semi 按档）
  | 'lottoMiss' // 彩票未中
  | 'luck'; // 幸运值 +1
// 'scratch' 为循环音，由 startScratch()/stopScratch() 管理，不走 sfx()。

// ---- localStorage 持久化（默认启用）----
const STORAGE_KEY = 'pd-audio';

function readStoredEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    // 默认启用：未存储或非 '0' 一律视为启用。
    return v !== '0';
  } catch {
    // localStorage 不可用（隐私模式 / SSR 等）时默认启用。
    return true;
  }
}

function writeStoredEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // 写入失败静默忽略。
  }
}

let enabled = readStoredEnabled();

// ---- AudioContext 懒加载 ----
// webkitAudioContext 仅存在于旧版 Safari，用窄类型断言安全访问。
type WindowWithWebkit = Window &
  typeof globalThis & { webkitAudioContext?: typeof AudioContext };

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const w = window as WindowWithWebkit;
    const Ctor: typeof AudioContext | undefined =
      w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5; // master 在各音效包络之上做总控
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
  }
  return ctx;
}

// 用户手势后首次调用时 resume()。
function tryResume(): void {
  const c = ensureContext();
  if (!c) return;
  if (c.state === 'suspended') {
    // resume 返回 Promise；忽略失败即可。
    c.resume().then(
      () => {
        /* ok */
      },
      () => {
        /* 静默降级 */
      },
    );
  }
}

// ---- 底层单音播放 ----
interface ToneSpec {
  type: OscillatorType;
  freq: number;
  freqEnd?: number; // 结束频率（用于扫频下滑/上行）
  start: number; // 相对当前时间的起始偏移（秒）
  dur: number; // 持续时长（秒）
  peak: number; // 该音峰值增益（控制响度，避免削波）
}

function playTones(specs: ToneSpec[]): void {
  const c = ensureContext();
  if (!c || !master) return;
  const now = c.currentTime;
  for (const s of specs) {
    let osc: OscillatorNode;
    let gain: GainNode;
    try {
      osc = c.createOscillator();
      gain = c.createGain();
    } catch {
      return;
    }
    osc.type = s.type;
    const t0 = now + s.start;
    const t1 = t0 + s.dur;

    // 频率曲线
    try {
      osc.frequency.setValueAtTime(s.freq, t0);
    } catch {
      /* setValueAtTime 在某些边界上可能抛出，忽略 */
    }
    if (s.freqEnd !== undefined) {
      try {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(1, s.freqEnd),
          t1,
        );
      } catch {
        /* exponentialRamp 不接受 0/负值，已 clamp；仍兜底 */
      }
    }

    // 增益包络：快速起音 + 指数衰减，避免咔哒爆音
    const peak = s.peak;
    try {
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.012, s.dur));
      gain.gain.exponentialRampToValueAtTime(0.0001, t1);
    } catch {
      /* 兜底 */
    }

    osc.connect(gain);
    gain.connect(master);

    osc.start(t0);
    osc.stop(t1 + 0.02); // 留一点尾部余量确保衰减完成

    // 播放完毕自动 stop + disconnect，避免节点泄漏
    osc.onended = () => {
      try {
        gain.disconnect();
      } catch {
        /* noop */
      }
    };
  }
}

// semi 半音偏移 -> 频率倍率
function semiMul(semi: number | undefined): number {
  if (semi === undefined || semi === 0) return 1;
  return Math.pow(2, semi / 12);
}

// ---- 各音效合成参数 ----
function playThrow(semi: number): void {
  const m = semiMul(semi);
  playTones([
    {
      type: 'triangle',
      freq: 880 * m,
      freqEnd: 320 * m,
      start: 0,
      dur: 0.18,
      peak: 0.12,
    },
  ]);
}

function playHit(semi: number): void {
  const m = semiMul(semi);
  playTones([
    { type: 'square', freq: 520 * m, start: 0, dur: 0.08, peak: 0.13 },
  ]);
}

function playBull(semi: number): void {
  const m = semiMul(semi);
  // 双音上行「叮——」，带一点和声（基频 + 五度）
  playTones([
    { type: 'sine', freq: 880 * m, start: 0, dur: 0.32, peak: 0.14 },
    { type: 'sine', freq: 1320 * m, start: 0, dur: 0.32, peak: 0.07 },
    { type: 'sine', freq: 1175 * m, start: 0.02, dur: 0.3, peak: 0.05 },
  ]);
}

function playMiss(semi: number): void {
  const m = semiMul(semi);
  playTones([
    {
      type: 'sawtooth',
      freq: 220 * m,
      freqEnd: 70 * m,
      start: 0,
      dur: 0.2,
      peak: 0.1,
    },
  ]);
}

function playCombo(semi: number): void {
  const m = semiMul(semi);
  // 明亮上行琶音三音（C5 E5 G5），整体按 semi 升调
  playTones([
    { type: 'square', freq: 523.25 * m, start: 0, dur: 0.09, peak: 0.12 },
    { type: 'square', freq: 659.25 * m, start: 0.07, dur: 0.09, peak: 0.12 },
    { type: 'square', freq: 783.99 * m, start: 0.14, dur: 0.12, peak: 0.13 },
  ]);
}

function playCoin(semi: number): void {
  const m = semiMul(semi);
  // 两个高频短方波「哔哔」
  playTones([
    { type: 'square', freq: 988 * m, start: 0, dur: 0.05, peak: 0.11 },
    { type: 'square', freq: 1319 * m, start: 0.06, dur: 0.07, peak: 0.12 },
  ]);
}

function playBuy(semi: number): void {
  const m = semiMul(semi);
  // 柔和上行和弦（A4 C#5 E5）
  playTones([
    { type: 'triangle', freq: 440 * m, start: 0, dur: 0.22, peak: 0.1 },
    { type: 'triangle', freq: 554.37 * m, start: 0, dur: 0.22, peak: 0.08 },
    { type: 'triangle', freq: 659.25 * m, start: 0.02, dur: 0.24, peak: 0.08 },
  ]);
}

// ---- 扩展音效（飞镖侧）----
function playPet(semi: number): void {
  const m = semiMul(semi);
  playTones([
    { type: 'triangle', freq: 587.33 * m, freqEnd: 783.99 * m, start: 0, dur: 0.14, peak: 0.1 },
    { type: 'sine', freq: 1174.66 * m, start: 0.06, dur: 0.06, peak: 0.05 },
  ]);
}
function playComboTier(semi: number): void {
  // 五度叠加的上行号角，连击跨档里程碑
  const m = semiMul(semi);
  playTones([
    { type: 'square', freq: 659.25 * m, start: 0, dur: 0.07, peak: 0.1 },
    { type: 'square', freq: 987.77 * m, start: 0.05, dur: 0.07, peak: 0.1 },
    { type: 'sine', freq: 1318.51 * m, start: 0.1, dur: 0.1, peak: 0.08 },
  ]);
}
function playCoinBig(semi: number): void {
  const m = semiMul(semi);
  playTones([
    { type: 'triangle', freq: 783.99 * m, start: 0, dur: 0.06, peak: 0.1 },
    { type: 'square', freq: 1046.5 * m, start: 0.045, dur: 0.06, peak: 0.09 },
    { type: 'triangle', freq: 1318.51 * m, start: 0.09, dur: 0.06, peak: 0.09 },
    { type: 'square', freq: 1567.98 * m, start: 0.135, dur: 0.08, peak: 0.1 },
  ]);
}
function playSkill(semi: number): void {
  const m = semiMul(semi);
  playTones([
    { type: 'triangle', freq: 440 * m, start: 0, dur: 0.07, peak: 0.09 },
    { type: 'triangle', freq: 523.25 * m, start: 0.055, dur: 0.07, peak: 0.09 },
    { type: 'triangle', freq: 659.25 * m, start: 0.11, dur: 0.07, peak: 0.09 },
    { type: 'sine', freq: 880 * m, start: 0.165, dur: 0.12, peak: 0.09 },
  ]);
}
function playUnlock(semi: number): void {
  const m = semiMul(semi);
  playTones([
    { type: 'sawtooth', freq: 523.25 * m, start: 0, dur: 0.08, peak: 0.1 },
    { type: 'sawtooth', freq: 659.25 * m, start: 0.07, dur: 0.08, peak: 0.1 },
    { type: 'sawtooth', freq: 783.99 * m, start: 0.14, dur: 0.08, peak: 0.1 },
    { type: 'triangle', freq: 1046.5 * m, start: 0.21, dur: 0.18, peak: 0.11 },
  ]);
}

// ---- 扩展音效（彩票侧）----
function playLottoOpen(semi: number): void {
  const m = semiMul(semi);
  playTones([
    { type: 'sine', freq: 659.25 * m, start: 0, dur: 0.1, peak: 0.09 },
    { type: 'sine', freq: 987.77 * m, start: 0.06, dur: 0.12, peak: 0.08 },
  ]);
}
function playTierSelect(semi: number): void {
  const m = semiMul(semi);
  playTones([{ type: 'triangle', freq: 440 * m, freqEnd: 587.33 * m, start: 0, dur: 0.09, peak: 0.1 }]);
}
function playRevealAll(semi: number): void {
  const m = semiMul(semi);
  playTones([
    { type: 'sine', freq: 523.25 * m, freqEnd: 1567.98 * m, start: 0, dur: 0.22, peak: 0.11 },
    { type: 'triangle', freq: 1046.5 * m, start: 0.04, dur: 0.18, peak: 0.07 },
  ]);
}
// 三个变体的中奖 sting（音色不同，玩家能"听出"中了哪种玩法）
function playWin(semi: number): void {
  const m = semiMul(semi); // match3：明亮大三和弦
  playTones([
    { type: 'square', freq: 659.25 * m, start: 0, dur: 0.08, peak: 0.1 },
    { type: 'square', freq: 830.61 * m, start: 0.06, dur: 0.08, peak: 0.1 },
    { type: 'triangle', freq: 987.77 * m, start: 0.12, dur: 0.12, peak: 0.1 },
  ]);
}
function playWinLine(semi: number): void {
  const m = semiMul(semi); // line：直线 4 音 C5-E5-G5-C6
  playTones([
    { type: 'square', freq: 523.25 * m, start: 0, dur: 0.07, peak: 0.1 },
    { type: 'square', freq: 659.25 * m, start: 0.055, dur: 0.07, peak: 0.1 },
    { type: 'square', freq: 783.99 * m, start: 0.11, dur: 0.07, peak: 0.1 },
    { type: 'square', freq: 1046.5 * m, start: 0.165, dur: 0.1, peak: 0.11 },
  ]);
}
function playWinSum(semi: number): void {
  const m = semiMul(semi); // rush：紧凑 4 音 G4-B4-D5-F5
  playTones([
    { type: 'triangle', freq: 392 * m, start: 0, dur: 0.06, peak: 0.09 },
    { type: 'triangle', freq: 493.88 * m, start: 0.05, dur: 0.06, peak: 0.09 },
    { type: 'triangle', freq: 587.33 * m, start: 0.1, dur: 0.06, peak: 0.09 },
    { type: 'triangle', freq: 698.46 * m, start: 0.15, dur: 0.1, peak: 0.1 },
  ]);
}
function playJackpot(semi: number): void {
  // 大奖：6 音上行琶音 + 高音收尾
  const m = semiMul(semi);
  const seq = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
  const specs: ToneSpec[] = seq.map((f, i) => ({
    type: (i < 3 ? 'square' : 'sine') as OscillatorType,
    freq: f * m,
    start: i * 0.055,
    dur: 0.09,
    peak: 0.11,
  }));
  specs.push({ type: 'sine', freq: 2349.32 * m, start: 0.36, dur: 0.16, peak: 0.1 });
  playTones(specs);
}
function playLottoMiss(semi: number): void {
  const m = semiMul(semi); // 比飞镖 miss 更柔
  playTones([{ type: 'triangle', freq: 392 * m, freqEnd: 293.66 * m, start: 0, dur: 0.18, peak: 0.07 }]);
}
function playLuck(semi: number): void {
  const m = semiMul(semi);
  playTones([
    { type: 'sine', freq: 587.33 * m, start: 0, dur: 0.07, peak: 0.06 },
    { type: 'sine', freq: 698.46 * m, start: 0.05, dur: 0.08, peak: 0.06 },
  ]);
}

// ---- 刮开循环音（持续摩擦感）----
// 由 startScratch 启动、stopScratch 收尾；幂等，反复 start/stop 安全。
let scratchOscs: OscillatorNode[] = [];
let scratchGain: GainNode | null = null;
function startScratch(): void {
  if (!enabled) return;
  const c = ensureContext();
  if (!c || !master) return;
  if (scratchOscs.length) return; // 已在响
  tryResume();
  try {
    scratchGain = c.createGain();
    scratchGain.gain.setValueAtTime(0.0001, c.currentTime);
    scratchGain.gain.linearRampToValueAtTime(0.03, c.currentTime + 0.008);
    scratchGain.connect(master);
    // 锯齿低频 + 三角更低频 + 慢颤，模拟涂层摩擦的白噪感
    const defs: Array<{ type: OscillatorType; freq: number }> = [
      { type: 'sawtooth', freq: 150 },
      { type: 'triangle', freq: 90 },
    ];
    for (const d of defs) {
      const osc = c.createOscillator();
      osc.type = d.type;
      osc.frequency.setValueAtTime(d.freq, c.currentTime);
      // 6Hz 摆动
      const lfo = c.createOscillator();
      const lfoGain = c.createGain();
      lfo.frequency.value = 6;
      lfoGain.gain.value = 12;
      lfo.connect(lfoGain).connect(osc.frequency);
      osc.connect(scratchGain);
      osc.start();
      lfo.start();
      scratchOscs.push(osc, lfo);
    }
  } catch {
    stopScratch();
  }
}
function stopScratch(): void {
  const c = ctx;
  if (!c || !scratchOscs.length) {
    scratchOscs = [];
    scratchGain = null;
    return;
  }
  const t = c.currentTime;
  try {
    if (scratchGain) {
      scratchGain.gain.cancelScheduledValues(t);
      scratchGain.gain.setValueAtTime(Math.max(0.0001, scratchGain.gain.value), t);
      scratchGain.gain.linearRampToValueAtTime(0.0001, t + 0.012);
    }
  } catch {
    /* ignore */
  }
  const nodes = scratchOscs;
  scratchOscs = [];
  const gain = scratchGain;
  scratchGain = null;
  window.setTimeout(() => {
    for (const n of nodes) {
      try {
        n.stop();
      } catch {
        /* noop */
      }
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
    if (gain) {
      try {
        gain.disconnect();
      } catch {
        /* noop */
      }
    }
  }, 40);
}

// ---- 公开 API ----
// ============ 背景音乐（程序生成芯片风 BGM）============
// 零音频资源：oscillator + gain 包络实时合成。lookahead 调度器循环播 8 步琶音 + 低音，
// 按 mood 切音阶/tempo/波形。所有错误吞掉，绝不影响游戏。开关/音量由 UI 传入（自洽）。
type Mood = 'menu' | 'dart' | 'lotto' | 'battle' | 'rps' | 'shooter';
interface MoodSpec { root: number; scale: number[]; step: number; wave: OscillatorType; bassEvery: number; }
const MOODS: Record<Mood, MoodSpec> = {
  menu: { root: 220, scale: [0, 3, 5, 7, 10], step: 0.42, wave: 'triangle', bassEvery: 4 },
  dart: { root: 262, scale: [0, 2, 4, 7, 9], step: 0.34, wave: 'square', bassEvery: 4 },
  lotto: { root: 196, scale: [0, 3, 5, 7, 10], step: 0.46, wave: 'triangle', bassEvery: 4 },
  battle: { root: 165, scale: [0, 3, 5, 6, 7, 10], step: 0.24, wave: 'square', bassEvery: 4 },
  rps: { root: 233, scale: [0, 2, 3, 7, 8], step: 0.3, wave: 'triangle', bassEvery: 4 },
  shooter: { root: 147, scale: [0, 3, 5, 7, 10], step: 0.2, wave: 'square', bassEvery: 2 },
};
let musicOn = true;
let musicVol = 0.5;
let musicGain: GainNode | null = null;
let musicTimer: number | null = null;
let nextNoteTime = 0;
let stepIdx = 0;
let curMood: Mood = 'menu';
function noteFreq(root: number, semis: number): number { return root * Math.pow(2, semis / 12); }
function scheduleNote(freq: number, t: number, dur: number, peak: number, wave: OscillatorType): void {
  const c = ctx; const g = musicGain;
  if (!c || !g) return;
  const osc = c.createOscillator(); const env = c.createGain();
  osc.type = wave; osc.frequency.value = freq;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  osc.connect(env); env.connect(g);
  osc.start(t); osc.stop(t + dur + 0.02);
}
function musicScheduler(): void {
  const c = ctx;
  if (!c || !musicGain) return;
  const spec = MOODS[curMood];
  const stepDur = spec.step;
  while (nextNoteTime < c.currentTime + 0.2) {
    if (musicOn) {
      const len = spec.scale.length;
      const i = stepIdx % (len * 2);
      const idx = i < len ? i : len * 2 - 1 - i;
      scheduleNote(noteFreq(spec.root, spec.scale[idx] + 12), nextNoteTime, stepDur * 0.9, 0.18, spec.wave);
      if (stepIdx % spec.bassEvery === 0) scheduleNote(noteFreq(spec.root, 0), nextNoteTime, stepDur * 1.6, 0.22, 'triangle');
    }
    nextNoteTime += stepDur;
    stepIdx++;
  }
}
function startMusicEngine(): void {
  if (musicTimer != null) return;
  const c = ensureContext();
  if (!c) return;
  if (!musicGain) {
    musicGain = c.createGain();
    musicGain.gain.value = musicOn ? musicVol * 0.12 : 0;
    musicGain.connect(c.destination);
  }
  nextNoteTime = c.currentTime + 0.1;
  musicTimer = window.setInterval(musicScheduler, 25);
}
function applyMusicGain(): void {
  if (musicGain) musicGain.gain.value = musicOn ? musicVol * 0.12 : 0;
}
let hapticsOn = true;

export const audio: {
  sfx(name: SfxName, opts?: { semi?: number }): void;
  startScratch(): void;
  stopScratch(): void;
  setEnabled(on: boolean): void;
  toggle(): boolean;
  isEnabled(): boolean;
  setMusicEnabled(on: boolean): void;
  setMusicVolume(v: number): void;
  setMusicMood(mood: Mood): void;
  unlockMusic(): void; // 用户手势后启动 BGM 引擎
  setHapticsEnabled(on: boolean): void;
  haptic(ms: number): void;
} = {
  sfx(name, opts) {
    if (!enabled) return;
    tryResume();
    const semi = opts?.semi ?? 0;
    switch (name) {
      case 'throw':
        playThrow(semi);
        break;
      case 'hit':
        playHit(semi);
        break;
      case 'bull':
        playBull(semi);
        break;
      case 'miss':
        playMiss(semi);
        break;
      case 'combo':
        playCombo(semi);
        break;
      case 'comboTier':
        playComboTier(semi);
        break;
      case 'pet':
        playPet(semi);
        break;
      case 'coin':
        playCoin(semi);
        break;
      case 'coinBig':
        playCoinBig(semi);
        break;
      case 'skill':
        playSkill(semi);
        break;
      case 'buy':
        playBuy(semi);
        break;
      case 'unlock':
        playUnlock(semi);
        break;
      case 'lottoOpen':
        playLottoOpen(semi);
        break;
      case 'tierSelect':
        playTierSelect(semi);
        break;
      case 'revealAll':
        playRevealAll(semi);
        break;
      case 'win':
        playWin(semi);
        break;
      case 'winLine':
        playWinLine(semi);
        break;
      case 'winSum':
        playWinSum(semi);
        break;
      case 'jackpot':
        playJackpot(semi);
        break;
      case 'lottoMiss':
        playLottoMiss(semi);
        break;
      case 'luck':
        playLuck(semi);
        break;
      default: {
        // noFallthroughCasesInSwitch 已穷尽；防御性兜底
        const _exhaustive: never = name;
        void _exhaustive;
      }
    }
  },

  startScratch,
  stopScratch,

  setEnabled(on) {
    enabled = on;
    writeStoredEnabled(on);
    if (!on) stopScratch(); // 关闭音效时立即停掉刮开循环，避免泄漏
    // 重新开启时在下一次 sfx 触发 resume。
  },

  toggle() {
    enabled = !enabled;
    writeStoredEnabled(enabled);
    return enabled;
  },

  isEnabled() {
    return enabled;
  },

  setMusicEnabled(on) {
    musicOn = on;
    applyMusicGain();
  },
  setMusicVolume(v) {
    musicVol = Math.max(0, Math.min(1, v));
    applyMusicGain();
  },
  setMusicMood(mood) {
    curMood = mood;
  },
  unlockMusic() {
    tryResume();
    startMusicEngine();
  },
  setHapticsEnabled(on) {
    hapticsOn = on;
  },
  haptic(ms) {
    if (!hapticsOn) return;
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* 静默 */
    }
  },
};
