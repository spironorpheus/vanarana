import { useMemo, useState } from 'react'
import {
  chordShapes,
  families,
  topNotes,
  type ChordShape,
  type FamilyId,
  type TopNote,
} from './data/chords'

type IconName = 'menu'

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

const familyFor = (id: FamilyId) => families.find((family) => family.id === id)!

function VoicingStack({ stacks }: { stacks: string[] }) {
  return (
    <div className="voicing-stack">
      {stacks.map((stack, index) => (
        <div className="note-line" key={`${stack}-${index}`}>
          {stack.split(' ').map((note, noteIndex) => (
            <span className={index === stacks.length - 1 && noteIndex === stack.split(' ').length - 1 ? 'top-degree' : ''} key={`${note}-${noteIndex}`}>{note}</span>
          ))}
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
                <th><span className={`family-mark ${shape.family}`} />{family.shortLabel}</th>
                <th><strong>{shape.name}</strong><small>{shape.technique}</small></th>
                {topNotes.map((note) => {
                  const voicing = shape.voicings.find((item) => item.topNote === note)
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
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const filteredShapes = useMemo(() => {
    return chordShapes.filter((shape) => {
      const matchesFamily = activeFamily === 'all' || shape.family === activeFamily
      const matchesTopNote = activeTopNote === 'all' || shape.voicings.some((voicing) => voicing.topNote === activeTopNote)
      return matchesFamily && matchesTopNote
    })
  }, [activeFamily, activeTopNote])

  const arrangementCount = chordShapes.reduce((total, shape) => total + shape.voicings.length, 0)
  const filteredArrangementCount = filteredShapes.reduce((total, shape) => total + (activeTopNote === 'all' ? shape.voicings.length : 1), 0)

  const chooseFamily = (family: 'all' | FamilyId) => {
    setActiveFamily(family)
    setSidebarOpen(false)
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><span /><span /><span /><span /></div>
          <div><strong>Chord Atlas</strong><small>Voicing notebook</small></div>
        </div>
        <div className="nav-section">
          <div className="nav-label">Families</div>
          <button className={activeFamily === 'all' ? 'active' : ''} onClick={() => chooseFamily('all')}><span className="family-mark all" />All chords<span className="nav-count">{chordShapes.length}</span></button>
          {families.map((family) => (
            <button className={activeFamily === family.id ? 'active' : ''} key={family.id} onClick={() => chooseFamily(family.id)}>
              <span className={`family-mark ${family.id}`} />{family.label}<span className="nav-count">{chordShapes.filter((shape) => shape.family === family.id).length}</span>
            </button>
          ))}
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}

      <main>
        <header className="mobile-bar">
          <button className="menu-button" aria-label="Open menu" onClick={() => setSidebarOpen(true)}><Icon name="menu" /></button>
          <span>Chord Atlas</span>
        </header>

        <div className="content">
          <section className="page-heading">
            <div>
              <p className="eyebrow">Personal voicing library</p>
              <h1>{activeFamily === 'all' ? 'Chords by top note' : `${familyFor(activeFamily).label} voicings`}</h1>
              <p className="lede">Find the shape you need by the note you want to sing on top.</p>
            </div>
            <div className="summary-card">
              <div><strong>{chordShapes.length}</strong><span>chord shapes</span></div>
              <i />
              <div><strong>{arrangementCount}</strong><span>arrangements</span></div>
            </div>
          </section>

          <section className="filter-panel">
            <div className="filter-heading"><span>Top note</span><small>Scale degree</small></div>
            <div className="note-filters">
              <button className={activeTopNote === 'all' ? 'active' : ''} onClick={() => setActiveTopNote('all')}>All</button>
              {topNotes.map((note) => <button className={activeTopNote === note ? 'active' : ''} key={note} onClick={() => setActiveTopNote(note)}>{note}</button>)}
            </div>
          </section>

          <div className="result-toolbar">
            <div><strong>{filteredShapes.length} shapes</strong><span> · {filteredArrangementCount} arrangements</span></div>
          </div>

          {filteredShapes.length ? (
            <Matrix shapes={filteredShapes} />
          ) : (
            <div className="empty-state"><div>♪</div><h2>No voicings found</h2><p>Try another top note or family.</p><button onClick={() => { setActiveTopNote('all'); setActiveFamily('all') }}>Clear filters</button></div>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
