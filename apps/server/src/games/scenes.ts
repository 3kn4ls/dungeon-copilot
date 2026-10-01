import { USE_EVENT_KINDS, spentAbilities, type SpentAbilities } from '@dungeon-copilot/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../db';
import { gameEvents } from '../db/schema';
import { toEvent } from './events';

// Las escenas de una partida y las técnicas que se han gastado: se calculan con sus eventos, como
// en la web.

/** Las técnicas que ya no puede usar cada personaje en la escena (o la sesión) en juego. */
export async function findSpent(db: Executor, gameId: string): Promise<SpentAbilities> {
  const rows = await db
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.gameId, gameId),
        inArray(sql`${gameEvents.payload} ->> 'kind'`, [...USE_EVENT_KINDS]),
      ),
    )
    .orderBy(asc(gameEvents.id));
  return spentAbilities(rows.map((row) => toEvent(row, null)));
}

/** El título de la escena en juego, si el máster ha empezado alguna. */
export async function findSceneTitle(db: Executor, gameId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ payload: gameEvents.payload })
    .from(gameEvents)
    .where(and(eq(gameEvents.gameId, gameId), sql`${gameEvents.payload} ->> 'kind' = 'scene'`))
    .orderBy(desc(gameEvents.id))
    .limit(1);
  return row?.payload.kind === 'scene' ? row.payload.title : undefined;
}
