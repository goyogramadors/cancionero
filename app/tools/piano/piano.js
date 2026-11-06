/* ============================================================
   Sub-herramienta: Piano — aprender piano POPULAR y funcional
   (acompañar canciones), no clásico. Pestaña primaria.

   Se organiza en UNIDADES, cada una con LECCIONES. Una lección es una
   tarea: una explicación corta, un ejercicio interactivo (se resuelve con
   el mouse sobre un teclado en pantalla, o con un piano MIDI) y una meta
   de aciertos; al llegar a la meta queda marcada como completada. También
   se puede marcar y desmarcar a mano. Varias unidades traen además un
   "explorador" para mirar y escuchar antes de practicar.

   Sin dependencias fuera de SB. Sonido: sintetizador propio (Web Audio).
   Las notas se deletrean por letra (Re + 3ª mayor = Fa#, no Solb) y se
   muestran en Do-Re-Mi o en cifrado americano. El avance se guarda en
   este dispositivo (localStorage, `sb.piano.progreso`).
   Rutas: #/piano · #/piano/<unidad> · #/piano/<unidad>/<lección>
   ============================================================ */
(function () {
  window.SB = window.SB || {};

  var CFGKEY = 'sb.piano.cfg', PROGKEY = 'sb.piano.progreso';
  var S = { view: null, ctx: null, cfg: null, uni: null, lec: null, st: {}, onKey: null, held: new Set(), midi: null };

  /* ================= teoría: nombres y deletreo ================= */
  var LETRAS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  var PC_LETRA = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var LAT = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };
  var SOST = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var BEM = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  var RAIZ_MAYOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  var RAIZ_MENOR = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
  var SIMPLE = { Cb: 'B', Fb: 'E', 'E#': 'F', 'B#': 'C' };

  function mod12(n) { return ((n % 12) + 12) % 12; }
  function pcDe(nombre) {
    var m = /^([A-G])(#{1,2}|b{1,2})?/.exec(nombre || '');
    if (!m) return 0;
    var acc = m[2] || '';
    return mod12(PC_LETRA[m[1]] + (acc[0] === '#' ? acc.length : -acc.length));
  }
  // Nota a distancia `semis` de la raíz, escrita con la letra del grado
  // (3ª de Re = alguna Fa; 4 semitonos = Fa#). En piano popular nadie
  // escribe Cb ni dobles alteraciones: se usa la tecla simple.
  function deletrear(raiz, semis, grado) {
    var li = LETRAS.indexOf(raiz[0]);
    var letra = LETRAS[(li + grado - 1) % 7];
    var dif = mod12(pcDe(raiz) + semis - PC_LETRA[letra]);
    if (dif > 6) dif -= 12;
    if (Math.abs(dif) > 1) return (dif > 0 ? SOST : BEM)[mod12(pcDe(raiz) + semis)];
    var n = letra + (dif > 0 ? '#' : dif < 0 ? 'b' : '');
    return SIMPLE[n] || n;
  }
  function ver(txt) {
    if (!S.cfg.latin) return String(txt);
    return String(txt).replace(/([A-G])(#{1,2}|b{1,2})?/g, function (_, l, acc) { return LAT[l] + (acc || ''); });
  }
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
  function intervalo(s) { for (var i = 0; i < INTERVALOS.length; i++) if (INTERVALOS[i].s === s) return INTERVALOS[i]; return INTERVALOS[3]; }

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
  function pcsAcorde(raiz, tipoId) { return tipo(tipoId).iv.map(function (s) { return mod12(pcDe(raiz) + s); }); }
  // sufijo del cifrado de una canción → tipo conocido (lo demás, tríada)
  function tipoDeSufijo(suf) {
    suf = String(suf || '').replace('º', 'dim');
    if (TIPOS.some(function (t) { return t.id === suf; })) return suf;
    if (/^dim/.test(suf)) return 'dim';
    if (/^m(?!aj)/.test(suf)) return /7/.test(suf) ? 'm7' : 'm';
    if (/^maj7|^Δ/.test(suf)) return 'maj7';
    if (/7|9|13/.test(suf)) return '7';
    return '';
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

  // Campo armónico. En menor el V va mayor (prestado de la armónica).
  var CAMPO = {
    mayor: { esc: [0, 2, 4, 5, 7, 9, 11], tri: ['', 'm', 'm', '', '', 'm', 'dim'], sep: ['maj7', 'm7', 'm7', 'maj7', '7', 'm7', 'm7b5'],
             rom: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'viiº'], fun: ['T', 'SD', 'T', 'SD', 'D', 'T', 'D'] },
    menor: { esc: [0, 2, 3, 5, 7, 8, 10], tri: ['m', 'dim', '', 'm', '', '', ''], sep: ['m7', 'm7b5', 'maj7', 'm7', '7', 'maj7', '7'],
             rom: ['i', 'iiº', 'III', 'iv', 'V', 'VI', 'VII'], fun: ['T', 'SD', 'T', 'SD', 'D', 'SD', 'D'] }
  };
  var FUNCION = { T: 'Tónica: reposo, "estar en casa"', SD: 'Subdominante: se aleja, prepara', D: 'Dominante: tensión, pide volver a la tónica' };
  function grado(raiz, modo, g, sept) {
    var c = CAMPO[modo], r = deletrear(raiz, c.esc[g], g + 1);
    var s7 = c.sep[g], rom = !sept ? c.rom[g] : s7 === 'maj7' ? c.rom[g] + 'maj7' : s7 === 'm7b5' ? c.rom[g].replace('º', '') + 'ø7' : c.rom[g] + '7';
    return { raiz: r, tipo: sept ? s7 : c.tri[g], rom: rom, fun: c.fun[g], g: g };
  }

  var PROGS = [
    { id: 'folk', nom: 'I – IV – V – I', modo: 'mayor', g: [0, 3, 4, 0], txt: 'Tónica, subdominante, dominante: folclor, rancheras, rock and roll.' },
    { id: 'pop', nom: 'I – V – vi – IV', modo: 'mayor', g: [0, 4, 5, 3], txt: 'La progresión del pop: miles de canciones la usan de principio a fin.' },
    { id: '50s', nom: 'I – vi – IV – V', modo: 'mayor', g: [0, 5, 3, 4], txt: 'La de los años 50 y las baladas románticas ("Stand by me").' },
    { id: 'emo', nom: 'vi – IV – I – V', modo: 'mayor', g: [5, 3, 0, 4], txt: 'La misma del pop empezando en el vi: suena más melancólica.' },
    { id: 'iivi', nom: 'ii – V – I', modo: 'mayor', g: [1, 4, 0, 0], sept: true, txt: 'La cadencia del jazz, el bolero y la bossa nova. Se toca con séptimas.' },
    { id: 'circulo', nom: 'I – vi – ii – V', modo: 'mayor', g: [0, 5, 1, 4], sept: true, txt: 'El "círculo": cada acorde lleva al siguiente. Boleros y standards.' },
    { id: 'menor', nom: 'i – iv – V – i', modo: 'menor', g: [0, 3, 4, 0], txt: 'La cadencia menor: boleros, baladas y música latinoamericana.' },
    { id: 'andaluza', nom: 'i – VII – VI – V', modo: 'menor', g: [0, 6, 5, 4], txt: 'La andaluza: flamenco, rumba, "Hit the road Jack".' },
    { id: 'menorpop', nom: 'i – VI – III – VII', modo: 'menor', g: [0, 5, 2, 6], txt: 'La del pop en menor: la misma de I–V–vi–IV vista desde el relativo menor.' },
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

  // Ritmos de acompañamiento. Un paso = una corchea. Mano izquierda:
  // B = bajo (fundamental), 5 = quinta, 8 = octava. Mano derecha: A = el
  // acorde entero; 1 3 5 8 = una nota del acorde (arpegio).
  var RITMOS = [
    { id: 'negras', nom: 'Balada en negras', comp: '4/4', mi: 'B...B...', md: 'A.A.A.A.', txt: 'El acompañamiento más simple: bajo en 1 y 3, acorde en cada tiempo. Para aprender canciones nuevas.' },
    { id: 'corcheas', nom: 'Pop en corcheas', comp: '4/4', mi: 'B...B...', md: 'AAAAAAAA', txt: 'Acordes parejos en corcheas: pop y rock. Marca más fuerte el 1 y el 3.' },
    { id: 'arpegio', nom: 'Balada arpegiada', comp: '4/4', mi: 'B.......', md: '.135831.', txt: 'Las notas del acorde una a una sobre el bajo largo: baladas lentas.' },
    { id: 'octavas', nom: 'Bajo en octavas', comp: '4/4', mi: 'B.8.B.8.', md: 'A...A...', txt: 'La izquierda alterna fundamental y su octava: rock and roll, boogie, cumbia chilena.' },
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
  function candidatos(raiz, tipoId) {
    var pcs = pcsAcorde(raiz, tipoId);
    if (pcs.length > 4) pcs = pcs.filter(function (_, i) { return i !== 2; }); // novena: sin la quinta
    var out = [];
    for (var inv = 0; inv < pcs.length; inv++) {
      var rot = pcs.slice(inv).concat(pcs.slice(0, inv));
      for (var base = 52; base <= 67; base++) {
        if (mod12(base) !== rot[0]) continue;
        var v = [base];
        for (var k = 1; k < rot.length; k++) {
          var n = v[k - 1] + 1;
          while (mod12(n) !== rot[k]) n++;
          v.push(n);
        }
        if (v[v.length - 1] <= 79) out.push(v);
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
      } else c = Math.abs(v.reduce(function (a, b) { return a + b; }, 0) / v.length - 64);
      if (c < costo) { costo = c; mejor = v; }
    });
    return mejor;
  }
  function bajo(raiz) { var p = pcDe(raiz); return p >= 5 ? 36 + p : 48 + p; } // de Fa2 a Mi3: grave pero no barroso

  /* ================= sonido ================= */
  // El sonido es el motor del piano de Go.io (core/piano-sonido.js):
  // muestras del Salamander Grand Piano, con cuerda simulada de respaldo.
  function ac() {
    var P = SB.pianoSonido, c = P && P.ctx();
    if (c) { S.ac = c; P.cargar(); }
    return c;
  }
  function tocar(m, cuando, dur, vel) {
    if (!ac()) return;
    SB.pianoSonido.tocar(m, cuando, dur || 1.4, vel == null ? 0.6 : vel);
  }
  function tocarVarias(ms, cuando, dur, vel) { ms.forEach(function (m) { tocar(m, cuando, dur, vel); }); }
  function clic(cuando, fuerte) {
    var c = ac(); if (!c) return;
    var o = c.createOscillator(), g = c.createGain();
    o.frequency.value = fuerte ? 1500 : 1000; o.type = 'square';
    o.connect(g); g.connect(SB.pianoSonido.salida());
    g.gain.setValueAtTime(fuerte ? 0.12 : 0.06, cuando);
    g.gain.exponentialRampToValueAtTime(0.0001, cuando + 0.04);
    o.start(cuando); o.stop(cuando + 0.05);
  }

  // Reproductor por pasos con planificación anticipada.
  var R = { timer: null };
  function reproducir(spec) {
    parar();
    var c = ac(); if (!c) return;
    var i = 0, t = c.currentTime + 0.12, sec = (R.sec = (R.sec || 0) + 1);
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

  // Toca acordes con un ritmo. acordes: [{raiz, tipo}], un acorde por compás.
  function acompanar(acordes, r, bpm, opt) {
    opt = opt || {};
    var porCompas = r.md.length, dur = r.comp === '6/8' ? 60 / bpm / 3 : 60 / bpm / 2;
    var voces = [], previa = null;
    acordes.forEach(function (a) { previa = voz(a.raiz, a.tipo, previa); voces.push(previa); });
    reproducir({
      dur: dur, total: opt.loop ? null : acordes.length * porCompas,
      sched: function (i, t) {
        var k = Math.floor(i / porCompas) % acordes.length, s = i % porCompas, a = acordes[k], v = voces[k];
        var b = bajo(a.raiz), ci = r.mi[s], cd = r.md[s];
        if (ci === 'B') tocar(b, t, dur * 3.5, 0.75);
        else if (ci === '5') tocar(b + (tipo(a.tipo).iv[2] === 6 ? 6 : 7), t, dur * 3, 0.6);
        else if (ci === '8') tocar(b + 12, t, dur * 3, 0.6);
        if (!opt.sinDerecha) {
          if (cd === 'A') tocarVarias(v, t, dur * (r.md[s + 1] === '.' ? 1.9 : 0.95), s === 0 ? 0.62 : 0.5);
          else if ('1358'.indexOf(cd) >= 0) {
            var idx = { 1: 0, 3: 1, 5: 2, 8: 0 }[cd], m = v[Math.min(idx, v.length - 1)] + (cd === '8' ? 12 : 0);
            tocar(m, t, dur * 2.5, 0.5);
          }
        }
        if (opt.clic && s % (r.comp === '6/8' ? 3 : 2) === 0) clic(t, s === 0);
      },
      paso: function (i) { if (opt.paso) opt.paso(Math.floor(i / porCompas) % acordes.length, i % porCompas, voces, i); },
      fin: opt.fin
    });
    return voces;
  }

  /* ================= teclado en pantalla ================= */
  // marcas: { midi: {c: 'on'|'sel'|'ok'|'bad'|'tenue', t: 'etiqueta'} }
  var NEGRAS = [1, 3, 6, 8, 10];
  function esNegra(m) { return NEGRAS.indexOf(mod12(m)) >= 0; }
  // Teclado del computador (QWERTY español, igual que el piano de Go.io):
  //   blancas  TAB Q W E R T Y | U I O P ` + Enter
  //   negras   1 2 · 4 5 6 | 8 9 · ' ¡ Borrar
  // TAB es el Do de la octava elegida (Do4 de partida); ↑ ↓ la cambian.
  var QW = [['Tab', 'TAB'], ['Digit1', '1'], ['KeyQ', 'Q'], ['Digit2', '2'], ['KeyW', 'W'], ['KeyE', 'E'], ['Digit4', '4'],
    ['KeyR', 'R'], ['Digit5', '5'], ['KeyT', 'T'], ['Digit6', '6'], ['KeyY', 'Y'], ['KeyU', 'U'], ['Digit8', '8'],
    ['KeyI', 'I'], ['Digit9', '9'], ['KeyO', 'O'], ['KeyP', 'P'], ['Minus', "'"], ['BracketLeft', '`'], ['Equal', '¡'],
    ['BracketRight', '+'], ['Backspace', '⌫'], ['Enter', '↵']];
  var QW_KEY = { tab: 0, '1': 1, q: 2, '2': 3, w: 4, e: 5, '4': 6, r: 7, '5': 8, t: 9, '6': 10, y: 11, u: 12, '8': 13, i: 14, '9': 15,
    o: 16, p: 17, "'": 18, '`': 19, '^': 19, '[': 19, '¡': 20, '=': 20, '+': 21, '*': 21, ']': 21, backspace: 22, enter: 23 };
  var tactil = !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
  function qwOn() { return !tactil && !(S.cfg && S.cfg.qw === false); }
  function baseQw() { var b = S.cfg && S.cfg.qwBase; return b >= 36 && b <= 72 ? b : 60; }
  function tecladoTexto() {
    var b = baseQw();
    return 'Teclado del computador: TAB = ' + nombreMidi(b) + (Math.floor(b / 12) - 1) + ' … ↵ = ' + nombreMidi(b + 23) + (Math.floor((b + 23) / 12) - 1) + ' · ↑ ↓ cambian la octava · letras sobre las teclas';
  }
  function teclado(el, desde, hasta, marcas, onPress) {
    if (!el) return;
    S.teclados = (S.teclados || []).filter(function (t) { return t.el !== el && t.el.isConnected; });
    if (onPress) S.teclados.push({ el: el, desde: desde, hasta: hasta, on: onPress });
    var qb = baseQw(), conLetras = qwOn() && !!onPress;
    var ww = 24, wh = 112, bw = 15, bh = 70, blancas = [];
    for (var m = desde; m <= hasta; m++) if (!esNegra(m)) blancas.push(m);
    var W = blancas.length * ww + 2, svg = '<svg viewBox="0 0 ' + W + ' ' + (wh + 2) + '" class="pk-kb" role="group" aria-label="Teclado">';
    var xDe = {};
    blancas.forEach(function (m, i) { xDe[m] = 1 + i * ww; });
    function marca(m, x, w, y, negra) {
      var k = marcas && marcas[m];
      if (!k) return '';
      var s = '', col = negra ? 'var(--bg)' : 'var(--ink)';
      if (k.c === 'bad') s += '<text x="' + (x + w / 2) + '" y="' + (y + 4) + '" text-anchor="middle" font-size="15" font-weight="700" fill="' + col + '">×</text>';
      else s += '<circle cx="' + (x + w / 2) + '" cy="' + y + '" r="' + (negra ? 5 : 6.5) + '" fill="' + (k.c === 'tenue' ? 'none' : col) + '" stroke="' + col + '" stroke-width="1.5"/>';
      if (k.t) s += '<text x="' + (x + w / 2) + '" y="' + (negra ? y - 10 : y - 12) + '" text-anchor="middle" font-size="' + (negra ? 8 : 9.5) + '" font-weight="700" fill="' + col + '">' + SB.ui.esc(k.t) + '</text>';
      return s;
    }
    blancas.forEach(function (m) {
      var k = marcas && marcas[m], tinte = k && (k.c === 'sel' || k.c === 'ok');
      svg += '<rect data-m="' + m + '" x="' + xDe[m] + '" y="1" width="' + ww + '" height="' + wh + '" rx="2" fill="' + (tinte ? 'var(--chip)' : 'var(--bg)') + '" stroke="var(--ink)" stroke-width="1"/>';
      svg += marca(m, xDe[m], ww, wh - 14, false);
      if (conLetras && m >= qb && m < qb + 24) svg += '<text x="' + (xDe[m] + ww / 2) + '" y="' + (bh + 13) + '" text-anchor="middle" font-size="' + (QW[m - qb][1].length > 1 ? 6 : 8) + '" fill="var(--faint)" class="pk-qw">' + esc(QW[m - qb][1]) + '</text>';
      if (mod12(m) === 0) svg += '<text x="' + (xDe[m] + ww / 2) + '" y="' + (wh - 1) + '" text-anchor="middle" font-size="7" fill="var(--faint)">' + nombreMidi(m) + (Math.floor(m / 12) - 1) + '</text>';
    });
    for (m = desde; m <= hasta; m++) {
      if (!esNegra(m)) continue;
      var x = (xDe[m - 1] || 1) + ww - bw / 2, k2 = marcas && marcas[m], tinte2 = k2 && (k2.c === 'sel' || k2.c === 'ok');
      svg += '<rect data-m="' + m + '" x="' + x + '" y="1" width="' + bw + '" height="' + bh + '" rx="2" fill="' + (tinte2 ? 'var(--mut)' : 'var(--ink)') + '" stroke="var(--ink)"/>';
      svg += marca(m, x, bw, bh - 11, true);
      if (conLetras && m >= qb && m < qb + 24) svg += '<text x="' + (x + bw / 2) + '" y="11" text-anchor="middle" font-size="' + (QW[m - qb][1].length > 1 ? 6 : 7.5) + '" fill="var(--bg)" opacity=".7" class="pk-qw">' + esc(QW[m - qb][1]) + '</text>';
    }
    svg += '</svg>';
    el.innerHTML = svg;
    if (onPress) {
      el.querySelector('svg').addEventListener('pointerdown', function (ev) {
        var r = ev.target.closest && ev.target.closest('[data-m]');
        if (!r) r = document.elementsFromPoint(ev.clientX, ev.clientY).filter(function (n) { return n.dataset && n.dataset.m; })[0];
        if (!r) return;
        ev.preventDefault();
        var mm = +r.dataset.m;
        tocar(mm);
        onPress(mm, 'pantalla');
      });
    }
  }

  function notaDeTecla(e) {
    for (var i = 0; i < QW.length; i++) if (QW[i][0] === e.code) return baseQw() + i;
    var k = String(e.key || '').toLowerCase();
    return QW_KEY.hasOwnProperty(k) ? baseQw() + QW_KEY[k] : null;
  }
  var sueltas = {};
  function teclaAbajo(e) {
    if (document.body.dataset.tool !== 'piano' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || '')) return;
    if (!qwOn()) return;
    var vivos = (S.teclados || []).filter(function (t) { return t.el.isConnected; });
    if (!vivos.length && !(S.onKey && S.lec)) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      S.cfg.qwBase = Math.max(36, Math.min(72, baseQw() + (e.key === 'ArrowUp' ? 12 : -12))); guardarCfg();
      var ay = q('#pkQwTxt'); if (ay) ay.textContent = tecladoTexto();
      vivos.forEach(function (t) { var svg = t.el.querySelector('svg'); if (svg) refrescarLetras(t); });
      return;
    }
    var m = notaDeTecla(e);
    if (m == null) return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    var t = vivos.filter(function (x) { return m >= x.desde && m <= x.hasta; })[0];
    if (vivos.length) {
      // suena siempre; cuenta en el ejercicio si la nota está en un teclado de la pantalla
      sueltas[e.code || e.key] = SB.pianoSonido.apretar(m, 0.6);
      if (t) t.on(m, 'teclado');
    } else if (S.onKey) S.onKey(m, 'teclado');   // rítmica: cualquier tecla es un golpe
  }
  function teclaArriba(e) {
    var id = sueltas[e.code || e.key];
    if (id != null) { SB.pianoSonido.soltar(id); delete sueltas[e.code || e.key]; }
  }
  // tras cambiar de octava, vuelve a dibujar las letras sin tocar las marcas
  function refrescarLetras(t) {
    var svg = t.el.querySelector('svg'), qb = baseQw();
    svg.querySelectorAll('.pk-qw').forEach(function (n) { n.remove(); });
    if (!qwOn()) return;
    svg.querySelectorAll('rect[data-m]').forEach(function (r) {
      var m = +r.dataset.m; if (m < qb || m >= qb + 24) return;
      var negra = esNegra(m), x = +r.getAttribute('x'), w = +r.getAttribute('width'), lab = QW[m - qb][1];
      var tx = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      tx.setAttribute('x', x + w / 2); tx.setAttribute('y', negra ? 11 : 83); tx.setAttribute('text-anchor', 'middle');
      tx.setAttribute('font-size', lab.length > 1 ? 6 : negra ? 7.5 : 8); tx.setAttribute('class', 'pk-qw');
      tx.setAttribute('fill', negra ? 'var(--bg)' : 'var(--faint)'); if (negra) tx.setAttribute('opacity', '.7');
      tx.textContent = lab;
      var primeraNegra = Array.prototype.filter.call(svg.querySelectorAll('rect[data-m]'), function (n) { return esNegra(+n.dataset.m); })[0];
      if (negra || !primeraNegra) svg.appendChild(tx); else svg.insertBefore(tx, primeraNegra);
    });
  }

  // Interruptor de las teclas del computador (para usar sólo el mouse)
  function qwAyudaHtml() {
    if (tactil) return '';
    var on_ = qwOn();
    return '<div class="pk-qwayuda" id="pkQwAyuda"><button class="mini-app-btn pk-qwbtn" id="pkQwBtn" aria-pressed="' + on_ + '" title="Prende o apaga tocar con el teclado del computador">⌨ Teclas: ' + (on_ ? 'SÍ' : 'NO') + '</button>' +
      '<span id="pkQwTxt">' + esc(on_ ? tecladoTexto() : 'Teclas del computador apagadas: se toca sólo con el mouse.') + '</span></div>';
  }
  function wireQw() {
    on('pkQwBtn', 'click', function () {
      S.cfg.qw = !qwOn(); guardarCfg();
      var box = q('#pkQwAyuda'); if (box) box.outerHTML = qwAyudaHtml();
      wireQw();
      (S.teclados || []).forEach(function (t) { if (t.el.isConnected) refrescarLetras(t); });
    });
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
  function guardarAvance(p) { try { localStorage.setItem(PROGKEY, JSON.stringify(p)); } catch (e) {} if (SB.nube) SB.nube.cambio(); }
  function regLec(lec) { var p = avance(); return p[lec.id] || { ok: 0, n: 0, hecha: false }; }
  function anotar(lec, ok) {
    var p = avance(), x = p[lec.id] || (p[lec.id] = { ok: 0, n: 0, hecha: false });
    x.n++;
    if (ok) x.ok++;
    var recien = !x.hecha && x.ok >= lec.meta;
    if (recien) { x.hecha = true; x.th = Date.now(); }
    guardarAvance(p);
    return { reg: x, recien: recien };
  }
  function marcarHecha(lec, v) {
    var p = avance(), x = p[lec.id] || (p[lec.id] = { ok: 0, n: 0, hecha: false });
    x.hecha = !!v; x.th = Date.now(); guardarAvance(p);
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
    return selHtml(id, (menor ? RAIZ_MENOR : RAIZ_MAYOR).map(function (n) { return [n, ver(n)]; }), val, 'Nota');
  }
  function ctl(label, html) { return '<div class="ctl"><span class="ctl-label">' + esc(label) + '</span>' + html + '</div>'; }
  function on(id, ev, fn) { var el = q('#' + id); if (el) el.addEventListener(ev, fn); }
  function feedback(txt, tipoF) {
    var el = q('#pkFb'); if (!el) return;
    el.textContent = txt || '';
    el.className = 'pk-fb' + (tipoF ? ' ' + tipoF : '');
  }
  function consigna(sub, big, sub2) {
    var a = q('#pkSub'), b = q('#pkBig'), c = q('#pkSub2');
    if (a) a.textContent = sub || ''; if (b) b.textContent = big || ''; if (c) c.textContent = sub2 || '';
  }
  function stepper(id, label) {
    return ctl(label, '<div class="stepper"><button id="' + id + 'M" aria-label="Menos">−</button><span class="val" id="' + id + '"></span><button id="' + id + 'P" aria-label="Más">+</button></div>');
  }
  // sigue vigente esta lección (el usuario no se fue a otra parte)
  // En la práctica "12 tonos" las raíces siguen el círculo de quintas
  // (Do Sol Re La Mi Si Fa# Reb Lab Mib Sib Fa), retomando donde quedó.
  var CICLO = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
  function raizAzar(menor, lista) {
    if (S.ciclo) return (menor ? RAIZ_MENOR : RAIZ_MAYOR)[CICLO[S.ciclo.i++ % 12]];
    return azar(lista || (menor ? RAIZ_MENOR : RAIZ_MAYOR));
  }
  function vigente(lec) { return S.lec === lec; }
  function luego(lec, ms, fn) { setTimeout(function () { if (vigente(lec)) fn(); }, ms); }

  /* ================= exploradores (mirar y escuchar) ================= */
  function exIntervalos(el, st) {
    st.raiz = st.raiz || 'C'; st.iv = st.iv || 4;
    el.innerHTML =
      '<div class="controls">' + ctl('Desde', selRaiz('pkXRaiz', st.raiz)) + '<button class="mini-app-btn" id="pkXOir">Escuchar</button></div>' +
      '<div class="pk-grid" id="pkXIvs">' + INTERVALOS.map(function (iv) {
        return '<button class="pk-opt" data-s="' + iv.s + '" aria-pressed="' + (iv.s === st.iv) + '"><b>' + iv.s + '</b> ' + esc(iv.nom) + '</button>';
      }).join('') + '</div>' +
      '<div class="pk-stage"><div class="pk-big" id="pkXBig"></div><div class="pk-sub" id="pkXSub"></div></div><div class="pk-kbw" id="pkXKb"></div>';
    function pintar() {
      var iv = intervalo(st.iv), n2 = deletrear(st.raiz, iv.s, iv.g), m1 = 48 + pcDe(st.raiz), m2 = m1 + iv.s, mk = {};
      mk[m1] = { c: 'on', t: ver(st.raiz) }; mk[m2] = { c: 'on', t: ver(n2) };
      q('#pkXBig').textContent = ver(st.raiz) + ' → ' + ver(n2);
      q('#pkXSub').textContent = iv.nom + ' · ' + iv.s + ' semitono' + (iv.s > 1 ? 's' : '') + '. ' + iv.uso;
      teclado(q('#pkXKb'), 48, 72, mk, function () {});
      return [m1, m2];
    }
    function oir() {
      var ms = pintar(), c = ac(); if (!c) return;
      var t = c.currentTime + 0.05;
      tocar(ms[0], t, 0.9); tocar(ms[1], t + 0.6, 0.9); tocarVarias(ms, t + 1.3, 1.6);
    }
    on('pkXRaiz', 'change', function () { st.raiz = this.value; oir(); });
    on('pkXOir', 'click', oir);
    S.view.querySelectorAll('#pkXIvs button').forEach(function (b) {
      b.addEventListener('click', function () {
        st.iv = +b.dataset.s;
        S.view.querySelectorAll('#pkXIvs button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        oir();
      });
    });
    pintar();
  }
  function exAcordes(el, st) {
    st.raiz = st.raiz || 'C'; st.tipo = st.tipo != null ? st.tipo : ''; st.inv = st.inv || 0;
    el.innerHTML =
      '<div class="controls">' + ctl('Raíz', selRaiz('pkXRaiz', st.raiz)) +
      ctl('Tipo', selHtml('pkXTipo', TIPOS.map(function (t) { return [t.id, t.nom]; }), st.tipo, 'Tipo')) +
      ctl('Inversión', '<div id="pkXInvW"></div>') + '<button class="mini-app-btn" id="pkXOir">Escuchar</button></div>' +
      '<div class="pk-stage"><div class="pk-big" id="pkXBig"></div><div class="pk-sub" id="pkXSub"></div></div>' +
      '<div class="pk-manos"><div><div class="ctl-label">Mano izquierda</div><div class="pk-kbw pk-izq" id="pkXKbI"></div></div>' +
      '<div class="pk-der"><div class="ctl-label">Mano derecha</div><div class="pk-kbw" id="pkXKbD"></div></div></div>';
    function invHtml() {
      var n = tipo(st.tipo).iv.length, ops = [['0', 'Fundamental'], ['1', '1ª'], ['2', '2ª']];
      if (n >= 4) ops.push(['3', '3ª']);
      if (st.inv >= n) st.inv = 0;
      q('#pkXInvW').innerHTML = segHtml('pkXInv', ops, String(st.inv));
      segWire('pkXInv', function (v) { st.inv = +v; oir(); });
    }
    function pintar() {
      var t = tipo(st.tipo), notas = notasAcorde(st.raiz, st.tipo), p = pcDe(st.raiz);
      var iv = t.iv.slice(st.inv).concat(t.iv.slice(0, st.inv).map(function (s) { return s + 12; }));
      var gr = t.gr.slice(st.inv).concat(t.gr.slice(0, st.inv)), nm = notas.slice(st.inv).concat(notas.slice(0, st.inv));
      var base = 60 + p; if (base + Math.max.apply(null, iv) > 84) base -= 12;
      var md = iv.map(function (s) { return base + s; }), mi = 36 + p, mkD = {}, mkI = {};
      md.forEach(function (m, i) { mkD[m] = { c: 'on', t: ver(nm[i]) }; });
      mkI[mi] = { c: 'on', t: ver(st.raiz) };
      q('#pkXBig').textContent = ver(cifra(st.raiz, st.tipo) + (st.inv ? '/' + nm[0] : ''));
      q('#pkXSub').textContent = t.nom + ' · ' + t.f + ' · ' + notas.map(ver).join(' – ') +
        (st.inv ? ' · ' + (st.inv === 1 ? 'primera' : st.inv === 2 ? 'segunda' : 'tercera') + ' inversión: abajo queda la ' + gr[0] + 'ª' : '');
      teclado(q('#pkXKbI'), 36, 48, mkI); teclado(q('#pkXKbD'), 48, 84, mkD);
      return { md: md, mi: mi };
    }
    function oir() {
      var v = pintar(), c = ac(); if (!c) return;
      var t = c.currentTime + 0.05;
      tocar(v.mi, t, 1.8, 0.7);
      v.md.forEach(function (m, i) { tocar(m, t + 0.35 + i * 0.12, 1.4); });
      tocarVarias(v.md.concat([v.mi]), t + 0.45 + v.md.length * 0.12 + 0.3, 1.8);
    }
    on('pkXRaiz', 'change', function () { st.raiz = this.value; oir(); });
    on('pkXTipo', 'change', function () { st.tipo = this.value; invHtml(); oir(); });
    on('pkXOir', 'click', oir);
    invHtml(); pintar();
  }
  function exEscalas(el, st) {
    st.raiz = st.raiz || 'C'; st.esc = st.esc || 'mayor';
    el.innerHTML =
      '<div class="controls">' + ctl('Tónica', '<span id="pkXRaizW"></span>') +
      ctl('Escala', selHtml('pkXEsc', ESCALAS.map(function (e) { return [e.id, e.nom]; }), st.esc, 'Escala')) +
      '<button class="mini-app-btn" id="pkXOir">Escuchar</button></div>' +
      '<div class="pk-stage"><div class="pk-big pk-mid" id="pkXBig"></div><div class="pk-sub" id="pkXSub"></div><div class="pk-sub" id="pkXSub2"></div></div>' +
      '<div class="pk-kbw" id="pkXKb"></div>';
    function raizSel() {
      var menor = !!escala(st.esc).menor;
      st.raiz = (menor ? RAIZ_MENOR : RAIZ_MAYOR)[pcDe(st.raiz)];
      q('#pkXRaizW').innerHTML = selRaiz('pkXRaiz', st.raiz, menor);
      on('pkXRaiz', 'change', function () { st.raiz = this.value; oir(); });
    }
    function midis() { var b = 48 + pcDe(st.raiz); return escala(st.esc).iv.concat([12]).map(function (s) { return b + s; }); }
    function pintar(activo) {
      var e = escala(st.esc), ns = notasEscala(st.raiz, e), ms = midis(), mk = {};
      ms.forEach(function (m, i) { mk[m] = { c: activo === i ? 'ok' : 'on', t: ver(ns[i % ns.length]) }; });
      q('#pkXBig').textContent = ns.concat([ns[0]]).map(ver).join(' ');
      q('#pkXSub').textContent = e.nom + ' de ' + ver(st.raiz) + ' · ' + pasos(e);
      q('#pkXSub2').textContent = e.uso + (e.id === 'mayor' ? ' Digitación de la mano derecha en Do, Sol, Re, La y Mi: 1-2-3, pasa el pulgar, 1-2-3-4-5.' : '');
      teclado(q('#pkXKb'), 48, 74, mk, function () {});
    }
    function oir() {
      var ms = midis(), ida = ms.concat(ms.slice(0, -1).reverse());
      reproducir({ dur: 0.32, total: ida.length, sched: function (i, t) { tocar(ida[i], t, 0.5); },
        paso: function (i) { pintar(i < ms.length ? i : ida.length - 1 - i); }, fin: function () { pintar(); } });
    }
    on('pkXEsc', 'change', function () { st.esc = this.value; raizSel(); oir(); });
    on('pkXOir', 'click', oir);
    raizSel(); pintar();
  }
  function exCampo(el, st) {
    st.raiz = st.raiz || 'C'; st.modo = st.modo || 'mayor'; st.sept = !!st.sept;
    el.innerHTML =
      '<div class="controls">' + ctl('Tono', '<span id="pkXRaizW"></span>') +
      ctl('Modo', segHtml('pkXModo', [['mayor', 'Mayor'], ['menor', 'Menor']], st.modo)) +
      ctl('Acordes', segHtml('pkXSept', [['0', 'Tríadas'], ['1', 'Con séptima']], st.sept ? '1' : '0')) + '</div>' +
      '<table class="rep pk-campo"><thead><tr><th>Grado</th><th>Acorde</th><th>Función</th></tr></thead><tbody id="pkXFilas"></tbody></table>' +
      '<p class="ed-note">Toca una fila para verla en el teclado y escucharla.</p>' +
      '<div class="pk-manos"><div><div class="ctl-label">Mano izquierda</div><div class="pk-kbw pk-izq" id="pkXKbI"></div></div>' +
      '<div class="pk-der"><div class="ctl-label">Mano derecha</div><div class="pk-kbw" id="pkXKbD"></div></div></div>';
    function raizSel() {
      var menor = st.modo === 'menor';
      st.raiz = (menor ? RAIZ_MENOR : RAIZ_MAYOR)[pcDe(st.raiz)];
      q('#pkXRaizW').innerHTML = selRaiz('pkXRaiz', st.raiz, menor);
      on('pkXRaiz', 'change', function () { st.raiz = this.value; pintar(); });
    }
    function pintar(sel) {
      var filas = '';
      for (var g = 0; g < 7; g++) {
        var a = grado(st.raiz, st.modo, g, st.sept);
        filas += '<tr class="song' + (sel === g ? ' pk-sel-row' : '') + '" data-g="' + g + '"><td class="t-key">' + a.rom + '</td><td class="t-title">' + esc(ver(cifra(a.raiz, a.tipo))) + '</td><td>' + esc(FUNCION[a.fun]) + '</td></tr>';
      }
      q('#pkXFilas').innerHTML = filas;
      S.view.querySelectorAll('#pkXFilas tr').forEach(function (tr) { tr.addEventListener('click', function () { mostrar(+tr.dataset.g); }); });
    }
    function mostrar(g) {
      pintar(g);
      var a = grado(st.raiz, st.modo, g, st.sept), v = voz(a.raiz, a.tipo, null), b = 36 + mod12(pcDe(a.raiz)), mkD = {}, mkI = {};
      var ns = notasAcorde(a.raiz, a.tipo), pcs = pcsAcorde(a.raiz, a.tipo);
      v.forEach(function (m) { mkD[m] = { c: 'on', t: ver(ns[pcs.indexOf(mod12(m))]) }; });
      mkI[b] = { c: 'on', t: ver(a.raiz) };
      teclado(q('#pkXKbI'), 36, 48, mkI); teclado(q('#pkXKbD'), 48, 84, mkD);
      var c = ac(); if (c) { var t = c.currentTime + 0.03; tocar(b, t, 1.6, 0.7); tocarVarias(v, t, 1.6); }
    }
    segWire('pkXModo', function (v) { st.modo = v; raizSel(); pintar(); });
    segWire('pkXSept', function (v) { st.sept = v === '1'; pintar(); });
    raizSel(); pintar();
    teclado(q('#pkXKbI'), 36, 48, {}); teclado(q('#pkXKbD'), 48, 84, {});
  }
  // progresiones y ritmos comparten el explorador: acordes + ritmo + tempo
  function exProgresiones(el, st, opt) {
    opt = opt || {};
    st.p = st.p || opt.p || 'pop'; st.raiz = st.raiz || 'C'; st.bpm = st.bpm || 80; st.r = st.r || opt.r || 'negras';
    el.innerHTML =
      '<div class="controls">' + ctl('Progresión', selHtml('pkXProg', PROGS.map(function (p) { return [p.id, p.nom]; }), st.p, 'Progresión')) +
      ctl('Tono', '<span id="pkXRaizW"></span>') +
      ctl('Ritmo', selHtml('pkXRit', RITMOS.map(function (r) { return [r.id, r.nom]; }), st.r, 'Ritmo')) +
      stepper('pkXBpm', 'Tempo') + '<button class="pr-play pk-go" id="pkXPlay">TOCAR</button></div>' +
      '<p class="pk-sub" id="pkXTxt"></p><div class="pk-prog" id="pkXCifras"></div>' +
      (opt.rejilla ? '<div id="pkXRej"></div>' : '') +
      '<div class="pk-manos"><div><div class="ctl-label">Mano izquierda</div><div class="pk-kbw pk-izq" id="pkXKbI"></div></div>' +
      '<div class="pk-der"><div class="ctl-label">Mano derecha</div><div class="pk-kbw" id="pkXKbD"></div></div></div>';
    function raizSel() {
      var menor = prog(st.p).modo === 'menor';
      st.raiz = (menor ? RAIZ_MENOR : RAIZ_MAYOR)[pcDe(st.raiz)];
      q('#pkXRaizW').innerHTML = selRaiz('pkXRaiz', st.raiz, menor);
      on('pkXRaiz', 'change', function () { st.raiz = this.value; reiniciar(); });
    }
    function acordes() { return acordesProg(prog(st.p), st.raiz); }
    function pintar(k, voces, paso) {
      var as = acordes(), p = prog(st.p), r = ritmo(st.r);
      q('#pkXTxt').textContent = p.txt + ' Ritmo: ' + r.txt;
      q('#pkXCifras').innerHTML = as.map(function (a, i) {
        return '<div class="pk-cif' + (i === k ? ' on' : '') + '"><span class="pk-rom">' + esc(a.rom) + '</span><span class="pk-ac">' + esc(ver(cifra(a.raiz, a.tipo))) + '</span></div>';
      }).join('');
      if (opt.rejilla) q('#pkXRej').innerHTML = rejilla(r, paso);
      var mkD = {}, mkI = {};
      if (k != null && voces) {
        var a = as[k], ns = notasAcorde(a.raiz, a.tipo), pcs = pcsAcorde(a.raiz, a.tipo);
        voces[k].forEach(function (m) { mkD[m] = { c: 'on', t: ver(ns[pcs.indexOf(mod12(m))]) }; });
        mkI[bajo(a.raiz)] = { c: 'on', t: ver(a.raiz) };
      }
      teclado(q('#pkXKbI'), 36, 52, mkI); teclado(q('#pkXKbD'), 48, 84, mkD);
      q('#pkXBpm').textContent = st.bpm;
    }
    function tocarProg() {
      acompanar(acordes(), ritmo(st.r), st.bpm, { loop: true, clic: !!opt.rejilla, paso: function (k, s, voces) { pintar(k, voces, s); } });
      q('#pkXPlay').textContent = 'DETENER'; q('#pkXPlay').classList.add('playing');
    }
    function detener() { parar(); q('#pkXPlay').textContent = 'TOCAR'; q('#pkXPlay').classList.remove('playing'); pintar(); }
    function reiniciar() { if (sonando()) tocarProg(); else pintar(); }
    on('pkXPlay', 'click', function () { if (sonando()) detener(); else tocarProg(); });
    on('pkXProg', 'change', function () { st.p = this.value; raizSel(); reiniciar(); });
    on('pkXRit', 'change', function () { st.r = this.value; reiniciar(); });
    on('pkXBpmM', 'click', function () { st.bpm = Math.max(40, st.bpm - 5); reiniciar(); });
    on('pkXBpmP', 'click', function () { st.bpm = Math.min(180, st.bpm + 5); reiniciar(); });
    raizSel(); pintar();
  }
  function rejilla(r, paso, resultado) {
    var cuenta = cuentaRitmo(r), filas = [['Mano der.', r.md], ['Mano izq.', r.mi]];
    var h = '<div class="pk-rej" style="grid-template-columns:72px repeat(' + r.md.length + ',1fr)">';
    h += '<span></span>' + cuenta.map(function (c, i) { return '<span class="pk-cu' + (i === paso ? ' on' : '') + '">' + c + '</span>'; }).join('');
    filas.forEach(function (f) {
      h += '<span class="ctl-label">' + f[0] + '</span>';
      for (var i = 0; i < f[1].length; i++) {
        var ch = f[1][i], txt = ch === '.' ? '' : ch === 'A' ? '●' : ch;
        h += '<span class="pk-cel' + (ch !== '.' ? ' lleno' : '') + (i === paso ? ' on' : '') + '">' + txt + '</span>';
      }
    });
    if (resultado) {
      h += '<span class="ctl-label">Tú</span>';
      for (var j = 0; j < r.md.length; j++) h += '<span class="pk-cel">' + (resultado[j] || '') + '</span>';
    }
    return h + '</div>';
  }
  function exTransponer(el, st) {
    st.txt = st.txt != null ? st.txt : 'G Em C D'; st.k = st.k || 0; st.menor = !!st.menor;
    el.innerHTML =
      '<div class="controls"><input class="search pk-in" id="pkXTxtIn" value="' + esc(st.txt) + '" aria-label="Acordes"></div>' +
      '<div class="controls">' + ctl('Tono original', '<span id="pkXOrigW"></span>') + stepper('pkXK', 'Mover') +
      ctl('Tono nuevo', '<span id="pkXDestW"></span>') + '<button class="mini-app-btn" id="pkXOir">Escuchar</button></div>' +
      '<table class="rep pk-campo"><thead><tr><th>Original</th><th>Grado</th><th>Transpuesto</th></tr></thead><tbody id="pkXFilas"></tbody></table>';
    function tonica() {
      var cs = leerCifras(st.txt).filter(function (c) { return !c.mal; });
      if (st.orig == null) { st.orig = cs.length ? cs[0].pc : 0; st.menor = cs.length ? /^m(?!aj)/.test(cs[0].suf) : false; }
      return st.orig;
    }
    function pintar() {
      var t = tonica(), cs = leerCifras(st.txt), dest = mod12(t + st.k), bemO = usaBemoles(t, st.menor), bemD = usaBemoles(dest, st.menor);
      var nomT = function (pc) { return ver(notaPc(pc, usaBemoles(pc, st.menor))) + (st.menor ? 'm' : ''); };
      var ops = SOST.map(function (_, pc) { return [pc, nomT(pc)]; });
      q('#pkXOrigW').innerHTML = selHtml('pkXOrig', ops, t, 'Tono original');
      q('#pkXDestW').innerHTML = selHtml('pkXDest', ops, dest, 'Tono nuevo');
      q('#pkXK').textContent = (st.k > 0 ? '+' : '') + st.k + ' st';
      q('#pkXFilas').innerHTML = cs.map(function (c) {
        return '<tr><td class="t-title">' + esc(ver(escribirCifra(c, 0, bemO))) + '</td><td class="t-key">' + esc(romanoDe(c, t, st.menor)) + '</td><td class="t-title">' + esc(ver(escribirCifra(c, st.k, bemD))) + '</td></tr>';
      }).join('');
      on('pkXOrig', 'change', function () { st.orig = +this.value; pintar(); });
      on('pkXDest', 'change', function () { st.k = mod12(+this.value - tonica()); if (st.k > 6) st.k -= 12; pintar(); });
    }
    on('pkXTxtIn', 'input', function () { st.txt = this.value; st.orig = null; pintar(); });
    on('pkXKM', 'click', function () { st.k = Math.max(-11, st.k - 1); pintar(); });
    on('pkXKP', 'click', function () { st.k = Math.min(11, st.k + 1); pintar(); });
    on('pkXOir', 'click', function () {
      var cs = leerCifras(st.txt).filter(function (c) { return !c.mal; }), bem = usaBemoles(mod12(tonica() + st.k), st.menor);
      var as = cs.map(function (c) { return { raiz: notaPc(c.pc + st.k, bem), tipo: tipoDeSufijo(c.suf) }; });
      if (as.length) acompanar(as, ritmo('negras'), 90, {});
    });
    pintar();
  }
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
    var R = menor ? ['I', '♭II', 'II', 'III', '♯III', 'IV', '♯IV', 'V', 'VI', '♯VI', 'VII', '♯VII'] : ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
    var r = R[d], esMenor = /^m(?!aj)/.test(c.suf) || /^dim|º/.test(c.suf);
    if (esMenor) r = r.replace(/[IV]+/, function (x) { return x.toLowerCase(); });
    return r + c.suf.replace(/^m(?!aj)/, '').replace(/^dim/, 'º');
  }

  /* ================= ejercicios =================
     Cada uno es una fábrica: ej(opts) devuelve function(cuerpo, ctl, lec).
     ctl.ok() / ctl.mal() anotan el intento; el marco cuenta la meta. Un
     fallo cuenta una sola vez por consigna, y una consigna con fallo no
     suma acierto aunque después salga bien. */
  function consignaHtml(extra) {
    return (extra || '') + '<div class="pk-stage"><div class="pk-sub" id="pkSub"></div><div class="pk-big" id="pkBig"></div><div class="pk-sub" id="pkSub2"></div></div>';
  }

  // Toca la nota pedida. opts: {negras, octavas}
  function ejNota(opts) {
    return function (el, ctl, lec) {
      var st = S.st;
      el.innerHTML = consignaHtml() + '<div class="pk-kbw" id="pkKb"></div><p class="pk-fb" id="pkFb"></p>';
      function nuevo() {
        ctl.nueva(); feedback('');
        var bolsa = opts.negras ? SOST.concat(BEM.filter(function (n) { return n.length === 2; })) : LETRAS;
        do { st.nota = azar(bolsa); } while (st.nota === st.prev);
        st.prev = st.nota; st.listo = false;
        st.oct = opts.octavas ? azar([3, 4, 5]) : null;
        consigna('Toca en el teclado', ver(st.nota) + (st.oct != null ? st.oct : ''), st.oct != null ? 'en esa octava (el número chico bajo cada Do dice cuál es)' : 'en cualquier octava');
        teclado(q('#pkKb'), 48, 84, {}, responder);
        S.onKey = responder;
      }
      function responder(m) {
        if (st.listo) return;
        var ok = mod12(m) === pcDe(st.nota) && (st.oct == null || Math.floor(m / 12) - 1 === st.oct), mk = {};
        if (ok) {
          st.listo = true; mk[m] = { c: 'ok', t: ver(st.nota) }; ctl.ok();
          feedback('¡Bien!', 'ok'); luego(lec, 900, nuevo);
        } else {
          mk[m] = { c: 'bad' }; ctl.mal();
          feedback(mod12(m) === pcDe(st.nota) ? 'Es esa nota, pero en otra octava.' : 'Esa es ' + nombreMidi(m) + '. ' +
            (st.nota.length === 2 ? 'Las teclas negras toman el nombre de la blanca vecina: # es la de la derecha, b la de la izquierda.' : 'Ubica el grupo de dos teclas negras: la blanca a su izquierda es Do.'), 'bad');
        }
        teclado(q('#pkKb'), 48, 84, mk, responder);
      }
      nuevo();
    };
  }

  // Toca (o reconoce de oído) un intervalo. opts: {semis:[...], oido}
  function ejIntervalo(opts) {
    return function (el, ctl, lec) {
      var st = S.st;
      el.innerHTML = consignaHtml() + '<div class="pk-grid" id="pkOps"></div><div class="pk-kbw" id="pkKb"></div><p class="pk-fb" id="pkFb"></p>';
      function nuevo() {
        ctl.nueva(); feedback('');
        st.raiz = azar(opts.raices || ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'Bb', 'Eb']);
        do { st.iv = intervalo(azar(opts.semis)); } while (opts.semis.length > 1 && st.iv === st.prev);
        st.prev = st.iv; st.m1 = 48 + pcDe(st.raiz); st.listo = false;
        var ops = q('#pkOps');
        if (!opts.oido) {
          consigna('Toca en el teclado', st.iv.nom + ' sobre ' + ver(st.raiz), 'hacia arriba (la nota de abajo ya está marcada)');
          ops.innerHTML = '';
          var mk = {}; mk[st.m1] = { c: 'on', t: ver(st.raiz) };
          teclado(q('#pkKb'), 48, 72, mk, responderTecla);
          S.onKey = responderTecla;
        } else {
          consigna('Escucha y elige', '¿Qué intervalo es?', '');
          var cand = INTERVALOS.filter(function (x) { return opts.semis.indexOf(x.s) >= 0; });
          ops.innerHTML = '<button class="pk-opt" id="pkRep">▶ Repetir</button>' + cand.map(function (x) { return '<button class="pk-opt" data-s="' + x.s + '">' + esc(x.nom) + '</button>'; }).join('');
          on('pkRep', 'click', sonar);
          ops.querySelectorAll('button[data-s]').forEach(function (b) { b.addEventListener('click', function () { responderOido(+b.dataset.s, b); }); });
          q('#pkKb').innerHTML = ''; S.onKey = null;
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
        var mk = {}; mk[st.m1] = { c: 'on', t: ver(st.raiz) };
        var objetivo = st.m1 + st.iv.s, nombre = deletrear(st.raiz, st.iv.s, st.iv.g);
        if (mod12(m - st.m1) === mod12(st.iv.s) && m !== st.m1) {
          st.listo = true; mk[objetivo] = { c: 'ok', t: ver(nombre) }; ctl.ok();
          feedback('¡Bien! ' + ver(st.raiz) + ' → ' + ver(nombre) + ' (' + st.iv.s + ' semitonos).', 'ok');
          tocar(st.m1, null, 1.2); luego(lec, 1300, nuevo);
        } else {
          mk[m] = { c: 'bad' }; ctl.mal();
          var d = mod12(m - st.m1);
          feedback('Esa está a ' + d + ' semitono' + (d === 1 ? '' : 's') + '. La ' + st.iv.nom + ' son ' + st.iv.s + '.' + (ctl.fallos() >= 2 ? ' Es ' + ver(nombre) + '.' : ''), 'bad');
          if (ctl.fallos() >= 2) mk[objetivo] = { c: 'tenue', t: ver(nombre) };
        }
        teclado(q('#pkKb'), 48, 72, mk, responderTecla);
      }
      function responderOido(s, b) {
        if (st.listo) return;
        if (s === st.iv.s) {
          st.listo = true; b.classList.add('ok'); ctl.ok();
          feedback('¡Bien! Era una ' + st.iv.nom + ' (' + ver(st.raiz) + ' → ' + ver(deletrear(st.raiz, st.iv.s, st.iv.g)) + ').', 'ok');
          luego(lec, 1400, nuevo);
        } else {
          b.classList.add('bad'); b.disabled = true; ctl.mal();
          feedback('No. Escúchalo de nuevo: ¿más abierto o más cerrado?', 'bad'); sonar();
        }
      }
      nuevo();
    };
  }

  // Arma el acorde pedido. opts: {tipos, manos (bajo + acorde), inversion, grado:{modo, grados, sept} (pide "el IV de Sol")}
  function ejAcorde(opts) {
    return function (el, ctl, lec) {
      var st = S.st;
      el.innerHTML = consignaHtml() +
        (opts.manos
          ? '<div class="pk-manos"><div><div class="ctl-label">Mano izquierda: el bajo</div><div class="pk-kbw pk-izq" id="pkKbI"></div></div><div class="pk-der"><div class="ctl-label">Mano derecha: el acorde</div><div class="pk-kbw" id="pkKb"></div></div></div>'
          : '<div class="pk-kbw" id="pkKb"></div>') +
        '<div class="pk-acc"><button class="mini-app-btn" id="pkOirSel">Escuchar lo mío</button><button class="mini-app-btn" id="pkBorrar">Borrar</button><button class="pr-play pk-go" id="pkComp">COMPROBAR</button></div><p class="pk-fb" id="pkFb"></p>';
      on('pkBorrar', 'click', function () { st.sel = []; st.selI = []; pintar(); feedback(''); });
      on('pkOirSel', 'click', function () { tocarVarias(st.sel.concat(st.selI), null, 1.5); });
      on('pkComp', 'click', comprobar);
      function nuevo() {
        ctl.nueva(); feedback('');
        if (opts.grado) {
          var modo = opts.grado.modo === 'ambos' ? azar(['mayor', 'menor']) : opts.grado.modo, menor = modo === 'menor';
          st.tono = raizAzar(menor); st.modo = modo;
          var g = azar(opts.grado.grados || [0, 1, 2, 3, 4, 5]), a = grado(st.tono, modo, g, !!opts.grado.sept);
          st.raiz = a.raiz; st.tipo = a.tipo; st.rom = a.rom;
        } else {
          if (S.ciclo) {
            // 12 tonos: cada raíz del círculo con todos los tipos pedidos, en orden
            var nt = opts.tipos.length, kt = S.ciclo.t || 0;
            st.tipo = opts.tipos[kt % nt];
            st.raiz = (tipo(st.tipo).menor ? RAIZ_MENOR : RAIZ_MAYOR)[CICLO[S.ciclo.i % 12]];
            S.ciclo.t = kt + 1; if (S.ciclo.t % nt === 0) S.ciclo.i++;
          } else {
            do { st.tipo = azar(opts.tipos); } while (opts.tipos.length > 1 && st.tipo === st.prevT);
            st.prevT = st.tipo;
            st.raiz = raizAzar(!!tipo(st.tipo).menor);
          }
        }
        st.inv = opts.inversion ? azar([1, 2]) : 0;
        st.sel = []; st.selI = []; st.listo = false;
        var nombre = ver(cifra(st.raiz, st.tipo));
        if (opts.grado) consigna('En ' + ver(st.tono) + (st.modo === 'menor' ? ' menor' : ' mayor') + ', arma el', st.rom, 'Toca las notas del acorde y comprueba' + (opts.manos ? ' (el bajo en la mano izquierda)' : ''));
        else if (st.inv) consigna('Arma el acorde en', nombre + ' · ' + (st.inv === 1 ? '1ª' : '2ª') + ' inversión', 'la nota más grave debe ser la ' + (st.inv === 1 ? '3ª' : '5ª') + ' (' + ver(notasAcorde(st.raiz, st.tipo)[st.inv]) + ')');
        else consigna('Toca las notas (en cualquier orden) y comprueba' + (opts.manos ? '; el bajo en la izquierda' : ''), nombre, tipo(st.tipo).nom);
        pintar();
        S.onKey = function (m, origen) {
          if (origen === 'midi') {
            var h = Array.from(S.held);
            st.selI = opts.manos ? h.filter(function (x) { return x < 48; }) : [];
            st.sel = opts.manos ? h.filter(function (x) { return x >= 48; }) : h;
            pintar();
            if (new Set(st.sel.map(mod12)).size >= tipo(st.tipo).iv.length && (!opts.manos || st.selI.length)) comprobar();
          }
        };
      }
      function alternar(lista, m) {
        if (st.listo) return;
        var i = lista.indexOf(m);
        if (i >= 0) lista.splice(i, 1); else lista.push(m);
        pintar();
      }
      function pintar(extra, extraI) {
        var mk = {}, mkI = {};
        st.sel.forEach(function (m) { mk[m] = { c: 'sel' }; });
        st.selI.forEach(function (m) { mkI[m] = { c: 'sel' }; });
        if (extra) Object.assign(mk, extra);
        if (extraI) Object.assign(mkI, extraI);
        teclado(q('#pkKb'), 48, 79, mk, function (m) { alternar(st.sel, m); });
        if (opts.manos) teclado(q('#pkKbI'), 36, 47, mkI, function (m) { alternar(st.selI, m); });
      }
      function comprobar() {
        if (st.listo || !st.sel.length) return;
        var pcs = pcsAcorde(st.raiz, st.tipo), quiero = new Set(pcs), tengo = new Set(st.sel.map(mod12));
        var faltan = Array.from(quiero).filter(function (p) { return !tengo.has(p); });
        var sobran = st.sel.filter(function (m) { return !quiero.has(mod12(m)); });
        var notas = notasAcorde(st.raiz, st.tipo), txt = '';
        var grave = Math.min.apply(null, st.sel), pcGrave = mod12(grave);
        var invOk = !st.inv || pcGrave === pcs[st.inv];
        var bajoOk = !opts.manos || (st.selI.length && st.selI.every(function (m) { return mod12(m) === pcs[0]; }));
        if (!faltan.length && !sobran.length && invOk && bajoOk) {
          st.listo = true; ctl.ok();
          var mk = {}, mkI = {};
          st.sel.forEach(function (m) { mk[m] = { c: 'ok', t: ver(notas[pcs.indexOf(mod12(m))]) }; });
          st.selI.forEach(function (m) { mkI[m] = { c: 'ok', t: ver(st.raiz) }; });
          pintar(mk, mkI);
          feedback('¡Bien! ' + ver(cifra(st.raiz, st.tipo)) + ' = ' + notas.map(ver).join(' – '), 'ok');
          tocarVarias(st.sel.concat(st.selI), null, 1.6);
          luego(lec, 1700, nuevo);
        } else {
          ctl.mal();
          var mk2 = {}; sobran.forEach(function (m) { mk2[m] = { c: 'bad' }; });
          var mkI2 = {};
          if (opts.manos && st.selI.length && !bajoOk) st.selI.forEach(function (m) { mkI2[m] = { c: 'bad' }; });
          pintar(mk2, mkI2);
          if (sobran.length) txt += 'Las marcadas con × no van. ';
          if (faltan.length) txt += 'Falta' + (faltan.length > 1 ? 'n ' + faltan.length + ' notas. ' : ' una nota. ');
          if (!faltan.length && !sobran.length && !invOk) txt += 'Las notas están, pero la más grave tiene que ser ' + ver(notas[st.inv]) + '. ';
          if (!bajoOk) txt += (st.selI.length ? 'El bajo tiene que ser la fundamental (' + ver(st.raiz) + '). ' : 'Falta el bajo en la mano izquierda. ');
          if (ctl.fallos() >= 2) txt += 'Las notas son: ' + notas.map(ver).join(' – ') + '.';
          feedback(txt, 'bad');
        }
      }
      nuevo();
    };
  }

  // Toca la escala subiendo. opts: {escalas:[ids], raices?}
  function ejEscala(opts) {
    return function (el, ctl, lec) {
      var st = S.st;
      el.innerHTML = consignaHtml() + '<div class="pk-kbw" id="pkKb"></div><div class="pk-acc"><button class="mini-app-btn" id="pkPista">Pista</button></div><p class="pk-fb" id="pkFb"></p>';
      on('pkPista', 'click', function () {
        if (st.listo) return;
        ctl.mal();
        var ivs = st.e.iv.concat([12]);
        feedback('Sigue ' + ver(st.notas[st.i % st.notas.length]) + ' (' + (st.i ? (ivs[st.i] - ivs[st.i - 1] === 1 ? 'un semitono' : ivs[st.i] - ivs[st.i - 1] === 2 ? 'un tono' : 'tono y medio') + ' más arriba' : 'la tónica') + ').');
        pintar(mod12(pcDe(st.raiz) + ivs[st.i]));
      });
      function nuevo() {
        ctl.nueva(); feedback('');
        st.e = escala(azar(opts.escalas));
        st.raiz = raizAzar(!!st.e.menor, opts.raices);
        st.notas = notasEscala(st.raiz, st.e);
        st.i = 0; st.tocadas = []; st.listo = false; st.malo = null;
        consigna('Toca la escala subiendo, desde la tónica hasta la tónica de arriba', st.e.nom + ' de ' + ver(st.raiz), (st.notas.length + 1) + ' notas · ' + pasos(st.e));
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
            var limpia = ctl.fallos() === 0;
            ctl.ok();
            feedback(limpia ? '¡Perfecta!' : 'Completa, pero con errores o pista: no suma. Repítela hasta que salga limpia.', limpia ? 'ok' : '');
            luego(lec, 1700, nuevo);
          } else feedback('');
        } else {
          st.malo = m; ctl.mal();
          feedback(mod12(m) === pcQuiero ? 'Esa nota va, pero más arriba que la anterior.' : 'Esa no es. ¿Tono o semitono desde la anterior?', 'bad');
        }
        pintar();
      }
      nuevo();
    };
  }

  // Preguntas de alternativas sobre el campo armónico. opts: {modo:'mayor'|'menor'|'ambos', clases:['acorde','grado','funcion']}
  function ejCampoQuiz(opts) {
    return function (el, ctl, lec) {
      el.innerHTML = consignaHtml() + '<div class="pk-grid" id="pkOps"></div><p class="pk-fb" id="pkFb"></p>';
      function nuevo() {
        ctl.nueva(); feedback('');
        var modo = opts.modo === 'ambos' ? azar(['mayor', 'menor']) : opts.modo, menor = modo === 'menor';
        var raiz = azar(menor ? RAIZ_MENOR : RAIZ_MAYOR), tono = ver(raiz) + (menor ? ' menor' : ' mayor');
        var g = Math.floor(Math.random() * 7), a = grado(raiz, modo, g, false), clase = azar(opts.clases), listo = false;
        var ops, correcta;
        if (clase === 'acorde') {
          consigna('En ' + tono + ',', '¿cuál es el ' + a.rom + '?', '');
          correcta = ver(cifra(a.raiz, a.tipo)); ops = [correcta];
          mezclar([0, 1, 2, 3, 4, 5, 6].filter(function (x) { return x !== g; })).slice(0, 3).forEach(function (x) { var b = grado(raiz, modo, x, false); ops.push(ver(cifra(b.raiz, b.tipo))); });
        } else if (clase === 'grado') {
          consigna('En ' + tono + ',', '¿qué grado es ' + ver(cifra(a.raiz, a.tipo)) + '?', '');
          correcta = a.rom; ops = [correcta].concat(mezclar(CAMPO[modo].rom.filter(function (r) { return r !== a.rom; })).slice(0, 3));
        } else {
          consigna('En ' + tono + ', el ' + a.rom + ' (' + ver(cifra(a.raiz, a.tipo)) + ')', '¿qué función cumple?', '');
          correcta = FUNCION[a.fun]; ops = [FUNCION.T, FUNCION.SD, FUNCION.D];
        }
        var caja = q('#pkOps');
        caja.innerHTML = mezclar(ops).map(function (o) { return '<button class="pk-opt">' + esc(o) + '</button>'; }).join('');
        caja.querySelectorAll('button').forEach(function (b) {
          b.addEventListener('click', function () {
            if (listo) return;
            if (b.textContent === correcta) {
              listo = true; b.classList.add('ok'); ctl.ok();
              feedback('¡Bien! ' + a.rom + ' de ' + tono + ' = ' + ver(cifra(a.raiz, a.tipo)) + '. ' + FUNCION[a.fun] + '.', 'ok');
              var c = ac(); if (c) { tocar(36 + mod12(pcDe(a.raiz)), null, 1.4, 0.7); tocarVarias(voz(a.raiz, a.tipo, null), null, 1.4); }
              luego(lec, 1800, nuevo);
            } else {
              b.classList.add('bad'); b.disabled = true; ctl.mal();
              feedback('No. Cuenta los grados desde ' + ver(raiz) + ' por la escala' + (menor ? ' menor' : '') + '.', 'bad');
            }
          });
        });
      }
      nuevo();
    };
  }

  // Toca una progresión acorde por acorde. opts: {progs:[ids], raices?} o {cancion:true}
  function ejProgTocar(opts) {
    return function (el, ctl, lec) {
      var st = S.st;
      el.innerHTML = consignaHtml() + '<div class="pk-prog" id="pkCifras"></div><div class="pk-kbw" id="pkKb"></div>' +
        '<div class="pk-acc"><button class="mini-app-btn" id="pkOirProg">Escuchar la progresión</button><button class="mini-app-btn" id="pkBorrar">Borrar</button><button class="mini-app-btn" id="pkOtra">Otra</button></div><p class="pk-fb" id="pkFb"></p>';
      on('pkBorrar', 'click', function () { st.sel = []; pintar(); });
      on('pkOtra', 'click', nuevo);
      on('pkOirProg', 'click', function () { acompanar(st.as, ritmo('negras'), 96, {}); });
      function nuevo() {
        ctl.nueva(); feedback(''); parar();
        if (opts.cancion) {
          var c = cancionAlAzar();
          st.as = c.acordes; st.titulo = c.titulo;
        } else {
          var p = prog(azar(opts.progs)), raiz = raizAzar(p.modo === 'menor', opts.raices);
          st.as = acordesProg(p, raiz).map(function (a) { return { raiz: a.raiz, tipo: a.tipo, rom: a.rom, nombre: cifra(a.raiz, a.tipo), pcs: pcsAcorde(a.raiz, a.tipo) }; });
          st.titulo = p.nom + ' en ' + ver(raiz) + (p.modo === 'menor' ? ' menor' : '');
        }
        st.k = 0; st.sel = []; st.listo = false;
        consigna(opts.cancion ? 'Acordes de una canción de tu Cancionero: tócalos en orden' : 'Toca cada acorde en orden; al completar las notas, pasa solo al siguiente', st.titulo, 'Puedes usar cualquier inversión. Mientras tocas no suena nada más: tú eres el acompañamiento.');
        pintar();
        S.onKey = function (m, origen) {
          if (origen !== 'midi') return;
          st.sel = Array.from(S.held); pintar();
          if (new Set(st.sel.map(mod12)).size >= st.as[st.k].pcs.length) comprobar();
        };
      }
      function pintar(extra) {
        q('#pkCifras').innerHTML = st.as.map(function (a, i) {
          return '<div class="pk-cif' + (i === st.k ? ' on' : i < st.k ? ' hecho' : '') + '">' + (a.rom ? '<span class="pk-rom">' + esc(a.rom) + '</span>' : '') + '<span class="pk-ac">' + esc(ver(a.nombre)) + '</span></div>';
        }).join('');
        var mk = {};
        st.sel.forEach(function (m) { mk[m] = { c: 'sel' }; });
        if (extra) Object.assign(mk, extra);
        teclado(q('#pkKb'), 48, 79, mk, function (m) {
          if (st.listo) return;
          var i = st.sel.indexOf(m);
          if (i >= 0) st.sel.splice(i, 1); else st.sel.push(m);
          pintar();
          if (new Set(st.sel.map(mod12)).size >= st.as[st.k].pcs.length) comprobar();
        });
      }
      function comprobar() {
        var a = st.as[st.k], quiero = new Set(a.pcs), tengo = new Set(st.sel.map(mod12));
        var sobran = st.sel.filter(function (m) { return !quiero.has(mod12(m)); });
        var faltan = a.pcs.filter(function (p) { return !tengo.has(p); });
        if (!sobran.length && !faltan.length) {
          var mk = {}; st.sel.forEach(function (m) { mk[m] = { c: 'ok' }; });
          pintar(mk);
          tocarVarias(st.sel, null, 1.2);
          st.k++;
          if (st.k >= st.as.length) {
            st.listo = true;
            var limpia = ctl.fallos() === 0;
            ctl.ok();
            feedback(limpia ? '¡Completa y limpia!' : 'Completa, con errores: no suma. Otra vez, más tranquilo.', limpia ? 'ok' : '');
            luego(lec, 1800, nuevo);
          } else { feedback(''); luego(lec, 450, function () { st.sel = []; pintar(); }); }
        } else {
          ctl.mal();
          var mk2 = {}; sobran.forEach(function (m) { mk2[m] = { c: 'bad' }; });
          pintar(mk2);
          feedback('Ese no es ' + ver(a.nombre) + (ctl.fallos() >= 2 ? ': ' + a.pcs.map(function (p) { return ver(notaPc(p, usaBemoles(pcDe(a.raiz), false))); }).join(' – ') : '') + '.', 'bad');
          luego(lec, 900, function () { st.sel = []; pintar(); });
        }
      }
      nuevo();
    };
  }
  // una canción del Cancionero con acordes (si no hay, una progresión)
  function cancionAlAzar() {
    var lib = [], M = SB.music;
    try {
      SB.store.library().forEach(function (m) {
        var s = SB.store.get(m.id); if (!s || !s.parts) return;
        var seq = [];
        s.parts.forEach(function (p) {
          (p.lines || []).forEach(function (ln) { (ln.a || []).forEach(function (a) { if (M.parseChord(a[1])) seq.push(a[1]); }); });
          (p.grid || []).forEach(function (fila) { fila.forEach(function (c) { if (c !== '%' && M.parseChord(c)) seq.push(c); }); });
        });
        var out = [];
        seq.forEach(function (c) { if (c !== out[out.length - 1]) out.push(c); });
        if (out.length >= 3) lib.push({ titulo: s.title, acordes: out.slice(0, 8) });
      });
    } catch (e) {}
    if (!lib.length) {
      var p = prog('pop'), as = acordesProg(p, 'G');
      return { titulo: p.nom + ' en ' + ver('G') + ' (agrega canciones con acordes al Cancionero para practicar con ellas)', acordes: as.map(function (a) { return { raiz: a.raiz, tipo: a.tipo, rom: a.rom, nombre: cifra(a.raiz, a.tipo), pcs: pcsAcorde(a.raiz, a.tipo) }; }) };
    }
    var c = azar(lib);
    return { titulo: c.titulo, acordes: c.acordes.map(function (n) {
      var pc = M.parseChord(n);
      return { raiz: pc.root, tipo: tipoDeSufijo(pc.suf), nombre: n, pcs: M.pitchClasses(n) };
    }) };
  }

  // Reconoce una progresión de oído. opts: {progs}
  function ejProgOido(opts) {
    return function (el, ctl, lec) {
      var st = S.st;
      el.innerHTML = consignaHtml() + '<div class="pk-grid" id="pkOps"></div><p class="pk-fb" id="pkFb"></p>';
      function sonar() { acompanar(acordesProg(st.p, st.raiz), ritmo('negras'), 92, {}); }
      function nuevo() {
        ctl.nueva(); feedback(''); parar();
        var lista = opts.progs.map(prog);
        do { st.p = azar(lista); } while (lista.length > 1 && st.p === st.prev);
        st.prev = st.p;
        st.raiz = azar(st.p.modo === 'menor' ? RAIZ_MENOR : RAIZ_MAYOR);
        var listo = false;
        consigna('Escucha (empieza en el I del tono) y elige', '¿Qué progresión es?', 'Fíjate si el primer acorde es mayor o menor, y si el último deja tensión.');
        var ops = mezclar(lista);
        var caja = q('#pkOps');
        caja.innerHTML = '<button class="pk-opt" id="pkRep">▶ Repetir</button>' + ops.map(function (p) { return '<button class="pk-opt" data-p="' + p.id + '">' + esc(p.nom) + '</button>'; }).join('');
        on('pkRep', 'click', sonar);
        caja.querySelectorAll('button[data-p]').forEach(function (b) {
          b.addEventListener('click', function () {
            if (listo) return;
            if (b.dataset.p === st.p.id) {
              listo = true; b.classList.add('ok'); ctl.ok(); parar();
              feedback('¡Bien! ' + st.p.nom + ' en ' + ver(st.raiz) + ': ' + acordesProg(st.p, st.raiz).map(function (a) { return ver(cifra(a.raiz, a.tipo)); }).join(' – '), 'ok');
              luego(lec, 1800, nuevo);
            } else { b.classList.add('bad'); b.disabled = true; ctl.mal(); feedback('No. Escúchala otra vez.', 'bad'); sonar(); }
          });
        });
        sonar();
      }
      nuevo();
    };
  }

  // ¿Cuántos semitonos hay entre dos notas? (alternativas)
  function ejSemitonos() {
    return function (el, ctl, lec) {
      el.innerHTML = consignaHtml() + '<div class="pk-grid" id="pkOps"></div><div class="pk-kbw" id="pkKb"></div><p class="pk-fb" id="pkFb"></p>';
      function nuevo() {
        ctl.nueva(); feedback('');
        var a = azar(RAIZ_MAYOR), d = 1 + Math.floor(Math.random() * 7), sube = Math.random() < 0.6;
        var b = RAIZ_MAYOR[mod12(pcDe(a) + (sube ? d : -d))], listo = false;
        consigna('Para pasar de ' + ver(a) + ' a ' + ver(b) + (sube ? ' subiendo' : ' bajando') + ',', '¿cuántos semitonos?', 'Cuenta las teclas, blancas y negras, sin contar la de partida.');
        var m1 = 60 + pcDe(a), mk = {}; mk[m1] = { c: 'on', t: ver(a) }; mk[m1 + (sube ? d : -d)] = { c: 'tenue', t: ver(b) };
        teclado(q('#pkKb'), 48, 79, mk, function () {});
        var ops = mezclar([d].concat(mezclar([1, 2, 3, 4, 5, 6, 7, 8].filter(function (x) { return x !== d; })).slice(0, 3)));
        var caja = q('#pkOps');
        caja.innerHTML = ops.map(function (o) { return '<button class="pk-opt" data-d="' + o + '">' + o + '</button>'; }).join('');
        caja.querySelectorAll('button').forEach(function (bt) {
          bt.addEventListener('click', function () {
            if (listo) return;
            if (+bt.dataset.d === d) {
              listo = true; bt.classList.add('ok'); ctl.ok();
              feedback('¡Bien! ' + d + ' semitono' + (d > 1 ? 's' : '') + (d % 2 === 0 ? ' = ' + d / 2 + ' tono' + (d > 2 ? 's' : '') : d > 1 ? ' = ' + Math.floor(d / 2) + ' tono' + (d > 3 ? 's' : '') + ' y medio' : '') + '.', 'ok');
              var c = ac(); if (c) { tocar(m1, c.currentTime, 0.8); tocar(m1 + (sube ? d : -d), c.currentTime + 0.5, 1); }
              luego(lec, 1500, nuevo);
            } else { bt.classList.add('bad'); bt.disabled = true; ctl.mal(); feedback('No. Cuenta de a una tecla en el teclado de abajo.', 'bad'); }
          });
        });
      }
      nuevo();
    };
  }

  // Transponer una progresión eligiendo cada acorde. opts: {sept}
  function ejTransponer(opts) {
    return function (el, ctl, lec) {
      var st = S.st;
      el.innerHTML = consignaHtml() + '<div class="pk-trans" id="pkTr"></div><div class="pk-acc"><button class="pr-play pk-go" id="pkComp">COMPROBAR</button></div><p class="pk-fb" id="pkFb"></p>';
      on('pkComp', 'click', comprobar);
      function nuevo() {
        ctl.nueva(); feedback('');
        var p = azar(PROGS.filter(function (x) { return !x.blues && (!!x.sept === !!opts.sept); })), menor = p.modo === 'menor';
        var desde = azar(['C', 'G', 'D', 'A', 'E', 'F'].map(function (n) { return menor ? RAIZ_MENOR[pcDe(n)] : n; }));
        var k = azar([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]);
        var hasta = (menor ? RAIZ_MENOR : RAIZ_MAYOR)[mod12(pcDe(desde) + k)];
        st.orig = acordesProg(p, desde); st.dest = acordesProg(p, hasta); st.listo = false;
        consigna('Lleva estos acordes de ' + ver(desde) + (menor ? ' menor' : '') + ' a ' + ver(hasta) + (menor ? ' menor' : ''),
          st.orig.map(function (a) { return ver(cifra(a.raiz, a.tipo)); }).join('  '), 'Elige la nota de cada acorde; el tipo (m, 7…) no cambia. Pista: ' + (k > 0 ? 'sube ' : 'baja ') + Math.abs(k) + ' semitono' + (Math.abs(k) > 1 ? 's' : '') + '.');
        var ops = (menor ? RAIZ_MENOR : RAIZ_MAYOR).map(function (n) { return [n, ver(n)]; });
        q('#pkTr').innerHTML = st.orig.map(function (a, i) {
          return '<div class="pk-cif"><span class="pk-rom">' + esc(ver(cifra(a.raiz, a.tipo))) + ' →</span><span class="pk-ac">' + selHtml('pkT' + i, [['', '¿?']].concat(ops), '', 'Acorde ' + (i + 1)) + '<b>' + esc(sufijo(a.tipo)) + '</b></span></div>';
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
          st.listo = true; ctl.ok();
          feedback('¡Bien! ' + st.dest.map(function (a) { return ver(cifra(a.raiz, a.tipo)); }).join(' – '), 'ok');
          acompanar(st.dest, ritmo('negras'), 96, {});
          luego(lec, 3000, nuevo);
        } else {
          ctl.mal();
          feedback(bien + ' de ' + st.dest.length + ' bien. Mueve cada acorde la misma cantidad de semitonos.' + (ctl.fallos() >= 2 ? ' Respuesta: ' + st.dest.map(function (a) { return ver(cifra(a.raiz, a.tipo)); }).join(' – ') : ''), 'bad');
        }
      }
      nuevo();
    };
  }

  // Toca el ritmo con el botón / barra espaciadora / MIDI. opts: {ritmos, bpm}
  var PROG_RITMO = { id: 'pop', raiz: 'C' };
  function ejRitmo(opts) {
    return function (el, ctl, lec) {
      var st = S.st; st.r = opts.ritmos[0]; st.bpm = opts.bpm || 70;
      el.innerHTML = '<div class="controls">' + ctlHtml('Ritmo', selHtml('pkRit', opts.ritmos.map(function (id) { return [id, ritmo(id).nom]; }), st.r, 'Ritmo')) + stepper('pkBpm', 'Tempo') + '</div>' +
        consignaHtml() + '<div id="pkRej"></div>' +
        '<div class="pk-acc"><button class="pr-play pk-go" id="pkPlay">EMPEZAR</button><button class="pk-tap" id="pkTap" disabled>TOCA AQUÍ</button></div><p class="pk-fb" id="pkFb"></p>';
      var TOL = 0.12, COMPASES = 4;
      function pintar(paso, res) {
        var r = ritmo(st.r);
        consigna('Toca la mano derecha (● y números) sobre el bajo, durante ' + COMPASES + ' compases', r.nom, 'Con el botón, la barra espaciadora o cualquier tecla del teclado MIDI. Primero suena un compás de cuenta. Suma con 80 % o más.');
        q('#pkRej').innerHTML = rejilla(r, paso, res);
        q('#pkBpm').textContent = st.bpm;
      }
      function empezar() {
        var r = ritmo(st.r), c = ac(); if (!c) return;
        ctl.nueva(); feedback('');
        var n = r.md.length, dur = r.comp === '6/8' ? 60 / st.bpm / 3 : 60 / st.bpm / 2;
        st.esperados = []; st.res = {}; st.extras = 0;
        var acs = acordesProg(prog(PROG_RITMO.id), PROG_RITMO.raiz);
        q('#pkTap').disabled = false; q('#pkPlay').disabled = true;
        S.onKey = function () { golpe(); };
        reproducir({
          dur: dur, total: n * (COMPASES + 1),
          sched: function (i, t) {
            var s = i % n, compas = Math.floor(i / n);
            if (s % (r.comp === '6/8' ? 3 : 2) === 0) clic(t, s === 0);
            if (compas === 0) return;
            var a = acs[(compas - 1) % acs.length], b = bajo(a.raiz);
            if (r.mi[s] === 'B') tocar(b, t, dur * 3.5, 0.75);
            else if (r.mi[s] === '5') tocar(b + 7, t, dur * 3, 0.6);
            else if (r.mi[s] === '8') tocar(b + 12, t, dur * 3, 0.6);
            if (r.md[s] !== '.') st.esperados.push({ t: t, s: s, usado: false });
          },
          paso: function (i) { pintar(i % n, st.res); },
          fin: function () { setTimeout(evaluar, TOL * 1000 + 50); }
        });
      }
      function golpe() {
        var c = ac(); if (!c || q('#pkTap').disabled) return;
        var t = c.currentTime;
        tocarVarias([60, 64, 67], t, 0.25, 0.35);
        var mejor = null;
        st.esperados.forEach(function (e) { if (!e.usado && Math.abs(e.t - t) <= TOL && (!mejor || Math.abs(e.t - t) < Math.abs(mejor.t - t))) mejor = e; });
        if (mejor) { mejor.usado = true; mejor.desv = t - mejor.t; st.res[mejor.s] = Math.abs(mejor.desv) < 0.05 ? '✓' : mejor.desv < 0 ? '←' : '→'; }
        else st.extras++;
      }
      function evaluar() {
        q('#pkTap').disabled = true; q('#pkPlay').disabled = false; S.onKey = null;
        var tot = st.esperados.length, bien = st.esperados.filter(function (e) { return e.usado; }).length, extras = st.extras;
        var pct = tot ? Math.round(100 * Math.max(0, bien - extras) / tot) : 0;
        var desv = st.esperados.filter(function (e) { return e.usado; }).map(function (e) { return e.desv; });
        var prom = desv.length ? desv.reduce(function (a, b) { return a + b; }, 0) / desv.length : 0;
        if (pct >= 80) ctl.ok(); else { ctl.mal(); if (ctl.cerrar) ctl.cerrar(); }
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
    };
  }
  var ctlHtml = ctl; // alias: dentro de los ejercicios el parámetro se llama ctl

  /* ================= unidades y lecciones ================= */
  var UNIDADES = [
    { id: 'teclado', nom: 'El teclado', que: 'Ubicar cualquier nota rápido, octavas, tonos y semitonos', lecciones: [
      { id: 'blancas', nom: 'Las teclas blancas', meta: 8, ej: ejNota({}),
        txt: 'Las teclas negras van en grupos de <b>dos</b> y de <b>tres</b>. La blanca que está justo a la izquierda del grupo de dos es <b>Do</b>; de ahí siguen Re, Mi, Fa, Sol, La, Si, y vuelve a empezar. El patrón se repite por todo el piano: si ubicas Do, ubicas todo.' },
      { id: 'negras', nom: 'Sostenidos y bemoles', meta: 8, ej: ejNota({ negras: true }),
        txt: 'Las teclas negras no tienen nombre propio: toman el de la blanca vecina. <b>#</b> (sostenido) es "un semitono más arriba": Do# es la negra a la derecha de Do. <b>b</b> (bemol) es "un semitono más abajo": Reb es la negra a la izquierda de Re. Do# y Reb son la <b>misma tecla</b>; cuál nombre se usa depende del tono de la canción.' },
      { id: 'octavas', nom: 'Octavas y registro', meta: 6, ej: ejNota({ octavas: true }),
        txt: 'De un Do al siguiente hay una <b>octava</b>. Se numeran: Do4 es el Do central (frente a la marca del piano), Do3 queda una octava abajo y Do5 una arriba. Para acompañar, la mano izquierda vive entre Do2 y Do3 (los bajos) y la derecha entre Do3 y Do5 (los acordes). Más abajo suena barroso; más arriba, flaco.' },
      { id: 'semitonos', nom: 'Tonos y semitonos', meta: 8, ej: ejSemitonos(),
        txt: 'Un <b>semitono</b> es la distancia a la tecla vecina, sea blanca o negra (Mi–Fa y Si–Do son semitonos aunque las dos sean blancas). Un <b>tono</b> son dos semitonos. Contar semitonos es la herramienta con que se arman escalas y acordes y se transpone.' }
    ] },
    { id: 'intervalos', nom: 'Intervalos', que: 'La distancia entre dos notas: de ahí salen los acordes', explorar: exIntervalos, lecciones: [
      { id: 'terceras', nom: 'Terceras mayores y menores', meta: 8, ej: ejIntervalo({ semis: [3, 4] }),
        txt: 'Un intervalo es la distancia entre dos notas, contada en semitonos. El más importante para acompañar es la <b>tercera</b>: la <b>mayor</b> (4 semitonos, Do–Mi) hace que un acorde suene alegre; la <b>menor</b> (3 semitonos, La–Do) lo hace sonar triste. Es la nota que más define el acorde.' },
      { id: 'quintas', nom: 'Cuartas, quintas y octavas', meta: 8, ej: ejIntervalo({ semis: [7, 12, 5] }),
        txt: 'La <b>5ª justa</b> (7 semitonos, Do–Sol) da cuerpo: fundamental + quinta en la mano izquierda sirve para casi cualquier acorde. La <b>octava</b> (12) es la misma nota más aguda. Y la <b>4ª justa</b> (5 semitonos) es la 5ª mirada al revés: del bajo del I al del IV hay una 4ª.' },
      { id: 'septimas', nom: 'Sextas y séptimas', meta: 8, ex: { iv: 10 }, ej: ejIntervalo({ semis: [9, 10, 11] }),
        txt: 'La <b>7ª menor</b> (10 semitonos) es la que convierte a Sol en <b>Sol7</b>: el color del blues, el bolero y la bossa. La <b>7ª mayor</b> (11) da el Domaj7 suave de balada. La <b>6ª mayor</b> (9) está en los acordes de sexta, de bolero y swing.' },
      { id: 'oido', nom: 'Reconocer de oído', meta: 10, ej: ejIntervalo({ semis: [3, 4, 5, 7, 12], oido: true }),
        txt: 'Para sacar canciones de oído hay que reconocer los intervalos sin mirar. Ayuda asociarlos a canciones: la <b>3ª mayor</b> suena como el comienzo de "Cumpleaños feliz" (cum-ple), la <b>4ª justa</b> como "Aquí viene la novia", la <b>5ª</b> como el tema de "La guerra de las galaxias", la <b>octava</b> como "Somewhere over the rainbow".' }
    ] },
    { id: 'acordes', nom: 'Acordes', que: 'Mayores, menores, séptimas e inversiones, con las dos manos', explorar: exAcordes, lecciones: [
      { id: 'mayores', nom: 'Tríadas mayores', meta: 8, ej: ejAcorde({ tipos: [''] }),
        txt: 'Un acorde mayor son tres notas: la <b>fundamental</b>, su <b>3ª mayor</b> (4 semitonos arriba) y su <b>5ª justa</b> (7 semitonos). Do = Do–Mi–Sol. Cuenta semitonos y sale cualquiera: Mib = Mib–Sol–Sib.' },
      { id: 'menores', nom: 'Tríadas menores', meta: 8, ej: ejAcorde({ tipos: ['', 'm'] }),
        txt: 'El acorde menor cambia <b>solo la tercera</b>: baja un semitono (3 semitonos desde la fundamental). Lam = La–Do–Mi. Ejercicio mixto: fíjate bien si piden mayor o menor.' },
      { id: 'manos', nom: 'Las dos manos', meta: 6, ej: ejAcorde({ tipos: ['', 'm'], manos: true }),
        txt: 'Así se acompaña en piano popular: la <b>mano izquierda toca la fundamental</b> (el bajo, una sola nota, entre Do2 y Do3) y la <b>derecha toca el acorde</b>. Con eso ya suena a canción. Más adelante el bajo alterna con la quinta y la derecha cambia de inversión.' },
      { id: 'inversiones', nom: 'Inversiones', meta: 6, ej: ejAcorde({ tipos: ['', 'm'], inversion: true }),
        txt: 'Invertir un acorde es tocar las mismas notas empezando por otra. <b>1ª inversión</b>: la 3ª queda abajo (Mi–Sol–Do). <b>2ª inversión</b>: la 5ª abajo (Sol–Do–Mi). Sirven para pasar de un acorde a otro <b>moviendo poco la mano</b>: de Do a Fa, en vez de saltar, basta con mover dos dedos (Do–Mi–Sol → Do–Fa–La).' },
      { id: 'septimas', nom: 'Acordes de séptima', meta: 8, ex: { tipo: '7' }, ej: ejAcorde({ tipos: ['7', 'maj7', 'm7'] }),
        txt: 'Se agrega una cuarta nota. <b>Sol7</b> (dominante): tríada mayor + 7ª menor (10 semitonos): pide resolver al I. <b>Domaj7</b>: tríada mayor + 7ª mayor (11): suave, de balada y bossa. <b>Lam7</b>: tríada menor + 7ª menor: el menor "relajado" del pop y el jazz.' },
      { id: 'otros', nom: 'Sus, disminuido y aumentado', meta: 8, ej: ejAcorde({ tipos: ['sus4', 'sus2', 'dim', 'aug'] }),
        txt: '<b>Sus4</b> y <b>sus2</b> reemplazan la 3ª por la 4ª o la 2ª: quedan "suspendidos", ni mayores ni menores (Dosus4 → Do, muy usado en pop). <b>Disminuido</b> (º): menor con la 5ª bajada, acorde de paso. <b>Aumentado</b> (+): mayor con la 5ª subida, para tensión entre dos acordes.' },
      { id: 'grados', nom: 'Armar el grado de un tono', meta: 8, ej: ejAcorde({ grado: { modo: 'mayor' }, manos: true }),
        txt: 'Junta todo lo anterior: te piden <b>un grado de un tono</b> (por ejemplo "el IV de Sol") y tú armas el acorde con las dos manos. Cuenta por la escala mayor del tono: I, ii, iii, IV, V, vi. Mayúscula = mayor, minúscula = menor. Si no te acuerdas del campo armónico, mira la unidad 5.' }
    ] },
    { id: 'escalas', nom: 'Escalas', que: 'Mayor, menores, pentatónicas, blues y modos útiles', explorar: exEscalas, lecciones: [
      { id: 'mayor', nom: 'La escala mayor', meta: 5, ej: ejEscala({ escalas: ['mayor'], raices: ['C', 'G', 'D', 'F', 'A', 'Bb', 'E', 'Eb'] }),
        txt: 'La escala mayor es la base de todo: de ella salen los acordes de cada tono. Su fórmula es <b>T – T – S – T – T – T – S</b> (tono, tono, semitono…). En Do son las blancas. Para acompañar no hace falta tocarla rápido: hace falta saber <b>qué notas pertenecen</b> al tono. Digitación de la derecha: 1-2-3, pasa el pulgar, 1-2-3-4-5.' },
      { id: 'menores', nom: 'Escalas menores', meta: 5, ex: { esc: 'menor', raiz: 'A' }, ej: ejEscala({ escalas: ['menor', 'armonica'] }),
        txt: 'La <b>menor natural</b> (T – S – T – T – S – T – T) tiene las mismas notas que la mayor que está 3 semitonos arriba: La menor usa las de Do mayor. La <b>menor armónica</b> sube la 7ª un semitono, para que el V sea mayor (Mi7 en La menor): es el sonido del bolero y el tango.' },
      { id: 'penta', nom: 'Pentatónicas y blues', meta: 5, ex: { esc: 'penta' }, ej: ejEscala({ escalas: ['penta', 'pentam', 'blues'] }),
        txt: 'La <b>pentatónica</b> saca las dos notas más conflictivas de la escala: con sus cinco notas puedes adornar e improvisar sin chocar con nada. La mayor (Do–Re–Mi–Sol–La) sobre acordes mayores; la menor (La–Do–Re–Mi–Sol) sobre menores, rock y pop. La <b>blues</b> le agrega la ♭5 "de pasada".' },
      { id: 'modos', nom: 'Dórica y mixolidia', meta: 4, ex: { esc: 'dorica', raiz: 'D' }, ej: ejEscala({ escalas: ['dorica', 'mixo'] }),
        txt: 'Dos "modos" que aparecen mucho en lo popular. <b>Dórica</b>: menor con la 6ª mayor (funk, salsa, Santana). <b>Mixolidia</b>: mayor con la 7ª menor, la escala natural sobre un acorde de séptima (rock, cumbia, "Sympathy for the Devil"). Si una canción en Sol usa mucho el Fa, está en mixolidia.' }
    ] },
    { id: 'campo', nom: 'Campo armónico', que: 'Los siete acordes de cada tono y para qué sirve cada uno', explorar: exCampo, lecciones: [
      { id: 'mayor', nom: 'Los acordes del tono mayor', meta: 8, ej: ejCampoQuiz({ modo: 'mayor', clases: ['acorde', 'grado'] }),
        txt: 'Si a cada nota de la escala le armas un acorde con notas de la misma escala, salen los siete acordes del tono: su <b>campo armónico</b>. En mayor siempre es <b>I – ii – iii – IV – V – vi – viiº</b>: mayor, menor, menor, mayor, mayor, menor, disminuido. Casi todas las canciones usan solo estos (y sobre todo I, IV, V y vi).' },
      { id: 'funciones', nom: 'Tónica, subdominante y dominante', meta: 8, ej: ejCampoQuiz({ modo: 'mayor', clases: ['funcion'] }),
        txt: 'Cada grado cumple una <b>función</b>. <b>Tónica</b> (I, vi, iii): reposo, "estar en casa". <b>Subdominante</b> (IV, ii): se aleja, prepara. <b>Dominante</b> (V, viiº): tensión, pide volver a la tónica. Una canción es un viaje: sale de casa, se aleja, tensa y vuelve. Entender esto permite adivinar el acorde que viene.' },
      { id: 'menor', nom: 'El tono menor', meta: 8, ex: { modo: 'menor' }, ej: ejCampoQuiz({ modo: 'menor', clases: ['acorde', 'grado'] }),
        txt: 'En menor el campo es <b>i – iiº – III – iv – V – VI – VII</b>. Ojo con el <b>V</b>: en la música popular se toca <b>mayor</b> (Mi o Mi7 en La menor, tomado de la menor armónica), porque así tensa y "vuelve a casa". El III, el VI y el VII son los acordes del relativo mayor.' },
      { id: 'tocar', nom: 'Tocar el grado que te piden', meta: 8, ej: ejAcorde({ grado: { modo: 'ambos' } }),
        txt: 'Ahora en el teclado: te piden un grado de un tono mayor o menor y lo armas. Esto es exactamente lo que haces cuando alguien dice "esta canción va I – V – vi – IV en Re" y tú tocas Re – La – Sim – Sol.' }
    ] },
    { id: 'progresiones', nom: 'Progresiones', que: 'Las secuencias de acordes de miles de canciones, para tocarlas', explorar: exProgresiones, lecciones: [
      { id: 'folk', nom: 'I – IV – V: la base', meta: 4, ex: { p: 'folk' }, ej: ejProgTocar({ progs: ['folk'], raices: ['C', 'G', 'D', 'F', 'A'] }),
        txt: 'Con tónica, subdominante y dominante se acompañan miles de canciones: folclor, rancheras, rock and roll, cumbia. En Do: Do – Fa – Sol. Toca cada acorde en orden en el teclado; cuando completes las notas pasa solo al siguiente. Usa la inversión que te deje la mano quieta.' },
      { id: 'pop', nom: 'I – V – vi – IV: el pop', meta: 4, ej: ejProgTocar({ progs: ['pop', '50s', 'emo'] }),
        txt: 'La progresión más usada de las últimas décadas. En Do: Do – Sol – Lam – Fa. Sus variantes son I – vi – IV – V (las baladas de los 50) y vi – IV – I – V (la misma empezando en el menor, más melancólica). Quien las domina en todos los tonos puede acompañar casi cualquier canción pop.' },
      { id: 'menor', nom: 'Progresiones en menor', meta: 4, ex: { p: 'menor', raiz: 'A' }, ej: ejProgTocar({ progs: ['menor', 'andaluza', 'menorpop'] }),
        txt: '<b>i – iv – V</b> es la cadencia menor de boleros y baladas (Lam – Rem – Mi). La <b>andaluza</b> i – VII – VI – V baja por grados (Lam – Sol – Fa – Mi): flamenco, rumba. Y <b>i – VI – III – VII</b> es el pop en menor (Lam – Fa – Do – Sol).' },
      { id: 'jazz', nom: 'ii – V – I con séptimas', meta: 4, ex: { p: 'iivi' }, ej: ejProgTocar({ progs: ['iivi', 'circulo'] }),
        txt: 'La cadencia del jazz, el bolero y la bossa: <b>Rem7 – Sol7 – Domaj7</b>. Cada acorde lleva al siguiente por quintas. El "círculo" I – vi – ii – V (Domaj7 – Lam7 – Rem7 – Sol7) es su versión larga, y se repite en bucle en cientos de boleros y standards.' },
      { id: 'oido', nom: 'Reconocer progresiones de oído', meta: 8, ej: ejProgOido({ progs: ['folk', 'pop', '50s', 'menor', 'andaluza', 'iivi'] }),
        txt: 'Para sacar una canción basta reconocer la progresión. Pistas: ¿el primer acorde es mayor o menor? ¿el segundo sube (al IV o V) o baja (al vi)? ¿el último deja tensión (V) o reposa (I)? Escucha y elige.' }
    ] },
    { id: 'transponer', nom: 'Transponer', que: 'Llevar una canción a otro tono para cantarla cómodo', explorar: exTransponer, lecciones: [
      { id: 'porque', nom: 'Elegir el tono para la voz', meta: 6, ej: ejSemitonos(),
        txt: 'Cada voz tiene un rango cómodo. Si la canción original queda muy aguda, se <b>baja</b> el tono entero; si queda grave, se sube. Transponer es mover <b>todos</b> los acordes la misma cantidad de semitonos. Regla práctica: prueba de a un tono (2 semitonos) hasta que las notas altas del coro salgan sin apretar. Este ejercicio repasa contar semitonos, que es la base.' },
      { id: 'grados', nom: 'Pensar en grados', meta: 8, ej: ejCampoQuiz({ modo: 'ambos', clases: ['grado'] }),
        txt: 'El truco de los músicos populares: no memorizar acordes sino <b>grados</b>. "Sol – Mim – Do – Re" es I – vi – IV – V en Sol; en Mi es Mi – Do#m – La – Si. Si sabes el grado de cada acorde en el tono original, rearmarlo en el nuevo es inmediato.' },
      { id: 'triadas', nom: 'Transponer progresiones', meta: 6, ej: ejTransponer({}),
        txt: 'Ahora en serio: te doy una progresión en un tono y la llevas a otro. Cuenta los semitonos entre los dos tonos y mueve cada acorde esa misma cantidad; el tipo (mayor, menor) no cambia. Si prefieres, piensa en grados y rearma.' },
      { id: 'septimas', nom: 'Transponer con séptimas', meta: 5, ej: ejTransponer({ sept: true }),
        txt: 'Igual que antes, pero con acordes de séptima (ii–V–I, el círculo): el sufijo viaja intacto. Rem7 – Sol7 – Domaj7 en Do pasa a Fam7 – Sib7 – Mibmaj7 en Mib.' }
    ] },
    { id: 'ritmica', nom: 'Rítmica', que: 'Patrones de acompañamiento: balada, bolero, vals, cumbia, bossa…', explorar: function (el, st) { exProgresiones(el, st, { rejilla: true, p: 'folk' }); }, lecciones: [
      { id: 'negras', nom: 'Balada en negras y corcheas', meta: 3, ej: ejRitmo({ ritmos: ['negras', 'corcheas'], bpm: 70 }),
        txt: 'El ritmo es lo que hace que los mismos acordes suenen a balada, a cumbia o a bolero. Regla de oro: <b>la izquierda marca el bajo en los tiempos fuertes</b> (1 y 3) y la derecha dibuja el estilo. El más simple: acorde en cada negra (1 2 3 4). Luego en corcheas (1 y 2 y 3 y 4 y), marcando más el 1 y el 3. Cuenta en voz alta mientras tocas.' },
      { id: 'arpegio', nom: 'Arpegio y bajo en octavas', meta: 3, ex: { r: 'arpegio' }, ej: ejRitmo({ ritmos: ['arpegio', 'octavas'], bpm: 70 }),
        txt: 'En vez del acorde entero, la derecha toca sus notas una a una (1 – 3 – 5 – 8 – 5 – 3): el <b>arpegio</b> de las baladas lentas. Y la izquierda puede alternar fundamental y octava (bajo en octavas), el motor del rock and roll y de la cumbia chilena.' },
      { id: 'vals', nom: 'Vals y 6/8', meta: 3, ex: { r: 'vals' }, ej: ejRitmo({ ritmos: ['vals', 'seisocho'], bpm: 90 }),
        txt: 'No todo va en 4. El <b>vals</b> (3/4) es bajo – acorde – acorde: valses, valses peruanos, rancheras. El <b>6/8</b> son dos grupos de tres corcheas (1-2-3 4-5-6) con el bajo en el 1 y la quinta en el 4: cueca, tonada, baladas lentas.' },
      { id: 'latino', nom: 'Bolero, cumbia y bossa', meta: 3, ex: { r: 'tresillo' }, ej: ejRitmo({ ritmos: ['tresillo', 'cumbia', 'bossa', 'reggae'], bpm: 85 }),
        txt: 'Los ritmos latinos viven del <b>contratiempo</b>. El <b>tresillo</b> del bolero reparte 3 + 3 + 2 corcheas. La <b>cumbia</b> pone el acorde siempre en las "y", sobre un bajo que alterna fundamental y quinta. La <b>bossa</b> anticipa el bajo y sincopa el acorde. El <b>reggae</b> acentúa el 2 y el 4, cortito.' }
    ] },
    { id: 'canciones', nom: 'Acompañar canciones', que: 'Leer un cifrado y tocarlo: la meta de todo lo anterior', lecciones: [
      { id: 'cifrado', nom: 'Leer un cifrado', meta: 4, ej: ejProgTocar({ cancion: true }),
        txt: 'Un <b>cifrado</b> es la letra con los acordes escritos encima de la sílaba en que cambian: es como se pasan las canciones en la música popular, y es lo que guarda tu Cancionero. Aquí tocas en orden los acordes de una canción de tu Cancionero (si no tiene ninguna con acordes, usa una progresión). Prueba a tocarlos con la inversión más cercana.' },
      { id: 'bajos', nom: 'Bajos con quinta y octava', meta: 6, ej: ejAcorde({ grado: { modo: 'mayor', grados: [0, 3, 4, 5] }, manos: true }),
        txt: 'Cuando la izquierda ya toca el bajo seguro, hazla alternar <b>fundamental – quinta</b> (Do – Sol – Do – Sol) o <b>fundamental – octava</b>. Con eso el acompañamiento camina solo. Este ejercicio repasa las dos manos sobre los grados que más se usan (I, IV, V, vi); al tocar de verdad, alterna el bajo con su quinta en los tiempos 3.' },
      { id: 'cadencias', nom: 'Entradas y finales', meta: 6, ej: ejProgOido({ progs: ['folk', 'iivi', 'menor', 'andaluza'] }),
        txt: 'Para <b>entrar</b> a una canción basta tocar el V (o V7) un compás y caer al I: quien canta ya sabe el tono. Para <b>terminar</b>, la cadencia IV – V – I con el último acorde largo, o ii – V – I si la canción es bolero o bossa. Escucha y reconoce cuál es cuál.' },
      { id: 'repaso', nom: 'Repaso general', meta: 10, ej: ejAcorde({ grado: { modo: 'ambos', sept: true }, manos: true }),
        txt: 'Última tarea: grados con séptima, en mayor y en menor, con las dos manos. Si esto sale solo, puedes acompañar lo que te pongan adelante. Después, la mejor práctica es el propio Cancionero: elige una canción, ponle el ritmo que le quede y tócala completa.' }
    ] }
  ];
  function unidad(id) { for (var i = 0; i < UNIDADES.length; i++) if (UNIDADES[i].id === id) return UNIDADES[i]; return null; }
  UNIDADES.forEach(function (u) { u.lecciones.forEach(function (l) { l.id = u.id + '/' + l.id; l.uni = u; }); });
  function leccion(u, id) { for (var i = 0; i < u.lecciones.length; i++) if (u.lecciones[i].id === u.id + '/' + id) return u.lecciones[i]; return null; }
  function hechasDe(u) { var p = avance(); return u.lecciones.filter(function (l) { return p[l.id] && p[l.id].hecha; }).length; }
  function siguienteLec(lec) {
    var ls = lec.uni.lecciones, i = ls.indexOf(lec);
    if (i + 1 < ls.length) return ls[i + 1];
    var ui = UNIDADES.indexOf(lec.uni);
    return ui + 1 < UNIDADES.length ? UNIDADES[ui + 1].lecciones[0] : null;
  }
  function rutaLec(lec) { return 'piano/' + lec.id; }

  /* ================= PRÁCTICA: sesiones largas para automatizar =================
     Cada ejercicio es una sesión de N rondas con reloj. Lo que se mide:
     rondas limpias (sin fallos ni pistas) y segundos por ronda. Se guarda el
     mejor resultado, el último, cuántas veces y en qué tono quedó el círculo
     de quintas (la próxima sesión sigue desde ahí). Las rutinas encadenan
     varios ejercicios cortos, mezclados (práctica intercalada). */
  var PRACKEY = 'sb.piano.practica';
  var TODAS_PROGS = ['folk', 'pop', '50s', 'emo', 'menor', 'andaluza', 'iivi'];
  var PRACTICAS = [
    { grupo: 'Teclado y notas', items: [
      { id: 'notas', nom: 'Notas relámpago', n: 24, ej: ejNota({ negras: true }),
        que: 'Toca la nota que aparece, blancas y negras. Primero sin errores; después baja los segundos por nota.' },
      { id: 'semitonos', nom: 'Contar semitonos', n: 20, ej: ejSemitonos(),
        que: 'Distancias entre dos notas, subiendo y bajando: la base para armar acordes y transponer de cabeza.' }
    ] },
    { grupo: 'Oído', items: [
      { id: 'int-oido', nom: 'Intervalos de oído', n: 20, ej: ejIntervalo({ semis: [2, 3, 4, 5, 7, 9, 10, 12], oido: true }),
        que: 'Escucha y reconoce el intervalo. Hacerlo un poco cada día rinde más que mucho de una vez.' },
      { id: 'int-tocar', nom: 'Intervalos en el teclado', n: 20, ej: ejIntervalo({ semis: [3, 4, 5, 7, 9, 10, 11, 12] }),
        que: 'Toca el intervalo pedido sobre la nota marcada, sin contar con el dedo: que la mano lo sepa.' },
      { id: 'prog-oido', nom: 'Progresiones de oído', n: 12, ej: ejProgOido({ progs: TODAS_PROGS }),
        que: 'Reconoce las progresiones más usadas al escucharlas: el paso previo a sacar canciones de oído.' }
    ] },
    { grupo: 'Acordes en los 12 tonos', items: [
      { id: 'triadas12', nom: 'Tríadas mayores y menores', n: 24, ciclo: true, ej: ejAcorde({ tipos: ['', 'm'] }),
        que: 'Cada tono en mayor y en menor, recorriendo los 12 por el círculo de quintas. Una sesión más corta parte donde quedó la anterior.' },
      { id: 'inv12', nom: 'Inversiones', n: 12, ciclo: true, ej: ejAcorde({ tipos: ['', 'm'], inversion: true }),
        que: 'Primera y segunda inversión en todos los tonos: es lo que permite cambiar de acorde moviendo poco la mano.' },
      { id: 'sept12', nom: 'Acordes de séptima', n: 36, ciclo: true, ej: ejAcorde({ tipos: ['7', 'maj7', 'm7'] }),
        que: 'Dominante, séptima mayor y menor séptima de cada tono, por el círculo de quintas.' },
      { id: 'manos12', nom: 'Bajo y acorde, dos manos', n: 12, ciclo: true, ej: ejAcorde({ tipos: ['', 'm'], manos: true }),
        que: 'La posición básica de acompañar en los 12 tonos: fundamental en la izquierda, acorde en la derecha.' }
    ] },
    { grupo: 'Escalas en los 12 tonos', items: [
      { id: 'esc-mayor', nom: 'Escalas mayores', n: 12, ciclo: true, ej: ejEscala({ escalas: ['mayor'] }),
        que: 'Las 12 escalas mayores por el círculo de quintas (cada tono suma una alteración). Saber qué notas tiene cada tono.' },
      { id: 'esc-menor', nom: 'Escalas menores', n: 12, ciclo: true, ej: ejEscala({ escalas: ['menor', 'armonica'] }),
        que: 'Menor natural y armónica en todos los tonos.' },
      { id: 'esc-penta', nom: 'Pentatónicas y blues', n: 10, ej: ejEscala({ escalas: ['penta', 'pentam', 'blues'] }),
        que: 'Las escalas para adornar e improvisar, en tonos al azar.' }
    ] },
    { grupo: 'Armonía y progresiones', items: [
      { id: 'campo-rel', nom: 'Campo armónico relámpago', n: 24, ej: ejCampoQuiz({ modo: 'ambos', clases: ['acorde', 'grado', 'funcion'] }),
        que: 'Grados, acordes y funciones de cualquier tono mayor o menor, rápido. Es lo que hace inmediato transponer.' },
      { id: 'grados12', nom: 'Tocar grados en los 12 tonos', n: 12, ciclo: true, ej: ejAcorde({ grado: { modo: 'ambos' }, manos: true }),
        que: '"El IV de Mib", "el V de Do# menor": armarlo con las dos manos sin pensar.' },
      { id: 'pop12', nom: 'I–IV–V y I–V–vi–IV en los 12 tonos', n: 12, ciclo: true, ej: ejProgTocar({ progs: ['folk', 'pop'] }),
        que: 'Las dos progresiones que más canciones acompañan, tono por tono por el círculo de quintas.' },
      { id: 'iivi12', nom: 'ii–V–I en los 12 tonos', n: 12, ciclo: true, ej: ejProgTocar({ progs: ['iivi'] }),
        que: 'La cadencia de boleros, bossa y jazz, con séptimas, en todos los tonos.' },
      { id: 'menor12', nom: 'Progresiones menores en los 12 tonos', n: 12, ciclo: true, ej: ejProgTocar({ progs: ['menor', 'andaluza', 'menorpop'] }),
        que: 'i–iv–V, la andaluza y el pop en menor, recorriendo los tonos.' },
      { id: 'transp', nom: 'Transponer progresiones', n: 10, ej: ejTransponer({}),
        que: 'Lleva progresiones de un tono a otro, eligiendo cada acorde.' }
    ] },
    { grupo: 'Ritmo', items: [
      { id: 'ritmos', nom: 'Ritmos con metrónomo', n: 6, ritmo: true, ej: ejRitmo({ ritmos: RITMOS.map(function (r) { return r.id; }), bpm: 70 }),
        que: 'Seis pasadas de 4 compases. Elige el ritmo y sube el tempo de a 5 cuando pases el 80 %.' }
    ] }
  ];
  var RUTINAS = [
    { id: 'diaria', nom: 'Rutina diaria', min: 15, que: 'Un poco de todo, mezclado: notas, oído, acordes, escala, campo armónico y una progresión.',
      pasos: [['notas', 12], ['int-oido', 10], ['triadas12', 12], ['esc-mayor', 3], ['campo-rel', 10], ['pop12', 4]] },
    { id: 'corta', nom: 'Calentamiento', min: 5, que: 'Para los días con poco tiempo: notas, tríadas y oído.',
      pasos: [['notas', 8], ['triadas12', 8], ['int-oido', 6]] },
    { id: 'acomp', nom: 'Rutina de acompañante', min: 15, que: 'Lo que más se usa al tocar canciones: dos manos, inversiones, grados y progresiones.',
      pasos: [['manos12', 8], ['inv12', 8], ['grados12', 8], ['pop12', 4], ['iivi12', 4], ['prog-oido', 6]] }
  ];
  PRACTICAS.forEach(function (g) { g.items.forEach(function (it) { it.grupo = g.grupo; }); });
  function practica(id) { var r = null; PRACTICAS.forEach(function (g) { g.items.forEach(function (it) { if (it.id === id) r = it; }); }); return r; }
  function rutina(id) { for (var i = 0; i < RUTINAS.length; i++) if (RUTINAS[i].id === id) return RUTINAS[i]; return null; }
  function datosPr() { try { var d = JSON.parse(localStorage.getItem(PRACKEY) || '{}'); d.ej = d.ej || {}; d.dias = d.dias || []; return d; } catch (e) { return { ej: {}, dias: [] }; } }
  function guardarPr(d) { try { localStorage.setItem(PRACKEY, JSON.stringify(d)); } catch (e) {} if (SB.nube) SB.nube.cambio(); }
  function hoy() { var t = new Date(); return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2); }
  function racha(dias) {
    var set = {}, n = 0, t = new Date();
    dias.forEach(function (d) { set[d] = true; });
    function clave(x) { return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2); }
    if (!set[clave(t)]) t.setDate(t.getDate() - 1);   // si hoy aún no practicas, la racha cuenta hasta ayer
    while (set[clave(t)]) { n++; t.setDate(t.getDate() - 1); }
    return n;
  }
  function seg(x) { return (Math.round(x * 10) / 10).toString().replace('.', ',') + ' s'; }
  function reloj(s_) { s_ = Math.round(s_); return Math.floor(s_ / 60) + ':' + ('0' + s_ % 60).slice(-2); }
  function mejorQue(a, b) { return !b || a.pct > b.pct || (a.pct === b.pct && a.prom < b.prom); }
  function nubeHtml() { return SB.nube ? '<p class="ed-note pk-credito">☁ ' + esc(SB.nube.estado().txt) + '</p>' : ''; }
  function tabsHtml(cual) {
    return '<nav class="pk-tabs"><a href="#/piano" class="' + (cual === 'lecciones' ? 'on' : '') + '">Lecciones</a><a href="#/piano/practica" class="' + (cual === 'practica' ? 'on' : '') + '">Práctica</a></nav>';
  }

  function portadaPractica() {
    S.onKey = null; parar(); S.lec = null; S.ciclo = null;
    var d = datosPr(), r = racha(d.dias), sesHoy = d.dias.filter(function (x) { return x === hoy(); }).length;
    S.view.innerHTML =
      '<div class="pk-scope pk-ancho">' + tabsHtml('practica') +
      '<div class="rep-head"><div><h1>Práctica diaria</h1><p class="artist">' +
      (r ? 'Llevas ' + r + ' día' + (r > 1 ? 's' : '') + ' seguido' + (r > 1 ? 's' : '') : 'Todavía no hay racha: empieza hoy') +
      (sesHoy ? ' · hoy: ' + sesHoy + (sesHoy > 1 ? ' sesiones' : ' sesión') : '') + '</p></div></div>' +
      '<div class="pk-consejos"><div><b>Poco y seguido.</b> 10 a 15 minutos diarios rinden más que una hora a la semana: lo que se repite en días distintos se retiene mejor.</div>' +
      '<div><b>Los 12 tonos.</b> Acordes, escalas y progresiones recorren el círculo de quintas; cada sesión parte en el tono donde quedó la anterior.</div>' +
      '<div><b>Mezclado.</b> Las rutinas alternan ejercicios distintos. Cuesta un poco más, pero se aprende mejor que repetir uno solo.</div>' +
      '<div><b>Primero limpio, después rápido.</b> Cuenta cada ronda sin errores; cuando estés sobre 90 %, trata de bajar los segundos por ronda.</div></div>' +
      '<h2 class="pk-h2">Rutinas</h2><div class="pk-unis">' + RUTINAS.map(function (ru) {
        var st_ = d.ej['rutina-' + ru.id];
        return '<a class="pk-uni pk-card" href="#/piano/practica/rutina/' + ru.id + '"><div class="pk-uni-head"><h2>' + esc(ru.nom) + '</h2><span class="pk-uni-av">≈' + ru.min + ' min</span></div>' +
          '<p class="pk-uni-que">' + esc(ru.que) + '</p><p class="pk-uni-que">' + ru.pasos.map(function (p) { return esc(practica(p[0]).nom); }).join(' · ') + '</p>' +
          '<p class="pk-stat">' + (st_ ? 'Hecha ' + st_.veces + ' ' + (st_.veces > 1 ? 'veces' : 'vez') + ' · última ' + st_.f : 'Sin hacer todavía') + '</p></a>';
      }).join('') + '</div>' +
      PRACTICAS.map(function (g) {
        return '<h2 class="pk-h2">' + esc(g.grupo) + '</h2><div class="pk-unis">' + g.items.map(function (it) {
          var x = d.ej[it.id];
          return '<a class="pk-uni pk-card" href="#/piano/practica/' + it.id + '"><div class="pk-uni-head"><h2>' + esc(it.nom) + '</h2><span class="pk-uni-av">' + it.n + ' rondas' + (it.ciclo ? ' · 12 tonos' : '') + '</span></div>' +
            '<p class="pk-uni-que">' + esc(it.que) + '</p>' +
            '<p class="pk-stat">' + (x && x.mejor ? 'Mejor: ' + x.mejor.pct + ' % limpias · ' + seg(x.mejor.prom) + ' por ronda · ' + x.veces + ' ' + (x.veces > 1 ? 'veces' : 'vez') : 'Sin practicar todavía') + '</p></a>';
        }).join('') + '</div>';
      }).join('') + nubeHtml() + '</div>';
  }

  // Sesión de un ejercicio. ru = {r: rutina, k: paso} si es parte de una rutina.
  function abrirPractica(it, n, ru) {
    S.onKey = null; S.st = {}; parar();
    var d = datosPr(), x = d.ej[it.id] || {};
    var lec = { id: 'practica/' + it.id, uni: { id: it.ritmo ? 'ritmica' : 'practica' } };
    S.lec = lec; S.uni = null;
    S.ciclo = it.ciclo ? { i: x.ciclo || 0, t: 0 } : null;
    var tonoIni = it.ciclo ? ver(RAIZ_MAYOR[CICLO[(x.ciclo || 0) % 12]]) : null;
    var lateral = ru
      ? '<div class="panel-title">' + esc(ru.r.nom) + '</div><ol class="pk-lecs">' + ru.r.pasos.map(function (p, i) {
          return '<li><span class="pk-lec' + (i < ru.k ? ' hecha' : '') + (i === ru.k ? ' actual' : '') + '"><span class="pk-check">' + (i < ru.k ? '✓' : '') + '</span>' + esc(practica(p[0]).nom) + ' (' + p[1] + ')</span></li>';
        }).join('') + '</ol>'
      : '<div class="panel-title">' + esc(it.grupo) + '</div><ol class="pk-lecs">' + PRACTICAS.filter(function (g) { return g.grupo === it.grupo; })[0].items.map(function (o) {
          return '<li><a href="#/piano/practica/' + o.id + '" class="pk-lec' + (o === it ? ' actual' : '') + '"><span class="pk-check"></span>' + esc(o.nom) + '</a></li>';
        }).join('') + '</ol>';
    S.view.innerHTML =
      '<div class="pk-scope pk-lay">' +
      '<aside class="pk-side"><button class="back" id="pkBack">← Práctica</button>' + lateral + '</aside>' +
      '<main class="pk-main">' +
      '<div class="rep-head"><div><p class="pk-crumb">Práctica' + (ru ? ' · ' + esc(ru.r.nom) + ' · paso ' + (ru.k + 1) + ' de ' + ru.r.pasos.length : ' · ' + esc(it.grupo)) + '</p><h1>' + esc(it.nom) + '</h1></div>' +
      '<div class="pk-reloj"><span id="pkReloj">0:00</span><small>tiempo</small></div></div>' +
      '<div class="pk-txt">' + esc(it.que) + (tonoIni ? ' Hoy parte en ' + tonoIni + '.' : '') +
      (x.mejor ? ' Tu mejor marca: ' + x.mejor.pct + ' % limpias, ' + seg(x.mejor.prom) + ' por ronda.' : '') + '</div>' +
      '<section class="pk-ej"><div class="pk-ej-head"><span class="panel-title">Ronda <span id="pkRonda">1</span> de ' + n + '</span><span class="pk-meta" id="pkMeta"></span></div><div class="pk-bar"><span id="pkBarra"></span></div>' +
      '<div id="pkEjCuerpo"></div>' + qwAyudaHtml() + '</section>' +
      '<p class="set-status" id="pkAviso"></p></main></div>';
    on('pkBack', 'click', function () { S.ctx.navigate('piano/practica'); });
    wireQw();

    var rondas = [], t0 = null, inicio = null, fallo = false, fallos = 0, fin = false;
    var tic = setInterval(function () {
      var el = q('#pkReloj');
      if (!el || S.lec !== lec) { clearInterval(tic); return; }
      if (inicio) el.textContent = reloj((Date.now() - inicio) / 1000);
    }, 500);
    function pintar() {
      var limpias = rondas.filter(function (r) { return r.limpia; }).length;
      q('#pkRonda').textContent = Math.min(rondas.length + 1, n);
      q('#pkBarra').style.width = Math.round(100 * rondas.length / n) + '%';
      q('#pkMeta').textContent = rondas.length ? limpias + ' de ' + rondas.length + ' limpias' : '';
    }
    function cerrarRonda(ok) {
      if (fin) return;
      rondas.push({ limpia: ok && !fallo, s: t0 ? (Date.now() - t0) / 1000 : 0 });
      t0 = null; pintar();
      if (rondas.length >= n) terminar();
    }
    var ctlP = {
      nueva: function () { if (fin) return; fallo = false; fallos = 0; t0 = Date.now(); if (!inicio) inicio = t0; },
      fallos: function () { return fallos; },
      ok: function () { cerrarRonda(true); },
      mal: function () { fallos++; fallo = true; },
      cerrar: function () { cerrarRonda(false); }
    };
    function terminar() {
      fin = true; S.lec = null; S.onKey = null; S.teclados = [];
      var total = (Date.now() - inicio) / 1000;
      var limpias = rondas.filter(function (r) { return r.limpia; }).length;
      var pct = Math.round(100 * limpias / rondas.length);
      var prom = rondas.reduce(function (a, r) { return a + r.s; }, 0) / rondas.length;
      var res = { pct: pct, prom: prom, f: hoy() };
      var d2 = datosPr(), y = d2.ej[it.id] || (d2.ej[it.id] = { veces: 0 });
      var record = mejorQue(res, y.mejor) && y.veces > 0;
      y.veces++; y.ultimo = res;
      if (mejorQue(res, y.mejor)) y.mejor = res;
      if (S.ciclo) y.ciclo = S.ciclo.i % 12;
      d2.dias.push(hoy()); d2.dias = d2.dias.slice(-400);
      var sig = ru && ru.k + 1 < ru.r.pasos.length ? ru.k + 1 : null;
      if (ru && sig == null) { var z = d2.ej['rutina-' + ru.r.id] || (d2.ej['rutina-' + ru.r.id] = { veces: 0 }); z.veces++; z.f = hoy(); }
      guardarPr(d2);
      S.ciclo = null;
      setTimeout(function () {
        var cuerpo = q('#pkEjCuerpo'); if (!cuerpo) return;
        var qa = q('#pkQwAyuda'); if (qa) qa.remove();
        cuerpo.innerHTML = '<div class="pk-res">' +
          '<div class="pk-res-num"><b>' + pct + ' %</b><span>rondas limpias</span></div>' +
          '<div class="pk-res-num"><b>' + seg(prom) + '</b><span>por ronda</span></div>' +
          '<div class="pk-res-num"><b>' + reloj(total) + '</b><span>en total</span></div></div>' +
          '<p class="pk-fb ok">' + (record ? '¡Nuevo récord personal!' : pct >= 90 ? 'Muy bien. La próxima vez, trata de bajar los segundos.' : pct >= 70 ? 'Bien. Repite hasta pasar el 90 % de rondas limpias.' : 'Sin apuro: repítelo más lento, la exactitud viene antes que la velocidad.') + '</p>' +
          '<div class="pk-acc">' + (ru
            ? (sig != null ? '<a class="pr-play pk-go" href="#/piano/practica/rutina/' + ru.r.id + '/' + sig + '">SIGUIENTE: ' + esc(practica(ru.r.pasos[sig][0]).nom) + '</a>' : '<span class="pk-fb ok">Rutina terminada por hoy.</span>')
            : '<button class="pr-play pk-go" id="pkOtra">OTRA VEZ</button>') +
          '<a class="mini-app-btn" href="#/piano/practica">Volver a Práctica</a></div>';
        on('pkOtra', 'click', function () { abrirPractica(it, n, ru); });
        if (record || !ru || sig == null) { var c = ac(); if (c) { var t = c.currentTime; [60, 64, 67, 72].forEach(function (m, i) { tocar(m, t + i * 0.08, 1.2, 0.5); }); } }
      }, 1000);
    }
    pintar();
    it.ej(q('#pkEjCuerpo'), ctlP, lec);
  }

  /* ---------- portada ---------- */
  function portada() {
    S.onKey = null; parar(); S.lec = null; S.uni = null; S.ciclo = null;
    var p = avance(), total = 0, hechas = 0;
    UNIDADES.forEach(function (u) { total += u.lecciones.length; hechas += hechasDe(u); });
    var pendiente = null;
    UNIDADES.some(function (u) { return u.lecciones.some(function (l) { if (!(p[l.id] && p[l.id].hecha)) { pendiente = l; return true; } return false; }); });
    S.view.innerHTML =
      '<div class="pk-scope pk-ancho">' + tabsHtml('lecciones') +
      '<div class="rep-head"><div><h1>Piano popular</h1><p class="artist">' + hechas + ' de ' + total + ' lecciones completadas</p></div>' +
      '<div class="ka-head-btns">' + segHtml('pkNot', [['1', 'Do Re Mi'], ['0', 'C D E']], S.cfg.latin ? '1' : '0') +
      '<button class="mini-app-btn" id="pkMidi" title="Si tienes un piano digital conectado por USB, sus teclas cuentan en los ejercicios">Teclado MIDI</button>' +
      (pendiente ? '<button class="pr-play pk-go" id="pkSeguir">SEGUIR: ' + esc(pendiente.nom) + '</button>' : '') + '</div></div>' +
      '<p class="ed-note">Piano para acompañar canciones, no piano clásico. Cada unidad tiene lecciones cortas; cada lección es una tarea con un ejercicio que se resuelve con el mouse sobre el teclado (o con un piano MIDI) y queda marcada al cumplir la meta. Conviene ir en orden.</p>' +
      '<p class="set-status" id="pkAviso"></p>' +
      '<div class="pk-unis">' + UNIDADES.map(function (u, i) {
        var h = hechasDe(u), n = u.lecciones.length;
        return '<section class="pk-uni' + (h === n ? ' lista' : '') + '"><div class="pk-uni-head"><h2><span class="pk-num">' + (i + 1) + '</span>' + esc(u.nom) + '</h2><span class="pk-uni-av">' + h + '/' + n + '</span></div>' +
          '<p class="pk-uni-que">' + esc(u.que) + '</p>' +
          '<div class="pk-bar"><span style="width:' + Math.round(100 * h / n) + '%"></span></div>' +
          '<ol class="pk-lecs">' + u.lecciones.map(function (l) {
            var r = p[l.id];
            return '<li><a href="#/' + rutaLec(l) + '" class="pk-lec' + (r && r.hecha ? ' hecha' : '') + '"><span class="pk-check">' + (r && r.hecha ? '✓' : '') + '</span>' + esc(l.nom) + '</a></li>';
          }).join('') + '</ol></section>';
      }).join('') + '</div>' +
      '<p class="ed-note pk-credito">Sonido: el piano de Go.io, con muestras del Salamander Grand Piano de Alexander Holm (CC BY 3.0) vía Tone.js; sin internet suena un piano sintetizado.' + (tactil ? '' : ' En el computador puedes tocar con el teclado: TAB, Q, W, E… son las blancas y 1, 2, 4, 5, 6… las negras.') + '</p>' + nubeHtml() + '</div>';
    segWire('pkNot', function (v) { S.cfg.latin = v === '1'; guardarCfg(); });
    on('pkMidi', 'click', function () { conectarMidi(q('#pkMidi')); });
    if (S.midi) q('#pkMidi').setAttribute('aria-pressed', 'true');
    if (pendiente) on('pkSeguir', 'click', function () { S.ctx.navigate(rutaLec(pendiente)); });
  }

  /* ---------- lección ---------- */
  function abrirLeccion(u, lec) {
    S.uni = u; S.lec = lec; S.onKey = null; S.st = {}; S.ciclo = null; parar();
    var p = avance(), ls = u.lecciones, idx = ls.indexOf(lec), reg = regLec(lec), sig = siguienteLec(lec);
    S.view.innerHTML =
      '<div class="pk-scope pk-lay">' +
      '<aside class="pk-side"><button class="back" id="pkBack">← Piano</button>' +
      '<div class="panel-title">Unidad ' + (UNIDADES.indexOf(u) + 1) + ' · ' + esc(u.nom) + '</div>' +
      '<ol class="pk-lecs">' + ls.map(function (l) {
        var r = p[l.id];
        return '<li><a href="#/' + rutaLec(l) + '" class="pk-lec' + (r && r.hecha ? ' hecha' : '') + (l === lec ? ' actual' : '') + '"><span class="pk-check">' + (r && r.hecha ? '✓' : '') + '</span>' + esc(l.nom) + '</a></li>';
      }).join('') + '</ol>' +
      '<div class="pk-side-nav">' + (idx > 0 ? '<a class="mini-app-btn" href="#/' + rutaLec(ls[idx - 1]) + '">← Anterior</a>' : '') + (sig ? '<a class="mini-app-btn" href="#/' + rutaLec(sig) + '">Siguiente →</a>' : '') + '</div>' +
      '</aside>' +
      '<main class="pk-main">' +
      '<div class="rep-head"><div><p class="pk-crumb">Lección ' + (idx + 1) + ' de ' + ls.length + '</p><h1>' + esc(lec.nom) + '</h1></div>' +
      '<label class="check pk-hecha" title="Se marca sola al cumplir la meta; también puedes marcarla o desmarcarla a mano"><input type="checkbox" id="pkHecha"' + (reg.hecha ? ' checked' : '') + '> Completada</label></div>' +
      '<div class="pk-txt">' + lec.txt + '</div>' +
      '<section class="pk-ej"><div class="pk-ej-head"><span class="panel-title">Ejercicio</span><span class="pk-meta" id="pkMeta"></span></div><div class="pk-bar"><span id="pkBarra"></span></div>' +
      '<div id="pkEjCuerpo"></div>' + qwAyudaHtml() + '</section>' +
      (u.explorar ? '<section class="pk-explorar"><div class="pk-ej-head"><span class="panel-title">Explorar</span><button class="mini-app-btn" id="pkExpBtn" aria-expanded="false">Mostrar</button></div><div id="pkExp" hidden></div></section>' : '') +
      '<p class="set-status" id="pkAviso"></p>' +
      '</main></div>';
    on('pkBack', 'click', function () { S.ctx.navigate('piano'); });
    on('pkHecha', 'change', function () { marcarHecha(lec, this.checked); pintarMeta(); pintarLateral(); });
    if (u.explorar) {
      var exSt = Object.assign({}, lec.ex || {});
      on('pkExpBtn', 'click', function () {
        var box = q('#pkExp'), abierto = !box.hidden;
        box.hidden = abierto; this.textContent = abierto ? 'Mostrar' : 'Ocultar'; this.setAttribute('aria-expanded', String(!abierto));
        if (!abierto && !box.innerHTML) u.explorar(box, exSt);
        if (abierto) parar();
      });
    }
    // marco del ejercicio: cuenta aciertos limpios hacia la meta
    var fallosConsigna = 0, falloAnotado = false;
    function pintarMeta() {
      var r = regLec(lec), el = q('#pkMeta'), b = q('#pkBarra');
      if (!el) return;
      el.textContent = (r.hecha ? 'Completada · ' : '') + Math.min(r.ok, lec.meta) + ' / ' + lec.meta + ' aciertos' + (r.n ? ' · ' + r.ok + ' de ' + r.n + ' intentos bien' : '');
      b.style.width = Math.min(100, Math.round(100 * r.ok / lec.meta)) + '%';
      var ch = q('#pkHecha'); if (ch) ch.checked = r.hecha;
    }
    function pintarLateral() {
      var p2 = avance();
      S.view.querySelectorAll('.pk-side .pk-lec').forEach(function (a, i) {
        var r = p2[ls[i].id], hecha = r && r.hecha;
        a.classList.toggle('hecha', !!hecha); a.querySelector('.pk-check').textContent = hecha ? '✓' : '';
      });
    }
    var ctlEj = {
      nueva: function () { fallosConsigna = 0; falloAnotado = false; },
      fallos: function () { return fallosConsigna; },
      ok: function () {
        if (falloAnotado) { pintarMeta(); return; }   // la consigna ya contó como fallo
        var r = anotar(lec, true); pintarMeta(); pintarLateral();
        if (r.recien) celebrar();
      },
      mal: function () {
        fallosConsigna++;
        if (!falloAnotado) { falloAnotado = true; anotar(lec, false); pintarMeta(); }
      }
    };
    function celebrar() {
      aviso('Lección completada. ' + (sig ? 'Sigue con «' + sig.nom + '» cuando quieras.' : '¡Terminaste todas las lecciones!'));
      var c = ac(); if (c) { var t = c.currentTime; [60, 64, 67, 72].forEach(function (m, i) { tocar(m, t + i * 0.08, 1.2, 0.5); }); }
      var nav = q('.pk-side-nav');
      if (sig && nav && !q('#pkSig')) nav.insertAdjacentHTML('beforeend', '<a class="pr-play pk-go" id="pkSig" href="#/' + rutaLec(sig) + '">Siguiente lección</a>');
    }
    pintarMeta(); wireQw();
    lec.ej(q('#pkEjCuerpo'), ctlEj, lec);
  }

  /* ================= montaje ================= */
  function teclaEspacio(e) {
    if (e.code !== 'Space' || !S.onKey || !S.lec || S.lec.uni.id !== 'ritmica') return;
    if (/INPUT|SELECT|TEXTAREA|BUTTON/.test((e.target && e.target.tagName) || '')) return;
    e.preventDefault();
    S.onKey(0, 'espacio');
  }
  function mount(view, rest, ctx) {
    S.view = view; S.ctx = ctx;
    if (!S.cfg) S.cfg = cargarCfg();
    if (SB.pianoSonido) SB.pianoSonido.cargar();   // las muestras empiezan a bajar al entrar
    if (!S.espacio) {
      S.espacio = true;
      document.addEventListener('keydown', teclaEspacio);
      document.addEventListener('keydown', teclaAbajo, true);
      document.addEventListener('keyup', teclaArriba, true);
    }
    var partes = String(rest || '').split('/'), u = unidad(partes[0]);
    if (partes[0] === 'practica') {
      var ru = partes[1] === 'rutina' && rutina(partes[2]);
      if (ru) {
        var k = Math.max(0, Math.min(ru.pasos.length - 1, +partes[3] || 0)), paso = ru.pasos[k];
        abrirPractica(practica(paso[0]), paso[1], { r: ru, k: k });
        return;
      }
      var it = practica(partes[1]);
      if (it) abrirPractica(it, it.n); else portadaPractica();
      return;
    }
    if (!u) { portada(); return; }
    var lec = leccion(u, partes[1]) || u.lecciones[0];
    abrirLeccion(u, lec);
  }
  // llegó progreso de otro navegador: se redibujan las portadas (no un ejercicio en curso)
  window.addEventListener('sb:nube', function () {
    if (!S.view || !S.ctx || !document.body.contains(S.view)) return;
    var h = location.hash.replace(/^#\/?/, '');
    if (h === 'piano' || h === 'piano/' || h === 'piano/practica') mount(S.view, h.slice(6), S.ctx);
  });
  function onLeave() { parar(); S.onKey = null; S.lec = null; S.ciclo = null; }

  // gancho mínimo de inspección (para probar sin exponer todo)
  SB.piano = {
    estado: function () { return { st: S.st, lec: S.lec && S.lec.id, t: S.ac && S.ac.currentTime }; },
    unidades: function () { return UNIDADES.map(function (u) { return { id: u.id, lecciones: u.lecciones.map(function (l) { return l.id; }) }; }); }
  };

  SB.registry.register({ id: 'piano', name: 'Piano', kind: 'primary', mount: mount, onLeave: onLeave });
})();
