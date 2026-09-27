import { randomInt } from 'node:crypto';
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  createCampaignSchema,
  joinCampaignSchema,
  updateCampaignSchema,
  type CampaignDetail,
  type CampaignSummary,
} from '@dungeon-copilot/shared';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import type { Executor } from '../db';
import { isUniqueViolation } from '../db/errors';
import { campaignMembers, campaigns, characters, games, users } from '../db/schema';
import { HttpError, forbidden, notFound, parseBody, parseId } from '../http/errors';
import { CAMPAIGN_NOT_FOUND, memberRole, requireMaster, requireMember } from './access';
import { requireUser } from './auth';

interface CampaignParams {
  id: string;
}

interface MemberParams extends CampaignParams {
  userId: string;
}

export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

/** Ejecuta `action` con un código nuevo y lo reintenta si por casualidad ya estaba en uso. */
async function withFreshInviteCode<T>(action: (code: string) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action(generateInviteCode());
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= 5) throw error;
    }
  }
}

async function findSummaries(db: Executor, userId: string, where?: SQL) {
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      description: campaigns.description,
      role: campaignMembers.role,
      memberCount:
        sql<number>`(select count(*) from ${campaignMembers} as cm where cm.campaign_id = ${campaigns.id})`.mapWith(
          Number,
        ),
      characterCount:
        sql<number>`(select count(*) from ${characters} as ch where ch.campaign_id = ${campaigns.id})`.mapWith(
          Number,
        ),
      openGameId: sql<
        string | null
      >`(select g.id from ${games} as g where g.campaign_id = ${campaigns.id} and g.status = 'open')`,
      createdAt: campaigns.createdAt,
    })
    .from(campaignMembers)
    .innerJoin(campaigns, eq(campaigns.id, campaignMembers.campaignId))
    .where(and(eq(campaignMembers.userId, userId), where))
    .orderBy(desc(campaigns.updatedAt));
  return rows.map((row): CampaignSummary => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

async function findDetail(db: Executor, campaignId: string, userId: string) {
  const role = await memberRole(db, campaignId, userId);
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!role || !campaign) throw notFound(CAMPAIGN_NOT_FOUND);

  const members = await db
    .select({
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      role: campaignMembers.role,
      joinedAt: campaignMembers.joinedAt,
    })
    .from(campaignMembers)
    .innerJoin(users, eq(users.id, campaignMembers.userId))
    .where(eq(campaignMembers.campaignId, campaignId))
    .orderBy(asc(campaignMembers.joinedAt));

  const detail: CampaignDetail = {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    role,
    members: members
      .map((member) => ({ ...member, joinedAt: member.joinedAt.toISOString() }))
      // El máster, siempre el primero.
      .sort((a, b) => Number(b.role === 'master') - Number(a.role === 'master')),
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
  };
  if (role === 'master') {
    detail.inviteCode = campaign.inviteCode;
    detail.screenToken = campaign.screenToken;
  }
  return detail;
}

