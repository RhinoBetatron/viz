# Changelog

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
