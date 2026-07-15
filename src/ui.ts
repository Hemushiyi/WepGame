import { GameState, LOTTO_UNLOCK_TOTAL, todayStr, META_DEFS } from './shared/state';
import { ACHIEVEMENTS, newlyCompleted } from './shared/achievements';
import { Game } from './dart/game';
import { ALL_NODES, NODE_BY_ID, getEdges } from './dart/skills';
import { ALL_LOTTO_NODES, LOTTO_NODE_BY_ID, getLottoEdges } from './lottery/skills';
import { ALL_BATTLE_NODES, BATTLE_NODE_BY_ID, getBattleEdges } from './battle/skills';
import { Battle, MODIFIERS, type Modifier, type RunBuffSummary } from './battle/game';
import { ALL_RPS_NODES, RPS_NODE_BY_ID, getRpsEdges } from './rps/skills';
import { RpsBattle } from './rps/game';
import { ALL_SHOOTER_NODES, SHOOTER_NODE_BY_ID, getShooterEdges } from './shooter/skills';
import { Shooter } from './shooter/game';
import { Lottery } from './lottery/lottery';
import { StoryMode } from './story/story';
import { ALL_LOTTO_DART_NODES, LOTTO_DART_NODE_BY_ID, getLottoDartEdges } from './story/lottoSkills';
import { audio } from './shared/audio';
import { settings } from './shared/settings';
import {
  MATERIALS,
  ADVANCED_MATERIALS,
  CRAFT_MAT_BY_ID,
  PATTERN_CHAR,
  patternMaterials,
  findCraftable,
  craftableById,
  WEAPONS,
  type CraftMatId,
  type Craftable,
} from './shared/weapons';
import { GEARS, GEAR_BY_ID, GEAR_BY_SLOT, SLOT_DEFS, SET_BY_ID, MAX_ITEM_LEVEL, type GearSlot, type GearBonus } from './shared/gear';
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

// ===== 关卡图标：统一像素画 =====
// 共用一套暖色调色板（橙 / 黄 / 红 + 暖白），与入口页主色一致；
// 用深红当轮廓替代黑色，整体不再出现冷暗色。在固定网格上用原语描点 → 输出 crispEdges SVG。
const PX = {
  o: '#a8201a', // 深红（轮廓，替代黑）
  g: '#ffce3a', // 金黄
  y: '#fff0a8', // 浅黄 / 高光
  c: '#ff8a1a', // 橙
  r: '#e8362f', // 红
  p: '#ff6a3d', // 橙红
  w: '#fff3df', // 暖白
  m: '#c97a33', // 暖棕
  e: '#ffb347', // 浅橙
  i: '#ff7a1a', // 深橙
  t: '#e89a4a', // 暖肤棕
  d: '#7a3411', // 暖棕面板
} as const;

interface PxApi {
  set: (x: number, y: number, c: string) => void;
  rect: (x: number, y: number, w: number, h: number, c: string) => void;
  disc: (cx: number, cy: number, r: number, c: string) => void;
  line: (x0: number, y0: number, x1: number, y1: number, c: string) => void;
  frame: (x: number, y: number, w: number, h: number, c: string) => void;
}

/** 像素画布：先填后描边（Map 保留最后写入者 = 后绘制覆盖先绘制），再拼成 crispEdges SVG */
function pxArt(size: number, draw: (api: PxApi) => void): string {
  const px = new Map<string, string>();
  const set = (x: number, y: number, c: string) => {
    if (x < 0 || y < 0 || x >= size || y >= size || !c) return;
    px.set(`${x},${y}`, c);
  };
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c);
  };
  const disc = (cx: number, cy: number, r: number, c: string) => {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) set(cx + x, cy + y, c);
  };
  const line = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    let dx = Math.abs(x1 - x0);
    let dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      set(x, y, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  };
  const frame = (x: number, y: number, w: number, h: number, c: string) => {
    rect(x, y, w, 1, c);
    rect(x, y + h - 1, w, 1, c);
    rect(x, y, 1, h, c);
    rect(x + w - 1, y, 1, h, c);
  };
  draw({ set, rect, disc, line, frame });
  let body = '';
  for (const [k, c] of px) {
    const [x, y] = k.split(',');
    body += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
  }
  return `<svg class="px-icon" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">${body}</svg>`;
}

const ICONS: Record<string, string> = {
  // 飞镖：同心靶 + 插入的镖
  dart: pxArt(15, (a) => {
    a.disc(7, 7, 7, PX.o);
    a.disc(7, 7, 6, PX.c);
    a.disc(7, 7, 4, PX.w);
    a.disc(7, 7, 3, PX.r);
    a.disc(7, 7, 1, PX.g);
    a.line(12, 3, 9, 6, PX.g); // 镖杆
    a.set(8, 6, PX.r); // 镖尖
    a.set(13, 2, PX.r);
    a.set(12, 2, PX.g); // 尾翼
  }),
  // 彩票站：老虎机（柜体 + 三转轮 + 拉杆）
  lotto: pxArt(15, (a) => {
    a.frame(2, 3, 11, 10, PX.o); // 柜体
    a.rect(3, 4, 9, 8, PX.d);
    a.frame(4, 5, 7, 4, PX.o); // 转轮窗
    a.rect(5, 6, 2, 2, PX.r); // 红
    a.rect(7, 6, 2, 2, PX.g); // 金
    a.rect(9, 6, 2, 2, PX.c); // 青
    a.rect(12, 2, 1, 4, PX.m); // 拉杆
    a.rect(11, 1, 3, 1, PX.m); // 拉杆球
    a.rect(3, 12, 9, 1, PX.o); // 出币口
  }),
  // 打怪场：交叉双剑 + 红宝石
  battle: pxArt(15, (a) => {
    a.line(3, 3, 11, 11, PX.w);
    a.line(4, 4, 10, 10, PX.w); // 左上→右下 白刃（加粗）
    a.line(11, 3, 3, 11, PX.c);
    a.line(10, 4, 4, 10, PX.c); // 右上→左下 青刃
    a.rect(5, 7, 5, 1, PX.g); // 护手
    a.set(7, 7, PX.r); // 中心红宝石
    a.set(2, 2, PX.g);
    a.set(13, 2, PX.g);
    a.set(2, 13, PX.g);
    a.set(13, 13, PX.g); // 四端柄头
  }),
  // 剧情模式：摊开的书
  story: pxArt(15, (a) => {
    a.rect(1, 4, 6, 8, PX.w); // 左页
    a.rect(8, 4, 6, 8, PX.w); // 右页
    a.frame(1, 4, 6, 8, PX.o);
    a.frame(8, 4, 6, 8, PX.o);
    a.rect(7, 4, 1, 8, PX.o); // 书脊
    a.line(3, 6, 5, 6, PX.m);
    a.line(3, 8, 5, 8, PX.m);
    a.line(3, 10, 5, 10, PX.m); // 左页文字
    a.line(9, 6, 11, 6, PX.m);
    a.line(9, 8, 11, 8, PX.m);
    a.line(9, 10, 11, 10, PX.m); // 右页文字
  }),
  // 锤剪布：拳头（拳为该玩法标志）
  rps: pxArt(15, (a) => {
    a.disc(7, 7, 5, PX.o);
    a.disc(7, 7, 4, PX.t); // 拳体
    a.disc(4, 9, 2, PX.o);
    a.disc(4, 9, 1, PX.t); // 拇指
    a.rect(4, 12, 7, 2, PX.c); // 腕带
    a.rect(4, 12, 7, 1, PX.o);
    a.set(5, 5, PX.t);
    a.set(7, 5, PX.t);
    a.set(9, 5, PX.t); // 指节凸起
  }),
  // 每日挑战：礼盒
  daily: pxArt(15, (a) => {
    a.rect(3, 7, 9, 6, PX.r); // 盒身
    a.frame(3, 7, 9, 6, PX.o);
    a.rect(2, 5, 11, 3, PX.r); // 盒盖
    a.frame(2, 5, 11, 3, PX.o);
    a.rect(7, 5, 1, 8, PX.g); // 竖丝带
    a.rect(3, 9, 9, 1, PX.g); // 横丝带
    a.disc(6, 4, 1, PX.g);
    a.disc(8, 4, 1, PX.g); // 蝴蝶结
    a.set(7, 4, PX.y); // 结
  }),
  // 弹幕射击：上行战机 + 尾焰
  shooter: pxArt(15, (a) => {
    a.set(7, 1, PX.c); // 机首
    a.rect(6, 2, 3, 6, PX.c); // 机身
    a.rect(7, 4, 1, 2, PX.w); // 驾驶舱
    a.set(4, 7, PX.c);
    a.set(5, 7, PX.c);
    a.set(5, 8, PX.c); // 左翼
    a.set(10, 7, PX.c);
    a.set(9, 7, PX.c);
    a.set(9, 8, PX.c); // 右翼
    a.rect(7, 8, 1, 2, PX.r); // 尾焰
    a.set(7, 10, PX.y);
    a.rect(6, 2, 1, 6, PX.o); // 机身轮廓
    a.rect(8, 2, 1, 6, PX.o);
    a.set(6, 1, PX.o);
    a.set(8, 1, PX.o);
  }),
};


