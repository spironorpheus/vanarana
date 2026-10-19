import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import MelodyKeyboard from '../src/transcription/MelodyKeyboard.tsx'

async function setup(extraProps = {}) {
  const dom = new JSDOM('<section class="tx-chart"><textarea aria-label="Bar chord text"></textarea><div id="root"></div></section>', { url: 'https://test.example', pretendToBeVisual: true })
  const { window } = dom
  for (const name of ['window', 'document', 'navigator', 'HTMLElement']) Object.defineProperty(globalThis, name, { configurable: true, value: window[name] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const captured = new Map()
  const pointer = (element, type, id, options = {}) => {
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...options })
    Object.defineProperties(event, {
      pointerId: { value: id },
      pointerType: { value: options.pointerType ?? 'touch' },
      isPrimary: { value: id === 1 },
    })
    element.dispatchEvent(event)
    return event
  }
  window.HTMLButtonElement.prototype.setPointerCapture = function (id) { captured.set(id, this) }
  window.HTMLButtonElement.prototype.hasPointerCapture = function (id) { return captured.get(id) === this }
  window.HTMLButtonElement.prototype.releasePointerCapture = function (id) {
    if (captured.get(id) === this) {
      captured.delete(id)
      pointer(this, 'lostpointercapture', id)
    }
  }
  const starts = []
  const stops = []
  const props = { onNoteOn: (id, pitch) => starts.push({ id, pitch }), onNoteOff: id => stops.push(id), ...extraProps }
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(MelodyKeyboard, props)))
  return {
    window, starts, stops, captured, root,
    note: label => document.querySelector(`[aria-label="Play ${label}"]`),
    button: label => document.querySelector(`[aria-label="${label}"]`),
    pointer: async (element, type, id, options) => { let event; await act(async () => { event = pointer(element, type, id, options) }); return event },
    event: async (element, type) => {
      const event = new window.Event(type, { bubbles: true, cancelable: true })
      await act(async () => element.dispatchEvent(event))
      return event
    },
    key: async (element, type, key, options = {}) => {
      const event = new window.KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...options })
      await act(async () => element.dispatchEvent(event))
      return event
    },
    render: async updates => act(async () => root.render(React.createElement(MelodyKeyboard, { ...props, ...updates }))),
    click: async element => act(async () => element.click()),
    close: async () => { await act(async () => root.unmount()); dom.window.close() },
  }
}

test('piano exposes two labeled octaves, focusable keys, and a separate scrolling rail', async () => {
  const app = await setup()
  try {
    assert.equal(document.querySelectorAll('.tx-piano-key').length, 24)
    assert.equal(document.querySelectorAll('.tx-piano-key.is-white').length, 14)
    assert.equal(document.querySelectorAll('.tx-piano-key.is-black').length, 10)
    assert.ok(app.note('C4'))
    assert.ok(app.note('B5'))
    assert.ok(app.note('C sharp 4'))
    assert.equal(document.querySelector('.tx-keyboard-range').textContent, 'C4–B5')
    const keyboard = document.querySelector('[role="group"][aria-label="Piano keyboard"]')
    assert.match(document.getElementById(keyboard.getAttribute('aria-describedby')).textContent, /hold Space or Enter/)
    assert.equal(document.querySelector('[aria-label="Scrollable piano keys"]').tabIndex, 0)
    assert.equal(document.querySelector('.tx-keyboard-scroll-rail').closest('.tx-keyboard-scroll'), document.querySelector('.tx-keyboard-scroll'))
    for (const note of document.querySelectorAll('.tx-piano-key')) {
      assert.equal(note.tagName, 'BUTTON')
      assert.equal(note.tabIndex, 0)
      assert.equal(note.getAttribute('aria-pressed'), 'false')
    }
  } finally { await app.close() }
})

test('multi-touch gives each pointer its own note lifetime, even on the same pitch', async () => {
  const app = await setup()
  try {
    const c = app.note('C4')
    const e = app.note('E4')
    assert.equal((await app.pointer(c, 'pointerdown', 1)).defaultPrevented, true)
    await app.pointer(c, 'pointerdown', 2)
    await app.pointer(e, 'pointerdown', 3)
    assert.deepEqual(app.starts.map(note => note.pitch), [60, 60, 64])
    assert.equal(new Set(app.starts.map(note => note.id)).size, 3)
    assert.equal(app.captured.size, 3)
    assert.equal(c.getAttribute('aria-pressed'), 'true')
    assert.equal(e.getAttribute('aria-pressed'), 'true')
    await app.pointer(app.window, 'pointerup', 1)
    assert.deepEqual(app.stops, [app.starts[0].id])
    assert.equal(c.getAttribute('aria-pressed'), 'true', 'a second held finger keeps the pitch highlighted')
    await app.pointer(c, 'pointerup', 2)
    assert.equal(c.getAttribute('aria-pressed'), 'false')
    await app.pointer(e, 'pointerup', 3)
    assert.deepEqual(app.stops, app.starts.map(note => note.id))
    assert.equal(e.getAttribute('aria-pressed'), 'false')
    assert.equal(app.captured.size, 0)
  } finally { await app.close() }
})

