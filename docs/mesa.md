# La mesa: cómo se juega una partida

Dungeon Copilot no sustituye la conversación de la mesa: la ordena. El máster dirige y narra, y los jugadores intervienen cuando les toca o piden la palabra cuando quieren decir o hacer algo. Todo pasa en la sala de la partida, en el móvil de cada jugador y en la pantalla de la mesa, y queda en el registro, del que sale el resumen.

Sirve igual en persona que online: en persona basta con pulsar el botón y hablar en voz alta; online, cada uno escribe lo que dice o hace.

## Fases de la partida

Una partida pasa por dos fases, y cada una ofrece sus acciones:

- **Narración**: el máster describe, los personajes hablan, investigan y deciden qué hacer. Es lo que se juega hoy en la app.
- **Combate**: por rondas y con iniciativa, cuando empieza una pelea. Llega en la próxima entrega (ver [Lo que viene](#lo-que-viene)).

## La palabra

En cada momento, alguien tiene la palabra:

- **El máster**, que narra. Es lo normal: quien quiera intervenir, pide la palabra.
- **La mesa**: «¿Qué hacéis?». Cualquiera interviene directamente.
- **Un personaje**: «Kael, el posadero espera tu respuesta». Ese jugador interviene; los demás, si quieren, piden la palabra.

El máster la da con los botones de la sala («Narro yo», «La mesa» o el nombre de un personaje). La ven los jugadores en su móvil y la pantalla de la mesa. Cuando la palabra o una tirada es de un jugador, su pestaña empieza por «¡Te toca!» y su móvil vibra, si puede.

## Intervenciones

Cada jugador tiene cuatro botones:

| Botón     | Para qué                                                                     |
| --------- | ---------------------------------------------------------------------------- |
| Hablar    | Decir algo en personaje, a un PNJ o a la mesa.                               |
| Actuar    | Hacer algo en la escena. Suele acabar en una tirada.                         |
| Preguntar | Preguntar al máster, fuera del personaje: «¿hay alguna ventana?».            |
| Atacar    | Empezar una pelea. En la próxima entrega, el máster la convierte en combate. |

Escribir lo que dice o hace es opcional. Sin la palabra, la intervención es levantar la mano; con ella, es intervenir. En los dos casos espera a que el máster la atienda. Cada personaje espera con una sola a la vez, y su jugador puede retirarla.

Con **En secreto**, la intervención es una nota al máster: solo la ven él y quien la escribe.

## Cómo las atiende el máster

Las intervenciones esperan en una cola, de la más antigua a la última. Con cada una, el máster puede:

- **Dar la palabra** a ese personaje.
- **Pedir tirada**: se abre la tirada ya preparada para ese personaje, con lo más probable según lo que quiere hacer (Persuasión para hablar, Percepción para preguntar, cuerpo a cuerpo para atacar) y en secreto si la intervención lo era.
- **Responder como PNJ**: lo que escribió el jugador pasa a la charla con el PNJ, y la IA responde por él (o lo escribe el máster). La frase que enseñe atiende la intervención.
- **Responder** con una descripción, como a una pregunta. Si la intervención era secreta, la respuesta va en secreto a ese personaje.
- **Atendida**: lo ha resuelto de palabra.
- **Ahora no**: el jugador lo ve y puede volver a intentarlo más tarde.

## Tiradas pedidas

El máster pide una tirada a un personaje: con qué tira y contra qué dificultad o rival. Al jugador le sale una tarjeta con lo que tiene que tirar, su probabilidad y un botón para tirar. El bonificador sale de su ficha en el momento de tirar, con las desventajas por heridas que tenga entonces.

- En una **defensa**, tira el personaje que se opone: «el orco ataca a Kael: tira Acrobacias para esquivar».
- El máster puede **tirar por él**, si hace falta, o **retirarla**.
- Si la tirada sale a medias o mal y la pidió para atender una intervención escrita, la IA propone las complicaciones sabiendo lo que intentaba el personaje.

## En secreto

Hay tres visibilidades:

- **Toda la mesa**: lo ve toda la mesa y la pantalla.
- **Solo el máster**: sus notas y sus tiradas secretas.
- **En secreto**: lo ven el máster y un jugador. Son sus intervenciones en secreto y lo que el máster le responde: descripciones, frases de PNJ, tiradas pedidas y las tiradas que salen de ellas.

Lo secreto no sale en la pantalla, no llega al resumen de la partida ni a las escenas que lee la IA. Una tirada en secreto se puede repetir con Suerte, porque su jugador la ve; las tiradas secretas del máster, no.

## Un ejemplo

1. El máster enseña la posada del Ciervo Blanco y da la palabra a la mesa: «¿Qué hacéis?».
2. Ana pulsa **Hablar**: «¿Quién es el encapuchado de la esquina?». El máster responde como Brunilda, la posadera, y su frase sale en la pantalla bajo la escena.
3. Bruno pulsa **Actuar** en secreto: «Le robo la bolsa a Kael mientras habla». El máster le pide Juego de manos contra Normal, en secreto. Bruno tira desde su móvil y solo ellos dos ven el resultado.
4. Ana pulsa **Atacar**: «Le lanzo la jarra a Garrick». El máster le pide la tirada de cuerpo a cuerpo, la pantalla anuncia que tira Kael y enseña el resultado. Sale un éxito con coste: con IA, el máster pide complicaciones, y la IA ya sabe lo que intentaba Kael.

## Lo que viene

### Combate por rondas

- El máster declara el combate y elige quién pelea: los personajes y grupos de enemigos, que son PNJ de la campaña o perfiles («3 bandidos, esbirros»).
- **Iniciativa, una vez por combate**, como dice el [reglamento](reglas.md#iniciativa). El servidor la tira por todos:
  - Cada PJ: 2d6 + Destreza. Táctico da ventaja a su bando; una herida grave, desventaja, salvo Imparable.
  - Cada grupo de PNJ: 2d6 + la mitad del bonificador de su perfil (esbirro +1, soldado +2, veterano +3, campeón +4). Es una regla nueva, que entrará en el reglamento, y el mismo valor servirá como su Destreza cuando se les dispara.
  - Se actúa de mayor a menor; los empates, para los PJ. El máster puede volver a tirarla si cambia la situación o llegan refuerzos.
- **Rondas y turnos**: la palabra pasa sola a quien le toca. En tu turno: atacar cuerpo a cuerpo, a distancia, otra acción, un hechizo si tienes Hechicería, y terminar tu turno.
- **El turno de los enemigos**: el máster ataca a un personaje y le pide la defensa (parar o esquivar) con una tirada pedida, o la tira él.
- **Atacar** en plena narración ofrece «Empezar combate». Al terminar se vuelve a la narración, con la opción de recuperar el aliento (se borran los rasguños).
- La pantalla enseña el orden de iniciativa y de quién es el turno.

### Después

- El daño como parte de la partida: en las fichas de los personajes y en los enemigos, que caen.
- Las escenas: lo que dura «una vez por escena» y los rasguños que se borran al acabarla.
- Una fase de descanso, para recuperarse y gastar experiencia.
- Más ayuda de la IA en la mesa: qué tirada pedir para una intervención, narrar los golpes, qué hacen los enemigos.

## En el código

- Todo lo de la mesa son eventos de la partida (`packages/shared/src/games.ts`):
  - `floor`: quién tiene la palabra.
  - `intervention`: lo que pide un jugador.
  - `rollRequest`: una tirada pedida.
  - `settled`: cierra una intervención o una tirada pedida sin nada más.
- Una intervención deja de esperar cuando otro evento la cita en `answers` (la palabra, una tirada pedida, una frase o una descripción) o con un `settled`. Una tirada pedida se cumple con la tirada que la cita en `requested`. Lo calculan `settledEvents`, `pendingInterventions` y `pendingRollRequests`, y en el servidor, `apps/server/src/games/pending.ts`.
- Las rutas están en `apps/server/src/routes/table.ts`; `addEvent` y la lectura del registro según quién mira, en `apps/server/src/games/events.ts`.
- Lo secreto es la visibilidad `private`, con el jugador en `game_events.player_id`.
