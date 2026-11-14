import React, { useState, useEffect, useRef } from 'react';
import { Info, HelpCircle } from 'lucide-react';
import { DegreeDefinition, InteractiveNote } from '../types';

const NOTE_FREQS: { [key: string]: number } = {
  'C': 130.81, 'C#/Db': 138.59, 'D': 146.83, 'D#/Eb': 155.56,
  'E': 164.81, 'F': 174.61, 'F#/Gb': 185.00, 'G': 196.00,
  'G#/Ab': 207.65, 'A': 220.00, 'A#/Bb': 233.08, 'B': 246.94
};

const standardNotes = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];

const baseNotes = [
  { name: 'B', type: 'white' as const }, { name: 'A#/Bb', type: 'black' as const }, { name: 'A', type: 'white' as const },
  { name: 'G#/Ab', type: 'black' as const }, { name: 'G', type: 'white' as const }, { name: 'F#/Gb', type: 'black' as const },
  { name: 'F', type: 'white' as const }, { name: 'E', type: 'white' as const }, { name: 'D#/Eb', type: 'black' as const },
  { name: 'D', type: 'white' as const }, { name: 'C#/Db', type: 'black' as const }, { name: 'C', type: 'white' as const },
];

// Generate 12 octaves to avoid reaching scroll bounds immediately
const allNotes: InteractiveNote[] = [];
for (let i = 0; i < 12; i++) {
  allNotes.push(...baseNotes.map((note, index) => ({ ...note, id: `note-${i}-${index}` })));
}

const majorDegrees: (DegreeDefinition | null)[] = [
  { num: 'vii°', label: '', chordType: 'dism', func: 'Ten', bgColor: 'bg-rose-950/40 border-rose-900 text-rose-300', intervals: [11, 14, 17], isPenta: false },
  null,
  { num: 'vi', label: '', chordType: 'menor', func: 'Rep', bgColor: 'bg-teal-950/40 border-teal-900 text-teal-300', intervals: [9, 12, 16], isPenta: true },
  null,
  { num: 'V', label: '', chordType: 'Mayor', func: 'Ten', bgColor: 'bg-amber-950/40 border-amber-900 text-amber-300', intervals: [7, 11, 14], isPenta: true },
  null,
  { num: 'IV', label: '', chordType: 'Mayor', func: 'Mov', bgColor: 'bg-blue-950/40 border-blue-900 text-blue-300', intervals: [5, 9, 12], isPenta: false },
  { num: 'iii', label: '', chordType: 'menor', func: 'Rep', bgColor: 'bg-emerald-950/40 border-emerald-900 text-emerald-300', intervals: [4, 7, 11], isPenta: true },
  null,
  { num: 'ii', label: '', chordType: 'menor', func: 'Mov', bgColor: 'bg-sky-950/40 border-sky-900 text-sky-300', intervals: [2, 5, 9], isPenta: true },
  null,
  { num: 'I', label: 'KEY', chordType: 'Mayor', func: 'Rep', bgColor: 'bg-violet-950/40 border-violet-900 text-violet-300', isKey: true, isPenta: true, intervals: [0, 4, 7] },
];

const minorDegrees: (DegreeDefinition | null)[] = [
  null,
  { num: 'VII', label: '', chordType: 'Mayor', func: 'Mov', bgColor: 'bg-blue-950/40 border-blue-900 text-blue-300', intervals: [10, 14, 17], isPenta: true },
  null,
  { num: 'VI', label: '', chordType: 'Mayor', func: 'Rep', bgColor: 'bg-emerald-950/40 border-emerald-900 text-emerald-300', intervals: [8, 12, 15], isPenta: false },
  { num: 'v', label: '', chordType: 'menor', func: 'Ten', bgColor: 'bg-amber-950/40 border-amber-900 text-amber-300', intervals: [7, 10, 14], isPenta: true },
  null,
  { num: 'iv', label: '', chordType: 'menor', func: 'Mov', bgColor: 'bg-sky-950/40 border-sky-900 text-sky-300', intervals: [5, 8, 12], isPenta: true },
  null,
  { num: 'III', label: '', chordType: 'Mayor', func: 'Rep', bgColor: 'bg-teal-950/40 border-teal-900 text-teal-300', intervals: [3, 7, 10], isPenta: true },
  { num: 'ii°', label: '', chordType: 'dism', func: 'Ten', bgColor: 'bg-rose-950/40 border-rose-900 text-rose-300', intervals: [2, 5, 8], isPenta: false },
  null,
  { num: 'i', label: 'KEY', chordType: 'menor', func: 'Rep', bgColor: 'bg-violet-950/40 border-violet-900 text-violet-300', isKey: true, isPenta: true, intervals: [0, 3, 7] },
];

