import { OUTCOME_GUIDES, resolveOpposed, resolveTest } from '@dungeon-copilot/rules';
import { fixedDice } from '@dungeon-copilot/rules/testing';
import type { GameEventPayload, GameRoll } from '@dungeon-copilot/shared';
import { describe, expect, it } from 'vitest';
import {
  cleanIdeas,
  cleanRecap,
  cleanReply,
  cleanScene,
  complicationMessages,
  fit,
  hasLog,
  ideaMessages,
  npcGenerationMessages,
  parseNpcDraft,
  partialIdeas,
  recapMessages,
  sceneMessages,
  spokenReply,
  talkMessages,
  visibleIdeas,
  visibleRecap,
  visibleReply,
  visibleScene,
} from './prompts';

const campaign = {
  name: 'La Marca del Este',
  description: 'Fantasía medieval de frontera: pueblos aislados, bandidos y ruinas élficas.',
};

const brunilda = {
  name: 'Brunilda',
  concept: 'Posadera del Ciervo Blanco',
  appearance: '',
  personality: 'Desconfiada con los forasteros, generosa con quien paga',
  speech: 'Llama «cariño» a todo el mundo',
  goals: '',
  secrets: 'Esconde en el sótano a un desertor de la guardia',
};

describe('conversación con un PNJ', () => {
  it('le da al modelo su ficha, la campaña, la mesa y la escena', () => {
    const [system, ...turns] = talkMessages({
      campaign,
      npc: brunilda,
      characters: [
        { name: 'Kael', background: 'Acróbata huido de un circo' },
        { name: 'Mira', background: '' },
      ],
      scene: { title: 'El Ciervo Blanco', body: 'Humo, estofado y un bardo que desafina.' },
      history: [],
      input: 'Kael pregunta por un soldado herido',
    });
    expect(system?.role).toBe('system');
    const prompt = system?.content ?? '';
    expect(prompt).toContain('Eres Brunilda');
    expect(prompt).toContain('Quién es Brunilda: Posadera del Ciervo Blanco');
    expect(prompt).toContain('Cómo habla: Llama «cariño» a todo el mundo');
    expect(prompt).toContain('Qué oculta: Esconde en el sótano a un desertor de la guardia');
    expect(prompt).toContain('no cuenta lo que oculta');
    expect(prompt).toContain('entre corchetes');
    expect(prompt).toContain(campaign.description);
    expect(prompt).toContain('- Kael: Acróbata huido de un circo\n- Mira');
    expect(prompt).toContain('El Ciervo Blanco\nHumo, estofado y un bardo que desafina.');
    // Los campos vacíos no aparecen.
    expect(prompt).not.toContain('Aspecto:');
    expect(prompt).not.toContain('Qué quiere:');
    expect(turns).toEqual([{ role: 'user', content: 'Kael pregunta por un soldado herido' }]);
  });

  it('recuerda la conversación en turnos alternos que empiezan por la mesa', () => {
    const [, ...turns] = talkMessages({
      campaign,
      npc: brunilda,
      characters: [],
      history: [
        { role: 'npc', text: '¿Qué se os ofrece, cariño?' },
        { role: 'table', text: 'Mira pide una cerveza' },
        { role: 'table', text: 'Kael deja una moneda de oro en la barra' },
        { role: 'npc', text: 'Eso ya es otra cosa.' },
      ],
      input: '¿Has visto a un desertor?',
    });
    expect(turns).toEqual([
      { role: 'user', content: '[Empieza la escena]' },
      { role: 'assistant', content: '¿Qué se os ofrece, cariño?' },
      {
        role: 'user',
        content: 'Mira pide una cerveza\n\nKael deja una moneda de oro en la barra',
      },
      { role: 'assistant', content: 'Eso ya es otra cosa.' },
      { role: 'user', content: '¿Has visto a un desertor?' },
    ]);
  });

  it('sin nada que responder, el PNJ toma la palabra', () => {
    const messages = talkMessages({
      campaign,
      npc: brunilda,
      characters: [],
      history: [],
      input: ' ',
    });
    expect(messages.at(-1)).toEqual({
      role: 'user',
      content:
        '[Brunilda toma la palabra: saluda, sigue hablando o reacciona a lo último que ha pasado]',
    });
  });

  it('recorta los textos largos para que quepan en el contexto', () => {
    const [system, turn] = talkMessages({
      campaign: { name: 'Larga', description: 'a'.repeat(5000) },
      npc: brunilda,
      characters: [],
      history: [],
      input: 'b'.repeat(3000),
    });
    expect(system?.content).not.toContain('a'.repeat(2000));
    expect(system?.content).toContain(`${'a'.repeat(1999)}…`);
    expect(turn?.content).toHaveLength(1000);
    expect(fit('  corto  ', 10)).toBe('corto');
  });
});

