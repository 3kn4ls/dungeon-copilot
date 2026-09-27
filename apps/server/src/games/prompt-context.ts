import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  IDEA_NPCS,
  type PromptCampaign,
  type PromptCharacter,
  type PromptNpcLine,
  type PromptScene,
} from '../ai/prompts';
import type { Executor } from '../db';
import { campaigns, characters, gameEvents, npcs } from '../db/schema';

/** Lo que la IA sabe de una campaña: de qué va y quién juega. Undefined si ya no existe. */
export async function findCampaignContext(
  db: Executor,
  campaignId: string,
): Promise<{ campaign: PromptCampaign; characters: PromptCharacter[] } | undefined> {
  const [campaign] = await db
    .select({ name: campaigns.name, description: campaigns.description })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId));
  if (!campaign) return undefined;
  const party = await db
    .select({ name: characters.name, background: characters.background })
    .from(characters)
    .where(eq(characters.campaignId, campaignId))
    .orderBy(asc(characters.createdAt));
  return { campaign, characters: party };
}

/** Los PNJ de una campaña en una línea, primero los que el máster ha tocado hace menos. */
export async function findNpcLines(
  db: Executor,
  campaignId: string,
  limit = IDEA_NPCS,
): Promise<PromptNpcLine[]> {
  return db
    .select({ name: npcs.name, concept: npcs.concept })
    .from(npcs)
    .where(eq(npcs.campaignId, campaignId))
    .orderBy(desc(npcs.updatedAt))
    .limit(limit);
}

/**
 * Lo último que el máster ha enseñado en una partida, de lo más antiguo a lo más reciente: la
 * escena en la que están los personajes.
 */
export async function findScenes(db: Executor, gameId: string, limit = 1): Promise<PromptScene[]> {
  const rows = await db
    .select({ payload: gameEvents.payload })
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.gameId, gameId),
        eq(gameEvents.visibility, 'public'),
        sql`${gameEvents.payload}->>'kind' = 'reveal'`,
      ),
    )
    .orderBy(desc(gameEvents.id))
    .limit(limit);
  return rows
    .flatMap(({ payload }) =>
      payload.kind === 'reveal' ? [{ title: payload.title, body: payload.body }] : [],
    )
    .reverse();
}
