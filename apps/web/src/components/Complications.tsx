import type { GameDetail, GameEvent } from '@dungeon-copilot/shared';
import { api } from '../api';
import { AiIdeas } from './Ideas';

/**
 * Ideas de la IA para lo que pasa tras un éxito con coste, un fallo o una pifia. Solo las ve
 * el máster: las cuenta él, o las enseña a la mesa tal cual o retocadas.
 */
export function Complications({
  game,
  event,
}: {
  game: GameDetail;
  event: GameEvent & { kind: 'roll' };
}) {
  const actor = event.roll.actor.label;
  return (
    <AiIdeas
      game={game}
      openLabel="Proponer complicaciones"
      label={`Complicaciones para ${actor}`}
      ideaLabel="Complicación"
      hint={{
        label: `Qué intentaba ${actor}, para afinar (opcional)`,
        placeholder: 'Forzar la puerta del almacén sin que los oigan',
      }}
      ask={(intent, options) => api.complications(game.id, event.id, { intent }, options)}
    />
  );
}
