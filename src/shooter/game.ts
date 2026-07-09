// ===== 纵向射击关卡（STG demo）=====
// 拖动战机走位（指针即目标，lerp 跟手）、自动开火向上、击落下落敌阵、躲敌方弹幕。
// 存活越久金币越多；风格与飞镖/打怪一致：复用 contract 的 PAL/像素工具/VW×VH。
// 生命周期同 Battle/Rps：start/stop/pause 控制 rAF；技能走 state.shooterStats()。

import {
  VW,
  VH,
  applyLayout,
  pixelRect,
  PAL,
} from '../dart/render/contract';
import { audio } from '../shared/audio';
import { settings } from '../shared/settings';
import type { ShooterStats } from '../shared/types';
import type { GameState } from '../shared/state';

interface PBullet { x: number; y: number; }
interface EBullet { x: number; y: number; vx: number; vy: number; }
interface Enemy {
  x: number; y: number; hp: number; maxHp: number;
  type: 'grunt' | 'drone' | 'gunner'; t: number; fireTimer: number; hitFlash: number; r: number;
}
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number; }
interface Floater { x: number; y: number; vy: number; life: number; text: string; color: string; }

interface ShooterCallbacks {
  onCoins: () => void;
}

export class Shooter {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: GameState;
  private cb: ShooterCallbacks;
  private ro?: ResizeObserver;

  private running = false;
  private rafId = 0;
  private last = 0;
  private time = 0;

  private stats!: ShooterStats;
  private hp: number;
  private regenAcc = 0;
  private score = 0;
  private elapsed = 0; // 秒
  private survivalTimer = 0;

  private px: number; // 玩家中心
  private py: number;
  private tx: number; // 指针目标
  private ty: number;
  private invuln = 0;
  private fireTimer = 0;
  private spawnTimer = 700;

  private pbullets: PBullet[] = [];
  private ebullets: EBullet[] = [];
  private enemies: Enemy[] = [];
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private stars: Array<{ x: number; y: number; s: number }> = [];

  private shake = 0;
  private flash = 0;
  private flashColor = '#ffffff';
  private dead = false;
  private keys = new Set<string>(); // 键盘移动（桌面端方向键/WASD）

