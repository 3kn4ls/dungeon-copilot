import type { Random } from '@dungeon-copilot/rules';
import { fixedDice, kael as kaelBuild } from '@dungeon-copilot/rules/testing';
import type { GameEvent } from '@dungeon-copilot/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { useTestApp, type TestClient } from '../testing';

let dice: Random = () => {
  throw new Error('Esta prueba no esperaba ninguna tirada');
};
const t = useTestApp({ random: () => dice() });
const loadDice = (...faces: number[]) => {
  dice = fixedDice(...faces);
};

let baseUrl = '';
beforeAll(async () => {
  // El directo necesita un servidor de verdad: inject espera a que la respuesta termine.
  baseUrl = await t.app.listen({ port: 0, host: '127.0.0.1' });
});

/** Máster, dos jugadores y la ficha de Kael, que es de Ana. */
async function table() {
  const master = await t.register('edu', 'Edu');
  const ana = await t.register('ana', 'Ana');
  const bruno = await t.register('bruno', 'Bruno');
  const campaign = (await master.post('/api/campaigns', { name: 'La Marca del Este' })).json()
    .campaign;
  for (const player of [ana, bruno]) {
    await player.post('/api/campaigns/join', { inviteCode: campaign.inviteCode });
  }
  const kaelSheet = (await ana.post(`/api/campaigns/${campaign.id}/characters`, kaelBuild())).json()
    .character;
  return { master, ana, bruno, campaign, kael: kaelSheet };
}

async function openGame(master: TestClient, campaignId: string, body: object = {}) {
  const response = await master.post(`/api/campaigns/${campaignId}/games`, body);
  expect(response.statusCode).toBe(201);
  const game = response.json().game;
  return { game, url: `/api/games/${game.id}` };
}

const events = async (client: TestClient, url: string): Promise<GameEvent[]> =>
  (await client.get(url)).json().events;
const kinds = (list: GameEvent[]) => list.map((event) => event.kind);

describe('abrir y cerrar partidas', () => {
  it('el máster abre una partida numerada y los jugadores la ven', async () => {
    const { master, ana, campaign } = await table();
    const { game, url } = await openGame(master, campaign.id, { title: 'La cripta' });
    expect(game).toMatchObject({
      number: 1,
      title: 'La cripta',
      status: 'open',
      closedAt: null,
      campaignId: campaign.id,
      campaignName: 'La Marca del Este',
      role: 'master',
    });
    expect(game.screenToken).toMatch(/^[0-9a-f]{32}$/);

    const listed = (await ana.get(`/api/campaigns/${campaign.id}/games`)).json().games;
    expect(listed).toMatchObject([{ id: game.id, number: 1, status: 'open' }]);
    const state = (await ana.get(url)).json();
    expect(state.game.role).toBe('player');
    expect(state.game.screenToken).toBeUndefined();
    expect(state.events).toMatchObject([
      { kind: 'opened', number: 1, title: 'La cripta', authorName: 'Edu', visibility: 'public' },
    ]);
    const [summary] = (await ana.get('/api/campaigns')).json().campaigns;
    expect(summary.openGameId).toBe(game.id);
  });

  it('solo hay una partida en juego a la vez y solo la abre el máster', async () => {
    const { master, ana, campaign } = await table();
    await openGame(master, campaign.id);
    const again = await master.post(`/api/campaigns/${campaign.id}/games`, {});
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('Ya hay una partida en juego en esta campaña');
    expect((await ana.post(`/api/campaigns/${campaign.id}/games`, {})).statusCode).toBe(403);
    const stranger = await t.register('intrusa');
    expect((await stranger.post(`/api/campaigns/${campaign.id}/games`, {})).statusCode).toBe(404);
    expect((await stranger.get(`/api/campaigns/${campaign.id}/games`)).statusCode).toBe(404);
  });

  it('al abrir se recarga la Suerte y al cerrar se dan los PX de fin de sesión', async () => {
    const { master, ana, campaign, kael } = await table();
    await ana.patch(`/api/characters/${kael.id}`, { luck: 0 });
    const { url } = await openGame(master, campaign.id);
    expect((await ana.get(`/api/characters/${kael.id}`)).json().character.luck).toBe(3);

    const closed = await master.post(`${url}/close`, {});
    expect(closed.statusCode).toBe(200);
    expect(closed.json().game.status).toBe('closed');
    expect(closed.json().game.closedAt).not.toBeNull();
    expect(closed.json().event).toMatchObject({ kind: 'closed', xpAwarded: 2 });
    expect((await ana.get(`/api/characters/${kael.id}`)).json().character.xp).toBe(2);
    const [summary] = (await ana.get('/api/campaigns')).json().campaigns;
    expect(summary.openGameId).toBeNull();

    const { game: next } = await openGame(master, campaign.id);
    expect(next.number).toBe(2);
  });

  it('se puede abrir sin recargar la Suerte y cerrar sin dar PX', async () => {
    const { master, ana, campaign, kael } = await table();
    await ana.patch(`/api/characters/${kael.id}`, { luck: 1 });
    const { url } = await openGame(master, campaign.id, { refillLuck: false });
    await master.post(`${url}/close`, { awardXp: false });
    const character = (await ana.get(`/api/characters/${kael.id}`)).json().character;
    expect(character).toMatchObject({ luck: 1, xp: 0 });
    expect((await events(ana, url)).at(-1)).toMatchObject({ kind: 'closed', xpAwarded: 0 });
  });

  it('una partida terminada no admite más cambios y solo la cierra el máster', async () => {
    const { master, ana, campaign, kael } = await table();
    const { url } = await openGame(master, campaign.id);
    expect((await ana.post(`${url}/close`, {})).statusCode).toBe(403);
    await master.post(`${url}/close`, {});

    const roll = {
      actor: { kind: 'character', characterId: kael.id, skill: 'athletics' },
      target: { kind: 'difficulty', difficulty: 10 },
    };
    for (const response of [
      await master.post(`${url}/reveals`, { body: 'Una puerta' }),
      await master.post(`${url}/notes`, { text: 'Nota' }),
      await ana.post(`${url}/rolls`, roll),
      await master.post(`${url}/close`, {}),
    ]) {
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe('La partida ya ha terminado');
    }
  });
});

