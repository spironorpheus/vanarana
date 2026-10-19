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
  const window = { location: { href: 'https://test.example/chords/', origin: 'https://test.example' } }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window })
  const audio = installAudioMock(window, {
    ...options,
    fetch: options.fetch ?? (async url => ({ ok: true, status: 200,
      arrayBuffer: async () => new Uint8Array([Number(new URL(url).pathname.match(/0-(\d+)\.wav$/)?.[1] ?? 60)]).buffer })),
    decode: options.decode ?? (bytes => ({ duration: 4, midi: new Uint8Array(bytes)[0] })),
  })
  const Context = window.AudioContext || window.webkitAudioContext
  // Extend the shared observable double locally; other feature tests are unchanged.
  const param = () => ({ events: [], setValueAtTime(value, time) { this.events.push(['set', value, time]) } })
  const createBufferSource = Context.prototype.createBufferSource
  Context.prototype.createBufferSource = function () {
    if (options.createBufferSource) options.createBufferSource()
    const source = createBufferSource.call(this)
    source.kind = 'piano'
    source.playbackRate = param()
    return source
  }
  Context.prototype.createOscillator = function () {
    if (options.createOscillator) options.createOscillator()
    const source = createBufferSource.call(this)
    source.kind = 'click'
    source.frequency = param()
    return source
  }
  const createGain = Context.prototype.createGain
  Context.prototype.createGain = function () {
    if (options.createGain) options.createGain()
    const gain = createGain.call(this)
    gain.gain.cancelScheduledValues = function (time) { this.events.push(['cancel', time]) }
    return gain
  }
  const player = new ChordPlayer(options.manifest)
  t.after(() => {
    player.dispose()
    audio.restore()
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
  })
  return { ...audio, audio, player, window }
}

