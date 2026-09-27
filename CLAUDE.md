# Dungeon Copilot

Asistente web para másters de rol. Monorepo pnpm en TypeScript: `apps/web` (React + Vite), `apps/server` (Fastify), `packages/rules` (motor de reglas puro), `packages/shared` (esquemas Zod de la API).

## Convenciones

- Idioma: interfaz, documentación y comentarios en español. Identificadores de código en inglés (`strength`, `partial`), con las etiquetas en español en datos (`ATTRIBUTE_INFO`, `OUTCOME_LABELS`).
- `packages/rules` no depende de la interfaz ni del servidor. Toda aleatoriedad entra como parámetro `Random`; en tests se usa `fixedDice` de `@dungeon-copilot/rules/testing`.
- Las tiradas de partida se resuelven en el servidor, no en el navegador.
- Validación de entrada con Zod en `packages/shared`; el servidor responde 400 con `issues` legibles.
- Errores de la API: se lanza `HttpError` (`apps/server/src/http/errors.ts`) con un mensaje en español que la web enseña tal cual.
- Permisos: a quien no es miembro de una campaña se le responde 404, no 403. Las fichas las cambian su dueño y el máster; la experiencia solo la da el máster.
- Partidas: todo lo que pasa en una es un evento de `game_events` con visibilidad `public` (toda la mesa y la pantalla) o `master`. Los eventos se añaden con `addEvent` (`apps/server/src/routes/games.ts`), que bloquea la partida y los reparte en vivo con `GameHub` (en memoria: una sola réplica). Quien deja de tener acceso (le echan, se borra la campaña, cambia el enlace de la pantalla) se desconecta con `hub.disconnect`.

## Base de datos

PostgreSQL con Drizzle ORM. Sin `DATABASE_URL` se usa PGlite (PostgreSQL embebido), también en los tests. Si cambias `apps/server/src/db/schema.ts`, genera la migración con `pnpm --filter @dungeon-copilot/server db:generate --name que-cambia` y súbela junto al cambio; nunca edites una migración ya publicada. Los cambios de una ficha que dependen de su estado (daño, experiencia, mejoras) van en una transacción con la fila bloqueada.

## IA (Ollama)

La IA es opcional. El servidor habla con Ollama a través de la interfaz `Ai` (`apps/server/src/ai/ollama.ts`), que las rutas reciben en `ctx.ai`: es `null` sin `OLLAMA_URL`, y entonces las rutas de IA responden 503 y la web sigue funcionando sin ella. Los prompts, en español y con topes de longitud, viven en `apps/server/src/ai/prompts.ts`. Los tests usan el Ollama de mentira de `apps/server/src/ai/fake-ollama.ts`, nunca uno de verdad.

Los textos que la IA escribe en directo salen en NDJSON con `sendAiText` (`apps/server/src/ai/respond.ts`); lo que se enseña a medias (`visible`) solo puede crecer, porque se manda por trozos.

Los PNJ son solo del máster: a un jugador de la campaña se le responde 403. La charla con un PNJ no escribe nada en la partida; solo la frase que el máster enseña a la mesa queda como evento.

La ayuda para narrar (describir una escena a partir de unas notas, proponer complicaciones para una tirada e ideas para cuando la mesa se atasca) es del máster, solo con la partida abierta, y tampoco escribe nada: lo que enseñe va como un `reveal` más. Las complicaciones son para los resultados de `needsComplication` (éxito con coste, fallo y pifia). Estos prompts y el del PNJ reciben las últimas escenas enseñadas (`findScenes`); el de las ideas, además, los PNJ de la campaña sin lo que ocultan (`findNpcLines`).

El resumen de una partida terminada no es un evento: vive en `games.recap`, lo guarda el máster y es público. Los resúmenes son la memoria de la campaña: los prompts de los PNJ reciben los últimos (`findRecaps`). Al resumen solo llegan las notas del máster si él quiere, y nunca las tiradas secretas.

## Reglas del juego

El reglamento vive en `docs/reglas.md` y el código en `packages/rules`. Si cambias una regla, cambia los dos y regenera las tablas de probabilidades con `pnpm --filter @dungeon-copilot/rules tabla`.

## Despliegue

La imagen sale del `Dockerfile` de la raíz, la CI la prueba con `deploy/smoke-test.sh` y, al entrar en `main`, la publica en `ghcr.io/3kn4ls/dungeon-copilot` para amd64 y arm64. Los manifiestos de k3s (el servidor y su PostgreSQL) están en `deploy/k3s`, con lo que cambia de un cluster a otro en `kustomization.yaml`. Si cambias cómo arranca el servidor (variables, puerto, carpetas), revisa los tres. La imagen de arm64 se hace sin emular porque el servidor no tiene dependencias nativas: si añades una, el `Dockerfile` tiene que cambiar.

## Antes de subir cambios

```sh
pnpm check   # formato, lint, tipos y tests
pnpm build
```
