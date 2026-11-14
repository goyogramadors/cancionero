import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, Auth } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, doc, setDoc, query, deleteDoc, Firestore } from 'firebase/firestore';
import { Play, Pause, FilePlus, BookOpen, Music, Save, Pencil, Trash2, Wand2, ArrowLeft, Disc } from 'lucide-react';
import { CompanionChord, SongLine, Song, SongSection } from '../types';

// Fallback initial song to show in Library if Firestore is not authenticated or connected
const INITIAL_DEMO_SONGS: Song[] = [
  {
    id: "demo-cancion-1",
    title: "De Música Ligera",
    artist: "Soda Stereo",
    bpm: 124,
    timeSignature: "4/4",
    creatorId: "demo-user",
    sections: [{
      name: "Main",
      bars: [
        {
          id: "stanza-1",
          lyrics: "Ella durmió al calor de las masas",
          chords: [
            { id: "c-1", name: "Bm", position: { x: 5, y: 0 } },
            { id: "c-2", name: "G", position: { x: 30, y: 0 } },
            { id: "c-3", name: "D", position: { x: 55, y: 0 } },
            { id: "c-4", name: "A", position: { x: 80, y: 0 } },
          ],
          measures: 4,
          isIntro: false
        },
        {
          id: "stanza-2",
          lyrics: "Y yo desperté queriendo soñarla",
          chords: [
            { id: "c-5", name: "Bm", position: { x: 5, y: 0 } },
            { id: "c-6", name: "G", position: { x: 30, y: 0 } },
            { id: "c-7", name: "D", position: { x: 55, y: 0 } },
            { id: "c-8", name: "A", position: { x: 80, y: 0 } },
          ],
          measures: 4,
          isIntro: false
        },
        {
          id: "stanza-3",
          lyrics: "De aquel amor de música ligera",
          chords: [
            { id: "c-9", name: "Bm", position: { x: 5, y: 0 } },
            { id: "c-10", name: "G", position: { x: 30, y: 0 } },
            { id: "c-11", name: "D", position: { x: 55, y: 0 } },
            { id: "c-12", name: "A", position: { x: 80, y: 0 } },
          ],
          measures: 4,
          isIntro: false
        },
        {
          id: "stanza-4",
          lyrics: "Nada nos libra, nada más queda",
          chords: [
            { id: "c-13", name: "Bm", position: { x: 5, y: 0 } },
            { id: "c-14", name: "G", position: { x: 30, y: 0 } },
            { id: "c-15", name: "D", position: { x: 55, y: 0 } },
            { id: "c-16", name: "A", position: { x: 80, y: 0 } },
          ],
          measures: 4,
          isIntro: false
        }
      ]
    }]
  }
];

// --- FIREBASE LAZY INIT ---
let firebaseAppConfig: any = null;
try {
  // Try loading dynamic configurations if they exist inside global properties or environment
  const metaConfigUrl = "/firebase-applet-config.json";
  // Fallback to reading config values
} catch (e) {}

// --- DECORATIVE PILLS ---
const IconPill: React.FC<{ icon: any; children: React.ReactNode }> = ({ icon: Icon, children }) => (
  <div className="flex items-center bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded-full">
    <Icon size={12} className="mr-1.5 text-emerald-400" />
    {children}
  </div>
);

// --- COMPASS GRAPH REJILLA ---
const MeasureGrid: React.FC<{ timeSignature: string; measures?: number; lineId: string }> = ({ timeSignature, measures = 4, lineId }) => {
  const beats = parseInt(timeSignature.split('/')[0], 10) || 4;
  const totalBeats = beats * measures;

  return (
    <div className="absolute inset-0 flex select-none pointer-events-none z-0">
      {Array.from({ length: totalBeats }).map((_, i) => {
        const isMeasureStart = i % beats === 0;
        if (isMeasureStart && i > 0) {
          return <div key={`${lineId}-div-${i}`} className="h-full border-l-2 border-zinc-700/80" style={{ width: `${100 / totalBeats}%` }}></div>;
        }
        return <div key={`${lineId}-div-${i}`} className="h-full border-l border-zinc-900/40" style={{ width: `${100 / totalBeats}%` }}></div>;
      })}
    </div>
  );
};

