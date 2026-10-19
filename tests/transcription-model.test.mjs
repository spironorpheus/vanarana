import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  QUALITIES, KEYS, STORAGE_KEY, STORAGE_VERSION, MAX_IMPORT_CHARACTERS,
  MAX_CHARTS, MAX_BARS_PER_CHART, MAX_CHORDS_PER_BAR,
  makeId, createChart, degreeName, noteName, chordLabel, chordMidi,
  parseCharts, serializeCharts, loadCharts, saveCharts,
} from '../src/transcription/model.ts'

const chord = (overrides = {}) => ({ id: 'chord-1', root: 0, quality: 'major', ...overrides })
const chart = (overrides = {}) => ({
  id: 'chart-1', name: 'Afternoon sketch', sourceKey: 2,
  bars: [{ id: 'bar-1', section: 'Verse', time: '0:12', chords: [chord({ bass: 4 })] }],
  ...overrides,
})
const envelope = charts => JSON.stringify({ version: STORAGE_VERSION, charts })
const malformedChord = overrides => envelope([chart({ bars: [{ id: 'bar-1', chords: [chord(overrides)] }] })])

function memoryStorage(initial = null) {
  const values = new Map(initial === null ? [] : [[STORAGE_KEY, initial]])
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

test('charts begin with four empty bars and unique, stable IDs', () => {
  const first = createChart('  New song  ')
  const second = createChart()
  assert.equal(first.name, 'New song')
  assert.equal(first.sourceKey, 0)
  assert.equal(first.bars.length, 4)
  assert.ok(first.bars.every(bar => bar.chords.length === 0))
  assert.equal(second.name, 'Untitled chart')
  assert.equal(createChart('  ').name, 'Untitled chart')
  const ids = [first.id, ...first.bars.map(bar => bar.id), second.id, ...second.bars.map(bar => bar.id), makeId()]
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(parseCharts(serializeCharts([first, second])), [first, second])
  assert.throws(() => createChart('x'.repeat(161)), /160/)
})

test('degree labels include exactly the twelve requested chromatic choices', () => {
  assert.deepEqual(Array.from({ length: 12 }, (_, index) => degreeName(index)),
    ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'])
  assert.equal(KEYS.length, 12)
  for (const invalid of [-1, 12, 0.5, NaN, Infinity, '0', null]) {
    assert.throws(() => degreeName(invalid), /0 to 11/)
    assert.throws(() => noteName(0, invalid), /0 to 11/)
  }
})

test('letter notes follow target-key spelling while relative degrees remain unchanged', () => {
  assert.equal(noteName(0, 1), 'Db')
  assert.equal(noteName(4, 2), 'F#')
  assert.equal(noteName(11, 7), 'F#')
  assert.equal(noteName(7, 10), 'F')
  assert.equal(noteName(5, 6), 'Cb')
  assert.equal(noteName(1, 1), 'Ebb')
  const input = chord({ root: 7, quality: 'dominant', bass: 11 })
  assert.equal(chordLabel(input, 'degrees', 0), '57/7')
  assert.equal(chordLabel(input, 'degrees', 2), '57/7')
  assert.equal(chordLabel(input, 'letters', 0), 'G7/B')
  assert.equal(chordLabel(input, 'letters', 2), 'A7/C#')
  assert.deepEqual(input, chord({ root: 7, quality: 'dominant', bass: 11 }))
})

test('quality choices use the five exact baseline suffixes and correct intervals', () => {
  assert.deepEqual(QUALITIES.map(value => value.id), ['major', 'minor', 'half-diminished', 'diminished7', 'dominant'])
  assert.deepEqual(QUALITIES.map(value => value.suffix), ['', 'm', 'm7b5', 'dim7', '7'])
  assert.deepEqual(QUALITIES.map(value => chordLabel(chord({ quality: value.id }), 'degrees', 0)),
    ['1', '1m', '1m7b5', '1dim7', '17'])
  assert.deepEqual(QUALITIES.map(value => chordMidi(chord({ quality: value.id }), 0)), [
    [60, 64, 67], [60, 63, 67], [60, 63, 66, 70], [60, 63, 66, 69], [60, 64, 67, 70],
  ])
  assert.throws(() => chordLabel(chord({ quality: 'major7' }), 'degrees', 0), /quality/)
})

test('fixed MIDI voicings transpose, preserve chord intervals, and put slash bass below', () => {
  assert.deepEqual(chordMidi(chord(), 2), [62, 66, 69])
  assert.deepEqual(chordMidi(chord({ root: 11 }), 2), [61, 65, 68])
  assert.deepEqual(chordMidi(chord({ bass: 4 }), 0), [52, 60, 64, 67])
  assert.deepEqual(chordMidi(chord({ bass: 0 }), 0), [48, 60, 64, 67])
  for (let key = 0; key < 12; key++) {
    for (let root = 0; root < 12; root++) {
      for (const quality of QUALITIES) {
        const midi = chordMidi(chord({ root, quality: quality.id }), key)
        assert.deepEqual(midi.map(note => note - midi[0]), quality.intervals)
        assert.equal(midi[0] % 12, (key + root) % 12)
        for (let bass = 0; bass < 12; bass++) {
          const slash = chordMidi(chord({ root, quality: quality.id, bass }), key)
          assert.deepEqual(slash.slice(1), midi)
          assert.equal(slash[0] % 12, (key + bass) % 12)
          assert.ok(slash[0] < slash[1])
          assert.ok(slash.every(note => Number.isInteger(note) && note >= 0 && note <= 127))
        }
      }
    }
  }
})

test('exports a versioned list and round-trips chart metadata, order, and slash bass', () => {
  const second = chart({ id: 'chart-2', name: 'Another chart', sourceKey: 11, bars: [] })
  const original = [chart(), second]
  const json = serializeCharts(original)
  assert.equal(JSON.parse(json).version, STORAGE_VERSION)
  const imported = parseCharts(json)
  assert.deepEqual(imported, original)
  assert.notEqual(imported[0], original[0])
  assert.notEqual(imported[0].bars, original[0].bars)
  assert.deepEqual(parseCharts(serializeCharts([])), [])
})

test('unrecognized properties cannot survive an import or pollute object prototypes', () => {
  const original = JSON.parse(envelope([chart()]))
  original.charts[0].untrusted = { dangerous: true }
  original.charts[0].bars[0].unexpected = 'ignored'
  original.charts[0].bars[0].chords[0].constructor = { prototype: { polluted: true } }
  const json = JSON.stringify(original).replace('"version":1', '"__proto__":{"polluted":true},"version":1')
  assert.deepEqual(parseCharts(json), [chart()])
  assert.equal({}.polluted, undefined)
})

test('rejects malformed JSON, incompatible versions, and malformed chart structures', () => {
  for (const json of ['', '{', 'not json']) assert.throws(() => parseCharts(json), /valid JSON/)
  for (const value of [null, [], 1]) assert.throws(() => parseCharts(JSON.stringify(value)), /object/)
  for (const version of [undefined, '1', 0, 2]) {
    assert.throws(() => parseCharts(JSON.stringify({ version, charts: [] })), /version/)
  }
  for (const charts of [null, {}, [null], [chart({ name: '' })], [chart({ bars: null })]]) {
    assert.throws(() => parseCharts(envelope(charts)))
  }
  assert.throws(() => parseCharts(envelope([chart({ bars: [{ id: 'bar-1', chords: null }] })])), /chords/)
  assert.throws(() => parseCharts(envelope([chart({ bars: [{ id: 'bar-1', chords: [null] }] })])), /object/)
})

test('rejects noninteger/out-of-range pitches, invalid qualities, and oversized metadata', () => {
  for (const invalid of [-1, 12, 0.5, null, '3', NaN, Infinity]) {
    assert.throws(() => parseCharts(malformedChord({ root: invalid })), /root/)
    assert.throws(() => parseCharts(malformedChord({ bass: invalid })), /bass/)
    assert.throws(() => parseCharts(envelope([chart({ sourceKey: invalid })])), /source key/)
  }
  assert.throws(() => parseCharts(malformedChord({ root: undefined })), /root/)
  assert.throws(() => parseCharts(malformedChord({ quality: 'major7' })), /quality/)
  assert.throws(() => parseCharts(envelope([chart({ name: 'x'.repeat(161) })])), /160/)
  assert.throws(() => parseCharts(envelope([chart({ name: 'Line\nbreak' })])), /control/)
  for (const metadata of [{ section: 'x'.repeat(121) }, { time: 'x'.repeat(33) }, { time: 5 }]) {
    assert.throws(() => parseCharts(envelope([chart({ bars: [{ id: 'bar-1', chords: [], ...metadata }] })])))
  }
  assert.throws(() => serializeCharts([chart({ sourceKey: NaN })]), /source key/)
})

test('IDs must be nonempty strings and unique across every chart, bar, and chord', () => {
  for (const id of ['', ' ', 1, null, 'leading ', 'x'.repeat(129)]) {
    assert.throws(() => parseCharts(envelope([chart({ id })])), /ID/)
  }
  assert.throws(() => parseCharts(envelope([chart(), chart()])), /Duplicate ID/)
  assert.throws(() => parseCharts(envelope([chart({ bars: [{ id: 'chart-1', chords: [] }] })])), /Duplicate ID/)
  assert.throws(() => parseCharts(malformedChord({ id: 'bar-1' })), /Duplicate ID/)
})

test('import size and per-list limits prevent unbounded chart data', () => {
  assert.throws(() => parseCharts(' '.repeat(MAX_IMPORT_CHARACTERS + 1)), /smaller/)
  assert.throws(() => parseCharts(envelope(Array(MAX_CHARTS + 1).fill(chart()))), /at most/)
  assert.throws(() => parseCharts(envelope([chart({ bars: Array(MAX_BARS_PER_CHART + 1).fill({}) })])), /at most/)
  assert.throws(() => parseCharts(envelope([chart({ bars: [{ id: 'bar-1', chords: Array(MAX_CHORDS_PER_BAR + 1).fill({}) }] })])), /at most/)
})

test('storage read/save is versioned and does not modify unrelated saved application data', () => {
  const storage = memoryStorage()
  storage.setItem('chord-atlas.local-shapes.v1', 'existing shapes')
  assert.deepEqual(loadCharts(storage), { charts: [], error: null })
  assert.deepEqual(saveCharts([chart()], storage), { error: null })
  assert.deepEqual(loadCharts(storage), { charts: [chart()], error: null })
  assert.equal(storage.getItem('chord-atlas.local-shapes.v1'), 'existing shapes')
})

test('malformed saved charts are reported without deleting or overwriting the old value', () => {
  const storage = memoryStorage('{ invalid')
  const result = loadCharts(storage)
  assert.deepEqual(result.charts, [])
  assert.match(result.error, /Unable to read saved charts.*valid JSON/)
  assert.equal(storage.getItem(STORAGE_KEY), '{ invalid')
  assert.ok(saveCharts([chart({ sourceKey: 12 })], storage).error)
  assert.equal(storage.getItem(STORAGE_KEY), '{ invalid')
})

test('blocked storage, throwing accessors, and quota errors return safe failure results', t => {
  assert.match(loadCharts({ getItem() { throw new Error('Storage blocked') } }).error, /Storage blocked/)
  assert.match(saveCharts([chart()], { setItem() { throw new Error('Quota exceeded') } }).error, /Quota exceeded/)
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else delete globalThis.localStorage
  })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Access denied') } })
  assert.match(loadCharts().error, /Access denied/)
  assert.match(saveCharts([chart()]).error, /Access denied/)
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined })
  assert.match(loadCharts().error, /unavailable/)
  assert.match(saveCharts([chart()]).error, /unavailable/)
})


test('tempo is optional for old charts and round-trips with validated bounds', () => {
  const chart = createChart('Tempo')
  assert.equal(parseCharts(serializeCharts([chart]))[0].bpm, undefined)
  for (const bpm of [40, 120, 240]) assert.equal(parseCharts(serializeCharts([{ ...chart, bpm }]))[0].bpm, bpm)
  for (const bpm of [0, 39, 241, 100.5, NaN, Infinity, '120']) assert.throws(() => serializeCharts([{ ...chart, bpm }]), /Tempo/)
})
