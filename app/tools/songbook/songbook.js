/* ============================================================
   Herramienta: Cancionero (principal). Se registra en SB.registry.
   Vistas: catálogo (repertorio) y canción (visor + editor).
   Edición: modo "Acordes" (ladrillos arrastrables) y modo "Letra"
   (filas con regla del guion). Persiste vía SB.store.
   Depende de SB.music, SB.store, SB.ui.
   ============================================================ */
(function () {
  window.SB = window.SB || {};
  const M = () => SB.music;
  const esc = (s) => SB.ui.esc(s);

  const S = {
    ctx: null, view: null,
    cur: null, transp: 0, notation: 'am', profile: 'guitarra',
    editMode: null, // null | 'acordes' | 'letra'
    chW: 8.4, saveTimer: null, pop: null, drag: null
  };

  const isSeed = (id) => (window.SB.SONGS || []).some((s) => s.id === id);

  /* ---------------- montaje / ruteo interno ---------------- */
  function mount(view, rest, ctx) {
    S.view = view; S.ctx = ctx;
    closePop();
    const m = /^song\/(.+)$/.exec(rest || '');
    if (m) openSong(decodeURIComponent(m[1]));
    else renderCatalog();
  }

  /* ---------------- catálogo ---------------- */
  function renderCatalog() {
    S.editMode = null;
    const list = SB.store.library();
    S.view.innerHTML = `
      <div class="rep-head">
        <h1>Repertorio</h1>
        <div style="display:flex;gap:14px;align-items:baseline">
          <span class="count">${list.length} canciones · ${list.filter((s) => s.loaded).length} listas</span>
          <button class="mini-app-btn" id="newSong">+ Nueva canción</button>
        </div>
      </div>
      <input class="search" placeholder="Buscar por título o intérprete…" aria-label="Buscar">
      <table class="rep">
        <thead><tr><th>Canción</th><th>Intérprete</th><th>Tono</th><th>Partes</th><th></th></tr></thead>
        <tbody id="repBody"></tbody>
      </table>`;
    const body = S.view.querySelector('#repBody');
    const draw = (f) => {
      const q = (f || '').toLowerCase();
      const rows = list.filter((s) => !q || (s.title + ' ' + s.artist).toLowerCase().includes(q));
      body.innerHTML = rows.map((s) => {
        if (!s.loaded) return `<tr class="stub"><td class="t-title">${esc(s.title)}</td><td>${esc(s.artist)}</td><td class="t-key">${esc(s.key)}</td><td>—</td><td><span class="badge">Por migrar</span></td></tr>`;
        return `<tr class="song" data-id="${esc(s.id)}"><td class="t-title">${esc(s.title)}</td><td>${esc(s.artist)}</td><td class="t-key">${esc(s.key)}</td><td>${s.nParts} partes</td><td><span class="badge">${s.hasLyrics ? 'Letra + acordes' : 'Solo acordes'}</span></td></tr>`;
      }).join('');
      body.querySelectorAll('tr.song').forEach((tr) => tr.addEventListener('click', () => S.ctx.navigate('songbook/song/' + encodeURIComponent(tr.dataset.id))));
    };
    draw('');
    S.view.querySelector('.search').addEventListener('input', (e) => draw(e.target.value));
    S.view.querySelector('#newSong').addEventListener('click', newSong);
  }

  function newSong() {
    const id = 'cancion-' + Date.now().toString(36);
    const song = { id, title: 'Nueva canción', artist: '', key: 'C', loaded: true,
      parts: [{ name: 'Parte A', lines: [{ l: '', a: [] }] }] };
    SB.store.save(song);
    S.editMode = 'letra';
    S.ctx.navigate('songbook/song/' + id);
  }

  /* ---------------- canción ---------------- */
  function openSong(id) {
    const song = SB.store.get(id);
    if (!song || song.loaded === false) { renderCatalog(); return; }
    S.cur = song; S.transp = 0;
    const hasLyrics = (song.parts || []).some((p) => p.lines);
    if (!hasLyrics && S.profile === 'cantar') S.profile = 'guitarra';
    S.view.innerHTML = `
      <button class="back" id="sbBack">← Repertorio</button>
      <div class="song-head"><h1 id="sTitle"></h1><p class="artist" id="sArtist"></p></div>
      <div class="controls">
        <div class="ctl"><span class="ctl-label">Vista</span>
          <div class="seg" id="segProfile">
            <button data-p="cantar">Cantar</button><button data-p="piano">Piano</button>
            <button data-p="guitarra">Guitarra</button><button data-p="acordes">Solo acordes</button>
          </div>
        </div>
        <div class="ctl"><span class="ctl-label">Tono</span>
          <div class="stepper">
            <button id="kDown" aria-label="Bajar medio tono">−</button>
            <span class="val" id="keyVal">C</span>
            <button id="kUp" aria-label="Subir medio tono">+</button>
          </div>
        </div>
        <div class="ctl"><span class="ctl-label">Notación</span>
          <div class="seg" id="segNot"><button data-n="am">A · B · C</button><button data-n="do">DO · RE · MI</button></div>
        </div>
        <label class="check" id="ckDiagWrap"><input type="checkbox" id="ckDiag" checked> Diagramas al costado</label>
        <label class="check"><input type="checkbox" id="ckExpand"> Expandir partes repetidas</label>
        <div class="ctl"><span class="ctl-label">Editar</span>
          <div class="seg" id="segEdit"><button data-e="acordes">Acordes</button><button data-e="letra">Letra</button></div>
        </div>
      </div>
      <div class="edit-hint" id="editHint" style="display:none"></div>
      <div id="editToolbar"></div>
      <div class="song-layout" id="songLayout">
        <div id="songBody"></div>
        <aside class="chordpanel" id="chordPanel">
          <p class="panel-title" id="panelTitle">Acordes de la canción</p>
          <div class="diag-list" id="diagList"></div>
        </aside>
      </div>`;
    S.view.querySelector('#sbBack').addEventListener('click', () => S.ctx.navigate('songbook'));
    S.view.querySelector('#kDown').addEventListener('click', () => { S.transp--; renderSong(); });
    S.view.querySelector('#kUp').addEventListener('click', () => { S.transp++; renderSong(); });
    S.view.querySelectorAll('#segProfile button').forEach((b) => b.addEventListener('click', () => { S.profile = b.dataset.p; renderSong(); }));
    S.view.querySelectorAll('#segNot button').forEach((b) => b.addEventListener('click', () => { S.notation = b.dataset.n; renderSong(); }));
    S.view.querySelectorAll('#segEdit button').forEach((b) => b.addEventListener('click', () => { setEdit(b.dataset.e); }));
    S.view.querySelector('#ckDiag').addEventListener('change', renderSong);
    S.view.querySelector('#ckExpand').addEventListener('change', renderSong);
    S.view.querySelector('#diagList').addEventListener('click', onDiagClick);
    attachEditListeners();
    renderSong();
  }

  function setEdit(m) {
    S.editMode = (S.editMode === m) ? null : m;
    if (S.editMode) measureCh();
    closePop();
    renderSong();
  }

  /* ---------------- persistencia ---------------- */
  function persist() { SB.store.save(S.cur); }
  function scheduleSave() {
    if (S.saveTimer) clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(persist, 300);
  }

  /* ---------------- render (visor + editor) ---------------- */
  function chordRow(a) {
    let plain = '', html = '';
    for (const [pos, name] of a) {
      const d = M().displayChord(name, S.transp, S.notation);
      const target = Math.max(pos, plain.length ? plain.length + 1 : 0);
      const pad = ' '.repeat(Math.max(0, target - plain.length));
      plain += pad + d; html += pad + esc(d);
    }
    return html;
  }
  function gridRow(seq) {
    return seq.map((c) => c === '%' ? '<span class="sep">%</span>' : esc(M().displayChord(c, S.transp, S.notation))).join('<span class="sep">·</span>');
  }
  function songChords() {
    const set = [];
    const push = (c) => { if (c !== '%' && !set.includes(c)) set.push(c); };
    for (const p of S.cur.parts) {
      if (p.grid) p.grid.forEach((r) => r.forEach(push));
      if (p.lines) p.lines.forEach((l) => l.a.forEach(([, c]) => push(c)));
    }
    return set;
  }

  function renderSong() {
    const q = (sel) => S.view.querySelector(sel);
    const edAc = S.editMode === 'acordes', edLe = S.editMode === 'letra';
    q('#sTitle').textContent = S.cur.title;
    q('#sArtist').textContent = S.cur.artist || (S.editMode ? '(sin intérprete)' : '');
    q('#keyVal').textContent = M().displayChord(S.cur.key === '—' ? 'C' : S.cur.key, S.transp, S.notation)
      + (S.transp ? (S.transp > 0 ? ' +' : ' ') + S.transp + '½' : '');
    S.view.querySelectorAll('#segProfile button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.p === S.profile));
    S.view.querySelectorAll('#segNot button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.n === S.notation));
    S.view.querySelectorAll('#segEdit button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.e === S.editMode));

    const hint = q('#editHint');
    hint.style.display = S.editMode ? '' : 'none';
    hint.innerHTML = edAc
      ? `<b>Editar acordes</b> — cada acorde es un ladrillo: <b>arrástralo</b> por la línea (se imanta a la sílaba). <b>Tócalo</b> para cambiarlo o eliminarlo. <b>Clic en el espacio vacío</b> sobre la letra para agregar uno (acepta DO/RE/MI o C/D/E). En las grillas, toca un acorde para cambiarlo.`
      : `<b>Editar letra</b> — escribe sobre cada verso; los acordes quedan de referencia arriba. Un <b>guion «-» parte la línea</b>; <b>Enter</b> también divide; <b>Retroceso</b> al inicio une con la fila anterior.`;

    renderToolbar();

    const expand = q('#ckExpand').checked;
    const showLyrics = S.editMode ? true : S.profile !== 'acordes';
    const body = q('#songBody');
    body.className = (!S.editMode && S.profile === 'cantar') ? 'cantar' : '';

    let out = '';
    for (let pi = 0; pi < S.cur.parts.length; pi++) {
      const p = S.cur.parts[pi];
      let head = `<div class="part-head"><span class="part-name"${S.editMode ? ' contenteditable="true" data-partname="' + pi + '"' : ''}>${esc(p.name)}</span>`
        + (p.note ? `<span class="part-note">${esc(p.note)}</span>` : '')
        + (p.ref ? `<span class="part-ref">↺ ${esc(p.refNote || 'repite ' + p.ref)}</span>` : '')
        + (S.editMode ? `<button class="mini-x" data-delpart="${pi}" title="Eliminar parte">✕</button>` : '')
        + `</div>`;
      if (!S.editMode && p.ref && !expand && !(showLyrics && p.lines)) {
        out += `<div class="part">${head}<div class="collapsed-ref">Se toca igual que «${esc(p.ref)}» — activa «Expandir partes repetidas» para verla completa.</div></div>`;
        continue;
      }
      let inner = '';
      if (p.lines && showLyrics) {
        for (let li = 0; li < p.lines.length; li++) {
          const ln = p.lines[li];
          if (edAc) inner += editableRow(pi, li, ln);
          else if (edLe) inner += editableLyricRow(pi, li, ln);
          else {
            if (S.profile !== 'cantar' && ln.a.length) inner += `<pre class="line chords">${chordRow(ln.a)}</pre>`;
            inner += `<pre class="line lyric">${esc(ln.l)}</pre>`;
          }
        }
        if (edLe) inner += `<button class="mini-x add" data-addline="${pi}">+ verso</button>`;
      } else if (p.lines && !showLyrics) {
        for (const ln of p.lines) if (ln.a.length) inner += `<div class="grid-row">${gridRow(ln.a.map((x) => x[1]))}</div>`;
      }
      if (p.grid && (S.profile !== 'cantar' || !p.lines || S.editMode)) {
        for (let gi = 0; gi < p.grid.length; gi++) {
          inner += `<div class="grid-row">${edAc ? gridRowEdit(pi, gi, p.grid[gi]) : gridRow(p.grid[gi])}</div>`;
        }
        if (edAc) inner += `<button class="mini-x add" data-addgrid="${pi}">+ fila de acordes</button>`;
      }
      if (!inner) inner = `<div class="collapsed-ref">Parte instrumental</div>`;
      out += `<div class="part">${head}<div class="part-body">${inner}</div></div>`;
    }
    body.innerHTML = out;

    const wantPanel = q('#ckDiag').checked && S.profile !== 'cantar' && !S.editMode;
    q('#songLayout').classList.toggle('no-panel', !wantPanel);
    q('#chordPanel').style.display = wantPanel ? '' : 'none';
    q('#ckDiagWrap').style.visibility = S.profile === 'cantar' ? 'hidden' : 'visible';
    if (wantPanel) {
      q('#panelTitle').textContent = S.profile === 'piano' ? 'Acordes · piano' : 'Acordes · guitarra';
      q('#diagList').innerHTML = songChords().map((c) => {
        const name = M().displayChord(c, S.transp, S.notation);
        return S.profile === 'piano' ? diagPiano(c, name) : diagGuitar(c, name);
      }).join('');
    }
  }

  /* ---------------- barra de edición (metadatos + partes) ---------------- */
  function renderToolbar() {
    const tb = S.view.querySelector('#editToolbar');
    if (!S.editMode) { tb.innerHTML = ''; tb.style.display = 'none'; return; }
    tb.style.display = '';
    tb.innerHTML = `
      <div class="ed-toolbar">
        <label>Título <input id="mTitle" value="${esc(S.cur.title)}"></label>
        <label>Intérprete <input id="mArtist" value="${esc(S.cur.artist || '')}"></label>
        <label>Tono <input id="mKey" value="${esc(S.cur.key || '')}" style="width:56px"></label>
        <span class="tb-sep"></span>
        <button class="mini-x add" id="addLyricPart">+ Parte con letra</button>
        <button class="mini-x add" id="addGridPart">+ Parte de acordes</button>
        <span class="tb-sep"></span>
        <button class="mini-x danger" id="delSong">${isSeed(S.cur.id) ? 'Revertir a original' : 'Eliminar canción'}</button>
        <span class="tb-saved">Guardado automáticamente</span>
      </div>`;
    tb.querySelector('#mTitle').addEventListener('input', (e) => { S.cur.title = e.target.value; S.view.querySelector('#sTitle').textContent = e.target.value; scheduleSave(); });
    tb.querySelector('#mArtist').addEventListener('input', (e) => { S.cur.artist = e.target.value; scheduleSave(); });
    tb.querySelector('#mKey').addEventListener('input', (e) => { S.cur.key = e.target.value; scheduleSave(); });
    tb.querySelector('#addLyricPart').addEventListener('click', () => { S.cur.parts.push({ name: nextPartName(), lines: [{ l: '', a: [] }] }); persist(); renderSong(); });
    tb.querySelector('#addGridPart').addEventListener('click', () => { S.cur.parts.push({ name: nextPartName(), grid: [['C']] }); persist(); renderSong(); });
    tb.querySelector('#delSong').addEventListener('click', () => {
      const seed = isSeed(S.cur.id);
      if (!confirm(seed ? '¿Revertir esta canción a su versión original del repo?' : '¿Eliminar esta canción?')) return;
      SB.store.reset(S.cur.id);
      S.ctx.navigate('songbook');
    });
  }
  function nextPartName() {
    const letters = 'ABCDEFGHIJ';
    const used = new Set(S.cur.parts.map((p) => p.name));
    for (const L of letters) if (!used.has('Parte ' + L)) return 'Parte ' + L;
    return 'Parte ' + (S.cur.parts.length + 1);
  }

  /* ---------------- edición de acordes (ladrillos) ---------------- */
  function measureCh() {
    const el = document.createElement('pre');
    el.className = 'line lyric';
    el.style.cssText = 'position:absolute;visibility:hidden;margin:0';
    el.textContent = '0000000000';
    S.view.appendChild(el);
    S.chW = el.getBoundingClientRect().width / 10 || 8.4;
    el.remove();
  }
  function editableRow(pi, li, ln) {
    const chips = ln.a.map((c, ci) => `<span class="brick" data-pi="${pi}" data-li="${li}" data-ci="${ci}" style="left:${(c[0] * S.chW).toFixed(1)}px">${esc(M().displayChord(c[1], S.transp, S.notation))}</span>`).join('');
    return `<div class="edrow"><div class="edchords" data-pi="${pi}" data-li="${li}" title="Clic para agregar un acorde aquí">${chips}</div><pre class="line lyric">${esc(ln.l) || '&nbsp;'}</pre></div>`;
  }
  function gridRowEdit(pi, gi, row) {
    return row.map((c, i) => c === '%' ? '<span class="sep">%</span>' : `<span class="gchip" data-pi="${pi}" data-gi="${gi}" data-i="${i}" title="Clic para cambiar">${esc(M().displayChord(c, S.transp, S.notation))}</span>`).join('<span class="sep">·</span>')
      + `<span class="gchip add" data-addchord="${pi}" data-gi="${gi}" title="Agregar acorde">＋</span>`;
  }

  /* ---------------- edición de letra (filas + guion) ---------------- */
  function editableLyricRow(pi, li, ln) {
    const ctx = ln.a.length ? `<pre class="line chords dim">${chordRow(ln.a)}</pre>` : '';
    return `<div class="ledrow">${ctx}<div class="lyric-edit" contenteditable="true" spellcheck="false" data-pi="${pi}" data-li="${li}">${esc(ln.l)}</div></div>`;
  }
  function focusLyric(pi, li, offset) {
    const el = S.view.querySelector(`.lyric-edit[data-pi="${pi}"][data-li="${li}"]`);
    if (!el) return;
    el.focus();
    const node = el.firstChild;
    const range = document.createRange(), sel = window.getSelection();
    if (node) range.setStart(node, Math.min(offset, node.textContent.length));
    else range.setStart(el, 0);
    range.collapse(true); sel.removeAllRanges(); sel.addRange(range);
  }
  function splitLine(part, li, cut) {
    const ln = part.lines[li];
    const before = ln.l.slice(0, cut), after = ln.l.slice(cut);
    const stay = [], move = [];
    for (const c of ln.a) { if (c[0] <= before.length) stay.push(c); else move.push([c[0] - before.length, c[1]]); }
    ln.l = before; ln.a = stay;
    part.lines.splice(li + 1, 0, { l: after, a: move });
  }

  /* ---------------- popover cambiar/eliminar/agregar ---------------- */
  function closePop() { if (S.pop) { S.pop.remove(); S.pop = null; } }
  function openPop(rect, initial, onCommit, onDelete) {
    closePop();
    const pop = document.createElement('div');
    pop.className = 'pop';
    pop.innerHTML = `<input value="${esc(initial)}" aria-label="Acorde" placeholder="Am · LAm…"><button class="ok">OK</button>` + (onDelete ? `<button class="del">Eliminar</button>` : '');
    document.body.appendChild(pop);
    S.pop = pop;
    pop.style.left = Math.max(8, Math.min(rect.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - 210)) + 'px';
    pop.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    const inp = pop.querySelector('input');
    inp.focus(); inp.select();
    const commit = () => { const v = M().normalizeInput(inp.value.trim(), S.transp); if (v) onCommit(v); closePop(); persist(); renderSong(); };
    pop.querySelector('.ok').addEventListener('click', commit);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') closePop(); });
    if (onDelete) pop.querySelector('.del').addEventListener('click', () => { onDelete(); closePop(); persist(); renderSong(); });
  }

  /* ---------------- listeners de edición (delegados) ---------------- */
  function attachEditListeners() {
    const body = S.view.querySelector('#songBody');
    const tb = S.view; // toolbar y body dentro de la vista

    // arrastre de ladrillos
    body.addEventListener('pointerdown', (e) => {
      const br = e.target.closest('.brick'); if (!br || S.editMode !== 'acordes') return;
      e.preventDefault(); try { br.setPointerCapture(e.pointerId); } catch (_) {}
      S.drag = { br, startX: e.clientX, startLeft: parseFloat(br.style.left) || 0, moved: false, pos: undefined };
      br.classList.add('drag');
    });
    body.addEventListener('pointermove', (e) => {
      if (!S.drag) return;
      const dx = e.clientX - S.drag.startX;
      if (Math.abs(dx) > 4) S.drag.moved = true;
      if (!S.drag.moved) return;
      const ln = S.cur.parts[+S.drag.br.dataset.pi].lines[+S.drag.br.dataset.li];
      let pos = Math.round((S.drag.startLeft + dx) / S.chW);
      pos = Math.max(0, Math.min(Math.max(0, ln.l.length - 1), pos));
      S.drag.pos = pos; S.drag.br.style.left = (pos * S.chW).toFixed(1) + 'px';
    });
    body.addEventListener('pointerup', () => {
      if (!S.drag) return;
      const { br, moved, pos } = S.drag; br.classList.remove('drag'); S.drag = null;
      const pi = +br.dataset.pi, li = +br.dataset.li, ci = +br.dataset.ci;
      const ln = S.cur.parts[pi].lines[li];
      if (moved && pos !== undefined) { ln.a[ci][0] = pos; ln.a.sort((x, y) => x[0] - y[0]); persist(); renderSong(); }
      else openPop(br.getBoundingClientRect(), M().displayChord(ln.a[ci][1], S.transp, S.notation),
        (v) => { ln.a[ci][1] = v; }, () => { ln.a.splice(ci, 1); });
    });

    // clics: agregar acorde en zona, cambiar chip de grilla, botones de estructura
    body.addEventListener('click', (e) => {
      if (S.editMode !== 'acordes' && S.editMode !== 'letra') return;
      // agregar verso
      const al = e.target.closest('[data-addline]');
      if (al) { const pi = +al.dataset.addline; S.cur.parts[pi].lines.push({ l: '', a: [] }); persist(); renderSong(); return; }
      const ag = e.target.closest('[data-addgrid]');
      if (ag) { const pi = +ag.dataset.addgrid; (S.cur.parts[pi].grid = S.cur.parts[pi].grid || []).push(['C']); persist(); renderSong(); return; }
      const dp = e.target.closest('[data-delpart]');
      if (dp) { if (confirm('¿Eliminar esta parte?')) { S.cur.parts.splice(+dp.dataset.delpart, 1); persist(); renderSong(); } return; }
      if (S.editMode !== 'acordes') return;
      if (e.target.classList.contains('edchords')) {
        const zone = e.target, rect = zone.getBoundingClientRect();
        const pi = +zone.dataset.pi, li = +zone.dataset.li, ln = S.cur.parts[pi].lines[li];
        const pos = Math.max(0, Math.min(Math.max(0, ln.l.length - 1), Math.round((e.clientX - rect.left) / S.chW)));
        openPop({ left: e.clientX, bottom: rect.bottom }, '', (v) => { ln.a.push([pos, v]); ln.a.sort((x, y) => x[0] - y[0]); });
        return;
      }
      const addc = e.target.closest('[data-addchord]');
      if (addc) {
        const pi = +addc.dataset.addchord, gi = +addc.dataset.gi;
        openPop(addc.getBoundingClientRect(), '', (v) => { S.cur.parts[pi].grid[gi].push(v); });
        return;
      }
      const g = e.target.closest('.gchip');
      if (g && !g.classList.contains('add')) {
        const pi = +g.dataset.pi, gi = +g.dataset.gi, i = +g.dataset.i;
        openPop(g.getBoundingClientRect(), g.textContent, (v) => { S.cur.parts[pi].grid[gi][i] = v; },
          () => { S.cur.parts[pi].grid[gi].splice(i, 1); if (!S.cur.parts[pi].grid[gi].length) S.cur.parts[pi].grid.splice(gi, 1); });
      }
    });

    // renombrar parte (contenteditable en el head)
    body.addEventListener('input', (e) => {
      const pn = e.target.closest('[data-partname]');
      if (pn) { S.cur.parts[+pn.dataset.partname].name = pn.textContent; scheduleSave(); return; }
      const el = e.target.closest('.lyric-edit'); if (!el || S.editMode !== 'letra') return;
      const pi = +el.dataset.pi, li = +el.dataset.li, part = S.cur.parts[pi], ln = part.lines[li];
      const text = el.textContent, d = text.indexOf('-');
      if (d >= 0) { ln.l = text.slice(0, d) + text.slice(d + 1); splitLine(part, li, d); persist(); renderSong(); focusLyric(pi, li + 1, 0); }
      else { ln.l = text; scheduleSave(); }
    });
    body.addEventListener('keydown', (e) => {
      if (S.editMode !== 'letra') return;
      const el = e.target.closest('.lyric-edit'); if (!el) return;
      const pi = +el.dataset.pi, li = +el.dataset.li, part = S.cur.parts[pi];
      const caret = window.getSelection().anchorOffset;
      if (e.key === 'Enter') { e.preventDefault(); part.lines[li].l = el.textContent; splitLine(part, li, caret); persist(); renderSong(); focusLyric(pi, li + 1, 0); }
      else if (e.key === 'Backspace' && caret === 0 && li > 0) {
        e.preventDefault(); part.lines[li].l = el.textContent;
        const prev = part.lines[li - 1], ln = part.lines[li], joinAt = prev.l.length;
        prev.l += ln.l; for (const c of ln.a) prev.a.push([c[0] + joinAt, c[1]]); prev.a.sort((a, b) => a[0] - b[0]);
        part.lines.splice(li, 1); persist(); renderSong(); focusLyric(pi, li - 1, joinAt);
      }
    });

    document.addEventListener('pointerdown', (e) => { if (S.pop && !S.pop.contains(e.target)) closePop(); }, true);
  }

  /* ---------------- diagramas ---------------- */
  function amKey(chord) { return S.transp === 0 ? chord : M().displayChord(chord, S.transp, 'am'); }
  function diagGuitar(chord, name) {
    const key = amKey(chord);
    const list = SB.chords.getVoicings(key);
    if (!list.length) return `<div class="diag"><span class="nm">${esc(name)}</span><div class="nodata">sin forma — agrégala en Acordes</div></div>`;
    const chosen = (S.cur.voicings && S.cur.voicings[key]) || list[0];
    const idx = Math.max(0, list.indexOf(chosen));
    const sel = list.length > 1 ? `<span class="alt" data-cycle="${esc(key)}" title="Elegir digitación para esta canción">${idx + 1}/${list.length} ▾</span>` : '';
    return `<div class="diag"><span class="nm">${esc(name)}</span>${SB.diagrams.guitar(list[idx], name)}${sel}</div>`;
  }
  function diagPiano(chord, name) {
    const pcs = M().pitchClasses(amKey(chord));
    return `<div class="diag"><span class="nm">${esc(name)}</span>${SB.diagrams.piano(pcs, name)}</div>`;
  }
  // ciclar la digitación elegida (se guarda por canción)
  function onDiagClick(e) {
    const alt = e.target.closest('[data-cycle]'); if (!alt) return;
    const key = alt.dataset.cycle;
    const list = SB.chords.getVoicings(key); if (list.length < 2) return;
    const cur = (S.cur.voicings && S.cur.voicings[key]) || list[0];
    const next = list[(Math.max(0, list.indexOf(cur)) + 1) % list.length];
    S.cur.voicings = S.cur.voicings || {};
    S.cur.voicings[key] = next;
    persist(); renderSong();
  }

  SB.songbook = { openSong };
  SB.registry.register({ id: 'songbook', name: 'Cancionero', kind: 'primary', mount });
})();
