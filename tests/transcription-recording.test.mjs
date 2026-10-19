import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import Transcription from '../src/transcription/Transcription.tsx'
import { ChartSequencer } from '../src/transcription/sequencer.ts'
import { ChordPlayer } from '../src/transcription/player.ts'
import { createChart, parseCharts, serializeCharts } from '../src/transcription/model.ts'

async function setup() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.example', pretendToBeVisual: true })
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'localStorage']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const originals = []
  const stub = (prototype, key, value) => { originals.push([prototype, key, prototype[key]]); prototype[key] = value }
  let beat = null, sequence, request
  stub(ChartSequencer.prototype, 'play', async function(chart, key, start, options) {
    sequence = this; request = { chart, key, start, options }; beat = null
    this.onState({ playing: true, barId: start, chordId: null, error: null, countInBeatsRemaining: 4, elapsedBeats: 0 })
  })
  stub(ChartSequencer.prototype, 'getRecordingBeat', () => beat)
  stub(ChartSequencer.prototype, 'stop', function() { this.onState({ playing: false, barId: null, chordId: null, error: null }); beat = null })
  for (const method of ['stop', 'stopMelody', 'stopMelodyNote', 'dispose']) stub(ChordPlayer.prototype, method, () => {})
  const notes = []
  stub(ChordPlayer.prototype, 'startMelodyNote', async (id, pitch) => { notes.push({ id, pitch }) })
  const chart = createChart('Recorded melody')
  chart.bars.forEach((bar, i) => { bar.melody = [{ id: `old-${i}`, pitch: 60 + i, offset: 0, duration: 1, velocity: 0.8 }] })
  localStorage.setItem('vanarana.transcriptions.v1', serializeCharts([chart]))
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(Transcription, { active: true })))
  const label = value => document.querySelector(`[aria-label="${value}"]`)
  const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text)
  const click = async target => { assert.ok(target); await act(async () => target.click()) }
  const event = async (target, type, id = 1) => act(async () => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true })
    Object.defineProperties(event, { pointerId: { value: id }, button: { value: 0 } })
    target.dispatchEvent(event)
  })
  return { dom, chart, label, button, click, event, notes, request: () => request,
    saved: () => parseCharts(localStorage.getItem('vanarana.transcriptions.v1'))[0],
    tick: async value => act(async () => { beat = value; sequence.onState({ playing: true, barId: chart.bars[Math.min(3, Math.floor(value / 4))].id, chordId: null, error: null, elapsedBeats: value, barIndex: Math.floor(value / 4) }) }),
    hide: async () => act(async () => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new dom.window.Event('visibilitychange')) }),
    navigate: async () => act(async () => root.render(React.createElement(Transcription, { active: false }))),
    close: async () => { await act(async () => root.unmount()); originals.reverse().forEach(([p,k,v]) => { p[k] = v }); dom.window.close() },
  }
}

test('recording starts selected bar with count-in; cancellation leaves melody unchanged', async () => {
  const ui = await setup()
  try {
    await ui.click(ui.label('Select bar 2'))
    await ui.click(ui.button('Record melody'))
    assert.equal(ui.request().start, ui.chart.bars[1].id)
    assert.deepEqual(ui.request().options, { countIn: true, muteMelody: true, extendForRecording: true, recordingRate: 1 })
    assert.match(document.body.textContent, /Count in: 4/)
    await ui.click(ui.button('Stop recording'))
    assert.deepEqual(ui.saved(), ui.chart)
    assert.equal(ui.button('Undo take'), undefined)
  } finally { await ui.close() }
})

test('silent take replaces every covered bar, preserves others and supports undo', async () => {
  const ui = await setup()
  try {
    await ui.click(ui.label('Select bar 2'))
    await ui.click(ui.button('Record melody'))
    await ui.tick(4.25)
    await ui.click(ui.button('Stop recording'))
    assert.deepEqual(ui.saved().bars[0].melody, ui.chart.bars[0].melody)
    assert.equal(ui.saved().bars[1].melody?.length ?? 0, 0)
    assert.equal(ui.saved().bars[2].melody?.length ?? 0, 0)
    assert.deepEqual(ui.saved().bars[3].melody, ui.chart.bars[3].melody)
    await ui.click(ui.button('Record melody'))
    await ui.click(ui.button('Stop recording'))
    assert.ok(ui.button('Undo take'), 'cancelling a count-in keeps the prior undo available')
    await ui.click(ui.button('Undo take'))
    assert.deepEqual(ui.saved(), ui.chart)
  } finally { await ui.close() }
})

test('background and navigation save partial recording instead of discarding it', async () => {
  for (const action of ['hide', 'navigate']) {
    const ui = await setup()
    try {
      await ui.click(ui.label('Select bar 1'))
      await ui.click(ui.button('Record melody'))
      await ui.tick(1.1)
      await ui[action]()
      assert.equal(ui.saved().bars[0].melody?.length ?? 0, 0)
      assert.deepEqual(ui.saved().bars[1].melody, ui.chart.bars[1].melody)
    } finally { await ui.close() }
  }
})

