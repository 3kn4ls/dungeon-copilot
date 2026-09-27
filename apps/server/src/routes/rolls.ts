import { resolveOpposed, resolveTest, type Random } from '@dungeon-copilot/rules';
import { rollRequestSchema, type RollResponse } from '@dungeon-copilot/shared';
import type { FastifyInstance } from 'fastify';
import { parseBody } from '../http/errors';

/** Tirador libre: no necesita sesión porque no guarda nada. */
export function registerRollRoutes(app: FastifyInstance, random: Random): void {
  app.post('/api/rolls', async (request): Promise<RollResponse> => {
    const body = parseBody(rollRequestSchema, request.body, 'La tirada no es válida');
    return body.kind === 'test'
      ? { kind: 'test', ...resolveTest(body.check, body.difficulty, random) }
      : { kind: 'opposed', ...resolveOpposed(body.actor, body.opponent, random) };
  });
}
