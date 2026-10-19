/** Roots and slash basses are semitones relative to the chart's tonic. */
export type Quality = 'major' | 'minor' | 'half-diminished' | 'diminished7' | 'dominant'

export interface Chord {
  id: string
  root: number
  quality: Quality
  bass?: number
}

export interface Bar {
  id: string
  chords: Chord[]
  section?: string
  time?: string
}

export interface Chart {
  id: string
  name: string
  sourceKey: number
  bpm?: number
  bars: Bar[]
}

export interface QualityDefinition {
  id: Quality
  label: string
  suffix: string
  intervals: number[]
}

export const QUALITIES: QualityDefinition[] = [
  { id: 'major', label: 'Major', suffix: '', intervals: [0, 4, 7] },
  { id: 'minor', label: 'Minor', suffix: 'm', intervals: [0, 3, 7] },
  { id: 'half-diminished', label: 'Half-diminished', suffix: 'm7b5', intervals: [0, 3, 6, 10] },
  { id: 'diminished7', label: 'Diminished seventh', suffix: 'dim7', intervals: [0, 3, 6, 9] },
  { id: 'dominant', label: 'Dominant seventh', suffix: '7', intervals: [0, 4, 7, 10] },
]

/** The array index is the absolute pitch class of the key. */
export const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

const DEGREES = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7']
const DEGREE_LETTERS = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6]
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const NATURAL_PITCHES = [0, 2, 4, 5, 7, 9, 11]
const QUALITY_BY_ID = new Map(QUALITIES.map(quality => [quality.id, quality]))

export const DEFAULT_BPM = 120
export const MIN_BPM = 40
export const MAX_BPM = 240

export const STORAGE_KEY = 'vanarana.transcriptions.v1'
export const STORAGE_VERSION = 1
export const MAX_IMPORT_CHARACTERS = 2_000_000
export const MAX_CHARTS = 200
export const MAX_BARS_PER_CHART = 1_000
export const MAX_CHORDS_PER_BAR = 64
const MAX_TOTAL_ITEMS = 25_000

let nextId = 0

