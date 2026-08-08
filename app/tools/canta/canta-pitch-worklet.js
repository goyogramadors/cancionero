/* ============================================================
   Canta — AudioWorklet de detección de pitch (voz del usuario).
   Corre en el hilo de audio: decima la señal ×3 (48 kHz → 16 kHz),
   acumula ventanas de 1024 muestras y calcula YIN (CMNDF) con
   interpolación parabólica. Publica {t, f0, clarity, rms} cada
   ~16 ms; la estabilización fina se hace en canta-pitch.js.
   Nota: hay una copia funcionalmente idéntica de YIN en
   canta-pitch.js para el respaldo con ScriptProcessor (los
   AudioWorklet no pueden compartir archivos sin módulos ES).
   ============================================================ */
class CantaPitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.srEff = sampleRate / 3;          // tasa efectiva tras decimar ×3
    this.W = 1024;                        // ventana (~64 ms a 16 kHz)
    this.HOP = 256;                       // salto (~16 ms)
    this.buf = new Float32Array(this.W);  // ventana deslizante
    this.filled = 0;
    this.hopBuf = new Float32Array(this.HOP); // muestras nuevas hasta completar un salto
    this.hopFill = 0;
    this.acc = 0; this.accN = 0;          // acumulador de decimación
    this.tauMin = Math.max(2, Math.floor(this.srEff / 1000)); // 1000 Hz
    this.tauMax = Math.floor(this.srEff / 65);                // 65 Hz
    this.d = new Float32Array(this.tauMax + 1);
    this.work = new Float32Array(this.W);
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.accN++;
      if (this.accN === 3) {              // promedio de 3 = filtro + decimación
        const s = this.acc / 3;
        this.acc = 0; this.accN = 0;
        this.push(s);
      }
    }
    return true;
  }

  push(s) {
    const W = this.W, buf = this.buf, HOP = this.HOP;
    if (this.filled < W) {
      buf[this.filled++] = s;
      if (this.filled === W) this.analyze();
      return;
    }
    this.hopBuf[this.hopFill++] = s;
    if (this.hopFill === HOP) {           // desplazar en bloque, una vez por salto
      buf.copyWithin(0, HOP);
      buf.set(this.hopBuf, W - HOP);
      this.hopFill = 0;
      this.analyze();
    }
  }

  analyze() {
    const x = this.buf, W = this.W, tauMax = this.tauMax, tauMin = this.tauMin;
    const N = W - tauMax;                 // largo de integración fijo
    let rms = 0;
    for (let i = 0; i < W; i++) rms += x[i] * x[i];
    rms = Math.sqrt(rms / W);
    if (rms < 0.003) {                    // silencio evidente: ni calcular
      this.port.postMessage({ t: currentTime, f0: 0, clarity: 0, rms });
      return;
    }
    const d = this.d;
    d[0] = 0;
    let running = 0;
    let tauBest = -1, valBest = 1e9;
    let cm = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let i = 0; i < N; i++) {
        const diff = x[i] - x[i + tau];
        sum += diff * diff;
      }
      running += sum;
      cm = sum * tau / (running || 1e-12); // CMNDF
      d[tau] = cm;
      if (tau >= tauMin) {
        if (cm < valBest) { valBest = cm; tauBest = tau; }
        // primer mínimo bajo el umbral: bajar hasta el valle y cortar
        if (cm < 0.15 && tau + 1 <= tauMax) {
          let t2 = tau;
          // seguir mientras siga bajando
          while (t2 + 1 <= tauMax) {
            let sum2 = 0;
            for (let i = 0; i < N; i++) {
              const df = x[i] - x[i + t2 + 1];
              sum2 += df * df;
            }
            running += sum2;
            const cm2 = sum2 * (t2 + 1) / running;
            d[t2 + 1] = cm2;
            if (cm2 < d[t2]) t2++; else break;
          }
          tauBest = t2; valBest = d[t2];
          break;
        }
      }
    }
    if (tauBest < 0) {
      this.port.postMessage({ t: currentTime, f0: 0, clarity: 0, rms });
      return;
    }
    // interpolación parabólica alrededor del mínimo
    let tau = tauBest;
    if (tau > tauMin && tau < tauMax) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const denom = a + c - 2 * b;
      if (Math.abs(denom) > 1e-12) tau += 0.5 * (a - c) / denom;
    }
    const f0 = this.srEff / tau;
    const clarity = Math.max(0, Math.min(1, 1 - valBest));
    this.port.postMessage({ t: currentTime, f0, clarity, rms });
  }
}
registerProcessor('canta-pitch', CantaPitchProcessor);
