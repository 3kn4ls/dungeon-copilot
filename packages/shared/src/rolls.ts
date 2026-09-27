import type { OpposedResult, TestResult } from '@dungeon-copilot/rules';
import { z } from 'zod';

const edgeSchema = z.enum(['none', 'advantage', 'disadvantage']).default('none');

const checkSchema = z.object({
  bonus: z.number().int().min(-10).max(30),
  edge: edgeSchema,
});

/** Petición de tirada al servidor. Las tiradas se resuelven en el servidor para que todos vean la misma. */
export const rollRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('test'),
    check: checkSchema,
    difficulty: z.number().int().min(2).max(40),
  }),
  z.object({
    kind: z.literal('opposed'),
    actor: checkSchema,
    opponent: checkSchema,
  }),
]);

export type RollRequest = z.input<typeof rollRequestSchema>;

export type RollResponse = ({ kind: 'test' } & TestResult) | ({ kind: 'opposed' } & OpposedResult);
