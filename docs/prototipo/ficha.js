// La ficha de un personaje y el asistente para crear uno, con el reparto del reglamento.
(function () {
  const DC = (window.DC = window.DC || {});
  const { useState } = React;
  const { html, Icon, Seg, Avatar, Pill, WoundTrack, LuckPips, OddsBar } = DC.ui;
  const R = DC.rules;
  const D = DC.data;
  const S = DC.store;

  const ATTR_USE = {
    strength: 'Armas medias y pesadas, trepar, cargar, romper.',
    dexterity: 'Armas ligeras, disparar, esquivar, sigilo.',
    charisma: 'Convencer, mentir, intimidar, liderar.',
    intelligence: 'Percibir, recordar, curar, magia.',
    endurance: 'Resistir daño, fatiga y miedo. Sus rasguños.',
  };

  const update = (id, fn) => S.set((s) => ({ chars: { ...s.chars, [id]: fn(s.chars[id]) } }));
  const Rank = ({ n }) => html`<span className="rank" aria-label=${`Rango ${n}`}>${[1, 2, 3].map((i) => html`<i key=${i} className=${i <= n ? 'on' : ''}></i>`)}</span>`;

  function advanceOptions(ch) {
    const out = [];
    for (const b of R.BASIC) {
      const rank = ch.skills[b.id] || 0;
      if (rank < 3) out.push({ key: 's-' + b.id, attr: b.attr, label: `${b.label} a rango ${rank + 1}`, cost: (rank + 1) * 2, apply: (c) => ({ ...c, skills: { ...c.skills, [b.id]: rank + 1 } }) });
    }
    for (const a of R.ADVANCED) {
      if (ch.advanced.includes(a.id)) continue;
      const unmet = [];
      if (ch.attrs[a.attr] < a.min) unmet.push(`${R.ATTR_INFO[a.attr].abbr} ${a.min}`);
      if (a.skill && (ch.skills[a.skill] || 0) < a.rank) unmet.push(`${R.SKILL[a.skill].label} ${a.rank}`);
      out.push({ key: 'a-' + a.id, attr: a.attr, label: `Aprender ${a.label}`, cost: 5, unmet, apply: (c) => ({ ...c, advanced: [...c.advanced, a.id] }) });
    }
    for (const a of R.ATTRS) {
      const v = ch.attrs[a];
      if (v < 5) out.push({ key: 't-' + a, attr: a, label: `${R.ATTR_INFO[a].label} a ${v + 1}`, cost: (v + 1) * 3, apply: (c) => ({ ...c, attrs: { ...c.attrs, [a]: v + 1 } }) });
    }
    return out;
  }

  function Sheet({ id }) {
    const s = S.useStore();
    const ch = s.chars[id];
    const [skill, setSkill] = useState('perception');
    const [diff, setDiff] = useState(10);
    const [shop, setShop] = useState(false);
    const check = R.checkFor(ch, skill);
    const odds = R.odds({ bonus: check.bonus, edge: check.edges.length ? 'disadvantage' : 'none', target: { difficulty: diff } });
    const boxes = R.scratchBoxes(ch);
    const options = advanceOptions(ch);

    return html`<div className="page sheet-page" style=${{ '--c': ch.color }}>
      <header className="sheet-head">
        <button type="button" className="link-btn back small" onClick=${() => S.act.go({ name: 'campaign', id: 'ciervo' })}><${Icon} name="back" size=${14} />La Marca del Ciervo</button>
        <div className="sheet-id">
          <${Avatar} name=${ch.name} color=${ch.color} size="xl" />
          <div>
            <h1>${ch.name}</h1>
            <p className="lede">${ch.background}</p>
            <p className="muted small">Juega ${D.PLAYERS[ch.owner]} · puedes cambiarla tú y su jugador</p>
          </div>
        </div>
      </header>

      <div className="sheet">
        <section className="panel sheet-attrs" aria-labelledby="attrs-h">
          <h2 id="attrs-h">Atributos</h2>
          <div className="attr-grid">
            ${R.ATTRS.map(
              (a) => html`<div key=${a} className="attr-card">
                <span className="attr-abbr">${R.ATTR_INFO[a].abbr}</span>
                <b className="attr-value">${ch.attrs[a]}</b>
                <span className="attr-label">${R.ATTR_INFO[a].label}</span>
                <span className="attr-use">${ATTR_USE[a]}</span>
              </div>`,
            )}
          </div>
        </section>

        <section className="panel sheet-skills" aria-labelledby="skills-h">
          <h2 id="skills-h">Habilidades</h2>
          <div className="skill-cols">
            ${R.ATTRS.map(
              (a) => html`<div key=${a} className="skill-col">
                <h3>${R.ATTR_INFO[a].label} <span>${ch.attrs[a]}</span></h3>
                <ul>
                  ${R.BASIC.filter((b) => b.attr === a).map(
                    (b) => html`<li key=${b.id}>
                      <button type="button" className=${'skill-row' + (skill === b.id ? ' is-on' : '') + (ch.skills[b.id] ? '' : ' is-untrained')} onClick=${() => setSkill(b.id)}>
                        <span>${b.label}</span><${Rank} n=${ch.skills[b.id] || 0} /><b>${R.signed(R.checkFor(ch, b.id).bonus)}</b>
                      </button>
                    </li>`,
                  )}
                </ul>
              </div>`,
            )}
          </div>
          <div className="sheet-roll">
            <p><b>${R.SKILL[skill].label} ${R.signed(check.bonus)}</b> contra</p>
            <${Seg} label="Dificultad" size="xs" value=${diff} onChange=${setDiff} options=${R.DIFFICULTIES.map((d) => [d.value, `${d.label} ${d.value}`])} />
            <${OddsBar} odds=${odds} />
            ${check.edges.length > 0 && html`<p className="muted small">Con desventaja: ${check.edges.map((e) => e.why).join(', ')}.</p>`}
          </div>
        </section>

        <section className="panel" aria-labelledby="adv-h">
          <h2 id="adv-h">Técnicas</h2>
          <ul className="adv-list">
            ${ch.advanced.map((a) => {
              const k = R.SKILL[a];
              const used = (s.spent[ch.id] || []).includes(a);
              return html`<li key=${a} className="adv-card">
                <p><b>${k.label}</b>${k.uses && html` <${Pill} tone=${used ? 'muted' : 'live'}>${used ? 'Usada' : `Una vez por ${k.uses === 'scene' ? 'escena' : 'sesión'}`}<//>`}</p>
                <p className="muted small">${k.text}</p>
              </li>`;
            })}
          </ul>
        </section>

        <section className="panel" aria-labelledby="wounds-h">
          <h2 id="wounds-h">Heridas</h2>
          <${WoundTrack} ch=${ch} />
          <p className="muted small">${boxes} casillas de rasguño (Aguante${R.has(ch, 'tough') ? ' + Duro de pelar' : ''}). Una herida grave da desventaja en Fuerza, Destreza y Aguante.</p>
          <div className="row-actions">
            <button type="button" className="btn small" onClick=${() => update(id, (c) => ({ ...c, wounds: { ...R.applyWounds(c.wounds, R.scratchBoxes(c), 1), lethal: undefined } }))}>+1 de daño</button>
            <button type="button" className="btn small ghost" onClick=${() => update(id, (c) => ({ ...c, wounds: { ...c.wounds, scratches: 0 } }))}>Recuperar el aliento</button>
            <button type="button" className="btn small ghost" onClick=${() => update(id, (c) => ({ ...c, wounds: { ...c.wounds, severity: R.SEVERITY[Math.max(0, R.SEVERITY.indexOf(c.wounds.severity) - 1)] } }))}>Descansar: mejora un nivel</button>
          </div>
        </section>

        <section className="panel" aria-labelledby="gear-h">
          <h2 id="gear-h">Equipo</h2>
          <dl className="gear">
            <dt>Cuerpo a cuerpo</dt><dd>${ch.gear.melee.name} <span className="muted">· ${R.WEAPONS[ch.gear.melee.class].label}, daño ${R.WEAPONS[ch.gear.melee.class].damage}</span></dd>
            <dt>A distancia</dt><dd>${ch.gear.ranged ? html`${ch.gear.ranged.name} <span className="muted">· ${R.WEAPONS[ch.gear.ranged.class].label}, daño ${R.WEAPONS[ch.gear.ranged.class].damage}</span>` : html`<span className="muted">Nada</span>`}</dd>
            <dt>Armadura</dt><dd>${ch.gear.armor.name} <span className="muted">· ${R.ARMORS[ch.gear.armor.class].label}${R.ARMORS[ch.gear.armor.class].reduction ? `, −${R.ARMORS[ch.gear.armor.class].reduction} al daño` : ''}</span></dd>
            <dt>Escudo</dt><dd>${ch.gear.shield ? 'Sí: +1 al parar' : html`<span className="muted">No</span>`}</dd>
          </dl>
          <p className="muted small">Sale por defecto al atacar, al parar y al recibir un golpe.</p>
        </section>

        <section className="panel" aria-labelledby="luck-h">
          <h2 id="luck-h">Suerte y experiencia</h2>
          <div className="row-between"><span>Suerte</span><${LuckPips} n=${ch.luck} /></div>
          <p className="muted small">Un punto repite una tirada propia. Vuelve a 3 al empezar cada partida.</p>
          <div className="row-between xp"><span>Experiencia</span><b>${ch.xp} PX</b></div>
          <button type="button" className="btn" aria-expanded=${shop} onClick=${() => setShop(!shop)}><${Icon} name="plus" size=${16} />Gastar experiencia</button>
        </section>

        ${shop &&
        html`<section className="panel sheet-shop" aria-labelledby="shop-h">
          <h2 id="shop-h">Gastar experiencia <span className="muted">· tienes ${ch.xp} PX</span></h2>
          <div className="shop-cols">
            ${R.ATTRS.map(
              (a) => html`<div key=${a}>
                <h3>${R.ATTR_INFO[a].label}</h3>
                <ul>
                  ${options.filter((o) => o.attr === a).slice(0, 7).map((o) => {
                    const blocked = (o.unmet && o.unmet.length) || o.cost > ch.xp;
                    return html`<li key=${o.key}>
                      <button type="button" className="shop-row" disabled=${blocked} onClick=${() => { update(id, (c) => ({ ...o.apply(c), xp: c.xp - o.cost })); S.act.toast(`${ch.name}: ${o.label}`); }}>
                        <span>${o.label}${o.unmet && o.unmet.length ? html`<small>Requiere ${o.unmet.join(' y ')}</small>` : ''}</span><b>${o.cost} PX</b>
                      </button>
                    </li>`;
                  })}
                </ul>
              </div>`,
            )}
          </div>
        </section>`}
      </div>
    </div>`;
  }

  // --- Crear un personaje ---------------------------------------------------------------------

  const STEPS = ['Quién es', 'Atributos', 'Habilidades', 'Técnica y equipo'];

  function NewCharacter() {
    const [step, setStep] = useState(0);
    const [c, setC] = useState({
      name: '',
      background: '',
      attrs: { strength: 2, dexterity: 2, charisma: 2, intelligence: 2, endurance: 2 },
      skills: {},
      advanced: [],
      gear: { melee: { name: 'Espada', class: 'medium' }, ranged: null, armor: { name: 'Sin armadura', class: 'none' }, shield: false },
      wounds: { scratches: 0, severity: 'none' },
    });
    const attrLeft = 12 - Object.values(c.attrs).reduce((a, b) => a + b, 0);
    const skillLeft = 6 - Object.values(c.skills).reduce((a, b) => a + b, 0);
    const setAttr = (a, v) => setC({ ...c, attrs: { ...c.attrs, [a]: v } });
    const setSkill = (k, v) => setC({ ...c, skills: { ...c.skills, [k]: v } });
    const issues = [];
    if (!c.name.trim()) issues.push('Ponle un nombre');
    if (attrLeft !== 0) issues.push(attrLeft > 0 ? `Quedan ${attrLeft} puntos de atributo` : `Te pasas ${-attrLeft} puntos de atributo`);
    if (skillLeft !== 0) issues.push(skillLeft > 0 ? `Quedan ${skillLeft} rangos de habilidad` : `Te pasas ${-skillLeft} rangos`);
    const eligible = R.ADVANCED.filter((a) => c.attrs[a.attr] >= a.min && (!a.skill || (c.skills[a.skill] || 0) >= a.rank));

    return html`<div className="page">
      <header className="page-head">
        <button type="button" className="link-btn back small" onClick=${() => S.act.go({ name: 'campaign', id: 'ciervo' })}><${Icon} name="back" size=${14} />La Marca del Ciervo</button>
        <h1>Nuevo personaje</h1>
      </header>
      <ol className="steps">${STEPS.map((t, i) => html`<li key=${t}><button type="button" aria-current=${i === step ? 'step' : undefined} className=${i < step ? 'is-done' : ''} onClick=${() => setStep(i)}><span>${i + 1}</span>${t}</button></li>`)}</ol>
      <div className="wizard">
        <section className="panel">
          ${step === 0 &&
          html`<div className="stack">
            <label className="field"><span className="field-label">Nombre</span><input id="nc-name" value=${c.name} placeholder="Kael" onChange=${(e) => setC({ ...c, name: e.target.value })} /></label>
            <label className="field"><span className="field-label">Trasfondo: de dónde viene, en una frase</span><input id="nc-bg" value=${c.background} placeholder="Mercenario de la Compañía Libre" onChange=${(e) => setC({ ...c, background: e.target.value })} /></label>
            <p className="muted small">Cuando el trasfondo encaja con lo que intenta, el máster le da ventaja.</p>
          </div>`}
          ${step === 1 &&
          html`<div className="stack">
            <p className=${'points' + (attrLeft === 0 ? ' is-ok' : '')}><b>${attrLeft}</b> de 12 puntos por repartir · de 1 a 4 en cada uno</p>
            ${R.ATTRS.map(
              (a) => html`<div key=${a} className="alloc">
                <span><b>${R.ATTR_INFO[a].label}</b><small>${ATTR_USE[a]}</small></span>
                <div className="stepper">
                  <button type="button" className="icon-btn" aria-label=${`Menos ${R.ATTR_INFO[a].label}`} disabled=${c.attrs[a] <= 1} onClick=${() => setAttr(a, c.attrs[a] - 1)}>−</button>
                  <b>${c.attrs[a]}</b>
                  <button type="button" className="icon-btn" aria-label=${`Más ${R.ATTR_INFO[a].label}`} disabled=${c.attrs[a] >= 4 || attrLeft <= 0} onClick=${() => setAttr(a, c.attrs[a] + 1)}>+</button>
                </div>
              </div>`,
            )}
          </div>`}
          ${step === 2 &&
          html`<div className="stack">
            <p className=${'points' + (skillLeft === 0 ? ' is-ok' : '')}><b>${skillLeft}</b> de 6 rangos por repartir · como mucho 2 en cada una</p>
            <div className="skill-alloc">
              ${R.BASIC.map((b) => {
                const v = c.skills[b.id] || 0;
                return html`<div key=${b.id} className="alloc">
                  <span><b>${b.label}</b><small>${R.ATTR_INFO[b.attr].abbr} ${c.attrs[b.attr]} → ${R.signed(c.attrs[b.attr] + v)}</small></span>
                  <div className="stepper">
                    <button type="button" className="icon-btn" aria-label=${`Menos ${b.label}`} disabled=${v <= 0} onClick=${() => setSkill(b.id, v - 1)}>−</button>
                    <b>${v}</b>
                    <button type="button" className="icon-btn" aria-label=${`Más ${b.label}`} disabled=${v >= 2 || skillLeft <= 0} onClick=${() => setSkill(b.id, v + 1)}>+</button>
                  </div>
                </div>`;
              })}
            </div>
          </div>`}
          ${step === 3 &&
          html`<div className="stack">
            <span className="field-label">Una técnica, si cumple sus requisitos (opcional)</span>
            <div className="chips">
              <button type="button" className="chip" aria-pressed=${c.advanced.length === 0} onClick=${() => setC({ ...c, advanced: [] })}>Ninguna</button>
              ${eligible.map((a) => html`<button key=${a.id} type="button" className="chip" aria-pressed=${c.advanced[0] === a.id} title=${a.text} onClick=${() => setC({ ...c, advanced: [a.id] })}>${a.label}</button>`)}
            </div>
            ${eligible.length === 0 && html`<p className="muted small">Con este reparto no cumple los requisitos de ninguna: casi todas piden 3 o 4 en un atributo y 2 en una habilidad.</p>`}
            <span className="field-label">Arma cuerpo a cuerpo</span>
            <div className="row-fields">
              <input id="nc-melee" className="grow" aria-label="Nombre del arma" value=${c.gear.melee.name} onChange=${(e) => setC({ ...c, gear: { ...c.gear, melee: { ...c.gear.melee, name: e.target.value } } })} />
              <${Seg} label="Tipo de arma" size="sm" value=${c.gear.melee.class} onChange=${(v) => setC({ ...c, gear: { ...c.gear, melee: { ...c.gear.melee, class: v } } })} options=${Object.entries(R.WEAPONS).map(([k, w]) => [k, `${w.label} ${w.damage}`])} />
            </div>
            <span className="field-label">Armadura</span>
            <${Seg} label="Armadura" size="sm" value=${c.gear.armor.class} onChange=${(v) => setC({ ...c, gear: { ...c.gear, armor: { name: v === 'none' ? 'Sin armadura' : v === 'light' ? 'Cuero' : 'Placas', class: v } } })} options=${Object.entries(R.ARMORS).map(([k, a]) => [k, a.label])} />
            <label className="check"><input id="nc-shield" type="checkbox" checked=${c.gear.shield} onChange=${(e) => setC({ ...c, gear: { ...c.gear, shield: e.target.checked } })} />Lleva escudo</label>
          </div>`}
          <div className="row-actions wizard-nav">
            ${step > 0 && html`<button type="button" className="btn ghost" onClick=${() => setStep(step - 1)}>Atrás</button>`}
            <span className="spacer"></span>
            ${step < 3
              ? html`<button type="button" className="btn primary" onClick=${() => setStep(step + 1)}>Siguiente<${Icon} name="chevron" size=${16} /></button>`
              : html`<button type="button" className="btn primary" disabled=${issues.length > 0} onClick=${() => { S.act.toast(`${c.name} se une a la campaña`); S.act.go({ name: 'campaign', id: 'ciervo' }); }}>Crear personaje</button>`}
          </div>
        </section>
        <aside className="panel wizard-preview">
          <p className="eyebrow">Así queda</p>
          <h2>${c.name || 'Sin nombre'}</h2>
          <p className="muted small">${c.background || 'Sin trasfondo'}</p>
          <div className="attr-row">${R.ATTRS.map((a) => html`<div key=${a} className="attr-mini"><span>${R.ATTR_INFO[a].abbr}</span><b>${c.attrs[a]}</b></div>`)}</div>
          <p className="small">${Object.entries(c.skills).filter(([, v]) => v).map(([k, v]) => `${R.SKILL[k].label} ${v}`).join(' · ') || html`<span className="muted">Sin habilidades aún</span>`}</p>
          <p className="small">${c.gear.melee.name} (${R.WEAPONS[c.gear.melee.class].label}) · ${R.ARMORS[c.gear.armor.class].label}${c.gear.shield ? ' · escudo' : ''}</p>
          <p className="small">Rasguños: ${c.attrs.endurance + (c.advanced.includes('tough') ? 1 : 0)} · Suerte: 3</p>
          ${issues.length > 0 ? html`<ul className="issues">${issues.map((i) => html`<li key=${i}>${i}</li>`)}</ul>` : html`<p className="ok"><${Icon} name="check" size=${15} />Cumple el reparto de creación</p>`}
        </aside>
      </div>
    </div>`;
  }

  DC.ficha = { Sheet, NewCharacter };
})();
