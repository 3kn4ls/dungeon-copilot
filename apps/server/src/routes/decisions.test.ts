import type { Random } from '@dungeon-copilot/rules';
import { fixedDice, kael } from '@dungeon-copilot/rules/testing';
import type { GameEvent } from '@dungeon-copilot/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDecider } from '../ai/decide';
import { startFakeOllama, type FakeOllama } from '../ai/fake-ollama';
import { buildApp } from '../app';
import { TEST_PASSWORD_PARAMS, createClient, useTestApp, type TestClient } from '../testing';

let ollama: FakeOllama;
// Antes que la app de pruebas: la app necesita saber dónde escucha el Ollama de mentira.
beforeAll(async () => {
  ollama = await startFakeOllama();
});
let dice: Random = () => {
  throw new Error('Esta prueba no esperaba ninguna tirada');
};
const t = useTestApp(() => ({
  decider: createDecider({ url: ollama.url, model: 'nimble' }),
  random: () => dice(),
}));
beforeEach(() => ollama.reset());
afterAll(() => ollama.close());

/** Edu dirige La Marca del Este; Ana juega con Kael. Bruno mira desde fuera. */
async function table() {
  const master = await t.register('edu', 'Edu');
  const ana = await t.register('ana', 'Ana');
  const bruno = await t.register('bruno', 'Bruno');
  const campaign = (await master.post('/api/campaigns', { name: 'La Marca del Este' })).json()
    .campaign;
  await ana.post('/api/campaigns/join', { inviteCode: campaign.inviteCode });
  const character = (await ana.post(`/api/campaigns/${campaign.id}/characters`, kael())).json()
    .character;
  const game = (await master.post(`/api/campaigns/${campaign.id}/games`, {})).json().game;
  return { master, ana, bruno, campaign, kael: character, url: `/api/games/${game.id}` };
}

async function created(response: Promise<{ statusCode: number; json(): unknown }>) {
  const done = await response;
  expect(done.statusCode).toBe(201);
  return (done.json() as { event: GameEvent }).event;
}

async function eventsOf(client: TestClient, url: string): Promise<GameEvent[]> {
  return (await client.get(url)).json().events;
}

/** Lo que leyó Nimble y lo que le preguntaron, de todas sus peticiones. */
function asked() {
  return {
    states: [...new Set(ollama.decisions.map(({ body }) => body.state))],
    keys: ollama.decisions.flatMap(({ body }) => Object.keys(body.questions)),
  };
}

