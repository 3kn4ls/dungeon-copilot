import {
  INTERVENTION_LABELS,
  INTERVENTION_MAX,
  type CharacterView,
  type Combat,
  type CombatantRef,
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
import { Avatar } from './Avatar';
import { eventTime, intentLabel } from './GameEvents';
import { holdsFloor } from './Floor';
import { Icon, type IconName } from './Icon';
import { ErrorNote } from './ui';

/** Los botones de quien no pelea: fuera de combate, atacar es empezar una pelea. */
const NARRATION_INTENTS: InterventionIntent[] = ['speak', 'act', 'ask', 'attack'];

/** Los botones de quien pelea, para su turno. Hechizo, solo con Hechicería. */
const COMBAT_INTENTS: InterventionIntent[] = ['melee', 'ranged', 'spell', 'act', 'speak', 'ask'];

/** Lo que va contra alguien del combate. */
const TARGETED: InterventionIntent[] = ['melee', 'ranged', 'spell'];

/** Qué puede escribir el jugador en cada intervención, si quiere. */
const TEXT_LABELS: Record<InterventionIntent, (name: string) => string> = {
  speak: (name) => `Qué dice ${name} (opcional)`,
  act: (name) => `Qué hace ${name} (opcional)`,
  ask: () => 'Qué le preguntas al máster (opcional)',
  attack: (name) => `A quién ataca ${name} y cómo (opcional)`,
  melee: (name) => `Cómo ataca ${name} (opcional)`,
  ranged: (name) => `Cómo dispara ${name} (opcional)`,
  spell: (name) => `Qué hechizo lanza ${name} (opcional)`,
};

/** El icono de cada botón: atacar para empezar una pelea es el mismo que cuerpo a cuerpo. */
const INTENT_ICONS: Record<InterventionIntent, IconName> = {
  speak: 'speak',
  act: 'act',
  ask: 'ask',
  attack: 'melee',
  melee: 'melee',
  ranged: 'ranged',
  spell: 'spell',
};

const PLACEHOLDERS: Record<InterventionIntent, string> = {
  speak: '¿Quién es el encapuchado de la esquina?',
  act: 'Me acerco a la barra sin que me vean',
  ask: '¿Hay alguna ventana en la habitación?',
  attack: 'Le lanzo la jarra al encapuchado',
  melee: 'Le corto el paso al jefe',
  ranged: 'Disparo desde detrás de la mesa volcada',
  spell: 'Una ráfaga de fuego',
};

/** Lo que quiere hacer, para decirlo en una frase: «atacar a 3 bandidos cuerpo a cuerpo». */
export function intentText(intent: InterventionIntent, target?: CombatantRef): string {
  const to = target ? ` a ${target.name}` : '';
  switch (intent) {
    case 'attack':
      return `atacar${to}`;
    case 'melee':
      return `atacar${to} cuerpo a cuerpo`;
    case 'ranged':
      return `atacar${to} a distancia`;
    case 'spell':
      return target ? `lanzar un hechizo contra ${target.name}` : 'lanzar un hechizo';
    default:
      return INTERVENTION_LABELS[intent].toLowerCase();
  }
}

/**
 * Los botones del jugador: hablar, actuar, preguntar al máster o atacar con su personaje, con
 * texto o sin él; en combate, si su personaje pelea, los de su turno, contra quien elija. Sin la
 * palabra es pedirla; con ella, intervenir. Cada personaje espera al máster con una intervención
 * a la vez, y la puede retirar.
 */
export function InterventionPanel(props: {
  game: GameDetail;
  floor: Floor;
  combat: Combat | null;
  /** Los personajes de quien juega. */
  characters: CharacterView[];
  events: GameEvent[];
  settled: ReadonlyMap<number, SettledHow>;
}) {
  const { game, floor, combat, characters, events, settled } = props;
  const [chosen, setChosen] = useState<string | null>(null);
  const [intent, setIntent] = useState<InterventionIntent | null>(null);
  const [text, setText] = useState('');
  const [secret, setSecret] = useState(false);
  /** Contra quién, si lo ha elegido: '' es nadie en concreto. */
  const [targetChoice, setTargetChoice] = useState<string | null>(null);
  const storeEvent = useStoreGameEvent(game.id);
  const character = characters.find((c) => c.id === chosen) ?? characters[0];

  const intervene = useMutation({
    mutationFn: (body: { characterId: string; intent: InterventionIntent; targetId?: string }) =>
      api.intervene(game.id, { ...body, text, secret }),
    onSuccess: (event) => {
      storeEvent(event);
      setIntent(null);
      setText('');
      setSecret(false);
      setTargetChoice(null);
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
  const fighting = combat?.order.some((combatant) => combatant.id === character.id) ?? false;
  const intents = fighting
    ? COMBAT_INTENTS.filter(
        (option) => option !== 'spell' || character.advancedSkills.includes('sorcery'),
      )
    : NARRATION_INTENTS;
  // Contra quién: quien elija o, de entrada, los primeros PNJ del combate.
  const others = combat?.order.filter((combatant) => combatant.id !== character.id) ?? [];
  const target =
    targetChoice === ''
      ? undefined
      : (others.find((combatant) => combatant.id === targetChoice) ??
        others.find((combatant) => combatant.kind === 'npc'));
  const targeted = intent !== null && fighting && TARGETED.includes(intent) && others.length > 0;

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
            {character.name} espera al máster para {intentText(waiting.intent, waiting.target)}
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
            if (!intent) return;
            intervene.mutate({
              characterId: character.id,
              intent,
              ...(targeted && target ? { targetId: target.id } : {}),
            });
          }}
        >
          {last && settled.get(last.id) === 'dismissed' && (
            <p className="muted">El máster te ha dicho que ahora no.</p>
          )}
          <div
            className={intents.length > 4 ? 'intents six' : 'intents'}
            role="group"
            aria-label="Qué quieres hacer"
          >
            {intents.map((option) => (
              <button
                key={option}
                type="button"
                className="intent-button"
                aria-pressed={intent === option}
                onClick={() => setIntent(intent === option ? null : option)}
              >
                <Icon name={INTENT_ICONS[option]} size={22} />
                {INTERVENTION_LABELS[option]}
              </button>
            ))}
          </div>
          {intent && intents.includes(intent) && (
            <>
              {targeted && (
                <label className="field">
                  <span className="field-label">Contra quién</span>
                  <select
                    value={target?.id ?? ''}
                    onChange={(event) => setTargetChoice(event.target.value)}
                  >
                    {others.map((combatant) => (
                      <option key={combatant.id} value={combatant.id}>
                        {combatant.name}
                      </option>
                    ))}
                    <option value="">Nadie en concreto</option>
                  </select>
                </label>
              )}
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

/**
 * Adónde lleva el máster una intervención desde la cola: a pedir una tirada, a responder (como
 * PNJ o con una descripción) o a empezar un combate.
 */
export type HandoffTarget = 'roll' | 'talk' | 'reveal' | 'combat';

/** «fight»: empezar un combate o, si ya hay uno, meter en él a quien ataca. */
type QueueAction = 'floor' | 'fight' | Exclude<HandoffTarget, 'combat'>;

/** Lo que ofrece la cola para cada tipo de intervención, lo más probable primero. */
const QUEUE_ACTIONS: Record<InterventionIntent, QueueAction[]> = {
  speak: ['floor', 'talk', 'roll'],
  act: ['roll', 'floor'],
  ask: ['reveal', 'roll', 'floor'],
  attack: ['fight', 'roll', 'floor'],
  melee: ['roll', 'floor'],
  ranged: ['roll', 'floor'],
  spell: ['roll', 'floor'],
};

const QUEUE_LABELS: Record<Exclude<QueueAction, 'fight'>, string> = {
  floor: 'Dar la palabra',
  talk: 'Responder como PNJ',
  reveal: 'Responder',
  roll: 'Pedir tirada',
};

/**
 * Las intervenciones que esperan al máster, de la más antigua a la última. Con cada una puede
 * dar la palabra, pedir una tirada, responder (como PNJ o con una descripción), empezar un
 * combate o meter en él a quien ataca, darla por atendida o decir que ahora no.
 */
export function InterventionQueue(props: {
  game: GameDetail;
  floor: Floor;
  combat: Combat | null;
  pending: InterventionEvent[];
  onHandoff: (to: HandoffTarget, intervention: InterventionEvent) => void;
}) {
  const { game, floor, combat, pending, onHandoff } = props;
  const storeEvent = useStoreGameEvent(game.id);
  const giveFloor = useMutation({
    mutationFn: (intervention: InterventionEvent) =>
      api.giveFloor(game.id, {
        to: { kind: 'character', characterId: intervention.characterId },
        answers: intervention.id,
      }),
    onSuccess: storeEvent,
  });
  const join = useMutation({
    mutationFn: (intervention: InterventionEvent) =>
      api.joinCombat(game.id, {
        combatants: [{ kind: 'character', characterId: intervention.characterId }],
        answers: intervention.id,
      }),
    onSuccess: storeEvent,
  });
  const answer = useMutation({
    mutationFn: ({ id, how }: { id: number; how: 'answered' | 'dismissed' }) =>
      api.answerIntervention(game.id, id, { how }),
    onSuccess: storeEvent,
  });
  const busy = giveFloor.isPending || join.isPending || answer.isPending;

  // Sin nadie esperando no se enseña nada: lo dice quien enseña la cola.
  if (pending.length === 0) return null;
  return (
    <div className="stack tight">
      <ol className="queue">
        {pending.map((intervention) => {
          const talking = holdsFloor(floor, [intervention.characterId]);
          const fighting = combat?.order.some(({ id }) => id === intervention.characterId);
          const actions = QUEUE_ACTIONS[intervention.intent].filter(
            (action) => !(action === 'floor' && talking) && !(action === 'fight' && fighting),
          );
          const run = (action: QueueAction) => {
            if (action === 'floor') giveFloor.mutate(intervention);
            else if (action === 'fight' && combat) join.mutate(intervention);
            else onHandoff(action === 'fight' ? 'combat' : action, intervention);
          };
          return (
            <li
              key={intervention.id}
              className={intervention.visibility === 'private' ? 'queue-item secret' : 'queue-item'}
            >
              <p className="queue-who">
                <Avatar name={intervention.name} id={intervention.characterId} size="small" />
                <strong>{intervention.name}</strong>
                <span>{intentLabel(intervention.intent, intervention.target)}</span>
                {intervention.visibility === 'private' && (
                  <span className="badge secret">En secreto</span>
                )}
                {talking && <span className="badge">Tiene la palabra</span>}
                <span className="feed-time">{eventTime(intervention)}</span>
              </p>
              {intervention.text ? (
                <p className="prewrap queue-said">{intervention.text}</p>
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
                    onClick={() => run(action)}
                  >
                    {action === 'fight'
                      ? combat
                        ? 'Meter en el combate'
                        : 'Empezar combate'
                      : QUEUE_LABELS[action]}
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
      <ErrorNote error={giveFloor.error ?? join.error ?? answer.error} />
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
        {intentText(intervention.intent, intervention.target)})
        {intervention.text && <>: «{intervention.text}»</>}
        {intervention.visibility === 'private' && <span className="badge secret">En secreto</span>}
      </p>
      <button type="button" className="link-button" onClick={onCancel}>
        No responder a esto
      </button>
    </div>
  );
}
