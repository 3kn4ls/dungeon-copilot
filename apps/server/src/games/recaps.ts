import { and, desc, eq, lt, ne } from 'drizzle-orm';
import { MEMORY_RECAPS, type PromptRecap } from '../ai/prompts';
import type { Executor } from '../db';
import { games } from '../db/schema';

/**
 * Las últimas partidas resumidas de una campaña, de la más antigua a la más reciente: lo que
 * la IA recuerda de lo que ha pasado. Con `before`, solo las anteriores a esa partida.
 */
export async function findRecaps(
  db: Executor,
  campaignId: string,
  options: { before?: number; limit?: number } = {},
): Promise<PromptRecap[]> {
  const rows = await db
    .select({ number: games.number, title: games.title, recap: games.recap })
    .from(games)
    .where(
      and(
        eq(games.campaignId, campaignId),
        ne(games.recap, ''),
        options.before === undefined ? undefined : lt(games.number, options.before),
      ),
    )
    .orderBy(desc(games.number))
    .limit(options.limit ?? MEMORY_RECAPS);
  return rows.reverse();
}