export default function InspectorEscalas() {
  const [showInfo, setShowInfo] = useState(false);
  const [mode, setMode] = useState<'major' | 'minor'>('major');
  const [degrees, setDegrees] = useState<(DegreeDefinition | null)[]>([]);
  const [currentTonic, setCurrentTonic] = useState('C');
  const [lineTop, setLineTop] = useState(0);
  const [activeScaleNotes, setActiveScaleNotes] = useState<string[]>([]);

  const audioCtx = useRef<AudioContext | null>(null);
  const activeVoices = useRef<{ [key: string]: any[] }>({});
  const leftColRef = useRef<HTMLDivElement | null>(null);
  const rightColRef = useRef<HTMLDivElement | null>(null);
  const keyRef = useRef<HTMLDivElement | null>(null);
  
  const cellHeight = 28; // height of cell

  useEffect(() => {
    const base = mode === 'major' ? majorDegrees : minorDegrees;
    const list: (DegreeDefinition | null)[] = [];
    
    // Create multiple octaves for degrees to correspond to endless keyboard
    for (let i = 0; i < 8; i++) {
      list.push(...base.map((deg, index) => (deg ? { ...deg, id: `deg-${mode}-${i}-${index}` } : null)));
    }
    setDegrees(list);
    
    // Auto-scroll to the middle upon load
    setTimeout(() => {
      if (leftColRef.current && rightColRef.current) {
        const leftEl = leftColRef.current;
        const rightEl = rightColRef.current;
        leftEl.scrollTop = (leftEl.scrollHeight / 2) - (leftEl.clientHeight / 2);
        rightEl.scrollTop = (rightEl.scrollHeight / 2) - (rightEl.clientHeight / 2);
      }
      updateUI();
    }, 120);
  }, [mode]);

  useEffect(() => {
    const idx = standardNotes.indexOf(currentTonic);
    if (idx === -1) return;
    const intervals = mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
    const highlighted = intervals.map(i => standardNotes[(idx + i) % 12]);
    setActiveScaleNotes(highlighted);
  }, [currentTonic, mode]);

  const initAudio = () => {
    if (!audioCtx.current) {
      audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.current.state === 'suspended') {
      audioCtx.current.resume();
    }
  };

  const createVoice = (freq: number, volume: number, type: 'sine' | 'triangle' | 'sawtooth' | 'square', filterFreq: number | null) => {
    if (!audioCtx.current) return null;
    const osc = audioCtx.current.createOscillator();
    const gain = audioCtx.current.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.current.currentTime);
    gain.gain.setValueAtTime(0, audioCtx.current.currentTime);
    gain.gain.linearRampToValueAtTime(volume, audioCtx.current.currentTime + 0.05);

    let lastNode: AudioNode = osc;
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

  const startChord = (deg: DegreeDefinition, id: string) => {
    initAudio();
    stopChord(id);
    if (!audioCtx.current) return;

    const tonicFreq = NOTE_FREQS[currentTonic] || 130.81;
    const voices: any[] = [];
    const rootInterval = deg.intervals[0];
    
    // Bass note: root transposed 2 octaves down
    const bassFreq = (tonicFreq * Math.pow(2, rootInterval / 12)) / 4;
    
    const v1 = createVoice(bassFreq, 0.25, 'sine', null);
    if (v1) voices.push(v1);
    
    const v2 = createVoice(bassFreq * 2, 0.1, 'triangle', 250);
    if (v2) voices.push(v2);

    deg.intervals.forEach((interval) => {
      const freq = tonicFreq * Math.pow(2, interval / 12);
      const vSine = createVoice(freq, 0.12, 'sine', null);
      if (vSine) voices.push(vSine);
      
      const vTri = createVoice(freq, 0.04, 'triangle', 550);
      if (vTri) voices.push(vTri);
    });

    activeVoices.current[id] = voices;
  };

  const stopChord = (id: string) => {
    const voices = activeVoices.current[id];
    if (voices && audioCtx.current) {
      const now = audioCtx.current.currentTime;
      voices.forEach(voice => {
        try {
          voice.gain.gain.cancelScheduledValues(now);
          voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
          voice.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
          voice.osc.stop(now + 0.18);
        } catch (e) {}
      });
      delete activeVoices.current[id];
    }
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
      
      for (let i = 0; i < leftItems.length; i++) {
        const item = leftItems[i] as HTMLElement;
        const rect = item.getBoundingClientRect();
        const itemMid = rect.top + (rect.height / 2);
        const diff = Math.abs(itemMid - absoluteLineY);
        if (diff < minDiff) { 
          const noteAttr = item.getAttribute('data-note');
          if (noteAttr) {
            closestNote = noteAttr;
            minDiff = diff; 
          }
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
    
    const interval = setInterval(updateUI, 60);

    return () => {
      if (leftEl) leftEl.removeEventListener('scroll', updateUI);
      if (rightEl) rightEl.removeEventListener('scroll', updateUI);
      clearInterval(interval);
    };
  }, [degrees, mode]);

  // Multiple offsets for red alignment lines extending through adjacent octaves
  const redLineOffsets = [-3, -2, -1, 0, 1, 2, 3];

  return (
    <div className="flex flex-col h-[75vh] w-full bg-zinc-950 border border-zinc-800 rounded-sm overflow-hidden relative select-none animate-fade-in" id="inspector-escalas">
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .snap-container { scroll-snap-type: y mandatory; }
        .snap-item { scroll-snap-align: center; scroll-snap-stop: always; }
        .arrow-left { clip-path: polygon(12px 0%, 100% 0%, 100% 100%, 12px 100%, 0% 50%); }
      `}</style>

      {/* Control panel header */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-6 py-4 flex items-center justify-between shrink-0 z-50">
        <div>
          <h2 className="text-xl font-serif font-medium text-zinc-100 flex items-center gap-2">
            Inspector de Escalas
            <span className="text-xs font-bold text-[#D4A373] bg-[#D4A373]/10 border border-[#D4A373]/30 px-2 py-0.5 rounded-sm uppercase tracking-wider">
              {currentTonic} {mode === 'major' ? 'Mayor' : 'Menor'}
            </span>
          </h2>
          <p className="text-xs text-zinc-550 mt-0.5">Haz scroll en las notas de la izquierda; pulsa los acordes a la derecha.</p>
        </div>

        <div className="flex bg-zinc-950 p-1 rounded-sm border border-zinc-800 gap-1">
          <button
            onClick={() => setMode('major')}
            className={`px-3 py-1.5 rounded-sm text-[10px] uppercase tracking-wider font-extrabold transition-all duration-200 ${
              mode === 'major' ? 'bg-[#1C1C1C] text-[#FDFCFB] border border-zinc-800 shadow-sm' : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            MODO MAYOR
          </button>
          <button
            onClick={() => setMode('minor')}
            className={`px-3 py-1.5 rounded-sm text-[10px] uppercase tracking-wider font-extrabold transition-all duration-200 ${
              mode === 'minor' ? 'bg-[#1C1C1C] text-[#FDFCFB] border border-zinc-800 shadow-sm' : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            MODO MENOR
          </button>
          <button 
            onClick={() => setShowInfo(!showInfo)} 
            className="p-1 px-2 text-zinc-400 hover:text-zinc-100 transition"
          >
            <HelpCircle size={15} />
          </button>
        </div>
      </div>

      {/* Dual scroll columns section */}
      <div className="flex-1 flex flex-row relative bg-zinc-950 overflow-hidden">
        
        {/* Red alignments lines syncing selected notes across the screen */}
        {redLineOffsets.map(offset => (
          <div 
            key={offset}
            className="absolute left-0 right-0 h-[1.5px] bg-emerald-500/80 z-40 pointer-events-none transition-transform duration-75 ease-out shadow-[0_0_8px_rgba(16,185,129,0.3)]"
            style={{ top: `${lineTop + (offset * 12 * cellHeight)}px`, transform: 'translateY(-50%)' }}
          >
            {offset === 0 && (
              <div className="absolute left-4 -top-[10px] flex items-center bg-zinc-900 px-2 py-0.5 rounded border border-emerald-500 shadow-md">
                <span className="text-[9px] font-extrabold text-emerald-400 uppercase leading-none">{currentTonic}</span>
              </div>
            )}
          </div>
        ))}

        {/* 2/3 - Left scrollable column of notes (piano keys interface) */}
        <div 
          ref={leftColRef}
          className="w-1/2 md:w-2/3 h-full overflow-y-auto no-scrollbar border-r border-zinc-800 snap-container cursor-grab active:cursor-grabbing"
          style={{ paddingTop: '40vh', paddingBottom: '40vh' }}
        >
          {allNotes.map((note) => {
            const isHighlighted = activeScaleNotes.includes(note.name);

            return (
              <div 
                key={note.id} data-note={note.name}
                style={{ height: `${cellHeight}px` }}
                className={`flex-shrink-0 w-full flex items-center px-6 md:px-12 border-b border-zinc-900/40 tracking-wider transition-all duration-300 snap-item relative
                  ${note.type === 'white' ? 'bg-zinc-900 text-zinc-300' : 'bg-zinc-950 text-zinc-400'}`}
              >
                {/* Visual marker inside active scale note rows */}
                {isHighlighted && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500 shadow-[1px_0_6px_rgba(16,185,129,0.5)]"></div>
                )}

                {/* Styled text matching scale containment state */}
                <span className={`text-xs uppercase transition-all duration-200
                  ${note.type === 'white' ? 'font-semibold' : 'font-semibold italic'} 
                  ${isHighlighted 
                    ? 'text-emerald-400 scale-105 drop-shadow-[0_0_6px_rgba(16,185,129,0.4)]' 
                    : 'text-zinc-600'}`}
                >
                  {note.name}
                </span>
              </div>
            );
          })}
        </div>

        {/* 1/2 or 1/3 - Right scrollable column of interactive degree cards */}
        <div 
          ref={rightColRef}
          className="w-1/2 md:w-1/3 h-full overflow-y-auto no-scrollbar snap-container bg-zinc-950"
          style={{ paddingTop: '40vh', paddingBottom: '40vh' }}
        >
          {degrees.map((deg, idx) => {
            if (!deg) {
              return (
                <div 
                  key={`empty-${idx}`} 
                  style={{ height: `${cellHeight}px` }} 
                  className="flex-shrink-0 border-b border-zinc-900/20 opacity-20 flex items-center justify-center snap-item"
                >
                  <div className="w-6 h-[1px] bg-zinc-800"></div>
                </div>
              );
            }

            // Central octave anchor to align starting view precisely
            const isKeyRef = deg.isKey && idx === (mode === 'major' ? 47 : 47);

            return (
              <div 
                key={deg.id} 
                ref={isKeyRef ? keyRef : null}
                onMouseDown={() => startChord(deg, deg.id || '')}
                onMouseUp={() => stopChord(deg.id || '')}
                onMouseLeave={() => stopChord(deg.id || '')}
                onTouchStart={(e) => { e.preventDefault(); startChord(deg, deg.id || ''); }}
                onTouchEnd={(e) => { e.preventDefault(); stopChord(deg.id || ''); }}
                style={{ height: `${cellHeight}px` }}
                className="flex-shrink-0 w-full pl-1 py-[1.5px] border-b border-zinc-900/30 select-none snap-item cursor-pointer"
              >
                <div className={`w-full h-full flex flex-row items-center justify-between px-3 pl-4 transition-all duration-75 active:scale-[0.98] border rounded-l-md
                  ${deg.bgColor} shadow-md relative overflow-hidden arrow-left`}>
                  
                  <span className="text-xs font-extrabold tracking-tight uppercase z-10">{deg.num}</span>
                  
                  <div className="flex flex-col items-end justify-center z-10">
                    <span className="text-[8px] font-bold uppercase tracking-widest leading-none flex items-center gap-1">
                      {deg.chordType.slice(0, 3)}
                      {deg.isPenta && <span className="text-[12px] text-zinc-100 font-normal">●</span>}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {/* Editorial usage summary when Info is clicked */}
      {showInfo && (
        <div className="absolute inset-0 bg-zinc-950/95 z-50 flex items-center justify-center p-8 text-zinc-300" onClick={() => setShowInfo(false)}>
          <div className="max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl relative">
            <h3 className="text-lg font-bold mb-4 uppercase tracking-wider text-emerald-400 flex items-center gap-2">
              Sobre el Selector Virtual
            </h3>
            <ul className="text-sm font-light leading-relaxed space-y-3 mb-6 block list-disc pl-4">
              <li>
                <strong className="font-semibold text-zinc-100">Desplazamiento Infinito:</strong> Desliza verticalmente la rueda del teclado para buscar la tónica clave.
              </li>
              <li>
                <strong className="font-semibold text-zinc-100">Afinación Inteligente:</strong> Las notas contenidas en el modo actual se encenderán en verde brillante.
              </li>
              <li>
                <strong className="font-semibold text-zinc-100">Marcadores Pentatónicos (●):</strong> Los grados señalados con un punto pertenecen a la escala pentatónica de tu tonalidad seleccionada.
              </li>
              <li>
                <strong className="font-semibold text-zinc-100">Síntesis Integrada:</strong> Pulsa los grados a la derecha para disparar acordes polifónicos generados por osciladores nativos.
              </li>
            </ul>
            <button className="text-xs font-bold border-b border-zinc-100 pb-1 uppercase tracking-widest hover:text-emerald-400 transition-colors">
              Cerrar Guía
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
