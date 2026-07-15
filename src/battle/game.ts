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
import { WEAPON_BY_ID, MATERIAL_BY_ID, type WeaponDef, type MaterialId } from '../shared/weapons';
import { EMPTY_GEAR_BONUS, type GearBonus } from '../shared/gear';

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
/** 远程武器（飞镖/箭）投射物 */
interface Bolt {
  x: number;
  y: number;
  vx: number; // px/ms
  dmg: number;
  crit: boolean;
  life: number;
  pierce: number; // 最多命中数（1=命中即消失，>1=穿透）
  hit: Set<Monster>; // 已命中过的怪物（穿透不重复打）
}
/** 陀螺：绕玩家旋转的飞行物，撞击怪物（每怪一次） */
interface Top {
  ang: number;
  radius: number;
  spin: number; // 角速度 rad/ms
  life: number;
  dmg: number;
  crit: boolean;
  hit: Set<Monster>;
}
/** 闪电链段（权杖）：两点之间一条短命闪电，纯视觉 */
interface Zap {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
}
/** 蓄力光束（剑气/突刺/裂地波）：向前飞行，穿透命中每个怪物一次 */
interface Beam {
  x: number;
  y: number;
  vx: number; // px/ms
  half: number; // 命中半宽（横向判定半径）
  dmg: number;
  crit: boolean;
  life: number;
  hit: Set<Monster>;
  variant: 'beam' | 'thrust' | 'wave';
  knock: number;
}
/** 扩散冲击环（陨石砸/死亡收割）：纯视觉，半径随寿命增长 */
interface ShockRing {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  maxLife: number;
  color: string;
}
/** 掉落到地上的材料（需手动滑动拾取，不自动进背包） */
interface MatPickup {
  x: number;
  y: number;
  vy: number; // px/ms（下落）
  mat: MaterialId;
  n: number;
  landed: boolean;
  life: number;
  bob: number;
}
/** 本局累计的波次增益快照（3 选 1 累加结果），供 UI 看板渲染进度条 */
export interface RunBuffSummary {
  dmg: number;
  cd: number; // 累计冷却变化（负数 = 提速）
  maxHp: number;
  lifesteal: number;
  crit: number;
  coin: number;
  rage: number;
  picks: { icon: string; name: string }[];
}
// ---------- 蓄力攻击参数 ----------
const CHARGE_MAX = 720; // 充满蓄力条所需 ms
const CHARGE_TAP_MS = 170; // 按住 < 此值视为点屏普攻（不释放蓄力）
const CHARGE_CD = 520; // 释放蓄力后的恢复冷却 ms（限制蓄力连放频率）

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
  onBuffs?: (s: RunBuffSummary) => void; // 本局临时增益变化 → UI 看板刷新
  onMaterials?: () => void; // 拾取材料 → 刷新顶部 HUD 材料数
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
  /** 当前装备武器（决定攻击方式 / 被动 / 主动技） */
  private weapon: WeaponDef = WEAPON_BY_ID['sword'];
  /** 当前装备加成快照（头盔/护甲/靴子 三槽汇总；进入场/换装时刷新） */
  private gb: GearBonus = EMPTY_GEAR_BONUS;
  /** 武器强化等级带来的伤害/冷却倍率（syncLoadout 刷新；1 级 = 1） */
  private weaponDmgMult = 1;
  private weaponCdMult = 1;
  /** 远程武器投射物 */
  private bolts: Bolt[] = [];
  /** 陀螺（环绕武器） */
  private tops: Top[] = [];
  /** 闪电链段（权杖） */
  private zaps: Zap[] = [];
  /** 蓄力光束（剑气/突刺/裂地波） */
  private beams: Beam[] = [];
  /** 扩散冲击环（陨石砸/死亡收割） */
  private shockrings: ShockRing[] = [];
  /** 蓄力攻击状态：按住时充能，松开释放（短按则退化为普攻） */
  private charging = false;
  private chargeT = 0; // 当前蓄力累计 ms
  private chargeCd = 0; // 释放蓄力后恢复冷却 ms
  private chargeFull = false; // 已播过「蓄力满」提示（避免每帧重复）
  /** 掉落在地上的材料（滑动拾取） */
  private matPickups: MatPickup[] = [];
  /** 指针是否按下（用于判定滑动拾取，区别于点屏攻击） */
  private pointerDown = false;
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
  private level = 1;
  private exp = 0;
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
  private pickedBuffs: { icon: string; name: string }[] = [];

  constructor(canvas: HTMLCanvasElement, state: GameState, cb: BattleCallbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.state = state;
    this.cb = cb;
    this.stats = state.battleStats();
    this.weapon = state.equippedWeaponDef();
    this.gb = state.equippedGearBonuses();
    this.hp = this.effMaxHp();
    this.genStars();

    this.resize();
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
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
    this.syncWeapon(); // 进入场时同步装备的武器（工坊可能换了武器）
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
    this.cb.onBuffs?.(this.buffSummary()); // 进入/恢复时刷新本局增益看板
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
    // 中断蓄力、清掉瞬态特效，避免离场时残留
    this.charging = false;
    this.chargeT = 0;
    this.chargeCd = 0;
    this.beams = [];
    this.shockrings = [];
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
    this.syncLoadout();
    if (this.hp > this.effMaxHp()) this.hp = this.effMaxHp();
  }
  /** 同步当前装备（武器 + 装备加成快照）；工坊换装后 / 进入场时调用 */
  syncWeapon(): void {
    this.syncLoadout();
  }
  private syncLoadout(): void {
    this.weapon = this.state.equippedWeaponDef();
    this.gb = this.state.equippedGearBonuses();
    const wl = this.state.weaponLevel(this.weapon.id);
    this.weaponDmgMult = 1 + 0.12 * (wl - 1); // 每级 +12% 伤害
    this.weaponCdMult = 1 - 0.03 * (wl - 1); // 每级 -3% 冷却
  }
  // ---- 生效属性（永久技能 + 波次临时增益 + 武器被动 + 装备加成 叠加）----
  private effDamage(): number {
    return Math.round((this.stats.damage + this.rbDmg + this.gb.dmgAdd) * (this.weapon.passive.dmgMult ?? 1) * this.weaponDmgMult);
  }
  private effCooldown(): number {
    return Math.max(120, Math.round((this.stats.cooldown + this.rbCd + this.gb.cdAdd) * (this.weapon.passive.cdMult ?? 1) * this.weaponCdMult));
  }
  private effMaxHp(): number {
    return this.stats.maxHp + this.rbMaxHp + this.state.metaHP() + this.gb.hpAdd;
  }
  private effLifesteal(): number {
    return this.stats.lifesteal + this.rbLifesteal + (this.weapon.passive.lifestealAdd ?? 0) + this.gb.lsAdd;
  }
  private effCrit(): number {
    return Math.min(0.9, this.stats.crit + this.rbCrit + (this.weapon.passive.critAdd ?? 0) + this.gb.critAdd);
  }
  private effKnockback(): number {
    return this.weapon.passive.knockMult ?? 1;
  }
  private effRange(): number {
    return 84 + (this.weapon.passive.rangeAdd ?? 0);
  }
  /** 金币倍率：技能 + 装备 + 波次增益 + FEVER + 混沌修饰词 */
  private coinMult(): number {
    return 1 + this.stats.coinBonus + this.gb.coinAdd + this.rbCoin + (this.fever ? 0.5 : 0) + (this.waveMod?.coin ?? 0);
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
    this.pickedBuffs.push({ icon: b.icon, name: b.name });
    audio.sfx('skill');
  }
  /** 当前本局增益快照（供 UI 看板） */
  private buffSummary(): RunBuffSummary {
    return {
      dmg: this.rbDmg,
      cd: this.rbCd,
      maxHp: this.rbMaxHp,
      lifesteal: this.rbLifesteal,
      crit: this.rbCrit,
      coin: this.rbCoin,
      rage: this.rbRage,
      picks: this.pickedBuffs.slice(),
    };
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
    this.pointerDown = true;
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
    this.startCharge();
  };
  private onPointerUp = (): void => {
    this.pointerDown = false;
    this.releaseChargeInput();
  };
  /** 滑动经过地上材料时批量拾取（点屏攻击不影响） */
  private onPointerMove = (e: PointerEvent): void => {
    if (this.dead || !this.pointerDown) return;
    const p = this.pointerToCanvas(e);
    if (!p) return;
    const r = 28;
    let picked = false;
    for (let i = this.matPickups.length - 1; i >= 0; i--) {
      const pk = this.matPickups[i];
      if (!pk.landed) continue;
      if (Math.hypot(p.x - pk.x, p.y - pk.y) < r) {
        this.state.addMaterial(pk.mat, pk.n);
        const def = MATERIAL_BY_ID[pk.mat];
        this.addFloater(pk.x, pk.y - 12, `${def.icon}+${pk.n}`, '#7df9ff');
        this.matPickups.splice(i, 1);
        picked = true;
      }
    }
    if (picked) {
      audio.sfx('coin');
      this.cb.onMaterials?.();
    }
  };
  /** 屏幕坐标 → 画布坐标（兼容 .game-root.rotated 的 90° 旋转） */
  private pointerToCanvas(e: PointerEvent): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const rotated = !!document.getElementById('gameRoot')?.classList.contains('rotated');
    if (rotated) {
      return {
        x: (e.clientY - rect.top) * (this.canvas.width / rect.height),
        y: (rect.left + rect.width - e.clientX) * (this.canvas.height / rect.width),
      };
    }
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height),
    };
  }

  // ---------- 战斗 ----------
  private trySwing(): void {
    if (this.swingCd > 0 || this.dead) return;
    const cd = this.effCooldown();
    this.swingCd = this.buffHaste > 0 ? Math.round(cd * 0.5) : cd;
    this.swingTimer = this.weapon.attack === 'ranged' ? 120 : 160; // 远程也有出手动画（投掷）
    audio.sfx('throw');
    if (this.weapon.attack === 'ranged') this.fireBolt(false); // 远程：掷出飞镖/箭
    else if (this.weapon.attack === 'orbit') this.spawnTops(this.weapon.passive.orbitCount ?? 1); // 陀螺：环绕
    else if (this.weapon.attack === 'chain') this.chainZap(this.weapon.passive.chainCount ?? 3, this.effDamage()); // 权杖：闪电链
    else this.meleeArc(); // 近战：即时判定前方
  }

  /** 按下：先尝试一次普攻（保留「点屏即挥」的即时手感），同时开始蓄力 */
  private startCharge(): void {
    this.trySwing();
    this.charging = true;
    this.chargeT = 0;
    this.chargeFull = false;
  }

  /** 松开：短按不重复释放（普攻已在按下时出手）；蓄力满阈值则释放蓄力攻击 */
  private releaseChargeInput(): void {
    if (!this.charging) return;
    this.charging = false;
    this.chargeFull = false;
    // 死亡 / 暂停（如波次 3 选 1 弹窗）期间不释放，避免空放
    if (this.dead || !this.running) return;
    if (this.chargeT < CHARGE_TAP_MS) return; // 短按 = 普攻，已在按下时挥出
    if (this.chargeCd > 0) return; // 蓄力恢复中：不再释放（普攻已在按下时挥出）
    this.fireCharge(Math.min(1, this.chargeT / CHARGE_MAX));
  }

  /** 蓄力攻击：按装备武器的 charge.id 分派独特高阶效果，威力随等级(0..1)提升 */
  private fireCharge(level: number): void {
    this.chargeCd = CHARGE_CD;
    this.swingCd = Math.max(this.swingCd, 240); // 释放硬直，避免立即接普攻
    const dmg = Math.max(1, Math.round(this.effDamage() * (2 + level * 4))); // 2x..6x
    const ch = this.weapon.charge;
    const full = level >= 0.999;
    audio.sfx('skill');
    this.addShake(1 + level * 1.5);
    this.addFlash(full ? '#ffd45e' : '#7df9ff', 0.25 + level * 0.25);
    this.addFreeze(40 + level * 50);
    this.addFloater(VW / 2, GROUND_Y - 72, `${ch.icon} ${ch.name}!`, full ? '#ffd45e' : '#7df9ff');

    switch (ch.id) {
      case 'beam': // 剑·剑气斩：前方穿透能量弧
        this.beams.push({ x: this.playerX + 30, y: GROUND_Y - 18, vx: 0.62, half: 16, dmg, crit: true, life: 360, hit: new Set<Monster>(), variant: 'beam', knock: 24 });
        break;
      case 'thrust': // 矛·贯星突：更长更快的穿透枪光
        this.beams.push({ x: this.playerX + 30, y: GROUND_Y - 18, vx: 0.95, half: 11, dmg: Math.round(dmg * 1.2), crit: true, life: 340, hit: new Set<Monster>(), variant: 'thrust', knock: 12 });
        break;
      case 'wave': // 斧·裂地波：地面冲击波推进，巨力击退
        this.beams.push({ x: this.playerX + 24, y: GROUND_Y - 10, vx: 0.42, half: 15, dmg: Math.round(dmg * 0.9), crit: true, life: 560, hit: new Set<Monster>(), variant: 'wave', knock: 42 });
        break;
      case 'meteor': {
        // 锤·陨石砸：玩家周围巨大范围爆震 + 击退
        const radius = 70 + level * 70;
        const cx = this.playerX + 18;
        const cy = GROUND_Y - 18;
        this.shockrings.push({ x: cx, y: cy, r: 8, maxR: radius, life: 340, maxLife: 340, color: PAL['o'] });
        this.shockrings.push({ x: cx, y: cy, r: 8, maxR: radius * 0.7, life: 260, maxLife: 260, color: PAL['y'] });
        this.burst(cx, cy, 24 + Math.round(level * 24), PAL['o'], 0.32);
        this.burst(cx, cy, 12, PAL['y'], 0.26);
        for (const m of this.monsters) {
          if (Math.abs(m.x - cx) <= radius) this.hitMonster(m, dmg, true, 46 * this.effKnockback());
        }
        this.addShake(2 + level * 2);
        break;
      }
      case 'reap': {
        // 镰·死亡收割：全屏横扫 + 吸血（hitMonster 自带 effLifesteal）
        this.shockrings.push({ x: this.playerX + 30, y: GROUND_Y - 30, r: 16, maxR: VW, life: 380, maxLife: 380, color: PAL['P'] });
        this.burst(this.playerX + 30, GROUND_Y - 30, 22, PAL['P'], 0.28);
        for (const m of this.monsters) this.hitMonster(m, dmg, true, 18 * this.effKnockback());
        this.addFlash('#c061e0', 0.3);
        break;
      }
      case 'volley': {
        // 飞镖·暴雨镖：扇形散射多枚（越蓄越多）
        const n = 3 + Math.round(level * 5);
        const speed = (this.weapon.passive.projectileSpeed ?? 560) / 1000;
        for (let k = 0; k < n; k++) {
          const ang = (k - (n - 1) / 2) * 0.16;
          this.bolts.push({ x: this.playerX + 30, y: GROUND_Y - 20, vx: speed * Math.cos(ang), dmg, crit: true, life: 460, pierce: Math.max(2, n), hit: new Set<Monster>() });
        }
        break;
      }
      case 'arrowstorm': {
        // 弓·穿透箭雨：多支高穿透箭覆盖全场
        const n = 3 + Math.round(level * 4);
        const speed = (this.weapon.passive.projectileSpeed ?? 720) / 1000;
        const pierce = 3 + Math.round(level * 4);
        for (let k = 0; k < n; k++) {
          const ang = (k - (n - 1) / 2) * 0.14;
          this.bolts.push({ x: this.playerX + 30, y: GROUND_Y - 20, vx: speed * Math.cos(ang), dmg, crit: true, life: 520, pierce, hit: new Set<Monster>() });
        }
        break;
      }
      case 'topstorm': {
        // 陀螺·陀螺风暴：多个大半径陀螺环绕狂扫
        const n = 3 + Math.round(level * 4);
        for (let k = 0; k < n; k++) {
          this.tops.push({ ang: (k / n) * Math.PI * 2, radius: 60 + (k % 3) * 18, spin: 0.014, life: 2600 + level * 800, dmg, crit: true, hit: new Set<Monster>() });
        }
        break;
      }
      case 'judgment': // 权杖·雷霆审判：更强更长的闪电链
        this.chainZap(5 + Math.round(level * 5), dmg);
        this.addFlash('#7df9ff', 0.3);
        break;
      default: {
        // 兜底：前方范围爆震
        const reach = this.playerX + this.effRange() + 40;
        for (const m of this.monsters) {
          if (m.x < this.playerX - 6 || m.x > reach) continue;
          this.hitMonster(m, dmg, true, 30 * this.effKnockback());
        }
      }
    }
    // 清理被蓄力击杀的怪物（给怒气：byUlt=false）
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      if (this.monsters[i].hp <= 0) this.killMonster(this.monsters[i], i, false);
    }
  }

  /** 对单个怪物造成一次伤害（近战挥砍 / 飞镖命中共用） */
  private hitMonster(m: Monster, dmg: number, crit: boolean, knockback: number): void {
    m.hp -= dmg;
    m.lastCrit = crit;
    m.hitFlash = 90;
    m.x += knockback;
    if (m.type === 'chest' && !m.flee) {
      m.flee = true;
      m.fleeTimer = 0;
    }
    this.burst(m.x, GROUND_Y - foeH(m.type) / 2, crit ? 10 : 5, crit ? PAL['y'] : PAL['w']);
    if (crit) {
      this.addShake(1);
      this.addFreeze(50);
      audio.haptic(25);
    } else {
      audio.haptic(12);
    }
    this.addFloater(m.x, GROUND_Y - foeH(m.type) - 6, String(dmg), crit ? '#ffd45e' : '#ffffff');
    const ls = this.effLifesteal();
    if (ls > 0 && this.hp < this.effMaxHp()) {
      this.hp = Math.min(this.effMaxHp(), this.hp + ls);
    }
    this.gainRage(8);
  }

  /** 近战：挥砍瞬间对前方所有怪物造成伤害 */
  private meleeArc(): void {
    const reach = this.playerX + this.effRange();
    const knock = 16 * this.effKnockback();
    let hitAny = false;
    for (const m of this.monsters) {
      if (m.x < this.playerX - 6 || m.x > reach) continue;
      let dmg = this.effDamage();
      const crit = Math.random() < this.effCrit();
      if (crit) dmg = Math.round(dmg * this.stats.critMult);
      if (this.buffDouble > 0) dmg *= 2;
      this.hitMonster(m, dmg, crit, knock);
      hitAny = true;
    }
    if (hitAny) audio.sfx('hit');
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      if (this.monsters[i].hp <= 0) this.killMonster(this.monsters[i], i);
    }
  }

  /** 远程：掷出飞镖/箭投射物；split=true 时扇形掷 3 枚 */
  private fireBolt(split: boolean): void {
    const speed = (this.weapon.passive.projectileSpeed ?? 560) / 1000; // px/ms
    const pierce = Math.max(1, this.weapon.passive.pierce ?? 1);
    const baseDmg = this.effDamage();
    const make = (yOff: number, angOff = 0) => {
      const crit = Math.random() < this.effCrit();
      let dmg = baseDmg;
      if (crit) dmg = Math.round(dmg * this.stats.critMult);
      if (this.buffDouble > 0) dmg *= 2;
      const ang = angOff;
      this.bolts.push({
        x: this.playerX + 30,
        y: GROUND_Y - 20 + yOff,
        vx: speed * Math.cos(ang),
        dmg,
        crit,
        life: 460,
        pierce,
        hit: new Set<Monster>(),
      });
    };
    if (split) {
      make(-9, -0.18);
      make(0, 0);
      make(9, 0.18);
    } else {
      make(0);
    }
  }

  /** 陀螺：放出绕身旋转的飞行物，撞击怪物（每个陀螺每怪命中一次） */
  private spawnTops(count: number): void {
    const baseDmg = this.effDamage();
    for (let k = 0; k < count; k++) {
      const crit = Math.random() < this.effCrit();
      let dmg = baseDmg;
      if (crit) dmg = Math.round(dmg * this.stats.critMult);
      if (this.buffDouble > 0) dmg *= 2;
      this.tops.push({
        ang: (k / count) * Math.PI * 2,
        radius: 56 + (k % 2) * 14,
        spin: 0.012,
        life: 2600,
        dmg,
        crit,
        hit: new Set<Monster>(),
      });
    }
  }

  /** 闪电链：从玩家出发，在最近且未传导的怪物间跳跃，各造成一次伤害 */
  private chainZap(maxTargets: number, dmg: number): void {
    let fx = this.playerX + 12;
    let fy = GROUND_Y - 30;
    const chained: Monster[] = [];
    for (let k = 0; k < maxTargets; k++) {
      let best: Monster | null = null;
      let bd = Infinity;
      for (const m of this.monsters) {
        if (chained.includes(m)) continue;
        const mx = m.x;
        const my = GROUND_Y - foeH(m.type) / 2;
        const d = Math.hypot(mx - fx, my - fy);
        if (d < bd && d < 260) {
          bd = d;
          best = m;
        }
      }
      if (!best) break;
      const mx = best.x;
      const my = GROUND_Y - foeH(best.type) / 2;
      this.zaps.push({ x1: fx, y1: fy, x2: mx, y2: my, life: 180 });
      const crit = Math.random() < this.effCrit();
      let d = dmg;
      if (crit) d = Math.round(d * this.stats.critMult);
      if (this.buffDouble > 0) d *= 2;
      this.hitMonster(best, d, crit, 5);
      chained.push(best);
      fx = mx;
      fy = my;
    }
    if (chained.length > 0) {
      audio.sfx('jackpot');
      this.addShake(1);
      // 清理被电死的怪物
      for (let i = this.monsters.length - 1; i >= 0; i--) {
        if (this.monsters[i].hp <= 0) this.killMonster(this.monsters[i], i);
      }
    }
  }

  private killMonster(m: Monster, i: number, byUlt = false): void {
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
    if (isChest || m.type === 'boss') {
      this.addFlash('#ffd45e', 0.5);
      this.addFreeze(80);
    }
    if (!byUlt) this.gainRage((m.type === 'boss' ? 35 : 12) + this.rbRage); // 必杀击杀不加怒气，避免无限连大
    // 经验：boss/宝箱多，普通怪少；必杀击杀也给经验（只限怒气不加）
    const expGain =
      m.type === 'boss' ? 20 : m.type === 'chest' ? 15 : m.type === 'golem' ? 8 : m.type === 'imp' || m.type === 'bomber' ? 4 : 3;
    this.gainExp(expGain);
    this.dropMaterial(m); // 材料掉落（合成武器用）
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
      this.addShake(1);
      this.burst(this.playerX, GROUND_Y - P_H / 2, 12, PAL['e']);
      this.addFloater(this.playerX, GROUND_Y - P_H - 14, '🛡格挡!', PAL['e']);
      audio.sfx('skill');
      return;
    }
    this.hp -= n;
    this.playerFlash = 300;
    this.playerInvuln = 720;
    this.addShake(2);
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
    this.time = 0; // 每局重新计时：难度随时间从 0 开始递增
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
    this.level = 1;
    this.exp = 0;
    this.pickedBuffs = [];
    this.bolts = [];
    this.tops = [];
    this.zaps = [];
    this.beams = [];
    this.shockrings = [];
    this.charging = false;
    this.chargeT = 0;
    this.chargeCd = 0;
    this.chargeFull = false;
    this.matPickups = [];
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
    this.shake = Math.min(5, this.shake + n);
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

  // ---------- 经验 / 等级（升级得属性点，自动投入伤害+血量）----------
  private expForNext(): number {
    return 8 + this.level * 4;
  }
  private gainExp(n: number): void {
    this.exp += n;
    while (this.exp >= this.expForNext()) {
      this.exp -= this.expForNext();
      this.level++;
      // 属性点：每级 +1 伤害 +2 血量（并补 2 血）
      this.rbDmg += 1;
      this.rbMaxHp += 2;
      this.hp = Math.min(this.effMaxHp(), this.hp + 2);
      this.addFloater(this.playerX, GROUND_Y - P_H - 44, `⬆ Lv.${this.level} +属性`, '#7df9ff');
      this.addFlash('#7df9ff', 0.25);
      audio.sfx('combo');
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
  /** 必杀：按装备武器分派主动技 —— 旋风斩/横扫/收割 / 裂地/地裂 / 分裂镖/三连箭 / 暴走(陀螺) / 雷暴(权杖) */
  ultimate(): void {
    if (!this.ultReady || this.dead) return;
    this.ultReady = false;
    this.rage = 0;
    this.cb.onUlt(false);
    const sk = this.weapon.skill.id;
    // 远程分裂（飞镖/弓）：扇形 3 发
    if (sk === 'split') {
      audio.sfx('jackpot');
      this.addFlash('#7df9ff', 0.4);
      this.fireBolt(true);
      this.addFloater(VW / 2, GROUND_Y - 70, '🎯 分裂!', '#7df9ff');
      return;
    }
    // 陀螺：暴走——同时放出 3 个陀螺
    if (sk === 'frenzy') {
      audio.sfx('jackpot');
      this.addFlash('#7df9ff', 0.4);
      this.spawnTops(3);
      this.addFloater(VW / 2, GROUND_Y - 70, '🌀 暴走!', '#7df9ff');
      return;
    }
    // 权杖：雷暴——更强更长的闪电链
    if (sk === 'storm') {
      audio.sfx('jackpot');
      this.addFlash('#7df9ff', 0.5);
      this.chainZap(6, Math.round(this.effDamage() * 2.4));
      this.addFloater(VW / 2, GROUND_Y - 70, '⚡ 雷暴!', '#7df9ff');
      return;
    }
    // 剑 / 斧：AoE 环形冲击（裂地斩更强）
    const isSlam = sk === 'slam';
    audio.sfx('jackpot');
    this.addShake(isSlam ? 5 : 4);
    this.addFlash('#ffffff', 0.7);
    this.addFreeze(90);
    const cx = this.playerX + 40;
    const cy = GROUND_Y - 30;
    this.burst(cx, cy, isSlam ? 52 : 40, PAL['y'], 0.32);
    this.burst(cx, cy, 24, PAL['e'], 0.26);
    const dmg = Math.round((8 + this.wave * 2 + this.effDamage() * 2) * (isSlam ? 1.6 : 1));
    const knock = isSlam ? 70 : 40;
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      m.hp -= dmg;
      m.hitFlash = 120;
      m.lastCrit = true;
      m.x += knock; // 强击退
      this.burst(m.x, GROUND_Y - foeH(m.type) / 2, 8, PAL['o']);
      if (m.hp <= 0) this.killMonster(m, i, true); // 必杀击杀不加怒气，防无限连大
    }
    this.addFloater(VW / 2, GROUND_Y - 70, isSlam ? '🪓 裂地斩!' : '💢 旋风斩!', '#ffd45e');
  }

  // ---------- 道具 ----------
  private maybeDropPower(x: number): void {
    if (Math.random() < 0.13) {
      const pool: PowerType[] = ['haste', 'double', 'shield', 'heal', 'rage'];
      const t = pool[Math.floor(Math.random() * pool.length)];
      this.powerups.push({ x, y: GROUND_Y - 16, type: t, life: 6000 });
    }
  }
  /** 击杀掉落材料：按怪物类型从材料池抽取，概率/数量随波次提升；掉到地上需手动滑动拾取 */
  private dropMaterial(m: Monster): void {
    if (Math.random() > 0.45 + this.wave * 0.02) return; // 基础 45% + 波次加成
    const pool: MaterialId[] =
      m.type === 'boss' || m.type === 'chest'
        ? ['gold', 'crystal', 'ember', 'gold']
        : m.type === 'golem'
          ? ['iron', 'crystal', 'gold', 'iron']
          : m.type === 'bomber'
            ? ['ember', 'bone', 'ember']
            : m.type === 'imp'
              ? ['iron', 'bone', 'ember']
              : ['wood', 'leather', 'bone']; // 史莱姆等弱怪
    const mat = pool[Math.floor(Math.random() * pool.length)];
    const n = 1 + (Math.random() < 0.15 + this.wave * 0.01 ? 1 : 0);
    this.matPickups.push({
      x: m.x + (Math.random() * 2 - 1) * 8,
      y: GROUND_Y - foeH(m.type) / 2,
      vy: -130 - Math.random() * 60, // 向上弹一下再落地
      mat,
      n,
      landed: false,
      life: 14000,
      bob: Math.random() * Math.PI * 2,
    });
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
    // 蓄力累计 + 蓄满一次性提示
    if (this.charging) {
      this.chargeT = Math.min(CHARGE_MAX, this.chargeT + dt);
      if (this.chargeT >= CHARGE_MAX && !this.chargeFull) {
        this.chargeFull = true;
        audio.sfx('combo');
        this.addFloater(this.playerX, GROUND_Y - P_H - 26, '蓄力满!', '#ffd45e');
      }
    }
    if (this.chargeCd > 0) this.chargeCd -= dt;

    // 生成怪物（节奏随机化：基础间隔 × 0.55..1.45 的抖动，偶尔双连刷；时间越久刷得越快）
    this.spawnTimer -= dt;
    // 空场时压缩下一次刷怪间隔，避免清场后长时间空等
    if (this.monsters.length === 0) this.spawnTimer = Math.min(this.spawnTimer, 280);
    if (this.spawnTimer <= 0 && this.monsters.length < 10) {
      this.spawnMonster();
      const minutes = this.time / 60000;
      const base = Math.max(260, 1400 - this.wave * 100 - minutes * 180);
      const spawnMult = this.waveMod ? this.waveMod.spawn : 1;
      this.spawnTimer = base * (0.55 + Math.random() * 0.9) * spawnMult;
      // 后期偶尔一次刷两只，制造节奏起伏（时间越久概率越高）
      const dualChance = Math.min(0.5, 0.12 + minutes * 0.06);
      if (this.wave >= 3 && Math.random() < dualChance && this.monsters.length < 9) this.spawnMonster();
    }

    // 屏幕怪物稀疏时给推进加速，缩短"清场后空等怪物走过来"的真空期
    const sparseBoost = this.monsters.length <= 1 ? 2.5 : this.monsters.length <= 3 ? 1.8 : 1;
    // 怪物推进 + 接触判定
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      // 宝箱怪：到点或被命中后转身逃跑（向右）
      if (m.type === 'chest' && !m.flee) {
        m.fleeTimer = (m.fleeTimer ?? 2200) - dt;
        if (m.fleeTimer <= 0) m.flee = true;
      }
      const dir = m.flee ? 1 : -1;
      m.x += (dir * m.speed * sparseBoost * dt) / 1000;
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
      // 接触玩家：扣血并自爆（自爆怪/狂暴精英基础 2 伤；时间越久全体伤害越高。宝箱怪不伤人）
      if (m.type !== 'chest' && m.x - foeW(m.type) / 2 <= this.playerX + 14) {
        const minutes = this.time / 60000;
        const dmg = (m.type === 'bomber' || m.elite === 'brute' ? 2 : 1) + Math.min(8, Math.floor(minutes * 1.5)); // 时间越久撞伤越高
        this.damagePlayer(dmg);
        if (m.type === 'bomber') {
          this.burst(m.x, GROUND_Y - foeH(m.type) / 2, 18, PAL['O']);
          this.addShake(2);
          this.addFloater(this.playerX, GROUND_Y - P_H + 8, '💥自爆!', '#e84753');
        } else {
          this.addFloater(this.playerX, GROUND_Y - P_H + 8, m.elite === 'brute' ? '💥狂暴!' : '💥', '#e84753');
        }
        this.monsters.splice(i, 1);
      } else if (m.type === 'chest' && !m.flee && m.x - foeW(m.type) / 2 <= this.playerX + 14) {
        m.flee = true; // 宝箱怪碰到玩家也立即逃
      }
    }

    // 投射物：推进 + 命中（穿透武器可连击多个，每怪一次）
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.x += b.vx * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x > VW + 20) {
        this.bolts.splice(i, 1);
        continue;
      }
      let hit: Monster | null = null;
      for (const m of this.monsters) {
        if (b.hit.has(m)) continue;
        if (Math.abs(b.x - m.x) <= foeW(m.type) / 2 + 3) {
          hit = m;
          break;
        }
      }
      if (hit) {
        this.hitMonster(hit, b.dmg, b.crit, 6 * this.effKnockback());
        audio.sfx('hit');
        b.hit.add(hit);
        if (b.hit.size >= b.pierce) this.bolts.splice(i, 1); // 达到穿透上限才消失
      }
    }
    // 陀螺：旋转 + 撞击（每陀螺每怪一次）
    for (let i = this.tops.length - 1; i >= 0; i--) {
      const t = this.tops[i];
      t.ang += t.spin * dt;
      t.life -= dt;
      const tx = this.playerX + Math.cos(t.ang) * t.radius;
      const ty = GROUND_Y - 36 + Math.sin(t.ang) * t.radius * 0.35;
      for (const m of this.monsters) {
        if (t.hit.has(m)) continue;
        if (Math.hypot(tx - m.x, ty - (GROUND_Y - foeH(m.type) / 2)) < foeW(m.type) / 2 + 10) {
          this.hitMonster(m, t.dmg, t.crit, 8 * this.effKnockback());
          t.hit.add(m);
        }
      }
      if (t.life <= 0) this.tops.splice(i, 1);
    }
    // 闪电链段寿命衰减
    for (let i = this.zaps.length - 1; i >= 0; i--) {
      this.zaps[i].life -= dt;
      if (this.zaps[i].life <= 0) this.zaps.splice(i, 1);
    }
    // 蓄力光束：推进 + 穿透命中（每怪一次）
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.x += b.vx * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x > VW + 40) {
        this.beams.splice(i, 1);
        continue;
      }
      for (const m of this.monsters) {
        if (b.hit.has(m)) continue;
        if (Math.abs(b.x - m.x) <= b.half + foeW(m.type) / 2) {
          this.hitMonster(m, b.dmg, b.crit, b.knock * this.effKnockback());
          b.hit.add(m);
        }
      }
    }
    // 冲击环：半径随寿命增长
    for (let i = this.shockrings.length - 1; i >= 0; i--) {
      const s = this.shockrings[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.shockrings.splice(i, 1);
        continue;
      }
      s.r = s.maxR * (1 - s.life / s.maxLife);
    }
    // 清理被打死的怪物（投射物/陀螺/闪电/蓄力）
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      if (this.monsters[i].hp <= 0) this.killMonster(this.monsters[i], i);
    }

    // 材料掉落物：下落 → 触地 → 漂浮；寿命到期消失
    for (let i = this.matPickups.length - 1; i >= 0; i--) {
      const pk = this.matPickups[i];
      if (!pk.landed) {
        pk.vy += (1400 * dt) / 1000;
        pk.y += (pk.vy * dt) / 1000;
        if (pk.y >= GROUND_Y - 6) {
          pk.y = GROUND_Y - 6;
          pk.landed = true;
          pk.vy = 0;
        }
      } else {
        pk.bob += dt * 0.006;
      }
      pk.life -= dt;
      if (pk.life <= 0) this.matPickups.splice(i, 1);
    }

    // 浮字（vy 单位：px/ms，按 dt 累加；渲染时取整）
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.y += f.vy * dt;
      f.life -= dt;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }
  }

  /** 定时刷的普通怪：种类与强度随【时间】递增——越久越强、种类越多（叠加波次/混沌/精英） */
  private spawnMonster(): void {
    const sec = this.time / 1000;
    const minutes = sec / 60;
    const w = this.wave;

    // ---- 种类：随时间解锁 + 权重向强怪倾斜（史莱姆渐少，恶魔/巨人/自爆渐多）----
    let type: FoeType;
    if (sec > 20 && this.wave >= 2 && Math.random() < 0.06) {
      type = 'chest'; // 稀有逃跑宝箱怪
    } else {
      const weights: [FoeType, number][] = [['slime', Math.max(0.1, 0.7 - sec * 0.008)]];
      if (sec > 8) weights.push(['imp', 0.4]);
      if (sec > 28) weights.push(['golem', Math.min(0.4, (sec - 28) * 0.008)]);
      if (sec > 50) weights.push(['bomber', Math.min(0.35, (sec - 50) * 0.007)]);
      const total = weights.reduce((s, [, wt]) => s + wt, 0);
      let roll = Math.random() * total;
      type = 'slime';
      for (const [t, wt] of weights) {
        roll -= wt;
        if (roll <= 0) {
          type = t;
          break;
        }
      }
    }

    // ---- 时间难度倍率（持续递增，封顶防失控）----
    const hpTimeMult = Math.min(15, 1 + minutes * 2.0); // 每分钟 +200% 血，封顶 15×
    const speedTimeMult = Math.min(2.0, 1 + minutes * 0.13); // 每分钟 +13% 速，封顶 2×

    // ---- 精英词缀（金色光环怪；时间越久出现概率越高。宝箱/Boss 不精英）----
    const eliteChance = type === 'chest' ? 0 : Math.min(0.45, 0.14 + minutes * 0.06);
    let elite: Affix | undefined;
    if (sec > 15 && Math.random() < eliteChance) {
      elite = (['brute', 'regen', 'swift'] as Affix[])[Math.floor(Math.random() * 3)];
    }

    // ---- 基础血量（种类 + 波次）再叠时间倍率 ----
    let hp =
      type === 'chest'
        ? 5 + Math.floor(w * 0.5)
        : type === 'golem'
          ? 10 + Math.floor(w * 2.2)
          : type === 'bomber'
            ? 3 + Math.floor(w * 0.7)
            : type === 'imp'
              ? 5 + Math.floor(w * 1.4)
              : 3 + Math.floor(w * 1.0);
    if (elite) hp = Math.round(hp * 1.4); // 精英血量更高
    if (type !== 'chest' && this.waveMod) hp = Math.max(1, Math.round(hp * this.waveMod.hp)); // 混沌修饰
    hp = Math.max(1, Math.round(hp * hpTimeMult)); // 时间强化

    // ---- 速度（种类 + 波次 + 时间）----
    const base = type === 'chest' ? 70 : type === 'golem' ? 42 : type === 'bomber' ? 100 : type === 'imp' ? 80 : 64;
    let speed = (base + w * 3.5) * speedTimeMult;
    if (this.waveMod) speed *= this.waveMod.speed; // 混沌修饰
    speed = Math.min(speed, 190);
    if (elite === 'swift') speed = Math.min(speed * 1.6, 245); // 迅捷精英加速
    // 登场位置：宝箱怪从屏外；其余按密度就近入场，缩短清场后的空走距离
    let x: number;
    if (type === 'chest') x = VW + 30;
    else if (this.monsters.length <= 1) x = Math.round(VW * (0.42 + Math.random() * 0.16)); // 空场：偏近，快速接战
    else x = Math.round(VW * (0.55 + Math.random() * 0.2)); // 中近距离
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

    // 投射物（飞镖/箭）
    for (const b of this.bolts) {
      const bx = Math.round(b.x);
      const by = Math.round(b.y);
      pixelRect(ctx, bx - 4, by - 1, 7, 2, b.crit ? PAL['y'] : PAL['w']); // 镖杆
      pixelRect(ctx, bx + 3, by - 1, 2, 2, PAL['e']); // 镖尖
      pixelRect(ctx, bx - 6, by - 2, 2, 1, b.crit ? PAL['Y'] : PAL['c']); // 尾翼
      pixelRect(ctx, bx - 6, by + 1, 2, 1, b.crit ? PAL['Y'] : PAL['c']);
    }
    // 陀螺（旋转方块 + 光晕）
    for (const t of this.tops) {
      const tx = Math.round(this.playerX + Math.cos(t.ang) * t.radius);
      const ty = Math.round(GROUND_Y - 36 + Math.sin(t.ang) * t.radius * 0.35);
      const spin = Math.floor(this.time / 60) % 2 === 0;
      ctx.globalAlpha = 0.4;
      pixelRect(ctx, tx - 6, ty - 6, 12, 12, PAL['e']);
      ctx.globalAlpha = 1;
      if (spin) {
        pixelRect(ctx, tx - 5, ty - 2, 10, 4, t.crit ? PAL['y'] : PAL['C']);
        pixelRect(ctx, tx - 2, ty - 5, 4, 10, t.crit ? PAL['y'] : PAL['C']);
      } else {
        pixelRect(ctx, tx - 4, ty - 4, 8, 8, t.crit ? PAL['y'] : PAL['C']);
      }
    }
    // 闪电链段
    for (const z of this.zaps) {
      ctx.globalAlpha = Math.max(0, z.life / 180);
      pixelLine(ctx, z.x1, z.y1, z.x2, z.y2, PAL['e']);
      pixelLine(ctx, z.x1, z.y1 + 1, z.x2, z.y2 + 1, PAL['w']);
      ctx.globalAlpha = 1;
    }
    // 蓄力光束（剑气 / 突刺 / 裂地波）
    for (const b of this.beams) {
      const bx = Math.round(b.x);
      const a = Math.max(0, Math.min(1, b.life / 320));
      ctx.save();
      ctx.globalAlpha = a;
      if (b.variant === 'beam') {
        // 剑气：竖向能量弧（青白核心 + 外发光 + 弧尖）
        ctx.globalAlpha = a * 0.45;
        pixelRect(ctx, bx - 4, b.y - 18, 8, 36, PAL['e']);
        ctx.globalAlpha = a;
        pixelRect(ctx, bx - 2, b.y - 16, 4, 32, PAL['w']);
        pixelRect(ctx, bx - 1, b.y - 12, 2, 24, PAL['e']);
        pixelRect(ctx, bx - 3, b.y - 18, 2, 5, PAL['E']);
        pixelRect(ctx, bx + 1, b.y - 18, 2, 5, PAL['E']);
      } else if (b.variant === 'thrust') {
        // 突刺：横向长枪光（黄白）+ 尖端
        pixelLine(ctx, bx - 28, b.y, bx + 8, b.y, PAL['y']);
        pixelLine(ctx, bx - 28, b.y - 1, bx + 8, b.y - 1, PAL['w']);
        pixelLine(ctx, bx - 28, b.y + 1, bx + 8, b.y + 1, PAL['Y']);
        pixelRect(ctx, bx + 6, b.y - 2, 4, 5, PAL['w']);
        pixelRect(ctx, bx + 9, b.y - 1, 2, 3, PAL['y']);
      } else {
        // 裂地波：地面涟漪（橙）+ 翻起的土块
        for (let k = 0; k < 3; k++) pixelEllipse(ctx, bx - k * 9, GROUND_Y, Math.max(2, 10 - k * 2), Math.max(2, 6 - k), PAL['o']);
        pixelRect(ctx, bx - 6, GROUND_Y - 7, 12, 7, PAL['O']);
        pixelRect(ctx, bx - 3, GROUND_Y - 11, 6, 4, PAL['o']);
      }
      ctx.restore();
    }
    // 冲击环（陨石砸 / 死亡收割）：扩散圆环
    for (const s of this.shockrings) {
      const a = Math.max(0, s.life / s.maxLife);
      ctx.save();
      ctx.globalAlpha = a * 0.75;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(1, s.r), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 道具
    this.drawPowerups(ctx);

    // 材料掉落物（地上，滑动拾取）
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '15px serif';
    for (const pk of this.matPickups) {
      const yy = pk.landed ? pk.y + Math.round(Math.sin(pk.bob) * 2) : pk.y;
      // 即将消失时闪烁
      if (pk.life < 3000 && Math.floor(this.time / 120) % 2 === 0) ctx.globalAlpha = 0.4;
      ctx.fillText(MATERIAL_BY_ID[pk.mat].icon, Math.round(pk.x), Math.round(yy));
      ctx.globalAlpha = 1;
    }

    // 玩家
    this.drawPlayer(ctx);
    if (this.swingTimer > 0) this.drawSword(ctx);
    if (this.charging) this.drawChargeBar(ctx);

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
    // 蓄力光环：按等级增强，蓄满转金色脉动
    if (this.charging) {
      const lv = Math.min(1, this.chargeT / CHARGE_MAX);
      const full = lv >= 0.999;
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.32 * lv;
      ctx.strokeStyle = full ? PAL['y'] : PAL['e'];
      ctx.lineWidth = 2;
      const pad = 4 + Math.round(lv * 4) + Math.round(Math.sin(this.time / 90));
      ctx.strokeRect(sx - pad, sy - pad, P_W + pad * 2, P_H + pad * 2);
      ctx.restore();
    }
  }

  /** 出手动画：按装备武器画不同图形（剑挥砍 / 斧挥砍 / 飞镖投掷） */
  private drawSword(ctx: CanvasRenderingContext2D): void {
    const dur = this.weapon.attack === 'ranged' ? 120 : 160;
    const p = 1 - this.swingTimer / dur; // 0→1
    const handX = this.playerX + 10;
    const handY = GROUND_Y - 30;
    // 飞镖：投掷出手（手臂前伸），不画冷兵器
    if (this.weapon.attack === 'ranged') {
      const thrust = Math.sin(p * Math.PI); // 0→1→0
      const armX = handX + Math.round(thrust * 16);
      pixelLine(ctx, handX, handY, armX, handY, PAL['s']); // 手臂（肤色）
      pixelLine(ctx, handX, handY - 1, armX, handY - 1, PAL['S']);
      pixelRect(ctx, armX, handY - 1, 3, 3, PAL['e']); // 手中的飞镖
      return;
    }
    const ang = (-65 + p * 78) * (Math.PI / 180); // -65° → +13°
    const isAxe = this.weapon.id === 'axe';
    const len = isAxe ? 32 : 40;
    const tipX = handX + Math.cos(ang) * len;
    const tipY = handY + Math.sin(ang) * len;
    if (isAxe) {
      // 斧柄（木色）
      pixelLine(ctx, handX, handY, Math.round(tipX), Math.round(tipY), PAL['n']);
      pixelLine(ctx, handX, handY - 1, Math.round(tipX), Math.round(tipY) - 1, PAL['N']);
      // 斧头：在尖端画一块钢色（沿柄法向）
      const nx = -Math.sin(ang);
      const ny = Math.cos(ang);
      const hx = Math.round(tipX + nx * 4);
      const hy = Math.round(tipY + ny * 4);
      pixelRect(ctx, hx - 3, hy - 3, 7, 7, PAL['W']);
      pixelRect(ctx, hx - 3, hy - 3, 7, 2, PAL['w']); // 高光
      pixelRect(ctx, hx - 1, hy + 2, 3, 2, PAL['e']); // 刃口
      // 残影
      ctx.save();
      ctx.globalAlpha = 0.35 * (1 - p);
      for (let k = 0; k < 3; k++) {
        const a = ang - (k + 1) * 0.22;
        pixelLine(ctx, handX, handY, Math.round(handX + Math.cos(a) * len), Math.round(handY + Math.sin(a) * len), PAL['O']);
      }
      ctx.restore();
      return;
    }
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

  /** 蓄力条：玩家头顶，按等级填充，蓄满时金色脉动 + 三段刻度 */
  private drawChargeBar(ctx: CanvasRenderingContext2D): void {
    const level = Math.min(1, this.chargeT / CHARGE_MAX);
    const full = level >= 0.999;
    const bw = 46;
    const bh = 6;
    const bx = Math.round(this.playerX - bw / 2);
    const by = Math.round(GROUND_Y - P_H - 16);
    pixelRect(ctx, bx - 2, by - 2, bw + 4, bh + 4, PAL['K']);
    pixelRect(ctx, bx, by, bw, bh, '#1a1438');
    pixelRect(ctx, bx, by, Math.round(bw * level), bh, full ? PAL['y'] : PAL['e']);
    // 三段刻度（区分蓄力阶段）
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = PAL['K'];
    for (let k = 1; k < 3; k++) ctx.fillRect(bx + Math.round((bw * k) / 3), by + 1, 1, bh - 2);
    ctx.restore();
    if (full) {
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.4 * Math.sin(this.time / 80);
      ctx.strokeStyle = PAL['y'];
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - 3, by - 3, bw + 6, bh + 6);
      ctx.restore();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = "7px 'Press Start 2P', monospace";
    ctx.fillStyle = full ? PAL['y'] : PAL['e'];
    ctx.fillText(full ? '蓄力满!' : '蓄力中', Math.round(this.playerX), by - 8);
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

    // 经验条 + 等级（怒气条下方，升级得属性点）
    const ex = rx;
    const ey = ry + 20;
    pixelRect(ctx, ex - 2, ey - 2, rw + 4, 9, PAL['K']);
    pixelRect(ctx, ex, ey, rw, 5, '#2a2150');
    const expRatio = Math.min(1, this.exp / this.expForNext());
    pixelRect(ctx, ex, ey, Math.round(rw * expRatio), 5, PAL['e']);
    ctx.fillStyle = PAL['e'];
    ctx.font = "7px 'Press Start 2P', monospace";
    ctx.fillText(`Lv.${this.level}  EXP ${Math.round(expRatio * 100)}%`, ex, ey + 8);

    // 激活中的增益（经验条下方）
    let buffY = ey + 20;
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
    // 威胁等级（随存活时间递增：种类更多 / 血量更高 / 伤害更高；越高越红）
    const dTier = Math.floor(this.time / 18000) + 1;
    ctx.fillStyle = dTier >= 5 ? PAL['A'] : dTier >= 3 ? PAL['o'] : PAL['m'];
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.fillText(`威胁 Lv.${dTier}`, VW / 2, 56);

    // 击杀（右上）
    ctx.textAlign = 'right';
    ctx.fillStyle = PAL['y'];
    ctx.fillText(`KILLS ${this.kills}`, VW - 14, 16);
    // 存活时间（右上，KILLS 下方）
    const tSec = Math.floor(this.time / 1000);
    ctx.fillStyle = PAL['m'];
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.fillText(`⏱ ${Math.floor(tSec / 60)}:${String(tSec % 60).padStart(2, '0')}`, VW - 14, 30);

    // 已装备的装备图标（头盔/护甲/靴子，左下）
    const helm = this.state.equippedGearDef('helm');
    const armor = this.state.equippedGearDef('armor');
    const boots = this.state.equippedGearDef('boots');
    if (helm || armor || boots) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = '12px serif';
      ctx.globalAlpha = 0.85;
      ctx.fillText(`${helm?.icon ?? ''}${armor?.icon ?? ''}${boots?.icon ?? ''}`, 14, VH - 34);
      ctx.globalAlpha = 1;
    }

    // 当前武器蓄力技（左下；恢复中变暗）
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = "8px 'Press Start 2P', monospace";
    const onCd = this.chargeCd > 0;
    ctx.globalAlpha = onCd ? 0.4 : 0.85;
    ctx.fillStyle = onCd ? PAL['m'] : PAL['e'];
    ctx.fillText(`${this.weapon.charge.icon} 蓄力·${this.weapon.charge.name}`, 14, VH - 18);
    ctx.globalAlpha = 1;

    // 操作提示（首次未挥剑时）
    if (this.kills === 0 && this.swingTimer <= 0) {
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.time / 300);
      ctx.fillStyle = PAL['w'];
      ctx.font = "8px 'Press Start 2P', monospace";
      ctx.fillText('点屏攻击 · 长按蓄力', VW / 2, GROUND_Y - 40);
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
