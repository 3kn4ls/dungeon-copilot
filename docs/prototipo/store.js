// Estado del prototipo: hace de servidor. Todo lo que pasa en la sala es un evento del registro,
// como en apps/server, y las tres vistas (máster, jugador, pantalla) leen el mismo estado.
(function () {
  const DC = (window.DC = window.DC || {});
  const R = DC.rules;
  const D = DC.data;

  function initial(name = 'combat') {
    return {
      role: 'master',
      route: { name: 'room' },
      playerChar: 'kael',
      dock: { tab: 'reveal', keys: {}, presets: {} },
      selected: null,
      target: null,
      toasts: [],
      clock: 20 * 60 + 49,
      ...D.scenario(name),
    };
  }

  let state = initial();
  const listeners = new Set();
  const subscribe = (l) => (listeners.add(l), () => listeners.delete(l));
  function set(fn) {
    state = typeof fn === 'function' ? { ...state, ...fn(state) } : { ...state, ...fn };
    listeners.forEach((l) => l());
  }
  const get = () => state;
  const useStore = () => React.useSyncExternalStore(subscribe, get);

  const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  /** Añade un evento al registro, como addEvent en el servidor. */
  function addEvent(ev) {
    let made;
    set((s) => {
      made = { vis: 'public', ...ev, id: s.nextId, at: hhmm(s.clock) };
      return { events: [...s.events, made], nextId: s.nextId + 1, clock: s.clock + 1 };
    });
    return made;
  }

  // --- Lo que se deriva del registro ----------------------------------------------------------

  const answeredIds = (events) => {
    const ids = new Set();
    for (const e of events) {
      if (e.answers !== undefined) ids.add(e.answers);
      if (e.kind === 'settled') ids.add(e.of);
      if (e.kind === 'roll' && e.requested !== undefined) ids.add(e.requested);
    }
    return ids;
  };
  const pendingInterventions = (events) => {
    const done = answeredIds(events);
    return events.filter((e) => e.kind === 'intervention' && !done.has(e.id));
  };
  const pendingRequests = (events) => {
    const done = answeredIds(events);
    return events.filter((e) => e.kind === 'rollRequest' && !done.has(e.id));
  };
  const supersededRolls = (events) => new Set(events.filter((e) => e.kind === 'roll' && e.reroll).map((e) => e.reroll));
  const blowsOf = (events, rollId) => events.filter((e) => e.kind === 'damage' && e.roll === rollId);

  /** Lo que ve cada uno: el máster todo; un jugador lo público y lo suyo; la pantalla solo lo público. */
  function visibleTo(events, viewer) {
    if (viewer === 'master') return events;
    return events.filter((e) => e.vis === 'public' || (viewer !== 'screen' && e.vis === 'private' && e.player === viewer));
  }

  const turnOf = (combat) => (combat ? combat.order[combat.turn] : null);
  const groupTokens = (tokens, group) => tokens.filter((t) => t.group === group);
  const tokenOf = (s, ref) =>
    ref.kind === 'character' ? s.tokens.find((t) => t.char === ref.id) : s.tokens.find((t) => t.group === ref.group);

  /** Quién tiene la palabra: en combate, quien tiene el turno (los enemigos, el máster). */
  function floorHolder(s) {
    if (s.floor.kind === 'character') return s.chars[s.floor.id].name;
    return s.floor.kind === 'table' ? 'La mesa' : 'El máster';
  }

  // --- Acciones -----------------------------------------------------------------------------

  const act = {
    go: (route) => set({ route }),
    setRole: (role) => set({ role, route: { name: 'room' } }),
    reset: (name) => set((s) => ({ ...initial(name), role: s.role, route: s.route, playerChar: s.playerChar })),
    toast(text) {
      const id = Math.random();
      set((s) => ({ toasts: [...s.toasts, { id, text }] }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
    },
    openDock(tab, preset = null) {
      set((s) => ({ dock: { tab, keys: { ...s.dock.keys, [tab]: (s.dock.keys[tab] || 0) + 1 }, presets: { ...s.dock.presets, [tab]: preset } } }));
    },
    setDockTab: (tab) => set((s) => ({ dock: { ...s.dock, tab } })),
    setStage: (stage) => set({ stage }),
    select: (id) => set({ selected: id, target: null }),
    setTarget: (target) => set({ target }),

    giveFloor(floor, answers) {
      set({ floor });
      addEvent({ kind: 'floor', floor, answers });
    },
    settle(of, how) {
      addEvent({ kind: 'settled', of, how });
    },
    reveal({ title, body, to, answers }) {
      addEvent({ kind: 'reveal', title, body, vis: to ? 'private' : 'public', player: to, answers });
    },
    speech({ npc, text, to, answers }) {
      addEvent({ kind: 'speech', npc, text, vis: to ? 'private' : 'public', player: to, answers });
    },
    note: (text) => addEvent({ kind: 'note', text, vis: 'master' }),
    newScene(title, recover) {
      set((s) => {
        const chars = { ...s.chars };
        if (recover) for (const id in chars) chars[id] = { ...chars[id], wounds: { ...chars[id].wounds, scratches: 0 } };
        const spent = {};
        for (const id in s.spent) spent[id] = s.spent[id].filter((k) => R.SKILL[k].uses !== 'scene');
        return { chars, spent, scene: title, sceneText: '', stage: 'scene' };
      });
      addEvent({ kind: 'scene', title, recovered: recover });
    },

    intervene({ char, intent, text, secret, target }) {
      addEvent({ kind: 'intervention', char, intent, text, target, vis: secret ? 'private' : 'public', player: secret ? char : undefined });
    },

    /** Tira ya: los dados salen aquí, como en el servidor. */
    roll(spec) {
      const result = R.resolve({ bonus: spec.bonus, edge: spec.edge, target: spec.target });
      return addEvent({ kind: 'roll', ...spec, vis: spec.vis || 'public', result: { ...result, edge: spec.edge } });
    },
    requestRoll(spec) {
      addEvent({ kind: 'rollRequest', ...spec, vis: spec.vis || 'public' });
    },
    /** El jugador tira lo que le han pedido, con la ficha de este momento. */
    rollRequested(req) {
      act.roll({ ...req.spec, requested: req.id, vis: req.vis, player: req.player });
    },
    reroll(ev) {
      set((s) => ({ chars: { ...s.chars, [ev.char]: { ...s.chars[ev.char], luck: s.chars[ev.char].luck - 1 } } }));
      const { id, at, result, ...spec } = ev;
      act.roll({ ...spec, reroll: id, target: ev.target });
    },
    useAbility(char, skill) {
      set((s) => ({ spent: { ...s.spent, [char]: [...(s.spent[char] || []), skill] } }));
      addEvent({ kind: 'ability', char, skill });
    },

    /** Aplica un golpe a un personaje (su ficha) o a un enemigo del mapa (su grupo, uno a uno). */
    applyDamage({ roll, to, total, parts, by }) {
      const s = state;
      const token = s.tokens.find((t) => t.id === to || t.char === to);
      if (token && token.kind === 'pc') {
        const ch = s.chars[token.char];
        const w = R.applyWounds(ch.wounds, R.scratchBoxes(ch), total);
        set((st) => ({ chars: { ...st.chars, [ch.id]: { ...ch, wounds: { scratches: w.scratches, severity: w.severity } } } }));
        const after = w.severity === 'none' ? `Rasguños: ${w.scratches} de ${R.scratchBoxes(ch)}` : R.SEVERITY_LABELS[w.severity];
        addEvent({ kind: 'damage', roll, to: ch.name, by, parts, total, after, lethal: w.lethal });
        return;
      }
      const group = D.GROUPS[token.group];
      const profile = R.PROFILES[group.profile];
      const harm = token.harm + total;
      const down = harm >= profile.endures;
      set((st) => ({ tokens: st.tokens.map((t) => (t.id === token.id ? { ...t, harm, down } : t)) }));
      addEvent({
        kind: 'damage', roll, to: token.name, by, parts, total,
        after: down ? 'Cae' : `Lleva ${harm} de ${profile.endures}`,
        afterPublic: down ? 'Cae' : 'Queda herido',
      });
      const left = groupTokens(state.tokens, token.group).filter((t) => !t.down);
      if (down && left.length === 0 && state.combat) act.leaveCombat({ kind: 'npc', group: token.group }, group.name);
    },

    // --- Combate ---
    startCombat(answers) {
      const s = state;
      const entries = [];
      for (const ch of Object.values(s.chars)) {
        const r = R.rollDice('none');
        entries.push({ ref: { kind: 'character', id: ch.id }, name: ch.name, dice: r.kept, bonus: ch.attrs.dexterity, init: r.kept[0] + r.kept[1] + ch.attrs.dexterity, pc: 1 });
      }
      for (const g of Object.values(D.GROUPS)) {
        const r = R.rollDice('none');
        const dex = R.PROFILES[g.profile].dex;
        entries.push({ ref: { kind: 'npc', group: g.id }, name: g.name, dice: r.kept, bonus: dex, init: r.kept[0] + r.kept[1] + dex, pc: 0 });
      }
      entries.sort((a, b) => b.init - a.init || b.pc - a.pc || b.bonus - a.bonus);
      const combat = { round: 1, turn: 0, order: entries };
      set({ combat, stage: 'map', tokens: s.tokens.map((t) => ({ ...t, harm: 0, down: false })) });
      addEvent({ kind: 'combatStarted', order: entries, answers });
      act.enterTurn();
    },
    enterTurn() {
      const c = state.combat;
      const who = c.order[c.turn];
      set({ floor: who.ref.kind === 'character' ? { kind: 'character', id: who.ref.id } : { kind: 'master' }, selected: tokenOf(state, who.ref)?.id || null, target: null });
      addEvent({ kind: 'turn', round: c.round, name: who.name });
    },
    nextTurn() {
      set((s) => {
        let { round, turn } = s.combat;
        turn += 1;
        if (turn >= s.combat.order.length) {
          turn = 0;
          round += 1;
        }
        return { combat: { ...s.combat, round, turn } };
      });
      act.enterTurn();
    },
    leaveCombat(ref, name) {
      const c = state.combat;
      const index = c.order.findIndex((o) => o.ref.kind === ref.kind && (o.ref.id || o.ref.group) === (ref.id || ref.group));
      if (index < 0) return;
      const order = c.order.filter((_, i) => i !== index);
      const wasTurn = index === c.turn;
      let turn = index < c.turn ? c.turn - 1 : c.turn;
      if (turn >= order.length) turn = 0;
      set({ combat: { ...c, order, turn } });
      addEvent({ kind: 'combatLeft', name });
      if (order.length === 0) return act.endCombat(false);
      if (wasTurn) act.enterTurn();
    },
    endCombat(recover) {
      set((s) => {
        const chars = { ...s.chars };
        if (recover) for (const id in chars) chars[id] = { ...chars[id], wounds: { ...chars[id].wounds, scratches: 0 } };
        return { combat: null, chars, floor: { kind: 'master' } };
      });
      addEvent({ kind: 'combatEnded', recovered: recover });
    },
    moveToken: (id, x, y) => set((s) => ({ tokens: s.tokens.map((t) => (t.id === id ? { ...t, x, y } : t)) })),
    toggleHidden: (id) => set((s) => ({ tokens: s.tokens.map((t) => (t.id === id ? { ...t, hidden: !t.hidden } : t)) })),
  };

  DC.store = {
    useStore, get, set, act, addEvent, initial,
    pendingInterventions, pendingRequests, supersededRolls, blowsOf, visibleTo, turnOf, groupTokens, tokenOf, floorHolder,
  };
})();
