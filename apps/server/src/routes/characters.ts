import {
  LUCK_PER_SESSION,
  applyDamage,
  planAdvance,
  recoverScratches,
  recoverSeverity,
  scratchBoxes,
  validateNewCharacter,
  type CharacterBuild,
} from '@dungeon-copilot/rules';
import {
  advanceSchema,
  awardXpSchema,
  createCharacterSchema,
  damageSchema,
  recoverSchema,
  updateCharacterSchema,
  type CharacterView,
  type DamageResponse,
  type PublicUser,
} from '@dungeon-copilot/shared';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../context';
import type { Database, Executor } from '../db';
import { campaignMembers, characters, users } from '../db/schema';
import { HttpError, forbidden, notFound, parseBody, parseId } from '../http/errors';
import { CAMPAIGN_NOT_FOUND, memberRole, requireMember } from './access';
import { requireUser } from './auth';

interface IdParams {
  id: string;
}

type CharacterRow = typeof characters.$inferSelect;
type CharacterChanges = Partial<
  Pick<
    typeof characters.$inferInsert,
    | 'name'
    | 'background'
    | 'attributes'
    | 'skills'
    | 'advancedSkills'
    | 'scratches'
    | 'severity'
    | 'luck'
    | 'xp'
  >
>;

const CHARACTER_NOT_FOUND = 'Ese personaje no existe o no es de tus campañas';

function toBuild(row: CharacterRow): CharacterBuild {
  return {
    name: row.name,
    background: row.background,
    attributes: row.attributes,
    skills: row.skills,
    advancedSkills: row.advancedSkills,
  };
}

/** Fichas visibles para `viewer`: solo las de campañas en las que participa. */
async function findCharacters(
  db: Executor,
  viewer: PublicUser,
  where: SQL,
): Promise<CharacterView[]> {
  const rows = await db
    .select({
      character: characters,
      ownerName: users.displayName,
      viewerRole: campaignMembers.role,
    })
    .from(characters)
    .innerJoin(users, eq(users.id, characters.ownerId))
    .innerJoin(
      campaignMembers,
      and(
        eq(campaignMembers.campaignId, characters.campaignId),
        eq(campaignMembers.userId, viewer.id),
      ),
    )
    .where(where)
    .orderBy(asc(characters.createdAt));

  return rows.map(({ character: row, ownerName, viewerRole }) => ({
    id: row.id,
    campaignId: row.campaignId,
    ownerId: row.ownerId,
    ownerName,
    name: row.name,
    background: row.background,
    attributes: row.attributes,
    skills: row.skills,
    advancedSkills: row.advancedSkills,
    wounds: {
      scratches: row.scratches,
      severity: row.severity,
      scratchBoxes: scratchBoxes(toBuild(row)),
    },
    luck: row.luck,
    xp: row.xp,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    canEdit: viewerRole === 'master' || row.ownerId === viewer.id,
    canAwardXp: viewerRole === 'master',
  }));
}

async function findCharacter(db: Executor, viewer: PublicUser, id: string) {
  const [character] = await findCharacters(db, viewer, eq(characters.id, id));
  if (!character) throw notFound(CHARACTER_NOT_FOUND);
  return character;
}

type Permission = 'edit' | 'awardXp';

/**
 * Cambia una ficha dentro de una transacción con la fila bloqueada, para que dos cambios
 * a la vez (dos golpes seguidos) no se pisen. `change` calcula los campos nuevos a partir
 * de la fila actual y puede devolver además un dato para la respuesta.
 */
async function changeCharacter<T = undefined>(
  db: Database,
  request: FastifyRequest<{ Params: IdParams }>,
  permission: Permission,
  change: (row: CharacterRow) => { changes: CharacterChanges; result?: T },
): Promise<{ character: CharacterView; result: T | undefined }> {
  const user = requireUser(request);
  const id = parseId(request.params.id, CHARACTER_NOT_FOUND);

  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(characters).where(eq(characters.id, id)).for('update');
    const role = row ? await memberRole(tx, row.campaignId, user.id) : null;
    if (!row || !role) throw notFound(CHARACTER_NOT_FOUND);
    if (permission === 'awardXp' && role !== 'master') {
      throw forbidden('Solo el máster reparte experiencia');
    }
    if (permission === 'edit' && role !== 'master' && row.ownerId !== user.id) {
      throw forbidden('Solo su jugador o el máster pueden cambiar esta ficha');
    }

    const outcome = change(row);
    await tx
      .update(characters)
      .set({ ...outcome.changes, updatedAt: new Date() })
      .where(eq(characters.id, id));
    return outcome.result;
  });

  return { character: await findCharacter(db, user, id), result };
}

