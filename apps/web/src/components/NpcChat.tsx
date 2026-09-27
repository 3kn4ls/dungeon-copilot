import { TALK_MEMORY, type NpcView, type TalkLine } from '@dungeon-copilot/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStoreGameEvent } from '../queries';
import { ConfirmButton, ErrorNote } from './ui';

interface ChatLine extends TalkLine {
  id: string;
  /** Ya se ha enseñado a la mesa. */
  revealed?: boolean;
}

let lineCount = 0;
const newLineId = () => `${Date.now().toString(36)}-${(lineCount++).toString(36)}`;

/** Estado que aguanta una recarga de la pestaña, como cuando el móvil la descarta. */
function useSessionState<T>(key: string, initial: () => T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) return JSON.parse(saved) as T;
    } catch {
      // Sin almacenamiento (modo privado): se empieza de cero.
    }
    return initial();
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Sin almacenamiento: la charla se perderá al recargar.
    }
  }, [key, value]);
  return [value, setValue] as const;
}

/**
 * Conversación con un PNJ: el máster cuenta lo que dicen o hacen los personajes y la IA
 * responde como el PNJ. En la sala (con `gameId`), cada respuesta se puede retocar y enseñar a
 * la mesa. Se monta con `key` por PNJ: la charla guardada es de uno solo.
 */
