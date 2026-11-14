import React, { useState, useEffect, useRef } from 'react';
import { Info } from 'lucide-react';

// Frecuencias base
const NOTE_FREQS = {
  'C': 130.81, 'C#/Db': 138.59, 'D': 146.83, 'D#/Eb': 155.56,
  'E': 164.81, 'F': 174.61, 'F#/Gb': 185.00, 'G': 196.00,
  'G#/Ab': 207.65, 'A': 220.00, 'A#/Bb': 233.08, 'B': 246.94
};

// Arreglo cromático estándar
const notasEstandar = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];

// Notas invertidas visualmente: Ascienden de abajo hacia arriba en pantalla
const baseNotes = [
  { name: 'B', type: 'white' }, { name: 'A#/Bb', type: 'black' }, { name: 'A', type: 'white' },
  { name: 'G#/Ab', type: 'black' }, { name: 'G', type: 'white' }, { name: 'F#/Gb', type: 'black' },
  { name: 'F', type: 'white' }, { name: 'E', type: 'white' }, { name: 'D#/Eb', type: 'black' },
  { name: 'D', type: 'white' }, { name: 'C#/Db', type: 'black' }, { name: 'C', type: 'white' },
];

// Generamos 12 octavas para evitar los límites de scroll (muro invisible)
const allNotes = [];
for (let i = 0; i < 12; i++) {
  allNotes.push(...baseNotes.map((note, index) => ({ ...note, id: `note-${i}-${index}` })));
}

// Grados Invertidos: Ascienden de abajo hacia arriba (Incluyendo isPenta para la Pentatónica)
const majorDegrees = [
  { num: 'vii°', label: '', chordType: 'dism', func: 'Ten', bgColor: 'bg-[#ab5c45]', intervals: [11, 14, 17], isPenta: false },
  null,
  { num: 'vi', label: '', chordType: 'menor', func: 'Rep', bgColor: 'bg-[#5f6b5f]', intervals: [9, 12, 16], isPenta: true },
  null,
  { num: 'V', label: '', chordType: 'Mayor', func: 'Ten', bgColor: 'bg-[#bba062]', intervals: [7, 11, 14], isPenta: true },
  null,
  { num: 'IV', label: '', chordType: 'Mayor', func: 'Mov', bgColor: 'bg-[#8ba4b9]', intervals: [5, 9, 12], isPenta: false },
  { num: 'iii', label: '', chordType: 'menor', func: 'Rep', bgColor: 'bg-[#6d7a6d]', intervals: [4, 7, 11], isPenta: true },
  null,
  { num: 'ii', label: '', chordType: 'menor', func: 'Mov', bgColor: 'bg-[#7c97aa]', intervals: [2, 5, 9], isPenta: true },
  null,
  { num: 'I', label: 'KEY', chordType: 'Mayor', func: 'Rep', bgColor: 'bg-[#7a9372]', intervals: [0, 4, 7], isKey: true, isPenta: true },
];

const minorDegrees = [
  null,
  { num: 'VII', label: '', chordType: 'Mayor', func: 'Mov', bgColor: 'bg-[#8ba4b9]', intervals: [10, 14, 17], isPenta: true },
  null,
  { num: 'VI', label: '', chordType: 'Mayor', func: 'Rep', bgColor: 'bg-[#6d7a6d]', intervals: [8, 12, 15], isPenta: false },
  { num: 'v', label: '', chordType: 'menor', func: 'Ten', bgColor: 'bg-[#bba062]', intervals: [7, 10, 14], isPenta: true },
  null,
  { num: 'iv', label: '', chordType: 'menor', func: 'Mov', bgColor: 'bg-[#7c97aa]', intervals: [5, 8, 12], isPenta: true },
  null,
  { num: 'III', label: '', chordType: 'Mayor', func: 'Rep', bgColor: 'bg-[#7a9372]', intervals: [3, 7, 10], isPenta: true },
  { num: 'ii°', label: '', chordType: 'dism', func: 'Ten', bgColor: 'bg-[#ab5c45]', intervals: [2, 5, 8], isPenta: false },
  null,
  { num: 'i', label: 'KEY', chordType: 'menor', func: 'Rep', bgColor: 'bg-[#636d82]', intervals: [0, 3, 7], isKey: true, isPenta: true },
];

