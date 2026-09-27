import type { AiStatus } from '@dungeon-copilot/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { requireUser } from './auth';

export function registerAiRoutes(app: FastifyInstance, { ai }: AppContext): void {
  /** Para que la web sepa si ofrecer lo que escribe la IA. */
  app.get('/api/ai', async (request): Promise<AiStatus> => {
    requireUser(request);
    return { enabled: ai !== null, model: ai?.model ?? null };
  });
}
