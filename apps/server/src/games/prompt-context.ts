import { UNHARMED } from '@dungeon-copilot/rules';
import { groupSize, type Combat, type NpcCombatant } from '@dungeon-copilot/shared';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { SecretNpc } from '../ai/decisions';
import {
  IDEA_NPCS,
  damageText,
  type PromptCampaign,
  type PromptCharacter,
  type PromptFighter,
  type PromptNpcKnown,
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

/** Quien pelea, visto por la IA: con su id en el combate. */
export type IdentifiedFighter = PromptFighter & { id: string };

/** Unos PNJ que pelean, para la IA: cuántos son y cómo van. */
export const npcFighter = (
  combat: Combat,
  combatant: NpcCombatant,
): IdentifiedFighter & { kind: 'npc' } => ({
  kind: 'npc',
  id: combatant.id,
  name: combatant.name,
  profile: combatant.profile,
  count: groupSize(combatant),
  harm: combat.harm[combatant.id] ?? UNHARMED,
});

/**
 * Quien pelea en el combate, en el orden de iniciativa, como lo ve la IA: los personajes con sus
 * heridas y su equipo, y los PNJ con cuántos quedan en pie.
 */
export async function findFighters(
  db: Executor,
  campaignId: string,
  combat: Combat,
): Promise<IdentifiedFighter[]> {
  const ids = combat.order.flatMap((combatant) =>
    combatant.kind === 'character' ? [combatant.id] : [],
  );
  const sheets =
    ids.length === 0
      ? []
      : await db
          .select({ id: characters.id, severity: characters.severity, gear: characters.gear })
          .from(characters)
          .where(and(eq(characters.campaignId, campaignId), inArray(characters.id, ids)));
  return combat.order.flatMap((combatant): IdentifiedFighter[] => {
    if (combatant.kind === 'npc') return [npcFighter(combat, combatant)];
    const sheet = sheets.find((other) => other.id === combatant.id);
    return sheet ? [{ kind: 'character', name: combatant.name, ...sheet }] : [];
  });
}

/** Lo que sabe el máster de unos PNJ que pelean, si son de la campaña: nunca lo que ocultan. */
export async function findNpcKnown(
  db: Executor,
  campaignId: string,
  combatant: NpcCombatant,
): Promise<PromptNpcKnown> {
  if (!combatant.npcId) return {};
  const [npc] = await db
    .select({ concept: npcs.concept, personality: npcs.personality, goals: npcs.goals })
    .from(npcs)
    .where(and(eq(npcs.id, combatant.npcId), eq(npcs.campaignId, campaignId)));
  return npc ?? {};
}

/** Los últimos golpes del combate, del más antiguo al más reciente, contados en una frase. */
export async function findCombatBlows(
  db: Executor,
  gameId: string,
  combat: Combat,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ payload: gameEvents.payload })
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.gameId, gameId),
        gt(gameEvents.id, combat.startedAt),
        sql`${gameEvents.payload} ->> 'kind' = 'damage'`,
      ),
    )
    .orderBy(desc(gameEvents.id))
    .limit(limit);
  return rows
    .flatMap(({ payload }) => (payload.kind === 'damage' ? [damageText(payload)] : []))
    .reverse();
}

/**
 * Los PNJ de la campaña que ocultan algo, con lo que ocultan: primero `first`, si es uno de
 * ellos, y después los que el máster ha tocado hace menos. Solo para la IA que decide si un texto
 * los desvela: nunca para la que escribe.
 */
export async function findNpcSecrets(
  db: Executor,
  campaignId: string,
  limit: number,
  first?: string,
): Promise<SecretNpc[]> {
  return db
    .select({ id: npcs.id, name: npcs.name, secrets: npcs.secrets })
    .from(npcs)
    .where(and(eq(npcs.campaignId, campaignId), sql`btrim(${npcs.secrets}) <> ''`))
    .orderBy(
      ...(first ? [sql`${npcs.id} = ${first} desc`] : []),
      desc(npcs.updatedAt),
      asc(npcs.id),
    )
    .limit(limit);
}
