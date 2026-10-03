# Plan: el nuevo frontend

Llevar el [prototipo](README.md) a `apps/web` sin perder nada de lo que hace hoy la web y abriendo la puerta a lo que le falta, empezando por el mapa de combate.

## Decisiones

Confirmadas el 2 de octubre de 2026.

| Decisión          | Elegida                                                                                                                                          | Alternativa                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Estrategia        | Rehacer `apps/web` pantalla a pantalla. Se quedan React, React Router, TanStack Query, el directo y la lógica de `rolling.ts`; cambian las vistas. | Una `apps/web-next` en paralelo. Más libertad, pero dos webs hasta el final y nada se despliega antes. |
| Mapas             | Cuadrícula dibujada: muros, puertas, ventanas y muebles. La línea de visión y la cobertura salen solas.                                          | Imagen subida con cuadrícula encima (la cobertura, a mano). Se puede añadir después: fase 8.          |
| Fichas ocultas    | Sí, fuera del combate: el máster coloca enemigos que solo ve él y se hacen públicos al entrar en combate. El combate sigue siendo de toda la mesa. | Todo lo del mapa es público.                                                                          |
| Git               | Un PR por fase: cada fase deja la web entera y se despliega al entrar en `main`.                                                                  | Como con Nimble: una rama, un commit por fase y un PR al final.                                       |
| Tema y fuentes    | Oscuro y claro según el sistema, con un selector que se recuerda en el navegador. Alegreya autoalojada con `@fontsource`, sin Google Fonts.       |                                                                                                      |

## Cómo se trabaja cada fase

- Rama desde `main`, commits en español y, al acabar, `pnpm check` y `pnpm build`.
- Se mira en el navegador, en los dos temas y a ancho de móvil, con `pnpm dev` y `DATA_DIR` en una carpeta temporal.
- La web no tiene tests: la lógica nueva va en `packages/rules` o `packages/shared`, con los suyos, y el servidor con los de sus rutas.
- Si cambia cómo se juega (fases 4 a 7), se cambian también `docs/mesa.md` y la sección «La mesa» de `CLAUDE.md`; si cambia una regla (fase 6), `docs/reglas.md`.

## Fases

### Fase 0. El prototipo y el plan

Ya está en esta rama: `docs/prototipo`, fuera de lint y de Prettier.

### Fase 1. Sistema de diseño y armazón

- `styles.css` (2357 líneas) se parte en `styles/`: los tokens del prototipo (paleta oscura y clara, los colores de cada resultado, tipografía y radios), la base y las piezas.
- Las piezas con el aspecto nuevo: iconos SVG propios (`components/Icon.tsx`), botones, `Segmented`, chips, etiquetas, dados con puntos, la barra de probabilidades, heridas y Suerte. Los avatares y los avisos llegan con las pantallas que los usan.
- `Layout`: el raíl de navegación (Campañas, la última campaña visitada y su sala si hay partida en juego, y Tirador), que en el móvil va abajo, con el selector de tema y Salir.
- Hecho cuando: todas las pantallas de hoy funcionan con las piezas nuevas, en los dos temas.

### Fase 2. Campañas y campaña

- Campañas: tarjetas con emblema, rol, «En juego» con «Entrar en la sala», y crear y unirse con código.
- La campaña, con pestañas que tienen su ruta: **Crónica** (las partidas en línea de tiempo con su resumen y abrir partida), **Personajes**, **PNJ** y **Mesa** (miembros, invitar, la pantalla y los ajustes).
- Los PNJ se abren en un panel lateral, con «Inventar con IA», «Probar su voz» y lo que ocultan a la vista solo del máster.

### Fase 3. Ficha, creación y tirador

- La ficha: atributos, habilidades por atributo con su rango y su bonificador, y al tocar una, su probabilidad contra cada dificultad (`testOdds`). Técnicas con sus usos, heridas, equipo, Suerte y la tienda de experiencia (`planAdvance`).
- Crear personaje: un asistente en cuatro pasos (quién es, atributos, habilidades, técnica y equipo) que valida el reparto al momento (`validateNewCharacter`).
- El tirador estrena el compositor de tiradas de la sala: quién, con qué, contra qué, ventaja y la barra con cada resultado.

### Fase 4. La sala del máster

La más grande: `GamePage.tsx` tiene 1678 líneas. Va en dos pasos, y la sala funciona entera tras cada uno.

1. **Distribución y registro.** Tres columnas: la mesa (personajes, enemigos y PNJ en escena), el escenario (la palabra o el orden de iniciativa, y la escena) y, a la derecha, lo que espera y el registro, con filtros. Las tarjetas del registro, con dados, el color de cada resultado y la visibilidad.
2. **Cola y acciones.** La cola con sus seis respuestas y las tiradas pedidas. Debajo del escenario, las acciones (Enseñar, Hablar como PNJ, Tirar, Anotar e Ideas), con el compositor, Nimble y el guardián de secretos como hasta ahora.

