/* ============================================================
   Sincronización con GitHub — "repo Git como base de datos".
   Guarda/lee las canciones del usuario en UN archivo JSON del repo
   (por defecto data/user-songs.json) usando la API de contenidos.
   Requiere un token con permiso de escritura de contenidos (fine-grained,
   Contents: Read and write, sobre el repo del cancionero).
   Sin token, la app funciona igual con localStorage; esto es opcional.
   window.SB.github
   ============================================================ */
(function () {
  window.SB = window.SB || {};
  const CKEY = 'sb.github.cfg';

  function cfg() { try { return JSON.parse(localStorage.getItem(CKEY) || '{}'); } catch (e) { return {}; } }
  function setCfg(c) { localStorage.setItem(CKEY, JSON.stringify(c)); }
  function path(c) { return c.path || 'data/user-songs.json'; }
  function branch(c) { return c.branch || 'main'; }
  function headers(c) {
    return { 'Authorization': 'Bearer ' + c.token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }
  function getUrl(c) { return `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path(c)}?ref=${encodeURIComponent(branch(c))}`; }
  function putUrl(c) { return `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path(c)}`; }
  // base64 seguro para UTF-8
  function b64enc(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64dec(b64) { return decodeURIComponent(escape(atob(b64.replace(/\n/g, '')))); }
  function assertCfg(c) { if (!c.owner || !c.repo || !c.token) throw new Error('Falta configurar owner, repo y token.'); }

  async function currentSha(c) {
    const res = await fetch(getUrl(c), { headers: headers(c) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('GitHub ' + res.status + ' — ' + (await res.text()).slice(0, 140));
    return (await res.json()).sha;
  }

  // Trae las canciones del repo → objeto { id: song } (o null si no existe aún).
  async function pull() {
    const c = cfg(); assertCfg(c);
    const res = await fetch(getUrl(c), { headers: headers(c) });
    if (res.status === 404) return { songs: {}, empty: true };
    if (!res.ok) throw new Error('GitHub ' + res.status + ' — ' + (await res.text()).slice(0, 140));
    const data = await res.json();
    const parsed = JSON.parse(b64dec(data.content));
    // Un archivo viejo es el objeto de canciones pelado; uno nuevo trae
    // {overrides, canta}. Se aceptan los dos para no romper lo ya subido.
    return {
      songs: parsed.overrides || parsed || {},
      canta: parsed.canta || null,
      sha: data.sha
    };
  }

  // Sube las canciones y, si se le pasan, los ajustes de Canta (plataformas
  // corregidas a mano y qué melodía se eligió para cada canción).
  async function push(overrides, canta) {
    const c = cfg(); assertCfg(c);
    const sha = await currentSha(c);
    const payload = { overrides: overrides };
    if (canta) payload.canta = canta;
    const body = {
      message: 'songbook: actualiza canciones (' + new Date().toISOString() + ')',
      content: b64enc(JSON.stringify(payload, null, 2)),
      branch: branch(c)
    };
    if (sha) body.sha = sha;
    const res = await fetch(putUrl(c), { method: 'PUT', headers: headers(c), body: JSON.stringify(body) });
    if (!res.ok) throw new Error('GitHub ' + res.status + ' — ' + (await res.text()).slice(0, 180));
    return await res.json();
  }

  // Leer/escribir un archivo cualquiera del repo (p.ej. el canta.json de un
  // paquete, para publicar plataformas corregidas desde la app).
  function fileUrl(c, p) {
    return `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}`;
  }
  async function getFile(p) {
    const c = cfg(); assertCfg(c);
    const url = fileUrl(c, p) + '?ref=' + encodeURIComponent(branch(c));
    const res = await fetch(url, { headers: headers(c), cache: 'no-store' });
    if (res.status === 404) throw new Error('no está en el repo (' + p + ')');
    if (!res.ok) throw new Error('GitHub ' + res.status + ' — ' + (await res.text()).slice(0, 140));
    const data = await res.json();
    if (data.content) return { text: b64dec(data.content), sha: data.sha };
    // sobre 1 MB la API no manda el contenido en línea: se pide crudo
    const raw = await fetch(url, { headers: Object.assign(headers(c), { Accept: 'application/vnd.github.raw' }), cache: 'no-store' });
    if (!raw.ok) throw new Error('GitHub ' + raw.status + ' al leer ' + p);
    return { text: await raw.text(), sha: data.sha };
  }
  async function putFile(p, text, sha, message) {
    const c = cfg(); assertCfg(c);
    const body = { message: message, content: b64enc(text), branch: branch(c) };
    if (sha) body.sha = sha;
    const res = await fetch(fileUrl(c, p), { method: 'PUT', headers: headers(c), body: JSON.stringify(body) });
    if (res.status === 409) throw new Error('el archivo cambió en el repo mientras editabas; recarga y vuelve a intentar');
    if (!res.ok) throw new Error('GitHub ' + res.status + ' — ' + (await res.text()).slice(0, 180));
    return await res.json();
  }

  SB.github = { cfg, setCfg, pull, push, getFile, putFile, configured() { const c = cfg(); return !!(c.owner && c.repo && c.token); } };
})();
