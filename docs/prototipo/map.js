// El mapa táctico: fichas que se mueven por casillas, medir, señalar y apuntar con las reglas al lado.
(function () {
  const DC = (window.DC = window.DC || {});
  const { useState, useRef, useEffect } = React;
  const { html, Icon, Seg, OddsBar, Pill } = DC.ui;
  const R = DC.rules;
  const D = DC.data;
  const T = DC.tactics;
  const S = DC.store;
  const C = 40;

  const edgeOf = (edges) => {
    const has = (e) => edges.some((x) => x.edge === e);
    return has('advantage') && has('disadvantage') ? 'none' : has('advantage') ? 'advantage' : has('disadvantage') ? 'disadvantage' : 'none';
  };

  /** Probabilidad de una tirada preparada desde el mapa. */
  function presetOdds(s, p) {
    const actor = T.actorCheck(s, p.who, p.skill, p.situation);
    const edge = edgeOf(actor.edges);
    const target = p.target.kind === 'difficulty' ? { difficulty: p.target.value } : { opposed: { bonus: p.target.bonus, edge: edgeOf(p.target.edges || []) } };
    return { actor, edge, odds: R.odds({ bonus: actor.bonus, edge, target }) };
  }

  function tokenColor(s, t) {
    if (t.kind === 'pc') return s.chars[t.char].color;
    return t.kind === 'enemy' ? 'var(--foe)' : 'var(--neutral)';
  }

  function ping(x, y) {
    const id = Math.random();
    S.set((s) => ({ pings: [...(s.pings || []), { id, x, y }] }));
    setTimeout(() => S.set((s) => ({ pings: (s.pings || []).filter((p) => p.id !== id) })), 2400);
  }

  function BattleMap({ mode, viewerChar, compact }) {
    const s = S.useStore();
    const map = D.MAPS.ciervo;
    const svgRef = useRef(null);
    const [tool, setTool] = useState('move');
    const [asTable, setAsTable] = useState(false);
    const [drag, setDrag] = useState(null);
    const [measure, setMeasure] = useState(null);
    const cells = T.cellsOf(map);
    const master = mode === 'master' && !asTable;
    const current = S.turnOf(s.combat);
    const currentToken = current ? S.tokenOf(s, current.ref) : null;
    const tokens = s.tokens.filter((t) => master || !t.hidden);
    const selected = tokens.find((t) => t.id === s.selected);
    const target = tokens.find((t) => t.id === s.target);
    const canDrag = (t) => mode === 'master' || (mode === 'player' && t.char === viewerChar);

    // En su turno, la ficha de quien juega sale elegida.
    useEffect(() => {
      if (mode === 'player' && currentToken && currentToken.char === viewerChar && s.selected !== currentToken.id) S.act.select(currentToken.id);
    }, [mode, currentToken && currentToken.id]);

    function toCell(e) {
      const svg = svgRef.current;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      return { fx: p.x / C, fy: p.y / C, x: Math.floor(p.x / C), y: Math.floor(p.y / C) };
    }

    function clickToken(t) {
      if (mode === 'screen') return;
      const foes = selected && selected.id !== t.id && (selected.kind === 'pc') !== (t.kind === 'pc') && t.kind !== 'neutral' && selected.kind !== 'neutral';
      if (foes && !selected.down) S.act.setTarget(t.id);
      else S.act.select(t.id === s.selected ? null : t.id);
    }

    function down(e, t) {
      if (mode === 'screen') return;
      if (t) e.stopPropagation();
      const c = toCell(e);
      if (tool === 'ping') return ping(c.x, c.y);
      if (tool === 'measure') {
        svgRef.current.setPointerCapture(e.pointerId);
        return setMeasure({ a: { x: c.x, y: c.y }, b: { x: c.x, y: c.y }, active: true });
      }
      if (t) {
        svgRef.current.setPointerCapture(e.pointerId);
        setDrag({ id: t.id, fx: c.fx, fy: c.fy, from: { x: t.x, y: t.y }, moved: false, can: canDrag(t) });
      } else S.act.select(null);
    }
    function move(e) {
      if (!drag && !(measure && measure.active)) return;
      const c = toCell(e);
      if (drag) {
        const moved = drag.moved || Math.hypot(c.fx - drag.from.x - 0.5, c.fy - drag.from.y - 0.5) > 0.6;
        setDrag({ ...drag, fx: c.fx, fy: c.fy, moved });
      } else setMeasure({ ...measure, b: { x: c.x, y: c.y } });
    }
    function up() {
      if (measure && measure.active) setMeasure({ ...measure, active: false });
      if (!drag) return;
      const t = s.tokens.find((x) => x.id === drag.id);
      if (drag.moved && drag.can) {
        const x = Math.max(0, Math.min(map.cols - 1, Math.floor(drag.fx)));
        const y = Math.max(0, Math.min(map.rows - 1, Math.floor(drag.fy)));
        const busy = s.tokens.some((o) => o.id !== t.id && o.x === x && o.y === y && !o.down);
        if (!cells.blocked.has(`${x},${y}`) && !busy) S.act.moveToken(t.id, x, y);
      } else if (!drag.moved) clickToken(t);
      setDrag(null);
    }

    const W = map.cols * C;
    const H = map.rows * C;
    const center = (t) => [(t.x + 0.5) * C, (t.y + 0.5) * C];
    const showBands = selected && selected.kind === 'pc' && s.chars[selected.char].gear.ranged && s.combat && !target && mode !== 'screen';
    const analysis = selected && target ? T.analyze(s, selected, target) : null;

    return html`<div className=${'map' + (compact ? ' is-compact' : '')}>
      ${mode !== 'screen' &&
      html`<div className="map-tools">
        <${Seg}
          label="Herramienta del mapa"
          size="sm"
          value=${tool}
          onChange=${setTool}
          options=${[
            ['move', 'Mover', 'pointer'],
            ['measure', 'Medir', 'ruler'],
            ['ping', 'Señalar', 'pin'],
          ]}
        />
        ${mode === 'master' &&
        html`<button type="button" className="chip" aria-pressed=${asTable} onClick=${() => setAsTable(!asTable)}>
          <${Icon} name=${asTable ? 'eyeOff' : 'eye'} size=${15} />Ver como la mesa
        </button>`}
        <span className="map-name">${map.name} · casilla de 1,5 m</span>
      </div>`}
      <div className="map-frame">
        <svg
          ref=${svgRef}
          className=${'map-svg tool-' + tool}
          viewBox=${`0 0 ${W} ${H}`}
          role="img"
          aria-label=${`Mapa de ${map.name}`}
          onPointerDown=${(e) => down(e, null)}
          onPointerMove=${move}
          onPointerUp=${up}
        >
          <defs>
            <pattern id="planks" width=${C} height=${C / 2} patternUnits="userSpaceOnUse">
              <rect width=${C} height=${C / 2} className="m-floor" />
              <path d=${`M0 ${C / 2 - 0.5}H${C}M${C * 0.6} 0V${C / 2}`} className="m-plank" />
            </pattern>
            <pattern id="flag" width=${C} height=${C} patternUnits="userSpaceOnUse">
              <rect width=${C} height=${C} className="m-stone" />
              <path d=${`M0 ${C / 2}H${C}M${C / 2} 0V${C / 2}M${C / 4} ${C / 2}V${C}`} className="m-plank" />
            </pattern>
            <pattern id="grid" width=${C} height=${C} patternUnits="userSpaceOnUse">
              <path d=${`M${C} 0H0V${C}`} className="m-grid" />
            </pattern>
          </defs>
          <rect width=${W} height=${H} fill="url(#planks)" />
          <rect x=${16 * C} y=${C} width=${5 * C} height=${5 * C} fill="url(#flag)" />
          ${map.zones.map((z) => html`<text key=${z.label} x=${z.x * C} y=${z.y * C} className="m-zone" textAnchor="middle">${z.label}</text>`)}
          ${map.furniture
            .filter((f) => !f.secret || master)
            .map(
              (f, i) => html`<g key=${i} className=${'m-f m-' + f.kind + (f.secret ? ' is-secret' : '')}>
                <rect x=${f.x * C + 3} y=${f.y * C + 3} width=${f.w * C - 6} height=${f.h * C - 6} rx=${f.kind === 'barrel' ? (C - 6) / 2 : 4} />
                ${f.kind === 'stairs' && Array.from({ length: f.h * 3 }, (_, k) => html`<path key=${k} d=${`M${f.x * C + 6} ${f.y * C + 8 + k * 13}H${(f.x + f.w) * C - 6}`} />`)}
                ${f.label && f.w * f.h > 1 && html`<text x=${(f.x + f.w / 2) * C} y=${(f.y + f.h / 2) * C + 4} textAnchor="middle">${f.label}</text>`}
                ${f.secret && html`<text x=${(f.x + 0.5) * C} y=${(f.y + 1) * C + 12} textAnchor="middle" className="m-secret-label">Trampilla</text>`}
              </g>`,
            )}
          ${map.walls.map(([x, y, w, h], i) => html`<rect key=${i} x=${x * C} y=${y * C} width=${w * C} height=${h * C} className="m-wall" />`)}
          ${map.doors.map((d, i) => html`<rect key=${i} x=${d.x * C + 2} y=${d.y * C + 2} width=${d.w * C - 4} height=${d.h * C - 4} className="m-door" />`)}
          ${map.windows.map((d, i) => html`<rect key=${i} x=${d.x * C + 6} y=${d.y * C + 14} width=${d.w * C - 12} height=${d.h * C - 28} className="m-window" />`)}
          <rect width=${W} height=${H} fill="url(#grid)" pointerEvents="none" />

          ${showBands &&
          [12, 6].map((r) => {
            const [cx, cy] = center(selected);
            const half = (r + 0.5) * C;
            return html`<rect key=${r} x=${cx - half} y=${cy - half} width=${half * 2} height=${half * 2} className=${'m-band band-' + r} rx="8" />`;
          })}
          ${showBands && html`<text x=${center(selected)[0]} y=${center(selected)[1] - 6.5 * C + 14} textAnchor="middle" className="m-band-label">corta</text>`}

          ${analysis &&
          html`<g className=${'m-aim' + (analysis.los.clear ? '' : ' is-blocked')}>
            <line x1=${center(selected)[0]} y1=${center(selected)[1]} x2=${center(target)[0]} y2=${center(target)[1]} />
            <circle cx=${center(target)[0]} cy=${center(target)[1]} r="24" />
          </g>`}

          ${measure &&
          html`<g className="m-measure">
            <line x1=${(measure.a.x + 0.5) * C} y1=${(measure.a.y + 0.5) * C} x2=${(measure.b.x + 0.5) * C} y2=${(measure.b.y + 0.5) * C} />
            <text x=${(measure.b.x + 0.5) * C} y=${(measure.b.y + 0.5) * C - 18} textAnchor="middle">
              ${T.distance(measure.a, measure.b)} casillas · ${(T.distance(measure.a, measure.b) * T.CELL_M).toLocaleString('es-ES')} m
            </text>
          </g>`}

          ${tokens.map((t) => {
            const dragging = drag && drag.id === t.id && drag.moved && drag.can;
            const [cx, cy] = dragging ? [drag.fx * C, drag.fy * C] : center(t);
            const group = t.group && D.GROUPS[t.group];
            const prof = group && R.PROFILES[group.profile];
            const isTurn = currentToken && (currentToken.id === t.id || (current.ref.kind === 'npc' && t.group === current.ref.group));
            const cls = ['tk', 'tk-' + t.kind, t.hidden && 'is-hidden', t.down && 'is-down', s.selected === t.id && 'is-selected', s.target === t.id && 'is-target', isTurn && !t.down && 'is-turn', canDrag(t) && mode !== 'screen' && 'can-drag'].filter(Boolean).join(' ');
            return html`<g
              key=${t.id}
              className=${cls}
              style=${{ '--c': tokenColor(s, t) }}
              transform=${`translate(${cx} ${cy})`}
              onPointerDown=${(e) => down(e, t)}
            >
              <circle r="23" className="tk-halo" />
              <circle r="16.5" className="tk-base" />
              <text className="tk-initial" y="5" textAnchor="middle">${t.short || t.name[0]}</text>
              ${prof &&
              prof.endures > 1 &&
              html`<g className="tk-harm">${Array.from({ length: prof.endures }, (_, i) => html`<rect key=${i} x=${-((prof.endures * 7) / 2) + i * 7} y="-27" width="5" height="5" rx="1" className=${i < t.harm ? 'on' : ''} />`)}</g>`}
              ${t.down && html`<path d="M-9 -9L9 9M9 -9L-9 9" className="tk-x" />`}
              <text className="tk-name" y="31" textAnchor="middle">${t.kind === 'enemy' && t.short ? t.name.replace('Matón ', 'Matón ') : t.name.replace('Hermano ', '')}</text>
            </g>`;
          })}

          ${drag &&
          drag.moved &&
          drag.can &&
          html`<text className="m-drag-label" x=${drag.fx * C} y=${drag.fy * C - 30} textAnchor="middle">
            ${T.distance(drag.from, { x: Math.floor(drag.fx), y: Math.floor(drag.fy) })} casillas
          </text>`}
          ${(s.pings || []).map((p) => html`<circle key=${p.id} cx=${(p.x + 0.5) * C} cy=${(p.y + 0.5) * C} r="18" className="m-ping" />`)}
        </svg>
      </div>
      ${mode !== 'screen' && html`<${MapInfo} s=${s} mode=${mode} selected=${selected} target=${target} analysis=${analysis} viewerChar=${viewerChar} />`}
    </div>`;
  }

  /** Debajo del mapa: lo que se ha elegido y, al apuntar, la tirada que sale de dónde está cada uno. */
  function MapInfo({ s, mode, selected, target, analysis, viewerChar }) {
    if (!selected)
      return html`<p className="map-hint"><${Icon} name="pointer" size=${15} />${mode === 'player' ? 'Toca tu ficha y luego a un enemigo para ver tus opciones.' : 'Arrastra las fichas para moverlas. Elige una y toca a un rival para apuntar.'}</p>`;

    const group = selected.group && D.GROUPS[selected.group];
    const prof = group && R.PROFILES[group.profile];
    const status = selected.kind === 'pc'
      ? R.SEVERITY_LABELS[s.chars[selected.char].wounds.severity]
      : prof
        ? selected.down ? 'Ha caído' : `${prof.label} · ${mode === 'master' ? `lleva ${selected.harm} de ${prof.endures}` : selected.harm ? 'herido' : 'en pie'}`
        : 'No pelea';

    return html`<div className="map-info">
      <div className="map-info-head">
        <strong>${selected.name}</strong>
        <span className="muted">${status}</span>
        ${selected.hidden && html`<${Pill} tone="master" icon="eyeOff">Oculto a la mesa<//>`}
        ${mode === 'master' &&
        selected.kind !== 'pc' &&
        html`<button type="button" className="btn small ghost" onClick=${() => S.act.toggleHidden(selected.id)}>
          <${Icon} name=${selected.hidden ? 'eye' : 'eyeOff'} size=${15} />${selected.hidden ? 'Enseñar a la mesa' : 'Ocultar a la mesa'}
        </button>`}
      </div>
      ${!target && html`<p className="map-hint">${selected.kind === 'neutral' ? 'No está en el combate.' : 'Toca a un rival para apuntar.'}</p>`}
      ${analysis &&
      html`<div className="aim">
        <p className="aim-geo">
          <${Icon} name="ruler" size=${15} />
          <span><b>${analysis.dist} ${analysis.dist === 1 ? 'casilla' : 'casillas'}</b> (${analysis.meters.toLocaleString('es-ES')} m) hasta ${target.name}</span>
          ${analysis.adjacent ? html`<${Pill} tone="ember">Cuerpo a cuerpo<//>` : html`<${Pill}>Distancia ${R.RANGES[analysis.range].label.toLowerCase()}<//>`}
          ${!analysis.los.clear && html`<${Pill} tone="foe">Sin línea de visión<//>`}
          ${analysis.los.cover && html`<${Pill} tone="secret">A cubierto tras ${analysis.los.coverName}<//>`}
        </p>
        ${analysis.presets.length === 0 && html`<p className="muted small">${analysis.los.clear ? 'Desde aquí no puede atacarle: acércate o cambia de arma.' : 'Un muro se interpone.'}</p>`}
        ${analysis.presets.map((p, i) => {
          const { actor, edge, odds } = presetOdds(s, p);
          const mine = mode === 'player' && p.who.kind === 'char' && p.who.id === viewerChar;
          return html`<div key=${i} className="aim-option">
            <div className="aim-title"><${Icon} name=${p.icon} size=${16} /><b>${p.label}</b></div>
            <p className="small">
              ${actor.what} ${R.signed(actor.bonus)} ${p.target.kind === 'difficulty' ? html`contra <b>${p.target.value}</b> <span className="muted">(${p.target.parts ? p.target.parts.map((x) => `${x.label} ${x.value}`).join(' + ') : p.target.label})</span>` : p.target.label}
              ${edge !== 'none' && html` · <b>${R.EDGES[edge]}</b>`}
            </p>
            <div className="aim-odds"><${OddsBar} odds=${odds} compact /><b>${R.pct(odds.successChance)}</b></div>
            ${mode === 'master' &&
            html`<button type="button" className="btn small primary" onClick=${() => S.act.openDock('roll', p)}>
              <${Icon} name="dice" size=${15} />Preparar la tirada
            </button>`}
            ${mine &&
            html`<button
              type="button"
              className="btn small primary"
              onClick=${() => {
                S.act.intervene({ char: viewerChar, intent: p.situation === 'test' ? 'spell' : p.situation, text: '', target: { token: target.id, name: target.name } });
                S.act.toast('El máster lo verá en su cola');
              }}
            >
              <${Icon} name=${p.icon} size=${15} />${p.situation === 'melee' ? 'Atacar cuerpo a cuerpo' : p.situation === 'ranged' ? 'Disparar' : 'Lanzar el hechizo'}
            </button>`}
          </div>`;
        })}
      </div>`}
    </div>`;
  }

  DC.map = { BattleMap, presetOdds, edgeOf };
})();
