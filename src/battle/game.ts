// ===== 横版打怪 demo（点屏挥剑）=====
// 独立于飞镖的实时小游戏：玩家站左侧，怪物从右走来；点屏挥剑近战，击杀掉金币进共享钱包。
// 风格与飞镖一致：复用 dart/render/contract 的 PAL / drawSprite / 像素工具 / VW×VH 坐标，
// 玩家精灵直接复用飞镖手的 CHAR_IDLE（同一角色）。
// 生命周期照飞镖 Game：start/stop 控制 rAF，resize 在 0 尺寸时早退、ResizeObserver 回页重算。
// 成长走打怪技能树：state.battleStats()（伤害/攻速/血量/暴击/吸血/金币加成）。

import {
  VW,
  VH,
  GROUND_Y,
  applyLayout,
  drawSprite,
  pixelRect,
  pixelLine,
  pixelEllipse,
  PAL,
} from '../dart/render/contract';
import { CHAR_IDLE, CHAR_SCALE } from '../dart/render/character';
import { audio } from '../shared/audio';
import { settings } from '../shared/settings';
import type { BattleStats } from '../shared/types';
import type { GameState } from '../shared/state';

// ---------- 怪物精灵（均 12 宽，scale=2） ----------
const SLIME: string[] = [
  '...kkkkkk...',
  '..kgggggggk.',
  '.kggGGggGGk.',
  '.kgwkggwkgk.',
  '.kggggggggk.',
  '.ggggggggggk',
  'kkkkkkkkkkkk',
];
const IMP: string[] = [
  '.k..kk..kk..',
  '..krrrrrrrk.',
  '.krRRrrRRrk.',
  '.kRRkrrkRRk.',
  '.krrrrrrrrk.',
  '.rrrrrrrrrrk',
  'kkkkkkkkkkkk',
];
// 岩石巨人（灰，高血慢速）
const GOLEM: string[] = [
  '..kkkkkkkk..',
  '.kWWWWWWWWk.',
  'kWDDDDDDDDWk',
  'kWDwwwwwwDWk',
  'kWDDDDDDDDWk',
  'kWWWWWWWWWWk',
  'kDDDDDDDDDDk',
  'kDDDDDDDDDDk',
  '.kDDk..kDDk.',
  '..kk....kk..',
];
// 魔王 Boss（戴冠恶魔，红体 + 金冠 + 青眼光）
const BOSS: string[] = [
  'y..yyyyyy..y',
  '..kkkkkkkk..',
  '.kRRRRRRRRk.',
  'kRRrRRRRrRRk',
  'kRReRRReRRk',
  'kRRRRRRRRRRk',
  '.kRRRRRRRRk.',
  '..kkkkkkkk..',
  '.kRRk..kRRk.',
  '..kk....kk..',
];
// 自爆怪（黑圆炸弹 + 引信火花 + 白眼，外形与小恶魔明显区分）
const BOMBER: string[] = [
  '......yy....',
  '.....kkyk...',
  '.kkkkkkkkkk.',
  'kkkkkkkkkkkk',
  'kkkwwkkwwkkk',
  'kkkkkkkkkkkk',
  '.kkkkkkkkkk.',
  '..kkkkkkkk..',
];
// 逃跑宝箱（木箱 + 金边 + 锁；会转身逃跑，击杀爆金币）
const CHEST: string[] = [
  '...kkkkkk...',
  '.ykkkkkkkky.',
  '.kknnnnnnkk.',
  '.knnNyyNnnk.',
  '.knnnnnnnnk.',
  '.knnnnnnnnk.',
  'kkkkkkkkkkkk',
];
type FoeType = 'slime' | 'imp' | 'golem' | 'bomber' | 'chest' | 'boss';
/** 精英词缀（金色光环怪） */
type Affix = 'brute' | 'regen' | 'swift';
const FOE_SPRITE: Record<FoeType, string[]> = {
  slime: SLIME,
  imp: IMP,
  golem: GOLEM,
  bomber: BOMBER,
  chest: CHEST,
  boss: BOSS,
};
const M_SCALE = 2;
const BIG_SCALE = 3; // 巨人 / 魔王体型更大
const foeScale = (t: FoeType): number => (t === 'golem' || t === 'boss' ? BIG_SCALE : M_SCALE);
const foeW = (t: FoeType): number => FOE_SPRITE[t][0].length * foeScale(t);
const foeH = (t: FoeType): number => FOE_SPRITE[t].length * foeScale(t);

// 玩家精灵尺寸（CHAR_IDLE 16×24, scale 2 → 32×48）
const P_W = CHAR_IDLE[0].length * CHAR_SCALE;
const P_H = CHAR_IDLE.length * CHAR_SCALE;

interface Monster {
  x: number; // 中心 x
  hp: number;
  maxHp: number;
  speed: number; // px/秒（正=向左走，负=向右逃）
  type: FoeType;
  hitFlash: number; // 命中白闪剩余 ms
  lastCrit?: boolean; // 最后一击是否暴击（暴击击杀给额外金币）
  elite?: Affix; // 精英词缀（金色光环）
  regenAcc?: number; // 再生词缀累加器（ms）
  flee?: boolean; // 宝箱怪：已开始逃跑
  fleeTimer?: number; // 宝箱怪：逃跑前逗留剩余 ms
}

interface Floater {
  x: number;
  y: number;
  vy: number;
  life: number; // 剩余 ms
  text: string;
  color: string;
}

/** 命中/击杀粒子（小方块，带速度与寿命） */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

/** 击杀掉落的道具（自动飞向玩家，吃到后限时增益） */
type PowerType = 'haste' | 'double' | 'shield' | 'heal' | 'rage';
interface Powerup {
  x: number;
  y: number;
  type: PowerType;
  life: number; // 未拾取的存留 ms
}
const POWER_EMOJI: Record<PowerType, string> = {
  haste: '⚡',
  double: '💥',
  shield: '🛡️',
  heal: '❤️',
  rage: '💢',
};