describe('resumen sin IA', () => {
  it('el máster lo escribe a mano; pedírselo a la IA avisa de que no está configurada', async () => {
    const { master, campaign } = await table();
    const { url } = await openGame(master, campaign.id);
    await master.post(`${url}/reveals`, { body: 'Una puerta' });
    await master.post(`${url}/close`, {});

    const draft = await master.post(`${url}/recap/draft`, {});
    expect(draft.statusCode).toBe(503);
    expect(draft.json().error).toBe(
      'La IA no está configurada: el servidor necesita OLLAMA_URL y OLLAMA_MODEL para usar Ollama',
    );
    const saved = await master.put(`${url}/recap`, { recap: 'Abrieron la puerta.' });
    expect(saved.json().game.recap).toBe('Abrieron la puerta.');
  });
});

describe('ayuda para narrar sin IA', () => {
  it('describir una escena o proponer complicaciones avisa de que no está configurada', async () => {
    const { master, campaign, kael } = await table();
    const { url } = await openGame(master, campaign.id);
    loadDice(1, 4);
    const roll = await master.post(`${url}/rolls`, {
      actor: { kind: 'character', characterId: kael.id, skill: 'melee-weapons' },
      target: { kind: 'difficulty', difficulty: 10 },
    });
    expect(roll.json().event.roll.result.outcome).toBe('partial');

    for (const response of [
      await master.post(`${url}/reveals/draft`, { notes: 'Una posada' }),
      await master.post(`${url}/rolls/${roll.json().event.id}/complications`, {}),
    ]) {
      expect(response.statusCode).toBe(503);
      expect(response.json().error).toBe(
        'La IA no está configurada: el servidor necesita OLLAMA_URL y OLLAMA_MODEL para usar Ollama',
      );
    }
  });
});

