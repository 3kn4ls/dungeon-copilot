// Las acciones del máster, abajo de la sala: enseñar, hablar por un PNJ, tirar, anotar e ideas.
(function () {
  const DC = (window.DC = window.DC || {});
  const { useState, useEffect } = React;
  const { html, Icon, Seg, Avatar, Pill, useStream } = DC.ui;
  const R = DC.rules;
  const D = DC.data;
  const S = DC.store;

  const SECRET_HINTS = [
    [/hijo|s[óo]tano|tom[áa]s|trampilla/i, 'Brunilda', 0.78],
    [/sargento|guardia del bar[óo]n|expulsa/i, 'Garrick', 0.71],
    [/obispo|esp[íi]a/i, 'Hermano Odo', 0.83],
  ];

  /** El guardián de secretos (Nimble): avisa antes de enseñar algo que deja adivinar un secreto. */
  function useLeakGuard() {
    const [state, setState] = useState(null);
    function guard(text, go) {
      setState({ checking: true });
      setTimeout(() => {
        const hit = SECRET_HINTS.find(([re]) => re.test(text));
        if (hit) setState({ npc: hit[1], p: hit[2], go });
        else {
          setState(null);
          go();
        }
      }, 650);
    }
    const warning =
      state &&
      (state.checking
        ? html`<p className="nimble"><${Icon} name="scales" size=${16} /><span className="muted">Nimble mira si desvela algún secreto…</span></p>`
        : html`<div className="leak" role="alert">
            <${Icon} name="lock" size=${16} />
            <p>Puede desvelar lo que oculta <b>${state.npc}</b> (${Math.round(state.p * 100)} %).</p>
            <button type="button" className="btn small" onClick=${() => { state.go(); setState(null); }}>Enseñar igualmente</button>
            <button type="button" className="btn small ghost" onClick=${() => setState(null)}>Retocar</button>
          </div>`);
    return { guard, warning };
  }

  function AnsweringNote({ ev, s }) {
    if (!ev) return null;
    const ch = s.chars[ev.char];
    return html`<p className="answering"><${Icon} name="hand" size=${15} />Respondes a ${ch.name}: «${ev.text || DC.ui.INTENTS[ev.intent][0]}»</p>`;
  }

  function RevealForm({ s, preset }) {
    const answering = preset?.answers ? s.events.find((e) => e.id === preset.answers) : null;
    const [title, setTitle] = useState('');
    const [to, setTo] = useState(answering && answering.vis === 'private' ? answering.char : '');
    const stream = useStream();
    const leak = useLeakGuard();
    const body = stream.text;
    useEffect(() => {
      if (preset?.body) stream.setText(preset.body);
    }, []);
    const show = () => {
      S.act.reveal({ title, body, to: to || undefined, answers: answering?.id });
      S.act.toast(to ? `Enseñado solo a ${s.chars[to].name}` : 'Enseñado a la mesa y en la pantalla');
      setTitle('');
      stream.setText('');
    };
    return html`<form className="stack" onSubmit=${(e) => { e.preventDefault(); if (body.trim()) leak.guard(`${title} ${body}`, show); }}>
      <${AnsweringNote} ev=${answering} s=${s} />
      <div className="row-fields">
        <label className="field grow">
          <span className="field-label">Título (opcional)</span>
          <input id="reveal-title" value=${title} maxLength="120" placeholder=${s.scene} onChange=${(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Para</span>
          <select id="reveal-to" value=${to} onChange=${(e) => setTo(e.target.value)}>
            <option value="">Toda la mesa</option>
            ${Object.values(s.chars).map((c) => html`<option key=${c.id} value=${c.id}>Solo ${c.name}</option>`)}
          </select>
        </label>
      </div>
      <label className="field">
        <span className="field-label">Lo que ven y oyen</span>
        <textarea id="reveal-body" rows="4" value=${body} placeholder="Escribe la descripción, o unas notas y pide a la IA que la escriba." onChange=${(e) => stream.setText(e.target.value)}></textarea>
      </label>
      ${leak.warning}
      <div className="row-actions">
        <button type="button" className="btn ghost" disabled=${stream.running} onClick=${() => stream.start(D.AI.describe)}>
          <${Icon} name="wand" size=${16} />${stream.running ? 'Escribiendo…' : 'Describir con IA'}
        </button>
        <span className="spacer"></span>
        <button type="submit" className="btn primary" disabled=${!body.trim()}>
          <${Icon} name=${to ? 'eyeOff' : 'eye'} size=${16} />${to ? `Enseñar solo a ${s.chars[to].name}` : 'Enseñar a la mesa'}
        </button>
      </div>
    </form>`;
  }

  function TalkPanel({ s, preset }) {
    const answering = preset?.answers ? s.events.find((e) => e.id === preset.answers) : null;
    const [npcId, setNpcId] = useState(preset?.npc || 'brunilda');
    const [input, setInput] = useState(answering?.text || '');
    const [lines, setLines] = useState([]);
    const [showSecret, setShowSecret] = useState(false);
    const stream = useStream();
    const leak = useLeakGuard();
    const npc = D.NPCS.find((n) => n.id === npcId);

    function answer() {
      const said = input.trim();
      const pool = D.AI.npc[npcId];
      const reply = pool[lines.filter((l) => l.role === 'npc').length % pool.length];
      setLines((ls) => [...ls, ...(said ? [{ role: 'table', text: said }] : [])]);
      setInput('');
      stream.start(reply, (full) => {
        setLines((ls) => [...ls, { role: 'npc', text: full }]);
        stream.setText('');
      });
    }
    function show(text) {
      leak.guard(text, () => {
        S.act.speech({ npc: npcId, text, to: answering && answering.vis === 'private' ? answering.char : undefined, answers: answering?.id });
        S.act.toast(`${npc.name} habla a la mesa`);
      });
    }

    return html`<div className="talk">
      <${AnsweringNote} ev=${answering} s=${s} />
      <div className="talk-npcs" role="group" aria-label="PNJ">
        ${D.NPCS.map(
          (n) => html`<button key=${n.id} type="button" className="chip" aria-pressed=${n.id === npcId} onClick=${() => { setNpcId(n.id); setLines([]); }}>
            <${Avatar} name=${n.name} size="xs" />${n.name}
          </button>`,
        )}
        <button type="button" className="chip" onClick=${() => S.act.toast('La IA improvisa un PNJ con lo que pidas')}><${Icon} name="wand" size=${14} />Improvisar</button>
      </div>
      <div className="talk-card">
        <p><b>${npc.name}</b> · ${npc.concept}</p>
        <p className="muted small">${npc.personality} ${npc.speech}</p>
        <button type="button" className="link-btn small" onClick=${() => setShowSecret(!showSecret)}>
          <${Icon} name=${showSecret ? 'eyeOff' : 'lock'} size=${13} />${showSecret ? npc.secrets : 'Lo que oculta'}
        </button>
      </div>
      <ol className="talk-lines">
        ${lines.map(
          (l, i) => html`<li key=${i} className=${'line-' + l.role}>
            <p>${l.text}</p>
            ${l.role === 'npc' && html`<button type="button" className="btn small" onClick=${() => show(l.text)}><${Icon} name="eye" size=${14} />Enseñar a la mesa</button>`}
          </li>`,
        )}
        ${stream.running && html`<li className="line-npc is-streaming"><p>${stream.text}</p></li>`}
      </ol>
      ${leak.warning}
      <form className="talk-input" onSubmit=${(e) => { e.preventDefault(); answer(); }}>
        <input id="talk-input" value=${input} placeholder="Lo que dicen o hacen los personajes" onChange=${(e) => setInput(e.target.value)} />
        <button type="submit" className="btn primary" disabled=${stream.running}><${Icon} name="wand" size=${16} />Que responda</button>
      </form>
    </div>`;
  }

  function NoteForm() {
    const [text, setText] = useState('');
    return html`<form className="stack" onSubmit=${(e) => { e.preventDefault(); if (text.trim()) { S.act.note(text.trim()); setText(''); S.act.toast('Anotado: solo lo ves tú'); } }}>
      <label className="field">
        <span className="field-label">Nota para ti</span>
        <textarea id="note-text" rows="3" value=${text} placeholder="Lo que no quieres olvidar: solo la ves tú, y al resumen llega si quieres." onChange=${(e) => setText(e.target.value)}></textarea>
      </label>
      <div className="row-actions"><span className="spacer"></span><button type="submit" className="btn primary"><${Icon} name="lock" size=${16} />Anotar</button></div>
    </form>`;
  }

  /** Ideas de la IA que escribe y, en combate, lo que sugiere Nimble del turno de los enemigos. */
  function IdeasPanel({ s }) {
    const [ideas, setIdeas] = useState(null);
    const fighting = !!s.combat;
    const turn = S.turnOf(s.combat);
    const enemyTurn = turn && turn.ref.kind === 'npc';
    useEffect(() => setIdeas(null), [fighting]);
    const list = fighting ? D.AI.enemies : D.AI.ideas;
    return html`<div className="stack">
      <div className="row-actions">
        <button type="button" className="btn ghost" onClick=${() => setIdeas(list)}>
          <${Icon} name="wand" size=${16} />${fighting ? `¿Qué hace ${enemyTurn ? turn.name : 'Garrick'}?` : 'Ideas para cuando la mesa se atasca'}
        </button>
      </div>
      ${ideas &&
      html`<ol className="ideas">
        ${ideas.map(
          (t, i) => html`<li key=${i}><p>${t}</p><button type="button" className="btn small" onClick=${() => S.act.openDock('reveal', { body: t })}>Retocar y enseñar</button></li>`,
        )}
      </ol>`}
      ${fighting &&
      html`<div className="nimble-box">
        <p className="eyebrow"><${Icon} name="scales" size=${14} /> Nimble · a quién atacan</p>
        ${D.AI.targets.map((t, i) => {
          const ch = s.chars[t.id];
          return html`<div key=${t.id} className=${'prob-row' + (i === 0 ? ' is-top' : '')}>
            <${Avatar} name=${ch.name} color=${ch.color} size="xs" /><span>${ch.name}</span>
            <span className="prob-bar"><i style=${{ width: `${t.p * 100}%` }}></i></span><b>${Math.round(t.p * 100)} %</b>
          </div>`;
        })}
        <p className="small muted">Moral de los matones: <b>puede que huyan (35 %)</b>. Lo más probable es que sigan peleando.</p>
      </div>`}
    </div>`;
  }

  function Dock({ s }) {
    const { tab, keys, presets } = s.dock;
    return html`<section className="dock" aria-label="Acciones del máster">
      <div className="dock-tabs">
        <${Seg}
          label="Qué quieres hacer"
          value=${tab}
          onChange=${S.act.setDockTab}
          options=${[
            ['reveal', 'Enseñar', 'eye'],
            ['talk', 'Hablar como PNJ', 'mask'],
            ['roll', 'Tirar', 'dice'],
            ['note', 'Anotar', 'note'],
            ['ideas', 'Ideas', 'wand'],
          ]}
        />
      </div>
      <div className="dock-body">
        <div hidden=${tab !== 'reveal'}><${RevealForm} key=${'r' + (keys.reveal || 0)} s=${s} preset=${presets.reveal} /></div>
        <div hidden=${tab !== 'talk'}><${TalkPanel} key=${'t' + (keys.talk || 0)} s=${s} preset=${presets.talk} /></div>
        <div hidden=${tab !== 'roll'}><${DC.roller.RollComposer} key=${'k' + (keys.roll || 0)} preset=${presets.roll} onDone=${() => S.act.openDock('roll', null)} /></div>
        <div hidden=${tab !== 'note'}><${NoteForm} /></div>
        <div hidden=${tab !== 'ideas'}><${IdeasPanel} s=${s} /></div>
      </div>
    </section>`;
  }

  DC.dock = { Dock, useLeakGuard };
})();
