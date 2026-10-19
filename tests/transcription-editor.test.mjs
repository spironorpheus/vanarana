import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import Transcription from '../src/transcription/Transcription.tsx'
import { createChart, serializeCharts, parseCharts, MAX_BARS_PER_CHART, MAX_IMPORT_CHARACTERS } from '../src/transcription/model.ts'

test('inline bar editor supports focus, audition-only, slash edits, transposition and persistence', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.example', pretendToBeVisual: true })
  const { window } = dom
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'localStorage']) Object.defineProperty(globalThis, name, { configurable: true, value: window[name] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const chart = createChart('Lustrous Stars')
  chart.bars[0].section = 'Legacy introduction'
  chart.bars[0].time = '0:42'
  localStorage.setItem('vanarana.transcriptions.v1', serializeCharts([chart]))
  // Initialize React's DOM support after jsdom exists so autofocus uses native input events.
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  const click = async element => { assert.ok(element); await act(async () => element.click()) }
  const byLabel = label => document.querySelector(`[aria-label="${label}"]`)
  const byText = text => [...document.querySelectorAll('button')].find(item => item.textContent === text)
  const select = async (label, value) => act(async () => { const element = byLabel(label); element.value = value; element.dispatchEvent(new window.Event('change', { bubbles: true })) })
  const saved = () => parseCharts(localStorage.getItem('vanarana.transcriptions.v1'))[0]
  const enter = async (text, cursor = text.length) => act(async () => {
    const field = byLabel('Bar chord text')
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(field, text)
    field.setSelectionRange(cursor, cursor)
    field.dispatchEvent(new window.Event('input', { bubbles: true }))
    field.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
  const pressEditorKey = async key => act(async () => {
    byLabel('Bar chord text').dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
  const assertLegacyHidden = () => {
    assert.equal(document.querySelector('.tx-section'), null)
    assert.equal(document.querySelector('input[placeholder="Intro"]'), null)
    assert.equal(document.querySelector('input[placeholder="0:00"]'), null)
    assert.equal(document.querySelector('.tx-bars').textContent.includes('Legacy introduction'), false)
    assert.equal(document.querySelector('.tx-bars').textContent.includes('0:42'), false)
  }
  try {
    await act(async () => root.render(React.createElement(Transcription, { active: true })))
    assert.equal(document.querySelectorAll('.tx-grid tbody tr').length, 12)
    assert.equal(document.querySelectorAll('.tx-grid td button').length, 60)
    assert.equal(byLabel('Select bar 1').textContent.includes('Bar 1'), false, 'compact bars have no separate titles')
    assertLegacyHidden()
    await click(byLabel('Play 1'))
    assert.equal(saved().bars[0].chords.length, 0)
    await click(byLabel('Select bar 1'))
    const field = byLabel('Bar chord text')
    assert.equal(document.activeElement, field, 'selecting a bar focuses its inline editor')
    assert.equal(field.closest('.tx-bar'), byLabel('Bar 1 editor'))
    assert.ok(field.closest('.tx-bar').classList.contains('is-selected'))
    assert.equal(document.querySelectorAll('.tx-bars textarea').length, 1)
    assert.equal(document.querySelector('.tx-edit'), null, 'there is no detached editor panel')
    assert.equal(byLabel('Select bar 1'), null, 'the selected bar becomes the editor')
    assert.match(field.getAttribute('aria-describedby').split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' '), /scale[ -]degrees?/i)
    assert.ok(byText('Done editing').closest('.tx-chart-actions'))
    assert.equal(byText('Remove bar'), undefined)
    assert.equal(byText('+ Add bar'), undefined)
    assert.equal(byText('Undo removal'), undefined)
    assert.equal(byText('Move earlier'), undefined)
    assert.equal(byText('Move later'), undefined)
    assertLegacyHidden()
    await click(byLabel('Play and add 1'))
    await click(byLabel('Play and add 6m'))
    assert.equal(saved().bars[0].chords.length, 2)
    assert.notDeepEqual([field.selectionStart, field.selectionEnd], [0, field.value.length], 'appending grid chords does not select all text')
    await enter('1 . 5/7 6m', 4)
    assert.equal(byLabel('Bar chord text'), field, 'typing does not replace the focused editor')
    assert.equal(document.activeElement, field)
    assert.deepEqual([field.selectionStart, field.selectionEnd], [4, 4], 'typing preserves the ordinary insertion cursor')
    field.setSelectionRange(2, 2)
    await act(async () => root.render(React.createElement(Transcription, { active: true })))
    assert.equal(byLabel('Bar chord text'), field)
    assert.deepEqual([field.selectionStart, field.selectionEnd], [2, 2], 'rerendering an existing editor does not select its text again')
    await act(async () => {
      field.blur()
      field.setSelectionRange(3, 3)
      field.focus()
      field.click()
    })
    assert.deepEqual([field.selectionStart, field.selectionEnd], [3, 3], 'refocusing or clicking an existing editor permits ordinary caret placement')
    assert.equal(saved().bars[0].chords.length, 4)
    assert.equal(saved().bars[0].chords[1].hold, true)
    assert.equal(saved().bars[0].chords[2].bass, 11)
    assert.equal(saved().bars[0].section, 'Legacy introduction', 'hidden legacy section metadata survives text edits')
    assert.equal(saved().bars[0].time, '0:42', 'hidden legacy timing metadata survives text edits')
    await select('Notation', 'letters')
    await select('Render and play in', '2')
    assert.equal(byLabel('Bar chord text').value, '1 . 5/7 6m', 'inline editing always uses degree syntax')
    assert.equal(byLabel('Bar 1 editor').querySelector('.tx-bar-entries').getAttribute('aria-hidden'), 'true', 'the layout-preserving chord rendering is hidden from assistive technology')
    await click(byText('Done editing'))
    assert.equal(byLabel('Bar chord text'), null)
    assert.match(byLabel('Select bar 1').textContent, /A\/C#\s+Bm/)
    assertLegacyHidden()
    await click(byLabel('Select bar 1'))
    assert.equal(byLabel('Bar chord text').value, '1 . 5/7 6m', 'reopening a transposed bar restores its degree text')
    assert.equal(document.activeElement, byLabel('Bar chord text'))
    assert.deepEqual([byLabel('Bar chord text').selectionStart, byLabel('Bar chord text').selectionEnd], [0, '1 . 5/7 6m'.length], 'entering a nonempty bar editor selects all text for replacement')
    await enter('1 . 5/')
    assert.equal(byLabel('Bar chord text').getAttribute('aria-invalid'), 'true')
    assert.equal(saved().bars[0].chords.length, 4, 'invalid partial input never overwrites saved entries')
    await click(byLabel('Select bar 2'))
    assert.equal(document.querySelector('.tx-bar.is-selected'), byLabel('Bar 1 editor'), 'cannot silently discard invalid text by selecting another bar')
    assert.equal(byLabel('Bar chord text').value, '1 . 5/')
    await click(byText('Done editing'))
    assert.ok(byLabel('Bar 1 editor'), 'cannot silently discard invalid text by ending editing')
    for (const key of ['Enter', 'Escape']) {
      await pressEditorKey(key)
      assert.equal(byLabel('Bar chord text').value, '1 . 5/', `${key} cannot discard an unfinished edit`)
    }
    assert.equal(saved().bars.length, 4, 'unfinished text does not change the bar count')
    assert.match(document.querySelector('[role="status"]').textContent, /Finish the bar text or discard the unfinished edit first/)
    await click(byText('Discard unfinished edit'))
    assert.equal(byLabel('Bar chord text').value, '1 . 5/7 6m')
    assert.equal(byLabel('Bar chord text').getAttribute('aria-invalid'), 'false')
    assert.equal(document.getElementById('tx-text-error'), null, 'discarding unfinished text removes its error message')
    assert.equal(byLabel('Bar chord text').getAttribute('aria-describedby').includes('tx-text-error'), false)
    assert.equal(document.querySelector('[role="status"]')?.textContent.includes('Finish the bar text') ?? false, false, 'discarding unfinished text clears the stale blocked-action notice')
    await select('Notation', 'degrees')
    byLabel('Bar chord text').setSelectionRange(3, 3)
    await click(byLabel('Play and add 17'))
    assert.equal(saved().bars[0].chords.length, 5)
    assert.equal(byLabel('Bar chord text').value, '1 . 5/7 6m 17')
    assert.notDeepEqual([byLabel('Bar chord text').selectionStart, byLabel('Bar chord text').selectionEnd], [0, byLabel('Bar chord text').value.length], 'appending to a nonempty editor never selects all existing text')
    await click(byText('Done editing'))
    assert.equal(saved().bars.length, 4)
    assert.equal(byLabel('Bar chord text'), null)
    assert.equal(saved().bars[0].chords.length, 5)
    assert.equal(saved().bars[0].section, 'Legacy introduction')
    assert.equal(saved().bars[0].time, '0:42')
    await click(byLabel('Select bar 1'))
    assert.equal(byLabel('Bar chord text').value, '1 . 5/7 6m 17')
    assert.deepEqual([byLabel('Bar chord text').selectionStart, byLabel('Bar chord text').selectionEnd], [0, '1 . 5/7 6m 17'.length], 'reentering the editor selects the complete updated bar text')
    await click(byLabel('Select bar 2'))
    assert.equal(document.activeElement, byLabel('Bar chord text'), 'switching bars focuses the newly selected inline editor')
    assert.equal(byLabel('Bar chord text').closest('.tx-bar'), byLabel('Bar 2 editor'))
    assert.equal(byLabel('Bar chord text').value, '')
    await pressEditorKey('Enter')
    assert.equal(byLabel('Bar chord text'), null, 'Enter finishes a valid inline edit')
    await click(byLabel('Select bar 1'))
    await pressEditorKey('Escape')
    assert.equal(byLabel('Bar chord text'), null, 'Escape finishes a valid inline edit without losing saved chords')
    await click(byLabel('Play 17'))
    assert.equal(saved().bars[0].chords.length, 5, 'auditioning without a selected bar does not append')
    assert.equal(saved().bars[1].chords.length, 0)
    await act(async () => root.render(React.createElement(Transcription, { active: false })))
  } finally { await act(async () => root.unmount()); dom.window.close() }
})

test('corrupt storage is preserved and a visible recovery warning is shown', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.example' })
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'localStorage']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.setItem('vanarana.transcriptions.v1', '{broken')
  // Initialize React's DOM support after jsdom exists so autofocus uses native input events.
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(React.createElement(Transcription, { active: true })))
    assert.match(document.querySelector('[role="status"]').textContent, /could not be read/)
    assert.equal(localStorage.getItem('vanarana.transcriptions.v1'), '{broken')
  } finally { await act(async () => root.unmount()); dom.window.close() }
})

