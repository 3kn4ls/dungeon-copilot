import { randomBytes } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import type { GameEvent, MapPing } from '@dungeon-copilot/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
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

/** Un directo abierto en un test. */
export interface TestStream {
  status: number;
  /** Siguiente evento, o "end" si el servidor cerró el directo. */
  next(): Promise<GameEvent | 'end'>;
  /** Siguiente casilla señalada, saltando los eventos que lleguen antes. */
  nextPing(): Promise<MapPing | 'end'>;
  close(): void;
}

/**
 * Para escuchar el directo de las partidas: necesita un servidor de verdad, porque inject espera
 * a que la respuesta termine. Arranca la app de `useTestApp` en un puerto libre y, al acabar
 * cada test, cierra los directos que queden abiertos. Devuelve con qué conectarse.
 */
export function useLiveStreams(t: { readonly app: FastifyInstance }) {
  let baseUrl = '';
  const streams: TestStream[] = [];

  beforeAll(async () => {
    baseUrl = await t.app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(() => {
    for (const stream of streams.splice(0)) stream.close();
  });

  return async function connect(
    path: string,
    client?: TestClient,
    headers: Record<string, string> = {},
  ): Promise<TestStream> {
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = httpRequest(`${baseUrl}${path}`, {
        // Una conexión solo para este directo: al cerrarlo se corta de verdad y el servidor se
        // entera. Con fetch, abortar deja el socket abierto y el directo sigue suscrito.
        agent: false,
        headers: { ...headers, ...(client?.cookie ? { cookie: client.cookie } : {}) },
      });
      request.on('response', resolve);
      request.on('error', reject);
      request.end();
    });
    response.setEncoding('utf8');
    const chunks: AsyncIterator<string> = response[Symbol.asyncIterator]();
    let buffer = '';
    /** El siguiente mensaje con datos: un evento o, con `event: ping`, una casilla señalada. */
    const read = async (): Promise<{ ping: boolean; data: unknown } | 'end'> => {
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary >= 0) {
          const block = buffer.slice(0, boundary).split('\n');
          buffer = buffer.slice(boundary + 2);
          const data = block
            .filter((line) => line.startsWith('data: '))
            .map((line) => line.slice('data: '.length))
            .join('\n');
          // Los bloques sin datos son el "retry" inicial o los comentarios de latido.
          if (data) return { ping: block.includes('event: ping'), data: JSON.parse(data) };
          continue;
        }
        const { value, done } = await chunks.next();
        if (done) return 'end';
        buffer += value;
      }
    };
    const stream: TestStream = {
      status: response.statusCode ?? 0,
      async next() {
        for (;;) {
          const message = await read();
          if (message === 'end') return 'end';
          if (!message.ping) return message.data as GameEvent;
        }
      },
      async nextPing() {
        for (;;) {
          const message = await read();
          if (message === 'end') return 'end';
          if (message.ping) return message.data as MapPing;
        }
      },
      close: () => response.destroy(),
    };
    streams.push(stream);
    return stream;
  };
}
