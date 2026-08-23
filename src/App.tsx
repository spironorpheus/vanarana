import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  chordShapes,
  families,
  getChordFamily,
  getTopNote,
  inferChordFamily,
  topNotes,
  type ChordShape,
  type FamilyId,
  type TopNote,
  type Voicing,
} from './data/chords'
import {
  matchVoicing,
  midiNotesToVoicing,
  midiNoteName,
  rootNotes,
  voicedNotes,
  type VoicingMatch,
} from './music'

const familyFor = (id: FamilyId) => families.find((family) => family.id === id) ?? {
  id,
  label: id,
  shortLabel: id.slice(0, 8),
  description: `Custom ${id} chord family`,
}
const defaultTechniques = ['Drop 2', 'Upper structure']
const localShapesKey = 'chord-atlas.local-shapes.v1'
const lastVoicingTypeKey = 'chord-atlas.last-voicing-type'
const midiRowSplitThresholdMs = 300
const rowCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

type StoredLibrary = {
  version: 1
  shapes: ChordShape[]
  deletedIds: string[]
}

function isChordShape(value: unknown): value is ChordShape {
  if (!value || typeof value !== 'object') return false
  const shape = value as Partial<ChordShape>
  return typeof shape.id === 'string'
    && typeof shape.name === 'string'
    && inferChordFamily(shape.name) !== null
    && (shape.technique === undefined || typeof shape.technique === 'string')
    && ['exploring', 'learning', 'comfortable'].includes(shape.status ?? '')
    && Array.isArray(shape.voicings)
    && shape.voicings.every((voicing) => Array.isArray(voicing?.stacks)
      && voicing.stacks.length > 0
      && voicing.stacks.every((stack) => typeof stack === 'string' && stack.trim().length > 0))
}

function loadLocalLibrary(): StoredLibrary {
  const emptyLibrary: StoredLibrary = { version: 1, shapes: [], deletedIds: [] }
  if (typeof window === 'undefined') return emptyLibrary
  try {
    const stored = JSON.parse(window.localStorage.getItem(localShapesKey) ?? '') as Partial<StoredLibrary>
    if (stored.version !== 1 || !Array.isArray(stored.shapes)) return emptyLibrary
    return {
      version: 1,
      shapes: stored.shapes.filter(isChordShape),
      deletedIds: Array.isArray(stored.deletedIds)
        ? stored.deletedIds.filter((id): id is string => typeof id === 'string')
        : [],
    }
  } catch {
    return emptyLibrary
  }
}

function loadLastVoicingType() {
  if (typeof window === 'undefined') return defaultTechniques[0]
  try {
    return window.localStorage.getItem(lastVoicingTypeKey)?.trim() || defaultTechniques[0]
  } catch {
    return defaultTechniques[0]
  }
}

function mergeShapes(localShapes: ChordShape[], deletedIds: string[]) {
  const overrides = new Map(localShapes.map((shape) => [shape.id, shape]))
  const deleted = new Set(deletedIds)
  const merged = chordShapes.filter((shape) => !deleted.has(shape.id)).map((shape) => overrides.get(shape.id) ?? shape)
  const builtInIds = new Set(chordShapes.map((shape) => shape.id))
  return [...merged, ...localShapes.filter((shape) => !builtInIds.has(shape.id) && !deleted.has(shape.id))]
}

function shapesMatch(first: ChordShape, second: ChordShape) {
  return first.id === second.id
    && first.name === second.name
    && first.technique === second.technique
    && first.status === second.status
    && first.voicings.length === second.voicings.length
    && first.voicings.every((voicing, voicingIndex) => {
      const otherVoicing = second.voicings[voicingIndex]
      return voicing.stacks.length === otherVoicing.stacks.length
        && voicing.stacks.every((stack, stackIndex) => stack === otherVoicing.stacks[stackIndex])
    })
}

