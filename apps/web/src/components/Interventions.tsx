import {
  INTERVENTION_INTENTS,
  INTERVENTION_LABELS,
  INTERVENTION_MAX,
  type CharacterView,
  type Floor,
  type GameDetail,
  type GameEvent,
  type InterventionEvent,
  type InterventionIntent,
  type SettledHow,
} from '@dungeon-copilot/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useStoreGameEvent } from '../queries';
import { eventTime } from './GameEvents';
import { holdsFloor } from './Floor';
import { ErrorNote } from './ui';

/** Qué puede escribir el jugador en cada intervención, si quiere. */
const TEXT_LABELS: Record<InterventionIntent, (name: string) => string> = {
  speak: (name) => `Qué dice ${name} (opcional)`,
  act: (name) => `Qué hace ${name} (opcional)`,
  ask: () => 'Qué le preguntas al máster (opcional)',
  attack: (name) => `A quién ataca ${name} y cómo (opcional)`,
};

const PLACEHOLDERS: Record<InterventionIntent, string> = {
  speak: '¿Quién es el encapuchado de la esquina?',
  act: 'Me acerco a la barra sin que me vean',
  ask: '¿Hay alguna ventana en la habitación?',
  attack: 'Le lanzo la jarra al encapuchado',
};

/**
 * Los botones del jugador: hablar, actuar, preguntar al máster o atacar con su personaje, con
 * texto o sin él. Sin la palabra es pedirla; con ella, intervenir. Cada personaje espera al
 * máster con una intervención a la vez, y la puede retirar.
 */
