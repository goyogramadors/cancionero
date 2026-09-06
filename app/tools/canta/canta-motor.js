/* ============================================================
   Canta — puente con el "motor" local (canta-prep/motor.py).
   window.SB.cantaMotor

   El motor es un servidor que corre en el computador del usuario
   (doble clic a canta-prep/motor.bat). Hace lo que el navegador no
   puede: bajar el audio de YouTube, separar la voz (Demucs) y
   transcribir la letra (Whisper). Además publica el paquete al repo
   con git, para que la canción quede disponible en el sitio publicado
   (y por lo tanto en el celular).

   El motor sirve la app en su mismo puerto, así que basta con pedir
   "api/estado" en relativo. Si la app se abrió de otra forma (por
   ejemplo con python -m http.server 8000), se prueba el puerto
   estándar del motor. En el sitio publicado no hay motor: la app lo
   detecta y explica qué hacer, sin romperse.
   ============================================================ */
(function () {
  window.SB = window.SB || {};

  var PUERTO = 8765;
  var base = null;      // prefijo de la API ('' = mismo origen)
  var estado = null;    // último /api/estado
  var buscando = null;  // promesa en curso (para no sondear dos veces)

  function conTiempo(url, opts, ms) {
    opts = opts || {};
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, ms || 2500);
    opts.signal = ctl.signal;
    return fetch(url, opts).finally(function () { clearTimeout(t); });
  }

  async function probar(prefijo) {
    try {
      var r = await conTiempo(prefijo + 'api/estado', { cache: 'no-store' }, 2500);
      if (!r.ok) return null;
      var j = await r.json();
      return (j && j.motor === 'canta-motor') ? j : null;
    } catch (e) { return null; }
  }

  // Busca el motor. Devuelve el estado o null. Memoriza el resultado.
  async function detectar(forzar) {
    if (!forzar && estado) return estado;
    if (buscando && !forzar) return buscando;
    buscando = (async function () {
      var e = await probar('');                       // el motor sirve esta app
      if (e) { base = ''; estado = e; return e; }
      // ¿la app se abrió con otro servidor local? probar el puerto del motor
      var local = location.protocol === 'http:' ||
        location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      if (local) {
        var pref = 'http://127.0.0.1:' + PUERTO + '/';
        e = await probar(pref);
        if (e) { base = pref; estado = e; return e; }
      }
      base = null; estado = null;
      return null;
    })();
    try { return await buscando; } finally { buscando = null; }
  }

  function exigir() {
    if (base === null) throw new Error('El motor no está corriendo.');
    return base;
  }

  async function json(ruta, opts) {
    var r = await fetch(exigir() + ruta, opts);
    var txt = await r.text();
    var j = null;
    try { j = JSON.parse(txt); } catch (e) {}
    if (!r.ok) throw new Error((j && (j.error || j.mensaje)) || ('Motor ' + r.status + ' — ' + txt.slice(0, 160)));
    return j;
  }

  SB.cantaMotor = {
    PUERTO: PUERTO,
    detectar: detectar,
    disponible: function () { return base !== null; },
    estado: function () { return estado; },
    urlBase: function () { return base; },

    // Preparar desde una URL de YouTube
    prepararUrl: function (datos) {
      return json('api/preparar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos)
      });
    },

    // Preparar desde un archivo local. Manda los bytes crudos (sin multipart)
    // y reporta el avance de la subida, que con un mp4 puede tardar.
    prepararArchivo: function (file, datos, onProgreso) {
      var qs = 'nombre=' + encodeURIComponent(file.name) +
        '&title=' + encodeURIComponent(datos.title || '') +
        '&artist=' + encodeURIComponent(datos.artist || '') +
        '&model=' + encodeURIComponent(datos.model || 'small') +
        (datos.language ? '&language=' + encodeURIComponent(datos.language) : '') +
        (datos.detector ? '&detector=' + encodeURIComponent(datos.detector) : '') +
        (datos.ejercicio ? '&ejercicio=1' : '');
      var url = exigir() + 'api/preparar-archivo?' + qs;
      return new Promise(function (res, rej) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.upload.onprogress = function (e) {
          if (onProgreso && e.lengthComputable) onProgreso(e.loaded / e.total);
        };
        xhr.onload = function () {
          var j = null;
          try { j = JSON.parse(xhr.responseText); } catch (e) {}
          if (xhr.status >= 200 && xhr.status < 300 && j) res(j);
          else rej(new Error((j && j.error) || ('Motor ' + xhr.status)));
        };
        xhr.onerror = function () { rej(new Error('Se cortó la conexión con el motor.')); };
        xhr.send(file);
      });
    },

    progreso: function (job) { return json('api/progreso?job=' + encodeURIComponent(job)); },
    cancelar: function (job) { return json('api/cancelar?job=' + encodeURIComponent(job), { method: 'POST' }); },

    // Publica el paquete al repo (git add/commit/push desde el computador)
    publicar: function (id) {
      return json('api/publicar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id })
      });
    },

    // Borra el paquete: de disco siempre, y del repo (git rm + commit + push)
    // si ya estaba publicado. Solo funciona con el motor corriendo.
    eliminar: function (id) {
      return json('api/eliminar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id })
      });
    }
  };
})();