function countUnmatchedLocalChanges(library: StoredLibrary) {
  const committedShapes = new Map(chordShapes.map((shape) => [shape.id, shape]))
  const unmatchedShapes = library.shapes.filter((shape) => {
    const committedShape = committedShapes.get(shape.id)
    return !committedShape || !shapesMatch(shape, committedShape)
  })
  const unmatchedDeletions = library.deletedIds.filter((id) => committedShapes.has(id))
  return unmatchedShapes.length + unmatchedDeletions.length
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function compareShapes(first: ChordShape, second: ChordShape) {
  return rowCollator.compare(familyFor(getChordFamily(first.name)).label, familyFor(getChordFamily(second.name)).label)
    || rowCollator.compare(first.name, second.name)
    || rowCollator.compare(first.technique ?? '', second.technique ?? '')
    || rowCollator.compare(first.id, second.id)
}

function createShapeId(shape: ChordShape, shapes: ChordShape[]) {
  const base = `${shape.name}-${shape.technique ?? 'voicing'}`
    .toLowerCase()
    .replaceAll('#', 'sharp')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'chord-shape'
  const existingIds = new Set(shapes.map((item) => item.id))
  let id = base
  let suffix = 2
  while (existingIds.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  return id
}

type FilterOption<T extends string> = {
  value: T
  label: string
}

type MidiStatus = 'idle' | 'connecting' | 'connected' | 'no-devices' | 'error' | 'insecure' | 'unsupported'
type CompletedMidiNotes = { id: number, notes: number[], stacks: number[][] }

function useMidiInput() {
  const [access, setAccess] = useState<MIDIAccess | null>(null)
  const [heldNotes, setHeldNotes] = useState<number[]>([])
  const [inputNames, setInputNames] = useState<string[]>([])
  const activeNotes = useRef(new Set<number>())
  const capturedNotes = useRef(new Map<number, number>())
  const captureId = useRef(0)
  const captureListeners = useRef(new Set<(capture: CompletedMidiNotes) => void>())
  const [status, setStatus] = useState<MidiStatus>(
    typeof window !== 'undefined' && !window.isSecureContext
      ? 'insecure'
      : typeof navigator === 'undefined' || !navigator.requestMIDIAccess ? 'unsupported' : 'idle',
  )

  const connect = async () => {
    if (!navigator.requestMIDIAccess) {
      setStatus('unsupported')
      return
    }

    setStatus('connecting')
    try {
      const midiAccess = await navigator.requestMIDIAccess({ sysex: false })
      setAccess(midiAccess)
    } catch {
      setStatus('error')
    }
  }

  const subscribeToCompletedNotes = useCallback((listener: (capture: CompletedMidiNotes) => void) => {
    captureListeners.current.add(listener)
    return () => { captureListeners.current.delete(listener) }
  }, [])

  useEffect(() => {
    if (!access) return

    const receiveMidi = (event: MIDIMessageEvent) => {
      if (!event.data) return
      const [statusByte, note, velocity] = event.data
      const command = statusByte & 0xf0

      if (command === 0x90 && velocity > 0) {
        activeNotes.current.add(note)
        if (!capturedNotes.current.has(note)) {
          capturedNotes.current.set(note, event.timeStamp || performance.now())
        }
      } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
        activeNotes.current.delete(note)
      } else if (command === 0xb0 && (note === 120 || note === 123)) {
        activeNotes.current.clear()
      } else {
        return
      }

      setHeldNotes([...activeNotes.current].sort((a, b) => a - b))
      if (activeNotes.current.size === 0 && capturedNotes.current.size > 0) {
        const timedNotes = [...capturedNotes.current.entries()]
          .map(([midiNote, startedAt]) => ({ midiNote, startedAt }))
          .sort((a, b) => a.startedAt - b.startedAt || a.midiNote - b.midiNote)
        let largestGap = 0
        let splitAfter = -1
        for (let index = 0; index < timedNotes.length - 1; index += 1) {
          const gap = timedNotes[index + 1].startedAt - timedNotes[index].startedAt
          if (gap > largestGap) {
            largestGap = gap
            splitAfter = index
          }
        }
        const stackGroups = largestGap >= midiRowSplitThresholdMs && splitAfter >= 0
          ? [timedNotes.slice(0, splitAfter + 1), timedNotes.slice(splitAfter + 1)]
          : [timedNotes]
        const stacks = stackGroups.map((stack) => stack.map((item) => item.midiNote).sort((a, b) => a - b))
        const notes = [...capturedNotes.current.keys()].sort((a, b) => a - b)
        capturedNotes.current.clear()
        captureId.current += 1
        const capture = { id: captureId.current, notes, stacks }
        captureListeners.current.forEach((listener) => listener(capture))
      }
    }

    const refreshInputs = () => {
      const inputs = Array.from(access.inputs.values())
      inputs.forEach((input) => { input.onmidimessage = null })
      const connectedInputs = inputs.filter((input) => input.state === 'connected')
      connectedInputs.forEach((input) => { input.onmidimessage = receiveMidi })
      setInputNames(connectedInputs.map((input) => input.name || 'MIDI keyboard'))
      setStatus(connectedInputs.length ? 'connected' : 'no-devices')
      activeNotes.current.clear()
      capturedNotes.current.clear()
      setHeldNotes([])
    }

    refreshInputs()
    access.addEventListener('statechange', refreshInputs)
    return () => {
      access.removeEventListener('statechange', refreshInputs)
      Array.from(access.inputs.values()).forEach((input) => { input.onmidimessage = null })
    }
  }, [access])

  return { connect, heldNotes, inputNames, status, subscribeToCompletedNotes }
}

function MidiFilter({
  connect,
  heldNotes,
  inputNames,
  status,
}: ReturnType<typeof useMidiInput>) {
  const statusText = {
    idle: 'Connect a keyboard to match held notes',
    connecting: 'Requesting MIDI access…',
    connected: inputNames.join(', '),
    'no-devices': 'MIDI is enabled — connect a keyboard',
    error: 'MIDI access was not granted',
    insecure: 'MIDI requires HTTPS or localhost',
    unsupported: 'Web MIDI is not supported in this browser',
  }[status]
  const notesNeeded = Math.max(0, 3 - heldNotes.length)

  return (
    <div className="filter-row midi-filter-row">
      <div className="filter-heading"><span>MIDI input</span><small>Live keyboard</small></div>
      <div className="midi-controls">
        {status === 'idle' || status === 'error' ? (
          <button className="midi-connect" onClick={connect}>Enable MIDI</button>
        ) : null}
        <div className={`midi-status ${status}`} aria-live="polite">
          <i aria-hidden="true" />
          <span>{statusText}</span>
        </div>
        {heldNotes.length > 0 && (
          <div className="held-notes" aria-label={`Held notes: ${heldNotes.map(midiNoteName).join(', ')}`}>
            {heldNotes.map((note) => <span key={note}>{midiNoteName(note)}</span>)}
          </div>
        )}
        {status === 'connected' && (
          <small className={`midi-hint ${notesNeeded === 0 ? 'active' : ''}`}>
            {notesNeeded === 0 ? 'Matching from the lowest-note root' : `Hold ${notesNeeded} more ${notesNeeded === 1 ? 'note' : 'notes'} to filter`}
          </small>
        )}
      </div>
    </div>
  )
}

function FilterRow<T extends string>({
  label,
  hint,
  value,
  allValue,
  options,
  onChange,
}: {
  label: string
  hint: string
  value: T
  allValue: T
  options: FilterOption<T>[]
  onChange: (value: T) => void
}) {
  return (
    <div className="filter-row">
      <div className="filter-heading"><span>{label}</span><small>{hint}</small></div>
      <div className="filter-options">
        {options.map((option) => (
          <button
            className={value === option.value ? 'active' : ''}
            key={option.value}
            onClick={() => onChange(value === option.value ? allValue : option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function VoicingStack({ stacks, matchedNoteIndexes = [] }: { stacks: string[], matchedNoteIndexes?: number[] }) {
  const matchedNotes = new Set(matchedNoteIndexes)
  let flatIndex = 0
  return (
    <div className="voicing-stack">
      {stacks.map((stack, index) => (
        <div className="note-line" key={`${stack}-${index}`}>
          {stack.split(' ').map((note, noteIndex) => {
            const currentIndex = flatIndex++
            const hasAccidental = note.startsWith('b') || note.startsWith('#')
            const isTopDegree = index === stacks.length - 1 && noteIndex === stack.split(' ').length - 1
            return (
              <span className={`degree ${isTopDegree ? 'top-degree' : ''} ${matchedNotes.has(currentIndex) ? 'midi-note-match' : ''}`} key={`${note}-${noteIndex}`}>
                <span className="accidental">{hasAccidental ? note[0] : ''}</span>
                <span>{hasAccidental ? note.slice(1) : note}</span>
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}

const rowColors = ['#c95f45', '#397e70', '#725da8', '#c18a2f', '#36749b']
const whitePitchClasses = new Set([0, 2, 4, 5, 7, 9, 11])

function Piano({ stacks, root }: { stacks: string[], root: number }) {
  const notes = voicedNotes(stacks, root)
  const start = Math.floor(notes[0].pitch / 12) * 12
  const end = (Math.floor(notes.at(-1)!.pitch / 12) + 1) * 12
  const pitches = Array.from({ length: end - start }, (_, index) => start + index)
  const whites = pitches.filter((pitch) => whitePitchClasses.has(pitch % 12))
  const whiteIndex = (pitch: number) => pitches.slice(0, pitch - start).filter((item) => whitePitchClasses.has(item % 12)).length

  return (
    <div className="piano-scroll">
      <div className="piano" style={{ width: `${whites.length * 20}px` }}>
        <div className="white-keys">
          {whites.map((pitch) => {
            const pressed = notes.find((note) => note.pitch === pitch)
            return <div className={`piano-key white-key ${pressed ? 'pressed' : ''}`} key={pitch} style={pressed ? { '--note-color': rowColors[pressed.row % rowColors.length] } as React.CSSProperties : undefined}><span>{pressed?.degree}</span></div>
          })}
        </div>
        {pitches.filter((pitch) => !whitePitchClasses.has(pitch % 12)).map((pitch) => {
          const pressed = notes.find((note) => note.pitch === pitch)
          return <div className={`piano-key black-key ${pressed ? 'pressed' : ''}`} key={pitch} style={{ left: `${whiteIndex(pitch) * 20 - 6}px`, ...(pressed ? { '--note-color': rowColors[pressed.row % rowColors.length] } : {}) } as React.CSSProperties}><span>{pressed?.degree}</span></div>
        })}
      </div>
    </div>
  )
}

function VoicingDialog({ selection, onClose }: { selection: { shape: ChordShape, voicing: Voicing } | null, onClose: () => void }) {
  const [root, setRoot] = useState(0)
  const [voicingIndex, setVoicingIndex] = useState(() => selection ? selection.shape.voicings.indexOf(selection.voicing) : 0)
  useEffect(() => {
    if (!selection) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [selection, onClose])
  if (!selection) return null
  const voicing = selection.shape.voicings[voicingIndex]

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section aria-labelledby="voicing-title" aria-modal="true" className="voicing-dialog" role="dialog">
        <button aria-label="Close piano" className="dialog-close" onClick={onClose}>×</button>
        <p className="eyebrow">Voicing in {rootNotes[root]}</p>
        <h2 id="voicing-title">{selection.shape.name}</h2>
        {selection.shape.voicings.length > 1 && <div aria-label="Voicing" className="voicing-picker">
          {selection.shape.voicings.map((item, index) => <button aria-pressed={voicingIndex === index} className={voicingIndex === index ? 'active' : ''} key={`${getTopNote(item)}-${index}`} onClick={() => setVoicingIndex(index)}>{getTopNote(item)}</button>)}
        </div>}
        <div aria-label="Root note" className="root-picker">
          {rootNotes.map((note, index) => <button aria-pressed={root === index} className={root === index ? 'active' : ''} key={note} onClick={() => setRoot(index)}>{note}</button>)}
        </div>
        <Piano root={root} stacks={voicing.stacks} />
      </section>
    </div>
  )
}

function cloneShape(shape: ChordShape): ChordShape {
  return { ...shape, voicings: shape.voicings.map((voicing) => ({ stacks: [...voicing.stacks] })) }
}

function ShapeEditor({
  midi,
  onClose,
  onDelete,
  onSave,
  shape,
  techniqueOptions,
  newShapeVoicingType,
}: {
  midi: ReturnType<typeof useMidiInput>
  onClose: () => void
  onDelete: (id: string) => void
  onSave: (shape: ChordShape) => void
  shape: ChordShape | null
  techniqueOptions: string[]
  newShapeVoicingType: string
}) {
  const [draft, setDraft] = useState<ChordShape>(() => shape ? cloneShape(shape) : {
    id: '',
    name: '',
    technique: newShapeVoicingType,
    status: 'learning',
    voicings: [],
  })
  const [captureNotice, setCaptureNotice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const subscribeToCompletedNotes = midi.subscribeToCompletedNotes

  useEffect(() => {
    return subscribeToCompletedNotes((completed) => {
      if (completed.notes.length < 2) {
        setCaptureNotice('Play at least two notes together to add a voicing.')
        return
      }

      const voicing = midiNotesToVoicing(completed.notes, completed.stacks)
      const voicingKey = voicing.stacks.join(' / ')
      if (draft.voicings.some((item) => item.stacks.join(' / ') === voicingKey)) {
        setCaptureNotice('That voicing is already in this shape.')
        return
      }

      setDraft((current) => ({ ...current, voicings: [...current.voicings, voicing] }))
      setCaptureNotice(`Added ${completed.notes.map(midiNoteName).join(' · ')} as ${voicingKey}.`)
    })
  }, [draft.voicings, subscribeToCompletedNotes])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const name = draft.name.trim()
    if (!name || !draft.technique?.trim()) {
      setCaptureNotice('Complete the shape name and voicing type.')
      return
    }
    if (!inferChordFamily(name)) {
      setCaptureNotice('Use a shape name beginning with maj, min, m…b5, 7, 9, 13, or alt.')
      return
    }
    if (draft.voicings.length === 0) {
      setCaptureNotice('Add at least one voicing before saving the row.')
      return
    }
    onSave({
      ...draft,
      name,
      technique: draft.technique?.trim(),
    })
  }

  const midiStatus = {
    idle: 'Enable MIDI, then play a voicing',
    connecting: 'Requesting MIDI access…',
    connected: 'Play a voicing, then release every key',
    'no-devices': 'Connect a MIDI keyboard to add voicings',
    error: 'MIDI access was not granted',
    insecure: 'MIDI capture requires HTTPS or localhost',
    unsupported: 'Web MIDI is not supported in this browser',
  }[midi.status]

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section aria-labelledby="shape-editor-title" aria-modal="true" className="shape-editor" role="dialog">
        <form onSubmit={submit}>
          <button aria-label="Close editor" className="dialog-close" onClick={onClose} type="button">×</button>
          <p className="eyebrow">{shape ? 'Edit library row' : 'Add to library'}</p>
          <h2 id="shape-editor-title">{shape ? shape.name : 'New chord shape'}</h2>

          <div className="editor-fields">
            <label>
              <span>Shape name</span>
              <input autoFocus onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. min11" required value={draft.name} />
            </label>
            <label>
              <span>Voicing type</span>
              <input list="technique-designations" onChange={(event) => setDraft({ ...draft, technique: event.target.value })} placeholder="Choose or type a new type" required value={draft.technique ?? ''} />
              <datalist id="technique-designations">{techniqueOptions.map((technique) => <option key={technique} value={technique} />)}</datalist>
            </label>
          </div>

          <div className="editor-section-heading">
            <div><h3>Voicings</h3><p>The lowest note becomes 1. A pause of 0.3 seconds or more starts the second row.</p></div>
            <strong>{draft.voicings.length}</strong>
          </div>

          <div className="editor-voicings">
            {draft.voicings.length ? draft.voicings.map((voicing, index) => (
              <div className="editor-voicing" key={`${voicing.stacks.join('-')}-${index}`}>
                <span className="voicing-number">{index + 1}</span>
                <VoicingStack stacks={voicing.stacks} />
                <span className="voicing-top-note">Top {getTopNote(voicing)}</span>
                <button aria-label={`Delete voicing ${index + 1}`} onClick={() => setDraft({ ...draft, voicings: draft.voicings.filter((_, itemIndex) => itemIndex !== index) })} type="button">Delete</button>
              </div>
            )) : <div className="no-voicings">Play and release a voicing to begin.</div>}
          </div>

          <div className={`midi-capture ${midi.heldNotes.length ? 'recording' : ''}`}>
            <div>
              <span className="capture-light" aria-hidden="true" />
              <div><strong>MIDI capture</strong><small>{midiStatus}</small></div>
            </div>
            {(midi.status === 'idle' || midi.status === 'error') && <button className="midi-connect" onClick={midi.connect} type="button">Enable MIDI</button>}
            {midi.heldNotes.length > 0 && <div className="held-notes">{midi.heldNotes.map((note) => <span key={note}>{midiNoteName(note)}</span>)}</div>}
          </div>
          <p aria-live="polite" className="capture-notice">{captureNotice}</p>

          <div className="editor-actions">
            {shape && <button className={`danger-action ${confirmDelete ? 'confirming' : ''}`} onClick={() => {
              if (confirmDelete) onDelete(shape.id)
              else setConfirmDelete(true)
            }} type="button">{confirmDelete ? 'Confirm delete row' : 'Delete row'}</button>}
            <div>
              <button className="secondary-action" onClick={onClose} type="button">Cancel</button>
              <button className="primary-action" type="submit">Save row</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}

function quote(value: string) {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

function exportShape(shape: ChordShape) {
  const lines = [
    '  {',
    `    id: ${quote(shape.id)},`,
    `    name: ${quote(shape.name)},`,
  ]
  if (shape.technique) lines.push(`    technique: ${quote(shape.technique)},`)
  lines.push(
    `    status: ${quote(shape.status)},`,
    '    voicings: [',
    ...shape.voicings.map((voicing) => `      { stacks: [${voicing.stacks.map(quote).join(', ')}] },`),
    '    ],',
    '  },',
  )
  return lines.join('\n')
}

function ExportDialog({ deletedIds, onClose, shapes }: { deletedIds: string[], onClose: () => void, shapes: ChordShape[] }) {
  const [copied, setCopied] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const deletedSource = deletedIds.length
    ? `// Delete entries with these ids from chordShapes:\n${deletedIds.map((id) => `// - ${id}`).join('\n')}\n\n`
    : ''
  const editedSource = shapes.length
    ? `// Replace matching ids and append new entries in chordShapes.\n${shapes.map(exportShape).join('\n')}`
    : ''
  const source = `${deletedSource}${editedSource}`.trim()

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source)
    } catch {
      textarea.current?.select()
      document.execCommand('copy')
    }
    setCopied(true)
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section aria-labelledby="export-title" aria-modal="true" className="export-dialog" role="dialog">
        <button aria-label="Close export" className="dialog-close" onClick={onClose}>×</button>
        <p className="eyebrow">Local library changes</p>
        <h2 id="export-title">Copy edited entries</h2>
        <p>Apply these changes to <code>chordShapes</code> in <code>src/data/chords.ts</code>. Existing ids replace matching entries, new ids can be appended, and deleted ids should be removed.</p>
        <textarea aria-label="Edited chord entries" readOnly ref={textarea} value={source} />
        <div className="editor-actions">
          <button className="secondary-action" onClick={onClose}>Close</button>
          <button className="primary-action" onClick={copy}>{copied ? 'Copied' : 'Copy entries'}</button>
        </div>
      </section>
    </div>
  )
}

function Matrix({ editedIds, midiActive, midiMatches, onEditShape, shapes }: { editedIds: Set<string>, shapes: ChordShape[], midiActive: boolean, midiMatches: Map<Voicing, VoicingMatch>, onEditShape: (shape: ChordShape) => void }) {
  const [selection, setSelection] = useState<{ shape: ChordShape, voicing: Voicing } | null>(null)
  return (
    <><div className="matrix-shell">
      <table className="matrix">
        <thead>
          <tr>
            <th>Chord</th>
            <th>Shape</th>
            {topNotes.map((note) => <th key={note}>{note}</th>)}
          </tr>
        </thead>
        <tbody>
          {shapes.map((shape) => {
            const familyId = getChordFamily(shape.name)
            const family = familyFor(familyId)
            return (
              <tr key={shape.id}>
                <th className={`family-quality ${familyId}`}>{family.shortLabel}</th>
                <th><button aria-label={`Edit ${shape.name}`} className="shape-edit-button" onClick={() => onEditShape(shape)}><strong>{shape.name}</strong><small>{shape.technique}</small>{editedIds.has(shape.id) && <i aria-label="Locally edited" />}</button></th>
                {topNotes.map((note) => {
                  const voicing = shape.voicings.find((item) => getTopNote(item) === note)
                  const midiMatch = voicing ? midiMatches.get(voicing) : undefined
                  const cellClassName = [voicing ? 'has-voicing' : '', midiMatch ? 'midi-match-cell' : ''].filter(Boolean).join(' ')

                  if (!voicing || (midiActive && !midiMatch)) {
                    return <td className={cellClassName} key={note}><span className="empty-cell">·</span></td>
                  }

                  const label = midiMatch
                    ? `Show matching ${shape.name} voicing in ${rootNotes[midiMatch.root]} with ${note} on top`
                    : `Show ${shape.name} voicing with ${note} on top`
                  return <td className={cellClassName} key={note}><button aria-label={label} className={`voicing-button ${midiMatch ? 'midi-match-button' : ''}`} onClick={() => setSelection({ shape, voicing })}><VoicingStack matchedNoteIndexes={midiMatch?.noteIndexes} stacks={voicing.stacks} />{midiMatch && <span className="midi-root"><small>Root</small>{rootNotes[midiMatch.root]}</span>}</button></td>
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div><VoicingDialog key={selection ? `${selection.shape.id}-${selection.voicing.stacks.join('-')}` : 'closed'} selection={selection} onClose={() => setSelection(null)} /></>
  )
}

function App() {
  const [activeFamily, setActiveFamily] = useState<'all' | FamilyId>('all')
  const [activeTopNote, setActiveTopNote] = useState<'all' | TopNote>('all')
  const [activeTechnique, setActiveTechnique] = useState('all')
  const [localLibrary, setLocalLibrary] = useState<StoredLibrary>(loadLocalLibrary)
  const [lastVoicingType, setLastVoicingType] = useState(loadLastVoicingType)
  const [editor, setEditor] = useState<{ shape: ChordShape | null } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const midi = useMidiInput()
  const midiActive = midi.heldNotes.length >= 3
  const shapes = useMemo(() => mergeShapes(localLibrary.shapes, localLibrary.deletedIds), [localLibrary])
  const editedIds = useMemo(() => new Set(localLibrary.shapes.map((shape) => shape.id)), [localLibrary.shapes])
  const localChangeCount = localLibrary.shapes.length + localLibrary.deletedIds.length
  const familyOptions = families.map((family) => family.id)
  const techniqueOptions = useMemo(() => uniqueStrings([...defaultTechniques, ...shapes.map((shape) => shape.technique)]), [shapes])

  useEffect(() => {
    try {
      window.localStorage.setItem(localShapesKey, JSON.stringify(localLibrary))
    } catch {
      // The in-memory edits still work if storage is unavailable or full.
    }
  }, [localLibrary])

  useEffect(() => {
    try {
      window.localStorage.setItem(lastVoicingTypeKey, lastVoicingType)
    } catch {
      // The in-memory default still works if storage is unavailable or full.
    }
  }, [lastVoicingType])

  const filteredShapes = useMemo(() => {
    return shapes
      .filter((shape) => {
        const matchesFamily = activeFamily === 'all' || getChordFamily(shape.name) === activeFamily
        const matchesTopNote = activeTopNote === 'all' || shape.voicings.some((voicing) => getTopNote(voicing) === activeTopNote)
        const matchesTechnique = activeTechnique === 'all' || shape.technique === activeTechnique
        return matchesFamily && matchesTopNote && matchesTechnique
      })
      .sort(compareShapes)
  }, [activeFamily, activeTechnique, activeTopNote, shapes])

  const midiMatches = useMemo(() => {
    const matches = new Map<Voicing, VoicingMatch>()
    if (!midiActive) return matches

    shapes.forEach((shape) => shape.voicings.forEach((voicing) => {
      const match = matchVoicing(voicing, midi.heldNotes)
      if (match) matches.set(voicing, match)
    }))
    return matches
  }, [midi.heldNotes, midiActive, shapes])

  const visibleShapes = midiActive
    ? shapes
      .filter((shape) => shape.voicings.some((voicing) => midiMatches.has(voicing)))
      .sort(compareShapes)
    : filteredShapes

  const arrangementCount = shapes.reduce((total, shape) => total + shape.voicings.length, 0)
  const filteredArrangementCount = filteredShapes.reduce((total, shape) => total + (activeTopNote === 'all' ? shape.voicings.length : 1), 0)

  const saveShape = (draft: ChordShape) => {
    if (!draft.id && draft.technique) setLastVoicingType(draft.technique)
    const savedShape = { ...draft, id: draft.id || createShapeId(draft, shapes) }
    setLocalLibrary((current) => {
      const existingIndex = current.shapes.findIndex((shape) => shape.id === savedShape.id)
      const nextShapes = existingIndex === -1
        ? [...current.shapes, savedShape]
        : current.shapes.map((shape, index) => index === existingIndex ? savedShape : shape)
      return { ...current, shapes: nextShapes, deletedIds: current.deletedIds.filter((id) => id !== savedShape.id) }
    })
    setEditor(null)
  }

  const deleteShape = (id: string) => {
    const isBuiltIn = chordShapes.some((shape) => shape.id === id)
    setLocalLibrary((current) => ({
      ...current,
      shapes: current.shapes.filter((shape) => shape.id !== id),
      deletedIds: isBuiltIn && !current.deletedIds.includes(id) ? [...current.deletedIds, id] : current.deletedIds,
    }))
    setEditor(null)
  }

  const clearLocalEdits = () => {
    const unmatchedChangeCount = countUnmatchedLocalChanges(localLibrary)
    if (unmatchedChangeCount > 0 && !window.confirm(
      `${unmatchedChangeCount} local ${unmatchedChangeCount === 1 ? 'edit does' : 'edits do'} not match the committed chord library and will be lost. Clear local edits anyway?`,
    )) return

    setLocalLibrary({ version: 1, shapes: [], deletedIds: [] })
  }

  return (
    <div className="app-shell">
      <main>
        <div className="content">
          <section className="page-heading">
            <div>
              <p className="eyebrow">Personal voicing library</p>
              <h1>Chords by top note</h1>
              <p className="lede">Find the shape you need by the note you want to sing on top.</p>
            </div>
            <div className="summary-card">
              <div><strong>{shapes.length}</strong><span>chord shapes</span></div>
              <i />
              <div><strong>{arrangementCount}</strong><span>arrangements</span></div>
            </div>
          </section>

          <section className="filter-panel">
            <FilterRow
              label="Top note"
              hint="Scale degree"
              value={activeTopNote}
              allValue="all"
              options={[
                { value: 'all', label: 'All' },
                ...topNotes.map((note) => ({ value: note, label: note })),
              ]}
              onChange={setActiveTopNote}
            />
            <FilterRow
              label="Chord family"
              hint="Harmony"
              value={activeFamily}
              allValue="all"
              options={[
                { value: 'all', label: 'All' },
                ...familyOptions.map((family) => ({ value: family, label: familyFor(family).label })),
              ]}
              onChange={setActiveFamily}
            />
            <FilterRow
              label="Voicing type"
              hint="Structure"
              value={activeTechnique}
              allValue="all"
              options={[
                { value: 'all', label: 'All' },
                ...techniqueOptions.map((technique) => ({ value: technique, label: technique })),
              ]}
              onChange={setActiveTechnique}
            />
            <MidiFilter {...midi} />
          </section>

          <div className="result-toolbar">
            {midiActive ? (
              <div><strong>{midiMatches.size} matching {midiMatches.size === 1 ? 'voicing' : 'voicings'}</strong><span> · {midi.heldNotes.length} notes held</span></div>
            ) : (
              <div><strong>{filteredShapes.length} shapes</strong><span> · {filteredArrangementCount} arrangements</span></div>
            )}
            <div className="library-actions">
              <button className="secondary-action" disabled={localChangeCount === 0} onClick={() => setExportOpen(true)}>Export edits{localChangeCount ? ` (${localChangeCount})` : ''}</button>
              <button className="danger-action" disabled={localChangeCount === 0} onClick={clearLocalEdits}>Clear local edits</button>
              <button className="primary-action" onClick={() => setEditor({ shape: null })}>+ Add row</button>
            </div>
          </div>

          {visibleShapes.length ? (
            <Matrix editedIds={editedIds} midiActive={midiActive} midiMatches={midiMatches} onEditShape={(shape) => setEditor({ shape })} shapes={visibleShapes} />
          ) : midiActive ? (
            <div className="empty-state"><div>♪</div><h2>No ordered match</h2><p>No voicing contains these notes in order with the lowest note as its root.</p></div>
          ) : (
            <div className="empty-state"><div>♪</div><h2>No voicings found</h2><p>Try another top note, family, or voicing type.</p><button onClick={() => { setActiveTopNote('all'); setActiveFamily('all'); setActiveTechnique('all') }}>Clear filters</button></div>
          )}

          {editor && <ShapeEditor key={editor.shape?.id ?? 'new'} midi={midi} newShapeVoicingType={lastVoicingType} onClose={() => setEditor(null)} onDelete={deleteShape} onSave={saveShape} shape={editor.shape} techniqueOptions={techniqueOptions} />}
          {exportOpen && <ExportDialog deletedIds={localLibrary.deletedIds} onClose={() => setExportOpen(false)} shapes={localLibrary.shapes} />}
        </div>
      </main>
    </div>
  )
}

export default App
