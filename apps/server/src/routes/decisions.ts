import {
  LEAK_NPCS,
  enemyDecisionSchema,
  isCheckedIntent,
  revealCheckSchema,
  type PublicUser,
} from '@dungeon-copilot/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  checkQuestions,
  checkSuggestion,
  enemyDecision,
  enemyQuestions,
  leakQuestions,
  secretLeaks,
  type CheckPrompt,
  type EnemyPrompt,
  type LeakPrompt,
} from '../ai/decisions';
import { askDecider, requireDecider } from '../ai/respond';
import type { AppContext } from '../context';
import { characters, npcs } from '../db/schema';
import {
  GAME_CLOSED,
  GAME_NOT_FOUND,
  findGame,
  findVisibleEvent,
  requireMasterOf,
} from '../games/events';
import { requireCombat } from '../games/combat';
import { INTERVENTION_NOT_FOUND } from '../games/pending';
import {
  findCombatBlows,
  findFighters,
  findNpcKnown,
  findNpcSecrets,
  findScenes,
  npcFighter,
} from '../games/prompt-context';
import { findSceneTitle } from '../games/scenes';
import { HttpError, notFound, parseBody, parseId } from '../http/errors';
import { requireUser } from './auth';

interface IdParams {
  id: string;
}

interface EventParams extends IdParams {
  eventId: string;
}

const CHARACTER_GONE = 'Ese personaje ya no está en la campaña';
const CHECK_BY_RULES =
  'Cuerpo a cuerpo, la tirada la dice el reglamento con el equipo de la ficha: no hay nada que sugerir';
const CHECK_WITHOUT_TEXT = 'Esa intervención no dice qué intenta: no hay nada que sugerir';
/** Los golpes del combate que se cuentan a la IA para que sepa cómo va. */
const RECENT_BLOWS = 5;

/**
 * Las sugerencias de la IA que decide (Nimble) al máster: qué tirada pedir para una intervención,
 * qué hacen los enemigos y si lo que va a enseñar desvela un secreto. Solo sugieren: no escriben
 * nada en la partida.
 */
export function registerDecisionRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, decider } = ctx;

  /** Una partida en juego que dirige `user`, con la IA que decide lista. */
  async function findDecidedGame(user: PublicUser, gameId: string) {
    const found = await findGame(db, user, gameId);
    requireMasterOf(found);
    if (found.game.status !== 'open') throw new HttpError(409, GAME_CLOSED);
    return { found, nimble: requireDecider(decider) };
  }

  /**
   * Qué tirada pedir para una intervención, según lo que ha escrito su jugador: con qué tira, la
   * dificultad, si alguien se opone, si encaja su trasfondo y si hace falta tirar; en un disparo,
   * la distancia y la cobertura.
   */
  app.post<{ Params: EventParams }>(
    '/api/games/:id/interventions/:eventId/check',
    async (request, reply) => {
      const user = requireUser(request);
      const gameId = parseId(request.params.id, GAME_NOT_FOUND);
      const { found, nimble } = await findDecidedGame(user, gameId);
      const eventId = Number(request.params.eventId);
      const row = await findVisibleEvent(db, gameId, eventId, { master: true });
      if (row?.payload.kind !== 'intervention') throw notFound(INTERVENTION_NOT_FOUND);
      const { intent, text, characterId, target } = row.payload;
      if (!isCheckedIntent(intent)) throw new HttpError(409, CHECK_BY_RULES);
      if (!text.trim()) throw new HttpError(409, CHECK_WITHOUT_TEXT);
      // La ficha de ahora: puede haber cambiado de nombre o de trasfondo.
      const [character] = await db
        .select({ name: characters.name, background: characters.background })
        .from(characters)
        .where(
          and(eq(characters.id, characterId), eq(characters.campaignId, found.game.campaignId)),
        );
      if (!character) throw notFound(CHARACTER_GONE);
      const [shown] = await findScenes(db, gameId, 1);

      const prompt: CheckPrompt = {
        character,
        scene: await findSceneTitle(db, gameId),
        shown,
        intent,
        text,
        target: target?.name,
      };
      const answers = await askDecider(request, reply, nimble, checkQuestions(prompt));
      if (!answers) return reply;
      return { suggestion: checkSuggestion(prompt, answers) };
    },
  );

  /**
   * Qué hacen unos PNJ del combate: a quién atacan, si hay a quién elegir, y si siguen, huyen o se
   * rinden. Con `targets: false`, solo lo segundo. Sabe cómo va cada uno que pelea y los últimos
   * golpes, y de un PNJ de la campaña, lo que sabe el máster: nunca lo que oculta.
   */
  app.post<{ Params: IdParams }>('/api/games/:id/combat/decision', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(
      enemyDecisionSchema,
      request.body,
      'Revisa de quién pides la sugerencia',
    );
    const { found, nimble } = await findDecidedGame(user, gameId);
    const combat = await requireCombat(db, gameId);
    const acting = combat.order.find((combatant) => combatant.id === body.combatantId);
    if (acting?.kind !== 'npc') throw notFound('Esos PNJ no están en el combate');
    const { campaignId } = found.game;

    const prompt: EnemyPrompt = {
      round: combat.round,
      scene: await findSceneTitle(db, gameId),
      fighters: await findFighters(db, campaignId, combat),
      acting: {
        fighter: npcFighter(combat, acting),
        ...(await findNpcKnown(db, campaignId, acting)),
      },
      blows: await findCombatBlows(db, gameId, combat, RECENT_BLOWS),
      targets: body.targets,
    };
    const answers = await askDecider(request, reply, nimble, enemyQuestions(prompt));
    if (!answers) return reply;
    return { decision: enemyDecision(prompt, answers) };
  });

  /**
   * Si lo que va a enseñar el máster (una descripción o lo que dice un PNJ, a la mesa o en
   * secreto) desvela lo que oculta algún PNJ de la campaña. Responde quiénes, no sus secretos: los
   * secretos solo llegan a la IA.
   */
  app.post<{ Params: IdParams }>('/api/games/:id/reveals/check', async (request, reply) => {
    const user = requireUser(request);
    const gameId = parseId(request.params.id, GAME_NOT_FOUND);
    const body = parseBody(revealCheckSchema, request.body, 'Revisa lo que vas a enseñar');
    const { found, nimble } = await findDecidedGame(user, gameId);
    const { campaignId } = found.game;
    let speaker: string | undefined;
    if (body.npcId) {
      const [npc] = await db
        .select({ name: npcs.name })
        .from(npcs)
        .where(and(eq(npcs.id, body.npcId), eq(npcs.campaignId, campaignId)));
      if (!npc) throw notFound('Ese PNJ no está en esta campaña');
      speaker = npc.name;
    }
    const prompt: LeakPrompt = {
      title: body.title,
      body: body.body,
      speaker,
      npcs: await findNpcSecrets(db, campaignId, LEAK_NPCS, body.npcId),
    };
    const { state, questions } = leakQuestions(prompt);
    // Si nadie oculta nada, no hay nada que preguntar.
    if (!questions.leak) return { leaks: [] };
    const answers = await askDecider(request, reply, nimble, { state, questions });
    if (!answers) return reply;
    return { leaks: secretLeaks(prompt, answers) };
  });
}
