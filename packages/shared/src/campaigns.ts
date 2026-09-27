import { z } from 'zod';

export const MEMBER_ROLES = ['master', 'player'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const ROLE_LABELS: Record<MemberRole, string> = {
  master: 'Máster',
  player: 'Jugador',
};

/** Los códigos de invitación evitan letras y números que se confunden (O y 0, I y 1). */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 6;

const campaignName = z
  .string()
  .trim()
  .min(1, 'La campaña necesita un nombre')
  .max(100, 'El nombre no puede pasar de 100 caracteres');
const campaignDescription = z
  .string()
  .trim()
  .max(5000, 'La descripción no puede pasar de 5000 caracteres');

export const createCampaignSchema = z.object({
  name: campaignName,
  description: campaignDescription.default(''),
});

export type CreateCampaignRequest = z.input<typeof createCampaignSchema>;

export const updateCampaignSchema = z
  .object({ name: campaignName.optional(), description: campaignDescription.optional() })
  .refine((body) => body.name !== undefined || body.description !== undefined, {
    message: 'No hay nada que cambiar',
  });

export type UpdateCampaignRequest = z.input<typeof updateCampaignSchema>;

export const joinCampaignSchema = z.object({
  inviteCode: z
    .string()
    .trim()
    .toUpperCase()
    .length(INVITE_CODE_LENGTH, `El código tiene ${INVITE_CODE_LENGTH} caracteres`),
});

export type JoinCampaignRequest = z.input<typeof joinCampaignSchema>;

export interface CampaignSummary {
  id: string;
  name: string;
  description: string;
  /** Papel de quien pregunta en esta campaña. */
  role: MemberRole;
  memberCount: number;
  characterCount: number;
  createdAt: string;
}

export interface CampaignMember {
  userId: string;
  username: string;
  displayName: string;
  role: MemberRole;
  joinedAt: string;
}

export interface CampaignDetail {
  id: string;
  name: string;
  description: string;
  role: MemberRole;
  /** Solo lo ve el máster, que es quien invita. */
  inviteCode?: string;
  members: CampaignMember[];
  createdAt: string;
  updatedAt: string;
}
