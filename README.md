# Chord Atlas

A small, client-only React notebook for chord voicings, organized by the note
on top. There is no API, account, or database: the catalog is TypeScript checked
into this repository.

## Run it

```bash
npm install
npm run dev
```

Use `npm run build` for a production build and `npm run lint` to check the source.

## Add a chord

Use **Add row** in the browser, or click a name in the **Shape** column to edit
an existing row. Rows and individual voicings can be deleted from the editor.
Edits are saved in browser local storage. A MIDI voicing is
captured when the final held key is released; its lowest note becomes scale
degree `1`. The largest note-on timing gap divides the two rows when that gap is
at least 0.3 seconds; otherwise the voicing stays on one row. **Export edits**
copies code-ready entries for committing to the catalog. **Clear local edits**
removes browser overrides immediately when they match the committed catalog and
warns before discarding any changes that do not.

All built-in library content lives in [`src/data/chords.ts`](src/data/chords.ts).
You can also add an entry to `chordShapes` directly:

```ts
{
  id: 'min9-drop2',
  name: 'min9',
  technique: 'Drop 2',
  status: 'learning',
  voicings: [
    { stacks: ['1 b7', 'b3 5 2'] },
  ],
}
```

Each item in `stacks` is shown on its own line, preserving the hand/staff
grouping from the original notes. The last note in the final stack determines
the top-note column automatically. Enharmonic degrees such as `#4` and `b5` are
normalized to the same column.

Chord names and scale degrees use ASCII accidentals (`b` and `#`). Chord quality
and defining extensions stay outside parentheses (`maj9`, `min11`, `13`,
`m7b5`); added or altered tensions go inside a spaced group (`maj7 (#11)`,
`13 (b9,#11)`, `m7b5 (9)`). Use `add9` only when the chord has no seventh.
The chord family is inferred from the shape name: `maj` is major, `min` is
minor, `m...b5` is half-diminished, and names beginning with `7`, `9`, `13`, or
`alt` are dominant.

## Included interactions

- Filter by chord family, voicing type, or any of the 12 chromatic top notes
- Hold three or more notes on a Web MIDI keyboard to find ordered voicing matches
- Browse the library in a compact matrix modeled on the original notes
- Add and edit rows locally, capture new voicings over MIDI, export changes, and safely clear browser overrides
