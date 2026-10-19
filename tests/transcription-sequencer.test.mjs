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
