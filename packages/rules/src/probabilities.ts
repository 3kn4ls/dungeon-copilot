import { keepDice, type Edge, type KeptDice } from './dice';
import { OUTCOMES, evaluateOpposed, evaluateTest, type Check, type Outcome } from './resolution';

export type OutcomeOdds = Record<Outcome, number>;

interface WeightedPair {
  kept: KeptDice;
  weight: number;
}

const distributions = new Map<Edge, readonly WeightedPair[]>();

/** Probabilidad exacta de cada pareja de dados que cuenta, según la ventaja. */
export function keptDistribution(edge: Edge): readonly WeightedPair[] {
  const cached = distributions.get(edge);
  if (cached) return cached;

  const count = edge === 'none' ? 2 : 3;
  const total = 6 ** count;
  const weights = new Map<string, WeightedPair>();
  for (let n = 0; n < total; n++) {
    const rolled = Array.from({ length: count }, (_, i) => (Math.floor(n / 6 ** i) % 6) + 1);
    const kept = keepDice(rolled, edge);
    const key = kept.join(',');
    const entry = weights.get(key) ?? { kept, weight: 0 };
    entry.weight += 1 / total;
    weights.set(key, entry);
  }
  const result = [...weights.values()];
  distributions.set(edge, result);
  return result;
}

function emptyOdds(): OutcomeOdds {
  return Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as OutcomeOdds;
}

/** Probabilidad exacta de cada resultado en una prueba contra dificultad. */
export function testOdds(check: Check, difficulty: number): OutcomeOdds {
  const odds = emptyOdds();
  for (const { kept, weight } of keptDistribution(check.edge ?? 'none')) {
    odds[evaluateTest(kept, check.bonus, difficulty)] += weight;
  }
  return odds;
}

/** Probabilidad exacta de cada resultado de una tirada enfrentada, desde quien actúa. */
export function opposedOdds(actor: Check, opponent: Check): OutcomeOdds {
  const odds = emptyOdds();
  for (const a of keptDistribution(actor.edge ?? 'none')) {
    for (const o of keptDistribution(opponent.edge ?? 'none')) {
      odds[evaluateOpposed(a.kept, actor.bonus, o.kept, opponent.bonus)] += a.weight * o.weight;
    }
  }
  return odds;
}

/** Probabilidad de éxito de cualquier tipo: con coste, pleno o crítico. */
export function successChance(odds: OutcomeOdds): number {
  return odds.partial + odds.success + odds.critical;
}

/** Probabilidad de éxito pleno o crítico. */
export function fullSuccessChance(odds: OutcomeOdds): number {
  return odds.success + odds.critical;
}
