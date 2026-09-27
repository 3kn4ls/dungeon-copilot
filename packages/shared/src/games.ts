import { ATTRIBUTES, type Situation } from '@dungeon-copilot/rules';
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

export const revealSchema = z.object({
  title: z.string().trim().max(120, 'El título no puede pasar de 120 caracteres').default(''),
  body: z
    .string()
    .trim()
    .min(1, 'Escribe lo que quieres enseñar a la mesa')
    .max(5000, 'El texto no puede pasar de 5000 caracteres'),
});

export type RevealRequest = z.input<typeof revealSchema>;

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

/** Nombre corto de una partida: su título o, si no tiene, su número. */
export function gameName(game: Pick<GameSummary, 'number' | 'title'>): string {
  return game.title || `Partida ${game.number}`;
}
