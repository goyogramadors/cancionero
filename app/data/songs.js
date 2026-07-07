/* ============================================================
   Biblioteca semilla de canciones (versionada en el repo).
   Modelo canónico:
     - Cada acorde se ancla a la POSICIÓN DE UN CARÁCTER de la letra: [pos, "acorde"].
     - Acordes SIEMPRE en notación americana interna; latino es solo presentación.
     - Partes repetidas se referencian con "ref" (heredan la estructura).
     - Partes de solo acordes usan "grid" (filas de acordes) en vez de "lines".
   Para migrar más canciones desde fuentes/Cancionero.txt, generar más entradas
   con esta misma forma (idealmente con un script de migración).
   ============================================================ */
(function () {
  window.SB = window.SB || {};
  SB.SONGS = [
    {
      id: 'a-primeira-vista', title: 'A primeira vista', artist: 'Chico César', key: 'C', loaded: true,
      voicings: { 'G#dim': ['4x343x'], 'F#dim': ['2x121x'], 'Am/G#': ['4x2210'], 'Am/G': ['3x2210'] },
      parts: [
        { name: 'Intro', grid: [['C', 'G#dim', 'Am', 'F#dim', 'F', 'F#dim', 'G']], note: 'x1' },
        { name: 'Parte A', lines: [
          { l: ' Cuando no tenía nada deseé, cuando todo era ausencia esperé,', a: [[0, 'C'], [17, 'G#dim'], [27, 'Am'], [47, 'F#dim']] },
          { l: ' cuando tuve frío temblé, cuando tuve coraje llamé.', a: [[0, 'F'], [24, 'F#dim'], [46, 'G']] },
          { l: ' Cuando llegó carta la abrí, cuando escuché a Prince bailé,', a: [[0, 'C'], [14, 'G#dim'], [27, 'Am'], [46, 'F#dim']] },
          { l: ' cuando el ojo brilló entendí, cuando me crecieron alas volé.', a: [[0, 'F'], [29, 'F#dim'], [53, 'G']] },
          { l: ' Cuando me llamó allá fui, cuando me di cuenta estaba ahí,', a: [[0, 'C'], [14, 'G#dim'], [25, 'Am'], [41, 'F#dim']] },
          { l: ' cuando te encontré me perdí, en cuanto te vi me enamoré…', a: [[0, 'F'], [28, 'F#dim'], [43, 'G#dim']] }
        ] },
        { name: 'Inter coral', grid: [['Am', 'Am/G#', 'Am/G', 'F#dim', 'F', 'F#dim', 'G'], ['C', 'G#dim', 'Am', 'F#dim', 'F', 'F#dim', 'G']] },
        { name: 'Parte A', ref: 'Parte A', refNote: 'misma estructura de acordes', lines: [
          { l: ' Cuando llegó carta la abrí, cuando oí a Salif Keita bailé,', a: [[0, 'C'], [14, 'G#dim'], [27, 'Am'], [46, 'F#dim']] },
          { l: ' cuando el ojo brilló entendí, cuando me crecieron alas volé.', a: [[0, 'F'], [29, 'F#dim'], [53, 'G']] },
          { l: ' Cuando me llamó allá fui, cuando me di cuenta estaba ahí,', a: [[0, 'C'], [14, 'G#dim'], [25, 'Am'], [41, 'F#dim']] },
          { l: ' cuando te encontré me perdí, en cuanto te vi me enamoré…', a: [[0, 'F'], [28, 'F#dim'], [43, 'G#dim']] }
        ] },
        { name: 'Inter coral', ref: 'Inter coral', refNote: 'se repite', grid: [['Am', 'Am/G#', 'Am/G', 'F#dim', 'F', 'F#dim', 'G'], ['C', 'G#dim', 'Am', 'F#dim', 'F', 'F#dim', 'G']] },
        { name: 'Final coral', grid: [['C', 'G#dim', 'Am', 'F#dim', 'F', 'F#dim', 'G'], ['C', 'G#dim', 'Am', 'F#dim', 'F']], note: 'solo cuerdas' }
      ]
    },
    {
      id: 'unchained-melody', title: 'Unchained Melody', artist: 'Elvis Presley', key: 'C', loaded: true,
      parts: [
        { name: 'Parte A', grid: [['C', 'Am', 'F', 'G'], ['C', 'Am', 'G', '%']], note: '2 arpegios por nota · x2' },
        { name: 'Parte B', grid: [['C', 'G', 'Am', 'Em'], ['F', 'G', 'C', 'C7']], note: '2 arpegios por nota · x2' },
        { name: 'Parte C', grid: [['F', 'G', 'F', 'D#'], ['F', 'G', 'C']], note: '1 arpegio por nota, excepto C · x2' },
        { name: 'Coda', grid: [['C', 'Am', 'F', 'Fm', 'C']], note: '1 arpegio por nota' }
      ]
    },
    // --- Pendientes de migrar desde fuentes/Cancionero.txt ---
    { id: 'amor-violento', title: 'Amor violento', artist: 'Los Tres', key: '—', loaded: false },
    { id: 'algo-contigo', title: 'Algo contigo', artist: 'Vicentico', key: 'G', loaded: false },
    { id: 'ahora-quien', title: 'Ahora quién', artist: 'Marc Anthony', key: 'A#m', loaded: false },
    { id: 'flaca', title: 'Flaca', artist: 'Andrés Calamaro', key: '—', loaded: false },
    { id: 'adios-santiago-querido', title: 'Adiós Santiago querido', artist: 'Tradicional', key: 'Dm', loaded: false },
    { id: 'porque-yo-te-amo', title: 'Porque yo te amo', artist: 'Sandro', key: '—', loaded: false }
  ];
})();
