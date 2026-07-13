// ===== 打怪模式：材料 + 武器定义 =====
// 材料由打怪掉落、持久化；武器在「工坊」页面用材料合成，永久解锁、可切换装备。
// 每把武器有独立攻击方式（近战/远程）+ 被动加成 + 1 个独特主动技（替换旋风斩）。

export type MaterialId =
  | 'iron'
  | 'wood'
  | 'crystal'
  | 'gold'
  | 'bone'
  | 'leather'
  | 'ember';

/** 高级材料：由基础材料在合成台合成，再用于合成武器/装备（不会由打怪掉落） */
export type AdvancedMaterialId = 'fineIron' | 'manaCore' | 'spiritWood' | 'dragonLeather';
/** 合成台可摆放的材料 id（基础 + 高级） */
export type CraftMatId = MaterialId | AdvancedMaterialId;

export interface MaterialDef {
  id: MaterialId;
  name: string;
  icon: string;
}

export const MATERIALS: MaterialDef[] = [
  { id: 'iron', name: '铁矿', icon: '🪨' },
  { id: 'wood', name: '木材', icon: '🪵' },
  { id: 'crystal', name: '魔晶', icon: '💎' },
  { id: 'gold', name: '金块', icon: '🟡' },
  { id: 'bone', name: '骨头', icon: '🦴' },
  { id: 'leather', name: '皮革', icon: '🟫' },
  { id: 'ember', name: '火石', icon: '🔥' },
];

export const MATERIAL_BY_ID: Record<MaterialId, MaterialDef> = Object.fromEntries(
  MATERIALS.map((m) => [m.id, m]),
) as Record<MaterialId, MaterialDef>;

export interface AdvancedMaterialDef {
  id: AdvancedMaterialId;
  name: string;
  icon: string;
  recipe: string[]; // 3×3 基础材料图样（仅用基础字符 I/W/C/G/B/L/E）
}

/** 高级材料：3 基础 → 1 高级。图样仅用基础字符，与武器/装备配方（仅用 F/M/N/D）天然隔离。 */
export const ADVANCED_MATERIALS: AdvancedMaterialDef[] = [
  { id: 'fineIron', name: '精铁', icon: '⚙️', recipe: ['III', '...', '...'] }, // 3 铁矿
  { id: 'manaCore', name: '魔晶核', icon: '🔮', recipe: ['CGC', '...', '...'] }, // 2 魔晶 + 1 金块
  { id: 'spiritWood', name: '灵木', icon: '🌲', recipe: ['WEW', '...', '...'] }, // 2 木材 + 1 火石
  { id: 'dragonLeather', name: '龙革', icon: '🐲', recipe: ['LBL', '...', '...'] }, // 2 皮革 + 1 骨头
];

export const ADVANCED_MATERIAL_BY_ID: Record<AdvancedMaterialId, AdvancedMaterialDef> = Object.fromEntries(
  ADVANCED_MATERIALS.map((m) => [m.id, m]),
) as Record<AdvancedMaterialId, AdvancedMaterialDef>;

/** 全部材料（基础+高级）的 {name,icon} 查表，供 UI 显示 */
export const CRAFT_MAT_BY_ID: Record<CraftMatId, { name: string; icon: string }> = {
  ...Object.fromEntries(MATERIALS.map((m) => [m.id, { name: m.name, icon: m.icon }])),
  ...Object.fromEntries(ADVANCED_MATERIALS.map((m) => [m.id, { name: m.name, icon: m.icon }])),
} as Record<CraftMatId, { name: string; icon: string }>;

export type WeaponAttack = 'melee' | 'ranged' | 'orbit' | 'chain';

/** 武器被动：乘到生效属性上（dmgMult/cdMult 为乘数，critAdd 为加法，projectileSpeed 仅远程用） */
export interface WeaponPassive {
  dmgMult?: number;
  cdMult?: number;
  critAdd?: number;
  knockMult?: number;
  rangeAdd?: number;
  projectileSpeed?: number;
  pierce?: number; // 远程穿透额外目标数（弓）
  lifestealAdd?: number; // 额外吸血（镰刀）
  orbitCount?: number; // 陀螺一次放出数量
  chainCount?: number; // 权杖闪电链目标数
}

export interface WeaponSkill {
  id: string;
  name: string;
  icon: string;
  desc: string;
}

/** 蓄力攻击：长按蓄满后释放，每把武器效果不同（高阶攻击）。id 用于 game 内分派。 */
export interface WeaponCharge {
  id: string;
  name: string;
  icon: string;
  desc: string;
}

export interface WeaponDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  attack: WeaponAttack;
  passive: WeaponPassive;
  skill: WeaponSkill;
  charge: WeaponCharge;
  // 合成图样：3 行 × 3 字符，仅用高级字符 F/M/N/D（精铁/魔晶核/灵木/龙革）。缺省 = 初始拥有（铁剑）
  recipe?: string[];
  default?: boolean;
}

