# Dungeon Copilot

Asistente web para dirigir partidas de rol: preparación de campañas, ayuda en mesa con IA local (Ollama) y memoria de todo lo que pasa en la partida. El máster abre partidas a las que se unen los jugadores, en persona u online.

Ahora mismo tiene:

- Cuentas sencillas: usuario y contraseña, sin correo.
- Campañas: quien la crea es su máster y la comparte con un código de invitación de 6 letras.
- Fichas de personaje con el [sistema de reglas propio](docs/reglas.md): creación guiada, heridas, Suerte, experiencia y mejoras.
- Sala de partida: el máster abre una partida en la campaña y la mesa ve en vivo lo que enseña y las tiradas. Las tiradas de los personajes salen de su ficha (con la desventaja por heridas ya aplicada); el máster tira también por los PNJ, en abierto o en secreto, y guarda notas que solo ve él. Al abrir la partida todos recuperan la Suerte y al cerrarla ganan los PX de fin de sesión.
- Pantalla de la mesa: un enlace secreto por campaña para una tele o una tablet, sin iniciar sesión. Enseña lo último revelado y las últimas tiradas, y pasa sola a la partida siguiente.
- PNJ con IA: el máster guarda los PNJ de cada campaña con su aspecto, carácter, forma de hablar, lo que quieren y lo que ocultan. Ollama puede inventarlos o completar lo que falte, también en plena partida. En la sala, el máster cuenta lo que dicen o hacen los personajes, la IA responde como el PNJ y él decide qué frase enseña a la mesa, tal cual o retocada; también puede escribirla él.
- Resumen de cada partida: al terminarla, la IA propone uno con el registro y con lo que el máster le cuente de lo que se jugó de palabra. El máster lo retoca (o lo escribe él) y lo lee toda la mesa, en la partida y en la campaña. Al empezar la siguiente, un botón lo enseña a la mesa y a la pantalla, y los PNJ recuerdan los resúmenes de las últimas partidas.
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

| Variable             | Por defecto   | Qué hace                                                                                                                |
| -------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       |               | PostgreSQL, por ejemplo `postgres://dungeon:clave@postgres:5432/dungeon`. Sin ella se usa PGlite                        |
| `DATA_DIR`           | `data/pglite` | Carpeta de datos de PGlite, relativa a donde arranca el servidor                                                        |
| `PORT`               | `3000`        | Puerto del servidor                                                                                                     |
| `HOST`               | `0.0.0.0`     | Interfaz en la que escucha                                                                                              |
| `ALLOW_REGISTRATION` | `true`        | Con `false` nadie puede crear cuentas nuevas                                                                            |
| `COOKIE_SECURE`      | `auto`        | Con `auto`, la cookie de sesión es solo HTTPS cuando la petición llega por HTTPS (o con `X-Forwarded-Proto: https`)     |
| `WEB_DIST`           | `../web/dist` | Web compilada que sirve el servidor. Si no existe, solo sirve la API                                                    |
| `OLLAMA_URL`         |               | Dirección de Ollama, como `http://ollama:11434`, o `https://ollama.com` para sus modelos en la nube. Sin ella no hay IA |
| `OLLAMA_MODEL`       |               | Modelo que usará la IA, como `qwen2.5:7b`. Obligatorio si hay `OLLAMA_URL`                                              |
| `OLLAMA_API_KEY`     |               | Clave para los modelos en la nube de Ollama. Con un Ollama propio no hace falta                                         |

## IA

La IA es opcional: sin `OLLAMA_URL` todo funciona igual, pero el máster escribe él mismo lo que dicen los PNJ y los resúmenes. Con ella, el servidor habla con Ollama para tres cosas: inventar o completar la ficha de un PNJ, responder como el PNJ en la sala y proponer el resumen de una partida terminada, estas dos con el texto escrito poco a poco.

Vale cualquier Ollama al que llegue el servidor: el del cluster, otro servidor con GPU o los modelos en la nube de Ollama (`OLLAMA_URL=https://ollama.com` y la clave en `OLLAMA_API_KEY`). El modelo tiene que estar descargado (`ollama pull qwen2.5:7b`); si no, la web lo dice con el comando para descargarlo. Un modelo pequeño en una máquina lenta puede tardar: cada petición espera como mucho 3 minutos, y 5 el resumen de una partida, que tiene que leerla entera.

