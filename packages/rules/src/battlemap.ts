import type { Cover, Range } from './combat';

/**
 * El mapa de combate: un plano en casillas de 1,5 m. De él salen la distancia, si se puede
 * atacar cuerpo a cuerpo, la línea de visión y la cobertura (ver «En un mapa» en
 * docs/reglas.md).
 */

/** Una casilla del mapa, por su columna (x) y su fila (y), desde 0. */
export interface Cell {
  x: number;
  y: number;
}

/** Cada casilla mide 1,5 m de lado. */
export const CELL_METERS = 1.5;

/**
 * Lo que puede haber en una casilla, además de suelo: un muro (no se cruza ni se ve a través),
 * una puerta (abierta: se cruza y se ve), una ventana (se ve, pero no se cruza y cubre) o un
 * mueble (no se cruza y cubre).
 */
export const TERRAIN_KINDS = ['wall', 'door', 'window', 'cover'] as const;
export type Terrain = (typeof TERRAIN_KINDS)[number];

export const TERRAIN_LABELS: Record<Terrain, string> = {
  wall: 'Muro',
  door: 'Puerta',
  window: 'Ventana',
  cover: 'Mueble',
};

/** Un mapa en casillas: su tamaño y lo que hay en las casillas que no son suelo. */
export interface BattleGrid {
  cols: number;
  rows: number;
  terrain: readonly (Cell & { kind: Terrain })[];
}

/** Hasta dónde llega cada distancia, en casillas: corta, 6 (9 m); media, 12 (18 m). */
export const RANGE_CELLS = { short: 6, medium: 12 } as const;

/** Casillas hasta otra: las diagonales cuentan como una, como al contar en la mesa. */
export function cellDistance(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** La distancia del reglamento a tantas casillas: corta, media o larga. */
export function rangeAt(distance: number): Range {
  if (distance <= RANGE_CELLS.short) return 'short';
  if (distance <= RANGE_CELLS.medium) return 'medium';
  return 'long';
}

/** Cuerpo a cuerpo: en una casilla de al lado, también en diagonal. */
export const inReach = (a: Cell, b: Cell) => cellDistance(a, b) === 1;

export const insideGrid = (grid: Pick<BattleGrid, 'cols' | 'rows'>, cell: Cell) =>
  Number.isInteger(cell.x) &&
  Number.isInteger(cell.y) &&
  cell.x >= 0 &&
  cell.y >= 0 &&
  cell.x < grid.cols &&
  cell.y < grid.rows;

const cellKey = (cell: Cell) => `${cell.x},${cell.y}`;

/** Lo que hay en cada casilla, para consultarlo sin recorrer la lista. */
export function terrainMap(grid: BattleGrid): ReadonlyMap<string, Terrain> {
  return new Map(grid.terrain.map((tile) => [cellKey(tile), tile.kind]));
}

export const terrainAt = (terrain: ReadonlyMap<string, Terrain>, cell: Cell) =>
  terrain.get(cellKey(cell));

/** Si alguien puede estar en la casilla: dentro del mapa y sin muro, ventana ni mueble. */
export function canStand(grid: BattleGrid, cell: Cell): boolean {
  if (!insideGrid(grid, cell)) return false;
  const kind = terrainAt(terrainMap(grid), cell);
  return kind === undefined || kind === 'door';
}

/**
 * Las casillas que cruza la línea del centro de `from` al de `to`, sin contar esas dos. Si pasa
 * justo por una esquina, cuentan las dos casillas que la tocan: entre dos muros en diagonal no se
 * ve.
 */
export function cellsBetween(from: Cell, to: Cell): Cell[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  // Cuánto avanza la línea (de 0 a 1) para cruzar una casilla, y cuánto le falta para el borde.
  const deltaX = dx === 0 ? Infinity : 1 / Math.abs(dx);
  const deltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let nextX = deltaX / 2;
  let nextY = deltaY / 2;
  let { x, y } = from;
  const cells: Cell[] = [];
  const EPSILON = 1e-9;
  while (x !== to.x || y !== to.y) {
    if (nextX < nextY - EPSILON) {
      x += stepX;
      nextX += deltaX;
    } else if (nextY < nextX - EPSILON) {
      y += stepY;
      nextY += deltaY;
    } else {
      cells.push({ x: x + stepX, y }, { x, y: y + stepY });
      x += stepX;
      y += stepY;
      nextX += deltaX;
      nextY += deltaY;
    }
    if (x !== to.x || y !== to.y) cells.push({ x, y });
  }
  return cells;
}

export interface Sight {
  /** Si se ve: ningún muro corta la línea. */
  visible: boolean;
  /** Cobertura parcial: la línea pasa por un mueble o una ventana que no está al lado de `from`. */
  cover: boolean;
}

/**
 * La línea de visión de `from` a `to`, de centro a centro. Un muro la corta; una puerta, no. Un
 * mueble o una ventana en medio dan cobertura parcial, salvo que estén al lado de quien mira:
 * se dispara por encima de la mesa propia o desde la ventana. Los demás que pelean no cubren.
 */
export function lineOfSight(grid: BattleGrid, from: Cell, to: Cell): Sight {
  const terrain = terrainMap(grid);
  let cover = false;
  for (const cell of cellsBetween(from, to)) {
    const kind = terrainAt(terrain, cell);
    if (kind === 'wall') return { visible: false, cover: false };
    if ((kind === 'cover' || kind === 'window') && cellDistance(cell, from) > 1) cover = true;
  }
  return { visible: true, cover };
}

/** Un disparo en el mapa: a cuántas casillas, a qué distancia del reglamento, si se ve y si cubre. */
export interface MapShot {
  distance: number;
  range: Range;
  visible: boolean;
  cover: Cover;
}

export function shotOnMap(grid: BattleGrid, from: Cell, to: Cell): MapShot {
  const distance = cellDistance(from, to);
  const sight = lineOfSight(grid, from, to);
  return {
    distance,
    range: rangeAt(distance),
    visible: sight.visible,
    cover: sight.cover ? 'partial' : 'none',
  };
}