test('keybed and note labels suppress context menus without interrupting held multi-touch notes', async () => {
  const app = await setup()
  try {
    const c = app.note('C4')
    const e = app.note('E4')
    await app.pointer(c.querySelector('span'), 'pointerdown', 1)
    await app.pointer(e, 'pointerdown', 2)
    for (const target of [c.querySelector('span'), e, document.querySelector('.tx-keyboard-keys')]) {
      assert.equal((await app.event(target, 'contextmenu')).defaultPrevented, true)
    }
    assert.deepEqual(app.starts.map(note => note.pitch), [60, 64])
    assert.deepEqual(app.stops, [], 'a callout attempt does not release a sustained note')
    assert.equal(app.captured.size, 2)
    assert.equal(c.getAttribute('aria-pressed'), 'true')
    assert.equal(e.getAttribute('aria-pressed'), 'true')
    for (const target of [document.querySelector('textarea'), document.querySelector('.tx-keyboard-scroll-rail')]) {
      assert.equal((await app.event(target, 'contextmenu')).defaultPrevented, false)
    }
    await app.pointer(app.window, 'pointerup', 1)
    assert.equal(c.getAttribute('aria-pressed'), 'false')
    assert.equal(e.getAttribute('aria-pressed'), 'true')
    await app.pointer(e, 'pointercancel', 2)
    assert.deepEqual(app.stops, app.starts.map(note => note.id))
    assert.equal(e.getAttribute('aria-pressed'), 'false')
    assert.equal(app.captured.size, 0)
  } finally { await app.close() }
})

test('native selection guard is scoped to keys and labels, leaving chart editing and the scroll rail alone', async () => {
  const app = await setup()
  try {
    for (const target of [document.querySelector('.tx-keyboard-keys'), app.note('C4'), app.note('C4').querySelector('span')]) {
      assert.equal((await app.event(target, 'selectstart')).defaultPrevented, true)
    }
    const textarea = document.querySelector('textarea')
    for (const target of [textarea, document.querySelector('.tx-keyboard-scroll-rail'), document.querySelector('.tx-keyboard-scroll'), app.button('Lower keyboard octave')]) {
      assert.equal((await app.event(target, 'selectstart')).defaultPrevented, false)
    }
    textarea.value = 'Cmaj7 Am7'
    textarea.focus()
    textarea.setSelectionRange(0, 5)
    assert.equal(document.activeElement, textarea)
    assert.equal(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd), 'Cmaj7')
    assert.deepEqual(app.starts, [])
  } finally { await app.close() }
})

test('non-passive keybed touch guard preserves pointer note lifetimes and does not block rail gestures', async () => {
  const app = await setup()
  try {
    const c = app.note('C4')
    const e = app.note('E4')
    await app.pointer(c, 'pointerdown', 1)
    assert.equal((await app.event(c.querySelector('span'), 'touchstart')).defaultPrevented, true)
    await app.pointer(e, 'pointerdown', 2)
    assert.equal((await app.event(e, 'touchstart')).defaultPrevented, true)
    assert.equal((await app.event(document.querySelector('.tx-keyboard-keys'), 'touchstart')).defaultPrevented, true)
    assert.deepEqual(app.starts.map(note => note.pitch), [60, 64], 'touch handling does not double-trigger pointer notes')
    assert.deepEqual(app.stops, [])
    const rail = document.querySelector('.tx-keyboard-scroll-rail')
    for (const target of [rail, document.querySelector('.tx-keyboard-scroll'), document.querySelector('textarea')]) {
      assert.equal((await app.event(target, 'touchstart')).defaultPrevented, false)
      assert.equal((await app.event(target, 'touchmove')).defaultPrevented, false)
    }
    await app.pointer(rail, 'pointerup', 1)
    assert.deepEqual(app.stops, [app.starts[0].id])
    assert.equal(e.getAttribute('aria-pressed'), 'true')
    await app.pointer(app.window, 'pointercancel', 2)
    await app.pointer(e, 'pointerup', 2)
    assert.deepEqual(app.stops, app.starts.map(note => note.id))
    assert.equal(app.captured.size, 0)
  } finally { await app.close() }
})

