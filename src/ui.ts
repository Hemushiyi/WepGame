import { GameState, LOTTO_UNLOCK_TOTAL } from './shared/state';
import { Game } from './dart/game';
import { ALL_NODES, NODE_BY_ID, getEdges } from './dart/skills';
import { Lottery } from './lottery/lottery';
import { audio } from './shared/audio';
import type { SkillBranch } from './shared/types';

// ===== HUD + 拓扑技能树 UI =====

const SVG_NS = 'http://www.w3.org/2000/svg';

const BRANCH_COLOR: Record<SkillBranch | 'core', string> = {
  core: '#7df9ff',
  target: '#e43b44',
  speed: '#ffd966',
  pet: '#b561d8',
  combo: '#f5a23e',
};

const BRANCH_NAME: Record<SkillBranch, string> = {
  target: '🎯 目标',
  speed: '⚡ 速度',
  pet: '🐾 宠物',
  combo: '🔮 连击',
};

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
        <span class="stat" id="score">🎯 <b>0</b></span>
        <span class="stat" id="combo" hidden>🔥 <b>x1.0</b></span>
      </div>
      <div class="hud-title">PIXEL DART · 像素飞镖</div>
      <div class="hud-right">
        <button class="btn-rotate" id="rotateBtn" title="旋转画面（横/竖屏切换）" aria-pressed="false">🔄</button>
        <button class="btn-rotate btn-mute" id="muteBtn" title="开关音效" aria-pressed="true">🔊</button>
        <button class="btn-lotto" id="openLotto" title="刮刮乐 · 用金币博取奖金">🎰 彩票</button>
        <button class="btn-skill" id="openSkill">技能树 ▣</button>
      </div>
    </div>
    <div class="stage">
      <canvas id="game"></canvas>
    </div>

    <div class="modal" id="skillModal" aria-hidden="true">
      <div class="modal-card">
        <div class="modal-head">
          <div class="modal-title">技能拓扑 · SKILL TREE</div>
          <div class="modal-coins" id="modalCoins">🪙 0</div>
          <button class="btn-close" id="closeSkill">✕</button>
        </div>
        <div class="modal-legend">
          <span style="color:${BRANCH_COLOR.target}">● 目标</span>
          <span style="color:${BRANCH_COLOR.speed}">● 速度</span>
          <span style="color:${BRANCH_COLOR.pet}">● 宠物</span>
          <span style="color:${BRANCH_COLOR.combo}">● 技巧</span>
          <span class="legend-hint">点亮节点解锁加成，前置节点需先解锁</span>
        </div>
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
  const modalCoinsEl = app.querySelector<HTMLSpanElement>('#modalCoins')!;
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
  comboEl.hidden = false;
  updateCombo(0, 1);

  const canvas = app.querySelector<HTMLCanvasElement>('#game')!;
  const game = new Game(canvas, state, {
    onCoins: () => refreshCoins(),
    onScore: () => updateScore(),
    onCombo: (c, m) => updateCombo(c, m),
    onOnboard: (kind) => onboardShow(kind),
  });

  // ---- 刮刮乐（彩票关卡：累计获得达标后解锁）----
  const lottoBtn = app.querySelector<HTMLButtonElement>('#openLotto')!;

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
  const ONBOARD_COPY: Record<'entry' | 'bull' | 'wind', string> = {
    entry: '🎯 上下准星 + 左右方向，找准时机的交点出手！',
    bull: '💥 中心命中！连续命中可叠连击倍率',
    wind: '🌬️ 有风：飞镖会被吹偏，留意橙色预测落点',
  };
  // 函数声明（提升）：Game 构造期就能在闭包里引用，运行期才调用。
  function onboardShow(kind: 'entry' | 'bull' | 'wind'): void {
    if (onboardSeen.has(kind)) return;
    onboardSeen.add(kind);
    try {
      localStorage.setItem(ONBOARD_KEY, JSON.stringify([...onboardSeen]));
    } catch {
      /* 存储不可用时静默 */
    }
    showToast(ONBOARD_COPY[kind]);
  }

  const lottery = new Lottery(state, () => refreshCoins());

  // 关卡解锁状态：派生自 state.totalEarned，无需持久化。
  let lottoWasUnlocked = state.lottoUnlocked();
  function refreshLottoLock(): void {
    const unlocked = state.lottoUnlocked();
    lottoBtn.classList.toggle('locked', !unlocked);
    if (unlocked) {
      lottoBtn.innerHTML = '🎰 彩票';
      lottoBtn.title = '刮刮乐 · 用金币博取奖金';
      if (!lottoWasUnlocked) {
        lottoWasUnlocked = true;
        showToast('🎉 彩票关卡已解锁！');
        audio.sfx('unlock');
      }
    } else {
      lottoWasUnlocked = false;
      const cur = Math.min(state.totalEarned, LOTTO_UNLOCK_TOTAL);
      lottoBtn.innerHTML = `🔒 <b>${cur}/${LOTTO_UNLOCK_TOTAL}</b>`;
      lottoBtn.title = `累计获得 ${LOTTO_UNLOCK_TOTAL} 金币解锁彩票关卡`;
    }
  }
  lottoBtn.addEventListener('click', () => {
    if (!state.lottoUnlocked()) {
      showToast(
        `🔒 累计获得 ${LOTTO_UNLOCK_TOTAL} 金币解锁彩票（当前 ${state.totalEarned}）`,
      );
      return;
    }
    lottery.open();
  });
  refreshLottoLock();

  // 金币变动时同步 HUD、刮刮乐弹窗与彩票解锁状态（飞镖 earn 时保持新鲜）。
  // refreshCoins 是函数声明（提升），lottery / refreshLottoLock 在运行期已初始化。
  function refreshCoins(): void {
    updateCoins();
    lottery.syncCoins();
    refreshLottoLock();
  }

  // ---- 弹窗 ----
  const modal = app.querySelector<HTMLDivElement>('#skillModal')!;
  const openBtn = app.querySelector<HTMLButtonElement>('#openSkill')!;
  const closeBtn = app.querySelector<HTMLButtonElement>('#closeSkill')!;
  const resetBtn = app.querySelector<HTMLButtonElement>('#resetBtn')!;
  const buyBtn = app.querySelector<HTMLButtonElement>('#buyBtn')!;
  const detailName = app.querySelector<HTMLDivElement>('#detailName')!;
  const detailDesc = app.querySelector<HTMLDivElement>('#detailDesc')!;
  const detailCost = app.querySelector<HTMLSpanElement>('#detailCost')!;

  let selectedId: string | null = null;

  const openModal = () => {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    renderTree();
    updateCoins();
  };
  const closeModal = () => {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  };

  openBtn.addEventListener('click', openModal);
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
      game.syncAfterBuy();
      selectedId = null;
      updateCoins();
      updateScore();
      updateCombo(0, 1);
      refreshLottoLock(); // 重置后 totalEarned=0，彩票关卡应重新锁定
      renderTree();
      renderDetail();
    }
  });

  buyBtn.addEventListener('click', () => {
    if (!selectedId) return;
    if (state.buy(selectedId)) {
      audio.sfx('skill');
      game.syncAfterBuy();
      refreshCoins(); // 统一走 refreshCoins（含 lottery.syncCoins / refreshLottoLock）
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
    if (state.owned(id)) return 'owned';
    if (state.prereqMet(id)) return 'available';
    return 'locked';
  }

  function renderTree(): void {
    svg.innerHTML = '';
    // 包裹组：所有边与节点都渲染进 #treeContent，便于整体施加视图变换。
    const content = svgEl('g', { id: 'treeContent' });
    svg.appendChild(content);
    const edges = getEdges();

    // 边
    for (const e of edges) {
      const a = NODE_BY_ID[e.from];
      const b = NODE_BY_ID[e.to];
      const active = state.owned(e.from) && state.owned(e.to);
      const half = state.owned(e.from) && !state.owned(e.to) && state.prereqMet(e.to);
      const line = svgEl('line', {
        x1: String(a.pos.x),
        y1: String(a.pos.y),
        x2: String(b.pos.x),
        y2: String(b.pos.y),
      });
      line.setAttribute(
        'stroke',
        active ? BRANCH_COLOR[b.branch] : half ? '#8a82b8' : '#3a3358',
      );
      line.setAttribute('stroke-width', active ? '0.9' : '0.6');
      line.setAttribute('stroke-dasharray', active ? '' : '1.6,1.4');
      content.appendChild(line);
    }

    // 节点
    for (const node of ALL_NODES) {
      const st = nodeState(node.id);
      const color = BRANCH_COLOR[node.branch];
      const g = svgEl('g', { class: 'node' });
      g.setAttribute('transform', `translate(${node.pos.x},${node.pos.y})`);
      g.style.cursor = st === 'locked' ? 'not-allowed' : 'pointer';

      const r = node.id === 'core' ? 4.4 : 3.7;
      const ring = svgEl('circle', {
        r: String(r + 1.0),
        fill: 'none',
        stroke: st === 'owned' ? color : '#1c1838',
        'stroke-width': '0.6',
      });
      g.appendChild(ring);

      const fill =
        st === 'owned'
          ? color
          : st === 'available'
            ? '#241d44'
            : '#16122c';
      const dot = svgEl('circle', {
        r: String(r),
        fill,
        stroke: color,
        'stroke-width': st === 'available' ? '0.7' : '0.4',
        opacity: st === 'locked' ? '0.5' : '1',
      });
      if (st === 'available') dot.classList.add('avail');
      g.appendChild(dot);

      // 图标
      const icon = svgEl('text', {
        x: '0',
        y: '1.3',
        'text-anchor': 'middle',
        'font-size': '3.8',
      });
      icon.textContent = node.icon;
      g.appendChild(icon);

      // 成本
      if (node.cost > 0) {
        const cost = svgEl('text', {
          x: '0',
          y: String(r + 4.0),
          'text-anchor': 'middle',
          'font-size': '2.6',
          fill: state.canBuy(node.id)
            ? '#ffd966'
            : st === 'owned'
              ? '#7df9ff'
              : '#6a648c',
        });
        cost.textContent = st === 'owned' ? '✓' : `🪙${node.cost}`;
        g.appendChild(cost);
      } else {
        const cost = svgEl('text', {
          x: '0',
          y: String(r + 4.0),
          'text-anchor': 'middle',
          'font-size': '2.6',
          fill: '#7df9ff',
        });
        cost.textContent = '起点';
        g.appendChild(cost);
      }

      g.addEventListener('click', () => {
        // 拖拽刚结束时不触发选中，避免误点。
        if (wasDragging) return;
        selectedId = node.id;
        renderTree();
        renderDetail();
      });

      if (selectedId === node.id) {
        const sel = svgEl('circle', {
          r: String(r + 1.6),
          fill: 'none',
          stroke: '#ffffff',
          'stroke-width': '0.4',
          'stroke-dasharray': '1,1',
        });
        g.insertBefore(sel, g.firstChild);
      }

      content.appendChild(g);
    }

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
    const node = NODE_BY_ID[selectedId];
    detailName.textContent = `${node.icon} ${node.name} · ${BRANCH_NAME[node.branch]}`;
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
      const ok = state.canBuy(node.id);
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

  updateCoins();
  updateScore();
  return game;
}
