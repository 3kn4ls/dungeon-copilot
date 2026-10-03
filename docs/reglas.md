# Sistema base de Dungeon Copilot (v0.1)

Un sistema sencillo para que la partida gire alrededor de la narración y las reglas solo acompañen. Resuelve pruebas de característica, combate cuerpo a cuerpo y combate a distancia con una única mecánica.

El sistema no sabe nada de ningún mundo concreto. Cada ambientación pone los nombres de las armas, el precio de la magia y, si quiere, sus propias habilidades.

Es un borrador para jugar y ajustar. El código que lo implementa está en [`packages/rules`](../packages/rules) y cada regla de este documento tiene su test.

## La tirada

Todas las tiradas son **2d6 + atributo + habilidad**, más los modificadores de la situación, contra un objetivo:

- **Contra una dificultad fija**, cuando nadie se opone activamente: una cerradura, un muro, una flecha disparada de lejos.
- **Enfrentada**, cuando alguien se opone: los dos bandos tiran y el total del rival es el objetivo. El máster tira por los PNJ. Los empates favorecen a quien actúa.

| Dificultad  | Objetivo |
| ----------- | -------- |
| Fácil       | 8        |
| Normal      | 10       |
| Difícil     | 12       |
| Muy difícil | 14       |
| Heroica     | 16       |

### El resultado depende del margen

El margen es el total menos el objetivo.

| Margen    | Resultado                                                     |
| --------- | ------------------------------------------------------------- |
| +3 o más  | **Éxito pleno**: lo consigues.                                |
| 0, +1, +2 | **Éxito con coste**: lo consigues, pero con una complicación. |
| Negativo  | **Fallo**: no lo consigues y la situación empeora.            |

El éxito con coste es el corazón del sistema: ronda el 40% de las tiradas equilibradas y es donde el máster (o la IA) introduce giros en la historia.

### Dobles

Los resultados forman una escala: pifia, fallo, éxito con coste, éxito pleno, crítico.

- Un **doble 6** sube el resultado un escalón: un fallo pasa a éxito con coste y un éxito pleno pasa a crítico.
- Un **doble 1** lo baja un escalón: un éxito con coste pasa a fallo y un fallo pasa a pifia.

En una tirada enfrentada, los dobles del rival cuentan al revés: su doble 6 baja tu resultado y su doble 1 lo sube.

### Ventaja y desventaja

Con **ventaja** se tiran 3d6 y cuentan los dos mejores; con **desventaja**, los dos peores. Se consigue ventaja por un trasfondo que encaja, una buena preparación, la ayuda de un compañero o una técnica. Da desventaja una herida grave, una posición mala o un equipo inadecuado.

No se acumulan: dos ventajas siguen siendo una ventaja, y una ventaja y una desventaja se anulan.

### Suerte

Cada personaje empieza la sesión con **3 puntos de Suerte**. Un punto permite repetir una tirada propia; cuenta el segundo resultado. En una tirada enfrentada repites solo tus dados: los del rival se quedan como estaban. Cada personaje repite una misma tirada una sola vez.

## El personaje

### Atributos

| Atributo     | Abrev. | Para qué sirve                                                           |
| ------------ | ------ | ------------------------------------------------------------------------ |
| Fuerza       | FUE    | Armas medias y pesadas, trepar, cargar, romper.                          |
| Destreza     | DES    | Armas ligeras, disparar, esquivar, sigilo, manos hábiles.                |
| Carisma      | CAR    | Convencer, mentir, intimidar, liderar.                                   |
| Inteligencia | INT    | Percibir, recordar, curar, magia erudita.                                |
| Aguante      | AGU    | Resistir daño, fatiga, venenos y miedo. Marca cuántos rasguños soportas. |

Escala de 1 a 5: 1 flojo, 2 normal, 3 bueno, 4 excelente, 5 legendario.

**Al crear el personaje** se reparten **12 puntos** entre los cinco atributos, con un mínimo de 1 y un máximo de 4 en cada uno. El 5 solo se alcanza con experiencia.

### Trasfondo

Una frase que resume de dónde viene el personaje: "Mercenaria de la Compañía Libre", "Criado entre ladrones en los muelles". Cuando encaja con lo que intenta, el máster le da ventaja.

### Habilidades básicas

