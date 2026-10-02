# Prototipo del nuevo frontend

Un prototipo interactivo de cómo puede ser la web: la sala del máster, el móvil del jugador, la pantalla de la mesa, las campañas y las fichas, con un mapa de combate. Sirve para decidir el diseño antes de tocar `apps/web`; el plan para llevarlo a la web está en [plan.md](plan.md).

No es parte de la app: no se compila, no habla con el servidor y no se revisa con lint ni Prettier. Para verlo, abre `index.html` en el navegador (carga React, htm y las fuentes de sus CDN).

## Qué tiene

- Arriba, la barra del prototipo: **Ver como** (máster, jugador o pantalla) y **Momento** (narración o combate, que vuelve a empezar la partida en ese punto). Las tres vistas comparten el mismo estado: lo que hace el jugador llega a la cola del máster.
- Los datos son los del ejemplo de [la mesa](../mesa.md): Kael, Mira e Iria en el Ciervo Blanco, con Brunilda, Garrick y los matones.
- Las tiradas usan una copia del motor 2d6 (`rules.js`) y sus probabilidades coinciden con las tablas del [reglamento](../reglas.md).
- El mapa (`tactics.js` y `map.js`) calcula la distancia en casillas de 1,5 m (corta hasta 6, media hasta 12, larga más allá), la línea de visión y la cobertura de los muebles, y prepara la tirada con eso.
- Es de mentira: la IA y Nimble responden con textos fijos, y nada se guarda al recargar.

## Archivos

| Archivo                                  | Qué es                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `index.html`                             | La página.                                                             |
| `base.css`, `room.css`, `pages.css`      | Los tokens (oscuro y claro), las piezas, la sala y el resto de páginas. |
| `rules.js`, `tactics.js`                 | El motor de reglas y lo que el mapa sabe de distancias y cobertura.    |
| `data.js`, `store.js`                    | Los datos de ejemplo y el estado, que hace de servidor con eventos.    |
| `ui.js`                                  | Iconos, dados, probabilidades, heridas y las tarjetas del registro.    |
| `map.js`, `roller.js`, `dock.js`, `sala.js` | El mapa, el compositor de tiradas, las acciones y la sala del máster. |
| `jugador.js`, `pantalla.js`              | El móvil del jugador y la pantalla de la mesa.                         |
| `campana.js`, `ficha.js`, `app.js`       | Campañas, ficha y creación de personajes, y el armazón.                |
