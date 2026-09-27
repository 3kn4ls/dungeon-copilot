import type { CampaignDetail, GameState } from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { keys } from '../queries';
import { ConfirmButton, ErrorNote } from './ui';

/** Enlace de la pantalla de la mesa, para abrirlo en una tele o una tablet sin iniciar sesión. */
export function ScreenLink({ campaignId, token }: { campaignId: string; token: string }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/pantalla/${token}`;

  const regenerate = useMutation({
    mutationFn: () => api.regenerateScreenToken(campaignId),
    onSuccess: (screenToken) => {
      queryClient.setQueryData<CampaignDetail>(keys.campaign(campaignId), (old) =>
        old ? { ...old, screenToken } : old,
      );
      // La sala guarda su propia copia del enlace.
      queryClient.setQueriesData<GameState>({ queryKey: ['games'] }, (old) =>
        old && old.game.campaignId === campaignId
          ? { ...old, game: { ...old.game, screenToken } }
          : old,
      );
    },
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso para el portapapeles: el enlace se puede abrir y copiar desde la pantalla.
    }
  }

  return (
    <section className="panel" aria-labelledby="screen-heading">
      <h2 id="screen-heading">Pantalla de la mesa</h2>
      <p className="muted">
        Ábrela en la tele o en una tablet: enseña lo que reveles y las tiradas públicas, sin iniciar
        sesión, y pasa sola a la siguiente partida.
      </p>
      <div className="actions">
        <a href={url} target="_blank" rel="noreferrer" className="button">
          Abrir pantalla
        </a>
        <button type="button" className="button" onClick={copy}>
          {copied ? 'Copiado' : 'Copiar enlace'}
        </button>
        <ConfirmButton
          confirmLabel="¿Seguro? El viejo dejará de valer"
          onConfirm={() => regenerate.mutate()}
          disabled={regenerate.isPending}
        >
          Cambiar enlace
        </ConfirmButton>
      </div>
      <ErrorNote error={regenerate.error} />
    </section>
  );
}