test('chart transport starts at the selected bar, preserves selection and stops on navigation', async () => {
  const { ChordPlayer } = await import('../src/transcription/player.ts')
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.example', pretendToBeVisual: true })
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'localStorage']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const chart = createChart('Transport')
  chart.bars[0].chords = [{ id: 'first-chord', root: 0, quality: 'major' }]
  chart.bars[1].chords = [{ id: 'second-chord', root: 7, quality: 'major' }]
  localStorage.setItem('vanarana.transcriptions.v1', serializeCharts([chart]))
  const original = { prepare: ChordPlayer.prototype.prepare, play: ChordPlayer.prototype.play, stop: ChordPlayer.prototype.stop, startMetronome: ChordPlayer.prototype.startMetronome, stopMetronome: ChordPlayer.prototype.stopMetronome }
  const played = []
  const metronomeStarts = []
  let metronomeStops = 0
  let stops = 0
  ChordPlayer.prototype.prepare = async () => {}
  ChordPlayer.prototype.play = async notes => { played.push(notes) }
  ChordPlayer.prototype.stop = () => { stops++ }
  ChordPlayer.prototype.startMetronome = (bpm, durationSeconds) => { metronomeStarts.push({ bpm, durationSeconds }) }
  ChordPlayer.prototype.stopMetronome = () => { metronomeStops++ }
  // Initialize React's DOM support after jsdom exists so autofocus uses native input events.
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text)
  const click = async element => act(async () => element.click())
  try {
    await act(async () => root.render(React.createElement(Transcription, { active: true })))
    const metronome = document.querySelector('[aria-label="Metronome"]')
    assert.ok(metronome.closest('.tx-settings'))
    assert.equal(metronome.checked, true, 'legacy charts enable the metronome by default')
    await click(document.querySelector('[aria-label="Select bar 2"]'))
    assert.ok(document.querySelector('[aria-label="Bar 2 editor"] textarea'))
    const initialEditor = document.querySelector('[aria-label="Bar chord text"]')
    assert.deepEqual([initialEditor.selectionStart, initialEditor.selectionEnd], [0, initialEditor.value.length], 'the initial mount selects all existing chord text')
    const tempo = document.querySelector('[aria-label="Tempo (BPM)"]')
    await act(async () => { tempo.value = '200'; tempo.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true })) })
    assert.equal(parseCharts(localStorage.getItem('vanarana.transcriptions.v1'))[0].bpm, 200)
    await click(button('Play from bar 2'))
    assert.deepEqual(played[0], [67, 71, 74])
    assert.deepEqual(metronomeStarts, [{ bpm: 200, durationSeconds: 3.6 }], 'playback starts the metronome at the selected tempo for the remaining chart')
    assert.equal(document.querySelector('[aria-label="Bar chord text"]'), null, 'playback shows rendered bars instead of editors')
    assert.equal(document.querySelectorAll('.tx-bar.is-playing').length, 1)
    assert.equal(document.querySelector('.tx-bar.is-playing').getAttribute('aria-label'), 'Select bar 2')
    assert.equal(document.querySelector('.tx-grid button').disabled, true)
    await click(document.querySelector('.tx-grid button'))
    assert.equal(parseCharts(localStorage.getItem('vanarana.transcriptions.v1'))[0].bars[1].chords.length, 1)
    assert.equal(document.querySelector('[aria-label="Select bar 2"]').getAttribute('aria-pressed'), 'true')
    await click(button('Stop playback'))
    assert.equal(document.querySelectorAll('.tx-bar.is-playing').length, 0)
    assert.ok(button('Play from bar 2'))
    assert.ok(document.querySelector('[aria-label="Bar 2 editor"] textarea'), 'stopping playback restores the selected inline editor')
    assert.equal(document.activeElement, document.querySelector('[aria-label="Bar chord text"]'))
    const restoredEditor = document.querySelector('[aria-label="Bar chord text"]')
    assert.deepEqual([restoredEditor.selectionStart, restoredEditor.selectionEnd], [0, restoredEditor.value.length], 'returning from playback selects the restored editor text')
    await click(button('Play from bar 2'))
    assert.equal(metronomeStarts.length, 2)
    const stopsBeforeToggle = metronomeStops
    await click(metronome)
    assert.equal(metronome.checked, false)
    assert.equal(parseCharts(localStorage.getItem('vanarana.transcriptions.v1'))[0].metronome, false, 'the toggle is persisted on the chart')
    assert.equal(document.querySelectorAll('.tx-bar.is-playing').length, 0, 'changing the metronome setting stops active chart playback')
    assert.ok(metronomeStops > stopsBeforeToggle, 'changing the toggle also cancels scheduled metronome beats')
    assert.ok(button('Play from bar 2'))
    await click(button('Play from bar 2'))
    assert.equal(metronomeStarts.length, 2, 'playback with the toggle off does not start another metronome')
    assert.equal(document.querySelectorAll('.tx-bar.is-playing').length, 1, 'the chart still plays when the metronome is off')
    await act(async () => root.render(React.createElement(Transcription, { active: false })))
    assert.equal(document.querySelectorAll('.tx-bar.is-playing').length, 0)
    assert.ok(stops > 0)
    const boundedTempo = document.querySelector('[aria-label="Tempo (BPM)"]')
    await act(async () => { boundedTempo.value = '999'; boundedTempo.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true })) })
    assert.equal(parseCharts(localStorage.getItem('vanarana.transcriptions.v1'))[0].bpm, 240)
  } finally {
    await act(async () => root.unmount())
    Object.assign(ChordPlayer.prototype, original)
    dom.window.close()
  }
})


