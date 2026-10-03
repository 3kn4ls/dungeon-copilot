import { canStand, insideGrid } from '@dungeon-copilot/rules';
import {
  MAP_IMAGE_LIMITS,
  MAP_IMAGE_MAX_TEXT,
  MAP_IMAGE_TYPES,
  groupSize,
  mapSchema,
  memberName,
  pingSchema,
  placeTokenSchema,
  setGameMapSchema,
  tokenKey,
  turnOf,
  updateMapSchema,
  type MapGrid,
  type MapImageView,
  type MapView,
  type PublicUser,
} from '@dungeon-copilot/shared';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../context';
import type { Executor } from '../db';
import { campaignMembers, mapImages, maps } from '../db/schema';
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
import { IMAGE_NOT_FOUND, collectImages, imageType, requireImage } from '../games/map-images';
import { findMap, requireMap } from '../games/maps';
import { findScreenCampaign } from '../games/screens';
import { HttpError, forbidden, notFound, parseBody, parseId } from '../http/errors';
import { CAMPAIGN_NOT_FOUND, requireMaster } from './access';
import { requireUser } from './auth';

interface IdParams {
  id: string;
}

interface ScreenImageParams extends IdParams {
  token: string;
}

type MapRow = typeof maps.$inferSelect;

const MAP_NOT_FOUND = 'Ese mapa no existe o no es de tus campañas';
const NOT_AN_IMAGE = 'Sube una imagen PNG, JPEG o WebP';

/** Si el mapa lleva plano, tiene que ser de su campaña. */
async function checkBackground(db: Executor, campaignId: string, grid: MapGrid | undefined) {
  if (grid?.background) await requireImage(db, campaignId, grid.background.image);
}

/** Un plano, para el navegador: no cambia nunca, así que se guarda sin volver a pedirlo. */
function sendImage(reply: FastifyReply, image: { contentType: string; data: Buffer }) {
  return reply
    .header('content-type', image.contentType)
    .header('cache-control', 'private, max-age=31536000, immutable')
    .header('x-content-type-options', 'nosniff')
    .send(image.data);
}

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
    await checkBackground(db, campaignId, body.grid);
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
    const map = await findCampaignMap(db, user, id);
    await checkBackground(db, map.campaignId, body.grid);
    const [row] = await db
      .update(maps)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(maps.id, id))
      .returning();
    // Borrado justo entre medias por otra pestaña.
    if (!row) throw notFound(MAP_NOT_FOUND);
    // El plano de antes, si lo ha cambiado, ya no hace falta.
    await collectImages(db, map.campaignId);
    return { map: toView(row) };
  });

  /** Borrar un mapa no cambia las partidas que lo usaron: guardaron el suyo. */
  app.delete<{ Params: IdParams }>('/api/maps/:id', async (request, reply) => {
    const user = requireUser(request);
    const id = parseId(request.params.id, MAP_NOT_FOUND);
    const map = await findCampaignMap(db, user, id);
    await db.delete(maps).where(eq(maps.id, id));
    await collectImages(db, map.campaignId);
    return reply.status(204).send();
  });

  /**
   * El máster sube una imagen como plano: llega tal cual, con su tipo, hasta 5 MB. Se guarda en
   * la campaña y luego se pone de fondo en un mapa. Solo esta ruta acepta imágenes.
   */
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      [...MAP_IMAGE_TYPES],
      { parseAs: 'buffer', bodyLimit: MAP_IMAGE_LIMITS.bytes },
      (_request, body, done) => done(null, body),
    );
    scope.post<{ Params: IdParams }>(
      '/api/campaigns/:id/map-images',
      {
        bodyLimit: MAP_IMAGE_LIMITS.bytes,
        config: {
          errorMessages: {
            FST_ERR_CTP_BODY_TOO_LARGE: `El plano no puede pasar de ${MAP_IMAGE_MAX_TEXT}`,
            FST_ERR_CTP_INVALID_MEDIA_TYPE: NOT_AN_IMAGE,
          },
        },
      },
      async (request, reply) => {
        const user = requireUser(request);
        const campaignId = parseId(request.params.id, CAMPAIGN_NOT_FOUND);
        await requireMaster(db, campaignId, user);
        const data = request.body;
        const contentType = Buffer.isBuffer(data) ? imageType(data) : null;
        if (!Buffer.isBuffer(data) || !contentType) throw new HttpError(400, NOT_AN_IMAGE);
        await collectImages(db, campaignId);
        const [stored] = await db
          .select({ count: count() })
          .from(mapImages)
          .where(eq(mapImages.campaignId, campaignId));
        if ((stored?.count ?? 0) >= MAP_IMAGE_LIMITS.perCampaign) {
          throw new HttpError(
            409,
            `La campaña ya tiene ${MAP_IMAGE_LIMITS.perCampaign} planos: borra los mapas que no uses`,
          );
        }
        const [row] = await db
          .insert(mapImages)
          .values({ campaignId, contentType, size: data.length, data })
          .returning({
            id: mapImages.id,
            contentType: mapImages.contentType,
            size: mapImages.size,
            createdAt: mapImages.createdAt,
          });
        if (!row) throw new Error('La base de datos no devolvió el plano subido');
        const image: MapImageView = { ...row, createdAt: row.createdAt.toISOString() };
        return reply.status(201).send({ image });
      },
    );
  });

  /** Un plano, para quien es de su campaña. */
  app.get<{ Params: IdParams }>('/api/map-images/:id', async (request, reply) => {
    const user = requireUser(request);
    const id = parseId(request.params.id, IMAGE_NOT_FOUND);
    const [image] = await db
      .select({ contentType: mapImages.contentType, data: mapImages.data })
      .from(mapImages)
      .innerJoin(
        campaignMembers,
        and(
          eq(campaignMembers.campaignId, mapImages.campaignId),
          eq(campaignMembers.userId, user.id),
        ),
      )
      .where(eq(mapImages.id, id));
    if (!image) throw notFound(IMAGE_NOT_FOUND);
    return sendImage(reply, image);
  });

  /** Un plano, para la pantalla de su campaña. */
  app.get<{ Params: ScreenImageParams }>(
    '/api/screens/:token/map-images/:id',
    async (request, reply) => {
      const campaign = await findScreenCampaign(db, request.params.token);
      const id = parseId(request.params.id, IMAGE_NOT_FOUND);
      const [image] = await db
        .select({ contentType: mapImages.contentType, data: mapImages.data })
        .from(mapImages)
        .where(and(eq(mapImages.id, id), eq(mapImages.campaignId, campaign.id)));
      if (!image) throw notFound(IMAGE_NOT_FOUND);
      return sendImage(reply, image);
    },
  );

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
