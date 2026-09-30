import { OUTCOME_GUIDES, type Random } from '@dungeon-copilot/rules';
import { fixedDice, kael } from '@dungeon-copilot/rules/testing';
import type { AiTextChunk, GameEvent } from '@dungeon-copilot/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeOllama, type FakeOllama } from '../ai/fake-ollama';
import { createOllama } from '../ai/ollama';
import { IDEAS_FORMAT } from '../ai/prompts';
import { useTestApp, type TestClient } from '../testing';

let ollama: FakeOllama;
// Antes que la app de pruebas: la app necesita saber dónde escucha el Ollama de mentira.
beforeAll(async () => {
  ollama = await startFakeOllama();
});
let dice: Random = () => {
  throw new Error('Esta prueba no esperaba ninguna tirada');
};
const t = useTestApp(() => ({
  ai: createOllama({ url: ollama.url, model: 'fake' }),
  random: () => dice(),
}));
beforeEach(() => ollama.reset());
afterAll(() => ollama.close());

/** Edu dirige La Marca del Este; Ana juega con Kael. */
async function table() {
  const master = await t.register('edu', 'Edu');
  const ana = await t.register('ana', 'Ana');
  const campaign = (
    await master.post('/api/campaigns', {
      name: 'La Marca del Este',
      description: 'Fantasía de frontera: pueblos aislados, bandidos y ruinas élficas.',
    })
  ).json().campaign;
  await ana.post('/api/campaigns/join', { inviteCode: campaign.inviteCode });
  const character = (await ana.post(`/api/campaigns/${campaign.id}/characters`, kael())).json()
    .character;
  return { master, ana, campaign, kael: character };
}

async function openGame(master: TestClient, campaignId: string) {
  const response = await master.post(`/api/campaigns/${campaignId}/games`, {});
  expect(response.statusCode).toBe(201);
  return `/api/games/${response.json().game.id}`;
}

async function eventsOf(client: TestClient, url: string): Promise<GameEvent[]> {
  return (await client.get(url)).json().events;
}

/** Kael tira con Armas cuerpo a cuerpo (+6) contra una dificultad normal (10). */
async function rollKael(
  client: TestClient,
  url: string,
  characterId: string,
  faces: [number, number],
  extra: object = {},
): Promise<GameEvent & { kind: 'roll' }> {
  dice = fixedDice(...faces);
  const response = await client.post(`${url}/rolls`, {
    actor: { kind: 'character', characterId, skill: 'melee-weapons' },
    target: { kind: 'difficulty', difficulty: 10 },
    ...extra,
  });
  expect(response.statusCode).toBe(201);
  return response.json().event;
}

const chunksOf = (body: string): AiTextChunk[] =>
  body
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as AiTextChunk);

/** Lo que recibió Ollama en la última petición: las instrucciones y el mensaje. */
function lastPrompt() {
  const messages = ollama.requests.at(-1)?.body.messages ?? [];
  return { system: messages[0]?.content ?? '', user: messages.at(-1)?.content ?? '' };
}

