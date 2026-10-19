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
  dom.window.scrollTo = () => {}
  const originals = []
  const stub = (prototype, key, value) => { originals.push([prototype, key, prototype[key]]); prototype[key] = value }
  let beat = null, sequence, request
  stub(ChartSequencer.prototype, 'play', async function(chart, key, start, options) {
    sequence = this; request = { chart, key, start, options }; beat = null
    this.onState({ playing: true, barId: start, chordId: null, error: null, countInBeatsRemaining: 4, audioReady: true, elapsedBeats: 0 })
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
    loading: async () => act(async () => sequence.onState({ playing: true, barId: chart.bars[0].id, chordId: null, error: null, countInBeatsRemaining: 4, audioReady: false })),
    ready: async () => act(async () => sequence.onState({ playing: true, barId: chart.bars[0].id, chordId: null, error: null, countInBeatsRemaining: 4, audioReady: true })),
    tick: async value => act(async () => { beat = value; sequence.onState({ playing: true, barId: chart.bars[Math.min(3, Math.floor(value / 4))].id, chordId: null, error: null, audioReady: true, elapsedBeats: value, barIndex: Math.floor(value / 4) }) }),
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
    assert.ok(document.querySelector('[role="dialog"]'), 'recording opens the fullscreen keyboard')
    assert.equal(ui.request().start, ui.chart.bars[1].id)
    assert.deepEqual(ui.request().options, { countIn: true, muteMelody: true, extendForRecording: true, recordingRate: 1 })
    assert.match(document.body.textContent, /Count in: 4/)
    await ui.click(ui.button('Stop recording'))
    assert.deepEqual(ui.saved(), ui.chart)
    assert.equal(document.querySelector('[role="dialog"]'), null)
    assert.equal(document.querySelector('.tx-melody-keyboard'), null, 'keyboard does not take inline chart space')
    assert.equal(document.activeElement, ui.button('Record melody'), 'focus returns after the trigger is re-enabled')
    assert.equal(ui.button('Undo take').disabled, true, 'Undo reserves toolbar space even when no take is available')
  } finally { await ui.close() }
})

test('recording keeps an existing notice unchanged through count-in cancellation and saving a take', async () => {
  const ui = await setup()
  try {
    const input = ui.label('Import transcription backup')
    Object.defineProperty(input, 'files', { configurable: true, value: [{ size: 2, text: async () => '{}' }] })
    await act(async () => input.dispatchEvent(new ui.dom.window.Event('change', { bubbles: true })))
    const notice = document.querySelector('.tx-notice')
    assert.ok(notice, 'an invalid backup creates an existing in-flow notice')
    const noticeText = notice.textContent
    const settings = document.querySelector('.tx-settings')
    const actions = document.querySelector('.tx-chart-actions')
    const speed = ui.label('Recording speed')
    const scrollCalls = []
    Object.defineProperties(ui.dom.window, {
      scrollX: { configurable: true, writable: true, value: 0 },
      scrollY: { configurable: true, writable: true, value: 640 },
    })
    ui.dom.window.scrollTo = options => {
      scrollCalls.push(options)
      ui.dom.window.scrollX = options.left
      ui.dom.window.scrollY = options.top
    }
    const assertNoticeUnchanged = () => {
      assert.equal(document.querySelectorAll('.tx-notice').length, 1, 'recording never adds an in-flow notice')
      assert.equal(document.querySelector('.tx-notice'), notice, 'recording preserves the existing notice element')
      assert.equal(notice.textContent, noticeText, 'recording never replaces the existing notice text')
      assert.equal(document.querySelector('.tx-settings'), settings, 'recording preserves the top settings panel')
      assert.equal(document.querySelector('.tx-chart-actions'), actions, 'recording preserves the action row')
      assert.equal(ui.label('Recording speed'), speed, 'recording preserves the speed selector')
      assert.equal(document.querySelector('.tx-melody-controls'), null)
    }

    await ui.click(ui.label('Select bar 1'))
    for (const saveTake of [false, true]) {
      const trigger = ui.button('Record melody')
      await ui.click(trigger)
      const dialog = document.querySelector('[role="dialog"]')
      assert.ok(dialog)
      assert.equal(dialog.getAttribute('aria-modal'), 'true')
      assert.equal(document.activeElement, ui.button('Stop recording'))
      assert.equal(document.getElementById('root').getAttribute('inert'), '')
      assert.equal(document.body.style.position, 'fixed')
      assert.equal(document.body.style.top, '-640px', 'the modal locks the page at its original scroll position')
      ui.dom.window.scrollY = 0
      assertNoticeUnchanged()
      assert.equal(document.querySelector('.tx-play-status'), null, 'count-in status is confined to the dialog')
      assert.match(dialog.textContent, /Count in: 4/)

      if (saveTake) {
        await ui.tick(0.25)
        await ui.event(ui.label('Play C4'), 'pointerdown')
        await ui.tick(1.25)
        assert.equal(document.querySelector('[role="dialog"]'), dialog, 'the modal stays mounted during recording')
        assertNoticeUnchanged()
        assert.equal(document.querySelector('.tx-play-status'), null, 'recording progress does not add inline chart content')
      }

      await ui.click(ui.button('Stop recording'))
      assertNoticeUnchanged()
      const status = document.querySelector('.tx-sr-only[role="status"]')
      assert.ok(status, 'the recording result has an out-of-flow accessible status')
      assert.equal(status.textContent, saveTake ? 'Melody replaced in 1 bar.' : 'Count-in cancelled. Melody unchanged.')
      assert.equal(document.querySelector('[role="dialog"]'), null)
      assert.equal(document.querySelector('.tx-recording-portal'), null)
      assert.equal(document.querySelector('.tx-melody-keyboard'), null)
      assert.equal(document.getElementById('root').hasAttribute('inert'), false)
      assert.equal(document.getElementById('root').hasAttribute('aria-hidden'), false)
      assert.equal(document.body.style.position, '', 'stopping releases the page scroll lock')
      assert.equal(ui.dom.window.scrollY, 640, 'stopping restores the original chart scroll position')
      assert.deepEqual(scrollCalls.at(-1), { left: 0, top: 640, behavior: 'instant' })
      assert.equal(document.activeElement, trigger, 'focus returns to the re-enabled Record button')
      assert.equal(trigger.disabled, false)
      if (saveTake) {
        assert.equal(ui.saved().bars[0].melody[0].pitch, 60)
        assert.equal(ui.saved().bars[0].melody[0].duration, 1)
      } else assert.deepEqual(ui.saved(), ui.chart)
    }
  } finally { await ui.close() }
})

