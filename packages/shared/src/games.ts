import { ATTRIBUTES, type OpposedSide, type Situation } from '@dungeon-copilot/rules';
import { z } from 'zod';
import type { MemberRole } from './campaigns';
import type { RollResponse } from './rolls';

/** Una partida: la sesión de juego que el máster abre dentro de una campaña. */
export const GAME_STATUSES = ['open', 'closed'] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export const GAME_STATUS_LABELS: Record<GameStatus, string> = {
  open: 'En juego',
  closed: 'Terminada',
};

/**
 * "public" lo ve toda la mesa y la pantalla; "master", solo el máster; "private", el máster y
 * un jugador: lo que se dicen en secreto.
 */
export type GameEventVisibility = 'public' | 'master' | 'private';

/** Un personaje de la campaña, con el nombre que tenía entonces: puede cambiarlo después. */
export interface CharacterRef {
  characterId: string;
  name: string;
}

/**
 * La intervención de un jugador que el máster atiende con esto: deja de esperar. Es el id de
 * su evento.
 */
const answersSchema = z.number().int().positive().optional();

/** Solo para este personaje: lo ven el máster y su jugador, nadie más (ni la pantalla). */
const recipientSchema = z.uuid('Elige un personaje').optional();

export const openGameSchema = z.object({
  title: z.string().trim().max(100, 'El título no puede pasar de 100 caracteres').default(''),
  /** Las reglas dicen que cada personaje empieza la sesión con la Suerte llena. */
  refillLuck: z.boolean().default(true),
});

export type OpenGameRequest = z.input<typeof openGameSchema>;

export const closeGameSchema = z.object({
  /** Los PX de fin de sesión para todos los personajes; los hitos se dan en cada ficha. */
  awardXp: z.boolean().default(true),
});

export type CloseGameRequest = z.input<typeof closeGameSchema>;

/** Tope del resumen de una partida. */
export const RECAP_MAX = 4000;

/** El resumen de una partida terminada, tal como lo deja el máster. Lo ve toda la mesa. */
export const recapSchema = z.object({
  /** Vacío: la partida se queda sin resumen. */
  recap: z.string().trim().max(RECAP_MAX, `El resumen no puede pasar de ${RECAP_MAX} caracteres`),
});

export type RecapRequest = z.input<typeof recapSchema>;

/** Lo que el máster le da a la IA, además del registro, para que le proponga un resumen. */
export const recapDraftSchema = z.object({
  /**
   * Lo que se jugó de palabra y no está en el registro, o lo que quiere destacar: "Kael
   * traicionó al gremio y huyeron por las cloacas".
   */
  hint: z.string().trim().max(1000, 'El texto no puede pasar de 1000 caracteres').default(''),
  /** Las notas del máster ayudan a la IA a entender lo que pasó, pero guardan secretos. */
  useNotes: z.boolean().default(true),
});

export type RecapDraftRequest = z.input<typeof recapDraftSchema>;

/** Tope de lo que el máster enseña a la mesa de una vez. */
export const REVEAL_MAX = 5000;

const revealTitle = z
  .string()
  .trim()
  .max(120, 'El título no puede pasar de 120 caracteres')
  .default('');

export const revealSchema = z.object({
  title: revealTitle,
  body: z
    .string()
    .trim()
    .min(1, 'Escribe lo que quieres enseñar a la mesa')
    .max(REVEAL_MAX, `El texto no puede pasar de ${REVEAL_MAX} caracteres`),
  to: recipientSchema,
  answers: answersSchema,
});

export type RevealRequest = z.input<typeof revealSchema>;

/**
 * Lo que el máster le da a la IA para que describa una escena: unas notas ("taberna del
 * puerto, de noche, un encapuchado en la esquina") o solo el título. No se enseña nada aún.
 */