test('audition creates/resumes synchronously and plays exact bundled piano samples', async t => {
  const { player, contexts, sources, gains, fetches } = setup(t)
  assert.equal(contexts.length, 0)
  const playing = player.play([60, 64, 67, 60])
  assert.equal(contexts.length, 1)
  assert.equal(contexts[0].resumeCalls, 1, 'resume is called before play returns its promise')
  assert.equal(sources.length, 0)
  await playing
  assert.equal(sources.length, 3, 'duplicate MIDI pitches are not layered')
  assert.equal(fetches.length, 3)
  sources.forEach((source, i) => {
    assert.equal(source.kind, 'piano')
    assert.equal(source.loop, false)
    assert.equal(source.buffer.midi, [60, 64, 67][i])
    assert.equal(source.playbackRate.events[0][1], 1)
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
  assert.equal(sources[0].buffer.midi, 69)
  assert.equal(sources[0].playbackRate.events[0][1], 1)
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

test('natural completion disconnects every sample source and gain', async t => {
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
  assert.equal(sources[0].buffer.midi, 69)
  assert.equal(sources[0].playbackRate.events[0][1], 1)
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

test('prepare activates synchronously without notes and cancellation suppresses late failures', async t => {
  const pending = deferred()
  const { player, contexts, sources } = setup(t, { resume: () => pending.promise })
  const ready = player.prepare()
  assert.equal(contexts.length, 1)
  assert.equal(contexts[0].resumeCalls, 1)
  assert.equal(sources.length, 0)
  player.stop(true)
  await ready
  pending.reject(new Error('Obsolete activation'))
  await flush()
  contexts[0].state = 'running'
  await player.prepare()
  assert.equal(sources.length, 0)
  await player.play([69])
  assert.equal(sources.length, 1)
})

test('sequence durations have a bounded release and never extend on stop', async t => {
  const { player, audio, sources, gains } = setup(t)
  await player.play([60], { durationSeconds: 4 })
  assert.equal(sources[0].stops[0], 4)
  assert.deepEqual(gains[0].gain.events.at(-2), ['set', 0.65, 3.965])
  assert.deepEqual(gains[0].gain.events.at(-1), ['ramp', 0, 4])
  audio.advance(3.99)
  player.stop()
  assert.equal(sources[0].stops.at(-1), 4, 'release cannot extend the scheduled duration')
  audio.advance(0.02)
  assert.equal(sources[0].disconnected, true)
  await player.play([64], { durationSeconds: 0.01 })
  const envelope = gains.at(-1).gain.events
  assert.ok(envelope.every((event, i) => i === 0 || event[2] >= envelope[i - 1][2]), 'short note envelope is monotonic')
  audio.advance(0.02)
  assert.equal(sources.at(-1).disconnected, true)
})

test('immediate stop cuts every voice without a release tail and invalid durations reject', async t => {
  const { player, sources, gains } = setup(t)
  for (const durationSeconds of [0, -1, NaN, Infinity]) {
    await assert.rejects(player.play([60], { durationSeconds }), /duration must be a positive number/)
  }
  await player.play([60, 64, 67], { durationSeconds: 2 })
  player.stop(true)
  assert.ok(sources.every(source => source.stopped && source.disconnected && source.stops.at(-1) === undefined))
  assert.ok(gains.every(gain => gain.disconnected))
})

test('nearest piano samples preserve arbitrary key and bass pitches with playbackRate', async t => {
  const { player, sources, fetches } = setup(t)
  const notes = [0, 36, 41, 48, 53, 58, 60, 66, 71, 76, 127]
  const expectedSamples = [40, 40, 40, 47, 52, 57, 60, 66, 71, 75, 75]
  await player.play(notes)
  assert.equal(fetches.length, new Set(expectedSamples).size, 'a sample shared by several pitches loads once')
  sources.forEach((source, i) => {
    assert.equal(source.buffer.midi, expectedSamples[i])
    assert.equal(source.playbackRate.events[0][1], 2 ** ((notes[i] - expectedSamples[i]) / 12))
    assert.equal(source.loop, false)
  })
})

test('prepare preloads the entire existing piano bank and subsequent chords schedule synchronously', async t => {
  const { player, contexts, sources, fetches } = setup(t)
  const prepared = player.prepare()
  assert.equal(contexts[0].resumeCalls, 1)
  assert.equal(sources.length, 0)
  await prepared
  assert.equal(fetches.length, 26)
  assert.equal(contexts[0].decodeCalls, 26)
  assert.ok(fetches.every(({ url, init }) => new URL(url).pathname.startsWith('/audio/instruments/0-') &&
    init.credentials === 'same-origin' && init.redirect === 'error'))
  contexts[0].currentTime = 7
  const playing = player.play([0, 36, 54, 60, 76, 127], { durationSeconds: 2 })
  assert.equal(sources.length, 6, 'prepared playback schedules before returning, without a microtask delay')
  assert.ok(sources.every(source => source.starts[0].when === 7))
  await playing
  await player.prepare()
  assert.equal(fetches.length, 26, 'successful samples are reused for later charts and auditions')
})

test('prepare does not resolve until its last sample is decoded', async t => {
  const pending = deferred()
  const { player, contexts, sources } = setup(t, {
    manifest: { '0:60': '/chords/audio/instruments/0-60.wav' }, decode: () => pending.promise,
  })
  let ready = false
  const prepared = player.prepare().then(() => { ready = true })
  await flush()
  assert.equal(contexts[0].decodeCalls, 1)
  assert.equal(ready, false)
  assert.equal(sources.length, 0)
  contexts[0].currentTime = 5
  pending.resolve({ duration: 2.5 })
  await prepared
  const playing = player.play([63])
  assert.equal(sources.length, 1)
  assert.equal(sources[0].starts[0].when, 5)
  await playing
})

test('local subpath sample URLs are preserved and remote, redirected, or missing assets fail safely', async t => {
  const { player, fetches } = setup(t, { manifest: { '0:60': '/chords/audio/instruments/0-60.wav' } })
  await player.play([60])
  assert.equal(fetches[0].url, 'https://test.example/chords/audio/instruments/0-60.wav')
  for (const manifest of [
    { '0:60': 'https://other.example/0-60.wav' },
    { '0:60': 'data:audio/wav;base64,AAAA' },
    { '0:60': 'file:///0-60.wav' },
  ]) {
    const unsafe = new ChordPlayer(manifest)
    await assert.rejects(unsafe.play([60]), /hosted with this app/)
    unsafe.dispose()
  }
  for (const manifest of [{}, { '40:60': '/audio/40-60.wav' }, { '0:60': '' }]) {
    const missing = new ChordPlayer(manifest)
    await assert.rejects(missing.play([60]), /piano sample is missing/)
    await assert.rejects(missing.prepare(), /piano sample is missing/)
    missing.dispose()
  }
  assert.equal(fetches.length, 1, 'untrusted or missing sample paths never reach fetch')
})

test('fetch failure aborts the current bank load and can be retried', async t => {
  let failed = true
  const { player, fetches, sources } = setup(t, { fetch: async () => failed
    ? { ok: false, status: 404 }
    : { ok: true, arrayBuffer: async () => new ArrayBuffer(1) } })
  await assert.rejects(player.play([60]), /piano sample could not load.*try playing again/)
  assert.equal(fetches[0].init.signal.aborted, true)
  assert.equal(sources.length, 0)
  failed = false
  await player.play([60])
  assert.equal(fetches.length, 2)
  assert.equal(sources.length, 1)
})

test('decoder failures and empty samples are retryable, including callback-only Safari decode', async t => {
  let result = 'reject'
  const { player, contexts, sources, fetches } = setup(t, { callbackDecode: true, decode: () => {
    if (result === 'reject') throw new Error('Unsupported WAV')
    return { duration: result === 'empty' ? 0 : 4 }
  } })
  await assert.rejects(player.play([60]), /piano sample could not load/)
  result = 'empty'
  await assert.rejects(player.play([60]), /piano sample could not load/)
  result = 'okay'
  await player.play([60])
  assert.equal(contexts[0].decodeCalls, 3)
  assert.equal(fetches.length, 3)
  assert.equal(sources.length, 1)
})

test('a newer play aborts a pending fetch and stale responses cannot start or cache audio', async t => {
  const pending = deferred()
  let first = true
  const { player, sources, contexts, fetches } = setup(t, { fetch: async url => {
    if (first) { first = false; return pending.promise }
    return { ok: true, arrayBuffer: async () => new Uint8Array([Number(new URL(url).pathname.match(/0-(\d+)\.wav$/)[1])]).buffer }
  } })
  const stale = player.play([60])
  const latest = player.play([69])
  await stale
  assert.equal(fetches[0].init.signal.aborted, true)
  await latest
  assert.equal(sources.length, 1)
  assert.equal(sources[0].buffer.midi, 69)
  pending.resolve({ ok: true, arrayBuffer: async () => { throw new Error('Stale response must not be read') } })
  await flush()
  assert.equal(contexts[0].decodeCalls, 1)
  await player.play([60])
  assert.equal(fetches.length, 3, 'the abandoned sample is fetched again')
  assert.equal(sources.at(-1).buffer.midi, 60)
})

test('stop cancels response-body loading promptly and retry remains available', async t => {
  const body = deferred()
  let first = true
  const { player, contexts, sources, fetches } = setup(t, { fetch: async () => ({ ok: true,
    arrayBuffer: () => { if (first) { first = false; return body.promise }; return Promise.resolve(new ArrayBuffer(1)) },
  }) })
  const playing = player.play([60])
  await flush()
  player.stop(true)
  await playing
  body.reject(new Error('Obsolete body'))
  await flush()
  assert.equal(contexts[0].decodeCalls, 0)
  assert.equal(sources.length, 0)
  await player.play([60])
  assert.equal(fetches.length, 2)
  assert.equal(sources.length, 1)
})

test('cancelled decode cannot populate cache or start a superseded chord', async t => {
  const pending = deferred()
  let calls = 0
  const { player, sources, fetches } = setup(t, { decode: () => ++calls === 1 ? pending.promise : { duration: 4 } })
  const stale = player.play([60])
  await flush()
  const latest = player.play([69])
  await stale
  await latest
  assert.equal(sources.length, 1)
  pending.resolve({ duration: 100 })
  await flush()
  await player.play([60])
  assert.equal(fetches.length, 3)
  assert.equal(sources.at(-1).buffer.duration, 4)
})

test('dispose during bank decoding settles prepare promptly and ignores late rejection', async t => {
  const pending = deferred()
  const { player, contexts, sources, fetches } = setup(t, { decode: () => pending.promise })
  const prepared = player.prepare()
  await flush()
  player.dispose()
  await prepared
  assert.ok(fetches.every(fetch => fetch.init.signal.aborted))
  pending.reject(new Error('Obsolete decoder'))
  await flush()
  assert.equal(contexts[0].closeCalls, 1)
  assert.equal(sources.length, 0)
  await player.prepare()
  assert.equal(contexts.length, 1)
})

test('loading timeout cancels fetches, reports a retryable error, and does not poison the next attempt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let stuck = true
  const { player, fetches, sources } = setup(t, { fetch: () => stuck ? new Promise(() => {}) :
    Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }) })
  const playing = player.play([60])
  const rejected = assert.rejects(playing, /could not load.*try playing again/)
  t.mock.timers.tick(20000)
  await rejected
  assert.equal(fetches[0].init.signal.aborted, true)
  assert.equal(sources.length, 0)
  stuck = false
  await player.play([60])
  assert.equal(sources.length, 1)
})

test('long held chords use one naturally decaying sample and pitched samples cannot exceed the deadline', async t => {
  const { player, audio, sources, gains } = setup(t, { decode: bytes => ({ duration: 2.5, midi: new Uint8Array(bytes)[0] }) })
  await player.play([60], { durationSeconds: 30 })
  assert.equal(sources.length, 1)
  assert.equal(sources[0].loop, false)
  assert.equal(sources[0].stops[0], 2.5)
  audio.advance(10)
  assert.equal(sources.length, 1, 'a hold never retriggers the sample')
  assert.equal(sources[0].disconnected, true)
  await player.play([36], { durationSeconds: 0.2 })
  assert.equal(sources[1].stops[0], 10.2)
  assert.deepEqual(gains[1].gain.events.at(-1), ['ramp', 0, 10.2])
})

test('options are snapshotted before loading just like chord pitches', async t => {
  const pending = deferred()
  const { player, contexts, sources, gains } = setup(t, { resume: () => pending.promise })
  const options = { durationSeconds: 2 }
  const playing = player.play([60], options)
  options.durationSeconds = undefined
  contexts[0].state = 'running'
  pending.resolve()
  await playing
  assert.equal(sources[0].stops[0], 2)
  assert.deepEqual(gains[0].gain.events.at(-2), ['set', 0.65, 1.965])
})

test('metronome requires prepared audio and never starts during an audition', async t => {
  const { player, contexts, sources } = setup(t)
  assert.throws(() => player.startMetronome(120, 4), /browser paused audio/)
  assert.equal(contexts.length, 0)
  await player.play([60])
  assert.ok(sources.every(source => source.kind === 'piano'))
  for (const bpm of [0, -1, NaN, Infinity, 10000]) assert.throws(() => player.startMetronome(bpm, 4), /invalid/)
  for (const duration of [0, -1, NaN, Infinity]) assert.throws(() => player.startMetronome(120, duration), /invalid/)
})

test('metronome schedules bounded lookahead quarter-note clicks and accents each first beat of four', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const { player, audio, sources, gains } = setup(t)
  await player.prepare()
  player.startMetronome(120, 4)
  assert.equal(sources.length, 1, 'only the short lookahead is scheduled at startup')
  for (let step = 0; step < 80; step++) {
    audio.advance(0.05)
    t.mock.timers.tick(50)
  }
  assert.equal(sources.length, 8)
  assert.deepEqual(sources.map(source => source.starts[0].when), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5])
  assert.deepEqual(sources.map(source => source.frequency.events[0][1]), [1320, 880, 880, 880, 1320, 880, 880, 880])
  assert.deepEqual(gains.map(gain => gain.gain.events[1][1]), [0.18, 0.1, 0.1, 0.1, 0.18, 0.1, 0.1, 0.1])
  assert.ok(sources.every(source => source.stops[0] <= 4 && source.disconnected))
  audio.advance(1)
  t.mock.timers.tick(1000)
  assert.equal(sources.length, 8, 'the metronome ends at its chart duration')
})

test('metronome keeps beat one even if the audio clock advances during start', async t => {
  const { player, contexts, sources } = setup(t)
  await player.prepare()
  let now = 10
  Object.defineProperty(contexts[0], 'currentTime', { configurable: true, get() { const value = now; now += 0.0001; return value } })
  player.startMetronome(120, 4)
  assert.equal(sources.length, 1)
  assert.equal(sources[0].starts[0].when, 10)
  assert.equal(sources[0].frequency.events[0][1], 1320)
})

test('chord replacements and rests do not cancel metronome; explicit off cancels future clicks immediately', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const { player, audio, sources } = setup(t)
  await player.prepare()
  player.startMetronome(120, 10)
  const firstClick = sources[0]
  await player.play([60])
  player.stop(true)
  assert.equal(firstClick.disconnected, false)
  audio.advance(0.45)
  t.mock.timers.tick(450)
  const nextClick = sources.at(-1)
  assert.equal(nextClick.kind, 'click')
  assert.equal(nextClick.starts[0].when, 0.5)
  player.stopMetronome()
  assert.equal(nextClick.stops.at(-1), undefined)
  assert.equal(nextClick.disconnected, true)
  const count = sources.length
  audio.advance(10)
  t.mock.timers.tick(10000)
  assert.equal(sources.length, count)
  await player.play([64])
  assert.equal(sources.at(-1).kind, 'piano', 'turning clicks off leaves the piano usable')
})

