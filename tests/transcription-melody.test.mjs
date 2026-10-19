import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_BARS_PER_CHART, MAX_MELODY_NOTES_PER_BAR, MAX_MELODY_DURATION_BEATS, parseCharts, serializeCharts } from '../src/transcription/model.ts'
import { replaceMelodyTake, sourceMelodyPitch, transposeMelodyPitch } from '../src/transcription/melody.ts'

const storedNote = (id, overrides = {}) => ({ id, pitch: 60, offset: 0, duration: 1, velocity: 0.8, ...overrides })
const takeNote = (overrides = {}) => ({ pitch: 62, startBeat: 0, duration: 1, velocity: 0.7, ...overrides })
const chart = (length = 4) => ({
  id: 'chart', name: 'Recorded melody', sourceKey: 2, bpm: 96, metronome: false,
  bars: Array.from({ length }, (_, index) => ({
    id: `bar-${index}`, chords: [{ id: `chord-${index}`, root: index % 12, quality: 'major' }],
    section: `Section ${index}`, time: `${index}:00`, melody: [storedNote(`old-${index}`)],
  })),
})
const noteData = note => { const { id, ...data } = note; return data }

test('a take replaces every covered bar including silence and a partial final bar', () => {
  const original = chart()
  const before = structuredClone(original)
  const result = replaceMelodyTake(original, 1, 5, [takeNote({ startBeat: 4.5, duration: 2 })])
  assert.deepEqual(original, before)
  assert.notEqual(result, original)
  assert.equal(result.bars[0], original.bars[0])
  assert.deepEqual(result.bars[1].melody, [])
  assert.deepEqual(result.bars[2].melody.map(noteData), [{ pitch: 62, offset: 0.5, duration: 0.5, velocity: 0.7 }])
  assert.equal(result.bars[3], original.bars[3])
  result.bars.forEach((bar, index) => {
    const { melody, ...metadata } = bar
    const { melody: oldMelody, ...oldMetadata } = original.bars[index]
    assert.deepEqual(metadata, oldMetadata)
  })
  const { bars, ...metadata } = result
  const { bars: oldBars, ...oldMetadata } = original
  assert.deepEqual(metadata, oldMetadata)
  assert.deepEqual(parseCharts(serializeCharts([result])), [result])
})

test('exact bar boundaries preserve the next bar and do not capture a stop-boundary attack', () => {
  const original = chart()
  const result = replaceMelodyTake(original, 1, 4, [takeNote({ startBeat: 4 })])
  assert.deepEqual(result.bars[1].melody, [])
  assert.equal(result.bars[2], original.bars[2])
  const next = replaceMelodyTake(original, 1, 4.001, [takeNote({ startBeat: 4, duration: 0.001 })])
  assert.equal(next.bars[2].melody[0].offset, 0)
  assert.ok(next.bars[2].melody[0].duration > 0)
  assert.equal(next.bars[3], original.bars[3])
})

test('cross-bar sustains are stored once and prior crossing notes are clipped at punch-in', () => {
  const original = chart(5)
  original.bars[0].melody = [storedNote('long', { offset: 1, duration: 15 }), storedNote('short')]
  original.bars[1].melody = [storedNote('ends-at-start', { offset: 2, duration: 2 })]
  const result = replaceMelodyTake(original, 2, 6, [takeNote({ startBeat: 1, duration: 5 })])
  assert.deepEqual(result.bars[0].melody, [storedNote('long', { offset: 1, duration: 7 }), storedNote('short')])
  assert.equal(result.bars[0].melody[1], original.bars[0].melody[1])
  assert.equal(result.bars[1], original.bars[1])
  assert.deepEqual(result.bars[2].melody.map(noteData), [{ pitch: 62, offset: 1, duration: 5, velocity: 0.7 }])
  assert.deepEqual(result.bars[3].melody, [])
  assert.equal(result.bars[4], original.bars[4])
  assert.equal(original.bars[0].melody[0].duration, 15)
})

test('recording silence removes all old melody onsets in covered bars', () => {
  const original = chart()
  original.bars[0].melody = [storedNote('held', { duration: 10 })]
  original.bars[2].melody = [storedNote('late', { offset: 3, duration: 1 })]
  const result = replaceMelodyTake(original, 1, 4.25, [])
  assert.equal(result.bars[0].melody[0].duration, 4)
  assert.deepEqual(result.bars[1].melody, [])
  assert.deepEqual(result.bars[2].melody, [])
  assert.equal(result.bars[3], original.bars[3])
})

test('a zero-length take is a no-op and tiny positive takes still cover a bar', () => {
  const original = chart()
  assert.equal(replaceMelodyTake(original, 0, 0, []), original)
  assert.equal(replaceMelodyTake(original, 0, 0, [takeNote()]), original)
  const result = replaceMelodyTake(original, 0, Number.MIN_VALUE, [])
  assert.deepEqual(result.bars[0].melody, [])
  assert.equal(result.bars[1], original.bars[1])
})

test('take extension creates only needed bars, including for an empty legacy chart', () => {
  const original = chart(2)
  const result = replaceMelodyTake(original, 1, 8.25, [takeNote({ startBeat: 7.75, duration: 0.5 })])
  assert.equal(result.bars.length, 4)
  assert.equal(result.bars[0], original.bars[0])
  assert.deepEqual(result.bars[2].chords, [])
  assert.deepEqual(result.bars[3].chords, [])
  assert.equal(result.bars[2].melody[0].offset, 3.75)
  assert.equal(result.bars[2].melody[0].duration, 0.5)
  assert.deepEqual(result.bars[3].melody, [])
  const empty = chart(0)
  const first = replaceMelodyTake(empty, 0, 0.5, [takeNote()])
  assert.equal(first.bars.length, 1)
  assert.deepEqual(first.bars[0].chords, [])
  assert.equal(first.bars[0].melody[0].duration, 0.5)
  assert.deepEqual(empty.bars, [])
  const append = replaceMelodyTake(original, 2, 4, [])
  assert.equal(append.bars.length, 3)
  assert.deepEqual(append.bars[2].melody, [])
  const ids = [result.id, ...result.bars.flatMap(bar => [bar.id, ...bar.chords.map(note => note.id), ...bar.melody.map(note => note.id)])]
  assert.equal(new Set(ids).size, ids.length)
})

