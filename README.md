# Personal Accompanist

A piano accompanist for singers who don't play piano. Open your sheet music and it plays your part, the accompaniment, or both, in any key and at any speed, with the notes and lyrics on screen as you sing.

Built with **React 18** and **Vite**, with VexFlow for music engraving and Tone.js for audio.

## Features

- **Open any score:** MusicXML (`.musicxml`, `.xml`, `.mxl`) from MuseScore, Finale, Sibelius or Dorico; PDFs and photos (JPG, PNG, WebP, HEIC…) in staff or numbered (jianpu) notation, read by Claude (see *Running it*).
- **Choose what plays:** the singer's line, the accompaniment, or both, each with its own volume.
- **Your key and speed:** transpose by semitones (the written music changes key too); tempo from 25% to 200%.
- **Follow along:** professional engraving with every verse and language of the lyrics stacked under the right notes; a moving playhead; notes and words light up as they play; page turns happen early so the next line is always visible.
- **Start anywhere:** click any note, before or during playback.
- **Edit notes visually:** in Edit mode, click a note and drag it up or down to change its pitch (you hear each note as you drag). A formatting toolbar, like a word processor's, sets sharp/flat/natural, note length, dots, rests, ties, articulations, dynamics and lyrics, with undo/redo and keyboard shortcuts. A text editor is there for bigger changes.
- **A natural-sounding piano:** a sampled Yamaha concert grand at four dynamic levels in a concert-hall reverb, with pedalling, voicing and phrasing (or strict rhythm if you prefer).
- **Practice tools:** count-in, metronome, lyric position, music size, keyboard shortcuts.

## Running it

```bash
npm install
npm run dev        # development server at http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build
```

**Publish to GitHub Pages:** push to `main`, then in the repo's Settings → Pages choose **Source: GitHub Actions**. The included workflow builds and deploys automatically.

**Two features need Claude.** Reading PDFs and photos, and the saved Library, use capabilities available when the app runs as a Claude artifact. Anywhere else the app shows a message for those two features, and everything else, including MusicXML import, works. To read PDFs on your own site you'd need a small server that calls the Claude API; never put an API key in the page.

## How it's built

The app is split into a **React interface** and a framework-free **music engine**.

```
src/
├── App.jsx                 State for the open score, playback and settings; wires everything together
├── main.jsx                Entry point
├── styles.css              Design tokens (light and dark themes) and component styles
├── components/
│   ├── AppBar.jsx          Title bar and main actions
│   ├── ScoreView.jsx       The sheet music: hosts the engraving and the playhead
│   ├── Sidebar.jsx         What plays (parts) and practice options
│   ├── Transport.jsx       Play controls, position, tempo and key
│   ├── ImportDialog.jsx    Open MusicXML, PDFs and photos; page-by-page reading with Stop and Retry
│   ├── LibraryDialog.jsx   Saved songs (Claude only)
│   ├── EditToolbar.jsx     The editing strip: pitch, accidentals, length, marks, lyrics, undo
│   ├── EditNotesDialog.jsx Edit the whole score as text
│   ├── ShortcutsDialog.jsx Keyboard shortcuts
│   ├── Modal.jsx           Accessible dialog (Escape, focus handling)
│   ├── Controls.jsx        Switch, Segmented and Stepper controls
│   └── Icons.jsx           Inline SVG icons
├── hooks/
│   ├── usePlayer.js        The audio engine and a 60 fps clock components can subscribe to
│   ├── useClaude.js        Detects Claude capabilities (page reading, private storage)
│   ├── useToast.js         Short status messages
│   └── useMediaQuery.js    Responsive layout switches
└── engine/                 Plain JavaScript, no React
    ├── notation.js         Text notation parser
    ├── keys.js             Key signatures and transposition with correct spelling
    ├── timeline.js         Note timing, tempo map (rit., fermatas) and expressive shaping
    ├── engrave.js          VexFlow engraving with collision-free layout bands
    ├── playhead.js         Playhead, note highlighting and page turns
    ├── audio.js            Four-layer sampled piano and the playback scheduler
    ├── musicxml.js         MusicXML import (all lyric lines)
    ├── reader.js           PDF/photo pages → notation via Claude
    └── demo.js             Example score (Amazing Grace, public domain)
```

Design notes:

- **State lives in React.** The open score, key, tempo, parts and display options are React state in `App.jsx`. The transposed, timed score is derived with `useMemo`, so changing the key recomputes it once and every component updates.
- **Fast things bypass re-rendering.** The playhead moves 60 times a second. Instead of storing the position in state, `useClock` lets `ScoreView` and `Transport` subscribe and update only what changed, so the rest of the app doesn't re-render every frame.
- **VexFlow is wrapped, not rewritten.** `ScoreView` gives VexFlow an empty element through a ref and re-engraves in a layout effect when the music, size or lyric options change.
- **Editing goes through one path.** Every visual edit changes a copy of the score, writes it back to text notation and re-reads it. Undo/redo, saving and the text editor all see exactly the same score. Edits made while the song is transposed are applied as intervals, so they land correctly in the original key.
- **Heavy libraries load on demand.** PDF.js and JSZip are only downloaded when you open a file that needs them.

## Your scores

Don't commit copyrighted sheet music, or notes transcribed from it, to this repository. `.gitignore` keeps a `scores/` folder and PDF/MusicXML files out of git. Public-domain music (for example from IMSLP) is fine to include.

## Credits

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The piano is the Salamander Grand Piano by Alexander Holm, CC BY 3.0.

## License

The app's own code is under the MIT License (see [LICENSE](LICENSE)). Libraries and samples keep their own licenses.