describe('respuestas del modelo', () => {
  it('no enseña el razonamiento entre etiquetas <think>', () => {
    expect(visibleReply('')).toBe('');
    expect(visibleReply('<thi')).toBe('');
    expect(visibleReply('<think>A ver qué dice')).toBe('');
    expect(visibleReply('<think>A ver</think>\n\n¡Fuera de aquí!')).toBe('¡Fuera de aquí!');
    expect(visibleReply('  ¿Qué pasa?')).toBe('¿Qué pasa?');
    expect(visibleReply('<b>No es razonamiento')).toBe('<b>No es razonamiento');
  });

  it('quita el nombre del PNJ si el modelo lo pone delante', () => {
    expect(cleanReply('Brunilda: ¿Otra ronda?', 'Brunilda')).toBe('¿Otra ronda?');
    expect(cleanReply('**brunilda**: ¿Otra ronda? ', 'Brunilda')).toBe('¿Otra ronda?');
    expect(cleanReply('<think>…</think> Brunilda frunce el ceño.', 'Brunilda')).toBe(
      'Brunilda frunce el ceño.',
    );
    expect(cleanReply('Señor (el) Oscuro: Arrodíllate.', 'Señor (el) Oscuro')).toBe('Arrodíllate.');
  });

  it('mientras escribe, espera a ver si lo que empieza es su nombre', () => {
    const shown = (text: string) => spokenReply(text, 'Brunilda');
    expect(shown('Bru')).toBe('');
    expect(shown('**Brunilda** ')).toBe('');
    expect(shown('Brunilda: ¿Otra')).toBe('¿Otra');
    expect(shown('<think>…</think>brunilda: ¿Otra')).toBe('¿Otra');
    expect(shown('Brunilda se ríe')).toBe('Brunilda se ríe');
    expect(shown('*Frunce el ceño*')).toBe('*Frunce el ceño*');
    expect(shown('¿Otra ronda?')).toBe('¿Otra ronda?');
  });
});

