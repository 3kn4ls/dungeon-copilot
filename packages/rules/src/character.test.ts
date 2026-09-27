import { describe, expect, it } from 'vitest';
import {
  characterBuildSchema,
  checkBonus,
  scratchBoxes,
  validateCharacter,
  validateNewCharacter,
} from './character';
import { kael } from './test-fixtures';

const messages = (issues: { message: string }[]) => issues.map((i) => i.message);

describe('characterBuildSchema', () => {
  it('rellena los valores por defecto', () => {
    const parsed = characterBuildSchema.parse({
      name: ' Mira ',
      attributes: { strength: 1, dexterity: 4, charisma: 3, intelligence: 2, endurance: 2 },
    });
    expect(parsed).toMatchObject({ name: 'Mira', background: '', skills: {}, advancedSkills: [] });
  });

  it('rechaza atributos fuera de la escala y rangos imposibles', () => {
    const bad = { ...kael(), attributes: { ...kael().attributes, strength: 6 } };
    expect(characterBuildSchema.safeParse(bad).success).toBe(false);
    expect(characterBuildSchema.safeParse({ ...kael(), skills: { lore: 4 } }).success).toBe(false);
  });
});

describe('validateNewCharacter', () => {
  it('acepta un personaje bien construido', () => {
    expect(validateNewCharacter(kael())).toEqual([]);
  });

  it('exige repartir exactamente 12 puntos de atributo', () => {
    const issues = validateNewCharacter(
      kael({
        attributes: { strength: 4, dexterity: 4, charisma: 1, intelligence: 2, endurance: 2 },
      }),
    );
    expect(issues.map((i) => i.path)).toContain('attributes');
  });

  it('no deja empezar con un atributo en 5', () => {
    const issues = validateNewCharacter(
      kael({
        attributes: { strength: 5, dexterity: 2, charisma: 1, intelligence: 2, endurance: 2 },
      }),
    );
    expect(messages(issues)).toContain('Fuerza no puede pasar de 4 al crear el personaje');
  });

  it('limita los rangos de habilidad iniciales', () => {
    const issues = validateNewCharacter(
      kael({ skills: { 'melee-weapons': 3, athletics: 2, stealth: 2 } }),
    );
    expect(messages(issues)).toContain('Solo hay 6 rangos de habilidad para repartir (hay 7)');
    expect(messages(issues)).toContain(
      'Armas cuerpo a cuerpo no puede pasar de rango 2 al crear el personaje',
    );
  });

  it('solo permite una habilidad avanzada al crear', () => {
    const issues = validateNewCharacter(
      kael({ advancedSkills: ['brutal-charge', 'crushing-blow'] }),
    );
    expect(issues.map((i) => i.path)).toContain('advancedSkills');
  });
});

describe('validateCharacter', () => {
  it('comprueba los requisitos de las habilidades avanzadas', () => {
    const issues = validateCharacter(kael({ advancedSkills: ['sorcery'] }));
    expect(messages(issues)).toEqual([
      'Hechicería: Requiere Inteligencia 4 (tiene 2)',
      'Hechicería: Requiere Arcano rango 2 (tiene 0)',
    ]);
  });

  it('detecta habilidades desconocidas o en la lista equivocada', () => {
    const issues = validateCharacter(
      kael({ skills: { cooking: 1, sorcery: 1 }, advancedSkills: ['stealth', 'stealth'] }),
    );
    expect(messages(issues)).toEqual([
      'No existe la habilidad "cooking"',
      'Hechicería es avanzada: va en la lista de habilidades avanzadas, sin rango',
      'Sigilo es básica: va en la lista de habilidades con rango',
      'Habilidad avanzada repetida: "stealth"',
    ]);
  });
});

describe('scratchBoxes', () => {
  it('son tantas como Aguante, más una con Duro de pelar', () => {
    expect(scratchBoxes(kael())).toBe(2);
    expect(scratchBoxes(kael({ advancedSkills: ['tough'] }))).toBe(3);
  });
});

describe('checkBonus', () => {
  it('suma el atributo de la habilidad y su rango', () => {
    expect(checkBonus(kael(), { skill: 'melee-weapons' })).toEqual({
      attribute: 'strength',
      attributeValue: 4,
      skillRank: 2,
      modifier: 0,
      bonus: 6,
    });
  });

  it('permite tirar una habilidad con otro atributo', () => {
    expect(checkBonus(kael(), { skill: 'intimidation', attribute: 'strength' }).bonus).toBe(5);
  });

  it('sin entrenar cuenta rango 0, y sin habilidad se tira el atributo', () => {
    expect(checkBonus(kael(), { skill: 'stealth' }).bonus).toBe(3);
    expect(checkBonus(kael(), { attribute: 'charisma', modifier: 1 }).bonus).toBe(2);
  });

  it('no se tira con habilidades avanzadas ni desconocidas', () => {
    expect(() => checkBonus(kael(), { skill: 'brutal-charge' })).toThrow();
    expect(() => checkBonus(kael(), { skill: 'cooking' })).toThrow();
    expect(() => checkBonus(kael(), {})).toThrow();
  });
});
