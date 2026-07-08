import type { DerivedStats, SkillEffect } from './types';
import { ALL_NODES, NODE_BY_ID } from '../dart/skills';

// ===== 游戏存档与派生属性 =====

const SAVE_KEY = 'pixel-dart-save-v2';
const LEGACY_KEY = 'pixel-dart-save-v1'; // v1 老存档迁移用

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
  petReward: 0.1,
  comboCap: 2,
  comboShield: 0,
  windResist: 0.1,
};

interface SaveData {
  v: number;
  coins: number;
  score: number;
  totalEarned: number;
  maxCombo: number;
  unlocked: string[];
  lotto?: LottoSave; // v2 起新增
}

export class GameState {
  coins = 0;
  score = 0;
  totalEarned = 0;
  maxCombo = 0;
  unlocked = new Set<string>(['core']);
  /** 刮刮乐统计（持久化） */
  lotto: LottoSave = { ...DEFAULT_LOTTO };
  private cachedStats: DerivedStats | null = null;

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      let raw = localStorage.getItem(SAVE_KEY);
      if (!raw) raw = localStorage.getItem(LEGACY_KEY); // v1 老存档迁移
      if (!raw) return;
      const data = JSON.parse(raw) as SaveData;
      if (data && (data.v === 1 || data.v === 2)) {
        this.coins = Math.max(0, data.coins | 0);
        this.score = Math.max(0, data.score | 0);
        this.totalEarned = Math.max(0, data.totalEarned | 0);
        this.maxCombo = Math.max(0, data.maxCombo | 0);
        this.unlocked = new Set(['core', ...(data.unlocked || [])]);
        // 仅 v2 携带彩票统计；v1 老存档保持默认零值（金币/技能照常继承）
        if (data.v === 2 && data.lotto) {
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
        // 从老 key 迁移成功后，立即以新 key 写回并清掉老 key，下次直读 v2
        if (data.v === 1) {
          this.save();
          try {
            localStorage.removeItem(LEGACY_KEY);
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* 损坏的存档忽略 */
    }
  }

  save(): void {
    const data: SaveData = {
      v: 2,
      coins: this.coins,
      score: this.score,
      totalEarned: this.totalEarned,
      maxCombo: this.maxCombo,
      unlocked: [...this.unlocked],
      lotto: this.lotto,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* 存储不可用时静默失败 */
    }
  }

  /** 计算当前所有派生属性（带缓存） */
  stats(): DerivedStats {
    if (this.cachedStats) return this.cachedStats;
    const s: DerivedStats = { ...BASE };
    for (const node of ALL_NODES) {
      if (!this.unlocked.has(node.id)) continue;
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
    this.cachedStats = s;
    return s;
  }

  /** 前置满足 & 未拥有 & 金币足够 */
  canBuy(id: string): boolean {
    const node = NODE_BY_ID[id];
    if (!node) return false;
    if (this.unlocked.has(id)) return false;
    if (this.coins < node.cost) return false;
    return node.requires.every((r) => this.unlocked.has(r));
  }

  /** 购买节点，成功返回 true */
  buy(id: string): boolean {
    if (!this.canBuy(id)) return false;
    const node = NODE_BY_ID[id];
    this.coins -= node.cost;
    this.unlocked.add(id);
    this.cachedStats = null;
    this.save();
    return true;
  }

  /** 节点是否已解锁 */
  owned(id: string): boolean {
    return this.unlocked.has(id);
  }

  /** 前置是否全部满足（用于 UI 显示可点状态） */
  prereqMet(id: string): boolean {
    const node = NODE_BY_ID[id];
    if (!node) return false;
    return node.requires.every((r) => this.unlocked.has(r));
  }

  /** 加金币并累计 */
  earn(amount: number): void {
    if (amount <= 0) return;
    this.coins += amount;
    this.totalEarned += amount;
    this.cachedStats = null;
  }

  /** 花费金币（购买彩票等非技能消费），余额不足返回 false；成功存档 */
  spend(amount: number): boolean {
    if (amount <= 0 || this.coins < amount) return false;
    this.coins -= amount;
    this.save();
    return true;
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

  /** 重置存档（debug / 重新开始） */
  reset(): void {
    this.coins = 0;
    this.score = 0;
    this.totalEarned = 0;
    this.maxCombo = 0;
    this.unlocked = new Set(['core']);
    this.lotto = { ...DEFAULT_LOTTO };
    this.cachedStats = null;
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
  }
}
