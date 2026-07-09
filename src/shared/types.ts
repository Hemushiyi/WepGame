// ===== 共享类型定义 =====

export type Vec2 = { x: number; y: number };

/** 技能分支（飞镖五分支 + 彩票三分支 + 打怪三分支 + 锤剪布三分支 + 射击三分支） */
export type SkillBranch =
  | 'target'
  | 'speed'
  | 'pet'
  | 'combo'
  | 'storm'
  | 'luck'
  | 'economy'
  | 'perk'
  | 'power'
  | 'agility'
  | 'vitality'
  | 'atk'
  | 'mind'
  | 'guard'
  | 'fire'
  | 'dodge'
  | 'hull';

/** 关卡 id：每个关卡有自己独立的技能树与技能集合 */
export type LevelId = 'dart' | 'lotto' | 'battle' | 'rps' | 'shooter';

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
  | { kind: 'chainThrow'; value: number } // 连续投掷概率
  | { kind: 'critChance'; value: number } // 暴击概率，得分×2
  | { kind: 'goldenDart'; value: number } // 黄金飞镖概率，命中金币×3
  | { kind: 'fairySpawn'; value: number } // 漂浮精灵数量
  | { kind: 'luckyDrop'; value: number } // 命中后掉落金币袋概率
  // ---- 闪电分支（storm）----
  | { kind: 'lightningStrike'; value: number } // 飞行中概率闪电修正自动靶心
  | { kind: 'stormSurge'; value: number } // 闪电触发额外金币倍率
  | { kind: 'autoAim'; value: number } // 准星振荡范围缩小
  | { kind: 'thunderBurst'; value: number } // 命中触发全屏雷暴
  // ---- 扩展 skill ----
  | { kind: 'dartPierce'; value: number } // 穿透飞镖（命中后继续飞行）
  | { kind: 'tripleShot'; value: number } // 三/四连发概率
  | { kind: 'petCrit'; value: number } // 宠物暴击概率
  // ---- 金币加成 ----
  | { kind: 'coinDoubler'; value: number } // 金币翻倍概率
  | { kind: 'coinBonus'; value: number } // 每次命中基础金币加成
  // ---- 彩票技能（lottoDart 分支）----
  | { kind: 'ticketDropRate'; value: number } // 彩票掉落概率加成
  | { kind: 'ticketLuck'; value: number } // 彩票中奖率加成
  | { kind: 'ticketValue'; value: number } // 彩票奖金倍率
  | { kind: 'ticketRobot'; value: number } // 刮奖机器人（>0=解锁）
  | { kind: 'ticketRobotSpeed'; value: number } // 机器人拾取加速
  | { kind: 'ticketRobotLuck'; value: number } // 机器人中奖率
  | { kind: 'ticketDoubleDrop'; value: number } // 双倍掉落概率
  | { kind: 'ticketJackpot'; value: number } // 超级大奖概率
  // ---- 彩票等级扩展 ----
  | { kind: 'silverUnlock'; value: number } // 解锁银票
  | { kind: 'silverLuck'; value: number } // 银票幸运
  | { kind: 'goldUnlock'; value: number } // 解锁金票
  | { kind: 'goldLuck'; value: number } // 金票幸运
  | { kind: 'robotTier'; value: number } // 机器人等级（0铜1银2金）
  // ---- 恶魔彩票 ----
  | { kind: 'demonDrop'; value: number } // 恶魔票掉落概率
  | { kind: 'demonCount'; value: number } // 恶魔最大数量
  | { kind: 'demonShards'; value: number } // 恶魔爆票数量加成
  | { kind: 'demonUpgrade'; value: number } // 恶魔爆票升级概率
  | { kind: 'robotCount'; value: number } // 机器人同时工作数量
  | { kind: 'robotSpeed'; value: number } // 机器人行走加速
  | { kind: 'angelUnlock'; value: number } // 解锁终极大奖
  | { kind: 'diamondUnlock'; value: number } // 解锁钻石票
  | { kind: 'diamondLuck'; value: number } // 钻石票幸运
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
  | { kind: 'battleCoin'; value: number } // 击杀金币加成（加法比例）
  // ---- 锤剪布技能（仅作用于锤剪布关卡）----
  | { kind: 'rpsDamage'; value: number } // 每胜伤害（加法）
  | { kind: 'rpsMaxHp'; value: number } // 最大血量（加法）
  | { kind: 'rpsComboCap'; value: number } // 连击倍率上限（加法）
  | { kind: 'rpsCrit'; value: number } // 暴击概率（加法，0..1）
  | { kind: 'rpsTell'; value: number } // 读招窗口时长（毫秒，加法）
  | { kind: 'rpsTiebreak'; value: number } // 平局转胜概率（加法，0..1）
  | { kind: 'rpsLifesteal'; value: number } // 每胜回血（加法）
  | { kind: 'rpsCoin'; value: number } // 击杀金币加成（加法比例）
  // ---- 射击关卡技能（仅作用于射击关卡）----
  | { kind: 'shooterDamage'; value: number } // 每发伤害（加法）
  | { kind: 'shooterFireRate'; value: number } // 射击间隔（毫秒，加法，通常为负）
  | { kind: 'shooterMulti'; value: number } // 额外散射弹数（加法整数）
  | { kind: 'shooterMaxHp'; value: number } // 最大血量（加法）
  | { kind: 'shooterSpeed'; value: number } // 跟手速度 lerp 系数（加法）
  | { kind: 'shooterRegen'; value: number } // 每秒回血（加法）
  | { kind: 'shooterCoin'; value: number }; // 击杀金币加成（加法比例）

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
  chainThrow: number; // 连续投掷概率
  critChance: number; // 暴击概率
  goldenDart: number; // 黄金飞镖概率
  fairySpawn: number; // 漂浮精灵数量
  luckyDrop: number; // 命中掉落金币袋概率
  lightningStrike: number;
  stormSurge: number;
  autoAim: number;
  thunderBurst: number;
  dartPierce: number;
  tripleShot: number;
  petCrit: number;
  coinDoubler: number;
  coinBonus: number;
  ticketDropRate: number;
  ticketLuck: number;
  ticketValue: number;
  ticketRobot: number;
  ticketRobotSpeed: number;
  ticketRobotLuck: number;
  ticketDoubleDrop: number;
  ticketJackpot: number;
  silverUnlock: number;
  silverLuck: number;
  goldUnlock: number;
  goldLuck: number;
  robotTier: number;
  demonDrop: number;
  demonCount: number;
  demonShards: number;
  demonUpgrade: number;
  robotCount: number;
  robotSpeed: number;
  angelUnlock: number;
  diamondUnlock: number;
  diamondLuck: number;
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

