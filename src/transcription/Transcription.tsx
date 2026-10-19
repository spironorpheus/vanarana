import { useEffect, useRef, useState } from 'react'
import { KEYS, QUALITIES, DEFAULT_BPM, MIN_BPM, MAX_BPM, createChart, makeId, degreeName, noteName, chordLabel, chordMidi, parseCharts, serializeCharts, type Chart, type Bar, type Chord, type Quality } from './model'
import { ChordPlayer } from './player'
import { ChartSequencer, type SequenceState } from './sequencer'
import './transcription.css'

const STORAGE = 'vanarana.transcriptions.v1'
function initialData(): { charts: Chart[]; error: string } {
  try { const raw = localStorage.getItem(STORAGE); return { charts: raw ? parseCharts(raw) : [], error: '' } }
  catch { return { charts: [], error: 'Saved transcriptions could not be read. Export any new work before leaving this page.' } }
}
function moved<T>(items: T[], index: number, direction: number) {
  const next = [...items]; const target = index + direction
  if (target >= 0 && target < items.length) [next[index], next[target]] = [next[target], next[index]]
  return next
}

export default function Transcription({ active }: { active: boolean }) {
  const [initial] = useState(initialData)
  const [charts, setCharts] = useState(initial.charts)
  const [chartId, setChartId] = useState(initial.charts[0]?.id ?? '')
  const [selectedBar, setSelectedBar] = useState<string | null>(null)
  const [selectedChord, setSelectedChord] = useState<string | null>(null)
  const [mode, setMode] = useState<'degrees' | 'letters'>('degrees')
  const [targetKey, setTargetKey] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [message, setMessage] = useState(initial.error)
  const [storageFailed, setStorageFailed] = useState(Boolean(initial.error))
  const [audioError, setAudioError] = useState('')
  const [undo, setUndo] = useState<Chart[] | null>(null)
  const [playback, setPlayback] = useState<SequenceState>({ playing: false, barId: null, chordId: null, error: null })
  const sequencer = useRef<ChartSequencer | null>(null)
  const player = useRef<ChordPlayer | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const chart = charts.find(item => item.id === chartId)
  const bar = chart?.bars.find(item => item.id === selectedBar)
  const chord = bar?.chords.find(item => item.id === selectedChord)
  const key = mode === 'letters' ? targetKey ?? chart?.sourceKey ?? 0 : chart?.sourceKey ?? 0

  useEffect(() => {
    if (storageFailed) return
    try { localStorage.setItem(STORAGE, serializeCharts(charts)) }
    catch {
      const warning = setTimeout(() => { setStorageFailed(true); setMessage('Browser storage is unavailable or full. Export a backup to keep your work.') }, 0)
      return () => clearTimeout(warning)
    }
  }, [charts, storageFailed])
  useEffect(() => { if (!active) { sequencer.current?.stop(); player.current?.stop() } }, [active])
  useEffect(() => {
    const stop = () => { if (document.hidden) { sequencer.current?.stop(); player.current?.stop() } }
    document.addEventListener('visibilitychange', stop)
    return () => { document.removeEventListener('visibilitychange', stop); sequencer.current?.dispose(); sequencer.current = null; player.current?.dispose(); player.current = null }
  }, [])

  const stopPlayback = () => { sequencer.current?.stop(); player.current?.stop() }
  const playChart = () => {
    if (!chart) return
    player.current ??= new ChordPlayer()
    sequencer.current ??= new ChartSequencer(player.current, setPlayback)
    setAudioError('')
    void sequencer.current.play(chart, key, selectedBar ?? undefined)
  }

  const commitCharts = (next: Chart[]) => {
    try { serializeCharts(next); stopPlayback(); setCharts(next); return true }
    catch (error) { setMessage(error instanceof Error ? error.message : 'This change exceeds the chart limits.'); return false }
  }
  const update = (fn: (current: Chart) => Chart) => { setUndo(null); commitCharts(charts.map(item => item.id === chartId ? fn(item) : item)) }
  const updateBar = (fn: (current: Bar) => Bar) => update(current => ({ ...current, bars: current.bars.map(item => item.id === selectedBar ? fn(item) : item) }))
  const updateChord = (patch: Partial<Chord>) => updateBar(current => ({ ...current, chords: current.chords.map(item => item.id === selectedChord ? { ...item, ...patch } : item) }))
  const chooseChart = (id: string) => { setUndo(null); setChartId(id); setSelectedBar(null); setSelectedChord(null); setTargetKey(null); stopPlayback() }
  const audition = (value: Chord) => {
    if (playback.playing) return
    player.current ??= new ChordPlayer()
    setAudioError('')
    void player.current.play(chordMidi(value, key)).catch(error => setAudioError(error instanceof Error ? error.message : 'Audio could not play. Try again.'))
  }
  const addChord = (root: number, quality: Quality) => {
    if (playback.playing) return
    const value: Chord = { id: makeId(), root, quality }
    audition(value)
    if (bar) updateBar(current => ({ ...current, chords: [...current.chords, value] }))
  }
  const removeBar = () => {
    update(current => ({ ...current, bars: current.bars.filter(item => item.id !== selectedBar) }))
    setUndo(charts)
    setSelectedBar(null); setSelectedChord(null)
  }
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([serializeCharts(charts)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'vanarana-transcriptions.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const importFile = async (file?: File) => {
    if (!file) return
    try {
      if (file.size > 2_000_000) throw new Error('Choose a JSON backup smaller than 2 MB.')
      const imported = parseCharts(await file.text()).map(item => ({ ...item, id: makeId(), bars: item.bars.map(b => ({ ...b, id: makeId(), chords: b.chords.map(c => ({ ...c, id: makeId() })) })) }))
      if (!commitCharts([...charts, ...imported])) return; if (imported[0]) chooseChart(imported[0].id)
      setMessage(`Imported ${imported.length} transcription${imported.length === 1 ? '' : 's'}. Existing work was kept.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'That backup could not be imported.') }
    if (fileInput.current) fileInput.current.value = ''
  }
  return <main className="transcription content">
    <header className="page-heading"><div><p className="eyebrow">Listen · Find · Write</p><h1>Transcription</h1><p className="lede">Build a chord chart, one bar at a time.</p></div></header>
    <div className="tx-library">
      <label>Transcriptions<select aria-label="Transcriptions" value={chartId} onChange={event => chooseChart(event.target.value)}><option value="" disabled>Choose a transcription</option>{charts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <form className="tx-create" onSubmit={event => { event.preventDefault(); if (!name.trim()) return; const next = createChart(name.trim()); if (commitCharts([...charts, next])) { chooseChart(next.id); setName('') } }}>
        <label>New transcription<input aria-label="New transcription name" value={name} maxLength={120} onChange={event => setName(event.target.value)} placeholder="Song title" required /></label><button className="tx-primary" type="submit">Create</button>
      </form>
      <div className="tx-backups"><button disabled={!charts.length} onClick={exportFile}>Export</button><button onClick={() => fileInput.current?.click()}>Import</button><input ref={fileInput} type="file" accept=".json,application/json" aria-label="Import transcription backup" hidden onChange={event => void importFile(event.target.files?.[0])} /></div>
    </div>
    {message && <p className="tx-notice" role="status">{message}<button aria-label="Dismiss notice" onClick={() => setMessage('')}>×</button></p>}
    {chart ? <>
      <section className="tx-chart" aria-label="Chord chart">
        <div className="tx-chart-heading"><label className="tx-title">Title<input aria-label="Transcription title" value={chart.name} maxLength={120} onChange={event => update(current => ({ ...current, name: event.target.value.trim() ? event.target.value : 'Untitled' }))} onBlur={() => { if (!chart.name.trim()) update(current => ({ ...current, name: 'Untitled' })) }} /></label>
          <label>Major-key reference<select aria-label="Major-key reference" value={chart.sourceKey} onChange={event => { update(current => ({ ...current, sourceKey: Number(event.target.value) })); stopPlayback() }}>{KEYS.map((label, index) => <option value={index} key={label}>1={label}</option>)}</select></label>
          <label>Notation<select aria-label="Notation" value={mode} onChange={event => { setMode(event.target.value as typeof mode); stopPlayback() }}><option value="degrees">Scale degrees</option><option value="letters">Letter chords</option></select></label>
          {mode === 'letters' && <label>Render & play in<select aria-label="Render and play in" value={key} onChange={event => { setTargetKey(Number(event.target.value)); stopPlayback() }}>{KEYS.map((label, index) => <option value={index} key={label}>{label} major</option>)}</select></label>}
        </div>
        <div className="tx-transport" aria-label="Chart playback">
          <button className="tx-primary" disabled={!chart.bars.length} onClick={playback.playing ? stopPlayback : playChart}>{playback.playing ? 'Stop playback' : selectedBar ? `Play from bar ${chart.bars.findIndex(item => item.id === selectedBar) + 1}` : 'Play chart'}</button>
          <label>Tempo (BPM)<input aria-label="Tempo (BPM)" type="number" min={MIN_BPM} max={MAX_BPM} step="1" defaultValue={chart.bpm ?? DEFAULT_BPM} key={`${chart.id}:${chart.bpm}`} onBlur={event => {
            const value = Number(event.target.value)
            const bpm = Number.isFinite(value) ? Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(value))) : DEFAULT_BPM
            event.target.value = String(bpm)
            if (bpm !== (chart.bpm ?? DEFAULT_BPM)) update(current => ({ ...current, bpm }))
          }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
          <span aria-live="polite">{playback.playing ? `Playing bar ${chart.bars.findIndex(item => item.id === playback.barId) + 1}` : '4 beats per bar · chords spaced evenly'}</span>
        </div>
        {playback.error && <p className="tx-notice" role="alert">{playback.error}</p>}
        <div className="tx-bars">{chart.bars.map((item, index) => <div className={`tx-bar ${item.id === selectedBar ? 'is-selected' : ''} ${item.id === playback.barId ? 'is-playing' : ''}`} key={item.id}>
          <button className="tx-bar-select" disabled={playback.playing} aria-label={`Select bar ${index + 1}`} aria-pressed={item.id === selectedBar} onClick={() => { setSelectedBar(item.id === selectedBar ? null : item.id); setSelectedChord(null) }}><span>Bar {index + 1}</span>{(item.section || item.time) && <small>{item.section} {item.time}</small>}</button>
          <div className="tx-chips">{item.chords.map(value => <button disabled={playback.playing} className={`${selectedChord === value.id ? 'is-editing' : ''} ${playback.chordId === value.id ? 'is-sounding' : ''}`} aria-label={`Edit ${chordLabel(value, mode, key)} in bar ${index + 1}`} key={value.id} onClick={() => { setSelectedBar(item.id); setSelectedChord(value.id) }}>{chordLabel(value, mode, key)}</button>)}{!item.chords.length && <button className="tx-empty-bar" disabled={playback.playing} onClick={() => { setSelectedBar(item.id); setSelectedChord(null) }}>Select to add</button>}</div>
        </div>)}</div>
        <div className="tx-chart-actions"><button disabled={playback.playing} onClick={() => update(current => ({ ...current, bars: [...current.bars, { id: makeId(), chords: [] }] }))}>+ Add bar</button>{undo && <button disabled={playback.playing} onClick={() => { setCharts(undo); setUndo(null); setSelectedBar(null); setSelectedChord(null) }}>Undo removal</button>}<span>{storageFailed ? 'Not saved · export a backup' : 'Saved in this browser'}</span></div>
      </section>
      {bar && !playback.playing && <section className="tx-edit" aria-label="Bar editor"><div className="tx-edit-heading"><h2>Bar {chart.bars.indexOf(bar) + 1}</h2><button onClick={() => { setSelectedBar(null); setSelectedChord(null) }}>Done editing</button></div>
        <div className="tx-edit-fields"><label>Section<input value={bar.section ?? ''} maxLength={80} placeholder="Intro" onChange={event => updateBar(current => ({ ...current, section: event.target.value }))} /></label><label>Timestamp<input value={bar.time ?? ''} maxLength={20} placeholder="0:00" onChange={event => updateBar(current => ({ ...current, time: event.target.value }))} /></label><button disabled={chart.bars.indexOf(bar) === 0} onClick={() => update(current => ({ ...current, bars: moved(current.bars, current.bars.indexOf(bar), -1) }))}>Move bar earlier</button><button disabled={chart.bars.indexOf(bar) === chart.bars.length - 1} onClick={() => update(current => ({ ...current, bars: moved(current.bars, current.bars.indexOf(bar), 1) }))}>Move bar later</button><button onClick={removeBar}>Remove bar</button></div>
        {chord && <div className="tx-chord-editor"><strong>Edit {chordLabel(chord, mode, key)}</strong><div className="tx-edit-fields"><label>Root<select aria-label="Chord root" value={chord.root} onChange={event => updateChord({ root: Number(event.target.value) })}>{KEYS.map((_, index) => <option key={index} value={index}>{degreeName(index)} · {noteName(index, key)}</option>)}</select></label><label>Quality<select aria-label="Chord quality" value={chord.quality} onChange={event => updateChord({ quality: event.target.value as Quality })}>{QUALITIES.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}</select></label><label>Slash bass<select aria-label="Slash bass" value={chord.bass ?? ''} onChange={event => updateChord({ bass: event.target.value === '' ? undefined : Number(event.target.value) })}><option value="">Root position</option>{KEYS.map((_, index) => <option key={index} value={index}>{degreeName(index)} · {noteName(index, key)}</option>)}</select></label><button onClick={() => audition(chord)}>Play chord</button><button disabled={bar.chords.indexOf(chord) === 0} onClick={() => updateBar(current => ({ ...current, chords: moved(current.chords, current.chords.indexOf(chord), -1) }))}>Move chord earlier</button><button disabled={bar.chords.indexOf(chord) === bar.chords.length - 1} onClick={() => updateBar(current => ({ ...current, chords: moved(current.chords, current.chords.indexOf(chord), 1) }))}>Move chord later</button><button onClick={() => { updateBar(current => ({ ...current, chords: current.chords.filter(item => item.id !== selectedChord) })); setUndo(charts); setSelectedChord(null) }}>Remove chord</button></div></div>}
      </section>}
    </> : <div className="tx-welcome"><h2>Start with a song title</h2><p>Create a transcription above, or audition chords below.</p></div>}
    <section className="tx-audition" aria-label="Chord audition grid"><div className="tx-grid-heading"><div><h2>Find a chord</h2><p>{playback.playing ? 'Chart playback is running. Stop to audition or edit chords.' : bar ? `Editing bar ${chart!.bars.indexOf(bar) + 1}: each chord you play is also added.` : 'Audition only. Select a bar to add chords as you play.'}</p></div><button onClick={stopPlayback}>Stop sound</button></div>
      {audioError && <p role="alert" className="tx-notice">{audioError}</p>}
      <div className="tx-grid-scroll"><table className="tx-grid"><thead><tr><th scope="col">Root</th>{QUALITIES.map(q => <th scope="col" key={q.id}>{q.label}</th>)}</tr></thead><tbody>{KEYS.map((_, root) => <tr key={root}><th scope="row">{mode === 'degrees' ? degreeName(root) : noteName(root, key)}</th>{QUALITIES.map(q => { const value = { id: '', root, quality: q.id }; return <td key={q.id}><button disabled={playback.playing} aria-label={`${bar ? 'Play and add' : 'Play'} ${chordLabel(value, mode, key)}`} onClick={() => addChord(root, q.id)}>{chordLabel(value, mode, key)}</button></td> })}</tr>)}</tbody></table></div>
      <p className="tx-footnote">Grid chords use root position. Audio follows {KEYS[key]} major. Play your reference track separately.</p>
    </section>
  </main>
}
