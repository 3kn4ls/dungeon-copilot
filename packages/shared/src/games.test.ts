import { resolveOpposed, resolveTest } from '@dungeon-copilot/rules';
import { fixedDice } from '@dungeon-copilot/rules/testing';
import { describe, expect, it } from 'vitest';
import {
  characterSides,
  rerollSchema,
  rerollableSides,
  rerollerLabel,
  supersededRolls,
  type GameEvent,
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

const rollEvent = (id: number, roll: GameRoll): GameEvent => ({
  kind: 'roll',
  roll,
  id,
  gameId: 'partida',
  visibility: 'public',
  authorName: 'Ana',
  createdAt: '2026-09-27T20:00:00.000Z',
});

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