export function NpcChat({ npc, gameId }: { npc: NpcView; gameId?: string }) {
  const [lines, setLines] = useSessionState<ChatLine[]>(
    `dc:charla:${gameId ?? 'prueba'}:${npc.id}`,
    () => [],
  );
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  const log = useRef<HTMLOListElement>(null);
  const storeEvent = useStoreGameEvent(gameId ?? '');

  const reveal = useMutation({
    mutationFn: (line: ChatLine) => {
      if (!gameId) throw new Error('Solo se enseña a la mesa desde la sala');
      return api.speech(gameId, { npcId: npc.id, text: line.text });
    },
    onSuccess: (event, line) => {
      storeEvent(event);
      setLines((old) => old.map((l) => (l.id === line.id ? { ...l, revealed: true } : l)));
    },
  });

  // Lo último, siempre a la vista.
  useEffect(() => {
    const list = log.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lines, pending]);

  // Al cambiar de PNJ o salir de la sala, se para la respuesta que estuviera a medias.
  useEffect(() => () => request.current?.abort(), []);

  async function ask(history: ChatLine[], said: string) {
    request.current?.abort();
    const current = new AbortController();
    request.current = current;
    setError(null);
    setPending('');
    let partial = '';
    try {
      const text = await api.talk(
        npc.id,
        {
          gameId,
          history: history.slice(-TALK_MEMORY).map(({ role, text }) => ({ role, text })),
          input: said,
        },
        {
          signal: current.signal,
          onText: (next) => {
            partial = next;
            setPending(next);
          },
        },
      );
      setLines((old) => [...old, { id: newLineId(), role: 'npc', text }]);
    } catch (caught) {
      if (current.signal.aborted) {
        // Parada a medias: lo que llegó a decir se queda, por si sirve.
        const kept = partial.trim();
        if (kept) setLines((old) => [...old, { id: newLineId(), role: 'npc', text: kept }]);
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

  function send() {
    if (pending !== null) return;
    const said = input.trim();
    if (said) setLines((old) => [...old, { id: newLineId(), role: 'table', text: said }]);
    setInput('');
    void ask(lines, said);
  }

  /** Otra respuesta a lo último que dijo la mesa (o, si falló, la que faltaba). */
  function retry() {
    if (pending !== null) return;
    const base = lines.at(-1)?.role === 'npc' ? lines.slice(0, -1) : lines;
    const prompt = base.at(-1);
    setLines(base);
    if (prompt?.role === 'table') void ask(base.slice(0, -1), prompt.text);
    else void ask(base, '');
  }

  function saveEdit() {
    if (!editing) return;
    const text = editing.text.trim();
    if (text) setLines((old) => old.map((l) => (l.id === editing.id ? { ...l, text } : l)));
    setEditing(null);
  }

  const last = lines.at(-1);
  return (
    <div className="chat">
      {lines.length === 0 && pending === null ? (
        <p className="muted">
          Cuenta lo que dicen o hacen los personajes y {npc.name} responderá. Si lo dejas vacío,{' '}
          {npc.name} toma la palabra.
        </p>
      ) : (
        <ol className="chat-log" ref={log} aria-live="polite">
          {lines.map((line) =>
            line.role === 'table' ? (
              <li key={line.id} className="chat-line chat-table">
                <span className="chat-who">Mesa</span>
                <p className="prewrap">{line.text}</p>
              </li>
            ) : (
              <li key={line.id} className="chat-line chat-npc">
                <span className="chat-who">
                  {npc.name}
                  {line.revealed && <span className="badge live">Enseñado</span>}
                </span>
                {editing?.id === line.id ? (
                  <form
                    className="stack tight"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveEdit();
                    }}
                  >
                    <textarea
                      aria-label={`Lo que dice ${npc.name}`}
                      rows={3}
                      maxLength={2000}
                      value={editing.text}
                      onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                    />
                    <div className="actions">
                      <button type="submit" className="button small primary">
                        Guardar
                      </button>
                      <button
                        type="button"
                        className="button small"
                        onClick={() => setEditing(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p className="prewrap">{line.text}</p>
                    <div className="chat-actions">
                      {gameId && !line.revealed && (
                        <button
                          type="button"
                          className="button small primary"
                          disabled={reveal.isPending}
                          onClick={() => reveal.mutate(line)}
                        >
                          Enseñar a la mesa
                        </button>
                      )}
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => setEditing({ id: line.id, text: line.text })}
                      >
                        Retocar
                      </button>
                      {line === last && pending === null && (
                        <button type="button" className="link-button" onClick={retry}>
                          Otra respuesta
                        </button>
                      )}
                    </div>
                  </>
                )}
              </li>
            ),
          )}
          {pending !== null && (
            <li className="chat-line chat-npc chat-pending">
              <span className="chat-who">{npc.name}</span>
              <p className="prewrap">{pending || 'Pensando…'}</p>
            </li>
          )}
        </ol>
      )}

      <ErrorNote error={error ?? reveal.error} />
      {Boolean(error) && last?.role === 'table' && (
        <div className="actions">
          <button type="button" className="button small" onClick={retry}>
            Reintentar
          </button>
        </div>
      )}

      <form
        className="stack tight"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label className="field">
          <span className="field-label">Qué dicen o hacen los personajes</span>
          <textarea
            rows={2}
            maxLength={1000}
            value={input}
            placeholder="Kael le enseña una moneda de oro. [Que desconfíe]"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(event) => {
              // Intro envía; Mayúsculas + Intro hace un salto de línea.
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
          />
          <span className="hint">
            Entre corchetes, indicaciones para la IA que {npc.name} no oye.
          </span>
        </label>
        <div className="actions">
          {/* Botones distintos (key): si React reutilizara el de Parar, al volverse de envío
              en el mismo clic, el formulario se enviaría y el PNJ volvería a hablar. */}
          {pending !== null ? (
            <button
              key="stop"
              type="button"
              className="button"
              onClick={() => request.current?.abort()}
            >
              Parar
            </button>
          ) : (
            <button key="send" type="submit" className="button primary">
              {input.trim() ? 'Que responda' : `Que hable ${npc.name}`}
            </button>
          )}
          {lines.length > 0 && pending === null && (
            <ConfirmButton
              confirmLabel="¿Borrar la charla?"
              onConfirm={() => {
                setLines([]);
                setError(null);
              }}
            >
              Empezar de nuevo
            </ConfirmButton>
          )}
        </div>
      </form>
    </div>
  );
}