Cualquiera puede aprenderlas. Tienen **rango de 0 a 3** (sin entrenar, entrenado, experto, maestro) y el rango se suma a la tirada. Cada habilidad pertenece a un atributo, que es con el que se tira normalmente; el máster puede pedir otro si la situación lo justifica (intimidar con Fuerza, por ejemplo).

**Al crear el personaje** se reparten **6 rangos**, con un máximo de 2 en cada habilidad.

### Habilidades avanzadas

Son técnicas con **requisitos**: un valor mínimo de atributo y, casi siempre, un rango mínimo en una habilidad básica. No tienen rango ni suman a la tirada; cambian lo que puedes hacer o lo que significa un resultado.

**Al crear el personaje** se puede elegir **una**, si se cumplen sus requisitos.

### Catálogo de serie

| Atributo     | Básicas                                               | Avanzadas (requisitos)                                                                                                |
| ------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Fuerza       | Atletismo, Armas cuerpo a cuerpo, Pelea               | Golpe demoledor (FUE 4, Armas cuerpo a cuerpo 2) · Presa de hierro (FUE 3, Pelea 2) · Carga brutal (FUE 3)            |
| Destreza     | Esgrima, Puntería, Acrobacias, Sigilo, Juego de manos | Disparo certero (DES 4, Puntería 2) · Ataque furtivo (DES 3, Sigilo 2) · Esquiva prodigiosa (DES 4, Acrobacias 2)     |
| Carisma      | Persuasión, Engaño, Intimidación, Interpretación      | Voz de mando (CAR 4, Persuasión 2) · Presencia aterradora (CAR 3, Intimidación 2) · Lengua de plata (CAR 4, Engaño 2) |
| Inteligencia | Percepción, Saber, Medicina, Arcano                   | Táctico (INT 4, Percepción 2) · Erudito (INT 3, Saber 2) · Hechicería (INT 4, Arcano 2)                               |
| Aguante      | Resistencia, Voluntad, Supervivencia                  | Duro de pelar (AGU 3, Resistencia 2) · Entrenamiento con armaduras (AGU 3) · Imparable (AGU 4, Voluntad 2)            |

Qué hace cada técnica:

