import {
  generateNpcSchema,
  npcSchema,
  talkSchema,
  updateNpcSchema,
  type NpcView,
  type PublicUser,
} from '@dungeon-copilot/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  NPC_DRAFT_FORMAT,
  cleanReply,
  npcGenerationMessages,
  parseNpcDraft,
  spokenReply,
  talkMessages,
  type PromptScene,
} from '../ai/prompts';
import { abortWhenGone, requireAi, sendAiText } from '../ai/respond';
import type { AppContext } from '../context';
import type { Executor } from '../db';
import { campaignMembers, campaigns, characters, gameEvents, games, npcs } from '../db/schema';
import { findRecaps } from '../games/recaps';
import { HttpError, forbidden, notFound, parseBody, parseId } from '../http/errors';
import { CAMPAIGN_NOT_FOUND, requireMaster } from './access';
import { requireUser } from './auth';

interface IdParams {
  id: string;
}

type NpcRow = typeof npcs.$inferSelect;

const NPC_NOT_FOUND = 'Ese PNJ no existe o no es de tus campañas';

function toView(row: NpcRow): NpcView {
  return {
    id: row.id,
    campaignId: row.campaignId,
    name: row.name,
    concept: row.concept,
    appearance: row.appearance,
    personality: row.personality,
    speech: row.speech,
    goals: row.goals,
    secrets: row.secrets,
    profile: row.profile,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Los PNJ son del máster: 404 a quien no es de la campaña y 403 a los jugadores. */
async function findNpc(db: Executor, user: PublicUser, id: string): Promise<NpcRow> {
  const [found] = await db
    .select({ npc: npcs, role: campaignMembers.role })
    .from(npcs)
    .innerJoin(
      campaignMembers,
      and(eq(campaignMembers.campaignId, npcs.campaignId), eq(campaignMembers.userId, user.id)),
    )
    .where(eq(npcs.id, id));
  if (!found) throw notFound(NPC_NOT_FOUND);
  if (found.role !== 'master') throw forbidden('Solo el máster de la campaña ve sus PNJ');
  return found.npc;
}

async function findCampaign(db: Executor, campaignId: string) {
  const [campaign] = await db
    .select({ name: campaigns.name, description: campaigns.description })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId));
  if (!campaign) throw notFound(CAMPAIGN_NOT_FOUND);
  return campaign;
}

/** Lo último que el máster ha enseñado en la partida: la escena en la que está el PNJ. */
async function findScene(db: Executor, gameId: string): Promise<PromptScene | undefined> {
  const [row] = await db
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
    .limit(1);
  return row?.payload.kind === 'reveal'
    ? { title: row.payload.title, body: row.payload.body }
    : undefined;
}

