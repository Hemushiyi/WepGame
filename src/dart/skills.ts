import type { SkillNode } from '../shared/types';

// ===== 技能树拓扑数据 =====
// 中心 CORE 为起点（默认拥有），四条分支向四角辐射，互不侵入：
//   左上 target（目标）→ 扩大中心点 / 环分 / 磁吸 / 超大中心 / 命运之眼
//   右上 speed（速度）→ 冷却 / 飞镖加速 / 双发 / 急速连投 / 闪电神速（target 的镜像）
//   左下 combo（技巧）→ 连击上限 / 连击护盾 / 稳风 / 连击狂热 / 终极技巧
//   右下 pet（宠物）→ 解锁 / 频率 / 精准 / 多宠 / 超级宠物 / 宠物军团
// 四个 capstone 终极节点分别落在左上 / 右上 / 左下 / 右下四角，构图对称。
// 节点最小间距 ≥ 10（外环半径 4.7 → 圆心需 ≥9.4），保证不重叠、易点选。
// 注：经济已收紧 —— 金币只来自基础分；连击只放大“分数”，不影响金币。
// 用户反馈“太便宜、一下就升完”，故本表费用大幅提高，全树总费用约 9 万金币。

export const CORE_NODE: SkillNode = {
  id: 'core',
  name: '飞镖核心',
  branch: 'target',
  cost: 0,
  effects: [],
  requires: [],
  pos: { x: 50, y: 40 },
  desc: '一切投掷的起点',
  icon: '★',
};