test('metronome skips throttled beats without bursts and retains bar accents', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const { player, audio, sources } = setup(t)
  await player.prepare()
  player.startMetronome(120, 10)
  audio.advance(3.95)
  t.mock.timers.tick(25)
  assert.equal(sources.length, 2)
  assert.equal(sources[1].starts[0].when, 4)
  assert.equal(sources[1].frequency.events[0][1], 1320)
})

test('metronome clips its final click and disposal stops scheduled clicks and timers', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const { player, audio, sources, gains } = setup(t)
  await player.prepare()
  player.startMetronome(120, 0.51)
  audio.advance(0.45)
  t.mock.timers.tick(450)
  assert.equal(sources.length, 2)
  assert.equal(sources[1].starts[0].when, 0.5)
  assert.equal(sources[1].stops[0], 0.51)
  assert.deepEqual(gains[1].gain.events.at(-1), ['ramp', 0, 0.51])
  player.dispose()
  assert.ok(sources.every(source => source.disconnected && source.onended === null))
  assert.ok(gains.every(gain => gain.disconnected))
  audio.advance(2)
  t.mock.timers.tick(2000)
  player.startMetronome(120, 4)
  assert.equal(sources.length, 2)
})

test('context interruption stops both piano and metronome until explicit restart', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const { player, contexts, sources } = setup(t)
  await player.prepare()
  player.startMetronome(120, 10)
  await player.play([60])
  contexts[0].state = 'suspended'
  contexts[0].onstatechange()
  assert.ok(sources.every(source => source.disconnected))
  t.mock.timers.tick(10000)
  assert.equal(sources.length, 2)
  await player.play([64])
  assert.equal(sources.at(-1).kind, 'piano')
})