describe('qué tirada pedir para una intervención', () => {
  it('la IA sugiere con qué tira, la dificultad y lo demás, sin escribir nada en la partida', async () => {
    const { master, ana, kael: sheet, url } = await table();
    await master.post(`${url}/scenes`, { title: 'El callejón del puerto' });
    await master.post(`${url}/reveals`, { title: 'El callejón', body: 'Se acercan dos guardias.' });
    const intervention = await created(
      ana.post(`${url}/interventions`, {
        characterId: sheet.id,
        intent: 'act',
        text: 'Me escondo tras las cajas',
      }),
    );
    const before = await eventsOf(master, url);

    ollama.queueDecision({
      kind: 'answers',
      answers: {
        skill: { choice: { stealth: 0.72, 'sleight-of-hand': 0.18, acrobatics: 0.06 } },
        difficulty: { score: 2.2 },
        opposed: { noul: 0.7 },
        background: { noul: 0.1 },
        needsRoll: { noul: 0.95 },
      },
    });
    const response = await master.post(`${url}/interventions/${intervention.id}/check`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      suggestion: {
        skills: [
          { id: 'stealth', probability: 0.72 },
          { id: 'sleight-of-hand', probability: 0.18 },
          { id: 'acrobatics', probability: 0.06 },
        ],
        difficulty: 'hard',
        opposed: 0.7,
        background: 0.1,
        needsRoll: 0.95,
      },
    });

    const { states, keys } = asked();
    expect(keys.sort()).toEqual(['background', 'difficulty', 'needsRoll', 'opposed', 'skill']);
    expect(states).toEqual([
      [
        'Personaje: Kael.',
        'Trasfondo: Mercenario de la Compañía Libre.',
        'Escena: El callejón del puerto.',
        'Lo último que ha descrito el máster:\nEl callejón\nSe acercan dos guardias.',
        'Su jugador pulsa «Actuar» y escribe: «Me escondo tras las cajas»',
      ].join('\n'),
    ]);
    // Solo sugiere: la partida sigue igual.
    expect(await eventsOf(master, url)).toEqual(before);
  });

  it('en un disparo, la distancia y la cobertura, contra quien pelea', async () => {
    const { master, ana, kael: sheet, url } = await table();
    dice = fixedDice(3, 3, 2, 2);
    const started = await created(
      master.post(`${url}/combat`, {
        combatants: [
          { kind: 'character', characterId: sheet.id },
          { kind: 'npc', name: 'Bandidos', profile: 'minion', count: 3 },
        ],
      }),
    );
    const bandits = started.kind === 'combatStarted' ? started.order[1] : undefined;
    const shot = await created(
      ana.post(`${url}/interventions`, {
        characterId: sheet.id,
        intent: 'ranged',
        text: 'Les disparo desde la torre, están tras el carro',
        targetId: bandits?.id,
      }),
    );

    ollama.queueDecision({
      kind: 'answers',
      answers: { range: { score: 1.8 }, cover: { noul: 0.97 } },
    });
    const response = await master.post(`${url}/interventions/${shot.id}/check`);
    expect(response.json().suggestion).toMatchObject({
      skills: [],
      shot: { range: 'long', cover: 0.97 },
    });
    const { states, keys } = asked();
    expect(keys.sort()).toEqual(['background', 'cover', 'range']);
    expect(states[0]).toContain(
      '«Les disparo desde la torre, están tras el carro» Va contra Bandidos.',
    );
  });

  it('cuerpo a cuerpo lo dice el reglamento, y sin texto no hay nada que sugerir', async () => {
    const { master, ana, kael: sheet, url } = await table();
    const attack = await created(
      ana.post(`${url}/interventions`, { characterId: sheet.id, intent: 'attack', text: '¡A él!' }),
    );
    const melee = await master.post(`${url}/interventions/${attack.id}/check`);
    expect(melee.statusCode).toBe(409);
    expect(melee.json().error).toContain('reglamento');
    await master.post(`${url}/interventions/${attack.id}/answer`, {});

    const silent = await created(
      ana.post(`${url}/interventions`, { characterId: sheet.id, intent: 'act' }),
    );
    const empty = await master.post(`${url}/interventions/${silent.id}/check`);
    expect(empty.statusCode).toBe(409);
    expect(empty.json().error).toBe(
      'Esa intervención no dice qué intenta: no hay nada que sugerir',
    );
    expect(ollama.decisions).toHaveLength(0);
  });

  it('también las que son en secreto, que el máster ve', async () => {
    const { master, ana, kael: sheet, url } = await table();
    const note = await created(
      ana.post(`${url}/interventions`, {
        characterId: sheet.id,
        intent: 'act',
        text: 'Le robo la bolsa a Garrick',
        secret: true,
      }),
    );
    const response = await master.post(`${url}/interventions/${note.id}/check`);
    expect(response.statusCode).toBe(200);
    expect(asked().states[0]).toContain('«Le robo la bolsa a Garrick»');
  });

  it('solo para el máster, con la partida en juego, y solo de intervenciones', async () => {
    const { master, ana, bruno, kael: sheet, url } = await table();
    const intervention = await created(
      ana.post(`${url}/interventions`, { characterId: sheet.id, intent: 'speak', text: 'Hola' }),
    );
    const check = `${url}/interventions/${intervention.id}/check`;

    expect((await bruno.post(check)).statusCode).toBe(404);
    const player = await ana.post(check);
    expect(player.statusCode).toBe(403);

    const reveal = await created(master.post(`${url}/reveals`, { body: 'Llueve.' }));
    const notIntervention = await master.post(`${url}/interventions/${reveal.id}/check`);
    expect(notIntervention.statusCode).toBe(404);
    expect(notIntervention.json().error).toBe('Esa intervención no existe en esta partida');
    expect((await master.post(`${url}/interventions/99999/check`)).statusCode).toBe(404);
    expect((await master.post(`${url}/interventions/abc/check`)).statusCode).toBe(404);
    expect(ollama.decisions).toHaveLength(0);

    await master.post(`${url}/close`, {});
    const closed = await master.post(check);
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error).toBe('La partida ya ha terminado');
  });

  it('explica los fallos de Nimble', async () => {
    const { master, ana, kael: sheet, url } = await table();
    const intervention = await created(
      ana.post(`${url}/interventions`, { characterId: sheet.id, intent: 'speak', text: 'Hola' }),
    );
    ollama.queueDecision({
      kind: 'error',
      status: 404,
      error: 'model "nimble" not found, try pulling it first',
    });
    const missing = await master.post(`${url}/interventions/${intervention.id}/check`);
    expect(missing.statusCode).toBe(502);
    expect(missing.json().error).toContain('ollama pull nimble');
  });
});

