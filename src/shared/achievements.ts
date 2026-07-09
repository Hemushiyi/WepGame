// ===== 成就定义（跨四关的长期目标）=====
// 由 ui.ts 在金币变动时扫描：达成且未解锁 → 解锁 + 发金币奖励 + toast。
// 计数来自 GameState.achv（见 state.ts AchvStats）。

import type { AchvStats } from './state';

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  icon: string;
  stat: keyof AchvStats; // 对应计数字段
  target: number; // 达成阈值
  reward: number; // 金币奖励
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'kill1', name: '初战告捷', desc: '击杀 10 只怪物', icon: '🗡️', stat: 'kills', target: 10, reward: 50 },
  { id: 'kill2', name: '百人斩', desc: '击杀 100 只怪物', icon: '💀', stat: 'kills', target: 100, reward: 250 },
  { id: 'wave', name: '波次领主', desc: '打怪打到第 5 波', icon: '🌊', stat: 'maxWave', target: 5, reward: 150 },
  { id: 'fever', name: '狂热者', desc: '触发 3 次 FEVER', icon: '🔥', stat: 'fever', target: 3, reward: 200 },
  { id: 'chest', name: '寻宝王', desc: '击杀 3 只宝箱怪', icon: '💎', stat: 'chests', target: 3, reward: 300 },
  { id: 'elite', name: '精英猎手', desc: '击杀 5 只精英怪', icon: '⭐', stat: 'elites', target: 5, reward: 250 },
  { id: 'boss', name: '屠魔者', desc: '击杀 1 只魔王', icon: '👑', stat: 'bosses', target: 1, reward: 400 },
  { id: 'rps', name: '读心大师', desc: '锤剪布 10 连胜', icon: '✊', stat: 'rpsMaxCombo', target: 10, reward: 300 },
  { id: 'lotto', name: '天选之子', desc: '彩票中头奖', icon: '🎰', stat: 'jackpots', target: 1, reward: 500 },
];

/** 返回已达成但尚未领取的成就（ui.ts 解锁发奖用） */
export function newlyCompleted(achv: AchvStats, done: Set<string>): Achievement[] {
  return ACHIEVEMENTS.filter((a) => !done.has(a.id) && (achv[a.stat] || 0) >= a.target);
}
