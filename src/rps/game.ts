// ===== 读心锤剪布格斗（RPS battler）=====
// 玩家 vs 像素敌人，双方有血量。每回合：敌人蓄力给「概率暗示」(读招窗口) → 玩家出招 →
// 揭晓判定。胜→扣敌血(×连击/对峙/暴击)、负→掉血、平→攒对峙。诚实敌人暗示=真招(可读)，
// 骗招型暗示有概率失真。击杀敌人掉金币进共享钱包；每 5 个一个 Boss。
// 风格与飞镖/打怪一致：复用 contract 的 PAL/drawSprite/像素工具/VW×VH，玩家复用 CHAR_IDLE。
// 生命周期同 Battle：start/stop 控制 rAF；出招由外部 DOM 按钮调 choose()。

import {
  VW,
  VH,
  GROUND_Y,
  applyLayout,
  drawSprite,
  pixelRect,
  pixelEllipse,
  PAL,
} from '../dart/render/contract';
import { CHAR_IDLE, CHAR_SCALE } from '../dart/render/character';
import { audio } from '../shared/audio';
import { settings } from '../shared/settings';
import type { RpsStats } from '../shared/types';
import type { GameState } from '../shared/state';

type Move = 'rock' | 'paper' | 'scissors';
type Phase = 'telegraph' | 'reveal' | 'over';
type Personality = 'random' | 'favorite' | 'mimic' | 'counter' | 'bluffer' | 'boss';

const MOVE_EMOJI: Record<Move, string> = { rock: '🔨', paper: '📜', scissors: '✂️' };
const MOVES: Move[] = ['rock', 'paper', 'scissors'];

function randomMove(): Move {
  return MOVES[Math.floor(Math.random() * 3)];
}
/** a 是否克制 b */
function beats(a: Move, b: Move): boolean {
  return (a === 'rock' && b === 'scissors') || (a === 'scissors' && b === 'paper') || (a === 'paper' && b === 'rock');
}
/** 返回克制 m 的招 */
function counterMove(m: Move): Move {
  return m === 'rock' ? 'paper' : m === 'paper' ? 'scissors' : 'rock';
}
/** 返回一个 != m 的随机招（用于骗招暗示） */
function otherMove(m: Move): Move {
  const others = MOVES.filter((x) => x !== m);
  return others[Math.floor(Math.random() * others.length)];
}

function personalityFor(tier: number): Personality {
  if (tier > 0 && tier % 5 === 4) return 'boss';
  if (tier === 0) return 'random';
  if (tier === 1) return 'favorite';
  if (tier === 2) return 'mimic';
  if (tier === 3) return 'counter';
  return 'bluffer';
}

/** 敌人性格的中文名（HUD 展示，让玩家读懂对手类型） */
const PERSONALITY_NAME: Record<Personality, string> = {
  random: '随机',
  favorite: '偏好',
  mimic: '模仿',
  counter: '克制',
  bluffer: '骗招',
  boss: '魔王',
};

/** 按敌人性格选出本回合真招 + 暗示（暗示可能失真） */
function pickMoveAndTell(p: Personality, last: Move | null, tier: number): { move: Move; tell: Move } {
  switch (p) {
    case 'favorite': {
      const fav = MOVES[tier % 3];
      const m = Math.random() < 0.6 ? fav : randomMove();
      return { move: m, tell: m };
    }
    case 'mimic': {
      const m = last ?? randomMove();
      return { move: m, tell: m };
    }
    case 'counter': {
      const m = last ? counterMove(last) : randomMove();
      return { move: m, tell: m };
    }
    case 'bluffer': {
      const m = randomMove();
      const bluffRate = 0.35 + Math.min(0.2, tier * 0.03);
      const tell = Math.random() < bluffRate ? otherMove(m) : m;
      return { move: m, tell };
    }
    case 'boss': {
      // 半数反向克制你的上一手，半数随机；暗示 50% 失真
      const m = Math.random() < 0.5 && last ? counterMove(last) : randomMove();
      const tell = Math.random() < 0.5 ? otherMove(m) : m;
      return { move: m, tell };
    }
    case 'random':
    default: {
      const m = randomMove();
      return { move: m, tell: m };
    }
  }
}

