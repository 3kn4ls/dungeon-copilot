import type { OpposedSide, Outcome } from '@dungeon-copilot/rules';
import {
  rerollableSides,
  type CharacterView,
  type GameDetail,
  type GameEvent,
} from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { refreshCharacters, useCharacters, useMe, useStoreGameEvent } from '../queries';
import { ConfirmButton, ErrorNote } from './ui';

/** Resultados con los que un bando ya ha ganado la tirada: repetirla no le serviría. */
const WON: Record<OpposedSide, Outcome[]> = {
  actor: ['success', 'critical'],
  opponent: ['failure', 'fumble'],
};

/**
 * Repetir una tirada gastando Suerte, bajo la tirada en la sala. Lo ve quien juega con el
 * personaje, y el máster por si se lo piden de palabra; no se ofrece a quien ya ha ganado.
 */
export function LuckReroll({
  game,
  event,
}: {
  game: GameDetail;
  event: GameEvent & { kind: 'roll' };
}) {
  const { data: me } = useMe();
  const characters = useCharacters(game.campaignId);
  const isMaster = game.role === 'master';
  const sides = rerollableSides(event.roll).flatMap(({ side, characterId }) => {
    const character = characters.data?.find((c) => c.id === characterId);
    if (!character || !(isMaster || character.ownerId === me?.user?.id)) return [];
    if (WON[side].includes(event.roll.result.outcome)) return [];
    return [{ side, character }];
  });
  if (sides.length === 0) return null;

  return (
    <div className="luck-reroll">
      {sides.map(({ side, character }) => (
        <RerollSide key={side} game={game} eventId={event.id} side={side} character={character} />
      ))}
    </div>
  );
}

function RerollSide(props: {
  game: GameDetail;
  eventId: number;
  side: OpposedSide;
  character: CharacterView;
}) {
  const { game, character } = props;
  const queryClient = useQueryClient();
  const storeEvent = useStoreGameEvent(game.id);
  const reroll = useMutation({
    mutationFn: () => api.reroll(game.id, props.eventId, { side: props.side }),
    onSuccess: (event) => {
      storeEvent(event);
      refreshCharacters(queryClient, game.campaignId);
    },
    // Otro se ha adelantado, o la Suerte ha cambiado en la ficha: se pide la de ahora.
    onError: () => refreshCharacters(queryClient, game.campaignId),
  });
  const { luck } = character;

  if (luck === 0) {
    return <p className="luck-row muted">A {character.name} no le queda Suerte para repetir.</p>;
  }
  return (
    <div className="luck-row">
      <p className="muted">
        {character.name} puede repetir sus dados: le{' '}
        {luck === 1 ? 'queda 1 punto' : `quedan ${luck} puntos`} de Suerte.
      </p>
      <ConfirmButton
        small
        confirmLabel="¿Gastar 1 de Suerte?"
        disabled={reroll.isPending}
        onConfirm={() => reroll.mutate()}
      >
        Repetir con Suerte
      </ConfirmButton>
      <ErrorNote error={reroll.error} />
    </div>
  );
}