/** Kael y Mira contra Garrick, un PNJ de la campaña con secretos, y tres matones. */
async function fight() {
  const tableState = await table();
  const { master, ana, campaign, kael: sheet, url } = tableState;
  const mira = (
    await ana.post(`/api/campaigns/${campaign.id}/characters`, kael({ name: 'Mira' }))
  ).json().character;
  const garrick = (
    await master.post(`/api/campaigns/${campaign.id}/npcs`, {
      name: 'Garrick',
      concept: 'Capitán de los contrabandistas',
      personality: 'Orgulloso y rencoroso',
      goals: 'Que nadie descubra el almacén',
      secrets: 'Trabaja para el conde',
      profile: 'veteran',
    })
  ).json().npc;
  dice = fixedDice(6, 6, 5, 5, 4, 4, 3, 3);
  const started = await created(
    master.post(`${url}/combat`, {
      combatants: [
        { kind: 'character', characterId: sheet.id },
        { kind: 'character', characterId: mira.id },
        { kind: 'npc', name: 'Garrick', profile: 'veteran', npcId: garrick.id },
        { kind: 'npc', name: 'Matones', profile: 'minion', count: 3 },
      ],
    }),
  );
  if (started.kind !== 'combatStarted') throw new Error('No ha empezado el combate');
  const byName = (name: string) => {
    const combatant = started.order.find((other) => other.name === name);
    if (!combatant) throw new Error(`${name} no pelea`);
    return combatant;
  };
  return {
    ...tableState,
    mira,
    garrickCombatant: byName('Garrick'),
    thugs: byName('Matones'),
    decision: `${url}/combat/decision`,
  };
}