export function makeId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  // The counter keeps IDs unique even if the clock and random source repeat.
  nextId += 1
  return `chart-${Date.now().toString(36)}-${nextId.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createChart(name = 'Untitled chart'): Chart {
  const chartName = name.trim() || 'Untitled chart'
  boundedText(chartName, 'Chart name', 160, false)
  return { id: makeId(), name: chartName, sourceKey: 0, bars: Array.from({ length: 4 }, () => ({ id: makeId(), chords: [] })) }
}

export function degreeName(root: number): string {
  return DEGREES[pitchClass(root, 'Chord root')]
}

/** Spell each degree against the selected tonic, including accidentals in that key. */
export function noteName(relative: number, key: number): string {
  pitchClass(relative, 'Relative note')
  pitchClass(key, 'Key')
  const tonicLetter = LETTERS.indexOf(KEYS[key][0])
  const letter = (tonicLetter + DEGREE_LETTERS[relative]) % 7
  const absolute = (key + relative) % 12
  const difference = ((absolute - NATURAL_PITCHES[letter] + 18) % 12) - 6
  const accidental = difference < 0 ? 'b'.repeat(-difference) : '#'.repeat(difference)
  return LETTERS[letter] + accidental
}

export function chordLabel(chord: Chord, mode: 'degrees' | 'letters', key: number): string {
  const quality = qualityDefinition(chord.quality)
  const name = (root: number) => mode === 'degrees' ? degreeName(root) : noteName(root, key)
  return `${name(chord.root)}${quality.suffix}${chord.bass === undefined ? '' : `/${name(chord.bass)}`}`
}

/** Fixed root-position chord tones, with an optional slash bass below the chord. */
export function chordMidi(chord: Chord, key: number): number[] {
  const quality = qualityDefinition(chord.quality)
  const root = 60 + (pitchClass(chord.root, 'Chord root') + pitchClass(key, 'Key')) % 12
  const notes = quality.intervals.map(interval => root + interval)
  if (chord.bass !== undefined) {
    let bass = 48 + (pitchClass(chord.bass, 'Slash bass') + key) % 12
    while (bass >= root) bass -= 12
    notes.unshift(bass)
  }
  return notes
}

function qualityDefinition(value: Quality): QualityDefinition {
  const definition = QUALITY_BY_ID.get(value)
  if (!definition) throw new Error('Unknown chord quality.')
  return definition
}

function pitchClass(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 11) {
    throw new Error(`${label} must be a whole number from 0 to 11.`)
  }
  return value
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function boundedText(value: unknown, label: string, limit: number, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > limit || (!allowEmpty && !value.trim())) {
    throw new Error(`${label} must be ${allowEmpty ? '' : 'nonempty '}text of at most ${limit} characters.`)
  }
  if ([...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Error(`${label} cannot contain control characters.`)
  }
  return value
}

function list(value: unknown, label: string, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw new Error(`${label} must be a list with at most ${limit} items.`)
  }
  return value
}

/** Validate and rebuild known fields so imported objects cannot carry extra properties. */
function validateCharts(value: unknown): Chart[] {
  const seenIds = new Set<string>()
  const id = (value: unknown, label: string): string => {
    const result = boundedText(value, `${label} ID`, 128, false)
    if (result !== result.trim()) throw new Error(`${label} ID cannot begin or end with whitespace.`)
    if (seenIds.has(result)) throw new Error(`Duplicate ID "${result}". Every chart, bar, and chord needs a unique ID.`)
    seenIds.add(result)
    if (seenIds.size > MAX_TOTAL_ITEMS) throw new Error(`The import exceeds the ${MAX_TOTAL_ITEMS}-item limit.`)
    return result
  }

  return list(value, 'Charts', MAX_CHARTS).map((chartValue, chartIndex) => {
    const label = `Chart ${chartIndex + 1}`
    const input = record(chartValue, label)
    const chart: Chart = {
      id: id(input.id, label),
      name: boundedText(input.name, `${label} name`, 160, false),
      sourceKey: pitchClass(input.sourceKey, `${label} source key`),
      bars: [],
    }
    if (input.bpm !== undefined) {
      if (typeof input.bpm !== 'number' || !Number.isInteger(input.bpm) || input.bpm < MIN_BPM || input.bpm > MAX_BPM) throw new Error(`Tempo must be a whole number from ${MIN_BPM} to ${MAX_BPM} BPM.`)
      chart.bpm = input.bpm
    }
    chart.bars = list(input.bars, `${label} bars`, MAX_BARS_PER_CHART).map((barValue, barIndex) => {
      const barLabel = `${label}, bar ${barIndex + 1}`
      const inputBar = record(barValue, barLabel)
      const bar: Bar = { id: id(inputBar.id, barLabel), chords: [] }
      if (inputBar.section !== undefined) bar.section = boundedText(inputBar.section, `${barLabel} section`, 120)
      if (inputBar.time !== undefined) bar.time = boundedText(inputBar.time, `${barLabel} time`, 32)
      bar.chords = list(inputBar.chords, `${barLabel} chords`, MAX_CHORDS_PER_BAR).map((chordValue, chordIndex) => {
        const chordLabel = `${barLabel}, chord ${chordIndex + 1}`
        const inputChord = record(chordValue, chordLabel)
        if (typeof inputChord.quality !== 'string' || !QUALITY_BY_ID.has(inputChord.quality as Quality)) {
          throw new Error(`${chordLabel} has an unknown quality.`)
        }
        const chord: Chord = {
          id: id(inputChord.id, chordLabel),
          root: pitchClass(inputChord.root, `${chordLabel} root`),
          quality: inputChord.quality as Quality,
        }
        if (inputChord.bass !== undefined) chord.bass = pitchClass(inputChord.bass, `${chordLabel} slash bass`)
        return chord
      })
      return bar
    })
    return chart
  })
}

export function parseCharts(json: string): Chart[] {
  if (typeof json !== 'string' || json.length > MAX_IMPORT_CHARACTERS) {
    throw new Error(`Choose a chart JSON file smaller than ${MAX_IMPORT_CHARACTERS / 1_000_000} MB.`)
  }
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new Error('This is not valid JSON. Choose an exported chart JSON file.')
  }
  const envelope = record(value, 'Chart file')
  if (envelope.version !== STORAGE_VERSION) throw new Error('Unsupported chart file version. Expected version 1.')
  return validateCharts(envelope.charts)
}

export function serializeCharts(charts: Chart[]): string {
  const json = JSON.stringify({ version: STORAGE_VERSION, charts: validateCharts(charts) }, null, 2)
  if (json.length > MAX_IMPORT_CHARACTERS) throw new Error('These charts are too large to save in one file.')
  return json
}

export type ChartStorage = Pick<Storage, 'getItem' | 'setItem'>
export interface LoadChartsResult { charts: Chart[]; error: string | null }
export interface SaveChartsResult { error: string | null }

/** Storage can be blocked entirely, including when reading the localStorage property. */
export function loadCharts(storage?: ChartStorage): LoadChartsResult {
  try {
    const target = storage ?? globalThis.localStorage
    if (!target) throw new Error('Browser storage is unavailable.')
    const json = target.getItem(STORAGE_KEY)
    return { charts: json === null ? [] : parseCharts(json), error: null }
  } catch (error) {
    return { charts: [], error: storageError(error, 'Unable to read saved charts.') }
  }
}

/** A failed save leaves the prior stored value intact; callers can offer JSON export. */
export function saveCharts(charts: Chart[], storage?: ChartStorage): SaveChartsResult {
  try {
    const json = serializeCharts(charts)
    const target = storage ?? globalThis.localStorage
    if (!target) throw new Error('Browser storage is unavailable.')
    target.setItem(STORAGE_KEY, json)
    return { error: null }
  } catch (error) {
    return { error: storageError(error, 'Unable to save charts in this browser.') }
  }
}

function storageError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? `${fallback} ${error.message}` : fallback
}
