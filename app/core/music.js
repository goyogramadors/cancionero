/* ============================================================
   Núcleo de teoría musical — compartido por todas las herramientas.
   Sin dependencias. Se cuelga de window.SB.music
   ============================================================ */
(function () {
  window.SB = window.SB || {};

  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  // Cifrado latino (dos estilos de mayúsculas)
  const LATIN_UP = { C: 'DO', 'C#': 'DO#', D: 'RE', 'D#': 'RE#', E: 'MI', F: 'FA', 'F#': 'FA#', G: 'SOL', 'G#': 'SOL#', A: 'LA', 'A#': 'LA#', B: 'SI' };
  const LATIN_TI = { C: 'Do', 'C#': 'Do#', D: 'Re', 'D#': 'Re#', E: 'Mi', F: 'Fa', 'F#': 'Fa#', G: 'Sol', 'G#': 'Sol#', A: 'La', 'A#': 'La#', B: 'Si' };
  const FLAT2SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

  // Fórmulas de acorde (semitonos desde la fundamental)
  const FORMULAS = {
    '': [0, 4, 7], 'm': [0, 3, 7], '7': [0, 4, 7, 10], 'm7': [0, 3, 7, 10], 'maj7': [0, 4, 7, 11],
    'dim': [0, 3, 6], 'dim7': [0, 3, 6, 9], 'm7b5': [0, 3, 6, 10], '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9],
    'sus4': [0, 5, 7], '4': [0, 5, 7], 'sus2': [0, 2, 7], '9': [0, 4, 7, 10, 2], 'add9': [0, 4, 7, 2],
    'aug': [0, 4, 8], '+': [0, 4, 8], 'maj9': [0, 4, 7, 11, 2], 'm9': [0, 3, 7, 10, 2],
    'mmaj7': [0, 3, 7, 11], '6/9': [0, 4, 7, 9, 2], '7sus4': [0, 5, 7, 10],
    '7b9': [0, 4, 7, 10, 1], '7#9': [0, 4, 7, 10, 3], '7b5': [0, 4, 6, 10], '7#5': [0, 4, 8, 10],
    '11': [0, 7, 10, 2, 5], '13': [0, 4, 10, 2, 9], 'add11': [0, 4, 7, 5]
  };
  // fórmulas personalizadas (las agrega el usuario vía la herramienta de acordes)
  const CUSTOM_FORMULAS = {};
  function registerFormulas(obj) { if (obj) for (const k in obj) CUSTOM_FORMULAS[k] = obj[k]; }
  function formulaFor(suf) { return FORMULAS[suf] || CUSTOM_FORMULAS[suf] || null; }

  // Parseo: raíz + sufijo (+ bajo opcional). Normaliza bemoles a sostenidos.
  function parseChord(s) {
    if (!s) return null;
    const m = String(s).match(/^([A-G][#b]?)([^\/]*)(?:\/([A-G][#b]?))?$/);
    if (!m) return null;
    const norm = (r) => FLAT2SHARP[r] || r;
    return { root: norm(m[1]), suf: m[2] || '', bass: m[3] ? norm(m[3]) : null };
  }

  // Transpone una nota (clase de altura) por k semitonos.
  function tNote(n, k) {
    const i = NOTES.indexOf(n);
    if (i < 0) return n;
    return NOTES[(i + k + 1200) % 12];
  }

  // Representación de un acorde: transpuesto + notación elegida.
  // notation: 'am' (A/B/C) | 'do' (DO/RE) | 'doTitle' (Do/Re)
  function displayChord(name, k, notation) {
    const c = parseChord(name);
    if (!c) return name;
    const r = tNote(c.root, k || 0);
    const b = c.bass ? tNote(c.bass, k || 0) : null;
    const suf = c.suf.replace('dim', 'º');
    const map = notation === 'do' ? LATIN_UP : notation === 'doTitle' ? LATIN_TI : null;
    const nm = (x) => (map ? map[x] : x);
    return nm(r) + suf + (b ? '/' + nm(b) : '');
  }

  // Entrada libre → nombre canónico americano. Acepta latino (LAm, FA#º) y americano.
  // desTransp: si el usuario escribe lo que "ve" transpuesto, se resta para guardar el original.
  const LAT_IN = [['SOL#', 'G#'], ['SOL', 'G'], ['DO#', 'C#'], ['DO', 'C'], ['RE#', 'D#'], ['RE', 'D'],
    ['MI', 'E'], ['FA#', 'F#'], ['FA', 'F'], ['LA#', 'A#'], ['LA', 'A'], ['SI', 'B']];
  function normalizeInput(s, desTransp) {
    if (!s) return null;
    const conv = (x) => {
      const u = x.toUpperCase();
      for (const [l, a] of LAT_IN) { if (u.startsWith(l)) return a + x.slice(l.length); }
      return x;
    };
    let [main, bass] = String(s).replace(/º/g, 'dim').split('/');
    main = conv(main.trim());
    if (bass) bass = conv(bass.trim());
    const c = parseChord(main + (bass ? '/' + bass : ''));
    if (!c) return null;
    const k = -(desTransp || 0);
    const r = tNote(c.root, k), b = c.bass ? tNote(c.bass, k) : null;
    return r + c.suf + (b ? '/' + b : '');
  }

  // Clases de altura (0..11) de un acorde, con bajo opcional.
  function pitchClasses(name) {
    const c = parseChord(name);
    if (!c) return [];
    const root = NOTES.indexOf(c.root);
    const f = formulaFor(c.suf) || FORMULAS[''];
    const set = new Set(f.map((iv) => (root + iv) % 12));
    if (c.bass) set.add(NOTES.indexOf(c.bass) % 12);
    return [...set];
  }

  // Generador de digitaciones de guitarra (afinación estándar EADGBE).
  // Dado cualquier acorde, calcula formas tocables con la fundamental (o el
  // bajo) en la cuerda más grave, dentro de una ventana de 4 trastes. Devuelve
  // varios patrones "x32010" ordenados por comodidad. Cubre TODOS los acordes.
  const TUNING = [4, 9, 2, 7, 11, 4]; // Mi La Re Sol Si Mi (clases de altura), cuerda 0 = Mi grave
  function guitarVoicings(name, max) {
    max = max || 5;
    const c = parseChord(name);
    if (!c) return [];
    const rootPc = NOTES.indexOf(c.root);
    const formula = formulaFor(c.suf) || FORMULAS[''];
    const chordSet = new Set(formula.map((iv) => (rootPc + iv) % 12));
    const bassPc = c.bass != null ? NOTES.indexOf(c.bass) % 12 : rootPc;
    const allowed = new Set(chordSet); allowed.add(bassPc);
    const SPAN = 3, MAXF = 9, need = chordSet.size;
    let chordMask = 0; chordSet.forEach((pc) => { chordMask |= (1 << pc); });
    const out = [];
    for (let base = 0; base <= MAXF; base++) {
      const cands = TUNING.map((openPc) => {
        const cs = [-1];
        if (allowed.has(openPc % 12)) cs.push(0);
        for (let f = Math.max(1, base); f <= Math.min(base + SPAN, MAXF); f++) if (allowed.has((openPc + f) % 12)) cs.push(f);
        return cs;
      });
      const pick = new Array(6);
      (function dfs(s, firstPc, mask) {
        if (s === 6) { consider(pick.slice(), firstPc, mask); return; }
        for (const f of cands[s]) {
          pick[s] = f;
          if (f < 0) dfs(s + 1, firstPc, mask);
          else {
            const pc = (TUNING[s] + f) % 12;
            if (firstPc === null && pc !== bassPc) continue;
            dfs(s + 1, firstPc === null ? pc : firstPc, mask | (1 << pc));
          }
        }
      })(0, null, 0);
    }
    function consider(fr, firstPc, mask) {
      if (firstPc !== bassPc) return;
      if ((mask & chordMask) !== chordMask) return;
      const sounding = []; for (let s = 0; s < 6; s++) if (fr[s] >= 0) sounding.push(s);
      if (sounding.length < Math.max(3, need)) return;
      const fretted = sounding.map((s) => fr[s]).filter((f) => f > 0);
      const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
      if (span > SPAN) return;
      const muted = 6 - sounding.length; if (muted > 3) return;
      let internal = 0; for (let s = sounding[0]; s < sounding[sounding.length - 1]; s++) if (fr[s] < 0) internal++;
      const minF = fretted.length ? Math.min(...fretted) : 0;
      const openCount = sounding.filter((s) => fr[s] === 0).length;
      const score = muted * 3 + internal * 6 + span * 1.0 + minF * 1.15 - openCount * 0.8 - sounding.length * 0.4;
      out.push({ pat: fr.map((f) => (f < 0 ? 'x' : String(f))).join(''), score });
    }
    out.sort((a, b) => a.score - b.score);
    const seen = new Set(), uniq = [];
    for (const o of out) if (!seen.has(o.pat)) { seen.add(o.pat); uniq.push(o.pat); }
    return uniq.slice(0, max);
  }

  SB.music = { NOTES, LATIN_UP, LATIN_TI, FORMULAS, formulaFor, registerFormulas, parseChord, tNote, displayChord, normalizeInput, pitchClasses, guitarVoicings, TUNING };
})();
