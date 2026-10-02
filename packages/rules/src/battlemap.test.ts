import { describe, expect, it } from 'vitest';
import {
  canStand,
  cellDistance,
  cellsBetween,
  inReach,
  lineOfSight,
  rangeAt,
  shotOnMap,
  type BattleGrid,
  type Cell,
  type Terrain,
} from './battlemap';
import { rangedDifficulty } from './combat';

/** Un mapa de 12 × 8 con lo que se le ponga. */
function grid(...terrain: (Cell & { kind: Terrain })[]): BattleGrid {
  return { cols: 12, rows: 8, terrain };
}

describe('cellDistance y rangeAt', () => {
  it('cuenta las casillas; las diagonales cuentan como una', () => {
    expect(cellDistance({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3);
    expect(cellDistance({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(2);
    expect(cellDistance({ x: 4, y: 4 }, { x: 4, y: 4 })).toBe(0);
  });

  it('corta hasta 6 casillas, media hasta 12 y larga más allá', () => {
    expect(rangeAt(1)).toBe('short');
    expect(rangeAt(6)).toBe('short');
    expect(rangeAt(7)).toBe('medium');
    expect(rangeAt(12)).toBe('medium');
    expect(rangeAt(13)).toBe('long');
  });

  it('cuerpo a cuerpo, en una casilla de al lado, también en diagonal', () => {
    expect(inReach({ x: 2, y: 2 }, { x: 3, y: 3 })).toBe(true);
    expect(inReach({ x: 2, y: 2 }, { x: 2, y: 3 })).toBe(true);
    expect(inReach({ x: 2, y: 2 }, { x: 4, y: 2 })).toBe(false);
    expect(inReach({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(false);
  });
});

describe('canStand', () => {
  const map = grid(
    { x: 1, y: 1, kind: 'wall' },
    { x: 2, y: 1, kind: 'door' },
    { x: 3, y: 1, kind: 'window' },
    { x: 4, y: 1, kind: 'cover' },
  );

  it('se puede estar en el suelo y en una puerta', () => {
    expect(canStand(map, { x: 0, y: 0 })).toBe(true);
    expect(canStand(map, { x: 2, y: 1 })).toBe(true);
  });

  it('no en un muro, una ventana, un mueble ni fuera del mapa', () => {
    expect(canStand(map, { x: 1, y: 1 })).toBe(false);
    expect(canStand(map, { x: 3, y: 1 })).toBe(false);
    expect(canStand(map, { x: 4, y: 1 })).toBe(false);
    expect(canStand(map, { x: 12, y: 0 })).toBe(false);
    expect(canStand(map, { x: -1, y: 0 })).toBe(false);
    expect(canStand(map, { x: 0.5, y: 0 })).toBe(false);
  });
});

describe('cellsBetween', () => {
  it('las casillas que cruza la línea, sin contar los extremos', () => {
    expect(cellsBetween({ x: 0, y: 0 }, { x: 3, y: 0 })).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
    expect(cellsBetween({ x: 0, y: 0 }, { x: 2, y: 1 })).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  it('por una esquina, las dos casillas que la tocan', () => {
    expect(cellsBetween({ x: 0, y: 0 }, { x: 2, y: 2 })).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 },
    ]);
  });
});

describe('lineOfSight', () => {
  const from = { x: 0, y: 3 };
  const to = { x: 8, y: 3 };

  it('en campo abierto se ve, sin cobertura', () => {
    expect(lineOfSight(grid(), from, to)).toEqual({ visible: true, cover: false });
  });

  it('un muro corta la línea; una puerta abierta, no', () => {
    expect(lineOfSight(grid({ x: 4, y: 3, kind: 'wall' }), from, to).visible).toBe(false);
    expect(lineOfSight(grid({ x: 4, y: 3, kind: 'door' }), from, to)).toEqual({
      visible: true,
      cover: false,
    });
  });

  it('un mueble o una ventana en medio dan cobertura parcial', () => {
    expect(lineOfSight(grid({ x: 6, y: 3, kind: 'cover' }), from, to)).toEqual({
      visible: true,
      cover: true,
    });
    expect(lineOfSight(grid({ x: 4, y: 3, kind: 'window' }), from, to)).toEqual({
      visible: true,
      cover: true,
    });
  });

  it('el mueble o la ventana al lado de quien dispara no le cubren a él', () => {
    expect(lineOfSight(grid({ x: 1, y: 3, kind: 'cover' }), from, to).cover).toBe(false);
    expect(lineOfSight(grid({ x: 1, y: 3, kind: 'window' }), from, to).cover).toBe(false);
  });

  it('entre dos muros en diagonal no se ve', () => {
    const corner = grid({ x: 1, y: 0, kind: 'wall' }, { x: 0, y: 1, kind: 'wall' });
    expect(lineOfSight(corner, { x: 0, y: 0 }, { x: 3, y: 3 }).visible).toBe(false);
  });
});

describe('shotOnMap', () => {
  it('da la distancia y la cobertura con las que se calcula la dificultad', () => {
    const map = grid({ x: 6, y: 3, kind: 'cover' });
    const shot = shotOnMap(map, { x: 0, y: 3 }, { x: 8, y: 3 });
    expect(shot).toEqual({ distance: 8, range: 'medium', visible: true, cover: 'partial' });
    // Un objetivo con Destreza 2 a 8 casillas, tras una mesa: 6 + 2 + 2 + 2.
    expect(rangedDifficulty({ targetDexterity: 2, range: shot.range, cover: shot.cover })).toBe(12);
  });
});
