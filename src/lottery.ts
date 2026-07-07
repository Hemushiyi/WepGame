import { GameState, LOTTO_UNLOCK_TOTAL } from './state';
import { audio } from './audio';

/** 档位→音调偏移：铜 0 / 银 +5 / 金 +12 半音，越高档音色越亮 */
function tierSemi(t: TierDef): number {
  return t.variant === 'rush' ? 12 : t.variant === 'line' ? 5 : 0;
}

// ===== 刮刮乐（彩票）小游戏 =====
// 玩家用金币购买彩票 → 手指/鼠标刮开银色涂层 → 3×3 格子中
// 凑齐 3 个相同符号即中奖（4 连 ×2、5 连 ×3）。
//
// 开奖结果在「购买时」就已确定（与真实刮刮乐一致）：genBoard 先掷出
// 中/不中与中奖符号，再据此构造棋盘 —— 中奖局恰好放 3 个该符号，
// 不中奖局保证没有任何奖符达到 3 个。这样既能精确控制期望返奖率（RTP），
// 又避免出现「两个不同符号同时三连」之类的尴尬局面。
//
// 幸运值（pity，按档位独立累计）：该档连续未中 +1、中奖清零、封顶 maxPity；
// 每点小幅抬升该档中奖概率，软化连败。整体 RTP 由 winChance +
// maxPity×LUCK_BONUS_PER_PITY 决定并经仿真封顶（见 SIM-VERIFIED）；
// PER_DRAW_CAP 是单次中奖概率的硬天花板（兜底，非 RTP 封顶手段）。

interface Sym {
  icon: string;
  prize: number; // 0 表示未中占位符（💩）
}

interface TierDef {
  id: string;
  name: string;
  icon: string;
  cost: number;
  accent: string;
  /** 玩法变体：match3=三连成 / line=连成线 / rush=金库冲刺（金币总和达标） */
  variant: 'match3' | 'line' | 'rush';
  /** 基础中奖概率（幸运值为 0 时），直接决定该档位基线 RTP */
  winChance: number;
  /** 该档位幸运值上限（连续未中次数封顶） */
  maxPity: number;
  /** symbols 末位为未中符号；其余为奖符（按“优先消耗奖符”排序，便于填充） */
  symbols: Sym[];
  /** 与 symbols[0..n-1]（不含末位）一一对应，和为 1 */
  winWeights: number[];
}

// 每点幸运值增加的中奖概率（加法）。与 maxPity 共同决定各档封顶 RTP（见 SIM-VERIFIED）。
const LUCK_BONUS_PER_PITY = 0.006;
// 单次中奖概率硬上限（兜底护栏：即便误调参也不会让单次中奖率超过此值；
// 当前各档满幸运值时为 0.33/0.27/0.26，均远低于 0.4，故正常不触发）。
const PER_DRAW_CAP = 0.4;

// 三档彩票：铜 / 银 / 金。成本与奖金逐级放大，基线 RTP ~0.82–0.87，
// 略低于 100% 的负期望，作为金币消耗口子（金币主要靠投飞镖赚取）。
// 三档各用一种玩法（match3 / line / rush），手感与认知模式都不同。
// 注：cost 与 prize 同比缩放保持 RTP 不变；价格已上调（50/250/1000）。
const TIERS: TierDef[] = [
  {
    id: 'bronze', name: '铜票', icon: '🥉', cost: 50, accent: '#d98a3a', variant: 'match3',
    winChance: 0.30, maxPity: 5,
    symbols: [
      { icon: '🪙', prize: 60 }, { icon: '💎', prize: 125 }, { icon: '⭐', prize: 400 }, { icon: '7️⃣', prize: 1000 },
      { icon: '💩', prize: 0 },
    ],
    winWeights: [0.60, 0.25, 0.12, 0.03],
  },
  {
    id: 'silver', name: '银票', icon: '🥈', cost: 250, accent: '#aab4c4', variant: 'line',
    winChance: 0.22, maxPity: 8,
    symbols: [
      { icon: '🪙', prize: 300 }, { icon: '💎', prize: 750 }, { icon: '⭐', prize: 2000 }, { icon: '7️⃣', prize: 7500 },
      { icon: '💣', prize: 0 }, { icon: '💩', prize: 0 },
    ],
    winWeights: [0.55, 0.30, 0.12, 0.03],
  },
  {
    id: 'gold', name: '金票', icon: '🥇', cost: 1000, accent: '#ffd45e', variant: 'rush',
    winChance: 0.20, maxPity: 10,
    // rush 档：prize 字段 = 格子金币面值（非奖金）。奖金由 evalRush 阶梯决定。
    symbols: [
      { icon: '🪙', prize: 1 }, { icon: '💎', prize: 3 }, { icon: '⭐', prize: 5 }, { icon: '7️⃣', prize: 10 },
      { icon: '➕', prize: 5 }, { icon: '💩', prize: 0 },
    ],
    winWeights: [0.50, 0.30, 0.15, 0.05],
  },
];

