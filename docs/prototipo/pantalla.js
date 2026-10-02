// La pantalla de la mesa (una tele): solo lo público. En narración, la escena; en combate, el
// mapa, el orden y el último golpe.
(function () {
  const DC = (window.DC = window.DC || {});
  const { html, Icon, Avatar, Dice, Pill } = DC.ui;
  const R = DC.rules;
  const D = DC.data;
  const S = DC.store;

  function ScreenView() {
    const s = S.useStore();
    const events = S.visibleTo(s.events, 'screen');
    const reveal = [...events].reverse().find((e) => e.kind === 'reveal');
    const speech = [...events].reverse().find((e) => e.kind === 'speech');
    const superseded = S.supersededRolls(events);
    const roll = [...events].reverse().find((e) => e.kind === 'roll' && !superseded.has(e.id));
    const damage = [...events].reverse().find((e) => e.kind === 'damage');
    const requests = S.pendingRequests(events);
    const c = s.combat;

    return html`<div className="screen">
      <header className="screen-head">
        <span className="eyebrow">La Marca del Ciervo · Partida 2</span>
        <h1>${s.scene}</h1>
        ${c ? html`<${Pill} tone="ember" icon="sword">Combate · Ronda ${c.round}<//>` : html`<${Pill} icon="speech">La palabra: ${S.floorHolder(s).toLowerCase()}<//>`}
        <span className="spacer"></span>
        <button type="button" className="btn small ghost" onClick=${() => S.act.setRole('master')}>Volver a la sala</button>
      </header>
      <div className="screen-grid">
        <div className="screen-main">
          ${c
            ? html`<${DC.map.BattleMap} mode="screen" />`
            : html`<div className="screen-scene">
                <div className="scene-art" aria-hidden="true"></div>
                <p className="screen-prose">${reveal ? reveal.body : 'El máster aún no ha descrito la escena.'}</p>
                ${speech && html`<blockquote className="screen-quote"><span>${DC.ui.npcName(speech.npc)}</span>${speech.text}</blockquote>`}
              </div>`}
        </div>
        <aside className="screen-side">
          ${c &&
          html`<ol className="screen-order">
            ${c.order.map((o, i) => {
              const ch = o.ref.kind === 'character' ? s.chars[o.ref.id] : null;
              const group = o.ref.kind === 'npc' ? S.groupTokens(s.tokens, o.ref.group).filter((t) => !t.hidden) : [];
              return html`<li key=${i} className=${i === c.turn ? 'is-current' : ''}>
                <${Avatar} name=${o.name} color=${ch ? ch.color : 'var(--foe)'} />
                <span><b>${o.name}</b>${ch ? html`<small>${R.SEVERITY_LABELS[ch.wounds.severity]}</small>` : html`<small>${group.filter((t) => !t.down).length} en pie${group.some((t) => t.harm && !t.down) ? ' · alguno herido' : ''}</small>`}</span>
                <span className="init-n">${o.init}</span>
              </li>`;
            })}
          </ol>`}
          ${requests.map((r) => html`<div key=${r.id} className="screen-request"><${Icon} name="dice" size=${20} /><span><b>${s.chars[r.char].name}</b> tiene que tirar ${r.what}</span></div>`)}
          ${roll &&
          html`<div className=${'screen-roll o-' + roll.result.outcome}>
            <p className="eyebrow">${roll.actor} · ${roll.what}</p>
            <${Dice} rolled=${roll.result.dice.rolled} kept=${roll.result.dice.kept} />
            <p className="screen-roll-total">${roll.result.total} <span>contra ${roll.result.goal}</span></p>
            <p className="screen-roll-label">${R.OUTCOME_LABELS[roll.result.outcome]}</p>
          </div>`}
          ${c && damage && html`<p className="screen-damage"><${Icon} name="heart" size=${18} />${damage.by ? `${damage.by} → ${damage.to}` : damage.to}: ${damage.total} de daño · ${damage.afterPublic || damage.after}</p>`}
        </aside>
      </div>
    </div>`;
  }

  DC.pantalla = { ScreenView };
})();
