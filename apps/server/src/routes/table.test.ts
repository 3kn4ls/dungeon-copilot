import type { Random } from '@dungeon-copilot/rules';
import { fixedDice, kael } from '@dungeon-copilot/rules/testing';
import type { GameEvent } from '@dungeon-copilot/shared';
import { describe, expect, it } from 'vitest';
import { useLiveStreams, useTestApp, type TestClient } from '../testing';

let dice: Random = () => {
  throw new Error('Esta prueba no esperaba ninguna tirada');
};
const t = useTestApp({ random: () => dice() });
const connect = useLiveStreams(t);
const loadDice = (...faces: number[]) => {
  dice = fixedDice(...faces);
};

/** Edu dirige; Ana juega con Kael y Bruno con Mira. La partida ya está en juego. */
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
  const kaelSheet = await create(ana, 'Kael');
  const mira = await create(bruno, 'Mira');
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
const kinds = (list: GameEvent[]) => list.map((event) => event.kind);

/** Lo que responde el servidor a una acción que crea un evento. */
async function created(response: Promise<{ statusCode: number; json(): { event: GameEvent } }>) {
  const done = await response;
  expect(done.statusCode).toBe(201);
  return done.json().event;
}

describe('la palabra', () => {
  it('el máster la da a la mesa o a un personaje y la retoma, y lo ve toda la mesa', async () => {
    const { master, bruno, kael, url } = await table();
    expect(await created(master.post(`${url}/floor`, { to: { kind: 'table' } }))).toMatchObject({
      kind: 'floor',
      floor: { kind: 'table' },
      visibility: 'public',
      authorName: 'Edu',
    });
    const toKael = await created(
      master.post(`${url}/floor`, { to: { kind: 'character', characterId: kael.id } }),
    );
    expect(toKael.kind === 'floor' && toKael.floor).toEqual({
      kind: 'character',
      characterId: kael.id,
      name: 'Kael',
    });
    await created(master.post(`${url}/floor`, { to: { kind: 'master' } }));
    expect(kinds(await events(bruno, url))).toEqual(['opened', 'floor', 'floor', 'floor']);
  });

  it('solo la da el máster, y solo a los personajes de la campaña', async () => {
    const { master, ana, url } = await table();
    const player = await ana.post(`${url}/floor`, { to: { kind: 'table' } });
    expect(player.statusCode).toBe(403);
    expect(player.json().error).toBe('Solo el máster de la campaña puede hacer eso');

    const other = (await ana.post('/api/campaigns', { name: 'Otra' })).json().campaign;
    const stranger = (await ana.post(`/api/campaigns/${other.id}/characters`, kael())).json()
      .character;
    const elsewhere = await master.post(`${url}/floor`, {
      to: { kind: 'character', characterId: stranger.id },
    });
    expect(elsewhere.statusCode).toBe(404);
    expect(elsewhere.json().error).toBe('Ese personaje no está en esta campaña');
    const nobody = await master.post(`${url}/floor`, { to: { kind: 'character' } });
    expect(nobody.statusCode).toBe(400);
    expect(nobody.json().issues).toEqual([
      { path: 'to.characterId', message: 'Elige un personaje' },
    ]);
  });
});

