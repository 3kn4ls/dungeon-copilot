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

  it('la IA se activa con la dirección y el modelo de Ollama', () => {
    expect(loadConfig({}, cwd).ollama).toBeUndefined();
    expect(
      loadConfig({ OLLAMA_URL: ' http://ollama:11434 ', OLLAMA_MODEL: 'qwen2.5:7b' }, cwd).ollama,
    ).toEqual({ url: 'http://ollama:11434', model: 'qwen2.5:7b' });
    const cloud = loadConfig(
      { OLLAMA_URL: 'https://ollama.com', OLLAMA_MODEL: 'gpt-oss:120b', OLLAMA_API_KEY: 'clave' },
      cwd,
    );
    expect(cloud.ollama).toEqual({
      url: 'https://ollama.com',
      model: 'gpt-oss:120b',
      apiKey: 'clave',
    });
  });

  it('las sugerencias de la IA usan su propio modelo, con el otro o solas', () => {
    expect(
      loadConfig(
        {
          OLLAMA_URL: 'http://ollama:11434',
          OLLAMA_MODEL: 'qwen2.5:7b',
          OLLAMA_DECISION_MODEL: ' nimble ',
        },
        cwd,
      ).ollama,
    ).toEqual({ url: 'http://ollama:11434', model: 'qwen2.5:7b', decisionModel: 'nimble' });
    expect(
      loadConfig({ OLLAMA_URL: 'http://ollama:11434', OLLAMA_DECISION_MODEL: 'nimble' }, cwd)
        .ollama,
    ).toEqual({ url: 'http://ollama:11434', decisionModel: 'nimble' });
    expect(() => loadConfig({ OLLAMA_DECISION_MODEL: 'nimble' }, cwd)).toThrow('OLLAMA_URL');
  });

  it('avisa si a la IA le falta la dirección o el modelo', () => {
    expect(() => loadConfig({ OLLAMA_URL: 'http://ollama:11434' }, cwd)).toThrow('OLLAMA_MODEL');
    expect(() => loadConfig({ OLLAMA_MODEL: 'llama3.1' }, cwd)).toThrow('OLLAMA_URL');
    expect(() => loadConfig({ OLLAMA_URL: 'ollama:11434', OLLAMA_MODEL: 'x' }, cwd)).toThrow(
      'http://',
    );
    expect(() => loadConfig({ OLLAMA_URL: 'no es una url', OLLAMA_MODEL: 'x' }, cwd)).toThrow(
      'OLLAMA_URL',
    );
  });

  it('rechaza valores que no entiende', () => {
    expect(() => loadConfig({ PORT: 'ochenta' }, cwd)).toThrow('PORT');
    expect(() => loadConfig({ COOKIE_SECURE: 'quizá' }, cwd)).toThrow('COOKIE_SECURE');
  });
});
