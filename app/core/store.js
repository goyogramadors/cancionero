/* ============================================================
   Almacenamiento de canciones. window.SB.store

   Fase actual: la biblioteca semilla vive en data/songs.js (SB.SONGS),
   versionada en el repo. Las ediciones del usuario se guardan en
   localStorage como "override" por id. Export/import en JSON.

   Fase futura (repo Git como base de datos): reemplazar loadSong/saveSong
   por fetch de /data/songs/<id>.json y commit vía API de GitHub. La forma
   del dato NO cambia, así que las herramientas no se enteran.
   ============================================================ */
(function () {
  window.SB = window.SB || {};
  const LKEY = 'sb.songs.v1';

  function overrides() {
    try { return JSON.parse(localStorage.getItem(LKEY) || '{}'); }
    catch (e) { return {}; }
  }
  function writeOverrides(o) {
    try { localStorage.setItem(LKEY, JSON.stringify(o)); } catch (e) {}
  }
  function seed() { return window.SB.SONGS || []; }

  const store = {
    // catálogo liviano para la vista de repertorio
    library() {
      const ov = overrides();
      const ids = new Set();
      const list = [];
      for (const s of seed()) {
        ids.add(s.id);
        const o = ov[s.id];
        const song = o || s;
        list.push(meta(song));
      }
      // canciones creadas por el usuario (solo en localStorage)
      for (const id in ov) {
        if (!ids.has(id)) list.push(meta(ov[id]));
      }
      return list;
    },
    get(id) {
      const ov = overrides();
      if (ov[id]) return ov[id];
      return seed().find((s) => s.id === id) || null;
    },
    save(song) {
      const ov = overrides();
      ov[song.id] = song;
      writeOverrides(ov);
    },
    // vuelve una canción a su versión semilla del repo (descarta la edición local)
    reset(id) {
      const ov = overrides();
      delete ov[id];
      writeOverrides(ov);
    },
    exportAll() { return JSON.stringify({ overrides: overrides() }, null, 2); },
    importAll(json) {
      const data = JSON.parse(json);
      if (data && data.overrides) writeOverrides(data.overrides);
    },
    // para sincronización: objeto crudo de ediciones del usuario y mezcla
    dump() { return overrides(); },
    merge(obj) {
      if (!obj || typeof obj !== 'object') return;
      const ov = overrides();
      for (const id in obj) ov[id] = obj[id];
      writeOverrides(ov);
    }
  };

  function meta(s) {
    const parts = s.parts || [];
    const nParts = parts.filter((p) => !p.ref).length;
    const hasLyrics = parts.some((p) => p.lines);
    return {
      id: s.id, title: s.title, artist: s.artist, key: s.key,
      loaded: s.loaded !== false, nParts, hasLyrics
    };
  }

  SB.store = store;
})();
