import type { Voicing } from './data/chords'

export const degreeSemitones: Record<string, number> = {
  '1': 0, '#1': 1, 'b2': 1, '2': 2, '#2': 3, 'b3': 3,
  '3': 4, 'b4': 4, '#3': 5, '4': 5, '#4': 6, 'b5': 6,
  '5': 7, '#5': 8, 'b6': 8, '6': 9, '#6': 10, 'b7': 10, '7': 11,
}

export const rootNotes = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const degreeForSemitone = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7']

export type VoicedNote = {
  pitch: number
  degree: string
  row: number
}

export type VoicingMatch = {
  root: number
  noteIndexes: number[]
}

const modulo = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor

/** Normalizes an absolute MIDI gesture into the library's lowest-note-root format. */
export function midiNotesToVoicing(notes: number[], noteStacks: number[][] = [notes]): Voicing {
  const played = [...new Set(notes)].sort((a, b) => a - b)
  if (played.length === 0) return { stacks: [] }

  const root = played[0]
  return {
    stacks: noteStacks
      .map((stack) => [...new Set(stack)].sort((a, b) => a - b))
      .filter((stack) => stack.length > 0)
      .map((stack) => stack.map((note) => degreeForSemitone[modulo(note - root, 12)]).join(' ')),
  }
}

/** Turns the degree order in a cell into a strictly ascending, bottom-to-top voicing. */
export function voicedNotes(stacks: string[], root: number): VoicedNote[] {
  let previous = -1
  return stacks.flatMap((stack, row) => stack.trim().split(/\s+/).map((degree) => {
    const pitchClass = degreeSemitones[degree]
    let pitch = pitchClass + root
    while (pitch <= previous) pitch += 12
    previous = pitch
    return { pitch, degree, row }
  }))
}

/**
 * Finds the held pitches as an ordered subsequence of a voicing. The lowest
 * held pitch must align with a root degree. Order and intervals within a row
 * may not change, while the second row may be displaced upward by octaves.
 */
export function matchVoicing(voicing: Voicing, heldNotes: number[]): VoicingMatch | null {
  if (heldNotes.length === 0) return null

  const played = [...new Set(heldNotes)].sort((a, b) => a - b)
  const voicingNotes = voicedNotes(voicing.stacks, 0)
  if (played.length > voicingNotes.length) return null

  // Keep the intervals within each row exact, but let the upper row sit one or
  // more octaves above its written, closest-position register.
  const maximumExtraOctaves = Math.floor((played.at(-1)! - played[0]) / 12)

  for (let extraOctaves = 0; extraOctaves <= maximumExtraOctaves; extraOctaves += 1) {
    const match = matchAtRowSpacing(voicingNotes, played, extraOctaves)
    if (match) return match
  }

  return null
}

/**
 * Matches a two-note MIDI gesture using only its outer notes. The lower note
 * establishes the root and the upper note selects the voicing's top-note
 * pitch class, without requiring the notes between them to be played.
 */
export function matchVoicingByOuterNotes(voicing: Voicing, heldNotes: number[]): VoicingMatch | null {
  const played = [...new Set(heldNotes)].sort((a, b) => a - b)
  if (played.length !== 2) return null

  const voicingNotes = voicedNotes(voicing.stacks, 0)
  const topNoteIndex = voicingNotes.length - 1
  const rootNoteIndex = voicingNotes.findIndex((note) => degreeSemitones[note.degree] === 0)
  if (rootNoteIndex === -1 || topNoteIndex === -1) return null

  const playedTopNote = modulo(played[1] - played[0], 12)
  const voicingTopNote = degreeSemitones[voicingNotes[topNoteIndex].degree]
  if (playedTopNote !== voicingTopNote) return null

  return {
    root: modulo(played[0], 12),
    noteIndexes: rootNoteIndex === topNoteIndex
      ? [rootNoteIndex]
      : [rootNoteIndex, topNoteIndex],
  }
}

function matchAtRowSpacing(
  voicingNotes: VoicedNote[],
  played: number[],
  extraOctaves: number,
): VoicingMatch | null {
  const extraSemitones = extraOctaves * 12
  const pitchAtSpacing = (note: VoicedNote) => note.pitch + (note.row === 1 ? extraSemitones : 0)

  for (let firstIndex = 0; firstIndex < voicingNotes.length; firstIndex += 1) {
    if (degreeSemitones[voicingNotes[firstIndex].degree] !== 0) continue

    const offset = played[0] - pitchAtSpacing(voicingNotes[firstIndex])
    const noteIndexes = [firstIndex]
    let searchFrom = firstIndex + 1
    let matched = true

    for (let playedIndex = 1; playedIndex < played.length; playedIndex += 1) {
      const target = played[playedIndex] - offset
      const voicingIndex = voicingNotes.findIndex(
        (note, index) => index >= searchFrom && pitchAtSpacing(note) === target,
      )

      if (voicingIndex === -1) {
        matched = false
        break
      }

      noteIndexes.push(voicingIndex)
      searchFrom = voicingIndex + 1
    }

    if (matched) {
      return { root: modulo(offset, 12), noteIndexes }
    }
  }

  return null
}

export function midiNoteName(note: number) {
  return `${rootNotes[modulo(note, 12)]}${Math.floor(note / 12) - 1}`
}
