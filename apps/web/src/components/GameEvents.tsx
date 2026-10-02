import {
  OUTCOME_GUIDES,
  OUTCOME_LABELS,
  SEVERITIES,
  SEVERITY_LABELS,
  defaultSkillCatalog,
  doublesShift,
} from '@dungeon-copilot/rules';
import {
  INTERVENTION_LABELS,
  groupLabel,
  rerollerLabel,
  type Combatant,
  type CombatantRef,
  type Floor,
  type GameEvent,
  type GameRoll,
  type InterventionIntent,
  type RollRequestEvent,
  type SettledHow,
} from '@dungeon-copilot/shared';
import type { ReactNode } from 'react';
import { signed } from '../rules-text';
import { Avatar } from './Avatar';
import { Dice } from './Dice';

export const eventTime = (event: GameEvent) =>
  new Date(event.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

/** "Kael, Mira y Tor". */
export const listText = (names: string[]) =>
  new Intl.ListFormat('es', { style: 'long', type: 'conjunction' }).format(names);

/** «Cuerpo a cuerpo contra 3 bandidos»: lo que pide un jugador, en la cola y en el registro. */
export const intentLabel = (intent: InterventionIntent, target?: CombatantRef) =>
  target ? `${INTERVENTION_LABELS[intent]} contra ${target.name}` : INTERVENTION_LABELS[intent];

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

/** Quien entra en un combate, con lo que sacó en la iniciativa: «Mira 15 (6 + 6 + 3)». */
function InitiativeList({ combatants }: { combatants: Combatant[] }) {
  return (
    <ol className="initiative-list">
      {combatants.map((combatant) => {
        const { id, initiative } = combatant;
        return (
          <li key={id}>
            <strong>{groupLabel(combatant)}</strong> {initiative.total}{' '}
            <span className="muted">
              ({initiative.dice.kept.join(' + ')} + {initiative.bonus})
            </span>
            {initiative.notes.map((note) => (
              <span key={note} className="roll-note">
                {note}
              </span>
            ))}
          </li>
        );
      })}
    </ol>
  );
}

type DamageEvent = GameEvent & { kind: 'damage' };

/** «Golpe de Garrick a Kael: 2 de daño.», o «Golpe a Bandidos: 1 de daño.» si no se sabe de quién. */
export function blowLine(event: DamageEvent): string {
  const from = event.by ? ` de ${event.by.name}` : '';
  const dodged = event.dodged ? ', con Esquiva prodigiosa' : '';
  return `Golpe${from} a ${event.target.name}: ${event.amount} de daño${dodged}.`;
}

/**
 * Cómo queda quien recibe un golpe. De los PNJ, la mesa sabe si caen; lo que aguantan, solo el
 * máster.
 */
export function blowResult(event: DamageEvent, master: boolean): string {
  const { target } = event;
  if (target.kind === 'character') {
    const worse =
      SEVERITIES.indexOf(target.after.severity) > SEVERITIES.indexOf(target.before.severity);
    if (!worse) return `Rasguños: ${target.after.scratches}.`;
    return `Queda ${SEVERITY_LABELS[target.after.severity].toLowerCase()}.`;
  }
  const standing = target.count - target.harm.down;
  const out = event.position ? ' Sale del combate.' : '';
  if (target.fell) {
    if (target.count === 1) return `Cae.${out}`;
    return standing === 0 ? `Caen todos.${out}` : `Cae uno: quedan ${standing} de ${target.count}.`;
  }
  return master ? `Lleva ${target.harm.damage} de ${target.toughness}.` : 'Aguanta.';
}

/** Una tirada de la partida: quién, contra qué, los dados y qué significa el resultado. */
export function RollView({
  roll,
  big = false,
  heading = true,
}: {
  roll: GameRoll;
  big?: boolean;
  /** Sin quién tira, si ya lo dice quien la enseña: solo contra qué. */
  heading?: boolean;
}) {
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
        {heading && (
          <>
            <strong>{roll.actor.label}</strong>
            {roll.actor.check && <> · {roll.actor.check}</>}{' '}
          </>
        )}
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
 * Un evento del registro de la partida, tal como se ve en la sala. Lo que solo marca el paso de
 * la partida (la palabra, los turnos, quién sale) va en una línea; los hitos (escenas, principio
 * y fin), como separadores; lo demás, en tarjetas. `children` va debajo de una tirada o de un
 * golpe, como las complicaciones que propone la IA al máster. Una tirada `superseded` se ha
 * repetido con Suerte y ya no cuenta; `settled` dice cómo acabó una intervención o una tirada
 * pedida que ya no espera. `master`: quien mira es el máster.
 */
export function EventCard({
  event,
  superseded = false,
  settled,
  survived = false,
  master = false,
  children,
}: {
  event: GameEvent;
  superseded?: boolean;
  settled?: SettledHow | undefined;
  /** De un golpe mortal: el personaje ha gastado Suerte para seguir con vida. */
  survived?: boolean;
  master?: boolean;
  children?: ReactNode;
}) {
  const partner = secretWith(event);
  const time = (
    <time className="feed-time" dateTime={event.createdAt}>
      {eventTime(event)}
    </time>
  );
  const seenBy =
    event.visibility === 'master' ? (
      <span className="badge secret">Solo tú lo ves</span>
    ) : event.visibility === 'private' ? (
      <span className="badge secret">
        {master ? `En secreto${partner ? ` con ${partner}` : ''}` : 'En secreto: el máster y tú'}
      </span>
    ) : null;
  /** La cabecera de una tarjeta: quién o qué, quién lo ve y cuándo. */
  const head = (title: ReactNode, who?: ReactNode) => (
    <header className="feed-head">
      {who}
      <span className="feed-title">{title}</span>
      {seenBy}
      {time}
    </header>
  );
  const line = (text: ReactNode, tone?: string) => (
    <p className={tone ? `feed-line ${tone}` : 'feed-line'}>
      {time} <span>{text}</span>
    </p>
  );
  const divider = (title: string, text?: string) => (
    <div className="feed-divider">
      <span className="eyebrow">{title}</span>
      {text && <span className="muted">{text}</span>}
    </div>
  );
  const recovering = (recovered: { name: string }[]) =>
    recovered.length === 0
      ? ''
      : `${listText(recovered.map(({ name }) => name))} ${recovered.length === 1 ? 'recupera' : 'recuperan'} el aliento: se borran sus rasguños.`;

  switch (event.kind) {
    case 'opened':
      return divider(
        `Empieza la partida ${event.number}${event.title ? `: ${event.title}` : ''}`,
        event.luckRefilled ? 'Todos los personajes empiezan con la Suerte llena.' : undefined,
      );
    case 'closed':
      return divider(
        'Fin de la partida',
        event.xpAwarded > 0 ? `Cada personaje gana ${event.xpAwarded} PX de fin de sesión.` : '',
      );
    case 'reveal':
      return (
        <article className="feed-item feed-reveal">
          {head(event.title || 'El máster describe')}
          <p className="prewrap">{event.body}</p>
        </article>
      );
    case 'note':
      return (
        <article className="feed-item feed-note">
          {head('Nota')}
          <p className="prewrap">{event.text}</p>
        </article>
      );
    case 'roll':
      return (
        <article
          className={superseded ? 'feed-item feed-roll feed-superseded' : 'feed-item feed-roll'}
        >
          {head(
            <>
              {event.roll.actor.label}
              {event.roll.actor.check && <span className="muted"> · {event.roll.actor.check}</span>}
            </>,
          )}
          {superseded && <p className="roll-superseded">No cuenta: se repitió con Suerte</p>}
          <RollView roll={event.roll} heading={false} />
          {children}
        </article>
      );
    case 'speech':
      return (
        <article className="feed-item feed-speech">
          {head(event.name, <Avatar name={event.name} size="small" />)}
          <p className="prewrap">{event.text}</p>
        </article>
      );
    case 'floor':
      return line(floorLine(event.floor));
    case 'intervention':
      return (
        <article className="feed-item feed-intervention">
          {head(
            <>
              {event.name}{' '}
              <span className="muted">· {intentLabel(event.intent, event.target)}</span>
            </>,
            <Avatar name={event.name} id={event.characterId} size="small" />,
          )}
          {event.text ? (
            <p className="prewrap feed-said">{event.text}</p>
          ) : (
            <p className="muted">Sin texto: lo cuenta de palabra.</p>
          )}
          <p className={`feed-status status-${settled ?? 'pending'}`}>
            {INTERVENTION_STATUS[settled ?? 'pending']}
          </p>
        </article>
      );
    case 'rollRequest':
      return (
        <article className="feed-item feed-request">
          {head(
            `Tirada pedida a ${event.name}`,
            <Avatar name={event.name} id={event.characterId} size="small" />,
          )}
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
    case 'map':
      return line(
        event.map ? (
          <>
            El máster pone el mapa <strong>{event.map.name}</strong>.
          </>
        ) : (
          'El máster quita el mapa.'
        ),
      );
    case 'token':
      // Dónde está cada uno se ve en el mapa, no en el registro.
      return null;
    case 'combatStarted':
      return (
        <article className="feed-item feed-combat">
          {head('¡Combate!')}
          <InitiativeList combatants={event.order} />
          {event.order[0] && <p className="muted">Empieza {event.order[0].name}.</p>}
        </article>
      );
    case 'turn':
      return line(
        <>
          Ronda {event.round} · Le toca a <strong>{event.combatant.name}</strong>.
        </>,
        'feed-turn',
      );
    case 'combatJoined':
      return (
        <article className="feed-item feed-combat">
          {head('Se unen al combate')}
          <InitiativeList combatants={event.joined} />
        </article>
      );
    case 'combatLeft':
      return line(
        <>
          Sale del combate: <strong>{event.left.name}</strong>.
        </>,
      );
    case 'damage':
      return (
        <article className="feed-item feed-damage">
          {head(blowLine(event))}
          <p>{blowResult(event, master)}</p>
          {event.target.kind === 'character' && event.target.lethal && (
            <p className="lethal">
              {survived
                ? `Golpe mortal: ${event.target.name} gasta un punto de Suerte y sigue con vida.`
                : `Golpe mortal: ${event.target.name} muere salvo que gaste un punto de Suerte.`}
            </p>
          )}
          {children}
        </article>
      );
    case 'survived':
      return line(
        <>
          <strong>{event.name}</strong> gasta un punto de Suerte y sigue con vida.
        </>,
      );
    case 'scene':
      return divider(`Escena: ${event.title}`, recovering(event.recovered));
    case 'ability': {
      const skill = defaultSkillCatalog.get(event.skill);
      return line(
        <>
          <strong>{event.name}</strong> usa {event.label}.
          {skill && <span className="muted"> {skill.description}</span>}
        </>,
      );
    }
    case 'combatEnded':
      return divider(
        'Fin del combate',
        `${event.rounds === 1 ? 'Ha durado una ronda.' : `Ha durado ${event.rounds} rondas.`} ${recovering(event.recovered)}`.trim(),
      );
  }
}
