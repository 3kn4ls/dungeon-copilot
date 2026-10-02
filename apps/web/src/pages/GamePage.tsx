import {
  ATTRIBUTES,
  ATTRIBUTE_INFO,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  EDGE_LABELS,
  NPC_PROFILES,
  SEVERITY_LABELS,
  SITUATION_LABELS,
  XP_AWARDS,
  defaultSkillCatalog,
  needsComplication,
  opposedOdds,
  rangedDifficulty,
  successChance,
  testOdds,
  type DifficultyLevel,
  type Edge,
  type Range,
  type Situation,
} from '@dungeon-copilot/rules';
import {
  GAME_STATUS_LABELS,
  currentCombat,
  isCheckedIntent,
  currentFloor,
  currentScene,
  gameName,
  pendingInterventions,
  pendingRollRequests,
  settledEvents,
  spentAbilities,
  supersededRolls,
  turnOf,
  type AskRollRequest,
  type CharacterView,
  type CheckSuggestion,
  type Combat,
  type GameDetail,
  type GameEvent,
  type GameRollRequest,
  type GameState,
  type GameSummary,
  type InterventionEvent,
  type NpcView,
  type SettledHow,
  type SpentAbilities,
} from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAiText } from '../ai';
import { ApiError, api } from '../api';
import {
  CombatOrder,
  CombatTracker,
  EndCombat,
  EndTurn,
  JoinCombat,
  StartCombat,
  TurnStatus,
} from '../components/Combat';
import { BlowNarration } from '../components/CombatIdeas';
import { Complications } from '../components/Complications';
import { CheckHint, LeakWarning, useLeakGuard } from '../components/Decisions';
import {
  FallenActions,
  ManualDamage,
  MoraleHint,
  RollDamage,
  moraleBlow,
  type DamageEvent,
} from '../components/Damage';
import { FloorControl, FloorStatus, holdsFloor } from '../components/Floor';
import { EventCard } from '../components/GameEvents';
import { AiIdeas } from '../components/Ideas';
import {
  AnsweringNote,
  InterventionPanel,
  InterventionQueue,
  type HandoffTarget,
} from '../components/Interventions';
import { LuckReroll } from '../components/Luck';
import { NpcChat } from '../components/NpcChat';
import { NpcSheet, profileText } from '../components/Npcs';
import { RecapPanel } from '../components/Recap';
import { RecipientSelect, useRecipient } from '../components/Recipient';
import {
  PendingRollRequests,
  RequestedRollCard,
  RollRequestAction,
} from '../components/RollRequests';
import { LimitedAbilities, SceneControl, SceneLine } from '../components/Scenes';
import { ScreenLink } from '../components/ScreenLink';
import {
  ConfirmButton,
  ErrorNote,
  QueryState,
  Segmented,
  Stepper,
  useDocumentTitle,
} from '../components/ui';
import { LIVE_STATUS_LABELS, useLiveEvents, type LiveStatus } from '../live';
import {
  changesSheets,
  keys,
  refreshCharacters,
  useAiStatus,
  useCharacters,
  useCheckSuggestion,
  useGame,
  useGames,
  useMe,
  useNpcs,
  useStoreGameEvent,
  useStoreNpc,
} from '../queries';
import {
  DEFAULT_SHOT,
  characterDraft,
  enemyAttackPreset,
  freeDraft,
  interventionPreset,
  npcDraft,
  percent,
  previewCheck,
  toSideRequest,
  type RollPreset,
  type Shot,
  type SideDraft,
} from '../rolling';
import { signed } from '../rules-text';

const EDGES: Edge[] = ['disadvantage', 'none', 'advantage'];
const RANGES: [Range, string][] = [
  ['short', 'Corta'],
  ['medium', 'Media +2'],
  ['long', 'Larga +4'],
];
/** Tiradas del final del registro que aún se pueden repetir o complicar. */
const RECENT_ROLLS = 3;
const SITUATIONS: Situation[] = ['test', 'melee', 'ranged'];

