import { describe, expect, it } from 'vitest';
import { NPC_PROFILES, UNHARMED, damageNpcs, memberDamage, npcBonus, npcIsDown } from './npc';

describe('perfiles de PNJ', () => {
  it('restan 2 fuera de su especialidad', () => {
    expect(npcBonus('soldier')).toBe(4);
    expect(npcBonus('soldier', false)).toBe(2);
  });

  it('su Destreza es la mitad de su bonificador', () => {
    for (const profile of Object.values(NPC_PROFILES)) {
      expect(profile.dexterity).toBe(profile.bonus / 2);
    }
    expect(NPC_PROFILES.minion.dexterity).toBe(1);
    expect(NPC_PROFILES.champion.dexterity).toBe(4);
  });

  it('caen al llegar a su aguante', () => {
    expect(npcIsDown('minion', 1)).toBe(true);
    expect(npcIsDown('champion', 5)).toBe(false);
    expect(npcIsDown('champion', 6)).toBe(true);
  });
});

describe('damageNpcs', () => {
  it('uno solo lleva la cuenta del daño hasta caer', () => {
    const first = damageNpcs('veteran', 1, UNHARMED, 2);
    expect(first).toEqual({ harm: { down: 0, damage: 2 }, member: 0, fell: false, out: false });
    expect(damageNpcs('veteran', 1, first.harm, 2)).toEqual({
      harm: { down: 1, damage: 0 },
      member: 0,
      fell: true,
      out: true,
    });
  });

  it('en un grupo, cada golpe alcanza a uno: los esbirros caen de uno en uno', () => {
    let harm = UNHARMED;
    for (const down of [1, 2]) {
      const hit = damageNpcs('minion', 3, harm, 3);
      expect(hit).toEqual({ harm: { down, damage: 0 }, member: down - 1, fell: true, out: false });
      harm = hit.harm;
    }
    expect(damageNpcs('minion', 3, harm, 1).out).toBe(true);
  });

  it('el daño que sobra no pasa al siguiente', () => {
    const hit = damageNpcs('soldier', 2, { down: 0, damage: 2 }, 5);
    expect(hit).toEqual({ harm: { down: 1, damage: 0 }, member: 0, fell: true, out: false });
  });

  it('no se puede herir a un grupo que ya ha caído', () => {
    expect(() => damageNpcs('minion', 2, { down: 2, damage: 0 }, 1)).toThrow(/ninguno en pie/);
    expect(() => damageNpcs('minion', 0, UNHARMED, 1)).toThrow(/al menos uno/);
    expect(() => damageNpcs('minion', 1, UNHARMED, -1)).toThrow(/no negativo/);
  });

  it('si el golpe dice a cuál va, cada uno lleva la cuenta de lo suyo', () => {
    const first = damageNpcs('soldier', 3, UNHARMED, 2, 1);
    expect(first).toEqual({
      harm: { down: 0, damage: 2, members: [0, 2, 0] },
      member: 1,
      fell: false,
      out: false,
    });
    const second = damageNpcs('soldier', 3, first.harm, 2, 2);
    expect(second.harm).toEqual({ down: 0, damage: 2, members: [0, 2, 2] });
    expect(second.fell).toBe(false);
    const third = damageNpcs('soldier', 3, second.harm, 5, 1);
    expect(third).toEqual({
      harm: { down: 1, damage: 2, members: [0, 3, 2] },
      member: 1,
      fell: true,
      out: false,
    });
  });

  it('sin decir a cuál, el golpe va al más herido de los que siguen', () => {
    const harm = { down: 1, damage: 2, members: [0, 3, 2] };
    expect(damageNpcs('soldier', 3, harm, 1)).toMatchObject({ member: 2, fell: true });
    expect(damageNpcs('soldier', 3, { ...harm, members: [0, 3, 0] }, 1).member).toBe(0);
  });

  it('los golpes que no decían a cuál iban cuentan por orden', () => {
    expect(memberDamage('soldier', 3, { down: 1, damage: 2 })).toEqual([3, 2, 0]);
    expect(memberDamage('soldier', 2, UNHARMED)).toEqual([0, 0]);
    const hit = damageNpcs('soldier', 3, { down: 1, damage: 2 }, 1, 2);
    expect(hit.harm).toEqual({ down: 1, damage: 2, members: [3, 2, 1] });
  });

  it('no se puede herir a uno que ya ha caído ni a uno que no está en el grupo', () => {
    const harm = { down: 1, damage: 0, members: [0, 3] };
    expect(() => damageNpcs('soldier', 2, harm, 1, 1)).toThrow(/ya ha caído/);
    expect(() => damageNpcs('soldier', 2, harm, 1, 2)).toThrow(/es de 2/);
  });
});
