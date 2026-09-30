import { describe, expect, it } from 'vitest';
import {
  characterAttackDamage,
  compareInitiative,
  conditionEdges,
  damageOnHit,
  initiativeEdge,
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

  it('con ventaja cuentan los dos mejores de tres dados', () => {
    const initiative = rollInitiative(3, 'advantage', fixedDice(1, 6, 5));
    expect(initiative.dice.kept).toEqual([5, 6]);
    expect(initiative.total).toBe(14);
  });
});

describe('initiativeEdge', () => {
  const grave = { wounds: { scratches: 2, severity: 'grave' } } as const;

  it('Táctico da ventaja a todo su bando', () => {
    expect(initiativeEdge(kael(), {}, true)).toBe('advantage');
    expect(initiativeEdge(kael(), {}, false)).toBe('none');
  });

  it('una herida grave da desventaja, salvo Imparable', () => {
    expect(initiativeEdge(kael(), grave, false)).toBe('disadvantage');
    expect(initiativeEdge(kael({ advancedSkills: ['unstoppable'] }), grave, false)).toBe('none');
  });

  it('la ventaja de Táctico y la desventaja de una herida grave se anulan', () => {
    expect(initiativeEdge(kael(), grave, true)).toBe('none');
  });
});

describe('compareInitiative', () => {
  const entry = (name: string, total: number, character: boolean, dexterity: number) => ({
    name,
    total,
    character,
    dexterity,
  });
  const order = (...entries: ReturnType<typeof entry>[]) =>
    entries.sort(compareInitiative).map((e) => e.name);

  it('actúa antes quien saca más', () => {
    expect(order(entry('Kael', 8, true, 3), entry('Bandidos', 11, false, 1))).toEqual([
      'Bandidos',
      'Kael',
    ]);
  });

  it('los empates, para los PJ', () => {
    expect(order(entry('Lobos', 9, false, 2), entry('Kael', 9, true, 1))).toEqual([
      'Kael',
      'Lobos',
    ]);
  });

  it('entre dos PJ o dos grupos empatados, primero el de más Destreza', () => {
    expect(order(entry('Kael', 9, true, 2), entry('Mira', 9, true, 4))).toEqual(['Mira', 'Kael']);
    expect(order(entry('Bandidos', 7, false, 1), entry('Capitán', 7, false, 3))).toEqual([
      'Capitán',
      'Bandidos',
    ]);
  });

  it('si aún empatan, se quedan como estaban', () => {
    expect(order(entry('Kael', 9, true, 3), entry('Mira', 9, true, 3))).toEqual(['Kael', 'Mira']);
  });
});