export const revealDraftSchema = z
  .object({
    title: revealTitle,
    notes: z
      .string()
      .trim()
      .max(REVEAL_MAX, `Las notas no pueden pasar de ${REVEAL_MAX} caracteres`)
      .default(''),
  })
  .refine((draft) => draft.notes !== '' || draft.title !== '', {
    path: ['notes'],
    message: 'Escribe unas notas o un título para que la IA sepa qué describir',
  });

export type RevealDraftRequest = z.input<typeof revealDraftSchema>;

/** Para que la IA proponga complicaciones a una tirada que ha salido a medias o mal. */
export const complicationsSchema = z.object({
  /** Lo que intentaba quien tiraba, que la tirada no dice: "forzar la puerta del almacén". */
  intent: z.string().trim().max(300, 'No puede pasar de 300 caracteres').default(''),
});

export type ComplicationsRequest = z.input<typeof complicationsSchema>;

/** Para que la IA proponga qué puede pasar ahora en la escena, cuando la mesa se atasca. */
export const ideasSchema = z.object({
  /** Lo que busca el máster, si lo sabe: "algo que les meta prisa". */
  hint: z.string().trim().max(300, 'No puede pasar de 300 caracteres').default(''),
});

export type IdeasRequest = z.input<typeof ideasSchema>;

export const noteSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'La nota está vacía')
    .max(5000, 'La nota no puede pasar de 5000 caracteres'),
});

export type NoteRequest = z.input<typeof noteSchema>;

/** Lo que dice un PNJ, para que lo vea toda la mesa (o, con `to`, un solo personaje). */
export const speechSchema = z.object({
  npcId: z.uuid('Elige un PNJ'),
  text: z
    .string()
    .trim()
    .min(1, 'La frase está vacía')
    .max(2000, 'La frase no puede pasar de 2000 caracteres'),
  to: recipientSchema,
  answers: answersSchema,
});

export type SpeechRequest = z.input<typeof speechSchema>;

/**
 * Quién tiene la palabra: el máster, que narra; toda la mesa («¿Qué hacéis?»); o un personaje
 * («Kael, ¿qué le respondes?»). Quien no la tiene puede pedirla.
 */
export type Floor =
  { kind: 'master' } | { kind: 'table' } | { kind: 'character'; characterId: string; name: string };

export const giveFloorSchema = z.object({
  to: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('master') }),
    z.object({ kind: z.literal('table') }),
    z.object({ kind: z.literal('character'), characterId: z.uuid('Elige un personaje') }),
  ]),
  answers: answersSchema,
});

export type GiveFloorRequest = z.input<typeof giveFloorSchema>;

/**
 * Lo que puede hacer un jugador con un botón: hablar en personaje, actuar en la escena,
 * preguntar al máster fuera del personaje («¿hay ventanas?») o atacar.
 */
export const INTERVENTION_INTENTS = ['speak', 'act', 'ask', 'attack'] as const;
export type InterventionIntent = (typeof INTERVENTION_INTENTS)[number];

export const INTERVENTION_LABELS: Record<InterventionIntent, string> = {
  speak: 'Hablar',
  act: 'Actuar',
  ask: 'Preguntar',
  attack: 'Atacar',
};

/** Tope de lo que escribe un jugador al intervenir. */
export const INTERVENTION_MAX = 1000;

/**
 * Un jugador interviene con su personaje: sin la palabra, es pedirla (levantar la mano); con
 * ella, intervenir. En los dos casos espera a que el máster la atienda.
 */
export const interventionSchema = z.object({
  characterId: z.uuid('Elige un personaje'),
  intent: z.enum(INTERVENTION_INTENTS, 'Elige si quieres hablar, actuar, preguntar o atacar'),
  /** Lo que dice o hace el personaje, si lo escribe; vacío si lo cuenta de palabra. */
  text: z
    .string()
    .trim()
    .max(INTERVENTION_MAX, `No puede pasar de ${INTERVENTION_MAX} caracteres`)
    .default(''),
  /** En secreto: solo la ven el máster y quien la escribe, como pasarle una nota. */
  secret: z.boolean().default(false),
});

