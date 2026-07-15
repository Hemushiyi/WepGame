// ===== 飞镖盘 + 支架（像素风） =====
// 仅依赖契约与共享类型。坐标全部取整。

import {
  BOARD_CENTER,
  GROUND_Y,
  PAL,
  pixelCircle,
  pixelCircleRing,
  pixelEllipse,
  pixelLine,
  pixelRect,
  rnd,
  type SceneEnv,
} from '../render/contract';

/** 基于索引的确定性伪随机（LCG），避免全局随机。 */
function lcg(seed: number): number {
  // 返回 0..1
  let s = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (s % 100000) / 100000;
}

/** 把 PAL 键解析为实际颜色字符串（drawSprite 以外的工具需要显式颜色）。 */
function col(key: string): string {
  return PAL[key] ?? PAL.k;
}

/** 从圆心向外的金属/木框斜面条带：左上亮、右下暗。 */
function drawFrame(
  env: SceneEnv,
  cx: number,
  cy: number,
  outer: number,
): void {
  const { ctx } = env;
  // 深色描边（最外圈）
  pixelCircle(ctx, cx, cy, Math.round(outer + 2), col('K'));

  // 整框底色：深木色 N
  pixelCircle(ctx, cx, cy, Math.round(outer), col('N'));

  // 斜向高光：左上一圈偏亮木色 n
  pixelCircleRing(ctx, cx - 1, cy - 1, Math.round(outer - 1), col('n'));
  // 斜向暗边：右下一圈最深 K
  pixelCircleRing(ctx, cx + 1, cy + 1, Math.round(outer - 1), col('K'));
}

/**
 * 绘制一面精致的像素飞镖盘及其支架。
 * 半径全部来自 env.stats，保证“放大中心”技能肉眼可见。
 */
