import {
  ATTRIBUTES,
  LUCK_PER_SESSION,
  characterBuildSchema,
  type Attributes,
  type Severity,
} from '@dungeon-copilot/rules';
import { z } from 'zod';

/** Crear un personaje: el reparto de creación del reglamento. */
export const createCharacterSchema = characterBuildSchema;

export type CreateCharacterRequest = z.input<typeof createCharacterSchema>;

export const updateCharacterSchema = z
  .object({
    name: characterBuildSchema.shape.name.optional(),
    background: z.string().trim().max(200).optional(),
    luck: z.number().int().min(0).max(LUCK_PER_SESSION).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'No hay nada que cambiar',
  });

export type UpdateCharacterRequest = z.input<typeof updateCharacterSchema>;

export const damageSchema = z.object({
  amount: z.number().int().min(1, 'El daño mínimo es 1').max(20),
});

export type DamageRequest = z.input<typeof damageSchema>;

export const recoverSchema = z.object({
  /** "scratches": recuperar el aliento tras la escena. "severity": descanso o cuidados. */
  kind: z.enum(['scratches', 'severity']),
});

export type RecoverRequest = z.input<typeof recoverSchema>;

export const awardXpSchema = z.object({
  /** Negativo para corregir un reparto equivocado. */
  amount: z
    .number()
    .int()
    .min(-100)
    .max(100)
    .refine((amount) => amount !== 0, 'Indica cuántos PX'),
});

export type AwardXpRequest = z.input<typeof awardXpSchema>;

export const advanceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('raiseSkill'), skill: z.string().min(1) }),
  z.object({ kind: z.literal('learnAdvanced'), skill: z.string().min(1) }),
  z.object({ kind: z.literal('raiseAttribute'), attribute: z.enum(ATTRIBUTES) }),
]);

export type AdvanceRequest = z.input<typeof advanceSchema>;

export interface CharacterView {
  id: string;
  campaignId: string;
  ownerId: string;
  ownerName: string;
  name: string;
  background: string;
  attributes: Attributes;
  skills: Record<string, number>;
  advancedSkills: string[];
  wounds: { scratches: number; severity: Severity; scratchBoxes: number };
  luck: number;
  xp: number;
  createdAt: string;
  updatedAt: string;
  /** Quien pregunta puede tocar la ficha: su dueño o el máster. */
  canEdit: boolean;
  /** Solo el máster reparte experiencia. */
  canAwardXp: boolean;
}

export interface DamageResponse {
  character: CharacterView;
  /** El golpe mata al personaje salvo que gaste un punto de Suerte. */
  lethal: boolean;
}