// Keep the auto-growth checks independent from the editor's broader interaction tests.
async function mountAutoGrowthEditor(charts) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.example', pretendToBeVisual: true })
  const { window } = dom
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'localStorage']) Object.defineProperty(globalThis, name, { configurable: true, value: window[name] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const storageKey = 'vanarana.transcriptions.v1'
  localStorage.setItem(storageKey, serializeCharts(charts))
  const writes = []
  const originalSetItem = window.Storage.prototype.setItem
  window.Storage.prototype.setItem = function (key, value) {
    if (key === storageKey) writes.push(parseCharts(value))
    return originalSetItem.call(this, key, value)
  }
  const { createRoot } = await import('react-dom/client')
  let root = createRoot(document.getElementById('root'))
  const render = async () => act(async () => root.render(React.createElement(Transcription, { active: true })))
  await render()
  writes.length = 0
  const byLabel = label => document.querySelector(`[aria-label="${label}"]`)
  return {
    window,
    writes,
    byLabel,
    saved: () => parseCharts(localStorage.getItem(storageKey)),
    click: async element => { assert.ok(element); await act(async () => element.click()) },
    enter: async (text, cursor = text.length) => act(async () => {
      const field = byLabel('Bar chord text')
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(field, text)
      field.setSelectionRange(cursor, cursor)
      field.dispatchEvent(new window.Event('input', { bubbles: true }))
      field.dispatchEvent(new window.Event('change', { bubbles: true }))
    }),
    reload: async () => {
      await act(async () => root.unmount())
      root = createRoot(document.getElementById('root'))
      await render()
    },
    close: async () => {
      await act(async () => root.unmount())
      window.Storage.prototype.setItem = originalSetItem
      window.close()
    },
  }
}

function assertUniqueChartIds(charts) {
  const ids = charts.flatMap(chart => [chart.id, ...chart.bars.flatMap(bar => [bar.id, ...bar.chords.map(chord => chord.id)])])
  assert.equal(new Set(ids).size, ids.length, 'every chart, bar and chord has a unique ID')
}

test('typing in the current last bar appends exactly eight empty bars atomically and keeps the editor stable', async () => {
  const chart = createChart('Growing chart')
  chart.bars[3].chords = [{ id: 'loaded-final-chord', root: 0, quality: 'major' }]
  const originalBarIds = chart.bars.map(bar => bar.id)
  const editor = await mountAutoGrowthEditor([chart])
  const { byLabel, click, enter, saved, writes } = editor
  try {
    assert.equal(saved()[0].bars.length, 4, 'loading a nonempty final bar does not append')
    await click(byLabel('Select bar 4'))
    const field = byLabel('Bar chord text')
    assert.equal(saved()[0].bars.length, 4, 'selecting a nonempty final bar does not append')
    assert.equal(writes.length, 0, 'selection does not persist an unsolicited expansion')

    await enter('5/')
    assert.equal(field.getAttribute('aria-invalid'), 'true')
    assert.deepEqual(saved()[0].bars[3].chords, chart.bars[3].chords, 'invalid input keeps the last valid entries')
    assert.equal(saved()[0].bars.length, 4)
    assert.equal(writes.length, 0, 'invalid input cannot save or grow the chart')

    await enter('   ')
    assert.equal(saved()[0].bars.length, 4, 'whitespace-only input does not append')
    assert.deepEqual(saved()[0].bars[3].chords, [])
    writes.length = 0
    await enter('.', 0)
    assert.equal(writes.length, 1, 'the valid edit and all eight new bars are saved in one update')
    assert.equal(writes[0][0].bars.length, 12)
    assert.equal(writes[0][0].bars[3].chords[0].hold, true, 'a dot alone counts as nonempty valid content')
    assert.deepEqual(saved()[0].bars.slice(0, 4).map(bar => bar.id), originalBarIds)
    assert.ok(saved()[0].bars.slice(4).every(bar => bar.chords.length === 0))
    assert.equal(document.querySelectorAll('.tx-bars .tx-bar').length, 12)
    assert.equal(byLabel('Bar chord text'), field, 'growth does not replace the textarea')
    assert.equal(field.closest('.tx-bar'), byLabel('Bar 4 editor'), 'growth keeps the original bar selected')
    assert.equal(document.activeElement, field)
    assert.deepEqual([field.selectionStart, field.selectionEnd], [0, 0], 'growth preserves the insertion cursor')
    assert.equal(field.getAttribute('aria-invalid'), 'false')
    assertUniqueChartIds(saved())

    await enter('. 5/7', 3)
    assert.equal(saved()[0].bars.length, 12, 'subsequent edits to the former last bar do not append again')
    assert.equal(saved()[0].bars[3].chords.length, 2)
    assert.equal(byLabel('Bar chord text'), field)
    assert.deepEqual([field.selectionStart, field.selectionEnd], [3, 3])
    await enter('')
    assert.equal(saved()[0].bars.length, 12, 'clearing the former last bar does not grow or remove trailing bars')
    await enter('1')
    assert.equal(saved()[0].bars.length, 12, 'refilling the former last bar still does not append')

    await click(byLabel('Select bar 12'))
    await enter('6m')
    assert.equal(saved()[0].bars.length, 20, 'editing the new last bar can append the next group of eight')
    assert.ok(saved()[0].bars.slice(12).every(bar => bar.chords.length === 0))
    assertUniqueChartIds(saved())
    const persisted = saved()
    await editor.reload()
    assert.deepEqual(saved(), persisted, 'the entered chords and every appended bar survive reloading')
    assert.equal(document.querySelectorAll('.tx-bars .tx-bar').length, 20)
  } finally { await editor.close() }
})

test('importing and selecting a chart with a filled final bar never auto-appends', async () => {
  const chart = createChart('Existing chart')
  const imported = createChart('Imported chart')
  imported.bars[3].chords = [{ id: 'imported-final-chord', root: 7, quality: 'major' }]
  const backup = serializeCharts([imported])
  const editor = await mountAutoGrowthEditor([chart])
  try {
    const fileInput = editor.byLabel('Import transcription backup')
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [{ size: backup.length, text: async () => backup }] })
    await act(async () => fileInput.dispatchEvent(new editor.window.Event('change', { bubbles: true })))
    const saved = editor.saved()
    assert.equal(saved.length, 2)
    assert.equal(saved[0].bars.length, 4)
    assert.equal(saved[1].bars.length, 4, 'import preserves the supplied number of bars')
    assert.equal(saved[1].bars[3].chords.length, 1)
    assert.equal(editor.byLabel('Transcriptions').value, saved[1].id)
    editor.writes.length = 0
    await editor.click(editor.byLabel('Select bar 4'))
    assert.equal(editor.byLabel('Bar chord text').value, '5')
    assert.equal(editor.saved()[1].bars.length, 4)
    assert.equal(editor.writes.length, 0)
    assertUniqueChartIds(editor.saved())
  } finally { await editor.close() }
})