  constructor(canvas: HTMLCanvasElement, state: GameState, cb: ShooterCallbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.state = state;
    this.cb = cb;
    this.refreshStats();
    this.hp = this.stats.maxHp;
    this.px = this.tx = VW / 2;
    this.py = this.ty = VH - 50;
    this.genStars();
    this.resize();
    canvas.addEventListener('pointerdown', this.onPointer);
    canvas.addEventListener('pointermove', this.onPointer);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(this.resize);
      this.ro.observe(canvas);
    }
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'arrowright' || k === 'arrowup' || k === 'arrowdown' || k === 'a' || k === 'd' || k === 'w' || k === 's') {
      this.keys.add(k);
      if (this.running) e.preventDefault(); // 仅游戏中拦截方向键翻页
    }
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private genStars(): void {
    this.stars = [];
    for (let i = 0; i < 60; i++) {
      this.stars.push({ x: Math.random() * VW, y: Math.random() * VH, s: 0.5 + Math.random() * 1.5 });
    }
  }

  start(): void {
    if (this.running) return;
    this.refreshStats(); // 进入页面时刷新（含新购的 meta HP）
    if (this.dead) this.respawn(); // 重进自动开新局
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }
  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.state.save();
  }
  pause(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }
  syncAfterBuy(): void {
    this.refreshStats();
  }
  /** 重算派生属性（拷贝避免污染缓存），叠加 meta HP */
  private refreshStats(): void {
    this.stats = { ...this.state.shooterStats() };
    this.stats.maxHp += this.state.metaHP();
    if (this.hp > this.stats.maxHp) this.hp = this.stats.maxHp;
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

  /** 屏幕坐标 → 画布坐标（兼容 .game-root.rotated 的 90° 旋转） */
  private map(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: this.px, y: this.py };
    const rotated = !!document.getElementById('gameRoot')?.classList.contains('rotated');
    if (rotated) {
      return {
        x: (e.clientY - rect.top) * (VW / rect.height),
        y: (rect.left + rect.width - e.clientX) * (VH / rect.width),
      };
    }
    return {
      x: (e.clientX - rect.left) * (VW / rect.width),
      y: (e.clientY - rect.top) * (VH / rect.height),
    };
  }

  private onPointer = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.dead) {
      this.respawn();
      return;
    }
    const p = this.map(e);
    this.tx = Math.max(14, Math.min(VW - 14, p.x));
    this.ty = Math.max(40, Math.min(VH - 16, p.y));
  };

  private respawn(): void {
    this.dead = false;
    this.hp = this.stats.maxHp;
    this.enemies = [];
    this.ebullets = [];
    this.pbullets = [];
    this.particles = [];
    this.floaters = [];
    this.score = 0;
    this.elapsed = 0;
    this.survivalTimer = 0;
    this.spawnTimer = 700;
    this.invuln = 800;
    this.px = this.tx = VW / 2;
    this.py = this.ty = VH - 50;
  }

  // ---------- 工具 ----------
  private addShake(n: number): void { if (!settings.get().reduceMotion) this.shake = Math.min(14, this.shake + n); }
  private addFlash(c: string, s = 0.4): void { if (settings.get().reduceMotion) return; this.flashColor = c; this.flash = Math.min(0.8, Math.max(this.flash, s)); }
  private burst(x: number, y: number, n: number, color: string, sp = 0.2): void {
    if (this.particles.length > 150) this.particles.splice(0, 40);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = sp * (0.4 + Math.random());
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 320 + Math.random() * 200, color, size: 2 + (Math.random() < 0.3 ? 1 : 0) });
    }
  }
  private floater(x: number, y: number, text: string, color: string): void {
    if (this.floaters.length > 20) this.floaters.shift();
    this.floaters.push({ x, y, vy: -0.05, life: 700, text, color });
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
    this.render();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    if (this.dead) return;
    const ds = dt / 1000;
    this.elapsed += ds;
    this.survivalTimer += ds;
    if (this.survivalTimer >= 5) {
      this.survivalTimer -= 5;
      this.state.earn(1);
      this.cb.onCoins();
    }
    // 回血
    if (this.stats.regen > 0 && this.hp < this.stats.maxHp) {
      this.regenAcc += this.stats.regen * ds;
      if (this.regenAcc >= 1) {
        const h = Math.floor(this.regenAcc);
        this.hp = Math.min(this.stats.maxHp, this.hp + h);
        this.regenAcc -= h;
      }
    }
    if (this.invuln > 0) this.invuln -= dt;

    // 键盘移动（桌面端方向键/WASD，调整目标位置，复用跟手 lerp）
    const ks = 0.5 * dt;
    if (this.keys.has('arrowleft') || this.keys.has('a')) this.tx -= ks;
    if (this.keys.has('arrowright') || this.keys.has('d')) this.tx += ks;
    if (this.keys.has('arrowup') || this.keys.has('w')) this.ty -= ks;
    if (this.keys.has('arrowdown') || this.keys.has('s')) this.ty += ks;
    this.tx = Math.max(14, Math.min(VW - 14, this.tx));
    this.ty = Math.max(40, Math.min(VH - 16, this.ty));
    // 玩家跟手
    const k = this.stats.moveSpeed;
    this.px += (this.tx - this.px) * k;
    this.py += (this.ty - this.py) * k;

    // 自动开火
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.fireTimer = this.stats.fireInterval;
      audio.sfx('throw');
      const shots = 1 + this.stats.multishot;
      for (let i = 0; i < shots; i++) {
        const spread = shots === 1 ? 0 : (i - (shots - 1) / 2) * 8;
        this.pbullets.push({ x: this.px + spread, y: this.py - 12 });
      }
    }
    // 玩家弹上飞
    for (let i = this.pbullets.length - 1; i >= 0; i--) {
      this.pbullets[i].y -= 0.5 * dt;
      if (this.pbullets[i].y < -10) this.pbullets.splice(i, 1);
    }

    // 刷敌
    this.spawnTimer -= dt;
    const interval = Math.max(360, 1100 - this.elapsed * 12);
    if (this.spawnTimer <= 0) {
      this.spawnEnemy();
      this.spawnTimer = interval;
    }
    // 敌人推进 + 开火
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const en = this.enemies[i];
      en.t += ds;
      en.y += (en.type === 'gunner' ? 36 : 60 + this.elapsed * 1.2) * ds;
      if (en.type === 'drone') en.x += Math.sin(en.t * 3) * 60 * ds;
      if (en.hitFlash > 0) en.hitFlash -= dt;
      if (en.type === 'gunner') {
        en.fireTimer -= dt;
        if (en.fireTimer <= 0 && en.y > 0 && en.y < VH * 0.6) {
          en.fireTimer = 1400;
          const dx = this.px - en.x;
          const dy = this.py - en.y;
          const d = Math.hypot(dx, dy) || 1;
          this.ebullets.push({ x: en.x, y: en.y + 8, vx: (dx / d) * 130, vy: (dy / d) * 130 });
        }
      }
      if (en.y > VH + 24) { this.enemies.splice(i, 1); continue; }
      // 敌体撞玩家
      if (this.invuln <= 0 && Math.abs(en.x - this.px) < 16 && Math.abs(en.y - this.py) < 16) {
        this.damagePlayer();
        this.burst(en.x, en.y, 12, PAL['A']);
        this.enemies.splice(i, 1);
      }
    }
    // 敌弹推进 + 命中玩家
    for (let i = this.ebullets.length - 1; i >= 0; i--) {
      const b = this.ebullets[i];
      b.x += b.vx * ds;
      b.y += b.vy * ds;
      if (b.y > VH + 10 || b.y < -10 || b.x < -10 || b.x > VW + 10) { this.ebullets.splice(i, 1); continue; }
      if (this.invuln <= 0 && Math.abs(b.x - this.px) < 12 && Math.abs(b.y - this.py) < 12) {
        this.damagePlayer();
        this.ebullets.splice(i, 1);
      }
    }
    // 玩家弹命中敌人
    for (let i = this.pbullets.length - 1; i >= 0; i--) {
      const b = this.pbullets[i];
      let consumed = false;
      for (let j = this.enemies.length - 1; j >= 0; j--) {
        const en = this.enemies[j];
        if (Math.abs(b.x - en.x) < en.r && Math.abs(b.y - en.y) < en.r) {
          en.hp -= this.stats.damage;
          en.hitFlash = 70;
          this.burst(b.x, b.y, 3, PAL['e']);
          consumed = true;
          if (en.hp <= 0) this.killEnemy(en, j);
          break;
        }
      }
      if (consumed) this.pbullets.splice(i, 1);
    }
    // 粒子 / 浮字
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.0006 * dt; p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.y += f.vy * dt; f.life -= dt;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }
  }

  private spawnEnemy(): void {
    const r = Math.random();
    let type: Enemy['type'];
    if (this.elapsed > 12 && r < 0.25) type = 'gunner';
    else if (this.elapsed > 5 && r < 0.5) type = 'drone';
    else type = 'grunt';
    const hp = (type === 'gunner' ? 3 : 2) + Math.floor(this.elapsed / 14);
    this.enemies.push({
      x: 30 + Math.random() * (VW - 60),
      y: -20,
      hp, maxHp: hp, type, t: Math.random() * 6, fireTimer: 800 + Math.random() * 800, hitFlash: 0,
      r: type === 'gunner' ? 13 : 11,
    });
  }

  private killEnemy(en: Enemy, j: number): void {
    this.enemies.splice(j, 1);
    this.score++;
    const base = en.type === 'gunner' ? 7 : en.type === 'drone' ? 5 : 4;
    const coin = Math.round((base + Math.floor(this.elapsed / 10)) * (1 + this.stats.coinBonus));
    this.state.earn(coin);
    this.cb.onCoins();
    this.state.incAchv('kills');
    this.floater(en.x, en.y, '+🪙' + coin, '#ffd45e');
    this.burst(en.x, en.y, 12, en.type === 'gunner' ? PAL['p'] : PAL['g']);
    this.addShake(3);
    audio.sfx(en.type === 'gunner' ? 'coinBig' : 'coin');
  }

  private damagePlayer(): void {
    this.hp -= 1;
    this.invuln = 900;
    this.addShake(6);
    this.addFlash('#e84753', 0.45);
    this.burst(this.px, this.py, 14, PAL['A']);
    audio.sfx('lottoMiss');
    audio.haptic(45);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.addShake(10);
      audio.sfx('miss');
      this.state.save();
    }
  }

  // ---------- 渲染 ----------
  private render(): void {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (this.shake > 0.2) ctx.translate(Math.round((Math.random() * 2 - 1) * this.shake), Math.round((Math.random() * 2 - 1) * this.shake));
    this.drawBackground(ctx);
    // 敌弹
    for (const b of this.ebullets) {
      pixelRect(ctx, Math.round(b.x) - 2, Math.round(b.y) - 2, 4, 4, PAL['A']);
    }
    // 敌人
    for (const en of this.enemies) this.drawEnemy(ctx, en);
    // 玩家弹
    for (const b of this.pbullets) pixelRect(ctx, Math.round(b.x) - 1, Math.round(b.y) - 5, 3, 8, PAL['e']);
    // 玩家
    this.drawPlayer(ctx);
    // 粒子
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 400));
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
    // 浮字
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of this.floaters) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life / 700));
      ctx.fillStyle = f.color;
      ctx.font = "9px 'Press Start 2P', monospace";
      ctx.fillText(f.text, Math.round(f.x), Math.round(f.y));
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    this.drawHud(ctx);
    if (this.dead) this.drawGameOver(ctx);
    if (this.flash > 0.01) {
      ctx.globalAlpha = this.flash; ctx.fillStyle = this.flashColor; ctx.fillRect(0, 0, VW, VH); ctx.globalAlpha = 1;
    }
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#0b0a1f'); g.addColorStop(1, '#16133a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
    // 星空下滚（模拟上飞）
    const scroll = (this.time / 8) % VH;
    for (const s of this.stars) {
      let y = (s.y + scroll) % VH;
      ctx.fillStyle = s.s > 1 ? PAL['w'] : PAL['W'];
      ctx.globalAlpha = 0.5;
      ctx.fillRect(Math.round(s.x), Math.round(y), s.s > 1 ? 2 : 1, s.s > 1 ? 2 : 1);
    }
    ctx.globalAlpha = 1;
  }

  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    const blink = this.invuln > 0 && Math.floor(this.time / 80) % 2 === 0;
    if (blink) return; // 无敌帧闪烁：隔帧不画
    const x = Math.round(this.px), y = Math.round(this.py);
    // 引擎尾焰
    ctx.save(); ctx.globalAlpha = 0.6 + 0.3 * Math.sin(this.time / 60);
    pixelRect(ctx, x - 2, y + 8, 4, 5, PAL['e']); ctx.restore();
    // 机身（青色三角块拼）
    pixelRect(ctx, x - 8, y + 2, 16, 5, PAL['b']);
    pixelRect(ctx, x - 4, y - 6, 8, 8, PAL['B']);
    pixelRect(ctx, x - 1, y - 10, 2, 4, PAL['e']); // 鼻锥
    pixelRect(ctx, x - 9, y + 4, 2, 3, PAL['B']); // 翼
    pixelRect(ctx, x + 7, y + 4, 2, 3, PAL['B']);
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, en: Enemy): void {
    const x = Math.round(en.x), y = Math.round(en.y);
    const col = en.type === 'gunner' ? PAL['p'] : en.type === 'drone' ? PAL['o'] : PAL['g'];
    const dark = en.type === 'gunner' ? PAL['P'] : en.type === 'drone' ? PAL['O'] : PAL['G'];
    pixelRect(ctx, x - 8, y - 4, 16, 8, col);
    pixelRect(ctx, x - 4, y - 8, 8, 4, dark);
    pixelRect(ctx, x - 2, y + 4, 4, 3, dark);
    pixelRect(ctx, x - 5, y - 1, 2, 2, PAL['w']); // 眼/窗
    pixelRect(ctx, x + 3, y - 1, 2, 2, PAL['w']);
    if (en.hitFlash > 0) { ctx.save(); ctx.globalAlpha = 0.55; pixelRect(ctx, x - 9, y - 8, 18, 16, '#ffffff'); ctx.restore(); }
    if (en.maxHp > 2) {
      pixelRect(ctx, x - 9, y - 12, 18, 2, PAL['K']);
      pixelRect(ctx, x - 9, y - 12, Math.round(18 * Math.max(0, en.hp) / en.maxHp), 2, PAL['A']);
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    // HP 心（按 maxHp 画小心）
    ctx.font = '12px serif';
    ctx.fillStyle = PAL['A'];
    let hx = 14;
    for (let i = 0; i < this.stats.maxHp; i++) {
      ctx.globalAlpha = i < this.hp ? 1 : 0.25;
      ctx.fillText('❤', hx, 12);
      hx += 16;
    }
    ctx.globalAlpha = 1;
    // 分数 / 时间（右上）
    ctx.textAlign = 'right';
    ctx.fillStyle = PAL['y'];
    ctx.font = "9px 'Press Start 2P', monospace";
    ctx.fillText(`SCORE ${this.score}`, VW - 14, 14);
    ctx.fillStyle = PAL['e'];
    ctx.fillText(`${Math.floor(this.elapsed)}s`, VW - 14, 28);
    // 提示
    if (this.score === 0 && this.elapsed < 3) {
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.time / 300);
      ctx.fillStyle = PAL['w'];
      ctx.font = "8px 'Press Start 2P', monospace";
      ctx.fillText('拖动走位 · 自动开火', VW / 2, VH / 2);
      ctx.globalAlpha = 1;
    }
  }

  private drawGameOver(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = 'rgba(5,4,15,0.72)'; ctx.fillRect(0, 0, VW, VH);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = PAL['A']; ctx.font = "18px 'Press Start 2P', monospace";
    ctx.fillText('GAME OVER', VW / 2, VH / 2 - 18);
    ctx.fillStyle = PAL['w']; ctx.font = "9px 'Press Start 2P', monospace";
    ctx.fillText(`SCORE ${this.score}  ·  ${Math.floor(this.elapsed)}s`, VW / 2, VH / 2 + 8);
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.time / 300);
    ctx.fillStyle = PAL['e'];
    ctx.fillText('TAP TO RESTART · 点屏重来', VW / 2, VH / 2 + 34);
    ctx.restore();
  }
}