describe('qué hacen los enemigos', () => {
  it('a quién atacan y su moral, sabiendo cómo va el combate y sin los secretos del PNJ', async () => {
    const { master, kael: sheet, mira, garrickCombatant, thugs, url, decision } = await fight();
    await created(master.post(`${url}/damage`, { targetId: thugs.id, amount: 1 }));
    const before = await eventsOf(master, url);

    ollama.queueDecision({
      kind: 'answers',
      answers: {
        target: { choice: { [sheet.id]: 0.7, [mira.id]: 0.3 } },
        targetReversed: { choice: { [mira.id]: 0.5, [sheet.id]: 0.5 } },
        morale: { choice: { fight: 0.3, flee: 0.55, surrender: 0.15 } },
      },
    });
    const response = await master.post(decision, { combatantId: garrickCombatant.id });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      decision: {
        targets: [
          { id: sheet.id, name: 'Kael', probability: 0.6 },
          { id: mira.id, name: 'Mira', probability: 0.4 },
        ],
        morale: { choice: 'flee', probabilities: { fight: 0.3, flee: 0.55, surrender: 0.15 } },
      },
    });

    const { states, keys } = asked();
    expect(keys).toEqual(['morale', 'target', 'targetReversed']);
    expect(states).toHaveLength(1);
    const [state] = states;
    expect(state).toContain('Ronda 1.');
    expect(state).toContain('- Matones (PNJ, esbirro): quedan 2 de 3 en pie');
    expect(state).toContain('Le toca a: Garrick (PNJ, veterano): sin heridas');
    expect(state).toContain('Concepto: Capitán de los contrabandistas');
    expect(state).toContain('Golpe a Matones (1 de daño): cae uno y quedan 2.');
    // Lo que oculta Garrick no sale nunca.
    expect(JSON.stringify(ollama.decisions)).not.toContain('conde');
    // Solo sugiere: la partida sigue igual.
    expect(await eventsOf(master, url)).toEqual(before);
  });

  it('solo la moral, si no se pide a quién atacan', async () => {
    const { master, thugs, decision } = await fight();
    ollama.queueDecision({
      kind: 'answers',
      answers: { morale: { choice: { fight: 0.2, flee: 0.1, surrender: 0.7 } } },
    });
    const response = await master.post(decision, { combatantId: thugs.id, targets: false });
    expect(response.json().decision).toEqual({
      targets: [],
      morale: { choice: 'surrender', probabilities: { fight: 0.2, flee: 0.1, surrender: 0.7 } },
    });
    expect(asked().keys).toEqual(['morale']);
  });

  it('solo de PNJ del combate, con un combate en juego, y solo para el máster', async () => {
    const { master, ana, bruno, kael: sheet, thugs, url, decision } = await fight();
    expect((await bruno.post(decision, { combatantId: thugs.id })).statusCode).toBe(404);
    expect((await ana.post(decision, { combatantId: thugs.id })).statusCode).toBe(403);

    const character = await master.post(decision, { combatantId: sheet.id });
    expect(character.statusCode).toBe(404);
    expect(character.json().error).toBe('Esos PNJ no están en el combate');
    const nobody = await master.post(decision, { combatantId: crypto.randomUUID() });
    expect(nobody.statusCode).toBe(404);
    expect((await master.post(decision, {})).statusCode).toBe(400);

    await master.post(`${url}/combat/end`, {});
    const ended = await master.post(decision, { combatantId: thugs.id });
    expect(ended.statusCode).toBe(409);
    expect(ended.json().error).toBe('No hay ningún combate en juego');
    expect(ollama.decisions).toHaveLength(0);
  });
});

describe('sin Nimble', () => {
  it('la web lo sabe y las sugerencias responden 503', async () => {
    const { master, ana, kael: sheet, url } = await table();
    const intervention = await created(
      ana.post(`${url}/interventions`, { characterId: sheet.id, intent: 'speak', text: 'Hola' }),
    );
    expect((await master.get('/api/ai')).json()).toMatchObject({
      decisions: true,
      decisionModel: 'nimble',
    });

    const withoutNimble = await buildApp({ db: t.db, passwordParams: TEST_PASSWORD_PARAMS });
    try {
      const client = createClient(withoutNimble, master.cookie);
      expect((await client.get('/api/ai')).json()).toMatchObject({
        decisions: false,
        decisionModel: null,
      });
      const check = await client.post(`${url}/interventions/${intervention.id}/check`);
      expect(check.statusCode).toBe(503);
      expect(check.json().error).toContain('OLLAMA_DECISION_MODEL');
    } finally {
      await withoutNimble.close();
    }
  });
});
