/* Canta Libre y Rango vocal.
 *
 * Dos pantallas de Canta sin canción fija:
 *   #/canta/libre  — carril alto que muestra la nota que se canta: líneas de
 *                    los Do marcadas, trazo de la voz y un cartel con la nota.
 *                    De fondo, opcional, una pista de la app o un video de YouTube.
 *   #/canta/rango  — ejercicio para medir la nota cómoda más grave y más aguda.
 *
 * canta.js las monta con SB.cantaLibre.montar(...) y recibe la función que las
 * desmonta. Si este archivo no está cargado, Canta sigue igual sin ellas.
 */
(function () {
  'use strict';
  var SB = window.SB = window.SB || {};
  var RKEY = 'sb.canta.rango';   // {lo, hi, fecha} en MIDI
  var LKEY = 'sb.canta.libre';   // {pista, yt}
  var MEDIA = window.SB_CANTA_MEDIA_BASE || 'canta-media/';

  var VENTANA = 14;      // segundos de trazo a la vista
  var X_AHORA = 0.72;    // dónde va el punto (fracción del ancho)
  var PROM = 0.5;        // segundos que promedia el cartel
  var SUAVE = 0.3;       // constante de tiempo (s) del suavizado del trazo

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function leer(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function guardar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function ahora() { return performance.now() / 1000; }

  function nombreNota(m, latin) {
    var r = Math.round(m), pc = ((r % 12) + 12) % 12;
    var n = SB.music.NOTES[pc];
    return (latin ? SB.music.LATIN_TI[n] : n) + (Math.floor(r / 12) - 1);
  }
  function rangoGuardado() {
    var r = leer(RKEY);
    return r && typeof r.lo === 'number' && typeof r.hi === 'number' && r.hi > r.lo ? r : null;
  }
  function intervalo(st) {
    var o = Math.floor(st / 12), s = st % 12, p = [];
    if (o) p.push(o + (o === 1 ? ' octava' : ' octavas'));
    if (s) p.push(s + (s === 1 ? ' semitono' : ' semitonos'));
    return p.join(' y ') || 'menos de un semitono';
  }
  // Referencia gruesa: el tipo de voz cuyo rango típico queda más cerca.
  var VOCES = [['bajo', 40, 64], ['barítono', 45, 69], ['tenor', 48, 72],
               ['contralto', 53, 77], ['mezzosoprano', 57, 81], ['soprano', 60, 84]];
  function vozParecida(lo, hi) {
    var mejor = null, d = 1e9;
    VOCES.forEach(function (v) {
      var x = Math.abs(v[1] - lo) + Math.abs(v[2] - hi);
      if (x < d) { d = x; mejor = v[0]; }
    });
    return mejor;
  }
  function idYoutube(txt) {
    txt = String(txt || '').trim();
    var m = /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/.exec(txt);
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{11}$/.test(txt) ? txt : null;
  }

  /* ---------------- carril: el dibujo que comparten las dos pantallas ---------------- */
  function Carril(cv, op) {
    var c = {
      cv: cv, latin: op.latin, span: op.span || 24, centro: op.centro || 57,
      traza: [], cartel: null, marcas: [], banda: null, aviso: '', raf: 0, colores: null
    };

    function colores() {
      var cs = getComputedStyle(document.documentElement);
      var v = function (n, fb) { return (cs.getPropertyValue(n) || fb).trim() || fb; };
      c.colores = { ink: v('--ink', '#141414'), mut: v('--mut', '#767676'), faint: v('--faint', '#a8a8a8'),
                    line: v('--line', '#e3e3e3'), panel: v('--panel', '#fafafa'), bg: v('--bg', '#ffffff') };
    }

    // Promedio de la voz en el último medio segundo: es lo que lee el cartel.
    // El punto y el trazo usan cada muestra; el cartel no, para que se alcance a leer.
    function promedio(t) {
      var s = 0, n = 0;
      for (var i = c.traza.length - 1; i >= 0; i--) {
        var p = c.traza[i];
        if (t - p.t > PROM) break;
        s += p.m; n++;
      }
      return n >= 3 ? s / n : null;
    }

    c.muestra = function (midi) {
      var t = ahora();
      if (midi == null) { c.suave = null; c.fuera = 0; return; }
      // La voz cantada tiembla ±medio semitono varias veces por segundo aunque
      // la nota se sostenga (un silbido no). El trazo va suavizado para que una
      // nota sostenida se vea plana; un cambio de nota de verdad (más de 1,2
      // semitonos, dos muestras seguidas) corta el suavizado y se dibuja al tiro.
      var dt = c.tPrev ? Math.min(0.1, Math.max(0.005, t - c.tPrev)) : 0.02;
      c.tPrev = t;
      if (c.suave == null) c.suave = midi;
      else if (Math.abs(midi - c.suave) > 1.2) {
        if (++c.fuera >= 2) { c.suave = midi; c.fuera = 0; }
      } else {
        c.fuera = 0;
        c.suave += (midi - c.suave) * (1 - Math.exp(-dt / SUAVE));
      }
      c.traza.push({ t: t, m: c.suave });
      while (c.traza.length && t - c.traza[0].t > VENTANA + 2) c.traza.shift();
    };
    c.limpiar = function () { c.traza = []; c.cartel = null; c.suave = null; };
    c.ultima = function () {
      var p = c.traza[c.traza.length - 1];
      return p && ahora() - p.t < 0.3 ? p : null;
    };

    function dibujar() {
      c.raf = requestAnimationFrame(dibujar);
      var W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) return;
      var dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      }
      if (!c.colores) colores();
      var C = c.colores, g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = C.bg; g.fillRect(0, 0, W, H);

      var t = ahora(), ult = c.ultima(), prom = promedio(t);

      // la vista sigue a la voz: si se acerca a un borde, el carril se corre
      if (prom != null) {
        var margen = c.span / 2 - 4;
        if (prom > c.centro + margen) c.centro += (prom - margen - c.centro) * 0.06;
        else if (prom < c.centro - margen) c.centro += (prom + margen - c.centro) * 0.06;
      }
      var lo = c.centro - c.span / 2, hi = c.centro + c.span / 2;
      var paso = H / c.span;
      var yDe = function (m) { return H - (m - lo) * paso; };
      var xAhora = Math.round(W * X_AHORA);
      var pxSeg = xAhora / VENTANA;
      var xDe = function (tt) { return xAhora - (t - tt) * pxSeg; };
      var margenIzq = 46;

      // rango vocal medido: franja de fondo
      if (c.banda) {
        var yb1 = yDe(c.banda.hi + 0.5), yb2 = yDe(c.banda.lo - 0.5);
        g.fillStyle = C.panel; g.fillRect(0, yb1, W, yb2 - yb1);
        g.fillStyle = C.faint; g.font = '10px system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'top';
        if (yb1 > 0 && yb1 < H - 14) g.fillText('TU RANGO', W - 8, yb1 + 4);
      }

      // líneas de las notas: los Do mandan, las demás naturales acompañan
      g.textAlign = 'left'; g.textBaseline = 'middle';
      for (var m = Math.ceil(lo); m <= Math.floor(hi); m++) {
        var pc = ((m % 12) + 12) % 12, y = Math.round(yDe(m)) + 0.5;
        var natural = [0, 2, 4, 5, 7, 9, 11].indexOf(pc) !== -1;
        if (pc === 0) {
          g.strokeStyle = C.ink; g.lineWidth = 2;
          g.beginPath(); g.moveTo(margenIzq, y); g.lineTo(W, y); g.stroke();
          g.fillStyle = C.ink; g.font = '700 15px system-ui, sans-serif';
          g.fillText(nombreNota(m, c.latin), 6, y);
        } else if (natural) {
          g.strokeStyle = C.line; g.lineWidth = 1;
          g.beginPath(); g.moveTo(margenIzq, y); g.lineTo(W, y); g.stroke();
          if (paso >= 11) {
            g.fillStyle = C.faint; g.font = (paso >= 13 ? 11 : 10) + 'px system-ui, sans-serif';
            g.fillText(nombreNota(m, c.latin).replace(/-?\d+$/, ''), 6, y);
          }
        }
      }

      // marcas (rango vocal: la más grave y la más aguda encontradas)
      c.marcas.forEach(function (k) {
        if (k.m == null) return;
        var ym = Math.round(yDe(k.m)) + 0.5;
        g.strokeStyle = C.ink; g.lineWidth = 1.5; g.setLineDash([6, 4]);
        g.beginPath(); g.moveTo(margenIzq, ym); g.lineTo(W, ym); g.stroke();
        g.setLineDash([]);
        g.fillStyle = C.ink; g.font = '600 12px system-ui, sans-serif'; g.textAlign = 'right';
        g.textBaseline = k.arriba ? 'bottom' : 'top';
        g.fillText(k.texto + ' · ' + nombreNota(k.m, c.latin), W - 8, ym + (k.arriba ? -4 : 4));
        g.textAlign = 'left'; g.textBaseline = 'middle';
      });

      // línea del presente
      g.strokeStyle = C.line; g.lineWidth = 1;
      g.beginPath(); g.moveTo(xAhora + 0.5, 0); g.lineTo(xAhora + 0.5, H); g.stroke();

      // trazo de la voz: cada muestra, sin promediar
      g.strokeStyle = C.ink; g.lineWidth = 2.5; g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath();
      var prev = null;
      for (var i = 0; i < c.traza.length; i++) {
        var p = c.traza[i], px = xDe(p.t);
        if (px < margenIzq) { prev = null; continue; }
        var py = yDe(p.m);
        if (prev && p.t - prev.t < 0.12 && Math.abs(p.m - prev.m) < 3) g.lineTo(px, py);
        else g.moveTo(px, py);
        prev = p;
      }
      g.stroke();

      // punto gordo y cartel con la nota
      if (ult && prom != null) {
        // el cartel cambia de nota solo cuando el promedio ya se fue a otra
        if (c.cartel == null || Math.abs(prom - c.cartel) > 0.6) c.cartel = Math.round(prom);
        var yp = Math.max(12, Math.min(H - 12, yDe(ult.m)));
        g.fillStyle = C.ink;
        g.beginPath(); g.arc(xAhora, yp, 11, 0, Math.PI * 2); g.fill();
        g.strokeStyle = C.bg; g.lineWidth = 2;
        g.beginPath(); g.arc(xAhora, yp, 11, 0, Math.PI * 2); g.stroke();

        // solo el nombre de la nota más cercana: la octava se lee en las líneas
        var txt = nombreNota(c.cartel, c.latin).replace(/-?\d+$/, '');
        g.font = '800 24px system-ui, sans-serif';
        var bw = g.measureText(txt).width + 22, bh = 38;
        var bx = Math.min(W - bw - 6, xAhora + 20), by = Math.max(4, Math.min(H - bh - 4, yp - bh / 2));
        g.fillStyle = C.ink;
        g.beginPath();
        if (g.roundRect) g.roundRect(bx, by, bw, bh, 6); else g.rect(bx, by, bw, bh);
        g.fill();
        g.fillStyle = C.bg; g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText(txt, bx + 11, by + bh / 2 + 1);
      } else if (!ult) {
        c.cartel = null;
      }

      if (c.aviso && !c.traza.length) {
        g.fillStyle = C.mut; g.font = '14px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(c.aviso, (margenIzq + xAhora) / 2, H / 2);
      }
    }

    c.promedio = function () { return promedio(ahora()); };
    c.parar = function () { if (c.raf) cancelAnimationFrame(c.raf); c.raf = 0; };
    c.raf = requestAnimationFrame(dibujar);
    return c;
  }

  /* ---------------- micrófono (compartido) ---------------- */
  function Escucha(raiz, cfg, alLlegar, melodiaPrueba, estado) {
    var modo = 'off';
    function pintar() {
      raiz.querySelectorAll('[data-m]').forEach(function (b) {
        b.setAttribute('aria-pressed', b.dataset.m === modo ? 'true' : 'false');
      });
    }
    function poner(m) {
      modo = m; pintar();
      SB.cantaPitch.stop();
      if (m === 'off') { estado('Micrófono apagado.'); return; }
      if (m === 'test') SB.cantaPitch.setTestMelody(melodiaPrueba);
      var ctx = SB.cantaEngine.ctx();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      SB.cantaPitch.start(ctx, m, function (s) { alLlegar(s ? s.midi : null); }, {
        deviceId: cfg.micDev, audifonos: !!cfg.audifonos, antiguo: !!cfg.antiguo
      }).then(function () {
        estado(m === 'mic' ? 'Micrófono activo: canta.' : 'Modo prueba: canto automático, sin micrófono.');
      }).catch(function (e) {
        modo = 'off'; pintar();
        estado('No pude usar el micrófono: ' + e.message);
      });
    }
    raiz.querySelectorAll('[data-m]').forEach(function (b) {
      b.addEventListener('click', function () { poner(b.dataset.m); });
    });
    pintar();
    return { poner: poner, modo: function () { return modo; } };
  }
  var SEG_MIC =
    '<div class="ctl"><span class="ctl-label">Escucha</span><div class="seg" data-seg="mic">' +
    '<button data-m="off">Apagado</button><button data-m="mic">Micrófono</button>' +
    '<button data-m="test" title="Canto automático, para probar sin micrófono">Prueba</button></div></div>';

  /* ================= CANTA LIBRE ================= */
  function montarLibre(view, ctx, cfg) {
    var pref = leer(LKEY) || {};
    var rg = rangoGuardado();
    view.innerHTML =
      '<div class="ka-scope kl">' +
      '<button class="back" id="klVolver">← Canta</button>' +
      '<div class="rep-head"><h1>Canta Libre</h1><span class="count" id="klRango"></span></div>' +
      '<p class="ed-note">Canta lo que quieras: el micrófono parte encendido, el punto sigue tu voz, el cartel dice la nota y el trazo queda dibujado. ' +
      'Las líneas gruesas son los Do.</p>' +
      '<div class="kl-ctl">' + SEG_MIC +
      '<div class="ctl"><span class="ctl-label">Trazo</span><button class="mini-app-btn" id="klLimpiar">Limpiar</button></div>' +
      '<div class="ctl kl-fondo"><span class="ctl-label">Fondo (opcional)</span>' +
      '<div class="kl-fila"><select id="klPista"><option value="">Sin pista</option></select>' +
      '<input type="url" id="klYt" placeholder="o un link de YouTube" autocomplete="off">' +
      '<button class="mini-app-btn" id="klYtOk">Poner</button>' +
      '<button class="mini-app-btn" id="klQuitar" hidden>Quitar fondo</button></div></div>' +
      '</div>' +
      '<div id="klMedia" class="kl-media"></div>' +
      '<div class="ka-stage kl-stage"><canvas id="klCanvas"></canvas></div>' +
      '<p class="set-status" id="klEstado"></p>' +
      '</div>';
    var q = function (s) { return view.querySelector(s); };
    var estado = function (m) { var e = q('#klEstado'); if (e) e.textContent = m || ''; };

    var carril = Carril(q('#klCanvas'), {
      latin: cfg.latin !== false, span: 48, centro: rg ? (rg.lo + rg.hi) / 2 : 57
    });
    carril.banda = rg;
    carril.aviso = 'Canta: el micrófono ya está escuchando';

    q('#klRango').innerHTML = rg
      ? 'Tu rango: ' + esc(nombreNota(rg.lo, carril.latin)) + ' a ' + esc(nombreNota(rg.hi, carril.latin)) +
        ' · <a href="#/canta/rango">medir de nuevo</a>'
      : '<a href="#/canta/rango">Medir mi rango vocal</a>';

    var t0 = ahora();
    var escucha = Escucha(view, cfg, carril.muestra, function () {
      // prueba: notas sostenidas con el temblor típico de la voz
      var t = ahora() - t0, k = Math.floor(t / 2.5) % 6;
      return 55 + [0, 2, 4, 7, 4, 12][k] + 0.45 * Math.sin(t * 34) + 0.2 * Math.sin(t * 13);
    }, estado);
    // El micrófono parte encendido. Si el navegador todavía no deja sonar la
    // página (se entró directo por el link), el primer toque lo despierta.
    escucha.poner('mic');
    var despertar = function () {
      var a = SB.cantaEngine.ctx();
      if (a.state === 'suspended' && a.resume) a.resume();
    };
    document.addEventListener('pointerdown', despertar);

    q('#klVolver').addEventListener('click', function () { ctx.navigate('canta'); });
    q('#klLimpiar').addEventListener('click', function () { carril.limpiar(); });

    // ---- fondo: una pista de la app o un video de YouTube ----
    var media = q('#klMedia');
    function quitar() { media.innerHTML = ''; var b = q('#klQuitar'); if (b) b.hidden = true; }
    function ponerPista(id, titulo) {
      quitar();
      if (!id) return;
      media.innerHTML = '<div class="kl-pista"><span>' + esc(titulo || id) + ' (solo música)</span>' +
        '<audio controls loop preload="none" src="' + esc(MEDIA + encodeURIComponent(id) + '/music.m4a') + '"></audio></div>';
      var a = media.querySelector('audio');
      a.addEventListener('error', function () { estado('No pude cargar esa pista.'); });
      a.play().catch(function () {});
      q('#klQuitar').hidden = false;
      estado('Pista de fondo puesta. Con parlantes, el micrófono también la escucha: mejor con audífonos.');
    }
    function ponerYoutube(id) {
      quitar();
      media.innerHTML = '<iframe class="kl-yt" src="https://www.youtube.com/embed/' + id +
        '?playsinline=1&rel=0" title="Video de fondo" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
      q('#klQuitar').hidden = false;
      estado('Video puesto: dale play ahí mismo. Con parlantes, el micrófono también lo escucha: mejor con audífonos.');
    }
    q('#klPista').addEventListener('change', function () {
      var o = this.options[this.selectedIndex];
      q('#klYt').value = '';
      guardar(LKEY, { pista: this.value || null });
      ponerPista(this.value, o ? o.textContent : '');
    });
    function tomarLink() {
      var id = idYoutube(q('#klYt').value);
      if (!id) { estado('Ese link no parece de YouTube.'); return; }
      q('#klPista').value = '';
      guardar(LKEY, { yt: q('#klYt').value.trim() });
      ponerYoutube(id);
    }
    q('#klYtOk').addEventListener('click', tomarLink);
    q('#klYt').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') tomarLink(); });
    q('#klQuitar').addEventListener('click', function () {
      quitar(); q('#klPista').value = ''; q('#klYt').value = ''; guardar(LKEY, {});
    });
    if (pref.yt) q('#klYt').value = pref.yt;

    var vivo = true;
    SB.cantaEngine.fetchServerList().then(function (lista) {
      if (!vivo || !lista || !q('#klPista')) return;
      lista.slice().sort(function (a, b) { return a.title.localeCompare(b.title); }).forEach(function (p) {
        var o = document.createElement('option');
        o.value = p.id; o.textContent = p.title;
        q('#klPista').appendChild(o);
      });
    });

    return function () { vivo = false; document.removeEventListener('pointerdown', despertar); carril.parar(); SB.cantaPitch.stop(); quitar(); };
  }

  /* ================= RANGO VOCAL ================= */
  function montarRango(view, ctx, cfg) {
    var R = { paso: 'grave', lo: null, hi: null, buf: [] };
    var latin = cfg.latin !== false;
    view.innerHTML =
      '<div class="ka-scope kl">' +
      '<button class="back" id="krVolver">← Canta</button>' +
      '<div class="rep-head"><h1>Rango vocal</h1><span class="count" id="krPaso"></span></div>' +
      '<div class="kr-caja"><p class="kr-titulo" id="krTitulo"></p><p class="ed-note" id="krTexto"></p>' +
      '<p class="kr-nota" id="krNota"></p>' +
      '<div class="set-row" id="krBotones"></div></div>' +
      '<div class="kl-ctl">' + SEG_MIC + '</div>' +
      '<div class="ka-stage kl-stage"><canvas id="klCanvas"></canvas></div>' +
      '<p class="set-status" id="klEstado"></p>' +
      '</div>';
    var q = function (s) { return view.querySelector(s); };
    var estado = function (m) { var e = q('#klEstado'); if (e) e.textContent = m || ''; };
    var previo = rangoGuardado();
    var carril = Carril(q('#klCanvas'), { latin: latin, span: 30, centro: previo ? (previo.lo + previo.hi) / 2 : 55 });
    carril.aviso = 'Prende el micrófono para empezar';

    function pintar() {
      var fin = R.paso === 'fin';
      q('#krPaso').textContent = fin ? 'Listo' : (R.paso === 'grave' ? 'Paso 1 de 2' : 'Paso 2 de 2');
      carril.marcas = [
        { m: R.lo, texto: 'Grave', arriba: false },
        { m: R.hi, texto: 'Aguda', arriba: true }
      ];
      var bot = q('#krBotones');
      if (fin) {
        var st = R.hi - R.lo;
        q('#krTitulo').textContent = 'Tu rango cómodo: ' + nombreNota(R.lo, latin) + ' a ' + nombreNota(R.hi, latin);
        q('#krTexto').textContent = 'Son ' + intervalo(st) + '. Por dónde cae, se parece al de una voz de ' +
          vozParecida(R.lo, R.hi) + ' (es una referencia gruesa, no un diagnóstico). Quedó guardado en este dispositivo ' +
          'y Canta Libre lo muestra como una franja.';
        q('#krNota').textContent = '';
        bot.innerHTML = '<button class="mini-app-btn" id="krLibre">Ir a Canta Libre</button>' +
          '<button class="mini-app-btn" id="krOtra">Medir de nuevo</button>';
        q('#krLibre').addEventListener('click', function () { ctx.navigate('canta/libre'); });
        q('#krOtra').addEventListener('click', function () { R.paso = 'grave'; R.lo = R.hi = null; R.buf = []; carril.limpiar(); pintar(); });
        return;
      }
      var grave = R.paso === 'grave', v = grave ? R.lo : R.hi;
      q('#krTitulo').textContent = grave ? 'Tu nota más grave' : 'Tu nota más aguda';
      q('#krTexto').textContent = grave
        ? 'Canta «aaa» y ve bajando de a poco hasta la nota más grave que te salga cómoda, sin forzar ni raspar. ' +
          'Sostenla un segundo: queda marcada sola.'
        : 'Ahora sube de a poco hasta la nota más aguda que te salga cómoda, sin gritar ni apretar la garganta. ' +
          'Sostenla un segundo: queda marcada sola.';
      q('#krNota').textContent = v == null ? 'Todavía no marco ninguna nota sostenida.'
        : (grave ? 'La más grave hasta ahora: ' : 'La más aguda hasta ahora: ') + nombreNota(v, latin);
      bot.innerHTML = '<button class="mini-app-btn" id="krOk"' + (v == null ? ' disabled' : '') + '>' +
        (grave ? 'Esa es mi grave, seguir' : 'Esa es mi aguda, terminar') + '</button>' +
        '<button class="mini-app-btn" id="krBorrar"' + (v == null ? ' disabled' : '') + '>Borrar y repetir</button>';
      q('#krOk').addEventListener('click', function () {
        if (grave) { R.paso = 'aguda'; R.buf = []; pintar(); return; }
        if (R.hi - R.lo < 3) { estado('La aguda quedó casi igual que la grave: repite la aguda subiendo más.'); return; }
        R.paso = 'fin';
        guardar(RKEY, { lo: R.lo, hi: R.hi, fecha: new Date().toISOString().slice(0, 10) });
        pintar();
      });
      q('#krBorrar').addEventListener('click', function () {
        if (grave) R.lo = null; else R.hi = null;
        R.buf = []; pintar();
      });
    }

    // Una nota cuenta cuando se sostuvo: 0,8 s seguidos dentro de un semitono.
    function muestra(midi) {
      carril.muestra(midi);
      if (R.paso === 'fin') return;
      var t = ahora();
      if (midi == null) { R.buf = []; return; }
      if (R.buf.length && t - R.buf[R.buf.length - 1].t > 0.15) R.buf = [];
      R.buf.push({ t: t, m: midi });
      while (R.buf.length && t - R.buf[0].t > 0.8) R.buf.shift();
      if (t - R.buf[0].t < 0.7 || R.buf.length < 8) return;
      var ms = R.buf.map(function (p) { return p.m; }).sort(function (a, b) { return a - b; });
      if (ms[ms.length - 1] - ms[0] > 1) return;
      var nota = Math.round(ms[ms.length >> 1]);
      if (R.paso === 'grave' && (R.lo == null || nota < R.lo)) { R.lo = nota; pintar(); }
      else if (R.paso === 'aguda' && (R.hi == null || nota > R.hi)) { R.hi = nota; pintar(); }
    }

    var t0 = ahora();
    Escucha(view, cfg, muestra, function () {
      // prueba: escalones sostenidos que bajan (paso 1) o suben (paso 2)
      var t = ahora() - t0, k = Math.floor(t / 1.4) % 6;
      return (R.paso === 'aguda' ? 60 + 2 * k : 55 - 2 * k) + 0.1 * Math.sin(t * 6);
    }, estado);
    q('#krVolver').addEventListener('click', function () { ctx.navigate('canta'); });
    pintar();

    return function () { carril.parar(); SB.cantaPitch.stop(); };
  }

  SB.cantaLibre = {
    montar: function (view, modo, ctx, cfg) {
      return modo === 'rango' ? montarRango(view, ctx, cfg || {}) : montarLibre(view, ctx, cfg || {});
    },
    rango: rangoGuardado
  };
})();