describe('la IA describe una escena', () => {
  it('convierte las notas del máster en una descripción, en directo y sin enseñar nada', async () => {
    const { master, campaign } = await table();
    const url = await openGame(master, campaign.id);
    await master.post(`${url}/reveals`, { title: 'El camino', body: 'Llueve sin parar.' });
    await master.post(`${url}/reveals`, {
      title: 'El Ciervo Blanco',
      body: 'Humo, estofado y un bardo que desafina.',
    });
    await master.post(`${url}/notes`, { text: 'El bardo es un espía del conde' });
    await master.post(`${url}/reveals`, { body: 'Brunilda os señala la trampilla del sótano.' });
    const before = await eventsOf(master, url);

    ollama.queue({
      kind: 'chunks',
      chunks: ['**El sótano**', '\n\nBaj', 'áis por unas escaleras húmedas.', ' Huele a tierra.'],
    });
    const response = await master.post(`${url}/reveals/draft`, {
      title: 'El sótano',
      notes: 'escaleras húmedas, olor a tierra [hay un desertor escondido]',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-ndjson');
    // Sin el título que se inventa el modelo, tampoco mientras se escribe.
    expect(chunksOf(response.body)).toEqual([
      { type: 'delta', text: 'Baj' },
      { type: 'delta', text: 'áis por unas escaleras húmedas.' },
      { type: 'delta', text: ' Huele a tierra.' },
      { type: 'done', text: 'Bajáis por unas escaleras húmedas. Huele a tierra.' },
    ]);

    const request = ollama.requests[0]?.body;
    expect(request).toMatchObject({
      stream: true,
      options: { temperature: 0.8, num_predict: 350 },
    });
    expect(request?.format).toBeUndefined();
    const { system, user } = lastPrompt();
    expect(system).toContain('describir lo que tienen delante los jugadores');
    expect(user).toContain('Fantasía de frontera');
    expect(user).toContain('- Kael: Mercenario de la Compañía Libre');
    // Las dos últimas escenas, y nunca las notas del máster.
    expect(user).toContain(
      'El Ciervo Blanco\nHumo, estofado y un bardo que desafina.\n\nBrunilda os señala la trampilla del sótano.',
    );
    expect(user).not.toContain('Llueve');
    expect(user).not.toContain('espía');
    expect(user).toContain('Título de la escena: El sótano');
    expect(user).toContain(
      'Notas del máster para la descripción:\nescaleras húmedas, olor a tierra [hay un desertor escondido]',
    );
    // Es una propuesta: la mesa no ve nada hasta que el máster la enseña.
    expect(await eventsOf(master, url)).toEqual(before);
  });

  it('con solo el título también vale; sin nada, no pregunta a la IA', async () => {
    const { master, campaign } = await table();
    const url = await openGame(master, campaign.id);

    ollama.queue({ kind: 'chunks', chunks: ['«Las linternas se mecen sobre el agua negra.»'] });
    const titled = await master.post(`${url}/reveals/draft`, { title: 'El puerto de noche' });
    expect(chunksOf(titled.body).at(-1)).toEqual({
      type: 'done',
      text: 'Las linternas se mecen sobre el agua negra.',
    });
    expect(lastPrompt().user).toContain('Título de la escena: El puerto de noche');
    expect(lastPrompt().user).not.toContain('Notas del máster');

    const empty = await master.post(`${url}/reveals/draft`, { title: ' ', notes: ' ' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().issues).toEqual([
      {
        path: 'notes',
        message: 'Escribe unas notas o un título para que la IA sepa qué describir',
      },
    ]);
    expect(ollama.requests).toHaveLength(1);
  });

  it('solo la pide el máster, con la partida en juego', async () => {
    const { master, ana, campaign } = await table();
    const url = await openGame(master, campaign.id);
    const stranger = await t.register('intrusa');
    const body = { notes: 'Una posada' };

    expect((await ana.post(`${url}/reveals/draft`, body)).statusCode).toBe(403);
    expect((await stranger.post(`${url}/reveals/draft`, body)).statusCode).toBe(404);
    expect((await t.anonymous().post(`${url}/reveals/draft`, body)).statusCode).toBe(401);
    await master.post(`${url}/close`, {});
    const closed = await master.post(`${url}/reveals/draft`, body);
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error).toBe('La partida ya ha terminado');
    expect(ollama.requests).toHaveLength(0);
  });
});

describe('la IA propone complicaciones', () => {
  it('da tres ideas para un éxito con coste, en directo según las termina', async () => {
    const { master, ana, campaign, kael: sheet } = await table();
    const url = await openGame(master, campaign.id);
    await master.post(`${url}/reveals`, {
      title: 'El almacén',
      body: 'Cajas apiladas y un perro atado.',
    });
    // Ana tira con Kael: 1 + 4 + 6 = 11 contra 10.
    const roll = await rollKael(ana, url, sheet.id, [1, 4]);
    expect(roll.roll.result.outcome).toBe('partial');
    const before = await eventsOf(master, url);

    ollama.queue({
      kind: 'chunks',
      chunks: [
        '{"ideas": ["El chasquido',
        ' despierta al perro.", "1. **Se rompe** la ',
        'ganzúa."',
        ', "Llega la ronda',
        ' nocturna.", "Una cuarta que sobra."]}',
      ],
    });
    const response = await master.post(`${url}/rolls/${roll.id}/complications`, {
      intent: 'forzar la puerta del almacén',
    });
    expect(response.statusCode).toBe(200);
    // Cada idea llega entera, limpia y en su línea.
    expect(chunksOf(response.body)).toEqual([
      { type: 'delta', text: 'El chasquido despierta al perro.\n' },
      { type: 'delta', text: 'Se rompe la ganzúa.\n' },
      { type: 'delta', text: 'Llega la ronda nocturna.\n' },
      {
        type: 'done',
        text: 'El chasquido despierta al perro.\nSe rompe la ganzúa.\nLlega la ronda nocturna.',
      },
    ]);

    expect(ollama.requests[0]?.body).toMatchObject({
      stream: true,
      format: IDEAS_FORMAT,
      options: { temperature: 0.9, num_predict: 450 },
    });
    const { system, user } = lastPrompt();
    expect(system).toContain('Es un éxito con coste');
    expect(system).toContain(OUTCOME_GUIDES.test.partial);
    expect(user).toContain('El almacén\nCajas apiladas y un perro atado.');
    expect(user).toContain(
      'La tirada: Kael (Armas cuerpo a cuerpo), prueba normal (10): éxito con coste.',
    );
    expect(user).toContain('Lo que intentaba Kael: forzar la puerta del almacén');
    expect(await eventsOf(master, url)).toEqual(before);
  });

  it('también para los fallos, las pifias y las tiradas secretas del máster', async () => {
    const { master, campaign, kael: sheet } = await table();
    const url = await openGame(master, campaign.id);

    const failure = await rollKael(master, url, sheet.id, [1, 2], { situation: 'melee' });
    expect(failure.roll.result.outcome).toBe('failure');
    ollama.queue({ kind: 'chunks', chunks: ['{"ideas": ["El rival te desarma."]}'] });
    const failed = await master.post(`${url}/rolls/${failure.id}/complications`, {});
    expect(chunksOf(failed.body).at(-1)).toEqual({ type: 'done', text: 'El rival te desarma.' });
    expect(lastPrompt().system).toContain('Es un fallo');
    expect(lastPrompt().system).toContain(OUTCOME_GUIDES.melee.failure);
    expect(lastPrompt().user).not.toContain('Lo que intentaba');

    dice = fixedDice(1, 1);
    const secret = (
      await master.post(`${url}/rolls`, {
        actor: { kind: 'free', label: 'Guardia veterano', bonus: 6 },
        target: { kind: 'difficulty', difficulty: 10 },
        secret: true,
      })
    ).json().event;
    expect(secret).toMatchObject({ visibility: 'master', roll: { result: { outcome: 'fumble' } } });
    ollama.queue({ kind: 'chunks', chunks: ['{"ideas": ["Se le cae la llave."]}'] });
    const fumbled = await master.post(`${url}/rolls/${secret.id}/complications`, {});
    expect(chunksOf(fumbled.body).at(-1)).toEqual({ type: 'done', text: 'Se le cae la llave.' });
    expect(lastPrompt().system).toContain('Es una pifia');
    expect(lastPrompt().user).toContain('La tirada: Guardia veterano, prueba normal (10): pifia.');
  });

  it('si el modelo se corta a medias, valen las ideas que terminó', async () => {
    const { master, campaign, kael: sheet } = await table();
    const url = await openGame(master, campaign.id);
    const roll = await rollKael(master, url, sheet.id, [1, 4]);

    ollama.queue({ kind: 'chunks', chunks: ['{"ideas": ["Se rompe la ganzúa.", "Llega la ro'] });
    const response = await master.post(`${url}/rolls/${roll.id}/complications`, {});
    expect(chunksOf(response.body)).toEqual([
      { type: 'delta', text: 'Se rompe la ganzúa.\n' },
      { type: 'done', text: 'Se rompe la ganzúa.' },
    ]);

    ollama.queue({ kind: 'chunks', chunks: ['{"ideas": ['] });
    const nothing = await master.post(`${url}/rolls/${roll.id}/complications`, {});
    expect(chunksOf(nothing.body)).toEqual([
      { type: 'error', error: 'La IA no ha dicho nada. Prueba otra vez.' },
    ]);
  });

  it('no las propone para tiradas que salieron bien ni para lo que no es una tirada', async () => {
    const { master, campaign, kael: sheet } = await table();
    const url = await openGame(master, campaign.id);
    const success = await rollKael(master, url, sheet.id, [4, 3]);
    expect(success.roll.result.outcome).toBe('success');
    const reveal = (await master.post(`${url}/reveals`, { body: 'La puerta cede.' })).json().event;
    const otherGame = await openGame(
      master,
      (await master.post('/api/campaigns', { name: 'Otra' })).json().campaign.id,
    );
    const elsewhere = await rollKael(master, otherGame, sheet.id, [1, 4], {
      actor: { kind: 'free', label: 'Kael', bonus: 6 },
    });

    const went = await master.post(`${url}/rolls/${success.id}/complications`, {});
    expect(went.statusCode).toBe(409);
    expect(went.json().error).toBe(
      'Esa tirada salió bien: las complicaciones son para los éxitos con coste, los fallos y las pifias',
    );
    for (const eventId of [reveal.id, elsewhere.id, 'abc', '1.5', '0', '99999999999']) {
      const response = await master.post(`${url}/rolls/${eventId}/complications`, {});
      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe('Esa tirada no existe en esta partida');
    }
    expect(ollama.requests).toHaveLength(0);
  });

  it('solo las pide el máster, con la partida en juego (complicaciones)', async () => {
    const { master, ana, campaign, kael: sheet } = await table();
    const url = await openGame(master, campaign.id);
    const roll = await rollKael(master, url, sheet.id, [1, 4]);
    const stranger = await t.register('intrusa');
    const complications = `${url}/rolls/${roll.id}/complications`;

    expect((await ana.post(complications, {})).statusCode).toBe(403);
    expect((await stranger.post(complications, {})).statusCode).toBe(404);
    const long = await master.post(complications, { intent: 'a'.repeat(301) });
    expect(long.statusCode).toBe(400);
    expect(long.json().issues).toEqual([
      { path: 'intent', message: 'No puede pasar de 300 caracteres' },
    ]);
    await master.post(`${url}/close`, {});
    const closed = await master.post(complications, {});
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error).toBe('La partida ya ha terminado');
    expect(ollama.requests).toHaveLength(0);
  });
});

describe('la IA propone qué puede pasar ahora', () => {
  it('da tres ideas con la campaña, sus PNJ, lo último que pasó y lo que busca el máster', async () => {
    const { master, campaign } = await table();
    const first = await openGame(master, campaign.id);
    await master.post(`${first}/close`, {});
    await master.put(`${first}/recap`, { recap: 'Kael salvó a la hija del molinero.' });
    for (const npc of [
      { name: 'Brunilda', concept: 'Posadera del Ciervo Blanco, lo sabe todo del pueblo' },
      { name: 'El Tuerto' },
    ]) {
      await master.post(`/api/campaigns/${campaign.id}/npcs`, npc);
    }
    const url = await openGame(master, campaign.id);
    await master.post(`${url}/reveals`, { title: 'El camino', body: 'Llueve sin parar.' });
    await master.post(`${url}/reveals`, {
      title: 'El Ciervo Blanco',
      body: 'Humo, estofado y un bardo que desafina.',
    });
    await master.post(`${url}/notes`, { text: 'El bardo es un espía del conde' });
    const before = await eventsOf(master, url);

    ollama.queue({
      kind: 'chunks',
      chunks: [
        '{"ideas": ["Encuentro: un mensajero',
        ' empapado pregunta por Kael.", "**Rumor:** el molino ',
        'arde.", "Un rumor corre por la sala',
        ': el conde ha muerto."]}',
      ],
    });
    const response = await master.post(`${url}/ideas`, { hint: 'algo que les meta prisa' });
    expect(response.statusCode).toBe(200);
    // Sin las etiquetas que a veces pone el modelo, pero sin tocar una frase que empieza igual.
    expect(chunksOf(response.body)).toEqual([
      { type: 'delta', text: 'Un mensajero empapado pregunta por Kael.\n' },
      { type: 'delta', text: 'El molino arde.\n' },
      { type: 'delta', text: 'Un rumor corre por la sala: el conde ha muerto.\n' },
      {
        type: 'done',
        text: 'Un mensajero empapado pregunta por Kael.\nEl molino arde.\nUn rumor corre por la sala: el conde ha muerto.',
      },
    ]);

    expect(ollama.requests[0]?.body).toMatchObject({
      stream: true,
      format: IDEAS_FORMAT,
      options: { temperature: 0.9, num_predict: 450 },
    });
    const { system, user } = lastPrompt();
    expect(system).toContain('improvisar cuando la partida se atasca');
    expect(user).toContain('Fantasía de frontera');
    expect(user).toContain('Partida 1:\nKael salvó a la hija del molinero.');
    expect(user).toContain('- Kael: Mercenario de la Compañía Libre');
    expect(user).toContain(
      'PNJ de la campaña:\n- El Tuerto\n- Brunilda: Posadera del Ciervo Blanco, lo sabe todo del pueblo',
    );
    expect(user).toContain(
      'El camino\nLlueve sin parar.\n\nEl Ciervo Blanco\nHumo, estofado y un bardo que desafina.',
    );
    expect(user).not.toContain('espía');
    expect(user).toContain('Lo que busca el máster: algo que les meta prisa');
    expect(await eventsOf(master, url)).toEqual(before);
  });

  it('en una partida recién empezada, sin nada que contar, también', async () => {
    const { master, campaign } = await table();
    const url = await openGame(master, campaign.id);
    ollama.queue({ kind: 'chunks', chunks: ['{"ideas": ["Llaman a la puerta."]}'] });
    const response = await master.post(`${url}/ideas`, {});
    expect(chunksOf(response.body).at(-1)).toEqual({ type: 'done', text: 'Llaman a la puerta.' });
    const { user } = lastPrompt();
    expect(user).not.toContain('PNJ de la campaña');
    expect(user).not.toContain('Lo que ha pasado en la campaña');
    expect(user).not.toContain('Lo que busca el máster');
  });

  it('solo las pide el máster, con la partida en juego (ideas)', async () => {
    const { master, ana, campaign } = await table();
    const url = await openGame(master, campaign.id);
    const stranger = await t.register('intrusa');

    expect((await ana.post(`${url}/ideas`, {})).statusCode).toBe(403);
    expect((await stranger.post(`${url}/ideas`, {})).statusCode).toBe(404);
    expect((await t.anonymous().post(`${url}/ideas`, {})).statusCode).toBe(401);
    const long = await master.post(`${url}/ideas`, { hint: 'a'.repeat(301) });
    expect(long.statusCode).toBe(400);
    expect(long.json().issues).toEqual([
      { path: 'hint', message: 'No puede pasar de 300 caracteres' },
    ]);
    await master.post(`${url}/close`, {});
    const closed = await master.post(`${url}/ideas`, {});
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error).toBe('La partida ya ha terminado');
    expect(ollama.requests).toHaveLength(0);
  });
});