export function registerCharacterRoutes(app: FastifyInstance, { db }: AppContext): void {
  app.get<{ Params: IdParams }>('/api/campaigns/:id/characters', async (request) => {
    const user = requireUser(request);
    const campaignId = parseId(request.params.id, CAMPAIGN_NOT_FOUND);
    await requireMember(db, campaignId, user);
    return { characters: await findCharacters(db, user, eq(characters.campaignId, campaignId)) };
  });

  app.post<{ Params: IdParams }>('/api/campaigns/:id/characters', async (request, reply) => {
    const user = requireUser(request);
    const campaignId = parseId(request.params.id, CAMPAIGN_NOT_FOUND);
    await requireMember(db, campaignId, user);
    const build = parseBody(createCharacterSchema, request.body, 'Revisa la ficha');
    const issues = validateNewCharacter(build);
    if (issues.length > 0) {
      throw new HttpError(400, 'La ficha no cumple las reglas de creación', issues);
    }

    const [row] = await db
      .insert(characters)
      .values({ ...build, campaignId, ownerId: user.id, luck: LUCK_PER_SESSION })
      .returning({ id: characters.id });
    if (!row) throw new Error('La base de datos no devolvió el personaje creado');
    return reply.status(201).send({ character: await findCharacter(db, user, row.id) });
  });

  app.get<{ Params: IdParams }>('/api/characters/:id', async (request) => {
    const user = requireUser(request);
    const id = parseId(request.params.id, CHARACTER_NOT_FOUND);
    return { character: await findCharacter(db, user, id) };
  });

  app.patch<{ Params: IdParams }>('/api/characters/:id', async (request) => {
    const body = parseBody(updateCharacterSchema, request.body, 'Revisa la ficha');
    const { character } = await changeCharacter(db, request, 'edit', () => ({ changes: body }));
    return { character };
  });

  app.delete<{ Params: IdParams }>('/api/characters/:id', async (request, reply) => {
    const user = requireUser(request);
    const id = parseId(request.params.id, CHARACTER_NOT_FOUND);
    const character = await findCharacter(db, user, id);
    if (!character.canEdit) throw forbidden('Solo su jugador o el máster pueden borrar esta ficha');
    await db.delete(characters).where(eq(characters.id, id));
    return reply.status(204).send();
  });

  app.post<{ Params: IdParams }>('/api/characters/:id/damage', async (request) => {
    const { amount } = parseBody(damageSchema, request.body, 'Revisa el daño');
    const { character, result } = await changeCharacter(db, request, 'edit', (row) => {
      const damage = applyDamage(row, amount, scratchBoxes(toBuild(row)));
      return { changes: damage.state, result: damage.lethal };
    });
    return { character, lethal: result ?? false } satisfies DamageResponse;
  });

  app.post<{ Params: IdParams }>('/api/characters/:id/recover', async (request) => {
    const { kind } = parseBody(recoverSchema, request.body, 'Revisa la recuperación');
    const { character } = await changeCharacter(db, request, 'edit', (row) => ({
      changes: kind === 'scratches' ? recoverScratches(row) : recoverSeverity(row),
    }));
    return { character };
  });

  app.post<{ Params: IdParams }>('/api/characters/:id/xp', async (request) => {
    const { amount } = parseBody(awardXpSchema, request.body, 'Revisa la experiencia');
    const { character } = await changeCharacter(db, request, 'awardXp', (row) => {
      if (row.xp + amount < 0) {
        throw new HttpError(400, `No puede quedarse con PX negativos: tiene ${row.xp}`);
      }
      return { changes: { xp: row.xp + amount } };
    });
    return { character };
  });

  app.post<{ Params: IdParams }>('/api/characters/:id/advances', async (request) => {
    const advance = parseBody(advanceSchema, request.body, 'Revisa la mejora');
    const { character } = await changeCharacter(db, request, 'edit', (row) => {
      const plan = planAdvance(toBuild(row), advance);
      if (!plan.ok) {
        throw new HttpError(
          400,
          'No se puede hacer esa mejora',
          plan.errors.map((message) => ({ path: 'advance', message })),
        );
      }
      if (plan.cost > row.xp) {
        throw new HttpError(400, `Esa mejora cuesta ${plan.cost} PX y tiene ${row.xp}`);
      }
      const { attributes, skills, advancedSkills } = plan.build;
      return { changes: { attributes, skills, advancedSkills, xp: row.xp - plan.cost } };
    });
    return { character };
  });
}
