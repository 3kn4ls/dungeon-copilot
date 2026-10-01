import type { DifficultyLevel, Range } from '@dungeon-copilot/rules';
import { z } from 'zod';
import type { InterventionIntent } from './games';

// Lo que sugiere la IA que decide (Nimble) al máster. Solo sugiere: no escribe nada en la partida,
// y el máster aplica lo que quiera.

/**
 * Las intervenciones para las que la IA sugiere qué tirada pedir. Cuerpo a cuerpo lo decide el
 * reglamento con el equipo de la ficha.
 */
export const CHECKED_INTENTS = [
  'speak',
  'act',
  'ask',
  'spell',
  'ranged',
] as const satisfies InterventionIntent[];

export type CheckedIntent = (typeof CHECKED_INTENTS)[number];

export const isCheckedIntent = (intent: InterventionIntent): intent is CheckedIntent =>
  (CHECKED_INTENTS as readonly InterventionIntent[]).includes(intent);

/** Una habilidad básica que sugiere la IA, con lo probable que la ve. */
export interface SkillOdds {
  id: string;
  probability: number;
}

/**
 * Qué tirada pedir para atender una intervención, según la IA. Cada parte solo está si se ha
 * preguntado: con qué tira no se pregunta en un disparo ni en un hechizo (lo dice el reglamento),
 * ni la dificultad en un disparo (sale del objetivo).
 */
export interface CheckSuggestion {
  /** Las habilidades básicas más probables, de más a menos: 3 como mucho. */
  skills: SkillOdds[];
  /** La dificultad; en un hechizo, la del efecto (menor, moderado, mayor o portentoso). */
  difficulty?: DifficultyLevel;
  /** Probabilidad de que alguien se oponga activamente: entonces es una tirada enfrentada. */
  opposed?: number;
  /** Probabilidad de que su trasfondo encaje con lo que intenta: entonces tira con ventaja. */
  background?: number;
  /** Probabilidad de que haya riesgo y un resultado incierto: si no, quizá no haga falta tirar. */
  needsRoll?: number;
  /** En un disparo, la distancia y la probabilidad de que el objetivo esté a cubierto. */
  shot?: { range: Range; cover: number };
}

/**
 * La escala de los hechizos: la dificultad de cada efecto (docs/reglas.md, Magia). Portentoso es
 * 14 o más: a partir de ahí lo decide el máster.
 */
export const SPELL_EFFECT_LABELS = {
  easy: 'Menor',
  normal: 'Moderado',
  hard: 'Mayor',
  veryHard: 'Portentoso',
} as const satisfies Partial<Record<DifficultyLevel, string>>;

export type SpellEffect = keyof typeof SPELL_EFFECT_LABELS;

/** A partir de qué probabilidad se aplica lo que sugiere la IA (o, en `needsRoll`, se avisa). */
export const SUGGESTION_THRESHOLDS = {
  /** Ventaja por el trasfondo. */
  background: 0.6,
  /** Tirada enfrentada. */
  opposed: 0.5,
  /** Cobertura parcial en un disparo. */
  cover: 0.5,
  /** Por debajo, «Quizá no haga falta tirar». */
  needsRoll: 0.4,
} as const;

/** Qué hacen unos enemigos según como va el combate: siguen, huyen o se rinden. */
export const MORALES = ['fight', 'flee', 'surrender'] as const;
export type Morale = (typeof MORALES)[number];

/** Lo que pueden hacer, dicho para el máster: de un grupo o de uno solo. */
export const MORALE_LABELS: Record<Morale, { group: string; one: string }> = {
  fight: { group: 'Siguen peleando', one: 'Sigue peleando' },
  flee: { group: 'Puede que huyan', one: 'Puede que huya' },
  surrender: { group: 'Puede que se rindan', one: 'Puede que se rinda' },
};

/** Para preguntar a la IA qué hacen unos PNJ del combate. */
export const enemyDecisionSchema = z.object({
  /** Los PNJ: su id en el combate. */
  combatantId: z.uuid('Elige qué PNJ'),
  /** Si se pregunta también a quién atacan; si no, solo su moral. */
  targets: z.boolean().default(true),
});

export type EnemyDecisionRequest = z.input<typeof enemyDecisionSchema>;

/** Un personaje del combate al que pueden atacar unos PNJ, con lo probable que lo ve la IA. */
export interface TargetOdds {
  id: string;
  name: string;
  probability: number;
}

/** Qué hacen unos PNJ, según la IA: a quién atacan y si siguen, huyen o se rinden. */
export interface EnemyDecision {
  /**
   * Los personajes que pelean, de más a menos probable. Vacío si no se ha preguntado o solo hay
   * uno: no hay nada que elegir.
   */
  targets: TargetOdds[];
  morale: { choice: Morale; probabilities: Record<Morale, number> };
}
