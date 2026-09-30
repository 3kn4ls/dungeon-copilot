# La mesa: cómo se juega una partida

Dungeon Copilot no sustituye la conversación de la mesa: la ordena. El máster dirige y narra, y los jugadores intervienen cuando les toca o piden la palabra cuando quieren decir o hacer algo. Todo pasa en la sala de la partida, en el móvil de cada jugador y en la pantalla de la mesa, y queda en el registro, del que sale el resumen.

Sirve igual en persona que online: en persona basta con pulsar el botón y hablar en voz alta; online, cada uno escribe lo que dice o hace.

## Fases de la partida

Una partida pasa por dos fases, y cada una ofrece sus acciones:

- **Narración**: el máster describe, los personajes hablan, investigan y deciden qué hacer. La palabra la da el máster.
- **Combate**: cuando empieza una pelea, por rondas y con iniciativa. La palabra pasa sola a quien le toca (ver [Combate por rondas](#combate-por-rondas)).

La sala dice en qué fase estáis: arriba pone «La palabra» mientras se narra y «Combate · Ronda 2» mientras se pelea.

## La palabra

En cada momento, alguien tiene la palabra:

- **El máster**, que narra. Es lo normal: quien quiera intervenir, pide la palabra.
- **La mesa**: «¿Qué hacéis?». Cualquiera interviene directamente.
- **Un personaje**: «Kael, el posadero espera tu respuesta». Ese jugador interviene; los demás, si quieren, piden la palabra.

El máster la da con los botones de la sala («Narro yo», «La mesa» o el nombre de un personaje). La ven los jugadores en su móvil y la pantalla de la mesa. Cuando la palabra o una tirada es de un jugador, su pestaña empieza por «¡Te toca!» y su móvil vibra, si puede.

En combate, la palabra es de quien tiene el turno; en el de los enemigos, del máster. El máster puede dársela a otro mientras tanto, desde la cola, y al pasar el turno vuelve a quien le toca.

## Intervenciones

Cada jugador tiene cuatro botones:

| Botón     | Para qué                                                                                   |
| --------- | ------------------------------------------------------------------------------------------ |
| Hablar    | Decir algo en personaje, a un PNJ o a la mesa.                                             |
| Actuar    | Hacer algo en la escena. Suele acabar en una tirada.                                       |
| Preguntar | Preguntar al máster, fuera del personaje: «¿hay alguna ventana?».                          |
| Atacar    | Empezar una pelea: el máster empieza el combate o, si ya hay uno, mete en él al personaje. |

En combate, quien pelea tiene los botones de su turno, y elige contra quién:

| Botón           | Para qué                                                              |
| --------------- | --------------------------------------------------------------------- |
| Cuerpo a cuerpo | Atacar con su arma, o sin ella.                                       |
| A distancia     | Disparar o lanzar algo.                                               |
| Hechizo         | Lanzar un hechizo. Solo lo tiene quien sabe Hechicería.               |
| Actuar          | Cualquier otra cosa: ayudar a un compañero, cerrar la puerta, correr. |
| Hablar          | Gritar una orden, amenazar, pedir que se rindan.                      |
| Preguntar       | Preguntar al máster: «¿cuántos quedan en pie?».                       |

Escribir lo que dice o hace es opcional. Sin la palabra, la intervención es levantar la mano; con ella, es intervenir. En los dos casos espera a que el máster la atienda. Cada personaje espera con una sola a la vez, y su jugador puede retirarla.

Con **En secreto**, la intervención es una nota al máster: solo la ven él y quien la escribe.

## Cómo las atiende el máster

Las intervenciones esperan en una cola, de la más antigua a la última. Con cada una, el máster puede:

- **Dar la palabra** a ese personaje.
- **Pedir tirada**: se abre la tirada ya preparada para ese personaje, y en secreto si la intervención lo era. Sale con lo más probable según lo que quiere hacer:
  - Persuasión para hablar y Percepción para preguntar.
  - Para atacar cuerpo a cuerpo, con lo que mejor se le dé (Armas cuerpo a cuerpo o Esgrima), contra el perfil del rival.
  - A distancia, Puntería contra la dificultad del disparo, calculada con la Destreza del rival.
  - Un hechizo, Arcano contra un efecto moderado (10).
- **Responder como PNJ**: lo que escribió el jugador pasa a la charla con el PNJ, y la IA responde por él (o lo escribe el máster). La frase que enseñe atiende la intervención.
- **Responder** con una descripción, como a una pregunta. Si la intervención era secreta, la respuesta va en secreto a ese personaje.
- **Empezar combate**, si alguien ataca en plena narración, o **meterlo en el combate**, si ya hay uno y ese personaje no estaba peleando.
- **Atendida**: lo ha resuelto de palabra.
- **Ahora no**: el jugador lo ve y puede volver a intentarlo más tarde.

## Tiradas pedidas

El máster pide una tirada a un personaje: con qué tira y contra qué dificultad o rival. Al jugador le sale una tarjeta con lo que tiene que tirar, su probabilidad y un botón para tirar. El bonificador sale de su ficha en el momento de tirar, con las desventajas por heridas que tenga entonces.

- En una **defensa**, tira el personaje que se opone: «el orco ataca a Kael: tira Acrobacias para esquivar». La tarjeta le dice su probabilidad de defenderse.
- El máster puede **tirar por él**, si hace falta, o **retirarla**.
- Si la tirada sale a medias o mal y la pidió para atender una intervención escrita, la IA propone las complicaciones sabiendo lo que intentaba el personaje.

## Combate por rondas

### Empezar

El máster empieza el combate desde la sala, o desde la cola cuando alguien ataca. Elige quién pelea:

- Los **personajes**: de entrada, todos los de la campaña.
- Los **enemigos**: PNJ de la campaña o los que describe al momento, uno solo o en grupo («3 bandidos»), cada uno con su perfil (esbirro, soldado, veterano o campeón).

Al empezar, el servidor tira la **iniciativa** de todos, una vez para todo el combate, como dice el [reglamento](reglas.md#iniciativa):

- Cada PJ, 2d6 + Destreza. Si alguno tiene Táctico, todos los PJ tiran con ventaja; una herida grave da desventaja, salvo Imparable.
- Cada grupo de enemigos, 2d6 + la Destreza de su perfil: esbirro 1, soldado 2, veterano 3 y campeón 4.
- Se actúa de mayor a menor. Los empates, para los PJ; entre iguales, primero el de más Destreza.

El registro enseña el orden con los dados de cada uno, y la palabra pasa a quien empieza.

### Rondas y turnos

La palabra pasa sola de turno en turno y, tras el último, empieza otra ronda. En su turno, el jugador pulsa lo que hace su personaje y contra quién; el máster pide la tirada, que llega ya preparada, y el jugador la hace. Al acabar, el jugador pulsa **Terminar mi turno**, o el máster **Siguiente turno**. Si los dos lo pulsan a la vez, solo pasa un turno.

En el **turno de los enemigos**, el máster elige a quién atacan. La tirada se prepara en Tirar: los enemigos, con el bonificador de su perfil, contra la defensa del personaje (parar o esquivar, lo que mejor se le dé), que tira su jugador. Si disparan, el máster tira contra la dificultad que sale de la Destreza del personaje.

### A distancia

Al disparar, la dificultad se calcula sola: 6 + la Destreza del objetivo + la distancia (media +2, larga +4) + la cobertura parcial (+2) + el escudo (+1). Con Disparo certero no cuentan la distancia media ni la cobertura parcial. El máster solo elige la distancia y si hay cobertura o escudo.

### Quien llega y quien se va

- **Añadir al combate**: refuerzos, o un personaje que no peleaba. Tiran la iniciativa al llegar y ocupan su sitio en el orden; si ese sitio ya ha pasado en la ronda, actúan en la siguiente.
- **Sacar**: quien cae o huye sale del orden. Si era su turno, le toca al siguiente.

### Terminar

Al terminar el combate se vuelve a narrar y la palabra vuelve al máster. Con **Recuperar el aliento**, se borran los rasguños de los personajes que siguen en el combate.

### En la pantalla

La pantalla enseña la ronda, el orden de iniciativa con quien tiene el turno destacado y las tiradas que faltan, como la defensa que tiene que tirar un personaje.

## En secreto

Hay tres visibilidades:

- **Toda la mesa**: lo ve toda la mesa y la pantalla.
- **Solo el máster**: sus notas y sus tiradas secretas.
- **En secreto**: lo ven el máster y un jugador. Son sus intervenciones en secreto y lo que el máster le responde: descripciones, frases de PNJ, tiradas pedidas y las tiradas que salen de ellas.

Lo secreto no sale en la pantalla, no llega al resumen de la partida ni a las escenas que lee la IA. Una tirada en secreto se puede repetir con Suerte, porque su jugador la ve; las tiradas secretas del máster, no. El combate es siempre de toda la mesa.

## Un ejemplo

1. El máster enseña la posada del Ciervo Blanco y da la palabra a la mesa: «¿Qué hacéis?».
2. Ana pulsa **Hablar**: «¿Quién es el encapuchado de la esquina?». El máster responde como Brunilda, la posadera, y su frase sale en la pantalla bajo la escena.
3. Bruno pulsa **Actuar** en secreto: «Le robo la bolsa a Kael mientras habla». El máster le pide Juego de manos contra Normal, en secreto. Bruno tira desde su móvil y solo ellos dos ven el resultado.
4. Ana pulsa **Atacar**: «Le lanzo la jarra a Garrick». El máster pulsa **Empezar combate** y elige quién pelea: Kael, Garrick (un veterano de la campaña) y «3 matones», esbirros. Mira no está en la pelea.
5. Sale el orden: Garrick 10, los matones 9 y Kael 6. En el turno de Garrick, el máster lo hace atacar a Kael, y Ana tira la defensa desde su móvil. Luego, los matones.
6. Le toca a Kael: Ana pulsa **Cuerpo a cuerpo** contra Garrick. El máster pide la tirada, Ana la hace y termina su turno. Empieza la ronda 2.
7. Bruno pulsa **Atacar**: Mira salta por la ventana. El máster la mete en el combate: saca 13 y, como su sitio ya ha pasado en esta ronda, actuará en la siguiente, disparando **A distancia**.
8. Los matones huyen y el máster los saca del combate. Cuando cae Garrick, termina el combate y recuperan el aliento.

## Lo que viene

- El daño como parte de la partida: en las fichas de los personajes y en los enemigos, que caen solos al llegar a su aguante.
- Las escenas: lo que dura «una vez por escena» y los rasguños que se borran al acabarla.
- Una fase de descanso, para recuperarse y gastar experiencia.
- Más ayuda de la IA en la mesa: qué tirada pedir para una intervención, narrar los golpes, qué hacen los enemigos.

## En el código

- Todo lo de la mesa son eventos de la partida (`packages/shared/src/games.ts`):
  - `floor`: quién tiene la palabra.
  - `intervention`: lo que pide un jugador; en combate, con `target`, contra quién.
  - `rollRequest`: una tirada pedida.
  - `settled`: cierra una intervención o una tirada pedida sin nada más.
  - `combatStarted`, `turn`, `combatJoined`, `combatLeft` y `combatEnded`: el combate. Los que cambian quién pelea guardan el orden de iniciativa entero, con la ronda y el turno.
- Una intervención deja de esperar cuando otro evento la cita en `answers` (la palabra, una tirada pedida, una frase, una descripción o el combate que empieza o al que se une) o con un `settled`. Una tirada pedida se cumple con la tirada que la cita en `requested`. Lo calculan `settledEvents`, `pendingInterventions` y `pendingRollRequests`, y en el servidor, `apps/server/src/games/pending.ts`.
- El combate en juego lo calcula `currentCombat`, y quién tiene la palabra, `currentFloor`, los dos en `packages/shared/src/combat.ts` y con los eventos, igual en la web que en el servidor. Allí están también los cambios de turno y de orden (`nextTurn`, `joinCombat`, `leaveCombat`).
- La iniciativa la tira el servidor (`apps/server/src/games/combat.ts`) con las reglas de `packages/rules` (`initiativeEdge`, `compareInitiative` y la Destreza de los perfiles).
- Las rutas están en `apps/server/src/routes/table.ts` y `apps/server/src/routes/combat.ts`; `addEvent` y la lectura del registro según quién mira, en `apps/server/src/games/events.ts`.
- Lo secreto es la visibilidad `private`, con el jugador en `game_events.player_id`.
