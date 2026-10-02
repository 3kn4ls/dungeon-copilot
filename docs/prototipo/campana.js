// Fuera de la partida: las campañas y, dentro de una, su crónica, personajes, PNJ, mapas y mesa.
(function () {
  const DC = (window.DC = window.DC || {});
  const { useState } = React;
  const { html, Icon, Seg, Avatar, Pill, WoundTrack, LuckPips, useStream } = DC.ui;
  const R = DC.rules;
  const D = DC.data;
  const S = DC.store;

  const SIGILS = {
    ciervo: '<path d="M24 40c-5 0-8-4-8-9 0-3 2-5 4-6l4 3 4-3c2 1 4 3 4 6 0 5-3 9-8 9z"/><path d="M18 24c-3-3-4-8-3-13M15 15l-5-3M16 19l-6 1M30 24c3-3 4-8 3-13M33 15l5-3M32 19l6 1"/>',
    ancla: '<circle cx="24" cy="11" r="4"/><path d="M24 15v26M16 22h16M10 30c2 7 8 11 14 11s12-4 14-11M10 30l-3 2M38 30l3 2"/>',
    torre: '<path d="M16 42V18h16v24M14 18l10-11 10 11M21 42v-7a3 3 0 016 0v7M22 24h4"/>',
  };
  const Sigil = ({ name, size = 48 }) =>
    html`<svg className="sigil" width=${size} height=${size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: SIGILS[name] }}></svg>`;

  function Lobby() {
    const [code, setCode] = useState('');
    return html`<div className="page">
      <header className="page-head">
        <p className="eyebrow">Dungeon Copilot</p>
        <h1>Tus campañas</h1>
        <p className="lede">El máster crea la campaña y comparte su código; los jugadores se unen con él y crean ahí sus personajes.</p>
      </header>
      <div className="lobby">
        <ul className="camp-grid">
          ${D.CAMPAIGNS.map(
            (c) => html`<li key=${c.id} className=${'camp-card' + (c.live ? ' is-live' : '')}>
              <div className="camp-top">
                <${Sigil} name=${c.sigil} />
                <div className="camp-pills">
                  ${c.role === 'master' ? html`<${Pill} icon="crown">Máster<//>` : html`<${Pill}>Jugador · máster ${c.master}<//>`}
                  ${c.live && html`<${Pill} tone="live">En juego<//>`}
                </div>
              </div>
              <h2><button type="button" className="link-btn" onClick=${() => S.act.go({ name: 'campaign', id: c.id })}>${c.name}</button></h2>
              <p className="camp-desc">${c.description}</p>
              <p className="muted small">${c.members} personas · ${c.characters} personajes · ${c.lastPlayed}</p>
              ${c.live && html`<button type="button" className="btn primary" onClick=${() => S.act.go({ name: 'room' })}><${Icon} name="table" size=${16} />Entrar en la sala</button>`}
            </li>`,
          )}
        </ul>
        <aside className="lobby-side">
          <form className="panel" onSubmit=${(e) => { e.preventDefault(); S.act.toast('Campaña creada: ahora invita a tu mesa'); }}>
            <h2>Crear campaña</h2>
            <label className="field"><span className="field-label">Nombre</span><input id="new-camp-name" required placeholder="La Marca del Ciervo" /></label>
            <label className="field"><span className="field-label">De qué va (opcional)</span><textarea id="new-camp-desc" rows="2"></textarea></label>
            <button type="submit" className="btn primary">Crear y ser su máster</button>
          </form>
          <form className="panel" onSubmit=${(e) => { e.preventDefault(); S.act.toast('Te has unido a la campaña'); }}>
            <h2>Unirse con código</h2>
            <label className="field"><span className="field-label">Código que te ha pasado el máster</span>
              <input id="join-code" className="code-input" value=${code} maxLength="6" placeholder="K7PX3M" autoComplete="off" onChange=${(e) => setCode(e.target.value.toUpperCase())} />
            </label>
            <button type="submit" className="btn">Unirse</button>
          </form>
        </aside>
      </div>
    </div>`;
  }

  function Chronicle() {
    return html`<div className="chronicle">
      <ol className="timeline">
        ${D.GAMES.map(
          (g) => html`<li key=${g.id} className=${'tl-item' + (g.status === 'open' ? ' is-open' : '')}>
            <span className="tl-mark">${g.number}</span>
            <div className="tl-body">
              <p className="eyebrow">Partida ${g.number} · ${g.date}</p>
              <h3>${g.title}</h3>
              ${g.status === 'open'
                ? html`<p>En juego ahora mismo. Escena: <b>El Ciervo Blanco</b>.</p>
                    <button type="button" className="btn primary" onClick=${() => S.act.go({ name: 'room' })}><${Icon} name="table" size=${16} />Entrar en la sala</button>`
                : html`<p className="recap">${g.recap}</p><p className="muted small">Se repartieron ${g.xp} PX a cada personaje.</p>`}
            </div>
          </li>`,
        )}
      </ol>
      <div className="panel">
        <h2>Abrir partida</h2>
        <p className="muted">Ya hay una en juego: termínala antes de abrir otra.</p>
        <label className="field"><span className="field-label">Título (opcional)</span><input id="new-game-title" disabled placeholder="La bodega" /></label>
        <label className="check"><input type="checkbox" checked disabled />Todos empiezan con 3 de Suerte</label>
      </div>
    </div>`;
  }

  function Characters({ s }) {
    return html`<div className="stack">
      <div className="row-actions"><span className="spacer"></span><button type="button" className="btn primary" onClick=${() => S.act.go({ name: 'newChar' })}><${Icon} name="plus" size=${16} />Nuevo personaje</button></div>
      <ul className="char-grid">
        ${Object.values(s.chars).map(
          (ch) => html`<li key=${ch.id} className="char-card" style=${{ '--c': ch.color }}>
            <div className="char-top">
              <${Avatar} name=${ch.name} color=${ch.color} size="lg" />
              <div><h3><button type="button" className="link-btn" onClick=${() => S.act.go({ name: 'sheet', id: ch.id })}>${ch.name}</button></h3><p className="muted small">${ch.background} · ${D.PLAYERS[ch.owner]}</p></div>
            </div>
            <div className="attr-row">${R.ATTRS.map((a) => html`<div key=${a} className="attr-mini"><span>${R.ATTR_INFO[a].abbr}</span><b>${ch.attrs[a]}</b></div>`)}</div>
            <${WoundTrack} ch=${ch} compact />
            <p className="char-foot"><${LuckPips} n=${ch.luck} /><span className="muted small">${ch.xp} PX · ${ch.advanced.map((a) => R.SKILL[a].label).join(', ')}</span></p>
          </li>`,
        )}
      </ul>
    </div>`;
  }

  function NpcDrawer({ npc, onClose }) {
    const isNew = !npc;
    const [idea, setIdea] = useState('');
    const [made, setMade] = useState(null);
    const stream = useStream();
    const shown = npc || made;
    function invent() {
      const draft = { name: 'Ilse la Tuerta', concept: 'Contrabandista de vino que trae las barricas del sótano', appearance: 'Un parche de cuero y las manos manchadas de mosto.', personality: 'Desconfiada, pero leal a quien paga a tiempo.', speech: 'Habla en susurros y nunca termina las frases.', goals: 'Cobrar lo que le debe Brunilda.', secrets: 'Sabe quién duerme en el sótano y está pensando en venderlo.', profile: 'soldier' };
      stream.start(`${draft.concept}. ${draft.appearance} ${draft.personality}`, () => setMade(draft));
    }
    return html`<div className="drawer-backdrop" onClick=${onClose}>
      <aside className="drawer" role="dialog" aria-label=${shown ? shown.name : 'Nuevo PNJ'} onClick=${(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2>${shown ? shown.name : 'Nuevo PNJ'}</h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick=${onClose}><${Icon} name="x" /></button>
        </header>
        ${isNew &&
        !made &&
        html`<div className="stack">
          <label className="field"><span className="field-label">Lo que tienes en mente (opcional)</span><input id="npc-idea" value=${idea} placeholder="Una contrabandista que surte la bodega" onChange=${(e) => setIdea(e.target.value)} /></label>
          <button type="button" className="btn primary" disabled=${stream.running} onClick=${invent}><${Icon} name="wand" size=${16} />${stream.running ? 'Inventando…' : 'Inventar con IA'}</button>
          ${stream.text && html`<p className="muted">${stream.text}</p>`}
          <p className="muted small">O rellénalo a mano: nombre, quién es, aspecto, carácter, cómo habla, qué quiere y qué oculta.</p>
        </div>`}
        ${shown &&
        html`<dl className="npc-sheet">
          <dt>Quién es</dt><dd>${shown.concept}</dd>
          <dt>Aspecto</dt><dd>${shown.appearance}</dd>
          <dt>Carácter</dt><dd>${shown.personality}</dd>
          <dt>Cómo habla</dt><dd>${shown.speech}</dd>
          <dt>Qué quiere</dt><dd>${shown.goals}</dd>
          <dt className="secret-dt"><${Icon} name="lock" size=${14} /> Qué oculta</dt><dd className="secret-dd">${shown.secrets}</dd>
          <dt>Si hay pelea</dt><dd>${shown.profile ? `${R.PROFILES[shown.profile].label}: ${R.signed(R.PROFILES[shown.profile].bonus)}, aguanta ${R.PROFILES[shown.profile].endures}, daño ${R.PROFILES[shown.profile].damage}` : 'No pelea'}</dd>
        </dl>`}
        ${shown && html`<div className="row-actions">${isNew ? html`<button type="button" className="btn primary" onClick=${() => { S.act.toast('PNJ guardado'); onClose(); }}>Guardar</button>` : html`<button type="button" className="btn">Editar</button><button type="button" className="btn ghost" onClick=${() => { S.act.go({ name: 'room' }); S.act.openDock('talk', { npc: npc.id }); }}><${Icon} name="mask" size=${16} />Hablar con ${shown.name} en la sala</button>`}</div>`}
      </aside>
    </div>`;
  }

  function Npcs() {
    const [open, setOpen] = useState(undefined);
    return html`<div className="stack">
      <div className="row-actions"><p className="muted">Solo los ves tú. La IA los usa para hablar por ellos, pero nunca cuenta lo que ocultan sin motivo.</p><span className="spacer"></span><button type="button" className="btn primary" onClick=${() => setOpen(null)}><${Icon} name="plus" size=${16} />Nuevo PNJ</button></div>
      <ul className="npc-grid">
        ${D.NPCS.map(
          (n) => html`<li key=${n.id}><button type="button" className="npc-card" onClick=${() => setOpen(n)}>
            <${Avatar} name=${n.name} size="lg" />
            <span><b>${n.name}</b><span className="muted small">${n.concept}</span></span>
            <span className="npc-tags">${n.profile ? html`<${Pill} tone="foe">${R.PROFILES[n.profile].label}<//>` : html`<${Pill}>No pelea<//>`}<${Pill} tone="master" icon="lock">Tiene secretos<//></span>
          </button></li>`,
        )}
      </ul>
      ${open !== undefined && html`<${NpcDrawer} npc=${open} onClose=${() => setOpen(undefined)} />`}
    </div>`;
  }

  function MapThumb({ id }) {
    const map = D.MAPS[id];
    if (!map)
      return html`<svg viewBox="0 0 220 140" className="map-thumb is-empty" aria-hidden="true"><rect width="220" height="140" /><path d="M20 110L80 50l40 40 30-30 50 50" /></svg>`;
    const k = 10;
    return html`<svg viewBox=${`0 0 ${map.cols * k} ${map.rows * k}`} className="map-thumb" aria-hidden="true">
      <rect width=${map.cols * k} height=${map.rows * k} className="m-floor" />
      ${map.furniture.filter((f) => !f.secret).map((f, i) => html`<rect key=${i} x=${f.x * k + 1} y=${f.y * k + 1} width=${f.w * k - 2} height=${f.h * k - 2} className="m-f-thumb" />`)}
      ${map.walls.map(([x, y, w, h], i) => html`<rect key=${i} x=${x * k} y=${y * k} width=${w * k} height=${h * k} className="m-wall" />`)}
    </svg>`;
  }

  function Maps() {
    return html`<div className="stack">
      <div className="row-actions">
        <p className="muted">Planos para los combates: sube una imagen y ajusta la cuadrícula, o dibújalo con muros, puertas y muebles que dan cobertura.</p>
        <span className="spacer"></span>
        <button type="button" className="btn primary" onClick=${() => S.act.toast('Sube una imagen y ajusta la cuadrícula encima')}><${Icon} name="plus" size=${16} />Nuevo mapa</button>
      </div>
      <ul className="map-grid">
        ${D.MAP_LIBRARY.map(
          (m) => html`<li key=${m.id} className="map-card">
            <${MapThumb} id=${m.id} />
            <div><b>${m.name}</b><span className="muted small">${m.size} casillas · ${m.state}</span></div>
            ${m.id === 'ciervo' ? html`<button type="button" className="btn small" onClick=${() => { S.act.go({ name: 'room' }); S.act.setStage('map'); }}>Ver en la sala</button>` : html`<button type="button" className="btn small ghost">Editar</button>`}
          </li>`,
        )}
      </ul>
    </div>`;
  }

  function Table() {
    const [copied, setCopied] = useState(false);
    return html`<div className="table-tab">
      <section className="panel">
        <h2>Invitar jugadores</h2>
        <p className="invite-code">K7PX3M</p>
        <button type="button" className="btn" onClick=${() => { navigator.clipboard?.writeText('K7PX3M').catch(() => {}); setCopied(true); }}><${Icon} name=${copied ? 'check' : 'copy'} size=${16} />${copied ? 'Copiado' : 'Copiar código'}</button>
      </section>
      <section className="panel">
        <h2>La mesa</h2>
        <ul className="members">
          <li><${Avatar} name="Tú" size="sm" /><span><b>Tú</b> · máster</span></li>
          ${Object.values(D.CHARACTERS).map((c) => html`<li key=${c.id}><${Avatar} name=${D.PLAYERS[c.owner]} color=${c.color} size="sm" /><span><b>${D.PLAYERS[c.owner]}</b> · juega con ${c.name}</span><button type="button" className="btn small ghost">Echar</button></li>`)}
        </ul>
      </section>
      <section className="panel">
        <h2>Pantalla de la mesa</h2>
        <p className="muted">Un enlace sin sesión para la tele: enseña la escena, el mapa, el orden y las tiradas públicas. Nada secreto.</p>
        <div className="row-actions"><button type="button" className="btn" onClick=${() => S.act.setRole('screen')}><${Icon} name="tv" size=${16} />Abrir la pantalla</button><button type="button" className="btn ghost">Cambiar el enlace</button></div>
      </section>
    </div>`;
  }

  function CampaignHub() {
    const s = S.useStore();
    const [tab, setTab] = useState('chronicle');
    const c = D.CAMPAIGNS[0];
    return html`<div className="page">
      <header className="hub-head">
        <${Sigil} name=${c.sigil} size=${64} />
        <div>
          <button type="button" className="link-btn back small" onClick=${() => S.act.go({ name: 'lobby' })}><${Icon} name="back" size=${14} />Tus campañas</button>
          <h1>${c.name}</h1>
          <p className="lede">${c.description}</p>
        </div>
        <div className="hub-live">
          <${Pill} tone="live">Partida 2 en juego<//>
          <button type="button" className="btn primary" onClick=${() => S.act.go({ name: 'room' })}><${Icon} name="table" size=${16} />Entrar en la sala</button>
        </div>
      </header>
      <div className="tabs">
        <${Seg}
          label="Secciones de la campaña"
          value=${tab}
          onChange=${setTab}
          options=${[['chronicle', 'Crónica', 'scroll'], ['chars', 'Personajes', 'users'], ['npcs', 'PNJ', 'mask'], ['maps', 'Mapas', 'map'], ['table', 'Mesa', 'crest']]}
        />
      </div>
      ${tab === 'chronicle' && html`<${Chronicle} />`}
      ${tab === 'chars' && html`<${Characters} s=${s} />`}
      ${tab === 'npcs' && html`<${Npcs} />`}
      ${tab === 'maps' && html`<${Maps} />`}
      ${tab === 'table' && html`<${Table} />`}
    </div>`;
  }

  DC.campana = { Lobby, CampaignHub, Sigil };
})();
