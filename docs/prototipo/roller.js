// Preparar una tirada: quién, con qué, contra qué, con qué ventaja y quién la ve. Con la
// probabilidad de cada resultado a la vista antes de tirar.
(function () {
  const DC = (window.DC = window.DC || {});
  const { useState, useEffect, useRef } = React;
  const { html, Icon, Seg, OddsBar, Avatar, Dice, Pill } = DC.ui;
  const R = DC.rules;
  const D = DC.data;
  const T = DC.tactics;
  const S = DC.store;
  const { edgeOf } = DC.map;

  function rivalsFor(s, who) {
    if (who.kind === 'char') {
      return [
        ...Object.values(D.GROUPS).map((g) => {
          const p = R.PROFILES[g.profile];
          return { id: 'g-' + g.id, label: `${g.name} (${p.label.toLowerCase()} ${R.signed(p.bonus)})`, name: g.name, bonus: p.bonus, edges: [] };
        }),
        ...Object.entries(R.PROFILES).map(([id, p]) => ({ id: 'p-' + id, label: `Un ${p.label.toLowerCase()} (${R.signed(p.bonus)})`, name: `un ${p.label.toLowerCase()}`, bonus: p.bonus, edges: [] })),
      ];
    }
    return Object.values(s.chars).map((ch) => {
      const d = R.meleeDefense(ch);
      return { id: 'c-' + ch.id, label: `${ch.name}: ${d.how.toLowerCase()} (${R.signed(d.bonus)})`, name: ch.name, bonus: d.bonus, edges: d.edges, char: ch.id };
    });
  }

  /** Lo que se guarda al tirar o al pedir la tirada. */
  function buildSpec(s, f) {
    const actor = T.actorCheck(s, f.who, f.skill, f.situation);
    const bonus = f.who.kind === 'group' && f.npcOther ? actor.bonus - 2 : actor.bonus;
    let target, targetLabel;
    if (f.targetKind === 'difficulty') {
      target = { difficulty: f.difficulty };
      const named = R.DIFFICULTIES.find((d) => d.value === f.difficulty);
      targetLabel = f.targetLabel || `${named ? named.label : 'Dificultad'} (${f.difficulty})`;
    } else {
      const rival = rivalsFor(s, f.who).find((r) => r.id === f.rival) || { bonus: f.rivalBonus || 0, name: 'el rival', edges: f.rivalEdges || [] };
      target = { opposed: { bonus: rival.bonus, edge: edgeOf(rival.edges) } };
      targetLabel = f.targetLabel || `contra ${rival.name}`;
    }
    const what = f.situation === 'ranged' && f.who.kind === 'char' ? 'Puntería' : f.who.kind === 'group' ? (f.npcOther ? 'Otra cosa (−2)' : actor.what) : actor.what;
    const vis = f.vis === 'private' && f.who.kind !== 'char' ? 'master' : f.vis;
    return {
      actor: actor.name,
      char: f.who.kind === 'char' ? f.who.id : undefined,
      what,
      who: f.who,
      skill: f.skill,
      situation: f.situation,
      bonus,
      edge: f.edge,
      target,
      targetLabel,
      blow: f.blow,
      answers: f.answers,
      vis,
      player: vis === 'private' ? f.who.id : undefined,
    };
  }

  function fromPreset(p, s) {
    const who = p?.who || { kind: 'char', id: 'kael' };
    const actor = T.actorCheck(s, who, p?.skill || 'perception', p?.situation || 'test');
    return {
      who,
      situation: p?.situation || 'test',
      skill: p?.skill || (who.kind === 'char' ? 'perception' : undefined),
      targetKind: p?.target?.kind || 'difficulty',
      difficulty: p?.target?.kind === 'difficulty' ? p.target.value : 10,
      targetLabel: p?.target?.label,
      parts: p?.target?.parts,
      rival: p?.target?.kind === 'opposed' ? null : 'g-matones',
      rivalBonus: p?.target?.bonus,
      rivalEdges: p?.target?.edges,
      edge: edgeOf([...actor.edges, ...(p?.edges || [])]),
      vis: p?.vis || 'public',
      blow: p?.blow,
      answers: p?.answers,
      npcOther: false,
      touched: false,
    };
  }

  function RollComposer({ preset, standalone, onDone }) {
    const s = S.useStore();
    const [f, setF] = useState(() => fromPreset(preset, s));
    const [suggestion, setSuggestion] = useState(null);
    const [last, setLast] = useState(null);
    const touchedRef = useRef(false);
    const change = (patch) => {
      touchedRef.current = true;
      setF((x) => ({ ...x, ...patch, touched: true }));
    };

    // Nimble lee lo que intenta el jugador y sugiere con qué tira. No se espera por ella.
    useEffect(() => {
      if (!preset?.suggest) return;
      const t = setTimeout(() => {
        setSuggestion(preset.suggest);
        if (!touchedRef.current && f.situation === 'test') setF((x) => ({ ...x, skill: preset.suggest[0].skill }));
      }, 1600);
      return () => clearTimeout(t);
    }, []);

    const actor = T.actorCheck(s, f.who, f.skill, f.situation);
    const spec = buildSpec(s, f);
    const odds = R.odds({ bonus: spec.bonus, edge: f.edge, target: spec.target });
    const rivals = rivalsFor(s, f.who);
    const ch = f.who.kind === 'char' ? s.chars[f.who.id] : null;
    const autoEdges = actor.edges;

    function roll() {
      const ev = S.act.roll(spec);
      if (standalone) setLast(ev);
      else {
        S.act.toast(`${spec.actor}: ${R.OUTCOME_LABELS[ev.result.outcome]}`);
        onDone && onDone();
      }
    }
    function request() {
      S.act.requestRoll({ char: ch.id, what: spec.what, target: spec.targetLabel, spec, vis: spec.vis, player: spec.player, answers: f.answers });
      S.act.toast(`Tirada pedida a ${ch.name}`);
      onDone && onDone();
    }

    const whoOptions = [
      ...Object.values(s.chars).map((c) => ({ key: 'c-' + c.id, who: { kind: 'char', id: c.id }, label: c.name, color: c.color })),
      ...(standalone ? [] : Object.values(D.GROUPS).map((g) => ({ key: 'g-' + g.id, who: { kind: 'group', id: g.id, token: S.groupTokens(s.tokens, g.id)[0]?.id }, label: g.name, color: 'var(--foe)' }))),
      { key: 'free', who: { kind: 'free', bonus: 4 }, label: 'Libre' },
    ];
    const whoKey = f.who.kind === 'char' ? 'c-' + f.who.id : f.who.kind === 'group' ? 'g-' + f.who.id : 'free';

    return html`<div className="composer">
      ${f.answers && html`<p className="answering"><${Icon} name="hand" size=${15} />Responde a una intervención: al tirar o pedirla, deja de esperar.</p>`}
      ${preset?.suggest &&
      html`<div className=${'nimble' + (suggestion ? ' is-ready' : '')}>
        <${Icon} name="scales" size=${16} />
        ${suggestion
          ? html`<span>Nimble sugiere:</span>
              ${suggestion.map(
                (x) => html`<button key=${x.skill} type="button" className="chip" aria-pressed=${f.skill === x.skill} onClick=${() => change({ skill: x.skill, situation: x.skill === 'marksmanship' ? 'ranged' : f.situation })}>
                  ${R.SKILL[x.skill].label} <b>${Math.round(x.p * 100)} %</b>
                </button>`,
              )}`
          : html`<span className="muted">Nimble está leyendo lo que intenta…</span>`}
      </div>`}

      <div className="composer-grid">
        <div className="fieldset">
          <span className="field-label">Quién tira</span>
          <div className="chips">
            ${whoOptions.map(
              (o) => html`<button key=${o.key} type="button" className="chip" aria-pressed=${whoKey === o.key} onClick=${() => {
                const actor2 = T.actorCheck(s, o.who, o.who.kind === 'char' ? 'perception' : undefined, 'test');
                change({ who: o.who, skill: o.who.kind === 'char' ? 'perception' : undefined, situation: 'test', targetKind: o.who.kind === 'char' ? f.targetKind : 'opposed', rival: o.who.kind === 'char' ? 'g-matones' : 'c-kael', edge: edgeOf(actor2.edges), blow: undefined, targetLabel: undefined, parts: undefined });
              }}>
                ${o.color && html`<${Avatar} name=${o.label} color=${o.color} size="xs" />`}${o.label}
              </button>`,
            )}
          </div>
        </div>

        <div className="fieldset">
          <span className="field-label">Situación</span>
          <${Seg}
            label="Situación"
            size="sm"
            value=${f.situation}
            onChange=${(v) => change({ situation: v, skill: v === 'ranged' ? 'marksmanship' : f.skill, targetLabel: undefined, parts: undefined })}
            options=${Object.entries(R.SITUATIONS).map(([k, v]) => [k, v])}
          />
        </div>

        <div className="fieldset">
          <label className="field-label" htmlFor="roll-skill">Con qué</label>
          ${f.who.kind === 'char' && f.situation === 'test' &&
          html`<select id="roll-skill" value=${f.skill} onChange=${(e) => change({ skill: e.target.value })}>
            ${R.ATTRS.map(
              (a) => html`<optgroup key=${a} label=${R.ATTR_INFO[a].label}>
                ${R.BASIC.filter((b) => b.attr === a).map((b) => html`<option key=${b.id} value=${b.id}>${b.label} ${R.signed(R.checkFor(ch, b.id).bonus)}</option>`)}
              </optgroup>`,
            )}
          </select>`}
          ${f.who.kind === 'char' && f.situation !== 'test' && html`<p className="static-field">${actor.what} <b>${R.signed(actor.bonus)}</b></p>`}
          ${f.who.kind === 'group' &&
          html`<${Seg} label="Con qué" size="sm" value=${f.npcOther} onChange=${(v) => change({ npcOther: v })} options=${[[false, `Lo suyo ${R.signed(actor.bonus)}`], [true, `Otra cosa ${R.signed(actor.bonus - 2)}`]]} />`}
          ${f.who.kind === 'free' &&
          html`<div className="stepper">
            <button type="button" className="icon-btn" aria-label="Menos" onClick=${() => change({ who: { kind: 'free', bonus: f.who.bonus - 1 } })}>−</button>
            <b>${R.signed(f.who.bonus)}</b>
            <button type="button" className="icon-btn" aria-label="Más" onClick=${() => change({ who: { kind: 'free', bonus: f.who.bonus + 1 } })}>+</button>
          </div>`}
          ${actor.parts.length > 1 && html`<p className="muted small">${actor.parts.map((p) => `${p.label} ${p.value}`).join(' + ')}</p>`}
        </div>

        <div className="fieldset">
          <span className="field-label">Contra</span>
          <${Seg} label="Contra" size="sm" value=${f.targetKind} onChange=${(v) => change({ targetKind: v, targetLabel: undefined, parts: undefined, rival: v === 'opposed' ? f.rival || rivals[0].id : f.rival })} options=${[['difficulty', 'Dificultad'], ['opposed', 'Un rival']]} />
          ${f.targetKind === 'difficulty' &&
          html`<div className="chips">
            ${f.parts && html`<button type="button" className="chip" aria-pressed=${true}>Calculada <b>${f.difficulty}</b></button>`}
            ${R.DIFFICULTIES.map((d) => html`<button key=${d.id} type="button" className="chip" aria-pressed=${!f.parts && f.difficulty === d.value} onClick=${() => change({ difficulty: d.value, parts: undefined, targetLabel: undefined })}>${d.label} <b>${d.value}</b></button>`)}
          </div>`}
          ${f.targetKind === 'difficulty' && f.parts && html`<p className="muted small">${f.parts.map((p) => `${p.label} ${p.value}`).join(' + ')} · sale del mapa</p>`}
          ${f.targetKind === 'opposed' &&
          (f.rival === null
            ? html`<p className="static-field">${f.targetLabel}</p>`
            : html`<select aria-label="Rival" value=${f.rival} onChange=${(e) => change({ rival: e.target.value, targetLabel: undefined })}>
                ${rivals.map((r) => html`<option key=${r.id} value=${r.id}>${r.label}</option>`)}
              </select>`)}
        </div>

        <div className="fieldset">
          <span className="field-label">Ventaja</span>
          <${Seg} label="Ventaja" size="sm" value=${f.edge} onChange=${(v) => change({ edge: v })} options=${[['disadvantage', 'Desventaja'], ['none', 'Normal'], ['advantage', 'Ventaja']]} />
          ${autoEdges.length > 0 && html`<p className="muted small">${autoEdges.map((e) => e.why).join(' · ')}: desventaja</p>`}
        </div>

        ${!standalone &&
        html`<div className="fieldset">
          <span className="field-label">Quién la ve</span>
          <${Seg}
            label="Quién la ve"
            size="sm"
            value=${f.vis}
            onChange=${(v) => change({ vis: v })}
            options=${[['public', 'Toda la mesa', 'users'], ['master', 'Solo yo', 'lock'], ...(ch ? [['private', `En secreto con ${ch.name}`, 'eyeOff']] : [])]}
          />
        </div>`}
      </div>

      <div className="composer-foot">
        <div className="composer-summary">
          <p><b>${spec.actor}</b> tira ${spec.what} <b>${R.signed(spec.bonus)}</b> ${spec.targetLabel.startsWith('contra') ? spec.targetLabel : `contra ${spec.targetLabel}`}${f.edge !== 'none' ? `, con ${R.EDGES[f.edge].toLowerCase()}` : ''}</p>
          <${OddsBar} odds=${odds} />
        </div>
        <div className="composer-actions">
          <button type="button" className="btn primary" onClick=${roll}><${Icon} name="dice" size=${17} />Tirar</button>
          ${ch && !standalone && html`<button type="button" className="btn" onClick=${request}><${Icon} name="hand" size=${17} />Pedir a ${D.PLAYERS[ch.owner]}</button>`}
        </div>
      </div>
      ${standalone && last && html`<${RollResult} ev=${last} />`}
    </div>`;
  }

  /** El resultado grande, con los dados recién tirados. */
  function RollResult({ ev }) {
    const r = ev.result;
    return html`<div className=${'roll-result o-' + r.outcome} key=${ev.id}>
      <${Dice} rolled=${r.dice.rolled} kept=${r.dice.kept} />
      <div>
        <p className="roll-result-total">${r.total} <span className="muted">contra ${r.goal}</span></p>
        <p className="roll-result-label">${R.OUTCOME_LABELS[r.outcome]}</p>
        <p className="muted small">${R.OUTCOME_GUIDES[ev.situation][r.outcome]}</p>
      </div>
    </div>`;
  }

  /** Lo que pidió el máster, tirado con la ficha de ahora. */
  function rollRequest(req) {
    const s = S.get();
    const spec = { ...req.spec };
    if (spec.who && spec.who.kind === 'char') spec.bonus = T.actorCheck(s, spec.who, spec.skill, spec.situation).bonus;
    S.act.roll({ ...spec, requested: req.id });
  }

  DC.roller = { RollComposer, RollResult, rollRequest, buildSpec };
})();
