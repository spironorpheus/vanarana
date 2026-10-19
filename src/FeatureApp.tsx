import { useEffect, useState } from 'react'
import Chords from './App'
import EarTraining from './ear-training/EarTraining'
import QuizHub from './QuizHub'
import Transcription from './transcription/Transcription'
import { quizCategories } from './ear-training/quizRegistry'
import './features.css'

const picardyQuiz = quizCategories[0].quizzes[0]
const currentFeature = () => {
  const hash = window.location.hash
  if (hash === '#transcription') return 'transcription'
  if (hash === '#ear-training' || hash === picardyQuiz.href) return 'ear-training'
  if (hash === '#quizzes' || hash.startsWith('#quizzes/')) return 'quizzes'
  return 'chords'
}

export default function FeatureApp() {
  const [feature, setFeature] = useState(currentFeature)
  const [visited, setVisited] = useState(() => new Set([currentFeature()]))
  useEffect(() => {
    const navigate = () => {
      const next = currentFeature()
      setFeature(next)
      setVisited(previous => new Set([...previous, next]))
    }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])
  return <>
    <nav className="feature-nav" aria-label="Features">
      <div className="feature-nav-inner">
        <a href="#chords" aria-current={feature === 'chords' ? 'page' : undefined}>Chords</a>
        <a href="#quizzes" aria-current={(feature === 'quizzes' || feature === 'ear-training') ? 'page' : undefined}>Quizzes</a>
        <a href="#transcription" aria-current={feature === 'transcription' ? 'page' : undefined}>Transcription</a>
      </div>
    </nav>
    <div hidden={feature !== 'chords'}>{visited.has('chords') && <Chords />}</div>
    {feature === 'quizzes' && <QuizHub />}
    <div hidden={feature !== 'transcription'}>{visited.has('transcription') && <Transcription active={feature === 'transcription'} />}</div>
    <div hidden={feature !== 'ear-training'}>{visited.has('ear-training') && <>
      <nav className="quiz-breadcrumb" aria-label="Quiz breadcrumb"><a href="#quizzes">← All quizzes</a><span aria-hidden="true">/</span><span>Ear training</span><span aria-hidden="true">/</span><span aria-current="page">Picardy Thirds</span></nav>
      <EarTraining active={feature === 'ear-training'} />
    </>}</div>
  </>
}