test('multitouch notes retain audio-clock durations, held notes close on stop and borders mark melody', async () => {
  const ui = await setup()
  try {
    await ui.click(ui.label('Select bar 1'))
    await ui.click(ui.button('Record melody'))
    await ui.tick(0.25)
    await ui.event(ui.label('Play C4'), 'pointerdown', 11)
    await ui.tick(0.75)
    await ui.event(ui.label('Play E4'), 'pointerdown', 22)
    await ui.tick(1.25)
    await ui.event(ui.label('Play C4'), 'pointerup', 11)
    await ui.tick(4.5)
    await ui.click(ui.button('Stop recording'))
    const saved = ui.saved()
    assert.deepEqual(saved.bars[0].melody.map(({pitch,offset,duration}) => ({pitch,offset,duration})), [
      { pitch: 60, offset: 0.25, duration: 1 },
      { pitch: 64, offset: 0.75, duration: 3.75 },
    ])
    assert.equal(saved.bars[1].melody.length, 0, 'cross-bar hold has one attack stored in first bar')
    assert.ok(document.querySelector('[aria-label="Bar 1 editor"]').classList.contains('has-melody'))
    assert.ok(ui.label('Select bar 2').classList.contains('has-melody'), 'held tail marks covered bar too')
    assert.equal(ui.notes.length, 2)
    assert.equal(saved.bars.length, 4, 'an earlier take does not expand an untouched filled last bar')
  } finally { await ui.close() }
})

test('recording in a rendered key stores source-key pitch and reference changes transpose it', async () => {
  const ui = await setup()
  const select = async (label, value) => act(async () => { const field = ui.label(label); field.value = value; field.dispatchEvent(new ui.dom.window.Event('change', { bubbles: true })) })
  try {
    await select('Notation', 'letters')
    await select('Render and play in', '2')
    await ui.click(ui.label('Select bar 1'))
    await ui.click(ui.button('Record melody'))
    await ui.tick(0)
    await ui.event(ui.label('Play E4'), 'pointerdown')
    await ui.tick(1)
    await ui.click(ui.button('Stop recording'))
    assert.equal(ui.saved().bars[0].melody[0].pitch, 62, 'heard E in D major is stored as source-key D')
    await select('Major-key reference', '5')
    assert.equal(ui.saved().bars[0].melody[0].pitch, 67, 'changing source tonic preserves relative melody')
  } finally { await ui.close() }
})

test('an over-limit take leaves saved data intact and exposes explicit recovery instead of losing notes', async () => {
  const ui = await setup()
  try {
    await ui.click(ui.label('Select bar 1'))
    await ui.click(ui.button('Record melody'))
    await ui.tick(4001)
    await ui.click(ui.button('Stop recording'))
    assert.deepEqual(ui.saved(), ui.chart)
    assert.ok(ui.button('Download take'))
    assert.ok(ui.button('Discard take'))
    await ui.click(ui.button('Discard take'))
    assert.equal(ui.button('Download take'), undefined)
    assert.deepEqual(ui.saved(), ui.chart)
  } finally { await ui.close() }
})

test('a recording can extend past the chart and adds a working block without losing held tails', async () => {
  const ui = await setup()
  try {
    await ui.click(ui.label('Select bar 4'))
    await ui.click(ui.button('Record melody'))
    await ui.tick(0)
    await ui.event(ui.label('Play C4'), 'pointerdown')
    await ui.tick(4.25)
    await ui.click(ui.button('Stop recording'))
    assert.equal(ui.saved().bars.length, 13, 'five covered bars plus eight working blanks')
    assert.equal(ui.saved().bars[3].melody[0].duration, 4.25)
    assert.ok(ui.label('Select bar 5').classList.contains('has-melody'))
    assert.ok(ui.saved().bars.slice(5).every(bar => !bar.chords.length && !bar.melody?.length))
  } finally { await ui.close() }
})

test('half-speed choice persists, locks during recording and never changes ordinary playback tempo', async () => {
  const ui = await setup()
  try {
    const speed = ui.label('Recording speed')
    assert.equal(speed.value, '1')
    await act(async () => { speed.value = '0.5'; speed.dispatchEvent(new ui.dom.window.Event('change', { bubbles: true })) })
    assert.equal(ui.saved().recordingRate, 0.5)
    assert.equal(ui.saved().bpm, undefined)
    await ui.click(ui.label('Select bar 2'))
    await ui.click(ui.button('Record melody'))
    assert.equal(ui.request().options.recordingRate, 0.5)
    assert.equal(speed.disabled, true)
    await ui.tick(3.5)
    await ui.event(ui.label('Play C4'), 'pointerdown')
    await ui.tick(4.5)
    await ui.click(ui.button('Stop recording'))
    assert.equal(ui.saved().bars[1].melody[0].offset, 3.5)
    assert.equal(ui.saved().bars[1].melody[0].duration, 1, 'saved musical beats are not rescaled twice')
    assert.equal(ui.saved().bars[2].melody.length, 0, 'covered second bar is replaced')
    assert.equal(ui.saved().recordingRate, 0.5)
    assert.equal(ui.saved().bpm, undefined)
    assert.equal(ui.label('Recording speed').disabled, false)
    await ui.click(ui.button('Play from bar 2'))
    assert.equal(ui.request().options, undefined, 'normal Play does not receive the recording speed')
    assert.equal(ui.request().chart.bpm, undefined)
  } finally { await ui.close() }
})
