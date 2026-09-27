import { describe, expect, it } from 'vitest';
import {
  characterAttackDamage,
  conditionEdges,
  damageOnHit,
  meleeAttack,
  meleeDefense,
  rangedDifficulty,
  rollInitiative,
} from './combat';
import { kael } from './test-fixtures';
import { fixedDice } from './testing';

const weak = kael({
  attributes: { strength: 2, dexterity: 4, charisma: 2, intelligence: 2, endurance: 2 },
});

describe('meleeAttack y meleeDefense', () => {
  it('elige la habilidad según el arma', () => {
    expect(meleeAttack(kael(), 'light').skill).toBe('fencing');
    expect(meleeAttack(kael(), 'heavy')).toEqual({
      skill: 'melee-weapons',
      modifier: 0,
      edges: [],
    });
  });

  it('un arma pesada sin Fuerza 3 va con desventaja', () => {
    expect(meleeAttack(weak, 'heavy').edges).toEqual(['disadvantage']);
    expect(meleeAttack(weak, 'medium').edges).toEqual([]);
  });

  it('el escudo ayuda a parar, no a esquivar', () => {
    expect(meleeDefense(kael(), 'parry', { weapon: 'medium', shield: true }).modifier).toBe(1);
    expect(meleeDefense(kael(), 'dodge', { shield: true })).toEqual({
      skill: 'acrobatics',
      modifier: 0,
      edges: [],
    });
  });
});

describe('rangedDifficulty', () => {
  it('es 6 + Destreza del objetivo + distancia + cobertura + escudo', () => {
    expect(rangedDifficulty({ targetDexterity: 2, range: 'medium' })).toBe(10);
    expect(
      rangedDifficulty({ targetDexterity: 2, range: 'long', cover: 'partial', targetShield: true }),
    ).toBe(15);
  });

  it('Disparo certero ignora la distancia media y la cobertura parcial', () => {
    expect(
      rangedDifficulty({ targetDexterity: 2, range: 'medium', cover: 'partial', deadeye: true }),
    ).toBe(8);
    expect(rangedDifficulty({ targetDexterity: 2, range: 'long', deadeye: true })).toBe(12);
  });
});

describe('damageOnHit', () => {
  it('solo hay daño con éxito', () => {
    expect(damageOnHit({ baseDamage: 2, outcome: 'failure' })).toBe(0);
    expect(damageOnHit({ baseDamage: 2, outcome: 'fumble' })).toBe(0);
    expect(damageOnHit({ baseDamage: 2, outcome: 'partial' })).toBe(2);
  });

  it('el crítico suma 1, la armadura resta y un impacto hace al menos 1', () => {
    expect(damageOnHit({ baseDamage: 3, outcome: 'critical', targetArmor: 'heavy' })).toBe(2);
    expect(damageOnHit({ baseDamage: 1, outcome: 'success', targetArmor: 'heavy' })).toBe(1);
  });
});

describe('characterAttackDamage', () => {
  it('Golpe demoledor suma 1 con arma pesada en éxito pleno o crítico', () => {
    const brute = kael({ advancedSkills: ['crushing-blow'] });
    expect(characterAttackDamage({ attacker: brute, weapon: 'heavy', outcome: 'success' })).toBe(4);
    expect(characterAttackDamage({ attacker: brute, weapon: 'heavy', outcome: 'partial' })).toBe(3);
    expect(characterAttackDamage({ attacker: brute, weapon: 'medium', outcome: 'success' })).toBe(
      2,
    );
  });

  it('Ataque furtivo suma 2 por sorpresa', () => {
    const rogue = kael({ advancedSkills: ['sneak-attack'] });
    expect(
      characterAttackDamage({
        attacker: rogue,
        weapon: 'light',
        outcome: 'partial',
        surprise: true,
      }),
    ).toBe(3);
    expect(
      characterAttackDamage({
        attacker: kael(),
        weapon: 'light',
        outcome: 'partial',
        surprise: true,
      }),
    ).toBe(1);
  });
});

describe('conditionEdges', () => {
  const grave = { scratches: 2, severity: 'grave' } as const;

  it('una herida grave da desventaja solo en tiradas físicas', () => {
    expect(conditionEdges(kael(), { attribute: 'strength' }, { wounds: grave })).toEqual([
      'disadvantage',
    ]);
    expect(conditionEdges(kael(), { attribute: 'charisma' }, { wounds: grave })).toEqual([]);
    expect(
      conditionEdges(
        kael({ advancedSkills: ['unstoppable'] }),
        { attribute: 'strength' },
        { wounds: grave },
      ),
    ).toEqual([]);
  });

  it('la armadura pesada estorba en Sigilo salvo con entrenamiento', () => {
    const stealth = { attribute: 'dexterity', skill: 'stealth' } as const;
    expect(conditionEdges(kael(), stealth, { armor: 'heavy' })).toEqual(['disadvantage']);
    expect(conditionEdges(kael(), stealth, { armor: 'light' })).toEqual([]);
    expect(
      conditionEdges(kael({ advancedSkills: ['armor-training'] }), stealth, { armor: 'heavy' }),
    ).toEqual([]);
  });
});

describe('rollInitiative', () => {
  it('es 2d6 + Destreza', () => {
    expect(rollInitiative(3, 'none', fixedDice(4, 2)).total).toBe(9);
  });
});
