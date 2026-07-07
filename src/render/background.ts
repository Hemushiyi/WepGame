// ===== 夜景背景：铺满 640x360 的像素夜景 =====
// 仅允许 import 自 '../render/contract' 与 '../types'。
// 所有坐标取整；所有“随机”位置走基于索引的确定性 LCG。

import {
  VW,
  VH,
  GROUND_Y,
  PAL,
  type SceneEnv,
  pixelRect,
  pixelCircle,
  pixelEllipse,
  pixelLine,
} from '../render/contract';

// ---------- 确定性伪随机（LCG），不依赖全局 Math.random ----------
// 给定 (seed) 返回 0..1 的浮点；同一 seed 永远同一结果。
function lcg(seed: number): number {
  // Numerical Recipes 常数；用 32 位整数运算
  let s = (seed >>> 0) ^ 0x9e3779b9;
  s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
  s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
  return s / 0xffffffff;
}

// 混合两个 index 维度，得到稳定伪随机
function hash2(i: number, j: number): number {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263)) >>> 0;
  h = (Math.imul(h ^ (h >>> 13), 1274126177)) >>> 0;
  return (h ^ (h >>> 16)) / 0xffffffff;
}

// 天空渐变色带（顶部深靛 → 中部紫 → 地平线暖辉）
interface Band {
  y0: number;
  y1: number;
  color: string;
}

const SKY_BANDS: Band[] = [
  { y0: 0, y1: 28, color: '#15122e' }, // 顶部最深靛
  { y0: 28, y1: 60, color: '#1a1438' },
  { y0: 60, y1: 96, color: '#221a48' },
  { y0: 96, y1: 134, color: '#2a1d5a' }, // 中部紫
  { y0: 134, y1: 172, color: '#3a2470' },
  { y0: 172, y1: 206, color: '#4a2f7a' },
  { y0: 206, y1: 236, color: '#5a3a6a' }, // 暖辉
  { y0: 236, y1: GROUND_Y, color: '#6a4470' }, // 地平线偏暖
];

// 月亮配置（左上方）
const MOON = { cx: 132, cy: 78, r: 26 };

// 预生成星表（确定性）—— 固定数量，避免每帧抖动
interface Star {
  x: number;
  y: number;
  base: number; // 基础亮度 0..1
  twk: number; // 闪烁相位偏移
  twkAmp: number; // 闪烁幅度
}

function genStars(): Star[] {
  const arr: Star[] = [];
  const COUNT = 60;
  for (let i = 0; i < COUNT; i++) {
    const rx = lcg(i * 3 + 1);
    const ry = lcg(i * 3 + 2);
    const rb = lcg(i * 3 + 7);
    const rp = lcg(i * 3 + 11);
    const ra = lcg(i * 3 + 13);
    // 星星只在地平线辉光以上的天空区域（避开月亮辉区与角色站位无关）
    const x = Math.round(rx * (VW - 8) + 4);
    const y = Math.round(ry * (GROUND_Y - 40) + 4);
    // 避开月亮核心区域，让月亮主体干净
    const dx = x - MOON.cx;
    const dy = y - MOON.cy;
    if (dx * dx + dy * dy < (MOON.r + 8) * (MOON.r + 8)) {
      // 推到月亮右下侧外圈
      const ang = Math.atan2(dy || 1, dx || 1);
      const dd = MOON.r + 14;
      arr.push({
        x: Math.round(MOON.cx + Math.cos(ang) * dd),
        y: Math.round(MOON.cy + Math.sin(ang) * dd),
        base: 0.45 + rb * 0.5,
        twk: rp * Math.PI * 2,
        twkAmp: 0.25 + ra * 0.4,
      });
      continue;
    }
    arr.push({
      x,
      y,
      base: 0.4 + rb * 0.55,
      twk: rp * Math.PI * 2,
      twkAmp: 0.2 + ra * 0.45,
    });
  }
  return arr;
}
let STARS: Star[] = genStars();

// 几颗 2x2 十字 sparkle（索引到星表里挑）
const SPARKLE_IDX = [3, 17, 38, 51];

// ---------- 远山（两层视差剪影） ----------
// 远层：偏亮紫的连绵低山；近层：偏深的尖峰。
// 用三角峰拼接：每座峰由若干 1px 宽的竖条堆成（pixelRect 堆叠）。
interface Peak {
  cx: number; // 峰心 x
  baseY: number; // 山脚 y
  height: number; // 峰高
  halfW: number; // 半宽
}

