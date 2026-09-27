import type { Random } from '@dungeon-copilot/rules';
import { fixedDice, kael } from '@dungeon-copilot/rules/testing';
import type { GameEvent } from '@dungeon-copilot/shared';
import { describe, expect, it } from 'vitest';
import { useTestApp, type TestClient } from '../testing';

let dice: Random = () => {
  throw new Error('Esta prueba no esperaba ninguna tirada');
};
const t = useTestApp({ random: () => dice() });
const loadDice = (...faces: number[]) => {
  dice = fixedDice(...faces);
};

/** Edu dirige; Ana juega con Kael y Bruno con Mira. */
async function table() {
  const master = await t.register('edu', 'Edu');
  const ana = await t.register('ana', 'Ana');
  const bruno = await t.register('bruno', 'Bruno');
  const campaign = (await master.post('/api/campaigns', { name: 'La Marca del Este' })).json()
    .campaign;
  for (const player of [ana, bruno]) {
    await player.post('/api/campaigns/join', { inviteCode: campaign.inviteCode });
  }
  const create = async (client: TestClient, name: string) =>
    (await client.post(`/api/campaigns/${campaign.id}/characters`, kael({ name }))).json()
      .character;
  const game = (await master.post(`/api/campaigns/${campaign.id}/games`, {})).json().game;
  return {
    master,
    ana,
    bruno,
    campaign,
    kael: await create(ana, 'Kael'),
    mira: await create(bruno, 'Mira'),
    url: `/api/games/${game.id}`,
  };
}

type RollEvent = GameEvent & { kind: 'roll' };

async function roll(client: TestClient, url: string, body: object, faces: number[]) {
  loadDice(...faces);
  const response = await client.post(`${url}/rolls`, body);
  expect(response.statusCode).toBe(201);
  return response.json().event as RollEvent;
}

/** Kael con Armas cuerpo a cuerpo (+6) contra una dificultad normal (10). */
const kaelSwings = (characterId: string, extra: object = {}) => ({
  actor: { kind: 'character', characterId, skill: 'melee-weapons' },
  target: { kind: 'difficulty', difficulty: 10 },
  situation: 'melee',
  ...extra,
});

async function reroll(client: TestClient, url: string, eventId: number, body = {}, faces = [6, 6]) {
  loadDice(...faces);
  return client.post(`${url}/rolls/${eventId}/reroll`, body);
}

const luckOf = async (client: TestClient, characterId: string): Promise<number> =>
  (await client.get(`/api/characters/${characterId}`)).json().character.luck;

