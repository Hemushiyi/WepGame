import { GameState, LOTTO_UNLOCK_TOTAL } from './shared/state';
import { Game } from './dart/game';
import { ALL_NODES, NODE_BY_ID, getEdges } from './dart/skills';
import { ALL_LOTTO_NODES, LOTTO_NODE_BY_ID, getLottoEdges } from './lottery/skills';
import { ALL_BATTLE_NODES, BATTLE_NODE_BY_ID, getBattleEdges } from './battle/skills';
import { Battle } from './battle/game';
import { Lottery } from './lottery/lottery';
import { StoryMode } from './story/story';
import { ALL_LOTTO_DART_NODES, LOTTO_DART_NODE_BY_ID, getLottoDartEdges } from './story/lottoSkills';
import { audio } from './shared/audio';
import type { LevelId, SkillNode } from './shared/types';

// ===== 关卡选择 + HUD + 拓扑技能树 UI =====
// 导航：关卡选择主页 ↔ 飞镖关卡页 / 彩票关卡页（都是页面，非弹窗）。
// 每个关卡有独立的技能树，购买技能仍用技能弹窗（按当前关卡切换树）。

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 关卡 → 其技能树描述符（节点表 / 边 / 分支配色 / 读写回调），供技能弹窗通用渲染 */
interface TreeSpec {
  level: LevelId;
  title: string;
  nodes: SkillNode[];
  nodeById: Record<string, SkillNode>;
  edges: Array<{ from: string; to: string }>;
  branches: Record<string, { name: string; color: string }>;
  owned: (id: string) => boolean;
  prereqMet: (id: string) => boolean;
  canBuy: (id: string) => boolean;
  buy: (id: string) => boolean;
}

