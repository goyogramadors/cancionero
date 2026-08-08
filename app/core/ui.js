/* ============================================================
   Utilidades de interfaz compartidas. window.SB.ui
   ============================================================ */
(function () {
  window.SB = window.SB || {};
  SB.ui = {
    // escapa también comillas: seguro tanto en texto como dentro de atributos HTML
    esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); },
    clear(node) { while (node.firstChild) node.removeChild(node.firstChild); },
    // convierte un string HTML en un fragmento de nodos
    frag(html) {
      const t = document.createElement('template');
      t.innerHTML = html.trim();
      return t.content;
    }
  };
})();
