import { samples } from '../ear-training/samples'
import type { SampleManifest } from '../ear-training/player'
import { MAX_BPM, MIN_BPM } from './model'

type PianoSample = { midi: number; path: string }
type Voice = {
  source: AudioBufferSourceNode | OscillatorNode
  gain: GainNode
  startedAt: number
  peak: number
  attack: number
  releaseStart: number
  duration: number
  releasing: boolean
  cleanupTimer: ReturnType<typeof setTimeout> | null
  melodyId?: string
}
type Metronome = {
  startedAt: number
  endAt: number
  secondsPerBeat: number
  nextBeat: number
  timer: ReturnType<typeof setInterval> | null
}

const ATTACK_SECONDS = 0.006
const DURATION_SECONDS = 1.4
const RELEASE_SECONDS = 0.12
const STOP_RELEASE_SECONDS = 0.035
const LOAD_TIMEOUT_MS = 20000
const METRONOME_LOOKAHEAD_SECONDS = 0.1
const METRONOME_INTERVAL_MS = 25
const CLICK_SECONDS = 0.035
const MELODY_ATTACK_SECONDS = 0.018
const MELODY_RELEASE_SECONDS = 0.06
const MAX_HELD_MELODY_SECONDS = 6_000

export interface ChordPlaybackOptions {
  /** Let the piano decay naturally, with a hard cutoff at this interval's end. */
  durationSeconds?: number
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Piano loading cancelled', 'AbortError'))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

// Older Safari exposes the callback-only decodeAudioData signature.
function decode(context: AudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const result = context.decodeAudioData(bytes, resolve, reject)
    if (result && typeof result.then === 'function') void result.then(resolve, reject)
  })
}

/** Isolated transcription playback using the app's bundled CC0 piano samples. */
export class ChordPlayer {
  private context: AudioContext | null = null
  private readonly piano: PianoSample[]
  private readonly buffers = new Map<number, AudioBuffer>()
  private readonly voices = new Set<Voice>()
  private readonly clicks = new Set<Voice>()
  private readonly melodyVoices = new Set<Voice>()
  private readonly melodyNotes = new Map<string, Set<Voice>>()
  private readonly pendingMelody = new Map<string, AbortController>()
  private metronome: Metronome | null = null
  private request = 0
  private controller: AbortController | null = null
  private disposed = false

  constructor(manifest: SampleManifest = samples) {
    // Read the quiz's existing manifest without changing its player or sample bank.
    this.piano = Object.entries(manifest)
      .filter(([key]) => /^0:(?:0|[1-9]\d*)$/.test(key) && Number(key.slice(2)) <= 127)
      .map(([key, path]) => ({ midi: Number(key.slice(2)), path }))
      .sort((a, b) => a.midi - b.midi)
  }

  /** Invoke directly from a click/key handler to preserve browser audio activation. */
  async play(midi: number[], options: ChordPlaybackOptions = {}): Promise<void> {
    if (this.disposed) return
    this.stop()
    const request = this.request
    // Snapshot input before awaiting: edits and transposition cannot change this chord.
    const notes = [...new Set(midi)]
    if (notes.some(note => !Number.isInteger(note) || note < 0 || note > 127)) {
      throw new Error('This chord contains an invalid MIDI pitch.')
    }
    const duration = options.durationSeconds ?? DURATION_SECONDS
    const timed = options.durationSeconds !== undefined
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Chord duration must be a positive number.')
    if (!notes.length) return
    const pitches = notes.map(note => ({ note, sample: this.nearestSample(note) }))
    await this.activate(request, [...new Set(pitches.map(pitch => pitch.sample))], context => {
      const startedAt = context.currentTime
      // Keep the sum of voice peaks bounded, including unusually large voicings.
      const peak = 0.65 / notes.length
      for (const { note, sample } of pitches) {
        this.schedulePiano(context, this.buffers.get(sample.midi)!, 2 ** ((note - sample.midi) / 12),
          startedAt, peak, duration, timed)
      }
    })
  }

  /** Activate synchronously, then preload the small piano bank before the chart clock starts. */
  async prepare(): Promise<void> {
    if (this.disposed) return
    this.stop()
    if (!this.piano.length) throw new Error('A piano sample is missing. Please reload this page.')
    await this.activate(this.request, this.piano)
  }

