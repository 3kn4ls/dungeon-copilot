// Piezas comunes: iconos, dados, probabilidades, heridas y las tarjetas del registro.
(function () {
  const DC = (window.DC = window.DC || {});
  const { useState, useEffect, useRef } = React;
  const html = htm.bind(React.createElement);
  const R = DC.rules;
  const D = DC.data;

  const ICONS = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    crest: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>',
    table: '<circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="3.5" r="1.5"/><circle cx="12" cy="20.5" r="1.5"/><circle cx="3.5" cy="12" r="1.5"/><circle cx="20.5" cy="12" r="1.5"/>',
    map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    scroll: '<path d="M8 4h10a2 2 0 012 2v2h-4"/><path d="M16 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2v-1h9"/><path d="M8 4a2 2 0 00-2 2v11"/><path d="M10 9h3M10 13h3"/>',
    book: '<path d="M5 4.5A1.5 1.5 0 016.5 3H19v15H6.5A1.5 1.5 0 005 19.5z"/><path d="M5 19.5A1.5 1.5 0 006.5 21H19v-3"/><path d="M9 7h6"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.1" fill="currentColor"/><circle cx="15" cy="15" r="1.1" fill="currentColor"/><circle cx="15" cy="9" r="1.1" fill="currentColor"/><circle cx="9" cy="15" r="1.1" fill="currentColor"/>',
    mask: '<path d="M4 6c3-1.5 13-1.5 16 0 0 7-3 12-8 12S4 13 4 6z"/><path d="M8 10h2.5M13.5 10H16"/><path d="M10 14.5c1.2.8 2.8.8 4 0"/>',
    tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
    sword: '<path d="M20 4l-9.5 9.5"/><path d="M20 4h-4M20 4v4"/><path d="M7 12l5 5M9.5 14.5L4 20"/>',
    bow: '<path d="M6 3c7 3 9 12 3 18"/><path d="M6 3v18"/><path d="M4 12h15M16 9l3 3-3 3"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
    hand: '<path d="M8 13V6.5a1.5 1.5 0 013 0V12M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7c0 4-2.5 7-6 7-2.8 0-4.4-1.6-5.8-3.8L3.3 13a1.5 1.5 0 012.5-1.6L8 13"/>',
    speech: '<path d="M4 5h16v11H9l-5 4z"/>',
    question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5"/><path d="M12 17.2v.1"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3 3.9M6.6 6.6C3.8 8.3 2 12 2 12s3.5 7 10 7a9.7 9.7 0 005.4-1.6"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    chevron: '<path d="M9 5l7 7-7 7"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    wand: '<path d="M5 19L16 8"/><path d="M14 6l4 4"/><path d="M19 2.5v4M17 4.5h4M8.5 3v2.5M7.25 4.25h2.5"/>',
    scales: '<path d="M12 4v16M8 20h8M5 7h14"/><path d="M5 7l-2.5 6h5zM19 7l-2.5 6h5z"/>',
    ruler: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
    pin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0112 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
    pointer: '<path d="M5 3l14 7-6.5 2L10 19z"/>',
    cloud: '<path d="M7 18h10a4 4 0 000-8 6 6 0 00-11.3 1.5A3.5 3.5 0 007 18z"/>',
    clover: '<path d="M12 12c-3-5-8-3-6 0-3 2-1 7 3 4M12 12c3-5 8-3 6 0 3 2 1 7-3 4M12 12c-2 3-3 5-1 9"/>',
    flag: '<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>',
    next: '<path d="M5 5l9 7-9 7z"/><path d="M18 5v14"/>',
    note: '<path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5M8 9h8M8 12.5h5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.6a3.5 3.5 0 010 6.8M18 14a6.5 6.5 0 013.5 6"/>',
    exit: '<path d="M14 3H5v18h9"/><path d="M10 12h11M17 8l4 4-4 4"/>',
    link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>',
    refresh: '<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 4v7h-7"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    shield: '<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/>',
  };

  function Icon({ name, size = 18, label }) {
    return html`<svg
      className="ico"
      width=${size}
      height=${size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden=${label ? undefined : 'true'}
      aria-label=${label}
      dangerouslySetInnerHTML=${{ __html: ICONS[name] || '' }}
    ></svg>`;
  }

  /** Botones de una sola opción, como el Segmented de la web. */
  function Seg({ value, options, onChange, label, size }) {
    return html`<div className=${'seg' + (size ? ' seg-' + size : '')} role="group" aria-label=${label}>
      ${options.map(
        ([v, text, icon]) => html`<button
          type="button"
          key=${String(v)}
          aria-pressed=${value === v}
          onClick=${() => onChange(v)}
        >
          ${icon && html`<${Icon} name=${icon} size=${16} />`}<span>${text}</span>
        </button>`,
      )}
    </div>`;
  }

  function Avatar({ name, color, size = 'md', down, ring, title }) {
    return html`<span
      className=${`avatar avatar-${size}${down ? ' is-down' : ''}${ring ? ' is-ring' : ''}`}
      style=${{ '--c': color || 'var(--neutral)' }}
      title=${title}
      aria-hidden="true"
      >${name.replace('Hermano ', '').slice(0, name.startsWith('Mat') ? 1 : 1)}</span
    >`;
  }

  const Pill = ({ tone = 'muted', icon, children }) =>
    html`<span className=${'pill pill-' + tone}>${icon && html`<${Icon} name=${icon} size=${13} />`}${children}</span>`;

  /** Rasguños en casillas y, debajo, la escala de heridas. */
  function WoundTrack({ ch, compact }) {
    const boxes = R.scratchBoxes(ch);
    const level = R.SEVERITY.indexOf(ch.wounds.severity);
    return html`<div className=${'wounds' + (compact ? ' is-compact' : '')}>
      <div className="wound-boxes" aria-label=${`Rasguños: ${ch.wounds.scratches} de ${boxes}`}>
        ${Array.from({ length: boxes }, (_, i) => html`<span key=${i} className=${'box' + (i < ch.wounds.scratches ? ' is-on' : '')}></span>`)}
      </div>
      <div className="wound-ladder" aria-label=${R.SEVERITY_LABELS[ch.wounds.severity]}>
        ${['wounded', 'serious', 'out'].map(
          (sev, i) => html`<span key=${sev} className=${'rung' + (level > i ? ' is-on' : '') + ' rung-' + sev}>${compact ? '' : R.SEVERITY_LABELS[sev]}</span>`,
        )}
      </div>
    </div>`;
  }

  const LuckPips = ({ n, max = 3 }) =>
    html`<span className="luck" aria-label=${`Suerte ${n} de ${max}`} title=${`Suerte ${n} de ${max}`}>
      ${Array.from({ length: max }, (_, i) => html`<span key=${i} className=${'pip' + (i < n ? ' is-on' : '')}></span>`)}
    </span>`;

  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function Die({ value, dim, tone, rolling }) {
    return html`<span className=${`die${dim ? ' is-dim' : ''}${tone ? ' die-' + tone : ''}${rolling ? ' is-rolling' : ''}`} aria-label=${String(value)}>
      ${Array.from({ length: 9 }, (_, i) => html`<i key=${i} className=${PIPS[value].includes(i) ? 'on' : ''}></i>`)}
    </span>`;
  }

  /** Los dados tirados: los que no cuentan (ventaja o desventaja), apagados. */
  function Dice({ rolled, kept, tone }) {
    const rest = [...kept];
    return html`<span className="dice">
      ${rolled.map((v, i) => {
        const k = rest.indexOf(v);
        const used = k >= 0;
        if (used) rest.splice(k, 1);
        return html`<${Die} key=${i} value=${v} dim=${!used} tone=${tone} />`;
      })}
    </span>`;
  }

  /** Las cinco bandas de resultado, de pifia a crítico, a escala. */
  function OddsBar({ odds, compact }) {
    return html`<div className=${'odds' + (compact ? ' is-compact' : '')}>
      <div className="odds-bar" role="img" aria-label=${`Éxito ${R.pct(odds.successChance)}`}>
        ${R.OUTCOMES.map((o) => html`<span key=${o} className=${'seg-' + o} style=${{ flexGrow: odds[o] }} title=${`${R.OUTCOME_LABELS[o]}: ${R.pct(odds[o])}`}></span>`)}
      </div>
      ${!compact &&
      html`<div className="odds-legend">
        ${[...R.OUTCOMES].reverse().map(
          (o) => html`<span key=${o}><i className=${'dot o-' + o}></i>${R.OUTCOME_LABELS[o]} <b>${R.pct(odds[o])}</b></span>`,
        )}
      </div>`}
    </div>`;
  }

  /** Simula la IA que escribe en directo: el texto aparece a trozos y solo crece. */
  function useStream() {
    const [text, setText] = useState('');
    const [running, setRunning] = useState(false);
    const timer = useRef(null);
    useEffect(() => () => clearInterval(timer.current), []);
    function start(full, onDone) {
      clearInterval(timer.current);
      const words = full.split(' ');
      let i = 0;
      setText('');
      setRunning(true);
      timer.current = setInterval(() => {
        i += 2;
        setText(words.slice(0, i).join(' '));
        if (i >= words.length) {
          clearInterval(timer.current);
          setRunning(false);
          onDone && onDone(full);
        }
      }, 70);
    }
    return { text, running, start, setText };
  }

  const INTENTS = {
    talk: ['Hablar', 'speech'],
    act: ['Actuar', 'hand'],
    ask: ['Preguntar', 'question'],
    attack: ['Atacar', 'sword'],
    melee: ['Cuerpo a cuerpo', 'sword'],
    ranged: ['A distancia', 'bow'],
    spell: ['Hechizo', 'spark'],
  };

  const npcName = (id) => D.NPCS.find((n) => n.id === id)?.name || id;

  function VisTag({ ev, chars }) {
    if (ev.vis === 'master') return html`<${Pill} tone="master" icon="lock">Solo el máster<//>`;
    if (ev.vis === 'private') return html`<${Pill} tone="secret" icon="eyeOff">En secreto · ${chars[ev.player]?.name}<//>`;
    return null;
  }

  /** Una entrada del registro. `children` son las acciones que tiene quien mira. */
  function EventCard({ ev, s, viewer, superseded, pending, children }) {
    const chars = s.chars;
    const vis = html`<${VisTag} ev=${ev} chars=${chars} />`;
    const cls = `ev ev-${ev.kind} vis-${ev.vis}${superseded ? ' is-superseded' : ''}`;
    const time = html`<time className="ev-time">${ev.at}</time>`;
    switch (ev.kind) {
      case 'opened':
        return html`<div className="ev-line">${time}Empieza la partida ${ev.number}. Todos recuperan la Suerte.</div>`;
      case 'scene':
        return html`<div className="ev-scene"><span className="eyebrow">Escena</span><strong>${ev.title}</strong>${ev.recovered && html`<span className="muted">Recuperan el aliento</span>`}</div>`;
      case 'floor':
        return html`<div className="ev-line">${time}<${Icon} name="speech" size=${14} /> La palabra: <b>${ev.floor.kind === 'character' ? chars[ev.floor.id].name : ev.floor.kind === 'table' ? 'la mesa' : 'el máster'}</b></div>`;
      case 'turn':
        return html`<div className="ev-line ev-turn">${time}Ronda ${ev.round} · Turno de <b>${ev.name}</b></div>`;
      case 'combatLeft':
        return html`<div className="ev-line">${time}<b>${ev.name}</b> sale${ev.name.endsWith('s') ? 'n' : ''} del combate.</div>`;
      case 'combatEnded':
        return html`<div className="ev-line ev-turn">${time}Termina el combate.${ev.recovered ? ' Recuperan el aliento.' : ''}</div>`;
      case 'ability':
        return html`<div className="ev-line">${time}<b>${chars[ev.char].name}</b> usa ${R.SKILL[ev.skill].label}.</div>`;
      case 'survived':
        return html`<div className="ev-line">${time}<${Icon} name="clover" size=${14} /> <b>${ev.name}</b> gasta Suerte y sigue con vida.</div>`;
      case 'settled':
        return null;
      case 'reveal':
        return html`<article className=${cls}>
          <header className="ev-head"><${Icon} name="scroll" size=${15} /><span>${ev.title || 'El máster describe'}</span>${vis}${time}</header>
          <p className="ev-prose">${ev.body}</p>
          ${children}
        </article>`;
      case 'speech':
        return html`<article className=${cls}>
          <header className="ev-head"><${Avatar} name=${npcName(ev.npc)} size="xs" /><span>${npcName(ev.npc)}</span>${vis}${time}</header>
          <blockquote className="ev-quote">${ev.text}</blockquote>
          ${children}
        </article>`;
      case 'note':
        return html`<article className=${cls}>
          <header className="ev-head"><${Icon} name="note" size=${15} /><span>Nota</span>${vis}${time}</header>
          <p>${ev.text}</p>
        </article>`;
      case 'intervention': {
        const ch = chars[ev.char];
        const [label, icon] = INTENTS[ev.intent];
        return html`<article className=${cls}>
          <header className="ev-head">
            <${Avatar} name=${ch.name} color=${ch.color} size="xs" />
            <span>${ch.name} · <${Icon} name=${icon} size=${14} /> ${label}${ev.target ? ` → ${ev.target.name}` : ''}</span>${vis}${time}
          </header>
          ${ev.text && html`<p className="ev-said">${ev.text}</p>`}
          ${pending && html`<span className="ev-wait">Esperando al máster</span>`}
          ${children}
        </article>`;
      }
      case 'rollRequest':
        return html`<article className=${cls}>
          <header className="ev-head"><${Icon} name="dice" size=${15} /><span>Tirada pedida a ${chars[ev.char].name}</span>${vis}${time}</header>
          <p><b>${ev.what}</b> ${ev.target}</p>
          ${pending && html`<span className="ev-wait">Por tirar</span>`}
          ${children}
        </article>`;
      case 'roll': {
        const r = ev.result;
        return html`<article className=${cls}>
          <header className="ev-head">
            <${Icon} name="dice" size=${15} /><span>${ev.actor} · ${ev.what}</span>${ev.reroll && html`<${Pill} tone="luck" icon="clover">Con Suerte<//>`}${vis}${time}
          </header>
          <div className="roll-line">
            <${Dice} rolled=${r.dice.rolled} kept=${r.dice.kept} />
            <span className="roll-math">${R.signed(r.bonus).replace('+', '+ ')} = <b>${r.total}</b></span>
            <span className="roll-vs">${r.rival ? html`contra <${Dice} rolled=${r.rival.kept} kept=${r.rival.kept} tone="rival" /> ${R.signed(r.rival.bonus)} = <b>${r.goal}</b>` : html`contra <b>${r.goal}</b>`}</span>
          </div>
          <p className="roll-target">${ev.targetLabel}${r.edge && r.edge !== 'none' ? ` · ${R.EDGES[r.edge]}` : ''}</p>
          <div className=${'outcome o-' + r.outcome}>
            <strong>${R.OUTCOME_LABELS[r.outcome]}</strong>
            <span>${R.OUTCOME_GUIDES[ev.situation || 'test'][r.outcome]}</span>
          </div>
          ${superseded && html`<p className="muted small">Se repitió con Suerte: cuenta la repetición.</p>`}
          ${children}
        </article>`;
      }
      case 'damage':
        return html`<article className=${cls}>
          <header className="ev-head"><${Icon} name="heart" size=${15} /><span>${ev.by ? `${ev.by} golpea a ${ev.to}` : `Daño a ${ev.to}`}</span>${time}</header>
          <p className="dmg-math">${ev.parts.map((p, i) => html`<span key=${i}>${i ? (p.value < 0 ? ' − ' : ' + ') : ''}${p.label} ${Math.abs(p.value)}</span>`)}<b> → ${ev.total}</b></p>
          <p className=${ev.lethal ? 'dmg-after is-lethal' : 'dmg-after'}>${ev.lethal ? '¡Golpe mortal! Puede gastar Suerte para seguir con vida.' : viewer === 'master' ? ev.after : ev.afterPublic || ev.after}</p>
          ${children}
        </article>`;
      case 'combatStarted':
        return html`<article className=${cls}>
          <header className="ev-head"><${Icon} name="sword" size=${15} /><span>Empieza el combate</span>${time}</header>
          <ol className="init-list">
            ${ev.order.map(
              (o, i) => html`<li key=${i}><span className="init-n">${o.init}</span>${o.name}<span className="muted small">${o.dice.join(' + ')} ${R.signed(o.bonus)}</span></li>`,
            )}
          </ol>
        </article>`;
      default:
        return null;
    }
  }

  function Toasts() {
    const s = DC.store.useStore();
    return html`<div className="toasts" aria-live="polite">
      ${s.toasts.map((t) => html`<div key=${t.id} className="toast"><${Icon} name="check" size=${16} />${t.text}</div>`)}
    </div>`;
  }

  DC.ui = { html, Icon, Seg, Avatar, Pill, WoundTrack, LuckPips, Die, Dice, OddsBar, useStream, EventCard, Toasts, INTENTS, npcName };
})();
