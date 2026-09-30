import type { Attribute } from './attributes';
import type { CharacterBuild } from './character';
import { combineEdges, roll2d6, sumDice, type DiceRoll, type Edge, type Random } from './dice';
import type { Situation } from './guides';
import { isSuccess, type Outcome } from './resolution';
import { hasPhysicalDisadvantage, type WoundState } from './wounds';

export const WEAPON_CLASS_IDS = ['light', 'medium', 'heavy'] as const;
export type WeaponClass = (typeof WEAPON_CLASS_IDS)[number];

export const WEAPON_CLASSES: Record<
  WeaponClass,
  { label: string; damage: number; examples: string }
> = {
  light: {
    label: 'Ligera',
    damage: 1,
    examples: 'daga, espada corta, honda, cuchillos arrojadizos',
  },
  medium: { label: 'Media', damage: 2, examples: 'espada, hacha, maza, lanza, arco' },
  heavy: { label: 'Pesada', damage: 3, examples: 'mandoble, hacha a dos manos, ballesta pesada' },
};

/** Sin esta Fuerza, un arma pesada cuerpo a cuerpo se usa con desventaja. */
export const HEAVY_WEAPON_MIN_STRENGTH = 3;

export const ARMOR_CLASS_IDS = ['none', 'light', 'heavy'] as const;
export type ArmorClass = (typeof ARMOR_CLASS_IDS)[number];

export const ARMOR_CLASSES: Record<ArmorClass, { label: string; reduction: number }> = {
  none: { label: 'Sin armadura', reduction: 0 },
  light: { label: 'Ligera', reduction: 1 },
  heavy: { label: 'Pesada', reduction: 2 },
};

/** Un escudo suma +1 a la defensa cuerpo a cuerpo al parar y +1 a la dificultad de impactarte a distancia. */
export const SHIELD_BONUS = 1;

export type Range = 'short' | 'medium' | 'long';
export const RANGE_MODIFIERS: Record<Range, number> = { short: 0, medium: 2, long: 4 };

export type Cover = 'none' | 'partial';
export const COVER_MODIFIERS: Record<Cover, number> = { none: 0, partial: 2 };

const PHYSICAL_ATTRIBUTES: readonly Attribute[] = ['strength', 'dexterity', 'endurance'];
const ARMOR_HAMPERED_SKILLS: readonly string[] = ['stealth', 'acrobatics'];

export interface Condition {
  wounds?: WoundState;
  armor?: ArmorClass;
}

/**
 * Desventajas que impone el estado del personaje: una herida grave en tiradas físicas
 * (salvo Imparable) y la armadura pesada en Sigilo y Acrobacias (salvo Entrenamiento con armaduras).
 */
export function conditionEdges(
  build: CharacterBuild,
  check: { attribute: Attribute; skill?: string },
  condition: Condition,
): Edge[] {
  const edges: Edge[] = [];
  const learned = (id: string) => build.advancedSkills.includes(id);
  if (
    condition.wounds &&
    hasPhysicalDisadvantage(condition.wounds) &&
    PHYSICAL_ATTRIBUTES.includes(check.attribute) &&
    !learned('unstoppable')
  ) {
    edges.push('disadvantage');
  }
  if (
    condition.armor === 'heavy' &&
    check.skill !== undefined &&
    ARMOR_HAMPERED_SKILLS.includes(check.skill) &&
    !learned('armor-training')
  ) {
    edges.push('disadvantage');
  }
  return edges;
}

export interface AttackCheck {
  skill: string;
  modifier: number;
  edges: Edge[];
}

/** Ataque cuerpo a cuerpo: armas ligeras con Destreza + Esgrima; medias y pesadas con Fuerza + Armas cuerpo a cuerpo. */
export function meleeAttack(build: CharacterBuild, weapon: WeaponClass): AttackCheck {
  if (weapon === 'light') return { skill: 'fencing', modifier: 0, edges: [] };
  const tooHeavy = weapon === 'heavy' && build.attributes.strength < HEAVY_WEAPON_MIN_STRENGTH;
  return { skill: 'melee-weapons', modifier: 0, edges: tooHeavy ? ['disadvantage'] : [] };
}

