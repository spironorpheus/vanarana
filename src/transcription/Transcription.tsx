import { useCallback, useEffect, useRef, useState } from 'react'
import { KEYS, QUALITIES, DEFAULT_BPM, MIN_BPM, MAX_BPM, MAX_BARS_PER_CHART, createChart, makeId, degreeName, noteName, chordLabel, chordMidi, parseCharts, serializeCharts, parseBarText, barText, type Chart, type Bar, type Chord, type Quality } from './model'
import { ChordPlayer } from './player'
import { ChartSequencer, type SequenceState } from './sequencer'
import { replaceMelodyTake, sourceMelodyPitch, type RecordedMelodyNote } from './melody'
import MelodyKeyboard from './MelodyKeyboard'
import RecordingDialog from './RecordingDialog'
import './transcription.css'

const STORAGE = 'vanarana.transcriptions.v1'
const DRAFT_WARNING = 'Finish the bar text or discard the unfinished edit first. Your last valid chart is still saved.'
function initialData(): { charts: Chart[]; error: string } {
  try { const raw = localStorage.getItem(STORAGE); return { charts: raw ? parseCharts(raw) : [], error: '' } }
  catch { return { charts: [], error: 'Saved transcriptions could not be read. Export any new work before leaving this page.' } }
}
/** Melody coverage includes bars crossed by one sustained note. */
function melodyCoverage(bars: Bar[]): Set<string> {
  const changes = Array(bars.length + 1).fill(0) as number[]
  bars.forEach((bar, index) => bar.melody?.forEach(note => {
    changes[index]++
    changes[Math.min(bars.length, index + Math.ceil((note.offset + note.duration) / 4))]--
  }))
  let active = 0
  return new Set(bars.filter((_, index) => { active += changes[index]; return active > 0 }).map(bar => bar.id))
}
/** Retain a working trailing block; never remove the cell currently being edited. */
function trimTrailingBars(chart: Chart, protectedId: string | null): Chart {
  const melodyBars = melodyCoverage(chart.bars)
  let end = chart.bars.length
  let empty = 0
  for (let index = end - 1; index >= 0; index--) {
    const bar = chart.bars[index]
    if (bar.chords.length || melodyBars.has(bar.id) || bar.section || bar.time) break
    empty++
  }
  const protectedIndex = chart.bars.findIndex(bar => bar.id === protectedId)
  while (empty >= 16 && end - 8 > protectedIndex) { end -= 8; empty -= 8 }
  return end === chart.bars.length ? chart : { ...chart, bars: chart.bars.slice(0, end) }
}

type Take = { chart: Chart; charts: Chart[]; key: number; start: number; notes: RecordedMelodyNote[]; held: Map<string, { pitch: number; startBeat: number }>; lastBeat: number }

