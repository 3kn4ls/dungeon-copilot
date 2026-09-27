import { LUCK_PER_SESSION, XP_AWARDS, needsComplication } from '@dungeon-copilot/rules';
import {
  closeGameSchema,
  complicationsSchema,
  gameRollSchema,
  ideasSchema,
  noteSchema,
  openGameSchema,
  recapDraftSchema,
  recapSchema,
  revealDraftSchema,
  revealSchema,
  speechSchema,
  type GameDetail,
  type GameEvent,
  type GameEventPayload,
  type GameEventVisibility,
  type GameState,
  type GameSummary,
  type MemberRole,
  type PublicUser,
  type ScreenState,
} from '@dungeon-copilot/shared';
import { and, asc, desc, eq, gt, inArray, max, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  IDEAS_FORMAT,
  RECENT_SCENES,
  cleanIdeas,
  cleanRecap,
  cleanScene,
  complicationMessages,
  hasLog,
  ideaMessages,
  recapMessages,
  sceneMessages,
  visibleIdeas,
  visibleRecap,
  visibleScene,
} from '../ai/prompts';
import { requireAi, sendAiText } from '../ai/respond';
import type { AppContext } from '../context';
import type { Executor, Transaction } from '../db';
import { isUniqueViolation } from '../db/errors';
import {
  campaignMembers,
  campaigns,
  characters,
  gameEvents,
  games,
  npcs,
  users,
} from '../db/schema';
import { findCampaignContext, findNpcLines, findScenes } from '../games/prompt-context';
import { findRecaps } from '../games/recaps';
import type { RollingCharacter } from '../games/rolls';
import { resolveGameRoll } from '../games/rolls';
import { lastEventId, openEventStream } from '../games/stream';
import { HttpError, forbidden, notFound, parseBody, parseId } from '../http/errors';
import { CAMPAIGN_NOT_FOUND, requireMaster, requireMember } from './access';
import { requireUser } from './auth';

interface IdParams {
  id: string;
}

interface TokenParams {
  token: string;
}

interface StreamQuery {
  after?: string;
}

const GAME_NOT_FOUND = 'Esa partida no existe o no es de tus campañas';
const SCREEN_NOT_FOUND = 'Esta pantalla no existe o el máster ha cambiado su enlace';
const GAME_CLOSED = 'La partida ya ha terminado';
const GAME_STILL_OPEN = 'La partida sigue en juego: el resumen se escribe al terminarla';
/**
 * El resumen lee la partida entera: sin GPU, el modelo puede tardar minutos solo en leerla.
 * El máster ya ha terminado de jugar y puede esperar más que a un PNJ.
 */
const RECAP_TIMEOUT_MS = 300_000;
const MASTER_ONLY = 'Solo el máster de la campaña puede hacer eso';
const ROLL_NOT_FOUND = 'Esa tirada no existe en esta partida';
const ROLL_WENT_WELL =
  'Esa tirada salió bien: las complicaciones son para los éxitos con coste, los fallos y las pifias';

/** Los ids de los eventos son un integer de PostgreSQL: fuera de rango, no existen. */
const isEventId = (id: number) => Number.isInteger(id) && id > 0 && id <= 2 ** 31 - 1;

/** Los enlaces de pantalla son 32 caracteres hexadecimales (ver el esquema de campaigns). */
const SCREEN_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

type GameRow = typeof games.$inferSelect;
type EventRow = typeof gameEvents.$inferSelect;

interface FoundGame {
  game: GameRow;
  campaignName: string;
  screenToken: string;
  role: MemberRole;
}

function toSummary(row: GameRow): GameSummary {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    recap: row.recap,
  };
}

function toDetail({ game, campaignName, screenToken, role }: FoundGame): GameDetail {
  const detail: GameDetail = {
    ...toSummary(game),
    campaignId: game.campaignId,
    campaignName,
    role,
  };
  if (role === 'master') detail.screenToken = screenToken;
  return detail;
}

