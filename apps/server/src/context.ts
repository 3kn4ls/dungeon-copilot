import type { Random } from '@dungeon-copilot/rules';
import type { ScryptParams } from './auth/password';
import type { Database } from './db';
import type { GameHub } from './games/hub';

/** Lo que necesitan las rutas: la base de datos, el directo de las partidas y los ajustes. */
export interface AppContext {
  db: Database;
  hub: GameHub;
  /** Fuente de aleatoriedad de las tiradas. */
  random: Random;
  cookieSecure: boolean | 'auto';
  allowRegistration: boolean;
  passwordParams: ScryptParams;
}
