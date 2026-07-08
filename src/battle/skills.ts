import type { SkillNode } from '../shared/types';

// ===== 打怪关卡技能树拓扑数据 =====
// 与飞镖 / 彩票技能树完全独立（独立节点表、独立技能集合、独立派生属性 BattleStats）。
// 三条分支从中心 BCORE 辐射：
//   左上 power（力量）→ 攻击力 / 暴击 / capstone
//   右上 agility（敏捷）→ 攻速（冷却） / capstone
//   下 vitality（体质）→ 血量 / 吸血 / 掠夺（金币）capstone
// 费用量级与另外两棵树相当。

export const BATTLE_CORE_NODE: SkillNode = {
  id: 'bcore',
  name: '战斗核心',
  branch: 'power',
  cost: 0,
  effects: [],
  requires: [],
  pos: { x: 50, y: 44 },
  desc: '一切战斗的起点',
  icon: '★',
};

export const BATTLE_SKILLS: SkillNode[] = [
  // ---------- 力量分支（左上） ----------
  {
    id: 'bw1', name: '力量 I', branch: 'power', cost: 300,
    effects: [{ kind: 'battleDamage', value: 1 }],
    requires: ['bcore'], pos: { x: 40, y: 30 },
    desc: '每剑伤害 +1', icon: '⚔️',
  },
  {
    id: 'bw2', name: '暴击', branch: 'power', cost: 900,
    effects: [{ kind: 'battleCrit', value: 0.15 }],
    requires: ['bw1'], pos: { x: 30, y: 18 },
    desc: '15% 概率暴击（×2 伤害）', icon: '💥',
  },
  {
    id: 'bw3', name: '力量 II', branch: 'power', cost: 1400,
    effects: [{ kind: 'battleDamage', value: 1 }],
    requires: ['bw1'], pos: { x: 38, y: 42 },
    desc: '每剑伤害再 +1', icon: '⚔️',
  },
  {
    id: 'bw4', name: '致命一击', branch: 'power', cost: 6000,
    effects: [
      { kind: 'battleDamage', value: 1 },
      { kind: 'battleCrit', value: 0.15 },
    ],
    requires: ['bw2', 'bw3'], pos: { x: 20, y: 28 },
    desc: '伤害 +1 / 暴击 +15%（力量 capstone）', icon: '🗡️',
  },

  // ---------- 敏捷分支（右上） ----------
  {
    id: 'ba1', name: '攻速 I', branch: 'agility', cost: 400,
    effects: [{ kind: 'battleCooldown', value: -70 }],
    requires: ['bcore'], pos: { x: 60, y: 30 },
    desc: '挥剑冷却 -70ms', icon: '⚡',
  },
  {
    id: 'ba2', name: '攻速 II', branch: 'agility', cost: 1000,
    effects: [{ kind: 'battleCooldown', value: -90 }],
    requires: ['ba1'], pos: { x: 70, y: 18 },
    desc: '挥剑冷却 -90ms', icon: '⚡',
  },
  {
    id: 'ba3', name: '疾风剑', branch: 'agility', cost: 5200,
    effects: [
      { kind: 'battleCooldown', value: -70 },
      { kind: 'battleDamage', value: 1 },
    ],
    requires: ['ba2'], pos: { x: 82, y: 28 },
    desc: '冷却 -70 / 伤害 +1（敏捷 capstone）', icon: '🌪️',
  },

  // ---------- 体质分支（下） ----------
  {
    id: 'bv1', name: '体魄 I', branch: 'vitality', cost: 500,
    effects: [{ kind: 'battleMaxHp', value: 3 }],
    requires: ['bcore'], pos: { x: 50, y: 60 },
    desc: '最大血量 +3', icon: '❤️',
  },
  {
    id: 'bv2', name: '吸血', branch: 'vitality', cost: 1600,
    effects: [{ kind: 'battleLifesteal', value: 1 }],
    requires: ['bv1'], pos: { x: 38, y: 72 },
    desc: '每次命中回 1 血', icon: '🩸',
  },
  {
    id: 'bv3', name: '战利者', branch: 'vitality', cost: 7000,
    effects: [
      { kind: 'battleMaxHp', value: 4 },
      { kind: 'battleLifesteal', value: 1 },
      { kind: 'battleCoin', value: 0.25 },
    ],
    requires: ['bv1', 'bv2'], pos: { x: 62, y: 72 },
    desc: '血量 +4 / 吸血 +1 / 击杀金币 +25%（体质 capstone）', icon: '🏆',
  },
];

export const ALL_BATTLE_NODES: SkillNode[] = [BATTLE_CORE_NODE, ...BATTLE_SKILLS];

export const BATTLE_NODE_BY_ID: Record<string, SkillNode> = Object.fromEntries(
  ALL_BATTLE_NODES.map((n) => [n.id, n]),
);

/** 打怪技能树拓扑图使用的所有边（前置关系） */
export function getBattleEdges(): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const node of ALL_BATTLE_NODES) {
    for (const req of node.requires) {
      edges.push({ from: req, to: node.id });
    }
  }
  return edges;
}
