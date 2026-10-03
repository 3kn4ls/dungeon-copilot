import {
  CELL_METERS,
  NPC_PROFILES,
  RANGE_CELLS,
  SEVERITY_LABELS,
  UNHARMED,
  canStand,
  cellDistance,
  insideGrid,
  memberDamage,
  rangeAt,
  shotOnMap,
  successChance,
  type Cell,
  type Range,
} from '@dungeon-copilot/rules';
import {
  groupSize,
  tokenKey,
  turnOf,
  type CharacterView,
  type Combat,
  type GameEvent,
  type MapInPlay,
  type MapToken,
  type NpcCombatant,
  type PlaceTokenRequest,
} from '@dungeon-copilot/shared';
import { useMutation } from '@tanstack/react-query';
import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { api } from '../api';
import { useStoreGameEvent } from '../queries';
import { mapAttacks, presetOdds, type MapAttack, type MapFighter } from '../rolling';
import { toneOf } from './Avatar';
import { Icon } from './Icon';
import { CELL, MAP_SCALE, MapTerrain, cellCenter, pointerCell } from './MapGrid';
import { OddsBar, formatChance } from './Odds';
import { ErrorNote, Segmented } from './ui';

/** Quién mira el mapa: el máster lo mueve todo; un jugador, los suyos; la pantalla, nada. */
export type MapViewer = 'master' | 'player' | 'screen';

type Tool = 'move' | 'measure';

const RANGE_LABELS: Record<Range, string> = { short: 'corta', medium: 'media', long: 'larga' };

/** Lo que mide una casilla con el mapa ampliado: lo justo para tocar una ficha con el dedo. */
const ZOOMED_CELL = 36;

const meters = (cells: number) => (cells * CELL_METERS).toLocaleString('es-ES');

/** «7 casillas (10,5 m)». */
export const distanceText = (cells: number) =>
  `${cells} ${cells === 1 ? 'casilla' : 'casillas'} (${meters(cells)} m)`;

/** Lo que pone en la ficha: la inicial y, si es uno de un grupo, su número («B2»). */
function initials(name: string): string {
  const number = /\s(\d+)$/.exec(name)?.[1] ?? '';
  return `${name.trim().charAt(0).toUpperCase()}${number}`;
}

/** El nombre bajo la ficha: entero si es corto; si no, la primera palabra (y su número). */
function shortName(name: string): string {
  if (name.length <= 12) return name;
  const number = /\s(\d+)$/.exec(name)?.[1];
  const first = name.split(/\s+/)[0] ?? name;
  return number ? `${first} ${number}` : first;
}

const ARROWS: Record<string, Cell> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

const sameCell = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;

/** Una ficha que se arrastra: desde dónde, por dónde va (en casillas) y si ya se ha movido. */
interface Drag {
  key: string;
  from: Cell;
  fx: number;
  fy: number;
  moved: boolean;
}

/** Lo que el máster va a poner en el mapa con el siguiente toque en una casilla. */
export interface Placing {
  request: Omit<PlaceTokenRequest, 'at'>;
  name: string;
}

/**
 * El mapa en juego: el plano, las fichas y, para el máster y los jugadores, mover (arrastrando o
 * con el teclado), medir y apuntar. El máster ve las fichas ocultas (salvo que mire «como la
 * mesa»), las mueve todas y las pone desde `placing`; un jugador mueve las suyas (si pelea, en su
 * turno). Al elegir una ficha y luego un rival, debajo salen la distancia, la línea de visión, la
 * cobertura y los ataques, que `aimActions` convierte en botones.
 */