A Ollama le llega la ficha del PNJ, con lo que oculta, la descripción de la campaña, el nombre y trasfondo de los personajes, lo último que el máster ha enseñado a la mesa y los resúmenes de las tres últimas partidas. Para el resumen le llega además el registro de la partida, sin las tiradas secretas. Las notas del máster solo salen del servidor para escribir el resumen, y el máster puede dejarlas fuera. La charla con el PNJ no se guarda en la base de datos: vive en el navegador del máster hasta que la borra o cierra la pestaña, y a la partida solo pasa la frase que enseña a la mesa. Tampoco se guarda el resumen que propone la IA hasta que el máster lo acepta.

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

1. En `deploy/k3s/kustomization.yaml`, cambia `rol.example.com` por la dirección de la web y pon la de tu Ollama con su modelo. Si Ollama está en el cluster, su dirección es `http://<servicio>.<namespace>.svc.cluster.local:11434` (`kubectl get svc -A | grep -i ollama` te dice cuál). Sin IA, borra esas dos líneas.
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

| Ruta                                      | Qué hace                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `POST /auth/register`, `/auth/login`      | Crear cuenta o entrar                                                                |
| `POST /auth/logout`, `GET /auth/me`       | Salir y saber quién ha entrado                                                       |
| `GET, POST /campaigns`                    | Tus campañas y crear una nueva (quien la crea es su máster)                          |
| `POST /campaigns/join`                    | Unirse con el código de invitación                                                   |
| `GET, PATCH, DELETE /campaigns/:id`       | Ver, cambiar o borrar una campaña (cambiar y borrar: el máster)                      |
| `POST /campaigns/:id/invite-code`         | Cambiar el código de invitación (el máster)                                          |
| `POST /campaigns/:id/screen-token`        | Cambiar el enlace de la pantalla de la mesa (el máster)                              |
| `DELETE /campaigns/:id/members/:userId`   | Salir de la campaña, o echar a un jugador (el máster)                                |
| `GET, POST /campaigns/:id/characters`     | Personajes de la campaña y crear uno                                                 |
| `GET, PATCH, DELETE /characters/:id`      | Ver, cambiar nombre, trasfondo o Suerte, y borrar                                    |
| `POST /characters/:id/damage`, `/recover` | Recibir daño y recuperarse                                                           |
| `POST /characters/:id/xp`                 | Dar o quitar experiencia (el máster)                                                 |
| `POST /characters/:id/advances`           | Gastar experiencia en una mejora                                                     |
| `GET, POST /campaigns/:id/npcs`           | PNJ de la campaña y crear uno (el máster)                                            |
| `POST /campaigns/:id/npcs/generate`       | La IA inventa un PNJ o completa uno a medias, sin guardarlo (el máster)              |
| `GET, PATCH, DELETE /npcs/:id`            | Ver, cambiar y borrar un PNJ (el máster)                                             |
| `POST /npcs/:id/talk`                     | Lo que responde el PNJ, en NDJSON según lo escribe la IA. No guarda nada (el máster) |
| `GET, POST /campaigns/:id/games`          | Partidas de la campaña y abrir una (el máster)                                       |
| `GET /games/:id`                          | La partida y su registro, con lo que puede ver quien pregunta                        |
| `GET /games/:id/stream`                   | Directo de la partida (Server-Sent Events)                                           |
| `POST /games/:id/reveals`, `/notes`       | Enseñar algo a la mesa o anotar algo solo para ti (el máster)                        |
| `POST /games/:id/rolls`                   | Tirar en la partida con un personaje, o por un PNJ (el máster)                       |
| `POST /games/:id/speeches`                | Enseñar a la mesa lo que dice un PNJ (el máster)                                     |
| `POST /games/:id/close`                   | Terminar la partida (el máster)                                                      |
| `PUT /games/:id/recap`                    | Guardar el resumen de una partida terminada, que ve toda la mesa (el máster)         |
| `POST /games/:id/recap/draft`             | La IA propone el resumen, en NDJSON según lo escribe. No guarda nada (el máster)     |
| `GET /screens/:token`, `/stream`          | Pantalla de la mesa: lo público de la última partida, sin sesión                     |
| `POST /rolls`                             | Tirar dados. No necesita sesión                                                      |
| `GET /ai`                                 | Si la IA está configurada y con qué modelo                                           |

Quien no es miembro de una campaña recibe un 404, como si no existiera. Una ficha la cambian su jugador y el máster; el resto de la mesa solo la ve. Los PNJ son solo del máster: los jugadores los conocen por lo que dicen en la partida.

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
