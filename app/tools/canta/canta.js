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
  // Paginas satelite de un solo tool (p.ej. canta/, para alumnos): ocultan
  // "preparar canción"/"elegir carpeta"/"demo", que son para el dueño del repo.
  var STUDENT = !!window.SB_CANTA_STUDENT;

  var CFGKEY = 'sb.canta.cfg', BESTKEY = 'sb.canta.best';
  // Niveles de exigencia del evaluador.
  //   tol    semitonos alrededor de la nota que cuentan como afinado
  //   ratio  fracción del tiempo evaluado que hay que acertar para el verde
  //   logro  (solo recreativo) segundos afinados que bastan para que TODA la
  //          plataforma quede verde, aunque después el canto suba o baje;
  //          en notas cortas basta la mitad de la nota
  //   rojo   si se pintan los tramos desafinados
  //   trans  gracia al entrar a cada nota: cantar no es saltar de plataforma en
  //          plataforma, se llega pasando por las notas del medio (portamento),
  //          y ese tramo inicial no suma ni castiga
  var NIVELES = {
    recreativo: { tol: 1.0, ratio: 0,    logro: 0.3, rojo: false, trans: 0.2 },
    avanzado:   { tol: 0.9, ratio: 0.5,  logro: 0,   rojo: true,  trans: 0.2 },
    estricto:   { tol: 0.7, ratio: 0.72, logro: 0,   rojo: true,  trans: 0.15 }
  };
  function nivel() { return NIVELES[S.cfg.nivel] || NIVELES.recreativo; }
  // Tope de latencia: con audífonos Bluetooth el retraso real pasa de 300 ms
  var LAT_MAX = 1.0;
  var PXPS = 120;         // píxeles por segundo (en tiempo reproducido)

  var S = {
    view: null, ctx: null, screen: null,
    sel: [], multiSel: false,   // editor: plataformas elegidas (varias con Ctrl) y modo selección múltiple
    cfg: null, raf: 0, els: null, colors: null,
    // partido en curso
    notes: null, finPtr: 0, lineIdx: -1, trace: [],
    score: 0, streak: 0, best: 0, wrapOff: 0,
    micMode: 'off', lastSampleT: 0, applyTimer: null, rendering: false,
    pendSemis: 0, pendTempo: 100,
    mountSeq: 0, applySeq: 0, frame: 0,
    // grabación de tu voz
    grabando: false, tomaTrace: [], tomaTempo: 1, tomaSemis: 0,
    grabBase: 0, tomaTramos: [], tramo: null,
    tomaId: null, tomaCurva: null, tomaLat: 0
  };

  /* ---------------- configuración ---------------- */
  function loadCfg() {
    var d = { fx: { comp: 0.5, brillo: 0.4, reverb: 0.25 }, volV: 0.6, volM: 1.0, volMine: 1.0, latency: 0.1, octaveFree: true, latin: true,
              micDev: null, audifonos: false, antiguo: false, grabar: true, nivel: 'recreativo' };
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
    tonoParar();
    E().pause();
    S.view.innerHTML =
      '<div class="ka-scope">' +
      '<div class="rep-head"><h1>Canta</h1><span class="count" id="kaCount"></span></div>' +
      '<p class="ed-note">Karaoke con afinación en vivo: elige una canción preparada, canta con el micrófono ' +
      'y mira si vas en el tono.</p>' +

      (STUDENT ? '' :
      '<section class="prep" id="kaPrep">' +
      '<h2 class="panel-title">Preparar una canción</h2>' +
      '<div id="kaPrepBody"><p class="set-status">Buscando el motor…</p></div>' +
      '</section>' +

      '<div class="set-row">' +
      '<button class="mini-app-btn" id="kaPick">Elegir carpeta…</button>' +
      '<button class="mini-app-btn" id="kaDemo">Probar la demo</button>' +
      '<input type="file" id="kaPickFallback" webkitdirectory multiple style="display:none">' +
      '</div>') +
      '<div class="rep-scroll"><table class="rep" id="kaList"><thead><tr><th>Canción</th><th>Intérprete</th><th>Duración</th><th></th></tr></thead><tbody></tbody></table></div>' +
      '<div class="ka-arch" id="kaArchBox" hidden></div>' +
      '<p class="set-status" id="kaLibStatus"></p>' +
      '</div>';
    if (!STUDENT) {
      q('#kaDemo').addEventListener('click', function () { S.ctx.navigate('canta/song/demo-estrellita'); });
      pintarPrep();
      q('#kaPick').addEventListener('click', pickFolder);
      q('#kaPickFallback').addEventListener('change', async function (e) {
        var found = await E().importFiles(Array.from(e.target.files));
        libStatus(found);
        drawLibrary();
      });
    }
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
    if (!est && SB.github && SB.github.configured()) { pintarCola(body); return; }
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
      '<label class="prep-field" title="pyin escucha la periodicidad de la onda; en voces graves se engancha a veces una octava más abajo. Crepe es una red neuronal que no tiene ese defecto y además es más rápida, pero detecta algo menos de melodía">Detector de melodía' +
      '<select id="pxDet">' +
      '<option value="pyin" selected>Clásico (pyin)</option>' +
      '<option value="crepe">Neuronal (crepe) — sin saltos de octava</option>' +
      '</select></label>' +
      '<label class="check wide" title="Para vocalizos y ejercicios: el audio es el acompañamiento para cantar encima, no una canción con voz. No separa pistas ni transcribe letra, y saca la melodía del audio tal cual"><input type="checkbox" id="pxEjer"> ' +
      'Es un ejercicio de vocalización (sin voz que separar)</label>' +
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

  /* ---- Sin motor pero con token: pedir la canción a la cola del PC ----
     El workflow preparar-cancion.yml corre en el runner propio del PC: baja,
     separa, saca letra y melodía, y publica el paquete. Aquí solo se encola
     (workflow_dispatch) y se mira el estado de los últimos pedidos. */
  var URL_YT = /^https:\/\/(www\.|m\.|music\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[A-Za-z0-9_-]{6,}/;
  var COLA = { timer: null, esperarHasta: 0, refrescados: {} };
  var PEDIDOS_KEY = 'sb.canta.pedidos';

  function pedidos() { try { return JSON.parse(localStorage.getItem(PEDIDOS_KEY) || '[]'); } catch (e) { return []; } }
  function guardarPedido(p) {
    var l = pedidos(); l.unshift(p);
    try { localStorage.setItem(PEDIDOS_KEY, JSON.stringify(l.slice(0, 10))); } catch (e) {}
  }

  function pintarCola(body) {
    body.innerHTML =
      '<p class="ed-note">Pega un link de YouTube y tu PC prepara la canción (unos 10 minutos): separa la voz, ' +
      'busca la letra, saca la melodía y la publica acá. El PC tiene que estar encendido y con tu sesión iniciada.</p>' +
      '<div class="prep-form">' +
      '<label class="prep-field wide">Link de YouTube' +
      '<input id="pxUrl" type="url" placeholder="https://www.youtube.com/watch?v=…" autocomplete="off"></label>' +
      '<label class="prep-field">Título <input id="pxTitle" placeholder="(opcional)"></label>' +
      '<label class="prep-field">Intérprete <input id="pxArtist" placeholder="(opcional)"></label>' +
      '<button class="pr-play prep-go" id="pxPedir">PEDIR CANCIÓN</button>' +
      '</div>' +
      '<p class="set-status" id="pxMsg"></p>' +
      '<div id="pxCola"></div>' +
      '<div class="set-row"><button class="mini-app-btn" id="pxRetry">Buscar el motor local</button></div>';
    q('#pxPedir').addEventListener('click', pedirCancion);
    q('#pxUrl').addEventListener('keydown', function (e) { if (e.key === 'Enter') pedirCancion(); });
    q('#pxRetry').addEventListener('click', async function () {
      body.innerHTML = '<p class="set-status">Buscando el motor…</p>';
      await SB.cantaMotor.detectar(true);
      pintarPrep();
    });
    refrescarCola();
  }

  async function pedirCancion() {
    var url = (q('#pxUrl').value || '').trim();
    if (!URL_YT.test(url)) { prepMsg('Ese link no parece de YouTube: usa uno de youtube.com/watch?v=… o youtu.be/…'); return; }
    var titulo = (q('#pxTitle').value || '').trim(), artista = (q('#pxArtist').value || '').trim();
    var inputs = { url: url };
    if (titulo) inputs.titulo = titulo;
    if (artista) inputs.artista = artista;
    var btn = q('#pxPedir'); btn.disabled = true;
    prepMsg('Enviando el pedido…');
    try {
      await SB.github.dispatchCancion(inputs);
    } catch (e) {
      prepMsg('No se pudo pedir: ' + e.message);
      btn.disabled = false;
      return;
    }
    guardarPedido({ t: Date.now(), url: url, titulo: titulo, artista: artista });
    q('#pxUrl').value = ''; q('#pxTitle').value = ''; q('#pxArtist').value = '';
    btn.disabled = false;
    prepMsg('Pedido enviado. Queda en la cola de tu PC; abajo ves cómo va.');
    // GitHub tarda unos segundos en mostrar el run nuevo: mirar seguido un rato
    COLA.esperarHasta = Date.now() + 120000;
    clearTimeout(COLA.timer);
    COLA.timer = setTimeout(refrescarCola, 3000);
  }

  function estadoRun(r) {
    if (r.status !== 'completed') return r.status === 'in_progress' ? 'procesando' : 'en cola';
    if (r.conclusion === 'success') return 'lista';
    if (r.conclusion === 'cancelled') return 'cancelada';
    return 'falló';
  }

  // Asocia cada run a un pedido hecho desde este dispositivo (por la hora) para
  // poder mostrar qué canción es; los pedidos de otro lado salen sin nombre.
  function nombreRuns(runs) {
    var libres = pedidos().slice(), nombres = {};
    runs.slice().reverse().forEach(function (r) {
      var t = Date.parse(r.created_at);
      for (var i = 0; i < libres.length; i++) {
        if (t >= libres[i].t - 30000 && t <= libres[i].t + 180000) {
          nombres[r.id] = libres[i].titulo || libres[i].url;
          libres.splice(i, 1);
          break;
        }
      }
    });
    return nombres;
  }

  async function refrescarCola() {
    clearTimeout(COLA.timer);
    var caja = q('#pxCola');
    if (S.screen !== 'lib' || !caja) return;
    var runs;
    try { runs = await SB.github.runsCancion(5); }
    catch (e) {
      if (q('#pxCola')) q('#pxCola').innerHTML = '<p class="prep-warn">No pude leer la cola: ' + esc(e.message) + '</p>';
      return;
    }
    caja = q('#pxCola');
    if (S.screen !== 'lib' || !caja) return;

    var nombres = nombreRuns(runs), activos = false, nuevaLista = false, ahora = Date.now();
    var filas = runs.map(function (r) {
      var est = estadoRun(r);
      if (est === 'en cola' || est === 'procesando') activos = true;
      var aviso = '';
      if (est === 'en cola' && ahora - Date.parse(r.created_at) > 5 * 60000) {
        aviso = ' <span class="ed-note">(si no avanza, el PC está apagado, suspendido o sin tu sesión)</span>';
      }
      if (est === 'lista' && !COLA.refrescados[r.id] && ahora - Date.parse(r.updated_at) < 30 * 60000) {
        COLA.refrescados[r.id] = true; nuevaLista = true;
      }
      var hora = new Date(r.created_at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      return '<tr><td>' + esc(nombres[r.id] || 'pedido') + '</td><td>' + esc(hora) + '</td><td><b>' + est + '</b>' + aviso +
        '</td><td><a href="' + esc(r.html_url) + '" target="_blank" rel="noopener" style="color:inherit">detalle</a></td></tr>';
    });
    caja.innerHTML = filas.length
      ? '<table class="rep"><thead><tr><th>Pedido</th><th>Hora</th><th>Estado</th><th></th></tr></thead><tbody>' + filas.join('') + '</tbody></table>'
      : '<p class="set-status">Todavía no hay pedidos.</p>';

    if (nuevaLista) {
      // la canción recién publicada: Pages tarda 1-2 min en servir el index.json nuevo
      drawLibrary();
      setTimeout(function () { if (S.screen === 'lib') drawLibrary(); }, 90000);
    }
    if (activos || ahora < COLA.esperarHasta) {
      COLA.timer = setTimeout(refrescarCola, activos ? 15000 : 4000);
    }
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
      language: q('#pxLang').value || null,
      detector: q('#pxDet').value,
      ejercicio: q('#pxEjer').checked ? '1' : ''
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
  function libMsg(txt) { var el = q('#kaLibStatus'); if (el) el.textContent = txt || ''; }

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

  /* ---------------- archivar (ocultar sin borrar, por dispositivo) ----------------
     "Archivar" es reversible y no toca el repo ni el navegador de otro: solo
     saca la fila de la vista principal en ESTE dispositivo. Para de verdad
     borrar (que sí es irreversible, y en las publicadas afecta a todos los que
     entren al sitio) está "Eliminar" aparte, con confirmación.
  */
  var ARCHKEY = 'sb.canta.archivadas';
  function archivadas() {
    try { return JSON.parse(localStorage.getItem(ARCHKEY) || '{}'); } catch (e) { return {}; }
  }
  function setArchivada(id, on) {
    var a = archivadas();
    if (on) a[id] = true; else delete a[id];
    try { localStorage.setItem(ARCHKEY, JSON.stringify(a)); } catch (e) {}
  }

  function filaLibreria(r, opts) {
    opts = opts || {};
    var botones = '';
    if (opts.archivada) {
      botones = '<button class="mini-x" data-unarch="' + esc(r.p.id) + '" title="Sacar de archivadas">Desarchivar</button>';
    } else {
      botones = '<button class="mini-x" data-arch="' + esc(r.p.id) + '" title="Ocultar de la lista, sin borrarla (solo en este dispositivo)">Archivar</button>';
      if (r.src === 'guardada') {
        botones += ' <button class="mini-x danger" data-del="' + esc(r.p.id) + '" title="Borrar de este navegador">Eliminar</button>';
      } else if (SB.cantaMotor.disponible()) {
        botones += ' <button class="mini-x danger" data-delmotor="' + esc(r.p.id) + '" title="Borrar del repositorio (con el motor)">Eliminar</button>';
      }
    }
    return '<tr class="song" data-id="' + esc(r.p.id) + '"><td class="t-title">' + esc(r.p.title) +
      '</td><td>' + esc(r.p.artist || '') + '</td><td class="t-key">' + fmtT(r.p.duration || 0) +
      '</td><td class="t-acc"><span class="badge">' + r.src + '</span> ' + botones + '</td></tr>';
  }

  async function drawLibrary() {
    var saved = await E().savedList();
    var server = await E().fetchServerList();
    var seen = {}, todas = [];
    (server || []).forEach(function (p) { seen[p.id] = true; todas.push({ p: p, src: 'servidor' }); });
    saved.forEach(function (p) { if (!seen[p.id]) todas.push({ p: p, src: 'guardada' }); });
    todas.sort(function (a, b) { return a.p.title.localeCompare(b.p.title); });
    if (S.screen !== 'lib' || !q('#kaList')) return;

    var arch = archivadas();
    var activas = todas.filter(function (r) { return !arch[r.p.id]; });
    var archivas = todas.filter(function (r) { return arch[r.p.id]; });

    q('#kaCount').textContent = activas.length + ' canciones' +
      (archivas.length ? ' · ' + archivas.length + ' archivada' + (archivas.length === 1 ? '' : 's') : '');

    var tb = q('#kaList tbody');
    tb.innerHTML = activas.map(function (r) { return filaLibreria(r); }).join('') ||
      '<tr class="stub"><td colspan="4">Sin canciones todavía — prepara una arriba, o prueba la demo.</td></tr>';

    var cajaArch = q('#kaArchBox');
    if (archivas.length) {
      cajaArch.hidden = false;
      cajaArch.innerHTML = '<button class="mini-app-btn" id="kaArchToggle">Ver ' + archivas.length +
        ' archivada' + (archivas.length === 1 ? '' : 's') + '</button><table class="rep" id="kaArchList" hidden>' +
        '<tbody>' + archivas.map(function (r) { return filaLibreria(r, { archivada: true }); }).join('') + '</tbody></table>';
      q('#kaArchToggle').addEventListener('click', function () {
        var t = q('#kaArchList'), on = t.hidden;
        t.hidden = !on;
        this.textContent = on ? 'Ocultar archivadas' : 'Ver ' + archivas.length + ' archivada' + (archivas.length === 1 ? '' : 's');
      });
    } else {
      cajaArch.hidden = true; cajaArch.innerHTML = '';
    }

    [tb, q('#kaArchList')].forEach(function (cont) {
      if (!cont) return;
      cont.querySelectorAll('tr.song').forEach(function (tr) {
        tr.addEventListener('click', function () { S.ctx.navigate('canta/song/' + encodeURIComponent(tr.dataset.id)); });
      });
      cont.querySelectorAll('button[data-arch]').forEach(function (b) {
        b.addEventListener('click', function (ev) { ev.stopPropagation(); setArchivada(b.dataset.arch, true); drawLibrary(); });
      });
      cont.querySelectorAll('button[data-unarch]').forEach(function (b) {
        b.addEventListener('click', function (ev) { ev.stopPropagation(); setArchivada(b.dataset.unarch, false); drawLibrary(); });
      });
      cont.querySelectorAll('button[data-del]').forEach(function (b) {
        b.addEventListener('click', async function (ev) {
          ev.stopPropagation();
          if (!confirm('¿Borrar esta canción de este navegador? No se puede deshacer.')) return;
          await E().deleteSaved(b.dataset.del);
          drawLibrary();
        });
      });
      cont.querySelectorAll('button[data-delmotor]').forEach(function (b) {
        b.addEventListener('click', async function (ev) {
          ev.stopPropagation();
          var id = b.dataset.delmotor;
          if (!confirm('¿Borrar "' + id + '" del repositorio? Esto la saca del sitio para todos y sube ' +
                       'un commit; no se puede deshacer desde aquí.')) return;
          b.disabled = true; b.textContent = 'Borrando…';
          try {
            var r = await SB.cantaMotor.eliminar(id);
            libMsg(r.mensaje);
            drawLibrary();
          } catch (e) {
            libMsg('No pude borrarla: ' + e.message);
            b.disabled = false; b.textContent = 'Eliminar';
          }
        });
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
          await E().loadFresh(id);
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
    // otra canción: la toma cargada y la grabación en curso no aplican
    S.grabando = false; S.tomaTrace = []; S.tomaTramos = []; S.tramo = null;
    S.tomaId = null; S.tomaCurva = null;
    E().setMine(null, 0);
    S.pkg = pkg;
    S.editando = false; S.selNota = null; S.sel = []; S.arrastre = null; S.edPila = [];
    S.melodia = pkg.detector || 'pyin';
    // respeta las plataformas que el usuario haya corregido a mano
    cargarNotasDe({ notes: pkg.notes, f0: pkg.f0 });
    S.lines = partirLargas(letraEfectiva(pkg));
    S.letraEditada = S.lines !== pkg.lines && S.lines.length > 0;
    S.lines = aplicarTiemposLetra(S.lines);   // palabras movidas a mano en el editor

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
      '<div class="ka-latov" title="Latencia. Si tu traza queda atrasada respecto a las plataformas, súbela; si queda adelantada, bájala">' +
      '<button id="kaLatOvM" aria-label="Bajar latencia 10 ms">◀</button><span id="kaLatOvV"></span>' +
      '<button id="kaLatOvP" aria-label="Subir latencia 10 ms">▶</button></div>' +
      '</div>' +

      '<div class="controls">' +
      '<button class="pr-play ka-play" id="kaPlay">CANTAR</button>' +
      '<button class="mini-app-btn" id="kaStop" title="Detiene, guarda la grabación y cierra el puntaje">Terminar</button>' +
      '<button class="mini-app-btn" id="kaListen" hidden title="Reproduce la canción con tu voz grabada, sin grabar ni evaluar">Escuchar mi toma</button>' +
      '<span class="t-key" id="kaTime">0:00 / ' + fmtT(E().duration()) + '</span>' +
      '<input type="range" class="ka-prog" id="kaProg" min="0" max="1000" value="0" aria-label="Posición">' +
      '<button class="mini-app-btn" id="kaEdit">Editar plataformas</button>' +
      '</div>' +

      '<div class="ka-edit" id="kaEditBar" hidden>' +
      '<div class="ka-edit-tips">' +
      '<b>Arrastra</b> una plataforma para moverla · <b>tira de los extremos</b> para alargarla · ' +
      '<b>arrastra en el vacío</b> para crear una · <b>toca</b> para elegir · ' +
      '<b>Ctrl+clic</b> (o "Varias") para elegir varias y moverlas juntas (sin sonido) · ' +
      '<b>Ctrl+C / Ctrl+V</b> copia y pega en el cabezal (muévelo con la barra de posición)' +
      '</div>' +
      '<div class="ka-edit-btns">' +
      '<button class="mini-app-btn" id="kaEdDel" disabled>Borrar</button>' +
      '<button class="mini-app-btn" id="kaEdMulti" aria-pressed="false" title="Tocar suma o quita plataformas de la selección (como Ctrl+clic)">Varias</button>' +
      '<button class="mini-app-btn" id="kaEdCopy" disabled>Copiar</button>' +
      '<button class="mini-app-btn" id="kaEdPaste" disabled>Pegar</button>' +
      '<button class="mini-app-btn" id="kaEdUndo" disabled>Deshacer</button>' +
      '<button class="mini-app-btn" id="kaEdReset">Volver a la original</button>' +
      (puedePublicar() ? '<button class="mini-app-btn" id="kaEdPub">Publicar para todos</button>' : '') +
      '<button class="mini-app-btn" id="kaEdDone">Listo</button>' +
      '</div>' +
      '<p class="set-status" id="kaEdMsg"></p>' +
      '</div>' +

      '<div class="controls ka-ctl">' +
      '<div class="ctl"><span class="ctl-label">Voz</span><input type="range" id="kaVolV" min="0" max="130" aria-label="Volumen voz"></div>' +
      '<div class="ctl"><span class="ctl-label">Música</span><input type="range" id="kaVolM" min="0" max="130" aria-label="Volumen música"></div>' +
      '<div class="ctl" id="kaMineWrap" hidden><span class="ctl-label" title="Tu propia grabación, para compararte con el original">Mi voz</span>' +
      '<input type="range" id="kaVolMine" min="0" max="130" aria-label="Volumen de tu voz">' +
      '<span class="ctl-label" title="Empareja lo fuerte y lo suave: la voz queda pareja y más adelante">Compresión</span>' +
      '<input type="range" id="kaFxComp" min="0" max="100" aria-label="Compresión de tu voz">' +
      '<span class="ctl-label" title="Realza la presencia y el aire: más claridad">Brillo</span>' +
      '<input type="range" id="kaFxBri" min="0" max="100" aria-label="Brillo de tu voz">' +
      '<span class="ctl-label" title="Sensación de sala, como en un estudio">Reverb</span>' +
      '<input type="range" id="kaFxRev" min="0" max="100" aria-label="Reverb de tu voz"></div>' +
      '<div class="ctl"><span class="ctl-label" title="Cada clic sube o baja medio tono (un semitono); se muestra en tonos">Tono</span><div class="stepper">' +
      '<button id="kaSemD" aria-label="Bajar medio tono">−</button><span class="val" id="kaSem">0</span><button id="kaSemU" aria-label="Subir medio tono">+</button></div></div>' +
      '<div class="ctl"><span class="ctl-label">Velocidad</span><div class="stepper">' +
      '<button id="kaTemD" aria-label="Más lento">−</button><span class="val" id="kaTem">100%</span><button id="kaTemU" aria-label="Más rápido">+</button></div></div>' +
      '<div class="ctl" id="kaMelWrap" hidden><span class="ctl-label" title="La canción trae la melodía calculada por dos detectores distintos. Si la línea salta de registro, prueba el neuronal; si el carril se ve vacío, prueba el clásico">Melodía</span><div class="seg" id="kaMelSeg">' +
      '<button data-d="pyin">Clásica</button><button data-d="crepe">Neuronal</button></div></div>' +
      '<div class="ctl"><span class="ctl-label">Escucha</span><div class="seg" id="kaMicSeg">' +
      '<button data-m="off">Off</button><button data-m="mic">Mic</button><button data-m="test">Prueba</button></div></div>' +
      '<div class="ctl" id="kaMicDevWrap" hidden><span class="ctl-label" title="Si tienes una interfaz de audio conectada, elígela aquí. El navegador usa el micrófono del sistema salvo que le indiques otro">Entrada</span>' +
      '<select id="kaMicDev"></select></div>' +
      '<label class="check" title="Con audífonos se apaga la cancelación de eco del navegador, que atenúa el micrófono cada vez que suena la música y corta tu voz a pedazos"><input type="checkbox" id="kaAudif"> Audífonos</label>' +
      '<label class="check" title="Para iPhone 6 y otros equipos antiguos: apaga la cancelación de eco del navegador (que en iOS deja la reproducción saturada) y usa un análisis de micrófono más liviano. Si tu equipo es moderno déjalo desmarcado"><input type="checkbox" id="kaAntiguo"> Equipo antiguo</label>' +
      '<label class="check" title="Guarda lo que cantas para poder escucharte después y compararte con el original. Las grabaciones quedan solo en este dispositivo"><input type="checkbox" id="kaGrabar"> Grabar mi voz</label>' +
      '<div class="ctl"><span class="ctl-label" title="Recreativo: sostener el tono un momento gana la plataforma entera. Avanzado: tramos verdes y rojos, con más margen. Estricto: tramos verdes y rojos, afinación justa">Nivel</span><div class="seg" id="kaNivelSeg">' +
      '<button data-n="recreativo">Recreativo</button><button data-n="avanzado">Avanzado</button><button data-n="estricto">Estricto</button></div></div>' +
      '<label class="check" title="Acepta tu canto en la octava que te acomode (hombre cantando una canción de mujer, etc.). Desmarcado: exige la octava exacta"><input type="checkbox" id="kaOct"> Octava libre</label>' +
      '<div class="ctl"><span class="ctl-label" title="Compensación del retardo parlante→micrófono→proceso. Si cantas bien pero te marca corrido, ajústala de a 10 ms">Latencia</span><div class="stepper">' +
      '<button id="kaLatD" aria-label="Menos latencia">−</button><span class="val" id="kaLat"></span><button id="kaLatU" aria-label="Más latencia">+</button></div>' +
      '<button class="mini-app-btn" id="kaLatCal" title="Suena una serie de clics: da una palmada junto a cada uno y calculo tu latencia sola">Calibrar</button></div>' +
      '</div>' +
      '<div class="ka-cal" id="kaCalBox" hidden>' +
      '<div class="ka-cal-num" id="kaCalNum">—</div>' +
      '<div class="ka-cal-txt" id="kaCalTxt"></div>' +
      '<div class="ka-cal-btns">' +
      '<button class="mini-app-btn" id="kaCalGo">Empezar</button>' +
      '<button class="mini-app-btn" id="kaCalUsar" hidden>Usar este valor</button>' +
      '<button class="mini-app-btn" id="kaCalCerrar">Cerrar</button>' +
      '</div></div>' +
      '<p class="set-status" id="kaStatus"></p>' +
      '<section class="ka-takes" id="kaTakes" hidden>' +
      '<h2>Lo que cantaste</h2>' +
      '<div id="kaTakeList"></div>' +
      '<p class="set-status" id="kaTakeMsg"></p>' +
      '</section>' +
      '</div>';

    S.els = {
      canvas: q('#kaCanvas'),
      score: q('#kaScore'), streak: q('#kaStreak'), best: q('#kaBest'),
      play: q('#kaPlay'), time: q('#kaTime'), prog: q('#kaProg'), status: q('#kaStatus')
    };
    readColors();

    // eventos
    q('#kaBack').addEventListener('click', function () { S.ctx.navigate('canta'); });
    q('#kaSaveLyr').addEventListener('click', saveLyrics);
    S.els.play.addEventListener('click', togglePlay);
    q('#kaStop').addEventListener('click', terminar);
    q('#kaListen').addEventListener('click', escucharToma);
    S.els.prog.addEventListener('input', function () {
      var t = (+this.value / 1000) * E().duration();
      E().seek(t); resetRunFrom(t);
    });
    var volV = q('#kaVolV'), volM = q('#kaVolM');
    volV.value = Math.round(S.cfg.volV * 100); volM.value = Math.round(S.cfg.volM * 100);
    E().setVol('vocals', S.cfg.volV); E().setVol('music', S.cfg.volM);
    volV.addEventListener('input', function () { S.cfg.volV = +this.value / 100; E().setVol('vocals', S.cfg.volV); saveCfg(); });
    volM.addEventListener('input', function () { S.cfg.volM = +this.value / 100; E().setVol('music', S.cfg.volM); saveCfg(); });
    var volMine = q('#kaVolMine');
    volMine.value = Math.round((S.cfg.volMine != null ? S.cfg.volMine : 1) * 100);
    E().setVol('mine', S.cfg.volMine != null ? S.cfg.volMine : 1);
    // filtros de estudio para tu voz grabada (corte de graves fijo + estos tres)
    var fx = S.cfg.fx || (S.cfg.fx = { comp: 0.5, brillo: 0.4, reverb: 0.25 });
    E().setFx(fx);
    [['#kaFxComp', 'comp'], ['#kaFxBri', 'brillo'], ['#kaFxRev', 'reverb']].forEach(function (par) {
      var el = q(par[0]);
      el.value = Math.round((fx[par[1]] != null ? fx[par[1]] : 0) * 100);
      el.addEventListener('input', function () {
        fx[par[1]] = +this.value / 100;
        var cambio = {}; cambio[par[1]] = fx[par[1]];
        E().setFx(cambio); saveCfg();
      });
    });
    volMine.addEventListener('input', function () {
      S.cfg.volMine = +this.value / 100; E().setVol('mine', S.cfg.volMine); saveCfg();
    });

    // --- calibrador de latencia ---
    // Suenan clics en instantes que conocemos exactos; tú das una palmada junto
    // a cada uno. El desfase entre lo que sonó y lo que volvió por el micrófono
    // ES la latencia, medida en vez de adivinada.
    var calBox = q('#kaCalBox'), calNum = q('#kaCalNum'), calTxt = q('#kaCalTxt');
    var calGo = q('#kaCalGo'), calUsar = q('#kaCalUsar'), calMedida = null;

    function calCerrar() {
      calBox.hidden = true; calUsar.hidden = true;
      calNum.textContent = '—'; calTxt.textContent = ''; calMedida = null;
    }
    q('#kaLatCal').addEventListener('click', function () {
      if (!calBox.hidden) { calCerrar(); return; }
      calBox.hidden = false; calUsar.hidden = true; calMedida = null;
      calNum.textContent = '—';
      calTxt.textContent = 'Van a sonar 8 clics. Da una palmada justo con cada uno, cerca del micrófono.';
      calGo.disabled = false;
    });
    q('#kaCalCerrar').addEventListener('click', calCerrar);

    calGo.addEventListener('click', async function () {
      // Micrófono PROPIO y crudo, sin cancelación de eco: la del canto atenúa
      // todo lo que entra mientras suena el parlante, y las palmadas caen justo
      // encima de cada clic. En el computador se las comía; en el celular no.
      if (calGo.disabled) return;
      calGo.disabled = true; // antes del await: un doble clic lanzaba dos pruebas superpuestas
      var stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
      } catch (e) {
        calTxt.textContent = 'No pude abrir el micrófono: ' + e.message;
        calGo.disabled = false;
        return;
      }
      E().pause(); updatePlayBtn();
      calGo.disabled = true; calUsar.hidden = true; calMedida = null;
      try {
        var r = await E().pruebaLatencia({
          stream: stream, clics: 8, intervalo: 0.8,
          onTick: function (n, total, faltan) {
            if (n > 0) {
              calNum.textContent = n + ' / ' + total;
              calTxt.textContent = '¡Palmada con cada clic!';
            } else {
              calNum.textContent = String(Math.max(1, Math.ceil(faltan)));
              calTxt.textContent = 'Prepárate: la primera palmada va con el primer clic.';
            }
          }
        });
        calNum.textContent = '—';
        if (r.error) {
          calTxt.textContent = r.error + '. Prueba de nuevo, más cerca del micrófono y con palmadas fuertes.';
        } else if (!r.confiable) {
          calTxt.textContent = 'Medí ' + Math.round(r.latencia * 1000) + ' ms con ' + r.emparejados +
            ' palmadas, pero van muy dispares (±' + Math.round(r.dispersion * 1000) +
            ' ms) para fiarme. Repite marcando parejo.';
          calMedida = r.latencia; calUsar.hidden = false;
        } else {
          calNum.textContent = Math.round(r.latencia * 1000) + ' ms';
          calTxt.textContent = 'Medido con ' + r.emparejados + ' palmadas (±' +
            Math.round(r.dispersion * 1000) + ' ms). Ahora tienes ' +
            Math.round(S.cfg.latency * 1000) + ' ms.';
          calMedida = r.latencia; calUsar.hidden = false;
        }
      } catch (e) {
        calTxt.textContent = 'No pude hacer la prueba: ' + e.message;
      }
      stream.getTracks().forEach(function (t) { t.stop(); });
      calGo.disabled = false;
    });

    calUsar.addEventListener('click', function () {
      if (calMedida == null) return;
      S.cfg.latency = calMedida; saveCfg(); updateSteppers();
      calTxt.textContent = 'Listo: latencia en ' + Math.round(calMedida * 1000) + ' ms.';
      calUsar.hidden = true;
    });

    // --- editor de plataformas ---
    q('#kaEdit').addEventListener('click', function () { setEditando(!S.editando); });
    q('#kaEdDone').addEventListener('click', function () { setEditando(false); });
    q('#kaEdDel').addEventListener('click', function () { borrarSel(false); });
    q('#kaEdMulti').addEventListener('click', function () {
      S.multiSel = !S.multiSel;
      this.setAttribute('aria-pressed', S.multiSel ? 'true' : 'false');
      this.classList.toggle('on', S.multiSel);
      edMsg(S.multiSel ? 'Selección múltiple: cada toque suma o quita una plataforma.' : selMsg());
    });
    q('#kaEdCopy').addEventListener('click', copiarSel);
    q('#kaEdPaste').addEventListener('click', pegar);
    q('#kaEdUndo').addEventListener('click', deshacer);
    q('#kaEdReset').addEventListener('click', function () {
      empujarDeshacer();
      olvidarNotas();
      cargarNotasDe(melodiaActiva());
      resetRunFrom(E().position() - S.cfg.latency);
      edMsg('Volví a la melodía original: ' + S.notes.length + ' plataformas.');
      SB.canta.redibujar();
    });
    if (q('#kaEdPub')) q('#kaEdPub').addEventListener('click', publicarPlataformas);
    var cvEd = S.els.canvas;
    cvEd.addEventListener('pointerdown', edPointerDown);
    cvEd.addEventListener('pointermove', edPointerMove);
    cvEd.addEventListener('pointerup', edPointerUp);
    cvEd.addEventListener('pointercancel', edPointerUp);
    document.addEventListener('keydown', function (e) {
      if (!S.editando || S.screen !== 'play') return;
      if (e.key === 'Delete' || e.key === 'Backspace') { borrarSel(false); e.preventDefault(); }
      else if (e.key === 'Escape') setEditando(false);
      else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) { deshacer(); e.preventDefault(); }
      else if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey)) { if (copiarSel()) e.preventDefault(); }
      else if ((e.key === 'v' || e.key === 'V') && (e.ctrlKey || e.metaKey)) { if (pegar()) e.preventDefault(); }
    });

    var grab = q('#kaGrabar');
    grab.checked = !!S.cfg.grabar;
    grab.addEventListener('change', function () {
      S.cfg.grabar = grab.checked; saveCfg();
      if (!grab.checked && S.grabando) { S.grabando = false; E().recStop(); }
      status(grab.checked
        ? 'Voy a grabar lo que cantes; queda guardado solo en este dispositivo.'
        : 'No grabaré tu voz.');
    });

    // panel de tomas: un solo escuchador para toda la lista
    q('#kaTakeList').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-a]');
      if (!btn) return;
      var id = btn.closest('.ka-take').dataset.id;
      if (btn.dataset.a === 'load') cargarToma(id);
      else if (btn.dataset.a === 'cal') calibrarConToma(id);
      else if (btn.dataset.a === 'del') {
        if (S.tomaId === id) { S.tomaId = null; S.tomaCurva = null; E().setMine(null, 0); q('#kaMineWrap').hidden = true; }
        E().takeDelete(id).then(function () { pintarTomas(); takeMsg('Grabación borrada.'); });
      }
    });
    pintarTomas();
    q('#kaSemD').addEventListener('click', function () { bumpSemis(-1); });
    q('#kaSemU').addEventListener('click', function () { bumpSemis(1); });
    q('#kaTemD').addEventListener('click', function () { bumpTempo(-5); });
    q('#kaTemU').addEventListener('click', function () { bumpTempo(5); });
    q('#kaMicSeg').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { setMicMode(b.dataset.m); });
    });
    var nivelBtns = q('#kaNivelSeg').querySelectorAll('button');
    var marcarNivel = function () {
      nivelBtns.forEach(function (b) {
        b.setAttribute('aria-pressed', b.dataset.n === (NIVELES[S.cfg.nivel] ? S.cfg.nivel : 'recreativo') ? 'true' : 'false');
      });
    };
    nivelBtns.forEach(function (b) {
      b.addEventListener('click', function () { S.cfg.nivel = b.dataset.n; saveCfg(); marcarNivel(); });
    });
    marcarNivel();

    var oct = q('#kaOct');
    oct.checked = S.cfg.octaveFree;
    oct.addEventListener('change', function () { S.cfg.octaveFree = oct.checked; saveCfg(); });

    // interruptor de melodia: solo si el paquete trae las dos versiones
    var mels = pkg.melodias || {};
    if (mels.pyin && mels.crepe) {
      q('#kaMelWrap').hidden = false;
      var recordada = null;
      try { recordada = localStorage.getItem('sb.canta.melodia.' + pkg.id); } catch (e) {}
      setMelodia(mels[recordada] ? recordada : (pkg.detector || 'pyin'), true);
      q('#kaMelSeg').addEventListener('click', function (e) {
        var b = e.target.closest('button[data-d]');
        if (b) setMelodia(b.dataset.d);
      });
    }

    var ant = q('#kaAntiguo');
    ant.checked = !!S.cfg.antiguo;
    ant.addEventListener('change', function () {
      S.cfg.antiguo = ant.checked; saveCfg();
      if (S.micMode === 'mic') setMicMode('mic', true);
      status(ant.checked
        ? 'Modo equipo antiguo: sin cancelación de eco del navegador, análisis liviano. Con parlantes la música se cuela al micrófono: mejor audífonos.'
        : 'Modo normal.');
    });

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
    q('#kaLatOvM').addEventListener('click', function () { bumpLat(-0.01); });
    q('#kaLatOvP').addEventListener('click', function () { bumpLat(0.01); });
    q('#kaLatU').addEventListener('click', function () { bumpLat(0.01); });

    E().setOnEnded(function () {
      if (S.soloEscuchar) { S.soloEscuchar = false; status(''); updatePlayBtn(); return; }
      cerrarToma();
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
    if (E().playing()) { E().pause(); cerrarToma(); }
    else {
      E().ctx(); // gesto del usuario: despierta el AudioContext
      if (E().position() >= E().duration() - 0.05) { E().seek(0); resetRunFrom(0); }
      if (S.score === 0 && E().position() < 0.05) resetRunFrom(0);
      S.soloEscuchar = false;
      E().play();
      abrirToma();
      status('');
    }
    updatePlayBtn();
  }

  /* ---------------- grabar lo que cantas ---------------- */
  // Se graba sola mientras el micrófono está activo: la gracia es poder
  // escucharse después, y pedir permiso cada vez rompe el ritmo de ensayo.
  function abrirToma() {
    if (S.micMode !== 'mic' || !S.cfg.grabar) return;
    var stream = SB.cantaPitch.stream();
    if (!stream || !E().recSoportado()) return;
    S.tomaTrace = [];
    S.tomaTempo = E().tempo(); S.tomaSemis = E().semis();
    S.grabando = E().recStart(stream);
    if (!S.grabando) return;
    // El micrófono graba de corrido, pero la canción puede pausarse o saltar.
    // Se anota en qué punto de la canción cae cada trozo de grabación, para
    // poder recomponerla después en su sitio y con silencio en los huecos.
    S.grabBase = E().ctx().currentTime;
    S.tomaTramos = [];
    abrirTramo();
  }

  function abrirTramo() {
    S.tramo = { grab0: E().ctx().currentTime - S.grabBase, canc0: E().position(),
                ultGrab: E().ctx().currentTime - S.grabBase, ultPos: E().position() };
  }

  function cerrarTramo() {
    var T = S.tramo;
    S.tramo = null;
    if (!T) return;
    var grab1 = E().ctx().currentTime - S.grabBase;
    if (grab1 - T.grab0 < 0.15) return;   // un pestañeo: no vale la pena
    S.tomaTramos.push({ grab0: +T.grab0.toFixed(3), grab1: +grab1.toFixed(3),
                        canc0: +T.canc0.toFixed(3) });
  }

  // Vigila que la canción siga corriendo pareja con la grabación. Si se pausó o
  // saltó (arrastraste la barra), se corta el tramo y empieza otro: así lo que
  // cantaste no se pega al trozo anterior y queda donde corresponde.
  function vigilarTramos() {
    if (!S.grabando) return;
    var sonando = E().playing();
    if (!sonando) { if (S.tramo) cerrarTramo(); return; }
    if (!S.tramo) { abrirTramo(); return; }
    var grabAhora = E().ctx().currentTime - S.grabBase;
    var pos = E().position();
    var esperado = S.tramo.ultPos + (grabAhora - S.tramo.ultGrab) * E().tempo();
    if (Math.abs(pos - esperado) > 0.3) {   // hubo un salto en la canción
      cerrarTramo();
      abrirTramo();
      return;
    }
    S.tramo.ultGrab = grabAhora; S.tramo.ultPos = pos;
  }

  function cerrarToma() {
    if (!S.grabando) return;
    cerrarTramo();
    S.grabando = false;
    var traza = S.tomaTrace, tempo = S.tomaTempo, semis = S.tomaSemis;
    var tramos = S.tomaTramos || [];
    var puntaje = S.score, songId = S.pkg && S.pkg.id;
    E().recStop().then(function (blob) {
      if (!blob || !songId || traza.length < 20) return; // apenas cantaste: no la guardamos
      var toma = {
        id: songId + '-' + Date.now(),
        songId: songId, fecha: Date.now(),
        dur: traza.length ? traza[traza.length - 1].t - traza[0].t : 0,
        tempo: tempo, semis: semis, puntaje: puntaje,
        latencia: S.cfg.latency,
        tramos: tramos,
        blob: blob, trace: traza
      };
      return E().takePut(toma).then(function () {
        pintarTomas();
        status('Guardé lo que cantaste (' + Math.round(toma.dur) + ' s). Está abajo, en "Lo que cantaste".');
      });
    }).catch(function (e) { status('No pude guardar la grabación: ' + e.message); });
  }
  function updatePlayBtn() {
    var cantando = E().playing() && !S.soloEscuchar;
    S.els.play.textContent = cantando ? 'PAUSA' : 'CANTAR';
    S.els.play.classList.toggle('playing', cantando);
    var l = q('#kaListen');
    if (l) {
      l.hidden = !S.tomaId;
      l.textContent = E().playing() && S.soloEscuchar ? 'Pausa' : 'Escuchar mi toma';
    }
  }

  // Termina la sesión de canto: guarda la grabación, cierra el puntaje y deja
  // todo listo para empezar de nuevo desde el principio.
  function terminar() {
    if (S.rendering) return;
    var escuchando = S.soloEscuchar;
    E().pause();
    S.soloEscuchar = false;
    if (!escuchando) {
      cerrarToma();
      finalizeAll();
      var total = S.score;
      saveBest(S.pkg.id, total);
      S.best = bestFor(S.pkg.id);
      status('Terminado. Puntaje: ' + total + (total > 0 && total >= S.best ? ' — ¡tu mejor marca!' : ''));
    }
    E().seek(0);
    resetRunFrom(0);
    updatePlayBtn();
  }

  // Escuchar una toma ya grabada: suena la canción con tu voz, sin grabar
  // otra encima ni evaluar (si no, parecía que hacías una versión nueva).
  function escucharToma() {
    if (S.rendering || !S.tomaId) return;
    if (E().playing()) {
      if (S.soloEscuchar) { E().pause(); updatePlayBtn(); return; }
      E().pause(); cerrarToma();
    }
    E().ctx();
    if (E().position() >= E().duration() - 0.05) E().seek(0);
    S.soloEscuchar = true;
    E().play();
    status('Escuchando tu toma.');
    updatePlayBtn();
  }

  function bumpSemis(d) {
    S.pendSemis = Math.max(-12, Math.min(12, S.pendSemis + d));
    updateSteppers(); scheduleApply();
  }
  function bumpTempo(d) {
    S.pendTempo = Math.max(50, Math.min(150, S.pendTempo + d));
    updateSteppers(); scheduleApply();
  }
  // deja el transporte en el tempo/tono con que se grabó una toma
  function aplicarTempoSemis(tempo, semis) {
    S.pendTempo = Math.round(tempo * 100);
    S.pendSemis = semis;
    updateSteppers(); scheduleApply();
  }
  function bumpLat(d) {
    S.cfg.latency = Math.max(0, Math.min(LAT_MAX, Math.round((S.cfg.latency + d) * 100) / 100));
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
    var ov = q('#kaLatOvV');
    if (ov) ov.textContent = Math.round(S.cfg.latency * 1000) + ' ms';
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

  /* ---------------- elegir la melodia (pyin / crepe) ---------------- */
  // El paquete puede traer la melodia de los dos detectores. Cambiarla en vivo
  // reinicia el puntaje (las notas contra las que se evalua son otras), pero
  // no toca el audio ni la posicion.
  // la melodía vigente del paquete (la del detector elegido, o la suelta si el
  // paquete es viejo y trae una sola)
  function melodiaActiva() {
    var pkg = S.pkg;
    if (!pkg) return null;
    var m = pkg.melodias && pkg.melodias[S.melodia];
    return m || { notes: pkg.notes, f0: pkg.f0 };
  }

  // Carga las notas a S.notes. Si hay plataformas editadas a mano para esta
  // canción y este detector, mandan ellas: son correcciones del usuario.
  function cargarNotasDe(m) {
    var editadas = notasGuardadas();
    var fuente = editadas || (m && m.notes) || [];
    S.notes = fuente.map(function (n) {
      return { s: n.s, e: n.e, m: n.m, segs: [], hitT: 0, totT: 0, done: false, green: false, scored: false, pts: 0 };
    }).sort(function (a, b) { return a.s - b.s; });
    S.notesEditadas = !!editadas;
    S.f0 = m && m.f0 && m.f0.v && m.f0.v.length ? m.f0 : null;
    S.finPtr = 0; S.trace = []; S.score = 0; S.streak = 0; S.selNota = null; S.sel = [];
    return S.notes.length;
  }

  function setMelodia(det, silent) {
    var pkg = S.pkg, m = pkg && pkg.melodias && pkg.melodias[det];
    if (!m) return;
    pkg.detector = det;
    S.melodia = det;
    pkg.notes = m.notes; pkg.f0 = m.f0;
    cargarNotasDe(m);
    q('#kaMelSeg').querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.d === det ? 'true' : 'false');
    });
    updateHud();
    try { localStorage.setItem('sb.canta.melodia.' + pkg.id, det); } catch (e) {}
    if (!silent) status((det === 'crepe'
      ? 'Melodía neuronal (crepe): sin saltos de octava, algo menos de notas.'
      : 'Melodía clásica (pyin): más notas, puede saltar de octava en voces graves.')
      + (S.notesEditadas ? ' Con tus plataformas editadas.' : ''));
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
      deviceId: S.cfg.micDev, audifonos: !!S.cfg.audifonos, antiguo: !!S.cfg.antiguo
    }).then(function () {
      if (mode === 'mic') poblarMicrofonos();
      var inf = S.cfg.antiguo && mode === 'mic' ? SB.cantaPitch.info() : null;
      if (inf) status('Equipo antiguo · eco del navegador: ' + (inf.eco ? 'SÍ' : 'no') +
        ' · audio ' + inf.hz + ' Hz · mic ' + (inf.micHz || '?') + ' Hz');
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

  /* ---------------- panel de tomas ---------------- */
  function fechaCorta(ms) {
    var d = new Date(ms);
    return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' +
           ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function pintarTomas() {
    updatePlayBtn();   // "Escuchar mi toma" aparece/desaparece con la toma cargada
    var sec = q('#kaTakes'), lista = q('#kaTakeList');
    if (!sec || !lista || !S.pkg) return;
    E().takeList(S.pkg.id).then(function (tomas) {
      if (!tomas.length) { sec.hidden = true; return; }
      sec.hidden = false;
      lista.innerHTML = tomas.map(function (t) {
        var cargada = S.tomaId === t.id;
        var extra = (t.tempo !== 1 || t.semis !== 0)
          ? ' · ' + Math.round(t.tempo * 100) + '%' + (t.semis ? ' · ' + (t.semis > 0 ? '+' : '') + t.semis + ' st' : '')
          : '';
        return '<div class="ka-take' + (cargada ? ' on' : '') + '" data-id="' + esc(t.id) + '">' +
          '<span class="ka-take-h">' + fechaCorta(t.fecha) + ' · ' + Math.round(t.dur) + ' s · ' +
          (t.puntaje || 0) + ' pts' + extra + '</span>' +
          '<span class="ka-take-b">' +
          '<button class="mini-app-btn" data-a="load">' + (cargada ? 'Quitar' : 'Escuchar') + '</button>' +
          '<button class="mini-app-btn" data-a="cal">Calibrar latencia</button>' +
          '<button class="mini-app-btn" data-a="del">Borrar</button>' +
          '</span></div>';
      }).join('');
    });
  }

  // Monta (o desmonta) una toma como tercera pista, con su curva de tono.
  // La toma se grabó sobre un render concreto: si el tempo o el tono de ahora
  // no son los mismos, no calzaría, así que se vuelve a los de la grabación.
  function cargarToma(id) {
    if (S.tomaId === id) {  // ya estaba puesta: quitarla
      S.tomaId = null; S.tomaCurva = null;
      E().setMine(null, 0);
      q('#kaMineWrap').hidden = true;
      pintarTomas(); takeMsg('Quité tu voz de la mezcla.');
      return;
    }
    takeMsg('Cargando…');
    E().takeGet(id).then(function (rec) {
      if (!rec) { takeMsg('Esa grabación ya no está.'); return; }
      return E().decodeBlob(rec.blob).then(function (buf) {
        var aviso = '';
        if (rec.tempo !== E().tempo() || rec.semis !== E().semis()) {
          aviso = ' Volví a ' + Math.round(rec.tempo * 100) + '% y ' +
                  (rec.semis > 0 ? '+' : '') + rec.semis + ' semitonos, que es como la cantaste.';
          aplicarTempoSemis(rec.tempo, rec.semis);
        }
        S.tomaId = id;
        S.tomaCurva = rec.trace || null;
        S.tomaLat = rec.latencia || 0;
        // recomponer en el tiempo de la canción: cada trozo en su sitio y
        // silencio donde pausaste
        E().setMine(E().alinearToma(buf, rec.tramos, E().duration()), 0);
        var w = q('#kaMineWrap'); if (w) w.hidden = false;
        pintarTomas();
        takeMsg('Tu voz está en la mezcla; súbela o bájala con "Mi voz". Tu línea sale punteada.' + aviso);
      });
    }).catch(function (e) { takeMsg('No pude cargarla: ' + e.message); });
  }

  function calibrarConToma(id) {
    takeMsg('Comparando tu voz con la original…');
    E().takeGet(id).then(function (rec) {
      if (!rec || !rec.trace) { takeMsg('Esa grabación no tiene curva de tono.'); return; }
      var r = calibrarLatencia(S.f0, rec.trace, rec.latencia || 0);
      if (!r) { takeMsg('No hay suficiente canto en esa toma para medir la latencia.'); return; }
      if (!r.confiable) {
        takeMsg('Medí ' + Math.round(r.latencia * 1000) + ' ms, pero no me fío: ' +
          (r.rangoMelodia < 2 ? 'el tramo que cantaste es casi una sola nota.'
                              : 'tu canto no sigue de cerca la melodía.') +
          ' Canta un trozo largo siguiendo la melodía y vuelve a probar.');
        return;
      }
      var antes = Math.round(S.cfg.latency * 1000);
      S.cfg.latency = r.latencia; saveCfg(); updateSteppers();
      var tono = Math.abs(r.desvioTono) < 0.7 ? ''
        : ' De paso: cantaste ' + (r.desvioTono > 0 ? 'más agudo' : 'más grave') +
          ' que el original, unos ' + Math.abs(Math.round(r.desvioTono)) + ' semitonos' +
          (Math.abs(Math.abs(r.desvioTono) - 12) < 2 ? ' (o sea, una octava, que está perfecto)' : '') + '.';
      takeMsg('Latencia ajustada: ' + antes + ' ms → ' + Math.round(r.latencia * 1000) + ' ms, ' +
        'comparando ' + r.puntos + ' momentos de tu voz con la original.' + tono);
    }).catch(function (e) { takeMsg('No pude calibrar: ' + e.message); });
  }

  function takeMsg(t) { var e = q('#kaTakeMsg'); if (e) e.textContent = t || ''; }

  /* ---------------- comparación de curvas y latencia ---------------- */
  // Busca el desfase que mejor alinea lo que cantaste con la voz original.
  //
  // No compara alturas absolutas sino la FORMA: si cantas una octava abajo, o
  // transpuesto, la diferencia contra el original es grande pero CONSTANTE.
  // Por eso se mide la dispersión de esa diferencia: cuando el desfase es el
  // correcto, las dos curvas suben y bajan juntas y la dispersión cae al
  // mínimo. Así funciona igual para voz de hombre sobre canción de mujer.
  function calibrarLatencia(f0, traza, latActual) {
    if (!f0 || !f0.v || !traza || traza.length < 30) return null;
    var dt = f0.dt, v = f0.v;
    var origEn = function (t) {
      var i = Math.round(t / dt);
      if (i < 0 || i >= v.length) return 0;
      return v[i];
    };
    // la traza viene con la latencia actual ya descontada: se re-suma para
    // razonar siempre sobre el tiempo crudo de captura
    var pts = traza.filter(function (p) { return p.m > 0; })
                   .map(function (p) { return { t: p.t + latActual, m: p.m }; });
    if (pts.length < 30) return null;

    var mejor = null;
    for (var d = -0.10; d <= LAT_MAX + 0.00001; d += 0.005) {
      var difs = [], origs = [];
      for (var i = 0; i < pts.length; i++) {
        var ov = origEn(pts[i].t - d);
        if (ov > 0) { difs.push(pts[i].m - ov); origs.push(ov); }
      }
      if (difs.length < 20) continue;
      // dispersión robusta: mediana de |dif - mediana|, insensible a los
      // saltos de octava sueltos que igual deja pasar el detector
      var ord = difs.slice().sort(function (a, b) { return a - b; });
      var med = ord[ord.length >> 1];
      var abs = difs.map(function (x) { return Math.abs(x - med); })
                    .sort(function (a, b) { return a - b; });
      var disp = abs[abs.length >> 1];
      // se premia tener más puntos comparables: un desfase que solapa poco
      // puede dar dispersión baja por casualidad
      var puntaje = disp + 0.4 * (1 - difs.length / pts.length);
      if (!mejor || puntaje < mejor.puntaje) {
        mejor = { d: d, puntaje: puntaje, disp: disp, n: difs.length, offset: med, orig: origs };
      }
    }
    if (!mejor) return null;
    // ¿la melodía comparada sube y baja, o es toda la misma nota? Sobre un
    // tramo plano cualquier desfase calza igual de bien y el resultado no
    // significa nada: hay que decirlo en vez de proponer un numero al azar.
    var o = mejor.orig.slice().sort(function (a, b) { return a - b; });
    var varOrig = o[Math.floor(o.length * 0.9)] - o[Math.floor(o.length * 0.1)];
    return {
      latencia: Math.max(0, Math.min(LAT_MAX, Math.round(mejor.d * 100) / 100)),
      dispersion: mejor.disp,
      puntos: mejor.n,
      rangoMelodia: varOrig,
      // cuántos semitonos, en promedio, cantaste por sobre o bajo el original
      desvioTono: mejor.offset,
      // hace falta cantar un buen rato Y que la melodía tenga altibajos:
      // ~4 s de voz sobre un tramo que recorra al menos 2 semitonos
      confiable: mejor.disp < 1.6 && mejor.n >= 250 && varOrig >= 2
    };
  }

  // expuesta para poder medirla con curvas sintéticas (ver README)
  SB.cantaCalibrar = calibrarLatencia;

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
        n.segs = []; n.hitT = 0; n.totT = 0; n.done = false; n.green = false; n.logrado = false;
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
  function onPitchSample(sample, crudo) {
    // nivel de entrada para el medidor (llega aunque la canción esté pausada)
    if (crudo && typeof crudo.rms === 'number') {
      var db = 20 * Math.log10(Math.max(crudo.rms, 1e-6));
      var entrada = Math.max(0, Math.min(1, (db + 60) / 54));    // -60 dB .. -6 dB
      S.nivelMic = Math.max(entrada, (S.nivelMic || 0) * 0.85);  // sube al tiro, baja suave
      S.picoMic = db > -3 ? performance.now() : (S.picoMic || 0);
    }
    if (S.screen !== 'play' || !E().playing() || S.soloEscuchar) return;
    var dt = S.lastSampleT ? Math.min(0.05, Math.max(0.005, sample.t - S.lastSampleT)) : 0.02;
    S.lastSampleT = sample.t;
    var tAdj = E().position() - S.cfg.latency;
    if (tAdj < 0) return;
    var target = noteAt(tAdj);
    var semis = E().semis();
    var shown = null, state = 0; // 0 sin voz/objetivo · 1 acierto · 2 error · 3 transición
    var N = nivel();
    var gracia = target ? Math.min(N.trans, (target.e - target.s) * 0.35) : 0;
    var enTransicion = target ? (tAdj - target.s) < gracia : false;
    if (sample.midi != null) {
      shown = sample.midi;
      if (target) {
        var goal = target.m + semis;
        if (S.cfg.octaveFree) {
          S.wrapOff = 12 * Math.round((goal - sample.midi) / 12);
          shown = sample.midi + S.wrapOff;
        }
        var hit = Math.abs(shown - goal) <= N.tol;
        state = enTransicion ? 3 : (hit ? 1 : 2);
        if (!enTransicion) {          // el ataque no se evalúa
          target.totT += dt;
          if (hit) target.hitT += dt;
          // recreativo: sostener el tono un rato ya gana la plataforma entera
          if (N.logro && !target.logrado &&
              target.hitT >= Math.min(N.logro, 0.5 * (target.e - target.s - gracia))) {
            target.logrado = true;
          }
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
      // La traza de dibujo es una ventana corta. Para poder comparar tu voz
      // con la original y medir la latencia hace falta la sesión entera.
      if (S.grabando) {
        S.tomaTrace.push({ t: Math.round(tAdj * 1000) / 1000, m: Math.round(shown * 100) / 100 });
        if (S.tomaTrace.length > 30000) S.grabando = false; // ~8 min, tope de seguridad
      }
    }
  }

  function finalizeUpTo(tAdj) {
    var changed = false;
    while (S.finPtr < S.notes.length && S.notes[S.finPtr].e + 0.15 < tAdj) {
      var n = S.notes[S.finPtr];
      if (!n.done) {
        n.done = true;
        n.scored = S.micMode !== 'off' && n.totT > 0.02;
        var N = nivel();
        var ratio = n.scored ? n.hitT / n.totT : 0;
        if (N.logro && n.logrado) ratio = 1;   // recreativo: la ganaste entera
        n.green = n.scored && (N.logro ? !!n.logrado : ratio >= N.ratio);
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


  /* ---------------- editor de plataformas ----------------
     Las plataformas son las notas contra las que se puntúa. El detector acierta
     casi siempre, pero cuando se equivoca no hay forma de arreglarlo salvo a
     mano: de eso se trata esto.

     La edición se guarda por canción Y por detector, porque son dos melodías
     distintas: corregir la clásica no tiene por qué ensuciar la neuronal.
     Nunca se toca el canta.json del paquete; queda todo en este dispositivo.
  */
  /* Tiempos de la LETRA movidos a mano en el editor. Igual que las plataformas:
     quedan en este dispositivo y "Publicar para todos" los sube. Se guardan con
     una firma del texto: si la letra cambia en el Cancionero, la edicion vieja
     se descarta sola en vez de pegarle tiempos a palabras que ya no son. */
  function claveLetra() { return S.pkg ? 'sb.canta.letra.' + S.pkg.id : null; }
  function firmaLetra(lines) {
    return lines.map(function (l) {
      return (l.words || []).map(function (w) { return w.w; }).join(' ') || l.text;
    }).join('|');
  }
  function aplicarTiemposLetra(lines) {
    var k = claveLetra(), v = null;
    try { v = k && JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) {}
    if (!v || v.firma !== firmaLetra(lines) || !v.tiempos || v.tiempos.length !== lines.length) return lines;
    return lines.map(function (l, i) {
      var t = v.tiempos[i];
      return { s: t.s, e: t.e, text: l.text, words: (l.words || []).map(function (w, j) {
        return { s: t.w[j] ? t.w[j][0] : w.s, e: t.w[j] ? t.w[j][1] : w.e, w: w.w };
      }) };
    });
  }
  function letraParaGuardar() {
    return S.lines.map(function (l) {
      return { s: +l.s.toFixed(3), e: +l.e.toFixed(3), text: l.text,
               words: (l.words || []).map(function (w) { return { s: +w.s.toFixed(3), e: +w.e.toFixed(3), w: w.w }; }) };
    });
  }
  function guardarTiemposLetra() {
    var k = claveLetra();
    if (!k) return;
    try {
      localStorage.setItem(k, JSON.stringify({ firma: firmaLetra(S.lines), tiempos: letraParaGuardar().map(function (l) {
        return { s: l.s, e: l.e, w: l.words.map(function (w) { return [w.s, w.e]; }) };
      }) }));
    } catch (e) { edMsg('No pude guardar la letra en este dispositivo.'); }
  }
  function hayTiemposLetra() {
    var k = claveLetra();
    try { return !!(k && localStorage.getItem(k)); } catch (e) { return false; }
  }

  function claveNotas() {
    return S.pkg ? 'sb.canta.notas.' + S.pkg.id + '.' + (S.melodia || 'pyin') : null;
  }
  function notasGuardadas() {
    var k = claveNotas();
    if (!k) return null;
    try {
      var v = JSON.parse(localStorage.getItem(k) || 'null');
      return (v && v.length) ? v : null;
    } catch (e) { return null; }
  }
  function guardarNotas() {
    var k = claveNotas();
    if (!k) return;
    try {
      localStorage.setItem(k, JSON.stringify(S.notes.map(function (n) {
        return { s: +n.s.toFixed(3), e: +n.e.toFixed(3), m: +n.m.toFixed(1) };
      })));
    } catch (e) { edMsg('No pude guardar los cambios en este dispositivo.'); }
  }
  function olvidarNotas() {
    var k = claveNotas();
    if (k) { try { localStorage.removeItem(k); } catch (e) {} }
  }

  // Publicar escribe las plataformas en el canta.json del paquete en el repo:
  // pasan a ser las de TODOS (también el sitio de alumnos, que carga estos
  // mismos paquetes). Solo en el sitio del dueño, que es el que trae GitHub.
  function puedePublicar() { return !STUDENT && !!SB.github; }

  async function publicarPlataformas() {
    var btn = q('#kaEdPub'), pkg = S.pkg;
    if (!pkg || !pkg.id) return;
    if (!SB.github.configured()) {
      edMsg('Para publicar, primero pega tu token en Ajustes → Sincronizar con GitHub.');
      return;
    }
    if (!confirm('¿Publicar estas ' + S.notes.length + ' plataformas en "' + pkg.title + '"?\n\n' +
                 'Las verán todos los que la canten, incluido el sitio de alumnos.')) return;
    btn.disabled = true;
    edMsg('Publicando…');
    try {
      var ruta = 'app/canta-media/' + pkg.id + '/canta.json';
      var f = await SB.github.getFile(ruta);
      var json = JSON.parse(f.text);
      var det = S.melodia;
      var notas = S.notes.map(function (n) {
        return { s: +n.s.toFixed(3), e: +n.e.toFixed(3), m: +n.m.toFixed(1) };
      });
      // igual que setMelodia(): notes/f0/detector de arriba reflejan la
      // melodía elegida; la del otro detector queda intacta
      if (json.melodias && json.melodias[det]) {
        json.melodias[det].notes = notas;
        json.detector = det;
        json.f0 = json.melodias[det].f0;
      }
      json.notes = notas;
      // la letra movida a mano se publica tambien. La copia local de sus
      // tiempos se conserva: si la cancion tiene letra en el Cancionero, esa
      // manda en este aparato y sin la copia volverian los tiempos de antes.
      var conLetra = hayTiemposLetra();
      if (conLetra) json.lines = letraParaGuardar();
      await SB.github.putFile(ruta, JSON.stringify(json), f.sha,
        'canta: publica plataformas de "' + pkg.title + '" (desde la app)');
      // lo publicado pasa a ser la "original": la copia local ya sobra, y si
      // quedara, taparía cualquier cambio futuro del paquete en este aparato
      if (pkg.melodias && pkg.melodias[det]) pkg.melodias[det].notes = notas;
      pkg.notes = notas; pkg.detector = det;
      olvidarNotas();
      if (conLetra) pkg.lines = json.lines;
      S.notesEditadas = false;
      edMsg('Publicado: ' + notas.length + ' plataformas' + (conLetra ? ' y la letra' : '') +
            '. Se ve para todos en 1–2 minutos.');
    } catch (e) {
      edMsg('No se pudo publicar: ' + e.message);
    }
    btn.disabled = false;
  }

  function edMsg(t) { var e = q('#kaEdMsg'); if (e) e.textContent = t || ''; }

  // Geometría: las mismas cuentas que draw(), para que lo que se toca coincida
  // con lo que se ve. Se recalcula en cada gesto porque el rango vertical
  // depende de las notas, que el editor está cambiando.
  // Rango vertical del carril. Mientras se edita queda CONGELADO: si se
  // recalculara con cada cambio, mover una plataforma correría todas las demás
  // bajo el dedo y editar sería imposible.
  function rangoVertical() {
    if (S.editando && S.edRango) return S.edRango;
    var semis = E().semis(), ns = S.notes, loM = 55, hiM = 79;
    if (ns.length) {
      loM = Infinity; hiM = -Infinity;
      for (var i = 0; i < ns.length; i++) { if (ns[i].m < loM) loM = ns[i].m; if (ns[i].m > hiM) hiM = ns[i].m; }
      loM = Math.floor(loM + semis) - 3; hiM = Math.ceil(hiM + semis) + 3;
      while (hiM - loM < 14) { loM--; hiM++; }
    }
    return { loM: loM, hiM: hiM };
  }

  // Rango del modo edición: mucho más ancho que el de cantar (que se ciñe a
  // las notas para que las barras se vean grandes). Al editar hay que poder
  // poner una plataforma bien fuera de lo detectado (p.ej. corregir un salto
  // de octava), así que se centra en las notas existentes pero nunca es
  // menor a 3 octavas (36 semitonos).
  var ESPAN_EDICION = 36;
  function rangoEdicion() {
    var semis = E().semis(), ns = S.notes, loM = 55, hiM = 79;
    if (ns.length) {
      loM = Infinity; hiM = -Infinity;
      for (var i = 0; i < ns.length; i++) { if (ns[i].m < loM) loM = ns[i].m; if (ns[i].m > hiM) hiM = ns[i].m; }
      loM += semis; hiM += semis;
    }
    var centro = (loM + hiM) / 2;
    var mitad = Math.max(ESPAN_EDICION, (hiM - loM) + 6) / 2;
    return { loM: Math.round(centro - mitad), hiM: Math.round(centro + mitad) };
  }

  /* ---------- tono de referencia al editar ----------
     Suena mientras se sostiene una plataforma (tomar → soltar) y sigue la nota
     al arrastrarla, para reconocer por oído qué se está poniendo. Timbre de
     órgano (armónicos 1-2-3-4, como los tiradores 8'-4'-2⅔'-2'): además de
     sonar "a nota", en parlantes de celular —que casi no reproducen graves—
     los armónicos dejan reconocer la altura aunque falte la fundamental. */
  var TONO = null, ondaOrgano = null;
  function hzDe(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function tonoIniciar(midi) {
    tonoParar();
    var T = { m: midi };
    TONO = T;
    try {
      var ctx = SB.cantaEngine.ctx();
      var arrancar = function () {
        if (TONO !== T) return;   // se soltó antes de que el audio despertara
        try {
          if (!ondaOrgano) {
            ondaOrgano = ctx.createPeriodicWave(
              new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]),
              new Float32Array([0, 1, 0.7, 0.45, 0.35, 0.15, 0.1, 0, 0.06]));
          }
          var osc = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
          osc.setPeriodicWave(ondaOrgano);
          osc.frequency.setValueAtTime(hzDe(T.m), t);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.2, t + 0.025);
          osc.connect(g); g.connect(ctx.destination);
          osc.start(t);
          T.ctx = ctx; T.osc = osc; T.g = g;
        } catch (e) {}
      };
      // En el celular el contexto suele estar "suspended": mientras tanto
      // currentTime está congelado y programar ahí deja el sonido mudo. Se
      // espera a que resume() termine de verdad.
      if (ctx.state === 'suspended') ctx.resume().then(arrancar).catch(function () {});
      else arrancar();
    } catch (e) {}
  }

  function tonoCambiar(midi) {
    var T = TONO;
    if (!T) return;
    T.m = midi;
    if (!T.osc) return;           // todavía despertando: arrancará en la nota nueva
    var t = T.ctx.currentTime;
    T.osc.frequency.cancelScheduledValues(t);
    T.osc.frequency.setTargetAtTime(hzDe(midi), t, 0.006);   // salto limpio, sin clic
  }

  function tonoParar() {
    var T = TONO;
    TONO = null;
    if (!T || !T.osc) return;
    try {
      var t = T.ctx.currentTime;
      T.g.gain.cancelScheduledValues(t);
      T.g.gain.setValueAtTime(T.g.gain.value, t);
      T.g.gain.linearRampToValueAtTime(0, t + 0.12);
      T.osc.stop(t + 0.15);
    } catch (e) {}
  }

  // Momento que marca la linea vertical: lo que ESTAS ESCUCHANDO. El audio se
  // manda a sonar antes de que llegue a tus oidos, y tu voz vuelve con retraso
  // por el microfono: ambos retrasos son la latencia. Corriendo el carril por la
  // latencia, la linea es lo que oyes y el punto de tu voz cae SOBRE ella; si la
  // latencia esta bien, cantar con la musica deja tu traza encima de las plataformas.
  function tVista() { return E().position() - S.cfg.latency; }

  function geo() {
    var cv = S.els.canvas;
    var W = cv.clientWidth, H = cv.clientHeight;
    var semis = E().semis(), tempo = E().tempo(), now = tVista();
    var R = rangoVertical(), loM = R.loM, hiM = R.hiM;
    var span = hiM - loM, phX = W * 0.40;
    return {
      W: W, H: H, semis: semis, tempo: tempo, span: span, loM: loM, phX: phX,
      barH: Math.max(5, Math.min(20, (H / span) * 0.85)),
      xOf: function (t) { return phX + ((t - now) / tempo) * PXPS; },
      tOf: function (x) { return now + ((x - phX) / PXPS) * tempo; },
      yOf: function (m) { return H - ((m - loM) / span) * H; },
      // devuelve el midi del DATO (sin la transposición que solo es de vista)
      mOf: function (y) { return loM + ((H - y) / H) * span - semis; }
    };
  }

  // ¿Tocaste una palabra de la letra? Las cajas las anota dibujarLetra en cada cuadro.
  function palabraEn(px, py, G) {
    if (py < G.H - 44) return null;
    var cajas = S.letraCajas || [];
    for (var i = 0; i < cajas.length; i++) {
      var c = cajas[i];
      if (px >= c.x - 4 && px <= c.x + c.w + 4) return c;
    }
    return null;
  }

  // Corre una palabra (sin pasar a sus vecinas) o la frase completa.
  function moverLetra(A, dt) {
    var L = S.lines[A.li];
    if (!L) return;
    var ws = L.words || [], o = A.orig;
    if (A.tipo === 'frase') {
      var d = Math.max(dt, -o.s);
      L.s = o.s + d; L.e = o.e + d;
      ws.forEach(function (w, i) { w.s = o.ws[i][0] + d; w.e = o.ws[i][1] + d; });
      return;
    }
    var w = ws[A.k], dur = o.ws[A.k][1] - o.ws[A.k][0];
    var min = A.k > 0 ? ws[A.k - 1].s + 0.02 : 0;
    var max = A.k < ws.length - 1 ? ws[A.k + 1].s - 0.02 : Infinity;
    w.s = Math.max(min, Math.min(max, o.ws[A.k][0] + dt));
    w.e = w.s + dur;
    L.s = ws[0].s;
    L.e = Math.max.apply(null, ws.map(function (x) { return x.e; }));
  }

  var AGARRE = 14;   // px de margen en los extremos para estirar en vez de mover

  function zonaDe(n, px, G) {
    var x1 = G.xOf(n.s), x2 = G.xOf(n.e);
    // en una plataforma corta no caben tres zonas: entera se mueve
    if (x2 - x1 <= AGARRE * 2.5) return 'mover';
    if (px <= x1 + AGARRE) return 'inicio';
    if (px >= x2 - AGARRE) return 'fin';
    return 'mover';
  }

  function tocaA(n, px, py, G) {
    var x1 = G.xOf(n.s), x2 = G.xOf(n.e), y = G.yOf(n.m + G.semis);
    if (px < x1 - AGARRE || px > x2 + AGARRE) return -1;
    var dy = Math.abs(py - y);
    return dy > G.barH * 1.6 ? -1 : dy;
  }

  function notaEn(px, py, G) {
    // La elegida manda: si acabas de seleccionar una plataforma y vuelves a
    // tocarla, sigues trabajando sobre ella aunque haya otras debajo. Sin esto
    // no se podia estirar una plataforma larga que cruzara por encima de otras.
    for (var k = S.sel.length - 1; k >= 0; k--) {
      if (tocaA(S.sel[k], px, py, G) >= 0) return { nota: S.sel[k], zona: zonaDe(S.sel[k], px, G) };
    }
    var mejor = null, mejorDy = Infinity;
    for (var i = 0; i < S.notes.length; i++) {
      var dy = tocaA(S.notes[i], px, py, G);
      if (dy >= 0 && dy < mejorDy) { mejorDy = dy; mejor = S.notes[i]; }
    }
    return mejor ? { nota: mejor, zona: zonaDe(mejor, px, G) } : null;
  }

  function empujarDeshacer() {
    S.edPila = S.edPila || [];
    S.edPila.push(S.notes.map(function (n) { return { s: n.s, e: n.e, m: n.m }; }));
    if (S.edPila.length > 40) S.edPila.shift();
    var b = q('#kaEdUndo'); if (b) b.disabled = false;
  }

  function notaNueva(s, e, m) {
    return { s: s, e: e, m: m, segs: [], hitT: 0, totT: 0,
             done: false, green: false, scored: false, pts: 0 };
  }

  function ordenarNotas() {
    S.notes.sort(function (a, b) { return a.s - b.s; });
    S.finPtr = 0;
  }

  /* ---------- selección (una o varias) y copiar/pegar ---------- */
  var PORTAPAPELES = null;   // de este módulo: sobrevive al cambiar de canción
  function enSel(n) { return S.sel.indexOf(n) >= 0; }
  function selSolo(n) { S.sel = n ? [n] : []; S.selNota = n || null; selBotones(); }
  function selBotones() {
    var d = q('#kaEdDel'), c = q('#kaEdCopy'), p = q('#kaEdPaste');
    if (d) d.disabled = !S.sel.length;
    if (c) c.disabled = !S.sel.length;
    if (p) p.disabled = !PORTAPAPELES;
  }
  function selMsg() {
    return S.sel.length > 1
      ? S.sel.length + ' plataformas elegidas · arrastra una para mover todas juntas'
      : S.notes.length + ' plataformas';
  }

  // Copia la selección con tiempos RELATIVOS a su primera nota: se puede pegar
  // en otro punto de la canción (o en otra canción) conservando la forma.
  function copiarSel() {
    if (!S.sel.length) return false;
    var t0 = Math.min.apply(null, S.sel.map(function (n) { return n.s; }));
    PORTAPAPELES = S.sel.map(function (n) { return { ds: n.s - t0, dur: n.e - n.s, m: n.m }; })
      .sort(function (a, b) { return a.ds - b.ds; });
    selBotones();
    edMsg('Copié ' + PORTAPAPELES.length + ' plataforma' + (PORTAPAPELES.length === 1 ? '' : 's') +
          ' · mueve el cabezal a donde quieras y pega (Ctrl+V o "Pegar")');
    return true;
  }

  // Pega en el cabezal (la línea fija; se mueve con la barra de posición). Lo
  // pegado queda elegido, listo para arrastrarlo en bloque.
  function pegar() {
    if (!PORTAPAPELES || !S.editando) return false;
    empujarDeshacer();
    var t0 = Math.max(0, tVista());   // se pega en la linea vertical
    var nuevas = PORTAPAPELES.map(function (c) { return notaNueva(t0 + c.ds, t0 + c.ds + c.dur, c.m); });
    S.notes = S.notes.concat(nuevas);
    ordenarNotas();
    S.sel = nuevas.slice(); S.selNota = nuevas[nuevas.length - 1];
    guardarNotas();
    resetRunFrom(E().position() - S.cfg.latency);
    selBotones();
    edMsg('Pegué ' + nuevas.length + ' plataforma' + (nuevas.length === 1 ? '' : 's') +
          ' en el cabezal · quedaron elegidas: arrástralas para ubicarlas');
    SB.canta.redibujar();
    return true;
  }

  function edPointerDown(ev) {
    if (!S.editando) return;
    var cv = S.els.canvas, r = cv.getBoundingClientRect();
    var px = ev.clientX - r.left, py = ev.clientY - r.top;
    var G = geo();
    var multi = ev.ctrlKey || ev.metaKey || S.multiSel;
    // la letra (franja de abajo): arrastrar una palabra la corre en el tiempo;
    // con Ctrl (o "Varias") se corre la frase completa
    var pal = palabraEn(px, py, G);
    if (pal) {
      var L = S.lines[pal.li], frase = multi || pal.k < 0;
      S.arrastre = { tipo: frase ? 'frase' : 'palabra', li: pal.li, k: pal.k, px0: px, py0: py, movio: false,
                     orig: { s: L.s, e: L.e, ws: (L.words || []).map(function (w) { return [w.s, w.e]; }) } };
      try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
      edMsg(frase ? 'Moviendo la frase completa' : 'Moviendo la palabra · con Ctrl se mueve la frase completa');
      ev.preventDefault();
      SB.canta.redibujar();
      return;
    }
    var hit = notaEn(px, py, G);
    if (multi && !hit) { ev.preventDefault(); return; }   // Ctrl en el vacío: no crea ni suelta nada
    if (multi && enSel(hit.nota)) {
      // Ctrl+clic sobre una elegida: la saca de la selección (sin arrastre)
      S.sel.splice(S.sel.indexOf(hit.nota), 1);
      S.selNota = S.sel[S.sel.length - 1] || null;
      selBotones(); edMsg(selMsg()); ev.preventDefault(); SB.canta.redibujar();
      return;
    }
    empujarDeshacer();
    if (hit) {
      if (multi) { S.sel.push(hit.nota); S.selNota = hit.nota; selBotones(); }
      else if (!(enSel(hit.nota) && S.sel.length > 1)) selSolo(hit.nota);   // tomar una de un grupo mueve el grupo
      else S.selNota = hit.nota;
      if (S.sel.length > 1) {
        // varias: se mueven en bloque (tiempo y altura), sin sonido
        S.arrastre = { tipo: 'grupo', px0: px, py0: py, movio: false,
                       soloEsta: multi ? null : hit.nota,   // tocar sin arrastrar = quedarse solo con esa
                       minS: Math.min.apply(null, S.sel.map(function (n) { return n.s; })),
                       orig: S.sel.map(function (n) { return { n: n, s: n.s, e: n.e, m: n.m }; }) };
      } else {
        S.arrastre = { tipo: hit.zona, nota: hit.nota, px0: px, py0: py,
                       s0: hit.nota.s, e0: hit.nota.e, m0: hit.nota.m, movio: false,
                       ultimoSonido: hit.nota.m };
        tonoIniciar(hit.nota.m + G.semis);   // suena mientras la sostienes (también al estirarla)
      }
      edMsg(selMsg());
    } else {
      // en el vacío: nace una plataforma nueva donde tocaste
      var t = Math.max(0, G.tOf(px));
      var m = Math.round(G.mOf(py));
      var n = notaNueva(t, t + 0.12, m);
      S.notes.push(n);
      ordenarNotas();
      selSolo(n);
      S.arrastre = { tipo: 'fin', nota: n, px0: px, py0: py,
                     s0: n.s, e0: n.e, m0: n.m, movio: false, nueva: true,
                     ultimoSonido: m };
      tonoIniciar(m + G.semis);
    }
    q('#kaEdDel').disabled = false;
    try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
    ev.preventDefault();
    SB.canta.redibujar();
  }

  function edPointerMove(ev) {
    var A = S.arrastre;
    if (!S.editando || !A) return;
    var r = S.els.canvas.getBoundingClientRect();
    var px = ev.clientX - r.left, py = ev.clientY - r.top;
    var G = geo();
    var dt = (px - A.px0) / PXPS * G.tempo;
    if (Math.abs(px - A.px0) > 3 || Math.abs(py - A.py0) > 3) A.movio = true;
    var MIN = 0.06;   // s: por debajo de esto la plataforma no se puede cantar
    if (A.tipo === 'palabra' || A.tipo === 'frase') {
      moverLetra(A, dt);
      ev.preventDefault();
      SB.canta.redibujar();
      return;
    }

    if (A.tipo === 'grupo') {
      // mismo corrimiento para todas; el tiempo se frena en 0 para la primera,
      // sin deformar el bloque. La altura sube/baja en semitonos enteros, así
      // los intervalos entre ellas no cambian.
      var dtg = Math.max(dt, -A.minS);
      var dm = Math.round(G.mOf(py) - G.mOf(A.py0));
      A.orig.forEach(function (o) { o.n.s = o.s + dtg; o.n.e = o.e + dtg; o.n.m = o.m + dm; });
    } else if (A.tipo === 'mover') {
      var dur = A.e0 - A.s0;
      A.nota.s = Math.max(0, A.s0 + dt);
      A.nota.e = A.nota.s + dur;
      // el alto se pega al semitono: una plataforma a mano se pone en una nota,
      // no en 45.3
      A.nota.m = Math.round(G.mOf(py));
      // el tono sigue a la plataforma semitono a semitono, como deslizar por un teclado
      if (A.nota.m !== A.ultimoSonido) { A.ultimoSonido = A.nota.m; tonoCambiar(A.nota.m + G.semis); }
    } else if (A.tipo === 'inicio') {
      A.nota.s = Math.max(0, Math.min(A.e0 - MIN, A.s0 + dt));
    } else {
      A.nota.e = Math.max(A.s0 + MIN, A.e0 + dt);
    }
    ev.preventDefault();
    SB.canta.redibujar();
  }

  function edPointerUp(ev) {
    tonoParar();
    var A = S.arrastre;
    if (!S.editando || !A) return;
    // el navegador agrupa los pointermove por cuadro: aplica la posición final,
    // o un arrastre corto y rápido se toma por un toque
    if (ev.type === 'pointerup') edPointerMove(ev);
    S.arrastre = null;
    if (A.tipo === 'palabra' || A.tipo === 'frase') {
      if (A.movio) {
        guardarTiemposLetra();
        edMsg('Letra movida · queda en este dispositivo' + (puedePublicar() ? ' hasta que publiques' : ''));
      }
      try { S.els.canvas.releasePointerCapture(ev.pointerId); } catch (e) {}
      SB.canta.redibujar();
      return;
    }
    // un toque sin arrastre sobre el vacío no debe dejar una plataforma diminuta
    if (A.nueva && !A.movio) {
      // tocar el vacío sin arrastrar no crea nada (solo suelta la selección):
      // se crea arrastrando. Se descarta también el paso de deshacer.
      borrarSel(true);
      if (S.edPila && S.edPila.length) S.edPila.pop();
      var bu = q('#kaEdUndo'); if (bu) bu.disabled = !(S.edPila && S.edPila.length);
    }
    else if (A.tipo === 'grupo' && !A.movio && A.soloEsta) selSolo(A.soloEsta);
    else { ordenarNotas(); guardarNotas(); }
    resetRunFrom(E().position() - S.cfg.latency);
    edMsg(selMsg());
    try { S.els.canvas.releasePointerCapture(ev.pointerId); } catch (e) {}
    SB.canta.redibujar();
  }

  function borrarSel(silencioso) {
    if (!S.sel.length) return;
    if (!silencioso) empujarDeshacer();
    var n = S.sel.length, fuera = S.sel.slice();
    S.notes = S.notes.filter(function (x) { return fuera.indexOf(x) < 0; });
    selSolo(null);
    ordenarNotas();
    if (!silencioso) {
      guardarNotas();
      edMsg((n > 1 ? 'Borré ' + n + ' · ' : '') + S.notes.length + ' plataformas');
    }
    SB.canta.redibujar();
  }

  function deshacer() {
    if (!S.edPila || !S.edPila.length) return;
    var prev = S.edPila.pop();
    S.notes = prev.map(function (n) { return notaNueva(n.s, n.e, n.m); });
    selSolo(null);
    q('#kaEdUndo').disabled = !S.edPila.length;
    ordenarNotas(); guardarNotas();
    resetRunFrom(E().position() - S.cfg.latency);
    edMsg(S.notes.length + ' plataformas');
    SB.canta.redibujar();
  }

  function setEditando(on) {
    tonoParar();
    S.editando = on;
    S.arrastre = null; S.multiSel = false;
    var bm = q('#kaEdMulti');
    if (bm) { bm.setAttribute('aria-pressed', 'false'); bm.classList.remove('on'); }
    var bar = q('#kaEditBar'), btn = q('#kaEdit');
    if (bar) bar.hidden = !on;
    if (btn) {
      btn.textContent = on ? 'Salir de edición' : 'Editar plataformas';
      btn.classList.toggle('on', on);
    }
    S.els.canvas.classList.toggle('editando', on);
    selSolo(null);   // también habilita "Pegar" si hay algo copiado
    if (on) {
      E().pause(); updatePlayBtn();
      S.edRango = rangoEdicion();   // congelar antes de tocar nada
      S.edPila = [];
      q('#kaEdUndo').disabled = true;
      edMsg(S.notes.length + ' plataformas · arrastra una palabra de la letra para correrla (Ctrl: la frase) · los cambios quedan en este dispositivo' +
            (puedePublicar() ? ' hasta que los publiques' : ''));
    } else {
      S.edRango = null;
      edMsg('');
    }
    SB.canta.redibujar();
  }

  /* ---------------- dibujo ---------------- */
  function loop() {
    if (S.screen !== 'play') return;
    // releer los colores del tema de vez en cuando (tema auto puede cambiar solo)
    if ((S.frame = (S.frame || 0) + 1) % 90 === 0) readColors();
    draw();
    S.raf = requestAnimationFrame(loop);
  }

  // La letra corre por el carril como las plataformas, siempre abajo. Cada
  // palabra se ubica en el instante en que empieza, así cruza el cabezal justo
  // cuando se canta: se coordina sola con la música, sin centrar frases. Si
  // dos palabras quedan encimadas, la segunda se corre lo justo para leerse.
  // Barritas de nivel del micrófono (arriba a la izquierda). Verdes cuando
  // llega voz; la última se pone roja si la señal satura (sobre -3 dB).
  function dibujarNivel(g, C) {
    var n = 8, w = 5, h = 14, x0 = 34, y0 = 8;
    var lvl = S.nivelMic || 0;
    S.nivelMic = lvl * 0.97;                       // si dejan de llegar datos, cae
    var satura = performance.now() - (S.picoMic || 0) < 600;
    for (var i = 0; i < n; i++) {
      var encendida = lvl * n > i + 0.3;
      g.fillStyle = !encendida ? C.line : (i === n - 1 && satura ? C.bad : C.good);
      g.fillRect(x0 + i * (w + 2), y0 + h - (h * (i + 2) / (n + 1)), w, h * (i + 2) / (n + 1));
    }
    g.fillStyle = C.faint; g.font = '10px ui-monospace,Consolas,monospace';
    g.fillText('mic', 8, y0 + h - 2);
  }

  // Golpes de la musica (la percusion), justo sobre la letra: una rayita por
  // golpe, mas alta y oscura mientras mas fuerte. Es el ritmo con que se canta;
  // la rayita se ilumina al cruzar la linea vertical, como un metronomo.
  function dibujarDinamica(g, W, H, xOf, t0, t1, C, vista) {
    var gp = E().golpesMusica();
    if (!gp) return;
    var alto = 40, medio = H - 46 - alto / 2 - 2;
    g.lineWidth = 2;
    for (var i = 0; i < gp.t.length; i++) {
      var t = gp.t[i];
      if (t < t0) continue;
      if (t > t1) break;
      var v = gp.v[i], h = alto * (0.2 + 0.8 * v) / 2, x = xOf(t), recien = vista - t >= 0 && vista - t < 0.12;
      g.globalAlpha = recien ? 1 : 0.3 + 0.7 * v;
      g.strokeStyle = recien ? C.good : C.ink;
      g.beginPath(); g.moveTo(x, medio - h); g.lineTo(x, medio + h); g.stroke();
    }
    g.globalAlpha = 1;
  }

  var LETRA_FUENTE = '700 19px "Helvetica Neue",Helvetica,Arial,system-ui,sans-serif';
  function dibujarLetra(g, W, H, now, xOf, t0Vis, t1Vis, C) {
    var lines = S.lines || [], base = H - 14, banda = 44;
    g.globalAlpha = 0.85; g.fillStyle = C.bg;          // fondo para que se lea
    g.fillRect(0, H - banda, W, banda);
    g.globalAlpha = 1;
    if (!lines.length) {
      g.fillStyle = C.faint; g.font = '14px system-ui,sans-serif'; g.textAlign = 'center';
      g.fillText('(sin letra transcrita)', W / 2, base);
      g.textAlign = 'left';
      return;
    }
    g.font = LETRA_FUENTE;
    var esp = g.measureText(' ').width, cursor = -1e9, A = S.arrastre;
    S.letraCajas = [];
    for (var li = 0; li < lines.length; li++) {
      var L = lines[li];
      if (L.e < t0Vis - 2) continue;   // ya salió por la izquierda
      if (L.s > t1Vis) break;          // todavía no entra por la derecha
      var ws = (L.words && L.words.length) ? L.words : [{ s: L.s, e: L.e, w: L.text }];
      cursor += esp * 2;               // aire entre frases
      for (var k = 0; k < ws.length; k++) {
        var w = ws[k], x = Math.max(xOf(w.s), cursor), ancho = g.measureText(w.w).width;
        cursor = x + ancho + esp;
        if (x > W) break;
        if (x + ancho < 0) continue;
        var kk = (L.words && L.words.length) ? k : -1;
        S.letraCajas.push({ x: x, w: ancho, li: li, k: kk });
        var tomada = A && A.li === li && (A.tipo === 'frase' || (A.tipo === 'palabra' && A.k === kk));
        var dicha = now >= w.s;
        g.fillStyle = tomada ? C.good : (dicha || S.editando ? C.ink : C.mut);
        g.globalAlpha = !S.editando && dicha && now > w.e + 0.4 ? 0.45 : 1;   // ya cantada: se atenúa
        g.fillText(w.w, x, base);
      }
    }
    g.globalAlpha = 1;
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
    var vista = tAdj;                 // la linea vertical: lo que escuchas (ver tVista)
    finalizeUpTo(tAdj);
    vigilarTramos();

    // rango vertical según la melodía transpuesta (congelado mientras se edita)
    var ns = S.notes, R = rangoVertical(), loM = R.loM, hiM = R.hiM;
    var span = hiM - loM;
    var i;
    var yOf = function (m) { return H - ((m - loM) / span) * H; };
    var phX = W * 0.40; // 40% de pasado, 60% de futuro
    var xOf = function (t) { return phX + ((t - vista) / tempo) * PXPS; };
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
    var t0Vis = vista - (phX / PXPS) * tempo - 1, t1Vis = vista + ((W - phX) / PXPS) * tempo + 1;
    dibujarDinamica(g, W, H, xOf, t0Vis, t1Vis, C, vista);   // de fondo, detrás de las plataformas
    g.font = '600 11px ui-monospace,Consolas,monospace';
    for (i = 0; i < ns.length; i++) {
      var n = ns[i];
      if (n.e < t0Vis) continue;
      if (n.s > t1Vis) break;
      var x1 = xOf(n.s), x2 = xOf(n.e);
      var ym = yOf(n.m + semis) - barH / 2;
      // nota cerrada: verde/rojo solo si de verdad se evaluó; saltada queda neutra.
      // En recreativo, una plataforma ganada se pinta verde entera al tiro.
      var Nv = nivel();
      if (n.logrado && Nv.logro) g.fillStyle = C.good;
      else if (n.done && n.scored) g.fillStyle = n.green ? C.good : (Nv.rojo ? C.bad : C.line);
      else g.fillStyle = C.line;
      g.globalAlpha = n.done ? 0.5 : 1;
      rounded(g, x1, ym, Math.max(3, x2 - x1), barH, barH / 2);
      g.fill();
      g.globalAlpha = 1;
      // tramo ya recorrido, pintado según acierto
      for (var si = 0; !(n.logrado && Nv.logro) && si < n.segs.length; si++) {
        var sg = n.segs[si];
        if (!Nv.rojo && !sg.hit) continue;   // recreativo: no marca lo desafinado
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
      // en edición: contorno a todas y agarraderas a la elegida, para que se
      // vea dónde tirar sin tener que adivinar
      if (S.editando) {
        var sel = enSel(n);
        g.strokeStyle = sel ? C.ink : C.mut;
        g.lineWidth = sel ? 2 : 1;
        g.globalAlpha = sel ? 1 : 0.5;
        rounded(g, x1, ym, Math.max(3, x2 - x1), barH, barH / 2);
        g.stroke();
        g.globalAlpha = 1;
        if (sel && S.sel.length === 1) {   // varias elegidas se mueven, no se estiran
          g.fillStyle = C.ink;
          var yc = ym + barH / 2;
          [x1, x2].forEach(function (xx) {
            g.beginPath(); g.arc(xx, yc, 5, 0, 6.2832); g.fill();
          });
          g.fillStyle = C.bg;
          [x1, x2].forEach(function (xx) {
            g.beginPath(); g.arc(xx, yc, 2, 0, 6.2832); g.fill();
          });
          g.fillStyle = C.ink;
          g.font = '600 11px ui-monospace,Consolas,monospace';
          g.fillText(noteName(n.m + semis) + '  ' + (n.e - n.s).toFixed(2) + ' s',
                     x1 + 6, ym - 8 < 10 ? ym + barH + 20 : ym - 8);
          g.font = '600 11px ui-monospace,Consolas,monospace';
        }
        g.lineWidth = 1;
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

    // curva de la toma cargada: tu voz de una vez anterior, punteada, para
    // poder compararla con la línea continua del original
    if (S.tomaCurva && S.tomaCurva.length) {
      var tc = S.tomaCurva;
      // Si cantaste en otra octava (lo normal: un hombre sobre una canción de
      // mujer), la curva cruda cae fuera del carril y quedaría aplastada
      // contra el borde. Se pliega por octavas hasta entrar, que es la misma
      // regla con que se puntúa cuando "Octava libre" está marcada.
      var plegar = function (m) {
        if (!S.cfg.octaveFree) return m;
        while (m < loM && m + 12 <= hiM) m += 12;
        while (m > hiM && m - 12 >= loM) m -= 12;
        return m;
      };
      g.strokeStyle = C.ink; g.lineWidth = 1.5; g.globalAlpha = 0.75;
      g.setLineDash([4, 3]);
      g.beginPath();
      var dibujando = false;
      for (i = 0; i < tc.length; i++) {
        var pc = tc[i];
        if (pc.t < t0Vis) continue;
        if (pc.t > t1Vis) break;
        var cx = xOf(pc.t), cy = yOf(Math.max(loM, Math.min(hiM, plegar(pc.m + semis))));
        if (dibujando && i > 0 && pc.t - tc[i - 1].t < 0.15) g.lineTo(cx, cy);
        else { g.moveTo(cx, cy); dibujando = true; }
      }
      g.stroke();
      g.setLineDash([]);
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

    // medidor de entrada del micrófono: confirma que está llegando señal
    if (S.micMode === 'mic') dibujarNivel(g, C);

    // letra: corre por el carril igual que las plataformas (ver dibujarLetra)
    dibujarLetra(g, W, H, vista, xOf, t0Vis, t1Vis, C);

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
    tonoParar();
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
  /* ---------------- ajustes que viajan en el sync ----------------
     Van al repo las CORRECCIONES: las plataformas editadas a mano y qué
     melodía elegiste para cada canción. Eso es trabajo tuyo y se pierde al
     cambiar de aparato.

     NO viaja la configuración del dispositivo (latencia, micrófono elegido,
     audífonos, volúmenes): esos valores describen el equipo donde estás, y
     llevar la latencia del computador al celular sería empeorarlo.
  */
  var PREF_NOTAS = 'sb.canta.notas.';
  var PREF_MEL = 'sb.canta.melodia.';

  function exportarAjustes() {
    var notas = {}, melodia = {}, n = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        if (k.indexOf(PREF_NOTAS) === 0) {
          notas[k.slice(PREF_NOTAS.length)] = JSON.parse(localStorage.getItem(k));
          n++;
        } else if (k.indexOf(PREF_MEL) === 0) {
          melodia[k.slice(PREF_MEL.length)] = localStorage.getItem(k);
          n++;
        }
      }
    } catch (e) { return null; }
    return n ? { notas: notas, melodia: melodia } : null;
  }

  function importarAjustes(obj) {
    if (!obj || typeof obj !== 'object') return 0;
    var n = 0;
    try {
      var notas = obj.notas || {};
      for (var k in notas) {
        if (Array.isArray(notas[k])) {
          localStorage.setItem(PREF_NOTAS + k, JSON.stringify(notas[k]));
          n++;
        }
      }
      var mel = obj.melodia || {};
      for (var j in mel) {
        if (mel[j] === 'pyin' || mel[j] === 'crepe') {
          localStorage.setItem(PREF_MEL + j, mel[j]);
          n++;
        }
      }
    } catch (e) {}
    return n;
  }

  SB.canta = {
    // lo que viaja al repo con Ajustes → Sincronizar
    exportarAjustes: exportarAjustes,
    importarAjustes: importarAjustes,
    // fuerza un cuadro: requestAnimationFrame se congela en pestañas ocultas,
    // así que sin esto no hay forma de comprobar el dibujo automáticamente
    redibujar: function () { if (S.screen === 'play') draw(); },
    debug: function () {
      return {
        screen: S.screen, score: S.score, streak: S.streak,
        trace: S.trace.length, micMode: S.micMode,
        notas: S.notes ? S.notes.length : 0,
        editando: !!S.editando, notasEditadas: !!S.notesEditadas,
        arrastre: S.arrastre ? S.arrastre.tipo + (S.arrastre.nueva ? '/nueva' : '') : null,
        selCount: S.sel.length, copiadas: PORTAPAPELES ? PORTAPAPELES.length : 0,
        selDur: S.selNota ? +(S.selNota.e - S.selNota.s).toFixed(3) : null,
        selMidi: S.selNota ? S.selNota.m : null,
        selIni: S.selNota ? +S.selNota.s.toFixed(3) : null,
        // dónde cae en pantalla la elegida (para poder probar los gestos)
        selCaja: (function () {
          if (!S.selNota || S.screen !== 'play') return null;
          var G = geo();
          return { x1: Math.round(G.xOf(S.selNota.s)), x2: Math.round(G.xOf(S.selNota.e)),
                   y: Math.round(G.yOf(S.selNota.m + G.semis)) };
        })(),
        // todas las elegidas (selección múltiple) + cuántos px mide un semitono
        selCajas: (function () {
          if (S.screen !== 'play' || !S.sel.length) return [];
          var G = geo();
          return S.sel.map(function (n) {
            return { x1: Math.round(G.xOf(n.s)), x2: Math.round(G.xOf(n.e)), y: Math.round(G.yOf(n.m + G.semis)),
                     s: +n.s.toFixed(3), m: n.m, pxSemi: +(G.H / G.span).toFixed(2) };
          });
        })(),
        grabando: S.grabando, tomaTrace: S.tomaTrace.length,
        tramos: (S.tomaTramos || []).length, tramoAbierto: !!S.tramo,
        tomaId: S.tomaId, tomaCurva: S.tomaCurva ? S.tomaCurva.length : 0,
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
