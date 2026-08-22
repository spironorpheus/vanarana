export const topNotes = [
  '1',
  '♭2',
  '2',
  '♭3',
  '3',
  '4',
  '♭5',
  '5',
  '♭6',
  '6',
  '♭7',
  '7',
] as const

export type TopNote = (typeof topNotes)[number]
export type FamilyId = 'minor' | 'major' | 'half-diminished' | 'dominant'
export type LearningStatus = 'exploring' | 'learning' | 'comfortable'

export type Voicing = {
  /** Each string is one staff/hand grouping, rendered on its own line. */
  stacks: string[]
}

const topNoteAliases: Record<string, TopNote> = {
  '1': '1',
  '♯1': '♭2',
  '♭2': '♭2',
  '2': '2',
  '♯2': '♭3',
  '♭3': '♭3',
  '3': '3',
  '♭4': '3',
  '♯3': '4',
  '4': '4',
  '♯4': '♭5',
  '♭5': '♭5',
  '5': '5',
  '♯5': '♭6',
  '♭6': '♭6',
  '6': '6',
  '♯6': '♭7',
  '♭7': '♭7',
  '7': '7',
}

export function getTopNote(voicing: Voicing): TopNote {
  const lastStack = voicing.stacks.at(-1)
  const lastNote = lastStack?.trim().split(/\s+/).at(-1)
  const topNote = lastNote ? topNoteAliases[lastNote] : undefined

  if (!topNote) {
    throw new Error(`Cannot derive a top note from: ${voicing.stacks.join(' / ')}`)
  }

  return topNote
}

export type ChordShape = {
  id: string
  family: FamilyId
  name: string
  technique?: 'Drop 2' | 'Upper structure'
  status: LearningStatus
  voicings: Voicing[]
}

export const families: Array<{
  id: FamilyId
  label: string
  shortLabel: string
  description: string
}> = [
  {
    id: 'minor',
    label: 'Minor',
    shortLabel: 'min',
    description: 'Minor colors, extensions, and open structures',
  },
  {
    id: 'major',
    label: 'Major',
    shortLabel: 'maj',
    description: 'Major sevenths, sixths, ninths, and sharp elevens',
  },
  {
    id: 'half-diminished',
    label: 'Half-diminished',
    shortLabel: 'm7♭5',
    description: 'Half-diminished colors and inversions',
  },
  {
    id: 'dominant',
    label: 'Dominant',
    shortLabel: 'dom',
    description: 'Altered dominants, suspended colors, and upper structures',
  },
]

/**
 * The library lives here on purpose: edit this array, commit it, and the UI updates.
 * Notes use scale degrees relative to the root. `stacks` preserves the line breaks
 * from the original notebook table; the final note implies the voicing's top note.
 */
