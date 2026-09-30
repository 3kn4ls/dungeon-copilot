import { resolveOpposed, resolveTest } from '@dungeon-copilot/rules';
import { fixedDice } from '@dungeon-copilot/rules/testing';
import { describe, expect, it } from 'vitest';
import { currentFloor } from './combat';
import {
  askRollSchema,
  characterSides,
  giveFloorSchema,
  interventionSchema,
  pendingInterventions,
  pendingRollRequests,
  rerollSchema,
  rerollableSides,
  rerollerLabel,
  revealSchema,
  settledEvents,
  supersededRolls,
  type GameEvent,
  type GameEventPayload,
  type GameRoll,
} from './games';

/** Un guardia ataca y Kael se defiende. */
const guardAttack: GameRoll = {
  actor: { label: 'Guardia veterano' },
  target: { kind: 'opposed', label: 'Kael', characterId: 'kael', check: 'Acrobacias' },
  situation: 'melee',
  notes: [],
  result: {
    kind: 'opposed',
    ...resolveOpposed({ bonus: 4 }, { bonus: 3 }, fixedDice(5, 5, 2, 3)),
  },
};

/** Kael contra Mira: los dos son personajes de la mesa. */
const duel: GameRoll = {
  ...guardAttack,
  actor: { label: 'Mira', characterId: 'mira', check: 'Esgrima' },
};

const event = (id: number, payload: GameEventPayload): GameEvent => ({
  ...payload,
  id,
  gameId: 'partida',
  visibility: 'public',
  authorName: 'Ana',
  createdAt: '2026-09-27T20:00:00.000Z',
});

const rollEvent = (id: number, roll: GameRoll): GameEvent => event(id, { kind: 'roll', roll });

describe('repetir tiradas con Suerte', () => {
  it('se repiten los dados de quien tira si no se dice otra cosa', () => {
    expect(rerollSchema.parse({})).toEqual({ side: 'actor' });
    expect(rerollSchema.parse({ side: 'opponent' })).toEqual({ side: 'opponent' });
    expect(rerollSchema.safeParse({ side: 'rival' }).success).toBe(false);
  });

  it('solo tienen Suerte los bandos por los que tira un personaje', () => {
    expect(characterSides(guardAttack)).toEqual([
      { side: 'opponent', characterId: 'kael', label: 'Kael' },
    ]);
    const test: GameRoll = {
      ...guardAttack,
      actor: { label: 'Kael', characterId: 'kael' },
      target: { kind: 'difficulty', label: 'Normal (10)' },
      result: { kind: 'test', ...resolveTest({ bonus: 3 }, 10, fixedDice(2, 3)) },
    };
    expect(characterSides(test)).toEqual([{ side: 'actor', characterId: 'kael', label: 'Kael' }]);
  });

  it('cada personaje repite una vez, y la repetición dice quién la hizo', () => {
    expect(rerollableSides(duel).map((side) => side.label)).toEqual(['Mira', 'Kael']);
    expect(rerollerLabel(duel)).toBeUndefined();

    const miraAgain: GameRoll = { ...duel, reroll: { of: 4, side: 'actor', sides: ['actor'] } };
    expect(rerollableSides(miraAgain).map((side) => side.label)).toEqual(['Kael']);
    expect(rerollerLabel(miraAgain)).toBe('Mira');

    const kaelToo: GameRoll = {
      ...duel,
      reroll: { of: 5, side: 'opponent', sides: ['actor', 'opponent'] },
    };
    expect(rerollableSides(kaelToo)).toEqual([]);
    expect(rerollerLabel(kaelToo)).toBe('Kael');
  });

  it('una tirada repetida deja de contar', () => {
    const events = [
      rollEvent(4, duel),
      rollEvent(5, { ...duel, reroll: { of: 4, side: 'actor', sides: ['actor'] } }),
      rollEvent(6, { ...duel, reroll: { of: 5, side: 'opponent', sides: ['actor', 'opponent'] } }),
      rollEvent(7, guardAttack),
    ];
    expect([...supersededRolls(events)]).toEqual([4, 5]);
  });
});

const KAEL = '8b9f2a4e-1c2d-4e5f-9a8b-7c6d5e4f3a2b';

