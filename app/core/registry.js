/* ============================================================
   Registro de herramientas — el mecanismo de extensibilidad.
   Cada sub-herramienta se auto-registra aquí al cargarse.
   Forma de una herramienta:
     {
       id:      'songbook',            // único, va en la URL (#/songbook)
       name:    'Cancionero',          // etiqueta visible
       kind:    'primary'|'secondary', // primary = pestaña; secondary = botón pequeño
       icon:    '<svg…>',              // opcional (para las secundarias)
       mount(view, rest, ctx),         // pinta la herramienta en el contenedor
       onLeave()                       // opcional: limpieza al salir (ej. detener audio)
     }
   Para agregar una herramienta nueva: crea su archivo, llama a
   SB.registry.register({...}) y súmalo a la lista de <script> en index.html.
   ============================================================ */
(function () {
  window.SB = window.SB || {};
  const tools = [];
  SB.registry = {
    register(tool) {
      if (!tool || !tool.id) throw new Error('Herramienta sin id');
      if (tools.some((t) => t.id === tool.id)) return; // idempotente
      tools.push(tool);
    },
    all() { return tools.slice(); },
    get(id) { return tools.find((t) => t.id === id) || null; },
    primary() { return tools.filter((t) => t.kind !== 'secondary'); },
    secondary() { return tools.filter((t) => t.kind === 'secondary'); }
  };
})();
