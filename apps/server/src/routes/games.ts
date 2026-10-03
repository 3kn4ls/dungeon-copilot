import { LUCK_PER_SESSION, XP_AWARDS, needsComplication } from '@dungeon-copilot/rules';
import {
  characterSides,
  closeGameSchema,
  complicationsSchema,
  gameRollSchema,
  ideasSchema,
  narrationSchema,
  noteSchema,
  openGameSchema,
  recapDraftSchema,
  recapSchema,
  rerollSchema,
  revealDraftSchema,
  revealSchema,
  speechSchema,
  tacticsSchema,
  type CharacterRef,
  type GameState,
  type PublicUser,
  type ScreenState,
} from '@dungeon-copilot/shared';
import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  IDEAS_FORMAT,
  RECENT_SCENES,
  blowMessages,
  cleanIdeas,
  cleanRecap,
  cleanScene,
  complicationMessages,
  damageText,
  gearLine,
  hasLog,
  ideaMessages,
  recapMessages,
  sceneMessages,
  tacticsMessages,
  visibleIdeas,
  visibleRecap,
  visibleScene,
} from '../ai/prompts';
import { requireAi, sendAiText } from '../ai/respond';
import type { AppContext } from '../context';
import type { Transaction } from '../db';
import { isUniqueViolation } from '../db/errors';
import { campaigns, characters, gameEvents, games, npcs } from '../db/schema';
import {
  CHARACTER_NOT_HERE,
  GAME_CLOSED,
  GAME_NOT_FOUND,
  SCREEN_VIEWER,
  createAddEvent,
  findCampaignCharacter,
  findEvents,
  findGame,
  findRollingCharacters,
  findVisibleEvent,
  isEventId,
  requireMasterOf,
  toDetail,
  toEvent,
  toSummary,
  viewerOf,
  type EventRow,
  type FoundGame,
  type GameRow,
} from '../games/events';
import { findBlow, requireCombat } from '../games/combat';
import { answeredIntervention } from '../games/pending';
import {
  findCampaignContext,
  findFighters,
  findNpcKnown,
  findNpcLines,
  findScenes,
  npcFighter,
} from '../games/prompt-context';
import { findRecaps } from '../games/recaps';
import { rerollGameRoll, resolveGameRoll } from '../games/rolls';
import { findSceneTitle } from '../games/scenes';
import { findScreenCampaign } from '../games/screens';
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

const GAME_STILL_OPEN = 'La partida sigue en juego: el resumen se escribe al terminarla';
/**
 * El resumen lee la partida entera: sin GPU, el modelo puede tardar minutos solo en leerla.
 * El máster ya ha terminado de jugar y puede esperar más que a un PNJ.
 */
const RECAP_TIMEOUT_MS = 300_000;
const ROLL_NOT_FOUND = 'Esa tirada no existe en esta partida';
const ROLL_WENT_WELL =
  'Esa tirada salió bien: las complicaciones son para los éxitos con coste, los fallos y las pifias';
const ROLL_REPEATED = 'Esa tirada ya se ha repetido: cuenta la segunda';
const ROLL_DAMAGED = 'Ya se ha aplicado el daño de esa tirada: no se puede repetir';

/**
 * A quién va algo que enseña el máster: a toda la mesa o, con `to`, en secreto a un personaje
 * (lo ven el máster y su jugador).
 */
async function recipient(
  tx: Transaction,
  found: FoundGame,
  to: string | undefined,
): Promise<{ ref?: CharacterRef; playerId: string | null }> {
  if (to === undefined) return { playerId: null };
  const { ownerId, ...ref } = await findCampaignCharacter(tx, found, to);
  return { ref, playerId: ownerId };
}

