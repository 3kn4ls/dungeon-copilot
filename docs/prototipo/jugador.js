// El móvil del jugador: si le toca, lo que le piden tirar, sus botones para intervenir, el mapa,
// su ficha y el registro que puede ver.
(function () {
  const DC = (window.DC = window.DC || {});
  const { useState } = React;
  const { html, Icon, Seg, Avatar, Pill, WoundTrack, LuckPips, OddsBar, INTENTS } = DC.ui;
  const R = DC.rules;
  const D = DC.data;
  const T = DC.tactics;
  const S = DC.store;

  function RequestCard({ s, req, ch }) {
    const spec = { ...req.spec, bonus: T.actorCheck(s, req.spec.who, req.spec.skill, req.spec.situation).bonus };
    const odds = R.odds({ bonus: spec.bonus, edge: spec.edge, target: spec.target });
    return html`<div className="req-card">
      <p className="eyebrow"><${Icon} name="dice" size=${14} /> El máster te pide una tirada${req.vis === 'private' ? ' en secreto' : ''}</p>
      <p className="req-what"><b>${req.what}</b> ${R.signed(spec.bonus)} · ${req.target}</p>
      <div className="aim-odds"><${OddsBar} odds=${odds} compact /><b>${R.pct(odds.successChance)}</b></div>
      <button type="button" className="btn primary big" onClick=${() => DC.roller.rollRequest(req)}><${Icon} name="dice" size=${20} />Tirar</button>
    </div>`;
  }

  function InterventionPanel({ s, ch, myTurn }) {
    const [intent, setIntent] = useState(null);
    const [text, setText] = useState('');
    const [secret, setSecret] = useState(false);
    const [target, setTarget] = useState('');
    const mine = S.pendingInterventions(s.events).find((e) => e.char === ch.id);
    const fighting = s.combat && myTurn;
    const foes = s.tokens.filter((t) => t.kind === 'enemy' && !t.down && !t.hidden);

    if (mine)
      return html`<div className="waiting">
        <p><${Icon} name="hand" size=${16} /> Esperando al máster: <b>${INTENTS[mine.intent][0]}</b>${mine.target ? ` → ${mine.target.name}` : ''}</p>
        ${mine.text && html`<p className="muted">«${mine.text}»</p>`}
        <button type="button" className="btn small ghost" onClick=${() => S.act.settle(mine.id, 'withdrawn')}>Retirarla</button>
      </div>`;

    const buttons = fighting
      ? ['melee', ...(ch.gear.ranged ? ['ranged'] : []), ...(R.has(ch, 'sorcery') ? ['spell'] : []), 'act', 'talk', 'ask']
      : ['talk', 'act', 'ask', 'attack'];
    const needsTarget = ['melee', 'ranged', 'spell'].includes(intent);
    const holds = s.floor.kind === 'table' || myTurn;
    function send(e) {
      e.preventDefault();
      const t = foes.find((f) => f.id === target);
      S.act.intervene({ char: ch.id, intent, text: text.trim(), secret, target: needsTarget && t ? { token: t.id, name: t.name } : undefined });
      S.act.toast(holds ? 'Intervienes: el máster lo atiende' : 'Has levantado la mano');
      setIntent(null);
      setText('');
      setSecret(false);
    }
    return html`<form className="intervene" onSubmit=${send}>
      <p className="eyebrow">${fighting ? 'Tu turno: ¿qué hace ' + ch.name + '?' : holds ? 'Tienes la palabra' : 'Pide la palabra'}</p>
      <div className=${'action-grid' + (buttons.length > 4 ? ' is-six' : '')}>
        ${buttons.map((b) => {
          const [label, icon] = INTENTS[b];
          return html`<button key=${b} type="button" className="action-btn" aria-pressed=${intent === b} onClick=${() => setIntent(intent === b ? null : b)}>
            <${Icon} name=${icon} size=${22} /><span>${label}</span>
          </button>`;
        })}
      </div>
      ${intent &&
      html`<div className="stack tight">
        ${needsTarget &&
        html`<label className="field"><span className="field-label">Contra quién</span>
          <select id="player-target" value=${target} onChange=${(e) => setTarget(e.target.value)}>
            <option value="">Elige</option>
            ${foes.map((f) => html`<option key=${f.id} value=${f.id}>${f.name} · a ${T.distance(s.tokens.find((t) => t.char === ch.id), f)} casillas</option>`)}
          </select>
        </label>`}
        <label className="field"><span className="field-label">Qué dice o hace (opcional)</span>
          <textarea id="player-text" rows="2" value=${text} placeholder=${intent === 'ask' ? '¿Hay alguna ventana?' : 'Le robo la bolsa al monje…'} onChange=${(e) => setText(e.target.value)}></textarea>
        </label>
        <label className="check"><input id="player-secret" type="checkbox" checked=${secret} onChange=${(e) => setSecret(e.target.checked)} /><${Icon} name="eyeOff" size=${15} />En secreto: solo lo ve el máster</label>
        <button type="submit" className="btn primary big" disabled=${needsTarget && !target}>${holds ? 'Intervenir' : 'Levantar la mano'}</button>
      </div>`}
    </form>`;
  }

  function MiniSheet({ s, ch }) {
    const [skill, setSkill] = useState(null);
    const odds = skill ? R.odds({ bonus: R.checkFor(ch, skill).bonus, target: { difficulty: 10 } }) : null;
    return html`<div className="mini-sheet">
      <div className="attr-row">
        ${R.ATTRS.map((a) => html`<div key=${a} className="attr-mini"><span>${R.ATTR_INFO[a].abbr}</span><b>${ch.attrs[a]}</b></div>`)}
      </div>
      <div className="mini-block"><span className="field-label">Heridas</span><${WoundTrack} ch=${ch} /></div>
      <div className="mini-block row-between"><span className="field-label">Suerte</span><${LuckPips} n=${ch.luck} /></div>
      <div className="mini-block">
        <span className="field-label">Habilidades · toca una para ver tu probabilidad contra Normal</span>
        <ul className="skill-chips">
          ${R.BASIC.filter((b) => ch.skills[b.id]).map(
            (b) => html`<li key=${b.id}><button type="button" className="chip" aria-pressed=${skill === b.id} onClick=${() => setSkill(skill === b.id ? null : b.id)}>${b.label} <b>${R.signed(R.checkFor(ch, b.id).bonus)}</b></button></li>`,
          )}
        </ul>
        ${odds && html`<${OddsBar} odds=${odds} />`}
      </div>
      <div className="mini-block">
        <span className="field-label">Equipo</span>
        <p>${ch.gear.melee.name} (${R.WEAPONS[ch.gear.melee.class].label})${ch.gear.ranged ? ` · ${ch.gear.ranged.name}` : ''} · ${ch.gear.armor.name}</p>
      </div>
      <button type="button" className="btn ghost" onClick=${() => S.act.go({ name: 'sheet', id: ch.id })}>Abrir la ficha entera</button>
    </div>`;
  }

  function PlayerView() {
    const s = S.useStore();
    const [tab, setTab] = useState('table');
    const ch = s.chars[s.playerChar];
    const myTurn = s.floor.kind === 'character' && s.floor.id === ch.id;
    const requests = S.pendingRequests(S.visibleTo(s.events, ch.id)).filter((r) => r.char === ch.id);
    const yourTurn = myTurn || requests.length > 0;
    const lastMine = [...s.events].reverse().find((e) => e.kind === 'roll' && e.char === ch.id);
    const reveal = [...S.visibleTo(s.events, ch.id)].reverse().find((e) => e.kind === 'reveal');
    const spent = s.spent[ch.id] || [];

    return html`<div className="player-wrap">
      <aside className="player-note">
        <p className="eyebrow">Vista del jugador</p>
        <h2>El móvil de ${D.PLAYERS[ch.owner]}</h2>
        <p className="muted">Lo que hace aquí le llega al máster al momento. Cambia de jugador:</p>
        <div className="chips">
          ${Object.values(s.chars).map(
            (c) => html`<button key=${c.id} type="button" className="chip" aria-pressed=${c.id === ch.id} onClick=${() => S.set({ playerChar: c.id })}>
              <${Avatar} name=${c.name} color=${c.color} size="xs" />${D.PLAYERS[c.owner]} · ${c.name}
            </button>`,
          )}
        </div>
      </aside>
      <div className="phone">
        <header className="phone-head">
          <${Avatar} name=${ch.name} color=${ch.color} />
          <div><b>${ch.name}</b><span className="muted small">La Marca del Ciervo · partida 2</span></div>
          <${Pill} tone="live">En directo<//>
        </header>
        ${yourTurn && html`<div className="turn-banner"><${Icon} name="hand" size=${18} /><b>¡Te toca!</b><span>${requests.length ? 'Tienes una tirada pendiente.' : s.combat ? `Tu turno, ronda ${s.combat.round}.` : 'El máster te da la palabra.'}</span></div>`}
        <div className="phone-status">
          ${s.combat
            ? html`<p><b>Combate · Ronda ${s.combat.round}</b> · turno de ${S.turnOf(s.combat).name}</p>`
            : html`<p><b>${s.scene}</b> · la palabra: ${S.floorHolder(s).toLowerCase()}</p>`}
        </div>
        <div className="phone-body">
          ${tab === 'table' &&
          html`<div className="stack">
            ${requests.map((r) => html`<${RequestCard} key=${r.id} s=${s} req=${r} ch=${ch} />`)}
            ${lastMine && html`<div className="last-roll"><p className="eyebrow">Tu última tirada · ${lastMine.what}</p><${DC.roller.RollResult} ev=${lastMine} /></div>`}
            <${InterventionPanel} s=${s} ch=${ch} myTurn=${myTurn} />
            ${s.combat && myTurn && html`<button type="button" className="btn big" onClick=${S.act.nextTurn}><${Icon} name="next" size=${18} />Terminar mi turno</button>`}
            ${ch.advanced.filter((a) => R.SKILL[a].uses).map(
              (a) => html`<div key=${a} className="ability">
                <span>${R.SKILL[a].label}<small> · ${R.SKILL[a].text}</small></span>
                ${spent.includes(a) ? html`<${Pill}>Usada<//>` : html`<button type="button" className="btn small" onClick=${() => S.act.useAbility(ch.id, a)}>Usar</button>`}
              </div>`,
            )}
            ${reveal && html`<div className="phone-reveal"><p className="eyebrow">${reveal.vis === 'private' ? 'Solo para ti' : 'El máster describe'}</p><p>${reveal.body}</p></div>`}
          </div>`}
          ${tab === 'map' && html`<${DC.map.BattleMap} mode="player" viewerChar=${ch.id} compact />`}
          ${tab === 'sheet' && html`<${MiniSheet} s=${s} ch=${ch} />`}
          ${tab === 'log' && html`<${DC.sala.Log} s=${s} viewer=${ch.id} />`}
        </div>
        <nav className="phone-tabs" aria-label="Secciones">
          ${[['table', 'Mesa', 'table'], ['map', 'Mapa', 'map'], ['sheet', 'Ficha', 'book'], ['log', 'Registro', 'scroll']].map(
            ([k, label, icon]) => html`<button key=${k} type="button" aria-pressed=${tab === k} onClick=${() => setTab(k)}><${Icon} name=${icon} size=${20} /><span>${label}</span></button>`,
          )}
        </nav>
      </div>
    </div>`;
  }

  DC.jugador = { PlayerView };
})();
