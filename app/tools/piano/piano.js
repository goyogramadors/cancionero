/* ============================================================
   Sub-herramienta: Piano — aprender piano POPULAR y funcional
   (acompañar canciones), no clásico. Pestaña primaria.

   Siete temas, cada uno con "Aprender" (explorar con el teclado y el
   sonido) y "Practicar" (ejercicios con puntaje):
     intervalos · acordes · escalas · campo armónico · progresiones ·
     transponer · rítmica

   Sin dependencias fuera de SB. El sonido es un sintetizador propio
   (Web Audio). Si hay un teclado MIDI conectado (piano digital por USB),
   sus teclas cuentan en los ejercicios igual que tocar la pantalla.
   Las notas se deletrean por letra (Re + 3ª mayor = Fa#, no Solb) y en
   Do-Re-Mi o en cifrado americano según el botón de la portada.
   El avance se guarda en este dispositivo (localStorage).
   ============================================================ */
(function () {
  window.SB = window.SB || {};

  var CFGKEY = 'sb.piano.cfg', PROGKEY = 'sb.piano.progreso';
  var S = { view: null, ctx: null, cfg: null, tema: null, modo: 'aprender', st: {}, onKey: null, held: new Set(), midi: null };

  var ICON = '';

  /* ================= teoría: nombres y deletreo ================= */
  var LETRAS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  var PC_LETRA = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var LAT = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };
  var SOST = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var BEM = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  // cómo se llama cada tónica en la práctica (las tonalidades con menos alteraciones)
  var RAIZ_MAYOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  var RAIZ_MENOR = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

  function mod12(n) { return ((n % 12) + 12) % 12; }
  function pcDe(nombre) {
    var m = /^([A-G])(#{1,2}|b{1,2})?/.exec(nombre || '');
    if (!m) return 0;
    var acc = m[2] || '';
    return mod12(PC_LETRA[m[1]] + (acc[0] === '#' ? acc.length : -acc.length));
  }
  function raizNombre(pc, menor) { return (menor ? RAIZ_MENOR : RAIZ_MAYOR)[mod12(pc)]; }
  // Nota a distancia `semis` de la raíz, escrita con la letra que corresponde
  // al grado (3ª de Re = alguna Fa; 4 semitonos = Fa#).
  function deletrear(raiz, semis, grado) {
    var li = LETRAS.indexOf(raiz[0]);
    var letra = LETRAS[(li + grado - 1) % 7];
    var dif = mod12(pcDe(raiz) + semis - PC_LETRA[letra]);
    if (dif > 6) dif -= 12;
    if (Math.abs(dif) > 2) return (dif > 0 ? SOST : BEM)[mod12(pcDe(raiz) + semis)]; // no debería pasar
    var n = letra + (dif > 0 ? '#'.repeat(dif) : 'b'.repeat(-dif));
    // en piano popular nadie escribe Cb, E# ni dobles alteraciones: se usa la tecla simple
    return SIMPLE[n] || (Math.abs(dif) === 2 ? (dif > 0 ? SOST : BEM)[mod12(pcDe(raiz) + semis)] : n);
  }
  var SIMPLE = { Cb: 'B', Fb: 'E', 'E#': 'F', 'B#': 'C' };
  // Texto visible: cifrado americano o Do-Re-Mi (también dentro de acordes: "Bbm7" → "Sibm7")
  function ver(txt) {
    if (!S.cfg.latin) return String(txt);
    return String(txt).replace(/([A-G])(#{1,2}|b{1,2})?/g, function (_, l, acc) { return LAT[l] + (acc || ''); });
  }
  // con bemoles o sostenidos según la armadura de la tonalidad
  function usaBemoles(pc, menor) { return [5, 10, 3, 8, 1].indexOf(mod12(menor ? pc + 3 : pc)) >= 0; }
  function notaPc(pc, bem) { return (bem ? BEM : SOST)[mod12(pc)]; }
  function nombreMidi(m) { return ver(SOST[mod12(m)]); }

  /* ================= teoría: material ================= */
  var INTERVALOS = [
    { s: 1, g: 2, nom: '2ª menor', uso: 'Muy tensa. Al acompañar casi no se toca sola: aparece de paso, entre notas de la melodía.' },
    { s: 2, g: 2, nom: '2ª mayor', uso: 'Es la novena de los acordes add9 y sus2: suaviza un acorde mayor.' },
    { s: 3, g: 3, nom: '3ª menor', uso: 'La que hace MENOR a un acorde (La – Do en Lam).' },
    { s: 4, g: 3, nom: '3ª mayor', uso: 'La que hace MAYOR a un acorde (Do – Mi en Do). Es la nota que más define el acorde.' },
    { s: 5, g: 4, nom: '4ª justa', uso: 'La de los acordes sus4. Del bajo del I al del IV hay una 4ª: el bajo "salta" así muy seguido.' },
    { s: 6, g: 4, nom: '4ª aumentada (tritono)', uso: 'El corazón del acorde de séptima (en Sol7: Si – Fa). Suena inestable y pide resolver.' },
    { s: 7, g: 5, nom: '5ª justa', uso: 'Da cuerpo. En la mano izquierda, fundamental + 5ª suena lleno y sirve para casi cualquier acorde.' },
    { s: 8, g: 6, nom: '6ª menor', uso: 'Color triste; es la 3ª menor invertida.' },
    { s: 9, g: 6, nom: '6ª mayor', uso: 'Los acordes de sexta (Do6) suenan a bolero, swing y música de antes.' },
    { s: 10, g: 7, nom: '7ª menor', uso: 'La séptima de Sol7 o Lam7: color de blues, bolero y bossa.' },
    { s: 11, g: 7, nom: '7ª mayor', uso: 'La de Domaj7: suave y abierta, de balada y bossa.' },
    { s: 12, g: 8, nom: 'Octava', uso: 'La misma nota, más aguda. En la mano izquierda refuerza el bajo.' }
  ];

  var TIPOS = [
    { id: '', nom: 'Mayor', iv: [0, 4, 7], gr: [1, 3, 5], f: '1 – 3 – 5' },
    { id: 'm', nom: 'Menor', iv: [0, 3, 7], gr: [1, 3, 5], f: '1 – ♭3 – 5', menor: true },
    { id: 'dim', nom: 'Disminuido', iv: [0, 3, 6], gr: [1, 3, 5], f: '1 – ♭3 – ♭5', menor: true },
    { id: 'aug', nom: 'Aumentado', iv: [0, 4, 8], gr: [1, 3, 5], f: '1 – 3 – ♯5' },
    { id: 'sus2', nom: 'Sus2', iv: [0, 2, 7], gr: [1, 2, 5], f: '1 – 2 – 5' },
    { id: 'sus4', nom: 'Sus4', iv: [0, 5, 7], gr: [1, 4, 5], f: '1 – 4 – 5' },
    { id: '6', nom: 'Sexta', iv: [0, 4, 7, 9], gr: [1, 3, 5, 6], f: '1 – 3 – 5 – 6' },
    { id: 'm6', nom: 'Menor sexta', iv: [0, 3, 7, 9], gr: [1, 3, 5, 6], f: '1 – ♭3 – 5 – 6', menor: true },
    { id: '7', nom: 'Séptima (dominante)', iv: [0, 4, 7, 10], gr: [1, 3, 5, 7], f: '1 – 3 – 5 – ♭7' },
    { id: 'maj7', nom: 'Séptima mayor', iv: [0, 4, 7, 11], gr: [1, 3, 5, 7], f: '1 – 3 – 5 – 7' },
    { id: 'm7', nom: 'Menor séptima', iv: [0, 3, 7, 10], gr: [1, 3, 5, 7], f: '1 – ♭3 – 5 – ♭7', menor: true },
    { id: 'm7b5', nom: 'Semidisminuido', iv: [0, 3, 6, 10], gr: [1, 3, 5, 7], f: '1 – ♭3 – ♭5 – ♭7', menor: true },
    { id: 'dim7', nom: 'Disminuido séptima', iv: [0, 3, 6, 9], gr: [1, 3, 5, 7], f: '1 – ♭3 – ♭5 – ♭♭7', menor: true },
    { id: 'add9', nom: 'Add9', iv: [0, 4, 7, 14], gr: [1, 3, 5, 9], f: '1 – 3 – 5 – 9' },
    { id: '9', nom: 'Novena', iv: [0, 4, 7, 10, 14], gr: [1, 3, 5, 7, 9], f: '1 – 3 – 5 – ♭7 – 9' }
  ];
  function tipo(id) { for (var i = 0; i < TIPOS.length; i++) if (TIPOS[i].id === id) return TIPOS[i]; return TIPOS[0]; }
  var SUF = { dim: 'º', aug: '+', m7b5: 'm7(b5)', dim7: 'º7' };
  function sufijo(id) { return SUF[id] != null ? SUF[id] : id; }
  function cifra(raiz, tipoId) { return raiz + sufijo(tipoId); }
  function notasAcorde(raiz, tipoId) {
    var t = tipo(tipoId);
    return t.iv.map(function (s, i) { return deletrear(raiz, s, t.gr[i]); });
  }

  var ESCALAS = [
    { id: 'mayor', nom: 'Mayor', iv: [0, 2, 4, 5, 7, 9, 11], gr: [1, 2, 3, 4, 5, 6, 7], uso: 'La base de todo: de ella salen los acordes del campo armónico mayor.' },
    { id: 'menor', nom: 'Menor natural', iv: [0, 2, 3, 5, 7, 8, 10], gr: [1, 2, 3, 4, 5, 6, 7], menor: true, uso: 'La de las baladas tristes. Comparte notas con la mayor que está 3 semitonos arriba (La menor y Do mayor).' },
    { id: 'armonica', nom: 'Menor armónica', iv: [0, 2, 3, 5, 7, 8, 11], gr: [1, 2, 3, 4, 5, 6, 7], menor: true, uso: 'Sube la 7ª para que el V sea mayor (Mi7 en La menor): boleros, tangos, música andina.' },
    { id: 'melodica', nom: 'Menor melódica', iv: [0, 2, 3, 5, 7, 9, 11], gr: [1, 2, 3, 4, 5, 6, 7], menor: true, uso: 'Menor con 6ª y 7ª mayores. Se oye en jazz y en melodías que suben hacia la tónica.' },
    { id: 'penta', nom: 'Pentatónica mayor', iv: [0, 2, 4, 7, 9], gr: [1, 2, 3, 5, 6], uso: 'Cinco notas que no chocan con nada: para adornar e improvisar sobre acordes mayores.' },
    { id: 'pentam', nom: 'Pentatónica menor', iv: [0, 3, 5, 7, 10], gr: [1, 3, 4, 5, 7], menor: true, uso: 'Rock, blues y pop: sobre una canción en menor suena bien casi siempre.' },
    { id: 'blues', nom: 'Blues', iv: [0, 3, 5, 6, 7, 10], gr: [1, 3, 4, 5, 5, 7], menor: true, uso: 'La pentatónica menor más la "blue note" (♭5), que se toca de pasada.' },
    { id: 'dorica', nom: 'Dórica', iv: [0, 2, 3, 5, 7, 9, 10], gr: [1, 2, 3, 4, 5, 6, 7], menor: true, uso: 'Menor con la 6ª mayor: funk, salsa y rock latino (Santana).' },
    { id: 'mixo', nom: 'Mixolidia', iv: [0, 2, 4, 5, 7, 9, 10], gr: [1, 2, 3, 4, 5, 6, 7], uso: 'Mayor con la 7ª menor: rock, cumbia y todo lo que se toca sobre un acorde de séptima.' }
  ];
  function escala(id) { for (var i = 0; i < ESCALAS.length; i++) if (ESCALAS[i].id === id) return ESCALAS[i]; return ESCALAS[0]; }
  function notasEscala(raiz, e) { return e.iv.map(function (s, i) { return deletrear(raiz, s, e.gr[i]); }); }
  function pasos(e) {
    var iv = e.iv.concat([12]), out = [];
    for (var i = 1; i < iv.length; i++) {
      var d = iv[i] - iv[i - 1];
      out.push(d === 1 ? 'S' : d === 2 ? 'T' : d === 3 ? 'T½' : d + 's');
    }
    return out.join(' – ');
  }

  // Campo armónico. En menor el V va mayor (prestado de la armónica): así
  // se toca en la música popular.
  var CAMPO = {
    mayor: { esc: [0, 2, 4, 5, 7, 9, 11], tri: ['', 'm', 'm', '', '', 'm', 'dim'], sep: ['maj7', 'm7', 'm7', 'maj7', '7', 'm7', 'm7b5'],
             rom: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'viiº'], fun: ['T', 'SD', 'T', 'SD', 'D', 'T', 'D'] },
    menor: { esc: [0, 2, 3, 5, 7, 8, 10], tri: ['m', 'dim', '', 'm', '', '', ''], sep: ['m7', 'm7b5', 'maj7', 'm7', '7', 'maj7', '7'],
             rom: ['i', 'iiº', 'III', 'iv', 'V', 'VI', 'VII'], fun: ['T', 'SD', 'T', 'SD', 'D', 'SD', 'D'] }
  };
  var FUNCION = { T: 'Tónica: reposo, "estar en casa"', SD: 'Subdominante: se aleja, prepara', D: 'Dominante: tensión, pide volver a la tónica' };
  // acorde del grado g (0..6) de una tonalidad
  function grado(raiz, modo, g, sept) {
    var c = CAMPO[modo];
    var r = deletrear(raiz, c.esc[g], g + 1);
    var s7 = c.sep[g], rom = !sept ? c.rom[g] : s7 === 'maj7' ? c.rom[g] + 'maj7' : s7 === 'm7b5' ? c.rom[g].replace('º', '') + 'ø7' : c.rom[g] + '7';
    return { raiz: r, tipo: sept ? s7 : c.tri[g], rom: rom, fun: c.fun[g] };
  }

  var PROGS = [
    { id: 'pop', nom: 'I – V – vi – IV', modo: 'mayor', g: [0, 4, 5, 3], txt: 'La progresión del pop: miles de canciones la usan de principio a fin.' },
    { id: '50s', nom: 'I – vi – IV – V', modo: 'mayor', g: [0, 5, 3, 4], txt: 'La de los años 50 y las baladas románticas ("Stand by me").' },
    { id: 'folk', nom: 'I – IV – V – I', modo: 'mayor', g: [0, 3, 4, 0], txt: 'Tónica, subdominante, dominante: folclor, rancheras, rock and roll.' },
    { id: 'iivi', nom: 'ii – V – I', modo: 'mayor', g: [1, 4, 0, 0], sept: true, txt: 'La cadencia del jazz, el bolero y la bossa nova. Se toca con séptimas.' },
    { id: 'circulo', nom: 'I – vi – ii – V', modo: 'mayor', g: [0, 5, 1, 4], sept: true, txt: 'El "círculo": cada acorde lleva al siguiente. Boleros y standards.' },
    { id: 'emo', nom: 'vi – IV – I – V', modo: 'mayor', g: [5, 3, 0, 4], txt: 'La misma del pop empezando en el vi: suena más melancólica.' },
    { id: 'menor', nom: 'i – iv – V – i', modo: 'menor', g: [0, 3, 4, 0], txt: 'La cadencia menor: boleros, baladas y música latinoamericana.' },
    { id: 'andaluza', nom: 'i – VII – VI – V', modo: 'menor', g: [0, 6, 5, 4], txt: 'La andaluza: flamenco, rumba, "Hit the road Jack".' },
    { id: 'blues', nom: 'Blues de 12 compases', modo: 'mayor', g: [0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4], blues: true, txt: 'I7 – IV7 – V7 repartidos en 12 compases: la base del blues y del rock and roll.' }
  ];
  function prog(id) { for (var i = 0; i < PROGS.length; i++) if (PROGS[i].id === id) return PROGS[i]; return PROGS[0]; }
  function acordesProg(p, raiz) {
    return p.g.map(function (g) {
      var a = grado(raiz, p.modo, g, !!p.sept);
      if (p.blues) { a.tipo = '7'; a.rom = CAMPO.mayor.rom[g] + '7'; }
      return a;
    });
  }

  // Ritmos de acompañamiento. Un paso = una corchea (en 6/8 también).
  // Mano izquierda: B = bajo (fundamental), 5 = quinta. Mano derecha: A = el
  // acorde entero; 1 3 5 8 = una nota del acorde (arpegio).
  var RITMOS = [
    { id: 'negras', nom: 'Balada en negras', comp: '4/4', mi: 'B...B...', md: 'A.A.A.A.', txt: 'El acompañamiento más simple: bajo en 1 y 3, acorde en cada tiempo. Para aprender canciones nuevas.' },
    { id: 'corcheas', nom: 'Pop en corcheas', comp: '4/4', mi: 'B...B...', md: 'AAAAAAAA', txt: 'Acordes parejos en corcheas: pop y rock. Marca más fuerte el 1 y el 3.' },
    { id: 'arpegio', nom: 'Balada arpegiada', comp: '4/4', mi: 'B.......', md: '.135831.', txt: 'Las notas del acorde una a una sobre el bajo largo: baladas lentas.' },
    { id: 'vals', nom: 'Vals (3/4)', comp: '3/4', mi: 'B.....', md: '..A.A.', txt: 'Bajo en el 1, acorde en el 2 y el 3: valses, valses peruanos, rancheras.' },
    { id: 'tresillo', nom: 'Bolero / tresillo (3+3+2)', comp: '4/4', mi: 'B...5...', md: 'A..A..A.', txt: 'El tresillo latino: bolero, balada pop latina, reggaetón lento.' },
    { id: 'bossa', nom: 'Bossa nova', comp: '4/4', mi: 'B..5B..5', md: 'A..A.A..', txt: 'Bajo en 1 y 3 con anticipación; acordes a contratiempo. Mejor con séptimas.' },
    { id: 'cumbia', nom: 'Cumbia', comp: '4/4', mi: 'B.5.B.5.', md: '.A.A.A.A', txt: 'Acorde siempre a contratiempo, sobre el bajo que alterna fundamental y quinta.' },
    { id: 'reggae', nom: 'Reggae', comp: '4/4', mi: 'B.......', md: '..A...A.', txt: 'El acorde cae corto en el 2 y el 4 (el "skank").' },
    { id: 'seisocho', nom: '6/8 (cueca, balada lenta)', comp: '6/8', mi: 'B..5..', md: '.AA.AA', txt: 'Dos grupos de tres corcheas: cueca, tonada, baladas en 6/8.' }
  ];
  function ritmo(id) { for (var i = 0; i < RITMOS.length; i++) if (RITMOS[i].id === id) return RITMOS[i]; return RITMOS[0]; }
  function cuentaRitmo(r) {
    var n = r.md.length;
    if (r.comp === '6/8') return ['1', '2', '3', '4', '5', '6'];
    var out = [];
    for (var i = 0; i < n; i++) out.push(i % 2 ? 'y' : String(i / 2 + 1));
    return out;
  }

  /* ================= voces: cómo se toca un acorde ================= */
  // Mano derecha: la inversión más cercana a la anterior (casi sin moverse).
  function midisAcorde(raiz, tipoId) { var p = pcDe(raiz); return tipo(tipoId).iv.map(function (s) { return p + s; }); }
  function candidatos(raiz, tipoId) {
    var pcs = tipo(tipoId).iv.map(function (s) { return mod12(pcDe(raiz) + s); });
    if (pcs.length > 4) pcs = pcs.filter(function (_, i) { return i !== 2; }); // novena: sin la quinta
    var out = [];
    for (var inv = 0; inv < pcs.length; inv++) {
      var rot = pcs.slice(inv).concat(pcs.slice(0, inv));
      for (var base = 52; base <= 67; base++) {
        if (mod12(base) !== rot[0]) continue;
        var v = [base], ok = true;
        for (var k = 1; k < rot.length; k++) {
          var n = v[k - 1] + 1;
          while (mod12(n) !== rot[k]) n++;
          v.push(n);
        }
        if (v[v.length - 1] > 79) ok = false;
        if (ok) out.push(v);
      }
    }
    return out;
  }
  function voz(raiz, tipoId, previa) {
    var cs = candidatos(raiz, tipoId), mejor = cs[0], costo = 1e9;
    cs.forEach(function (v) {
      var c;
      if (previa) {
        c = 0;
        for (var i = 0; i < v.length; i++) {
          var d = 99;
          previa.forEach(function (p) { d = Math.min(d, Math.abs(p - v[i])); });
          c += d;
        }
      } else {
        c = Math.abs(v.reduce(function (a, b) { return a + b; }, 0) / v.length - 64);
      }
      if (c < costo) { costo = c; mejor = v; }
    });
    return mejor;
  }
  function bajo(raiz) { var p = pcDe(raiz); return p >= 5 ? 36 + p : 48 + p; } // de Fa2 a Mi3: grave pero no barroso

  /* ================= sonido ================= */
  function ac() {
    if (!S.ac) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      S.ac = new C();
      S.out = S.ac.createGain(); S.out.gain.value = 0.55;
      var comp = S.ac.createDynamicsCompressor();
      S.out.connect(comp); comp.connect(S.ac.destination);
    }
    if (S.ac.state === 'suspended') S.ac.resume();
    return S.ac;
  }
  function tocar(m, cuando, dur, vel) {
    var c = ac(); if (!c) return;
    cuando = cuando || c.currentTime; dur = dur || 1.4; vel = vel == null ? 0.6 : vel;
    var f = 440 * Math.pow(2, (m - 69) / 12);
    var g = c.createGain(), lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = Math.min(9000, f * 7);
    var o1 = c.createOscillator(), o2 = c.createOscillator(), g2 = c.createGain();
    o1.type = 'triangle'; o1.frequency.value = f;
    o2.type = 'sine'; o2.frequency.value = f * 2; g2.gain.value = 0.22;
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(S.out);
    var pico = vel * (m < 52 ? 0.6 : 0.42);
    g.gain.setValueAtTime(0.0001, cuando);
    g.gain.exponentialRampToValueAtTime(pico, cuando + 0.006);
    g.gain.exponentialRampToValueAtTime(pico * 0.35, cuando + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, cuando + dur);
    o1.start(cuando); o2.start(cuando);
    o1.stop(cuando + dur + 0.05); o2.stop(cuando + dur + 0.05);
  }
  function tocarVarias(ms, cuando, dur, vel) { ms.forEach(function (m) { tocar(m, cuando, dur, vel); }); }
  function clic(cuando, fuerte) {
    var c = ac(); if (!c) return;
    var o = c.createOscillator(), g = c.createGain();
    o.frequency.value = fuerte ? 1500 : 1000; o.type = 'square';
    o.connect(g); g.connect(S.out);
    g.gain.setValueAtTime(fuerte ? 0.12 : 0.06, cuando);
    g.gain.exponentialRampToValueAtTime(0.0001, cuando + 0.04);
    o.start(cuando); o.stop(cuando + 0.05);
  }

  // Reproductor por pasos con planificación anticipada (no se atrasa aunque
  // el navegador esté ocupado). spec: {dur, total|null, sched(i, t), paso(i)}
  var R = { timer: null };
  function reproducir(spec) {
    parar();
    var c = ac(); if (!c) return;
    var i = 0, t = c.currentTime + 0.12, sec = (R.sec = (R.sec || 0) + 1);
    R.t0 = t; R.spec = spec;
    R.timer = setInterval(function () {
      while (t < c.currentTime + 0.15) {
        if (spec.total != null && i >= spec.total) {
          var fin = (t - c.currentTime) * 1000;
          clearInterval(R.timer); R.timer = null;
          setTimeout(function () { if (R.sec === sec && spec.fin) spec.fin(); }, fin);
          return;
        }
        spec.sched(i, t);
        (function (k, espera) {
          setTimeout(function () { if (R.sec === sec && spec.paso) spec.paso(k); }, espera);
        })(i, Math.max(0, (t - c.currentTime) * 1000));
        i++; t += spec.dur;
      }
    }, 25);
  }
  function parar() {
    R.sec = (R.sec || 0) + 1;
    if (R.timer) { clearInterval(R.timer); R.timer = null; }
  }
  function sonando() { return !!R.timer; }

  /* ================= teclado en pantalla ================= */
  // marcas: { midi: {c: 'on'|'sel'|'ok'|'bad'|'tenue', t: 'etiqueta'} }
  var NEGRAS = [1, 3, 6, 8, 10];
  function esNegra(m) { return NEGRAS.indexOf(mod12(m)) >= 0; }
  function teclado(el, desde, hasta, marcas, onPress) {
    var ww = 24, wh = 112, bw = 15, bh = 70, blancas = [];
    for (var m = desde; m <= hasta; m++) if (!esNegra(m)) blancas.push(m);
    var W = blancas.length * ww + 2, svg = '<svg viewBox="0 0 ' + W + ' ' + (wh + 2) + '" class="pk-kb" role="group" aria-label="Teclado">';
    var xDe = {};
    blancas.forEach(function (m, i) { xDe[m] = 1 + i * ww; });
    function marca(m, x, w, y, negra) {
      var k = marcas && marcas[m];
      if (!k) return '';
      var s = '';
      var col = negra ? 'var(--bg)' : 'var(--ink)';
      if (k.c === 'bad') {
        s += '<text x="' + (x + w / 2) + '" y="' + (y + 4) + '" text-anchor="middle" font-size="15" font-weight="700" fill="' + col + '">×</text>';
      } else {
        s += '<circle cx="' + (x + w / 2) + '" cy="' + y + '" r="' + (negra ? 5 : 6.5) + '" fill="' + (k.c === 'tenue' ? 'none' : col) +
          '" stroke="' + col + '" stroke-width="1.5"/>';
      }
      if (k.t) s += '<text x="' + (x + w / 2) + '" y="' + (negra ? y - 10 : y - 12) + '" text-anchor="middle" font-size="' + (negra ? 8 : 9.5) +
        '" font-weight="700" fill="' + col + '">' + SB.ui.esc(k.t) + '</text>';
      return s;
    }
    blancas.forEach(function (m) {
      var k = marcas && marcas[m], tinte = k && (k.c === 'sel' || k.c === 'ok');
      svg += '<rect data-m="' + m + '" x="' + xDe[m] + '" y="1" width="' + ww + '" height="' + wh + '" rx="2" fill="' + (tinte ? 'var(--chip)' : 'var(--bg)') + '" stroke="var(--ink)" stroke-width="1"/>';
      svg += marca(m, xDe[m], ww, wh - 14, false);
      if (mod12(m) === 0) svg += '<text x="' + (xDe[m] + ww / 2) + '" y="' + (wh - 1) + '" text-anchor="middle" font-size="7" fill="var(--faint)">' + nombreMidi(m) + (Math.floor(m / 12) - 1) + '</text>';
    });
    for (m = desde; m <= hasta; m++) {
      if (!esNegra(m)) continue;
      var x = (xDe[m - 1] || 1) + ww - bw / 2, k2 = marcas && marcas[m], tinte2 = k2 && (k2.c === 'sel' || k2.c === 'ok');
      svg += '<rect data-m="' + m + '" x="' + x + '" y="1" width="' + bw + '" height="' + bh + '" rx="2" fill="' + (tinte2 ? 'var(--mut)' : 'var(--ink)') + '" stroke="var(--ink)"/>';
      svg += marca(m, x, bw, bh - 11, true);
    }
    svg += '</svg>';
    el.innerHTML = svg;
    if (onPress) {
      el.querySelector('svg').addEventListener('pointerdown', function (ev) {
        var r = ev.target.closest && ev.target.closest('[data-m]');
        if (!r) {
          // tocó una marca encima de la tecla: buscar la tecla bajo el dedo
          var bajo = document.elementsFromPoint(ev.clientX, ev.clientY).filter(function (n) { return n.dataset && n.dataset.m; })[0];
          r = bajo;
        }
        if (!r) return;
        ev.preventDefault();
        var mm = +r.dataset.m;
        tocar(mm);
        onPress(mm, 'pantalla');
      });
    }
  }

  /* ================= MIDI (piano digital por USB) ================= */
  function conectarMidi(btn) {
    if (!navigator.requestMIDIAccess) { aviso('Este navegador no permite teclados MIDI. Prueba con Chrome en el computador o Android.'); return; }
    navigator.requestMIDIAccess().then(function (acc) {
      S.midi = acc;
      var n = 0;
      acc.inputs.forEach(function (inp) {
        n++;
        inp.onmidimessage = function (e) {
          var st = e.data[0] & 0xf0, nota = e.data[1], vel = e.data[2];
          if (st === 0x90 && vel > 0) { S.held.add(nota); if (S.onKey) S.onKey(nota, 'midi'); }
          else if (st === 0x80 || (st === 0x90 && vel === 0)) S.held.delete(nota);
        };
      });
      if (btn) btn.setAttribute('aria-pressed', n ? 'true' : 'false');
      aviso(n ? 'Teclado MIDI conectado: tus teclas cuentan en los ejercicios.' : 'No encontré teclados MIDI. Conéctalo por USB y vuelve a tocar el botón.');
    }, function () { aviso('No me dieron permiso para usar el teclado MIDI.'); });
  }
  function aviso(txt) { var el = S.view && S.view.querySelector('#pkAviso'); if (el) el.textContent = txt || ''; }

  /* ================= avance ================= */
  function avance() { try { return JSON.parse(localStorage.getItem(PROGKEY) || '{}'); } catch (e) { return {}; } }
  function anotar(tema, ok) {
    var p = avance(), x = p[tema] || (p[tema] = { ok: 0, n: 0, racha: 0, mejor: 0 });
    x.n++;
    if (ok) { x.ok++; x.racha++; x.mejor = Math.max(x.mejor, x.racha); } else x.racha = 0;
    try { localStorage.setItem(PROGKEY, JSON.stringify(p)); } catch (e) {}
    var el = S.view.querySelector('#pkPuntos');
    if (el) el.textContent = puntosTxt(tema);
  }
  function puntosTxt(tema) {
    var x = avance()[tema];
    if (!x || !x.n) return 'Sin ejercicios aún';
    return x.ok + ' de ' + x.n + ' bien · racha ' + x.racha + (x.mejor > 1 ? ' · mejor ' + x.mejor : '');
  }
  function cargarCfg() {
    var d = { latin: true };
    try { Object.assign(d, JSON.parse(localStorage.getItem(CFGKEY) || '{}')); } catch (e) {}
    return d;
  }
  function guardarCfg() { try { localStorage.setItem(CFGKEY, JSON.stringify(S.cfg)); } catch (e) {} }

  /* ================= utilidades de interfaz ================= */
  function q(sel) { return S.view.querySelector(sel); }
  function esc(s) { return SB.ui.esc(s); }
  function azar(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function mezclar(arr) { var a = arr.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function segHtml(id, ops, val) {
    return '<div class="seg" id="' + id + '">' + ops.map(function (o) {
      return '<button data-v="' + esc(o[0]) + '" aria-pressed="' + (String(o[0]) === String(val)) + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function segWire(id, fn) {
    S.view.querySelectorAll('#' + id + ' button').forEach(function (b) {
      b.addEventListener('click', function () {
        S.view.querySelectorAll('#' + id + ' button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        fn(b.dataset.v);
      });
    });
  }
  function selHtml(id, ops, val, label) {
    return '<select class="pk-sel" id="' + id + '" aria-label="' + esc(label || '') + '">' + ops.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }
  function selRaiz(id, val, menor) {
    var ns = menor ? RAIZ_MENOR : RAIZ_MAYOR;
    return selHtml(id, ns.map(function (n) { return [n, ver(n)]; }), val, 'Nota');
  }
  function ctl(label, html) { return '<div class="ctl"><span class="ctl-label">' + esc(label) + '</span>' + html + '</div>'; }
  function on(id, ev, fn) { var el = q('#' + id); if (el) el.addEventListener(ev, fn); }
  function feedback(txt, tipoF) {
    var el = q('#pkFb'); if (!el) return;
    el.textContent = txt || '';
    el.className = 'pk-fb' + (tipoF ? ' ' + tipoF : '');
  }

  /* ================= temas ================= */
  var TEMAS = [
    { id: 'intervalos', nom: 'Intervalos', que: 'La distancia entre dos notas: de ahí salen los acordes', ap: apIntervalos, pr: prIntervalos },
    { id: 'acordes', nom: 'Acordes', que: 'Mayores, menores, séptimas e inversiones, con las dos manos', ap: apAcordes, pr: prAcordes },
    { id: 'escalas', nom: 'Escalas', que: 'Mayor, menores, pentatónicas, blues y modos útiles', ap: apEscalas, pr: prEscalas },
    { id: 'campo', nom: 'Campo armónico', que: 'Los siete acordes de cada tono y para qué sirve cada uno', ap: apCampo, pr: prCampo },
    { id: 'progresiones', nom: 'Progresiones', que: 'Las secuencias de acordes de miles de canciones, para tocarlas', ap: apProgresiones, pr: prProgresiones },
    { id: 'transponer', nom: 'Transponer', que: 'Llevar una canción a otro tono para cantarla cómodo', ap: apTransponer, pr: prTransponer },
    { id: 'ritmica', nom: 'Rítmica', que: 'Patrones de acompañamiento: balada, bolero, vals, cumbia, bossa…', ap: apRitmica, pr: prRitmica }
  ];
  function temaDe(id) { for (var i = 0; i < TEMAS.length; i++) if (TEMAS[i].id === id) return TEMAS[i]; return null; }

  /* ---------- portada ---------- */
  function portada() {
    S.onKey = null; parar();
    var p = avance();
    S.view.innerHTML =
      '<div class="pk-scope">' +
      '<div class="rep-head"><h1>Piano popular</h1>' +
      '<div class="ka-head-btns">' + segHtml('pkNot', [['1', 'Do Re Mi'], ['0', 'C D E']], S.cfg.latin ? '1' : '0') +
      '<button class="mini-app-btn" id="pkMidi" title="Si tienes un piano digital conectado por USB, sus teclas cuentan en los ejercicios">Teclado MIDI</button></div></div>' +
      '<p class="ed-note">Piano para acompañar canciones, no piano clásico. Cada tema tiene una parte para <b>aprender</b> (mira y escucha en el teclado) y otra para <b>practicar</b> (ejercicios con puntaje). Conviene ir en orden: cada tema usa lo del anterior.</p>' +
      '<p class="set-status" id="pkAviso"></p>' +
      '<table class="rep"><thead><tr><th>Tema</th><th>Qué aprendes</th><th class="t-acc">Avance</th></tr></thead><tbody>' +
      TEMAS.map(function (t, i) {
        var x = p[t.id];
        var av = x && x.n ? Math.round(100 * x.ok / x.n) + '% · ' + x.n : '—';
        return '<tr class="song" data-t="' + t.id + '"><td class="t-title">' + (i + 1) + '. ' + esc(t.nom) + '</td><td>' + esc(t.que) + '</td><td class="t-acc t-key">' + av + '</td></tr>';
      }).join('') +
      '</tbody></table></div>';
    S.view.querySelectorAll('tr[data-t]').forEach(function (tr) {
      tr.addEventListener('click', function () { S.ctx.navigate('piano/' + tr.dataset.t); });
    });
    segWire('pkNot', function (v) { S.cfg.latin = v === '1'; guardarCfg(); });
    on('pkMidi', 'click', function () { conectarMidi(q('#pkMidi')); });
    if (S.midi) q('#pkMidi').setAttribute('aria-pressed', 'true');
  }

  /* ---------- marco común de un tema ---------- */
  function abrirTema(t, modo) {
    S.tema = t; S.modo = modo === 'practicar' ? 'practicar' : 'aprender';
    S.onKey = null; S.st = {}; parar();
    S.view.innerHTML =
      '<div class="pk-scope">' +
      '<button class="back" id="pkBack">← Piano</button>' +
      '<div class="rep-head"><h1>' + esc(t.nom) + '</h1>' +
      segHtml('pkModo', [['aprender', 'Aprender'], ['practicar', 'Practicar']], S.modo) + '</div>' +
      '<div id="pkCuerpo"></div>' +
      '<p class="set-status" id="pkAviso"></p>' +
      '</div>';
    on('pkBack', 'click', function () { S.ctx.navigate('piano'); });
    segWire('pkModo', function (v) { S.ctx.navigate('piano/' + t.id + (v === 'practicar' ? '/practicar' : '')); });
    var cuerpo = q('#pkCuerpo');
    if (S.modo === 'aprender') t.ap(cuerpo); else t.pr(cuerpo);
  }
  // caja de ejercicio: consigna grande + puntaje + retroalimentación
  function cajaEjercicio(extraCtl) {
    return '<div class="controls">' + (extraCtl || '') +
      '<span class="pk-puntos" id="pkPuntos">' + esc(puntosTxt(S.tema.id)) + '</span></div>' +
      '<div class="pk-stage"><div class="pk-sub" id="pkSub"></div><div class="pk-big" id="pkBig"></div><div class="pk-sub" id="pkSub2"></div></div>';
  }

  /* ---------- 1. intervalos ---------- */
  function apIntervalos(el) {
    var st = S.st; st.raiz = st.raiz || 'C'; st.iv = st.iv || 4;
    el.innerHTML =
      '<p class="ed-note">Un intervalo es la distancia entre dos notas, contada en semitonos (de una tecla a la vecina, blanca o negra, hay un semitono). No hace falta memorizarlos todos: para acompañar importan sobre todo la <b>3ª</b> (mayor o menor), la <b>5ª</b> y la <b>7ª</b>.</p>' +
      '<div class="controls">' + ctl('Desde', selRaiz('pkRaiz', st.raiz)) +
      '<button class="mini-app-btn" id="pkOir">Escuchar</button></div>' +
      '<div class="pk-grid" id="pkIvs">' + INTERVALOS.map(function (iv) {
        return '<button class="pk-opt" data-s="' + iv.s + '" aria-pressed="' + (iv.s === st.iv) + '"><b>' + iv.s + '</b> ' + esc(iv.nom) + '</button>';
      }).join('') + '</div>' +
      '<div class="pk-stage"><div class="pk-big" id="pkBig"></div><div class="pk-sub" id="pkSub"></div></div>' +
      '<div class="pk-kbw" id="pkKb"></div>';
    function pintar() {
      var iv = INTERVALOS.filter(function (x) { return x.s === st.iv; })[0];
      var n2 = deletrear(st.raiz, iv.s, iv.g), m1 = 48 + pcDe(st.raiz), m2 = m1 + iv.s, mk = {};
      mk[m1] = { c: 'on', t: ver(st.raiz) }; mk[m2] = { c: 'on', t: ver(n2) };
      q('#pkBig').textContent = ver(st.raiz) + ' → ' + ver(n2);
      q('#pkSub').textContent = iv.nom + ' · ' + iv.s + ' semitono' + (iv.s > 1 ? 's' : '') + '. ' + iv.uso;
      teclado(q('#pkKb'), 48, 72, mk, function () {});
      return [m1, m2];
    }
    function oir() {
      var ms = pintar(), c = ac(); if (!c) return;
      var t = c.currentTime + 0.05;
      tocar(ms[0], t, 0.9); tocar(ms[1], t + 0.6, 0.9); tocarVarias(ms, t + 1.3, 1.6);
    }
    on('pkRaiz', 'change', function () { st.raiz = this.value; oir(); });
    on('pkOir', 'click', oir);
    S.view.querySelectorAll('#pkIvs button').forEach(function (b) {
      b.addEventListener('click', function () {
        st.iv = +b.dataset.s;
        S.view.querySelectorAll('#pkIvs button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        oir();
      });
    });
    pintar();
  }
  function prIntervalos(el) {
    var st = S.st; st.tipo = st.tipo || 'tocar';
    el.innerHTML = cajaEjercicio(ctl('Ejercicio', segHtml('pkTipo', [['tocar', 'Tocar'], ['oido', 'De oído']], st.tipo)) +
      '<button class="mini-app-btn" id="pkOtra">Otro</button>') +
      '<div class="pk-grid" id="pkOps"></div><div class="pk-kbw" id="pkKb"></div><p class="pk-fb" id="pkFb"></p>';
    segWire('pkTipo', function (v) { st.tipo = v; nuevo(); });
    on('pkOtra', 'click', nuevo);
    // los de uso diario salen más seguido
    var BOLSA = [3, 4, 7, 10, 3, 4, 7, 10, 2, 5, 9, 11, 12, 6, 1, 8];
    function nuevo() {
      feedback('');
      st.raiz = azar(RAIZ_MAYOR.filter(function (n) { return n.length === 1 || Math.random() < 0.4; }));
      st.iv = INTERVALOS.filter(function (x) { return x.s === azar(BOLSA); })[0];
      st.m1 = 48 + pcDe(st.raiz); st.listo = false; st.fallos = 0;
      var ops = q('#pkOps');
      if (st.tipo === 'tocar') {
        q('#pkSub').textContent = 'Toca en el teclado';
        q('#pkBig').textContent = st.iv.nom + ' sobre ' + ver(st.raiz);
        q('#pkSub2').textContent = 'hacia arriba (la nota de abajo está marcada)';
        ops.innerHTML = '';
        var mk = {}; mk[st.m1] = { c: 'on', t: ver(st.raiz) };
        teclado(q('#pkKb'), 48, 72, mk, responderTecla);
        S.onKey = responderTecla;
      } else {
        q('#pkSub').textContent = 'Escucha y elige';
        q('#pkBig').textContent = '¿Qué intervalo es?';
        q('#pkSub2').textContent = '';
        var cand = mezclar(INTERVALOS.filter(function (x) { return x !== st.iv; })).slice(0, 3).concat([st.iv]);
        cand.sort(function (a, b) { return a.s - b.s; });
        ops.innerHTML = '<button class="pk-opt" id="pkRep">▶ Repetir</button>' + cand.map(function (x) {
          return '<button class="pk-opt" data-s="' + x.s + '">' + esc(x.nom) + '</button>';
        }).join('');
        on('pkRep', 'click', sonar);
        ops.querySelectorAll('button[data-s]').forEach(function (b) {
          b.addEventListener('click', function () { responderOido(+b.dataset.s, b); });
        });
        q('#pkKb').innerHTML = '';
        S.onKey = null;
        sonar();
      }
    }
    function sonar() {
      var c = ac(); if (!c) return;
      var t = c.currentTime + 0.05;
      tocar(st.m1, t, 0.9); tocar(st.m1 + st.iv.s, t + 0.65, 0.9); tocarVarias([st.m1, st.m1 + st.iv.s], t + 1.4, 1.5);
    }
    function responderTecla(m) {
      if (st.listo) return;
      var ok = mod12(m - st.m1) === mod12(st.iv.s) && m !== st.m1;
      var mk = {}; mk[st.m1] = { c: 'on', t: ver(st.raiz) };
      var objetivo = st.m1 + st.iv.s, nombre = deletrear(st.raiz, st.iv.s, st.iv.g);
      if (ok) {
        st.listo = true; anotar('intervalos', st.fallos === 0);
        mk[objetivo] = { c: 'ok', t: ver(nombre) };
        feedback('¡Bien! ' + ver(st.raiz) + ' → ' + ver(nombre) + ' (' + st.iv.s + ' semitonos).', 'ok');
        tocar(st.m1, null, 1.2); setTimeout(siguiente, 1400);
      } else {
        st.fallos++;
        mk[m] = { c: 'bad' };
        var d = mod12(m - st.m1);
        feedback('Esa está a ' + d + ' semitono' + (d === 1 ? '' : 's') + '. La ' + st.iv.nom + ' son ' + st.iv.s + '.' + (st.fallos >= 2 ? ' Es ' + ver(nombre) + '.' : ''), 'bad');
        if (st.fallos >= 2) mk[objetivo] = { c: 'tenue', t: ver(nombre) };
        if (st.fallos === 1) anotar('intervalos', false);
      }
      teclado(q('#pkKb'), 48, 72, mk, responderTecla);
    }
    function responderOido(s, b) {
      if (st.listo) return;
      if (s === st.iv.s) {
        st.listo = true; anotar('intervalos', st.fallos === 0);
        b.classList.add('ok');
        feedback('¡Bien! Era una ' + st.iv.nom + ' (' + ver(st.raiz) + ' → ' + ver(deletrear(st.raiz, st.iv.s, st.iv.g)) + ').', 'ok');
        setTimeout(siguiente, 1500);
      } else {
        b.classList.add('bad'); b.disabled = true;
        if (!st.fallos) anotar('intervalos', false);
        st.fallos++;
        feedback('No. Escúchalo de nuevo: ¿más abierto o más cerrado?', 'bad');
        sonar();
      }
    }
    function siguiente() { if (S.tema && S.tema.id === 'intervalos' && S.modo === 'practicar') nuevo(); }
    nuevo();
  }

  /* ---------- 2. acordes ---------- */
  function apAcordes(el) {
    var st = S.st; st.raiz = st.raiz || 'C'; st.tipo = st.tipo != null ? st.tipo : ''; st.inv = st.inv || 0;
    el.innerHTML =
      '<p class="ed-note">Un acorde son tres o más notas juntas, armadas con intervalos desde la <b>fundamental</b>. En piano popular la <b>mano izquierda toca la fundamental</b> (el bajo) y la <b>derecha el acorde</b>, en la inversión que quede más cerca de la anterior. Invertir es empezar por otra nota del acorde: las notas son las mismas.</p>' +
      '<div class="controls">' + ctl('Raíz', selRaiz('pkRaiz', st.raiz)) +
      ctl('Tipo', selHtml('pkTipo', TIPOS.map(function (t) { return [t.id, t.nom]; }), st.tipo, 'Tipo')) +
      ctl('Inversión', '<div id="pkInvW"></div>') +
      '<button class="mini-app-btn" id="pkOir">Escuchar</button></div>' +
      '<div class="pk-stage"><div class="pk-big" id="pkBig"></div><div class="pk-sub" id="pkSub"></div></div>' +
      '<div class="pk-manos"><div><div class="ctl-label">Mano izquierda</div><div class="pk-kbw pk-izq" id="pkKbI"></div></div>' +
      '<div class="pk-der"><div class="ctl-label">Mano derecha</div><div class="pk-kbw" id="pkKbD"></div></div></div>';
    function invHtml() {
      var n = tipo(st.tipo).iv.length, ops = [['0', 'Fundamental'], ['1', '1ª'], ['2', '2ª']];
      if (n >= 4) ops.push(['3', '3ª']);
      if (st.inv >= n) st.inv = 0;
      q('#pkInvW').innerHTML = segHtml('pkInv', ops, String(st.inv));
      segWire('pkInv', function (v) { st.inv = +v; oir(); });
    }
    function pintar() {
      var t = tipo(st.tipo), notas = notasAcorde(st.raiz, st.tipo), p = pcDe(st.raiz);
      var iv = t.iv.slice(st.inv).concat(t.iv.slice(0, st.inv).map(function (s) { return s + 12; }));
      var gr = t.gr.slice(st.inv).concat(t.gr.slice(0, st.inv));
      var nm = notas.slice(st.inv).concat(notas.slice(0, st.inv));
      var base = 60 + p; if (base + Math.max.apply(null, iv) > 84) base -= 12;
      var md = iv.map(function (s) { return base + s; }), mi = 36 + p, mkD = {}, mkI = {};
      md.forEach(function (m, i) { mkD[m] = { c: 'on', t: ver(nm[i]) }; });
      mkI[mi] = { c: 'on', t: ver(st.raiz) };
      var nombre = cifra(st.raiz, st.tipo) + (st.inv ? '/' + nm[0] : '');
      q('#pkBig').textContent = ver(nombre);
      q('#pkSub').textContent = t.nom + ' · ' + t.f + ' · ' + notas.map(ver).join(' – ') +
        (st.inv ? ' · ' + (st.inv === 1 ? 'primera' : st.inv === 2 ? 'segunda' : 'tercera') + ' inversión: abajo queda la ' + gr[0] + 'ª' : '');
      teclado(q('#pkKbI'), 36, 48, mkI);
      teclado(q('#pkKbD'), 48, 84, mkD);
      return { md: md, mi: mi };
    }
    function oir() {
      var v = pintar(), c = ac(); if (!c) return;
      var t = c.currentTime + 0.05;
      tocar(v.mi, t, 1.8, 0.7);
      v.md.forEach(function (m, i) { tocar(m, t + 0.35 + i * 0.12, 1.4); });
      tocarVarias(v.md.concat([v.mi]), t + 0.45 + v.md.length * 0.12 + 0.3, 1.8);
    }
    on('pkRaiz', 'change', function () { st.raiz = this.value; oir(); });
    on('pkTipo', 'change', function () { st.tipo = this.value; invHtml(); oir(); });
    on('pkOir', 'click', oir);
    invHtml(); pintar();
  }
  function prAcordes(el) {
    var st = S.st; st.nivel = st.nivel || 'triadas';
    el.innerHTML = cajaEjercicio(ctl('Nivel', segHtml('pkNivel', [['triadas', 'Mayores y menores'], ['mas', '+ dim, sus'], ['sept', 'Séptimas']], st.nivel)) +
      '<button class="mini-app-btn" id="pkOtra">Otro</button>') +
      '<div class="pk-kbw" id="pkKb"></div>' +
      '<div class="pk-acc"><button class="mini-app-btn" id="pkOirSel">Escuchar lo mío</button><button class="mini-app-btn" id="pkBorrar">Borrar</button>' +
      '<button class="pr-play pk-go" id="pkComp">COMPROBAR</button></div><p class="pk-fb" id="pkFb"></p>';
    segWire('pkNivel', function (v) { st.nivel = v; nuevo(); });
    on('pkOtra', 'click', nuevo);
    on('pkBorrar', 'click', function () { st.sel = []; pintar(); feedback(''); });
    on('pkOirSel', 'click', function () { tocarVarias(st.sel, null, 1.5); });
    on('pkComp', 'click', comprobar);
    function nuevo() {
      feedback('');
      var tipos = st.nivel === 'triadas' ? ['', 'm'] : st.nivel === 'mas' ? ['', 'm', 'dim', 'sus4', 'sus2', 'aug'] : ['7', 'maj7', 'm7', 'm7b5', '6'];
      st.tipo = azar(tipos);
      var menor = !!tipo(st.tipo).menor;
      st.raiz = azar((menor ? RAIZ_MENOR : RAIZ_MAYOR));
      st.sel = []; st.listo = false; st.fallos = 0;
      q('#pkSub').textContent = 'Toca las notas en el teclado (en cualquier orden) y comprueba';
      q('#pkBig').textContent = ver(cifra(st.raiz, st.tipo));
      q('#pkSub2').textContent = tipo(st.tipo).nom;
      pintar();
      S.onKey = function (m, origen) {
        if (origen === 'midi') {
          // con piano real: se comprueba solo cuando están todas las teclas abajo
          st.sel = Array.from(S.held);
          pintar();
          if (new Set(st.sel.map(mod12)).size >= tipo(st.tipo).iv.length) comprobar();
        } else alternar(m);
      };
    }
    function alternar(m) {
      if (st.listo) return;
      var i = st.sel.indexOf(m);
      if (i >= 0) st.sel.splice(i, 1); else st.sel.push(m);
      pintar();
    }
    function pintar(extra) {
      var mk = {};
      st.sel.forEach(function (m) { mk[m] = { c: 'sel' }; });
      if (extra) Object.assign(mk, extra);
      teclado(q('#pkKb'), 48, 79, mk, function (m) { alternar(m); });
    }
    function comprobar() {
      if (st.listo || !st.sel.length) return;
      var quiero = new Set(midisAcorde(st.raiz, st.tipo).map(mod12)), tengo = new Set(st.sel.map(mod12));
      var faltan = Array.from(quiero).filter(function (p) { return !tengo.has(p); });
      var sobran = st.sel.filter(function (m) { return !quiero.has(mod12(m)); });
      var notas = notasAcorde(st.raiz, st.tipo);
      if (!faltan.length && !sobran.length) {
        st.listo = true; anotar('acordes', st.fallos === 0);
        var mk = {};
        st.sel.forEach(function (m) {
          var i = tipo(st.tipo).iv.map(function (s) { return mod12(pcDe(st.raiz) + s); }).indexOf(mod12(m));
          mk[m] = { c: 'ok', t: ver(notas[i]) };
        });
        pintar(mk);
        feedback('¡Bien! ' + ver(cifra(st.raiz, st.tipo)) + ' = ' + notas.map(ver).join(' – '), 'ok');
        tocarVarias(st.sel, null, 1.6);
        setTimeout(function () { if (S.tema && S.tema.id === 'acordes' && S.modo === 'practicar') nuevo(); }, 1800);
      } else {
        if (!st.fallos) anotar('acordes', false);
        st.fallos++;
        var mk2 = {};
        sobran.forEach(function (m) { mk2[m] = { c: 'bad' }; });
        pintar(mk2);
        var txt = (sobran.length ? 'Marcadas con × no van. ' : '') + (faltan.length ? 'Falta' + (faltan.length > 1 ? 'n ' + faltan.length + ' notas' : ' una nota') + '.' : '');
        if (st.fallos >= 2) txt += ' Las notas son: ' + notas.map(ver).join(' – ') + '.';
        feedback(txt, 'bad');
      }
    }
    nuevo();
  }

  /* ---------- 3. escalas ---------- */
  function apEscalas(el) {
    var st = S.st; st.raiz = st.raiz || 'C'; st.esc = st.esc || 'mayor';
    el.innerHTML =
      '<p class="ed-note">Una escala es la lista ordenada de notas que "pertenecen" a un tono. Para acompañar no se trata de tocarlas rápido, sino de saber <b>qué notas suenan bien</b> en una canción y de dónde salen sus acordes. T = tono (2 semitonos), S = semitono.</p>' +
      '<div class="controls">' + ctl('Tónica', selRaiz('pkRaiz', st.raiz, escala(st.esc).menor)) +
      ctl('Escala', selHtml('pkEsc', ESCALAS.map(function (e) { return [e.id, e.nom]; }), st.esc, 'Escala')) +
      '<button class="mini-app-btn" id="pkOir">Escuchar</button></div>' +
      '<div class="pk-stage"><div class="pk-big pk-mid" id="pkBig"></div><div class="pk-sub" id="pkSub"></div><div class="pk-sub" id="pkSub2"></div></div>' +
      '<div class="pk-kbw" id="pkKb"></div>';
    function midis() { var b = 48 + pcDe(st.raiz); return escala(st.esc).iv.concat([12]).map(function (s) { return b + s; }); }
    function pintar(activo) {
      var e = escala(st.esc), ns = notasEscala(st.raiz, e), ms = midis(), mk = {};
      ms.forEach(function (m, i) {
        var n = ns[i % ns.length];
        mk[m] = { c: activo === i ? 'ok' : 'on', t: ver(n) };
      });
      q('#pkBig').textContent = ns.concat([ns[0]]).map(ver).join(' ');
      q('#pkSub').textContent = e.nom + ' de ' + ver(st.raiz) + ' · ' + pasos(e);
      q('#pkSub2').textContent = e.uso + (e.id === 'mayor' ? ' Digitación de la mano derecha en Do, Sol, Re, La y Mi: 1-2-3, pasa el pulgar, 1-2-3-4-5.' : '');
      teclado(q('#pkKb'), 48, 74, mk, function () {});
    }
    function oir() {
      var ms = midis(), c = ac(); if (!c) return;
      var ida = ms.concat(ms.slice(0, -1).reverse()), dur = 0.32;
      reproducir({
        dur: dur, total: ida.length,
        sched: function (i, t) { tocar(ida[i], t, 0.5); },
        paso: function (i) { var k = i < ms.length ? i : ida.length - 1 - i; pintar(k); },
        fin: function () { pintar(); }
      });
    }
    on('pkRaiz', 'change', function () { st.raiz = this.value; oir(); });
    on('pkEsc', 'change', function () {
      st.esc = this.value;
      var menor = escala(st.esc).menor;
      q('#pkRaiz').outerHTML = selRaiz('pkRaiz', (menor ? RAIZ_MENOR : RAIZ_MAYOR)[pcDe(st.raiz)], menor);
      st.raiz = q('#pkRaiz').value;
      on('pkRaiz', 'change', function () { st.raiz = this.value; oir(); });
      oir();
    });
    on('pkOir', 'click', oir);
    pintar();
  }
  function prEscalas(el) {
    var st = S.st; st.nivel = st.nivel || 'mayor';
    el.innerHTML = cajaEjercicio(ctl('Escalas', segHtml('pkNivel', [['mayor', 'Mayores'], ['menor', 'Menores'], ['todas', 'Todas']], st.nivel)) +
      '<button class="mini-app-btn" id="pkOtra">Otra</button><button class="mini-app-btn" id="pkPista">Pista</button>') +
      '<div class="pk-kbw" id="pkKb"></div><p class="pk-fb" id="pkFb"></p>';
    segWire('pkNivel', function (v) { st.nivel = v; nuevo(); });
    on('pkOtra', 'click', nuevo);
    on('pkPista', 'click', function () {
      if (st.listo) return;
      st.pista = true;
      var pc = mod12(pcDe(st.raiz) + st.e.iv.concat([12])[st.i]);
      feedback('Sigue ' + ver(st.notas[st.i % st.notas.length]) + ' (' + (st.i ? (st.e.iv.concat([12])[st.i] - st.e.iv.concat([12])[st.i - 1] === 1 ? 'un semitono' : 'un tono') + ' más arriba' : 'la tónica') + ').');
      pintar(pc);
    });
    function nuevo() {
      feedback('');
      var lista = st.nivel === 'mayor' ? ['mayor'] : st.nivel === 'menor' ? ['menor', 'armonica'] : ['mayor', 'menor', 'armonica', 'pentam', 'penta'];
      st.e = escala(azar(lista));
      st.raiz = azar(st.e.menor ? RAIZ_MENOR : RAIZ_MAYOR);
      st.notas = notasEscala(st.raiz, st.e);
      st.i = 0; st.tocadas = []; st.fallos = 0; st.listo = false; st.pista = false;
      q('#pkSub').textContent = 'Toca la escala subiendo, desde la tónica hasta la tónica de arriba';
      q('#pkBig').textContent = st.e.nom + ' de ' + ver(st.raiz);
      q('#pkSub2').textContent = st.notas.length + 1 + ' notas';
      pintar();
      S.onKey = responder;
    }
    function pintar(pista) {
      var mk = {};
      st.tocadas.forEach(function (x) { mk[x.m] = { c: 'ok', t: ver(x.n) }; });
      if (st.malo != null) mk[st.malo] = { c: 'bad' };
      if (pista != null) for (var m = 48; m <= 79; m++) if (mod12(m) === pista && !mk[m]) mk[m] = { c: 'tenue' };
      teclado(q('#pkKb'), 48, 79, mk, responder);
    }
    function responder(m) {
      if (st.listo) return;
      var ivs = st.e.iv.concat([12]), pcQuiero = mod12(pcDe(st.raiz) + ivs[st.i]);
      var previo = st.tocadas.length ? st.tocadas[st.tocadas.length - 1].m : null;
      st.malo = null;
      if (mod12(m) === pcQuiero && (previo == null || m > previo)) {
        st.tocadas.push({ m: m, n: st.notas[st.i % st.notas.length] });
        st.i++;
        if (st.i === ivs.length) {
          st.listo = true;
          var bien = st.fallos === 0 && !st.pista;
          anotar('escalas', bien);
          feedback(bien ? '¡Perfecta!' : 'Completa, con ' + st.fallos + ' error' + (st.fallos === 1 ? '' : 'es') + (st.pista ? ' y pista' : '') + '. Repítela hasta que salga limpia.', bien ? 'ok' : '');
          setTimeout(function () { if (S.tema && S.tema.id === 'escalas' && S.modo === 'practicar') nuevo(); }, 1800);
        } else feedback('');
      } else {
        st.fallos++; st.malo = m;
        feedback(mod12(m) === pcQuiero ? 'Esa nota va, pero más arriba que la anterior.' : 'Esa no es. ¿Tono o semitono desde la anterior?', 'bad');
      }
      pintar();
    }
    nuevo();
  }

  /* ---------- 4. campo armónico ---------- */
  function apCampo(el) {
    var st = S.st; st.raiz = st.raiz || 'C'; st.modo = st.modo || 'mayor'; st.sept = !!st.sept;
    el.innerHTML =
      '<p class="ed-note">Si a cada nota de la escala le armas un acorde con notas de la misma escala, salen los siete acordes del tono: su <b>campo armónico</b>. Casi todas las canciones usan solo estos. Se numeran con romanos (mayúscula = mayor, minúscula = menor), y eso permite hablar de una canción sin importar el tono.</p>' +
      '<div class="controls">' + ctl('Tono', selRaiz('pkRaiz', st.raiz, st.modo === 'menor')) +
      ctl('Modo', segHtml('pkModo2', [['mayor', 'Mayor'], ['menor', 'Menor']], st.modo)) +
      ctl('Acordes', segHtml('pkSept', [['0', 'Tríadas'], ['1', 'Con séptima']], st.sept ? '1' : '0')) + '</div>' +
      '<table class="rep pk-campo"><thead><tr><th>Grado</th><th>Acorde</th><th>Función</th></tr></thead><tbody id="pkFilas"></tbody></table>' +
      '<p class="ed-note" id="pkNotaModo"></p>' +
      '<div class="pk-manos"><div><div class="ctl-label">Mano izquierda</div><div class="pk-kbw pk-izq" id="pkKbI"></div></div>' +
      '<div class="pk-der"><div class="ctl-label">Mano derecha</div><div class="pk-kbw" id="pkKbD"></div></div></div>';
    function pintar(sel) {
      var filas = '';
      for (var g = 0; g < 7; g++) {
        var a = grado(st.raiz, st.modo, g, st.sept);
        filas += '<tr class="song' + (sel === g ? ' pk-sel-row' : '') + '" data-g="' + g + '"><td class="t-key">' + a.rom + '</td><td class="t-title">' + esc(ver(cifra(a.raiz, a.tipo))) +
          '</td><td>' + esc(FUNCION[a.fun]) + '</td></tr>';
      }
      q('#pkFilas').innerHTML = filas;
      q('#pkNotaModo').textContent = st.modo === 'menor'
        ? 'En menor, el V se toca mayor (con la 7ª de la menor armónica): así suena la cadencia que "vuelve a casa". Funciones: i, III y VI reposan; iv y iiº preparan; V y VII tensan.'
        : 'Los más usados: I, IV, V y vi. El V (y mejor aún el V7) es el que pide volver al I.';
      S.view.querySelectorAll('#pkFilas tr').forEach(function (tr) {
        tr.addEventListener('click', function () { mostrar(+tr.dataset.g); });
      });
    }
    function mostrar(g) {
      pintar(g);
      var a = grado(st.raiz, st.modo, g, st.sept), v = voz(a.raiz, a.tipo, null), b = 36 + mod12(pcDe(a.raiz)), mkD = {}, mkI = {};
      var ns = notasAcorde(a.raiz, a.tipo), pcs = tipo(a.tipo).iv.map(function (s) { return mod12(pcDe(a.raiz) + s); });
      v.forEach(function (m) { mkD[m] = { c: 'on', t: ver(ns[pcs.indexOf(mod12(m))]) }; });
      mkI[b] = { c: 'on', t: ver(a.raiz) };
      teclado(q('#pkKbI'), 36, 48, mkI); teclado(q('#pkKbD'), 48, 84, mkD);
      var c = ac(); if (c) { var t = c.currentTime + 0.03; tocar(b, t, 1.6, 0.7); tocarVarias(v, t, 1.6); }
    }
    on('pkRaiz', 'change', function () { st.raiz = this.value; pintar(); });
    segWire('pkModo2', function (v) {
      st.modo = v;
      var menor = v === 'menor';
      q('#pkRaiz').outerHTML = selRaiz('pkRaiz', (menor ? RAIZ_MENOR : RAIZ_MAYOR)[pcDe(st.raiz)], menor);
      st.raiz = q('#pkRaiz').value;
      on('pkRaiz', 'change', function () { st.raiz = this.value; pintar(); });
      pintar();
    });
    segWire('pkSept', function (v) { st.sept = v === '1'; pintar(); });
    pintar();
    teclado(q('#pkKbI'), 36, 48, {}); teclado(q('#pkKbD'), 48, 84, {});
  }
  function prCampo(el) {
    var st = S.st;
    el.innerHTML = cajaEjercicio('<button class="mini-app-btn" id="pkOtra">Otra</button>') +
      '<div class="pk-grid" id="pkOps"></div><p class="pk-fb" id="pkFb"></p>';
    on('pkOtra', 'click', nuevo);
    function nuevo() {
      feedback('');
      var modo = Math.random() < 0.7 ? 'mayor' : 'menor', menor = modo === 'menor';
      var raiz = azar(menor ? RAIZ_MENOR : RAIZ_MAYOR), tono = ver(raiz) + (menor ? ' menor' : ' mayor');
      var g = Math.floor(Math.random() * 7), a = grado(raiz, modo, g, false), clase = Math.random();
      st.listo = false; st.fallos = 0;
      var ops, correcta;
      if (clase < 0.45) {
        q('#pkSub').textContent = 'En ' + tono + ',';
        q('#pkBig').textContent = '¿cuál es el ' + a.rom + '?';
        correcta = ver(cifra(a.raiz, a.tipo));
        ops = [correcta];
        var otros = mezclar([0, 1, 2, 3, 4, 5, 6].filter(function (x) { return x !== g; })).slice(0, 3);
        otros.forEach(function (x) { var b = grado(raiz, modo, x, false); ops.push(ver(cifra(b.raiz, b.tipo))); });
      } else if (clase < 0.85) {
        q('#pkSub').textContent = 'En ' + tono + ',';
        q('#pkBig').textContent = '¿qué grado es ' + ver(cifra(a.raiz, a.tipo)) + '?';
        correcta = a.rom;
        ops = [correcta].concat(mezclar(CAMPO[modo].rom.filter(function (r) { return r !== a.rom; })).slice(0, 3));
      } else {
        q('#pkSub').textContent = 'En ' + tono + ', el ' + a.rom + ' (' + ver(cifra(a.raiz, a.tipo)) + ')';
        q('#pkBig').textContent = '¿qué función cumple?';
        correcta = FUNCION[a.fun];
        ops = [FUNCION.T, FUNCION.SD, FUNCION.D];
      }
      q('#pkSub2').textContent = '';
      var caja = q('#pkOps');
      caja.innerHTML = mezclar(ops).map(function (o) { return '<button class="pk-opt">' + esc(o) + '</button>'; }).join('');
      caja.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          if (st.listo) return;
          if (b.textContent === correcta) {
            st.listo = true; b.classList.add('ok'); anotar('campo', st.fallos === 0);
            feedback('¡Bien! ' + a.rom + ' de ' + tono + ' = ' + ver(cifra(a.raiz, a.tipo)) + '. ' + FUNCION[a.fun] + '.', 'ok');
            var c = ac(); if (c) { var v = voz(a.raiz, a.tipo, null); tocar(36 + mod12(pcDe(a.raiz)), null, 1.4, 0.7); tocarVarias(v, null, 1.4); }
            setTimeout(function () { if (S.tema && S.tema.id === 'campo' && S.modo === 'practicar') nuevo(); }, 1900);
          } else {
            b.classList.add('bad'); b.disabled = true;
            if (!st.fallos) anotar('campo', false);
            st.fallos++;
            feedback('No. Cuenta los grados desde ' + ver(raiz) + ' por la escala.', 'bad');
          }
        });
      });
    }
    nuevo();
  }

  /* ---------- acompañamiento: progresión + ritmo ---------- */
  // Toca acordes con un ritmo. acordes: [{raiz, tipo}], un acorde por compás.
  function acompanar(acordes, r, bpm, opt) {
    opt = opt || {};
    var porCompas = r.md.length, dur = r.comp === '6/8' ? 60 / bpm / 3 : 60 / bpm / 2;
    var voces = [], previa = null;
    acordes.forEach(function (a) { previa = voz(a.raiz, a.tipo, previa); voces.push(previa); });
    var total = opt.loop ? null : acordes.length * porCompas;
    reproducir({
      dur: dur, total: total,
      sched: function (i, t) {
        var k = Math.floor(i / porCompas) % acordes.length, s = i % porCompas, a = acordes[k], v = voces[k];
        var b = bajo(a.raiz), ci = r.mi[s], cd = r.md[s];
        if (ci === 'B') tocar(b, t, dur * 3.5, 0.75);
        else if (ci === '5') tocar(b + (tipo(a.tipo).iv[2] === 6 ? 6 : 7), t, dur * 3, 0.6);
        if (opt.sinDerecha) { /* el alumno toca la derecha */ }
        else if (cd === 'A') tocarVarias(v, t, dur * (r.md[s + 1] === '.' ? 1.9 : 0.95), s === 0 ? 0.62 : 0.5);
        else if ('1358'.indexOf(cd) >= 0) {
          var idx = { 1: 0, 3: 1, 5: 2, 8: 0 }[cd], m = v[Math.min(idx, v.length - 1)] + (cd === '8' ? 12 : 0);
          tocar(m, t, dur * 2.5, 0.5);
        }
        if (opt.clic && s % (r.comp === '6/8' ? 3 : 2) === 0) clic(t, s === 0);
        if (opt.sched) opt.sched(i, t);
      },
      paso: function (i) { if (opt.paso) opt.paso(Math.floor(i / porCompas) % acordes.length, i % porCompas, voces, i); },
      fin: opt.fin
    });
    return voces;
  }

  /* ---------- 5. progresiones ---------- */
  function apProgresiones(el) {
    var st = S.st; st.p = st.p || 'pop'; st.raiz = st.raiz || 'C'; st.bpm = st.bpm || 80; st.r = st.r || 'negras';
    el.innerHTML =
      '<p class="ed-note">Una progresión es la secuencia de acordes de una canción. Como se escriben en grados, la misma progresión sirve en cualquier tono. Fíjate en la mano derecha: <b>cambia de inversión para moverse lo menos posible</b>, así suena ligado y es fácil de tocar.</p>' +
      '<div class="controls">' + ctl('Progresión', selHtml('pkProg', PROGS.map(function (p) { return [p.id, p.nom]; }), st.p, 'Progresión')) +
      ctl('Tono', '<span id="pkRaizW"></span>') +
      ctl('Ritmo', selHtml('pkRit', RITMOS.map(function (r) { return [r.id, r.nom]; }), st.r, 'Ritmo')) +
      ctl('Tempo', '<div class="stepper"><button id="pkBpmM" aria-label="Más lento">−</button><span class="val" id="pkBpm"></span><button id="pkBpmP" aria-label="Más rápido">+</button></div>') +
      '<button class="pr-play pk-go" id="pkPlay">TOCAR</button></div>' +
      '<p class="pk-sub" id="pkTxt"></p>' +
      '<div class="pk-prog" id="pkCifras"></div>' +
      '<div class="pk-manos"><div><div class="ctl-label">Mano izquierda</div><div class="pk-kbw pk-izq" id="pkKbI"></div></div>' +
      '<div class="pk-der"><div class="ctl-label">Mano derecha</div><div class="pk-kbw" id="pkKbD"></div></div></div>';
    function raizSel() {
      var menor = prog(st.p).modo === 'menor';
      st.raiz = (menor ? RAIZ_MENOR : RAIZ_MAYOR)[pcDe(st.raiz)];
      q('#pkRaizW').innerHTML = selRaiz('pkRaiz', st.raiz, menor);
      on('pkRaiz', 'change', function () { st.raiz = this.value; reiniciar(); });
    }
    function acordes() { return acordesProg(prog(st.p), st.raiz); }
    function pintar(k, voces) {
      var as = acordes(), p = prog(st.p);
      q('#pkTxt').textContent = p.txt;
      q('#pkCifras').innerHTML = as.map(function (a, i) {
        return '<div class="pk-cif' + (i === k ? ' on' : '') + '"><span class="pk-rom">' + esc(a.rom) + '</span><span class="pk-ac">' + esc(ver(cifra(a.raiz, a.tipo))) + '</span></div>';
      }).join('');
      var mkD = {}, mkI = {};
      if (k != null && voces) {
        var a = as[k], ns = notasAcorde(a.raiz, a.tipo), pcs = tipo(a.tipo).iv.map(function (s) { return mod12(pcDe(a.raiz) + s); });
        voces[k].forEach(function (m) { mkD[m] = { c: 'on', t: ver(ns[pcs.indexOf(mod12(m))]) }; });
        mkI[bajo(a.raiz)] = { c: 'on', t: ver(a.raiz) };
      }
      teclado(q('#pkKbI'), 36, 52, mkI); teclado(q('#pkKbD'), 48, 84, mkD);
      q('#pkBpm').textContent = st.bpm;
    }
    var ultimo = -1;
    function tocarProg() {
      ultimo = -1;
      acompanar(acordes(), ritmo(st.r), st.bpm, {
        loop: true, clic: false,
        paso: function (k, s, voces) { if (k !== ultimo) { ultimo = k; pintar(k, voces); } }
      });
      q('#pkPlay').textContent = 'DETENER'; q('#pkPlay').classList.add('playing');
    }
    function detener() { parar(); q('#pkPlay').textContent = 'TOCAR'; q('#pkPlay').classList.remove('playing'); pintar(); }
    function reiniciar() { if (sonando()) tocarProg(); else pintar(); }
    on('pkPlay', 'click', function () { if (sonando()) detener(); else tocarProg(); });
    on('pkProg', 'change', function () { st.p = this.value; raizSel(); reiniciar(); });
    on('pkRit', 'change', function () { st.r = this.value; reiniciar(); });
    on('pkBpmM', 'click', function () { st.bpm = Math.max(40, st.bpm - 5); reiniciar(); });
    on('pkBpmP', 'click', function () { st.bpm = Math.min(180, st.bpm + 5); reiniciar(); });
    raizSel(); pintar();
  }
  function prProgresiones(el) {
    var st = S.st;
    el.innerHTML = cajaEjercicio('<button class="mini-app-btn" id="pkRep">▶ Repetir</button><button class="mini-app-btn" id="pkOtra">Otra</button>') +
      '<div class="pk-grid" id="pkOps"></div><p class="pk-fb" id="pkFb"></p>';
    on('pkOtra', 'click', nuevo);
    on('pkRep', 'click', sonar);
    function sonar() { acompanar(acordesProg(st.p, st.raiz), ritmo('negras'), 92, {}); }
    function nuevo() {
      feedback(''); parar();
      st.p = azar(PROGS.filter(function (p) { return !p.blues; }));
      st.raiz = azar(st.p.modo === 'menor' ? RAIZ_MENOR : RAIZ_MAYOR);
      st.listo = false; st.fallos = 0;
      q('#pkSub').textContent = 'Escucha (empieza en el I del tono) y elige';
      q('#pkBig').textContent = '¿Qué progresión es?';
      q('#pkSub2').textContent = 'Pista: fíjate si el primer acorde es mayor o menor, y si el último deja tensión.';
      var mismas = PROGS.filter(function (p) { return !p.blues && p !== st.p; });
      var ops = mezclar([st.p].concat(mezclar(mismas).slice(0, 3)));
      var caja = q('#pkOps');
      caja.innerHTML = ops.map(function (p) { return '<button class="pk-opt" data-p="' + p.id + '">' + esc(p.nom) + '</button>'; }).join('');
      caja.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          if (st.listo) return;
          if (b.dataset.p === st.p.id) {
            st.listo = true; b.classList.add('ok'); anotar('progresiones', st.fallos === 0); parar();
            feedback('¡Bien! ' + st.p.nom + ' en ' + ver(st.raiz) + ': ' + acordesProg(st.p, st.raiz).map(function (a) { return ver(cifra(a.raiz, a.tipo)); }).join(' – '), 'ok');
          } else {
            b.classList.add('bad'); b.disabled = true;
            if (!st.fallos) anotar('progresiones', false);
            st.fallos++;
            feedback('No. Escúchala otra vez.', 'bad');
            sonar();
          }
        });
      });
      sonar();
    }
    nuevo();
  }

  /* ---------- 6. transponer ---------- */
  function leerCifras(txt) {
    return String(txt || '').split(/[\s,–\-|]+/).filter(Boolean).map(function (tok) {
      var n = SB.music.normalizeInput(tok);
      if (!n) return { mal: tok };
      var m = /^([A-G]#?)([^/]*)(?:\/([A-G]#?))?$/.exec(n);
      return m ? { pc: SOST.indexOf(m[1]), suf: m[2] || '', bajo: m[3] ? SOST.indexOf(m[3]) : null } : { mal: tok };
    });
  }
  function escribirCifra(c, k, bem) {
    if (c.mal) return c.mal;
    return notaPc(c.pc + k, bem) + c.suf + (c.bajo != null ? '/' + notaPc(c.bajo + k, bem) : '');
  }
  function romanoDe(c, tonica, menor) {
    if (c.mal) return '?';
    var d = mod12(c.pc - tonica);
    var R = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
    if (menor) R = ['I', '♭II', 'II', 'III', '♯III', 'IV', '♯IV', 'V', 'VI', '♯VI', 'VII', '♯VII'];
    var r = R[d], esMenor = /^m(?!aj)/.test(c.suf) || /^dim|º/.test(c.suf);
    if (esMenor) r = r.replace(/[IV]+/, function (x) { return x.toLowerCase(); });
    return r + c.suf.replace(/^m(?!aj)/, '').replace(/^dim/, 'º');
  }
  function apTransponer(el) {
    var st = S.st; st.txt = st.txt != null ? st.txt : 'G Em C D'; st.k = st.k || 0; st.menor = !!st.menor;
    el.innerHTML =
      '<p class="ed-note">Transponer es subir o bajar todos los acordes la misma cantidad de semitonos, para que la canción quede en un tono cómodo para cantar. El truco: piensa la canción <b>en grados</b> (I, IV, V…) y vuelve a armarla en el tono nuevo. Escribe los acordes separados por espacios (sirve "G Em C D" o "Sol Mim Do Re").</p>' +
      '<div class="controls"><input class="search pk-in" id="pkTxtIn" value="' + esc(st.txt) + '" aria-label="Acordes"></div>' +
      '<div class="controls">' + ctl('Tono original', '<span id="pkOrigW"></span>') +
      ctl('Mover', '<div class="stepper"><button id="pkKM" aria-label="Bajar medio tono">−</button><span class="val" id="pkK"></span><button id="pkKP" aria-label="Subir medio tono">+</button></div>') +
      ctl('Tono nuevo', '<span id="pkDestW"></span>') +
      '<button class="mini-app-btn" id="pkOir">Escuchar</button></div>' +
      '<table class="rep pk-campo"><thead><tr><th>Original</th><th>Grado</th><th>Transpuesto</th></tr></thead><tbody id="pkFilas"></tbody></table>';
    function tonica() {
      var cs = leerCifras(st.txt).filter(function (c) { return !c.mal; });
      if (st.orig == null) {
        st.orig = cs.length ? cs[0].pc : 0;
        st.menor = cs.length ? /^m(?!aj)/.test(cs[0].suf) : false;
      }
      return st.orig;
    }
    function pintar() {
      var t = tonica(), cs = leerCifras(st.txt), dest = mod12(t + st.k), bemO = usaBemoles(t, st.menor), bemD = usaBemoles(dest, st.menor);
      var nomT = function (pc, bem) { return ver(notaPc(pc, bem)) + (st.menor ? 'm' : ''); };
      q('#pkOrigW').innerHTML = selHtml('pkOrig', SOST.map(function (_, pc) { return [pc, nomT(pc, usaBemoles(pc, st.menor))]; }), t, 'Tono original');
      q('#pkDestW').innerHTML = selHtml('pkDest', SOST.map(function (_, pc) { return [pc, nomT(pc, usaBemoles(pc, st.menor))]; }), dest, 'Tono nuevo');
      q('#pkK').textContent = (st.k > 0 ? '+' : '') + st.k + ' st';
      q('#pkFilas').innerHTML = cs.map(function (c) {
        return '<tr><td class="t-title">' + esc(ver(escribirCifra(c, 0, bemO))) + '</td><td class="t-key">' + esc(romanoDe(c, t, st.menor)) +
          '</td><td class="t-title">' + esc(ver(escribirCifra(c, st.k, bemD))) + '</td></tr>';
      }).join('');
      on('pkOrig', 'change', function () { st.orig = +this.value; pintar(); });
      on('pkDest', 'change', function () { st.k = mod12(+this.value - tonica()); if (st.k > 6) st.k -= 12; pintar(); });
    }
    on('pkTxtIn', 'input', function () { st.txt = this.value; st.orig = null; pintar(); });
    on('pkKM', 'click', function () { st.k = Math.max(-11, st.k - 1); pintar(); });
    on('pkKP', 'click', function () { st.k = Math.min(11, st.k + 1); pintar(); });
    on('pkOir', 'click', function () {
      var cs = leerCifras(st.txt).filter(function (c) { return !c.mal; }), bem = usaBemoles(mod12(tonica() + st.k), st.menor);
      var as = cs.map(function (c) {
        var suf = c.suf;
        var tp = TIPOS.some(function (x) { return x.id === suf; }) ? suf : (/^m(?!aj)/.test(suf) ? 'm' : '');
        return { raiz: notaPc(c.pc + st.k, bem), tipo: tp };
      });
      if (as.length) acompanar(as, ritmo('negras'), 90, {});
    });
    pintar();
  }
  function prTransponer(el) {
    var st = S.st;
    el.innerHTML = cajaEjercicio('<button class="mini-app-btn" id="pkOtra">Otra</button>') +
      '<div class="pk-trans" id="pkTr"></div>' +
      '<div class="pk-acc"><button class="pr-play pk-go" id="pkComp">COMPROBAR</button></div><p class="pk-fb" id="pkFb"></p>';
    on('pkOtra', 'click', nuevo);
    on('pkComp', 'click', comprobar);
    function nuevo() {
      feedback('');
      var p = azar(PROGS.filter(function (x) { return !x.blues; })), menor = p.modo === 'menor';
      var desde = azar(['C', 'G', 'D', 'A', 'E', 'F'].map(function (n) { return menor ? RAIZ_MENOR[pcDe(n)] : n; }));
      var k = azar([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]);
      var hasta = (menor ? RAIZ_MENOR : RAIZ_MAYOR)[mod12(pcDe(desde) + k)];
      st.orig = acordesProg(p, desde); st.dest = acordesProg(p, hasta); st.listo = false; st.fallos = 0;
      q('#pkSub').textContent = 'Lleva estos acordes de ' + ver(desde) + (menor ? ' menor' : '') + ' a ' + ver(hasta) + (menor ? ' menor' : '');
      q('#pkBig').textContent = st.orig.map(function (a) { return ver(cifra(a.raiz, a.tipo)); }).join('  ');
      q('#pkSub2').textContent = 'Elige la nota de cada acorde; el tipo (m, 7…) no cambia.';
      var ops = (menor ? RAIZ_MENOR : RAIZ_MAYOR).map(function (n) { return [n, ver(n)]; });
      q('#pkTr').innerHTML = st.orig.map(function (a, i) {
        return '<div class="pk-cif"><span class="pk-rom">' + esc(ver(cifra(a.raiz, a.tipo))) + ' →</span>' +
          '<span class="pk-ac">' + selHtml('pkT' + i, [['', '¿?']].concat(ops), '', 'Acorde ' + (i + 1)) + '<b>' + esc(sufijo(a.tipo)) + '</b></span></div>';
      }).join('');
    }
    function comprobar() {
      if (st.listo) return;
      var bien = 0, vacios = 0;
      st.dest.forEach(function (a, i) {
        var sel = q('#pkT' + i), v = sel.value;
        if (!v) { vacios++; return; }
        var ok = pcDe(v) === pcDe(a.raiz);
        sel.classList.toggle('ok', ok); sel.classList.toggle('bad', !ok);
        if (ok) bien++;
      });
      if (vacios) { feedback('Te falta' + (vacios > 1 ? 'n ' + vacios : ' uno') + '.', ''); return; }
      if (bien === st.dest.length) {
        st.listo = true; anotar('transponer', st.fallos === 0);
        feedback('¡Bien! ' + st.dest.map(function (a) { return ver(cifra(a.raiz, a.tipo)); }).join(' – '), 'ok');
        acompanar(st.dest, ritmo('negras'), 96, {});
        setTimeout(function () { if (S.tema && S.tema.id === 'transponer' && S.modo === 'practicar') nuevo(); }, 3200);
      } else {
        if (!st.fallos) anotar('transponer', false);
        st.fallos++;
        feedback(bien + ' de ' + st.dest.length + ' bien. Cuenta cuántos semitonos hay entre los dos tonos y mueve cada acorde lo mismo.' +
          (st.fallos >= 2 ? ' Respuesta: ' + st.dest.map(function (a) { return ver(cifra(a.raiz, a.tipo)); }).join(' – ') : ''), 'bad');
      }
    }
    nuevo();
  }

  /* ---------- 7. rítmica ---------- */
  function rejilla(r, paso, resultado) {
    var cuenta = cuentaRitmo(r), filas = [['Mano der.', r.md], ['Mano izq.', r.mi]];
    var h = '<div class="pk-rej" style="grid-template-columns:72px repeat(' + r.md.length + ',1fr)">';
    h += '<span></span>' + cuenta.map(function (c, i) { return '<span class="pk-cu' + (i === paso ? ' on' : '') + '">' + c + '</span>'; }).join('');
    filas.forEach(function (f) {
      h += '<span class="ctl-label">' + f[0] + '</span>';
      for (var i = 0; i < f[1].length; i++) {
        var ch = f[1][i], txt = ch === '.' ? '' : ch === 'A' ? '●' : ch === 'B' ? 'B' : ch;
        h += '<span class="pk-cel' + (ch !== '.' ? ' lleno' : '') + (i === paso ? ' on' : '') + '">' + txt + '</span>';
      }
    });
    if (resultado) {
      h += '<span class="ctl-label">Tú</span>';
      for (var j = 0; j < r.md.length; j++) h += '<span class="pk-cel">' + (resultado[j] || '') + '</span>';
    }
    return h + '</div>';
  }
  var PROG_RITMO = [
    { id: 'pop', raiz: 'C' }, { id: 'menor', raiz: 'A' }, { id: 'iivi', raiz: 'F' }, { id: 'folk', raiz: 'G' }
  ];
  function apRitmica(el) {
    var st = S.st; st.r = st.r || 'negras'; st.bpm = st.bpm || 80; st.pr = st.pr || 0;
    el.innerHTML =
      '<p class="ed-note">El ritmo es lo que hace que un acompañamiento suene a bolero, a cumbia o a balada, aunque los acordes sean los mismos. La regla de oro: <b>la mano izquierda marca el bajo en los tiempos fuertes</b> y la derecha "dibuja" el estilo. Cuenta en voz alta ("1 y 2 y…") mientras escuchas.</p>' +
      '<div class="controls">' + ctl('Ritmo', selHtml('pkRit', RITMOS.map(function (r) { return [r.id, r.nom]; }), st.r, 'Ritmo')) +
      ctl('Sobre', selHtml('pkSobre', PROG_RITMO.map(function (x, i) { var a = acordesProg(prog(x.id), x.raiz); return [i, a.map(function (c) { return ver(cifra(c.raiz, c.tipo)); }).join(' ')]; }), st.pr, 'Acordes')) +
      ctl('Tempo', '<div class="stepper"><button id="pkBpmM" aria-label="Más lento">−</button><span class="val" id="pkBpm"></span><button id="pkBpmP" aria-label="Más rápido">+</button></div>') +
      '<button class="pr-play pk-go" id="pkPlay">TOCAR</button></div>' +
      '<p class="pk-sub" id="pkTxt"></p><div id="pkRej"></div>' +
      '<p class="ed-note">● = acorde con la mano derecha · 1 3 5 8 = una nota del acorde (8 = la fundamental arriba) · B = bajo · 5 = la quinta en el bajo.</p>';
    function pintar(paso) {
      var r = ritmo(st.r);
      q('#pkTxt').textContent = r.comp + ' · ' + r.txt;
      q('#pkRej').innerHTML = rejilla(r, paso);
      q('#pkBpm').textContent = st.bpm;
    }
    function tocarR() {
      var x = PROG_RITMO[st.pr];
      acompanar(acordesProg(prog(x.id), x.raiz), ritmo(st.r), st.bpm, { loop: true, clic: true, paso: function (k, s) { pintar(s); } });
      q('#pkPlay').textContent = 'DETENER'; q('#pkPlay').classList.add('playing');
    }
    function detener() { parar(); q('#pkPlay').textContent = 'TOCAR'; q('#pkPlay').classList.remove('playing'); pintar(); }
    function reiniciar() { if (sonando()) tocarR(); else pintar(); }
    on('pkPlay', 'click', function () { if (sonando()) detener(); else tocarR(); });
    on('pkRit', 'change', function () { st.r = this.value; reiniciar(); });
    on('pkSobre', 'change', function () { st.pr = +this.value; reiniciar(); });
    on('pkBpmM', 'click', function () { st.bpm = Math.max(40, st.bpm - 5); reiniciar(); });
    on('pkBpmP', 'click', function () { st.bpm = Math.min(180, st.bpm + 5); reiniciar(); });
    pintar();
  }
  function prRitmica(el) {
    var st = S.st; st.r = st.r || 'negras'; st.bpm = st.bpm || 70;
    el.innerHTML = cajaEjercicio(ctl('Ritmo', selHtml('pkRit', RITMOS.map(function (r) { return [r.id, r.nom]; }), st.r, 'Ritmo')) +
      ctl('Tempo', '<div class="stepper"><button id="pkBpmM" aria-label="Más lento">−</button><span class="val" id="pkBpm"></span><button id="pkBpmP" aria-label="Más rápido">+</button></div>')) +
      '<div id="pkRej"></div>' +
      '<div class="pk-acc"><button class="pr-play pk-go" id="pkPlay">EMPEZAR</button><button class="pk-tap" id="pkTap" disabled>TOCA AQUÍ</button></div>' +
      '<p class="pk-fb" id="pkFb"></p>';
    var TOL = 0.12, COMPASES = 4;
    function pintar(paso, res) {
      var r = ritmo(st.r);
      q('#pkBig').textContent = r.nom;
      q('#pkSub').textContent = 'Toca la mano derecha (● y números) sobre el bajo, durante ' + COMPASES + ' compases';
      q('#pkSub2').textContent = 'Con la tecla espaciadora, el botón o cualquier tecla del teclado MIDI. Primero suena un compás de cuenta.';
      q('#pkRej').innerHTML = rejilla(r, paso, res);
      q('#pkBpm').textContent = st.bpm;
    }
    function empezar() {
      var r = ritmo(st.r), c = ac(); if (!c) return;
      var n = r.md.length, dur = r.comp === '6/8' ? 60 / st.bpm / 3 : 60 / st.bpm / 2;
      st.golpes = []; st.esperados = []; st.res = {};
      var x = PROG_RITMO[0], acs = acordesProg(prog(x.id), x.raiz);
      var cuenta = [{ raiz: acs[0].raiz, tipo: acs[0].tipo }];
      feedback('');
      q('#pkTap').disabled = false; q('#pkPlay').disabled = true;
      S.onKey = function () { golpe(); };
      // compás de cuenta (solo clic) + 4 compases con bajo y clic; la derecha la pones tú
      var total = n * (COMPASES + 1);
      reproducir({
        dur: dur, total: total,
        sched: function (i, t) {
          var s = i % n, compas = Math.floor(i / n);
          if (s % (r.comp === '6/8' ? 3 : 2) === 0) clic(t, s === 0);
          if (compas === 0) return;
          var a = acs[(compas - 1) % acs.length], b = bajo(a.raiz);
          if (r.mi[s] === 'B') tocar(b, t, dur * 3.5, 0.75);
          else if (r.mi[s] === '5') tocar(b + 7, t, dur * 3, 0.6);
          if (r.md[s] !== '.') st.esperados.push({ t: t, s: s, usado: false });
        },
        paso: function (i) { pintar(i % n, st.res); },
        fin: function () { setTimeout(evaluar, TOL * 1000 + 50); }
      });
      void cuenta;
    }
    function golpe() {
      var c = ac(); if (!c || q('#pkTap').disabled) return;
      var t = c.currentTime;
      st.golpes.push(t);
      tocarVarias([60, 64, 67], t, 0.25, 0.35);
      var mejor = null;
      st.esperados.forEach(function (e) { if (!e.usado && Math.abs(e.t - t) <= TOL && (!mejor || Math.abs(e.t - t) < Math.abs(mejor.t - t))) mejor = e; });
      if (mejor) { mejor.usado = true; mejor.desv = t - mejor.t; st.res[mejor.s] = Math.abs(mejor.desv) < 0.05 ? '✓' : mejor.desv < 0 ? '←' : '→'; }
      else st.extras = (st.extras || 0) + 1;
    }
    function evaluar() {
      q('#pkTap').disabled = true; q('#pkPlay').disabled = false; S.onKey = null;
      var tot = st.esperados.length, bien = st.esperados.filter(function (e) { return e.usado; }).length, extras = st.extras || 0;
      st.extras = 0;
      var pct = tot ? Math.round(100 * Math.max(0, bien - extras) / tot) : 0;
      var desv = st.esperados.filter(function (e) { return e.usado; }).map(function (e) { return e.desv; });
      var prom = desv.length ? desv.reduce(function (a, b) { return a + b; }, 0) / desv.length : 0;
      anotar('ritmica', pct >= 80);
      feedback(pct + '% · ' + bien + ' de ' + tot + ' golpes a tiempo' + (extras ? ', ' + extras + ' de más' : '') +
        (Math.abs(prom) > 0.03 ? '. Vas ' + (prom < 0 ? 'adelantado' : 'atrasado') + ' unos ' + Math.round(Math.abs(prom) * 1000) + ' ms.' : '.') +
        (pct >= 80 ? ' ¡Bien! Sube el tempo o prueba otro ritmo.' : ' Baja el tempo y cuenta en voz alta.'), pct >= 80 ? 'ok' : 'bad');
    }
    on('pkPlay', 'click', empezar);
    on('pkTap', 'pointerdown', function (e) { e.preventDefault(); golpe(); });
    on('pkRit', 'change', function () { st.r = this.value; pintar(); });
    on('pkBpmM', 'click', function () { st.bpm = Math.max(40, st.bpm - 5); pintar(); });
    on('pkBpmP', 'click', function () { st.bpm = Math.min(160, st.bpm + 5); pintar(); });
    pintar();
  }

  /* ================= montaje ================= */
  function teclaEspacio(e) {
    if (e.code !== 'Space' || !S.onKey || S.tema == null || S.tema.id !== 'ritmica') return;
    if (/INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || '')) return;
    e.preventDefault();
    S.onKey(0, 'espacio');
  }
  function mount(view, rest, ctx) {
    S.view = view; S.ctx = ctx;
    if (!S.cfg) S.cfg = cargarCfg();
    if (!S.espacio) { S.espacio = true; document.addEventListener('keydown', teclaEspacio); }
    var partes = String(rest || '').split('/'), t = temaDe(partes[0]);
    if (t) abrirTema(t, partes[1]); else { S.tema = null; portada(); }
  }
  function onLeave() { parar(); S.onKey = null; S.tema = null; }

  // gancho mínimo de inspección (para probar sin exponer todo)
  SB.piano = { estado: function () { return { st: S.st, tema: S.tema && S.tema.id, t: S.ac && S.ac.currentTime }; } };

  SB.registry.register({ id: 'piano', name: 'Piano', kind: 'primary', icon: ICON, mount: mount, onLeave: onLeave });
})();
