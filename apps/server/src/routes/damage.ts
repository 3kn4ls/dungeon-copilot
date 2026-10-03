import {
  NPC_PROFILES,
  UNHARMED,
  applyDamage,
  damageNpcs,
  memberDamage,
  scratchBoxes,
} from '@dungeon-copilot/rules';
import {
  dealDamageSchema,
  groupSize,
  isSpent,
  leaveCombat,
  memberName,
  type Blow,
  type CombatantRef,
  type GameRoll,
} from '@dungeon-copilot/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import type { Transaction } from '../db';
import { characters, gameEvents } from '../db/schema';
import { findCombat } from '../games/combat';
import {
  GAME_NOT_FOUND,
  characterBuild,
  createAddEvent,
  findVisibleEvent,
  isEventId,
  requireMasterOf,
  viewerOf,
} from '../games/events';
import { findSpent } from '../games/scenes';
import { HttpError, forbidden, notFound, parseBody, parseId } from '../http/errors';
import { requireUser } from './auth';

interface IdParams {
  id: string;
}

interface EventParams extends IdParams {
  eventId: string;
}

const TARGET_NOT_FOUND = 'Quien recibe el golpe no está en el combate ni es de esta campaña';
const ROLL_NOT_FOUND = 'Esa tirada no existe en esta partida';
const DAMAGE_NOT_FOUND = 'Ese golpe no existe en esta partida';

/** Una condición sobre un evento del mismo tipo en la partida, como que ya se haya hecho algo. */
async function exists(tx: Transaction, gameId: string, ...conditions: ReturnType<typeof sql>[]) {
  const [row] = await tx
    .select({ id: gameEvents.id })
    .from(gameEvents)
    .where(and(eq(gameEvents.gameId, gameId), ...conditions))
    .limit(1);
  return row !== undefined;
}

/**
 * La tirada de la que sale un golpe: tiene que ser de la partida, contar (no haberse repetido con
 * Suerte) y no haber dado ya ese golpe a quien lo recibe.
 */
async function findHitRoll(
  tx: Transaction,
  gameId: string,
  rollId: number,
  targetId: string,
): Promise<GameRoll> {
  const [row] = isEventId(rollId)
    ? await tx
        .select({ payload: gameEvents.payload })
        .from(gameEvents)
        .where(and(eq(gameEvents.id, rollId), eq(gameEvents.gameId, gameId)))
    : [];
  if (row?.payload.kind !== 'roll') throw notFound(ROLL_NOT_FOUND);
  const id = String(rollId);
  if (await exists(tx, gameId, sql`${gameEvents.payload} -> 'roll' -> 'reroll' ->> 'of' = ${id}`)) {
    throw new HttpError(409, 'Esa tirada se ha repetido con Suerte: el golpe sale de la segunda');
  }
  const applied = await exists(
    tx,
    gameId,
    sql`${gameEvents.payload} ->> 'kind' = 'damage'`,
    sql`${gameEvents.payload} ->> 'roll' = ${id}`,
    sql`${gameEvents.payload} -> 'target' ->> 'id' = ${targetId}`,
  );
  if (applied) throw new HttpError(409, 'Ese golpe ya está aplicado');
  return row.payload.roll;
}

/**
 * Quién da el golpe a `targetId` y quién lo recibe (con cuál de su grupo, si se apuntó a uno),
 * según quién atacaba a quién en la tirada.
 */
function sidesOf(
  blow: Blow | undefined,
  targetId: string,
): { by?: CombatantRef; struck?: CombatantRef } {
  if (blow?.defender.id === targetId) return { by: blow.attacker, struck: blow.defender };
  if (blow?.attacker.id === targetId) return { by: blow.defender, struck: blow.attacker };
  return {};
}

/**
 * El daño en la partida. El máster aplica un golpe a un personaje (cambia su ficha) o a PNJ del
 * combate (lleva la cuenta de su daño y, si caen todos, salen del orden), y el jugador de un
 * personaje que recibe un golpe mortal puede gastar Suerte para seguir con vida. Todo son eventos
 * públicos de la partida.
 */
