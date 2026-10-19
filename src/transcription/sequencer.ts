import { chordMidi, DEFAULT_BPM, MAX_BARS_PER_CHART, MAX_BPM, MIN_BPM, type Chart } from './model'
import type { ChordPlayer } from './player'

export interface ChartPlaybackState {
  playing: boolean
  barId: string | null
  chordId: string | null
  error: string | null
  /** Four down to one during the recording count-in; zero once recording starts. */
  countInBeatsRemaining?: number
  /** Beats from the selected start, excluding the count-in. */
  elapsedBeats?: number
  /** Absolute chart index, including virtual empty recording bars. */
  barIndex?: number
}

export interface ChartPlaybackOptions {
  countIn?: boolean
  muteMelody?: boolean
  extendForRecording?: boolean
}

export type SequenceState = ChartPlaybackState

/** Cancellable wakeups; audioTime() remains the authoritative production clock. */
export interface SequencerClock {
  now(): number
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>
  clearTimeout(timer: ReturnType<typeof setTimeout>): void
}

const browserClock: SequencerClock = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: timer => clearTimeout(timer),
}

type SequencePlayer = Pick<ChordPlayer, 'prepare' | 'play' | 'stop' | 'startMetronome' | 'stopMetronome'> &
  Partial<Pick<ChordPlayer, 'audioTime' | 'scheduleMelodyNote' | 'stopMelody'>>
type Sound = { midi: number[]; end: number }
type Slot = { barId: string; barIndex: number; chordId: string | null; sound: Sound | null; end: number }
type Melody = { id: string; pitch: number; velocity: number; start: number; end: number }
type Snapshot = { slots: Slot[]; melody: Melody[]; bpm: number; metronome: boolean }
const idle = (): ChartPlaybackState => ({ playing: false, barId: null, chordId: null, error: null })
const MELODY_LOOKAHEAD_MS = 100
const AUDIO_WATCHDOG_MS = 100

/** Play an immutable chart snapshot, optionally with a one-bar recording count-in. */
export class ChartSequencer {
  private readonly player: SequencePlayer
  private readonly onState: (state: ChartPlaybackState) => void
  private readonly clock: SequencerClock
  private timer: ReturnType<typeof setTimeout> | null = null
  private cancelActivation: (() => void) | null = null
  private request = 0
  private disposed = false
  private slots: Slot[] = []
  private melody: Melody[] = []
  private nextMelody = 0
  private currentSlot = -1
  private currentSound: Sound | null = null
  private musicStartedAt = 0
  private activated = false
  private recordingStarted = false
  private secondsPerBeat = 0.5
  private countIn = 0
  private lastCount = -1
  private lastElapsedBeats = 0
  private options: ChartPlaybackOptions = {}

  constructor(player: SequencePlayer, onState: (state: ChartPlaybackState) => void, clock: SequencerClock = browserClock) {
    this.player = player
    this.onState = onState
    this.clock = clock
  }

  /** Call directly in a click/key handler. Resolves once initial activation finishes. */
  async play(chart: Chart, key: number, startBarId?: string, options: ChartPlaybackOptions = {}): Promise<void> {
    if (this.disposed) return
    this.cancel()
    const request = this.request
    try {
      this.options = { ...options }
      const sequence = snapshot(chart, key, startBarId, this.options)
      this.slots = sequence.slots
      this.melody = sequence.melody
      this.secondsPerBeat = 60 / sequence.bpm
      this.countIn = this.options.countIn ? 4 : 0
      if (!this.slots.length) { this.onState(idle()); return }
      const cancelled = new Promise<void>(resolve => { this.cancelActivation = resolve })
      // Construction/resume runs in the original gesture, even for an empty bar.
      const prepared = this.player.prepare()
      this.onState({ playing: true, barId: this.slots[0].barId, chordId: null, error: null,
        ...(this.countIn ? { countInBeatsRemaining: 4 } : {}) })
      await Promise.race([prepared, cancelled])
      if (!this.isCurrent(request)) return
      this.cancelActivation = null
      const startedAt = this.now()
      this.musicStartedAt = startedAt + this.countIn * this.secondsPerBeat * 1000
      this.activated = true
      if (sequence.metronome || this.countIn) {
        const duration = (sequence.metronome ? this.slots[this.slots.length - 1].end / 1000 : 0) + this.countIn * this.secondsPerBeat
        // A continuous track keeps the first chart beat aligned with all four clicks.
        this.player.startMetronome(sequence.bpm, duration, startedAt / 1000)
      }
      this.advance(request)
    } catch (error) { this.fail(request, error) }
  }

