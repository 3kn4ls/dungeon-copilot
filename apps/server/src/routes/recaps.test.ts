import type { Random } from '@dungeon-copilot/rules';
import { fixedDice, kael } from '@dungeon-copilot/rules/testing';
import type { AiTextChunk, GameSummary } from '@dungeon-copilot/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeOllama, type FakeOllama } from '../ai/fake-ollama';
import { createOllama } from '../ai/ollama';
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

async function openGame(master: TestClient, campaignId: string, body: object = {}) {
  const response = await master.post(`/api/campaigns/${campaignId}/games`, body);
  expect(response.statusCode).toBe(201);
  return `/api/games/${response.json().game.id}`;
}

/** Una partida ya terminada, con su resumen si se da. */
async function playedGame(master: TestClient, campaignId: string, recap = '') {
  const url = await openGame(master, campaignId);
  await master.post(`${url}/close`, {});
  if (recap) expect((await master.put(`${url}/recap`, { recap })).statusCode).toBe(200);
  return url;
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

describe('resumen de la partida', () => {
  it('el máster lo deja al terminar y lo ve toda la mesa', async () => {
    const { master, ana, campaign } = await table();
    const url = await playedGame(master, campaign.id);

    const saved = await master.put(`${url}/recap`, { recap: '  Kael encontró el mapa.  ' });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().game).toMatchObject({ status: 'closed', recap: 'Kael encontró el mapa.' });
    expect((await ana.get(url)).json().game.recap).toBe('Kael encontró el mapa.');
    const listed: GameSummary[] = (await ana.get(`/api/campaigns/${campaign.id}/games`)).json()
      .games;
    expect(listed.map((game) => game.recap)).toEqual(['Kael encontró el mapa.']);

    // Vacío, la partida se queda sin resumen.
    expect((await master.put(`${url}/recap`, { recap: ' ' })).json().game.recap).toBe('');
  });

  it('solo lo escribe el máster, y con la partida terminada', async () => {
    const { master, ana, campaign } = await table();
    const url = await openGame(master, campaign.id);
    const stranger = await t.register('intrusa');

    for (const response of [
      await master.put(`${url}/recap`, { recap: 'Aún no' }),
      await master.post(`${url}/recap/draft`, {}),
    ]) {
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe(
        'La partida sigue en juego: el resumen se escribe al terminarla',
      );
    }
    await master.post(`${url}/close`, {});
    expect((await ana.put(`${url}/recap`, { recap: 'Lo cuento yo' })).statusCode).toBe(403);
    expect((await ana.post(`${url}/recap/draft`, {})).statusCode).toBe(403);
    expect((await stranger.put(`${url}/recap`, { recap: 'Hola' })).statusCode).toBe(404);
    expect((await stranger.post(`${url}/recap/draft`, {})).statusCode).toBe(404);
    expect((await t.anonymous().put(`${url}/recap`, { recap: 'Hola' })).statusCode).toBe(401);

    const long = await master.put(`${url}/recap`, { recap: 'a'.repeat(4001) });
    expect(long.statusCode).toBe(400);
    expect(long.json().issues).toEqual([
      { path: 'recap', message: 'El resumen no puede pasar de 4000 caracteres' },
    ]);
    expect(ollama.requests).toHaveLength(0);
  });
});

