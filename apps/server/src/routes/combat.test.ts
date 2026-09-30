import type { Random } from '@dungeon-copilot/rules';
import { fixedDice, kael } from '@dungeon-copilot/rules/testing';
import {
  currentCombat,
  currentFloor,
  type Combatant,
  type CombatantRequest,
  type GameEvent,
} from '@dungeon-copilot/shared';
import { describe, expect, it } from 'vitest';
import { useTestApp, type TestClient } from '../testing';

let dice: Random = () => {
  throw new Error('Esta prueba no esperaba ninguna tirada');
};
const t = useTestApp({ random: () => dice() });
const loadDice = (...faces: number[]) => {
  dice = fixedDice(...faces);
};

/** Mira con Táctico (Inteligencia 4, Percepción 2). */
const TACTICIAN = {
  attributes: { strength: 2, dexterity: 3, charisma: 1, intelligence: 4, endurance: 2 },
  skills: { perception: 2, 'melee-weapons': 2, athletics: 1, survival: 1 },
  advancedSkills: ['tactician'],
};

/** Mira con Hechicería (Inteligencia 4, Arcano 2). */
const SORCERER = {
  ...TACTICIAN,
  skills: { arcana: 2, perception: 2, athletics: 1, survival: 1 },
  advancedSkills: ['sorcery'],
};

/**
 * Edu dirige; Ana juega con Kael y Bruno con Mira (como Kael, salvo lo que se diga). La partida
 * ya está en juego.
 */