describe('inventar un PNJ', () => {
  it('pide un PNJ que encaje en la campaña, con la idea del máster y sin repetir', () => {
    const [system, user] = npcGenerationMessages({
      campaign,
      idea: 'un herrero que trabaja para los bandidos',
      existing: ['Brunilda', 'Sargento Odo'],
    });
    expect(system?.content).toContain('objeto JSON');
    expect(system?.content).toContain('soldier (soldado: guardias, mercenarios, lobos.)');
    expect(user?.content).toContain(campaign.description);
    expect(user?.content).toContain('Brunilda, Sargento Odo');
    expect(user?.content).toContain('un herrero que trabaja para los bandidos');

    const [, surprise] = npcGenerationMessages({ campaign, idea: '', existing: [] });
    expect(surprise?.content).toContain('sorpréndele');
    expect(surprise?.content).not.toContain('ya tiene la campaña');
  });

  it('respeta lo que el máster ya ha rellenado y completa el resto', () => {
    const draft = { name: 'Brunilda', concept: '  ', secrets: 'Esconde a un desertor' };
    const [, user] = npcGenerationMessages({ campaign, idea: '', existing: [], draft });
    expect(user?.content).toContain(
      'mantenlo tal cual y completa el resto para que encaje:\n- name: Brunilda\n- secrets: Esconde a un desertor',
    );
    expect(user?.content).not.toContain('sorpréndele');

    const generated = JSON.stringify({
      name: 'Otra',
      concept: 'Posadera',
      secrets: 'Nada',
      profile: 'minion',
    });
    expect(parseNpcDraft(generated, { ...draft, profile: 'veteran' })).toMatchObject({
      name: 'Brunilda',
      concept: 'Posadera',
      secrets: 'Esconde a un desertor',
      profile: 'veteran',
    });
    // Si el modelo se deja el nombre que ya estaba decidido, vale el del máster.
    expect(parseNpcDraft('{"concept": "Posadera"}', { name: 'Brunilda' })?.name).toBe('Brunilda');
  });

  it('«no pelea» también es una decisión del máster; sin perfil, lo elige la IA', () => {
    const generated = JSON.stringify({ name: 'Odo', profile: 'soldier' });
    expect(parseNpcDraft(generated, { name: 'Odo', profile: null })?.profile).toBeNull();
    expect(parseNpcDraft(generated, { name: 'Odo' })?.profile).toBe('soldier');

    const draft = { name: 'Odo', profile: null };
    const [, user] = npcGenerationMessages({ campaign, idea: '', existing: [], draft });
    expect(user?.content).toContain('- name: Odo\n- profile: none');
  });

  it('lee el PNJ aunque venga con razonamiento o texto alrededor', () => {
    const json = JSON.stringify({
      name: 'Odo',
      concept: 'Herrero de Villarroble',
      appearance: 'Calvo, con quemaduras en los antebrazos',
      personality: 'Hosco',
      speech: 'Gruñe más que habla',
      goals: 'Pagar sus deudas',
      secrets: 'Forja armas para los bandidos',
      profile: 'soldier',
    });
    expect(
      parseNpcDraft(`<think>Pienso…</think>Aquí lo tienes: ${json} ¡Que lo disfrutes!`),
    ).toEqual({
      name: 'Odo',
      concept: 'Herrero de Villarroble',
      appearance: 'Calvo, con quemaduras en los antebrazos',
      personality: 'Hosco',
      speech: 'Gruñe más que habla',
      goals: 'Pagar sus deudas',
      secrets: 'Forja armas para los bandidos',
      profile: 'soldier',
    });
  });

  it('recorta lo que se pasa de largo y no inventa perfiles', () => {
    const draft = parseNpcDraft(
      JSON.stringify({ name: ' Odo ', concept: 'x'.repeat(300), profile: 'none', goals: 7 }),
    );
    expect(draft).toMatchObject({ name: 'Odo', profile: null, goals: '', secrets: '' });
    expect(draft?.concept).toHaveLength(160);
    expect(parseNpcDraft(JSON.stringify({ name: 'Odo', profile: 'dragon' }))?.profile).toBeNull();
  });

  it('sin nombre o sin JSON no hay PNJ', () => {
    expect(parseNpcDraft('No se me ocurre nada')).toBeNull();
    expect(parseNpcDraft('{"name": ')).toBeNull();
    expect(parseNpcDraft(JSON.stringify({ name: '  ', concept: 'Herrero' }))).toBeNull();
    expect(parseNpcDraft('[1, 2]')).toBeNull();
  });
});

describe('memoria de la campaña', () => {
  const recaps = [1, 2, 3, 4].map((number) => ({
    number,
    title: number === 4 ? 'La cripta' : '',
    recap: number === 3 ? 'c'.repeat(2000) : `Lo que pasó en la partida ${number}.`,
  }));

  it('el PNJ recuerda las tres últimas partidas, recortadas, y sabe que no lo vio todo', () => {
    const [system] = talkMessages({
      campaign,
      npc: brunilda,
      characters: [],
      recaps,
      history: [],
      input: '',
    });
    const prompt = system?.content ?? '';
    expect(prompt).toContain(
      'Lo que ha pasado en la campaña hasta ahora. Brunilda solo sabe lo que haya vivido o le hayan contado.',
    );
    expect(prompt).not.toContain('partida 1.');
    expect(prompt).toContain('Partida 2:\nLo que pasó en la partida 2.');
    expect(prompt).toContain(`Partida 3:\n${'c'.repeat(1199)}…`);
    expect(prompt).toContain('Partida 4, «La cripta»:\nLo que pasó en la partida 4.');
  });

  it('sin partidas resumidas no hay memoria; al inventar un PNJ también cuenta', () => {
    const [system] = talkMessages({
      campaign,
      npc: brunilda,
      characters: [],
      history: [],
      input: '',
    });
    expect(system?.content).not.toContain('Lo que ha pasado');
    const [, user] = npcGenerationMessages({ campaign, idea: '', existing: [], recaps });
    expect(user?.content).toContain(
      'Lo que ha pasado en la campaña hasta ahora:\n\nPartida 2:\nLo que pasó en la partida 2.',
    );
  });
});

