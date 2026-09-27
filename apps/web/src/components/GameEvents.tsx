import { OUTCOME_GUIDES, OUTCOME_LABELS, doublesShift } from '@dungeon-copilot/rules';
import type { GameEvent, GameRoll } from '@dungeon-copilot/shared';
import type { ReactNode } from 'react';
import { signed } from '../rules-text';
import { Dice } from './Dice';

export const eventTime = (event: GameEvent) =>
  new Date(event.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

/** "Normal (10)" o "Guardia veterano" / "Kael (Acrobacias)". */
export function targetText(roll: GameRoll): string {
  const { target } = roll;
  if (target.kind === 'difficulty') return target.label;
  return target.check ? `${target.label} (${target.check})` : target.label;
}

/** Una tirada de la partida: quién, contra qué, los dados y qué significa el resultado. */
export function RollView({ roll, big = false }: { roll: GameRoll; big?: boolean }) {
  const { result } = roll;
  const shift =
    result.kind === 'test'
      ? doublesShift(result.roller.dice.kept)
      : doublesShift(result.actor.dice.kept) - doublesShift(result.opponent.dice.kept);

  return (
    <div className="roll-view">
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
 * una tirada, como las complicaciones que propone la IA al máster.
 */
export function EventCard({ event, children }: { event: GameEvent; children?: ReactNode }) {
  const meta = (
    <p className="feed-meta">
      {eventTime(event)}
      {event.authorName && <> · {event.authorName}</>}
      {event.visibility === 'master' && <span className="badge secret">Solo tú lo ves</span>}
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
        <article className="feed-item">
          {meta}
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
  }
}
