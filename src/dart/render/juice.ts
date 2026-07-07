/**
 * juice.ts —— 屏幕震动 + 命中粒子（纯 Canvas，像素风）。
 *
 * 自洽模块：不依赖其他项目文件。
 * 所有坐标/数值在返回或绘制前取整。
 * 健壮性：调用方环境异常（如无 canvas/ctx）时静默降级，不抛错。
 */

/** 单个粒子。坐标/速度均以“像素 / 毫秒”语义混存，更新时按 dt 推进。 */
interface Particle {
  x: number;
  y: number;
  vx: number; // 像素/秒
  vy: number; // 像素/秒
  life: number; // 剩余生命（毫秒）
  maxLife: number; // 初始生命（毫秒），用于透明度归一化
  color: string;
  size: number; // 1~2 像素
}

/** 命中冲击波：一个向外扩张的方形像素环（+ 中心命中的全屏白闪）。 */
interface Impact {
  x: number;
  y: number;
  color: string;
  life: number; // 剩余 ms
  maxLife: number; // 初始 ms
  maxR: number; // 扩张到的最大半边长（像素）
  bull: boolean; // 是否中心命中（触发白闪）
}

/** 粒子数组上限，防止无限增长。 */
const MAX_PARTICLES = 240;
/** 冲击波数组上限。 */
const MAX_IMPACTS = 24;
/** 冲击波持续时间（毫秒）。 */
const IMPACT_LIFE = 190;
/** 普通命中冲击波最大半边长（像素）。中心命中更大。 */
const IMPACT_R = 18;
const IMPACT_R_BULL = 28;

/** 震动幅值归零阈值（<0.4 视为静止）。 */
const SHAKE_CUTOFF = 0.4;

/** 震动每帧指数衰减系数。 */
const SHAKE_DECAY = 0.86;

/** 粒子重力加速度（像素/秒^2，正值向下）。 */
const GRAVITY = 900;

/** 内部状态。 */
let amp = 0; // 当前震动幅值（像素）
let phase = 0; // 相位累加（毫秒）
let dirX = 1; // 一次性随机方向（x）
let dirY = 1; // 一次性随机方向（y）
let particles: Particle[] = [];
let impacts: Impact[] = [];

/**
 * 触发一次屏幕震动。
 * 取当前 amp 与新 mag 的较大值，避免短时间多次小幅调用覆盖更强烈的震动。
 */
function shake(mag: number): void {
  if (!Number.isFinite(mag)) return;
  if (mag < 0) return; // 负幅值无意义
  if (mag > amp) amp = mag;
}

/**
 * 在 (x, y) 喷射命中粒子。
 * 一次性随机各粒子初速度方向，避免每帧重抽导致抖动跳变。
 * count 默认 10；到达 MAX_PARTICLES 上限后丢弃新增，防止溢出。
 */
function burst(x: number, y: number, color: string, count: number = 10): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (!Number.isFinite(count) || count <= 0) return;
  if (typeof color !== 'string') return;

  const cap = Math.min(count, MAX_PARTICLES - particles.length);
  for (let i = 0; i < cap; i++) {
    // 全向散射：角度 0~2π，速度 60~200 px/s。
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 140;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed - 60; // 略微上抛，更生动
    const life = 350 + Math.random() * 250; // 350~600ms
    particles.push({
      x: Math.round(x),
      y: Math.round(y),
      vx,
      vy,
      life,
      maxLife: life,
      color,
      size: Math.random() < 0.5 ? 1 : 2,
    });
  }

  // 上限保护：如因极端调用累积超出，截断到最新若干个。
  if (particles.length > MAX_PARTICLES) {
    particles = particles.slice(particles.length - MAX_PARTICLES);
  }
}

/**
 * 在 (x, y) 触发一个向外扩张的方形冲击波环；bull=true（中心命中）时
 * 额外附带一个短暂的整屏白闪，强化"爆中心"的打击感。
 */
function impact(x: number, y: number, color: string, bull: boolean = false): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (typeof color !== 'string') return;
  impacts.push({
    x: Math.round(x),
    y: Math.round(y),
    color,
    life: IMPACT_LIFE,
    maxLife: IMPACT_LIFE,
    maxR: bull ? IMPACT_R_BULL : IMPACT_R,
    bull,
  });
  if (impacts.length > MAX_IMPACTS) {
    impacts = impacts.slice(impacts.length - MAX_IMPACTS);
  }
}

