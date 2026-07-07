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
    'aug': [0, 4, 8], '+': [0, 4, 8]
  };

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
    const f = FORMULAS[c.suf] || FORMULAS[''];
    const set = new Set(f.map((iv) => (root + iv) % 12));
    if (c.bass) set.add(NOTES.indexOf(c.bass) % 12);
    return [...set];
  }

  SB.music = { NOTES, LATIN_UP, LATIN_TI, FORMULAS, parseChord, tNote, displayChord, normalizeInput, pitchClasses };
})();