export function BattleMap(props: {
  gameId: string;
  map: MapInPlay;
  combat: Combat | null;
  characters: CharacterView[];
  viewer: MapViewer;
  /** Los personajes de quien mira, si es un jugador. */
  own?: readonly string[];
  /** El máster mira como la mesa: sin lo oculto. */
  asTable?: boolean;
  placing?: Placing | null;
  onPlaced?: () => void;
  /** Lo que se puede hacer con un ataque al apuntar: preparar la tirada o intervenir. */
  aimActions?: (attack: MapAttack, from: MapFighter, to: MapFighter) => ReactNode;
  /** Herramientas y acciones de quien mira, encima y debajo del mapa. */
  toolbar?: ReactNode;
  /** Lo que el máster puede hacer con la ficha elegida. */
  tokenActions?: (token: MapToken) => ReactNode;
}) {
  const { gameId, map, combat, characters, viewer, own = [], asTable = false } = props;
  const { placing = null, onPlaced, aimActions, toolbar, tokenActions } = props;
  const interactive = viewer !== 'screen';
  const svg = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>('move');
  // Ampliado, cada casilla tiene su tamaño y el mapa se recorre con el dedo: para el móvil.
  const [zoomed, setZoomed] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [ghost, setGhost] = useState<{ key: string; at: Cell } | null>(null);
  const [measure, setMeasure] = useState<{ a: Cell; b: Cell; active: boolean } | null>(null);
  const [blocked, setBlocked] = useState(false);
  const storeEvent = useStoreGameEvent(gameId);
  // Mientras se guarda un movimiento, la ficha ya está donde se ha soltado.
  const [pending, setPending] = useState<{ key: string; at: Cell } | null>(null);
  const place = useMutation({
    mutationFn: (body: PlaceTokenRequest) => api.placeToken(gameId, body),
    onSuccess: (event: GameEvent) => storeEvent(event),
    onSettled: () => setPending(null),
  });

  const tokens = map.tokens.filter((token) => !token.hidden || (viewer === 'master' && !asTable));
  const byKey = new Map(tokens.map((token) => [tokenKey(token.token), token]));
  const selected = selectedKey ? byKey.get(selectedKey) : undefined;
  const target = targetKey && selected ? byKey.get(targetKey) : undefined;
  const current = combat ? turnOf(combat) : undefined;
  const npcs = new Map(
    (combat?.order ?? []).flatMap((combatant) =>
      combatant.kind === 'npc' ? [[combatant.id, combatant] as const] : [],
    ),
  );
  const fighting = (token: MapToken) =>
    combat?.order.some((combatant) => combatant.id === token.token.id) ?? false;

  function fighterOf(token: MapToken): MapFighter | undefined {
    if (token.down) return undefined;
    if (token.token.kind === 'character') {
      const { id } = token.token;
      const character = characters.find((candidate) => candidate.id === id);
      return character && { kind: 'character', character };
    }
    if (token.token.kind === 'combatant') {
      const combatant = npcs.get(token.token.id);
      return combatant && { kind: 'npc', combatant, member: token.token.member };
    }
    return undefined;
  }

  /** Si quien mira puede mover la ficha: el máster, todas; un jugador, la suya y en su turno. */
  function canDrag(token: MapToken): boolean {
    if (!interactive) return false;
    if (viewer === 'master') return true;
    if (token.token.kind !== 'character' || !own.includes(token.token.id)) return false;
    return !combat || !fighting(token) || current?.id === token.token.id;
  }

  /** Si se puede dejar una ficha en la casilla: se puede estar y no hay nadie en pie. */
  const free = (cell: Cell, key: string) =>
    canStand(map.grid, cell) &&
    !tokens.some(
      (other) => tokenKey(other.token) !== key && !other.down && sameCell(other.at, cell),
    );

  function moveTo(token: MapToken, at: Cell) {
    const key = tokenKey(token.token);
    if (sameCell(at, token.at)) return;
    if (!free(at, key)) {
      setBlocked(true);
      return;
    }
    setPending({ key, at });
    // Lo oculto sigue oculto al moverlo: se enseña aparte.
    place.mutate({ token: token.token, at, hidden: token.hidden });
  }

  function click(token: MapToken) {
    const key = tokenKey(token.token);
    const from = selected && fighterOf(selected);
    const to = fighterOf(token);
    if (selected && key !== selectedKey && from && to && from.kind !== to.kind) {
      setTargetKey(key === targetKey ? null : key);
      return;
    }
    setSelectedKey(key === selectedKey ? null : key);
    setTargetKey(null);
  }

  function down(event: PointerEvent<SVGElement>, token?: MapToken) {
    if (!interactive || event.button !== 0 || !svg.current) return;
    event.stopPropagation();
    const cell = pointerCell(svg.current, event);
    setBlocked(false);
    if (placing) {
      if (insideGrid(map.grid, cell) && free(cell, tokenKey(placing.request.token))) {
        place.mutate({ ...placing.request, at: cell });
        onPlaced?.();
      } else setBlocked(true);
      return;
    }
    svg.current.setPointerCapture(event.pointerId);
    if (tool === 'measure') {
      setMeasure({ a: cell, b: cell, active: true });
      return;
    }
    if (!token) {
      setSelectedKey(null);
      setTargetKey(null);
      return;
    }
    setGhost(null);
    setDrag({ key: tokenKey(token.token), from: token.at, fx: cell.fx, fy: cell.fy, moved: false });
  }

  function move(event: PointerEvent<SVGElement>) {
    if (!svg.current) return;
    const cell = pointerCell(svg.current, event);
    if (measure?.active) {
      if (insideGrid(map.grid, cell) && !sameCell(cell, measure.b))
        setMeasure({ ...measure, b: cell });
      return;
    }
    if (!drag) return;
    const far = Math.hypot(cell.fx - drag.from.x - 0.5, cell.fy - drag.from.y - 0.5) > 0.5;
    setDrag({ ...drag, fx: cell.fx, fy: cell.fy, moved: drag.moved || far });
  }

  function up() {
    if (measure?.active) setMeasure({ ...measure, active: false });
    if (!drag) return;
    const token = byKey.get(drag.key);
    setDrag(null);
    if (!token) return;
    if (!drag.moved) click(token);
    else if (canDrag(token)) moveTo(token, { x: Math.floor(drag.fx), y: Math.floor(drag.fy) });
  }

  function key(event: KeyboardEvent<SVGGElement>, token: MapToken) {
    const tokenId = tokenKey(token.token);
    const step = ARROWS[event.key];
    if (step && canDrag(token)) {
      event.preventDefault();
      setSelectedKey(tokenId);
      const from = ghost?.key === tokenId ? ghost.at : token.at;
      const at = { x: from.x + step.x, y: from.y + step.y };
      if (insideGrid(map.grid, at)) setGhost({ key: tokenId, at });
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (ghost?.key === tokenId) {
        moveTo(token, ghost.at);
        setGhost(null);
      } else click(token);
    } else if (event.key === 'Escape') {
      setGhost(null);
      setSelectedKey(null);
      setTargetKey(null);
    }
  }

  // Dónde se dibuja cada ficha: arrastrándola, bajo el puntero; guardándose, donde se soltó.
  function position(token: MapToken) {
    const tokenId = tokenKey(token.token);
    if (drag?.key === tokenId && drag.moved && canDrag(token)) {
      return { x: drag.fx * CELL, y: drag.fy * CELL };
    }
    if (pending?.key === tokenId) return cellCenter(pending.at);
    return cellCenter(token.at);
  }

  const from = selected && fighterOf(selected);
  const to = target && fighterOf(target);
  const shot = selected && target ? shotOnMap(map.grid, selected.at, target.at) : undefined;
  // Hasta dónde llega un arma a distancia: las bandas de corta y media, si no apunta a nadie.
  const bands =
    interactive && combat && from?.kind === 'character' && from.character.gear.ranged && !target
      ? selected?.at
      : undefined;
  const dragging = drag?.moved && byKey.get(drag.key);
  const dragCell = drag && { x: Math.floor(drag.fx), y: Math.floor(drag.fy) };

  return (
    <div className={interactive ? 'battle-map' : 'battle-map names'}>
      {interactive && (
        <div className="map-tools">
          <Segmented
            label="Herramienta"
            value={tool}
            options={[
              ['move', 'Mover y apuntar'],
              ['measure', 'Medir'],
            ]}
            onChange={(next) => {
              setTool(next);
              setMeasure(null);
            }}
          />
          <button
            type="button"
            className="chip"
            aria-pressed={zoomed}
            onClick={() => setZoomed(!zoomed)}
          >
            Ampliar
          </button>
          {toolbar}
        </div>
      )}
      <div className={zoomed ? 'map-frame zoomed' : 'map-frame'}>
        <svg
          ref={svg}
          className={`map-svg${placing || tool === 'measure' ? ' map-canvas' : ''}`}
          viewBox={`0 0 ${map.grid.cols * CELL} ${map.grid.rows * CELL}`}
          width={map.grid.cols * MAP_SCALE}
          height={map.grid.rows * MAP_SCALE}
          style={
            zoomed
              ? { width: map.grid.cols * ZOOMED_CELL, height: map.grid.rows * ZOOMED_CELL }
              : undefined
          }
          role="group"
          aria-label={`Mapa: ${map.name}`}
          onPointerDown={(event) => down(event)}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <MapTerrain grid={map.grid} />

          {bands &&
            [RANGE_CELLS.medium, RANGE_CELLS.short].map((reach) => {
              const center = cellCenter(bands);
              const half = (reach + 0.5) * CELL;
              return (
                <rect
                  key={reach}
                  x={center.x - half}
                  y={center.y - half}
                  width={half * 2}
                  height={half * 2}
                  rx={8}
                  className={`m-band band-${reach === RANGE_CELLS.short ? 'short' : 'medium'}`}
                />
              );
            })}

          {selected && target && shot && (
            <g className={shot.visible ? 'm-aim' : 'm-aim blocked'}>
              <line
                x1={cellCenter(selected.at).x}
                y1={cellCenter(selected.at).y}
                x2={cellCenter(target.at).x}
                y2={cellCenter(target.at).y}
              />
            </g>
          )}

          {measure && (
            <g className="m-measure">
              <line
                x1={cellCenter(measure.a).x}
                y1={cellCenter(measure.a).y}
                x2={cellCenter(measure.b).x}
                y2={cellCenter(measure.b).y}
              />
              <text
                x={cellCenter(measure.b).x}
                y={cellCenter(measure.b).y - 22}
                textAnchor="middle"
              >
                {distanceText(cellDistance(measure.a, measure.b))} ·{' '}
                {RANGE_LABELS[rangeAt(cellDistance(measure.a, measure.b))]}
              </text>
            </g>
          )}

          {ghost && byKey.get(ghost.key) && (
            <rect
              x={ghost.at.x * CELL + 2}
              y={ghost.at.y * CELL + 2}
              width={CELL - 4}
              height={CELL - 4}
              rx={6}
              className={free(ghost.at, ghost.key) ? 'm-ghost' : 'm-ghost blocked'}
            />
          )}

          {tokens.map((token) => {
            const id = tokenKey(token.token);
            const { x, y } = position(token);
            const member = token.token.kind === 'combatant' ? token.token.member : 0;
            const combatant =
              token.token.kind === 'combatant' ? npcs.get(token.token.id) : undefined;
            // En el turno de un grupo, brillan todos los suyos que siguen en pie.
            const turn = !token.down && current?.id === token.token.id;
            const classes = [
              'tk',
              `tk-${token.token.kind}`,
              token.hidden && 'hidden',
              token.down && 'down',
              id === selectedKey && 'selected',
              id === targetKey && 'target',
              turn && 'turn',
              canDrag(token) && 'draggable',
            ]
              .filter(Boolean)
              .join(' ');
            const tone =
              token.token.kind === 'character'
                ? toneOf(token.token.id)
                : token.token.kind === 'combatant'
                  ? 'var(--foe)'
                  : 'var(--neutral)';
            return (
              <g
                key={id}
                className={classes}
                style={{ '--tone': tone } as CSSProperties}
                transform={`translate(${x} ${y})`}
                tabIndex={interactive ? 0 : undefined}
                role={interactive ? 'button' : undefined}
                aria-pressed={interactive ? id === selectedKey || id === targetKey : undefined}
                aria-label={`${token.name}, columna ${token.at.x + 1}, fila ${token.at.y + 1}${token.hidden ? ', oculta a la mesa' : ''}${token.down ? ', ha caído' : ''}`}
                onPointerDown={(event) => down(event, token)}
                onKeyDown={(event) => key(event, token)}
              >
                <circle r={23} className="tk-halo" />
                <circle r={16.5} className="tk-base" />
                <text y={5.5} textAnchor="middle" className="tk-initials">
                  {initials(token.name)}
                </text>
                {token.down && <path d="M-9 -9L9 9M9 -9L-9 9" className="tk-down" />}
                {viewer === 'master' && combatant && !token.down && (
                  <HarmPips combat={combat} combatant={combatant} member={member} />
                )}
                <text y={33} textAnchor="middle" className="tk-name">
                  {shortName(token.name)}
                </text>
              </g>
            );
          })}

          {dragging && dragCell && (
            <text
              x={drag.fx * CELL}
              y={drag.fy * CELL - 30}
              textAnchor="middle"
              className={free(dragCell, drag.key) ? 'm-drag-label' : 'm-drag-label blocked'}
            >
              {free(dragCell, drag.key)
                ? distanceText(cellDistance(drag.from, dragCell))
                : 'Ahí no se puede estar'}
            </text>
          )}
        </svg>
      </div>

      {interactive && (
        <div className="map-info" aria-live="polite">
          {placing ? (
            <p className="map-hint">
              <Icon name="pointer" size={16} />
              Toca una casilla libre para poner a {placing.name}.
            </p>
          ) : selected ? (
            <>
              <div className="map-info-head">
                <strong>{selected.name}</strong>
                <span className="muted">{tokenState(selected, characters, combat, viewer)}</span>
                {selected.hidden && (
                  <span className="badge secret">
                    <Icon name="eyeOff" size={14} />
                    Oculta a la mesa
                  </span>
                )}
                {tokenActions?.(selected)}
              </div>
              {ghost?.key === selectedKey && (
                <p className="map-hint">
                  Con las flechas eliges dónde; Intro la mueve allí (
                  {distanceText(cellDistance(selected.at, ghost.at))}) y Escape lo deja.
                </p>
              )}
              {target && shot && !to ? (
                <p className="map-hint">
                  {target.name} {target.down ? 'ha caído' : 'no pelea'}: está a{' '}
                  {distanceText(shot.distance)}.
                </p>
              ) : target && shot ? (
                <Aim
                  target={target}
                  shot={shot}
                  attacks={
                    from && to
                      ? mapAttacks(from, to, shot, fighting(selected) && fighting(target))
                      : []
                  }
                  characters={characters}
                  render={(attack) => from && to && aimActions?.(attack, from, to)}
                />
              ) : (
                from && (
                  <p className="map-hint">
                    {canDrag(selected)
                      ? 'Arrástrala (o muévela con las flechas) y toca a un rival para apuntar.'
                      : 'Toca a un rival para apuntar.'}
                  </p>
                )
              )}
            </>
          ) : (
            <p className="map-hint">
              <Icon name="pointer" size={16} />
              {tool === 'measure'
                ? 'Arrastra de una casilla a otra para medir.'
                : viewer === 'master'
                  ? 'Arrastra las fichas para moverlas. Elige una y toca a un rival para apuntar.'
                  : 'Toca tu ficha y luego a un rival para ver qué puedes hacer.'}
            </p>
          )}
          {blocked && (
            <p className="map-hint blocked" role="alert">
              Ahí no se puede: hay un muro, una ventana, un mueble o alguien en pie.
            </p>
          )}
          <ErrorNote error={place.error} />
        </div>
      )}
    </div>
  );
}

