import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { buildApp, type AppOptions } from './app';
import { SESSION_COOKIE } from './auth/sessions';
import { openDatabase, type Database, type DatabaseHandle } from './db';

/** scrypt barato: los tests no necesitan contraseñas difíciles de romper. */
export const TEST_PASSWORD_PARAMS = { N: 1024, r: 8, p: 1 };
export const TEST_PASSWORD = 'contraseña-de-prueba';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface TestClient {
  /** Cookie de sesión tal cual se envía en la cabecera, si hay sesión. */
  cookie: string | undefined;
  request(method: Method, url: string, payload?: object): Promise<LightMyRequestResponse>;
  get(url: string): Promise<LightMyRequestResponse>;
  post(url: string, payload?: object): Promise<LightMyRequestResponse>;
  put(url: string, payload: object): Promise<LightMyRequestResponse>;
  patch(url: string, payload: object): Promise<LightMyRequestResponse>;
  delete(url: string): Promise<LightMyRequestResponse>;
}

export function createClient(app: FastifyInstance, cookie?: string): TestClient {
  const client: TestClient = {
    cookie,
    request(method, url, payload) {
      const options: InjectOptions = { method, url };
      if (payload !== undefined) options.payload = payload;
      if (client.cookie) options.headers = { cookie: client.cookie };
      return app.inject(options);
    },
    get: (url) => client.request('GET', url),
    post: (url, payload) => client.request('POST', url, payload),
    put: (url, payload) => client.request('PUT', url, payload),
    patch: (url, payload) => client.request('PATCH', url, payload),
    delete: (url) => client.request('DELETE', url),
  };
  return client;
}

/** Extrae la cookie de sesión de una respuesta, lista para reenviarla. */
export function sessionCookie(response: LightMyRequestResponse) {
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  return cookie ? `${cookie.name}=${cookie.value}` : undefined;
}

async function withAdminClient(url: string, query: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(query);
  } finally {
    await client.end();
  }
}

/**
 * Sin más, los tests usan PGlite en memoria. Con TEST_DATABASE_URL apuntando a un
 * PostgreSQL real, cada archivo de tests crea allí su propia base de datos y la borra al acabar.
 */
async function openTestDatabase(): Promise<{ handle: DatabaseHandle; dispose(): Promise<void> }> {
  const serverUrl = process.env.TEST_DATABASE_URL;
  if (!serverUrl) {
    const handle = await openDatabase({ dataDir: 'memory://' });
    return { handle, dispose: () => handle.close() };
  }

  const name = `dungeon_test_${randomBytes(6).toString('hex')}`;
  await withAdminClient(serverUrl, `create database ${name}`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const handle = await openDatabase({ url: url.toString() });
  return {
    handle,
    async dispose() {
      await handle.close();
      await withAdminClient(serverUrl, `drop database if exists ${name}`);
    },
  };
}

type TestAppOptions = Omit<AppOptions, 'db'>;

/**
 * Una base de datos para todo el archivo de tests, vaciada antes de cada test.
 * Arrancarla cuesta unos segundos, así que no se crea una por test. Las opciones pueden
 * llegar como función cuando dependen de algo que se prepara antes, como un Ollama de mentira.
 */
export function useTestApp(options: TestAppOptions | (() => TestAppOptions) = {}) {
  let database: Awaited<ReturnType<typeof openTestDatabase>> | undefined;
  let handle: DatabaseHandle | undefined;
  let app: FastifyInstance | undefined;

  beforeAll(async () => {
    database = await openTestDatabase();
    handle = database.handle;
    await handle.migrate();
    const extra = typeof options === 'function' ? options() : options;
    app = await buildApp({ db: handle.db, passwordParams: TEST_PASSWORD_PARAMS, ...extra });
  }, 30_000);

  beforeEach(async () => {
    await handle?.db.execute(sql`truncate table users, campaigns cascade`);
  });

  afterAll(async () => {
    await app?.close();
    await database?.dispose();
  });

  const ready = () => {
    if (!app || !handle) throw new Error('La app de pruebas aún no está lista');
    return { app, db: handle.db };
  };

  return {
    get app(): FastifyInstance {
      return ready().app;
    },
    get db(): Database {
      return ready().db;
    },
    anonymous: () => createClient(ready().app),
    /** Crea una cuenta y devuelve un cliente con su sesión iniciada. */
    async register(username: string, displayName = username): Promise<TestClient> {
      const client = createClient(ready().app);
      const response = await client.post('/api/auth/register', {
        username,
        displayName,
        password: TEST_PASSWORD,
      });
      if (response.statusCode !== 201) {
        throw new Error(`No se pudo registrar ${username}: ${response.body}`);
      }
      client.cookie = sessionCookie(response);
      return client;
    },
  };
}
