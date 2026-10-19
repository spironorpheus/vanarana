import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChartSequencer } from '../src/transcription/sequencer.ts'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
const chord = (id, root = 0, quality = 'major', bass) => ({ id, root, quality, ...(bass === undefined ? {} : { bass }) })
const hold = id => ({ id, root: 0, quality: 'major', hold: true })
const chart = (bars, bpm) => ({ id: 'chart', name: 'Test', sourceKey: 0, bars, ...(bpm === undefined ? {} : { bpm }) })
const idle = { playing: false, barId: null, chordId: null, error: null }

function setup(t, options = {}) {
  let now = 0, nextTimer = 0
  const timers = new Map()
  const clock = {
    now: () => now,
    setTimeout(callback, delay) {
      const id = ++nextTimer
      timers.set(id, { callback, at: now + delay })
      return id
    },
    clearTimeout: id => timers.delete(id),
    tick(ms) {
      const end = now + ms
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        now = Math.max(now, next[1].at)
        timers.delete(next[0])
        next[1].callback()
      }
      now = end
    },
    jump(ms) { now += ms },
    runDue() {
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id)
          timer.callback()
        }
      }
    },
  }
  const played = [], stopped = [], prepared = [], states = [], metronomeStarted = [], metronomeStopped = [], melodyPlayed = [], melodyStopped = []
  let disposeCalls = 0
  const player = {
    prepare() { prepared.push(now); return options.prepare?.() ?? Promise.resolve() },
    play(midi, playback) {
      played.push({ at: now, midi, ...playback })
      return options.play?.(midi, playback) ?? Promise.resolve()
    },
    stop(immediate) { stopped.push({ at: now, immediate }) },
    startMetronome(bpm, durationSeconds) {
      metronomeStarted.push({ at: now, bpm, durationSeconds })
      options.startMetronome?.(bpm, durationSeconds)
    },
    stopMetronome() { metronomeStopped.push({ at: now }) },
    scheduleMelodyNote(id, pitch, startedAt, duration, velocity) {
      melodyPlayed.push({ at: now, id, pitch, startedAt, duration, velocity })
      options.scheduleMelodyNote?.(id, pitch, startedAt, duration, velocity)
    },
    stopMelody() { melodyStopped.push({ at: now }) },
    dispose() { disposeCalls++ },
  }
  if (options.audioTime) player.audioTime = options.audioTime
  const sequencer = new ChartSequencer(player, state => { states.push(state); options.onState?.(state) }, clock)
  t.after(() => sequencer.dispose())
  return { sequencer, clock, timers, player, played, stopped, prepared, states, metronomeStarted, metronomeStopped, melodyPlayed, melodyStopped, disposeCalls: () => disposeCalls }
}

test('constructing a sequencer and independently auditioning a chord never starts its metronome', async t => {
  const { player, prepared, metronomeStarted, metronomeStopped, states, timers } = setup(t)
  assert.deepEqual(prepared, [])
  assert.deepEqual(metronomeStarted, [])
  assert.deepEqual(metronomeStopped, [])
  await player.play([60, 64, 67])
  assert.deepEqual(metronomeStarted, [])
  assert.deepEqual(states, [])
  assert.equal(timers.size, 0)
})

test('metronome defaults on and starts without a count-in for exactly the selected remaining bars', async t => {
  const { sequencer, clock, played, metronomeStarted, metronomeStopped } = setup(t)
  await sequencer.play(chart([
    { id: 'skip', chords: [chord('skip1')] },
    { id: 'selected', chords: [chord('s1'), hold('s2'), chord('s3', 7)] },
    { id: 'rest', chords: [] },
    { id: 'held', chords: [hold('h1')] },
  ], 80), 0, 'selected')
  assert.deepEqual(metronomeStarted, [{ at: 0, bpm: 80, durationSeconds: 9 }])
  assert.equal(played[0].at, 0, 'first harmony begins on the first click')
  const initialStops = metronomeStopped.length
  clock.tick(8999)
  assert.equal(metronomeStarted.length, 1, 'chords, holds, and rests share one continuous beat track')
  assert.equal(metronomeStopped.length, initialStops, 'chord stops do not stop the beat track')
  clock.tick(1)
  assert.deepEqual(metronomeStopped.at(-1), { at: 9000 })
  assert.equal(metronomeStopped.length, initialStops + 1)
})

test('an explicitly enabled metronome also starts for a selected silent bar', async t => {
  const { sequencer, played, metronomeStarted } = setup(t)
  await sequencer.play({ ...chart([
    { id: 'skip', chords: [chord('skip1')] },
    { id: 'rest', chords: [] },
    { id: 'held', chords: [hold('h1')] },
  ], 60), metronome: true }, 0, 'rest')
  assert.deepEqual(metronomeStarted, [{ at: 0, bpm: 60, durationSeconds: 8 }])
  assert.deepEqual(played, [])
})

test('a disabled metronome stays disabled if the chart changes during activation or playback', async t => {
  const activation = deferred()
  const { sequencer, clock, played, metronomeStarted } = setup(t, { prepare: () => activation.promise })
  const input = { ...chart([{ id: 'a', chords: [chord('a1'), chord('a2')] }]), metronome: false }
  const playing = sequencer.play(input, 0)
  input.metronome = true
  activation.resolve()
  await playing
  clock.tick(2000)
  assert.equal(played.length, 2)
  assert.deepEqual(metronomeStarted, [])
})

test('replacing active playback with a disabled chart stops the existing metronome', async t => {
  const { sequencer, clock, metronomeStarted, metronomeStopped } = setup(t)
  const input = chart([{ id: 'a', chords: [chord('a1')] }])
  await sequencer.play(input, 0)
  clock.tick(250)
  await sequencer.play({ ...input, metronome: false }, 0)
  assert.deepEqual(metronomeStarted, [{ at: 0, bpm: 120, durationSeconds: 2 }])
  assert.deepEqual(metronomeStopped, [{ at: 0 }, { at: 250 }])
  sequencer.dispose()
  assert.deepEqual(metronomeStopped.at(-1), { at: 250 })
  assert.equal(metronomeStopped.length, 3)
})

