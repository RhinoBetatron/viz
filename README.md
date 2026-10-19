# viz

A command-line tool that turns audio files into audio-reactive videos for Instagram Reels, feed posts and YouTube.

```bash
viz track.wav -s vines --open
viz track.wav --auto vines,occult      # finds the drops and switches styles on its own
```

- **Styles:** `bars`, `radial`, `wave`, `particles`, `occult`, `industrial`, `vines`. Each has its own settings (`-P key=value`).
- **Scenes:** blend between styles at chosen times, or let `--auto` / `--analyze` find the intro, drops and breakdowns.
- **Formats:** 9:16 Reel, 4:5 feed, 1:1 square and 16:9 landscape. Output is H.264 + AAC, ready for Instagram.
- **Extras:** palettes, cover art, title text, grayscale mode and film grain.

## Install

Needs Node 20+ and ffmpeg (`brew install ffmpeg`).

```bash
npm install
npm link        # makes `viz` available in every folder
```

## Usage

See **[CHEATSHEET.md](CHEATSHEET.md)** for every option, style setting and copy-paste commands.
