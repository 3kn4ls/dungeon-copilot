import {
  DEFAULT_SKILLS,
  DIFFICULTY_LABELS,
  type DifficultyLevel,
  type Range,
} from '@dungeon-copilot/rules';
import {
  INTERVENTION_LABELS,
  LEAK_NPCS,
  MORALES,
  SPELL_EFFECT_LABELS,
  SUGGESTION_THRESHOLDS,
  type CheckSuggestion,
  type CheckedIntent,
  type EnemyDecision,
  type Morale,
  type SecretLeak,
  type SkillOdds,
  type SpellEffect,
  type TargetOdds,
} from '@dungeon-copilot/shared';
import type {
  ChoiceQuestion,
  DecisionAnswers,
  DecisionQuestions,
  NoulQuestion,
  ScoreQuestion,
} from './decide';
import {
  fighterLine,
  fighterText,
  fit,
  knownLines,
  type PromptCharacter,
  type PromptFighter,
  type PromptNpcKnown,
  type PromptScene,
} from './prompts';

// Las preguntas para la IA que decide (Nimble) y cómo se leen sus respuestas. Como los prompts,
// en español y con topes de longitud: el texto (`state`) y las preguntas tienen que caber en su
// contexto, y cada pregunta cuesta tiempo, así que solo se hacen las que sirven.

/** Lo que el modelo lee para decidir y lo que se le pregunta. */
export interface DecisionPrompt<Q extends DecisionQuestions> {
  state: string;
  questions: Q;
}

const INTENT_CHARS = 600;
const SCENE_CHARS = 600;
/** Cuántas habilidades sugeridas se enseñan, como mucho, y lo poco probables que pueden ser. */
const SUGGESTED_SKILLS = 3;
const SKILL_MIN_PROBABILITY = 0.05;

/** Las habilidades básicas: de entre ellas se elige con qué tira. */
const BASIC_SKILLS = DEFAULT_SKILLS.filter((skill) => skill.tier === 'basic');

/** Las dificultades del reglamento, de menos a más, con lo que significan para el modelo. */
const DIFFICULTY_SCALE: [DifficultyLevel, string][] = [
  ['easy', 'casi cualquiera lo consigue con un poco de cuidado'],
  ['normal', 'pide algo de pericia o esfuerzo'],
  ['hard', 'para alguien entrenado, y aun así puede fallar'],
  ['veryHard', 'solo un experto lo consigue con cierta seguridad'],
  ['heroic', 'casi imposible: una hazaña'],
];

/** La escala de los hechizos: la dificultad del efecto, con lo que significa para el modelo. */
const SPELL_SCALE: [SpellEffect, string][] = [
  ['easy', 'un truco: una luz, un empujón, un susurro a distancia'],
  ['normal', 'un efecto claro: dormir a alguien, abrir una cerradura, una llama'],
  ['hard', 'un efecto poderoso: una bola de fuego, volar, dominar una voluntad'],
  ['veryHard', 'un prodigio: detener una tormenta, abrir un portal'],
];

const RANGE_SCALE: [Range, string][] = [
  ['short', 'Corta: a unos pasos, en la misma habitación'],
  ['medium', 'Media: al otro lado de una plaza o un patio'],
  ['long', 'Larga: lejos, en el límite de lo que alcanza el arma'],
];

/** El nivel de una escala más cercano al que espera el modelo. */
function nearest<T>(scale: readonly T[], score: number): T {
  const index = Math.min(Math.max(Math.round(score), 0), scale.length - 1);
  const level = scale[index];
  if (level === undefined) throw new Error('La escala está vacía');
  return level;
}

/** Las habilidades más probables, de más a menos: la primera y las que tienen alguna opción. */
function topSkills(probabilities: Record<string, number>): SkillOdds[] {
  return Object.entries(probabilities)
    .filter(([id]) => BASIC_SKILLS.some((skill) => skill.id === id))
    .map(([id, probability]) => ({ id, probability }))
    .sort((a, b) => b.probability - a.probability)
    .filter((skill, index) => index === 0 || skill.probability >= SKILL_MIN_PROBABILITY)
    .slice(0, SUGGESTED_SKILLS);
}

/**
 * Lo que intenta un personaje al intervenir. De su ficha solo va el trasfondo: con sus rangos, el
 * modelo elige lo que mejor se le da y no lo que pide lo que hace («le convenzo de que somos de la
 * guardia» pasa de Engaño a Persuasión si la tiene alta).
 */
