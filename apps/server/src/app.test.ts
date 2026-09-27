import { fixedDice } from '@dungeon-copilot/rules/testing';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('GET /api/health', () => {
  it('responde que el servidor está vivo', async () => {
    const response = await buildApp().inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /api/rolls', () => {
  it('resuelve una prueba contra dificultad', async () => {
    const app = buildApp({ random: fixedDice(4, 5) });
    const response = await app.inject({
      method: 'POST',
      url: '/api/rolls',
      payload: { kind: 'test', check: { bonus: 4 }, difficulty: 10 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      kind: 'test',
      roller: { total: 13, dice: { kept: [4, 5] } },
      margin: 3,
      outcome: 'success',
    });
  });

  it('resuelve una tirada enfrentada, tirando también por el rival', async () => {
    const app = buildApp({ random: fixedDice(3, 3, 6, 6) });
    const response = await app.inject({
      method: 'POST',
      url: '/api/rolls',
      payload: { kind: 'opposed', actor: { bonus: 6 }, opponent: { bonus: 4, edge: 'none' } },
    });
    expect(response.json()).toMatchObject({
      kind: 'opposed',
      actor: { total: 12 },
      opponent: { total: 16 },
      outcome: 'fumble',
    });
  });

  it('rechaza peticiones mal formadas con un 400 explicativo', async () => {
    const response = await buildApp().inject({
      method: 'POST',
      url: '/api/rolls',
      payload: { kind: 'test', check: { bonus: 'mucho' }, difficulty: 10 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'La tirada no es válida',
      issues: [{ path: 'check.bonus' }],
    });
  });
});
