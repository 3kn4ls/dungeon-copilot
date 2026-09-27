import { describe, expect, it } from 'vitest';
import {
  cleanReply,
  fit,
  npcGenerationMessages,
  parseNpcDraft,
  spokenReply,
  talkMessages,
  visibleReply,
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
