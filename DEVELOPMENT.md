# Developing Vanarana

## Run and check

Use Node.js 24+.

```sh
npm ci
npm run dev
```

Before opening another development server, check for an existing one and reuse it. When sharing a development preview, include the reachable network URL rather than only localhost.

Before shipping:

```sh
npm test
npm run build
npm run lint
```

DOM and playback tests mock Web Audio and MIDI. Passing tests do not verify audible output, real MIDI hardware, or mobile-browser behavior. Check those in a real browser when changing playback or keyboard input, especially audio activation on mobile Safari and cleanup when switching features.

## Compatibility and content constraints

- Keep the existing `chord-atlas.local-shapes.v1` and `chord-atlas.last-voicing-type` storage keys. The Vanarana rebrand must not discard saved edits or preferences; any future format change needs a migration.
- Preserve the legacy `#ear-training` deep link alongside the current quiz route.
- Chord catalog edits can be prepared in the UI and copied with **Export edits**. Commit exported changes before clearing local overrides; clearing unmatched edits discards them.
- Ear-training arrangements are fixed, committed MIDI note, timing, velocity, and instrument data. Preserve their original keys and answer identities. Do not replace them with runtime-generated music or third-party audio services.
- Self-hosted instrument samples derive from CC0 VSCO 2 Community Edition and VCSL recordings. Preserve the bundled license texts, [attribution](public/audio/instruments/ATTRIBUTION.md), and [per-sample provenance](public/audio/instruments/provenance.json) when changing assets. The provenance records source commits, pitches, and offline transformations. VSCO orchestral filenames use an octave convention one lower than scientific pitch notation; verify actual pitches rather than trusting names.

## Transcription data

The separate `vanarana.transcriptions.v1` store contains a versioned JSON envelope. Chord roots and slash basses are semitone offsets from the chart's major tonic, not absolute notes. Rendering and auditioning in another key must never rewrite those offsets. Grid auditions are fixed root-position chords; slash bass is only applied to edited chart chords. Keep transcription playback isolated from the quiz's fixed authored arrangements. Import validates the full envelope before adding copies with fresh IDs; it never replaces existing work.

Chart playback treats every bar as four quarter-note beats and splits that duration evenly among its chord/hold entries; an empty bar is a full-bar rest. Tempo is an optional per-chart `bpm` field (120 by default; integer 40–240), so older version-1 backups remain valid. The playhead is independent of edit selection. Stop pending playback before switching charts, changing keys, hiding the document, or leaving the feature.

Hold entries use `hold: true` on the backward-compatible chord object; their root/quality fields are inert placeholders. The sequencer resolves harmony from explicit chords and combines contiguous holds into one audio phrase while advancing the visible playhead per entry. Empty bars interrupt sound. Legacy bar `time` and `section` metadata still round-trips but is no longer editable or shown. Bar text is always degree syntax even in transposed letter view; partial invalid drafts must never overwrite saved entries.

Bar growth is event-driven: a valid nonempty edit to the final bar appends exactly eight blank bars in the same commit, never on load/import. Trimming removes trailing groups of eight only when at least sixteen blanks remain, retaining 8–15 working blanks and protecting the currently edited cell until Done. Legacy metadata prevents a bar from counting as empty for trimming. Existing zero-bar charts expose a virtual starter cell; persistence changes only when content is entered. Limit checks preserve the entered content even when a full extra block cannot fit.

Transcription piano playback reuses the self-hosted program-0 sample bank. Exact pitches are preferred; other pitches use the closest recorded pitch with a semitone playback-rate adjustment. Keep this separate from quiz playback, which must preserve exact authored pitches and samples. Holds use a single attack and natural piano decay, never repeated notes or looping.

The optional per-chart `metronome` boolean defaults to on for old charts. It is playback-only, counts four beats per bar regardless of chord slots/holds, and accents beat one. Start its audio-clock schedule only after piano preparation completes; cancel its timer and scheduled clicks independently from ordinary chord voice changes.
