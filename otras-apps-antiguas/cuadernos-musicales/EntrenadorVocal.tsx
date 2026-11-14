import React, { useState, useEffect, useRef } from 'react';
import { Mic, Volume2, RotateCcw, CheckCircle2, AlertCircle } from 'lucide-react';
import { PitchData } from '../types';

// Solfege note names
const SOLFEGE = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];

const CENTRAL_MIN_MIDI = 48; // Do3
const CENTRAL_MAX_MIDI = 72; // Do5

function noteFromPitch(frequency: number): number {
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
  return Math.round(noteNum) + 69;
}

function frequencyFromNoteNumber(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function centsOffFromPitch(frequency: number, note: number): number {
  return Math.floor(1200 * Math.log(frequency / frequencyFromNoteNumber(note)) / Math.log(2));
}

function getNoteName(midiNote: number): string {
  const octave = Math.floor(midiNote / 12) - 1;
  const name = SOLFEGE[midiNote % 12];
  return `${name}${octave}`;
}

// Autocorrelation algorithm to calculate pitch frequency from buffer
function autoCorrelate(buf: Float32Array, sampleRate: number): number {
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) {
    const val = buf[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);
  
  // Ignore low volume room background noise
  if (rms < 0.035) return -1; 

  let r1 = 0;
  let r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
  }

  const slicedBuf = buf.slice(r1, r2);
  const slicedSize = slicedBuf.length;

  const c = new Array(slicedSize).fill(0);
  for (let i = 0; i < slicedSize; i++) {
    for (let j = 0; j < slicedSize - i; j++) {
      c[i] = c[i] + slicedBuf[j] * slicedBuf[j + i];
    }
  }

  let d = 0; 
  while (c[d] > c[d + 1]) d++;
  let maxval = -1;
  let maxpos = -1;
  for (let i = d; i < slicedSize; i++) {
    if (c[i] > maxval) {
      maxval = c[i];
      maxpos = i;
    }
  }
  let T0 = maxpos;
  const x1 = c[T0 - 1];
  const x2 = c[T0];
  const x3 = c[T0 + 1];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  if (a) T0 = T0 - b / (2 * a);

  return sampleRate / T0;
}

