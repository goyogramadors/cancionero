/* Servidor del progreso del Cancionero (Cloudflare Worker + KV).
   Abierto, sin cuentas: guarda y devuelve un JSON por nombre.
     GET  /progreso/<nombre>  → el JSON guardado ({} si no hay)
     PUT  /progreso/<nombre>  → lo reemplaza (máx. 256 KB)
   La app (app/core/nube.js) une siempre lo remoto con lo local antes de
   subir, así que dos navegadores que guardan a la vez no se pisan.
   Binding necesario: un namespace KV con el nombre PROGRESO. */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};
const MAX = 256 * 1024;

function resp(body, status, extra) {
  return new Response(body, { status: status || 200, headers: Object.assign({}, CORS, extra || {}) });
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return resp(null, 204);
    const m = new URL(req.url).pathname.match(/^\/progreso\/([a-z0-9-]{1,40})$/);
    if (!m) return resp('no existe', 404);
    const clave = 'progreso:' + m[1];
    if (req.method === 'GET') {
      const v = await env.PROGRESO.get(clave);
      return resp(v || '{}', 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    }
    if (req.method === 'PUT') {
      const texto = await req.text();
      if (texto.length > MAX) return resp('muy grande', 413);
      try { JSON.parse(texto); } catch (e) { return resp('no es JSON', 400); }
      await env.PROGRESO.put(clave, texto);
      return resp('{"ok":true}', 200, { 'Content-Type': 'application/json' });
    }
    return resp('método no permitido', 405);
  }
};
