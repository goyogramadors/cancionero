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
    if (res.status === 404) { const e = new Error('no está en el repo (' + p + ')'); e.notFound = true; throw e; }
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

  /* ---------- token cifrado en el repo (para usarlo en otros dispositivos) ----------
     El repo es público: el token NO puede ir en claro. Se guarda la
     configuración completa cifrada con AES-GCM, con clave derivada de una
     contraseña (PBKDF2-SHA256). Quien tenga el archivo puede probar
     contraseñas sin límite, así que la seguridad depende del largo de la
     contraseña (por eso se exige un mínimo). */
  const VAULT_PATH = 'data/token.enc.json';
  const VAULT_ITER = 600000;          // PBKDF2-SHA256, recomendación OWASP
  const VAULT_MIN = 16;               // largo mínimo de la contraseña
  const bytesB64 = (u8) => btoa(String.fromCharCode.apply(null, u8));
  const b64Bytes = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

  async function vaultKey(password, salt, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // Cifra la configuración de ESTE dispositivo y la sube al repo.
  async function sealCfg(password) {
    const c = cfg(); assertCfg(c);
    if (!password || password.length < VAULT_MIN) throw new Error('la contraseña debe tener al menos ' + VAULT_MIN + ' caracteres');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await vaultKey(password, salt, VAULT_ITER);
    const plain = new TextEncoder().encode(JSON.stringify({ owner: c.owner, repo: c.repo, branch: branch(c), path: path(c), token: c.token }));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plain));
    const blob = { v: 1, kdf: 'PBKDF2-SHA256', iter: VAULT_ITER, salt: bytesB64(salt), iv: bytesB64(iv), ct: bytesB64(ct) };
    let sha = null;
    try { sha = (await getFile(VAULT_PATH)).sha; } catch (e) { if (!e.notFound) throw e; }
    return putFile(VAULT_PATH, JSON.stringify(blob, null, 2) + '\n', sha, 'ajustes: guarda el token cifrado (para otros dispositivos)');
  }

  // En un dispositivo nuevo: baja el archivo cifrado SIN token (el repo es
  // público) y lo descifra con la contraseña. Si resulta, deja la config lista.
  async function unsealCfg(password, owner, repo, br) {
    if (!owner || !repo) throw new Error('falta owner/repo');
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${VAULT_PATH}?ref=${encodeURIComponent(br || 'main')}`;
    const res = await fetch(url, { headers: { Accept: 'application/vnd.github.raw' }, cache: 'no-store' });
    if (res.status === 404) throw new Error('todavía no hay un token cifrado en el repo (guárdalo primero desde un dispositivo que ya lo tenga)');
    if (!res.ok) throw new Error('GitHub ' + res.status + ' al leer el token cifrado');
    const blob = JSON.parse(await res.text());
    const key = await vaultKey(password, b64Bytes(blob.salt), blob.iter);
    let plain;
    try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64Bytes(blob.iv) }, key, b64Bytes(blob.ct)); }
    catch (e) { throw new Error('contraseña incorrecta'); }
    const c = JSON.parse(new TextDecoder().decode(plain));
    setCfg(c);
    return c;
  }

  // owner/repo deducidos de la URL de GitHub Pages (usuario.github.io/repo/...)
  function repoDeUrl() {
    const h = location.hostname;
    if (!/\.github\.io$/.test(h)) return null;
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return seg ? { owner: h.split('.')[0], repo: seg } : null;
  }

  SB.github = { cfg, setCfg, pull, push, getFile, putFile, sealCfg, unsealCfg, repoDeUrl, VAULT_MIN,
    configured() { const c = cfg(); return !!(c.owner && c.repo && c.token); } };
})();