async function table(miraSheet: object = {}) {
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
  const kaelSheet = await create(ana, kael());
  const mira = await create(bruno, kael({ name: 'Mira', ...miraSheet }));
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

type Table = Awaited<ReturnType<typeof table>>;

const events = async (client: TestClient, url: string): Promise<GameEvent[]> =>
  (await client.get(url)).json().events;
const kinds = (list: GameEvent[]) => list.map((event) => event.kind);
const names = (order: Combatant[]) => order.map((combatant) => combatant.name);

/** Lo que responde el servidor a una acción que crea un evento. */
async function created(response: Promise<{ statusCode: number; json(): { event: GameEvent } }>) {
  const done = await response;
  expect(done.statusCode).toBe(201);
  return done.json().event;
}

const character = (id: string): CombatantRequest => ({ kind: 'character', characterId: id });
const bandits: CombatantRequest = { kind: 'npc', name: '3 bandidos', profile: 'minion' };

/** El combate de siempre: Mira (14), los bandidos (9) y Kael (8). */
async function fight({ master, kael, mira, url }: Table) {
  loadDice(2, 3, 6, 5, 4, 4);
  const started = await created(
    master.post(`${url}/combat`, {
      combatants: [character(kael.id), character(mira.id), bandits],
    }),
  );
  if (started.kind !== 'combatStarted') throw new Error('No ha empezado el combate');
  return started.order;
}

/** El combate en juego y quién tiene la palabra, según lo que ve `client`. */
async function state(client: TestClient, url: string) {
  const list = await events(client, url);
  return { combat: currentCombat(list), floor: currentFloor(list) };
}

describe('empezar un combate', () => {
  it('el máster elige quién pelea y el servidor tira la iniciativa por todos', async () => {
    const tableState = await table();
    const { bruno, url, screenUrl } = tableState;
    const order = await fight(tableState);
    expect(names(order)).toEqual(['Mira', '3 bandidos', 'Kael']);
    expect(order.map((combatant) => combatant.initiative.total)).toEqual([14, 9, 8]);
    // Los bandidos tiran con la Destreza de su perfil: la de un esbirro es 1.
    expect(order[1]).toMatchObject({
      kind: 'npc',
      name: '3 bandidos',
      profile: 'minion',
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      initiative: { bonus: 1, total: 9, dice: { kept: [4, 4] }, notes: [] },
    });

    // Lo ve toda la mesa, también la pantalla, y la palabra es de quien empieza.
    for (const list of [
      await events(bruno, url),
      (await t.anonymous().get(screenUrl)).json().events,
    ]) {
      expect(kinds(list)).toEqual(['opened', 'combatStarted']);
    }
    const { combat, floor } = await state(bruno, url);
    expect(combat).toMatchObject({ round: 1, turn: 0 });
    expect(floor).toEqual({ kind: 'character', characterId: tableState.mira.id, name: 'Mira' });
  });

  it('Táctico da ventaja a todo su bando, y una herida grave, desventaja', async () => {
    const { master, kael, mira, url } = await table(TACTICIAN);
    // Aguante 2: dos rasguños y dos niveles, herida grave.
    await master.post(`/api/characters/${kael.id}/damage`, { amount: 4 });
    // Kael: ventaja y desventaja se anulan (2 dados). Mira: ventaja (3). Los bandidos: 2.
    loadDice(1, 1, 6, 1, 6, 3, 3);
    const started = await created(
      master.post(`${url}/combat`, {
        combatants: [character(kael.id), character(mira.id), bandits],
      }),
    );
    expect(started.kind === 'combatStarted' && started.order).toMatchObject([
      {
        name: 'Mira',
        initiative: {
          total: 15,
          dice: { edge: 'advantage', kept: [6, 6] },
          notes: ['Ventaja por Táctico (Mira)'],
        },
      },
      { name: '3 bandidos', initiative: { total: 7, notes: [] } },
      {
        name: 'Kael',
        initiative: {
          total: 5,
          dice: { edge: 'none' },
          notes: ['Ventaja por Táctico (Mira)', 'Desventaja por su herida grave'],
        },
      },
    ]);
  });

  it('los empates, para los PJ', async () => {
    const { master, kael, url } = await table();
    loadDice(3, 3, 3, 3);
    const started = await created(
      master.post(`${url}/combat`, {
        // Un veterano tiene Destreza 3, como Kael.
        combatants: [{ kind: 'npc', name: 'Capitán', profile: 'veteran' }, character(kael.id)],
      }),
    );
    expect(started.kind === 'combatStarted' && names(started.order)).toEqual(['Kael', 'Capitán']);
  });

  it('solo lo empieza el máster, con personajes y PNJ de la campaña', async () => {
    const { master, ana, campaign, kael: kaelSheet, url } = await table();
    const body = { combatants: [character(kaelSheet.id), bandits] };
    const player = await ana.post(`${url}/combat`, body);
    expect(player.statusCode).toBe(403);
    expect(player.json().error).toBe('Solo el máster de la campaña puede hacer eso');

    const other = (await ana.post('/api/campaigns', { name: 'Otra' })).json().campaign;
    const stranger = (await ana.post(`/api/campaigns/${other.id}/characters`, kael())).json()
      .character;
    const elsewhere = await master.post(`${url}/combat`, {
      combatants: [character(kaelSheet.id), character(stranger.id)],
    });
    expect(elsewhere.statusCode).toBe(404);
    expect(elsewhere.json().error).toBe('Ese personaje no está en esta campaña');
    const foreignNpc = (await ana.post(`/api/campaigns/${other.id}/npcs`, { name: 'Lobo' })).json()
      .npc;
    const wrongNpc = await master.post(`${url}/combat`, {
      combatants: [character(kaelSheet.id), { ...bandits, npcId: foreignNpc.id }],
    });
    expect(wrongNpc.statusCode).toBe(404);
    expect(wrongNpc.json().error).toBe('Ese PNJ no está en esta campaña');

    const alone = await master.post(`${url}/combat`, { combatants: [character(kaelSheet.id)] });
    expect(alone.statusCode).toBe(400);
    expect(alone.json().issues).toEqual([
      { path: 'combatants', message: 'Un combate necesita al menos a dos: elige quién pelea' },
    ]);
    expect(kinds(await events(master, url))).toEqual(['opened']);

    // Un PNJ de la campaña pelea con el nombre y el perfil que elige el máster.
    const brunilda = (
      await master.post(`/api/campaigns/${campaign.id}/npcs`, { name: 'Brunilda' })
    ).json().npc;
    loadDice(1, 1, 1, 1);
    const started = await created(
      master.post(`${url}/combat`, {
        combatants: [
          character(kaelSheet.id),
          { kind: 'npc', name: 'Brunilda', profile: 'champion', npcId: brunilda.id },
        ],
      }),
    );
    // Con Destreza 4, la de un campeón, Brunilda actúa antes que Kael.
    expect(started.kind === 'combatStarted' && started.order).toMatchObject([
      { name: 'Brunilda', npcId: brunilda.id, initiative: { bonus: 4, total: 6 } },
      { name: 'Kael', initiative: { bonus: 3, total: 5 } },
    ]);

    const again = await master.post(`${url}/combat`, body);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('Ya hay un combate en juego: termínalo antes de empezar otro');
  });

  it('puede atender a quien ha atacado', async () => {
    const { master, ana, kael, url } = await table();
    const attack = await created(
      ana.post(`${url}/interventions`, {
        characterId: kael.id,
        intent: 'attack',
        text: 'Le tiro la jarra al del fondo',
      }),
    );
    loadDice(1, 2, 3, 4);
    const started = await created(
      master.post(`${url}/combat`, {
        combatants: [character(kael.id), bandits],
        answers: attack.id,
      }),
    );
    expect(started).toMatchObject({ kind: 'combatStarted', answers: attack.id });
    // Ya no espera: puede intervenir otra vez.
    await created(ana.post(`${url}/interventions`, { characterId: kael.id, intent: 'melee' }));
  });

  it('en una partida terminada ya no se pelea', async () => {
    const { master, kael, url } = await table();
    await master.post(`${url}/close`, {});
    const late = await master.post(`${url}/combat`, { combatants: [character(kael.id), bandits] });
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toBe('La partida ya ha terminado');
  });
});

describe('los turnos', () => {
  it('pasan en orden, los termina el máster o quien juega, y la palabra los sigue', async () => {
    const tableState = await table();
    const { master, ana, bruno, kael, mira, url } = tableState;
    const order = await fight(tableState);
    const banditsId = order[1]!.id;

    const notYours = await ana.post(`${url}/combat/turn`, { round: 1, combatantId: mira.id });
    expect(notYours.statusCode).toBe(403);
    expect(notYours.json().error).toBe('No es tu turno: le toca a Mira');

    expect(
      await created(bruno.post(`${url}/combat/turn`, { round: 1, combatantId: mira.id })),
    ).toMatchObject({
      kind: 'turn',
      round: 1,
      turn: 1,
      combatant: { id: banditsId, name: '3 bandidos' },
      visibility: 'public',
      authorName: 'Bruno',
    });
    // En el turno de los PNJ, la palabra es del máster.
    expect((await state(ana, url)).floor).toEqual({ kind: 'master' });

    const late = await bruno.post(`${url}/combat/turn`, { round: 1, combatantId: mira.id });
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toBe('Ese turno ya ha terminado');
    const npcTurn = await bruno.post(`${url}/combat/turn`, { round: 1, combatantId: banditsId });
    expect(npcTurn.statusCode).toBe(403);
    expect(npcTurn.json().error).toBe('No es tu turno: le toca a 3 bandidos');

    await created(master.post(`${url}/combat/turn`, { round: 1, combatantId: banditsId }));
    expect((await state(bruno, url)).floor).toEqual({
      kind: 'character',
      characterId: kael.id,
      name: 'Kael',
    });

    // Tras el último, empieza otra ronda.
    expect(
      await created(ana.post(`${url}/combat/turn`, { round: 1, combatantId: kael.id })),
    ).toMatchObject({ round: 2, turn: 0, combatant: { id: mira.id, name: 'Mira' } });
    expect((await state(master, url)).combat).toMatchObject({ round: 2, turn: 0 });
  });

  it('sin combate no hay turnos', async () => {
    const { master, kael, url } = await table();
    const response = await master.post(`${url}/combat/turn`, { round: 1, combatantId: kael.id });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('No hay ningún combate en juego');
  });
});

describe('quien se une y quien sale', () => {
  it('quien se une tira al llegar y ocupa su sitio; el turno sigue con quien lo tenía', async () => {
    const { master, ana, kael, mira, url } = await table();
    loadDice(2, 3, 5, 5);
    const started = await created(
      master.post(`${url}/combat`, { combatants: [character(kael.id), bandits] }),
    );
    const banditsId = started.kind === 'combatStarted' ? started.order[0]!.id : '';
    await created(master.post(`${url}/combat/turn`, { round: 1, combatantId: banditsId }));

    // Le toca a Kael (8). Mira (15) entra por delante: actuará en la ronda siguiente.
    const player = await ana.post(`${url}/combat/join`, { combatants: [character(mira.id)] });
    expect(player.statusCode).toBe(403);
    loadDice(6, 6, 1, 1);
    const joined = await created(
      master.post(`${url}/combat/join`, {
        combatants: [character(mira.id), { kind: 'npc', name: 'Lobos', profile: 'soldier' }],
      }),
    );
    expect(joined).toMatchObject({ kind: 'combatJoined', round: 1, turn: 2 });
    expect(joined.kind === 'combatJoined' && names(joined.joined)).toEqual(['Mira', 'Lobos']);
    expect(joined.kind === 'combatJoined' && names(joined.order)).toEqual([
      'Mira',
      '3 bandidos',
      'Kael',
      'Lobos',
    ]);
    expect((await state(ana, url)).floor).toMatchObject({ characterId: kael.id });

    const twice = await master.post(`${url}/combat/join`, { combatants: [character(kael.id)] });
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error).toBe('Kael ya está en el combate');
  });

  it('sale quien cae o huye; si era su turno, le toca al siguiente', async () => {
    const tableState = await table();
    const { master, ana, kael, mira, url } = tableState;
    const order = await fight(tableState);
    const banditsId = order[1]!.id;

    expect((await ana.post(`${url}/combat/leave`, { combatantId: banditsId })).statusCode).toBe(
      403,
    );
    expect(
      await created(master.post(`${url}/combat/leave`, { combatantId: banditsId })),
    ).toMatchObject({
      kind: 'combatLeft',
      left: { id: banditsId, name: '3 bandidos' },
      round: 1,
      turn: 0,
    });
    // Mira tenía el turno: al salir, le toca a Kael.
    await created(master.post(`${url}/combat/leave`, { combatantId: mira.id }));
    const { combat, floor } = await state(ana, url);
    expect(combat && names(combat.order)).toEqual(['Kael']);
    expect(floor).toMatchObject({ characterId: kael.id });

    const last = await master.post(`${url}/combat/leave`, { combatantId: kael.id });
    expect(last.statusCode).toBe(409);
    expect(last.json().error).toBe('Solo queda Kael en el combate: termínalo');
    const nobody = await master.post(`${url}/combat/leave`, { combatantId: mira.id });
    expect(nobody.statusCode).toBe(404);
    expect(nobody.json().error).toBe('Quien quieres sacar no está en el combate');
  });
});