export default function App() {
  const [showInfo, setShowInfo] = useState(false);
  const [mode, setMode] = useState('major');
  const [degrees, setDegrees] = useState([]);
  const [currentTonic, setCurrentTonic] = useState('C');
  const [lineTop, setLineTop] = useState(0);
  const [activeScaleNotes, setActiveScaleNotes] = useState([]);

  const audioCtx = useRef(null);
  const activeVoices = useRef({});
  const leftColRef = useRef(null);
  const rightColRef = useRef(null);
  const keyRef = useRef(null);
  
  // Altura exacta compacta (28px)
  const cellHeight = 28; 

  // Configuración inicial de las listas
  useEffect(() => {
    const base = mode === 'major' ? majorDegrees : minorDegrees;
    const list = [];
    // Creamos múltiples octavas para los grados también
    for (let i = 0; i < 8; i++) {
      list.push(...base.map((deg, index) => (deg ? { ...deg, id: `deg-${mode}-${i}-${index}` } : null)));
    }
    setDegrees(list);
    
    // Auto-scroll al centro exacto al cargar para evitar límites
    setTimeout(() => {
      if (leftColRef.current && rightColRef.current) {
        const leftEl = leftColRef.current;
        const rightEl = rightColRef.current;
        leftEl.scrollTop = (leftEl.scrollHeight / 2) - (leftEl.clientHeight / 2);
        rightEl.scrollTop = (rightEl.scrollHeight / 2) - (rightEl.clientHeight / 2);
      }
      updateUI();
    }, 100);
  }, [mode]);

  // Cálculo en tiempo real de las notas iluminadas
  useEffect(() => {
    const idx = notasEstandar.indexOf(currentTonic);
    if(idx === -1) return;
    const intervalos = mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
    const iluminadas = intervalos.map(i => notasEstandar[(idx + i) % 12]);
    setActiveScaleNotes(iluminadas);
  }, [currentTonic, mode]);

  const initAudio = () => {
    if (!audioCtx.current) {
      audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.current.state === 'suspended') {
      audioCtx.current.resume();
    }
  };

  const startChord = (deg, id) => {
    initAudio();
    stopChord(id);

    const tonicFreq = NOTE_FREQS[currentTonic] || 130.81;
    const voices = [];
    const rootInterval = deg.intervals[0];
    const bassFreq = (tonicFreq * Math.pow(2, rootInterval / 12)) / 2;
    
    voices.push(createVoice(bassFreq / 2, 0.4, 'sine', null));
    voices.push(createVoice(bassFreq, 0.15, 'triangle', 300));
    deg.intervals.forEach((interval) => {
      const freq = tonicFreq * Math.pow(2, interval / 12);
      voices.push(createVoice(freq, 0.15, 'sine', null));
      voices.push(createVoice(freq, 0.05, 'triangle', 600));
    });
    activeVoices.current[id] = voices;
  };

  const stopChord = (id) => {
    const voices = activeVoices.current[id];
    if (voices && audioCtx.current) {
      const now = audioCtx.current.currentTime;
      voices.forEach(voice => {
        try {
          voice.gain.gain.cancelScheduledValues(now);
          voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
          voice.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
          voice.osc.stop(now + 0.15);
        } catch (e) {}
      });
      delete activeVoices.current[id];
    }
  };

  const createVoice = (freq, volume, type, filterFreq) => {
    const osc = audioCtx.current.createOscillator();
    const gain = audioCtx.current.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.current.currentTime);
    gain.gain.setValueAtTime(0, audioCtx.current.currentTime);
    gain.gain.linearRampToValueAtTime(volume, audioCtx.current.currentTime + 0.05);
    let lastNode = osc;
    if (filterFreq) {
      const filter = audioCtx.current.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(filterFreq, audioCtx.current.currentTime);
      osc.connect(filter);
      lastNode = filter;
    }
    lastNode.connect(gain);
    gain.connect(audioCtx.current.destination);
    osc.start();
    return { osc, gain };
  };

  const updateUI = () => {
    if (keyRef.current && rightColRef.current && leftColRef.current) {
      const rightRect = rightColRef.current.getBoundingClientRect();
      const keyRect = keyRef.current.getBoundingClientRect();
      
      const relativeTop = keyRect.top - rightRect.top + (keyRect.height / 2);
      setLineTop(relativeTop);

      const absoluteLineY = rightRect.top + relativeTop;
      const leftItems = leftColRef.current.children;
      let closestNote = 'C';
      let minDiff = 9999;
      
      for (let item of leftItems) {
        const rect = item.getBoundingClientRect();
        const itemMid = rect.top + (rect.height / 2);
        const diff = Math.abs(itemMid - absoluteLineY);
        if (diff < minDiff) { 
          closestNote = item.getAttribute('data-note'); 
          minDiff = diff; 
        }
      }
      
      if (currentTonic !== closestNote) {
        setCurrentTonic(closestNote);
      }
    }
  };

  useEffect(() => {
    const leftEl = leftColRef.current;
    const rightEl = rightColRef.current;
    
    if (leftEl) leftEl.addEventListener('scroll', updateUI, { passive: true });
    if (rightEl) rightEl.addEventListener('scroll', updateUI, { passive: true });
    
    const interval = setInterval(updateUI, 50);

    return () => {
      if (leftEl) leftEl.removeEventListener('scroll', updateUI);
      if (rightEl) rightEl.removeEventListener('scroll', updateUI);
      clearInterval(interval);
    };
  }, [degrees, mode]);

  // Red Line Offsets para múltiples líneas simultáneas
  const redLineOffsets = [-3, -2, -1, 0, 1, 2, 3];

  return (
    <div className="flex flex-col h-screen w-full bg-[#f4f1ea] text-[#2d2d2d] font-serif overflow-hidden relative select-none touch-manipulation">
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .snap-container { scroll-snap-type: y mandatory; }
        .snap-item { scroll-snap-align: center; scroll-snap-stop: always; }
        .arrow-left { clip-path: polygon(10px 0%, 100% 0%, 100% 100%, 10px 100%, 0% 50%); }
      `}</style>

      {/* ENCABEZADO SUPERIOR */}
      <div className="bg-[#f4f1ea] border-b border-[#2d2d2d]/15 z-[60] shrink-0 p-5 h-[110px] flex flex-col justify-between relative shadow-sm">
        <div className="flex items-center justify-between">
          <h1 className="text-[15px] font-medium tracking-[0.3em] uppercase text-[#2d2d2d]">Campos Tonales</h1>
          <button onClick={() => setShowInfo(!showInfo)} className="opacity-50 hover:opacity-100 transition p-1">
            <Info size={20} />
          </button>
        </div>

        <div className="flex gap-6 h-8 mt-3">
          <button 
            onClick={() => setMode('major')}
            className={`flex-1 text-[12px] tracking-widest transition-all border-b-2 ${mode === 'major' 
              ? 'border-[#2d2d2d] font-bold text-[#2d2d2d]' : 'border-transparent opacity-40 font-light text-[#2d2d2d]'}`}
          >
            MAYOR
          </button>
          <button 
            onClick={() => setMode('minor')}
            className={`flex-1 text-[12px] tracking-widest transition-all border-b-2 ${mode === 'minor' 
              ? 'border-[#2d2d2d] font-bold text-[#2d2d2d]' : 'border-transparent opacity-40 font-light text-[#2d2d2d]'}`}
          >
            MENOR
          </button>
        </div>
      </div>

      {/* ÁREA PRINCIPAL DIVIDIDA (2/3 Izquierda, 1/3 Derecha) */}
      <div className="flex-1 flex flex-row relative overflow-hidden bg-[#e8e4db] p-1 shadow-inner">
        <div className="w-full h-full flex flex-row relative bg-[#1a1a1a] border border-[#2d2d2d]/20 overflow-hidden rounded-sm">

          {/* MÚLTIPLES LÍNEAS BERMELLÓN (Cruzan hacia las notas) */}
          {redLineOffsets.map(offset => (
            <div 
              key={offset}
              className="absolute left-0 right-0 h-[1.5px] bg-[#d64545] z-40 pointer-events-none transition-transform duration-75 ease-out shadow-[0_1px_4px_rgba(214,69,69,0.5)]"
              style={{ top: `${lineTop + (offset * 12 * cellHeight)}px`, transform: 'translateY(-50%)' }}
            >
              <div className="absolute left-2 -top-[9px] flex items-center bg-[#f4f1ea] px-1.5 py-0.5 rounded shadow-md border border-[#d64545]">
                <span className="text-[10px] font-black text-[#d64545] uppercase leading-none">{currentTonic}</span>
              </div>
            </div>
          ))}

          {/* 2/3 - COLUMNA DE NOTAS (TECLADO) */}
          <div 
            ref={leftColRef}
            className="w-2/3 h-full overflow-y-auto no-scrollbar border-r border-[#2d2d2d]/40 snap-container"
            style={{ paddingTop: '80vh', paddingBottom: '80vh' }}
          >
            {allNotes.map((note) => {
              const isHighlighted = activeScaleNotes.includes(note.name);

              return (
                <div 
                  key={note.id} data-note={note.name}
                  style={{ height: `${cellHeight}px` }}
                  // El fondo crema o arena NUNCA cambia
                  className={`flex-shrink-0 w-full flex items-center px-8 border-b border-[#2d2d2d]/20 tracking-widest transition-all duration-200 snap-item relative
                    ${note.type === 'white' ? 'bg-[#f4f1ea]' : 'bg-[#dcd8cc]'}`}
                >
                  {/* Iluminación Borde Izquierdo si está en la escala */}
                  {isHighlighted && (
                    <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#d64545] shadow-[2px_0_5px_rgba(214,69,69,0.4)]"></div>
                  )}

                  {/* Iluminación de Letra Roja si está en la escala, Gris tenue si no lo está */}
                  <span className={`text-[14px] transition-all duration-200
                    ${note.type === 'white' ? 'font-bold' : 'font-bold italic'} 
                    ${isHighlighted 
                      ? 'text-[#d64545] scale-110 drop-shadow-[0_0_8px_rgba(214,69,69,0.5)]' 
                      : 'text-[#2d2d2d]/30'}`}
                  >
                    {note.name}
                  </span>
                </div>
              );
            })}
          </div>

          {/* 1/3 - COLUMNA DE GRADOS (FLECHAS Y PENTATÓNICA) */}
          <div 
            ref={rightColRef}
            className="w-1/3 h-full overflow-y-auto no-scrollbar touch-pan-y snap-container bg-[#262626]"
            style={{ paddingTop: '80vh', paddingBottom: '80vh' }}
          >
            {degrees.map((deg, idx) => {
              if (!deg) return <div key={`empty-${idx}`} style={{ height: `${cellHeight}px` }} className="flex-shrink-0 border-b border-[#f4f1ea]/5 opacity-10 flex items-center justify-center snap-item"><div className="w-4 h-[1px] bg-[#f4f1ea]"></div></div>;

              // Utilizamos el KEY de una octava central para que el scroll tenga muchísimo margen a ambos lados
              const isKeyRef = deg.isKey && idx === (mode === 'major' ? 47 : 47);

              return (
                <div 
                  key={deg.id} 
                  ref={isKeyRef ? keyRef : null}
                  onPointerDown={() => startChord(deg, deg.id)}
                  onPointerUp={() => stopChord(deg.id)}
                  onPointerLeave={() => stopChord(deg.id)}
                  onPointerCancel={() => stopChord(deg.id)}
                  style={{ height: `${cellHeight}px` }}
                  className="flex-shrink-0 w-full pl-1 py-[1.5px] border-b border-[#f4f1ea]/5 select-none snap-item"
                >
                  <div className={`w-full h-full flex flex-row items-center justify-between px-3 pl-4 transition-all duration-100 active:scale-[0.97] active:brightness-95
                    ${deg.bgColor} text-[#f4f1ea] shadow-sm relative overflow-hidden arrow-left`}>
                    
                    <span className="text-[14px] font-black tracking-tighter uppercase z-10 drop-shadow-md">{deg.num}</span>
                    
                    <div className="flex flex-col items-end justify-center z-10">
                      {/* TEXTO DE ESPECIE + PUNTO PENTATÓNICO ● */}
                      <span className="text-[9px] font-bold uppercase tracking-widest leading-none drop-shadow-sm flex items-center gap-1">
                        {deg.chordType.slice(0, 3)}
                        {deg.isPenta && <span className="text-[10px] text-white/80 drop-shadow-md pb-[1px]">●</span>}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </div>

      {/* MODAL DE INSTRUCCIONES */}
      {showInfo && (
        <div className="absolute inset-0 bg-[#f4f1ea]/95 z-[200] flex items-center justify-center p-8 text-[#2d2d2d]" onClick={() => setShowInfo(false)}>
          <div className="max-w-xs border-l-2 border-[#d64545] pl-6 py-6 bg-[#f4f1ea] shadow-2xl">
            <h2 className="text-[16px] font-bold mb-4 uppercase tracking-[0.2em] text-[#d64545]">Uso del Selector</h2>
            <ul className="text-[12px] font-light leading-relaxed space-y-4 mb-8">
              <li><strong className="font-bold">Scroll Infinito:</strong> Se ha ampliado el área para llegar a cualquier nota libremente.</li>
              <li><strong className="font-bold">Iluminación Inteligente:</strong> Las notas de la escala se encienden en rojo conservando su fondo original.</li>
              <li><strong className="font-bold">Punto Pentatónico:</strong> Los acordes marcados con un punto (●) a la derecha pertenecen a la escala pentatónica de tu tono actual.</li>
            </ul>
            <button className="text-[11px] font-bold border-b-2 border-[#2d2d2d] pb-1 uppercase tracking-widest hover:text-[#d64545] transition-colors">Volver</button>
          </div>
        </div>
      )}
    </div>
  );
}