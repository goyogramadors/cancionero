import React, { useState, useMemo } from 'react';
import { LayoutGrid, Info, ArrowRight, Play, CheckCircle } from 'lucide-react';
import { DiatonicChord } from '../types';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const SCALES = {
  mayor: {
    name: 'Mayor Natural',
    intervals: [0, 2, 4, 5, 7, 9, 11],
    chordTypes: ['Maj', 'min', 'min', 'Maj', 'Maj', 'min', 'dim'],
    degrees: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']
  },
  menor: {
    name: 'Menor Natural',
    intervals: [0, 2, 3, 5, 7, 8, 10],
    chordTypes: ['min', 'dim', 'Maj', 'min', 'min', 'Maj', 'Maj'],
    degrees: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']
  }
};

const getNoteFromIndex = (index: number) => NOTES[index % 12];

const getScaleNotes = (rootIndex: number, scaleType: 'mayor' | 'menor') => {
  const scale = SCALES[scaleType];
  return scale.intervals.map(interval => (rootIndex + interval) % 12);
};

const getDiatonicChords = (rootIndex: number, scaleType: 'mayor' | 'menor'): DiatonicChord[] => {
  const scale = SCALES[scaleType];
  const scaleNotes = getScaleNotes(rootIndex, scaleType);
  
  return scaleNotes.map((noteIndex, i) => {
    const rootName = getNoteFromIndex(noteIndex);
    const type = scale.chordTypes[i];
    const degree = scale.degrees[i];
    
    let chordName = rootName;
    if (type === 'min') chordName += 'm';
    if (type === 'dim') chordName += 'dim';

    const thirdNoteIndex = scaleNotes[(i + 2) % 7];
    const fifthNoteIndex = scaleNotes[(i + 4) % 7];

    return {
      degree,
      name: chordName,
      type,
      notes: [noteIndex, thirdNoteIndex, fifthNoteIndex],
      rootIndex: noteIndex,
      isRoot: i === 0
    };
  });
};