test('grid insertion in the last bar appends eight empty bars once in the same persisted update', async () => {
  const chart = createChart('Grid growth')
  const editor = await mountAutoGrowthEditor([chart])
  try {
    await editor.click(editor.byLabel('Play 1'))
    assert.equal(editor.saved()[0].bars.length, 4, 'audition-only does not grow a chart')
    assert.equal(editor.writes.length, 0)
    await editor.click(editor.byLabel('Select bar 4'))
    const field = editor.byLabel('Bar chord text')
    await editor.click(editor.byLabel('Play and add 6m'))
    assert.equal(editor.writes.length, 1)
    assert.equal(editor.writes[0][0].bars.length, 12)
    assert.equal(editor.writes[0][0].bars[3].chords.length, 1)
    assert.ok(editor.saved()[0].bars.slice(4).every(bar => bar.chords.length === 0))
    assert.equal(editor.byLabel('Bar chord text'), field)
    assert.equal(document.activeElement, field)
    assert.equal(field.closest('.tx-bar'), editor.byLabel('Bar 4 editor'))
    assert.equal(field.value, '6m')
    assert.equal(field.selectionStart, field.selectionEnd, 'grid insertion does not select all editor text')
    await editor.click(editor.byLabel('Play and add 5'))
    assert.equal(editor.saved()[0].bars.length, 12, 'another grid insertion in the former last bar does not append')
    assert.equal(editor.saved()[0].bars[3].chords.length, 2)
    assertUniqueChartIds(editor.saved())
  } finally { await editor.close() }
})