export function GamePage() {
  const { gameId = '' } = useParams();
  const state = useGame(gameId);
  const storeEvent = useStoreGameEvent(gameId);
  const queryClient = useQueryClient();
  const ai = useAiStatus();
  const { data: me } = useMe();
  const game = state.data?.game;
  const characters = useCharacters(game?.campaignId ?? '');

  const live = useLiveEvents({
    url: game?.status === 'open' ? `/api/games/${gameId}/stream` : null,
    after: state.data?.events.at(-1)?.id ?? 0,
    onEvent: (event) => {
      storeEvent(event);
      // Al cerrar se reparten PX: las fichas guardadas ya no están al día.
      if (event.kind === 'closed' && game) refreshCampaign(queryClient, game.campaignId);
      // Alguien ha gastado Suerte, ha recibido un golpe o ha recuperado el aliento.
      if (changesSheets(event) && game) refreshCharacters(queryClient, game.campaignId);
    },
    endsWith: (event) => event.kind === 'closed',
    // Ya no deja conectar (por ejemplo, han echado a quien mira): se vuelve a pedir la partida.
    onRefused: () => void queryClient.invalidateQueries({ queryKey: keys.game(gameId) }),
  });

  // Lo que espera a quien mira: al máster, las intervenciones de la mesa; a un jugador, la
  // palabra o una tirada que le han pedido. Se ve en el título de la pestaña.
  const events = state.data?.events ?? [];
  const inPlay = game?.status === 'open';
  const mine = (characters.data ?? [])
    .filter((character) => character.ownerId === me?.user?.id)
    .map((character) => character.id);
  const forMaster = inPlay && game?.role === 'master' ? pendingInterventions(events).length : 0;
  const yourTurn =
    inPlay &&
    game?.role === 'player' &&
    mine.length > 0 &&
    (holdsFloor(currentFloor(events), mine) ||
      pendingRollRequests(events).some((asked) => mine.includes(asked.characterId)));
  useYourTurn(yourTurn);
  const waiting = yourTurn ? '¡Te toca! · ' : forMaster > 0 ? `(${forMaster}) ` : '';
  useDocumentTitle(game ? `${waiting}${gameName(game)}` : undefined);

  // Si deja de tener acceso (le echan de la campaña), la partida guardada ya no vale.
  const lost = state.error instanceof ApiError && state.error.status === 404;
  if (!state.data || !game || lost) return <QueryState error={state.error} />;
  const isMaster = game.role === 'master';
  const isOpen = game.status === 'open';
  // Una tirada repetida con Suerte ya no cuenta: cuenta la repetición.
  const superseded = supersededRolls(state.data.events);
  // Cómo acabaron las intervenciones y las tiradas pedidas que ya no esperan.
  const settled = settledEvents(state.data.events);
  // Repetir y complicar se hace al momento: solo en las últimas tiradas que cuentan.
  const recent = isOpen
    ? state.data.events
        .filter((event) => event.kind === 'roll' && !superseded.has(event.id))
        .slice(-RECENT_ROLLS)
    : [];
  const complicated = new Set(
    isMaster && ai.data?.enabled
      ? recent
          .filter((event) => event.kind === 'roll' && needsComplication(event.roll.result.outcome))
          .map((event) => event.id)
      : [],
  );
  // Los golpes aplicados de cada tirada y los golpes mortales de los que alguien se ha salvado.
  const blows = new Map<number, DamageEvent[]>();
  const survived = new Set<number>();
  for (const event of state.data.events) {
    if (event.kind === 'damage' && event.roll !== undefined) {
      blows.set(event.roll, [...(blows.get(event.roll) ?? []), event]);
    }
    if (event.kind === 'survived') survived.add(event.of);
  }
  // La Suerte se gasta en lo que ve quien tira, y antes de aplicar el daño: las tiradas secretas
  // del máster no se repiten.
  const rerollable = new Set(
    recent
      .filter((event) => event.visibility !== 'master' && !blows.has(event.id))
      .map((event) => event.id),
  );
  // El máster aplica los golpes y la IA los narra al momento: en las últimas tiradas de combate.
  const striking = new Set(
    isMaster
      ? recent
          .filter((event) => event.kind === 'roll' && event.roll.situation !== 'test')
          .map((event) => event.id)
      : [],
  );
  const combat = currentCombat(state.data.events);
  const spent = spentAbilities(state.data.events);
  const intents = rollIntents(state.data.events);
  // Tras tumbar a uno de un grupo de enemigos, la IA dice si puede que huyan o se rindan.
  const morale =
    isMaster && isOpen && ai.data?.decisions ? moraleBlow(state.data.events, combat) : undefined;

  return (
    <>
      <header className="masthead">
        <Link to={`/campanas/${game.campaignId}`} className="eyebrow back">
          ← {game.campaignName}
        </Link>
        <h1>
          {gameName(game)}{' '}
          <span className={`badge ${isOpen ? 'live' : ''}`}>{GAME_STATUS_LABELS[game.status]}</span>
        </h1>
        <p className="lede">
          {game.title ? `Partida ${game.number} · ` : ''}
          {isMaster
            ? 'Diriges tú: lo que enseñes y las tiradas públicas lo ve toda la mesa.'
            : 'Aquí ves lo que enseña el máster y las tiradas de la mesa.'}{' '}
          {isOpen && <LiveBadge status={live} />}
        </p>
      </header>

      <div className="room">
        <div className="room-actions">
          {isOpen ? (
            isMaster ? (
              <MasterDesk state={state.data} />
            ) : (
              <PlayerDesk state={state.data} settled={settled} />
            )
          ) : (
            <>
              <section className="panel">
                <h2>Partida terminada</h2>
                <p className="muted">
                  Terminó el{' '}
                  {new Date(game.closedAt ?? game.openedAt).toLocaleString('es-ES', {
                    dateStyle: 'long',
                    timeStyle: 'short',
                  })}
                  . Aquí queda el registro de lo que pasó.
                </p>
              </section>
              <RecapPanel game={game} />
            </>
          )}
        </div>

        <section className="room-feed panel" aria-labelledby="feed-heading">
          <h2 id="feed-heading">Registro</h2>
          <ol className="feed" aria-live="polite">
            {[...state.data.events]
              .reverse()
              .filter((event) => event.kind !== 'settled')
              .map((event) => (
                <li key={event.id}>
                  <EventCard
                    event={event}
                    superseded={superseded.has(event.id)}
                    settled={settled.get(event.id)}
                    survived={survived.has(event.id)}
                    master={isMaster}
                  >
                    {event.kind === 'roll' && rerollable.has(event.id) && (
                      <LuckReroll game={game} event={event} />
                    )}
                    {event.kind === 'roll' && striking.has(event.id) && (
                      <RollDamage
                        game={game}
                        event={event}
                        applied={blows.get(event.id) ?? []}
                        combat={combat}
                        characters={characters.data ?? []}
                        spent={spent}
                      />
                    )}
                    {event.kind === 'roll' && striking.has(event.id) && ai.data?.enabled && (
                      <BlowNarration game={game} event={event} />
                    )}
                    {event.kind === 'roll' && complicated.has(event.id) && (
                      <Complications game={game} event={event} intent={intents.get(event.id)} />
                    )}
                    {event.kind === 'rollRequest' && isOpen && !settled.has(event.id) && (
                      <RollRequestAction game={game} event={event} />
                    )}
                    {event.kind === 'damage' && combat && event.id === morale && (
                      <MoraleHint game={game} combat={combat} event={event} />
                    )}
                    {event.kind === 'damage' && isOpen && (
                      <FallenActions
                        game={game}
                        event={event}
                        characters={characters.data ?? []}
                        spent={spent}
                        survived={survived.has(event.id)}
                      />
                    )}
                  </EventCard>
                </li>
              ))}
          </ol>
        </section>

        <div className="room-extras">
          <TableCharacters
            game={game}
            combat={isOpen ? combat : null}
            spent={spent}
            master={isMaster && isOpen}
          />
          {isMaster && game.screenToken && (
            <ScreenLink campaignId={game.campaignId} token={game.screenToken} />
          )}
          {isMaster && isOpen && <CloseGame game={game} />}
        </div>
      </div>
    </>
  );
}

function LiveBadge({ status }: { status: LiveStatus }) {
  return <span className={`live-status live-${status}`}>{LIVE_STATUS_LABELS[status]}</span>;
}

/** Cuando le toca a un jugador (la palabra o una tirada), su móvil vibra, si puede. */
function useYourTurn(active: boolean) {
  const was = useRef(active);
  useEffect(() => {
    if (active && !was.current && 'vibrate' in navigator) navigator.vibrate(200);
    was.current = active;
  }, [active]);
}

/**
 * Lo que intentaba quien tira, si el máster pidió la tirada para atender una intervención con
 * texto: la IA lo tiene en cuenta al proponer complicaciones.
 */
function rollIntents(events: readonly GameEvent[]): Map<number, string> {
  const texts = new Map<number, string>();
  const answered = new Map<number, number>();
  const intents = new Map<number, string>();
  for (const event of events) {
    if (event.kind === 'intervention' && event.text) texts.set(event.id, event.text);
    if (event.kind === 'rollRequest' && event.answers !== undefined) {
      answered.set(event.id, event.answers);
    }
    if (event.kind === 'roll' && event.roll.requested !== undefined) {
      const intervention = answered.get(event.roll.requested);
      const text = intervention === undefined ? undefined : texts.get(intervention);
      if (text) intents.set(event.id, text);
    }
  }
  return intents;
}

/** Suerte y PX cambian al abrir y cerrar partidas: fichas y listas se vuelven a pedir. */
function refreshCampaign(queryClient: ReturnType<typeof useQueryClient>, campaignId: string) {
  void queryClient.invalidateQueries({ queryKey: keys.campaign(campaignId) });
  void queryClient.invalidateQueries({ queryKey: ['characters'] });
  void queryClient.invalidateQueries({ queryKey: keys.campaigns, exact: true });
}