test('a metronome startup error cancels playback and clears its pending beat track', async t => {
  const { sequencer, played, states, timers, metronomeStopped } = setup(t, {
    startMetronome: () => { throw new Error('Metronome unavailable') },
  })
  await sequencer.play(chart([{ id: 'a', chords: [chord('a1')] }]), 0)
  assert.deepEqual(states.at(-1), { ...idle, error: 'Metronome unavailable' })
  assert.deepEqual(played, [])
  assert.equal(timers.size, 0)
  assert.equal(metronomeStopped.length, 2)
})

test('default timing divides four beats equally and ends with no note tail', async t => {
  const { sequencer, clock, played, stopped, states, timers } = setup(t)
  await sequencer.play(chart([
    { id: 'a', chords: [chord('a1'), chord('a2', 7, 'dominant')] },
    { id: 'b', chords: [chord('b1', 9, 'minor', 4)] },
  ]), 2)
  assert.deepEqual(played, [{ at: 0, midi: [62, 66, 69], durationSeconds: 1 }])
  assert.deepEqual(states.at(-1), { playing: true, barId: 'a', chordId: 'a1', error: null })
  clock.tick(999)
  assert.equal(played.length, 1)
  clock.tick(1)
  assert.deepEqual(played[1], { at: 1000, midi: [69, 73, 76, 79], durationSeconds: 1 })
  clock.tick(1000)
  assert.deepEqual(played[2], { at: 2000, midi: [54, 71, 74, 78], durationSeconds: 2 })
  clock.tick(1999)
  assert.equal(states.at(-1).playing, true)
  clock.tick(1)
  assert.deepEqual(states.at(-1), idle)
  assert.deepEqual(stopped.at(-1), { at: 4000, immediate: true })
  assert.equal(timers.size, 0)
})

test('selected bar starts at once, empty bars rest, and activation is synchronous', async t => {
  const { sequencer, clock, played, prepared, stopped, states } = setup(t)
  const playing = sequencer.play(chart([
    { id: 'skip', chords: [chord('skip1')] },
    { id: 'rest', chords: [] },
    { id: 'last', chords: [chord('last1', 5)] },
  ], 60), 0, 'rest')
  assert.deepEqual(prepared, [0], 'audio activation is called before returning the promise')
  await playing
  assert.equal(played.length, 0)
  assert.deepEqual(states.at(-1), { playing: true, barId: 'rest', chordId: null, error: null })
  clock.tick(4000)
  assert.deepEqual(played, [{ at: 4000, midi: [65, 69, 72], durationSeconds: 4 }])
  clock.tick(4000)
  assert.deepEqual(states.at(-1), idle)
  assert.ok(stopped.every(call => call.immediate))
})

test('a rest after a chord immediately silences it and clears the active chord', async t => {
  const { sequencer, clock, states, stopped, played } = setup(t)
  await sequencer.play(chart([{ id: 'a', chords: [chord('a1')] }, { id: 'rest', chords: [] }]), 0)
  clock.tick(2000)
  assert.deepEqual(states.at(-1), { playing: true, barId: 'rest', chordId: null, error: null })
  assert.deepEqual(stopped.at(-1), { at: 2000, immediate: true })
  assert.equal(played.length, 1)
  clock.tick(2000)
  assert.deepEqual(states.at(-1), idle)
})

test('tempo is bounded defensively and non-finite tempo falls back to 120', async t => {
  const { sequencer, played, metronomeStarted } = setup(t)
  for (const [bpm, boundedBpm, seconds] of [[40, 40, 6], [240, 240, 1], [1, 40, 6], [1000, 240, 1], [NaN, 120, 2], [Infinity, 120, 2]]) {
    await sequencer.play(chart([{ id: 'a', chords: [chord('a1')] }], bpm), 0)
    assert.equal(played.at(-1).durationSeconds, seconds)
    assert.deepEqual(metronomeStarted.at(-1), { at: 0, bpm: boundedBpm, durationSeconds: seconds })
  }
})

test('chart contents, tempo, metronome and selected key are snapshotted before pending activation', async t => {
  const activation = deferred()
  const { sequencer, clock, played, states, metronomeStarted } = setup(t, { prepare: () => activation.promise })
  const input = chart([{ id: 'a', chords: [chord('a1'), chord('a2', 7)] }], 120)
  const playing = sequencer.play(input, 2)
  input.bpm = 40
  input.metronome = false
  input.bars[0].id = 'changed'
  input.bars[0].chords[1].root = 0
  input.bars[0].chords[1].id = 'changed-chord'
  input.bars.push({ id: 'new', chords: [chord('new1')] })
  clock.jump(500)
  assert.deepEqual(metronomeStarted, [], 'metronome waits for activation')
  activation.resolve()
  await playing
  assert.deepEqual(metronomeStarted, [{ at: 500, bpm: 120, durationSeconds: 2 }])
  assert.deepEqual(played[0], { at: 500, midi: [62, 66, 69], durationSeconds: 1 })
  clock.tick(1000)
  assert.deepEqual(played[1], { at: 1500, midi: [69, 73, 76], durationSeconds: 1 })
  assert.equal(states.at(-1).barId, 'a')
  assert.equal(states.at(-1).chordId, 'a2')
  clock.tick(1000)
  assert.equal(played.length, 2)
  assert.deepEqual(states.at(-1), idle)
})

test('late timers skip elapsed chords and retain original deadlines without drift', async t => {
  const { sequencer, clock, played, states, timers } = setup(t)
  await sequencer.play(chart([{ id: 'a', chords: [chord('a1'), chord('a2', 2), chord('a3', 4), chord('a4', 5)] }]), 0)
  clock.jump(1300)
  clock.runDue()
  assert.deepEqual(played.map(call => call.midi[0]), [60, 64], 'the wholly elapsed second chord is never played')
  assert.equal(played[1].at, 1300)
  assert.equal(played[1].durationSeconds, 0.2)
  assert.equal([...timers.values()][0].at, 1500)
  clock.tick(200)
  assert.equal(played.at(-1).at, 1500)
  assert.equal(played.at(-1).durationSeconds, 0.5)
  clock.jump(1500)
  clock.runDue()
  assert.equal(played.length, 3)
  assert.deepEqual(states.at(-1), idle)
  assert.equal(timers.size, 0)
})

