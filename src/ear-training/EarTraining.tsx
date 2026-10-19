import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { studies, type Answer, type Study } from './studies'
import { initialShuffledRound, roundReducer, shuffledStudies } from './round'
import { QuizPlayer, type PlayerState } from './player'
import { sequences } from './sequences'
import { samples } from './samples'
import './ear-training.css'

const names = { minor: 'Minor tonic', picardy: 'Picardy third' }
const time = (seconds: number) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '0:00'

export default function EarTraining({ active }: { active: boolean }) {
  const [round, dispatch] = useReducer(roundReducer, studies, initialShuffledRound)
  const [shuffle, setShuffle] = useState(true)
  const [autoplayNext, setAutoplayNext] = useState(false)
  const pendingAudio = useRef<{ key: string; player: QuizPlayer } | null>(null)
  const audio = useRef<QuizPlayer | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const [snapshot, setPlayback] = useState<PlayerState & { sessionKey: string }>({ sessionKey: '', playing: false, loading: false, error: null, position: 0, duration: 0 })
  const question = round.order[round.index]
  const sessionKey = `${round.session}:${question.id}`
  const playback = snapshot.sessionKey === sessionKey ? snapshot : { playing: false, loading: false, error: null, position: 0, duration: sequences[question.id].durationSeconds }
  const { playing, loading, position, duration, error: audioError } = playback
  const response = round.responses[round.index]
  const score = round.responses.filter(item => item.correct).length

  const toggle = () => {
    const player = audio.current
    if (!player) return
    if (player.state.playing || player.state.loading) player.pause()
    else void player.play()
  }
  const prepareNext = useCallback(() => {
    if (!autoplayNext || !active || round.index >= round.order.length - 1) return
    const nextQuestion = round.order[round.index + 1]
    const key = `${round.session}:${nextQuestion.id}`
    pendingAudio.current?.player.dispose()
    const player = new QuizPlayer(sequences[nextQuestion.id], samples, state => setPlayback({ ...state, sessionKey: key }))
    pendingAudio.current = { key, player }
    // Start/resume synchronously inside this answer/Next gesture, before React changes the question.
    void player.play()
  }, [active, autoplayNext, round.index, round.order, round.session])
  const answer = useCallback((choice: Answer) => {
    if (!active || round.finished || round.responses[round.index]) return
    const currentQuestion = round.order[round.index]
    const correct = choice === currentQuestion.type
    if (correct) prepareNext()
    dispatch({ type: 'answer', choice, questionId: currentQuestion.id })
    if (correct) dispatch({ type: 'next', questionId: currentQuestion.id })
  }, [active, round, prepareNext])
  const next = useCallback(() => {
    if (!active || round.finished || !round.responses[round.index]) return
    prepareNext()
    dispatch({ type: 'next', questionId: round.order[round.index].id })
  }, [active, round, prepareNext])
  const start = (items: Study[] = studies, random = true, review = false) => {
    const order = random ? shuffledStudies(items) : [...items]
    dispatch({ type: 'start', order, review })
  }
  useEffect(() => {
    if (round.finished) return
    const prepared = pendingAudio.current
    pendingAudio.current = null
    if (prepared && prepared.key !== sessionKey) prepared.player.dispose()
    const player = prepared?.key === sessionKey ? prepared.player : new QuizPlayer(sequences[question.id], samples, state => setPlayback({ ...state, sessionKey }))
    audio.current = player
    return () => { player.dispose(); if (audio.current === player) audio.current = null }
  }, [question.id, sessionKey, round.finished])
  useEffect(() => {
    if (!active) { audio.current?.pause(); pendingAudio.current?.player.pause() }
  }, [active])
  useEffect(() => () => { pendingAudio.current?.player.dispose() }, [])
  useEffect(() => {
    if (active) heading.current?.focus({ preventScroll: true })
  }, [active, round.index, round.finished, round.order])
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.code === 'Space') {
        if (['BUTTON', 'SUMMARY', 'A'].includes(target.tagName)) return
        event.preventDefault()
        const player = audio.current
        if (player?.state.playing || player?.state.loading) player.pause()
        else if (player) void player.play()
      } else if (event.key === '1' || event.key === '2') answer(event.key === '1' ? 'minor' : 'picardy')
      else if (event.key === 'ArrowRight') next()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, answer, next])

  return <main className="ear-training">
    <header className="ear-heading"><div><h1>Picardy Thirds</h1></div>
      <button className="ear-text-button" onClick={() => {
        if (round.responses.length && !round.finished && !window.confirm('Start over? Your current round’s answers will be cleared.')) return
        start()
      }}>Start over</button>
    </header>
    <section aria-label="Listening quiz">
      {round.review && <p className="ear-round-label">Missed-question practice</p>}
      <div className="ear-progress" role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={round.order.length} aria-valuenow={round.responses.length}><div style={{ width: `${round.responses.length / round.order.length * 100}%` }} /></div>
      {round.finished ? <>
        <h2 ref={heading} tabIndex={-1}>{score === round.order.length ? 'Perfect round.' : 'Round complete.'}</h2>
        <div className="ear-score">{score}<small> / {round.order.length}</small></div>
        <details><summary>Review answers</summary><ul className="ear-results">{round.responses.map((item, index) => <li key={item.question.id}><span>{index + 1} · {item.question.key} · {names[item.question.type]}</span><span>{item.correct ? '✓ Correct' : '↗ Missed'}</span></li>)}</ul></details>
        {score < round.order.length && <button className="ear-primary" onClick={() => start(round.responses.filter(item => !item.correct).map(item => item.question), false, true)}>Practice missed questions</button>}
        <label className="ear-shuffle"><input type="checkbox" checked={shuffle} onChange={event => setShuffle(event.target.checked)} />Shuffle</label>
        <button className="ear-primary ear-secondary" onClick={() => start(studies, shuffle)}>Start a new round ↻</button>
      </> : <>
        <div className="ear-meta"><span>Question {String(round.index + 1).padStart(2, '0')} / {String(round.order.length).padStart(2, '0')}</span><span>{question.instrument}</span></div>
        <h2 ref={heading} tabIndex={-1}>How does it resolve?</h2>
        <div className="ear-player" data-study-id={question.id} aria-busy={loading}><div className="ear-player-row"><button className="ear-play" aria-label={loading ? 'Cancel loading' : playing ? 'Pause example' : 'Play example'} onClick={toggle}>{loading ? 'Cancel' : playing ? 'Ⅱ Pause' : '▶ Play'}</button><span>{loading ? 'Loading…' : `${time(position)} / ${time(duration)}`}</span></div>
          <input type="range" min="0" max="100" step="0.1" value={duration > 0 ? position / duration * 100 : 0} disabled={loading || duration <= 0} aria-label="Audio position" onChange={event => audio.current?.seek(duration * Number(event.target.value) / 100)} />
          <button className="ear-text-button" onClick={() => { void audio.current?.replay() }}>↺ Replay</button>
        </div>
        <label className="ear-autoplay"><input type="checkbox" checked={autoplayNext} onChange={event => setAutoplayNext(event.target.checked)} />Autoplay next</label>
        {audioError && <p className="ear-error" role="alert">{audioError}</p>}
        <div className="ear-answers">{(['minor', 'picardy'] as Answer[]).map(choice => <button key={choice} disabled={!!response} className={`ear-answer${response && choice === question.type ? ' correct' : response?.choice === choice ? ' wrong' : ''}`} onClick={() => answer(choice)}><strong>{names[choice]}</strong></button>)}</div>
        <div aria-live="polite" aria-atomic="true">{response && <div className={`ear-feedback${response.correct ? '' : ' missed'}`}>
          {response.correct ? <><h3>✓ Correct</h3></> : <><h3>{names[question.type]}</h3><p>{question.explanation}</p><details><summary>Musical details</summary><p><strong>{question.key}</strong> · Final third: <strong>{question.third}</strong></p><p>{question.progression}</p></details><button className="ear-primary" onClick={next}>{round.index === round.order.length - 1 ? 'See results' : 'Next question'} →</button></>}
        </div>}</div>
      </>}
    </section>

  </main>
}