describe('revelar y anotar', () => {
  it('lo que revela el máster lo ve toda la mesa; sus notas, solo él', async () => {
    const { master, ana, campaign } = await table();
    const { url } = await openGame(master, campaign.id);

    const reveal = await master.post(`${url}/reveals`, {
      title: 'El posadero',
      body: 'Un hombre grueso que no deja de secarse las manos.',
    });
    expect(reveal.statusCode).toBe(201);
    expect(reveal.json().event).toMatchObject({
      kind: 'reveal',
      title: 'El posadero',
      visibility: 'public',
      authorName: 'Edu',
    });
    const note = await master.post(`${url}/notes`, { text: 'Es un espía del barón' });
    expect(note.json().event).toMatchObject({ kind: 'note', visibility: 'master' });

    expect(kinds(await events(ana, url))).toEqual(['opened', 'reveal']);
    expect(kinds(await events(master, url))).toEqual(['opened', 'reveal', 'note']);
  });

  it('los jugadores no revelan ni anotan, y lo vacío no vale', async () => {
    const { master, ana, campaign } = await table();
    const { url } = await openGame(master, campaign.id);
    expect((await ana.post(`${url}/reveals`, { body: 'Hola' })).statusCode).toBe(403);
    expect((await ana.post(`${url}/notes`, { text: 'Hola' })).statusCode).toBe(403);
    const empty = await master.post(`${url}/reveals`, { body: '   ' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().issues).toEqual([
      { path: 'body', message: 'Escribe lo que quieres enseñar a la mesa' },
    ]);
  });

  it('quien no es de la campaña no ve la partida', async () => {
    const { master, campaign } = await table();
    const { url } = await openGame(master, campaign.id);
    const stranger = await t.register('intrusa');
    expect((await stranger.get(url)).statusCode).toBe(404);
    expect((await stranger.post(`${url}/reveals`, { body: 'Hola' })).statusCode).toBe(404);
    expect((await t.anonymous().get(url)).statusCode).toBe(401);
    expect((await master.get('/api/games/no-es-un-id')).statusCode).toBe(404);
  });
});

describe('tiradas en la partida', () => {
  it('un jugador tira con su personaje y el bonificador sale de la ficha', async () => {
    const { master, ana, bruno, campaign, kael } = await table();
    const { url } = await openGame(master, campaign.id);

    loadDice(4, 3);
    const response = await ana.post(`${url}/rolls`, {
      actor: { kind: 'character', characterId: kael.id, skill: 'melee-weapons' },
      target: { kind: 'difficulty', difficulty: 10 },
      situation: 'melee',
    });
    expect(response.statusCode).toBe(201);
    const { event } = response.json();
    expect(event).toMatchObject({ kind: 'roll', visibility: 'public', authorName: 'Ana' });
    expect(event.roll).toMatchObject({
      actor: { label: 'Kael', characterId: kael.id, check: 'Armas cuerpo a cuerpo' },
      target: { kind: 'difficulty', label: 'Normal (10)' },
      situation: 'melee',
      notes: [],
      result: {
        kind: 'test',
        // Fuerza 4 + rango 2.
        roller: { bonus: 6, total: 13, dice: { kept: [3, 4], edge: 'none' } },
        margin: 3,
        outcome: 'success',
      },
    });
    expect(kinds(await events(bruno, url))).toEqual(['opened', 'roll']);
  });

  it('puede tirar una habilidad con otro atributo, o solo con un atributo', async () => {
    const { master, ana, campaign, kael } = await table();
    const { url } = await openGame(master, campaign.id);

    loadDice(2, 2, 5, 5);
    const withDexterity = await ana.post(`${url}/rolls`, {
      actor: {
        kind: 'character',
        characterId: kael.id,
        skill: 'athletics',
        attribute: 'dexterity',
      },
      target: { kind: 'difficulty', difficulty: 9 },
    });
    expect(withDexterity.json().event.roll.actor.check).toBe('Atletismo con Destreza');
    expect(withDexterity.json().event.roll.result.roller.bonus).toBe(4);
    expect(withDexterity.json().event.roll.target.label).toBe('Dificultad 9');

    const attributeOnly = await ana.post(`${url}/rolls`, {
      actor: { kind: 'character', characterId: kael.id, attribute: 'charisma', modifier: 2 },
      target: { kind: 'difficulty', difficulty: 12 },
    });
    expect(attributeOnly.json().event.roll.actor.check).toBe('Carisma');
    expect(attributeOnly.json().event.roll.result.roller.bonus).toBe(3);
  });

  it('la herida grave da desventaja en tiradas físicas y lo explica', async () => {
    const { master, ana, campaign, kael } = await table();
    const { url } = await openGame(master, campaign.id);
    // Aguante 2: dos rasguños y dos niveles más, grave.
    const damage = await master.post(`/api/characters/${kael.id}/damage`, { amount: 4 });
    expect(damage.json().character.wounds.severity).toBe('grave');

    loadDice(6, 5, 1);
    const physical = (
      await ana.post(`${url}/rolls`, {
        actor: { kind: 'character', characterId: kael.id, skill: 'athletics' },
        target: { kind: 'difficulty', difficulty: 10 },
      })
    ).json().event.roll;
    expect(physical.result.roller.dice).toEqual({
      rolled: [6, 5, 1],
      kept: [1, 5],
      edge: 'disadvantage',
    });
    expect(physical.notes).toEqual(['Kael tira con desventaja por su herida grave']);

    // Una ventaja por la situación y la desventaja de la herida se anulan.
    loadDice(3, 4);
    const cancelled = (
      await ana.post(`${url}/rolls`, {
        actor: { kind: 'character', characterId: kael.id, skill: 'athletics', edge: 'advantage' },
        target: { kind: 'difficulty', difficulty: 10 },
      })
    ).json().event.roll;
    expect(cancelled.result.roller.dice.edge).toBe('none');

    loadDice(3, 3);
    const mental = (
      await ana.post(`${url}/rolls`, {
        actor: { kind: 'character', characterId: kael.id, skill: 'perception' },
        target: { kind: 'difficulty', difficulty: 8 },
      })
    ).json().event.roll;
    expect(mental.result.roller.dice.edge).toBe('none');
    expect(mental.notes).toEqual([]);
  });

  it('el máster tira por un PNJ contra la defensa de un personaje, también en secreto', async () => {
    const { master, ana, campaign, kael } = await table();
    const { url } = await openGame(master, campaign.id);

    loadDice(5, 5, 2, 3);
    const response = await master.post(`${url}/rolls`, {
      actor: { kind: 'free', label: 'Guardia veterano', bonus: 4 },
      target: {
        kind: 'opposed',
        opponent: { kind: 'character', characterId: kael.id, skill: 'acrobatics' },
      },
      situation: 'melee',
      secret: true,
    });
    expect(response.statusCode).toBe(201);
    const { event } = response.json();
    expect(event.visibility).toBe('master');
    expect(event.roll).toMatchObject({
      actor: { label: 'Guardia veterano' },
      target: { kind: 'opposed', label: 'Kael', characterId: kael.id, check: 'Acrobacias' },
      result: {
        kind: 'opposed',
        actor: { bonus: 4, total: 14 },
        // Destreza 3, sin rango en Acrobacias.
        opponent: { bonus: 3, total: 8 },
        margin: 6,
        outcome: 'success',
      },
    });
    expect(kinds(await events(ana, url))).toEqual(['opened']);
    expect(kinds(await events(master, url))).toEqual(['opened', 'roll']);
  });

  it('un jugador solo tira con sus personajes, sin PNJ ni tiradas secretas', async () => {
    const { master, ana, bruno, campaign, kael } = await table();
    const { url } = await openGame(master, campaign.id);
    const actor = { kind: 'character', characterId: kael.id, skill: 'athletics' };
    const target = { kind: 'difficulty', difficulty: 10 };

    const notMine = await bruno.post(`${url}/rolls`, { actor, target });
    expect(notMine.statusCode).toBe(403);
    expect(notMine.json().error).toBe('Solo puedes tirar con tus personajes');
    const npc = await ana.post(`${url}/rolls`, {
      actor,
      target: { kind: 'opposed', opponent: { kind: 'free', label: 'Orco', bonus: 3 } },
    });
    expect(npc.statusCode).toBe(403);
    expect((await ana.post(`${url}/rolls`, { actor, target, secret: true })).statusCode).toBe(403);
    expect(kinds(await events(master, url))).toEqual(['opened']);
  });

  it('rechaza habilidades inventadas o avanzadas y personajes de otra campaña', async () => {
    const { master, ana, campaign, kael } = await table();
    const { url } = await openGame(master, campaign.id);
    const target = { kind: 'difficulty', difficulty: 10 };
    const roll = (actor: object) => ana.post(`${url}/rolls`, { actor, target });

    const invented = await roll({ kind: 'character', characterId: kael.id, skill: 'magia' });
    expect(invented.statusCode).toBe(400);
    expect(invented.json().error).toBe('Esa habilidad no existe');
    const advanced = await roll({
      kind: 'character',
      characterId: kael.id,
      skill: 'brutal-charge',
    });
    expect(advanced.statusCode).toBe(400);
    expect(advanced.json().error).toBe('Carga brutal es avanzada: se tira con su habilidad básica');
    const nothing = await roll({ kind: 'character', characterId: kael.id });
    expect(nothing.statusCode).toBe(400);

    const other = (await ana.post('/api/campaigns', { name: 'Otra' })).json().campaign;
    const elsewhere = (await ana.post(`/api/campaigns/${other.id}/characters`, kaelBuild())).json()
      .character;
    const foreign = await roll({
      kind: 'character',
      characterId: elsewhere.id,
      skill: 'athletics',
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error).toBe('Ese personaje no está en esta campaña');
  });
});

interface Stream {
  status: number;
  /** Siguiente evento, o "end" si el servidor cerró el directo. */
  next(): Promise<GameEvent | 'end'>;
  close(): void;
}

const streams: Stream[] = [];
afterEach(() => {
  for (const stream of streams.splice(0)) stream.close();
});

async function connect(
  path: string,
  client?: TestClient,
  headers: Record<string, string> = {},
): Promise<Stream> {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { ...headers, ...(client?.cookie ? { cookie: client.cookie } : {}) },
    signal: controller.signal,
  });
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  const stream: Stream = {
    status: response.status,
    async next() {
      if (!reader) return 'end';
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block
            .split('\n')
            .filter((line) => line.startsWith('data: '))
            .map((line) => line.slice('data: '.length))
            .join('\n');
          // Los bloques sin datos son el "retry" inicial o los comentarios de latido.
          if (data) return JSON.parse(data) as GameEvent;
          continue;
        }
        const { value, done } = await reader.read();
        if (done) return 'end';
        buffer += value;
      }
    },
    close: () => controller.abort(),
  };
  streams.push(stream);
  return stream;
}