function toEvent(row: EventRow, authorName: string | null): GameEvent {
  return {
    ...row.payload,
    id: row.id,
    gameId: row.gameId,
    visibility: row.visibility,
    authorName,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Eventos de una partida posteriores a `after`, del más antiguo al más reciente. */
async function findEvents(
  db: Executor,
  gameId: string,
  options: { after?: number; includeMaster: boolean },
): Promise<GameEvent[]> {
  const rows = await db
    .select({ event: gameEvents, authorName: users.displayName })
    .from(gameEvents)
    .leftJoin(users, eq(users.id, gameEvents.authorId))
    .where(
      and(
        eq(gameEvents.gameId, gameId),
        gt(gameEvents.id, options.after ?? 0),
        options.includeMaster ? undefined : eq(gameEvents.visibility, 'public'),
      ),
    )
    .orderBy(asc(gameEvents.id));
  return rows.map(({ event, authorName }) => toEvent(event, authorName));
}

/** Partida vista por `user`: 404 si no existe o si no es miembro de su campaña. */
async function findGame(
  db: Executor,
  user: PublicUser,
  gameId: string,
  lock = false,
): Promise<FoundGame> {
  const query = db
    .select({
      game: games,
      campaignName: campaigns.name,
      screenToken: campaigns.screenToken,
      role: campaignMembers.role,
    })
    .from(games)
    .innerJoin(campaigns, eq(campaigns.id, games.campaignId))
    .innerJoin(
      campaignMembers,
      and(eq(campaignMembers.campaignId, games.campaignId), eq(campaignMembers.userId, user.id)),
    )
    .where(eq(games.id, gameId));
  const [found] = lock ? await query.for('update', { of: games }) : await query;
  if (!found) throw notFound(GAME_NOT_FOUND);
  return found;
}

async function findRollingCharacters(
  tx: Transaction,
  campaignId: string,
  ids: string[],
): Promise<Map<string, RollingCharacter & { ownerId: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(characters)
    .where(and(eq(characters.campaignId, campaignId), inArray(characters.id, ids)));
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        ownerId: row.ownerId,
        build: {
          name: row.name,
          background: row.background,
          attributes: row.attributes,
          skills: row.skills,
          advancedSkills: row.advancedSkills,
        },
        wounds: { scratches: row.scratches, severity: row.severity },
      },
    ]),
  );
}

