import {
  ATTRIBUTE_INFO,
  ATTRIBUTE_MAX,
  ATTRIBUTE_MIN,
  ATTRIBUTES,
  type Attribute,
  type Attributes,
} from './attributes';

/** Rango de una habilidad básica: 0 sin entrenar, 1 entrenado, 2 experto, 3 maestro. */
export const SKILL_RANK_MAX = 3;
export const SKILL_RANK_LABELS = ['Sin entrenar', 'Entrenado', 'Experto', 'Maestro'] as const;

interface SkillBase {
  id: string;
  name: string;
  /** Atributo con el que se tira normalmente. El máster puede pedir otro según la situación. */
  attribute: Attribute;
  description: string;
}

/** Habilidad básica: cualquiera puede aprenderla y su rango se suma a la tirada. */
export interface BasicSkill extends SkillBase {
  tier: 'basic';
}

export interface SkillRequirements {
  /** Valor mínimo de atributo. */
  attributes?: Partial<Attributes>;
  /** Rango mínimo en habilidades básicas, por id. */
  skills?: Readonly<Record<string, number>>;
}

/**
 * Habilidad avanzada: una técnica con requisitos. No tiene rango ni suma a la tirada;
 * cambia lo que puedes hacer o lo que significa un resultado.
 */
export interface AdvancedSkill extends SkillBase {
  tier: 'advanced';
  requires: SkillRequirements;
}

export type Skill = BasicSkill | AdvancedSkill;

/** Lo que hace falta saber de un personaje para comprobar requisitos. */
export interface SkillHolder {
  attributes: Attributes;
  /** Rangos en habilidades básicas, por id. Las que no aparecen tienen rango 0. */
  skills: Readonly<Record<string, number>>;
}

export interface SkillCatalog {
  readonly skills: readonly Skill[];
  get(id: string): Skill | undefined;
  byAttribute(attribute: Attribute): { basic: BasicSkill[]; advanced: AdvancedSkill[] };
}

/**
 * Crea un catálogo comprobando que sea coherente. Cada ambientación puede traer el suyo
 * (renombrar, quitar o añadir habilidades); si no, se usa DEFAULT_SKILLS.
 */
