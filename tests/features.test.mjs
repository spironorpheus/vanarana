import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { installAudioMock } from './audio-mock.mjs'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import FeatureApp from '../src/FeatureApp.tsx'
import { initialRound, initialShuffledRound, roundReducer, shuffledStudies } from '../src/ear-training/round.ts'
import { studies } from '../src/ear-training/studies.ts'
import { sequences } from '../src/ear-training/sequences.ts'
import { samples } from '../src/ear-training/samples.ts'

test('round reducer guards repeated answers, navigation, completion, review and restart', () => {
  let round = initialRound(studies)
  assert.equal(roundReducer(round, { type: 'next' }), round)
  for (const question of studies) {
    round = roundReducer(round, { type: 'answer', choice: question.type })
    assert.equal(roundReducer(round, { type: 'answer', choice: 'minor' }), round)
    round = roundReducer(round, { type: 'next' })
  }
  assert.equal(round.finished, true)
  assert.equal(round.responses.filter(item => item.correct).length, 8)
  assert.equal(roundReducer(round, { type: 'next' }), round)
  round = roundReducer(round, { type: 'start', order: [studies[1]], review: true })
  assert.equal(round.review, true)
  assert.equal(round.responses.length, 0)
  assert.equal(roundReducer(round, { type: 'start', order: [], review: false }), round)
})


test('stale answer and Next events cannot affect the following question', () => {
  let round = initialRound(studies)
  round = roundReducer(round, { type: 'answer', choice: studies[0].type, questionId: studies[0].id })
  round = roundReducer(round, { type: 'next', questionId: studies[0].id })
  assert.equal(roundReducer(round, { type: 'answer', choice: 'minor', questionId: studies[0].id }), round)
  round = roundReducer(round, { type: 'answer', choice: 'minor', questionId: studies[1].id })
  assert.equal(roundReducer(round, { type: 'next', questionId: studies[0].id }), round)
})

test('default rounds shuffle all studies without mutating their mapping', () => {
  const originalIds = studies.map(question => question.id)
  const shuffled = shuffledStudies(studies, () => 0)
  assert.notDeepEqual(shuffled.map(question => question.id), originalIds)
  assert.deepEqual([...shuffled].sort((a, b) => a.id - b.id), studies)
  assert.deepEqual(studies.map(question => question.id), originalIds)
  const originalRandom = Math.random
  try {
    Math.random = () => 0
    assert.deepEqual(initialShuffledRound(studies).order, shuffled)
  } finally { Math.random = originalRandom }
})