  /** Null while loading/counting in/inactive; always measured by the audio clock. */
  getRecordingBeat(): number | null {
    if (!this.activated || !this.slots.length) return null
    try {
      const elapsed = this.now() - this.musicStartedAt
      if (elapsed < 0) return null
      this.recordingStarted = true
      const bounded = Math.min(this.slots[this.slots.length - 1].end, elapsed)
      this.lastElapsedBeats = bounded / (this.secondsPerBeat * 1000)
      return this.lastElapsedBeats
    } catch { return this.recordingStarted ? this.lastElapsedBeats : null }
  }

  stop(): void {
    if (this.disposed) return
    const completion = this.completionState()
    this.cancel()
    this.onState(completion)
  }

  /** The owner retains the shared player and is responsible for disposing it. */
  dispose(): void {
    if (this.disposed) return
    const completion = this.completionState()
    this.cancel()
    this.disposed = true
    this.onState(completion)
  }

  private completionState(): ChartPlaybackState {
    return { ...idle(), ...(this.options.extendForRecording ? {
      elapsedBeats: this.getRecordingBeat() ?? this.lastElapsedBeats,
    } : {}) }
  }

  private now(): number { return this.player.audioTime ? this.player.audioTime() * 1000 : this.clock.now() }
  private isCurrent(request: number): boolean { return !this.disposed && this.request === request }

  private cancel(): void {
    this.request++
    if (this.timer !== null) this.clock.clearTimeout(this.timer)
    this.timer = null
    this.cancelActivation?.()
    this.cancelActivation = null
    this.slots = []
    this.melody = []
    this.nextMelody = 0
    this.currentSlot = -1
    this.currentSound = null
    this.activated = false
    this.recordingStarted = false
    this.lastCount = -1
    this.lastElapsedBeats = 0
    this.options = {}
    this.player.stopMetronome()
    this.player.stopMelody?.()
    this.player.stop(true)
  }

  private fail(request: number, error: unknown): void {
    if (!this.isCurrent(request)) return
    const completion = this.completionState()
    this.cancel()
    this.onState({ ...completion, error: error instanceof Error ? error.message : 'Chart playback could not start. Please try again.' })
  }

  private advance(request: number): void {
    if (!this.isCurrent(request)) return
    this.timer = null
    try { this.advanceAudio(request) } catch (error) { this.fail(request, error) }
  }

  private advanceAudio(request: number): void {
    const now = this.now()
    const elapsed = now - this.musicStartedAt
    this.scheduleMelody(now)
    if (elapsed < 0) {
      const remaining = Math.min(4, Math.ceil(-elapsed / (this.secondsPerBeat * 1000)))
      if (remaining !== this.lastCount) {
        this.lastCount = remaining
        this.onState({ playing: true, barId: this.slots[0].barId, chordId: null, error: null,
          countInBeatsRemaining: remaining, elapsedBeats: 0, barIndex: this.slots[0].barIndex })
      }
      const nextBeat = this.musicStartedAt - (remaining - 1) * this.secondsPerBeat * 1000
      this.wake(request, nextBeat, now)
      return
    }
    let index = Math.max(0, this.currentSlot)
    while (index < this.slots.length && this.slots[index].end <= elapsed) index++
    if (index >= this.slots.length) { this.stop(); return }
    const slot = this.slots[index]
    this.recordingStarted = true
    this.lastElapsedBeats = elapsed / (this.secondsPerBeat * 1000)
    if (index !== this.currentSlot) {
      this.currentSlot = index
      const sound = slot.sound
      const changeSound = sound !== this.currentSound
      if (changeSound) { this.player.stop(true); this.currentSound = sound }
      this.onState({ playing: true, barId: slot.barId, chordId: slot.chordId, error: null,
        ...(this.countIn || this.options.extendForRecording ? {
          countInBeatsRemaining: 0, elapsedBeats: this.lastElapsedBeats, barIndex: slot.barIndex,
        } : {}) })
      if (!this.isCurrent(request)) return
      if (changeSound && sound) {
        const playing = this.player.play([...sound.midi], { durationSeconds: (sound.end - elapsed) / 1000 })
        void playing.catch(error => {
          if (this.isCurrent(request) && this.currentSound === sound) this.fail(request, error)
        })
      }
    }
    this.wake(request, this.musicStartedAt + slot.end, now)
  }

