import { NPC_PROFILE_IDS } from '@dungeon-copilot/rules';
import { z } from 'zod';

/** Longitudes máximas de un PNJ. También acotan cuánto texto se le pasa a la IA. */
export const NPC_LIMITS = { name: 80, concept: 160, text: 600 } as const;

const npcText = (field: string, max: number = NPC_LIMITS.text) =>
  z.string().trim().max(max, `El campo «${field}» no puede pasar de ${max} caracteres`);

const npcFields = {
  name: z
    .string()
    .trim()
    .min(1, 'El PNJ necesita un nombre')
    .max(NPC_LIMITS.name, `El nombre no puede pasar de ${NPC_LIMITS.name} caracteres`),
  /** Quién es, en una línea: "Posadera del Ciervo Blanco". */
  concept: npcText('Quién es', NPC_LIMITS.concept),
  appearance: npcText('Aspecto'),
  personality: npcText('Carácter'),
  speech: npcText('Cómo habla'),
  goals: npcText('Qué quiere'),
  /** Solo lo ve el máster. La IA lo sabe, pero el PNJ no lo cuenta sin motivo. */
  secrets: npcText('Qué oculta'),
  /** Perfil del reglamento para tirar por él si hay pelea; null si no pelea. */
  profile: z.enum(NPC_PROFILE_IDS).nullable(),
};

export const npcSchema = z.object({
  name: npcFields.name,
  concept: npcFields.concept.default(''),
  appearance: npcFields.appearance.default(''),
  personality: npcFields.personality.default(''),
  speech: npcFields.speech.default(''),
  goals: npcFields.goals.default(''),
  secrets: npcFields.secrets.default(''),
  profile: npcFields.profile.default(null),
});

export type NpcRequest = z.input<typeof npcSchema>;

/** Lo que describe a un PNJ. Es también lo que devuelve la IA cuando se lo inventa. */
export type NpcDraft = z.output<typeof npcSchema>;

export const updateNpcSchema = z
  .object({
    name: npcFields.name.optional(),
    concept: npcFields.concept.optional(),
    appearance: npcFields.appearance.optional(),
    personality: npcFields.personality.optional(),
    speech: npcFields.speech.optional(),
    goals: npcFields.goals.optional(),
    secrets: npcFields.secrets.optional(),
    profile: npcFields.profile.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'No hay nada que cambiar',
  });

export type UpdateNpcRequest = z.input<typeof updateNpcSchema>;

/** Los PNJ son del máster: los jugadores no los ven. */
export interface NpcView extends NpcDraft {
  id: string;
  campaignId: string;
  createdAt: string;
  updatedAt: string;
}

export const generateNpcSchema = z.object({
  /** Lo que tiene en mente el máster: "una posadera que esconde algo". Vacío: sorpresa. */
  idea: z.string().trim().max(500, 'La idea no puede pasar de 500 caracteres').default(''),
  /** Lo que el máster ya ha rellenado: la IA lo respeta y completa el resto. */
  draft: z
    .object({
      name: npcText('Nombre', NPC_LIMITS.name),
      concept: npcFields.concept,
      appearance: npcFields.appearance,
      personality: npcFields.personality,
      speech: npcFields.speech,
      goals: npcFields.goals,
      secrets: npcFields.secrets,
      profile: npcFields.profile,
    })
    .partial()
    .default({}),
});

export type GenerateNpcRequest = z.input<typeof generateNpcSchema>;

/** Frases de la conversación que se le recuerdan a la IA en cada respuesta. */
export const TALK_MEMORY = 16;

/** Una frase de la conversación con un PNJ: lo que dice o hace la mesa, o lo que responde él. */
export const talkLineSchema = z.object({
  role: z.enum(['table', 'npc']),
  text: z.string().trim().min(1).max(4000),
});

export type TalkLine = z.output<typeof talkLineSchema>;

export const talkSchema = z.object({
  /** Partida desde la que se habla: da a la IA la escena que está viendo la mesa. */
  gameId: z.uuid().optional(),
  history: z
    .array(talkLineSchema)
    .max(TALK_MEMORY, `Solo se recuerdan las últimas ${TALK_MEMORY} frases`)
    .default([]),
  /** Lo que dicen o hacen los personajes. Vacío: el PNJ toma la palabra. */
  input: z.string().trim().max(1000, 'El texto no puede pasar de 1000 caracteres').default(''),
});

export type TalkRequest = z.input<typeof talkSchema>;

/**
 * La respuesta de un PNJ llega en directo, una línea JSON por trozo: "delta" con el texto
 * nuevo según lo escribe la IA, y al final "done" con la respuesta entera ya limpia, o "error".
 */
export type TalkChunk =
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; error: string };

/** Si el servidor tiene IA (Ollama) y con qué modelo. */
export interface AiStatus {
  enabled: boolean;
  model: string | null;
}
