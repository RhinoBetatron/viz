# Changelog

## Unreleased

### New style
- `lilguys`: a crowd of little googly-eyed guys dancing quirky moves on a disco floor under a mirror ball. Each has his own move (bounce, chicken, wave, robot, spin, air guitar, shuffle, jumping jacks, disco, noodle) and his own slice of the spectrum. They hop on the kicks, sync up into a ripple on loud parts, and big hits fire confetti (`party` palette).

## 0.6 (2026-10-26)

### Faster renders
- Encoding is about 2.5× faster: x264 now uses the `veryfast` preset, and the default `--crf` moves from 18 to 16 to keep the same picture quality. Files come out about 25% bigger. Light styles render about a third faster overall.
- **`--hw`** encodes on the Mac's video hardware. It's faster still and leaves the CPU free for drawing, but makes bigger files.
- The whole-track analysis (beat grid and sections) is cached in `~/.cache/viz`. Rendering the same track again starts about 2 seconds sooner, and `--auto`/`--hook` about 3 seconds sooner. A changed track is analysed again.
- The track's beat grid is worked out while the clip is analysed, and the analysis itself is about 30% faster.
- `--ascii` is about 2.5× faster. The character image is built from glyphs drawn once, and the frame it's made from is drawn in the background like any other.

### Sections
- Sections found by `--analyze`, `--auto` and `--hook` are at least 4 bars long, the first and last too. A click or a recorder switching on at the very start no longer becomes a section of its own.
- **`--min-section <bars>`** sets that length.

## 0.5 (2026-10-26)

### SVG mode
- **`--svg logo.svg`** moves a drawing with the music, shape by shape. It picks the drawing's style on its own, or works as a scene (`--scene +8=svg`) next to any other style. `--svg` can be given several times, one style per drawing.
- Presets for any SVG, with no setup:
  - `pump` (the default): each part swells and glows with its own frequency band
  - `explode`: parts fly apart and spin on the kicks
  - `wire`: neon outlines with sparks running round them
  - `glitch`: jumps, red/blue split and flicker
- The parts draw themselves on at the start (`-P intro`). Dark drawings are flipped to light so they show up on the dark background (`-P colors`).
- **`data-viz` attributes** rig a drawing from inside the SVG: `data-viz="rotate: beat*360; glow: high*20"`.
- **Pack files** (`logo.viz.json`) rig a drawing from outside it and turn it into a style of its own. A pack has a name, description and palette, and declares **its own settings** with defaults, limits and descriptions. Those settings show up in `--list-styles` and take `-P` like any built-in setting. Layers are picked with CSS-like selectors (`#id`, `.class`, `"#group path"`). `logo.svg` picks up `logo.viz.json` next to it.
- 20 properties per shape or group:
  - moving: `x`, `y`, `rotate`, `scale`, `sx`, `sy`, `skew`, `origin`
  - look: `opacity`, `fill`, `stroke`, `outline`, `hue`, `glow`, `blur`
  - drawing and breaking apart: `draw`, `trace`, `jitter`, `explode`, `echo`, `split`
- Their values are `-P` expressions, plus per-shape variables: `band`, `i`, `n`, `rand`, `t`.
- `--list-layers` shows what's in a drawing (its groups, its parts and their bands) and everything a pack can set.
- Reads paths, basic shapes, groups and `<use>`, with colours from attributes, `style=""` and `<style>` blocks, and linear and radial gradients. Text, images, masks and clip paths are left out, with a note.
- Works with titles, `--fx`, `-g`, `--ascii`, `--loop`, `--hook`, `--watch` (which also watches the SVG and pack), `--random` and batch files (an `svg` column).
- Demo files: `docs/logo.svg`, plus `docs/demo.svg` with `docs/demo.viz.json`.

### Fixes
- `--random` with a bare `--auto` now picks the styles for the calm parts and the drops. Before, `--auto` always fell back to `vines,occult` and threw the random style away.

## 0.4 (2026-10-22)

### Photo mode
- **`--image photo.jpg`** tears a photo apart in time with the music. It picks the new `photo` style on its own, or works as a scene (`--scene +8=photo`) next to any other style.
- Ten effects, each driven by a different part of the music:
  - `zoom`: punch-in on the kicks
  - `rgb`: channel split
  - `slices`: glitch tears on the hits
  - `wave`: rows rippling with the waveform
  - `mosaic`: pixelation with the bass
  - `sort`: pixel sorting
  - `melt`: drips when it's loud and recovers when it's quiet
  - `shatter`: glass shards on big kicks
  - `burn`: holes with glowing edges that grow for good
  - `invert`: negative flashes
- Presets: `mix` (the default), `glitch`, `melt`, `shatter`, `burn`, `sort` and `clean`. Any effect can be set on its own (`-P burn=2`, `-P rgb=0`) or follow the music with expressions, LFOs and automation.
- The damage builds up through the clip (`-P decay`).
- `-P fit=contain` shows the whole photo. `-P tint` washes it in a palette.
- The palette comes from the photo unless you pass `-p`.
- Works with titles, `--fx`, `-g`, `--ascii`, `--loop`, `--hook` and `--watch`.
  - `--random` picks a preset as well.
  - Batch files can set the photo in an `image` column.
- A demo photo is included: `docs/demo.jpg`.

### New styles
- `rhino`: a rhino at sunset, trotting on the beat and charging on the kicks (`savanna` palette).
- `temple`: a moonlit Greek temple whose column drums split apart on every kick, with light pouring out of the cracks. Doric or ionic columns, and a `ruin` setting (`aegean` palette).
- `medusa`: the gorgon on a bronze shield. Her snakes strike on the kicks, and her gaze turns passing birds to stone on the biggest hits (`gorgon` palette).
- `labyrinth`: the maze from above. Light floods through the corridors, the minotaur charges on the kicks, and Ariadne's thread follows it (`minoan` palette).
- `hydra`: a serpent queen with flowing tresses and one head per frequency band. She grows two heads on big drops and sheds them in quiet parts (`lerna` palette).
- `pegasus`: Pegasus flying towards Olympus, wings beating on the beat grid, with Zeus's lightning on the kicks (`olympus` palette).

### Other changes
- `--image` and `--cover` now give a clear error when the file can't be found.
- `--watch` also re-renders when the image changes.
- `--random` never picks the `photo` style unless you've given it an image.
- Gallery GIFs for all of the above.

## 0.3 (2026-10-20)

- A lot more styles.
- Post-effects (`--fx`): bloom, chroma, VHS, scanlines, vignette and shake.
- Settings that follow the audio (`-P glow=1+pulse*3`), plus LFOs and automation synced to the beat grid.
- Section detection (`--analyze`, `--auto`), `--hook`, the beat grid, `--snap`, `--drums` and `--loop`.
- `--watch`, `--random` and CSV/JSON batch files.

## 0.2 (2026-10-19)

- ASCII mode and the `hands` style.

## 0.1 (2026-10-19)

- First prototype release.
