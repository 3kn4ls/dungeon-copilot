// El mapa alimenta las reglas: distancia, línea de visión y cobertura salen de dónde está cada uno.
(function () {
  const DC = (window.DC = window.DC || {});
  const R = DC.rules;
  const D = DC.data;

  const CELL_M = 1.5;
  const key = (x, y) => `${x},${y}`;

  function cellsOf(map) {
    const walls = new Set();
    for (const [x0, y0, w, h] of map.walls) for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) walls.add(key(x, y));
    for (const d of map.doors) for (let x = d.x; x < d.x + d.w; x++) for (let y = d.y; y < d.y + d.h; y++) walls.delete(key(x, y));
    const cover = new Set();
    const blocked = new Set(walls);
    for (const f of map.furniture) {
      for (let x = f.x; x < f.x + f.w; x++)
        for (let y = f.y; y < f.y + f.h; y++) {
          if (f.cover) cover.add(key(x, y));
          if (f.kind !== 'trapdoor' && f.kind !== 'stairs') blocked.add(key(x, y));
        }
    }
    return { walls, cover, blocked };
  }

  const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const rangeOf = (d) => (d <= 6 ? 'short' : d <= 12 ? 'medium' : 'long');

  /** Recorre la línea entre los centros: un muro la corta y un mueble da cobertura parcial. */
  function lineOfSight(map, a, b) {
    const { walls, cover } = cellsOf(map);
    const ax = a.x + 0.5, ay = a.y + 0.5, bx = b.x + 0.5, by = b.y + 0.5;
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 10);
    let covered = null;
    for (let i = 1; i < steps; i++) {
      const x = Math.floor(ax + ((bx - ax) * i) / steps);
      const y = Math.floor(ay + ((by - ay) * i) / steps);
      if ((x === a.x && y === a.y) || (x === b.x && y === b.y)) continue;
      if (walls.has(key(x, y))) return { clear: false, cover: false };
      if (cover.has(key(x, y)) && !covered) covered = map.furniture.find((f) => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h);
    }
    return { clear: true, cover: !!covered, coverName: covered ? covered.label || (covered.kind === 'table' ? 'una mesa' : covered.kind === 'barrel' ? 'unos barriles' : 'un mueble') : null };
  }

  const profileOf = (token) => (token.group ? R.PROFILES[D.GROUPS[token.group].profile] : null);

  /** Todo lo que el mapa sabe de un ataque de `from` a `to`, y la tirada ya preparada. */
  function analyze(s, from, to) {
    const map = D.MAPS.ciervo;
    const dist = distance(from, to);
    const los = lineOfSight(map, from, to);
    const range = rangeOf(dist);
    const adjacent = dist <= 1;
    const out = { dist, meters: dist * CELL_M, range, adjacent, los, presets: [] };
    if (!los.clear && !adjacent) return out;

    if (from.kind === 'pc') {
      const ch = s.chars[from.char];
      const prof = profileOf(to);
      if (!prof) return out;
      if (adjacent) {
        const atk = R.meleeAttack(ch);
        out.presets.push({
          label: `Cuerpo a cuerpo con ${ch.gear.melee.name}`,
          icon: 'sword',
          who: { kind: 'char', id: ch.id },
          situation: 'melee',
          skill: atk.skill,
          target: { kind: 'opposed', bonus: prof.bonus, label: `contra ${to.name} (${prof.label} ${R.signed(prof.bonus)})` },
          blow: { from: from.id, to: to.id },
        });
      }
      if (ch.gear.ranged && !adjacent) {
        const diff = R.rangedDifficulty({ targetDex: prof.dex, range, cover: los.cover, shield: false, deadeye: R.has(ch, 'deadeye') });
        out.presets.push({
          label: `Disparar con ${ch.gear.ranged.name}`,
          icon: 'bow',
          who: { kind: 'char', id: ch.id },
          situation: 'ranged',
          skill: 'marksmanship',
          target: { kind: 'difficulty', value: diff.value, parts: diff.parts, label: `${to.name}, a distancia ${R.RANGES[range].label.toLowerCase()}${los.cover ? ', a cubierto' : ''}` },
          blow: { from: from.id, to: to.id },
        });
      }
      if (R.has(ch, 'sorcery')) {
        out.presets.push({
          label: 'Lanzar un hechizo',
          icon: 'spark',
          who: { kind: 'char', id: ch.id },
          situation: 'test',
          skill: 'arcana',
          target: { kind: 'difficulty', value: 10, label: 'Efecto moderado (10)' },
        });
      }
      return out;
    }

    if (from.kind === 'enemy' && to.kind === 'pc') {
      const prof = profileOf(from);
      const ch = s.chars[to.char];
      if (adjacent) {
        const def = R.meleeDefense(ch);
        out.presets.push({
          label: `${from.name} ataca a ${ch.name}`,
          icon: 'sword',
          who: { kind: 'group', id: from.group, token: from.id },
          situation: 'melee',
          target: { kind: 'opposed', bonus: def.bonus, edges: def.edges, label: `contra ${ch.name}, que ${def.how.toLowerCase()} (${R.signed(def.bonus)})` },
          blow: { from: from.id, to: ch.id },
        });
      } else {
        const diff = R.rangedDifficulty({ targetDex: ch.attrs.dexterity, range, cover: los.cover, shield: ch.gear.shield });
        out.presets.push({
          label: `${from.name} dispara a ${ch.name}`,
          icon: 'bow',
          who: { kind: 'group', id: from.group, token: from.id },
          situation: 'ranged',
          target: { kind: 'difficulty', value: diff.value, parts: diff.parts, label: `${ch.name}, a distancia ${R.RANGES[range].label.toLowerCase()}${los.cover ? ', a cubierto' : ''}` },
          blow: { from: from.id, to: ch.id },
        });
      }
    }
    return out;
  }

  /** Bonificador y etiqueta de quien tira, con la ficha de ahora. */
  function actorCheck(s, who, skill, situation) {
    if (who.kind === 'char') {
      const ch = s.chars[who.id];
      const c = situation === 'melee' ? R.meleeAttack(ch) : R.checkFor(ch, skill);
      return { name: ch.name, char: ch.id, bonus: c.bonus, parts: c.parts, edges: c.edges, what: R.SKILL[situation === 'melee' ? c.skill : skill]?.label || 'Atributo' };
    }
    if (who.kind === 'group') {
      const g = D.GROUPS[who.id];
      const prof = R.PROFILES[g.profile];
      const token = s.tokens.find((t) => t.id === who.token);
      return { name: token ? token.name : g.name, bonus: prof.bonus, parts: [{ label: prof.label, value: prof.bonus }], edges: [], what: `Ataque (${prof.label.toLowerCase()})` };
    }
    return { name: 'Tirada libre', bonus: who.bonus || 0, parts: [{ label: 'Bonificador', value: who.bonus || 0 }], edges: [], what: 'Tirada libre' };
  }

  /** El golpe de un impacto: arma (o perfil) + crítico − armadura del objetivo. */
  function blowDamage(s, blow, outcome, situation) {
    const from = s.tokens.find((t) => t.id === blow.from) || s.tokens.find((t) => t.char === blow.from);
    const to = s.tokens.find((t) => t.id === blow.to) || s.tokens.find((t) => t.char === blow.to);
    if (!from || !to) return null;
    let weapon;
    if (from.kind === 'pc') {
      const ch = s.chars[from.char];
      const w = situation === 'ranged' && ch.gear.ranged ? ch.gear.ranged : ch.gear.melee;
      weapon = { label: `${w.name} (${R.WEAPONS[w.class].label})`, damage: R.WEAPONS[w.class].damage };
    } else {
      const prof = profileOf(from);
      weapon = { label: `${from.name} (${prof.label.toLowerCase()})`, damage: prof.damage };
    }
    let armor = null;
    if (to.kind === 'pc') {
      const a = s.chars[to.char].gear.armor;
      armor = { label: a.name, reduction: R.ARMORS[a.class].reduction };
    }
    return { ...R.hitDamage({ weapon, outcome, armor }), from, to };
  }

  DC.tactics = { cellsOf, distance, rangeOf, lineOfSight, analyze, actorCheck, blowDamage, CELL_M };
})();
