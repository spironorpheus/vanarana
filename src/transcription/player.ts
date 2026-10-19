type Voice = {
  source: OscillatorNode
  gain: GainNode
  startedAt: number
  peak: number
  releasing: boolean
  cleanupTimer: ReturnType<typeof setTimeout> | null
}

const ATTACK_SECONDS = 0.015
const DECAY_SECONDS = 0.18
const RELEASE_START_SECONDS = 0.95
const DURATION_SECONDS = 1.4
const STOP_RELEASE_SECONDS = 0.035
const SUSTAIN = 0.55

/** A small, isolated synth for auditioning a transcription's exact MIDI pitches. */
export class ChordPlayer {
  private context: AudioContext | null = null
  private readonly voices = new Set<Voice>()
  private request = 0
  private cancelResume: (() => void) | null = null
  private disposed = false

  /** Invoke directly from a click/key handler to preserve browser audio activation. */
  async play(midi: number[]): Promise<void> {
    if (this.disposed) return
    this.stop()
    const request = this.request
    // Snapshot the input before awaiting: later edits cannot change this audition.
    const notes = [...new Set(midi)]
    if (notes.some(note => !Number.isInteger(note) || note < 0 || note > 127)) {
      throw new Error('This chord contains an invalid MIDI pitch.')
    }
    if (!notes.length) return

    try {
      const context = this.getContext()
      // Both construction and resume must happen before the first await (Safari).
      const resumed = context.state === 'running' ? Promise.resolve() : context.resume()
      const cancelled = new Promise<void>(resolve => { this.cancelResume = resolve })
      await Promise.race([resumed, cancelled])
      if (this.disposed || request !== this.request) return
      this.cancelResume = null
      if (context.state !== 'running') throw new Error('Your browser paused audio. Try playing the chord again.')
      const startedAt = context.currentTime
      // The sum of all voice peaks stays bounded even for a large voicing.
      const peak = 0.3 / notes.length
      for (const note of notes) this.scheduleVoice(context, note, startedAt, peak)
    } catch (error) {
      if (this.disposed || request !== this.request) return
      this.cancelResume = null
      this.stopVoices(true)
      throw error instanceof Error ? error : new Error('Chord audio could not play. Please try again.')
    }
  }

  /** Cancel pending activation and gently release any sounding chord. */
  stop(): void {
    this.request++
    this.cancelResume?.()
    this.cancelResume = null
    this.stopVoices()
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

  private scheduleVoice(context: AudioContext, note: number, startedAt: number, peak: number): void {
    const source = context.createOscillator()
    let gain: GainNode
    try { gain = context.createGain() } catch (error) { source.disconnect(); throw error }
    const voice: Voice = { source, gain, startedAt, peak, releasing: false, cleanupTimer: null }
    this.voices.add(voice)
    source.type = 'triangle'
    source.frequency.setValueAtTime(440 * 2 ** ((note - 69) / 12), startedAt)
    source.connect(gain)
    gain.connect(context.destination)
    gain.gain.setValueAtTime(0, startedAt)
    gain.gain.linearRampToValueAtTime(peak, startedAt + ATTACK_SECONDS)
    gain.gain.linearRampToValueAtTime(peak * SUSTAIN, startedAt + DECAY_SECONDS)
    gain.gain.setValueAtTime(peak * SUSTAIN, startedAt + RELEASE_START_SECONDS)
    gain.gain.linearRampToValueAtTime(0, startedAt + DURATION_SECONDS)
    source.onended = () => this.removeVoice(voice)
    source.start(startedAt)
    source.stop(startedAt + DURATION_SECONDS)
    this.scheduleCleanup(voice, DURATION_SECONDS)
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
        const level = age < ATTACK_SECONDS ? age / ATTACK_SECONDS
          : age < DECAY_SECONDS ? 1 - (1 - SUSTAIN) * (age - ATTACK_SECONDS) / (DECAY_SECONDS - ATTACK_SECONDS)
          : age < RELEASE_START_SECONDS ? SUSTAIN
          : SUSTAIN * Math.max(0, (DURATION_SECONDS - age) / (DURATION_SECONDS - RELEASE_START_SECONDS))
        voice.gain.gain.cancelScheduledValues(now)
        voice.gain.gain.setValueAtTime(voice.peak * level, now)
        voice.gain.gain.linearRampToValueAtTime(0, now + STOP_RELEASE_SECONDS)
        try { voice.source.stop(now + STOP_RELEASE_SECONDS) } catch { /* Already ended. */ }
        this.scheduleCleanup(voice, STOP_RELEASE_SECONDS)
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
