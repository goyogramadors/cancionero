/* ============================================================
   Biblioteca de acordes de guitarra. window.SB.chords
   Prioridad al pedir voicings de un acorde:
     1) personalizados del usuario (herramienta Acordes)
     2) curados (formas abiertas conocidas, más familiares)
     3) generados por SB.music.guitarVoicings (cubren TODO el resto)
   También guarda "fórmulas personalizadas" para alteraciones que el
   sistema no conozca, de modo que piano y generador las entiendan.
   Persiste en localStorage.
   ============================================================ */
(function () {
  window.SB = window.SB || {};
  const LKEY = 'sb.chords.v1';

  // Formas abiertas curadas (cuerda 0 = Mi grave). Más reconocibles que las generadas.
  const CURATED = {
    'C': ['x32010'], 'Cmaj7': ['x32000'], 'C7': ['x32310'], 'Cadd9': ['x32030'],
    'D': ['xx0232'], 'Dm': ['xx0231'], 'D7': ['xx0212'], 'Dmaj7': ['xx0222'],
    'E': ['022100'], 'Em': ['022000'], 'E7': ['020100'], 'Em7': ['022030'],
    'F': ['133211', 'xx3211'], 'Fm': ['133111'], 'Fmaj7': ['xx3210'],
    'G': ['320003', '320033'], 'G7': ['320001'], 'Gmaj7': ['320002'],
    'A': ['x02220'], 'Am': ['x02210'], 'A7': ['x02020'], 'Am7': ['x02010'], 'Amaj7': ['x02120'],
    'B': ['x24442'], 'Bm': ['x24432'], 'B7': ['x21202'], 'Bm7': ['x20202'],
    'G#dim': ['4x343x'], 'F#dim': ['2x121x'], 'Am/G#': ['4x2210'], 'Am/G': ['3x2210'],
    'C/E': ['032010'], 'C/G': ['332010'], 'D/F#': ['200232'], 'G/B': ['x20003'],
    'Bb': ['x13331'], 'Eb': ['x65343'], 'Ab': ['466544'], 'Db': ['x43121'], 'Gb': ['244322']
  };

  function readStore() { try { return JSON.parse(localStorage.getItem(LKEY) || '{}'); } catch (e) { return {}; } }
  function writeStore(o) { try { localStorage.setItem(LKEY, JSON.stringify(o)); } catch (e) {} }
  let data = readStore();
  data.voicings = data.voicings || {}; // { name: [patterns] }
  data.formulas = data.formulas || {}; // { suffix: [intervals] }
  // registrar fórmulas personalizadas en el motor musical
  SB.music.registerFormulas(data.formulas);

  const memo = {};
  function clearMemo() { for (const k in memo) delete memo[k]; }

  const chords = {
    CURATED,
    // patrones disponibles para un acorde (americano canónico), sin duplicados
    getVoicings(name) {
      if (memo[name]) return memo[name];
      const list = [];
      const add = (p) => { if (p && list.indexOf(p) < 0) list.push(p); };
      (data.voicings[name] || []).forEach(add);
      (CURATED[name] || []).forEach(add);
      (SB.music.guitarVoicings(name, 6) || []).forEach(add);
      memo[name] = list;
      return list;
    },
    addVoicing(name, pattern) {
      if (!name || !/^[x0-9]{6}$/i.test(pattern)) return false;
      data.voicings[name] = data.voicings[name] || [];
      if (data.voicings[name].indexOf(pattern) < 0) data.voicings[name].unshift(pattern);
      writeStore(data); clearMemo(); return true;
    },
    removeVoicing(name, pattern) {
      if (!data.voicings[name]) return;
      data.voicings[name] = data.voicings[name].filter((p) => p !== pattern);
      if (!data.voicings[name].length) delete data.voicings[name];
      writeStore(data); clearMemo();
    },
    addFormula(suf, intervals) {
      if (!suf || !Array.isArray(intervals) || !intervals.length) return false;
      data.formulas[suf] = intervals;
      SB.music.registerFormulas({ [suf]: intervals });
      writeStore(data); clearMemo(); return true;
    },
    removeFormula(suf) { delete data.formulas[suf]; writeStore(data); clearMemo(); },
    customVoicings() { return data.voicings; },
    customFormulas() { return data.formulas; }
  };

  SB.chords = chords;
})();
