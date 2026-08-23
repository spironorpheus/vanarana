import { useEffect, useMemo, useState } from 'react'
import {
  chordShapes,
  families,
  getTopNote,
  topNotes,
  type ChordShape,
  type FamilyId,
  type TopNote,
  type Voicing,
} from './data/chords'
import {
  matchVoicing,
  midiNoteName,
  rootNotes,
  voicedNotes,
  type VoicingMatch,
} from './music'

const familyFor = (id: FamilyId) => families.find((family) => family.id === id)!
const techniques = ['Drop 2', 'Upper structure'] as const
type Technique = (typeof techniques)[number]

type FilterOption<T extends string> = {
  value: T
  label: string
}

type MidiStatus = 'idle' | 'connecting' | 'connected' | 'no-devices' | 'error' | 'insecure' | 'unsupported'

function useMidiInput() {
  const [access, setAccess] = useState<MIDIAccess | null>(null)
  const [heldNotes, setHeldNotes] = useState<number[]>([])
  const [inputNames, setInputNames] = useState<string[]>([])
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

  useEffect(() => {
    if (!access) return

    const receiveMidi = (event: MIDIMessageEvent) => {
      if (!event.data) return
      const [statusByte, note, velocity] = event.data
      const command = statusByte & 0xf0

      if (command === 0x90 && velocity > 0) {
        setHeldNotes((current) => current.includes(note) ? current : [...current, note].sort((a, b) => a - b))
      } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
        setHeldNotes((current) => current.filter((heldNote) => heldNote !== note))
      } else if (command === 0xb0 && (note === 120 || note === 123)) {
        setHeldNotes([])
      }
    }

    const refreshInputs = () => {
      const inputs = Array.from(access.inputs.values())
      inputs.forEach((input) => { input.onmidimessage = null })
      const connectedInputs = inputs.filter((input) => input.state === 'connected')
      connectedInputs.forEach((input) => { input.onmidimessage = receiveMidi })
      setInputNames(connectedInputs.map((input) => input.name || 'MIDI keyboard'))
      setStatus(connectedInputs.length ? 'connected' : 'no-devices')
      setHeldNotes([])
    }

    refreshInputs()
    access.addEventListener('statechange', refreshInputs)
    return () => {
      access.removeEventListener('statechange', refreshInputs)
      Array.from(access.inputs.values()).forEach((input) => { input.onmidimessage = null })
    }
  }, [access])

  return { connect, heldNotes, inputNames, status }
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
            const hasAccidental = note.startsWith('♭') || note.startsWith('♯')
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

function Matrix({ shapes, midiActive, midiMatches }: { shapes: ChordShape[], midiActive: boolean, midiMatches: Map<Voicing, VoicingMatch> }) {
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
            const family = familyFor(shape.family)
            return (
              <tr key={shape.id}>
                <th className={`family-quality ${shape.family}`}>{family.shortLabel}</th>
                <th><strong>{shape.name}</strong><small>{shape.technique}</small></th>
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
  const [activeTechnique, setActiveTechnique] = useState<'all' | Technique>('all')
  const midi = useMidiInput()
  const midiActive = midi.heldNotes.length >= 3

  const filteredShapes = useMemo(() => {
    return chordShapes.filter((shape) => {
      const matchesFamily = activeFamily === 'all' || shape.family === activeFamily
      const matchesTopNote = activeTopNote === 'all' || shape.voicings.some((voicing) => getTopNote(voicing) === activeTopNote)
      const matchesTechnique = activeTechnique === 'all' || shape.technique === activeTechnique
      return matchesFamily && matchesTopNote && matchesTechnique
    })
  }, [activeFamily, activeTechnique, activeTopNote])

  const midiMatches = useMemo(() => {
    const matches = new Map<Voicing, VoicingMatch>()
    if (!midiActive) return matches

    filteredShapes.forEach((shape) => shape.voicings.forEach((voicing) => {
      if (activeTopNote !== 'all' && getTopNote(voicing) !== activeTopNote) return
      const match = matchVoicing(voicing, midi.heldNotes)
      if (match) matches.set(voicing, match)
    }))
    return matches
  }, [activeTopNote, filteredShapes, midi.heldNotes, midiActive])

  const visibleShapes = midiActive
    ? filteredShapes.filter((shape) => shape.voicings.some((voicing) => midiMatches.has(voicing)))
    : filteredShapes

  const arrangementCount = chordShapes.reduce((total, shape) => total + shape.voicings.length, 0)
  const filteredArrangementCount = filteredShapes.reduce((total, shape) => total + (activeTopNote === 'all' ? shape.voicings.length : 1), 0)

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
              <div><strong>{chordShapes.length}</strong><span>chord shapes</span></div>
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
                ...families.map((family) => ({ value: family.id, label: family.label })),
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
                ...techniques.map((technique) => ({ value: technique, label: technique })),
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
          </div>

          {visibleShapes.length ? (
            <Matrix midiActive={midiActive} midiMatches={midiMatches} shapes={visibleShapes} />
          ) : midiActive ? (
            <div className="empty-state"><div>♪</div><h2>No ordered match</h2><p>No voicing contains these notes in order with the lowest note as its root.</p></div>
          ) : (
            <div className="empty-state"><div>♪</div><h2>No voicings found</h2><p>Try another top note, family, or voicing type.</p><button onClick={() => { setActiveTopNote('all'); setActiveFamily('all'); setActiveTechnique('all') }}>Clear filters</button></div>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
