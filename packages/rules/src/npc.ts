/**
 * Perfiles para PNJ secundarios: el máster tira 2d6 + el bonificador del perfil en lo que
 * el PNJ sabe hacer, y con 2 menos en lo demás. Los PNJ importantes llevan ficha completa.
 */
export const NPC_PROFILE_IDS = ['minion', 'soldier', 'veteran', 'champion'] as const;
export type NpcProfile = (typeof NPC_PROFILE_IDS)[number];

export interface NpcProfileInfo {
  label: string;
  /** Bonificador en su especialidad (combate, sigilo, magia...). */
  bonus: number;
  /**
   * Su Destreza: la mitad del bonificador. Con ella tira la iniciativa y es la que cuenta para
   * dispararle.
   */
  dexterity: number;
  /** Casillas de daño que aguanta antes de caer. */
  toughness: number;
  /** Daño de su ataque habitual. */
  damage: number;
  description: string;
}

export const NPC_PROFILES: Record<NpcProfile, NpcProfileInfo> = {
  minion: {
    label: 'Esbirro',
    bonus: 2,
    dexterity: 1,
    toughness: 1,
    damage: 1,
    description: 'Matones, bandidos, bestias menores. Caen al primer impacto.',
  },
  soldier: {
    label: 'Soldado',
    bonus: 4,
    dexterity: 2,
    toughness: 3,
    damage: 2,
    description: 'Guardias, mercenarios, lobos.',
  },
  veteran: {
    label: 'Veterano',
    bonus: 6,
    dexterity: 3,
    toughness: 4,
    damage: 2,
    description: 'Capitanes, asesinos, bestias grandes.',
  },
  champion: {
    label: 'Campeón',
    bonus: 8,
    dexterity: 4,
    toughness: 6,
    damage: 3,
    description: 'Un rival para todo el grupo: campeones, monstruos, hechiceros.',
  },
};

export const NPC_OFF_SPECIALTY_PENALTY = 2;

export function npcBonus(profile: NpcProfile, inSpecialty = true): number {
  return NPC_PROFILES[profile].bonus - (inSpecialty ? 0 : NPC_OFF_SPECIALTY_PENALTY);
}

export function npcIsDown(profile: NpcProfile, damageTaken: number): boolean {
  return damageTaken >= NPC_PROFILES[profile].toughness;
}

/**
 * Cómo va un grupo de PNJ del mismo perfil (o uno solo): cuántos han caído y el daño que lleva el
 * que sigue peleando. Si algún golpe ha dicho a cuál del grupo iba (en un mapa), `members` lleva el
 * daño de cada uno, por su número desde 0, y `damage` es el del más herido de los que siguen.
 */
export interface NpcHarm {
  down: number;
  damage: number;
  members?: number[];
}

export const UNHARMED: NpcHarm = { down: 0, damage: 0 };

/** Lo que pasa cuando unos PNJ reciben un golpe. */
export interface NpcDamage {
  harm: NpcHarm;
  /** A cuál del grupo alcanza, por su número desde 0. */
  member: number;
  /** Cae uno con este golpe. */
  fell: boolean;
  /** Ya no queda ninguno en pie. */
  out: boolean;
}

/**
 * El daño que lleva cada uno de un grupo, por su número desde 0; los que han caído, su aguante.
 * Mientras ningún golpe dice a cuál va, caen por orden: primero el 0, luego el 1...
 */
export function memberDamage(profile: NpcProfile, count: number, harm: NpcHarm): number[] {
  if (harm.members) return harm.members;
  const { toughness } = NPC_PROFILES[profile];
  return Array.from({ length: count }, (_, member) =>
    member < harm.down ? toughness : member === harm.down ? harm.damage : 0,
  );
}

/** El que sigue peleando: el más herido de los que quedan en pie (a igualdad, el primero). */
function mostHurt(members: readonly number[], toughness: number): number {
  let found = -1;
  members.forEach((damage, member) => {
    if (damage < toughness && (found < 0 || damage > members[found]!)) found = member;
  });
  return found;
}

/**
 * Un impacto a un grupo de PNJ alcanza a uno solo: cae al llegar a lo que aguanta su perfil, y el
 * daño que sobra no pasa al siguiente. `count` es cuántos son, y `member`, a cuál va, si se sabe
 * (en un mapa); si no, al que sigue peleando, el más herido de los que quedan en pie.
 */
export function damageNpcs(
  profile: NpcProfile,
  count: number,
  harm: NpcHarm,
  amount: number,
  member?: number,
): NpcDamage {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error(`El daño debe ser un entero no negativo, llegó ${amount}`);
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`Un grupo tiene al menos uno, llegó ${count}`);
  }
  if (harm.down >= count) throw new Error('No queda ninguno en pie');
  if (member === undefined && !harm.members) {
    const damage = harm.damage + amount;
    const fell = npcIsDown(profile, damage);
    const next = fell ? { down: harm.down + 1, damage: 0 } : { down: harm.down, damage };
    return { harm: next, member: harm.down, fell, out: next.down >= count };
  }

  const { toughness } = NPC_PROFILES[profile];
  const members = [...memberDamage(profile, count, harm)];
  const hit = member ?? mostHurt(members, toughness);
  const taken = members[hit];
  if (!Number.isInteger(hit) || taken === undefined) {
    throw new Error(`El grupo es de ${count}, llegó el número ${hit}`);
  }
  if (taken >= toughness) throw new Error(`El número ${hit} del grupo ya ha caído`);
  members[hit] = Math.min(toughness, taken + amount);
  const standing = members.filter((damage) => damage < toughness);
  const down = count - standing.length;
  return {
    harm: { down, damage: Math.max(0, ...standing), members },
    member: hit,
    fell: members[hit] >= toughness,
    out: down >= count,
  };
}