test('stop resolves pending activation immediately and late resolution cannot restart audio', async t => {
  const activation = deferred()
  const { sequencer, clock, played, states, timers, metronomeStarted, metronomeStopped } = setup(t, { prepare: () => activation.promise })
  const playing = sequencer.play(chart([{ id: 'a', chords: [chord('a1')] }]), 0)
  const stopsBeforeCancel = metronomeStopped.length
  sequencer.stop()
  await playing
  assert.deepEqual(states.at(-1), idle)
  activation.resolve()
  await flush()
  clock.tick(20_000)
  assert.equal(played.length, 0)
  assert.equal(timers.size, 0)
  assert.deepEqual(metronomeStarted, [])
  assert.equal(metronomeStopped.length, stopsBeforeCancel + 1)
})

test('newest play wins during activation and obsolete rejection cannot stop it', async t => {
  const first = deferred(), second = deferred()
  let calls = 0
  const { sequencer, clock, played, states, metronomeStarted, metronomeStopped } = setup(t, { prepare: () => ++calls === 1 ? first.promise : second.promise })
  const old = sequencer.play(chart([{ id: 'old', chords: [chord('old1')] }]), 0)
  const latest = sequencer.play(chart([{ id: 'latest', chords: [chord('new1', 9)] }], 240), 0)
  await old
  second.resolve()
  await latest
  first.reject(new Error('Old error'))
  await flush()
  assert.deepEqual(played.map(call => call.midi), [[69, 73, 76]])
  assert.equal(states.at(-1).barId, 'latest')
  assert.equal(states.at(-1).error, null)
  assert.deepEqual(metronomeStarted, [{ at: 0, bpm: 240, durationSeconds: 1 }])
  assert.equal(metronomeStopped.length, 2, 'each play cancels any earlier metronome')
  clock.tick(1000)
  assert.deepEqual(states.at(-1), idle)
  assert.equal(metronomeStopped.length, 3)
})

test('stop cancels queued transitions and repeated play starts a fresh timeline', async t => {
  const { sequencer, clock, played, states, timers } = setup(t)
  const input = chart([{ id: 'a', chords: [chord('a1'), chord('a2', 2)] }])
  await sequencer.play(input, 0)
  clock.tick(300)
  sequencer.stop()
  assert.equal(timers.size, 0)
  clock.tick(5000)
  assert.equal(played.length, 1)
  await sequencer.play(input, 0)
  assert.equal(played.at(-1).at, 5300)
  clock.tick(1000)
  assert.equal(played.at(-1).at, 6300)
  sequencer.stop()
  assert.deepEqual(states.at(-1), idle)
})

test('dispose cancels activation and timers without disposing the shared player', async t => {
  const activation = deferred()
  const { sequencer, clock, played, states, prepared, disposeCalls, timers, metronomeStarted, metronomeStopped } = setup(t, { prepare: () => activation.promise })
  const input = chart([{ id: 'a', chords: [chord('a1')] }])
  const playing = sequencer.play(input, 0)
  sequencer.dispose()
  await playing
  activation.resolve()
  await flush()
  await sequencer.play(input, 0)
  sequencer.stop()
  sequencer.dispose()
  clock.tick(20_000)
  assert.equal(disposeCalls(), 0)
  assert.equal(prepared.length, 1)
  assert.equal(played.length, 0)
  assert.equal(timers.size, 0)
  assert.deepEqual(states.at(-1), idle)
  assert.deepEqual(metronomeStarted, [])
  assert.equal(metronomeStopped.length, 2, 'play and dispose each cancel once; repeated disposal is inert')
})

test('invalid key or missing selected bar reports an error before opening audio', async t => {
  const { sequencer, prepared, states, metronomeStarted } = setup(t)
  const input = chart([{ id: 'a', chords: [chord('a1')] }])
  await sequencer.play(input, 12)
  assert.match(states.at(-1).error, /Key/)
  await sequencer.play(input, 0, 'missing')
  assert.match(states.at(-1).error, /selected bar/)
  assert.equal(prepared.length, 0)
  sequencer.stop()
  assert.deepEqual(states.at(-1), idle)
  await sequencer.play(chart([]), 0)
  assert.deepEqual(states.at(-1), idle)
  assert.equal(prepared.length, 0)
  assert.deepEqual(metronomeStarted, [])
})

test('activation errors and current note errors stop playback and clear all timers', async t => {
  let failure = 'prepare'
  const { sequencer, states, timers, stopped } = setup(t, {
    prepare: () => failure === 'prepare' ? Promise.reject(new Error('Activation blocked')) : Promise.resolve(),
    play: () => failure === 'play' ? Promise.reject(new Error('Audio failed')) : Promise.resolve(),
  })
  const input = chart([{ id: 'a', chords: [chord('a1')] }])
  await sequencer.play(input, 0)
  assert.deepEqual(states.at(-1), { ...idle, error: 'Activation blocked' })
  assert.equal(timers.size, 0)
  failure = 'play'
  await sequencer.play(input, 0)
  await flush()
  assert.deepEqual(states.at(-1), { ...idle, error: 'Audio failed' })
  assert.equal(timers.size, 0)
  assert.equal(stopped.at(-1).immediate, true)
  failure = null
  await sequencer.play(input, 0)
  assert.equal(states.at(-1).playing, true)
  assert.equal(states.at(-1).error, null)
})

test('a late obsolete note rejection cannot stop a newer chord', async t => {
  const oldNote = deferred()
  let calls = 0
  const { sequencer, clock, states } = setup(t, { play: () => ++calls === 1 ? oldNote.promise : Promise.resolve() })
  await sequencer.play(chart([{ id: 'a', chords: [chord('a1'), chord('a2')] }]), 0)
  clock.tick(1000)
  oldNote.reject(new Error('Obsolete note'))
  await flush()
  assert.equal(states.at(-1).chordId, 'a2')
  assert.equal(states.at(-1).error, null)
})