  /** Cancel pending piano loading and release chords; chart metronome is independent. */
  stop(immediate = false): void {
    this.request++
    this.controller?.abort()
    this.controller = null
    this.stopVoices(immediate)
  }

  /** The one clock shared by recording, melody, chords, and metronome clicks. */
  audioTime(): number {
    if (this.context && this.context.state !== 'running') {
      throw new Error('Your browser paused audio. Try playing the chart again.')
    }
    return this.context?.currentTime ?? 0
  }

  /** Call directly from a keyboard/pointer gesture. Each finger has its own ID. */
  async startMelodyNote(id: string, pitch: number, velocity = 0.8): Promise<void> {
    if (this.disposed) return
    this.validateMelody(pitch, velocity)
    this.stopMelodyNote(id)
    const controller = new AbortController()
    this.pendingMelody.set(id, controller)
    let timeout: ReturnType<typeof setTimeout> | null = null
    let scheduling = false
    try {
      const context = this.getContext()
      // Resume before the first await, without fetching the piano sample bank.
      if (context.state !== 'running') {
        const resumed = context.resume()
        timeout = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS)
        await abortable(resumed, controller.signal)
      }
      if (this.disposed || this.pendingMelody.get(id) !== controller) return
      if (context.state !== 'running') throw new Error('Your browser paused audio. Try playing the melody again.')
      scheduling = true
      this.scheduleMelodyNote(id, pitch, context.currentTime, MAX_HELD_MELODY_SECONDS, velocity)
    } catch (error) {
      if (this.disposed || (!scheduling && this.pendingMelody.get(id) !== controller)) return
      this.stopMelodyNote(id)
      if (error instanceof Error && error.name !== 'AbortError') throw error
      throw new Error('Melody audio could not start. Please try again.', { cause: error })
    } finally {
      if (timeout !== null) clearTimeout(timeout)
      if (this.pendingMelody.get(id) === controller) this.pendingMelody.delete(id)
    }
  }

  stopMelodyNote(id: string): void {
    this.pendingMelody.get(id)?.abort()
    this.pendingMelody.delete(id)
    const voices = this.melodyNotes.get(id)
    this.melodyNotes.delete(id)
    if (voices) for (const voice of voices) this.stopVoice(voice, false, this.melodyVoices)
  }

  /** Cancel live fingers and already-scheduled playback, independently of piano. */
  stopMelody(immediate = true): void {
    for (const controller of this.pendingMelody.values()) controller.abort()
    this.pendingMelody.clear()
    this.melodyNotes.clear()
    for (const voice of this.melodyVoices) this.stopVoice(voice, immediate, this.melodyVoices)
  }

  /** Prepared chart playback: schedule a flute-like tone at an audio-clock time. */
  scheduleMelodyNote(id: string, pitch: number, startedAt: number, duration: number, velocity = 0.8): void {
    if (this.disposed) return
    this.validateMelody(pitch, velocity)
    if (!Number.isFinite(startedAt) || startedAt < 0 || !Number.isFinite(duration) || duration <= 0) {
      throw new Error('Melody timing must be a positive duration at a valid audio time.')
    }
    const context = this.context
    if (!context || context.state !== 'running') throw new Error('Your browser paused audio. Try playing the melody again.')
    const now = context.currentTime
    const endAt = startedAt + duration
    if (endAt <= now || velocity === 0) return
    startedAt = Math.max(startedAt, now)
    duration = endAt - startedAt
    this.stopMelodyNote(id)
    const voices = new Set<Voice>()
    this.melodyNotes.set(id, voices)
    try {
      // A sine fundamental and quiet second harmonic give a soft flute colour,
      // distinct from the recorded piano, with independent polyphonic envelopes.
      for (const [harmonic, level] of [[1, 0.12], [2, 0.014]]) {
        const source = context.createOscillator()
        let gain: GainNode
        try { gain = context.createGain() } catch (error) { source.disconnect(); throw error }
        const attack = Math.min(MELODY_ATTACK_SECONDS, duration * 0.2)
        const releaseStart = duration - Math.min(MELODY_RELEASE_SECONDS, duration * 0.2)
        const peak = level * velocity
        const voice: Voice = { source, gain, startedAt, peak, attack, releaseStart, duration,
          releasing: false, cleanupTimer: null, melodyId: id }
        voices.add(voice)
        this.melodyVoices.add(voice)
        source.type = 'sine'
        source.frequency.setValueAtTime(440 * 2 ** ((pitch - 69) / 12) * harmonic, startedAt)
        source.connect(gain)
        gain.connect(context.destination)
        gain.gain.setValueAtTime(0, startedAt)
        gain.gain.linearRampToValueAtTime(peak, startedAt + attack)
        gain.gain.setValueAtTime(peak, startedAt + releaseStart)
        gain.gain.linearRampToValueAtTime(0, endAt)
        source.onended = () => this.removeVoice(voice, this.melodyVoices)
        source.start(startedAt)
        source.stop(endAt)
        this.scheduleCleanup(voice, endAt - now, this.melodyVoices)
      }
    } catch (error) {
      for (const voice of voices) this.stopVoice(voice, true, this.melodyVoices)
      this.melodyNotes.delete(id)
      throw error
    }
  }

  private validateMelody(pitch: number, velocity: number): void {
    if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) throw new Error('This melody contains an invalid MIDI pitch.')
    if (!Number.isFinite(velocity) || velocity < 0 || velocity > 1) throw new Error('Melody velocity must be between 0 and 1.')
  }

  /** Chart-only: requires prepare() to have activated the existing audio context. */
  startMetronome(bpm: number, durationSeconds: number, atSeconds?: number): void {
    if (this.disposed) return
    this.stopMetronome()
    if (!Number.isFinite(bpm) || bpm < MIN_BPM / 2 || bpm > MAX_BPM ||
        !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('Metronome tempo or duration is invalid.')
    }
    const context = this.context
    if (!context || context.state !== 'running') throw new Error('Your browser paused audio. Try playing the chart again.')
    const startedAt = atSeconds ?? context.currentTime
    if (!Number.isFinite(startedAt) || startedAt < 0) throw new Error('Metronome start time is invalid.')
    const metronome: Metronome = {
      startedAt, endAt: startedAt + durationSeconds,
      secondsPerBeat: 60 / bpm, nextBeat: 0, timer: null,
    }
    this.metronome = metronome
    try {
      this.scheduleClicks(context, metronome)
      if (this.metronome !== metronome) return
      metronome.timer = setInterval(() => {
        if (this.metronome !== metronome) return
        try { this.scheduleClicks(context, metronome) } catch { this.stopMetronome() }
      }, METRONOME_INTERVAL_MS)
    } catch (error) {
      this.stopMetronome()
      throw error
    }
  }

  stopMetronome(): void {
    if (this.metronome?.timer !== null && this.metronome?.timer !== undefined) clearInterval(this.metronome.timer)
    this.metronome = null
    for (const click of this.clicks) {
      try { click.source.stop() } catch { /* Already ended or not yet started. */ }
      this.removeVoice(click, this.clicks)
    }
  }

  private nearestSample(note: number): PianoSample {
    if (!this.piano.length) throw new Error('A piano sample is missing. Please reload this page.')
    // Sorted order breaks equal-distance ties toward the lower sample deterministically.
    return this.piano.reduce((nearest, sample) => Math.abs(note - sample.midi) < Math.abs(note - nearest.midi) ? sample : nearest)
  }

  private async activate(request: number, needed: readonly PianoSample[], ready?: (context: AudioContext) => void): Promise<void> {
    let controller: AbortController | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null
    try {
      const context = this.getContext()
      // Construction and resume happen before the first await, particularly on Safari.
      const resumed = context.state === 'running' ? null : context.resume()
      if (!resumed && needed.every(sample => this.buffers.has(sample.midi))) {
        // Prepared chart notes schedule synchronously: no fetch/decode or async timing drift.
        ready?.(context)
        return
      }
      controller = new AbortController()
      this.controller = controller
      timeout = setTimeout(() => controller!.abort(), LOAD_TIMEOUT_MS)
      await abortable(Promise.all([resumed, this.loadSamples(context, needed, controller.signal)]), controller.signal)
      if (this.disposed || request !== this.request) return
      if (context.state !== 'running') throw new Error('Your browser paused audio. Try playing the chord again.')
      ready?.(context)
    } catch (error) {
      if (this.disposed || request !== this.request) return
      controller?.abort()
      this.stopVoices(true)
      if (error instanceof Error && error.name !== 'AbortError') throw error
      throw new Error('Piano audio could not load. Check your connection, then try playing again.', { cause: error })
    } finally {
      if (timeout !== null) clearTimeout(timeout)
      if (this.controller === controller) this.controller = null
    }
  }

  private async loadSamples(context: AudioContext, needed: readonly PianoSample[], signal: AbortSignal): Promise<void> {
    let next = 0
    const load = async () => {
      while (next < needed.length && !signal.aborted) {
        const sample = needed[next++]
        if (this.buffers.has(sample.midi)) continue
        if (!sample.path) throw new Error('A piano sample is missing. Please reload this page.')
        const url = new URL(sample.path, window.location.href)
        if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol)) {
          throw new Error('Piano samples must be hosted with this app.')
        }
        try {
          const response = await fetch(url.href, { signal, credentials: 'same-origin', redirect: 'error' })
          if (signal.aborted) return
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const bytes = await response.arrayBuffer()
          if (signal.aborted) return
          const buffer = await decode(context, bytes)
          if (signal.aborted) return
          if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error('Empty piano sample')
          this.buffers.set(sample.midi, buffer)
        } catch (error) {
          if (signal.aborted) return
          throw new Error('A piano sample could not load. Check your connection, then try playing again.', { cause: error })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, needed.length) }, load))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop(true)
    this.stopMetronome()
    this.stopMelody()
    this.buffers.clear()
    const context = this.context
    this.context = null
    if (context) {
      context.onstatechange = null
      if (context.state !== 'closed') void context.close().catch(() => { /* Browser already closed it. */ })
    }
  }

  private getContext(): AudioContext {
    if (this.context && this.context.state !== 'closed') return this.context
    const browser = typeof window === 'undefined' ? undefined : window as Window & {
      AudioContext?: typeof AudioContext
      webkitAudioContext?: typeof AudioContext
    }
    const Context = browser?.AudioContext || browser?.webkitAudioContext
    if (!Context) throw new Error('This browser does not support audio playback. Try a current browser.')
    const context = new Context()
    this.context = context
    context.onstatechange = () => {
      if (this.context === context && (this.voices.size || this.metronome || this.melodyVoices.size || this.pendingMelody.size) && context.state !== 'running') {
        this.stop(true)
        this.stopMetronome()
        this.stopMelody()
      }
    }
    return context
  }

  private schedulePiano(context: AudioContext, buffer: AudioBuffer, rate: number, startedAt: number, peak: number, requestedDuration: number, timed: boolean): void {
    const source = context.createBufferSource()
    let gain: GainNode
    try { gain = context.createGain() } catch (error) { source.disconnect(); throw error }
    // Never loop or retrigger a held piano chord. Its recorded decay may finish earlier.
    const duration = Math.min(requestedDuration, buffer.duration / rate)
    const attack = Math.min(ATTACK_SECONDS, duration * 0.1)
    const releaseStart = duration - Math.min(timed ? STOP_RELEASE_SECONDS : RELEASE_SECONDS, duration * 0.2)
    const voice: Voice = { source, gain, startedAt, peak, attack, releaseStart, duration, releasing: false, cleanupTimer: null }
    this.voices.add(voice)
    source.buffer = buffer
    source.loop = false
    source.playbackRate.setValueAtTime(rate, startedAt)
    source.connect(gain)
    gain.connect(context.destination)
    gain.gain.setValueAtTime(0, startedAt)
    gain.gain.linearRampToValueAtTime(peak, startedAt + attack)
    gain.gain.setValueAtTime(peak, startedAt + releaseStart)
    gain.gain.linearRampToValueAtTime(0, startedAt + duration)
    source.onended = () => this.removeVoice(voice)
    source.start(startedAt)
    source.stop(startedAt + duration)
    this.scheduleCleanup(voice, duration)
  }

  private scheduleClicks(context: AudioContext, metronome: Metronome): void {
    const now = context.currentTime
    if (context.state !== 'running' || now >= metronome.endAt) { this.stopMetronome(); return }
    // Skip expired beats after timer throttling, rather than playing a burst of late clicks.
    if (metronome.nextBeat > 0) {
      metronome.nextBeat = Math.max(metronome.nextBeat, Math.ceil((now - metronome.startedAt) / metronome.secondsPerBeat))
    }
    const horizon = Math.min(now + METRONOME_LOOKAHEAD_SECONDS, metronome.endAt)
    while (true) {
      const when = metronome.startedAt + metronome.nextBeat * metronome.secondsPerBeat
      if (when > horizon || when >= metronome.endAt) break
      const accented = metronome.nextBeat % 4 === 0
      metronome.nextBeat++
      const source = context.createOscillator()
      let gain: GainNode
      try { gain = context.createGain() } catch (error) { source.disconnect(); throw error }
      const duration = Math.min(CLICK_SECONDS, metronome.endAt - when)
      const attack = Math.min(0.001, duration / 4)
      const peak = accented ? 0.18 : 0.1
      const click: Voice = { source, gain, startedAt: when, peak, attack, releaseStart: attack,
        duration, releasing: false, cleanupTimer: null }
      this.clicks.add(click)
      source.type = 'sine'
      source.frequency.setValueAtTime(accented ? 1320 : 880, when)
      source.connect(gain)
      gain.connect(context.destination)
      gain.gain.setValueAtTime(0, when)
      gain.gain.linearRampToValueAtTime(peak, when + attack)
      gain.gain.linearRampToValueAtTime(0, when + duration)
      source.onended = () => this.removeVoice(click, this.clicks)
      source.start(when)
      source.stop(when + duration)
      this.scheduleCleanup(click, when - now + duration, this.clicks)
    }
  }

  private stopVoices(immediate = false): void {
    for (const voice of this.voices) this.stopVoice(voice, immediate, this.voices)
  }

  private stopVoice(voice: Voice, immediate: boolean, voices: Set<Voice>): void {
    const context = this.context
    if (immediate || !context || context.state !== 'running' || voice.startedAt > context.currentTime) {
      try { voice.source.stop() } catch { /* Already stopped or not yet started. */ }
      this.removeVoice(voice, voices)
    } else if (!voice.releasing) {
      voice.releasing = true
      const now = context.currentTime
      // Reconstruct our linear gain envelope without relying on cancelAndHoldAtTime.
      const age = Math.max(0, now - voice.startedAt)
      const level = age < voice.attack ? age / voice.attack
        : age < voice.releaseStart ? 1
        : Math.max(0, (voice.duration - age) / (voice.duration - voice.releaseStart))
      voice.gain.gain.cancelScheduledValues(now)
      voice.gain.gain.setValueAtTime(voice.peak * level, now)
      const release = Math.max(0, Math.min(STOP_RELEASE_SECONDS, voice.startedAt + voice.duration - now))
      voice.gain.gain.linearRampToValueAtTime(0, now + release)
      try { voice.source.stop(now + release) } catch { /* Already ended. */ }
      this.scheduleCleanup(voice, release, voices)
    }
  }

  private scheduleCleanup(voice: Voice, seconds: number, voices = this.voices): void {
    if (voice.cleanupTimer !== null) clearTimeout(voice.cleanupTimer)
    // onended is primary; wall-clock fallback also cleans up interrupted contexts.
    voice.cleanupTimer = setTimeout(() => {
      try { voice.source.stop() } catch { /* Already ended. */ }
      this.removeVoice(voice, voices)
    }, seconds * 1000 + 100)
  }

  private removeVoice(voice: Voice, voices = this.voices): void {
    if (!voices.delete(voice)) return
    if (voice.melodyId !== undefined) {
      const notes = this.melodyNotes.get(voice.melodyId)
      notes?.delete(voice)
      if (notes?.size === 0) this.melodyNotes.delete(voice.melodyId)
    }
    if (voice.cleanupTimer !== null) clearTimeout(voice.cleanupTimer)
    voice.source.onended = null
    voice.source.disconnect()
    voice.gain.disconnect()
  }
}