test('melody keyboard resumes in the gesture, uses a flute-like synth, and needs no sample fetch', async t => {
  const { player, contexts, sources, gains, fetches } = setup(t)
  const started = player.startMelodyNote('finger-a', 69, 0.5)
  assert.equal(contexts[0].resumeCalls, 1)
  await started
  assert.equal(fetches.length, 0)
  assert.equal(sources.length, 2)
  assert.deepEqual(sources.map(source => source.frequency.events[0][1]), [440, 880])
  assert.deepEqual(gains.map(gain => gain.gain.events[1][1]), [0.06, 0.007])
  assert.ok(sources.every(source => source.type === 'sine' && source.buffer === null))
  assert.equal(player.audioTime(), 0)
})

test('independent keyboard fingers release separately and piano changes never cut melody', async t => {
  const { player, audio, sources } = setup(t)
  await player.startMelodyNote('finger-a', 60)
  await player.startMelodyNote('finger-b', 64)
  const first = sources.slice(0, 2), second = sources.slice(2, 4)
  await player.play([60, 64, 67])
  player.stop(true)
  assert.ok([...first, ...second].every(source => !source.disconnected))
  player.stopMelodyNote('finger-a')
  audio.advance(0.04)
  assert.ok(first.every(source => source.disconnected))
  assert.ok(second.every(source => !source.disconnected))
  player.stopMelody()
  assert.ok(second.every(source => source.disconnected))
})