export type InterventionRequest = z.input<typeof interventionSchema>;

/** El máster atiende una intervención sin más: la resuelve de palabra o le dice que ahora no. */
export const answerInterventionSchema = z.object({
  how: z.enum(['answered', 'dismissed']).default('answered'),
});

export type AnswerInterventionRequest = z.input<typeof answerInterventionSchema>;

/**
 * Cómo se cierra lo que esperaba al máster o a un jugador: atendido (o hecha, si es una tirada
 * pedida), «ahora no», o retirado por quien lo pidió.
 */
export type SettledHow = 'answered' | 'dismissed' | 'withdrawn';

const edgeSchema = z.enum(['none', 'advantage', 'disadvantage']).default('none');

/** Un personaje de la campaña: el servidor calcula su bonificador con la ficha. */
const characterSideSchema = z.object({
  kind: z.literal('character'),
  characterId: z.uuid('Elige un personaje'),
  /** Habilidad básica. Sin ella se tira solo con el atributo. */
  skill: z.string().min(1).optional(),
  /** Atributo con el que se tira; por defecto, el de la habilidad. */
  attribute: z.enum(ATTRIBUTES).optional(),
  modifier: z.number().int().min(-5).max(5).default(0),
  edge: edgeSchema,
});

/** Algo que describe el máster, como un PNJ: "Guardia veterano", +4. */
const freeSideSchema = z.object({
  kind: z.literal('free'),
  label: z.string().trim().min(1, 'Di quién tira').max(80, 'El nombre es demasiado largo'),
  bonus: z.number().int().min(-5).max(20),
  edge: edgeSchema,
});

const rollSideSchema = z.discriminatedUnion('kind', [characterSideSchema, freeSideSchema]);

export type RollSideRequest = z.input<typeof rollSideSchema>;

export const gameRollSchema = z.object({
  actor: rollSideSchema,
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('difficulty'), difficulty: z.number().int().min(2).max(30) }),
    z.object({ kind: z.literal('opposed'), opponent: rollSideSchema }),
  ]),
  situation: z.enum(['test', 'melee', 'ranged']).default('test'),
  /** Tirada secreta: solo la ve el máster. */
  secret: z.boolean().default(false),
});

export type GameRollRequest = z.input<typeof gameRollSchema>;

/**
 * El máster pide una tirada a un personaje y su jugador la hace con un botón. La hace quien
 * actúa o, si es un PNJ, quien se opone (una defensa). El bonificador sale de la ficha al tirar.
 */
export const askRollSchema = z.object({
  roll: gameRollSchema.omit({ secret: true }),
  /** En secreto: la petición y la tirada solo las ven el máster y el jugador del personaje. */
  secret: z.boolean().default(false),
  answers: answersSchema,
});

export type AskRollRequest = z.input<typeof askRollSchema>;

/** Una tirada pedida, tal como se hará cuando la tiren. */
export type RequestedRoll = z.output<typeof askRollSchema>['roll'];

/** Para repetir una tirada gastando un punto de Suerte del personaje que tira. */
export const rerollSchema = z.object({
  /** De quién son los dados que se repiten: en una tirada enfrentada, cada bando repite los suyos. */
  side: z.enum(['actor', 'opponent']).default('actor'),
});

export type RerollRequest = z.input<typeof rerollSchema>;

export interface GameRollSide {
  /** Nombre del personaje o lo que haya escrito el máster. */
  label: string;
  characterId?: string;
  /** Con qué tira un personaje: "Esgrima", "Fuerza", "Atletismo con Destreza". */
  check?: string;
}

