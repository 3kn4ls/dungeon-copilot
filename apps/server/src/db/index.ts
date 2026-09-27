import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import * as schema from './schema';

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Algo contra lo que lanzar consultas: la base de datos o una transacción abierta. */
export type Executor = Database | Transaction;

export interface DatabaseHandle {
  db: Database;
  kind: 'postgres' | 'pglite';
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  /** URL de PostgreSQL. Sin ella se usa PGlite, un PostgreSQL embebido. */
  url?: string;
  /** Carpeta de datos de PGlite, o "memory://" para una base en memoria. */
  dataDir?: string;
}

/**
 * Busca la carpeta de migraciones subiendo desde este archivo, para que funcione igual
 * desde el código fuente (tsx, tests) que desde el servidor empaquetado en dist/.
 */
function findMigrationsFolder(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'drizzle');
    if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate;
    dir = dirname(dir);
  }
  throw new Error('No se encuentra la carpeta de migraciones "drizzle"');
}

export async function openDatabase(options: DatabaseOptions): Promise<DatabaseHandle> {
  const migrationsFolder = findMigrationsFolder();

  if (options.url) {
    const pool = new pg.Pool({ connectionString: options.url });
    const db = drizzleNodePg(pool, { schema });
    return {
      db,
      kind: 'postgres',
      migrate: () => migrateNodePg(db, { migrationsFolder }),
      close: () => pool.end(),
    };
  }

  const dataDir = options.dataDir ?? 'memory://';
  // PGlite crea su carpeta de datos, pero no las carpetas que la contienen.
  if (!dataDir.includes('://')) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  return {
    db,
    kind: 'pglite',
    migrate: () => migratePglite(db, { migrationsFolder }),
    close: () => client.close(),
  };
}