/** Un combate entre Kael y lo que se diga, en la escena «El puente». */
async function combatOn(master: TestClient, url: string, combatants: object[]) {
  await master.post(`${url}/scenes`, { title: 'El puente' });
  dice = fixedDice(...combatants.flatMap(() => [3, 3]));
  const response = await master.post(`${url}/combat`, { combatants });
  expect(response.statusCode).toBe(201);
  const started: GameEvent = response.json().event;
  if (started.kind !== 'combatStarted') throw new Error('No ha empezado el combate');
  return started.order;
}

describe('la IA narra un golpe', () => {
  it('propone tres maneras de contarlo, con la tirada, lo que ha causado y las armas', async () => {
    const { master, campaign, kael: sheet } = await table();
    await master.patch(`/api/characters/${sheet.id}`, {
      gear: { melee: { name: 'Espada larga', weapon: 'medium' }, armor: 'light', shield: false },
    });
    const url = await openGame(master, campaign.id);
    const order = await combatOn(master, url, [
      { kind: 'character', characterId: sheet.id },
      { kind: 'npc', name: 'Garrick', profile: 'veteran' },
    ]);
    const garrick = order.find(({ name }) => name === 'Garrick')!;
    // Kael 6 + 6 + 6 contra Garrick 1 + 1 + 6: crítico.
    dice = fixedDice(6, 6, 1, 1);
    const attack = await master.post(`${url}/rolls`, {
      actor: { kind: 'character', characterId: sheet.id, skill: 'melee-weapons' },
      target: { kind: 'opposed', opponent: { kind: 'free', label: 'Garrick', bonus: 6 } },
      situation: 'melee',
      blow: { attackerId: sheet.id, defenderId: garrick.id },
    });
    expect(attack.statusCode).toBe(201);
    const roll: GameEvent & { kind: 'roll' } = attack.json().event;
    expect(roll.roll.result.outcome).toBe('critical');
    await master.post(`${url}/damage`, { targetId: garrick.id, amount: 4, roll: roll.id });
    const before = await eventsOf(master, url);

    ollama.queue({
      kind: 'chunks',
      chunks: [
        '{"ideas": ["La espada muerde el hombro.", "Garrick se desploma.", "Cruje el puente."]}',
      ],
    });
    const response = await master.post(`${url}/rolls/${roll.id}/narration`, {
      hint: 'que caiga al río',
    });
    expect(response.statusCode).toBe(200);
    expect(chunksOf(response.body).at(-1)).toEqual({
      type: 'done',
      text: 'La espada muerde el hombro.\nGarrick se desploma.\nCruje el puente.',
    });
    expect(ollama.requests[0]?.body).toMatchObject({ format: IDEAS_FORMAT });
    const { system, user } = lastPrompt();
    expect(system).toContain('tres maneras de contar');
    expect(system).toContain(OUTCOME_GUIDES.melee.critical);
    expect(user).toContain('Escena en juego: El puente');
    expect(user).toContain(
      'Kael ataca a Garrick.\nLa tirada: Kael (Armas cuerpo a cuerpo) contra Garrick, cuerpo a cuerpo: crítico para Kael.',
    );
    expect(user).toContain('Con qué pelean:\n- Kael: Espada larga (media), armadura ligera');
    expect(user).toContain('Lo que ha causado:\n- Golpe de Kael a Garrick (4 de daño): cae.');
    expect(user).toContain('Lo que quiere destacar el máster: que caiga al río');
    expect(await eventsOf(master, url)).toEqual(before);
  });

  it('solo para tiradas de combate, y solo la pide el máster', async () => {
    const { master, ana, campaign, kael: sheet } = await table();
    const url = await openGame(master, campaign.id);
    const test = await rollKael(master, url, sheet.id, [3, 3]);
    const conflict = await master.post(`${url}/rolls/${test.id}/narration`, {});
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe('Esa tirada no es de combate: se narran los golpes');

    const melee = await rollKael(master, url, sheet.id, [3, 3], { situation: 'melee' });
    expect((await ana.post(`${url}/rolls/${melee.id}/narration`, {})).statusCode).toBe(403);
    const reveal = (await master.post(`${url}/reveals`, { body: 'El puente cruje.' })).json().event;
    const missing = await master.post(`${url}/rolls/${reveal.id}/narration`, {});
    expect(missing.statusCode).toBe(404);
    expect(ollama.requests).toHaveLength(0);
  });
});

