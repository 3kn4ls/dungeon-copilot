import { shotOnMap, type MapShot } from '@dungeon-copilot/rules';
import {
  currentMap,
  groupSize,
  memberName,
  tokenKey,
  type CharacterView,
  type Combat,
  type GameDetail,
  type GameEvent,
  type InterventionEvent,
  type MapInPlay,
  type PlaceTokenRequest,
  type TokenRef,
} from '@dungeon-copilot/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useMaps, useStoreGameEvent } from '../queries';
import type { MapAttack, MapFighter, RollPreset } from '../rolling';
import { BattleMap, type Placing } from './BattleMap';
import { Icon } from './Icon';
import { ConfirmButton, ErrorNote } from './ui';

/**
 * Un id nuevo para una figura. `crypto.randomUUID` solo existe en páginas seguras (https o
 * localhost): fuera de ellas, se hace a mano con números al azar.
 */
function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Dónde está, en el mapa, el rival de una intervención respecto a quien interviene: la distancia,
 * si se ve y si está a cubierto. undefined si falta alguno de los dos (o el rival ya ha caído).
 */
export function interventionShot(
  map: MapInPlay | null,
  intervention: InterventionEvent,
): MapShot | undefined {
  const { target } = intervention;
  if (!map || !target) return undefined;
  const from = map.tokens.find(
    ({ token }) => token.kind === 'character' && token.id === intervention.characterId,
  );
  const to = map.tokens.find(
    ({ token, down }) =>
      !down &&
      token.kind === 'combatant' &&
      token.id === target.id &&
      (target.member === undefined || token.member === target.member),
  );
  return from && to ? shotOnMap(map.grid, from.at, to.at) : undefined;
}

/** Si una ficha ya está en el mapa (también oculta). */
const onMap = (map: MapInPlay, token: TokenRef) =>
  map.tokens.some((other) => tokenKey(other.token) === tokenKey(token));

/** Para elegir un mapa de la campaña y ponerlo en la partida. */
function MapPicker(props: {
  game: GameDetail;
  current: MapInPlay | null;
  onPut: (mapId: string) => void;
  pending: boolean;
}) {
  const { game, current, onPut, pending } = props;
  const maps = useMaps(game.campaignId);
  const [chosen, setChosen] = useState('');
  const others = (maps.data ?? []).filter((map) => map.id !== current?.id);
  if (!maps.data) return null;
  if (maps.data.length === 0) {
    return (
      <p className="muted">
        Aún no hay mapas en la campaña. Dibújalos en la pestaña{' '}
        <Link to={`/campanas/${game.campaignId}/mapas`}>Mapas</Link>.
      </p>
    );
  }
  if (others.length === 0) return null;
  const mapId = chosen || (others[0]?.id ?? '');
  return (
    <div className="map-picker">
      <select
        aria-label={current ? 'Otro mapa' : 'Qué mapa'}
        value={mapId}
        onChange={(event) => setChosen(event.target.value)}
      >
        {others.map((map) => (
          <option key={map.id} value={map.id}>
            {map.name}
          </option>
        ))}
      </select>
      {current ? (
        <ConfirmButton
          small
          confirmLabel="¿Cambiar? Las fichas se quitan"
          disabled={pending}
          onConfirm={() => onPut(mapId)}
        >
          Cambiar de mapa
        </ConfirmButton>
      ) : (
        <button
          type="button"
          className="button small primary"
          disabled={pending}
          onClick={() => onPut(mapId)}
        >
          Poner en la mesa
        </button>
      )}
    </div>
  );
}

/**
 * El mapa en la sala del máster: ponerlo o cambiarlo, poner fichas (personajes, quien pelea y
 * figuras, que pueden ir ocultas), moverlas, enseñarlas o quitarlas, verlo como la mesa y, al
 * apuntar, preparar la tirada en Tirar (`onPrepare`).
 */
