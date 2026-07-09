import type { DerivedStats, LottoStats, BattleStats, RpsStats, ShooterStats, SkillEffect, LevelId } from './types';
import { ALL_NODES, NODE_BY_ID } from '../dart/skills';
import { ALL_LOTTO_NODES, LOTTO_NODE_BY_ID } from '../lottery/skills';
import { ALL_BATTLE_NODES, BATTLE_NODE_BY_ID } from '../battle/skills';
import { ALL_LOTTO_DART_NODES, LOTTO_DART_NODE_BY_ID } from '../story/lottoSkills';
import { ALL_RPS_NODES, RPS_NODE_BY_ID } from '../rps/skills';
import { ALL_SHOOTER_NODES, SHOOTER_NODE_BY_ID } from '../shooter/skills';

// ===== 游戏存档与派生属性 =====

const SAVE_KEY = 'pixel-dart-save-v2';
const LEGACY_KEY = 'pixel-dart-save-v1'; // v1 老存档迁移用

/** 今日日期串 YYYY-MM-DD（按本地时区，用于每日挑战的去重） */
export function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 关卡门槛：累计获得达到该值后解锁彩票（刮刮乐）关卡。
 *  取累计 totalEarned 而非当前余额——避免"花光→重锁"的反复，且代表真实进度。
 *  派生量，不持久化：老存档 totalEarned 已达标则自动解锁。 */
export const LOTTO_UNLOCK_TOTAL = 500;

/** 刮刮乐持久统计（v2 起新增；v1 老存档缺失时取默认零值，不丢金币/技能） */
export interface LottoSave {
  tickets: number; // 已购票数
  wagered: number; // 累计投入
  won: number; // 累计返奖
  biggest: number; // 单次最高中奖
  misses: number; // 未中次数
  /** 按档位独立累计的幸运值：该档连续未中 +1、中奖清零、封顶 maxPity。
   *  按档位隔离，避免在高 maxPity 档囤满后带到低档触发超额中奖率。 */
  pityByTier: Record<string, number>;
  lastTier: string; // 上次购买的档位
}

const DEFAULT_LOTTO: LottoSave = {
  tickets: 0,
  wagered: 0,
  won: 0,
  biggest: 0,
  misses: 0,
  pityByTier: {},
  lastTier: 'bronze',
};

/** 基础属性（未被任何技能加成前）—— 按 640×360 虚拟分辨率标定 */
const BASE: DerivedStats = {
  centerRadius: 12,
  r2: 32,
  r3: 52,
  r4: 74,
  ringMultiplier: 1,
  magnet: 0,
  cooldown: 900,
  dartSpeed: 640,
  doubleShotChance: 0,
  petUnlocked: false,
  petCount: 0,
  petInterval: 2500,
  petAccuracy: 0.2,
  petReward: 0.3,
  comboCap: 2,
  comboShield: 0,
  windResist: 0.1,
  chainThrow: 0,
  critChance: 0,
  goldenDart: 0,
  fairySpawn: 0,
  luckyDrop: 0,
  lightningStrike: 0,
  stormSurge: 0,
  autoAim: 0,
  thunderBurst: 0,
  dartPierce: 0,
  tripleShot: 0,
  petCrit: 0,
  coinDoubler: 0,
  coinBonus: 0,
  ticketDropRate: 0,
  ticketLuck: 0,
  ticketValue: 0,
  ticketRobot: 0,
  ticketRobotSpeed: 0,
  ticketRobotLuck: 0,
  ticketDoubleDrop: 0,
  ticketJackpot: 0,
  silverUnlock: 0,
  silverLuck: 0,
  goldUnlock: 0,
  goldLuck: 0,
  robotTier: 0,
  demonDrop: 0,
  demonCount: 0,
  demonShards: 0,
  demonUpgrade: 0,
  robotCount: 0,
  robotSpeed: 0,
  angelUnlock: 0,
  diamondUnlock: 0,
  diamondLuck: 0,
};

/** 彩票关卡基础属性（未被任何彩票技能加成前） */
const BASE_LOTTO: LottoStats = {
  costDiscount: 0,
  winBonus: 0,
  pityBonus: 0,
  pityCapBonus: 0,
  prizeMult: 0,
  jackpotMult: 0,
  freeTicket: 0,
};

/** 打怪关卡基础属性（未被任何打怪技能加成前） */
const BASE_BATTLE: BattleStats = {
  damage: 1,
  cooldown: 380,
  maxHp: 5,
  crit: 0,
  critMult: 2,
  lifesteal: 0,
  coinBonus: 0,
};

