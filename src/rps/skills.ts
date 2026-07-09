import type { SkillNode } from '../shared/types';

// ===== 锤剪布关卡技能树拓扑数据 =====
// 与飞镖 / 彩票 / 打怪技能树完全独立（独立节点表、独立技能集合、独立派生属性 RpsStats）。
// 三条分支从中心 RCORE 辐射：
//   左上 atk（攻）→ 伤害 / 暴击 / 连击上限
//   右上 mind（读）→ 读招窗口更长 / 平局转胜
//   下 guard（韧）→ 血量 / 吸血 / 掠夺（金币）
// 费用量级与另外几棵树相当。

export const RPS_CORE_NODE: SkillNode = {
  id: 'rcore',
  name: '猜拳核心',
  branch: 'atk',
  cost: 0,
  effects: [],
  requires: [],
  pos: { x: 50, y: 44 },
  desc: '一切读心的起点',
  icon: '★',
};

export const RPS_SKILLS: SkillNode[] = [
  // ---------- 攻分支（左上） ----------
  {
    id: 'ra1', name: '重击 I', branch: 'atk', cost: 300,
    effects: [{ kind: 'rpsDamage', value: 4 }],
    requires: ['rcore'], pos: { x: 40, y: 30 },
    desc: '每胜伤害 +4', icon: '⚔️',
  },
  {
    id: 'ra2', name: '暴击', branch: 'atk', cost: 900,
    effects: [{ kind: 'rpsCrit', value: 0.15 }],
    requires: ['ra1'], pos: { x: 30, y: 18 },
    desc: '15% 概率暴击（×2 伤害）', icon: '💥',
  },
  {
    id: 'ra3', name: '连击上限', branch: 'atk', cost: 1400,
    effects: [{ kind: 'rpsComboCap', value: 1 }],
    requires: ['ra1'], pos: { x: 40, y: 44 },
    desc: '连击倍率上限 +1', icon: '🔥',
  },
  {
    id: 'ra4', name: '致命读心', branch: 'atk', cost: 6000,
    effects: [
      { kind: 'rpsDamage', value: 4 },
      { kind: 'rpsCrit', value: 0.15 },
    ],
    requires: ['ra2', 'ra3'], pos: { x: 20, y: 28 },
    desc: '伤害 +4 / 暴击 +15%（攻 capstone）', icon: '🗡️',
  },

  // ---------- 读分支（右上） ----------
  {
    id: 'rm1', name: '洞察 I', branch: 'mind', cost: 400,
    effects: [{ kind: 'rpsTell', value: 350 }],
    requires: ['rcore'], pos: { x: 60, y: 30 },
    desc: '读招窗口 +350ms（更从容）', icon: '👁️',
  },
  {
    id: 'rm2', name: '平局转胜', branch: 'mind', cost: 1200,
    effects: [{ kind: 'rpsTiebreak', value: 0.3 }],
    requires: ['rm1'], pos: { x: 70, y: 18 },
    desc: '平局有 30% 概率直接判胜', icon: '⚖️',
  },
  {
    id: 'rm3', name: '洞察 II', branch: 'mind', cost: 1800,
    effects: [{ kind: 'rpsTell', value: 400 }],
    requires: ['rm1'], pos: { x: 60, y: 44 },
    desc: '读招窗口再 +400ms', icon: '👁️',
  },
  {
    id: 'rm4', name: '全知', branch: 'mind', cost: 5200,
    effects: [
      { kind: 'rpsTell', value: 400 },
      { kind: 'rpsTiebreak', value: 0.3 },
    ],
    requires: ['rm2', 'rm3'], pos: { x: 82, y: 28 },
    desc: '读招窗口 +400 / 平转胜 +30%（读 capstone）', icon: '🔮',
  },

  // ---------- 韧分支（下） ----------
  {
    id: 'rg1', name: '体魄 I', branch: 'guard', cost: 500,
    effects: [{ kind: 'rpsMaxHp', value: 30 }],
    requires: ['rcore'], pos: { x: 50, y: 60 },
    desc: '最大血量 +30', icon: '❤️',
  },
  {
    id: 'rg2', name: '吸血', branch: 'guard', cost: 1600,
    effects: [{ kind: 'rpsLifesteal', value: 4 }],
    requires: ['rg1'], pos: { x: 38, y: 72 },
    desc: '每次判胜回 4 血', icon: '🩸',
  },
  {
    id: 'rg3', name: '战利者', branch: 'guard', cost: 7000,
    effects: [
      { kind: 'rpsMaxHp', value: 40 },
      { kind: 'rpsLifesteal', value: 4 },
      { kind: 'rpsCoin', value: 0.25 },
    ],
    requires: ['rg1', 'rg2'], pos: { x: 62, y: 72 },
    desc: '血量 +40 / 吸血 +4 / 击杀金币 +25%（韧 capstone）', icon: '🏆',
  },
];

export const ALL_RPS_NODES: SkillNode[] = [RPS_CORE_NODE, ...RPS_SKILLS];

export const RPS_NODE_BY_ID: Record<string, SkillNode> = Object.fromEntries(
  ALL_RPS_NODES.map((n) => [n.id, n]),
);

/** 锤剪布技能树拓扑图使用的所有边（前置关系） */
export function getRpsEdges(): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const node of ALL_RPS_NODES) {
    for (const req of node.requires) {
      edges.push({ from: req, to: node.id });
    }
  }
  return edges;
}
