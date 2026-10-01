# Dungeon Copilot

Asistente web para dirigir partidas de rol: preparación de campañas, ayuda en mesa con IA local (Ollama) y memoria de todo lo que pasa en la partida. El máster abre partidas a las que se unen los jugadores, en persona u online.

Ahora mismo tiene:

- Cuentas sencillas: usuario y contraseña, sin correo.
- Campañas: quien la crea es su máster y la comparte con un código de invitación de 6 letras.
- Fichas de personaje con el [sistema de reglas propio](docs/reglas.md): creación guiada, equipo (armas, armadura y escudo), heridas, Suerte, experiencia y mejoras.
- Sala de partida: el máster abre una partida en la campaña y la mesa ve en vivo lo que enseña y las tiradas. Las tiradas de los personajes salen de su ficha (con la desventaja por heridas ya aplicada); el máster tira también por los PNJ, en abierto o en secreto, y guarda notas que solo ve él. Al abrir la partida todos recuperan la Suerte y al cerrarla ganan los PX de fin de sesión.
- La palabra: el máster decide quién la tiene (él, que narra; toda la mesa, «¿qué hacéis?»; o un personaje) y la sala, el móvil de cada jugador y la pantalla lo enseñan. Cuando le toca a un jugador, su pestaña lo dice y su móvil vibra.
- Intervenciones: los jugadores piden la palabra con un botón (Hablar, Actuar, Preguntar o Atacar; en combate, los de su turno), escribiendo lo que dicen o hacen si quieren, y también en secreto, como una nota al máster. El máster las atiende desde una cola: da la palabra, pide una tirada, responde como un PNJ o con una descripción (en secreto, si hace falta), o dice «ahora no». Cómo se juega, en [docs/mesa.md](docs/mesa.md).
- Tiradas pedidas: el máster pide una tirada a un personaje (también una defensa contra un PNJ) y su jugador la hace con un botón, con su probabilidad a la vista y el bonificador de su ficha en ese momento.
- Combate por rondas: el máster empieza un combate con los personajes y los enemigos (PNJ de la campaña o grupos, diciendo cuántos son, con su perfil) y el servidor tira la iniciativa de todos. La palabra pasa sola de turno en turno. En el suyo, cada jugador ataca cuerpo a cuerpo o a distancia, lanza un hechizo o hace otra cosa, y termina su turno; el máster le pide la tirada ya preparada con el equipo de su ficha, con la dificultad de los disparos calculada. En el turno de los enemigos, el máster elige a quién atacan y ese jugador tira la defensa, parando o esquivando. Pueden unirse refuerzos o salir quien huye, y al terminar se recupera el aliento.
- El daño en la partida: cuando una tirada de combate impacta, el máster aplica el golpe con un clic, con el daño ya calculado (el arma y la armadura de las fichas, o el daño del perfil de los PNJ, el crítico y las técnicas) y retocable. Los personajes lo llevan en su ficha y, ante un golpe mortal, su jugador gasta Suerte para seguir con vida. Los enemigos caen uno a uno y, cuando caen todos, salen solos del combate. También se aplica daño a mano: una trampa, un hechizo, una caída.
- Escenas: el máster empieza una escena nueva, los personajes recuperan el aliento y vuelve lo que se usa una vez por escena. Las técnicas que se gastan (una vez por escena o por sesión) se usan con un botón y la mesa sabe cuáles quedan.
- Repetir con Suerte: bajo las últimas tiradas, quien juega con el personaje (o el máster, si se lo pide de palabra) gasta un punto de Suerte para repetir sus dados. Cuenta la segunda tirada, la ficha lo descuenta y la pantalla enseña solo la que cuenta. En una tirada enfrentada, cada personaje repite solo sus dados, una vez. Las tiradas secretas del máster no se repiten; las que son en secreto con un jugador, sí.
- Pantalla de la mesa: un enlace secreto por campaña para una tele o una tablet, sin iniciar sesión. Enseña la escena y lo último revelado en ella, lo que se dice, quién tiene la palabra (en combate, el orden de iniciativa, de quién es el turno, cuántos enemigos quedan en pie y el último golpe) y las últimas tiradas, y pasa sola a la partida siguiente. Nada de lo que es en secreto sale en ella.
- PNJ con IA: el máster guarda los PNJ de cada campaña con su aspecto, carácter, forma de hablar, lo que quieren y lo que ocultan. Ollama puede inventarlos o completar lo que falte, también en plena partida. En la sala, el máster cuenta lo que dicen o hacen los personajes, la IA responde como el PNJ y él decide qué frase enseña a la mesa, tal cual o retocada; también puede escribirla él.
- Resumen de cada partida: al terminarla, la IA propone uno con el registro y con lo que el máster le cuente de lo que se jugó de palabra. El máster lo retoca (o lo escribe él) y lo lee toda la mesa, en la partida y en la campaña. Al empezar la siguiente, un botón lo enseña a la mesa y a la pantalla, y los PNJ recuerdan los resúmenes de las últimas partidas.
- Ayuda para narrar: en la sala, el máster apunta unas notas (lo que la IA debe saber pero no contar, entre corchetes) y la IA las convierte en una descripción que él retoca, si quiere, antes de enseñarla a la mesa. Tras un éxito con coste, un fallo o una pifia, la IA propone tres complicaciones que encajan con la escena, y el máster enseña la que quiera, tal cual o retocada, o se la guarda para contarla de palabra.
- Ideas para cuando la mesa se atasca: la IA propone al máster tres cosas que pueden pasar ahora en la escena (alguien que aparece, un rumor o una pista, un giro) que encajan con lo que ha pasado en la campaña y con sus PNJ. Puede decirle qué busca, como «algo que les meta prisa», y de las ideas enseña la que quiera, tal cual o retocada, o pide a la IA que la convierta en una descripción.
- La IA en combate: tres maneras de narrar un golpe, con quién ataca a quién, sus armas y lo que ha causado, y tres ideas de qué pueden hacer los enemigos en su turno, sabiendo cómo va cada uno que pelea. El máster las cuenta o enseña la que quiera.
- Sugerencias de la IA (Nimble), que el máster aplica si quiere: qué tirada pedir para lo que ha escrito un jugador al intervenir (con qué habilidad, la dificultad, si alguien se opone, si encaja su trasfondo, si hace falta tirar y, en un disparo, la distancia y la cobertura), y en combate, a quién atacan los enemigos en su turno y si puede que huyan o se rindan, en su turno o tras caer uno del grupo. Y un guardián de secretos: antes de enseñar una descripción o lo que dice un PNJ, avisa si puede desvelar lo que oculta algún PNJ de la campaña.
- Un tirador de dados que resuelve las tiradas en el servidor. Desde la ficha se abre con el bonificador ya puesto.