function makePeaks(layer: number, count: number, seedBase: number): Peak[] {
  const peaks: Peak[] = [];
  const spacing = VW / count;
  for (let i = 0; i < count; i++) {
    const rh = hash2(seedBase + i, layer * 31 + 7);
    const rw = hash2(seedBase + i + 500, layer * 17 + 3);
    const cx = Math.round((i + 0.3 + rw * 0.4) * spacing);
    const height = layer === 0
      ? Math.round(26 + rh * 22) // 远层矮一点
      : Math.round(40 + rh * 34); // 近层更高
    const halfW = layer === 0
      ? Math.round(70 + rw * 50)
      : Math.round(52 + rw * 40);
    const baseY = layer === 0 ? GROUND_Y - 4 : GROUND_Y;
    peaks.push({ cx, baseY, height, halfW });
  }
  return peaks;
}

let FAR_PEAKS = makePeaks(0, 6, 101);
let NEAR_PEAKS = makePeaks(1, 7, 202);

function drawPeak(ctx: CanvasRenderingContext2D, p: Peak, color: string): void {
  // 由峰心向两侧逐列下降：用 1px 宽竖条
  for (let dx = -p.halfW; dx <= p.halfW; dx++) {
    const t = dx / p.halfW; // -1..1
    // 三角形轮廓：h = height * (1 - |t|)
    let h = p.height * (1 - Math.abs(t));
    // 轻微折线感：在 t 接近 0 时给一点平台抖动
    const jitter = hash2(p.cx + dx, 9) > 0.5 ? 1 : 0;
    h = Math.max(0, Math.round(h + jitter));
    if (h <= 0) continue;
    const x = p.cx + dx;
    if (x < 0 || x >= VW) continue;
    ctx.fillStyle = color;
    ctx.fillRect(x, p.baseY - h, 1, h);
  }
}

// ---------- 云（2~3 朵，缓慢右漂取模回绕） ----------
interface CloudDef {
  y: number;
  scale: number; // 影响宽高
  speed: number; // 像素/秒
  phase: number; // 起始 x 偏移（0..VW）
}

const CLOUDS: CloudDef[] = [
  { y: 54, scale: 1.0, speed: 6, phase: 0 },
  { y: 96, scale: 0.8, speed: 4, phase: 230 },
  { y: 38, scale: 1.15, speed: 8, phase: 430 },
];

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, alpha: number): void {
  // 由几个椭圆叠成蓬松像素云
  ctx.save();
  ctx.globalAlpha = alpha;
  const blobs: Array<[number, number, number, number]> = [
    [0, 0, 14 * scale, 5 * scale],
    [-10 * scale, 2 * scale, 10 * scale, 4 * scale],
    [12 * scale, 2 * scale, 12 * scale, 4 * scale],
    [-4 * scale, -3 * scale, 9 * scale, 4 * scale],
    [6 * scale, -2 * scale, 8 * scale, 3 * scale],
  ];
  for (const [bx, by, rx, ry] of blobs) {
    pixelEllipse(ctx, Math.round(x + bx), Math.round(y + by), Math.max(2, Math.round(rx)), Math.max(2, Math.round(ry)), '#b9b6d8');
  }
  // 高光底边略亮
  for (const [bx, by, rx, ry] of blobs) {
    pixelEllipse(ctx, Math.round(x + bx), Math.round(y + by + 1), Math.max(2, Math.round(rx * 0.7)), Math.max(2, Math.round(ry * 0.6)), '#cfc7e8');
  }
  ctx.restore();
}

// ---------- 地面前景点缀：草丛与小花 ----------
interface Tuft {
  x: number;
  kind: number; // 0..2 决定草叶形态
}
interface Flower {
  x: number;
  color: 'r' | 'y';
}

// 草丛 / 花位置确定性生成，分布在地面主体上，避开角色站位 x≈[50,110]
function genTufts(): Tuft[] {
  const out: Tuft[] = [];
  for (let i = 0; i < 26; i++) {
    const rx = hash2(i, 555);
    const x = Math.round(20 + rx * (VW - 40));
    if (x > 48 && x < 116) continue; // 避开角色站位
    out.push({ x, kind: i % 3 });
  }
  return out;
}
let TUFTS: Tuft[] = genTufts();

function genFlowers(): Flower[] {
  const out: Flower[] = [];
  for (let i = 0; i < 9; i++) {
    const rx = hash2(i, 909);
    const rc = hash2(i, 919);
    const x = Math.round(150 + rx * (VW - 200));
    out.push({ x, color: rc > 0.5 ? 'r' : 'y' });
  }
  return out;
}
let FLOWERS: Flower[] = genFlowers();

