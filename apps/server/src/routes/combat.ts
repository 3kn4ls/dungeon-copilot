import {
  byInitiative,
  endCombatSchema,
  joinCombat,
  joinCombatSchema,
  leaveCombat,
  leaveCombatSchema,
  nextTurn,
  nextTurnSchema,
  startCombatSchema,
  turnOf,
  type CharacterRef,
  type Combatant,
} from '@dungeon-copilot/shared';
import { and, eq, gt, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import type { Executor } from '../db';
import { characters } from '../db/schema';
import { enterCombat, findCombat, requireCombat } from '../games/combat';
import { GAME_NOT_FOUND, createAddEvent, requireMasterOf, type FoundGame } from '../games/events';
import { figuresInCombat } from '../games/maps';
import { answeredIntervention } from '../games/pending';
import { HttpError, forbidden, notFound, parseBody, parseId } from '../http/errors';
import { requireUser } from './auth';

interface IdParams {
  id: string;
}

/** Si `userId` juega con quien pelea: solo si es un personaje suyo. */
async function playsWith(
  db: Executor,
  found: FoundGame,
  combatant: Combatant,
  userId: string,
): Promise<boolean> {
  if (combatant.kind !== 'character') return false;
  const [character] = await db
    .select({ ownerId: characters.ownerId })
    .from(characters)
    .where(and(eq(characters.id, combatant.id), eq(characters.campaignId, found.game.campaignId)));
  return character?.ownerId === userId;
}

/**
 * El combate por rondas. El máster lo empieza con quien pelea y el servidor tira la iniciativa
 * por todos; los turnos pasan en ese orden, quien se une tira al llegar y, al terminar, se puede
 * recuperar el aliento. Todo son eventos públicos de la partida, que se guardan y se reparten
 * con `addEvent`.
 */
export function registerCombatRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { random } = ctx;
  const addEvent = createAddEvent(ctx);

  /** El máster empieza un combate: elige quién pelea y el servidor tira la iniciativa. */
  app.post<{ Params: IdParams }>('/api/games/:id/combat', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(startCombatSchema, request.body, 'Revisa quién pelea');
    const { event } = await addEvent(user, gameId, async (tx, found) => {
      requireMasterOf(found);
      if (await findCombat(tx, gameId)) {
        throw new HttpError(409, 'Ya hay un combate en juego: termínalo antes de empezar otro');
      }
      await answeredIntervention(tx, gameId, body.answers);
      const order = await enterCombat(tx, found, body.combatants, [], random);
      const placed = await figuresInCombat(tx, gameId, body.combatants, order);
      return {
        visibility: 'public',
        payload: {
          kind: 'combatStarted',
          order: [...order].sort(byInitiative),
          answers: body.answers,
          placed,
        },
      };
    });
    return reply.status(201).send({ event });
  });

  /**
   * Termina un turno y le toca al siguiente, o al primero en otra ronda. Lo termina el máster o
   * quien juega con el personaje al que le toca.
   */
  app.post<{ Params: IdParams }>('/api/games/:id/combat/turn', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(nextTurnSchema, request.body, 'Revisa qué turno termina');
    const { event } = await addEvent(user, gameId, async (tx, found) => {
      const combat = await requireCombat(tx, gameId);
      const current = turnOf(combat);
      // Dos a la vez (el máster y el jugador) no se saltan un turno: el segundo llega tarde.
      if (combat.round !== body.round || current.id !== body.combatantId) {
        throw new HttpError(409, 'Ese turno ya ha terminado');
      }
      if (found.role !== 'master' && !(await playsWith(tx, found, current, user.id))) {
        throw forbidden(`No es tu turno: le toca a ${current.name}`);
      }
      const next = nextTurn(combat);
      const holder = turnOf({ ...combat, ...next });
      return {
        visibility: 'public',
        payload: { kind: 'turn', ...next, combatant: { id: holder.id, name: holder.name } },
      };
    });
    return reply.status(201).send({ event });
  });

  /** Se unen al combate refuerzos o un personaje que llega tarde: tiran la iniciativa al llegar. */
  app.post<{ Params: IdParams }>('/api/games/:id/combat/join', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(joinCombatSchema, request.body, 'Revisa quién se une al combate');
    const { event } = await addEvent(user, gameId, async (tx, found) => {
      requireMasterOf(found);
      const combat = await requireCombat(tx, gameId);
      await answeredIntervention(tx, gameId, body.answers);
      const joined = await enterCombat(tx, found, body.combatants, combat.order, random);
      const placed = await figuresInCombat(tx, gameId, body.combatants, joined);
      return {
        visibility: 'public',
        payload: {
          kind: 'combatJoined',
          joined: [...joined].sort(byInitiative),
          answers: body.answers,
          placed,
          ...joinCombat(combat, joined),
        },
      };
    });
    return reply.status(201).send({ event });
  });

  /** Sale del combate alguien que cae o huye. Si era su turno, le toca al siguiente. */
  app.post<{ Params: IdParams }>('/api/games/:id/combat/leave', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(leaveCombatSchema, request.body, 'Revisa quién sale del combate');
    const { event } = await addEvent(user, gameId, async (tx, found) => {
      requireMasterOf(found);
      const combat = await requireCombat(tx, gameId);
      const leaving = combat.order.find((combatant) => combatant.id === body.combatantId);
      if (!leaving) throw notFound('Quien quieres sacar no está en el combate');
      if (combat.order.length === 1) {
        throw new HttpError(409, `Solo queda ${leaving.name} en el combate: termínalo`);
      }
      return {
        visibility: 'public',
        payload: {
          kind: 'combatLeft',
          left: { id: leaving.id, name: leaving.name },
          ...leaveCombat(combat, leaving.id),
        },
      };
    });
    return reply.status(201).send({ event });
  });

  /**
   * El máster termina el combate y se vuelve a narrar. Si recuperan el aliento, se borran los
   * rasguños de los personajes que siguen en el combate.
   */
  app.post<{ Params: IdParams }>('/api/games/:id/combat/end', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(endCombatSchema, request.body, 'Revisa cómo termina el combate');
    const { event } = await addEvent(user, gameId, async (tx, found) => {
      requireMasterOf(found);
      const combat = await requireCombat(tx, gameId);
      const ids = combat.order.flatMap((c) => (c.kind === 'character' ? [c.id] : []));
      let recovered: CharacterRef[] = [];
      if (body.recover && ids.length > 0) {
        const rows = await tx
          .update(characters)
          .set({ scratches: 0, updatedAt: new Date() })
          .where(
            and(
              eq(characters.campaignId, found.game.campaignId),
              inArray(characters.id, ids),
              gt(characters.scratches, 0),
            ),
          )
          .returning({ characterId: characters.id, name: characters.name });
        recovered = rows.sort((a, b) => ids.indexOf(a.characterId) - ids.indexOf(b.characterId));
      }
      return {
        visibility: 'public',
        payload: { kind: 'combatEnded', rounds: combat.round, recovered },
      };
    });
    return reply.status(201).send({ event });
  });
}
