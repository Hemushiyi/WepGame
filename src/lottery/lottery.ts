import { GameState, LOTTO_UNLOCK_TOTAL } from '../shared/state';
import { audio } from '../shared/audio';
import type { LottoStats } from '../shared/types';
import {
  TIERS,
  VARIANTS,
  topPrize,
  genBoard,
  evalBoard,
  type TierDef,
  type Sym,
  type VariantId,
} from './engine';

// ===== 刮刮乐（彩票）UI =====
// 纯概率 / 生成 / 复盘逻辑全部在 ./engine（无 DOM，便于仿真验证 RTP）。
// 本文件只负责：模态 DOM、购买流程、刮开交互、画布渲染（卡面 + 涂层）、结算反馈。
//
// 幸运值（pity，按档位独立累计）：该档连续未中 +1、中奖清零、封顶 maxPity；
// 每点小幅抬升该档中奖概率。整体见 engine 的 SIM 注释。

// ---------- 画布布局常量 ----------
const CW = 340;
const CH = 400;
const REVEAL_THRESHOLD = 0.5; // 刮开超过 50% 自动揭晓

// 覆盖率网格：解析法统计已刮面积，替代 getImageData 像素读回。
// 像素读回在 GPU 合成画布上会触发同步 GPU→CPU 回读，配合高频 pointermove
// 可把主线程占满 → 整页卡死。解析法零读回、O(1) 判定，彻底消除该卡顿源。
const COVER_CELL = 10; // 每格 10 背板像素
const COVER_COLS = CW / COVER_CELL; // 34
const COVER_ROWS = CH / COVER_CELL; // 40
const COVER_TOTAL = COVER_COLS * COVER_ROWS;

// ---------- 玩区几何（格子摆放的可用矩形 + 中心）----------
// 卡面内：标题条之下、底注之上的区域。各玩法 layout 把格子下标映射到这里。
const PLAY_TOP = 58;
const PLAY_BOTTOM = CH - 26; // 374
const PLAY_CX = CW / 2; // 170
const PLAY_CY = (PLAY_TOP + PLAY_BOTTOM) / 2; // 216

/** 一个格子在背板坐标系（CW×CH）中的矩形。layout 注册表产出此数组供 drawCard 消费 */
type CellRect = { x: number; y: number; w: number; h: number };

/** hex(#rrggbb) + alpha → rgba() 字符串（卡面叠加档位色用） */
function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

/** hex 颜色按 amt 混入白(>0)/黑(<0)，返回 rgb()，用于马赛克瓷砖高光/暗边 */
function shade(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  let r = parseInt(h.slice(0, 2), 16);
  let g = parseInt(h.slice(2, 4), 16);
  let b = parseInt(h.slice(4, 6), 16);
  if (amt >= 0) {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  } else {
    r *= 1 + amt;
    g *= 1 + amt;
    b *= 1 + amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/** 像素图：'X'=主色，'O'=暗色（高光/阴影/孔），' '=透明 */
interface PixelIcon {
  grid: string[];
  color: string;
  dark?: string;
}

/** 把像素图画到 (cx,cy) 为中心、边长约 size 的方框内，每格一个硬边小方块 */
function drawPixels(
  ctx: CanvasRenderingContext2D,
  icon: PixelIcon,
  cx: number,
  cy: number,
  size: number,
): void {
  const rows = icon.grid.length;
  const cols = icon.grid[0].length;
  const px = size / Math.max(rows, cols);
  const w = cols * px;
  const h = rows * px;
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const step = Math.max(1, Math.ceil(px));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = icon.grid[r][c];
      if (ch === ' ' || ch === '.') continue;
      ctx.fillStyle = ch === 'O' ? icon.dark || '#000' : icon.color;
      const gx = Math.round(x0 + c * px);
      const gy = Math.round(y0 + r * px);
      // 像素块之间留 1px 暗底间隙（格线），让密排的 16×16 图案块块分明、辨识清晰
      const gap = step > 1 ? 1 : 0;
      ctx.fillRect(gx + gap, gy + gap, step - gap, step - gap);
    }
  }
}

