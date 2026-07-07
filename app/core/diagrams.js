/* ============================================================
   Diagramas de acordes (SVG, blanco y negro). window.SB.diagrams
   - guitar(pattern, label): patrón "x32010" (cuerda 0 = Mi grave).
   - piano(pitchClasses, label): conjunto de clases de altura 0..11.
   Compartido por el cancionero y la herramienta de acordes.
   ============================================================ */
(function () {
  window.SB = window.SB || {};
  const esc = (s) => SB.ui.esc(s);

  function guitar(pattern, label) {
    if (!pattern) return `<div class="diag"><span class="nm">${esc(label || '')}</span><div class="nodata">sin digitación</div></div>`;
    const frets = String(pattern).split('').map((c) => (c === 'x' || c === 'X' ? -1 : parseInt(c, 10)));
    while (frets.length < 6) frets.push(-1);
    const maxF = Math.max(...frets);
    const base = maxF > 4 ? Math.min(...frets.filter((f) => f > 0)) : 1;
    const W = 78, H = 96, left = 10, top = 18, cw = (W - 2 * left) / 5, rh = (H - top - 6) / 4;
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-label="${esc(label || '')}">`;
    for (let i = 0; i < 6; i++) s += `<line x1="${left + i * cw}" y1="${top}" x2="${left + i * cw}" y2="${H - 6}" stroke="var(--ink)" stroke-width="1"/>`;
    for (let j = 0; j < 5; j++) s += `<line x1="${left}" y1="${top + j * rh}" x2="${W - left}" y2="${top + j * rh}" stroke="var(--ink)" stroke-width="${j === 0 && base === 1 ? 3 : 1}"/>`;
    frets.forEach((f, i) => {
      const x = left + i * cw;
      if (f === -1) s += `<text x="${x}" y="${top - 6}" font-size="9" text-anchor="middle" fill="var(--mut)">×</text>`;
      else if (f === 0) s += `<circle cx="${x}" cy="${top - 9}" r="3" fill="none" stroke="var(--ink)"/>`;
      else { const rel = f - base + 1; s += `<circle cx="${x}" cy="${top + (rel - 0.5) * rh}" r="5" fill="var(--ink)"/>`; }
    });
    if (base > 1) s += `<text x="${W - 2}" y="${top + rh * 0.6}" font-size="9" text-anchor="end" fill="var(--mut)">${base}f</text>`;
    s += '</svg>';
    return s;
  }

  function piano(pcs, label) {
    const set = new Set(pcs);
    const whites = [0, 2, 4, 5, 7, 9, 11], blacks = [[1, 0], [3, 1], [6, 3], [8, 4], [10, 5]];
    const kw = 12, W = 7 * kw + 2, H = 52;
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-label="${esc(label || '')}">`;
    whites.forEach((pc, i) => {
      s += `<rect x="${1 + i * kw}" y="1" width="${kw}" height="${H - 2}" fill="var(--bg)" stroke="var(--ink)"/>`;
      if (set.has(pc)) s += `<circle cx="${1 + i * kw + kw / 2}" cy="${H - 10}" r="3.4" fill="var(--ink)"/>`;
    });
    blacks.forEach(([pc, after]) => {
      const x = 1 + (after + 1) * kw - 4;
      s += `<rect x="${x}" y="1" width="8" height="${H * 0.58}" fill="var(--ink)"/>`;
      if (set.has(pc)) s += `<circle cx="${x + 4}" cy="${H * 0.58 - 7}" r="3" fill="var(--bg)"/>`;
    });
    s += '</svg>';
    return s;
  }

  SB.diagrams = { guitar, piano };
})();
