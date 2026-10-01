# Dungeon Copilot

Asistente web para másters de rol. Monorepo pnpm en TypeScript: `apps/web` (React + Vite), `apps/server` (Fastify), `packages/rules` (motor de reglas puro), `packages/shared` (esquemas Zod de la API).

## Convenciones

- Idioma: interfaz, documentación y comentarios en español. Identificadores de código en inglés (`strength`, `partial`), con las etiquetas en español en datos (`ATTRIBUTE_INFO`, `OUTCOME_LABELS`).
- `packages/rules` no depende de la interfaz ni del servidor. Toda aleatoriedad entra como parámetro `Random`; en tests se usa `fixedDice` de `@dungeon-copilot/rules/testing`.
- Las tiradas de partida se resuelven en el servidor, no en el navegador.
- Validación de entrada con Zod en `packages/shared`; el servidor responde 400 con `issues` legibles.
- Errores de la API: se lanza `HttpError` (`apps/server/src/http/errors.ts`) con un mensaje en español que la web enseña tal cual.
- Permisos: a quien no es miembro de una campaña se le responde 404, no 403. Las fichas las cambian su dueño y el máster; la experiencia solo la da el máster.
- Partidas: todo lo que pasa en una es un evento de `game_events` con visibilidad `public` (toda la mesa y la pantalla), `master` o `private` (el máster y el jugador de `player_id`: lo que se dicen en secreto). Los eventos se añaden con `addEvent` (`apps/server/src/games/events.ts`), que bloquea la partida y los reparte en vivo con `GameHub` (en memoria: una sola réplica), y el registro se lee con `findEvents` según quién mira. Quien deja de tener acceso (le echan, se borra la campaña, cambia el enlace de la pantalla) se desconecta con `hub.disconnect`. Los eventos no se cambian: una tirada repetida con Suerte es otro `roll` con `reroll.of`, y la original deja de contar (`supersededRolls`); una intervención o una tirada pedida dejan de esperar con otro evento que las cita (`answers`, `requested` o `settled`). Nada privado llega a la pantalla, al resumen ni a las escenas que lee la IA.

## La mesa

Cómo se juega una partida (fases, la palabra, las intervenciones de los jugadores, las tiradas pedidas y lo que viene, como el combate por rondas) está en `docs/mesa.md`: si cambias cómo se juega, cámbialo también. La palabra (`floor`) la da el máster. Intervienen los dueños de los personajes, con una intervención esperando por personaje como mucho, y el máster las atiende. Una tirada pedida se valida al pedirla (`planGameRoll`) y se resuelve con la ficha del momento en que se tira. Las rutas están en `apps/server/src/routes/table.ts`, y lo que sigue esperando se calcula en `apps/server/src/games/pending.ts` (en la web, con `settledEvents`, `pendingInterventions` y `pendingRollRequests`).

El combate por rondas también son eventos públicos: `combatStarted`, `turn`, `combatJoined`, `combatLeft` y `combatEnded`, y los que cambian quién pelea guardan el orden de iniciativa entero. El combate en juego (con el daño de los PNJ, `harm`) y quién tiene la palabra (en combate, quien tiene el turno) los calculan `currentCombat` y `currentFloor` (`packages/shared/src/combat.ts`), igual en la web que en el servidor. La iniciativa la tira el servidor con las reglas de `packages/rules` (`apps/server/src/games/combat.ts`), y las rutas están en `apps/server/src/routes/combat.ts`. Para pasar un turno se manda el que termina: si ya ha pasado, 409. Las tiradas de combate guardan quién ataca a quién (`blow`).