Se reutilizan los componentes de hoy (`Interventions`, `RollRequests`, `Damage`, `Decisions`, `NpcChat`, `Scenes`, `Combat`) con el diseño nuevo. Hecho cuando todo lo de [la mesa](../mesa.md) se hace desde la sala nueva.

### Fase 5. El móvil del jugador y la pantalla

- El jugador, con pestañas (Mesa, Ficha, Registro y, en la fase 7, Mapa): «¡Te toca!», la tarjeta de la tirada pedida con su probabilidad, los botones de narración y de combate, «En secreto» y sus técnicas.
- La pantalla de la mesa: la escena en grande, el orden, la última tirada y lo que falta por tirar.

### Fase 6. Mapas: reglas, eventos y servidor

- **Reglas** (`packages/rules`, con tests): la distancia en casillas de 1,5 m, las bandas de alcance (corta hasta 6, media hasta 12, larga más allá), la línea de visión y la cobertura parcial sobre una cuadrícula. Se apunta en `docs/reglas.md`.
- **Esquemas** (`packages/shared`): la cuadrícula de un mapa (tamaño, muros, puertas, ventanas y muebles, con o sin cobertura). Hay eventos nuevos:
  - el mapa que se pone en la partida, guardado entero como era entonces;
  - una ficha que se coloca, se mueve o se quita.
- **Cálculo**: `currentMap` calcula el mapa y dónde está cada uno según quién mira, como `currentCombat`.
- **Fichas ocultas**: las figuras y los PNJ que el máster coloca y la mesa aún no ve son eventos `master`. Se enseñan al moverlas sin esconderlas. Lo que la mesa ya ha visto no se esconde (se quita), y los personajes nunca. Las fichas de un grupo van una por cada uno de sus miembros.
- **Servidor**:
  - La tabla `maps` de cada campaña, con su migración.
  - Las rutas `routes/maps.ts`. Los mapas de la campaña son del máster: a un jugador, 403, y a quien no es miembro, 404.
  - Poner un mapa en la partida es cosa del máster.
  - Las fichas las mueve el máster, y cada jugador la suya (en combate, en su turno).
- **Tests**: las fichas ocultas no llegan a los jugadores, ni a la pantalla, ni al resumen, ni a lo que lee la IA.

### Fase 7. Mapas en la web

- La pestaña **Mapas** de la campaña: la biblioteca y un editor de cuadrícula para pintar muros, puertas y ventanas, poner muebles y elegir su tamaño.
- El mapa en la sala, con mover, medir y «Ver como la mesa». Para apuntar, se elige una ficha y luego un rival: salen la distancia, el alcance, la línea de visión y la cobertura, que rellenan solas el disparo (`Shot` de `rolling.ts`). Desde ahí se prepara la tirada.
- El mapa en el móvil del jugador (mueve su ficha y apunta) y en la pantalla (solo lo público).
- Empezar el combate desde el mapa: las figuras que pelean pasan a ser los PNJ del combate, cada una en su sitio (y a la vista).
- Qué ficha de un grupo cae al recibir un golpe. Hoy el servidor solo cuenta cuántos caen: el golpe tendrá que decir a cuál del grupo va.
- «Señalar» necesita un mensaje del directo que no se guarda. Va al final de la fase, si cabe.

### Fase 8 (opcional). Imagen de fondo para los mapas

Subir un plano, guardarlo en PostgreSQL con un tope de tamaño y ajustar la cuadrícula encima. El `Dockerfile` y los manifiestos no cambian.

## Orden

La fase 1 va antes que todas. La 2 y la 3 son independientes entre sí, y la 5 va tras la 4. La 6 es del servidor y puede ir en paralelo a las fases 2 a 5. La 7 necesita la 4, la 5 y la 6.

## Riesgos

- **El tamaño de la sala**: por eso la fase 4 va en dos pasos.
- **Arrastrar fichas con el dedo**: el mapa usa eventos de puntero, `touch-action: none` y fichas grandes. También tiene que poder moverse una ficha con el teclado.
- **Muchos movimientos**:
  - Se guarda uno al soltar la ficha, no mientras se arrastra.
  - El registro no los enseña, como ya pasa con `settled`.
  - El resumen y la IA los ignoran.
- **Lo secreto en la pantalla**: lo cubren los tests de la fase 6.

## Después

Lo que el nuevo diseño deja a mano y no entra en este plan:

- Niebla de guerra y zonas que se revelan.
- Estados en las fichas (derribado, en una presa) y plantillas de área para los hechizos.
- Imágenes que el máster enseña a la mesa.
- La fase de descanso de [Lo que viene](../mesa.md#lo-que-viene).
- Notas de campaña.
