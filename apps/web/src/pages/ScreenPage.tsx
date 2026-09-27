import {
  GAME_STATUS_LABELS,
  gameName,
  type GameEvent,
  type ScreenState,
} from '@dungeon-copilot/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError, api } from '../api';
import { RollView } from '../components/GameEvents';
import { useDocumentTitle } from '../components/ui';
import { LIVE_STATUS_LABELS, useLiveEvents } from '../live';
import { keys } from '../queries';

/**
 * Pantalla de la mesa: para una tele o una tablet que todos ven. No necesita sesión; el enlace
 * secreto de la campaña basta. Enseña lo último que ha revelado el máster y las últimas tiradas.
 */
export function ScreenPage() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const screen = useQuery({
    queryKey: keys.screen(token),
    queryFn: () => api.screen(token),
    staleTime: Infinity,
  });
  useDocumentTitle(screen.data ? `Pantalla · ${screen.data.campaignName}` : 'Pantalla');
  useWakeLock();

  // Con el enlace cambiado, lo que quedó guardado ya no vale.
  const gone = screen.error instanceof ApiError && screen.error.status === 404;
  const live = useLiveEvents({
    url: screen.data && !gone ? `/api/screens/${token}/stream` : null,
    after: screen.data?.events.at(-1)?.id ?? 0,
    onEvent: (event) => {
      const current = queryClient.getQueryData<ScreenState>(keys.screen(token));
      if (!current || event.gameId !== current.game?.id) {
        // Ha empezado otra partida: se pide entera.
        void queryClient.invalidateQueries({ queryKey: keys.screen(token) });
        return;
      }
      queryClient.setQueryData<ScreenState>(keys.screen(token), mergeScreenEvent(current, event));
    },
    onRefused: () => void queryClient.invalidateQueries({ queryKey: keys.screen(token) }),
  });

  if (!screen.data || gone) {
    return (
      <div className="screen screen-empty">
        <p className="screen-waiting">
          {screen.error
            ? gone
              ? 'Esta pantalla ya no existe: pide al máster el enlace nuevo.'
              : 'No se pudo conectar con el servidor.'
            : 'Cargando…'}
        </p>
      </div>
    );
  }

  const { campaignName, game, events } = screen.data;
  const reveal = events.findLast((event) => event.kind === 'reveal');
  // Lo que dice un PNJ se ve bajo la escena en la que lo dijo, hasta que el máster enseñe otra.
  const lastSpeech = events.findLast((event) => event.kind === 'speech');
  const speech = lastSpeech && (!reveal || lastSpeech.id > reveal.id) ? lastSpeech : undefined;
  const rolls = events
    .filter((event) => event.kind === 'roll')
    .slice(-3)
    .reverse();

  return (
    <div className="screen">
      <header className="screen-header">
        <span className="screen-campaign">{campaignName}</span>
        {game && (
          <span>
            {gameName(game)} · {GAME_STATUS_LABELS[game.status]}
          </span>
        )}
        <span className={`live-status live-${live}`}>{LIVE_STATUS_LABELS[live]}</span>
        <FullscreenButton />
      </header>

      {!game ? (
        <p className="screen-waiting">Esperando a que empiece la partida…</p>
      ) : (
        <main className="screen-main">
          <section className="screen-reveal" aria-live="polite">
            {reveal?.kind === 'reveal' && (
              <>
                {reveal.title && <h1>{reveal.title}</h1>}
                <p className="prewrap">{reveal.body}</p>
              </>
            )}
            {speech?.kind === 'speech' && (
              <figure className="screen-speech">
                <figcaption>{speech.name}</figcaption>
                <blockquote className="prewrap">{speech.text}</blockquote>
              </figure>
            )}
            {!reveal && !speech && (
              <p className="screen-waiting">Aquí aparecerá lo que enseñe el máster.</p>
            )}
            {game.status === 'closed' && <p className="screen-banner">La partida ha terminado</p>}
          </section>
          {rolls.length > 0 && (
            <aside className="screen-rolls" aria-label="Últimas tiradas">
              {rolls.map((event, index) =>
                event.kind === 'roll' ? (
                  <div
                    key={event.id}
                    className={index === 0 ? 'screen-roll latest' : 'screen-roll'}
                  >
                    <RollView roll={event.roll} big={index === 0} />
                  </div>
                ) : null,
              )}
            </aside>
          )}
        </main>
      )}
    </div>
  );
}

function mergeScreenEvent(state: ScreenState, event: GameEvent): ScreenState {
  if (state.events.some((known) => known.id === event.id)) return state;
  const events = [...state.events, event].sort((a, b) => a.id - b.id);
  const game =
    state.game && event.kind === 'closed'
      ? { ...state.game, status: 'closed' as const, closedAt: event.createdAt }
      : state.game;
  return { ...state, game, events };
}

/** Que la tele o la tablet no se apague mientras enseña la partida. */
function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let cancelled = false;
    const request = async () => {
      try {
        const next = await navigator.wakeLock.request('screen');
        if (cancelled) void next.release();
        else lock = next;
      } catch {
        // Sin permiso o con la pestaña oculta: la pantalla se apagará como siempre.
      }
    };
    // El bloqueo se pierde al ocultar la pestaña; se pide otra vez al volver.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, []);
}

function FullscreenButton() {
  const [fullscreen, setFullscreen] = useState(() => document.fullscreenElement !== null);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  if (fullscreen || !document.fullscreenEnabled) return null;
  return (
    <button
      type="button"
      className="button small"
      onClick={() => void document.documentElement.requestFullscreen().catch(() => undefined)}
    >
      Pantalla completa
    </button>
  );
}