test('automatic growth respects the 1,000-bar limit without dropping valid edits or appending a partial group', async () => {
  for (const count of [MAX_BARS_PER_CHART - 8, MAX_BARS_PER_CHART - 7, MAX_BARS_PER_CHART]) {
    const chart = createChart(`Boundary ${count}`)
    chart.bars = Array.from({ length: count }, (_, index) => ({ id: `boundary-${count}-bar-${index}`, chords: [] }))
    const editor = await mountAutoGrowthEditor([chart])
    try {
      await editor.click(editor.byLabel(`Select bar ${count}`))
      const field = editor.byLabel('Bar chord text')
      await editor.enter('5/7', 1)
      const saved = editor.saved()[0]
      const expectedCount = count + 8 <= MAX_BARS_PER_CHART ? count + 8 : count
      assert.equal(saved.bars.length, expectedCount, `${count} bars must gain either all eight bars or none`)
      assert.equal(editor.writes.length, 1)
      assert.equal(editor.writes[0][0].bars.length, expectedCount)
      assert.equal(saved.bars[count - 1].chords[0].bass, 11, 'the valid edit is saved even when growth cannot fit')
      assert.equal(field.getAttribute('aria-invalid'), 'false')
      assert.equal(editor.byLabel('Bar chord text'), field)
      assert.equal(document.activeElement, field)
      assert.deepEqual([field.selectionStart, field.selectionEnd], [1, 1])
      assertUniqueChartIds(editor.saved())
      if (expectedCount === count) {
        assert.match(document.querySelector('[role="status"]').textContent, /bar saved.*eight.*limit/i)
      } else {
        assert.ok(saved.bars.slice(count).every(bar => bar.chords.length === 0))
      }
    } finally { await editor.close() }
  }
})