/** 图样字符 → 材料类型。
 *  字母表分区：基础字符 I/W/C/G/B/L/E 仅出现在「高级材料配方」；
 *  高级字符 F/M/N/D 仅出现在「武器/装备配方」。→ 两类配方在任何格上期望值都不同，跨类匹配冲突结构性不可能。 */
export const PATTERN_CHAR: Record<string, CraftMatId> = {
  I: 'iron',
  W: 'wood',
  C: 'crystal',
  G: 'gold',
  B: 'bone',
  L: 'leather',
  E: 'ember',
  F: 'fineIron',
  M: 'manaCore',
  N: 'spiritWood',
  D: 'dragonLeather',
};

/** 把 3×3 图样统计成 {材料: 数量} */
export function patternMaterials(pattern?: string[]): Partial<Record<CraftMatId, number>> {
  const counts: Partial<Record<CraftMatId, number>> = {};
  if (!pattern) return counts;
  for (const row of pattern) {
    for (const ch of row) {
      const m = PATTERN_CHAR[ch];
      if (m) counts[m] = (counts[m] ?? 0) + 1;
    }
  }
  return counts;
}

/** 9 格网格（按行优先，null=空）是否与某图样逐格匹配 */
export function matchesPattern(grid: (CraftMatId | null)[], pattern: string[]): boolean {
  if (grid.length !== 9 || pattern.length !== 3) return false;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const ch = pattern[r][c];
      const expect = PATTERN_CHAR[ch] ?? null;
      if (grid[r * 3 + c] !== expect) return false;
    }
  }
  return true;
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'sword',
    name: '铁剑',
    icon: '⚔️',
    default: true,
    attack: 'melee',
    desc: '平衡近战：点屏挥剑，劈砍前方。',
    passive: {},
    skill: { id: 'whirl', name: '旋风斩', icon: '💢', desc: '对全场怪物大范围伤害 + 击退' },
    charge: { id: 'beam', name: '剑气斩', icon: '🗡️', desc: '蓄力释放前方穿透剑气，斩穿一路怪物' },
  },
  {
    id: 'axe',
    name: '战斧',
    icon: '🪓',
    attack: 'melee',
    desc: '重击近战：伤害更高、攻速更慢、击退更强。',
    passive: { dmgMult: 1.6, cdMult: 1.4, knockMult: 2, rangeAdd: 12 },
    skill: { id: 'slam', name: '裂地斩', icon: '💢', desc: '强力一击：更高伤害 + 巨大击退' },
    charge: { id: 'wave', name: '裂地波', icon: '🌊', desc: '蓄力放出地面冲击波推进，巨力击退' },
    recipe: ['FFF', 'FD.', '..D'],
  },
  {
    id: 'dart',
    name: '飞镖',
    icon: '🎯',
    attack: 'ranged',
    desc: '远程投掷：点屏掷出飞镖，命中首个怪物；高暴击。',
    passive: { dmgMult: 0.9, critAdd: 0.2, projectileSpeed: 560 },
    skill: { id: 'split', name: '分裂镖', icon: '💢', desc: '同时掷出 3 枚飞镖扇形散射' },
    charge: { id: 'volley', name: '暴雨镖', icon: '🌧️', desc: '蓄力扇形散射多枚飞镖，越蓄越多' },
    recipe: ['MNM', 'N..', 'N..'],
  },
  {
    id: 'hammer',
    name: '战锤',
    icon: '🔨',
    attack: 'melee',
    desc: '重锤近战：伤害极高、攻速很慢、击退巨大。',
    passive: { dmgMult: 2.4, cdMult: 1.9, knockMult: 3.2, rangeAdd: 8 },
    skill: { id: 'slam', name: '地裂', icon: '💢', desc: '更强力的范围一击 + 巨大击退' },
    charge: { id: 'meteor', name: '陨石砸', icon: '☄️', desc: '蓄力重砸地面，巨大范围爆震 + 击退' },
    recipe: ['FFF', 'FFM', '.M.'],
  },
  {
    id: 'spear',
    name: '长矛',
    icon: '🔱',
    attack: 'melee',
    desc: '长柄突刺：攻击距离远、出招快、暴击高。',
    passive: { dmgMult: 0.85, cdMult: 0.7, critAdd: 0.2, rangeAdd: 55 },
    skill: { id: 'whirl', name: '横扫', icon: '💢', desc: '对全场怪物大范围伤害 + 击退' },
    charge: { id: 'thrust', name: '贯星突', icon: '🌟', desc: '蓄力突刺，超长穿透枪光贯穿全场' },
    recipe: ['DDN', 'F.N', 'F..'],
  },
  {
    id: 'scythe',
    name: '镰刀',
    icon: '🌑',
    attack: 'melee',
    desc: '收割近战：每次命中吸血、击退较强。',
    passive: { dmgMult: 1.3, knockMult: 1.6, lifestealAdd: 1, rangeAdd: 6 },
    skill: { id: 'whirl', name: '收割', icon: '💢', desc: '对全场怪物大范围伤害 + 击退' },
    charge: { id: 'reap', name: '死亡收割', icon: '💀', desc: '蓄力全屏横扫，命中所有怪物并吸血' },
    recipe: ['DD.', 'DDD', '.NF'],
  },
  {
    id: 'bow',
    name: '长弓',
    icon: '🏹',
    attack: 'ranged',
    desc: '远程穿透：箭矢快、可穿透多个怪物。',
    passive: { dmgMult: 1.1, pierce: 2, projectileSpeed: 720 },
    skill: { id: 'split', name: '三连箭', icon: '💢', desc: '同时射出 3 支穿透箭' },
    charge: { id: 'arrowstorm', name: '穿透箭雨', icon: '✨', desc: '蓄力射出多支高穿透箭，覆盖全场' },
    recipe: ['D.D', 'MNM', 'D.D'],
  },
  {
    id: 'top',
    name: '陀螺',
    icon: '🌀',
    attack: 'orbit',
    desc: '环绕攻击：放出旋转陀螺绕身飞行，撞击怪物。',
    passive: { dmgMult: 1.0, orbitCount: 1 },
    skill: { id: 'frenzy', name: '暴走', icon: '💢', desc: '同时放出 3 个陀螺狂扫全场' },
    charge: { id: 'topstorm', name: '陀螺风暴', icon: '🌪️', desc: '蓄力放出多个大半径陀螺环绕狂扫' },
    recipe: ['M.M', 'FMF', 'M.M'],
  },
  {
    id: 'scepter',
    name: '权杖',
    icon: '⚡',
    attack: 'chain',
    desc: '闪电链：点屏放出闪电，在怪物间跳跃传导。',
    passive: { dmgMult: 1.0, critAdd: 0.1, chainCount: 3 },
    skill: { id: 'storm', name: '雷暴', icon: '💢', desc: '闪电链打击更多目标，威力更强' },
    charge: { id: 'judgment', name: '雷霆审判', icon: '🌩️', desc: '蓄力降下更强更长的闪电链，连击多目标' },
    recipe: ['MDM', 'NM.', 'FD.'],
  },
];

