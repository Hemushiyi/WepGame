import type { SkillNode } from '../shared/types';

// ===== 射击关卡技能树拓扑数据 =====
// 与其他四棵技能树完全独立（独立节点表、技能集合、派生属性 ShooterStats）。
// 三条分支从中心 SCORE 辐射：
//   左上 fire（射）→ 伤害 / 散射 / 射速
//   右上 dodge（动）→ 跟手速度 / 血量
//   下 hull（防）→ 血量 / 回血 / 掠夺（金币）

export const SHOOTER_CORE_NODE: SkillNode = {
  id: 'score',
  name: '战机核心',
  branch: 'fire',
  cost: 0,
  effects: [],
  requires: [],
  pos: { x: 50, y: 44 },
  desc: '一切射击的起点',
  icon: '★',
};

export const SHOOTER_SKILLS: SkillNode[] = [
  // ---------- 射分支（左上） ----------
  {
    id: 'sf1', name: '强化弹 I', branch: 'fire', cost: 300,
    effects: [{ kind: 'shooterDamage', value: 1 }],
    requires: ['score'], pos: { x: 40, y: 30 },
    desc: '每发伤害 +1', icon: '🔥',
  },
  {
    id: 'sf2', name: '散射', branch: 'fire', cost: 1200,
    effects: [{ kind: 'shooterMulti', value: 1 }],
    requires: ['sf1'], pos: { x: 30, y: 18 },
    desc: '每次多射 1 发（散射）', icon: '✨',
  },
  {
    id: 'sf3', name: '速射', branch: 'fire', cost: 900,
    effects: [{ kind: 'shooterFireRate', value: -50 }],
    requires: ['sf1'], pos: { x: 40, y: 44 },
    desc: '射击间隔 -50ms', icon: '⚡',
  },
  {
    id: 'sf4', name: '弹幕风暴', branch: 'fire', cost: 6000,
    effects: [
      { kind: 'shooterDamage', value: 1 },
      { kind: 'shooterMulti', value: 1 },
      { kind: 'shooterFireRate', value: -40 },
    ],
    requires: ['sf2', 'sf3'], pos: { x: 20, y: 28 },
    desc: '伤害+1/散射+1/射速+40ms（射 capstone）', icon: '💥',
  },

  // ---------- 动分支（右上） ----------
  {
    id: 'sd1', name: '灵活 I', branch: 'dodge', cost: 400,
    effects: [{ kind: 'shooterSpeed', value: 0.08 }],
    requires: ['score'], pos: { x: 60, y: 30 },
    desc: '战机跟手更灵敏', icon: '🌀',
  },
  {
    id: 'sd2', name: '轻甲', branch: 'dodge', cost: 800,
    effects: [{ kind: 'shooterMaxHp', value: 1 }],
    requires: ['sd1'], pos: { x: 70, y: 18 },
    desc: '最大血量 +1', icon: '❤️',
  },
  {
    id: 'sd3', name: '灵活 II', branch: 'dodge', cost: 1600,
    effects: [{ kind: 'shooterSpeed', value: 0.1 }],
    requires: ['sd1'], pos: { x: 60, y: 44 },
    desc: '跟手再提速', icon: '🌀',
  },
  {
    id: 'sd4', name: '幻影', branch: 'dodge', cost: 5200,
    effects: [
      { kind: 'shooterSpeed', value: 0.12 },
      { kind: 'shooterMaxHp', value: 1 },
    ],
    requires: ['sd2', 'sd3'], pos: { x: 82, y: 28 },
    desc: '跟手+0.12/血量+1（动 capstone）', icon: '💫',
  },

  // ---------- 防分支（下） ----------
  {
    id: 'sh1', name: '重甲', branch: 'hull', cost: 500,
    effects: [{ kind: 'shooterMaxHp', value: 1 }],
    requires: ['score'], pos: { x: 50, y: 60 },
    desc: '最大血量 +1', icon: '🛡️',
  },
  {
    id: 'sh2', name: '维修', branch: 'hull', cost: 1800,
    effects: [{ kind: 'shooterRegen', value: 0.15 }],
    requires: ['sh1'], pos: { x: 38, y: 72 },
    desc: '每秒回 0.15 血', icon: '🔧',
  },
  {
    id: 'sh3', name: '战利者', branch: 'hull', cost: 7000,
    effects: [
      { kind: 'shooterMaxHp', value: 2 },
      { kind: 'shooterRegen', value: 0.15 },
      { kind: 'shooterCoin', value: 0.25 },
    ],
    requires: ['sh1', 'sh2'], pos: { x: 62, y: 72 },
    desc: '血量+2/回血+0.15/金币+25%（防 capstone）', icon: '🏆',
  },
];

export const ALL_SHOOTER_NODES: SkillNode[] = [SHOOTER_CORE_NODE, ...SHOOTER_SKILLS];

export const SHOOTER_NODE_BY_ID: Record<string, SkillNode> = Object.fromEntries(
  ALL_SHOOTER_NODES.map((n) => [n.id, n]),
);

export function getShooterEdges(): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const node of ALL_SHOOTER_NODES) {
    for (const req of node.requires) edges.push({ from: req, to: node.id });
  }
  return edges;
}
