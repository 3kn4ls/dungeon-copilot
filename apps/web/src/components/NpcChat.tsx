import {
  TALK_MEMORY,
  type CharacterView,
  type InterventionEvent,
  type NpcView,
  type TalkLine,
} from '@dungeon-copilot/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStoreGameEvent } from '../queries';
import { RecipientSelect, useRecipient } from './Recipient';
import { ConfirmButton, ErrorNote, LineEditor, useSessionState } from './ui';

interface ChatLine extends TalkLine {
  id: string;
  /** Ya se ha enseñado a la mesa. */
  revealed?: boolean;
}

let lineCount = 0;
const newLineId = () => `${Date.now().toString(36)}-${(lineCount++).toString(36)}`;

/**
 * Conversación con un PNJ: el máster cuenta lo que dicen o hacen los personajes y la IA
 * responde como el PNJ. En la sala (con `gameId`), cada respuesta se puede retocar y enseñar a
 * la mesa (o en secreto a uno de los `characters`), y el máster puede escribirla él si
 * prefiere, o si Ollama falla. Con `answering`, lo que dijo un jugador al intervenir pasa a la
 * charla con un botón, y lo primero que se enseñe lo atiende. Se monta con `key` por PNJ: la
 * charla guardada es de uno solo.
 */
export function NpcChat({
  npc,
  gameId,
  characters = [],
  answering,
}: {
  npc: NpcView;
  gameId?: string;
  characters?: CharacterView[];
  answering?: InterventionEvent | undefined;
}) {
  const [lines, setLines] = useSessionState<ChatLine[]>(
    `dc:charla:${gameId ?? 'prueba'}:${npc.id}`,
    () => [],
  );
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  /** Lo que el máster escribe él como respuesta del PNJ, mientras lo escribe. */
  const [writing, setWriting] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const log = useRef<HTMLOListElement>(null);
  const storeEvent = useStoreGameEvent(gameId ?? '');
  const [to, setTo] = useRecipient(answering);
  /** La intervención que ya ha pasado a la charla, para no pasarla dos veces. */
  const [heard, setHeard] = useState<number | null>(null);
  const recipient = characters.find((character) => character.id === to);

  const reveal = useMutation({
    mutationFn: (line: ChatLine) => {
      if (!gameId) throw new Error('Solo se enseña a la mesa desde la sala');
      return api.speech(gameId, {
        npcId: npc.id,
        text: line.text,
        to: recipient?.id,
        answers: answering?.id,
      });
    },
    onSuccess: (event, line) => {
      storeEvent(event);
      setLines((old) => old.map((l) => (l.id === line.id ? { ...l, revealed: true } : l)));
    },
  });

  // Lo último, siempre a la vista.
  const isWriting = writing !== null;
  useEffect(() => {
    const list = log.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lines, pending, isWriting]);

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

  /** Lo que dice la mesa pasa a la charla. */
  function takeInput(): string {
    const said = input.trim();
    if (said) setLines((old) => [...old, { id: newLineId(), role: 'table', text: said }]);
    setInput('');
    return said;
  }

  function send() {
    if (pending !== null || writing !== null) return;
    const said = takeInput();
    void ask(lines, said);
  }

  /** Lo que dijo el jugador al intervenir pasa a la charla y el PNJ le responde. */
  function hear(intervention: InterventionEvent) {
    if (pending !== null || writing !== null) return;
    const said = intervention.text
      ? `${intervention.name}: ${intervention.text}`
      : `[${intervention.name} se dirige a ${npc.name}]`;
    setHeard(intervention.id);
    setLines((old) => [...old, { id: newLineId(), role: 'table', text: said }]);
    void ask(lines, said);
  }

  /** El máster responde él por el PNJ; queda en la charla como si lo hubiera dicho la IA. */
  function writeMyself() {
    if (pending !== null || writing !== null) return;
    takeInput();
    setError(null);
    setWriting('');
  }

  function saveWriting() {
    const text = writing?.trim();
    if (text) setLines((old) => [...old, { id: newLineId(), role: 'npc', text }]);
    setWriting(null);
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
    // Retocada ya no es lo que vio la mesa: se puede volver a enseñar.
    if (text) {
      setLines((old) =>
        old.map((l) =>
          l.id === editing.id && l.text !== text ? { ...l, text, revealed: false } : l,
        ),
      );
    }
    setEditing(null);
  }

  const last = lines.at(-1);
  return (
    <div className="chat">
      {lines.length === 0 && pending === null && writing === null ? (
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
                  <LineEditor
                    label={`Lo que dice ${npc.name}`}
                    value={editing.text}
                    onChange={(text) => setEditing({ ...editing, text })}
                    onSave={saveEdit}
                    onCancel={() => setEditing(null)}
                  />
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
                          {recipient ? `Enseñar solo a ${recipient.name}` : 'Enseñar a la mesa'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => setEditing({ id: line.id, text: line.text })}
                      >
                        Retocar
                      </button>
                      {line === last && pending === null && !line.revealed && (
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
          {writing !== null && (
            <li className="chat-line chat-npc">
              <span className="chat-who">{npc.name}</span>
              <LineEditor
                label={`Lo que dice ${npc.name}`}
                value={writing}
                autoFocus
                onChange={setWriting}
                onSave={saveWriting}
                onCancel={() => setWriting(null)}
              />
            </li>
          )}
        </ol>
      )}

      {answering && heard !== answering.id && (
        <div className="actions">
          <button
            type="button"
            className="button primary"
            disabled={pending !== null || writing !== null}
            onClick={() => hear(answering)}
          >
            Que {npc.name} responda a {answering.name}
          </button>
        </div>
      )}
      {gameId && <RecipientSelect characters={characters} value={to} onChange={setTo} />}
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
            <button key="send" type="submit" className="button primary" disabled={writing !== null}>
              {input.trim() ? 'Que responda' : `Que hable ${npc.name}`}
            </button>
          )}
          {gameId && pending === null && writing === null && (
            <button type="button" className="button" onClick={writeMyself}>
              Lo escribo yo
            </button>
          )}
          {lines.length > 0 && pending === null && writing === null && (
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
