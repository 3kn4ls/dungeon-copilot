import { NPC_PROFILES, NPC_PROFILE_IDS } from '@dungeon-copilot/rules';
import { NPC_LIMITS, type NpcDraft, type TalkLine } from '@dungeon-copilot/shared';
import type { AiMessage } from './ollama';

export interface PromptCampaign {
  name: string;
  description: string;
}

export interface PromptCharacter {
  name: string;
  background: string;
}

/** Lo último que el máster ha enseñado a la mesa: dónde están y qué ven. */
export interface PromptScene {
  title: string;
  body: string;
}

type PromptNpc = Pick<
  NpcDraft,
  'name' | 'concept' | 'appearance' | 'personality' | 'speech' | 'goals' | 'secrets'
>;

// Topes para que todo quepa en el contexto del modelo junto con la conversación.
const CAMPAIGN_CHARS = 2000;
const SCENE_CHARS = 800;
const LINE_CHARS = 1000;
const MAX_CHARACTERS = 8;
const MAX_EXISTING_NPCS = 30;

/** Recorta un texto largo, marcando con puntos suspensivos que sigue. */
export function fit(text: string, max: number): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function campaignBlock(campaign: PromptCampaign): string {
  const description = fit(campaign.description, CAMPAIGN_CHARS);
  return description
    ? `La campaña se llama «${campaign.name}». De qué va:\n${description}`
    : `La campaña se llama «${campaign.name}»; el máster no ha descrito su ambientación.`;
}

/** Solo las líneas con contenido: un PNJ recién creado puede tener casi todo vacío. */
const describe = (lines: [label: string, value: string][]) =>
  lines.filter(([, value]) => value.trim() !== '').map(([label, value]) => `${label}: ${value}`);

export interface TalkPrompt {
  campaign: PromptCampaign;
  npc: PromptNpc;
  characters: PromptCharacter[];
  scene?: PromptScene | undefined;
  history: TalkLine[];
  /** Lo que dicen o hacen los personajes. Vacío: el PNJ toma la palabra. */
  input: string;
}

/** Mensajes para que el modelo responda como el PNJ a lo que le dice la mesa. */
export function talkMessages(prompt: TalkPrompt): AiMessage[] {
  const { campaign, npc, characters, scene, history, input } = prompt;
  const name = npc.name;
  const sections = [
    `Eres ${name}, un personaje no jugador (PNJ) de una partida de rol, y el máster habla por tu boca.`,
    [
      `- Responde solo con lo que dice ${name}, en primera persona y en español. Si ayuda, añade un gesto breve entre asteriscos.`,
      '- Frases cortas, como en una conversación en la mesa: de una a cuatro.',
      '- No narres lo que hacen los personajes de los jugadores ni decidas por ellos.',
      `- Los mensajes que recibes son lo que dicen o hacen los personajes, contado por el máster. Lo que va entre corchetes son indicaciones del máster para ti: síguelas, pero ${name} no las oye.`,
      `- ${name} no cuenta lo que oculta salvo que le obliguen, le convenga o el máster lo pida.`,
    ].join('\n'),
    describe([
      [`Quién es ${name}`, npc.concept],
      ['Aspecto', npc.appearance],
      ['Carácter', npc.personality],
      ['Cómo habla', npc.speech],
      ['Qué quiere', npc.goals],
      ['Qué oculta', npc.secrets],
    ]).join('\n'),
    campaignBlock(campaign),
  ];
  const party = characters
    .slice(0, MAX_CHARACTERS)
    .map((c) => (c.background.trim() ? `- ${c.name}: ${c.background.trim()}` : `- ${c.name}`));
  if (party.length > 0) sections.push(`Personajes de los jugadores:\n${party.join('\n')}`);
  if (scene) {
    const text = [scene.title.trim(), fit(scene.body, SCENE_CHARS)].filter(Boolean).join('\n');
    sections.push(`Lo último que el máster ha descrito a la mesa:\n${text}`);
  }

  const lines: TalkLine[] = [
    ...history,
    {
      role: 'table',
      text:
        input.trim() ||
        `[${name} toma la palabra: saluda, sigue hablando o reacciona a lo último que ha pasado]`,
    },
  ];
  // Los modelos esperan turnos alternos que empiecen por la mesa: se juntan los seguidos.
  const turns: AiMessage[] = [];
  for (const line of lines) {
    const role = line.role === 'table' ? 'user' : 'assistant';
    const content = fit(line.text, LINE_CHARS);
    const last = turns.at(-1);
    if (last?.role === role) last.content += `\n\n${content}`;
    else turns.push({ role, content });
  }
  if (turns[0]?.role === 'assistant')
    turns.unshift({ role: 'user', content: '[Empieza la escena]' });

  return [{ role: 'system', content: sections.filter(Boolean).join('\n\n') }, ...turns];
}

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

/**
 * Lo que se puede enseñar de una respuesta a medio escribir. Algunos modelos razonan antes
 * de contestar entre etiquetas <think>; eso no es parte de lo que dice el PNJ.
 */