/**
 * La sala del jugador: quién tiene la palabra (en combate, el orden y de quién es el turno), las
 * tiradas que le pide el máster y sus botones para intervenir. Debajo, por si hace falta, su
 * formulario para tirar por su cuenta.
 */
function PlayerDesk({
  state,
  settled,
}: {
  state: GameState;
  settled: ReadonlyMap<number, SettledHow>;
}) {
  const { game, events } = state;
  const { data: me } = useMe();
  const characters = useCharacters(game.campaignId);
  const all = characters.data ?? [];
  const mine = all.filter((character) => character.ownerId === me?.user?.id);
  const ids = mine.map((character) => character.id);
  const floor = currentFloor(events);
  const combat = currentCombat(events);
  const current = combat ? turnOf(combat) : undefined;
  const asked = pendingRollRequests(events).filter((event) => ids.includes(event.characterId));

  return (
    <>
      {(mine.length > 0 || combat) && (
        <section
          className={holdsFloor(floor, ids) || asked.length > 0 ? 'panel your-turn' : 'panel'}
          aria-labelledby="floor-heading"
        >
          <h2 id="floor-heading">{combat ? `Combate · Ronda ${combat.round}` : 'La palabra'}</h2>
          <SceneLine events={events} />
          {combat ? (
            <>
              <CombatOrder combat={combat} characters={all} />
              <TurnStatus combat={combat} floor={floor} characterIds={ids} />
            </>
          ) : (
            <FloorStatus floor={floor} characterIds={ids} />
          )}
          {asked.map((event) => (
            <RequestedRollCard key={event.id} game={game} event={event} characters={all} />
          ))}
          <InterventionPanel
            game={game}
            floor={floor}
            combat={combat}
            characters={mine}
            events={events}
            settled={settled}
          />
          {combat && current?.kind === 'character' && ids.includes(current.id) && (
            <EndTurn game={game} combat={combat} />
          )}
          <LimitedAbilities
            game={game}
            characters={mine}
            spent={spentAbilities(events)}
            canUse
            named={mine.length > 1}
          />
        </section>
      )}
      <RollForm game={game} />
    </>
  );
}

type Action = 'roll' | 'reveal' | 'talk' | 'note';

/** Lo que el máster lleva a sus acciones desde la cola o desde el turno de unos PNJ. */
interface Handoff {
  to: HandoffTarget;
  /** Distinto cada vez: lo que se abre empieza de cero con cada una. */
  key: number;
  /** La intervención a la que responde, si responde a una. */
  intervention?: InterventionEvent | undefined;
  /** La tirada ya preparada, si va a Tirar. */
  roll?: RollPreset | undefined;
  /** Si se pide a la IA qué tirada sugiere: la tirada preparada con su sugerencia. */
  suggest?: ((suggestion: CheckSuggestion) => RollPreset | undefined) | undefined;
}

/**
 * La mesa del máster: a quién da la palabra o, en combate, el orden y los turnos; las
 * intervenciones que esperan y las tiradas que ha pedido; y sus acciones (enseñar, hablar por un
 * PNJ, tirar, anotar). Lo que elige hacer con una intervención, o con el turno de unos PNJ, abre
 * la acción que toca, lista para usarla.
 */
