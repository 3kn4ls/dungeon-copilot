import {
  TERRAIN_LABELS,
  terrainAt,
  terrainMap,
  type BattleGrid,
  type Cell,
  type Terrain,
} from '@dungeon-copilot/rules';
import { useId } from 'react';

/** El lado de una casilla en el dibujo del mapa: todo lo demás se mide con él. */
export const CELL = 40;

/** Lo que mide una casilla en pantalla, como mucho: el mapa se encoge si no cabe. */
export const MAP_SCALE = 56;

export const cellKey = (cell: Cell) => `${cell.x},${cell.y}`;

/** El centro de una casilla, en el dibujo. */
export const cellCenter = (cell: Cell) => ({ x: (cell.x + 0.5) * CELL, y: (cell.y + 0.5) * CELL });

/** La casilla bajo el puntero, aunque se salga del mapa, y dónde está exactamente (en casillas). */
export function pointerCell(
  svg: SVGSVGElement,
  event: { clientX: number; clientY: number },
): Cell & { fx: number; fy: number } {
  const matrix = svg.getScreenCTM();
  const point = matrix
    ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    : new DOMPoint(0, 0);
  const fx = point.x / CELL;
  const fy = point.y / CELL;
  return { x: Math.floor(fx), y: Math.floor(fy), fx, fy };
}

/** Las líneas de la cuadrícula, por dentro del mapa. */
function gridPath({ cols, rows }: Pick<BattleGrid, 'cols' | 'rows'>): string {
  const lines: string[] = [];
  for (let x = 1; x < cols; x++) lines.push(`M${x * CELL} 0V${rows * CELL}`);
  for (let y = 1; y < rows; y++) lines.push(`M0 ${y * CELL}H${cols * CELL}`);
  return lines.join('');
}

/** Lo que hay en las cuatro casillas de alrededor. */
interface Around {
  left?: Terrain | undefined;
  right?: Terrain | undefined;
  up?: Terrain | undefined;
  down?: Terrain | undefined;
}

/** Lo que forma parte de un muro: una puerta o una ventana van en su dirección. */
const inWall = (kind: Terrain | undefined) =>
  kind === 'wall' || kind === 'window' || kind === 'door';

/**
 * Lo que hay en una casilla: un muro; una puerta, como una hoja de madera en el hueco; una
 * ventana, como un cristal en el muro; o un mueble, que se une a los de al lado. Las puertas y
 * las ventanas van a lo largo del muro en el que están (en horizontal si no hay ninguno).
 */
export function TerrainTile({
  x,
  y,
  kind,
  around = {},
}: Cell & { kind: Terrain; around?: Around }) {
  const left = x * CELL;
  const top = y * CELL;
  const upright =
    !inWall(around.left) && !inWall(around.right) && (inWall(around.up) || inWall(around.down));
  switch (kind) {
    case 'wall':
      return <rect x={left} y={top} width={CELL} height={CELL} className="m-wall" />;
    case 'door':
      return upright ? (
        <rect x={left + 15} y={top + 3} width={10} height={CELL - 6} rx={2} className="m-door" />
      ) : (
        <rect x={left + 3} y={top + 15} width={CELL - 6} height={10} rx={2} className="m-door" />
      );
    case 'window':
      return (
        <g>
          <rect x={left} y={top} width={CELL} height={CELL} className="m-wall" />
          {upright ? (
            <rect x={left + 17} y={top + 3} width={6} height={CELL - 6} className="m-window" />
          ) : (
            <rect x={left + 3} y={top + 17} width={CELL - 6} height={6} className="m-window" />
          )}
        </g>
      );
    case 'cover': {
      // Pegado a otro mueble, llega hasta el borde: una mesa de dos casillas es una sola.
      const inset = (side: Terrain | undefined) => (side === 'cover' ? 0 : 4);
      const x0 = left + inset(around.left);
      const x1 = left + CELL - inset(around.right);
      const y0 = top + inset(around.up);
      const y1 = top + CELL - inset(around.down);
      const edges = [
        around.left !== 'cover' && `M${x0} ${y0}V${y1}`,
        around.right !== 'cover' && `M${x1} ${y0}V${y1}`,
        around.up !== 'cover' && `M${x0} ${y0}H${x1}`,
        around.down !== 'cover' && `M${x0} ${y1}H${x1}`,
      ].filter(Boolean);
      return (
        <g>
          <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} className="m-cover" />
          <path d={edges.join('')} className="m-cover-edge" />
        </g>
      );
    }
  }
}

/**
 * El plano: el suelo de tablas, lo que hay en cada casilla y la cuadrícula. Va dentro de un
 * <svg> con su viewBox de `cols × rows` casillas.
 */
export function MapTerrain({ grid, lines = true }: { grid: BattleGrid; lines?: boolean }) {
  // Cada dibujo, con su propio dibujo de tablas: los id se comparten en toda la página.
  const planks = `planks-${useId().replace(/[^\w-]/g, '')}`;
  const kinds = terrainMap(grid);
  const half = CELL / 2;
  return (
    <g>
      <defs>
        <pattern id={planks} width={CELL} height={half} patternUnits="userSpaceOnUse">
          <rect width={CELL} height={half} className="m-floor" />
          <path d={`M0 ${half - 0.5}H${CELL}M${CELL * 0.6} 0V${half}`} className="m-plank" />
        </pattern>
      </defs>
      <rect width={grid.cols * CELL} height={grid.rows * CELL} fill={`url(#${planks})`} />
      {lines && <path d={gridPath(grid)} className="m-grid" />}
      {grid.terrain.map((tile) => (
        <TerrainTile
          key={cellKey(tile)}
          {...tile}
          around={{
            left: terrainAt(kinds, { x: tile.x - 1, y: tile.y }),
            right: terrainAt(kinds, { x: tile.x + 1, y: tile.y }),
            up: terrainAt(kinds, { x: tile.x, y: tile.y - 1 }),
            down: terrainAt(kinds, { x: tile.x, y: tile.y + 1 }),
          }}
        />
      ))}
    </g>
  );
}

/** El mapa en pequeño, para reconocerlo en la lista: llena su sitio, aunque se corten los bordes. */
export function MapThumb({ grid }: { grid: BattleGrid }) {
  return (
    <svg
      viewBox={`0 0 ${grid.cols * CELL} ${grid.rows * CELL}`}
      className="map-thumb"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <MapTerrain grid={grid} lines={false} />
    </svg>
  );
}

/** Cómo se ve cada cosa del mapa, para la leyenda. */
export function MapLegend() {
  return (
    <ul className="map-legend" aria-label="Leyenda del mapa">
      {(['wall', 'door', 'window', 'cover'] as const).map((kind) => (
        <li key={kind}>
          <svg viewBox={`0 0 ${CELL} ${CELL}`} aria-hidden="true">
            <rect width={CELL} height={CELL} className="m-floor" />
            <TerrainTile x={0} y={0} kind={kind} />
          </svg>
          {TERRAIN_LABELS[kind]}
          <span className="muted">{TERRAIN_HINTS[kind]}</span>
        </li>
      ))}
    </ul>
  );
}

/** Qué hace cada cosa en el combate, según el reglamento. */
export const TERRAIN_HINTS: Record<Terrain, string> = {
  wall: 'no se cruza ni se ve a través',
  door: 'abierta: se cruza y se ve',
  window: 'no se cruza; se ve, a cubierto',
  cover: 'no se cruza; detrás, a cubierto',
};