test('native callout guards are removed from the keybed on unmount', async () => {
  const app = await setup()
  let closed = false
  try {
    const keybed = document.querySelector('.tx-keyboard-keys')
    await app.close()
    closed = true
    for (const type of ['selectstart', 'touchstart']) {
      assert.equal((await app.event(keybed, type)).defaultPrevented, false)
    }
  } finally { if (!closed) await app.close() }
})

test('WebKit selection and callout CSS covers the entire keybed and labels without leaking into the chart', async () => {
  const app = await setup()
  try {
    // jsdom cannot reproduce Safari's native callout UI, so verify the authored declarations.
    // Read source because jsdom also discards unsupported -webkit-touch-callout declarations.
    const css = readFileSync(new URL('../src/transcription/melody-keyboard.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
      selector: selector.trim(),
      declarations: new Map(body.split(';').filter(Boolean).map(declaration => declaration.split(':').map(part => part.trim()))),
    }))
    const valuesFor = (element, property) => rules
      .filter(rule => element.matches(rule.selector))
      .map(rule => rule.declarations.get(property))
      .filter(Boolean)
    for (const target of [document.querySelector('.tx-keyboard-keys'), app.note('C4'), app.note('C4').querySelector('span'), app.note('C sharp 4').querySelector('span')]) {
      for (const property of ['user-select', '-webkit-user-select', '-webkit-touch-callout']) {
        assert.equal(valuesFor(target, property).at(-1), 'none', `${property} protects ${target.className || target.tagName}`)
      }
    }
    for (const target of [document.querySelector('textarea'), document.querySelector('.tx-chart'), document.querySelector('.tx-keyboard-scroll'), document.querySelector('.tx-keyboard-scroll-rail')]) {
      for (const property of ['-webkit-user-select', '-webkit-touch-callout']) {
        assert.ok(!valuesFor(target, property).includes('none'), `${property} stays scoped to the playable keybed`)
      }
    }
  } finally { await app.close() }
})

test('repeat downs, cancel, lost capture and duplicate releases cannot leave or double-release notes', async () => {
  const app = await setup()
  try {
    const key = app.note('C sharp 4')
    await app.pointer(key, 'pointerdown', 2)
    await app.pointer(key, 'pointerdown', 2)
    assert.equal(app.starts.length, 1)
    await app.pointer(key, 'pointercancel', 2)
    await app.pointer(key, 'pointerup', 2)
    await app.pointer(key, 'lostpointercapture', 2)
    assert.equal(app.stops.length, 1)
    await app.pointer(key, 'pointerdown', 2)
    assert.notEqual(app.starts[0].id, app.starts[1].id, 'reused pointer IDs have new voice IDs')
    await app.pointer(key, 'lostpointercapture', 2)
    assert.deepEqual(app.stops, app.starts.map(note => note.id))
    assert.equal(key.getAttribute('aria-pressed'), 'false')
    await app.pointer(key, 'pointerdown', 3, { button: 2, pointerType: 'mouse' })
    assert.equal(app.starts.length, 2, 'a context-menu mouse button does not play a note')
  } finally { await app.close() }
})

test('pointer capture failures still release on global pointerup and cancel', async () => {
  const app = await setup()
  try {
    const key = app.note('D4')
    key.setPointerCapture = () => { throw new Error('Capture unavailable') }
    await app.pointer(key, 'pointerdown', 1)
    await app.pointer(app.window, 'pointerup', 1)
    await app.pointer(key, 'pointerdown', 2)
    await app.pointer(app.window, 'pointercancel', 2)
    assert.deepEqual(app.stops, app.starts.map(note => note.id))
    assert.equal(key.getAttribute('aria-pressed'), 'false')
  } finally { await app.close() }
})

