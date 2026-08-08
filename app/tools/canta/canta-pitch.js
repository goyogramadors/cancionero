/* ============================================================
   Canta — captura de la voz del usuario y estabilización del pitch.
   window.SB.cantaPitch

   Camino normal: getUserMedia (sin procesamiento de voz del
   navegador) → AudioWorklet (canta-pitch-worklet.js) que publica
   {t, f0, clarity, rms} crudos. Respaldo sin worklet: ScriptProcessor
   con el mismo YIN acá.

   Estabilización (para que el indicador no "se vuelva loco"):
   - compuerta de ruido adaptativa (piso de ruido medido × margen)
   - exigencia de claridad YIN mínima y 2 cuadros seguidos con voz
   - filtro de mediana (5) + suavizado exponencial
   - corrección de saltos de octava espurios
   - retención breve (150 ms) al cortarse la voz, para no parpadear

   Modo prueba: genera el pitch desde una función (la melodía de la
   canción) sin usar micrófono; sirve para probar la interfaz.
   ============================================================ */
(function () {
  window.SB = window.SB || {};

  var St = {
    ctx: null, stream: null, srcNode: null, node: null, sink: null,
    onSample: null, mode: null, timer: null,
    // estabilizador
    hist: [],           // últimos midi crudos con voz [{t,m}]
    lastOut: null,      // {t, m} último valor entregado
    voicedRun: 0,
    noiseFloor: 0.002,
    jump: null,         // salto grande pendiente de confirmación
    startSeq: 0,        // invalida un start() en curso cuando llega stop()
    testFn: null
  };

  /* ---------- estabilizador ---------- */
  function resetStab() { St.hist = []; St.lastOut = null; St.voicedRun = 0; St.jump = null; }

  function stabilize(raw) {
    var now = raw.t;
    // piso de ruido: baja rápido, y solo SUBE con cuadros sin voz clara —
    // una nota sostenida larga no debe levantar el piso hasta enmudecerse sola
    if (raw.rms < St.noiseFloor) St.noiseFloor = St.noiseFloor * 0.7 + raw.rms * 0.3;
    else if (raw.clarity < 0.5) St.noiseFloor = St.noiseFloor * 0.995 + raw.rms * 0.005;
    var gate = Math.max(0.006, St.noiseFloor * 3.5);
    var voiced = raw.f0 >= 60 && raw.f0 <= 1100 && raw.clarity >= 0.72 && raw.rms >= gate;

    if (!voiced) {
      St.voicedRun = 0;
      // retención breve para no parpadear
      if (St.lastOut && now - St.lastOut.t < 0.15) return { t: now, midi: St.lastOut.m, held: true };
      St.hist = [];
      return { t: now, midi: null };
    }

    var m = 69 + 12 * Math.log2(raw.f0 / 440);
    // corrección de salto de octava espurio (continuidad)
    if (St.lastOut && now - St.lastOut.t < 0.25) {
      var d = m - St.lastOut.m;
      if (d > 11 && d < 13) m -= 12;
      else if (d < -11 && d > -13) m += 12;
    }
    // confirmación de saltos grandes: una espiga de un solo cuadro no pasa;
    // un salto real de nota se confirma con 2 cuadros seguidos coherentes
    if (St.lastOut && now - St.lastOut.t < 0.25 && Math.abs(m - St.lastOut.m) > 2.5) {
      if (St.jump && now - St.jump.t < 0.12 && Math.abs(m - St.jump.m) < 1.2) {
        // confirmado: aceptar el salto y partir limpio desde aquí
        St.jump = null;
        St.hist = [{ t: now, m: m }];
        St.lastOut = { t: now, m: m };
        return { t: now, midi: m };
      }
      St.jump = { t: now, m: m };
      return { t: now, midi: St.lastOut.m, held: true };
    }
    St.jump = null;
    St.voicedRun++;
    St.hist.push({ t: now, m: m });
    while (St.hist.length > 5) St.hist.shift();
    if (St.voicedRun < 2) {
      // aún no confirmamos que es voz: mantener lo anterior si está fresco
      if (St.lastOut && now - St.lastOut.t < 0.15) return { t: now, midi: St.lastOut.m, held: true };
      return { t: now, midi: null };
    }
    // mediana de la ventana
    var vals = St.hist.map(function (h) { return h.m; }).sort(function (a, b) { return a - b; });
    var med = vals[vals.length >> 1];
    // suavizado exponencial hacia la mediana
    var out = (St.lastOut && now - St.lastOut.t < 0.2)
      ? St.lastOut.m + 0.45 * (med - St.lastOut.m)
      : med;
    St.lastOut = { t: now, m: out };
    return { t: now, midi: out };
  }

  function emit(raw) {
    if (!St.onSample) return;
    St.onSample(stabilize(raw), raw);
  }

  /* ---------- YIN de respaldo (ScriptProcessor), igual al worklet ---------- */
  function Analyzer(srEff) {
    this.srEff = srEff; this.W = 1024; this.HOP = 256;
    this.buf = new Float32Array(this.W); this.filled = 0;
    this.hopBuf = new Float32Array(this.HOP); this.hopFill = 0;
    this.acc = 0; this.accN = 0;
    this.tauMin = Math.max(2, Math.floor(srEff / 1000));
    this.tauMax = Math.floor(srEff / 65);
    this.d = new Float32Array(this.tauMax + 1);
    this.onFrame = null;
  }
  Analyzer.prototype.feed = function (samples) {
    for (var i = 0; i < samples.length; i++) {
      this.acc += samples[i];
      if (++this.accN === 3) {
        var s = this.acc / 3; this.acc = 0; this.accN = 0;
        this.push(s);
      }
    }
  };
  Analyzer.prototype.push = function (s) {
    var W = this.W, HOP = this.HOP;
    if (this.filled < W) {
      this.buf[this.filled++] = s;
      if (this.filled === W) this.analyze();
      return;
    }
    this.hopBuf[this.hopFill++] = s;
    if (this.hopFill === HOP) {
      this.buf.copyWithin(0, HOP);
      this.buf.set(this.hopBuf, W - HOP);
      this.hopFill = 0;
      this.analyze();
    }
  };
  Analyzer.prototype.analyze = function () {
    var x = this.buf, W = this.W, tauMax = this.tauMax, tauMin = this.tauMin;
    var N = W - tauMax, i, rms = 0;
    for (i = 0; i < W; i++) rms += x[i] * x[i];
    rms = Math.sqrt(rms / W);
    if (rms < 0.003) { this.onFrame({ f0: 0, clarity: 0, rms: rms }); return; }
    var d = this.d, running = 0, tauBest = -1, valBest = 1e9;
    for (var tau = 1; tau <= tauMax; tau++) {
      var sum = 0;
      for (i = 0; i < N; i++) { var df = x[i] - x[i + tau]; sum += df * df; }
      running += sum;
      var cm = sum * tau / (running || 1e-12);
      d[tau] = cm;
      if (tau >= tauMin) {
        if (cm < valBest) { valBest = cm; tauBest = tau; }
        if (cm < 0.15 && tau + 1 <= tauMax) {
          var t2 = tau;
          while (t2 + 1 <= tauMax) {
            var sum2 = 0;
            for (i = 0; i < N; i++) { var d2 = x[i] - x[i + t2 + 1]; sum2 += d2 * d2; }
            running += sum2;
            var cm2 = sum2 * (t2 + 1) / running;
            d[t2 + 1] = cm2;
            if (cm2 < d[t2]) t2++; else break;
          }
          tauBest = t2; valBest = d[t2];
          break;
        }
      }
    }
    if (tauBest < 0) { this.onFrame({ f0: 0, clarity: 0, rms: rms }); return; }
    var tf = tauBest;
    if (tauBest > tauMin && tauBest < tauMax) {
      var a = d[tauBest - 1], b = d[tauBest], c = d[tauBest + 1];
      var den = a + c - 2 * b;
      if (Math.abs(den) > 1e-12) tf += 0.5 * (a - c) / den;
    }
    this.onFrame({ f0: this.srEff / tf, clarity: Math.max(0, Math.min(1, 1 - valBest)), rms: rms });
  };

  /* ---------- API ---------- */
  SB.cantaPitch = {
    // mode: 'mic' | 'test'. onSample(estable, crudo) — estable = {t, midi|null}
    async start(audioCtx, mode, onSample) {
      this.stop();
      var seq = ++St.startSeq; // si stop() corre durante los await, abortamos
      St.ctx = audioCtx; St.onSample = onSample; St.mode = mode;
      resetStab();
      if (mode === 'test') {
        St.timer = setInterval(function () {
          var t = audioCtx.currentTime;
          var m = St.testFn ? St.testFn(t) : null;
          if (St.onSample) St.onSample({ t: t, midi: m }, null);
        }, 20);
        return;
      }
      // micrófono: cancelación de eco SÍ (resta lo que suena por el parlante,
      // si no la app "se escucha a sí misma"); supresión de ruido y ganancia
      // automática NO (deforman el canto)
      var stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
      });
      if (seq !== St.startSeq) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      St.stream = stream;
      St.srcNode = audioCtx.createMediaStreamSource(St.stream);
      St.sink = audioCtx.createGain(); St.sink.gain.value = 0; // no reproducir el mic
      St.sink.connect(audioCtx.destination);
      var ok = false;
      if (audioCtx.audioWorklet) {
        try {
          await audioCtx.audioWorklet.addModule('tools/canta/canta-pitch-worklet.js');
          St.node = new AudioWorkletNode(audioCtx, 'canta-pitch');
          St.node.port.onmessage = function (e) { emit(e.data); };
          ok = true;
        } catch (e) { /* cae al respaldo */ }
      }
      if (seq !== St.startSeq) return; // nos detuvieron durante el addModule
      if (!ok) {
        var an = new Analyzer(audioCtx.sampleRate / 3);
        an.onFrame = function (f) { f.t = audioCtx.currentTime; emit(f); };
        St.node = audioCtx.createScriptProcessor(2048, 1, 1);
        St.node.onaudioprocess = function (e) { an.feed(e.inputBuffer.getChannelData(0)); };
      }
      St.srcNode.connect(St.node);
      St.node.connect(St.sink);
    },

    setTestMelody(fn) { St.testFn = fn; },

    stop() {
      St.startSeq++;
      if (St.timer) { clearInterval(St.timer); St.timer = null; }
      if (St.node) { try { St.node.disconnect(); } catch (e) {} St.node = null; }
      if (St.srcNode) { try { St.srcNode.disconnect(); } catch (e) {} St.srcNode = null; }
      if (St.sink) { try { St.sink.disconnect(); } catch (e) {} St.sink = null; }
      if (St.stream) { St.stream.getTracks().forEach(function (t) { t.stop(); }); St.stream = null; }
      St.onSample = null; St.mode = null;
      resetStab();
    },

    active() { return !!(St.timer || St.node); }
  };
})();