/**
 * 每帧推进：震动衰减 + 粒子运动。
 * dt 单位为毫秒。dt 非正或非有限值时跳过。
 */
function update(dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0) return;

  // —— 震动衰减 ——
  // 每帧乘以衰减系数；为兼容大 dt 也做指数化。
  // 这里按“每帧固定”语义实现（规格明确 *=0.86）。
  amp *= SHAKE_DECAY;
  if (amp < SHAKE_CUTOFF) amp = 0;

  // 相位累加，驱动方向正弦摆动；同时保证方向一次性随机、不每帧重抽。
  phase += dt;
  const sec = dt / 1000;

  // —— 粒子运动 ——
  const next: Particle[] = [];
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) continue; // 死亡，丢弃

    // 重力（向下）
    p.vy += GRAVITY * sec;
    // 位置积分（vx/vy 单位 px/s）
    p.x += p.vx * sec;
    p.y += p.vy * sec;

    next.push(p);
  }
  particles = next;

  // —— 冲击波环：仅衰减生命 ——
  for (const im of impacts) im.life -= dt;
  impacts = impacts.filter((im) => im.life > 0);
}

/**
 * 当前震动偏移。调用方 ctx.translate 应用。
 * 用相位驱动的正弦做柔和摆动，方向 dirX/dirY 一次性随机决定符号，
 * 避免每帧重抽导致抖动跳变。
 * 坐标取整。amp 归零时返回 (0,0)。
 */
function shakeOffset(): { x: number; y: number } {
  if (amp < SHAKE_CUTOFF) return { x: 0, y: 0 };
  // 两个不同频率的正弦，使 x/y 摆动不完全同步，手感更自然。
  const ox = Math.round(Math.sin(phase * 0.05) * amp * dirX);
  const oy = Math.round(Math.cos(phase * 0.043) * amp * dirY);
  return { x: ox, y: oy };
}

/**
 * 绘制存活粒子。调用方在场景之后再画。
 * imageSmoothing 由调用方关闭；这里用 fillRect 画 1~2px 方块实现像素风。
 * 透明度按 life/maxLife 线性映射。ctx 为空/不可用时静默返回。
 */
function draw(ctx: CanvasRenderingContext2D): void {
  if (!ctx) return;
  if (particles.length === 0) return;

  // 保存/恢复，避免污染调用方全局 alpha / fillStyle 状态。
  const prevAlpha = ctx.globalAlpha;
  const prevFill = ctx.fillStyle;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const ratio = p.life / p.maxLife;
    const alpha = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
    ctx.globalAlpha = prevAlpha * alpha;
    ctx.fillStyle = p.color;
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    ctx.fillRect(px, py, p.size, p.size);
  }

  // —— 冲击波环：扩张 + 渐隐 ——
  // 进度 t：0（刚命中）→1（消失）。半径随 t 扩张，透明度反向衰减。
  const prevLineWidth = ctx.lineWidth;
  for (const im of impacts) {
    const t = 1 - im.life / im.maxLife; // 0→1
    const r = Math.max(1, Math.round(im.maxR * t));
    const a = Math.max(0, 1 - t);
    // 方形像素环（与像素风一致），2px 描边
    ctx.globalAlpha = prevAlpha * a;
    ctx.strokeStyle = im.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(im.x - r, im.y - r, r * 2, r * 2);
    // 中心命中：前 ~65% 生命周期叠一个全屏白闪，强反馈"爆中心"
    if (im.bull && t < 0.65) {
      const fa = 0.5 * (1 - t / 0.65);
      ctx.globalAlpha = prevAlpha * fa;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  }
  ctx.lineWidth = prevLineWidth;

  ctx.globalAlpha = prevAlpha;
  ctx.fillStyle = prevFill;
}

// 触发新震动时，若当前 amp 为 0，则重新随机一次方向，避免长期同一方向。
// 通过包装 shake 实现：保持对外 API 名字/签名不变。
const _shakeRaw = shake;
function _shakeWrapped(mag: number): void {
  if (amp < SHAKE_CUTOFF) {
    dirX = Math.random() < 0.5 ? -1 : 1;
    dirY = Math.random() < 0.5 ? -1 : 1;
  }
  _shakeRaw(mag);
}

/** 导出对象，名字/签名一字不差，供 game.ts / ui.ts 调用。 */
export const juice = {
  shake: _shakeWrapped,
  burst,
  impact,
  update,
  shakeOffset,
  draw,
};
