import type { Dart, DropItem, FloatingItem, FloatText, Vec2 } from '../shared/types';
import { GameState } from '../shared/state';
import {
  VH,
  GROUND_Y,
  BOARD_CENTER,
  CHAR_FEET_X,
  CHAR_FEET_Y,
  CHAR_HAND,
  PET_FEET_Y,
  petFeetX,
  applyLayout,
  pixelRect,
  pixelLine,
  pixelCircle,
  pixelCircleRing,
  type SceneEnv,
} from './render/contract';
import {
  drawBackgroundStatic,
  drawBackgroundAnimated,
  relayoutBackground,
} from './render/background';
import { drawBoard } from './render/board';
import { drawCharacter, drawPet } from './render/character';
import { drawAim, drawDart, drawFloatingItem, drawFloats, drawHint, drawLightning, drawLottoDrop, drawRobot } from './render/fx';
import { juice } from './render/juice';
import { audio } from '../shared/audio';

import { robotSettle, showScratchOverlay } from '../story/scratch';

// ===== 主游戏：循环 / 投掷物理 / 计分 / 宠物（渲染委托给 render/* 模块）=====

const AIM_SPEED = 210; // 准星移动速度（虚拟像素/秒）
const ARC = 32; // 飞镖抛物线高度
const PLAYER_SPREAD = 3; // 玩家投掷基础散布（Y）
const PET_BASE_SPREAD = 36; // 宠物基础散布（Y）
const DIR_RANGE = 60; // 出手方向最大偏移（虚拟像素，r4=74 留 14 边距）
const DIR_PERIOD = 1.9; // 方向全振荡周期（秒）
const DIR_OMEGA = (Math.PI * 2) / DIR_PERIOD;
const PLAYER_SPREAD_X = 3; // 玩家方向随机散布（X）
const PET_X_SPREAD = 36; // 宠物方向随机散布（X，与 PET_BASE_SPREAD 构成圆形分布）
const DOUBLE_SHOT_X_JITTER = 20; // 双发第二支相对第一支的 X 抖动
const WIND_STRENGTH = 16; // 风向基础偏移（虚拟像素，wind=±1 时）

