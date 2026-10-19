/** Fixed note events exported from the authored MIDI arrangement. Times are seconds. */
export type Note = {
  midi: number
  startSeconds: number
  durationSeconds: number
  velocity: number // MIDI velocity, 0–127.
  program: number // Zero-based General MIDI program.
  channel?: number
  pan?: number // Optional MIDI pan, 0–127.
}

export type Sequence = { durationSeconds: number; notes: readonly Note[] }
/** Exact-pitch, self-hosted samples keyed by `${program}:${midi}`. */
export type SampleManifest = Readonly<Record<string, string>>
export type PlayerState = {
  playing: boolean
  loading: boolean
  error: string | null
  position: number
  duration: number
}

type Voice = { source: AudioBufferSourceNode; gain: GainNode; pan?: StereoPannerNode }

const RELEASE_SECONDS = 0.18
const ATTACK_SECONDS = 0.006
const SCHEDULE_AHEAD_SECONDS = 0.02
const LOAD_TIMEOUT_MS = 20000
// Only successful decodes are shared. An aborted request cannot poison a later retry.
const decodedSamples = new Map<string, AudioBuffer>()
const MAX_CACHED_SAMPLES = 96
const activePlayback: { player: QuizPlayer | null } = { player: null }

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Audio loading cancelled', 'AbortError'))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

// Supporting both signatures also covers older Safari's callback-only decoder.
function decode(context: AudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const result = context.decodeAudioData(bytes, resolve, reject)
    if (result && typeof result.then === 'function') void result.then(resolve, reject)
  })
}

/** Sample playback only: this class never generates or alters the authored note events. */
export class QuizPlayer {
  private readonly sequence: Sequence
  private readonly manifest: SampleManifest
  private readonly onState: (state: PlayerState) => void
  private current: PlayerState
  private context: AudioContext | null = null
  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly voices = new Set<Voice>()
  private request = 0
  private controller: AbortController | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private startedAt = 0
  private startPosition = 0
  private disposed = false

  constructor(sequence: Sequence, manifest: SampleManifest, onState: (state: PlayerState) => void) {
    this.sequence = sequence
    this.manifest = manifest
    this.onState = onState
    this.current = {
      playing: false, loading: false, error: null, position: 0,
      duration: Number.isFinite(sequence.durationSeconds) ? Math.max(0, sequence.durationSeconds) : 0,
    }
  }

  get state(): PlayerState { return { ...this.current } }

  /** Call directly from a click/keyboard handler so context creation and resume keep the gesture. */
  async play(): Promise<void> {
    if (this.disposed || this.current.playing || this.current.loading) return
    if (activePlayback.player && activePlayback.player !== this) activePlayback.player.pause()
    activePlayback.player = this
    const request = ++this.request
    const controller = new AbortController()
    this.controller = controller
    this.publish({ loading: true, error: null })
    if (!this.isCurrent(request)) return
    const timeout = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS)