describe('intervenciones', () => {
  it('un jugador pide la palabra con su personaje y el máster se la da', async () => {
    const { master, ana, bruno, kael, url } = await table();
    const asked = await created(
      ana.post(`${url}/interventions`, {
        characterId: kael.id,
        intent: 'speak',
        text: '¿Quién es el encapuchado?',
      }),
    );
    expect(asked).toMatchObject({
      kind: 'intervention',
      characterId: kael.id,
      name: 'Kael',
      intent: 'speak',
      text: '¿Quién es el encapuchado?',
      visibility: 'public',
      authorName: 'Ana',
    });
    expect(kinds(await events(bruno, url))).toEqual(['opened', 'intervention']);

    const floor = await created(
      master.post(`${url}/floor`, {
        to: { kind: 'character', characterId: kael.id },
        answers: asked.id,
      }),
    );
    expect(floor).toMatchObject({ kind: 'floor', answers: asked.id });
    const again = await master.post(`${url}/floor`, { to: { kind: 'table' }, answers: asked.id });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('El máster ya ha atendido esa intervención');
  });

  it('cada personaje espera con una sola intervención, y su jugador puede retirarla', async () => {
    const { ana, bruno, kael, url } = await table();
    const first = await created(
      ana.post(`${url}/interventions`, { characterId: kael.id, intent: 'act' }),
    );
    expect(first).toMatchObject({ intent: 'act', text: '' });
    const second = await ana.post(`${url}/interventions`, {
      characterId: kael.id,
      intent: 'speak',
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe(
      'Kael ya está esperando al máster: retira su intervención si quieres cambiarla',
    );

    const notYours = await bruno.post(`${url}/interventions/${first.id}/withdraw`);
    expect(notYours.statusCode).toBe(403);
    expect(notYours.json().error).toBe('Solo puedes retirar lo que has pedido tú');
    expect(await created(ana.post(`${url}/interventions/${first.id}/withdraw`))).toMatchObject({
      kind: 'settled',
      of: first.id,
      how: 'withdrawn',
      visibility: 'public',
    });
    const twice = await ana.post(`${url}/interventions/${first.id}/withdraw`);
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error).toBe('Esa intervención ya se ha retirado');
    await created(ana.post(`${url}/interventions`, { characterId: kael.id, intent: 'speak' }));
  });

  it('solo se interviene con los personajes propios', async () => {
    const { master, ana, bruno, kael, url } = await table();
    const body = { characterId: kael.id, intent: 'speak' };
    for (const client of [bruno, master]) {
      const response = await client.post(`${url}/interventions`, body);
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe('Solo puedes intervenir con tus personajes');
    }
    const wrong = await ana.post(`${url}/interventions`, { ...body, intent: 'bailar' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().issues).toEqual([{ path: 'intent', message: 'Elige qué quieres hacer' }]);
    const stranger = await t.register('intrusa');
    expect((await stranger.post(`${url}/interventions`, body)).statusCode).toBe(404);
    expect(kinds(await events(master, url))).toEqual(['opened']);
  });

  it('el máster la atiende sin más o le dice que ahora no', async () => {
    const { master, ana, kael, url } = await table();
    const asked = await created(
      ana.post(`${url}/interventions`, {
        characterId: kael.id,
        intent: 'ask',
        text: '¿Hay ventanas?',
      }),
    );
    const player = await ana.post(`${url}/interventions/${asked.id}/answer`, {});
    expect(player.statusCode).toBe(403);
    expect(await created(master.post(`${url}/interventions/${asked.id}/answer`, {}))).toMatchObject(
      { kind: 'settled', of: asked.id, how: 'answered' },
    );

    const later = await created(
      ana.post(`${url}/interventions`, { characterId: kael.id, intent: 'attack' }),
    );
    await created(master.post(`${url}/interventions/${later.id}/answer`, { how: 'dismissed' }));
    const twice = await master.post(`${url}/interventions/${later.id}/answer`, {});
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error).toBe('El máster ya ha dicho que ahora no a esa intervención');
    const withdrawn = await ana.post(`${url}/interventions/${later.id}/withdraw`);
    expect(withdrawn.statusCode).toBe(409);

    const [opened] = await events(master, url);
    for (const id of [opened?.id, 999999, 'abc']) {
      const response = await master.post(`${url}/interventions/${id}/answer`, {});
      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe('Esa intervención no existe en esta partida');
    }
  });

  it('una descripción o una frase de un PNJ pueden responder a una intervención', async () => {
    const { master, ana, campaign, kael, url } = await table();
    const npc = (
      await master.post(`/api/campaigns/${campaign.id}/npcs`, { name: 'Brunilda' })
    ).json().npc;
    const asked = await created(
      ana.post(`${url}/interventions`, { characterId: kael.id, intent: 'speak', text: 'Hola' }),
    );
    const speech = await created(
      master.post(`${url}/speeches`, { npcId: npc.id, text: '¿Qué os pongo?', answers: asked.id }),
    );
    expect(speech).toMatchObject({ kind: 'speech', answers: asked.id, visibility: 'public' });
    const late = await master.post(`${url}/reveals`, { body: 'Humo', answers: asked.id });
    expect(late.statusCode).toBe(409);

    const question = await created(
      ana.post(`${url}/interventions`, { characterId: kael.id, intent: 'ask' }),
    );
    expect(
      await created(master.post(`${url}/reveals`, { body: 'No hay', answers: question.id })),
    ).toMatchObject({ kind: 'reveal', answers: question.id });
    const noIntervention = await master.post(`${url}/reveals`, { body: 'Humo', answers: npc.id });
    expect(noIntervention.statusCode).toBe(400);
  });

  it('en una partida terminada ya no se interviene ni se da la palabra', async () => {
    const { master, ana, kael, url } = await table();
    await master.post(`${url}/close`, {});
    for (const response of [
      await master.post(`${url}/floor`, { to: { kind: 'table' } }),
      await ana.post(`${url}/interventions`, { characterId: kael.id, intent: 'speak' }),
      await master.post(`${url}/roll-requests`, {
        roll: {
          actor: { kind: 'character', characterId: kael.id, skill: 'athletics' },
          target: { kind: 'difficulty', difficulty: 10 },
        },
      }),
    ]) {
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe('La partida ya ha terminado');
    }
  });
});

describe('en secreto', () => {
  it('una intervención en secreto solo la ven el máster y quien la escribe', async () => {
    const { master, ana, bruno, mira, url, screenUrl } = await table();
    const note = await created(
      bruno.post(`${url}/interventions`, {
        characterId: mira.id,
        intent: 'act',
        text: 'Le robo la bolsa a Kael',
        secret: true,
      }),
    );
    expect(note).toMatchObject({ kind: 'intervention', visibility: 'private' });
    expect(kinds(await events(master, url))).toEqual(['opened', 'intervention']);
    expect(kinds(await events(bruno, url))).toEqual(['opened', 'intervention']);
    expect(kinds(await events(ana, url))).toEqual(['opened']);
    expect(kinds((await t.anonymous().get(screenUrl)).json().events)).toEqual(['opened']);

    // Para Ana no existe.
    const withdraw = await ana.post(`${url}/interventions/${note.id}/withdraw`);
    expect(withdraw.statusCode).toBe(404);
    // Atenderla también es en secreto.
    const answer = await created(master.post(`${url}/interventions/${note.id}/answer`, {}));
    expect(answer.visibility).toBe('private');
    expect(kinds(await events(bruno, url))).toEqual(['opened', 'intervention', 'settled']);
    expect(kinds(await events(ana, url))).toEqual(['opened']);
  });

  it('el máster responde en secreto con una descripción o una frase para un personaje', async () => {
    const { master, ana, bruno, campaign, mira, url, screenUrl } = await table();
    const npc = (
      await master.post(`/api/campaigns/${campaign.id}/npcs`, { name: 'Brunilda' })
    ).json().npc;
    const reveal = await created(
      master.post(`${url}/reveals`, { body: 'Notas que el bardo te sigue', to: mira.id }),
    );
    expect(reveal).toMatchObject({
      kind: 'reveal',
      visibility: 'private',
      to: { characterId: mira.id, name: 'Mira' },
    });
    const whisper = await created(
      master.post(`${url}/speeches`, { npcId: npc.id, text: 'Ven mañana', to: mira.id }),
    );
    expect(whisper).toMatchObject({ kind: 'speech', visibility: 'private' });

    expect(kinds(await events(bruno, url))).toEqual(['opened', 'reveal', 'speech']);
    expect(kinds(await events(ana, url))).toEqual(['opened']);
    expect(kinds((await t.anonymous().get(screenUrl)).json().events)).toEqual(['opened']);

    const other = (await ana.post('/api/campaigns', { name: 'Otra' })).json().campaign;
    const stranger = (await ana.post(`/api/campaigns/${other.id}/characters`, kael())).json()
      .character;
    const elsewhere = await master.post(`${url}/reveals`, { body: 'Hola', to: stranger.id });
    expect(elsewhere.statusCode).toBe(404);
  });

  it('en directo, lo secreto solo llega al máster y a su jugador', async () => {
    const { master, ana, bruno, mira, url, screenUrl } = await table();
    const [opened] = await events(master, url);
    const after = `?after=${opened?.id}`;
    const masterStream = await connect(`${url}/stream${after}`, master);
    const anaStream = await connect(`${url}/stream${after}`, ana);
    const brunoStream = await connect(`${url}/stream${after}`, bruno);
    const screenStream = await connect(`${screenUrl}/stream${after}`);

    await bruno.post(`${url}/interventions`, {
      characterId: mira.id,
      intent: 'act',
      text: 'Le robo la bolsa a Kael',
      secret: true,
    });
    await master.post(`${url}/reveals`, { body: 'Entra la guardia' });

    for (const stream of [masterStream, brunoStream]) {
      expect(await stream.next()).toMatchObject({ kind: 'intervention', visibility: 'private' });
      expect(await stream.next()).toMatchObject({ kind: 'reveal' });
    }
    for (const stream of [anaStream, screenStream]) {
      expect(await stream.next()).toMatchObject({ kind: 'reveal', body: 'Entra la guardia' });
    }
  });
});

describe('tiradas pedidas', () => {
  const athletics = (characterId: string, difficulty = 12) => ({
    actor: { kind: 'character', characterId, skill: 'athletics' },
    target: { kind: 'difficulty', difficulty },
  });

  it('el máster pide una tirada y el jugador la hace con la ficha de ese momento', async () => {
    const { master, ana, bruno, kael, url } = await table();
    const asked = await created(master.post(`${url}/roll-requests`, { roll: athletics(kael.id) }));
    expect(asked).toMatchObject({
      kind: 'rollRequest',
      characterId: kael.id,
      name: 'Kael',
      visibility: 'public',
      preview: {
        actor: { label: 'Kael', characterId: kael.id, check: 'Atletismo' },
        target: { kind: 'difficulty', label: 'Difícil (12)' },
        situation: 'test',
      },
    });
    expect(kinds(await events(bruno, url))).toEqual(['opened', 'rollRequest']);

    // Entre medias le hieren: tira con desventaja.
    await master.post(`/api/characters/${kael.id}/damage`, { amount: 4 });
    const other = await bruno.post(`${url}/roll-requests/${asked.id}/roll`);
    expect(other.statusCode).toBe(403);
    expect(other.json().error).toBe('Esa tirada se la han pedido a otro personaje');

    loadDice(6, 5, 1);
    const rolled = await created(ana.post(`${url}/roll-requests/${asked.id}/roll`));
    expect(rolled).toMatchObject({ kind: 'roll', visibility: 'public', authorName: 'Ana' });
    expect(rolled.kind === 'roll' && rolled.roll).toMatchObject({
      requested: asked.id,
      notes: ['Kael tira con desventaja por su herida grave'],
      result: { roller: { bonus: 5, dice: { kept: [1, 5], edge: 'disadvantage' } } },
    });
    const again = await ana.post(`${url}/roll-requests/${asked.id}/roll`);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('Esa tirada ya está hecha');
  });

  it('en una defensa tira el personaje que se opone, y el máster puede tirar por él', async () => {
    const { master, kael, url } = await table();
    const asked = await created(
      master.post(`${url}/roll-requests`, {
        roll: {
          actor: { kind: 'free', label: 'Orco', bonus: 4 },
          target: {
            kind: 'opposed',
            opponent: { kind: 'character', characterId: kael.id, skill: 'acrobatics' },
          },
          situation: 'melee',
        },
      }),
    );
    expect(asked).toMatchObject({
      characterId: kael.id,
      preview: {
        actor: { label: 'Orco' },
        target: { kind: 'opposed', label: 'Kael', check: 'Acrobacias' },
        situation: 'melee',
      },
    });
    loadDice(3, 3, 5, 6);
    const rolled = await created(master.post(`${url}/roll-requests/${asked.id}/roll`));
    expect(rolled).toMatchObject({ authorName: 'Edu' });
    expect(rolled.kind === 'roll' && rolled.roll).toMatchObject({
      requested: asked.id,
      // Destreza 3, sin rango en Acrobacias: 11 + 3 = 14 contra 6 + 4 = 10.
      result: { kind: 'opposed', outcome: 'failure', opponent: { total: 14 } },
    });
  });

  it('la hace un personaje, la pide el máster y la puede retirar', async () => {
    const { master, ana, kael, url } = await table();
    const nobody = await master.post(`${url}/roll-requests`, {
      roll: {
        actor: { kind: 'free', label: 'Orco', bonus: 4 },
        target: { kind: 'difficulty', difficulty: 10 },
      },
    });
    expect(nobody.statusCode).toBe(400);
    expect(nobody.json().error).toBe(
      'Una tirada pedida la hace un personaje: elige uno que tire o que se oponga',
    );
    const invented = await master.post(`${url}/roll-requests`, {
      roll: {
        ...athletics(kael.id),
        actor: { kind: 'character', characterId: kael.id, skill: 'magia' },
      },
    });
    expect(invented.statusCode).toBe(400);
    expect(invented.json().error).toBe('Esa habilidad no existe');
    expect((await ana.post(`${url}/roll-requests`, { roll: athletics(kael.id) })).statusCode).toBe(
      403,
    );

    const asked = await created(master.post(`${url}/roll-requests`, { roll: athletics(kael.id) }));
    expect((await ana.post(`${url}/roll-requests/${asked.id}/withdraw`)).statusCode).toBe(403);
    expect(await created(master.post(`${url}/roll-requests/${asked.id}/withdraw`))).toMatchObject({
      kind: 'settled',
      of: asked.id,
      how: 'withdrawn',
    });
    const late = await ana.post(`${url}/roll-requests/${asked.id}/roll`);
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toBe('El máster ha retirado esa tirada');
    expect((await master.post(`${url}/roll-requests/${asked.id}/withdraw`)).statusCode).toBe(409);
  });

  it('pedir una tirada puede atender una intervención', async () => {
    const { master, ana, kael, url } = await table();
    const asked = await created(
      ana.post(`${url}/interventions`, { characterId: kael.id, intent: 'act', text: 'Trepo' }),
    );
    const request = await created(
      master.post(`${url}/roll-requests`, { roll: athletics(kael.id), answers: asked.id }),
    );
    expect(request).toMatchObject({ kind: 'rollRequest', answers: asked.id });
    // Ya no espera: puede volver a intervenir.
    await created(ana.post(`${url}/interventions`, { characterId: kael.id, intent: 'speak' }));
  });

  it('en secreto, la petición y la tirada solo las ven el máster y su jugador', async () => {
    const { master, ana, bruno, kael, url, screenUrl } = await table();
    const asked = await created(
      master.post(`${url}/roll-requests`, { roll: athletics(kael.id, 10), secret: true }),
    );
    expect(asked.visibility).toBe('private');
    loadDice(1, 2);
    const rolled = await created(ana.post(`${url}/roll-requests/${asked.id}/roll`));
    expect(rolled).toMatchObject({ visibility: 'private' });
    expect(kinds(await events(ana, url))).toEqual(['opened', 'rollRequest', 'roll']);
    expect(kinds(await events(bruno, url))).toEqual(['opened']);
    expect(kinds((await t.anonymous().get(screenUrl)).json().events)).toEqual(['opened']);
    expect((await bruno.post(`${url}/roll-requests/${asked.id}/roll`)).statusCode).toBe(404);

    // Ana la ve, así que puede repetirla con Suerte, y la repetición sigue siendo en secreto.
    expect((await bruno.post(`${url}/rolls/${rolled.id}/reroll`, {})).statusCode).toBe(404);
    loadDice(6, 6);
    const again = await created(ana.post(`${url}/rolls/${rolled.id}/reroll`, {}));
    expect(again).toMatchObject({ kind: 'roll', visibility: 'private' });
    expect(kinds(await events(bruno, url))).toEqual(['opened']);
    expect((await ana.get(`/api/characters/${kael.id}`)).json().character.luck).toBe(2);
  });
});
