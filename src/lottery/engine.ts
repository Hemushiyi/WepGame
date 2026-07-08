// ===== 刮刮乐纯逻辑引擎（无 DOM、无副作用，便于仿真验证 RTP / 不变量）=====
//
// 开奖结果在「购买时」就已确定（与真实刮刮乐一致）：genBoard 先按 winChance+pity
// 掷出中/不中，再交给对应玩法的 Variant.gen 构造合法棋盘。每种玩法各自保证：
//   ① gen(lose) 复盘必为 0 分；② gen(win) 复盘必 >0 分且只命中预期组合。
// 整体期望返奖率 RTP ≈ 0.82–0.90（负期望，作为金币消耗口子），见 sim 验证注释。

export interface Sym {
  icon: string;
  prize: number; // 0 表示非奖符（未中占位 / 倍率符）
  mult?: number; // 倍率符专属：中奖倍率（🔥×2 / ⚡×3）。有 mult 即非奖符。
}

/** 玩法 id —— 每个对应 VARIANTS 注册表里的一项 */
export type VariantId = 'match3' | 'line' | 'rush' | 'corners' | 'multiplier' | 'fullhouse';

export interface TierDef {
  id: string;
  name: string;
  icon: string;
  cost: number;
  accent: string;
  variant: VariantId;
  /** 基础中奖概率（pity=0 时），直接决定该档基线 RTP */
  winChance: number;
  /** 该档幸运值上限（连续未中次数封顶） */
  maxPity: number;
  /** 符号表约定：[奖符..., (倍率符...), 未中符]。末位恒为未中符。 */
  symbols: Sym[];
  /** 与「奖符」一一对应（不含倍率符 / 未中符），和为 1 */
  winWeights: number[];
  cols: number;
  rows: number;
  /** 该档音效半音偏移（越高档音色越亮） */
  semi: number;
}

export interface BoardEval {
  prize: number;
  sym: Sym | null;
  indices: number[]; // 中奖 / 倍率 高亮格下标
}

// 每点幸运值增加的中奖概率（加法）。与 maxPity 共同决定各档封顶 RTP。
export const LUCK_BONUS_PER_PITY = 0.006;
// 单次中奖概率硬上限（兜底护栏）。
export const PER_DRAW_CAP = 0.4;

// ---------- 随机工具 ----------
export function randInt(n: number): number {
  return Math.floor(Math.random() * n);
}

export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function weightedPick(weights: number[]): number {
  let r = Math.random();
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

/** 奖符列表（prize>0 且非倍率符），winWeights 与之逐位对应 */
function prizeSymbols(tier: TierDef): Sym[] {
  return tier.symbols.filter((s) => s.prize > 0 && !s.mult);
}

/** 未中符（约定为末位） */
function missSym(tier: TierDef): Sym {
  return tier.symbols[tier.symbols.length - 1];
}

/** 程序生成连线：所有行 + 所有列；方阵再加两条对角线。3×3 时即经典 8 条。 */
const linesCache = new Map<string, number[][]>();
export function linesFor(cols: number, rows: number): number[][] {
  const key = `${cols}x${rows}`;
  const cached = linesCache.get(key);
  if (cached) return cached;
  const at = (r: number, c: number) => r * cols + c;
  const lines: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const ln: number[] = [];
    for (let c = 0; c < cols; c++) ln.push(at(r, c));
    lines.push(ln);
  }
  for (let c = 0; c < cols; c++) {
    const ln: number[] = [];
    for (let r = 0; r < rows; r++) ln.push(at(r, c));
    lines.push(ln);
  }
  if (cols === rows) {
    const d1: number[] = [];
    const d2: number[] = [];
    for (let i = 0; i < cols; i++) {
      d1.push(at(i, i));
      d2.push(at(i, cols - 1 - i));
    }
    lines.push(d1, d2);
  }
  linesCache.set(key, lines);
  return lines;
}

/**
 * 把空格填满：奖符每个至多 2（杜绝额外三连 / 占满整条线），未中符不限量；
 * 倍率符不参与自动填充（仅 multiplier 玩法显式放置）；exclude 在中奖局排除
 * 中奖符号，确保整张票只有一组中奖组合。match3 / line / corners / multiplier 共用。
 */