/** emoji → 像素图。未收录的符号回退为 emoji 字体。逐档逐步补全。 */
const PIXEL_ICONS: Record<string, PixelIcon> = {
  // 金币（铜钱：金圈 + 方孔）
  '🪙': {
    color: '#ffd45e', dark: '#9a6a14',
    grid: [
      '..XXXX..',
      '.XXXXXX.',
      'XX.OO.XX',
      'X..OO..X',
      'X..OO..X',
      'XX.OO.XX',
      '.XXXXXX.',
      '..XXXX..'
    ],
  },
  // 钻石（青，右下暗面）
  '💎': {
    color: '#7df9ff', dark: '#2a7fa0',
    grid: [
      '...XX...',
      '..XXXX..',
      '.XXXXXX.',
      'XXXXXOOO',
      '.XXXOOO.',
      '..XOOO..',
      '...OO...',
      '........'
    ],
  },
  // 星星（五角星近似）
  '⭐': {
    color: '#ffd45e', dark: '#c98a1f',
    grid: [
      '...XX...',
      '...XX...',
      '.XXXXXX.',
      'XXXXXXXX',
      '.XXXXXX.',
      '..XXXX..',
      '.XX..XX.',
      'X......X'
    ],
  },
  // 屎
  '💩': {
    color: '#a06a2e', dark: '#6a4418',
    grid: [
      '..X..X..',
      '..X..X..',
      '.XXXXXX.',
      'XOOOOOOX',
      'XOOXXOOX',
      'XOOOOOOX',
      '.XXXXXX.',
      '..XXXX..'
    ],
  },
  // 7（红字）
  '7️⃣': {
    color: '#e84753', dark: '#7a1f26',
    grid: [
      'XXXXXX..',
      'X....X..',
      '....XX..',
      '...XX...',
      '..XX....',
      '..XX....',
      '..XX....',
      '........'
    ],
  },
  // 火焰（橙红 + 黄内焰）
  '🔥': {
    color: '#ff6b35', dark: '#ffd45e',
    grid: [
      '...X....',
      '..XOX...',
      '..XOX...',
      '.XOOOX..',
      'XXOOOXX.',
      '.XOOOX..',
      '..XXX...',
      '...X....'
    ],
  },
  // 闪电
  '⚡': {
    color: '#ffe14d', dark: '#c9a824',
    grid: [
      '..XXXX..',
      '..X.....',
      '.XX.....',
      'XXXXX...',
      '.XXX....',
      '...X....',
      '...XX...',
      '....X...'
    ],
  },
  // 炸弹（深灰弹 + 引线）
  '💣': {
    color: '#3a3a4a', dark: '#b8861f',
    grid: [
      '......X.',
      '.....XX.',
      '....XX..',
      '.XXXXXX.',
      'XXXXXXX.',
      'XXXXXXX.',
      'XXXXXXX.',
      '.XXXXXX.'
    ],
  },
  // 加号（gold rush）
  '➕': {
    color: '#ffd45e',
    grid: [
      '...XX...',
      '...XX...',
      '...XX...',
      'XXXXXXX.',
      'XXXXXXX.',
      '...XX...',
      '...XX...',
      '........'
    ],
  },
  // 三叶草
  '🍀': {
    color: '#4caf50', dark: '#2e6e30',
    grid: [
      '..XX.X..',
      '.XXXXX..',
      '.XXXXX..',
      '..XXX.X.',
      '...XX...',
      '...XX...',
      '..X..X..',
      '........'
    ],
  },
  // 绿心
  '💚': {
    color: '#4caf50', dark: '#2e6e30',
    grid: [
      '.XX.XX..',
      'XXXXXXX.',
      'XXXXXXX.',
      'XXXXXXX.',
      '.XXXXX..',
      '..XXX...',
      '...X....',
      '........'
    ],
  },
  // 菱形宝石
  '💠': {
    color: '#5ad6ff', dark: '#1a6a8a',
    grid: [
      '...XX...',
      '..XXXX..',
      '.XXXXXX.',
      'XXXOOXXX',
      '.XXOOO..',
      '..XOO...',
      '...OO...',
      '........'
    ],
  },
  // 闪星（带光芒）
  '🌟': {
    color: '#ffe14d', dark: '#c9a824',
    grid: [
      '...X....',
      '...X....',
      '.XXXXX..',
      'XXXXXXX.',
      '.XXXXX..',
      '.X.X.X..',
      'X..X..X.',
      '........'
    ],
  },
  // 仙人掌
  '🌵': {
    color: '#5fa85a', dark: '#3a6a35',
    grid: [
      '..XX..X.',
      '..XX.XX.',
      '..XXXXX.',
      '.X.XX.X.',
      '...XX...',
      '...XX...',
      '.XXXXXX.',
      '...XX...'
    ],
  },
  // 水晶球
  '🔮': {
    color: '#c061e0', dark: '#6a3a8a',
    grid: [
      '...XX...',
      '..XXXX..',
      '.XXXXXX.',
      'XXXOOXXX',
      'XXXOOXXX',
      '.XXXXXX.',
      '.XXXXXX.',
      '.XXXXXX.'
    ],
  },
  // 紫心
  '💜': {
    color: '#c061e0', dark: '#6a3a8a',
    grid: [
      '.XX.XX..',
      'XXXXXXX.',
      'XXXXXXX.',
      'XXXXXXX.',
      '.XXXXX..',
      '..XXX...',
      '...X....',
      '........'
    ],
  },
  // 外星人
  '👾': {
    color: '#8be060', dark: '#2a3a1a',
    grid: [
      '..XXXX..',
      '.X.XX.X.',
      'X.XXXX.X',
      'XXXXXXXX',
      'X.XXXX.X',
      '.X.XX.X.',
      '.X.XX.X.',
      '..X..X..'
    ],
  },
  // 病毒
  '🦠': {
    color: '#7ac050', dark: '#3a6a20',
    grid: [
      '.X....X.',
      'XX.X..XX',
      '.XXXXXX.',
      '.XXXXX..',
      '.XXXXXX.',
      'XX.X..XX',
      '.X....X.',
      '........'
    ],
  },
  // 红心
  '❤️': {
    color: '#e84753', dark: '#7a1f26',
    grid: [
      '.XX.XX..',
      'XXXXXXX.',
      'XXXXXXX.',
      'XXXXXXX.',
      '.XXXXX..',
      '..XXX...',
      '...X....',
      '........'
    ],
  },
  // 皇后（棋后）
  '♛': {
    color: '#e8e8f0', dark: '#6a6a8a',
    grid: [
      'X.X.X.X.',
      'XXXXXXX.',
      'XOXXXOX.',
      'XXXXXXX.',
      'XXXXXXX.',
      'XXXXXXX.',
      'XXXXXXX.',
      'XXXXXXX.'
    ],
  },
  // 皇冠
  '👑': {
    color: '#ffd45e', dark: '#b8861f',
    grid: [
      'X.X.X.X.',
      'XXXXXXX.',
      'XOXXXOX.',
      'XXXXXXX.',
      'XXXXXXX.',
      'XXXXXXX.',
      'XXXXXXX.',
      'XXXXXXX.'
    ],
  },
  // 血滴
  '🩸': {
    color: '#c01828', dark: '#6a0a14',
    grid: [
      '...X....',
      '..XXX...',
      '.XXXXX..',
      'XXXXXXX.',
      'XXXXXXX.',
      '.XXXXX..',
      '..XXX...',
      '...X....'
    ],
  },
};

// ============ 每档差异化排列（layout 注册表）============
// engine 的玩法逻辑（gen/eval/idle）只认 flat index，与屏幕坐标正交；
// 这里把每个 index 映射成背板矩形，让 6 档排列样式截然不同（不再都是田字格）。
// 禁用 Math.random：drawCard 在 idle/购买/结算都会重绘，随机会让格子跳位。

/** 由中心 + 尺寸造居中方矩形 */
function rectCenter(cx: number, cy: number, s: number): CellRect {
  return { x: cx - s / 2, y: cy - s / 2, w: s, h: s };
}

/** 铜票 match3 —— 老虎机卷轴：3 条竖卷轴，竖格 + 宽卷轴缝（卷轴缝>行缝 → 读作卷轴） */
function layoutReels(): CellRect[] {
  const reelW = 90, reelGap = 23, rowGap = 12, cellH = 95;
  const reelPitch = reelW + reelGap;
  const rowPitch = cellH + rowGap;
  const ox = (CW - (3 * reelW + 2 * reelGap)) / 2;
  const oy = PLAY_TOP + ((PLAY_BOTTOM - PLAY_TOP) - (3 * cellH + 2 * rowGap)) / 2;
  const rects: CellRect[] = [];
  for (let i = 0; i < 9; i++) {
    const reel = i % 3, row = Math.floor(i / 3);
    rects.push({ x: ox + reel * reelPitch, y: oy + row * rowPitch, w: reelW, h: cellH });
  }
  return rects;
}