/** 锤剪布关卡的派生属性（由锤剪布技能树解锁节点累加） */
export interface RpsStats {
  damage: number; // 每胜造成伤害（基础 10）
  maxHp: number; // 玩家最大血量（基础 100）
  comboCap: number; // 连击倍率上限（基础 2.0）
  crit: number; // 暴击概率（0..1）
  critMult: number; // 暴击倍率（固定 2）
  tellWindow: number; // 读招窗口时长（毫秒，基础 1200）
  tiebreaker: number; // 平局转胜概率（0..1）
  lifesteal: number; // 每胜回血（整数）
  coinBonus: number; // 击杀金币加成（加法比例）
}

/** 射击关卡的派生属性（由射击技能树解锁节点累加） */
export interface ShooterStats {
  damage: number; // 每发伤害（基础 1）
  fireInterval: number; // 射击间隔毫秒（基础 220）
  multishot: number; // 额外散射弹数（基础 0）
  maxHp: number; // 最大血量（基础 3）
  moveSpeed: number; // 跟手 lerp 系数（基础 0.25）
  regen: number; // 每秒回血（基础 0）
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
  golden?: boolean; // 黄金飞镖，命中金币×3
  zapped?: boolean; // 已被闪电修正（防重复触发）
}

/** 飞起的分数飘字 */
export interface FloatText {
  pos: Vec2;
  text: string;
  color: string;
  life: number; // 剩余毫秒
  vy: number;
}

/** 漂浮飞行物（精灵、金币袋等） */
export interface FloatingItem {
  pos: Vec2;
  vx: number;
  vy: number;
  life: number; // 剩余毫秒
  kind: 'fairy' | 'coinBag' | 'demon';
  r: number; // 碰撞半径
}

/** 掉落物品（如剧情触发的彩票） */
export interface DropItem {
  pos: Vec2;
  life: number; // 剩余毫秒（触地后倒计时消失）
  vy: number; // 下落速度 px/s（负值=上浮，正值=下落）
  landed: boolean;
  isStoryDrop?: boolean; // 首次剧情掉落
  tier?: number; // 0铜/1银/2金，-1=天使/恶魔
  angel?: boolean; // 天使票
  demon?: boolean; // 恶魔票
}
