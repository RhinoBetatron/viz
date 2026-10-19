# viz

A command-line tool that turns audio files into audio-reactive videos for Instagram Reels, feed posts and YouTube.

- **Styles:** `bars`, `radial`, `wave`, `particles`, `occult`, `industrial`, `vines`. Each has its own settings (`-P key=value`).
- **Scenes:** blend between styles at chosen times, or let `--auto` / `--analyze` find the intro, drops and breakdowns.
- **Formats:** 9:16 Reel, 4:5 feed, 1:1 square and 16:9 landscape. Output is H.264 + AAC, ready for Instagram.
- **Extras:** palettes, cover art, title text, grayscale mode and film grain.

## Gallery

All rendered from the same track at default settings, square format. The last one is a scene change: vines flashing into occult right on the drop.

| <img src="docs/gifs/bars.gif" width="200" alt="bars"> | <img src="docs/gifs/radial.gif" width="200" alt="radial"> | <img src="docs/gifs/wave.gif" width="200" alt="wave"> | <img src="docs/gifs/particles.gif" width="200" alt="particles"> |
|:---:|:---:|:---:|:---:|
| `-s bars` | `-s radial` | `-s wave` | `-s particles` |
| <img src="docs/gifs/occult.gif" width="200" alt="occult"> | <img src="docs/gifs/industrial.gif" width="200" alt="industrial"> | <img src="docs/gifs/vines.gif" width="200" alt="vines"> | <img src="docs/gifs/scene.gif" width="200" alt="scene"> |
| `-s occult -P symbol=cycle` | `-s industrial` | `-s vines` | `--scene …=occult,transition=flash` |

## Contents

