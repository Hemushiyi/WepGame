import { GameState, LOTTO_UNLOCK_TOTAL } from '../shared/state';
import { audio } from '../shared/audio';
import {
  TIERS,
  VARIANTS,
  topPrize,
  genBoard,
  evalBoard,
  type TierDef,
  type Sym,
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
      ctx.fillRect(Math.round(x0 + c * px), Math.round(y0 + r * px), step, step);
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
      '..XXXX..',
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
      '........',
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
      'X......X',
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
      '..XXXX..',
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
      '........',
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
      '...X....',
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
      '....X...',
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
      '.XXXXXX.',
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
      '........',
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
      '........',
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
      '........',
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
      '........',
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
      '........',
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
      '...XX...',
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
      '.XXXXXX.',
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
      '........',
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
      '..X..X..',
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
      '........',
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
      '........',
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
      'XXXXXXX.',
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
      'XXXXXXX.',
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
      '...X....',
    ],
  },
};

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
    if (changed) audio.sfx('tierSelect', { semi: t.semi });
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
    audio.sfx('buy', { semi: tier.semi });
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
      if (isJackpot) audio.sfx('jackpot', { semi: tier.semi });
      else audio.sfx(VARIANTS[tier.variant].winSfx, { semi: tier.semi });
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

  /** 规则底注（按选中档位的玩法） */
  private ruleCaption(): string {
    return VARIANTS[this.selected.variant].rule(this.selected);
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

    // 内面板：深色背板（像素瓷砖的底）
    this.rr(6, 6, CW - 12, CH - 12, 12);
    const grad = ctx.createLinearGradient(0, 0, 0, CH);
    grad.addColorStop(0, '#1d1640');
    grad.addColorStop(1, '#0d0a1f');
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

    // 网格几何：按 cols×rows 动态计算，居中
    const cols = tier.cols;
    const rows = tier.rows;
    const gap = cols >= 4 || rows >= 4 ? 7 : 9; // 宽缝隙，凸显像素分块
    const top = 58;
    const bottom = CH - 26;
    const availW = CW - 24;
    const availH = bottom - top;
    const cell = Math.floor(
      Math.min((availW - (cols - 1) * gap) / cols, (availH - (rows - 1) * gap) / rows),
    );
    const gridW = cols * cell + (cols - 1) * gap;
    const gridH = rows * cell + (rows - 1) * gap;
    const ox = (CW - gridW) / 2;
    const oy = top + (availH - gridH) / 2;
    const fontPx = Math.max(22, Math.min(52, Math.floor(cell * 0.52)));
    const cellRect = (i: number): { x: number; y: number } => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      return { x: ox + c * (cell + gap), y: oy + r * (cell + gap) };
    };

    // 像素勾缝底：网格区填深色，瓷砖画在其上，缝隙露出成“缝”（直角硬边）
    ctx.fillStyle = '#0a0716';
    ctx.fillRect(ox - gap / 2 - 2, oy - gap / 2 - 2, gridW + gap + 4, gridH + gap + 4);

    for (let i = 0; i < grid.length; i++) {
      const { x, y } = cellRect(i);
      const s = grid[i];

      // 统一暗格子背景（不再按符号分色瓷砖）：深底 + 细亮顶/左边，干净衬底
      ctx.fillStyle = '#15102e';
      ctx.fillRect(x, y, cell, cell);
      ctx.fillStyle = '#241d4a';
      ctx.fillRect(x, y, cell, 2);
      ctx.fillRect(x, y, 2, cell);

      // 图案：优先手绘像素图，未收录则回退 emoji
      const iconDef = PIXEL_ICONS[s.icon];
      if (iconDef) {
        drawPixels(ctx, iconDef, x + cell / 2, y + cell / 2 + 1, cell * 0.74);
      } else {
        ctx.font = `${fontPx}px serif`;
        ctx.fillStyle = '#fff';
        ctx.fillText(s.icon, x + cell / 2, y + cell / 2 + Math.floor(fontPx * 0.06));
      }
    }

    // 中奖高亮：金色发光硬边框
    for (const i of highlight) {
      const { x, y } = cellRect(i);
      ctx.save();
      ctx.shadowColor = '#fff3b0';
      ctx.shadowBlur = 16;
      ctx.strokeStyle = '#fff3b0';
      ctx.lineWidth = 3;
      ctx.strokeRect(x - 1.5, y - 1.5, cell + 3, cell + 3);
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
