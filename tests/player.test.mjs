import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QuizPlayer } from '../src/ear-training/player.ts'
import { installAudioMock } from './audio-mock.mjs'

let fixtureId = 0
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
const response = () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16) })
const note = (overrides = {}) => ({ midi: 60, program: 0, startSeconds: 0.25, durationSeconds: 1.2, velocity: 80, ...overrides })

function setup(t, options = {}, notes = [note(), note({ startSeconds: 1.75 }), note({ program: 48, midi: 64, startSeconds: 2.5 })]) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const window = { location: new URL('https://audio.example/') }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window })
  const audio = installAudioMock(window, options)
  const sequence = { durationSeconds: 4, notes }
  const manifest = Object.fromEntries(notes.map(event => [`${event.program}:${event.midi}`, `/samples/fixture-${++fixtureId}-${event.program}-${event.midi}.wav`]))
  const states = []
  const players = []
  const create = (seq = sequence, map = manifest) => {
    const player = new QuizPlayer(seq, map, state => states.push(state))
    players.push(player)
    return player
  }
  const player = create()
  t.after(() => {
    players.forEach(instance => instance.dispose())
    audio.restore()
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
  })
  return { ...audio, audio, window, sequence, manifest, states, player, create }
}

test('construction and paused seek are silent; play resumes inside its direct call', async t => {
  const { player, contexts, sources, fetches, gains } = setup(t)
  assert.deepEqual(player.state, { playing: false, loading: false, error: null, position: 0, duration: 4 })
  player.seek(0.5)
  assert.equal(contexts.length, 0)
  assert.equal(fetches.length, 0)
  const playing = player.play()
  assert.equal(contexts.length, 1, 'context is created before play returns')
  assert.equal(contexts[0].resumeCalls, 1, 'resume happens before any asynchronous loading')
  assert.equal(player.state.loading, true)
  await playing
  assert.equal(player.state.playing, true)
  assert.equal(player.state.loading, false)
  assert.equal(fetches.length, 2, 'each instrument/pitch is loaded once')
  assert.equal(sources.length, 3)
  assert.equal(sources[0].starts[0].offset, 0.25, 'seek resumes inside the sampled note')
  assert.ok(fetches.every(item => item.url.startsWith('https://audio.example/samples/')))
  assert.ok(fetches.every(item => item.init.redirect === 'error'))
  assert.equal(gains[0].gain.events.at(-1)[1], 0, 'every note releases to zero gain')
})

test('repeat play does not overlap; pause preserves position and stops future sources', async t => {
  const { player, audio, sources, contexts } = setup(t)
  await player.play()
  const firstVoices = [...sources]
  await player.play()
  assert.equal(sources.length, 3)
  audio.advance(0.82)
  player.pause()
  assert.ok(Math.abs(player.state.position - 0.8) < 1e-10)
  assert.equal(player.state.playing, false)
  assert.ok(firstVoices.every(source => source.stopped && source.disconnected && source.onended === null))
  await player.play()
  assert.equal(contexts.length, 1)
  assert.equal(contexts[0].resumeCalls, 1, 'a running context needs no extra resume')
  assert.ok(Math.abs(sources[3].starts[0].offset - 0.55) < 1e-10)
})

test('seek replaces scheduled sources, clamps bounds, and never resumes a paused context', async t => {
  const { player, sources, contexts } = setup(t)
  await player.play()
  const old = [...sources]
  player.seek(1)
  assert.ok(old.every(source => source.stopped && source.disconnected))
  assert.equal(player.state.position, 1)
  assert.equal(player.state.playing, true)
  assert.equal(sources[3].starts[0].offset, 0.75)
  player.seek(100)
  assert.equal(player.state.position, 4)
  assert.equal(player.state.playing, false)
  player.seek(-10)
  assert.equal(player.state.position, 0)
  player.seek(Number.NaN)
  assert.equal(player.state.position, 0)
  assert.equal(contexts[0].resumeCalls, 1)
})

test('Replay and another player each replace prior playback without overlapping sources', async t => {
  const { player, create, sources, contexts } = setup(t)
  await player.play()
  const first = [...sources]
  await player.replay()
  assert.equal(player.state.position, 0)
  assert.ok(first.every(source => source.stopped && source.disconnected))
  const second = create()
  const previous = [...sources]
  await second.play()
  assert.equal(player.state.playing, false)
  assert.equal(second.state.playing, true)
  assert.ok(previous.every(source => source.stopped && source.disconnected))
  assert.equal(contexts.length, 2)
})

test('pause during fetch cancels pending play even when fetch ignores abort', async t => {
  const pending = deferred()
  const { player, sources, fetches } = setup(t, { fetch: () => pending.promise }, [note()])
  const playing = player.play()
  player.pause()
  await playing
  assert.equal(fetches[0].init.signal.aborted, true)
  assert.equal(player.state.loading, false)
  assert.equal(player.state.error, null)
  pending.resolve(response())
  await flush()
  assert.equal(sources.length, 0)
  assert.equal(player.state.playing, false)
})

