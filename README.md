# Vanarana

A personal music practice space for exploring chord voicings and training your ear.

**[Open Vanarana](https://vanarana.ljh.me)**

## Chords

- Browse voicings by their top note in a compact, filterable library.
- Filter by chord family, voicing type, and any of the 12 chromatic top notes.
- Connect a MIDI keyboard in a supported browser: hold two notes to filter by base and top note, or three or more to find matching voicings.
- Add, edit, or delete rows and voicings, including capturing voicings from your keyboard. Changes stay in your browser; export your edits to keep a copy.

## Transcription

Create named chord charts with one or more chords per bar. Choose a major-key reference (1=C, for example), then audition the five common chord qualities across all 12 roots. Selecting a bar makes grid taps both play and append chords; **Done editing** returns to audition only.

Select a bar and type scale-degree chords such as `1 . 5/7 6m`. A dot holds the previous chord without another attack, including across bar boundaries. Use `m`, `m7b5`, `dim7`, or `7` for chord qualities and `/` for slash bass. Grid taps still append to the selected bar. The compact chart defaults to degree notation; switch to letter chords and a target key to transpose display and playback. The text editor always uses degrees.

Use **Play chart** (or **Play from bar**) to hear the chart through the end at 40–240 BPM. Every bar has four beats divided evenly among its entries; empty bars are silent. Playback highlights its position separately from your selection. Unfinished invalid text stays in the editor until you fix or discard it; the last valid chart stays saved. Play your reference recording separately.

Transcriptions save in this browser. Export/import JSON backups to keep or transfer your work; imports add copies without replacing existing charts.

## Quizzes

The quiz hub groups practice exercises by category. Start with **[Picardy Thirds](https://vanarana.ljh.me/#quizzes/ear-training/picardy-thirds)** under Ear training: listen to eight short piano and orchestral examples and distinguish a minor-tonic ending from a Picardy third.

Replay or seek within an example, review explanations for missed answers, check your score, and practice just the questions you missed. Correct answers advance immediately; missed answers stay open for review. Enable **Autoplay next** to play each next example automatically (off by default). New rounds are shuffled by default. Keyboard shortcuts support playback, answers, and advancing through the quiz.

## Your data and audio

No account is required. Chord edits are stored locally in your browser and do not sync between devices; quiz scores reset when you refresh. Quiz audio uses self-hosted instrument samples; transcription auditions use a lightweight synthesizer. No third-party audio service is used.

Instrument samples are derived from CC0 libraries by Versilian Studios and contributors. See [sample credits and provenance](public/audio/instruments/ATTRIBUTION.md).

For local setup, checks, and maintenance notes, see [DEVELOPMENT.md](DEVELOPMENT.md).
