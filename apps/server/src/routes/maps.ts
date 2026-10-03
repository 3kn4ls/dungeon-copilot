import { canStand, insideGrid } from '@dungeon-copilot/rules';
import {
  groupSize,
  mapSchema,
  memberName,
  pingSchema,
  placeTokenSchema,
  setGameMapSchema,
  tokenKey,
  turnOf,
  updateMapSchema,
  type MapView,
  type PublicUser,
} from '@dungeon-copilot/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import type { Executor } from '../db';
import { campaignMembers, maps } from '../db/schema';
import { findCombat, requireCombat } from '../games/combat';
import {
  GAME_CLOSED,
  GAME_NOT_FOUND,
  MASTER_ONLY,
  createAddEvent,
  findCampaignCharacter,
  findGame,
  requireMasterOf,
} from '../games/events';
import { findMap, requireMap } from '../games/maps';
import { HttpError, forbidden, notFound, parseBody, parseId } from '../http/errors';
import { CAMPAIGN_NOT_FOUND, requireMaster } from './access';
import { requireUser } from './auth';

interface IdParams {
  id: string;
}

type MapRow = typeof maps.$inferSelect;

const MAP_NOT_FOUND = 'Ese mapa no existe o no es de tus campañas';

function toView(row: MapRow): MapView {
  return {
    id: row.id,
    campaignId: row.campaignId,
    name: row.name,
    grid: row.grid,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Los mapas son del máster: 404 a quien no es de la campaña y 403 a los jugadores. */
async function findCampaignMap(db: Executor, user: PublicUser, id: string): Promise<MapRow> {
  const [found] = await db
    .select({ map: maps, role: campaignMembers.role })
    .from(maps)
    .innerJoin(
      campaignMembers,
      and(eq(campaignMembers.campaignId, maps.campaignId), eq(campaignMembers.userId, user.id)),
    )
    .where(eq(maps.id, id));
  if (!found) throw notFound(MAP_NOT_FOUND);
  if (found.role !== 'master') throw forbidden('Solo el máster de la campaña ve sus mapas');
  return found.map;
}

/**
 * Los mapas de combate. El máster los prepara en la campaña y pone uno en la partida, guardado
 * como era entonces (`map`). Las fichas se ponen, se mueven y se quitan (`token`): el máster,
 * todas; cada jugador, la de su personaje y, en combate, en su turno. Las que el máster esconde
 * son eventos solo suyos hasta que las enseña. Señalar una casilla no es un evento: se reparte
 * por el directo y no se guarda.
 */
export function registerMapRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub } = ctx;
  const addEvent = createAddEvent(ctx);

  app.get<{ Params: IdParams }>('/api/campaigns/:id/maps', async (request) => {
    const user = requireUser(request);
    const campaignId = parseId(request.params.id, CAMPAIGN_NOT_FOUND);
    await requireMaster(db, campaignId, user);
    const rows = await db
      .select()
      .from(maps)
      .where(eq(maps.campaignId, campaignId))
      .orderBy(asc(sql`lower(${maps.name})`), asc(maps.createdAt));
    return { maps: rows.map(toView) };
  });

  app.post<{ Params: IdParams }>('/api/campaigns/:id/maps', async (request, reply) => {
    const user = requireUser(request);
    const campaignId = parseId(request.params.id, CAMPAIGN_NOT_FOUND);
    const body = parseBody(mapSchema, request.body, 'Revisa el mapa');
    await requireMaster(db, campaignId, user);
    const [row] = await db
      .insert(maps)
      .values({ campaignId, ...body })
      .returning();
    if (!row) throw new Error('La base de datos no devolvió el mapa creado');
    return reply.status(201).send({ map: toView(row) });
  });

  app.get<{ Params: IdParams }>('/api/maps/:id', async (request) => {
    const user = requireUser(request);
    const map = await findCampaignMap(db, user, parseId(request.params.id, MAP_NOT_FOUND));
    return { map: toView(map) };
  });

  app.patch<{ Params: IdParams }>('/api/maps/:id', async (request) => {
    const user = requireUser(request);
    const id = parseId(request.params.id, MAP_NOT_FOUND);
    const body = parseBody(updateMapSchema, request.body, 'Revisa el mapa');
    await findCampaignMap(db, user, id);
    const [row] = await db
      .update(maps)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(maps.id, id))
      .returning();
    // Borrado justo entre medias por otra pestaña.
    if (!row) throw notFound(MAP_NOT_FOUND);
    return { map: toView(row) };
  });

  /** Borrar un mapa no cambia las partidas que lo usaron: guardaron el suyo. */
  app.delete<{ Params: IdParams }>('/api/maps/:id', async (request, reply) => {
    const user = requireUser(request);
    const id = parseId(request.params.id, MAP_NOT_FOUND);
    await findCampaignMap(db, user, id);
    await db.delete(maps).where(eq(maps.id, id));
    return reply.status(204).send();
  });

  /** El máster pone un mapa de la campaña en la partida, o lo quita. Las fichas empiezan de cero. */
  app.put<{ Params: IdParams }>('/api/games/:id/map', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(setGameMapSchema, request.body, 'Revisa qué mapa pones');
    const { event } = await addEvent(user, gameId, async (tx, found) => {
      requireMasterOf(found);
      if (body.mapId === null) {
        if (!(await findMap(tx, gameId))) throw new HttpError(409, 'No hay ningún mapa que quitar');
        return { visibility: 'public', payload: { kind: 'map', map: null } };
      }
      const [row] = await tx
        .select()
        .from(maps)
        .where(and(eq(maps.id, body.mapId), eq(maps.campaignId, found.game.campaignId)));
      if (!row) throw notFound('Ese mapa no existe o no es de esta campaña');
      return {
        visibility: 'public',
        payload: { kind: 'map', map: { id: row.id, name: row.name, grid: row.grid } },
      };
    });
    return reply.status(201).send({ event });
  });

  /** Señalar una casilla del mapa en juego: la ve toda la mesa un momento. */
  app.post<{ Params: IdParams }>('/api/games/:id/pings', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const { at } = parseBody(pingSchema, request.body, 'Revisa qué casilla señalas');
    const found = await findGame(db, user, gameId);
    if (found.game.status !== 'open') throw new HttpError(409, GAME_CLOSED);
    const map = await requireMap(db, gameId);
    if (!insideGrid(map.grid, at)) throw new HttpError(409, 'Esa casilla no está en el mapa');
    hub.signal(found.game.campaignId, gameId, { at, by: user.displayName });
    return reply.status(204).send();
  });

  /**
   * Poner, mover o quitar una ficha del mapa en juego. El máster mueve todas y esconde las que la
   * mesa aún no ve (no los personajes, ni lo que la mesa ya ha visto: eso se quita). Cada jugador
   * mueve la de su personaje, a la vista y, si pelea, en su turno.
   */
  app.post<{ Params: IdParams }>('/api/games/:id/tokens', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(placeTokenSchema, request.body, 'Revisa la ficha');
    const { event } = await addEvent(user, gameId, async (tx, found) => {
      const master = found.role === 'master';
      const { token, at, hidden } = body;
      const map = await requireMap(tx, gameId);
      const placed = map.tokens.find((other) => tokenKey(other.token) === tokenKey(token));
      if (at === null && !placed) throw notFound('Esa ficha no está en el mapa');
      if (at && !canStand(map.grid, at)) {
        throw new HttpError(409, 'Ahí no se puede estar: es un muro, una ventana o un mueble');
      }
      if (hidden) {
        if (!master) throw forbidden('Solo el máster esconde fichas');
        if (token.kind === 'character') {
          throw new HttpError(409, 'Los personajes no se esconden: su jugador sabe dónde están');
        }
        if (placed && !placed.hidden) {
          throw new HttpError(409, 'La mesa ya ve esa ficha: quítala del mapa antes de esconderla');
        }
      }

      let name: string;
      switch (token.kind) {
        case 'character': {
          const character = await findCampaignCharacter(tx, found, token.id);
          if (!master) {
            if (character.ownerId !== user.id) {
              throw forbidden('Solo puedes mover la ficha de tu personaje');
            }
            const combat = await findCombat(tx, gameId);
            const fighting = combat?.order.some((combatant) => combatant.id === token.id);
            if (combat && fighting && turnOf(combat).id !== token.id) {
              throw new HttpError(409, `${character.name} solo se mueve en su turno`);
            }
          }
          name = character.name;
          break;
        }
        case 'combatant': {
          if (!master) throw forbidden(MASTER_ONLY);
          // Ya en el mapa, se mueve o se quita aunque haya dejado de pelear.
          if (placed) {
            name = placed.name;
            break;
          }
          const combat = await requireCombat(tx, gameId);
          const combatant = combat.order.find(
            (other) => other.id === token.id && other.kind === 'npc',
          );
          if (!combatant || combatant.kind !== 'npc') {
            throw notFound('Quien quieres poner no está en el combate');
          }
          const count = groupSize(combatant);
          if (token.member >= count) {
            throw notFound(`${combatant.name} ${count === 1 ? 'es uno' : `son ${count}`}`);
          }
          name = memberName(combatant, token.member);
          break;
        }
        case 'figure': {
          if (!master) throw forbidden(MASTER_ONLY);
          const given = body.name ?? placed?.name;
          if (!given) throw new HttpError(400, 'Ponle un nombre a la figura');
          name = given;
          break;
        }
      }

      // Lo oculto sigue oculto si se quita: la mesa nunca lo vio. Moverlo sin esconderlo lo enseña.
      const secret = hidden || (at === null && placed?.hidden === true);
      return {
        visibility: secret ? 'master' : 'public',
        payload: { kind: 'token', token, name, at },
      };
    });
    return reply.status(201).send({ event });
  });
}