/** Defensa cuerpo a cuerpo: parar con tu arma (el escudo suma) o esquivar con Destreza + Acrobacias. */
export function meleeDefense(
  build: CharacterBuild,
  mode: 'parry' | 'dodge',
  gear: { weapon?: WeaponClass; shield?: boolean },
): AttackCheck {
  if (mode === 'dodge') return { skill: 'acrobatics', modifier: 0, edges: [] };
  const parry = meleeAttack(build, gear.weapon ?? 'medium');
  return { ...parry, modifier: gear.shield ? SHIELD_BONUS : 0 };
}

/**
 * Dificultad de impactar a distancia: 6 + Destreza del objetivo + distancia + cobertura (+ escudo).
 * Con Disparo certero se ignoran la cobertura parcial y la penalización por distancia media.
 */
export function rangedDifficulty(options: {
  targetDexterity: number;
  range: Range;
  cover?: Cover;
  targetShield?: boolean;
  deadeye?: boolean;
}): number {
  const { targetDexterity, range, cover = 'none', targetShield = false, deadeye = false } = options;
  const rangeModifier = deadeye && range === 'medium' ? 0 : RANGE_MODIFIERS[range];
  const coverModifier = deadeye && cover === 'partial' ? 0 : COVER_MODIFIERS[cover];
  return 6 + targetDexterity + rangeModifier + coverModifier + (targetShield ? SHIELD_BONUS : 0);
}

/** Una parte del daño de un golpe, para explicarlo: «Espada larga 2», «Crítico +1». */
export interface DamagePart {
  label: string;
  value: number;
}

/** El daño de un golpe y de dónde sale. */
export interface Damage {
  amount: number;
  /** Lo que hace el arma (o el perfil del PNJ), lo que suma y lo que resta, en orden. */
  parts: DamagePart[];
  /** Por qué el daño no es la suma de las partes: el mínimo de 1 o Esquiva prodigiosa. */
  capped?: DamageCap;
}

export type DamageCap = 'minimum' | 'dodge';

export const DAMAGE_CAP_LABELS: Record<DamageCap, string> = {
  minimum: 'un impacto hace al menos 1',
  dodge: 'Esquiva prodigiosa: se queda en 1',
};

/**
 * El daño de un golpe que impacta: lo que hace el arma o el perfil (`source`), +1 con crítico, lo
 * que sumen o resten las técnicas y los costes (`extras`) y lo que para la armadura de quien lo
 * recibe. Un impacto siempre hace al menos 1 y, si quien lo recibe gasta Esquiva prodigiosa, se
 * queda en 1.
 */
export function hitDamage(options: {
  source: DamagePart;
  critical?: boolean;
  extras?: readonly DamagePart[];
  armor?: ArmorClass;
  dodge?: boolean;
}): Damage {
  const { source, critical = false, extras = [], armor = 'none', dodge = false } = options;
  const parts: DamagePart[] = [source];
  if (critical) parts.push({ label: 'Crítico', value: 1 });
  parts.push(...extras);
  const { label, reduction } = ARMOR_CLASSES[armor];
  if (reduction > 0) parts.push({ label: `Armadura ${label.toLowerCase()}`, value: -reduction });
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (dodge) return { amount: 1, parts, capped: 'dodge' };
  return total < 1 ? { amount: 1, parts, capped: 'minimum' } : { amount: total, parts };
}

/**
 * Daño de un impacto. Solo hay daño con éxito (con coste, pleno o crítico). El crítico suma 1,
 * la armadura resta, y un impacto siempre hace al menos 1.
 */
export function damageOnHit(options: {
  baseDamage: number;
  outcome: Outcome;
  targetArmor?: ArmorClass;
  extra?: number;
}): number {
  const { baseDamage, outcome, targetArmor = 'none', extra = 0 } = options;
  if (!isSuccess(outcome)) return 0;
  return hitDamage({
    source: { label: 'Daño', value: baseDamage },
    critical: outcome === 'critical',
    extras: extra === 0 ? [] : [{ label: 'Extra', value: extra }],
    armor: targetArmor,
  }).amount;
}

/**
 * Lo que suman las técnicas de un personaje a su golpe: Golpe demoledor con un arma pesada en un
 * éxito pleno o crítico, y Ataque furtivo contra un rival que no le ha visto venir.
 */
