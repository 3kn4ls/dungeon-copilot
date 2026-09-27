import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  /** PostgreSQL. Si no se indica, se usa PGlite (PostgreSQL embebido) guardado en dataDir. */
  databaseUrl?: string;
  dataDir: string;
  /**
   * Cookies solo por HTTPS. "auto" las marca como seguras cuando la petición llega por HTTPS,
   * directamente o a través de un proxy que lo indique con X-Forwarded-Proto.
   */
  cookieSecure: boolean | 'auto';
  /** Si es false, nadie puede crear cuentas nuevas. */
  allowRegistration: boolean;
  /** Carpeta con la web compilada. Si no existe, el servidor solo sirve la API. */
  webDist?: string;
}

type Env = Record<string, string | undefined>;

function parseBoolean<T>(name: string, value: string | undefined, fallback: T): boolean | T {
  if (value === undefined || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'si', 'sí'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  throw new Error(`${name} debe ser true o false, llegó "${value}"`);
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT debe ser un puerto válido, llegó "${value}"`);
  }
  return port;
}

/** Lee la configuración de las variables de entorno. Las rutas relativas parten de cwd. */
export function loadConfig(env: Env = process.env, cwd: string = process.cwd()): Config {
  const webDist = resolve(cwd, env.WEB_DIST ?? '../web/dist');
  const databaseUrl = env.DATABASE_URL?.trim();
  return {
    port: parsePort(env.PORT),
    host: env.HOST?.trim() || '0.0.0.0',
    ...(databaseUrl ? { databaseUrl } : {}),
    dataDir: resolve(cwd, env.DATA_DIR ?? 'data/pglite'),
    cookieSecure:
      env.COOKIE_SECURE?.trim().toLowerCase() === 'auto'
        ? 'auto'
        : parseBoolean('COOKIE_SECURE', env.COOKIE_SECURE, 'auto'),
    allowRegistration: parseBoolean('ALLOW_REGISTRATION', env.ALLOW_REGISTRATION, true),
    ...(existsSync(resolve(webDist, 'index.html')) ? { webDist } : {}),
  };
}
