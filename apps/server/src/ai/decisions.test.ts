import { DEFAULT_SKILLS } from '@dungeon-copilot/rules';
import { describe, expect, it } from 'vitest';
import { checkQuestions, checkSuggestion, type CheckPrompt } from './decisions';

const kael = { name: 'Kael', background: 'Mercenario de la Compañía Libre' };

const hiding: CheckPrompt = {
  character: kael,
  scene: 'El callejón del puerto',
  shown: { title: 'El callejón', body: 'Dos guardias se acercan con antorchas.' },
  intent: 'act',
  text: 'Me escondo tras las cajas',
};

describe('qué tirada pedir: las preguntas', () => {
  it('pregunta con qué habilidad tira, la dificultad, si alguien se opone, el trasfondo y si hace falta tirar', () => {
    const { state, questions } = checkQuestions(hiding);
    expect(Object.keys(questions).sort()).toEqual(
      ['background', 'difficulty', 'needsRoll', 'opposed', 'skill'].sort(),
    );
    expect(state).toBe(
      [
        'Personaje: Kael.',
        'Trasfondo: Mercenario de la Compañía Libre.',
        'Escena: El callejón del puerto.',
        'Lo último que ha descrito el máster:\nEl callejón\nDos guardias se acercan con antorchas.',
        'Su jugador pulsa «Actuar» y escribe: «Me escondo tras las cajas»',
      ].join('\n'),
    );
  });

  it('elige entre las 19 habilidades básicas, cada una con lo que es', () => {
    const { skill } = checkQuestions(hiding).questions;
    const basic = DEFAULT_SKILLS.filter((s) => s.tier === 'basic');
    expect(basic).toHaveLength(19);
    expect(skill?.type).toBe('choice');
    const options = Object.keys(skill?.criteria ?? {});
    // Nimble admite de 2 a 26 opciones.
    expect(options.length).toBeLessThanOrEqual(26);
    expect(options).toEqual(basic.map((s) => s.id));
    expect(skill?.criteria.stealth).toBe('Sigilo: Moverse sin ser visto ni oído, esconderse.');
    expect(skill?.instructions).toContain('no por lo que mejor se le da');
  });

  it('la dificultad va de Fácil a Heroica, con lo que significa cada una', () => {
    const { difficulty } = checkQuestions(hiding).questions;
    expect(difficulty?.type).toBe('score');
    expect(difficulty?.criteria.map((level) => level.split(':')[0])).toEqual([
      'Fácil',
      'Normal',
      'Difícil',
      'Muy difícil',
      'Heroica',
    ]);
  });

  it('el trasfondo, solo si tiene', () => {
    const { questions } = checkQuestions({
      ...hiding,
      character: { name: 'Kael', background: '  ' },
    });
    expect(questions.background).toBeUndefined();
    expect(checkQuestions(hiding).questions.background?.instructions).toContain(
      '«Mercenario de la Compañía Libre»',
    );
  });

  it('en un hechizo, solo la escala del efecto y el trasfondo: tira con Arcano', () => {
    const { questions } = checkQuestions({ ...hiding, intent: 'spell', text: 'Enciendo la vela' });
    expect(Object.keys(questions).sort()).toEqual(['background', 'difficulty']);
    expect(questions.difficulty?.criteria.map((level) => level.split(' ')[0])).toEqual([
      'Menor',
      'Moderado',
      'Mayor',
      'Portentoso',
    ]);
  });

  it('en un disparo, la distancia y la cobertura: con qué tira y la dificultad los dice el reglamento', () => {
    const { state, questions } = checkQuestions({
      ...hiding,
      intent: 'ranged',
      text: 'Le disparo desde la torre',
      target: 'Bandidos',
    });
    expect(Object.keys(questions).sort()).toEqual(['background', 'cover', 'range']);
    expect(questions.range?.criteria.map((level) => level.split(':')[0])).toEqual([
      'Corta',
      'Media',
      'Larga',
    ]);
    expect(state).toContain(
      'Su jugador pulsa «A distancia» y escribe: «Le disparo desde la torre» Va contra Bandidos.',
    );
  });

  it('recorta lo que escribe el jugador y la escena', () => {
    const { state } = checkQuestions({
      ...hiding,
      text: 'a'.repeat(2000),
      shown: { title: '', body: 'b'.repeat(2000) },
    });
    expect(state).not.toContain('a'.repeat(601));
    expect(state).not.toContain('b'.repeat(601));
    expect(state).toContain('…');
  });
});

describe('qué tirada pedir: lo que sugiere', () => {
  it('las 3 habilidades más probables y la dificultad más cercana', () => {
    expect(
      checkSuggestion(hiding, {
        skill: {
          choice: 'stealth',
          probabilities: {
            athletics: 0.05,
            stealth: 0.72,
            acrobatics: 0.06,
            'sleight-of-hand': 0.17,
          },
        },
        difficulty: { score: 1.6 },
        opposed: { probability: 0.7 },
        background: { probability: 0.2 },
        needsRoll: { probability: 0.9 },
      }),
    ).toEqual({
      skills: [
        { id: 'stealth', probability: 0.72 },
        { id: 'sleight-of-hand', probability: 0.17 },
        { id: 'acrobatics', probability: 0.06 },
      ],
      difficulty: 'hard',
      opposed: 0.7,
      background: 0.2,
      needsRoll: 0.9,
    });
  });

  it('la dificultad no se sale de la escala, y en un hechizo es la del efecto', () => {
    expect(checkSuggestion(hiding, { difficulty: { score: -0.4 } }).difficulty).toBe('easy');
    expect(checkSuggestion(hiding, { difficulty: { score: 9 } }).difficulty).toBe('heroic');
    const spell = { ...hiding, intent: 'spell' as const };
    // Portentoso es el último de los hechizos: Muy difícil.
    expect(checkSuggestion(spell, { difficulty: { score: 3.2 } }).difficulty).toBe('veryHard');
    expect(checkSuggestion(spell, { difficulty: { score: 0.4 } }).difficulty).toBe('easy');
  });

  it('sin las que apenas tienen opciones, salvo la primera', () => {
    const suggestion = checkSuggestion(hiding, {
      skill: { choice: 'stealth', probabilities: { stealth: 0.97, athletics: 0.02, lore: 0.01 } },
    });
    expect(suggestion.skills).toEqual([{ id: 'stealth', probability: 0.97 }]);
    const unsure = checkSuggestion(hiding, {
      skill: { choice: 'lore', probabilities: { lore: 0.04, perception: 0.03 } },
    });
    expect(unsure.skills).toEqual([{ id: 'lore', probability: 0.04 }]);
  });

  it('solo sugiere habilidades que existen', () => {
    const suggestion = checkSuggestion(hiding, {
      skill: { choice: 'flying', probabilities: { flying: 0.9, stealth: 0.1 } },
    });
    expect(suggestion.skills).toEqual([{ id: 'stealth', probability: 0.1 }]);
  });

  it('en un disparo, la distancia y la cobertura', () => {
    const shot = { ...hiding, intent: 'ranged' as const };
    expect(checkSuggestion(shot, { range: { score: 1.7 }, cover: { probability: 0.96 } })).toEqual({
      skills: [],
      shot: { range: 'long', cover: 0.96 },
    });
    expect(checkSuggestion(shot, { range: { score: 0.2 } }).shot).toEqual({
      range: 'short',
      cover: 0,
    });
  });
});