function svgEl(tag: string, attrs: Record<string, string> = {}): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export function buildApp(state: GameState): Game {
  const app = document.getElementById('app')!;

  app.innerHTML = `
    <div class="game-root" id="gameRoot">
    <div class="hud">
      <div class="hud-left">
        <span class="stat" id="coins">🪙 <b>0</b></span>
        <span class="stat" id="score" hidden>🎯 <b>0</b></span>
        <span class="stat" id="combo" hidden>🔥 <b>x1.0</b></span>
      </div>
      <div class="hud-title">PIXEL DART · 像素飞镖</div>
      <div class="hud-right">
        <button class="btn-rotate" id="homeBtn" title="返回关卡选择" hidden>🏠</button>
        <button class="btn-lotto" id="skillBtn" title="本关技能树" hidden>▣ 技能</button>
        <button class="btn-rotate" id="rotateBtn" title="旋转画面（横/竖屏切换）" aria-pressed="false">🔄</button>
        <button class="btn-rotate btn-mute" id="muteBtn" title="开关音效" aria-pressed="true">🔊</button>
        <button class="btn-lotto" id="lottoTreeBtn" title="彩票技能树" hidden>🎫</button>
      </div>
    </div>

    <div class="screens" id="screens">
      <!-- 关卡选择主页 -->
      <div class="screen screen-select active" id="screenSelect">
        <div class="select-title">选择关卡 <span id="angelBadge" hidden>👼🏆</span></div>
        <div class="select-sub">点选一个关卡进入</div>
        <div class="level-cards">
          <button class="level-card" id="cardDart">
            <span class="lv-icon">🎯</span>
            <span class="lv-name">飞镖场</span>
            <span class="lv-desc">投掷飞镖赚金币 · 连击倍率</span>
          </button>
          <button class="level-card" id="cardLotto">
            <span class="lv-icon">🎰</span>
            <span class="lv-name">彩票站</span>
            <span class="lv-desc" id="lottoCardDesc">刮刮乐 · 博取奖金</span>
            <div class="lv-lock" id="lottoCardLock" hidden>
              <div class="lv-lock-track"><div class="lv-lock-fill" id="lottoCardFill"></div></div>
              <div class="lv-lock-text" id="lottoCardLockText">累计 0/500</div>
            </div>
          </button>
          <button class="level-card" id="cardBattle">
            <span class="lv-icon">⚔️</span>
            <span class="lv-name">打怪场</span>
            <span class="lv-desc">横版打怪 · 点屏挥剑赚金币</span>
          </button>
          <button class="level-card" id="cardStory">
            <span class="lv-icon">📖</span>
            <span class="lv-name">剧情模式</span>
            <span class="lv-desc">跟随故事引导 · 探索游戏世界</span>
          </button>
        </div>
        <div class="select-footer" id="selectFooter" hidden>
          <span class="final-angel">👼</span>
          <span class="final-text">🎉 恭喜你完成最终成就！🎉</span>
          <span class="final-angel">👼</span>
        </div>
      </div>

      <!-- 飞镖关卡 -->
      <div class="screen screen-dart" id="screenDart">
        <canvas id="game"></canvas>
      </div>

      <!-- 打怪关卡 -->
      <div class="screen screen-battle" id="screenBattle">
        <canvas id="battleCanvas"></canvas>
      </div>

      <!-- 彩票关卡（Lottery 类挂这里） -->
      <div class="screen screen-lotto" id="screenLotto"></div>

      <!-- 剧情模式 -->
      <div class="screen screen-story" id="screenStory"></div>
    </div>

    <div class="modal" id="skillModal" aria-hidden="true">
      <div class="modal-card">
        <div class="modal-head">
          <div class="modal-title" id="skillTitle">技能拓扑 · SKILL TREE</div>
          <div class="tree-tabs" id="treeTabs">
            <button class="tree-tab active" id="tabDart">🎯 飞镖</button>
            <button class="tree-tab" id="tabTicket" hidden>🎫 彩票</button>
          </div>
          <div class="modal-progress" id="modalProgress">▣ 0/0</div>
          <div class="modal-coins" id="modalCoins">🪙 0</div>
          <button class="btn-close" id="closeSkill">✕</button>
        </div>
        <div class="modal-legend" id="skillLegend"></div>
        <div class="tree-toolbar">
          <button class="btn-zoom" id="zoomIn" title="放大" aria-label="放大">➕</button>
          <button class="btn-zoom" id="zoomOut" title="缩小" aria-label="缩小">➖</button>
          <button class="btn-zoom" id="zoomReset" title="重置视图" aria-label="重置视图">⟳</button>
        </div>
        <div class="tree-wrap">
          <svg id="tree" viewBox="-8 -6 124 92" preserveAspectRatio="xMidYMid meet"></svg>
        </div>
        <div class="detail" id="detail">
          <div class="detail-name" id="detailName">点选一个节点</div>
          <div class="detail-desc" id="detailDesc">查看加成效果与购买</div>
          <div class="detail-actions">
            <span class="detail-cost" id="detailCost"></span>
            <button class="btn-buy" id="buyBtn" disabled>购买</button>
          </div>
        </div>
        <div class="modal-foot">
          <span id="footEarned">累计获得 0</span>
          <button class="btn-reset" id="resetBtn">重置存档</button>
        </div>
      </div>
    </div>
    </div>
  `;

  const coinsEl = app.querySelector<HTMLSpanElement>('#coins b')!;
  const scoreEl = app.querySelector<HTMLSpanElement>('#score b')!;
  const scoreStat = app.querySelector<HTMLSpanElement>('#score')!;
  const modalCoinsEl = app.querySelector<HTMLSpanElement>('#modalCoins')!;
  const modalProgressEl = app.querySelector<HTMLSpanElement>('#modalProgress')!;
  const footEarnedEl = app.querySelector<HTMLSpanElement>('#footEarned')!;

  let prevCoins = state.coins;
  const coinsStat = app.querySelector<HTMLSpanElement>('#coins')!;
  let pulseTimer: number | undefined;
  const updateCoins = () => {
    coinsEl.textContent = String(state.coins);
    modalCoinsEl.textContent = `🪙 ${state.coins}`;
    footEarnedEl.textContent = `累计获得 ${state.totalEarned}`;
    // 金币增加时给 HUD 数字一个脉冲（减少时不脉冲，如买彩票扣费）
    if (state.coins > prevCoins) {
      coinsStat.classList.remove('pulse');
      void coinsStat.offsetWidth; // 重启动画
      coinsStat.classList.add('pulse');
      if (pulseTimer !== undefined) window.clearTimeout(pulseTimer);
      pulseTimer = window.setTimeout(() => coinsStat.classList.remove('pulse'), 340);
    }
    prevCoins = state.coins;
  };
  const updateScore = () => {
    scoreEl.textContent = String(state.score);
  };
  const comboEl = app.querySelector<HTMLSpanElement>('#combo')!;
  const comboB = app.querySelector<HTMLSpanElement>('#combo b')!;
  const updateCombo = (combo: number, mult: number) => {
    // 始终占位（无连击时淡化），避免命中/失误时 HUD 左侧 layout 抖动
    if (combo <= 0) {
      comboEl.classList.add('dim');
      comboB.textContent = 'x1.0';
    } else {
      comboEl.classList.remove('dim');
      comboB.textContent = `x${mult.toFixed(1)}`;
    }
  };
  updateCombo(0, 1);

  const canvas = app.querySelector<HTMLCanvasElement>('#game')!;
  const game = new Game(canvas, state, {
    onCoins: () => refreshCoins(),
    onScore: () => updateScore(),
    onCombo: (c, m) => updateCombo(c, m),
    onOnboard: (kind) => onboardShow(kind),
    onStoryTrigger: (ch = 1) => { story.startChapter(ch); go('story'); },
  });

  // ---- 屏幕元素 ----
  const screenSelect = app.querySelector<HTMLDivElement>('#screenSelect')!;
  const screenDart = app.querySelector<HTMLDivElement>('#screenDart')!;
  const screenLotto = app.querySelector<HTMLDivElement>('#screenLotto')!;
  const screenBattle = app.querySelector<HTMLDivElement>('#screenBattle')!;
  const homeBtn = app.querySelector<HTMLButtonElement>('#homeBtn')!;
  const skillBtn = app.querySelector<HTMLButtonElement>('#skillBtn')!;

  // 顶部 toast：用于"未解锁"提示与"刚解锁"庆祝（轻量，无依赖）。
  // 挂到 #gameRoot 而非 #app：rotated 模式下 gameRoot 整体 rotate(90deg)，
  // toast 作为其后代会随之旋转，始终贴在 HUD 下方，不会错位到物理屏幕顶部。
  const toast = document.createElement('div');
  toast.className = 'toast';
  (app.querySelector('#gameRoot') || app).appendChild(toast);
  let toastTimer: number | undefined;
  function showToast(msg: string): void {
    toast.textContent = msg;
    toast.classList.add('show');
    if (toastTimer !== undefined) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1800);
  }

  // 新手引导：首次进入 / 首次中心命中 / 首次有风时投掷，各弹一次 toast（持久化，不重复）
  const ONBOARD_KEY = 'pd-onboard-v1';
  const onboardSeen: Set<string> = (() => {
    try {
      const raw = JSON.parse(localStorage.getItem(ONBOARD_KEY) || '[]');
      return new Set<string>(Array.isArray(raw) ? (raw as string[]) : []);
    } catch {
      return new Set<string>();
    }
  })();
  const ONBOARD_COPY: Record<'entry' | 'bull' | 'wind' | 'lottoDrop', string> = {
    entry: '🎯 上下准星 + 左右方向，找准时机的交点出手！',
    bull: '💥 中心命中！连续命中可叠连击倍率',
    wind: '🌬️ 有风：飞镖会被吹偏，留意橙色预测落点',
    lottoDrop: '嘿看看这是什么，也许它能帮助我们更快',
  };
  // 函数声明（提升）：Game 构造期就能在闭包里引用，运行期才调用。
  function onboardShow(kind: 'entry' | 'bull' | 'wind' | 'lottoDrop'): void {
    if (onboardSeen.has(kind)) return;
    onboardSeen.add(kind);
    try {
      localStorage.setItem(ONBOARD_KEY, JSON.stringify([...onboardSeen]));
    } catch {
      /* 存储不可用时静默 */
    }
    showToast(ONBOARD_COPY[kind]);
  }

  // ---- 彩票（页面，挂 #screenLotto）----
  const lottery = new Lottery(state, () => refreshCoins(), () => go('select'), screenLotto);

  // ---- 剧情（纯 DOM，挂 #screenStory）----
  const screenStory = app.querySelector<HTMLDivElement>('#screenStory')!;
  const story = new StoryMode(screenStory, () => go('dart'), showToast, (n) => state.earn(n), () => state.unlockLottoTree(), () => { state.angelAchievement = true; state.save(); });

  // ---- 打怪（页面，挂 #screenBattle 的画布）----
  const battleCanvas = app.querySelector<HTMLCanvasElement>('#battleCanvas')!;
  const battle = new Battle(battleCanvas, state, { onCoins: () => refreshCoins() });

  // ---- 关卡解锁态：派生自 state.totalEarned，无需持久化。----
  const cardLotto = app.querySelector<HTMLButtonElement>('#cardLotto')!;
  const lottoCardLock = app.querySelector<HTMLDivElement>('#lottoCardLock')!;
  const lottoCardFill = app.querySelector<HTMLDivElement>('#lottoCardFill')!;
  const lottoCardLockText = app.querySelector<HTMLDivElement>('#lottoCardLockText')!;
  const lottoCardDesc = app.querySelector<HTMLSpanElement>('#lottoCardDesc')!;

  let lottoWasUnlocked = state.lottoUnlocked();
  function refreshLottoLock(): void {
    const unlocked = state.lottoUnlocked();
    cardLotto.classList.toggle('locked', !unlocked);
    lottoCardLock.hidden = unlocked;
    if (unlocked) {
      lottoCardDesc.textContent = '刮刮乐 · 博取奖金';
      if (!lottoWasUnlocked) {
        lottoWasUnlocked = true;
        showToast('🎉 彩票关卡已解锁！');
        audio.sfx('unlock');
      }
    } else {
      lottoWasUnlocked = false;
      const cur = Math.min(state.totalEarned, LOTTO_UNLOCK_TOTAL);
      const pct = Math.min(1, cur / LOTTO_UNLOCK_TOTAL);
      lottoCardFill.style.width = `${pct * 100}%`;
      lottoCardLockText.textContent = `🔒 累计 ${cur}/${LOTTO_UNLOCK_TOTAL}`;
      lottoCardDesc.textContent = `累计获得 ${LOTTO_UNLOCK_TOTAL} 金币解锁`;
    }
  }

  // ---- 屏幕路由 ----
  let current: 'select' | 'dart' | 'lotto' | 'battle' | 'story' = 'select';
  function go(name: 'select' | 'dart' | 'lotto' | 'battle' | 'story'): void {
    if (name === current) return;
    const prev = current;
    current = name;
    screenSelect.classList.toggle('active', name === 'select');
    screenDart.classList.toggle('active', name === 'dart');
    screenLotto.classList.toggle('active', name === 'lotto');
    screenBattle.classList.toggle('active', name === 'battle');
    screenStory.classList.toggle('active', name === 'story');
    // 飞镖循环：进入才跑，离开即停（省 CPU、避免在隐藏画布上空投）
    if (prev === 'dart') game.stop();
    if (name === 'dart') {
      // 画布刚从 display:none 显示，强制重算尺寸再开循环，避免首帧用 0/旧尺寸渲染
      window.dispatchEvent(new Event('resize'));
      game.start();
    }
    // 打怪循环：同飞镖，进页 start、离页 stop（stop 时落盘本局金币）
    if (prev === 'battle') battle.stop();
    if (name === 'battle') {
      window.dispatchEvent(new Event('resize'));
      battle.start();
    }
    // 剧情：进入渲染，离开清理
    if (prev === 'story') story.leave();
    if (name === 'story') story.enter();
    // 彩票页面：进入刷新，离开静默结算
    if (prev === 'lotto') lottery.leave();
    if (name === 'lotto') lottery.enter();
    // HUD：🏠/技能按钮仅在关卡页显示；score/combo 仅飞镖页
    homeBtn.hidden = name === 'select';
    skillBtn.hidden = name === 'select' || name === 'story';
    scoreStat.hidden = name !== 'dart';
    comboEl.hidden = name !== 'dart';
    refreshCoins();
  }

  app.querySelector<HTMLButtonElement>('#cardDart')!.addEventListener('click', () => go('dart'));
  app.querySelector<HTMLButtonElement>('#cardBattle')!.addEventListener('click', () => go('battle'));
  app.querySelector<HTMLButtonElement>('#cardStory')!.addEventListener('click', () => go('story'));
  const lottoTreeBtn = app.querySelector<HTMLButtonElement>('#lottoTreeBtn')!;
  lottoTreeBtn.addEventListener('click', () => {
    treeTab = 'ticket';
    spec = lottoDartSpec;
    selectedId = null;
    skillTitle.textContent = spec.title;
    renderLegend();
    treeTabs.hidden = false;
    tabDart.classList.toggle('active', false);
    tabTicket.classList.toggle('active', true);
    tabTicket.hidden = false;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    renderTree();
    updateCoins();
  });
  // 彩票树按钮仅在第三段剧情后显示
  const refreshLottoTreeBtn = () => { lottoTreeBtn.hidden = !state.lottoTreeUnlocked; };
  refreshLottoTreeBtn();
  const angelBadge = app.querySelector<HTMLSpanElement>('#angelBadge')!;
  const refreshAngelBadge = () => {
    angelBadge.hidden = !state.angelAchievement;
    selectFooter.hidden = !state.angelAchievement;
  };
  refreshAngelBadge();
  const selectFooter = app.querySelector<HTMLDivElement>('#selectFooter')!;
  cardLotto.addEventListener('click', () => {
    if (!state.lottoUnlocked()) {
      showToast(
        `🔒 累计获得 ${LOTTO_UNLOCK_TOTAL} 金币解锁彩票（当前 ${state.totalEarned}）`,
      );
      return;
    }
    go('lotto');
  });
  (window as any).__navHome = () => { document.getElementById('scratchOverlay')?.remove(); go('select'); };
  homeBtn.addEventListener('click', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); go('select'); });
  homeBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
  skillBtn.addEventListener('click', () => openSkill(current));

  // 金币变动时同步 HUD、彩票页面与彩票解锁状态（飞镖 earn 时保持新鲜）。
  // refreshCoins 是函数声明（提升），lottery / refreshLottoLock 在运行期已初始化。
  function refreshCoins(): void {
    refreshLottoTreeBtn();
    updateCoins();
    lottery.syncCoins();
    refreshLottoLock();
  }

  // ============ 技能弹窗（通用，按关卡切换树）============
  const dartSpec: TreeSpec = {
    level: 'dart',
    title: '🎯 飞镖技能树',
    nodes: ALL_NODES,
    nodeById: NODE_BY_ID,
    edges: getEdges(),
    branches: {
      target: { name: '目标', color: '#e43b44' },
      speed: { name: '速度', color: '#ffd966' },
      pet: { name: '宠物', color: '#b561d8' },
      combo: { name: '技巧', color: '#f5a23e' },
    },
    owned: (id) => state.owned('dart', id),
    prereqMet: (id) => state.prereqMet('dart', id),
    canBuy: (id) => state.canBuy('dart', id),
    buy: (id) => state.buy('dart', id),
  };
  const lottoSpec: TreeSpec = {
    level: 'lotto',
    title: '🎰 彩票技能树',
    nodes: ALL_LOTTO_NODES,
    nodeById: LOTTO_NODE_BY_ID,
    edges: getLottoEdges(),
    branches: {
      luck: { name: '运气', color: '#4caf50' },
      economy: { name: '经济', color: '#ffd45e' },
      perk: { name: '福利', color: '#c061e0' },
    },
    owned: (id) => state.owned('lotto', id),
    prereqMet: (id) => state.prereqMet('lotto', id),
    canBuy: (id) => state.canBuy('lotto', id),
    buy: (id) => state.buy('lotto', id),
  };
  const battleSpec: TreeSpec = {
    level: 'battle',
    title: '⚔️ 打怪技能树',
    nodes: ALL_BATTLE_NODES,
    nodeById: BATTLE_NODE_BY_ID,
    edges: getBattleEdges(),
    branches: {
      power: { name: '力量', color: '#ea4754' },
      agility: { name: '敏捷', color: '#ffd45e' },
      vitality: { name: '体质', color: '#5fce86' },
    },
    owned: (id) => state.owned('battle', id),
    prereqMet: (id) => state.prereqMet('battle', id),
    canBuy: (id) => state.canBuy('battle', id),
    buy: (id) => state.buy('battle', id),
  };
  const lottoDartSpec: TreeSpec = {
    level: 'dart',
    title: '🎫 彩票技能树',
    nodes: ALL_LOTTO_DART_NODES,
    nodeById: LOTTO_DART_NODE_BY_ID,
    edges: getLottoDartEdges(),
    branches: { combo: { name: '彩票', color: '#ffd45e' } },
    owned: (id) => state.unlockedLottoDart.has(id),
    prereqMet: (id) => LOTTO_DART_NODE_BY_ID[id]?.requires.every((r) => state.unlockedLottoDart.has(r)) ?? false,
    canBuy: (id) => {
      const node = LOTTO_DART_NODE_BY_ID[id];
      if (!node || state.unlockedLottoDart.has(id)) return false;
      if (state.coins < node.cost) return false;
      return node.requires.every((r) => state.unlockedLottoDart.has(r));
    },
    buy: (id) => state.buyLottoDart(id),
  };

  let treeTab: 'dart' | 'ticket' = 'dart';

  const modal = app.querySelector<HTMLDivElement>('#skillModal')!;
  const closeBtn = app.querySelector<HTMLButtonElement>('#closeSkill')!;
  const resetBtn = app.querySelector<HTMLButtonElement>('#resetBtn')!;
  const buyBtn = app.querySelector<HTMLButtonElement>('#buyBtn')!;
  const detailName = app.querySelector<HTMLDivElement>('#detailName')!;
  const detailDesc = app.querySelector<HTMLDivElement>('#detailDesc')!;
  const detailCost = app.querySelector<HTMLSpanElement>('#detailCost')!;
  const skillTitle = app.querySelector<HTMLDivElement>('#skillTitle')!;
  const skillLegend = app.querySelector<HTMLDivElement>('#skillLegend')!;

  let spec: TreeSpec = dartSpec;
  let selectedId: string | null = null;
  let justBoughtId: string | null = null;

  // 标签切换
  const tabDart = app.querySelector<HTMLButtonElement>('#tabDart')!;
  const tabTicket = app.querySelector<HTMLButtonElement>('#tabTicket')!;
  const treeTabs = app.querySelector<HTMLDivElement>('#treeTabs')!;
  function switchTreeTab(tab: 'dart' | 'ticket'): void {
    treeTab = tab;
    spec = tab === 'ticket' ? lottoDartSpec : dartSpec;
    tabDart.classList.toggle('active', tab === 'dart');
    tabTicket.classList.toggle('active', tab === 'ticket');
    skillTitle.textContent = spec.title;
    selectedId = null;
    buyBtn.disabled = true;
    detailName.textContent = '点选一个节点';
    detailDesc.textContent = '查看加成效果与购买';
    detailCost.textContent = '';
    renderTree();
    renderLegend();
  }
  tabDart.addEventListener('click', () => switchTreeTab('dart'));
  tabTicket.addEventListener('click', () => switchTreeTab('ticket'));

  function renderLegend(): void {
    skillLegend.innerHTML =
      Object.values(spec.branches)
        .map((b) => `<span style="color:${b.color}">● ${b.name}</span>`)
        .join('') + '<span class="legend-hint">点亮节点解锁加成，前置节点需先解锁</span>';
  }

  function openSkill(level: 'select' | LevelId | 'story'): void {
    if (level === 'select' || level === 'story') return;
    treeTab = 'dart';
    spec = level === 'lotto' ? lottoSpec : level === 'battle' ? battleSpec : dartSpec;
    tabTicket.hidden = !state.lottoTreeUnlocked;
    treeTabs.hidden = (level !== 'dart');
    tabDart.classList.toggle('active', true);
    tabTicket.classList.toggle('active', false);
    selectedId = null;
    skillTitle.textContent = spec.title;
    renderLegend();
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    renderTree();
    updateCoins();
  }
  const closeModal = () => {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  };
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  // Esc 关闭技能弹窗（键盘/无障碍）
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });

  resetBtn.addEventListener('click', () => {
    if (confirm('确定重置全部存档？（金币与技能全部清空）')) {
      state.reset();
      if (current === 'dart') game.syncAfterBuy();
      if (current === 'battle') battle.syncAfterBuy();
      selectedId = null;
      updateCoins();
      updateScore();
      updateCombo(0, 1);
      refreshLottoLock(); // 重置后 totalEarned=0，彩票关卡应重新锁定
      if (modal.classList.contains('open')) {
        renderTree();
        renderDetail();
      }
    }
  });

  buyBtn.addEventListener('click', () => {
    if (!selectedId) return;
    if (spec.buy(selectedId)) {
      audio.sfx('skill');
      if (spec.level === 'dart') game.syncAfterBuy();
      else if (spec.level === 'battle') battle.syncAfterBuy();
      // X1 购买后触发第五段剧情
      if (selectedId === 'X1') { closeModal(); story.startChapter(5); go('story'); return; }
      refreshCoins();
      justBoughtId = selectedId; // 标记刚解锁 → renderTree 画扩散光圈
      renderTree();
      renderDetail();
    }
  });

  // ---- 拓扑渲染 ----
  const svg = app.querySelector<SVGSVGElement>('#tree')!;

  // 视图变换（缩放/平移），闭包内维护。每次 renderTree 重建内容后重新应用。
  const view = { s: 1, tx: 0, ty: 0 };
  function applyView(): void {
    const s = Math.max(0.45, Math.min(3, view.s));
    view.s = s;
    const content = svg.querySelector<SVGGElement>('#treeContent');
    if (content) {
      content.setAttribute(
        'transform',
        `translate(${Math.round(view.tx * 100) / 100} ${Math.round(view.ty * 100) / 100}) scale(${Math.round(s * 100) / 100})`,
      );
    }
  }
  function resetView(): void {
    view.s = 1;
    view.tx = 0;
    view.ty = 0;
    applyView();
  }
  // 围绕屏幕坐标 (cx, cy) 缩放到新比例 newS，保持该点的世界坐标不动。
  function zoomAt(cx: number, cy: number, newS: number): void {
    const s0 = view.s;
    const s1 = Math.max(0.45, Math.min(3, newS));
    if (s1 === s0) {
      applyView();
      return;
    }
    // SVG 内部坐标系：用屏幕点到 svg 左上角的偏移再除以缩放（ptToSvg）。
    const pt = clientToSvg(cx, cy);
    // 世界点 wx = (pt - t0) / s0；缩放后应满足 pt = wx * s1 + t1 → t1 = pt - wx*s1
    const wx = (pt.x - view.tx) / s0;
    const wy = (pt.y - view.ty) / s0;
    view.s = s1;
    view.tx = pt.x - wx * s1;
    view.ty = pt.y - wy * s1;
    applyView();
  }
  // 屏幕坐标 → svg 内部坐标。必须用 getScreenCTM().inverse()，才能在
  // 祖先 CSS 变换（如 .game-root.rotated 的 90° 旋转）下依然正确。
  function clientToSvg(cx: number, cy: number): { x: number; y: number } {
    const m = svg.getScreenCTM();
    if (m) {
      const pt = svg.createSVGPoint();
      pt.x = cx;
      pt.y = cy;
      const p = pt.matrixTransform(m.inverse());
      return { x: p.x, y: p.y };
    }
    // 回退（极老浏览器无 CTM）：按未旋转处理。
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const vbW = vb && vb.width ? vb.width : rect.width;
    const vbH = vb && vb.height ? vb.height : rect.height;
    return {
      x: (cx - rect.left) * (vbW / rect.width),
      y: (cy - rect.top) * (vbH / rect.height),
    };
  }

  function nodeState(id: string): 'owned' | 'available' | 'locked' {
    if (spec.owned(id)) return 'owned';
    if (spec.prereqMet(id)) return 'available';
    return 'locked';
  }

  function renderTree(): void {
    svg.innerHTML = '';
    // 包裹组：所有边与节点都渲染进 #treeContent，便于整体施加视图变换。
    const content = svgEl('g', { id: 'treeContent' });
    svg.appendChild(content);
    const edges = spec.edges;

    // 边
    for (const e of edges) {
      const a = spec.nodeById[e.from];
      const b = spec.nodeById[e.to];
      const active = spec.owned(e.from) && spec.owned(e.to);
      const half = spec.owned(e.from) && !spec.owned(e.to) && spec.prereqMet(e.to);
      const line = svgEl('line', {
        x1: String(a.pos.x),
        y1: String(a.pos.y),
        x2: String(b.pos.x),
        y2: String(b.pos.y),
      });
      const bColor = spec.branches[b.branch]?.color ?? '#888';
      line.setAttribute(
        'stroke',
        active ? bColor : half ? bColor : '#3a3358',
      );
      line.setAttribute('stroke-width', active ? '0.9' : '0.6');
      line.setAttribute('stroke-dasharray', active ? '' : '1.6,1.4');
      content.appendChild(line);
    }

    // 节点
    // 成本文字先收集，循环末统一渲染到顶层 labelsG（见函数尾），确保不被
    // 后渲染节点的实心圆盘按 z 序盖住（成本文字原本画在节点 g 内部下方，
    // 整个 g 会被后续 append 的节点 g 整体覆盖）。
    const costEls: SVGElement[] = [];
    for (const node of spec.nodes) {
      const st = nodeState(node.id);
      const color = spec.branches[node.branch]?.color ?? '#888';
      const g = svgEl('g', { class: 'node' });
      g.setAttribute('transform', `translate(${node.pos.x},${node.pos.y})`);
      g.style.cursor = st === 'locked' ? 'not-allowed' : 'pointer';

      const r = node.id === spec.nodes[0].id ? 4.4 : 3.7;
      const owned = st === 'owned';
      // canBuy：available 且金币足够 —— 当前最该点的节点，单独给金色强脉冲。
      const canBuy = st === 'available' && spec.canBuy(node.id);
      // availPoor：前置已满足但金币不足 —— 路径已打通、就差钱，需独立区分于 locked。
      const availPoor = st === 'available' && !canBuy;

      // ① 透明大命中圆：扩大可点区域（移动端触摸目标）。半径取最近邻间距的一半
      //    （全树最小节点间距 10），既显著放大热区，又不与相邻 hit 圆重叠抢点。
      const hit = svgEl('circle', {
        class: 'hit',
        r: '5',
        fill: 'transparent',
        'pointer-events': 'all',
      });
      g.appendChild(hit);

      // ② 外环：owned 分支色；available（钱不够）也用分支色细环——路径已打通的归属标记，
      //    与 locked 的暗环区分，体现“这条线激活了，就差钱”的延续感。hover 由 CSS 提亮。
      const ring = svgEl('circle', {
        class: 'ring',
        r: String(r + 1.0),
        fill: 'none',
        stroke: owned
          ? color
          : canBuy
            ? '#ffd966'
            : st === 'available'
              ? color
              : '#332b52',
        'stroke-width': '0.6',
      });
      g.appendChild(ring);

      // ③ 圆盘四态：
      //   locked 前置未满足 → 灰 + 半透（锁死）；
      //   availPoor 前置满足但金币不足 → 淡分支色 + 分支色描边（路径已激活，就差钱）；
      //   canBuy 钱够可买 → 暗金底 + 金描边 + 脉冲（行动号召）；
      //   owned 已解锁 → 分支色实色（已点亮）。
      const dot = svgEl('circle', {
        class: 'dot',
        r: String(r),
        fill: owned ? color : canBuy ? '#3a2f10' : availPoor ? color : '#2a2a3c',
        'fill-opacity': availPoor ? '0.2' : '1',
        stroke: owned
          ? color
          : canBuy
            ? '#ffd966'
            : availPoor
              ? color
              : '#5a5670',
        'stroke-width': canBuy ? '1.1' : availPoor ? '0.8' : '0.5',
        opacity: st === 'locked' ? '0.5' : '1',
      });
      if (canBuy) dot.classList.add('avail');
      g.appendChild(dot);

      // 图标：未解锁（locked / 金币不足）去色变灰（.ico.dim）；owned 与 canBuy 保持彩色。
      const icon = svgEl('text', {
        class:
          st === 'locked' || (st === 'available' && !canBuy) ? 'ico dim' : 'ico',
        x: '0',
        y: '1.3',
        'text-anchor': 'middle',
        'font-size': '3.8',
      });
      icon.textContent = node.icon;
      g.appendChild(icon);

      // ④ 刚解锁的节点画一道扩散光圈（购买成功反馈，见 .unlock-burst 动画）。
      if (justBoughtId === node.id) {
        const burst = svgEl('circle', {
          class: 'unlock-burst',
          r: String(r + 0.5),
          fill: 'none',
          stroke: color,
          'stroke-width': '1.2',
        });
        g.appendChild(burst);
      }

      // ⑤ 原生 tooltip：hover 显示节点全名（桌面端；移动端长按部分浏览器支持）。
      const title = svgEl('title');
      title.textContent = `${node.icon} ${node.name}`;
      g.appendChild(title);

      // 成本：locked（前置未满足）的收费节点不显示价格——还早，价格只是视觉噪音；
      // owned 显示 ✓、canBuy 显示金色价、availPoor 显示暗灰价（让玩家知道目标价）。
      if (!(st === 'locked' && node.cost > 0)) {
        const cost = svgEl('text', {
          x: String(node.pos.x),
          y: String(node.pos.y + r + 4.0),
          'text-anchor': 'middle',
          'font-size': '2.6',
          // 深色描边底（paint-order 先描边后填充）：连线穿过文字时仍可读。
          'paint-order': 'stroke',
          stroke: '#0b0a1f',
          'stroke-width': '0.7',
          'stroke-linejoin': 'round',
          fill:
            node.cost > 0
              ? spec.canBuy(node.id)
                ? '#ffd966'
                : st === 'owned'
                  ? '#7df9ff'
                  : '#6a648c'
              : '#7df9ff',
        });
        cost.textContent =
          node.cost > 0 ? (st === 'owned' ? '✓' : `🪙${node.cost}`) : '起点';
        costEls.push(cost);
      }

      g.addEventListener('click', () => {
        // 拖拽刚结束时不触发选中，避免误点。
        if (wasDragging) return;
        selectedId = node.id;
        renderTree();
        renderDetail();
      });

      // ⑥ 选中圈：加粗 + 长虚线，密集区域更醒目。
      if (selectedId === node.id) {
        const sel = svgEl('circle', {
          class: 'sel',
          r: String(r + 1.8),
          fill: 'none',
          stroke: '#ffffff',
          'stroke-width': '0.7',
          'stroke-dasharray': '1.4,0.8',
        });
        g.insertBefore(sel, g.firstChild);
      }

      content.appendChild(g);
    }
    justBoughtId = null; // 扩散光圈只渲染一帧（动画由 CSS 自行播放完毕）

    // 文字层置顶：所有成本标签画在全部节点之上，杜绝被后渲染圆盘遮挡；
    // pointer-events:none 让点击穿透文字落到下方节点（避免文字挡住节点点击）。
    const labelsG = svgEl('g', { id: 'treeLabels', 'pointer-events': 'none' });
    content.appendChild(labelsG);
    for (const el of costEls) labelsG.appendChild(el);

    // 解锁进度
    modalProgressEl.textContent = `▣ ${spec.nodes.filter((n) => spec.owned(n.id)).length}/${spec.nodes.length}`;

    // 重建内容后重新应用当前视图变换。
    applyView();
  }

  // ---- 平移 / 缩放交互 ----
  // 模块标志：抑制拖拽尾随的 click 误触发节点选中。
  let wasDragging = false;
  // 多指（移动端双指捏合）状态。
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  let pinchS = 1;

  // 滚轮缩放（围绕光标）。
  svg.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    // deltaY>0 向下滚 → 缩小；向上 → 放大。步长按指数，手感平滑。
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(e.clientX, e.clientY, view.s * factor);
  }, { passive: false });

  // 拖拽平移 + 双指起点。
  svg.addEventListener('pointerdown', (e: PointerEvent) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      wasDragging = false;
    } else if (pointers.size === 2) {
      // 进入双指模式：记录初始距离与初始缩放。
      const pts = [...pointers.values()];
      pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchS = view.s;
    }
  });

  // 用窗口级监听，确保手指移出 svg 仍能跟手。
  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId)!;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2) {
      // 双指捏合：围绕两指中点缩放。
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchDist > 0) {
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        zoomAt(mid.x, mid.y, pinchS * (dist / pinchDist));
      }
      return;
    }

    // 单指拖拽平移：用 clientToSvg 把前后两点都映射到 svg 内部坐标，
    // 取其差作为平移量 —— 这样在祖先旋转/缩放下也跟手。
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (!wasDragging) {
      // 超过 5px 阈值才进入平移，避免微抖动判为拖拽。
      if (Math.hypot(dx, dy) < 5) return;
      wasDragging = true;
    }
    const a = clientToSvg(prev.x, prev.y);
    const b = clientToSvg(e.clientX, e.clientY);
    view.tx += b.x - a.x;
    view.ty += b.y - a.y;
    applyView();
  };
  const onPointerUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) {
      pinchDist = 0;
    }
    if (pointers.size === 0) {
      // 拖拽结束后短暂保留 wasDragging，让本帧的 click 被抑制后复位。
      if (wasDragging) {
        window.setTimeout(() => {
          wasDragging = false;
        }, 0);
      }
    }
  };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  // 双击重置视图。
  svg.addEventListener('dblclick', () => {
    resetView();
  });

  // 工具栏按钮：以 svg 中心为锚点缩放 / 重置。
  const zoomInBtn = app.querySelector<HTMLButtonElement>('#zoomIn')!;
  const zoomOutBtn = app.querySelector<HTMLButtonElement>('#zoomOut')!;
  const zoomResetBtn = app.querySelector<HTMLButtonElement>('#zoomReset')!;
  const centerOfSvg = () => {
    const r = svg.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  zoomInBtn.addEventListener('click', () => {
    const c = centerOfSvg();
    zoomAt(c.x, c.y, view.s * 1.2);
  });
  zoomOutBtn.addEventListener('click', () => {
    const c = centerOfSvg();
    zoomAt(c.x, c.y, view.s / 1.2);
  });
  zoomResetBtn.addEventListener('click', () => {
    resetView();
  });

  function renderDetail(): void {
    if (!selectedId) {
      detailName.textContent = '点选一个节点';
      detailDesc.textContent = '查看加成效果与购买';
      detailCost.textContent = '';
      buyBtn.disabled = true;
      buyBtn.textContent = '购买';
      return;
    }
    const node = spec.nodeById[selectedId];
    const branchName = spec.branches[node.branch]?.name ?? '';
    detailName.textContent = `${node.icon} ${node.name}${branchName ? ' · ' + branchName : ''}`;
    detailDesc.textContent = node.desc || '（无加成）';
    const st = nodeState(node.id);
    if (st === 'owned') {
      detailCost.textContent = '已解锁';
      buyBtn.disabled = true;
      buyBtn.textContent = '已拥有';
    } else if (st === 'locked') {
      detailCost.textContent = '需先解锁前置节点';
      buyBtn.disabled = true;
      buyBtn.textContent = '未达成';
    } else {
      const ok = spec.canBuy(node.id);
      detailCost.textContent = ok
        ? `🪙 ${node.cost}`
        : `🪙 ${node.cost}（金币不足）`;
      buyBtn.disabled = !ok;
      buyBtn.textContent = ok ? `购买 🪙${node.cost}` : '金币不足';
    }
  }

  // ----- 旋转切换（不依赖手机陀螺仪 / orientation 媒体查询；微信竖屏可用）-----
  const gameRoot = app.querySelector<HTMLDivElement>('#gameRoot')!;
  const rotateBtn = app.querySelector<HTMLButtonElement>('#rotateBtn')!;
  const applyRotate = (on: boolean) => {
    gameRoot.classList.toggle('rotated', on);
    rotateBtn.setAttribute('aria-pressed', String(on));
  };
  const storedRot = localStorage.getItem('pd-rotate');
  let rotated: boolean;
  if (storedRot === '1') rotated = true;
  else if (storedRot === '0') rotated = false;
  else rotated = window.innerHeight > window.innerWidth; // 首次按视口宽高比给默认值
  applyRotate(rotated);
  rotateBtn.addEventListener('click', () => {
    rotated = !rotated;
    localStorage.setItem('pd-rotate', rotated ? '1' : '0');
    applyRotate(rotated);
  });
  // 仅当用户未手动设定时，跟随视口变化自动调整
  window.addEventListener('resize', () => {
    if (localStorage.getItem('pd-rotate') !== null) return;
    const r = window.innerHeight > window.innerWidth;
    if (r !== rotated) {
      rotated = r;
      applyRotate(rotated);
    }
  });

  // ----- 音效开关 -----
  const muteBtn = app.querySelector<HTMLButtonElement>('#muteBtn')!;
  const syncMute = () => {
    const on = audio.isEnabled();
    muteBtn.textContent = on ? '🔊' : '🔈';
    muteBtn.setAttribute('aria-pressed', String(on));
  };
  syncMute();
  muteBtn.addEventListener('click', () => {
    audio.toggle();
    syncMute();
    // 切到开启时立即给一声反馈（同时也是手势，触发 AudioContext resume）
    if (audio.isEnabled()) audio.sfx('coin');
  });

  // 初始：停在关卡选择主页（飞镖循环不启动，进入飞镖关卡才 start）。
  refreshCoins();
  updateScore();
  return game;
}