test('state callback can cancel startup and transitions without leaving playback behind', async t => {
  let sequencer
  let cancelChord = false
  const fixture = setup(t, { onState: state => {
    if (state.playing && (!cancelChord || state.chordId === 'a2')) sequencer.stop()
  } })
  sequencer = fixture.sequencer
  const input = chart([{ id: 'a', chords: [chord('a1'), chord('a2')] }])
  await sequencer.play(input, 0)
  assert.equal(fixture.played.length, 0)
  assert.equal(fixture.timers.size, 0)
  cancelChord = true
  await sequencer.play(input, 0)
  assert.equal(fixture.played.length, 1)
  fixture.clock.tick(1000)
  assert.equal(fixture.played.length, 1)
  assert.equal(fixture.timers.size, 0)
  assert.deepEqual(fixture.states.at(-1), idle)
})

test('holds sustain one attack through equal slots and bar lines while highlights advance', async t => {
  const { sequencer, clock, played, stopped, states, timers } = setup(t)
  await sequencer.play(chart([
    { id: 'a', chords: [chord('a1'), hold('a2'), hold('a3'), chord('a4', 7)] },
    { id: 'b', chords: [hold('b1'), hold('b2')] },
    { id: 'c', chords: [chord('c1', 5)] },
  ]), 0)
  assert.deepEqual(played, [{ at: 0, midi: [60, 64, 67], durationSeconds: 1.5 }])
  const initialStops = stopped.length
  clock.tick(500)
  assert.deepEqual(states.at(-1), { playing: true, barId: 'a', chordId: 'a2', error: null })
  clock.tick(500)
  assert.equal(states.at(-1).chordId, 'a3')
  assert.equal(played.length, 1)
  assert.equal(stopped.length, initialStops, 'hold boundaries never stop sustained voices')
  clock.tick(500)
  assert.deepEqual(played[1], { at: 1500, midi: [67, 71, 74], durationSeconds: 2.5 })
  const secondStops = stopped.length
  clock.tick(500)
  assert.deepEqual(states.at(-1), { playing: true, barId: 'b', chordId: 'b1', error: null })
  clock.tick(1000)
  assert.equal(states.at(-1).chordId, 'b2')
  assert.equal(played.length, 2)
  assert.equal(stopped.length, secondStops)
  clock.tick(1000)
  assert.deepEqual(played[2], { at: 4000, midi: [65, 69, 72], durationSeconds: 2 })
  clock.tick(2000)
  assert.deepEqual(states.at(-1), idle)
  assert.equal(stopped.at(-1).at, 6000)
  assert.equal(timers.size, 0)
})

test('an explicit repeated chord retriggers after its preceding holds', async t => {
  const { sequencer, clock, played } = setup(t)
  await sequencer.play(chart([{ id: 'a', chords: [chord('a1'), hold('a2'), chord('a3'), hold('a4')] }]), 0)
  assert.equal(played[0].durationSeconds, 1)
  clock.tick(500)
  assert.equal(played.length, 1)
  clock.tick(500)
  assert.deepEqual(played[1], { at: 1000, midi: [60, 64, 67], durationSeconds: 1 })
  clock.tick(1000)
  assert.equal(played.length, 2)
})

test('leading holds with no earlier harmony are silent and still consume their slots', async t => {
  const { sequencer, clock, played, states } = setup(t)
  await sequencer.play(chart([
    { id: 'a', chords: [hold('a1'), hold('a2')] },
    { id: 'b', chords: [hold('b1'), chord('b2', 9, 'minor'), hold('b3'), hold('b4')] },
  ]), 0)
  assert.equal(played.length, 0)
  assert.equal(states.at(-1).chordId, 'a1')
  clock.tick(1000)
  assert.equal(states.at(-1).chordId, 'a2')
  clock.tick(1000)
  assert.equal(states.at(-1).chordId, 'b1')
  assert.equal(played.length, 0)
  clock.tick(500)
  assert.deepEqual(played, [{ at: 2500, midi: [69, 72, 76], durationSeconds: 1.5 }])
  clock.tick(1500)
  assert.deepEqual(states.at(-1), idle)
})

test('starting a selected hold bar sounds the latest chart harmony immediately in the selected key', async t => {
  const { sequencer, clock, played, states } = setup(t)
  await sequencer.play(chart([
    { id: 'earlier', chords: [chord('e1'), chord('e2', 9, 'minor', 4), hold('e3')] },
    { id: 'selected', chords: [hold('s1'), hold('s2')] },
    { id: 'last', chords: [hold('l1'), chord('l2', 5)] },
  ], 60), 2, 'selected')
  assert.deepEqual(played, [{ at: 0, midi: [54, 71, 74, 78], durationSeconds: 6 }])
  assert.deepEqual(states.at(-1), { playing: true, barId: 'selected', chordId: 's1', error: null })
  clock.tick(4000)
  assert.equal(states.at(-1).chordId, 'l1')
  assert.equal(played.length, 1)
  clock.tick(2000)
  assert.deepEqual(played[1], { at: 6000, midi: [67, 71, 74], durationSeconds: 2 })
})

test('a selected leading hold without prior harmony remains a rest', async t => {
  const { sequencer, clock, played, states } = setup(t)
  await sequencer.play(chart([
    { id: 'empty', chords: [] },
    { id: 'earlier', chords: [hold('e1')] },
    { id: 'selected', chords: [hold('s1')] },
  ]), 0, 'selected')
  assert.equal(played.length, 0)
  assert.equal(states.at(-1).chordId, 's1')
  clock.tick(2000)
  assert.deepEqual(states.at(-1), idle)
})

test('empty bars break sustain and later holds resume the remembered harmony once', async t => {
  const { sequencer, clock, played, stopped, states } = setup(t)
  const input = chart([
    { id: 'a', chords: [chord('a1', 7, 'dominant'), hold('a2')] },
    { id: 'rest', chords: [] },
    { id: 'held', chords: [hold('h1'), hold('h2')] },
  ])
  await sequencer.play(input, 0)
  assert.deepEqual(played, [{ at: 0, midi: [67, 71, 74, 77], durationSeconds: 2 }])
  clock.tick(2000)
  assert.deepEqual(states.at(-1), { playing: true, barId: 'rest', chordId: null, error: null })
  assert.deepEqual(stopped.at(-1), { at: 2000, immediate: true })
  clock.tick(2000)
  assert.deepEqual(played[1], { at: 4000, midi: [67, 71, 74, 77], durationSeconds: 2 })
  clock.tick(1000)
  assert.equal(played.length, 2)
  clock.tick(1000)
  assert.deepEqual(states.at(-1), idle)
  await sequencer.play(input, 0, 'held')
  assert.deepEqual(played.at(-1), { at: 6000, midi: [67, 71, 74, 77], durationSeconds: 2 })
})