function MasterDesk({ state }: { state: GameState }) {
  const { game, events } = state;
  const [action, setAction] = useState<Action>('reveal');
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const desk = useRef<HTMLElement>(null);
  const characters = useCharacters(game.campaignId).data ?? [];
  const npcs = useNpcs(game.campaignId).data ?? [];
  const floor = currentFloor(events);
  const combat = currentCombat(events);
  const spent = spentAbilities(events);
  const ai = useAiStatus();
  const waiting = pendingInterventions(events);
  // En cuanto la intervención deja de esperar (atendida o retirada), ya no se responde a ella.
  const active =
    handoff &&
    (!handoff.intervention ||
      waiting.some((intervention) => intervention.id === handoff.intervention?.id))
      ? handoff
      : null;
  const handedTo = (to: HandoffTarget) => (active?.to === to ? active : undefined);
  const stopAnswering = () => setHandoff(null);

  function hand(to: HandoffTarget, from: Omit<Handoff, 'to' | 'key'>) {
    setHandoff((previous) => ({ to, key: (previous?.key ?? 0) + 1, ...from }));
    // Empezar un combate se hace aquí arriba; lo demás, en las acciones.
    if (to === 'combat') return;
    setAction(to);
    desk.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  const rolling = handedTo('roll');
  const starting = handedTo('combat');
  return (
    <>
      <section className="panel" aria-labelledby="floor-heading">
        <h2 id="floor-heading">{combat ? `Combate · Ronda ${combat.round}` : 'La palabra'}</h2>
        <SceneLine events={events} />
        {combat ? (
          <CombatTracker
            game={game}
            combat={combat}
            characters={characters}
            spent={spent}
            ai={ai.data?.enabled === true}
            decisions={ai.data?.decisions === true}
            onAttack={(enemy, target) => hand('roll', { roll: enemyAttackPreset(enemy, target) })}
          />
        ) : (
          <FloorControl game={game} floor={floor} characters={characters} />
        )}
        <InterventionQueue
          game={game}
          floor={floor}
          combat={combat}
          pending={waiting}
          onHandoff={(to, intervention) =>
            hand(to, {
              intervention,
              roll:
                to === 'roll' ? interventionPreset(intervention, characters, combat) : undefined,
              // La IA sugiere qué tirada pedir para lo que ha escrito el jugador, si no es cuerpo
              // a cuerpo (eso lo dice el reglamento). La tirada no espera por ella.
              suggest:
                to === 'roll' &&
                ai.data?.decisions &&
                isCheckedIntent(intervention.intent) &&
                intervention.text.trim()
                  ? (suggestion) => interventionPreset(intervention, characters, combat, suggestion)
                  : undefined,
            })
          }
        />
        <PendingRollRequests game={game} pending={pendingRollRequests(events)} />
        {combat ? (
          <>
            <JoinCombat game={game} combat={combat} characters={characters} npcs={npcs} />
            <EndCombat game={game} />
          </>
        ) : (
          <>
            <StartCombat
              key={starting?.key ?? 0}
              game={game}
              characters={characters}
              npcs={npcs}
              answering={starting?.intervention}
              onStopAnswering={stopAnswering}
            />
            <SceneControl
              game={game}
              fighting={false}
              onStarted={() => {
                // Lo normal es describirla: se abre Enseñar.
                setAction('reveal');
                desk.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
              }}
            />
          </>
        )}
      </section>

      {/* Todas siguen ahí aunque solo se vea una: cambiar de pestaña para tirar no pierde lo
          que se estaba escribiendo ni las ideas de la IA. */}
      <section className="panel" aria-label="Acciones del máster" ref={desk}>
        <Segmented
          label="Qué quieres hacer"
          value={action}
          options={[
            ['reveal', 'Enseñar'],
            ['talk', 'Hablar'],
            ['roll', 'Tirar'],
            ['note', 'Anotar'],
          ]}
          onChange={setAction}
        />
        <div hidden={action !== 'reveal'}>
          <RevealForm
            game={game}
            characters={characters}
            scene={currentScene(events)?.title}
            starting={!events.some((event) => event.kind === 'reveal')}
            answering={handedTo('reveal')?.intervention}
            onStopAnswering={stopAnswering}
          />
        </div>
        <div hidden={action !== 'talk'}>
          <TalkPanel
            game={game}
            characters={characters}
            answering={handedTo('talk')?.intervention}
            onStopAnswering={stopAnswering}
          />
        </div>
        <div hidden={action !== 'roll'}>
          {/* Cada tirada que se prepara (para una intervención o para unos PNJ) empieza de
              cero; al hacerla o pedirla, Tirar vuelve a quedar libre. */}
          <RollForm
            key={rolling?.key ?? 0}
            game={game}
            embedded
            preset={rolling?.roll}
            suggest={rolling?.suggest}
            answering={rolling?.intervention}
            onStopAnswering={stopAnswering}
            onDone={rolling ? stopAnswering : undefined}
          />
        </div>
        <div hidden={action !== 'note'}>
          <NoteForm gameId={game.id} />
        </div>
      </section>
    </>
  );
}

/** La última partida anterior que tiene resumen. */
function usePreviousRecap(game: GameDetail): GameSummary | undefined {
  const games = useGames(game.campaignId);
  // La lista viene de la más reciente a la más antigua.
  return games.data?.find((other) => other.number < game.number && other.recap);
}

/** Título para enseñar a la mesa el resumen de una partida anterior. */
function recallTitle(previous: GameSummary, game: GameDetail): string {
  if (previous.number === game.number - 1) return 'En la partida anterior';
  return previous.title
    ? `Lo que pasó en «${previous.title}»`
    : `Lo que pasó en la partida ${previous.number}`;
}

/** "Enseñar a la mesa", o "Enseñar solo a Kael" si va en secreto. */
function showLabel(characters: CharacterView[], to: string): string {
  const name = characters.find((character) => character.id === to)?.name;
  return name ? `Enseñar solo a ${name}` : 'Enseñar a la mesa';
}

/**
 * Lo que el máster enseña a la mesa, o en secreto a un personaje. Con IA, puede escribir solo
 * unas notas y pedir que las convierta en una descripción, o pedir ideas de lo que puede pasar
 * si la mesa se atasca. Con `starting`, aún no se ha enseñado nada: se ofrece recordar la
 * partida anterior. Con `answering`, lo que enseñe responde a esa intervención.
 */
function RevealForm(props: {
  game: GameDetail;
  characters: CharacterView[];
  /** El título de la escena en juego: la IA la describe con él si no hay otro. */
  scene: string | undefined;
  starting: boolean;
  answering: InterventionEvent | undefined;
  onStopAnswering: () => void;
}) {
  const { game, characters, scene, starting, answering, onStopAnswering } = props;
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const bodyField = useRef<HTMLTextAreaElement>(null);
  /** Las notas que la IA ha convertido en descripción; null si no ha descrito nada. */
  const [notes, setNotes] = useState<string | null>(null);
  /** La última descripción de la IA, para saber si el máster la ha retocado. */
  const [described, setDescribed] = useState('');
  const [to, setTo, toEveryone] = useRecipient(answering);
  const ai = useAiStatus();
  const writer = useAiText();
  const previous = usePreviousRecap(game);
  const storeEvent = useStoreGameEvent(game.id);
  const reveal = useMutation({
    mutationFn: () =>
      api.reveal(game.id, { title, body, to: to || undefined, answers: answering?.id }),
    onSuccess: (event) => {
      storeEvent(event);
      setTitle('');
      setBody('');
      setNotes(null);
      // Lo siguiente vuelve a ser para toda la mesa: nada se susurra sin querer.
      toEveryone();
    },
  });
  const recall = starting && !title && !body ? previous : undefined;
  const aiEnabled = ai.data?.enabled === true;
  const leaks = useLeakGuard(game.id);

  async function describe(from: string) {
    const before = notes;
    setNotes(from);
    const text = await writer.write((options) =>
      api.draftReveal(game.id, { title: title || scene || '', notes: from }, options),
    );
    // Si falla o se para antes de escribir nada, todo queda como estaba.
    if (!text) {
      setNotes(before);
      return;
    }
    setBody(text);
    setDescribed(text);
  }

  return (
    <div className="stack tight">
      <form
        className="stack tight"
        onSubmit={(event) => {
          event.preventDefault();
          // Antes de enseñarlo, la IA mira si desvela lo que oculta algún PNJ.
          void leaks.guard(
            { title, body },
            () => reveal.mutate(),
            () => bodyField.current?.focus(),
          );
        }}
      >
        {answering && <AnsweringNote intervention={answering} onCancel={onStopAnswering} />}
        <p className="muted">Lo que escribas aparece al momento en la sala y en la pantalla.</p>
        {recall && (
          <div className="recall">
            <p>¿Empezáis? Recuerda a la mesa lo que pasó en {gameName(recall)}.</p>
            <button
              type="button"
              className="button small"
              onClick={() => {
                setTitle(recallTitle(recall, game));
                setBody(recall.recap);
              }}
            >
              Recordar la partida anterior
            </button>
          </div>
        )}
        <label className="field">
          <span className="field-label">Título (opcional)</span>
          <input
            value={title}
            maxLength={120}
            placeholder="La posada del Ciervo Blanco"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Qué ven, oyen o encuentran</span>
          <textarea
            ref={bodyField}
            required
            rows={5}
            maxLength={5000}
            value={writer.writing ? writer.pending || 'Escribiendo…' : body}
            readOnly={writer.writing}
            aria-busy={writer.writing}
            onChange={(e) => setBody(e.target.value)}
          />
          {aiEnabled && notes === null && (
            <span className="hint">
              Puedes escribir solo unas notas y pedir a la IA que las describa. Entre corchetes, lo
              que debe saber pero no contar.
            </span>
          )}
        </label>
        {aiEnabled && (
          <div className="actions">
            {/* Botones distintos (key): el de Parar no debe heredar el clic que empieza. */}
            {writer.writing ? (
              <button key="stop" type="button" className="button" onClick={writer.stop}>
                Parar
              </button>
            ) : notes === null ? (
              <button
                key="describe"
                type="button"
                className="button"
                disabled={!body.trim() && !title.trim() && !scene}
                onClick={() => void describe(body)}
              >
                Describir con IA
              </button>
            ) : (
              <>
                {body === described ? (
                  <button
                    key="again"
                    type="button"
                    className="button"
                    onClick={() => void describe(notes)}
                  >
                    Otra versión
                  </button>
                ) : (
                  <ConfirmButton
                    key="again-confirm"
                    confirmLabel="¿Cambiar lo retocado por otra versión?"
                    onConfirm={() => void describe(notes)}
                  >
                    Otra versión
                  </ConfirmButton>
                )}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setBody(notes);
                    setNotes(null);
                  }}
                >
                  Volver a mis notas
                </button>
              </>
            )}
          </div>
        )}
        <RecipientSelect characters={characters} value={to} onChange={setTo} />
        <ErrorNote error={reveal.error ?? writer.error} />
        {leaks.alert && <LeakWarning alert={leaks.alert} onDismiss={leaks.dismiss} />}
        <button
          type="submit"
          className="button primary"
          disabled={reveal.isPending || writer.writing || leaks.checking}
        >
          {leaks.checking ? 'Comprobando…' : showLabel(characters, to)}
        </button>
      </form>
      {aiEnabled && (
        <AiIdeas
          game={game}
          openLabel="¿Qué puede pasar ahora? Pide ideas a la IA"
          label="Ideas para seguir"
          ideaLabel="Idea"
          hint={{
            label: 'Qué buscas, para afinar (opcional)',
            placeholder: 'Algo que les meta prisa',
          }}
          ask={(hint, options) => api.ideas(game.id, { hint }, options)}
          action={{
            label: 'Describir',
            // La descripción va al cuadro de arriba: si ya hay algo escrito, se pregunta.
            confirm: body.trim() ? '¿Cambiar lo que hay en el cuadro?' : undefined,
            disabled: writer.writing,
            onClick: (idea) => {
              bodyField.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              void describe(idea);
            },
          }}
        />
      )}
    </div>
  );
}

