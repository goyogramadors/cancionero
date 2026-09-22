/* ============================================================
   Sub-herramienta: Ajustes. Secundaria.
   - Tema (auto/claro/oscuro)
   - Respaldo local (descargar/importar JSON de tus canciones)
   - Sincronizar con GitHub (repo como base de datos)
   Depende de SB.store, SB.github.
   ============================================================ */
(function () {
  window.SB = window.SB || {};
  const esc = (s) => SB.ui.esc(s);
  const ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"></path></svg>';

  const THEME_KEY = 'sb.theme';
  function applyTheme(t) {
    const root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
    localStorage.setItem(THEME_KEY, t || 'auto');
  }

  function status(el, msg, ok) {
    el.textContent = msg;
    el.style.color = ok === false ? 'var(--ink)' : 'var(--mut)';
  }

  function mount(view) {
    const theme = localStorage.getItem(THEME_KEY) || 'auto';
    const c = SB.github.cfg();
    view.innerHTML = `
      <div class="pr-scope">
        <button class="back" id="setBack">← Cancionero</button>
        <div class="rep-head"><h1>Ajustes</h1></div>

        <section class="set-block">
          <h2>Tema</h2>
          <div class="seg" id="segTheme">
            <button data-t="auto">Auto</button><button data-t="light">Claro</button><button data-t="dark">Oscuro</button>
          </div>
        </section>

        <section class="set-block">
          <h2>Respaldo local</h2>
          <p class="ed-note">Tus canciones se guardan en este dispositivo. Descarga un respaldo para no perderlas o pásalo a otro navegador.</p>
          <div class="set-row">
            <button class="mini-x" id="btnExport">Descargar respaldo</button>
            <label class="mini-x" style="cursor:pointer">Importar respaldo<input type="file" id="fileImport" accept="application/json" hidden></label>
          </div>
          <span class="set-status" id="backupStatus"></span>
        </section>

        <section class="set-block">
          <h2>Sincronizar con GitHub</h2>
          <p class="ed-note">Guarda las canciones en tu repo (una fuente única para todos tus dispositivos). Necesita un token con permiso <b>Contents: Read and write</b> sobre el repo. El token se guarda solo en este dispositivo.</p>
          <div class="set-grid">
            <label>Owner <input id="ghOwner" value="${esc(c.owner || '')}" placeholder="tu-usuario"></label>
            <label>Repo <input id="ghRepo" value="${esc(c.repo || '')}" placeholder="songbook"></label>
            <label>Rama <input id="ghBranch" value="${esc(c.branch || 'main')}"></label>
            <label>Ruta <input id="ghPath" value="${esc(c.path || 'data/user-songs.json')}"></label>
            <label class="wide">Token <input id="ghToken" type="password" value="${esc(c.token || '')}" placeholder="github_pat_…"></label>
          </div>
          <div class="set-row">
            <button class="mini-x" id="btnSaveCfg">Guardar configuración</button>
            <button class="mini-x" id="btnPull">Traer del repo</button>
            <button class="mini-x add" id="btnPush">Subir al repo</button>
          </div>
          <span class="set-status" id="syncStatus"></span>
        </section>

        <section class="set-block">
          <h2>Usar el token en otros dispositivos</h2>
          <p class="ed-note">Guarda el token <b>cifrado con una contraseña</b> en el repo. En otro dispositivo basta con escribir la contraseña. El archivo cifrado es público: usa una <b>frase larga</b> (al menos ${SB.github.VAULT_MIN} caracteres, p.ej. cuatro palabras que no vayan juntas), porque cualquiera puede intentar adivinarla.</p>
          <div class="set-grid">
            <label class="wide">Contraseña <input id="vaultPass" type="password" autocomplete="new-password" placeholder="una frase larga"></label>
          </div>
          <div class="set-row">
            <button class="mini-x" id="btnUnseal">Desbloquear en este dispositivo</button>
            <button class="mini-x" id="btnSeal">Cifrar y guardar en el repo</button>
          </div>
          <span class="set-status" id="vaultStatus"></span>
        </section>
      </div>`;

    view.querySelector('#setBack').addEventListener('click', () => location.hash = '#/songbook');

    // tema
    const segTheme = view.querySelector('#segTheme');
    segTheme.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.t === theme);
      b.addEventListener('click', () => {
        applyTheme(b.dataset.t);
        segTheme.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.t === b.dataset.t));
      });
    });

    // respaldo local
    const bs = view.querySelector('#backupStatus');
    view.querySelector('#btnExport').addEventListener('click', () => {
      const blob = new Blob([SB.store.exportAll()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'cancionero-respaldo.json';
      a.click(); URL.revokeObjectURL(a.href);
      status(bs, 'Respaldo descargado.');
    });
    view.querySelector('#fileImport').addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try { SB.store.importAll(rd.result); status(bs, 'Respaldo importado. Recargando…'); setTimeout(() => location.reload(), 700); }
        catch (err) { status(bs, 'No se pudo leer el archivo: ' + err.message, false); }
      };
      rd.readAsText(f);
    });

    // github
    const ss = view.querySelector('#syncStatus');
    const readCfg = () => ({
      owner: view.querySelector('#ghOwner').value.trim(),
      repo: view.querySelector('#ghRepo').value.trim(),
      branch: view.querySelector('#ghBranch').value.trim() || 'main',
      path: view.querySelector('#ghPath').value.trim() || 'data/user-songs.json',
      token: view.querySelector('#ghToken').value.trim()
    });
    view.querySelector('#btnSaveCfg').addEventListener('click', () => { SB.github.setCfg(readCfg()); status(ss, 'Configuración guardada en este dispositivo.'); });
    view.querySelector('#btnPull').addEventListener('click', async () => {
      SB.github.setCfg(readCfg());
      status(ss, 'Trayendo del repo…');
      try {
        const { songs, canta, empty } = await SB.github.pull();
        if (empty) { status(ss, 'El archivo aún no existe en el repo (sube primero).'); return; }
        SB.store.merge(songs);
        // plataformas corregidas a mano y melodía elegida por canción
        const nCanta = (canta && SB.canta && SB.canta.importarAjustes)
          ? SB.canta.importarAjustes(canta) : 0;
        status(ss, 'Traído ' + Object.keys(songs).length + ' canción(es)'
          + (nCanta ? ' y ' + nCanta + ' ajuste(s) de Canta' : '') + '. Recargando…');
        setTimeout(() => location.reload(), 700);
      } catch (err) { status(ss, 'Error al traer: ' + err.message, false); }
    });
    view.querySelector('#btnPush').addEventListener('click', async () => {
      SB.github.setCfg(readCfg());
      status(ss, 'Subiendo al repo…');
      try {
        const canta = (SB.canta && SB.canta.exportarAjustes) ? SB.canta.exportarAjustes() : null;
        const res = await SB.github.push(SB.store.dump(), canta);
        const nCanta = canta
          ? Object.keys(canta.notas || {}).length + Object.keys(canta.melodia || {}).length : 0;
        status(ss, 'Subido' + (nCanta ? ' (con ' + nCanta + ' ajuste(s) de Canta)' : '')
          + '. Commit ' + (res.commit && res.commit.sha ? res.commit.sha.slice(0, 7) : 'ok') + '.');
      } catch (err) { status(ss, 'Error al subir: ' + err.message, false); }
    });

    // token cifrado: guardar desde un dispositivo que lo tiene / desbloquear en uno nuevo
    const vs = view.querySelector('#vaultStatus');
    const pass = view.querySelector('#vaultPass');
    view.querySelector('#btnSeal').addEventListener('click', async () => {
      SB.github.setCfg(readCfg());
      if (!SB.github.configured()) { status(vs, 'Primero completa owner, repo y token arriba.', false); return; }
      if (pass.value.length < SB.github.VAULT_MIN) { status(vs, 'La contraseña debe tener al menos ' + SB.github.VAULT_MIN + ' caracteres.', false); return; }
      const rep = prompt('Repite la contraseña para confirmar:');
      if (rep === null) return;
      if (rep !== pass.value) { status(vs, 'Las contraseñas no coinciden.', false); return; }
      status(vs, 'Cifrando y subiendo…');
      try {
        await SB.github.sealCfg(pass.value);
        pass.value = '';
        status(vs, 'Listo: token cifrado guardado en el repo. En otro dispositivo, entra a Ajustes y desbloquéalo con la contraseña.');
      } catch (err) { status(vs, 'No se pudo guardar: ' + err.message, false); }
    });
    view.querySelector('#btnUnseal').addEventListener('click', async () => {
      const f = readCfg(), url = SB.github.repoDeUrl() || {};
      const owner = f.owner || url.owner, repo = f.repo || url.repo;
      if (!owner || !repo) { status(vs, 'Escribe owner y repo arriba (no los pude deducir de la dirección).', false); return; }
      if (!pass.value) { status(vs, 'Escribe la contraseña.', false); return; }
      status(vs, 'Desbloqueando…');
      try {
        await SB.github.unsealCfg(pass.value, owner, repo, f.branch);
        pass.value = '';
        status(vs, 'Listo: token desbloqueado en este dispositivo. Recargando…');
        setTimeout(() => location.reload(), 700);
      } catch (err) { status(vs, 'No se pudo desbloquear: ' + err.message, false); }
    });
  }

  SB.settings = { applyTheme };
  SB.registry.register({ id: 'settings', name: 'Ajustes', kind: 'secondary', icon: ICON, mount });
})();
