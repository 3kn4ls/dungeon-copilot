import { describe, expect, it } from 'vitest';
import { NPC_PROFILES, UNHARMED, damageNpcs, npcBonus, npcIsDown } from './npc';

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
    expect(first).toEqual({ harm: { down: 0, damage: 2 }, fell: false, out: false });
    expect(damageNpcs('veteran', 1, first.harm, 2)).toEqual({
      harm: { down: 1, damage: 0 },
      fell: true,
      out: true,
    });
  });

  it('en un grupo, cada golpe alcanza a uno: los esbirros caen de uno en uno', () => {
    let harm = UNHARMED;
    for (const down of [1, 2]) {
      const hit = damageNpcs('minion', 3, harm, 3);
      expect(hit).toEqual({ harm: { down, damage: 0 }, fell: true, out: false });
      harm = hit.harm;
    }
    expect(damageNpcs('minion', 3, harm, 1).out).toBe(true);
  });

  it('el daño que sobra no pasa al siguiente', () => {
    const hit = damageNpcs('soldier', 2, { down: 0, damage: 2 }, 5);
    expect(hit).toEqual({ harm: { down: 1, damage: 0 }, fell: true, out: false });
  });

  it('no se puede herir a un grupo que ya ha caído', () => {
    expect(() => damageNpcs('minion', 2, { down: 2, damage: 0 }, 1)).toThrow(/ninguno en pie/);
    expect(() => damageNpcs('minion', 0, UNHARMED, 1)).toThrow(/al menos uno/);
    expect(() => damageNpcs('minion', 1, UNHARMED, -1)).toThrow(/no negativo/);
  });
});