describe('directo de la partida', () => {
  it('cada uno recibe en vivo solo lo que puede ver', async () => {
    const { master, ana, campaign } = await table();
    const { game, url } = await openGame(master, campaign.id);
    const [opened] = await events(master, url);

    const masterStream = await connect(`${url}/stream?after=${opened?.id}`, master);
    const anaStream = await connect(`${url}/stream?after=${opened?.id}`, ana);
    expect(anaStream.status).toBe(200);

    await master.post(`${url}/notes`, { text: 'Es un espía' });
    await master.post(`${url}/reveals`, { body: 'Llaman a la puerta' });

    expect(await masterStream.next()).toMatchObject({ kind: 'note', gameId: game.id });
    expect(await masterStream.next()).toMatchObject({ kind: 'reveal' });
    // Ana se salta la nota: lo primero que le llega es lo revelado.
    expect(await anaStream.next()).toMatchObject({ kind: 'reveal', body: 'Llaman a la puerta' });
  });

  it('al conectar recupera lo que se perdió, también al reconectar', async () => {
    const { master, ana, campaign } = await table();
    const { url } = await openGame(master, campaign.id);
    const first = (await master.post(`${url}/reveals`, { body: 'Uno' })).json().event;
    await master.post(`${url}/reveals`, { body: 'Dos' });

    const fromStart = await connect(`${url}/stream`, ana);
    expect(await fromStart.next()).toMatchObject({ kind: 'opened' });
    expect(await fromStart.next()).toMatchObject({ body: 'Uno' });
    expect(await fromStart.next()).toMatchObject({ body: 'Dos' });

    // Al reconectar, el navegador manda el último id que recibió.
    const resumed = await connect(`${url}/stream?after=1`, ana, {
      'last-event-id': String(first.id),
    });
    expect(await resumed.next()).toMatchObject({ body: 'Dos' });
    await master.post(`${url}/reveals`, { body: 'Tres' });
    expect(await resumed.next()).toMatchObject({ body: 'Tres' });
  });

  it('al cerrar la partida el directo termina y no vuelve a abrirse', async () => {
    const { master, ana, campaign } = await table();
    const { url } = await openGame(master, campaign.id);
    const stream = await connect(`${url}/stream`, ana);
    expect(await stream.next()).toMatchObject({ kind: 'opened' });

    const closed = (await master.post(`${url}/close`, {})).json().event;
    expect(await stream.next()).toMatchObject({ kind: 'closed' });
    expect(await stream.next()).toBe('end');

    const late = await connect(`${url}/stream?after=0`, ana);
    expect(await late.next()).toMatchObject({ kind: 'opened' });
    expect(await late.next()).toMatchObject({ kind: 'closed' });
    expect(await late.next()).toBe('end');
    const caughtUp = await connect(`${url}/stream?after=${closed.id}`, ana);
    expect(caughtUp.status).toBe(204);
  });

  it('a quien echan de la campaña se le corta el directo', async () => {
    const { master, bruno, campaign } = await table();
    const { url } = await openGame(master, campaign.id);
    const stream = await connect(`${url}/stream`, bruno);
    expect(await stream.next()).toMatchObject({ kind: 'opened' });

    const me = (await bruno.get('/api/auth/me')).json().user;
    await master.delete(`/api/campaigns/${campaign.id}/members/${me.id}`);
    expect(await stream.next()).toBe('end');
    expect((await connect(`${url}/stream`, bruno)).status).toBe(404);
    expect((await connect(`${url}/stream`)).status).toBe(401);
  });
});

