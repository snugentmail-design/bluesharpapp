# bluesharpapp

Two stage tools in one React app. Pick between them with the tabs at the top.

## Jam Fiddle

Listens to a piano through the microphone, works out the chord progression, and
writes a violin part to play over it. Built to be usable mid-jam: big type, big
targets, and nothing you have to read twice.

### What it does

- **Hears the chords.** The microphone feeds an FFT, the spectrum is folded into
  a pitch class profile with harmonic voting, and that is matched against chord
  templates. The bass register is analysed separately, because a seventh chord
  and the triad a third above it share three notes and only the bass note tells
  them apart. A chord has to hold steady for about a quarter of a second before
  it counts, so passing notes do not land in the chart.
- **Two listening modes.** *Capture chords* writes what it hears into the
  progression. *Follow along* leaves the progression alone and moves the big
  display to whichever bar matches what the piano is playing right now.
- **Writes a part.** Pick a difficulty and a kind of part, and every bar gets
  notes, fingerings and a one-line reminder of what to do.
- **Shows it two ways.** A pattern grid of note names and fingerings for
  playing from, and real staff notation for reading from. Both print, and the
  part exports as MusicXML for MuseScore, Sibelius or Finale.
- **Plays it back**, with the chords and a click if you want them, so you can
  hear the line before you try it.

### Difficulty

| Level | What you get |
| --- | --- |
| Simple | Whole and half notes, chord tones only, first position |
| Intermediate | Eighths, passing tones, guide tones, some double stops |
| Advanced | Sixteenths, extensions, chromatic approach notes, position shifts |

### Kinds of part

- **Long tones** — held chord tones under the piano. The safest thing to play.
- **Arpeggio** — broken chords that spell the harmony as it moves.
- **Counter-melody** — a singing line, voice-led into each chord change.
- **Cross-melody** — call and response, off the beat, playing in the gaps.
- **Drone & double stops** — an open string under the tune, fiddle style.
- **Pizz / chop groove** — percussive off-beat stabs to hold the groove.

Options cover double stops, staying in first position, swung eighths, 3/4, 4/4
or 6/4, and overriding the inferred key.

### Things worth knowing

- Chord detection needs a reasonably clean signal. In a loud room, or against a
  guitar and drums, it will make mistakes. Type the changes in instead, or pick
  a preset, and use *Follow along* so the app tracks rather than guesses.
- Inversions and slash chords are read as the plain chord. Extended chords
  (13ths, altered dominants) are mapped to the nearest quality the generator
  models rather than being dropped.
- Fingerings assume standard G–D–A–E tuning. With *First position only* off,
  the part may shift as far as seventh position.
- The generated part is deterministic: the same settings give the same notes.
  Reroll for a different take on the same bars.

## Harp Gig-Tool

The original harmonica setlist helper: paste a setlist, get the harp key for
first and second position, with capo and shape handling.

## Running it

```
npm install
npm start        # development server on http://localhost:3000
npm test         # music theory, part generation and chord detection tests
npm run build    # production build
```

## Putting it on the web

`.github/workflows/deploy.yml` builds the app, runs the tests, and publishes it
to GitHub Pages on every push to `main` or to the Jam Fiddle branch.

It needs Pages switched on once by hand: **Settings → Pages → Build and
deployment → Source: GitHub Actions**. Until that is done the deploy fails at
the `configure-pages` step saying Pages is not enabled. The action can create
the site itself through its `enablement` input, but the workflow token is not
allowed to, so the setting has to be made by an account with admin rights on
the repository.

The site lands at `https://<owner>.github.io/bluesharpapp/`. Assets are built
with relative paths (`"homepage": "."` in `package.json`), so the same build
works from a subdirectory, from the domain root, or opened through a local
static server.

Hosting matters for the microphone. Browsers hand a page the microphone only in
a secure context, which means HTTPS or `localhost`. Pages is served over HTTPS,
so the published site can listen; a build served from a bare `http://192.168.x.x`
address on the local network cannot.

The app ships a web manifest and an icon, so adding it to a phone's home screen
opens it without browser chrome. That is the way to use it on a music stand.

Note that no lockfile is committed, matching how the repo was set up, so CI
installs with `npm install` rather than `npm ci`. Direct dependencies are pinned
to exact versions in `package.json`; transitive ones can drift between builds.