test('hold resolution and full held duration are snapshotted before activation', async t => {
  const activation = deferred()
  const { sequencer, clock, played, states } = setup(t, { prepare: () => activation.promise })
  const input = chart([
    { id: 'earlier', chords: [chord('e1', 2)] },
    { id: 'selected', chords: [hold('s1'), hold('s2')] },
    { id: 'last', chords: [hold('l1')] },
  ])
  const playing = sequencer.play(input, 3, 'selected')
  input.bpm = 60
  input.bars[0].chords[0].root = 9
  input.bars[1].chords[0].id = 'changed'
  input.bars[1].chords[1].hold = undefined
  input.bars.pop()
  activation.resolve()
  await playing
  assert.deepEqual(played, [{ at: 0, midi: [65, 69, 72], durationSeconds: 4 }])
  assert.equal(states.at(-1).chordId, 's1')
  clock.tick(3000)
  assert.equal(played.length, 1)
  assert.equal(states.at(-1).barId, 'last')
  clock.tick(1000)
  assert.deepEqual(states.at(-1), idle)
})

test('late timers crossing held slots preserve the sounding attack and absolute deadlines', async t => {
  const { sequencer, clock, played, stopped, states, timers } = setup(t)
  await sequencer.play(chart([{ id: 'a', chords: [chord('a1'), hold('a2'), hold('a3'), hold('a4')] }]), 0)
  const initialStops = stopped.length
  assert.equal(played[0].durationSeconds, 2)
  clock.jump(1300)
  clock.runDue()
  assert.equal(states.at(-1).chordId, 'a3')
  assert.equal(played.length, 1)
  assert.equal(stopped.length, initialStops)
  assert.equal([...timers.values()][0].at, 1500)
  clock.tick(200)
  assert.equal(states.at(-1).chordId, 'a4')
  clock.jump(2000)
  clock.runDue()
  assert.equal(played.length, 1)
  assert.deepEqual(states.at(-1), idle)
  assert.equal(timers.size, 0)
})

test('a late timer entering a newer held phrase plays only its remaining duration', async t => {
  const { sequencer, clock, played, states, timers } = setup(t)
  await sequencer.play(chart([{ id: 'a', chords: [chord('a1'), chord('a2', 2), hold('a3'), hold('a4')] }]), 0)
  clock.jump(1300)
  clock.runDue()
  assert.deepEqual(played, [
    { at: 0, midi: [60, 64, 67], durationSeconds: 0.5 },
    { at: 1300, midi: [62, 66, 69], durationSeconds: 0.7 },
  ])
  assert.equal(states.at(-1).chordId, 'a3')
  assert.equal([...timers.values()][0].at, 1500)
  clock.tick(200)
  assert.equal(played.length, 2)
  clock.tick(500)
  assert.deepEqual(states.at(-1), idle)
})

test('an audio rejection remains current while its chord is held in a later slot', async t => {
  const note = deferred()
  const { sequencer, clock, states, timers } = setup(t, { play: () => note.promise })
  await sequencer.play(chart([{ id: 'a', chords: [chord('a1'), hold('a2')] }]), 0)
  clock.tick(1000)
  assert.equal(states.at(-1).chordId, 'a2')
  note.reject(new Error('Held audio failed'))
  await flush()
  assert.deepEqual(states.at(-1), { ...idle, error: 'Held audio failed' })
  assert.equal(timers.size, 0)
})

test('a hold highlight callback can stop playback and clear all later held transitions', async t => {
  let sequencer
  const fixture = setup(t, { onState: state => {
    if (state.chordId === 'a2') sequencer.stop()
  } })
  sequencer = fixture.sequencer
  await sequencer.play(chart([{ id: 'a', chords: [chord('a1'), hold('a2'), hold('a3'), hold('a4')] }]), 0)
  fixture.clock.tick(500)
  assert.deepEqual(fixture.states.at(-1), idle)
  assert.equal(fixture.stopped.at(-1).at, 500)
  assert.equal(fixture.timers.size, 0)
  fixture.clock.tick(5000)
  assert.equal(fixture.played.length, 1)
})

const melodyNote = (id, pitch = 72, offset = 0, duration = 1, velocity = 0.8) => ({ id, pitch, offset, duration, velocity })

test('recording waits for audio readiness then counts exactly four beats even with metronome disabled', async t => {
  const activation = deferred()
  const { sequencer, clock, states, played, metronomeStarted } = setup(t, { prepare: () => activation.promise })
  const input = { ...chart([{ id: 'a', chords: [chord('a1')] }]), metronome: false }
  const playing = sequencer.play(input, 0, undefined, { countIn: true })
  assert.equal(states.at(-1).countInBeatsRemaining, 4, 'loading keeps the keyboard gated')
  assert.equal(sequencer.getRecordingBeat(), null)
  clock.tick(1000)
  assert.equal(played.length, 0)
  activation.resolve()
  await playing
  assert.deepEqual(metronomeStarted, [{ at: 1000, bpm: 120, durationSeconds: 2 }])
  for (let beat = 0; beat < 4; beat++) {
    assert.equal(states.at(-1).countInBeatsRemaining, 4 - beat)
    assert.equal(sequencer.getRecordingBeat(), null)
    assert.equal(played.length, 0)
    clock.tick(500)
  }
  assert.equal(sequencer.getRecordingBeat(), 0)
  assert.equal(states.at(-1).countInBeatsRemaining, 0)
  assert.equal(played[0].at, 3000)
  clock.tick(250)
  assert.equal(sequencer.getRecordingBeat(), 0.5)
  assert.equal(metronomeStarted.length, 1, 'the disabled chart receives only its count-in clicks')
})

test('an enabled metronome has one continuous count-in plus chart timeline', async t => {
  const { sequencer, metronomeStarted, clock, played } = setup(t)
  await sequencer.play(chart([{ id: 'a', chords: [chord('a1')] }], 60), 0, undefined, { countIn: true })
  assert.deepEqual(metronomeStarted, [{ at: 0, bpm: 60, durationSeconds: 8 }])
  clock.tick(3999)
  assert.equal(played.length, 0)
  clock.tick(1)
  assert.equal(played[0].at, 4000)
  assert.equal(played[0].durationSeconds, 4)
})