- **Golpe demoledor**: con un arma pesada, un éxito pleno o crítico hace +1 de daño y derriba al rival.
- **Presa de hierro**: quien está en tu presa tiene desventaja para soltarse y no puede usar armas medias ni pesadas.
- **Carga brutal**: si corres hacia el rival antes de atacar, tienes ventaja en ese ataque; hasta tu siguiente turno te defiendes con desventaja.
- **Disparo certero**: ignoras la cobertura parcial y la penalización por distancia media.
- **Ataque furtivo**: contra un rival que no te ha visto venir, haces +2 de daño.
- **Esquiva prodigiosa**: una vez por escena, cuando te impactan, reduces el daño a 1.
- **Voz de mando**: una vez por escena, das una orden y un aliado que te oiga tiene ventaja en su siguiente tirada.
- **Presencia aterradora**: con un éxito pleno al intimidar, los esbirros huyen o se rinden.
- **Lengua de plata**: una vez por sesión, repites una tirada fallida de Persuasión o Engaño sin gastar Suerte.
- **Táctico**: tu bando tira la iniciativa con ventaja.
- **Erudito**: una vez por sesión, haces una pregunta al máster sobre el mundo y te responde con la verdad, aunque sea parcial.
- **Hechicería**: puedes lanzar hechizos (ver [Magia](#magia)).
- **Duro de pelar**: tienes una casilla de rasguño más.
- **Entrenamiento con armaduras**: la armadura pesada no te da desventaja en Sigilo ni en Acrobacias.
- **Imparable**: ignoras la desventaja de una herida grave. Una vez por sesión, al quedar fuera de combate, aguantas en pie hasta el final de tu siguiente turno.

### Equipo

La ficha apunta con qué pelea el personaje:

- **Arma cuerpo a cuerpo**: ligera, media o pesada (ver [Daño](#daño)). Decide con qué ataca y para: las ligeras con Destreza + Esgrima; las medias y pesadas con Fuerza + Armas cuerpo a cuerpo.
- **Arma a distancia**, si lleva: también ligera, media o pesada.
- **Armadura**: ninguna, ligera o pesada. Resta daño, y la pesada estorba en Sigilo y Acrobacias.
- **Escudo**: +1 al parar y +1 a la dificultad de acertarle a distancia.

Cada ambientación pone los nombres: una espada larga es un arma media y una ballesta pesada, una pesada. **Al crear el personaje** se elige lo que lleva; si no se elige nada, lleva un arma media y nada más.

### Ejemplo: Kael

Mercenario de la Compañía Libre.

- **Atributos**: Fuerza 4, Destreza 3, Carisma 1, Inteligencia 2, Aguante 2 (12 puntos).
- **Habilidades**: Armas cuerpo a cuerpo 2, Atletismo 1, Intimidación 1, Supervivencia 1, Percepción 1 (6 rangos).
- **Avanzada**: Carga brutal.
- **Equipo**: espada (arma media) y cota de malla (armadura ligera).
- **Rasguños**: 2. **Suerte**: 3.

Con la espada tira 2d6 + 6 y hace 2 de daño. Contra un soldado (+4) impacta en tres de cada cuatro ataques.

## Escenas y sesiones

Una **escena** es un tramo de la partida con unidad de lugar y de acción: la posada, la emboscada del camino, la cripta. La abre el máster cuando cambia el lugar o pasa el tiempo, y un combate ocurre dentro de una escena. Una **sesión** es una partida, de principio a fin.

- Lo que se usa **una vez por escena**, como Esquiva prodigiosa o Voz de mando, vuelve con la escena siguiente.
- Lo que se usa **una vez por sesión**, como Lengua de plata, Erudito o Imparable, vuelve con la sesión siguiente, como la Suerte.
- Al acabar una escena, los personajes recuperan el aliento: se borran sus rasguños (ver [Heridas](#heridas)).

## Combate

### Iniciativa

Al empezar el combate, cada PJ tira **2d6 + Destreza** y el máster tira una vez por cada grupo de enemigos: **2d6 + la Destreza de su perfil** (ver [PNJ](#pnj)). Es una tirada de Destreza: una herida grave da desventaja, y Táctico da ventaja a todo su bando.

Se actúa de mayor a menor, y el orden dura todo el combate:

- Los empates, para los PJ. Entre dos PJ o dos grupos empatados, primero el de más Destreza.
- Quien se une a mitad de combate, como unos refuerzos, tira al llegar y ocupa su sitio en el orden. Si ese sitio ya ha pasado en la ronda, empieza a actuar en la siguiente.

### Cuerpo a cuerpo

Es una tirada enfrentada.

- **Ataque**: armas ligeras con Destreza + Esgrima; armas medias y pesadas con Fuerza + Armas cuerpo a cuerpo. Un arma pesada sin Fuerza 3 se usa con desventaja.
- **Defensa**: parar con tu arma (el escudo suma +1) o esquivar con Destreza + Acrobacias.

| Resultado del atacante | Qué pasa                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crítico                | Impactas con +1 de daño y eliges un efecto: derribar, desarmar o empujar al rival.                                                                        |
| Éxito pleno            | Impactas.                                                                                                                                                 |
| Éxito con coste        | Impactas, pero el máster elige un coste: recibes un golpe (daño del rival −1), quedas en mala posición (el rival tiene ventaja contra ti) o pierdes algo. |
| Fallo                  | No impactas y la situación empeora: el máster puede dar ventaja al rival contra ti.                                                                       |
| Pifia                  | No impactas y quedas expuesto: el rival te golpea con su daño o pierdes el arma.                                                                          |

### A distancia

Es una tirada contra dificultad: **Destreza + Puntería** contra **6 + Destreza del objetivo + distancia + cobertura**.

| Modificador              | Valor |
| ------------------------ | ----- |
| Distancia corta          | +0    |
| Distancia media          | +2    |
| Distancia larga          | +4    |
| Cobertura parcial        | +2    |
| El objetivo lleva escudo | +1    |

Un objetivo con Destreza 2 a distancia media está a dificultad 10. Un PNJ de perfil usa la Destreza de su perfil.

| Resultado       | Qué pasa                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Crítico         | Impactas con +1 de daño.                                                                            |
| Éxito pleno     | Impactas.                                                                                           |
| Éxito con coste | Impactas, pero con un coste: quedas al descubierto, gastas munición de más o haces 1 de daño menos. |
| Fallo           | Fallas.                                                                                             |
| Pifia           | Algo sale mal: se rompe la cuerda, se encasquilla el arma o casi alcanzas a un aliado.              |

### En un mapa

Si el combate se juega sobre un plano en casillas, la distancia y la cobertura salen de él. Cada casilla mide 1,5 m.

- **Distancia**: se cuentan las casillas hasta el objetivo, y las diagonales cuentan como una. Es **corta** hasta 6 casillas (9 m), **media** hasta 12 (18 m) y **larga** más allá.
- **Cuerpo a cuerpo**: contra quien está en una casilla de al lado, también en diagonal.
- **Línea de visión**: se traza del centro de una casilla al de la otra. Un muro la corta, y entre dos muros en diagonal tampoco se ve; una puerta abierta, no.
- **Cobertura parcial**: si la línea pasa por un mueble o una ventana. No cuenta el que está al lado de quien dispara: se dispara por encima de la mesa propia o desde la ventana. Los demás que pelean no dan cobertura.
- **Dónde se puede estar**: en el suelo o en una puerta, no en un muro, una ventana ni un mueble.

### Daño

| Arma   | Daño | Ejemplos                                         |
| ------ | ---- | ------------------------------------------------ |
| Ligera | 1    | daga, espada corta, honda, cuchillos arrojadizos |
| Media  | 2    | espada, hacha, maza, lanza, arco                 |
| Pesada | 3    | mandoble, hacha a dos manos, ballesta pesada     |

El crítico suma 1. La **armadura ligera** resta 1 al daño y la **pesada** resta 2, pero da desventaja en Sigilo y Acrobacias. Un impacto siempre hace al menos 1 de daño.

### Heridas

No hay puntos de vida. Cada personaje tiene tantas **casillas de rasguño** como su Aguante. El daño llena primero los rasguños; cada punto que no cabe empeora la herida un nivel:

1. **Herido**: sin efecto en las tiradas, pero se nota.
2. **Grave**: desventaja en tiradas de Fuerza, Destreza y Aguante.
3. **Fuera de combate**: el personaje cae. Si recibe más daño, muere salvo que el jugador gaste un punto de Suerte.

**Recuperación**: los rasguños se borran al final de la escena, tras recuperar el aliento. Cada nivel de herida mejora con una noche de descanso (herido) o una semana (grave); unos buenos cuidados (Inteligencia + Medicina contra 10) lo acortan a un día.

### PNJ

Los PNJ importantes llevan ficha completa. Los secundarios usan un perfil: el máster tira **2d6 + el bonificador del perfil** en lo que el PNJ sabe hacer, y 2 menos en lo demás.

| Perfil   | Bonificador | Destreza | Aguanta | Daño | Ejemplos                                                       |
| -------- | ----------- | -------- | ------- | ---- | -------------------------------------------------------------- |
| Esbirro  | +2          | 1        | 1       | 1    | Matones, bandidos, bestias menores.                            |
| Soldado  | +4          | 2        | 3       | 2    | Guardias, mercenarios, lobos.                                  |
| Veterano | +6          | 3        | 4       | 2    | Capitanes, asesinos, bestias grandes.                          |
| Campeón  | +8          | 4        | 6       | 3    | Un rival para todo el grupo: campeones, monstruos, hechiceros. |

"Aguanta" es el daño total que soporta antes de caer. La **Destreza** es la mitad del bonificador: con ella tira la iniciativa y es la que cuenta para dispararle.

**Grupos**: unos enemigos iguales, como tres bandidos, comparten perfil y tiran juntos la iniciativa, pero cada uno aguanta lo suyo. Un impacto alcanza a uno solo: en un mapa, al que se apunta; si no, al más herido de los que siguen en pie. Cae al llegar a su aguante, y el daño que sobra no pasa al siguiente. El grupo deja de pelear cuando caen todos.

## Magia

Solo quien tiene **Hechicería** puede lanzar hechizos. Se tira **Inteligencia + Arcano** contra la dificultad del efecto: menor 8, moderado 10, mayor 12, portentoso 14 o más.

Con un **éxito con coste**, el hechizo funciona pero se paga el precio que marque la ambientación: fatiga (un rasguño), corrupción, un favor a una entidad. Con un **fallo**, no funciona y el máster decide si además hay precio. Con una **pifia**, la magia se descontrola.

Cada ambientación puede renombrar Hechicería o añadir otras vías, como la fe con Carisma.

## Avance

Al final de cada sesión, cada personaje gana **2 PX más 1 por cada hito** conseguido, hasta 3 hitos.

| Mejora                                  | Coste en PX |
| --------------------------------------- | ----------- |
| Subir una habilidad básica al rango N   | N × 2       |
| Aprender una habilidad avanzada         | 5           |
| Subir un atributo al valor N (máximo 5) | N × 3       |

## Probabilidades

Calculadas de forma exacta con el propio motor. Para regenerarlas tras cambiar las reglas: `pnpm --filter @dungeon-copilot/rules tabla`.

### Pruebas contra dificultad

Éxito de cualquier tipo y, entre paréntesis, éxito pleno o crítico.

| Bonificador | Fácil (8) | Normal (10) | Difícil (12) | Muy difícil (14) | Heroica (16) |
| ----------- | --------- | ----------- | ------------ | ---------------- | ------------ |
| +2          | 72% (28%) | 42% (8%)    | 17% (3%)     | 3% (3%)          | 3% (0%)      |
| +3          | 83% (42%) | 58% (17%)   | 28% (3%)     | 8% (3%)          | 3% (0%)      |
| +4          | 92% (58%) | 72% (28%)   | 42% (8%)     | 17% (3%)         | 3% (3%)      |
| +5          | 97% (72%) | 83% (42%)   | 58% (17%)    | 28% (3%)         | 8% (3%)      |
| +6          | 97% (83%) | 92% (58%)   | 72% (28%)    | 42% (8%)         | 17% (3%)     |
| +7          | 97% (92%) | 97% (72%)   | 83% (42%)    | 58% (17%)        | 28% (3%)     |
| +8          | 97% (97%) | 97% (83%)   | 92% (58%)    | 72% (28%)        | 42% (8%)     |

### Ventaja y desventaja contra dificultad Normal

| Bonificador | Desventaja | Normal    | Ventaja    |
| ----------- | ---------- | --------- | ---------- |
| +2          | 19% (2%)   | 42% (8%)  | 68% (20%)  |
| +3          | 32% (5%)   | 58% (17%) | 81% (36%)  |
| +4          | 48% (11%)  | 72% (28%) | 89% (52%)  |
| +5          | 64% (19%)  | 83% (42%) | 95% (68%)  |
| +6          | 80% (32%)  | 92% (58%) | 98% (81%)  |
| +7          | 93% (48%)  | 97% (72%) | >99% (89%) |
| +8          | 93% (64%)  | 97% (83%) | >99% (95%) |

### Tiradas enfrentadas

Desde quien actúa, según la diferencia de bonificadores.

| Diferencia | Pifia | Fallo | Con coste | Pleno | Crítico | Éxito total |
| ---------- | ----- | ----- | --------- | ----- | ------- | ----------- |
| -4         | 5%    | 77%   | 12%       | 4%    | 1%      | 17%         |
| -3         | 5%    | 70%   | 17%       | 5%    | 2%      | 25%         |
| -2         | 5%    | 61%   | 22%       | 8%    | 3%      | 34%         |
| -1         | 5%    | 50%   | 27%       | 13%   | 4%      | 44%         |
| 0          | 5%    | 39%   | 31%       | 20%   | 5%      | 56%         |
| +1         | 5%    | 29%   | 32%       | 29%   | 5%      | 66%         |
| +2         | 5%    | 20%   | 31%       | 39%   | 5%      | 75%         |
| +3         | 4%    | 13%   | 27%       | 50%   | 5%      | 83%         |
| +4         | 3%    | 8%    | 22%       | 61%   | 5%      | 88%         |

### Un PJ típico (+5) contra cada perfil de PNJ

| Perfil        | Ataca el PJ | Ataca el PNJ |
| ------------- | ----------- | ------------ |
| Esbirro (+2)  | 83% (56%)   | 25% (8%)     |
| Soldado (+4)  | 66% (34%)   | 44% (17%)    |
| Veterano (+6) | 44% (17%)   | 66% (34%)    |
| Campeón (+8)  | 25% (8%)    | 83% (56%)    |

## Por qué 2d6

- **Cada punto cuenta.** Con una curva de campana, un +1 en atributo o habilidad mueve la probabilidad de éxito entre 11 y 16 puntos en la zona media. Por eso los requisitos de atributo de las técnicas y la experiencia se notan en la mesa. En un d20, un +1 son siempre 5 puntos.
- **El máster tira sin que se dispare el azar.** Enfrentar dos 2d6 da márgenes razonables; dos d20 enfrentados son una lotería.
- **Tres bandas de resultado** estables en todos los niveles, con el éxito con coste siempre presente.
- **Solo hacen falta dados de seis caras.**