describe('repetir tiradas con Suerte', () => {
  it('el jugador gasta un punto y repite su tirada: cuenta la segunda', async () => {
    const { ana, bruno, kael, url } = await table();
    // 1+2+6 = 9 contra 10: fallo.
    const first = await roll(ana, url, kaelSwings(kael.id), [1, 2]);
    expect(first.roll.result.outcome).toBe('failure');

    const response = await reroll(ana, url, first.id, {}, [5, 6]);
    expect(response.statusCode).toBe(201);
    const { event } = response.json();
    expect(event).toMatchObject({ kind: 'roll', visibility: 'public', authorName: 'Ana' });
    expect(event.roll).toMatchObject({
      actor: first.roll.actor,
      target: first.roll.target,
      situation: 'melee',
      reroll: { of: first.id, side: 'actor', sides: ['actor'] },
      // Mismo bonificador y misma dificultad; 5+6+6 = 17.
      result: {
        kind: 'test',
        roller: { bonus: 6, total: 17, dice: { kept: [5, 6], edge: 'none' } },
        difficulty: 10,
        outcome: 'success',
      },
    });
    expect(await luckOf(ana, kael.id)).toBe(2);
    const seen = (await bruno.get(url)).json().events.map((e: GameEvent) => e.id);
    expect(seen).toEqual(expect.arrayContaining([first.id, event.id]));

    // Cuenta la segunda: ni se repite otra vez la primera ni Kael repite la segunda.
    const again = await reroll(ana, url, first.id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('Esa tirada ya se ha repetido: cuenta la segunda');
    const twice = await reroll(ana, url, event.id);
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error).toBe('Kael ya ha repetido esta tirada');
    expect(await luckOf(ana, kael.id)).toBe(2);
  });

  it('en una tirada enfrentada cada personaje repite solo sus dados, una vez', async () => {
    const { master, ana, bruno, kael, mira, url } = await table();
    const guard = { kind: 'free', label: 'Guardia veterano', bonus: 4 };
    const defense = { kind: 'character', characterId: kael.id, skill: 'acrobatics' };
    // 5+5+4 = 14 contra 2+3+3 = 8: gana el guardia.
    const attack = await roll(
      master,
      url,
      { actor: guard, target: { kind: 'opposed', opponent: defense }, situation: 'melee' },
      [5, 5, 2, 3],
    );
    expect(attack.roll.result).toMatchObject({ kind: 'opposed', outcome: 'success' });
    if (attack.roll.result.kind !== 'opposed') throw new Error('Se esperaba una enfrentada');
    const guardDice = attack.roll.result.actor;

    const npc = await reroll(master, url, attack.id, { side: 'actor' });
    expect(npc.statusCode).toBe(400);
    expect(npc.json().error).toBe(
      'Guardia veterano no tiene Suerte: solo la tienen los personajes',
    );

    // Kael repite su defensa: 6+6+3 = 15, y su doble 6 baja un escalón el ataque.
    const defended = await reroll(ana, url, attack.id, { side: 'opponent' }, [6, 6]);
    expect(defended.statusCode).toBe(201);
    const { roll: repeated } = defended.json().event;
    expect(repeated.result.actor).toEqual(guardDice);
    expect(repeated.result.opponent).toMatchObject({ total: 15, dice: { kept: [6, 6] } });
    expect(repeated.result.outcome).toBe('fumble');

    // Entre dos personajes, cada uno repite los suyos una vez.
    const duel = await roll(
      master,
      url,
      {
        actor: { kind: 'character', characterId: mira.id, skill: 'melee-weapons' },
        target: {
          kind: 'opposed',
          opponent: { kind: 'character', characterId: kael.id, skill: 'melee-weapons' },
        },
      },
      [3, 3, 4, 4],
    );
    const miraAgain = await reroll(bruno, url, duel.id, { side: 'actor' }, [1, 2]);
    expect(miraAgain.statusCode).toBe(201);
    const miraEvent = miraAgain.json().event;
    const kaelAgain = await reroll(ana, url, miraEvent.id, { side: 'opponent' }, [2, 2]);
    expect(kaelAgain.statusCode).toBe(201);
    expect(kaelAgain.json().event.roll.reroll).toEqual({
      of: miraEvent.id,
      side: 'opponent',
      sides: ['actor', 'opponent'],
    });
    const miraTwice = await reroll(bruno, url, kaelAgain.json().event.id, { side: 'actor' });
    expect(miraTwice.statusCode).toBe(409);
    expect(miraTwice.json().error).toBe('Mira ya ha repetido esta tirada');
    expect(await luckOf(ana, kael.id)).toBe(1);
    expect(await luckOf(bruno, mira.id)).toBe(2);

    const test = await roll(ana, url, kaelSwings(kael.id), [3, 4]);
    const noRival = await reroll(ana, url, test.id, { side: 'opponent' });
    expect(noRival.statusCode).toBe(400);
    expect(noRival.json().error).toBe('Esa tirada es contra una dificultad: no tiene rival');
    const badSide = await reroll(ana, url, test.id, { side: 'rival' });
    expect(badSide.statusCode).toBe(400);
    expect(badSide.json().issues).toHaveLength(1);
  });

  it('la gastan su jugador o el máster, mientras le quede', async () => {
    const { master, ana, bruno, kael, url } = await table();
    const first = await roll(ana, url, kaelSwings(kael.id), [1, 2]);

    const notMine = await reroll(bruno, url, first.id);
    expect(notMine.statusCode).toBe(403);
    expect(notMine.json().error).toBe('Solo puedes gastar la Suerte de tus personajes');
    expect(await luckOf(ana, kael.id)).toBe(3);

    // En la mesa, el jugador lo dice y el máster pulsa.
    expect((await reroll(master, url, first.id)).statusCode).toBe(201);
    expect(await luckOf(ana, kael.id)).toBe(2);

    await ana.patch(`/api/characters/${kael.id}`, { luck: 0 });
    const broke = await roll(ana, url, kaelSwings(kael.id), [1, 2]);
    const noLuck = await reroll(ana, url, broke.id);
    expect(noLuck.statusCode).toBe(409);
    expect(noLuck.json().error).toBe('A Kael no le queda Suerte');
    expect(await luckOf(ana, kael.id)).toBe(0);
  });

  it('dos a la vez: solo una repite y la Suerte se gasta una vez', async () => {
    const { master, ana, kael, url } = await table();
    const first = await roll(ana, url, kaelSwings(kael.id), [1, 2]);
    loadDice(4, 4, 5, 5);
    const responses = await Promise.all([
      ana.post(`${url}/rolls/${first.id}/reroll`, {}),
      master.post(`${url}/rolls/${first.id}/reroll`, {}),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(await luckOf(ana, kael.id)).toBe(2);
  });

  it('las tiradas secretas, las que no existen y las de partidas terminadas no se repiten', async () => {
    const { master, ana, kael, url } = await table();
    const outsider = await t.register('intruso');
    const first = await roll(ana, url, kaelSwings(kael.id), [1, 2]);

    expect((await reroll(outsider, url, first.id)).statusCode).toBe(404);
    const anonymous = await t.app.inject({
      method: 'POST',
      url: `${url}/rolls/${first.id}/reroll`,
      payload: {},
    });
    expect(anonymous.statusCode).toBe(401);

    const events = (await master.get(url)).json().events as GameEvent[];
    const opened = events.find((event) => event.kind === 'opened');
    for (const id of [opened?.id, 999_999, 'abc', 2 ** 31]) {
      const response = await ana.post(`${url}/rolls/${id}/reroll`, {});
      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe('Esa tirada no existe en esta partida');
    }

    // El jugador no sabe que existe; el máster no gasta Suerte que el jugador no ha visto.
    const secret = await roll(master, url, kaelSwings(kael.id, { secret: true }), [1, 2]);
    expect((await reroll(ana, url, secret.id)).statusCode).toBe(404);
    const hidden = await reroll(master, url, secret.id);
    expect(hidden.statusCode).toBe(409);
    expect(hidden.json().error).toBe('Las tiradas secretas no se repiten con Suerte');

    await master.post(`${url}/close`, {});
    const closed = await reroll(ana, url, first.id);
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error).toBe('La partida ya ha terminado');
    expect(await luckOf(ana, kael.id)).toBe(3);
  });
});
