/** Small observable Web Audio double, shared by engine and DOM integration tests. */
export function installAudioMock(target, options = {}) {
  const original = {
    audio: Object.getOwnPropertyDescriptor(target, 'AudioContext'),
    webkit: Object.getOwnPropertyDescriptor(target, 'webkitAudioContext'),
    fetch: globalThis.fetch,
  }
  const contexts = []
  const sources = []
  const gains = []
  const fetches = []
  const param = () => ({
    value: 1, events: [],
    setValueAtTime(value, time) { this.events.push(['set', value, time]) },
    linearRampToValueAtTime(value, time) { this.events.push(['ramp', value, time]) },
  })
  const node = () => ({
    connections: [], disconnected: false,
    connect(destination) { this.connections.push(destination); return destination },
    disconnect() { this.disconnected = true },
  })
  class MockAudioContext {
    constructor() {
      this.currentTime = 0
      this.state = 'suspended'
      this.destination = {}
      this.resumeCalls = 0
      this.closeCalls = 0
      this.decodeCalls = 0
      this.onstatechange = null
      contexts.push(this)
    }
    resume() {
      this.resumeCalls++
      if (options.resume) return options.resume(this)
      this.state = 'running'
      return Promise.resolve()
    }
    close() { this.closeCalls++; this.state = 'closed'; return Promise.resolve() }
    decodeAudioData(bytes, success, failure) {
      this.decodeCalls++
      const promise = Promise.resolve().then(() => options.decode ? options.decode(bytes, this) : { duration: 4 })
      promise.then(success, failure)
      return options.callbackDecode ? undefined : promise
    }
    createBufferSource() {
      const source = {
        ...node(), context: this, buffer: null, onended: null, starts: [], stops: [],
        start(when = 0, offset = 0) { this.starts.push({ when, offset }) },
        stop(when) { this.stops.push(when); if (when === undefined) this.stopped = true },
      }
      sources.push(source)
      return source
    }
    createGain() { const gain = { ...node(), gain: param() }; gains.push(gain); return gain }
    createStereoPanner() { return { ...node(), pan: param() } }
  }
  Object.defineProperty(target, 'AudioContext', { configurable: true, value: options.webkitOnly ? undefined : MockAudioContext })
  Object.defineProperty(target, 'webkitAudioContext', { configurable: true, value: options.webkitOnly ? MockAudioContext : undefined })
  globalThis.fetch = (url, init) => {
    fetches.push({ url, init })
    return options.fetch ? options.fetch(url, init) : Promise.resolve({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16) })
  }
  return {
    contexts, sources, gains, fetches,
    advance(seconds) {
      for (const context of contexts) if (context.state === 'running') context.currentTime += seconds
      for (const source of sources) {
        const stopAt = source.stops.at(-1)
        if (!source.stopped && stopAt !== undefined && stopAt <= source.context.currentTime) {
          source.stopped = true
          source.onended?.()
        }
      }
    },
    restore() {
      if (original.audio) Object.defineProperty(target, 'AudioContext', original.audio)
      else delete target.AudioContext
      if (original.webkit) Object.defineProperty(target, 'webkitAudioContext', original.webkit)
      else delete target.webkitAudioContext
      globalThis.fetch = original.fetch
    },
  }
}