export function InterventionPanel(props: {
  game: GameDetail;
  floor: Floor;
  /** Los personajes de quien juega. */
  characters: CharacterView[];
  events: GameEvent[];
  settled: ReadonlyMap<number, SettledHow>;
}) {
  const { game, floor, characters, events, settled } = props;
  const [chosen, setChosen] = useState<string | null>(null);
  const [intent, setIntent] = useState<InterventionIntent | null>(null);
  const [text, setText] = useState('');
  const [secret, setSecret] = useState(false);
  const storeEvent = useStoreGameEvent(game.id);
  const character = characters.find((c) => c.id === chosen) ?? characters[0];

  const intervene = useMutation({
    mutationFn: (body: { characterId: string; intent: InterventionIntent }) =>
      api.intervene(game.id, { ...body, text, secret }),
    onSuccess: (event) => {
      storeEvent(event);
      setIntent(null);
      setText('');
      setSecret(false);
    },
  });
  const withdraw = useMutation({
    mutationFn: (eventId: number) => api.withdrawIntervention(game.id, eventId),
    onSuccess: storeEvent,
  });

  if (!character) return null;
  const own = events.filter(
    (event): event is InterventionEvent =>
      event.kind === 'intervention' && event.characterId === character.id,
  );
  const last = own.at(-1);
  const waiting = last && !settled.has(last.id) ? last : undefined;
  const hasFloor = holdsFloor(floor, [character.id]);

  return (
    <div className="stack tight">
      {characters.length > 1 && (
        <label className="field">
          <span className="field-label">Con quién</span>
          <select value={character.id} onChange={(event) => setChosen(event.target.value)}>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {waiting ? (
        <div className="waiting">
          <p>
            {character.name} espera al máster para{' '}
            {INTERVENTION_LABELS[waiting.intent].toLowerCase()}
            {waiting.text && <>: «{waiting.text}»</>}
            {waiting.visibility === 'private' && <span className="badge secret">En secreto</span>}
          </p>
          <button
            type="button"
            className="button small"
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate(waiting.id)}
          >
            Retirar
          </button>
          <ErrorNote error={withdraw.error} />
        </div>
      ) : (
        <form
          className="stack tight"
          onSubmit={(event) => {
            event.preventDefault();
            if (intent) intervene.mutate({ characterId: character.id, intent });
          }}
        >
          {last && settled.get(last.id) === 'dismissed' && (
            <p className="muted">El máster te ha dicho que ahora no.</p>
          )}
          <div className="intents" role="group" aria-label="Qué quieres hacer">
            {INTERVENTION_INTENTS.map((option) => (
              <button
                key={option}
                type="button"
                className="intent-button"
                aria-pressed={intent === option}
                onClick={() => setIntent(intent === option ? null : option)}
              >
                {INTERVENTION_LABELS[option]}
              </button>
            ))}
          </div>
          {intent && (
            <>
              <label className="field">
                <span className="field-label">{TEXT_LABELS[intent](character.name)}</span>
                <textarea
                  rows={2}
                  maxLength={INTERVENTION_MAX}
                  value={text}
                  placeholder={PLACEHOLDERS[intent]}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={secret}
                  onChange={(event) => setSecret(event.target.checked)}
                />
                En secreto: solo lo ve el máster
              </label>
              <button type="submit" className="button primary" disabled={intervene.isPending}>
                {hasFloor ? 'Intervenir' : 'Pedir la palabra'}
              </button>
            </>
          )}
          <ErrorNote error={intervene.error} />
        </form>
      )}
    </div>
  );
}

/** Lo que el máster elige hacer con una intervención desde la cola, en sus acciones. */
export interface Handoff {
  /** Pedir una tirada, responder como PNJ o responder con una descripción. */
  to: 'roll' | 'talk' | 'reveal';
  intervention: InterventionEvent;
}

/** Lo que ofrece la cola para cada tipo de intervención, lo más probable primero. */
const QUEUE_ACTIONS: Record<InterventionIntent, ('floor' | Handoff['to'])[]> = {
  speak: ['floor', 'talk', 'roll'],
  act: ['roll', 'floor'],
  ask: ['reveal', 'roll', 'floor'],
  attack: ['roll', 'floor'],
};

const QUEUE_LABELS: Record<'floor' | Handoff['to'], string> = {
  floor: 'Dar la palabra',
  talk: 'Responder como PNJ',
  reveal: 'Responder',
  roll: 'Pedir tirada',
};

/**
 * Las intervenciones que esperan al máster, de la más antigua a la última. Con cada una puede
 * dar la palabra, pedir una tirada, responder (como PNJ o con una descripción), darla por
 * atendida o decir que ahora no.
 */
export function InterventionQueue(props: {
  game: GameDetail;
  floor: Floor;
  pending: InterventionEvent[];
  onHandoff: (handoff: Handoff) => void;
}) {
  const { game, floor, pending, onHandoff } = props;
  const storeEvent = useStoreGameEvent(game.id);
  const giveFloor = useMutation({
    mutationFn: (intervention: InterventionEvent) =>
      api.giveFloor(game.id, {
        to: { kind: 'character', characterId: intervention.characterId },
        answers: intervention.id,
      }),
    onSuccess: storeEvent,
  });
  const answer = useMutation({
    mutationFn: ({ id, how }: { id: number; how: 'answered' | 'dismissed' }) =>
      api.answerIntervention(game.id, id, { how }),
    onSuccess: storeEvent,
  });
  const busy = giveFloor.isPending || answer.isPending;

  if (pending.length === 0) {
    return <p className="muted">Nadie ha pedido la palabra.</p>;
  }
  return (
    <div className="stack tight">
      <p className="field-label">Piden la palabra</p>
      <ol className="queue">
        {pending.map((intervention) => {
          const talking = holdsFloor(floor, [intervention.characterId]);
          const actions = QUEUE_ACTIONS[intervention.intent].filter(
            (action) => !(action === 'floor' && talking),
          );
          return (
            <li key={intervention.id} className="queue-item">
              <p className="queue-who">
                <strong>{intervention.name}</strong> · {INTERVENTION_LABELS[intervention.intent]}
                <span className="muted"> · {eventTime(intervention)}</span>
                {intervention.visibility === 'private' && (
                  <span className="badge secret">En secreto</span>
                )}
                {talking && <span className="badge">Tiene la palabra</span>}
              </p>
              {intervention.text ? (
                <p className="prewrap">{intervention.text}</p>
              ) : (
                <p className="muted">Sin texto: te lo dirá de palabra.</p>
              )}
              <div className="chat-actions">
                {actions.map((action, index) => (
                  <button
                    key={action}
                    type="button"
                    className={index === 0 ? 'button small primary' : 'button small'}
                    disabled={busy}
                    onClick={() =>
                      action === 'floor'
                        ? giveFloor.mutate(intervention)
                        : onHandoff({ to: action, intervention })
                    }
                  >
                    {QUEUE_LABELS[action]}
                  </button>
                ))}
                <button
                  type="button"
                  className="link-button"
                  disabled={busy}
                  onClick={() => answer.mutate({ id: intervention.id, how: 'answered' })}
                >
                  Atendida
                </button>
                <button
                  type="button"
                  className="link-button"
                  disabled={busy}
                  onClick={() => answer.mutate({ id: intervention.id, how: 'dismissed' })}
                >
                  Ahora no
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <ErrorNote error={giveFloor.error ?? answer.error} />
    </div>
  );
}

/**
 * En las acciones del máster, la intervención a la que está respondiendo: lo que enseñe o pida
 * la atenderá. Puede dejarlo y usar el formulario para otra cosa.
 */
export function AnsweringNote({
  intervention,
  onCancel,
}: {
  intervention: InterventionEvent;
  onCancel: () => void;
}) {
  return (
    <div className="answering">
      <p>
        Respondes a <strong>{intervention.name}</strong> (
        {INTERVENTION_LABELS[intervention.intent].toLowerCase()})
        {intervention.text && <>: «{intervention.text}»</>}
        {intervention.visibility === 'private' && <span className="badge secret">En secreto</span>}
      </p>
      <button type="button" className="link-button" onClick={onCancel}>
        No responder a esto
      </button>
    </div>
  );
}