describe('la IA propone el resumen', () => {
  it('lo escribe en directo con el registro, sin tiradas secretas ni guardar nada', async () => {
    const { master, campaign, kael: sheet } = await table();
    const npc = (
      await master.post(`/api/campaigns/${campaign.id}/npcs`, { name: 'Brunilda' })
    ).json().npc;
    const url = await openGame(master, campaign.id, { title: 'La cripta' });
    await master.post(`${url}/reveals`, {
      title: 'El Ciervo Blanco',
      body: 'Humo, estofado y un bardo que desafina.',
    });
    await master.post(`${url}/speeches`, { npcId: npc.id, text: '¿Qué os pongo, cariño?' });
    dice = fixedDice(4, 3, 1, 2);
    await master.post(`${url}/rolls`, {
      actor: { kind: 'character', characterId: sheet.id, skill: 'melee-weapons' },
      target: { kind: 'difficulty', difficulty: 10 },
      situation: 'melee',
    });
    await master.post(`${url}/rolls`, {
      actor: { kind: 'free', label: 'Emboscada en el camino', bonus: 4 },
      target: { kind: 'difficulty', difficulty: 10 },
      secret: true,
    });
    await master.post(`${url}/notes`, { text: 'El bardo es un espía del conde' });
    await master.post(`${url}/close`, {});

    ollama.queue({
      kind: 'chunks',
      chunks: ['**Resumen de la partida 1**', '\n\nKael llegó al Ciervo Blanco. ', 'Allí pagó.'],
    });
    const response = await master.post(`${url}/recap/draft`, {
      hint: 'Kael robó la llave del sótano',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-ndjson');
    // Sin el título que se inventa el modelo, tampoco mientras se escribe.
    expect(chunksOf(response.body)).toEqual([
      { type: 'delta', text: 'Kael llegó al Ciervo Blanco. ' },
      { type: 'delta', text: 'Allí pagó.' },
      { type: 'done', text: 'Kael llegó al Ciervo Blanco. Allí pagó.' },
    ]);

    expect(ollama.requests[0]?.body).toMatchObject({
      stream: true,
      options: { temperature: 0.5, num_predict: 800 },
    });
    const { system, user } = lastPrompt();
    expect(system).toContain('crónica de su campaña');
    expect(user).toContain('Fantasía de frontera');
    expect(user).toContain('- Kael');
    expect(user).toContain('(Partida 1, «La cripta»)');
    expect(user).toContain(
      '- El máster cuenta («El Ciervo Blanco»): Humo, estofado y un bardo que desafina.',
    );
    expect(user).toContain('- Brunilda (PNJ) dice: «¿Qué os pongo, cariño?»');
    expect(user).toContain(
      '- Tirada: Kael (Armas cuerpo a cuerpo), prueba normal (10), cuerpo a cuerpo: éxito pleno.',
    );
    expect(user).toContain('- Nota del máster, que los jugadores no ven: El bardo es un espía');
    expect(user).toContain('Kael robó la llave del sótano');
    expect(user).not.toContain('Emboscada');
    // Es una propuesta: hasta que el máster la guarde, la partida sigue sin resumen.
    expect((await master.get(url)).json().game.recap).toBe('');
  });

  it('cuenta lo que dicen los personajes en la mesa, pero no lo que es en secreto', async () => {
    const { master, ana, campaign, kael: sheet } = await table();
    const url = await openGame(master, campaign.id);
    const spoken = (
      await ana.post(`${url}/interventions`, {
        characterId: sheet.id,
        intent: 'speak',
        text: '¿Quién manda aquí?',
      })
    ).json().event;
    await master.post(`${url}/interventions/${spoken.id}/answer`, {});
    await ana.post(`${url}/interventions`, {
      characterId: sheet.id,
      intent: 'act',
      text: 'Me guardo la llave sin que nadie lo vea',
      secret: true,
    });
    await master.post(`${url}/reveals`, { body: 'Nadie te ha visto', to: sheet.id });
    await master.post(`${url}/close`, {});

    ollama.queue({ kind: 'chunks', chunks: ['Kael preguntó quién mandaba.'] });
    expect((await master.post(`${url}/recap/draft`, {})).statusCode).toBe(200);
    const { user } = lastPrompt();
    expect(user).toContain('- Kael (PJ) habla, según su jugador: ¿Quién manda aquí?');
    expect(user).not.toContain('llave');
    expect(user).not.toContain('Nadie te ha visto');
  });

  it('puede dejar fuera las notas y sigue el hilo de la partida anterior', async () => {
    const { master, campaign } = await table();
    await playedGame(master, campaign.id, 'Kael encontró el mapa de la cripta.');
    const url = await openGame(master, campaign.id);
    await master.post(`${url}/reveals`, { body: 'La puerta de la cripta está abierta.' });
    await master.post(`${url}/notes`, { text: 'El conde los vigila' });
    await master.post(`${url}/close`, {});

    ollama.queue({ kind: 'chunks', chunks: ['Bajaron a la cripta.'] });
    const response = await master.post(`${url}/recap/draft`, { useNotes: false });
    expect(chunksOf(response.body).at(-1)).toEqual({ type: 'done', text: 'Bajaron a la cripta.' });
    const { user } = lastPrompt();
    expect(user).toContain(
      'Resumen de la partida anterior (Partida 1):\nKael encontró el mapa de la cripta.',
    );
    expect(user).toContain('(Partida 2)');
    expect(user).not.toContain('El conde');
  });

  it('no pregunta a la IA si no hay nada que resumir', async () => {
    const { master, campaign } = await table();
    const url = await openGame(master, campaign.id);
    await master.post(`${url}/notes`, { text: 'Solo una nota' });
    await master.post(`${url}/close`, {});

    const empty = await master.post(`${url}/recap/draft`, { useNotes: false });
    expect(empty.statusCode).toBe(409);
    expect(empty.json().error).toBe(
      'No hay nada que resumir: el registro de la partida está vacío. Cuenta a la IA qué pasó o escribe tú el resumen.',
    );
    expect(ollama.requests).toHaveLength(0);

    // Con lo que cuenta el máster ya hay de qué partir.
    const told = await master.post(`${url}/recap/draft`, {
      useNotes: false,
      hint: 'Pasaron la noche jugando a los dados',
    });
    expect(told.statusCode).toBe(200);
    expect(lastPrompt().user).toContain('no tiene nada en el registro');
  });

  it('los fallos de Ollama llegan como error, antes o a mitad del resumen', async () => {
    const { master, campaign } = await table();
    const url = await openGame(master, campaign.id);
    await master.post(`${url}/reveals`, { body: 'Una puerta' });
    await master.post(`${url}/close`, {});

    ollama.queue({ kind: 'error', status: 404, error: "model 'fake' not found" });
    const missing = await master.post(`${url}/recap/draft`, {});
    expect(missing.statusCode).toBe(502);
    expect(missing.json().error).toContain('Ollama no tiene el modelo «fake»');

    ollama.queue({ kind: 'broken', chunks: ['Abrieron'], error: 'out of memory' });
    const broken = await master.post(`${url}/recap/draft`, {});
    expect(chunksOf(broken.body)).toEqual([
      { type: 'delta', text: 'Abrieron' },
      { type: 'error', error: 'Ollama ha fallado: out of memory' },
    ]);
  });
});

describe('memoria de la campaña', () => {
  it('los PNJ recuerdan los resúmenes de las últimas partidas', async () => {
    const { master, campaign } = await table();
    for (const number of [1, 2, 3, 4]) {
      await playedGame(master, campaign.id, `Lo que pasó en la partida ${number}.`);
    }
    await playedGame(master, campaign.id);
    const npc = (
      await master.post(`/api/campaigns/${campaign.id}/npcs`, { name: 'Brunilda' })
    ).json().npc;
    const url = await openGame(master, campaign.id);

    ollama.queue({ kind: 'chunks', chunks: ['¡Otra vez vosotros!'] });
    await master.post(`/api/npcs/${npc.id}/talk`, { gameId: url.split('/').at(-1) });
    const { system } = lastPrompt();
    expect(system).toContain('Lo que ha pasado en la campaña hasta ahora.');
    expect(system).toContain('Brunilda solo sabe lo que haya vivido o le hayan contado.');
    // Las tres últimas con resumen, de la más antigua a la más reciente.
    expect(system).not.toContain('partida 1.');
    expect(system).toContain(
      'Partida 2:\nLo que pasó en la partida 2.\n\nPartida 3:\nLo que pasó en la partida 3.\n\nPartida 4:\nLo que pasó en la partida 4.',
    );

    ollama.queue({
      kind: 'chunks',
      chunks: [JSON.stringify({ name: 'Odo', concept: '', profile: 'none' })],
    });
    await master.post(`/api/campaigns/${campaign.id}/npcs/generate`, {});
    expect(lastPrompt().user).toContain('Partida 4:\nLo que pasó en la partida 4.');
  });
});
