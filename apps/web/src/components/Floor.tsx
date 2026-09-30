import type { CharacterView, Floor, GameDetail, GiveFloorRequest } from '@dungeon-copilot/shared';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api';
import { useStoreGameEvent } from '../queries';
import { ErrorNote } from './ui';

/** Si la palabra es de alguno de estos personajes: suya, o de toda la mesa. */
export function holdsFloor(floor: Floor, characterIds: readonly string[]): boolean {
  if (floor.kind === 'table') return true;
  return floor.kind === 'character' && characterIds.includes(floor.characterId);
}

/**
 * Quién tiene la palabra, para un jugador: el máster narra, la mesa entera o un personaje.
 * Destaca cuando es suya.
 */
export function FloorStatus({
  floor,
  characterIds,
}: {
  floor: Floor;
  /** Los personajes de quien mira. */
  characterIds: readonly string[];
}) {
  const yours = holdsFloor(floor, characterIds);
  let text: string;
  if (floor.kind === 'master') text = 'Narra el máster. Si quieres intervenir, pide la palabra.';
  else if (floor.kind === 'table') text = '¿Qué hacéis? La palabra es de la mesa.';
  else if (yours) text = `Tienes la palabra: ${floor.name}.`;
  else text = `Tiene la palabra ${floor.name}.`;
  return (
    <p className={yours ? 'floor-status yours' : 'floor-status'} aria-live="polite">
      {text}
    </p>
  );
}

/** El máster da la palabra: se la queda él para narrar, a toda la mesa o a un personaje. */
export function FloorControl({
  game,
  floor,
  characters,
}: {
  game: GameDetail;
  floor: Floor;
  characters: CharacterView[];
}) {
  const storeEvent = useStoreGameEvent(game.id);
  const give = useMutation({
    mutationFn: (to: GiveFloorRequest['to']) => api.giveFloor(game.id, { to }),
    onSuccess: storeEvent,
  });
  const choose = (to: GiveFloorRequest['to'], current: boolean) => {
    if (!current && !give.isPending) give.mutate(to);
  };
  const options: { key: string; label: string; to: GiveFloorRequest['to']; current: boolean }[] = [
    { key: 'master', label: 'Narro yo', to: { kind: 'master' }, current: floor.kind === 'master' },
    { key: 'table', label: 'La mesa', to: { kind: 'table' }, current: floor.kind === 'table' },
    ...characters.map((character) => ({
      key: character.id,
      label: character.name,
      to: { kind: 'character' as const, characterId: character.id },
      current: floor.kind === 'character' && floor.characterId === character.id,
    })),
  ];

  return (
    <div className="field">
      <span className="field-label" id="floor-control-label">
        Quién tiene la palabra
      </span>
      <div className="chips" role="group" aria-labelledby="floor-control-label">
        {options.map(({ key, label, to, current }) => (
          <button
            key={key}
            type="button"
            className="chip"
            aria-pressed={current}
            onClick={() => choose(to, current)}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorNote error={give.error} />
    </div>
  );
}