El daño también es un evento público, `damage`, que aplica el máster (`apps/server/src/routes/damage.ts`): a un personaje le cambia la ficha (con la fila bloqueada) y guarda cómo estaba y cómo queda; a PNJ del combate, cómo queda el grupo (uno a uno) y, si caen todos, el orden nuevo, como `combatLeft`. Un golpe mortal se salva con Suerte (`survived`), y una tirada con daño aplicado ya no se repite. Las escenas (`scene`) y las técnicas de una vez por escena o por sesión (`ability`, y Esquiva prodigiosa en `damage`) están en `apps/server/src/routes/scenes.ts`; la escena en juego y lo gastado lo calculan `currentScene` y `spentAbilities` (`packages/shared/src/scenes.ts`). El equipo de cada personaje (`gear`) está en su ficha y sale por defecto al preparar las tiradas y los golpes en la web; el servidor aplica la desventaja de la armadura pesada.

## Base de datos

PostgreSQL con Drizzle ORM. Sin `DATABASE_URL` se usa PGlite (PostgreSQL embebido), también en los tests. Si cambias `apps/server/src/db/schema.ts`, genera la migración con `pnpm --filter @dungeon-copilot/server db:generate --name que-cambia` y súbela junto al cambio; nunca edites una migración ya publicada. Los cambios de una ficha que dependen de su estado (daño, experiencia, mejoras, Suerte) van en una transacción con la fila bloqueada.

## IA (Ollama)

La IA es opcional. El servidor habla con Ollama a través de la interfaz `Ai` (`apps/server/src/ai/ollama.ts`), que las rutas reciben en `ctx.ai`: es `null` sin `OLLAMA_URL` u `OLLAMA_MODEL`, y entonces las rutas de IA responden 503 y la web sigue funcionando sin ella. Los prompts, en español y con topes de longitud, viven en `apps/server/src/ai/prompts.ts`. Los tests usan el Ollama de mentira de `apps/server/src/ai/fake-ollama.ts`, nunca uno de verdad.

Las sugerencias son de otra IA que no escribe sino que decide: Nimble, en el mismo Ollama con `OLLAMA_DECISION_MODEL`, por su propio endpoint (`/v1/systemone`, desde Ollama 0.35). Recibe un texto y unas preguntas (`choice`, `noul` o `score`) y de cada una devuelve las probabilidades. El servidor habla con ella a través de la interfaz `Decider` (`apps/server/src/ai/decide.ts`), que las rutas reciben en `ctx.decider`: es `null` sin `OLLAMA_DECISION_MODEL`, y entonces responden 503 (`requireDecider`). Puede ir sola, sin `OLLAMA_MODEL`. Las preguntas, en español y con topes de longitud, se montan en `apps/server/src/ai/decisions.ts` (puro, como `prompts.ts`), y las rutas están en `apps/server/src/routes/decisions.ts`. Cada pregunta va en su propia petición: juntas, Nimble ve las demás y se estorban. Los dos clientes comparten la conexión y los mensajes de error (`ai/connection.ts`), y los tests usan el mismo Ollama de mentira (`queueDecision`). Las decisiones no escriben nada en la partida: sugieren, y el máster decide. El guardián de secretos (`POST /api/games/:id/reveals/check`) es lo único que manda a Nimble lo que ocultan los PNJ, y responde quién, nunca el secreto. La web no espera por ellas: sin Nimble, o si tarda, funciona igual.

Los textos que la IA escribe en directo salen en NDJSON con `sendAiText` (`apps/server/src/ai/respond.ts`); lo que se enseña a medias (`visible`) solo puede crecer, porque se manda por trozos.

Los PNJ son solo del máster: a un jugador de la campaña se le responde 403. La charla con un PNJ no escribe nada en la partida; solo la frase que el máster enseña a la mesa queda como evento.

La ayuda para narrar (describir una escena a partir de unas notas, proponer complicaciones para una tirada, ideas para cuando la mesa se atasca y, en combate, cómo narrar un golpe y qué hacen los enemigos en su turno) es del máster, solo con la partida abierta, y tampoco escribe nada: lo que enseñe va como un `reveal` más. Las complicaciones son para los resultados de `needsComplication` (éxito con coste, fallo y pifia). Estos prompts y el del PNJ reciben las últimas escenas enseñadas (`findScenes`); el de las ideas, además, los PNJ de la campaña sin lo que ocultan (`findNpcLines`).

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
