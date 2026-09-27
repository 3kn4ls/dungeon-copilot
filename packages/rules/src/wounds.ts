/**
 * Heridas sin puntos de vida. Primero se llenan los rasguños (tantos como Aguante);
 * cada punto de daño que no cabe empeora la herida un nivel: herido, grave, fuera de combate.
 */
export const SEVERITIES = ['none', 'wounded', 'grave', 'down'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = {
  none: 'Sin heridas',
  wounded: 'Herido',
  grave: 'Grave',
  down: 'Fuera de combate',
};

export interface WoundState {
  /** Rasguños marcados. */
  scratches: number;
  severity: Severity;
}

export const UNHURT: WoundState = { scratches: 0, severity: 'none' };

export interface DamageResult {
  state: WoundState;
  /**
   * El daño llega a alguien que ya estaba fuera de combate o lo sobrepasa: el personaje muere
   * salvo que el jugador gaste un punto de Suerte.
   */
  lethal: boolean;
}

export function applyDamage(state: WoundState, amount: number, scratchBoxes: number): DamageResult {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error(`El daño debe ser un entero no negativo, llegó ${amount}`);
  }
  const absorbed = Math.min(Math.max(0, scratchBoxes - state.scratches), amount);
  const overflow = amount - absorbed;
  const levels = SEVERITIES.indexOf(state.severity) + overflow;
  const lastLevel = SEVERITIES.length - 1;
  return {
    state: {
      scratches: state.scratches + absorbed,
      severity: SEVERITIES[Math.min(levels, lastLevel)]!,
    },
    lethal: levels > lastLevel,
  };
}

/** Tras recuperar el aliento al final de una escena, se borran todos los rasguños. */
export function recoverScratches(state: WoundState): WoundState {
  return { ...state, scratches: 0 };
}

/** Descanso o cuidados: la herida mejora un nivel. */
export function recoverSeverity(state: WoundState): WoundState {
  const index = SEVERITIES.indexOf(state.severity);
  return { ...state, severity: SEVERITIES[Math.max(0, index - 1)]! };
}

/** Una herida grave da desventaja en tiradas de Fuerza, Destreza y Aguante. */
export function hasPhysicalDisadvantage(state: WoundState): boolean {
  return state.severity === 'grave' || state.severity === 'down';
}

export function isDown(state: WoundState): boolean {
  return state.severity === 'down';
}
