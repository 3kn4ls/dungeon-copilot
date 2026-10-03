import { describe, expect, it } from 'vitest';
import type { GameEvent, GameEventPayload, GameEventVisibility } from './games';
import {
  currentMap,
  mapGridSchema,
  placeTokenSchema,
  tokenKey,
  updateMapSchema,
  type MapSnapshot,
  type TokenRef,
} from './maps';

const KAEL = '8b9f2a4e-1c2d-4e5f-9a8b-7c6d5e4f3a2b';
const BANDITS = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const AMBUSH = '1f0e2d3c-4b5a-4968-8776-655443322110';

const event = (
  id: number,
  payload: GameEventPayload,
  visibility: GameEventVisibility = 'public',
): GameEvent => ({
  ...payload,
  id,
  gameId: 'partida',
  visibility,
  authorName: 'Edu',
  createdAt: '2026-10-03T20:00:00.000Z',
});

const inn: MapSnapshot = {
  id: 'f3e2d1c0-b9a8-4776-8554-433221100fed',
  name: 'Posada del Ciervo Blanco',
  grid: { cols: 12, rows: 8, terrain: [{ x: 3, y: 3, kind: 'cover' }] },
};
const crypt: MapSnapshot = { ...inn, id: 'c0ffee00-0000-4000-8000-000000000001', name: 'Cripta' };

const kael: TokenRef = { kind: 'character', id: KAEL };
const bandit = (member: number) => ({ kind: 'combatant' as const, id: BANDITS, member });
const ambush: TokenRef = { kind: 'figure', id: AMBUSH };

describe('mapGridSchema', () => {
  it('un mapa de casillas con lo que hay en cada una', () => {
    expect(mapGridSchema.parse({ cols: 10, rows: 6 })).toEqual({ cols: 10, rows: 6, terrain: [] });
  });

  it('de 4 a 60 casillas de lado', () => {
    expect(mapGridSchema.safeParse({ cols: 3, rows: 6 }).success).toBe(false);
    expect(mapGridSchema.safeParse({ cols: 61, rows: 6 }).success).toBe(false);
  });

  it('nada fuera del mapa ni dos cosas en la misma casilla', () => {
    const outside = mapGridSchema.safeParse({
      cols: 10,
      rows: 6,
      terrain: [{ x: 10, y: 0, kind: 'wall' }],
    });
    expect(outside.error?.issues[0]?.message).toBe('Hay casillas fuera del mapa');
    const twice = mapGridSchema.safeParse({
      cols: 10,
      rows: 6,
      terrain: [
        { x: 2, y: 2, kind: 'wall' },
        { x: 2, y: 2, kind: 'door' },
      ],
    });
    expect(twice.error?.issues[0]?.message).toBe('En la casilla 2, 2 hay dos cosas a la vez');
  });

  it('con un plano de fondo, colocado en casillas', () => {
    const background = { image: AMBUSH, x: -0.5, y: 0, width: 12.5, height: 8 };
    expect(mapGridSchema.parse({ cols: 10, rows: 6, background })).toMatchObject({ background });
    expect(mapGridSchema.parse({ cols: 10, rows: 6, background: null }).background).toBeNull();
    const flat = mapGridSchema.safeParse({
      cols: 10,
      rows: 6,
      background: { ...background, width: 0 },
    });
    expect(flat.error?.issues[0]?.message).toBe('El ancho del plano no puede bajar de 0,5');
    expect(
      mapGridSchema.safeParse({ cols: 10, rows: 6, background: { ...background, image: 'plano' } })
        .success,
    ).toBe(false);
  });

  it('al cambiar un mapa hay que cambiar algo', () => {
    expect(updateMapSchema.safeParse({}).success).toBe(false);
    expect(updateMapSchema.safeParse({ name: 'Cripta' }).success).toBe(true);
  });
});

describe('placeTokenSchema', () => {
  it('pone, mueve o quita una ficha; de entrada, a la vista', () => {
    expect(placeTokenSchema.parse({ token: kael, at: { x: 1, y: 2 } })).toEqual({
      token: kael,
      at: { x: 1, y: 2 },
      hidden: false,
    });
    expect(placeTokenSchema.parse({ token: kael, at: null }).at).toBeNull();
  });

  it('las casillas son números enteros desde 0', () => {
    expect(placeTokenSchema.safeParse({ token: kael, at: { x: -1, y: 0 } }).success).toBe(false);
    expect(placeTokenSchema.safeParse({ token: kael, at: { x: 1.5, y: 0 } }).success).toBe(false);
  });
});

describe('tokenKey', () => {
  it('cada miembro de un grupo es una ficha distinta', () => {
    expect(tokenKey(bandit(0))).not.toBe(tokenKey(bandit(1)));
    expect(tokenKey(kael)).toBe(`character:${KAEL}`);
  });
});