export function attackExtras(
  attacker: CharacterBuild,
  weapon: WeaponClass,
  outcome: Outcome,
  surprise = false,
): DamagePart[] {
  const learned = (id: string) => attacker.advancedSkills.includes(id);
  const extras: DamagePart[] = [];
  if (
    learned('crushing-blow') &&
    weapon === 'heavy' &&
    (outcome === 'success' || outcome === 'critical')
  ) {
    extras.push({ label: 'Golpe demoledor', value: 1 });
  }
  if (learned('sneak-attack') && surprise) extras.push({ label: 'Ataque furtivo', value: 2 });
  return extras;
}

/** Daño de un ataque de un personaje, aplicando Golpe demoledor y Ataque furtivo. */
export function characterAttackDamage(options: {
  attacker: CharacterBuild;
  weapon: WeaponClass;
  outcome: Outcome;
  targetArmor?: ArmorClass;
  /** El rival no te ha visto venir. */
  surprise?: boolean;
}): number {
  const { attacker, weapon, outcome, targetArmor, surprise = false } = options;
  if (!isSuccess(outcome)) return 0;
  return hitDamage({
    source: { label: WEAPON_CLASSES[weapon].label, value: WEAPON_CLASSES[weapon].damage },
    critical: outcome === 'critical',
    extras: attackExtras(attacker, weapon, outcome, surprise),
    armor: targetArmor,
  }).amount;
}

/** Lo que resta al golpe del rival el coste de un éxito con coste cuerpo a cuerpo. */
export const COST_BLOW: DamagePart = { label: 'Coste: su daño −1', value: -1 };

/** Los golpes que deja una tirada de combate, según el resultado de quien actúa. */
export interface CombatBlows {
  /** Quien actúa impacta a su rival: con éxito con coste, pleno o crítico. */
  hit: boolean;
  /** El impacto es crítico: +1 de daño. */
  critical: boolean;
  /**
   * Cuerpo a cuerpo, el rival golpea a quien actúa: como coste de un éxito con coste (con su daño
   * −1, si el máster elige ese coste) o porque queda expuesto tras una pifia (con su daño).
   */
  counter: 'cost' | 'exposed' | null;
  /** A distancia, uno de los costes de un éxito con coste es hacer 1 de daño menos. */
  lessOnCost: boolean;
}

/** Qué golpes deja una tirada según la situación y el resultado de quien actúa. */
export function combatBlows(situation: Situation, outcome: Outcome): CombatBlows {
  const hit = situation !== 'test' && isSuccess(outcome);
  let counter: CombatBlows['counter'] = null;
  if (situation === 'melee' && outcome === 'partial') counter = 'cost';
  if (situation === 'melee' && outcome === 'fumble') counter = 'exposed';
  return {
    hit,
    critical: hit && outcome === 'critical',
    counter,
    lessOnCost: situation === 'ranged' && outcome === 'partial',
  };
}

export interface InitiativeRoll {
  dice: DiceRoll;
  total: number;
}

/**
 * Iniciativa: 2d6 + Destreza, una vez por combate. Cada PJ tira la suya y el máster, una por
 * cada grupo de enemigos, con la Destreza de su perfil.
 */
export function rollInitiative(
  dexterity: number,
  edge: Edge = 'none',
  random: Random = Math.random,
): InitiativeRoll {
  const dice = roll2d6(edge, random);
  return { dice, total: sumDice(dice.kept) + dexterity };
}

/**
 * Cómo tira un PJ la iniciativa: con ventaja si alguien de su bando es Táctico, y con desventaja
 * por una herida grave (salvo Imparable). Si se juntan las dos, se anulan.
 */
export function initiativeEdge(
  build: CharacterBuild,
  condition: Condition,
  tacticianOnSide: boolean,
): Edge {
  return combineEdges(
    tacticianOnSide ? 'advantage' : 'none',
    ...conditionEdges(build, { attribute: 'dexterity' }, condition),
  );
}

/** Lo que cuenta para ordenar a quien pelea. */
export interface InitiativeEntry {
  total: number;
  /** Es un PJ: gana los empates. */
  character: boolean;
  /** Entre iguales, actúa antes quien tiene más. */
  dexterity: number;
}

/**
 * Para ordenar el combate: de mayor a menor iniciativa. Los empates, para los PJ; entre dos PJ o
 * dos grupos empatados, primero el de más Destreza. Si aún empatan, se quedan como estaban.
 */
export function compareInitiative(a: InitiativeEntry, b: InitiativeEntry): number {
  return (
    b.total - a.total || Number(b.character) - Number(a.character) || b.dexterity - a.dexterity
  );
}
