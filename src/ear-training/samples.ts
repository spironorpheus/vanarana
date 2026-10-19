import type { SampleManifest } from './player'
import { sequences } from './sequences'

export const samples: SampleManifest = Object.fromEntries(
  Object.values(sequences).flatMap(sequence => sequence.notes.map(note => [
    `${note.program}:${note.midi}`,
    `${import.meta.env.BASE_URL}audio/instruments/${note.program}-${note.midi}.wav`,
  ])),
)
