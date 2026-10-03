import {
  MAP_EVENT_KINDS,
  currentMap,
  memberName,
  type Combatant,
  type FigureInCombat,
  type MapInPlay,
} from '@dungeon-copilot/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../db';
import { gameEvents } from '../db/schema';
import { HttpError, notFound } from '../http/errors';
import type { Entering } from './combat';
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

/**
 * Las figuras del mapa que pasan a ser las fichas de quienes entran en el combate (`combatants`,
 * en el orden de `entering`), cada una en su casilla. undefined si no entra ninguna; 409 si no hay
 * mapa y 404 si alguna no está en él.
 */
export async function figuresInCombat(
  db: Executor,
  gameId: string,
  entering: readonly Entering[],
  combatants: readonly Combatant[],
): Promise<FigureInCombat[] | undefined> {
  if (!entering.some((c) => c.kind === 'npc' && c.figures)) return undefined;
  const map = await requireMap(db, gameId);
  return entering.flatMap((c, index) => {
    const combatant = combatants[index];
    if (c.kind !== 'npc' || !c.figures || combatant?.kind !== 'npc') return [];
    return c.figures.map((figure, member): FigureInCombat => {
      const placed = map.tokens.find(({ token }) => token.kind === 'figure' && token.id === figure);
      if (!placed) throw notFound('Esa figura no está en el mapa');
      return {
        figure,
        token: { kind: 'combatant', id: combatant.id, member },
        name: memberName(combatant, member),
        at: placed.at,
      };
    });
  });
}
