/* ============================================================
   Sub-herramienta: Canta — karaoke con afinación en vivo. Primaria.
   Depende de SB.cantaEngine (audio/paquetes) y SB.cantaPitch (mic).

   Pantallas:
   - Biblioteca (#/canta): paquetes del servidor local + guardados
     en el navegador + demo sintética + importar carpeta.
   - Cantar (#/canta/song/<id>): carril de notas estilo karaoke
     (las barras avanzan hacia la izquierda, cabezal fijo), letra
     palabra a palabra, volúmenes voz/música, tono, velocidad,
     micrófono con indicador de afinación, puntaje y racha.

   Convenciones de tiempo: todo en segundos de la canción ORIGINAL.
   El audio renderizado (tono/velocidad) dura D/tempo; para el
   desplazamiento visual se divide por el tempo al dibujar.
   ============================================================ */
(function () {
  window.SB = window.SB || {};
  var E = function () { return SB.cantaEngine; };

  var CFGKEY = 'sb.canta.cfg', BESTKEY = 'sb.canta.best';
  var TOL = 0.7;          // tolerancia de afinación: ±70 cents alrededor de la nota
  var HITRATIO = 0.72;    // fracción del tiempo evaluado que hay que acertar para que la barra quede verde
  // Cantar no es saltar de plataforma en plataforma: para llegar a una nota se
  // pasa por las del medio (portamento) y el ataque siempre viene con un
  // deslizamiento. Ese tramo inicial no se evalúa — ni suma ni castiga.
  var TRANS = 0.15;       // segundos de gracia al entrar a cada nota
  var PXPS = 120;         // píxeles por segundo (en tiempo reproducido)

  var S = {
    view: null, ctx: null, screen: null,
    cfg: null, raf: 0, els: null, colors: null,
    // partido en curso
    notes: null, finPtr: 0, lineIdx: -1, trace: [],
    score: 0, streak: 0, best: 0, wrapOff: 0,
    micMode: 'off', lastSampleT: 0, applyTimer: null, rendering: false,
    pendSemis: 0, pendTempo: 100,
    mountSeq: 0, applySeq: 0, frame: 0
  };

  /* ---------------- configuración ---------------- */
  function loadCfg() {
    var d = { volV: 0.6, volM: 1.0, latency: 0.1, octaveFree: true, latin: true,
              micDev: null, audifonos: false };
    try { Object.assign(d, JSON.parse(localStorage.getItem(CFGKEY) || '{}')); } catch (e) {}
    return d;
  }
  function saveCfg() { try { localStorage.setItem(CFGKEY, JSON.stringify(S.cfg)); } catch (e) {} }
  function bestFor(id) {
    try { return (JSON.parse(localStorage.getItem(BESTKEY) || '{}'))[id] || 0; } catch (e) { return 0; }
  }
  function saveBest(id, v) {
    try {
      var m = JSON.parse(localStorage.getItem(BESTKEY) || '{}');
      if (v > (m[id] || 0)) { m[id] = v; localStorage.setItem(BESTKEY, JSON.stringify(m)); }
    } catch (e) {}
  }

  /* ---------------- utilidades ---------------- */
  function q(sel) { return S.view.querySelector(sel); }
  function esc(s) { return SB.ui.esc(s); }
  function fmtT(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function slug(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cancion';
  }
  function noteName(midi) {
    var pc = ((Math.round(midi) % 12) + 12) % 12;
    var n = SB.music.NOTES[pc];
    return S.cfg.latin ? SB.music.LATIN_TI[n] : n;
  }
  function status(msg) { if (S.els && S.els.status) S.els.status.textContent = msg || ''; }

  /* ================= BIBLIOTECA ================= */
  async function mountLibrary() {
    S.screen = 'lib';
    // volver a la biblioteca dentro de Canta no pasa por onLeave: soltar todo aquí
    if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
    if (S.applyTimer) { clearTimeout(S.applyTimer); S.applyTimer = null; }
    SB.cantaPitch.stop();
    E().pause();
    S.view.innerHTML =
      '<div class="ka-scope">' +
      '<div class="rep-head"><h1>Canta</h1><span class="count" id="kaCount"></span></div>' +
      '<p class="ed-note">Karaoke con afinación en vivo: elige una canción preparada, canta con el micrófono ' +
      'y mira si vas en el tono.</p>' +

      '<section class="prep" id="kaPrep">' +
      '<h2 class="panel-title">Preparar una canción</h2>' +
      '<div id="kaPrepBody"><p class="set-status">Buscando el motor…</p></div>' +
      '</section>' +

      '<div class="set-row">' +
      '<button class="mini-app-btn" id="kaPick">Elegir carpeta…</button>' +
      '<button class="mini-app-btn" id="kaDemo">Probar la demo</button>' +
      '<input type="file" id="kaPickFallback" webkitdirectory multiple style="display:none">' +
      '</div>' +
      '<table class="rep" id="kaList"><thead><tr><th>Canción</th><th>Intérprete</th><th>Duración</th><th></th></tr></thead><tbody></tbody></table>' +
      '<p class="set-status" id="kaLibStatus"></p>' +
      '</div>';
    q('#kaDemo').addEventListener('click', function () { S.ctx.navigate('canta/song/demo-estrellita'); });
    pintarPrep();
    q('#kaPick').addEventListener('click', pickFolder);
    q('#kaPickFallback').addEventListener('change', async function (e) {
      var found = await E().importFiles(Array.from(e.target.files));
      libStatus(found);
      drawLibrary();
    });
    drawLibrary();
  }

  /* ================= PREPARAR UNA CANCIÓN (motor local) ================= */
  var P = { job: null, timer: null, t0: 0, subiendo: false };

  function prepBody() { return q('#kaPrepBody'); }

  async function pintarPrep() {
    var body = prepBody();
    if (!body) return;
    var est = await SB.cantaMotor.detectar();
    if (S.screen !== 'lib' || !prepBody()) return; // se cambió de vista mientras sondeábamos
    body = prepBody();
    // ¿había una preparación en curso? (saliste de la pestaña y volviste, o
    // recargaste la página mientras el motor seguía trabajando)
    var enCurso = P.job || (est && est.ocupado && est.job_actual);
    if (enCurso) {
      P.job = enCurso;
      if (!P.t0) P.t0 = Date.now();
      // recuperar si el usuario había pedido subir al terminar (recarga a medias)
      if (S.prepSubir === undefined) {
        try { S.prepSubir = localStorage.getItem('sb.canta.subir') !== '0'; } catch (e) { S.prepSubir = true; }
      }
      pintarProgreso({ etapa: 'Retomando…', pct: 0 });
      seguirProgreso();
      return;
    }
    if (!est) {
      body.innerHTML = ayudaSinMotor();
      q('#pxRetry').addEventListener('click', async function () {
        body.innerHTML = '<p class="set-status">Buscando el motor…</p>';
        await SB.cantaMotor.detectar(true);
        pintarPrep();
      });
      return;
    }

    var avisos = '';
    if (!est.ffmpeg) avisos += '<p class="prep-warn">Falta <b>ffmpeg</b> en el PATH. Instálalo con <code>winget install Gyan.FFmpeg</code> y reinicia el motor.</p>';
    if (!est.venv) avisos += '<p class="prep-warn">Falta el entorno de Python. Corre <code>canta-prep\\setup.bat</code> una vez y reinicia el motor.</p>';

    body.innerHTML = avisos +
      '<div class="prep-form">' +
      '<label class="prep-field wide">Link de YouTube' +
      '<input id="pxUrl" type="url" placeholder="https://www.youtube.com/watch?v=…" autocomplete="off"></label>' +
      '<div class="prep-or">o</div>' +
      '<label class="prep-field wide">Archivo del computador (mp4, mp3, m4a, wav)' +
      '<input id="pxFile" type="file" accept="video/*,audio/*"></label>' +
      '<label class="prep-field">Título <input id="pxTitle" placeholder="(opcional)"></label>' +
      '<label class="prep-field">Intérprete <input id="pxArtist" placeholder="(opcional)"></label>' +
      '<label class="prep-field">Calidad de la letra' +
      '<select id="pxModel">' +
      '<option value="tiny">Rápida</option>' +
      '<option value="small" selected>Normal</option>' +
      '<option value="medium">Mejor (más lenta)</option>' +
      '<option value="large-v3-turbo">Muy buena (lenta)</option>' +
      '<option value="large-v3">La mejor (la más lenta)</option>' +
      '</select></label>' +
      '<label class="prep-field">Idioma' +
      '<select id="pxLang"><option value="">Detectar solo</option><option value="es">Español</option>' +
      '<option value="en">Inglés</option><option value="pt">Portugués</option></select></label>' +
      '<label class="check wide"><input type="checkbox" id="pxSubir" checked> ' +
      'Subir al cancionero al terminar (letra + canción, para tenerla en el celular)</label>' +
      '<button class="pr-play prep-go" id="pxGo">PREPARAR CANCIÓN</button>' +
      '</div>' +
      '<p class="set-status" id="pxMsg"></p>';

    q('#pxGo').addEventListener('click', lanzarPreparacion);
    q('#pxUrl').addEventListener('keydown', function (e) { if (e.key === 'Enter') lanzarPreparacion(); });
  }

  function ayudaSinMotor() {
    var publicado = /github\.io$/i.test(location.hostname);
    return '<p class="ed-note">' +
      (publicado
        ? 'Estás en el sitio publicado, que no tiene servidor: separar la voz y transcribir la letra ' +
          'necesitan tu computador. Aquí puedes <b>cantar</b> las canciones que ya subiste.'
        : 'El motor no está corriendo.') +
      '</p>' +
      '<p class="ed-note">Para preparar una canción nueva, en tu computador haz doble clic a ' +
      '<code>canta-prep\\motor.bat</code>: se abre el cancionero en ' +
      '<code>http://localhost:' + SB.cantaMotor.PUERTO + '</code> con este cuadro activo. ' +
      'Ahí pegas el link de YouTube (o eliges un MP4) y, al terminar, la canción y su letra ' +
      'se suben al repositorio y aparecen acá.</p>' +
      '<div class="set-row"><button class="mini-app-btn" id="pxRetry">Buscar el motor de nuevo</button></div>';
  }

  function prepMsg(txt) { var m = q('#pxMsg'); if (m) m.textContent = txt || ''; }

  async function lanzarPreparacion() {
    var url = (q('#pxUrl').value || '').trim();
    var file = q('#pxFile').files[0] || null;
    if (!url && !file) { prepMsg('Pega un link de YouTube o elige un archivo.'); return; }
    if (url && file) { prepMsg('Elige una sola cosa: el link o el archivo.'); return; }
    var datos = {
      url: url,
      title: (q('#pxTitle').value || '').trim(),
      artist: (q('#pxArtist').value || '').trim(),
      model: q('#pxModel').value,
      language: q('#pxLang').value || null
    };
    S.prepSubir = q('#pxSubir').checked;
    try { localStorage.setItem('sb.canta.subir', S.prepSubir ? '1' : '0'); } catch (e) {}
    try {
      pintarProgreso({ etapa: file ? 'Subiendo el archivo al motor…' : 'Pidiendo la canción…', pct: 0 });
      var r = file
        ? await SB.cantaMotor.prepararArchivo(file, datos, function (f) {
            pintarProgreso({ etapa: 'Subiendo el archivo al motor…', pct: Math.round(f * 100), subida: true });
          })
        : await SB.cantaMotor.prepararUrl(datos);
      P.job = r.job; P.t0 = Date.now();
      seguirProgreso();
    } catch (e) {
      pintarPrep().then(function () { prepMsg('No pude empezar: ' + e.message); });
    }
  }

  function pintarProgreso(p) {
    var body = prepBody();
    if (!body) return;
    var pct = Math.max(0, Math.min(100, p.pct || 0));
    var seg = P.t0 ? Math.round((Date.now() - P.t0) / 1000) : 0;
    body.innerHTML =
      '<div class="prep-run">' +
      '<div class="prep-etapa">' + esc(p.etapa || 'Trabajando…') +
      (p.paso ? ' <span class="prep-paso">' + p.paso + '/' + p.total + '</span>' : '') + '</div>' +
      '<div class="prep-bar"><span style="width:' + pct + '%"></span></div>' +
      '<div class="prep-sub">' + pct + '% · ' + fmtT(seg) +
      (p.subida ? '' : ' · esto demora varios minutos, puedes dejarlo trabajando') + '</div>' +
      (p.lineas && p.lineas.length ? '<pre class="prep-log">' + esc(p.lineas.slice(-6).join('\n')) + '</pre>' : '') +
      '<button class="mini-x" id="pxCancel">Cancelar</button>' +
      '</div>';
    var c = q('#pxCancel');
    if (c) c.addEventListener('click', async function () {
      try { await SB.cantaMotor.cancelar(P.job); } catch (e) {}
      P.job = null;
      if (P.timer) clearTimeout(P.timer);
      pintarPrep().then(function () { prepMsg('Preparación cancelada.'); });
    });
  }

  function seguirProgreso() {
    if (!P.job) return;
    P.timer = setTimeout(async function () {
      if (!P.job || S.screen !== 'lib') return;
      try {
        var p = await SB.cantaMotor.progreso(P.job);
        if (!P.job) return;
        if (p.estado === 'corriendo') { pintarProgreso(p); seguirProgreso(); return; }
        P.job = null;
        if (p.estado === 'error') {
          pintarPrep().then(function () { prepMsg('Falló: ' + (p.error || 'error desconocido')); });
          return;
        }
        await terminarPreparacion(p);
      } catch (e) {
        P.job = null;
        pintarPrep().then(function () { prepMsg('Se perdió el contacto con el motor: ' + e.message); });
      }
    }, 1200);
  }

  // La canción quedó lista: refrescar la biblioteca, guardar la letra en el
  // Cancionero y (si corresponde) publicar todo al repo.
  async function terminarPreparacion(p) {
    var body = prepBody();
    if (body) body.innerHTML = '<p class="set-status">Guardando…</p>';
    var resumen = [], letraId = null;
    try {
      await E().loadFromServer(p.id);
      var pkg = E().current();
      letraId = guardarLetra(pkg);
      resumen.push(letraId.conservada
        ? 'ya tenías esta letra en el Cancionero: la dejé tal cual (no piso tus correcciones)'
        : letraId.lineas
          ? letraId.lineas + ' líneas de letra guardadas en el Cancionero'
          : 'sin letra reconocida (¿es instrumental, o la voz quedó muy tapada?)');
      if (!(pkg.notes || []).length) {
        resumen.push('OJO: no se detectó melodía de voz, así que no hay barras que seguir');
      }
      if (S.prepSubir) {
        if (body) body.innerHTML = '<p class="set-status">Subiendo la canción al repositorio…</p>';
        var r = await SB.cantaMotor.publicar(p.id);
        if (r && r.ok) resumen.push(r.empujado ? 'canción subida al repositorio' : 'la canción ya estaba subida');
        else resumen.push('no se pudo subir la canción (' + ((r && r.error) || 'error') + ')');
        if (SB.github && SB.github.configured()) {
          try { await SB.github.push(SB.store.dump()); resumen.push('letra sincronizada'); }
          catch (e) { resumen.push('la letra no se sincronizó (' + e.message + ')'); }
        } else {
          resumen.push('la letra quedó en este dispositivo — configura Ajustes → GitHub para sincronizarla');
        }
      }
    } catch (e) {
      resumen.push('problema al guardar: ' + e.message);
    }
    drawLibrary();
    body = prepBody();
    if (!body) return;
    body.innerHTML =
      '<div class="prep-done">' +
      '<div class="prep-etapa">Lista: ' + esc(p.titulo || p.id) + '</div>' +
      '<p class="set-status">' + esc(resumen.join(' · ')) + '</p>' +
      '<div class="set-row">' +
      '<button class="mini-app-btn" id="pxSing">Cantarla ahora</button>' +
      (letraId ? '<button class="mini-app-btn" id="pxLyr">Ver la letra</button>' : '') +
      '<button class="mini-app-btn" id="pxOtra">Preparar otra</button>' +
      '</div></div>';
    q('#pxSing').addEventListener('click', function () { S.ctx.navigate('canta/song/' + encodeURIComponent(p.id)); });
    q('#pxOtra').addEventListener('click', function () { pintarPrep(); });
    if (letraId) q('#pxLyr').addEventListener('click', function () { S.ctx.navigate('songbook/song/' + letraId.id); });
  }

  // Guarda la letra del paquete como canción del Cancionero, CON las marcas de
  // tiempo (línea y palabra) ancladas a la posición del carácter, para que el
  // karaoke siga sincronizado después de que la edites.
  function r3(x) { return Math.round(x * 1000) / 1000; }
  function lineaGuardada(L) {
    var texto = ' ' + String(L.text || '').trim();  // el espacio inicial es la convención del modelo
    var ln = { l: texto, a: [] }, marcas = [], cursor = 1;
    (L.words || []).forEach(function (w) {
      var p = texto.indexOf(w.w, cursor);
      if (p < 0) return;                            // la palabra no calza exacto: se interpolará
      cursor = p + w.w.length;
      marcas.push([r3(w.s), r3(w.e), p]);
    });
    if (typeof L.s === 'number') ln.t = [r3(L.s), r3(L.e)];
    if (marcas.length) ln.w = marcas;
    return ln;
  }
  function guardarLetra(pkg) {
    var id = 'canta-' + slug(pkg.title);
    var existente = cancionVinculada(pkg);
    if (existente) {
      // ya la tenías (quizá corregida a mano): no la pisamos
      var n = 0;
      (existente.parts || []).forEach(function (p) { n += (p.lines || []).length; });
      return { id: existente.id, lineas: n, conservada: true };
    }
    var lines = (pkg.lines || []).filter(function (l) { return l.text && l.text.trim(); });
    SB.store.save({
      id: id, cantaId: pkg.id, title: pkg.title, artist: pkg.artist || '',
      key: pkg.key || '—', loaded: true,
      parts: [{ name: 'Letra', lines: lines.length ? lines.map(lineaGuardada) : [{ l: '', a: [] }] }]
    });
    return { id: id, lineas: lines.length };
  }

  function libStatus(found) {
    var el = q('#kaLibStatus');
    if (!el) return;
    el.textContent = found.length
      ? 'Importadas: ' + found.map(function (f) { return f.title; }).join(', ')
      : 'En esa carpeta no encontré paquetes (busco canta.json + audios).';
  }

  async function pickFolder() {
    try {
      if (window.showDirectoryPicker) {
        var h = await window.showDirectoryPicker();
        var found = await E().importDirHandle(h);
        libStatus(found);
        drawLibrary();
      } else {
        q('#kaPickFallback').click();
      }
    } catch (e) {
      // cancelar el diálogo es normal; cualquier otro error hay que contarlo
      if (e && e.name !== 'AbortError') {
        var el = q('#kaLibStatus');
        if (el) el.textContent = 'No pude importar: ' + e.message;
      }
    }
  }

  async function drawLibrary() {
    var saved = await E().savedList();
    var server = await E().fetchServerList();
    var seen = {}, rows = [];
    (server || []).forEach(function (p) { seen[p.id] = true; rows.push({ p: p, src: 'servidor' }); });
    saved.forEach(function (p) { if (!seen[p.id]) rows.push({ p: p, src: 'guardada' }); });
    rows.sort(function (a, b) { return a.p.title.localeCompare(b.p.title); });
    if (S.screen !== 'lib' || !q('#kaList')) return;
    q('#kaCount').textContent = rows.length + ' canciones';
    var tb = q('#kaList tbody');
    tb.innerHTML = rows.map(function (r) {
      var del = r.src === 'guardada'
        ? ' <button class="mini-x" data-del="' + esc(r.p.id) + '" title="Borrar del navegador">×</button>' : '';
      return '<tr class="song" data-id="' + esc(r.p.id) + '"><td class="t-title">' + esc(r.p.title) +
        '</td><td>' + esc(r.p.artist || '') + '</td><td class="t-key">' + fmtT(r.p.duration || 0) +
        '</td><td><span class="badge">' + r.src + '</span>' + del + '</td></tr>';
    }).join('') || '<tr class="stub"><td colspan="4">Sin canciones todavía — prepara una arriba, o prueba la demo.</td></tr>';
    tb.querySelectorAll('tr.song').forEach(function (tr) {
      tr.addEventListener('click', function () { S.ctx.navigate('canta/song/' + encodeURIComponent(tr.dataset.id)); });
    });
    tb.querySelectorAll('button[data-del]').forEach(function (b) {
      b.addEventListener('click', async function (ev) {
        ev.stopPropagation();
        await E().deleteSaved(b.dataset.del);
        drawLibrary();
      });
    });
  }

  /* ================= CARGA DE UNA CANCIÓN ================= */
  async function openSong(id) {
    var mySeq = S.mountSeq; // si el usuario cambia de vista durante la carga, no pintar encima
    S.view.innerHTML = '<div class="ka-scope"><p class="set-status">Cargando "' + esc(id) + '"…</p></div>';
    try {
      var cur = E().current();
      if (!cur || cur.id !== id) {
        if (id === 'demo-estrellita') E().buildDemo();
        else {
          try { await E().loadSaved(id); }
          catch (e) { await E().loadFromServer(id); }
        }
      }
      if (mySeq !== S.mountSeq) return;
      mountPlayer();
    } catch (e) {
      if (mySeq !== S.mountSeq) return;
      S.view.innerHTML = '<div class="ka-scope"><button class="back" id="kaBack">← Canta</button>' +
        '<p class="set-status">No pude cargar la canción: ' + esc(e.message) + '</p></div>';
      q('#kaBack').addEventListener('click', function () { S.ctx.navigate('canta'); });
    }
  }

  /* ================= PANTALLA CANTAR ================= */
  function mountPlayer() {
    var pkg = E().current();
    S.screen = 'play';
    S.best = bestFor(pkg.id);
    S.score = 0; S.streak = 0; S.trace = []; S.lineIdx = -1; S.wrapOff = 0;
    S.pendSemis = 0; S.pendTempo = 100;
    S.notes = (pkg.notes || []).map(function (n) {
      return { s: n.s, e: n.e, m: n.m, segs: [], hitT: 0, totT: 0, done: false, green: false, scored: false, pts: 0 };
    }).sort(function (a, b) { return a.s - b.s; });
    S.lines = partirLargas(letraEfectiva(pkg));
    S.letraEditada = S.lines !== pkg.lines && S.lines.length > 0;
    S.f0 = pkg.f0 && pkg.f0.v && pkg.f0.v.length ? pkg.f0 : null; // curva de tono real
    S.finPtr = 0;

    S.view.innerHTML =
      '<div class="ka-scope">' +
      '<button class="back" id="kaBack">← Canta</button>' +
      '<div class="rep-head"><div><h1>' + esc(pkg.title) + '</h1>' +
      '<p class="artist">' + esc(pkg.artist || '') + (pkg.key ? ' · tono ' + esc(pkg.key) : '') + '</p></div>' +
      '<button class="mini-app-btn" id="kaSaveLyr">Guardar letra en el Cancionero</button></div>' +

      '<div class="ka-stage">' +
      '<canvas id="kaCanvas"></canvas>' +
      '<div class="ka-hud"><span id="kaScore">0</span><span class="ka-hud-sub" id="kaStreak"></span>' +
      '<span class="ka-hud-sub" id="kaBest"></span></div>' +
      '<div class="ka-lyric"><div class="ka-now" id="kaNow"></div><div class="ka-next" id="kaNext"></div></div>' +
      '</div>' +

      '<div class="controls">' +
      '<button class="pr-play ka-play" id="kaPlay">CANTAR</button>' +
      '<span class="t-key" id="kaTime">0:00 / ' + fmtT(E().duration()) + '</span>' +
      '<input type="range" class="ka-prog" id="kaProg" min="0" max="1000" value="0" aria-label="Posición">' +
      '</div>' +

      '<div class="controls ka-ctl">' +
      '<div class="ctl"><span class="ctl-label">Voz</span><input type="range" id="kaVolV" min="0" max="130" aria-label="Volumen voz"></div>' +
      '<div class="ctl"><span class="ctl-label">Música</span><input type="range" id="kaVolM" min="0" max="130" aria-label="Volumen música"></div>' +
      '<div class="ctl"><span class="ctl-label" title="Cada clic sube o baja medio tono (un semitono); se muestra en tonos">Tono</span><div class="stepper">' +
      '<button id="kaSemD" aria-label="Bajar medio tono">−</button><span class="val" id="kaSem">0</span><button id="kaSemU" aria-label="Subir medio tono">+</button></div></div>' +
      '<div class="ctl"><span class="ctl-label">Velocidad</span><div class="stepper">' +
      '<button id="kaTemD" aria-label="Más lento">−</button><span class="val" id="kaTem">100%</span><button id="kaTemU" aria-label="Más rápido">+</button></div></div>' +
      '<div class="ctl"><span class="ctl-label">Escucha</span><div class="seg" id="kaMicSeg">' +
      '<button data-m="off">Off</button><button data-m="mic">Mic</button><button data-m="test">Prueba</button></div></div>' +
      '<div class="ctl" id="kaMicDevWrap" hidden><span class="ctl-label" title="Si tienes una interfaz de audio conectada, elígela aquí. El navegador usa el micrófono del sistema salvo que le indiques otro">Entrada</span>' +
      '<select id="kaMicDev"></select></div>' +
      '<label class="check" title="Con audífonos se apaga la cancelación de eco del navegador, que atenúa el micrófono cada vez que suena la música y corta tu voz a pedazos"><input type="checkbox" id="kaAudif"> Audífonos</label>' +
      '<label class="check" title="Acepta tu canto en la octava que te acomode (hombre cantando una canción de mujer, etc.). Desmarcado: exige la octava exacta"><input type="checkbox" id="kaOct"> Octava libre</label>' +
      '<div class="ctl"><span class="ctl-label" title="Compensación del retardo parlante→micrófono→proceso. Si cantas bien pero te marca corrido, ajústala de a 10 ms">Latencia</span><div class="stepper">' +
      '<button id="kaLatD" aria-label="Menos latencia">−</button><span class="val" id="kaLat"></span><button id="kaLatU" aria-label="Más latencia">+</button></div></div>' +
      '</div>' +
      '<p class="set-status" id="kaStatus"></p>' +
      '</div>';

    S.els = {
      canvas: q('#kaCanvas'), now: q('#kaNow'), next: q('#kaNext'),
      score: q('#kaScore'), streak: q('#kaStreak'), best: q('#kaBest'),
      play: q('#kaPlay'), time: q('#kaTime'), prog: q('#kaProg'), status: q('#kaStatus')
    };
    readColors();

    // eventos
    q('#kaBack').addEventListener('click', function () { S.ctx.navigate('canta'); });
    q('#kaSaveLyr').addEventListener('click', saveLyrics);
    S.els.play.addEventListener('click', togglePlay);
    S.els.prog.addEventListener('input', function () {
      var t = (+this.value / 1000) * E().duration();
      E().seek(t); resetRunFrom(t);
    });
    var volV = q('#kaVolV'), volM = q('#kaVolM');
    volV.value = Math.round(S.cfg.volV * 100); volM.value = Math.round(S.cfg.volM * 100);
    E().setVol('vocals', S.cfg.volV); E().setVol('music', S.cfg.volM);
    volV.addEventListener('input', function () { S.cfg.volV = +this.value / 100; E().setVol('vocals', S.cfg.volV); saveCfg(); });
    volM.addEventListener('input', function () { S.cfg.volM = +this.value / 100; E().setVol('music', S.cfg.volM); saveCfg(); });
    q('#kaSemD').addEventListener('click', function () { bumpSemis(-1); });
    q('#kaSemU').addEventListener('click', function () { bumpSemis(1); });
    q('#kaTemD').addEventListener('click', function () { bumpTempo(-5); });
    q('#kaTemU').addEventListener('click', function () { bumpTempo(5); });
    q('#kaMicSeg').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { setMicMode(b.dataset.m); });
    });
    var oct = q('#kaOct');
    oct.checked = S.cfg.octaveFree;
    oct.addEventListener('change', function () { S.cfg.octaveFree = oct.checked; saveCfg(); });

    // cambiar de micrófono o de audífonos obliga a reabrir el stream
    var aud = q('#kaAudif');
    aud.checked = !!S.cfg.audifonos;
    aud.addEventListener('change', function () {
      S.cfg.audifonos = aud.checked; saveCfg();
      if (S.micMode === 'mic') setMicMode('mic', true);
      status(aud.checked
        ? 'Cancelación de eco apagada: mejor seguimiento, pero usa audífonos o se escuchará a sí misma.'
        : 'Cancelación de eco encendida (para parlantes).');
    });
    q('#kaMicDev').addEventListener('change', function () {
      S.cfg.micDev = this.value || null; saveCfg();
      if (S.micMode === 'mic') setMicMode('mic', true);
      status('Entrada cambiada. Si no se escucha, revisa que el dispositivo esté activo.');
    });
    q('#kaLatD').addEventListener('click', function () { bumpLat(-0.01); });
    q('#kaLatU').addEventListener('click', function () { bumpLat(0.01); });

    E().setOnEnded(function () {
      finalizeAll();
      saveBest(pkg.id, S.score);
      S.best = bestFor(pkg.id);
      updateHud();
      status('Fin. Puntaje: ' + S.score + (S.score >= S.best ? ' — ¡tu mejor marca!' : ''));
      updatePlayBtn();
    });

    setMicMode(S.micMode === 'mic' ? 'mic' : (S.micMode || 'off'), true);
    updateSteppers(); updateHud(); updatePlayBtn();
    if (!S.notes.length) {
      status('Esta canción no trae melodía detectada: puedes cantarla y usar los volúmenes, pero no hay barras de afinación.');
    } else if (S.letraDescartada) {
      status('No pude sincronizar tu letra editada con los tiempos; muestro la letra original. Revisa que las líneas se parezcan a lo cantado.');
    } else if (S.letraOmitidas > 0) {
      status(S.letraOmitidas + (S.letraOmitidas === 1 ? ' línea de tu letra quedó sin tiempo y no aparecerá' : ' líneas de tu letra quedaron sin tiempo y no aparecerán') + ' en el karaoke.');
    }
    loop();
  }

  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    var v = function (name, fb) { return (cs.getPropertyValue(name) || fb).trim() || fb; };
    S.colors = {
      ink: v('--ink', '#141414'), mut: v('--mut', '#767676'), faint: v('--faint', '#a8a8a8'),
      line: v('--line', '#e3e3e3'), panel: v('--panel', '#fafafa'), bg: v('--bg', '#ffffff'),
      good: '#2f9e44', bad: '#d33131'
    };
  }

  /* ---------------- transporte y parámetros ---------------- */
  function togglePlay() {
    if (S.rendering) return;
    if (E().playing()) { E().pause(); }
    else {
      E().ctx(); // gesto del usuario: despierta el AudioContext
      if (E().position() >= E().duration() - 0.05) { E().seek(0); resetRunFrom(0); }
      if (S.score === 0 && E().position() < 0.05) resetRunFrom(0);
      E().play();
      status('');
    }
    updatePlayBtn();
  }
  function updatePlayBtn() {
    S.els.play.textContent = E().playing() ? 'PAUSA' : 'CANTAR';
    S.els.play.classList.toggle('playing', E().playing());
  }

  function bumpSemis(d) {
    S.pendSemis = Math.max(-12, Math.min(12, S.pendSemis + d));
    updateSteppers(); scheduleApply();
  }
  function bumpTempo(d) {
    S.pendTempo = Math.max(50, Math.min(150, S.pendTempo + d));
    updateSteppers(); scheduleApply();
  }
  function bumpLat(d) {
    S.cfg.latency = Math.max(0, Math.min(0.3, Math.round((S.cfg.latency + d) * 100) / 100));
    saveCfg(); updateSteppers();
  }
  // el paso interno es el semitono; se muestra en tonos: +½, +1, +1½…
  function fmtSemis(s) {
    if (!s) return '0';
    var sign = s > 0 ? '+' : '−', a = Math.abs(s);
    var whole = Math.floor(a / 2), half = a % 2;
    return sign + (whole ? whole : '') + (half ? '½' : '');
  }
  function updateSteppers() {
    q('#kaSem').textContent = fmtSemis(S.pendSemis);
    q('#kaTem').textContent = S.pendTempo + '%';
    q('#kaLat').textContent = Math.round(S.cfg.latency * 1000) + ' ms';
  }
  function scheduleApply() {
    if (S.applyTimer) clearTimeout(S.applyTimer);
    S.applyTimer = setTimeout(applyParams, 450);
  }
  async function applyParams() {
    S.applyTimer = null;
    var semis = S.pendSemis, tempo = S.pendTempo / 100;
    if (semis === E().semis() && tempo === E().tempo()) return;
    var mySeq = ++S.applySeq; // solo el intento más nuevo toca la UI
    S.rendering = true;
    status('Procesando tono/velocidad…');
    try {
      await E().setPlaybackParams(tempo, semis, function (p) {
        if (mySeq === S.applySeq) status('Procesando tono/velocidad… ' + Math.round(p * 100) + '%');
      });
      if (mySeq === S.applySeq) status('');
    } catch (e) {
      if (mySeq === S.applySeq && e.message !== 'render cancelado') {
        status('Falló el proceso: ' + e.message);
        // reflejar el rollback del motor en los steppers
        S.pendSemis = E().semis();
        S.pendTempo = Math.round(E().tempo() * 100);
        updateSteppers();
      }
    }
    if (mySeq === S.applySeq) { S.rendering = false; updatePlayBtn(); }
  }

  function setMicMode(mode, silent) {
    S.micMode = mode;
    q('#kaMicSeg').querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.m === mode ? 'true' : 'false');
    });
    SB.cantaPitch.stop();
    if (mode === 'off') return;
    if (mode === 'test') {
      SB.cantaPitch.setTestMelody(function () {
        if (!E().playing()) return null;
        var ta = E().position() - S.cfg.latency;
        var n = noteAt(ta);
        if (!n) return null;
        return n.m + E().semis() + 0.12 * Math.sin(ta * 7);
      });
    }
    SB.cantaPitch.start(E().ctx(), mode, onPitchSample, {
      deviceId: S.cfg.micDev, audifonos: !!S.cfg.audifonos
    }).then(function () {
      if (mode === 'mic') poblarMicrofonos();
    }).catch(function (e) {
      S.micMode = 'off'; setMicMode('off');
      status('No pude usar el micrófono: ' + e.message);
    });
    if (!silent) status(mode === 'mic' ? 'Micrófono activo. Con parlantes fuertes conviene usar audífonos.' : 'Modo prueba: canto automático.');
  }

  // El selector solo tiene sentido con más de una entrada, y los nombres solo
  // llegan una vez dado el permiso: por eso se puebla al prender el micrófono.
  function poblarMicrofonos() {
    SB.cantaPitch.listarMicrofonos().then(function (devs) {
      var wrap = q('#kaMicDevWrap'), sel = q('#kaMicDev');
      if (!wrap || !sel || devs.length < 2) return;
      sel.innerHTML = '<option value="">Por defecto del sistema</option>' +
        devs.map(function (d) {
          return '<option value="' + esc(d.id) + '">' + esc(d.nombre) + '</option>';
        }).join('');
      sel.value = devs.some(function (d) { return d.id === S.cfg.micDev; }) ? S.cfg.micDev : '';
      wrap.hidden = false;
    });
  }

  /* ---------------- lógica de partido ---------------- */
  function noteAt(t) {
    var ns = S.notes, lo = 0, hi = ns.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (ns[mid].e < t) lo = mid + 1;
      else if (ns[mid].s > t) hi = mid - 1;
      else return ns[mid];
    }
    return null;
  }

  function resetRunFrom(t) {
    S.trace = [];
    S.lineIdx = -1;
    for (var i = 0; i < S.notes.length; i++) {
      var n = S.notes[i];
      if (n.e >= t - 0.05) {
        S.score -= n.pts || 0; // devolver lo ganado: retroceder no infla el puntaje
        n.pts = 0; n.scored = false;
        n.segs = []; n.hitT = 0; n.totT = 0; n.done = false; n.green = false;
      }
    }
    S.finPtr = 0;
    while (S.finPtr < S.notes.length && S.notes[S.finPtr].done) S.finPtr++;
    // reconstruir la racha vigente: verdes consecutivas entre las notas que quedaron cerradas
    var st = 0;
    for (i = 0; i < S.finPtr; i++) {
      var d = S.notes[i];
      if (d.scored) st = d.green ? st + 1 : 0;
    }
    S.streak = st;
    if (S.score < 0) S.score = 0;
    updateHud();
  }

  // llega ~50 veces/s desde el estabilizador (mic o prueba)
  function onPitchSample(sample) {
    if (S.screen !== 'play' || !E().playing()) return;
    var dt = S.lastSampleT ? Math.min(0.05, Math.max(0.005, sample.t - S.lastSampleT)) : 0.02;
    S.lastSampleT = sample.t;
    var tAdj = E().position() - S.cfg.latency;
    if (tAdj < 0) return;
    var target = noteAt(tAdj);
    var semis = E().semis();
    var shown = null, state = 0; // 0 sin voz/objetivo · 1 acierto · 2 error · 3 transición
    var gracia = target ? Math.min(TRANS, (target.e - target.s) * 0.35) : 0;
    var enTransicion = target ? (tAdj - target.s) < gracia : false;
    if (sample.midi != null) {
      shown = sample.midi;
      if (target) {
        var goal = target.m + semis;
        if (S.cfg.octaveFree) {
          S.wrapOff = 12 * Math.round((goal - sample.midi) / 12);
          shown = sample.midi + S.wrapOff;
        }
        var hit = Math.abs(shown - goal) <= TOL;
        state = enTransicion ? 3 : (hit ? 1 : 2);
        if (!enTransicion) {          // el ataque no se evalúa
          target.totT += dt;
          if (hit) target.hitT += dt;
        }
        var segs = target.segs, last = segs[segs.length - 1];
        if (last && last.hit === hit && last.trans === enTransicion && tAdj - last.t1 < 0.08) last.t1 = tAdj;
        else segs.push({ t0: tAdj, t1: tAdj + 0.001, hit: hit, trans: enTransicion });
      } else if (S.cfg.octaveFree) {
        shown = sample.midi + S.wrapOff; // mantener la octava mostrada entre notas
      }
    } else if (target && !enTransicion) {
      target.totT += dt; // había que cantar y no se detectó voz
    }
    if (shown != null) {
      S.trace.push({ t: tAdj, m: shown, st: state });
      if (S.trace.length > 400) S.trace.splice(0, S.trace.length - 400);
    }
  }

  function finalizeUpTo(tAdj) {
    var changed = false;
    while (S.finPtr < S.notes.length && S.notes[S.finPtr].e + 0.15 < tAdj) {
      var n = S.notes[S.finPtr];
      if (!n.done) {
        n.done = true;
        n.scored = S.micMode !== 'off' && n.totT > 0.02;
        var ratio = n.scored ? n.hitT / n.totT : 0;
        n.green = n.scored && ratio >= HITRATIO;
        if (n.scored) {
          var mult = 1 + 0.1 * Math.min(S.streak, 10);
          n.pts = Math.round((n.e - n.s) * 100 * ratio * mult);
          S.score += n.pts;
          S.streak = n.green ? S.streak + 1 : 0;
          changed = true;
        }
      }
      S.finPtr++;
    }
    if (changed) updateHud();
  }
  function finalizeAll() { finalizeUpTo(Infinity); }

  function updateHud() {
    S.els.score.textContent = S.score;
    S.els.streak.textContent = S.streak > 1 ? 'racha ' + S.streak + '×' : '';
    S.els.best.textContent = S.best > 0 ? 'mejor ' + Math.max(S.best, S.score) : '';
  }

  /* ---------------- letra ----------------
     El karaoke muestra la letra EDITADA por el usuario si existe: la canción
     del Cancionero guarda las marcas de tiempo ancladas a la posición del
     carácter (`t` por línea, `w` por palabra) y el editor las mueve al partir,
     unir o escribir. Si no hay canción vinculada, se usa la del paquete. */

  // Busca la canción del Cancionero que corresponde a este paquete.
  function cancionVinculada(pkg) {
    var ov = SB.store.dump();
    for (var id in ov) if (ov[id] && ov[id].cantaId === pkg.id) return ov[id];
    return ov['canta-' + slug(pkg.title)] || null;
  }

  // Convierte una línea del Cancionero {l, t, w} al formato del karaoke.
  // Construye un mapa monótono posición-de-carácter → tiempo con las marcas
  // que haya, y con él le pone tiempo a TODAS las palabras (las que el usuario
  // agregó al editar quedan interpoladas entre sus vecinas).
  function lineaConTiempos(ln) {
    var texto = String(ln.l || ''), t0 = ln.t[0], t1 = ln.t[1];
    var pals = [], re = /\S+/g, m;
    while ((m = re.exec(texto))) pals.push({ w: m[0], pos: m.index });
    if (!pals.length) return null;
    var marcas = (ln.w || []).slice().sort(function (a, b) { return a[2] - b[2]; });
    // emparejar cada marca con la palabra más cercana (el texto pudo cambiar)
    var anclas = new Array(pals.length).fill(null);
    marcas.forEach(function (mk) {
      var best = -1, bestD = 1e9;
      for (var i = 0; i < pals.length; i++) {
        if (anclas[i]) continue;
        var d = Math.abs(pals[i].pos - mk[2]);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0 && bestD <= Math.max(4, pals[best].w.length)) anclas[best] = { s: mk[0], e: mk[1] };
    });
    // mapa carácter → tiempo (extremos de la línea + extremos de cada ancla)
    var xs = [0], ys = [t0];
    for (var i = 0; i < pals.length; i++) {
      if (!anclas[i]) continue;
      xs.push(pals[i].pos); ys.push(anclas[i].s);
      xs.push(pals[i].pos + pals[i].w.length); ys.push(anclas[i].e);
    }
    xs.push(Math.max(texto.length, 1)); ys.push(t1);
    for (i = 1; i < ys.length; i++) { // forzar monotonía
      if (xs[i] < xs[i - 1]) xs[i] = xs[i - 1];
      if (ys[i] < ys[i - 1]) ys[i] = ys[i - 1];
    }
    var mapa = function (x) {
      for (var k = 1; k < xs.length; k++) {
        if (x <= xs[k]) {
          var span = xs[k] - xs[k - 1];
          var f = span > 0 ? (x - xs[k - 1]) / span : 0;
          return ys[k - 1] + (ys[k] - ys[k - 1]) * f;
        }
      }
      return ys[ys.length - 1];
    };
    return {
      s: t0, e: t1, text: texto.trim(),
      words: pals.map(function (p) { return { s: mapa(p.pos), e: mapa(p.pos + p.w.length), w: p.w }; })
    };
  }

  // Normaliza para comparar textos (sin tildes, sin puntuación, minúsculas)
  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function parecido(a, b) {
    var A = norm(a).split(' '), B = norm(b).split(' ');
    if (!A.length || !B.length) return 0;
    var usados = B.slice(), comunes = 0;
    A.forEach(function (w) {
      var i = usados.indexOf(w);
      if (i >= 0) { usados.splice(i, 1); comunes++; }
    });
    return comunes / Math.max(A.length, B.length);
  }

  // Le presta tiempos del paquete a las líneas que no tienen marca propia
  // (letras guardadas antes de que existieran las marcas, o escritas a mano).
  // Empareja por orden si la cantidad calza; si no, alinea SIN CRUCES (una línea
  // nunca toma el tiempo de otra que va después), evitando los tramos que ya
  // reclamaron las líneas con marca propia.
  function prestarTiempos(lineas, pkgLines) {
    var faltan = lineas.filter(function (l) { return !l.t; });
    if (!faltan.length || !pkgLines.length) return;
    if (lineas.length === pkgLines.length) {
      lineas.forEach(function (l, i) { if (!l.t) l.t = [pkgLines[i].s, pkgLines[i].e]; });
      return;
    }
    // tramos del paquete que ya usa una línea con t propio: no re-prestarlos
    var conT = lineas.filter(function (l) { return l.t; });
    var libres = pkgLines.filter(function (p) {
      return !conT.some(function (l) { return p.s < l.t[1] && p.e > l.t[0]; });
    });
    if (!libres.length) return;
    // alineación monótona (DP) que maximiza el parecido sin cruzar el orden
    var n = faltan.length, m = libres.length;
    var dp = [], bt = [];
    for (var i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); bt.push(new Array(m + 1).fill(0)); }
    for (i = 1; i <= n; i++) {
      for (var j = 1; j <= m; j++) {
        var match = dp[i - 1][j - 1] + parecido(faltan[i - 1].l, libres[j - 1].text);
        var saltaLibre = dp[i][j - 1];
        var saltaFalta = dp[i - 1][j] - 0.001; // leve costo por dejar una sin tiempo
        var best = match, b = 2;
        if (saltaLibre > best) { best = saltaLibre; b = 0; }
        if (saltaFalta > best) { best = saltaFalta; b = 1; }
        dp[i][j] = best; bt[i][j] = b;
      }
    }
    i = n; j = m;
    while (i > 0 && j > 0) {
      var d = bt[i][j];
      if (d === 2) {
        if (parecido(faltan[i - 1].l, libres[j - 1].text) >= 0.34) {
          faltan[i - 1].t = [libres[j - 1].s, libres[j - 1].e];
        }
        i--; j--;
      } else if (d === 0) { j--; } else { i--; }
    }
  }

  // Whisper devuelve segmentos de hasta 50 palabras como una sola "linea".
  // Mostrada entera tapa el carril de notas (en el celular, un segmento largo
  // ocupa mas alto que el canvas). Se parte en trozos legibles cortando en la
  // puntuacion, y si no hay, por largo. Los tiempos salen de las palabras, asi
  // que el karaoke sigue sincronizado y no hay que volver a preparar la cancion.
  var MAX_CHARS = 44;
  function partirLargas(lines) {
    var out = [];
    (lines || []).forEach(function (L) {
      var ws = (L.words || []).filter(function (w) { return w && w.w; });
      if (!ws.length || (L.text || '').length <= MAX_CHARS) { out.push(L); return; }
      var buf = [];
      function empujar() {
        if (!buf.length) return;
        out.push({
          s: buf[0].s,
          e: buf[buf.length - 1].e,
          text: buf.map(function (w) { return w.w; }).join(' '),
          words: buf
        });
        buf = [];
      }
      var largo = 0;
      ws.forEach(function (w) {
        buf.push(w);
        largo += w.w.length + 1;
        // cortar en puntuacion solo si el trozo ya tiene cuerpo, para no dejar
        // versos de dos palabras cada vez que Whisper pone una coma
        var pausa = /[.,;:!?¿¡]$/.test(w.w) && largo >= MAX_CHARS * 0.45;
        if (pausa || largo >= MAX_CHARS) { empujar(); largo = 0; }
      });
      empujar();
    });
    return out;
  }

  function letraEfectiva(pkg) {
    S.letraOmitidas = 0; S.letraDescartada = false;
    var song = cancionVinculada(pkg);
    var pkgLines = pkg.lines || [];
    if (song) {
      var crudas = [];
      (song.parts || []).forEach(function (p) {
        (p.lines || []).forEach(function (ln) {
          if (ln.l && ln.l.trim()) crudas.push(ln);
        });
      });
      if (crudas.length) {
        // trabajamos sobre copias: prestar tiempos no debe tocar lo guardado
        var copias = crudas.map(function (l) { return { l: l.l, t: l.t && l.t.slice(), w: l.w }; });
        prestarTiempos(copias, pkgLines);
        var out = [];
        copias.forEach(function (ln) {
          if (!ln.t) return;
          var L = lineaConTiempos(ln);
          if (L) out.push(L);
        });
        if (out.length) {
          out.sort(function (a, b) { return a.s - b.s; });
          S.letraOmitidas = crudas.length - out.length; // líneas del usuario sin tiempo
          return out;
        }
        // ninguna línea consiguió tiempo: usamos la del paquete pero avisamos,
        // porque la letra corregida por el usuario no se está mostrando
        S.letraDescartada = true;
      }
    }
    return pkgLines;
  }

  function updateLyrics(t) {
    var lines = S.lines || [];
    if (!lines.length) {
      if (S.lineIdx !== -2) { S.lineIdx = -2; S.els.now.textContent = ''; S.els.next.textContent = '(sin letra transcrita)'; }
      return;
    }
    // línea vigente: la que contiene t, o la próxima
    var idx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (t <= lines[i].e + 0.3) { idx = i; break; }
    }
    if (idx < 0) idx = lines.length - 1;
    if (idx !== S.lineIdx) {
      S.lineIdx = idx;
      var L = lines[idx];
      S.els.now.innerHTML = (L.words && L.words.length)
        ? L.words.map(function (w, wi) { return '<span data-wi="' + wi + '">' + esc(w.w) + '</span>'; }).join(' ')
        : esc(L.text);
      S.els.next.textContent = idx + 1 < lines.length ? lines[idx + 1].text : '';
    }
    var L2 = lines[idx];
    if (L2.words) {
      var spans = S.els.now.children;
      for (i = 0; i < spans.length; i++) {
        spans[i].classList.toggle('on', t >= (L2.words[i] ? L2.words[i].s : 1e9));
      }
    }
  }

  /* ---------------- dibujo ---------------- */
  function loop() {
    if (S.screen !== 'play') return;
    // releer los colores del tema de vez en cuando (tema auto puede cambiar solo)
    if ((S.frame = (S.frame || 0) + 1) % 90 === 0) readColors();
    draw();
    S.raf = requestAnimationFrame(loop);
  }

  function draw() {
    var cv = S.els.canvas, dpr = window.devicePixelRatio || 1;
    var W = cv.clientWidth, H = cv.clientHeight;
    if (!W) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    var C = S.colors, tempo = E().tempo(), semis = E().semis();
    var now = E().position();
    var tAdj = now - S.cfg.latency;
    finalizeUpTo(tAdj);
    updateLyrics(now);

    // rango vertical según la melodía transpuesta
    var ns = S.notes, loM = 55, hiM = 79;
    if (ns.length) {
      loM = Infinity; hiM = -Infinity;
      for (var i = 0; i < ns.length; i++) { if (ns[i].m < loM) loM = ns[i].m; if (ns[i].m > hiM) hiM = ns[i].m; }
      loM = Math.floor(loM + semis) - 3; hiM = Math.ceil(hiM + semis) + 3;
      while (hiM - loM < 14) { loM--; hiM++; }
    }
    var span = hiM - loM;
    var yOf = function (m) { return H - ((m - loM) / span) * H; };
    var phX = W * 0.40; // 40% de pasado, 60% de futuro
    var xOf = function (t) { return phX + ((t - now) / tempo) * PXPS; };
    var barH = Math.max(5, Math.min(20, (H / span) * 0.85));

    // rejilla: una línea por semitono, más notoria en cada Do
    g.lineWidth = 1;
    for (var m = loM; m <= hiM; m++) {
      var y = yOf(m);
      var isC = ((m % 12) + 12) % 12 === 0;
      g.strokeStyle = isC ? C.line : C.panel;
      if (!isC && span > 26) continue;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      if (isC) {
        g.fillStyle = C.faint; g.font = '10px ui-monospace,Consolas,monospace';
        g.fillText(noteName(m) + (Math.floor(m / 12) - 1), 4, y - 3);
      }
    }

    // barras de notas
    var t0Vis = now - (phX / PXPS) * tempo - 1, t1Vis = now + ((W - phX) / PXPS) * tempo + 1;
    g.font = '600 11px ui-monospace,Consolas,monospace';
    for (i = 0; i < ns.length; i++) {
      var n = ns[i];
      if (n.e < t0Vis) continue;
      if (n.s > t1Vis) break;
      var x1 = xOf(n.s), x2 = xOf(n.e);
      var ym = yOf(n.m + semis) - barH / 2;
      // nota cerrada: verde/rojo solo si de verdad se evaluó; saltada queda neutra
      g.fillStyle = n.done && n.scored ? (n.green ? C.good : C.bad) : C.line;
      g.globalAlpha = n.done ? 0.5 : 1;
      rounded(g, x1, ym, Math.max(3, x2 - x1), barH, barH / 2);
      g.fill();
      g.globalAlpha = 1;
      // tramo ya recorrido, pintado según acierto
      for (var si = 0; si < n.segs.length; si++) {
        var sg = n.segs[si];
        var sx1 = xOf(Math.max(sg.t0, n.s)), sx2 = xOf(Math.min(sg.t1, n.e));
        if (sx2 <= sx1) continue;
        // el tramo de entrada (portamento) va neutro: no es error
        g.fillStyle = sg.trans ? C.faint : (sg.hit ? C.good : C.bad);
        rounded(g, sx1, ym, sx2 - sx1, barH, barH / 2);
        g.fill();
      }
      if (x2 - x1 > 30) {
        g.fillStyle = C.mut;
        g.fillText(noteName(n.m + semis), x1 + 6, ym - 3 < 10 ? ym + barH + 11 : ym - 3);
      }
    }

    // curva de tono real de la grabación (guía: el canto no son plataformas,
    // se desliza entre notas y vibra). Línea fina sobre las barras.
    if (S.f0) {
      var dt0 = S.f0.dt, v = S.f0.v;
      var iA = Math.max(0, Math.floor(t0Vis / dt0)), iB = Math.min(v.length - 1, Math.ceil(t1Vis / dt0));
      g.strokeStyle = C.mut; g.lineWidth = 1.5; g.globalAlpha = 0.55;
      g.beginPath();
      var trazando = false;
      for (i = iA; i <= iB; i++) {
        var mv = v[i];
        if (mv <= 0) { trazando = false; continue; } // sin voz: corta la línea
        var fx = xOf(i * dt0), fy = yOf(Math.max(loM, Math.min(hiM, mv + semis)));
        if (trazando) g.lineTo(fx, fy); else { g.moveTo(fx, fy); trazando = true; }
      }
      g.stroke();
      g.globalAlpha = 1;
    }

    // traza de la voz del usuario
    if (S.trace.length) {
      g.lineWidth = 2;
      var prev = null;
      for (i = 0; i < S.trace.length; i++) {
        var p = S.trace[i];
        if (p.t < t0Vis) continue;
        if (p.t > tAdj + 0.02) break;
        var px = xOf(p.t), py = yOf(Math.max(loM, Math.min(hiM, p.m)));
        var col = p.st === 1 ? C.good : (p.st === 2 ? C.bad : (p.st === 3 ? C.faint : C.mut));
        // solo conectar puntos cercanos en tiempo Y en altura (línea armónica,
        // sin espigas verticales cuando el detector salta)
        if (prev && p.t - prev.t < 0.1 && Math.abs(p.m - prev.m) < 3) {
          g.strokeStyle = col;
          g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(px, py); g.stroke();
        }
        prev = { t: p.t, x: px, y: py, m: p.m };
      }
      // cometa en el punto actual
      if (prev && tAdj - prev.t < 0.25) {
        g.fillStyle = C.ink;
        g.beginPath(); g.arc(prev.x, prev.y, 5, 0, Math.PI * 2); g.fill();
        g.strokeStyle = C.bg; g.lineWidth = 1.5;
        g.beginPath(); g.arc(prev.x, prev.y, 5, 0, Math.PI * 2); g.stroke();
      }
    }

    // cabezal
    g.strokeStyle = C.mut; g.lineWidth = 1;
    g.beginPath(); g.moveTo(phX, 0); g.lineTo(phX, H); g.stroke();

    // transporte
    var dur = E().duration() || 1;
    S.els.time.textContent = fmtT(now) + ' / ' + fmtT(dur);
    if (document.activeElement !== S.els.prog) S.els.prog.value = Math.round((now / dur) * 1000);
    if (E().playing() !== S.els.play.classList.contains('playing')) updatePlayBtn();
  }

  function rounded(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* ---------------- guardar / editar la letra ---------------- */
  // Si ya existe la canción en el Cancionero (lo normal: se crea al preparar),
  // vamos a editarla; nunca la pisamos, para no borrar las correcciones.
  function saveLyrics() {
    var pkg = E().current();
    var song = cancionVinculada(pkg);
    if (song) { S.ctx.navigate('songbook/song/' + song.id); return; }
    if (!(pkg.lines || []).length) { status('Esta canción no tiene letra transcrita.'); return; }
    var r = guardarLetra(pkg);
    status('Letra guardada en el Cancionero.');
    S.ctx.navigate('songbook/song/' + r.id);
  }

  /* ---------------- montaje ---------------- */
  function mount(view, rest, ctx) {
    S.view = view; S.ctx = ctx;
    S.mountSeq = (S.mountSeq || 0) + 1;
    if (!S.cfg) S.cfg = loadCfg();
    var m = /^song\/(.+)$/.exec(rest || '');
    if (m) openSong(decodeURIComponent(m[1]));
    else mountLibrary();
  }

  function leave() {
    S.mountSeq = (S.mountSeq || 0) + 1; // invalida cargas en curso
    if (S.raf) cancelAnimationFrame(S.raf);
    S.raf = 0;
    if (S.applyTimer) { clearTimeout(S.applyTimer); S.applyTimer = null; }
    // el trabajo del motor sigue en el computador; solo dejamos de sondearlo
    if (P.timer) { clearTimeout(P.timer); P.timer = null; }
    S.screen = null;
    SB.cantaPitch.stop();
    if (SB.cantaEngine) SB.cantaEngine.pause();
  }

  // gancho mínimo de inspección (depurar sin exponer el estado entero)
  SB.canta = {
    debug: function () {
      return {
        screen: S.screen, score: S.score, streak: S.streak,
        trace: S.trace.length, micMode: S.micMode,
        notesDone: S.notes ? S.notes.filter(function (n) { return n.done; }).length : 0,
        notesGreen: S.notes ? S.notes.filter(function (n) { return n.green; }).length : 0,
        notesScored: S.notes ? S.notes.filter(function (n) { return n.scored; }).length : 0,
        sinEvaluar: S.notes ? S.notes.filter(function (n) { return n.done && !n.scored; })
          .map(function (n) { return { dur: +(n.e - n.s).toFixed(2), tot: +n.totT.toFixed(3) }; }).slice(0, 12) : [],
        segs: S.notes ? S.notes.reduce(function (a, n) { return a + n.segs.length; }, 0) : 0,
        lineIdx: S.lineIdx, rendering: S.rendering,
        letraEditada: !!S.letraEditada,
        lineas: (S.lines || []).map(function (l) {
          return { s: +l.s.toFixed(2), e: +l.e.toFixed(2), n: l.text.length, p: (l.words || []).length };
        })
      };
    }
  };

  var ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line></svg>';
  SB.registry.register({ id: 'canta', name: 'Canta', kind: 'primary', icon: ICON, mount: mount, onLeave: leave });
})();