test('take notes are placed by onset, stably sorted, and retain polyphonic velocity', () => {
  const result = replaceMelodyTake(chart(), 0, 8, [
    takeNote({ startBeat: 5, pitch: 70, velocity: 1 }),
    takeNote({ startBeat: 2, pitch: 67, velocity: 0 }),
    takeNote({ startBeat: 0.25, pitch: 60, velocity: 0.2 }),
    takeNote({ startBeat: 2, pitch: 64, velocity: 0.5 }),
  ])
  assert.deepEqual(result.bars[0].melody.map(note => [note.offset, note.pitch, note.velocity]), [[0.25, 60, 0.2], [2, 67, 0], [2, 64, 0.5]])
  assert.deepEqual(result.bars[1].melody.map(note => [note.offset, note.pitch, note.velocity]), [[1, 70, 1]])
})

test('recording limits fail without mutating the chart or silently dropping a take', () => {
  const original = chart(1)
  const before = structuredClone(original)
  for (const start of [-1, 0.5, 2, MAX_BARS_PER_CHART, Infinity, NaN]) {
    assert.throws(() => replaceMelodyTake(original, start, 1, []), /bar/)
  }
  for (const elapsed of [-1, Infinity, NaN, '1', null]) {
    assert.throws(() => replaceMelodyTake(original, 0, elapsed, []), /duration/)
  }
  assert.throws(() => replaceMelodyTake(original, 0, 4001, []), /1000 bars/)
  assert.throws(() => replaceMelodyTake(original, 0, 1, null), /too many/)
  assert.throws(() => replaceMelodyTake(original, 0, 1, Array(MAX_MELODY_NOTES_PER_BAR + 1).fill(takeNote())), /too many/)
  assert.throws(() => replaceMelodyTake(original, 0, 8, Array(MAX_MELODY_NOTES_PER_BAR + 1).fill(takeNote())), /at most 256/)
  for (const note of [
    null, { ...takeNote(), pitch: -1 }, { ...takeNote(), pitch: 128 }, { ...takeNote(), pitch: 60.5 },
    { ...takeNote(), startBeat: -1 }, { ...takeNote(), startBeat: NaN }, { ...takeNote(), startBeat: Infinity },
    { ...takeNote(), duration: 0 }, { ...takeNote(), duration: Infinity }, { ...takeNote(), duration: MAX_MELODY_DURATION_BEATS + 1 },
    { ...takeNote(), velocity: -0.1 }, { ...takeNote(), velocity: 1.1 }, { ...takeNote(), velocity: NaN },
  ]) assert.throws(() => replaceMelodyTake(original, 0, 1, [note]))
  assert.deepEqual(original, before)
  const maximum = replaceMelodyTake(chart(0), 0, MAX_BARS_PER_CHART * 4, [])
  assert.equal(maximum.bars.length, MAX_BARS_PER_CHART)
  const lastBar = replaceMelodyTake(maximum, 999, 4, [takeNote({ startBeat: 3.5 })])
  assert.equal(lastBar.bars[999].melody[0].duration, 0.5)
  assert.throws(() => replaceMelodyTake(maximum, 999, 4.001, []), /1000 bars/)
})

test('take replacement enforces the shared storage item limit', () => {
  const original = chart(0)
  const notes = Array.from({ length: 25_000 }, (_, index) => takeNote({ startBeat: Math.floor(index / 250) * 4 }))
  assert.throws(() => replaceMelodyTake(original, 0, 400, notes), /25000-item limit/)
  assert.deepEqual(original.bars, [])
})

test('melody pitch helpers preserve register and invert transposition into the source key', () => {
  assert.equal(transposeMelodyPitch(62, 2, 5), 65)
  assert.equal(sourceMelodyPitch(65, 2, 5), 62)
  assert.equal(transposeMelodyPitch(71, 11, 0), 60)
  assert.equal(sourceMelodyPitch(60, 11, 0), 71)
  for (let source = 0; source < 12; source++) {
    for (let target = 0; target < 12; target++) {
      for (const pitch of [24, 60, 72, 95]) {
        assert.equal(sourceMelodyPitch(transposeMelodyPitch(pitch, source, target), source, target), pitch)
      }
    }
  }
  for (const pitch of [-1, 128, 1.5, NaN, Infinity, '60']) {
    assert.throws(() => transposeMelodyPitch(pitch, 0, 0), /MIDI/)
    assert.throws(() => sourceMelodyPitch(pitch, 0, 0), /MIDI/)
  }
  for (const key of [-1, 12, 1.5, NaN, Infinity, '0']) {
    assert.throws(() => transposeMelodyPitch(60, key, 0), /keys/)
    assert.throws(() => sourceMelodyPitch(60, 0, key), /keys/)
  }
  assert.throws(() => transposeMelodyPitch(127, 0, 1), /MIDI/)
  assert.throws(() => transposeMelodyPitch(0, 1, 0), /MIDI/)
  assert.throws(() => sourceMelodyPitch(0, 0, 1), /MIDI/)
  assert.throws(() => sourceMelodyPitch(127, 1, 0), /MIDI/)
})
