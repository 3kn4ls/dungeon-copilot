import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
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
