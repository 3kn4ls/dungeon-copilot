import { describe, expect, it } from 'vitest';
import {
  UNHURT,
  applyDamage,
  hasPhysicalDisadvantage,
  isDown,
  recoverScratches,
  recoverSeverity,
} from './wounds';

describe('applyDamage', () => {
  it('llena primero los rasguños', () => {
    expect(applyDamage(UNHURT, 1, 2)).toEqual({
      state: { scratches: 1, severity: 'none' },
      lethal: false,
    });
  });

  it('el daño que no cabe empeora la herida un nivel por punto', () => {
    expect(applyDamage(UNHURT, 3, 2).state).toEqual({ scratches: 2, severity: 'wounded' });
    expect(applyDamage({ scratches: 2, severity: 'wounded' }, 1, 2).state.severity).toBe('grave');
  });

  it('llegar justo a fuera de combate no es mortal', () => {
    expect(applyDamage({ scratches: 2, severity: 'grave' }, 1, 2)).toEqual({
      state: { scratches: 2, severity: 'down' },
      lethal: false,
    });
  });

  it('pasarse de fuera de combate es mortal', () => {
    expect(applyDamage({ scratches: 2, severity: 'grave' }, 2, 2).lethal).toBe(true);
    expect(applyDamage({ scratches: 2, severity: 'down' }, 1, 2).lethal).toBe(true);
  });

  it('rechaza daño negativo o decimal', () => {
    expect(() => applyDamage(UNHURT, -1, 2)).toThrow();
    expect(() => applyDamage(UNHURT, 1.5, 2)).toThrow();
  });
});

describe('recuperación', () => {
  it('los rasguños se borran y la herida mejora nivel a nivel', () => {
    const hurt = { scratches: 2, severity: 'grave' } as const;
    expect(recoverScratches(hurt)).toEqual({ scratches: 0, severity: 'grave' });
    expect(recoverSeverity(hurt).severity).toBe('wounded');
    expect(recoverSeverity(UNHURT).severity).toBe('none');
  });
});

describe('efectos', () => {
  it('grave da desventaja física y fuera de combate deja al personaje caído', () => {
    expect(hasPhysicalDisadvantage({ scratches: 0, severity: 'wounded' })).toBe(false);
    expect(hasPhysicalDisadvantage({ scratches: 0, severity: 'grave' })).toBe(true);
    expect(isDown({ scratches: 0, severity: 'down' })).toBe(true);
  });
});
