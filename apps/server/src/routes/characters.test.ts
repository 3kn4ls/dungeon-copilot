import { kael } from '@dungeon-copilot/rules/testing';
import { describe, expect, it } from 'vitest';
import { useTestApp, type TestClient } from '../testing';

const t = useTestApp();

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
  const created = await ana.post(`/api/campaigns/${campaign.id}/characters`, kael());
  expect(created.statusCode).toBe(201);
  const character = created.json().character;
  return { master, ana, bruno, campaign, character, url: `/api/characters/${character.id}` };
}

const sheet = async (client: TestClient, url: string) => (await client.get(url)).json().character;

describe('crear fichas', () => {
  it('crea la ficha con la Suerte llena y sin heridas', async () => {
    const { character, campaign } = await table();
    expect(character).toMatchObject({
      campaignId: campaign.id,
      ownerName: 'Ana',
      name: 'Kael',
      background: 'Mercenario de la Compañía Libre',
      attributes: { strength: 4, dexterity: 3, charisma: 1, intelligence: 2, endurance: 2 },
      skills: { 'melee-weapons': 2, athletics: 1 },
      advancedSkills: ['brutal-charge'],
      wounds: { scratches: 0, severity: 'none', scratchBoxes: 2 },
      luck: 3,
      xp: 0,
      canEdit: true,
      canAwardXp: false,
    });
  });

  it('aplica las reglas de creación y explica qué falla', async () => {
    const { ana, campaign } = await table();
    const response = await ana.post(
      `/api/campaigns/${campaign.id}/characters`,
      kael({
        attributes: { strength: 4, dexterity: 4, charisma: 1, intelligence: 2, endurance: 2 },
        skills: { 'melee-weapons': 3, 'magia-inventada': 1 },
      }),
    );
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe('La ficha no cumple las reglas de creación');
    expect(body.issues.map((issue: { path: string }) => issue.path)).toEqual([
      'skills.magia-inventada',
      'attributes',
      'skills.melee-weapons',
    ]);
  });

  it('valida la forma de la ficha antes que las reglas', async () => {
    const { ana, campaign } = await table();
    const response = await ana.post(`/api/campaigns/${campaign.id}/characters`, { name: '' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Revisa la ficha');
  });

  it('en una campaña ajena no se pueden crear ni ver fichas', async () => {
    const { campaign, url } = await table();
    const stranger = await t.register('intrusa');
    expect(
      (await stranger.post(`/api/campaigns/${campaign.id}/characters`, kael())).statusCode,
    ).toBe(404);
    expect((await stranger.get(url)).statusCode).toBe(404);
  });
});

describe('ver fichas', () => {
  it('todo el grupo ve las fichas, pero solo su dueña y el máster pueden tocarlas', async () => {
    const { master, bruno, campaign, url } = await table();
    const list = (await bruno.get(`/api/campaigns/${campaign.id}/characters`)).json().characters;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Kael', canEdit: false, canAwardXp: false });
    expect(await sheet(master, url)).toMatchObject({ canEdit: true, canAwardXp: true });
  });
});

describe('cambiar fichas', () => {
  it('la dueña y el máster pueden cambiar nombre, trasfondo y Suerte; otro jugador no', async () => {
    const { master, ana, bruno, url } = await table();

    const renamed = await ana.patch(url, { name: 'Kael el Rojo', luck: 2 });
    expect(renamed.json().character).toMatchObject({ name: 'Kael el Rojo', luck: 2 });

    const byMaster = await master.patch(url, { background: 'Desertor de la Compañía Libre' });
    expect(byMaster.json().character.background).toBe('Desertor de la Compañía Libre');

    const denied = await bruno.patch(url, { name: 'Robado' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({
      error: 'Solo su jugador o el máster pueden cambiar esta ficha',
    });

    expect((await ana.patch(url, { luck: 4 })).statusCode).toBe(400);
    expect((await ana.patch(url, {})).statusCode).toBe(400);
  });

  it('solo la dueña o el máster pueden borrarla', async () => {
    const { master, bruno, url } = await table();
    expect((await bruno.delete(url)).statusCode).toBe(403);
    expect((await master.delete(url)).statusCode).toBe(204);
    expect((await master.get(url)).statusCode).toBe(404);
  });
});

describe('heridas', () => {
  it('llena los rasguños, luego empeora la herida y avisa del golpe mortal', async () => {
    const { ana, url } = await table();
    const hit = async (amount: number) => (await ana.post(`${url}/damage`, { amount })).json();

    expect(await hit(1)).toMatchObject({
      character: { wounds: { scratches: 1, severity: 'none', scratchBoxes: 2 } },
      lethal: false,
    });
    expect(await hit(2)).toMatchObject({
      character: { wounds: { scratches: 2, severity: 'wounded' } },
      lethal: false,
    });
    expect(await hit(3)).toMatchObject({
      character: { wounds: { scratches: 2, severity: 'down' } },
      lethal: true,
    });
  });

  it('dos golpes a la vez no se pisan', async () => {
    const { ana, master, url } = await table();
    await Promise.all([
      ana.post(`${url}/damage`, { amount: 1 }),
      master.post(`${url}/damage`, { amount: 1 }),
    ]);
    expect((await sheet(ana, url)).wounds).toMatchObject({ scratches: 2, severity: 'none' });
  });

  it('se recuperan los rasguños tras la escena y la herida con descanso', async () => {
    const { ana, url } = await table();
    await ana.post(`${url}/damage`, { amount: 4 });
    expect((await sheet(ana, url)).wounds).toMatchObject({ scratches: 2, severity: 'grave' });

    const breath = await ana.post(`${url}/recover`, { kind: 'scratches' });
    expect(breath.json().character.wounds).toMatchObject({ scratches: 0, severity: 'grave' });

    const rest = await ana.post(`${url}/recover`, { kind: 'severity' });
    expect(rest.json().character.wounds).toMatchObject({ scratches: 0, severity: 'wounded' });
  });

  it('rechaza daños sin sentido y a quien no puede tocar la ficha', async () => {
    const { ana, bruno, url } = await table();
    expect((await ana.post(`${url}/damage`, { amount: 0 })).statusCode).toBe(400);
    expect((await ana.post(`${url}/damage`, { amount: 1.5 })).statusCode).toBe(400);
    expect((await bruno.post(`${url}/damage`, { amount: 1 })).statusCode).toBe(403);
  });
});

describe('experiencia y mejoras', () => {
  it('solo el máster reparte PX, y nunca dejan la ficha en negativo', async () => {
    const { master, ana, url } = await table();
    const denied = await ana.post(`${url}/xp`, { amount: 5 });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'Solo el máster reparte experiencia' });

    expect((await master.post(`${url}/xp`, { amount: 5 })).json().character.xp).toBe(5);
    const tooMuch = await master.post(`${url}/xp`, { amount: -6 });
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.json()).toEqual({ error: 'No puede quedarse con PX negativos: tiene 5' });
    expect((await master.post(`${url}/xp`, { amount: -2 })).json().character.xp).toBe(3);
  });

  it('gastar PX sube habilidades y atributos al precio del reglamento', async () => {
    const { master, ana, url } = await table();
    await master.post(`${url}/xp`, { amount: 25 });

    const skill = await ana.post(`${url}/advances`, { kind: 'raiseSkill', skill: 'melee-weapons' });
    expect(skill.json().character).toMatchObject({ skills: { 'melee-weapons': 3 }, xp: 19 });

    const attribute = await ana.post(`${url}/advances`, {
      kind: 'raiseAttribute',
      attribute: 'endurance',
    });
    expect(attribute.json().character).toMatchObject({
      attributes: { endurance: 3 },
      wounds: { scratchBoxes: 3 },
      xp: 10,
    });

    const learned = await ana.post(`${url}/advances`, {
      kind: 'learnAdvanced',
      skill: 'crushing-blow',
    });
    expect(learned.json().character).toMatchObject({
      advancedSkills: ['brutal-charge', 'crushing-blow'],
      xp: 5,
    });
  });

  it('explica por qué no se puede hacer una mejora', async () => {
    const { master, ana, url } = await table();
    await master.post(`${url}/xp`, { amount: 5 });

    const poor = await ana.post(`${url}/advances`, {
      kind: 'raiseAttribute',
      attribute: 'strength',
    });
    expect(poor.statusCode).toBe(400);
    expect(poor.json()).toEqual({ error: 'Esa mejora cuesta 15 PX y tiene 5' });

    const unmet = await ana.post(`${url}/advances`, { kind: 'learnAdvanced', skill: 'iron-grip' });
    expect(unmet.statusCode).toBe(400);
    expect(unmet.json()).toEqual({
      error: 'No se puede hacer esa mejora',
      issues: [{ path: 'advance', message: 'Requiere Pelea rango 2 (tiene 0)' }],
    });

    const unknown = await ana.post(`${url}/advances`, {
      kind: 'raiseAttribute',
      attribute: 'luck',
    });
    expect(unknown.statusCode).toBe(400);
    expect((await sheet(ana, url)).xp).toBe(5);
  });
});