interface Callbacks {
  onCoins: (n: number) => void;
  onScore: (n: number) => void;
  onCombo: (combo: number, multiplier: number) => void;
  /** 新手引导里程碑（首次进入 / 首次中心命中 / 首次有风时投掷）。
   *  每会话仅各自触发一次；是否真正弹 toast 由 UI 层按持久化状态决定。 */
  onOnboard?: (kind: 'entry' | 'bull' | 'wind' | 'lottoDrop') => void;
  /** 掉落彩票点击后触发剧情对话 */
  onStoryTrigger?: (chapter?: number) => void;
}

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: GameState;
  private cb: Callbacks;

  private rafId = 0;
  private last = 0;
  private running = false;

  // 投掷状态
  private aimY = BOARD_CENTER.y;
  private aimPhase = 0; // 正弦准星相位（慢入慢出，替代三角硬反弹）
  private aimDir = 0; // 出手方向 -1..1（左右摆动，玩家锁定用）
  private dirPhase = 0; // 方向正弦相位
  private cooldownLeft = 0;
  private throwAnimLeft = 0;
  private petTimers: number[] = [];

  // 连击与风（运行时；maxCombo 在 state 中持久化）
  private combo = 0;
  private wind = 0; // -1..1，随时间漂移

  // 新手引导（运行时单会话标记；持久化由 UI 层负责）
  private throws = 0; // 玩家投掷次数：用于退役 TAP 提示
  private obEntry = false;
  private obBull = false;
  private obWind = false;
  private obScore1000 = false;
  private obTicketChapter = false;
  private ticketsScratched = 0;
  private ticketDropEnabled = false; // 首次剧情票点击后才开始掉落

  // 实体
  private darts: Dart[] = [];
  private floats: FloatText[] = [];
  private floatingItems: FloatingItem[] = [];
  private dropItems: DropItem[] = [];
  private lightningBolts: { x1: number; y1: number; x2: number; y2: number; life: number }[] = [];
  private robots: { pos: Vec2; targetX: number; ticket: DropItem; phase: 'out' | 'back' }[] = [];
  private readonly ROBOT_SPEED = 80;
  private fairyTimer = 6000;

  // 时间
  private time = 0;

  // 离屏缓存：静态背景 + 飞镖盘，每帧只贴图，大幅减少 fillRect 次数。
  // 背景层含动态星/月/云，仍每帧画；山/地/草/花/剪影等静态部分才进缓存。
  private bgCanvas!: HTMLCanvasElement;
  private bgCtx!: CanvasRenderingContext2D;
  private boardCanvas!: HTMLCanvasElement;
  private boardCtx!: CanvasRenderingContext2D;
  private bgDirty = true;
  private boardDirty = true;
  private ro: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement, state: GameState, cb: Callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.state = state;
    this.cb = cb;

    this.bgCanvas = document.createElement('canvas');
    this.bgCtx = this.bgCanvas.getContext('2d')!;
    this.boardCanvas = document.createElement('canvas');
    this.boardCtx = this.boardCanvas.getContext('2d')!;

    this.resize(); // 初次按舞台尺寸定 VW / 画布像素

    this.syncPets();
    canvas.addEventListener('pointerdown', this.onPointerDown);

    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(this.resize);
      this.ro.observe(canvas);
    }
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
  }

  destroy(): void {
    this.stop();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.ro?.disconnect();
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('orientationchange', this.resize);
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
  }

  /** 技能树变动后重新同步宠物数量与计时器，并刷新飞镖盘缓存 */
  syncAfterBuy(): void {
    this.syncPets();
    this.boardDirty = true; // 半径可能变化，需重绘盘缓存
  }

  /** 按舞台实际宽高比重算虚拟宽，使画布恰好铺满（无黑边、无变形）。
   *  VH 固定 360；VW = clamp(round(VH * aspect))，画布比例始终等于舞台比例。 */
  private resize = (): void => {
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    if (!cssW || !cssH) return;
    const aspect = cssW / cssH;
    const vw = Math.max(480, Math.min(1300, Math.round(VH * aspect)));
    applyLayout(vw); // 更新 contract 的 VW 与盘心 x（live binding，各渲染模块可见）
    relayoutBackground(); // 按新 VW 重建星 / 山 / 草 / 花
    this.canvas.width = vw;
    this.canvas.height = VH;
    this.ctx.imageSmoothingEnabled = false;
    this.bgCanvas.width = vw;
    this.bgCanvas.height = VH;
    this.boardCanvas.width = vw;
    this.boardCanvas.height = VH;
    this.bgDirty = true;
    this.boardDirty = true;
  };

  private syncPets(): void {
    const stats = this.state.stats();
    const need = stats.petUnlocked ? stats.petCount : 0;
    while (this.petTimers.length < need) {
      this.petTimers.push(stats.petInterval * (0.4 + 0.2 * this.petTimers.length));
    }
    while (this.petTimers.length > need) this.petTimers.pop();
  }

  // ---------- 输入 ----------
  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    // 刮刮乐弹窗打开时不处理投掷
    if (document.getElementById('scratchOverlay')) return;
    // 屏幕坐标 → 画布坐标。竖屏播放时 .game-root 会 rotate(90deg)，此时
    // getBoundingClientRect 返回旋转后的轴对齐盒，必须换轴映射，否则点地上的彩票
    // 会落点错位、点不动（投掷靠自动准星不受影响，所以只有彩票点不响）。与 shooter / lottery 一致。
    const rect = this.canvas.getBoundingClientRect();
    const rotated = !!document.getElementById('gameRoot')?.classList.contains('rotated');
    let cx: number;
    let cy: number;
    if (rotated) {
      cx = (e.clientY - rect.top) * (this.canvas.width / rect.height);
      cy = (rect.left + rect.width - e.clientX) * (this.canvas.height / rect.width);
    } else {
      cx = (e.clientX - rect.left) * (this.canvas.width / rect.width);
      cy = (e.clientY - rect.top) * (this.canvas.height / rect.height);
    }
    const s = this.state.stats();
    for (let i = this.dropItems.length - 1; i >= 0; i--) {
      const d = this.dropItems[i];
      if (d.landed && Math.hypot(cx - d.pos.x, cy - d.pos.y) < 30) {
        const wasStory = d.isStoryDrop;
        this.dropItems.splice(i, 1);
        this.robots = this.robots.filter((r) => r.ticket !== d);
        if (wasStory) {
          this.ticketDropEnabled = true; // 剧情后解锁彩票掉落
          this.cb.onStoryTrigger?.(1);
        } else {
          this.ticketsScratched++;
          if (d.angel || d.demon) {
            const isAngel = !!d.angel;
            showScratchOverlay(
              (n) => { this.state.earn(n); this.cb.onCoins(this.state.coins); },
              () => { this.cb.onStoryTrigger?.(isAngel ? 3 : 4); },
              { angel: d.angel, demon: d.demon, valueMul: s.ticketValue, autoClose: true },
            );
          } else {
            const tierLuck = (d.tier ?? 0) === 0 ? s.ticketLuck : (d.tier ?? 0) === 1 ? s.silverLuck : (d.tier ?? 0) === 2 ? s.goldLuck : s.diamondLuck;
            showScratchOverlay(
              (n) => { this.state.earn(n); this.cb.onCoins(this.state.coins); },
              undefined,
              { luck: tierLuck, valueMul: s.ticketValue, tier: d.tier ?? 0 },
            );
          }
          // 累计 10 张 → 第三段剧情
          if (this.ticketsScratched >= 10 && !this.obTicketChapter) {
            this.obTicketChapter = true;
            this.cb.onStoryTrigger?.(2);
          }
        }
        return;
      }
    }
    this.tryThrow(false);
  };

  /** 尝试投掷（玩家或宠物）。成功返回 true */
  tryThrow(fromPet: boolean, petIndex = 0): boolean {
    const stats = this.state.stats();
    if (!fromPet) {
      if (this.cooldownLeft > 0) return false;
      this.cooldownLeft = stats.cooldown;
      this.throwAnimLeft = 220;
      audio.sfx('throw');
      this.throws++;
      // 首次在有风时投掷 → 提示风向机制
      if (!this.obWind && Math.abs(this.wind) > 0.15) {
        this.obWind = true;
        this.cb.onOnboard?.('wind');
      }
    } else {
      audio.sfx('pet'); // 宠物投镖音（与玩家出手音区分）
    }

    // 计算落点（2D）：方向影响 X、aimY/风影响 Y；磁吸在 X/Y 同系数拉向圆心，风在磁吸后叠加。
    const dirOffset = fromPet
      ? (Math.random() * 2 - 1) * PET_X_SPREAD * (1 - stats.petAccuracy)
      : this.aimDir * DIR_RANGE;

    let ty = this.aimY;
    if (fromPet) {
      ty = BOARD_CENTER.y + (Math.random() * 2 - 1) * PET_BASE_SPREAD * (1 - stats.petAccuracy);
    } else {
      ty += (Math.random() * 2 - 1) * PLAYER_SPREAD;
    }
    // Y 磁吸（拉向圆心），再叠加风（风不被磁吸削弱，仅 windResist 抗）
    ty = BOARD_CENTER.y + (ty - BOARD_CENTER.y) * (1 - stats.magnet) + this.windOffset();

    // X：方向 + 小散布 + 磁吸（玩家）；宠物不磁吸
    let tx = BOARD_CENTER.x + dirOffset;
    if (!fromPet) {
      tx += (Math.random() * 2 - 1) * PLAYER_SPREAD_X;
      tx = BOARD_CENTER.x + (tx - BOARD_CENTER.x) * (1 - stats.magnet);
    }

    this.spawnDart(tx, ty, fromPet, petIndex);

    // 双发：第二支相对第一支抖动
    if (!fromPet && Math.random() < stats.doubleShotChance) {
      const tx2 = tx + (Math.random() * 2 - 1) * DOUBLE_SHOT_X_JITTER;
      const ty2 = ty + (Math.random() * 2 - 1) * 12;
      this.spawnDart(tx2, ty2, false, petIndex, 0.06);
    }
    // 连投：概率触发第三支飞镖（延迟稍久，独立于双发）
    if (!fromPet && Math.random() < stats.chainThrow) {
      const tx3 = tx + (Math.random() * 2 - 1) * 25;
      const ty3 = ty + (Math.random() * 2 - 1) * 8;
      this.spawnDart(tx3, ty3, false, petIndex, 0.12);
    }
    return true;
  }

  private spawnDart(
    targetX: number,
    targetY: number,
    fromPet: boolean,
    petIndex: number,
    delay = 0,
  ): void {
    const stats = this.state.stats();
    const start = fromPet ? this.petHand(petIndex) : CHAR_HAND;
    const dist = Math.abs(targetX - start.x);
    const duration = (dist / stats.dartSpeed) * 1000 + delay * 1000;
    const isGolden = !fromPet && Math.random() < stats.goldenDart;
    this.darts.push({
      pos: { ...start },
      sx: start.x,
      target: { x: targetX, y: targetY },
      startY: start.y,
      progress: -delay, // 负值表示延迟起飞
      speed: Math.max(160, duration),
      fromPet,
      hit: false,
      golden: isGolden,
    });
  }

  private petHand(index: number): Vec2 {
    return { x: petFeetX(index) + 6, y: PET_FEET_Y - 10 };
  }

  /** 当前连击倍率（受 comboCap 限制） */
  private comboMult(): number {
    const cap = this.state.stats().comboCap;
    return Math.min(cap, 1 + this.combo * 0.1);
  }

  /** 当前风对落点 Y 的偏移（虚拟像素，正=向下）；随进度略增强 */
  private windOffset(): number {
    const s = this.state.stats();
    const prog = Math.min(24, this.state.totalEarned / 250);
    return this.wind * (WIND_STRENGTH + prog) * (1 - s.windResist);
  }

  // ---------- 主循环 ----------
  private loop = (now: number): void => {
    if (!this.running) return;
    let dt = now - this.last;
    this.last = now;
    if (dt > 60) dt = 60; // 防止切后台后大跳
    this.time += dt;
    this.update(dt);
    this.render();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    const dts = dt / 1000;
    const stats = this.state.stats();

    // 准星振荡（随累计进度略提速，后期更吃操作）。
    // 用正弦相位积分 → 慢入慢出（两端自然减速），比三角硬反弹更易读、手感更柔；
    // 角速度 ω 由原线速度换算（三角周期 4R/v → 正弦 ω = π·v/(2R)），保持节奏相当，
    // 且随难度提速时相位连续累加，不会有跳变。
    const range = stats.r4 + 12;
    const aimSpeed = AIM_SPEED * (1 + Math.min(0.4, this.state.totalEarned / 6000));
    const omega = (Math.PI * aimSpeed) / (2 * range);
    this.aimPhase += omega * dts;
    this.aimY = BOARD_CENTER.y + Math.sin(this.aimPhase) * range;

    // 出手方向：独立正弦振荡，不振荡提速（保持稳定节拍，与 aimY 渐快形成双层节奏）。
    // 周期 1.9s 与 aimY(~1.64s) 比值不可约 → 落点轨迹为缓慢进动的 Lissajous，不可背板。
    this.dirPhase += DIR_OMEGA * dts;
    this.aimDir = Math.sin(this.dirPhase);

    // 风向：两个不同频率正弦叠加，平滑可读但节奏难背
    this.wind = Math.max(
      -1,
      Math.min(1, Math.sin(this.time * 0.0006) * 0.65 + Math.sin(this.time * 0.00021 + 1.7) * 0.4),
    );

    // 首次进入：开局约 0.7s 后、且玩家尚未投掷时，提示基本玩法
    if (!this.obEntry && this.time > 700 && this.throws === 0) {
      this.obEntry = true;
      this.cb.onOnboard?.('entry');
    }

    if (this.cooldownLeft > 0) this.cooldownLeft -= dt;
    if (this.throwAnimLeft > 0) this.throwAnimLeft -= dt;

    // 宠物自动投掷
    for (let i = 0; i < this.petTimers.length; i++) {
      this.petTimers[i] -= dt;
      if (this.petTimers[i] <= 0) {
        this.tryThrow(true, i);
        this.petTimers[i] = stats.petInterval;
      }
    }

    // 飞镖推进
    for (const d of this.darts) {
      d.progress += dt / d.speed;
      if (d.progress < 0) continue;
      const t = Math.min(1, d.progress);
      d.pos.x = this.lerp(d.sx, d.target.x, t);
      const baseY = this.lerp(d.startY, d.target.y, t);
      d.pos.y = baseY - ARC * 4 * t * (1 - t);
      // 闪电命中：飞行到半程时概率触发，修正飞镖自动靶心
      if (!d.fromPet && !d.zapped && t >= 0.4 && t <= 0.55 && Math.random() < stats.lightningStrike) {
        d.zapped = true;
        d.target = { x: BOARD_CENTER.x, y: BOARD_CENTER.y };
        const sx = d.sx + (d.target.x - d.sx) * t;
        const sy = d.startY + (d.target.y - d.startY) * t - ARC * 4 * t * (1 - t);
        this.lightningBolts.push({ x1: BOARD_CENTER.x + (Math.random()*2-1)*40, y1: 0, x2: BOARD_CENTER.x, y2: BOARD_CENTER.y, life: 300 });
        juice.shake(3); // 闪电命中的震屏减弱，避免频繁触发时太晃
        juice.burst(d.target.x, d.target.y, '#7df9ff', 15);
      }
      if (t >= 1 && !d.hit) {
        d.hit = true;
        // 检查是否击中漂浮飞行物
        for (const f of this.floatingItems) {
          if (Math.hypot(d.target.x - f.pos.x, d.target.y - f.pos.y) < 6 + f.r) {
            this.floatingItems = this.floatingItems.filter((x) => x !== f);
            if (f.kind === 'demon') {
              // 恶魔：爆出随机票
              const s2 = this.state.stats();
              const shards = 1 + Math.floor(Math.random() * (5 + s2.demonShards));
              for (let k = 0; k < shards; k++) {
                let t = 0;
                if (Math.random() < s2.demonUpgrade) t = Math.min(2, t + 1 + Math.floor(Math.random() * 2));
                else if (s2.silverUnlock > 0 && Math.random() < 0.3) t = 1;
                else if (s2.goldUnlock > 0 && Math.random() < 0.1) t = 2;
                this.spawnLottoDrop(false, t);
              }
              juice.burst(f.pos.x, f.pos.y, '#ea4754', 16);
              juice.shake(4);
              this.floats.push({ pos: { ...f.pos }, text: `👹+${shards}`, color: '#ea4754', life: 1000, vy: -30 });
            } else {
              const reward = f.kind === 'fairy' ? 80 : 30 + Math.floor(Math.random() * 71);
              this.state.earn(reward);
              juice.burst(f.pos.x, f.pos.y, f.kind === 'fairy' ? '#c061e0' : '#ffd45e', 10);
              this.floats.push({ pos: { ...f.pos }, text: `+${reward}`, color: '#ffd45e', life: 800, vy: -28 });
            }
            break;
          }
        }
        this.resolveHit(d);
      }
    }
    // 命中后让飞镖在靶上多停留一小段（progress 1→~1.4），呈现"扎入钉住"的观感；
    // resolveHit 由 !d.hit 守护，不会因延时移除而重复计分。
    this.darts = this.darts.filter((d) => d.progress < 1.4);

    // 飘字
    for (const f of this.floats) {
      f.life -= dt;
      f.pos.y += f.vy * dts;
    }
    this.floats = this.floats.filter((f) => f.life > 0);

    // 掉落物品更新（下落 → 触地 → 机器人自动刮或等待点击）
    const s2 = this.state.stats();
    for (const d of this.dropItems) {
      d.life -= dt;
      if (!d.landed) {
        d.pos.y += d.vy * dts;
        if (d.pos.y >= GROUND_Y) {
          d.pos.y = GROUND_Y;
          d.landed = true;
          d.life = Infinity;
          juice.burst(d.pos.x, d.pos.y, '#ffd45e', 8);
          // 机器人自动拾取（非剧情票 + 有机器人技能 + 机器人空闲）
          const maxRobots = (s2.robotCount || 0) + 1;
          if (!d.isStoryDrop && !d.angel && !d.demon && s2.ticketRobot > 0 && this.robots.length < maxRobots) {
            this.robots.push({ pos: { x: CHAR_FEET_X + 30 + this.robots.length * 16, y: GROUND_Y - 16 }, targetX: d.pos.x - 20, ticket: d, phase: 'out' });
          }
        }
      }
    }
    // 机器人移动
    for (const r of this.robots) {
      const speed = this.ROBOT_SPEED * (1 + s2.ticketRobotSpeed + s2.robotSpeed);
      const dx = r.targetX - r.pos.x;
      const step = speed * dts;
      if (Math.abs(dx) < step + 2) {
        r.pos.x = r.targetX;
        if (r.phase === 'out') {
          const rt = r.ticket.tier ?? 0;
        const rluck = rt === 0 ? s2.ticketLuck : rt === 1 ? s2.silverLuck : rt === 2 ? s2.goldLuck : s2.diamondLuck;
        const prize = robotSettle({ luck: rluck + s2.ticketRobotLuck, valueMul: s2.ticketValue, jackpot: s2.ticketJackpot, tier: Math.min(s2.robotTier, rt) });
          this.state.earn(prize);
          this.cb.onCoins(this.state.coins);
          this.floats.push({ pos: { ...r.ticket.pos }, text: `🤖+${prize}`, color: '#7df9ff', life: 900, vy: -28 });
          this.ticketsScratched++;
          if (this.ticketsScratched >= 10 && !this.obTicketChapter) { this.obTicketChapter = true; this.cb.onStoryTrigger?.(2); }
          this.dropItems = this.dropItems.filter((x) => x !== r.ticket);
          r.phase = 'back';
          r.targetX = CHAR_FEET_X + 30;
        }
      } else {
        r.pos.x += Math.sign(dx) * step;
      }
    }
    this.robots = this.robots.filter((r) => r.phase !== 'back' || Math.abs(r.pos.x - r.targetX) > 2);

    // 漂浮飞行物更新：精灵生成 + 运动 + 寿命
    const fs = this.state.stats();
    if (fs.fairySpawn > 0) {
      this.fairyTimer -= dt;
      if (this.fairyTimer <= 0) {
        this.fairyTimer = 6000;
        const existingFairies = this.floatingItems.filter((x) => x.kind === 'fairy').length;
        if (existingFairies < fs.fairySpawn) {
          const angle = Math.random() * Math.PI * 2;
          const dist = fs.r2 + Math.random() * (fs.r4 - fs.r2); // 在盘面上飞行
          this.floatingItems.push({
            pos: { x: BOARD_CENTER.x + Math.cos(angle) * dist, y: BOARD_CENTER.y + Math.sin(angle) * dist },
            vx: -Math.sin(angle) * 30, vy: Math.cos(angle) * 30,
            life: 12000, kind: 'fairy', r: 12,
          });
        }
      }
    }
    for (const f of this.floatingItems) {
      f.life -= dt;
      f.pos.x += f.vx * dt / 1000;
      f.pos.y += f.vy * dt / 1000;
      // 恶魔/精灵：轻微晃动
      if (f.kind === 'demon') {
        const wobble = Math.sin((this.time / 300) * Math.PI * 2) * 3;
        f.pos.x += wobble * dt / 1000 * 2;
      }
      // 轨道修正（保持在盘面内部）
      const dx = f.pos.x - BOARD_CENTER.x;
      const dy = f.pos.y - BOARD_CENTER.y;
      const dist = Math.hypot(dx, dy);
      const targetR = (fs.r2 + fs.r4) / 2;
      if (dist > 0.1) {
        const pull = (dist - targetR) * 0.3;
        f.vx -= (dx / dist) * pull * dt / 1000;
        f.vy -= (dy / dist) * pull * dt / 1000;
      }
    }
    this.floatingItems = this.floatingItems.filter((f) => f.life > 0);

    // 闪电衰减
    for (const b of this.lightningBolts) b.life -= dt;
    this.lightningBolts = this.lightningBolts.filter((b) => b.life > 0);

    juice.update(dt);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private spawnLottoDrop(isStory = false, forceTier = -1): void {
    // 根据解锁状态决定彩票等级
    let tier = 0; // 默认铜
    if (forceTier >= 0) {
      tier = forceTier;
    } else {
      const s = this.state.stats();
      if (s.diamondUnlock > 0 && Math.random() < 0.08) tier = 3;     // 钻石8%
      else if (s.goldUnlock > 0 && Math.random() < 0.15) tier = 2;
      else if (s.silverUnlock > 0 && Math.random() < 0.30) tier = 1;
    }
    // 恶魔票：极低概率，直接烧毁召魔
    if (!isStory && this.ticketDropEnabled && Math.random() < this.state.stats().demonDrop) {
      this.spawnDemon();
      return;
    }
    // 天使/恶魔终极大奖：5% 掉落
    const s3 = this.state.stats();
    if (!isStory && this.ticketDropEnabled && s3.angelUnlock > 0 && Math.random() < 0.05) {
      const isAngel = Math.random() < 0.5;
      this.dropItems.push({
        pos: { x: BOARD_CENTER.x + (Math.random() * 2 - 1) * 30, y: BOARD_CENTER.y - 40 },
        life: 9999, vy: 140, landed: false,
        isStoryDrop: false, tier: -1,
        angel: isAngel, demon: !isAngel,
      } as DropItem);
      return;
    }
    this.dropItems.push({
      pos: { x: BOARD_CENTER.x + (Math.random() * 2 - 1) * 30, y: BOARD_CENTER.y - 40 },
      life: 9999,
      vy: 140,
      landed: false,
      isStoryDrop: isStory,
      tier,
    });
  }

  private spawnDemon(): void {
    const stats = this.state.stats();
    const maxDemons = stats.demonCount + 1;
    const existing = this.floatingItems.filter((f) => f.kind === 'demon').length;
    if (existing >= maxDemons) return;
    const angle = Math.random() * Math.PI * 2;
    const dist = stats.r2 + Math.random() * (stats.r4 - stats.r2); // 恶魔在盘面飞行
    this.floatingItems.push({
      pos: { x: BOARD_CENTER.x + Math.cos(angle) * dist, y: BOARD_CENTER.y + Math.sin(angle) * dist },
      vx: -Math.sin(angle) * 45, vy: Math.cos(angle) * 45,
      life: 8000, kind: 'demon', r: 14,
    });
    // 火焰燃烧特效
    juice.burst(BOARD_CENTER.x, BOARD_CENTER.y - 20, '#ea4754', 20);
    juice.burst(BOARD_CENTER.x, BOARD_CENTER.y - 20, '#ff6b35', 12);
    juice.burst(BOARD_CENTER.x, BOARD_CENTER.y - 20, '#15131f', 8);
    juice.shake(6);
    this.floats.push({ pos: { x: BOARD_CENTER.x, y: BOARD_CENTER.y - 30 }, text: '👹 恶魔降临!', color: '#ea4754', life: 1000, vy: -24 });
  }

  private resolveHit(d: Dart): void {
    const stats = this.state.stats();
    const dist = Math.hypot(d.target.x - BOARD_CENTER.x, d.target.y - BOARD_CENTER.y);
    let { points, label, color, bull } = this.scoreFor(dist, stats);
    // 暴击：概率得分×2
    if (!d.fromPet && Math.random() < stats.critChance) { points *= 2; label = '暴击!'; color = '#ffd45e'; }
    // 黄金飞镖：金币×3；金币双倍概率触发再×2
    let coinMult = (d.golden ? 3 : 1);
    if (!d.fromPet && Math.random() < stats.coinDoubler) coinMult *= 2;

    let mult = 1;
    // 宠物命中奖励按 petReward 缩放（默认 10%）；玩家为全额。
    const petMul = d.fromPet ? stats.petReward : 1;
    if (points > 0) {
      // 金币只拿基础分（控制经济）；分数享受连击倍率（冲高分）。
      // 连击仅由玩家投掷累积，宠物不参与（避免无脑叠连击）。
      this.state.earn(Math.round(points * petMul * coinMult) + (d.fromPet ? 0 : stats.coinBonus));
      if (!d.fromPet) {
        this.combo += bull ? 2 : 1;
        mult = this.comboMult();
        this.state.recordCombo(this.combo);
        this.cb.onCombo(this.combo, mult);
      }
      this.state.addScore(Math.round(points * mult * petMul));
      this.cb.onCoins(this.state.coins);
      this.cb.onScore(this.state.score);
      // 剧情：积分首次达到 1000 触发掉落彩票
      if (this.state.score >= 1000 && !this.obScore1000) {
        this.obScore1000 = true;
        this.cb.onOnboard?.('lottoDrop');
        this.spawnLottoDrop(true);
      }
      // 彩票掉落（基础 1% + 技能加成）
      if (this.ticketDropEnabled && Math.random() < 0.01 + stats.ticketDropRate) {
        this.spawnLottoDrop(false);
        // 双倍掉落
        if (Math.random() < stats.ticketDoubleDrop) {
          this.spawnLottoDrop(false);
        }
      }
      // 幸运掉落：概率生成金币袋飞行物
      if (!d.fromPet && Math.random() < stats.luckyDrop) {
        this.floatingItems.push({
          pos: { x: d.target.x + (Math.random() * 2 - 1) * 40, y: d.target.y - 30 },
          vx: 0, vy: 0,
          life: 5000, kind: 'coinBag', r: 8,
        });
      }
    } else if (!d.fromPet) {
      // 失误：连击按护盾衰减（无护盾则清零）
      const before = this.combo;
      this.combo = Math.floor(this.combo * stats.comboShield);
      if (this.combo !== before) this.cb.onCombo(this.combo, this.comboMult());
    }

    // 手感反馈：音效 + 屏幕震动 + 命中粒子 + 冲击波（宠物稍弱）
    if (points > 0) {
      if (bull) {
        if (!d.fromPet) juice.shake(4); // 玩家命中中心才震屏（幅值已调小，避免太晃）；宠物不震
        juice.burst(d.target.x, d.target.y, color, d.fromPet ? 10 : 20);
        juice.impact(d.target.x, d.target.y, color, true); // 中心命中：更大的冲击波环（白闪已移除）
        audio.sfx('bull');
        if (!d.fromPet && !this.obBull) {
          this.obBull = true;
          this.cb.onOnboard?.('bull'); // 首次中心命中：提示连击机制
        }
      } else {
        juice.burst(d.target.x, d.target.y, color, d.fromPet ? 5 : 9);
        juice.impact(d.target.x, d.target.y, color, false);
        audio.sfx('hit');
      }
      // 玩家每 5 连击触发升调combo音
      if (!d.fromPet && this.combo > 0 && this.combo % 5 === 0) {
        audio.sfx('combo', { semi: Math.min(12, this.combo) });
      }
    } else if (!d.fromPet) {
      // 失误：轻微震屏 + 红色 MISS，让"没中"也有明确反馈
      juice.shake(3);
      audio.sfx('miss');
    }

    // 飘字显示实际获得：宠物按缩放后的奖励，避免“飘 +50 却只给 5”的误导
    const gain = points > 0 ? Math.round(points * mult * petMul) : 0;
    this.floats.push({
      pos: { x: d.target.x, y: d.target.y - 10 },
      text: points > 0 ? `+${gain}` : 'MISS',
      color: points > 0 ? color : '#e84753',
      life: 900,
      vy: -28,
    });
    if (label) {
      this.floats.push({
        pos: { x: d.target.x, y: d.target.y - 26 },
        text: label,
        color,
        life: 900,
        vy: -20,
      });
    }
    if (mult > 1.05) {
      this.floats.push({
        pos: { x: d.target.x, y: d.target.y - 40 },
        text: `x${mult.toFixed(1)} 🔥`,
        color: '#ff8c42',
        life: 900,
        vy: -20,
      });
    }
    this.state.save();
  }

  private scoreFor(
    dist: number,
    s: ReturnType<GameState['stats']>,
  ): { points: number; label: string; color: string; bull: boolean } {
    const m = s.ringMultiplier;
    if (dist <= s.centerRadius)
      return { points: Math.round(50 * m), label: '中心!', color: '#ffd45e', bull: true };
    if (dist <= s.r2)
      return { points: Math.round(25 * m), label: '', color: '#ffffff', bull: false };
    if (dist <= s.r3)
      return { points: 10, label: '', color: '#9ad', bull: false };
    if (dist <= s.r4)
      return { points: 5, label: '', color: '#bbb', bull: false };
    return { points: 0, label: '', color: '#888', bull: false };
  }

  // ---------- 渲染（委托给 render/* 模块；静态层走离屏缓存）----------
  private render(): void {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    const env: SceneEnv = { ctx, time: this.time, stats: this.state.stats() };

    // 屏幕震动：命中中心时整屏微抖
    const so = juice.shakeOffset();
    ctx.save();
    ctx.translate(so.x, so.y);

    // 1) 静态背景缓存：天空 / 山 / 地面 / 草 / 花 / 剪影（仅在 VW 变化时重绘）
    if (this.bgDirty) {
      this.bgCtx.imageSmoothingEnabled = false;
      drawBackgroundStatic({ ctx: this.bgCtx, time: 0, stats: env.stats });
      this.bgDirty = false;
    }
    ctx.drawImage(this.bgCanvas, 0, 0);

    // 2) 动态背景层：星闪烁 / 月呼吸 / 云漂移（每帧实时）
    drawBackgroundAnimated(env);

    // 3) 飞镖盘缓存：仅在技能半径变化或 VW 变化时重绘
    if (this.boardDirty) {
      this.boardCtx.imageSmoothingEnabled = false;
      drawBoard({ ctx: this.boardCtx, time: 0, stats: env.stats });
      this.boardDirty = false;
    }
    ctx.drawImage(this.boardCanvas, 0, 0);

    // 4) 前景动态实体
    drawAim(
      env,
      BOARD_CENTER.x + this.aimDir * DIR_RANGE,
      this.aimY + this.windOffset(),
      this.throwAnimLeft > 0,
    );
    this.drawWindUI(env.ctx);
    drawCharacter(
      env,
      CHAR_FEET_X,
      CHAR_FEET_Y,
      this.throwAnimLeft > 0 ? 'throw' : 'idle',
      false,
    );
    const petCount = this.petTimers.length;
    for (let i = 0; i < petCount; i++) {
      drawPet(env, petFeetX(i), PET_FEET_Y, this.time + i * 900);
    }
    for (const d of this.darts) drawDart(env, d);
    drawFloats(env, this.floats);
    if (this.dropItems.length) for (const d of this.dropItems) drawLottoDrop(env, d);
    for (const f of this.floatingItems) drawFloatingItem(env, f);
    for (const b of this.lightningBolts) drawLightning(env, b);
    for (const r of this.robots) drawRobot(env, r.pos, this.time);
    // TAP 提示只在前几次投掷显示，之后退役（避免长期闪烁成为视觉噪音）
    drawHint(env, this.cooldownLeft <= 0 && this.throws < 3);

    ctx.restore();
    juice.draw(ctx);
  }

  /** 风向条 + 受风后的预测落点标记（让风向成为可预判的技巧要素） */
  private drawWindUI(ctx: CanvasRenderingContext2D): void {
    // 顶部左侧：风向条
    const gx = 10;
    const gy = 10;
    const gw = 66;
    const gh = 5;
    pixelRect(ctx, gx - 1, gy - 1, gw + 2, gh + 2, '#0b0a1f');
    pixelRect(ctx, gx, gy, gw, gh, '#1c1838');
    pixelRect(ctx, gx, gy, gw, 1, '#2a2150');
    const cx = gx + (gw >> 1);
    pixelRect(ctx, cx, gy - 1, 1, gh + 2, '#5a617f');
    const off = Math.round((this.wind * gw) / 2);
    const col = this.wind >= 0 ? '#7df9ff' : '#ffd45e';
    if (off > 0) pixelRect(ctx, cx, gy + 1, off, gh - 2, col);
    else if (off < 0) pixelRect(ctx, cx + off, gy + 1, -off, gh - 2, col);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = '7px "Press Start 2P", monospace';
    ctx.fillStyle = '#0b0a1f';
    ctx.fillText('WIND 风', gx + 1, gy - 1);
    ctx.fillStyle = col;
    ctx.fillText('WIND 风', gx, gy - 2);

    // 预测落点已由 drawAim 统一绘制（呼吸圈 + 内核，更大更清晰），这里不再画小十字
    if (this.cooldownLeft > 0) return;
  }
}
