# Dungeon Copilot

Asistente web para dirigir partidas de rol: preparación de campañas, ayuda en mesa con IA local (Ollama) y memoria de todo lo que pasa en la partida. El máster abre partidas a las que se unen los jugadores, en persona u online.

Ahora mismo el repositorio tiene la base del monorepo, el motor del [sistema de reglas propio](docs/reglas.md) y un tirador de dados que recorre toda la pila: web, servidor y reglas.

## Requisitos

- Node 22.12 o superior
- pnpm 10 (con `corepack enable` se usa la versión fijada en `package.json`)

## Arrancar

```sh
pnpm install
pnpm dev
```

La web queda en http://localhost:5173 y la API en http://localhost:3000.

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
| `apps/server`     | API en Fastify. Resuelve las tiradas para que todos los jugadores vean la misma                     |
| `packages/rules`  | Motor de reglas: tiradas, habilidades, combate, heridas, PNJ y avance. Sin dependencias de interfaz |
| `packages/shared` | Contratos entre web y servidor (esquemas Zod de la API)                                             |
| `docs`            | Reglamento y documentación del proyecto                                                             |

Los paquetes internos exportan TypeScript sin compilar: Vite los compila para la web y tsup los empaqueta dentro del servidor.
