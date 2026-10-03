import { TERRAIN_KINDS, type Cell } from '@dungeon-copilot/rules';
import { z } from 'zod';
import type { GameEvent, GameEventKind } from './games';

// Los mapas de combate. El máster los prepara en la campaña (solo los ve él) y pone uno en la
// partida con `map`: se guarda tal como era entonces, para toda la mesa. Las fichas se ponen, se
// mueven y se quitan con `token`; las que el máster aún no enseña son eventos solo del máster, y
// se hacen públicas cuando las enseña. Al poner otro mapa, las fichas empiezan de cero.

/** Los topes de un mapa: lado en casillas y largo del nombre. */
export const MAP_LIMITS = { minSide: 4, maxSide: 60, name: 80, figureName: 40 } as const;

const coordinate = z
  .number()
  .int('Las casillas se cuentan con números enteros')
  .min(0, 'Las casillas empiezan en 0');

export const cellSchema = z.object({ x: coordinate, y: coordinate });

const side = (what: string) =>
  z
    .number()
    .int(`El ${what} se cuenta en casillas`)
    .min(MAP_LIMITS.minSide, `El mapa tiene al menos ${MAP_LIMITS.minSide} casillas de ${what}`)
    .max(MAP_LIMITS.maxSide, `El mapa tiene como mucho ${MAP_LIMITS.maxSide} casillas de ${what}`);

/**
 * Un plano en casillas de 1,5 m: su tamaño y lo que hay en las casillas que no son suelo (muros,
 * puertas, ventanas y muebles), cada casilla una vez.
 */
export const mapGridSchema = z
  .object({
    cols: side('ancho'),
    rows: side('alto'),
    terrain: z
      .array(cellSchema.extend({ kind: z.enum(TERRAIN_KINDS, 'Elige qué hay en la casilla') }))
      .max(MAP_LIMITS.maxSide ** 2, 'Hay más casillas que en el mapa más grande')
      .default([]),
  })
  .superRefine((grid, ctx) => {
    const seen = new Set<string>();
    grid.terrain.forEach((tile, index) => {
      const key = `${tile.x},${tile.y}`;
      if (tile.x >= grid.cols || tile.y >= grid.rows) {
        ctx.addIssue({
          code: 'custom',
          path: ['terrain', index],
          message: 'Hay casillas fuera del mapa',
        });
      } else if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['terrain', index],
          message: `En la casilla ${tile.x}, ${tile.y} hay dos cosas a la vez`,
        });
      }
      seen.add(key);
    });
  });

export type MapGrid = z.output<typeof mapGridSchema>;

const mapName = z
  .string()
  .trim()
  .min(1, 'Ponle un nombre al mapa')
  .max(MAP_LIMITS.name, `El nombre no puede pasar de ${MAP_LIMITS.name} caracteres`);

export const mapSchema = z.object({ name: mapName, grid: mapGridSchema });

export type MapRequest = z.input<typeof mapSchema>;

export const updateMapSchema = z
  .object({ name: mapName.optional(), grid: mapGridSchema.optional() })
  .refine((body) => body.name !== undefined || body.grid !== undefined, {
    message: 'No hay nada que cambiar',
  });

export type UpdateMapRequest = z.input<typeof updateMapSchema>;

/** Un mapa de la campaña. Son del máster: la mesa lo ve cuando lo pone en la partida. */
export interface MapView {
  id: string;
  campaignId: string;
  name: string;
  grid: MapGrid;
  createdAt: string;
  updatedAt: string;
}

/** El mapa como se puso en la partida: si el máster lo cambia después, la partida no cambia. */
export interface MapSnapshot {
  id: string;
  name: string;
  grid: MapGrid;
}

/** El máster pone un mapa de la campaña en la partida, o lo quita (null). */
export const setGameMapSchema = z.object({ mapId: z.uuid('Elige un mapa').nullable() });

export type SetGameMapRequest = z.input<typeof setGameMapSchema>;

/**
 * De quién es una ficha: de un personaje, de uno de los PNJ que pelean (`member`, cuál de su
 * grupo, desde 0) o una figura que pone el máster (un PNJ que no pelea, unos enemigos que aún no
 * se han dejado ver).
 */
export const tokenRefSchema = z.discriminatedUnion(
  'kind',
  [
    z.object({ kind: z.literal('character'), id: z.uuid('Elige un personaje') }),
    z.object({
      kind: z.literal('combatant'),
      id: z.uuid('Elige quién pelea'),
      member: z.number().int().min(0, 'Elige quién del grupo').max(99, 'Elige quién del grupo'),
    }),
    z.object({ kind: z.literal('figure'), id: z.uuid('La figura necesita un id') }),
  ],
  'Elige de quién es la ficha',
);

export type TokenRef = z.output<typeof tokenRefSchema>;

/**
 * Poner, mover o quitar una ficha del mapa en juego. Con `hidden`, solo la ve el máster: para lo
 * que la mesa aún no ve. El nombre lo pone el máster en una figura; el de un personaje o de quien
 * pelea sale solo.
 */
export const placeTokenSchema = z.object({
  token: tokenRefSchema,
  at: cellSchema.nullable(),
  hidden: z.boolean().default(false),
  name: z
    .string()
    .trim()
    .max(MAP_LIMITS.figureName, `El nombre no puede pasar de ${MAP_LIMITS.figureName} caracteres`)
    .optional(),
});

export type PlaceTokenRequest = z.input<typeof placeTokenSchema>;

/** Los eventos que dicen qué mapa hay en juego y dónde están las fichas. */
export const MAP_EVENT_KINDS = ['map', 'token'] as const satisfies GameEventKind[];

/** Una ficha, para reconocerla entre eventos: cada miembro de un grupo es una ficha distinta. */
export const tokenKey = (token: TokenRef) =>
  token.kind === 'combatant'
    ? `combatant:${token.id}:${token.member}`
    : `${token.kind}:${token.id}`;

/** Una ficha en el mapa: de quién es, con el nombre que se le dio, dónde está y si está oculta. */
export interface MapToken {
  token: TokenRef;
  name: string;
  at: Cell;
  /** Solo la ve el máster. */
  hidden: boolean;
}

export interface MapInPlay extends MapSnapshot {
  tokens: MapToken[];
}

/**
 * El mapa en juego y dónde está cada ficha tras estos eventos, o null si no hay mapa. Con los
 * eventos del máster salen también las fichas ocultas; con los de un jugador o la pantalla, solo
 * lo que ve la mesa.
 */
export function currentMap(events: readonly GameEvent[]): MapInPlay | null {
  let map: MapSnapshot | null = null;
  let tokens = new Map<string, MapToken>();
  for (const event of events) {
    if (event.kind === 'map') {
      map = event.map;
      tokens = new Map();
    } else if (event.kind === 'token' && map) {
      const key = tokenKey(event.token);
      if (event.at === null) tokens.delete(key);
      else {
        tokens.set(key, {
          token: event.token,
          name: event.name,
          at: event.at,
          hidden: event.visibility === 'master',
        });
      }
    }
  }
  return map && { ...map, tokens: [...tokens.values()] };
}