describe('resumen de una partida', () => {
  const opposed: GameEventPayload = {
    kind: 'roll',
    roll: {
      actor: { label: 'Kael', characterId: 'kael', check: 'Esgrima' },
      target: { kind: 'opposed', label: 'Guardia veterano' },
      situation: 'melee',
      notes: [],
      result: {
        kind: 'opposed',
        ...resolveOpposed(
          { bonus: 5, edge: 'none' },
          { bonus: 4, edge: 'none' },
          fixedDice(6, 5, 1, 2),
        ),
      },
    },
  };
  const test = (label: string, difficulty: number, faces: number[]): GameEventPayload => ({
    kind: 'roll',
    roll: {
      actor: { label },
      target: { kind: 'difficulty', label: `Difícil (${difficulty})` },
      situation: 'test',
      notes: [],
      result: {
        kind: 'test',
        ...resolveTest({ bonus: 2, edge: 'none' }, difficulty, fixedDice(...faces)),
      },
    },
  });

  it('cuenta el registro en líneas, sin números de dados, con lo que añade el máster', () => {
    const events: GameEventPayload[] = [
      { kind: 'opened', number: 2, title: 'La cripta', luckRefilled: true },
      { kind: 'reveal', title: 'El Ciervo Blanco', body: 'Humo y estofado.' },
      { kind: 'speech', npcId: 'b', name: 'Brunilda', text: '¿Qué os pongo?' },
      opposed,
      test('Mira', 12, [1, 1]),
      { kind: 'note', text: 'El bardo es un espía' },
      { kind: 'reveal', title: '', body: 'La puerta cede.' },
      { kind: 'closed', xpAwarded: 2 },
    ];
    const [system, user] = recapMessages({
      campaign,
      characters: [{ name: 'Kael', background: 'Acróbata' }],
      game: { number: 2, title: 'La cripta' },
      previous: { number: 1, title: '', recap: 'Encontraron el mapa.' },
      events,
      hint: 'Kael se quedó con la llave',
    });
    expect(system?.content).toContain('no los cuentes');
    expect(user?.content).toBe(
      [
        `La campaña se llama «La Marca del Este». De qué va:\n${campaign.description}`,
        'Personajes de los jugadores:\n- Kael: Acróbata',
        'Resumen de la partida anterior (Partida 1):\nEncontraron el mapa.',
        [
          'Registro de la partida que hay que resumir (Partida 2, «La cripta»), de lo más antiguo a lo más reciente:',
          '- El máster cuenta («El Ciervo Blanco»): Humo y estofado.',
          '- Brunilda (PNJ) dice: «¿Qué os pongo?»',
          '- Tirada: Kael (Esgrima) contra Guardia veterano, cuerpo a cuerpo: éxito pleno para Kael.',
          '- Tirada: Mira, prueba difícil (12): pifia.',
          '- Nota del máster, que los jugadores no ven: El bardo es un espía',
          '- El máster cuenta: La puerta cede.',
        ].join('\n'),
        'Lo que añade el máster, que no está en el registro:\nKael se quedó con la llave',
        'Escribe el resumen.',
      ].join('\n\n'),
    );
    expect(hasLog(events)).toBe(true);
    expect(hasLog([events[0]!, events.at(-1)!])).toBe(false);
  });

  it('si el registro no cabe, quita antes las tiradas y luego lo más antiguo', () => {
    const reveals = Array.from({ length: 16 }, (_, index) => ({
      kind: 'reveal' as const,
      title: `Escena ${index + 1}`,
      body: 'x'.repeat(1000),
    }));
    const rolls = Array.from({ length: 30 }, () => test('Mira', 10, [3, 4]));
    const [, user] = recapMessages({
      campaign,
      characters: [],
      game: { number: 1, title: '' },
      events: reveals.flatMap((reveal, index) => [reveal, rolls[index]!, rolls[index + 14]!]),
      hint: '',
    });
    const prompt = user?.content ?? '';
    expect(prompt).not.toContain('Tirada');
    // Las 32 tiradas y las cuatro primeras escenas. Cada escena va recortada.
    expect(prompt).toContain('- (Faltan 36 líneas del registro, las menos importantes.)');
    expect(prompt).not.toContain('(«Escena 4»)');
    expect(prompt).toContain(`- El máster cuenta («Escena 5»): ${'x'.repeat(699)}…`);
    expect(prompt).toContain('(«Escena 16»)');
  });

  it('mientras escribe, espera a ver si empieza con un título y lo quita', () => {
    expect(visibleRecap('')).toBe('');
    expect(visibleRecap('Res')).toBe('');
    expect(visibleRecap('**Resumen de la partida')).toBe('');
    expect(visibleRecap('## La cripta\n')).toBe('');
    expect(visibleRecap('## La cripta\n\nKael bajó')).toBe('Kael bajó');
    expect(visibleRecap('Resumen: \nKael bajó')).toBe('Kael bajó');
    expect(visibleRecap('<think>…</think>**La cripta**\nKael')).toBe('Kael');
    expect(visibleRecap('Resumiendo, Kael')).toBe('Resumiendo, Kael');
    expect(visibleRecap('Kael bajó a la cripta')).toBe('Kael bajó a la cripta');
    expect(visibleRecap('**Kael** bajó\n')).toBe('**Kael** bajó\n');
  });

  it('al terminar, deja el texto limpio aunque no acabe en salto de línea', () => {
    expect(cleanRecap('Resumen de la partida 3:\n\nKael bajó.\n\nY volvió.  ')).toBe(
      'Kael bajó.\n\nY volvió.',
    );
    expect(
      cleanRecap('Resumen de lo que pasó en la cripta, que fue mucho y muy variado para todos'),
    ).toBe('Resumen de lo que pasó en la cripta, que fue mucho y muy variado para todos');
    expect(cleanRecap('**La cripta**')).toBe('');
    expect(cleanRecap('a'.repeat(5000))).toHaveLength(4000);
  });
});