export function visibleReply(text: string): string {
  const start = text.trimStart();
  // Vacío o "<thi…": aún no se sabe si empieza a razonar.
  if (THINK_OPEN.startsWith(start)) return '';
  if (!start.startsWith(THINK_OPEN)) return start;
  const end = start.indexOf(THINK_CLOSE);
  return end === -1 ? '' : start.slice(end + THINK_CLOSE.length).trimStart();
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** La respuesta del PNJ lista para guardar: sin razonamiento ni su nombre delante. */
export function cleanReply(text: string, name: string): string {
  const prefix = new RegExp(`^[*_]*${escapeRegExp(name)}[*_]*\\s*:\\s*`, 'i');
  return visibleReply(text).trim().replace(prefix, '').trim();
}

/** Formato de la respuesta al inventar un PNJ (JSON Schema, lo impone Ollama). */
export const NPC_DRAFT_FORMAT = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    concept: { type: 'string' },
    appearance: { type: 'string' },
    personality: { type: 'string' },
    speech: { type: 'string' },
    goals: { type: 'string' },
    secrets: { type: 'string' },
    profile: { type: 'string', enum: ['none', ...NPC_PROFILE_IDS] },
  },
  required: [
    'name',
    'concept',
    'appearance',
    'personality',
    'speech',
    'goals',
    'secrets',
    'profile',
  ],
} as const;

/** Lo que el máster ya ha rellenado de un PNJ: la IA lo respeta y completa el resto. */
export type PartialNpc = Partial<Record<Exclude<keyof NpcDraft, 'profile'>, string>> & {
  profile?: NpcDraft['profile'] | undefined;
};

const NPC_TEXT_KEYS = [
  'name',
  'concept',
  'appearance',
  'personality',
  'speech',
  'goals',
  'secrets',
] as const;

export interface NpcGenerationPrompt {
  campaign: PromptCampaign;
  /** Lo que tiene en mente el máster. Vacío: sorpresa. */
  idea: string;
  /** Nombres de los PNJ que ya tiene la campaña, para no repetir. */
  existing: string[];
  draft?: PartialNpc;
}

/** Mensajes para que el modelo invente un PNJ que encaje en la campaña. */
export function npcGenerationMessages(prompt: NpcGenerationPrompt): AiMessage[] {
  const profiles = NPC_PROFILE_IDS.map((id) => {
    const info = NPC_PROFILES[id];
    return `${id} (${info.label.toLowerCase()}: ${info.description.toLowerCase()})`;
  }).join(', ');
  const system = [
    'Ayudas a un máster de rol a preparar su campaña. Creas personajes no jugadores (PNJ) memorables, fáciles de interpretar en la mesa, que encajan en la ambientación y dan juego a los jugadores. Escribes en español.',
    [
      'Respondes solo con un objeto JSON con estos campos:',
      '- name: nombre propio que encaje en la ambientación.',
      '- concept: quién es en pocas palabras, con su oficio o su papel. Por ejemplo: «Posadera del Ciervo Blanco».',
      '- appearance: su aspecto en una o dos frases, con un detalle fácil de recordar.',
      '- personality: su carácter en una o dos frases.',
      '- speech: cómo habla (tono, muletillas, acento) en una frase.',
      '- goals: qué quiere ahora mismo, en una frase.',
      '- secrets: algo que oculta y que puede dar juego, en una frase.',
      `- profile: lo peligroso que es si hay pelea. none si no pelea, o uno de estos: ${profiles}.`,
    ].join('\n'),
  ].join('\n\n');

  const existing = prompt.existing.slice(0, MAX_EXISTING_NPCS);
  const decided = NPC_TEXT_KEYS.flatMap((key) => {
    const value = prompt.draft?.[key]?.trim();
    return value ? [`- ${key}: ${value}`] : [];
  });
  if (prompt.draft?.profile) decided.push(`- profile: ${prompt.draft.profile}`);
  const user = [
    campaignBlock(prompt.campaign),
    existing.length > 0
      ? `PNJ que ya tiene la campaña (inventa uno distinto): ${existing.join(', ')}.`
      : '',
    decided.length > 0
      ? `El máster ya ha decidido esto; mantenlo tal cual y completa el resto para que encaje:\n${decided.join('\n')}`
      : '',
    prompt.idea.trim()
      ? `Lo que busca el máster: ${prompt.idea.trim()}`
      : decided.length > 0
        ? ''
        : 'El máster no ha dado ninguna idea: sorpréndele con un PNJ que encaje en la campaña.',
  ].filter(Boolean);

  return [
    { role: 'system', content: system },
    { role: 'user', content: user.join('\n\n') },
  ];
}

/**
 * Lee el PNJ que ha inventado el modelo. Es tolerante: recorta lo que se pasa de largo e
 * ignora un perfil que no existe. Lo que el máster ya había rellenado se queda como estaba.
 * Devuelve null si no hay por dónde cogerlo.
 */
export function parseNpcDraft(content: string, draft: PartialNpc = {}): NpcDraft | null {
  const text = visibleReply(content);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const field = (key: (typeof NPC_TEXT_KEYS)[number], max: number = NPC_LIMITS.text) => {
    const decided = draft[key]?.trim();
    if (decided) return decided;
    const value = record[key];
    return typeof value === 'string' ? fit(value, max) : '';
  };

  const name = field('name', NPC_LIMITS.name);
  if (!name) return null;
  return {
    name,
    concept: field('concept', NPC_LIMITS.concept),
    appearance: field('appearance'),
    personality: field('personality'),
    speech: field('speech'),
    goals: field('goals'),
    secrets: field('secrets'),
    profile: draft.profile ?? NPC_PROFILE_IDS.find((id) => id === record.profile) ?? null,
  };
}
