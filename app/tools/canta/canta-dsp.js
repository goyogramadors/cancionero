/* ============================================================
   Canta — DSP: velocidad (time-stretch WSOLA) + tono (remuestreo).
   Archivo de doble uso:
   - Como Worker: new Worker('tools/canta/canta-dsp.js') → procesa
     fuera del hilo de la interfaz (camino normal).
   - Como <script> clásico (respaldo para file://): expone
     SB.cantaDsp.processChannels().
   Sin dependencias.

   Matemática: para tempo τ (1 = normal, 2 = doble velocidad) y
   tono ρ = 2^(semitonos/12):
     1) WSOLA estira la señal por s = ρ/τ (mismo tono, otra duración).
     2) Remuestreo por ρ (sube el tono ρ y divide la duración por ρ).
   Resultado: duración D/τ y tono ×ρ, que es lo pedido.
   ============================================================ */
(function () {
  'use strict';
  var IS_WORKER = (typeof importScripts === 'function') && (typeof window === 'undefined');

  /* ---------- WSOLA multi-canal ----------
     Las decisiones de búsqueda se toman sobre la mezcla mono y se
     aplican idénticas a todos los canales (mantiene la fase estéreo). */
  function wsola(channels, stretch, sampleRate, onProgress) {
    var nCh = channels.length;
    var inLen = channels[0].length;
    var SEQ = 2 * Math.round(sampleRate * 0.050 / 2);   // secuencia ~50 ms
    var OVL = 2 * Math.round(sampleRate * 0.010 / 2);   // solape ~10 ms
    var SEEK = 2 * Math.round(sampleRate * 0.020 / 2);  // ventana de búsqueda ~20 ms
    var EMIT = SEQ - OVL;                               // muestras emitidas por vuelta
    var outLen = Math.floor(inLen * stretch);
    if (inLen < SEQ + SEEK) { // clip demasiado corto: devolver tal cual
      return channels.map(function (c) { return c.slice(); });
    }
    // mezcla mono para correlación
    var mix = new Float32Array(inLen);
    for (var c = 0; c < nCh; c++) {
      var ch = channels[c];
      for (var i = 0; i < inLen; i++) mix[i] += ch[i];
    }
    var outs = [];
    for (c = 0; c < nCh; c++) outs.push(new Float32Array(outLen));
    var tails = [];
    for (c = 0; c < nCh; c++) tails.push(new Float32Array(OVL));
    var tailMono = new Float32Array(OVL);

    var outPos = 0, ipNom = 0;
    var lastProg = 0;
    while (outPos < outLen) {
      // centro nominal de lectura; candidatos en [centro-SEEK/2, centro+SEEK/2)
      var base = Math.round(ipNom) - (SEEK >> 1);
      if (base < 0) base = 0;
      if (base > inLen - SEQ - SEEK) base = inLen - SEQ - SEEK;
      // búsqueda gruesa (paso 4, señal decimada ×2) y refinado ±4
      var best = 0, bestScore = -Infinity, o, sc;
      for (o = 0; o < SEEK; o += 4) {
        sc = xcorr(tailMono, mix, base + o, OVL, 2);
        if (sc > bestScore) { bestScore = sc; best = o; }
      }
      var lo = Math.max(0, best - 4), hi = Math.min(SEEK - 1, best + 4);
      bestScore = -Infinity;
      for (o = lo; o <= hi; o++) {
        sc = xcorr(tailMono, mix, base + o, OVL, 1);
        if (sc > bestScore) { bestScore = sc; best = o; }
      }
      var p = base + best;
      // emitir: solape con fundido cruzado + tramo directo
      var n = Math.min(EMIT, outLen - outPos);
      for (c = 0; c < nCh; c++) {
        var inC = channels[c], outC = outs[c], tC = tails[c];
        for (i = 0; i < n; i++) {
          if (i < OVL) {
            var w = i / OVL;
            outC[outPos + i] = tC[i] * (1 - w) + inC[p + i] * w;
          } else {
            outC[outPos + i] = inC[p + i];
          }
        }
        // cola siguiente: final de la secuencia elegida
        for (i = 0; i < OVL; i++) tC[i] = inC[p + EMIT + i];
      }
      for (i = 0; i < OVL; i++) tailMono[i] = mix[p + EMIT + i];
      outPos += n;
      ipNom += EMIT / stretch;
      if (ipNom > inLen - SEQ - SEEK) break;
      if (onProgress) {
        var prog = outPos / outLen;
        if (prog - lastProg > 0.04) { lastProg = prog; onProgress(prog); }
      }
    }
    // completar la cola (<250 ms) con copia directa del final, con fundido de
    // entrada corto, en vez de dejar silencio
    if (outPos < outLen) {
      var rest = outLen - outPos;
      var src = Math.max(0, Math.min(inLen - rest, Math.round(ipNom)));
      var FADE = Math.min(256, rest);
      for (c = 0; c < nCh; c++) {
        var inT = channels[c], outT = outs[c];
        for (i = 0; i < rest; i++) {
          var v2 = src + i < inLen ? inT[src + i] : 0;
          outT[outPos + i] = i < FADE ? v2 * (i / FADE) : v2;
        }
      }
    }
    return outs;
  }

  // correlación normalizada de tail contra x[at..at+len), con paso 'step'
  function xcorr(tail, x, at, len, step) {
    var num = 0, den = 0, i, v;
    for (i = 0; i < len; i += step) {
      v = x[at + i];
      num += tail[i] * v;
      den += v * v;
    }
    return num / Math.sqrt(den + 1e-9);
  }

  /* ---------- remuestreo Hermite (4 puntos) por factor ρ ---------- */
  function resample(channels, ratio) {
    if (Math.abs(ratio - 1) < 1e-6) return channels;
    var inLen = channels[0].length;
    var outLen = Math.floor(inLen / ratio);
    return channels.map(function (inC) {
      var outC = new Float32Array(outLen);
      for (var i = 0; i < outLen; i++) {
        var pos = i * ratio;
        var i1 = Math.floor(pos), f = pos - i1;
        var i0 = i1 > 0 ? i1 - 1 : 0;
        var i2 = i1 + 1 < inLen ? i1 + 1 : inLen - 1;
        var i3 = i1 + 2 < inLen ? i1 + 2 : inLen - 1;
        var y0 = inC[i0], y1 = inC[i1], y2 = inC[i2], y3 = inC[i3];
        outC[i] = y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
      }
      return outC;
    });
  }

  /* ---------- proceso completo de un stem ---------- */
  function processChannels(channels, sampleRate, tempo, semis, onProgress) {
    var rho = Math.pow(2, semis / 12);
    var stretch = rho / tempo;
    if (Math.abs(tempo - 1) < 1e-6 && semis === 0) {
      return channels.map(function (c) { return c.slice(); });
    }
    var stretched = Math.abs(stretch - 1) < 1e-6
      ? channels
      : wsola(channels, stretch, sampleRate, onProgress);
    if (onProgress) onProgress(0.92);
    return resample(stretched, rho);
  }

  if (IS_WORKER) {
    self.onmessage = function (e) {
      var m = e.data;
      if (!m || m.cmd !== 'process') return;
      try {
        var out = processChannels(m.channels, m.sampleRate, m.tempo, m.semis, function (p) {
          self.postMessage({ id: m.id, progress: p });
        });
        self.postMessage({ id: m.id, done: true, channels: out },
          out.map(function (c) { return c.buffer; }));
      } catch (err) {
        self.postMessage({ id: m.id, error: String(err && err.message || err) });
      }
    };
  } else {
    window.SB = window.SB || {};
    SB.cantaDsp = { processChannels: processChannels };
  }
})();
