import type { CharacterBuild } from './character';

/** Personaje de ejemplo válido: guerrero de Fuerza con una habilidad avanzada. */
export function kael(overrides: Partial<CharacterBuild> = {}): CharacterBuild {
  return {
    name: 'Kael',
    background: 'Mercenario de la Compañía Libre',
    attributes: { strength: 4, dexterity: 3, charisma: 1, intelligence: 2, endurance: 2 },
    skills: { 'melee-weapons': 2, athletics: 1, intimidation: 1, survival: 1, perception: 1 },
    advancedSkills: ['brutal-charge'],
    ...overrides,
  };
}
