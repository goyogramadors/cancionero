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
    return { songs: parsed.overrides || parsed || {}, sha: data.sha };
  }

  // Sube el objeto de canciones (overrides) al repo (commit).
  async function push(overrides) {
    const c = cfg(); assertCfg(c);
    const sha = await currentSha(c);
    const body = {
      message: 'songbook: actualiza canciones (' + new Date().toISOString() + ')',
      content: b64enc(JSON.stringify({ overrides }, null, 2)),
      branch: branch(c)
    };
    if (sha) body.sha = sha;
    const res = await fetch(putUrl(c), { method: 'PUT', headers: headers(c), body: JSON.stringify(body) });
    if (!res.ok) throw new Error('GitHub ' + res.status + ' — ' + (await res.text()).slice(0, 180));
    return await res.json();
  }

  SB.github = { cfg, setCfg, pull, push, configured() { const c = cfg(); return !!(c.owner && c.repo && c.token); } };
})();
