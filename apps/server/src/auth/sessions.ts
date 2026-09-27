import { createHash, randomBytes } from 'node:crypto';
import type { PublicUser } from '@dungeon-copilot/shared';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Database } from '../db';
import { sessions, users } from '../db/schema';

export const SESSION_COOKIE = 'dc_session';

const DAY = 24 * 60 * 60 * 1000;
/** Una sesión dura 30 días y se renueva sola si se usa cuando le quedan menos de 15. */
export const SESSION_DURATION_MS = 30 * DAY;
const RENEW_WHEN_LEFT_MS = 15 * DAY;

/** En la base de datos solo se guarda el SHA-256 del token, nunca el token de la cookie. */
function sessionId(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(db: Database, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  // Aprovecha para limpiar las sesiones caducadas.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date(now)));
  await db.insert(sessions).values({
    id: sessionId(token),
    userId,
    expiresAt: new Date(now + SESSION_DURATION_MS),
  });
  return token;
}

export interface SessionLookup {
  user: PublicUser;
  /** La sesión se ha alargado y hay que volver a enviar la cookie. */
  renewed: boolean;
}

export async function findSession(db: Database, token: string): Promise<SessionLookup | null> {
  const id = sessionId(token);
  const now = Date.now();
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date(now))));
  if (!row) return null;

  const { expiresAt, ...user } = row;
  const renewed = expiresAt.getTime() - now < RENEW_WHEN_LEFT_MS;
  if (renewed) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(now + SESSION_DURATION_MS) })
      .where(eq(sessions.id, id));
  }
  return { user, renewed };
}

export async function deleteSession(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId(token)));
}
