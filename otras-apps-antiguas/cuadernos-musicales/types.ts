/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ChordNoteMap {
  [key: string]: number;
}

export interface DiatonicChord {
  degree: string;
  name: string;
  type: string;
  notes: number[];
  rootIndex: number;
  isRoot: boolean;
}

export interface ScaleDefinition {
  name: string;
  intervals: number[];
  chordTypes: string[];
  degrees: string[];
}

export interface ScaleList {
  [key: string]: ScaleDefinition;
}

export interface InteractiveNote {
  name: string;
  type: 'white' | 'black';
  id: string;
}

export interface DegreeDefinition {
  num: string;
  label: string;
  chordType: string;
  func: string;
  bgColor: string;
  intervals: number[];
  isPenta?: boolean;
  isKey?: boolean;
  id?: string;
}

// --- CANCIONERO TYPES ---
export interface PitchData {
  midi: number;
  cents: number;
  noteName: string;
}

export interface CompanionChord {
  id: string;
  name: string;
  position: { x: number; y: number };
}

export interface SongLine {
  id: string;
  lyrics: string;
  chords: CompanionChord[];
  measures: number;
  isIntro?: boolean;
}

export interface SongSection {
  name: string;
  bars: SongLine[];
}

export interface Song {
  id?: string;
  title: string;
  artist: string;
  bpm: number;
  timeSignature: string;
  sections: SongSection[];
  creatorId: string;
  createdAt?: any;
  updatedAt?: any;
}

export type ActiveAppModule = 'campo-tonal' | 'inspector-escalas' | 'entrenador-vocal' | 'pad-acordes' | 'cancionero';