/** 银票 line —— 菱形：3×3 网格转 45°。8 条连线（3 行/3 列/2 对角）仍为屏幕直线
 *  （主对角 0,4,8 → 竖线，副对角 2,4,6 → 横线），idle 预览即一条竖线。 */
function layoutDiamond(): CellRect[] {
  const step = 57, s = 78;
  const rects: CellRect[] = [];
  for (let i = 0; i < 9; i++) {
    const r = Math.floor(i / 3), c = i % 3;
    const dx = c - r, dy = c + r; // dx∈[-2,2], dy∈[0,4]
    rects.push(rectCenter(PLAY_CX + dx * step, PLAY_CY + (dy - 2) * step, s));
  }
  return rects;
}

/** 金票 rush —— 散落金币堆：3×3 基底 + 固定抖动表（确定性，无随机） */
const RUSH_JITTER: ReadonlyArray<[number, number, number]> = [
  [-6, -4, -4], [5, 3, 0], [-3, 6, 4],
  [7, -5, 0], [-4, 2, -4], [4, 5, 4],
  [-5, -3, 4], [6, 4, 0], [3, -6, -4],
];
function layoutPile(): CellRect[] {
  const baseCx = [70, 170, 270];
  const baseCy = [116, 216, 316];
  const baseSize = 76;
  const rects: CellRect[] = [];
  for (let i = 0; i < 9; i++) {
    const r = Math.floor(i / 3), c = i % 3;
    const [jx, jy, js] = RUSH_JITTER[i];
    rects.push(rectCenter(baseCx[c] + jx, baseCy[r] + jy, baseSize + js));
  }
  return rects;
}

/** 翡翠票 corners —— 画框：4 大角(发光) + 8 边格 + 4 内格中心簇（4+8+4=16）。
 *  4 角 flat index 0,3,12,15 → 视觉四角，呼应 idleCorners 把四角写成中奖演示。 */
function layoutFrame(): CellRect[] {
  const rects: CellRect[] = new Array(16);
  const big = 72, small = 42;
  // 4 角
  rects[0] = rectCenter(52, 98, big);
  rects[3] = rectCenter(288, 98, big);
  rects[12] = rectCenter(52, 334, big);
  rects[15] = rectCenter(288, 334, big);
  // 8 边：上(1,2)/下(13,14) 各 2 个；左(4,8)/右(7,11) 各 2 个
  for (const x of [131, 209]) {
    rects[x === 131 ? 1 : 2] = rectCenter(x, 98, small);
    rects[x === 131 ? 13 : 14] = rectCenter(x, 334, small);
  }
  for (const y of [177, 255]) {
    rects[y === 177 ? 4 : 8] = rectCenter(52, y, small);
    rects[y === 177 ? 7 : 11] = rectCenter(288, y, small);
  }
  // 4 内：中心 2×2 簇
  rects[5] = rectCenter(145, 191, small);
  rects[6] = rectCenter(195, 191, small);
  rects[9] = rectCenter(145, 241, small);
  rects[10] = rectCenter(195, 241, small);
  return rects;
}

/** 紫晶票 multiplier —— 靶心：大中心格(index4) + 八环。eval 位置无关，环格任意分配。 */
function layoutBullseye(): CellRect[] {
  const rects: CellRect[] = new Array(9);
  rects[4] = rectCenter(PLAY_CX, PLAY_CY, 100);
  const ringCenters: ReadonlyArray<[number, number]> = [
    [280, 216], [248, 294], [170, 326], [92, 294],
    [60, 216], [92, 138], [170, 106], [248, 138],
  ];
  const ringIdx = [0, 1, 2, 3, 5, 6, 7, 8];
  for (let k = 0; k < 8; k++) {
    rects[ringIdx[k]] = rectCenter(ringCenters[k][0], ringCenters[k][1], 80);
  }
  return rects;
}

/** 红宝石票 fullhouse —— 无缝整墙 4×4 gap=0；中奖全同→整面墙同色=「满堂红」 */
function layoutSolid(): CellRect[] {
  const cell = 79;
  const rects: CellRect[] = [];
  for (let i = 0; i < 16; i++) {
    const r = Math.floor(i / 4), c = i % 4;
    rects.push({ x: 12 + c * cell, y: PLAY_TOP + r * cell, w: cell, h: cell });
  }
  return rects;
}

/** 玩法 → 排列样式。每档一种截然不同的摆法，把各档彩票视觉区分开。 */
const LAYOUTS: Record<VariantId, (t: TierDef) => CellRect[]> = {
  match3: layoutReels,
  line: layoutDiamond,
  rush: layoutPile,
  corners: layoutFrame,
  multiplier: layoutBullseye,
  fullhouse: layoutSolid,
};

/**
 * 刮刮乐 UI：自建模态 DOM 并挂入 #gameRoot（随画面旋转一致）。
 * 调用方提供 onCoins 回调，用于同步 HUD 金币显示。
 */
export class Lottery {
  private state: GameState;
  private onCoins: () => void;
  private onExit: () => void;
  /** 当前是否处于彩票页面（enter→true / leave→false），供 Esc 判定 */
  private active = false;

  private root!: HTMLDivElement;
  private coinsEl!: HTMLDivElement;
  private body!: HTMLDivElement;
  private lockProgress!: HTMLDivElement;
  private lockFill!: HTMLDivElement;
  private tierBar!: HTMLDivElement;
  private reveal!: HTMLCanvasElement;
  private rctx!: CanvasRenderingContext2D;
  private scratch!: HTMLCanvasElement;
  private sctx!: CanvasRenderingContext2D;
  private result!: HTMLDivElement;
  private pill!: HTMLDivElement;
  private buyBtn!: HTMLButtonElement;
  private revealBtn!: HTMLButtonElement;
  private hint!: HTMLDivElement;
  private luckFill!: HTMLDivElement;
  private luckText!: HTMLSpanElement;
  private statsEl!: HTMLDivElement;
  private tierBtns: Record<string, HTMLButtonElement> = {};

  private selected: TierDef = TIERS[0];
  private phase: 'idle' | 'scratching' | 'revealed' = 'idle';
  private settled = false;
  private curGrid: Sym[] | null = null;
  private curTier: TierDef = TIERS[0];
  /** 本张票实付金额（结算记 wagered 用，免费票为 0） */
  private curWager = 0;