/** 波次 3 选 1 的临时增益（本局有效，不影响永久技能树） */
interface RunBuff {
  id: string;
  name: string;
  icon: string;
}
const RUN_BUFF_POOL: RunBuff[] = [
  { id: 'dmg', name: '+2 伤害', icon: '⚔️' },
  { id: 'cd', name: '-60 攻速冷却', icon: '⚡' },
  { id: 'hp', name: '+20 血量(回满)', icon: '❤️' },
  { id: 'ls', name: '+1 吸血', icon: '🩸' },
  { id: 'crit', name: '+15% 暴击', icon: '💥' },
  { id: 'coin', name: '+25% 金币', icon: '💰' },
  { id: 'rage', name: '击杀多+怒气', icon: '💢' },
];

interface BattleCallbacks {
  onCoins: () => void;
  onUlt: (ready: boolean) => void; // 必杀就绪态变化（UI 按钮高亮）
  onWavePick: (choices: RunBuff[], onChoose: (b: RunBuff) => void) => void; // 波次 3 选 1
  onDailyEnd: (score: number) => void; // 每日挑战结束（死亡时）→ UI 发奖并返回
}

/** 每波随机修饰词（混沌波次）：影响怪物血量/速度、刷怪间隔、金币 */
export interface Modifier {
  id: string;
  name: string;
  icon: string;
  hp: number; // 怪物血量倍率
  speed: number; // 怪物速度倍率
  spawn: number; // 刷怪间隔倍率
  coin: number; // 金币加成（加到 coinMult）
}
export const MODIFIERS: Modifier[] = [
  { id: 'blood', name: '血月', icon: '🩸', hp: 1.5, speed: 1, spawn: 1, coin: 0.8 },
  { id: 'frost', name: '冰冻', icon: '❄️', hp: 1, speed: 0.6, spawn: 1.1, coin: 0.2 },
  { id: 'haste', name: '急速', icon: '⚡', hp: 0.9, speed: 1.4, spawn: 0.85, coin: 0.4 },
  { id: 'fortune', name: '财气', icon: '💰', hp: 1, speed: 1, spawn: 1, coin: 1.0 },
  { id: 'swarm', name: '蜂拥', icon: '🌊', hp: 0.8, speed: 1.1, spawn: 0.6, coin: 0.3 },
];

export class Battle {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: GameState;
  private cb: BattleCallbacks;

  private ro?: ResizeObserver;
  private running = false;
  private rafId = 0;
  private last = 0;

  private stats: BattleStats;
  private readonly playerX = 92;

  // 局内状态
  private hp: number;
  private wave = 1;
  private kills = 0;
  private nextBossKills = 15; // 达到该击杀数时召唤魔王 Boss
  private monsters: Monster[] = [];
  private floaters: Floater[] = [];
  private stars: Array<{ x: number; y: number; p: number }> = [];
  private spawnTimer = 500;
  private nearSpawnsLeft = 3; // 开局前几只就近登场，避免长时间空等
  private waveMod: Modifier | null = null; // 当前波次的混沌修饰词
  private dailyMode = false; // 每日挑战模式：死亡即结算返回，不可自由重生
  private swingCd = 0; // 挥剑冷却剩余 ms
  private swingTimer = 0; // 挥剑动画剩余 ms（>0 表示正在挥）
  private playerFlash = 0; // 受伤红闪
  private playerInvuln = 0; // 受伤无敌帧
  private dead = false;
  private time = 0;

  // 打击感（juice）
  private shake = 0; // 屏幕震动幅度（px），逐帧衰减
  private freeze = 0; // 命中卡顿剩余 ms（>0 时跳过 update）
  private particles: Particle[] = [];
  private flash = 0; // 全屏闪光强度 0..1
  private flashColor = '#ffffff';
  // 怒气 / 必杀
  private rage = 0;
  private readonly rageMax = 100;
  private ultReady = false;
  // 道具增益
  private powerups: Powerup[] = [];
  private buffHaste = 0; // 攻速增益剩余 ms
  private buffDouble = 0; // 双倍伤害剩余 ms
  private shieldCharges = 0; // 护盾层数
  // 连击 / 狂热（连杀不挨打 → FEVER：金币×1.5 + 屏边发光）
  private combo = 0;
  private fever = false;
  // 波次 3 选 1 累积的本局临时增益
  private rbDmg = 0;
  private rbCd = 0;
  private rbMaxHp = 0;
  private rbLifesteal = 0;
  private rbCrit = 0;
  private rbCoin = 0;
  private rbRage = 0;

