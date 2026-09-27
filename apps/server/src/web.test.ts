import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { openDatabase, type DatabaseHandle } from './db';

let dist: string;
let handle: DatabaseHandle;
let app: FastifyInstance;

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), 'dungeon-web-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Dungeon Copilot</title>');
  writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log("hola")');
  // La web no toca la base de datos, pero la app la necesita para arrancar.
  handle = await openDatabase({ dataDir: 'memory://' });
  app = await buildApp({ db: handle.db, webDist: dist });
}, 30_000);

afterAll(async () => {
  await app.close();
  await handle.close();
  rmSync(dist, { recursive: true, force: true });
});

describe('servir la web compilada', () => {
  it('sirve index.html en la raíz y en cualquier pantalla, sin caché', async () => {
    for (const url of ['/', '/campanas/123', '/entrar?next=%2Fcampanas']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.body).toContain('Dungeon Copilot');
    }
  });

  it('cachea para siempre los archivos con hash de assets/', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('no responde con la página a archivos que no existen', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/index-viejo.js' });
    expect(response.statusCode).toBe(404);
  });

  it('no confunde rutas de la API con pantallas', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/no-existe' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Esa ruta no existe' });
  });
});