export interface CheckPrompt {
  character: PromptCharacter;
  /** El título de la escena en juego, si el máster ha empezado alguna. */
  scene?: string | undefined;
  /** Lo último que el máster ha enseñado a la mesa. */
  shown?: PromptScene | undefined;
  intent: CheckedIntent;
  /** Lo que ha escrito su jugador al intervenir. */
  text: string;
  /** En combate, contra quién va. */
  target?: string | undefined;
}

/** Las preguntas de una tirada: solo las que tocan según lo que intenta. */
export type CheckQuestions = {
  skill?: ChoiceQuestion;
  difficulty?: ScoreQuestion;
  opposed?: NoulQuestion;
  background?: NoulQuestion;
  needsRoll?: NoulQuestion;
  range?: ScoreQuestion;
  cover?: NoulQuestion;
};

/** Lo que el modelo sabe de quien interviene y de lo que intenta. */
function checkState(prompt: CheckPrompt): string {
  const { character, shown } = prompt;
  const scene = shown
    ? [shown.title.trim(), fit(shown.body, SCENE_CHARS)].filter(Boolean).join('\n')
    : '';
  const said = `Su jugador pulsa «${INTERVENTION_LABELS[prompt.intent]}» y escribe: «${fit(prompt.text, INTENT_CHARS)}»`;
  return [
    `Personaje: ${character.name}.`,
    character.background.trim() ? `Trasfondo: ${character.background.trim()}.` : '',
    prompt.scene?.trim() ? `Escena: ${prompt.scene.trim()}.` : '',
    scene ? `Lo último que ha descrito el máster:\n${scene}` : '',
    prompt.target ? `${said} Va contra ${prompt.target}.` : said,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Qué tirada pedir para una intervención. Con qué tira lo dice el reglamento en un hechizo
 * (Arcano) y en un disparo (Puntería), y en un disparo la dificultad sale del objetivo, la
 * distancia y la cobertura: entonces no se pregunta.
 */
export function checkQuestions(prompt: CheckPrompt): DecisionPrompt<CheckQuestions> {
  const name = prompt.character.name;
  const background = prompt.character.background.trim();
  const questions: CheckQuestions = {};

  if (prompt.intent !== 'spell' && prompt.intent !== 'ranged') {
    questions.skill = {
      type: 'choice',
      instructions: `¿Con qué habilidad tiene que tirar ${name} para lo que intenta? Elige por lo que hace, no por lo que mejor se le da.`,
      criteria: Object.fromEntries(
        BASIC_SKILLS.map((skill) => [skill.id, `${skill.name}: ${skill.description}`]),
      ),
    };
  }
  if (prompt.intent === 'spell') {
    questions.difficulty = {
      type: 'score',
      instructions: `¿Cómo de poderoso es el efecto del hechizo que quiere lanzar ${name}?`,
      criteria: SPELL_SCALE.map(
        ([level, means]) =>
          `${SPELL_EFFECT_LABELS[level]} (${DIFFICULTY_LABELS[level].toLowerCase()}): ${means}`,
      ),
    };
  } else if (prompt.intent !== 'ranged') {
    questions.difficulty = {
      type: 'score',
      instructions: `¿Cómo de difícil es lo que intenta ${name}, tal como está la escena?`,
      criteria: DIFFICULTY_SCALE.map(([level, means]) => `${DIFFICULTY_LABELS[level]}: ${means}`),
    };
    questions.opposed = {
      type: 'noul',
      instructions: `¿Hay alguien que se oponga activamente a lo que intenta ${name} (que le vigile, le discuta, le persiga o le pelee), de modo que haya que tirar contra él?`,
      criteria: {
        false: 'Nadie se opone activamente: tira contra una dificultad',
        true: 'Alguien se opone activamente: tirada enfrentada',
      },
    };
    questions.needsRoll = {
      type: 'noul',
      instructions: `¿Lo que intenta ${name} tiene riesgo y un resultado incierto, de modo que haga falta tirar?`,
      criteria: {
        false: 'Sale bien sin tirar, o no puede salir bien: no hace falta tirar',
        true: 'Hay riesgo y el resultado es incierto: hay que tirar',
      },
    };
  }
  if (background) {
    questions.background = {
      type: 'noul',
      instructions: `¿El trasfondo de ${name} («${fit(background, 200)}») le da una ventaja clara en esto concreto que intenta, porque es justo su oficio o lo que conoce de cerca?`,
      criteria: {
        false: 'Su trasfondo no tiene que ver con esto concreto',
        true: 'Su trasfondo es justo lo que hace falta para esto',
      },
    };
  }
  if (prompt.intent === 'ranged') {
    questions.range = {
      type: 'score',
      instructions: `¿A qué distancia está aquello a lo que dispara ${name}?`,
      criteria: RANGE_SCALE.map(([, label]) => label),
    };
    questions.cover = {
      type: 'noul',
      instructions: `¿Aquello a lo que dispara ${name} está parcialmente a cubierto (tras un muro, un carro, unas cajas, una esquina o un árbol)?`,
      criteria: { false: 'Está al descubierto', true: 'Está parcialmente a cubierto' },
    };
  }
  return { state: checkState(prompt), questions };
}

/** Lo que sugiere la IA, a partir de sus respuestas. */
export function checkSuggestion(
  prompt: CheckPrompt,
  answers: DecisionAnswers<CheckQuestions>,
): CheckSuggestion {
  const scale =
    prompt.intent === 'spell'
      ? SPELL_SCALE.map(([level]) => level)
      : DIFFICULTY_SCALE.map(([level]) => level);
  return {
    skills: answers.skill ? topSkills(answers.skill.probabilities) : [],
    ...(answers.difficulty ? { difficulty: nearest(scale, answers.difficulty.score) } : {}),
    ...(answers.opposed ? { opposed: answers.opposed.probability } : {}),
    ...(answers.background ? { background: answers.background.probability } : {}),
    ...(answers.needsRoll ? { needsRoll: answers.needsRoll.probability } : {}),
    ...(answers.range
      ? {
          shot: {
            range: nearest(
              RANGE_SCALE.map(([range]) => range),
              answers.range.score,
            ),
            cover: answers.cover?.probability ?? 0,
          },
        }
      : {}),
  };
}

/** Quien pelea, con su id en el combate: los personajes son a quien pueden atacar. */
export type EnemyFighter = PromptFighter & { id: string };

export interface EnemyPrompt {
  round: number;
  /** El título de la escena en juego, si el máster ha empezado alguna. */
  scene?: string | undefined;
  /** Quien pelea, en el orden de iniciativa. */
  fighters: EnemyFighter[];
  /** Los PNJ que deciden, y lo que sabe el máster de ellos (nunca lo que ocultan). */
  acting: { fighter: EnemyFighter & { kind: 'npc' } } & PromptNpcKnown;
  /** Los últimos golpes del combate, del más antiguo al más reciente (ver damageText). */
  blows: string[];
  /** Si se pregunta también a quién atacan. */
  targets: boolean;
}

/**
 * A quién atacan se pregunta dos veces, con los personajes en un orden y en el contrario: el
 * modelo tira hacia el primero de la lista, y en un caso dudoso pasa del 39 al 73 % solo por eso.
 * Juntas, lo dudoso sale dudoso.
 */
export type EnemyQuestions = {
  target?: ChoiceQuestion;
  targetReversed?: ChoiceQuestion;
  morale: ChoiceQuestion;
};

/** Lo que el modelo sabe del combate: cómo va cada uno, a quién le toca y los últimos golpes. */
function enemyState(prompt: EnemyPrompt): string {
  const { acting } = prompt;
  return [
    `Ronda ${prompt.round}.`,
    prompt.scene?.trim() ? `Escena: ${prompt.scene.trim()}.` : '',
    `Quién pelea y cómo va:\n${prompt.fighters.map(fighterLine).join('\n')}`,
    [`Le toca a: ${fighterText(acting.fighter)}`, ...knownLines(acting)].join('\n'),
    prompt.blows.length > 0
      ? `Los últimos golpes del combate:\n${prompt.blows.map((blow) => `- ${blow}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Qué hacen unos PNJ en su turno: a quién atacan, si hay a quién elegir, y su moral. */
export function enemyQuestions(prompt: EnemyPrompt): DecisionPrompt<EnemyQuestions> {
  const { fighter } = prompt.acting;
  const group = fighter.count > 1;
  const name = fighter.name;
  const characters = prompt.fighters.filter((other) => other.kind === 'character');
  const questions: EnemyQuestions = {
    morale: {
      type: 'choice',
      instructions: `¿Qué ${group ? 'hacen' : 'hace'} ahora ${name}, tal como va el combate?`,
      criteria: {
        fight: group ? 'Siguen peleando' : 'Sigue peleando',
        flee: group
          ? 'Huyen: se retiran o escapan como pueden'
          : 'Huye: se retira o escapa como puede',
        surrender: group
          ? 'Se rinden: tiran las armas y piden clemencia'
          : 'Se rinde: tira las armas y pide clemencia',
      },
    },
  };
  if (prompt.targets && characters.length > 1) {
    const target = (list: EnemyFighter[]): ChoiceQuestion => ({
      type: 'choice',
      instructions: `¿A quién ${group ? 'atacan' : 'ataca'} ahora ${name}? Piensa en lo que ${group ? 'harían' : 'haría'}: ir a por quien más ${group ? 'les' : 'le'} amenaza, rematar al que está peor o devolver el golpe a quien acaba de herir${group ? 'les' : 'le'}.`,
      criteria: Object.fromEntries(list.map((other) => [other.id, fighterText(other)])),
    });
    questions.target = target(characters);
    questions.targetReversed = target([...characters].reverse());
  }
  return { state: enemyState(prompt), questions };
}

/** Lo que sugiere la IA de unos PNJ, a partir de sus respuestas. */
export function enemyDecision(
  prompt: EnemyPrompt,
  answers: DecisionAnswers<EnemyQuestions>,
): EnemyDecision {
  const asked = [answers.target, answers.targetReversed].filter((answer) => answer !== undefined);
  const targets: TargetOdds[] =
    asked.length === 0
      ? []
      : prompt.fighters
          .filter((other) => other.kind === 'character')
          .map((other) => ({
            id: other.id,
            name: other.name,
            probability:
              asked.reduce((sum, answer) => sum + (answer.probabilities[other.id] ?? 0), 0) /
              asked.length,
          }))
          .sort((a, b) => b.probability - a.probability);
  const probabilities = Object.fromEntries(
    MORALES.map((morale) => [morale, answers.morale.probabilities[morale] ?? 0]),
  ) as Record<Morale, number>;
  const choice = MORALES.reduce((best, morale) =>
    probabilities[morale] > probabilities[best] ? morale : best,
  );
  return { targets, morale: { choice, probabilities } };
}

/** Lo que se le cuenta a la IA de cada secreto: uno largo se recorta. */
const SECRET_CHARS = 300;
/** La opción de que no desvela nada. No puede ser el id de un PNJ, que son UUID. */
const NO_LEAK = 'none';

/** Un PNJ de la campaña con lo que oculta. */
export interface SecretNpc {
  id: string;
  name: string;
  secrets: string;
}

export interface LeakPrompt {
  /** Lo que va a enseñar el máster: una descripción o lo que dice un PNJ. */
  title: string;
  body: string;
  /** Quién lo dice, si es una frase de un PNJ. */
  speaker?: string | undefined;
  /** Los PNJ que ocultan algo, como mucho LEAK_NPCS: quien habla, el primero. */
  npcs: SecretNpc[];
}

/**
 * Si un texto desvela un secreto se pregunta de una vez, con un PNJ en cada opción y «ninguno»: un
 * `noul` por PNJ tarda un segundo por cada uno y, probado con Nimble, se equivoca más.
 */
export type LeakQuestions = { leak?: ChoiceQuestion };

export function leakQuestions(prompt: LeakPrompt): DecisionPrompt<LeakQuestions> {
  const title = prompt.title.trim();
  const body = prompt.body.trim();
  const state = prompt.speaker
    ? `${prompt.speaker} dice: «${body}»`
    : [title, body].filter(Boolean).join('\n');
  const npcs = prompt.npcs.slice(0, LEAK_NPCS);
  if (npcs.length === 0) return { state, questions: {} };
  return {
    state,
    questions: {
      leak: {
        type: 'choice',
        instructions:
          '¿Qué secreto desvela este texto, o deja adivinar, si desvela alguno? Solo cuenta si lo dice o lo da a entender, no si habla de otra cosa.',
        criteria: {
          ...Object.fromEntries(
            npcs.map((npc) => [
              npc.id,
              `Lo que oculta ${npc.name}: ${fit(npc.secrets, SECRET_CHARS)}`,
            ]),
          ),
          [NO_LEAK]: 'Ninguno: no desvela ni deja adivinar ningún secreto',
        },
      },
    },
  };
}

/** Los PNJ cuyo secreto puede desvelar el texto, de más a menos probable. Sin el secreto. */
export function secretLeaks(
  prompt: LeakPrompt,
  answers: DecisionAnswers<LeakQuestions>,
): SecretLeak[] {
  const { leak } = answers;
  if (!leak) return [];
  return prompt.npcs
    .map((npc) => ({ npcId: npc.id, name: npc.name, probability: leak.probabilities[npc.id] ?? 0 }))
    .filter((found) => found.probability > SUGGESTION_THRESHOLDS.leak)
    .sort((a, b) => b.probability - a.probability);
}