## Requisitos

- Node 22.12 o superior
- pnpm 10 (con `corepack enable` se usa la versión fijada en `package.json`)

Para desarrollar no hace falta instalar PostgreSQL: sin `DATABASE_URL`, el servidor usa [PGlite](https://pglite.dev), un PostgreSQL embebido que guarda los datos en `apps/server/data/pglite`.

## Arrancar

```sh
pnpm install
pnpm dev
```

La web queda en http://localhost:5173 y la API en http://localhost:3000. La primera vez, crea una cuenta desde la pantalla de entrada.

En producción, `pnpm build` y después `pnpm --filter @dungeon-copilot/server start`: el servidor aplica las migraciones al arrancar y sirve también la web compilada, todo en un solo puerto. Para desplegarlo con Docker o en k3s, ver [Desplegar](#desplegar).

## Configuración

El servidor se configura con variables de entorno:

| Variable                | Por defecto   | Qué hace                                                                                                                |
| ----------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          |               | PostgreSQL, por ejemplo `postgres://dungeon:clave@postgres:5432/dungeon`. Sin ella se usa PGlite                        |
| `DATA_DIR`              | `data/pglite` | Carpeta de datos de PGlite, relativa a donde arranca el servidor                                                        |
| `PORT`                  | `3000`        | Puerto del servidor                                                                                                     |
| `HOST`                  | `0.0.0.0`     | Interfaz en la que escucha                                                                                              |
| `ALLOW_REGISTRATION`    | `true`        | Con `false` nadie puede crear cuentas nuevas                                                                            |
| `COOKIE_SECURE`         | `auto`        | Con `auto`, la cookie de sesión es solo HTTPS cuando la petición llega por HTTPS (o con `X-Forwarded-Proto: https`)     |
| `WEB_DIST`              | `../web/dist` | Web compilada que sirve el servidor. Si no existe, solo sirve la API                                                    |
| `OLLAMA_URL`            |               | Dirección de Ollama, como `http://ollama:11434`, o `https://ollama.com` para sus modelos en la nube. Sin ella no hay IA |
| `OLLAMA_MODEL`          |               | Modelo que escribe, como `qwen2.5:7b`. Con `OLLAMA_URL` hace falta este, `OLLAMA_DECISION_MODEL` o los dos              |
| `OLLAMA_DECISION_MODEL` |               | Modelo que sugiere decisiones al máster: `nimble`. Necesita Ollama 0.35 o posterior (ver [IA](#ia))                     |
| `OLLAMA_API_KEY`        |               | Clave para los modelos en la nube de Ollama. Con un Ollama propio no hace falta                                         |

## IA

La IA es opcional: sin `OLLAMA_URL` todo funciona igual, pero el máster escribe él mismo las descripciones, lo que dicen los PNJ y los resúmenes. Con ella, el servidor habla con Ollama para inventar o completar la ficha de un PNJ y, con el texto escrito poco a poco, para responder como el PNJ en la sala, describir una escena a partir de unas notas y proponer complicaciones cuando una tirada sale a medias o mal, ideas para seguir cuando la mesa se atasca, cómo narrar un golpe, qué hacen los enemigos en su turno y el resumen de una partida terminada.

Vale cualquier Ollama al que llegue el servidor: el del cluster, otro servidor con GPU o los modelos en la nube de Ollama (`OLLAMA_URL=https://ollama.com` y la clave en `OLLAMA_API_KEY`). El modelo tiene que estar descargado (`ollama pull qwen2.5:7b`); si no, la web lo dice con el comando para descargarlo. Un modelo pequeño en una máquina lenta puede tardar: cada petición espera como mucho 3 minutos, y 5 el resumen de una partida, que tiene que leerla entera.

A Ollama le llega la ficha del PNJ, con lo que oculta, la descripción de la campaña, el nombre y trasfondo de los personajes, lo último que el máster ha enseñado a la mesa y los resúmenes de las tres últimas partidas. Para describir una escena le llega además lo que el máster apunta para ella, también lo que va entre corchetes; para las complicaciones, la tirada, aunque sea secreta, y lo que intentaba quien tiró, si el máster lo cuenta o lo escribió su jugador al intervenir; para las ideas, el nombre de los PNJ de la campaña y quién es cada uno (no lo que ocultan) y lo que busca el máster, si lo dice; para narrar un golpe, la tirada, quién ataca a quién, el equipo de los personajes y el daño que ha causado; para lo que hacen los enemigos, cómo va cada uno que pelea (heridas y equipo de los personajes, cuántos enemigos quedan) y, de un PNJ de la campaña, su concepto, su carácter y lo que quiere, no lo que oculta; y para el resumen, el registro de la partida, con lo que escriben los jugadores al intervenir y quién pelea en cada combate, y sin nada secreto: ni las tiradas secretas del máster ni lo que se dice en secreto con un jugador. Lo que el máster anota solo para él sale del servidor únicamente para escribir el resumen, y puede dejarlo fuera. La charla con el PNJ no se guarda en la base de datos: vive en el navegador del máster hasta que la borra o cierra la pestaña, y a la partida solo pasa la frase que enseña a la mesa. Tampoco se guarda lo que la IA propone (descripciones, complicaciones, ideas o el resumen) hasta que el máster lo enseña o lo acepta. Lo que escribe un jugador al intervenir solo llega a la IA si el máster lo pasa a la charla con un PNJ, en las complicaciones de la tirada que pidió para atenderlo y en el resumen, si no era en secreto.

### Las sugerencias (Nimble)

Con `OLLAMA_DECISION_MODEL=nimble`, el servidor usa además [Nimble](https://ollama.com/library/nimble), un modelo que no escribe: decide. Recibe un texto y unas preguntas, y de cada una devuelve la respuesta con su probabilidad. Lo usa para sugerir al máster, que es quien decide; no escribe nada en la partida, y sin él la web funciona igual. Habla con Ollama por su propio endpoint, `/v1/systemone`, que tiene desde la 0.35: con uno anterior, la web lo dice.

- Se descarga con `ollama pull nimble` (9,5 GB). Puede ir solo, sin `OLLAMA_MODEL`, o junto al modelo que escribe en el mismo Ollama.
- Los dos a la vez ocupan unos 15 GB. Si no caben en la memoria de la GPU, Ollama reparte con la CPU y va más lento; si tampoco caben en la de la máquina, o `OLLAMA_MAX_LOADED_MODELS` es 1, los alterna, y cada cambio tarda lo que tarde en cargarse.
- A Nimble le llega, para sugerir una tirada, el nombre y el trasfondo del personaje, la escena en juego con lo último que el máster ha enseñado, lo que ha escrito el jugador al intervenir (aunque sea en secreto) y, en combate, contra quién va; para lo que hacen los enemigos, lo mismo que para las ideas de qué hacen en su turno (cómo va cada uno que pelea y lo que el máster sabe de un PNJ de la campaña, nunca lo que oculta) y los últimos golpes del combate; y para el guardián, lo que va a enseñar el máster (también si es en secreto) y lo que ocultan los PNJ de la campaña. Nada de eso se guarda ni se enseña: el guardián solo dice quién.
- Cada pregunta tarda poco con una GPU en la que quepa entero y alrededor de un segundo si no: en una de 8 GB, cerca de un minuto la primera vez, mientras se carga, y de 8 a 30 s en sugerir una tirada, según lo que más esté usando la GPU. Nada espera a Nimble: si tarda, la web sigue sin la sugerencia.

## Desplegar

Cada cambio que entra en `main` publica la imagen `ghcr.io/3kn4ls/dungeon-copilot`, para amd64 y arm64, con el servidor y la web. Lleva dos etiquetas: `latest`, que es lo último de `main`, y `sha-…`, una por commit.

El paquete es público: k3s descarga la imagen sin credenciales. Si en un fork sale privado, hazlo público desde la página del paquete (en el repositorio, a la derecha, en **Packages**): **Package settings** y después **Change visibility**.

### Con Docker

Para probarla en cualquier máquina, con los datos en PGlite dentro de un volumen:

```sh
docker run -d --name dungeon-copilot -p 3000:3000 -v dungeon-copilot:/data ghcr.io/3kn4ls/dungeon-copilot
```

Se configura con las variables de [Configuración](#configuración), pasadas con `-e`.

### En k3s

En `deploy/k3s` están los manifiestos: el servidor, detrás del Traefik de k3s, y un PostgreSQL con sus datos en un volumen.

1. En `deploy/k3s/kustomization.yaml`, cambia `rol.example.com` por la dirección de la web y pon la de tu Ollama con sus modelos. Si Ollama está en el cluster, su dirección es `http://<servicio>.<namespace>.svc.cluster.local:11434` (`kubectl get svc -A | grep -i ollama` te dice cuál). Sin IA, borra esas tres líneas; sin las sugerencias, la de `OLLAMA_DECISION_MODEL`.
2. Una sola vez, crea el namespace y la contraseña de la base de datos:

   ```sh
   kubectl create namespace dungeon-copilot
   kubectl -n dungeon-copilot create secret generic postgres --from-literal=password="$(openssl rand -hex 24)"
   ```

   PostgreSQL solo la usa al crear la base de datos: no la cambies después, o el servidor no podrá entrar.

3. Despliega, y repítelo cada vez que cambies algo en `deploy/k3s`:

   ```sh
   kubectl apply -k deploy/k3s
   ```

Para pasar a lo último de `main`: `kubectl -n dungeon-copilot rollout restart deployment dungeon-copilot`. Si prefieres quedarte en una versión, pon su etiqueta `sha-…` en `newTag`.

- **HTTPS**: Traefik sirve la web por HTTP y por HTTPS, este con un certificado de prueba. Para uno de verdad, añade al Ingress el TLS que use tu cluster (cert-manager o el ACME de Traefik). El servidor ya distingue las peticiones que le llegan por HTTPS.
- **Sin dominio**, para probar: `kubectl -n dungeon-copilot port-forward svc/dungeon-copilot 3000:80` y abre http://localhost:3000.
- **Clave de Ollama**, para sus modelos en la nube: va en un Secret aparte que el servidor lee si existe, `kubectl -n dungeon-copilot create secret generic dungeon-copilot --from-literal=OLLAMA_API_KEY=…`, y después el `rollout restart` de arriba.
- **Una sola réplica**: el directo de las partidas vive en la memoria del servidor.
- **Los datos**: `kubectl delete -k deploy/k3s` no los borra, porque el volumen de PostgreSQL se queda; se pierden si borras el namespace o el volumen `data-postgres-0`. Para sacar una copia: `kubectl -n dungeon-copilot exec postgres-0 -- pg_dump -U dungeon dungeon > copia.sql`.

## Base de datos

El esquema está en `apps/server/src/db/schema.ts` (Drizzle ORM) y las migraciones SQL en `apps/server/drizzle`. Si cambias el esquema, genera la migración:

```sh
pnpm --filter @dungeon-copilot/server db:generate --name que-cambia
```

Los tests de la API usan PGlite en memoria. Para repetirlos contra un PostgreSQL de verdad, como hace la CI:

```sh
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @dungeon-copilot/server test
```

Cada archivo de tests crea su propia base de datos en ese servidor y la borra al acabar.

## API

Todo bajo `/api`, en JSON. Los errores responden `{ error, issues? }` con mensajes en español. La sesión va en una cookie `httpOnly` que dura 30 días y se renueva sola con el uso.

| Ruta                                              | Qué hace                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `POST /auth/register`, `/auth/login`              | Crear cuenta o entrar                                                                               |
| `POST /auth/logout`, `GET /auth/me`               | Salir y saber quién ha entrado                                                                      |
| `GET, POST /campaigns`                            | Tus campañas y crear una nueva (quien la crea es su máster)                                         |
| `POST /campaigns/join`                            | Unirse con el código de invitación                                                                  |
| `GET, PATCH, DELETE /campaigns/:id`               | Ver, cambiar o borrar una campaña (cambiar y borrar: el máster)                                     |
| `POST /campaigns/:id/invite-code`                 | Cambiar el código de invitación (el máster)                                                         |
| `POST /campaigns/:id/screen-token`                | Cambiar el enlace de la pantalla de la mesa (el máster)                                             |
| `DELETE /campaigns/:id/members/:userId`           | Salir de la campaña, o echar a un jugador (el máster)                                               |
| `GET, POST /campaigns/:id/characters`             | Personajes de la campaña y crear uno                                                                |
| `GET, PATCH, DELETE /characters/:id`              | Ver, cambiar nombre, trasfondo, Suerte o equipo, y borrar                                           |
| `POST /characters/:id/damage`, `/recover`         | Recibir daño y recuperarse                                                                          |
| `POST /characters/:id/xp`                         | Dar o quitar experiencia (el máster)                                                                |
| `POST /characters/:id/advances`                   | Gastar experiencia en una mejora                                                                    |
| `GET, POST /campaigns/:id/npcs`                   | PNJ de la campaña y crear uno (el máster)                                                           |
| `POST /campaigns/:id/npcs/generate`               | La IA inventa un PNJ o completa uno a medias, sin guardarlo (el máster)                             |
| `GET, PATCH, DELETE /npcs/:id`                    | Ver, cambiar y borrar un PNJ (el máster)                                                            |
| `POST /npcs/:id/talk`                             | Lo que responde el PNJ, en NDJSON según lo escribe la IA. No guarda nada (el máster)                |
| `GET, POST /campaigns/:id/games`                  | Partidas de la campaña y abrir una (el máster)                                                      |
| `GET /games/:id`                                  | La partida y su registro, con lo que puede ver quien pregunta                                       |
| `GET /games/:id/stream`                           | Directo de la partida (Server-Sent Events)                                                          |
| `POST /games/:id/reveals`, `/notes`               | Enseñar algo a la mesa (o en secreto a un personaje) o anotar algo solo para ti (el máster)         |
| `POST /games/:id/reveals/draft`                   | La IA describe una escena a partir de unas notas, en NDJSON. No guarda nada (el máster)             |
| `POST /games/:id/rolls`                           | Tirar en la partida con un personaje, o por un PNJ (el máster)                                      |
| `POST /games/:id/rolls/:eventId/reroll`           | Gastar 1 de Suerte y repetir los dados de un personaje: cuenta la nueva (su jugador o el máster)    |
| `POST /games/:id/rolls/:eventId/complications`    | La IA propone complicaciones para una tirada a medias o mala, en NDJSON. No guarda nada (el máster) |
| `POST /games/:id/rolls/:eventId/narration`        | La IA propone cómo narrar el golpe de una tirada de combate, en NDJSON. No guarda nada (el máster)  |
| `POST /games/:id/ideas`                           | La IA propone qué puede pasar ahora en la escena, en NDJSON. No guarda nada (el máster)             |
| `POST /games/:id/speeches`                        | Enseñar lo que dice un PNJ, a la mesa o en secreto a un personaje (el máster)                       |
| `POST /games/:id/floor`                           | Dar la palabra: al máster, a toda la mesa o a un personaje (el máster)                              |
| `POST /games/:id/interventions`                   | Intervenir o pedir la palabra con tu personaje, también en secreto (su jugador)                     |
| `POST /games/:id/interventions/:eventId/answer`   | Dar una intervención por atendida o decir «ahora no» (el máster)                                    |
| `POST /games/:id/interventions/:eventId/withdraw` | Retirar tu intervención (su jugador)                                                                |
| `POST /games/:id/roll-requests`                   | Pedir una tirada a un personaje, también en secreto (el máster)                                     |
| `POST /games/:id/roll-requests/:eventId/roll`     | Hacer la tirada pedida, con la ficha de ahora (su jugador o el máster)                              |
| `POST /games/:id/roll-requests/:eventId/withdraw` | Retirar una tirada pedida (el máster)                                                               |
| `POST /games/:id/combat`                          | Empezar un combate con quien pelea: el servidor tira la iniciativa de todos (el máster)             |
| `POST /games/:id/combat/turn`                     | Terminar el turno de quien lo tiene: le toca al siguiente (el máster o quien juega con él)          |
| `POST /games/:id/combat/join`, `/leave`           | Meter en el combate a quien llega, con su iniciativa, o sacar a quien cae o huye (el máster)        |
| `POST /games/:id/combat/end`                      | Terminar el combate y, si se quiere, recuperar el aliento (el máster)                               |
| `POST /games/:id/combat/tactics`                  | La IA propone qué hacen unos PNJ en su turno, en NDJSON. No guarda nada (el máster)                 |
| `POST /games/:id/damage`                          | Aplicar un golpe a un personaje (en su ficha) o a PNJ del combate (el máster)                       |
| `POST /games/:id/damage/:eventId/survive`         | Gastar 1 de Suerte para no morir de un golpe mortal (su jugador o el máster)                        |
| `POST /games/:id/scenes`                          | Empezar una escena y, si se quiere, recuperar el aliento (el máster)                                |
| `POST /games/:id/abilities`                       | Usar una técnica de una vez por escena o por sesión (su jugador o el máster)                        |
| `POST /games/:id/close`                           | Terminar la partida (el máster)                                                                     |
| `PUT /games/:id/recap`                            | Guardar el resumen de una partida terminada, que ve toda la mesa (el máster)                        |
| `POST /games/:id/recap/draft`                     | La IA propone el resumen, en NDJSON según lo escribe. No guarda nada (el máster)                    |
| `GET /screens/:token`, `/stream`                  | Pantalla de la mesa: lo público de la última partida, sin sesión                                    |
| `POST /rolls`                                     | Tirar dados. No necesita sesión                                                                     |
| `GET /ai`                                         | Si la IA está configurada y con qué modelo                                                          |

Quien no es miembro de una campaña recibe un 404, como si no existiera. Lo que es en secreto lo ven solo el máster y el jugador al que va; para los demás tampoco existe. Una ficha la cambian su jugador y el máster; el resto de la mesa solo la ve. Los PNJ son solo del máster: los jugadores los conocen por lo que dicen en la partida.

El directo usa Server-Sent Events: al reconectar, el navegador manda el último evento que recibió y el servidor le envía lo que se perdió. Si el servidor va detrás de un proxy, este no debe acumular las respuestas de `text/event-stream` (Traefik, el de k3s, no lo hace). El reparto en vivo vive en la memoria del proceso, así que el servidor debe correr con una sola réplica.

## Comandos

| Comando          | Qué hace                                           |
| ---------------- | -------------------------------------------------- |
| `pnpm dev`       | Arranca web y servidor en modo desarrollo          |
| `pnpm test`      | Ejecuta los tests de todos los paquetes            |
| `pnpm typecheck` | Comprueba los tipos                                |
| `pnpm lint`      | Pasa ESLint                                        |
| `pnpm format`    | Formatea con Prettier                              |
| `pnpm check`     | Comprueba formato, lint, tipos y tests, como la CI |
| `pnpm build`     | Compila el servidor y la web para producción       |

## Estructura

| Carpeta           | Contenido                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `apps/web`        | Interfaz en React + Vite                                                                                      |
| `apps/server`     | API en Fastify con PostgreSQL (Drizzle). Resuelve las tiradas para que todos vean la misma y habla con Ollama |
| `packages/rules`  | Motor de reglas: tiradas, habilidades, combate, heridas, PNJ y avance. Sin dependencias de interfaz           |
| `packages/shared` | Contratos entre web y servidor (esquemas Zod de la API)                                                       |
| `docs`            | Reglamento y documentación del proyecto                                                                       |
| `deploy`          | Manifiestos para k3s y la prueba de la imagen de Docker, cuyo `Dockerfile` está en la raíz                    |

Los paquetes internos exportan TypeScript sin compilar: Vite los compila para la web y tsup los empaqueta dentro del servidor.
