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
  const played = [], stopped = [], prepared = [], states = []
  let disposeCalls = 0
  const player = {
    prepare() { prepared.push(now); return options.prepare?.() ?? Promise.resolve() },
    play(midi, playback) {
      played.push({ at: now, midi, ...playback })
      return options.play?.(midi, playback) ?? Promise.resolve()
    },
    stop(immediate) { stopped.push({ at: now, immediate }) },
    dispose() { disposeCalls++ },
  }
  const sequencer = new ChartSequencer(player, state => { states.push(state); options.onState?.(state) }, clock)
  t.after(() => sequencer.dispose())
  return { sequencer, clock, timers, player, played, stopped, prepared, states, disposeCalls: () => disposeCalls }
}

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
  const { sequencer, played } = setup(t)
  for (const [bpm, seconds] of [[40, 6], [240, 1], [1, 6], [1000, 1], [NaN, 2], [Infinity, 2]]) {
    await sequencer.play(chart([{ id: 'a', chords: [chord('a1')] }], bpm), 0)
    assert.equal(played.at(-1).durationSeconds, seconds)
  }
})

test('chart contents, tempo and selected key are snapshotted before pending activation', async t => {
  const activation = deferred()
  const { sequencer, clock, played, states } = setup(t, { prepare: () => activation.promise })
  const input = chart([{ id: 'a', chords: [chord('a1'), chord('a2', 7)] }], 120)
  const playing = sequencer.play(input, 2)
  input.bpm = 40
  input.bars[0].id = 'changed'
  input.bars[0].chords[1].root = 0
  input.bars[0].chords[1].id = 'changed-chord'
  input.bars.push({ id: 'new', chords: [chord('new1')] })
  clock.jump(500)
  activation.resolve()
  await playing
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
  const { sequencer, clock, played, states, timers } = setup(t, { prepare: () => activation.promise })
  const playing = sequencer.play(chart([{ id: 'a', chords: [chord('a1')] }]), 0)
  sequencer.stop()
  await playing
  assert.deepEqual(states.at(-1), idle)
  activation.resolve()
  await flush()
  clock.tick(20_000)
  assert.equal(played.length, 0)
  assert.equal(timers.size, 0)
})

test('newest play wins during activation and obsolete rejection cannot stop it', async t => {
  const first = deferred(), second = deferred()
  let calls = 0
  const { sequencer, clock, played, states } = setup(t, { prepare: () => ++calls === 1 ? first.promise : second.promise })
  const old = sequencer.play(chart([{ id: 'old', chords: [chord('old1')] }]), 0)
  const latest = sequencer.play(chart([{ id: 'latest', chords: [chord('new1', 9)] }]), 0)
  await old
  second.resolve()
  await latest
  first.reject(new Error('Old error'))
  await flush()
  assert.deepEqual(played.map(call => call.midi), [[69, 73, 76]])
  assert.equal(states.at(-1).barId, 'latest')
  assert.equal(states.at(-1).error, null)
  clock.tick(2000)
  assert.deepEqual(states.at(-1), idle)
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
  const { sequencer, clock, played, states, prepared, disposeCalls, timers } = setup(t, { prepare: () => activation.promise })
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
})

test('invalid key or missing selected bar reports an error before opening audio', async t => {
  const { sequencer, prepared, states } = setup(t)
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