function chartsNearSerializationLimit() {
  const active = createChart('Backup size boundary')
  const fillerBars = Array.from({ length: 6_000 }, (_, index) => ({
    id: `filler-${String(index).padStart(5, '0')}-${'x'.repeat(70)}`,
    chords: [],
    section: 's'.repeat(120),
    time: 't'.repeat(32),
  }))
  const chartsWithBars = count => [active, ...Array.from({ length: Math.ceil(count / MAX_BARS_PER_CHART) }, (_, index) => ({
    id: `filler-chart-${index}`,
    name: 'Stored background chart',
    sourceKey: 0,
    bars: fillerBars.slice(index * MAX_BARS_PER_CHART, Math.min(count, (index + 1) * MAX_BARS_PER_CHART)),
  }))]
  // Leave enough room for the user's chord, but not a group of eight empty bars.
  let low = 0
  let high = fillerBars.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const length = JSON.stringify({ version: 1, charts: chartsWithBars(mid) }, null, 2).length
    if (length <= MAX_IMPORT_CHARACTERS - 300) low = mid
    else high = mid - 1
  }
  return chartsWithBars(low)
}

test('backup-size growth failure saves the last-bar edit and shows a notice without partial appended bars', async () => {
  const charts = chartsNearSerializationLimit()
  const edited = structuredClone(charts)
  edited[0].bars[3].chords = [{ id: 'c'.repeat(128), root: 0, quality: 'major' }]
  assert.doesNotThrow(() => serializeCharts(edited), 'the fixture allows even the largest valid chord ID to be saved')
  const expanded = structuredClone(edited)
  expanded[0].bars.push(...Array.from({ length: 8 }, (_, index) => ({ id: `new-${index}-${'x'.repeat(30)}`, chords: [] })))
  assert.throws(() => serializeCharts(expanded), /too large/, 'the fixture rejects the complete eight-bar expansion')
  const editor = await mountAutoGrowthEditor(charts)
  try {
    await editor.click(editor.byLabel('Select bar 4'))
    const field = editor.byLabel('Bar chord text')
    await editor.enter('1', 0)
    const saved = editor.saved()
    assert.equal(saved[0].bars.length, 4, 'no partial group is appended when the aggregate backup is too large')
    assert.equal(saved[0].bars[3].chords[0].root, 0)
    assert.equal(saved[0].bars[3].chords.length, 1)
    assert.deepEqual(saved.slice(1), charts.slice(1), 'other saved charts remain intact')
    assert.equal(editor.writes.length, 1)
    assert.equal(editor.writes[0][0].bars.length, 4)
    assert.equal(field.getAttribute('aria-invalid'), 'false', 'a growth failure never marks the valid chord as invalid')
    assert.equal(editor.byLabel('Bar chord text'), field)
    assert.equal(document.activeElement, field)
    assert.deepEqual([field.selectionStart, field.selectionEnd], [0, 0])
    assert.match(document.querySelector('[role="status"]').textContent, /bar saved.*eight.*limit/i)
    assertUniqueChartIds(saved)
  } finally { await editor.close() }
})


function chartWithBarCount(name, count) {
  const chart = createChart(name)
  chart.bars = Array.from({ length: count }, (_, index) => ({ id: `${chart.id}-bar-${index}`, chords: [] }))
  return chart
}

test('clearing content trims redundant trailing eight-bar groups while retaining a working blank block', async () => {
  const chart = chartWithBarCount('Trim trailing bars', 20)
  chart.bars[3].chords = [{ id: 'trim-keep-chord', root: 0, quality: 'major' }]
  chart.bars[11].chords = [{ id: 'trim-clear-chord', root: 7, quality: 'major' }]
  const editor = await mountAutoGrowthEditor([chart])
  try {
    await editor.click(editor.byLabel('Select bar 12'))
    const field = editor.byLabel('Bar chord text')
    await editor.enter('')
    assert.equal(editor.saved()[0].bars.length, 12, 'sixteen trailing empty bars shrink to one block of eight')
    assert.equal(editor.writes.length, 1, 'clearing and trimming are persisted together')
    assert.deepEqual(editor.saved()[0].bars.slice(0, 4), chart.bars.slice(0, 4), 'earlier bars and chords stay intact')
    assert.ok(editor.saved()[0].bars.slice(4).every(bar => bar.chords.length === 0))
    assert.equal(editor.byLabel('Bar chord text'), field, 'trimming keeps the current textarea mounted')
    assert.equal(field.closest('.tx-bar'), editor.byLabel('Bar 12 editor'))
    assert.equal(document.activeElement, field)
    assert.deepEqual([field.selectionStart, field.selectionEnd], [0, 0])
    await editor.enter('   ')
    assert.equal(editor.saved()[0].bars.length, 12, 'another empty edit does not trim below the working block')
    await editor.enter('1')
    assert.equal(editor.saved()[0].bars.length, 20, 'the same final cell grows once when filled again')
    await editor.enter('')
    assert.equal(editor.saved()[0].bars.length, 12, 'clearing returns to the same stable working block')
    assertUniqueChartIds(editor.saved())
  } finally { await editor.close() }
})

