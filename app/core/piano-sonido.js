/* ============================================================
   Núcleo: sonido de piano (el mismo motor del piano de Go.io).
   Muestras reales del Salamander Grand Piano (Alexander Holm, CC BY 3.0,
   servidas por el CDN de Tone.js) con una sala suave de reverberación.
   Mientras las muestras no llegan, o sin internet, suena una cuerda
   simulada (Karplus-Strong). El service worker guarda las muestras para
   que después funcione sin conexión.

   API (SB.pianoSonido):
     ctx()                        → AudioContext (lo crea y lo reanuda)
     salida()                     → nodo al que conectar otros sonidos
     cargar()                     → empieza a bajar las muestras
     tocar(midi, cuando, dur, vel)→ nota con duración fija (programable)
     apretar(midi, vel) → id      → nota que suena hasta soltar(id)
     soltar(id)
     estado() → {muestras, total}
   ============================================================ */
(function () {
  window.SB = window.SB || {};

  var ANCLAS = [
    { midi: 21, f: 'A0.mp3' }, { midi: 24, f: 'C1.mp3' }, { midi: 30, f: 'Fs1.mp3' },
    { midi: 33, f: 'A1.mp3' }, { midi: 36, f: 'C2.mp3' }, { midi: 39, f: 'Ds2.mp3' },
    { midi: 42, f: 'Fs2.mp3' },
    { midi: 45, f: 'A2.mp3' }, { midi: 48, f: 'C3.mp3' }, { midi: 51, f: 'Ds3.mp3' },
    { midi: 54, f: 'Fs3.mp3' }, { midi: 57, f: 'A3.mp3' }, { midi: 60, f: 'C4.mp3' },
    { midi: 63, f: 'Ds4.mp3' }, { midi: 66, f: 'Fs4.mp3' }, { midi: 69, f: 'A4.mp3' },
    { midi: 72, f: 'C5.mp3' }, { midi: 75, f: 'Ds5.mp3' }, { midi: 78, f: 'Fs5.mp3' },
    { midi: 81, f: 'A5.mp3' }, { midi: 84, f: 'C6.mp3' }
  ];
  var CDN = 'https://cdn.jsdelivr.net/gh/Tonejs/tonejs.github.io@master/audio/salamander/';
  var CDN2 = 'https://tonejs.github.io/audio/salamander/';

  var A = { ctx: null, seco: null, rev: null, salida: null, muestras: new Map(), crudas: new Map(), ks: new Map(), pedidas: false, voces: new Map(), sec: 0 };

  function ctx() {
    if (!A.ctx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      var c = A.ctx = new C(), t = c.currentTime;
      var comp = c.createDynamicsCompressor();
      comp.threshold.setValueAtTime(-12, t); comp.knee.setValueAtTime(14, t); comp.ratio.setValueAtTime(3, t);
      comp.attack.setValueAtTime(0.003, t); comp.release.setValueAtTime(0.22, t);
      var master = c.createGain(); master.gain.setValueAtTime(0.9, t);
      A.seco = c.createGain(); A.seco.gain.setValueAtTime(0.88, t);
      A.rev = c.createGain(); A.rev.gain.setValueAtTime(0.18, t);
      var sala = sala_(c, 2.2, 3.4);
      A.seco.connect(comp); A.rev.connect(sala); sala.connect(comp);
      comp.connect(master); master.connect(c.destination);
      A.salida = comp;
      A.crudas.forEach(function (buf, midi) { decodificar(midi, buf); });
      A.crudas.clear();
    }
    if (A.ctx.state === 'suspended' && A.ctx.resume) { try { A.ctx.resume(); } catch (e) {} }
    return A.ctx;
  }
  function sala_(c, dur, caida) {
    var n = Math.floor(c.sampleRate * dur), b = c.createBuffer(2, n, c.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch), lp = 0;
      for (var i = 0; i < n; i++) { lp = lp * 0.76 + (Math.random() * 2 - 1) * Math.pow(1 - i / n, caida) * 0.24; d[i] = lp; }
    }
    var conv = c.createConvolver(); conv.buffer = b; return conv;
  }

  /* ---------- muestras ---------- */
  function bajar(f) {
    function uno(u) { return fetch(u, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }); }
    return uno(CDN + f).catch(function () { return uno(CDN2 + f); });
  }
  function decodificar(midi, buf) {
    var c = A.ctx;
    var listo = function (b) { A.muestras.set(midi, b); };
    try {
      var p = c.decodeAudioData(buf.slice(0), listo, function () {});
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }
  function cargar() {
    if (A.pedidas || !window.fetch) return;
    A.pedidas = true;
    // primero las del registro que más se usa
    ANCLAS.slice().sort(function (a, b) { return Math.abs(a.midi - 60) - Math.abs(b.midi - 60); }).forEach(function (an) {
      bajar(an.f).then(function (buf) {
        if (A.ctx) decodificar(an.midi, buf); else A.crudas.set(an.midi, buf);
      }).catch(function () {});
    });
  }
  function cercana(midi) {
    var mejor = null, dist = 1e9;
    A.muestras.forEach(function (b, m) { var d = Math.abs(midi - m); if (d < dist) { dist = d; mejor = m; } });
    return mejor == null ? null : { buf: A.muestras.get(mejor), rate: Math.pow(2, (midi - mejor) / 12) };
  }
  // cuerda simulada mientras no hay muestras
  function cuerda(midi) {
    if (A.ks.has(midi)) return A.ks.get(midi);
    var c = A.ctx, sr = c.sampleRate, n = Math.floor(sr * 2.4), b = c.createBuffer(2, n, sr);
    var L = b.getChannelData(0), R = b.getChannelData(1), f0 = 440 * Math.pow(2, (midi - 69) / 12);
    var det = [1, 0.9993, 1.00075], pl = [0.36, 0.44, 0.2], pr = [0.36, 0.2, 0.44];
    for (var s = 0; s < 3; s++) {
      var fr = f0 * det[s], len = Math.max(8, Math.round(sr / fr)), dl = new Float32Array(len), prev = 0;
      for (var i = 0; i < len; i++) { prev = prev * 0.68 + (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len) * 0.32; dl[i] = prev * 0.65; }
      var ptr = 0, lp = 0, fb = Math.pow(0.001, 1 / (fr * 3.1));
      for (var j = 0; j < n; j++) {
        var cur = dl[ptr], nx = (ptr + 1) % len;
        lp = lp * 0.18 + (cur + dl[nx]) * 0.5 * 0.82;
        dl[ptr] = lp * fb; ptr = nx;
        L[j] += cur * pl[s]; R[j] += cur * pr[s];
      }
    }
    A.ks.set(midi, b);
    return b;
  }

  /* ---------- voces ---------- */
  function voz(midi, cuando, vel) {
    var c = ctx(); if (!c) return null;
    cuando = Math.max(cuando || 0, c.currentTime);
    var src = c.createBufferSource(), m = cercana(midi);
    if (m) { src.buffer = m.buf; src.playbackRate.setValueAtTime(m.rate, cuando); }
    else src.buffer = cuerda(midi);
    var g = c.createGain(), v = (vel == null ? 0.6 : vel) * 1.5;
    g.gain.setValueAtTime(v, cuando);
    src.connect(g); g.connect(A.seco); g.connect(A.rev);
    src.start(cuando);
    return { src: src, g: g };
  }
  function cortar(v, cuando, rel) {
    try {
      var actual = v.g.gain.value || 0.5;
      v.g.gain.cancelScheduledValues(cuando);
      v.g.gain.setValueAtTime(actual, cuando);
      v.g.gain.setTargetAtTime(0.0001, cuando, rel / 4);
      v.src.stop(cuando + rel + 0.05);
    } catch (e) {}
  }
  function tocar(midi, cuando, dur, vel) {
    var c = ctx(); if (!c) return;
    cuando = cuando || c.currentTime; dur = dur || 1.4;
    var v = voz(midi, cuando, vel); if (!v) return;
    // la nota decae sola; al terminar "dur" se suelta con un apagado corto
    var fin = cuando + dur;
    v.g.gain.setValueAtTime((vel == null ? 0.6 : vel) * 1.5, fin);
    v.g.gain.setTargetAtTime(0.0001, fin, 0.08);
    v.src.stop(fin + 0.5);
  }
  function apretar(midi, vel) {
    var v = voz(midi, 0, vel); if (!v) return null;
    var id = ++A.sec; A.voces.set(id, v); return id;
  }
  function soltar(id) {
    var v = A.voces.get(id); if (!v) return;
    A.voces.delete(id);
    cortar(v, A.ctx.currentTime, 0.35);
  }

  SB.pianoSonido = {
    ctx: ctx, salida: function () { ctx(); return A.salida; }, cargar: cargar,
    tocar: tocar, apretar: apretar, soltar: soltar,
    estado: function () { return { muestras: A.muestras.size, total: ANCLAS.length }; }
  };
})();
