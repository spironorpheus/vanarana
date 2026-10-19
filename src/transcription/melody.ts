import {
  MAX_BARS_PER_CHART, MAX_MELODY_DURATION_BEATS, MAX_MELODY_NOTES_PER_BAR,
  makeId, serializeCharts, type Bar, type Chart, type MelodyNote,
} from './model'

/** A completed note from a take. Its onset is relative to the recording start. */
export interface RecordedMelodyNote {
  /** Absolute MIDI pitch already converted into the chart's source key. */
  pitch: number
  startBeat: number
  duration: number
  velocity: number
}

function midiPitch(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 127) {
    throw new Error('Melody pitch must be a whole MIDI number from 0 to 127.')
  }
  return value
}

function keyDifference(sourceKey: number, targetKey: number): number {
  if (![sourceKey, targetKey].every(key => Number.isInteger(key) && key >= 0 && key <= 11)) {
    throw new Error('Melody keys must be whole numbers from 0 to 11.')
  }
  return targetKey - sourceKey
}

/** Preserve register by applying the same signed key difference to every note. */
export function transposeMelodyPitch(sourcePitch: number, sourceKey: number, targetKey: number): number {
  return midiPitch(midiPitch(sourcePitch) + keyDifference(sourceKey, targetKey))
}

/** Inverse playback transposition, used when recording in a rendered key. */
export function sourceMelodyPitch(playedPitch: number, sourceKey: number, targetKey: number): number {
  return midiPitch(midiPitch(playedPitch) - keyDifference(sourceKey, targetKey))
}

/**
 * Replace the melody in every bar touched by a take, including recorded silence.
 * A partial final bar is replaced in full. Notes are owned only by their attack
 * bar, so a held note crosses bar lines without duplicate attacks. No chart data
 * is mutated, and rejected takes leave the original chart intact.
 */
export function replaceMelodyTake(chart: Chart, startBarIndex: number, elapsedBeats: number, notes: readonly RecordedMelodyNote[]): Chart {
  if (!Number.isInteger(startBarIndex) || startBarIndex < 0 || startBarIndex >= MAX_BARS_PER_CHART || startBarIndex > chart.bars.length) {
    throw new Error('Choose an existing bar or the next empty bar to start recording.')
  }
  if (!Number.isFinite(elapsedBeats) || elapsedBeats < 0) {
    throw new Error('Recording duration must be a finite, nonnegative number of beats.')
  }
  const coveredBarCount = elapsedBeats === 0 ? 0 : Math.max(1, Math.ceil(elapsedBeats / 4))
  const endBarIndex = startBarIndex + coveredBarCount
  if (endBarIndex > MAX_BARS_PER_CHART) {
    throw new Error(`A recording cannot extend a chart beyond ${MAX_BARS_PER_CHART} bars.`)
  }
  // Bound work before looking at individual notes. The backup's shared item
  // limit below additionally includes all retained chords, bars, and charts.
  if (!Array.isArray(notes) || notes.length > MAX_MELODY_NOTES_PER_BAR * Math.max(1, coveredBarCount)) {
    throw new Error('This recording contains too many melody notes.')
  }
  if (elapsedBeats === 0) return chart

  const replacement: MelodyNote[][] = Array.from({ length: coveredBarCount }, () => [])
  for (const note of notes) {
    if (typeof note !== 'object' || note === null) throw new Error('A recorded melody note must be an object.')
    midiPitch(note.pitch)
    if (!Number.isFinite(note.startBeat) || note.startBeat < 0 || note.startBeat > MAX_MELODY_DURATION_BEATS) {
      throw new Error('A recorded melody onset must be a finite, nonnegative number of beats within the chart limit.')
    }
    if (!Number.isFinite(note.duration) || note.duration <= 0 || note.duration > MAX_MELODY_DURATION_BEATS) {
      throw new Error(`A recorded melody duration must be positive and at most ${MAX_MELODY_DURATION_BEATS} beats.`)
    }
    if (!Number.isFinite(note.velocity) || note.velocity < 0 || note.velocity > 1) {
      throw new Error('A recorded melody velocity must be a finite number from 0 to 1.')
    }
    // An attack at the stop boundary belongs to a later take, not this one.
    if (note.startBeat >= elapsedBeats) continue
    const index = Math.floor(note.startBeat / 4)
    if (replacement[index].length >= MAX_MELODY_NOTES_PER_BAR) {
      throw new Error(`A bar can contain at most ${MAX_MELODY_NOTES_PER_BAR} melody notes.`)
    }
    replacement[index].push({
      id: makeId(),
      pitch: note.pitch,
      offset: note.startBeat - index * 4,
      duration: Math.min(note.duration, elapsedBeats - note.startBeat),
      velocity: note.velocity,
    })
  }
  for (const melody of replacement) melody.sort((a, b) => a.offset - b.offset)

  const startBeat = startBarIndex * 4
  const bars: Bar[] = Array.from({ length: Math.max(chart.bars.length, endBarIndex) }, (_, index) => {
    const original = chart.bars[index] ?? { id: makeId(), chords: [] }
    if (index >= startBarIndex && index < endBarIndex) {
      return { ...original, melody: replacement[index - startBarIndex] }
    }
    if (index >= startBarIndex || !original.melody?.length) return original
    let clipped = false
    const melody = original.melody.map(note => {
      const availableBeats = startBeat - (index * 4 + note.offset)
      if (note.duration <= availableBeats) return note
      clipped = true
      return { ...note, duration: availableBeats }
    })
    return clipped ? { ...original, melody } : original
  })
  const result = { ...chart, bars }
  // This also enforces the overall import/save item and file-size limits before
  // callers commit the result, while preserving existing metadata and note IDs.
  serializeCharts([result])
  return result
}
