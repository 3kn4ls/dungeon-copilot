import { describe, expect, it } from 'vitest';
import { NPC_PROFILES, npcBonus, npcIsDown } from './npc';

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
