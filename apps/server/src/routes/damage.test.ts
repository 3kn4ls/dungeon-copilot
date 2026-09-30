import type { Random } from '@dungeon-copilot/rules';
import { fixedDice, kael } from '@dungeon-copilot/rules/testing';
import {
  currentCombat,
  currentFloor,
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

/** Mira con Esquiva prodigiosa (Destreza 4, Acrobacias 2). */
const DODGER = {
  attributes: { strength: 2, dexterity: 4, charisma: 2, intelligence: 2, endurance: 2 },
  skills: { acrobatics: 2, fencing: 2, stealth: 1, perception: 1 },
  advancedSkills: ['uncanny-dodge'],
};

/** Edu dirige; Ana juega con Kael y Bruno con Mira, que esquiva de maravilla. */
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
  const kaelSheet = await create(ana, kael());
  const mira = await create(bruno, kael({ name: 'Mira', ...DODGER }));
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

/** Lo que responde el servidor a una acción que crea un evento. */
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

const character = (id: string): CombatantRequest => ({ kind: 'character', characterId: id });
const bandits: CombatantRequest = { kind: 'npc', name: 'Bandidos', profile: 'minion', count: 3 };
const garrick: CombatantRequest = { kind: 'npc', name: 'Garrick', profile: 'veteran' };

/** Mira (15), Garrick (10), los bandidos (9) y Kael (8). */
async function fight({ master, kael, mira, url }: Table) {
  loadDice(2, 3, 6, 5, 4, 3, 4, 4);
  const started = await created(
    master.post(`${url}/combat`, {
      combatants: [character(kael.id), character(mira.id), garrick, bandits],
    }),
  );
  if (started.kind !== 'combatStarted') throw new Error('No ha empezado el combate');
  const find = (name: string) => started.order.find((combatant) => combatant.name === name)!;
  return { garrick: find('Garrick'), bandits: find('Bandidos') };
}

const sheetOf = async (client: TestClient, id: string) =>
  (await client.get(`/api/characters/${id}`)).json().character;

describe('golpes a los personajes', () => {
  it('el máster aplica un golpe: cambia la ficha y lo ve toda la mesa', async () => {
    const { master, bruno, kael, url, screenUrl } = await table();
    // Aguante 2: dos rasguños y el tercer punto, herido.
    const hit = await created(master.post(`${url}/damage`, { targetId: kael.id, amount: 3 }));
    expect(hit).toMatchObject({
      kind: 'damage',
      visibility: 'public',
      amount: 3,
      target: {
        kind: 'character',
        id: kael.id,
        name: 'Kael',
        before: { scratches: 0, severity: 'none' },
        after: { scratches: 2, severity: 'wounded' },
        lethal: false,
      },
    });
    expect((await sheetOf(bruno, kael.id)).wounds).toEqual({
      scratches: 2,
      severity: 'wounded',
      scratchBoxes: 2,
    });
    expect((await events(bruno, url)).at(-1)).toEqual(hit);
    expect((await t.anonymous().get(screenUrl)).json().events.at(-1)).toEqual(hit);
  });

  it('solo el máster aplica golpes, y solo a quien está en la campaña o en el combate', async () => {
    const { master, ana, kael, url } = await table();
    const stranger = await t.register('intrusa');
    await refused(
      ana.post(`${url}/damage`, { targetId: kael.id, amount: 1 }),
      403,
      'Solo el máster de la campaña puede hacer eso',
    );
    expect(
      (await stranger.post(`${url}/damage`, { targetId: kael.id, amount: 1 })).statusCode,
    ).toBe(404);
    await refused(
      master.post(`${url}/damage`, {
        targetId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        amount: 1,
      }),
      404,
      'Quien recibe el golpe no está en el combate ni es de esta campaña',
    );
    const zero = await master.post(`${url}/damage`, { targetId: kael.id, amount: 0 });
    expect(zero.statusCode).toBe(400);
    expect(zero.json().issues).toEqual([{ path: 'amount', message: 'El daño mínimo es 1' }]);
  });

  it('un golpe mortal: su jugador gasta Suerte para seguir con vida', async () => {
    const { master, ana, bruno, kael, url } = await table();
    const scratch = await created(master.post(`${url}/damage`, { targetId: kael.id, amount: 1 }));
    // Uno más de rasguño y cuatro niveles: más allá de fuera de combate.
    const mortal = await created(master.post(`${url}/damage`, { targetId: kael.id, amount: 5 }));
    expect(mortal).toMatchObject({
      target: { after: { scratches: 2, severity: 'down' }, lethal: true },
    });

    await refused(
      bruno.post(`${url}/damage/${mortal.id}/survive`, {}),
      403,
      'Solo su jugador o el máster pueden gastar su Suerte',
    );
    await refused(
      ana.post(`${url}/damage/${scratch.id}/survive`, {}),
      409,
      'Ese golpe no es mortal: Kael no tiene que gastar Suerte',
    );
    const saved = await created(ana.post(`${url}/damage/${mortal.id}/survive`, {}));
    expect(saved).toMatchObject({
      kind: 'survived',
      visibility: 'public',
      of: mortal.id,
      characterId: kael.id,
      name: 'Kael',
    });
    expect((await sheetOf(ana, kael.id)).luck).toBe(2);
    await refused(
      master.post(`${url}/damage/${mortal.id}/survive`, {}),
      409,
      'Kael ya ha gastado Suerte para salvarse de ese golpe',
    );

    // Otro golpe mortal, sin Suerte que gastar.
    await master.patch(`/api/characters/${kael.id}`, { luck: 0 });
    const again = await created(master.post(`${url}/damage`, { targetId: kael.id, amount: 1 }));
    await refused(
      ana.post(`${url}/damage/${again.id}/survive`, {}),
      409,
      'A Kael no le queda Suerte',
    );
    for (const eventId of [saved.id, 'abc', '99999999999']) {
      await refused(
        ana.post(`${url}/damage/${eventId}/survive`, {}),
        404,
        'Ese golpe no existe en esta partida',
      );
    }
  });
});

describe('golpes a los PNJ', () => {
  it('llevan la cuenta del daño; los de un grupo caen de uno en uno', async () => {
    const tableState = await table();
    const { master, bruno, url } = tableState;
    const foes = await fight(tableState);

    const first = await created(
      master.post(`${url}/damage`, { targetId: foes.bandits.id, amount: 2 }),
    );
    expect(first).toMatchObject({
      target: {
        kind: 'npc',
        id: foes.bandits.id,
        name: 'Bandidos',
        count: 3,
        toughness: 1,
        harm: { down: 1, damage: 0 },
        fell: true,
      },
    });
    expect(first).not.toHaveProperty('position');
    const hurt = await created(
      master.post(`${url}/damage`, { targetId: foes.garrick.id, amount: 2 }),
    );
    expect(hurt).toMatchObject({
      target: { toughness: 4, harm: { down: 0, damage: 2 }, fell: false },
    });

    const combat = currentCombat(await events(bruno, url))!;
    expect(combat.harm).toEqual({
      [foes.bandits.id]: { down: 1, damage: 0 },
      [foes.garrick.id]: { down: 0, damage: 2 },
    });
    expect(combat.order.map(({ name }) => name)).toEqual(['Mira', 'Garrick', 'Bandidos', 'Kael']);
  });

  it('si caen todos, salen del combate; si era su turno, le toca al siguiente', async () => {
    const tableState = await table();
    const { master, mira, url } = tableState;
    const foes = await fight(tableState);
    // Le toca a Garrick.
    await master.post(`${url}/combat/turn`, { round: 1, combatantId: mira.id });

    await master.post(`${url}/damage`, { targetId: foes.garrick.id, amount: 3 });
    const down = await created(
      master.post(`${url}/damage`, { targetId: foes.garrick.id, amount: 1 }),
    );
    expect(down).toMatchObject({
      target: { harm: { down: 1, damage: 0 }, fell: true },
      position: { round: 1, turn: 1 },
    });
    const list = await events(master, url);
    const combat = currentCombat(list)!;
    expect(combat.order.map(({ name }) => name)).toEqual(['Mira', 'Bandidos', 'Kael']);
    expect(combat.harm).toEqual({});
    // Le toca a los bandidos: la palabra, al máster.
    expect(currentFloor(list)).toEqual({ kind: 'master' });

    await refused(
      master.post(`${url}/damage`, { targetId: foes.garrick.id, amount: 1 }),
      404,
      'Quien recibe el golpe no está en el combate ni es de esta campaña',
    );
  });

  it('el daño que sobra no pasa al siguiente del grupo', async () => {
    const { master, kael, url } = await table();
    loadDice(3, 3, 3, 3);
    const started = await created(
      master.post(`${url}/combat`, {
        combatants: [
          character(kael.id),
          { kind: 'npc', name: 'Lobos', profile: 'soldier', count: 2 },
        ],
      }),
    );
    if (started.kind !== 'combatStarted') throw new Error('No ha empezado el combate');
    const wolves = started.order.find(({ name }) => name === 'Lobos')!;
    expect(wolves).toMatchObject({ kind: 'npc', count: 2 });
    const hit = await created(master.post(`${url}/damage`, { targetId: wolves.id, amount: 5 }));
    expect(hit).toMatchObject({ target: { harm: { down: 1, damage: 0 }, fell: true } });
  });

  it('el último que queda en el combate no sale: cae y se termina a mano', async () => {
    const tableState = await table();
    const { master, kael, mira, url } = tableState;
    const foes = await fight(tableState);
    for (const combatantId of [kael.id, mira.id, foes.bandits.id]) {
      await created(master.post(`${url}/combat/leave`, { combatantId }));
    }
    const last = await created(
      master.post(`${url}/damage`, { targetId: foes.garrick.id, amount: 4 }),
    );
    expect(last).toMatchObject({ target: { harm: { down: 1, damage: 0 }, fell: true } });
    expect(last).not.toHaveProperty('position');
    expect(currentCombat(await events(master, url))?.order.map(({ name }) => name)).toEqual([
      'Garrick',
    ]);
    await refused(
      master.post(`${url}/damage`, { targetId: foes.garrick.id, amount: 1 }),
      409,
      'Garrick ya ha caído',
    );
  });
});

describe('golpes de una tirada', () => {
  /** Garrick ataca a Kael, que se defiende con Armas cuerpo a cuerpo. */
  async function garrickAttacks(tableState: Table, faces: number[]) {
    const { master, kael, url } = tableState;
    const foes = await fight(tableState);
    loadDice(...faces);
    const roll = await created(
      master.post(`${url}/rolls`, {
        actor: { kind: 'free', label: 'Garrick', bonus: 6 },
        target: {
          kind: 'opposed',
          opponent: { kind: 'character', characterId: kael.id, skill: 'melee-weapons' },
        },
        situation: 'melee',
        blow: { attackerId: foes.garrick.id, defenderId: kael.id },
      }),
    );
    return { roll, foes };
  }

  it('dicen quién da el golpe, y cada uno se aplica una vez', async () => {
    const tableState = await table();
    const { master, kael, url } = tableState;
    // Garrick 6 + 6 + 6 = 18 contra Kael 1 + 2 + 6 = 9: impacta.
    const { roll, foes } = await garrickAttacks(tableState, [6, 6, 1, 2]);
    expect(roll).toMatchObject({
      roll: {
        result: { outcome: 'critical' },
        blow: {
          attacker: { id: foes.garrick.id, name: 'Garrick' },
          defender: { id: kael.id, name: 'Kael' },
        },
      },
    });

    const hit = await created(
      master.post(`${url}/damage`, { targetId: kael.id, amount: 3, roll: roll.id }),
    );
    expect(hit).toMatchObject({ roll: roll.id, by: { id: foes.garrick.id, name: 'Garrick' } });
    await refused(
      master.post(`${url}/damage`, { targetId: kael.id, amount: 3, roll: roll.id }),
      409,
      'Ese golpe ya está aplicado',
    );
    // El mismo golpe puede herir a los dos: el de vuelta es de Kael.
    const back = await created(
      master.post(`${url}/damage`, { targetId: foes.garrick.id, amount: 1, roll: roll.id }),
    );
    expect(back).toMatchObject({ by: { id: kael.id, name: 'Kael' } });

    for (const bad of [hit.id, 99999999999]) {
      await refused(
        master.post(`${url}/damage`, { targetId: kael.id, amount: 1, roll: bad }),
        404,
        'Esa tirada no existe en esta partida',
      );
    }
  });

  it('una tirada con el daño aplicado ya no se repite con Suerte, ni al revés', async () => {
    const tableState = await table();
    const { master, ana, kael, url } = tableState;
    const { roll } = await garrickAttacks(tableState, [6, 6, 1, 2]);
    await created(master.post(`${url}/damage`, { targetId: kael.id, amount: 3, roll: roll.id }));
    await refused(
      ana.post(`${url}/rolls/${roll.id}/reroll`, { side: 'opponent' }),
      409,
      'Ya se ha aplicado el daño de esa tirada: no se puede repetir',
    );

    // Otra tirada, repetida con Suerte antes del daño: el golpe sale de la segunda.
    loadDice(6, 6, 1, 2);
    const second = await created(
      master.post(`${url}/rolls`, {
        actor: { kind: 'free', label: 'Garrick', bonus: 6 },
        target: {
          kind: 'opposed',
          opponent: { kind: 'character', characterId: kael.id, skill: 'melee-weapons' },
        },
        situation: 'melee',
      }),
    );
    loadDice(6, 6);
    await created(ana.post(`${url}/rolls/${second.id}/reroll`, { side: 'opponent' }));
    await refused(
      master.post(`${url}/damage`, { targetId: kael.id, amount: 1, roll: second.id }),
      409,
      'Esa tirada se ha repetido con Suerte: el golpe sale de la segunda',
    );
  });
});

describe('Esquiva prodigiosa', () => {
  it('deja el golpe en 1, una vez por escena', async () => {
    const { master, kael, mira, url } = await table();
    const dodged = await created(
      master.post(`${url}/damage`, { targetId: mira.id, amount: 3, dodge: true }),
    );
    expect(dodged).toMatchObject({
      amount: 1,
      dodged: true,
      target: { after: { scratches: 1, severity: 'none' } },
    });
    await refused(
      master.post(`${url}/damage`, { targetId: mira.id, amount: 3, dodge: true }),
      409,
      'Mira ya ha usado Esquiva prodigiosa en esta escena',
    );
    await refused(
      master.post(`${url}/damage`, { targetId: kael.id, amount: 3, dodge: true }),
      400,
      'Kael no tiene Esquiva prodigiosa',
    );

    await created(master.post(`${url}/scenes`, { title: 'El camino del norte' }));
    const next = await created(
      master.post(`${url}/damage`, { targetId: mira.id, amount: 2, dodge: true }),
    );
    expect(next).toMatchObject({ amount: 1, dodged: true });
  });

  it('los PNJ no la tienen', async () => {
    const tableState = await table();
    const foes = await fight(tableState);
    await refused(
      tableState.master.post(`${tableState.url}/damage`, {
        targetId: foes.garrick.id,
        amount: 2,
        dodge: true,
      }),
      400,
      'Esquiva prodigiosa es de los personajes',
    );
  });
});