test('lifting during activation resolves promptly and never starts a late note', async t => {
  const activation = deferred()
  const { player, contexts, sources } = setup(t, { resume: () => activation.promise })
  const playing = player.startMelodyNote('finger', 60)
  player.stopMelodyNote('finger')
  await playing
  contexts[0].state = 'running'
  activation.resolve()
  await flush()
  assert.equal(sources.length, 0)
  await player.startMelodyNote('finger', 64)
  assert.equal(sources.length, 2)
})

test('retriggering the same finger supersedes its pending activation without affecting another finger', async t => {
  const activation = deferred()
  const { player, contexts, sources } = setup(t, { resume: () => activation.promise })
  const old = player.startMelodyNote('finger', 60)
  const replacement = player.startMelodyNote('finger', 64)
  const other = player.startMelodyNote('other', 67)
  await old
  contexts[0].state = 'running'
  activation.resolve()
  await Promise.all([replacement, other])
  assert.equal(sources.length, 4)
  assert.ok(sources.every(source => source.frequency.events[0][1] !== 440 * 2 ** ((60 - 69) / 12)))
})

test('scheduled melody retains exact audio times and hard ends, including overlapping bar lines', async t => {
  const { player, audio, sources, gains } = setup(t)
  await player.prepare()
  player.scheduleMelodyNote('across-bars', 72, 1.75, 1, 0.7)
  player.scheduleMelodyNote('overlap', 76, 2, 0.5, 0.9)
  assert.deepEqual(sources.map(source => source.starts[0].when), [1.75, 1.75, 2, 2])
  assert.deepEqual(sources.map(source => source.stops[0]), [2.75, 2.75, 2.5, 2.5])
  await player.play([65], { durationSeconds: 2 })
  player.stop(true)
  assert.ok(sources.slice(0, 4).every(source => !source.disconnected))
  audio.advance(2.76)
  assert.ok(sources.every(source => source.disconnected))
  assert.ok(gains.every(gain => gain.disconnected))
})

