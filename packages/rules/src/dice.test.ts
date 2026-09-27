import { describe, expect, it } from 'vitest';
import { combineEdges, createSeededRandom, keepDice, roll2d6, rollDie } from './dice';
import { fixedDice } from './testing';

describe('rollDie', () => {
  it('saca siempre de 1 a 6', () => {
    const random = createSeededRandom(1);
    const faces = new Set(Array.from({ length: 600 }, () => rollDie(random)));
    expect([...faces].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('respeta los extremos de la fuente aleatoria', () => {
    expect(rollDie(() => 0)).toBe(1);
    expect(rollDie(() => 0.999999)).toBe(6);
  });
});

describe('roll2d6', () => {
  it('sin ventaja tira dos dados y cuenta los dos', () => {
    const roll = roll2d6('none', fixedDice(5, 2));
    expect(roll.rolled).toEqual([5, 2]);
    expect(roll.kept).toEqual([2, 5]);
  });

  it('con ventaja tira tres y se queda con los dos mejores', () => {
    const roll = roll2d6('advantage', fixedDice(1, 6, 4));
    expect(roll.rolled).toEqual([1, 6, 4]);
    expect(roll.kept).toEqual([4, 6]);
  });

  it('con desventaja tira tres y se queda con los dos peores', () => {
    expect(roll2d6('disadvantage', fixedDice(1, 6, 4)).kept).toEqual([1, 4]);
  });
});

describe('keepDice', () => {
  it('rechaza un número de dados que no corresponde', () => {
    expect(() => keepDice([1, 2, 3], 'none')).toThrow();
    expect(() => keepDice([1, 2], 'advantage')).toThrow();
  });
});

describe('combineEdges', () => {
  it('no acumula ventajas y anula ventaja con desventaja', () => {
    expect(combineEdges()).toBe('none');
    expect(combineEdges('advantage', 'advantage')).toBe('advantage');
    expect(combineEdges('disadvantage', 'none')).toBe('disadvantage');
    expect(combineEdges('advantage', 'disadvantage', 'advantage')).toBe('none');
  });
});

describe('createSeededRandom', () => {
  it('con la misma semilla repite la misma secuencia', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    expect(Array.from({ length: 10 }, a)).toEqual(Array.from({ length: 10 }, b));
  });

  it('devuelve valores en [0, 1)', () => {
    const random = createSeededRandom(7);
    for (let i = 0; i < 1000; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