test('half-speed recording doubles the four-beat count-in and harmony while leaving the chart unchanged', async t => {
  const activation = deferred()
  const { sequencer, clock, states, played, melodyPlayed, metronomeStarted } = setup(t, { prepare: () => activation.promise })
  const input = { ...chart([{ id: 'a', chords: [chord('a1')], melody: [melodyNote('m1')] }], 120), metronome: false }
  const before = structuredClone(input)
  const playing = sequencer.play(input, 0, undefined, {
    countIn: true, muteMelody: true, extendForRecording: true, recordingRate: 0.5,
  })
  clock.tick(1000)
  assert.equal(sequencer.getRecordingBeat(), null)
  assert.equal(played.length, 0)
  assert.deepEqual(metronomeStarted, [], 'the slower count-in still waits for audio readiness')
  activation.resolve()
  await playing
  assert.deepEqual(metronomeStarted, [{ at: 1000, bpm: 60, durationSeconds: 4 }])
  for (let beat = 0; beat < 4; beat++) {
    assert.equal(states.at(-1).countInBeatsRemaining, 4 - beat)
    assert.equal(sequencer.getRecordingBeat(), null)
    assert.equal(played.length, 0)
    clock.tick(999)
    assert.equal(states.at(-1).countInBeatsRemaining, 4 - beat)
    assert.equal(sequencer.getRecordingBeat(), null)
    clock.tick(1)
  }
  assert.equal(states.at(-1).countInBeatsRemaining, 0)
  assert.equal(sequencer.getRecordingBeat(), 0)
  assert.deepEqual(played, [{ at: 5000, midi: [60, 64, 67], durationSeconds: 4 }])
  clock.tick(1250)
  assert.equal(sequencer.getRecordingBeat(), 1.25)
  clock.tick(2750)
  assert.equal(states.at(-1).barIndex, 1)
  assert.equal(states.at(-1).elapsedBeats, 4)
  assert.deepEqual(melodyPlayed, [], 'existing melody stays muted for the entire recording')
  assert.equal(metronomeStarted.length, 1, 'a disabled metronome receives only its slower count-in')
  assert.deepEqual(input, before, 'recording speed and virtual bars never rewrite the saved chart')
})

test('half-speed recording applies its rate after bounding the chart tempo, including 20 effective BPM', async t => {
  const { sequencer, played, metronomeStarted } = setup(t)
  for (const [chartBpm, effectiveBpm, seconds] of [[40, 20, 12], [1, 20, 12], [240, 120, 2], [1000, 120, 2], [NaN, 60, 4]]) {
    const input = chart([{ id: 'a', chords: [chord('a1')] }], chartBpm)
    await sequencer.play(input, 0, undefined, { extendForRecording: true, recordingRate: 0.5 })
    assert.equal(played.at(-1).durationSeconds, seconds)
    assert.deepEqual(metronomeStarted.at(-1), { at: 0, bpm: effectiveBpm, durationSeconds: seconds * 1000 })
    assert.equal(input.bpm, chartBpm)
  }
})

test('normal playback ignores recording rate even with a count-in and keeps melody at chart tempo', async t => {
  for (const countIn of [false, true]) {
    const { sequencer, clock, played, melodyPlayed, metronomeStarted, states } = setup(t)
    const input = chart([{ id: 'a', chords: [chord('a1')], melody: [melodyNote('m1', 72, 0, 2)] }], 120)
    const before = structuredClone(input)
    await sequencer.play(input, 0, undefined, { countIn, recordingRate: 0.5 })
    const startsAt = countIn ? 2000 : 0
    assert.deepEqual(metronomeStarted, [{ at: 0, bpm: 120, durationSeconds: countIn ? 4 : 2 }])
    clock.tick(startsAt)
    assert.deepEqual(played, [{ at: startsAt, midi: [60, 64, 67], durationSeconds: 2 }])
    assert.equal(melodyPlayed.length, 1)
    assert.equal(melodyPlayed[0].startedAt, startsAt / 1000)
    assert.equal(melodyPlayed[0].duration, 1)
    clock.tick(2000)
    assert.deepEqual(states.at(-1), idle)
    assert.deepEqual(input, before)
  }
})

test('recording rate and tempo are snapshotted before asynchronous audio activation', async t => {
  const activation = deferred()
  const { sequencer, clock, played, metronomeStarted } = setup(t, { prepare: () => activation.promise })
  const input = chart([{ id: 'a', chords: [chord('a1')] }], 120)
  const options = { extendForRecording: true, recordingRate: 0.5 }
  const playing = sequencer.play(input, 0, undefined, options)
  options.recordingRate = 1
  options.extendForRecording = false
  input.bpm = 240
  clock.tick(500)
  activation.resolve()
  await playing
  assert.deepEqual(metronomeStarted, [{ at: 500, bpm: 60, durationSeconds: 4000 }])
  assert.deepEqual(played, [{ at: 500, midi: [60, 64, 67], durationSeconds: 4 }])
  clock.tick(1250)
  assert.equal(sequencer.getRecordingBeat(), 1.25)
})

test('half-speed recording from a selected bar keeps relative beats, absolute indices, and the extension limit', async t => {
  const { sequencer, clock, states, played, metronomeStarted } = setup(t)
  const input = chart(Array.from({ length: 999 }, (_, i) => ({ id: `bar-${i}`, chords: [chord(`chord-${i}`)] })), 80)
  await sequencer.play(input, 0, 'bar-998', { countIn: true, extendForRecording: true, recordingRate: 0.5 })
  assert.equal(states.at(-1).barId, 'bar-998')
  assert.equal(states.at(-1).barIndex, 998)
  assert.deepEqual(metronomeStarted, [{ at: 0, bpm: 40, durationSeconds: 18 }])
  clock.tick(6000)
  assert.equal(sequencer.getRecordingBeat(), 0)
  assert.equal(states.at(-1).chordId, 'chord-998')
  assert.deepEqual(played, [{ at: 6000, midi: [60, 64, 67], durationSeconds: 6 }])
  clock.tick(750)
  assert.equal(sequencer.getRecordingBeat(), 0.5)
  clock.tick(5250)
  assert.equal(sequencer.getRecordingBeat(), 4)
  assert.equal(states.at(-1).barId, 'recording-bar-999')
  assert.equal(states.at(-1).barIndex, 999)
  assert.equal(states.at(-1).elapsedBeats, 4)
  clock.tick(6000)
  assert.deepEqual(states.at(-1), { ...idle, elapsedBeats: 8 })
  assert.equal(sequencer.getRecordingBeat(), null)
  assert.equal(input.bpm, 80)
  assert.equal(input.bars.length, 999)
})

