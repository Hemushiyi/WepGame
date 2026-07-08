// ===== fx.ts：准星 / 飞镖 / 飘字 / 提示 =====
// 只允许从 '../render/contract' 与 '../../shared/types' 引入。

import {
  BOARD_CENTER,
  CHAR_HAND,
  PAL,
  SceneEnv,
  VW,
  pixelCircle,
  pixelCircleRing,
  pixelLine,
  pixelRect,
} from '../render/contract';
import type { Dart, FloatText } from '../../shared/types';

// ---------- 确定性伪随机（LCG，不依赖全局随机） ----------
// 基于 dart 实例 / 帧序号的稳定哈希，避免每帧抖动。
function hashSeed(seed: number): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return ((h ^ (h >>> 15)) >>> 0) / 0xffffffff;
}

// dart 用位置做 seed：位置随时间变化，但在同一帧内对每个尾段叠加索引得到稳定差分。
function dartSeed(dart: Dart): number {
  const x = Math.round(dart.pos.x);
  const y = Math.round(dart.pos.y);
  return ((x * 73856093) ^ (y * 19349663)) >>> 0;
}

// ============================================================
// drawAim：横向准星
// ============================================================
export function drawAim(env: SceneEnv, aimX: number, aimY: number, locked: boolean): void {
  const { ctx, time } = env;
  const ax = Math.round(aimX);
  const ay = Math.round(aimY);

  // 呼吸周期
  const t = time / 1000;
  let baseR: number;
  let crossColor: string; // 十字刻度 + 外环颜色
  if (locked) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 14);
    baseR = 11 + Math.round(pulse * 6);
    crossColor = PAL['y']; // 金色
  } else {
    const breathe = 0.5 + 0.5 * Math.sin(t * 2.8);
    baseR = 9 + Math.round(breathe * 5);
    crossColor = '#ff6b35'; // 亮橙
  }

  // 外呼吸环
  pixelCircleRing(ctx, ax, ay, baseR, crossColor);

  // 四向粗短刻度臂（像素狙击镜风格），外环外侧各伸一截
  const armLen = 5;
  const armW = 3;
  const out = baseR + 1; // 从环外侧起步
  const half = Math.floor(armW / 2);
  // 上
  pixelRect(ctx, ax - half, ay - out - armLen, armW, armLen, crossColor);
  // 下
  pixelRect(ctx, ax - half, ay + out + 1, armW, armLen, crossColor);
  // 左
  pixelRect(ctx, ax - out - armLen, ay - half, armLen, armW, crossColor);
  // 右
  pixelRect(ctx, ax + out + 1, ay - half, armLen, armW, crossColor);

  // 中央实心红方块（醒目红点）
  const core = locked ? 4 : 3;
  pixelRect(ctx, ax - core, ay - core, core * 2 + 1, core * 2 + 1, '#ff2244');
}

// 画一个 5px 高的小三角箭头（指向 dir：+1 向右、-1 向左）
// 以 为三角底边中心，顶点朝 dir 偏移 4px。
function drawTriTip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: number,
  color: string,
): void {
  const px = Math.round(x);
  const py = Math.round(y);
  ctx.fillStyle = color;
  // 行 dy=-2..2，每行宽度随距中心增加；逐行朝 dir 偏移形成三角形。
  for (let dy = -2; dy <= 2; dy++) {
    const half = 2 - Math.abs(dy); // 0..2（底边最宽）
    const len = 2 * half + 1; // 1,3,5
    // 该行底端 x（靠 px 一侧）随 dy 朝顶点侧收窄偏移
    const offsetX = dir * (2 - half); // 中心行偏移0，顶/底行偏移±2
    ctx.fillRect(px - half + offsetX, py + dy, len, 1);
  }
}

