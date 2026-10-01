import type { Random } from '@dungeon-copilot/rules';
import { fixedDice, kael } from '@dungeon-copilot/rules/testing';
import { currentScene, type GameEvent } from '@dungeon-copilot/shared';
import { describe, expect, it } from 'vitest';
import { useTestApp, type TestClient } from '../testing';

let dice: Random = () => {
  throw new Error('Esta prueba no esperaba ninguna tirada');
};
const t = useTestApp({ random: () => dice() });

/** Kael con Erudito (Inteligencia 3, Saber 2): una vez por sesión. */
const SCHOLAR = {
  attributes: { strength: 3, dexterity: 3, charisma: 1, intelligence: 3, endurance: 2 },
  skills: { lore: 2, 'melee-weapons': 2, perception: 1, athletics: 1 },
  advancedSkills: ['scholar'],
};

/** Mira con Voz de mando (Carisma 4, Persuasión 2): una vez por escena. */
const COMMANDER = {
  attributes: { strength: 2, dexterity: 2, charisma: 4, intelligence: 2, endurance: 2 },
  skills: { persuasion: 2, deception: 1, perception: 1, athletics: 1, fencing: 1 },
  advancedSkills: ['commanding-voice'],
};

/** Edu dirige; Ana juega con Kael, que es erudito, y Bruno con Mira, que sabe mandar. */
async function table() {
  const master = await t.register('edu', 'Edu');
  const ana = await t.register('ana', 'Ana');
  const bruno = await t.register('bruno', 'Bruno');
  const campaign = (await master.post('/api/campaigns', { name: 'La Marca del Este' })).json()
    .campaign;
  for (const player of [ana, bruno]) {
    await player.post('/api/campaigns/join', { inviteCode: campaign.inviteCode });
  }
  const create = async (client: TestClient, sheet: object) => {
    const response = await client.post(`/api/campaigns/${campaign.id}/characters`, sheet);
    expect(response.statusCode).toBe(201);
    return response.json().character;
  };
  const kaelSheet = await create(ana, kael(SCHOLAR));
  const mira = await create(bruno, kael({ name: 'Mira', ...COMMANDER }));
  const game = (await master.post(`/api/campaigns/${campaign.id}/games`, {})).json().game;
  const { screenToken } = (await master.get(`/api/campaigns/${campaign.id}`)).json().campaign;
  return {
    master,
    ana,
    bruno,
    campaign,
    kael: kaelSheet,
    mira,
    url: `/api/games/${game.id}`,
    screenUrl: `/api/screens/${screenToken}`,
  };
}

const events = async (client: TestClient, url: string): Promise<GameEvent[]> =>
  (await client.get(url)).json().events;

async function created(response: Promise<{ statusCode: number; json(): { event: GameEvent } }>) {
  const done = await response;
  expect(done.statusCode).toBe(201);
  return done.json().event;
}

async function refused(
  response: Promise<{ statusCode: number; json(): { error: string } }>,
  status: number,
  error: string,
) {
  const done = await response;
  expect(done.statusCode).toBe(status);
  expect(done.json().error).toBe(error);
}

const scratchesOf = async (client: TestClient, id: string) =>
  (await client.get(`/api/characters/${id}`)).json().character.wounds.scratches;

