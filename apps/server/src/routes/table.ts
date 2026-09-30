import {
  answerInterventionSchema,
  askRollSchema,
  giveFloorSchema,
  interventionSchema,
  type Floor,
  type RequestedRoll,
} from '@dungeon-copilot/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { findBlow, findCombatTarget } from '../games/combat';
import {
  CHARACTER_NOT_HERE,
  GAME_NOT_FOUND,
  createAddEvent,
  findCampaignCharacter,
  findRollingCharacters,
  findVisibleEvent,
  requireMasterOf,
  viewerOf,
} from '../games/events';
import {
  INTERVENTION_NOT_FOUND,
  ROLL_REQUEST_NOT_FOUND,
  answeredIntervention,
  findPendingInterventionOf,
  pendingIntervention,
  requirePending,
} from '../games/pending';
import { planGameRoll, resolveGameRoll } from '../games/rolls';
import { HttpError, forbidden, notFound, parseBody, parseId } from '../http/errors';
import { requireUser } from './auth';

interface IdParams {
  id: string;
}

interface EventParams extends IdParams {
  eventId: string;
}

const CHARACTER_GONE = 'Ese personaje ya no está en la campaña';

/** Los personajes que tiran en una tirada, primero quien actúa. */
const rollingIds = (roll: RequestedRoll): string[] =>
  (roll.target.kind === 'opposed' ? [roll.actor, roll.target.opponent] : [roll.actor]).flatMap(
    (side) => (side.kind === 'character' ? [side.characterId] : []),
  );

/**
 * La mesa: quién tiene la palabra, lo que piden los jugadores con sus botones y las tiradas que
 * pide el máster. Todo son eventos de la partida: se guardan y se reparten con `addEvent`.
 */
