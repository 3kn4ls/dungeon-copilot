import { defaultSkillCatalog, USE_LIMIT_LABELS } from '@dungeon-copilot/rules';
import {
  isSpent,
  startSceneSchema,
  useAbilitySchema,
  type CharacterRef,
} from '@dungeon-copilot/shared';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { characters } from '../db/schema';
import { findCombat } from '../games/combat';
import {
  CHARACTER_NOT_HERE,
  GAME_NOT_FOUND,
  createAddEvent,
  requireMasterOf,
} from '../games/events';
import { findSpent } from '../games/scenes';
import { HttpError, forbidden, notFound, parseBody, parseId } from '../http/errors';
import { requireUser } from './auth';

interface IdParams {
  id: string;
}

/** «esta escena» o «esta sesión»: hasta cuándo está gastada una técnica. */
const UNTIL: Record<keyof typeof USE_LIMIT_LABELS, string> = {
  scene: 'esta escena',
  session: 'esta sesión',
};

/**
 * Las escenas y lo que dura en ellas. El máster empieza una escena nueva, que termina la
 * anterior (y, si quiere, los personajes recuperan el aliento), y un personaje usa una técnica de
 * una vez por escena o por sesión. Todo son eventos públicos de la partida.
 */
export function registerSceneRoutes(app: FastifyInstance, ctx: AppContext): void {
  const addEvent = createAddEvent(ctx);

  /** El máster empieza una escena: termina la anterior y lo de una vez por escena vuelve. */
  app.post<{ Params: IdParams }>('/api/games/:id/scenes', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(startSceneSchema, request.body, 'Revisa la escena');
    const { event } = await addEvent(user, gameId, async (tx, found) => {
      requireMasterOf(found);
      if (await findCombat(tx, gameId)) {
        throw new HttpError(409, 'Hay un combate en juego: termínalo antes de cambiar de escena');
      }
      let recovered: CharacterRef[] = [];
      if (body.recover) {
        const rows = await tx
          .update(characters)
          .set({ scratches: 0, updatedAt: new Date() })
          .where(and(eq(characters.campaignId, found.game.campaignId), gt(characters.scratches, 0)))
          .returning({
            characterId: characters.id,
            name: characters.name,
            createdAt: characters.createdAt,
          });
        recovered = rows
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(({ characterId, name }) => ({ characterId, name }));
      }
      return {
        visibility: 'public',
        payload: { kind: 'scene', title: body.title, recovered },
      };
    });
    return reply.status(201).send({ event });
  });

  /**
   * Un personaje usa una técnica que se gasta, como Voz de mando o Erudito: su jugador, o el
   * máster por él. El efecto lo aplica la mesa; aquí queda que ya no la puede usar.
   */
  app.post<{ Params: IdParams }>('/api/games/:id/abilities', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(useAbilitySchema, request.body, 'Revisa qué técnica usa');
    const { event } = await addEvent(user, gameId, async (tx, found) => {
      const [character] = await tx
        .select({
          id: characters.id,
          name: characters.name,
          ownerId: characters.ownerId,
          advancedSkills: characters.advancedSkills,
        })
        .from(characters)
        .where(
          and(
            eq(characters.id, body.characterId),
            eq(characters.campaignId, found.game.campaignId),
          ),
        );
      if (!character) throw notFound(CHARACTER_NOT_HERE);
      if (found.role !== 'master' && character.ownerId !== user.id) {
        throw forbidden('Solo puedes usar las técnicas de tus personajes');
      }
      const skill = defaultSkillCatalog.get(body.skill);
      if (skill?.tier !== 'advanced') throw new HttpError(400, 'Esa técnica no existe');
      if (!character.advancedSkills.includes(skill.id)) {
        throw new HttpError(400, `${character.name} no tiene ${skill.name}`);
      }
      if (!skill.limit) {
        throw new HttpError(400, `${skill.name} no se gasta: se usa siempre que haga falta`);
      }
      if (isSpent(await findSpent(tx, gameId), character.id, skill.id)) {
        throw new HttpError(
          409,
          `${character.name} ya ha usado ${skill.name} en ${UNTIL[skill.limit]}`,
        );
      }
      return {
        visibility: 'public',
        payload: {
          kind: 'ability',
          characterId: character.id,
          name: character.name,
          skill: skill.id,
          label: skill.name,
        },
      };
    });
    return reply.status(201).send({ event });
  });
}
