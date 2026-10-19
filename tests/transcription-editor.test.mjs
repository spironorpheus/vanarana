import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import Transcription from '../src/transcription/Transcription.tsx'
import { createChart, serializeCharts, parseCharts } from '../src/transcription/model.ts'

test('editor supports audition-only, append, slash edits, transposition, reorder, undo and persistence', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.example', pretendToBeVisual: true })
  const { window } = dom
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'localStorage']) Object.defineProperty(globalThis, name, { configurable: true, value: window[name] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const chart = createChart('Lustrous Stars')
  chart.bars[0].time = '0:42'
  localStorage.setItem('vanarana.transcriptions.v1', serializeCharts([chart]))
  const root = createRoot(document.getElementById('root'))
  const click = async element => { assert.ok(element); await act(async () => element.click()) }
  const byLabel = label => document.querySelector(`[aria-label="${label}"]`)
  const byText = text => [...document.querySelectorAll('button')].find(item => item.textContent === text)
  const select = async (label, value) => act(async () => { const element = byLabel(label); element.value = value; element.dispatchEvent(new window.Event('change', { bubbles: true })) })
  const saved = () => parseCharts(localStorage.getItem('vanarana.transcriptions.v1'))[0]
  try {
    await act(async () => root.render(React.createElement(Transcription, { active: true })))
    assert.equal(document.querySelectorAll('.tx-grid tbody tr').length, 12)
    assert.equal(document.querySelectorAll('.tx-grid td button').length, 60)
    await click(byLabel('Play 1'))
    assert.equal(saved().bars[0].chords.length, 0)
    await click(byLabel('Select bar 1'))
    await click(byLabel('Play and add 1'))
    await click(byLabel('Play and add 6m'))
    assert.equal(saved().bars[0].chords.length, 2)
    const enter = async text => act(async () => {
      const field = byLabel('Bar chord text')
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(field, text)
      field.dispatchEvent(new window.Event('input', { bubbles: true }))
      field.dispatchEvent(new window.Event('change', { bubbles: true }))
    })
    await enter('1 . 5/7 6m')
    assert.equal(saved().bars[0].chords.length, 4)
    assert.equal(saved().bars[0].chords[1].hold, true)
    assert.equal(saved().bars[0].chords[2].bass, 11)
    assert.equal(saved().bars[0].time, '0:42', 'hidden legacy timing metadata survives text edits')
    assert.equal(byLabel('Select bar 1').textContent.includes('Bar 1'), false, 'compact bars have no separate titles')
    await select('Notation', 'letters')
    await select('Render and play in', '2')
    assert.match(byLabel('Select bar 1').textContent, /A\/C#Bm/)
    assert.equal(byLabel('Bar chord text').value, '1 . 5/7 6m', 'editor always uses degree syntax')
    await enter('1 . 5/')
    assert.equal(byLabel('Bar chord text').getAttribute('aria-invalid'), 'true')
    assert.equal(saved().bars[0].chords.length, 4, 'invalid partial input never overwrites saved entries')
    await click(byLabel('Select bar 2'))
    assert.equal(byLabel('Select bar 1').getAttribute('aria-pressed'), 'true', 'cannot silently discard invalid text by selecting another bar')
    await click(byText('Discard unfinished edit'))
    assert.equal(byLabel('Bar chord text').value, '1 . 5/7 6m')
    await select('Notation', 'degrees')
    await click(byLabel('Play and add 17'))
    assert.equal(saved().bars[0].chords.length, 5)
    assert.equal(byLabel('Bar chord text').value, '1 . 5/7 6m 17')
    assert.equal(document.querySelector('input[placeholder="0:00"]'), null)
    await click(byText('Move later'))
    assert.equal(saved().bars[1].chords.length, 5)
    await click(byText('Remove bar'))
    assert.equal(saved().bars.length, 3)
    await click(byText('Undo removal'))
    assert.equal(saved().bars[1].chords.length, 5)
    await click(byLabel('Select bar 2'))
    await click(byText('Done editing'))
    await click(byLabel('Play 17'))
    assert.equal(saved().bars[1].chords.length, 5)
    await act(async () => root.render(React.createElement(Transcription, { active: false })))
  } finally { await act(async () => root.unmount()); dom.window.close() }
})

test('corrupt storage is preserved and a visible recovery warning is shown', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.example' })
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'localStorage']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.setItem('vanarana.transcriptions.v1', '{broken')
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
  const root = createRoot(document.getElementById('root'))
  const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text)
  const click = async element => act(async () => element.click())
  try {
    await act(async () => root.render(React.createElement(Transcription, { active: true })))
    await click(document.querySelector('[aria-label="Select bar 2"]'))
    const tempo = document.querySelector('[aria-label="Tempo (BPM)"]')
    await act(async () => { tempo.value = '200'; tempo.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true })) })
    assert.equal(parseCharts(localStorage.getItem('vanarana.transcriptions.v1'))[0].bpm, 200)
    await click(button('Play from bar 2'))
    assert.deepEqual(played[0], [67, 71, 74])
    assert.equal(document.querySelectorAll('.tx-bar.is-playing').length, 1)
    assert.equal(document.querySelector('.tx-bar.is-playing').getAttribute('aria-label'), 'Select bar 2')
    assert.equal(document.querySelector('.tx-grid button').disabled, true)
    await click(document.querySelector('.tx-grid button'))
    assert.equal(parseCharts(localStorage.getItem('vanarana.transcriptions.v1'))[0].bars[1].chords.length, 1)
    assert.equal(document.querySelector('[aria-label="Select bar 2"]').getAttribute('aria-pressed'), 'true')
    await click(button('Stop playback'))
    assert.equal(document.querySelectorAll('.tx-bar.is-playing').length, 0)
    assert.ok(button('Play from bar 2'))
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