export const WEAPON_BY_ID: Record<string, WeaponDef> = Object.fromEntries(
  WEAPONS.map((w) => [w.id, w]),
);

export const DEFAULT_WEAPON_ID = 'sword';

// ---- 统一合成调度（高级材料 / 武器 / 装备 都用 3×3 图样）----
import { GEARS } from './gear';

export type CraftableKind = 'advanced' | 'weapon' | 'gear';
export interface Craftable {
  kind: CraftableKind;
  id: string;
  name: string;
  icon: string;
  recipe: string[];
}

const ADVANCED_CRAFTABLES: Craftable[] = ADVANCED_MATERIALS.map((m) => ({
  kind: 'advanced', id: m.id, name: m.name, icon: m.icon, recipe: m.recipe,
}));
const WEAPON_CRAFTABLES: Craftable[] = WEAPONS.filter((w) => w.recipe).map((w) => ({
  kind: 'weapon', id: w.id, name: w.name, icon: w.icon, recipe: w.recipe!,
}));
const GEAR_CRAFTABLES: Craftable[] = GEARS.map((g) => ({
  kind: 'gear', id: g.id, name: g.name, icon: g.icon, recipe: g.recipe,
}));
const ALL_CRAFTABLES: Craftable[] = [...ADVANCED_CRAFTABLES, ...WEAPON_CRAFTABLES, ...GEAR_CRAFTABLES];

/** 按 advanced → weapon → gear 顺序返回首个与 9 格匹配的可合成物（跨类因字母表分区不可能同时命中） */
export function findCraftable(grid: (CraftMatId | null)[]): Craftable | null {
  for (const c of ALL_CRAFTABLES) if (matchesPattern(grid, c.recipe)) return c;
  return null;
}

/** 按 id 查可合成物（state.craft 用） */
export function craftableById(id: string): Craftable | undefined {
  return ALL_CRAFTABLES.find((c) => c.id === id);
}

/** 开发护栏：所有配方 flatten 后两两不同（同类内重复时 console.error） */
export function assertUniqueRecipes(): void {
  const seen = new Map<string, string>();
  for (const c of ALL_CRAFTABLES) {
    const key = c.recipe.join('');
    if (seen.has(key)) console.error(`[recipe collision] ${c.id} 与 ${seen.get(key)} 重复: ${key}`);
    seen.set(key, c.id);
  }
}