export interface GameRoll {
  actor: GameRollSide;
  /** Contra qué: una dificultad ("Difícil (12)") o quien se opone. */
  target: { kind: 'difficulty'; label: string } | ({ kind: 'opposed' } & GameRollSide);
  situation: Situation;
  /** Lo que ha cambiado la tirada sin que nadie lo pidiera, como la desventaja por herida grave. */
  notes: string[];
  result: RollResponse;
  /** Si repite con Suerte otra tirada, que deja de contar. */
  reroll?: GameRollReroll;
  /** La tirada pedida por el máster que cumple, si viene de una. */
  requested?: number;
}

/** Quién tira y contra qué: lo que se enseña de una tirada pedida mientras espera. */
export type GameRollPreview = Pick<GameRoll, 'actor' | 'target' | 'situation'>;

export interface GameRollReroll {
  /** El evento de la tirada que se repite, que deja de contar. */
  of: number;
  /** El bando que gasta Suerte y vuelve a tirar sus dados; los del otro se quedan. */
  side: OpposedSide;
  /** Los bandos que han repetido desde la tirada original, este incluido: cada uno, una vez. */
  sides: OpposedSide[];
}

/** Un bando de una tirada por el que tira un personaje de la campaña. */
export interface CharacterSide {
  side: OpposedSide;
  characterId: string;
  label: string;
}

/** Los bandos de una tirada por los que tira un personaje: solo ellos tienen Suerte. */
export function characterSides(roll: GameRoll): CharacterSide[] {
  const sides: CharacterSide[] = [];
  if (roll.actor.characterId) {
    sides.push({ side: 'actor', characterId: roll.actor.characterId, label: roll.actor.label });
  }
  if (roll.target.kind === 'opposed' && roll.target.characterId) {
    sides.push({
      side: 'opponent',
      characterId: roll.target.characterId,
      label: roll.target.label,
    });
  }
  return sides;
}

/** Los personajes de una tirada que aún pueden repetirla con Suerte: cada uno, una vez. */
export const rerollableSides = (roll: GameRoll): CharacterSide[] =>
  characterSides(roll).filter((side) => !roll.reroll?.sides.includes(side.side));

/** Quién ha repetido la tirada con Suerte, si es una repetición. */
export function rerollerLabel(roll: GameRoll): string | undefined {
  if (!roll.reroll) return undefined;
  if (roll.reroll.side === 'actor' || roll.target.kind !== 'opposed') return roll.actor.label;
  return roll.target.label;
}

export type GameEventPayload =
  | { kind: 'opened'; number: number; title: string; luckRefilled: boolean }
  | { kind: 'closed'; xpAwarded: number }
  /** Con `to`, en secreto para ese personaje; con `answers`, responde a esa intervención. */
  | { kind: 'reveal'; title: string; body: string; to?: CharacterRef; answers?: number }
  | { kind: 'note'; text: string }
  | { kind: 'roll'; roll: GameRoll }
  /** El nombre se guarda tal cual era: el PNJ puede cambiar de nombre o borrarse después. */
  | {
      kind: 'speech';
      npcId: string;
      name: string;
      text: string;
      to?: CharacterRef;
      answers?: number;
    }
  /** El máster da la palabra; con `answers`, atiende así esa intervención. */
  | { kind: 'floor'; floor: Floor; answers?: number }
  /** Un jugador interviene o pide la palabra con su personaje. Espera a que la atiendan. */
  | {
      kind: 'intervention';
      characterId: string;
      name: string;
      intent: InterventionIntent;
      text: string;
    }
  /**
   * El máster pide una tirada: la hace el jugador de `characterId`. `request` es la tirada
   * que se resolverá entonces, y `preview` cómo se veía al pedirla.
   */
  | {
      kind: 'rollRequest';
      characterId: string;
      name: string;
      request: RequestedRoll;
      preview: GameRollPreview;
      answers?: number;
    }
  /** Se cierra una intervención o una tirada pedida sin nada más. */
  | { kind: 'settled'; of: number; how: SettledHow };

export type GameEventKind = GameEventPayload['kind'];

