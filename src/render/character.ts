// ===== 角色与宠物渲染（像素风） =====
// 唯一允许的引入：本渲染契约 + 类型。
import {
  drawSprite,
  pixelEllipse,
  pixelLine,
  PAL,
} from '../render/contract';
import type { SceneEnv } from '../render/contract';

// ---------- 确定性伪随机（LCG，按索引） ----------
// 全局禁用随机；本文件的动画全部基于 env.time 的正弦，确定性且稳定。
// 保留一个基于索引种子的 LCG，供后续给角色加确定性微抖动时直接复用。
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
// 占位调用，避免未来接入前的“未使用”困扰，并演示它是基于索引的确定性序列。
const _petJitter = lcg(7);
void _petJitter;

// ---------- 角色位图 ----------
// 宽 16 × 高 24，scale=2 -> 32x48 像素（落在 44~52 高的目标区间）。
// 颜色字符（见 PAL）：k/K 描边、s/S 肤、h/H 发、b/B 蓝衣、y 头带、
// w/W 眼白、N/n 裤鞋、e 飞镖高光。
// 角色朝右绘制；flipX 由 drawSprite 处理。
// 每行严格 16 字符。

// idle 帧：双臂自然垂下，右手持镖于身侧（镖杆藏于身侧，不外伸）。
const CHAR_IDLE: string[] = [
  '....kkkkk.......',
  '...khhhhhhk.....',
  '..khHHHHHHk.....',
  '..khHHHHHHHk....',
  '..khHHHHHHHk....',
  '..ksssssssssk...',
  '..ksssssssssk...',
  '..kswWsssWwsk...',
  '..ksssssssssk...',
  '..ksssssssssk...',
  '...ksssssssk....',
  '...kyyBBBBByk...',
  '.kBBBBBBBBBBBk..',
  'ksBbbbbbbbbbSk..',
  'kSBbbbbbbbbbBsk.',
  'ksBbbbbbbbbbSk..',
  'kSbbbbbbbbbbbSk.',
  '.kBBBBBBBBBBBk..',
  '..kNNNNNNNNNk...',
  '..kNNNNNNNNNk...',
  '..kNNN..NNNk....',
  '..kNNN..NNNk....',
  '.kNNNk..kNNNk...',
  'kkkkk...kkkkk...',
];

// throw 帧：右臂向右上方探出，sprite 内右手末端在右上角；
// 实际“飞镖起飞点”由 drawCharacter 用 pixelLine 继续延伸至合同 CHAR_HAND 附近。
const CHAR_THROW: string[] = [
  '....kkkkk.......',
  '...khhhhhhk.....',
  '..khHHHHHHk.....',
  '..khHHHHHHHk....',
  '..khHHHHHHHk...e',
  '..ksssssssssk..N',
  '..ksssssssssk..n',
  '..ksswWsswWsk.sn',
  '..kssssssssskNSs',
  '..ksssssssssk.S.',
  '...ksssssssk.S..',
  '...kyyBBBBBykS..',
  '.kBBBBBBBBBBBk..',
  'ksBbbbbbbbbbSk..',
  'kSBbbbbbbbbbBsk.',
  'ksBbbbbbbbbbSk..',
  'kSbbbbbbbbbbbSk.',
  '.kBBBBBBBBBBBk..',
  '..kNNNNNNNNNk...',
  '..kNNNNNNNNNk...',
  '..kNNN..NNNk....',
  '..kNNN..NNNk....',
  '.kNNNk..kNNNk...',
  'kkkkk...kkkkk...',
];

const CHAR_SCALE = 2;
const CHAR_W = CHAR_IDLE[0].length * CHAR_SCALE; // 32
const CHAR_H = CHAR_IDLE.length * CHAR_SCALE; // 48

/**
 * 绘制角色（左侧投手）。
 * - idle 帧内置 1~2px 正弦上下浮动；throw 帧不浮动。
 * - 脚下绘制柔和椭圆阴影（半透明深色，比脚稍宽）。
 * - throw 帧额外用 pixelLine 把 sprite 内的投掷手末端连向合同 CHAR_HAND 附近，
 *   让飞镖起飞点视觉上连贯（飞镖杆 n/N + 高光 e）。
 */
