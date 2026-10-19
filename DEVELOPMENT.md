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