test('recording results do not insert an in-flow banner when no notice existed', async () => {
  const ui = await setup()
  try {
    await ui.click(ui.label('Select bar 1'))
    for (const saveTake of [false, true]) {
      assert.equal(document.querySelector('.tx-notice'), null)
      await ui.click(ui.button('Record melody'))
      assert.equal(document.querySelector('.tx-notice'), null)
      assert.equal(document.querySelector('.tx-play-status'), null)
      if (saveTake) await ui.tick(0.5)
      await ui.click(ui.button('Stop recording'))
      assert.equal(document.querySelector('.tx-notice'), null, 'the result does not change the chart layout')
      assert.equal(document.querySelector('.tx-sr-only[role="status"]')?.textContent,
        saveTake ? 'Melody replaced in 1 bar.' : 'Count-in cancelled. Melody unchanged.')
      assert.equal(document.activeElement, ui.button('Record melody'))
    }
  } finally { await ui.close() }
})

test('silent take replaces every covered bar, preserves others and supports undo', async () => {
  const ui = await setup()
  try {
    const undo = ui.button('Undo take')
    assert.equal(undo.disabled, true)
    assert.ok(undo.closest('.tx-settings'), 'Undo belongs to the top toolbar before a take is available')
    await ui.click(ui.label('Select bar 2'))
    await ui.click(ui.button('Record melody'))
    assert.equal(ui.button('Undo take'), undo, 'recording does not replace the reserved Undo button')
    assert.equal(undo.disabled, true)
    await ui.tick(4.25)
    await ui.click(ui.button('Stop recording'))
    assert.deepEqual(ui.saved().bars[0].melody, ui.chart.bars[0].melody)
    assert.equal(ui.saved().bars[1].melody?.length ?? 0, 0)
    assert.equal(ui.saved().bars[2].melody?.length ?? 0, 0)
    assert.deepEqual(ui.saved().bars[3].melody, ui.chart.bars[3].melody)
    assert.equal(ui.button('Undo take'), undo)
    assert.equal(undo.disabled, false, 'saving a take enables the existing Undo button')
    await ui.click(ui.button('Record melody'))
    assert.equal(undo.disabled, true, 'a new recording temporarily disables Undo')
    await ui.click(ui.button('Stop recording'))
    assert.equal(ui.button('Undo take'), undo)
    assert.equal(undo.disabled, false, 'cancelling a count-in keeps the prior undo available')
    await ui.click(undo)
    assert.deepEqual(ui.saved(), ui.chart)
    assert.equal(ui.button('Undo take'), undo, 'using Undo keeps the button mounted')
    assert.equal(undo.disabled, true, 'using Undo disables it until another take is saved')
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
    assert.ok(speed.closest('.tx-settings'), 'recording speed is a top-level chart setting')
    assert.ok([...speed.labels].some(label => label.textContent.includes('Recording speed')), 'recording speed has an associated visible label')
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

test('count-in notes sound immediately; only overlapping holds enter the take at beat zero', async () => {
  for (const rate of [1, 0.5]) {
    const ui = await setup()
    try {
      await act(async () => { const field = ui.label('Recording speed'); field.value = String(rate); field.dispatchEvent(new ui.dom.window.Event('change', { bubbles: true })) })
      await ui.click(ui.label('Select bar 1'))
      await ui.click(ui.button('Record melody'))
      assert.equal(ui.label('Play C4').disabled, false, 'ready count-in keys are enabled')
      await ui.event(ui.label('Play C4'), 'pointerdown', 1)
      await ui.event(ui.label('Play C4'), 'pointerup', 1)
      await ui.event(ui.label('Play C4'), 'pointerdown', 2)
      await ui.event(ui.label('Play E4'), 'pointerdown', 3)
      assert.equal(ui.notes.length, 3, 'pre-roll notes are monitored immediately')
      await ui.tick(0)
      assert.equal(ui.notes.length, 3, 'crossing the first beat never reattacks held notes')
      await ui.event(ui.label('Play F4'), 'pointerdown', 4)
      await ui.event(ui.label('Play F4'), 'pointercancel', 4)
      await ui.tick(0.25)
      await ui.event(ui.label('Play C4'), 'pointerup', 2)
      await ui.tick(0.5)
      await ui.event(ui.label('Play E4'), 'pointercancel', 3)
      await ui.tick(0.75)
      await ui.event(ui.label('Play G4'), 'pointerdown', 5)
      await ui.tick(1.25)
      await ui.click(ui.button('Stop recording'))
      assert.deepEqual(ui.saved().bars[0].melody.map(({pitch,offset,duration}) => ({pitch,offset,duration})), [
        { pitch: 60, offset: 0, duration: 0.25 },
        { pitch: 64, offset: 0, duration: 0.5 },
        { pitch: 67, offset: 0.75, duration: 0.5 },
      ], 'count-in-only and zero-duration notes are omitted at both recording speeds')
      assert.equal(ui.request().options.recordingRate, rate)
    } finally { await ui.close() }
  }
})

test('held count-in cancellation keeps prior melody and audio loading alone gates keys', async () => {
  const ui = await setup()
  try {
    await ui.click(ui.label('Select bar 1'))
    await ui.click(ui.button('Record melody'))
    await ui.loading()
    assert.equal(ui.label('Play C4').disabled, true)
    await ui.ready()
    assert.equal(ui.label('Play C4').disabled, false)
    await ui.event(ui.label('Play C4'), 'pointerdown', 1)
    await ui.event(ui.label('Play C4'), 'pointerdown', 2)
    await ui.click(ui.button('Stop recording'))
    assert.deepEqual(ui.saved(), ui.chart)
    assert.equal(ui.button('Undo take').disabled, true)
    assert.equal(ui.notes.length, 2)
  } finally { await ui.close() }
})

test('Escape in the recording dialog saves a held note and restores the chart', async () => {
  const ui = await setup()
  try {
    await ui.click(ui.label('Select bar 1'))
    await ui.click(ui.button('Record melody'))
    await ui.event(ui.label('Play C4'), 'pointerdown', 1)
    await ui.tick(0.75)
    await act(async () => document.querySelector('[role="dialog"]').dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    assert.equal(document.querySelector('[role="dialog"]'), null)
    assert.equal(ui.saved().bars[0].melody[0].offset, 0)
    assert.equal(ui.saved().bars[0].melody[0].duration, 0.75)
    assert.equal(document.querySelector('.tx-melody-keyboard'), null)
  } finally { await ui.close() }
})