describe('las escenas', () => {
  it('el máster empieza una escena y los personajes recuperan el aliento', async () => {
    const { master, ana, kael, mira, url, screenUrl } = await table();
    await master.post(`/api/characters/${kael.id}/damage`, { amount: 1 });

    const scene = await created(master.post(`${url}/scenes`, { title: ' La posada ' }));
    expect(scene).toMatchObject({
      kind: 'scene',
      visibility: 'public',
      title: 'La posada',
      recovered: [{ characterId: kael.id, name: 'Kael' }],
    });
    expect(await scratchesOf(ana, kael.id)).toBe(0);
    expect(currentScene(await events(ana, url))?.title).toBe('La posada');
    expect((await t.anonymous().get(screenUrl)).json().events.at(-1)).toEqual(scene);

    // Sin recuperar el aliento, los rasguños se quedan.
    await master.post(`/api/characters/${mira.id}/damage`, { amount: 1 });
    const tense = await created(
      master.post(`${url}/scenes`, { title: 'La persecución', recover: false }),
    );
    expect(tense).toMatchObject({ recovered: [] });
    expect(await scratchesOf(ana, mira.id)).toBe(1);
  });

  it('solo el máster, con título y no en pleno combate', async () => {
    const { master, ana, kael, url } = await table();
    await refused(
      ana.post(`${url}/scenes`, { title: 'La posada' }),
      403,
      'Solo el máster de la campaña puede hacer eso',
    );
    const untitled = await master.post(`${url}/scenes`, { title: ' ' });
    expect(untitled.statusCode).toBe(400);
    expect(untitled.json().issues).toEqual([
      { path: 'title', message: 'Pon un título a la escena' },
    ]);

    dice = fixedDice(3, 3, 3, 3);
    await created(
      master.post(`${url}/combat`, {
        combatants: [
          { kind: 'character', characterId: kael.id },
          { kind: 'npc', name: 'Lobos', profile: 'soldier', count: 2 },
        ],
      }),
    );
    await refused(
      master.post(`${url}/scenes`, { title: 'El bosque' }),
      409,
      'Hay un combate en juego: termínalo antes de cambiar de escena',
    );
  });
});

describe('las técnicas que se gastan', () => {
  it('las de una vez por escena vuelven con la escena siguiente', async () => {
    const { master, bruno, mira, url } = await table();
    const used = await created(
      bruno.post(`${url}/abilities`, { characterId: mira.id, skill: 'commanding-voice' }),
    );
    expect(used).toMatchObject({
      kind: 'ability',
      visibility: 'public',
      characterId: mira.id,
      name: 'Mira',
      skill: 'commanding-voice',
      label: 'Voz de mando',
    });
    await refused(
      master.post(`${url}/abilities`, { characterId: mira.id, skill: 'commanding-voice' }),
      409,
      'Mira ya ha usado Voz de mando en esta escena',
    );
    await created(master.post(`${url}/scenes`, { title: 'El bosque' }));
    await created(
      master.post(`${url}/abilities`, { characterId: mira.id, skill: 'commanding-voice' }),
    );
  });

  it('las de una vez por sesión duran toda la partida', async () => {
    const { master, ana, kael, url } = await table();
    await created(ana.post(`${url}/abilities`, { characterId: kael.id, skill: 'scholar' }));
    await created(master.post(`${url}/scenes`, { title: 'La biblioteca' }));
    await refused(
      ana.post(`${url}/abilities`, { characterId: kael.id, skill: 'scholar' }),
      409,
      'Kael ya ha usado Erudito en esta sesión',
    );
  });

  it('solo las usa quien las tiene, y solo las que se gastan', async () => {
    const { ana, bruno, campaign, kael: kaelSheet, mira, url } = await table();
    await refused(
      ana.post(`${url}/abilities`, { characterId: mira.id, skill: 'commanding-voice' }),
      403,
      'Solo puedes usar las técnicas de tus personajes',
    );
    await refused(
      bruno.post(`${url}/abilities`, { characterId: mira.id, skill: 'scholar' }),
      400,
      'Mira no tiene Erudito',
    );
    for (const skill of ['lore', 'volar']) {
      await refused(
        ana.post(`${url}/abilities`, { characterId: kaelSheet.id, skill }),
        400,
        'Esa técnica no existe',
      );
    }
    // Carga brutal se usa siempre que haga falta: no se gasta.
    const tor = (
      await ana.post(`/api/campaigns/${campaign.id}/characters`, kael({ name: 'Tor' }))
    ).json().character;
    await refused(
      ana.post(`${url}/abilities`, { characterId: tor.id, skill: 'brutal-charge' }),
      400,
      'Carga brutal no se gasta: se usa siempre que haga falta',
    );
  });
});
