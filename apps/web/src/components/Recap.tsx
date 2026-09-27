import { RECAP_MAX, type GameDetail, type GameState } from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';
import { keys, useAiStatus } from '../queries';
import { ConfirmButton, ErrorNote, QueryState, useSessionState } from './ui';

/**
 * El resumen de una partida terminada: lo escribe el máster, con ayuda de la IA si la hay, y
 * lo lee toda la mesa. La IA lo recuerda en las partidas siguientes.
 */
export function RecapPanel({ game }: { game: GameDetail }) {
  // Lo que el máster está escribiendo, que aguanta una recarga; null si no está escribiendo.
  const [draft, setDraft] = useSessionState<string | null>(`dc:resumen:${game.id}`, () => null);
  const isMaster = game.role === 'master';
  // Sin resumen, el máster lo ve ya listo para escribir.
  const editing = isMaster && (draft !== null || !game.recap);

  return (
    <section className="panel" aria-labelledby="recap-heading">
      <h2 id="recap-heading">Resumen</h2>
      {editing ? (
        <RecapEditor
          game={game}
          text={draft ?? game.recap}
          onChange={setDraft}
          onDone={() => setDraft(null)}
        />
      ) : game.recap ? (
        <div className="stack tight">
          <p className="prewrap recap-text">{game.recap}</p>
          {isMaster && (
            <div className="actions">
              <button type="button" className="button" onClick={() => setDraft(game.recap)}>
                Cambiar el resumen
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="muted">El máster aún no ha escrito el resumen de esta partida.</p>
      )}
    </section>
  );
}

function RecapEditor(props: {
  game: GameDetail;
  text: string;
  onChange: (text: string) => void;
  onDone: () => void;
}) {
  const { game, text, onChange, onDone } = props;
  const ai = useAiStatus();
  const queryClient = useQueryClient();
  const [hint, setHint] = useState('');
  const [useNotes, setUseNotes] = useState(true);
  /** Lo que lleva escrito la IA mientras escribe; null si no está escribiendo. */
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const request = useRef<AbortController | null>(null);
  const notesHint = useId();

  // Al salir de la partida, se para el resumen que estuviera a medias.
  useEffect(() => () => request.current?.abort(), []);

  const save = useMutation({
    mutationFn: () => api.saveRecap(game.id, { recap: text }),
    onSuccess: (saved) => {
      queryClient.setQueryData<GameState>(keys.game(game.id), (state) =>
        state ? { ...state, game: saved } : state,
      );
      void queryClient.invalidateQueries({ queryKey: keys.games(game.campaignId) });
      onDone();
    },
  });

  async function write() {
    request.current?.abort();
    const current = new AbortController();
    request.current = current;
    setError(null);
    setPending('');
    let partial = '';
    try {
      const written = await api.draftRecap(
        game.id,
        { hint, useNotes },
        {
          signal: current.signal,
          onText: (next) => {
            partial = next;
            setPending(next);
          },
        },
      );
      onChange(written);
    } catch (caught) {
      if (current.signal.aborted) {
        // Parado a medias: lo que llegó a escribir se queda, por si sirve.
        const kept = partial.trim();
        if (kept) onChange(kept);
      } else {
        setError(caught);
      }
    } finally {
      if (request.current === current) {
        request.current = null;
        setPending(null);
      }
    }
  }

  if (!ai.data) return <QueryState error={ai.error} />;
  const writing = pending !== null;

  return (
    <div className="stack tight">
      {ai.data.enabled ? (
        <>
          <p className="muted">
            La IA te propone un resumen con lo que hay en el registro. Revísalo antes de guardarlo:
            la mesa lo verá tal cual.
          </p>
          <label className="field">
            <span className="field-label">Qué más pasó (opcional)</span>
            <textarea
              rows={2}
              maxLength={1000}
              value={hint}
              disabled={writing}
              placeholder="Kael traicionó al gremio y huyeron por las cloacas."
              onChange={(e) => setHint(e.target.value)}
            />
            <span className="hint">
              Lo que se jugó de palabra no está en el registro: cuéntaselo a la IA.
            </span>
          </label>
          <div className="field">
            <label className="check">
              <input
                type="checkbox"
                checked={useNotes}
                disabled={writing}
                aria-describedby={notesHint}
                onChange={(e) => setUseNotes(e.target.checked)}
              />
              Tener en cuenta mis notas
            </label>
            <span id={notesHint} className="hint">
              Le ayudan a entender lo que pasó, pero guardan secretos: revisa que no se le escape
              ninguno.
            </span>
          </div>
          <div className="actions">
            {/* Botones distintos (key), como en la charla con un PNJ: el de Parar no debe
                heredar el clic que empieza a escribir. */}
            {writing ? (
              <button
                key="stop"
                type="button"
                className="button"
                onClick={() => request.current?.abort()}
              >
                Parar
              </button>
            ) : text.trim() ? (
              <ConfirmButton
                key="rewrite"
                confirmLabel="¿Cambiar lo escrito por lo que proponga?"
                onConfirm={() => void write()}
              >
                Escribir otro con IA
              </ConfirmButton>
            ) : (
              <button
                key="write"
                type="button"
                className="button primary"
                onClick={() => void write()}
              >
                Escribir con IA
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="muted">
          Cuenta lo que pasó en la partida: la mesa lo verá aquí y en la campaña. Con Ollama
          configurado en el servidor, la IA te propondría uno a partir del registro.
        </p>
      )}

      <form
        className="stack tight"
        onSubmit={(event) => {
          event.preventDefault();
          if (!writing) save.mutate();
        }}
      >
        <label className="field">
          <span className="field-label">El resumen que verá la mesa</span>
          <textarea
            rows={8}
            maxLength={RECAP_MAX}
            value={writing ? pending || 'Escribiendo…' : text}
            readOnly={writing}
            aria-busy={writing}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
        <ErrorNote error={error ?? save.error} />
        <div className="actions">
          <button
            type="submit"
            className="button primary"
            disabled={writing || save.isPending || text === game.recap}
          >
            Guardar resumen
          </button>
          {game.recap && (
            <button type="button" className="button" disabled={writing} onClick={onDone}>
              Cancelar
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
