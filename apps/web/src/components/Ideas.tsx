import type { GameDetail } from '@dungeon-copilot/shared';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useAiText } from '../ai';
import { api, type AiTextOptions } from '../api';
import { useStoreGameEvent } from '../queries';
import { ConfirmButton, ErrorNote, LineEditor } from './ui';

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

/** Otra cosa que el máster puede hacer con una idea, además de enseñarla o retocarla. */
export interface IdeaAction {
  label: string;
  /** Si hace falta confirmarlo, la pregunta: por ejemplo, si va a cambiar algo escrito. */
  confirm?: string;
  disabled?: boolean;
  onClick: (idea: string) => void;
}

/**
 * Ideas de la IA para el máster, como las complicaciones de una tirada o lo que puede pasar
 * cuando la mesa se atasca. Solo las ve él: las cuenta, o las enseña a la mesa tal cual o
 * retocadas.
 */
export function AiIdeas(props: {
  game: GameDetail;
  /** El botón que abre el panel y pide las primeras ideas. */
  openLabel: string;
  /** Lo que encabeza el panel abierto: "Complicaciones para Kael". */
  label: string;
  /** Cómo se llama cada idea al retocarla: "Complicación". */
  ideaLabel: string;
  /** El campo opcional para afinar lo que se pide. */
  hint: { label: string; placeholder: string };
  ask: (hint: string, options: AiTextOptions) => Promise<string>;
  action?: IdeaAction;
}) {
  const { game, action } = props;
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState('');
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const headingId = useId();
  const writer = useAiText();
  const storeEvent = useStoreGameEvent(game.id);
  const reveal = useMutation({
    mutationFn: (idea: Idea) => api.reveal(game.id, { title: '', body: idea.text }),
    onSuccess: (shown, idea) => {
      storeEvent(shown);
      setIdeas((old) => old.map((i) => (i.id === idea.id ? { ...i, revealed: true } : i)));
    },
  });

  async function ask() {
    setEditing(null);
    const text = await writer.write((options) => props.ask(hint, options));
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
      <div className="ai-ideas">
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setOpen(true);
            if (ideas.length === 0) void ask();
          }}
        >
          {props.openLabel}
        </button>
      </div>
    );
  }

  const pending = writer.pending?.split('\n').filter(Boolean) ?? [];
  return (
    <section className="ai-ideas" aria-labelledby={headingId}>
      <p id={headingId} className="field-label">
        {props.label}
      </p>
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
                    label={props.ideaLabel}
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
                      {action &&
                        (action.confirm ? (
                          <ConfirmButton
                            small
                            confirmLabel={action.confirm}
                            disabled={action.disabled}
                            onConfirm={() => action.onClick(idea.text)}
                          >
                            {action.label}
                          </ConfirmButton>
                        ) : (
                          <button
                            type="button"
                            className="button small"
                            disabled={action.disabled}
                            onClick={() => action.onClick(idea.text)}
                          >
                            {action.label}
                          </button>
                        ))}
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
          <span className="field-label">{props.hint.label}</span>
          <input
            value={hint}
            maxLength={300}
            placeholder={props.hint.placeholder}
            onChange={(change) => setHint(change.target.value)}
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
