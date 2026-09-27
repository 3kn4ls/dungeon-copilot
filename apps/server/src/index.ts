import { createOllama } from './ai/ollama';
import { buildApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db';

const config = loadConfig();
// Hasta que exista el servidor, con su registro, los avisos de la base de datos van a la consola.
let warnIdleError = (error: Error) => console.warn(error);
const database = await openDatabase({
  ...(config.databaseUrl ? { url: config.databaseUrl } : { dataDir: config.dataDir }),
  onIdleError: (error) => warnIdleError(error),
});
await database.migrate();

const app = await buildApp({
  db: database.db,
  logger: true,
  cookieSecure: config.cookieSecure,
  allowRegistration: config.allowRegistration,
  webDist: config.webDist,
  ai: config.ollama ? createOllama(config.ollama) : null,
});
app.addHook('onClose', () => database.close());
warnIdleError = (error) =>
  app.log.warn(
    { err: error },
    'PostgreSQL cortó una conexión libre; la siguiente consulta abrirá otra',
  );

app.log.info(
  database.kind === 'postgres'
    ? 'Base de datos: PostgreSQL'
    : `Base de datos: PGlite en ${config.dataDir}`,
);
if (!config.webDist) app.log.info('No hay web compilada: solo se sirve la API');
app.log.info(
  config.ollama
    ? `IA: modelo ${config.ollama.model} en ${config.ollama.url}`
    : 'IA desactivada: para los PNJ con IA, pon OLLAMA_URL y OLLAMA_MODEL',
);

// Cierra la base de datos con calma al parar (Ctrl+C, o k3s al reiniciar el pod).
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error(error);
        process.exit(1);
      },
    );
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