/** El daño que lleva uno de un grupo, en casillas, para el máster. */
function HarmPips({
  combat,
  combatant,
  member,
}: {
  combat: Combat | null;
  combatant: NpcCombatant;
  member: number;
}) {
  const { toughness } = NPC_PROFILES[combatant.profile];
  if (toughness < 2) return null;
  const harm = combat?.harm[combatant.id] ?? UNHARMED;
  const taken = memberDamage(combatant.profile, groupSize(combatant), harm)[member] ?? 0;
  const width = toughness * 7;
  return (
    <g className="tk-harm">
      {Array.from({ length: toughness }, (_, index) => (
        <rect
          key={index}
          x={-width / 2 + index * 7}
          y={-29}
          width={5}
          height={5}
          rx={1}
          className={index < taken ? 'on' : undefined}
        />
      ))}
    </g>
  );
}

/** Cómo está quien tiene la ficha: un personaje, sus heridas; uno de un grupo, si sigue en pie. */
function tokenState(
  token: MapToken,
  characters: CharacterView[],
  combat: Combat | null,
  viewer: MapViewer,
): string {
  if (token.down) return 'Ha caído';
  const ref = token.token;
  if (ref.kind === 'character') {
    const character = characters.find((candidate) => candidate.id === ref.id);
    return character ? SEVERITY_LABELS[character.wounds.severity] : '';
  }
  if (ref.kind === 'figure') return 'Figura: no pelea';
  const combatant = combat?.order.find((other) => other.id === ref.id);
  if (combatant?.kind !== 'npc') return 'Ya no pelea';
  const { toughness, label } = NPC_PROFILES[combatant.profile];
  const harm = combat?.harm[combatant.id] ?? UNHARMED;
  const taken = memberDamage(combatant.profile, groupSize(combatant), harm)[ref.member] ?? 0;
  if (viewer !== 'master') return taken > 0 ? 'Herido' : 'En pie';
  return taken > 0 ? `${label}: lleva ${taken} de ${toughness}` : `${label}: aguanta ${toughness}`;
}