    try {
      this.validateSequence()
      const context = this.getContext()
      // This must happen before the first await, particularly on mobile Safari.
      const resumed = context.state === 'running' ? Promise.resolve() : context.resume()
      await abortable(Promise.all([resumed, this.loadSamples(context, controller.signal)]), controller.signal)
      if (!this.isCurrent(request)) return
      if (context.state !== 'running') throw new Error('Your browser paused audio. Try Play again.')
      const position = this.current.position >= this.current.duration ? 0 : this.current.position
      this.schedule(position)
    } catch (error) {
      if (!this.isCurrent(request)) return
      controller.abort()
      this.stopVoices()
      if (activePlayback.player === this) activePlayback.player = null
      this.publish({ playing: false, loading: false, error: error instanceof Error && error.name !== 'AbortError'
        ? error.message : 'Audio loading timed out. Check your connection, then try Play again.' })
    } finally {
      clearTimeout(timeout)
      if (this.controller === controller) this.controller = null
    }
  }

  pause(): void {
    if (this.disposed) return
    const position = this.positionNow()
    this.cancelPending()
    this.stopVoices()
    if (activePlayback.player === this) activePlayback.player = null
    this.publish({ playing: false, loading: false, position })
  }

  seek(seconds: number): void {
    if (this.disposed || !Number.isFinite(seconds)) return
    const position = Math.max(0, Math.min(this.current.duration, seconds))
    const continuePlaying = this.current.playing && this.context?.state === 'running'
    this.cancelPending()
    this.stopVoices()
    this.current = { ...this.current, playing: false, loading: false, position }
    // Seeking never creates or resumes a context. A pending load is cancelled, not autoplayed.
    if (continuePlaying && position < this.current.duration) {
      try { this.schedule(position) } catch {
        if (activePlayback.player === this) activePlayback.player = null
        this.stopVoices()
        this.publish({ playing: false, error: 'Audio could not play. Try Play again.' })
      }
    } else {
      if (activePlayback.player === this) activePlayback.player = null
      this.publish({})
    }
  }

  /** Call directly from the Replay button; it always replaces existing playback. */
  replay(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.pause()
    this.current = { ...this.current, position: 0 }
    return this.play()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelPending()
    this.stopVoices()
    if (activePlayback.player === this) activePlayback.player = null
    const context = this.context
    this.context = null
    this.buffers.clear()
    this.current = { ...this.current, playing: false, loading: false }
    if (context) {
      context.onstatechange = null
      if (context.state !== 'closed') void context.close().catch(() => { /* Already closed by the browser. */ })
    }
  }

  private publish(update: Partial<PlayerState>): void {
    this.current = { ...this.current, ...update }
    if (!this.disposed) this.onState(this.state)
  }

  private isCurrent(request: number): boolean { return !this.disposed && request === this.request }

  private cancelPending(): void {
    this.request++
    this.controller?.abort()
    this.controller = null
  }

  private validateSequence(): void {
    if (this.current.duration <= 0 || !this.sequence.notes.length) throw new Error('This example has no playable notes.')
    for (const note of this.sequence.notes) {
      if (!Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127 ||
          !Number.isInteger(note.program) || note.program < 0 || note.program > 127 ||
          !Number.isFinite(note.startSeconds) || note.startSeconds < 0 ||
          !Number.isFinite(note.durationSeconds) || note.durationSeconds <= 0 ||
          !Number.isFinite(note.velocity) || note.velocity < 0 || note.velocity > 127) {
        throw new Error('This example contains an invalid note.')
      }
    }
  }

  private getContext(): AudioContext {
    if (this.context && this.context.state !== 'closed') return this.context
    const browser = window as Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
    const AudioContextClass = browser.AudioContext || browser.webkitAudioContext
    if (!AudioContextClass) throw new Error('This browser does not support audio playback. Try a current browser.')
    const context = new AudioContextClass()
    this.context = context
    context.onstatechange = () => {
      if (this.current.playing && this.context?.state !== 'running') this.pause()
    }
    return context
  }

  private async loadSamples(context: AudioContext, signal: AbortSignal): Promise<void> {
    const keys = [...new Set(this.sequence.notes.filter(note => note.velocity > 0).map(note => `${note.program}:${note.midi}`))]
    let next = 0
    const load = async () => {
      while (next < keys.length && !signal.aborted) {
        const key = keys[next++]
        if (this.buffers.has(key)) continue
        const path = this.manifest[key]
        if (!path) throw new Error('An instrument sample is missing. Please reload this page.')
        const url = new URL(path, window.location.href)
        if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol)) {
          throw new Error('Instrument samples must be hosted with this app.')
        }
        let buffer = decodedSamples.get(url.href)
        if (!buffer) {
          try {
            const response = await fetch(url.href, { signal, credentials: 'same-origin', redirect: 'error' })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const bytes = await response.arrayBuffer()
            if (signal.aborted) return
            buffer = await decode(context, bytes)
            if (signal.aborted) return
            if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error('Empty sample')
            decodedSamples.set(url.href, buffer)
            if (decodedSamples.size > MAX_CACHED_SAMPLES) decodedSamples.delete(decodedSamples.keys().next().value!)
          } catch (error) {
            if (signal.aborted) return
            throw new Error('An instrument sample could not load. Check your connection, then try Play again.', { cause: error })
          }
        }
        if (!signal.aborted) this.buffers.set(key, buffer)
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, keys.length) }, load))
  }

  private schedule(position: number): void {
    const context = this.context!
    this.stopVoices()
    this.startPosition = position
    this.startedAt = context.currentTime + SCHEDULE_AHEAD_SECONDS
    for (const note of this.sequence.notes) {
      if (note.velocity === 0) continue
      const noteEnd = note.startSeconds + note.durationSeconds
      if (noteEnd + RELEASE_SECONDS <= position || note.startSeconds >= this.current.duration) continue
      const buffer = this.buffers.get(`${note.program}:${note.midi}`)
      if (!buffer) throw new Error('An instrument sample is missing. Try Play again.')
      const offset = Math.max(0, position - note.startSeconds)
      if (offset >= buffer.duration) continue
      const when = this.startedAt + Math.max(0, note.startSeconds - position)
      const noteOff = this.startedAt + noteEnd - position
      const end = Math.min(noteOff + RELEASE_SECONDS, when + buffer.duration - offset,
        this.startedAt + this.current.duration - position)
      if (end <= when) continue
      const source = context.createBufferSource()
      const gain = context.createGain()
      const voice: Voice = { source, gain }
      this.voices.add(voice)
      source.buffer = buffer
      // Keep authored pitches exact: every manifest entry is already rendered at its MIDI pitch.
      source.connect(gain)
      if (Number.isFinite(note.pan) && typeof context.createStereoPanner === 'function') {
        voice.pan = context.createStereoPanner()
        voice.pan.pan.value = Math.max(-1, Math.min(1, (note.pan! - 64) / 63))
        gain.connect(voice.pan)
        voice.pan.connect(context.destination)
      } else gain.connect(context.destination)
      const peak = 0.65 * (note.velocity / 127) * Math.min(1, Math.max(0, (noteEnd + RELEASE_SECONDS - position) / RELEASE_SECONDS))
      const attackEnd = Math.min(when + ATTACK_SECONDS, end)
      const releaseStart = Math.max(attackEnd, Math.min(noteOff, end - ATTACK_SECONDS))
      gain.gain.setValueAtTime(0, when)
      gain.gain.linearRampToValueAtTime(peak, attackEnd)
      gain.gain.setValueAtTime(peak, releaseStart)
      gain.gain.linearRampToValueAtTime(0, end)
      source.onended = () => this.removeVoice(voice)
      source.start(when, offset)
      source.stop(end)
    }
    this.timer = setInterval(() => {
      if (this.disposed || !this.current.playing) return
      const positionNow = this.positionNow()
      if (positionNow >= this.current.duration) {
        this.stopVoices()
        if (activePlayback.player === this) activePlayback.player = null
        this.publish({ playing: false, position: this.current.duration })
      } else this.publish({ position: positionNow })
    }, 50)
    this.publish({ playing: true, loading: false, error: null, position })
  }

  private positionNow(): number {
    if (!this.current.playing || !this.context) return this.current.position
    return Math.min(this.current.duration, this.startPosition + Math.max(0, this.context.currentTime - this.startedAt))
  }

  private removeVoice(voice: Voice): void {
    voice.source.onended = null
    voice.source.disconnect()
    voice.gain.disconnect()
    voice.pan?.disconnect()
    this.voices.delete(voice)
  }

  private stopVoices(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null }
    for (const voice of this.voices) {
      voice.source.onended = null
      try { voice.source.stop() } catch { /* Source may already have ended. */ }
      this.removeVoice(voice)
    }
  }
}
