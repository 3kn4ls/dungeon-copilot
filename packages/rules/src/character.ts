import { z } from 'zod';
import {
  ATTRIBUTE_INFO,
  ATTRIBUTE_MAX,
  ATTRIBUTE_MIN,
  ATTRIBUTES,
  type Attribute,
} from './attributes';
import {
  SKILL_RANK_MAX,
  defaultSkillCatalog,
  skillRank,
  unmetRequirements,
  type SkillCatalog,
} from './skills';

/** Reglas de creación de personaje. */
export const CREATION = {
  /** Puntos a repartir entre los cinco atributos (todos empiezan contando desde 0). */
  attributePoints: 12,
  attributeMaxAtCreation: 4,
  /** Rangos a repartir entre habilidades básicas. */
  skillRanks: 6,
  skillRankMaxAtCreation: 2,
  /** Habilidades avanzadas que se pueden elegir al crear, si se cumplen sus requisitos. */
  advancedSkills: 1,
} as const;

/** Puntos de Suerte al empezar cada sesión. Uno permite repetir una tirada propia. */
export const LUCK_PER_SESSION = 3;

const attributeValue = z.number().int().min(ATTRIBUTE_MIN).max(ATTRIBUTE_MAX);

export const characterBuildSchema = z.object({
  name: z.string().trim().min(1, 'El personaje necesita un nombre'),
  /** Una frase de trasfondo ("Mercenaria de la Compañía Libre"). Da ventaja cuando encaja. */
  background: z.string().trim().max(200).default(''),
  attributes: z.object({
    strength: attributeValue,
    dexterity: attributeValue,
    charisma: attributeValue,
    intelligence: attributeValue,
    endurance: attributeValue,
  }),
  /** Rango en cada habilidad básica aprendida, por id. */
  skills: z.record(z.string(), z.number().int().min(1).max(SKILL_RANK_MAX)).default({}),
  /** Ids de las habilidades avanzadas aprendidas. */
  advancedSkills: z.array(z.string()).default([]),
});

export type CharacterBuild = z.infer<typeof characterBuildSchema>;

export interface ValidationIssue {
  path: string;
  message: string;
}

/** Comprueba que el personaje sea coherente con el catálogo: habilidades existentes y requisitos cumplidos. */
export function validateCharacter(
  build: CharacterBuild,
  catalog: SkillCatalog = defaultSkillCatalog,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const id of Object.keys(build.skills)) {
    const skill = catalog.get(id);
    if (!skill) {
      issues.push({ path: `skills.${id}`, message: `No existe la habilidad "${id}"` });
    } else if (skill.tier !== 'basic') {
      issues.push({
        path: `skills.${id}`,
        message: `${skill.name} es avanzada: va en la lista de habilidades avanzadas, sin rango`,
      });
    }
  }

  const seen = new Set<string>();
  for (const id of build.advancedSkills) {
    const path = `advancedSkills.${id}`;
    if (seen.has(id)) {
      issues.push({ path, message: `Habilidad avanzada repetida: "${id}"` });
      continue;
    }
    seen.add(id);
    const skill = catalog.get(id);
    if (!skill) {
      issues.push({ path, message: `No existe la habilidad "${id}"` });
    } else if (skill.tier !== 'advanced') {
      issues.push({
        path,
        message: `${skill.name} es básica: va en la lista de habilidades con rango`,
      });
    } else {
      for (const message of unmetRequirements(skill, build, catalog)) {
        issues.push({ path, message: `${skill.name}: ${message}` });
      }
    }
  }

  return issues;
}

/** Validación completa de un personaje recién creado: coherencia más el reparto de puntos inicial. */
export function validateNewCharacter(
  build: CharacterBuild,
  catalog: SkillCatalog = defaultSkillCatalog,
): ValidationIssue[] {
  const issues = validateCharacter(build, catalog);

  const attributeTotal = ATTRIBUTES.reduce((sum, a) => sum + build.attributes[a], 0);
  if (attributeTotal !== CREATION.attributePoints) {
    issues.push({
      path: 'attributes',
      message: `Hay que repartir exactamente ${CREATION.attributePoints} puntos entre los atributos (hay ${attributeTotal})`,
    });
  }
  for (const attribute of ATTRIBUTES) {
    const value = build.attributes[attribute];
    if (value > CREATION.attributeMaxAtCreation) {
      issues.push({
        path: `attributes.${attribute}`,
        message: `${ATTRIBUTE_INFO[attribute].label} no puede pasar de ${CREATION.attributeMaxAtCreation} al crear el personaje`,
      });
    }
  }

  const ranks = Object.entries(build.skills);
  const rankTotal = ranks.reduce((sum, [, rank]) => sum + rank, 0);
  if (rankTotal > CREATION.skillRanks) {
    issues.push({
      path: 'skills',
      message: `Solo hay ${CREATION.skillRanks} rangos de habilidad para repartir (hay ${rankTotal})`,
    });
  }
  for (const [id, rank] of ranks) {
    if (rank > CREATION.skillRankMaxAtCreation) {
      const name = catalog.get(id)?.name ?? id;
      issues.push({
        path: `skills.${id}`,
        message: `${name} no puede pasar de rango ${CREATION.skillRankMaxAtCreation} al crear el personaje`,
      });
    }
  }

  if (build.advancedSkills.length > CREATION.advancedSkills) {
    issues.push({
      path: 'advancedSkills',
      message: `Al crear el personaje solo se puede elegir ${CREATION.advancedSkills} habilidad avanzada`,
    });
  }

  return issues;
}

/** Casillas de rasguño: tantas como Aguante, más una con Duro de pelar. */
export function scratchBoxes(build: CharacterBuild): number {
  return build.attributes.endurance + (build.advancedSkills.includes('tough') ? 1 : 0);
}

export interface CheckOptions {
  /** Habilidad básica que se usa. Sin ella se tira solo con el atributo. */
  skill?: string;
  /** Atributo con el que se tira. Por defecto, el de la habilidad. */
  attribute?: Attribute;
  /** Modificadores de la situación (escudo, rasgos de la ambientación...). */
  modifier?: number;
}

export interface CheckBreakdown {
  attribute: Attribute;
  attributeValue: number;
  skillRank: number;
  modifier: number;
  bonus: number;
}

/** Calcula el bonificador de una tirada: atributo + rango de habilidad + modificadores. */
export function checkBonus(
  build: CharacterBuild,
  options: CheckOptions,
  catalog: SkillCatalog = defaultSkillCatalog,
): CheckBreakdown {
  const skill = options.skill ? catalog.get(options.skill) : undefined;
  if (options.skill && !skill) throw new Error(`No existe la habilidad "${options.skill}"`);
  if (skill && skill.tier !== 'basic') {
    throw new Error(
      `${skill.name} es avanzada y no se usa para tirar; se tira con su habilidad básica`,
    );
  }
  const attribute = options.attribute ?? skill?.attribute;
  if (!attribute) throw new Error('Una tirada necesita un atributo o una habilidad');

  const attributeValue = build.attributes[attribute];
  const rank = skill ? skillRank(build, skill.id) : 0;
  const modifier = options.modifier ?? 0;
  return {
    attribute,
    attributeValue,
    skillRank: rank,
    modifier,
    bonus: attributeValue + rank + modifier,
  };
}