// ============================================================
// drawDirection：出手方向指示器（黄金矿工式钩爪摆动）
// 从角色手部 CHAR_HAND 拉一条虚线"瞄准臂"指向盘心水平线上的方向预测点，
// 随 aimDir 左右扫摆。纯 X 通道、不掺 Y/风，与 drawAim（Y 准星）解耦。
// ============================================================
export function drawDirection(env: SceneEnv, dirOffset: number, locked: boolean): void {
  const { ctx, time } = env;
  const hx = CHAR_HAND.x;
  const hy = CHAR_HAND.y;
  const tx = Math.round(BOARD_CENTER.x + dirOffset);
  const ty = Math.round(BOARD_CENTER.y);

  const color = locked ? PAL['y'] : PAL['e'];

  // 虚线瞄准臂 + 末端三角（指向盘心侧，靶恒在右侧 → dir +1）+ 手部锚点
  drawDashedLine(ctx, hx, hy, tx, ty, 3, 2, color);
  drawTriTip(ctx, tx, ty, +1, color);
  pixelRect(ctx, hx - 1, hy - 1, 3, 3, color);

  // 锁定高频脉冲：叠白色高亮（与 drawAim 同步）
  if (locked) {
    const pulse = 0.5 + 0.5 * Math.sin((time / 1000) * 14);
    if (pulse > 0.5) {
      drawDashedLine(ctx, hx, hy, tx, ty, 3, 2, PAL['W']);
      drawTriTip(ctx, tx, ty, +1, PAL['W']);
    }
  }
}

// 虚线：沿 (x0,y0)→(x1,y1) 画 on 像素亮、off 像素空的点划
function drawDashedLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  on: number,
  off: number,
  color: string,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return;
  const ux = dx / len;
  const uy = dy / len;
  let d = 0;
  while (d < len) {
    const segEnd = Math.min(len, d + on);
    pixelLine(ctx, x0 + ux * d, y0 + uy * d, x0 + ux * segEnd, y0 + uy * segEnd, color);
    d += on + off;
  }
}

// ============================================================
// drawDart：飞行中的飞镖
// ============================================================
export function drawDart(env: SceneEnv, dart: Dart): void {
  // 延迟起飞中不绘制
  if (dart.progress < 0) return;

  const { ctx } = env;
  const px = Math.round(dart.pos.x);
  // 命中后让镖微微下沉钉入板面（progress 1→1.4 间最多下沉 2px），强化"扎住"
  const sink = dart.hit ? Math.min(2, Math.round((dart.progress - 1) * 40)) : 0;
  const py = Math.round(dart.pos.y) + sink;

  // 弦向朝向角：起飞点指向落点的方向（target.x 含方向偏移，朝向自然体现出手方向）
  const ang = Math.atan2(dart.target.y - dart.startY, dart.target.x - dart.sx);

  // 颜色：玩家 / 宠物区分
  const shaft = dart.fromPet ? PAL['o'] : PAL['n']; // 镖杆
  const shaftDark = dart.fromPet ? PAL['O'] : PAL['N'];
  const tip = PAL['w']; // 镖尖金属高光
  const tipDark = PAL['W'];
  const fletch = dart.fromPet ? PAL['y'] : PAL['r']; // 尾羽
  const fletchDark = dart.fromPet ? PAL['Y'] : PAL['R'];

  // ---- 拖尾：沿速度反方向画 4 段逐渐变淡的残影（命中钉住后不再画）----
  const speed = Math.hypot(dart.target.x - dart.sx, dart.target.y - dart.startY);
  if (speed > 0.001 && !dart.hit) {
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const seed = dartSeed(dart);
    const segCount = 4;
    for (let i = 1; i <= segCount; i++) {
      // 等长间距小段（2×放大后间距同步翻倍）
      const dist = i * 4 * 3;
      const sx = px - ux * dist;
      const sy = py - uy * dist;
      // 透明度随段递减（i 越远越淡）
      const alpha = Math.max(0, 0.55 - i * 0.12);
      // 基于索引的确定性抖动，让拖尾有颗粒感但稳定
      const jitter = (hashSeed(seed + i * 131) - 0.5) * 2; // -1..1
      const nx = sx + (-uy) * jitter; // 沿垂直方向轻微抖
      const ny = sy + ux * jitter;
      // 短线段（长度2）
      const ex = nx - ux * 2;
      const ey = ny - uy * 2;
      ctx.globalAlpha = alpha;
      pixelLine(ctx, nx, ny, ex, ey, shaftDark);
    }
    ctx.globalAlpha = 1;
  }

  // ---- 镖体：在旋转后的局部坐标里画（2× 放大）----
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(ang);
  ctx.scale(3, 3);
  // 关闭抗锯齿（像素风）
  ctx.imageSmoothingEnabled = false;

  // 局部坐标系：镖尖朝 +x，尾羽在 -x。
  // 镖尖（金属高光）
  pixelLine(ctx, 5, 0, 3, 0, tipDark); // 尖端底
  pixelLine(ctx, 4, 0, 2, 0, tip); // 高光
  // 镖杆
  pixelRect(ctx, -2, -1, 5, 2, shaft); // 杆主体（含中线）
  pixelRect(ctx, -2, -1, 5, 1, shaftDark); // 顶部阴影行（增强体积）
  // 杆尾接口
  pixelRect(ctx, -3, -1, 1, 2, shaftDark);
  // 尾羽（V 形，朝后展开）
  // 上羽
  pixelLine(ctx, -3, 0, -6, -3, fletchDark);
  pixelLine(ctx, -3, -1, -5, -2, fletch);
  // 下羽
  pixelLine(ctx, -3, 0, -6, 3, fletchDark);
  pixelLine(ctx, -3, 1, -5, 2, fletch);
  // 尾羽根部小块
  pixelRect(ctx, -3, -1, 1, 2, fletch);

  ctx.restore();
}