describe('currentMap', () => {
  it('sin mapa en la partida, nada', () => {
    expect(currentMap([])).toBeNull();
  });

  it('las fichas, en la última casilla a la que se movieron', () => {
    const map = currentMap([
      event(1, { kind: 'map', map: inn }),
      event(2, { kind: 'token', token: kael, name: 'Kael', at: { x: 1, y: 1 } }),
      event(3, { kind: 'token', token: bandit(0), name: 'Bandidos 1', at: { x: 6, y: 2 } }),
      event(4, { kind: 'token', token: kael, name: 'Kael', at: { x: 2, y: 1 } }),
    ]);
    expect(map).toMatchObject({ name: 'Posada del Ciervo Blanco', grid: inn.grid });
    expect(map?.tokens).toEqual([
      { token: kael, name: 'Kael', at: { x: 2, y: 1 }, hidden: false, down: false },
      { token: bandit(0), name: 'Bandidos 1', at: { x: 6, y: 2 }, hidden: false, down: false },
    ]);
  });

  it('una ficha que se quita deja de estar', () => {
    const map = currentMap([
      event(1, { kind: 'map', map: inn }),
      event(2, { kind: 'token', token: kael, name: 'Kael', at: { x: 1, y: 1 } }),
      event(3, { kind: 'token', token: kael, name: 'Kael', at: null }),
    ]);
    expect(map?.tokens).toEqual([]);
  });

  it('al poner otro mapa, las fichas empiezan de cero; sin mapa, no hay fichas', () => {
    const moved = [
      event(1, { kind: 'map', map: inn }),
      event(2, { kind: 'token', token: kael, name: 'Kael', at: { x: 1, y: 1 } }),
      event(3, { kind: 'map', map: crypt }),
    ];
    expect(currentMap(moved)).toMatchObject({ name: 'Cripta', tokens: [] });
    expect(currentMap([...moved, event(4, { kind: 'map', map: null })])).toBeNull();
    // Una ficha sin mapa no cuenta.
    expect(
      currentMap([event(1, { kind: 'token', token: kael, name: 'Kael', at: { x: 0, y: 0 } })]),
    ).toBeNull();
  });

  it('el máster ve las fichas ocultas; la mesa, no, hasta que las enseña', () => {
    const hidden = event(
      2,
      { kind: 'token', token: ambush, name: 'Emboscada', at: { x: 9, y: 6 } },
      'master',
    );
    const shown = event(3, { kind: 'token', token: ambush, name: 'Emboscada', at: { x: 8, y: 6 } });
    const opened = event(1, { kind: 'map', map: inn });
    // El máster recibe todos los eventos; un jugador, solo los públicos.
    expect(currentMap([opened, hidden])?.tokens).toEqual([
      { token: ambush, name: 'Emboscada', at: { x: 9, y: 6 }, hidden: true, down: false },
    ]);
    expect(currentMap([opened])?.tokens).toEqual([]);
    expect(currentMap([opened, hidden, shown])?.tokens).toEqual([
      { token: ambush, name: 'Emboscada', at: { x: 8, y: 6 }, hidden: false, down: false },
    ]);
  });

  it('las figuras que entran en el combate pasan a ser sus fichas, a la vista', () => {
    const hidden = event(
      2,
      { kind: 'token', token: ambush, name: 'Emboscada', at: { x: 9, y: 6 } },
      'master',
    );
    const started = event(3, {
      kind: 'combatStarted',
      order: [],
      placed: [{ figure: AMBUSH, token: bandit(0), name: 'Bandidos 1', at: { x: 9, y: 6 } }],
    });
    const opened = event(1, { kind: 'map', map: inn });
    const shown = [{ token: bandit(0), name: 'Bandidos 1', at: { x: 9, y: 6 }, hidden: false }];
    // El máster y la mesa los ven igual, aunque la mesa no viera la figura.
    expect(currentMap([opened, hidden, started])?.tokens).toMatchObject(shown);
    expect(currentMap([opened, started])?.tokens).toMatchObject(shown);
  });

  it('los golpes dicen qué ficha de un grupo cae, también si se pone después', () => {
    const hit = (id: number, member: number, fell: boolean) =>
      event(id, {
        kind: 'damage',
        amount: 1,
        target: {
          kind: 'npc',
          id: BANDITS,
          name: 'Bandidos',
          count: 3,
          toughness: 1,
          harm: { down: fell ? 1 : 0, damage: 0 },
          fell,
          member,
        },
      });
    const map = currentMap([
      event(1, { kind: 'map', map: inn }),
      event(2, { kind: 'token', token: bandit(0), name: 'Bandidos 1', at: { x: 6, y: 2 } }),
      hit(3, 1, true),
      hit(4, 0, false),
      event(5, { kind: 'token', token: bandit(1), name: 'Bandidos 2', at: { x: 7, y: 2 } }),
    ]);
    expect(map?.tokens.map((token) => [token.name, token.down])).toEqual([
      ['Bandidos 1', false],
      ['Bandidos 2', true],
    ]);
  });
});
