/* ============================================================
   Arranque de la app: construye la navegación desde el registro
   de herramientas y rutea por hash (#/<tool>/<resto>).
   Debe cargarse DESPUÉS de las herramientas (para que ya estén registradas).
   ============================================================ */
(function () {
  window.SB = window.SB || {};
  const view = document.getElementById('view');
  let current = null; // herramienta montada actualmente

  const ctx = {
    navigate(path) {
      const target = '#/' + String(path).replace(/^#?\/?/, '');
      if (location.hash === target) render(); // misma URL → re-render manual
      else location.hash = target;
    }
  };

  function defaultId() {
    const p = SB.registry.primary()[0] || SB.registry.all()[0];
    return p ? p.id : '';
  }
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const i = h.indexOf('/');
    const id = i < 0 ? h : h.slice(0, i);
    const rest = i < 0 ? '' : h.slice(i + 1);
    return { id: id || defaultId(), rest };
  }

  function buildNav() {
    const prim = document.getElementById('navPrimary');
    const sec = document.getElementById('navSecondary');
    prim.innerHTML = ''; sec.innerHTML = '';
    SB.registry.primary().forEach((t) => {
      const b = document.createElement('button');
      b.setAttribute('role', 'tab'); b.dataset.tool = t.id; b.textContent = t.name;
      b.addEventListener('click', () => ctx.navigate(t.id));
      prim.appendChild(b);
    });
    SB.registry.secondary().forEach((t) => {
      const b = document.createElement('button');
      b.className = 'mini-app-btn'; b.dataset.tool = t.id;
      b.innerHTML = (t.icon || '') + '<span>' + SB.ui.esc(t.name) + '</span>';
      b.title = t.name;
      b.addEventListener('click', () => ctx.navigate(t.id));
      sec.appendChild(b);
    });
  }
  function markNav(activeId) {
    document.querySelectorAll('#navPrimary button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tool === activeId));
    document.querySelectorAll('#navSecondary button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === activeId));
  }

  function render() {
    const { id, rest } = parseHash();
    const tool = SB.registry.get(id) || SB.registry.get(defaultId());
    if (current && current.onLeave && current !== tool) {
      try { current.onLeave(); } catch (e) {}
    }
    current = tool;
    markNav(tool ? tool.id : '');
    // permite que una herramienta pida más ancho en pantallas grandes sin
    // ensanchar las que se leen mejor angostas (letra, acordes)
    document.body.dataset.tool = tool ? tool.id : '';
    SB.ui.clear(view);
    if (tool) tool.mount(view, rest, ctx);
    window.scrollTo(0, 0);
  }

  function boot() {
    // aplicar tema guardado antes de pintar
    const t = localStorage.getItem('sb.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    buildNav();
    window.addEventListener('hashchange', render);
    if (!location.hash) location.replace('#/' + defaultId());
    render();
    // registrar service worker solo si está servido por http(s) (no en file://)
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
