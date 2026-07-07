// ===== 渲染层共享契约：坐标 / 调色板 / 像素工具 / 场景环境 =====
// 所有 render/* 模块只允许从本文件与 ../types 引入。
// 修改本文件的常量会同步影响 game.ts 的逻辑坐标。

import type { DerivedStats } from '../types';

/** 虚拟分辨率（提升细节，仍保持像素感）。
 *  VH 固定；VW 随屏幕宽高比动态变化（见 applyLayout），使画布比例始终等于
 *  舞台比例 → 拉伸铺满，既无黑边也无变形。各 render 模块读取的是 live binding。 */
export let VW = 640;
export const VH = 360;

/** 地面顶端 y */
export const GROUND_Y = 282;

/** 飞镖盘中心（.x 随 VW 变化，由 applyLayout 维护，保持贴右排列） */
export const BOARD_CENTER = { x: 522, y: 168 };

/** 按舞台实际宽高比重算虚拟宽，并把盘心贴到右侧固定留白处。
 *  默认 VW=640 → BOARD_CENTER.x=522，与原标定一致。调用前应已 measure 舞台尺寸。
 *  注意：需在 relayoutBackground 之前调用，让背景模块按新 VW 重建装饰。 */
export function applyLayout(vw: number): void {
  VW = vw;
  BOARD_CENTER.x = vw - 118; // 距右边缘 118，留出 r4(74)+外框(8)+瞄准框(16) 的余地
}

/** 角色脚底位置（x 为脚底中心） */
export const CHAR_FEET_X = 70;
export const CHAR_FEET_Y = GROUND_Y;

/** 玩家飞镖起飞点（角色投掷手位置，模块绘制角色时需让手落在附近） */
export const CHAR_HAND = { x: 100, y: 256 };

/** 宠物基准脚底 x（按索引向左排列） */
export const petFeetX = (i: number) => 44 - i * 16;
export const PET_FEET_Y = GROUND_Y;

/** 丰富复古调色板（drawSprite 的字符 -> 颜色） */
export const PAL: Record<string, string> = {
  ' ': 'transparent',
  '.': 'transparent',
  // 描边 / 黑白灰
  k: '#15131f', // 主描边
  K: '#08060f', // 最深
  w: '#f5f5fb', // 白
  W: '#c8c8da', // 浅灰
  d: '#5a617f', // 灰蓝
  D: '#3a4159', // 深灰蓝
  // 肤 / 发
  s: '#f6cba0',
  S: '#e3a679',
  h: '#4a2f1a',
  H: '#2f1d10',
  // 衣物主色
  r: '#ea4754',
  R: '#b8333d',
  b: '#4a72e6',
  B: '#3350b0',
  y: '#ffd45e',
  Y: '#e0a83a',
  g: '#5fce86',
  G: '#3fa866',
  o: '#f5a23e',
  O: '#c97a22',
  p: '#c061e0',
  P: '#9038b0',
  // 木 / 镖杆
  n: '#9a6a3a',
  N: '#6e4a26',
  // 高光 / 准星
  e: '#7df9ff',
  E: '#3fb6c9',
  m: '#ffe9a8', // 月亮
  // 夜空
  t: '#1b1340',
  u: '#3a2670',
  // 飞镖盘专用
  q: '#ece6d2', // 浅扇区
  Q: '#20202c', // 深扇区
  a: '#3fa866', // 绿环（双倍/三倍）
  A: '#e84753', // 红环
  c: '#b7b7c4', // 钢丝
  C: '#9a8a3a', // 黄心
};

/** 场景环境：每个 draw 函数都接收它 */
export interface SceneEnv {
  ctx: CanvasRenderingContext2D;
  time: number; // 累计毫秒
  stats: DerivedStats;
}

// ---------- 像素工具 ----------

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  scale = 1,
  flipX = false,
): void {
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row];
    for (let col = 0; col < line.length; col++) {
      const color = PAL[line[col]];
      if (!color || color === 'transparent') continue;
      const dx = flipX ? x + (line.length - 1 - col) * scale : x + col * scale;
      ctx.fillStyle = color;
      ctx.fillRect(dx, y + row * scale, scale, scale);
    }
  }
}

export const spriteW = (lines: string[]) =>
  lines.reduce((m, l) => Math.max(m, l.length), 0);
export const spriteH = (lines: string[]) => lines.length;

export function pixelRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** 像素实心圆（逐行水平条带，无抗锯齿） */
export function pixelCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void {
  if (r <= 0) return;
  ctx.fillStyle = color;
  const rr = Math.ceil(r);
  for (let yy = -rr; yy <= rr; yy++) {
    const hh = r * r - yy * yy;
    if (hh < 0) continue;
    const xx = Math.floor(Math.sqrt(hh));
    ctx.fillRect(cx - xx, cy + yy, 2 * xx + 1, 1);
  }
}

/** 像素圆环（轮廓） */
export function pixelCircleRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void {
  if (r <= 0) return;
  ctx.fillStyle = color;
  const rr = Math.ceil(r);
  for (let yy = -rr; yy <= rr; yy++) {
    const hh = r * r - yy * yy;
    if (hh < 0) continue;
    const xx = Math.floor(Math.sqrt(hh));
    ctx.fillRect(cx - xx, cy + yy, 1, 1);
    ctx.fillRect(cx + xx, cy + yy, 1, 1);
  }
}

/** 像素椭圆（用于阴影） */
export function pixelEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
): void {
  if (rx <= 0 || ry <= 0) return;
  ctx.fillStyle = color;
  for (let yy = -Math.ceil(ry); yy <= Math.ceil(ry); yy++) {
    const e = 1 - (yy * yy) / (ry * ry);
    if (e < 0) continue;
    const xx = Math.floor(rx * Math.sqrt(e));
    ctx.fillRect(cx - xx, cy + yy, 2 * xx + 1, 1);
  }
}

/** Bresenham 像素直线 */
export function pixelLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
): void {
  ctx.fillStyle = color;
  x0 = Math.round(x0); y0 = Math.round(y0);
  x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  // 安全上限防止 runaway
  let guard = 0;
  while (guard++ < 4096) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** 局部浮点取整帮助 */
export const rnd = (n: number) => Math.round(n);

/*
  各渲染模块需实现的导出（game.ts 据此调用）：

  background.ts:
    export function drawBackground(env: SceneEnv): void

  board.ts:
    export function drawBoard(env: SceneEnv): void

  character.ts:
    export function drawCharacter(
      env: SceneEnv, feetX: number, feetY: number,
      frame: 'idle' | 'throw', flipX: boolean,
    ): void
    export function drawPet(env: SceneEnv, feetX: number, feetY: number, phase: number): void

  fx.ts:
    export function drawAim(env: SceneEnv, aimY: number, locked: boolean): void
    export function drawDart(env: SceneEnv, dart: import('../types').Dart): void
    export function drawFloats(env: SceneEnv, floats: import('../types').FloatText[]): void
    export function drawHint(env: SceneEnv, visible: boolean): void
*/
