import { roll2d6, sumDice, type DiceRoll, type Edge, type KeptDice, type Random } from './dice';

/** Resultados posibles de una tirada, de peor a mejor. */
export const OUTCOMES = ['fumble', 'failure', 'partial', 'success', 'critical'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  fumble: 'Pifia',
  failure: 'Fallo',
  partial: 'Éxito con coste',
  success: 'Éxito pleno',
  critical: 'Crítico',
};

/** Dificultades fijas para pruebas sin oposición activa. */
export const DIFFICULTIES = {
  easy: 8,
  normal: 10,
  hard: 12,
  veryHard: 14,
  heroic: 16,
} as const;
export type DifficultyLevel = keyof typeof DIFFICULTIES;

export const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  easy: 'Fácil',
  normal: 'Normal',
  hard: 'Difícil',
  veryHard: 'Muy difícil',
  heroic: 'Heroica',
};

/** Margen a partir del cual un éxito es pleno. Con margen 0, 1 o 2 el éxito tiene coste. */
export const FULL_SUCCESS_MARGIN = 3;

export function isSuccess(outcome: Outcome): boolean {
  return outcome === 'partial' || outcome === 'success' || outcome === 'critical';
}

/** Resultado según el margen (total − objetivo), antes de aplicar dobles. */
export function outcomeFromMargin(margin: number): Outcome {
  if (margin >= FULL_SUCCESS_MARGIN) return 'success';
  if (margin >= 0) return 'partial';
  return 'failure';
}

/** Un doble 6 sube un escalón el resultado y un doble 1 lo baja. */
export function doublesShift(kept: KeptDice): -1 | 0 | 1 {
  if (kept[0] === 6 && kept[1] === 6) return 1;
  if (kept[0] === 1 && kept[1] === 1) return -1;
  return 0;
}

export function shiftOutcome(outcome: Outcome, steps: number): Outcome {
  const index = OUTCOMES.indexOf(outcome) + steps;
  return OUTCOMES[Math.min(OUTCOMES.length - 1, Math.max(0, index))]!;
}

export interface Check {
  /** Atributo + habilidad + modificadores de la situación. */
  bonus: number;
  edge?: Edge;
}

export interface RollerResult {
  dice: DiceRoll;
  bonus: number;
  total: number;
}

export interface TestResult {
  roller: RollerResult;
  difficulty: number;
  margin: number;
  /** Resultado por margen, sin contar dobles. */
  baseOutcome: Outcome;
  outcome: Outcome;
  success: boolean;
}

export interface OpposedResult {
  /** Quien actúa: los empates le favorecen. */
  actor: RollerResult;
  /** Quien se opone; el máster tira por los PNJ. */
  opponent: RollerResult;
  margin: number;
  baseOutcome: Outcome;
  /** Resultado desde el punto de vista de quien actúa. */
  outcome: Outcome;
  success: boolean;
}

/** Evalúa una prueba contra dificultad a partir de dados ya tirados. */
export function evaluateTest(kept: KeptDice, bonus: number, difficulty: number): Outcome {
  const margin = sumDice(kept) + bonus - difficulty;
  return shiftOutcome(outcomeFromMargin(margin), doublesShift(kept));
}

/**
 * Evalúa una tirada enfrentada a partir de dados ya tirados.
 * Los dobles de quien se opone cuentan al revés: su doble 6 baja el resultado de quien actúa.
 */
export function evaluateOpposed(
  actorKept: KeptDice,
  actorBonus: number,
  opponentKept: KeptDice,
  opponentBonus: number,
): Outcome {
  const margin = sumDice(actorKept) + actorBonus - (sumDice(opponentKept) + opponentBonus);
  const steps = doublesShift(actorKept) - doublesShift(opponentKept);
  return shiftOutcome(outcomeFromMargin(margin), steps);
}

function rollFor(check: Check, random: Random): RollerResult {
  const dice = roll2d6(check.edge ?? 'none', random);
  return { dice, bonus: check.bonus, total: sumDice(dice.kept) + check.bonus };
}

/** Los mismos dados otra vez, con el mismo bonificador y la misma ventaja o desventaja. */
function rollAgain(roller: RollerResult, random: Random): RollerResult {
  return rollFor({ bonus: roller.bonus, edge: roller.dice.edge }, random);
}

function testResult(roller: RollerResult, difficulty: number): TestResult {
  const margin = roller.total - difficulty;
  const baseOutcome = outcomeFromMargin(margin);
  const outcome = evaluateTest(roller.dice.kept, roller.bonus, difficulty);
  return { roller, difficulty, margin, baseOutcome, outcome, success: isSuccess(outcome) };
}

function opposedResult(actor: RollerResult, opponent: RollerResult): OpposedResult {
  const margin = actor.total - opponent.total;
  const baseOutcome = outcomeFromMargin(margin);
  const outcome = evaluateOpposed(actor.dice.kept, actor.bonus, opponent.dice.kept, opponent.bonus);
  return { actor, opponent, margin, baseOutcome, outcome, success: isSuccess(outcome) };
}

/** Prueba contra una dificultad fija: una cerradura, un muro, una flecha a distancia. */
export function resolveTest(
  check: Check,
  difficulty: number,
  random: Random = Math.random,
): TestResult {
  return testResult(rollFor(check, random), difficulty);
}

/** Tirada enfrentada: los dos bandos tiran y el total del rival es el objetivo. */
export function resolveOpposed(
  actor: Check,
  opponent: Check,
  random: Random = Math.random,
): OpposedResult {
  const actorRoll = rollFor(actor, random);
  return opposedResult(actorRoll, rollFor(opponent, random));
}

/** Los dos bandos de una tirada enfrentada. */
export type OpposedSide = 'actor' | 'opponent';

/**
 * Repite una prueba gastando Suerte: dados nuevos con el mismo bonificador, la misma ventaja
 * y la misma dificultad. Cuenta el segundo resultado.
 */
export function rerollTest(result: TestResult, random: Random = Math.random): TestResult {
  return testResult(rollAgain(result.roller, random), result.difficulty);
}

/**
 * Repite con Suerte los dados de un bando de una tirada enfrentada: el otro se queda con los
 * suyos. Cuenta el segundo resultado.
 */
export function rerollOpposed(
  result: OpposedResult,
  side: OpposedSide,
  random: Random = Math.random,
): OpposedResult {
  return side === 'actor'
    ? opposedResult(rollAgain(result.actor, random), result.opponent)
    : opposedResult(result.actor, rollAgain(result.opponent, random));
}