test('stop, interruption, and disposal cancel future melody and clean every synth node', async t => {
  const { player, contexts, sources, gains } = setup(t)
  await player.prepare()
  player.scheduleMelodyNote('future', 60, 10, 2)
  player.stopMelodyNote('future')
  assert.ok(sources.every(source => source.disconnected && source.stops.at(-1) === undefined))
  await player.startMelodyNote('now', 64)
  contexts[0].state = 'suspended'
  contexts[0].onstatechange()
  assert.ok(sources.every(source => source.disconnected))
  assert.throws(() => player.audioTime(), /paused audio/)
  await player.startMelodyNote('restart', 67)
  player.dispose()
  assert.ok(sources.every(source => source.disconnected && source.onended === null))
  assert.ok(gains.every(gain => gain.disconnected))
})

test('melody scheduling failures clean partially created nodes and remain retryable', async t => {
  let created = 0
  const { player, sources, gains } = setup(t, { createGain: () => {
    if (++created === 2) throw new Error('Synth unavailable')
  } })
  await assert.rejects(player.startMelodyNote('finger', 60), /Synth unavailable/)
  assert.ok(sources.every(source => source.disconnected))
  assert.ok(gains.every(gain => gain.disconnected))
  await player.startMelodyNote('finger', 64)
  assert.equal(sources.length, 4)
  assert.ok(sources.slice(2).every(source => !source.disconnected))
})

test('invalid melody pitches, velocity, and schedules fail before making nodes', async t => {
  const { player, contexts, sources } = setup(t)
  for (const pitch of [-1, 128, 60.5, NaN]) await assert.rejects(player.startMelodyNote('finger', pitch), /MIDI pitch/)
  for (const velocity of [-0.1, 1.1, NaN]) await assert.rejects(player.startMelodyNote('finger', 60, velocity), /velocity/)
  assert.equal(contexts.length, 0)
  await player.prepare()
  for (const [start, duration] of [[-1, 1], [NaN, 1], [0, 0], [0, Infinity]]) {
    assert.throws(() => player.scheduleMelodyNote('bad', 60, start, duration), /timing/)
  }
  player.scheduleMelodyNote('silent', 60, 0, 1, 0)
  assert.equal(sources.length, 0)
})

test('half-speed recording metronome supports 20 BPM without clamping', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const { player, audio, sources } = setup(t)
  await player.prepare()
  player.startMetronome(20, 12)
  for (let step = 0; step < 240; step++) { audio.advance(0.05); t.mock.timers.tick(50) }
  assert.deepEqual(sources.map(source => source.starts[0].when), [0, 3, 6, 9])
  assert.throws(() => player.startMetronome(19, 12), /invalid/)
})
