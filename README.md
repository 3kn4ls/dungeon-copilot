# Dungeon Copilot

Asistente web para dirigir partidas de rol: preparación de campañas, ayuda en mesa con IA local (Ollama) y memoria de todo lo que pasa en la partida. El máster abre partidas a las que se unen los jugadores, en persona u online.

Ahora mismo tiene:

- Cuentas sencillas: usuario y contraseña, sin correo.
- Campañas: quien la crea es su máster y la comparte con un código de invitación de 6 letras.
- Fichas de personaje con el [sistema de reglas propio](docs/reglas.md): creación guiada, heridas, Suerte, experiencia y mejoras.
- Sala de partida: el máster abre una partida en la campaña y la mesa ve en vivo lo que enseña y las tiradas. Las tiradas de los personajes salen de su ficha (con la desventaja por heridas ya aplicada); el máster tira también por los PNJ, en abierto o en secreto, y guarda notas que solo ve él. Al abrir la partida todos recuperan la Suerte y al cerrarla ganan los PX de fin de sesión.
- Pantalla de la mesa: un enlace secreto por campaña para una tele o una tablet, sin iniciar sesión. Enseña lo último revelado y las últimas tiradas, y pasa sola a la partida siguiente.
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

En producción, `pnpm build` y después `pnpm --filter @dungeon-copilot/server start`: el servidor aplica las migraciones al arrancar y sirve también la web compilada, todo en un solo puerto.

## Configuración

El servidor se configura con variables de entorno:

| Variable             | Por defecto   | Qué hace                                                                                                            |
| -------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       |               | PostgreSQL, por ejemplo `postgres://dungeon:clave@postgres:5432/dungeon`. Sin ella se usa PGlite                    |
| `DATA_DIR`           | `data/pglite` | Carpeta de datos de PGlite, relativa a donde arranca el servidor                                                    |
| `PORT`               | `3000`        | Puerto del servidor                                                                                                 |
| `HOST`               | `0.0.0.0`     | Interfaz en la que escucha                                                                                          |
| `ALLOW_REGISTRATION` | `true`        | Con `false` nadie puede crear cuentas nuevas                                                                        |
| `COOKIE_SECURE`      | `auto`        | Con `auto`, la cookie de sesión es solo HTTPS cuando la petición llega por HTTPS (o con `X-Forwarded-Proto: https`) |
| `WEB_DIST`           | `../web/dist` | Web compilada que sirve el servidor. Si no existe, solo sirve la API                                                |

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

| Ruta                                      | Qué hace                                                         |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `POST /auth/register`, `/auth/login`      | Crear cuenta o entrar                                            |
| `POST /auth/logout`, `GET /auth/me`       | Salir y saber quién ha entrado                                   |
| `GET, POST /campaigns`                    | Tus campañas y crear una nueva (quien la crea es su máster)      |
| `POST /campaigns/join`                    | Unirse con el código de invitación                               |
| `GET, PATCH, DELETE /campaigns/:id`       | Ver, cambiar o borrar una campaña (cambiar y borrar: el máster)  |
| `POST /campaigns/:id/invite-code`         | Cambiar el código de invitación (el máster)                      |
| `POST /campaigns/:id/screen-token`        | Cambiar el enlace de la pantalla de la mesa (el máster)          |
| `DELETE /campaigns/:id/members/:userId`   | Salir de la campaña, o echar a un jugador (el máster)            |
| `GET, POST /campaigns/:id/characters`     | Personajes de la campaña y crear uno                             |
| `GET, PATCH, DELETE /characters/:id`      | Ver, cambiar nombre, trasfondo o Suerte, y borrar                |
| `POST /characters/:id/damage`, `/recover` | Recibir daño y recuperarse                                       |
| `POST /characters/:id/xp`                 | Dar o quitar experiencia (el máster)                             |
| `POST /characters/:id/advances`           | Gastar experiencia en una mejora                                 |
| `GET, POST /campaigns/:id/games`          | Partidas de la campaña y abrir una (el máster)                   |
| `GET /games/:id`                          | La partida y su registro, con lo que puede ver quien pregunta    |
| `GET /games/:id/stream`                   | Directo de la partida (Server-Sent Events)                       |
| `POST /games/:id/reveals`, `/notes`       | Enseñar algo a la mesa o anotar algo solo para ti (el máster)    |
| `POST /games/:id/rolls`                   | Tirar en la partida con un personaje, o por un PNJ (el máster)   |
| `POST /games/:id/close`                   | Terminar la partida (el máster)                                  |
| `GET /screens/:token`, `/stream`          | Pantalla de la mesa: lo público de la última partida, sin sesión |
| `POST /rolls`                             | Tirar dados. No necesita sesión                                  |

Quien no es miembro de una campaña recibe un 404, como si no existiera. Una ficha la cambian su jugador y el máster; el resto de la mesa solo la ve.

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

| Carpeta           | Contenido                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `apps/web`        | Interfaz en React + Vite                                                                            |
| `apps/server`     | API en Fastify con PostgreSQL (Drizzle). Resuelve las tiradas para que todos vean la misma          |
| `packages/rules`  | Motor de reglas: tiradas, habilidades, combate, heridas, PNJ y avance. Sin dependencias de interfaz |
| `packages/shared` | Contratos entre web y servidor (esquemas Zod de la API)                                             |
| `docs`            | Reglamento y documentación del proyecto                                                             |

Los paquetes internos exportan TypeScript sin compilar: Vite los compila para la web y tsup los empaqueta dentro del servidor.
