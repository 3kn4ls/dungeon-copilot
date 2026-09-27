import { describe, expect, it } from 'vitest';
import { planAdvance, sessionXp } from './advancement';
import { kael } from './test-fixtures';

describe('sessionXp', () => {
  it('da 2 por sesión más 1 por hito, hasta 3 hitos', () => {
    expect(sessionXp(0)).toBe(2);
    expect(sessionXp(2)).toBe(4);
    expect(sessionXp(10)).toBe(5);
    expect(sessionXp(-1)).toBe(2);
  });
});

describe('planAdvance', () => {
  it('subir una habilidad al rango N cuesta N × 2', () => {
    const plan = planAdvance(kael(), { kind: 'raiseSkill', skill: 'athletics' });
    expect(plan).toMatchObject({ ok: true, cost: 4 });
    if (plan.ok) expect(plan.build.skills.athletics).toBe(2);
    expect(planAdvance(kael(), { kind: 'raiseSkill', skill: 'stealth' })).toMatchObject({
      cost: 2,
    });
  });

  it('no sube una habilidad por encima de maestro', () => {
    const master = kael({ skills: { athletics: 3 } });
    expect(planAdvance(master, { kind: 'raiseSkill', skill: 'athletics' })).toEqual({
      ok: false,
      errors: ['Atletismo ya está en el rango máximo'],
    });
  });

  it('aprender una avanzada cuesta 5 y exige sus requisitos', () => {
    expect(planAdvance(kael(), { kind: 'learnAdvanced', skill: 'crushing-blow' })).toMatchObject({
      ok: true,
      cost: 5,
    });
    expect(planAdvance(kael(), { kind: 'learnAdvanced', skill: 'sorcery' })).toEqual({
      ok: false,
      errors: ['Requiere Inteligencia 4 (tiene 2)', 'Requiere Arcano rango 2 (tiene 0)'],
    });
    expect(planAdvance(kael(), { kind: 'learnAdvanced', skill: 'brutal-charge' })).toMatchObject({
      ok: false,
    });
  });

  it('distingue básicas de avanzadas', () => {
    expect(planAdvance(kael(), { kind: 'learnAdvanced', skill: 'stealth' })).toMatchObject({
      ok: false,
    });
    expect(planAdvance(kael(), { kind: 'raiseSkill', skill: 'sorcery' })).toMatchObject({
      ok: false,
    });
  });

  it('subir un atributo al valor N cuesta N × 3, hasta 5', () => {
    expect(planAdvance(kael(), { kind: 'raiseAttribute', attribute: 'strength' })).toMatchObject({
      ok: true,
      cost: 15,
    });
    const legend = kael({ attributes: { ...kael().attributes, strength: 5 } });
    expect(planAdvance(legend, { kind: 'raiseAttribute', attribute: 'strength' })).toEqual({
      ok: false,
      errors: ['Fuerza ya está en el máximo (5)'],
    });
  });
});
