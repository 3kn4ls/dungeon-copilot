import { Agent, request } from 'node:http';
import { kael } from '@dungeon-copilot/rules/testing';
import type { AiTextChunk, GameEvent, NpcRequest, NpcView } from '@dungeon-copilot/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDecider } from '../ai/decide';
import { startFakeOllama, type FakeOllama } from '../ai/fake-ollama';
import { createOllama, type Ai } from '../ai/ollama';
import { buildApp } from '../app';
import { TEST_PASSWORD_PARAMS, createClient, useTestApp, type TestClient } from '../testing';

let ollama: FakeOllama;
// Antes que la app de pruebas: la app necesita saber dónde escucha el Ollama de mentira.
beforeAll(async () => {
  ollama = await startFakeOllama();
});
const t = useTestApp(() => ({ ai: createOllama({ url: ollama.url, model: 'fake' }) }));
beforeEach(() => ollama.reset());
afterAll(() => ollama.close());

let baseUrl = '';
beforeAll(async () => {
  // Para cortar una respuesta a medias hace falta un servidor de verdad.
  baseUrl = await t.app.listen({ port: 0, host: '127.0.0.1' });
});

const brunilda: NpcRequest = {
  name: ' Brunilda ',
  concept: 'Posadera del Ciervo Blanco',
  personality: 'Desconfiada con los forasteros, generosa con quien paga',
  speech: 'Llama «cariño» a todo el mundo',
  secrets: 'Esconde en el sótano a un desertor de la guardia',
};

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
  await ana.post(`/api/campaigns/${campaign.id}/characters`, kael());
  return { master, ana, campaign };
}

async function createNpc(
  master: TestClient,
  campaignId: string,
  body: NpcRequest = brunilda,
): Promise<NpcView> {
  const response = await master.post(`/api/campaigns/${campaignId}/npcs`, body);
  expect(response.statusCode).toBe(201);
  return response.json().npc;
}

async function openGame(master: TestClient, campaignId: string): Promise<string> {
  const response = await master.post(`/api/campaigns/${campaignId}/games`, {});
  expect(response.statusCode).toBe(201);
  return response.json().game.id;
}

/** La respuesta en directo de un PNJ: una línea JSON por trozo. */
const chunksOf = (body: string): AiTextChunk[] =>
  body
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as AiTextChunk);