/** 按当前 VW 重建所有依赖宽度的装饰（星 / 山 / 草 / 花）。
 *  需在 contract.applyLayout 之后调用，使 VW 已更新。 */
export function relayoutBackground(): void {
  STARS = genStars();
  FAR_PEAKS = makePeaks(0, 6, 101);
  NEAR_PEAKS = makePeaks(1, 7, 202);
  TUFTS = genTufts();
  FLOWERS = genFlowers();
}

// 最左前景剪影：枯树 + 灌木（x 很小，不挡 x≈70）
function drawForegroundSilhouette(ctx: CanvasRenderingContext2D): void {
  // 一棵小枯树（剪影色用最深 K）
  const treeX = 20;
  const treeBaseY = GROUND_Y;
  // 主干
  pixelRect(ctx, treeX, treeBaseY - 30, 2, 30, PAL['K']);
  // 分叉枝
  pixelLine(ctx, treeX + 1, treeBaseY - 24, treeX - 8, treeBaseY - 36, PAL['K']);
  pixelLine(ctx, treeX + 1, treeBaseY - 22, treeX + 9, treeBaseY - 33, PAL['K']);
  pixelLine(ctx, treeX + 1, treeBaseY - 28, treeX - 4, treeBaseY - 40, PAL['K']);
  pixelLine(ctx, treeX + 1, treeBaseY - 26, treeX + 6, treeBaseY - 39, PAL['K']);
  // 细枝
  pixelLine(ctx, treeX - 8, treeBaseY - 36, treeX - 12, treeBaseY - 42, PAL['K']);
  pixelLine(ctx, treeX + 9, treeBaseY - 33, treeX + 13, treeBaseY - 40, PAL['K']);

  // 一丛灌木（剪影）在树右下，仍在 x<48 内
  const shrubCx = 34;
  const shrubCy = GROUND_Y - 4;
  pixelCircle(ctx, shrubCx, shrubCy, 8, PAL['K']);
  pixelCircle(ctx, shrubCx - 7, shrubCy + 1, 6, PAL['K']);
  pixelCircle(ctx, shrubCx + 7, shrubCy + 1, 6, PAL['K']);
  // 灌木顶端轻微高光（夜色下不亮，仅给一点轮廓）
  pixelRect(ctx, shrubCx - 1, shrubCy - 8, 3, 1, '#0d0a18');
}

// ---------- 星星单颗绘制 ----------
function drawStar(ctx: CanvasRenderingContext2D, s: Star, time: number): void {
  // 透明度 = clamp(base + amp * sin(time + phase))
  const t = time / 1000;
  const a = Math.max(0.12, Math.min(1, s.base + s.twkAmp * Math.sin(t * 1.6 + s.twk)));
  ctx.save();
  ctx.globalAlpha = a;
  // 主体用接近白的星色
  const col = s.base > 0.7 ? '#f5f5fb' : '#d8d4ec';
  pixelRect(ctx, s.x, s.y, 1, 1, col);
  ctx.restore();
}

function drawSparkle(ctx: CanvasRenderingContext2D, s: Star, time: number): void {
  const t = time / 1000;
  const a = Math.max(0.25, Math.min(1, s.base + s.twkAmp * Math.sin(t * 1.8 + s.twk)));
  ctx.save();
  // 中心亮像素
  ctx.globalAlpha = a;
  pixelRect(ctx, s.x, s.y, 1, 1, '#ffffff');
  // 上下左右淡像素
  ctx.globalAlpha = a * 0.55;
  pixelRect(ctx, s.x, s.y - 1, 1, 1, '#cfc7e8');
  pixelRect(ctx, s.x, s.y + 1, 1, 1, '#cfc7e8');
  pixelRect(ctx, s.x - 1, s.y, 1, 1, '#cfc7e8');
  pixelRect(ctx, s.x + 1, s.y, 1, 1, '#cfc7e8');
  // 对角更淡的小点（强化十字感）
  ctx.globalAlpha = a * 0.3;
  pixelRect(ctx, s.x - 1, s.y - 1, 1, 1, '#b9b6d8');
  pixelRect(ctx, s.x + 1, s.y - 1, 1, 1, '#b9b6d8');
  pixelRect(ctx, s.x - 1, s.y + 1, 1, 1, '#b9b6d8');
  pixelRect(ctx, s.x + 1, s.y + 1, 1, 1, '#b9b6d8');
  ctx.restore();
}

