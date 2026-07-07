/* ============================================================
   Sub-herramienta: Acordes. Secundaria.
   Busca cualquier acorde y muestra piano + todas las digitaciones de
   guitarra (curadas + generadas + personalizadas). Permite AGREGAR una
   digitación propia y DEFINIR una alteración desconocida (fórmula).
   Depende de SB.music, SB.chords, SB.diagrams.
   ============================================================ */
(function () {
  window.SB = window.SB || {};
  const M = () => SB.music;
  const esc = (s) => SB.ui.esc(s);
  const ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="1"></rect><line x1="4" y1="8" x2="20" y2="8"></line><line x1="4" y1="13" x2="20" y2="13"></line><circle cx="9" cy="17" r="1.4" fill="currentColor"></circle><circle cx="15" cy="10.5" r="1.4" fill="currentColor"></circle></svg>';

  const St = { view: null, name: 'C' };
  function q(sel) { return St.view.querySelector(sel); }

  function render() {
    const raw = St.name.trim() || 'C';
    const c = M().parseChord(raw);
    const box = q('#chordPreview');
    if (!c) { box.innerHTML = `<p class="ed-note">No entiendo «${esc(raw)}». Prueba algo como C, Am, G7, F#m7b5, Bb/D.</p>`; return; }
    const canon = c.root + c.suf + (c.bass ? '/' + c.bass : '');
    const known = M().formulaFor(c.suf) !== null || c.suf === '';
    const pcs = M().pitchClasses(canon);
    const list = SB.chords.getVoicings(canon);
    const custom = (SB.chords.customVoicings()[canon] || []);

    let g = '';
    if (!list.length) {
      g = `<p class="ed-note">No hay ninguna forma tocable dentro de la ventana estándar para este acorde. Agrega una digitación propia abajo.</p>`;
    } else {
      g = `<div class="diag-list wrap">` + list.map((p) => {
        const isCustom = custom.indexOf(p) >= 0;
        return `<div class="diag"><span class="nm">${esc(p)}</span>${SB.diagrams.guitar(p, canon)}${isCustom ? `<span class="alt" data-del="${esc(p)}" title="Quitar forma propia">✕ propia</span>` : ''}</div>`;
      }).join('') + `</div>`;
    }

    box.innerHTML = `
      <div class="chord-head">
        <span class="chord-canon">${esc(M().displayChord(canon, 0, 'am'))}</span>
        <span class="chord-canon lat">${esc(M().displayChord(canon, 0, 'doTitle'))}</span>
        ${known ? '' : `<span class="chord-warn">alteración «${esc(c.suf)}» desconocida → tratada como mayor</span>`}
      </div>
      <div class="chord-cols">
        <div><p class="panel-title">Piano</p><div class="diag">${SB.diagrams.piano(pcs, canon)}</div></div>
        <div><p class="panel-title">Guitarra · ${list.length} forma(s)</p>${g}</div>
      </div>`;
  }

  function mount(view) {
    St.view = view;
    view.innerHTML = `
      <div class="pr-scope wide">
        <button class="back" id="chBack">← Cancionero</button>
        <div class="rep-head"><h1>Acordes</h1></div>
        <p class="ed-note">Escribe cualquier acorde para ver su digitación en piano y guitarra. Todas las de guitarra se calculan solas (afinación estándar). Si te falta una forma o una alteración, agrégala aquí y queda disponible en todo el cancionero.</p>

        <label class="ch-search">Acorde
          <input id="chName" value="${esc(St.name)}" placeholder="C · Am · G7 · F#m7b5 · Bb/D" autocapitalize="off" spellcheck="false">
        </label>
        <div id="chordPreview"></div>

        <section class="set-block">
          <h2>Agregar una digitación propia (guitarra)</h2>
          <p class="ed-note">Seis caracteres, de la 6ª cuerda (Mi grave) a la 1ª. Usa el número de traste o «x» para muda. Ej.: <code>x32010</code>.</p>
          <div class="set-row">
            <input id="cvPattern" class="mono" placeholder="x32010" maxlength="6" style="width:120px">
            <span id="cvPreview"></span>
            <button class="mini-x add" id="cvAdd">Agregar forma a «<span id="cvFor"></span>»</button>
          </div>
          <span class="set-status" id="cvStatus"></span>
        </section>

        <section class="set-block">
          <h2>Definir una alteración desconocida</h2>
          <p class="ed-note">Si usas un acorde raro (p. ej. <code>7#11</code>) que el sistema no reconoce, dale sus intervalos en semitonos desde la fundamental. Ej. para <code>7#11</code>: <code>0,4,7,10,6</code>. Vale para piano y para generar la guitarra.</p>
          <div class="set-row">
            <input id="cfSuffix" placeholder="sufijo (ej. 7#11)" style="width:130px">
            <input id="cfIntervals" class="mono" placeholder="0,4,7,10,6" style="width:160px">
            <button class="mini-x add" id="cfAdd">Guardar alteración</button>
          </div>
          <span class="set-status" id="cfStatus"></span>
        </section>
      </div>`;

    q('#chBack').addEventListener('click', () => location.hash = '#/songbook');
    const nameInput = q('#chName');
    nameInput.addEventListener('input', () => { St.name = nameInput.value; render(); syncCvFor(); });

    // preview de la forma que se está escribiendo
    const cv = q('#cvPattern');
    cv.addEventListener('input', () => {
      const p = cv.value.trim();
      q('#cvPreview').innerHTML = /^[x0-9]{6}$/i.test(p) ? SB.diagrams.guitar(p, p) : '';
    });
    q('#cvAdd').addEventListener('click', () => {
      const c = M().parseChord(St.name.trim()); if (!c) return;
      const canon = c.root + c.suf + (c.bass ? '/' + c.bass : '');
      const p = cv.value.trim();
      if (SB.chords.addVoicing(canon, p)) { status('#cvStatus', 'Forma agregada a ' + canon + '.'); cv.value = ''; q('#cvPreview').innerHTML = ''; render(); }
      else status('#cvStatus', 'Patrón inválido: deben ser 6 caracteres (0-9 o x).', false);
    });

    q('#cfAdd').addEventListener('click', () => {
      const suf = q('#cfSuffix').value.trim();
      const nums = q('#cfIntervals').value.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n) && n >= 0 && n <= 24);
      if (suf && nums.length >= 2 && SB.chords.addFormula(suf, nums)) {
        status('#cfStatus', 'Alteración «' + suf + '» guardada: ' + nums.join(', ') + '.');
        q('#cfSuffix').value = ''; q('#cfIntervals').value = ''; render();
      } else status('#cfStatus', 'Revisa el sufijo y los intervalos (al menos dos números).', false);
    });

    // borrar forma propia (delegado)
    q('#chordPreview').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]'); if (!del) return;
      const c = M().parseChord(St.name.trim()); if (!c) return;
      const canon = c.root + c.suf + (c.bass ? '/' + c.bass : '');
      SB.chords.removeVoicing(canon, del.dataset.del); render();
    });

    syncCvFor();
    render();
  }
  function syncCvFor() {
    const c = M().parseChord(St.name.trim());
    q('#cvFor').textContent = c ? (c.root + c.suf + (c.bass ? '/' + c.bass : '')) : '—';
  }
  function status(sel, msg, ok) { const el = q(sel); el.textContent = msg; el.style.color = ok === false ? 'var(--ink)' : 'var(--mut)'; }

  SB.registry.register({ id: 'chords', name: 'Acordes', kind: 'secondary', icon: ICON, mount });
})();