export function MasterMap(props: {
  game: GameDetail;
  events: readonly GameEvent[];
  combat: Combat | null;
  characters: CharacterView[];
  onPrepare: (preset: RollPreset) => void;
}) {
  const { game, events, combat, characters, onPrepare } = props;
  const map = currentMap(events);
  const storeEvent = useStoreGameEvent(game.id);
  const [asTable, setAsTable] = useState(false);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [figure, setFigure] = useState({ name: '', hidden: true });
  const setMap = useMutation({
    mutationFn: (mapId: string | null) => api.setGameMap(game.id, { mapId }),
    onSuccess: storeEvent,
  });
  const place = useMutation({
    mutationFn: (body: PlaceTokenRequest) => api.placeToken(game.id, body),
    onSuccess: storeEvent,
  });

  if (!map) {
    return (
      <section className="panel map-panel" aria-labelledby="map-heading">
        <h2 id="map-heading">Mapa</h2>
        <p className="muted">
          Para los combates: cada uno en su casilla, con la distancia y la cobertura a la vista.
        </p>
        <MapPicker
          game={game}
          current={null}
          pending={setMap.isPending}
          onPut={(mapId) => setMap.mutate(mapId)}
        />
        <ErrorNote error={setMap.error} />
      </section>
    );
  }

  // Lo que aún no está en el mapa: personajes, cada uno de los que pelean y figuras nuevas.
  const outside = characters.filter(
    (character) => !onMap(map, { kind: 'character', id: character.id }),
  );
  const members = (combat?.order ?? []).flatMap((combatant) =>
    combatant.kind === 'npc'
      ? Array.from({ length: groupSize(combatant) }, (_, member) => ({
          token: { kind: 'combatant' as const, id: combatant.id, member },
          name: memberName(combatant, member),
        })).filter(({ token }) => !onMap(map, token))
      : [],
  );
  const pick = (token: TokenRef, name: string, hidden = false) =>
    setPlacing({ request: { token, hidden, name }, name });

  return (
    <section className="panel map-panel" aria-labelledby="map-heading">
      <div className="map-panel-head">
        <h2 id="map-heading">{map.name}</h2>
        <div className="actions">
          <MapPicker
            game={game}
            current={map}
            pending={setMap.isPending}
            onPut={(mapId) => setMap.mutate(mapId)}
          />
          <ConfirmButton
            quiet
            confirmLabel="¿Quitar el mapa de la mesa?"
            disabled={setMap.isPending}
            onConfirm={() => setMap.mutate(null)}
          >
            Quitar el mapa
          </ConfirmButton>
        </div>
      </div>
      <BattleMap
        gameId={game.id}
        map={map}
        combat={combat}
        characters={characters}
        viewer="master"
        asTable={asTable}
        placing={placing}
        onPlaced={() => setPlacing(null)}
        toolbar={
          <button
            type="button"
            className="chip"
            aria-pressed={asTable}
            onClick={() => setAsTable(!asTable)}
          >
            <Icon name={asTable ? 'eyeOff' : 'eye'} size={16} />
            Ver como la mesa
          </button>
        }
        tokenActions={(token) => (
          <span className="actions">
            {token.hidden && (
              <button
                type="button"
                className="button small"
                disabled={place.isPending}
                onClick={() => place.mutate({ token: token.token, at: token.at })}
              >
                <Icon name="eye" size={16} />
                Enseñar a la mesa
              </button>
            )}
            <button
              type="button"
              className="button small"
              disabled={place.isPending}
              onClick={() => place.mutate({ token: token.token, at: null })}
            >
              Quitar del mapa
            </button>
          </span>
        )}
        aimActions={(attack: MapAttack) => (
          <button
            type="button"
            className="button small primary"
            onClick={() => onPrepare(attack.preset)}
          >
            <Icon name="dice" size={16} />
            Preparar la tirada
          </button>
        )}
      />

      <div className="token-palette">
        <h3 className="field-label">Poner en el mapa</h3>
        {placing ? (
          <div className="actions">
            <span>Toca una casilla libre para poner a {placing.name}.</span>
            <button type="button" className="button small" onClick={() => setPlacing(null)}>
              Cancelar
            </button>
          </div>
        ) : (
          <>
            {(outside.length > 0 || members.length > 0) && (
              <div className="chips" role="group" aria-label="Personajes y quien pelea">
                {outside.map((character) => (
                  <button
                    key={character.id}
                    type="button"
                    className="chip"
                    onClick={() => pick({ kind: 'character', id: character.id }, character.name)}
                  >
                    {character.name}
                  </button>
                ))}
                {members.map(({ token, name }) => (
                  <button
                    key={tokenKey(token)}
                    type="button"
                    className="chip foe"
                    onClick={() => pick(token, name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
            <form
              className="figure-form"
              onSubmit={(event) => {
                event.preventDefault();
                pick({ kind: 'figure', id: newId() }, figure.name.trim(), figure.hidden);
                setFigure({ ...figure, name: '' });
              }}
            >
              <input
                aria-label="Nombre de la figura"
                required
                maxLength={40}
                placeholder="Figura: Bandido 1, el posadero…"
                value={figure.name}
                onChange={(event) => setFigure({ ...figure, name: event.target.value })}
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={figure.hidden}
                  onChange={(event) => setFigure({ ...figure, hidden: event.target.checked })}
                />
                Oculta a la mesa
              </label>
              <button type="submit" className="button small">
                Poner figura
              </button>
            </form>
            <p className="hint">
              Las figuras son quien aún no pelea: enemigos escondidos, el posadero… Al empezar el
              combate, las que elijas pasan a pelear en su casilla.
            </p>
          </>
        )}
      </div>
      <ErrorNote error={setMap.error ?? place.error} />
    </section>
  );
}

/**
 * El mapa en la sala de un jugador: pone y mueve la ficha de su personaje (si pelea, en su turno)
 * y, al apuntar a un rival, ataca o dispara: es una intervención contra ese de su grupo, que el
 * máster atiende.
 */
export function PlayerMap(props: {
  game: GameDetail;
  map: MapInPlay;
  combat: Combat | null;
  characters: CharacterView[];
  /** Los personajes de quien mira. */
  mine: CharacterView[];
}) {
  const { game, map, combat, characters, mine } = props;
  const storeEvent = useStoreGameEvent(game.id);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const intervene = useMutation({
    mutationFn: (body: { attack: MapAttack; from: MapFighter; to: MapFighter }) => {
      const { attack, from, to } = body;
      if (from.kind !== 'character' || to.kind !== 'npc') throw new Error('Ese ataque no es tuyo');
      return api.intervene(game.id, {
        characterId: from.character.id,
        intent: attack.situation,
        targetId: to.combatant.id,
        targetMember: to.member,
      });
    },
    onSuccess: (event) => {
      storeEvent(event);
      setSent(event.kind === 'intervention' ? event.name : null);
    },
  });
  const outside = mine.filter((character) => !onMap(map, { kind: 'character', id: character.id }));
  const fighting = (id: string) => combat?.order.some((combatant) => combatant.id === id) ?? false;

  return (
    <section className="panel map-panel" aria-labelledby="player-map-heading">
      <h2 id="player-map-heading">{map.name}</h2>
      <BattleMap
        gameId={game.id}
        map={map}
        combat={combat}
        characters={characters}
        viewer="player"
        own={mine.map((character) => character.id)}
        placing={placing}
        onPlaced={() => setPlacing(null)}
        toolbar={outside.map((character) => (
          <button
            key={character.id}
            type="button"
            className="chip"
            aria-pressed={placing?.name === character.name}
            onClick={() =>
              setPlacing(
                placing
                  ? null
                  : {
                      request: { token: { kind: 'character', id: character.id } },
                      name: character.name,
                    },
              )
            }
          >
            Poner a {character.name}
          </button>
        ))}
        aimActions={(attack, from, to) =>
          from.kind === 'character' &&
          mine.some((character) => character.id === from.character.id) &&
          to.kind === 'npc' &&
          fighting(from.character.id) && (
            <button
              type="button"
              className="button small primary"
              disabled={intervene.isPending}
              onClick={() => intervene.mutate({ attack, from, to })}
            >
              <Icon name={attack.situation} size={16} />
              {attack.situation === 'melee' ? 'Atacar' : 'Disparar'}
            </button>
          )
        }
      />
      {sent && intervene.isSuccess && (
        <p className="map-hint" role="status">
          <Icon name="check" size={16} />
          {sent} espera al máster: lo verá en su cola.
        </p>
      )}
      <ErrorNote error={intervene.error} />
    </section>
  );
}