interface Enemy {
  hp: number;
  maxHp: number;
  move: Move;
  tell: Move;
  personality: Personality;
  tier: number;
}

interface Floater {
  x: number;
  y: number;
  vy: number;
  life: number;
  text: string;
  color: string;
}

// 敌人精灵（12 宽，scale=2 → 24px）
const FOE_SLIME: string[] = [
  '...kkkkkk...',
  '..kgggggggk.',
  '.kggGGggGGk.',
  '.kgwkggwkgk.',
  '.kggggggggk.',
  '.ggggggggggk',
  'kkkkkkkkkkkk',
];
const FOE_BOSS: string[] = [
  '.p..pp..pp..',
  '..ppppppppp.',
  '.pPPppPPpp k',
  '.pPPkppkPPk.',
  '.pppppppppp.',
  '.PPPPPPPPPPk',
  'kkkkkkkkkkkk',
];
const M_SCALE = 2;
const M_W = FOE_SLIME[0].length * M_SCALE;
const M_H = FOE_SLIME.length * M_SCALE;

const P_W = CHAR_IDLE[0].length * CHAR_SCALE;
const P_H = CHAR_IDLE.length * CHAR_SCALE;
const PLAYER_X = 112;

interface RpsCallbacks {
  onCoins: () => void;
  onUlt: (ready: boolean) => void;
}

export class RpsBattle {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: GameState;
  private cb: RpsCallbacks;
  private ro?: ResizeObserver;

  private running = false;
  private rafId = 0;
  private last = 0;
  private time = 0;

  private stats!: RpsStats;
  private hp: number;
  private enemy!: Enemy;
  private enemyTier = 0;
  private kills = 0;
  private combo = 0;
  private clash = 0;

  private phase: Phase = 'telegraph';
  private playerMove: Move | null = null;
  private playerLastMove: Move | null = null;
  private tellTimer = 0;
  private revealTimer = 0;
  private lastResult: 'win' | 'lose' | 'tie' | null = null;
  private lastCrit = false;
  private pendingOutcome: 'win' | 'lose' | 'tie' = 'tie';
  private pendingDmg = 0;
  private floaters: Floater[] = [];
  private stars: Array<{ x: number; y: number; p: number }> = [];
  // 打击感
  private shake = 0;
  private particles: { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number }[] = [];
  private flash = 0;
  private flashColor = '#ffffff';
  // 连击狂热（连杀≥10 → 金币×1.5）
  private fever = false;
  // 怒气 / 必胜一击
  private rage = 0;
  private readonly rageMax = 100;
  private ultReady = false;
  private ultArmedWin = false; // 本回合被必胜一击强制判胜
  // Boss 必杀槽
  private bossCharge = 0;
  private bossPending = false; // Boss 必杀已蓄满，本回合将释放（除非你胜）

