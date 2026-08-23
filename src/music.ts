import type { Voicing } from './data/chords'

export const degreeSemitones: Record<string, number> = {
  '1': 0, '♯1': 1, '♭2': 1, '2': 2, '♯2': 3, '♭3': 3,
  '3': 4, '♭4': 4, '♯3': 5, '4': 5, '♯4': 6, '♭5': 6,
  '5': 7, '♯5': 8, '♭6': 8, '6': 9, '♯6': 10, '♭7': 10, '7': 11,
}

export const rootNotes = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']

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
 * held pitch must align with a root degree; intervals and order may not change.
 */
export function matchVoicing(voicing: Voicing, heldNotes: number[]): VoicingMatch | null {
  if (heldNotes.length === 0) return null

  const played = [...new Set(heldNotes)].sort((a, b) => a - b)
  const voicingNotes = voicedNotes(voicing.stacks, 0)
  if (played.length > voicingNotes.length) return null

  for (let firstIndex = 0; firstIndex < voicingNotes.length; firstIndex += 1) {
    if (degreeSemitones[voicingNotes[firstIndex].degree] !== 0) continue

    const offset = played[0] - voicingNotes[firstIndex].pitch
    const noteIndexes = [firstIndex]
    let searchFrom = firstIndex + 1
    let matched = true

    for (let playedIndex = 1; playedIndex < played.length; playedIndex += 1) {
      const target = played[playedIndex] - offset
      const voicingIndex = voicingNotes.findIndex(
        (note, index) => index >= searchFrom && note.pitch === target,
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
