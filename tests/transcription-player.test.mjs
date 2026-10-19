import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChordPlayer } from '../src/transcription/player.ts'
import { installAudioMock } from './audio-mock.mjs'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

function setup(t, options = {}) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const window = {}
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window })
  const audio = installAudioMock(window, options)
  const Context = window.AudioContext || window.webkitAudioContext
  // Extend the shared observable double locally; other feature tests are unchanged.
  Context.prototype.createOscillator = function () {
    if (options.createOscillator) options.createOscillator()
    const source = this.createBufferSource()
    source.frequency = {
      events: [],
      setValueAtTime(value, time) { this.events.push(['set', value, time]) },
    }
    return source
  }
  const createGain = Context.prototype.createGain
  Context.prototype.createGain = function () {
    if (options.createGain) options.createGain()
    const gain = createGain.call(this)
    gain.gain.cancelScheduledValues = function (time) { this.events.push(['cancel', time]) }
    return gain
  }
  const player = new ChordPlayer()
  t.after(() => {
    player.dispose()
    audio.restore()
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
  })
  return { ...audio, audio, player, window }
}

test('audition creates/resumes synchronously, uses exact pitches, and needs no assets', async t => {
  const { player, contexts, sources, gains, fetches } = setup(t)
  assert.equal(contexts.length, 0)
  const playing = player.play([60, 64, 67, 60])
  assert.equal(contexts.length, 1)
  assert.equal(contexts[0].resumeCalls, 1, 'resume is called before play returns its promise')
  assert.equal(sources.length, 0)
  await playing
  assert.equal(sources.length, 3, 'duplicate MIDI pitches are not layered')
  assert.equal(fetches.length, 0)
  sources.forEach((source, i) => {
    assert.equal(source.type, 'triangle')
    assert.equal(source.frequency.events[0][1], 440 * 2 ** (([60, 64, 67][i] - 69) / 12))
    assert.equal(source.starts[0].when, 0)
    assert.equal(source.stops[0], 1.4)
    assert.deepEqual(gains[i].gain.events.at(-1), ['ramp', 0, 1.4])
    assert.equal(source.connections[0], gains[i])
    assert.equal(gains[i].connections[0], contexts[0].destination)
  })
})

test('a newer click wins while prior resume remains pending, including stale rejection', async t => {
  const first = deferred(), second = deferred()
  let calls = 0
  const { player, contexts, sources } = setup(t, { resume: () => ++calls === 1 ? first.promise : second.promise })
  const stale = player.play([60])
  const latest = player.play([69])
  assert.equal(contexts[0].resumeCalls, 2)
  await stale
  assert.equal(sources.length, 0)
  contexts[0].state = 'running'
  second.resolve()
  await latest
  assert.equal(sources.length, 1)
  assert.equal(sources[0].frequency.events[0][1], 440)
  first.reject(new Error('An obsolete activation failed'))
  await flush()
  assert.equal(sources.length, 1)
})

test('stop cancels pending resume promptly and late resolution cannot start audio', async t => {
  const pending = deferred()
  const { player, contexts, sources } = setup(t, { resume: () => pending.promise })
  const playing = player.play([60])
  player.stop()
  await playing
  contexts[0].state = 'running'
  pending.resolve()
  await flush()
  assert.equal(sources.length, 0)
  await player.play([72])
  assert.equal(sources.length, 1)
})

test('rapid replacements release old chords without extending their tails', async t => {
  const { player, audio, contexts, sources, gains } = setup(t)
  await player.play([60, 64, 67])
  const first = [...sources]
  audio.advance(0.1)
  await player.play([62])
  const firstStop = first[0].stops.at(-1)
  assert.ok(Math.abs(firstStop - 0.135) < 1e-10)
  assert.ok(gains[0].gain.events.some(event => event[0] === 'cancel'))
  assert.deepEqual(gains[0].gain.events.at(-1), ['ramp', 0, firstStop])
  await player.play([65])
  assert.equal(first[0].stops.at(-1), firstStop, 'another replacement does not restart a release tail')
  assert.equal(contexts.length, 1)
  assert.equal(contexts[0].resumeCalls, 1)
  audio.advance(0.04)
  assert.ok(sources.slice(0, -1).every(source => source.disconnected && source.onended === null))
  assert.equal(sources.at(-1).disconnected, false)
  player.stop()
  audio.advance(0.04)
  assert.ok(sources.every(source => source.disconnected))
  assert.ok(gains.every(gain => gain.disconnected))
})

