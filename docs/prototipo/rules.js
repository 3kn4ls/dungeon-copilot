// Motor de reglas del prototipo: una copia mínima de packages/rules (2d6 + atributo + habilidad).
(function () {
  const DC = (window.DC = window.DC || {});

  const ATTRS = ['strength', 'dexterity', 'charisma', 'intelligence', 'endurance'];
  const ATTR_INFO = {
    strength: { label: 'Fuerza', abbr: 'FUE' },
    dexterity: { label: 'Destreza', abbr: 'DES' },
    charisma: { label: 'Carisma', abbr: 'CAR' },
    intelligence: { label: 'Inteligencia', abbr: 'INT' },
    endurance: { label: 'Aguante', abbr: 'AGU' },
  };

  const BASIC = [
    ['athletics', 'Atletismo', 'strength'],
    ['melee-weapons', 'Armas cuerpo a cuerpo', 'strength'],
    ['brawl', 'Pelea', 'strength'],
    ['fencing', 'Esgrima', 'dexterity'],
    ['marksmanship', 'Puntería', 'dexterity'],
    ['acrobatics', 'Acrobacias', 'dexterity'],
    ['stealth', 'Sigilo', 'dexterity'],
    ['sleight-of-hand', 'Juego de manos', 'dexterity'],
    ['persuasion', 'Persuasión', 'charisma'],
    ['deception', 'Engaño', 'charisma'],
    ['intimidation', 'Intimidación', 'charisma'],
    ['performance', 'Interpretación', 'charisma'],
    ['perception', 'Percepción', 'intelligence'],
    ['lore', 'Saber', 'intelligence'],
    ['medicine', 'Medicina', 'intelligence'],
    ['arcana', 'Arcano', 'intelligence'],
    ['resilience', 'Resistencia', 'endurance'],
    ['willpower', 'Voluntad', 'endurance'],
    ['survival', 'Supervivencia', 'endurance'],
  ].map(([id, label, attr]) => ({ id, label, attr }));

  // [id, nombre, atributo, mínimo, habilidad, rango, usos, qué hace]
  const ADVANCED = [
    ['crushing-blow', 'Golpe demoledor', 'strength', 4, 'melee-weapons', 2, null, 'Con un arma pesada, un éxito pleno o crítico hace +1 de daño y derriba al rival.'],
    ['iron-grip', 'Presa de hierro', 'strength', 3, 'brawl', 2, null, 'Quien está en tu presa tiene desventaja para soltarse.'],
    ['brutal-charge', 'Carga brutal', 'strength', 3, null, 0, null, 'Si corres hacia el rival antes de atacar, tienes ventaja; hasta tu turno te defiendes con desventaja.'],
    ['deadeye', 'Disparo certero', 'dexterity', 4, 'marksmanship', 2, null, 'Ignoras la cobertura parcial y la distancia media.'],
    ['sneak-attack', 'Ataque furtivo', 'dexterity', 3, 'stealth', 2, null, 'Contra un rival que no te ha visto venir, +2 de daño.'],
    ['uncanny-dodge', 'Esquiva prodigiosa', 'dexterity', 4, 'acrobatics', 2, 'scene', 'Cuando te impactan, el daño se queda en 1.'],
    ['commanding-voice', 'Voz de mando', 'charisma', 4, 'persuasion', 2, 'scene', 'Un aliado que te oiga tiene ventaja en su siguiente tirada.'],
    ['dreadful-presence', 'Presencia aterradora', 'charisma', 3, 'intimidation', 2, null, 'Con un éxito pleno al intimidar, los esbirros huyen o se rinden.'],
    ['silver-tongue', 'Lengua de plata', 'charisma', 4, 'deception', 2, 'session', 'Repites una tirada fallida de Persuasión o Engaño sin gastar Suerte.'],
    ['tactician', 'Táctico', 'intelligence', 4, 'perception', 2, null, 'Tu bando tira la iniciativa con ventaja.'],
    ['scholar', 'Erudito', 'intelligence', 3, 'lore', 2, 'session', 'Una pregunta al máster sobre el mundo, y te responde con la verdad.'],
    ['sorcery', 'Hechicería', 'intelligence', 4, 'arcana', 2, null, 'Puedes lanzar hechizos: Inteligencia + Arcano contra el efecto.'],
    ['tough', 'Duro de pelar', 'endurance', 3, 'resilience', 2, null, 'Una casilla de rasguño más.'],
    ['armor-training', 'Entrenamiento con armaduras', 'endurance', 3, null, 0, null, 'La armadura pesada no te estorba en Sigilo ni Acrobacias.'],
    ['unstoppable', 'Imparable', 'endurance', 4, 'willpower', 2, 'session', 'Ignoras la desventaja de una herida grave; aguantas en pie un turno más.'],
  ].map(([id, label, attr, min, skill, rank, uses, text]) => ({ id, label, attr, min, skill, rank, uses, text }));

  const SKILL = Object.fromEntries([...BASIC, ...ADVANCED].map((s) => [s.id, s]));

  const DIFFICULTIES = [
    ['easy', 'Fácil', 8],
    ['normal', 'Normal', 10],
    ['hard', 'Difícil', 12],
    ['veryHard', 'Muy difícil', 14],
    ['heroic', 'Heroica', 16],
  ].map(([id, label, value]) => ({ id, label, value }));

  const OUTCOMES = ['fumble', 'failure', 'partial', 'success', 'critical'];
  const OUTCOME_LABELS = {
    fumble: 'Pifia',
    failure: 'Fallo',
    partial: 'Éxito con coste',
    success: 'Éxito pleno',
    critical: 'Crítico',
  };
  const OUTCOME_GUIDES = {
    test: {
      critical: 'Lo consigue de forma brillante y además obtiene algo extra.',
      success: 'Lo consigue sin complicaciones.',
      partial: 'Lo consigue, pero con un coste: tarde, con ruido o con una complicación nueva.',
      failure: 'No lo consigue y la situación empeora.',
      fumble: 'Falla estrepitosamente y aparece un problema serio.',
    },
    melee: {
      critical: 'Impacta con +1 de daño y elige: derribar, desarmar o empujar.',
      success: 'Impacta.',
      partial: 'Impacta, pero el máster elige un coste: un golpe de vuelta, mala posición o perder algo.',
      failure: 'No impacta y el rival puede tener ventaja.',
      fumble: 'No impacta y queda expuesto: el rival le golpea o pierde el arma.',
    },
    ranged: {
      critical: 'Impacta con +1 de daño.',
      success: 'Impacta.',
      partial: 'Impacta, pero queda al descubierto o hace 1 de daño menos.',
      failure: 'Falla.',
      fumble: 'Se rompe la cuerda o casi alcanza a un aliado.',
    },
  };
  const SITUATIONS = { test: 'Prueba', melee: 'Cuerpo a cuerpo', ranged: 'A distancia' };
  const EDGES = { disadvantage: 'Desventaja', none: 'Normal', advantage: 'Ventaja' };

  const PROFILES = {
    minion: { label: 'Esbirro', bonus: 2, dex: 1, endures: 1, damage: 1 },
    soldier: { label: 'Soldado', bonus: 4, dex: 2, endures: 3, damage: 2 },
    veteran: { label: 'Veterano', bonus: 6, dex: 3, endures: 4, damage: 2 },
    champion: { label: 'Campeón', bonus: 8, dex: 4, endures: 6, damage: 3 },
  };
  const WEAPONS = { light: { label: 'ligera', damage: 1 }, medium: { label: 'media', damage: 2 }, heavy: { label: 'pesada', damage: 3 } };
  const ARMORS = { none: { label: 'sin armadura', reduction: 0 }, light: { label: 'ligera', reduction: 1 }, heavy: { label: 'pesada', reduction: 2 } };
  const SEVERITY = ['none', 'wounded', 'serious', 'out'];
  const SEVERITY_LABELS = { none: 'Sin heridas', wounded: 'Herido', serious: 'Grave', out: 'Fuera de combate' };
  const RANGES = { short: { label: 'Corta', mod: 0 }, medium: { label: 'Media', mod: 2 }, long: { label: 'Larga', mod: 4 } };

  // --- Dados ---------------------------------------------------------------------------------

  /** Las parejas que cuentan y su probabilidad: 2d6, o 3d6 quedándose con las dos mejores o peores. */
  const keptCache = {};
  function keptDist(edge) {
    if (keptCache[edge]) return keptCache[edge];
    const dist = new Map();
    const add = (pair, p) => {
      const key = pair.join(',');
      dist.set(key, (dist.get(key) || 0) + p);
    };
    for (let a = 1; a <= 6; a++)
      for (let b = 1; b <= 6; b++) {
        if (edge === 'none') add([a, b].sort(), 1 / 36);
        else
          for (let c = 1; c <= 6; c++) {
            const sorted = [a, b, c].sort((x, y) => x - y);
            add(edge === 'advantage' ? sorted.slice(1) : sorted.slice(0, 2), 1 / 216);
          }
      }
    keptCache[edge] = [...dist].map(([key, p]) => ({ dice: key.split(',').map(Number), p }));
    return keptCache[edge];
  }

  const doublesShift = ([a, b]) => (a === 6 && b === 6 ? 1 : a === 1 && b === 1 ? -1 : 0);
  const fromMargin = (m) => (m >= 3 ? 3 : m >= 0 ? 2 : 1);
  const clampStep = (s) => Math.max(0, Math.min(4, s));

  /**
   * Probabilidad de cada resultado. `target` es { difficulty } o { opposed: { bonus, edge } }:
   * en la enfrentada los empates son de quien actúa y los dobles del rival cuentan al revés.
   */
  function odds({ bonus, edge = 'none', target }) {
    const out = Object.fromEntries(OUTCOMES.map((o) => [o, 0]));
    for (const mine of keptDist(edge)) {
      const total = mine.dice[0] + mine.dice[1] + bonus;
      if (target.difficulty !== undefined) {
        const step = clampStep(fromMargin(total - target.difficulty) + doublesShift(mine.dice));
        out[OUTCOMES[step]] += mine.p;
      } else {
        for (const theirs of keptDist(target.opposed.edge || 'none')) {
          const rival = theirs.dice[0] + theirs.dice[1] + target.opposed.bonus;
          const step = clampStep(fromMargin(total - rival) + doublesShift(mine.dice) - doublesShift(theirs.dice));
          out[OUTCOMES[step]] += mine.p * theirs.p;
        }
      }
    }
    out.successChance = out.partial + out.success + out.critical;
    return out;
  }

  const die = () => 1 + Math.floor(Math.random() * 6);
  function rollDice(edge = 'none') {
    const rolled = edge === 'none' ? [die(), die()] : [die(), die(), die()];
    const sorted = [...rolled].sort((a, b) => a - b);
    const kept = edge === 'none' ? sorted : edge === 'advantage' ? sorted.slice(1) : sorted.slice(0, 2);
    return { rolled, kept };
  }

  /** Una tirada de verdad: los dados de quien tira y, si es enfrentada, los del rival. */
  function resolve({ bonus, edge = 'none', target }) {
    const mine = rollDice(edge);
    const total = mine.kept[0] + mine.kept[1] + bonus;
    let goal, rival = null, shift = doublesShift(mine.kept);
    if (target.difficulty !== undefined) goal = target.difficulty;
    else {
      const theirs = rollDice(target.opposed.edge || 'none');
      goal = theirs.kept[0] + theirs.kept[1] + target.opposed.bonus;
      rival = { ...theirs, bonus: target.opposed.bonus, total: goal };
      shift -= doublesShift(theirs.kept);
    }
    const margin = total - goal;
    const outcome = OUTCOMES[clampStep(fromMargin(margin) + shift)];
    return { dice: mine, bonus, edge, total, goal, margin, rival, outcome, success: ['partial', 'success', 'critical'].includes(outcome) };
  }

  // --- Personajes ----------------------------------------------------------------------------

  const has = (ch, skill) => ch.advanced.includes(skill);
  const scratchBoxes = (ch) => ch.attrs.endurance + (has(ch, 'tough') ? 1 : 0);

  /** Bonificador y ventaja de un personaje con un atributo y una habilidad, con sus heridas y su equipo. */
  function checkFor(ch, skillId, attrOverride) {
    const skill = SKILL[skillId];
    const attr = attrOverride || (skill ? skill.attr : 'dexterity');
    const rank = skill ? ch.skills[skillId] || 0 : 0;
    const parts = [
      { label: ATTR_INFO[attr].label, value: ch.attrs[attr] },
      ...(skill ? [{ label: skill.label, value: rank }] : []),
    ];
    const edges = [];
    if (ch.wounds.severity === 'serious' && ['strength', 'dexterity', 'endurance'].includes(attr) && !has(ch, 'unstoppable'))
      edges.push({ edge: 'disadvantage', why: 'Herida grave' });
    if (ch.gear.armor.class === 'heavy' && ['stealth', 'acrobatics'].includes(skillId) && !has(ch, 'armor-training'))
      edges.push({ edge: 'disadvantage', why: 'Armadura pesada' });
    return { bonus: parts.reduce((s, p) => s + p.value, 0), parts, edges };
  }

  /** Ataque cuerpo a cuerpo: ligeras con Esgrima, medias y pesadas con Armas cuerpo a cuerpo. */
  function meleeAttack(ch) {
    const light = ch.gear.melee.class === 'light';
    const check = checkFor(ch, light ? 'fencing' : 'melee-weapons');
    if (ch.gear.melee.class === 'heavy' && ch.attrs.strength < 3) check.edges.push({ edge: 'disadvantage', why: 'Arma pesada sin Fuerza 3' });
    return { ...check, skill: light ? 'fencing' : 'melee-weapons' };
  }

  /** La mejor defensa: parar con el arma (el escudo suma) o esquivar con Acrobacias. */
  function meleeDefense(ch) {
    const parry = meleeAttack(ch);
    const parryBonus = parry.bonus + (ch.gear.shield ? 1 : 0);
    const dodge = checkFor(ch, 'acrobatics');
    return dodge.bonus > parryBonus
      ? { how: 'Esquiva con Acrobacias', bonus: dodge.bonus, edges: dodge.edges }
      : { how: ch.gear.shield ? 'Para con arma y escudo' : 'Para con su arma', bonus: parryBonus, edges: parry.edges };
  }

  function rangedDifficulty({ targetDex, range, cover, shield, deadeye }) {
    const parts = [{ label: 'Base', value: 6 }, { label: 'Destreza del objetivo', value: targetDex }];
    const r = deadeye && range === 'medium' ? 0 : RANGES[range].mod;
    if (r) parts.push({ label: `Distancia ${RANGES[range].label.toLowerCase()}`, value: r });
    if (cover && !deadeye) parts.push({ label: 'Cobertura parcial', value: 2 });
    if (shield) parts.push({ label: 'Escudo', value: 1 });
    return { value: parts.reduce((s, p) => s + p.value, 0), parts };
  }

  /** El golpe: arma + crítico − armadura, al menos 1. */
  function hitDamage({ weapon, outcome, armor, extras = [] }) {
    const parts = [{ label: weapon.label, value: weapon.damage }];
    if (outcome === 'critical') parts.push({ label: 'Crítico', value: 1 });
    parts.push(...extras);
    if (armor && armor.reduction) parts.push({ label: armor.label, value: -armor.reduction });
    const raw = parts.reduce((s, p) => s + p.value, 0);
    return { parts, total: Math.max(1, raw) };
  }

  /** Aplica daño a unas heridas: primero los rasguños y luego, punto a punto, la herida empeora. */
  function applyWounds(wounds, boxes, amount) {
    let { scratches, severity } = wounds;
    let level = SEVERITY.indexOf(severity);
    let lethal = false;
    for (let i = 0; i < amount; i++) {
      if (scratches < boxes) scratches++;
      else if (level < 3) level++;
      else lethal = true;
    }
    return { scratches, severity: SEVERITY[level], lethal };
  }

  const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
  const pct = (p) => (p > 0.995 && p < 1 ? '>99 %' : p > 0 && p < 0.005 ? '<1 %' : `${Math.round(p * 100)} %`);

  DC.rules = {
    ATTRS, ATTR_INFO, BASIC, ADVANCED, SKILL, DIFFICULTIES, OUTCOMES, OUTCOME_LABELS, OUTCOME_GUIDES,
    SITUATIONS, EDGES, PROFILES, WEAPONS, ARMORS, SEVERITY, SEVERITY_LABELS, RANGES,
    odds, resolve, rollDice, checkFor, meleeAttack, meleeDefense, rangedDifficulty, hitDamage,
    applyWounds, scratchBoxes, has, signed, pct,
  };
})();
