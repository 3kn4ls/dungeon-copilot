// La sala del máster: la mesa a la izquierda, la escena o el mapa en el centro con sus acciones
// debajo, y a la derecha la cola de lo que espera y el registro.
(function () {
  const DC = (window.DC = window.DC || {});
  const { useState } = React;
  const { html, Icon, Seg, Avatar, Pill, WoundTrack, LuckPips, EventCard, INTENTS } = DC.ui;
  const R = DC.rules;
  const D = DC.data;
  const T = DC.tactics;
  const S = DC.store;

  /** Lo que Nimble sugiere para lo que escribió el jugador (de mentira: por palabras clave). */
  function suggestFor(text) {
    if (/rob|bolsa|birl/i.test(text)) return [{ skill: 'sleight-of-hand', p: 0.71 }, { skill: 'stealth', p: 0.18 }, { skill: 'deception', p: 0.06 }];
    if (/dispar|flecha|arco/i.test(text)) return D.AI.check;
    if (/suelo|mir|busc|raro/i.test(text)) return [{ skill: 'perception', p: 0.64 }, { skill: 'lore', p: 0.2 }, { skill: 'survival', p: 0.09 }];
    return [{ skill: 'persuasion', p: 0.58 }, { skill: 'deception', p: 0.22 }, { skill: 'intimidation', p: 0.12 }];
  }

  /** La tirada para atender una intervención: lo más probable según lo que quiere hacer. */
  function interventionPreset(s, ev) {
    const base = { who: { kind: 'char', id: ev.char }, answers: ev.id, vis: ev.vis === 'private' ? 'private' : 'public' };
    if (ev.target) {
      const from = s.tokens.find((t) => t.char === ev.char);
      const to = s.tokens.find((t) => t.id === ev.target.token);
      const found = T.analyze(s, from, to).presets.find((p) => (ev.intent === 'spell' ? p.icon === 'spark' : p.situation === ev.intent));
      if (found) return { ...found, ...base, suggest: ev.text ? suggestFor(ev.text) : null };
    }
    const skill = ev.intent === 'talk' ? 'persuasion' : ev.intent === 'ask' ? 'perception' : 'athletics';
    return { ...base, situation: 'test', skill, target: { kind: 'difficulty', value: 10 }, suggest: ev.text ? suggestFor(ev.text) : null };
  }

  function FloorControl({ s }) {
    const value = s.floor.kind === 'character' ? s.floor.id : s.floor.kind;
    return html`<div className="floor">
      <span className="eyebrow">La palabra</span>
      <${Seg}
        label="Dar la palabra"
        value=${value}
        onChange=${(v) => S.act.giveFloor(v === 'master' || v === 'table' ? { kind: v } : { kind: 'character', id: v })}
        options=${[['master', 'Narro yo', 'crown'], ['table', 'La mesa', 'users'], ...Object.values(s.chars).map((c) => [c.id, c.name])]}
      />
    </div>`;
  }

  function InitiativeStrip({ s, master }) {
    const [ending, setEnding] = useState(false);
    const c = s.combat;
    return html`<div className="initiative">
      <span className="init-round"><span className="eyebrow">Ronda</span><b>${c.round}</b></span>
      <ol className="init-track">
        ${c.order.map((o, i) => {
          const ch = o.ref.kind === 'character' ? s.chars[o.ref.id] : null;
          const group = o.ref.kind === 'npc' ? S.groupTokens(s.tokens, o.ref.group) : [];
          const standing = group.filter((t) => !t.down).length;
          return html`<li key=${i} className=${'init-chip' + (i === c.turn ? ' is-current' : '') + (i < c.turn ? ' is-done' : '') + (ch ? '' : ' is-foe')}>
            <${Avatar} name=${o.name} color=${ch ? ch.color : 'var(--foe)'} size="sm" />
            <span className="init-name">${o.name}${group.length > 1 ? html`<small>${standing} de ${group.length} en pie</small>` : ch && ch.wounds.severity !== 'none' ? html`<small>${R.SEVERITY_LABELS[ch.wounds.severity]}</small>` : ''}</span>
            <span className="init-n">${o.init}</span>
          </li>`;
        })}
      </ol>
      ${master &&
      html`<div className="init-actions">
        <button type="button" className="btn primary" onClick=${S.act.nextTurn}><${Icon} name="next" size=${16} />Siguiente turno</button>
        ${ending
          ? html`<span className="confirm">
              <button type="button" className="btn small" onClick=${() => { S.act.endCombat(true); setEnding(false); }}>Terminar y recuperar el aliento</button>
              <button type="button" className="btn small ghost" onClick=${() => { S.act.endCombat(false); setEnding(false); }}>Solo terminar</button>
            </span>`
          : html`<button type="button" className="btn ghost" onClick=${() => setEnding(true)}>Terminar combate</button>`}
      </div>`}
    </div>`;
  }

  function SceneStage({ s }) {
    const [newScene, setNewScene] = useState(null);
    const reveals = s.events.filter((e) => e.kind === 'reveal' && e.vis === 'public');
    const last = reveals[reveals.length - 1];
    const lines = s.events.filter((e) => e.kind === 'speech' && e.vis === 'public').slice(-2);
    return html`<div className="scene">
      <div className="scene-art" aria-hidden="true"></div>
      <div className="scene-body">
        <span className="eyebrow">Escena</span>
        <h2 className="scene-title">${s.scene}</h2>
        ${last ? html`<p className="scene-text">${last.body}</p>` : html`<p className="muted">Aún no la has descrito. Ve a Enseñar, abajo.</p>`}
        ${lines.map((l) => html`<blockquote key=${l.id} className="scene-quote"><span>${DC.ui.npcName(l.npc)}</span>${l.text}</blockquote>`)}
        <div className="row-actions">
          ${newScene === null
            ? html`<button type="button" className="btn ghost" disabled=${!!s.combat} onClick=${() => setNewScene('')}><${Icon} name="flag" size=${16} />Nueva escena</button>
                ${!s.combat && html`<button type="button" className="btn" onClick=${() => S.act.startCombat()}><${Icon} name="sword" size=${16} />Empezar combate</button>`}`
            : html`<form className="inline-form" onSubmit=${(e) => { e.preventDefault(); if (newScene.trim()) { S.act.newScene(newScene.trim(), true); setNewScene(null); S.act.openDock('reveal', null); } }}>
                <input id="scene-title" autoFocus value=${newScene} placeholder="La bodega" aria-label="Título de la escena" onChange=${(e) => setNewScene(e.target.value)} />
                <button type="submit" className="btn primary">Empezar escena</button>
                <button type="button" className="btn ghost" onClick=${() => setNewScene(null)}>Cancelar</button>
                <span className="muted small">Recuperan el aliento y vuelve lo de una vez por escena.</span>
              </form>`}
        </div>
      </div>
    </div>`;
  }

  function PartyCard({ s, ch, master }) {
    const holds = s.floor.kind === 'character' && s.floor.id === ch.id;
    const spent = s.spent[ch.id] || [];
    return html`<li className=${'party-card' + (holds ? ' has-floor' : '')}>
      <div className="party-head">
        <${Avatar} name=${ch.name} color=${ch.color} />
        <div className="party-id">
          <button type="button" className="link-btn party-name" onClick=${() => S.act.go({ name: 'sheet', id: ch.id })}>${ch.name}</button>
          <span className="muted small">${D.PLAYERS[ch.owner]}${holds ? ' · tiene la palabra' : ''}</span>
        </div>
        <${LuckPips} n=${ch.luck} />
      </div>
      <${WoundTrack} ch=${ch} compact />
      <div className="party-gear small muted">${ch.gear.melee.name}${ch.gear.ranged ? ` · ${ch.gear.ranged.name}` : ''} · ${ch.gear.armor.name}</div>
      ${ch.advanced
        .filter((a) => R.SKILL[a].uses)
        .map((a) => {
          const used = spent.includes(a);
          return html`<div key=${a} className="ability">
            <span>${R.SKILL[a].label}<small> · una vez por ${R.SKILL[a].uses === 'scene' ? 'escena' : 'sesión'}</small></span>
            ${used ? html`<${Pill}>Usada<//>` : master && html`<button type="button" className="btn small ghost" onClick=${() => S.act.useAbility(ch.id, a)}>Usar</button>`}
          </div>`;
        })}
    </li>`;
  }

  function PartyRail({ s }) {
    const groups = s.combat ? s.combat.order.filter((o) => o.ref.kind === 'npc') : [];
    return html`<aside className="room-party" aria-label="La mesa">
      <h2 className="rail-title">Personajes</h2>
      <ul className="party-list">${Object.values(s.chars).map((ch) => html`<${PartyCard} key=${ch.id} s=${s} ch=${ch} master />`)}</ul>
      ${groups.length > 0 &&
      html`<h2 className="rail-title">Enemigos</h2>
        <ul className="foe-list">
          ${groups.map((o) => {
            const g = D.GROUPS[o.ref.group];
            const p = R.PROFILES[g.profile];
            return html`<li key=${g.id} className="foe-card">
              <p><b>${g.name}</b> <span className="muted small">${p.label} ${R.signed(p.bonus)} · daño ${p.damage}</span></p>
              ${S.groupTokens(s.tokens, g.id).map(
                (t) => html`<div key=${t.id} className=${'foe-row' + (t.down ? ' is-down' : '')}>
                  <span>${t.name}${t.hidden ? html` <${Icon} name="eyeOff" size=${13} label="Oculto" />` : ''}</span>
                  <span className="harm">${Array.from({ length: p.endures }, (_, i) => html`<i key=${i} className=${i < t.harm ? 'on' : ''}></i>`)}</span>
                </div>`,
              )}
            </li>`;
          })}
        </ul>`}
      <h2 className="rail-title">En escena</h2>
      <ul className="npc-mini">
        ${s.tokens.filter((t) => t.kind === 'neutral').map((t) => html`<li key=${t.id}><${Avatar} name=${t.name} size="xs" />${t.name}</li>`)}
      </ul>
      <div className="screen-link">
        <${Icon} name="tv" size=${16} />
        <span>Pantalla de la mesa</span>
        <button type="button" className="btn small ghost" onClick=${() => S.act.setRole('screen')}>Abrir</button>
      </div>
    </aside>`;
  }

  function Queue({ s }) {
    const pending = S.pendingInterventions(s.events);
    const requests = S.pendingRequests(s.events);
    const inCombat = (char) => s.combat && s.combat.order.some((o) => o.ref.id === char);
    return html`<section className="queue" aria-labelledby="queue-title">
      <h2 id="queue-title" className="rail-title">Esperando ${pending.length + requests.length > 0 && html`<span className="count">${pending.length + requests.length}</span>`}</h2>
      ${pending.length + requests.length === 0 && html`<p className="muted small queue-empty">Nadie espera. Cuando un jugador pida la palabra o intervenga, aparece aquí.</p>`}
      <ol className="queue-list">
        ${pending.map((ev) => {
          const ch = s.chars[ev.char];
          const [label, icon] = INTENTS[ev.intent];
          return html`<li key=${ev.id} className=${'q-item' + (ev.vis === 'private' ? ' is-secret' : '')}>
            <div className="q-head">
              <${Avatar} name=${ch.name} color=${ch.color} size="sm" />
              <span><b>${ch.name}</b> · <${Icon} name=${icon} size=${14} /> ${label}${ev.target ? ` → ${ev.target.name}` : ''}</span>
              ${ev.vis === 'private' && html`<${Pill} tone="secret" icon="eyeOff">En secreto<//>`}
            </div>
            ${ev.text ? html`<p className="q-text">${ev.text}</p>` : html`<p className="q-text muted">Levanta la mano.</p>`}
            <div className="q-actions">
              ${ev.intent === 'attack' && !s.combat && html`<button type="button" className="btn small ember" onClick=${() => S.act.startCombat(ev.id)}><${Icon} name="sword" size=${14} />Empezar combate</button>`}
              ${ev.intent === 'attack' && s.combat && !inCombat(ev.char) && html`<button type="button" className="btn small ember" onClick=${() => S.act.settle(ev.id, 'joined')}>Meter en el combate</button>`}
              <button type="button" className="btn small primary" onClick=${() => S.act.openDock('roll', interventionPreset(s, ev))}><${Icon} name="dice" size=${14} />Pedir tirada</button>
              <button type="button" className="btn small" onClick=${() => S.act.giveFloor({ kind: 'character', id: ev.char }, ev.id)}>Dar la palabra</button>
              <button type="button" className="btn small" onClick=${() => S.act.openDock('talk', { answers: ev.id })}>Como PNJ</button>
              <button type="button" className="btn small" onClick=${() => S.act.openDock('reveal', { answers: ev.id })}>Responder</button>
              <button type="button" className="btn small ghost" onClick=${() => S.act.settle(ev.id, 'handled')}><${Icon} name="check" size=${14} />Atendida</button>
              <button type="button" className="btn small ghost" onClick=${() => S.act.settle(ev.id, 'dismissed')}>Ahora no</button>
            </div>
          </li>`;
        })}
        ${requests.map(
          (ev) => html`<li key=${ev.id} className=${'q-item is-request' + (ev.vis === 'private' ? ' is-secret' : '')}>
            <div className="q-head"><${Icon} name="dice" size=${16} /><span><b>${s.chars[ev.char].name}</b> tiene que tirar ${ev.what} ${ev.target}</span></div>
            <div className="q-actions">
              <button type="button" className="btn small" onClick=${() => DC.roller.rollRequest(ev)}>Tirar por ${s.chars[ev.char].name}</button>
              <button type="button" className="btn small ghost" onClick=${() => S.act.settle(ev.id, 'withdrawn')}>Retirarla</button>
            </div>
          </li>`,
        )}
      </ol>
    </section>`;
  }

  /** El golpe ya calculado bajo una tirada que impacta: arma, crítico y armadura, y Aplicar. */
  function DamagePrompt({ s, ev }) {
    const base = T.blowDamage(s, ev.blow, ev.result.outcome, ev.situation);
    const [adj, setAdj] = useState(0);
    const [dodge, setDodge] = useState(false);
    if (!base || base.to.down) return null;
    const toChar = base.to.kind === 'pc' ? s.chars[base.to.char] : null;
    const canDodge = toChar && R.has(toChar, 'uncanny-dodge') && !(s.spent[toChar.id] || []).includes('uncanny-dodge');
    const total = dodge ? 1 : Math.max(1, base.total + adj);
    function apply() {
      let parts = base.parts;
      if (adj) parts = [...parts, { label: 'Retoque', value: adj }];
      if (dodge) {
        S.act.useAbility(toChar.id, 'uncanny-dodge');
        parts = [...base.parts, { label: 'Esquiva prodigiosa', value: 1 - base.total }];
      }
      S.act.applyDamage({ roll: ev.id, to: base.to.id, total, parts, by: base.from.name });
    }
    return html`<div className="blow">
      <p className="blow-math">
        ${base.parts.map((p, i) => html`<span key=${i}>${i ? (p.value < 0 ? ' − ' : ' + ') : ''}${p.label} ${Math.abs(p.value)}</span>`)}
        ${adj !== 0 && html`<span>${adj > 0 ? ' + ' : ' − '}retoque ${Math.abs(adj)}</span>`}
        <b> → ${total}</b>
      </p>
      <div className="row-actions">
        <button type="button" className="icon-btn" aria-label="Menos daño" onClick=${() => setAdj(adj - 1)}>−</button>
        <button type="button" className="icon-btn" aria-label="Más daño" onClick=${() => setAdj(adj + 1)}>+</button>
        ${canDodge && html`<label className="check"><input type="checkbox" checked=${dodge} onChange=${(e) => setDodge(e.target.checked)} />Esquiva prodigiosa: se queda en 1</label>`}
        <span className="spacer"></span>
        <button type="button" className="btn small blood" onClick=${apply}><${Icon} name="heart" size=${14} />Aplicar ${total} a ${base.to.name}</button>
      </div>
    </div>`;
  }

  function AiLines({ lines, label }) {
    const [open, setOpen] = useState(false);
    return html`<div className="ai-lines">
      <button type="button" className="link-btn small" onClick=${() => setOpen(!open)}><${Icon} name="wand" size=${14} />${label}</button>
      ${open && html`<ol>${lines.map((l, i) => html`<li key=${i}>${l}<button type="button" className="link-btn small" onClick=${() => S.act.openDock('reveal', { body: l })}>Enseñar</button></li>`)}</ol>`}
    </div>`;
  }

  /** Lo que se puede hacer bajo cada tirada: Suerte, el golpe, y la IA para narrarlo o complicarlo. */
  function RollActions({ s, ev, viewer, recent, superseded }) {
    const blows = S.blowsOf(s.events, ev.id);
    const ch = ev.char && s.chars[ev.char];
    const master = viewer === 'master';
    const canLuck = recent && ch && ev.vis !== 'master' && !superseded && !ev.reroll && blows.length === 0 && ch.luck > 0 && (master || viewer === ch.id);
    const hits = ev.blow && ev.result.success && !superseded && blows.length === 0;
    return html`<div className="ev-actions">
      ${canLuck && html`<button type="button" className="btn small ghost" onClick=${() => S.act.reroll(ev)}><${Icon} name="clover" size=${14} />Repetir con Suerte (le quedan ${ch.luck})</button>`}
      ${master && hits && recent && html`<${DamagePrompt} s=${s} ev=${ev} />`}
      ${master && recent && ev.situation && ev.situation !== 'test' && html`<${AiLines} lines=${D.AI.blow} label="Narrar el golpe con IA" />`}
      ${master && recent && (!ev.situation || ev.situation === 'test') && ['partial', 'failure', 'fumble'].includes(ev.result.outcome) &&
      html`<${AiLines} lines=${['Lo consigue, pero el monje se da cuenta y no dice nada… todavía.', 'La bolsa se rompe: unas monedas ruedan hasta los pies de Garrick.', 'Brunilda lo ve todo desde la barra y le guiña un ojo.']} label="Complicaciones con IA" />`}
    </div>`;
  }

  function Log({ s, viewer, title = 'Registro' }) {
    const [filter, setFilter] = useState('all');
    const events = S.visibleTo(s.events, viewer);
    const superseded = S.supersededRolls(s.events);
    const pending = new Set(S.pendingInterventions(s.events).map((e) => e.id).concat(S.pendingRequests(s.events).map((e) => e.id)));
    const recentRolls = new Set(events.filter((e) => e.kind === 'roll' && !superseded.has(e.id)).slice(-3).map((e) => e.id));
    const shown = events.filter((e) =>
      filter === 'all' ? true : filter === 'rolls' ? ['roll', 'rollRequest', 'damage'].includes(e.kind) : filter === 'story' ? ['reveal', 'speech', 'scene', 'intervention'].includes(e.kind) : e.vis !== 'public',
    );
    return html`<section className="log" aria-labelledby="log-title">
      <div className="log-head">
        <h2 id="log-title" className="rail-title">${title}</h2>
        <${Seg}
          label="Qué ver"
          size="xs"
          value=${filter}
          onChange=${setFilter}
          options=${[['all', 'Todo'], ['story', 'Historia'], ['rolls', 'Tiradas'], ...(viewer === 'screen' ? [] : [['secret', 'Secreto']])]}
        />
      </div>
      <ol className="log-list" aria-live="polite">
        ${[...shown].reverse().map(
          (ev) => html`<li key=${ev.id}>
            <${EventCard} ev=${ev} s=${s} viewer=${viewer} superseded=${superseded.has(ev.id)} pending=${pending.has(ev.id)}>
              ${ev.kind === 'roll' && viewer !== 'screen' && html`<${RollActions} s=${s} ev=${ev} viewer=${viewer} recent=${recentRolls.has(ev.id)} superseded=${superseded.has(ev.id)} />`}
              ${ev.kind === 'damage' && ev.lethal && viewer !== 'screen' && !s.events.some((x) => x.kind === 'survived' && x.of === ev.id) &&
              html`<button type="button" className="btn small ember" onClick=${() => {
                const ch = Object.values(s.chars).find((c) => c.name === ev.to);
                S.set((st) => ({ chars: { ...st.chars, [ch.id]: { ...ch, luck: Math.max(0, ch.luck - 1) } } }));
                S.addEvent({ kind: 'survived', of: ev.id, name: ch.name });
              }}><${Icon} name="clover" size=${14} />Gastar Suerte y seguir con vida</button>`}
            <//>
          </li>`,
        )}
      </ol>
    </section>`;
  }

  function RoomBar({ s, title }) {
    const [closing, setClosing] = useState(false);
    const pending = S.pendingInterventions(s.events).length;
    return html`<header className="room-bar">
      <button type="button" className="link-btn back" onClick=${() => S.act.go({ name: 'campaign', id: 'ciervo' })}><${Icon} name="back" size=${16} />La Marca del Ciervo</button>
      <div className="room-title">
        <h1>${title}</h1>
        <div className="room-meta">
          <${Pill} tone="live">En directo · 3 en la mesa<//>
          ${s.combat ? html`<${Pill} tone="ember" icon="sword">Combate · Ronda ${s.combat.round}<//>` : html`<${Pill} icon="speech">Narración · la palabra: ${S.floorHolder(s).toLowerCase()}<//>`}
          ${pending > 0 && html`<${Pill} tone="secret" icon="hand">${pending} esperando<//>`}
        </div>
      </div>
      <span className="spacer"></span>
      ${closing
        ? html`<span className="confirm">
            <span className="small muted">Cada personaje gana 2 PX más los hitos.</span>
            <button type="button" className="btn small blood" onClick=${() => { setClosing(false); S.act.toast('Partida terminada: ahora toca el resumen'); }}>Terminar</button>
            <button type="button" className="btn small ghost" onClick=${() => setClosing(false)}>Seguir jugando</button>
          </span>`
        : html`<button type="button" className="btn ghost" onClick=${() => setClosing(true)}><${Icon} name="exit" size=${16} />Terminar partida</button>`}
    </header>`;
  }

  function MasterRoom() {
    const s = S.useStore();
    return html`<div className="room">
      <${RoomBar} s=${s} title="Lo que esconde el Ciervo Blanco" />
      <${PartyRail} s=${s} />
      <section className="room-stage" aria-label="Escenario">
        <div className="stage-head">
          ${s.combat ? html`<${InitiativeStrip} s=${s} master />` : html`<${FloorControl} s=${s} />`}
          <${Seg} label="Qué ver" value=${s.stage} onChange=${S.act.setStage} options=${[['scene', 'Escena', 'scroll'], ['map', 'Mapa', 'map']]} />
        </div>
        <div className="stage-body">${s.stage === 'map' ? html`<${DC.map.BattleMap} mode="master" />` : html`<${SceneStage} s=${s} />`}</div>
        <${DC.dock.Dock} s=${s} />
      </section>
      <aside className="room-side">
        <${Queue} s=${s} />
        <${Log} s=${s} viewer="master" />
      </aside>
    </div>`;
  }

  DC.sala = { MasterRoom, Log, InitiativeStrip, interventionPreset, suggestFor };
})();
