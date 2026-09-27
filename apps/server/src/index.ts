import { buildApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db';

const config = loadConfig();
const database = await openDatabase(
  config.databaseUrl ? { url: config.databaseUrl } : { dataDir: config.dataDir },
);
await database.migrate();

const app = await buildApp({
  db: database.db,
  logger: true,
  cookieSecure: config.cookieSecure,
  allowRegistration: config.allowRegistration,
  webDist: config.webDist,
});
app.addHook('onClose', () => database.close());

app.log.info(
  database.kind === 'postgres'
    ? 'Base de datos: PostgreSQL'
    : `Base de datos: PGlite en ${config.dataDir}`,
);
if (!config.webDist) app.log.info('No hay web compilada: solo se sirve la API');

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