export const SKILLS: SkillNode[] = [
  // ---------- 目标分支（左上） ----------
  {
    id: 't1', name: '放大中心 I', branch: 'target', cost: 250,
    effects: [{ kind: 'centerRadius', value: 6 }],
    requires: ['core'], pos: { x: 40, y: 26 },
    desc: '中心点半径 +6', icon: '🎯',
  },
  {
    id: 't2', name: '放大中心 II', branch: 'target', cost: 600,
    effects: [{ kind: 'centerRadius', value: 7 }],
    requires: ['t1'], pos: { x: 32, y: 14 },
    desc: '中心点半径 +7', icon: '🎯',
  },
  {
    id: 't3', name: '环分倍率', branch: 'target', cost: 900,
    effects: [{ kind: 'ringMultiplier', value: 0.5 }],
    requires: ['t2'], pos: { x: 20, y: 8 },
    desc: '所有环位得分 ×1.5', icon: '✨',
  },
  {
    id: 't4', name: '磁吸', branch: 'target', cost: 550,
    effects: [{ kind: 'magnet', value: 0.12 }],
    requires: ['t1'], pos: { x: 28, y: 34 },
    desc: '飞镖轻微被中心吸引', icon: '🧲',
  },
  {
    id: 't5', name: '超大中心', branch: 'target', cost: 3500,
    effects: [
      { kind: 'centerRadius', value: 12 },
      { kind: 'ringMultiplier', value: 0.5 },
    ],
    requires: ['t3', 't4'], pos: { x: 14, y: 24 },
    desc: '中心点扩张 +12 / 得分再 ×1.5', icon: '💫',
  },
  {
    id: 't6', name: '强效磁吸', branch: 'target', cost: 1800,
    effects: [
      { kind: 'magnet', value: 0.13 },
      { kind: 'ringMultiplier', value: 0.3 },
    ],
    requires: ['t5'], pos: { x: 4, y: 16 },
    desc: '磁吸 +0.13 / 环分再 ×1.3', icon: '🧲',
  },
  {
    id: 't7', name: '命运之眼', branch: 'target', cost: 12000,
    effects: [
      { kind: 'centerRadius', value: 5 },
      { kind: 'magnet', value: 0.1 },
      { kind: 'ringMultiplier', value: 0.5 },
    ],
    requires: ['t5', 't6'], pos: { x: 0, y: 30 },
    desc: '中心 +5 / 磁吸 +0.1 / 环分 ×1.5（目标 capstone）', icon: '👁️',
  },

  // ---------- 速度分支（右上，目标的镜像） ----------
  {
    id: 's1', name: '减冷却 I', branch: 'speed', cost: 250,
    effects: [{ kind: 'cooldown', value: -150 }],
    requires: ['core'], pos: { x: 60, y: 26 },
    desc: '投掷冷却 -150ms', icon: '⚡',
  },
  {
    id: 's2', name: '飞镖加速', branch: 'speed', cost: 600,
    effects: [{ kind: 'dartSpeed', value: 240 }],
    requires: ['s1'], pos: { x: 68, y: 14 },
    desc: '飞镖飞行速度 +240', icon: '💨',
  },
  {
    id: 's3', name: '减冷却 II', branch: 'speed', cost: 900,
    effects: [{ kind: 'cooldown', value: -200 }],
    requires: ['s2'], pos: { x: 80, y: 8 },
    desc: '投掷冷却 -200ms', icon: '⚡',
  },
  {
    id: 's4', name: '双发', branch: 'speed', cost: 700,
    effects: [{ kind: 'doubleShot', value: 0.15 }],
    requires: ['s2'], pos: { x: 72, y: 34 },
    desc: '15% 概率同时投出两镖', icon: '✊',
  },
  {
    id: 's5', name: '急速连投', branch: 'speed', cost: 3500,
    effects: [
      { kind: 'cooldown', value: -150 },
      { kind: 'doubleShot', value: 0.15 },
      { kind: 'dartSpeed', value: 240 },
    ],
    requires: ['s3', 's4'], pos: { x: 86, y: 24 },
    desc: '冷却 -150 / 双发 +15% / 速度 +240', icon: '🔥',
  },
  {
    id: 's6', name: '连环双发', branch: 'speed', cost: 1800,
    effects: [
      { kind: 'doubleShot', value: 0.15 },
      { kind: 'dartSpeed', value: 200 },
    ],
    requires: ['s5'], pos: { x: 96, y: 16 },
    desc: '双发概率 +15% / 飞镖速度 +200', icon: '✊',
  },
  {
    id: 's7', name: '闪电神速', branch: 'speed', cost: 11000,
    effects: [
      { kind: 'cooldown', value: -250 },
      { kind: 'doubleShot', value: 0.2 },
      { kind: 'dartSpeed', value: 300 },
    ],
    requires: ['s5', 's6'], pos: { x: 100, y: 30 },
    desc: '冷却 -250 / 双发 +20% / 速度 +300（速度 capstone）', icon: '🌩️',
  },

  // ---------- 宠物分支（右下） ----------
  {
    id: 'p1', name: '解锁宠物', branch: 'pet', cost: 700,
    effects: [{ kind: 'petUnlock' }, { kind: 'petCount', value: 1 }],
    requires: ['core'], pos: { x: 58, y: 50 },
    desc: '召唤一只小宠物自动投掷', icon: '🐾',
  },
  {
    id: 'p2', name: '宠物频率', branch: 'pet', cost: 900,
    effects: [{ kind: 'petInterval', value: -500 }],
    requires: ['p1'], pos: { x: 70, y: 54 },
    desc: '宠物投掷间隔 -500ms', icon: '⏱️',
  },
  {
    id: 'p3', name: '宠物精准', branch: 'pet', cost: 900,
    effects: [{ kind: 'petAccuracy', value: 0.3 }],
    requires: ['p1'], pos: { x: 64, y: 66 },
    desc: '宠物散布更小、更易命中中心', icon: '🎯',
  },
  {
    id: 'p4', name: '再加一宠', branch: 'pet', cost: 2000,
    effects: [{ kind: 'petCount', value: 1 }],
    requires: ['p2'], pos: { x: 78, y: 64 },
    desc: '额外召唤一只宠物', icon: '🐾',
  },
  {
    id: 'p5', name: '超级宠物', branch: 'pet', cost: 5500,
    effects: [
      { kind: 'petCount', value: 1 },
      { kind: 'petInterval', value: -500 },
      { kind: 'petAccuracy', value: 0.3 },
    ],
    requires: ['p3', 'p4'], pos: { x: 72, y: 76 },
    desc: '再 +1 宠 / 间隔 -500 / 精准 +0.3', icon: '👑',
  },
  {
    id: 'p6', name: '驯兽精通', branch: 'pet', cost: 3200,
    effects: [
      { kind: 'petAccuracy', value: 0.25 },
      { kind: 'petInterval', value: -400 },
    ],
    requires: ['p5'], pos: { x: 86, y: 70 },
    desc: '宠物精准 +0.25 / 间隔 -400ms', icon: '🦴',
  },
  {
    id: 'p7', name: '宠物军团', branch: 'pet', cost: 18000,
    effects: [
      { kind: 'petCount', value: 2 },
      { kind: 'petInterval', value: -500 },
      { kind: 'petAccuracy', value: 0.3 },
    ],
    requires: ['p5', 'p6'], pos: { x: 94, y: 78 },
    desc: '再 +2 宠 / 间隔 -500 / 精准 +0.3（宠物 capstone）', icon: '🐲',
  },
  {
    id: 'p8', name: '宠物分红 I', branch: 'pet', cost: 2500,
    effects: [{ kind: 'petReward', value: 0.10 }],
    requires: ['p6'], pos: { x: 104, y: 66 },
    desc: '宠物命中奖励 +10%（30% → 40%）', icon: '💰',
  },
  {
    id: 'p9', name: '宠物分红 II', branch: 'pet', cost: 6000,
    effects: [{ kind: 'petReward', value: 0.15 }],
    requires: ['p8'], pos: { x: 110, y: 76 },
    desc: '宠物命中奖励 +15%（40% → 55%）', icon: '💰',
  },

  // ---------- 技巧分支（左下：连击与风向） ----------
  {
    id: 'c1', name: '连击入门', branch: 'combo', cost: 300,
    effects: [{ kind: 'comboCap', value: 1 }],
    requires: ['core'], pos: { x: 38, y: 50 },
    desc: '连击倍率上限 +1（基础 ×2 → ×3）', icon: '🔥',
  },
  {
    id: 'c2', name: '连击精通', branch: 'combo', cost: 800,
    effects: [{ kind: 'comboCap', value: 1 }],
    requires: ['c1'], pos: { x: 26, y: 60 },
    desc: '连击倍率上限再 +1（→ ×4）', icon: '🔥',
  },
  {
    id: 'c3', name: '连击护盾', branch: 'combo', cost: 700,
    effects: [{ kind: 'comboShield', value: 0.5 }],
    requires: ['c1'], pos: { x: 36, y: 66 },
    desc: '失误时保留一半连击数', icon: '🛡️',
  },
  {
    id: 'c4', name: '稳风', branch: 'combo', cost: 500,
    effects: [{ kind: 'windResist', value: 0.4 }],
    requires: ['core'], pos: { x: 48, y: 58 },
    desc: '减弱风向对飞镖落点的偏移', icon: '🌬️',
  },
  {
    id: 'c5', name: '连击狂热', branch: 'combo', cost: 2200,
    effects: [
      { kind: 'comboCap', value: 1 },
      { kind: 'comboShield', value: 0.25 },
    ],
    requires: ['c2', 'c3'], pos: { x: 24, y: 70 },
    desc: '连击上限 +1 / 护盾再 +0.25', icon: '⚡',
  },
  {
    id: 'c6', name: '御风大师', branch: 'combo', cost: 4500,
    effects: [
      { kind: 'windResist', value: 0.3 },
      { kind: 'comboCap', value: 1 },
    ],
    requires: ['c4', 'c5'], pos: { x: 40, y: 77 },
    desc: '稳风 +0.3 / 连击上限 +1', icon: '🌪️',
  },
  {
    id: 'c7', name: '终极技巧', branch: 'combo', cost: 15000,
    effects: [
      { kind: 'comboCap', value: 2 },
      { kind: 'comboShield', value: 0.25 },
      { kind: 'windResist', value: 0.3 },
    ],
    requires: ['c5', 'c6'], pos: { x: 12, y: 72 },
    desc: '连击上限 +2 / 护盾 +0.25 / 稳风 +0.3（技巧 capstone）', icon: '🏆',
  },
  {
    id: 's4b', name: '连续投掷 I', branch: 'speed', cost: 1000,
    effects: [{ kind: 'chainThrow', value: 0.08 }],
    requires: ['s4'], pos: { x: 68, y: 42 },
    desc: '8% 概率投出后再补一镖', icon: '🔄',
  },
  {
    id: 's4c', name: '连续投掷 II', branch: 'speed', cost: 2500,
    effects: [{ kind: 'chainThrow', value: 0.10 }],
    requires: ['s4b'], pos: { x: 84, y: 58 },
    desc: '再加 10%（累计 18%）', icon: '🔄',
  },
  {
    id: 's4d', name: '连续投掷 III', branch: 'speed', cost: 5000,
    effects: [{ kind: 'chainThrow', value: 0.12 }],
    requires: ['s4c'], pos: { x: 96, y: 68 },
    desc: '再加 12%（累计 30%）', icon: '🔄',
  },
  {
    id: 't4b', name: '暴击 I', branch: 'target', cost: 800,
    effects: [{ kind: 'critChance', value: 0.08 }],
    requires: ['t4'], pos: { x: 28, y: 44 },
    desc: '8% 概率暴击得分×2', icon: '💥',
  },
  {
    id: 't4c', name: '暴击 II', branch: 'target', cost: 2000,
    effects: [{ kind: 'critChance', value: 0.10 }],
    requires: ['t4b'], pos: { x: 22, y: 52 },
    desc: '再加 10%（累计 18%）', icon: '💥',
  },
  {
    id: 't4d', name: '暴击 III', branch: 'target', cost: 4000,
    effects: [{ kind: 'critChance', value: 0.12 }],
    requires: ['t4c'], pos: { x: 16, y: 60 },
    desc: '再加 12%（累计 30%）', icon: '💥',
  },
  {
    id: 'c3b', name: '幸运掉落 I', branch: 'combo', cost: 1200,
    effects: [{ kind: 'luckyDrop', value: 0.06 }],
    requires: ['c3'], pos: { x: 62, y: 92 },
    desc: '命中 6% 概率掉金币袋', icon: '🎁',
  },
  {
    id: 'c3c', name: '幸运掉落 II', branch: 'combo', cost: 3000,
    effects: [{ kind: 'luckyDrop', value: 0.09 }],
    requires: ['c3b'], pos: { x: 20, y: 86 },
    desc: '再加 9%（累计 15%）', icon: '🎁',
  },
  {
    id: 'p3b', name: '精灵伙伴 I', branch: 'pet', cost: 1500,
    effects: [{ kind: 'fairySpawn', value: 1 }],
    requires: ['p3'], pos: { x: 56, y: 78 },
    desc: '解锁漂浮精灵，击中+80金币', icon: '🧚',
  },
  {
    id: 'p3c', name: '精灵伙伴 II', branch: 'pet', cost: 3500,
    effects: [{ kind: 'fairySpawn', value: 1 }],
    requires: ['p3b'], pos: { x: 60, y: 90 },
    desc: '第二只精灵（最多2只）', icon: '🧚',
  },
  {
    id: 't6b', name: '黄金飞镖 I', branch: 'target', cost: 2500,
    effects: [{ kind: 'goldenDart', value: 0.06 }],
    requires: ['t6'], pos: { x: 4, y: 6 },
    desc: '6% 概率黄金飞镖，金币×3', icon: '🪙',
  },
  {
    id: 't6c', name: '黄金飞镖 II', branch: 'target', cost: 5000,
    effects: [{ kind: 'goldenDart', value: 0.09 }],
    requires: ['t6b'], pos: { x: -4, y: 10 },
    desc: '再加 9%（累计 15%）', icon: '🪙',
  },

  // ---------- 闪电分支（storm：第五分支，core 正下方偏右） ----------
  {
    id: 'z1', name: '静电感应', branch: 'storm', cost: 500,
    effects: [{ kind: 'autoAim', value: 0.10 }],
    requires: ['core'], pos: { x: 42, y: 38 },
    desc: '准星范围缩小 10%，更易命中', icon: '⚡',
  },
  {
    id: 'z2', name: '闪电命中 I', branch: 'storm', cost: 1200,
    effects: [{ kind: 'lightningStrike', value: 0.05 }],
    requires: ['z1'], pos: { x: 34, y: 50 },
    desc: '5% 概率闪电修正飞镖自动靶心', icon: '🗲',
  },
  {
    id: 'z3', name: '闪电命中 II', branch: 'storm', cost: 3000,
    effects: [{ kind: 'lightningStrike', value: 0.08 }],
    requires: ['z2'], pos: { x: 34, y: 58 },
    desc: '再加 8%（累计 13%）', icon: '🗲',
  },
  {
    id: 'z4', name: '雷暴', branch: 'storm', cost: 2500,
    effects: [{ kind: 'stormSurge', value: 1.0 }],
    requires: ['z2'], pos: { x: 44, y: 64 },
    desc: '闪电触发时金币额外 ×2', icon: '🌩️',
  },
  {
    id: 'z5', name: '闪电命中 III', branch: 'storm', cost: 6000,
    effects: [{ kind: 'lightningStrike', value: 0.10 }],
    requires: ['z3'], pos: { x: 10, y: 78 },
    desc: '再加 10%（累计 23%）', icon: '🗲',
  },
  {
    id: 'z6', name: '全屏雷暴', branch: 'storm', cost: 5000,
    effects: [{ kind: 'thunderBurst', value: 0.04 }],
    requires: ['z4', 'z5'], pos: { x: 36, y: 82 },
    desc: '4% 概率全屏闪电清空飞行物×2', icon: '⚡',
  },
  {
    id: 'z7', name: '雷神之怒', branch: 'storm', cost: 12000,
    effects: [
      { kind: 'lightningStrike', value: 0.05 },
      { kind: 'stormSurge', value: 1.5 },
      { kind: 'thunderBurst', value: 0.06 },
    ],
    requires: ['z5', 'z6'], pos: { x: 36, y: 88 },
    desc: '闪电+5% / 金币+1.5× / 雷暴+6%（闪电 capstone）', icon: '👑',
  },

  // ---------- 穿透飞镖（target 分支扩展）----------
  {
    id: 't2b', name: '穿透飞镖 I', branch: 'target', cost: 1500,
    effects: [{ kind: 'dartPierce', value: 1 }],
    requires: ['t2'], pos: { x: 24, y: 2 },
    desc: '飞镖命中后继续穿透 1 层环', icon: '🔱',
  },
  {
    id: 't2c', name: '穿透飞镖 II', branch: 'target', cost: 4000,
    effects: [{ kind: 'dartPierce', value: 2 }],
    requires: ['t2b'], pos: { x: 14, y: -4 },
    desc: '再穿透 2 层（累计 3 层）', icon: '🔱',
  },

  // ---------- 三/四连发（speed 分支扩展）----------
  {
    id: 's1b', name: '三连发', branch: 'speed', cost: 2000,
    effects: [{ kind: 'tripleShot', value: 0.06 }],
    requires: ['s1'], pos: { x: 58, y: 18 },
    desc: '6% 概率一次投三支镖', icon: '✊',
  },
  {
    id: 's1c', name: '四连发', branch: 'speed', cost: 5000,
    effects: [{ kind: 'tripleShot', value: 0.10 }],
    requires: ['s1b'], pos: { x: 74, y: 8 },
    desc: '再加 10%（累计 16%）一次四支', icon: '✊',
  },

  // ---------- 宠物暴击（pet 分支扩展）----------
  {
    id: 'p2b', name: '宠物暴击 I', branch: 'pet', cost: 1800,
    effects: [{ kind: 'petCrit', value: 0.08 }],
    requires: ['p2'], pos: { x: 52, y: 72 },
    desc: '宠物命中 8% 暴击得分×2', icon: '💢',
  },
  {
    id: 'p2c', name: '宠物暴击 II', branch: 'pet', cost: 3500,
    effects: [{ kind: 'petCrit', value: 0.10 }],
    requires: ['p2b'], pos: { x: 48, y: 80 },
    desc: '再加 10%（累计 18%）', icon: '💢',
  },

  // ---------- 金币加成（combo + target 分支扩展）----------
  {
    id: 'c4b', name: '金币双倍 I', branch: 'combo', cost: 1800,
    effects: [{ kind: 'coinDoubler', value: 0.08 }],
    requires: ['c4'], pos: { x: 54, y: 64 },
    desc: '命中后 8% 概率金币翻倍', icon: '💸',
  },
  {
    id: 'c4c', name: '金币双倍 II', branch: 'combo', cost: 4000,
    effects: [{ kind: 'coinDoubler', value: 0.10 }],
    requires: ['c4b'], pos: { x: 64, y: 72 },
    desc: '再加 10%（累计 18%）', icon: '💸',
  },
  {
    id: 't1b', name: '金币基础 I', branch: 'target', cost: 800,
    effects: [{ kind: 'coinBonus', value: 5 }],
    requires: ['t1'], pos: { x: 48, y: 28 },
    desc: '每次命中额外 +5 金币', icon: '🪙',
  },
  {
    id: 't1c', name: '金币基础 II', branch: 'target', cost: 2000,
    effects: [{ kind: 'coinBonus', value: 10 }],
    requires: ['t1b'], pos: { x: 64, y: 26 },
    desc: '每次命中再 +10（累计 +15）', icon: '🪙',
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
