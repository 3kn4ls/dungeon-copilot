import { OUTCOME_GUIDES, OUTCOME_LABELS, doublesShift } from '@dungeon-copilot/rules';
import {
  INTERVENTION_LABELS,
  rerollerLabel,
  type Floor,
  type GameEvent,
  type GameRoll,
  type RollRequestEvent,
  type SettledHow,
} from '@dungeon-copilot/shared';
import type { ReactNode } from 'react';
import { signed } from '../rules-text';
import { Dice } from './Dice';

export const eventTime = (event: GameEvent) =>
  new Date(event.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

/** "Normal (10)" o "Guardia veterano" / "Kael (Acrobacias)". */
export function targetText({ target }: Pick<GameRoll, 'target'>): string {
  if (target.kind === 'difficulty') return target.label;
  return target.check ? `${target.label} (${target.check})` : target.label;
}

/**
 * Qué tiene que tirar el personaje al que el máster pide una tirada: "Atletismo contra Difícil
 * (12)" o, si se defiende, "Defensa contra Orco (Acrobacias)".
 */
export function requestedText(event: RollRequestEvent): string {
  const { actor, target } = event.preview;
  if (actor.characterId === event.characterId) {
    return `${actor.check ?? actor.label} contra ${targetText(event.preview)}`;
  }
  const check = target.kind === 'opposed' ? target.check : undefined;
  return check ? `Defensa contra ${actor.label} (${check})` : `Defensa contra ${actor.label}`;
}

/** Quién tiene la palabra, como se cuenta en el registro. */
export function floorLine(floor: Floor): string {
  switch (floor.kind) {
    case 'master':
      return 'El máster retoma la palabra.';
    case 'table':
      return 'La palabra es de la mesa: ¿qué hacéis?';
    case 'character':
      return `Tiene la palabra ${floor.name}.`;
  }
}

const INTERVENTION_STATUS: Record<SettledHow | 'pending', string> = {
  pending: 'Esperando al máster',
  answered: 'Atendida',
  dismissed: 'Ahora no',
  withdrawn: 'Retirada',
};

const REQUEST_STATUS: Record<SettledHow | 'pending', string> = {
  pending: 'Pendiente',
  answered: 'Hecha',
  dismissed: 'Retirada',
  withdrawn: 'Retirada',
};

/** Con quién es un evento en secreto, si se sabe: para que el máster lo tenga claro. */
function secretWith(event: GameEvent): string | undefined {
  switch (event.kind) {
    case 'intervention':
    case 'rollRequest':
      return event.name;
    case 'reveal':
    case 'speech':
      return event.to?.name;
    default:
      return undefined;
  }
}

/** Una tirada de la partida: quién, contra qué, los dados y qué significa el resultado. */
export function RollView({ roll, big = false }: { roll: GameRoll; big?: boolean }) {
  const { result } = roll;
  const luckyOne = rerollerLabel(roll);
  const shift =
    result.kind === 'test'
      ? doublesShift(result.roller.dice.kept)
      : doublesShift(result.actor.dice.kept) - doublesShift(result.opponent.dice.kept);

  return (
    <div className="roll-view">
      {luckyOne && <p className="roll-luck">{luckyOne} repite con Suerte</p>}
      <p className="roll-heading">
        <strong>{roll.actor.label}</strong>
        {roll.actor.check && <> · {roll.actor.check}</>}{' '}
        <span className="muted">contra {targetText(roll)}</span>
      </p>
      <p className={`outcome outcome-text-${result.outcome}`}>{OUTCOME_LABELS[result.outcome]}</p>
      <div className="rollers">
        {result.kind === 'test' ? (
          <>
            <Dice
              label={roll.actor.label}
              dice={result.roller.dice}
              total={result.roller.total}
              big={big}
            />
            <p className="versus">
              contra <strong>{result.difficulty}</strong>
            </p>
          </>
        ) : (
          <>
            <Dice
              label={roll.actor.label}
              dice={result.actor.dice}
              total={result.actor.total}
              big={big}
            />
            <p className="versus">contra</p>
            <Dice
              label={roll.target.kind === 'opposed' ? roll.target.label : 'Rival'}
              dice={result.opponent.dice}
              total={result.opponent.total}
              big={big}
            />
          </>
        )}
      </div>
      {!big && (
        <p className="margin">
          Margen <strong>{signed(result.margin)}</strong>
          {shift !== 0 && <> · los dobles {shift > 0 ? 'suben' : 'bajan'} el resultado</>}
        </p>
      )}
      {roll.notes.map((note) => (
        <p key={note} className="roll-note">
          {note}
        </p>
      ))}
      {!big && <p className="guide">{OUTCOME_GUIDES[roll.situation][result.outcome]}</p>}
    </div>
  );
}

/**
 * Un evento del registro de la partida, tal como se ve en la sala. `children` va debajo de
 * una tirada, como las complicaciones que propone la IA al máster. Una tirada `superseded`
 * se ha repetido con Suerte y ya no cuenta; `settled` dice cómo acabó una intervención o una
 * tirada pedida que ya no espera. `master`: quien mira es el máster.
 */
export function EventCard({
  event,
  superseded = false,
  settled,
  master = false,
  children,
}: {
  event: GameEvent;
  superseded?: boolean;
  settled?: SettledHow | undefined;
  master?: boolean;
  children?: ReactNode;
}) {
  const partner = secretWith(event);
  const meta = (
    <p className="feed-meta">
      {eventTime(event)}
      {event.authorName && <> · {event.authorName}</>}
      {event.visibility === 'master' && <span className="badge secret">Solo tú lo ves</span>}
      {event.visibility === 'private' && (
        <span className="badge secret">
          {master ? `En secreto${partner ? ` con ${partner}` : ''}` : 'En secreto: el máster y tú'}
        </span>
      )}
    </p>
  );

  switch (event.kind) {
    case 'opened':
      return (
        <article className="feed-item feed-milestone">
          {meta}
          <h3>Empieza la partida {event.number}</h3>
          {event.title && <p>{event.title}</p>}
          {event.luckRefilled && (
            <p className="muted">Todos los personajes empiezan con la Suerte llena.</p>
          )}
        </article>
      );
    case 'closed':
      return (
        <article className="feed-item feed-milestone">
          {meta}
          <h3>Fin de la partida</h3>
          {event.xpAwarded > 0 && (
            <p className="muted">Cada personaje gana {event.xpAwarded} PX de fin de sesión.</p>
          )}
        </article>
      );
    case 'reveal':
      return (
        <article className="feed-item feed-reveal">
          {meta}
          {event.title && <h3>{event.title}</h3>}
          <p className="prewrap">{event.body}</p>
        </article>
      );
    case 'note':
      return (
        <article className="feed-item feed-note">
          {meta}
          <p className="prewrap">{event.text}</p>
        </article>
      );
    case 'roll':
      return (
        <article className={superseded ? 'feed-item feed-superseded' : 'feed-item'}>
          {meta}
          {superseded && <p className="roll-superseded">No cuenta: se repitió con Suerte</p>}
          <RollView roll={event.roll} />
          {children}
        </article>
      );
    case 'speech':
      return (
        <article className="feed-item feed-speech">
          {meta}
          <h3>{event.name}</h3>
          <p className="prewrap">{event.text}</p>
        </article>
      );
    case 'floor':
      return (
        <article className="feed-item feed-floor">
          {meta}
          <p>{floorLine(event.floor)}</p>
        </article>
      );
    case 'intervention':
      return (
        <article className="feed-item feed-intervention">
          {meta}
          <h3>
            {event.name} · {INTERVENTION_LABELS[event.intent]}
          </h3>
          {event.text ? (
            <p className="prewrap">{event.text}</p>
          ) : (
            <p className="muted">Pide la palabra sin escribir nada.</p>
          )}
          <p className={`feed-status status-${settled ?? 'pending'}`}>
            {INTERVENTION_STATUS[settled ?? 'pending']}
          </p>
        </article>
      );
    case 'rollRequest':
      return (
        <article className="feed-item feed-request">
          {meta}
          <h3>El máster pide una tirada a {event.name}</h3>
          <p>{requestedText(event)}</p>
          <p className={`feed-status status-${settled ?? 'pending'}`}>
            {REQUEST_STATUS[settled ?? 'pending']}
          </p>
          {children}
        </article>
      );
    case 'settled':
      // Solo cambia cómo se ven la intervención o la tirada pedida que cierra.
      return null;
  }
}
