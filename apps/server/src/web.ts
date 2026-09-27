import { sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { ApiErrorBody } from '@dungeon-copilot/shared';
import type { FastifyInstance } from 'fastify';

/**
 * Sirve la web compilada y responde con index.html a cualquier ruta que no sea de la API,
 * para que funcionen los enlaces directos a pantallas (/campanas/...).
 */
export async function registerWeb(app: FastifyInstance, webDist: string | undefined) {
  if (webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      cacheControl: false,
      setHeaders(reply, path) {
        // Vite pone un hash en el nombre de todo lo que hay en assets/: se puede cachear siempre.
        const immutable = path.includes(`${sep}assets${sep}`);
        reply.header(
          'cache-control',
          immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    const isApi = path === '/api' || path.startsWith('/api/');
    // Un archivo que no existe (un JS de una versión anterior) es un 404, no la página.
    const isFile = /\.[a-z0-9]+$/i.test(path);
    if (webDist && !isApi && !isFile && (request.method === 'GET' || request.method === 'HEAD')) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({ error: 'Esa ruta no existe' } satisfies ApiErrorBody);
  });
}
