import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import './melody-keyboard.css'

type MelodyKeyboardProps = {
  disabled?: boolean
  onNoteOn: (id: string, pitch: number) => void
  onNoteOff: (id: string) => void
}

type Contact = {
  id: string
  pitch: number
  pointerId?: number
  target?: HTMLButtonElement
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const KEY_POSITIONS = [0, .7, 1, 1.7, 2, 3, 3.7, 4, 4.7, 5, 5.7, 6]
const BLACK_KEYS = new Set([1, 3, 6, 8, 10])

function activationKey(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key === 'Enter') return 'Enter'
  if (event.key === ' ' || event.key === 'Spacebar') return 'Space'
  return null
}

function releaseCapture(contact: Contact) {
  if (contact.pointerId === undefined || !contact.target) return
  try {
    if (contact.target.hasPointerCapture?.(contact.pointerId)) contact.target.releasePointerCapture(contact.pointerId)
  } catch {
    // The browser may already have released a canceled or detached pointer.
  }
}

export default function MelodyKeyboard({ disabled = false, onNoteOn, onNoteOff }: MelodyKeyboardProps) {
  const instanceId = useId()
  const [octave, setOctave] = useState(4)
  const [pressed, setPressed] = useState<Set<number>>(() => new Set())
  const keybed = useRef<HTMLDivElement>(null)
  const contacts = useRef(new Map<string, Contact>())
  const nextContact = useRef(0)
  const callbacks = useRef({ onNoteOn, onNoteOff })

  useEffect(() => {
    const element = keybed.current
    if (!element) return
    // iOS may begin a native text-selection/callout gesture on the key label
    // before contextmenu fires. Keep this native, non-passive guard on the
    // keybed only; the separate scroll rail and chart text remain untouched.
    const preventNativeGesture = (event: Event) => event.preventDefault()
    element.addEventListener('touchstart', preventNativeGesture, { passive: false })
    element.addEventListener('selectstart', preventNativeGesture)
    return () => {
      element.removeEventListener('touchstart', preventNativeGesture)
      element.removeEventListener('selectstart', preventNativeGesture)
    }
  }, [])

  useLayoutEffect(() => {
    callbacks.current = { onNoteOn, onNoteOff }
  }, [onNoteOn, onNoteOff])

  const refreshPressed = useCallback(() => {
    setPressed(new Set([...contacts.current.values()].map(contact => contact.pitch)))
  }, [])

  const release = useCallback((source: string) => {
    const contact = contacts.current.get(source)
    if (!contact) return
    contacts.current.delete(source)
    releaseCapture(contact)
    callbacks.current.onNoteOff(contact.id)
    refreshPressed()
  }, [refreshPressed])

  const releaseAll = useCallback((updateDisplay = true) => {
    const previous = [...contacts.current.values()]
    contacts.current.clear()
    for (const contact of previous) {
      releaseCapture(contact)
      callbacks.current.onNoteOff(contact.id)
    }
    if (updateDisplay && previous.length) refreshPressed()
  }, [refreshPressed])

  useLayoutEffect(() => {
    if (disabled) releaseAll()
  }, [disabled, releaseAll])

  useEffect(() => {
    const endPointer = (event: globalThis.PointerEvent) => release(`pointer-${event.pointerId}`)
    const loseFocus = () => releaseAll()
    const hidePage = () => { if (document.hidden) releaseAll() }
    // Capture also catches releases outside a key if pointer capture is unavailable.
    window.addEventListener('pointerup', endPointer, true)
    window.addEventListener('pointercancel', endPointer, true)
    window.addEventListener('blur', loseFocus)
    document.addEventListener('visibilitychange', hidePage)
    return () => {
      window.removeEventListener('pointerup', endPointer, true)
      window.removeEventListener('pointercancel', endPointer, true)
      window.removeEventListener('blur', loseFocus)
      document.removeEventListener('visibilitychange', hidePage)
      releaseAll(false)
    }
  }, [release, releaseAll])

  function start(source: string, pitch: number, target?: HTMLButtonElement, pointerId?: number) {
    if (disabled || contacts.current.has(source)) return
    const contact = { id: `${instanceId}-note-${++nextContact.current}`, pitch, target, pointerId }
    contacts.current.set(source, contact)
    refreshPressed()
    callbacks.current.onNoteOn(contact.id, pitch)
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>, pitch: number) {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch {
      // The window listeners still release notes in browsers without capture.
    }
    start(`pointer-${event.pointerId}`, pitch, event.currentTarget, event.pointerId)
  }

  function keyboardDown(event: KeyboardEvent<HTMLButtonElement>, pitch: number) {
    const key = activationKey(event)
    if (!key || event.altKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    if (!event.repeat) start(`key-${pitch}-${key}`, pitch)
  }

  function keyboardUp(event: KeyboardEvent<HTMLButtonElement>, pitch: number) {
    const key = activationKey(event)
    if (!key) return
    event.preventDefault()
    release(`key-${pitch}-${key}`)
  }

  function changeOctave(direction: number) {
    releaseAll()
    setOctave(current => Math.max(2, Math.min(6, current + direction)))
  }

  return <div className="tx-melody-keyboard" role="group" aria-label="Piano keyboard" aria-describedby={`${instanceId}-help`}>
    <div className="tx-keyboard-controls">
      <button type="button" aria-label="Lower keyboard octave" disabled={disabled || octave === 2} onClick={() => changeOctave(-1)}>− Octave</button>
      <span className="tx-keyboard-range" aria-live="polite">C{octave}–B{octave + 1}</span>
      <button type="button" aria-label="Raise keyboard octave" disabled={disabled || octave === 6} onClick={() => changeOctave(1)}>+ Octave</button>
    </div>
    <div className="tx-keyboard-scroll" role="region" aria-label="Scrollable piano keys" tabIndex={0}>
      <div ref={keybed} className="tx-keyboard-keys" onContextMenu={event => event.preventDefault()}>
        {Array.from({ length: 24 }, (_, offset) => {
          const pitch = (octave + 1) * 12 + offset
          const note = offset % 12
          const black = BLACK_KEYS.has(note)
          const label = `${NOTE_NAMES[note]}${octave + Math.floor(offset / 12)}`
          const position = KEY_POSITIONS[note] + Math.floor(offset / 12) * 7
          return <button
            key={pitch}
            type="button"
            className={`tx-piano-key ${black ? 'is-black' : 'is-white'}${pressed.has(pitch) ? ' is-pressed' : ''}`}
            style={{ left: `${position / 14 * 100}%`, width: `${(black ? .6 : 1) / 14 * 100}%` }}
            aria-label={`Play ${label.replace('♯', ' sharp ')}`}
            aria-pressed={pressed.has(pitch)}
            disabled={disabled}
            onPointerDown={event => pointerDown(event, pitch)}
            onPointerUp={event => release(`pointer-${event.pointerId}`)}
            onPointerCancel={event => release(`pointer-${event.pointerId}`)}
            onLostPointerCapture={event => release(`pointer-${event.pointerId}`)}
            onContextMenu={event => event.preventDefault()}
            onKeyDown={event => keyboardDown(event, pitch)}
            onKeyUp={event => keyboardUp(event, pitch)}
            onBlur={() => { release(`key-${pitch}-Enter`); release(`key-${pitch}-Space`) }}
          ><span aria-hidden="true">{label}</span></button>
        })}
      </div>
      <div className="tx-keyboard-scroll-rail" aria-hidden="true">Swipe here to move along the keys</div>
    </div>
    <p id={`${instanceId}-help`} className="tx-keyboard-help">Touch and hold to play. You can play several notes at once. With a keyboard, focus a note and hold Space or Enter.</p>
  </div>
}
