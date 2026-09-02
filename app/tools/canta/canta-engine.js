/* ============================================================
   Canta — motor de audio y paquetes. window.SB.cantaEngine

   Un "paquete Canta" es una carpeta con canta.json + vocals.m4a +
   music.m4a (lo produce canta-prep/, ver README). Fuentes de carga:
   - Servidor local: app/canta-media/index.json (cuando corres con
     python -m http.server; la carpeta va gitignoreada).
   - Carpeta elegida por el usuario (File System Access API o
     <input webkitdirectory> de respaldo) → se guarda en IndexedDB
     para las próximas veces (funciona también en la PWA publicada).
   - Demo sintética generada al vuelo (sin archivos).

   Transporte: dos pistas (voz / música) con ganancia independiente.
   Tono y velocidad se pre-renderizan con el Worker DSP (WSOLA +
   remuestreo) y se cachea solo el render vigente (los buffers son
   grandes). Posiciones SIEMPRE en segundos de la canción original;
   el audio renderizado dura D/tempo y se convierte al vuelo.
   ============================================================ */
(function () {
  window.SB = window.SB || {};

  var St = {
    ctx: null,
    pkg: null,            // canta.json del paquete cargado
    buffers: null,        // {vocals, music} AudioBuffer originales
    rendered: null,       // {key, vocals, music} render vigente
    tempo: 1, semis: 0,
    vols: { vocals: 0.6, music: 1.0, mine: 1.0 },
    mine: null,           // AudioBuffer de la toma cargada (o null)
    mineOff: 0,           // s: corrimiento por la latencia de captura
    gains: null, srcs: null,
    playing: false, t0: 0, posPaused: 0,
    onEnded: null,
    worker: null, renderToken: 0
  };

  function ctx() {
    if (!St.ctx) St.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (St.ctx.state === 'suspended') St.ctx.resume();
    return St.ctx;
  }

  /* ================= IndexedDB ================= */
  function idb() {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open('canta-db', 2);
      rq.onupgradeneeded = function (e) {
        var db = rq.result;
        if (!db.objectStoreNames.contains('packages')) db.createObjectStore('packages', { keyPath: 'id' });
        // tomas: cada vez que cantas queda una grabación con su curva de tono
        if (!db.objectStoreNames.contains('takes')) {
          var st = db.createObjectStore('takes', { keyPath: 'id' });
          st.createIndex('porCancion', 'songId', { unique: false });
        }
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function idbPut(rec) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('packages', 'readwrite');
        tx.objectStore('packages').put(rec);
        tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function idbGet(id) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var rq = db.transaction('packages').objectStore('packages').get(id);
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }
  function idbAll() {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var rq = db.transaction('packages').objectStore('packages').getAll();
        rq.onsuccess = function () { res(rq.result || []); };
        rq.onerror = function () { rej(rq.error); };
      });
    }).catch(function () { return []; });
  }
  function idbDelete(id) {
    return idb().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction('packages', 'readwrite');
        tx.objectStore('packages').delete(id);
        tx.oncomplete = res; tx.onerror = res;
      });
    });
  }

  /* ============ tomas (lo que cantó el usuario) ============ */
  // Una toma guarda el audio del micrófono MAS la curva de tono y los
  // parametros con que se grabo. El tempo/tono importan: la voz se grabo
  // encima del render vigente, asi que solo calza con esos mismos valores.
  function takePut(rec) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('takes', 'readwrite');
        tx.objectStore('takes').put(rec);
        tx.oncomplete = function () { res(rec); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function takeList(songId) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var rq = db.transaction('takes').objectStore('takes').getAll();
        rq.onsuccess = function () {
          var all = rq.result || [];
          if (songId) all = all.filter(function (r) { return r.songId === songId; });
          all.sort(function (a, b) { return b.fecha - a.fecha; });
          res(all.map(function (r) {
            return { id: r.id, songId: r.songId, fecha: r.fecha, dur: r.dur,
                     tempo: r.tempo, semis: r.semis, puntaje: r.puntaje, nombre: r.nombre };
          }));
        };
        rq.onerror = function () { rej(rq.error); };
      });
    }).catch(function () { return []; });
  }
  function takeGet(id) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var rq = db.transaction('takes').objectStore('takes').get(id);
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }
  function takeDelete(id) {
    return idb().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction('takes', 'readwrite');
        tx.objectStore('takes').delete(id);
        tx.oncomplete = res; tx.onerror = res;
      });
    });
  }

  /* ================= carga de paquetes ================= */
  async function decodeBlob(blob) {
    var ab = await blob.arrayBuffer();
    return await ctx().decodeAudioData(ab);
  }

  // Recompone una toma en el tiempo de la CANCION.
  //
  // El microfono graba de corrido, pero la cancion pudo pausarse o saltar
  // mientras tanto. Sin esto, los trozos quedan pegados uno tras otro y todo lo
  // que cantaste despues de la primera pausa suena corrido. Cada tramo se copia
  // en el punto de la cancion donde de verdad se canto, y lo que queda entre
  // medio es silencio.
  function alinearToma(buffer, tramos, duracion) {
    if (!tramos || !tramos.length) return buffer;
    var c = ctx(), sr = buffer.sampleRate;
    var fin = 0;
    for (var i = 0; i < tramos.length; i++) {
      fin = Math.max(fin, tramos[i].canc0 + (tramos[i].grab1 - tramos[i].grab0));
    }
    var largo = Math.ceil(Math.max(fin, duracion || 0) * sr);
    if (largo <= 0) return buffer;
    var out = c.createBuffer(buffer.numberOfChannels, largo, sr);
    for (var ch = 0; ch < buffer.numberOfChannels; ch++) {
      var src = buffer.getChannelData(ch), dst = out.getChannelData(ch);
      for (var k = 0; k < tramos.length; k++) {
        var t = tramos[k];
        var i0 = Math.max(0, Math.round(t.grab0 * sr));
        var i1 = Math.min(src.length, Math.round(t.grab1 * sr));
        var d0 = Math.round(t.canc0 * sr);
        var n = Math.min(i1 - i0, dst.length - d0);
        if (n > 0) dst.set(src.subarray(i0, i0 + n), d0);
      }
    }
    return out;
  }

  async function usePackage(json, vocalsBlob, musicBlob) {
    // decodificar ANTES de tocar el estado: si falla, la canción anterior queda intacta
    var v = await decodeBlob(vocalsBlob);
    var m = await decodeBlob(musicBlob);
    stop();
    prepSeq++; pendingResume = null; killWorker(); // invalida renders en vuelo
    St.pkg = json;
    St.buffers = { vocals: v, music: m };
    St.rendered = { key: '0|1', vocals: v, music: m };
    St.tempo = 1; St.semis = 0; St.posPaused = 0;
    return json;
  }

  // contrato mínimo de canta.json (antes de persistir o montar nada)
  function validPkg(json) {
    return !!(json && typeof json === 'object' && typeof json.id === 'string' && json.id &&
      typeof json.title === 'string' && json.files &&
      typeof json.files.vocals === 'string' && typeof json.files.music === 'string' &&
      Array.isArray(json.notes) && Array.isArray(json.lines) && typeof json.duration === 'number');
  }

  async function fetchServerList() {
    try {
      var r = await fetch('canta-media/index.json', { cache: 'no-cache' });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

  async function loadFromServer(id) {
    var base = 'canta-media/' + id + '/';
    var r = await fetch(base + 'canta.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('No se encontró el paquete "' + id + '" en canta-media/');
    var json = await r.json();
    if (!validPkg(json)) throw new Error('El canta.json del paquete "' + id + '" no respeta el contrato.');
    var [v, m] = await Promise.all([
      fetch(base + json.files.vocals).then(function (x) { return x.blob(); }),
      fetch(base + json.files.music).then(function (x) { return x.blob(); })
    ]);
    idbPut({ id: json.id, json: json, vocals: v, music: m, added: Date.now() }).catch(function () {});
    return usePackage(json, v, m);
  }

  async function loadSaved(id) {
    var rec = await idbGet(id);
    if (!rec) throw new Error('Paquete no guardado: ' + id);
    return usePackage(rec.json, rec.vocals, rec.music);
  }

  // files: lista de File con webkitRelativePath (input) o [{name, file}] plano
  // Devuelve los paquetes válidos encontrados y los guarda en IndexedDB.
  async function importFiles(fileList) {
    var byDir = {};
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      var rel = f.webkitRelativePath || f.name;
      var parts = rel.split('/');
      var dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      (byDir[dir] = byDir[dir] || {})[parts[parts.length - 1]] = f;
    }
    var found = [];
    for (var d in byDir) {
      var files = byDir[d];
      if (!files['canta.json']) continue;
      try {
        var json = JSON.parse(await files['canta.json'].text());
        if (!validPkg(json)) continue; // no persistir paquetes corruptos
        var v = files[json.files.vocals], m = files[json.files.music];
        if (!v || !m) continue;
        await idbPut({ id: json.id, json: json, vocals: v, music: m, added: Date.now() });
        found.push({ id: json.id, title: json.title, artist: json.artist, duration: json.duration });
      } catch (e) { /* carpeta que no es paquete: ignorar */ }
    }
    return found;
  }

  async function importDirHandle(handle) {
    // recorre el directorio elegido (y un nivel de subcarpetas) buscando canta.json
    var files = [];
    async function scan(h, prefix, depth) {
      for await (var entry of h.values()) {
        if (entry.kind === 'file') {
          var f = await entry.getFile();
          Object.defineProperty(f, 'webkitRelativePath', { value: prefix + entry.name });
          files.push(f);
        } else if (entry.kind === 'directory' && depth < 2) {
          await scan(entry, prefix + entry.name + '/', depth + 1);
        }
      }
    }
    await scan(handle, handle.name + '/', 0);
    return importFiles(files);
  }

  /* ================= demo sintética ================= */
  function buildDemo() {
    var sr = ctx().sampleRate;
    var BEAT = 0.55, GAP = 0.5, LONG = 1.1, T0 = 1.2;
    // [sílabas por palabra] + midi por sílaba (Estrellita, do mayor)
    var LINES = [
      { words: ['Estrellita', 'dónde', 'estás'], syl: [4, 2, 1], m: [60, 60, 67, 67, 69, 69, 67] },
      { words: ['me', 'pregunto', 'qué', 'serás'], syl: [1, 3, 1, 2], m: [65, 65, 64, 64, 62, 62, 60] },
      { words: ['En', 'el', 'cielo', 'en', 'el', 'mar'], syl: [1, 1, 2, 1, 1, 1], m: [67, 67, 65, 65, 64, 64, 62] },
      { words: ['un', 'diamante', 'de', 'verdad'], syl: [1, 3, 1, 2], m: [67, 67, 65, 65, 64, 64, 62] },
      { words: ['Estrellita', 'dónde', 'estás'], syl: [4, 2, 1], m: [60, 60, 67, 67, 69, 69, 67] },
      { words: ['me', 'pregunto', 'qué', 'serás'], syl: [1, 3, 1, 2], m: [65, 65, 64, 64, 62, 62, 60] }
    ];
    var CHORDS = [[48, 52, 55], [53, 57, 60], [55, 59, 62], [55, 59, 62], [48, 52, 55], [53, 57, 60]];
    var notes = [], lines = [], t = T0;
    for (var li = 0; li < LINES.length; li++) {
      var L = LINES[li], lineStart = t, words = [], si = 0;
      for (var wi = 0; wi < L.words.length; wi++) {
        var wStart = t;
        for (var k = 0; k < L.syl[wi]; k++) {
          var isLast = (si === L.m.length - 1);
          var dur = isLast ? LONG : BEAT;
          notes.push({ s: round2(t), e: round2(t + dur - 0.06), m: L.m[si] });
          t += dur; si++;
        }
        words.push({ s: round2(wStart), e: round2(t - 0.06), w: L.words[wi] });
      }
      lines.push({ s: round2(lineStart), e: round2(t), text: L.words.join(' '), words: words });
      t += GAP;
    }
    var duration = round2(t + 1);
    var len = Math.ceil(duration * sr);
    var voc = new Float32Array(len), mus = new Float32Array(len);
    // voz: senoide con armónicos y vibrato
    for (var n = 0; n < notes.length; n++) {
      var nt = notes[n], f = 440 * Math.pow(2, (nt.m - 69) / 12);
      var i0 = Math.floor(nt.s * sr), i1 = Math.min(len, Math.floor(nt.e * sr));
      var ph = 0;
      for (var i = i0; i < i1; i++) {
        var tt = (i - i0) / sr, total = (i1 - i0) / sr;
        var env = Math.min(1, tt / 0.03) * Math.min(1, (total - tt) / 0.08) * 0.32;
        ph += 2 * Math.PI * f * (1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * tt)) / sr;
        voc[i] += env * (Math.sin(ph) * 0.7 + Math.sin(2 * ph) * 0.22 + Math.sin(3 * ph) * 0.1);
      }
    }
    // música: colchón de acordes por línea
    for (li = 0; li < lines.length; li++) {
      var ch = CHORDS[li], L2 = lines[li];
      i0 = Math.floor(L2.s * sr); i1 = Math.min(len, Math.floor((L2.e + GAP) * sr));
      for (var ci = 0; ci < ch.length; ci++) {
        var fc = 440 * Math.pow(2, (ch[ci] - 69) / 12);
        for (i = i0; i < i1; i++) {
          tt = (i - i0) / sr; total = (i1 - i0) / sr;
          env = Math.min(1, tt / 0.15) * Math.min(1, (total - tt) / 0.3) * 0.075;
          mus[i] += env * Math.sin(2 * Math.PI * fc * (i - i0) / sr);
        }
      }
    }
    // pista f0 continua desde las notas
    var dt = 0.0464, f0v = [];
    for (var ti = 0; ti * dt < duration; ti++) {
      var tc = ti * dt, mv = 0;
      for (n = 0; n < notes.length; n++) if (tc >= notes[n].s && tc <= notes[n].e) { mv = notes[n].m; break; }
      f0v.push(mv);
    }
    var json = {
      version: 1, id: 'demo-estrellita', title: 'Estrellita (demo)', artist: 'Tradicional',
      youtube: null, duration: duration, key: 'C', lang: 'es',
      files: { vocals: '(sintética)', music: '(sintética)' },
      lines: lines, notes: notes, f0: { dt: dt, v: f0v }
    };
    function toBuffer(data) {
      var b = ctx().createBuffer(2, len, sr);
      b.getChannelData(0).set(data); b.getChannelData(1).set(data);
      return b;
    }
    stop();
    prepSeq++; pendingResume = null; killWorker();
    St.pkg = json;
    St.buffers = { vocals: toBuffer(voc), music: toBuffer(mus) };
    St.rendered = { key: '0|1', vocals: St.buffers.vocals, music: St.buffers.music };
    St.tempo = 1; St.semis = 0; St.posPaused = 0;
    return json;
  }
  function round2(x) { return Math.round(x * 100) / 100; }

  /* ================= render tono/velocidad ================= */
  var jobRejects = {}; // id → reject de los trabajos en vuelo (para poder cancelarlos)
  function getWorker() {
    if (St.worker) return St.worker;
    try { St.worker = new Worker('tools/canta/canta-dsp.js'); } catch (e) { St.worker = null; }
    return St.worker;
  }
  // mata el Worker (cancela el trabajo en curso) y rechaza sus promesas pendientes
  function killWorker() {
    if (St.worker) { try { St.worker.terminate(); } catch (e) {} St.worker = null; }
    var pend = jobRejects; jobRejects = {};
    for (var id in pend) pend[id](new Error('render cancelado'));
  }
  function renderStem(buffer, tempo, semis, onProgress) {
    var chans = [];
    for (var i = 0; i < buffer.numberOfChannels; i++) chans.push(buffer.getChannelData(i).slice());
    var w = getWorker();
    if (!w) {
      // respaldo síncrono (file:// sin Workers): bloquea un momento
      var out = SB.cantaDsp.processChannels(chans, buffer.sampleRate, tempo, semis, onProgress);
      return Promise.resolve(toAudioBuffer(out, buffer.sampleRate));
    }
    return new Promise(function (res, rej) {
      var id = 'r' + (++St.renderToken);
      jobRejects[id] = rej;
      var onMsg = function (e) {
        var m = e.data;
        if (!m || m.id !== id) return;
        if (m.progress != null && onProgress) onProgress(m.progress);
        if (m.error) { w.removeEventListener('message', onMsg); delete jobRejects[id]; rej(new Error(m.error)); }
        if (m.done) {
          w.removeEventListener('message', onMsg); delete jobRejects[id];
          res(toAudioBuffer(m.channels, buffer.sampleRate));
        }
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ cmd: 'process', id: id, channels: chans, sampleRate: buffer.sampleRate, tempo: tempo, semis: semis },
        chans.map(function (c) { return c.buffer; }));
    });
  }
  function toAudioBuffer(chans, sr) {
    var b = ctx().createBuffer(chans.length, chans[0].length, sr);
    for (var i = 0; i < chans.length; i++) b.getChannelData(i).set(chans[i]);
    return b;
  }

  // Prepara (renderiza si hace falta) el par de buffers para tempo/semis.
  // Si estaba sonando, retoma en la misma posición de la canción.
  // Reglas delicadas (ver revisión):
  // - capturar la posición ANTES de mutar St.tempo (position() usa el tempo vigente)
  // - un cambio nuevo cancela el render en vuelo (killWorker) y hereda la
  //   reanudación pendiente (pendingResume)
  // - si el render falla, se vuelve a los parámetros del render que sí existe
  var prepSeq = 0;
  var pendingResume = null; // {pos} → reanudar aquí cuando haya render listo
  async function setPlaybackParams(tempo, semis, onProgress) {
    if (!St.buffers) return;
    var key = semis + '|' + tempo;
    var myPkg = St.pkg;
    var mySeq = ++prepSeq;
    if (St.playing) { var p0 = position(); pause(); pendingResume = { pos: p0 }; }
    St.tempo = tempo; St.semis = semis;
    if (St.rendered && St.rendered.key === key) { resumeIfPending(); return; }
    var vocals, music;
    if (semis === 0 && tempo === 1) {
      vocals = St.buffers.vocals; music = St.buffers.music;
    } else {
      killWorker(); // cancela el trabajo viejo: solo importa el último cambio
      // soltar el render anterior para que el GC libere memoria durante el nuevo
      if (St.rendered && St.rendered.key !== '0|1') St.rendered = null;
      try {
        vocals = await renderStem(St.buffers.vocals, tempo, semis, function (p) { if (onProgress) onProgress(p * 0.5); });
        if (mySeq !== prepSeq || St.pkg !== myPkg) return; // lo superó otro cambio u otra canción
        music = await renderStem(St.buffers.music, tempo, semis, function (p) { if (onProgress) onProgress(0.5 + p * 0.5); });
        if (mySeq !== prepSeq || St.pkg !== myPkg) return;
      } catch (e) {
        if (mySeq === prepSeq && St.pkg === myPkg) {
          // rollback a los parámetros del render vigente (o al original)
          if (St.rendered) {
            var kk = St.rendered.key.split('|');
            St.semis = +kk[0]; St.tempo = +kk[1];
          } else {
            St.rendered = { key: '0|1', vocals: St.buffers.vocals, music: St.buffers.music };
            St.semis = 0; St.tempo = 1;
          }
        }
        throw e;
      }
    }
    St.rendered = { key: key, vocals: vocals, music: music };
    resumeIfPending();
  }
  function resumeIfPending() {
    if (!pendingResume) return;
    var pos = Math.min(pendingResume.pos, duration());
    pendingResume = null;
    St.posPaused = pos;
    play(pos);
  }

  /* ================= grabación de la voz ================= */
  // Safari solo sabe audio/mp4; Chrome y Firefox, webm. Se pide el primero
  // que el navegador declare soportar y se deja que él elija si no hay ninguno.
  var TIPOS = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
  var Rec = { mr: null, trozos: null, tipo: '' };

  function recSoportado() {
    return typeof MediaRecorder !== 'undefined';
  }
  function recStart(stream) {
    if (!recSoportado() || !stream) return false;
    var tipo = '';
    for (var i = 0; i < TIPOS.length; i++) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(TIPOS[i])) { tipo = TIPOS[i]; break; }
    }
    try {
      Rec.mr = tipo ? new MediaRecorder(stream, { mimeType: tipo }) : new MediaRecorder(stream);
    } catch (e) {
      try { Rec.mr = new MediaRecorder(stream); } catch (e2) { return false; }
    }
    // Los trozos viven en el closure, no en el objeto global: parar y volver a
    // grabar enseguida hacia que la grabacion nueva vaciara el array justo
    // antes de que la anterior armara su blob, y esa se perdia.
    var trozos = [];
    Rec.trozos = trozos;
    Rec.tipo = Rec.mr.mimeType || tipo || 'audio/webm';
    Rec.mr.ondataavailable = function (e) { if (e.data && e.data.size) trozos.push(e.data); };
    Rec.mr.start(250); // trozos periódicos: si algo falla no se pierde todo
    return true;
  }
  function recStop() {
    return new Promise(function (res) {
      var mr = Rec.mr, trozos = Rec.trozos, tipo = Rec.tipo;
      if (!mr || mr.state === 'inactive') { res(null); return; }
      // soltar la referencia global de inmediato, para que una grabacion nueva
      // no se cruce con esta mientras termina de cerrarse
      Rec.mr = null; Rec.trozos = null;
      mr.onstop = function () {
        res((trozos && trozos.length) ? new Blob(trozos, { type: tipo }) : null);
      };
      try { mr.stop(); } catch (e) { res(null); }
    });
  }
  function recActivo() { return !!(Rec.mr && Rec.mr.state === 'recording'); }

  /* ================= prueba de latencia =================
     Suena una serie de clics en instantes que conocemos al milisegundo, se
     graba el microfono mientras tanto y se busca cuando llegaron TUS palmadas.
     La diferencia entre lo que sono y lo que se oyo de vuelta es el retardo del
     circuito completo: parlante -> aire -> microfono -> proceso.
  */
  function pruebaLatencia(opts) {
    opts = opts || {};
    var nClics = opts.clics || 8;
    var paso = opts.intervalo || 0.8;
    var preparacion = opts.preparacion != null ? opts.preparacion : 1.2;
    var stream = opts.stream;
    if (!stream) return Promise.reject(new Error('sin micrófono'));

    var c = ctx();
    var t0 = c.currentTime + preparacion;
    var tiemposClic = [];

    // clic corto y seco: pega mejor de lo que uno cree para marcar un instante
    for (var i = 0; i < nClics; i++) {
      var t = t0 + i * paso;
      tiemposClic.push(t);
      var osc = c.createOscillator(), g = c.createGain();
      osc.frequency.value = i === 0 ? 1760 : 1320;   // el primero mas agudo: es la "1"
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(g); g.connect(c.destination);
      osc.start(t); osc.stop(t + 0.08);
    }

    // captura cruda del microfono, para poder buscar los golpes con precision
    // de muestra en vez de depender de la resolucion de un temporizador
    var src = c.createMediaStreamSource(stream);
    var TAM = 2048;
    var proc = c.createScriptProcessor(TAM, 1, 1);
    var mudo = c.createGain(); mudo.gain.value = 0;
    var trozos = [], capturaT0 = null;
    proc.onaudioprocess = function (e) {
      if (capturaT0 == null) capturaT0 = c.currentTime;
      trozos.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    src.connect(proc); proc.connect(mudo); mudo.connect(c.destination);

    var finT = t0 + (nClics - 1) * paso + 1.2;
    return new Promise(function (res) {
      var avisar = opts.onTick;
      var timer = avisar && setInterval(function () {
        var n = Math.floor((c.currentTime - t0) / paso) + 1;
        avisar(Math.max(0, Math.min(nClics, n)), nClics);
      }, 60);
      setTimeout(function () {
        if (timer) clearInterval(timer);
        try { src.disconnect(); proc.disconnect(); mudo.disconnect(); } catch (e) {}
        proc.onaudioprocess = null;
        res(analizarGolpes(trozos, capturaT0, c.sampleRate, tiemposClic, TAM));
      }, (finT - c.currentTime) * 1000);
    });
  }

  // Busca los golpes en la señal capturada y los empareja con los clics.
  function analizarGolpes(trozos, capturaT0, sr, tiemposClic, TAM) {
    if (!trozos.length || capturaT0 == null) {
      return { error: 'no llegó nada del micrófono' };
    }
    var total = trozos.length * TAM;
    var x = new Float32Array(total), off = 0, i;
    for (i = 0; i < trozos.length; i++) { x.set(trozos[i], off); off += trozos[i].length; }

    // envolvente de energia en ventanas de ~5 ms
    var W = Math.max(16, Math.round(sr * 0.005));
    var nEnv = Math.floor(total / W);
    var env = new Float32Array(nEnv);
    for (i = 0; i < nEnv; i++) {
      var s = 0;
      for (var k = 0; k < W; k++) { var v = x[i * W + k]; s += v * v; }
      env[i] = Math.sqrt(s / W);
    }
    // umbral robusto: muy por encima del ruido de fondo tipico
    var orden = Array.prototype.slice.call(env).sort(function (a, b) { return a - b; });
    var mediana = orden[orden.length >> 1] || 1e-6;
    var alto = orden[Math.floor(orden.length * 0.98)] || 1e-5;
    var umbral = Math.max(mediana * 6, alto * 0.35, 0.01);

    // ataques: cruce hacia arriba, con refractario para no contar el mismo golpe
    var golpes = [], ultimo = -1e9;
    var refract = 0.2;
    for (i = 1; i < nEnv; i++) {
      var t = capturaT0 + (i * W) / sr;
      if (env[i] >= umbral && env[i - 1] < umbral && t - ultimo > refract) {
        golpes.push(t); ultimo = t;
      }
    }
    if (golpes.length < 3) {
      return { error: 'oí ' + golpes.length + ' golpe(s): muy pocos', golpes: golpes.length };
    }

    // cada clic busca su golpe: el mas cercano dentro de media ventana
    var difs = [];
    for (i = 0; i < tiemposClic.length; i++) {
      var mejor = null, mejorD = 1e9;
      for (var j = 0; j < golpes.length; j++) {
        var d = golpes[j] - tiemposClic[i];
        if (d < -0.15 || d > 0.6) continue;      // fuera de rango razonable
        if (Math.abs(d) < Math.abs(mejorD)) { mejorD = d; mejor = golpes[j]; }
      }
      if (mejor != null) difs.push(mejorD);
    }
    if (difs.length < 3) {
      return { error: 'no pude emparejar tus palmadas con los clics', golpes: golpes.length };
    }
    var ord = difs.slice().sort(function (a, b) { return a - b; });
    var med = ord[ord.length >> 1];
    var desv = ord.map(function (d) { return Math.abs(d - med); })
                  .sort(function (a, b) { return a - b; })[ord.length >> 1];
    return {
      latencia: Math.max(0, Math.min(0.4, Math.round(med * 1000) / 1000)),
      golpes: golpes.length, emparejados: difs.length,
      dispersion: desv,
      // con palmadas parejas la dispersion baja de 40 ms; si no, el numero no sirve
      confiable: difs.length >= 4 && desv < 0.05
    };
  }

  /* ================= transporte ================= */
  function ensureGains() {
    if (St.gains) return;
    var c = ctx();
    St.gains = { vocals: c.createGain(), music: c.createGain(), mine: c.createGain() };
    ['vocals', 'music', 'mine'].forEach(function (k) {
      St.gains[k].gain.value = St.vols[k];
      St.gains[k].connect(c.destination);
    });
  }

  function duration() { return St.buffers ? St.buffers.vocals.duration : 0; }

  function position() {
    if (!St.buffers) return 0;
    var played = St.playing ? (ctx().currentTime - St.t0) : St.posPaused / St.tempo;
    return Math.min(played * St.tempo, duration());
  }

  function play(fromOrig) {
    if (!St.rendered) return;
    ensureGains();
    stopSources();
    var c = ctx();
    var offPlayed = (fromOrig != null ? fromOrig : St.posPaused) / St.tempo;
    var mkSrc = function (buf, gain) {
      var s = c.createBufferSource();
      s.buffer = buf; s.connect(gain);
      s.start(0, Math.min(offPlayed, buf.duration));
      return s;
    };
    St.srcs = [mkSrc(St.rendered.vocals, St.gains.vocals), mkSrc(St.rendered.music, St.gains.music)];
    // La toma se grabó sobre el render, así que va en la misma escala de
    // tiempo. mineOff descuenta la latencia de captura: lo que cantaste llegó
    // al micrófono unos milisegundos tarde y hay que adelantarlo para que
    // suene donde de verdad lo cantaste.
    if (St.mine) {
      var offMine = offPlayed + St.mineOff;
      if (offMine >= 0 && offMine < St.mine.duration) {
        var sm = c.createBufferSource();
        sm.buffer = St.mine; sm.connect(St.gains.mine);
        sm.start(0, offMine);
        St.srcs.push(sm);
      } else if (offMine < 0) {
        // aún no empieza la toma: programarla para dentro de un momento
        var sm2 = c.createBufferSource();
        sm2.buffer = St.mine; sm2.connect(St.gains.mine);
        sm2.start(c.currentTime - offMine, 0);
        St.srcs.push(sm2);
      }
    }
    St.srcs[0].onended = function () {
      if (!St.playing) return;
      St.playing = false; St.posPaused = duration();
      stopSources(); // corta también la pista de música si es más larga
      if (St.onEnded) St.onEnded();
    };
    St.t0 = c.currentTime - offPlayed;
    St.playing = true;
  }

  function stopSources() {
    if (St.srcs) St.srcs.forEach(function (s) { try { s.onended = null; s.stop(); } catch (e) {} });
    St.srcs = null;
  }

  function pause() {
    pendingResume = null; // una pausa explícita anula la reanudación automática
    if (!St.playing) return;
    St.posPaused = position();
    St.playing = false;
    stopSources();
  }

  function stop() { pause(); St.posPaused = 0; }

  function seek(orig) {
    orig = Math.max(0, Math.min(orig, duration()));
    if (pendingResume) { pendingResume.pos = orig; St.posPaused = orig; return; } // renderizando: reanudará aquí
    if (St.playing) play(orig);
    else St.posPaused = orig;
  }

  function setVol(stem, v) {
    St.vols[stem] = v;
    if (St.gains) St.gains[stem].gain.setTargetAtTime(v, ctx().currentTime, 0.03);
  }

  SB.cantaEngine = {
    ctx: ctx,
    // paquetes
    fetchServerList: fetchServerList,
    savedList: function () {
      return idbAll().then(function (recs) {
        return recs.map(function (r) {
          return { id: r.id, title: r.json.title, artist: r.json.artist, duration: r.json.duration };
        });
      });
    },
    loadFromServer: loadFromServer,
    loadSaved: loadSaved,
    importFiles: importFiles,
    importDirHandle: importDirHandle,
    deleteSaved: idbDelete,
    buildDemo: buildDemo,
    current: function () { return St.pkg; },
    // reproducción
    setPlaybackParams: setPlaybackParams,
    play: play, pause: pause, stop: stop, seek: seek,
    playing: function () { return St.playing; },
    position: position, duration: duration,
    tempo: function () { return St.tempo; }, semis: function () { return St.semis; },
    setVol: setVol, vols: function () { return St.vols; },
    setOnEnded: function (fn) { St.onEnded = fn; },
    // tomas del usuario
    takePut: takePut, takeList: takeList, takeGet: takeGet, takeDelete: takeDelete,
    decodeBlob: decodeBlob, alinearToma: alinearToma,
    recSoportado: recSoportado, recStart: recStart, recStop: recStop, recActivo: recActivo,
    pruebaLatencia: pruebaLatencia, _analizarGolpes: analizarGolpes,
    // Monta (o quita) la voz grabada como tercera pista. offset en segundos:
    // positivo = la toma se adelanta, para descontar la latencia de captura.
    setMine: function (buffer, offset) {
      var sonaba = St.playing, pos = position();
      if (sonaba) pause();
      St.mine = buffer || null;
      St.mineOff = offset || 0;
      if (sonaba) play(pos);
    },
    mineOffset: function (offset) {
      if (offset == null) return St.mineOff;
      var sonaba = St.playing, pos = position();
      if (sonaba) pause();
      St.mineOff = offset;
      if (sonaba) play(pos);
      return St.mineOff;
    },
    hasMine: function () { return !!St.mine; },
    unload: function () {
      stop(); St.pkg = null; St.buffers = null; St.rendered = null;
      St.mine = null; St.mineOff = 0;
    },
    // inspección para depurar (no usar desde herramientas)
    _debug: function () {
      return {
        renderedKey: St.rendered && St.rendered.key,
        renderedDur: St.rendered && St.rendered.vocals.duration,
        origDur: St.buffers && St.buffers.vocals.duration,
        tempo: St.tempo, semis: St.semis, playing: St.playing
      };
    }
  };
})();