function NoteForm({ gameId }: { gameId: string }) {
  const [text, setText] = useState('');
  const storeEvent = useStoreGameEvent(gameId);
  const note = useMutation({
    mutationFn: () => api.note(gameId, { text }),
    onSuccess: (event) => {
      storeEvent(event);
      setText('');
    },
  });

  return (
    <form
      className="stack tight"
      onSubmit={(event) => {
        event.preventDefault();
        note.mutate();
      }}
    >
      <p className="muted">Solo la ves tú. Queda en el registro para recordar qué pasó.</p>
      <label className="field">
        <span className="field-label">Nota</span>
        <textarea
          required
          rows={4}
          maxLength={5000}
          value={text}
          placeholder="Han aceptado el trato con el gremio; el posadero es un espía."
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <ErrorNote error={note.error} />
      <button type="submit" className="button primary" disabled={note.isPending}>
        Guardar nota
      </button>
    </form>
  );
}

/**
 * Hablar por boca de un PNJ. Con IA, el máster cuenta lo que dice la mesa y la IA responde;
 * sin ella, escribe él lo que dice el PNJ. En los dos casos, la frase se enseña a la mesa (o en
 * secreto a un personaje). Con `answering`, responde a esa intervención.
 */
function TalkPanel(props: {
  game: GameDetail;
  characters: CharacterView[];
  answering: InterventionEvent | undefined;
  onStopAnswering: () => void;
}) {
  const { game, characters, answering, onStopAnswering } = props;
  const npcs = useNpcs(game.campaignId);
  const ai = useAiStatus();
  const [chosen, setChosen] = useState<string | null>(null);

  if (!npcs.data || !ai.data) return <QueryState error={npcs.error ?? ai.error} />;
  const list = npcs.data;
  const aiEnabled = ai.data.enabled;
  const improvising = aiEnabled && (chosen === 'new' || list.length === 0);
  const npc = improvising ? undefined : (list.find((n) => n.id === chosen) ?? list[0]);

  return (
    <div className="stack tight">
      {answering && <AnsweringNote intervention={answering} onCancel={onStopAnswering} />}
      {list.length > 0 && (
        <label className="field">
          <span className="field-label">PNJ</span>
          <select
            aria-label="PNJ"
            value={npc?.id ?? 'new'}
            onChange={(event) => setChosen(event.target.value)}
          >
            {list.map((n) => (
              <option key={n.id} value={n.id}>
                {n.concept ? `${n.name} · ${n.concept}` : n.name}
              </option>
            ))}
            {aiEnabled && <option value="new">Improvisar uno nuevo con IA…</option>}
          </select>
        </label>
      )}
      {improvising ? (
        <ImproviseNpc
          campaignId={game.campaignId}
          onCreated={(created) => setChosen(created.id)}
          {...(list.length > 0 ? { onCancel: () => setChosen(null) } : {})}
        />
      ) : npc ? (
        <>
          <details className="npc-summary">
            <summary>Ficha de {npc.name}</summary>
            <NpcSheet npc={npc} />
            <Link to={`/pnj/${npc.id}`}>Editar la ficha</Link>
          </details>
          {aiEnabled ? (
            <NpcChat
              key={npc.id}
              npc={npc}
              gameId={game.id}
              characters={characters}
              answering={answering}
            />
          ) : (
            <SpeechForm
              key={npc.id}
              gameId={game.id}
              npc={npc}
              characters={characters}
              answering={answering}
            />
          )}
        </>
      ) : (
        <p className="muted">
          Aún no hay PNJ en esta campaña.{' '}
          <Link to={`/campanas/${game.campaignId}/pnj/nuevo`}>Crear un PNJ</Link>
        </p>
      )}
    </div>
  );
}

