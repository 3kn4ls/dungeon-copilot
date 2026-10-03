import { MAP_EVENT_KINDS, currentMap, type MapInPlay } from '@dungeon-copilot/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../db';
import { gameEvents } from '../db/schema';
import { HttpError } from '../http/errors';
import { toEvent } from './events';

export const NO_MAP = 'No hay ningún mapa en la partida';

/**
 * El mapa en juego de una partida, con todas sus fichas, también las ocultas: el servidor lo ve
 * todo, como el máster. null si no hay mapa.
 */
export async function findMap(db: Executor, gameId: string): Promise<MapInPlay | null> {
  const rows = await db
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.gameId, gameId),
        inArray(sql`${gameEvents.payload} ->> 'kind'`, [...MAP_EVENT_KINDS]),
      ),
    )
    .orderBy(asc(gameEvents.id));
  return currentMap(rows.map((row) => toEvent(row, null)));
}

/** El mapa en juego: 409 si no hay ninguno. */
export async function requireMap(db: Executor, gameId: string): Promise<MapInPlay> {
  const map = await findMap(db, gameId);
  if (!map) throw new HttpError(409, NO_MAP);
  return map;
}
