import { INVITE_CODE_ALPHABET } from '@dungeon-copilot/shared';
import { kael } from '@dungeon-copilot/rules/testing';
import { describe, expect, it } from 'vitest';
import { useTestApp, type TestClient } from '../testing';
import { generateInviteCode } from './campaigns';

const t = useTestApp();

async function createCampaign(master: TestClient, name = 'La Marca del Este') {
  const response = await master.post('/api/campaigns', { name, description: 'Frontera y ruinas' });
  expect(response.statusCode).toBe(201);
  return response.json().campaign as { id: string; inviteCode: string };
}

/** Un máster con su campaña y un jugador ya unido. */
async function partyOfTwo() {
  const master = await t.register('edu', 'Edu');
  const player = await t.register('ana', 'Ana');
  const campaign = await createCampaign(master);
  expect(
    (await player.post('/api/campaigns/join', { inviteCode: campaign.inviteCode })).statusCode,
  ).toBe(200);
  return { master, player, campaign };
}

describe('códigos de invitación', () => {
  it('tienen 6 caracteres de un alfabeto sin letras ambiguas', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      expect(code).toHaveLength(6);
      expect([...code].every((char) => INVITE_CODE_ALPHABET.includes(char))).toBe(true);
    }
  });
});

describe('crear y listar campañas', () => {
  it('quien crea la campaña es su máster y ve el código de invitación', async () => {
    const master = await t.register('edu', 'Edu');
    const campaign = await createCampaign(master);
    expect(campaign).toMatchObject({
      name: 'La Marca del Este',
      description: 'Frontera y ruinas',
      role: 'master',
      inviteCode: expect.stringMatching(/^[A-Z2-9]{6}$/),
      members: [{ username: 'edu', displayName: 'Edu', role: 'master' }],
    });

    const list = (await master.get('/api/campaigns')).json();
    expect(list.campaigns).toEqual([
      expect.objectContaining({
        id: campaign.id,
        role: 'master',
        memberCount: 1,
        characterCount: 0,
      }),
    ]);
  });

  it('pide un nombre', async () => {
    const master = await t.register('edu');
    const response = await master.post('/api/campaigns', { name: '   ' });
    expect(response.statusCode).toBe(400);
    expect(response.json().issues).toEqual([
      { path: 'name', message: 'La campaña necesita un nombre' },
    ]);
  });

  it('cada cual solo ve sus campañas', async () => {
    const edu = await t.register('edu');
    const ana = await t.register('ana');
    await createCampaign(edu, 'De Edu');
    await createCampaign(ana, 'De Ana');
    const names = (await ana.get('/api/campaigns'))
      .json()
      .campaigns.map((c: { name: string }) => c.name);
    expect(names).toEqual(['De Ana']);
  });
});

