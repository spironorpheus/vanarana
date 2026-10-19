import type { Answer, Study } from './studies'
export type Round = { order: Study[]; index: number; responses: { question: Study; choice: Answer; correct: boolean }[]; finished: boolean; review: boolean; session: number }
export type RoundAction = { type: 'answer'; choice: Answer; questionId?: number } | { type: 'next'; questionId?: number } | { type: 'start'; order: Study[]; review: boolean }
export const initialRound = (order: Study[]): Round => ({ order, index: 0, responses: [], finished: false, review: false, session: 0 })
export function shuffledStudies(items: Study[], random: () => number = Math.random): Study[] {
  const order = [...items]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}
export const initialShuffledRound = (order: Study[]): Round => initialRound(shuffledStudies(order))
export function roundReducer(round: Round, action: RoundAction): Round {
  if (action.type === 'start') return action.order.length ? { ...initialRound(action.order), review: action.review, session: round.session + 1 } : round
  if (round.finished) return round
  if (action.type === 'answer') {
    if (round.responses[round.index] || (action.questionId !== undefined && action.questionId !== round.order[round.index].id)) return round
    const question = round.order[round.index]
    return { ...round, responses: [...round.responses, { question, choice: action.choice, correct: action.choice === question.type }] }
  }
  if (!round.responses[round.index] || (action.questionId !== undefined && action.questionId !== round.order[round.index].id)) return round
  return round.index === round.order.length - 1 ? { ...round, finished: true } : { ...round, index: round.index + 1 }
}
