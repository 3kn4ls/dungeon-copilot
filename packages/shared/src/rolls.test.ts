import { describe, expect, it } from 'vitest';
import { rollRequestSchema } from './rolls';

describe('rollRequestSchema', () => {
  it('acepta una prueba y rellena la ventaja por defecto', () => {
    expect(rollRequestSchema.parse({ kind: 'test', check: { bonus: 4 }, difficulty: 10 })).toEqual({
      kind: 'test',
      check: { bonus: 4, edge: 'none' },
      difficulty: 10,
    });
  });

  it('rechaza tipos desconocidos y bonificadores decimales', () => {
    expect(rollRequestSchema.safeParse({ kind: 'magic' }).success).toBe(false);
    expect(
      rollRequestSchema.safeParse({ kind: 'test', check: { bonus: 1.5 }, difficulty: 10 }).success,
    ).toBe(false);
  });
});
