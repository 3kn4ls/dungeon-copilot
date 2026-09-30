import type { SettledHow } from '@dungeon-copilot/shared';
import { and, asc, eq, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { Executor } from '../db';
import { gameEvents } from '../db/schema';
import { HttpError, notFound } from '../http/errors';
import { isEventId, type EventRow } from './events';

// Lo que espera en una partida: las intervenciones de los jugadores, hasta que el máster las
// atiende, y las tiradas que pide el máster, hasta que alguien las tira.

export const INTERVENTION_NOT_FOUND = 'Esa intervención no existe en esta partida';
export const ROLL_REQUEST_NOT_FOUND = 'Esa tirada pedida no existe en esta partida';

const SETTLED_INTERVENTION: Record<SettledHow, string> = {
  answered: 'El máster ya ha atendido esa intervención',
  dismissed: 'El máster ya ha dicho que ahora no a esa intervención',
  withdrawn: 'Esa intervención ya se ha retirado',
};

const SETTLED_ROLL_REQUEST: Record<SettledHow, string> = {
  answered: 'Esa tirada ya está hecha',
  dismissed: 'El máster ha retirado esa tirada',
  withdrawn: 'El máster ha retirado esa tirada',
};

/**
 * Condición: algo cierra el evento cuyo id (en texto) es `id`, que ya no espera. Atiende una
 * intervención quien la cita en `answers` (la palabra, una tirada pedida, una frase o una
 * descripción); una tirada pedida se cumple con la tirada que la cita en `requested`; y las dos
 * se cierran sin más con un `settled`.
 */
function settledCondition(gameId: SQLWrapper | string, id: SQLWrapper | string): SQL {
  return sql`exists (
    select 1 from ${gameEvents} as later
    where later.game_id = ${gameId} and (
      later.payload ->> 'answers' = ${id}
      or later.payload -> 'roll' ->> 'requested' = ${id}
      or (later.payload ->> 'kind' = 'settled' and later.payload ->> 'of' = ${id})
    )
  )`;
}

/** Cómo se cerró una intervención o una tirada pedida, o null si sigue esperando. */
export async function settledHow(
  db: Executor,
  gameId: string,
  eventId: number,
): Promise<SettledHow | null> {
  const id = String(eventId);
  const [row] = await db
    .select({ payload: gameEvents.payload })
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.gameId, gameId),
        or(
          sql`${gameEvents.payload} ->> 'answers' = ${id}`,
          sql`${gameEvents.payload} -> 'roll' ->> 'requested' = ${id}`,
          and(
            sql`${gameEvents.payload} ->> 'kind' = 'settled'`,
            sql`${gameEvents.payload} ->> 'of' = ${id}`,
          ),
        ),
      ),
    )
    .orderBy(asc(gameEvents.id))
    .limit(1);
  if (!row) return null;
  return row.payload.kind === 'settled' ? row.payload.how : 'answered';
}

/** 409 si la intervención o la tirada pedida ya no espera, con el porqué. */
export async function requirePending(db: Executor, row: EventRow): Promise<void> {
  const how = await settledHow(db, row.gameId, row.id);
  if (how === null) return;
  const messages = row.payload.kind === 'rollRequest' ? SETTLED_ROLL_REQUEST : SETTLED_INTERVENTION;
  throw new HttpError(409, messages[how]);
}

/** La intervención de un personaje que aún espera al máster, si tiene una. */
export async function findPendingInterventionOf(
  db: Executor,
  gameId: string,
  characterId: string,
): Promise<number | undefined> {
  const [row] = await db
    .select({ id: gameEvents.id })
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.gameId, gameId),
        sql`${gameEvents.payload} ->> 'kind' = 'intervention'`,
        sql`${gameEvents.payload} ->> 'characterId' = ${characterId}`,
        sql`not ${settledCondition(gameEvents.gameId, sql`${gameEvents.id}::text`)}`,
      ),
    )
    .limit(1);
  return row?.id;
}

/**
 * Una intervención de la partida que sigue esperando a que la atienda el máster, que las ve
 * todas, también las que son en secreto.
 */
export async function pendingIntervention(
  db: Executor,
  gameId: string,
  eventId: number,
): Promise<EventRow> {
  const [row] = isEventId(eventId)
    ? await db
        .select()
        .from(gameEvents)
        .where(and(eq(gameEvents.id, eventId), eq(gameEvents.gameId, gameId)))
    : [];
  if (row?.payload.kind !== 'intervention') throw notFound(INTERVENTION_NOT_FOUND);
  await requirePending(db, row);
  return row;
}

/**
 * La intervención que atiende el máster con `answers`: tiene que ser de esta partida y seguir
 * esperando. Sin `answers`, no atiende ninguna.
 */
export async function answeredIntervention(
  db: Executor,
  gameId: string,
  answers: number | undefined,
): Promise<EventRow | undefined> {
  return answers === undefined ? undefined : pendingIntervention(db, gameId, answers);
}
