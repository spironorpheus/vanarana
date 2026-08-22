import { useMemo, useState } from 'react'
import {
  chordShapes,
  families,
  getTopNote,
  topNotes,
  type ChordShape,
  type FamilyId,
  type TopNote,
} from './data/chords'

const familyFor = (id: FamilyId) => families.find((family) => family.id === id)!
const techniques = ['Drop 2', 'Upper structure'] as const
type Technique = (typeof techniques)[number]

type FilterOption<T extends string> = {
  value: T
  label: string
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

function VoicingStack({ stacks }: { stacks: string[] }) {
  return (
    <div className="voicing-stack">
      {stacks.map((stack, index) => (
        <div className="note-line" key={`${stack}-${index}`}>
          {stack.split(' ').map((note, noteIndex) => {
            const hasAccidental = note.startsWith('♭') || note.startsWith('♯')
            const isTopDegree = index === stacks.length - 1 && noteIndex === stack.split(' ').length - 1
            return (
              <span className={`degree ${isTopDegree ? 'top-degree' : ''}`} key={`${note}-${noteIndex}`}>
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

function Matrix({ shapes }: { shapes: ChordShape[] }) {
  return (
    <div className="matrix-shell">
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
                  return <td className={voicing ? 'has-voicing' : ''} key={note}>{voicing ? <VoicingStack stacks={voicing.stacks} /> : <span className="empty-cell">·</span>}</td>
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function App() {
  const [activeFamily, setActiveFamily] = useState<'all' | FamilyId>('all')
  const [activeTopNote, setActiveTopNote] = useState<'all' | TopNote>('all')
  const [activeTechnique, setActiveTechnique] = useState<'all' | Technique>('all')

  const filteredShapes = useMemo(() => {
    return chordShapes.filter((shape) => {
      const matchesFamily = activeFamily === 'all' || shape.family === activeFamily
      const matchesTopNote = activeTopNote === 'all' || shape.voicings.some((voicing) => getTopNote(voicing) === activeTopNote)
      const matchesTechnique = activeTechnique === 'all' || shape.technique === activeTechnique
      return matchesFamily && matchesTopNote && matchesTechnique
    })
  }, [activeFamily, activeTechnique, activeTopNote])

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
          </section>

          <div className="result-toolbar">
            <div><strong>{filteredShapes.length} shapes</strong><span> · {filteredArrangementCount} arrangements</span></div>
          </div>

          {filteredShapes.length ? (
            <Matrix shapes={filteredShapes} />
          ) : (
            <div className="empty-state"><div>♪</div><h2>No voicings found</h2><p>Try another top note, family, or voicing type.</p><button onClick={() => { setActiveTopNote('all'); setActiveFamily('all'); setActiveTechnique('all') }}>Clear filters</button></div>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
