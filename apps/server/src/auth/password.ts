import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** Parámetros de scrypt. Se guardan junto al hash para poder endurecerlos sin romper cuentas. */
export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** Una de las combinaciones que recomienda OWASP: 32 MiB de memoria por hash. */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 3 };

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function derive(password: string, salt: Buffer, { N, r, p }: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem con holgura: scrypt necesita unos 128 · N · r bytes.
    scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: 256 * N * r }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Devuelve "scrypt$N$r$p$sal$hash", con la sal y el hash en base64. */
export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, params);
  return [
    'scrypt',
    params.N,
    params.r,
    params.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, N, r, p, salt, hash] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const params = { N: Number(N), r: Number(r), p: Number(p) };
  if (![params.N, params.r, params.p].every(Number.isInteger)) return false;
  const actual = await derive(password, Buffer.from(salt, 'base64'), params);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