export const chordShapes: ChordShape[] = [
  {
    id: 'min7-drop2', family: 'minor', name: 'min7', technique: 'Drop 2', status: 'comfortable',
    voicings: [
      { stacks: ['1 ♭7', '♭3 5 1'] },
      { stacks: ['1', '5 ♭7 ♭3'] },
      { stacks: ['1 ♭3', '♭7 1 5'] },
      { stacks: ['1 5', '1 ♭3 ♭7'] },
    ],
  },
  {
    id: 'min7add9-drop2', family: 'minor', name: 'min7(add9)', technique: 'Drop 2', status: 'learning',
    voicings: [{ stacks: ['1 5', '2 ♭3 ♭7'] }],
  },
  {
    id: 'min9-drop2', family: 'minor', name: 'min9', technique: 'Drop 2', status: 'learning',
    voicings: [
      { stacks: ['1 ♭7', '♭3 5 2'] },
      { stacks: ['1 ♭3', '♭7 2 5'] },
    ],
  },
  {
    id: 'min69-drop2', family: 'minor', name: 'min6/9', technique: 'Drop 2', status: 'exploring',
    voicings: [
      { stacks: ['1 6', '♭3 5 2'] },
      { stacks: ['1 ♭3', '6 2 5'] },
    ],
  },
  {
    id: 'min11-drop2', family: 'minor', name: 'min11', technique: 'Drop 2', status: 'learning',
    voicings: [
      { stacks: ['1 ♭7', '♭3 4 1'] },
      { stacks: ['1', '4 ♭7 ♭3'] },
      { stacks: ['1 ♭3', '♭7 1 4'] },
      { stacks: ['1 4', '1 ♭3 ♭7'] },
    ],
  },
  {
    id: 'maj3add9-drop2', family: 'major', name: 'maj(add9)', technique: 'Drop 2', status: 'exploring',
    voicings: [
      { stacks: ['1 5', '2 3 1'] },
      { stacks: ['1', '3 5 2'] },
    ],
  },
  {
    id: 'maj7-drop2', family: 'major', name: 'maj7', technique: 'Drop 2', status: 'comfortable',
    voicings: [
      { stacks: ['1', '5 7 3'] },
      { stacks: ['1 3', '7 1 5'] },
      { stacks: ['1 5', '1 3 7'] },
    ],
  },
  {
    id: 'maj7add9-drop2', family: 'major', name: 'maj7(add9)', technique: 'Drop 2', status: 'learning',
    voicings: [{ stacks: ['1 5', '2 3 7'] }],
  },
  {
    id: 'maj9-drop2', family: 'major', name: 'maj9', technique: 'Drop 2', status: 'learning',
    voicings: [
      { stacks: ['1 7', '3 5 2'] },
      { stacks: ['1 3', '7 2 5'] },
    ],
  },
  {
    id: 'maj69-drop2', family: 'major', name: 'maj6/9', technique: 'Drop 2', status: 'exploring',
    voicings: [
      { stacks: ['1 6', '3 5 2'] },
      { stacks: ['1 3', '6 2 5'] },
    ],
  },
  {
    id: 'maj7-sharp11-drop2', family: 'major', name: 'maj7♯11', technique: 'Drop 2', status: 'learning',
    voicings: [
      { stacks: ['1 7', '3 ♯4 1'] },
      { stacks: ['1', '♯4 7 3'] },
      { stacks: ['1 ♯4', '1 3 7'] },
    ],
  },
  {
    id: 'm7b5-9-drop2', family: 'half-diminished', name: 'm7♭5 9', technique: 'Drop 2', status: 'learning',
    voicings: [
      { stacks: ['1 ♭7', '♭3 ♭5 2'] },
      { stacks: ['1 ♭3', '♭7 2 ♭5'] },
    ],
  },
  {
    id: 'm7b5-b9-drop2', family: 'half-diminished', name: 'm7♭5 ♭9', technique: 'Drop 2', status: 'learning',
    voicings: [{ stacks: ['1 ♭7', '♭3 ♭5 ♭2'] }],
  },
  {
    id: 'm11b5-drop2', family: 'half-diminished', name: 'm11♭5', technique: 'Drop 2', status: 'learning',
    voicings: [{ stacks: ['1 ♭3', '♭5 ♭7 4'] }],
  },
  {
    id: '13b9-drop2', family: 'dominant', name: '13♭9', technique: 'Drop 2', status: 'learning',
    voicings: [
      { stacks: ['1 ♭7', '3 6 ♭2'] },
      { stacks: ['1 3', '♭7 ♭2 6'] },
    ],
  },
  {
    id: '13b9-upper', family: 'dominant', name: '13♭9', technique: 'Upper structure', status: 'learning',
    voicings: [
      { stacks: ['1 ♭7', '3 6 ♯1'] },
      { stacks: ['1 ♭7', '6 ♯1 3'] },
      { stacks: ['1 ♭7', '♯1 3 6'] },
    ],
  },
  {
    id: '13b9-sharp11-upper', family: 'dominant', name: '13♭9♯11', technique: 'Upper structure', status: 'exploring',
    voicings: [
      { stacks: ['1 3 ♭7', '♯4 6 ♯1'] },
      { stacks: ['1 3 ♭7', '6 ♯1 ♯4'] },
      { stacks: ['1 3 ♭7', '♯1 ♯4 6'] },
    ],
  },
  {
    id: '7b9-sharp11-upper', family: 'dominant', name: '7♭9♯11', technique: 'Upper structure', status: 'exploring',
    voicings: [
      { stacks: ['1 3 ♭7', '♯4 ♯6 ♯1'] },
      { stacks: ['1 3 ♭7', '♯6 ♯1 ♯4'] },
      { stacks: ['1 3 ♭7', '♯1 ♯4 ♯6'] },
    ],
  },
  {
    id: '13-drop2', family: 'dominant', name: '13', technique: 'Drop 2', status: 'comfortable',
    voicings: [
      { stacks: ['1 ♭7', '3 6 2'] },
      { stacks: ['1 3', '♭7 2 6'] },
    ],
  },
  {
    id: '13-sharp11-upper', family: 'dominant', name: '13♯11', technique: 'Upper structure', status: 'learning',
    voicings: [
      { stacks: ['1 3 ♭7', '♯4 6 2'] },
      { stacks: ['1 3 ♭7', '6 2 ♯4'] },
      { stacks: ['1 3 ♭7', '2 ♯4 6'] },
    ],
  },
  {
    id: 'alt-sharp2-drop2', family: 'dominant', name: 'alt ♯2', technique: 'Drop 2', status: 'learning',
    voicings: [
      { stacks: ['1 ♭7', '3 ♭6 ♯2'] },
      { stacks: ['1 3', '♭7 ♯2 ♭6'] },
    ],
  },
  {
    id: 'alt-sharp2-upper', family: 'dominant', name: 'alt ♯2', technique: 'Upper structure', status: 'exploring',
    voicings: [
      { stacks: ['1 3 ♭7', '♭3 ♭6 1'] },
      { stacks: ['1 3 ♭7', '♭6 1 ♭3'] },
      { stacks: ['1 3 ♭7', '1 ♭3 ♭6'] },
    ],
  },
  {
    id: 'alt-b2-drop2', family: 'dominant', name: 'alt ♭2', technique: 'Drop 2', status: 'learning',
    voicings: [
      { stacks: ['1 ♭7', '3 ♭6 ♭2'] },
      { stacks: ['1 3', '♭7 ♭2 ♭6'] },
    ],
  },
  {
    id: 'alt-b2-upper', family: 'dominant', name: 'alt ♭2', technique: 'Upper structure', status: 'exploring',
    voicings: [
      { stacks: ['1 3 ♭7', '♭4 ♭6 ♭2'] },
      { stacks: ['1 3 ♭7', '♭6 ♭2 ♭4'] },
      { stacks: ['1 3 ♭7', '♭2 ♭4 ♭6'] },
    ],
  },
  {
    id: '9sus4-upper', family: 'dominant', name: '9sus4', technique: 'Upper structure', status: 'learning',
    voicings: [
      { stacks: ['1 ♭7', '4 ♭7 2'] },
      { stacks: ['1 ♭7', '♭7 2 4'] },
      { stacks: ['1 ♭7', '2 4 ♭7'] },
    ],
  },
  {
    id: '13sus4-upper', family: 'dominant', name: '13sus4', technique: 'Upper structure', status: 'exploring',
    voicings: [{ stacks: ['1 ♭7', '♭7 2 4 6'] }],
  },
  {
    id: '7sus4b9-upper', family: 'dominant', name: '7sus4♭9', technique: 'Upper structure', status: 'learning',
    voicings: [
      { stacks: ['1 ♭7', '4 ♭7 ♭2'] },
      { stacks: ['1 ♭7', '♭7 ♭2 4'] },
      { stacks: ['1 ♭7', '♭2 4 ♭7'] },
    ],
  },
  {
    id: '13sus4b9-upper', family: 'dominant', name: '13sus4♭9', technique: 'Upper structure', status: 'exploring',
    voicings: [{ stacks: ['1 ♭7', '♭7 ♭2 4 6'] }],
  },
]
