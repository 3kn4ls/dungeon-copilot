import type { Outcome } from './resolution';

/**
 * Qué significa cada resultado según la situación. Lo usan la interfaz para explicar la tirada
 * y la IA para proponer complicaciones coherentes con la escena.
 */
export type Situation = 'test' | 'melee' | 'ranged';

export const SITUATION_LABELS: Record<Situation, string> = {
  test: 'Prueba',
  melee: 'Cuerpo a cuerpo',
  ranged: 'A distancia',
};

export const OUTCOME_GUIDES: Record<Situation, Record<Outcome, string>> = {
  test: {
    critical: 'Lo consigues de forma brillante y además obtienes algo extra.',
    success: 'Lo consigues sin complicaciones.',
    partial:
      'Lo consigues, pero con un coste: tarde, con ruido, pagando algo o con una complicación nueva.',
    failure: 'No lo consigues y la situación empeora.',
    fumble: 'Fallas estrepitosamente y aparece un problema serio.',
  },
  melee: {
    critical: 'Impactas con +1 de daño y eliges un efecto: derribar, desarmar o empujar al rival.',
    success: 'Impactas.',
    partial:
      'Impactas, pero el máster elige un coste: recibes un golpe (daño del rival −1), quedas en mala posición (el rival tiene ventaja contra ti) o pierdes algo (arma, escudo, terreno).',
    failure: 'No impactas y la situación empeora: el máster puede dar ventaja al rival contra ti.',
    fumble: 'No impactas y quedas expuesto: el rival te golpea con su daño o pierdes el arma.',
  },
  ranged: {
    critical: 'Impactas con +1 de daño.',
    success: 'Impactas.',
    partial:
      'Impactas, pero con un coste: quedas al descubierto, gastas munición de más o haces 1 de daño menos.',
    failure: 'Fallas.',
    fumble:
      'Algo sale mal: se rompe la cuerda, se encasquilla el arma o casi alcanzas a un aliado.',
  },
};

/**
 * Resultados en los que el máster decide qué se complica: el precio de un éxito con coste o
 * lo que sale mal en un fallo o una pifia. En ellos, la IA le propone ideas.
 */
export const COMPLICATION_OUTCOMES = ['partial', 'failure', 'fumble'] as const satisfies Outcome[];

export type ComplicationOutcome = (typeof COMPLICATION_OUTCOMES)[number];

export const needsComplication = (outcome: Outcome): outcome is ComplicationOutcome =>
  (COMPLICATION_OUTCOMES as readonly Outcome[]).includes(outcome);
