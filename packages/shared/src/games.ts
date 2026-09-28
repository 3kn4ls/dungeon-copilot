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

/** "public" lo ve toda la mesa y la pantalla; "master", solo el máster. */
export type GameEventVisibility = 'public' | 'master';

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

/** Lo que dice un PNJ, para que lo vea toda la mesa. */
export const speechSchema = z.object({
  npcId: z.uuid('Elige un PNJ'),
  text: z
    .string()
    .trim()
    .min(1, 'La frase está vacía')
    .max(2000, 'La frase no puede pasar de 2000 caracteres'),
});

export type SpeechRequest = z.input<typeof speechSchema>;

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
}

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
  | { kind: 'reveal'; title: string; body: string }
  | { kind: 'note'; text: string }
  | { kind: 'roll'; roll: GameRoll }
  /** El nombre se guarda tal cual era: el PNJ puede cambiar de nombre o borrarse después. */
  | { kind: 'speech'; npcId: string; name: string; text: string };

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

/** Nombre corto de una partida: su título o, si no tiene, su número. */
export function gameName(game: Pick<GameSummary, 'number' | 'title'>): string {
  return game.title || `Partida ${game.number}`;
}