test('stopping half-speed recording during the count-in cancels every pending layer', async t => {
  const { sequencer, clock, played, states, timers, metronomeStopped, melodyPlayed, melodyStopped, stopped } = setup(t)
  await sequencer.play(chart([{ id: 'a', chords: [chord('a1')], melody: [melodyNote('m1')] }]), 0,
    undefined, { countIn: true, muteMelody: true, extendForRecording: true, recordingRate: 0.5 })
  clock.tick(3900)
  assert.equal(states.at(-1).countInBeatsRemaining, 1)
  assert.equal(sequencer.getRecordingBeat(), null)
  const priorMetronomeStops = metronomeStopped.length
  const priorMelodyStops = melodyStopped.length
  sequencer.stop()
  assert.equal(metronomeStopped.length, priorMetronomeStops + 1)
  assert.equal(melodyStopped.length, priorMelodyStops + 1)
  assert.deepEqual(stopped.at(-1), { at: 3900, immediate: true })
  assert.deepEqual(states.at(-1), { ...idle, elapsedBeats: 0 })
  assert.equal(sequencer.getRecordingBeat(), null)
  assert.equal(timers.size, 0)
  clock.tick(10000)
  assert.deepEqual(played, [])
  assert.deepEqual(melodyPlayed, [])
})

test('stopping a half-speed take preserves fractional recorded beats and the next take restores full speed', async t => {
  const { sequencer, clock, states, timers, played, metronomeStarted } = setup(t)
  const input = chart([{ id: 'a', chords: [chord('a1')] }], 120)
  await sequencer.play(input, 0, undefined, { extendForRecording: true, recordingRate: 0.5 })
  clock.tick(2250)
  assert.equal(sequencer.getRecordingBeat(), 2.25)
  sequencer.stop()
  assert.deepEqual(states.at(-1), { ...idle, elapsedBeats: 2.25 })
  assert.equal(sequencer.getRecordingBeat(), null)
  assert.equal(timers.size, 0)
  clock.tick(5000)
  assert.equal(played.length, 1)
  await sequencer.play(input, 0, undefined, { extendForRecording: true, recordingRate: 1 })
  assert.deepEqual(metronomeStarted.at(-1), { at: 7250, bpm: 120, durationSeconds: 2000 })
  assert.deepEqual(played.at(-1), { at: 7250, midi: [60, 64, 67], durationSeconds: 2 })
  clock.tick(250)
  assert.equal(sequencer.getRecordingBeat(), 0.5)
})

test('half-speed record timestamps follow the audio clock and retain their scaled beat on interruption', async t => {
  let audioTime = 10, interrupted = false
  const { sequencer, clock, states, timers } = setup(t, { audioTime: () => {
    if (interrupted) throw new Error('Your browser paused audio.')
    return audioTime
  } })
  await sequencer.play(chart([{ id: 'a', chords: [] }], 120), 0, undefined,
    { countIn: true, extendForRecording: true, recordingRate: 0.5 })
  clock.tick(5000)
  assert.equal(sequencer.getRecordingBeat(), null, 'wall time cannot advance the audio count-in')
  audioTime = 13.999
  assert.equal(sequencer.getRecordingBeat(), null)
  audioTime = 14
  clock.tick(100)
  assert.equal(sequencer.getRecordingBeat(), 0)
  audioTime = 16.25
  assert.equal(sequencer.getRecordingBeat(), 2.25)
  interrupted = true
  assert.equal(sequencer.getRecordingBeat(), 2.25)
  clock.tick(100)
  assert.deepEqual(states.at(-1), { ...idle, elapsedBeats: 2.25, error: 'Your browser paused audio.' })
  assert.equal(timers.size, 0)
})

test('stopping in the count-in cancels its remaining clicks, queued melody, and chord start', async t => {
  const { sequencer, clock, played, states, timers, melodyPlayed, melodyStopped } = setup(t)
  await sequencer.play(chart([{ id: 'a', chords: [chord('a1')], melody: [melodyNote('m1')] }]), 0,
    undefined, { countIn: true, extendForRecording: true })
  clock.tick(1900)
  assert.equal(melodyPlayed.length, 1, 'beat-one melody is queued shortly before the count-in ends')
  assert.equal(melodyPlayed[0].startedAt, 2)
  const previousStops = melodyStopped.length
  sequencer.stop()
  assert.equal(melodyStopped.length, previousStops + 1)
  assert.deepEqual(states.at(-1), { ...idle, elapsedBeats: 0 })
  assert.equal(sequencer.getRecordingBeat(), null)
  assert.equal(timers.size, 0)
  clock.tick(10000)
  assert.equal(played.length, 0)
  assert.equal(melodyPlayed.length, 1)
})

test('recording extensions are virtual, preserve the snapshot, and stop at the absolute 1000-bar limit', async t => {
  const { sequencer, clock, states, played } = setup(t)
  const input = chart([{ id: 'a', chords: [chord('a1')] }])
  await sequencer.play(input, 0, undefined, { muteMelody: true, extendForRecording: true })
  clock.tick(2000)
  assert.equal(states.at(-1).barId, 'recording-bar-1')
  assert.equal(states.at(-1).barIndex, 1)
  assert.equal(states.at(-1).elapsedBeats, 4)
  assert.equal(input.bars.length, 1, 'persistent bars are created only when the UI saves its take')
  assert.equal(played.length, 1)
  clock.jump(1_998_000)
  clock.runDue()
  assert.deepEqual(states.at(-1), { ...idle, elapsedBeats: 4000 })
  assert.equal(sequencer.getRecordingBeat(), null)
})

