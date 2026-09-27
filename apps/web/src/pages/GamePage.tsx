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
  checkBonus,
  combineEdges,
  conditionEdges,
  defaultSkillCatalog,
  opposedOdds,
  successChance,
  testOdds,
  type Attribute,
  type DifficultyLevel,
  type Edge,
  type Situation,
} from '@dungeon-copilot/rules';
import {
  GAME_STATUS_LABELS,
  gameName,
  type CharacterView,
  type GameDetail,
  type GameRollRequest,
  type GameState,
  type RollSideRequest,
} from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, api } from '../api';
import { EventCard } from '../components/GameEvents';
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
import { keys, useCharacters, useGame, useMe, useStoreGameEvent } from '../queries';
import { signed } from '../rules-text';

const EDGES: Edge[] = ['disadvantage', 'none', 'advantage'];
const SITUATIONS: Situation[] = ['test', 'melee', 'ranged'];

export function GamePage() {
  const { gameId = '' } = useParams();
  const state = useGame(gameId);
  const storeEvent = useStoreGameEvent(gameId);
  const queryClient = useQueryClient();
  const game = state.data?.game;

  const live = useLiveEvents({
    url: game?.status === 'open' ? `/api/games/${gameId}/stream` : null,
    after: state.data?.events.at(-1)?.id ?? 0,
    onEvent: (event) => {
      storeEvent(event);
      // Al cerrar se reparten PX: las fichas guardadas ya no están al día.
      if (event.kind === 'closed' && game) refreshCampaign(queryClient, game.campaignId);
    },
    endsWith: (event) => event.kind === 'closed',
    // Ya no deja conectar (por ejemplo, han echado a quien mira): se vuelve a pedir la partida.
    onRefused: () => void queryClient.invalidateQueries({ queryKey: keys.game(gameId) }),
  });
  useDocumentTitle(game ? gameName(game) : undefined);

  // Si deja de tener acceso (le echan de la campaña), la partida guardada ya no vale.
  const lost = state.error instanceof ApiError && state.error.status === 404;
  if (!state.data || !game || lost) return <QueryState error={state.error} />;
  const isMaster = game.role === 'master';
  const isOpen = game.status === 'open';

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
            <Actions state={state.data} />
          ) : (
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
          )}
        </div>

        <section className="room-feed panel" aria-labelledby="feed-heading">
          <h2 id="feed-heading">Registro</h2>
          <ol className="feed" aria-live="polite">
            {[...state.data.events].reverse().map((event) => (
              <li key={event.id}>
                <EventCard event={event} />
              </li>
            ))}
          </ol>
        </section>

        <div className="room-extras">
          <TableCharacters campaignId={game.campaignId} />
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

/** Suerte y PX cambian al abrir y cerrar partidas: fichas y listas se vuelven a pedir. */
function refreshCampaign(queryClient: ReturnType<typeof useQueryClient>, campaignId: string) {
  void queryClient.invalidateQueries({ queryKey: keys.campaign(campaignId) });
  void queryClient.invalidateQueries({ queryKey: ['characters'] });
  void queryClient.invalidateQueries({ queryKey: keys.campaigns, exact: true });
}

type Action = 'roll' | 'reveal' | 'note';

function Actions({ state }: { state: GameState }) {
  const [action, setAction] = useState<Action>('reveal');
  if (state.game.role !== 'master') return <RollForm game={state.game} />;
  return (
    <section className="panel" aria-label="Acciones del máster">
      <Segmented
        label="Qué quieres hacer"
        value={action}
        options={[
          ['reveal', 'Enseñar'],
          ['roll', 'Tirar'],
          ['note', 'Anotar'],
        ]}
        onChange={setAction}
      />
      {action === 'reveal' && <RevealForm gameId={state.game.id} />}
      {action === 'roll' && <RollForm game={state.game} embedded />}
      {action === 'note' && <NoteForm gameId={state.game.id} />}
    </section>
  );
}

