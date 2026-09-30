import { describe, expect, it } from 'vitest';
import type { GameEvent, GameEventPayload } from './games';
import {
  currentScene,
  isSpent,
  spentAbilities,
  startSceneSchema,
  useAbilitySchema,
} from './scenes';

const KAEL = '8b9f2a4e-1c2d-4e5f-9a8b-7c6d5e4f3a2b';
const MIRA = '1f0e2d3c-4b5a-4968-8776-655443322110';

const event = (id: number, payload: GameEventPayload): GameEvent => ({
  ...payload,
  id,
  gameId: 'partida',
  visibility: 'public',
  authorName: 'Edu',
  createdAt: '2026-09-30T20:00:00.000Z',
});

const scene = (id: number, title: string) => event(id, { kind: 'scene', title, recovered: [] });

const uses = (id: number, characterId: string, skill: string) =>
  event(id, { kind: 'ability', characterId, name: 'Alguien', skill, label: skill });

describe('las escenas', () => {
  it('se empiezan con un título y, si no se dice otra cosa, recuperando el aliento', () => {
    expect(startSceneSchema.parse({ title: ' El camino del norte ' })).toEqual({
      title: 'El camino del norte',
      recover: true,
    });
    expect(startSceneSchema.safeParse({ title: ' ' }).error?.issues[0]?.message).toBe(
      'Pon un título a la escena',
    );
  });

  it('la escena en juego es la última que empezó el máster', () => {
    expect(currentScene([])).toBeNull();
    const events = [
      scene(1, 'La posada'),
      uses(2, KAEL, 'commanding-voice'),
      scene(3, 'El bosque'),
    ];
    expect(currentScene(events)?.title).toBe('El bosque');
  });
});

describe('las técnicas que se gastan', () => {
  it('para usar una hay que decir quién y cuál', () => {
    expect(useAbilitySchema.safeParse({ characterId: KAEL, skill: 'scholar' }).success).toBe(true);
    expect(useAbilitySchema.safeParse({ characterId: KAEL, skill: '' }).success).toBe(false);
  });

  it('las de una vez por escena vuelven con la escena siguiente', () => {
    const events = [scene(1, 'La posada'), uses(2, KAEL, 'commanding-voice')];
    expect(isSpent(spentAbilities(events), KAEL, 'commanding-voice')).toBe(true);
    expect(isSpent(spentAbilities(events), MIRA, 'commanding-voice')).toBe(false);
    const later = [...events, scene(3, 'El bosque')];
    expect(isSpent(spentAbilities(later), KAEL, 'commanding-voice')).toBe(false);
  });

  it('las de una vez por sesión duran toda la partida', () => {
    const events = [uses(1, MIRA, 'scholar'), scene(2, 'La cripta'), scene(3, 'La salida')];
    expect(isSpent(spentAbilities(events), MIRA, 'scholar')).toBe(true);
  });

  it('Esquiva prodigiosa se gasta al recibir el golpe', () => {
    const dodged = event(2, {
      kind: 'damage',
      amount: 1,
      dodged: true,
      target: {
        kind: 'character',
        id: MIRA,
        name: 'Mira',
        before: { scratches: 0, severity: 'none' },
        after: { scratches: 1, severity: 'none' },
        lethal: false,
      },
    });
    const events = [scene(1, 'La emboscada'), dodged];
    expect(isSpent(spentAbilities(events), MIRA, 'uncanny-dodge')).toBe(true);
    expect(
      isSpent(spentAbilities([...events, scene(3, 'El campamento')]), MIRA, 'uncanny-dodge'),
    ).toBe(false);
  });
});
