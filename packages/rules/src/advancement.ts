import { ATTRIBUTE_INFO, ATTRIBUTE_MAX, type Attribute } from './attributes';
import type { CharacterBuild } from './character';
import {
  SKILL_RANK_MAX,
  defaultSkillCatalog,
  skillRank,
  unmetRequirements,
  type SkillCatalog,
} from './skills';

/** Experiencia al final de cada sesión: una base más un punto por hito conseguido. */
export const XP_AWARDS = { perSession: 2, perMilestone: 1, maxMilestones: 3 } as const;

export function sessionXp(milestones: number): number {
  const counted = Math.min(Math.max(0, Math.floor(milestones)), XP_AWARDS.maxMilestones);
  return XP_AWARDS.perSession + counted * XP_AWARDS.perMilestone;
}

/** Coste de las mejoras. */
export const XP_COSTS = {
  /** Subir una habilidad básica al rango N cuesta N × 2. */
  skillRankMultiplier: 2,
  /** Aprender una habilidad avanzada. */
  advancedSkill: 5,
  /** Subir un atributo al valor N cuesta N × 3. */
  attributeMultiplier: 3,
} as const;

export type Advance =
  | { kind: 'raiseSkill'; skill: string }
  | { kind: 'learnAdvanced'; skill: string }
  | { kind: 'raiseAttribute'; attribute: Attribute };

export type AdvancePlan =
  { ok: true; cost: number; build: CharacterBuild } | { ok: false; errors: string[] };

/** Comprueba si una mejora es posible y devuelve su coste y el personaje resultante. */
export function planAdvance(
  build: CharacterBuild,
  advance: Advance,
  catalog: SkillCatalog = defaultSkillCatalog,
): AdvancePlan {
  switch (advance.kind) {
    case 'raiseSkill': {
      const skill = catalog.get(advance.skill);
      if (!skill) return { ok: false, errors: [`No existe la habilidad "${advance.skill}"`] };
      if (skill.tier !== 'basic') {
        return { ok: false, errors: [`${skill.name} es avanzada: se aprende, no sube de rango`] };
      }
      const next = skillRank(build, skill.id) + 1;
      if (next > SKILL_RANK_MAX) {
        return { ok: false, errors: [`${skill.name} ya está en el rango máximo`] };
      }
      return {
        ok: true,
        cost: next * XP_COSTS.skillRankMultiplier,
        build: { ...build, skills: { ...build.skills, [skill.id]: next } },
      };
    }
    case 'learnAdvanced': {
      const skill = catalog.get(advance.skill);
      if (!skill) return { ok: false, errors: [`No existe la habilidad "${advance.skill}"`] };
      if (skill.tier !== 'advanced') {
        return { ok: false, errors: [`${skill.name} es básica: sube de rango, no se aprende`] };
      }
      if (build.advancedSkills.includes(skill.id)) {
        return { ok: false, errors: [`Ya conoce ${skill.name}`] };
      }
      const unmet = unmetRequirements(skill, build, catalog);
      if (unmet.length > 0) return { ok: false, errors: unmet };
      return {
        ok: true,
        cost: XP_COSTS.advancedSkill,
        build: { ...build, advancedSkills: [...build.advancedSkills, skill.id] },
      };
    }
    case 'raiseAttribute': {
      const next = build.attributes[advance.attribute] + 1;
      if (next > ATTRIBUTE_MAX) {
        return {
          ok: false,
          errors: [
            `${ATTRIBUTE_INFO[advance.attribute].label} ya está en el máximo (${ATTRIBUTE_MAX})`,
          ],
        };
      }
      return {
        ok: true,
        cost: next * XP_COSTS.attributeMultiplier,
        build: { ...build, attributes: { ...build.attributes, [advance.attribute]: next } },
      };
    }
  }
}