// ---------- 月亮 ----------
function drawMoon(ctx: CanvasRenderingContext2D, time: number): void {
  const cx = MOON.cx;
  const cy = MOON.cy;
  const r = MOON.r;

  // 多层柔和光晕（半透明椭圆，由外到内逐渐变实）
  ctx.save();
  ctx.globalAlpha = 0.05;
  pixelEllipse(ctx, cx, cy, r + 22, r + 18, '#ffe9a8');
  ctx.globalAlpha = 0.07;
  pixelEllipse(ctx, cx, cy, r + 16, r + 13, '#ffe9a8');
  ctx.globalAlpha = 0.10;
  pixelEllipse(ctx, cx, cy, r + 10, r + 8, '#ffe9a8');
  ctx.globalAlpha = 0.14;
  pixelEllipse(ctx, cx, cy, r + 5, r + 4, '#ffe9a8');
  ctx.restore();

  // 月盘主体（实心淡黄圆）
  pixelCircle(ctx, cx, cy, r, PAL['m']);

  // 月牙阴影：用一个偏右上的深色圆"咬掉"一块
  // 用与天空该处相近的紫色覆盖，营造新月。
  // 天空在 (cx,cy) 附近大致是中部紫，取 #2a1d5a 略偏深做阴影。
  pixelCircle(ctx, cx + 9, cy - 5, r - 1, '#241846');

  // 残留月牙上的陨石坑暗点（2~3 个）
  const craters: Array<[number, number, number]> = [
    [cx - 12, cy + 6, 3],
    [cx - 16, cy - 4, 2],
    [cx - 7, cy + 12, 2],
  ];
  for (const [ccx, ccy, cr] of craters) {
    // 暗坑（偏暖的暗黄褐）
    pixelCircle(ctx, ccx, ccy, cr, '#e0c489');
    // 高光边
    pixelRect(ctx, ccx - cr, ccy - 1, 1, 1, '#f4dca6');
  }

  // 月牙亮缘轻微高光（顶端一两个像素）
  ctx.save();
  ctx.globalAlpha = 0.8;
  pixelRect(ctx, cx - r + 2, cy - 2, 1, 1, '#fff4cf');
  pixelRect(ctx, cx - r + 4, cy - 6, 1, 1, '#fff4cf');
  ctx.restore();

  // 轻微随时间的整体辉光呼吸（不改变位置，仅 alpha 微变）
  const breathe = 0.5 + 0.5 * Math.sin(time / 1400);
  ctx.save();
  ctx.globalAlpha = 0.04 + 0.04 * breathe;
  pixelEllipse(ctx, cx, cy, r + 30, r + 26, '#ffe9a8');
  ctx.restore();
}

// ---------- 主绘制 ----------
// 拆成两层：静态层（不随时间变化）可由 game.ts 预渲染到离屏 canvas 缓存；
// 动态层（星闪烁 / 月呼吸 / 云漂移）每帧实时画在静态层之上。
// 注意：动态层的星/月/云都在天空上部（y 较小），与近地的山/地面基本不重叠，
// 因此“先静态后动态”的合成顺序不会产生明显错层。

