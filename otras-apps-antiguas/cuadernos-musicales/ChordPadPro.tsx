import React, { useState, useEffect, useRef } from 'react';
import { Wand2, Volume2, Square, Info, Play, RefreshCw, AlertCircle } from 'lucide-react';
import { ActiveAppModule } from '../types';

interface KeyContext {
  root: string;
  type: 'Maj' | 'Min';
}

interface Progression {
  label: string;
  degrees: string[];
}

const CHROMATIC_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const CHROMATIC_MAP: { [key: string]: number } = {
  'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11
};

const NOTE_FREQS: { [key: string]: number } = {
  'C': 261.63, 'C#': 277.18, 'D': 293.66, 'D#': 311.13, 'E': 329.63, 'F': 349.23, 'F#': 369.99,
  'G': 392.00, 'G#': 415.30, 'A': 440.00, 'A#': 466.16, 'B': 493.88
};

const CHORD_STRUCTURES: { [key: string]: number[] } = {
  'Maj': [0, 4, 7],
  'Min': [0, 3, 7],
  '7':   [0, 4, 7, 10], // Dominant 7
  'm7':  [0, 3, 7, 10], // Minor 7
  'Dim': [0, 3, 6]      // Diminished
};

const SCALE_HIGHLIGHTS = {
  'Maj': [
    { interval: 0, type: 'Maj', label: 'I' },
    { interval: 2, type: 'Min', label: 'ii' },
    { interval: 4, type: 'Min', label: 'iii' },
    { interval: 5, type: 'Maj', label: 'IV' },
    { interval: 7, type: 'Maj', label: 'V' },
    { interval: 9, type: 'Min', label: 'vi' },
    { interval: 11, type: 'Dim', label: 'vii°' } 
  ],
  'Min': [
    { interval: 0, type: 'Min', label: 'i' },
    { interval: 2, type: 'Dim', label: 'ii°' }, 
    { interval: 3, type: 'Maj', label: 'III' },
    { interval: 5, type: 'Min', label: 'iv' },
    { interval: 7, type: 'Min', label: 'v' },
    { interval: 8, type: 'Maj', label: 'VI' },
    { interval: 10, type: 'Maj', label: 'VII'}
  ]
};

const SCALE_PATTERNS = {
  'Maj': [0, 2, 4, 5, 7, 9, 11],
  'Min': [0, 2, 3, 5, 7, 8, 10]
};

const progressionsMajorDefault: Progression[] = [
  { label: "I - V - vi - IV", degrees: ['I', 'V', 'vi', 'IV'] },
  { label: "vi - IV - I - V", degrees: ['vi', 'IV', 'I', 'V'] },
  { label: "I - IV - V",      degrees: ['I', 'IV', 'V'] },
  { label: "I - vi - IV - V", degrees: ['I', 'vi', 'IV', 'V'] },
  { label: "ii - V - I",      degrees: ['ii', 'V', 'I'] },
  { label: "I - V7 / ii - ii", degrees: ['I', 'V', 'ii', 'I'] } // Slot 6 (We will overwrite with AI generator!)
];

const progressionsMinorDefault: Progression[] = [
  { label: "i - VII - VI - V", degrees: ['i', 'VII', 'VI', 'V'] },
  { label: "i - VI - III - VII", degrees: ['i', 'VI', 'III', 'VII'] },
  { label: "i - iv - v",       degrees: ['i', 'iv', 'v'] },
  { label: "i - VII - VI - VII", degrees: ['i', 'VII', 'VI', 'VII'] },
  { label: "ii° - V - i",      degrees: ['ii°', 'V', 'i'] },
  { label: "i - iv - V7 - i",   degrees: ['i', 'iv', 'v', 'i'] } // Slot 6 (We will overwrite with AI generator!)
];

