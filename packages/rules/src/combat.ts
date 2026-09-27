import type { Attribute } from './attributes';
import type { CharacterBuild } from './character';
import { roll2d6, sumDice, type DiceRoll, type Edge, type Random } from './dice';
import { isSuccess, type Outcome } from './resolution';
import { hasPhysicalDisadvantage, type WoundState } from './wounds';

export type WeaponClass = 'light' | 'medium' | 'heavy';

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

export type ArmorClass = 'none' | 'light' | 'heavy';

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
  const critical = outcome === 'critical' ? 1 : 0;
  return Math.max(1, baseDamage + critical + extra - ARMOR_CLASSES[targetArmor].reduction);
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
  const learned = (id: string) => attacker.advancedSkills.includes(id);
  let extra = 0;
  if (
    learned('crushing-blow') &&
    weapon === 'heavy' &&
    (outcome === 'success' || outcome === 'critical')
  ) {
    extra += 1;
  }
  if (learned('sneak-attack') && surprise) extra += 2;
  return damageOnHit({ baseDamage: WEAPON_CLASSES[weapon].damage, outcome, targetArmor, extra });
}

export interface InitiativeRoll {
  dice: DiceRoll;
  total: number;
}

/** Iniciativa: 2d6 + Destreza. El máster tira una vez por cada grupo de enemigos; los empates, para los PJ. */
export function rollInitiative(
  dexterity: number,
  edge: Edge = 'none',
  random: Random = Math.random,
): InitiativeRoll {
  const dice = roll2d6(edge, random);
  return { dice, total: sumDice(dice.kept) + dexterity };
}