/** Al apuntar: la distancia, si se ve, la cobertura y los ataques, con su probabilidad. */
function Aim(props: {
  target: MapToken;
  shot: ReturnType<typeof shotOnMap>;
  attacks: MapAttack[];
  characters: CharacterView[];
  render: (attack: MapAttack) => ReactNode;
}) {
  const { target, shot, attacks, characters, render } = props;
  return (
    <div className="aim">
      <p className="aim-geo">
        <Icon name="ruler" size={16} />
        <span>
          <strong>{distanceText(shot.distance)}</strong> hasta {target.name}
        </span>
        {shot.distance === 1 ? (
          <span className="badge turn">Cuerpo a cuerpo</span>
        ) : (
          <span className="badge">Distancia {RANGE_LABELS[shot.range]}</span>
        )}
        {!shot.visible && <span className="badge foe">Sin línea de visión</span>}
        {shot.visible && shot.cover === 'partial' && (
          <span className="badge secret">A cubierto (+2)</span>
        )}
      </p>
      {attacks.length === 0 && (
        <p className="muted">
          {shot.visible
            ? 'Desde aquí no puede atacarle: tiene que acercarse o llevar un arma a distancia.'
            : 'Un muro se interpone.'}
        </p>
      )}
      {attacks.map((attack) => (
        <AimOption key={attack.label} attack={attack} characters={characters}>
          {render(attack)}
        </AimOption>
      ))}
    </div>
  );
}

function AimOption(props: { attack: MapAttack; characters: CharacterView[]; children: ReactNode }) {
  const { attack, characters, children } = props;
  const odds = presetOdds(attack.preset, characters);
  return (
    <div className="aim-option">
      <div className="aim-text">
        <strong>
          <Icon name={attack.situation} size={16} /> {attack.label}
        </strong>
        {odds && (
          <div className="aim-odds">
            <OddsBar odds={odds} />
            <span className="num">{formatChance(successChance(odds))}</span>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