/** 锤剪布关卡基础属性（未被任何锤剪布技能加成前） */
const BASE_RPS: RpsStats = {
  damage: 10,
  maxHp: 100,
  comboCap: 2,
  crit: 0,
  critMult: 2,
  tellWindow: 1200,
  tiebreaker: 0,
  lifesteal: 0,
  coinBonus: 0,
};

/** 射击关卡基础属性（未被任何射击技能加成前） */
const BASE_SHOOTER: ShooterStats = {
  damage: 1,
  fireInterval: 220,
  multishot: 0,
  maxHp: 3,
  moveSpeed: 0.25,
  regen: 0,
  coinBonus: 0,
};

interface SaveData {
  v: number;
  coins: number;
  score: number;
  totalEarned: number;
  maxCombo: number;
  unlocked?: string[]; // v2 老存档：飞镖技能（迁移后并入 unlockedDart）
  unlockedDart?: string[]; // v3 起按关卡分离
  unlockedLotto?: string[]; // v3 起按关卡分离
  unlockedBattle?: string[]; // 打怪关卡技能（缺省 → 仅 bcore）
  unlockedLottoDart?: string[]; // 彩票技能树（v3 第三段剧情后解锁）
  lottoTreeUnlocked?: boolean;
  angelAchievement?: boolean;
  unlockedRps?: string[]; // 锤剪布关卡技能（缺省 → 仅 rcore）
  unlockedShooter?: string[]; // 射击关卡技能（缺省 → 仅 score）
  lotto?: LottoSave; // v2 起新增
  achv?: Partial<AchvStats>; // 成就计数（缺省零值）
  achvDone?: string[]; // 已解锁成就 id
  dailyLast?: string; // 上次完成每日挑战的日期 YYYY-MM-DD
  meta?: Partial<MetaState>; // 跨关 meta 强化等级（缺省零值）
}

/** 跨关 meta 强化等级（金币天赋 / 每日红利 / 全能体魄），持久化 */
export interface MetaState {
  coin: number; // 金币加成档位 0..3
  daily: number; // 每日奖金加成档位 0..2
  hp: number; // 动作关卡额外血量 0..2
}
const DEFAULT_META: MetaState = { coin: 0, daily: 0, hp: 0 };

/** meta 强化定义：档位 → 效果/费用 */
export interface MetaDef {
  id: keyof MetaState;
  name: string;
  icon: string;
  maxTier: number;
  costs: number[]; // 各档升级费用（长度 = maxTier）
  desc: (tier: number) => string; // tier 为「升到该档后」的效果描述
}
export const META_DEFS: MetaDef[] = [
  {
    id: 'coin', name: '金币天赋', icon: '💰', maxTier: 3, costs: [2000, 6000, 15000],
    desc: (t) => `所有金币 +${[5, 10, 20][t] ?? 20}%`,
  },
  {
    id: 'daily', name: '每日红利', icon: '🎁', maxTier: 2, costs: [3000, 9000],
    desc: (t) => `每日挑战奖金 +${[25, 50][t] ?? 50}%`,
  },
  {
    id: 'hp', name: '全能体魄', icon: '❤️', maxTier: 2, costs: [4000, 10000],
    desc: (t) => `所有动作关卡血量 +${t + 1}`,
  },
];

/** 成就计数（跨四关累计，持久化） */
export interface AchvStats {
  kills: number; // 打怪+锤剪布击杀
  maxWave: number; // 打怪最高波次
  fever: number; // FEVER 触发次数
  chests: number; // 宝箱怪击杀
  elites: number; // 精英怪击杀
  bosses: number; // 魔王击杀
  rpsMaxCombo: number; // 锤剪布最高连胜
  jackpots: number; // 彩票头奖次数
}

const DEFAULT_ACHV: AchvStats = {
  kills: 0,
  maxWave: 0,
  fever: 0,
  chests: 0,
  elites: 0,
  bosses: 0,
  rpsMaxCombo: 0,
  jackpots: 0,
};

