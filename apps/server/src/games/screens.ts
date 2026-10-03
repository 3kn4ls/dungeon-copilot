import { eq } from 'drizzle-orm';
import type { Executor } from '../db';
import { campaigns } from '../db/schema';
import { notFound } from '../http/errors';

const SCREEN_NOT_FOUND = 'Esta pantalla no existe o el máster ha cambiado su enlace';

/** Los enlaces de pantalla son 32 caracteres hexadecimales (ver el esquema de campaigns). */
const SCREEN_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/** La campaña de un enlace de pantalla: 404 si no existe o el máster lo ha cambiado. */
export async function findScreenCampaign(
  db: Executor,
  token: string,
): Promise<{ id: string; name: string }> {
  if (!SCREEN_TOKEN_PATTERN.test(token)) throw notFound(SCREEN_NOT_FOUND);
  const [campaign] = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.screenToken, token));
  if (!campaign) throw notFound(SCREEN_NOT_FOUND);
  return campaign;
}