test('dispose during decode closes the context and cannot update or autoplay later', async t => {
  const pending = deferred()
  const { player, contexts, sources, states } = setup(t, { decode: () => pending.promise }, [note()])
  const playing = player.play()
  await flush()
  assert.equal(contexts[0].decodeCalls, 1)
  player.dispose()
  await playing
  const stateCount = states.length
  pending.resolve({ duration: 4 })
  await flush()
  await player.play()
  await player.replay()
  player.seek(1)
  player.pause()
  player.dispose()
  assert.equal(contexts[0].closeCalls, 1)
  assert.equal(contexts[0].onstatechange, null)
  assert.equal(sources.length, 0)
  assert.equal(states.length, stateCount)
})

test('seek during load cancels autoplay and a later direct play can retry', async t => {
  const pending = deferred()
  let calls = 0
  const { player, sources } = setup(t, { fetch: () => ++calls === 1 ? pending.promise : Promise.resolve(response()) }, [note()])
  const stale = player.play()
  player.seek(0.9)
  await stale
  await player.play()
  assert.equal(player.state.playing, true)
  assert.equal(player.state.position, 0.9)
  const count = sources.length
  pending.resolve(response())
  await flush()
  assert.equal(sources.length, count, 'stale request cannot schedule a second copy')
})

test('pause during a pending browser resume prevents delayed playback', async t => {
  const pending = deferred()
  const { player, contexts, sources } = setup(t, { resume: () => pending.promise }, [note()])
  const playing = player.play()
  await flush()
  player.pause()
  await playing
  contexts[0].state = 'running'
  pending.resolve()
  await flush()
  assert.equal(sources.length, 0)
  assert.equal(player.state.playing, false)
})

test('network and decoding failures show a retryable error, not a poisoned cache', async t => {
  let fetchCount = 0, decodeCount = 0
  const { player, sources } = setup(t, {
    fetch: async () => ++fetchCount === 1 ? { ok: false, status: 404 } : response(),
    decode: async () => { if (++decodeCount === 1) throw new Error('Unsupported file'); return { duration: 4 } },
  }, [note()])
  await player.play()
  assert.match(player.state.error, /could not load/)
  await player.play()
  assert.match(player.state.error, /could not load/)
  assert.equal(sources.length, 0)
  await player.play()
  assert.equal(player.state.error, null)
  assert.equal(player.state.playing, true)
  assert.equal(fetchCount, 3)
  assert.equal(decodeCount, 2)
})

test('prefixed Safari context and callback-only decoding work', async t => {
  const { player, contexts, sources } = setup(t, { webkitOnly: true, callbackDecode: true }, [note()])
  await player.play()
  assert.equal(player.state.error, null)
  assert.equal(player.state.playing, true)
  assert.equal(contexts.length, 1)
  assert.equal(sources.length, 1)
})

test('completion stops and disconnects all sources and a new play starts at zero', async t => {
  const { player, audio, sources } = setup(t)
  await player.play()
  const old = [...sources]
  audio.advance(5)
  await new Promise(resolve => setTimeout(resolve, 65))
  assert.equal(player.state.position, 4)
  assert.equal(player.state.playing, false)
  assert.ok(old.every(source => source.disconnected && source.onended === null))
  await player.play()
  assert.equal(player.state.position, 0)
  assert.equal(player.state.playing, true)
})

test('external samples, missing samples and unsupported browsers fail safely', async t => {
  const { create, sequence, fetches, window } = setup(t, {}, [note()])
  const external = create(sequence, { '0:60': 'https://third-party.example/sample.wav' })
  await external.play()
  assert.match(external.state.error, /hosted with this app/)
  assert.equal(fetches.length, 0)
  const missing = create(sequence, {})
  await missing.play()
  assert.match(missing.state.error, /missing/)
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined })
  const unsupported = create()
  await unsupported.play()
  assert.match(unsupported.state.error, /does not support/)
})

test('browser interruption pauses and cleans up; it never resumes itself', async t => {
  const { player, contexts, sources } = setup(t)
  await player.play()
  contexts[0].state = 'suspended'
  contexts[0].onstatechange()
  assert.equal(player.state.playing, false)
  assert.ok(sources.every(source => source.stopped && source.disconnected))
  assert.equal(contexts[0].resumeCalls, 1)
})

test('a successful decoded sample is reusable across examples without a second network fetch', async t => {
  const { player, create, fetches } = setup(t, {}, [note()])
  await player.play()
  player.dispose()
  const second = create()
  await second.play()
  assert.equal(fetches.length, 1)
  assert.equal(second.state.playing, true)
})
