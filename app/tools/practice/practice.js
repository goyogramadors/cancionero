/* ============================================================
   Sub-herramienta: Práctica de acordes al piano. Secundaria.
   Generador aleatorio + metrónomo. Depende de SB.music.
   ============================================================ */
(function () {
  window.SB = window.SB || {};
  const M = () => SB.music;

  const St = {
    view: null, ctx: null,
    bpm: 60, playing: false, beat: 1, measure: 1,
    sharps: false, minors: false, sevenths: false, inversions: false, latin: true,
    field: 'Libre', mode: 'Mayor', perChord: 4,
    current: { nombre: 'C', grado: '' }, next: { nombre: 'G', grado: '' },
    ctxAudio: null, timer: null
  };

  const ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="1"></rect><line x1="9" y1="4" x2="9" y2="14"></line><line x1="15" y1="4" x2="15" y2="14"></line></svg>';

  function fmt(name) {
    if (!name) return '';
    return M().displayChord(name, 0, St.latin ? 'doTitle' : 'am');
  }
  // teclas activas 0..23: tríada/7ª en la octava alta + fundamental o bajo en la baja
  function keys(name) {
    const set = new Set();
    const c = M().parseChord(name);
    if (!c) return set;
    const rootPc = M().NOTES.indexOf(c.root);
    const f = M().FORMULAS[c.suf] || M().FORMULAS[''];
    f.forEach((iv) => set.add(((rootPc + iv) % 12) + 12));
    if (c.bass) set.add(M().NOTES.indexOf(c.bass) % 12);
    else set.add(rootPc);
    return set;
  }
  function gen(prevName) {
    const naturals = ['C', 'D', 'E', 'F', 'G', 'A', 'B'], sharps = ['C#', 'D#', 'F#', 'G#', 'A#'], chrom = M().NOTES;
    const intMaj = [0, 2, 4, 5, 7, 9, 11], intMin = [0, 2, 3, 5, 7, 8, 10];
    const romMaj = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'], romMin = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
    let nombre = '', grado = '';
    if (St.field !== 'Libre') {
      const rootIdx = chrom.indexOf(St.field);
      const intervalos = St.mode === 'Mayor' ? intMaj : intMin;
      const romanos = St.mode === 'Mayor' ? romMaj : romMin;
      const cualidades = St.mode === 'Mayor' ? ['', 'm', 'm', '', '', 'm', 'dim'] : ['m', 'dim', '', 'm', 'm', '', ''];
      const rnd = Math.floor(Math.random() * 7);
      const notaRaiz = chrom[(rootIdx + intervalos[rnd]) % 12];
      let cualidad = cualidades[rnd], extension = '';
      if (St.sevenths && Math.random() > 0.4) {
        const sMaj = ['maj7', 'm7', 'm7', 'maj7', '7', 'm7', 'm7b5'], sMin = ['m7', 'm7b5', 'maj7', 'm7', 'm7', 'maj7', '7'];
        const ext = St.mode === 'Mayor' ? sMaj[rnd] : sMin[rnd];
        if (ext === 'm7b5') { cualidad = 'm7b5'; extension = ''; }
        else if (ext === 'maj7') { cualidad = ''; extension = 'maj7'; }
        else if (ext === '7') { cualidad = ''; extension = '7'; }
        else if (ext === 'm7') { cualidad = 'm'; extension = '7'; }
      }
      nombre = notaRaiz + cualidad + extension; grado = romanos[rnd];
    } else {
      let disp = naturals.slice(); if (St.sharps) disp = disp.concat(sharps);
      const raiz = disp[Math.floor(Math.random() * disp.length)];
      const cualidad = (St.minors && Math.random() > 0.5) ? 'm' : '';
      const extension = (St.sevenths && Math.random() > 0.4) ? '7' : '';
      nombre = raiz + cualidad + extension;
    }
    if (St.inversions && Math.random() > 0.4) {
      const rm = nombre.match(/^[A-G]#?/), rb = rm ? rm[0] : 'C', ri = chrom.indexOf(rb);
      const offs = [0];
      offs.push((nombre.includes('m') && !nombre.includes('maj')) ? 3 : 4);
      offs.push((nombre.includes('dim') || nombre.includes('m7b5')) ? 6 : 7);
      const bo = offs[Math.floor(Math.random() * (offs.length - 1)) + 1];
      nombre += '/' + chrom[(ri + bo) % 12];
    }
    if (nombre === prevName) return gen(prevName);
    return { nombre, grado };
  }

  function q(sel) { return St.view.querySelector(sel); }
  function fieldOptions() {
    const sel = q('#pr-field');
    let h = '<option value="Libre">Modo libre</option><optgroup label="Tono">';
    M().NOTES.forEach((n) => { h += `<option value="${n}">${St.latin ? M().LATIN_TI[n] : n}</option>`; });
    sel.innerHTML = h + '</optgroup>'; sel.value = St.field;
  }
  function buildPiano() {
    const W = 22, BW = 13, H = 88;
    const whiteSemis = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23];
    const blacks = [[1, 0], [3, 1], [6, 3], [8, 4], [10, 5], [13, 7], [15, 8], [18, 10], [20, 11], [22, 12]];
    let h = `<div class="pr-kb" style="width:${14 * W}px;height:${H}px">`;
    whiteSemis.forEach((s, i) => { h += `<div class="pr-key white" data-s="${s}" style="left:${i * W}px;width:${W}px;height:${H}px"><span class="dot"></span></div>`; });
    blacks.forEach(([s, after]) => { h += `<div class="pr-key black" data-s="${s}" style="left:${((after + 1) * W - BW / 2).toFixed(1)}px;width:${BW}px;height:${Math.round(H * 0.6)}px"><span class="dot"></span></div>`; });
    q('#pr-piano').innerHTML = h + '</div>';
    q('#pr-beats').innerHTML = [1, 2, 3, 4].map((t) => `<span class="pr-beat" data-t="${t}"></span>`).join('');
  }
  function setPressed(id, on) { q('#' + id).setAttribute('aria-pressed', on ? 'true' : 'false'); }

  function update() {
    const tonal = St.field !== 'Libre';
    q('#pr-measure').textContent = `Compás ${St.measure}/${St.perChord}`;
    const tl = q('#pr-tonal');
    tl.style.display = tonal ? '' : 'none';
    if (tonal) tl.textContent = `Tono ${fmt(St.field)} ${St.mode}`;
    q('#pr-degree').textContent = St.current.grado || '';
    q('#pr-chord').textContent = fmt(St.current.nombre);
    q('#pr-next').textContent = (St.next.grado ? St.next.grado + ' ' : '') + fmt(St.next.nombre);
    St.view.querySelectorAll('#pr-beats .pr-beat').forEach((b) => {
      const t = +b.dataset.t;
      b.classList.toggle('on', St.playing && t === St.beat);
      b.classList.toggle('first', t === 1);
    });
    const active = keys(St.current.nombre);
    St.view.querySelectorAll('#pr-piano .pr-key').forEach((k) => k.classList.toggle('on', active.has(+k.dataset.s)));
    setPressed('pr-t-sharps', St.sharps); setPressed('pr-t-minors', St.minors);
    setPressed('pr-t-sevenths', St.sevenths); setPressed('pr-t-inv', St.inversions);
    q('#pr-t-sharps').disabled = tonal; q('#pr-t-minors').disabled = tonal;
    q('#pr-not-cap').textContent = St.latin ? 'Do/Re' : 'C/D';
    q('#pr-mode').value = St.mode; q('#pr-mode').disabled = !tonal;
    q('#pr-perchord').value = String(St.perChord);
    const pb = q('#pr-play');
    pb.textContent = St.playing ? 'DETENER' : 'INICIAR'; pb.classList.toggle('playing', St.playing);
    q('#pr-bpm').textContent = St.bpm;
  }
  function optChanged() {
    if (!St.playing) { St.current = gen(''); St.next = gen(St.current.nombre); }
    else St.next = gen(St.current.nombre);
    update();
  }
  function tick(first) {
    if (!St.ctxAudio) return;
    const c = St.ctxAudio, o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination);
    o.frequency.value = first ? 1000 : 700; o.type = 'sine';
    g.gain.setValueAtTime(1, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.1);
    o.start(c.currentTime); o.stop(c.currentTime + 0.1);
  }
  function advance() {
    St.beat++;
    if (St.beat > 4) {
      St.beat = 1; St.measure++;
      if (St.measure > St.perChord) { St.measure = 1; St.current = St.next; St.next = gen(St.next.nombre); }
    }
    tick(St.beat === 1); update();
  }
  function stop() {
    if (!St.playing && !St.timer) return;
    St.playing = false; St.beat = 1; St.measure = 1;
    clearInterval(St.timer); St.timer = null;
  }

  // API expuesta para los onclick del markup
  SB.practice = {
    field(v) { St.field = v; optChanged(); },
    mode(v) { St.mode = v; optChanged(); },
    perChord(v) { St.perChord = Number(v); update(); },
    notation() { St.latin = !St.latin; fieldOptions(); update(); },
    toggle(k) {
      if (k === 'sharps') St.sharps = !St.sharps;
      else if (k === 'minors') St.minors = !St.minors;
      else if (k === 'sevenths') St.sevenths = !St.sevenths;
      else if (k === 'inversions') St.inversions = !St.inversions;
      optChanged();
    },
    playToggle() {
      if (!St.playing) {
        if (!St.ctxAudio) St.ctxAudio = new (window.AudioContext || window.webkitAudioContext)();
        if (St.ctxAudio.state === 'suspended') St.ctxAudio.resume();
        tick(true); St.playing = true;
        St.timer = setInterval(advance, (60 / St.bpm) * 1000);
      } else { stop(); }
      update();
    },
    setBpm(d) {
      St.bpm = Math.max(30, Math.min(240, St.bpm + d));
      if (St.playing) { clearInterval(St.timer); St.timer = setInterval(advance, (60 / St.bpm) * 1000); }
      update();
    }
  };

  function mount(view, rest, ctx) {
    St.view = view; St.ctx = ctx;
    view.innerHTML = `
      <div class="pr-scope">
        <button class="back" id="prBack">← Cancionero</button>
        <div class="rep-head"><h1>Práctica de acordes</h1></div>
        <p class="ed-note">Generador de acordes al azar con metrónomo, para practicar cambios al piano. Elige un campo tonal (o modo libre), activa las alteraciones que quieras y sigue el pulso; el teclado ilumina las notas de cada acorde.</p>
        <div class="pr-wrap">
          <div class="pr-top">
            <span class="lbl" id="pr-measure">Compás 1/4</span>
            <span class="pr-tonal" id="pr-tonal" style="display:none"></span>
            <span class="pr-next-box"><span class="lbl">Siguiente</span><br><span class="pr-next-chord" id="pr-next">Sol</span></span>
          </div>
          <div class="pr-stage">
            <span class="pr-degree" id="pr-degree"></span>
            <span class="pr-chord" id="pr-chord">Do</span>
          </div>
          <div class="pr-piano" id="pr-piano"></div>
          <div class="pr-beats" id="pr-beats"></div>
          <div class="pr-controls">
            <div class="pr-selects">
              <select id="pr-field" onchange="SB.practice.field(this.value)" aria-label="Campo tonal"></select>
              <select id="pr-mode" onchange="SB.practice.mode(this.value)" aria-label="Modo"><option value="Mayor">Mayor</option><option value="Menor">Menor</option></select>
              <select id="pr-perchord" onchange="SB.practice.perChord(this.value)" aria-label="Compases por acorde"><option value="1">1 compás</option><option value="2">2 compases</option><option value="4" selected>4 compases</option></select>
            </div>
            <div class="pr-toggles">
              <button class="pr-toggle" id="pr-t-sharps" aria-pressed="false" onclick="SB.practice.toggle('sharps')"><span class="big">♯</span><span class="cap">Sost.</span></button>
              <button class="pr-toggle" id="pr-t-minors" aria-pressed="false" onclick="SB.practice.toggle('minors')"><span class="big">m</span><span class="cap">Menor</span></button>
              <button class="pr-toggle" id="pr-t-sevenths" aria-pressed="false" onclick="SB.practice.toggle('sevenths')"><span class="big">7</span><span class="cap">Séptima</span></button>
              <button class="pr-toggle" id="pr-t-inv" aria-pressed="false" onclick="SB.practice.toggle('inversions')"><span class="big">/</span><span class="cap">Bajo</span></button>
              <button class="pr-toggle" id="pr-t-not" onclick="SB.practice.notation()"><span class="big">♪</span><span class="cap" id="pr-not-cap">Do/Re</span></button>
            </div>
            <div class="pr-transport">
              <button class="pr-play" id="pr-play" onclick="SB.practice.playToggle()">INICIAR</button>
              <div class="pr-bpm">
                <span class="cap">BPM</span>
                <button onclick="SB.practice.setBpm(-5)" aria-label="Bajar BPM">−</button>
                <span class="val" id="pr-bpm">60</span>
                <button onclick="SB.practice.setBpm(5)" aria-label="Subir BPM">+</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    q('#prBack').addEventListener('click', () => St.ctx.navigate('songbook'));
    fieldOptions(); buildPiano();
    St.current = gen(''); St.next = gen(St.current.nombre);
    update();
  }

  SB.registry.register({ id: 'practice', name: 'Práctica', kind: 'secondary', icon: ICON, mount, onLeave: stop });
})();
