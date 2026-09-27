import type { GameDetail, GameEvent } from '@dungeon-copilot/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useAiText } from '../ai';
import { api } from '../api';
import { useStoreGameEvent } from '../queries';
import { ErrorNote, LineEditor } from './ui';

interface Idea {
  id: number;
  text: string;
  revealed: boolean;
}

let ideaCount = 0;

/** Las ideas que ha escrito la IA, una por línea. */
const toIdeas = (text: string): Idea[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ id: ++ideaCount, text: line, revealed: false }));

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
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState('');
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const writer = useAiText();
  const storeEvent = useStoreGameEvent(game.id);
  const reveal = useMutation({
    mutationFn: (idea: Idea) => api.reveal(game.id, { title: '', body: idea.text }),
    onSuccess: (shown, idea) => {
      storeEvent(shown);
      setIdeas((old) => old.map((i) => (i.id === idea.id ? { ...i, revealed: true } : i)));
    },
  });
  const actor = event.roll.actor.label;

  async function ask() {
    setEditing(null);
    const text = await writer.write((options) =>
      api.complications(game.id, event.id, { intent }, options),
    );
    // Parada antes de terminar ninguna, se quedan las de antes.
    if (text) setIdeas(toIdeas(text));
  }

  function saveEdit() {
    if (!editing) return;
    const text = editing.text.trim();
    // Retocada ya no es lo que vio la mesa: se puede volver a enseñar.
    if (text) {
      setIdeas((old) =>
        old.map((i) =>
          i.id === editing.id && i.text !== text ? { ...i, text, revealed: false } : i,
        ),
      );
    }
    setEditing(null);
  }

  if (!open) {
    return (
      <div className="complications">
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setOpen(true);
            if (ideas.length === 0) void ask();
          }}
        >
          Proponer complicaciones
        </button>
      </div>
    );
  }

  const pending = writer.pending?.split('\n').filter(Boolean) ?? [];
  return (
    <section className="complications" aria-label={`Complicaciones para ${actor}`}>
      {writer.writing ? (
        <ol className="ideas" aria-busy="true">
          {pending.map((text, index) => (
            <li key={index} className="idea">
              <p>{text}</p>
            </li>
          ))}
          <li className="idea">
            <p className="muted">{pending.length > 0 ? 'Pensando otra…' : 'Pensando…'}</p>
          </li>
        </ol>
      ) : (
        ideas.length > 0 && (
          <ol className="ideas">
            {ideas.map((idea) => (
              <li key={idea.id} className="idea">
                {editing?.id === idea.id ? (
                  <LineEditor
                    label="Complicación"
                    value={editing.text}
                    autoFocus
                    onChange={(text) => setEditing({ ...editing, text })}
                    onSave={saveEdit}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <>
                    <p>
                      {idea.text}
                      {idea.revealed && <span className="badge live">Enseñada</span>}
                    </p>
                    <div className="chat-actions">
                      {!idea.revealed && (
                        <button
                          type="button"
                          className="button small primary"
                          disabled={reveal.isPending}
                          onClick={() => reveal.mutate(idea)}
                        >
                          Enseñar a la mesa
                        </button>
                      )}
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => setEditing({ id: idea.id, text: idea.text })}
                      >
                        Retocar
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ol>
        )
      )}
      <ErrorNote error={writer.error ?? reveal.error} />

      <form
        className="stack tight"
        onSubmit={(submit) => {
          submit.preventDefault();
          if (!writer.writing) void ask();
        }}
      >
        <label className="field">
          <span className="field-label">Qué intentaba {actor}, para afinar (opcional)</span>
          <input
            value={intent}
            maxLength={300}
            placeholder="Forzar la puerta del almacén sin que los oigan"
            onChange={(change) => setIntent(change.target.value)}
          />
        </label>
        <div className="actions">
          {/* Botones distintos (key), como en la charla con un PNJ: el de Parar no debe
              heredar el clic que pide las ideas. */}
          {writer.writing ? (
            <button key="stop" type="button" className="button small" onClick={writer.stop}>
              Parar
            </button>
          ) : (
            <button key="ask" type="submit" className="button small">
              {ideas.length > 0 ? 'Otras ideas' : 'Pedir ideas'}
            </button>
          )}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              writer.stop();
              setOpen(false);
            }}
          >
            Cerrar
          </button>
        </div>
      </form>
    </section>
  );
}
