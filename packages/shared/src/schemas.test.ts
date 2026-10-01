import { describe, expect, it } from 'vitest';
import { registerRequestSchema, usernameSchema } from './auth';
import { joinCampaignSchema, updateCampaignSchema } from './campaigns';
import {
  advanceSchema,
  awardXpSchema,
  createCharacterSchema,
  updateCharacterSchema,
} from './characters';
import { enemyDecisionSchema } from './decisions';
import {
  complicationsSchema,
  gameRollSchema,
  ideasSchema,
  narrationSchema,
  openGameSchema,
  revealDraftSchema,
  revealSchema,
  speechSchema,
  tacticsSchema,
} from './games';
import { TALK_MEMORY, generateNpcSchema, npcSchema, talkSchema, updateNpcSchema } from './npcs';

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

  it('sin decir lo que lleva, un personaje lleva un arma media', () => {
    const build = {
      name: 'Kael',
      attributes: { strength: 4, dexterity: 3, charisma: 1, intelligence: 2, endurance: 2 },
    };
    expect(createCharacterSchema.parse(build).gear).toEqual({
      melee: { name: '', weapon: 'medium' },
      ranged: null,
      armor: 'none',
      shield: false,
    });
    const gear = { melee: { name: 'Mandoble', weapon: 'heavy' }, armor: 'heavy', shield: true };
    expect(updateCharacterSchema.parse({ gear })).toEqual({
      gear: { ...gear, ranged: null },
    });
    expect(updateCharacterSchema.safeParse({ gear: { armor: 'light' } }).success).toBe(false);
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

describe('partidas', () => {
  it('al abrir, sin título y con la Suerte llena por defecto', () => {
    expect(openGameSchema.parse({})).toEqual({ title: '', refillLuck: true });
    expect(revealSchema.safeParse({ title: 'Nada', body: '  ' }).success).toBe(false);
  });

  it('una tirada necesita quién tira y contra qué', () => {
    const actor = { kind: 'character', characterId: '5f0c3b7e-9a2d-4c1e-8b6f-0a3d2c1b4e5f' };
    expect(gameRollSchema.parse({ actor, target: { kind: 'difficulty', difficulty: 10 } })).toEqual(
      {
        actor: { ...actor, modifier: 0, edge: 'none' },
        target: { kind: 'difficulty', difficulty: 10 },
        situation: 'test',
        secret: false,
      },
    );
    expect(gameRollSchema.safeParse({ actor }).success).toBe(false);
    const nameless = { kind: 'free', label: ' ', bonus: 4 };
    const opposed = { actor, target: { kind: 'opposed', opponent: nameless } };
    expect(gameRollSchema.safeParse(opposed).success).toBe(false);
  });

  it('en combate, una tirada puede decir quién ataca a quién', () => {
    const actor = { kind: 'character', characterId: '5f0c3b7e-9a2d-4c1e-8b6f-0a3d2c1b4e5f' };
    const target = { kind: 'difficulty', difficulty: 10 };
    const blow = {
      attackerId: '5f0c3b7e-9a2d-4c1e-8b6f-0a3d2c1b4e5f',
      defenderId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    };
    expect(gameRollSchema.parse({ actor, target, blow }).blow).toEqual(blow);
    const half = gameRollSchema.safeParse({ actor, target, blow: { attackerId: blow.attackerId } });
    expect(half.error?.issues.map((issue) => issue.message)).toEqual(['Di a quién ataca']);
  });

  it('para describir una escena, la IA necesita unas notas o al menos el título', () => {
    expect(revealDraftSchema.parse({ notes: ' posada, de noche ' })).toEqual({
      title: '',
      notes: 'posada, de noche',
    });
    expect(revealDraftSchema.parse({ title: 'La cripta' })).toEqual({
      title: 'La cripta',
      notes: '',
    });
    const empty = revealDraftSchema.safeParse({ title: ' ', notes: ' ' });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues.map((issue) => issue.path)).toEqual([['notes']]);
  });

  it('las complicaciones no necesitan saber qué se intentaba', () => {
    expect(complicationsSchema.parse({})).toEqual({ intent: '' });
    expect(complicationsSchema.safeParse({ intent: 'a'.repeat(301) }).success).toBe(false);
  });

  it('para narrar un golpe o qué hacen los PNJ, lo que busca el máster es opcional', () => {
    expect(narrationSchema.parse({})).toEqual({ hint: '' });
    const combatantId = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    expect(tacticsSchema.parse({ combatantId })).toEqual({ combatantId, hint: '' });
    expect(tacticsSchema.safeParse({ hint: 'huir' }).success).toBe(false);
  });

  it('las ideas para seguir no necesitan saber qué busca el máster', () => {
    expect(ideasSchema.parse({})).toEqual({ hint: '' });
    expect(ideasSchema.parse({ hint: ' algo que les meta prisa ' })).toEqual({
      hint: 'algo que les meta prisa',
    });
    expect(ideasSchema.safeParse({ hint: 'a'.repeat(301) }).success).toBe(false);
  });
});

describe('PNJ', () => {
  it('solo el nombre es obligatorio y sin perfil no pelea', () => {
    expect(npcSchema.parse({ name: ' Brunilda ' })).toEqual({
      name: 'Brunilda',
      concept: '',
      appearance: '',
      personality: '',
      speech: '',
      goals: '',
      secrets: '',
      profile: null,
    });
    expect(npcSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(npcSchema.safeParse({ name: 'Brunilda', profile: 'dragon' }).success).toBe(false);
  });

  it('un cambio solo toca lo que trae, y quitar el perfil también cuenta', () => {
    expect(updateNpcSchema.parse({ secrets: 'Esconde a un desertor' })).toEqual({
      secrets: 'Esconde a un desertor',
    });
    expect(updateNpcSchema.parse({ profile: null })).toEqual({ profile: null });
    expect(updateNpcSchema.safeParse({}).success).toBe(false);
  });

  it('para inventar un PNJ basta con nada, o con lo que ya se haya rellenado', () => {
    expect(generateNpcSchema.parse({})).toEqual({ idea: '', draft: {} });
    expect(generateNpcSchema.parse({ draft: { name: '', concept: ' Herrero ' } })).toEqual({
      idea: '',
      draft: { name: '', concept: 'Herrero' },
    });
  });

  it('la conversación recuerda un número acotado de frases', () => {
    expect(talkSchema.parse({})).toEqual({ history: [], input: '' });
    const line = { role: 'table', text: 'Hola' };
    const long = { history: Array.from({ length: TALK_MEMORY + 1 }, () => line) };
    expect(talkSchema.safeParse(long).success).toBe(false);
    expect(talkSchema.safeParse({ history: [{ role: 'master', text: 'Hola' }] }).success).toBe(
      false,
    );
  });

  it('lo que dice un PNJ en la partida no puede estar vacío', () => {
    const npcId = '5f0c3b7e-9a2d-4c1e-8b6f-0a3d2c1b4e5f';
    expect(speechSchema.safeParse({ npcId, text: '   ' }).success).toBe(false);
    expect(speechSchema.parse({ npcId, text: ' ¿Qué queréis? ' })).toEqual({
      npcId,
      text: '¿Qué queréis?',
    });
  });
});

describe('sugerencias de la IA', () => {
  it('qué hacen unos PNJ: de quién, y por defecto también a quién atacan', () => {
    const combatantId = '5f0c3b7e-9a2d-4c1e-8b6f-0a3d2c1b4e5f';
    expect(enemyDecisionSchema.parse({ combatantId })).toEqual({ combatantId, targets: true });
    expect(enemyDecisionSchema.parse({ combatantId, targets: false })).toEqual({
      combatantId,
      targets: false,
    });
    expect(enemyDecisionSchema.safeParse({}).success).toBe(false);
    expect(enemyDecisionSchema.safeParse({ combatantId: 'bandidos' }).success).toBe(false);
  });
});