/** 静态层：清屏底 + 天空 + 远/近山 + 地面 + 草丛 + 小花 + 前景剪影 */
export function drawBackgroundStatic(env: SceneEnv): void {
  const { ctx } = env;

  // 1) 清屏底色（最深的顶部色，作为安全兜底）
  pixelRect(ctx, 0, 0, VW, VH, '#15122e');

  // 2) 天空多段色带
  for (const b of SKY_BANDS) {
    pixelRect(ctx, 0, b.y0, VW, b.y1 - b.y0, b.color);
  }

  // 3) 远山（远层偏亮紫，先画，被近山与地面压住底部）
  for (const p of FAR_PEAKS) drawPeak(ctx, p, '#3a2a64');
  // 远山顶缘一抹更亮的辉边（地平线反光感）
  ctx.save();
  ctx.globalAlpha = 0.35;
  for (const p of FAR_PEAKS) {
    // 仅在峰顶附近画 1px 亮带
    const h = Math.round(p.height);
    if (h > 0) pixelRect(ctx, p.cx, p.baseY - h, 1, 1, '#6a4a86');
  }
  ctx.restore();

  // 近山（偏深紫，叠在远山之上）
  for (const p of NEAR_PEAKS) drawPeak(ctx, p, '#241638');
  // 近山顶缘微亮（夜雾感）
  ctx.save();
  ctx.globalAlpha = 0.25;
  for (const p of NEAR_PEAKS) {
    const h = p.height;
    if (h > 0) pixelRect(ctx, p.cx, p.baseY - h, 1, 1, '#3a2655');
  }
  ctx.restore();

  // 4) 地面
  // 地平线辉光带（天空与地面交界处的暖辉，1px）
  pixelRect(ctx, 0, GROUND_Y - 1, VW, 1, '#7a5a78');
  // 草地顶端高光线（亮绿，1px）
  pixelRect(ctx, 0, GROUND_Y, VW, 1, '#6fd896');
  // 草地主体（绿）
  const grassH = 12;
  pixelRect(ctx, 0, GROUND_Y + 1, VW, grassH, PAL['G']);
  // 草地暗纹理（每隔一段更深一道）
  for (let x = 0; x < VW; x += 4) {
    if (hash2(x, 71) > 0.5) {
      pixelRect(ctx, x, GROUND_Y + 1, 1, grassH, '#369156');
    }
  }
  // 土壤（草地下方更深）
  pixelRect(ctx, 0, GROUND_Y + 1 + grassH, VW, VH - (GROUND_Y + 1 + grassH), '#2a1c3a');
  // 土壤纹理斑点
  for (let x = 0; x < VW; x += 6) {
    if (hash2(x, 313) > 0.6) {
      const yy = GROUND_Y + 1 + grassH + Math.round(hash2(x, 314) * (VH - (GROUND_Y + 1 + grassH) - 2));
      pixelRect(ctx, x, yy, 2, 1, '#1d1230');
    }
  }

  // 5) 草丛点缀（3px 高草叶簇）
  for (const t of TUFTS) {
    const bx = t.x;
    const by = GROUND_Y;
    if (t.kind === 0) {
      // 单簇三叶
      pixelRect(ctx, bx, by - 3, 1, 3, '#2f8a52');
      pixelRect(ctx, bx + 1, by - 2, 1, 2, '#3fa866');
      pixelRect(ctx, bx - 1, by - 2, 1, 2, '#3fa866');
    } else if (t.kind === 1) {
      // 弯叶
      pixelLine(ctx, bx, by, bx, by - 3, '#2f8a52');
      pixelLine(ctx, bx + 1, by, bx + 2, by - 2, '#3fa866');
      pixelLine(ctx, bx - 1, by, bx - 2, by - 2, '#369156');
    } else {
      // 密簇
      pixelRect(ctx, bx, by - 3, 1, 3, '#369156');
      pixelRect(ctx, bx + 1, by - 2, 1, 2, '#3fa866');
      pixelRect(ctx, bx + 2, by - 3, 1, 3, '#2f8a52');
      pixelRect(ctx, bx - 1, by - 2, 1, 2, '#369156');
    }
  }

  // 6) 小花
  for (const f of FLOWERS) {
    const bx = f.x;
    const by = GROUND_Y + 2;
    // 花茎
    pixelRect(ctx, bx, by - 3, 1, 3, '#2f8a52');
    // 花瓣色
    const petal = f.color === 'r' ? PAL['r'] : PAL['y'];
    const heart = f.color === 'r' ? PAL['Y'] : PAL['O'];
    // 2x2 花头
    pixelRect(ctx, bx - 1, by - 4, 1, 1, petal);
    pixelRect(ctx, bx + 1, by - 4, 1, 1, petal);
    pixelRect(ctx, bx - 1, by - 3, 1, 1, petal);
    pixelRect(ctx, bx + 1, by - 3, 1, 1, petal);
    pixelRect(ctx, bx, by - 4, 1, 1, heart);
    pixelRect(ctx, bx, by - 3, 1, 1, heart);
  }

  // 7) 最左前景剪影（枯树 + 灌木）—— 最后画，盖住天空/山/地面边缘
  drawForegroundSilhouette(ctx);
}

/** 动态层：星星闪烁 + 月亮呼吸 + 云漂移（每帧重画，画在静态层之上） */
export function drawBackgroundAnimated(env: SceneEnv): void {
  const { ctx, time } = env;

  // 1) 星星（先画普通星，再画 sparkle）
  for (let i = 0; i < STARS.length; i++) {
    if (SPARKLE_IDX.indexOf(i) >= 0) continue;
    drawStar(ctx, STARS[i], time);
  }
  for (const idx of SPARKLE_IDX) {
    if (idx >= 0 && idx < STARS.length) drawSparkle(ctx, STARS[idx], time);
  }

  // 2) 月亮
  drawMoon(ctx, time);

  // 3) 云（缓慢右漂，取模回绕）
  const sec = time / 1000;
  for (const c of CLOUDS) {
    let x = Math.round((c.phase + c.speed * sec) % (VW + 120));
    if (x < -60) x += VW + 120;
    // 云在山脉之上、月亮之下：透明度随高度略变
    const alpha = c.y < 70 ? 0.16 : 0.22;
    drawCloud(ctx, x, c.y, c.scale, alpha);
  }
}