describe('la palabra y las intervenciones', () => {
  it('una intervención puede ir sin texto y no es secreta si no se dice', () => {
    expect(interventionSchema.parse({ characterId: KAEL, intent: 'speak' })).toEqual({
      characterId: KAEL,
      intent: 'speak',
      text: '',
      secret: false,
    });
    const wrong = interventionSchema.safeParse({ characterId: KAEL, intent: 'bailar' });
    expect(wrong.error?.issues.map((issue) => issue.message)).toEqual(['Elige qué quieres hacer']);
    const long = interventionSchema.safeParse({
      characterId: KAEL,
      intent: 'act',
      text: 'a'.repeat(1001),
    });
    expect(long.error?.issues.map((issue) => issue.message)).toEqual([
      'No puede pasar de 1000 caracteres',
    ]);
  });

  it('en combate, una intervención puede ir contra alguien que pelea', () => {
    expect(
      interventionSchema.parse({ characterId: KAEL, intent: 'melee', targetId: KAEL }),
    ).toMatchObject({ intent: 'melee', targetId: KAEL });
    const nobody = interventionSchema.safeParse({
      characterId: KAEL,
      intent: 'ranged',
      targetId: 'bandidos',
    });
    expect(nobody.error?.issues.map((issue) => issue.message)).toEqual(['Elige contra quién']);
  });

  it('la palabra se da al máster, a la mesa o a un personaje', () => {
    expect(giveFloorSchema.parse({ to: { kind: 'table' } })).toEqual({ to: { kind: 'table' } });
    expect(
      giveFloorSchema.parse({ to: { kind: 'character', characterId: KAEL }, answers: 4 }),
    ).toEqual({ to: { kind: 'character', characterId: KAEL }, answers: 4 });
    const nobody = giveFloorSchema.safeParse({ to: { kind: 'character' } });
    expect(nobody.error?.issues.map((issue) => issue.message)).toEqual(['Elige un personaje']);
    expect(giveFloorSchema.safeParse({ to: { kind: 'table' }, answers: 0 }).success).toBe(false);
  });

  it('una descripción puede ir en secreto para un personaje', () => {
    expect(revealSchema.parse({ body: 'Ves un tatuaje', to: KAEL })).toEqual({
      title: '',
      body: 'Ves un tatuaje',
      to: KAEL,
    });
    expect(revealSchema.safeParse({ body: 'Ves un tatuaje', to: 'Kael' }).success).toBe(false);
  });

  it('una tirada pedida es secreta o no para los dos, no solo para el máster', () => {
    const asked = askRollSchema.parse({
      roll: {
        actor: { kind: 'character', characterId: KAEL, skill: 'athletics' },
        target: { kind: 'difficulty', difficulty: 12 },
        secret: true,
      },
    });
    expect(asked).toEqual({
      roll: {
        actor: {
          kind: 'character',
          characterId: KAEL,
          skill: 'athletics',
          modifier: 0,
          edge: 'none',
        },
        target: { kind: 'difficulty', difficulty: 12 },
        situation: 'test',
      },
      secret: false,
    });
  });

  it('la palabra la tiene el máster hasta que la da, y cuenta la última vez', () => {
    expect(
      currentFloor([event(1, { kind: 'opened', number: 1, title: '', luckRefilled: true })]),
    ).toEqual({ kind: 'master' });
    const events = [
      event(1, { kind: 'floor', floor: { kind: 'table' } }),
      event(2, { kind: 'reveal', title: '', body: 'Entra un encapuchado' }),
      event(3, { kind: 'floor', floor: { kind: 'character', characterId: KAEL, name: 'Kael' } }),
    ];
    expect(currentFloor(events)).toEqual({ kind: 'character', characterId: KAEL, name: 'Kael' });
  });

  it('una intervención espera hasta que el máster la atiende o su jugador la retira', () => {
    const intervention = (id: number, text: string) =>
      event(id, { kind: 'intervention', characterId: KAEL, name: 'Kael', intent: 'speak', text });
    const events = [
      intervention(1, 'Uno'),
      intervention(2, 'Dos'),
      intervention(3, 'Tres'),
      intervention(4, 'Cuatro'),
      intervention(5, 'Cinco'),
      event(6, { kind: 'floor', floor: { kind: 'table' }, answers: 1 }),
      event(7, { kind: 'settled', of: 2, how: 'dismissed' }),
      event(8, { kind: 'settled', of: 3, how: 'withdrawn' }),
      event(9, { kind: 'speech', npcId: 'brunilda', name: 'Brunilda', text: 'No', answers: 4 }),
    ];
    expect(pendingInterventions(events).map((pending) => pending.id)).toEqual([5]);
    expect([...settledEvents(events)]).toEqual([
      [1, 'answered'],
      [2, 'dismissed'],
      [3, 'withdrawn'],
      [4, 'answered'],
    ]);
  });

  it('una tirada pedida espera hasta que se tira o el máster la retira', () => {
    const asked = (id: number) =>
      event(id, {
        kind: 'rollRequest',
        characterId: KAEL,
        name: 'Kael',
        request: {
          actor: { kind: 'character', characterId: KAEL, modifier: 0, edge: 'none' },
          target: { kind: 'difficulty', difficulty: 10 },
          situation: 'test',
        },
        preview: {
          actor: { label: 'Kael', characterId: KAEL, check: 'Atletismo' },
          target: { kind: 'difficulty', label: 'Normal (10)' },
          situation: 'test',
        },
      });
    const roll: GameRoll = {
      actor: { label: 'Kael', characterId: KAEL, check: 'Atletismo' },
      target: { kind: 'difficulty', label: 'Normal (10)' },
      situation: 'test',
      notes: [],
      result: { kind: 'test', ...resolveTest({ bonus: 5 }, 10, fixedDice(2, 3)) },
    };
    const events = [
      asked(1),
      asked(2),
      asked(3),
      rollEvent(4, { ...roll, requested: 1 }),
      // Repetirla con Suerte no la vuelve a pedir.
      rollEvent(5, { ...roll, requested: 1, reroll: { of: 4, side: 'actor', sides: ['actor'] } }),
      event(6, { kind: 'settled', of: 2, how: 'withdrawn' }),
    ];
    expect(pendingRollRequests(events).map((pending) => pending.id)).toEqual([3]);
    expect(settledEvents(events).get(1)).toBe('answered');
  });
});
