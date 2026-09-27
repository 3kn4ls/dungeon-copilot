import {
  NPC_PROFILES,
  NPC_PROFILE_IDS,
  OUTCOME_GUIDES,
  OUTCOME_LABELS,
  SITUATION_LABELS,
  needsComplication,
  type ComplicationOutcome,
} from '@dungeon-copilot/rules';
import {
  NPC_LIMITS,
  RECAP_MAX,
  REVEAL_MAX,
  type GameEventPayload,
  type GameRoll,
  type GameRollSide,
  type NpcDraft,
  type TalkLine,
} from '@dungeon-copilot/shared';
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

/** Una partida anterior con su resumen: lo que la IA recuerda de la campaña. */
export interface PromptRecap {
  number: number;
  title: string;
  recap: string;
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
const RECAP_CHARS = 1200;
/** Resúmenes de partidas anteriores que se le recuerdan a la IA. */
export const MEMORY_RECAPS = 3;

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

/** "Partida 3, «La cripta del rey»", o solo "Partida 3" si no tiene título. */
function gameLabel(game: { number: number; title: string }): string {
  const title = game.title.trim();
  return title ? `Partida ${game.number}, «${title}»` : `Partida ${game.number}`;
}

/** Lo que ha pasado en las últimas partidas, de la más antigua a la más reciente. */
function memoryBlock(recaps: PromptRecap[], intro: string): string {
  const games = recaps
    .slice(-MEMORY_RECAPS)
    .map((game) => `${gameLabel(game)}:\n${fit(game.recap, RECAP_CHARS)}`);
  return games.length > 0 ? [intro, ...games].join('\n\n') : '';
}

const partyLines = (characters: PromptCharacter[]) =>
  characters
    .slice(0, MAX_CHARACTERS)
    .map((c) => (c.background.trim() ? `- ${c.name}: ${c.background.trim()}` : `- ${c.name}`));

/** Solo las líneas con contenido: un PNJ recién creado puede tener casi todo vacío. */
const describe = (lines: [label: string, value: string][]) =>
  lines.filter(([, value]) => value.trim() !== '').map(([label, value]) => `${label}: ${value}`);

export interface TalkPrompt {
  campaign: PromptCampaign;
  npc: PromptNpc;
  characters: PromptCharacter[];
  /** Resúmenes de las partidas anteriores, de la más antigua a la más reciente. */
  recaps?: PromptRecap[];
  scene?: PromptScene | undefined;
  history: TalkLine[];
  /** Lo que dicen o hacen los personajes. Vacío: el PNJ toma la palabra. */
  input: string;
}

/** Mensajes para que el modelo responda como el PNJ a lo que le dice la mesa. */
export function talkMessages(prompt: TalkPrompt): AiMessage[] {
  const { campaign, npc, characters, recaps = [], scene, history, input } = prompt;
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
    memoryBlock(
      recaps,
      `Lo que ha pasado en la campaña hasta ahora. ${name} solo sabe lo que haya vivido o le hayan contado.`,
    ),
  ];
  const party = partyLines(characters);
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

/** "Brunilda:" o "**Brunilda**:" al principio, como en un guion. */
const speakerPrefix = (name: string) =>
  new RegExp(`^[*_]*${escapeRegExp(name)}[*_]*\\s*:\\s*`, 'i');

/** Si lo escrito hasta ahora aún puede acabar siendo "Brunilda:". */
function mayBeSpeaker(text: string, name: string): boolean {
  const rest = text.replace(/^[*_]+/, '').toLowerCase();
  const lower = name.toLowerCase();
  if (lower.startsWith(rest)) return true;
  return rest.startsWith(lower) && /^[*_]*\s*$/.test(rest.slice(lower.length));
}

/**
 * Lo que se puede enseñar de la respuesta del PNJ mientras se escribe: sin razonamiento ni su
 * nombre delante. Mientras el principio aún puede ser su nombre, espera a ver si sigue ":".
 */
export function spokenReply(text: string, name: string): string {
  const visible = visibleReply(text);
  const prefix = speakerPrefix(name).exec(visible);
  if (prefix) return visible.slice(prefix[0].length);
  return mayBeSpeaker(visible, name) ? '' : visible;
}

/** La respuesta del PNJ lista para guardar: sin razonamiento ni su nombre delante. */
export function cleanReply(text: string, name: string): string {
  return visibleReply(text).trim().replace(speakerPrefix(name), '').trim();
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

/**
 * Lo que el máster ya ha rellenado de un PNJ: la IA lo respeta y completa el resto. En
 * `profile`, null es «no pelea»; si no viene, lo elige la IA.
 */
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
  /** Resúmenes de las partidas anteriores, de la más antigua a la más reciente. */
  recaps?: PromptRecap[];
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
  const profile = prompt.draft?.profile;
  if (profile !== undefined) decided.push(`- profile: ${profile ?? 'none'}`);
  const user = [
    campaignBlock(prompt.campaign),
    memoryBlock(prompt.recaps ?? [], 'Lo que ha pasado en la campaña hasta ahora:'),
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
    profile:
      draft.profile !== undefined
        ? draft.profile
        : (NPC_PROFILE_IDS.find((id) => id === record.profile) ?? null),
  };
}

// Topes del registro que se resume: con el resto del mensaje, tiene que caber en el contexto
// del modelo sin hacerle leer tanto que tarde minutos en una máquina sin GPU.
const LOG_CHARS = 9000;
const LOG_LINE_CHARS = 700;
const HINT_CHARS = 1000;

export interface RecapPrompt {
  campaign: PromptCampaign;
  characters: PromptCharacter[];
  game: { number: number; title: string };
  /** La partida anterior con su resumen, para seguir el hilo. */
  previous?: PromptRecap | undefined;
  /** Registro de la partida, del más antiguo al más reciente, solo con lo que puede ver la IA. */
  events: GameEventPayload[];
  /** Lo que añade el máster: lo que se jugó de palabra o lo que quiere destacar. */
  hint: string;
}

/** "Kael (Esgrima)", o solo el nombre si no tira con nada concreto. */
const sideText = (side: GameRollSide) =>
  side.check ? `${side.label} (${side.check})` : side.label;

/** Una tirada contada en una línea, sin los números: quién, contra qué y cómo salió. */
function rollText(roll: GameRoll): string {
  const outcome = OUTCOME_LABELS[roll.result.outcome].toLowerCase();
  const situation =
    roll.situation === 'test' ? '' : `, ${SITUATION_LABELS[roll.situation].toLowerCase()}`;
  if (roll.target.kind === 'difficulty') {
    return `${sideText(roll.actor)}, prueba ${roll.target.label.toLowerCase()}${situation}: ${outcome}.`;
  }
  return `${sideText(roll.actor)} contra ${sideText(roll.target)}${situation}: ${outcome} para ${roll.actor.label}.`;
}

/** Una línea del registro, con lo que importa para el resumen por si hay que recortar. */
function logLine(event: GameEventPayload): { text: string; weight: number } | null {
  switch (event.kind) {
    case 'opened':
    case 'closed':
      return null;
    case 'reveal': {
      const title = event.title.trim();
      const body = fit(event.body, LOG_LINE_CHARS);
      return { text: `- El máster cuenta${title ? ` («${title}»)` : ''}: ${body}`, weight: 2 };
    }
    case 'note':
      return {
        text: `- Nota del máster, que los jugadores no ven: ${fit(event.text, LOG_LINE_CHARS)}`,
        weight: 2,
      };
    case 'speech':
      return {
        text: `- ${event.name} (PNJ) dice: «${fit(event.text, LOG_LINE_CHARS)}»`,
        weight: 1,
      };
    case 'roll':
      return { text: `- Tirada: ${rollText(event.roll)}`, weight: 0 };
  }
}

/** Si el registro tiene algo que contar, más allá de cuándo empezó y terminó la partida. */
export const hasLog = (events: GameEventPayload[]) =>
  events.some((event) => logLine(event) !== null);

/** Lo que cabe del registro. Si sobra, se quitan antes las tiradas y, luego, lo más antiguo. */
function fitLog(events: GameEventPayload[]): string[] {
  const lines = events.flatMap((event, index) => {
    const line = logLine(event);
    return line ? [{ ...line, index }] : [];
  });
  let size = lines.reduce((sum, line) => sum + line.text.length + 1, 0);
  const dropped = new Set<number>();
  const expendable = [...lines].sort((a, b) => a.weight - b.weight || a.index - b.index);
  for (const line of expendable) {
    if (size <= LOG_CHARS) break;
    dropped.add(line.index);
    size -= line.text.length + 1;
  }
  const kept = lines.filter((line) => !dropped.has(line.index)).map((line) => line.text);
  if (dropped.size > 0) {
    kept.unshift(`- (Faltan ${dropped.size} líneas del registro, las menos importantes.)`);
  }
  return kept;
}

/** Mensajes para que el modelo resuma una partida a partir de su registro. */
export function recapMessages(prompt: RecapPrompt): AiMessage[] {
  const system = [
    'Ayudas a un máster de rol a llevar la crónica de su campaña. Con el registro de una partida escribes, en español, el resumen que leerán los jugadores para recordar lo que pasó.',
    [
      '- Cuéntalo en pasado y en tercera persona, como una crónica: qué hicieron los personajes, a quién conocieron, qué descubrieron y cómo quedó todo al final.',
      '- De uno a tres párrafos cortos, sin títulos ni listas: 250 palabras como mucho.',
      '- Cuenta solo lo que dicen el registro y el máster. No inventes hechos, nombres ni lugares.',
      '- No hables de dados, tiradas ni reglas: cuenta lo que supusieron, como quién ganó una pelea o qué salió mal.',
      '- Las notas del máster te ayudan a entender lo que pasó, pero pueden guardar secretos que los personajes no conocen: no los cuentes.',
      '- Si queda algo pendiente, termina con ello.',
    ].join('\n'),
  ].join('\n\n');

  const { game, previous } = prompt;
  const party = partyLines(prompt.characters);
  const log = fitLog(prompt.events);
  const hint = fit(prompt.hint, HINT_CHARS);
  const user = [
    campaignBlock(prompt.campaign),
    party.length > 0 ? `Personajes de los jugadores:\n${party.join('\n')}` : '',
    previous
      ? `Resumen de la partida anterior (${gameLabel(previous)}):\n${fit(previous.recap, RECAP_CHARS)}`
      : '',
    log.length > 0
      ? `Registro de la partida que hay que resumir (${gameLabel(game)}), de lo más antiguo a lo más reciente:\n${log.join('\n')}`
      : `La partida que hay que resumir (${gameLabel(game)}) no tiene nada en el registro.`,
    hint ? `Lo que añade el máster, que no está en el registro:\n${hint}` : '',
    'Escribe el resumen.',
  ].filter(Boolean);

  return [
    { role: 'system', content: system },
    { role: 'user', content: user.join('\n\n') },
  ];
}

/**
 * Quita el título que a veces se inventa el modelo en su propia línea al principio («## La
 * cripta», «**La traición**» o «Resumen:», con las palabras que se le den). Sirve para el
 * texto a medio escribir: mientras la primera línea aún puede ser un título, espera a que acabe.
 */
function headingStripper(words: readonly string[]): (text: string) => string {
  const heading = new RegExp(
    `^(?:#{1,6}[^\\n]*|\\*\\*[^*\\n]+\\*\\*:?|(?:${words.join('|')})\\b[^.\\n]{0,60}:?)[ \\t]*\\n+`,
    'i',
  );
  return (text) => {
    const found = heading.exec(text);
    if (found) return text.slice(found[0].length);
    if (text.includes('\n')) return text;
    const lower = text.toLowerCase();
    const mayBeHeading =
      /^[#*]/.test(text) || words.some((word) => lower.startsWith(word) || word.startsWith(lower));
    return mayBeHeading ? '' : text;
  };
}

const withoutRecapHeading = headingStripper(['resumen']);

/**
 * Lo que se puede enseñar del resumen mientras se escribe: sin razonamiento ni título. Si el
 * principio aún puede ser un título, espera a que termine la línea.
 */
export function visibleRecap(text: string): string {
  return withoutRecapHeading(visibleReply(text));
}

/** El resumen terminado, listo para que lo retoque el máster. */
export function cleanRecap(text: string): string {
  // Terminado, la primera línea ya no puede seguir: si no es un título, es el resumen.
  return fit(visibleRecap(`${text.trimEnd()}\n`), RECAP_MAX);
}

const NOTES_CHARS = 2000;
const INTENT_CHARS = 300;
/** Lo último que ha enseñado el máster que se le da a la IA para que sepa dónde están. */
export const RECENT_SCENES = 2;

/** Las últimas escenas que ha enseñado el máster, de la más antigua a la más reciente. */
function scenesBlock(scenes: PromptScene[]): string {
  const texts = scenes.map((scene) =>
    [scene.title.trim(), fit(scene.body, SCENE_CHARS)].filter(Boolean).join('\n'),
  );
  return texts.length > 0
    ? `Lo último que el máster ha enseñado a la mesa, de lo más antiguo a lo más reciente:\n${texts.join('\n\n')}`
    : '';
}

export interface ScenePrompt {
  campaign: PromptCampaign;
  characters: PromptCharacter[];
  /** Lo último que ha enseñado el máster, de lo más antiguo a lo más reciente. */
  scenes: PromptScene[];
  /** El título que el máster le ha puesto a la escena, si tiene. */
  title: string;
  /** Lo que quiere describir, en notas rápidas. */
  notes: string;
}

/** Mensajes para que el modelo convierta las notas del máster en la descripción de una escena. */
export function sceneMessages(prompt: ScenePrompt): AiMessage[] {
  const system = [
    'Ayudas a un máster de rol a describir lo que tienen delante los jugadores. Con sus notas escribes, en español, la descripción que el máster enseñará a la mesa.',
    [
      '- En presente y hablando a los personajes, en segunda persona del plural: «Ante vosotros se alza…».',
      '- De dos a cinco frases, 120 palabras como mucho, sin títulos ni listas.',
      '- Usa lo que dicen las notas y dale vida con detalles de los sentidos (lo que se ve, se oye, se huele) que encajen con la ambientación.',
      '- No añadas personajes, peligros ni pistas que no estén en las notas. No decidas lo que hacen, dicen o sienten los personajes de los jugadores.',
      '- Lo que va entre corchetes son indicaciones del máster para ti: tenlas en cuenta, pero no las cuentes.',
      '- No termines preguntando qué hacen: eso ya lo pregunta el máster.',
    ].join('\n'),
  ].join('\n\n');

  const party = partyLines(prompt.characters);
  const title = prompt.title.trim();
  const notes = fit(prompt.notes, NOTES_CHARS);
  const user = [
    campaignBlock(prompt.campaign),
    party.length > 0 ? `Personajes de los jugadores:\n${party.join('\n')}` : '',
    scenesBlock(prompt.scenes),
    title ? `Título de la escena: ${title}` : '',
    notes ? `Notas del máster para la descripción:\n${notes}` : '',
    'Escribe la descripción.',
  ].filter(Boolean);

  return [
    { role: 'system', content: system },
    { role: 'user', content: user.join('\n\n') },
  ];
}

const withoutSceneHeading = headingStripper(['descripción', 'descripcion']);

/** Lo que se puede enseñar de la descripción mientras se escribe: sin razonamiento ni título. */
export function visibleScene(text: string): string {
  return withoutSceneHeading(visibleReply(text));
}

/** Comillas que envuelven la descripción entera, como un texto para leer en voz alta. */
const QUOTED = /^(?:«([^«»]*)»|"([^"]*)"|“([^“”]*)”)$/;

/** La descripción terminada, lista para que la retoque el máster. */
export function cleanScene(text: string): string {
  const scene = visibleScene(`${text.trimEnd()}\n`).trim();
  const quoted = QUOTED.exec(scene);
  return fit(quoted ? (quoted[1] ?? quoted[2] ?? quoted[3] ?? '') : scene, REVEAL_MAX);
}

export interface ComplicationPrompt {
  campaign: PromptCampaign;
  characters: PromptCharacter[];
  /** Lo último que ha enseñado el máster, de lo más antiguo a lo más reciente. */
  scenes: PromptScene[];
  /** Una tirada con un resultado que pide complicación (ver needsComplication). */
  roll: GameRoll;
  /** Lo que intentaba quien tiraba, si el máster lo cuenta. */
  intent: string;
}

/** Qué pide cada resultado, dicho para la IA. */
const COMPLICATION_KINDS: Record<ComplicationOutcome, string> = {
  partial:
    'Es un éxito con coste: lo consigue, pero pagando un precio. La complicación no deshace el éxito.',
  failure: 'Es un fallo: no lo consigue y además la situación empeora.',
  fumble: 'Es una pifia: falla estrepitosamente y aparece un problema serio.',
};

/** Cuántas ideas se piden y se enseñan. */
const IDEAS = 3;

/** Formato de la respuesta con ideas (JSON Schema, lo impone Ollama). */
export const IDEAS_FORMAT = {
  type: 'object',
  properties: { ideas: { type: 'array', items: { type: 'string' } } },
  required: ['ideas'],
} as const;

/** Mensajes para que el modelo proponga complicaciones a una tirada que ha salido a medias o mal. */
export function complicationMessages(prompt: ComplicationPrompt): AiMessage[] {
  const { roll } = prompt;
  const outcome = needsComplication(roll.result.outcome) ? roll.result.outcome : 'partial';
  const system = [
    'Ayudas a un máster de rol a improvisar. Una tirada acaba de salir a medias o mal y el máster necesita ideas para lo que pasa ahora. Propones tres complicaciones, en español.',
    [
      `- ${COMPLICATION_KINDS[outcome]}`,
      `- Lo que dice el reglamento de este resultado: ${OUTCOME_GUIDES[roll.situation][outcome]}`,
      '- Cada complicación, en una o dos frases, contada como algo que pasa en la escena y lista para que el máster la narre.',
      '- Que sean distintas entre sí: por ejemplo, un precio que pagar, un peligro nuevo y una posición peor.',
      '- Que encajen con la escena, la ambientación y lo que se intentaba. No decidas lo que hacen, dicen o sienten los personajes de los jugadores.',
      '- El resultado es de quien tira: si tira un PNJ, la complicación es suya.',
      '- Responde solo con un JSON así: {"ideas": ["…", "…", "…"]}',
    ].join('\n'),
  ].join('\n\n');

  const party = partyLines(prompt.characters);
  const intent = fit(prompt.intent, INTENT_CHARS);
  const user = [
    campaignBlock(prompt.campaign),
    party.length > 0 ? `Personajes de los jugadores:\n${party.join('\n')}` : '',
    scenesBlock(prompt.scenes),
    `La tirada: ${rollText(roll)}`,
    intent ? `Lo que intentaba ${roll.actor.label}: ${intent}` : '',
    'Propón tres complicaciones.',
  ].filter(Boolean);

  return [
    { role: 'system', content: system },
    { role: 'user', content: user.join('\n\n') },
  ];
}

/**
 * Las ideas ya terminadas de un JSON {"ideas": ["…", "…"]} a medio escribir, en orden: cada
 * una aparece cuando se cierran sus comillas.
 */
export function partialIdeas(text: string): string[] {
  const start = text.indexOf('[');
  if (start === -1) return [];
  const ideas: string[] = [];
  let at = start + 1;
  for (;;) {
    while (at < text.length && /[\s,]/.test(text.charAt(at))) at++;
    if (text.charAt(at) !== '"') return ideas;
    let end = at + 1;
    while (end < text.length && text.charAt(end) !== '"') end += text.charAt(end) === '\\' ? 2 : 1;
    if (end >= text.length) return ideas;
    try {
      const idea: unknown = JSON.parse(text.slice(at, end + 1));
      if (typeof idea === 'string') ideas.push(idea);
    } catch {
      return ideas;
    }
    at = end + 1;
  }
}

/** Una idea en una línea, sin numeración, viñetas ni negritas. */
const cleanIdea = (idea: string) =>
  idea
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:\d+[.)]|[-*•])\s*/, '')
    .trim();

/** Una línea de lista («1. …», «- …»), por si el modelo no ha respondido en JSON. */
const LIST_ITEM = /^\s*(?:\d+[.)]|[-*•])\s+\S/;

/**
 * Lo que se puede enseñar de las ideas mientras se escriben: las terminadas, una por línea.
 * Una idea no aparece hasta que está entera, así que lo enseñado solo crece.
 */
export function visibleIdeas(text: string): string {
  return partialIdeas(visibleReply(text))
    .map(cleanIdea)
    .filter(Boolean)
    .slice(0, IDEAS)
    .map((idea) => `${idea}\n`)
    .join('');
}

/** Las ideas terminadas, una por línea. Vacío si no ha dicho nada que se entienda. */
export function cleanIdeas(text: string): string {
  const visible = visibleReply(text);
  // Las mismas que se veían mientras escribía, también si se cortó a medias; si el modelo no
  // ha respondido en JSON, las de una lista normal.
  let ideas = partialIdeas(visible);
  if (ideas.length === 0) ideas = visible.split('\n').filter((line) => LIST_ITEM.test(line));
  return ideas.map(cleanIdea).filter(Boolean).slice(0, IDEAS).join('\n');
}