  constructor(canvas: HTMLCanvasElement, state: GameState, cb: RpsCallbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.state = state;
    this.cb = cb;
    this.refreshStats();
    this.hp = this.stats.maxHp;
    this.genStars();
    this.resize();
    this.spawnEnemy();
    this.startRound();
    canvas.addEventListener('pointerdown', this.onPointerDown);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(this.resize);
      this.ro.observe(canvas);
    }
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
  }

  private genStars(): void {
    this.stars = [];
    for (let i = 0; i < 46; i++) {
      const r1 = ((i * 9301 + 49297) % 233280) / 233280;
      const r2 = ((i * 49297 + 9301) % 233280) / 233280;
      this.stars.push({ x: Math.round(r1 * 640), y: Math.round(r2 * (GROUND_Y - 30)), p: r1 });
    }
  }

  start(): void {
    if (this.running) return;
    this.refreshStats(); // 进入页面时刷新（含新购的 meta HP）
    if (this.phase === 'over') this.restart(); // 重进自动开新局
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.state.save(); // 落盘本局赚到的金币
  }

  /** 暂停循环但不落盘（开技能弹窗时调用）。用 start() 恢复。 */
  pause(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  syncAfterBuy(): void {
    this.refreshStats();
  }
  /** 重算派生属性（拷贝避免污染缓存），叠加 meta HP；在进入/买技能/买 meta 时刷新 */
  private refreshStats(): void {
    this.stats = { ...this.state.rpsStats() };
    this.stats.maxHp += this.state.metaHP();
    if (this.hp > this.stats.maxHp) this.hp = this.stats.maxHp;
  }

  /** 外部 DOM 按钮（🔨/📜/✂️）调用；over 时任意按钮/点屏 → 重开 */
  choose(move: Move): void {
    if (this.phase === 'over') {
      this.restart();
      return;
    }
    if (this.phase !== 'telegraph') return;
    this.playerMove = move;
    this.phase = 'reveal';
    this.revealTimer = 700;
    this.computeOutcome(); // 进入揭晓即算好结果，供动画期间显示
    audio.sfx('throw');
  }

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.phase === 'over') this.restart();
  };

  private get enemyX(): number {
    return VW - 140;
  }

  private resize = (): void => {
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    if (!cssW || !cssH) return;
    const aspect = cssW / cssH;
    const vw = Math.max(480, Math.min(1300, Math.round(360 * aspect)));
    applyLayout(vw);
    this.canvas.width = vw;
    this.canvas.height = VH;
    this.ctx.imageSmoothingEnabled = false;
  };

  // ---------- 回合逻辑 ----------
  private spawnEnemy(): void {
    const tier = this.enemyTier;
    const pers = personalityFor(tier);
    let maxHp = 30 + tier * 12;
    if (pers === 'boss') maxHp = Math.round(maxHp * 1.7);
    this.enemy = { hp: maxHp, maxHp, move: 'rock', tell: 'rock', personality: pers, tier };
    this.bossCharge = 0;
    this.bossPending = false;
    if (pers === 'boss') {
      // Boss 登场横幅（构造期 tier=0 不会触发）
      this.addFloater(VW / 2, VH / 2 - 30, `⚠ BOSS #${tier + 1} ⚠`, '#e84753');
      audio.sfx('unlock');
    }
  }

  private startRound(): void {
    this.phase = 'telegraph';
    this.playerMove = null;
    const pick = pickMoveAndTell(this.enemy.personality, this.playerLastMove, this.enemyTier);
    this.enemy.move = pick.move;
    this.enemy.tell = pick.tell;
    this.tellTimer = this.stats.tellWindow;
    this.lastResult = null;
    // Boss 必杀槽：每回合蓄能，满则本回合释放（除非你判胜打断）
    if (this.enemy.personality === 'boss') {
      if (!this.bossPending) {
        this.bossCharge = Math.min(100, this.bossCharge + 22);
        if (this.bossCharge >= 100) {
          this.bossPending = true;
          this.addFloater(this.enemyX, GROUND_Y - 96, '魔王蓄力!', '#e84753');
        }
      }
    }
  }

  /** 进入揭晓时即判定结果 + 预计算伤害（揭晓动画期间显示结果，结束才结算） */
  private computeOutcome(): void {
    const p = this.playerMove ?? randomMove();
    const e = this.enemy.move;
    let outcome: 'win' | 'lose' | 'tie';
    if (this.ultArmedWin) {
      outcome = 'win'; // 必胜一击强制判胜
      this.ultArmedWin = false;
    } else if (p === e) {
      outcome = 'tie';
    } else {
      outcome = beats(p, e) ? 'win' : 'lose';
    }
    if (outcome === 'tie' && Math.random() < this.stats.tiebreaker) outcome = 'win';
    this.lastResult = outcome;
    this.pendingOutcome = outcome;
    if (outcome === 'win') {
      this.lastCrit = Math.random() < this.stats.crit;
      let dmg = this.stats.damage * (this.lastCrit ? this.stats.critMult : 1);
      dmg *= Math.min(this.stats.comboCap, 1 + this.combo * 0.2) * (1 + this.clash * 0.5);
      this.pendingDmg = Math.max(1, Math.round(dmg));
    } else if (outcome === 'lose') {
      this.lastCrit = false;
      this.pendingDmg = 8 + this.enemyTier * 2;
    } else {
      this.lastCrit = false;
      this.pendingDmg = 0;
    }
  }

  /** 揭晓动画结束后真正结算 */
  private applyOutcome(): void {
    const outcome = this.pendingOutcome;
    this.playerLastMove = this.playerMove;
    if (outcome === 'win') {
      this.enemy.hp -= this.pendingDmg;
      this.combo++;
      this.state.recordAchvMax('rpsMaxCombo', this.combo);
      this.clash = 0;
      // 连击≥10 → FEVER 狂热（金币×1.5）
      if (!this.fever && this.combo >= 10) {
        this.fever = true;
        this.addFloater(VW / 2, GROUND_Y - 100, '🔥 FEVER! 金币×1.5', '#ffd45e');
        this.addFlash('#ffd45e', 0.4);
        audio.sfx('comboTier');
      }
      if (this.stats.lifesteal > 0) {
        this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.lifesteal);
      }
      // 打击感 + 怒气
      this.burst(this.enemyX, GROUND_Y - 40, this.lastCrit ? 14 : 7, this.lastCrit ? PAL['y'] : PAL['w']);
      this.addShake(this.lastCrit ? 5 : 2);
      if (this.lastCrit) this.addFlash('#ffd45e', 0.35);
      audio.haptic(this.lastCrit ? 25 : 12);
      this.gainRage(this.lastCrit ? 30 : 22);
      // Boss 必杀被打断
      if (this.bossPending) {
        this.bossPending = false;
        this.bossCharge = 0;
        this.addFloater(VW / 2, GROUND_Y - 96, '打断必杀!', PAL['e']);
      }
      this.addFloater(
        this.enemyX,
        GROUND_Y - 56,
        (this.lastCrit ? '💥' : '') + this.pendingDmg,
        this.lastCrit ? '#ffd45e' : '#ffffff',
      );
      audio.sfx('hit');
      if (this.enemy.hp <= 0) {
        this.defeatEnemy();
        return;
      }
    } else if (outcome === 'lose') {
      let dmg = this.pendingDmg;
      this.hp -= dmg;
      this.combo = 0;
      if (this.fever) {
        this.fever = false;
        this.addFloater(VW / 2, GROUND_Y - 100, 'FEVER 中断', '#9a93c0');
      }
      // Boss 必杀：败/平时释放，额外大伤
      if (this.bossPending) {
        const extra = 16 + this.enemyTier * 2;
        this.hp -= extra;
        dmg += extra;
        this.bossPending = false;
        this.bossCharge = 0;
        this.addShake(9);
        this.addFlash('#e84753', 0.5);
        this.burst(PLAYER_X, GROUND_Y - 50, 20, PAL['A']);
        this.addFloater(VW / 2, GROUND_Y - 100, '魔王必杀!', '#e84753');
      } else {
        this.addShake(4);
        this.addFlash('#e84753', 0.3);
        this.burst(PLAYER_X, GROUND_Y - 50, 8, PAL['A']);
      }
      this.addFloater(PLAYER_X, GROUND_Y - 56, '-' + dmg, '#e84753');
      audio.sfx('lottoMiss');
      if (this.hp <= 0) {
        this.hp = 0;
        this.phase = 'over';
        audio.sfx('miss');
        this.state.save();
        return;
      }
    } else {
      this.clash++;
      // 平局时若 Boss 蓄满，也会释放（见 lose 分支逻辑共用：此处单独处理）
      if (this.bossPending) {
        const extra = 10 + this.enemyTier;
        this.hp -= extra;
        this.bossPending = false;
        this.bossCharge = 0;
        this.addShake(6);
        this.addFlash('#e84753', 0.4);
        this.addFloater(VW / 2, GROUND_Y - 100, '魔王必杀! -' + extra, '#e84753');
      }
      this.addFloater(VW / 2, GROUND_Y - 80, 'CLASH ' + this.clash, '#7df9ff');
      audio.sfx('combo');
    }
    this.startRound();
  }

  private defeatEnemy(): void {
    const wasBoss = this.enemy.personality === 'boss';
    let coin = Math.round((8 + this.enemyTier * 4) * (1 + this.combo * 0.1) * (1 + this.stats.coinBonus + (this.fever ? 0.5 : 0)));
    // Boss 击杀：大额奖金
    if (wasBoss) coin += 40 + this.enemyTier * 6;
    // 连击里程碑（每 5 连胜）：额外奖励
    let comboBonus = 0;
    if (this.combo > 0 && this.combo % 5 === 0) comboBonus = 15 + this.combo * 2;
    coin += comboBonus;
    this.state.earn(coin);
    this.cb.onCoins();
    // 成就计数（击杀 + Boss）
    this.state.incAchv('kills');
    if (wasBoss) this.state.incAchv('bosses');
    this.addFloater(this.enemyX, GROUND_Y - 86, '+🪙' + coin, wasBoss ? '#7df9ff' : '#ffd45e');
    if (comboBonus > 0) this.addFloater(VW / 2, GROUND_Y - 110, `COMBO x${this.combo} +🪙${comboBonus}`, '#ffd45e');
    audio.sfx(wasBoss ? 'jackpot' : 'coin');
    this.kills++;
    this.enemyTier++;
    // 击杀回血：Boss 大回，普通小回；额外 10% 概率掉心
    const heal = wasBoss ? 0.3 : 0.15;
    this.hp = Math.min(this.stats.maxHp, this.hp + Math.round(this.stats.maxHp * heal));
    if (!wasBoss && Math.random() < 0.1 && this.hp < this.stats.maxHp) {
      this.hp = Math.min(this.stats.maxHp, this.hp + Math.round(this.stats.maxHp * 0.1));
      this.addFloater(PLAYER_X, GROUND_Y - 70, '❤心!', '#e84753');
    }
    this.spawnEnemy();
    this.startRound();
  }

  private restart(): void {
    this.hp = this.stats.maxHp;
    this.enemyTier = 0;
    this.combo = 0;
    this.clash = 0;
    this.floaters = [];
    this.particles = [];
    this.rage = 0;
    this.ultReady = false;
    this.ultArmedWin = false;
    this.shake = 0;
    this.flash = 0;
    this.fever = false;
    this.cb.onUlt(false);
    this.spawnEnemy();
    this.startRound();
  }

  private addFloater(x: number, y: number, text: string, color: string): void {
    if (this.floaters.length > 24) this.floaters.shift();
    this.floaters.push({ x, y, vy: -0.05, life: 760, text, color });
  }

  // ---------- 打击感 ----------
  private addShake(n: number): void {
    if (settings.get().reduceMotion) return;
    this.shake = Math.min(14, this.shake + n);
  }
  private addFlash(color: string, strength = 0.5): void {
    if (settings.get().reduceMotion) return;
    this.flashColor = color;
    this.flash = Math.min(0.8, Math.max(this.flash, strength));
  }
  private burst(x: number, y: number, n: number, color: string, speed = 0.18): void {
    if (this.particles.length > 150) this.particles.splice(0, 40);
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
      p.vy += 0.0006 * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  // ---------- 怒气 / 必胜一击 ----------
  private gainRage(n: number): void {
    if (this.ultReady) return;
    this.rage = Math.min(this.rageMax, this.rage + n);
    if (this.rage >= this.rageMax) {
      this.ultReady = true;
      this.cb.onUlt(true);
      this.addFloater(VW / 2, GROUND_Y - 100, 'ULT READY!', '#ffd45e');
      audio.sfx('combo');
    }
  }
  /** 必胜一击：立即以克制敌人的招强制判胜本回合 */
  ultimate(): void {
    if (!this.ultReady || this.phase !== 'telegraph') return;
    this.ultReady = false;
    this.rage = 0;
    this.cb.onUlt(false);
    this.ultArmedWin = true;
    this.playerMove = counterMove(this.enemy.move); // 显示克制招
    this.phase = 'reveal';
    this.revealTimer = 700;
    this.addFlash('#7df9ff', 0.4);
    this.computeOutcome();
    audio.sfx('throw');
  }

  // ---------- 主循环 ----------
  private loop = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(50, now - this.last);
    this.last = now;
    this.time += dt;
    this.update(dt);
    this.shake = Math.max(0, this.shake - dt * 0.04);
    this.flash = Math.max(0, this.flash - dt * 0.003);
    this.updateParticles(dt);
    this.render();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    if (this.phase === 'telegraph') {
      this.tellTimer -= dt;
      if (this.tellTimer <= 0) {
        this.playerMove = randomMove(); // 超时随机出
        this.phase = 'reveal';
        this.revealTimer = 700;
        this.computeOutcome();
        audio.sfx('throw');
      }
    } else if (this.phase === 'reveal') {
      this.revealTimer -= dt;
      if (this.revealTimer <= 0) this.applyOutcome();
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.y += f.vy * dt;
      f.life -= dt;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }
  }

  // ---------- 渲染 ----------
  private render(): void {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (this.shake > 0.2) {
      ctx.translate(Math.round((Math.random() * 2 - 1) * this.shake), Math.round((Math.random() * 2 - 1) * this.shake));
    }
    this.drawBackground(ctx);
    this.drawEnemy(ctx);
    this.drawPlayer(ctx);
    if (this.phase === 'telegraph') this.drawTelegraph(ctx);
    else if (this.phase === 'reveal') this.drawReveal(ctx);
    // 粒子
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 400));
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
    this.drawFloaters(ctx);
    ctx.restore();
    // HUD 不受震动影响
    this.drawHud(ctx);
    if (this.phase === 'over') this.drawGameOver(ctx);
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

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#0b0a1f');
    g.addColorStop(0.6, '#1b1340');
    g.addColorStop(1, '#241a4a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
    for (const s of this.stars) {
      const tw = 0.5 + 0.5 * Math.sin(this.time / 700 + s.p * 8);
      ctx.globalAlpha = 0.35 + tw * 0.5;
      ctx.fillStyle = PAL['w'];
      ctx.fillRect(s.x % VW, s.y, 2, 2);
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.globalAlpha = 0.85;
    pixelEllipse(ctx, 90, 56, 16, 16, PAL['m']);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.5;
    pixelEllipse(ctx, VW * 0.35, GROUND_Y + 6, 120, 60, PAL['u']);
    pixelEllipse(ctx, VW * 0.72, GROUND_Y + 6, 150, 72, PAL['t']);
    ctx.restore();
    pixelRect(ctx, 0, GROUND_Y, VW, VH - GROUND_Y, '#1a1438');
    pixelRect(ctx, 0, GROUND_Y, VW, 3, PAL['G']);
    for (let x = 8; x < VW; x += 22) {
      pixelRect(ctx, x, GROUND_Y - 2, 2, 2, PAL['g']);
    }
  }

  private drawShadow(ctx: CanvasRenderingContext2D, cx: number): void {
    ctx.save();
    ctx.globalAlpha = 0.32;
    pixelEllipse(ctx, cx, GROUND_Y - 1, 14, 4, PAL['K']);
    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    const bob = Math.round(Math.sin(this.time / 600) * 1);
    const sx = Math.round(PLAYER_X - P_W / 2);
    const sy = Math.round(GROUND_Y - P_H) + bob;
    this.drawShadow(ctx, PLAYER_X);
    // 朝右面对敌人（不翻转；CHAR_IDLE 本就朝右）
    drawSprite(ctx, CHAR_IDLE, sx, sy, CHAR_SCALE, false);
  }

  private drawEnemy(ctx: CanvasRenderingContext2D): void {
    const ex = this.enemyX;
    const bob = Math.round(Math.sin(this.time / 220 + ex) * 1);
    const sx = Math.round(ex - M_W / 2);
    const sy = Math.round(GROUND_Y - M_H) + bob;
    this.drawShadow(ctx, ex);
    drawSprite(ctx, this.enemy.personality === 'boss' ? FOE_BOSS : FOE_SLIME, sx, sy, M_SCALE, true);
  }

  /** 读招阶段：敌人头顶思维泡 + 倒计时条 */
  private drawTelegraph(ctx: CanvasRenderingContext2D): void {
    const ex = this.enemyX;
    const bx = ex;
    const by = GROUND_Y - M_H - 40;
    // 思维泡底
    ctx.save();
    ctx.globalAlpha = 0.92;
    pixelRect(ctx, bx - 18, by - 16, 36, 26, PAL['w']);
    pixelRect(ctx, bx - 16, by - 14, 32, 22, '#2a2150');
    pixelRect(ctx, bx - 6, by + 9, 5, 5, PAL['w']);
    pixelRect(ctx, bx - 3, by + 13, 3, 3, PAL['w']);
    ctx.restore();
    // 暗示符号
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = "16px serif";
    ctx.fillText(MOVE_EMOJI[this.enemy.tell], bx, by - 2);

    // 倒计时条
    const ratio = Math.max(0, this.tellTimer / this.stats.tellWindow);
    const bw = 90;
    pixelRect(ctx, ex - bw / 2 - 1, GROUND_Y - M_H - 70, bw + 2, 7, PAL['K']);
    pixelRect(ctx, ex - bw / 2, GROUND_Y - M_H - 69, Math.round(bw * ratio), 5, PAL['e']);

    // 提示
    ctx.fillStyle = PAL['y'];
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.fillText('READ · 读招!', PLAYER_X, GROUND_Y - P_H - 16);
  }

  /** 揭晓阶段：双方大 emoji 对撞 + 结果 */
  private drawReveal(ctx: CanvasRenderingContext2D): void {
    const t = 1 - this.revealTimer / 700;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = VW / 2;
    const cy = GROUND_Y - 90;
    const gap = 26 + Math.round((1 - t) * 30); // 从远到近
    ctx.font = "30px serif";
    if (this.playerMove) ctx.fillText(MOVE_EMOJI[this.playerMove], cx - gap, cy);
    ctx.fillText(MOVE_EMOJI[this.enemy.move], cx + gap, cy);
    ctx.font = "12px 'Press Start 2P', monospace";
    if (this.lastResult === 'win') {
      ctx.fillStyle = PAL['g'];
      ctx.fillText('WIN!', cx, cy + 34);
    } else if (this.lastResult === 'lose') {
      ctx.fillStyle = PAL['A'];
      ctx.fillText('LOSE', cx, cy + 34);
    } else if (this.lastResult === 'tie') {
      ctx.fillStyle = PAL['e'];
      ctx.fillText('CLASH', cx, cy + 34);
    }
  }

  private drawFloaters(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.floaters) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life / 760));
      ctx.fillStyle = f.color;
      ctx.font = "10px 'Press Start 2P', monospace";
      ctx.fillText(f.text, Math.round(f.x), Math.round(f.y));
    }
    ctx.globalAlpha = 1;
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    // 玩家 HP 条（左上）
    this.drawBar(ctx, 14, 14, 150, 14, this.hp / this.stats.maxHp, PAL['g']);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`YOU ${Math.max(0, this.hp)}/${this.stats.maxHp}`, 18, 17);

    // 怒气条（玩家 HP 下方）
    const rx = 14;
    const ry = 32;
    pixelRect(ctx, rx - 2, ry - 2, 154, 8, PAL['K']);
    pixelRect(ctx, rx, ry, 150, 4, '#2a2150');
    pixelRect(ctx, rx, ry, Math.round(150 * (this.rage / this.rageMax)), 4, this.ultReady ? PAL['y'] : PAL['O']);
    ctx.textAlign = 'left';
    ctx.fillStyle = this.ultReady ? PAL['y'] : PAL['m'];
    ctx.font = "7px 'Press Start 2P', monospace";
    ctx.fillText(this.ultReady ? 'ULT READY ⭐' : `RAGE ${Math.round((this.rage / this.rageMax) * 100)}%`, rx, ry + 6);

    // 敌人 HP 条（右上）
    const eRatio = Math.max(0, this.enemy.hp / this.enemy.maxHp);
    this.drawBar(ctx, VW - 164, 14, 150, 14, eRatio, PAL['A']);
    ctx.textAlign = 'right';
    ctx.fillStyle = this.enemy.personality === 'boss' ? PAL['A'] : '#ffffff';
    ctx.fillText(`#${this.enemyTier + 1} · ${PERSONALITY_NAME[this.enemy.personality]}`, VW - 18, 17);

    // Boss 必杀槽（敌人 HP 下方）
    if (this.enemy.personality === 'boss') {
      const br = this.bossCharge / 100;
      pixelRect(ctx, VW - 164, 32, 150, 5, '#2a2150');
      pixelRect(ctx, VW - 164, 32, Math.round(150 * br), 5, this.bossPending ? PAL['A'] : PAL['R']);
      ctx.textAlign = 'right';
      ctx.fillStyle = this.bossPending ? PAL['A'] : PAL['m'];
      ctx.font = "7px 'Press Start 2P', monospace";
      ctx.fillText(this.bossPending ? '必杀将至! 必须赢' : `BOSS 必杀 ${Math.round(br * 100)}%`, VW - 18, 38);
    }

    // 中上：连击 + 对峙
    ctx.textAlign = 'center';
    const mult = Math.min(this.stats.comboCap, 1 + this.combo * 0.2);
    ctx.fillStyle = this.combo > 0 ? PAL['y'] : PAL['W'];
    ctx.font = "10px 'Press Start 2P', monospace";
    ctx.fillText(`COMBO x${mult.toFixed(1)}`, VW / 2, 16);
    // 对峙 pips
    if (this.clash > 0) {
      ctx.fillStyle = PAL['e'];
      ctx.font = "8px 'Press Start 2P', monospace";
      ctx.fillText(`CLASH ${this.clash} (下次胜 +${this.clash * 50}%)`, VW / 2, 32);
    }

    // 击杀数（中下）
    ctx.fillStyle = PAL['m'];
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.fillText(`KILLS ${this.kills}`, VW / 2, GROUND_Y - 14);
  }

  private drawBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ratio: number, color: string): void {
    pixelRect(ctx, x - 2, y - 2, w + 4, h + 4, PAL['K']);
    pixelRect(ctx, x, y, w, h, '#2a2150');
    pixelRect(ctx, x, y, Math.round(w * Math.max(0, Math.min(1, ratio))), h, color);
  }

  private drawGameOver(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = 'rgba(5,4,15,0.72)';
    ctx.fillRect(0, 0, VW, VH);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PAL['A'];
    ctx.font = "18px 'Press Start 2P', monospace";
    ctx.fillText('GAME OVER', VW / 2, VH / 2 - 18);
    ctx.fillStyle = PAL['w'];
    ctx.font = "9px 'Press Start 2P', monospace";
    ctx.fillText(`KILLS ${this.kills}  ·  REACHED FOE #${this.enemyTier + 1}`, VW / 2, VH / 2 + 8);
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.time / 300);
    ctx.fillStyle = PAL['e'];
    ctx.fillText('TAP A BUTTON · 点按钮重来', VW / 2, VH / 2 + 34);
    ctx.restore();
  }
}
