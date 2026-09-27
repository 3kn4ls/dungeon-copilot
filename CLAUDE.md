# Dungeon Copilot

Asistente web para másters de rol. Monorepo pnpm en TypeScript: `apps/web` (React + Vite), `apps/server` (Fastify), `packages/rules` (motor de reglas puro), `packages/shared` (esquemas Zod de la API).

## Convenciones

- Idioma: interfaz, documentación y comentarios en español. Identificadores de código en inglés (`strength`, `partial`), con las etiquetas en español en datos (`ATTRIBUTE_INFO`, `OUTCOME_LABELS`).
- `packages/rules` no depende de la interfaz ni del servidor. Toda aleatoriedad entra como parámetro `Random`; en tests se usa `fixedDice` de `@dungeon-copilot/rules/testing`.
- Las tiradas de partida se resuelven en el servidor, no en el navegador.
- Validación de entrada con Zod en `packages/shared`; el servidor responde 400 con `issues` legibles.
- Errores de la API: se lanza `HttpError` (`apps/server/src/http/errors.ts`) con un mensaje en español que la web enseña tal cual.
- Permisos: a quien no es miembro de una campaña se le responde 404, no 403. Las fichas las cambian su dueño y el máster; la experiencia solo la da el máster.

## Base de datos

PostgreSQL con Drizzle ORM. Sin `DATABASE_URL` se usa PGlite (PostgreSQL embebido), también en los tests. Si cambias `apps/server/src/db/schema.ts`, genera la migración con `pnpm --filter @dungeon-copilot/server db:generate --name que-cambia` y súbela junto al cambio; nunca edites una migración ya publicada. Los cambios de una ficha que dependen de su estado (daño, experiencia, mejoras) van en una transacción con la fila bloqueada.

## Reglas del juego

El reglamento vive en `docs/reglas.md` y el código en `packages/rules`. Si cambias una regla, cambia los dos y regenera las tablas de probabilidades con `pnpm --filter @dungeon-copilot/rules tabla`.

## Antes de subir cambios

```sh
pnpm check   # formato, lint, tipos y tests
pnpm build
```
