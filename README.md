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
    { topNote: '2', stacks: ['1 ♭7', '♭3 5 2'] },
  ],
}
```

Each item in `stacks` is shown on its own line, preserving the hand/staff
grouping from the original notes. `topNote`, `family`, and `status` are typed, so
mistakes are caught during the build.

## Included interactions

- Filter by chord family or any of the 12 chromatic top notes
- Search chord names, techniques, families, and scale degrees
- Switch between a compact card library and the original matrix-style view
- Open any shape for a focused view or choose a random practice prompt