export function createSkillCatalog(skills: readonly Skill[]): SkillCatalog {
  const byId = new Map<string, Skill>();
  const problems: string[] = [];

  for (const skill of skills) {
    if (byId.has(skill.id)) problems.push(`Id de habilidad repetido: "${skill.id}"`);
    byId.set(skill.id, skill);
  }

  for (const skill of skills) {
    if (skill.tier !== 'advanced') continue;
    for (const [attribute, min] of Object.entries(skill.requires.attributes ?? {})) {
      if (!ATTRIBUTES.includes(attribute as Attribute)) {
        problems.push(`"${skill.id}" pide un atributo que no existe: "${attribute}"`);
      } else if (min < ATTRIBUTE_MIN || min > ATTRIBUTE_MAX) {
        problems.push(`"${skill.id}" pide ${attribute} ${min}, fuera de la escala`);
      }
    }
    for (const [requiredId, minRank] of Object.entries(skill.requires.skills ?? {})) {
      const required = byId.get(requiredId);
      if (!required) {
        problems.push(`"${skill.id}" pide una habilidad que no existe: "${requiredId}"`);
      } else if (required.tier !== 'basic') {
        problems.push(
          `"${skill.id}" solo puede pedir habilidades básicas, y "${requiredId}" no lo es`,
        );
      }
      if (minRank < 1 || minRank > SKILL_RANK_MAX) {
        problems.push(`"${skill.id}" pide "${requiredId}" a rango ${minRank}, fuera de la escala`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`Catálogo de habilidades no válido:\n- ${problems.join('\n- ')}`);
  }

  return {
    skills,
    get: (id) => byId.get(id),
    byAttribute: (attribute) => ({
      basic: skills.filter((s): s is BasicSkill => s.tier === 'basic' && s.attribute === attribute),
      advanced: skills.filter(
        (s): s is AdvancedSkill => s.tier === 'advanced' && s.attribute === attribute,
      ),
    }),
  };
}

export function skillRank(holder: SkillHolder, skillId: string): number {
  return holder.skills[skillId] ?? 0;
}

/** Devuelve los requisitos que el personaje no cumple, en texto para mostrar. Vacío si puede aprenderla. */
export function unmetRequirements(
  skill: AdvancedSkill,
  holder: SkillHolder,
  catalog: SkillCatalog,
): string[] {
  const unmet: string[] = [];
  for (const [attribute, min] of Object.entries(skill.requires.attributes ?? {}) as [
    Attribute,
    number,
  ][]) {
    const value = holder.attributes[attribute];
    if (value < min) {
      unmet.push(`Requiere ${ATTRIBUTE_INFO[attribute].label} ${min} (tiene ${value})`);
    }
  }
  for (const [requiredId, minRank] of Object.entries(skill.requires.skills ?? {})) {
    const rank = skillRank(holder, requiredId);
    if (rank < minRank) {
      const name = catalog.get(requiredId)?.name ?? requiredId;
      unmet.push(`Requiere ${name} rango ${minRank} (tiene ${rank})`);
    }
  }
  return unmet;
}

/** Habilidades de serie, pensadas para servir en cualquier ambientación de fantasía. */
export const DEFAULT_SKILLS: readonly Skill[] = [
  // Fuerza
  {
    id: 'athletics',
    tier: 'basic',
    attribute: 'strength',
    name: 'Atletismo',
    description: 'Trepar, saltar, nadar, correr y levantar peso.',
  },
  {
    id: 'melee-weapons',
    tier: 'basic',
    attribute: 'strength',
    name: 'Armas cuerpo a cuerpo',
    description: 'Luchar con armas medias y pesadas: espadas, hachas, mazas, lanzas.',
  },
  {
    id: 'brawl',
    tier: 'basic',
    attribute: 'strength',
    name: 'Pelea',
    description: 'Luchar sin armas: puñetazos, presas, empujones.',
  },
  {
    id: 'crushing-blow',
    tier: 'advanced',
    attribute: 'strength',
    name: 'Golpe demoledor',
    description: 'Con un arma pesada, un éxito pleno o crítico hace +1 de daño y derriba al rival.',
    requires: { attributes: { strength: 4 }, skills: { 'melee-weapons': 2 } },
  },
  {
    id: 'iron-grip',
    tier: 'advanced',
    attribute: 'strength',
    name: 'Presa de hierro',
    description:
      'Quien está en tu presa tiene desventaja para soltarse y no puede usar armas medias ni pesadas.',
    requires: { attributes: { strength: 3 }, skills: { brawl: 2 } },
  },
  {
    id: 'brutal-charge',
    tier: 'advanced',
    attribute: 'strength',
    name: 'Carga brutal',
    description:
      'Si corres hacia el rival antes de atacar, tienes ventaja en ese ataque; hasta tu siguiente turno te defiendes con desventaja.',
    requires: { attributes: { strength: 3 } },
  },

  // Destreza
  {
    id: 'fencing',
    tier: 'basic',
    attribute: 'dexterity',
    name: 'Esgrima',
    description: 'Luchar con armas ligeras: dagas, estoques, espadas cortas.',
  },
  {
    id: 'marksmanship',
    tier: 'basic',
    attribute: 'dexterity',
    name: 'Puntería',
    description: 'Arcos, ballestas, hondas y armas arrojadizas.',
  },
  {
    id: 'acrobatics',
    tier: 'basic',
    attribute: 'dexterity',
    name: 'Acrobacias',
    description: 'Esquivar, mantener el equilibrio, caer sin hacerse daño.',
  },
  {
    id: 'stealth',
    tier: 'basic',
    attribute: 'dexterity',
    name: 'Sigilo',
    description: 'Moverse sin ser visto ni oído, esconderse.',
  },
  {
    id: 'sleight-of-hand',
    tier: 'basic',
    attribute: 'dexterity',
    name: 'Juego de manos',
    description: 'Abrir cerraduras, desactivar trampas, robar sin que se note.',
  },
  {
    id: 'deadeye',
    tier: 'advanced',
    attribute: 'dexterity',
    name: 'Disparo certero',
    description: 'Ignoras la cobertura parcial y la penalización por distancia media.',
    requires: { attributes: { dexterity: 4 }, skills: { marksmanship: 2 } },
  },
  {
    id: 'sneak-attack',
    tier: 'advanced',
    attribute: 'dexterity',
    name: 'Ataque furtivo',
    description: 'Contra un rival que no te ha visto venir, haces +2 de daño.',
    requires: { attributes: { dexterity: 3 }, skills: { stealth: 2 } },
  },
  {
    id: 'uncanny-dodge',
    tier: 'advanced',
    attribute: 'dexterity',
    name: 'Esquiva prodigiosa',
    description: 'Una vez por escena, cuando te impactan, reduces el daño a 1.',
    requires: { attributes: { dexterity: 4 }, skills: { acrobatics: 2 } },
  },

  // Carisma
  {
    id: 'persuasion',
    tier: 'basic',
    attribute: 'charisma',
    name: 'Persuasión',
    description: 'Convencer, negociar, seducir.',
  },
  {
    id: 'deception',
    tier: 'basic',
    attribute: 'charisma',
    name: 'Engaño',
    description: 'Mentir, disfrazarse, fingir.',
  },
  {
    id: 'intimidation',
    tier: 'basic',
    attribute: 'charisma',
    name: 'Intimidación',
    description: 'Imponerse por miedo, amenazar, interrogar.',
  },
  {
    id: 'performance',
    tier: 'basic',
    attribute: 'charisma',
    name: 'Interpretación',
    description: 'Música, oratoria, actuación, contar historias.',
  },
  {
    id: 'commanding-voice',
    tier: 'advanced',
    attribute: 'charisma',
    name: 'Voz de mando',
    description:
      'Una vez por escena, das una orden y un aliado que te oiga tiene ventaja en su siguiente tirada.',
    requires: { attributes: { charisma: 4 }, skills: { persuasion: 2 } },
  },
  {
    id: 'dreadful-presence',
    tier: 'advanced',
    attribute: 'charisma',
    name: 'Presencia aterradora',
    description: 'Con un éxito pleno al intimidar, los esbirros huyen o se rinden.',
    requires: { attributes: { charisma: 3 }, skills: { intimidation: 2 } },
  },
  {
    id: 'silver-tongue',
    tier: 'advanced',
    attribute: 'charisma',
    name: 'Lengua de plata',
    description:
      'Una vez por sesión, repites una tirada fallida de Persuasión o Engaño sin gastar Suerte.',
    requires: { attributes: { charisma: 4 }, skills: { deception: 2 } },
  },

  // Inteligencia
  {
    id: 'perception',
    tier: 'basic',
    attribute: 'intelligence',
    name: 'Percepción',
    description: 'Notar detalles, oír, encontrar lo oculto, leer intenciones.',
  },
  {
    id: 'lore',
    tier: 'basic',
    attribute: 'intelligence',
    name: 'Saber',
    description: 'Historia, geografía, religiones, criaturas y leyendas.',
  },
  {
    id: 'medicine',
    tier: 'basic',
    attribute: 'intelligence',
    name: 'Medicina',
    description: 'Curar heridas, tratar venenos y enfermedades.',
  },
  {
    id: 'arcana',
    tier: 'basic',
    attribute: 'intelligence',
    name: 'Arcano',
    description: 'Conocer la magia, sus símbolos y sus peligros. Base de la hechicería.',
  },
  {
    id: 'tactician',
    tier: 'advanced',
    attribute: 'intelligence',
    name: 'Táctico',
    description: 'Tu bando tira la iniciativa con ventaja.',
    requires: { attributes: { intelligence: 4 }, skills: { perception: 2 } },
  },
  {
    id: 'scholar',
    tier: 'advanced',
    attribute: 'intelligence',
    name: 'Erudito',
    description:
      'Una vez por sesión, haces una pregunta al máster sobre el mundo y te responde con la verdad, aunque sea parcial.',
    requires: { attributes: { intelligence: 3 }, skills: { lore: 2 } },
  },
  {
    id: 'sorcery',
    tier: 'advanced',
    attribute: 'intelligence',
    name: 'Hechicería',
    description:
      'Puedes lanzar hechizos con Inteligencia + Arcano. Con un éxito con coste pagas el precio que marque la ambientación: fatiga, corrupción, un favor.',
    requires: { attributes: { intelligence: 4 }, skills: { arcana: 2 } },
  },

  // Aguante
  {
    id: 'resilience',
    tier: 'basic',
    attribute: 'endurance',
    name: 'Resistencia',
    description: 'Aguantar fatiga, frío, hambre, venenos y enfermedades.',
  },
  {
    id: 'willpower',
    tier: 'basic',
    attribute: 'endurance',
    name: 'Voluntad',
    description: 'Resistir el miedo, el dolor, la tortura y la magia que doblega la mente.',
  },
  {
    id: 'survival',
    tier: 'basic',
    attribute: 'endurance',
    name: 'Supervivencia',
    description: 'Orientarse, rastrear, cazar, acampar y soportar la intemperie.',
  },
  {
    id: 'tough',
    tier: 'advanced',
    attribute: 'endurance',
    name: 'Duro de pelar',
    description: 'Tienes una casilla de rasguño más.',
    requires: { attributes: { endurance: 3 }, skills: { resilience: 2 } },
  },
  {
    id: 'armor-training',
    tier: 'advanced',
    attribute: 'endurance',
    name: 'Entrenamiento con armaduras',
    description: 'La armadura pesada no te da desventaja en Sigilo ni en Acrobacias.',
    requires: { attributes: { endurance: 3 } },
  },
  {
    id: 'unstoppable',
    tier: 'advanced',
    attribute: 'endurance',
    name: 'Imparable',
    description:
      'Ignoras la desventaja de una herida grave. Una vez por sesión, al quedar fuera de combate, aguantas en pie hasta el final de tu siguiente turno.',
    requires: { attributes: { endurance: 4 }, skills: { willpower: 2 } },
  },
];

export const defaultSkillCatalog = createSkillCatalog(DEFAULT_SKILLS);