describe('terminar el combate', () => {
  it('quienes siguen en el combate recuperan el aliento: se borran sus rasguños', async () => {
    const tableState = await table();
    const { master, ana, bruno, kael, mira, url } = tableState;
    for (const id of [kael.id, mira.id]) {
      await master.post(`/api/characters/${id}/damage`, { amount: 1 });
    }
    await fight(tableState);
    // Mira huye antes de acabar: no recupera el aliento con los demás.
    await created(master.post(`${url}/combat/leave`, { combatantId: mira.id }));

    expect((await ana.post(`${url}/combat/end`, {})).statusCode).toBe(403);
    expect(await created(master.post(`${url}/combat/end`, {}))).toMatchObject({
      kind: 'combatEnded',
      rounds: 1,
      recovered: [{ characterId: kael.id, name: 'Kael' }],
      visibility: 'public',
    });
    expect((await ana.get(`/api/characters/${kael.id}`)).json().character.wounds.scratches).toBe(0);
    expect((await bruno.get(`/api/characters/${mira.id}`)).json().character.wounds.scratches).toBe(
      1,
    );
    const { combat, floor } = await state(bruno, url);
    expect(combat).toBeNull();
    expect(floor).toEqual({ kind: 'master' });

    for (const [path, body] of [
      ['end', {}],
      ['join', { combatants: [character(mira.id)] }],
      ['leave', { combatantId: kael.id }],
    ] as const) {
      const response = await master.post(`${url}/combat/${path}`, body);
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe('No hay ningún combate en juego');
    }
  });

  it('sin recuperar el aliento, los rasguños se quedan', async () => {
    const tableState = await table();
    const { master, ana, kael, url } = tableState;
    await master.post(`/api/characters/${kael.id}/damage`, { amount: 1 });
    await fight(tableState);
    expect(await created(master.post(`${url}/combat/end`, { recover: false }))).toMatchObject({
      kind: 'combatEnded',
      recovered: [],
    });
    expect((await ana.get(`/api/characters/${kael.id}`)).json().character.wounds.scratches).toBe(1);
    // Y se puede empezar otro.
    await fight(tableState);
  });
});

