/** Código de PostgreSQL para una violación de restricción UNIQUE. */
const UNIQUE_VIOLATION = '23505';

/** Drizzle puede envolver el error del driver; se mira también en `cause`. */
export function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current instanceof Object; current = (current as Error).cause) {
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    if (!('cause' in current)) break;
  }
  return false;
}