export function registerGameRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub, random, ai } = ctx;
  const addEvent = createAddEvent(ctx);

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
    const events = await findEvents(db, found.game.id, { viewer: viewerOf(found, user) });
    return { game: toDetail(found), events };
  });

  app.get<{ Params: IdParams; Querystring: StreamQuery }>(
    '/api/games/:id/stream',
    async (request, reply) => {
      const user = requireUser(request);
      const found = await findGame(db, user, parseId(request.params.id, GAME_NOT_FOUND));
      const viewer = viewerOf(found, user);
      const after = lastEventId(request);
      let catchUp = (from: number) => findEvents(db, found.game.id, { after: from, viewer });

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
          seesMasterEvents: viewer.master,
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
    const { event } = await addEvent(user, gameId, async (tx, found) => {
      requireMasterOf(found);
      await answeredIntervention(tx, gameId, body.answers);
      const { ref, playerId } = await recipient(tx, found, body.to);
      return {
        visibility: ref ? 'private' : 'public',
        playerId,
        payload: {
          kind: 'reveal',
          title: body.title,
          body: body.body,
          to: ref,
          answers: body.answers,
        },
      };
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
      await answeredIntervention(tx, gameId, body.answers);
      const { ref, playerId } = await recipient(tx, found, body.to);
      return {
        visibility: ref ? 'private' : 'public',
        playerId,
        payload: {
          kind: 'speech',
          npcId: npc.id,
          name: npc.name,
          text: body.text,
          to: ref,
          answers: body.answers,
        },
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
        if (!character) throw notFound(CHARACTER_NOT_HERE);
        if (!isMaster && character.ownerId !== user.id) {
          throw forbidden('Solo puedes tirar con tus personajes');
        }
      }
      const blow = body.blow && (await findBlow(tx, gameId, body.blow));

      const roll = resolveGameRoll(body, rolling, random, blow);
      return { visibility: body.secret ? 'master' : 'public', payload: { kind: 'roll', roll } };
    });
    return reply.status(201).send({ event });
  });

  /**
   * Un personaje gasta un punto de Suerte para repetir su tirada: vuelve a tirar sus dados y
   * cuenta el segundo resultado. La gastan su jugador o el máster, en las tiradas que ve el
   * jugador: las de toda la mesa y las que son en secreto para él.
   */
  app.post<{ Params: IdParams & { eventId: string } }>(
    '/api/games/:id/rolls/:eventId/reroll',
    async (request, reply) => {
      const user = requireUser(request);
      const gameId = parseId(request.params.id, GAME_NOT_FOUND);
      const eventId = Number(request.params.eventId);
      const body = parseBody(rerollSchema, request.body, 'Revisa qué tirada repites');

      const { event } = await addEvent(user, gameId, async (tx, found) => {
        const isMaster = found.role === 'master';
        // Una tirada secreta no existe para los jugadores; una en secreto, solo para el suyo.
        const row = await findVisibleEvent(tx, gameId, eventId, viewerOf(found, user));
        if (row?.payload.kind !== 'roll') throw notFound(ROLL_NOT_FOUND);
        if (row.visibility === 'master') {
          throw new HttpError(409, 'Las tiradas secretas no se repiten con Suerte');
        }
        const { roll } = row.payload;
        if (body.side === 'opponent' && roll.target.kind !== 'opposed') {
          throw new HttpError(400, 'Esa tirada es contra una dificultad: no tiene rival');
        }
        const side = characterSides(roll).find((candidate) => candidate.side === body.side);
        if (!side) {
          const label = body.side === 'actor' ? roll.actor.label : roll.target.label;
          throw new HttpError(400, `${label} no tiene Suerte: solo la tienen los personajes`);
        }

        const [character] = await tx
          .select({
            id: characters.id,
            name: characters.name,
            ownerId: characters.ownerId,
            luck: characters.luck,
          })
          .from(characters)
          .where(
            and(
              eq(characters.id, side.characterId),
              eq(characters.campaignId, found.game.campaignId),
            ),
          )
          .for('update');
        if (!character) throw notFound('Ese personaje ya no está en la campaña');
        if (!isMaster && character.ownerId !== user.id) {
          throw forbidden('Solo puedes gastar la Suerte de tus personajes');
        }
        if (roll.reroll?.sides.includes(body.side)) {
          throw new HttpError(409, `${side.label} ya ha repetido esta tirada`);
        }
        const [repeated] = await tx
          .select({ id: gameEvents.id })
          .from(gameEvents)
          .where(
            and(
              eq(gameEvents.gameId, gameId),
              sql`${gameEvents.payload} -> 'roll' -> 'reroll' ->> 'of' = ${String(eventId)}`,
            ),
          )
          .limit(1);
        if (repeated) throw new HttpError(409, ROLL_REPEATED);
        const [damaged] = await tx
          .select({ id: gameEvents.id })
          .from(gameEvents)
          .where(
            and(
              eq(gameEvents.gameId, gameId),
              sql`${gameEvents.payload} ->> 'kind' = 'damage'`,
              sql`${gameEvents.payload} ->> 'roll' = ${String(eventId)}`,
            ),
          )
          .limit(1);
        if (damaged) throw new HttpError(409, ROLL_DAMAGED);
        if (character.luck < 1) throw new HttpError(409, `A ${character.name} no le queda Suerte`);

        await tx
          .update(characters)
          .set({ luck: character.luck - 1, updatedAt: new Date() })
          .where(eq(characters.id, character.id));
        // La repetición la ven los mismos que la tirada.
        return {
          visibility: row.visibility,
          playerId: row.playerId,
          payload: { kind: 'roll', roll: rerollGameRoll(roll, eventId, body.side, random) },
        };
      });
      return reply.status(201).send({ event });
    },
  );

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

    // Lo secreto se queda fuera; las notas, si el máster lo prefiere.
    const events = (await findEvents(db, gameId, { viewer: { master: true } })).filter(
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
   * La IA propone cómo contar el golpe de una tirada de combate, con lo que ha causado: una
   * versión por línea según las termina. No se enseña nada: el máster elige.
   */
  app.post<{ Params: IdParams & { eventId: string } }>(
    '/api/games/:id/rolls/:eventId/narration',
    async (request, reply) => {
      const user = requireUser(request);
      const gameId = parseId(request.params.id, GAME_NOT_FOUND);
      const body = parseBody(narrationSchema, request.body, 'Revisa lo que quieres destacar');
      const { found, model, context } = await findNarratedGame(user, gameId);
      const eventId = Number(request.params.eventId);
      const [row] = isEventId(eventId)
        ? await db
            .select({ payload: gameEvents.payload })
            .from(gameEvents)
            .where(and(eq(gameEvents.id, eventId), eq(gameEvents.gameId, gameId)))
        : [];
      if (row?.payload.kind !== 'roll') throw notFound(ROLL_NOT_FOUND);
      const { roll } = row.payload;
      if (roll.situation === 'test') {
        throw new HttpError(409, 'Esa tirada no es de combate: se narran los golpes');
      }
      const blows = await db
        .select({ payload: gameEvents.payload })
        .from(gameEvents)
        .where(
          and(
            eq(gameEvents.gameId, gameId),
            sql`${gameEvents.payload} ->> 'kind' = 'damage'`,
            sql`${gameEvents.payload} ->> 'roll' = ${String(eventId)}`,
          ),
        )
        .orderBy(asc(gameEvents.id));
      // Con qué pelean los personajes de la tirada, sean quien tira, quien se opone o el blanco.
      const ids = [
        roll.actor.characterId,
        roll.target.kind === 'opposed' ? roll.target.characterId : undefined,
        roll.blow?.attacker.id,
        roll.blow?.defender.id,
      ].filter((id): id is string => id !== undefined);
      const armed =
        ids.length === 0
          ? []
          : await db
              .select({ name: characters.name, gear: characters.gear })
              .from(characters)
              .where(
                and(
                  eq(characters.campaignId, found.game.campaignId),
                  inArray(characters.id, [...new Set(ids)]),
                ),
              )
              .orderBy(asc(characters.createdAt));

      return sendAiText(request, reply, {
        ai: model,
        request: {
          messages: blowMessages({
            ...context,
            scenes: await findScenes(db, gameId, RECENT_SCENES),
            scene: await findSceneTitle(db, gameId),
            roll,
            gear: armed.map(({ name, gear }) => gearLine(name, gear)),
            blows: blows.flatMap(({ payload }) =>
              payload.kind === 'damage' ? [damageText(payload)] : [],
            ),
            hint: body.hint,
          }),
          format: IDEAS_FORMAT,
          temperature: 0.9,
          maxTokens: 450,
        },
        visible: visibleIdeas,
        finish: cleanIdeas,
        cutMessage: 'Se cortó la narración del golpe',
      });
    },
  );

  /**
   * La IA propone qué pueden hacer unos PNJ en su turno de combate, sabiendo cómo va cada uno:
   * una idea por línea según las termina. No se enseña nada: el máster elige.
   */
  app.post<{ Params: IdParams }>('/api/games/:id/combat/tactics', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(tacticsSchema, request.body, 'Revisa para quién pides ideas');
    const { found, model, context } = await findNarratedGame(user, gameId);
    const { campaignId } = found.game;
    const combat = await requireCombat(db, gameId);
    const acting = combat.order.find((combatant) => combatant.id === body.combatantId);
    if (acting?.kind !== 'npc') throw notFound('Esos PNJ no están en el combate');

    const fighters = await findFighters(db, campaignId, combat);
    // Lo que sabe el máster del PNJ, si es de la campaña: nunca sus secretos.
    const npc = await findNpcKnown(db, campaignId, acting);

    return sendAiText(request, reply, {
      ai: model,
      request: {
        messages: tacticsMessages({
          ...context,
          scenes: await findScenes(db, gameId, RECENT_SCENES),
          scene: await findSceneTitle(db, gameId),
          round: combat.round,
          fighters,
          acting: { fighter: npcFighter(combat, acting), ...npc },
          hint: body.hint,
        }),
        format: IDEAS_FORMAT,
        temperature: 0.9,
        maxTokens: 450,
      },
      visible: visibleIdeas,
      finish: cleanIdeas,
      cutMessage: 'Se cortaron las ideas para los PNJ',
    });
  });

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
    const campaign = await findScreenCampaign(db, request.params.token);
    const game = await latestGame(campaign.id);
    return {
      campaignName: campaign.name,
      game: game ? toSummary(game) : null,
      events: game ? await findEvents(db, game.id, { viewer: SCREEN_VIEWER }) : [],
    };
  });

  app.get<{ Params: TokenParams; Querystring: StreamQuery }>(
    '/api/screens/:token/stream',
    async (request, reply) => {
      const { id: campaignId } = await findScreenCampaign(db, request.params.token);
      openEventStream(request, reply, {
        hub,
        // Sin partida fija: la pantalla pasa sola a la siguiente cuando el máster la abre.
        subscriber: { campaignId, gameId: null, userId: null, seesMasterEvents: false },
        after: lastEventId(request),
        async catchUp(after) {
          const game = await latestGame(campaignId);
          return game ? findEvents(db, game.id, { after, viewer: SCREEN_VIEWER }) : [];
        },
      });
      return reply;
    },
  );
}