describe('PNJ de la campaña', () => {
  it('el máster los crea, los cambia y los borra; la lista va por orden alfabético', async () => {
    const { master, campaign } = await table();
    const npc = await createNpc(master, campaign.id);
    expect(npc).toMatchObject({
      campaignId: campaign.id,
      name: 'Brunilda',
      concept: 'Posadera del Ciervo Blanco',
      appearance: '',
      goals: '',
      secrets: 'Esconde en el sótano a un desertor de la guardia',
      profile: null,
    });
    await createNpc(master, campaign.id, { name: 'aldric', profile: 'veteran' });
    const list = (await master.get(`/api/campaigns/${campaign.id}/npcs`)).json().npcs;
    expect(list.map((n: NpcView) => [n.name, n.profile])).toEqual([
      ['aldric', 'veteran'],
      ['Brunilda', null],
    ]);

    const changed = await master.patch(`/api/npcs/${npc.id}`, {
      secrets: 'Ya no esconde a nadie',
      profile: 'minion',
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().npc).toMatchObject({
      name: 'Brunilda',
      speech: 'Llama «cariño» a todo el mundo',
      secrets: 'Ya no esconde a nadie',
      profile: 'minion',
    });
    expect((await master.get(`/api/npcs/${npc.id}`)).json().npc.profile).toBe('minion');

    expect((await master.delete(`/api/npcs/${npc.id}`)).statusCode).toBe(204);
    expect((await master.get(`/api/npcs/${npc.id}`)).statusCode).toBe(404);
  });

  it('los jugadores no los ven y a quien no es de la campaña le parecen inexistentes', async () => {
    const { master, ana, campaign } = await table();
    const npc = await createNpc(master, campaign.id);
    const stranger = await t.register('intrusa');
    const url = `/api/npcs/${npc.id}`;

    expect((await ana.get(`/api/campaigns/${campaign.id}/npcs`)).statusCode).toBe(403);
    expect((await ana.post(`/api/campaigns/${campaign.id}/npcs`, brunilda)).statusCode).toBe(403);
    expect((await ana.get(url)).statusCode).toBe(403);
    expect((await ana.patch(url, { name: 'Otra' })).statusCode).toBe(403);
    expect((await ana.delete(url)).statusCode).toBe(403);
    expect((await stranger.get(`/api/campaigns/${campaign.id}/npcs`)).statusCode).toBe(404);
    expect((await stranger.get(url)).statusCode).toBe(404);
    expect((await stranger.delete(url)).statusCode).toBe(404);
    expect((await t.anonymous().get(url)).statusCode).toBe(401);
    expect((await master.get(url)).json().npc.name).toBe('Brunilda');
  });

  it('pide un nombre y un perfil del reglamento', async () => {
    const { master, campaign } = await table();
    const nameless = await master.post(`/api/campaigns/${campaign.id}/npcs`, { name: ' ' });
    expect(nameless.statusCode).toBe(400);
    expect(nameless.json()).toMatchObject({
      error: 'Revisa los datos del PNJ',
      issues: [{ path: 'name', message: 'El PNJ necesita un nombre' }],
    });
    const dragon = await master.post(`/api/campaigns/${campaign.id}/npcs`, {
      name: 'Smaug',
      profile: 'dragon',
    });
    expect(dragon.statusCode).toBe(400);
    const npc = await createNpc(master, campaign.id);
    expect((await master.patch(`/api/npcs/${npc.id}`, {})).statusCode).toBe(400);
  });

  it('se borran con su campaña', async () => {
    const { master, campaign } = await table();
    const npc = await createNpc(master, campaign.id);
    await master.delete(`/api/campaigns/${campaign.id}`);
    expect((await master.get(`/api/npcs/${npc.id}`)).statusCode).toBe(404);
  });
});

describe('la IA inventa PNJ', () => {
  const odo = {
    name: 'Odo',
    concept: 'Herrero de Villarroble',
    appearance: 'Calvo, con quemaduras en los antebrazos',
    personality: 'Hosco pero leal',
    speech: 'Gruñe más que habla',
    goals: 'Pagar sus deudas',
    secrets: 'Forja armas para los bandidos',
    profile: 'soldier',
  };

  it('propone un PNJ para la campaña sin guardarlo', async () => {
    const { master, campaign } = await table();
    await createNpc(master, campaign.id);
    ollama.queue({ kind: 'chunks', chunks: [JSON.stringify(odo)] });

    const response = await master.post(`/api/campaigns/${campaign.id}/npcs/generate`, {
      idea: 'un herrero que trabaja para los bandidos',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().npc).toEqual(odo);
    expect((await master.get(`/api/campaigns/${campaign.id}/npcs`)).json().npcs).toHaveLength(1);

    const [request] = ollama.requests;
    expect(request?.body).toMatchObject({ stream: false, format: { type: 'object' } });
    const prompt = request?.body.messages.at(-1)?.content;
    expect(prompt).toContain('Fantasía de frontera');
    expect(prompt).toContain('un herrero que trabaja para los bandidos');
    expect(prompt).toContain('PNJ que ya tiene la campaña (inventa uno distinto): Brunilda.');
  });

  it('completa lo que el máster ya ha rellenado sin cambiárselo', async () => {
    const { master, campaign } = await table();
    const url = `/api/campaigns/${campaign.id}/npcs/generate`;
    ollama.queue({ kind: 'chunks', chunks: [JSON.stringify(odo)] });
    const response = await master.post(url, { draft: { name: 'Brunilda', concept: '' } });
    expect(response.json().npc).toEqual({ ...odo, name: 'Brunilda' });
    expect(ollama.requests[0]?.body.messages.at(-1)?.content).toContain('- name: Brunilda');

    // «No pelea» también lo ha decidido el máster.
    ollama.queue({ kind: 'chunks', chunks: [JSON.stringify(odo)] });
    const peaceful = await master.post(url, { draft: { name: 'Brunilda', profile: null } });
    expect(peaceful.json().npc).toEqual({ ...odo, name: 'Brunilda', profile: null });
  });

  it('avisa si la IA no devuelve un PNJ que se entienda', async () => {
    const { master, campaign } = await table();
    ollama.queue({ kind: 'chunks', chunks: ['Hoy no me sale nada.'] });
    const response = await master.post(`/api/campaigns/${campaign.id}/npcs/generate`, {});
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe(
      'La IA no ha devuelto un PNJ que se entienda. Prueba otra vez.',
    );
  });

  it('solo para el máster, y explica los fallos de Ollama', async () => {
    const { master, ana, campaign } = await table();
    const url = `/api/campaigns/${campaign.id}/npcs/generate`;
    expect((await ana.post(url, {})).statusCode).toBe(403);
    expect(ollama.requests).toHaveLength(0);

    ollama.queue({ kind: 'error', status: 404, error: "model 'fake' not found" });
    const missing = await master.post(url, {});
    expect(missing.statusCode).toBe(502);
    expect(missing.json().error).toBe(
      'Ollama no tiene el modelo «fake». Descárgalo con «ollama pull fake» o cambia OLLAMA_MODEL.',
    );
  });
});

describe('hablar con un PNJ', () => {
  it('responde en directo como el PNJ, con lo que la mesa ve de la partida', async () => {
    const { master, campaign } = await table();
    const npc = await createNpc(master, campaign.id);
    const gameId = await openGame(master, campaign.id);
    await master.post(`/api/games/${gameId}/reveals`, {
      title: 'El Ciervo Blanco',
      body: 'Humo, estofado y un bardo que desafina.',
    });
    await master.post(`/api/games/${gameId}/notes`, { text: 'El bardo es un espía del conde' });
    const before = (await master.get(`/api/games/${gameId}`)).json().events.length;

    ollama.queue({
      kind: 'chunks',
      chunks: ['<think>A ver…</think>', 'Brunilda: ¿Un soldado? ', 'Aquí solo vienen borrachos.'],
    });
    const response = await master.post(`/api/npcs/${npc.id}/talk`, {
      gameId,
      history: [
        { role: 'table', text: 'Kael se acerca a la barra' },
        { role: 'npc', text: '¿Qué os pongo, cariño?' },
      ],
      input: '¿Has visto a un soldado herido?',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-ndjson');
    // Sin el razonamiento ni «Brunilda:» delante, tampoco mientras se escribe.
    expect(chunksOf(response.body)).toEqual([
      { type: 'delta', text: '¿Un soldado? ' },
      { type: 'delta', text: 'Aquí solo vienen borrachos.' },
      { type: 'done', text: '¿Un soldado? Aquí solo vienen borrachos.' },
    ]);

    const [request] = ollama.requests;
    expect(request?.body).toMatchObject({ stream: true, options: { temperature: 0.8 } });
    const [system, ...turns] = request?.body.messages ?? [];
    expect(system?.content).toContain('Eres Brunilda');
    expect(system?.content).toContain('Qué oculta: Esconde en el sótano a un desertor');
    expect(system?.content).toContain('Fantasía de frontera');
    expect(system?.content).toContain('- Kael');
    expect(system?.content).toContain('El Ciervo Blanco\nHumo, estofado y un bardo que desafina.');
    // Las notas del máster no llegan: el PNJ podría soltarlas.
    expect(system?.content).not.toContain('espía');
    expect(turns).toEqual([
      { role: 'user', content: 'Kael se acerca a la barra' },
      { role: 'assistant', content: '¿Qué os pongo, cariño?' },
      { role: 'user', content: '¿Has visto a un soldado herido?' },
    ]);
    // Hablar no añade nada a la partida: solo lo que el máster decida enseñar.
    expect((await master.get(`/api/games/${gameId}`)).json().events).toHaveLength(before);
  });

  it('fuera de la partida también se puede probar su voz', async () => {
    const { master, campaign } = await table();
    const npc = await createNpc(master, campaign.id);
    ollama.queue({ kind: 'chunks', chunks: ['¡Pasad, pasad!'] });
    const response = await master.post(`/api/npcs/${npc.id}/talk`, {});
    expect(chunksOf(response.body).at(-1)).toEqual({ type: 'done', text: '¡Pasad, pasad!' });
    const [system, turn] = ollama.requests[0]?.body.messages ?? [];
    expect(system?.content).not.toContain('Lo último que el máster ha descrito');
    expect(turn?.content).toContain('Brunilda toma la palabra');
  });

  it('solo el máster habla por sus PNJ, y con partidas de su campaña', async () => {
    const { master, ana, campaign } = await table();
    const npc = await createNpc(master, campaign.id);
    const url = `/api/npcs/${npc.id}/talk`;
    expect((await ana.post(url, { input: 'Hola' })).statusCode).toBe(403);
    const stranger = await t.register('intrusa');
    expect((await stranger.post(url, { input: 'Hola' })).statusCode).toBe(404);

    const other = (await master.post('/api/campaigns', { name: 'Otra' })).json().campaign;
    const otherGame = await openGame(master, other.id);
    const wrongGame = await master.post(url, { gameId: otherGame, input: 'Hola' });
    expect(wrongGame.statusCode).toBe(404);
    expect(wrongGame.json().error).toBe('Esa partida no es de la campaña de este PNJ');

    const badLine = await master.post(url, { history: [{ role: 'master', text: 'Hola' }] });
    expect(badLine.statusCode).toBe(400);
    expect(ollama.requests).toHaveLength(0);
  });

  it('los fallos de Ollama llegan como error, antes o a mitad de la respuesta', async () => {
    const { master, campaign } = await table();
    const npc = await createNpc(master, campaign.id);
    const url = `/api/npcs/${npc.id}/talk`;

    ollama.queue({ kind: 'error', status: 404, error: "model 'fake' not found" });
    const missing = await master.post(url, { input: 'Hola' });
    expect(missing.statusCode).toBe(502);
    expect(missing.json().error).toContain('Ollama no tiene el modelo «fake»');

    ollama.queue({ kind: 'broken', chunks: ['Te diré una cosa'], error: 'out of memory' });
    const broken = await master.post(url, { input: 'Hola' });
    expect(broken.statusCode).toBe(200);
    expect(chunksOf(broken.body)).toEqual([
      { type: 'delta', text: 'Te diré una cosa' },
      { type: 'error', error: 'Ollama ha fallado: out of memory' },
    ]);

    ollama.queue({ kind: 'chunks', chunks: ['   '] });
    const silent = await master.post(url, { input: 'Hola' });
    expect(chunksOf(silent.body)).toEqual([
      { type: 'error', error: 'La IA no ha dicho nada. Prueba otra vez.' },
    ]);
  });

  it('si el máster deja de esperar, se corta también la petición a Ollama', async () => {
    const { master, campaign } = await table();
    const npc = await createNpc(master, campaign.id);
    ollama.queue({ kind: 'chunks', chunks: ['Érase una vez… '], hang: true });
    const aborted = ollama.nextAbort();

    // Con node:http y sin agente: fetch abre otra conexión al cortar y retrasa el apagado.
    const first = await new Promise<string>((resolve, reject) => {
      const talk = request(
        `${baseUrl}/api/npcs/${npc.id}/talk`,
        {
          method: 'POST',
          agent: false,
          headers: { cookie: master.cookie ?? '', 'content-type': 'application/json' },
        },
        (response) => {
          response.setEncoding('utf8');
          response.once('data', (data: string) => {
            resolve(data);
            talk.destroy();
          });
        },
      );
      talk.on('error', reject);
      talk.end(JSON.stringify({ input: 'Cuéntanos una historia larga' }));
    });
    expect(chunksOf(first)).toEqual([{ type: 'delta', text: 'Érase una vez… ' }]);
    await aborted;
  });

  it('si el máster se va antes de que empiece la respuesta, ni se pregunta a Ollama', async () => {
    const { master, campaign } = await table();
    const npc = await createNpc(master, campaign.id);
    const real = createOllama({ url: ollama.url, model: 'fake' });
    const asked: Promise<AsyncIterable<string>>[] = [];
    const ai: Ai = {
      model: real.model,
      stream: (question) => {
        const answer = real.stream(question);
        asked.push(answer);
        return answer;
      },
      complete: (question) => real.complete(question),
      close: () => real.close(),
    };
    const app = await buildApp({ db: t.db, passwordParams: TEST_PASSWORD_PARAMS, ai });
    // Se va mientras el servidor aún consulta la base de datos.
    let reached!: () => void;
    const waiting = new Promise<void>((resolve) => (reached = resolve));
    app.addHook('preHandler', async (req) => {
      reached();
      await new Promise((resolve) => req.raw.socket.once('close', resolve));
    });
    try {
      const url = await app.listen({ port: 0, host: '127.0.0.1' });
      const talk = request(`${url}/api/npcs/${npc.id}/talk`, {
        method: 'POST',
        agent: false,
        headers: { cookie: master.cookie ?? '', 'content-type': 'application/json' },
      });
      talk.on('error', () => undefined);
      talk.end(JSON.stringify({ input: 'Hola' }));
      await waiting;
      talk.destroy();

      await vi.waitFor(() => expect(asked).toHaveLength(1));
      await expect(asked[0]).rejects.toThrow();
      expect(ollama.requests).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('al apagar el servidor avisa del corte y no se queda esperando a la conexión', async () => {
    const { master, campaign } = await table();
    const npc = await createNpc(master, campaign.id);
    const app = await buildApp({
      db: t.db,
      passwordParams: TEST_PASSWORD_PARAMS,
      ai: createOllama({ url: ollama.url, model: 'fake' }),
    });
    // Como un navegador: la conexión queda abierta para la siguiente petición.
    const agent = new Agent({ keepAlive: true });
    let closed = false;
    try {
      const url = await app.listen({ port: 0, host: '127.0.0.1' });
      ollama.queue({ kind: 'chunks', chunks: ['Érase una vez… '], hang: true });
      let started!: () => void;
      const streaming = new Promise<void>((resolve) => (started = resolve));
      const body = new Promise<string>((resolve, reject) => {
        const talk = request(
          `${url}/api/npcs/${npc.id}/talk`,
          {
            method: 'POST',
            agent,
            headers: { cookie: master.cookie ?? '', 'content-type': 'application/json' },
          },
          (response) => {
            let text = '';
            response.setEncoding('utf8');
            response.on('data', (data: string) => {
              text += data;
              started();
            });
            response.on('end', () => resolve(text));
          },
        );
        talk.on('error', reject);
        talk.end(JSON.stringify({ input: 'Cuéntanos una historia larga' }));
      });
      await streaming;

      const start = Date.now();
      await app.close();
      closed = true;
      expect(Date.now() - start).toBeLessThan(2_000);
      expect(chunksOf(await body)).toEqual([
        { type: 'delta', text: 'Érase una vez… ' },
        { type: 'error', error: 'El servidor se está apagando' },
      ]);
    } finally {
      agent.destroy();
      if (!closed) await app.close();
    }
  });

  it('sin Ollama configurado, la web lo sabe y la IA responde 503', async () => {
    const { master, campaign } = await table();
    const npc = await createNpc(master, campaign.id);
    expect((await master.get('/api/ai')).json()).toEqual({
      enabled: true,
      model: 'fake',
      decisions: false,
      decisionModel: null,
    });
    expect((await t.anonymous().get('/api/ai')).statusCode).toBe(401);

    const withoutAi = await buildApp({ db: t.db, passwordParams: TEST_PASSWORD_PARAMS });
    try {
      const client = createClient(withoutAi, master.cookie);
      expect((await client.get('/api/ai')).json()).toEqual({
        enabled: false,
        model: null,
        decisions: false,
        decisionModel: null,
      });
      const talk = await client.post(`/api/npcs/${npc.id}/talk`, { input: 'Hola' });
      expect(talk.statusCode).toBe(503);
      expect(talk.json().error).toContain('OLLAMA_URL');
      const generate = await client.post(`/api/campaigns/${campaign.id}/npcs/generate`, {});
      expect(generate.statusCode).toBe(503);
      // Los PNJ siguen funcionando sin IA.
      expect((await client.get(`/api/npcs/${npc.id}`)).statusCode).toBe(200);
    } finally {
      await withoutAi.close();
    }
  });

  it('con solo la IA que decide, la web lo sabe y la que escribe responde 503', async () => {
    const { master, campaign } = await table();
    const npc = await createNpc(master, campaign.id);
    const onlyDecisions = await buildApp({
      db: t.db,
      passwordParams: TEST_PASSWORD_PARAMS,
      decider: createDecider({ url: ollama.url, model: 'nimble' }),
    });
    try {
      const client = createClient(onlyDecisions, master.cookie);
      expect((await client.get('/api/ai')).json()).toEqual({
        enabled: false,
        model: null,
        decisions: true,
        decisionModel: 'nimble',
      });
      const talk = await client.post(`/api/npcs/${npc.id}/talk`, { input: 'Hola' });
      expect(talk.statusCode).toBe(503);
    } finally {
      await onlyDecisions.close();
    }
  });
});

describe('lo que dice un PNJ en la partida', () => {
  it('el máster lo enseña a toda la mesa, con el nombre que tenía el PNJ', async () => {
    const { master, ana, campaign } = await table();
    const npc = await createNpc(master, campaign.id);
    const gameId = await openGame(master, campaign.id);

    const response = await master.post(`/api/games/${gameId}/speeches`, {
      npcId: npc.id,
      text: ' ¿Qué os pongo, cariño? ',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().event).toMatchObject({
      kind: 'speech',
      npcId: npc.id,
      name: 'Brunilda',
      text: '¿Qué os pongo, cariño?',
      visibility: 'public',
      authorName: 'Edu',
    });

    await master.patch(`/api/npcs/${npc.id}`, { name: 'Brunilda la Tuerta' });
    await master.delete(`/api/npcs/${npc.id}`);
    const seen: GameEvent[] = (await ana.get(`/api/games/${gameId}`)).json().events;
    expect(seen.at(-1)).toMatchObject({ kind: 'speech', name: 'Brunilda' });
    const token = (await master.get(`/api/campaigns/${campaign.id}`)).json().campaign.screenToken;
    const screen = (await t.anonymous().get(`/api/screens/${token}`)).json();
    expect(screen.events.at(-1)).toMatchObject({ kind: 'speech', text: '¿Qué os pongo, cariño?' });
  });

  it('solo el máster, con PNJ de la campaña y mientras la partida sigue', async () => {
    const { master, ana, campaign } = await table();
    const npc = await createNpc(master, campaign.id);
    const gameId = await openGame(master, campaign.id);
    const url = `/api/games/${gameId}/speeches`;

    expect((await ana.post(url, { npcId: npc.id, text: 'Hola' })).statusCode).toBe(403);
    expect((await master.post(url, { npcId: npc.id, text: '  ' })).statusCode).toBe(400);
    const other = (await master.post('/api/campaigns', { name: 'Otra' })).json().campaign;
    const foreign = await createNpc(master, other.id, { name: 'Forastero' });
    const wrong = await master.post(url, { npcId: foreign.id, text: 'Hola' });
    expect(wrong.statusCode).toBe(404);
    expect(wrong.json().error).toBe('Ese PNJ no está en esta campaña');

    await master.post(`/api/games/${gameId}/close`, {});
    expect((await master.post(url, { npcId: npc.id, text: 'Hola' })).statusCode).toBe(409);
  });
});
