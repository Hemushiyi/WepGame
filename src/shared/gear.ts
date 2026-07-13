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
  // ---- 头盔（偏伤害/暴击）----
  { id: 'ironHelm', name: '铁盔', icon: '⛑️', slot: 'helm', bonus: Z({ dmgAdd: 1, hpAdd: 2 }), recipe: ['FFF', 'F.F', '...'] },
  { id: 'crystalCrown', name: '魔晶冠', icon: '👑', slot: 'helm', bonus: Z({ dmgAdd: 1, critAdd: 0.1 }), recipe: ['M.M', '.M.', 'M.M'] },
  { id: 'dragonSkull', name: '龙骸盔', icon: '💀', slot: 'helm', bonus: Z({ dmgAdd: 2, critAdd: 0.15, hpAdd: 5 }), recipe: ['DMD', 'DDD', '.M.'] },
  // ---- 护甲（偏血量/吸血）----
  { id: 'leatherArmor', name: '皮甲', icon: '🦺', slot: 'armor', bonus: Z({ hpAdd: 3, lsAdd: 0.5 }), recipe: ['DDD', 'D.D', '...'] },
  { id: 'woodArmor', name: '灵木甲', icon: '🌿', slot: 'armor', bonus: Z({ hpAdd: 6, cdAdd: -20 }), recipe: ['NNN', 'N.N', 'NNN'] },
  { id: 'dragonScale', name: '龙鳞甲', icon: '🛡️', slot: 'armor', bonus: Z({ hpAdd: 12, lsAdd: 1, dmgAdd: 1 }), recipe: ['DDD', 'MDM', '.D.'] },
  // ---- 靴子（偏攻速/金币）----
  { id: 'swiftBoots', name: '疾步靴', icon: '👢', slot: 'boots', bonus: Z({ cdAdd: -30, coinAdd: 0.1 }), recipe: ['F.F', 'F.F', '...'] },
  { id: 'emberBoots', name: '火焰靴', icon: '🔥', slot: 'boots', bonus: Z({ cdAdd: -50, dmgAdd: 1 }), recipe: ['NN.', 'NFN', '...'] },
  { id: 'dragonBoots', name: '飞龙靴', icon: '🐉', slot: 'boots', bonus: Z({ cdAdd: -70, coinAdd: 0.25, critAdd: 0.05 }), recipe: ['D.D', 'MDM', 'D.D'] },
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
