// El armazón: la barra del prototipo (ver como, escenario, tema), la navegación y las rutas.
(function () {
  const DC = (window.DC = window.DC || {});
  const { useState, useEffect } = React;
  const { html, Icon, Seg, Toasts } = DC.ui;
  const S = DC.store;

  function useTheme() {
    const [theme, setTheme] = useState(null);
    useEffect(() => {
      if (theme) document.documentElement.setAttribute('data-theme', theme);
      else document.documentElement.removeAttribute('data-theme');
    }, [theme]);
    const dark = theme ? theme === 'dark' : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return [dark, () => setTheme(dark ? 'light' : 'dark')];
  }

  function ProtoBar() {
    const s = S.useStore();
    const [dark, toggle] = useTheme();
    return html`<div className="proto">
      <span className="proto-label">Prototipo</span>
      <div className="proto-group">
        <span>Ver como</span>
        <${Seg}
          label="Ver como"
          size="xs"
          value=${s.role}
          onChange=${S.act.setRole}
          options=${[['master', 'Máster', 'crown'], ['player', 'Jugador', 'hand'], ['screen', 'Pantalla', 'tv']]}
        />
      </div>
      <div className="proto-group">
        <span>Momento</span>
        <${Seg} label="Momento de la partida" size="xs" value=${s.scenario} onChange=${S.act.reset} options=${[['narration', 'Narración'], ['combat', 'Combate']]} />
      </div>
      <span className="spacer"></span>
      <button type="button" className="icon-btn" aria-label=${dark ? 'Tema claro' : 'Tema oscuro'} onClick=${toggle}><${Icon} name=${dark ? 'sun' : 'moon'} /></button>
    </div>`;
  }

  const NAV = [
    ['lobby', 'Campañas', 'home'],
    ['campaign', 'Campaña', 'crest'],
    ['room', 'Sala', 'table'],
    ['sheet', 'Fichas', 'book'],
    ['roller', 'Tirador', 'dice'],
  ];

  function Rail({ s }) {
    return html`<nav className="rail" aria-label="Principal">
      <span className="rail-brand" aria-hidden="true">DC</span>
      ${NAV.map(
        ([name, label, icon]) => html`<button
          key=${name}
          type="button"
          className="rail-item"
          aria-current=${s.route.name === name || (name === 'sheet' && s.route.name === 'newChar') ? 'page' : undefined}
          onClick=${() => S.act.go(name === 'sheet' ? { name, id: s.playerChar } : name === 'campaign' ? { name, id: 'ciervo' } : { name })}
        >
          <${Icon} name=${icon} size=${20} /><span>${label}</span>
        </button>`,
      )}
    </nav>`;
  }

  function RollerPage() {
    return html`<div className="page">
      <header className="page-head">
        <p className="eyebrow">Sin partida</p>
        <h1>Tirador</h1>
        <p className="lede">Para probar el reglamento: elige quién tira y contra qué, mira la probabilidad de cada resultado y tira.</p>
      </header>
      <section className="panel"><${DC.roller.RollComposer} standalone /></section>
    </div>`;
  }

  function Page({ s }) {
    switch (s.route.name) {
      case 'lobby':
        return html`<${DC.campana.Lobby} />`;
      case 'campaign':
        return html`<${DC.campana.CampaignHub} />`;
      case 'sheet':
        return html`<${DC.ficha.Sheet} id=${s.route.id || 'kael'} />`;
      case 'newChar':
        return html`<${DC.ficha.NewCharacter} />`;
      case 'roller':
        return html`<${RollerPage} />`;
      default:
        return s.role === 'player' ? html`<${DC.jugador.PlayerView} />` : html`<${DC.sala.MasterRoom} />`;
    }
  }

  function App() {
    const s = S.useStore();
    if (s.role === 'screen')
      return html`<div className="app is-screen"><${ProtoBar} /><${DC.pantalla.ScreenView} /><${Toasts} /></div>`;
    return html`<div className=${'app' + (s.route.name === 'room' ? ' is-room' : '')}>
      <${ProtoBar} />
      <div className="shell">
        <${Rail} s=${s} />
        <main className="main"><${Page} s=${s} /></main>
      </div>
      <${Toasts} />
    </div>`;
  }

  ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`);
})();