// --- COMPONENTE EDITOR DE CANCIONES ---
interface SongEditorProps {
  db: Firestore | null;
  userId: string;
  onBackToLibrary: () => void;
  songToEdit: Song | null;
  onSaveOffline: (song: Song) => void;
}

const SongEditor: React.FC<SongEditorProps> = ({ db, userId, onBackToLibrary, songToEdit, onSaveOffline }) => {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [bpm, setBpm] = useState(120);
  const [timeSignature, setTimeSignature] = useState('4/4');
  const [isLoading, setIsLoading] = useState(false);
  
  const [rawText, setRawText] = useState('');
  const [structuredLines, setStructuredLines] = useState<SongLine[]>([]);
  const [isTranscribed, setIsTranscribed] = useState(false);
  const [newChordText, setNewChordText] = useState<{ [key: string]: string }>({});

  const lineRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  useEffect(() => {
    if (songToEdit) {
      setTitle(songToEdit.title); 
      setArtist(songToEdit.artist); 
      setBpm(songToEdit.bpm);
      setTimeSignature(songToEdit.timeSignature);
      if (songToEdit.sections?.[0]?.bars) {
        setStructuredLines(songToEdit.sections[0].bars); 
        setIsTranscribed(true);
      }
    } else {
      setTitle(''); 
      setArtist(''); 
      setBpm(120); 
      setTimeSignature('4/4');
      setRawText(''); 
      setStructuredLines([]); 
      setIsTranscribed(false);
    }
  }, [songToEdit]);
  
  const autoRecognizeChords = (text: string) => {
    const stanzas = text.split(/\n\s*\n/).filter(s => s.trim() !== '');
    // Regex for typical chords (A-G with min, Maj, dim, 7th...)
    const chordRegex = /\b([A-G][b#]?(maj|m|min|dim|aug|sus|add|M)?\d*(\/[A-G][b#]?)?)/g;
    
    const newStructuredLines: SongLine[] = stanzas.map((stanza, stanzaIndex) => {
      const lines = stanza.split('\n');
      const chordsLine = lines[0] || '';
      const lyricsLine = lines.slice(1).join('\n') || ' '; 
      
      const chords: CompanionChord[] = [];
      let match;
      while ((match = chordRegex.exec(chordsLine)) !== null) {
        chords.push({
          id: `chord-${stanzaIndex}-${match.index}-${Date.now()}`, 
          name: match[0],
          position: { x: Math.max(0, Math.min(95, (match.index / Math.max(1, chordsLine.length)) * 100)), y: 0 }
        });
      }

      return {
        id: `stanza-${stanzaIndex}-${Date.now()}`, 
        lyrics: lyricsLine, 
        chords: chords, 
        measures: 4
      };
    });
    
    if (newStructuredLines.length === 0) {
      newStructuredLines.push({
        id: `stanza-new-${Date.now()}`,
        lyrics: "Nueva frase musical...",
        chords: [],
        measures: 4
      });
    }

    setStructuredLines(newStructuredLines);
    setIsTranscribed(true);
  };

  const handleLyricChange = (lineId: string, newLyrics: string) => {
    setStructuredLines(prev => prev.map(l => l.id === lineId ? { ...l, lyrics: newLyrics } : l));
  };

  const handleNewChordKeyDown = (e: React.KeyboardEvent, lineId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const chordName = newChordText[lineId]?.trim();
      const chordFormatRegex = /^([A-G][b#]?(maj|m|min|dim|aug|sus|add|M)?\d*(\/[A-G][b#]?)?)$/;
      if (chordName && chordFormatRegex.test(chordName)) {
        setStructuredLines(prev => prev.map(line => {
          if (line.id === lineId) {
            const newChord: CompanionChord = { 
              id: `chord-${line.id}-${Date.now()}`, 
              name: chordName, 
              position: { x: 5, y: 0 } 
            };
            return { ...line, chords: [...line.chords, newChord] };
          } 
          return line;
        }));
        setNewChordText(prev => ({ ...prev, [lineId]: '' }));
      }
    }
  };
  
  const handleAddPhrase = () => {
    const newPhrase: SongLine = {
      id: `stanza-${Date.now()}`,
      lyrics: 'Nueva frase...',
      chords: [],
      measures: 4
    };
    setStructuredLines(prev => [...prev, newPhrase]);
  };

  const handleDeletePhrase = (lineId: string) => {
    setStructuredLines(prev => prev.filter(line => line.id !== lineId));
  };

  const handleDragStart = (e: React.DragEvent, lineId: string, chordId: string) => {
    e.dataTransfer.setData("chordId", chordId); 
    e.dataTransfer.setData("lineId", lineId);
  };

  const handleDragOver = (e: React.DragOverEvent) => e.preventDefault();

  const handleDrop = (e: React.DragEvent, targetLineId: string) => {
    e.preventDefault();
    const chordId = e.dataTransfer.getData("chordId");
    const originalLineId = e.dataTransfer.getData("lineId");
    const targetLineRef = lineRefs.current[targetLineId];
    if (!targetLineRef) return;
    
    const lineRect = targetLineRef.getBoundingClientRect();
    const rawX = e.clientX - lineRect.left;
    const xPercent = Math.max(0, Math.min(95, (rawX / lineRect.width) * 100));

    setStructuredLines(prev => {
      const newLines = JSON.parse(JSON.stringify(prev)) as SongLine[];
      const originalLine = newLines.find(l => l.id === originalLineId);
      const targetLine = newLines.find(l => l.id === targetLineId);
      if (!originalLine || !targetLine) return prev;
      const chordIndex = originalLine.chords.findIndex(c => c.id === chordId);
      if (chordIndex === -1) return prev;
      const [chord] = originalLine.chords.splice(chordIndex, 1);
      chord.position = { x: xPercent, y: 0 };
      targetLine.chords.push(chord);
      return newLines;
    });
  };

  const handleSave = async () => {
    if (!title || !artist) return;
    setIsLoading(true);

    const songData: Song = {
      title, 
      artist, 
      bpm: Number(bpm) || 120, 
      timeSignature, 
      sections: [{ name: 'Main', bars: structuredLines }],
      creatorId: songToEdit?.creatorId || userId,
      createdAt: songToEdit?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (songToEdit?.id) {
      songData.id = songToEdit.id;
    }

    try {
      if (db) {
        const collectionPath = `songs`;
        if (songToEdit?.id) {
          await setDoc(doc(db, collectionPath, songToEdit.id), songData);
        } else {
          await addDoc(collection(db, collectionPath), songData);
        }
      }
      // Always also cache into offline local storage
      onSaveOffline(songData);
      onBackToLibrary();
    } catch (e) { 
      console.error("Firestore Save failed, saving offline:", e);
      onSaveOffline(songData);
      onBackToLibrary();
    } finally { 
      setIsLoading(false); 
    }
  };

  return (
    <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl w-full max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div className="flex justify-between items-center-">
        <h3 className="text-xl font-bold text-zinc-100 font-sans flex items-center gap-2">
          {songToEdit ? 'Editar Canción' : 'Registrar Nueva Canción'}
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <input 
          type="text" 
          placeholder="Título (ej: De música ligera)" 
          value={title} 
          onChange={e => setTitle(e.target.value)} 
          className="bg-zinc-950 border border-zinc-855 rounded-xl p-3 text-sm text-zinc-100 outline-none focus:border-emerald-500 transition" 
        />
        <input 
          type="text" 
          placeholder="Artista (ej: Soda Stereo)" 
          value={artist} 
          onChange={e => setArtist(e.target.value)} 
          className="bg-zinc-950 border border-zinc-855 rounded-xl p-3 text-sm text-zinc-100 outline-none focus:border-emerald-500 transition" 
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-zinc-550 uppercase tracking-widest pl-1">BPM</label>
          <input 
            type="number" 
            value={bpm} 
            onChange={e => setBpm(Number(e.target.value))} 
            className="bg-zinc-950 border border-zinc-855 rounded-xl p-3 text-sm text-zinc-100 outline-none focus:border-emerald-500 transition" 
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-zinc-550 uppercase tracking-widest pl-1">Métrica</label>
          <select 
            value={timeSignature} 
            onChange={e => setTimeSignature(e.target.value)} 
            className="bg-zinc-950 border border-zinc-855 rounded-xl p-3 text-sm text-zinc-100 outline-none focus:border-emerald-500 transition"
          >
            <option value="4/4">4/4 (Estándar)</option>
            <option value="3/4">3/4 (Vals)</option>
          </select>
        </div>
      </div>
      
      {!isTranscribed ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-zinc-550 uppercase tracking-widest pl-1">Pegar Letra y Acordes</span>
            <textarea 
              value={rawText} 
              onChange={e => setRawText(e.target.value)} 
              placeholder="Introduce la letra o acordes en bloques de stanzas. Los acordes en la primera línea se transcribirán en la rejilla de compases automáticamente." 
              className="w-full h-44 bg-zinc-950 border border-zinc-855 rounded-xl p-3 text-sm text-zinc-350 outline-none focus:border-emerald-500 font-mono transition" 
            />
          </div>
          <button 
            type="button"
            onClick={() => autoRecognizeChords(rawText)}
            className="bg-emerald-500 hover:bg-emerald-600 font-sans text-zinc-950 font-bold py-2.5 px-5 rounded-xl shadow-lg flex items-center gap-2 cursor-pointer transition text-xs"
          >
            <Wand2 size={14} /> Transcribir Letra y Acordes
          </button>
        </div>
      ) : (
        <div className="bg-zinc-950 border border-zinc-850 p-6 rounded-2xl h-80 overflow-y-auto custom-scrollbar space-y-8 select-none">
          {structuredLines.map((line, index) => (
            <div key={line.id} className="relative group border-b border-zinc-850/60 pb-6">
              <button 
                onClick={() => handleDeletePhrase(line.id)} 
                className="absolute -top-1 -right-1 p-1 bg-rose-500/10 hover:bg-rose-500 border border-rose-900 hover:border-rose-400 rounded-full text-rose-400 hover:text-zinc-100 transition duration-150 cursor-pointer z-30"
              >
                <Trash2 size={12} />
              </button>
              
              {/* Compass container with drag grid */}
              <div 
                ref={el => { lineRefs.current[line.id] = el; }} 
                onDragOver={handleDragOver} 
                onDrop={(e) => handleDrop(e, line.id)}
                className="relative h-12 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"
              >
                <MeasureGrid timeSignature={timeSignature} measures={line.measures} lineId={line.id} />
                
                {/* Visual cursor helper and inline adding input */}
                <input 
                  type="text" 
                  placeholder="+ Acorde (Enter)" 
                  value={newChordText[line.id] || ''} 
                  onChange={e => setNewChordText(prev => ({...prev, [line.id]: e.target.value}))} 
                  onKeyDown={e => handleNewChordKeyDown(e, line.id)} 
                  className="absolute top-2.5 left-2 bg-zinc-950 border border-zinc-800 hover:border-zinc-750 text-[10px] w-28 px-2 py-0.5 rounded outline-none text-zinc-300 focus:border-emerald-500 z-10" 
                />

                {line.chords.map(chord => (
                  <div 
                    key={chord.id} 
                    draggable 
                    onDragStart={(e) => handleDragStart(e, line.id, chord.id)}
                    className="absolute bg-emerald-500 text-zinc-950 text-[11px] font-black px-2 py-0.5 rounded cursor-grab active:cursor-grabbing z-20 shadow border border-emerald-400 max-w-16 truncate" 
                    style={{ left: `${chord.position.x}%`, top: `10px` }}
                  >
                    {chord.name}
                  </div>
                ))}
              </div>

              {/* Editable Lyric box aligned vertically */}
              <div className="relative mt-3">
                <input 
                  type="text"
                  value={line.lyrics} 
                  onChange={(e) => handleLyricChange(line.id, e.target.value)} 
                  className="w-full bg-zinc-900/40 hover:bg-zinc-900/80 focus:bg-zinc-900 border border-transparent focus:border-zinc-800 p-2.5 rounded-xl outline-none text-zinc-200 text-sm font-sans"
                />
              </div>
            </div>
          ))}

          <div className="flex justify-center pt-2">
            <button 
              type="button" 
              onClick={handleAddPhrase} 
              className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 font-sans text-zinc-300 font-semibold py-2 px-4 rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <FilePlus size={14} /> Añadir Frase o Párrafo
            </button>
          </div>
        </div>
      )}

      {/* Action panel footer */}
      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <button 
          onClick={handleSave} 
          disabled={isLoading || !isTranscribed}
          className="flex-1 bg-emerald-500 hover:bg-emerald-600 font-sans text-zinc-950 font-bold py-2 px-5 rounded-xl shadow-lg hover:shadow-emerald-500/10 justify-center flex items-center gap-2 cursor-pointer transition text-sm disabled:opacity-50"
        >
          <Save size={16} /> 
          {isLoading ? 'Guardando...' : (songToEdit ? 'Actualizar Cambios' : 'Guardar en Cancionero')}
        </button>
        <button 
          onClick={onBackToLibrary} 
          className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 py-2 px-5 rounded-xl font-sans font-semibold text-sm transition cursor-pointer flex items-center justify-center gap-1.5"
        >
          <BookOpen size={16} /> Cancelar y Volver
        </button>
      </div>
    </div>
  );
};


// --- COMPONENTE VISOR DE CANCIONES ---
interface SongPlayerProps {
  song: Song;
  onExit: () => void;
}

const SongPlayer: React.FC<SongPlayerProps> = ({ song, onExit }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(-1);
  const [playheadPosition, setPlayheadPosition] = useState(0);
  const [activeChordId, setActiveChordId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const animationFrameId = useRef<number | null>(null);
  const playbackState = useRef({ startTime: 0, totalElapsed: 0 });

  const allLines = song.sections?.[0]?.bars || [];
  
  const animatePlayback = useCallback((timestamp: number) => {
    if (!isPlaying) { 
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current); 
      return; 
    }

    if (playbackState.current.startTime === 0) {
      playbackState.current.startTime = timestamp;
    }
    
    const elapsedSinceLastFrame = timestamp - playbackState.current.startTime;
    playbackState.current.totalElapsed += elapsedSinceLastFrame;
    playbackState.current.startTime = timestamp;

    let cumulativeTime = 0;
    let newCurrentLineIndex = -1;

    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i];
      const beats = parseInt(song.timeSignature.split('/')[0], 10) || 4;
      const timePerBeat = 60000 / song.bpm;
      const lineDuration = timePerBeat * beats * (line.measures || 4);
      
      if (playbackState.current.totalElapsed < cumulativeTime + lineDuration) {
        newCurrentLineIndex = i;
        break;
      }
      cumulativeTime += lineDuration;
    }

    // Playback loop finished, reset state
    if (newCurrentLineIndex === -1) { 
      setIsPlaying(false); 
      setCurrentLineIndex(-1); 
      setPlayheadPosition(0); 
      setActiveChordId(null);
      playbackState.current = { startTime: 0, totalElapsed: 0 };
      return;
    }

    if (newCurrentLineIndex !== currentLineIndex) {
      setCurrentLineIndex(newCurrentLineIndex);
      const lineEl = lineRefs.current[`player-line-${newCurrentLineIndex}`];
      if (lineEl && scrollRef.current) {
        scrollRef.current.scrollTo({ 
          top: lineEl.offsetTop - scrollRef.current.clientHeight / 3, 
          behavior: 'smooth' 
        });
      }
    }
    
    const currentLineDuration = ((60000 / song.bpm) * (parseInt(song.timeSignature.split('/')[0], 10) || 4)) * (allLines[newCurrentLineIndex].measures || 4);
    const timeIntoCurrentLine = playbackState.current.totalElapsed - cumulativeTime;
    const progressPercent = (timeIntoCurrentLine / currentLineDuration) * 100;

    setPlayheadPosition(progressPercent);

    // Filter chord triggers inside playhead boundaries
    const currentLineChords = allLines[newCurrentLineIndex]?.chords || [];
    const passedChords = currentLineChords.filter(c => progressPercent >= c.position.x);
    
    if (passedChords.length > 0) {
      const activeOne = passedChords.sort((a, b) => b.position.x - a.position.x)[0];
      setActiveChordId(activeOne.id);
    } else {
      setActiveChordId(null);
    }
    
    animationFrameId.current = requestAnimationFrame(animatePlayback);
  }, [isPlaying, currentLineIndex, allLines, song.bpm, song.timeSignature]);

  const togglePlay = () => {
    setIsPlaying(prev => !prev);
  };
  
  useEffect(() => {
    if (isPlaying) {
      playbackState.current.startTime = performance.now();
      animationFrameId.current = requestAnimationFrame(animatePlayback);
    } else {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    }
    return () => {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, [isPlaying, animatePlayback]);

  return (
    <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl w-full max-w-4xl mx-auto flex flex-col h-[65vh] relative animate-fade-in">
      
      {/* Absolute top exit icon */}
      <button 
        onClick={onExit} 
        className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 border border-transparent hover:border-zinc-700/80 rounded-full transition cursor-pointer"
        title="Volver"
      >
        <ArrowLeft size={18} />
      </button>

      <div className="flex-shrink-0 mb-4 pb-4 border-b border-zinc-800 mr-8">
        <h3 className="text-2xl font-extrabold text-zinc-100 font-sans">{song.title}</h3>
        <p className="text-sm text-zinc-400 font-sans mt-0.5">{song.artist}</p>
        <div className="flex items-center gap-3 mt-3">
          <IconPill icon={Disc}>{song.bpm} BPM</IconPill>
          <IconPill icon={Music}>{song.timeSignature}</IconPill>
        </div>
      </div>
      
      {/* Scrollable play lyrics viewer */}
      <div ref={scrollRef} className="flex-grow overflow-y-auto pr-2 custom-scrollbar select-none">
        {allLines.map((line, index) => (
          <div ref={el => { lineRefs.current[`player-line-${index}`] = el; }} key={line.id || index} className="my-8">
            <div className="relative h-14 bg-zinc-950/40 border border-zinc-900/40 rounded-xl overflow-hidden mb-2">
              <MeasureGrid timeSignature={song.timeSignature} measures={line.measures} lineId={`player-grid-${line.id}`} />
              
              {line.chords.map(chord => (
                <div 
                  key={chord.id} 
                  className="absolute font-extrabold text-xs transition-all duration-150 py-1" 
                  style={{ 
                    left: `${chord.position.x}%`, 
                    top: `10px`, 
                    transform: activeChordId === chord.id ? 'scale(1.3)' : 'scale(1)', 
                    color: activeChordId === chord.id ? '#10b981' : '#a1a1aa' 
                  }}
                >
                  {chord.name}
                </div>
              ))}
              
              {currentLineIndex === index && (
                <div className="absolute top-0 bottom-0 w-0.5 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" style={{ left: `${playheadPosition}%` }}></div>
              )}
            </div>

            <div className="relative text-lg text-zinc-500 font-mono tracking-tight pl-1 select-none">
              <div 
                className="absolute inset-0 text-emerald-400 overflow-hidden font-mono whitespace-pre transition-all duration-100" 
                style={{ width: `${currentLineIndex === index ? playheadPosition : 0}%`, caretColor: 'transparent' }}
              >
                <p className="whitespace-pre truncate select-none">{line.lyrics}</p>
              </div>
              <p className="whitespace-pre select-none text-zinc-650 font-mono truncate">{line.lyrics}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex-shrink-0 mt-4 pt-4 border-t border-zinc-850 flex justify-center">
        <button 
          onClick={togglePlay} 
          className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 flex items-center justify-center shadow-lg hover:shadow-emerald-500/20 transition-all transform hover:scale-105 active:scale-95 cursor-pointer"
        >
          {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
        </button>
      </div>
    </div>
  );
};


// --- COMPONENTE MÁNAGER BIBLIOTECA ---
interface LibraryProps {
  songs: Song[];
  onSelectSong: (song: Song) => void;
  onShowEditor: () => void;
  onEditSong: (song: Song) => void;
  onDeleteSong: (songId: string) => void;
  userId: string;
}

const Library: React.FC<LibraryProps> = ({ songs, onSelectSong, onShowEditor, onEditSong, onDeleteSong, userId }) => {
  return (
    <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-sm shadow-sm w-full max-w-4xl mx-auto space-y-6 animate-fade-in" id="library-canciones">
      <div className="flex justify-between items-center bg-zinc-950 p-4 rounded-sm border border-zinc-800">
        <div className="flex items-center gap-3">
          <BookOpen className="text-[#D4A373]" size={20} />
          <div>
            <h3 className="text-xl font-serif italic text-zinc-100">Cancionero Digital</h3>
            <p className="text-zinc-500 text-xs">Colección sincronizada de letras y acordes sobre línea de tempo.</p>
          </div>
        </div>
        <button 
          onClick={onShowEditor}
          className="bg-[#1C1C1C] hover:bg-[#2c2927] border border-zinc-500 text-white font-sans font-bold py-2 px-4 rounded-sm shadow-sm cursor-pointer text-xs flex items-center gap-1.5 transition uppercase tracking-wider"
        >
          <FilePlus size={14} /> Registrar Canción
        </button>
      </div>

      <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar pr-1">
        {songs.map(song => (
          <div 
            key={song.id} 
            onClick={() => onSelectSong(song)}
            className="bg-zinc-950 hover:bg-zinc-900 border border-zinc-850 hover:border-zinc-750 p-4 rounded-sm flex justify-between items-center cursor-pointer transition"
          >
            <div className="flex-grow">
              <h4 className="font-serif text-base text-zinc-100">{song.title}</h4>
              <p className="text-xs text-zinc-500 mt-0.5">{song.artist}</p>
            </div>
            
            <div className="flex items-center gap-3 ml-4 flex-shrink-0" onClick={e => e.stopPropagation()}>
              <IconPill icon={Disc}>{song.bpm} BPM</IconPill>
              
              <button 
                onClick={() => onEditSong(song)} 
                className="p-2 text-zinc-400 hover:text-zinc-200 rounded-sm hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition"
              >
                <Pencil size={15} />
              </button>
              
              <button 
                onClick={() => { if (song.id) onDeleteSong(song.id); }} 
                className="p-2 text-rose-500/80 hover:text-rose-400 rounded-sm hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}

        {songs.length === 0 && (
          <div className="text-center py-12 border border-dashed border-zinc-850 bg-zinc-950/20 rounded-sm text-zinc-500 flex flex-col items-center justify-center">
            <Music size={32} className="text-zinc-700 gap-2 mb-2" />
            <h4 className="text-zinc-450 text-sm font-bold">No hay canciones registradas</h4>
            <p className="text-xs text-zinc-500 mt-1 max-w-xs">Registra tu primera canción con acordes para ensayar con el metrónomo visual.</p>
          </div>
        )}
      </div>
    </div>
  );
};

// --- CORE EXPORT ELEMENT ---
export default function Cancionero() {
  const [view, setView] = useState<'library' | 'player' | 'editor'>('library');
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [songToEdit, setSongToEdit] = useState<Song | null>(null);
  
  // Custom Sync Fallback Memory list state
  const [songsList, setSongsList] = useState<Song[]>(INITIAL_DEMO_SONGS);
  
  // Firebase State values
  const [db, setDb] = useState<Firestore | null>(null);
  const [userId, setUserId] = useState<string>('guest-session');
  const [authReady, setAuthReady] = useState(false);

  // Initialize offline caches from localStorage
  useEffect(() => {
    try {
      const offlineCacheKey = "cuadernos-musicales-canciones";
      const cached = localStorage.getItem(offlineCacheKey);
      if (cached) {
        setSongsList(JSON.parse(cached));
      } else {
        localStorage.setItem(offlineCacheKey, JSON.stringify(INITIAL_DEMO_SONGS));
      }
    } catch (e) {
      console.warn("Local storage cache reading unsuccessful:", e);
    }
  }, []);

  // Try parsing Firestore config dynamically
  useEffect(() => {
    const handleFirebaseSetup = async () => {
      try {
        // Checking for firebase-applet-config integration existence
        const requestConfig = await fetch('/firebase-applet-config.json').then(r => r.json()).catch(() => null);
        
        if (requestConfig) {
          const app = getApps().length === 0 ? initializeApp(requestConfig) : getApp();
          const firestoreDb = getFirestore(app);
          const firestoreAuth = getAuth(app);
          
          setDb(firestoreDb);
          
          onAuthStateChanged(firestoreAuth, async (user) => {
            if (user) {
              setUserId(user.uid);
            } else {
              const { user: anonUser } = await signInAnonymously(firestoreAuth);
              setUserId(anonUser.uid);
            }
            setAuthReady(true);
          });
        } else {
          setAuthReady(true);
        }
      } catch (err) {
        console.warn("Firebase not configured or denied by permissions. Operating offline.", err);
        setAuthReady(true);
      }
    };
    
    handleFirebaseSetup();
  }, []);

  // Sync listener if Firestore is setup active
  useEffect(() => {
    if (!db) return;
    try {
      const q = query(collection(db, "songs"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const firestoreSongs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Song[];
        
        // Merge offline + online lists
        setSongsList(prev => {
          const mergedIndices = new Map(firestoreSongs.map(s => [s.title + s.artist, s]));
          prev.forEach(s => {
            const key = s.title + s.artist;
            if (!mergedIndices.has(key)) {
              mergedIndices.set(key, s);
            }
          });
          const completedList = Array.from(mergedIndices.values());
          
          // Persistence offline update
          localStorage.setItem("cuadernos-musicales-canciones", JSON.stringify(completedList));
          return completedList;
        });
      }, (err) => {
        console.warn("Firestore access denied or quota limited:", err);
      });
      return () => unsubscribe();
    } catch (e) {
      console.warn("Sync stream failure:", e);
    }
  }, [db]);

  const handleSaveOfflineSong = (newSong: Song) => {
    setSongsList(prev => {
      let updated: Song[];
      if (newSong.id || songToEdit?.id) {
        // Merge edit update
        const idToCheck = newSong.id || songToEdit?.id;
        updated = prev.map(s => (s.id === idToCheck || (s.title === newSong.title && s.artist === newSong.artist)) ? { ...newSong, id: idToCheck } : s);
      } else {
        // Assign random tracking id
        const completeNew: Song = { ...newSong, id: `offline-${Date.now()}` };
        updated = [completeNew, ...prev];
      }
      localStorage.setItem("cuadernos-musicales-canciones", JSON.stringify(updated));
      return updated;
    });
  };

  const handleDeleteSong = async (songId: string) => {
    try {
      if (db && !songId.startsWith("offline")) {
        await deleteDoc(doc(db, "songs", songId));
      }
    } catch (e) {
      console.warn("Firestore delete failed, deleting local cached replica:", e);
    }
    
    setSongsList(prev => {
      const filtered = prev.filter(s => s.id !== songId);
      localStorage.setItem("cuadernos-musicales-canciones", JSON.stringify(filtered));
      return filtered;
    });
  };

  const handleSelectSongForPlayer = (song: Song) => { 
    setView('player'); 
    setCurrentSong(song); 
  };
  
  const handleSelectSongForEditor = (song: Song) => { 
    setView('editor'); 
    setSongToEdit(song); 
  };
  
  const handleShowEditorForNew = () => { 
    setView('editor'); 
    setSongToEdit(null); 
  };
  
  const handleBackToLibrary = () => { 
    setView('library'); 
    setSongToEdit(null); 
    setCurrentSong(null); 
  };

  if (!authReady) {
    return (
      <div className="w-full flex items-center justify-center p-12 text-zinc-400 font-sans">
        <Disc size={20} className="animate-spin mr-2 text-emerald-400" /> Sincronizando cancionero offline...
      </div>
    );
  }

  return (
    <>
      {view === 'player' && currentSong && (
        <SongPlayer song={currentSong} onExit={handleBackToLibrary} />
      )}
      {view === 'editor' && (
        <SongEditor 
          db={db} 
          userId={userId} 
          songToEdit={songToEdit} 
          onSaveOffline={handleSaveOfflineSong} 
          onBackToLibrary={handleBackToLibrary} 
        />
      )}
      {view === 'library' && (
        <Library 
          songs={songsList} 
          userId={userId} 
          onSelectSong={handleSelectSongForPlayer} 
          onShowEditor={handleShowEditorForNew} 
          onEditSong={handleSelectSongForEditor} 
          onDeleteSong={handleDeleteSong}
        />
      )}
    </>
  );
}
