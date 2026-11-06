/* ============================================================
   Progreso en la nube: el mismo avance en todos los navegadores.
   Guarda el progreso (lecciones y Práctica del Piano, récords de Canta)
   en el archivo progreso.json de la rama `datos` del repo. Esa rama no se
   publica, así que guardar no republica el sitio.

   - Leer no necesita nada: el repo es público.
   - Escribir usa el token de Ajustes (el mismo de «Subir»/«Publicar»).
     En un navegador sin token el progreso se ve, pero lo nuevo queda solo
     en ese navegador hasta que tenga el token.
   - Unir es conmutativo (máximos, uniones), así que dos navegadores que
     guardan a la vez no se pisan.

   API (SB.nube): traer() · cambio() · estado() · escribe(), y el evento
   de ventana 'sb:nube' cuando llega progreso de otro navegador.
   ============================================================ */
(function () {
  window.SB = window.SB || {};
  var RAMA = 'datos', RUTA = 'progreso.json';
  var S = { sha: null, ultimoTraer: 0, timer: null, subiendo: false, otraVez: false, error: '', listo: false };

  /* ---------- cómo se unen dos versiones ---------- */
  function unirMax(a, b) {
    var r = {};
    [a || {}, b || {}].forEach(function (o) { for (var k in o) { var v = +o[k] || 0; if (!(k in r) || v > r[k]) r[k] = v; } });
    return r;
  }
  // lecciones: {id: {ok, n, hecha, th}}; «hecha» la decide el cambio más reciente (th)
  function unirProg(a, b) {
    a = a || {}; b = b || {};
    var r = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (k) {
      var x = a[k] || {}, y = b[k] || {}, ult = (y.th || 0) > (x.th || 0) ? y : x;
      r[k] = { ok: Math.max(x.ok || 0, y.ok || 0), n: Math.max(x.n || 0, y.n || 0), hecha: !!ult.hecha, th: ult.th || 0 };
      if (!r[k].th && (x.hecha || y.hecha)) r[k].hecha = true;
    });
    return r;
  }
  function mejor(a, b) { if (!a) return b; if (!b) return a; return (a.pct > b.pct || (a.pct === b.pct && a.prom < b.prom)) ? a : b; }
  function fechaDe(r) { return (r && r.f) || ''; }
  // práctica: {ej: {id: {veces, ultimo, mejor, ciclo, f}}, dias: [fechas, una por sesión]}
  function unirPrac(a, b) {
    a = a || {}; b = b || {};
    var ea = a.ej || {}, eb = b.ej || {}, ej = {};
    Object.keys(ea).concat(Object.keys(eb)).forEach(function (k) {
      var x = ea[k] || {}, y = eb[k] || {}, z = {};
      z.veces = Math.max(x.veces || 0, y.veces || 0);
      var m = mejor(x.mejor, y.mejor); if (m) z.mejor = m;
      var masNuevo = (fechaDe(y.ultimo) > fechaDe(x.ultimo) || (y.veces || 0) > (x.veces || 0)) ? y : x;
      if (masNuevo.ultimo || x.ultimo || y.ultimo) z.ultimo = masNuevo.ultimo || x.ultimo || y.ultimo;
      if (masNuevo.ciclo != null) z.ciclo = masNuevo.ciclo; else if (x.ciclo != null) z.ciclo = x.ciclo; else if (y.ciclo != null) z.ciclo = y.ciclo;
      var f = fechaDe(x) > fechaDe(y) ? x.f : y.f; if (f) z.f = f;
      ej[k] = z;
    });
    // días: cada fecha cuenta tantas sesiones como el navegador que más tenga
    function cuenta(l) { var c = {}; (l || []).forEach(function (d) { c[d] = (c[d] || 0) + 1; }); return c; }
    var ca = cuenta(a.dias), cb = cuenta(b.dias), dias = [];
    Object.keys(Object.assign({}, ca, cb)).sort().forEach(function (d) {
      for (var i = 0, n = Math.max(ca[d] || 0, cb[d] || 0); i < n; i++) dias.push(d);
    });
    return { ej: ej, dias: dias.slice(-400) };
  }
  var CLAVES = {
    'sb.piano.progreso': unirProg,
    'sb.piano.practica': unirPrac,
    'sb.canta.best': unirMax
  };

  /* ---------- local ---------- */
  function leer(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function escribir(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function local() { var o = {}; Object.keys(CLAVES).forEach(function (k) { var v = leer(k); if (v) o[k] = v; }); return o; }
  function igual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /* ---------- repo ---------- */
  function repo() {
    var c = (SB.github && SB.github.cfg()) || {};
    if (c.owner && c.repo) return c;
    var u = SB.github && SB.github.repoDeUrl && SB.github.repoDeUrl();
    return u || { owner: 'goyogramadors', repo: 'cancionero' };
  }
  function puedeEscribir() { return !!(SB.github && SB.github.configured()); }
  function url() { var r = repo(); return 'https://api.github.com/repos/' + r.owner + '/' + r.repo + '/contents/' + RUTA; }
  function cabeceras() {
    var h = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (puedeEscribir()) h.Authorization = 'Bearer ' + SB.github.cfg().token;
    return h;
  }
  function b64enc(s) { return btoa(unescape(encodeURIComponent(s))); }
  function b64dec(s) { return decodeURIComponent(escape(atob(String(s).replace(/\n/g, '')))); }

  // Baja el progreso del repo y lo une con el de este navegador.
  // Devuelve true si cambió algo aquí (llegó progreso de otro lado).
  function traer(sinSubir) {
    if (!window.fetch) return Promise.resolve(false);
    return fetch(url() + '?ref=' + RAMA + '&t=' + Date.now(), { headers: cabeceras(), cache: 'no-store' }).then(function (res) {
      if (res.status === 404) { S.sha = null; return null; }
      if (!res.ok) throw new Error('GitHub ' + res.status);
      return res.json();
    }).then(function (data) {
      S.ultimoTraer = Date.now(); S.listo = true; S.error = '';
      var remoto = {};
      if (data) { S.sha = data.sha; try { remoto = (JSON.parse(b64dec(data.content)).claves) || {}; } catch (e) { remoto = {}; } }
      S.remoto = remoto;
      var cambio = false;
      Object.keys(CLAVES).forEach(function (k) {
        var mio = leer(k);
        if (!remoto[k]) return;
        var u = CLAVES[k](mio, remoto[k]);
        if (!igual(u, mio)) { escribir(k, u); cambio = true; }
      });
      if (cambio) { try { window.dispatchEvent(new CustomEvent('sb:nube')); } catch (e) {} }
      // si aquí hay algo que el repo no tiene, se sube
      if (!sinSubir && puedeEscribir() && !igual(unirTodo(remoto), remoto)) programar(500);
      return cambio;
    }).catch(function (e) { S.error = e.message || String(e); return false; });
  }
  function unirTodo(remoto) {
    var o = {}, l = local();
    Object.keys(CLAVES).forEach(function (k) {
      if (l[k] || remoto[k]) o[k] = CLAVES[k](remoto[k] || null, l[k] || null);
    });
    return o;
  }

  function subir() {
    if (!puedeEscribir() || !window.fetch) return Promise.resolve(false);
    if (S.subiendo) { S.otraVez = true; return Promise.resolve(false); }
    S.subiendo = true;
    // siempre se trae primero: así se une con lo último de los otros navegadores
    return traer(true).then(function () {
      var datos = unirTodo(S.remoto || {});
      if (S.sha && igual(datos, S.remoto)) return false;
      var cuerpo = { message: 'progreso: ' + new Date().toISOString(), branch: RAMA,
        content: b64enc(JSON.stringify({ v: 1, claves: datos }, null, 1)) };
      if (S.sha) cuerpo.sha = S.sha;
      return fetch(url(), { method: 'PUT', headers: cabeceras(), body: JSON.stringify(cuerpo) }).then(function (res) {
        if (res.status === 409 || res.status === 422) { S.otraVez = true; return false; }   // otro navegador guardó justo antes
        if (!res.ok) throw new Error('GitHub ' + res.status);
        return res.json().then(function (j) { S.sha = j.content && j.content.sha; S.remoto = datos; S.error = ''; return true; });
      });
    }).catch(function (e) { S.error = e.message || String(e); return false; })
      .then(function (r) {
        S.subiendo = false;
        if (S.otraVez) { S.otraVez = false; programar(1500); }
        return r;
      });
  }
  function programar(ms) { clearTimeout(S.timer); S.timer = setTimeout(subir, ms); }

  // las herramientas avisan cuando guardan progreso
  function cambio() { if (puedeEscribir()) programar(4000); }

  function estado() {
    if (S.error) return { ok: false, txt: 'No pude sincronizar el progreso (' + S.error + '). Queda guardado en este navegador.' };
    if (!puedeEscribir()) return { ok: true, txt: 'Tu progreso se trae de la nube. Para que lo de este navegador también se guarde allá, carga tu token en Ajustes (con tu contraseña).' };
    return { ok: true, txt: 'Tu progreso se guarda en la nube y aparece en cualquier navegador.' };
  }

  // al abrir la app y al volver a la pestaña (si pasó más de un minuto)
  setTimeout(function () { traer(); }, 0);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - S.ultimoTraer > 60000) traer(false);
    if (document.visibilityState === 'hidden' && S.timer) { clearTimeout(S.timer); subir(); }
  });

  SB.nube = { traer: traer, subir: subir, cambio: cambio, estado: estado, escribe: puedeEscribir,
    _unir: { prog: unirProg, prac: unirPrac, max: unirMax } };
})();
