// ===== 打怪模式：装备定义（头盔/护甲/靴子 三槽）=====
// 装备由高级材料（F/M/N/D）在合成台合成，永久解锁；每槽可装备一件，提供打怪被动加成。
// 加成在 battle/game.ts 的 eff* 方法里读 state.equippedGearBonuses() 叠加（全加法；cdAdd 为负=更快）。
// 配方仅用高级字符，与高级材料配方（仅用基础字符）天然隔离；同类内重复由 assertUniqueRecipes() 兜底。

export type GearSlot = 'helm' | 'armor' | 'boots';

/** 装备被动加成（全加法；cdAdd 为负值代表冷却缩短） */
export interface GearBonus {
  dmgAdd: number;
  hpAdd: number;
  critAdd: number;
  lsAdd: number;
  coinAdd: number;
  cdAdd: number;
}

export interface GearDef {
  id: string;
  name: string;
  icon: string;
  slot: GearSlot;
  set: string; // 套装 id（guard/arcane/dragon/astral）
  bonus: GearBonus;
  recipe: string[]; // 3×3 高级材料图样（仅用 F/M/N/D）
}

export const SLOT_DEFS: { id: GearSlot; name: string; icon: string }[] = [
  { id: 'helm', name: '头盔', icon: '⛑️' },
  { id: 'armor', name: '护甲', icon: '🛡️' },
  { id: 'boots', name: '靴子', icon: '👢' },
];

const Z = (b: Partial<GearBonus>): GearBonus => ({
  dmgAdd: 0, hpAdd: 0, critAdd: 0, lsAdd: 0, coinAdd: 0, cdAdd: 0, ...b,
});

export const GEARS: GearDef[] = [
  // ---- 守卫套 guard（偏血量/吸血）----
  { id: 'ironHelm', name: '铁盔', icon: '⛑️', slot: 'helm', set: 'guard', bonus: Z({ dmgAdd: 1, hpAdd: 2 }), recipe: ['FFF', 'F.F', '...'] },
  { id: 'leatherArmor', name: '皮甲', icon: '🦺', slot: 'armor', set: 'guard', bonus: Z({ hpAdd: 3, lsAdd: 0.5 }), recipe: ['DDD', 'D.D', '...'] },
  { id: 'swiftBoots', name: '疾步靴', icon: '👢', slot: 'boots', set: 'guard', bonus: Z({ cdAdd: -30, coinAdd: 0.1 }), recipe: ['F.F', 'F.F', '...'] },
  // ---- 秘法套 arcane（偏暴击/伤害）----
  { id: 'crystalCrown', name: '魔晶冠', icon: '👑', slot: 'helm', set: 'arcane', bonus: Z({ dmgAdd: 1, critAdd: 0.1 }), recipe: ['M.M', '.M.', 'M.M'] },
  { id: 'woodArmor', name: '灵木甲', icon: '🌿', slot: 'armor', set: 'arcane', bonus: Z({ hpAdd: 6, cdAdd: -20 }), recipe: ['NNN', 'N.N', 'NNN'] },
  { id: 'emberBoots', name: '火焰靴', icon: '🔥', slot: 'boots', set: 'arcane', bonus: Z({ cdAdd: -50, dmgAdd: 1 }), recipe: ['NN.', 'NFN', '...'] },
  // ---- 飞龙套 dragon（综合强力）----
  { id: 'dragonSkull', name: '龙骸盔', icon: '💀', slot: 'helm', set: 'dragon', bonus: Z({ dmgAdd: 2, critAdd: 0.15, hpAdd: 5 }), recipe: ['DMD', 'DDD', '.M.'] },
  { id: 'dragonScale', name: '龙鳞甲', icon: '🛡️', slot: 'armor', set: 'dragon', bonus: Z({ hpAdd: 12, lsAdd: 1, dmgAdd: 1 }), recipe: ['DDD', 'MDM', '.D.'] },
  { id: 'dragonBoots', name: '飞龙靴', icon: '🐉', slot: 'boots', set: 'dragon', bonus: Z({ cdAdd: -70, coinAdd: 0.25, critAdd: 0.05 }), recipe: ['D.D', 'MDM', 'D.D'] },
  // ---- 星辰套 astral（终极，消耗大）----
  { id: 'starHelm', name: '星辰冠', icon: '🌟', slot: 'helm', set: 'astral', bonus: Z({ dmgAdd: 3, critAdd: 0.2, hpAdd: 6 }), recipe: ['MMM', 'MDM', 'M.M'] },
  { id: 'starArmor', name: '星辰甲', icon: '✨', slot: 'armor', set: 'astral', bonus: Z({ hpAdd: 18, lsAdd: 1, dmgAdd: 2 }), recipe: ['DDD', 'DFD', 'DDD'] },
  { id: 'starBoots', name: '星辰靴', icon: '☄️', slot: 'boots', set: 'astral', bonus: Z({ cdAdd: -90, coinAdd: 0.3, critAdd: 0.1, dmgAdd: 1 }), recipe: ['NNN', 'NFN', 'NNN'] },
];

export const GEAR_BY_ID: Record<string, GearDef> = Object.fromEntries(
  GEARS.map((g) => [g.id, g]),
);

/** 某槽位的所有装备（按定义顺序） */
export const GEAR_BY_SLOT: Record<GearSlot, GearDef[]> = {
  helm: GEARS.filter((g) => g.slot === 'helm'),
  armor: GEARS.filter((g) => g.slot === 'armor'),
  boots: GEARS.filter((g) => g.slot === 'boots'),
};

export const EMPTY_GEAR_BONUS: GearBonus = { dmgAdd: 0, hpAdd: 0, critAdd: 0, lsAdd: 0, coinAdd: 0, cdAdd: 0 };

// ---- 套装 ----
export const SET_DEFS: { id: string; name: string; icon: string }[] = [
  { id: 'guard', name: '守卫', icon: '🛡️' },
  { id: 'arcane', name: '秘法', icon: '🔮' },
  { id: 'dragon', name: '飞龙', icon: '🐲' },
  { id: 'astral', name: '星辰', icon: '✨' },
];
export const SET_BY_ID: Record<string, { id: string; name: string; icon: string }> = Object.fromEntries(
  SET_DEFS.map((s) => [s.id, s]),
);
/** 套装加成：2 件触发 two、3 件再叠加 three（与单件加成同层，全加法） */
export const SET_BONUSES: Record<string, { two: GearBonus; three: GearBonus }> = {
  guard: { two: Z({ hpAdd: 4 }), three: Z({ hpAdd: 4, lsAdd: 1 }) },
  arcane: { two: Z({ critAdd: 0.1 }), three: Z({ dmgAdd: 1, critAdd: 0.05 }) },
  dragon: { two: Z({ dmgAdd: 2 }), three: Z({ dmgAdd: 2, hpAdd: 6, critAdd: 0.1 }) },
  astral: { two: Z({ dmgAdd: 2, critAdd: 0.1 }), three: Z({ dmgAdd: 3, hpAdd: 10, lsAdd: 1, coinAdd: 0.25, critAdd: 0.1 }) },
};

/** 武器/装备最大强化等级 */
export const MAX_ITEM_LEVEL = 5;
