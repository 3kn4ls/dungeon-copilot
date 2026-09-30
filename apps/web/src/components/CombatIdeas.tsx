import type { GameDetail, GameEvent, NpcCombatant } from '@dungeon-copilot/shared';
import { api } from '../api';
import { AiIdeas } from './Ideas';

/**
 * La IA propone cómo contar el golpe de una tirada de combate, con lo que ha causado. Solo lo ve
 * el máster: lo cuenta él, o lo enseña a la mesa tal cual o retocado.
 */
export function BlowNarration({
  game,
  event,
}: {
  game: GameDetail;
  event: GameEvent & { kind: 'roll' };
}) {
  const actor = event.roll.blow?.attacker.name ?? event.roll.actor.label;
  return (
    <AiIdeas
      game={game}
      openLabel="Narrar el golpe con IA"
      label={`Cómo contar el golpe de ${actor}`}
      ideaLabel="Narración"
      hint={{
        label: 'Qué quieres destacar (opcional)',
        placeholder: 'Que retroceda hacia el fuego',
      }}
      ask={(hint, options) => api.narrateBlow(game.id, event.id, { hint }, options)}
    />
  );
}

/** La IA propone qué pueden hacer unos PNJ en su turno, sabiendo cómo va el combate. */
export function EnemyTactics({ game, enemy }: { game: GameDetail; enemy: NpcCombatant }) {
  return (
    <AiIdeas
      game={game}
      openLabel={`¿Qué hace ${enemy.name}? Pide ideas a la IA`}
      label={`Ideas para ${enemy.name}`}
      ideaLabel="Idea"
      hint={{ label: 'Qué buscas, para afinar (opcional)', placeholder: 'Que intenten huir' }}
      ask={(hint, options) => api.tactics(game.id, { combatantId: enemy.id, hint }, options)}
    />
  );
}