  constructor(canvas: HTMLCanvasElement, state: GameState, cb: BattleCallbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.state = state;
    this.cb = cb;
    this.stats = state.battleStats();
    this.hp = this.effMaxHp();
    this.genStars();

    this.resize();
    canvas.addEventListener('pointerdown', this.onPointerDown);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(this.resize);
      this.ro.observe(canvas);
    }
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
  }

  /** 生成确定性星点（一次性，基于索引哈希，不随帧变） */
  private genStars(): void {
    this.stars = [];
    for (let i = 0; i < 46; i++) {
      const h = (i * 9301 + 49297) % 233280;
      const r1 = h / 233280;
      const r2 = ((i * 49297 + 9301) % 233280) / 233280;
      this.stars.push({ x: Math.round(r1 * 640), y: Math.round(r2 * (GROUND_Y - 30)), p: r1 });
    }
  }

  start(): void {
    if (this.running) return;
    // 重新进入一局（非每日模式）若处于死亡态，自动开新一局，避免落地即 GAME OVER
    if (this.dead && !this.dailyMode) this.respawn();
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  /** 进入每日挑战：固定修饰词、重置一局、死亡即结算。由 ui.ts 在 go('battle') 后调用。 */
  startDaily(mod: Modifier): void {
    this.dailyMode = true;
    this.waveMod = mod;
    this.respawn();
    this.waveMod = mod; // respawn 会清空 waveMod，重设
    this.addFloater(VW / 2, VH / 2 - 30, `🎁 每日挑战 · ${mod.icon}${mod.name}`, '#7df9ff');
    this.start();
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    // 离开时把本局赚到的金币落盘（earn 不自动 save）
    this.state.save();
  }

  /** 暂停循环但不落盘（开技能弹窗时调用，避免被打）。用 start() 恢复。 */
  pause(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /** 技能树变动后重算派生属性；maxHp 可能提升，当前血量按上限钳制 */
  syncAfterBuy(): void {
    this.stats = this.state.battleStats();
    if (this.hp > this.effMaxHp()) this.hp = this.effMaxHp();
  }
  // ---- 生效属性（永久技能 + 波次临时增益叠加）----
  private effDamage(): number {
    return this.stats.damage + this.rbDmg;
  }
  private effCooldown(): number {
    return Math.max(120, this.stats.cooldown + this.rbCd);
  }
  private effMaxHp(): number {
    return this.stats.maxHp + this.rbMaxHp + this.state.metaHP();
  }
  private effLifesteal(): number {
    return this.stats.lifesteal + this.rbLifesteal;
  }
  private effCrit(): number {
    return Math.min(0.9, this.stats.crit + this.rbCrit);
  }
  /** 金币倍率：技能 + 波次增益 + FEVER + 混沌修饰词 */
  private coinMult(): number {
    return 1 + this.stats.coinBonus + this.rbCoin + (this.fever ? 0.5 : 0) + (this.waveMod?.coin ?? 0);
  }
  /** 应用波次 3 选 1 增益 */
  applyRunBuff(b: RunBuff): void {
    switch (b.id) {
      case 'dmg': this.rbDmg += 2; break;
      case 'cd': this.rbCd -= 60; break;
      case 'hp': this.rbMaxHp += 20; this.hp = this.effMaxHp(); break;
      case 'ls': this.rbLifesteal += 1; break;
      case 'crit': this.rbCrit += 0.15; break;
      case 'coin': this.rbCoin += 0.25; break;
      case 'rage': this.rbRage += 15; break;
    }
    audio.sfx('skill');
  }

  /** 按舞台实际宽高比重算虚拟宽（与飞镖一致），画布铺满无变形 */
  private resize = (): void => {
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    if (!cssW || !cssH) return;
    const aspect = cssW / cssH;
    const vw = Math.max(480, Math.min(1300, Math.round(VH * aspect)));
    applyLayout(vw);
    this.canvas.width = vw;
    this.canvas.height = VH;
    this.ctx.imageSmoothingEnabled = false;
  };

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.dead) {
      // 每日挑战：死亡即结算返回（交 UI 发奖）；普通模式：点屏重生
      if (this.dailyMode) {
        const score = this.kills;
        this.dailyMode = false;
        this.cb.onDailyEnd(score);
        return;
      }
      this.respawn();
      return;
    }
    this.trySwing();
  };

  // ---------- 战斗 ----------
  private trySwing(): void {
    if (this.swingCd > 0 || this.dead) return;
    // 加速增益：冷却减半
    const cd = this.effCooldown();
    this.swingCd = this.buffHaste > 0 ? Math.round(cd * 0.5) : cd;
    this.swingTimer = 160;
    audio.sfx('throw');
    // 即时判定：挥剑瞬间对前方所有怪物造成伤害
    const reach = this.playerX + 84;
    let hitAny = false;
    for (const m of this.monsters) {
      if (m.x < this.playerX - 6 || m.x > reach) continue;
      let dmg = this.effDamage();
      const crit = Math.random() < this.effCrit();
      if (crit) dmg = Math.round(dmg * this.stats.critMult);
      if (this.buffDouble > 0) dmg *= 2; // 双倍伤害增益
      m.hp -= dmg;
      m.lastCrit = crit;
      m.hitFlash = 90;
      m.x += 16; // 击退
      // 宝箱怪一旦被命中立即开始逃跑
      if (m.type === 'chest' && !m.flee) {
        m.flee = true;
        m.fleeTimer = 0;
      }
      // 打击感
      this.burst(m.x, GROUND_Y - foeH(m.type) / 2, crit ? 10 : 5, crit ? PAL['y'] : PAL['w']);
      if (crit) {
        this.addShake(5);
        this.addFreeze(50);
        audio.haptic(25);
      } else {
        this.addShake(2);
        audio.haptic(12);
      }
      this.addFloater(m.x, GROUND_Y - foeH(m.type) - 6, String(dmg), crit ? '#ffd45e' : '#ffffff');
      const ls = this.effLifesteal();
      if (ls > 0 && this.hp < this.effMaxHp()) {
        this.hp = Math.min(this.effMaxHp(), this.hp + ls);
      }
      this.gainRage(8);
      hitAny = true;
    }
    if (hitAny) audio.sfx('hit');
    // 清理死亡怪物 + 结算（倒序删除）
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      if (this.monsters[i].hp <= 0) this.killMonster(this.monsters[i], i);
    }
  }

  private killMonster(m: Monster, i: number): void {
    this.monsters.splice(i, 1);
    this.kills++;
    // 成就计数
    this.state.incAchv('kills');
    if (m.type === 'chest') this.state.incAchv('chests');
    if (m.elite) this.state.incAchv('elites');
    if (m.type === 'boss') this.state.incAchv('bosses');
    this.state.recordAchvMax('maxWave', this.wave);
    // 连击（连杀不挨打）→ FEVER 狂热
    this.combo++;
    if (!this.fever && this.combo >= 10) {
      this.fever = true;
      this.state.incAchv('fever');
      this.addFloater(VW / 2, VH / 2 - 30, '🔥 FEVER! 金币×1.5', '#ffd45e');
      this.addFlash('#ffd45e', 0.4);
      audio.sfx('comboTier');
    }
    // 基础金币按怪物类型 + 波次；宝箱怪/精英/Boss/暴击/FEVER 加成
    const isChest = m.type === 'chest';
    const base = isChest ? 30 : m.type === 'boss' ? 40 : m.type === 'golem' ? 10 : m.type === 'imp' ? 6 : 4;
    const critKill = !!m.lastCrit;
    let coin = Math.round((base + this.wave) * this.coinMult());
    if (critKill) coin *= 2;
    if (m.elite) coin = Math.round(coin * 1.8);
    if (isChest) coin += 20 + this.wave * 5; // 宝箱怪大奖
    this.state.earn(coin);
    this.cb.onCoins();
    const fy = GROUND_Y - foeH(m.type) - 14;
    this.addFloater(m.x, fy, `${critKill ? '💥' : ''}+🪙${coin}`, critKill || isChest ? '#ffd45e' : '#ffe9a8');
    audio.sfx(isChest ? 'jackpot' : m.type === 'boss' ? 'jackpot' : this.wave >= 4 ? 'coinBig' : 'coin');
    // 打击感 + 怒气 + 道具掉落
    this.burst(m.x, GROUND_Y - foeH(m.type) / 2, isChest || m.type === 'boss' ? 26 : 8, critKill ? PAL['y'] : PAL[m.type === 'imp' || m.type === 'bomber' ? 'r' : 'g']);
    this.addShake(isChest || m.type === 'boss' ? 8 : critKill ? 4 : 2);
    if (isChest || m.type === 'boss') {
      this.addFlash('#ffd45e', 0.5);
      this.addFreeze(80);
    }
    this.gainRage((m.type === 'boss' ? 35 : 12) + this.rbRage);
    this.maybeDropPower(m.x);
    // 稀有心掉落：回 1 血
    if (!this.dead && Math.random() < 0.08 && this.hp < this.effMaxHp()) {
      this.hp = Math.min(this.effMaxHp(), this.hp + 1);
      this.addFloater(m.x, fy - 14, '❤+1', '#e84753');
    }
    // 每 10 击杀晋级一波（弹 3 选 1 临时增益 + 随机混沌修饰词）
    if (this.kills % 10 === 0) {
      this.wave++;
      this.waveMod = MODIFIERS[Math.floor(Math.random() * MODIFIERS.length)];
      this.state.recordAchvMax('maxWave', this.wave);
      this.addFloater(VW / 2, VH / 2, `WAVE ${this.wave} · ${this.waveMod.icon}${this.waveMod.name}`, '#7df9ff');
      audio.sfx('combo');
      this.triggerWavePick();
    }
    // 每 15 击杀刷一只魔王 Boss
    if (this.kills === this.nextBossKills) {
      this.nextBossKills += 15;
      this.spawnBoss();
    }
  }

  /** 立即召唤一只魔王 Boss（里程碑奖励型强敌） */
  private spawnBoss(): void {
    if (this.dead) return;
    const hp = 30 + this.wave * 3;
    this.monsters.push({
      x: VW + 30,
      hp,
      maxHp: hp,
      speed: Math.min(22 + this.wave, 60),
      type: 'boss',
      hitFlash: 0,
    });
    this.addFloater(VW / 2, VH / 2 - 30, '⚠ BOSS ⚠', '#e84753');
    audio.sfx('unlock');
  }

  private damagePlayer(n: number): void {
    if (this.dead || this.playerInvuln > 0) return;
    // 护盾吸收
    if (this.shieldCharges > 0) {
      this.shieldCharges--;
      this.playerInvuln = 480;
      this.addShake(3);
      this.burst(this.playerX, GROUND_Y - P_H / 2, 12, PAL['e']);
      this.addFloater(this.playerX, GROUND_Y - P_H - 14, '🛡格挡!', PAL['e']);
      audio.sfx('skill');
      return;
    }
    this.hp -= n;
    this.playerFlash = 300;
    this.playerInvuln = 720;
    this.addShake(5);
    this.addFlash('#e84753', 0.4);
    this.burst(this.playerX, GROUND_Y - P_H / 2, 10, PAL['A']);
    audio.haptic(45);
    // 挨打 → 连击/FEVER 中断
    if (this.combo > 0 || this.fever) {
      this.combo = 0;
      if (this.fever) {
        this.fever = false;
        this.addFloater(VW / 2, VH / 2 - 30, 'FEVER 中断', '#9a93c0');
      }
    }
    audio.sfx('lottoMiss');
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      audio.sfx('miss');
      this.state.save();
    }
  }

  private respawn(): void {
    this.dead = false;
    this.hp = this.effMaxHp();
    this.monsters = [];
    this.wave = 1;
    this.waveMod = null;
    this.spawnTimer = 500;
    this.nearSpawnsLeft = 3;
    this.playerInvuln = 500;
    this.rage = 0;
    this.ultReady = false;
    this.cb.onUlt(false);
    this.powerups = [];
    this.particles = [];
    this.buffHaste = 0;
    this.buffDouble = 0;
    this.shieldCharges = 0;
    this.combo = 0;
    this.fever = false;
    // 本局临时增益随死亡清空（永久技能树不受影响）
    this.rbDmg = this.rbCd = this.rbMaxHp = this.rbLifesteal = this.rbCrit = this.rbCoin = this.rbRage = 0;
    this.shake = 0;
    this.flash = 0;
  }

  /** 晋级新波次：从增益池随机抽 3 个，弹窗让玩家 3 选 1（暂停中） */
  private triggerWavePick(): void {
    if (this.dead) return;
    const pool = [...RUN_BUFF_POOL];
    // 洗牌取前 3
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const choices = pool.slice(0, 3);
    this.pause();
    this.cb.onWavePick(choices, (b) => {
      this.applyRunBuff(b);
      this.start(); // 选完恢复
    });
  }

  private addFloater(x: number, y: number, text: string, color: string): void {
    if (this.floaters.length > 24) this.floaters.shift();
    this.floaters.push({ x, y, vy: -0.05, life: 720, text, color });
  }

  // ---------- 打击感（juice）----------
  private addShake(n: number): void {
    if (settings.get().reduceMotion) return;
    this.shake = Math.min(14, this.shake + n);
  }
  private addFreeze(ms: number): void {
    if (settings.get().reduceMotion) return;
    this.freeze = Math.max(this.freeze, ms);
  }
  private addFlash(color: string, strength = 0.5): void {
    if (settings.get().reduceMotion) return;
    this.flashColor = color;
    this.flash = Math.min(0.8, Math.max(this.flash, strength));
  }
  /** 在 (x,y) 炸出 n 个粒子 */
  private burst(x: number, y: number, n: number, color: string, speed = 0.18): void {
    if (this.particles.length > 160) this.particles.splice(0, 40);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random());
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 0.05,
        life: 320 + Math.random() * 220,
        color,
        size: 2 + (Math.random() < 0.3 ? 1 : 0),
      });
    }
  }
  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.0006 * dt; // 微重力
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  // ---------- 怒气 / 必杀 ----------
  private gainRage(n: number): void {
    if (this.ultReady) return; // 满了不再累加
    this.rage = Math.min(this.rageMax, this.rage + n);
    if (this.rage >= this.rageMax) {
      this.ultReady = true;
      this.cb.onUlt(true);
      this.addFloater(this.playerX, GROUND_Y - P_H - 30, 'ULT READY!', '#ffd45e');
      audio.sfx('combo');
    }
  }
  /** 必杀：旋风斩 —— 对全场怪物造成大范围伤害 + 击退 + 爆发 */
  ultimate(): void {
    if (!this.ultReady || this.dead) return;
    this.ultReady = false;
    this.rage = 0;
    this.cb.onUlt(false);
    audio.sfx('jackpot');
    this.addShake(12);
    this.addFlash('#ffffff', 0.7);
    this.addFreeze(90);
    const cx = this.playerX + 40;
    const cy = GROUND_Y - 30;
    this.burst(cx, cy, 40, PAL['y'], 0.32);
    this.burst(cx, cy, 24, PAL['e'], 0.26);
    // 环形冲击：对所有怪物造成伤害（威力随波次）
    const dmg = 8 + this.wave * 2 + this.effDamage() * 2;
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      m.hp -= dmg;
      m.hitFlash = 120;
      m.lastCrit = true;
      m.x += 40; // 强击退
      this.burst(m.x, GROUND_Y - foeH(m.type) / 2, 8, PAL['o']);
      if (m.hp <= 0) this.killMonster(m, i);
    }
    this.addFloater(VW / 2, GROUND_Y - 70, '💢 旋风斩!', '#ffd45e');
  }

  // ---------- 道具 ----------
  private maybeDropPower(x: number): void {
    if (Math.random() < 0.13) {
      const pool: PowerType[] = ['haste', 'double', 'shield', 'heal', 'rage'];
      const t = pool[Math.floor(Math.random() * pool.length)];
      this.powerups.push({ x, y: GROUND_Y - 16, type: t, life: 6000 });
    }
  }
  private updatePowerups(dt: number): void {
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      p.life -= dt;
      // 飞向玩家
      const tx = this.playerX;
      const ty = GROUND_Y - P_H / 2;
      p.x += (tx - p.x) * 0.06;
      p.y += (ty - p.y) * 0.06;
      if (Math.hypot(p.x - tx, p.y - ty) < 20 || p.life <= 0) {
        if (p.life > 0) this.applyPower(p.type);
        this.powerups.splice(i, 1);
      }
    }
  }
  private applyPower(t: PowerType): void {
    audio.sfx('skill');
    switch (t) {
      case 'haste':
        this.buffHaste = 6000;
        this.addFloater(this.playerX, GROUND_Y - P_H - 14, POWER_EMOJI[t] + '加速!', PAL['e']);
        break;
      case 'double':
        this.buffDouble = 6000;
        this.addFloater(this.playerX, GROUND_Y - P_H - 14, POWER_EMOJI[t] + '双倍!', PAL['y']);
        break;
      case 'shield':
        this.shieldCharges = Math.min(3, this.shieldCharges + 1);
        this.addFloater(this.playerX, GROUND_Y - P_H - 14, POWER_EMOJI[t] + '护盾!', PAL['e']);
        break;
      case 'heal':
        this.hp = Math.min(this.effMaxHp(), this.hp + 2);
        this.addFloater(this.playerX, GROUND_Y - P_H - 14, POWER_EMOJI[t] + '+2', '#e84753');
        break;
      case 'rage':
        this.gainRage(50);
        this.addFloater(this.playerX, GROUND_Y - P_H - 14, POWER_EMOJI[t] + '怒气!', '#ffd45e');
        break;
    }
  }

  // ---------- 主循环 ----------
  private loop = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(50, now - this.last);
    this.last = now;
    this.time += dt;
    // 命中卡顿：freeze 期间不推进游戏逻辑，仍渲染（含粒子衰减）以呈现定格
    if (this.freeze > 0) this.freeze -= dt;
    else this.update(dt);
    this.shake = Math.max(0, this.shake - dt * 0.04);
    this.flash = Math.max(0, this.flash - dt * 0.003);
    this.updateParticles(dt);
    this.updatePowerups(dt);
    this.render();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    if (this.dead) return;
    if (this.swingCd > 0) this.swingCd -= dt;
    if (this.swingTimer > 0) this.swingTimer -= dt;
    if (this.playerFlash > 0) this.playerFlash -= dt;
    if (this.playerInvuln > 0) this.playerInvuln -= dt;
    if (this.buffHaste > 0) this.buffHaste -= dt;
    if (this.buffDouble > 0) this.buffDouble -= dt;

    // 生成怪物（节奏随机化：基础间隔 × 0.55..1.45 的抖动，偶尔双连刷）
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.monsters.length < 10) {
      this.spawnMonster();
      const base = Math.max(460, 1500 - this.wave * 90);
      const spawnMult = this.waveMod ? this.waveMod.spawn : 1;
      this.spawnTimer = base * (0.55 + Math.random() * 0.9) * spawnMult;
      // 高波次偶尔一次刷两只，制造节奏起伏
      if (this.wave >= 3 && Math.random() < 0.18 && this.monsters.length < 9) this.spawnMonster();
    }

    // 怪物推进 + 接触判定
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      // 宝箱怪：到点或被命中后转身逃跑（向右）
      if (m.type === 'chest' && !m.flee) {
        m.fleeTimer = (m.fleeTimer ?? 2200) - dt;
        if (m.fleeTimer <= 0) m.flee = true;
      }
      const dir = m.flee ? 1 : -1;
      m.x += (dir * m.speed * dt) / 1000;
      if (m.hitFlash > 0) m.hitFlash -= dt;
      // 精英再生
      if (m.elite === 'regen' && m.hp < m.maxHp) {
        m.regenAcc = (m.regenAcc ?? 0) + dt;
        if (m.regenAcc >= 1500) {
          m.regenAcc -= 1500;
          m.hp = Math.min(m.maxHp, m.hp + 1);
        }
      }
      // 宝箱怪逃跑出屏 → 错过
      if (m.type === 'chest' && m.flee && m.x > VW + 50) {
        this.monsters.splice(i, 1);
        continue;
      }
      // 接触玩家：扣血并自爆（自爆怪/狂暴精英 2 伤；宝箱怪不伤人，碰到就逃）
      if (m.type !== 'chest' && m.x - foeW(m.type) / 2 <= this.playerX + 14) {
        const dmg = m.type === 'bomber' || m.elite === 'brute' ? 2 : 1;
        this.damagePlayer(dmg);
        if (m.type === 'bomber') {
          this.burst(m.x, GROUND_Y - foeH(m.type) / 2, 18, PAL['O']);
          this.addShake(7);
          this.addFloater(this.playerX, GROUND_Y - P_H + 8, '💥自爆!', '#e84753');
        } else {
          this.addFloater(this.playerX, GROUND_Y - P_H + 8, m.elite === 'brute' ? '💥狂暴!' : '💥', '#e84753');
        }
        this.monsters.splice(i, 1);
      } else if (m.type === 'chest' && !m.flee && m.x - foeW(m.type) / 2 <= this.playerX + 14) {
        m.flee = true; // 宝箱怪碰到玩家也立即逃
      }
    }

    // 浮字（vy 单位：px/ms，按 dt 累加；渲染时取整）
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.y += f.vy * dt;
      f.life -= dt;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }
  }

  /** 定时刷的普通怪：类型随击杀数升级（史莱姆 → 恶魔 → 岩石巨人） */
  /** 定时刷的普通怪：类型随击杀数升级（史莱姆 → 恶魔 → 岩石巨人 / 自爆怪） */
  private spawnMonster(): void {
    const k = this.kills;
    const r = Math.random();
    let type: FoeType;
    // 稀有逃跑宝箱怪（wave>=2，~6% 概率替换普通怪）
    if (this.wave >= 2 && Math.random() < 0.06) {
      type = 'chest';
    } else if (k < 5) {
      type = 'slime';
    } else if (k < 15) {
      type = r < 0.6 ? 'slime' : 'imp';
    } else if (r < 0.35) {
      type = 'imp';
    } else if (r < 0.6) {
      type = 'slime';
    } else if (r < 0.8) {
      type = 'golem';
    } else {
      type = 'bomber';
    }
    const w = this.wave;
    // 精英词缀（金色光环怪，wave>=2 起随机出现；宝箱/Boss 不精英）
    let elite: Affix | undefined;
    if (type !== 'chest' && this.wave >= 2 && Math.random() < 0.12) {
      elite = (['brute', 'regen', 'swift'] as Affix[])[Math.floor(Math.random() * 3)];
    }
    let hp =
      type === 'chest'
        ? 5 + Math.floor(w * 0.5)
        : type === 'golem'
          ? 8 + Math.floor(w * 1.4)
          : type === 'bomber'
            ? 2 + Math.floor(w * 0.4)
            : type === 'imp'
              ? 4 + Math.floor(w * 0.9)
              : 2 + Math.floor(w * 0.7);
    if (elite) hp = Math.round(hp * 1.4); // 精英血量更高
    if (type !== 'chest' && this.waveMod) hp = Math.max(1, Math.round(hp * this.waveMod.hp)); // 混沌修饰
    const base = type === 'chest' ? 70 : type === 'golem' ? 30 : type === 'bomber' ? 80 : type === 'imp' ? 62 : 46;
    let speed = Math.min(base + w * 2, 105);
    if (this.waveMod) speed *= this.waveMod.speed; // 混沌修饰
    if (elite === 'swift') speed = Math.min(speed * 1.6, 150); // 迅捷精英加速
    // 宝箱怪始终从屏外入场（给玩家反应/追赶时间）；其余前几只就近
    const x = type === 'chest' || this.nearSpawnsLeft <= 0 ? VW + 30 : Math.round(VW * (0.5 + Math.random() * 0.16));
    if (type !== 'chest' && this.nearSpawnsLeft > 0) this.nearSpawnsLeft--;
    this.monsters.push({ x, hp, maxHp: hp, speed, type, hitFlash: 0, elite, fleeTimer: type === 'chest' ? 2200 : undefined });
  }

  // ---------- 渲染 ----------
  private render(): void {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    // 屏幕震动
    if (this.shake > 0.2) {
      ctx.translate(Math.round((Math.random() * 2 - 1) * this.shake), Math.round((Math.random() * 2 - 1) * this.shake));
    }
    this.drawBackground(ctx);

    // 怪物（按 x 倒序，远的先画）
    const sorted = [...this.monsters].sort((a, b) => b.x - a.x);
    for (const m of sorted) this.drawMonster(ctx, m);

    // 道具
    this.drawPowerups(ctx);

    // 玩家
    this.drawPlayer(ctx);
    if (this.swingTimer > 0) this.drawSword(ctx);

    // 粒子
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 400));
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // 浮字
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.floaters) {
      const alpha = Math.max(0, Math.min(1, f.life / 720));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = f.color;
      ctx.font = "10px 'Press Start 2P', monospace";
      ctx.fillText(f.text, Math.round(f.x), Math.round(f.y));
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // HUD 不受震动影响
    this.drawHud(ctx);
    if (this.dead) this.drawGameOver(ctx);

    // 全屏闪光
    if (this.flash > 0.01) {
      ctx.globalAlpha = this.flash;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, VW, VH);
      ctx.globalAlpha = 1;
    }
    // FEVER 狂热：屏边金色发光
    if (this.fever) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.2 * Math.sin(this.time / 150);
      ctx.strokeStyle = PAL['y'];
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, VW - 8, VH - 8);
      ctx.restore();
    }
  }

  private drawPowerups(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '16px serif';
    for (const p of this.powerups) {
      ctx.globalAlpha = Math.max(0.4, Math.min(1, p.life / 6000));
      ctx.fillText(POWER_EMOJI[p.type], Math.round(p.x), Math.round(p.y));
    }
    ctx.globalAlpha = 1;
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    // 夜空渐变
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#0b0a1f');
    g.addColorStop(0.6, '#1b1340');
    g.addColorStop(1, '#241a4a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);

    // 星点（微闪烁）
    for (const s of this.stars) {
      const tw = 0.5 + 0.5 * Math.sin(this.time / 700 + s.p * 8);
      ctx.globalAlpha = 0.35 + tw * 0.5;
      ctx.fillStyle = PAL['w'];
      ctx.fillRect(s.x % VW, s.y, 2, 2);
    }
    ctx.globalAlpha = 1;

    // 月亮
    ctx.save();
    ctx.globalAlpha = 0.85;
    pixelEllipse(ctx, VW - 90, 56, 16, 16, PAL['m']);
    ctx.restore();

    // 远山（两层暗紫弧）
    ctx.save();
    ctx.globalAlpha = 0.5;
    pixelEllipse(ctx, VW * 0.3, GROUND_Y + 6, 120, 60, PAL['u']);
    pixelEllipse(ctx, VW * 0.7, GROUND_Y + 6, 150, 72, PAL['t']);
    ctx.restore();

    // 地面
    pixelRect(ctx, 0, GROUND_Y, VW, VH - GROUND_Y, '#1a1438');
    // 草地亮线 + 碎草
    pixelRect(ctx, 0, GROUND_Y, VW, 3, PAL['G']);
    for (let x = 8; x < VW; x += 22) {
      pixelRect(ctx, x, GROUND_Y - 2, 2, 2, PAL['g']);
      pixelRect(ctx, x + 6, GROUND_Y - 1, 2, 1, PAL['g']);
    }
  }

  private drawMonster(ctx: CanvasRenderingContext2D, m: Monster): void {
    const sc = foeScale(m.type);
    const mw = foeW(m.type);
    const mh = foeH(m.type);
    const bob = Math.round(Math.sin(this.time / 200 + m.x) * 1); // 走动微抖
    const sx = Math.round(m.x - mw / 2);
    const sy = Math.round(GROUND_Y - mh) + bob;
    // 阴影（越大越宽）
    ctx.save();
    ctx.globalAlpha = 0.3;
    const sw = Math.round(mw / 2 + 2);
    pixelEllipse(ctx, Math.round(m.x), GROUND_Y - 1, sw, 3, PAL['K']);
    ctx.restore();
    drawSprite(ctx, FOE_SPRITE[m.type], sx, sy, sc, false);
    // 精英怪：金色脉动光环 + 词缀标记
    if (m.elite) {
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.3 * Math.sin(this.time / 160);
      ctx.strokeStyle = PAL['y'];
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - 4, sy - 4, mw + 8, mh + 8);
      ctx.restore();
      ctx.fillStyle = PAL['y'];
      ctx.font = '10px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tag = m.elite === 'brute' ? '💪' : m.elite === 'regen' ? '🩸' : '⚡';
      ctx.fillText(tag, Math.round(m.x), sy - 10);
    }
    // 自爆怪：靠近玩家时闪红警示
    if (m.type === 'bomber' && m.x < this.playerX + 150 && Math.floor(this.time / 100) % 2 === 0) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      pixelRect(ctx, sx, sy, mw, mh, '#e84753');
      ctx.restore();
    }
    // 命中白闪
    if (m.hitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      pixelRect(ctx, sx, sy, mw, mh, '#ffffff');
      ctx.restore();
    }
    // 血条（多血怪物显示；Boss 用金色）
    if (m.maxHp > 2) {
      const bw = mw + 8;
      const bx = Math.round(m.x - bw / 2);
      pixelRect(ctx, bx, sy - 6, bw, 3, PAL['K']);
      pixelRect(ctx, bx, sy - 6, Math.round((bw * Math.max(0, m.hp)) / m.maxHp), 3, m.type === 'boss' ? PAL['y'] : PAL['A']);
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    const bob = Math.round(Math.sin(this.time / 600) * 1);
    const sx = Math.round(this.playerX - P_W / 2);
    const sy = Math.round(GROUND_Y - P_H) + bob;
    // 阴影
    ctx.save();
    ctx.globalAlpha = 0.34;
    pixelEllipse(ctx, this.playerX, GROUND_Y - 1, 14, 4, PAL['K']);
    ctx.restore();
    // 受伤闪烁：无敌帧期间隔帧闪红覆盖
    const flashOn = this.playerFlash > 0 && Math.floor(this.time / 80) % 2 === 0;
    drawSprite(ctx, CHAR_IDLE, sx, sy, CHAR_SCALE, false);
    if (flashOn) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      pixelRect(ctx, sx, sy, P_W, P_H, '#e84753');
      ctx.restore();
    }
    // 护盾光环
    if (this.shieldCharges > 0) {
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.2 * Math.sin(this.time / 200);
      ctx.strokeStyle = PAL['e'];
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - 4, sy - 4, P_W + 8, P_H + 8);
      ctx.restore();
    }
  }

  /** 挥剑动画：剑刃从右上扫到水平前方 */
  private drawSword(ctx: CanvasRenderingContext2D): void {
    const p = 1 - this.swingTimer / 160; // 0→1
    const handX = this.playerX + 10;
    const handY = GROUND_Y - 30;
    const ang = (-65 + p * 78) * (Math.PI / 180); // -65° → +13°
    const len = 40;
    const tipX = handX + Math.cos(ang) * len;
    const tipY = handY + Math.sin(ang) * len;
    // 剑刃
    pixelLine(ctx, handX, handY, Math.round(tipX), Math.round(tipY), PAL['w']);
    pixelLine(ctx, handX, handY - 1, Math.round(tipX), Math.round(tipY) - 1, PAL['e']);
    // 护手
    pixelRect(ctx, handX - 2, handY - 2, 5, 4, PAL['y']);
    // 扫击残影（一段弧）
    ctx.save();
    ctx.globalAlpha = 0.4 * (1 - p);
    for (let k = 0; k < 4; k++) {
      const a = ang - (k + 1) * 0.18;
      pixelLine(
        ctx,
        handX,
        handY,
        Math.round(handX + Math.cos(a) * len),
        Math.round(handY + Math.sin(a) * len),
        PAL['e'],
      );
    }
    ctx.restore();
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    // HP 条（左上）
    const bx = 14;
    const by = 14;
    const bw = 130;
    const bh = 14;
    pixelRect(ctx, bx - 2, by - 2, bw + 4, bh + 4, PAL['K']);
    pixelRect(ctx, bx, by, bw, bh, '#2a2150');
    const ratio = Math.max(0, this.hp / this.effMaxHp());
    const hpColor = ratio > 0.5 ? PAL['g'] : ratio > 0.25 ? PAL['y'] : PAL['A'];
    pixelRect(ctx, bx, by, Math.round(bw * ratio), bh, hpColor);
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`HP ${this.hp}/${this.effMaxHp()}`, bx + 4, by + 3);

    // 怒气条（HP 条下方）
    const rx = bx;
    const ry = by + bh + 4;
    const rw = bw;
    pixelRect(ctx, rx - 2, ry - 2, rw + 4, 9, PAL['K']);
    pixelRect(ctx, rx, ry, rw, 5, '#2a2150');
    const rageRatio = this.rage / this.rageMax;
    pixelRect(ctx, rx, ry, Math.round(rw * rageRatio), 5, this.ultReady ? PAL['y'] : PAL['O']);
    ctx.textAlign = 'left';
    ctx.fillStyle = this.ultReady ? PAL['y'] : PAL['m'];
    ctx.font = "7px 'Press Start 2P', monospace";
    ctx.fillText(this.ultReady ? 'ULT READY 💢' : `RAGE ${Math.round(rageRatio * 100)}%`, rx, ry + 8);

    // 激活中的增益（怒气条下方）
    let buffY = ry + 20;
    ctx.font = '12px serif';
    if (this.buffHaste > 0) { ctx.fillStyle = PAL['e']; ctx.fillText('⚡' + Math.ceil(this.buffHaste / 1000) + 's', rx, buffY); buffY += 14; }
    if (this.buffDouble > 0) { ctx.fillStyle = PAL['y']; ctx.fillText('💥' + Math.ceil(this.buffDouble / 1000) + 's', rx, buffY); buffY += 14; }
    if (this.shieldCharges > 0) { ctx.fillStyle = PAL['e']; ctx.fillText('🛡×' + this.shieldCharges, rx, buffY); buffY += 14; }

    // 波次（中上）
    ctx.textAlign = 'center';
    ctx.fillStyle = PAL['e'];
    ctx.font = "10px 'Press Start 2P', monospace";
    ctx.fillText(`WAVE ${this.wave}`, VW / 2, 16);
    // 混沌修饰词（波次下方）
    if (this.waveMod) {
      ctx.fillStyle = PAL['o'];
      ctx.font = "8px 'Press Start 2P', monospace";
      ctx.fillText(`${this.waveMod.icon} ${this.waveMod.name}`, VW / 2, 42);
    }
    // 连击 / FEVER（波次下方）
    if (this.combo > 0) {
      ctx.fillStyle = this.fever ? PAL['y'] : PAL['o'];
      ctx.font = "8px 'Press Start 2P', monospace";
      ctx.fillText(`${this.fever ? '🔥 FEVER ' : ''}COMBO ${this.combo}`, VW / 2, 30);
    }

    // 击杀（右上）
    ctx.textAlign = 'right';
    ctx.fillStyle = PAL['y'];
    ctx.fillText(`KILLS ${this.kills}`, VW - 14, 16);

    // 操作提示（首次未挥剑时）
    if (this.kills === 0 && this.swingTimer <= 0) {
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.time / 300);
      ctx.fillStyle = PAL['w'];
      ctx.font = "8px 'Press Start 2P', monospace";
      ctx.fillText('TAP TO SWING · 点屏挥剑', VW / 2, GROUND_Y - 40);
      ctx.globalAlpha = 1;
    }
  }

  private drawGameOver(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = 'rgba(5,4,15,0.7)';
    ctx.fillRect(0, 0, VW, VH);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PAL['A'];
    ctx.font = "18px 'Press Start 2P', monospace";
    ctx.fillText(this.dailyMode ? 'DAILY END' : 'GAME OVER', VW / 2, VH / 2 - 18);
    ctx.fillStyle = PAL['w'];
    ctx.font = "9px 'Press Start 2P', monospace";
    ctx.fillText(`KILLS ${this.kills}  ·  WAVE ${this.wave}`, VW / 2, VH / 2 + 8);
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.time / 300);
    ctx.fillStyle = PAL['e'];
    ctx.fillText(
      this.dailyMode ? 'TAP TO CLAIM · 点屏领奖返回' : 'TAP TO RESTART · 点屏重来',
      VW / 2,
      VH / 2 + 34,
    );
    ctx.restore();
  }
}
