import { LUCK_PER_SESSION, XP_AWARDS } from '@dungeon-copilot/rules';
import {
  closeGameSchema,
  gameRollSchema,
  noteSchema,
  openGameSchema,
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
const MASTER_ONLY = 'Solo el máster de la campaña puede hacer eso';

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

export function registerGameRoutes(app: FastifyInstance, { db, hub, random }: AppContext): void {
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
