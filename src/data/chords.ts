export const topNotes = [
  '1',
  'b2',
  '2',
  'b3',
  '3',
  '4',
  'b5',
  '5',
  'b6',
  '6',
  'b7',
  '7',
] as const

export type TopNote = (typeof topNotes)[number]
export type FamilyId = 'minor' | 'major' | 'half-diminished' | 'dominant' | 'suspended'

export type Voicing = {
  /** Each string is one staff/hand grouping, rendered on its own line. */
  stacks: string[]
}

const topNoteAliases: Record<string, TopNote> = {
  '1': '1',
  '#1': 'b2',
  'b2': 'b2',
  '2': '2',
  '#2': 'b3',
  'b3': 'b3',
  '3': '3',
  'b4': '3',
  '#3': '4',
  '4': '4',
  '#4': 'b5',
  'b5': 'b5',
  '5': '5',
  '#5': 'b6',
  'b6': 'b6',
  '6': '6',
  '#6': 'b7',
  'b7': 'b7',
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
  name: string
  technique?: string
  voicings: Voicing[]
}

export function inferChordFamily(name: string): FamilyId | null {
  const normalized = name.trim().toLowerCase()

  if (/^m\d+b5(?=$|[\s(])/.test(normalized)) return 'half-diminished'
  if (/^maj(?=$|[\d\s(])/.test(normalized)) return 'major'
  if (/^(?:min(?=$|[\d\s(])|mm7(?=$|[\s(]))/.test(normalized)) return 'minor'
  if (/^sus[24](?=$|[\s(])/.test(normalized)) return 'suspended'
  if (/^alt(?=$|[\s(])/.test(normalized) || /^(?:7|9|13)(?=$|\D)/.test(normalized)) return 'dominant'

  return null
}

export function getChordFamily(name: string): FamilyId {
  const family = inferChordFamily(name)
  if (!family) throw new Error(`Cannot infer a chord family from: ${name}`)
  return family
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
    shortLabel: 'm7b5',
    description: 'Half-diminished colors and inversions',
  },
  {
    id: 'dominant',
    label: 'Dominant',
    shortLabel: 'dom',
    description: 'Altered dominants, suspended colors, and upper structures',
  },
  {
    id: 'suspended',
    label: 'Suspended',
    shortLabel: 'sus',
    description: 'Suspended-second and suspended-fourth colors',
  },
]

/**
 * The library lives here on purpose: edit this array, commit it, and the UI updates.
 * Notes use scale degrees relative to the root. `stacks` preserves the line breaks
 * from the original notebook table; the final note implies the voicing's top note.
 */
export const chordShapes: ChordShape[] = [
  {
    id: 'min7-drop2', name: 'min7', technique: 'Drop 2',
    voicings: [
      { stacks: ['1 b7', 'b3 5 1'] },
      { stacks: ['1', '5 b7 b3'] },
      { stacks: ['1 b3', 'b7 1 5'] },
      { stacks: ['1 5', '1 b3 b7'] },
    ],
  },
  {
    id: 'min7add9-drop2', name: 'min7 (9)', technique: 'Drop 2',
    voicings: [{ stacks: ['1 5', '2 b3 b7'] }],
  },
  {
    id: 'min9-drop2', name: 'min9', technique: 'Drop 2',
    voicings: [
      { stacks: ['1 b7', 'b3 5 2'] },
      { stacks: ['1 b3', 'b7 2 5'] },
    ],
  },
  {
    id: 'min69-drop2', name: 'min6/9', technique: 'Drop 2',
    voicings: [
      { stacks: ['1 6', 'b3 5 2'] },
      { stacks: ['1 b3', '6 2 5'] },
    ],
  },
  {
    id: 'min11-drop2', name: 'min11', technique: 'Drop 2',
    voicings: [
      { stacks: ['1 b7', 'b3 4 1'] },
      { stacks: ['1', '4 b7 b3'] },
      { stacks: ['1 b3', 'b7 1 4'] },
      { stacks: ['1 4', '1 b3 b7'] },
    ],
  },
  {
    id: 'maj3add9-drop2',
    name: 'maj (add9)',
    technique: 'Drop 2',
    voicings: [
      { stacks: ['1 5', '2 3 1'] },
      { stacks: ['1', '3 5 2'] },
      { stacks: ['1 3', '1 2 5'] },
    ],
  },
  {
    id: 'maj7-drop2', name: 'maj7', technique: 'Drop 2',
    voicings: [
      { stacks: ['1', '5 7 3'] },
      { stacks: ['1 3', '7 1 5'] },
      { stacks: ['1 5', '1 3 7'] },
    ],
  },
  {
    id: 'maj7-drop-2-4',
    name: 'maj7',
    technique: 'Drop 2+4',
    voicings: [
      { stacks: ['1 5', '3 7'] },
      { stacks: ['1 5', '7 3'] },
    ],
  },
  {
    id: 'maj7add9-drop2', name: 'maj7 (9)', technique: 'Drop 2',
    voicings: [{ stacks: ['1 5', '2 3 7'] }],
  },
  {
    id: 'maj9-drop2', name: 'maj9', technique: 'Drop 2',
    voicings: [
      { stacks: ['1 7', '3 5 2'] },
      { stacks: ['1 3', '7 2 5'] },
    ],
  },
  {
    id: 'maj69-drop2', name: 'maj6/9', technique: 'Drop 2',
    voicings: [
      { stacks: ['1 6', '3 5 2'] },
      { stacks: ['1 3', '6 2 5'] },
    ],
  },
  {
    id: 'maj7-sharp11-drop2', name: 'maj7 (#11)', technique: 'Drop 2',
    voicings: [
      { stacks: ['1 7', '3 #4 1'] },
      { stacks: ['1', '#4 7 3'] },
      { stacks: ['1 #4', '1 3 7'] },
    ],
  },
  {
    id: 'm7b5-9-drop2', name: 'm7b5 (9)', technique: 'Drop 2',
    voicings: [
      { stacks: ['1 b7', 'b3 b5 2'] },
      { stacks: ['1 b3', 'b7 2 b5'] },
    ],
  },
  {
    id: 'm7b5-b9-drop2', name: 'm7b5 (b9)', technique: 'Drop 2',
    voicings: [{ stacks: ['1 b7', 'b3 b5 b2'] }],
  },
  {
    id: 'm11b5-drop2', name: 'm7b5 (11)', technique: 'Drop 2',
    voicings: [{ stacks: ['1 b3', 'b5 b7 4'] }],
  },
  {
    id: '13b9-drop2', name: '13 (b9)', technique: 'Drop 2',
    voicings: [
      { stacks: ['1 b7', '3 6 b2'] },
      { stacks: ['1 3', 'b7 b2 6'] },
    ],
  },
  {
    id: '13b9-upper', name: '13 (b9)', technique: 'Upper structure',
    voicings: [
      { stacks: ['1 b7', '3 6 #1'] },
      { stacks: ['1 b7', '6 #1 3'] },
      { stacks: ['1 b7', '#1 3 6'] },
    ],
  },
  {
    id: '13b9-sharp11-upper', name: '13 (b9,#11)', technique: 'Upper structure',
    voicings: [
      { stacks: ['1 3 b7', '#4 6 #1'] },
      { stacks: ['1 3 b7', '6 #1 #4'] },
      { stacks: ['1 3 b7', '#1 #4 6'] },
    ],
  },
  {
    id: '7b9-sharp11-upper', name: '7 (b9,#11)', technique: 'Upper structure',
    voicings: [
      { stacks: ['1 3 b7', '#4 #6 #1'] },
      { stacks: ['1 3 b7', '#6 #1 #4'] },
      { stacks: ['1 3 b7', '#1 #4 #6'] },
    ],
  },
  {
    id: '13-drop2', name: '13', technique: 'Drop 2',
    voicings: [
      { stacks: ['1 b7', '3 6 2'] },
      { stacks: ['1 3', 'b7 2 6'] },
    ],
  },
  {
    id: '13-sharp11-upper', name: '13 (#11)', technique: 'Upper structure',
    voicings: [
      { stacks: ['1 3 b7', '#4 6 2'] },
      { stacks: ['1 3 b7', '6 2 #4'] },
      { stacks: ['1 3 b7', '2 #4 6'] },
    ],
  },
  {
    id: 'alt-sharp2-drop2', name: 'alt (#9)', technique: 'Drop 2',
    voicings: [
      { stacks: ['1 b7', '3 b6 #2'] },
      { stacks: ['1 3', 'b7 #2 b6'] },
    ],
  },
  {
    id: 'alt-sharp2-upper', name: 'alt (#9)', technique: 'Upper structure',
    voicings: [
      { stacks: ['1 3 b7', 'b3 b6 1'] },
      { stacks: ['1 3 b7', 'b6 1 b3'] },
      { stacks: ['1 3 b7', '1 b3 b6'] },
    ],
  },
  {
    id: 'alt-b2-drop2', name: 'alt (b9)', technique: 'Drop 2',
    voicings: [
      { stacks: ['1 b7', '3 b6 b2'] },
      { stacks: ['1 3', 'b7 b2 b6'] },
    ],
  },
  {
    id: 'alt-b2-upper', name: 'alt (b9)', technique: 'Upper structure',
    voicings: [
      { stacks: ['1 3 b7', 'b4 b6 b2'] },
      { stacks: ['1 3 b7', 'b6 b2 b4'] },
      { stacks: ['1 3 b7', 'b2 b4 b6'] },
    ],
  },
  {
    id: '9sus4-upper', name: '9sus4', technique: 'Upper structure',
    voicings: [
      { stacks: ['1 b7', '4 b7 2'] },
      { stacks: ['1 b7', 'b7 2 4'] },
      { stacks: ['1 b7', '2 4 b7'] },
    ],
  },
  {
    id: '13sus4-upper', name: '13sus4', technique: 'Upper structure',
    voicings: [{ stacks: ['1 b7', 'b7 2 4 6'] }],
  },
  {
    id: '7sus4b9-upper', name: '7sus4 (b9)', technique: 'Upper structure',
    voicings: [
      { stacks: ['1 b7', '4 b7 b2'] },
      { stacks: ['1 b7', 'b7 b2 4'] },
      { stacks: ['1 b7', 'b2 4 b7'] },
    ],
  },
  {
    id: '13sus4b9-upper', name: '13sus4 (b9)', technique: 'Upper structure',
    voicings: [{ stacks: ['1 b7', 'b7 b2 4 6'] }],
  },
  {
    id: '7-drop-2',
    name: '7',
    technique: 'Drop 2',
    voicings: [
      { stacks: ['1 5', '1 3 b7'] },
      { stacks: ['1 b7', '3 5 1'] },
      { stacks: ['1', '5 b7 3'] },
      { stacks: ['1 3', 'b7 1 5'] },
    ],
  },
  {
    id: 'maj9-rootless',
    name: 'maj9',
    technique: 'Rootless',
    voicings: [
      { stacks: ['1', '3 5 7 2'] },
      { stacks: ['1', '7 2 3 5'] },
    ],
  },
  {
    id: 'maj13-rootless',
    name: 'maj13',
    technique: 'Rootless',
    voicings: [
      { stacks: ['1', '3 6 7 2'] },
      { stacks: ['1', '7 2 3 6'] },
    ],
  },
  {
    id: 'maj69-rootless',
    name: 'maj6/9',
    technique: 'Rootless',
    voicings: [
      { stacks: ['1', '3 5 6 2'] },
      { stacks: ['1', '6 2 3 5'] },
    ],
  },
  {
    id: 'min9-rootless',
    name: 'min9',
    technique: 'Rootless',
    voicings: [
      { stacks: ['1', 'b3 5 b7 2'] },
      { stacks: ['1', 'b7 2 b3 5'] },
    ],
  },
  {
    id: 'min69-rootless',
    name: 'min6/9',
    technique: 'Rootless',
    voicings: [
      { stacks: ['1', 'b3 5 6 2'] },
      { stacks: ['1', '6 2 b3 5'] },
    ],
  },
  {
    id: 'm7b5-b9-rootless',
    name: 'm7b5 (b9)',
    technique: 'Rootless',
    voicings: [
      { stacks: ['1', 'b3 b5 b7 b2'] },
      { stacks: ['1', 'b7 b2 b3 b5'] },
    ],
  },
  {
    id: 'm7b5-9-rootless',
    name: 'm7b5 (9)',
    technique: 'Rootless',
    voicings: [
      { stacks: ['1', 'b3 b5 b7 2'] },
      { stacks: ['1', 'b7 2 b3 b5'] },
    ],
  },
  {
    id: 'm7b5-11-rootless',
    name: 'm7b5 (11)',
    technique: 'Rootless',
    voicings: [
      { stacks: ['1', '1 4 b5 b7'] },
      { stacks: ['1', 'b5 b7 1 4'] },
    ],
  },
  {
    id: '13-rootless',
    name: '13',
    technique: 'Rootless',
    voicings: [
      { stacks: ['1', '3 6 b7 2'] },
      { stacks: ['1', 'b7 2 3 6'] },
    ],
  },
  {
    id: '7b9-rootless',
    name: '7 (b9)',
    technique: 'Rootless',
    voicings: [
      { stacks: ['1', '3 5 b7 b2'] },
      { stacks: ['1', 'b7 b2 3 5'] },
      { stacks: ['1', '5 b7 b2 3'] },
      { stacks: ['1', 'b2 3 5 b7'] },
    ],
  },
  {
    id: 'alt-9-rootless',
    name: 'alt (#9)',
    technique: 'Rootless',
    voicings: [
      { stacks: ['1', '3 b6 b7 b3'] },
      { stacks: ['1', 'b7 b3 3 b6'] },
    ],
  },
  {
    id: 'alt-b9-rootless',
    name: 'alt (b9)',
    technique: 'Rootless',
    voicings: [
      { stacks: ['1', 'b7 b2 3 b6'] },
      { stacks: ['1', '3 b6 b7 b2'] },
    ],
  },
  {
    id: 'alt-13-rootless',
    name: 'alt (13)',
    technique: 'Rootless',
    voicings: [
      { stacks: ['1', 'b7 b2 3 6'] },
    ],
  },
  {
    id: 'maj13-11-upper-structure',
    name: 'maj13 (#11)',
    technique: 'Upper structure',
    voicings: [
      { stacks: ['1 3 7', '2 b5 6'] },
      { stacks: ['1 3 7', 'b5 6 2'] },
      { stacks: ['1 3 7', '6 2 b5'] },
    ],
  },
  {
    id: 'maj9-upper-structure',
    name: 'maj9',
    technique: 'Upper structure',
    voicings: [
      { stacks: ['1 3 7', '2 5 7'] },
      { stacks: ['1 3 7', '5 7 2'] },
      { stacks: ['1 3 7', '7 2 5'] },
    ],
  },
  {
    id: 'min11-upper-structure',
    name: 'min11',
    technique: 'Upper structure',
    voicings: [
      { stacks: ['1 b3 b7', 'b7 2 4'] },
      { stacks: ['1 b3 b7', '2 4 b7'] },
      { stacks: ['1 b3 b7', '4 b7 2'] },
    ],
  },
  {
    id: 'm7b5-9-11-upper-structure',
    name: 'm7b5 (9,11)',
    technique: 'Upper structure',
    voicings: [
      { stacks: ['1 b3 b5 b7', 'b7 2 4'] },
      { stacks: ['1 b3 b5 b7', '2 4 b7'] },
      { stacks: ['1 b3 b5 b7', '4 b7 2'] },
    ],
  },
  {
    id: 'm7b5-9-upper-structure',
    name: 'm7b5 (9)',
    technique: 'Upper structure',
    voicings: [
      { stacks: ['1 b3 b7', 'b7 2 b5'] },
      { stacks: ['1 b3 b7', '2 b5 b7'] },
      { stacks: ['1 b3 b7', 'b5 b7 2'] },
    ],
  },
  {
    id: 'mm7-9-upper-structure',
    name: 'mM7 (9)',
    technique: 'Upper structure',
    voicings: [
      { stacks: ['1 b3 7', '2 5 7'] },
      { stacks: ['1 b3 7', '5 7 2'] },
      { stacks: ['1 b3 7', '7 2 5'] },
    ],
  },
  {
    id: '9-rootless',
    name: '9',
    technique: 'Rootless',
    voicings: [
      { stacks: ['1', 'b7 2 3 5'] },
      { stacks: ['1', '3 5 b7 2'] },
    ],
  },
  {
    id: '9-drop-2',
    name: '9',
    technique: 'Drop 2',
    voicings: [
      { stacks: ['1 3', 'b7 2 5'] },
      { stacks: ['1 b7', '3 5 2'] },
    ],
  },
  {
    id: 'maj13-4-5-intervals',
    name: 'maj13',
    technique: '4/5 Intervals',
    voicings: [
      { stacks: ['1 5 2', '6 3 7'] },
    ],
  },
  {
    id: 'maj9-sharp11-4-5-intervals',
    name: 'maj9 (#11)',
    technique: '4/5 Intervals',
    voicings: [
      { stacks: ['1 5 2', '3 7 b5'] },
    ],
  },
]
