import type { ScryptParams } from './auth/password';
import type { Database } from './db';

/** Lo que necesitan las rutas: la base de datos y los ajustes que les afectan. */
export interface AppContext {
  db: Database;
  cookieSecure: boolean | 'auto';
  allowRegistration: boolean;
  passwordParams: ScryptParams;
}