export function buildApp(state: GameState): Game {
  const app = document.getElementById('app')!;

  app.innerHTML = `
    <div class="game-root" id="gameRoot">
    <div class="hud">
      <div class="hud-left">
        <span class="stat" id="coins">🪙 <b>0</b></span>
        <span class="stat" id="score" hidden>🎯 <b>0</b></span>
        <span class="stat" id="combo" hidden>🔥 <b>x1.0</b></span>
        <span class="stat" id="mats" hidden></span>
      </div>
      <div class="hud-title">PIXEL DART · 像素飞镖</div>
      <div class="hud-right">
        <button class="btn-rotate" id="homeBtn" title="返回关卡选择" hidden>🏠</button>
        <button class="btn-lotto" id="skillBtn" title="本关技能树" hidden>▣ 技能</button>
        <button class="btn-rotate" id="rotateBtn" title="旋转画面（横/竖屏切换）" aria-pressed="false">🔄</button>
        <button class="btn-rotate btn-mute" id="muteBtn" title="开关音效" aria-pressed="true">🔊</button>
        <button class="btn-lotto" id="lottoTreeBtn" title="彩票技能树" hidden>🎫</button>
        <button class="btn-rotate" id="settingsBtn" title="设置">⚙️</button>
      </div>
    </div>

    <div class="screens" id="screens">
      <!-- 关卡选择主页 -->
      <div class="screen screen-select active" id="screenSelect">
        <div class="select-header">
          <button class="achv-btn" id="openMeta" title="强化">🛒 强化</button>
          <div class="select-title-wrap">
            <div class="select-title">选择关卡 <span id="angelBadge" hidden>👼🏆</span></div>
            <div class="select-sub">点选一个关卡进入</div>
          </div>
          <button class="achv-btn" id="openAchv" title="成就">🏆 成就</button>
        </div>
        <div class="select-scroll">
        <div class="level-cards">
          <button class="level-card" id="cardDart">
            <span class="lv-icon">${ICONS.dart}</span>
            <span class="lv-name">飞镖场</span>
            <span class="lv-desc">投掷飞镖赚金币 · 连击倍率</span>
          </button>
          <button class="level-card" id="cardLotto">
            <span class="lv-icon">${ICONS.lotto}</span>
            <span class="lv-name">彩票站</span>
            <span class="lv-desc" id="lottoCardDesc">刮刮乐 · 博取奖金</span>
            <div class="lv-lock" id="lottoCardLock" hidden>
              <div class="lv-lock-track"><div class="lv-lock-fill" id="lottoCardFill"></div></div>
              <div class="lv-lock-text" id="lottoCardLockText">累计 0/500</div>
            </div>
          </button>
          <button class="level-card" id="cardBattle">
            <span class="lv-icon">${ICONS.battle}</span>
            <span class="lv-name">打怪场</span>
            <span class="lv-desc">横版打怪 · 点屏挥剑赚金币</span>
          </button>
          <button class="level-card" id="cardStory">
            <span class="lv-icon">${ICONS.story}</span>
            <span class="lv-name">剧情模式</span>
            <span class="lv-desc">跟随故事引导 · 探索游戏世界</span>
          </button>
          <button class="level-card" id="cardRps">
            <span class="lv-icon">${ICONS.rps}</span>
            <span class="lv-name">锤剪布</span>
            <span class="lv-desc">读心格斗 · 读懂暗示克敌</span>
          </button>
          <button class="level-card daily" id="cardDaily">
            <span class="lv-icon">${ICONS.daily}</span>
            <span class="lv-name">每日挑战</span>
            <span class="lv-desc" id="dailyDesc">每天一次 · 随机修饰词挑战</span>
          </button>
          <button class="level-card" id="cardShooter">
            <span class="lv-icon">${ICONS.shooter}</span>
            <span class="lv-name">弹幕射击</span>
            <span class="lv-desc">拖动战机 · 自动开火躲弹</span>
          </button>
          <button class="level-card" id="cardWorkshop">
            <span class="lv-icon">${ICONS.battle}</span>
            <span class="lv-name">武器工坊</span>
            <span class="lv-desc">用打怪掉的材料合成/切换武器</span>
          </button>
        </div>
        <div class="select-footer" id="selectFooter" hidden>
          <span class="final-angel">👼</span>
          <span class="final-text">🎉 恭喜你完成最终成就！🎉</span>
          <span class="final-angel">👼</span>
        </div>
        </div>
      </div>

      <!-- 飞镖关卡 -->
      <div class="screen screen-dart" id="screenDart">
        <canvas id="game"></canvas>
      </div>

      <!-- 打怪关卡 -->
      <div class="screen screen-battle" id="screenBattle">
        <canvas id="battleCanvas"></canvas>
        <div class="battle-stats" id="battleStats"></div>
        <button class="ult-btn" id="battleUlt" disabled title="怒气满后释放旋风斩"><span class="ult-ico">💢</span><span class="ult-lbl">旋风斩</span></button>
        <div class="wave-pick" id="wavePick" hidden>
          <div class="wave-pick-title">🔥 波次奖励 · 3 选 1</div>
          <div class="wave-pick-choices" id="wavePickChoices"></div>
        </div>
      </div>

      <!-- 锤剪布关卡：画布 + 出招按钮 -->
      <div class="screen screen-rps" id="screenRps">
        <canvas id="rpsCanvas"></canvas>
        <button class="ult-btn ult-rps" id="rpsUlt" disabled title="怒气满后释放必胜一击"><span class="ult-ico">⭐</span><span class="ult-lbl">必胜一击</span></button>
        <div class="rps-controls" id="rpsControls">
          <button class="rps-btn" data-move="rock">🔨<span>锤</span></button>
          <button class="rps-btn" data-move="scissors">✂️<span>剪</span></button>
          <button class="rps-btn" data-move="paper">📜<span>布</span></button>
        </div>
      </div>

      <!-- 弹幕射击关卡 -->
      <div class="screen screen-shooter" id="screenShooter">
        <canvas id="shooterCanvas"></canvas>
      </div>

      <!-- 彩票关卡（Lottery 类挂这里） -->
      <div class="screen screen-lotto" id="screenLotto"></div>

      <!-- 剧情模式 -->
      <div class="screen screen-story" id="screenStory"></div>

      <!-- 武器工坊 -->
      <div class="screen screen-workshop" id="screenWorkshop">
        <div class="workshop-inner" id="workshopInner"></div>
      </div>
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
          <svg id="tree" viewBox="-8 -8 124 118" preserveAspectRatio="xMidYMid meet"></svg>
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

    <!-- 成就面板 -->
    <div class="modal" id="achvModal" aria-hidden="true">
      <div class="modal-card achv-card">
        <div class="modal-head">
          <div class="modal-title">🏆 成就</div>
          <div class="modal-progress" id="achvProgress">0/0</div>
          <button class="btn-close" id="closeAchv">✕</button>
        </div>
        <div class="achv-list" id="achvList"></div>
      </div>
    </div>

    <!-- 设置面板 -->
    <div class="modal" id="settingsModal" aria-hidden="true">
      <div class="modal-card settings-card">
        <div class="modal-head">
          <div class="modal-title">⚙️ 设置</div>
          <button class="btn-close" id="closeSettings">✕</button>
        </div>
        <div class="settings-body" id="settingsBody"></div>
      </div>
    </div>

    <!-- 强化商店（meta） -->
    <div class="modal" id="metaModal" aria-hidden="true">
      <div class="modal-card meta-card">
        <div class="modal-head">
          <div class="modal-title">🛒 强化商店</div>
          <div class="modal-coins" id="metaCoins">🪙 0</div>
          <button class="btn-close" id="closeMeta">✕</button>
        </div>
        <div class="meta-hint">跨关永久强化 · 金币的长期出口</div>
        <div class="meta-list" id="metaList"></div>
      </div>
    </div>
  `;

  const coinsEl = app.querySelector<HTMLSpanElement>('#coins b')!;
  const scoreEl = app.querySelector<HTMLSpanElement>('#score b')!;
  const scoreStat = app.querySelector<HTMLSpanElement>('#score')!;
  const matsEl = app.querySelector<HTMLSpanElement>('#mats')!;
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
  const screenRps = app.querySelector<HTMLDivElement>('#screenRps')!;
  const screenShooter = app.querySelector<HTMLDivElement>('#screenShooter')!;
  const screenWorkshop = app.querySelector<HTMLDivElement>('#screenWorkshop')!;
  const workshopInner = app.querySelector<HTMLDivElement>('#workshopInner')!;
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
  const battleUltBtn = app.querySelector<HTMLButtonElement>('#battleUlt')!;
  const battleStatsEl = app.querySelector<HTMLDivElement>('#battleStats')!;
  const wavePick = app.querySelector<HTMLDivElement>('#wavePick')!;
  const wavePickChoices = app.querySelector<HTMLDivElement>('#wavePickChoices')!;
  const battle = new Battle(battleCanvas, state, {
    onCoins: () => refreshCoins(),
    onUlt: (ready) => {
      battleUltBtn.disabled = !ready;
      battleUltBtn.classList.toggle('ready', ready);
    },
    onWavePick: (choices, onChoose) => {
      wavePickChoices.innerHTML = '';
      for (const b of choices) {
        const btn = document.createElement('button');
        btn.className = 'wave-pick-btn';
        btn.innerHTML = `<span class="wp-ico">${b.icon}</span><span class="wp-name">${b.name}</span>`;
        btn.addEventListener('click', () => {
          onChoose(b);
          wavePick.hidden = true;
        });
        wavePickChoices.appendChild(btn);
      }
      wavePick.hidden = false;
    },
    onDailyEnd: (score) => {
      // 每日挑战死亡结算：发奖 + 标记今日已做 + 返回主页
      const bonus = state.claimDaily(score);
      showToast(`🎁 每日挑战 · 击杀 ${score} · +🪙${bonus}`);
      refreshLottoLock();
      refreshDaily();
      go('select');
    },
    onBuffs: (s) => setBattleBuffs(s),
    onMaterials: () => refreshMaterials(),
  });
  battleUltBtn.addEventListener('click', () => battle.ultimate());

  // ---- 打怪本局增益看板：波次 3 选 1 累计的临时增益（图标 + 参数进度条）----
  // 数据由 Battle 在 start()/选完增益后通过 onBuffs 回调推送。
  function setBattleBuffs(s: RunBuffSummary): void {
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    // 进度条相对各增益的“里程碑”软上限（本局可累加，封顶 100%）。
    const rows = [
      { ico: '⚔️', name: '伤害', pct: clamp(s.dmg / 12), val: '+' + s.dmg },
      { ico: '⚡', name: '攻速', pct: clamp(-s.cd / 360), val: (s.cd < 0 ? '+' + -s.cd + 'ms' : '0') },
      { ico: '❤️', name: '血量', pct: clamp(s.maxHp / 120), val: '+' + s.maxHp },
      { ico: '🩸', name: '吸血', pct: clamp(s.lifesteal / 5), val: '+' + s.lifesteal },
      { ico: '💥', name: '暴击', pct: clamp(s.crit / 0.75), val: '+' + Math.round(s.crit * 100) + '%' },
      { ico: '💰', name: '金币', pct: clamp(s.coin / 1), val: '+' + Math.round(s.coin * 100) + '%' },
      { ico: '💢', name: '怒气', pct: clamp(s.rage / 60), val: '+' + s.rage },
    ];
    // 同类增益叠成一个图标 + 右下角数量徽标，避免越拿越多撑爆看板
    const groups = new Map<string, { icon: string; name: string; count: number }>();
    for (const p of s.picks) {
      const g = groups.get(p.icon);
      if (g) g.count++;
      else groups.set(p.icon, { icon: p.icon, name: p.name, count: 1 });
    }
    const icons = [...groups.values()]
      .map(
        (g) =>
          `<span class="bs-ico" title="${g.name}${g.count > 1 ? ` ×${g.count}` : ''}">${g.icon}${
            g.count > 1 ? `<i class="bs-badge">${g.count}</i>` : ''
          }</span>`,
      )
      .join('');
    battleStatsEl.innerHTML =
      `<div class="bs-head">🎯 本局增益${s.picks.length ? ` <span class="bs-count">×${s.picks.length}</span>` : ''}</div>` +
      (icons ? `<div class="bs-icons">${icons}</div>` : `<div class="bs-empty">清波次后 3 选 1 获得增益</div>`) +
      '<div class="bs-rows">' +
      rows
        .filter((r) => r.pct > 0) // 仅列出本局已获得的增益
        .map(
          (r) =>
            `<div class="bs-row"><span class="bs-label">${r.ico} ${r.name}</span>` +
            `<div class="bs-bar"><div class="bs-fill" style="width:${Math.round(r.pct * 100)}%"></div></div>` +
            `<span class="bs-val">${r.val}</span></div>`,
        )
        .join('') +
      '</div>';
  }

  // ---- 每日挑战 ----
  /** 按今日日期确定性选一个修饰词（同一天所有人相同） */
  function dailyModifier(): Modifier {
    const s = todayStr();
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return MODIFIERS[h % MODIFIERS.length];
  }
  const dailyDesc = app.querySelector<HTMLSpanElement>('#dailyDesc')!;
  function refreshDaily(): void {
    const mod = dailyModifier();
    const avail = state.dailyAvailable();
    const card = app.querySelector<HTMLButtonElement>('#cardDaily')!;
    card.classList.toggle('locked', !avail);
    dailyDesc.textContent = avail
      ? `今日: ${mod.icon}${mod.name} · 按击杀领奖`
      : '✅ 今日已完成 · 明日刷新';
  }
  app.querySelector<HTMLButtonElement>('#cardDaily')!.addEventListener('click', () => {
    if (!state.dailyAvailable()) {
      showToast('✅ 今天的每日挑战已完成，明日再来！');
      return;
    }
    go('battle');
    battle.startDaily(dailyModifier());
  });
  refreshDaily();

  // ---- 锤剪布（页面，画布 + 三按钮）----
  const rpsCanvas = app.querySelector<HTMLCanvasElement>('#rpsCanvas')!;
  const rpsUltBtn = app.querySelector<HTMLButtonElement>('#rpsUlt')!;
  const rps = new RpsBattle(rpsCanvas, state, {
    onCoins: () => refreshCoins(),
    onUlt: (ready) => {
      rpsUltBtn.disabled = !ready;
      rpsUltBtn.classList.toggle('ready', ready);
    },
  });
  rpsUltBtn.addEventListener('click', () => rps.ultimate());
  type RpsMove = 'rock' | 'paper' | 'scissors';
  for (const btn of app.querySelectorAll<HTMLButtonElement>('#rpsControls .rps-btn')) {
    btn.addEventListener('click', () => rps.choose(btn.dataset.move as RpsMove));
  }

  // ---- 弹幕射击（页面，画布）----
  const shooterCanvas = app.querySelector<HTMLCanvasElement>('#shooterCanvas')!;
  const shooter = new Shooter(shooterCanvas, state, { onCoins: () => refreshCoins() });

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

  // ---- 武器工坊：合成台（拖拽摆放材料）+ 武器图鉴/装备 ----
  const wsGrid: (CraftMatId | null)[] = Array(9).fill(null);
  let wsDrag: { mat: CraftMatId; fromCell: number | null; ghost: HTMLDivElement } | null = null;
  function wsPlaced(mat: CraftMatId): number {
    return wsGrid.filter((x) => x === mat).length;
  }
  function wsClearGrid(): void {
    for (let i = 0; i < 9; i++) wsGrid[i] = null;
  }
  let wsTarget: string | null = null; // 当前选中的图纸（合成台显示其引导图样）
  let wsBpOpen = false; // 图纸面板是否展开
  let wsTab: 'advanced' | 'weapon' | 'gear' = 'advanced'; // 图纸面板当前分类
  let wsGearOpen: GearSlot | null = null; // 装备槽选择弹窗（哪个槽）
  function renderWorkshop(): void {
    const eq = state.equippedWeapon;
    const ico = (m: CraftMatId | null) => (m ? CRAFT_MAT_BY_ID[m].icon : '');
    const invMats = [...MATERIALS, ...ADVANCED_MATERIALS] as { id: CraftMatId; name: string; icon: string }[];
    // 选中的图纸（高级材料/武器/装备）及其每格目标材料
    const target = wsTarget ? craftableById(wsTarget) ?? null : null;
    const targetAt = (i: number): CraftMatId | null => {
      if (!target) return null;
      const r = Math.floor(i / 3);
      const c = i % 3;
      return PATTERN_CHAR[target.recipe[r][c]] ?? null;
    };
    // 背包（基础+高级材料库存，九宫格拖拽源）
    const invBar = invMats.map((m) => {
      const avail = state.materialCount(m.id) - wsPlaced(m.id);
      const dis = avail <= 0 ? ' disabled' : '';
      return `<button class="ws-sel${dis}" data-mat="${m.id}" title="${m.name} · 拖到合成台"><span class="ws-sel-ico">${m.icon}</span><b>${avail}</b></button>`;
    }).join('');
    // 图纸：每张可合成武器的图样 + 状态；点选 → 合成台显示引导
    const patHtml = (pat: string[]): string => {
      let h = '<div class="ws-pat">';
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) {
          const m = PATTERN_CHAR[pat[r][c]] ?? null;
          h += `<span class="ws-pat-cell${m ? '' : ' empty'}">${ico(m)}</span>`;
        }
      return h + '</div>';
    };
    // 材料数量摘要：图样里每种材料各需要几个
    const needStr = (pat: string[]): string => {
      const need = patternMaterials(pat);
      return Object.entries(need)
        .map(([m, n]) => `${CRAFT_MAT_BY_ID[m as CraftMatId].icon}×${n}`)
        .join(' ');
    };
    // 装备加成摘要
    const gearBonusStr = (b: GearBonus): string => {
      const parts: string[] = [];
      if (b.dmgAdd) parts.push(`伤害+${b.dmgAdd}`);
      if (b.hpAdd) parts.push(`血量+${b.hpAdd}`);
      if (b.critAdd) parts.push(`暴击+${Math.round(b.critAdd * 100)}%`);
      if (b.lsAdd) parts.push(`吸血+${b.lsAdd}`);
      if (b.coinAdd) parts.push(`金币+${Math.round(b.coinAdd * 100)}%`);
      if (b.cdAdd) parts.push(`攻速${b.cdAdd}ms`);
      return parts.join(' / ') || '—';
    };
    // 装备槽选择弹窗
    const gearPickOverlay = (slot: GearSlot): string => {
      const sd = SLOT_DEFS.find((s) => s.id === slot)!;
      const ownedGear = GEAR_BY_SLOT[slot].filter((g) => state.gearOwned(g.id));
      const cur = state.equippedGearDef(slot);
      const items = ownedGear
        .map((g) => `<button class="ws-gear-pick${cur?.id === g.id ? ' cur' : ''}" data-geqpick="${g.id}"><span class="ws-gp-ico">${g.icon}</span><span class="ws-gp-name">${g.name} Lv.${state.gearLevel(g.id)}</span><span class="ws-gp-bonus">${gearBonusStr(g.bonus)}</span></button>`)
        .join('');
      return `<div class="ws-overlay" id="wsGearOverlay"><div class="ws-overlay-card ws-gear-card">` +
        `<div class="ws-overlay-head">${sd.icon} ${sd.name}<button class="ws-bpbtn" id="wsGearClose">✕</button></div>` +
        `<div class="ws-gear-list">${items || '<div class="ws-need">尚未合成该槽装备</div>'}</div>` +
        (cur ? `<button class="ws-gear-uneq" data-unequip="${slot}">卸下当前</button>` : '') +
        `</div></div>`;
    };
    // 通用图纸卡片（高级材料/武器/装备）
    const cardHtml = (c: Craftable): string => {
      let st: string, stc: string;
      if (c.kind === 'advanced') {
        const can = state.canCraft(c.id);
        st = can ? '可合成' : '缺材料';
        stc = can ? 'ready' : 'lack';
      } else {
        const owned = c.kind === 'weapon' ? state.weaponOwned(c.id) : state.gearOwned(c.id);
        const can = state.canCraft(c.id);
        st = owned ? '已拥有' : can ? '可合成' : '缺材料';
        stc = owned ? 'owned' : can ? 'ready' : 'lack';
      }
      let extra = '';
      if (c.kind === 'weapon') {
        const w = WEAPONS.find((x) => x.id === c.id)!;
        extra = `<div class="ws-bp-skill">${w.skill.icon} ${w.skill.name}</div><div class="ws-bp-charge">蓄力 ${w.charge.icon} ${w.charge.name}</div>`;
      } else if (c.kind === 'gear') {
        const gd = GEAR_BY_ID[c.id];
        const sd = SET_BY_ID[gd.set];
        extra = `<div class="ws-bp-gear">${sd ? `<span class="ws-set">${sd.icon}${sd.name}套</span> · ` : ''}${gearBonusStr(gd.bonus)}</div>`;
      } else {
        extra = `<div class="ws-bp-charge">高级材料</div>`;
      }
      return `<button class="ws-bp${wsTarget === c.id ? ' active' : ''}${stc === 'owned' ? ' done' : ''}" data-bp="${c.id}">
        <div class="ws-bp-head"><span class="ws-bp-ico">${c.icon}</span><span class="ws-bp-name">${c.name}</span><span class="ws-bp-st ${stc}">${st}</span></div>
        ${patHtml(c.recipe)}
        <div class="ws-need">需 ${needStr(c.recipe)}</div>
        ${extra}
      </button>`;
    };
    const tabList: Craftable[] =
      wsTab === 'weapon'
        ? WEAPONS.filter((w) => w.recipe).map((w) => craftableById(w.id)!)
        : wsTab === 'gear'
          ? GEARS.map((g) => craftableById(g.id)!)
          : ADVANCED_MATERIALS.map((a) => craftableById(a.id)!);
    const blueprints = tabList.map(cardHtml).join('');
    const tabsHtml = `<div class="ws-tabs">` +
      `<button class="ws-tab${wsTab === 'advanced' ? ' active' : ''}" data-tab="advanced">材料</button>` +
      `<button class="ws-tab${wsTab === 'weapon' ? ' active' : ''}" data-tab="weapon">武器</button>` +
      `<button class="ws-tab${wsTab === 'gear' ? ' active' : ''}" data-tab="gear">装备</button>` +
      `</div>`;
    // 3×3 合成台（含目标图纸的淡色引导）
    const grid = `<div class="ws-grid">${wsGrid
      .map((m, i) => {
        const t = targetAt(i);
        const guide = !m && t ? `<span class="ws-guide">${ico(t)}</span>` : '';
        const wrong = m && t && m !== t ? ' wrong' : '';
        return `<button class="ws-cell${m ? ' filled' : ''}${wrong}" data-cell="${i}">${ico(m)}${guide}</button>`;
      })
      .join('')}</div>`;
    // 输出：摆放匹配某可合成物 → 给出产物
    const matched = findCraftable(wsGrid);
    let outSlot: string;
    if (matched) {
      const owned = matched.kind === 'weapon' ? state.weaponOwned(matched.id) : matched.kind === 'gear' ? state.gearOwned(matched.id) : false;
      if (owned) outSlot = `<div class="ws-out owned">${matched.icon}<span>已拥有</span></div>`;
      else outSlot = `<button class="ws-out ready" data-craft="${matched.id}">${matched.icon}<span>合成</span></button>`;
    } else {
      outSlot = `<div class="ws-out empty">${target ? target.icon : '?'}</div>`;
    }
    // 我的武器（装备）
    const weapons = state
      .allWeapons()
      .filter((w) => state.weaponOwned(w.id))
      .map((w) => {
        const isEq = eq === w.id;
        const lv = state.weaponLevel(w.id);
        return isEq
          ? `<button class="ws-equip cur" disabled>${w.icon} ${w.name} Lv.${lv} ✓</button>`
          : `<button class="ws-equip" data-equip="${w.id}">${w.icon} ${w.name} Lv.${lv}</button>`;
      })
      .join('');
    // 装备槽（头盔/护甲/靴子）
    const gearSlots = SLOT_DEFS.map((s) => {
      const g = state.equippedGearDef(s.id);
      return `<button class="ws-gear-slot${g ? ' filled' : ''}" data-slot="${s.id}" title="${s.name}">${g ? g.icon : `<span class="ws-gear-empty">${s.icon}</span>`}</button>`;
    }).join('');
    // 强化区：当前武器 + 3 装备槽，各列等级/消耗/升级按钮
    const upgradeRow = (kind: 'weapon' | 'gear', id: string, icon: string, name: string): string => {
      const lvl = kind === 'weapon' ? state.weaponLevel(id) : state.gearLevel(id);
      const cost = state.upgradeCost(kind, id);
      const can = state.canUpgrade(kind, id);
      const right = !cost
        ? `<span class="ws-up-max">满级</span>`
        : `<button class="ws-up-btn${can ? '' : ' disabled'}" data-up="${kind}:${id}"${can ? '' : ' disabled'}>Lv.${lvl}→${lvl + 1}<span>🪙${cost.gold} · ⚙️${cost.fineIron}</span></button>`;
      return `<div class="ws-upgrade-row"><span class="ws-up-ico">${icon}</span><span class="ws-up-name">${name} <i>Lv.${lvl}</i></span>${right}</div>`;
    };
    const eqWeapon = state.equippedWeaponDef();
    const upgradeRows =
      upgradeRow('weapon', eqWeapon.id, eqWeapon.icon, eqWeapon.name) +
      SLOT_DEFS.map((s) => {
        const g = state.equippedGearDef(s.id);
        return g
          ? upgradeRow('gear', g.id, g.icon, g.name)
          : `<div class="ws-upgrade-row"><span class="ws-up-ico">${s.icon}</span><span class="ws-up-name">${s.name} <i>未装备</i></span><span class="ws-up-max">—</span></div>`;
      }).join('');
    // 战力面板（实时总属性）
    const p = state.effectiveBattleStats();
    const statsHtml =
      `<div class="ws-stats">` +
      `<div class="ws-stat-power">⚔️ 战力 <b>${p.power}</b></div>` +
      `<div class="ws-stat-grid">` +
      `<span>伤害 <b>${p.damage}</b></span><span>血量 <b>${p.maxHp}</b></span>` +
      `<span>暴击 <b>${Math.round(p.crit * 100)}%</b></span><span>吸血 <b>${p.lifesteal}</b></span>` +
      `<span>攻速 <b>${p.cooldown}ms</b></span><span>金币 <b>+${Math.round(p.coinBonus * 100)}%</b></span>` +
      `</div>` +
      `<div class="ws-stat-w">${p.weapon.icon} ${p.weapon.name} Lv.${p.weapon.level} · 蓄力 ${p.weapon.chargeName}</div>` +
      (p.setActive ? `<div class="ws-stat-set">${p.setActive.icon} ${p.setActive.name}套 (${p.setActive.count}/3) 已激活</div>` : '') +
      `</div>`;

    const targetName = target ? `${target.icon} ${target.name}` : '（点 📜 选图纸）';
    const targetNeed = target ? ` · 需 ${needStr(target.recipe)}` : '';
    workshopInner.innerHTML =
      `<div class="ws-top"><button class="ws-back" id="wsBack">🏠 返回</button>` +
      `<div class="ws-title">⚒️ 武器工坊</div>` +
      `<button class="ws-bpbtn" id="wsBpBtn">📜 图纸</button></div>` +
      `<div class="ws-main">` +
      `<div class="ws-table"><div class="ws-curtarget">合成台 · ${targetName}${targetNeed}</div>` +
      `<div class="ws-craftrow">${grid}<div class="ws-arrow">➜</div>${outSlot}</div>` +
      `<button class="ws-clear" id="wsClear">↺ 清空合成台</button></div>` +
      `<div class="ws-side">` +
      `<div class="ws-sec">📦 背包<span>基础+高级材料</span></div>` +
      `<div class="ws-selbar">${invBar}</div>` +
      `</div></div>` +
      `<div class="ws-stats-wrap">${statsHtml}</div>` +
      `<div class="ws-owned-wrap"><div class="ws-sec">⚔️ 我的武器<span>点选切换装备</span></div><div class="ws-owned">${weapons}</div>` +
      `<div class="ws-sec">🛡️ 装备<span>点选槽位装备</span></div><div class="ws-gear-row">${gearSlots}</div></div>` +
      `<div class="ws-owned-wrap"><div class="ws-sec">⬆️ 强化<span>消耗 金币+精铁 · 满级 ${MAX_ITEM_LEVEL}</span></div><div class="ws-upgrade">${upgradeRows}</div></div>` +
      (wsBpOpen
        ? `<div class="ws-overlay" id="wsOverlay"><div class="ws-overlay-card">` +
          `<div class="ws-overlay-head">📜 图纸（点选加载到合成台）<button class="ws-bpbtn" id="wsBpClose">✕</button></div>` +
          `${tabsHtml}<div class="ws-bps">${blueprints}</div></div></div>`
        : '') +
      (wsGearOpen ? gearPickOverlay(wsGearOpen) : '');

    // 事件
    workshopInner.querySelector('#wsBack')!.addEventListener('click', () => go('select'));
    workshopInner.querySelector('#wsBpBtn')!.addEventListener('click', () => {
      wsBpOpen = true;
      renderWorkshop();
    });
    const bpClose = workshopInner.querySelector('#wsBpClose');
    if (bpClose) bpClose.addEventListener('click', () => { wsBpOpen = false; renderWorkshop(); });
    const overlay = workshopInner.querySelector('#wsOverlay');
    if (overlay)
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { wsBpOpen = false; renderWorkshop(); }
      });
    workshopInner.querySelector('#wsClear')!.addEventListener('click', () => {
      wsClearGrid();
      renderWorkshop();
    });
    workshopInner.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => { wsTab = b.dataset.tab as typeof wsTab; renderWorkshop(); }),
    );
    workshopInner.querySelectorAll<HTMLButtonElement>('[data-bp]').forEach((b) =>
      b.addEventListener('click', () => {
        wsTarget = wsTarget === b.dataset.bp ? null : (b.dataset.bp ?? null);
        wsBpOpen = false;
        renderWorkshop();
      }),
    );
    workshopInner.querySelectorAll<HTMLButtonElement>('[data-craft]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.craft!;
        const name = craftableById(id)?.name ?? id;
        if (state.craft(id)) {
          audio.sfx('unlock');
          showToast(`✅ 合成成功：${name}`);
          wsClearGrid();
          renderWorkshop();
        }
      }),
    );
    workshopInner.querySelectorAll<HTMLButtonElement>('[data-equip]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.equip!;
        state.equipWeapon(id);
        audio.sfx('skill');
        showToast(`⚔️ 已装备 ${WEAPONS.find((w) => w.id === id)?.name}`);
        renderWorkshop();
      }),
    );
    workshopInner.querySelectorAll<HTMLButtonElement>('[data-up]').forEach((b) =>
      b.addEventListener('click', () => {
        const [kind, id] = (b.dataset.up ?? '').split(':') as ['weapon' | 'gear', string];
        if (state.upgrade(kind, id)) {
          audio.sfx('skill');
          showToast('⬆️ 强化成功');
          renderWorkshop();
        }
      }),
    );
    workshopInner.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b) =>
      b.addEventListener('click', () => { wsGearOpen = b.dataset.slot as GearSlot; renderWorkshop(); }),
    );
    const gearClose = workshopInner.querySelector('#wsGearClose');
    if (gearClose) gearClose.addEventListener('click', () => { wsGearOpen = null; renderWorkshop(); });
    const gearOverlay = workshopInner.querySelector('#wsGearOverlay');
    if (gearOverlay)
      gearOverlay.addEventListener('click', (e) => { if (e.target === gearOverlay) { wsGearOpen = null; renderWorkshop(); } });
    workshopInner.querySelectorAll<HTMLButtonElement>('[data-geqpick]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.geqpick!;
        const slot = wsGearOpen!;
        state.equipGear(slot, id);
        audio.sfx('skill');
        showToast(`🛡️ 已装备 ${GEAR_BY_ID[id].name}`);
        wsGearOpen = null;
        renderWorkshop();
      }),
    );
    const uneq = workshopInner.querySelector<HTMLButtonElement>('[data-unequip]');
    if (uneq)
      uneq.addEventListener('click', () => {
        state.unequipGear(uneq.dataset.unequip as GearSlot);
        audio.sfx('skill');
        wsGearOpen = null;
        renderWorkshop();
      });
  }

  // ---- 合成台拖拽（pointer 通用，支持触屏）----
  const wsMoveGhost = (x: number, y: number): void => {
    if (wsDrag) {
      wsDrag.ghost.style.left = `${x}px`;
      wsDrag.ghost.style.top = `${y}px`;
    }
  };
  const wsOnDown = (e: PointerEvent): void => {
    if (wsDrag) return;
    const el = (e.target as HTMLElement | null)?.closest('[data-mat], .ws-cell.filled') as HTMLElement | null;
    if (!el) return;
    let mat: CraftMatId | null = null;
    let fromCell: number | null = null;
    if (el.dataset.mat) {
      // 从材料选择条拖出
      mat = el.dataset.mat as CraftMatId;
      if (state.materialCount(mat) - wsPlaced(mat) <= 0) return; // 无可用库存
    } else if (el.dataset.cell != null) {
      // 从已有格子拖出（取起）
      const i = Number(el.dataset.cell);
      mat = wsGrid[i];
      if (!mat) return;
      fromCell = i;
      wsGrid[i] = null;
      el.classList.remove('filled');
      el.textContent = '';
    }
    if (!mat) return;
    e.preventDefault();
    const ghost = document.createElement('div');
    ghost.className = 'ws-ghost';
    ghost.textContent = CRAFT_MAT_BY_ID[mat].icon;
    document.body.appendChild(ghost);
    wsDrag = { mat, fromCell, ghost };
    wsMoveGhost(e.clientX, e.clientY);
  };
  const wsOnMove = (e: PointerEvent): void => {
    if (!wsDrag) return;
    wsMoveGhost(e.clientX, e.clientY);
    workshopInner.querySelectorAll('.ws-cell.drop').forEach((c) => c.classList.remove('drop'));
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const cell = el?.closest('.ws-cell') as HTMLElement | null;
    if (cell) cell.classList.add('drop');
  };
  const wsOnUp = (e: PointerEvent): void => {
    if (!wsDrag) return;
    const d = wsDrag;
    wsDrag = null;
    d.ghost.remove();
    workshopInner.querySelectorAll('.ws-cell.drop').forEach((c) => c.classList.remove('drop'));
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const cellEl = el?.closest('.ws-cell') as HTMLElement | null;
    if (cellEl && cellEl.dataset.cell != null) {
      const i = Number(cellEl.dataset.cell);
      // 替换：目标格无论是否占用，都放入拖拽材料；原占用材料回库存（不写回任何格子）。
      // 从选择条拖入需有可用库存；从格子拖入（已取起）则必然够。
      if (d.fromCell != null || state.materialCount(d.mat) - wsPlaced(d.mat) > 0) wsGrid[i] = d.mat;
    }
    // 丢到合成台外：来自格子的已取起 → 回库存；来自选择条 → 无事
    renderWorkshop();
  };
  workshopInner.addEventListener('pointerdown', wsOnDown);
  window.addEventListener('pointermove', wsOnMove);
  window.addEventListener('pointerup', wsOnUp);
  window.addEventListener('pointercancel', wsOnUp);

  // ---- 屏幕路由 ----
  let current: 'select' | 'dart' | 'lotto' | 'battle' | 'story' | 'rps' | 'shooter' | 'workshop' = 'select';
  function go(name: 'select' | 'dart' | 'lotto' | 'battle' | 'story' | 'rps' | 'shooter' | 'workshop'): void {
    if (name === current) return;
    const prev = current;
    current = name;
    screenSelect.classList.toggle('active', name === 'select');
    screenDart.classList.toggle('active', name === 'dart');
    screenLotto.classList.toggle('active', name === 'lotto');
    screenBattle.classList.toggle('active', name === 'battle');
    screenStory.classList.toggle('active', name === 'story');
    screenRps.classList.toggle('active', name === 'rps');
    screenShooter.classList.toggle('active', name === 'shooter');
    screenWorkshop.classList.toggle('active', name === 'workshop');
    if (name === 'workshop') renderWorkshop();
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
    // 锤剪布循环：同上
    if (prev === 'rps') rps.stop();
    if (name === 'rps') {
      window.dispatchEvent(new Event('resize'));
      rps.start();
    }
    // 弹幕射击循环：同上
    if (prev === 'shooter') shooter.stop();
    if (name === 'shooter') {
      window.dispatchEvent(new Event('resize'));
      shooter.start();
    }
    // 彩票页面：进入刷新，离开静默结算
    if (prev === 'lotto') lottery.leave();
    if (name === 'lotto') lottery.enter();
    // 背景音乐：随关卡切换曲风（选择页=菜单曲）
    audio.setMusicMood(name === 'select' || name === 'workshop' ? 'menu' : (name as 'dart' | 'lotto' | 'battle' | 'rps' | 'shooter'));
    // HUD：🏠/技能按钮仅在关卡页显示；score/combo 仅飞镖页
    homeBtn.hidden = name === 'select';
    skillBtn.hidden = name === 'select' || name === 'story' || name === 'workshop';
    scoreStat.hidden = name !== 'dart';
    comboEl.hidden = name !== 'dart';
    matsEl.hidden = name !== 'battle' && name !== 'workshop';
    refreshCoins();
  }

  app.querySelector<HTMLButtonElement>('#cardDart')!.addEventListener('click', () => go('dart'));
  app.querySelector<HTMLButtonElement>('#cardBattle')!.addEventListener('click', () => go('battle'));
  app.querySelector<HTMLButtonElement>('#cardWorkshop')!.addEventListener('click', () => go('workshop'));
  app.querySelector<HTMLButtonElement>('#cardStory')!.addEventListener('click', () => go('story'));
  app.querySelector<HTMLButtonElement>('#cardRps')!.addEventListener('click', () => go('rps'));
  app.querySelector<HTMLButtonElement>('#cardShooter')!.addEventListener('click', () => go('shooter'));
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
  // 先声明 selectFooter，避免 refreshAngelBadge 中使用时陷入暂时性死区
  const selectFooter = app.querySelector<HTMLDivElement>('#selectFooter')!;
  const angelBadge = app.querySelector<HTMLSpanElement>('#angelBadge')!;
  const refreshAngelBadge = () => {
    angelBadge.hidden = !state.angelAchievement;
    selectFooter.hidden = !state.angelAchievement;
  };
  refreshAngelBadge();
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
  skillBtn.addEventListener('click', () => {
    if (current !== 'workshop') openSkill(current);
  });

  // 金币变动时同步 HUD、彩票页面与彩票解锁状态（飞镖 earn 时保持新鲜）。
  // refreshCoins 是函数声明（提升），lottery / refreshLottoLock 在运行期已初始化。
  function refreshCoins(): void {
    refreshLottoTreeBtn();
    updateCoins();
    refreshMaterials();
    checkAchievements();
    lottery.syncCoins();
    refreshLottoLock();
  }
  /** 顶部 HUD 材料数量（打怪/工坊页可见） */
  function refreshMaterials(): void {
    const basic = MATERIALS.map((m) => `${m.icon}<b>${state.materialCount(m.id)}</b>`).join(' ');
    const adv = ADVANCED_MATERIALS.filter((a) => state.materialCount(a.id) > 0)
      .map((a) => `${a.icon}<b>${state.materialCount(a.id)}</b>`)
      .join(' ');
    matsEl.innerHTML = adv ? `${basic} · ${adv}` : basic;
  }

  // ============ 成就系统 ============
  const achvModal = app.querySelector<HTMLDivElement>('#achvModal')!;
  const achvList = app.querySelector<HTMLDivElement>('#achvList')!;
  const achvProgress = app.querySelector<HTMLSpanElement>('#achvProgress')!;
  /** 扫描达成但未领取的成就 → 解锁、发奖、toast。在每次金币变动时调用。 */
  function checkAchievements(): void {
    const fresh = newlyCompleted(state.achv, state.achvDone);
    if (!fresh.length) return;
    for (const a of fresh) {
      state.achvDone.add(a.id);
      state.earn(a.reward);
      showToast(`🏆 ${a.name} · +🪙${a.reward}`);
      audio.sfx('unlock');
    }
    state.save();
    updateCoins();
    if (achvModal.classList.contains('open')) renderAchv();
  }
  function renderAchv(): void {
    const done = state.achvDone;
    achvProgress.textContent = `🏆 ${done.size}/${ACHIEVEMENTS.length}`;
    achvList.innerHTML = ACHIEVEMENTS.map((a) => {
      const owned = done.has(a.id);
      const cur = state.achv[a.stat] || 0;
      return `<div class="achv-row${owned ? ' done' : ''}">
        <span class="achv-ico">${owned ? a.icon : '🔒'}</span>
        <span class="achv-name">${a.name}</span>
        <span class="achv-desc">${a.desc} <em>(${Math.min(cur, a.target)}/${a.target})</em></span>
        <span class="achv-reward">🪙${a.reward}</span>
      </div>`;
    }).join('');
  }
  app.querySelector<HTMLButtonElement>('#openAchv')!.addEventListener('click', () => {
    renderAchv();
    achvModal.classList.add('open');
    achvModal.setAttribute('aria-hidden', 'false');
  });
  const closeAchv = () => {
    achvModal.classList.remove('open');
    achvModal.setAttribute('aria-hidden', 'true');
  };
  app.querySelector<HTMLButtonElement>('#closeAchv')!.addEventListener('click', closeAchv);
  achvModal.addEventListener('click', (e) => {
    if (e.target === achvModal) closeAchv();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && achvModal.classList.contains('open')) closeAchv();
  });

  // ============ 强化商店（meta）============
  const metaModal = app.querySelector<HTMLDivElement>('#metaModal')!;
  const metaList = app.querySelector<HTMLDivElement>('#metaList')!;
  const metaCoins = app.querySelector<HTMLSpanElement>('#metaCoins')!;
  function renderMeta(): void {
    metaCoins.textContent = `🪙 ${state.coins}`;
    metaList.innerHTML = META_DEFS.map((d) => {
      const tier = state.meta[d.id];
      const maxed = tier >= d.maxTier;
      const cost = maxed ? 0 : d.costs[tier];
      const afford = !maxed && state.coins >= cost;
      const pips = Array.from({ length: d.maxTier }, (_, i) =>
        i < tier ? '◆' : '◇',
      ).join(' ');
      return `<div class="meta-row">
        <span class="meta-ico">${d.icon}</span>
        <div class="meta-info">
          <span class="meta-name">${d.name} <em>${pips}</em></span>
          <span class="meta-desc">${maxed ? d.desc(tier - 1) + ' · 已满级' : d.desc(tier) + '（下一档）'}</span>
        </div>
        <button class="meta-buy${maxed ? ' maxed' : afford ? '' : ' poor'}" data-id="${d.id}" ${maxed || !afford ? 'disabled' : ''}>
          ${maxed ? 'MAX' : `🪙${cost}`}
        </button>
      </div>`;
    }).join('');
    for (const btn of metaList.querySelectorAll<HTMLButtonElement>('.meta-buy')) {
      if (btn.disabled) continue;
      btn.addEventListener('click', () => {
        const id = btn.dataset.id as keyof typeof state.meta;
        if (state.buyMeta(id)) {
          audio.sfx('skill');
          updateCoins();
          renderMeta();
        }
      });
    }
  }
  app.querySelector<HTMLButtonElement>('#openMeta')!.addEventListener('click', () => {
    renderMeta();
    metaModal.classList.add('open');
    metaModal.setAttribute('aria-hidden', 'false');
  });
  const closeMeta = () => {
    metaModal.classList.remove('open');
    metaModal.setAttribute('aria-hidden', 'true');
  };
  app.querySelector<HTMLButtonElement>('#closeMeta')!.addEventListener('click', closeMeta);
  metaModal.addEventListener('click', (e) => {
    if (e.target === metaModal) closeMeta();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && metaModal.classList.contains('open')) closeMeta();
  });

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
  const rpsSpec: TreeSpec = {
    level: 'rps',
    title: '✊ 锤剪布技能树',
    nodes: ALL_RPS_NODES,
    nodeById: RPS_NODE_BY_ID,
    edges: getRpsEdges(),
    branches: {
      atk: { name: '攻', color: '#ea4754' },
      mind: { name: '读', color: '#7df9ff' },
      guard: { name: '韧', color: '#5fce86' },
    },
    owned: (id) => state.owned('rps', id),
    prereqMet: (id) => state.prereqMet('rps', id),
    canBuy: (id) => state.canBuy('rps', id),
    buy: (id) => state.buy('rps', id),
  };
  const shooterSpec: TreeSpec = {
    level: 'shooter',
    title: '🚀 射击技能树',
    nodes: ALL_SHOOTER_NODES,
    nodeById: SHOOTER_NODE_BY_ID,
    edges: getShooterEdges(),
    branches: {
      fire: { name: '射', color: '#ea4754' },
      dodge: { name: '动', color: '#7df9ff' },
      hull: { name: '防', color: '#5fce86' },
    },
    owned: (id) => state.owned('shooter', id),
    prereqMet: (id) => state.prereqMet('shooter', id),
    canBuy: (id) => state.canBuy('shooter', id),
    buy: (id) => state.buy('shooter', id),
  };

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
    spec =
      level === 'lotto'
        ? lottoSpec
        : level === 'battle'
          ? battleSpec
          : level === 'rps'
            ? rpsSpec
            : level === 'shooter'
              ? shooterSpec
              : dartSpec;
    tabTicket.hidden = !state.lottoTreeUnlocked;
    treeTabs.hidden = (level !== 'dart');
    tabDart.classList.toggle('active', true);
    tabTicket.classList.toggle('active', false);
    selectedId = null;
    skillTitle.textContent = spec.title;
    renderLegend();
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    // 开技能弹窗时暂停当前关卡的实时循环，避免被打（飞镖/打怪/锤剪布都暂停）
    pauseCurrent();
    renderTree();
    updateCoins();
  }
  const closeModal = () => {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    resumeCurrent();
  };
  // 暂停 / 恢复当前屏幕的实时关卡（开/关技能弹窗用）
  function pauseCurrent(): void {
    if (current === 'dart') game.stop();
    else if (current === 'battle') battle.pause();
    else if (current === 'rps') rps.pause();
    else if (current === 'shooter') shooter.pause();
  }
  function resumeCurrent(): void {
    if (current === 'dart') game.start();
    else if (current === 'battle') battle.start();
    else if (current === 'rps') rps.start();
    else if (current === 'shooter') shooter.start();
  }
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
      if (current === 'rps') rps.syncAfterBuy();
      if (current === 'shooter') shooter.syncAfterBuy();
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
      else if (spec.level === 'rps') rps.syncAfterBuy();
      else if (spec.level === 'shooter') shooter.syncAfterBuy();
      // X1 购买后触发第五段剧情
      if (selectedId === 'X1') { closeModal(); story.startChapter(5); go('story'); return; }
      refreshCoins(); // 统一走 refreshCoins（含 lottery.syncCoins / refreshLottoLock）
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

  // ---- 自适应技能树布局：完全由依赖关系（requires）推导，不依赖手写 pos ----
  // 后续新增技能只要填 requires，这里自动分层排版、保证不重叠。
  const X_GAP = 14; // 同层节点水平间距（> 节点外环直径 ~9.4，必然不压盖）
  const LAYER_GAP = 16; // 相邻层级垂直间距（含成本标签余量）
  let layoutKey = '';
  let layoutL = new Map<string, { x: number; y: number }>();
  let layoutVB = { x: -8, y: -8, w: 124, h: 112 };
  function computeAutoLayout(): void {
    const nodes = spec.nodes;
    const parent = new Map<string, string[]>();
    const child = new Map<string, string[]>();
    for (const n of nodes) {
      parent.set(n.id, n.requires ? [...n.requires] : []);
      child.set(n.id, []);
    }
    for (const e of spec.edges) {
      const arr = child.get(e.from);
      if (arr) arr.push(e.to);
    }
    // 层级 = 从根（无前置）出发的最长路径长度；拓扑代数。
    const depth = new Map<string, number>();
    const vis = new Set<string>();
    const gd = (id: string): number => {
      const hit = depth.get(id);
      if (hit != null) return hit;
      if (vis.has(id)) return 0; // 环保护（技能树为 DAG，正常不触发）
      vis.add(id);
      const ps = parent.get(id) ?? [];
      let d = 0;
      if (ps.length) d = 1 + Math.max(...ps.map(gd));
      vis.delete(id);
      depth.set(id, d);
      return d;
    };
    for (const n of nodes) gd(n.id);
    const maxD = nodes.length ? Math.max(0, ...depth.values()) : 0;
    const layers: string[][] = Array.from({ length: maxD + 1 }, () => []);
    for (const n of nodes) layers[depth.get(n.id) ?? 0].push(n.id);
    // 同层 x：先按出现序均分，再做若干趟重心（barycenter）上下扫描，
    // 让子节点尽量落在父节点正下方、减少连线交叉；最终按秩均分 → 同层必然不重叠。
    const X = new Map<string, number>();
    const rankify = (layer: string[]) => {
      const n = layer.length;
      layer.forEach((id, i) => X.set(id, (i - (n - 1) / 2) * X_GAP));
    };
    for (const l of layers) rankify(l);
    const avg = (ids: string[]) => {
      const xs = ids.map((p) => X.get(p)).filter((u): u is number => u != null);
      return xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : null;
    };
    for (let it = 0; it < 8; it++) {
      for (let d = 1; d <= maxD; d++) {
        layers[d] = layers[d]
          .map((id) => ({ id, b: avg(parent.get(id) ?? []) ?? X.get(id)! }))
          .sort((a, b) => a.b - b.b)
          .map((x) => x.id);
        rankify(layers[d]);
      }
      for (let d = maxD - 1; d >= 0; d--) {
        layers[d] = layers[d]
          .map((id) => ({ id, b: avg(child.get(id) ?? []) ?? X.get(id)! }))
          .sort((a, b) => a.b - b.b)
          .map((x) => x.id);
        rankify(layers[d]);
      }
    }
    const L = new Map<string, { x: number; y: number }>();
    let minx = Infinity;
    let maxx = -Infinity;
    let miny = Infinity;
    let maxy = -Infinity;
    for (const n of nodes) {
      const x = X.get(n.id) ?? 0;
      const y = (depth.get(n.id) ?? 0) * LAYER_GAP;
      L.set(n.id, { x, y });
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
    layoutL = L;
    // 每棵树按自身包围盒定 viewBox（树大小差异大，固定框装不下）：四周留 padding
    // 容纳外环(~5)与底部成本标签(~9)。
    const pad = 10;
    layoutVB = {
      x: minx - pad,
      y: miny - pad,
      w: Math.max(1, maxx - minx) + pad * 2,
      h: Math.max(1, maxy - miny) + pad * 2,
    };
  }
  // 布局只依赖图结构（每棵树固定），按 spec 缓存；切树时重算并标记 fresh 以重置缩放。
  function ensureLayout(): {
    L: Map<string, { x: number; y: number }>;
    vb: { x: number; y: number; w: number; h: number };
    fresh: boolean;
  } {
    const key = spec.level + ':' + treeTab;
    let fresh = false;
    if (key !== layoutKey) {
      computeAutoLayout();
      layoutKey = key;
      fresh = true;
    }
    return { L: layoutL, vb: layoutVB, fresh };
  }

  function renderTree(): void {
    svg.innerHTML = '';
    // 包裹组：所有边与节点都渲染进 #treeContent，便于整体施加视图变换。
    const content = svgEl('g', { id: 'treeContent' });
    svg.appendChild(content);
    const edges = spec.edges;

    // 自适应布局：由依赖图自动分层排版（见 ensureLayout），不依赖手写 pos，
    // 新增节点自动入位且不重叠。每棵树按自身包围盒设 viewBox，切树时重置缩放。
    const { L, vb, fresh } = ensureLayout();
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    if (fresh) resetView();
    const lp = (id: string) => L.get(id)!;

    // 边
    for (const e of edges) {
      const b = spec.nodeById[e.to];
      const active = spec.owned(e.from) && spec.owned(e.to);
      const half = spec.owned(e.from) && !spec.owned(e.to) && spec.prereqMet(e.to);
      const line = svgEl('line', {
        x1: String(L.get(e.from)!.x),
        y1: String(L.get(e.from)!.y),
        x2: String(L.get(e.to)!.x),
        y2: String(L.get(e.to)!.y),
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
      const p = lp(node.id);
      g.setAttribute('transform', `translate(${p.x},${p.y})`);
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
          x: String(p.x),
          y: String(p.y + r + 4.0),
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
    audio.unlockMusic();
  });

  // ----- 设置面板 + 背景音乐 -----
  // 把设置同步进音频引擎
  const applyAudioSettings = () => {
    const s = settings.get();
    audio.setMusicEnabled(s.music);
    audio.setMusicVolume(s.musicVol);
    audio.setHapticsEnabled(s.haptics);
  };
  applyAudioSettings();
  audio.setMusicMood('menu');

  const settingsModal = app.querySelector<HTMLDivElement>('#settingsModal')!;
  const settingsBody = app.querySelector<HTMLDivElement>('#settingsBody')!;
  const renderSettings = () => {
    const s = settings.get();
    settingsBody.innerHTML = `
      <label class="set-row"><span>🎵 背景音乐</span><input type="checkbox" id="setMusic" ${s.music ? 'checked' : ''}></label>
      <label class="set-row"><span>🔉 音量</span><input type="range" id="setVol" min="0" max="1" step="0.05" value="${s.musicVol}"></label>
      <label class="set-row"><span>📳 振动反馈</span><input type="checkbox" id="setHaptics" ${s.haptics ? 'checked' : ''}></label>
      <label class="set-row"><span>✨ 减少动效（无障碍）</span><input type="checkbox" id="setReduce" ${s.reduceMotion ? 'checked' : ''}></label>
      <div class="set-hint">减少动效：关闭震屏/闪光，缓解眩晕。音效开关见右上 🔊。</div>`;
    const set = (id: string) => app.querySelector<HTMLInputElement>(id)!;
    set('#setMusic').addEventListener('change', (e) => {
      settings.update({ music: (e.target as HTMLInputElement).checked });
      applyAudioSettings();
      audio.unlockMusic();
    });
    set('#setVol').addEventListener('input', (e) => {
      settings.update({ musicVol: parseFloat((e.target as HTMLInputElement).value) });
      applyAudioSettings();
    });
    set('#setHaptics').addEventListener('change', (e) => {
      settings.update({ haptics: (e.target as HTMLInputElement).checked });
      applyAudioSettings();
    });
    set('#setReduce').addEventListener('change', (e) => {
      settings.update({ reduceMotion: (e.target as HTMLInputElement).checked });
    });
  };
  const openSettings = () => {
    renderSettings();
    settingsModal.classList.add('open');
    settingsModal.setAttribute('aria-hidden', 'false');
    pauseCurrent();
  };
  const closeSettings = () => {
    settingsModal.classList.remove('open');
    settingsModal.setAttribute('aria-hidden', 'true');
    resumeCurrent();
  };
  app.querySelector<HTMLButtonElement>('#settingsBtn')!.addEventListener('click', openSettings);
  app.querySelector<HTMLButtonElement>('#closeSettings')!.addEventListener('click', closeSettings);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsModal.classList.contains('open')) closeSettings();
  });

  // 首次用户手势后启动 BGM 引擎（AudioContext 需手势解锁）
  const unlockOnce = () => {
    audio.unlockMusic();
    window.removeEventListener('pointerdown', unlockOnce);
  };
  window.addEventListener('pointerdown', unlockOnce);

  // 初始：停在关卡选择主页（飞镖循环不启动，进入飞镖关卡才 start）。
  refreshCoins();
  updateScore();
  return game;
}
