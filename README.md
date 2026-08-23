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

All library content lives in [`src/data/chords.ts`](src/data/chords.ts). Add an
entry to `chordShapes`:

```ts
{
  id: 'min9-drop2',
  family: 'minor',
  name: 'min9',
  technique: 'Drop 2',
  status: 'learning',
  voicings: [
    { stacks: ['1 ♭7', '♭3 5 2'] },
  ],
}
```

Each item in `stacks` is shown on its own line, preserving the hand/staff
grouping from the original notes. The last note in the final stack determines
the top-note column automatically. Enharmonic degrees such as `♯4` and `♭5` are
normalized to the same column.

## Included interactions

- Filter by chord family, voicing type, or any of the 12 chromatic top notes
- Hold three or more notes on a Web MIDI keyboard to find ordered voicing matches
- Browse the library in a compact matrix modeled on the original notes
