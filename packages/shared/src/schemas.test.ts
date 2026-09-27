import { describe, expect, it } from 'vitest';
import { registerRequestSchema, usernameSchema } from './auth';
import { joinCampaignSchema, updateCampaignSchema } from './campaigns';
import { advanceSchema, awardXpSchema, updateCharacterSchema } from './characters';

describe('cuentas', () => {
  it('guarda el usuario en minúsculas y sin espacios alrededor', () => {
    expect(usernameSchema.parse('  Edu_Master ')).toBe('edu_master');
  });

  it('rechaza usuarios con espacios, tildes o demasiado cortos', () => {
    for (const username of ['ed', 'edu master', 'máster']) {
      expect(usernameSchema.safeParse(username).success).toBe(false);
    }
  });

  it('pide una contraseña de al menos 8 caracteres', () => {
    const result = registerRequestSchema.safeParse({
      username: 'edu',
      displayName: 'Edu',
      password: 'corta',
    });
    expect(result.success).toBe(false);
  });
});

describe('campañas', () => {
  it('acepta el código de invitación en minúsculas y con espacios', () => {
    expect(joinCampaignSchema.parse({ inviteCode: ' k7px3m ' })).toEqual({ inviteCode: 'K7PX3M' });
    expect(joinCampaignSchema.safeParse({ inviteCode: 'K7PX' }).success).toBe(false);
  });

  it('un cambio de campaña tiene que cambiar algo', () => {
    expect(updateCampaignSchema.safeParse({}).success).toBe(false);
    expect(updateCampaignSchema.parse({ description: '' })).toEqual({ description: '' });
  });
});

describe('fichas', () => {
  it('la Suerte va de 0 a 3 y un cambio vacío no vale', () => {
    expect(updateCharacterSchema.safeParse({ luck: 3 }).success).toBe(true);
    expect(updateCharacterSchema.safeParse({ luck: 4 }).success).toBe(false);
    expect(updateCharacterSchema.safeParse({}).success).toBe(false);
  });

  it('dar 0 PX no tiene sentido; quitar sí se puede', () => {
    expect(awardXpSchema.safeParse({ amount: 0 }).success).toBe(false);
    expect(awardXpSchema.parse({ amount: -2 })).toEqual({ amount: -2 });
  });

  it('las mejoras de atributo solo aceptan los cinco atributos', () => {
    expect(advanceSchema.safeParse({ kind: 'raiseAttribute', attribute: 'strength' }).success).toBe(
      true,
    );
    expect(advanceSchema.safeParse({ kind: 'raiseAttribute', attribute: 'luck' }).success).toBe(
      false,
    );
  });
});
