import type { CharacterBuild } from '@dungeon-copilot/rules';
import type {
  CharacterRef,
  GameDetail,
  GameEvent,
  GameEventPayload,
  GameEventVisibility,
  GameSummary,
  MemberRole,
  PublicUser,
} from '@dungeon-copilot/shared';
import { and, asc, eq, gt, inArray, or, type SQL } from 'drizzle-orm';
import type { AppContext } from '../context';
import type { Executor, Transaction } from '../db';
import { campaignMembers, campaigns, characters, gameEvents, games, users } from '../db/schema';
import { HttpError, forbidden, notFound } from '../http/errors';
import type { RollingCharacter } from './rolls';

export const GAME_NOT_FOUND = 'Esa partida no existe o no es de tus campañas';
export const GAME_CLOSED = 'La partida ya ha terminado';
export const MASTER_ONLY = 'Solo el máster de la campaña puede hacer eso';
export const CHARACTER_NOT_HERE = 'Ese personaje no está en esta campaña';

/** Los ids de los eventos son un integer de PostgreSQL: fuera de rango, no existen. */
export const isEventId = (id: number) => Number.isInteger(id) && id > 0 && id <= 2 ** 31 - 1;

export type GameRow = typeof games.$inferSelect;
export type EventRow = typeof gameEvents.$inferSelect;

export interface FoundGame {
  game: GameRow;
  campaignName: string;
  screenToken: string;
  role: MemberRole;
}

export function toSummary(row: GameRow): GameSummary {
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

export function toDetail({ game, campaignName, screenToken, role }: FoundGame): GameDetail {
  const detail: GameDetail = {
    ...toSummary(game),
    campaignId: game.campaignId,
    campaignName,
    role,
  };
  if (role === 'master') detail.screenToken = screenToken;
  return detail;
}

export function toEvent(row: EventRow, authorName: string | null): GameEvent {
  return {
    ...row.payload,
    id: row.id,
    gameId: row.gameId,
    visibility: row.visibility,
    authorName,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Quien mira el registro: el máster lo ve todo; un jugador, lo público y lo que es en secreto
 * para él; la pantalla de la mesa (sin `userId`), solo lo público.
 */
export type Viewer = { master: true } | { master: false; userId: string | null };

export const viewerOf = (found: FoundGame, user: PublicUser): Viewer =>
  found.role === 'master' ? { master: true } : { master: false, userId: user.id };

export const SCREEN_VIEWER: Viewer = { master: false, userId: null };

/** Si `viewer` puede ver un evento con esta visibilidad y, si es en secreto, este jugador. */
export function canSee(
  viewer: Viewer,
  event: { visibility: GameEventVisibility; playerId: string | null },
): boolean {
  if (viewer.master || event.visibility === 'public') return true;
  return (
    event.visibility === 'private' && viewer.userId !== null && event.playerId === viewer.userId
  );
}

function visibleTo(viewer: Viewer): SQL | undefined {
  if (viewer.master) return undefined;
  const isPublic = eq(gameEvents.visibility, 'public');
  if (viewer.userId === null) return isPublic;
  return or(
    isPublic,
    and(eq(gameEvents.visibility, 'private'), eq(gameEvents.playerId, viewer.userId)),
  );
}

/** Eventos de una partida posteriores a `after` que puede ver `viewer`, del más antiguo al último. */
export async function findEvents(
  db: Executor,
  gameId: string,
  options: { after?: number; viewer: Viewer },
): Promise<GameEvent[]> {
  const rows = await db
    .select({ event: gameEvents, authorName: users.displayName })
    .from(gameEvents)
    .leftJoin(users, eq(users.id, gameEvents.authorId))
    .where(
      and(
        eq(gameEvents.gameId, gameId),
        gt(gameEvents.id, options.after ?? 0),
        visibleTo(options.viewer),
      ),
    )
    .orderBy(asc(gameEvents.id));
  return rows.map(({ event, authorName }) => toEvent(event, authorName));
}

/** Partida vista por `user`: 404 si no existe o si no es miembro de su campaña. */
export async function findGame(
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

export const requireMasterOf = (found: FoundGame) => {
  if (found.role !== 'master') throw forbidden(MASTER_ONLY);
};

export type CharacterRow = typeof characters.$inferSelect;

/** Lo que dice el reglamento de un personaje: su reparto de atributos y habilidades. */
export const characterBuild = (row: CharacterRow): CharacterBuild => ({
  name: row.name,
  background: row.background,
  attributes: row.attributes,
  skills: row.skills,
  advancedSkills: row.advancedSkills,
});

/** Los personajes de la campaña que tiran, con lo que hace falta para calcular su tirada. */
export async function findRollingCharacters(
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
        build: characterBuild(row),
        wounds: { scratches: row.scratches, severity: row.severity },
        gear: row.gear,
      },
    ]),
  );
}

/** Un personaje de la campaña de la partida, con su jugador: 404 si no es de ella. */
export async function findCampaignCharacter(
  db: Executor,
  found: FoundGame,
  characterId: string,
): Promise<CharacterRef & { ownerId: string }> {
  const [character] = await db
    .select({ characterId: characters.id, name: characters.name, ownerId: characters.ownerId })
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.campaignId, found.game.campaignId)));
  if (!character) throw notFound(CHARACTER_NOT_HERE);
  return character;
}

/** Un evento de la partida tal como lo guarda la base de datos, si existe y `viewer` lo ve. */
export async function findVisibleEvent(
  db: Executor,
  gameId: string,
  eventId: number,
  viewer: Viewer,
): Promise<EventRow | undefined> {
  if (!isEventId(eventId)) return undefined;
  const [row] = await db
    .select()
    .from(gameEvents)
    .where(and(eq(gameEvents.id, eventId), eq(gameEvents.gameId, gameId)));
  return row && canSee(viewer, row) ? row : undefined;
}

/** Lo nuevo que pasa en una partida: qué es y quién puede verlo. */
export interface NewEvent {
  visibility: GameEventVisibility;
  payload: GameEventPayload;
  /** En un evento en secreto, el jugador que lo ve además del máster. */
  playerId?: string | null;
}

export type AddEvent = (
  user: PublicUser,
  gameId: string,
  action: (tx: Transaction, found: FoundGame) => Promise<NewEvent>,
) => Promise<{ event: GameEvent; found: FoundGame }>;

/**
 * Añade un evento a una partida en juego y lo reparte en vivo. La fila de la partida queda
 * bloqueada durante la transacción: así los eventos de una partida se guardan en orden, nadie
 * atiende dos veces lo mismo y nadie añade nada a una partida que se está cerrando.
 */
export function createAddEvent({ db, hub }: Pick<AppContext, 'db' | 'hub'>): AddEvent {
  return async (user, gameId, action) => {
    const { row, found } = await db.transaction(async (tx) => {
      const found = await findGame(tx, user, gameId, true);
      if (found.game.status !== 'open') throw new HttpError(409, GAME_CLOSED);
      const { visibility, payload, playerId = null } = await action(tx, found);
      const [row] = await tx
        .insert(gameEvents)
        .values({
          gameId,
          visibility,
          authorId: user.id,
          payload,
          playerId: visibility === 'private' ? playerId : null,
        })
        .returning();
      if (!row) throw new Error('La base de datos no devolvió el evento creado');
      return { row, found };
    });
    const event = toEvent(row, user.displayName);
    hub.publish(found.game.campaignId, event, row.playerId);
    return { event, found };
  };
}
