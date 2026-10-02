// Datos de ejemplo del prototipo: la campaña del ejemplo de docs/mesa.md, en dos momentos.
(function () {
  const DC = (window.DC = window.DC || {});

  const CAMPAIGNS = [
    {
      id: 'ciervo',
      name: 'La Marca del Ciervo',
      description: 'Una comarca fronteriza donde los caminos ya no son seguros y una posada guarda más de un secreto.',
      role: 'master',
      live: true,
      members: 4,
      characters: 3,
      code: 'K7PX3M',
      sigil: 'ciervo',
      lastPlayed: 'Hoy',
    },
    {
      id: 'sal',
      name: 'Sal y Ceniza',
      description: 'Contrabandistas en una ciudad portuaria que se hunde un palmo cada invierno.',
      role: 'player',
      live: false,
      members: 5,
      characters: 4,
      sigil: 'ancla',
      lastPlayed: 'Hace 6 días',
      master: 'Lucía',
    },
    {
      id: 'torres',
      name: 'Las Torres de Vidrio',
      description: 'Aprendices de un colegio de magia que acaba de cerrar sus puertas para siempre.',
      role: 'master',
      live: false,
      members: 3,
      characters: 2,
      sigil: 'torre',
      lastPlayed: 'Hace 2 meses',
    },
  ];

  const PLAYERS = { ana: 'Ana', bruno: 'Bruno', carla: 'Carla' };

  const CHARACTERS = {
    kael: {
      id: 'kael',
      name: 'Kael',
      owner: 'ana',
      color: 'var(--pc-1)',
      background: 'Mercenario de la Compañía Libre',
      attrs: { strength: 4, dexterity: 3, charisma: 1, intelligence: 2, endurance: 2 },
      skills: { 'melee-weapons': 2, athletics: 1, intimidation: 1, survival: 1, perception: 1 },
      advanced: ['brutal-charge'],
      gear: {
        melee: { name: 'Espada larga', class: 'medium' },
        ranged: null,
        armor: { name: 'Cota de malla', class: 'light' },
        shield: false,
      },
      wounds: { scratches: 0, severity: 'none' },
      luck: 3,
      xp: 4,
    },
    mira: {
      id: 'mira',
      name: 'Mira',
      owner: 'bruno',
      color: 'var(--pc-2)',
      background: 'Criada entre ladrones en los muelles',
      attrs: { strength: 1, dexterity: 4, charisma: 3, intelligence: 2, endurance: 2 },
      skills: { stealth: 2, 'sleight-of-hand': 2, acrobatics: 2 },
      advanced: ['uncanny-dodge'],
      gear: {
        melee: { name: 'Dagas', class: 'light' },
        ranged: { name: 'Arco corto', class: 'medium' },
        armor: { name: 'Jubón de cuero', class: 'light' },
        shield: false,
      },
      wounds: { scratches: 0, severity: 'none' },
      luck: 2,
      xp: 2,
    },
    iria: {
      id: 'iria',
      name: 'Iria',
      owner: 'carla',
      color: 'var(--pc-3)',
      background: 'Aprendiz expulsada del Colegio de Vidrio',
      attrs: { strength: 1, dexterity: 2, charisma: 2, intelligence: 4, endurance: 3 },
      skills: { arcana: 2, lore: 2, medicine: 1, perception: 1 },
      advanced: ['sorcery'],
      gear: {
        melee: { name: 'Bastón de fresno', class: 'medium' },
        ranged: null,
        armor: { name: 'Sin armadura', class: 'none' },
        shield: false,
      },
      wounds: { scratches: 0, severity: 'none' },
      luck: 3,
      xp: 3,
    },
  };

  const NPCS = [
    {
      id: 'brunilda',
      name: 'Brunilda',
      concept: 'Posadera del Ciervo Blanco',
      appearance: 'Brazos de panadera y un delantal siempre limpio.',
      personality: 'Hospitalaria y cotilla, pero calla en cuanto se habla del barón.',
      speech: 'Llama «corazón» a todo el mundo.',
      goals: 'Que nadie baje al sótano.',
      secrets: 'Esconde en el sótano a Tomás, el hijo del barón, que huyó de su padre.',
      profile: null,
      lines: 6,
    },
    {
      id: 'garrick',
      name: 'Garrick',
      concept: 'Capitán de los matones del camino',
      appearance: 'Una cicatriz le cruza la boca. Capa de lana raída.',
      personality: 'Frío y paciente. Desprecia a los nobles.',
      speech: 'Pocas palabras, siempre en voz baja.',
      goals: 'Encontrar al hijo del barón antes que nadie y cobrar el rescate.',
      secrets: 'Fue sargento de la guardia del barón hasta que lo expulsaron.',
      profile: 'veteran',
      lines: 3,
    },
    {
      id: 'odo',
      name: 'Hermano Odo',
      concept: 'Monje errante que se aloja en la posada',
      appearance: 'Hábito pardo, sandalias embarradas, una bolsa que tintinea.',
      personality: 'Afable, curioso, demasiado atento a todo.',
      speech: 'Cita proverbios que nadie conoce.',
      goals: 'Saber qué esconde Brunilda.',
      secrets: 'Es un espía del obispo de Valdeholm.',
      profile: null,
      lines: 1,
    },
  ];

  const GAMES = [
    {
      id: 'g2',
      number: 2,
      title: 'Lo que esconde el Ciervo Blanco',
      status: 'open',
      date: 'Hoy, 20:30',
    },
    {
      id: 'g1',
      number: 1,
      title: 'El camino a Valdeholm',
      status: 'closed',
      date: '19 de septiembre',
      xp: 3,
      recap:
        'Los tres siguieron el rastro de un carro volcado hasta Valdeholm. Iria reconoció el sello del barón en una carta empapada y Mira encontró huellas de botas militares. Kael ahuyentó a dos lobos que rondaban el carro. La carta habla de un hijo que «no debe volver a casa». Esa noche buscaron refugio en el Ciervo Blanco.',
    },
  ];

  /** El plano de la posada, en casillas de 1,5 m. */
  const MAPS = {
    ciervo: {
      id: 'ciervo',
      name: 'Posada del Ciervo Blanco',
      cols: 22,
      rows: 14,
      walls: [
        [0, 0, 22, 1],
        [0, 13, 10, 1],
        [12, 13, 10, 1],
        [0, 1, 1, 12],
        [21, 1, 1, 12],
        [15, 1, 1, 2],
        [15, 4, 1, 3],
        [16, 6, 5, 1],
      ],
      doors: [
        { x: 10, y: 13, w: 2, h: 1, label: 'Puerta' },
        { x: 15, y: 3, w: 1, h: 1, label: 'Cocina' },
      ],
      windows: [
        { x: 12, y: 0, w: 2, h: 1 },
        { x: 0, y: 5, w: 1, h: 2 },
      ],
      furniture: [
        { x: 2, y: 3, w: 6, h: 1, kind: 'bar', cover: true, label: 'Barra' },
        { x: 4, y: 7, w: 2, h: 1, kind: 'table', cover: true },
        { x: 9, y: 4, w: 2, h: 1, kind: 'table', cover: true },
        { x: 10, y: 10, w: 2, h: 1, kind: 'table', cover: true },
        { x: 13, y: 8, w: 1, h: 2, kind: 'table', cover: true },
        { x: 17, y: 10, w: 2, h: 1, kind: 'table', cover: true },
        { x: 16, y: 1, w: 2, h: 1, kind: 'counter', cover: true, label: 'Fogón' },
        { x: 19, y: 1, w: 1, h: 1, kind: 'barrel', cover: true },
        { x: 20, y: 1, w: 1, h: 1, kind: 'barrel', cover: true },
        { x: 20, y: 2, w: 1, h: 1, kind: 'barrel', cover: true },
        { x: 20, y: 8, w: 1, h: 2, kind: 'fire', label: 'Chimenea' },
        { x: 1, y: 10, w: 2, h: 3, kind: 'stairs', label: 'Escalera' },
        { x: 18, y: 4, w: 1, h: 1, kind: 'trapdoor', label: 'Trampilla', secret: true },
      ],
      zones: [
        { x: 7.5, y: 12.4, label: 'Comedor' },
        { x: 18, y: 5.4, label: 'Cocina' },
      ],
    },
  };

  const MAP_LIBRARY = [
    { id: 'ciervo', name: 'Posada del Ciervo Blanco', size: '22 × 14', state: 'En la partida' },
    { id: 'camino', name: 'Camino de Valdeholm', size: '30 × 18', state: 'Preparado' },
    { id: 'cripta', name: 'Cripta del barón', size: '16 × 16', state: 'Borrador' },
  ];

  const GROUPS = {
    garrick: { id: 'garrick', name: 'Garrick', profile: 'veteran', npc: 'garrick' },
    matones: { id: 'matones', name: 'Matones', profile: 'minion' },
  };

  function tokens() {
    return [
      { id: 'kael', kind: 'pc', char: 'kael', name: 'Kael', x: 8, y: 8 },
      { id: 'mira', kind: 'pc', char: 'mira', name: 'Mira', x: 12, y: 2 },
      { id: 'iria', kind: 'pc', char: 'iria', name: 'Iria', x: 5, y: 10 },
      { id: 't-garrick', kind: 'enemy', group: 'garrick', name: 'Garrick', short: 'G', x: 9, y: 7, harm: 0 },
      { id: 't-m1', kind: 'enemy', group: 'matones', name: 'Matón 1', short: 'M1', x: 7, y: 9, harm: 0 },
      { id: 't-m2', kind: 'enemy', group: 'matones', name: 'Matón 2', short: 'M2', x: 10, y: 12, harm: 0 },
      { id: 't-m3', kind: 'enemy', group: 'matones', name: 'Matón 3', short: 'M3', x: 17, y: 3, harm: 0, hidden: true },
      { id: 't-brunilda', kind: 'neutral', npc: 'brunilda', name: 'Brunilda', short: 'B', x: 4, y: 2 },
      { id: 't-odo', kind: 'neutral', npc: 'odo', name: 'Hermano Odo', short: 'O', x: 14, y: 8 },
    ];
  }

  const ORDER = [
    { ref: { kind: 'npc', group: 'garrick' }, name: 'Garrick', init: 10, dice: [3, 4], bonus: 3 },
    { ref: { kind: 'character', id: 'kael' }, name: 'Kael', init: 9, dice: [2, 4], bonus: 3 },
    { ref: { kind: 'npc', group: 'matones' }, name: 'Matones', init: 9, dice: [4, 4], bonus: 1 },
    { ref: { kind: 'character', id: 'mira' }, name: 'Mira', init: 8, dice: [1, 3], bonus: 4 },
    { ref: { kind: 'character', id: 'iria' }, name: 'Iria', init: 6, dice: [2, 2], bonus: 2 },
  ];

  const SCENE_TEXT =
    'La lluvia golpea los postigos. Dentro, el fuego de la chimenea tiñe de ámbar las vigas y huele a cerveza agria y a pan recién hecho. Brunilda seca jarras tras la barra sin quitar ojo a la puerta. En la mesa del rincón, un hombre encapuchado no ha tocado su cena.';

  /** El registro hasta antes del combate: la escena, la palabra, un PNJ y un robo en secreto. */
  function narrationEvents() {
    return [
      { id: 1, at: '20:31', kind: 'opened', vis: 'public', number: 2 },
      { id: 2, at: '20:32', kind: 'scene', vis: 'public', title: 'El Ciervo Blanco' },
      { id: 3, at: '20:33', kind: 'reveal', vis: 'public', title: 'El Ciervo Blanco', body: SCENE_TEXT },
      { id: 4, at: '20:35', kind: 'floor', vis: 'public', floor: { kind: 'table' } },
      { id: 5, at: '20:36', kind: 'intervention', vis: 'public', char: 'kael', intent: 'talk', text: '¿Quién es el encapuchado de la esquina?' },
      { id: 6, at: '20:37', kind: 'speech', vis: 'public', npc: 'brunilda', text: 'Ese, corazón, es Garrick. Paga bien y no da problemas… siempre que nadie le pregunte por el barón.', answers: 5 },
      { id: 7, at: '20:39', kind: 'intervention', vis: 'private', player: 'mira', char: 'mira', intent: 'act', text: 'Le robo la bolsa al monje mientras todos miran a Garrick.' },
      { id: 8, at: '20:40', kind: 'rollRequest', vis: 'private', player: 'mira', char: 'mira', what: 'Juego de manos', target: 'Normal (10)', answers: 7 },
      {
        id: 9, at: '20:41', kind: 'roll', vis: 'private', player: 'mira', actor: 'Mira', char: 'mira', what: 'Juego de manos',
        situation: 'test', targetLabel: 'Normal (10)', requested: 8, bonus: 6, edge: 'none', target: { difficulty: 10 },
        result: { dice: { rolled: [5, 4], kept: [4, 5] }, bonus: 6, total: 15, goal: 10, margin: 5, rival: null, outcome: 'success', edge: 'none' },
      },
      { id: 10, at: '20:43', kind: 'note', vis: 'master', text: 'Garrick sabe que el hijo del barón está aquí. Si lo provocan, pelea.' },
      { id: 11, at: '20:44', kind: 'intervention', vis: 'public', char: 'iria', intent: 'ask', text: '¿Hay algo raro en el suelo de la cocina?' },
      { id: 12, at: '20:45', kind: 'intervention', vis: 'public', char: 'kael', intent: 'attack', text: 'Le lanzo la jarra a Garrick.' },
    ];
  }

  /** El registro con el combate empezado: Garrick ya ha golpeado a Kael y le toca a él. */
  function combatEvents() {
    return [
      ...narrationEvents().filter((e) => e.id !== 11),
      { id: 13, at: '20:46', kind: 'combatStarted', vis: 'public', order: ORDER, answers: 12 },
      { id: 14, at: '20:46', kind: 'turn', vis: 'public', round: 1, name: 'Garrick' },
      {
        id: 15, at: '20:47', kind: 'roll', vis: 'public', actor: 'Garrick', what: 'Ataque (veterano)', situation: 'melee',
        targetLabel: 'contra Kael, que para con su arma', blow: { from: 't-garrick', to: 'kael' }, bonus: 6, edge: 'none', target: { opposed: { bonus: 6 } },
        result: { dice: { rolled: [3, 4], kept: [3, 4] }, bonus: 6, total: 13, goal: 12, margin: 1, rival: { kept: [5, 1], bonus: 6, total: 12 }, outcome: 'partial', edge: 'none' },
      },
      {
        id: 16, at: '20:47', kind: 'damage', vis: 'public', roll: 15, to: 'Kael', by: 'Garrick',
        parts: [{ label: 'Garrick (veterano)', value: 2 }, { label: 'Cota de malla', value: -1 }], total: 1,
        after: 'Un rasguño (1 de 2)',
      },
      { id: 17, at: '20:48', kind: 'turn', vis: 'public', round: 1, name: 'Kael' },
      { id: 18, at: '20:48', kind: 'intervention', vis: 'public', char: 'mira', intent: 'ranged', text: 'Disparo al matón que bloquea la puerta.', target: { token: 't-m2', name: 'Matón 2' } },
    ];
  }

  const clone = (x) => JSON.parse(JSON.stringify(x));

  /** El estado de la sala en cada escenario del prototipo. */
  function scenario(name) {
    const chars = clone(CHARACTERS);
    if (name === 'combat') {
      chars.kael.wounds.scratches = 1;
      return {
        scenario: 'combat',
        chars,
        events: combatEvents(),
        nextId: 19,
        floor: { kind: 'character', id: 'kael' },
        combat: { round: 1, turn: 1, order: clone(ORDER) },
        tokens: tokens(),
        spent: {},
        stage: 'map',
        scene: 'El Ciervo Blanco',
        sceneText: SCENE_TEXT,
      };
    }
    return {
      scenario: 'narration',
      chars,
      events: narrationEvents(),
      nextId: 13,
      floor: { kind: 'table' },
      combat: null,
      tokens: tokens(),
      spent: {},
      stage: 'scene',
      scene: 'El Ciervo Blanco',
      sceneText: SCENE_TEXT,
    };
  }

  /** Respuestas de ejemplo de las dos IA: la que escribe (qwen) y la que decide (Nimble). */
  const AI = {
    describe:
      'El fuego crepita y una ráfaga de lluvia se cuela al abrirse la puerta. Por un instante, todas las conversaciones se apagan. Garrick deja la jarra sobre la mesa sin hacer ruido y apoya la mano en la empuñadura. Desde la barra, Brunilda os mira con un ruego mudo: aquí no.',
    npc: {
      brunilda: [
        '¿El sótano, corazón? Ahí abajo solo hay ratas y vino agrio. Nada que os interese.',
        'Mirad, yo no me meto en asuntos de nobles. Pagad la cena y dormid tranquilos.',
        'Si el barón quiere algo, que venga él mismo a pedirlo. Y que se limpie las botas.',
      ],
      garrick: [
        'Siéntate. No he venido a por ti, mercenario.',
        'El chico vale más vivo que muerto. Eso es lo único que me importa.',
        'Hubo un tiempo en que yo también llevaba los colores del barón. Mira de lo que me sirvió.',
      ],
      odo: [
        'Dice el proverbio: quien guarda la bodega, guarda también los secretos.',
        'Solo soy un pobre monje de paso, hija. Mi bolsa apenas tiene para pan.',
      ],
    },
    ideas: [
      'Se oye un golpe seco bajo el suelo de la cocina, como si alguien hubiera tirado una caja.',
      'El hermano Odo se levanta y pide a Brunilda, en voz demasiado alta, «una vela para bajar a la bodega».',
      'Dos jinetes con los colores del barón desmontan en el patio y preguntan por la posadera.',
    ],
    blow: [
      'La espada de Kael encuentra el hueco bajo el brazo del matón, que se dobla y cae sobre la mesa entre jarras rotas.',
      'Kael carga con el hombro por delante y la hoja hace el resto: el matón suelta el garrote y se desploma.',
      'Un tajo corto, sin adornos. El matón da dos pasos atrás, mira la sangre en su mano y se derrumba.',
    ],
    enemies: [
      'Garrick retrocede hacia la cocina gritando a sus hombres que cubran la puerta.',
      'Garrick va a por Iria: sabe que la hechicera es la más peligrosa.',
      'Garrick vuelca una mesa para cubrirse y saca un cuchillo arrojadizo.',
    ],
    targets: [
      { id: 'iria', p: 0.54 },
      { id: 'kael', p: 0.31 },
      { id: 'mira', p: 0.15 },
    ],
    check: [
      { skill: 'marksmanship', p: 0.82 },
      { skill: 'perception', p: 0.1 },
      { skill: 'athletics', p: 0.04 },
    ],
  };

  DC.data = { CAMPAIGNS, PLAYERS, CHARACTERS, NPCS, GAMES, MAPS, MAP_LIBRARY, GROUPS, ORDER, AI, scenario, clone };
})();