function RevealForm({ gameId }: { gameId: string }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const storeEvent = useStoreGameEvent(gameId);
  const reveal = useMutation({
    mutationFn: () => api.reveal(gameId, { title, body }),
    onSuccess: (event) => {
      storeEvent(event);
      setTitle('');
      setBody('');
    },
  });

  return (
    <form
      className="stack tight"
      onSubmit={(event) => {
        event.preventDefault();
        reveal.mutate();
      }}
    >
      <p className="muted">Lo que escribas aparece al momento en la sala y en la pantalla.</p>
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
          required
          rows={5}
          maxLength={5000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <ErrorNote error={reveal.error} />
      <button type="submit" className="button primary" disabled={reveal.isPending}>
        Enseñar a la mesa
      </button>
    </form>
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

/** Lado de una tirada mientras se prepara: un personaje o algo que describe el máster. */
type SideDraft =
  | { kind: 'character'; characterId: string; check: string; modifier: number; edge: Edge }
  | { kind: 'free'; label: string; bonus: number; edge: Edge };

/** "skill:athletics" o "attribute:strength": con qué tira el personaje. */
function parseCheck(check: string): { skill?: string; attribute?: Attribute } {
  const [type, id = ''] = check.split(':');
  return type === 'skill' ? { skill: id } : { attribute: id as Attribute };
}

/** Por defecto, la habilidad en la que el personaje tiene más rango. */
function defaultCheck(character: CharacterView): string {
  const best = Object.entries(character.skills).sort((a, b) => b[1] - a[1])[0];
  return best ? `skill:${best[0]}` : 'attribute:strength';
}

function characterDraft(character: CharacterView): SideDraft {
  return {
    kind: 'character',
    characterId: character.id,
    check: defaultCheck(character),
    modifier: 0,
    edge: 'none',
  };
}

const freeDraft = (label: string): SideDraft => ({
  kind: 'free',
  label,
  bonus: NPC_PROFILES.soldier.bonus,
  edge: 'none',
});

function toSideRequest(draft: SideDraft): RollSideRequest {
  if (draft.kind === 'free') {
    return { kind: 'free', label: draft.label, bonus: draft.bonus, edge: draft.edge };
  }
  return {
    kind: 'character',
    characterId: draft.characterId,
    ...parseCheck(draft.check),
    modifier: draft.modifier,
    edge: draft.edge,
  };
}

/** Bonificador y ventaja con los que tiraría el lado, como los calculará el servidor. */
function previewCheck(
  draft: SideDraft,
  characters: CharacterView[],
): { bonus: number; edge: Edge; wounded: boolean } | null {
  if (draft.kind === 'free') return { bonus: draft.bonus, edge: draft.edge, wounded: false };
  const character = characters.find((c) => c.id === draft.characterId);
  if (!character) return null;
  const { skill, attribute } = parseCheck(draft.check);
  const build = {
    name: character.name,
    background: character.background,
    attributes: character.attributes,
    skills: character.skills,
    advancedSkills: character.advancedSkills,
  };
  const breakdown = checkBonus(build, { skill, attribute, modifier: draft.modifier });
  const imposed = conditionEdges(
    build,
    { attribute: breakdown.attribute, skill },
    { wounds: character.wounds },
  );
  return {
    bonus: breakdown.bonus,
    edge: combineEdges(draft.edge, ...imposed),
    wounded: imposed.includes('disadvantage'),
  };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

function RollForm({ game, embedded = false }: { game: GameDetail; embedded?: boolean }) {
  const { data: me } = useMe();
  const characters = useCharacters(game.campaignId);
  const storeEvent = useStoreGameEvent(game.id);
  const isMaster = game.role === 'master';
  // El máster tira con cualquiera; cada jugador, con los suyos.
  const available = (characters.data ?? []).filter(
    (character) => isMaster || character.ownerId === me?.user?.id,
  );

  const [actor, setActor] = useState<SideDraft | null>(null);
  const [against, setAgainst] = useState<'difficulty' | 'opposed'>('difficulty');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('normal');
  const [opponent, setOpponent] = useState<SideDraft>(() => freeDraft('Rival'));
  const [situation, setSituation] = useState<Situation>('test');
  const [secret, setSecret] = useState(false);

  // Hasta que no se elige, tira el primer personaje disponible (o un PNJ si no hay ninguno).
  const first = available[0];
  const actorDraft = actor ?? (first ? characterDraft(first) : isMaster ? freeDraft('PNJ') : null);

  const roll = useMutation({
    mutationFn: (request: GameRollRequest) => api.gameRoll(game.id, request),
    onSuccess: storeEvent,
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

  const actorCheck = previewCheck(actorDraft, available);
  const opponentCheck = against === 'opposed' ? previewCheck(opponent, characters.data) : null;
  const odds =
    actorCheck &&
    (against === 'difficulty'
      ? testOdds(actorCheck, DIFFICULTIES[difficulty])
      : opponentCheck && opposedOdds(actorCheck, opponentCheck));

  function submit() {
    if (!actorDraft) return;
    roll.mutate({
      actor: toSideRequest(actorDraft),
      target:
        against === 'difficulty'
          ? { kind: 'difficulty', difficulty: DIFFICULTIES[difficulty] }
          : { kind: 'opposed', opponent: toSideRequest(opponent) },
      situation,
      secret: isMaster && secret,
    });
  }

  const content = (
    <form
      className="stack tight"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <SideEditor
        title="Quién tira"
        draft={actorDraft}
        characters={available}
        allowFree={isMaster}
        onChange={setActor}
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
            setAgainst(next);
            setSituation(next === 'opposed' ? 'melee' : 'test');
          }}
        />
      )}
      {against === 'difficulty' ? (
        <label className="field">
          <span className="field-label">Dificultad</span>
          <select
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value as DifficultyLevel)}
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
          allowFree
          onChange={setOpponent}
        />
      )}

      <label className="field">
        <span className="field-label">Situación</span>
        <select
          value={situation}
          onChange={(event) => setSituation(event.target.value as Situation)}
        >
          {SITUATIONS.map((s) => (
            <option key={s} value={s}>
              {SITUATION_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      {isMaster && (
        <label className="check">
          <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
          Tirada secreta: solo la ves tú
        </label>
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
        <button type="submit" className="roll-button" disabled={roll.isPending}>
          {roll.isPending ? 'Tirando…' : 'Tirar'}
        </button>
      </div>
      <ErrorNote error={roll.error} />
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
  allowFree: boolean;
  onChange: (draft: SideDraft) => void;
}) {
  const { title, draft, characters, allowFree, onChange } = props;
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
          value={draft.kind === 'character' ? draft.characterId : 'free'}
          onChange={(event) => {
            const chosen = characters.find((c) => c.id === event.target.value);
            onChange(chosen ? characterDraft(chosen) : freeDraft(''));
          }}
        >
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
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
        </>
      ) : draft.kind === 'free' ? (
        <>
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

/** Los personajes de la mesa, con lo que más se mira durante la partida. */
function TableCharacters({ campaignId }: { campaignId: string }) {
  const characters = useCharacters(campaignId);
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