test('trimming protects the focused tail cell until editing finishes', async () => {
  const chart = chartWithBarCount('Protect focused bar', 20)
  chart.bars[3].chords = [{ id: 'protected-keep-chord', root: 0, quality: 'major' }]
  chart.bars[19].chords = [{ id: 'protected-clear-chord', root: 7, quality: 'major' }]
  const editor = await mountAutoGrowthEditor([chart])
  try {
    await editor.click(editor.byLabel('Select bar 20'))
    const field = editor.byLabel('Bar chord text')
    await editor.enter('')
    assert.equal(editor.saved()[0].bars.length, 20, 'trimming cannot remove the bar currently being edited')
    assert.equal(editor.byLabel('Bar chord text'), field)
    assert.equal(document.activeElement, field)
    const done = [...document.querySelectorAll('button')].find(button => button.textContent === 'Done editing')
    await editor.click(done)
    assert.equal(editor.byLabel('Bar chord text'), null)
    assert.equal(editor.saved()[0].bars.length, 12, 'Done editing releases the surplus tail block')
    assert.equal(document.activeElement, editor.byLabel('Select bar 12'), 'focus returns to the last remaining bar when its previous cell is trimmed')
    assert.ok(editor.saved()[0].bars.slice(4).every(bar => bar.chords.length === 0))
    assert.equal(editor.saved()[0].bars[3].chords[0].id, 'protected-keep-chord')
    const persisted = editor.saved()
    await editor.reload()
    assert.deepEqual(editor.saved(), persisted)
  } finally { await editor.close() }
})

test('switching editors preserves the destination bar and trims safe trailing blocks', async () => {
  const chart = chartWithBarCount('Protect selected destination', 24)
  const editor = await mountAutoGrowthEditor([chart])
  try {
    assert.equal(editor.saved()[0].bars.length, 24, 'loading trailing blanks does not mutate the chart')
    await editor.click(editor.byLabel('Select bar 24'))
    assert.equal(editor.saved()[0].bars.length, 24, 'initial selection alone does not trim')
    assert.equal(editor.writes.length, 0)
    await editor.click(editor.byLabel('Select bar 18'))
    assert.equal(editor.saved()[0].bars.length, 24, 'finishing one editor cannot trim away its selected destination')
    assert.equal(editor.byLabel('Bar chord text').closest('.tx-bar'), editor.byLabel('Bar 18 editor'))
    await editor.click(editor.byLabel('Select bar 1'))
    assert.equal(editor.saved()[0].bars.length, 8, 'switching to a safe destination removes every redundant eight-bar block')
    assert.equal(editor.byLabel('Bar chord text').closest('.tx-bar'), editor.byLabel('Bar 1 editor'))
    assert.equal(document.activeElement, editor.byLabel('Bar chord text'))
    assert.ok(editor.saved()[0].bars.every(bar => bar.chords.length === 0))
  } finally { await editor.close() }
})

test('a legacy zero-bar chart offers an editable blank cell without manual controls or unsolicited storage changes', async () => {
  const chart = createChart('Legacy empty chart')
  chart.bars = []
  const editor = await mountAutoGrowthEditor([chart])
  try {
    const buttonTexts = [...document.querySelectorAll('button')].map(button => button.textContent)
    for (const label of ['+ Add bar', 'Remove bar', 'Undo removal']) assert.equal(buttonTexts.includes(label), false)
    assert.deepEqual(editor.saved()[0].bars, [], 'loading a legacy empty chart does not create persisted bars')
    await editor.click(editor.byLabel('Select bar 1'))
    const field = editor.byLabel('Bar chord text')
    assert.ok(field)
    assert.deepEqual(editor.saved()[0].bars, [], 'selecting the recovery cell does not create persisted bars')
    assert.equal(editor.writes.length, 0)
    await editor.enter('   ')
    assert.deepEqual(editor.saved()[0].bars, [], 'empty recovery-cell input does not create a real bar')
    await editor.enter('5/')
    assert.deepEqual(editor.saved()[0].bars, [], 'invalid recovery-cell input does not create a real bar')
    editor.writes.length = 0
    await editor.enter('1')
    const saved = editor.saved()
    assert.equal(saved[0].bars.length, 9, 'the first valid entry saves its bar and eight new empty bars')
    assert.equal(editor.writes.length, 1)
    assert.equal(editor.writes[0][0].bars.length, 9)
    assert.equal(saved[0].bars[0].chords.length, 1)
    assert.ok(saved[0].bars.slice(1).every(bar => bar.chords.length === 0))
    assert.equal(editor.byLabel('Bar chord text'), field, 'the virtual cell becomes real without replacing its textarea')
    assert.equal(document.activeElement, field)
    assert.equal(field.getAttribute('aria-invalid'), 'false')
    assertUniqueChartIds(saved)
  } finally { await editor.close() }
})

test('automatic trimming preserves otherwise empty bars with legacy section or timing metadata', async () => {
  for (const metadata of [{ section: 'Legacy coda' }, { time: '1:24' }]) {
    const chart = chartWithBarCount('Keep legacy metadata', 24)
    Object.assign(chart.bars[23], metadata)
    const editor = await mountAutoGrowthEditor([chart])
    try {
      await editor.click(editor.byLabel('Select bar 1'))
      await editor.enter('1')
      assert.equal(editor.saved()[0].bars.length, 24, 'metadata makes a trailing bar meaningful even without chords')
      assert.deepEqual(editor.saved()[0].bars[23], chart.bars[23])
      const done = [...document.querySelectorAll('button')].find(button => button.textContent === 'Done editing')
      await editor.click(done)
      assert.equal(editor.saved()[0].bars.length, 24, 'finishing an edit also preserves the legacy bar')
      assert.deepEqual(editor.saved()[0].bars[23], chart.bars[23])
    } finally { await editor.close() }
  }
})


