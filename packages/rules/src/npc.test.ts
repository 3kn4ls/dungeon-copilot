import { describe, expect, it } from 'vitest';
import { npcBonus, npcIsDown } from './npc';

describe('perfiles de PNJ', () => {
  it('restan 2 fuera de su especialidad', () => {
    expect(npcBonus('soldier')).toBe(4);
    expect(npcBonus('soldier', false)).toBe(2);
  });

  it('caen al llegar a su aguante', () => {
    expect(npcIsDown('minion', 1)).toBe(true);
    expect(npcIsDown('champion', 5)).toBe(false);
    expect(npcIsDown('champion', 6)).toBe(true);
  });
});