test('feature navigation and quiz DOM interactions preserve the chords feature', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.example/#ear-training', pretendToBeVisual: true })
  const { window } = dom
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLMediaElement']) Object.defineProperty(globalThis, name, { configurable: true, value: window[name] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let midiRequests = 0
  window.navigator.requestMIDIAccess = async () => { midiRequests++; return { inputs: new Map(), addEventListener() {}, removeEventListener() {} } }
  Object.defineProperty(window, 'isSecureContext', { value: true })
  window.confirm = () => true
  let rejectResume = false
  const audioMock = installAudioMock(window, { resume(context) {
    if (rejectResume) return Promise.reject(new Error('Audio unavailable. Try Play again.'))
    context.state = 'running'
    return Promise.resolve()
  } })
  const originalRandom = Math.random
  Math.random = () => 0
  const root = createRoot(document.getElementById('root'))
  const quiz = () => document.querySelector('.ear-training')
  const click = async element => { assert.ok(element); await act(async () => element.click()) }
  const currentQuestion = () => studies.find(question => question.id === Number(document.querySelector('.ear-player')?.dataset.studyId))
  const answerText = type => type === 'minor' ? 'Minor tonic' : 'Picardy third'
  const button = text => [...quiz().querySelectorAll('button')].find(element => element.textContent.includes(text))
  const navigate = async hash => { await act(async () => { window.location.hash = hash; window.dispatchEvent(new window.HashChangeEvent('hashchange')); await new Promise(resolve => setTimeout(resolve, 0)) }) }
  const wait = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 1050)) })
  try {
    await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(FeatureApp))))
    assert.equal(midiRequests, 0, 'quiz deep-link does not mount MIDI feature')
    assert.equal(quiz().querySelector('section').textContent.includes('A minor'), false, 'answers hidden')
    assert.equal(currentQuestion().id, 2)
    assert.equal(audioMock.contexts.length, 0, 'no audio context before user gesture')
    await click(button('Play'))
    const firstSources = [...audioMock.sources]
    assert.ok(firstSources.length > 0)
    assert.equal(button('Pause')?.getAttribute('aria-label'), 'Pause example')
    const firstAnswer = answerText(currentQuestion().type)
    await click(button(firstAnswer))
    assert.ok(quiz().querySelector('.ear-meta').textContent.includes('02 / 08'), 'correct answer advances immediately')
    assert.ok(button('Play'), 'autoplay is off by default')
    await navigate('#quizzes')
    assert.ok(document.querySelector('.quiz-hub'))
    assert.equal(document.querySelector('.feature-nav a[aria-current]').textContent, 'Quizzes')
    assert.equal(document.querySelector('.quiz-card').getAttribute('href'), '#quizzes/ear-training/picardy-thirds')
    assert.equal(document.querySelectorAll('.quiz-card').length, 1, 'only implemented quizzes listed')
    assert.ok(firstSources.every(source => source.stopped), 'quiz hub stops all scheduled voices')
    await navigate('#chords')
    assert.ok(firstSources.every(source => source.stopped), 'navigation stops all scheduled voices')
    await wait()
    assert.ok(quiz().querySelector('.ear-meta').textContent.includes('02 / 08'), 'inactive quiz does not advance')
    assert.equal(midiRequests, 1)
    const filter = [...document.querySelectorAll('.filter-options button')].find(element => element.textContent === 'Major')
    await click(filter)
    const content = document.querySelector('.content')
    await navigate('#quizzes/ear-training/picardy-thirds')
    assert.equal(document.querySelector('.quiz-breadcrumb a').getAttribute('href'), '#quizzes')
    await wait()
    assert.ok(quiz().querySelector('.ear-meta').textContent.includes('02 / 08'))
    await navigate('#chords')
    assert.equal(document.querySelector('.content'), content, 'existing chord DOM preserved')
    assert.ok(filter.classList.contains('active'), 'chord filters preserved')
    await navigate('#ear-training')
    const secondQuestion = currentQuestion()
    await click(button(answerText(secondQuestion.type === 'minor' ? 'picardy' : 'minor')))
    assert.ok(quiz().textContent.includes(secondQuestion.explanation))
    await wait()
    assert.ok(quiz().querySelector('.ear-meta').textContent.includes('02 / 08'), 'wrong answer waits')
    await click(button('Next question'))
    await click(button('Start over'))
    for (let index = 0; index < studies.length; index++) {
      const question = currentQuestion()
      await click(button(question.type === 'minor' ? 'Picardy third' : 'Minor tonic'))
      await click(button(index === studies.length - 1 ? 'See results' : 'Next question'))
    }
    assert.ok(quiz().querySelector('.ear-score').textContent.includes('0 / 8'))
    await click(button('Practice missed questions'))
    assert.ok(quiz().textContent.includes('Missed-question practice'))
    await click(button('Start over'))
    for (let index = 0; index < studies.length; index++) {
      const question = currentQuestion()
      await click(button('Play'))
      const scheduled = [...audioMock.sources]
      await click(button(question.type === 'minor' ? 'Minor tonic' : 'Picardy third'))
      assert.ok(scheduled.every(source => source.stopped), 'auto-advance stops all voices before next question/results')
    }
    assert.ok(quiz().textContent.includes('Perfect round.'))
    assert.ok(quiz().querySelector('.ear-score').textContent.includes('8 / 8'))
    await click(button('Start a new round'))
    assert.equal(quiz().querySelector('.ear-feedback'), null)
    await click(button('Start over'))
    await act(async () => quiz().querySelector('h2').dispatchEvent(new window.KeyboardEvent('keydown', { key: currentQuestion().type === 'minor' ? '1' : '2', bubbles: true })))
    await act(async () => quiz().querySelector('h2').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    assert.ok(quiz().querySelector('.ear-meta').textContent.includes('02 / 08'))
    await click(button('Start over'))
    await wait()
    assert.ok(quiz().querySelector('.ear-meta').textContent.includes('01 / 08'), 'restart cancels old timer')
    rejectResume = true
    await click(button('Play'))
    assert.ok(quiz().querySelector('[role="alert"]'))
    rejectResume = false
    await click(button('Play'))
    assert.equal(quiz().querySelector('[role="alert"]'), null)
    await navigate('#quizzes')
    await navigate('#ear-training')
    const autoplay = () => quiz().querySelector('.ear-autoplay input')
    assert.equal(autoplay().checked, false, 'autoplay defaults off')
    const contextsBeforeOptIn = audioMock.contexts.length
    await click(autoplay())
    assert.equal(audioMock.contexts.length, contextsBeforeOptIn, 'opting in does not start playback')
    const previousVoices = [...audioMock.sources]
    rejectResume = true
    await click(button(answerText(currentQuestion().type)))
    assert.ok(quiz().querySelector('.ear-meta').textContent.includes('02 / 08'))
    assert.ok(quiz().querySelector('[role="alert"]'), 'rejected autoplay is visible and recoverable')
    assert.ok(audioMock.contexts.length > contextsBeforeOptIn, 'correct-answer gesture attempts to unlock next audio')
    rejectResume = false
    await click(button('Play'))
    assert.ok(button('Pause'), 'next audio can be retried after rejected autoplay')
    assert.ok(previousVoices.every(source => source.stopped), 'old question cannot overlap next')
    await click(button(answerText(currentQuestion().type === 'minor' ? 'picardy' : 'minor')))
    const beforeManualNext = [...audioMock.sources]
    await click(button('Next question'))
    assert.ok(button('Pause'), 'opted-in manual Next also starts next audio')
    assert.ok(beforeManualNext.every(source => source.stopped))
    await navigate('#quizzes')
    assert.ok(audioMock.sources.every(source => source.stopped), 'navigation cancels autoplay voices')
    await navigate('#ear-training')
    assert.ok(button('Play'), 'returning never autoplays')
    await click(autoplay())
    await click(button(answerText(currentQuestion().type)))
    assert.ok(button('Play'), 'opting out keeps following question silent')
    await click(autoplay())
    while (quiz().querySelector('.ear-player')) await click(button(answerText(currentQuestion().type)))
    assert.ok(quiz().querySelector('.ear-score'), 'final correct answer shows results immediately')
    assert.ok(audioMock.sources.every(source => source.stopped), 'results never autoplay')
    const contextsBeforeRestart = audioMock.contexts.length
    await click(button('Start a new round'))
    assert.equal(audioMock.contexts.length, contextsBeforeRestart, 'restarting does not autoplay even while opted in')

    await navigate('#quizzes/unknown-category/unknown-quiz')
    assert.ok(document.querySelector('.quiz-hub'), 'unknown quiz route returns to the hub')
    await navigate('#ear-training')
    assert.ok(quiz(), 'legacy deep link remains supported')
    await navigate('#quizzes')
    await navigate('#quizzes/ear-training/picardy-thirds')
    await act(async () => { window.history.back(); await new Promise(resolve => window.addEventListener('hashchange', resolve, { once: true })) })
    assert.ok(document.querySelector('.quiz-hub'), 'browser Back returns to quiz hub')
    await act(async () => { window.history.forward(); await new Promise(resolve => window.addEventListener('hashchange', resolve, { once: true })) })
    assert.equal(document.querySelector('.quiz-hub'), null, 'browser Forward returns to quiz')
    assert.equal(quiz().querySelector('h1').textContent, 'Picardy Thirds')
    assert.equal(quiz().textContent.includes('Listen to the whole phrase'), false, 'instructional fluff removed')
    assert.equal(window.localStorage.getItem('chord-atlas.local-shapes.v1'), '{"version":1,"shapes":[],"deletedIds":[]}')
  } finally {
    await act(async () => root.unmount())
    audioMock.restore()
    dom.window.close()
    Math.random = originalRandom
  }
})

