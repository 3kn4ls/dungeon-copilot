import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '.';
import { users } from './schema';

const root = mkdtempSync(join(tmpdir(), 'dungeon-db-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('openDatabase con PGlite en disco', () => {
  it('crea las carpetas que faltan y conserva los datos al reabrir', async () => {
    const dataDir = join(root, 'data', 'pglite');
    const first = await openDatabase({ dataDir });
    await first.migrate();
    await first.db.insert(users).values({ username: 'ana', displayName: 'Ana', passwordHash: 'x' });
    await first.close();

    const second = await openDatabase({ dataDir });
    await second.migrate();
    const rows = await second.db.select({ username: users.username }).from(users);
    await second.close();
    expect(rows).toEqual([{ username: 'ana' }]);
  }, 30_000);
});

// Solo con un PostgreSQL de verdad (TEST_DATABASE_URL), como en la CI.
describe.skipIf(!process.env.TEST_DATABASE_URL)('openDatabase con PostgreSQL', () => {
  it('si PostgreSQL corta una conexión libre, avisa sin tumbar el servidor y abre otra', async () => {
    const url = new URL(process.env.TEST_DATABASE_URL ?? '');
    url.searchParams.set('application_name', 'prueba_corte');
    const cut: Error[] = [];
    const database = await openDatabase({
      url: url.toString(),
      onIdleError: (error) => cut.push(error),
    });
    const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.connect();
    try {
      await database.db.execute(sql`select 1`);
      // Como cuando PostgreSQL se reinicia: corta la conexión que el pool guarda libre.
      await admin.query(
        `select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'prueba_corte'`,
      );
      await vi.waitFor(() => expect(cut).toHaveLength(1));
      expect(cut[0]?.message).toMatch(/terminating connection/);
      await expect(database.db.execute(sql`select 1`)).resolves.toBeDefined();
    } finally {
      await admin.end();
      await database.close();
    }
  });
});
