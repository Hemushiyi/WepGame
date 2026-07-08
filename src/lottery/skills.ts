import type { SkillNode } from '../shared/types';

// ===== 彩票关卡技能树拓扑数据 =====
// 与飞镖技能树完全独立（独立节点表、独立技能集合、独立派生属性 LottoStats）。
// 三条分支从中心 LCORE 辐射：
//   左上 luck（运气）→ 幸运值增效 / 基础中奖率 / 幸运上限
//   右上 economy（经济）→ 票价折扣 / 奖金倍率 / 组合
//   下 perk（福利）→ 免费票 / 头奖倍率 / capstone
// 平衡原则：保持彩票为负期望（金币消耗口）。中奖率/奖金倍率幅度受限，
// 避免把 RTP 拉过 1。费用量级与飞镖树相当，全树约 5 万金币。

export const LOTTO_CORE_NODE: SkillNode = {
  id: 'lcore',
  name: '彩票核心',
  branch: 'luck',
  cost: 0,
  effects: [],
  requires: [],
  pos: { x: 50, y: 44 },
  desc: '一切好运的起点',
  icon: '★',
};

export const LOTTO_SKILLS: SkillNode[] = [
  // ---------- 运气分支（左上） ----------
  {
    id: 'lk1', name: '幸运加持 I', branch: 'luck', cost: 300,
    effects: [{ kind: 'lottoPityBonus', value: 0.003 }],
    requires: ['lcore'], pos: { x: 40, y: 30 },
    desc: '每点幸运值的中奖加成 +0.003', icon: '🍀',
  },
  {
    id: 'lk2', name: '天选之人', branch: 'luck', cost: 1200,
    effects: [{ kind: 'lottoWin', value: 0.03 }],
    requires: ['lk1'], pos: { x: 30, y: 18 },
    desc: '所有档位基础中奖率 +3%', icon: '🌟',
  },
  {
    id: 'lk3', name: '幸运加持 II', branch: 'luck', cost: 800,
    effects: [{ kind: 'lottoPityBonus', value: 0.004 }],
    requires: ['lk1'], pos: { x: 36, y: 40 },
    desc: '每点幸运值的中奖加成再 +0.004', icon: '🍀',
  },
  {
    id: 'lk4', name: '满载幸运', branch: 'luck', cost: 4200,
    effects: [
      { kind: 'lottoPityCap', value: 3 },
      { kind: 'lottoPityBonus', value: 0.004 },
    ],
    requires: ['lk2', 'lk3'], pos: { x: 20, y: 26 },
    desc: '各档幸运值上限 +3 / 每点加成再 +0.004', icon: '🌈',
  },

  // ---------- 经济分支（右上） ----------
  {
    id: 'le1', name: '熟客优惠', branch: 'economy', cost: 600,
    effects: [{ kind: 'lottoCost', value: 0.05 }],
    requires: ['lcore'], pos: { x: 60, y: 30 },
    desc: '所有彩票票价 -5%', icon: '💰',
  },
  {
    id: 'le2', name: '奖金加成', branch: 'economy', cost: 1800,
    effects: [{ kind: 'lottoPrizeMult', value: 0.1 }],
    requires: ['le1'], pos: { x: 70, y: 18 },
    desc: '所有奖金 +10%', icon: '💎',
  },
  {
    id: 'le3', name: '老主顾', branch: 'economy', cost: 2600,
    effects: [
      { kind: 'lottoCost', value: 0.05 },
      { kind: 'lottoPrizeMult', value: 0.05 },
    ],
    requires: ['le2'], pos: { x: 82, y: 26 },
    desc: '票价再 -5% / 奖金再 +5%', icon: '🤝',
  },

  // ---------- 福利分支（下） ----------
  {
    id: 'lp1', name: '免费试手', branch: 'perk', cost: 1500,
    effects: [{ kind: 'lottoFreeTicket', value: 0.05 }],
    requires: ['lcore'], pos: { x: 50, y: 60 },
    desc: '购票时 5% 概率免费（退回票价）', icon: '🎁',
  },
  {
    id: 'lp2', name: '头奖诱惑', branch: 'perk', cost: 2400,
    effects: [{ kind: 'lottoJackpotMult', value: 0.25 }],
    requires: ['lp1'], pos: { x: 38, y: 72 },
    desc: '头奖档（最高奖金）奖金额外 +25%', icon: '👑',
  },
  {
    id: 'lp3', name: '大赢家', branch: 'perk', cost: 9000,
    effects: [
      { kind: 'lottoPrizeMult', value: 0.1 },
      { kind: 'lottoJackpotMult', value: 0.25 },
      { kind: 'lottoFreeTicket', value: 0.05 },
    ],
    requires: ['lp1', 'lp2'], pos: { x: 62, y: 72 },
    desc: '奖金 +10% / 头奖 +25% / 免费票 +5%（福利 capstone）', icon: '🏆',
  },
];

export const ALL_LOTTO_NODES: SkillNode[] = [LOTTO_CORE_NODE, ...LOTTO_SKILLS];

export const LOTTO_NODE_BY_ID: Record<string, SkillNode> = Object.fromEntries(
  ALL_LOTTO_NODES.map((n) => [n.id, n]),
);

/** 彩票技能树拓扑图使用的所有边（前置关系） */
export function getLottoEdges(): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const node of ALL_LOTTO_NODES) {
    for (const req of node.requires) {
      edges.push({ from: req, to: node.id });
    }
  }
  return edges;
}
