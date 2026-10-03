import type { Random } from '@dungeon-copilot/rules';
import { fixedDice, kael } from '@dungeon-copilot/rules/testing';
import {
  currentMap,
  type GameEvent,
  type MapRequest,
  type MapView,
  type PlaceTokenRequest,
} from '@dungeon-copilot/shared';
import { describe, expect, it } from 'vitest';
import { useTestApp, type TestClient } from '../testing';

let dice: Random = () => {
  throw new Error('Esta prueba no esperaba ninguna tirada');
};
const t = useTestApp({ random: () => dice() });

/** La posada: 12 × 8, con un muro en (5, 0) y una mesa en (3, 3). */
const inn: MapRequest = {
  name: ' Posada del Ciervo Blanco ',
  grid: {
    cols: 12,
    rows: 8,
    terrain: [
      { x: 5, y: 0, kind: 'wall' },
      { x: 3, y: 3, kind: 'cover' },
    ],
  },
};

/**
 * Edu dirige; Ana juega con Kael y Bruno con Mira. Una partida en juego, y Carla, que no es de
 * la campaña.
 */
async function table() {
  const master = await t.register('edu', 'Edu');
  const ana = await t.register('ana', 'Ana');
  const bruno = await t.register('bruno', 'Bruno');
  const carla = await t.register('carla', 'Carla');
  const campaign = (await master.post('/api/campaigns', { name: 'La Marca del Este' })).json()
    .campaign;
  for (const player of [ana, bruno]) {
    await player.post('/api/campaigns/join', { inviteCode: campaign.inviteCode });
  }
  const kaelSheet = (await ana.post(`/api/campaigns/${campaign.id}/characters`, kael())).json()
    .character;
  const mira = (
    await bruno.post(`/api/campaigns/${campaign.id}/characters`, kael({ name: 'Mira' }))
  ).json().character;
  const game = (await master.post(`/api/campaigns/${campaign.id}/games`, {})).json().game;
  const { screenToken } = (await master.get(`/api/campaigns/${campaign.id}`)).json().campaign;
  return {
    master,
    ana,
    bruno,
    carla,
    campaign,
    kael: kaelSheet,
    mira,
    url: `/api/games/${game.id}`,
    screenUrl: `/api/screens/${screenToken}`,
  };
}

async function createMap(master: TestClient, campaignId: string, body = inn): Promise<MapView> {
  const response = await master.post(`/api/campaigns/${campaignId}/maps`, body);
  expect(response.statusCode).toBe(201);
  return response.json().map;
}

/** Una partida con la posada en juego. */
async function onTheMap() {
  const setup = await table();
  const map = await createMap(setup.master, setup.campaign.id);
  expect((await setup.master.put(`${setup.url}/map`, { mapId: map.id })).statusCode).toBe(201);
  return { ...setup, map };
}

const events = async (client: TestClient, url: string): Promise<GameEvent[]> =>
  (await client.get(url)).json().events;

const place = (client: TestClient, url: string, body: PlaceTokenRequest) =>
  client.post(`${url}/tokens`, body);

const FIGURE = '1f0e2d3c-4b5a-4968-8776-655443322110';

