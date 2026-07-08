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
import type { BattleStats } from '../shared/types';
import type { GameState } from '../shared/state';

// ---------- 怪物精灵（12 宽，scale=2 → 24px） ----------
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
const M_SCALE = 2;
const M_W = SLIME[0].length * M_SCALE; // 24
const M_H = SLIME.length * M_SCALE; // 14

// 玩家精灵尺寸（CHAR_IDLE 16×24, scale 2 → 32×48）
const P_W = CHAR_IDLE[0].length * CHAR_SCALE;
const P_H = CHAR_IDLE.length * CHAR_SCALE;

interface Monster {
  x: number; // 中心 x
  hp: number;
  maxHp: number;
  speed: number; // px/秒
  type: 'slime' | 'imp';
  hitFlash: number; // 命中白闪剩余 ms
}

interface Floater {
  x: number;
  y: number;
  vy: number;
  life: number; // 剩余 ms
  text: string;
  color: string;
}

interface BattleCallbacks {
  onCoins: () => void;
}

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
  private monsters: Monster[] = [];
  private floaters: Floater[] = [];
  private stars: Array<{ x: number; y: number; p: number }> = [];
  private spawnTimer = 900;
  private swingCd = 0; // 挥剑冷却剩余 ms
  private swingTimer = 0; // 挥剑动画剩余 ms（>0 表示正在挥）
  private playerFlash = 0; // 受伤红闪
  private playerInvuln = 0; // 受伤无敌帧
  private dead = false;
  private time = 0;

  constructor(canvas: HTMLCanvasElement, state: GameState, cb: BattleCallbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.state = state;
    this.cb = cb;
    this.stats = state.battleStats();
    this.hp = this.stats.maxHp;
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
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    // 离开时把本局赚到的金币落盘（earn 不自动 save）
    this.state.save();
  }

  /** 技能树变动后重算派生属性；maxHp 可能提升，当前血量按上限钳制 */
  syncAfterBuy(): void {
    this.stats = this.state.battleStats();
    if (this.hp > this.stats.maxHp) this.hp = this.stats.maxHp;
    if (this.dead) return;
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
      this.respawn();
      return;
    }
    this.trySwing();
  };

  // ---------- 战斗 ----------
  private trySwing(): void {
    if (this.swingCd > 0 || this.dead) return;
    this.swingCd = this.stats.cooldown;
    this.swingTimer = 160;
    audio.sfx('throw');
    // 即时判定：挥剑瞬间对前方所有怪物造成伤害
    const reach = this.playerX + 84;
    let hitAny = false;
    for (const m of this.monsters) {
      if (m.x < this.playerX - 6 || m.x > reach) continue;
      let dmg = this.stats.damage;
      const crit = Math.random() < this.stats.crit;
      if (crit) dmg = Math.round(dmg * this.stats.critMult);
      m.hp -= dmg;
      m.hitFlash = 90;
      m.x += 16; // 击退
      this.addFloater(m.x, GROUND_Y - M_H - 6, String(dmg), crit ? '#ffd45e' : '#ffffff');
      if (this.stats.lifesteal > 0 && this.hp < this.stats.maxHp) {
        this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.lifesteal);
      }
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
    const coin = Math.round((4 + this.wave) * (1 + this.stats.coinBonus));
    this.state.earn(coin);
    this.cb.onCoins();
    this.addFloater(m.x, GROUND_Y - M_H - 14, `+🪙${coin}`, '#ffd45e');
    audio.sfx(this.wave >= 4 ? 'coinBig' : 'coin');
    // 每 10 击杀晋级一波
    if (this.kills % 10 === 0) {
      this.wave++;
      this.addFloater(VW / 2, VH / 2, `WAVE ${this.wave}`, '#7df9ff');
      audio.sfx('combo');
    }
  }

  private damagePlayer(n: number): void {
    if (this.dead || this.playerInvuln > 0) return;
    this.hp -= n;
    this.playerFlash = 300;
    this.playerInvuln = 720;
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
    this.hp = this.stats.maxHp;
    this.monsters = [];
    this.wave = 1;
    this.spawnTimer = 900;
    this.playerInvuln = 500;
  }

  private addFloater(x: number, y: number, text: string, color: string): void {
    if (this.floaters.length > 24) this.floaters.shift();
    this.floaters.push({ x, y, vy: -0.05, life: 720, text, color });
  }

  // ---------- 主循环 ----------
  private loop = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(50, now - this.last);
    this.last = now;
    this.time += dt;
    this.update(dt);
    this.render();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    if (this.dead) return;
    if (this.swingCd > 0) this.swingCd -= dt;
    if (this.swingTimer > 0) this.swingTimer -= dt;
    if (this.playerFlash > 0) this.playerFlash -= dt;
    if (this.playerInvuln > 0) this.playerInvuln -= dt;

    // 生成怪物
    this.spawnTimer -= dt;
    const interval = Math.max(520, 1500 - this.wave * 90);
    if (this.spawnTimer <= 0 && this.monsters.length < 10) {
      this.spawnMonster();
      this.spawnTimer = interval;
    }

    // 怪物推进 + 接触判定
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      m.x -= (m.speed * dt) / 1000;
      if (m.hitFlash > 0) m.hitFlash -= dt;
      // 接触玩家：扣血并自爆
      if (m.x - M_W / 2 <= this.playerX + 14) {
        this.damagePlayer(1);
        this.addFloater(this.playerX, GROUND_Y - P_H + 8, '💥', '#e84753');
        this.monsters.splice(i, 1);
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

  private spawnMonster(): void {
    const imp = this.wave >= 3 && Math.random() < 0.4;
    const baseHp = imp ? 4 + Math.floor(this.wave * 0.9) : 2 + Math.floor(this.wave * 0.7);
    const speed = (imp ? 34 : 26) + this.wave * 2;
    this.monsters.push({
      x: VW + 30,
      hp: baseHp,
      maxHp: baseHp,
      speed: Math.min(speed, 92),
      type: imp ? 'imp' : 'slime',
      hitFlash: 0,
    });
  }

  // ---------- 渲染 ----------
  private render(): void {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    this.drawBackground(ctx);

    // 怪物（按 x 倒序，远的先画）
    const sorted = [...this.monsters].sort((a, b) => b.x - a.x);
    for (const m of sorted) this.drawMonster(ctx, m);

    // 玩家
    this.drawPlayer(ctx);
    if (this.swingTimer > 0) this.drawSword(ctx);

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

    this.drawHud(ctx);
    if (this.dead) this.drawGameOver(ctx);
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
    const bob = Math.round(Math.sin(this.time / 200 + m.x) * 1); // 走动微抖
    const sx = Math.round(m.x - M_W / 2);
    const sy = Math.round(GROUND_Y - M_H) + bob;
    // 阴影
    ctx.save();
    ctx.globalAlpha = 0.3;
    pixelEllipse(ctx, Math.round(m.x), GROUND_Y - 1, 11, 3, PAL['K']);
    ctx.restore();
    drawSprite(ctx, m.type === 'imp' ? IMP : SLIME, sx, sy, M_SCALE, false);
    // 命中白闪
    if (m.hitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      pixelRect(ctx, sx, sy, M_W, M_H, '#ffffff');
      ctx.restore();
    }
    // 血条（多血怪物显示）
    if (m.maxHp > 2) {
      const bw = M_W;
      pixelRect(ctx, sx, sy - 6, bw, 3, PAL['K']);
      pixelRect(ctx, sx, sy - 6, Math.round((bw * Math.max(0, m.hp)) / m.maxHp), 3, PAL['A']);
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
    const ratio = Math.max(0, this.hp / this.stats.maxHp);
    const hpColor = ratio > 0.5 ? PAL['g'] : ratio > 0.25 ? PAL['y'] : PAL['A'];
    pixelRect(ctx, bx, by, Math.round(bw * ratio), bh, hpColor);
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`HP ${this.hp}/${this.stats.maxHp}`, bx + 4, by + 3);

    // 波次（中上）
    ctx.textAlign = 'center';
    ctx.fillStyle = PAL['e'];
    ctx.font = "10px 'Press Start 2P', monospace";
    ctx.fillText(`WAVE ${this.wave}`, VW / 2, 16);

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
    ctx.fillText('GAME OVER', VW / 2, VH / 2 - 18);
    ctx.fillStyle = PAL['w'];
    ctx.font = "9px 'Press Start 2P', monospace";
    ctx.fillText(`KILLS ${this.kills}  ·  WAVE ${this.wave}`, VW / 2, VH / 2 + 8);
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.time / 300);
    ctx.fillStyle = PAL['e'];
    ctx.fillText('TAP TO RESTART · 点屏重来', VW / 2, VH / 2 + 34);
    ctx.restore();
  }
}
