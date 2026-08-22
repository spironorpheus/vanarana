import { useEffect, useMemo, useRef, useState } from 'react'
import {
  chordShapes,
  families,
  topNotes,
  type ChordShape,
  type FamilyId,
  type TopNote,
} from './data/chords'

type IconName =
  | 'book'
  | 'menu'
  | 'search'
  | 'shuffle'
  | 'x'
  | 'code'

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z"/></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    shuffle: <><path d="M3 7h3c4 0 6 10 10 10h5"/><path d="m18 14 3 3-3 3M3 17h3c1.4 0 2.5-1.2 3.5-2.8M14.5 8.9C15 7.8 15.7 7 17 7h4"/><path d="m18 4 3 3-3 3"/></>,
    x: <path d="m6 6 12 12M18 6 6 18"/>,
    code: <><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></>,
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

function DetailDialog({ shape, onClose }: { shape: ChordShape; onClose: () => void }) {
  const family = familyFor(shape.family)
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close-button" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        <div className="detail-kicker">{family.label} · {shape.technique}</div>
        <h2 id="detail-title">{shape.name}</h2>
        <p className="detail-copy">Practice each inversion slowly, keeping the highlighted top note present in your ear.</p>
        <div className="detail-voicings">
          {shape.voicings.map((voicing) => (
            <div className="detail-voicing" key={voicing.topNote}>
              <span className="top-note large">{voicing.topNote}</span>
              <div><small>Top note</small><VoicingStack stacks={voicing.stacks} /></div>
            </div>
          ))}
        </div>
        <div className="detail-meta"><span className={`status-pill ${shape.status}`}>{shape.status}</span><code>{shape.id}</code></div>
      </section>
    </div>
  )
}

function App() {
  const [activeFamily, setActiveFamily] = useState<'all' | FamilyId>('all')
  const [activeTopNote, setActiveTopNote] = useState<'all' | TopNote>('all')
  const [query, setQuery] = useState('')
  const [selectedShape, setSelectedShape] = useState<ChordShape | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInput.current?.focus()
      }
      if (event.key === 'Escape') {
        setSelectedShape(null)
        setSidebarOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const filteredShapes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return chordShapes.filter((shape) => {
      const matchesFamily = activeFamily === 'all' || shape.family === activeFamily
      const matchesTopNote = activeTopNote === 'all' || shape.voicings.some((voicing) => voicing.topNote === activeTopNote)
      const searchable = [shape.name, shape.technique, familyFor(shape.family).label, ...shape.voicings.flatMap((voicing) => voicing.stacks)].join(' ').toLocaleLowerCase()
      return matchesFamily && matchesTopNote && (!normalizedQuery || searchable.includes(normalizedQuery))
    })
  }, [activeFamily, activeTopNote, query])

  const arrangementCount = chordShapes.reduce((total, shape) => total + shape.voicings.length, 0)
  const filteredArrangementCount = filteredShapes.reduce((total, shape) => total + (activeTopNote === 'all' ? shape.voicings.length : 1), 0)

  const chooseFamily = (family: 'all' | FamilyId) => {
    setActiveFamily(family)
    setSidebarOpen(false)
  }

  const openPractice = () => {
    if (!filteredShapes.length) return
    const shape = filteredShapes[Math.floor(Math.random() * filteredShapes.length)]
    setSelectedShape(shape)
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><span /><span /><span /><span /></div>
          <div><strong>Chord Atlas</strong><small>Voicing notebook</small></div>
        </div>
        <nav className="primary-nav" aria-label="Main navigation">
          <button className="active"><Icon name="book" /><span>Library</span><span className="nav-count">{chordShapes.length}</span></button>
        </nav>
        <div className="nav-section">
          <div className="nav-label">Families</div>
          <button className={activeFamily === 'all' ? 'active' : ''} onClick={() => chooseFamily('all')}><span className="family-mark all" />All chords<span className="nav-count">{chordShapes.length}</span></button>
          {families.map((family) => (
            <button className={activeFamily === family.id ? 'active' : ''} key={family.id} onClick={() => chooseFamily(family.id)}>
              <span className={`family-mark ${family.id}`} />{family.label}<span className="nav-count">{chordShapes.filter((shape) => shape.family === family.id).length}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-note">
          <Icon name="code" />
          <div><strong>Code-backed</strong><span>Edit <code>chords.ts</code> to grow your library.</span></div>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}

      <main>
        <header className="topbar">
          <button className="menu-button" aria-label="Open menu" onClick={() => setSidebarOpen(true)}><Icon name="menu" /></button>
          <label className="search-box">
            <Icon name="search" />
            <input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chords or degrees…" />
            <kbd>⌘ K</kbd>
          </label>
          <button className="practice-button" onClick={openPractice} disabled={!filteredShapes.length}><Icon name="shuffle" /><span>Practice one</span></button>
          <div className="avatar">JL</div>
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
            <div className="empty-state"><div>♪</div><h2>No voicings found</h2><p>Try another top note, family, or search.</p><button onClick={() => { setQuery(''); setActiveTopNote('all'); setActiveFamily('all') }}>Clear filters</button></div>
          )}
        </div>
      </main>
      {selectedShape && <DetailDialog shape={selectedShape} onClose={() => setSelectedShape(null)} />}
    </div>
  )
}

export default App