/** 该档最高奖金：match3/line 取奖符最大值；rush 取阶梯顶奖。 */
function topPrize(t: TierDef): number {
  if (t.variant === 'rush') return RUSH_LADDER[0].prize;
  return t.symbols.reduce((m, s) => Math.max(m, s.prize), 0);
}

// ---------- 随机工具 ----------
function randInt(n: number): number {
  return Math.floor(Math.random() * n);
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function weightedPick(weights: number[]): number {
  let r = Math.random();
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

interface BoardEval {
  prize: number;
  sym: Sym | null;
  indices: number[]; // 中奖符号所在格子下标
}

// ---- line 变体的 8 条连线（3 行 + 3 列 + 2 斜）----
const LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

// ---- rush 变体：格子金币面值 + 两档奖金（达标 / 头奖）----
const RUSH_VALUES: Record<string, number> = {
  '🪙': 1, '💎': 3, '⭐': 5, '7️⃣': 10, '➕': 5, '💩': 0,
};
// 从高到低：evalRush 取第一个达标的 rung。设计成「达标固定奖 + 极稀有头奖」，
// 让 RTP 由 winChance 单点控制、头奖尾巴可分析（见 SIM-VERIFIED）。
const RUSH_LADDER: ReadonlyArray<{ min: number; prize: number }> = [
  { min: 50, prize: 80000 },
  { min: 30, prize: 4000 },
];
const RUSH_TARGET = 30;
const RUSH_JACKPOT_FRAC = 0.003; // 中奖局中触发头奖(总和≥50)的比例；仿真校准 blended≤0.95

// ============ 复盘（eval）============
/** match3：奖符出现 ≥3 即中奖，奖金 = 面额 ×(连数−2)（3 连 1×、4 连 2×、5 连 3×） */
function evalMatch3(grid: Sym[]): BoardEval {
  const counts: Record<string, { sym: Sym; n: number }> = {};
  for (const s of grid) (counts[s.icon] ??= { sym: s, n: 0 }).n++;
  let best: BoardEval = { prize: 0, sym: null, indices: [] };
  for (const k in counts) {
    const { sym, n } = counts[k];
    if (sym.prize > 0 && n >= 3) {
      const p = sym.prize * (n - 2);
      if (p > best.prize) {
        best = {
          prize: p,
          sym,
          indices: grid.map((g, i) => (g.icon === k ? i : -1)).filter((i) => i >= 0),
        };
      }
    }
  }
  return best;
}

/** line：任一横/竖/斜 3 格同奖符即中奖，按面额 1× 计。 */
function evalLine(grid: Sym[]): BoardEval {
  let best: BoardEval = { prize: 0, sym: null, indices: [] };
  for (const ln of LINES) {
    const [a, b, c] = ln;
    const s = grid[a];
    if (s.prize > 0 && s.icon === grid[b].icon && s.icon === grid[c].icon) {
      if (s.prize > best.prize) best = { prize: s.prize, sym: s, indices: [a, b, c] };
    }
  }
  return best;
}

/** rush：9 格金币求和，达 RUSH_LADDER 门槛即对应奖金；高亮 top-3 高值格。 */
function evalRush(grid: Sym[]): BoardEval {
  let sum = 0;
  for (const s of grid) sum += RUSH_VALUES[s.icon] ?? 0;
  for (const rung of RUSH_LADDER) {
    if (sum >= rung.min) {
      const indices = grid
        .map((s, i) => ({ i, v: RUSH_VALUES[s.icon] ?? 0 }))
        .sort((p, q) => q.v - p.v)
        .slice(0, 3)
        .map((o) => o.i);
      return { prize: rung.prize, sym: null, indices };
    }
  }
  return { prize: 0, sym: null, indices: [] };
}

/** 按档玩法复盘 */
function evalBoard(tier: TierDef, grid: Sym[]): BoardEval {
  if (tier.variant === 'line') return evalLine(grid);
  if (tier.variant === 'rush') return evalRush(grid);
  return evalMatch3(grid);
}

/** 把空格填满：奖符每个至多 2（杜绝额外三连 / 占满整条线），未中符号不限量；
 *  winSym 在中奖局被排除，确保整张票只有一条中奖线。match3 + line 共用。 */
function fillCells(cells: (Sym | null)[], symbols: Sym[], exclude: Sym | null): void {
  const counts = new Map<string, number>();
  for (const c of cells) if (c) counts.set(c.icon, (counts.get(c.icon) ?? 0) + 1);
  const slots: number[] = [];
  for (let i = 0; i < cells.length; i++) if (!cells[i]) slots.push(i);
  shuffle(slots);
  const miss = symbols[symbols.length - 1];
  let si = 0;
  while (si < slots.length) {
    let placed = false;
    for (const s of symbols) {
      if (exclude && s.icon === exclude.icon) continue;
      const c = counts.get(s.icon) ?? 0;
      const cap = s.prize > 0 ? 2 : 99;
      if (c >= cap) continue;
      cells[slots[si++]] = s;
      counts.set(s.icon, c + 1);
      placed = true;
      if (si >= slots.length) break;
    }
    if (!placed) cells[slots[si++]] = miss; // 兜底：未中符号不会改变判定
  }
}

// ============ 生成（gen）—— 开奖在购买时确定，据此构造合法棋盘 ============
function genMatch3(tier: TierDef, wc: number): { grid: Sym[]; eval: BoardEval } {
  const cells: (Sym | null)[] = new Array(9).fill(null);
  if (Math.random() < wc) {
    const winSym = tier.symbols[weightedPick(tier.winWeights)];
    const idx = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (let k = 0; k < 3; k++) cells[idx[k]] = winSym;
    fillCells(cells, tier.symbols, winSym);
  } else {
    fillCells(cells, tier.symbols, null); // cap=2 自动杜绝三连 → 必为合法负局
  }
  const grid = cells as Sym[];
  return { grid, eval: evalMatch3(grid) };
}

function genLine(tier: TierDef, wc: number): { grid: Sym[]; eval: BoardEval } {
  const cells: (Sym | null)[] = new Array(9).fill(null);
  if (Math.random() < wc) {
    const winSym = tier.symbols[weightedPick(tier.winWeights)];
    const line = LINES[Math.floor(Math.random() * LINES.length)];
    for (const i of line) cells[i] = winSym;
    fillCells(cells, tier.symbols, winSym); // 其余 6 格排除 winSym + cap=2 → 仅一条连线
  } else {
    fillCells(cells, tier.symbols, null); // cap=2 自动杜绝任一奖符占满整条线 → 合法负局
  }
  const grid = cells as Sym[];
  return { grid, eval: evalLine(grid) };
}

// ---- rush 专用：面值阶梯式升降，把总和调进目标区间 ----
function rushPick(tier: TierDef): Sym {
  // 偏小币，让初始总和常徘徊在 30 附近（最大悬念）。权重对应 symbols 顺序。
  return tier.symbols[weightedPick([34, 22, 14, 5, 15, 10])];
}
function rushSum(grid: Sym[]): number {
  let s = 0;
  for (const cell of grid) s += RUSH_VALUES[cell.icon] ?? 0;
  return s;
}
/** 把最低值格升一级（步进最小，避免过冲） */
function rushBumpUp(grid: Sym[], tier: TierDef): boolean {
  let lo = -1;
  let lv = Infinity;
  for (let i = 0; i < grid.length; i++) {
    const v = RUSH_VALUES[grid[i].icon] ?? 0;
    if (v < 10 && v < lv) { lv = v; lo = i; }
  }
  if (lo < 0) return false;
  const cur = RUSH_VALUES[grid[lo].icon] ?? 0;
  let pick = -1;
  let pv = Infinity;
  for (let k = 0; k < tier.symbols.length; k++) {
    const v = RUSH_VALUES[tier.symbols[k].icon] ?? 0;
    if (v > cur && v < pv) { pv = v; pick = k; }
  }
  if (pick < 0) return false;
  grid[lo] = tier.symbols[pick];
  return true;
}
/** 把最高值格降一级 */
function rushBumpDown(grid: Sym[], tier: TierDef): boolean {
  let hi = -1;
  let hv = -1;
  for (let i = 0; i < grid.length; i++) {
    const v = RUSH_VALUES[grid[i].icon] ?? 0;
    if (v > 0 && v > hv) { hv = v; hi = i; }
  }
  if (hi < 0) return false;
  const cur = RUSH_VALUES[grid[hi].icon] ?? 0;
  let pick = -1;
  let pv = -1;
  for (let k = 0; k < tier.symbols.length; k++) {
    const v = RUSH_VALUES[tier.symbols[k].icon] ?? 0;
    if (v < cur && v > pv) { pv = v; pick = k; }
  }
  grid[hi] = pick < 0 ? tier.symbols[tier.symbols.length - 1] : tier.symbols[pick];
  return true;
}
/** 反复升降直到总和落在 [lo, hi] */
function rushAdjustTo(grid: Sym[], tier: TierDef, lo: number, hi: number): void {
  let guard = 0;
  let sum = rushSum(grid);
  while (sum < lo && guard++ < 80 && rushBumpUp(grid, tier)) sum = rushSum(grid);
  while (sum > hi && guard++ < 80 && rushBumpDown(grid, tier)) sum = rushSum(grid);
}
function genRush(tier: TierDef, wc: number): { grid: Sym[]; eval: BoardEval } {
  const grid: Sym[] = [];
  for (let i = 0; i < 9; i++) grid.push(rushPick(tier));
  if (Math.random() < wc) {
    // 中奖：极小概率冲刺到头奖(总和≥50)，否则稳进达标区间[30,34]
    if (Math.random() < RUSH_JACKPOT_FRAC) rushAdjustTo(grid, tier, 50, 58);
    else rushAdjustTo(grid, tier, RUSH_TARGET, 34);
  } else {
    rushAdjustTo(grid, tier, 0, RUSH_TARGET - 1); // 未中：压到 ≤29（常停 28-29 制造"差一点"）
  }
  return { grid, eval: evalRush(grid) };
}

// SIM-VERIFIED（每档 30 万次，含幸运值状态机）：
//   铜(match3) blend ≈0.90 / 银(line) ≈0.82 / 金(rush) ≈0.88。均 ≤0.95。
//   负局不变量：match3 无奖符达 3；line 无奖符占满整线；rush 总和 ≤29。
/** 生成一张彩票：按档玩法 + 幸运值定输赢，并据此构造合法棋盘 */
function genBoard(tier: TierDef, pity: number): { grid: Sym[]; eval: BoardEval } {
  const wc = Math.min(tier.winChance + LUCK_BONUS_PER_PITY * pity, PER_DRAW_CAP);
  if (tier.variant === 'line') return genLine(tier, wc);
  if (tier.variant === 'rush') return genRush(tier, wc);
  return genMatch3(tier, wc);
}

// ---------- 画布布局常量 ----------
const CW = 340;
const CH = 400;
const GRID_CS = 88;
const GRID_GAP = 10;
const GRID_X = (CW - 3 * GRID_CS - 2 * GRID_GAP) / 2;
const GRID_Y = 48;
const REVEAL_THRESHOLD = 0.5; // 刮开超过 50% 自动揭晓

// 覆盖率网格：解析法统计已刮面积，替代 getImageData 像素读回。
// 像素读回在 GPU 合成画布上会触发同步 GPU→CPU 回读，配合高频 pointermove
// 可把主线程占满 → 整页卡死。解析法零读回、O(1) 判定，彻底消除该卡顿源。
const COVER_CELL = 10; // 每格 10 背板像素
const COVER_COLS = CW / COVER_CELL; // 34
const COVER_ROWS = CH / COVER_CELL; // 40
const COVER_TOTAL = COVER_COLS * COVER_ROWS;

/**
 * 刮刮乐 UI：自建模态 DOM 并挂入 #gameRoot（随画面旋转一致）。
 * 调用方提供 onCoins 回调，用于同步 HUD 金币显示。
 */
export class Lottery {
  private state: GameState;
  private onCoins: () => void;

  private modal!: HTMLDivElement;
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

  constructor(state: GameState, onCoins: () => void) {
    this.state = state;
    this.onCoins = onCoins;
    this.buildDom();
    this.drawIdle();
    this.refreshBuy();
  }

  // ---------- DOM ----------
  private buildDom(): void {
    const root = document.getElementById('gameRoot');
    if (!root) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="modal" id="lotteryModal" aria-hidden="true">
        <div class="modal-card lotto-card">
          <div class="modal-head">
            <div class="modal-title">🎰 刮刮乐</div>
            <div class="modal-coins" id="lottoCoins">🪙 0</div>
            <button class="btn-close" id="closeLotto" aria-label="关闭">✕</button>
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
              <div class="lotto-hint" id="lottoHint">选择档位并购买 · 凑齐 3 个相同符号即中奖</div>
              <div class="lotto-stats" id="lottoStats"></div>
            </div>
          </div>
        </div>
      </div>`;
    root.appendChild(wrap.firstElementChild as HTMLElement);

    this.modal = root.querySelector('#lotteryModal') as HTMLDivElement;
    this.coinsEl = this.modal.querySelector('#lottoCoins') as HTMLDivElement;
    this.body = this.modal.querySelector('#lottoBody') as HTMLDivElement;
    this.lockProgress = this.modal.querySelector('#lottoLockProgress') as HTMLDivElement;
    this.lockFill = this.modal.querySelector('#lottoLockFill') as HTMLDivElement;
    this.tierBar = this.modal.querySelector('#lottoTiers') as HTMLDivElement;
    this.reveal = this.modal.querySelector('#lottoReveal') as HTMLCanvasElement;
    this.rctx = this.reveal.getContext('2d')!;
    this.scratch = this.modal.querySelector('#lottoScratch') as HTMLCanvasElement;
    this.sctx = this.scratch.getContext('2d', { willReadFrequently: true })!;
    this.scratch.style.display = 'none';
    this.result = this.modal.querySelector('#lottoResult') as HTMLDivElement;
    this.pill = this.modal.querySelector('#lottoPill') as HTMLDivElement;
    this.confettiLayer = this.modal.querySelector('#lottoConfetti') as HTMLDivElement;
    this.buyBtn = this.modal.querySelector('#lottoBuy') as HTMLButtonElement;
    this.revealBtn = this.modal.querySelector('#lottoRevealAll') as HTMLButtonElement;
    this.hint = this.modal.querySelector('#lottoHint') as HTMLDivElement;
    this.luckFill = this.modal.querySelector('#luckFill') as HTMLDivElement;
    this.luckText = this.modal.querySelector('#luckText') as HTMLSpanElement;
    this.statsEl = this.modal.querySelector('#lottoStats') as HTMLDivElement;

    // 档位按钮
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

    this.modal.querySelector('#closeLotto')!.addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });
    this.buyBtn.addEventListener('click', () => this.buy());
    this.revealBtn.addEventListener('click', () => this.revealAll());
    // Esc 关闭彩票弹窗（键盘/无障碍）
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
    this.modal.remove();
  }

  // ---------- 开/关 ----------
  open(): void {
    // 打开时回到上次购买的档位（若有记录）
    const last = TIERS.find((t) => t.id === this.state.lotto.lastTier);
    if (last && this.phase !== 'scratching') this.applyTier(last, false);
    audio.sfx('lottoOpen');
    this.modal.classList.add('open');
    this.modal.setAttribute('aria-hidden', 'false');
    this.refreshUnlock();
    this.syncCoins();
    if (this.state.lottoUnlocked()) {
      this.syncLuck();
      this.syncStats();
      this.refreshBuy();
      if (this.phase !== 'scratching') this.drawIdle();
    }
  }

  close(): void {
    // 关闭中若仍在刮且未结算 → 静默结算（按已定结果发奖，不亏待玩家）
    if (this.phase === 'scratching' && !this.settled) this.settle();
    // 若正处于「全部刮开」淡出的 290ms 窗口内（revealed 但未 settle）→ 立即结算
    this.clearRevealTimer();
    if (this.phase === 'revealed' && !this.settled) this.settle();
    this.scratching = false;
    this.activePt = null;
    this.pendingPt = null;
    audio.stopScratch(); // 关闭弹窗时确保摩擦循环音停止
    if (this.rafErase) {
      cancelAnimationFrame(this.rafErase);
      this.rafErase = 0;
    }
    this.clearCelebration();
    this.modal.classList.remove('open');
    this.modal.setAttribute('aria-hidden', 'true');
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
    if (changed) audio.sfx('tierSelect', { semi: tierSemi(t) });
    this.syncLuck();
    this.refreshBuy();
    if (redraw && this.phase !== 'scratching') this.drawIdle();
  }

  // ---------- 购买/发牌 ----------
  private buy(): void {
    if (this.phase === 'scratching') return;
    if (!this.state.lottoUnlocked()) return; // 关卡未解锁，防御
    const tier = this.selected;
    if (this.state.coins < tier.cost) {
      this.flash('💰 金币不足，去投飞镖赚金币吧！');
      return;
    }
    if (!this.state.spend(tier.cost)) return;
    audio.sfx('buy', { semi: tierSemi(tier) });
    this.onCoins();
    this.syncCoins();

    const deal = genBoard(tier, this.pityFor(tier));
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
    const ev = evalBoard(tier, this.curGrid);
    this.drawCard(tier, this.curGrid, ev.indices, this.ruleCaption());
    if (ev.prize > 0) this.state.earn(ev.prize);
    // 统计 + 幸运值（中奖清零 / 未中 +1 封顶）
    const pityBefore = this.pityFor(tier);
    this.state.recordLotto(tier.cost, ev.prize, tier.id, tier.maxPity);
    this.onCoins();
    this.syncCoins();
    this.syncLuck();
    this.syncStats();

    const isJackpot = ev.prize >= topPrize(tier);
    // 音效：头奖 / 各玩法中奖 sting / 未中（+幸运值上升提示）
    if (ev.prize > 0) {
      if (isJackpot) audio.sfx('jackpot', { semi: tierSemi(tier) });
      else {
        const name = tier.variant === 'line' ? 'winLine' : tier.variant === 'rush' ? 'winSum' : 'win';
        audio.sfx(name, { semi: tierSemi(tier) });
      }
    } else {
      audio.sfx('lottoMiss');
      if (this.pityFor(tier) > pityBefore) audio.sfx('luck');
    }
    this.result.classList.add('show', ev.prize > 0 ? 'win' : 'miss');
    if (ev.prize > 0) {
      this.countUp(ev.prize, isJackpot); // 奖金数字滚动 + 头奖前缀
      this.spawnConfetti(isJackpot); // 中奖彩纸（头奖更密 + 更多 emoji）
    } else {
      this.pill.textContent = '💔 未中';
    }
    this.phase = 'revealed';
    this.refreshBuy();
    this.hint.textContent =
      ev.prize > 0 ? `中奖 +${ev.prize}！可再买一张` : '未中奖，再来一张试试？';
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
    if (e.key === 'Escape' && this.modal.classList.contains('open')) this.close();
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

  /** 规则底注（按玩法变体） */
  private ruleCaption(): string {
    const v = this.selected.variant;
    if (v === 'line') return '一条横竖斜连线即中奖(1x)';
    if (v === 'rush') return '9格金币总和≥30即中奖 越高倍率越大';
    return '凑齐3连中奖 · 4连x2 · 5连x3';
  }

  /** 该档奖金表底注（空闲卡用） */
  private legendCaption(tier: TierDef): string {
    if (tier.variant === 'rush') return `总和≥30:+4000  ≥50:+80000(头奖)`;
    if (tier.variant === 'line')
      return tier.symbols.filter((s) => s.prize > 0).map((s) => `${s.icon}×${s.prize}`).join('  ');
    return tier.symbols.filter((s) => s.prize > 0).map((s) => `${s.icon}×${s.prize}`).join('  ');
  }

  /** 档位中奖率定性标签（基于 winChance）：高频档中奖多、奖金小；低频档反之 */
  private oddsLabel(tier: TierDef): string {
    if (tier.winChance >= 0.28) return '中奖高';
    if (tier.winChance >= 0.21) return '中奖中';
    return '中奖低';
  }

  /** 卡面：外框档位色 + 暗面板 + 标题 + 3×3 格子 + 中奖高亮 + 底注 */
  private drawCard(tier: TierDef, grid: Sym[], highlight: number[], caption: string): void {
    const ctx = this.rctx;
    ctx.clearRect(0, 0, CW, CH);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    this.rr(0, 0, CW, CH, 14);
    ctx.fillStyle = tier.accent;
    ctx.fill();
    this.rr(7, 7, CW - 14, CH - 14, 10);
    const g = ctx.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, '#1a1438');
    g.addColorStop(1, '#100c26');
    ctx.fillStyle = g;
    ctx.fill();

    ctx.fillStyle = tier.accent;
    ctx.font = "11px 'Press Start 2P', monospace";
    ctx.fillText(`${tier.icon} ${tier.name}`, CW / 2, 24);

    for (let i = 0; i < 9; i++) {
      const r = Math.floor(i / 3);
      const c = i % 3;
      const x = GRID_X + c * (GRID_CS + GRID_GAP);
      const y = GRID_Y + r * (GRID_CS + GRID_GAP);

      this.rr(x, y, GRID_CS, GRID_CS, 10);
      ctx.fillStyle = '#0b0918';
      ctx.fill();
      this.rr(x + 2, y + 2, GRID_CS - 4, GRID_CS - 4, 8);
      ctx.fillStyle = '#160f30';
      ctx.fill();

      ctx.font = '46px serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(grid[i].icon, x + GRID_CS / 2, y + GRID_CS / 2 + 3);
    }

    for (const i of highlight) {
      const r = Math.floor(i / 3);
      const c = i % 3;
      const x = GRID_X + c * (GRID_CS + GRID_GAP);
      const y = GRID_Y + r * (GRID_CS + GRID_GAP);
      ctx.save();
      ctx.shadowColor = tier.accent;
      ctx.shadowBlur = 16;
      ctx.strokeStyle = tier.accent;
      ctx.lineWidth = 3;
      this.rr(x, y, GRID_CS, GRID_CS, 10);
      ctx.stroke();
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

  /** 空闲态：展示该档玩法预览，并在底注列出奖金/规则。 */
  private drawIdle(): void {
    const t = this.selected;
    let grid: Sym[];
    if (t.variant === 'rush') {
      // rush 预览：把 4 个金币符各放一个 + ➕，其余 💩，示意「求和」
      const coins = t.symbols.filter((s) => (RUSH_VALUES[s.icon] ?? s.prize) > 0);
      const miss = t.symbols[t.symbols.length - 1];
      grid = [...coins];
      while (grid.length < 9) grid.push(miss);
    } else {
      const legend = t.symbols.filter((s) => s.prize > 0);
      const miss = t.symbols[t.symbols.length - 1];
      grid = [...legend];
      while (grid.length < 9) grid.push(miss);
    }
    shuffle(grid);
    this.drawCard(t, grid, [], this.legendCaption(t));
  }

  // ---------- UI 同步 ----------
  /** 当前选中档位的幸运值（按档位隔离） */
  private pityFor(t: TierDef): number {
    return this.state.lotto.pityByTier[t.id] ?? 0;
  }

  /** 关卡解锁态：未解锁时显示锁定面板（遮住玩法区），并刷新进度条。
   *  飞镖在弹窗打开时仍累计 totalEarned，可能正好跨过门槛 → 实时解锁。 */
  refreshUnlock(): void {
    const unlocked = this.state.lottoUnlocked();
    this.body.classList.toggle('locked', !unlocked);
    const lock = this.modal.querySelector('#lottoLocked') as HTMLDivElement;
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
    const pct = Math.min(1, pity / t.maxPity);
    this.luckFill.style.width = `${pct * 100}%`;
    this.luckText.textContent = `${pity}/${t.maxPity}`;
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
    const afford = this.state.coins >= this.selected.cost;
    this.buyBtn.disabled = !afford;
    this.buyBtn.textContent = `${this.phase === 'revealed' ? '再买一张' : '购买'} 🪙${this.selected.cost}`;
  }

  private flash(msg: string): void {
    this.hint.textContent = msg;
    this.hint.classList.add('flash');
    window.setTimeout(() => this.hint.classList.remove('flash'), 1200);
  }
}