export class GameState {
  coins = 0;
  score = 0;
  totalEarned = 0;
  maxCombo = 0;
  /** 飞镖关卡已解锁技能（默认拥有 core） */
  unlockedDart = new Set<string>(['core']);
  /** 彩票关卡已解锁技能（默认拥有 lcore） */
  unlockedLotto = new Set<string>(['lcore']);
  /** 打怪关卡已解锁技能（默认拥有 bcore） */
  unlockedBattle = new Set<string>(['bcore']);
  unlockedLottoDart = new Set<string>(['L0']);
  lottoTreeUnlocked = false;
  angelAchievement = false;
  /** 锤剪布关卡已解锁技能（默认拥有 rcore） */
  unlockedRps = new Set<string>(['rcore']);
  /** 射击关卡已解锁技能（默认拥有 score） */
  unlockedShooter = new Set<string>(['score']);
  /** 刮刮乐统计（持久化） */
  lotto: LottoSave = { ...DEFAULT_LOTTO };
  /** 成就计数（跨四关累计） */
  achv: AchvStats = { ...DEFAULT_ACHV };
  /** 已解锁成就 id */
  achvDone = new Set<string>();
  /** 上次完成每日挑战的日期 */
  dailyLast = '';
  /** 跨关 meta 强化等级 */
  meta: MetaState = { ...DEFAULT_META };
  private cachedStats: DerivedStats | null = null;
  private cachedLottoStats: LottoStats | null = null;
  private cachedBattleStats: BattleStats | null = null;
  private cachedRpsStats: RpsStats | null = null;
  private cachedShooterStats: ShooterStats | null = null;

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      let raw = localStorage.getItem(SAVE_KEY);
      if (!raw) raw = localStorage.getItem(LEGACY_KEY); // v1 老存档迁移
      if (!raw) return;
      const data = JSON.parse(raw) as SaveData;
      if (data && (data.v === 1 || data.v === 2 || data.v === 3)) {
        this.coins = Math.max(0, data.coins | 0);
        this.score = Math.max(0, data.score | 0);
        this.totalEarned = Math.max(0, data.totalEarned | 0);
        this.maxCombo = Math.max(0, data.maxCombo | 0);
        // 技能集合按关卡分离（v3）。v1/v2 老存档只有一个 unlocked → 全归入飞镖集合。
        const legacyDart = data.v < 3 ? data.unlocked : data.unlockedDart;
        this.unlockedDart = new Set(['core', ...(legacyDart || [])]);
        this.unlockedLotto = new Set(['lcore', ...(data.v >= 3 ? data.unlockedLotto || [] : [])]);
        this.unlockedBattle = new Set(['bcore', ...(data.unlockedBattle || [])]);
        this.unlockedLottoDart = new Set(['L0', ...(data.unlockedLottoDart || [])]);
        this.lottoTreeUnlocked = !!data.lottoTreeUnlocked;
        this.angelAchievement = !!data.angelAchievement;
        this.unlockedRps = new Set(['rcore', ...(data.unlockedRps || [])]);
        this.unlockedShooter = new Set(['score', ...(data.unlockedShooter || [])]);
        // 仅 v2+ 携带彩票统计；v1 老存档保持默认零值（金币/技能照常继承）
        if (data.v >= 2 && data.lotto) {
          const incoming = data.lotto as Partial<LottoSave>;
          this.lotto = {
            ...DEFAULT_LOTTO,
            ...incoming,
            // 老版本 pityByTier 可能缺失或不是对象，统一规整为按档位映射
            pityByTier:
              incoming.pityByTier && typeof incoming.pityByTier === 'object'
                ? incoming.pityByTier
                : {},
          };
        }
        // 成就计数 + 已解锁列表（缺省零值/空）
        this.achv = { ...DEFAULT_ACHV, ...(data.achv || {}) };
        this.achvDone = new Set(data.achvDone || []);
        this.dailyLast = data.dailyLast || '';
        this.meta = { ...DEFAULT_META, ...(data.meta || {}) };
        // 老版本存档迁移成功后，立即以最新版本写回，清掉老 key，下次直读
        if (data.v < 3) {
          this.save();
          if (data.v === 1) {
            try {
              localStorage.removeItem(LEGACY_KEY);
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch {
      /* 损坏的存档忽略 */
    }
  }

  save(): void {
    const data: SaveData = {
      v: 3,
      coins: this.coins,
      score: this.score,
      totalEarned: this.totalEarned,
      maxCombo: this.maxCombo,
      unlockedDart: [...this.unlockedDart],
      unlockedLotto: [...this.unlockedLotto],
      unlockedBattle: [...this.unlockedBattle],
      unlockedLottoDart: [...this.unlockedLottoDart],
      lottoTreeUnlocked: this.lottoTreeUnlocked,
      angelAchievement: this.angelAchievement,
      unlockedRps: [...this.unlockedRps],
      unlockedShooter: [...this.unlockedShooter],
      lotto: this.lotto,
      achv: this.achv,
      achvDone: [...this.achvDone],
      dailyLast: this.dailyLast,
      meta: this.meta,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* 存储不可用时静默失败 */
    }
  }

  /** 计算飞镖关卡派生属性（带缓存） */
  stats(): DerivedStats {
    if (this.cachedStats) return this.cachedStats;
    const s: DerivedStats = { ...BASE };
    for (const node of ALL_NODES) {
      if (!this.unlockedDart.has(node.id)) continue;
      for (const e of node.effects) applyEffect(s, e);
    }
    // 钳制到合理范围
    s.cooldown = Math.max(180, s.cooldown);
    s.doubleShotChance = Math.min(0.6, Math.max(0, s.doubleShotChance));
    s.magnet = Math.min(0.7, Math.max(0, s.magnet));
    s.petAccuracy = Math.min(0.9, Math.max(0, s.petAccuracy));
    s.petReward = Math.min(1, Math.max(0.1, s.petReward));
    s.petInterval = Math.max(600, s.petInterval);
    s.petCount = Math.max(0, s.petCount);
    s.comboCap = Math.min(8, Math.max(1, s.comboCap));
    s.comboShield = Math.min(0.8, Math.max(0, s.comboShield));
    s.windResist = Math.min(0.8, Math.max(0, s.windResist));
    s.chainThrow = Math.min(0.25, Math.max(0, s.chainThrow));
    s.critChance = Math.min(0.5, Math.max(0, s.critChance));
    s.goldenDart = Math.min(0.2, Math.max(0, s.goldenDart));
    s.fairySpawn = Math.max(0, s.fairySpawn);
    s.luckyDrop = Math.min(0.2, Math.max(0, s.luckyDrop));
    s.lightningStrike = Math.min(0.35, Math.max(0, s.lightningStrike));
    s.stormSurge = Math.min(3, Math.max(0, s.stormSurge));
    s.autoAim = Math.min(0.3, Math.max(0, s.autoAim));
    s.thunderBurst = Math.min(0.15, Math.max(0, s.thunderBurst));
    s.dartPierce = Math.min(3, Math.max(0, s.dartPierce));
    s.tripleShot = Math.min(0.25, Math.max(0, s.tripleShot));
    s.petCrit = Math.min(0.3, Math.max(0, s.petCrit));
    s.coinDoubler = Math.min(0.25, Math.max(0, s.coinDoubler));
    // 叠加彩票技能树效果
    for (const node of ALL_LOTTO_DART_NODES) {
      if (!this.unlockedLottoDart.has(node.id)) continue;
      for (const e of node.effects) applyEffect(s, e);
    }
    s.coinBonus = Math.max(0, s.coinBonus);
    s.ticketDropRate = Math.min(0.05, Math.max(0, s.ticketDropRate));
    s.ticketLuck = Math.min(0.2, Math.max(0, s.ticketLuck));
    s.ticketValue = Math.min(2, Math.max(0, s.ticketValue));
    s.ticketRobot = Math.max(0, s.ticketRobot);
    s.ticketRobotSpeed = Math.min(0.6, Math.max(0, s.ticketRobotSpeed));
    s.ticketRobotLuck = Math.min(0.2, Math.max(0, s.ticketRobotLuck));
    s.ticketDoubleDrop = Math.min(0.25, Math.max(0, s.ticketDoubleDrop));
    s.ticketJackpot = Math.min(0.1, Math.max(0, s.ticketJackpot));
    s.silverUnlock = Math.max(0, s.silverUnlock);
    s.silverLuck = Math.min(0.25, Math.max(0, s.silverLuck));
    s.goldUnlock = Math.max(0, s.goldUnlock);
    s.goldLuck = Math.min(0.2, Math.max(0, s.goldLuck));
    s.robotTier = Math.min(2, Math.max(0, s.robotTier));
    s.demonDrop = Math.min(0.02, Math.max(0, s.demonDrop));
    s.demonCount = Math.min(3, Math.max(0, s.demonCount));
    s.demonShards = Math.min(3, Math.max(0, s.demonShards));
    s.demonUpgrade = Math.min(0.5, Math.max(0, s.demonUpgrade));
    s.robotCount = Math.max(0, s.robotCount);
    s.robotSpeed = Math.min(0.5, Math.max(0, s.robotSpeed));
    s.angelUnlock = Math.max(0, s.angelUnlock);
    s.diamondUnlock = Math.max(0, s.diamondUnlock);
    s.diamondLuck = Math.min(0.15, Math.max(0, s.diamondLuck));
    // 更新钳制
    s.chainThrow = Math.min(0.30, Math.max(0, s.chainThrow));
    s.critChance = Math.min(0.35, Math.max(0, s.critChance));
    s.petReward = Math.min(0.7, Math.max(0.3, s.petReward));
    this.cachedStats = s;
    return s;
  }

  /** 计算彩票关卡派生属性（带缓存） */
  lottoStats(): LottoStats {
    if (this.cachedLottoStats) return this.cachedLottoStats;
    const s: LottoStats = { ...BASE_LOTTO };
    for (const node of ALL_LOTTO_NODES) {
      if (!this.unlockedLotto.has(node.id)) continue;
      for (const e of node.effects) applyLottoEffect(s, e);
    }
    // 钳制：保持彩票为负期望（折扣/中奖率/奖金倍率都有上限）
    s.costDiscount = Math.min(0.5, Math.max(0, s.costDiscount));
    s.winBonus = Math.min(0.15, Math.max(0, s.winBonus));
    s.pityBonus = Math.max(0, s.pityBonus);
    s.pityCapBonus = Math.max(0, s.pityCapBonus);
    s.prizeMult = Math.min(0.5, Math.max(0, s.prizeMult));
    s.jackpotMult = Math.min(1, Math.max(0, s.jackpotMult));
    s.freeTicket = Math.min(0.3, Math.max(0, s.freeTicket));
    this.cachedLottoStats = s;
    return s;
  }

  /** 计算打怪关卡派生属性（带缓存） */
  battleStats(): BattleStats {
    if (this.cachedBattleStats) return this.cachedBattleStats;
    const s: BattleStats = { ...BASE_BATTLE };
    for (const node of ALL_BATTLE_NODES) {
      if (!this.unlockedBattle.has(node.id)) continue;
      for (const e of node.effects) applyBattleEffect(s, e);
    }
    s.damage = Math.max(1, s.damage);
    s.cooldown = Math.max(140, s.cooldown);
    s.maxHp = Math.max(1, s.maxHp);
    s.crit = Math.min(0.75, Math.max(0, s.crit));
    s.lifesteal = Math.max(0, s.lifesteal);
    s.coinBonus = Math.min(1, Math.max(0, s.coinBonus));
    this.cachedBattleStats = s;
    return s;
  }

  /** 计算锤剪布关卡派生属性（带缓存） */
  rpsStats(): RpsStats {
    if (this.cachedRpsStats) return this.cachedRpsStats;
    const s: RpsStats = { ...BASE_RPS };
    for (const node of ALL_RPS_NODES) {
      if (!this.unlockedRps.has(node.id)) continue;
      for (const e of node.effects) applyRpsEffect(s, e);
    }
    s.damage = Math.max(1, s.damage);
    s.maxHp = Math.max(20, s.maxHp);
    s.comboCap = Math.min(8, Math.max(1, s.comboCap));
    s.crit = Math.min(0.75, Math.max(0, s.crit));
    s.tellWindow = Math.min(4000, Math.max(600, s.tellWindow));
    s.tiebreaker = Math.min(0.75, Math.max(0, s.tiebreaker));
    s.lifesteal = Math.max(0, s.lifesteal);
    s.coinBonus = Math.min(1, Math.max(0, s.coinBonus));
    this.cachedRpsStats = s;
    return s;
  }

  /** 计算射击关卡派生属性（带缓存） */
  shooterStats(): ShooterStats {
    if (this.cachedShooterStats) return this.cachedShooterStats;
    const s: ShooterStats = { ...BASE_SHOOTER };
    for (const node of ALL_SHOOTER_NODES) {
      if (!this.unlockedShooter.has(node.id)) continue;
      for (const e of node.effects) applyShooterEffect(s, e);
    }
    s.damage = Math.max(1, s.damage);
    s.fireInterval = Math.max(70, s.fireInterval);
    s.multishot = Math.min(4, Math.max(0, s.multishot));
    s.maxHp = Math.max(1, s.maxHp);
    s.moveSpeed = Math.min(0.6, Math.max(0.1, s.moveSpeed));
    s.regen = Math.max(0, s.regen);
    s.coinBonus = Math.min(1, Math.max(0, s.coinBonus));
    this.cachedShooterStats = s;
    return s;
  }

  /** 关卡 → 该关已解锁技能集合 */
  private ownedSet(level: LevelId): Set<string> {
    if (level === 'lotto') return this.unlockedLotto;
    if (level === 'battle') return this.unlockedBattle;
    if (level === 'rps') return this.unlockedRps;
    if (level === 'shooter') return this.unlockedShooter;
    return this.unlockedDart;
  }
  /** 关卡 → 该关节点表 */
  private nodeById(level: LevelId): Record<string, { requires: string[]; cost: number }> {
    if (level === 'lotto') return LOTTO_NODE_BY_ID;
    if (level === 'battle') return BATTLE_NODE_BY_ID;
    if (level === 'rps') return RPS_NODE_BY_ID;
    if (level === 'shooter') return SHOOTER_NODE_BY_ID;
    return NODE_BY_ID;
  }

  /** 前置满足 & 未拥有 & 金币足够 */
  canBuy(level: LevelId, id: string): boolean {
    const node = this.nodeById(level)[id];
    if (!node) return false;
    const set = this.ownedSet(level);
    if (set.has(id)) return false;
    if (this.coins < node.cost) return false;
    return node.requires.every((r) => set.has(r));
  }

  /** 购买节点，成功返回 true */
  buy(level: LevelId, id: string): boolean {
    if (!this.canBuy(level, id)) return false;
    const node = this.nodeById(level)[id];
    this.coins -= node.cost;
    this.ownedSet(level).add(id);
    if (level === 'lotto') this.cachedLottoStats = null;
    else if (level === 'battle') this.cachedBattleStats = null;
    else if (level === 'rps') this.cachedRpsStats = null;
    else if (level === 'shooter') this.cachedShooterStats = null;
    else this.cachedStats = null;
    this.save();
    return true;
  }

  /** 节点是否已解锁 */
  owned(level: LevelId, id: string): boolean {
    return this.ownedSet(level).has(id);
  }

  /** 前置是否全部满足（用于 UI 显示可点状态） */
  prereqMet(level: LevelId, id: string): boolean {
    const node = this.nodeById(level)[id];
    if (!node) return false;
    return node.requires.every((r) => this.ownedSet(level).has(r));
  }

  /** 加金币并累计 */
  earn(amount: number): void {
    if (amount <= 0) return;
    const m = Math.round(amount * this.coinMult());
    this.coins += m;
    this.totalEarned += m;
    this.cachedStats = null;
  }

  /** 花费金币（购买彩票等非技能消费），余额不足返回 false；成功存档 */
  spend(amount: number): boolean {
    if (amount <= 0 || this.coins < amount) return false;
    this.coins -= amount;
    this.save();
    return true;
  }

  /** 退还金币（如彩票「免费票」技能），不计入 totalEarned，直接存档 */
  refund(amount: number): void {
    if (amount <= 0) return;
    this.coins += amount;
    this.save();
  }

  /** 记录分数 */
  addScore(n: number): void {
    this.score += n;
  }

  /** 记录一次连击数，更新历史最高 */
  recordCombo(n: number): void {
    if (n > this.maxCombo) this.maxCombo = n;
  }

  /** 彩票关卡是否已解锁：累计获得达到 LOTTO_UNLOCK_TOTAL 即解锁。 */
  lottoUnlocked(): boolean {
    return this.totalEarned >= LOTTO_UNLOCK_TOTAL;
  }

  /** 解锁彩票技能树（第三段剧情触发时调用） */
  unlockLottoTree(): void {
    if (this.lottoTreeUnlocked) return;
    this.lottoTreeUnlocked = true;
    this.save();
  }

  /** 购买彩票技能树节点 */
  buyLottoDart(id: string): boolean {
    const node = LOTTO_DART_NODE_BY_ID[id];
    if (!node || this.unlockedLottoDart.has(id)) return false;
    if (this.coins < node.cost) return false;
    if (!node.requires.every((r) => this.unlockedLottoDart.has(r))) return false;
    this.coins -= node.cost;
    this.unlockedLottoDart.add(id);
    this.save();
    return true;
  }

  /** 彩票技能派生属性（用于飞镖游戏消费） */
  lottoDartStats(): Record<string, number> {
    const s: Record<string, number> = { ticketDropRate: 0, ticketLuck: 0, ticketValue: 0, ticketRobot: 0, ticketRobotSpeed: 0, ticketRobotLuck: 0, ticketDoubleDrop: 0, ticketJackpot: 0 };
    for (const node of ALL_LOTTO_DART_NODES) {
      if (!this.unlockedLottoDart.has(node.id)) continue;
      for (const e of node.effects) {
        if (e.kind in s) (s as any)[e.kind] += (e as any).value ?? 0;
      }
    }
    return s;
  }

  /** 记录一次彩票结算：累计统计 + 更新该档幸运值
   *  （中奖清零、未中 +1、封顶 maxPity）。盈亏由 won−wagered 派生，不单独存。 */
  recordLotto(cost: number, prize: number, tierId: string, maxPity: number): void {
    const l = this.lotto;
    l.tickets++;
    l.wagered += cost;
    l.won += prize;
    if (prize > l.biggest) l.biggest = prize;
    if (prize <= 0) l.misses++;
    l.lastTier = tierId;
    const cur = l.pityByTier[tierId] ?? 0;
    l.pityByTier[tierId] = prize > 0 ? 0 : Math.min(cur + 1, maxPity);
    this.save();
  }

  /** 累加成就计数（key 见 AchvStats）。不立即存盘，随各关 stop/settle 落盘。 */
  incAchv<K extends keyof AchvStats>(key: K, n = 1): void {
    this.achv[key] = (this.achv[key] || 0) + n;
  }
  /** 记录型成就计数（取较大值，如最高波次/最高连胜） */
  recordAchvMax<K extends keyof AchvStats>(key: K, value: number): void {
    if (value > (this.achv[key] || 0)) this.achv[key] = value;
  }

  /** 今日每日挑战是否可用（每日一次） */
  dailyAvailable(): boolean {
    return this.dailyLast !== todayStr();
  }

  /** 结算每日挑战：按分数发奖金、标记今日已做、存盘。返回奖金数额（含每日红利）。 */
  claimDaily(score: number): number {
    const bonus = Math.round((50 + score * 4) * this.dailyMult());
    this.earn(bonus); // earn 再叠金币天赋
    this.dailyLast = todayStr();
    this.save();
    return bonus;
  }

  // ---- 跨关 meta 强化 ----
  /** 金币倍率（金币天赋档位） */
  coinMult(): number {
    return 1 + [0, 0.05, 0.1, 0.2][this.meta.coin];
  }
  /** 每日奖金倍率（每日红利档位） */
  dailyMult(): number {
    return 1 + [0, 0.25, 0.5][this.meta.daily];
  }
  /** 动作关卡额外血量（全能体魄档位） */
  metaHP(): number {
    return this.meta.hp;
  }
  /** 购买 meta 强化一档，成功返回 true */
  buyMeta(id: keyof MetaState): boolean {
    const def = META_DEFS.find((d) => d.id === id);
    if (!def) return false;
    const tier = this.meta[id];
    if (tier >= def.maxTier) return false;
    const cost = def.costs[tier];
    if (this.coins < cost) return false;
    this.coins -= cost;
    this.meta[id] = tier + 1;
    this.save();
    return true;
  }

  /** 重置存档（debug / 重新开始） */
  reset(): void {
    this.coins = 0;
    this.score = 0;
    this.totalEarned = 0;
    this.maxCombo = 0;
    this.unlockedDart = new Set(['core']);
    this.unlockedLotto = new Set(['lcore']);
    this.unlockedBattle = new Set(['bcore']);
    this.unlockedRps = new Set(['rcore']);
    this.unlockedShooter = new Set(['score']);
    this.lotto = { ...DEFAULT_LOTTO };
    this.achv = { ...DEFAULT_ACHV };
    this.achvDone = new Set();
    this.dailyLast = '';
    this.meta = { ...DEFAULT_META };
    this.cachedStats = null;
    this.cachedLottoStats = null;
    this.cachedBattleStats = null;
    this.cachedRpsStats = null;
    this.cachedShooterStats = null;
    try {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(LEGACY_KEY); // 连同可能残留的老 key 一起清掉，避免复活
    } catch {
      /* ignore */
    }
  }
}

function applyEffect(s: DerivedStats, e: SkillEffect): void {
  switch (e.kind) {
    case 'centerRadius': s.centerRadius += e.value; break;
    case 'ringMultiplier': s.ringMultiplier += e.value; break;
    case 'magnet': s.magnet += e.value; break;
    case 'cooldown': s.cooldown += e.value; break;
    case 'dartSpeed': s.dartSpeed += e.value; break;
    case 'doubleShot': s.doubleShotChance += e.value; break;
    case 'petUnlock': s.petUnlocked = true; break;
    case 'petCount': s.petCount += e.value; break;
    case 'petInterval': s.petInterval += e.value; break;
    case 'petAccuracy': s.petAccuracy += e.value; break;
    case 'petReward': s.petReward += e.value; break;
    case 'comboCap': s.comboCap += e.value; break;
    case 'comboShield': s.comboShield += e.value; break;
    case 'windResist': s.windResist += e.value; break;
    case 'chainThrow': s.chainThrow += e.value; break;
    case 'critChance': s.critChance += e.value; break;
    case 'goldenDart': s.goldenDart += e.value; break;
    case 'fairySpawn': s.fairySpawn += e.value; break;
    case 'luckyDrop': s.luckyDrop += e.value; break;
    case 'lightningStrike': s.lightningStrike += e.value; break;
    case 'stormSurge': s.stormSurge += e.value; break;
    case 'autoAim': s.autoAim += e.value; break;
    case 'thunderBurst': s.thunderBurst += e.value; break;
    case 'dartPierce': s.dartPierce += e.value; break;
    case 'tripleShot': s.tripleShot += e.value; break;
    case 'petCrit': s.petCrit += e.value; break;
    case 'coinDoubler': s.coinDoubler += e.value; break;
    case 'coinBonus': s.coinBonus += e.value; break;
    case 'ticketDropRate': s.ticketDropRate += e.value; break;
    case 'ticketLuck': s.ticketLuck += e.value; break;
    case 'ticketValue': s.ticketValue += e.value; break;
    case 'ticketRobot': s.ticketRobot += e.value; break;
    case 'ticketRobotSpeed': s.ticketRobotSpeed += e.value; break;
    case 'ticketRobotLuck': s.ticketRobotLuck += e.value; break;
    case 'ticketDoubleDrop': s.ticketDoubleDrop += e.value; break;
    case 'ticketJackpot': s.ticketJackpot += e.value; break;
    case 'silverUnlock': s.silverUnlock += e.value; break;
    case 'silverLuck': s.silverLuck += e.value; break;
    case 'goldUnlock': s.goldUnlock += e.value; break;
    case 'goldLuck': s.goldLuck += e.value; break;
    case 'robotTier': s.robotTier += e.value; break;
    case 'demonDrop': s.demonDrop += e.value; break;
    case 'demonCount': s.demonCount += e.value; break;
    case 'demonShards': s.demonShards += e.value; break;
    case 'demonUpgrade': s.demonUpgrade += e.value; break;
    case 'robotCount': s.robotCount += e.value; break;
    case 'robotSpeed': s.robotSpeed += e.value; break;
    case 'angelUnlock': s.angelUnlock += e.value; break;
    case 'diamondUnlock': s.diamondUnlock += e.value; break;
    case 'diamondLuck': s.diamondLuck += e.value; break;
  }
}

/** 彩票技能效果累加到 LottoStats（飞镖 kinds 不会出现在彩票节点里，忽略） */
function applyLottoEffect(s: LottoStats, e: SkillEffect): void {
  switch (e.kind) {
    case 'lottoCost': s.costDiscount += e.value; break;
    case 'lottoWin': s.winBonus += e.value; break;
    case 'lottoPityBonus': s.pityBonus += e.value; break;
    case 'lottoPityCap': s.pityCapBonus += e.value; break;
    case 'lottoPrizeMult': s.prizeMult += e.value; break;
    case 'lottoJackpotMult': s.jackpotMult += e.value; break;
    case 'lottoFreeTicket': s.freeTicket += e.value; break;
    // 飞镖专属 kinds 不会出现在彩票节点；default 无操作
  }
}

/** 打怪技能效果累加到 BattleStats */
function applyBattleEffect(s: BattleStats, e: SkillEffect): void {
  switch (e.kind) {
    case 'battleDamage': s.damage += e.value; break;
    case 'battleCooldown': s.cooldown += e.value; break;
    case 'battleMaxHp': s.maxHp += e.value; break;
    case 'battleCrit': s.crit += e.value; break;
    case 'battleLifesteal': s.lifesteal += e.value; break;
    case 'battleCoin': s.coinBonus += e.value; break;
    // critMult 固定 2，不受技能影响
  }
}

/** 锤剪布技能效果累加到 RpsStats */
function applyRpsEffect(s: RpsStats, e: SkillEffect): void {
  switch (e.kind) {
    case 'rpsDamage': s.damage += e.value; break;
    case 'rpsMaxHp': s.maxHp += e.value; break;
    case 'rpsComboCap': s.comboCap += e.value; break;
    case 'rpsCrit': s.crit += e.value; break;
    case 'rpsTell': s.tellWindow += e.value; break;
    case 'rpsTiebreak': s.tiebreaker += e.value; break;
    case 'rpsLifesteal': s.lifesteal += e.value; break;
    case 'rpsCoin': s.coinBonus += e.value; break;
    // critMult 固定 2，不受技能影响
  }
}

/** 射击技能效果累加到 ShooterStats */
function applyShooterEffect(s: ShooterStats, e: SkillEffect): void {
  switch (e.kind) {
    case 'shooterDamage': s.damage += e.value; break;
    case 'shooterFireRate': s.fireInterval += e.value; break;
    case 'shooterMulti': s.multishot += e.value; break;
    case 'shooterMaxHp': s.maxHp += e.value; break;
    case 'shooterSpeed': s.moveSpeed += e.value; break;
    case 'shooterRegen': s.regen += e.value; break;
    case 'shooterCoin': s.coinBonus += e.value; break;
  }
}
