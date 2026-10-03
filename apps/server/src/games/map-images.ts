import type { MapImageType } from '@dungeon-copilot/shared';
import { and, eq, lt, notExists, sql } from 'drizzle-orm';
import type { Executor } from '../db';
import { gameEvents, games, mapImages, maps } from '../db/schema';
import { notFound } from '../http/errors';

// Los planos de los mapas: imágenes de la campaña que se guardan en la base de datos, con su
// tope de tamaño, y que se sirven a quien es de la campaña o a su pantalla.

export const IMAGE_NOT_FOUND = 'Ese plano no existe o no es de esta campaña';

/** Cuánto se guarda un plano que aún no usa nadie: lo que tarda el máster en guardar el mapa. */
const UNUSED_GRACE = sql`now() - interval '1 hour'`;

const startsWith = (data: Uint8Array, bytes: readonly number[], offset = 0) =>
  bytes.every((byte, index) => data[offset + index] === byte);

/** El tipo de una imagen por sus primeros bytes: no basta con lo que diga quien la sube. */
export function imageType(data: Uint8Array): MapImageType | null {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(data, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // RIFF....WEBP
  if (startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return null;
}

/** Un plano de la campaña, para ponerlo de fondo: 404 si no existe o es de otra. */
export async function requireImage(db: Executor, campaignId: string, id: string): Promise<void> {
  const [found] = await db
    .select({ id: mapImages.id })
    .from(mapImages)
    .where(and(eq(mapImages.id, id), eq(mapImages.campaignId, campaignId)));
  if (!found) throw notFound(IMAGE_NOT_FOUND);
}

/**
 * Borra los planos de la campaña que ya no usa ningún mapa ni ninguna partida (que guardó el suyo
 * al ponerlo), salvo los recién subidos: el máster aún puede estar ajustándolos.
 */
export async function collectImages(db: Executor, campaignId: string): Promise<void> {
  const usedByMap = db
    .select({ id: maps.id })
    .from(maps)
    .where(
      and(
        eq(maps.campaignId, campaignId),
        sql`${maps.grid} -> 'background' ->> 'image' = ${mapImages.id}::text`,
      ),
    );
  const usedByGame = db
    .select({ id: gameEvents.id })
    .from(gameEvents)
    .innerJoin(games, eq(games.id, gameEvents.gameId))
    .where(
      and(
        eq(games.campaignId, campaignId),
        sql`${gameEvents.payload} ->> 'kind' = 'map'`,
        sql`${gameEvents.payload} -> 'map' -> 'grid' -> 'background' ->> 'image' = ${mapImages.id}::text`,
      ),
    );
  await db
    .delete(mapImages)
    .where(
      and(
        eq(mapImages.campaignId, campaignId),
        lt(mapImages.createdAt, UNUSED_GRACE),
        notExists(usedByMap),
        notExists(usedByGame),
      ),
    );
}