export function registerDamageRoutes(app: FastifyInstance, ctx: AppContext): void {
  const addEvent = createAddEvent(ctx);

  /** El máster aplica un golpe: el de una tirada, un coste, una trampa o lo que haga falta. */
  app.post<{ Params: IdParams }>('/api/games/:id/damage', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(dealDamageSchema, request.body, 'Revisa el golpe');
    const { event } = await addEvent(user, gameId, async (tx, found) => {
      requireMasterOf(found);
      const roll =
        body.roll === undefined
          ? undefined
          : await findHitRoll(tx, gameId, body.roll, body.targetId);
      const { by, struck } = sidesOf(roll?.blow, body.targetId);
      const hit = { kind: 'damage' as const, roll: body.roll, by };

      const combat = await findCombat(tx, gameId);
      const npc = combat?.order.find((combatant) => combatant.id === body.targetId);
      if (combat && npc?.kind === 'npc') {
        if (body.dodge) throw new HttpError(400, 'Esquiva prodigiosa es de los personajes');
        const count = groupSize(npc);
        const harm = combat.harm[npc.id] ?? UNHARMED;
        if (harm.down >= count) {
          const fallen = count === 1 ? 'ya ha caído' : 'ya han caído todos';
          throw new HttpError(409, `${npc.name} ${fallen}`);
        }
        const { toughness } = NPC_PROFILES[npc.profile];
        // A cuál del grupo va: el que se dice o al que se apuntó en la tirada.
        const chosen = body.member ?? struck?.member;
        if (chosen !== undefined && chosen >= count) {
          throw notFound(`${npc.name} ${count === 1 ? 'es uno solo' : `son ${count}`}`);
        }
        const member = count === 1 ? undefined : chosen;
        if (member !== undefined && memberDamage(npc.profile, count, harm)[member]! >= toughness) {
          throw new HttpError(409, `${memberName(npc, member)} ya ha caído`);
        }
        const result = damageNpcs(npc.profile, count, harm, body.amount, member);
        // Si caen todos, salen del combate, salvo que no quede nadie más en él.
        const position =
          result.out && combat.order.length > 1 ? leaveCombat(combat, npc.id) : undefined;
        return {
          visibility: 'public',
          payload: {
            ...hit,
            amount: body.amount,
            target: {
              kind: 'npc',
              id: npc.id,
              name: npc.name,
              count,
              toughness,
              harm: result.harm,
              fell: result.fell,
              member: result.member,
            },
            position,
          },
        };
      }

      const [row] = await tx
        .select()
        .from(characters)
        .where(
          and(eq(characters.id, body.targetId), eq(characters.campaignId, found.game.campaignId)),
        )
        .for('update');
      if (!row) throw notFound(TARGET_NOT_FOUND);
      if (body.dodge) {
        if (!row.advancedSkills.includes('uncanny-dodge')) {
          throw new HttpError(400, `${row.name} no tiene Esquiva prodigiosa`);
        }
        if (isSpent(await findSpent(tx, gameId), row.id, 'uncanny-dodge')) {
          throw new HttpError(409, `${row.name} ya ha usado Esquiva prodigiosa en esta escena`);
        }
      }
      // Con Esquiva prodigiosa, el daño se queda en 1.
      const amount = body.dodge ? 1 : body.amount;
      const before = { scratches: row.scratches, severity: row.severity };
      const damage = applyDamage(before, amount, scratchBoxes(characterBuild(row)));
      await tx
        .update(characters)
        .set({ ...damage.state, updatedAt: new Date() })
        .where(eq(characters.id, row.id));
      return {
        visibility: 'public',
        payload: {
          ...hit,
          amount,
          dodged: body.dodge || undefined,
          target: {
            kind: 'character',
            id: row.id,
            name: row.name,
            before,
            after: damage.state,
            lethal: damage.lethal,
          },
        },
      };
    });
    return reply.status(201).send({ event });
  });

  /**
   * Un personaje ha recibido un golpe mortal y gasta un punto de Suerte para seguir con vida. Lo
   * gasta su jugador, o el máster por él.
   */
  app.post<{ Params: EventParams }>(
    '/api/games/:id/damage/:eventId/survive',
    async (request, reply) => {
      const user = requireUser(request);
      const gameId = parseId(request.params.id, GAME_NOT_FOUND);
      const eventId = Number(request.params.eventId);
      const { event } = await addEvent(user, gameId, async (tx, found) => {
        const row = await findVisibleEvent(tx, gameId, eventId, viewerOf(found, user));
        if (row?.payload.kind !== 'damage' || row.payload.target.kind !== 'character') {
          throw notFound(DAMAGE_NOT_FOUND);
        }
        const { target } = row.payload;
        if (!target.lethal) {
          throw new HttpError(
            409,
            `Ese golpe no es mortal: ${target.name} no tiene que gastar Suerte`,
          );
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
            and(eq(characters.id, target.id), eq(characters.campaignId, found.game.campaignId)),
          )
          .for('update');
        if (!character) throw notFound('Ese personaje ya no está en la campaña');
        if (found.role !== 'master' && character.ownerId !== user.id) {
          throw forbidden('Solo su jugador o el máster pueden gastar su Suerte');
        }
        const saved = await exists(
          tx,
          gameId,
          sql`${gameEvents.payload} ->> 'kind' = 'survived'`,
          sql`${gameEvents.payload} ->> 'of' = ${String(eventId)}`,
        );
        if (saved) {
          throw new HttpError(
            409,
            `${character.name} ya ha gastado Suerte para salvarse de ese golpe`,
          );
        }
        if (character.luck < 1) throw new HttpError(409, `A ${character.name} no le queda Suerte`);

        await tx
          .update(characters)
          .set({ luck: character.luck - 1, updatedAt: new Date() })
          .where(eq(characters.id, character.id));
        return {
          visibility: 'public',
          payload: {
            kind: 'survived',
            of: eventId,
            characterId: character.id,
            name: character.name,
          },
        };
      });
      return reply.status(201).send({ event });
    },
  );
}