describe('pantalla de la mesa', () => {
  it('con el enlace se ve lo público de la última partida, sin iniciar sesión', async () => {
    const { master, ana, campaign, kael } = await table();
    const detail = (await master.get(`/api/campaigns/${campaign.id}`)).json().campaign;
    expect(detail.screenToken).toMatch(/^[0-9a-f]{32}$/);
    expect((await ana.get(`/api/campaigns/${campaign.id}`)).json().campaign.screenToken).toBe(
      undefined,
    );
    const screenUrl = `/api/screens/${detail.screenToken}`;
    const screen = t.anonymous();
    expect((await screen.get(screenUrl)).json()).toEqual({
      campaignName: 'La Marca del Este',
      game: null,
      events: [],
    });

    const { game, url } = await openGame(master, campaign.id, { title: 'La cripta' });
    await master.post(`${url}/reveals`, { body: 'Un mapa' });
    await master.post(`${url}/notes`, { text: 'Secreto' });
    loadDice(1, 1);
    await master.post(`${url}/rolls`, {
      actor: { kind: 'character', characterId: kael.id, skill: 'stealth' },
      target: { kind: 'difficulty', difficulty: 10 },
      secret: true,
    });

    const state = (await screen.get(screenUrl)).json();
    expect(state.game).toMatchObject({ id: game.id, title: 'La cripta', status: 'open' });
    expect(kinds(state.events)).toEqual(['opened', 'reveal']);
    expect((await screen.get('/api/screens/no-existe')).statusCode).toBe(404);
    expect((await screen.get(`/api/screens/${'0'.repeat(32)}`)).statusCode).toBe(404);
  });

  it('sigue en vivo y pasa sola a la partida siguiente', async () => {
    const { master, campaign } = await table();
    const { screenToken } = (await master.get(`/api/campaigns/${campaign.id}`)).json().campaign;
    const stream = await connect(`/api/screens/${screenToken}/stream`);
    expect(stream.status).toBe(200);

    const { url } = await openGame(master, campaign.id);
    expect(await stream.next()).toMatchObject({ kind: 'opened', number: 1 });
    await master.post(`${url}/notes`, { text: 'Secreto' });
    await master.post(`${url}/reveals`, { body: 'Un mapa' });
    expect(await stream.next()).toMatchObject({ kind: 'reveal', body: 'Un mapa' });
    await master.post(`${url}/close`, {});
    expect(await stream.next()).toMatchObject({ kind: 'closed' });

    const { game: next } = await openGame(master, campaign.id);
    expect(await stream.next()).toMatchObject({ kind: 'opened', number: 2, gameId: next.id });
  });

  it('cambiar el enlace corta las pantallas y el viejo deja de valer', async () => {
    const { master, ana, campaign } = await table();
    const { screenToken } = (await master.get(`/api/campaigns/${campaign.id}`)).json().campaign;
    await openGame(master, campaign.id);
    const stream = await connect(`/api/screens/${screenToken}/stream`);
    expect(await stream.next()).toMatchObject({ kind: 'opened' });

    expect((await ana.post(`/api/campaigns/${campaign.id}/screen-token`)).statusCode).toBe(403);
    const changed = await master.post(`/api/campaigns/${campaign.id}/screen-token`);
    expect(changed.statusCode).toBe(200);
    const fresh = changed.json().screenToken;
    expect(fresh).toMatch(/^[0-9a-f]{32}$/);
    expect(fresh).not.toBe(screenToken);

    expect(await stream.next()).toBe('end');
    expect((await t.anonymous().get(`/api/screens/${screenToken}`)).statusCode).toBe(404);
    expect((await t.anonymous().get(`/api/screens/${fresh}`)).statusCode).toBe(200);
  });
});