export function registerGameRoutes(
  app: FastifyInstance,
  { db, hub, random, ai }: AppContext,
): void {
  /**
   * Añade un evento a una partida en juego y lo reparte en vivo. La fila de la partida queda
   * bloqueada durante la transacción: así los eventos de una partida se guardan en orden y
   * nadie añade nada a una partida que se está cerrando.
   */
  async function addEvent(
    user: PublicUser,
    gameId: string,
    action: (
      tx: Transaction,
      found: FoundGame,
    ) => Promise<{ visibility: GameEventVisibility; payload: GameEventPayload }>,
  ): Promise<{ event: GameEvent; found: FoundGame }> {
    const { row, found } = await db.transaction(async (tx) => {
      const found = await findGame(tx, user, gameId, true);
      if (found.game.status !== 'open') throw new HttpError(409, GAME_CLOSED);
      const { visibility, payload } = await action(tx, found);
      const [row] = await tx
        .insert(gameEvents)
        .values({ gameId, visibility, authorId: user.id, payload })
        .returning();
      if (!row) throw new Error('La base de datos no devolvió el evento creado');
      return { row, found };
    });
    const event = toEvent(row, user.displayName);
    hub.publish(found.game.campaignId, event);
    return { event, found };
  }

  const requireMasterOf = (found: FoundGame) => {
    if (found.role !== 'master') throw forbidden(MASTER_ONLY);
  };

  app.get<{ Params: IdParams }>('/api/campaigns/:id/games', async (request) => {
    const user = requireUser(request);
    const campaignId = parseId(request.params.id, CAMPAIGN_NOT_FOUND);
    await requireMember(db, campaignId, user);
    const rows = await db
      .select()
      .from(games)
      .where(eq(games.campaignId, campaignId))
      .orderBy(desc(games.number));
    return { games: rows.map(toSummary) };
  });

  app.post<{ Params: IdParams }>('/api/campaigns/:id/games', async (request, reply) => {
    const user = requireUser(request);
    const campaignId = parseId(request.params.id, CAMPAIGN_NOT_FOUND);
    await requireMaster(db, campaignId, user);
    const body = parseBody(openGameSchema, request.body, 'Revisa los datos de la partida');

    let created: { game: GameRow; event: EventRow };
    try {
      created = await db.transaction(async (tx) => {
        // Bloquea la campaña para que dos aperturas a la vez no se lleven el mismo número.
        await tx
          .select({ id: campaigns.id })
          .from(campaigns)
          .where(eq(campaigns.id, campaignId))
          .for('update');
        const [open] = await tx
          .select({ id: games.id })
          .from(games)
          .where(and(eq(games.campaignId, campaignId), eq(games.status, 'open')));
        if (open) throw new HttpError(409, 'Ya hay una partida en juego en esta campaña');

        const [last] = await tx
          .select({ number: max(games.number) })
          .from(games)
          .where(eq(games.campaignId, campaignId));
        const number = (last?.number ?? 0) + 1;
        const [game] = await tx
          .insert(games)
          .values({ campaignId, number, title: body.title })
          .returning();
        if (!game) throw new Error('La base de datos no devolvió la partida creada');

        if (body.refillLuck) {
          await tx
            .update(characters)
            .set({ luck: LUCK_PER_SESSION, updatedAt: new Date() })
            .where(eq(characters.campaignId, campaignId));
        }
        const [event] = await tx
          .insert(gameEvents)
          .values({
            gameId: game.id,
            visibility: 'public',
            authorId: user.id,
            payload: { kind: 'opened', number, title: body.title, luckRefilled: body.refillLuck },
          })
          .returning();
        if (!event) throw new Error('La base de datos no devolvió el evento creado');
        return { game, event };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(409, 'Ya hay una partida en juego en esta campaña');
      }
      throw error;
    }

    hub.publish(campaignId, toEvent(created.event, user.displayName));
    const game = toDetail(await findGame(db, user, created.game.id));
    return reply.status(201).send({ game });
  });

  app.get<{ Params: IdParams }>('/api/games/:id', async (request): Promise<GameState> => {
    const user = requireUser(request);
    const found = await findGame(db, user, parseId(request.params.id, GAME_NOT_FOUND));
    const events = await findEvents(db, found.game.id, { includeMaster: found.role === 'master' });
    return { game: toDetail(found), events };
  });

  app.get<{ Params: IdParams; Querystring: StreamQuery }>(
    '/api/games/:id/stream',
    async (request, reply) => {
      const user = requireUser(request);
      const found = await findGame(db, user, parseId(request.params.id, GAME_NOT_FOUND));
      const includeMaster = found.role === 'master';
      const after = lastEventId(request);
      let catchUp = (from: number) => findEvents(db, found.game.id, { after: from, includeMaster });

      if (found.game.status === 'closed') {
        // Una partida terminada ya no cambia: sin nada pendiente, 204 le dice al navegador
        // que no vuelva a conectar; si queda algo, se envía y se corta tras el cierre.
        const missed = await catchUp(after);
        if (missed.length === 0) return reply.status(204).send();
        catchUp = async () => missed;
      }
      openEventStream(request, reply, {
        hub,
        subscriber: {
          campaignId: found.game.campaignId,
          gameId: found.game.id,
          userId: user.id,
          seesMasterEvents: includeMaster,
        },
        after,
        catchUp,
        isLast: (event) => event.kind === 'closed',
      });
      return reply;
    },
  );

  app.post<{ Params: IdParams }>('/api/games/:id/reveals', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(revealSchema, request.body, 'Revisa lo que quieres enseñar');
    const { event } = await addEvent(user, gameId, async (_tx, found) => {
      requireMasterOf(found);
      return { visibility: 'public', payload: { kind: 'reveal', ...body } };
    });
    return reply.status(201).send({ event });
  });

  app.post<{ Params: IdParams }>('/api/games/:id/notes', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(noteSchema, request.body, 'Revisa la nota');
    const { event } = await addEvent(user, gameId, async (_tx, found) => {
      requireMasterOf(found);
      return { visibility: 'master', payload: { kind: 'note', text: body.text } };
    });
    return reply.status(201).send({ event });
  });

  app.post<{ Params: IdParams }>('/api/games/:id/speeches', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(speechSchema, request.body, 'Revisa lo que dice el PNJ');
    const { event } = await addEvent(user, gameId, async (tx, found) => {
      requireMasterOf(found);
      const [npc] = await tx
        .select({ id: npcs.id, name: npcs.name })
        .from(npcs)
        .where(and(eq(npcs.id, body.npcId), eq(npcs.campaignId, found.game.campaignId)));
      if (!npc) throw notFound('Ese PNJ no está en esta campaña');
      return {
        visibility: 'public',
        payload: { kind: 'speech', npcId: npc.id, name: npc.name, text: body.text },
      };
    });
    return reply.status(201).send({ event });
  });

  app.post<{ Params: IdParams }>('/api/games/:id/rolls', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(gameRollSchema, request.body, 'Revisa la tirada');
    const sides =
      body.target.kind === 'opposed' ? [body.actor, body.target.opponent] : [body.actor];

    const { event } = await addEvent(user, gameId, async (tx, found) => {
      const isMaster = found.role === 'master';
      if (body.secret && !isMaster) throw forbidden('Solo el máster hace tiradas secretas');
      if (!isMaster && sides.some((side) => side.kind === 'free')) {
        throw forbidden('Solo el máster tira por los personajes que no son de nadie');
      }

      const ids = sides.flatMap((side) => (side.kind === 'character' ? [side.characterId] : []));
      const rolling = await findRollingCharacters(tx, found.game.campaignId, ids);
      for (const id of ids) {
        const character = rolling.get(id);
        if (!character) throw notFound('Ese personaje no está en esta campaña');
        if (!isMaster && character.ownerId !== user.id) {
          throw forbidden('Solo puedes tirar con tus personajes');
        }
      }

      const roll = resolveGameRoll(body, rolling, random);
      return { visibility: body.secret ? 'master' : 'public', payload: { kind: 'roll', roll } };
    });
    return reply.status(201).send({ event });
  });

  app.post<{ Params: IdParams }>('/api/games/:id/close', async (request) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(closeGameSchema, request.body, 'Revisa el cierre de la partida');
    const { event } = await addEvent(user, gameId, async (tx, found) => {
      requireMasterOf(found);
      const now = new Date();
      await tx.update(games).set({ status: 'closed', closedAt: now }).where(eq(games.id, gameId));
      const xpAwarded = body.awardXp ? XP_AWARDS.perSession : 0;
      if (xpAwarded > 0) {
        await tx
          .update(characters)
          .set({ xp: sql`${characters.xp} + ${xpAwarded}`, updatedAt: now })
          .where(eq(characters.campaignId, found.game.campaignId));
      }
      return { visibility: 'public', payload: { kind: 'closed', xpAwarded } };
    });
    return { game: toDetail(await findGame(db, user, gameId)), event };
  });

  /** El máster deja el resumen de una partida terminada; vacío, la deja sin él. Lo ve la mesa. */
  app.put<{ Params: IdParams }>('/api/games/:id/recap', async (request) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(recapSchema, request.body, 'Revisa el resumen');
    const found = await findGame(db, user, gameId);
    requireMasterOf(found);
    if (found.game.status === 'open') throw new HttpError(409, GAME_STILL_OPEN);
    await db.update(games).set({ recap: body.recap }).where(eq(games.id, gameId));
    return { game: toDetail(await findGame(db, user, gameId)) };
  });

  /**
   * La IA propone un resumen de la partida a partir de su registro, en directo como la charla
   * con un PNJ. No se guarda: el máster lo revisa antes de enseñarlo.
   */
  app.post<{ Params: IdParams }>('/api/games/:id/recap/draft', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(recapDraftSchema, request.body, 'Revisa lo que añades al resumen');
    const found = await findGame(db, user, gameId);
    requireMasterOf(found);
    if (found.game.status === 'open') throw new HttpError(409, GAME_STILL_OPEN);
    const model = requireAi(ai);

    // Las tiradas secretas se quedan fuera; las notas, si el máster lo prefiere.
    const events = (await findEvents(db, gameId, { includeMaster: true })).filter(
      (event) => event.visibility === 'public' || (body.useNotes && event.kind === 'note'),
    );
    if (!hasLog(events) && !body.hint) {
      throw new HttpError(
        409,
        'No hay nada que resumir: el registro de la partida está vacío. Cuenta a la IA qué pasó o escribe tú el resumen.',
      );
    }
    const { campaignId } = found.game;
    const context = await findCampaignContext(db, campaignId);
    // Borrada justo entre medias.
    if (!context) throw notFound(GAME_NOT_FOUND);
    const [previous] = await findRecaps(db, campaignId, { before: found.game.number, limit: 1 });

    return sendAiText(request, reply, {
      ai: model,
      request: {
        messages: recapMessages({
          ...context,
          game: found.game,
          previous,
          events,
          hint: body.hint,
        }),
        temperature: 0.5,
        maxTokens: 800,
        timeoutMs: RECAP_TIMEOUT_MS,
      },
      visible: visibleRecap,
      finish: cleanRecap,
      cutMessage: 'Se cortó el resumen de la partida',
    });
  });

  /** Una partida en juego que dirige `user`, con la IA lista: para pedirle ayuda al narrar. */
  async function findNarratedGame(user: PublicUser, gameId: string) {
    const found = await findGame(db, user, gameId);
    requireMasterOf(found);
    if (found.game.status !== 'open') throw new HttpError(409, GAME_CLOSED);
    const model = requireAi(ai);
    const context = await findCampaignContext(db, found.game.campaignId);
    // Borrada justo entre medias.
    if (!context) throw notFound(GAME_NOT_FOUND);
    return { found, model, context };
  }

  /**
   * La IA convierte las notas del máster en la descripción de una escena, en directo. No se
   * enseña nada: el máster la retoca y decide si la enseña a la mesa.
   */
  app.post<{ Params: IdParams }>('/api/games/:id/reveals/draft', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(revealDraftSchema, request.body, 'Revisa las notas para la IA');
    const { model, context } = await findNarratedGame(user, gameId);
    const scenes = await findScenes(db, gameId, RECENT_SCENES);

    return sendAiText(request, reply, {
      ai: model,
      request: {
        messages: sceneMessages({ ...context, scenes, title: body.title, notes: body.notes }),
        temperature: 0.8,
        maxTokens: 350,
      },
      visible: visibleScene,
      finish: cleanScene,
      cutMessage: 'Se cortó la descripción de la escena',
    });
  });

  /**
   * La IA propone complicaciones para una tirada con éxito con coste, fallo o pifia, en
   * directo: una idea por línea según las termina. No se enseña nada: el máster elige.
   */
  app.post<{ Params: IdParams & { eventId: string } }>(
    '/api/games/:id/rolls/:eventId/complications',
    async (request, reply) => {
      const user = requireUser(request);
      const gameId = parseId(request.params.id, GAME_NOT_FOUND);
      const body = parseBody(complicationsSchema, request.body, 'Revisa lo que intentaba');
      const { model, context } = await findNarratedGame(user, gameId);
      const eventId = Number(request.params.eventId);
      const [row] = isEventId(eventId)
        ? await db
            .select({ payload: gameEvents.payload })
            .from(gameEvents)
            .where(and(eq(gameEvents.id, eventId), eq(gameEvents.gameId, gameId)))
        : [];
      if (row?.payload.kind !== 'roll') throw notFound(ROLL_NOT_FOUND);
      const { roll } = row.payload;
      if (!needsComplication(roll.result.outcome)) throw new HttpError(409, ROLL_WENT_WELL);
      const scenes = await findScenes(db, gameId, RECENT_SCENES);

      return sendAiText(request, reply, {
        ai: model,
        request: {
          messages: complicationMessages({ ...context, scenes, roll, intent: body.intent }),
          format: IDEAS_FORMAT,
          temperature: 0.9,
          maxTokens: 450,
        },
        visible: visibleIdeas,
        finish: cleanIdeas,
        cutMessage: 'Se cortaron las complicaciones',
      });
    },
  );

  /**
   * La IA propone qué puede pasar ahora en la escena, para cuando la mesa se atasca: una idea
   * por línea según las termina. No se enseña nada: el máster elige.
   */
  app.post<{ Params: IdParams }>('/api/games/:id/ideas', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(ideasSchema, request.body, 'Revisa lo que buscas');
    const { found, model, context } = await findNarratedGame(user, gameId);
    const { campaignId } = found.game;
    const scenes = await findScenes(db, gameId, RECENT_SCENES);
    const recaps = await findRecaps(db, campaignId);
    const npcLines = await findNpcLines(db, campaignId);

    return sendAiText(request, reply, {
      ai: model,
      request: {
        messages: ideaMessages({ ...context, recaps, npcs: npcLines, scenes, hint: body.hint }),
        format: IDEAS_FORMAT,
        temperature: 0.9,
        maxTokens: 450,
      },
      visible: visibleIdeas,
      finish: cleanIdeas,
      cutMessage: 'Se cortaron las ideas',
    });
  });

  // Pantalla de la mesa: sin sesión, con el enlace secreto de la campaña. Solo lo público.

  async function findScreenCampaign(token: string) {
    if (!SCREEN_TOKEN_PATTERN.test(token)) throw notFound(SCREEN_NOT_FOUND);
    const [campaign] = await db
      .select({ id: campaigns.id, name: campaigns.name })
      .from(campaigns)
      .where(eq(campaigns.screenToken, token));
    if (!campaign) throw notFound(SCREEN_NOT_FOUND);
    return campaign;
  }

  /** La partida en juego o, si no hay, la última que se jugó. */
  async function latestGame(campaignId: string): Promise<GameRow | undefined> {
    const [game] = await db
      .select()
      .from(games)
      .where(eq(games.campaignId, campaignId))
      .orderBy(desc(games.number))
      .limit(1);
    return game;
  }

  app.get<{ Params: TokenParams }>('/api/screens/:token', async (request): Promise<ScreenState> => {
    const campaign = await findScreenCampaign(request.params.token);
    const game = await latestGame(campaign.id);
    return {
      campaignName: campaign.name,
      game: game ? toSummary(game) : null,
      events: game ? await findEvents(db, game.id, { includeMaster: false }) : [],
    };
  });

  app.get<{ Params: TokenParams; Querystring: StreamQuery }>(
    '/api/screens/:token/stream',
    async (request, reply) => {
      const { id: campaignId } = await findScreenCampaign(request.params.token);
      openEventStream(request, reply, {
        hub,
        // Sin partida fija: la pantalla pasa sola a la siguiente cuando el máster la abre.
        subscriber: { campaignId, gameId: null, userId: null, seesMasterEvents: false },
        after: lastEventId(request),
        async catchUp(after) {
          const game = await latestGame(campaignId);
          return game ? findEvents(db, game.id, { after, includeMaster: false }) : [];
        },
      });
      return reply;
    },
  );
}
