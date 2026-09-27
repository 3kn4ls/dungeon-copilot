import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const root = mkdtempSync(join(tmpdir(), 'dungeon-config-'));
const cwd = join(root, 'apps', 'server');
mkdirSync(cwd, { recursive: true });

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('loadConfig', () => {
  it('sin variables, usa PGlite en data/pglite y abre el registro', () => {
    expect(loadConfig({}, cwd)).toEqual({
      port: 3000,
      host: '0.0.0.0',
      dataDir: join(cwd, 'data', 'pglite'),
      cookieSecure: 'auto',
      allowRegistration: true,
    });
  });

  it('lee PostgreSQL, puerto e interruptores', () => {
    const config = loadConfig(
      {
        DATABASE_URL: 'postgres://dungeon@db:5432/dungeon',
        PORT: '8080',
        COOKIE_SECURE: 'true',
        ALLOW_REGISTRATION: 'no',
      },
      cwd,
    );
    expect(config).toMatchObject({
      databaseUrl: 'postgres://dungeon@db:5432/dungeon',
      port: 8080,
      cookieSecure: true,
      allowRegistration: false,
    });
  });

  it('las cookies seguras se deciden solas salvo que se fuercen', () => {
    expect(loadConfig({ COOKIE_SECURE: 'auto' }, cwd).cookieSecure).toBe('auto');
    expect(loadConfig({ COOKIE_SECURE: 'false' }, cwd).cookieSecure).toBe(false);
  });

  it('solo sirve la web si está compilada', () => {
    const dist = join(root, 'apps', 'web', 'dist');
    mkdirSync(dist, { recursive: true });
    expect(loadConfig({}, cwd).webDist).toBeUndefined();
    writeFileSync(join(dist, 'index.html'), '<!doctype html>');
    expect(loadConfig({}, cwd).webDist).toBe(dist);
  });

  it('rechaza valores que no entiende', () => {
    expect(() => loadConfig({ PORT: 'ochenta' }, cwd)).toThrow('PORT');
    expect(() => loadConfig({ COOKIE_SECURE: 'quizá' }, cwd)).toThrow('COOKIE_SECURE');
  });
});
