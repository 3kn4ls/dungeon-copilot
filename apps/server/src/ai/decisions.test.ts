import { DEFAULT_GEAR, DEFAULT_SKILLS } from '@dungeon-copilot/rules';
import { describe, expect, it } from 'vitest';
import {
  checkQuestions,
  checkSuggestion,
  enemyDecision,
  enemyQuestions,
  type CheckPrompt,
  type EnemyPrompt,
} from './decisions';

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

const kaelFighter = {
  kind: 'character' as const,
  id: 'kael-id',
  name: 'Kael',
  severity: 'grave' as const,
  gear: DEFAULT_GEAR,
};
const miraFighter = { ...kaelFighter, id: 'mira-id', name: 'Mira', severity: 'none' as const };
const bandits = {
  kind: 'npc' as const,
  id: 'bandits-id',
  name: 'Bandidos',
  profile: 'minion' as const,
  count: 3,
  harm: { down: 2, damage: 0 },
};
const ambush: EnemyPrompt = {
  round: 3,
  scene: 'El callejón del puerto',
  fighters: [kaelFighter, bandits, miraFighter],
  acting: { fighter: bandits, concept: 'Matones del gremio', goals: 'Cobrar la deuda' },
  blows: ['Golpe de Kael a Bandidos (3 de daño): cae uno y quedan 2.'],
  targets: true,
};

describe('qué hacen los enemigos: las preguntas', () => {
  it('cuenta cómo va el combate: la ronda, quién pelea, a quién le toca y los últimos golpes', () => {
    expect(enemyQuestions(ambush).state).toBe(
      [
        'Ronda 3.',
        'Escena: El callejón del puerto.',
        'Quién pelea y cómo va:',
        '- Kael (PJ): grave; lleva Arma media',
        '- Bandidos (PNJ, esbirro): quedan 1 de 3 en pie',
        '- Mira (PJ): sin heridas; lleva Arma media',
        'Le toca a: Bandidos (PNJ, esbirro): quedan 1 de 3 en pie',
        'Concepto: Matones del gremio',
        'Objetivos: Cobrar la deuda',
        'Los últimos golpes del combate:',
        '- Golpe de Kael a Bandidos (3 de daño): cae uno y quedan 2.',
      ].join('\n'),
    );
  });

  it('a quién atacan, entre los personajes, en un orden y en el contrario; y su moral', () => {
    const { questions } = enemyQuestions(ambush);
    expect(Object.keys(questions.target?.criteria ?? {})).toEqual(['kael-id', 'mira-id']);
    expect(Object.keys(questions.targetReversed?.criteria ?? {})).toEqual(['mira-id', 'kael-id']);
    expect(questions.target?.criteria['kael-id']).toBe('Kael (PJ): grave; lleva Arma media');
    expect(questions.target?.instructions).toContain('¿A quién atacan ahora Bandidos?');
    expect(Object.keys(questions.morale.criteria)).toEqual(['fight', 'flee', 'surrender']);
    expect(questions.morale.criteria.flee).toBe('Huyen: se retiran o escapan como pueden');
  });

  it('a quién atacan no se pregunta si solo hay uno, ni si no se pide', () => {
    const alone = { ...ambush, fighters: [kaelFighter, bandits] };
    expect(Object.keys(enemyQuestions(alone).questions)).toEqual(['morale']);
    expect(Object.keys(enemyQuestions({ ...ambush, targets: false }).questions)).toEqual([
      'morale',
    ]);
  });

  it('un PNJ solo, en singular', () => {
    const garrick = { ...bandits, name: 'Garrick', count: 1, harm: { down: 0, damage: 1 } };
    const { questions } = enemyQuestions({ ...ambush, acting: { fighter: garrick } });
    expect(questions.morale.instructions).toBe('¿Qué hace ahora Garrick, tal como va el combate?');
    expect(questions.morale.criteria.surrender).toBe('Se rinde: tira las armas y pide clemencia');
    expect(questions.target?.instructions).toContain('¿A quién ataca ahora Garrick?');
  });
});

describe('qué hacen los enemigos: lo que sugiere', () => {
  it('a quién atacan, con la media de los dos órdenes, y la moral más probable', () => {
    const decision = enemyDecision(ambush, {
      target: { choice: 'kael-id', probabilities: { 'kael-id': 0.73, 'mira-id': 0.27 } },
      targetReversed: { choice: 'mira-id', probabilities: { 'mira-id': 0.61, 'kael-id': 0.39 } },
      morale: { choice: 'flee', probabilities: { fight: 0.33, flee: 0.5, surrender: 0.17 } },
    });
    expect(decision.targets.map((target) => target.name)).toEqual(['Kael', 'Mira']);
    expect(decision.targets[0]).toEqual({
      id: 'kael-id',
      name: 'Kael',
      probability: expect.closeTo(0.56, 5),
    });
    expect(decision.targets[1]?.probability).toBeCloseTo(0.44, 5);
    expect(decision.morale).toEqual({
      choice: 'flee',
      probabilities: { fight: 0.33, flee: 0.5, surrender: 0.17 },
    });
  });

  it('sin preguntar a quién atacan, nadie; y la moral solo con sus tres opciones', () => {
    const decision = enemyDecision(ambush, {
      morale: { choice: 'fight', probabilities: { fight: 0.9, flee: 0.1, dance: 0.5 } },
    });
    expect(decision).toEqual({
      targets: [],
      morale: { choice: 'fight', probabilities: { fight: 0.9, flee: 0.1, surrender: 0 } },
    });
  });
});
