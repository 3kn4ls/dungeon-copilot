import {
  ATTRIBUTE_INFO,
  defaultSkillCatalog,
  type AdvancedSkill,
  type Attribute,
} from '@dungeon-copilot/rules';

/** "Fuerza 4 · Armas cuerpo a cuerpo 2", o "Sin requisitos". */
export function requirementText(skill: AdvancedSkill): string {
  const parts = [
    ...Object.entries(skill.requires.attributes ?? {}).map(
      ([attribute, min]) => `${ATTRIBUTE_INFO[attribute as Attribute].label} ${min}`,
    ),
    ...Object.entries(skill.requires.skills ?? {}).map(
      ([id, rank]) => `${defaultSkillCatalog.get(id)?.name ?? id} ${rank}`,
    ),
  ];
  return parts.length > 0 ? `Requiere ${parts.join(' · ')}` : 'Sin requisitos';
}

export const signed = (value: number) => (value >= 0 ? `+${value}` : `${value}`);

export const sum = (values: Record<string, number>) =>
  Object.values(values).reduce((total, value) => total + value, 0);