export function fillCells(
  cells: (Sym | null)[],
  symbols: Sym[],
  exclude: Sym | null,
): void {
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
      if (s.mult) continue; // 倍率符不自动填
      if (exclude && s.icon === exclude.icon) continue;
      const c = counts.get(s.icon) ?? 0;
      const cap = s.prize > 0 ? 2 : 99;
      if (c >= cap) continue;
      cells[slots[si++]] = s;
      counts.set(s.icon, c + 1);
      placed = true;
      if (si >= slots.length) break;
    }
    if (!placed) cells[slots[si++]] = miss; // 兜底：未中符不会改变判定
  }
}

// ============ 复盘（eval）============
/** match3：奖符出现 ≥3 即中奖，奖金 = 面额 ×(连数−2)（3 连 1×、4 连 2×、5 连 3×） */
export function evalMatch3(grid: Sym[]): BoardEval {
  const counts: Record<string, { sym: Sym; n: number }> = {};
  for (const s of grid) (counts[s.icon] ??= { sym: s, n: 0 }).n++;
  let best: BoardEval = { prize: 0, sym: null, indices: [] };
  for (const k in counts) {
    const { sym, n } = counts[k];
    if (sym.prize > 0 && !sym.mult && n >= 3) {
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

/** line：任一整行/整列/对角同奖符即中奖，按面额 1× 计。 */
export function evalLine(tier: TierDef, grid: Sym[]): BoardEval {
  let best: BoardEval = { prize: 0, sym: null, indices: [] };
  for (const ln of linesFor(tier.cols, tier.rows)) {
    const s = grid[ln[0]];
    if (s.prize > 0 && !s.mult && ln.every((i) => grid[i].icon === s.icon)) {
      if (s.prize > best.prize) best = { prize: s.prize, sym: s, indices: [...ln] };
    }
  }
  return best;
}

// ---- rush：格子金币面值 + 两档奖金（达标 / 头奖）----
export const RUSH_VALUES: Record<string, number> = {
  '🪙': 1, '💎': 3, '⭐': 5, '7️⃣': 10, '➕': 5, '💩': 0,
};
export const RUSH_LADDER: ReadonlyArray<{ min: number; prize: number }> = [
  { min: 50, prize: 80000 },
  { min: 30, prize: 4000 },
];
const RUSH_TARGET = 30;
const RUSH_JACKPOT_FRAC = 0.003;

/** rush：金币求和，达 RUSH_LADDER 门槛即对应奖金；高亮 top-3 高值格。 */
export function evalRush(grid: Sym[]): BoardEval {
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
function rushAdjustTo(grid: Sym[], tier: TierDef, lo: number, hi: number): void {
  let guard = 0;
  let sum = rushSum(grid);
  while (sum < lo && guard++ < 80 && rushBumpUp(grid, tier)) sum = rushSum(grid);
  while (sum > hi && guard++ < 80 && rushBumpDown(grid, tier)) sum = rushSum(grid);
}
function genRushGrid(tier: TierDef, win: boolean): Sym[] {
  const n = tier.cols * tier.rows;
  const grid: Sym[] = [];
  for (let i = 0; i < n; i++) grid.push(rushPick(tier));
  if (win) {
    if (Math.random() < RUSH_JACKPOT_FRAC) rushAdjustTo(grid, tier, 50, 58);
    else rushAdjustTo(grid, tier, RUSH_TARGET, 34);
  } else {
    rushAdjustTo(grid, tier, 0, RUSH_TARGET - 1);
  }
  return grid;
}

// ---------- 空闲预览 ----------
function idleFromLegend(tier: TierDef): Sym[] {
  const n = tier.cols * tier.rows;
  const miss = missSym(tier);
  const grid = [...prizeSymbols(tier)];
  while (grid.length < n) grid.push(miss);
  return shuffle(grid);
}
function idleRush(tier: TierDef): Sym[] {
  const n = tier.cols * tier.rows;
  const coins = tier.symbols.filter((s) => (RUSH_VALUES[s.icon] ?? s.prize) > 0);
  const miss = missSym(tier);
  const grid = [...coins];
  while (grid.length < n) grid.push(miss);
  return shuffle(grid);
}
function idleCorners(tier: TierDef): Sym[] {
  const cols = tier.cols;
  const rows = tier.rows;
  const miss = missSym(tier);
  const grid: Sym[] = new Array(cols * rows).fill(miss);
  const top = prizeSymbols(tier).sort((a, b) => b.prize - a.prize)[0] ?? miss;
  const corners = [0, cols - 1, (rows - 1) * cols, (rows - 1) * cols + (cols - 1)];
  for (const i of corners) grid[i] = top;
  return grid;
}
function idleFullhouse(tier: TierDef): Sym[] {
  const top = prizeSymbols(tier).sort((a, b) => b.prize - a.prize)[0] ?? missSym(tier);
  return new Array(tier.cols * tier.rows).fill(top);
}
function idleMultiplier(tier: TierDef): Sym[] {
  const cols = tier.cols;
  const rows = tier.rows;
  const n = cols * rows;
  const miss = missSym(tier);
  const grid: Sym[] = new Array(n).fill(miss);
  const top = prizeSymbols(tier).sort((a, b) => b.prize - a.prize)[0] ?? miss;
  // 中行放 3 个最高奖符 + 1 个倍率符，示意「三连 × 倍率」
  const midR = Math.floor(rows / 2);
  const row = [];
  for (let c = 0; c < cols; c++) row.push(midR * cols + c);
  shuffle(row);
  for (let k = 0; k < 3 && k < row.length; k++) grid[row[k]] = top;
  const mults = tier.symbols.filter((s) => s.mult);
  if (mults.length) {
    const empties = grid.map((s, i) => (s === miss ? i : -1)).filter((i) => i >= 0);
    if (empties.length) grid[empties[randInt(empties.length)]] = mults[0];
  }
  return grid;
}

// ============ 玩法注册表 ============
export interface Variant {
  gen(tier: TierDef, win: boolean): Sym[];
  eval(tier: TierDef, grid: Sym[]): BoardEval;
  rule(tier: TierDef): string;
  legend(tier: TierDef): string;
  topPrize(tier: TierDef): number;
  idlePreview(tier: TierDef): Sym[];
  winSfx: 'win' | 'winLine' | 'winSum';
}

const match3Variant: Variant = {
  winSfx: 'win',
  gen(tier, win) {
    const n = tier.cols * tier.rows;
    const cells: (Sym | null)[] = new Array(n).fill(null);
    if (win) {
      const winSym = prizeSymbols(tier)[weightedPick(tier.winWeights)];
      const idx = shuffle([...Array(n).keys()]);
      for (let k = 0; k < 3; k++) cells[idx[k]] = winSym;
      fillCells(cells, tier.symbols, winSym);
    } else {
      fillCells(cells, tier.symbols, null); // cap=2 自动杜绝三连 → 合法负局
    }
    return cells as Sym[];
  },
  eval: (_t, grid) => evalMatch3(grid),
  rule: () => '凑齐3连中奖 · 4连x2 · 5连x3',
  legend: (t) => prizeSymbols(t).map((s) => `${s.icon}×${s.prize}`).join('  '),
  topPrize: (t) => prizeSymbols(t).reduce((m, s) => Math.max(m, s.prize), 0),
  idlePreview: idleFromLegend,
};

const lineVariant: Variant = {
  winSfx: 'winLine',
  gen(tier, win) {
    const n = tier.cols * tier.rows;
    const cells: (Sym | null)[] = new Array(n).fill(null);
    if (win) {
      const winSym = prizeSymbols(tier)[weightedPick(tier.winWeights)];
      const lines = linesFor(tier.cols, tier.rows);
      const line = lines[randInt(lines.length)];
      for (const i of line) cells[i] = winSym;
      fillCells(cells, tier.symbols, winSym); // 其余格排除 winSym + cap=2 → 仅一条连线
    } else {
      fillCells(cells, tier.symbols, null); // cap=2 自动杜绝任一奖符占满整条线
    }
    return cells as Sym[];
  },
  eval: (t, grid) => evalLine(t, grid),
  rule: () => '一条横竖斜连线即中奖(1x)',
  legend: (t) => prizeSymbols(t).map((s) => `${s.icon}×${s.prize}`).join('  '),
  topPrize: (t) => prizeSymbols(t).reduce((m, s) => Math.max(m, s.prize), 0),
  idlePreview: idleFromLegend,
};

const rushVariant: Variant = {
  winSfx: 'winSum',
  gen: (tier, win) => genRushGrid(tier, win),
  eval: (_t, grid) => evalRush(grid),
  rule: () => '金币总和≥30即中奖 越高倍率越大',
  legend: () => `总和≥30:+4000  ≥50:+80000(头奖)`,
  topPrize: () => RUSH_LADDER[0].prize,
  idlePreview: idleRush,
};

/** corners 四角同花：四个角同图案 → 中奖，奖金 = 面额 ×2。
 *  不变量靠 fillCells 的 cap=2：任一奖符全局至多 2 格，故四角绝不可能全同奖符；
 *  未中符四角同也因 prize=0 不计中。 */
const cornersVariant: Variant = {
  winSfx: 'win',
  gen(tier, win) {
    const cols = tier.cols;
    const rows = tier.rows;
    const n = cols * rows;
    const cells: (Sym | null)[] = new Array(n).fill(null);
    const corners = [0, cols - 1, (rows - 1) * cols, (rows - 1) * cols + (cols - 1)];
    if (win) {
      const winSym = prizeSymbols(tier)[weightedPick(tier.winWeights)];
      for (const i of corners) cells[i] = winSym;
      fillCells(cells, tier.symbols, winSym); // 余格排除 winSym + cap=2 → 四角唯一同
    } else {
      fillCells(cells, tier.symbols, null); // cap=2 → 四角无法全同奖符
    }
    return cells as Sym[];
  },
  eval(tier, grid) {
    const cols = tier.cols;
    const rows = tier.rows;
    const corners = [0, cols - 1, (rows - 1) * cols, (rows - 1) * cols + (cols - 1)];
    const s0 = grid[corners[0]];
    if (s0.prize > 0 && !s0.mult && corners.every((i) => grid[i].icon === s0.icon)) {
      return { prize: s0.prize * 2, sym: s0, indices: [...corners] };
    }
    return { prize: 0, sym: null, indices: [] };
  },
  rule: () => '四角同图案中奖 ×2',
  legend: (t) => prizeSymbols(t).map((s) => `${s.icon}×${s.prize * 2}`).join('  '),
  topPrize: (t) => prizeSymbols(t).reduce((m, s) => Math.max(m, s.prize), 0) * 2,
  idlePreview: idleCorners,
};

/** multiplier 倍击：三连基础奖 × 刮出的倍率符(🔥×2/⚡×3)。
 *  win：放 1 组三连(winSym) + 1 个倍率符，余 cap=2；lose：无三连（cap=2 保证），
 *  倍率符 win 必放、lose 概率放（制造"差一点"），但 lose 无基础奖 → 倍率无效。 */
const multiplierVariant: Variant = {
  winSfx: 'winSum',
  gen(tier, win) {
    const n = tier.cols * tier.rows;
    const cells: (Sym | null)[] = new Array(n).fill(null);
    const mults = tier.symbols.filter((s) => s.mult);
    const order = shuffle([...Array(n).keys()]);
    // 预占一格放倍率符（win 必放 / lose ~40% 放），它不参与 fillCells 自动填充
    let k = 0;
    if (mults.length && (win || Math.random() < 0.4)) {
      cells[order[0]] = mults[randInt(mults.length)];
      k = 1;
    }
    if (win) {
      const winSym = prizeSymbols(tier)[weightedPick(tier.winWeights)];
      let placed = 0;
      for (; k < order.length && placed < 3; k++) { cells[order[k]] = winSym; placed++; }
      fillCells(cells, tier.symbols, winSym); // 排除 winSym + cap=2 → 仅一组三连
    } else {
      fillCells(cells, tier.symbols, null); // 无三连
    }
    return cells as Sym[];
  },
  eval(_tier, grid) {
    const base = evalMatch3(grid); // 倍率符 prize=0，不会自成三连
    if (base.prize <= 0) return { prize: 0, sym: null, indices: [] };
    let mult = 1;
    const multCells: number[] = [];
    for (let i = 0; i < grid.length; i++) {
      if (grid[i].mult) { mult *= grid[i].mult as number; multCells.push(i); }
    }
    return { prize: base.prize * mult, sym: base.sym, indices: [...base.indices, ...multCells] };
  },
  rule: () => '三连中奖 × 刮出倍率(🔥x2 / ⚡x3)',
  legend: (t) => prizeSymbols(t).map((s) => `${s.icon}×${s.prize}`).join('  ') + '  🔥×2 ⚡×3',
  topPrize: (t) => {
    const top = prizeSymbols(t).reduce((m, s) => Math.max(m, s.prize), 0);
    const maxMult = t.symbols.reduce((m, s) => Math.max(m, s.mult ?? 1), 1);
    return top * maxMult;
  },
  idlePreview: idleMultiplier,
};

/** fullhouse 满堂红：全盘同图案 = 头奖（全有或全无）。
 *  win：全格同 winSym；lose：cap=2 保证奖符无法铺满 → 必含 ≥2 种符号（或全未中），
 *  全未中时 s0.prize=0 不计中。 */
const fullhouseVariant: Variant = {
  winSfx: 'winLine',
  gen(tier, win) {
    const n = tier.cols * tier.rows;
    if (win) {
      const winSym = prizeSymbols(tier)[weightedPick(tier.winWeights)];
      return new Array(n).fill(winSym);
    }
    const cells: (Sym | null)[] = new Array(n).fill(null);
    fillCells(cells, tier.symbols, null);
    const grid = cells as Sym[];
    // 极端兜底：若全同（仅可能全为未中符），换一格为另一符号确保视觉非满堂
    if (grid.every((s) => s.icon === grid[0].icon)) {
      const other = prizeSymbols(tier).find((s) => s.icon !== grid[0].icon) ?? missSym(tier);
      grid[1] = other;
    }
    return grid;
  },
  eval(_tier, grid) {
    const s0 = grid[0];
    if (s0.prize > 0 && !s0.mult && grid.every((s) => s.icon === s0.icon)) {
      return { prize: s0.prize, sym: s0, indices: grid.map((_, i) => i) };
    }
    return { prize: 0, sym: null, indices: [] };
  },
  rule: () => '整盘同一图案即头奖',
  legend: (t) => prizeSymbols(t).map((s) => `${s.icon}=${s.prize}`).join('  '),
  topPrize: (t) => prizeSymbols(t).reduce((m, s) => Math.max(m, s.prize), 0),
  idlePreview: idleFullhouse,
};

export const VARIANTS: Record<VariantId, Variant> = {
  match3: match3Variant,
  line: lineVariant,
  rush: rushVariant,
  corners: cornersVariant,
  multiplier: multiplierVariant,
  fullhouse: fullhouseVariant,
};

// ============ 档位 ============
// 6 档：铜/银/金（原 3 档，RTP 已仿真验证）+ 翡翠/紫晶/红宝石（新 3 档）。
// 成本与奖金逐级放大，每档一种玩法、一种盘面节奏；winChance/面额经 sim 调到负期望。
// SIM-VERIFIED（每档 30 万次，含 pity 状态机，gen/eval 不变量全通过）：
//   bronze 0.91 / silver 0.81 / gold 0.92 / jade(corners) 0.83 / amethyst(multiplier) 0.91 / ruby(fullhouse) 0.72。
//   均 <0.95。ruby 为高方差头奖档（60× 封顶），RTP 偏低属设计意图。
export const TIERS: TierDef[] = [
  {
    id: 'bronze', name: '铜票', icon: '🥉', cost: 50, accent: '#d98a3a', variant: 'match3',
    winChance: 0.30, maxPity: 5, cols: 3, rows: 3, semi: 0,
    symbols: [
      { icon: '🪙', prize: 60 }, { icon: '💎', prize: 125 }, { icon: '⭐', prize: 400 }, { icon: '7️⃣', prize: 1000 },
      { icon: '💩', prize: 0 },
    ],
    winWeights: [0.60, 0.25, 0.12, 0.03],
  },
  {
    id: 'silver', name: '银票', icon: '🥈', cost: 250, accent: '#aab4c4', variant: 'line',
    winChance: 0.22, maxPity: 8, cols: 3, rows: 3, semi: 5,
    symbols: [
      { icon: '🪙', prize: 300 }, { icon: '💎', prize: 750 }, { icon: '⭐', prize: 2000 }, { icon: '7️⃣', prize: 7500 },
      { icon: '💣', prize: 0 }, { icon: '💩', prize: 0 },
    ],
    winWeights: [0.55, 0.30, 0.12, 0.03],
  },
  {
    id: 'gold', name: '金票', icon: '🥇', cost: 1000, accent: '#ffd45e', variant: 'rush',
    winChance: 0.20, maxPity: 10, cols: 3, rows: 3, semi: 12,
    // rush：prize 字段 = 格子金币面值（非奖金）。奖金由 evalRush 阶梯决定。
    symbols: [
      { icon: '🪙', prize: 1 }, { icon: '💎', prize: 3 }, { icon: '⭐', prize: 5 }, { icon: '7️⃣', prize: 10 },
      { icon: '➕', prize: 5 }, { icon: '💩', prize: 0 },
    ],
    winWeights: [0.50, 0.30, 0.15, 0.05],
  },
  {
    id: 'jade', name: '翡翠票', icon: '🟢', cost: 3000, accent: '#5fce86', variant: 'corners',
    winChance: 0.13, maxPity: 8, cols: 4, rows: 4, semi: 4,
    symbols: [
      { icon: '🍀', prize: 2000 }, { icon: '💚', prize: 5000 }, { icon: '💠', prize: 14000 }, { icon: '🌟', prize: 35000 }, { icon: '7️⃣', prize: 100000 },
      { icon: '🌵', prize: 0 },
    ],
    winWeights: [0.50, 0.30, 0.13, 0.05, 0.02],
  },
  {
    id: 'amethyst', name: '紫晶票', icon: '🟣', cost: 8000, accent: '#c061e0', variant: 'multiplier',
    winChance: 0.22, maxPity: 8, cols: 3, rows: 3, semi: 7,
    symbols: [
      { icon: '🔮', prize: 5000 }, { icon: '💜', prize: 12000 }, { icon: '👾', prize: 30000 }, { icon: '🌟', prize: 80000 },
      { icon: '🔥', prize: 0, mult: 2 }, { icon: '⚡', prize: 0, mult: 3 },
      { icon: '🦠', prize: 0 },
    ],
    winWeights: [0.55, 0.30, 0.12, 0.03],
  },
  {
    id: 'ruby', name: '红宝石票', icon: '🔴', cost: 25000, accent: '#e84753', variant: 'fullhouse',
    winChance: 0.06, maxPity: 8, cols: 4, rows: 4, semi: 12,
    symbols: [
      { icon: '❤️', prize: 40000 }, { icon: '♛', prize: 120000 }, { icon: '👑', prize: 400000 }, { icon: '💠', prize: 1500000 },
      { icon: '🩸', prize: 0 },
    ],
    winWeights: [0.50, 0.30, 0.15, 0.05],
  },
];

/** 该档最高奖金（头奖判定 + 档位按钮 🏆 展示） */
export function topPrize(tier: TierDef): number {
  return VARIANTS[tier.variant].topPrize(tier);
}

/** 生成一张彩票：按 winChance + pity 定输赢，再交对应玩法构造合法棋盘 */
export function genBoard(tier: TierDef, pity: number): { grid: Sym[]; eval: BoardEval } {
  const wc = Math.min(tier.winChance + LUCK_BONUS_PER_PITY * pity, PER_DRAW_CAP);
  const win = Math.random() < wc;
  const grid = VARIANTS[tier.variant].gen(tier, win);
  return { grid, eval: VARIANTS[tier.variant].eval(tier, grid) };
}

/** 按档玩法复盘 */
export function evalBoard(tier: TierDef, grid: Sym[]): BoardEval {
  return VARIANTS[tier.variant].eval(tier, grid);
}
