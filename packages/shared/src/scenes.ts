import { defaultSkillCatalog, type SkillCatalog } from '@dungeon-copilot/rules';
import { z } from 'zod';
import type { GameEvent, GameEventKind } from './games';

// Las escenas y lo que dura en ellas. El máster empieza una con `scene`, que termina la anterior;
// lo que se usa una vez por escena vuelve con ella, y lo que se usa una vez por sesión, con la
// partida siguiente. Un personaje gasta una técnica con `ability` o, Esquiva prodigiosa, al
// recibir un golpe (`damage` con `dodged`).

/** El máster empieza una escena nueva. Con `recover`, los personajes recuperan el aliento. */
export const startSceneSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Pon un título a la escena')
    .max(120, 'El título no puede pasar de 120 caracteres'),
  recover: z.boolean().default(true),
});

export type StartSceneRequest = z.input<typeof startSceneSchema>;

/** Un personaje usa una técnica que se gasta: su jugador o el máster por él. */
export const useAbilitySchema = z.object({
  characterId: z.uuid('Elige un personaje'),
  skill: z.string().min(1, 'Elige qué técnica usa'),
});

export type UseAbilityRequest = z.input<typeof useAbilitySchema>;

/** Los eventos que dicen qué técnicas se han gastado. */
export const USE_EVENT_KINDS = ['scene', 'ability', 'damage'] as const satisfies GameEventKind[];

export type SceneEvent = GameEvent & { kind: 'scene' };

/** La escena en juego: la última que empezó el máster, o null si aún no ha empezado ninguna. */
export function currentScene(events: readonly GameEvent[]): SceneEvent | null {
  return events.findLast((event): event is SceneEvent => event.kind === 'scene') ?? null;
}

/** Las técnicas que ya no puede usar cada personaje, por su id: los ids de las técnicas. */
export type SpentAbilities = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Qué técnicas ha gastado cada personaje: las de una vez por escena, en la escena en juego; las
 * de una vez por sesión, en toda la partida.
 */
export function spentAbilities(
  events: readonly GameEvent[],
  catalog: SkillCatalog = defaultSkillCatalog,
): SpentAbilities {
  const spent = new Map<string, Set<string>>();
  const spend = (characterId: string, skill: string) =>
    spent.set(characterId, new Set([...(spent.get(characterId) ?? []), skill]));
  for (const event of events) {
    if (event.kind === 'ability') spend(event.characterId, event.skill);
    if (event.kind === 'damage' && event.dodged && event.target.kind === 'character') {
      spend(event.target.id, 'uncanny-dodge');
    }
    if (event.kind === 'scene') {
      // Lo de una vez por escena vuelve con la escena nueva.
      for (const [characterId, skills] of spent) {
        const kept = [...skills].filter((id) => {
          const skill = catalog.get(id);
          return !(skill?.tier === 'advanced' && skill.limit === 'scene');
        });
        spent.set(characterId, new Set(kept));
      }
    }
  }
  return spent;
}

export const isSpent = (spent: SpentAbilities, characterId: string, skill: string): boolean =>
  spent.get(characterId)?.has(skill) ?? false;
