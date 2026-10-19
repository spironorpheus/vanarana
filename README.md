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

Tap a bar to edit it inline with scale-degree chords such as `1 . 5/7 6m`. A dot holds the previous chord without another attack, including across bar boundaries. Use `m`, `m7b5`, `dim7`, or `7` for chord qualities and `/` for slash bass. Grid taps still append to the selected bar. Filling the last bar automatically adds eight empty bars. Clearing content trims redundant trailing blocks of eight, keeping one blank working block; the cell you are editing stays until you finish. The compact chart defaults to degree notation; switch to letter chords and a target key to transpose display and playback. The inline editor always uses degrees. Press Enter or **Done editing** to return to the chart.

Use **Play chart** (or **Play from bar**) to hear the chart through the end at 40–240 BPM. Every bar has four beats divided evenly among its entries; empty bars contain no chords. The metronome ticks on each beat with a stronger first beat; turn it off with the Metronome toggle. Playback highlights its position separately from your selection. Unfinished invalid text stays in the editor until you fix or discard it; the last valid chart stays saved. Play your reference recording separately.

Select a bar and press **Record melody** for a four-beat count-in, then play the on-screen keyboard. Choose **½×** recording speed to hear the count-in and backing at half tempo; normal playback keeps the chart’s BPM and pitch. Touch multiple keys to play together; octave controls change its range. **Stop recording** replaces the melody in every covered bar, including silence, and **Undo take** restores the previous take. Timing is unquantized. A green top edge marks bars containing melody; playback layers a flute-like sound over the piano chords. Leaving the page or switching away saves a started take; stopping during the count-in leaves the melody unchanged.

Transcriptions save in this browser. Export/import JSON backups to keep or transfer your work; imports add copies without replacing existing charts.

## Quizzes

The quiz hub groups practice exercises by category. Start with **[Picardy Thirds](https://vanarana.ljh.me/#quizzes/ear-training/picardy-thirds)** under Ear training: listen to eight short piano and orchestral examples and distinguish a minor-tonic ending from a Picardy third.

Replay or seek within an example, review explanations for missed answers, check your score, and practice just the questions you missed. Correct answers advance immediately; missed answers stay open for review. Enable **Autoplay next** to play each next example automatically (off by default). New rounds are shuffled by default. Keyboard shortcuts support playback, answers, and advancing through the quiz.

## Your data and audio

No account is required. Chord edits are stored locally in your browser and do not sync between devices; quiz scores reset when you refresh. Quiz and transcription audio use self-hosted instrument samples; transcription uses the bundled piano. Held chords sustain without a new attack and decay naturally. No third-party audio service is used.

Instrument samples are derived from CC0 libraries by Versilian Studios and contributors. See [sample credits and provenance](public/audio/instruments/ATTRIBUTION.md).

For local setup, checks, and maintenance notes, see [DEVELOPMENT.md](DEVELOPMENT.md).