export function registerTableRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { random } = ctx;
  const addEvent = createAddEvent(ctx);

  /** El máster da la palabra: se la queda él, se la da a toda la mesa o a un personaje. */
  app.post<{ Params: IdParams }>('/api/games/:id/floor', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(giveFloorSchema, request.body, 'Revisa a quién das la palabra');
    const { event } = await addEvent(user, gameId, async (tx, found) => {
      requireMasterOf(found);
      await answeredIntervention(tx, gameId, body.answers);
      let floor: Floor;
      if (body.to.kind === 'character') {
        const { characterId, name } = await findCampaignCharacter(tx, found, body.to.characterId);
        floor = { kind: 'character', characterId, name };
      } else {
        floor = body.to;
      }
      return { visibility: 'public', payload: { kind: 'floor', floor, answers: body.answers } };
    });
    return reply.status(201).send({ event });
  });

  /**
   * Un jugador interviene con su personaje: pide la palabra o, si la tiene, interviene. Espera a
   * que el máster la atienda, y cada personaje tiene como mucho una esperando. En combate puede
   * ir contra alguien que pelea.
   */
  app.post<{ Params: IdParams }>('/api/games/:id/interventions', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(interventionSchema, request.body, 'Revisa tu intervención');
    const { event } = await addEvent(user, gameId, async (tx, found) => {
      const character = await findCampaignCharacter(tx, found, body.characterId);
      if (character.ownerId !== user.id) {
        throw forbidden('Solo puedes intervenir con tus personajes');
      }
      if (body.intent === 'spell') {
        const sheet = await findRollingCharacters(tx, found.game.campaignId, [body.characterId]);
        if (!sheet.get(body.characterId)?.build.advancedSkills.includes('sorcery')) {
          throw new HttpError(
            400,
            `${character.name} no puede lanzar hechizos: le falta Hechicería`,
          );
        }
      }
      if (await findPendingInterventionOf(tx, gameId, character.characterId)) {
        throw new HttpError(
          409,
          `${character.name} ya está esperando al máster: retira su intervención si quieres cambiarla`,
        );
      }
      return {
        // En secreto es como pasarle una nota al máster: la ven él y quien la escribe.
        visibility: body.secret ? 'private' : 'public',
        playerId: user.id,
        payload: {
          kind: 'intervention',
          characterId: character.characterId,
          name: character.name,
          intent: body.intent,
          text: body.text,
          target:
            body.targetId === undefined
              ? undefined
              : await findCombatTarget(tx, gameId, body.targetId),
        },
      };
    });
    return reply.status(201).send({ event });
  });

  /** El máster atiende una intervención sin más: la resuelve de palabra o dice «ahora no». */
  app.post<{ Params: EventParams }>(
    '/api/games/:id/interventions/:eventId/answer',
    async (request, reply) => {
      const user = requireUser(request);
      const gameId = parseId(request.params.id, GAME_NOT_FOUND);
      const eventId = Number(request.params.eventId);
      const body = parseBody(answerInterventionSchema, request.body, 'Revisa cómo la atiendes');
      const { event } = await addEvent(user, gameId, async (tx, found) => {
        requireMasterOf(found);
        const row = await pendingIntervention(tx, gameId, eventId);
        // La respuesta la ven los mismos que la intervención.
        return {
          visibility: row.visibility,
          playerId: row.playerId,
          payload: { kind: 'settled', of: row.id, how: body.how },
        };
      });
      return reply.status(201).send({ event });
    },
  );

  /** Quien intervino retira su intervención: ya no espera al máster. */
  app.post<{ Params: EventParams }>(
    '/api/games/:id/interventions/:eventId/withdraw',
    async (request, reply) => {
      const user = requireUser(request);
      const gameId = parseId(request.params.id, GAME_NOT_FOUND);
      const eventId = Number(request.params.eventId);
      const { event } = await addEvent(user, gameId, async (tx, found) => {
        // La intervención en secreto de otro jugador no existe para ti.
        const row = await findVisibleEvent(tx, gameId, eventId, viewerOf(found, user));
        if (row?.payload.kind !== 'intervention') throw notFound(INTERVENTION_NOT_FOUND);
        if (row.authorId !== user.id) throw forbidden('Solo puedes retirar lo que has pedido tú');
        await requirePending(tx, row);
        return {
          visibility: row.visibility,
          playerId: row.playerId,
          payload: { kind: 'settled', of: row.id, how: 'withdrawn' },
        };
      });
      return reply.status(201).send({ event });
    },
  );

  /**
   * El máster pide una tirada a un personaje, que hará su jugador con un botón. Se valida ya,
   * para que no falle al tirar, pero el bonificador sale de la ficha que tenga entonces.
   */
  app.post<{ Params: IdParams }>('/api/games/:id/roll-requests', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(askRollSchema, request.body, 'Revisa la tirada que pides');
    const ids = rollingIds(body.roll);
    const { event } = await addEvent(user, gameId, async (tx, found) => {
      requireMasterOf(found);
      await answeredIntervention(tx, gameId, body.answers);
      // La hace quien actúa o, si es un PNJ, quien se opone: una defensa.
      const [rollerId] = ids;
      if (rollerId === undefined) {
        throw new HttpError(
          400,
          'Una tirada pedida la hace un personaje: elige uno que tire o que se oponga',
        );
      }
      const rolling = await findRollingCharacters(tx, found.game.campaignId, ids);
      if (ids.some((id) => !rolling.has(id))) throw notFound(CHARACTER_NOT_HERE);
      const roller = rolling.get(rollerId)!;
      const blow = body.roll.blow && (await findBlow(tx, gameId, body.roll.blow));
      const { preview } = planGameRoll(body.roll, rolling, blow);
      return {
        // En secreto, la petición y la tirada las ven el máster y el jugador que tira.
        visibility: body.secret ? 'private' : 'public',
        playerId: roller.ownerId,
        payload: {
          kind: 'rollRequest',
          characterId: roller.id,
          name: roller.name,
          request: body.roll,
          preview,
          answers: body.answers,
        },
      };
    });
    return reply.status(201).send({ event });
  });

  /**
   * El jugador hace la tirada que le ha pedido el máster, o el máster por él: con la ficha de
   * ahora, y la ven los mismos que la petición.
   */
  app.post<{ Params: EventParams }>(
    '/api/games/:id/roll-requests/:eventId/roll',
    async (request, reply) => {
      const user = requireUser(request);
      const gameId = parseId(request.params.id, GAME_NOT_FOUND);
      const eventId = Number(request.params.eventId);
      const { event } = await addEvent(user, gameId, async (tx, found) => {
        const row = await findVisibleEvent(tx, gameId, eventId, viewerOf(found, user));
        if (row?.payload.kind !== 'rollRequest') throw notFound(ROLL_REQUEST_NOT_FOUND);
        const { request: roll, characterId, preview } = row.payload;
        const ids = rollingIds(roll);
        const rolling = await findRollingCharacters(tx, found.game.campaignId, ids);
        const roller = rolling.get(characterId);
        if (!roller) throw notFound(CHARACTER_GONE);
        if (found.role !== 'master' && roller.ownerId !== user.id) {
          throw forbidden('Esa tirada se la han pedido a otro personaje');
        }
        await requirePending(tx, row);
        if (ids.some((id) => !rolling.has(id))) throw notFound(CHARACTER_GONE);
        return {
          visibility: row.visibility,
          playerId: row.playerId,
          payload: {
            kind: 'roll',
            // Quién ataca a quién ya se sabe desde que se pidió.
            roll: { ...resolveGameRoll(roll, rolling, random, preview.blow), requested: row.id },
          },
        };
      });
      return reply.status(201).send({ event });
    },
  );

  /** El máster retira una tirada que había pedido y aún no se ha hecho. */
  app.post<{ Params: EventParams }>(
    '/api/games/:id/roll-requests/:eventId/withdraw',
    async (request, reply) => {
      const user = requireUser(request);
      const gameId = parseId(request.params.id, GAME_NOT_FOUND);
      const eventId = Number(request.params.eventId);
      const { event } = await addEvent(user, gameId, async (tx, found) => {
        requireMasterOf(found);
        const row = await findVisibleEvent(tx, gameId, eventId, viewerOf(found, user));
        if (row?.payload.kind !== 'rollRequest') throw notFound(ROLL_REQUEST_NOT_FOUND);
        await requirePending(tx, row);
        return {
          visibility: row.visibility,
          playerId: row.playerId,
          payload: { kind: 'settled', of: row.id, how: 'withdrawn' },
        };
      });
      return reply.status(201).send({ event });
    },
  );
}