test('recovering multiple legacy zero-bar charts gives each real starter bar a unique ID', async () => {
  const charts = [createChart('First legacy chart'), createChart('Second legacy chart')]
  for (const chart of charts) chart.bars = []
  const editor = await mountAutoGrowthEditor(charts)
  try {
    await editor.click(editor.byLabel('Select bar 1'))
    await editor.enter('1')
    assert.equal(editor.saved()[0].bars.length, 9)
    assert.equal(editor.saved()[1].bars.length, 0)
    await act(async () => {
      const select = editor.byLabel('Transcriptions')
      select.value = charts[1].id
      select.dispatchEvent(new editor.window.Event('change', { bubbles: true }))
    })
    assert.equal(editor.saved()[1].bars.length, 0)
    await editor.click(editor.byLabel('Select bar 1'))
    await editor.enter('2')
    const saved = editor.saved()
    assert.equal(saved[0].bars.length, 9)
    assert.equal(saved[1].bars.length, 9)
    assert.equal(saved[0].bars[0].chords[0].root, 0)
    assert.equal(saved[1].bars[0].chords[0].root, 2)
    assert.notEqual(saved[0].bars[0].id, saved[1].bars[0].id)
    assertUniqueChartIds(saved)
    assert.equal(editor.byLabel('Bar chord text').getAttribute('aria-invalid'), 'false')
  } finally { await editor.close() }
})


test('opening the inline editor retains cell content geometry and toolbar without scrolling focus', async () => {
  const chart = createChart('Stable edit layout')
  chart.bars[0].chords = [
    { id: 'layout-first', root: 0, quality: 'major' },
    { id: 'layout-second', root: 9, quality: 'minor' },
    { id: 'layout-third', root: 7, quality: 'major', bass: 11 },
  ]
  const editor = await mountAutoGrowthEditor([chart])
  const focusCalls = []
  const originalFocus = editor.window.HTMLElement.prototype.focus
  editor.window.HTMLTextAreaElement.prototype.focus = function (options) {
    focusCalls.push({ element: this, options })
    return originalFocus.call(this, options)
  }
  try {
    const button = editor.byLabel('Select bar 1')
    const renderedText = button.querySelector('.tx-bar-entries').textContent
    const done = [...document.querySelectorAll('button')].find(item => item.textContent === 'Done editing')
    assert.ok(done, 'the toolbar action reserves space even before editing starts')
    assert.equal(done.disabled, true)
    await editor.click(button)
    const field = editor.byLabel('Bar chord text')
    const ghost = editor.byLabel('Bar 1 editor').querySelector('.tx-bar-entries')
    assert.equal(ghost.textContent, renderedText, 'the selected cell retains its original layout content')
    assert.equal(ghost.getAttribute('aria-hidden'), 'true')
    assert.equal(field.rows, 1, 'the editor does not add a second text row to the cell')
    const helper = document.getElementById('tx-inline-help')
    assert.ok(helper.classList.contains('tx-sr-only'), 'syntax help remains accessible without adding a visible line below the chart')
    assert.match(helper.textContent, /scale degrees/)
    assert.ok(field.getAttribute('aria-describedby').split(/\s+/).includes(helper.id))
    assert.equal(document.querySelector('.tx-text-help'), null)
    assert.equal([...document.querySelectorAll('button')].find(item => item.textContent === 'Done editing'), done, 'entering edit mode keeps the same toolbar button mounted')
    assert.equal(done.disabled, false)
    assert.equal(focusCalls.length, 1)
    assert.equal(focusCalls[0].element, field)
    assert.deepEqual(focusCalls[0].options, { preventScroll: true })
    assert.equal(document.activeElement, field)
    assert.deepEqual([field.selectionStart, field.selectionEnd], [0, field.value.length])
    await editor.enter('1 . 5/7', 4)
    assert.equal(editor.byLabel('Bar chord text'), field)
    assert.equal(focusCalls.length, 1, 'ordinary text updates do not refocus or scroll the editor')
    assert.deepEqual([field.selectionStart, field.selectionEnd], [4, 4])
    await editor.click(done)
    assert.equal(editor.byLabel('Bar chord text'), null)
    assert.equal([...document.querySelectorAll('button')].find(item => item.textContent === 'Done editing'), done, 'leaving edit mode keeps the toolbar mounted')
    assert.equal(done.disabled, true)
  } finally {
    delete editor.window.HTMLTextAreaElement.prototype.focus
    await editor.close()
  }
})


test('the metronome defaults on and its per-chart toggle survives reloads', async () => {
  const charts = [createChart('Default metronome'), createChart('Independent metronome')]
  const editor = await mountAutoGrowthEditor(charts)
  try {
    assert.equal(editor.byLabel('Metronome').type, 'checkbox')
    assert.equal(editor.byLabel('Metronome').checked, true)
    assert.equal(editor.saved()[0].metronome, undefined, 'loading a legacy chart need not rewrite its optional setting')
    await editor.click(editor.byLabel('Metronome'))
    assert.equal(editor.byLabel('Metronome').checked, false)
    assert.equal(editor.saved()[0].metronome, false)
    assert.equal(editor.saved()[1].metronome, undefined, 'the toggle changes only the active chart')
    assert.equal(editor.writes.length, 1)
    await editor.reload()
    assert.equal(editor.byLabel('Metronome').checked, false, 'the off setting is restored from storage')
    await editor.click(editor.byLabel('Metronome'))
    assert.equal(editor.saved()[0].metronome, true)
    await editor.reload()
    assert.equal(editor.byLabel('Metronome').checked, true, 'the on setting is restored from storage')
  } finally { await editor.close() }
})
