import {
  NPC_PROFILES,
  NPC_PROFILE_IDS,
  SEVERITY_LABELS,
  type NpcProfile,
} from '@dungeon-copilot/rules';
import {
  nextTurn,
  turnOf,
  type CharacterView,
  type Combat,
  type Combatant,
  type CombatantRequest,
  type Floor,
  type GameDetail,
  type InterventionEvent,
  type NpcCombatant,
  type NpcView,
} from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { refreshCharacters, useStoreGameEvent } from '../queries';
import { AnsweringNote } from './Interventions';
import { profileText } from './Npcs';
import { ConfirmButton, ErrorNote } from './ui';

/**
 * El orden de iniciativa, con a quién le toca. El máster ve además el perfil de los PNJ y, con
 * `actions`, lo que puede hacer con cada uno.
 */
export function CombatOrder({
  combat,
  characters,
  master = false,
  actions,
}: {
  combat: Combat;
  characters: CharacterView[];
  master?: boolean;
  actions?: (combatant: Combatant) => ReactNode;
}) {
  return (
    <ol className="combat-order" aria-label="Orden de iniciativa">
      {combat.order.map((combatant, index) => {
        const current = index === combat.turn;
        const sheet =
          combatant.kind === 'character'
            ? characters.find((character) => character.id === combatant.id)
            : undefined;
        return (
          <li
            key={combatant.id}
            className={current ? 'combatant current' : 'combatant'}
            aria-current={current ? 'step' : undefined}
          >
            <span className="combatant-initiative" title="Iniciativa">
              {combatant.initiative.total}
            </span>
            <span className="combatant-name">{combatant.name}</span>
            {master && combatant.kind === 'npc' && (
              <span className="muted">{NPC_PROFILES[combatant.profile].label}</span>
            )}
            {sheet && sheet.wounds.severity !== 'none' && (
              <span className="badge">{SEVERITY_LABELS[sheet.wounds.severity]}</span>
            )}
            {current && <span className="badge live">Su turno</span>}
            {actions?.(combatant)}
          </li>
        );
      })}
    </ol>
  );
}

/** Para un jugador: de quién es el turno, destacado si es de uno de los suyos. */
export function TurnStatus({
  combat,
  floor,
  characterIds,
}: {
  combat: Combat;
  floor: Floor;
  /** Los personajes de quien mira. */
  characterIds: readonly string[];
}) {
  const current = turnOf(combat);
  const yours = current.kind === 'character' && characterIds.includes(current.id);
  let text: string;
  if (yours) text = `¡Te toca, ${current.name}! Di qué hace y, al acabar, termina tu turno.`;
  else if (floor.kind === 'table') text = '¿Qué hacéis? La palabra es de la mesa.';
  else if (floor.kind === 'character' && characterIds.includes(floor.characterId)) {
    text = `Tienes la palabra: ${floor.name}.`;
  } else if (current.kind === 'npc') text = `Le toca a ${current.name}: juega el máster.`;
  else text = `Le toca a ${current.name}.`;
  return (
    <p className={yours ? 'floor-status yours' : 'floor-status'} aria-live="polite">
      {text}
    </p>
  );
}

/** Terminar un turno: el máster, el de quien sea; un jugador, el de su personaje. */
function useEndTurn(game: GameDetail, combat: Combat) {
  const storeEvent = useStoreGameEvent(game.id);
  const current = turnOf(combat);
  return useMutation({
    mutationFn: () => api.nextTurn(game.id, { round: combat.round, combatantId: current.id }),
    onSuccess: storeEvent,
  });
}

/** El botón del jugador para acabar su turno. */
export function EndTurn({ game, combat }: { game: GameDetail; combat: Combat }) {
  const end = useEndTurn(game, combat);
  return (
    <div className="stack tight">
      <div className="actions">
        <button
          type="button"
          className="button"
          disabled={end.isPending}
          onClick={() => end.mutate()}
        >
          Terminar mi turno
        </button>
      </div>
      <ErrorNote error={end.error} />
    </div>
  );
}