describe('describir una escena', () => {
  it('convierte las notas del máster en una descripción, con la escena anterior', () => {
    const [system, user] = sceneMessages({
      campaign,
      characters: [{ name: 'Kael', background: 'Acróbata' }],
      scenes: [
        { title: 'El Ciervo Blanco', body: 'Humo y estofado.' },
        { title: '', body: 'Salís al callejón.' },
      ],
      title: 'La cripta',
      notes: 'escaleras húmedas, olor a tierra [hay un zombi dormido]',
    });
    expect(system?.content).toContain('segunda persona del plural');
    expect(system?.content).toContain('entre corchetes');
    expect(user?.content).toBe(
      [
        `La campaña se llama «La Marca del Este». De qué va:\n${campaign.description}`,
        'Personajes de los jugadores:\n- Kael: Acróbata',
        'Lo último que el máster ha enseñado a la mesa, de lo más antiguo a lo más reciente:\nEl Ciervo Blanco\nHumo y estofado.\n\nSalís al callejón.',
        'Título de la escena: La cripta',
        'Notas del máster para la descripción:\nescaleras húmedas, olor a tierra [hay un zombi dormido]',
        'Escribe la descripción.',
      ].join('\n\n'),
    );
  });

  it('con solo el título, y sin escenas anteriores, también', () => {
    const [, user] = sceneMessages({
      campaign,
      characters: [],
      scenes: [],
      title: 'El puerto de noche',
      notes: '',
    });
    expect(user?.content).not.toContain('Notas del máster');
    expect(user?.content).not.toContain('Lo último');
    expect(user?.content).toContain('Título de la escena: El puerto de noche\n\nEscribe');
  });

  it('quita el título que se inventa el modelo, también mientras escribe', () => {
    expect(visibleScene('Desc')).toBe('');
    expect(visibleScene('**La cripta**')).toBe('');
    expect(visibleScene('**La cripta**\n\nBajáis')).toBe('Bajáis');
    expect(visibleScene('Descripción de la escena:\nBajáis')).toBe('Bajáis');
    expect(visibleScene('DESCRIPCIÓN:\nBajáis')).toBe('Bajáis');
    expect(visibleScene('Descendéis por')).toBe('Descendéis por');
    expect(visibleScene('Ante vosotros')).toBe('Ante vosotros');
  });

  it('al terminar, quita las comillas que envuelven toda la descripción', () => {
    expect(cleanScene('«Ante vosotros se alza la cripta.»')).toBe(
      'Ante vosotros se alza la cripta.',
    );
    expect(cleanScene('"Ante vosotros."\n')).toBe('Ante vosotros.');
    expect(cleanScene('**La cripta**\n\n“Bajáis.”')).toBe('Bajáis.');
    // Si hay más comillas dentro, no son un envoltorio.
    expect(cleanScene('«Alto» grita el guardia. «Quietos»')).toBe(
      '«Alto» grita el guardia. «Quietos»',
    );
    expect(cleanScene('**La cripta**')).toBe('');
  });
});

