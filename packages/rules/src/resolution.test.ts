import { describe, expect, it } from 'vitest';
import {
  DIFFICULTIES,
  evaluateOpposed,
  evaluateTest,
  outcomeFromMargin,
  resolveOpposed,
  resolveTest,
  shiftOutcome,
} from './resolution';
import { fixedDice } from './testing';

describe('outcomeFromMargin', () => {
  it('reparte los resultados por margen', () => {
    expect(outcomeFromMargin(5)).toBe('success');
    expect(outcomeFromMargin(3)).toBe('success');
    expect(outcomeFromMargin(2)).toBe('partial');
    expect(outcomeFromMargin(0)).toBe('partial');
    expect(outcomeFromMargin(-1)).toBe('failure');
  });
});

describe('shiftOutcome', () => {
  it('sube y baja escalones sin salirse de la escala', () => {
    expect(shiftOutcome('failure', 1)).toBe('partial');
    expect(shiftOutcome('success', 1)).toBe('critical');
    expect(shiftOutcome('critical', 1)).toBe('critical');
    expect(shiftOutcome('failure', -1)).toBe('fumble');
    expect(shiftOutcome('fumble', -1)).toBe('fumble');
  });
});

describe('evaluateTest', () => {
  it('aplica el margen contra la dificultad', () => {
    expect(evaluateTest([3, 4], 4, DIFFICULTIES.normal)).toBe('partial'); // 11: margen 1
    expect(evaluateTest([4, 5], 4, DIFFICULTIES.normal)).toBe('success'); // 13: margen 3
    expect(evaluateTest([2, 3], 4, DIFFICULTIES.normal)).toBe('failure'); // 9: margen -1
  });

  it('un doble 6 sube un escalón, aunque el margen no llegue', () => {
    expect(evaluateTest([6, 6], 1, DIFFICULTIES.heroic)).toBe('partial'); // 13 contra 16
    expect(evaluateTest([6, 6], 4, DIFFICULTIES.normal)).toBe('critical');
  });

  it('un doble 1 baja un escalón', () => {
    expect(evaluateTest([1, 1], 11, DIFFICULTIES.normal)).toBe('partial'); // 13: pleno, baja a con coste
    expect(evaluateTest([1, 1], 8, DIFFICULTIES.normal)).toBe('failure'); // 10: con coste, baja a fallo
    expect(evaluateTest([1, 1], 2, DIFFICULTIES.normal)).toBe('fumble'); // 4: fallo, baja a pifia
  });
});

describe('evaluateOpposed', () => {
  it('los empates favorecen a quien actúa, con coste', () => {
    expect(evaluateOpposed([3, 4], 4, [2, 5], 4)).toBe('partial');
  });

  it('los dobles de quien se opone cuentan al revés', () => {
    // 7+4 = 11 contra 12+2 = 14: fallo, y el doble 6 del rival lo baja a pifia.
    expect(evaluateOpposed([3, 4], 4, [6, 6], 2)).toBe('fumble');
    // 7+4 = 11 contra 2+4 = 6: pleno, y el doble 1 del rival lo sube a crítico.
    expect(evaluateOpposed([3, 4], 4, [1, 1], 4)).toBe('critical');
  });

  it('si ambos sacan doble 6, los escalones se compensan', () => {
    expect(evaluateOpposed([6, 6], 4, [6, 6], 4)).toBe('partial');
  });
});

describe('resolveTest', () => {
  it('devuelve el detalle completo de la tirada', () => {
    const result = resolveTest({ bonus: 5 }, DIFFICULTIES.hard, fixedDice(4, 5));
    expect(result.roller.total).toBe(14);
    expect(result.margin).toBe(2);
    expect(result.baseOutcome).toBe('partial');
    expect(result.outcome).toBe('partial');
    expect(result.success).toBe(true);
  });

  it('usa ventaja si se pide', () => {
    const result = resolveTest(
      { bonus: 3, edge: 'advantage' },
      DIFFICULTIES.normal,
      fixedDice(1, 5, 6),
    );
    expect(result.roller.dice.kept).toEqual([5, 6]);
    expect(result.outcome).toBe('success');
  });
});

describe('resolveOpposed', () => {
  it('tira primero quien actúa y después quien se opone', () => {
    const result = resolveOpposed({ bonus: 5 }, { bonus: 4 }, fixedDice(2, 3, 5, 5));
    expect(result.actor.total).toBe(10);
    expect(result.opponent.total).toBe(14);
    expect(result.margin).toBe(-4);
    expect(result.outcome).toBe('failure');
    expect(result.success).toBe(false);
  });
});