/** Unos enemigos mientras el máster los prepara: uno solo, un grupo o un PNJ de la campaña. */
interface EnemyDraft {
  /** Para la lista: cada fila tiene la suya. */
  key: number;
  name: string;
  profile: NpcProfile;
  npcId?: string | undefined;
}

let enemyCount = 0;
const newEnemy = (): EnemyDraft => ({ key: enemyCount++, name: '', profile: 'soldier' });

const enemyRequest = ({ name, profile, npcId }: EnemyDraft): CombatantRequest => ({
  kind: 'npc',
  name,
  profile,
  npcId,
});

const characterRequest = (characterId: string): CombatantRequest => ({
  kind: 'character',
  characterId,
});

/** Para elegir quién entra en el combate: personajes de la campaña y enemigos. */
function CombatantsPicker(props: {
  /** Los personajes que pueden entrar. */
  characters: CharacterView[];
  chosen: readonly string[];
  onChosen: (ids: string[]) => void;
  enemies: EnemyDraft[];
  onEnemies: (enemies: EnemyDraft[]) => void;
  npcs: NpcView[];
}) {
  const { characters, chosen, onChosen, enemies, onEnemies, npcs } = props;
  const toggle = (id: string) =>
    onChosen(chosen.includes(id) ? chosen.filter((other) => other !== id) : [...chosen, id]);
  const change = (key: number, next: Partial<EnemyDraft>) =>
    onEnemies(enemies.map((enemy) => (enemy.key === key ? { ...enemy, ...next } : enemy)));

  return (
    <>
      {characters.length > 0 && (
        <div className="field">
          <span className="field-label" id="fighters-label">
            Personajes
          </span>
          <div className="chips" role="group" aria-labelledby="fighters-label">
            {characters.map((character) => (
              <button
                key={character.id}
                type="button"
                className="chip"
                aria-pressed={chosen.includes(character.id)}
                onClick={() => toggle(character.id)}
              >
                {character.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <span className="field-label">Enemigos</span>
        {enemies.length > 0 && (
          <ol className="enemy-list">
            {enemies.map((enemy, index) => {
              const label = `Enemigos ${index + 1}`;
              return (
                <li key={enemy.key} className="enemy-row">
                  {npcs.length > 0 && (
                    <select
                      aria-label={`${label}: quién`}
                      value={enemy.npcId ?? ''}
                      onChange={(event) => {
                        const npc = npcs.find((candidate) => candidate.id === event.target.value);
                        change(
                          enemy.key,
                          npc
                            ? {
                                npcId: npc.id,
                                name: npc.name,
                                profile: npc.profile ?? enemy.profile,
                              }
                            : { npcId: undefined, name: '' },
                        );
                      }}
                    >
                      <option value="">Otros: los describes tú</option>
                      <optgroup label="PNJ de la campaña">
                        {npcs.map((npc) => (
                          <option key={npc.id} value={npc.id}>
                            {npc.profile ? `${npc.name} (${profileText(npc.profile)})` : npc.name}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  )}
                  {!enemy.npcId && (
                    <input
                      aria-label={`${label}: nombre`}
                      required
                      maxLength={80}
                      placeholder="3 bandidos"
                      value={enemy.name}
                      onChange={(event) => change(enemy.key, { name: event.target.value })}
                    />
                  )}
                  <div className="chips" role="group" aria-label={`${label}: perfil`}>
                    {NPC_PROFILE_IDS.map((profile) => (
                      <button
                        key={profile}
                        type="button"
                        className="chip"
                        aria-pressed={enemy.profile === profile}
                        onClick={() => change(enemy.key, { profile })}
                      >
                        {profileText(profile)}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onEnemies(enemies.filter((other) => other.key !== enemy.key))}
                  >
                    Quitar
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        <div className="actions">
          <button
            type="button"
            className="button small"
            onClick={() => onEnemies([...enemies, newEnemy()])}
          >
            Añadir enemigos
          </button>
        </div>
        <span className="hint">
          Un grupo («3 bandidos») tira la iniciativa una vez, con la Destreza de su perfil.
        </span>
      </div>
    </>
  );
}

/**
 * Para empezar un combate: el máster elige quién pelea y el servidor tira la iniciativa. Con
 * `answering`, el combate responde a quien ha atacado; se monta de nuevo con cada intervención.
 */
export function StartCombat(props: {
  game: GameDetail;
  characters: CharacterView[];
  npcs: NpcView[];
  answering: InterventionEvent | undefined;
  onStopAnswering: () => void;
}) {
  const { game, characters, npcs, answering, onStopAnswering } = props;
  const [open, setOpen] = useState(answering !== undefined);
  /** Los personajes que pelean; mientras no se toque, todos. */
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [enemies, setEnemies] = useState<EnemyDraft[]>(() => [newEnemy()]);
  const storeEvent = useStoreGameEvent(game.id);
  const fighters = chosen ?? characters.map((character) => character.id);
  const start = useMutation({
    mutationFn: () =>
      api.startCombat(game.id, {
        combatants: [...fighters.map(characterRequest), ...enemies.map(enemyRequest)],
        answers: answering?.id,
      }),
    onSuccess: storeEvent,
  });

  if (!open) {
    return (
      <div className="actions">
        <button type="button" className="button" onClick={() => setOpen(true)}>
          Empezar combate
        </button>
      </div>
    );
  }
  return (
    <form
      className="combat-form stack tight"
      onSubmit={(event) => {
        event.preventDefault();
        start.mutate();
      }}
    >
      <h3>Empezar combate</h3>
      {answering && <AnsweringNote intervention={answering} onCancel={onStopAnswering} />}
      <p className="muted">
        Elige quién pelea. Al empezar se tira la iniciativa de todos, y la palabra pasa a quien le
        toque.
      </p>
      <CombatantsPicker
        characters={characters}
        chosen={fighters}
        onChosen={setChosen}
        enemies={enemies}
        onEnemies={setEnemies}
        npcs={npcs}
      />
      <ErrorNote error={start.error} />
      <div className="actions">
        <button type="submit" className="button primary" disabled={start.isPending}>
          Tirar la iniciativa y empezar
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            setOpen(false);
            if (answering) onStopAnswering();
          }}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

/**
 * El combate, para el máster: el orden y a quién le toca, sacar a quien cae o huye, atacar con
 * los PNJ en su turno y pasar el turno.
 */
export function CombatTracker(props: {
  game: GameDetail;
  combat: Combat;
  characters: CharacterView[];
  /** Los PNJ a los que les toca atacan a un personaje: se prepara la tirada. */
  onAttack: (enemy: NpcCombatant, target: CharacterView) => void;
}) {
  const { game, combat, characters, onAttack } = props;
  const storeEvent = useStoreGameEvent(game.id);
  const pass = useEndTurn(game, combat);
  const leave = useMutation({
    mutationFn: (combatantId: string) => api.leaveCombat(game.id, { combatantId }),
    onSuccess: storeEvent,
  });
  const current = turnOf(combat);
  const upcoming = nextTurn(combat);
  const next = turnOf({ ...combat, ...upcoming });
  const targets = combat.order.flatMap((combatant) =>
    combatant.kind === 'character'
      ? characters.filter((character) => character.id === combatant.id)
      : [],
  );

  return (
    <div className="stack tight">
      <CombatOrder
        combat={combat}
        characters={characters}
        master
        actions={(combatant) =>
          combat.order.length > 1 && (
            <ConfirmButton
              quiet
              confirmLabel="¿Sacar del combate?"
              disabled={leave.isPending}
              onConfirm={() => leave.mutate(combatant.id)}
            >
              Sacar
            </ConfirmButton>
          )
        }
      />
      {current.kind === 'npc' && targets.length > 0 && (
        <div className="enemy-turn">
          <span className="field-label" id="enemy-turn-label">
            Le toca a {current.name}. Atacar a:
          </span>
          <div className="chips" role="group" aria-labelledby="enemy-turn-label">
            {targets.map((target) => (
              <button
                key={target.id}
                type="button"
                className="chip"
                onClick={() => onAttack(current, target)}
              >
                {target.name}
              </button>
            ))}
          </div>
          <span className="hint">
            Se prepara en Tirar: {current.name} contra la defensa del personaje, que tira su
            jugador.
          </span>
        </div>
      )}
      <div className="actions">
        <button
          type="button"
          className="button primary"
          disabled={pass.isPending}
          onClick={() => pass.mutate()}
        >
          Siguiente turno: {next.name}
          {upcoming.round > combat.round && ` (ronda ${upcoming.round})`}
        </button>
      </div>
      <ErrorNote error={pass.error ?? leave.error} />
    </div>
  );
}

/** Meter en el combate a quien llega: refuerzos o un personaje que no peleaba. */
export function JoinCombat(props: {
  game: GameDetail;
  combat: Combat;
  characters: CharacterView[];
  npcs: NpcView[];
}) {
  const { game, combat, characters, npcs } = props;
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [enemies, setEnemies] = useState<EnemyDraft[]>([]);
  const storeEvent = useStoreGameEvent(game.id);
  const outside = characters.filter(
    (character) => !combat.order.some((combatant) => combatant.id === character.id),
  );
  const close = () => {
    setOpen(false);
    setChosen([]);
    setEnemies([]);
  };
  const join = useMutation({
    mutationFn: () =>
      api.joinCombat(game.id, {
        combatants: [
          ...chosen
            .filter((id) => outside.some((character) => character.id === id))
            .map(characterRequest),
          ...enemies.map(enemyRequest),
        ],
      }),
    onSuccess: (event) => {
      storeEvent(event);
      close();
    },
  });

  if (!open) {
    return (
      <div className="actions">
        <button
          type="button"
          className="button small"
          onClick={() => {
            setOpen(true);
            if (outside.length === 0) setEnemies([newEnemy()]);
          }}
        >
          Añadir al combate
        </button>
      </div>
    );
  }
  return (
    <form
      className="combat-form stack tight"
      onSubmit={(event) => {
        event.preventDefault();
        join.mutate();
      }}
    >
      <h3>Se unen al combate</h3>
      <p className="muted">
        Tiran la iniciativa al llegar y ocupan su sitio en el orden. Si su sitio ya ha pasado,
        actúan en la ronda siguiente.
      </p>
      <CombatantsPicker
        characters={outside}
        chosen={chosen}
        onChosen={setChosen}
        enemies={enemies}
        onEnemies={setEnemies}
        npcs={npcs}
      />
      <ErrorNote error={join.error} />
      <div className="actions">
        <button type="submit" className="button primary" disabled={join.isPending}>
          Tirar su iniciativa
        </button>
        <button type="button" className="button" onClick={close}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Terminar el combate y volver a narrar, recuperando el aliento si se quiere. */
export function EndCombat({ game }: { game: GameDetail }) {
  const [recover, setRecover] = useState(true);
  const queryClient = useQueryClient();
  const storeEvent = useStoreGameEvent(game.id);
  const end = useMutation({
    mutationFn: () => api.endCombat(game.id, { recover }),
    onSuccess: (event) => {
      storeEvent(event);
      refreshCharacters(queryClient, game.campaignId);
    },
  });
  return (
    <div className="combat-end stack tight">
      <label className="check">
        <input
          type="checkbox"
          checked={recover}
          onChange={(event) => setRecover(event.target.checked)}
        />
        Recuperar el aliento: se borran los rasguños de los personajes que siguen peleando
      </label>
      <div className="actions">
        <ConfirmButton
          confirmLabel="¿Terminar el combate?"
          disabled={end.isPending}
          onConfirm={() => end.mutate()}
        >
          Terminar el combate
        </ConfirmButton>
      </div>
      <ErrorNote error={end.error} />
    </div>
  );
}