export function drawBoard(env: SceneEnv): void {
  const { ctx, stats } = env;
  const cx = rnd(BOARD_CENTER.x);
  const cy = rnd(BOARD_CENTER.y);

  // 半径下限保护：保证层层嵌套且即便技能让 centerRadius 接近 r2 也不报错。
  const centerRadius = Math.max(2, rnd(stats.centerRadius));
  const r2 = Math.max(centerRadius + 2, rnd(stats.r2));
  const r3 = Math.max(r2 + 3, rnd(stats.r3));
  const r4 = Math.max(r3 + 3, rnd(stats.r4));

  // ---------- 1. 地面投影 ----------
  // 盘下方地面上的半透明椭圆阴影。
  const shadowRx = Math.round(r4 * 0.9);
  const shadowRy = Math.max(3, Math.round(r4 * 0.18));
  ctx.globalAlpha = 0.32;
  pixelEllipse(ctx, cx, rnd(GROUND_Y) + 2, shadowRx, shadowRy, col('K'));
  ctx.globalAlpha = 1;

  // ---------- 2. 支架（木桩 + 底座） ----------
  // 木桩从盘底中心向下，到地面之上。
  const postTop = cy + Math.round(r4);
  const postBottom = rnd(GROUND_Y) - 1;
  const postW = 10;
  const postX = cx - Math.round(postW / 2);
  if (postBottom > postTop) {
    // 木桩主体（深木色）
    pixelRect(ctx, postX, postTop, postW, postBottom - postTop, col('N'));
    // 左侧高光（亮木色）
    pixelRect(ctx, postX, postTop, 2, postBottom - postTop, col('n'));
    // 右侧暗边（最深）
    pixelRect(ctx, postX + postW - 2, postTop, 2, postBottom - postTop, col('K'));
    // 顶部一小块连接盘底的暗色
    pixelRect(ctx, postX, postTop, postW, 2, col('K'));
  }

  // 底座：双脚小三角（用 pixelLine 画两个三角斜面）。
  const baseW = 26;
  const baseH = 6;
  const baseCx = cx;
  const baseTopY = postBottom;
  const baseBottomY = Math.min(rnd(GROUND_Y), baseTopY + baseH);
  // 底座主体（中木色矩形条）
  pixelRect(
    ctx,
    baseCx - Math.round(baseW / 2),
    baseTopY,
    baseW,
    baseBottomY - baseTopY,
    col('N'),
  );
  // 左脚斜面（亮木色）
  pixelLine(
    ctx,
    baseCx - Math.round(baseW / 2),
    baseBottomY,
    baseCx - Math.round(baseW / 2) + 4,
    baseTopY,
    col('n'),
  );
  // 右脚斜面（暗色）
  pixelLine(
    ctx,
    baseCx + Math.round(baseW / 2),
    baseBottomY,
    baseCx + Math.round(baseW / 2) - 4,
    baseTopY,
    col('K'),
  );
  // 底座顶面高光
  pixelRect(
    ctx,
    baseCx - Math.round(baseW / 2),
    baseTopY,
    baseW,
    1,
    col('n'),
  );

  // ---------- 3. 外框（金属/木框） ----------
  drawFrame(env, cx, cy, r4 + 6);

  // ---------- 4. 盘面分区（从外到内填色） ----------

  // 4a. r4 整圆：浅扇区底色 q
  pixelCircle(ctx, cx, cy, r4, col('q'));

  // 4b. r3 圆：叠深扇区底色 Q（形成外环深、内圆浅的基底）
  pixelCircle(ctx, cx, cy, r3, col('Q'));

  // 4c. r2 圆：浅色 q（内圆恢复浅色，使 r2..r3 之间形成深环）
  pixelCircle(ctx, cx, cy, r2, col('q'));

  // ---------- 5. 双倍/三倍环装饰 ----------
  // 在 r3 附近（三倍环）画一条细绿环；在 r4 内侧（双倍环）画一条细红环。
  // 用两条同心 pixelCircleRing 相近半径相减出 2px 宽的环带感。
  const tripleMid = r3;
  const doubleMid = r4 - 2;
  // 三倍环（绿 a）—— 加粗到 3px，让倍率色带醒目可辨
  pixelCircleRing(ctx, cx, cy, tripleMid, col('a'));
  pixelCircleRing(ctx, cx, cy, tripleMid - 1, col('a'));
  pixelCircleRing(ctx, cx, cy, tripleMid - 2, col('a'));
  // 双倍环（红 A）
  pixelCircleRing(ctx, cx, cy, doubleMid, col('A'));
  pixelCircleRing(ctx, cx, cy, doubleMid - 1, col('A'));
  pixelCircleRing(ctx, cx, cy, doubleMid - 2, col('A'));

  // ---------- 6. 钢丝（辐条 + 同心环） ----------
  // 6a. 20 根辐条：每 18 度一根，从圆心到 r4，颜色 c。
  for (let i = 0; i < 20; i++) {
    const ang = (i * 18 * Math.PI) / 180;
    const ex = cx + Math.cos(ang) * r4;
    const ey = cy + Math.sin(ang) * r4;
    pixelLine(ctx, cx, cy, ex, ey, col('c'));
  }
  // 6b. r2 / r3 / r4 三圈细环。
  pixelCircleRing(ctx, cx, cy, r2, col('c'));
  pixelCircleRing(ctx, cx, cy, r3, col('c'));
  pixelCircleRing(ctx, cx, cy, r4, col('c'));

  // ---------- 7. 靶心：内牛红心 + 外牛绿环（实心填色，让中心一目了然） ----------
  const innerR = Math.max(2, centerRadius - 6);
  pixelCircle(ctx, cx, cy, centerRadius, col('a')); // 外牛：绿环
  pixelCircle(ctx, cx, cy, innerR, col('A')); // 内牛：红心
  pixelCircleRing(ctx, cx, cy, centerRadius, col('c')); // 钢丝圈勾勒边界
  pixelCircleRing(ctx, cx, cy, innerR, col('c'));

  // ---------- 8. 高光（盘面左上方沿弧线的亮白点） ----------
  // 用基于索引的确定性伪随机决定弧上若干亮白像素位置。
  const hlCount = 5;
  const hlArcStart = Math.PI * 1.15; // 左上方
  const hlArcSpan = Math.PI * 0.5;
  for (let i = 0; i < hlCount; i++) {
    const t = lcg(i * 31 + 7);
    const ang = hlArcStart + t * hlArcSpan;
    const rr = r4 - 2 - lcg(i * 17 + 3) * 3;
    const hx = rnd(cx + Math.cos(ang) * rr);
    const hy = rnd(cy + Math.sin(ang) * rr);
    pixelRect(ctx, hx, hy, 1, 1, col('w'));
  }
  // 一点更强的镜面反光在靶心左上
  const specAng = Math.PI * 1.35;
  const specR = Math.max(1, centerRadius - 2);
  const sx = rnd(cx + Math.cos(specAng) * specR);
  const sy = rnd(cy + Math.sin(specAng) * specR);
  pixelRect(ctx, sx, sy, 1, 1, col('w'));
}