export default function ChordPadPro() {
  const [keyContext, setKeyContext] = useState<KeyContext>({ root: 'C', type: 'Maj' });
  const [activeChords, setActiveChords] = useState<{ [key: string]: boolean }>({});
  const [primaryDominantHint, setPrimaryDominantHint] = useState<string | null>(null);
  
  // AI Composer States
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Local state for overwritten/added progressions
  const [customMajorProgs, setCustomMajorProgs] = useState<Progression[]>(progressionsMajorDefault);
  const [customMinorProgs, setCustomMinorProgs] = useState<Progression[]>(progressionsMinorDefault);

  // Audio system refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const activeOscillatorsRef = useRef<{ [key: string]: any[] }>({});
  
  // Loop system refs
  const [loopActiveIndex, setLoopActiveIndex] = useState<number | null>(null);
  const [loopProgressIdx, setLoopProgressIdx] = useState<number | null>(null);
  const [currentProgLabel, setCurrentProgLabel] = useState<string | null>(null);
  const loopIntervalRef = useRef<number | null>(null);

  const initAudio = () => {
    if (!audioCtxRef.current) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;
      const ctx = new AudioCtxClass();
      const gain = ctx.createGain();
      gain.gain.value = 0.5;

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.ratio.value = 8;

      gain.connect(compressor);
      compressor.connect(ctx.destination);

      audioCtxRef.current = ctx;
      masterGainRef.current = gain;
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  };

  const getScaleChords = (rootNote: string, scaleType: 'Maj' | 'Min') => {
    const rootVal = CHROMATIC_MAP[rootNote];
    const pattern = SCALE_HIGHLIGHTS[scaleType];
    
    return pattern.map(degree => {
      const noteVal = (rootVal + degree.interval) % 12;
      return { noteName: CHROMATIC_NOTES[noteVal], type: degree.type, label: degree.label };
    });
  };

  const playChord = (root: string, type: string, padId: string, duration = 0) => {
    initAudio();
    if (!audioCtxRef.current || !masterGainRef.current) return;

    // Prevent duplicate triggers for sustained note playing
    if (duration === 0 && activeOscillatorsRef.current[padId]) return;

    // Secondary dominant note indicator: compute the fifth of the root to show dominant hints!
    if (duration === 0) {
      const rootIdx = CHROMATIC_MAP[root];
      const fifthIdx = (rootIdx + 7) % 12;
      const fifthNote = CHROMATIC_NOTES[fifthIdx];
      // Store secondary dominant suggestion
      setPrimaryDominantHint(fifthNote);
    }

    const baseFreq = NOTE_FREQS[root] || 261.63;
    const intervals = CHORD_STRUCTURES[type] || [0, 4, 7];
    const nodes: any[] = [];
    const now = audioCtxRef.current.currentTime;

    intervals.forEach(interval => {
      // Scale freq corresponding to intervals
      const noteFreq = baseFreq * Math.pow(2, interval / 12);
      const frequencies = [noteFreq, noteFreq / 2]; // Full double-voice harmonic stack

      frequencies.forEach(freq => {
        if (!audioCtxRef.current || !masterGainRef.current) return;
        const osc = audioCtxRef.current.createOscillator();
        const gainNode = audioCtxRef.current.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        
        osc.connect(gainNode);
        gainNode.connect(masterGainRef.current);
        osc.start();

        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.08, now + 0.04);

        if (duration > 0) {
          gainNode.gain.setValueAtTime(0.08, now + duration - 0.15);
          gainNode.gain.linearRampToValueAtTime(0.001, now + duration);
          osc.stop(now + duration + 0.1);
        } else {
          nodes.push({ osc, gainNode });
        }
      });
    });

    setActiveChords(prev => ({ ...prev, [padId]: true }));

    if (duration === 0) {
      activeOscillatorsRef.current[padId] = nodes;
    } else {
      setTimeout(() => {
        setActiveChords(prev => ({ ...prev, [padId]: false }));
      }, duration * 1000);
    }
  };

  const stopChord = (padId: string) => {
    setPrimaryDominantHint(null);
    const nodes = activeOscillatorsRef.current[padId];
    if (!nodes || !audioCtxRef.current) return;

    const now = audioCtxRef.current.currentTime;
    nodes.forEach(node => {
      try {
        node.gainNode.gain.cancelScheduledValues(now);
        node.gainNode.gain.setValueAtTime(node.gainNode.gain.value, now);
        node.gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        node.osc.stop(now + 0.2);
      } catch (e) {}
    });

    delete activeOscillatorsRef.current[padId];
    setActiveChords(prev => ({ ...prev, [padId]: false }));
  };

  const parseRomanNumeral = (degreeStr: string, keyRoot: string, keyType: 'Maj' | 'Min') => {
    const rootIndex = CHROMATIC_MAP[keyRoot];
    const scale = SCALE_PATTERNS[keyType];
    const romanToInt: { [key: string]: number } = { 
      'i': 0, 'ii': 1, 'iii': 2, 'iv': 3, 'v': 4, 'vi': 5, 'vii': 6, 
      'I': 0, 'II': 1, 'III': 2, 'IV': 3, 'V': 4, 'VI': 5, 'VII': 6 
    };
    
    // Check flat degrees (e.g. bVI)
    let isFlat = false;
    let cleanDegree = degreeStr.replace('°', '').replace('7', '');
    if (cleanDegree.startsWith('b')) {
      isFlat = true;
      cleanDegree = cleanDegree.substring(1);
    }

    const scaleIndex = romanToInt[cleanDegree];
    if (scaleIndex === undefined) return null;
    
    let interval = scale[scaleIndex];
    if (isFlat) interval -= 1; // Flatten interval

    const noteIndex = (rootIndex + interval) % 12;
    const noteName = CHROMATIC_NOTES[noteIndex];
    
    let type = 'Maj';
    if (degreeStr === degreeStr.toLowerCase()) type = 'Min';
    if (degreeStr.includes('°')) type = 'Dim';
    if (degreeStr.includes('7') && type === 'Maj') type = '7';
    if (cleanDegree === 'V' && degreeStr.includes('7')) type = '7';
    
    return { note: noteName, type: type };
  };

  const findPadButton = (note: string, type: string) => {
    // Searches through chords layout standard structures to identify match pad coordinate
    return `${note}-${type}`;
  };

  const playProgressionLoop = (prog: Progression, index: number) => {
    initAudio();
    if (loopActiveIndex === index) {
      stopProgressionLoop();
      return;
    }
    stopProgressionLoop();

    const chordsInProg = prog.degrees.map(deg => parseRomanNumeral(deg, keyContext.root, keyContext.type)).filter(Boolean);
    if (chordsInProg.length === 0) return;

    setLoopActiveIndex(index);
    setCurrentProgLabel(prog.label);
    
    let step = 0;
    const beatMs = 2000;

    const tick = () => {
      setLoopProgressIdx(step % chordsInProg.length);
      const chord = chordsInProg[step % chordsInProg.length];
      if (chord) {
        // Trigger chord sound synthetically for 1.8 seconds (2s cycle)
        playChord(chord.note, chord.type === '7' ? '7' : chord.type, `prog-step-${step}`, 1.8);
      }
      step++;
    };

    tick();
    const intervalId = window.setInterval(tick, beatMs);
    loopIntervalRef.current = intervalId;
  };

  const stopProgressionLoop = () => {
    if (loopIntervalRef.current) {
      clearInterval(loopIntervalRef.current);
      loopIntervalRef.current = null;
    }
    setLoopActiveIndex(null);
    setLoopProgressIdx(null);
    setCurrentProgLabel(null);
  };

  const triggerDegreeMidi = (degreeIndex: number, isStart: boolean) => {
    const scaleChords = getScaleChords(keyContext.root, keyContext.type);
    if (degreeIndex < scaleChords.length) {
      const match = scaleChords[degreeIndex];
      const padId = `midikey-${degreeIndex}`;
      if (isStart) {
        playChord(match.noteName, match.type, padId);
      } else {
        stopChord(padId);
      }
    }
  };

  // Connect Keyboard digits 1-7 to play active degrees inside context
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key >= '1' && e.key <= '7') {
        const val = parseInt(e.key) - 1;
        triggerDegreeMidi(val, true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key >= '1' && e.key <= '7') {
        const val = parseInt(e.key) - 1;
        triggerDegreeMidi(val, false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      stopProgressionLoop();
    };
  }, [keyContext]);

  // AI Generation call to Express server
  const generateAIProgression = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiGenerating(true);
    setErrorMessage('');

    try {
      const resp = await fetch('/api/ai/compose', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vibe: aiPrompt.trim(),
          key: keyContext.root,
          keyType: keyContext.type === 'Maj' ? 'Major' : 'Minor',
        }),
      });

      const data = await resp.json();
      if (resp.ok && data?.degrees) {
        const updatedProg: Progression = {
          label: `✨ ${data.label.substring(0, 15)}`,
          degrees: data.degrees,
        };

        if (keyContext.type === 'Maj') {
          const progs = [...customMajorProgs];
          progs[5] = updatedProg; // update the overwritten slot 6
          setCustomMajorProgs(progs);
        } else {
          const progs = [...customMinorProgs];
          progs[5] = updatedProg; // update the overwritten slot 6
          setCustomMinorProgs(progs);
        }
        setShowAIModal(false);
        setAiPrompt('');
      } else {
        setErrorMessage(data?.error || "Ocurrió un error inesperado al contactar a la Inteligencia Artificial.");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMessage("No se pudo conectar con el servidor para la generación armónica.");
    } finally {
      setIsAiGenerating(false);
    }
  };

  // Check scale highlighted notes
  const activeScaleChords = getScaleChords(keyContext.root, keyContext.type);

  const activeProgressions = keyContext.type === 'Maj' ? customMajorProgs : customMinorProgs;

  return (
    <div className="w-full space-y-8 animate-fade-in" id="pad-acordes">
      
      {/* Title Header with AI trigger */}
      <div className="bg-zinc-900 border border-zinc-800 p-6 md:p-8 rounded-sm flex flex-col md:flex-row justify-between items-center gap-6 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1.5 h-full bg-[#D4A373]"></div>
        <div className="flex items-center gap-4">
          <div className="p-3 bg-zinc-950 text-emerald-400 rounded-sm border border-zinc-800 shadow-inner">
            <Volume2 size={22} strokeWidth={1.5} />
          </div>
          <div>
            <h2 className="text-2xl font-serif italic text-zinc-100">Pad de Acordes Pro + IA</h2>
            <p className="text-zinc-550 text-xs mt-0.5">Controla armonías diatónicas. Toca teclas del 1 al 7 o compone con IA.</p>
          </div>
        </div>

        {/* AI + Scale controls selectors */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-zinc-950 p-1.5 rounded-sm border border-zinc-800 gap-1.5">
            <select
              value={keyContext.root}
              onChange={(e) => {
                setKeyContext(prev => ({ ...prev, root: e.target.value }));
                stopProgressionLoop();
              }}
              className="bg-transparent border-none text-zinc-100 font-bold py-1 px-3 outline-none cursor-pointer text-xs"
            >
              {CHROMATIC_NOTES.map(note => (
                <option key={note} value={note} className="bg-zinc-955 text-zinc-200">{note}</option>
              ))}
            </select>
            <div className="w-[1px] h-4 bg-zinc-800 self-center font-bold">|</div>
            <select
              value={keyContext.type}
              onChange={(e) => {
                setKeyContext(prev => ({ ...prev, type: e.target.value as 'Maj' | 'Min' }));
                stopProgressionLoop();
              }}
              className="bg-transparent border-none text-zinc-100 font-bold py-1 px-3 outline-none cursor-pointer text-xs"
            >
              <option value="Maj" className="bg-zinc-955 text-zinc-200">Mayor</option>
              <option value="Min" className="bg-zinc-955 text-zinc-200">Menor</option>
            </select>
          </div>

          <button
            onClick={() => setShowAIModal(true)}
            className="flex items-center gap-2 bg-[#1C1C1C] hover:bg-[#2c2927] text-white border border-zinc-500 font-sans font-bold py-2 px-4 rounded-sm shadow-sm hover:shadow-[#D4A373]/10 cursor-pointer text-xs uppercase tracking-wider transition-all"
          >
            <Wand2 size={13} /> AI Composer ✨
          </button>
          
          {loopActiveIndex !== null && (
            <button
              onClick={stopProgressionLoop}
              className="flex items-center gap-1.5 bg-rose-950 border border-rose-900 text-rose-300 py-2 px-4 rounded-sm font-sans font-bold text-xs transition cursor-pointer uppercase tracking-wider"
            >
              <Square size={10} fill="currentColor" /> Detener Loop
            </button>
          )}
        </div>
      </div>

      {/* Grid containing the pad loops and details */}
      <section className="space-y-4">
        <h3 className="text-zinc-400 text-xs font-bold uppercase tracking-widest px-1">Teclado de Grados (Disparadores rápidos con teclas 1-7)</h3>
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, idx) => {
            const padId = `midikey-${idx}`;
            const isPressed = activeChords[padId];
            const matchingScaleChord = activeScaleChords[idx];
            return (
              <button
                key={idx}
                onMouseDown={() => triggerDegreeMidi(idx, true)}
                onMouseUp={() => triggerDegreeMidi(idx, false)}
                onMouseLeave={() => triggerDegreeMidi(idx, false)}
                onTouchStart={(e) => { e.preventDefault(); triggerDegreeMidi(idx, true); }}
                onTouchEnd={(e) => { e.preventDefault(); triggerDegreeMidi(idx, false); }}
                className={`flex flex-col items-center justify-center p-4 rounded-xl border transition-all cursor-pointer text-center relative overflow-hidden
                  ${isPressed
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 scale-[1.03] shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
              >
                <span className="text-[10px] font-bold text-zinc-500 tracking-wider">Teclado {idx + 1}</span>
                <span className={`text-xl font-extrabold mt-1 ${isPressed ? 'text-emerald-400' : 'text-zinc-350'}`}>
                  {matchingScaleChord?.label || '?'}
                </span>
                <span className="text-[9px] font-mono font-medium text-zinc-650 opacity-80 mt-1">
                  {matchingScaleChord?.noteName || ''}{matchingScaleChord?.type === 'Min' ? 'm' : matchingScaleChord?.type === 'Dim' ? 'dim' : ''}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Grid displaying complete Standard Chord rows (Majors, Minors, etc) */}
      <section className="space-y-4">
        <h3 className="text-zinc-400 text-xs font-bold uppercase tracking-widest px-1">Pads Cromáticos Estructurales</h3>
        
        {/* White natural chords rows */}
        <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-2">
          {CHROMATIC_NOTES.map((note) => {
            // Check matching scale positions to highlight borders
            const noteVal = CHROMATIC_MAP[note];
            const isMinor = activeScaleChords.find(sc => sc.noteName === note && sc.type === 'Min');
            const isMajor = activeScaleChords.find(sc => sc.noteName === note && sc.type === 'Maj');
            
            const chordType = isMinor ? 'Min' : 'Maj';
            const padId = findPadButton(note, chordType);
            const isPressed = activeChords[padId];
            
            const displayLabel = chordType === 'Min' ? 'm' : '';

            // Dominant trigger suggestion feedback
            const isSecondaryDominantHint = primaryDominantHint === note;

            return (
              <button
                key={note}
                onMouseDown={() => playChord(note, chordType, padId)}
                onMouseUp={() => stopChord(padId)}
                onMouseLeave={() => stopChord(padId)}
                onTouchStart={(e) => { e.preventDefault(); playChord(note, chordType, padId); }}
                onTouchEnd={(e) => { e.preventDefault(); stopChord(padId); }}
                className={`p-3.5 rounded-xl border flex flex-col items-center justify-center transition-all cursor-pointer select-none
                  ${isPressed 
                    ? 'bg-emerald-500 text-zinc-950 border-emerald-400 font-extrabold scale-102 shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                    : isSecondaryDominantHint 
                    ? 'bg-amber-950/20 border-amber-500 text-amber-300 ring-1 ring-amber-500/30'
                    : isMajor || isMinor
                    ? 'bg-zinc-900 border-zinc-750 text-zinc-200 hover:border-zinc-700 shadow-md'
                    : 'bg-zinc-950/70 border-zinc-900 text-zinc-650 hover:border-zinc-800'
                  }`}
              >
                <span className="text-sm font-black font-sans tracking-tight">{note}{displayLabel}</span>
                {isSecondaryDominantHint && (
                  <span className="text-[7px] bg-amber-950 text-amber-400 font-extrabold rounded-full px-1.5 py-0.2 mt-1 absolute top-1 right-1">
                    V7?
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Progression lists play-along box */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-zinc-950 border border-zinc-900 rounded-sm p-6 shadow-inner">
        <div>
          <h4 className="text-sm font-serif italic text-zinc-300 mb-3 select-none flex items-center gap-2">
            <span className="w-1.5 h-4 bg-[#D4A373] inline-block"></span> Loop de Progresiones Armónicas
          </h4>
          <p className="text-zinc-500 text-xs leading-relaxed max-w-sm">
            Dispara bases rítmicas de 4 compases automáticas sobre el modo seleccionado. Las progresiones con estrellas (✨) son entrenadas o compuestas por la IA de Gemini.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {activeProgressions.map((prog, index) => {
            const isCurrentProg = loopActiveIndex === index;
            return (
              <button
                key={index}
                onClick={() => playProgressionLoop(prog, index)}
                className={`p-3.5 border rounded-sm flex flex-col items-center justify-center gap-1.5 transition select-none tracking-tight text-center cursor-pointer relative overflow-hidden
                  ${isCurrentProg 
                    ? 'bg-[#D4A373]/10 border-[#D4A373] text-[#D4A373] shadow-inner'
                    : 'bg-zinc-900 border-zinc-850 hover:border-zinc-700 text-zinc-400 hover:text-zinc-100'
                  }`}
              >
                <span className="text-xs font-bold leading-none select-none text-zinc-100">{prog.label}</span>
                <span className="text-[9px] font-mono uppercase text-zinc-500 select-none tracking-wider mt-0.5">
                  {prog.degrees.join(' - ')}
                </span>
                
                {isCurrentProg && (
                  <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#D4A373] animate-pulse"></div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* AI Prompt Composition modal */}
      {showAIModal && (
        <div className="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowAIModal(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-sm w-full max-w-md p-6 shadow-2xl relative" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-serif italic text-zinc-100 flex items-center gap-2">
              <Wand2 size={16} className="text-[#D4A373]" />
              AI Composer de Progresiones
            </h3>
            <p className="text-zinc-500 text-xs mt-2 leading-relaxed">
              Describe el estilo, género, sentimiento o "vibe" que buscas (ej. "80s Synthwave melancólico", "Epic Movie Quest", "Balada Triste") y de manera inteligente Gemini entrenará el sexto slot de la botonera.
            </p>

            {errorMessage && (
              <div className="mt-4 bg-rose-950 border border-rose-900 text-rose-300 p-3 rounded-sm flex gap-2 text-xs">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="mt-4">
              <input
                type="text"
                placeholder="Ingresa un estilo o sentimiento..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') generateAIProgression();
                }}
                disabled={isAiGenerating}
                className="w-full bg-zinc-950 border border-zinc-850 focus:border-[#D4A373] rounded-sm p-3 text-sm text-zinc-100 placeholder-zinc-550 outline-none transition"
              />
            </div>

            <div className="mt-5 flex justify-end gap-3 text-xs">
              <button
                type="button"
                onClick={() => setShowAIModal(false)}
                disabled={isAiGenerating}
                className="px-4 py-2 text-zinc-300 hover:text-zinc-100 font-semibold rounded-sm bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={generateAIProgression}
                disabled={isAiGenerating || !aiPrompt.trim()}
                className="px-4 py-2 bg-[#1C1C1C] hover:bg-[#2c2927] text-white border border-zinc-500 font-bold rounded-sm shadow-sm flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAiGenerating ? (
                  <>
                    <RefreshCw size={12} className="animate-spin" />
                    Componiendo...
                  </>
                ) : (
                  <>
                    <Wand2 size={12} />
                    Componer ✨
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