export function drawCharacter(
  env: SceneEnv,
  feetX: number,
  feetY: number,
  frame: 'idle' | 'throw',
  flipX: boolean,
): void {
  const ctx = env.ctx;

  // idle 浮动：幅度约 2px，周期 ~1.2s（Math.round 保证像素锐利）。
  let bob = 0;
  if (frame === 'idle') {
    bob = Math.round(Math.sin((env.time / 600) * Math.PI * 2) * 1.5); // -2..2
  }

  // ---- 脚下阴影 ----
  const shadowCx = Math.round(feetX);
  const shadowCy = Math.round(feetY - 1);
  ctx.save();
  ctx.globalAlpha = 0.34;
  pixelEllipse(ctx, shadowCx, shadowCy, 14, 4, PAL['K']);
  ctx.restore();

  // ---- 角色本体 ----
  // sprite 水平居中于 feetX，垂直脚底对齐 feetY（再叠加 bob）。
  const sx = Math.round(feetX - CHAR_W / 2);
  const sy = Math.round(feetY - CHAR_H) + bob;

  const sprite = frame === 'throw' ? CHAR_THROW : CHAR_IDLE;
  drawSprite(ctx, sprite, sx, sy, CHAR_SCALE, flipX);

  // ---- throw 帧：延伸投掷手 + 飞镖杆至 CHAR_HAND 附近 ----
  // sprite 内右手末端像素约在 (sx + 15*2, sy + 8*2) = (sx+30, sy+16)。
  // 用 pixelLine 画一段肤色短臂 + 飞镖杆，把视觉落点带到合同 CHAR_HAND。
  if (frame === 'throw') {
    const handSprX = sx + 30;
    const handSprY = sy + 16;
    // 目标：相对 feetX 向右约 30px、约 feetY-26（对齐 CHAR_HAND 的方向）。
    const targetX = Math.round(feetX + 30);
    const targetY = Math.round(feetY - 26);
    // 飞镖杆（木质）：从 sprite 手末端连到目标。
    if (!flipX) {
      pixelLine(ctx, handSprX, handSprY, targetX, targetY, PAL['n']);
      // 飞镖高光（沿杆上沿）。
      pixelLine(ctx, handSprX, handSprY - 1, targetX, targetY - 1, PAL['e']);
      // 镖尖小高光点。
      pixelLine(ctx, targetX, targetY, targetX, targetY, PAL['e']);
    } else {
      // 翻转朝左：镜像到左侧。
      const handSprXL = sx + CHAR_W - 30;
      const targetXL = Math.round(feetX - 30);
      pixelLine(ctx, handSprXL, handSprY, targetXL, targetY, PAL['n']);
      pixelLine(ctx, handSprXL, handSprY - 1, targetXL, targetY - 1, PAL['e']);
      pixelLine(ctx, targetXL, targetY, targetXL, targetY, PAL['e']);
    }
  }
}

// ---------- 宠物位图 ----------
// 一只圆滚滚的小史莱姆：宽 12 × 高 11，scale=2 -> 24x22 像素（目标 18~22 高）。
// 颜色：p/P 紫、w 眼白、k 描边、r 腮红、e 高光。每行严格 12 字符。

// 睁眼帧
const PET_BASE: string[] = [
  '...kkkkkk...',
  '..kppppppk..',
  '.kppppppPpk.',
  '.kppepppppk.',
  '.kppppppppk.',
  '.kpwkppwpkk.',
  '.kpwwpwwpwk.',
  '.kppppppppk.',
  '.kprkpprpkp.',
  '.kppppppppk.',
  'kkkkkkkkkkkk',
];

// 眨眼帧（眼睛压成短横）
const PET_BLINK: string[] = [
  '...kkkkkk...',
  '..kppppppk..',
  '.kppppppPpk.',
  '.kppepppppk.',
  '.kppppppppk.',
  '.kpwwpwwpwk.',
  '.kppppppppk.',
  '.kppppppppk.',
  '.kprkpprpkp.',
  '.kppppppppk.',
  'kkkkkkkkkkkk',
];

const PET_SCALE = 2;
const PET_W = PET_BASE[0].length * PET_SCALE; // 24
const PET_H = PET_BASE.length * PET_SCALE; // 22

/**
 * 绘制宠物（可爱小史莱姆）。
 * - phase（调用方传 env.time）做闲置：身体轻微上下浮动（1px）+ 周期性眨眼。
 * - 脚下椭圆阴影；浮动越高阴影略小，制造轻微景深感。
 */
export function drawPet(env: SceneEnv, feetX: number, feetY: number, phase: number): void {
  const ctx = env.ctx;

  // 浮动：1px 正弦，周期 ~0.9s。
  const floatY = Math.round(Math.sin((phase / 450) * Math.PI * 2)); // -1..1
  // 轻微挤压感：仅在波谷处整体下移 1px（保持像素锐利，不缩放）。
  const squish = Math.sin((phase / 450) * Math.PI * 2) < 0 ? 1 : 0;
  const bob = floatY - squish + 1; // 基线 +1，使其总体微微离地

  // 眨眼：每 ~2.2s 眨一次，持续约 120ms。
  const blinkCycle = (phase % 2200) / 2200;
  const blinking = blinkCycle < 0.055;
  const sprite = blinking ? PET_BLINK : PET_BASE;

  // ---- 脚下阴影 ----
  const shadowCx = Math.round(feetX);
  const shadowCy = Math.round(feetY - 1);
  ctx.save();
  ctx.globalAlpha = 0.3;
  // 浮起（bob>0）时阴影略收，营造离地感。
  const lift = bob > 1 ? 1 : 0;
  pixelEllipse(ctx, shadowCx, shadowCy, 9 - lift, 3 - lift, PAL['K']);
  ctx.restore();

  // ---- 宠物本体 ----
  const sx = Math.round(feetX - PET_W / 2);
  const sy = Math.round(feetY - PET_H) + bob;

  drawSprite(ctx, sprite, sx, sy, PET_SCALE, false);
}