test('natural completion disconnects every oscillator and gain', async t => {
  const { player, audio, sources, gains } = setup(t)
  await player.play([48, 60, 64, 67])
  audio.advance(1.5)
  assert.ok(sources.every(source => source.stopped && source.disconnected && source.onended === null))
  assert.ok(gains.every(gain => gain.disconnected))
  await player.play([69])
  assert.equal(sources.length, 5)
})

test('fallback cleanup releases nodes even if the browser never delivers onended', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { player, sources, gains } = setup(t)
  await player.play([60, 64])
  t.mock.timers.tick(1500)
  assert.ok(sources.every(source => source.stopped && source.disconnected && source.onended === null))
  assert.ok(gains.every(gain => gain.disconnected))
  await player.play([67])
  player.stop()
  t.mock.timers.tick(135)
  assert.equal(sources.at(-1).disconnected, true)
})

test('dispose cancels pending activation and closes once; later calls stay silent', async t => {
  const pending = deferred()
  const { player, contexts, sources } = setup(t, { resume: () => pending.promise })
  const playing = player.play([60])
  player.dispose()
  await playing
  pending.resolve()
  await flush()
  await player.play([64])
  player.stop()
  player.dispose()
  assert.equal(contexts[0].closeCalls, 1)
  assert.equal(contexts[0].onstatechange, null)
  assert.equal(sources.length, 0)
})

test('dispose cleans up sounding and already-releasing voices immediately', async t => {
  const { player, sources, gains, contexts } = setup(t)
  await player.play([60, 64])
  await player.play([67])
  player.dispose()
  assert.ok(sources.every(source => source.stopped && source.disconnected && source.onended === null))
  assert.ok(gains.every(gain => gain.disconnected))
  assert.equal(contexts[0].closeCalls, 1)
})

test('unsupported browsers, failed activation and invalid notes reject to the caller', async t => {
  const { player, window, contexts } = setup(t, { resume: async () => { throw new Error('Activation blocked') } })
  for (const note of [-1, 128, 60.5, NaN, Infinity]) await assert.rejects(player.play([note]), /invalid MIDI pitch/)
  assert.equal(contexts.length, 0)
  await player.play([])
  assert.equal(contexts.length, 0)
  await assert.rejects(player.play([60]), /Activation blocked/)
  player.dispose()
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined })
  const unsupported = new ChordPlayer()
  await assert.rejects(unsupported.play([60]), /does not support audio/)
  unsupported.dispose()
})

test('prefixed Safari context is supported and a paused resume result is an error', async t => {
  const { player, contexts, sources } = setup(t, { webkitOnly: true })
  await player.play([69])
  assert.equal(sources.length, 1)
  contexts[0].state = 'suspended'
  contexts[0].onstatechange()
  assert.ok(sources.every(source => source.stopped && source.disconnected))
  contexts[0].resume = () => Promise.resolve()
  await assert.rejects(player.play([60]), /browser paused audio/)
})

test('input mutation during activation does not change the requested pitches', async t => {
  const pending = deferred()
  const { player, contexts, sources } = setup(t, { resume: () => pending.promise })
  const notes = [69]
  const playing = player.play(notes)
  notes[0] = 60
  contexts[0].state = 'running'
  pending.resolve()
  await playing
  assert.equal(sources[0].frequency.events[0][1], 440)
})

test('partial scheduling failure cleans already-created nodes and permits retry', async t => {
  let count = 0
  const { player, sources, gains } = setup(t, { createGain: () => {
    if (++count === 2) throw new Error('Audio node unavailable')
  } })
  await assert.rejects(player.play([60, 64]), /Audio node unavailable/)
  assert.ok(sources.every(source => source.disconnected))
  assert.ok(gains.every(gain => gain.disconnected))
  await player.play([69])
  assert.equal(sources.length, 3)
  assert.equal(sources.at(-1).disconnected, false)
})
