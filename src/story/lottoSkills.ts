// ===== 彩票独立技能树（第三段剧情后解锁）=====
import type { SkillNode } from '../shared/types';

export const LOTTO_DART_CORE: SkillNode = {
  id: 'L0',
  name: '彩票核心',
  branch: 'combo',
  cost: 0,
  effects: [],
  requires: [],
  pos: { x: 50, y: 50 },
  desc: '彩票技能起点',
  icon: '🎫',
};

export const ALL_LOTTO_DART_NODES: SkillNode[] = [
  LOTTO_DART_CORE,
  {
    id: 'L1', name: '幸运加成', branch: 'combo', cost: 800,
    effects: [{ kind: 'ticketLuck', value: 0.05 }],
    requires: ['L0'], pos: { x: 42, y: 40 },
    desc: '彩票中奖率 +5%', icon: '🍀',
  },
  {
    id: 'L2', name: '掉落率 I', branch: 'combo', cost: 1200,
    effects: [{ kind: 'ticketDropRate', value: 0.01 }],
    requires: ['L1'], pos: { x: 32, y: 34 },
    desc: '彩票掉落概率 +1%（基准 1%）', icon: '🎫',
  },
  {
    id: 'L3', name: '掉落率 II', branch: 'combo', cost: 3000,
    effects: [{ kind: 'ticketDropRate', value: 0.02 }],
    requires: ['L2'], pos: { x: 22, y: 30 },
    desc: '再 +2%（累计 3%）', icon: '🎫',
  },
  {
    id: 'L4', name: '彩票价值', branch: 'combo', cost: 2000,
    effects: [{ kind: 'ticketValue', value: 0.5 }],
    requires: ['L1'], pos: { x: 42, y: 52 },
    desc: '彩票奖金 ×1.5', icon: '💎',
  },
  {
    id: 'L5', name: '刮奖机器人', branch: 'combo', cost: 4000,
    effects: [{ kind: 'ticketRobot', value: 1 }],
    requires: ['L2'], pos: { x: 30, y: 44 },
    desc: '解锁机器人自动拾取刮奖', icon: '🤖',
  },
  {
    id: 'L6', name: '机器人加速', branch: 'combo', cost: 2500,
    effects: [{ kind: 'ticketRobotSpeed', value: 0.3 }],
    requires: ['L5'], pos: { x: 20, y: 40 },
    desc: '机器人拾取速度 +30%', icon: '⚡',
  },
  {
    id: 'L7', name: '机器人好运', branch: 'combo', cost: 3500,
    effects: [{ kind: 'ticketRobotLuck', value: 0.08 }],
    requires: ['L5'], pos: { x: 28, y: 54 },
    desc: '机器人中奖率 +8%', icon: '🎰',
  },
  {
    id: 'L8', name: '双倍掉落', branch: 'combo', cost: 5000,
    effects: [{ kind: 'ticketDoubleDrop', value: 0.10 }],
    requires: ['L3'], pos: { x: 14, y: 34 },
    desc: '10% 概率一次掉两张彩票', icon: '🎟️',
  },
  {
    id: 'L9', name: '超级大奖', branch: 'combo', cost: 8000,
    effects: [{ kind: 'ticketJackpot', value: 0.03 }],
    requires: ['L4', 'L7'], pos: { x: 30, y: 62 },
    desc: '3% 触发超级大奖（×5 倍奖金）', icon: '🏆',
  },

  {
    id: 'L1b', name: '铜票幸运 II', branch: 'combo', cost: 2000,
    effects: [{ kind: 'ticketLuck', value: 0.06 }],
    requires: ['L1'], pos: { x: 50, y: 32 },
    desc: '铜票中奖率再 +6%（累计 11%）', icon: '🍀',
  },

  // ---------- 银票分支 ----------
  {
    id: 'T1', name: '银票解锁', branch: 'combo', cost: 3000,
    effects: [{ kind: 'silverUnlock', value: 1 }],
    requires: ['L3'], pos: { x: 14, y: 24 },
    desc: '解锁银票掉落（4图标，大奖1500）', icon: '⚪',
  },
  {
    id: 'T2', name: '银票幸运 I', branch: 'combo', cost: 1500,
    effects: [{ kind: 'silverLuck', value: 0.05 }],
    requires: ['T1'], pos: { x: 6, y: 20 },
    desc: '银票中奖率 +5%', icon: '🍀',
  },
  {
    id: 'T3', name: '银票幸运 II', branch: 'combo', cost: 3000,
    effects: [{ kind: 'silverLuck', value: 0.08 }],
    requires: ['T2'], pos: { x: 0, y: 26 },
    desc: '再 +8%（累计 13%）', icon: '🍀',
  },

  // ---------- 金票分支 ----------
  {
    id: 'T4', name: '金票解锁', branch: 'combo', cost: 8000,
    effects: [{ kind: 'goldUnlock', value: 1 }],
    requires: ['T1'], pos: { x: 20, y: 20 },
    desc: '解锁金票掉落（5图标，大奖5000）', icon: '🟡',
  },
  {
    id: 'T5', name: '金票幸运 I', branch: 'combo', cost: 3000,
    effects: [{ kind: 'goldLuck', value: 0.04 }],
    requires: ['T4'], pos: { x: 26, y: 14 },
    desc: '金票中奖率 +4%', icon: '🍀',
  },
  {
    id: 'T6', name: '金票幸运 II', branch: 'combo', cost: 6000,
    effects: [{ kind: 'goldLuck', value: 0.06 }],
    requires: ['T5'], pos: { x: 32, y: 10 },
    desc: '再 +6%（累计 10%）', icon: '🍀',
  },

  // ---------- 机器人升级 ----------
  {
    id: 'R1', name: '机器人升级 I', branch: 'combo', cost: 2000,
    effects: [{ kind: 'robotTier', value: 1 }],
    requires: ['L5', 'T1'], pos: { x: 22, y: 48 },
    desc: '机器人可自动刮银票', icon: '🤖',
  },
  {
    id: 'R2', name: '机器人升级 II', branch: 'combo', cost: 5000,
    effects: [{ kind: 'robotTier', value: 1 }],
    requires: ['R1', 'T4'], pos: { x: 24, y: 42 },
    desc: '机器人可自动刮金票', icon: '🤖',
  },
  {
    id: 'R3', name: '机器人幸运同步', branch: 'combo', cost: 3000,
    effects: [{ kind: 'ticketRobotLuck', value: 0.05 }],
    requires: ['R1'], pos: { x: 16, y: 50 },
    desc: '机器人继承银/金幸运加成 +5%', icon: '🎰',
  },
  {
    id: 'R4', name: '机器人军团', branch: 'combo', cost: 5000,
    effects: [{ kind: 'robotCount', value: 2 }],
    requires: ['R1'], pos: { x: 8, y: 46 },
    desc: '最多 3 个机器人同时工作', icon: '🤖',
  },

  // ---------- 恶魔彩票 ----------
  {
    id: 'D1', name: '恶魔契约', branch: 'combo', cost: 5000,
    effects: [{ kind: 'demonDrop', value: 0.005 }],
    requires: ['L3'], pos: { x: 44, y: 62 },
    desc: '解锁恶魔票（0.5%掉落，自动烧毁召魔）', icon: '👹',
  },
  {
    id: 'D2', name: '恶魔召唤 I', branch: 'combo', cost: 3000,
    effects: [{ kind: 'demonCount', value: 1 }],
    requires: ['D1'], pos: { x: 52, y: 56 },
    desc: '恶魔最多 2 只同时存在', icon: '👹',
  },
  {
    id: 'D3', name: '恶魔召唤 II', branch: 'combo', cost: 6000,
    effects: [{ kind: 'demonCount', value: 1 }],
    requires: ['D2'], pos: { x: 60, y: 50 },
    desc: '恶魔最多 3 只同时存在', icon: '👹',
  },
  {
    id: 'D4', name: '恶魔碎片 I', branch: 'combo', cost: 2000,
    effects: [{ kind: 'demonShards', value: 1 }],
    requires: ['D1'], pos: { x: 50, y: 66 },
    desc: '击中恶魔爆 2~6 张票', icon: '💥',
  },
  {
    id: 'D5', name: '恶魔碎片 II', branch: 'combo', cost: 4000,
    effects: [{ kind: 'demonShards', value: 1 }],
    requires: ['D4'], pos: { x: 58, y: 62 },
    desc: '击中恶魔爆 3~7 张票', icon: '💥',
  },
  {
    id: 'D6', name: '恶魔贵族', branch: 'combo', cost: 8000,
    effects: [{ kind: 'demonUpgrade', value: 0.5 }],
    requires: ['D3', 'D5'], pos: { x: 62, y: 56 },
    desc: '恶魔爆票 50% 概率升级一档', icon: '👑',
  },

  // ---------- 机器人加速 ----------
  {
    id: 'R5', name: '机器人加速 II', branch: 'combo', cost: 4000,
    effects: [{ kind: 'robotSpeed', value: 0.3 }],
    requires: ['R1'], pos: { x: 2, y: 42 },
    desc: '机器人行走速度 +30%', icon: '⚡',
  },
  {
    id: 'R6', name: '机器人加速 III', branch: 'combo', cost: 8000,
    effects: [{ kind: 'robotSpeed', value: 0.2 }],
    requires: ['R5'], pos: { x: -2, y: 36 },
    desc: '机器人行走速度再 +20%（累计 +50%）', icon: '⚡',
  },
  {
    id: 'R7', name: '机器人大军', branch: 'combo', cost: 8000,
    effects: [{ kind: 'robotCount', value: 3 }],
    requires: ['R4'], pos: { x: 4, y: 36 },
    desc: '再 +3 个机器人（最多 6 个）', icon: '🤖',
  },

  // ---------- 钻石票 ----------
  {
    id: 'T7', name: '钻石解锁', branch: 'combo', cost: 15000,
    effects: [{ kind: 'diamondUnlock', value: 1 }],
    requires: ['T6'], pos: { x: 40, y: 8 },
    desc: '解锁钻石票（6图标，大奖15000）', icon: '💎',
  },
  {
    id: 'T8', name: '钻石幸运 I', branch: 'combo', cost: 5000,
    effects: [{ kind: 'diamondLuck', value: 0.03 }],
    requires: ['T7'], pos: { x: 48, y: 4 },
    desc: '钻石中奖率 +3%', icon: '🍀',
  },
  {
    id: 'T9', name: '钻石幸运 II', branch: 'combo', cost: 10000,
    effects: [{ kind: 'diamondLuck', value: 0.04 }],
    requires: ['T8'], pos: { x: 56, y: 0 },
    desc: '钻石中奖率 +4%（累计 7%）', icon: '🍀',
  },

  // ---------- 终极大奖（100万）----------
  {
    id: 'X1', name: '终极大奖', branch: 'combo', cost: 1000000,
    effects: [{ kind: 'angelUnlock', value: 1 }],
    requires: ['L9'], pos: { x: 38, y: 70 },
    desc: '解锁天使/恶魔彩票（5%掉落）', icon: '👼',
  },
];

export const LOTTO_DART_NODE_BY_ID: Record<string, SkillNode> =
  Object.fromEntries(ALL_LOTTO_DART_NODES.map((n) => [n.id, n]));

export function getLottoDartEdges(): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const node of ALL_LOTTO_DART_NODES) {
    for (const req of node.requires) {
      edges.push({ from: req, to: node.id });
    }
  }
  return edges;
}
