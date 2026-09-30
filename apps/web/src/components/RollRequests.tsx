import { successChance } from '@dungeon-copilot/rules';
import type { CharacterView, GameDetail, RollRequestEvent } from '@dungeon-copilot/shared';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api';
import { useCharacters, useMe, useStoreGameEvent } from '../queries';
import { percent, rollOdds } from '../rolling';
import { requestedText } from './GameEvents';
import { ErrorNote } from './ui';

/** Hacer una tirada pedida: la hace su jugador o, si hace falta, el máster por él. */
function useRollRequested(game: GameDetail, event: RollRequestEvent) {
  const storeEvent = useStoreGameEvent(game.id);
  return useMutation({
    mutationFn: () => api.rollRequested(game.id, event.id),
    onSuccess: storeEvent,
  });
}

/**
 * Una tirada que el máster ha pedido a un personaje de quien juega: qué se tira, con qué
 * probabilidad según su ficha de ahora y el botón para tirar.
 */
export function RequestedRollCard({
  game,
  event,
  characters,
}: {
  game: GameDetail;
  event: RollRequestEvent;
  characters: CharacterView[];
}) {
  const roll = useRollRequested(game, event);
  const odds = rollOdds(event.request, characters);
  return (
    <div className="requested-roll">
      <p className="requested-title">
        El máster pide una tirada a {event.name}
        {event.visibility === 'private' && <span className="badge secret">En secreto</span>}
      </p>
      <p>{requestedText(event)}</p>
      <div className="roll-bar">
        <p className="bonus">
          {odds ? (
            <>
              <strong>{percent(successChance(odds))}</strong> de conseguirlo
            </>
          ) : (
            ' '
          )}
        </p>
        <button
          type="button"
          className="roll-button"
          disabled={roll.isPending}
          onClick={() => roll.mutate()}
        >
          {roll.isPending ? 'Tirando…' : 'Tirar'}
        </button>
      </div>
      <ErrorNote error={roll.error} />
    </div>
  );
}

/** Bajo una tirada pedida en el registro: el botón para hacerla, si es de quien mira. */
export function RollRequestAction({ game, event }: { game: GameDetail; event: RollRequestEvent }) {
  const { data: me } = useMe();
  const characters = useCharacters(game.campaignId);
  const roll = useRollRequested(game, event);
  const character = characters.data?.find((c) => c.id === event.characterId);
  if (!character || character.ownerId !== me?.user?.id) return null;
  return (
    <div className="actions">
      <button
        type="button"
        className="button small primary"
        disabled={roll.isPending}
        onClick={() => roll.mutate()}
      >
        {roll.isPending ? 'Tirando…' : 'Tirar'}
      </button>
      <ErrorNote error={roll.error} />
    </div>
  );
}

/** Las tiradas que ha pedido el máster y aún esperan: puede tirarlas él o retirarlas. */
export function PendingRollRequests({
  game,
  pending,
}: {
  game: GameDetail;
  pending: RollRequestEvent[];
}) {
  if (pending.length === 0) return null;
  return (
    <div className="stack tight">
      <p className="field-label">Tiradas que has pedido</p>
      <ol className="queue">
        {pending.map((event) => (
          <PendingRollRequest key={event.id} game={game} event={event} />
        ))}
      </ol>
    </div>
  );
}

function PendingRollRequest({ game, event }: { game: GameDetail; event: RollRequestEvent }) {
  const storeEvent = useStoreGameEvent(game.id);
  const roll = useRollRequested(game, event);
  const withdraw = useMutation({
    mutationFn: () => api.withdrawRollRequest(game.id, event.id),
    onSuccess: storeEvent,
  });
  const busy = roll.isPending || withdraw.isPending;
  return (
    <li className="queue-item">
      <p className="queue-who">
        Esperando a <strong>{event.name}</strong>
        {event.visibility === 'private' && <span className="badge secret">En secreto</span>}
      </p>
      <p>{requestedText(event)}</p>
      <div className="chat-actions">
        <button
          type="button"
          className="button small"
          disabled={busy}
          onClick={() => roll.mutate()}
        >
          Tirar por {event.name}
        </button>
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={() => withdraw.mutate()}
        >
          Retirar
        </button>
      </div>
      <ErrorNote error={roll.error ?? withdraw.error} />
    </li>
  );
}
