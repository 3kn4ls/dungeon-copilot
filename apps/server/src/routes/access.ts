import type { MemberRole, PublicUser } from '@dungeon-copilot/shared';
import { and, eq } from 'drizzle-orm';
import type { Executor } from '../db';
import { campaignMembers } from '../db/schema';
import { forbidden, notFound } from '../http/errors';

/** A quien no es miembro se le dice que no existe: así no se descubre qué campañas hay. */
export const CAMPAIGN_NOT_FOUND = 'Esa campaña no existe o no eres miembro';

export async function memberRole(
  db: Executor,
  campaignId: string,
  userId: string,
): Promise<MemberRole | null> {
  const [row] = await db
    .select({ role: campaignMembers.role })
    .from(campaignMembers)
    .where(and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, userId)));
  return row?.role ?? null;
}

export async function requireMember(
  db: Executor,
  campaignId: string,
  user: PublicUser,
): Promise<MemberRole> {
  const role = await memberRole(db, campaignId, user.id);
  if (!role) throw notFound(CAMPAIGN_NOT_FOUND);
  return role;
}

export async function requireMaster(db: Executor, campaignId: string, user: PublicUser) {
  if ((await requireMember(db, campaignId, user)) !== 'master') {
    throw forbidden('Solo el máster de la campaña puede hacer eso');
  }
}