/** Un PNJ que no estaba preparado: la IA se lo inventa a partir de una línea y lo guarda. */
function ImproviseNpc(props: {
  campaignId: string;
  onCreated: (npc: NpcView) => void;
  onCancel?: () => void;
}) {
  const { campaignId, onCreated, onCancel } = props;
  const [idea, setIdea] = useState('');
  const storeNpc = useStoreNpc();
  const create = useMutation({
    mutationFn: async () => api.createNpc(campaignId, await api.generateNpc(campaignId, { idea })),
    onSuccess: (npc) => {
      storeNpc(npc);
      onCreated(npc);
    },
  });

  return (
    <form
      className="stack tight"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <p className="muted">
        ¿Hablan con alguien que no tenías preparado? Di quién es: la IA se lo inventa y lo guarda en
        la campaña.
      </p>
      <label className="field">
        <span className="field-label">Quién es</span>
        <input
          required
          maxLength={500}
          value={idea}
          placeholder="El guardia aburrido de la puerta norte"
          onChange={(e) => setIdea(e.target.value)}
        />
      </label>
      <ErrorNote error={create.error} />
      <div className="actions">
        <button type="submit" className="button primary" disabled={create.isPending}>
          {create.isPending ? 'Inventando…' : 'Crear con IA'}
        </button>
        {onCancel && (
          <button type="button" className="button" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

/** Sin IA: el máster escribe lo que dice el PNJ y lo enseña a la mesa o a un personaje. */
function SpeechForm(props: {
  gameId: string;
  npc: NpcView;
  characters: CharacterView[];
  answering: InterventionEvent | undefined;
}) {
  const { gameId, npc, characters, answering } = props;
  const [text, setText] = useState('');
  const [to, setTo, toEveryone] = useRecipient(answering);
  const storeEvent = useStoreGameEvent(gameId);
  const textField = useRef<HTMLTextAreaElement>(null);
  const leaks = useLeakGuard(gameId);
  const speak = useMutation({
    mutationFn: () =>
      api.speech(gameId, { npcId: npc.id, text, to: to || undefined, answers: answering?.id }),
    onSuccess: (event) => {
      storeEvent(event);
      setText('');
      toEveryone();
    },
  });

  return (
    <form
      className="stack tight"
      onSubmit={(event) => {
        event.preventDefault();
        // Antes de enseñarla, la IA mira si desvela lo que oculta algún PNJ.
        void leaks.guard(
          { body: text, npcId: npc.id },
          () => speak.mutate(),
          () => textField.current?.focus(),
        );
      }}
    >
      <label className="field">
        <span className="field-label">Lo que dice {npc.name}</span>
        <textarea
          ref={textField}
          required
          rows={3}
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="hint">
        Con Ollama configurado en el servidor, la IA te propondría qué responde {npc.name}.
      </p>
      <RecipientSelect characters={characters} value={to} onChange={setTo} />
      <ErrorNote error={speak.error} />
      {leaks.alert && <LeakWarning alert={leaks.alert} onDismiss={leaks.dismiss} />}
      <button type="submit" className="button primary" disabled={speak.isPending || leaks.checking}>
        {leaks.checking ? 'Comprobando…' : showLabel(characters, to)}
      </button>
    </form>
  );
}

/**
 * Tirar en la partida. El máster tira con cualquiera, también en secreto, o pide la tirada al
 * jugador del personaje que tira (o que se defiende). Con `preset`, la tirada llega preparada
 * (para atender la intervención `answering` o para el turno de unos PNJ): se monta de nuevo con
 * cada una, y al hacerla o pedirla se avisa con `onDone`. Con `suggest`, se pregunta a la IA qué
 * tirada pedir para `answering`: cuando llega, se aplica sola si el máster aún no ha tocado la
 * tirada; si la ha tocado, la aplica él si quiere.
 */
function RollForm(props: {
  game: GameDetail;
  embedded?: boolean;
  preset?: RollPreset | undefined;
  suggest?: ((suggestion: CheckSuggestion) => RollPreset | undefined) | undefined;
  answering?: InterventionEvent | undefined;
  onStopAnswering?: () => void;
  onDone?: (() => void) | undefined;
}) {
  const { game, embedded = false, preset, suggest, answering, onStopAnswering, onDone } = props;
  const { data: me } = useMe();
  const characters = useCharacters(game.campaignId);
  const storeEvent = useStoreGameEvent(game.id);
  const isMaster = game.role === 'master';
  const npcs = useNpcs(game.campaignId, isMaster).data ?? [];
  // El máster tira con cualquiera; cada jugador, con los suyos.
  const available = (characters.data ?? []).filter(
    (character) => isMaster || character.ownerId === me?.user?.id,
  );

  const [actor, setActor] = useState<SideDraft | null>(preset?.actor ?? null);
  const [against, setAgainst] = useState<'difficulty' | 'opposed'>(preset?.against ?? 'difficulty');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(preset?.difficulty ?? 'normal');
  const [opponent, setOpponent] = useState<SideDraft>(() => preset?.opponent ?? freeDraft('Rival'));
  const [situation, setSituation] = useState<Situation>(preset?.situation ?? 'test');
  const [shot, setShot] = useState<Shot>(preset?.shot ?? DEFAULT_SHOT);
  const [secret, setSecret] = useState(preset?.secret ?? answering?.visibility === 'private');
  /** El máster no tira: pide la tirada al jugador, que la hace con un botón. */
  const [ask, setAsk] = useState(preset?.ask ?? answering !== undefined);
  /** En combate, quién ataca a quién: a quién irá el daño del golpe. */
  const [blow, setBlow] = useState(preset?.blow);

  const suggestion = useCheckSuggestion(game.id, suggest ? answering : undefined);
  /** El máster ya ha cambiado algo de lo que cambia la sugerencia: no se aplica sola. */
  const [touched, setTouched] = useState(false);
  /** La última sugerencia que ha llegado, y si se ha aplicado. */
  const [arrived, setArrived] = useState<CheckSuggestion | undefined>(undefined);
  const [applied, setApplied] = useState(false);
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setTouched(true);
      set(value);
    };

  function applySuggestion(next: CheckSuggestion) {
    const suggested = suggest?.(next);
    if (!suggested) return;
    setActor(suggested.actor);
    setAgainst(suggested.against);
    setDifficulty(suggested.difficulty);
    setOpponent(suggested.opponent);
    setSituation(suggested.situation);
    setShot(suggested.shot);
    setApplied(true);
  }
  // Llega la sugerencia: se aplica sola si el máster aún no ha tocado la tirada.
  if (suggestion.data && suggestion.data !== arrived) {
    setArrived(suggestion.data);
    if (!touched) applySuggestion(suggestion.data);
  }

  // Hasta que no se elige, tira el primer personaje disponible (o un PNJ si no hay ninguno).
  const first = available[0];
  const actorDraft = actor ?? (first ? characterDraft(first) : isMaster ? freeDraft('PNJ') : null);
  const done = () => onDone?.();

  const roll = useMutation({
    mutationFn: (request: GameRollRequest) => api.gameRoll(game.id, request),
    onSuccess: (event) => {
      storeEvent(event);
      done();
    },
  });
  const askRoll = useMutation({
    mutationFn: (request: AskRollRequest) => api.askRoll(game.id, request),
    onSuccess: (event) => {
      storeEvent(event);
      done();
    },
  });

  if (!characters.data) return <QueryState error={characters.error} />;
  if (!actorDraft) {
    return (
      <section className="panel">
        <h2>Tirar</h2>
        <p className="muted">No tienes personaje en esta campaña.</p>
        <Link to={`/campanas/${game.campaignId}/personajes/nuevo`} className="button primary">
          Crear personaje
        </Link>
      </section>
    );
  }

  // A distancia, la dificultad sale del objetivo, la distancia y la cobertura.
  const shooting = against === 'difficulty' && situation === 'ranged';
  const shooter =
    actorDraft.kind === 'character'
      ? available.find((character) => character.id === actorDraft.characterId)
      : undefined;
  const target = shooting
    ? rangedDifficulty({
        targetDexterity: shot.dexterity,
        range: shot.range,
        cover: shot.cover ? 'partial' : 'none',
        targetShield: shot.shield,
        deadeye: shooter?.advancedSkills.includes('deadeye') ?? false,
      })
    : DIFFICULTIES[difficulty];
  const actorCheck = previewCheck(actorDraft, available);
  const opponentCheck = against === 'opposed' ? previewCheck(opponent, characters.data) : null;
  const odds =
    actorCheck &&
    (against === 'difficulty'
      ? testOdds(actorCheck, target)
      : opponentCheck && opposedOdds(actorCheck, opponentCheck));
  // Una tirada pedida la hace quien actúa o, si es un PNJ, el personaje que se defiende.
  const roller = [actorDraft, ...(against === 'opposed' ? [opponent] : [])].find(
    (side) => side.kind === 'character',
  );
  const rollerName =
    roller?.kind === 'character'
      ? characters.data.find((character) => character.id === roller.characterId)?.name
      : undefined;
  const asking = isMaster && ask && rollerName !== undefined;
  const pending = roll.isPending || askRoll.isPending;

  function submit() {
    if (!actorDraft) return;
    const request = {
      actor: toSideRequest(actorDraft),
      target:
        against === 'difficulty'
          ? { kind: 'difficulty' as const, difficulty: target }
          : { kind: 'opposed' as const, opponent: toSideRequest(opponent) },
      situation,
      blow: blow && { attackerId: blow.attacker.id, defenderId: blow.defender.id },
    };
    if (asking) askRoll.mutate({ roll: request, secret, answers: answering?.id });
    else roll.mutate({ ...request, secret: isMaster && secret });
  }

  const content = (
    <form
      className="stack tight"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {answering && onStopAnswering && (
        <AnsweringNote intervention={answering} onCancel={onStopAnswering} />
      )}
      {blow && (
        <p className="blow-note">
          Golpe: <strong>{blow.attacker.name}</strong> ataca a <strong>{blow.defender.name}</strong>
          . Si impacta, el daño se aplica desde la tirada.{' '}
          <button type="button" className="link-button" onClick={() => setBlow(undefined)}>
            No es un golpe
          </button>
        </p>
      )}
      {suggest && (
        <CheckHint
          asked={suggestion}
          intent={answering?.intent ?? 'act'}
          check={actorDraft.kind === 'character' ? actorDraft.check : undefined}
          applied={applied}
          onSkill={(skill) => {
            if (actorDraft.kind === 'character') {
              edit(setActor)({ ...actorDraft, check: `skill:${skill}` });
            }
          }}
          onApply={() => suggestion.data && applySuggestion(suggestion.data)}
        />
      )}
      <SideEditor
        title="Quién tira"
        draft={actorDraft}
        characters={available}
        npcs={npcs}
        allowFree={isMaster}
        onChange={edit(setActor)}
      />

      {isMaster && (
        <Segmented
          label="Contra"
          value={against}
          options={[
            ['difficulty', 'Dificultad'],
            ['opposed', 'Rival'],
          ]}
          onChange={(next) => {
            setTouched(true);
            setAgainst(next);
            setSituation(next === 'opposed' ? 'melee' : 'test');
          }}
        />
      )}
      {shooting ? (
        <fieldset className="side-editor">
          <legend className="field-label">Dificultad a distancia</legend>
          <div className="steppers">
            <Stepper
              label="Destreza del objetivo"
              value={shot.dexterity}
              min={0}
              max={6}
              onChange={(dexterity) => edit(setShot)({ ...shot, dexterity })}
              hint="De un PNJ, la de su perfil: esbirro 1, soldado 2, veterano 3, campeón 4."
            />
          </div>
          <Segmented
            label="Distancia"
            value={shot.range}
            options={RANGES}
            onChange={(range) => edit(setShot)({ ...shot, range })}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={shot.cover}
              onChange={(event) => edit(setShot)({ ...shot, cover: event.target.checked })}
            />
            Cobertura parcial (+2)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={shot.shield}
              onChange={(event) => edit(setShot)({ ...shot, shield: event.target.checked })}
            />
            Lleva escudo (+1)
          </label>
          <p className="side-summary">
            Dificultad <strong>{target}</strong>
            {shooter?.advancedSkills.includes('deadeye') &&
              ` · con Disparo certero, ${shooter.name} no cuenta la distancia media ni la cobertura`}
          </p>
        </fieldset>
      ) : against === 'difficulty' ? (
        <label className="field">
          <span className="field-label">Dificultad</span>
          <select
            value={difficulty}
            onChange={(event) => edit(setDifficulty)(event.target.value as DifficultyLevel)}
          >
            {(Object.keys(DIFFICULTIES) as DifficultyLevel[]).map((level) => (
              <option key={level} value={level}>
                {DIFFICULTY_LABELS[level]} ({DIFFICULTIES[level]})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <SideEditor
          title="Quién se opone"
          draft={opponent}
          characters={characters.data}
          npcs={npcs}
          allowFree
          onChange={edit(setOpponent)}
        />
      )}

      <label className="field">
        <span className="field-label">Situación</span>
        <select
          value={situation}
          onChange={(event) => {
            const next = event.target.value as Situation;
            setTouched(true);
            setSituation(next);
            // A distancia se tira contra una dificultad, que sale del objetivo.
            if (next === 'ranged') setAgainst('difficulty');
          }}
        >
          {SITUATIONS.map((s) => (
            <option key={s} value={s}>
              {SITUATION_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      {isMaster && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={ask && rollerName !== undefined}
              disabled={rollerName === undefined}
              onChange={(e) => setAsk(e.target.checked)}
            />
            {rollerName
              ? `Que tire su jugador: se la pides a ${rollerName}`
              : 'Que tire su jugador (tiene que tirar o defenderse un personaje)'}
          </label>
          <label className="check">
            <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
            {asking
              ? `En secreto: solo lo veis tú y quien juega con ${rollerName}`
              : 'Tirada secreta: solo la ves tú'}
          </label>
        </>
      )}

      <div className="roll-bar">
        <p className="bonus">
          {odds ? (
            <>
              <strong>{percent(successChance(odds))}</strong> de conseguirlo
            </>
          ) : (
            ' '
          )}
        </p>
        <button type="submit" className="roll-button" disabled={pending}>
          {asking ? (pending ? 'Pidiendo…' : 'Pedir la tirada') : pending ? 'Tirando…' : 'Tirar'}
        </button>
      </div>
      <ErrorNote error={asking ? askRoll.error : roll.error} />
    </form>
  );

  if (embedded) return content;
  return (
    <section className="panel" aria-labelledby="roll-heading">
      <h2 id="roll-heading">Tirar</h2>
      {content}
    </section>
  );
}

function SideEditor(props: {
  title: string;
  draft: SideDraft;
  characters: CharacterView[];
  /** PNJ de la campaña: solo los tiene el máster. */
  npcs: NpcView[];
  allowFree: boolean;
  onChange: (draft: SideDraft) => void;
}) {
  const { title, draft, characters, npcs, allowFree, onChange } = props;
  const character =
    draft.kind === 'character' ? characters.find((c) => c.id === draft.characterId) : undefined;
  const preview = previewCheck(draft, characters);

  // Un jugador con un solo personaje no tiene nada que elegir.
  const fixed = !allowFree && characters.length === 1 ? character : undefined;

  return (
    <fieldset className="side-editor">
      <legend className="field-label">{fixed ? `${title}: ${fixed.name}` : title}</legend>
      {!fixed && (
        <select
          aria-label={title}
          value={
            draft.kind === 'character'
              ? draft.characterId
              : draft.npcId
                ? `npc:${draft.npcId}`
                : 'free'
          }
          onChange={(event) => {
            const value = event.target.value;
            const chosen = characters.find((c) => c.id === value);
            const npc = npcs.find((n) => `npc:${n.id}` === value);
            onChange(chosen ? characterDraft(chosen) : npc ? npcDraft(npc) : freeDraft(''));
          }}
        >
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          {allowFree && npcs.length > 0 && (
            <optgroup label="PNJ de la campaña">
              {npcs.map((npc) => (
                <option key={npc.id} value={`npc:${npc.id}`}>
                  {npc.profile ? `${npc.name} (${profileText(npc.profile)})` : npc.name}
                </option>
              ))}
            </optgroup>
          )}
          {allowFree && <option value="free">Otro: un PNJ o una criatura</option>}
        </select>
      )}

      {draft.kind === 'character' && character ? (
        <>
          <label className="field">
            <span className="field-label">Con qué</span>
            <select
              value={draft.check}
              onChange={(event) => onChange({ ...draft, check: event.target.value })}
            >
              {ATTRIBUTES.map((attribute) => (
                <optgroup key={attribute} label={ATTRIBUTE_INFO[attribute].label}>
                  <option value={`attribute:${attribute}`}>
                    Solo {ATTRIBUTE_INFO[attribute].label} {signed(character.attributes[attribute])}
                  </option>
                  {defaultSkillCatalog.byAttribute(attribute).basic.map((skill) => (
                    <option key={skill.id} value={`skill:${skill.id}`}>
                      {skill.name}{' '}
                      {signed(character.attributes[attribute] + (character.skills[skill.id] ?? 0))}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="steppers">
            <Stepper
              label="Modificador"
              value={draft.modifier}
              min={-3}
              max={3}
              format={signed}
              onChange={(modifier) => onChange({ ...draft, modifier })}
            />
          </div>
          {character.wounds.severity !== 'none' && (
            <p className="hint">
              {character.name} está {SEVERITY_LABELS[character.wounds.severity].toLowerCase()}
              {preview?.wounded ? ': tira con desventaja en esta tirada.' : '.'}
            </p>
          )}
          {preview?.armored && (
            <p className="hint">
              {character.name} lleva armadura pesada: tira con desventaja en esta tirada.
            </p>
          )}
        </>
      ) : draft.kind === 'free' ? (
        <>
          {!draft.npcId && (
            <label className="field">
              <span className="field-label">Nombre</span>
              <input
                required
                maxLength={80}
                value={draft.label}
                placeholder="Guardia veterano"
                onChange={(event) => onChange({ ...draft, label: event.target.value })}
              />
            </label>
          )}
          <div className="chips">
            {Object.values(NPC_PROFILES).map((profile) => (
              <button
                key={profile.label}
                type="button"
                className="chip"
                aria-pressed={draft.bonus === profile.bonus}
                onClick={() => onChange({ ...draft, bonus: profile.bonus })}
              >
                {profile.label} {signed(profile.bonus)}
              </button>
            ))}
          </div>
          <div className="steppers">
            <Stepper
              label="Bonificador"
              value={draft.bonus}
              min={-2}
              max={15}
              format={signed}
              onChange={(bonus) => onChange({ ...draft, bonus })}
            />
          </div>
        </>
      ) : null}

      <Segmented
        label="Ventaja"
        value={draft.edge}
        options={EDGES.map((edge) => [edge, EDGE_LABELS[edge]])}
        onChange={(edge) => onChange({ ...draft, edge })}
      />
      {preview && (
        <p className="side-summary">
          Tira con <strong>{signed(preview.bonus)}</strong>
          {preview.edge !== 'none' && <> y {EDGE_LABELS[preview.edge].toLowerCase()}</>}
        </p>
      )}
    </fieldset>
  );
}

/**
 * Los personajes de la mesa, con lo que más se mira durante la partida. El máster ve además sus
 * técnicas de una vez por escena o por sesión y, fuera de combate, puede aplicarles daño a mano.
 */
function TableCharacters(props: {
  game: GameDetail;
  combat: Combat | null;
  spent: SpentAbilities;
  /** Quien mira es el máster, con la partida en juego. */
  master: boolean;
}) {
  const { game, combat, spent, master } = props;
  const characters = useCharacters(game.campaignId);
  if (!characters.data || characters.data.length === 0) return null;
  return (
    <section className="panel" aria-labelledby="table-heading">
      <h2 id="table-heading">Personajes</h2>
      <ul className="table-characters">
        {characters.data.map((character) => (
          <li key={character.id}>
            <Link to={`/personajes/${character.id}`}>{character.name}</Link>
            <span className="muted">
              {SEVERITY_LABELS[character.wounds.severity]} · Rasguños {character.wounds.scratches}/
              {character.wounds.scratchBoxes} · Suerte {character.luck}
            </span>
          </li>
        ))}
      </ul>
      {master && (
        <>
          <LimitedAbilities game={game} characters={characters.data} spent={spent} canUse named />
          {!combat && (
            <ManualDamage game={game} combat={null} characters={characters.data} spent={spent} />
          )}
        </>
      )}
    </section>
  );
}

function CloseGame({ game }: { game: GameDetail }) {
  const [awardXp, setAwardXp] = useState(true);
  const queryClient = useQueryClient();
  const storeEvent = useStoreGameEvent(game.id);
  const close = useMutation({
    mutationFn: () => api.closeGame(game.id, { awardXp }),
    onSuccess: ({ event }) => {
      storeEvent(event);
      refreshCampaign(queryClient, game.campaignId);
      void queryClient.invalidateQueries({ queryKey: keys.games(game.campaignId) });
    },
  });

  return (
    <section className="panel" aria-labelledby="close-heading">
      <h2 id="close-heading">Terminar la partida</h2>
      <label className="check">
        <input type="checkbox" checked={awardXp} onChange={(e) => setAwardXp(e.target.checked)} />
        Dar {XP_AWARDS.perSession} PX de fin de sesión a cada personaje
      </label>
      <p className="muted">Los hitos se dan después en cada ficha.</p>
      <ConfirmButton
        confirmLabel="¿Terminar? Ya no se podrá añadir nada"
        onConfirm={() => close.mutate()}
        disabled={close.isPending}
      >
        Terminar partida
      </ConfirmButton>
      <ErrorNote error={close.error} />
    </section>
  );
}