  private scheduleMelody(now: number): void {
    while (this.nextMelody < this.melody.length) {
      const note = this.melody[this.nextMelody]
      const start = this.musicStartedAt + note.start
      if (start > now + MELODY_LOOKAHEAD_MS) break
      this.nextMelody++
      const end = this.musicStartedAt + note.end
      // Timer throttling skips expired notes and trims the head of a held note.
      if (end <= now) continue
      const when = Math.max(now, start)
      this.player.scheduleMelodyNote?.(`playback:${this.request}:${note.id}`, note.pitch, when / 1000,
        (end - when) / 1000, note.velocity)
    }
  }

  private wake(request: number, deadline: number, now: number): void {
    if (!this.isCurrent(request)) return
    const next = this.melody[this.nextMelody]
    if (next) deadline = Math.min(deadline, this.musicStartedAt + next.start - MELODY_LOOKAHEAD_MS)
    // Audio-clock suspension must stop recording rather than leave a frozen take.
    if (this.player.audioTime) deadline = Math.min(deadline, now + AUDIO_WATCHDOG_MS)
    const delay = Math.max(1, deadline - this.now())
    this.timer = this.clock.setTimeout(() => this.advance(request), delay)
  }
}

function snapshot(chart: Chart, key: number, startBarId: string | undefined, options: ChartPlaybackOptions): Snapshot {
  if (!Number.isInteger(key) || key < 0 || key > 11) throw new Error('Key must be a whole number from 0 to 11.')
  const first = startBarId === undefined ? 0 : chart.bars.findIndex(bar => bar.id === startBarId)
  if (first < 0) throw new Error('The selected bar is no longer in this chart.')
  const requestedBpm = chart.bpm ?? DEFAULT_BPM
  const bpm = Number.isFinite(requestedBpm) ? Math.max(MIN_BPM, Math.min(MAX_BPM, requestedBpm)) : DEFAULT_BPM
  const beatDuration = 60_000 / bpm
  const barDuration = 4 * beatDuration
  const slots: Slot[] = []
  const melody: Melody[] = []
  const bars = [...chart.bars]
  if (options.extendForRecording) {
    while (bars.length < MAX_BARS_PER_CHART) bars.push({ id: `recording-bar-${bars.length}`, chords: [] })
  }
  let previousMidi: number[] | null = null
  let sound: Sound | null = null
  for (const bar of bars.slice(0, first)) {
    for (const chord of bar.chords) if (!chord.hold) previousMidi = chordMidi(chord, key)
  }
  bars.slice(first).forEach((bar, barIndex) => {
    const start = barIndex * barDuration
    const end = (barIndex + 1) * barDuration
    if (!bar.chords.length) {
      sound = null
      slots.push({ barId: bar.id, barIndex: first + barIndex, chordId: null, sound: null, end })
      return
    }
    bar.chords.forEach((chord, chordIndex) => {
      const slotEnd = chordIndex === bar.chords.length - 1 ? end : start + (chordIndex + 1) * barDuration / bar.chords.length
      if (!chord.hold) { previousMidi = chordMidi(chord, key); sound = { midi: previousMidi, end: slotEnd } }
      else if (sound) sound.end = slotEnd
      else if (previousMidi) sound = { midi: previousMidi, end: slotEnd }
      slots.push({ barId: bar.id, barIndex: first + barIndex, chordId: chord.id, sound, end: slotEnd })
    })
  })
  if (!options.muteMelody) {
    const sequenceEnd = (bars.length - first) * barDuration
    // Include notes held across a selected start, trimming only their elapsed head.
    chart.bars.forEach((bar, index) => {
      for (const note of bar.melody ?? []) {
        const start = ((index - first) * 4 + note.offset) * beatDuration
        const end = Math.min(sequenceEnd, start + note.duration * beatDuration)
        if (end <= 0 || start >= sequenceEnd) continue
        const pitch = note.pitch + key - chart.sourceKey
        if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) throw new Error('This transposed melody is outside the playable MIDI range.')
        melody.push({ id: note.id, pitch, velocity: note.velocity, start: Math.max(0, start), end })
      }
    })
    melody.sort((a, b) => a.start - b.start)
  }
  return { slots, melody, bpm, metronome: chart.metronome !== false }
}
