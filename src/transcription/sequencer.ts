import { chordMidi, DEFAULT_BPM, MAX_BPM, MIN_BPM, type Chart } from './model'
import type { ChordPlayer } from './player'

export interface ChartPlaybackState {
  playing: boolean
  barId: string | null
  chordId: string | null
  error: string | null
}

export type SequenceState = ChartPlaybackState

/** A monotonic clock and cancellable timers; injectable for deterministic tests. */
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

type SequencePlayer = Pick<ChordPlayer, 'prepare' | 'play' | 'stop'>
type Slot = { barId: string; chordId: string | null; midi: number[]; start: number; end: number }
const idle = (): ChartPlaybackState => ({ playing: false, barId: null, chordId: null, error: null })

/** Play an immutable chart snapshot from a selected bar through its final beat. */
export class ChartSequencer {
  private readonly player: SequencePlayer
  private readonly onState: (state: ChartPlaybackState) => void
  private readonly clock: SequencerClock
  private timer: ReturnType<typeof setTimeout> | null = null
  private cancelActivation: (() => void) | null = null
  private request = 0
  private disposed = false
  private slots: Slot[] = []
  private currentSlot = -1
  private startedAt = 0

  constructor(player: SequencePlayer, onState: (state: ChartPlaybackState) => void, clock: SequencerClock = browserClock) {
    this.player = player
    this.onState = onState
    this.clock = clock
  }

  /** Call directly in a click/key handler. Resolves once initial activation finishes. */
  async play(chart: Chart, key: number, startBarId?: string): Promise<void> {
    if (this.disposed) return
    this.cancel()
    const request = this.request
    try {
      // Resolve every pitch before awaiting so edits and transposition cannot alter playback.
      this.slots = snapshot(chart, key, startBarId)
      if (!this.slots.length) {
        this.onState(idle())
        return
      }
      const cancelled = new Promise<void>(resolve => { this.cancelActivation = resolve })
      // prepare() creates/resumes audio synchronously, including an initial empty bar.
      const prepared = this.player.prepare()
      this.onState({ playing: true, barId: this.slots[0].barId, chordId: null, error: null })
      await Promise.race([prepared, cancelled])
      if (!this.isCurrent(request)) return
      this.cancelActivation = null
      this.startedAt = this.clock.now()
      this.advance(request)
    } catch (error) {
      this.fail(request, error)
    }
  }

  stop(): void {
    if (this.disposed) return
    this.cancel()
    this.onState(idle())
  }

  /** The owner retains the shared player and is responsible for disposing it. */
  dispose(): void {
    if (this.disposed) return
    this.cancel()
    this.disposed = true
    this.onState(idle())
  }

  private isCurrent(request: number): boolean {
    return !this.disposed && this.request === request
  }

  private cancel(): void {
    this.request++
    if (this.timer !== null) this.clock.clearTimeout(this.timer)
    this.timer = null
    this.cancelActivation?.()
    this.cancelActivation = null
    this.slots = []
    this.currentSlot = -1
    // No release tail may spill into a rest, a replacement, or beyond the chart.
    this.player.stop(true)
  }

  private fail(request: number, error: unknown): void {
    if (!this.isCurrent(request)) return
    this.cancel()
    this.onState({ ...idle(), error: error instanceof Error ? error.message : 'Chart playback could not start. Please try again.' })
  }

  private advance(request: number): void {
    if (!this.isCurrent(request)) return
    this.timer = null
    const elapsed = Math.max(0, this.clock.now() - this.startedAt)
    let index = Math.max(0, this.currentSlot)
    // Timer throttling skips expired chords instead of replaying them in a burst.
    while (index < this.slots.length && this.slots[index].end <= elapsed) index++
    if (index >= this.slots.length) {
      this.stop()
      return
    }
    const slot = this.slots[index]
    if (index !== this.currentSlot) {
      this.currentSlot = index
      this.player.stop(true)
      this.onState({ playing: true, barId: slot.barId, chordId: slot.chordId, error: null })
      if (!this.isCurrent(request)) return
      if (slot.midi.length) {
        try {
          // Audio also has a hard end time, so a delayed JS timer cannot extend a note.
          const playing = this.player.play([...slot.midi], { durationSeconds: (slot.end - elapsed) / 1000 })
          void playing.catch(error => {
            if (this.isCurrent(request) && this.currentSlot === index) this.fail(request, error)
          })
        } catch (error) {
          this.fail(request, error)
          return
        }
      }
    }
    if (!this.isCurrent(request)) return
    // Every wake targets an absolute deadline: callback delays never accumulate.
    const delay = Math.max(0, this.startedAt + slot.end - this.clock.now())
    this.timer = this.clock.setTimeout(() => this.advance(request), delay)
  }
}

function snapshot(chart: Chart, key: number, startBarId?: string): Slot[] {
  if (!Number.isInteger(key) || key < 0 || key > 11) throw new Error('Key must be a whole number from 0 to 11.')
  const first = startBarId === undefined ? 0 : chart.bars.findIndex(bar => bar.id === startBarId)
  if (first < 0) throw new Error('The selected bar is no longer in this chart.')
  const requestedBpm = chart.bpm ?? DEFAULT_BPM
  const bpm = Number.isFinite(requestedBpm) ? Math.max(MIN_BPM, Math.min(MAX_BPM, requestedBpm)) : DEFAULT_BPM
  const barDuration = 4 * 60_000 / bpm
  const slots: Slot[] = []
  chart.bars.slice(first).forEach((bar, barIndex) => {
    const start = barIndex * barDuration
    const end = (barIndex + 1) * barDuration
    if (!bar.chords.length) {
      slots.push({ barId: bar.id, chordId: null, midi: [], start, end })
      return
    }
    bar.chords.forEach((chord, chordIndex) => {
      slots.push({
        barId: bar.id,
        chordId: chord.id,
        midi: chordMidi(chord, key),
        start: start + chordIndex * barDuration / bar.chords.length,
        end: chordIndex === bar.chords.length - 1 ? end : start + (chordIndex + 1) * barDuration / bar.chords.length,
      })
    })
  })
  return slots
}