export function registerCampaignRoutes(app: FastifyInstance, { db, hub }: AppContext): void {
  app.get('/api/campaigns', async (request) => {
    const user = requireUser(request);
    return { campaigns: await findSummaries(db, user.id) };
  });

  app.post('/api/campaigns', async (request, reply) => {
    const user = requireUser(request);
    const body = parseBody(createCampaignSchema, request.body, 'Revisa los datos de la campaña');
    const campaignId = await withFreshInviteCode((inviteCode) =>
      db.transaction(async (tx) => {
        const [campaign] = await tx
          .insert(campaigns)
          .values({ ...body, inviteCode })
          .returning({ id: campaigns.id });
        if (!campaign) throw new Error('La base de datos no devolvió la campaña creada');
        await tx
          .insert(campaignMembers)
          .values({ campaignId: campaign.id, userId: user.id, role: 'master' });
        return campaign.id;
      }),
    );
    return reply.status(201).send({ campaign: await findDetail(db, campaignId, user.id) });
  });

  app.post('/api/campaigns/join', async (request) => {
    const user = requireUser(request);
    const { inviteCode } = parseBody(joinCampaignSchema, request.body, 'Revisa el código');
    const [campaign] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.inviteCode, inviteCode));
    if (!campaign) throw notFound('No hay ninguna campaña con ese código');

    // Unirse dos veces no hace nada: quien ya es miembro conserva su papel.
    await db
      .insert(campaignMembers)
      .values({ campaignId: campaign.id, userId: user.id, role: 'player' })
      .onConflictDoNothing();
    const [summary] = await findSummaries(db, user.id, eq(campaigns.id, campaign.id));
    return { campaign: summary };
  });

  app.get<{ Params: CampaignParams }>('/api/campaigns/:id', async (request) => {
    const user = requireUser(request);
    const campaignId = parseId(request.params.id, CAMPAIGN_NOT_FOUND);
    return { campaign: await findDetail(db, campaignId, user.id) };
  });

  app.patch<{ Params: CampaignParams }>('/api/campaigns/:id', async (request) => {
    const user = requireUser(request);
    const campaignId = parseId(request.params.id, CAMPAIGN_NOT_FOUND);
    await requireMaster(db, campaignId, user);
    const body = parseBody(updateCampaignSchema, request.body, 'Revisa los datos de la campaña');
    await db
      .update(campaigns)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(campaigns.id, campaignId));
    return { campaign: await findDetail(db, campaignId, user.id) };
  });

  app.delete<{ Params: CampaignParams }>('/api/campaigns/:id', async (request, reply) => {
    const user = requireUser(request);
    const campaignId = parseId(request.params.id, CAMPAIGN_NOT_FOUND);
    await requireMaster(db, campaignId, user);
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    hub.disconnect(campaignId);
    return reply.status(204).send();
  });

  app.post<{ Params: CampaignParams }>('/api/campaigns/:id/invite-code', async (request) => {
    const user = requireUser(request);
    const campaignId = parseId(request.params.id, CAMPAIGN_NOT_FOUND);
    await requireMaster(db, campaignId, user);
    const inviteCode = await withFreshInviteCode(async (code) => {
      await db
        .update(campaigns)
        .set({ inviteCode: code, updatedAt: new Date() })
        .where(eq(campaigns.id, campaignId));
      return code;
    });
    return { inviteCode };
  });

  app.post<{ Params: CampaignParams }>('/api/campaigns/:id/screen-token', async (request) => {
    const user = requireUser(request);
    const campaignId = parseId(request.params.id, CAMPAIGN_NOT_FOUND);
    await requireMaster(db, campaignId, user);
    // La base de datos genera el enlace nuevo con el valor por defecto de la columna.
    const [row] = await db
      .update(campaigns)
      .set({ screenToken: sql`default`, updatedAt: new Date() })
      .where(eq(campaigns.id, campaignId))
      .returning({ screenToken: campaigns.screenToken });
    if (!row) throw notFound(CAMPAIGN_NOT_FOUND);
    // Las pantallas con el enlace viejo dejan de recibir la partida.
    hub.disconnect(campaignId, (subscriber) => subscriber.userId === null);
    return { screenToken: row.screenToken };
  });

  app.delete<{ Params: MemberParams }>(
    '/api/campaigns/:id/members/:userId',
    async (request, reply) => {
      const user = requireUser(request);
      const campaignId = parseId(request.params.id, CAMPAIGN_NOT_FOUND);
      const role = await requireMember(db, campaignId, user);
      const targetId = parseId(request.params.userId, 'Esa persona no está en la campaña');

      if (targetId === user.id) {
        if (role === 'master') {
          throw new HttpError(
            409,
            'El máster no puede abandonar su campaña. Si ya no la necesitas, bórrala',
          );
        }
      } else if (role !== 'master') {
        throw forbidden('Solo el máster puede echar a alguien de la campaña');
      }

      // Sus personajes se quedan en la campaña: si vuelve a unirse, los recupera.
      const removed = await db
        .delete(campaignMembers)
        .where(
          and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, targetId)),
        )
        .returning({ userId: campaignMembers.userId });
      if (removed.length === 0) throw notFound('Esa persona no está en la campaña');
      // Si estaba en la sala de una partida, deja de recibirla.
      hub.disconnect(campaignId, (subscriber) => subscriber.userId === targetId);
      return reply.status(204).send();
    },
  );
}
