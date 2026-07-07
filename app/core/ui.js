/* ============================================================
   Utilidades de interfaz compartidas. window.SB.ui
   ============================================================ */
(function () {
  window.SB = window.SB || {};
  SB.ui = {
    esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    clear(node) { while (node.firstChild) node.removeChild(node.firstChild); },
    // convierte un string HTML en un fragmento de nodos
    frag(html) {
      const t = document.createElement('template');
      t.innerHTML = html.trim();
      return t.content;
    }
  };
})();