describe('las intervenciones en combate', () => {
  it('pueden ir contra alguien que pelea', async () => {
    const tableState = await table();
    const { ana, bruno, kael, mira, url } = tableState;
    const order = await fight(tableState);
    const banditsId = order[1]!.id;
    expect(
      await created(
        ana.post(`${url}/interventions`, {
          characterId: kael.id,
          intent: 'melee',
          text: 'Le corto el paso al jefe',
          targetId: banditsId,
        }),
      ),
    ).toMatchObject({
      kind: 'intervention',
      intent: 'melee',
      target: { id: banditsId, name: '3 bandidos' },
    });
    const nobody = await bruno.post(`${url}/interventions`, {
      characterId: mira.id,
      intent: 'ranged',
      targetId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    });
    expect(nobody.statusCode).toBe(404);
    expect(nobody.json().error).toBe('Quien eliges no está en el combate');
  });

  it('solo lanza hechizos quien sabe Hechicería', async () => {
    const { ana, bruno, kael, mira, url } = await table(SORCERER);
    const spell = { intent: 'spell', text: 'Una ráfaga de fuego' };
    const kaelSpell = await ana.post(`${url}/interventions`, { ...spell, characterId: kael.id });
    expect(kaelSpell.statusCode).toBe(400);
    expect(kaelSpell.json().error).toBe('Kael no puede lanzar hechizos: le falta Hechicería');
    await created(bruno.post(`${url}/interventions`, { ...spell, characterId: mira.id }));
  });
});

