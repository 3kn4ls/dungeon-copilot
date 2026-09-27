import { describe, expect, it } from 'vitest';
import { ATTRIBUTES } from './attributes';
import {
  DEFAULT_SKILLS,
  createSkillCatalog,
  defaultSkillCatalog,
  unmetRequirements,
} from './skills';
import type { AdvancedSkill } from './skills';
import { kael } from './test-fixtures';

describe('catálogo por defecto', () => {
  it('cada atributo tiene habilidades básicas y tres avanzadas', () => {
    for (const attribute of ATTRIBUTES) {
      const { basic, advanced } = defaultSkillCatalog.byAttribute(attribute);
      expect(basic.length).toBeGreaterThanOrEqual(3);
      expect(advanced).toHaveLength(3);
    }
  });

  it('las avanzadas piden un atributo mínimo de 3 o 4', () => {
    for (const skill of DEFAULT_SKILLS.filter((s): s is AdvancedSkill => s.tier === 'advanced')) {
      const minimum = skill.requires.attributes?.[skill.attribute];
      expect(minimum === 3 || minimum === 4).toBe(true);
    }
  });
});

describe('createSkillCatalog', () => {
  const basic = {
    id: 'lore',
    tier: 'basic',
    attribute: 'intelligence',
    name: 'Saber',
    description: '',
  } as const;

  it('rechaza ids repetidos', () => {
    expect(() => createSkillCatalog([basic, basic])).toThrow(/repetido/);
  });

  it('rechaza requisitos que no existen o no son básicos', () => {
    const advanced = (requires: AdvancedSkill['requires']): AdvancedSkill => ({
      id: 'x',
      tier: 'advanced',
      attribute: 'intelligence',
      name: 'X',
      description: '',
      requires,
    });
    expect(() => createSkillCatalog([basic, advanced({ skills: { cooking: 1 } })])).toThrow(
      /no existe/,
    );
    expect(() => createSkillCatalog([basic, advanced({ skills: { x: 1 } })])).toThrow(
      /solo puede pedir habilidades básicas/,
    );
    expect(() =>
      createSkillCatalog([basic, advanced({ attributes: { intelligence: 6 } })]),
    ).toThrow(/fuera de la escala/);
    expect(() => createSkillCatalog([basic, advanced({ skills: { lore: 4 } })])).toThrow(
      /fuera de la escala/,
    );
  });
});

describe('unmetRequirements', () => {
  it('está vacío cuando se cumplen los requisitos', () => {
    const crushingBlow = defaultSkillCatalog.get('crushing-blow') as AdvancedSkill;
    expect(unmetRequirements(crushingBlow, kael(), defaultSkillCatalog)).toEqual([]);
  });
});