describe('unirse con el código', () => {
  it('convierte en jugador a quien trae el código, aunque lo escriba en minúsculas', async () => {
    const master = await t.register('edu');
    const player = await t.register('ana', 'Ana');
    const campaign = await createCampaign(master);

    const response = await player.post('/api/campaigns/join', {
      inviteCode: ` ${campaign.inviteCode.toLowerCase()} `,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().campaign).toMatchObject({
      id: campaign.id,
      role: 'player',
      memberCount: 2,
    });

    const detail = (await player.get(`/api/campaigns/${campaign.id}`)).json().campaign;
    expect(detail.role).toBe('player');
    expect(detail.inviteCode).toBeUndefined();
    expect(
      detail.members.map((m: { username: string; role: string }) => [m.username, m.role]),
    ).toEqual([
      ['edu', 'master'],
      ['ana', 'player'],
    ]);
  });

  it('unirse dos veces no cambia nada, ni siquiera al máster', async () => {
    const { master, player, campaign } = await partyOfTwo();
    await player.post('/api/campaigns/join', { inviteCode: campaign.inviteCode });
    const again = await master.post('/api/campaigns/join', { inviteCode: campaign.inviteCode });
    expect(again.json().campaign).toMatchObject({ role: 'master', memberCount: 2 });
  });

  it('avisa si el código no existe', async () => {
    const player = await t.register('ana');
    const response = await player.post('/api/campaigns/join', { inviteCode: 'ZZZZZZ' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'No hay ninguna campaña con ese código' });
  });

  it('al regenerar el código, el viejo deja de funcionar', async () => {
    const master = await t.register('edu');
    const player = await t.register('ana');
    const campaign = await createCampaign(master);

    const response = await master.post(`/api/campaigns/${campaign.id}/invite-code`);
    const { inviteCode } = response.json();
    expect(inviteCode).not.toBe(campaign.inviteCode);

    expect(
      (await player.post('/api/campaigns/join', { inviteCode: campaign.inviteCode })).statusCode,
    ).toBe(404);
    expect((await player.post('/api/campaigns/join', { inviteCode })).statusCode).toBe(200);
  });
});

describe('permisos', () => {
  it('a quien no es miembro, la campaña le parece inexistente', async () => {
    const { campaign } = await partyOfTwo();
    const stranger = await t.register('intrusa');
    for (const response of [
      await stranger.get(`/api/campaigns/${campaign.id}`),
      await stranger.get(`/api/campaigns/${campaign.id}/characters`),
      await stranger.patch(`/api/campaigns/${campaign.id}`, { name: 'Mía' }),
      await stranger.get('/api/campaigns/no-es-un-id'),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'Esa campaña no existe o no eres miembro' });
    }
  });

  it('solo el máster cambia, regenera el código o borra la campaña', async () => {
    const { master, player, campaign } = await partyOfTwo();
    const url = `/api/campaigns/${campaign.id}`;
    for (const response of [
      await player.patch(url, { name: 'Mía' }),
      await player.post(`${url}/invite-code`),
      await player.delete(url),
    ]) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'Solo el máster de la campaña puede hacer eso' });
    }

    const renamed = await master.patch(url, { description: 'Ahora en el desierto' });
    expect(renamed.json().campaign).toMatchObject({
      name: 'La Marca del Este',
      description: 'Ahora en el desierto',
    });
    expect((await master.patch(url, {})).statusCode).toBe(400);
  });

  it('al borrar la campaña se borran sus personajes', async () => {
    const { master, player, campaign } = await partyOfTwo();
    const created = await player.post(`/api/campaigns/${campaign.id}/characters`, kael());
    const characterId = created.json().character.id;

    expect((await master.delete(`/api/campaigns/${campaign.id}`)).statusCode).toBe(204);
    expect((await master.get('/api/campaigns')).json().campaigns).toEqual([]);
    expect((await player.get(`/api/characters/${characterId}`)).statusCode).toBe(404);
  });
});

describe('miembros', () => {
  it('un jugador puede irse y sus personajes se quedan para el máster', async () => {
    const { master, player, campaign } = await partyOfTwo();
    await player.post(`/api/campaigns/${campaign.id}/characters`, kael());
    const ana = (await master.get(`/api/campaigns/${campaign.id}`)).json().campaign.members[1];

    const response = await player.delete(`/api/campaigns/${campaign.id}/members/${ana.userId}`);
    expect(response.statusCode).toBe(204);
    expect((await player.get(`/api/campaigns/${campaign.id}`)).statusCode).toBe(404);

    const characters = (await master.get(`/api/campaigns/${campaign.id}/characters`)).json()
      .characters;
    expect(characters.map((c: { ownerName: string }) => c.ownerName)).toEqual(['Ana']);
  });

  it('el máster puede echar a un jugador, pero no irse', async () => {
    const { master, player, campaign } = await partyOfTwo();
    const [edu, ana] = (await master.get(`/api/campaigns/${campaign.id}`)).json().campaign.members;

    const leave = await master.delete(`/api/campaigns/${campaign.id}/members/${edu.userId}`);
    expect(leave.statusCode).toBe(409);

    const kick = await player.delete(`/api/campaigns/${campaign.id}/members/${edu.userId}`);
    expect(kick.statusCode).toBe(403);

    expect(
      (await master.delete(`/api/campaigns/${campaign.id}/members/${ana.userId}`)).statusCode,
    ).toBe(204);
    expect(
      (await master.delete(`/api/campaigns/${campaign.id}/members/${ana.userId}`)).statusCode,
    ).toBe(404);
  });
});