- [Gallery](#gallery)
- [Installation](#installation)
- [Usage](#usage)
- [Ready-made commands](#ready-made-commands)
- [Every option](#every-option)
- [Styles and their --param settings](#styles-and-their---param-settings)
- [Scenes: blending between styles](#scenes-blending-between-styles)
- [Automatic sections: --analyze / --auto](#automatic-sections---analyze----auto)
- [Recipes](#recipes)
- [Instagram tips](#instagram-tips)
- [Adding your own style](#adding-your-own-style)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)

## Installation

### 1. Requirements

| | |
|---|---|
| **Node.js 20 or newer** | Check with `node --version`. Install with [nvm](https://github.com/nvm-sh/nvm) (`nvm install --lts`) or `brew install node` |
| **ffmpeg** | Decodes the audio and encodes the video. `brew install ffmpeg` (Linux: `sudo apt install ffmpeg`) |
| **git** | To download the code. Comes with the Xcode command line tools on macOS |

Made and tested on macOS. Linux and Windows should work as long as `ffmpeg` is on your `PATH`, but `--open` only works on macOS.

### 2. Download and install

```bash
git clone https://github.com/RhinoBetatron/viz.git
cd viz
npm install      # installs the three dependencies (commander, fft.js, skia-canvas)
npm link         # makes the `viz` command available in every folder
```

The repo is private, so cloning asks you to log in to GitHub. If you have the GitHub CLI, `gh repo clone RhinoBetatron/viz` works too.

### 3. Check it works

```bash
viz --version        # → 0.1.0
viz --list-styles    # every style and its settings
```

### Updating

```bash
cd viz
git pull
npm install          # only needed if dependencies changed
```

Because `npm link` points at this folder, any changes (yours or pulled) take effect right away. You don't need to reinstall.

### Uninstalling

```bash
npm unlink -g viz    # removes the global command
```

Then delete the folder.

### Install gotchas

- **Moved the folder?** Run `npm link` again from the new location.
- **Using nvm?** The link only exists for the Node version that was active when you ran `npm link`. If `viz` says `command not found` after switching Node versions, run `npm install && npm link` in the folder again.
- **No global install wanted?** Run it in place with `node bin/viz.js track.wav …`.

---

## Usage

```
viz <audio file or folder> [options]
```

Give it a `.wav`, `.aiff`, `.flac`, `.mp3` or `.m4a` file. You get an MP4 next to it, named `<track>_<style>.mp4`. By default that's a 15-second, 9:16 Reel from the start of the track.

```bash
viz track.wav                         # 15s "bars" Reel from the start of the track
viz track.wav -s vines --open         # another style, and open the video when done
viz track.wav -s radial -c cover.jpg  # circular spectrum around your cover art
```

### A typical workflow

1. **Pick the moment.** Choose where the teaser starts and how long it runs. Starting just before the drop works well for Instagram:
   ```bash
   viz track.wav --start 1:05 -d 20
   ```
2. **Pick a look.** Choose a style (`-s`), a palette (`-p`) and optionally cover art (`-c`) and text (`-t`, `--subtitle`). Run `viz --list-styles` and `viz --list-palettes` to see what's available.
3. **Preview fast.** Add `--preview` to render a quick half-resolution draft. Without scene changes it's capped at 5s.
   ```bash
   viz track.wav --start 1:05 -d 20 -s occult -p candle --preview --open
   ```
4. **Tweak the style.** Pass settings with `-P key=value`, repeating it for more than one:
   ```bash
   viz track.wav -s occult -P symbol=eye -P spin=0.06 --preview --open
   ```
5. **Render the real thing.** Drop `--preview`. Use `-f feed` (4:5) or `-f square` for feed posts, and `-f landscape` for YouTube.
6. **Upload.** AirDrop the MP4 to your phone and post it.

### Switching styles during a video

- **By hand:** `--scene <time>=<style>` changes the style at a point in the track:
  ```bash
  viz track.wav --start 0:45 -d 30 -s wave --scene 1:05=industrial,transition=flash
  ```
- **Automatically:** `--analyze` finds the intro, drops and breakdowns and prints a command for them. `--auto` renders the whole track with styles switching on their own:
  ```bash
  viz track.wav --analyze
  viz track.wav --auto vines,occult --open
  ```

### Many tracks at once

Give it a folder instead of a file to render every audio file in it with the same settings:

```bash
viz ./teasers -s radial -p sunset -d 15
```

Everything below is the full reference: ready-made commands, every option and every style setting.

---

## Ready-made commands

Copy, replace `TRACK.wav` (and `COVER.jpg` where used) and run. All of them make a Reel and open it when done.

- **Change where the clip starts:** add or change `--start 1:12` (default is the beginning of the track).
- **Change the length:** `-d 20`.
- **Scene times written as `+12`** are seconds into the clip, so they move with `--start`. Put the `--start` about 10–15s before the drop, and the switch lands on it.
- **Try it fast first:** add `--preview` to any command.
- **Other formats:** add `-f feed` (4:5) or `-f square` to any command.

### Single style

```bash
# Clean & simple: neon spectrum bars, 15s
viz TRACK.wav -s bars --open

# Release teaser: cover art in the middle, colours pulled from the artwork
viz TRACK.wav -s radial -c COVER.jpg -p auto -t "NEW SINGLE" --subtitle "OUT NOW" -d 20 --open

# Dark & minimal: single grainy black & white waveform
viz TRACK.wav -g -s wave -P lines=1 -P trail=0.7 --grain 14 -d 20 --open

# Ember storm: particles exploding on every hit
viz TRACK.wav -s particles -p ember -P burst=140 -d 15 --open

# Ritual: occult sigil that changes every 8 kicks
viz TRACK.wav -s occult -P symbol=cycle --grain 10 -d 20 --open

# Candlelit: amber occult circle, triple moon
viz TRACK.wav -s occult -p candle -P symbol=triplemoon -P floaters=24 -d 20 --open

# Factory floor: amber machine room with a strobe on hard kicks
viz TRACK.wav -s industrial -P strobe=0.5 -d 20 --open

# Cold machine: blue steel industrial, no HUD, heavier sparks
viz TRACK.wav -s industrial -p steel -P hud=0 -P sparks=2 -d 20 --open

# Overgrown: saturated green vines wrapping into a wreath
viz TRACK.wav -s vines -d 20 --open

# Thorned: darker, thornier vines, no fireflies
viz TRACK.wav -s vines -P thorns=1.5 -P spores=0 -P leaves=0.7 -d 20 --open
```

### Scene chains (calm intro → intense)

```bash
# Build → drop: calm steel waveform, flash into the machine room 12s in
viz TRACK.wav -d 25 -s wave -p steel \
  --scene +12=industrial/steel,transition=flash --open

# Smoke → machine: soft particles crossfade into industrial
viz TRACK.wav -d 25 -s particles -p ember \
  --scene +10=industrial,blend=3 --open

# Summoning: quiet occult circle, dip to black, then the gears kick in
viz TRACK.wav -d 30 -s occult -P spin=0.015 \
  --scene +15=industrial,transition=black --open

# Machine → ritual: industrial verse, flash into a cycling occult sigil
viz TRACK.wav -d 30 -s industrial \
  --scene +15=occult,transition=flash,symbol=cycle,cycle=4 --open

# The full journey (45s): wave intro → industrial drop → occult outro
viz TRACK.wav -d 45 -s wave -p steel \
  --scene +12=industrial/steel,transition=flash \
  --scene +32=occult/blood,transition=black,blend=3 --open

# Gloom trilogy, all black & white: particles → occult → industrial
viz TRACK.wav -g --grain 16 -d 40 -s particles \
  --scene +10=occult,blend=3 \
  --scene +25=industrial,transition=flash,strobe=0.6 --open

# Cover-art teaser that turns heavy: radial with title → industrial drop
viz TRACK.wav -c COVER.jpg -t "NEW SINGLE" --subtitle "OUT FRIDAY" -d 25 -s radial \
  --scene +12=industrial,transition=flash --open

# Overgrowth → ritual: vines creep in, dip to black into a blood-red sigil
viz TRACK.wav -d 30 -s vines \
  --scene +15=occult,transition=black --open

# Jungle machine: vines intro, flash into a green-tinted machine room
viz TRACK.wav -d 25 -s vines \
  --scene +12=industrial/verdant,transition=flash --open

# Beat-cut montage: hard cuts between styles every 4 seconds
viz TRACK.wav -d 20 --transition cut -s bars \
  --scene +4=occult --scene +8=industrial --scene +12=particles --scene +16=wave --open
```

### Automatic sections (let viz find the drops)

```bash
# Just look: print the sections and a ready --scene command to copy & tweak
viz TRACK.wav --analyze

# Whole track, vines for calm parts, occult on every drop
viz TRACK.wav --auto --open

# Same, other looks: calm,drop[,build]. Each can carry a palette
viz TRACK.wav --auto wave/steel,industrial --open
viz TRACK.wav --auto vines,occult,particles/ember --open
viz TRACK.wav -g --auto particles,industrial --open

# A 30s teaser around the first drop, styles switching where the music does
viz TRACK.wav --auto --start 1:00 -d 30 --open
```

### Batch & long-form

```bash
# Full track, 4 sections: intro (vines) → drop A (occult) → breakdown (vines) → drop B (occult)
# Replace the three times with where drop A, the breakdown and drop B start in your track.
viz TRACK.wav -d all -s vines -P pregrow=0 \
  --scene 1:00=occult,transition=flash,symbol=cycle,cycle=4 \
  --scene 2:00=vines,transition=black,blend=3,pregrow=4,growth=0.6,branch=1 \
  --scene 2:45=occult,transition=flash,symbol=inverted,floaters=30,spin=0.06 --open

# Every track in a folder, same look (run from the folder's parent)
viz FOLDER -s radial -p sunset -d 15

# Full track for YouTube, black & white, wave → industrial halfway (change 2:00)
viz TRACK.wav -f landscape -d all -g -s wave --scene 2:00=industrial,blend=4
```

---

## Every option

| Option | What it does | Default |
|---|---|---|
| `-s, --style <name>` | Visual style: `bars`, `radial`, `wave`, `particles`, `occult`, `industrial`, `vines` | `bars` |
| `-o, --output <file>` | Output path | `<input>_<style>.mp4` |
| `-f, --format <name>` | `reel` 1080×1920 · `feed` 1080×1350 · `square` 1080×1080 · `landscape` 1920×1080 | `reel` |
| `--size <WxH>` | Custom resolution, e.g. `720x1280` (overrides `--format`) | |
| `--start <time>` | Where the clip starts: `72`, `1:12`, `1:12.5` | `0` |
| `-d, --duration <time>` | Clip length: `20`, `0:30`, or `all` for the rest of the track | `15` |
| `--end <time>` | Where the clip ends (use instead of `--duration`) | |
| `-p, --palette <name>` | `neon` `sunset` `ice` `acid` `mono` `vapor` `ember` `gloom` `blood` `candle` `hazard` `steel` `verdant` `auto` | `neon` (`auto` with `--cover`, `gloom` with `-g`, `blood` for `occult`, `hazard` for `industrial`, `verdant` for `vines`) |
| `-g, --grayscale` | Black & white, darker and higher contrast, with light film grain. Applies to everything, cover art included | off |
| `--grain <n>` | Film grain, 0–30. Works with colour too | `10` with `-g`, else `0` |
| `-c, --cover <image>` | Cover art: blurred background, plus the centre of `radial` | |
| `--bg <mode>` | `gradient`, `cover`, `black` | `cover` if `--cover` is set, else `gradient` |
| `-t, --title <text>` | Big title text | |
| `--subtitle <text>` | Smaller spaced-out text under the title | |
| `--font <family>` | Font for the title and subtitle (any installed font) | Helvetica Neue |
| `-P, --param <k=v>` | Tweak a style setting (repeatable), see below | |
| `--scene <time=style…>` | Switch to another style at a point in the track (repeatable), see [Scenes](#scenes-blending-between-styles) | |
| `--blend <sec>` | How long scene transitions take | `2` (`0.8` for flash) |
| `--analyze` | Find the track's sections (intro, drop, breakdown, build, outro) and print a `--scene` command for them. Doesn't render. See [Automatic sections](#automatic-sections---analyze----auto) | |
| `--auto [calm,drop[,build]]` | Render with styles switching at the detected sections. Whole track unless `-d`/`--end` is given | `vines,occult` |
| `--transition <type>` | `fade` (crossfade), `black` (dip to black), `flash` (white flash cut), `cut` | `fade` |
| `--fps <n>` | Frame rate (`60` = smoother, takes twice as long) | `30` |
| `--crf <n>` | Quality: 16 = near-lossless, 23 = smaller file | `18` |
| `--seed <n>` | Changes the randomness in `particles` | `1` |
| `--no-fade` | No fade in/out on picture and sound | fades on |
| `--preview` | Quick half-res 5s draft (`*_preview.mp4`) to check the look. With `--scene` it keeps the full length so you can see the changes | |
| `--gpu` | Render on the GPU (try it if heavy styles feel slow) | off |
| `--open` | Open the video when it's done | |
| `--list-styles` | Show every style and its `--param` settings | |
| `--list-palettes` | Show the palettes as colour swatches | |
| `-h, --help` | Help | |

**Folder input** renders every audio file in the folder with the same settings:
`viz ./teasers -s wave -p ice`

---

## Styles and their `--param` settings

Pass any of these with `-P key=value`. You can repeat it: `-P bars=64 -P glow=2`.

### `bars`: mirrored spectrum bars

<img src="docs/gifs/bars.gif" width="260" alt="bars style">
| param | default | |
|---|---|---|
| `bars` | 48 | Bars per side |
| `gap` | 0.35 | Gap between bars (fraction of bar width) |
| `height` | 0.3 | Max height (fraction of screen height) |
| `width` | 0.9 | Total width (fraction of screen width) |
| `mirror` | 1 | 1 = bass in the centre, 0 = bass on the left |
| `reflect` | 1 | 1 = grow up and down, 0 = up only |
| `glow` | 1 | Glow strength, 0 = off |

### `radial`: circular spectrum around the cover

<img src="docs/gifs/radial.gif" width="260" alt="radial style">
| param | default | |
|---|---|---|
| `bars` | 90 | Bars per half circle |
| `radius` | 0.23 | Inner circle size |
| `length` | 0.17 | Max bar length |
| `thickness` | 0.5 | Bar thickness |
| `spin` | 0.08 | Turns per second, 0 = still |
| `glow` | 1 | Glow strength |
| `ring` | 1 | Outer loudness ring, 0 = hide |

### `wave`: neon oscilloscope with trails

<img src="docs/gifs/wave.gif" width="260" alt="wave style">
| param | default | |
|---|---|---|
| `amp` | 0.22 | Wave height |
| `lines` | 3 | Colour-split copies (1 = single clean line) |
| `split` | 10 | Spacing between copies (widens on bass) |
| `thickness` | 5 | Line width |
| `trail` | 0.8 | Trail length, 0 = none, 0.95 = long smear |
| `points` | 240 | Line detail (lower = smoother/wobblier) |
| `shape` | line | `line` or `circle` |
| `radius` | 0.28 | Circle size when `shape=circle` |

### `particles`: bursts on every hit

<img src="docs/gifs/particles.gif" width="260" alt="particles style">
| param | default | |
|---|---|---|
| `burst` | 90 | Particles per hit |
| `ambient` | 3 | Constant trickle (scaled by loudness) |
| `speed` | 14 | Burst speed |
| `drag` | 0.955 | Slow-down (1 = never slows) |
| `swirl` | 1 | How much the mids spin them |
| `size` | 3.5 | Particle size |
| `life` | 2.2 | Seconds each particle lives |
| `orb` | 1 | Centre orb, 0 = hide |
| `max` | 3000 | Particle cap |

### `occult`: sigil in a rune circle

<img src="docs/gifs/occult.gif" width="260" alt="occult style">
A glowing symbol in the centre of a rotating magic circle. The 24 Elder Futhark runes light up with their slice of the spectrum, spectrum ticks point inward, and alchemical symbols drift in the dark and flare on hits. Uses the `blood` palette unless you pass `-p` (or `-g`).

| param | default | |
|---|---|---|
| `symbol` | pentagram | `pentagram` `inverted` `hexagram` `heptagram` `octagram` `eye` `leviathan` `triplemoon` `cycle` |
| `cycle` | 8 | With `symbol=cycle`: kicks between symbol changes |
| `scale` | 1 | Size of the whole circle |
| `spin` | 0.03 | Rotation speed (turns per second) |
| `runes` | 1 | Rune ring, 0 = hide |
| `ticks` | 96 | Spectrum ticks, 0 = hide |
| `floaters` | 16 | Background symbols, 0 = hide |
| `glow` | 1 | Glow strength |
| `echo` | 1 | Expanding ghost of the symbol on each kick, 0 = off |
| `flicker` | 1 | Candle flicker, 0 = steady |

### `industrial`: machine room

<img src="docs/gifs/industrial.gif" width="260" alt="industrial style">
A big gear meshed with two smaller ones. It turns with the loudness and ratchets forward one tooth on every kick, throwing sparks where the teeth meet. Inside it sits a segmented LED spectrum meter. Above it, hydraulic pistons pump with the frequency bands. Around it: scrolling hazard stripes, a blueprint grid, scanlines, a camera jolt on kicks, and a monospace HUD (RPM, load, PSI, dominant frequency, timecode, `STATUS IMPACT`). Uses the `hazard` palette unless you pass `-p` (or `-g`).

| param | default | |
|---|---|---|
| `scale` | 1 | Size of the gear assembly |
| `speed` | 0.06 | Gear rotation (turns per second, scaled by loudness) |
| `ratchet` | 1 | Teeth the gear jumps per kick, 0 = smooth spin |
| `pistons` | auto | `auto` = only in tall formats (reel), `1` = always, `0` = off |
| `meter` | 1 | LED meter inside the gear, 0 = off |
| `sparks` | 1 | Amount of sparks on kicks, 0 = off |
| `shake` | 1 | Camera jolt on kicks, 0 = steady |
| `stripes` | 1 | Hazard stripe bands, 0 = off |
| `hud` | 1 | Readouts, 0 = off |
| `scanlines` | 1 | CRT scanlines, 0 = off |
| `strobe` | 0 | White flash on hard kicks (0–1) |

### `vines`: entangling overgrowth

<img src="docs/gifs/vines.gif" width="260" alt="vines style">
Deep green vines creep in from the edges and wind around the centre in opposite directions, weaving over and under each other into a living wreath. They grow faster when the track gets louder. Every kick sprouts side shoots and spiralling tendrils. Leaves swell with their own slice of the spectrum, glowing flowers open on transients, and fireflies drift up behind. Three depth layers (dark, mid, bright and glossy) give it depth. When it gets too dense, the oldest vines wither back and new ones creep in. Uses the `verdant` palette unless you pass `-p` (or `-g`).

| param | default | |
|---|---|---|
| `vines` | 7 | Main vines growing at once |
| `growth` | 1 | Growth speed (scaled by loudness) |
| `branch` | 2 | Shoots/tendrils sprouted per kick, 0 = none |
| `curl` | 1 | How tightly the tendrils spiral |
| `weave` | 1 | How much the vines cross in and out, 0 = neat rings |
| `leaves` | 1 | Leaf size, 0 = bare vines |
| `blooms` | 1 | Flowers on transients, 0 = off |
| `spores` | 40 | Fireflies, 0 = off |
| `sway` | 1 | Movement with the mids |
| `thickness` | 1 | Stem thickness |
| `thorns` | 0 | Thorn density (try 1–2) |
| `heart` | 1 | Glow inside the wreath, 0 = off |
| `glow` | 1 | Glow strength |
| `pregrow` | 2 | Seconds of growth already on screen at frame 1, 0 = grow from nothing |
| `max` | 7000 | Density before old vines wither back |

---

## Scenes: blending between styles

Start calm and bring in the heavy stuff later. `-s` is the opening style, and each `--scene` switches to a new style at a **track time** (the same clock as `--start`, not the time into the clip).

```bash
#      opening style    at 1:05 (the drop) blend into industrial
viz track.wav --start 0:45 -d 30 -s wave --scene 1:05=industrial
```

**Scene format:** `time=style[/palette][,key=value,…]`. `time` is a track time (`1:05`) or, with a `+`, seconds into the clip (`+12`), which moves with `--start`.

```bash
--scene 1:05=industrial                         # style only
--scene 1:05=industrial/steel                   # with its own palette
--scene 1:05=industrial,ratchet=2,sparks=2      # with its own -P settings
--scene 1:05=occult,transition=flash            # its own transition…
--scene 1:05=occult,transition=fade,blend=4     # …and blend length
```

**Transitions** (`--transition` sets the default, `transition=` overrides it per scene):

| type | what happens | good for |
|---|---|---|
| `fade` | Crossfade, both styles visible mid-blend | Intro → verse, gentle builds |
| `black` | Old style fades to black, new one fades in | Section changes, breakdowns |
| `flash` | Hard cut with a white flash that decays (0.8s) | Drops |
| `cut` | Instant switch | Hard edits on a beat |

**How it works:**
- A transition **starts** at the scene time and lasts `--blend` seconds. For a crossfade to be fully in *at* the drop, set the scene a little earlier. To hit exactly on the drop, use `flash` or `cut`.
- `-p` and `-P` apply to every scene unless the scene sets its own. Without `-p`, each style uses its own default palette (`occult` → blood, `industrial` → hazard, `vines` → verdant).
- `-g`, `--grain`, `--cover`, `--title` and fades apply to the whole video.
- Each scene keeps its own state, so the gears keep their position, and the same style can come back later.
- The default filename lists the styles: `track_wave-industrial-occult.mp4`.

```bash
# Calm intro → machine room on the drop → occult outro
viz track.wav --start 0:30 -d 60 -s wave -p steel \
  --scene 1:05=industrial,transition=flash \
  --scene 1:20=occult,transition=black,blend=2

# All black & white: gentle particles into an industrial drop
viz track.wav -g --start 0:50 -d 25 -s particles --scene 1:02=industrial,transition=flash

# Quick check of the whole timeline before the real render
viz track.wav --start 0:45 -d 30 -s wave --scene 1:05=industrial --preview --open
```

---

## Automatic sections: `--analyze` / `--auto`

viz can listen to the whole track and work out where its sections are, so you don't have to find the drop times yourself.

```
$ viz track.wav --analyze
  3:37.8 · 124.0 BPM

    start    length  energy      section
     0:00.0   16.0s  █·······  intro
     0:16.0   15.5s  ██████··  intro
     0:31.4   61.9s  ████████  drop
     1:33.4   31.0s  ········  breakdown
     2:04.3   15.5s  ███·····  build
     2:19.8   61.9s  ████████  drop
     3:21.8    7.7s  █·······  outro
     3:29.5    8.3s  █████···  outro

viz track.wav -d all -s vines \
  --scene 0:31.4=occult,transition=flash \
  --scene 1:33.4=vines,transition=fade,blend=3 \
  --scene 2:19.8=occult,transition=flash \
  --scene 3:21.8=vines,transition=fade,blend=3
```

**How it works:** it finds the tempo and beat grid, compares how every beat sounds (loudness, bass, mids, highs, spectrum shape, how busy it is) and marks the points where the music before and after stops sounding alike. Those points are snapped to bar lines. Each section is then rated by energy and labelled:

| label | means | `--auto` style |
|---|---|---|
| `intro` | before the first drop | calm |
| `drop` | the loudest sections | drop |
| `breakdown` | quiet parts between drops | calm |
| `build` | energy climbing into a drop | build (calm if not given) |
| `groove` | medium energy between drops | build (calm if not given) |
| `outro` | after the last drop | calm |

**`--auto calm,drop[,build]`** renders it directly. The default is `vines,occult`. Each style can carry a palette (`wave/steel`). Drops come in with a `flash`, and everything else crossfades (3s, or 2s into a build). Set `--transition` or `--blend` to override that. `-P` settings apply to every scene. Neighbouring sections that get the same style just carry on, so there's no transition between them.

**Tips:**
- Use `--analyze` first. The printed command is a good starting point: copy it, adjust a time, or add per-scene settings (`symbol=inverted`, `pregrow=0`…).
- With `--start`/`-d`, `--auto` only uses the changes inside that window, and opens on the style for whatever section the clip starts in.
- It works best on music with a clear beat and contrast between sections (most electronic music). Ambient tracks or tracks that stay at one level may come out as one long section. Then use `--scene` by hand.
- Works on folders too: `viz FOLDER --auto` analyses each track separately.

---

## Recipes

```bash
# Check the look fast, then do the real render
viz track.wav -s radial -c art.jpg --start 1:05 --preview --open
viz track.wav -s radial -c art.jpg --start 1:05 -d 20 --open

# Release teaser with text
viz track.wav -s radial -c art.jpg -t "NEW SINGLE" --subtitle "OUT FRIDAY" --start 1:05 -d 20

# The drop, from 2:14 to 2:44
viz track.wav -s particles -p ember --start 2:14 --end 2:44

# Dark, gloomy black & white
viz track.wav -g -s radial -c art.jpg -t "NEW SINGLE"
viz track.wav -g -s particles --grain 20          # extra grainy
viz track.wav -g -p ember -s bars                  # any palette works, it's just converted to grey

# Occult mode
viz track.wav -s occult                                    # red pentagram (blood palette)
viz track.wav -s occult -g --grain 18                      # black & white, grainy
viz track.wav -s occult -p candle -P symbol=triplemoon     # amber candlelight
viz track.wav -s occult -P symbol=cycle -P cycle=4         # new symbol every 4 kicks
viz track.wav -s occult -P symbol=eye -P floaters=30 -P spin=0.06

# Industrial mode
viz track.wav -s industrial                                # amber hazard machine room
viz track.wav -s industrial -p steel                       # cold blue steel
viz track.wav -s industrial -g --grain 15 -P strobe=1      # b&w factory floor with strobe
viz track.wav -s industrial -P ratchet=2 -P sparks=2 -P shake=2   # heavier, more violent
viz track.wav -s industrial -P hud=0 -P stripes=0 -P scanlines=0  # just the machinery

# Vines
viz track.wav -s vines                                     # saturated green overgrowth
viz track.wav -s vines -P pregrow=0 -P growth=1.5          # starts empty, grows in fast
viz track.wav -s vines -P thorns=2 -p blood                # blood-red thorned vines
viz track.wav -s vines -P branch=4 -P vines=10 -P max=10000   # dense jungle
viz track.wav -s vines -g --grain 12                       # b&w dead garden

# Colour, but with a film-grain texture
viz track.wav -s wave -p sunset --grain 12

# Clean minimal waveform
viz track.wav -s wave -p mono -P lines=1 -P trail=0.6 --bg black

# Circular waveform around the middle
viz track.wav -s wave -p vapor -P shape=circle -P amp=0.4

# Chunky bars, bass on the left, up only
viz track.wav -s bars -P bars=24 -P gap=0.2 -P mirror=0 -P reflect=0 -P height=0.4

# Big particle explosions
viz track.wav -s particles -P burst=200 -P speed=22 -P life=3

# Square grid post with colours pulled from the artwork
viz track.wav -f square -s bars -c art.jpg -p auto

# Every teaser in a folder, same look
viz ./teasers -s radial -p sunset -d 15

# Full track for YouTube
viz track.wav -f landscape -d all -s bars
```

---

## Instagram tips

- **Reels / Stories:** `-f reel` (default). Keep text and visuals out of the bottom ~25%, where Instagram puts captions and buttons. The layout already handles this.
- **Feed post:** `-f feed` (4:5) takes up the most room in the feed. Use `-f square` for a tidy grid.
- **Length:** 15–30s works best for teasers. Start just before the hook or drop so it lands within the first 3 seconds.
- Output is H.264 + AAC 320k, 30fps, `yuv420p`, BT.709, faststart. That's what Instagram expects, so it isn't heavily re-compressed.
- AirDrop the MP4 to your phone and upload from there.

---

## Adding your own style

Drop a file in `src/styles/`. It shows up in `--style` and `--list-styles` automatically.

```js
// src/styles/mystyle.js
export default {
  name: 'mystyle',
  description: 'What it looks like',
  params: { size: 1 },                  // become -P size=2 etc.
  palette: 'blood',                     // optional default palette when no -p is given

  setup(ctx, env) {},                   // optional, runs once before frame 1

  draw(ctx, frame, env) {
    // Standard Canvas 2D API (ctx.arc, gradients, shadowBlur, …)
    const { width, height, cx, cy, u, palette, params, cover, random } = env;
    ctx.fillStyle = palette.colors[0];
    ctx.beginPath();
    ctx.arc(cx, cy, (100 + 200 * frame.bass) * u * params.size, 0, Math.PI * 2);
    ctx.fill();
  },
};
```

**`frame`**: what the audio is doing right now (all values 0–1 unless noted):

| field | |
|---|---|
| `spectrum` | Float32Array(128), smoothed, log-spaced 30 Hz → 16 kHz |
| `waveform` | Float32Array(2048) raw samples, −1 to 1 |
| `bass` / `mid` / `high` | Smoothed band energy |
| `rms` | Loudness |
| `pulse` | Jumps to 1 on each kick, then decays. Use it for punch |
| `onset` / `onsetStrength` | `true` on any transient |
| `kick` / `kickStrength` | `true` on bass hits |
| `time`, `progress`, `index` | Seconds into the clip, 0–1 through the clip, frame number |

**`env`**: `width`, `height`, `cx`/`cy` (visual centre, already safe for Reels), `u` (1 unit = 1px at 1080p, so multiply sizes by it), `palette` (`bg`, `colors`, `accent`, `text`), `params`, `cover` (image or null), `random()` (seeded), `fps`, `duration`, `createCanvas(w, h)`.

Vector symbols (runes, alchemical sigils, star polygons, `addGlyph`) are in `src/glyphs.js`. Helpers in `src/util.js`: `sampleSpectrum`, `sampleWaveform`, `drawCover`, `rng`, `lerp`, `clamp`, `flatten`. Colour helpers in `src/palettes.js`: `rgba(hex, alpha)`, `mix(a, b, t)`, `rampAt(colors, t)`.

> **Performance gotchas:** If you draw on an offscreen canvas across frames (trails, feedback), call `flatten(canvas)` each frame, or rendering gets slower every frame. Also reset `ctx.shadowBlur = 0` before big fills, because a shadow on a full-screen rect is very expensive.

**Adding a palette:** add an entry to `src/palettes.js`.

---

## Project layout

```
bin/viz.js          CLI: options, batch mode, progress bar
src/audio.js        ffmpeg decode → FFT, bands, loudness, onset/kick detection per frame
src/structure.js    section finder for --analyze / --auto (tempo, novelty, energy labels)
src/render.js       frame loop: background → style → text → fades → ffmpeg
src/palettes.js     colour palettes + auto palette from cover art
src/util.js         helpers for styles
src/glyphs.js       runes, occult/alchemical symbols as vector paths
src/styles/*.js     one file per style
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `Could not run ffmpeg` | `brew install ffmpeg` |
| `viz: command not found` | Run `npm link` in this folder, or use `node bin/viz.js …` |
| `No audio found … at --start` | The start time is past the end of the track |
| Visuals feel sluggish or jumpy | Try `--fps 60`, or tweak the style's `glow`/`trail`/`drag` params |
| Render is slow | Use `--preview` while experimenting. Try `--gpu` |
| Title is cut off or the wrong font | `--font "Futura"` (any font installed on your Mac) |
