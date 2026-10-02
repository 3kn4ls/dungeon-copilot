import fastifyCookie from '@fastify/cookie';
import type { Random } from '@dungeon-copilot/rules';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Decider } from './ai/decide';
import type { Ai } from './ai/ollama';
import { DEFAULT_SCRYPT_PARAMS, type ScryptParams } from './auth/password';
import type { AppContext } from './context';
import type { Database } from './db';
import { GameHub } from './games/hub';
import { registerErrorHandler } from './http/errors';
import { registerAiRoutes } from './routes/ai';
import { registerAuthRoutes } from './routes/auth';
import { registerCampaignRoutes } from './routes/campaigns';
import { registerCharacterRoutes } from './routes/characters';
import { registerCombatRoutes } from './routes/combat';
import { registerDamageRoutes } from './routes/damage';
import { registerDecisionRoutes } from './routes/decisions';
import { registerGameRoutes } from './routes/games';
import { registerNpcRoutes } from './routes/npcs';
import { registerRollRoutes } from './routes/rolls';
import { registerSceneRoutes } from './routes/scenes';
import { registerTableRoutes } from './routes/table';
import { registerWeb } from './web';

export interface AppOptions {
  db: Database;
  logger?: boolean;
  /** Fuente de aleatoriedad de las tiradas; los tests la fijan para que sean deterministas. */
  random?: Random;
  /** IA de los PNJ (Ollama). Sin ella, la web no ofrece lo que escribe la IA. */
  ai?: Ai | null;
  /** IA que sugiere decisiones (Nimble). Sin ella, la web no ofrece sus sugerencias. */
  decider?: Decider | null;
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
    ai: options.ai ?? null,
    decider: options.decider ?? null,
    random: options.random ?? Math.random,
    cookieSecure: options.cookieSecure ?? 'auto',
    allowRegistration: options.allowRegistration ?? true,
    passwordParams: options.passwordParams ?? DEFAULT_SCRYPT_PARAMS,
  };

  // La API solo habla JSON: así un formulario de otra web no puede colar peticiones.
  app.removeContentTypeParser('text/plain');
  registerErrorHandler(app);
  await app.register(fastifyCookie);
  // Los directos y las respuestas de la IA no terminan solos: al apagar se cortan para que el
  // cierre no se quede esperando.
  let closing = false;
  app.addHook('preClose', async () => {
    closing = true;
    ctx.hub.disconnectAll();
    ctx.ai?.close();
    ctx.decider?.close();
  });
  // Una respuesta que acaba ya apagando (la de la IA, que avisa del corte) deja libre una
  // conexión keep-alive después de que Fastify cerrara las libres; sin esto, el apagado espera
  // a que caduque (72 s) y k3s mata el proceso antes de cerrar la base de datos.
  app.addHook('onResponse', async () => {
    if (closing) app.server.closeIdleConnections();
  });

  // Sin apuntar cada petición en el registro: k3s la hace cada pocos segundos para saber si
  // el servidor sigue vivo, y taparía todo lo demás.
  app.get('/api/health', { logLevel: 'warn' }, async () => ({ status: 'ok' }));
  registerAuthRoutes(app, ctx);
  registerCampaignRoutes(app, ctx);
  registerCharacterRoutes(app, ctx);
  registerGameRoutes(app, ctx);
  registerTableRoutes(app, ctx);
  registerCombatRoutes(app, ctx);
  registerDamageRoutes(app, ctx);
  registerSceneRoutes(app, ctx);
  registerDecisionRoutes(app, ctx);
  registerNpcRoutes(app, ctx);
  registerAiRoutes(app, ctx);
  registerRollRoutes(app, ctx.random);
  await registerWeb(app, options.webDist);

  return app;
}
