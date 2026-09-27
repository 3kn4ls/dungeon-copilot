# Dungeon Copilot

Asistente web para másters de rol. Monorepo pnpm en TypeScript: `apps/web` (React + Vite), `apps/server` (Fastify), `packages/rules` (motor de reglas puro), `packages/shared` (esquemas Zod de la API).

## Convenciones

- Idioma: interfaz, documentación y comentarios en español. Identificadores de código en inglés (`strength`, `partial`), con las etiquetas en español en datos (`ATTRIBUTE_INFO`, `OUTCOME_LABELS`).
- `packages/rules` no depende de la interfaz ni del servidor. Toda aleatoriedad entra como parámetro `Random`; en tests se usa `fixedDice` de `@dungeon-copilot/rules/testing`.
- Las tiradas de partida se resuelven en el servidor, no en el navegador.
- Validación de entrada con Zod en `packages/shared`; el servidor responde 400 con `issues` legibles.

## Reglas del juego

El reglamento vive en `docs/reglas.md` y el código en `packages/rules`. Si cambias una regla, cambia los dos y regenera las tablas de probabilidades con `pnpm --filter @dungeon-copilot/rules tabla`.

## Antes de subir cambios

```sh
pnpm check   # formato, lint, tipos y tests
pnpm build
```