describe('complicaciones de una tirada', () => {
  const roll = (outcome: 'partial' | 'failure' | 'fumble', faces: number[]): GameRoll => ({
    actor: { label: 'Kael', characterId: 'kael', check: 'Ganzúas' },
    target: { kind: 'difficulty', label: 'Normal (10)' },
    situation: 'test',
    notes: [],
    result: { kind: 'test', ...resolveTest({ bonus: 6, edge: 'none' }, 10, fixedDice(...faces)) },
  });

  it('pide tres ideas para lo que cuesta el éxito, con la escena y lo que se intentaba', () => {
    const partial = roll('partial', [1, 4]);
    expect(partial.result.outcome).toBe('partial');
    const [system, user] = complicationMessages({
      campaign,
      characters: [{ name: 'Kael', background: 'Acróbata' }],
      scenes: [{ title: 'El almacén', body: 'Cajas apiladas y un perro atado.' }],
      roll: partial,
      intent: 'forzar la puerta',
    });
    expect(system?.content).toContain('Es un éxito con coste');
    expect(system?.content).toContain(OUTCOME_GUIDES.test.partial);
    expect(system?.content).toContain('{"ideas": ["…", "…", "…"]}');
    expect(user?.content).toBe(
      [
        `La campaña se llama «La Marca del Este». De qué va:\n${campaign.description}`,
        'Personajes de los jugadores:\n- Kael: Acróbata',
        'Lo último que el máster ha enseñado a la mesa, de lo más antiguo a lo más reciente:\nEl almacén\nCajas apiladas y un perro atado.',
        'La tirada: Kael (Ganzúas), prueba normal (10): éxito con coste.',
        'Lo que intentaba Kael: forzar la puerta',
        'Propón tres complicaciones.',
      ].join('\n\n'),
    );
  });

  it('un fallo empeora la situación y una pifia trae un problema serio', () => {
    const failure = roll('failure', [1, 2]);
    const fumble = roll('fumble', [1, 1]);
    expect([failure.result.outcome, fumble.result.outcome]).toEqual(['failure', 'fumble']);
    const prompt = { campaign, characters: [], scenes: [], intent: '' };
    const [failed] = complicationMessages({ ...prompt, roll: failure });
    expect(failed?.content).toContain('Es un fallo');
    const [fumbled, user] = complicationMessages({ ...prompt, roll: fumble });
    expect(fumbled?.content).toContain('Es una pifia');
    expect(user?.content).not.toContain('Lo que intentaba');
  });

  it('va enseñando cada idea cuando termina, y solo crece', () => {
    const json =
      '{"ideas": ["El perro ladra \\"¡guau!\\".", "1. **Se rompe** la\\nganzúa.", "Llega la ronda.", "Sobra."]}';
    expect(partialIdeas('{"ideas": ["El perro')).toEqual([]);
    expect(partialIdeas(json.slice(0, 40))).toEqual(['El perro ladra "¡guau!".']);
    let shown = '';
    for (let end = 0; end <= json.length; end++) {
      const visible = visibleIdeas(json.slice(0, end));
      expect(visible.startsWith(shown)).toBe(true);
      shown = visible;
    }
    expect(shown).toBe('El perro ladra "¡guau!".\nSe rompe la ganzúa.\nLlega la ronda.\n');
    expect(cleanIdeas(json)).toBe('El perro ladra "¡guau!".\nSe rompe la ganzúa.\nLlega la ronda.');
  });

  it('si se corta o no responde en JSON, aprovecha lo que se entiende', () => {
    expect(cleanIdeas('{"ideas": ["Se rompe la ganzúa.", "Llega la ro')).toBe(
      'Se rompe la ganzúa.',
    );
    expect(cleanIdeas('<think>…</think>{"ideas": ["Uno."]}')).toBe('Uno.');
    expect(cleanIdeas('["Uno.", "Dos."]')).toBe('Uno.\nDos.');
    expect(cleanIdeas('Aquí tienes:\n1. Uno.\n2) **Dos**.\n- Tres.\n¿Quieres más?')).toBe(
      'Uno.\nDos.\nTres.',
    );
    expect(cleanIdeas('{"ideas": []}')).toBe('');
    expect(cleanIdeas('No sé qué decir.')).toBe('');
  });
});

