/**
 * Fuente de aleatoriedad: devuelve un número en [0, 1).
 * Se inyecta en todas las tiradas para poder reproducirlas en tests o repeticiones.
 */
export type Random = () => number;

/** Ventaja: se tiran 3d6 y cuentan los dos mejores. Desventaja: los dos peores. */
export type Edge = 'none' | 'advantage' | 'disadvantage';

export const EDGE_LABELS: Record<Edge, string> = {
  none: 'Normal',
  advantage: 'Ventaja',
  disadvantage: 'Desventaja',
};

export type KeptDice = readonly [number, number];

export interface DiceRoll {
  /** Todos los dados lanzados, en el orden en que salieron (2 o 3). */
  rolled: number[];
  /** Los dos dados que cuentan, de menor a mayor. */
  kept: KeptDice;
  edge: Edge;
}

export function rollDie(random: Random = Math.random): number {
  return Math.floor(random() * 6) + 1;
}

/** Elige los dos dados que cuentan según la ventaja o desventaja. */
export function keepDice(rolled: readonly number[], edge: Edge): KeptDice {
  const expected = edge === 'none' ? 2 : 3;
  if (rolled.length !== expected) {
    throw new Error(
      `Se esperaban ${expected} dados para una tirada "${edge}", llegaron ${rolled.length}`,
    );
  }
  const sorted = [...rolled].sort((a, b) => a - b);
  const [low, mid, high] = sorted as [number, number, number];
  if (edge === 'none') return [low, mid];
  return edge === 'advantage' ? [mid, high] : [low, mid];
}

/** Tira 2d6, o 3d6 quedándose con dos si hay ventaja o desventaja. */
export function roll2d6(edge: Edge = 'none', random: Random = Math.random): DiceRoll {
  const count = edge === 'none' ? 2 : 3;
  const rolled = Array.from({ length: count }, () => rollDie(random));
  return { rolled, kept: keepDice(rolled, edge), edge };
}

export function sumDice(kept: KeptDice): number {
  return kept[0] + kept[1];
}

/**
 * Combina las fuentes de ventaja y desventaja de una tirada.
 * No se acumulan: varias ventajas siguen siendo una ventaja, y una ventaja y una desventaja se anulan.
 */
export function combineEdges(...sources: readonly Edge[]): Edge {
  const hasAdvantage = sources.includes('advantage');
  const hasDisadvantage = sources.includes('disadvantage');
  if (hasAdvantage === hasDisadvantage) return 'none';
  return hasAdvantage ? 'advantage' : 'disadvantage';
}

/**
 * Generador pseudoaleatorio con semilla (mulberry32).
 * Sirve para tiradas reproducibles: misma semilla, mismos dados.
 */
export function createSeededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