describe('las tiradas de combate', () => {
  it('dicen quién ataca a quién, también las que se piden al jugador', async () => {
    const tableState = await table();
    const { master, ana, kael, url } = tableState;
    const order = await fight(tableState);
    const banditsId = order[1]!.id;
    const blow = { attackerId: banditsId, defenderId: kael.id };
    const defense = {
      actor: { kind: 'free', label: '3 bandidos', bonus: 2 },
      target: {
        kind: 'opposed',
        opponent: { kind: 'character', characterId: kael.id, skill: 'melee-weapons' },
      },
      situation: 'melee',
      blow,
    };
    const names = {
      attacker: { id: banditsId, name: '3 bandidos' },
      defender: { id: kael.id, name: 'Kael' },
    };

    loadDice(3, 3, 4, 4);
    expect(await created(master.post(`${url}/rolls`, defense))).toMatchObject({
      roll: { blow: names },
    });

    // Pedida al jugador: se sabe al pedirla y la tirada lo guarda.
    const asked = await created(master.post(`${url}/roll-requests`, { roll: defense }));
    expect(asked).toMatchObject({ kind: 'rollRequest', preview: { blow: names } });
    loadDice(5, 5, 2, 2);
    expect(await created(ana.post(`${url}/roll-requests/${asked.id}/roll`, {}))).toMatchObject({
      roll: { blow: names, requested: asked.id },
    });

    const nobody = await master.post(`${url}/rolls`, {
      ...defense,
      blow: { attackerId: banditsId, defenderId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' },
    });
    expect(nobody.statusCode).toBe(404);
    expect(nobody.json().error).toBe('Quien eliges no está en el combate');
  });

  it('sin combate, una tirada no puede decir quién ataca a quién', async () => {
    const { master, kael, url } = await table();
    const response = await master.post(`${url}/rolls`, {
      actor: { kind: 'character', characterId: kael.id, skill: 'melee-weapons' },
      target: { kind: 'difficulty', difficulty: 10 },
      blow: { attackerId: kael.id, defenderId: kael.id },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('No hay ningún combate en juego');
  });

  it('un grupo de enemigos dice cuántos son', async () => {
    const { master, kael, url } = await table();
    loadDice(3, 3, 3, 3);
    const started = await created(
      master.post(`${url}/combat`, {
        combatants: [
          character(kael.id),
          { kind: 'npc', name: 'Matones', profile: 'minion', count: 3 },
        ],
      }),
    );
    expect(started).toMatchObject({
      order: [{ name: 'Kael' }, { name: 'Matones', count: 3 }],
    });
  });
});