test('Enter and Space sustain focused notes, ignore repeat, and release on blur', async () => {
  const app = await setup()
  try {
    const key = app.note('F4')
    await act(async () => key.focus())
    assert.equal((await app.key(key, 'keydown', 'Enter')).defaultPrevented, true)
    await app.key(key, 'keydown', 'Enter', { repeat: true })
    await app.key(key, 'keydown', 'Enter')
    assert.equal(app.starts.length, 1)
    assert.equal(key.getAttribute('aria-pressed'), 'true')
    assert.equal((await app.key(key, 'keyup', 'Enter')).defaultPrevented, true)
    assert.deepEqual(app.stops, [app.starts[0].id])
    await app.key(key, 'keydown', ' ')
    await app.key(key, 'keydown', ' ', { repeat: true })
    assert.equal(app.starts.length, 2)
    await app.key(key, 'keyup', ' ')
    assert.equal(app.stops.length, 2)
    await app.key(key, 'keydown', 'Enter')
    await app.key(key, 'keydown', ' ')
    await act(async () => key.blur())
    assert.deepEqual(app.stops, app.starts.map(note => note.id))
    await app.key(key, 'keydown', 'ArrowRight')
    await app.key(key, 'keydown', 'Enter', { ctrlKey: true })
    assert.equal(app.starts.length, 4)
    await app.click(key)
    assert.equal(app.starts.length, 4, 'the native click does not double-trigger a keyboard or pointer note')
  } finally { await app.close() }
})

test('disabling the keyboard releases all contacts and prevents new notes', async () => {
  const app = await setup()
  try {
    await app.pointer(app.note('A4'), 'pointerdown', 1)
    await app.key(app.note('B4'), 'keydown', ' ')
    await app.render({ disabled: true })
    assert.deepEqual(app.stops, app.starts.map(note => note.id))
    assert.equal(app.captured.size, 0)
    for (const button of document.querySelectorAll('button')) assert.equal(button.disabled, true)
    await app.pointer(app.note('A4'), 'pointerdown', 2)
    await app.key(app.note('B4'), 'keydown', 'Enter')
    assert.equal(app.starts.length, 2)
    await app.render({ disabled: false })
    await app.pointer(app.note('A4'), 'pointerdown', 2)
    assert.equal(app.starts.length, 3)
    await app.pointer(app.note('A4'), 'pointerup', 2)
  } finally { await app.close() }
})

test('octave changes release held notes and stay within C2–B7', async () => {
  const app = await setup()
  try {
    await app.pointer(app.note('C4'), 'pointerdown', 1)
    await app.click(app.button('Lower keyboard octave'))
    assert.deepEqual(app.stops, [app.starts[0].id])
    assert.ok(app.note('C3'))
    await app.click(app.button('Lower keyboard octave'))
    assert.equal(app.button('Lower keyboard octave').disabled, true)
    await app.click(app.button('Lower keyboard octave'))
    assert.ok(app.note('C2'))
    await app.pointer(app.note('C2'), 'pointerdown', 2)
    assert.equal(app.starts.at(-1).pitch, 36)
    for (let index = 0; index < 4; index++) await app.click(app.button('Raise keyboard octave'))
    assert.ok(app.note('C6'))
    assert.ok(app.note('B7'))
    assert.equal(app.button('Raise keyboard octave').disabled, true)
    await app.click(app.button('Raise keyboard octave'))
    await app.pointer(app.note('B7'), 'pointerdown', 3)
    assert.equal(app.starts.at(-1).pitch, 107)
  } finally { await app.close() }
})

test('window blur, hidden document, and unmount release every outstanding contact once', async () => {
  const app = await setup()
  let closed = false
  try {
    await app.pointer(app.note('C4'), 'pointerdown', 1)
    await app.pointer(app.note('E4'), 'pointerdown', 2)
    await act(async () => app.window.dispatchEvent(new app.window.Event('blur')))
    assert.equal(app.stops.length, 2)
    await app.pointer(app.note('G4'), 'pointerdown', 3)
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    await act(async () => document.dispatchEvent(new app.window.Event('visibilitychange')))
    assert.equal(app.stops.length, 3)
    await app.pointer(app.note('B4'), 'pointerdown', 4)
    await app.key(app.note('B4'), 'keydown', ' ')
    await app.close()
    closed = true
    assert.deepEqual(app.stops, app.starts.map(note => note.id))
    assert.equal(app.captured.size, 0)
  } finally { if (!closed) await app.close() }
})

test('changing callback props preserves held notes and uses the current release callback', async () => {
  const app = await setup()
  try {
    const latestStops = []
    await app.pointer(app.note('C4'), 'pointerdown', 1)
    await app.render({ onNoteOff: id => latestStops.push(id) })
    assert.equal(app.stops.length, 0)
    assert.equal(latestStops.length, 0)
    await app.pointer(app.window, 'pointerup', 1)
    assert.deepEqual(latestStops, [app.starts[0].id])
  } finally { await app.close() }
})