export default function Transcription({ active }: { active: boolean }) {
  const [initial] = useState(initialData)
  const [charts, setCharts] = useState(initial.charts)
  const [chartId, setChartId] = useState(initial.charts[0]?.id ?? '')
  const [selectedBar, setSelectedBar] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [draftError, setDraftError] = useState('')
  const [mode, setMode] = useState<'degrees' | 'letters'>('degrees')
  const [targetKey, setTargetKey] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [message, setMessage] = useState(initial.error)
  const [storageFailed, setStorageFailed] = useState(Boolean(initial.error))
  const [audioError, setAudioError] = useState('')
  const [takeFailed, setTakeFailed] = useState(false)
  const [recording, setRecording] = useState(false)
  const [undoTake, setUndoTake] = useState<Chart[] | null>(null)
  const take = useRef<Take | null>(null)
  const recordButton = useRef<HTMLButtonElement>(null)
  const restoreRecordFocus = useRef(false)
  const [emptyBarId, setEmptyBarId] = useState(makeId)
  const [playback, setPlayback] = useState<SequenceState>({ playing: false, barId: null, chordId: null, error: null })
  const sequencer = useRef<ChartSequencer | null>(null)
  const player = useRef<ChordPlayer | null>(null)
  const finishRecording = useCallback((finalBeat?: number) => {
    const current = take.current
    if (!current) return
    const beat = sequencer.current?.getRecordingBeat() ?? finalBeat ?? current.lastBeat
    current.lastBeat = beat
    take.current = null
    for (const [id, held] of current.held) {
      player.current?.stopMelodyNote(id)
      if (beat > held.startBeat) current.notes.push({ ...held, duration: beat - held.startBeat, velocity: 0.8 })
    }
    current.held.clear()
    sequencer.current?.stop()
    player.current?.stopMelody()
    restoreRecordFocus.current = true
    setRecording(false)
    setTakeFailed(false)
    if (beat <= 0) { setMessage('Count-in cancelled. Melody unchanged.'); return }
    try {
      let recorded = trimTrailingBars(replaceMelodyTake(current.chart, current.start, beat, current.notes), current.chart.bars[current.start]?.id ?? null)
      // Keep the usual empty workspace available after a take reaches the end.
      if (current.start + Math.ceil(beat / 4) >= recorded.bars.length && melodyCoverage(recorded.bars).has(recorded.bars.at(-1)!.id) && recorded.bars.length + 8 <= MAX_BARS_PER_CHART) {
        const expanded = { ...recorded, bars: [...recorded.bars, ...Array.from({ length: 8 }, () => ({ id: makeId(), chords: [] }))] }
        try { serializeCharts(current.charts.map(item => item.id === recorded.id ? expanded : item)); recorded = expanded } catch { /* Keep the take when an extra block cannot fit. */ }
      }
      const next = current.charts.map(item => item.id === recorded.id ? recorded : item)
      const serialized = serializeCharts(next)
      setCharts(next)
      setUndoTake(current.charts)
      // Save synchronously too: navigation/background/unload must retain the take.
      try { localStorage.setItem(STORAGE, serialized) } catch { setStorageFailed(true) }
      setMessage(`Melody replaced in ${Math.ceil(beat / 4)} bar${Math.ceil(beat / 4) === 1 ? '' : 's'}.`)
    } catch (error) {
      // Keep a recoverable take in memory rather than silently dropping it.
      take.current = current
      setRecording(true)
      setTakeFailed(true)
      setAudioError(error instanceof Error ? error.message : 'The take could not be saved. Stop to try again.')
    }
  }, [])
  const receivePlayback = useCallback((state: SequenceState) => {
    setPlayback(state)
    if (take.current) {
      if (state.elapsedBeats !== undefined) take.current.lastBeat = Math.max(0, state.elapsedBeats)
      if (!state.playing) finishRecording(state.elapsedBeats)
    }
  }, [finishRecording])
  const fileInput = useRef<HTMLInputElement>(null)
  const barButtons = useRef(new Map<string, HTMLButtonElement>())
  const returnFocus = useRef<string | null>(null)
  // A stable ref runs only when the inline field mounts, never on text updates.
  const focusEditor = useCallback((element: HTMLTextAreaElement | null) => {
    if (element) { element.focus({ preventScroll: true }); element.select() }
  }, [])
  const chart = charts.find(item => item.id === chartId)
  const storedBars = chart?.bars.length ? chart.bars : [{ id: emptyBarId, chords: [] }]
  const recordingBarCount = recording ? Math.min(MAX_BARS_PER_CHART, Math.max(storedBars.length, (playback.barIndex ?? 0) + 1)) : storedBars.length
  const visibleBars: Bar[] = [...storedBars, ...Array.from({ length: recordingBarCount - storedBars.length }, (_, offset) => ({ id: `recording-bar-${storedBars.length + offset}`, chords: [] }))]
  const bar = chart ? visibleBars.find(item => item.id === selectedBar) : undefined
  const melodyBars = melodyCoverage(chart?.bars ?? [])
  const key = mode === 'letters' ? targetKey ?? chart?.sourceKey ?? 0 : chart?.sourceKey ?? 0

  useEffect(() => {
    if (storageFailed) return
    try { localStorage.setItem(STORAGE, serializeCharts(charts)) }
    catch {
      const warning = setTimeout(() => { setStorageFailed(true); setMessage('Browser storage is unavailable or full. Export a backup to keep your work.') }, 0)
      return () => clearTimeout(warning)
    }
  }, [charts, storageFailed])
  useEffect(() => { if (!active) { finishRecording(); sequencer.current?.stop(); player.current?.stop() } }, [active, finishRecording])
  useEffect(() => {
    const stop = () => { if (document.hidden) { finishRecording(); sequencer.current?.stop(); player.current?.stop() } }
    const leave = () => finishRecording()
    window.addEventListener('pagehide', leave)
    document.addEventListener('visibilitychange', stop)
    return () => { finishRecording(); window.removeEventListener('pagehide', leave); document.removeEventListener('visibilitychange', stop); sequencer.current?.dispose(); sequencer.current = null; player.current?.dispose(); player.current = null }
  }, [finishRecording])

  useEffect(() => {
    if (!draftError && !recording) return
    const warn = (event: BeforeUnloadEvent) => {
      finishRecording()
      if (draftError || take.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [draftError, recording, finishRecording])

  useEffect(() => {
    if (selectedBar === null && returnFocus.current) {
      const target = barButtons.current.get(returnFocus.current) ?? [...barButtons.current.values()].at(-1)
      target?.focus({ preventScroll: true })
      returnFocus.current = null
    }
  }, [selectedBar])

  useEffect(() => {
    if (!recording && restoreRecordFocus.current) {
      restoreRecordFocus.current = false
      if (active) recordButton.current?.focus({ preventScroll: true })
    }
  }, [recording, active])

  const stopPlayback = () => { finishRecording(); sequencer.current?.stop(); player.current?.stop(); player.current?.stopMelody() }
  const playChart = () => {
    if (!chart || draftError) return
    player.current ??= new ChordPlayer()
    sequencer.current ??= new ChartSequencer(player.current, receivePlayback)
    setAudioError('')
    void sequencer.current.play(chart, key, selectedBar ?? undefined)
  }

  const startRecording = () => {
    if (!chart || !bar || draftError || recording) return
    player.current ??= new ChordPlayer()
    sequencer.current ??= new ChartSequencer(player.current, receivePlayback)
    const source = chart.bars.length ? chart : { ...chart, bars: [bar] }
    take.current = { chart: source, charts, key, start: source.bars.findIndex(item => item.id === bar.id), notes: [], held: new Map(), lastBeat: 0 }
    setRecording(true); setTakeFailed(false); setAudioError(''); setMessage('')
    void sequencer.current.play(source, key, bar.id, { countIn: true, muteMelody: true, extendForRecording: true, recordingRate: chart.recordingRate ?? 1 })
  }
  const melodyOn = (id: string, pitch: number) => {
    player.current ??= new ChordPlayer()
    const current = take.current
    const beat = sequencer.current?.getRecordingBeat() ?? null
    if (current && !current.held.has(id)) {
      // Count-in attacks are monitored now and owned by beat zero only if
      // still held when the recording starts. No new attack at that boundary.
      current.lastBeat = beat ?? 0
      current.held.set(id, { pitch: sourceMelodyPitch(pitch, current.chart.sourceKey, current.key), startBeat: beat ?? 0 })
    }
    void player.current.startMelodyNote(id, pitch).catch(error => setAudioError(error instanceof Error ? error.message : 'Melody audio could not play.'))
  }
  const melodyOff = (id: string) => {
    player.current?.stopMelodyNote(id)
    const current = take.current
    const held = current?.held.get(id)
    if (!current || !held) return
    const beat = sequencer.current?.getRecordingBeat() ?? current.lastBeat
    current.lastBeat = beat
    if (beat > held.startBeat) current.notes.push({ ...held, duration: beat - held.startBeat, velocity: 0.8 })
    current.held.delete(id)
  }

  const commitCharts = (next: Chart[]) => {
    try { serializeCharts(next); stopPlayback(); setUndoTake(null); setCharts(next); return true }
    catch (error) { setMessage(error instanceof Error ? error.message : 'This change exceeds the chart limits.'); return false }
  }
  const update = (fn: (current: Chart) => Chart) => commitCharts(charts.map(item => item.id === chartId ? fn(item) : item))
  const updateBar = (fn: (current: Bar) => Bar) => {
    const edited = charts.map(current => {
      if (current.id !== chartId) return current
      if (!current.bars.length && selectedBar === emptyBarId) {
        const first = fn({ id: emptyBarId, chords: [] })
        return first.chords.length ? { ...current, bars: [first] } : current
      }
      return trimTrailingBars({ ...current, bars: current.bars.map(item => item.id === selectedBar ? fn(item) : item) }, selectedBar)
    })
    const current = edited.find(item => item.id === chartId)
    const last = current?.bars.at(-1)
    if (current && last?.id === selectedBar && last.chords.length > 0) {
      if (current.bars.length + 8 <= MAX_BARS_PER_CHART) {
        const expanded = edited.map(item => item.id === chartId
          ? { ...item, bars: [...item.bars, ...Array.from({ length: 8 }, () => ({ id: makeId(), chords: [] }))] }
          : item)
        try {
          // Check the whole backup too, so auto-growth never rejects an otherwise valid edit.
          serializeCharts(expanded)
          return commitCharts(expanded)
        } catch { /* Save the entered chord even if eight more bars cannot fit. */ }
      }
      const saved = commitCharts(edited)
      if (saved) setMessage('Bar saved. Eight more bars would exceed the chart or backup size limit.')
      return saved
    }
    return commitCharts(edited)
  }
  const clearDraftWarning = () => setMessage(previous => previous === DRAFT_WARNING ? '' : previous)
  const clearDraft = () => { setDraft(null); setDraftError(''); clearDraftWarning() }
  const canLeaveDraft = () => {
    if (!draftError) return true
    setMessage(DRAFT_WARNING)
    return false
  }
  const chooseBar = (id: string | null) => {
    if (!canLeaveDraft()) return
    if (selectedBar && chart) {
      const trimmed = trimTrailingBars(chart, id)
      if (trimmed !== chart) commitCharts(charts.map(item => item.id === chartId ? trimmed : item))
    }
    if (id === null) returnFocus.current = selectedBar
    setSelectedBar(id); clearDraft()
  }
  const chooseChart = (id: string) => {
    if (!canLeaveDraft()) return
    finishRecording(); setUndoTake(null); setEmptyBarId(makeId()); setChartId(id); setSelectedBar(null); clearDraft(); setTargetKey(null); stopPlayback()
  }
  const editBarText = (text: string) => {
    setDraft(text)
    try {
      const entries = parseBarText(text)
      if (!updateBar(current => ({ ...current, chords: entries }))) throw new Error('This edit exceeds the chart limits. Shorten it before saving.')
      setDraftError(''); clearDraftWarning()
    } catch (error) { setDraftError(error instanceof Error ? error.message : 'Check the chord text.') }
  }
  const audition = (value: Chord) => {
    if (playback.playing || recording) return
    player.current ??= new ChordPlayer()
    setAudioError('')
    void player.current.play(chordMidi(value, key)).catch(error => setAudioError(error instanceof Error ? error.message : 'Audio could not play. Try again.'))
  }
  const addChord = (root: number, quality: Quality) => {
    if (playback.playing || recording) return
    const value: Chord = { id: makeId(), root, quality }
    audition(value)
    if (bar && canLeaveDraft() && updateBar(current => ({ ...current, chords: [...current.chords, value] }))) clearDraft()
  }
  const exportFile = () => {
    if (!canLeaveDraft()) return
    const url = URL.createObjectURL(new Blob([serializeCharts(charts)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'vanarana-transcriptions.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const importFile = async (file?: File) => {
    if (!file) return
    if (!canLeaveDraft()) { if (fileInput.current) fileInput.current.value = ''; return }
    try {
      if (file.size > 2_000_000) throw new Error('Choose a JSON backup smaller than 2 MB.')
      const imported = parseCharts(await file.text()).map(item => ({ ...item, id: makeId(), bars: item.bars.map(b => ({ ...b, id: makeId(), chords: b.chords.map(c => ({ ...c, id: makeId() })), ...(b.melody ? { melody: b.melody.map(note => ({ ...note, id: makeId() })) } : {}) })) }))
      if (!commitCharts([...charts, ...imported])) return; if (imported[0]) chooseChart(imported[0].id)
      setMessage(`Imported ${imported.length} transcription${imported.length === 1 ? '' : 's'}. Existing work was kept.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'That backup could not be imported.') }
    if (fileInput.current) fileInput.current.value = ''
  }
  const renderEntries = (item: Bar, hidden = false) => <span className="tx-bar-entries" aria-hidden={hidden || undefined}>{item.chords.length
    ? item.chords.flatMap((value, index) => [<span className={playback.chordId === value.id ? 'is-sounding' : ''} key={value.id}>{chordLabel(value, mode, key)}</span>, index < item.chords.length - 1 ? ' ' : ''])
    : <span className="tx-blank" aria-hidden="true">—</span>}</span>
  return <main className="transcription content">
    <header className="page-heading"><div><p className="eyebrow">Listen · Find · Write</p><h1>Transcription</h1><p className="lede">Build a chord chart, one bar at a time.</p></div></header>
    <fieldset className="tx-library tx-lockable" disabled={recording}>
      <label>Transcriptions<select aria-label="Transcriptions" value={chartId} onChange={event => chooseChart(event.target.value)}><option value="" disabled>Choose a transcription</option>{charts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <form className="tx-create" onSubmit={event => { event.preventDefault(); if (!name.trim() || !canLeaveDraft()) return; const next = createChart(name.trim()); if (commitCharts([...charts, next])) { chooseChart(next.id); setName('') } }}>
        <label>New transcription<input aria-label="New transcription name" value={name} maxLength={120} onChange={event => setName(event.target.value)} placeholder="Song title" required /></label><button className="tx-primary" type="submit">Create</button>
      </form>
      <div className="tx-backups"><button disabled={!charts.length} onClick={exportFile}>Export</button><button onClick={() => fileInput.current?.click()}>Import</button><input ref={fileInput} type="file" accept=".json,application/json" aria-label="Import transcription backup" hidden onChange={event => void importFile(event.target.files?.[0])} /></div>
    </fieldset>
    {message && <p className="tx-notice" role="status">{message}<button aria-label="Dismiss notice" onClick={() => setMessage('')}>×</button></p>}
    {chart ? <>
      <section className="tx-chart" aria-label="Chord chart">
        <fieldset disabled={recording} className={`tx-settings tx-lockable ${mode === 'letters' ? 'with-target' : ''}`}>
        <div className="tx-chart-heading"><label className="tx-title">Title<input aria-label="Transcription title" value={chart.name} maxLength={120} onChange={event => update(current => ({ ...current, name: event.target.value.trim() ? event.target.value : 'Untitled' }))} onBlur={() => { if (!chart.name.trim()) update(current => ({ ...current, name: 'Untitled' })) }} /></label>
          <label>Major-key reference<select aria-label="Major-key reference" value={chart.sourceKey} onChange={event => { update(current => { const sourceKey = Number(event.target.value); return { ...current, sourceKey, bars: current.bars.map(item => ({ ...item, ...(item.melody ? { melody: item.melody.map(note => ({ ...note, pitch: note.pitch + sourceKey - current.sourceKey })) } : {}) })) } }); stopPlayback() }}>{KEYS.map((label, index) => <option value={index} key={label}>1={label}</option>)}</select></label>
          <label>Notation<select aria-label="Notation" value={mode} onChange={event => { setMode(event.target.value as typeof mode); stopPlayback() }}><option value="degrees">Scale degrees</option><option value="letters">Letter chords</option></select></label>
          {mode === 'letters' && <label className="tx-target-key">Render & play in<select aria-label="Render and play in" value={key} onChange={event => { setTargetKey(Number(event.target.value)); stopPlayback() }}>{KEYS.map((label, index) => <option value={index} key={label}>{label} major</option>)}</select></label>}
        </div>
        <div className="tx-transport" aria-label="Chart playback">
          <button className="tx-primary tx-play" disabled={!chart.bars.length || Boolean(draftError)} onClick={playback.playing ? stopPlayback : playChart}>{playback.playing ? 'Stop playback' : selectedBar ? `Play from bar ${visibleBars.findIndex(item => item.id === selectedBar) + 1}` : 'Play chart'}</button>
          <label className="tx-tempo">Tempo (BPM)<input aria-label="Tempo (BPM)" type="number" min={MIN_BPM} max={MAX_BPM} step="1" defaultValue={chart.bpm ?? DEFAULT_BPM} key={`${chart.id}:${chart.bpm}`} onBlur={event => {
            const value = Number(event.target.value)
            const bpm = Number.isFinite(value) ? Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(value))) : DEFAULT_BPM
            event.target.value = String(bpm)
            if (bpm !== (chart.bpm ?? DEFAULT_BPM)) update(current => ({ ...current, bpm }))
          }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
          <label className="tx-metronome">Metronome<span><input aria-label="Metronome" type="checkbox" checked={chart.metronome !== false} onChange={event => update(current => ({ ...current, metronome: event.target.checked }))} />{chart.metronome !== false ? 'On' : 'Off'}</span></label>
          {playback.playing && <span className="tx-play-status" aria-live="polite">{playback.countInBeatsRemaining ? `Count in: ${playback.countInBeatsRemaining}` : `Playing bar ${(playback.barIndex ?? chart.bars.findIndex(item => item.id === playback.barId)) + 1}`}</span>}
        </div>
        </fieldset>
        {playback.error && <p className="tx-notice" role="alert">{playback.error}</p>}
        <div className="tx-bars">{visibleBars.map((item, index) => item.id === selectedBar && !playback.playing && !recording
          ? <div className={`tx-bar is-selected ${melodyBars.has(item.id) ? 'has-melody' : ''}`} key={item.id} aria-label={`Bar ${index + 1} editor`}>
              {renderEntries(item, true)}
              <textarea ref={focusEditor} aria-label="Bar chord text" aria-describedby={`tx-inline-help${draftError ? ' tx-text-error' : ''}`} aria-invalid={Boolean(draftError)}
                value={draft ?? barText(item)} onInput={event => editBarText(event.currentTarget.value)} rows={1} maxLength={4096} spellCheck={false} autoCapitalize="off" autoCorrect="off"
                placeholder="1 . 5/7 6m" onKeyDown={event => {
                  if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Escape') { event.preventDefault(); chooseBar(null) }
                }} />
            </div>
          : <button className={`tx-bar ${melodyBars.has(item.id) ? 'has-melody' : ''} ${item.id === selectedBar ? 'is-selected' : ''} ${item.id === playback.barId ? 'is-playing' : ''}`} key={item.id}
              ref={element => { if (element) barButtons.current.set(item.id, element); else barButtons.current.delete(item.id) }}
              disabled={playback.playing || recording} aria-label={`Select bar ${index + 1}`} aria-pressed={item.id === selectedBar} onClick={() => chooseBar(item.id)}>
              {renderEntries(item)}
            </button>)}</div>
        <p id="tx-inline-help" className="tx-sr-only">Edit in scale degrees: 1 . 5/7 6m. A dot holds the previous chord. Enter to finish.</p>
        {draftError && <p id="tx-text-error" className="tx-text-error" role="alert">{draftError} Last valid bar saved.<button onClick={clearDraft}>Discard unfinished edit</button></p>}
        <div className="tx-chart-actions">
          <button disabled={!bar || playback.playing || recording} onClick={() => chooseBar(null)}>Done editing</button>
          <span>{storageFailed ? 'Not saved · export a backup' : 'Saved in this browser'}</span>
        </div>
        <div className="tx-melody-controls">
          <label className="tx-recording-rate">Recording speed<select aria-label="Recording speed" disabled={recording || playback.playing} value={chart.recordingRate ?? 1} onChange={event => update(current => ({ ...current, recordingRate: Number(event.target.value) as 1 | 0.5 }))}><option value={1}>1×</option><option value={0.5}>½×</option></select></label>
          <button ref={recordButton} className="tx-primary" disabled={!bar || Boolean(draftError) || playback.playing || recording} onClick={startRecording}>Record melody</button>
          {undoTake && <button disabled={playback.playing || recording} onClick={() => { stopPlayback(); setCharts(undoTake); setUndoTake(null); setMessage('Previous melody restored.') }}>Undo take</button>}
          <span aria-live="polite">{recording ? playback.countInBeatsRemaining ? `Count in: ${playback.countInBeatsRemaining}` : 'Recording · stop replaces covered bars' : 'Select a bar · one-bar count-in'}</span>
        </div>
        {takeFailed && <div className="tx-notice" role="alert">The take is still in memory. Download it before leaving, or discard it to keep the old melody.
          <button onClick={() => {
            const pending = take.current
            if (!pending) return
            const url = URL.createObjectURL(new Blob([JSON.stringify({ chart: pending.chart, startBar: pending.start, elapsedBeats: pending.lastBeat, notes: pending.notes }, null, 2)], { type: 'application/json' }))
            const link = document.createElement('a'); link.href = url; link.download = 'vanarana-melody-take.json'; link.click()
            setTimeout(() => URL.revokeObjectURL(url), 1000)
          }}>Download take</button>
          <button onClick={() => { take.current = null; setRecording(false); setTakeFailed(false); setAudioError(''); setMessage('Take discarded. Previous melody kept.') }}>Discard take</button>
        </div>}
        {recording && !takeFailed && <RecordingDialog onStop={() => finishRecording()} status={playback.audioReady !== true ? 'Preparing audio…' : playback.countInBeatsRemaining ? `Count in: ${playback.countInBeatsRemaining}` : 'Recording'}>
          <MelodyKeyboard disabled={playback.audioReady !== true} onNoteOn={melodyOn} onNoteOff={melodyOff} />
        </RecordingDialog>}
      </section>
    </> : <div className="tx-welcome"><h2>Start with a song title</h2><p>Create a transcription above, or audition chords below.</p></div>}
    <section className="tx-audition" aria-label="Chord audition grid"><div className="tx-grid-heading"><div><h2>Find a chord</h2><p>{playback.playing ? 'Chart playback is running. Stop to audition or edit chords.' : bar ? `Editing bar ${visibleBars.indexOf(bar) + 1}: each chord you play is also added.` : 'Audition only. Select a bar to add chords as you play.'}</p></div><button onClick={stopPlayback}>Stop sound</button></div>
      {audioError && <p role="alert" className="tx-notice">{audioError}</p>}
      <div className="tx-grid-scroll"><table className="tx-grid"><thead><tr><th scope="col">Root</th>{QUALITIES.map(q => <th scope="col" key={q.id}>{q.label}</th>)}</tr></thead><tbody>{KEYS.map((_, root) => <tr key={root}><th scope="row">{mode === 'degrees' ? degreeName(root) : noteName(root, key)}</th>{QUALITIES.map(q => { const value = { id: '', root, quality: q.id }; return <td key={q.id}><button disabled={playback.playing || recording} aria-label={`${bar ? 'Play and add' : 'Play'} ${chordLabel(value, mode, key)}`} onClick={() => addChord(root, q.id)}>{chordLabel(value, mode, key)}</button></td> })}</tr>)}</tbody></table></div>
      <p className="tx-footnote">Grid chords use root position. Audio follows {KEYS[key]} major. Play your reference track separately.</p>
    </section>
  </main>
}
