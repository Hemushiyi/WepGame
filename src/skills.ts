import type { SkillNode } from './types';

// ===== 技能树拓扑数据 =====
// 中心 CORE 为起点（默认拥有），四条分支向外辐射：
//   上方 target（目标）→ 扩大中心点 / 环分 / 磁吸 / 超大中心 / 命运之眼
//   右上 speed（速度）→ 冷却 / 飞镖加速 / 双发 / 急速连投 / 闪电神速
//   下方 pet（宠物）→ 解锁 / 频率 / 精准 / 多宠 / 超级宠物 / 宠物军团
//   中段 combo（技巧）→ 连击上限 / 连击护盾 / 稳风 / 连击狂热 / 终极技巧
// 顶层 capstone 节点拥有多个前置，形成网络交叉。
// 注：经济已收紧 —— 金币只来自基础分；连击只放大“分数”，不影响金币。
// 用户反馈“太便宜、一下就升完”，故本表费用大幅提高，全树总费用约 9 万金币。

export const CORE_NODE: SkillNode = {
  id: 'core',
  name: '飞镖核心',
  branch: 'target',
  cost: 0,
  effects: [],
  requires: [],
  pos: { x: 50, y: 38 },
  desc: '一切投掷的起点',
  icon: '★',
};

export const SKILLS: SkillNode[] = [
  // ---------- 目标分支（上方 / 左上） ----------
  {
    id: 't1', name: '放大中心 I', branch: 'target', cost: 250,
    effects: [{ kind: 'centerRadius', value: 6 }],
    requires: ['core'], pos: { x: 38, y: 16 },
    desc: '中心点半径 +6', icon: '🎯',
  },
  {
    id: 't2', name: '放大中心 II', branch: 'target', cost: 600,
    effects: [{ kind: 'centerRadius', value: 7 }],
    requires: ['t1'], pos: { x: 24, y: 9 },
    desc: '中心点半径 +7', icon: '🎯',
  },
  {
    id: 't3', name: '环分倍率', branch: 'target', cost: 900,
    effects: [{ kind: 'ringMultiplier', value: 0.5 }],
    requires: ['t2'], pos: { x: 12, y: 16 },
    desc: '所有环位得分 ×1.5', icon: '✨',
  },
  {
    id: 't4', name: '磁吸', branch: 'target', cost: 550,
    effects: [{ kind: 'magnet', value: 0.12 }],
    requires: ['t1'], pos: { x: 30, y: 28 },
    desc: '飞镖轻微被中心吸引', icon: '🧲',
  },
  {
    id: 't5', name: '超大中心', branch: 'target', cost: 3500,
    effects: [
      { kind: 'centerRadius', value: 12 },
      { kind: 'ringMultiplier', value: 0.5 },
    ],
    requires: ['t3', 't4'], pos: { x: 14, y: 30 },
    desc: '中心点扩张 +12 / 得分再 ×1.5', icon: '💫',
  },
  {
    id: 't6', name: '强效磁吸', branch: 'target', cost: 1800,
    effects: [
      { kind: 'magnet', value: 0.13 },
      { kind: 'ringMultiplier', value: 0.3 },
    ],
    requires: ['t5'], pos: { x: 4, y: 22 },
    desc: '磁吸 +0.13 / 环分再 ×1.3', icon: '🧲',
  },
  {
    id: 't7', name: '命运之眼', branch: 'target', cost: 12000,
    effects: [
      { kind: 'centerRadius', value: 5 },
      { kind: 'magnet', value: 0.1 },
      { kind: 'ringMultiplier', value: 0.5 },
    ],
    requires: ['t5', 't6'], pos: { x: 0, y: 36 },
    desc: '中心 +5 / 磁吸 +0.1 / 环分 ×1.5（目标 capstone）', icon: '👁️',
  },

  // ---------- 速度分支（右上 / 右） ----------
  {
    id: 's1', name: '减冷却 I', branch: 'speed', cost: 250,
    effects: [{ kind: 'cooldown', value: -150 }],
    requires: ['core'], pos: { x: 62, y: 16 },
    desc: '投掷冷却 -150ms', icon: '⚡',
  },
  {
    id: 's2', name: '飞镖加速', branch: 'speed', cost: 600,
    effects: [{ kind: 'dartSpeed', value: 240 }],
    requires: ['s1'], pos: { x: 76, y: 9 },
    desc: '飞镖飞行速度 +240', icon: '💨',
  },
  {
    id: 's3', name: '减冷却 II', branch: 'speed', cost: 900,
    effects: [{ kind: 'cooldown', value: -200 }],
    requires: ['s2'], pos: { x: 88, y: 16 },
    desc: '投掷冷却 -200ms', icon: '⚡',
  },
  {
    id: 's4', name: '双发', branch: 'speed', cost: 700,
    effects: [{ kind: 'doubleShot', value: 0.15 }],
    requires: ['s2'], pos: { x: 70, y: 28 },
    desc: '15% 概率同时投出两镖', icon: '✊',
  },
  {
    id: 's5', name: '急速连投', branch: 'speed', cost: 3500,
    effects: [
      { kind: 'cooldown', value: -150 },
      { kind: 'doubleShot', value: 0.15 },
      { kind: 'dartSpeed', value: 240 },
    ],
    requires: ['s3', 's4'], pos: { x: 86, y: 30 },
    desc: '冷却 -150 / 双发 +15% / 速度 +240', icon: '🔥',
  },
  {
    id: 's6', name: '连环双发', branch: 'speed', cost: 1800,
    effects: [
      { kind: 'doubleShot', value: 0.15 },
      { kind: 'dartSpeed', value: 200 },
    ],
    requires: ['s5'], pos: { x: 96, y: 22 },
    desc: '双发概率 +15% / 飞镖速度 +200', icon: '✊',
  },
  {
    id: 's7', name: '闪电神速', branch: 'speed', cost: 11000,
    effects: [
      { kind: 'cooldown', value: -250 },
      { kind: 'doubleShot', value: 0.2 },
      { kind: 'dartSpeed', value: 300 },
    ],
    requires: ['s5', 's6'], pos: { x: 100, y: 36 },
    desc: '冷却 -250 / 双发 +20% / 速度 +300（速度 capstone）', icon: '🌩️',
  },

  // ---------- 宠物分支（下方） ----------
  {
    id: 'p1', name: '解锁宠物', branch: 'pet', cost: 700,
    effects: [{ kind: 'petUnlock' }, { kind: 'petCount', value: 1 }],
    requires: ['core'], pos: { x: 50, y: 60 },
    desc: '召唤一只小宠物自动投掷', icon: '🐾',
  },
  {
    id: 'p2', name: '宠物频率', branch: 'pet', cost: 900,
    effects: [{ kind: 'petInterval', value: -500 }],
    requires: ['p1'], pos: { x: 36, y: 70 },
    desc: '宠物投掷间隔 -500ms', icon: '⏱️',
  },
  {
    id: 'p3', name: '宠物精准', branch: 'pet', cost: 900,
    effects: [{ kind: 'petAccuracy', value: 0.3 }],
    requires: ['p1'], pos: { x: 64, y: 70 },
    desc: '宠物散布更小、更易命中中心', icon: '🎯',
  },
  {
    id: 'p4', name: '再加一宠', branch: 'pet', cost: 2000,
    effects: [{ kind: 'petCount', value: 1 }],
    requires: ['p2'], pos: { x: 28, y: 54 },
    desc: '额外召唤一只宠物', icon: '🐾',
  },
  {
    id: 'p5', name: '超级宠物', branch: 'pet', cost: 5500,
    effects: [
      { kind: 'petCount', value: 1 },
      { kind: 'petInterval', value: -500 },
      { kind: 'petAccuracy', value: 0.3 },
    ],
    requires: ['p3', 'p4'], pos: { x: 72, y: 54 },
    desc: '再 +1 宠 / 间隔 -500 / 精准 +0.3', icon: '👑',
  },
  {
    id: 'p6', name: '驯兽精通', branch: 'pet', cost: 3200,
    effects: [
      { kind: 'petAccuracy', value: 0.25 },
      { kind: 'petInterval', value: -400 },
    ],
    requires: ['p5'], pos: { x: 58, y: 68 },
    desc: '宠物精准 +0.25 / 间隔 -400ms', icon: '🦴',
  },
  {
    id: 'p7', name: '宠物军团', branch: 'pet', cost: 18000,
    effects: [
      { kind: 'petCount', value: 2 },
      { kind: 'petInterval', value: -500 },
      { kind: 'petAccuracy', value: 0.3 },
    ],
    requires: ['p5', 'p6'], pos: { x: 50, y: 76 },
    desc: '再 +2 宠 / 间隔 -500 / 精准 +0.3（宠物 capstone）', icon: '🐲',
  },

  // ---------- 技巧分支（中段：连击与风向） ----------
  {
    id: 'c1', name: '连击入门', branch: 'combo', cost: 300,
    effects: [{ kind: 'comboCap', value: 1 }],
    requires: ['core'], pos: { x: 42, y: 47 },
    desc: '连击倍率上限 +1（基础 ×2 → ×3）', icon: '🔥',
  },
  {
    id: 'c2', name: '连击精通', branch: 'combo', cost: 800,
    effects: [{ kind: 'comboCap', value: 1 }],
    requires: ['c1'], pos: { x: 34, y: 52 },
    desc: '连击倍率上限再 +1（→ ×4）', icon: '🔥',
  },
  {
    id: 'c3', name: '连击护盾', branch: 'combo', cost: 700,
    effects: [{ kind: 'comboShield', value: 0.5 }],
    requires: ['c1'], pos: { x: 44, y: 55 },
    desc: '失误时保留一半连击数', icon: '🛡️',
  },
  {
    id: 'c4', name: '稳风', branch: 'combo', cost: 500,
    effects: [{ kind: 'windResist', value: 0.4 }],
    requires: ['core'], pos: { x: 58, y: 47 },
    desc: '减弱风向对飞镖落点的偏移', icon: '🌬️',
  },
  {
    id: 'c5', name: '连击狂热', branch: 'combo', cost: 2200,
    effects: [
      { kind: 'comboCap', value: 1 },
      { kind: 'comboShield', value: 0.25 },
    ],
    requires: ['c2', 'c3'], pos: { x: 30, y: 44 },
    desc: '连击上限 +1 / 护盾再 +0.25', icon: '⚡',
  },
  {
    id: 'c6', name: '御风大师', branch: 'combo', cost: 4500,
    effects: [
      { kind: 'windResist', value: 0.3 },
      { kind: 'comboCap', value: 1 },
    ],
    requires: ['c4', 'c5'], pos: { x: 50, y: 42 },
    desc: '稳风 +0.3 / 连击上限 +1', icon: '🌪️',
  },
  {
    id: 'c7', name: '终极技巧', branch: 'combo', cost: 15000,
    effects: [
      { kind: 'comboCap', value: 2 },
      { kind: 'comboShield', value: 0.25 },
      { kind: 'windResist', value: 0.3 },
    ],
    requires: ['c5', 'c6'], pos: { x: 22, y: 38 },
    desc: '连击上限 +2 / 护盾 +0.25 / 稳风 +0.3（技巧 capstone）', icon: '🏆',
  },
];

export const ALL_NODES: SkillNode[] = [CORE_NODE, ...SKILLS];

export const NODE_BY_ID: Record<string, SkillNode> = Object.fromEntries(
  ALL_NODES.map((n) => [n.id, n]),
);

/** 拓扑图使用的所有边（前置关系） */
export function getEdges(): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const node of ALL_NODES) {
    for (const req of node.requires) {
      edges.push({ from: req, to: node.id });
    }
  }
  return edges;
}