describe('la IA propone qué hacen los PNJ', () => {
  it('da tres ideas sabiendo cómo va cada uno que pelea', async () => {
    const { master, campaign, kael: sheet } = await table();
    const url = await openGame(master, campaign.id);
    const order = await combatOn(master, url, [
      { kind: 'character', characterId: sheet.id },
      { kind: 'npc', name: 'Bandidos', profile: 'minion', count: 3 },
    ]);
    const bandits = order.find(({ name }) => name === 'Bandidos')!;
    await master.post(`${url}/damage`, { targetId: bandits.id, amount: 1 });
    await master.post(`${url}/damage`, { targetId: sheet.id, amount: 3 });

    ollama.queue({
      kind: 'chunks',
      chunks: ['{"ideas": ["Táctica: rodean a Kael.", "Cortan la cuerda.", "Huyen."]}'],
    });
    const response = await master.post(`${url}/combat/tactics`, {
      combatantId: bandits.id,
      hint: 'que huyan',
    });
    expect(response.statusCode).toBe(200);
    expect(chunksOf(response.body).at(-1)).toEqual({
      type: 'done',
      text: 'Rodean a Kael.\nCortan la cuerda.\nHuyen.',
    });
    const { system, user } = lastPrompt();
    expect(system).toContain('Le toca a Bandidos');
    expect(user).toContain('Escena en juego: El puente');
    expect(user).toContain(
      'Ronda 1. Quién pelea y cómo va:\n- Kael (PJ): herido; lleva Arma media\n- Bandidos (PNJ, esbirro): quedan 2 de 3 en pie',
    );
    expect(user).toContain('Le toca a:\n- Bandidos (PNJ, esbirro): quedan 2 de 3 en pie');
    expect(user).toContain('Lo que busca el máster: que huyan');
  });

  it('de un PNJ de la campaña sabe su concepto y sus objetivos, pero no sus secretos', async () => {
    const { master, campaign, kael: sheet } = await table();
    const npc = (
      await master.post(`/api/campaigns/${campaign.id}/npcs`, {
        name: 'Brunilda',
        concept: 'Posadera con un pasado de contrabandista',
        personality: 'Desconfiada y leal a los suyos',
        goals: 'Proteger la posada',
        secrets: 'Guarda el mapa de las cuevas',
        profile: 'veteran',
      })
    ).json().npc;
    const url = await openGame(master, campaign.id);
    const order = await combatOn(master, url, [
      { kind: 'character', characterId: sheet.id },
      { kind: 'npc', name: 'Brunilda', profile: 'veteran', npcId: npc.id },
    ]);
    const brunilda = order.find(({ name }) => name === 'Brunilda')!;

    ollama.queue({
      kind: 'chunks',
      chunks: ['{"ideas": ["Rompe una jarra en la cabeza de Kael."]}'],
    });
    const response = await master.post(`${url}/combat/tactics`, { combatantId: brunilda.id });
    expect(response.statusCode).toBe(200);
    const { user } = lastPrompt();
    expect(user).toContain(
      'Le toca a:\n- Brunilda (PNJ, veterano): sin heridas\nConcepto: Posadera con un pasado de contrabandista\nPersonalidad: Desconfiada y leal a los suyos\nObjetivos: Proteger la posada',
    );
    expect(user).not.toContain('mapa de las cuevas');
  });

  it('solo en combate, para PNJ que pelean, y solo las pide el máster', async () => {
    const { master, ana, campaign, kael: sheet } = await table();
    const url = await openGame(master, campaign.id);
    const noCombat = await master.post(`${url}/combat/tactics`, { combatantId: sheet.id });
    expect(noCombat.statusCode).toBe(409);
    expect(noCombat.json().error).toBe('No hay ningún combate en juego');

    const order = await combatOn(master, url, [
      { kind: 'character', characterId: sheet.id },
      { kind: 'npc', name: 'Lobos', profile: 'soldier', count: 2 },
    ]);
    const wolves = order.find(({ name }) => name === 'Lobos')!;
    const notNpc = await master.post(`${url}/combat/tactics`, { combatantId: sheet.id });
    expect(notNpc.statusCode).toBe(404);
    expect(notNpc.json().error).toBe('Esos PNJ no están en el combate');
    expect((await ana.post(`${url}/combat/tactics`, { combatantId: wolves.id })).statusCode).toBe(
      403,
    );
    expect(ollama.requests).toHaveLength(0);
  });
});
