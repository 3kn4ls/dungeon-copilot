import { resolveOpposed, resolveTest, type Random } from '@dungeon-copilot/rules';
import { rollRequestSchema, type RollResponse } from '@dungeon-copilot/shared';
import Fastify, { type FastifyInstance } from 'fastify';

export interface AppOptions {
  logger?: boolean;
  /** Fuente de aleatoriedad de las tiradas; los tests la fijan para que sean deterministas. */
  random?: Random;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const random = options.random ?? Math.random;

  app.get('/api/health', async () => ({ status: 'ok' }));

  app.post('/api/rolls', async (request, reply) => {
    const parsed = rollRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'La tirada no es válida',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const body = parsed.data;
    const result: RollResponse =
      body.kind === 'test'
        ? { kind: 'test', ...resolveTest(body.check, body.difficulty, random) }
        : { kind: 'opposed', ...resolveOpposed(body.actor, body.opponent, random) };
    return result;
  });

  return app;
}