// ============================================================
// drawFloats：飘字
// ============================================================
export function drawFloats(env: SceneEnv, floats: FloatText[]): void {
  const { ctx } = env;
  if (floats.length === 0) return;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '12px "Press Start 2P", monospace';

  for (let i = 0; i < floats.length; i++) {
    const f = floats[i];
    if (!f) continue;
    // 透明度随 life 衰减（life/300 钳到 1）
    const a = Math.max(0, Math.min(1, f.life / 300));
    if (a <= 0) continue;

    const px = Math.round(f.pos.x);
    const py = Math.round(f.pos.y);
    const text = f.text;

    ctx.globalAlpha = a;

    // 1px 偏移深色描边（8 方向 + 居中暗底，营造像素描边）
    ctx.fillStyle = PAL['K'];
    const offs: ReadonlyArray<[number, number]> = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
      [-1, -1], [1, -1], [-1, 1], [1, 1],
    ];
    for (const [ox, oy] of offs) {
      ctx.fillText(text, px + ox, py + oy);
    }

    // 主色
    ctx.fillStyle = f.color && f.color.length > 0 ? f.color : PAL['w'];
    ctx.fillText(text, px, py);
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

// ============================================================
// drawHint：投掷提示（顶部中央，闪烁）
// ============================================================
export function drawHint(env: SceneEnv, visible: boolean): void {
  if (!visible) return;

  const { ctx, time } = env;
  // 闪烁：约 0.8s 一个周期，亮 0.5 占空比
  const phase = (time / 1000) % 0.8;
  if (phase > 0.45) return; // 暗半周不绘制

  const text = '点击 / TAP 投掷';
  const cx = Math.round(VW / 2); // 提示居中
  const cy = 20; // 顶部中央

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '12px "Press Start 2P", monospace';

  const px = cx;
  const py = cy;

  // 深色描边
  ctx.fillStyle = PAL['K'];
  const offs: ReadonlyArray<[number, number]> = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ];
  for (const [ox, oy] of offs) {
    ctx.fillText(text, px + ox, py + oy);
  }
  // 主色黄
  ctx.fillStyle = PAL['y'];
  ctx.fillText(text, px, py);

  ctx.restore();
}
