import type { Random } from '@dungeon-copilot/rules';
import type { Decider } from './ai/decide';
import type { Ai } from './ai/ollama';
import type { ScryptParams } from './auth/password';
import type { Database } from './db';
import type { GameHub } from './games/hub';

/** Lo que necesitan las rutas: la base de datos, el directo de las partidas y los ajustes. */
export interface AppContext {
  db: Database;
  hub: GameHub;
  /** La IA de los PNJ; null si el servidor no tiene Ollama configurado. */
  ai: Ai | null;
  /** La IA que sugiere decisiones al máster (Nimble); null si no está configurada. */
  decider: Decider | null;
  /** Fuente de aleatoriedad de las tiradas. */
  random: Random;
  cookieSecure: boolean | 'auto';
  allowRegistration: boolean;
  passwordParams: ScryptParams;
}