describe('ideas para cuando la mesa se atasca', () => {
  it('pide tres cosas que pueden pasar, con la memoria de la campaña, sus PNJ y la escena', () => {
    const [system, user] = ideaMessages({
      campaign,
      characters: [{ name: 'Kael', background: 'Acróbata' }],
      recaps: [{ number: 2, title: 'La cripta', recap: 'Kael robó el cáliz del rey muerto.' }],
      npcs: [
        { name: 'Brunilda', concept: 'Posadera del Ciervo Blanco' },
        { name: 'El Tuerto', concept: ' ' },
      ],
      scenes: [{ title: 'El Ciervo Blanco', body: 'Humo, estofado y un bardo que desafina.' }],
      hint: ' algo que les meta prisa ',
    });
    expect(system?.content).toContain('un encuentro');
    expect(system?.content).toContain('un rumor o una pista');
    expect(system?.content).toContain('un giro');
    expect(system?.content).toContain('{"ideas": ["…", "…", "…"]}');
    expect(user?.content).toBe(
      [
        `La campaña se llama «La Marca del Este». De qué va:\n${campaign.description}`,
        'Lo que ha pasado en la campaña hasta ahora:',
        'Partida 2, «La cripta»:\nKael robó el cáliz del rey muerto.',
        'Personajes de los jugadores:\n- Kael: Acróbata',
        'PNJ de la campaña:\n- Brunilda: Posadera del Ciervo Blanco\n- El Tuerto',
        'Lo último que el máster ha enseñado a la mesa, de lo más antiguo a lo más reciente:\nEl Ciervo Blanco\nHumo, estofado y un bardo que desafina.',
        'Lo que busca el máster: algo que les meta prisa',
        'Propón tres cosas que pueden pasar ahora.',
      ].join('\n\n'),
    );
  });

  it('sin nada más que la campaña, pide igual', () => {
    const [, user] = ideaMessages({
      campaign,
      characters: [],
      recaps: [],
      npcs: [],
      scenes: [],
      hint: '',
    });
    expect(user?.content).toBe(
      [
        `La campaña se llama «La Marca del Este». De qué va:\n${campaign.description}`,
        'Propón tres cosas que pueden pasar ahora.',
      ].join('\n\n'),
    );
  });

  it('quita las etiquetas que pone el modelo, pero no una frase que empieza igual', () => {
    const json = JSON.stringify({
      ideas: [
        'Encuentro: un mensajero pregunta por Kael.',
        '**Giro:** se apagan las velas.',
        'Idea 3: llueve.',
        'Un rumor corre por la sala: el conde ha muerto.',
      ],
    });
    expect(cleanIdeas(json)).toBe('Un mensajero pregunta por Kael.\nSe apagan las velas.\nLlueve.');
    expect(cleanIdeas('{"ideas": ["Pista 2: huellas de barro.", "Rumor corre: nada."]}')).toBe(
      'Huellas de barro.\nRumor corre: nada.',
    );
    expect(visibleIdeas('{"ideas": ["Precio: pierdes la bolsa."')).toBe('Pierdes la bolsa.\n');
  });
});
