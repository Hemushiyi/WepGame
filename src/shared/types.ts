// ===== 共享类型定义 =====

export type Vec2 = { x: number; y: number };

/** 技能分支（飞镖四分支 + 彩票三分支 + 打怪三分支） */
export type SkillBranch =
  | 'target'
  | 'speed'
  | 'pet'
  | 'combo'
  | 'luck'
  | 'economy'
  | 'perk'
  | 'power'
  | 'agility'
  | 'vitality';

/** 关卡 id：每个关卡有自己独立的技能树与技能集合 */
export type LevelId = 'dart' | 'lotto' | 'battle';

/** 单个技能节点的效果（解锁后累加到派生属性上） */
export type SkillEffect =
  | { kind: 'centerRadius'; value: number } // 扩大中心点半径（虚拟像素）
  | { kind: 'ringMultiplier'; value: number } // 全环分数倍率（加法）
  | { kind: 'magnet'; value: number } // 磁吸强度（0..1）
  | { kind: 'cooldown'; value: number } // 投掷冷却（毫秒，加法，通常为负）
  | { kind: 'dartSpeed'; value: number } // 飞镖速度（像素/秒）
  | { kind: 'doubleShot'; value: number } // 双发概率（加法）
  | { kind: 'petUnlock' } // 解锁宠物系统
  | { kind: 'petCount'; value: number } // 增加宠物数量
  | { kind: 'petInterval'; value: number } // 宠物投掷间隔（毫秒，加法）
  | { kind: 'petAccuracy'; value: number } // 宠物精准度（0..1）
  | { kind: 'petReward'; value: number } // 宠物命中奖励占玩家的比例（加法）
  | { kind: 'comboCap'; value: number } // 连击倍率上限（加法）
  | { kind: 'comboShield'; value: number } // 失误时保留的连击比例（0..1）
  | { kind: 'windResist'; value: number } // 抵御风向影响（0..1）
  // ---- 彩票技能（仅作用于彩票关卡）----
  | { kind: 'lottoCost'; value: number } // 票价折扣比例（加法，0..0.5）
  | { kind: 'lottoWin'; value: number } // 基础中奖率加成（加法）
  | { kind: 'lottoPityBonus'; value: number } // 每点幸运值的概率加成增强（加到 LUCK_BONUS_PER_PITY）
  | { kind: 'lottoPityCap'; value: number } // 各档 maxPity 加成
  | { kind: 'lottoPrizeMult'; value: number } // 全档奖金倍率（加法）
  | { kind: 'lottoJackpotMult'; value: number } // 头奖档奖金额外倍率（加法）
  | { kind: 'lottoFreeTicket'; value: number } // 购票免费概率（加法，0..0.3）
  // ---- 打怪技能（仅作用于打怪关卡）----
  | { kind: 'battleDamage'; value: number } // 每剑伤害（加法）
  | { kind: 'battleCooldown'; value: number } // 挥剑冷却（毫秒，加法，通常为负）
  | { kind: 'battleMaxHp'; value: number } // 最大血量（加法）
  | { kind: 'battleCrit'; value: number } // 暴击概率（加法，0..1）
  | { kind: 'battleLifesteal'; value: number } // 每次命中回血（加法）
  | { kind: 'battleCoin'; value: number }; // 击杀金币加成（加法比例）

/** 技能树节点 */
export interface SkillNode {
  id: string;
  name: string;
  branch: SkillBranch;
  cost: number;
  effects: SkillEffect[];
  /** 前置节点 id 列表（构成拓扑网络） */
  requires: string[];
  /** 在拓扑图中的坐标（0..100 的相对坐标） */
  pos: Vec2;
  desc: string;
  icon: string;
}

/** 由已解锁节点派生出的全部游戏属性 */
export interface DerivedStats {
  centerRadius: number;
  r2: number;
  r3: number;
  r4: number;
  ringMultiplier: number;
  magnet: number;
  cooldown: number;
  dartSpeed: number;
  doubleShotChance: number;
  petUnlocked: boolean;
  petCount: number;
  petInterval: number;
  petAccuracy: number;
  petReward: number; // 宠物命中奖励占玩家的比例（基础 0.1）
  comboCap: number; // 连击倍率上限（基础 2.0）
  comboShield: number; // 失误时保留的连击比例（0..1）
  windResist: number; // 抵御风向影响（0..1）
}

/** 彩票关卡的派生属性（由彩票技能树解锁节点累加） */
export interface LottoStats {
  costDiscount: number; // 票价折扣（0..0.5），实付 = 票价*(1-costDiscount)
  winBonus: number; // 加到每张票的基础中奖率
  pityBonus: number; // 每点幸运值的概率加成增强（叠加在 LUCK_BONUS_PER_PITY 上）
  pityCapBonus: number; // 各档幸运值上限 maxPity 的加成
  prizeMult: number; // 全档奖金倍率（加法）
  jackpotMult: number; // 头奖档奖金的额外倍率（加法）
  freeTicket: number; // 购票免费概率（0..0.3）
}

/** 打怪关卡的派生属性（由打怪技能树解锁节点累加） */
export interface BattleStats {
  damage: number; // 每剑伤害（整数，基础 1）
  cooldown: number; // 挥剑冷却（毫秒，基础 ~380）
  maxHp: number; // 最大血量（基础 5）
  crit: number; // 暴击概率（0..1）
  critMult: number; // 暴击倍率（固定 2）
  lifesteal: number; // 每次命中回血（整数）
  coinBonus: number; // 击杀金币加成（加法比例）
}

/** 飞镖运行状态 */
export interface Dart {
  pos: Vec2;
  sx: number; // 起飞 x（用于插值与朝向）
  target: Vec2;
  startY: number;
  progress: number; // 0..1 飞行进度（负值表示延迟起飞）
  speed: number; // 完整飞行所需毫秒
  fromPet: boolean;
  hit: boolean;
}

/** 飞起的分数飘字 */
export interface FloatText {
  pos: Vec2;
  text: string;
  color: string;
  life: number; // 剩余毫秒
  vy: number;
}
