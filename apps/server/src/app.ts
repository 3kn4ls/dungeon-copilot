import fastifyCookie from '@fastify/cookie';
import type { Random } from '@dungeon-copilot/rules';
import Fastify, { type FastifyInstance } from 'fastify';
import { DEFAULT_SCRYPT_PARAMS, type ScryptParams } from './auth/password';
import type { AppContext } from './context';
import type { Database } from './db';
import { GameHub } from './games/hub';
import { registerErrorHandler } from './http/errors';
import { registerAuthRoutes } from './routes/auth';
import { registerCampaignRoutes } from './routes/campaigns';
import { registerCharacterRoutes } from './routes/characters';
import { registerGameRoutes } from './routes/games';
import { registerRollRoutes } from './routes/rolls';
import { registerWeb } from './web';

export interface AppOptions {
  db: Database;
  logger?: boolean;
  /** Fuente de aleatoriedad de las tiradas; los tests la fijan para que sean deterministas. */
  random?: Random;
  /** Cookies solo por HTTPS. Por defecto, "auto": según llegue la petición. */
  cookieSecure?: boolean | 'auto';
  allowRegistration?: boolean;
  /** Carpeta con la web compilada. Sin ella solo se sirve la API. */
  webDist?: string;
  /** Coste de scrypt. Los tests usan uno bajo para ir rápido. */
  passwordParams?: ScryptParams;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const ctx: AppContext = {
    db: options.db,
    hub: new GameHub(),
    random: options.random ?? Math.random,
    cookieSecure: options.cookieSecure ?? 'auto',
    allowRegistration: options.allowRegistration ?? true,
    passwordParams: options.passwordParams ?? DEFAULT_SCRYPT_PARAMS,
  };

  // La API solo habla JSON: así un formulario de otra web no puede colar peticiones.
  app.removeContentTypeParser('text/plain');
  registerErrorHandler(app);
  await app.register(fastifyCookie);
  // Los directos no terminan solos: al apagar se cortan para que el cierre no se quede esperando.
  app.addHook('preClose', async () => ctx.hub.disconnectAll());

  app.get('/api/health', async () => ({ status: 'ok' }));
  registerAuthRoutes(app, ctx);
  registerCampaignRoutes(app, ctx);
  registerCharacterRoutes(app, ctx);
  registerGameRoutes(app, ctx);
  registerRollRoutes(app, ctx.random);
  await registerWeb(app, options.webDist);

  return app;
}