export default function CampoTonal() {
  const [rootNote, setRootNote] = useState('C');
  const [scaleType, setScaleType] = useState<'mayor' | 'menor'>('mayor');
  const [selectedChordIndex, setSelectedChordIndex] = useState<number | null>(null);

  const rootIndex = NOTES.indexOf(rootNote);
  const diatonicChords = useMemo(() => getDiatonicChords(rootIndex, scaleType), [rootIndex, scaleType]);

  // Audio Context trigger for chord preview
  const playChordSound = (chord: DiatonicChord) => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const audioCtx = new AudioContextClass();
      
      const now = audioCtx.currentTime;
      const notes = chord.notes;
      const noteFreqs = [130.81, 138.59, 146.83, 155.56, 164.81, 174.61, 185.00, 196.00, 207.65, 220.00, 233.08, 246.94];
      
      notes.forEach((noteIdx, idx) => {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        // Base frequency corresponding to index
        let freq = noteFreqs[noteIdx % 12];
        // Shift octave higher for third and fifth for wider voicing
        if (idx === 1) freq *= 2; // 3rd octave up
        if (idx === 2) freq *= 2; // 5th octave up
        
        osc.frequency.setValueAtTime(freq, now);
        osc.type = 'triangle';
        
        // Soft volume envelope
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.12, now + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 1.3);
      });
    } catch (e) {
      console.warn("Audio Context blocked or unsupported:", e);
    }
  };

  const handleChordClick = (index: number) => {
    setSelectedChordIndex(index);
    playChordSound(diatonicChords[index]);
  };

  const currentScaleNotes = useMemo(() => {
    const scaleNotesIndices = getScaleNotes(rootIndex, scaleType);
    return scaleNotesIndices.map(idx => getNoteFromIndex(idx));
  }, [rootIndex, scaleType]);

  return (
    <div className="w-full space-y-8 animate-fade-in" id="campo-tonal">
      {/* Header & Controls Section */}
      <div className="bg-zinc-900 border border-zinc-800 p-6 md:p-8 rounded-sm flex flex-col md:flex-row justify-between items-center gap-6 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1.5 h-full bg-[#D4A373]"></div>
        <div className="flex items-center gap-4">
          <div className="p-3 bg-zinc-950 text-emerald-400 rounded-sm border border-zinc-800 shadow-inner">
            <LayoutGrid size={22} strokeWidth={1.5} />
          </div>
          <div>
            <h2 className="text-2xl font-serif italic text-zinc-100">Campo Tonal: {rootNote} {scaleType === 'mayor' ? 'Mayor' : 'Menor'}</h2>
            <p className="text-zinc-550 text-xs mt-0.5 tracking-wide">Progresión armónica diatónica basada en la escala seleccionada.</p>
          </div>
        </div>

        {/* Input Selectors */}
        <div className="flex flex-wrap items-center gap-4 bg-zinc-950 p-2 border border-zinc-800 rounded-sm">
          <div className="flex flex-col">
            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest px-1 mb-1">Tonalidad</span>
            <select 
              value={rootNote}
              onChange={(e) => {
                setRootNote(e.target.value);
                setSelectedChordIndex(null);
              }}
              className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-100 font-bold py-1.5 px-3 rounded-lg outline-none cursor-pointer focus:border-emerald-500 transition-all text-sm"
            >
              {NOTES.map(note => (
                <option key={note} value={note}>{note}</option>
              ))}
            </select>
          </div>

          <div className="h-8 w-[1px] bg-zinc-800"></div>

          <div className="flex flex-col">
            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest px-1 mb-1">Escala / Modo</span>
            <div className="flex bg-zinc-900 p-1 rounded-lg border border-zinc-800">
              <button
                onClick={() => {
                  setScaleType('mayor');
                  setSelectedChordIndex(null);
                }}
                className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                  scaleType === 'mayor' 
                    ? 'bg-emerald-500 text-zinc-950 shadow-md' 
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Mayor
              </button>
              <button
                onClick={() => {
                  setScaleType('menor');
                  setSelectedChordIndex(null);
                }}
                className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                  scaleType === 'menor' 
                    ? 'bg-emerald-500 text-zinc-950 shadow-md' 
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Menor
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Grid displays Chords (La Botonera) */}
      <section className="space-y-4">
        <div className="flex justify-between items-center px-1">
          <h3 className="text-lg font-serif italic text-zinc-100 flex items-center gap-2">
            <span className="w-1.5 h-6 bg-[#D4A373] inline-block"></span>
            Armonización con Tríadas
          </h3>
          {selectedChordIndex !== null && (
            <button 
              onClick={() => setSelectedChordIndex(null)}
              className="text-xs transition px-3 py-1.5 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-500 shadow-sm font-semibold uppercase tracking-wider"
            >
              Limpiar selección
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {diatonicChords.map((chord, idx) => {
            const isSelected = selectedChordIndex === idx;

            return (
              <button 
                key={idx}
                onClick={() => handleChordClick(idx)}
                className={`
                  relative group p-5 rounded-sm border transition-all duration-300 transform flex flex-col items-center justify-center gap-3 w-full cursor-pointer
                  ${isSelected 
                    ? 'bg-zinc-950 border-[#D4A373] scale-[1.03] shadow-[0_0_20px_rgba(212,163,115,0.15)]' 
                    : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-500 hover:text-zinc-100 shadow-sm'
                  }
                `}
              >
                {/* Degree Badge */}
                <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-sm ${
                  isSelected ? 'bg-[#D4A373]/20 text-[#D4A373]' : 'bg-zinc-950 text-zinc-500 border border-zinc-800'
                }`}>
                  Grado {chord.degree}
                </span>

                {/* Chord Name */}
                <span className={`text-3xl font-serif font-semibold mt-1 ${isSelected ? 'text-[#D4A373]' : 'text-zinc-100 group-hover:text-zinc-50'}`}>
                  {chord.name}
                </span>

                {/* Notes List */}
                <span className={`text-[10px] font-mono tracking-wider ${isSelected ? 'text-zinc-200 font-bold' : 'text-zinc-550'}`}>
                  {chord.notes.map(n => getNoteFromIndex(n)).join(' • ')}
                </span>
                
                {/* Visual marker */}
                {isSelected && (
                  <span className="absolute top-2.5 right-2 text-[#D4A373] animate-pulse">
                    <Play size={10} fill="currentColor" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Detail panel when Chord is selected */}
      <section className="transition-all duration-300">
        {selectedChordIndex !== null ? (
          <div className="bg-zinc-900 border border-zinc-800 p-6 shadow-md rounded-sm relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex flex-col text-center md:text-left">
              <span className="text-zinc-500 text-[10px] font-semibold tracking-widest uppercase">Detalles del Acorde</span>
              <h4 className="text-4xl font-serif font-medium text-zinc-100 mt-1 flex items-center justify-center md:justify-start gap-3">
                {diatonicChords[selectedChordIndex].name}
                <span className="text-xs font-bold text-[#D4A373] bg-[#D4A373]/10 border border-[#D4A373]/30 px-2 py-1 rounded-sm self-center uppercase tracking-widest">
                  Grado {diatonicChords[selectedChordIndex].degree}
                </span>
              </h4>
              <p className="text-sm text-zinc-500 mt-2 max-w-[500px]">
                Tríada formada por la <span className="text-zinc-100 font-medium">Tónica, Tercera</span> y <span className="text-zinc-100 font-semibold">Quinta</span> notas correspondientes, calculadas con precisión para este campo diatónico.
              </p>
            </div>

            {/* Note Circles with dynamic labeling */}
            <div className="flex gap-4 items-center self-center bg-zinc-950 p-4 border border-zinc-800 rounded-sm">
              {diatonicChords[selectedChordIndex].notes.map((n, i) => (
                <div key={i} className="flex flex-col items-center">
                  <div className="w-12 h-12 rounded-full bg-zinc-900 hover:bg-zinc-800 text-zinc-100 font-serif font-semibold border-2 border-zinc-800 flex items-center justify-center text-lg shadow-sm transition-colors">
                    {getNoteFromIndex(n)}
                  </div>
                  <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-1.5">
                    {i === 0 ? 'Tónica' : i === 1 ? '3ra' : '5ta'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="border border-dashed border-zinc-800 bg-zinc-950/20 rounded-sm flex flex-col items-center justify-center p-8 text-center text-zinc-500">
            <Info size={18} className="text-[#D4A373] mb-2" />
            <p className="text-xs tracking-wide">Selecciona un acorde de la botonera superior para inspeccionar su estructura y sus grados.</p>
          </div>
        )}
      </section>

      {/* Guide section (Helpful music theory info) */}
      <section className="bg-zinc-950 border border-zinc-800 rounded-sm p-6 shadow-inner">
        <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">Notas de la escala actual</h4>
        <div className="flex flex-wrap gap-2">
          {currentScaleNotes.map((note, idx) => (
            <div key={idx} className="flex items-center text-sm font-mono text-zinc-300 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-sm shadow-sm">
              <span className="font-bold text-[#D4A373] mr-1.5">{idx + 1}.</span> {note}
              {idx < currentScaleNotes.length - 1 && <ArrowRight size={10} className="ml-2 text-zinc-500" />}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
