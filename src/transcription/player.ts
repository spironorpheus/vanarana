type Voice = {
  source: OscillatorNode
  gain: GainNode
  startedAt: number
  peak: number
  attack: number
  decay: number
  releaseStart: number
  duration: number
  releasing: boolean
  cleanupTimer: ReturnType<typeof setTimeout> | null
}

const ATTACK_SECONDS = 0.015
const DECAY_SECONDS = 0.18
const RELEASE_START_SECONDS = 0.95
const DURATION_SECONDS = 1.4
const STOP_RELEASE_SECONDS = 0.035
const SUSTAIN = 0.55

export interface ChordPlaybackOptions {
  /** Sustain for this interval, releasing to silence exactly at its end. */
  durationSeconds?: number
}

/** A small, isolated synth for auditioning a transcription's exact MIDI pitches. */
export class ChordPlayer {
  private context: AudioContext | null = null
  private readonly voices = new Set<Voice>()
  private request = 0
  private cancelResume: (() => void) | null = null
  private disposed = false

  /** Invoke directly from a click/key handler to preserve browser audio activation. */
  async play(midi: number[], options: ChordPlaybackOptions = {}): Promise<void> {
    if (this.disposed) return
    this.stop()
    const request = this.request
    // Snapshot the input before awaiting: later edits cannot change this audition.
    const notes = [...new Set(midi)]
    if (notes.some(note => !Number.isInteger(note) || note < 0 || note > 127)) {
      throw new Error('This chord contains an invalid MIDI pitch.')
    }
    const duration = options.durationSeconds ?? DURATION_SECONDS
    const timed = options.durationSeconds !== undefined
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Chord duration must be a positive number.')
    if (!notes.length) return

    try {
      const context = await this.activate(request)
      if (!context || this.disposed || request !== this.request) return
      const startedAt = context.currentTime
      // The sum of all voice peaks stays bounded even for a large voicing.
      const peak = 0.3 / notes.length
      for (const note of notes) this.scheduleVoice(context, note, startedAt, peak, duration, timed)
    } catch (error) {
      if (this.disposed || request !== this.request) return
      this.cancelResume = null
      this.stopVoices(true)
      throw error instanceof Error ? error : new Error('Chord audio could not play. Please try again.')
    }
  }

  /** Activate audio directly in the user gesture, even when a chart starts with a rest. */
  async prepare(): Promise<void> {
    if (this.disposed) return
    this.stop()
    await this.activate(this.request)
  }

  /** Cancel pending activation and gently release any sounding chord. */
  stop(immediate = false): void {
    this.request++
    this.cancelResume?.()
    this.cancelResume = null
    this.stopVoices(immediate)
  }

  private async activate(request: number): Promise<AudioContext | null> {
    try {
      const context = this.getContext()
      // Both construction and resume happen before the first await (Safari).
      const resumed = context.state === 'running' ? Promise.resolve() : context.resume()
      const cancelled = new Promise<void>(resolve => { this.cancelResume = resolve })
      await Promise.race([resumed, cancelled])
      if (this.disposed || request !== this.request) return null
      this.cancelResume = null
      if (context.state !== 'running') throw new Error('Your browser paused audio. Try playing the chord again.')
      return context
    } catch (error) {
      if (this.disposed || request !== this.request) return null
      this.cancelResume = null
      this.stopVoices(true)
      throw error instanceof Error ? error : new Error('Chord audio could not play. Please try again.')
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    this.stopVoices(true)
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
      if (this.context === context && this.voices.size && context.state !== 'running') this.stop()
    }
    return context
  }

  private scheduleVoice(context: AudioContext, note: number, startedAt: number, peak: number, duration: number, timed: boolean): void {
    const source = context.createOscillator()
    let gain: GainNode
    try { gain = context.createGain() } catch (error) { source.disconnect(); throw error }
    const attack = timed ? Math.min(ATTACK_SECONDS, duration * 0.1) : ATTACK_SECONDS
    const decay = timed ? Math.min(DECAY_SECONDS, duration * 0.35) : DECAY_SECONDS
    const releaseStart = timed ? duration - Math.min(STOP_RELEASE_SECONDS, duration * 0.2) : RELEASE_START_SECONDS
    const voice: Voice = { source, gain, startedAt, peak, attack, decay, releaseStart, duration, releasing: false, cleanupTimer: null }
    this.voices.add(voice)
    source.type = 'triangle'
    source.frequency.setValueAtTime(440 * 2 ** ((note - 69) / 12), startedAt)
    source.connect(gain)
    gain.connect(context.destination)
    gain.gain.setValueAtTime(0, startedAt)
    gain.gain.linearRampToValueAtTime(peak, startedAt + attack)
    gain.gain.linearRampToValueAtTime(peak * SUSTAIN, startedAt + decay)
    gain.gain.setValueAtTime(peak * SUSTAIN, startedAt + releaseStart)
    gain.gain.linearRampToValueAtTime(0, startedAt + duration)
    source.onended = () => this.removeVoice(voice)
    source.start(startedAt)
    source.stop(startedAt + duration)
    this.scheduleCleanup(voice, duration)
  }

  private stopVoices(immediate = false): void {
    const context = this.context
    for (const voice of this.voices) {
      if (immediate || !context || context.state !== 'running') {
        try { voice.source.stop() } catch { /* Already stopped or not yet started. */ }
        this.removeVoice(voice)
      } else if (!voice.releasing) {
        voice.releasing = true
        const now = context.currentTime
        // Reconstruct our linear envelope for browsers without cancelAndHoldAtTime.
        const age = Math.max(0, now - voice.startedAt)
        const level = age < voice.attack ? age / voice.attack
          : age < voice.decay ? 1 - (1 - SUSTAIN) * (age - voice.attack) / (voice.decay - voice.attack)
          : age < voice.releaseStart ? SUSTAIN
          : SUSTAIN * Math.max(0, (voice.duration - age) / (voice.duration - voice.releaseStart))
        voice.gain.gain.cancelScheduledValues(now)
        voice.gain.gain.setValueAtTime(voice.peak * level, now)
        const release = Math.max(0, Math.min(STOP_RELEASE_SECONDS, voice.startedAt + voice.duration - now))
        voice.gain.gain.linearRampToValueAtTime(0, now + release)
        try { voice.source.stop(now + release) } catch { /* Already ended. */ }
        this.scheduleCleanup(voice, release)
      }
    }
  }

  private scheduleCleanup(voice: Voice, seconds: number): void {
    if (voice.cleanupTimer !== null) clearTimeout(voice.cleanupTimer)
    // onended is primary; a wall-clock fallback also cleans up interrupted contexts.
    voice.cleanupTimer = setTimeout(() => {
      try { voice.source.stop() } catch { /* Already ended. */ }
      this.removeVoice(voice)
    }, seconds * 1000 + 100)
  }

  private removeVoice(voice: Voice): void {
    if (!this.voices.delete(voice)) return
    if (voice.cleanupTimer !== null) clearTimeout(voice.cleanupTimer)
    voice.source.onended = null
    voice.source.disconnect()
    voice.gain.disconnect()
  }
}