  // 刮开交互
  private scratching = false;
  private activePt: number | null = null; // 当前主指 pointerId（多指只认第一根）
  private lastPt: { x: number; y: number } | null = null;
  private pendingPt: { x: number; y: number } | null = null; // rAF 合并用最新点
  private rafErase = 0; // 非零表示已排队一帧擦除
  private viewScale = 1; // 显示尺寸 / 背板尺寸，用于按显示比例缩放擦除半径
  // 覆盖率网格（解析法）
  private covered!: Uint8Array;
  private coveredCount = 0;
  // 计时器
  private revealTimer: number | null = null;
  private countTimer: number | null = null;
  private confettiLayer!: HTMLDivElement;

  constructor(state: GameState, onCoins: () => void, onExit: () => void, mount: HTMLElement) {
    this.state = state;
    this.onCoins = onCoins;
    this.onExit = onExit;
    this.buildDom(mount);
    this.drawIdle();
    this.hint.textContent = this.mechanicHint(this.selected);
    this.refreshBuy();
  }

  // ---------- DOM ----------
  private buildDom(mount: HTMLElement): void {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="lotto-page" id="lottoPage">
        <div class="modal-card lotto-card">
          <div class="modal-head">
            <div class="modal-title">🎰 刮刮乐</div>
            <div class="modal-coins" id="lottoCoins">🪙 0</div>
            <button class="btn-close" id="closeLotto" aria-label="返回关卡选择">🏠</button>
          </div>
          <div class="lotto-body" id="lottoBody">
            <div class="lotto-locked" id="lottoLocked" hidden>
              <div class="lock-icon">🔒</div>
              <div class="lock-title">彩票关卡未解锁</div>
              <div class="lock-progress" id="lottoLockProgress">累计获得 0 / 500</div>
              <div class="lock-track"><div class="lock-fill" id="lottoLockFill"></div></div>
              <div class="lock-hint">继续投飞镖，累计获得 500 金币即可解锁刮刮乐</div>
            </div>
            <div class="lotto-stage" id="lottoStage">
              <canvas id="lottoReveal" width="${CW}" height="${CH}"></canvas>
              <canvas id="lottoScratch" width="${CW}" height="${CH}"></canvas>
              <div class="lotto-result" id="lottoResult"><div class="pill" id="lottoPill"></div></div>
              <div class="lotto-confetti" id="lottoConfetti" aria-hidden="true"></div>
            </div>
            <div class="lotto-side">
              <div class="lotto-tiers" id="lottoTiers"></div>
              <div class="lotto-luck">
                <span>幸运</span>
                <div class="luck-track"><div class="luck-fill" id="luckFill"></div></div>
                <span id="luckText">0/5</span>
              </div>
              <div class="lotto-actions">
                <button id="lottoBuy">购买 🪙30</button>
                <button id="lottoRevealAll" disabled>全部刮开</button>
              </div>
              <div class="lotto-hint" id="lottoHint">选择档位并购买</div>
              <div class="lotto-stats" id="lottoStats"></div>
            </div>
          </div>
        </div>
      </div>`;
    mount.appendChild(wrap.firstElementChild as HTMLElement);

    this.root = mount.querySelector('#lottoPage') as HTMLDivElement;
    this.coinsEl = this.root.querySelector('#lottoCoins') as HTMLDivElement;
    this.body = this.root.querySelector('#lottoBody') as HTMLDivElement;
    this.lockProgress = this.root.querySelector('#lottoLockProgress') as HTMLDivElement;
    this.lockFill = this.root.querySelector('#lottoLockFill') as HTMLDivElement;
    this.tierBar = this.root.querySelector('#lottoTiers') as HTMLDivElement;
    this.reveal = this.root.querySelector('#lottoReveal') as HTMLCanvasElement;
    this.rctx = this.reveal.getContext('2d')!;
    this.scratch = this.root.querySelector('#lottoScratch') as HTMLCanvasElement;
    this.sctx = this.scratch.getContext('2d', { willReadFrequently: true })!;
    this.scratch.style.display = 'none';
    this.result = this.root.querySelector('#lottoResult') as HTMLDivElement;
    this.pill = this.root.querySelector('#lottoPill') as HTMLDivElement;
    this.confettiLayer = this.root.querySelector('#lottoConfetti') as HTMLDivElement;
    this.buyBtn = this.root.querySelector('#lottoBuy') as HTMLButtonElement;
    this.revealBtn = this.root.querySelector('#lottoRevealAll') as HTMLButtonElement;
    this.hint = this.root.querySelector('#lottoHint') as HTMLDivElement;
    this.luckFill = this.root.querySelector('#luckFill') as HTMLDivElement;
    this.luckText = this.root.querySelector('#luckText') as HTMLSpanElement;
    this.statsEl = this.root.querySelector('#lottoStats') as HTMLDivElement;

    // 档位按钮（6 档：横向滚动条）
    for (const t of TIERS) {
      const b = document.createElement('button') as HTMLButtonElement;
      b.className = 'lotto-tier';
      b.innerHTML = `<span class="t-icon">${t.icon}</span>
        <span class="t-name">${t.name}</span>
        <span class="t-cost">🪙${t.cost}</span>
        <span class="t-max">🏆${topPrize(t)}</span>
        <span class="t-odds">${this.oddsLabel(t)}</span>`;
      b.addEventListener('click', () => this.selectTier(t));
      this.tierBar.appendChild(b);
      this.tierBtns[t.id] = b;
    }
    this.tierBtns[this.selected.id].classList.add('active');

    this.root.querySelector('#closeLotto')!.addEventListener('click', () => this.onExit());
    this.buyBtn.addEventListener('click', () => this.buy());
    this.revealBtn.addEventListener('click', () => this.revealAll());
    // Esc 离开彩票页面回关卡选择（键盘/无障碍）
    window.addEventListener('keydown', this.onKeyDown);

    // 刮开交互
    this.scratch.addEventListener('pointerdown', this.onDown);
    this.scratch.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  destroy(): void {
    this.clearRevealTimer();
    this.clearCelebration();
    if (this.rafErase) {
      cancelAnimationFrame(this.rafErase);
      this.rafErase = 0;
    }
    this.scratch.removeEventListener('pointerdown', this.onDown);
    this.scratch.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
  }

  // ---------- 进/离页面（由 ui.ts 的 go() 调用）----------
  /** 进入彩票页面：刷新金币/解锁/档位/空闲卡面。可见性由屏幕路由负责。 */
  enter(): void {
    this.active = true;
    // 进入时回到上次购买的档位（若有记录）
    const last = TIERS.find((t) => t.id === this.state.lotto.lastTier);
    if (last && this.phase !== 'scratching') this.applyTier(last, false);
    audio.sfx('lottoOpen');
    this.refreshUnlock();
    this.syncCoins();
    if (this.state.lottoUnlocked()) {
      this.syncLuck();
      this.syncStats();
      this.refreshBuy();
      if (this.phase !== 'scratching') {
        this.drawIdle();
        this.hint.textContent = this.mechanicHint(this.selected);
      }
    }
  }

  /** 离开彩票页面：若仍在刮且未结算 → 静默结算（按已定结果发奖，不亏待玩家）。 */
  leave(): void {
    this.active = false;
    if (this.phase === 'scratching' && !this.settled) this.settle();
    // 若正处于「全部刮开」淡出的 290ms 窗口内（revealed 但未 settle）→ 立即结算
    this.clearRevealTimer();
    if (this.phase === 'revealed' && !this.settled) this.settle();
    this.scratching = false;
    this.activePt = null;
    this.pendingPt = null;
    audio.stopScratch(); // 离开页面时确保摩擦循环音停止
    if (this.rafErase) {
      cancelAnimationFrame(this.rafErase);
      this.rafErase = 0;
    }
    this.clearCelebration();
  }

  // ---------- 选档 ----------
  private selectTier(t: TierDef): void {
    if (this.phase === 'scratching') return; // 刮奖中不换档
    // 「全部刮开」的 290ms 淡出窗口内（revealed 但未 settle）也禁止换档，
    // 否则 drawIdle 会瞬间覆盖正在淡入的中奖卡面，造成闪屏。
    if (this.phase === 'revealed' && !this.settled) return;
    this.applyTier(t, true);
  }

  /** 切换档位：更新选中态、幸运条（按该档 maxPity 重标）、购买按钮、空闲卡面。
   *  注意：即便金币不足也允许选中，以便玩家预览该档奖金表；购买按钮才是硬门槛。 */
  private applyTier(t: TierDef, redraw: boolean): void {
    const changed = this.selected.id !== t.id;
    this.selected = t;
    for (const id in this.tierBtns) {
      this.tierBtns[id].classList.toggle('active', id === t.id);
    }
    if (changed) audio.sfx('tierSelect', { semi: t.semi });
    this.syncLuck();
    this.refreshBuy();
    if (redraw && this.phase !== 'scratching') {
      this.drawIdle();
      this.hint.textContent = this.mechanicHint(t);
    }
  }

  // ---------- 购买/发牌 ----------
  private buy(): void {
    if (this.phase === 'scratching') return;
    if (!this.state.lottoUnlocked()) return; // 关卡未解锁，防御
    const tier = this.selected;
    const stats = this.lottoStats();
    const cost = this.costFor(tier); // 已扣技能折扣
    if (this.state.coins < cost) {
      this.flash('💰 金币不足，去投飞镖赚金币吧！');
      return;
    }
    if (!this.state.spend(cost)) return;
    // 免费票技能：按概率退回票价（不计入 totalEarned）
    const free = Math.random() < stats.freeTicket;
    this.curWager = free ? 0 : cost;
    if (free) {
      this.state.refund(cost);
      this.flash('🎁 本张免费！');
    }
    audio.sfx('buy', { semi: tier.semi });
    this.onCoins();
    this.syncCoins();

    const deal = genBoard(tier, this.pityFor(tier), stats);
    this.curGrid = deal.grid;
    this.curTier = tier;
    this.settled = false;
    this.result.classList.remove('show', 'win', 'miss');
    this.clearCelebration(); // 清掉上一张的彩纸/计数动画

    this.drawCard(tier, deal.grid, [], this.ruleCaption());
    this.drawCoating();
    this.resetCoverage();
    this.scratch.style.transition = 'none';
    this.scratch.style.opacity = '1';
    this.scratch.style.display = 'block';
    this.scratch.style.pointerEvents = 'auto';

    this.phase = 'scratching';
    this.buyBtn.disabled = true;
    this.revealBtn.disabled = false;
    this.hint.textContent = '用手指刮开涂层 · 或点「全部刮开」';
  }

  private revealAll(): void {
    if (this.phase !== 'scratching') return;
    this.phase = 'revealed';
    this.pendingPt = null;
    audio.stopScratch();
    audio.sfx('revealAll');
    if (this.rafErase) {
      cancelAnimationFrame(this.rafErase);
      this.rafErase = 0;
    }
    this.revealBtn.disabled = true;
    this.scratch.style.transition = 'opacity .28s ease';
    this.scratch.style.opacity = '0';
    this.clearRevealTimer();
    this.revealTimer = window.setTimeout(() => {
      this.revealTimer = null;
      this.scratch.style.display = 'none';
      this.settle();
    }, 290);
  }

  /** 结算：发奖金、记统计/幸运值、高亮中奖格、弹结果 */
  private settle(): void {
    if (this.settled || !this.curGrid) return;
    this.settled = true;
    const tier = this.curTier;
    const stats = this.lottoStats();
    const ev = evalBoard(tier, this.curGrid);
    this.drawCard(tier, this.curGrid, ev.indices, this.ruleCaption());
    // 奖金套用技能倍率：全档 ×(1+prizeMult)，头奖档再 ×(1+jackpotMult)
    const isJackpot = ev.prize >= topPrize(tier);
    const prize =
      ev.prize > 0
        ? Math.round(ev.prize * (1 + stats.prizeMult) * (isJackpot ? 1 + stats.jackpotMult : 1))
        : 0;
    if (prize > 0) this.state.earn(prize);
    // 统计 + 幸运值（中奖清零 / 未中 +1 封顶）
    const pityBefore = this.pityFor(tier);
    this.state.recordLotto(this.curWager, prize, tier.id, this.maxPityFor(tier));
    this.onCoins();
    this.syncCoins();
    this.syncLuck();
    this.syncStats();

    // 音效：头奖 / 各玩法中奖 sting / 未中（+幸运值上升提示）
    if (prize > 0) {
      if (isJackpot) {
        audio.sfx('jackpot', { semi: tier.semi });
        this.state.incAchv('jackpots'); // 成就：彩票头奖
      } else audio.sfx(VARIANTS[tier.variant].winSfx, { semi: tier.semi });
    } else {
      audio.sfx('lottoMiss');
      if (this.pityFor(tier) > pityBefore) audio.sfx('luck');
    }
    this.result.classList.add('show', prize > 0 ? 'win' : 'miss');
    if (prize > 0) {
      this.countUp(prize, isJackpot); // 奖金数字滚动 + 头奖前缀
      this.spawnConfetti(isJackpot); // 中奖彩纸（头奖更密 + 更多 emoji）
    } else {
      this.pill.textContent = '💔 未中';
    }
    this.phase = 'revealed';
    this.refreshBuy();
    this.hint.textContent =
      prize > 0 ? `中奖 +${prize}！可再买一张` : '未中奖，再来一张试试？';
  }

  /** 奖金数字从 0 滚动到 target（easeOutCubic），头奖带 🎰 前缀 */
  private countUp(target: number, isJackpot: boolean): void {
    if (this.countTimer !== null) {
      clearInterval(this.countTimer);
      this.countTimer = null;
    }
    const prefix = isJackpot ? '🎰 头奖 +' : '🎉 +';
    const dur = 550;
    const start = performance.now();
    const step = (): void => {
      const t = Math.min(1, (performance.now() - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      this.pill.textContent = prefix + Math.round(target * eased);
      if (t >= 1 && this.countTimer !== null) {
        clearInterval(this.countTimer);
        this.countTimer = null;
      }
    };
    step();
    this.countTimer = window.setInterval(step, 24);
  }

  /** 在舞台中央撒彩纸；头奖数量更多、emoji 更丰富。每片 animationend 自清理。 */
  private spawnConfetti(isJackpot: boolean): void {
    const emojis = isJackpot
      ? ['🪙', '💎', '⭐', '7️⃣', '✨', '🎉', '🎊']
      : ['🪙', '✨', '🎉'];
    const n = isJackpot ? 38 : 16;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-piece';
      p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      const ang = Math.random() * Math.PI * 2;
      const dist = 50 + Math.random() * (isJackpot ? 230 : 150);
      const tx = Math.cos(ang) * dist;
      const ty = Math.sin(ang) * dist + 70 + Math.random() * 130; // 向下飘 + 重力感
      const rot = Math.random() * 720 - 360;
      p.style.setProperty('--tx', `${tx.toFixed(1)}px`);
      p.style.setProperty('--ty', `${ty.toFixed(1)}px`);
      p.style.setProperty('--rot', `${rot.toFixed(0)}deg`);
      p.style.fontSize = `${13 + Math.random() * 11}px`;
      p.style.animationDelay = `${(Math.random() * 130).toFixed(0)}ms`;
      p.addEventListener('animationend', () => p.remove(), { once: true });
      frag.appendChild(p);
    }
    this.confettiLayer.appendChild(frag);
  }

  /** 清掉彩纸 + 计时器（新买一张 / 关闭时调用） */
  private clearCelebration(): void {
    if (this.countTimer !== null) {
      clearInterval(this.countTimer);
      this.countTimer = null;
    }
    this.confettiLayer.replaceChildren();
  }

  // ---------- 刮开交互 ----------
  /** 指针 → 背板坐标；画布未布局（0 尺寸）时返回 null，避免除零得到 Infinity。
   *  用 getBoxQuads 的四个屏幕角映射，兼容祖先 CSS 变换（如 .game-root.rotated 90°）。 */
  private map(e: PointerEvent): { x: number; y: number } | null {
    const el = this.scratch as HTMLCanvasElement & {
      getBoxQuads?: () => DOMQuad[];
    };
    if (typeof el.getBoxQuads === 'function') {
      try {
        const qs = el.getBoxQuads?.();
        if (qs && qs.length) {
          const q = qs[0];
          const exx = q.p2.x - q.p1.x;
          const exy = q.p2.y - q.p1.y;
          const eyx = q.p4.x - q.p1.x;
          const eyy = q.p4.y - q.p1.y;
          const exLen = Math.hypot(exx, exy);
          const eyLen = Math.hypot(eyx, eyy);
          if (exLen > 0.5 && eyLen > 0.5) {
            this.viewScale = exLen / CW;
            const dx = e.clientX - q.p1.x;
            const dy = e.clientY - q.p1.y;
            const u = (dx * exx + dy * exy) / (exx * exx + exy * exy);
            const v = (dx * eyx + dy * eyy) / (eyx * eyx + eyy * eyy);
            return { x: u * CW, y: v * CH };
          }
        }
      } catch {
        /* 落到 AABB 回退 */
      }
    }
    // 回退：getBoxQuads 不可用时（本机 Chrome 即如此），按祖先是否旋转分两种映射。
    const rect = this.scratch.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const rotated = !!document
      .getElementById('gameRoot')
      ?.classList.contains('rotated');
    if (rotated) {
      // .game-root.rotated 为 rotate(90deg)（顺时针）：canvas 的本地 x 轴朝屏幕 +y，
      // 本地 y 轴朝屏幕 -x，且 AABB 的宽高被交换（rect.width=本地 y 的屏幕跨度，
      // rect.height=本地 x 的屏幕跨度）。据此把屏幕点反算回画布内部坐标。
      this.viewScale = rect.height / CW;
      return {
        x: (e.clientY - rect.top) * (CW / rect.height),
        y: (rect.left + rect.width - e.clientX) * (CH / rect.width),
      };
    }
    // 未旋转：标准轴对齐映射。
    this.viewScale = rect.width / CW;
    return {
      x: (e.clientX - rect.left) * (CW / rect.width),
      y: (e.clientY - rect.top) * (CH / rect.height),
    };
  }

  private onDown = (e: PointerEvent): void => {
    if (this.phase !== 'scratching' || this.activePt !== null) return;
    const p = this.map(e);
    if (!p) return;
    e.preventDefault();
    this.activePt = e.pointerId;
    this.scratching = true;
    try {
      this.scratch.setPointerCapture(e.pointerId);
    } catch {
      /* 部分浏览器忽略，无碍 */
    }
    audio.startScratch(); // 刮开摩擦循环音
    this.lastPt = p;
    this.erase(p.x, p.y);
    this.checkReveal();
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.scratching || e.pointerId !== this.activePt) return;
    const p = this.map(e);
    if (!p) return;
    // 高频 pointermove 合并到一帧 rAF，把擦除工作量封顶在 ~60次/秒，
    // 避免高刷屏/高速划动时每秒上千次 destination-out 填充拖死主线程。
    this.pendingPt = p;
    if (!this.rafErase) this.rafErase = requestAnimationFrame(this.flushErase);
  };

  private flushErase = (): void => {
    this.rafErase = 0;
    if (!this.scratching) return;
    const p = this.pendingPt;
    this.pendingPt = null;
    if (!p) return;
    if (this.lastPt) this.eraseLine(this.lastPt.x, this.lastPt.y, p.x, p.y);
    else this.erase(p.x, p.y);
    this.lastPt = p;
    this.checkReveal();
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePt) return; // 只处理主指抬起
    this.activePt = null;
    this.scratching = false;
    this.lastPt = null;
    this.pendingPt = null;
    audio.stopScratch(); // 抬手即停摩擦音
    if (this.rafErase) {
      cancelAnimationFrame(this.rafErase);
      this.rafErase = 0;
    }
    try {
      this.scratch.releasePointerCapture(e.pointerId);
    } catch {
      /* 已释放或未捕获，无碍 */
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.active) this.onExit();
  };

  /** destination-out 擦出一个软边圆点；半径按显示比例缩放，手指触感一致。
   *  同时把覆盖格标记为已刮（解析法统计面积，无需读回像素）。 */
  private erase(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const ctx = this.sctx;
    const r = Math.max(8, Math.min(60, 24 / this.viewScale));
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.markCovered(x, y, r * 1.35);
  }

  /** 沿线段插值擦除，避免快速划动留缝；步长上限防止极端长线一次性刷太多 */
  private eraseLine(x0: number, y0: number, x1: number, y1: number): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const n = Math.max(1, Math.min(48, Math.ceil(dist / 8)));
    for (let i = 1; i <= n; i++) {
      this.erase(x0 + (dx * i) / n, y0 + (dy * i) / n);
    }
  }

  /** 把擦除圆覆盖到的网格单元标 1，累计 coveredCount。 */
  private markCovered(x: number, y: number, r: number): void {
    const minX = Math.max(0, Math.floor((x - r) / COVER_CELL));
    const maxX = Math.min(COVER_COLS - 1, Math.floor((x + r) / COVER_CELL));
    const minY = Math.max(0, Math.floor((y - r) / COVER_CELL));
    const maxY = Math.min(COVER_ROWS - 1, Math.floor((y + r) / COVER_CELL));
    const r2 = r * r;
    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const cx = gx * COVER_CELL + COVER_CELL / 2;
        const cy = gy * COVER_CELL + COVER_CELL / 2;
        const ddx = cx - x;
        const ddy = cy - y;
        if (ddx * ddx + ddy * ddy <= r2) {
          const idx = gy * COVER_COLS + gx;
          if (!this.covered[idx]) {
            this.covered[idx] = 1;
            this.coveredCount++;
          }
        }
      }
    }
  }

  /** 覆盖率达标即自动揭晓（O(1)，无像素读回） */
  private checkReveal(): void {
    if (this.phase === 'scratching' && this.coveredCount / COVER_TOTAL >= REVEAL_THRESHOLD) {
      this.revealAll();
    }
  }

  /** 重置覆盖网格（每张新票开始时调用） */
  private resetCoverage(): void {
    if (!this.covered) this.covered = new Uint8Array(COVER_TOTAL);
    else this.covered.fill(0);
    this.coveredCount = 0;
  }

  private clearRevealTimer(): void {
    if (this.revealTimer !== null) {
      clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
  }

  // ---------- 渲染 ----------
  private rr(x: number, y: number, w: number, h: number, r: number, ctx = this.rctx): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 规则底注（按选中档位的玩法） */
  private ruleCaption(): string {
    return VARIANTS[this.selected.variant].rule(this.selected);
  }

  /** 侧栏玩法提示：随选中档位玩法变化（不再用 match3 文案占着所有档，让每档机制一目了然） */
  private mechanicHint(t: TierDef): string {
    return `选择档位并购买 · ${VARIANTS[t.variant].rule(t)}`;
  }

  /** 档位中奖率定性标签（基于 winChance）：高频档中奖多、奖金小；低频档反之 */
  private oddsLabel(tier: TierDef): string {
    if (tier.winChance >= 0.28) return '中奖高';
    if (tier.winChance >= 0.21) return '中奖中';
    return '中奖低';
  }

  /** 卡面：外框档位色 + 暗面板 + 标题 + cols×rows 格子 + 中奖高亮 + 底注。
   *  网格大小按 tier.cols/rows 动态计算并居中，3×3/4×4 等通用。 */
  private drawCard(tier: TierDef, grid: Sym[], highlight: number[], caption: string): void {
    const ctx = this.rctx;
    ctx.clearRect(0, 0, CW, CH);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 外框：档位色 + 外发光
    ctx.save();
    ctx.shadowColor = hexA(tier.accent, 0.7);
    ctx.shadowBlur = 18;
    this.rr(0, 0, CW, CH, 16);
    ctx.fillStyle = tier.accent;
    ctx.fill();
    ctx.restore();

    // 内面板：档位色淡染深底，一眼区分铜/银/金/翡翠/紫晶/红宝石
    this.rr(6, 6, CW - 12, CH - 12, 12);
    const grad = ctx.createLinearGradient(0, 0, 0, CH);
    grad.addColorStop(0, shade(tier.accent, -0.55));
    grad.addColorStop(1, shade(tier.accent, -0.85));
    ctx.fillStyle = grad;
    ctx.fill();

    // 标题底条
    this.rr(12, 12, CW - 24, 30, 8);
    const tg = ctx.createLinearGradient(0, 12, 0, 42);
    tg.addColorStop(0, hexA(tier.accent, 0.4));
    tg.addColorStop(1, hexA(tier.accent, 0.12));
    ctx.fillStyle = tg;
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = "12px 'Press Start 2P', monospace";
    ctx.fillText(`${tier.icon} ${tier.name}`, CW / 2, 28);

    // 排列样式：每档玩法自带 layout，把每个 index 映射成背板矩形（差异化排列，
    // 不再统一画成田字格）。rects 长度 == grid 长度（== tier.cols*tier.rows）。
    const rects = LAYOUTS[tier.variant](tier);
    const cornerSet = tier.variant === 'corners' ? new Set([0, 3, 12, 15]) : null;

    for (let i = 0; i < grid.length; i++) {
      const { x, y, w, h } = rects[i];
      const s = grid[i];
      const minDim = Math.min(w, h);

      // 暗格背景 + 细亮顶/左边；corners 的 4 角额外金色发光，呼应「四角同花」
      if (cornerSet && cornerSet.has(i)) {
        ctx.save();
        ctx.shadowColor = hexA(tier.accent, 0.9);
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#15102e';
        ctx.fillRect(x, y, w, h);
        ctx.restore();
      } else {
        ctx.fillStyle = '#15102e';
        ctx.fillRect(x, y, w, h);
      }
      ctx.fillStyle = '#241d4a';
      ctx.fillRect(x, y, w, 2);
      ctx.fillRect(x, y, 2, h);

      // 图案：优先手绘像素图，未收录则回退 emoji（字号逐格缩放）
      const iconDef = PIXEL_ICONS[s.icon];
      if (iconDef) {
        drawPixels(ctx, iconDef, x + w / 2, y + h / 2 + 1, minDim * 0.88);
      } else {
        const fp = Math.max(22, Math.min(52, Math.floor(minDim * 0.52)));
        ctx.font = `${fp}px serif`;
        ctx.fillStyle = '#fff';
        ctx.fillText(s.icon, x + w / 2, y + h / 2 + Math.floor(fp * 0.06));
      }
    }

    // 中奖高亮：金色发光硬边框，按各格实际矩形描边
    for (const i of highlight) {
      const { x, y, w, h } = rects[i];
      ctx.save();
      ctx.shadowColor = '#fff3b0';
      ctx.shadowBlur = 16;
      ctx.strokeStyle = '#fff3b0';
      ctx.lineWidth = 3;
      ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
      ctx.restore();
    }

    ctx.fillStyle = '#9a93c0';
    ctx.font = "10px 'Press Start 2P', monospace";
    ctx.fillText(caption, CW / 2, CH - 18);
  }

  /** 银色涂层：渐变 + 斜纹 + 噪点 + 提示文字 */
  private drawCoating(): void {
    const ctx = this.sctx;
    ctx.clearRect(0, 0, CW, CH);
    ctx.globalCompositeOperation = 'source-over';

    const g = ctx.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, '#dfe3ea');
    g.addColorStop(0.5, '#a9b0bf');
    g.addColorStop(1, '#e6e9ef');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CW, CH);

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    for (let x = -CH; x < CW; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + CH, CH);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    for (let x = -CH; x < CW; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + CH, CH);
      ctx.stroke();
    }

    for (let i = 0; i < 700; i++) {
      const x = Math.random() * CW;
      const y = Math.random() * CH;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(60,60,80,0.12)';
      ctx.fillRect(x, y, 2, 2);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(70,70,95,0.55)';
    ctx.font = "13px 'Press Start 2P', monospace";
    ctx.fillText('SCRATCH', CW / 2, CH / 2 - 10);
    ctx.fillStyle = 'rgba(70,70,95,0.45)';
    ctx.font = "10px 'Press Start 2P', monospace";
    ctx.fillText('刮 开 涂 层', CW / 2, CH / 2 + 14);

    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 2;
    this.rr(1, 1, CW - 2, CH - 2, 14);
    ctx.stroke();
  }

  /** 空闲态：展示该档玩法预览（每种玩法自带 idlePreview）+ 奖金表底注。 */
  private drawIdle(): void {
    const t = this.selected;
    const grid = VARIANTS[t.variant].idlePreview(t);
    this.drawCard(t, grid, [], VARIANTS[t.variant].legend(t));
  }

  // ---------- UI 同步 ----------
  /** 当前选中档位的幸运值（按档位隔离） */
  private pityFor(t: TierDef): number {
    return this.state.lotto.pityByTier[t.id] ?? 0;
  }

  /** 彩票技能派生属性（票价折扣 / 中奖率 / 奖金倍率 等） */
  private lottoStats(): LottoStats {
    return this.state.lottoStats();
  }
  /** 实付票价（已扣技能折扣） */
  private costFor(t: TierDef): number {
    return Math.round(t.cost * (1 - this.lottoStats().costDiscount));
  }
  /** 该档幸运值上限（基础 maxPity + 技能加成） */
  private maxPityFor(t: TierDef): number {
    return t.maxPity + this.lottoStats().pityCapBonus;
  }

  /** 关卡解锁态：未解锁时显示锁定面板（遮住玩法区），并刷新进度条。
   *  飞镖在弹窗打开时仍累计 totalEarned，可能正好跨过门槛 → 实时解锁。 */
  refreshUnlock(): void {
    const unlocked = this.state.lottoUnlocked();
    this.body.classList.toggle('locked', !unlocked);
    const lock = this.root.querySelector('#lottoLocked') as HTMLDivElement;
    lock.hidden = unlocked;
    if (!unlocked) {
      const cur = this.state.totalEarned;
      const pct = Math.min(1, cur / LOTTO_UNLOCK_TOTAL);
      this.lockProgress.textContent = `累计获得 ${cur} / ${LOTTO_UNLOCK_TOTAL}`;
      this.lockFill.style.width = `${pct * 100}%`;
    }
  }

  /** 同步金币显示 / 档位可购态 / 购买按钮。
   *  公开：飞镖在弹窗打开时也会 earn，ui.ts 的 onCoins 回调会调用本方法保持新鲜。 */
  syncCoins(): void {
    this.refreshUnlock();
    this.coinsEl.textContent = `🪙 ${this.state.coins}`;
    for (const id in this.tierBtns) {
      const t = TIERS.find((x) => x.id === id)!;
      // 仅外观提示金币不足；仍允许点击以预览奖金表（购买按钮才是硬门槛）
      this.tierBtns[id].classList.toggle('disabled', this.state.coins < t.cost);
    }
    this.refreshBuy();
  }

  private syncLuck(): void {
    const t = this.selected;
    const pity = this.pityFor(t);
    const max = this.maxPityFor(t);
    const pct = Math.min(1, pity / max);
    this.luckFill.style.width = `${pct * 100}%`;
    this.luckText.textContent = `${pity}/${max}`;
  }

  private syncStats(): void {
    const l = this.state.lotto;
    const net = l.won - l.wagered;
    const sign = net > 0 ? '+' : net < 0 ? '-' : '';
    this.statsEl.innerHTML =
      `已购 <b>${l.tickets}</b> · 投入 <b>🪙${l.wagered}</b> · 返奖 <b>🪙${l.won}</b>` +
      ` · 净 <b>${sign}${Math.abs(net)}</b> · 最高 +<b>${l.biggest}</b>`;
  }

  private refreshBuy(): void {
    if (this.phase === 'scratching') {
      this.buyBtn.disabled = true;
      this.buyBtn.textContent = '刮开中…';
      return;
    }
    const cost = this.costFor(this.selected);
    const afford = this.state.coins >= cost;
    this.buyBtn.disabled = !afford;
    this.buyBtn.textContent = `${this.phase === 'revealed' ? '再买一张' : '购买'} 🪙${cost}`;
  }

  private flash(msg: string): void {
    this.hint.textContent = msg;
    this.hint.classList.add('flash');
    window.setTimeout(() => this.hint.classList.remove('flash'), 1200);
  }
}
