/**
 * Perfiles para PNJ secundarios: el máster tira 2d6 + el bonificador del perfil en lo que
 * el PNJ sabe hacer, y con 2 menos en lo demás. Los PNJ importantes llevan ficha completa.
 */
export type NpcProfile = 'minion' | 'soldier' | 'veteran' | 'champion';

export interface NpcProfileInfo {
  label: string;
  /** Bonificador en su especialidad (combate, sigilo, magia...). */
  bonus: number;
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
    toughness: 1,
    damage: 1,
    description: 'Matones, bandidos, bestias menores. Caen al primer impacto.',
  },
  soldier: {
    label: 'Soldado',
    bonus: 4,
    toughness: 3,
    damage: 2,
    description: 'Guardias, mercenarios, lobos.',
  },
  veteran: {
    label: 'Veterano',
    bonus: 6,
    toughness: 4,
    damage: 2,
    description: 'Capitanes, asesinos, bestias grandes.',
  },
  champion: {
    label: 'Campeón',
    bonus: 8,
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
