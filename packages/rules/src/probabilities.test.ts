import { describe, expect, it } from 'vitest';
import { createSeededRandom } from './dice';
import {
  fullSuccessChance,
  keptDistribution,
  opposedOdds,
  successChance,
  testOdds,
} from './probabilities';
import { DIFFICULTIES, OUTCOMES, resolveTest } from './resolution';

const total = (odds: Record<string, number>) => Object.values(odds).reduce((a, b) => a + b, 0);

describe('keptDistribution', () => {
  it('las probabilidades suman 1 con y sin ventaja', () => {
    for (const edge of ['none', 'advantage', 'disadvantage'] as const) {
      expect(keptDistribution(edge).reduce((sum, p) => sum + p.weight, 0)).toBeCloseTo(1, 12);
    }
  });

  it('sin ventaja hay 21 parejas distintas', () => {
    expect(keptDistribution('none')).toHaveLength(21);
  });
});

describe('testOdds', () => {
  it('coincide con la tabla del reglamento: +4 contra Normal', () => {
    const odds = testOdds({ bonus: 4 }, DIFFICULTIES.normal);
    expect(odds.fumble).toBeCloseTo(1 / 36, 12);
    expect(odds.failure).toBeCloseTo(9 / 36, 12);
    expect(odds.partial).toBeCloseTo(16 / 36, 12);
    expect(odds.success).toBeCloseTo(9 / 36, 12);
    expect(odds.critical).toBeCloseTo(1 / 36, 12);
    expect(successChance(odds)).toBeCloseTo(26 / 36, 12);
    expect(fullSuccessChance(odds)).toBeCloseTo(10 / 36, 12);
  });

  it('las probabilidades siempre suman 1', () => {
    for (let bonus = -2; bonus <= 12; bonus++) {
      for (const difficulty of Object.values(DIFFICULTIES)) {
        expect(total(testOdds({ bonus }, difficulty))).toBeCloseTo(1, 12);
      }
    }
  });

  it('más bonificador nunca empeora la probabilidad de éxito', () => {
    for (let bonus = 0; bonus < 12; bonus++) {
      expect(successChance(testOdds({ bonus: bonus + 1 }, 12))).toBeGreaterThanOrEqual(
        successChance(testOdds({ bonus }, 12)),
      );
    }
  });

  it('la ventaja mejora y la desventaja empeora', () => {
    const none = successChance(testOdds({ bonus: 4 }, 12));
    const advantage = successChance(testOdds({ bonus: 4, edge: 'advantage' }, 12));
    const disadvantage = successChance(testOdds({ bonus: 4, edge: 'disadvantage' }, 12));
    expect(advantage).toBeGreaterThan(none);
    expect(disadvantage).toBeLessThan(none);
  });

  it('coincide con muchas tiradas reales', () => {
    const random = createSeededRandom(2026);
    const rolls = 40_000;
    const counts = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<string, number>;
    for (let i = 0; i < rolls; i++) {
      counts[resolveTest({ bonus: 5, edge: 'advantage' }, 12, random).outcome]! += 1;
    }
    const odds = testOdds({ bonus: 5, edge: 'advantage' }, 12);
    for (const outcome of OUTCOMES) {
      expect(counts[outcome]! / rolls).toBeCloseTo(odds[outcome], 2);
    }
  });
});

describe('opposedOdds', () => {
  it('a igualdad de bonificador, quien actúa tiene algo más de la mitad de éxito', () => {
    const odds = opposedOdds({ bonus: 5 }, { bonus: 5 });
    expect(total(odds)).toBeCloseTo(1, 12);
    expect(successChance(odds)).toBeCloseTo(0.556, 2);
  });

  it('dos puntos de diferencia pesan mucho', () => {
    expect(successChance(opposedOdds({ bonus: 7 }, { bonus: 5 }))).toBeGreaterThan(0.7);
    expect(successChance(opposedOdds({ bonus: 3 }, { bonus: 5 }))).toBeLessThan(0.4);
  });
});