test('recording from a selected late bar exposes relative beats but absolute bar indices', async t => {
  const { sequencer, clock, states, metronomeStarted } = setup(t)
  const input = chart(Array.from({ length: 999 }, (_, i) => ({ id: `bar-${i}`, chords: [] })))
  await sequencer.play(input, 0, 'bar-998', { countIn: true, extendForRecording: true })
  assert.equal(states.at(-1).barIndex, 998)
  assert.equal(metronomeStarted[0].durationSeconds, 6)
  clock.tick(2000)
  assert.equal(sequencer.getRecordingBeat(), 0)
  assert.equal(states.at(-1).barIndex, 998)
  clock.tick(2000)
  assert.equal(sequencer.getRecordingBeat(), 4)
  assert.equal(states.at(-1).barIndex, 999)
  clock.tick(2000)
  assert.deepEqual(states.at(-1), { ...idle, elapsedBeats: 8 })
})

test('record timestamps follow the audio clock independently of JS clock and interruption stops the take', async t => {
  let audioTime = 10, interrupted = false
  const { sequencer, clock, states, timers } = setup(t, { audioTime: () => {
    if (interrupted) throw new Error('Your browser paused audio.')
    return audioTime
  } })
  await sequencer.play(chart([{ id: 'a', chords: [] }]), 0, undefined, { countIn: true, extendForRecording: true })
  assert.equal(sequencer.getRecordingBeat(), null)
  clock.tick(900)
  assert.equal(sequencer.getRecordingBeat(), null, 'wall time never advances a paused audio timeline')
  audioTime = 12
  clock.tick(100)
  assert.equal(sequencer.getRecordingBeat(), 0)
  audioTime = 13.125
  assert.equal(sequencer.getRecordingBeat(), 2.25)
  interrupted = true
  assert.equal(sequencer.getRecordingBeat(), 2.25, 'pointer release on blur retains the most recent audio timestamp')
  clock.tick(100)
  assert.deepEqual(states.at(-1), { ...idle, elapsedBeats: 2.25, error: 'Your browser paused audio.' })
  assert.equal(timers.size, 0)
})

test('melody uses lookahead audio scheduling and sustains across piano changes and bar lines', async t => {
  const { sequencer, clock, melodyPlayed, melodyStopped, played } = setup(t)
  await sequencer.play(chart([
    { id: 'a', chords: [chord('a1')], melody: [melodyNote('m1', 72, 3.5, 3, 0.6)] },
    { id: 'b', chords: [chord('b1', 7)], melody: [melodyNote('m2', 76, 0, 1)] },
  ]), 0)
  assert.equal(melodyPlayed.length, 0)
  clock.tick(1650)
  assert.deepEqual(melodyPlayed.map(({ id, ...note }) => note), [
    { at: 1650, pitch: 72, startedAt: 1.75, duration: 1.5, velocity: 0.6 },
  ])
  const stops = melodyStopped.length
  clock.tick(350)
  assert.equal(played.length, 2)
  assert.equal(melodyPlayed[1].startedAt, 2)
  assert.equal(melodyStopped.length, stops, 'piano changes cannot cut the independent melody layer')
  clock.tick(2000)
  assert.equal(melodyStopped.length, stops + 1)
})

test('selected-start melody includes held notes and uses signed source-key transposition without octave wrapping', async t => {
  const { sequencer, melodyPlayed } = setup(t)
  const input = { ...chart([
    { id: 'earlier', chords: [], melody: [melodyNote('held', 64, 3, 3), melodyNote('expired', 60, 0, 1)] },
    { id: 'selected', chords: [], melody: [melodyNote('new', 72, 0, 1)] },
  ]), sourceKey: 5 }
  await sequencer.play(input, 2, 'selected')
  assert.deepEqual(melodyPlayed.map(({ pitch, startedAt, duration }) => ({ pitch, startedAt, duration })), [
    { pitch: 61, startedAt: 0, duration: 1 },
    { pitch: 69, startedAt: 0, duration: 0.5 },
  ])
})

test('melody notes are snapshotted before audio activation and can be muted during replacement recording', async t => {
  const activation = deferred()
  const { sequencer, melodyPlayed } = setup(t, { prepare: () => activation.promise })
  const input = chart([{ id: 'a', chords: [], melody: [melodyNote('m1', 72, 0, 2)] }])
  const playing = sequencer.play(input, 2)
  input.bars[0].melody[0].pitch = 1
  input.bars[0].melody[0].duration = 1
  input.bars[0].melody.push(melodyNote('m2'))
  activation.resolve()
  await playing
  assert.equal(melodyPlayed.length, 1)
  assert.equal(melodyPlayed[0].pitch, 74)
  assert.equal(melodyPlayed[0].duration, 1)
  await sequencer.play(input, 2, undefined, { muteMelody: true })
  assert.equal(melodyPlayed.length, 1)
})

test('late melody scheduling skips expired attacks and plays only the remaining held duration', async t => {
  const { sequencer, clock, melodyPlayed } = setup(t)
  await sequencer.play(chart([{ id: 'a', chords: [], melody: [
    melodyNote('expired', 60, 1, 0.25), melodyNote('held', 64, 2, 2),
  ] }]), 0)
  clock.jump(1500)
  clock.runDue()
  assert.equal(melodyPlayed.length, 1)
  assert.equal(melodyPlayed[0].pitch, 64)
  assert.equal(melodyPlayed[0].startedAt, 1.5)
  assert.equal(melodyPlayed[0].duration, 0.5)
})

test('out-of-range transposition fails before activation and synth errors cancel every layer', async t => {
  let broken = false
  const { sequencer, clock, states, timers, prepared, melodyStopped } = setup(t, {
    scheduleMelodyNote: () => { if (broken) throw new Error('Synth unavailable') },
  })
  await sequencer.play(chart([{ id: 'a', chords: [], melody: [melodyNote('high', 127)] }]), 2)
  assert.match(states.at(-1).error, /outside.*MIDI range/)
  assert.equal(prepared.length, 0)
  await sequencer.play(chart([{ id: 'a', chords: [], melody: [melodyNote('m1', 72, 2)] }]), 0)
  broken = true
  const stops = melodyStopped.length
  clock.tick(900)
  assert.equal(states.at(-1).error, 'Synth unavailable')
  assert.equal(timers.size, 0)
  assert.equal(melodyStopped.length, stops + 1)
})