describe('mapas de la campaña', () => {
  it('el máster los crea, los cambia y los borra; la lista va por orden alfabético', async () => {
    const { master, campaign } = await table();
    const map = await createMap(master, campaign.id);
    expect(map).toMatchObject({
      campaignId: campaign.id,
      name: 'Posada del Ciervo Blanco',
      grid: inn.grid,
    });
    await createMap(master, campaign.id, { name: 'Cripta', grid: { cols: 6, rows: 6 } });
    const list = (await master.get(`/api/campaigns/${campaign.id}/maps`)).json().maps;
    expect(list.map((other: MapView) => other.name)).toEqual([
      'Cripta',
      'Posada del Ciervo Blanco',
    ]);

    const changed = await master.patch(`/api/maps/${map.id}`, { name: 'La posada' });
    expect(changed.json().map).toMatchObject({ name: 'La posada', grid: inn.grid });
    expect((await master.delete(`/api/maps/${map.id}`)).statusCode).toBe(204);
    expect((await master.get(`/api/maps/${map.id}`)).statusCode).toBe(404);
  });

  it('un mapa con casillas fuera de él no se guarda', async () => {
    const { master, campaign } = await table();
    const response = await master.post(`/api/campaigns/${campaign.id}/maps`, {
      name: 'Raro',
      grid: { cols: 6, rows: 6, terrain: [{ x: 6, y: 0, kind: 'wall' }] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().issues[0].message).toBe('Hay casillas fuera del mapa');
  });

  it('son del máster: a un jugador, 403; a quien no es de la campaña, 404', async () => {
    const { master, ana, carla, campaign } = await table();
    const map = await createMap(master, campaign.id);
    expect((await ana.get(`/api/campaigns/${campaign.id}/maps`)).statusCode).toBe(403);
    expect((await ana.post(`/api/campaigns/${campaign.id}/maps`, inn)).statusCode).toBe(403);
    expect((await ana.get(`/api/maps/${map.id}`)).statusCode).toBe(403);
    expect((await carla.get(`/api/campaigns/${campaign.id}/maps`)).statusCode).toBe(404);
    expect((await carla.get(`/api/maps/${map.id}`)).statusCode).toBe(404);
    expect((await carla.delete(`/api/maps/${map.id}`)).statusCode).toBe(404);
  });
});

describe('el mapa de la partida', () => {
  it('el máster lo pone y lo ve toda la mesa, tal como era entonces', async () => {
    const { master, ana, url, screenUrl, map } = await onTheMap();
    for (const list of [
      await events(ana, url),
      (await t.anonymous().get(screenUrl)).json().events,
    ]) {
      expect(currentMap(list)).toEqual({
        id: map.id,
        name: 'Posada del Ciervo Blanco',
        grid: inn.grid,
        tokens: [],
      });
    }
    // Cambiar el mapa de la campaña no cambia el de la partida.
    await master.patch(`/api/maps/${map.id}`, { name: 'La posada' });
    expect(currentMap(await events(ana, url))?.name).toBe('Posada del Ciervo Blanco');
  });

  it('se quita, y sin mapa no hay nada que quitar', async () => {
    const { master, ana, url } = await onTheMap();
    expect((await master.put(`${url}/map`, { mapId: null })).statusCode).toBe(201);
    expect(currentMap(await events(ana, url))).toBeNull();
    expect((await master.put(`${url}/map`, { mapId: null })).statusCode).toBe(409);
  });

  it('solo el máster, y solo con mapas de su campaña', async () => {
    const { master, ana, url, map } = await onTheMap();
    expect((await ana.put(`${url}/map`, { mapId: map.id })).statusCode).toBe(403);
    const other = (await master.post('/api/campaigns', { name: 'Otra' })).json().campaign;
    const foreign = await createMap(master, other.id);
    expect((await master.put(`${url}/map`, { mapId: foreign.id })).statusCode).toBe(404);
  });
});

describe('las fichas', () => {
  it('sin mapa no se pone ninguna', async () => {
    const { master, kael, url } = await table();
    const response = await place(master, url, {
      token: { kind: 'character', id: kael.id },
      at: { x: 1, y: 1 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('No hay ningún mapa en la partida');
  });

  it('el máster las pone y las mueve; la mesa las ve con el nombre de entonces', async () => {
    const { master, bruno, kael, url } = await onTheMap();
    const token = { kind: 'character' as const, id: kael.id };
    expect((await place(master, url, { token, at: { x: 1, y: 1 } })).statusCode).toBe(201);
    expect((await place(master, url, { token, at: { x: 2, y: 1 } })).statusCode).toBe(201);
    expect(currentMap(await events(bruno, url))?.tokens).toEqual([
      { token, name: 'Kael', at: { x: 2, y: 1 }, hidden: false },
    ]);
    expect((await place(master, url, { token, at: null })).statusCode).toBe(201);
    expect(currentMap(await events(bruno, url))?.tokens).toEqual([]);
    expect((await place(master, url, { token, at: null })).statusCode).toBe(404);
  });

  it('no se puede estar en un muro, un mueble ni fuera del mapa', async () => {
    const { master, kael, url } = await onTheMap();
    const token = { kind: 'character' as const, id: kael.id };
    expect((await place(master, url, { token, at: { x: 5, y: 0 } })).statusCode).toBe(409);
    expect((await place(master, url, { token, at: { x: 3, y: 3 } })).statusCode).toBe(409);
    expect((await place(master, url, { token, at: { x: 12, y: 0 } })).statusCode).toBe(409);
  });

  it('cada jugador mueve solo la ficha de su personaje, y a la vista', async () => {
    const { ana, kael, mira, url } = await onTheMap();
    expect(
      (await place(ana, url, { token: { kind: 'character', id: kael.id }, at: { x: 1, y: 1 } }))
        .statusCode,
    ).toBe(201);
    expect(
      (await place(ana, url, { token: { kind: 'character', id: mira.id }, at: { x: 2, y: 2 } }))
        .statusCode,
    ).toBe(403);
    const figure = { kind: 'figure' as const, id: FIGURE };
    expect(
      (await place(ana, url, { token: figure, at: { x: 2, y: 2 }, name: 'Rata' })).statusCode,
    ).toBe(403);
    expect(
      (
        await place(ana, url, {
          token: { kind: 'character', id: kael.id },
          at: { x: 1, y: 2 },
          hidden: true,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('en combate, cada personaje se mueve en su turno; los PNJ, el máster, uno a uno', async () => {
    const { master, ana, bruno, kael, mira, url } = await onTheMap();
    // Mira (14) y luego los bandidos (9) y Kael (8).
    dice = fixedDice(2, 3, 6, 5, 4, 4);
    const started = await master.post(`${url}/combat`, {
      combatants: [
        { kind: 'character', characterId: kael.id },
        { kind: 'character', characterId: mira.id },
        { kind: 'npc', name: 'Bandidos', profile: 'minion', count: 3 },
      ],
    });
    expect(started.statusCode).toBe(201);
    const bandits = started.json().event.order.find((one: { kind: string }) => one.kind === 'npc');

    const kaelToken = { kind: 'character' as const, id: kael.id };
    const moved = await place(ana, url, { token: kaelToken, at: { x: 1, y: 1 } });
    expect(moved.statusCode).toBe(409);
    expect(moved.json().error).toBe('Kael solo se mueve en su turno');
    expect(
      (await place(bruno, url, { token: { kind: 'character', id: mira.id }, at: { x: 2, y: 2 } }))
        .statusCode,
    ).toBe(201);
    // El máster mueve a quien quiera.
    expect((await place(master, url, { token: kaelToken, at: { x: 1, y: 1 } })).statusCode).toBe(
      201,
    );

    const bandit = (member: number) => ({ kind: 'combatant' as const, id: bandits.id, member });
    expect((await place(master, url, { token: bandit(1), at: { x: 8, y: 4 } })).statusCode).toBe(
      201,
    );
    expect((await place(master, url, { token: bandit(3), at: { x: 8, y: 5 } })).statusCode).toBe(
      404,
    );
    expect((await place(ana, url, { token: bandit(0), at: { x: 8, y: 5 } })).statusCode).toBe(403);
    expect(currentMap(await events(ana, url))?.tokens).toContainEqual({
      token: bandit(1),
      name: 'Bandidos 2',
      at: { x: 8, y: 4 },
      hidden: false,
    });
  });

  it('las de quien pelea, solo con combate', async () => {
    const { master, url } = await onTheMap();
    const response = await place(master, url, {
      token: { kind: 'combatant', id: FIGURE, member: 0 },
      at: { x: 1, y: 1 },
    });
    expect(response.statusCode).toBe(409);
  });
});

describe('las fichas ocultas', () => {
  const ambush = { kind: 'figure' as const, id: FIGURE };

  it('el máster esconde figuras: no llegan a los jugadores ni a la pantalla hasta que las enseña', async () => {
    const { master, ana, url, screenUrl } = await onTheMap();
    const hidden = await place(master, url, {
      token: ambush,
      at: { x: 10, y: 6 },
      hidden: true,
      name: 'Emboscada',
    });
    expect(hidden.statusCode).toBe(201);
    expect(hidden.json().event).toMatchObject({ visibility: 'master', name: 'Emboscada' });

    expect(currentMap(await events(master, url))?.tokens).toEqual([
      { token: ambush, name: 'Emboscada', at: { x: 10, y: 6 }, hidden: true },
    ]);
    const screen = async () => (await t.anonymous().get(screenUrl)).json().events;
    for (const list of [await events(ana, url), await screen()]) {
      expect(list.some((event: GameEvent) => event.kind === 'token')).toBe(false);
      expect(currentMap(list)?.tokens).toEqual([]);
    }

    // Moverla sin esconderla la enseña, con su nombre.
    expect((await place(master, url, { token: ambush, at: { x: 9, y: 6 } })).statusCode).toBe(201);
    expect(currentMap(await events(ana, url))?.tokens).toEqual([
      { token: ambush, name: 'Emboscada', at: { x: 9, y: 6 }, hidden: false },
    ]);
  });

  it('lo que la mesa ya ve no se esconde, y los personajes tampoco', async () => {
    const { master, kael, url } = await onTheMap();
    await place(master, url, { token: ambush, at: { x: 9, y: 6 }, name: 'Rata' });
    const again = await place(master, url, { token: ambush, at: { x: 10, y: 6 }, hidden: true });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe(
      'La mesa ya ve esa ficha: quítala del mapa antes de esconderla',
    );
    const character = await place(master, url, {
      token: { kind: 'character', id: kael.id },
      at: { x: 1, y: 1 },
      hidden: true,
    });
    expect(character.statusCode).toBe(409);
  });

  it('una oculta que se quita no llega a la mesa', async () => {
    const { master, ana, url } = await onTheMap();
    await place(master, url, { token: ambush, at: { x: 10, y: 6 }, hidden: true, name: 'Rata' });
    const removed = await place(master, url, { token: ambush, at: null });
    expect(removed.json().event.visibility).toBe('master');
    expect((await events(ana, url)).some((event) => event.kind === 'token')).toBe(false);
  });

  it('una figura necesita nombre', async () => {
    const { master, url } = await onTheMap();
    const response = await place(master, url, { token: ambush, at: { x: 1, y: 1 } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Ponle un nombre a la figura');
  });
});