export default function EntrenadorVocal() {
  const [isListening, setIsListening] = useState(false);
  const [sequence, setSequence] = useState<{ midi: number; name: string }[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [holdProgress, setHoldProgress] = useState(0);
  const [pitchData, setPitchData] = useState<PitchData>({ midi: -1, cents: 0, noteName: "Ninguna" });
  const [errorMessage, setErrorMessage] = useState("");
  const [isCompleted, setIsCompleted] = useState(false);
  const [isPlayingReference, setIsPlayingReference] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const currentPitchRef = useRef({ noteMidi: -1, cents: 0 });
  const referenceOscillatorRef = useRef<OscillatorNode | null>(null);

  const generateSequence = () => {
    const newSeq = [];
    for (let i = 0; i < 5; i++) {
      const noteNum = Math.floor(Math.random() * (CENTRAL_MAX_MIDI - CENTRAL_MIN_MIDI + 1)) + CENTRAL_MIN_MIDI;
      newSeq.push({
        midi: noteNum,
        name: getNoteName(noteNum),
      });
    }
    setSequence(newSeq);
    setCurrentIndex(0);
    setHoldProgress(0);
    setIsCompleted(false);
    setErrorMessage("");
  };

  useEffect(() => {
    generateSequence();
    return () => {
      stopAudio();
      stopReferenceNote();
    };
  }, []);

  const initAudioContext = (): AudioContext => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  };

  const playReferenceNote = () => {
    if (sequence.length === 0 || currentIndex >= 5) return;
    
    const audioCtx = initAudioContext();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    stopReferenceNote();

    const targetNote = sequence[currentIndex];
    const frequency = frequencyFromNoteNumber(targetNote.midi);

    const oscillator = audioCtx.createOscillator();
    oscillator.type = 'triangle'; 
    oscillator.frequency.value = frequency;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency * 2.5; 

    const gainNode = audioCtx.createGain();

    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.25, audioCtx.currentTime + 0.15); // fade-in
    
    oscillator.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();
    
    // fade-out
    gainNode.gain.setValueAtTime(0.25, audioCtx.currentTime + 1.1);
    gainNode.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 1.4);
    
    oscillator.stop(audioCtx.currentTime + 1.5);

    referenceOscillatorRef.current = oscillator;
    setIsPlayingReference(true);

    setTimeout(() => {
      setIsPlayingReference(false);
    }, 1500);
  };

  const stopReferenceNote = () => {
    if (referenceOscillatorRef.current) {
      try {
        referenceOscillatorRef.current.stop();
      } catch (e) {}
      referenceOscillatorRef.current = null;
      setIsPlayingReference(false);
    }
  };

  const stopAudio = () => {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    setIsListening(false);
    setPitchData({ midi: -1, cents: 0, noteName: "Ninguna" });
  };

  const startListening = async () => {
    if (isCompleted || sequence.length === 0) {
      generateSequence();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      streamRef.current = stream;
      
      const audioCtx = initAudioContext();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      
      const highpassFilter = audioCtx.createBiquadFilter();
      highpassFilter.type = 'highpass';
      highpassFilter.frequency.value = 80; // filter vocal subsonic hums

      const lowpassFilter = audioCtx.createBiquadFilter();
      lowpassFilter.type = 'lowpass';
      lowpassFilter.frequency.value = 1600; // filter high background sibilance/hisses

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;
      
      const source = audioCtx.createMediaStreamSource(stream);
      
      source.connect(highpassFilter);
      highpassFilter.connect(lowpassFilter);
      lowpassFilter.connect(analyser);
      
      setIsListening(true);
      updatePitch();
    } catch (err) {
      setErrorMessage("⚠️ No se pudo acceder al micrófono para el entrenador vocal. Verifica los permisos de tu navegador.");
    }
  };

  const updatePitch = () => {
    if (!analyserRef.current || !audioContextRef.current) return;

    const buffer = new Float32Array(analyserRef.current.fftSize);
    analyserRef.current.getFloatTimeDomainData(buffer);
    
    const ac = autoCorrelate(buffer, audioContextRef.current.sampleRate);
    
    if (ac > -1) {
      const midi = noteFromPitch(ac);
      const cents = centsOffFromPitch(ac, midi);
      const noteName = getNoteName(midi);
      
      currentPitchRef.current = { noteMidi: midi, cents: cents };
      setPitchData({ midi, cents, noteName });
    } else {
      currentPitchRef.current = { noteMidi: -1, cents: 0 };
      setPitchData({ midi: -1, cents: 0, noteName: "Ninguna" });
    }

    rafIdRef.current = requestAnimationFrame(updatePitch);
  };

  // Progression checking loop
  useEffect(() => {
    if (!isListening || sequence.length === 0 || currentIndex >= 5 || isCompleted) return;

    const targetNote = sequence[currentIndex];

    const progressInterval = setInterval(() => {
      const current = currentPitchRef.current;
      
      const isTargetNote = current.noteMidi === targetNote.midi;
      const isInTune = Math.abs(current.cents) < 35; // tuning tolerance in cents

      if (isTargetNote && isInTune) {
        setHoldProgress(prev => {
          const step = (50 / 3000) * 100; // 3 seconds total to hold note
          const next = prev + step;
          
          if (next >= 100) {
            setTimeout(() => {
              if (currentIndex + 1 >= 5) {
                setIsCompleted(true);
                stopAudio();
              } else {
                setCurrentIndex(curr => curr + 1);
                setHoldProgress(0);
              }
            }, 10);
            return 100; 
          }
          return next;
        });
      } else {
        setHoldProgress(prev => Math.max(0, prev - 2.5)); // drop progress slower when slipping
      }
    }, 50);

    return () => clearInterval(progressInterval);
  }, [isListening, sequence, currentIndex, isCompleted]);

  // Vertical tuner alignments
  let tunerPosition = 50; 
  let tunerColor = 'bg-zinc-600';
  
  if (pitchData.midi !== -1) {
    tunerPosition = 50 + pitchData.cents; 
    tunerPosition = Math.max(0, Math.min(100, tunerPosition));
    
    if (Math.abs(pitchData.cents) < 35) {
      tunerColor = 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.7)]';
    } else {
      tunerColor = 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.7)]';
    }
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8 animate-fade-in" id="entrenador-vocal">
      {/* Title Header area */}
      <div className="bg-zinc-900 border border-zinc-800 p-6 md:p-8 rounded-sm flex flex-col md:flex-row justify-between items-center gap-6 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1.5 h-full bg-[#D4A373]"></div>
        <div className="flex items-center gap-4">
          <div className="p-3 bg-zinc-950 text-emerald-400 rounded-sm border border-zinc-800 shadow-inner">
            <Mic size={22} strokeWidth={1.5} />
          </div>
          <div>
            <h2 className="text-2xl font-serif italic text-zinc-100">Entrenador Vocal</h2>
            <p className="text-zinc-550 text-xs mt-0.5">Entona secuencias musicales con tu voz en dos octavas (Do3 a Do5).</p>
          </div>
        </div>

        {/* Buttons Controls */}
        <div className="flex gap-3">
          {!isListening && !isCompleted ? (
            <button 
              onClick={startListening}
              className="bg-[#1C1C1C] hover:bg-[#2c2927] text-white border border-zinc-500 font-sans font-bold py-2 px-5 rounded-sm shadow-sm transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2 cursor-pointer text-sm uppercase tracking-wider"
            >
              <Mic size={15} /> Comprobar Voz
            </button>
          ) : (
            <button 
              onClick={() => {
                stopAudio();
                generateSequence();
              }}
              className="bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 font-semibold py-2 px-5 rounded-sm transition-all flex items-center gap-2 cursor-pointer text-sm uppercase tracking-wider"
            >
              <RotateCcw size={14} /> Detener / Reiniciar
            </button>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="bg-rose-950 border border-rose-900 text-rose-300 p-4 rounded-sm flex items-center gap-3 animate-pulse">
          <AlertCircle size={18} className="shrink-0" />
          <p className="text-xs font-sans">{errorMessage}</p>
        </div>
      )}

      {/* Main interactive tuner canvas */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-sm p-6 md:p-8 shadow-sm flex flex-col items-center">
        {isCompleted && (
          <div className="text-center mb-6 max-w-md bg-emerald-950 border border-emerald-900 p-5 rounded-sm animate-fade-in shadow-inner">
            <CheckCircle2 size={32} className="text-[#D4A373] mx-auto mb-2" />
            <h3 className="text-lg font-serif italic text-zinc-100">¡Felicidades!</h3>
            <p className="text-xs text-zinc-500 mt-1">Has cantado la secuencia de 5 notas completa con excelente afinación.</p>
          </div>
        )}

        <div className="w-full flex flex-col items-center">
          
          {/* Sound reference helper */}
          {!isCompleted && sequence.length > 0 && (
            <button
              onClick={playReferenceNote}
              disabled={isPlayingReference || !isListening}
              className={`mb-6 flex items-center gap-2 px-4 py-2 border rounded-sm font-sans text-xs font-bold tracking-wide transition-all uppercase
                ${isPlayingReference 
                  ? 'bg-amber-950 border-amber-900 text-amber-300 animate-pulse' 
                  : 'bg-zinc-950 hover:bg-zinc-900 border-zinc-800 text-emerald-400 hover:text-emerald-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-inner'
                }`}
            >
              <Volume2 size={14} />
              {isPlayingReference ? "Escuchando..." : "Reproducir Nota Guía"}
            </button>
          )}

          <h3 className="text-[10px] font-bold text-zinc-550 uppercase tracking-widest mb-4">Secuencia actual:</h3>
          
          {/* Note sequence boxes */}
          <div className="flex flex-wrap justify-center gap-3 md:gap-4 w-full">
            {sequence.map((nota, idx) => {
              let boxStyles = "w-16 h-16 md:w-20 md:h-20 flex flex-col items-center justify-center rounded-sm text-base md:text-lg font-bold border shadow-inner transition-all duration-300 ";
              
              if (idx < currentIndex) {
                // Completed note (green/theme)
                boxStyles += "bg-emerald-950 border-emerald-500 text-[#D4A373] shadow-[0_0_15px_rgba(212,163,115,0.1)]";
              } else if (idx === currentIndex && !isCompleted) {
                // Active note (glowing gold)
                boxStyles += "bg-zinc-950 border-[#D4A373] text-[#D4A373] ring-1 ring-[#D4A373]/30 scale-105";
              } else {
                // Future notes
                boxStyles += "bg-zinc-950/40 border-zinc-805 text-zinc-500";
              }

              return (
                <div key={idx} className={boxStyles}>
                  <span className="text-xs font-medium uppercase text-zinc-500 select-none tracking-widest">{idx + 1}</span>
                  <span className="text-lg md:text-xl font-extrabold mt-0.5">{nota.name}</span>
                </div>
              );
            })}
          </div>

          {/* Progress bar inside matching note holder */}
          {!isCompleted && isListening && (
            <div className="w-full bg-zinc-950 border border-zinc-850 rounded-xl h-6 mt-8 overflow-hidden relative shadow-inner">
              <span className="absolute inset-0 flex items-center justify-center text-[9px] text-zinc-400 font-extrabold uppercase tracking-widest z-10 select-none">
                Mantén entonada la nota coloreada por 3 segundos
              </span>
              <div 
                className="bg-emerald-500/30 border-r border-emerald-500 h-full transition-all duration-100 ease-linear shadow-[0_0_12px_rgba(16,185,129,0.2)]" 
                style={{ width: `${holdProgress}%` }}
              ></div>
            </div>
          )}
        </div>

        <div className="w-full border-t border-zinc-800 my-6"></div>

        {/* Core tuner gauge */}
        <div className="w-full flex flex-col md:flex-row justify-center items-center gap-8 md:gap-16">
          
          {/* Detected note block */}
          <div className="flex flex-col items-center">
            <h4 className="text-[10px] uppercase tracking-widest text-zinc-500 font-extrabold mb-2.5">Tono Recibido</h4>
            <div className="text-3xl font-extrabold text-zinc-100 w-28 h-28 flex items-center justify-center bg-zinc-950 border border-zinc-850 rounded-2xl shadow-inner select-none">
              {pitchData.noteName === "Ninguna" ? "---" : pitchData.noteName}
            </div>
          </div>

          {/* Vertical tuner index panel */}
          <div className="flex gap-4 items-center h-32 select-none"> 
            <div className="flex flex-col justify-between h-full text-[10px] font-bold text-zinc-500 py-1 text-right tracking-wider uppercase">
              <span className="text-rose-450">Agudo</span>
              <span className="text-emerald-400">Afinado</span>
              <span className="text-zinc-650">Grave</span>
            </div>

            {/* Vertical slider scale */}
            <div className="w-6 h-full bg-zinc-950 border border-zinc-850 rounded-full relative shadow-inner overflow-hidden flex flex-col items-center">
              {/* Tuned central visual gate */}
              <div className="absolute top-1/2 left-0 right-0 h-1/5 -translate-y-1/2 bg-emerald-500/10 opacity-60"></div>
              
              {/* Base line marker */}
              <div className="absolute top-1/2 left-0 right-0 h-[1.5px] bg-zinc-700 -translate-y-1/2"></div>
              
              {/* Animated active tuner index */}
              <div 
                className={`absolute h-2.5 w-8 -left-1 rounded shadow transition-all duration-75 ease-out ${tunerColor}`}
                style={{ 
                  bottom: `calc(${tunerPosition}% - 5px)` 
                }}
              ></div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