export function registerNpcRoutes(app: FastifyInstance, { db, ai }: AppContext): void {
  app.get<{ Params: IdParams }>('/api/campaigns/:id/npcs', async (request) => {
    const user = requireUser(request);
    const campaignId = parseId(request.params.id, CAMPAIGN_NOT_FOUND);
    await requireMaster(db, campaignId, user);
    const rows = await db
      .select()
      .from(npcs)
      .where(eq(npcs.campaignId, campaignId))
      .orderBy(asc(sql`lower(${npcs.name})`), asc(npcs.createdAt));
    return { npcs: rows.map(toView) };
  });

  app.post<{ Params: IdParams }>('/api/campaigns/:id/npcs', async (request, reply) => {
    const user = requireUser(request);
    const campaignId = parseId(request.params.id, CAMPAIGN_NOT_FOUND);
    const body = parseBody(npcSchema, request.body, 'Revisa los datos del PNJ');
    await requireMaster(db, campaignId, user);
    const [row] = await db
      .insert(npcs)
      .values({ campaignId, ...body })
      .returning();
    if (!row) throw new Error('La base de datos no devolvió el PNJ creado');
    return reply.status(201).send({ npc: toView(row) });
  });

  app.get<{ Params: IdParams }>('/api/npcs/:id', async (request) => {
    const user = requireUser(request);
    const npc = await findNpc(db, user, parseId(request.params.id, NPC_NOT_FOUND));
    return { npc: toView(npc) };
  });

  app.patch<{ Params: IdParams }>('/api/npcs/:id', async (request) => {
    const user = requireUser(request);
    const id = parseId(request.params.id, NPC_NOT_FOUND);
    const body = parseBody(updateNpcSchema, request.body, 'Revisa los datos del PNJ');
    await findNpc(db, user, id);
    const [row] = await db
      .update(npcs)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(npcs.id, id))
      .returning();
    // Borrado justo entre medias por otra pestaña.
    if (!row) throw notFound(NPC_NOT_FOUND);
    return { npc: toView(row) };
  });

  app.delete<{ Params: IdParams }>('/api/npcs/:id', async (request, reply) => {
    const user = requireUser(request);
    const id = parseId(request.params.id, NPC_NOT_FOUND);
    await findNpc(db, user, id);
    await db.delete(npcs).where(eq(npcs.id, id));
    return reply.status(204).send();
  });

  /** La IA se inventa un PNJ para la campaña. No se guarda: el máster lo revisa antes. */
  app.post<{ Params: IdParams }>('/api/campaigns/:id/npcs/generate', async (request, reply) => {
    const user = requireUser(request);
    const campaignId = parseId(request.params.id, CAMPAIGN_NOT_FOUND);
    const body = parseBody(generateNpcSchema, request.body, 'Revisa la idea del PNJ');
    await requireMaster(db, campaignId, user);
    const model = requireAi(ai);
    const campaign = await findCampaign(db, campaignId);
    const existing = await db
      .select({ name: npcs.name })
      .from(npcs)
      .where(eq(npcs.campaignId, campaignId))
      .orderBy(desc(npcs.createdAt));
    const recaps = await findRecaps(db, campaignId);

    const controller = abortWhenGone(request, reply);
    let content: string;
    try {
      content = await model.complete({
        messages: npcGenerationMessages({
          campaign,
          idea: body.idea,
          existing: existing.map((npc) => npc.name),
          draft: body.draft,
          recaps,
        }),
        format: NPC_DRAFT_FORMAT,
        temperature: 0.9,
        signal: controller.signal,
      });
    } catch (error) {
      // Nadie espera ya la respuesta: no hay a quién contestar.
      if (controller.signal.aborted) return reply.hijack();
      throw error;
    }
    const npc = parseNpcDraft(content, body.draft);
    if (!npc) {
      request.log.warn({ content }, 'La IA no devolvió un PNJ válido');
      throw new HttpError(502, 'La IA no ha devuelto un PNJ que se entienda. Prueba otra vez.');
    }
    return { npc };
  });

  /**
   * El PNJ responde a lo que le dice la mesa. La respuesta llega en directo, una línea JSON
   * por trozo (ver AiTextChunk), para que el máster la lea según la escribe la IA.
   */
  app.post<{ Params: IdParams }>('/api/npcs/:id/talk', async (request, reply) => {
    const user = requireUser(request);
    const id = parseId(request.params.id, NPC_NOT_FOUND);
    const body = parseBody(talkSchema, request.body, 'Revisa la conversación');
    const npc = await findNpc(db, user, id);
    const model = requireAi(ai);
    const campaign = await findCampaign(db, npc.campaignId);

    let scene: PromptScene | undefined;
    if (body.gameId) {
      const [game] = await db
        .select({ id: games.id })
        .from(games)
        .where(and(eq(games.id, body.gameId), eq(games.campaignId, npc.campaignId)));
      if (!game) throw notFound('Esa partida no es de la campaña de este PNJ');
      scene = await findScene(db, game.id);
    }
    const party = await db
      .select({ name: characters.name, background: characters.background })
      .from(characters)
      .where(eq(characters.campaignId, npc.campaignId))
      .orderBy(asc(characters.createdAt));
    const recaps = await findRecaps(db, npc.campaignId);

    return sendAiText(request, reply, {
      ai: model,
      request: {
        messages: talkMessages({
          campaign,
          npc,
          characters: party,
          recaps,
          scene,
          history: body.history,
          input: body.input,
        }),
        temperature: 0.8,
        maxTokens: 400,
      },
      visible: (text) => spokenReply(text, npc.name),
      finish: (text) => cleanReply(text, npc.name),
      cutMessage: 'Se cortó la respuesta del PNJ',
    });
  });
}
