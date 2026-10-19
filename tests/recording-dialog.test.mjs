import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import RecordingDialog from '../src/transcription/RecordingDialog.tsx'

async function setup({ strict = false, bodyStyle = null, htmlStyle = null, scrollX = 0, scrollY = 0 } = {}) {
  const dom = new JSDOM('<main id="background"><button id="record">Record melody</button><div id="chart"></div><div id="root"></div></main><aside id="already-inert" inert="prior-value" aria-hidden="false"></aside>', { url: 'https://test.example', pretendToBeVisual: true })
  const { window } = dom
  for (const name of ['window', 'document', 'navigator', 'HTMLElement']) Object.defineProperty(globalThis, name, { configurable: true, value: window[name] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  if (bodyStyle !== null) document.body.setAttribute('style', bodyStyle)
  if (htmlStyle !== null) document.documentElement.setAttribute('style', htmlStyle)
  Object.defineProperties(window, {
    scrollX: { configurable: true, writable: true, value: scrollX },
    scrollY: { configurable: true, writable: true, value: scrollY },
  })
  const scrolls = []
  window.scrollTo = options => {
    scrolls.push(options)
    window.scrollX = options.left
    window.scrollY = options.top
  }
  const focusCalls = []
  const focus = window.HTMLElement.prototype.focus
  window.HTMLElement.prototype.focus = function (options) {
    focusCalls.push({ element: this, options })
    focus.call(this, options)
  }
  const priorFocus = document.getElementById('record')
  priorFocus.focus()
  const chart = document.getElementById('chart')
  chart.scrollTop = 240
  chart.scrollLeft = 37
  const stops = []
  let props = {
    onStop: () => stops.push('initial'),
    status: 'Loading piano…',
    children: React.createElement('div', { role: 'group', 'aria-label': 'Piano keyboard' },
      React.createElement('button', { type: 'button', id: 'first-key' }, 'C4'),
      React.createElement('button', { type: 'button', disabled: true, id: 'disabled-key' }, 'Disabled note'),
      React.createElement('button', { type: 'button', hidden: true, id: 'hidden-key' }, 'Hidden note'),
      React.createElement('div', { style: { display: 'none' } }, React.createElement('button', { type: 'button' }, 'Hidden parent')),
      React.createElement('button', { type: 'button', id: 'last-key' }, 'E4')),
  }
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  let unmounted = false
  const render = async updates => {
    props = { ...props, ...updates }
    const child = React.createElement(RecordingDialog, props)
    await act(async () => root.render(strict ? React.createElement(React.StrictMode, null, child) : child))
  }
  await render({})
  return {
    window, root, stops, scrolls, focusCalls, priorFocus, chart, render,
    stop: () => document.querySelector('.tx-recording-stop'),
    dialog: () => document.querySelector('[role="dialog"]'),
    key: async (key, options = {}, target = document.activeElement) => {
      const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
      await act(async () => target.dispatchEvent(event))
      return event
    },
    unmount: async () => {
      if (unmounted) return
      await act(async () => root.unmount())
      unmounted = true
    },
    close: async () => {
      if (!unmounted) await act(async () => root.unmount())
      unmounted = true
      dom.window.close()
    },
  }
}

test('recording dialog portals to body, names its purpose and focuses Stop without scrolling', async () => {
  const app = await setup()
  try {
    assert.equal(app.dialog().parentElement.parentElement, document.body)
    assert.equal(app.dialog().getAttribute('aria-modal'), 'true')
    assert.equal(app.dialog().getAttribute('aria-label'), 'Record melody')
    const status = document.getElementById(app.dialog().getAttribute('aria-describedby'))
    assert.equal(status.getAttribute('role'), 'status')
    assert.equal(status.textContent, 'Loading piano…')
    assert.equal(document.activeElement, app.stop())
    assert.deepEqual(app.focusCalls.at(-1).options, { preventScroll: true })
    assert.equal(app.dialog().querySelectorAll('button:not([role="group"] button)').length, 1)
    assert.equal(app.stop().textContent, 'Stop recording')
  } finally { await app.close() }
})

test('Tab and Shift+Tab cycle through usable modal controls and skip disabled or hidden keys', async () => {
  const app = await setup()
  try {
    const first = document.getElementById('first-key')
    const last = document.getElementById('last-key')
    assert.equal((await app.key('Tab')).defaultPrevented, true)
    assert.equal(document.activeElement, first)
    await app.key('Tab')
    assert.equal(document.activeElement, last)
    await app.key('Tab')
    assert.equal(document.activeElement, app.stop())
    await app.key('Tab', { shiftKey: true })
    assert.equal(document.activeElement, last)
    await app.key('Tab', { shiftKey: true })
    assert.equal(document.activeElement, first)
    assert.deepEqual(app.focusCalls.at(-1).options, { preventScroll: true })
    app.priorFocus.focus()
    assert.equal(document.activeElement, app.stop(), 'programmatic focus cannot escape the dialog')
    assert.equal((await app.key('c')).defaultPrevented, false, 'piano key input is unaffected')
  } finally { await app.close() }
})

test('background siblings are inert and hidden while mounted, including new siblings, with exact attributes restored', async () => {
  const app = await setup()
  try {
    const background = document.getElementById('background')
    const existing = document.getElementById('already-inert')
    for (const element of [background, existing]) {
      assert.equal(element.getAttribute('inert'), '')
      assert.equal(element.getAttribute('aria-hidden'), 'true')
    }
    assert.equal(app.dialog().closest('[inert]'), null)
    const added = document.createElement('aside')
    await act(async () => document.body.appendChild(added))
    assert.equal(added.hasAttribute('inert'), true)
    assert.equal(added.getAttribute('aria-hidden'), 'true')
    await app.unmount()
    assert.equal(background.getAttribute('inert'), null)
    assert.equal(background.getAttribute('aria-hidden'), null)
    assert.equal(existing.getAttribute('inert'), 'prior-value')
    assert.equal(existing.getAttribute('aria-hidden'), 'false')
    assert.equal(added.hasAttribute('inert'), false)
    assert.equal(added.hasAttribute('aria-hidden'), false)
  } finally { await app.close() }
})

test('unmount restores exact body and root styles, horizontal and vertical page scroll, nested chart scroll, and focus', async () => {
  const bodyStyle = 'color: green; position: relative; top: 3px; overflow: auto;'
  const htmlStyle = 'scroll-behavior: smooth; overflow: auto;'
  const app = await setup({ bodyStyle, htmlStyle, scrollX: 19, scrollY: 935 })
  try {
    assert.equal(document.body.style.position, 'fixed')
    assert.equal(document.body.style.top, '-935px')
    assert.equal(document.body.style.left, '-19px')
    assert.equal(document.body.style.overflow, 'hidden')
    assert.equal(document.documentElement.style.overflow, 'hidden')
    app.window.scrollX = 0
    app.window.scrollY = 0
    await app.unmount()
    assert.equal(document.body.getAttribute('style'), bodyStyle)
    assert.equal(document.documentElement.getAttribute('style'), htmlStyle)
    assert.deepEqual(app.scrolls, [{ left: 19, top: 935, behavior: 'instant' }])
    assert.equal(app.window.scrollX, 19)
    assert.equal(app.window.scrollY, 935)
    assert.equal(app.chart.scrollTop, 240)
    assert.equal(app.chart.scrollLeft, 37)
    assert.equal(document.activeElement, app.priorFocus)
    assert.deepEqual(app.focusCalls.at(-1).options, { preventScroll: true })
    assert.equal(document.querySelector('.tx-recording-portal'), null)
    assert.deepEqual(app.stops, [], 'cleanup does not duplicate the parent’s save/stop action')
  } finally { await app.close() }
})

test('Escape and Stop use the latest callback without remounting the modal or disrupting focus on status updates', async () => {
  const app = await setup({ scrollX: 9, scrollY: 712 })
  try {
    const panel = app.dialog()
    const first = document.getElementById('first-key')
    first.focus()
    const focusCount = app.focusCalls.length
    const lockedStyle = document.body.getAttribute('style')
    app.window.scrollX = 0
    app.window.scrollY = 0
    await app.render({ status: 'Recording · bar 4', onStop: () => app.stops.push('latest') })
    assert.equal(app.dialog(), panel)
    assert.equal(document.activeElement, first)
    assert.equal(app.focusCalls.length, focusCount)
    assert.equal(document.body.getAttribute('style'), lockedStyle)
    assert.deepEqual(app.scrolls, [])
    assert.equal(document.querySelector('[role="status"]').textContent, 'Recording · bar 4')
    assert.equal((await app.key('Escape')).defaultPrevented, true)
    await app.key('Escape', { repeat: true })
    assert.deepEqual(app.stops, ['latest'])
    await act(async () => app.stop().click())
    assert.deepEqual(app.stops, ['latest', 'latest'])
    await app.unmount()
    assert.equal(app.window.scrollY, 712, 'the original page position survives callback/status rerenders')
    await app.key('Escape', {}, document)
    assert.deepEqual(app.stops, ['latest', 'latest'], 'unmount removes keyboard listeners')
  } finally { await app.close() }
})

test('StrictMode effect replay leaves one usable modal and restores absent styles and background attributes', async () => {
  const app = await setup({ strict: true, scrollY: 420 })
  try {
    assert.equal(document.querySelectorAll('.tx-recording-portal').length, 1)
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 1)
    assert.equal(document.activeElement, app.stop())
    assert.equal(document.getElementById('background').hasAttribute('inert'), true)
    assert.deepEqual(app.stops, [])
    app.window.scrollY = 0
    await app.unmount()
    assert.equal(document.body.getAttribute('style'), null)
    assert.equal(document.documentElement.getAttribute('style'), null)
    assert.equal(document.getElementById('background').hasAttribute('inert'), false)
    assert.equal(document.getElementById('already-inert').getAttribute('inert'), 'prior-value')
    assert.equal(document.activeElement, app.priorFocus)
    assert.equal(app.window.scrollY, 420)
  } finally { await app.close() }
})

test('navigation unmount is safe when the previous focused control was removed', async () => {
  const app = await setup({ scrollY: 680 })
  try {
    app.priorFocus.remove()
    app.window.scrollY = 0
    await app.unmount()
    assert.equal(app.window.scrollY, 680)
    assert.equal(document.body.style.position, '')
    assert.equal(document.getElementById('background').hasAttribute('inert'), false)
    const control = document.createElement('button')
    document.body.appendChild(control)
    control.focus()
    assert.equal(document.activeElement, control, 'cleanup removes focus trapping')
  } finally { await app.close() }
})

test('modal layout fills the dynamic viewport, reserves safe areas and keeps Stop outside the keyboard scroller', () => {
  const css = readFileSync(new URL('../src/transcription/recording-dialog.css', import.meta.url), 'utf8')
  assert.match(css, /\.tx-recording-dialog\s*\{[^}]*position:\s*fixed/s)
  assert.match(css, /height:\s*100dvh/)
  assert.match(css, /grid-template-rows:\s*auto minmax\(0, 1fr\)/)
  assert.match(css, /\.tx-recording-header\s*\{[^}]*position:\s*sticky/s)
  for (const edge of ['top', 'right', 'bottom', 'left']) assert.ok(css.includes(`safe-area-inset-${edge}`))
  assert.match(css, /\.tx-recording-dialog \.tx-keyboard-scroll\s*\{[^}]*overflow-x:\s*auto/s)
  assert.match(css, /@media\s*\(max-height:\s*480px\)/)
})