export type GameEvent = GameEventPayload & {
  /** Creciente: sirve para ordenar y para retomar el directo donde se quedó. */
  id: number;
  gameId: string;
  visibility: GameEventVisibility;
  authorName: string | null;
  createdAt: string;
};

export interface GameSummary {
  id: string;
  number: number;
  title: string;
  status: GameStatus;
  openedAt: string;
  closedAt: string | null;
  /**
   * Lo que pasó, contado por el máster al terminar (con ayuda de la IA o sin ella). Lo ve toda
   * la mesa, y la IA lo recuerda en las partidas siguientes. Vacío si no hay.
   */
  recap: string;
}

export interface GameDetail extends GameSummary {
  campaignId: string;
  campaignName: string;
  role: MemberRole;
  /** Enlace de la pantalla de la mesa. Solo lo ve el máster. */
  screenToken?: string;
}

export interface GameState {
  game: GameDetail;
  /** Del más antiguo al más reciente, ya filtrados por lo que puede ver quien pregunta. */
  events: GameEvent[];
}

/**
 * Lo que ve la pantalla de la mesa: la última partida de la campaña y solo lo público.
 * El enlace es de la campaña, así que la pantalla pasa sola a la partida siguiente.
 */
export interface ScreenState {
  campaignName: string;
  game: GameSummary | null;
  events: GameEvent[];
}

/** Las tiradas que se han repetido con Suerte: ya no cuentan, cuenta la repetición. */
export function supersededRolls(events: readonly GameEvent[]): Set<number> {
  return new Set(
    events.flatMap((event) =>
      event.kind === 'roll' && event.roll.reroll ? [event.roll.reroll.of] : [],
    ),
  );
}

export type InterventionEvent = GameEvent & { kind: 'intervention' };
export type RollRequestEvent = GameEvent & { kind: 'rollRequest' };

/** Quién tiene la palabra tras estos eventos: a quien se la dio el máster la última vez. */
export function currentFloor(events: readonly GameEvent[]): Floor {
  const last = events.findLast((event) => event.kind === 'floor');
  return last?.kind === 'floor' ? last.floor : { kind: 'master' };
}

/**
 * Lo que ya no espera y cómo acabó: las intervenciones que ha atendido el máster (dando la
 * palabra, pidiendo una tirada, con una frase, una descripción o sin más), a las que ha dicho
 * «ahora no» o que se han retirado, y las tiradas pedidas que ya se han hecho o retirado.
 */
export function settledEvents(events: readonly GameEvent[]): Map<number, SettledHow> {
  const settled = new Map<number, SettledHow>();
  const settle = (id: number | undefined, how: SettledHow) => {
    if (id !== undefined && !settled.has(id)) settled.set(id, how);
  };
  for (const event of events) {
    switch (event.kind) {
      case 'settled':
        settle(event.of, event.how);
        break;
      case 'roll':
        settle(event.roll.requested, 'answered');
        break;
      case 'floor':
      case 'reveal':
      case 'speech':
      case 'rollRequest':
        settle(event.answers, 'answered');
        break;
    }
  }
  return settled;
}

/** Las intervenciones que esperan a que las atienda el máster, de la más antigua a la última. */
export function pendingInterventions(events: readonly GameEvent[]): InterventionEvent[] {
  const settled = settledEvents(events);
  return events.filter(
    (event): event is InterventionEvent => event.kind === 'intervention' && !settled.has(event.id),
  );
}

/** Las tiradas que ha pedido el máster y aún no se han hecho, de la más antigua a la última. */
export function pendingRollRequests(events: readonly GameEvent[]): RollRequestEvent[] {
  const settled = settledEvents(events);
  return events.filter(
    (event): event is RollRequestEvent => event.kind === 'rollRequest' && !settled.has(event.id),
  );
}

/** Nombre corto de una partida: su título o, si no tiene, su número. */
export function gameName(game: Pick<GameSummary, 'number' | 'title'>): string {
  return game.title || `Partida ${game.number}`;
}
