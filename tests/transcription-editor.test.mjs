import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import Transcription from '../src/transcription/Transcription.tsx'
import { createChart, serializeCharts, parseCharts } from '../src/transcription/model.ts'

test('inline bar editor supports focus, audition-only, append, slash edits, transposition, undo and persistence', async () => {
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
  const enter = async text => act(async () => {
    const field = byLabel('Bar chord text')
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(field, text)
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
    assert.ok(byText('Remove bar').closest('.tx-chart-actions'))
    assert.equal(byText('Move earlier'), undefined)
    assert.equal(byText('Move later'), undefined)
    assertLegacyHidden()
    await click(byLabel('Play and add 1'))
    await click(byLabel('Play and add 6m'))
    assert.equal(saved().bars[0].chords.length, 2)
    await enter('1 . 5/7 6m')
    assert.equal(byLabel('Bar chord text'), field, 'typing does not replace the focused editor')
    assert.equal(document.activeElement, field)
    assert.equal(saved().bars[0].chords.length, 4)
    assert.equal(saved().bars[0].chords[1].hold, true)
    assert.equal(saved().bars[0].chords[2].bass, 11)
    assert.equal(saved().bars[0].section, 'Legacy introduction', 'hidden legacy section metadata survives text edits')
    assert.equal(saved().bars[0].time, '0:42', 'hidden legacy timing metadata survives text edits')
    await select('Notation', 'letters')
    await select('Render and play in', '2')
    assert.equal(byLabel('Bar chord text').value, '1 . 5/7 6m', 'inline editing always uses degree syntax')
    assert.equal(byLabel('Bar 1 editor').querySelector('.tx-bar-entries'), null, 'the edited bar does not show a duplicate chord rendering')
    await click(byText('Done editing'))
    assert.equal(byLabel('Bar chord text'), null)
    assert.match(byLabel('Select bar 1').textContent, /A\/C#Bm/)
    assertLegacyHidden()
    await click(byLabel('Select bar 1'))
    assert.equal(byLabel('Bar chord text').value, '1 . 5/7 6m', 'reopening a transposed bar restores its degree text')
    assert.equal(document.activeElement, byLabel('Bar chord text'))
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
    await click(byText('Remove bar'))
    assert.equal(saved().bars.length, 4, 'an unfinished edit prevents removal')
    await click(byText('Discard unfinished edit'))
    assert.equal(byLabel('Bar chord text').value, '1 . 5/7 6m')
    assert.equal(byLabel('Bar chord text').getAttribute('aria-invalid'), 'false')
    await select('Notation', 'degrees')
    await click(byLabel('Play and add 17'))
    assert.equal(saved().bars[0].chords.length, 5)
    assert.equal(byLabel('Bar chord text').value, '1 . 5/7 6m 17')
    await click(byText('+ Add bar'))
    assert.equal(saved().bars.length, 5)
    assert.equal(saved().bars[4].chords.length, 0)
    await click(byText('Remove bar'))
    assert.equal(saved().bars.length, 4)
    assert.equal(byLabel('Bar chord text'), null)
    await click(byText('Undo removal'))
    assert.equal(saved().bars.length, 5)
    assert.equal(saved().bars[0].chords.length, 5)
    assert.equal(saved().bars[0].section, 'Legacy introduction')
    assert.equal(saved().bars[0].time, '0:42')
    await click(byLabel('Select bar 1'))
    assert.equal(byLabel('Bar chord text').value, '1 . 5/7 6m 17')
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
  const original = { prepare: ChordPlayer.prototype.prepare, play: ChordPlayer.prototype.play, stop: ChordPlayer.prototype.stop }
  const played = []
  let stops = 0
  ChordPlayer.prototype.prepare = async () => {}
  ChordPlayer.prototype.play = async notes => { played.push(notes) }
  ChordPlayer.prototype.stop = () => { stops++ }
  // Initialize React's DOM support after jsdom exists so autofocus uses native input events.
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text)
  const click = async element => act(async () => element.click())
  try {
    await act(async () => root.render(React.createElement(Transcription, { active: true })))
    await click(document.querySelector('[aria-label="Select bar 2"]'))
    assert.ok(document.querySelector('[aria-label="Bar 2 editor"] textarea'))
    const tempo = document.querySelector('[aria-label="Tempo (BPM)"]')
    await act(async () => { tempo.value = '200'; tempo.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true })) })
    assert.equal(parseCharts(localStorage.getItem('vanarana.transcriptions.v1'))[0].bpm, 200)
    await click(button('Play from bar 2'))
    assert.deepEqual(played[0], [67, 71, 74])
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
    await click(button('Play from bar 2'))
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