test('fixed MIDI data and sample mapping preserve all eight answers and timing', () => {
  for (const question of studies) assert.equal(question.progression.split(' – ').length, 4, 'four-chord example')
  const roots = [9, 2, 4, 7, 11, 0, 6, 5]
  for (const question of studies) {
    const sequence = sequences[question.id]
    assert.ok(sequence.durationSeconds > 7 && sequence.durationSeconds < 8)
    assert.equal(sequence.notes.length, question.instrument === 'Piano' ? 26 : 24)
    for (const note of sequence.notes) {
      assert.ok(note.startSeconds >= 0 && note.durationSeconds > 0)
      assert.ok(note.startSeconds + note.durationSeconds <= sequence.durationSeconds)
      assert.ok(Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127)
      assert.ok(note.velocity > 0 && note.velocity <= 127)
      const path = samples[`${note.program}:${note.midi}`]
      assert.ok(readFileSync(new URL(`../public${path}`, import.meta.url)).length > 1000)
    }
    const tonic = roots[question.id - 1]
    const finalClasses = [...new Set(sequence.notes.filter(note => note.startSeconds >= 4.43).map(note => note.midi % 12))].sort((a, b) => a - b)
    const expected = [tonic, (tonic + (question.type === 'minor' ? 3 : 4)) % 12, (tonic + 7) % 12].sort((a, b) => a - b)
    assert.deepEqual(finalClasses, expected, `example ${question.id} ending matches answer`)
  }
  const css = readFileSync(new URL('../src/ear-training/ear-training.css', import.meta.url), 'utf8')
  assert.equal(/(^|\n)(body|:root|button|h1|h2|\*)\s*\{/.test(css), false)
})
