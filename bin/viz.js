#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import { watch as watchPath } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import { render, formats, transitions, quickBlend } from '../src/render.js';
import { palettes } from '../src/palettes.js';
import { analyzeStructure, energyBar } from '../src/structure.js';
import { snapTime } from '../src/beats.js';
import { effects, parseFx as readFx, fxString } from '../src/fx.js';
import { compile as compileExpression, signals, lfos } from '../src/modulate.js';
import { rng } from '../src/util.js';
import { loadDrawing, describeTree, PROPS, SHAPE_VARS } from '../src/svg.js';

const BIN = fileURLToPath(import.meta.url);
const SRC_DIR = path.join(path.dirname(BIN), '../src');
const STYLES_DIR = path.join(SRC_DIR, 'styles');
const BATCH_EXT = new Set(['.csv', '.json']);
const AUDIO_EXT = new Set(['.wav', '.aif', '.aiff', '.flac', '.mp3', '.m4a']);

async function loadStyles() {
  const styles = {};
  for (const file of (await readdir(STYLES_DIR)).filter((f) => f.endsWith('.js')).sort()) {
    const mod = await import(pathToFileURL(path.join(STYLES_DIR, file)));
    styles[mod.default.name] = mod.default;
  }
  return styles;
}

// Accepts 72, 72.5, 1:12, 1:12.5 or 0:01:12
function parseTime(value) {
  if (value === 'all' || value === 'full') return Infinity; // "to the end"
  const parts = value.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) throw new InvalidArgumentError(`"${value}" isn't a time (use 72, 1:12 or 1:12.5)`);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

// key=value; the value can be an expression of the audio (glow=1+bass*2),
// which is checked here so typos fail before rendering.
function parseParam(value, prev = {}) {
  const [key, ...rest] = value.split('=');
  if (!rest.length) throw new InvalidArgumentError(`--param expects key=value, got "${value}"`);
  const raw = rest.join('=');
  if (raw !== '' && !Number.isNaN(Number(raw))) return { ...prev, [key]: Number(raw) };
  try {
    compileExpression(raw);
  } catch (err) {
    throw new InvalidArgumentError(`${key}: ${err.message}`);
  }
  return { ...prev, [key]: raw };
}

function parseFx(value, prev) {
  try {
    return readFx(value, prev);
  } catch (err) {
    throw new InvalidArgumentError(err.message);
  }
}

// Optional-value options: `--loop` alone gives true, `--loop 2` gives "2".
const optionalNumber = (name) => (value) => {
  const n = Number(value);
  if (Number.isNaN(n) || n < 0) throw new InvalidArgumentError(`${name} takes a number of seconds, got "${value}"`);
  return n;
};

// "1:05=industrial/steel,ratchet=2,transition=flash" → { time, style, palette, params, … }
// A leading + makes the time relative to --start: "+12=industrial".
function parseScene(value, prev = []) {
  const m = value.match(/^(\+?[\d:.]+)=([\w-]+)(?:\/([\w-]+))?(?:,(.*))?$/);
  if (!m) throw new InvalidArgumentError(`--scene expects time=style[/palette][,key=value…], got "${value}"`);
  const [, time, style, palette, rest] = m;
  const relative = time.startsWith('+');
  const scene = { time: parseTime(relative ? time.slice(1) : time), relative, style, palette, params: {} };
  for (const kv of rest ? rest.split(',') : []) {
    const params = parseParam(kv);
    for (const [k, v] of Object.entries(params)) {
      if (k === 'blend') scene.blend = v;
      else if (k === 'transition') scene.transition = v;
      else scene.params[k] = v;
    }
  }
  return [...prev, scene];
}

// Rounds first, so 179.97s prints as 3:00.0 rather than 2:60.0.
const fmtTime = (t) => {
  const d = Math.round(t * 10);
  return `${Math.floor(d / 600)}:${((d % 600) / 10).toFixed(1).padStart(4, '0')}`;
};

function progressBar(done, total, elapsed) {
  const width = 28;
  const pct = done / total;
  const fill = Math.round(pct * width);
  const fps = done / Math.max(elapsed, 0.001);
  const eta = (total - done) / Math.max(fps, 0.001);
  process.stderr.write(
    `\r  [${'█'.repeat(fill)}${'░'.repeat(width - fill)}] ${String(Math.round(pct * 100)).padStart(3)}%  ` +
      `${done}/${total} frames · ${fps.toFixed(1)} fps · ${Math.ceil(eta)}s left `,
  );
}

const styles = await loadStyles();
const program = new Command();

program
  .name('viz')
  .description('Turn audio into audio-reactive teaser videos for Instagram')
  .version('0.6.0')
  .argument('[input]', 'audio file (.wav, .aiff, .flac, .mp3), a folder of them, or a .csv/.json batch file')
  .option('-s, --style <name>', `visual style: ${Object.keys(styles).join(', ')}`, 'bars')
  .option('-o, --output <file>', 'output .mp4 (default: <input>_<style>.mp4 next to the input)')
  .option('-f, --format <name>', `canvas preset: ${Object.keys(formats).join(', ')}`, 'reel')
  .option('--size <WxH>', 'custom resolution, e.g. 1080x1920 (overrides --format)')
  .option('--start <time>', 'where the clip starts, e.g. 1:12', parseTime, 0)
  .option('-d, --duration <time>', 'clip length in seconds or m:ss ("all" = to the end)', parseTime, 15)
  .option('--end <time>', 'where the clip ends (instead of --duration)', parseTime)
  .option('-p, --palette <name>', `colours: ${Object.keys(palettes).join(', ')}, auto (from --cover)`)
  .option('-c, --cover <image>', 'cover art: blurred background + used by styles like radial')
  .option('-i, --image <file>', 'a photo to manipulate and destroy with the music (the photo style, picked automatically unless -s is given)')
  .option('--svg <file>', 'an SVG (or a .json pack that rigs one) to animate with the music: the svg style, picked automatically unless -s is given (repeatable, for --scene)', (v, prev) => [...prev, v], [])
  .option('--bg <mode>', 'background: gradient, cover, black (default: cover if --cover given)')
  .option('-g, --grayscale', 'black & white, darker and moodier (uses the gloom palette unless -p is set)')
  .option('--ascii [cell]', 'redraw every frame as greyscale ASCII art; optional character size in px at 1080p (default 10)')
  .option('--grain <n>', 'film grain amount, 0–30 (default: 10 with --grayscale, else 0)', Number)
  .option('-t, --title <text>', 'big title text')
  .option('--subtitle <text>', 'smaller text under the title')
  .option('--font <family>', 'font family for title/subtitle')
  .option('-P, --param <key=value>', 'tweak a style setting (repeatable), see --list-styles', parseParam, {})
  .option('--scene <time=style>', 'switch style at a track time (1:05=industrial) or seconds into the clip (+12=industrial), e.g. 1:05=occult/blood,symbol=eye (repeatable)', parseScene, [])
  .option('--blend <seconds>', 'how long scene transitions take (flash defaults to 0.8)', Number, 2)
  .option('--transition <type>', `how scenes change: ${transitions.join(', ')}`, 'fade')
  .option('--snap <unit>', 'move --scene times onto the nearest bar (or beat) of the track: bar, beat')
  .option('--analyze', 'find the sections of the track (intro, drops, breakdowns…) and suggest scene changes, without rendering')
  .option('--auto [styles]', 'switch styles automatically at the detected sections: calm,drop[,build] (default vines,occult)')
  .option('--hook [lead]', 'start the clip just before the biggest drop (lead = seconds before it, default 2)', optionalNumber('--hook'))
  .option('--min-section <bars>', 'shortest section --auto, --analyze and --hook will find, in bars', Number, 4)
  .option('--drums <file>', 'drum stem: kicks and hits come from it, everything else from the main track')
  .option('--fx <list>', `post-effects with optional amounts, e.g. bloom,chroma=2: ${Object.keys(effects).join(', ')}`, parseFx)
  .option('--loop [seconds]', 'seamless loop: crossfade the end into the start (default 1.5s), length rounded to whole bars', optionalNumber('--loop'))
  .option('--fps <n>', 'frames per second', Number, 30)
  .option('--crf <n>', 'video quality, lower = better/bigger (14–23)', Number, 16)
  .option('--seed <n>', 'random seed for styles with randomness', Number, 1)
  .option('--no-fade', 'disable the fade in/out on audio and video')
  .option('--preview', 'fast low-res 5s draft to check the look')
  .option('--gpu', 'render on the GPU (can be faster for heavy styles)')
  .option('--hw', "encode on the Mac's video hardware: faster, bigger files")
  .option('--open', 'open the video when done')
  .option('--watch', 'keep running: re-render a preview whenever a style file, the track, the cover or the image changes')
  .option('--random [seed]', 'random style, palette, settings and effects; prints the command to get it again')
  .option('--list-styles', 'show styles and their --param settings')
  .option('--list-palettes', 'show colour palettes')
  .option('--list-layers', 'show the groups and shapes in the --svg drawing, and what a pack can set on them')
  .option('--list-fx', 'show post-effects, transitions, and the signals, LFOs and automation -P can use')
  .showHelpAfterError()
  .action(main);

async function main(input, opts) {
  // Each --svg becomes a style of its own (named after the file or the pack).
  const drawings = [];
  for (const file of opts.svg) {
    await stat(file).catch(() => program.error(`--svg: can't find ${file}`));
    const style = await loadDrawing(file, styles.svg, Object.keys(styles)).catch((err) => program.error(`--svg: ${err.message}`));
    styles[style.name] = style;
    drawings.push(style);
    if (!opts.listStyles && !opts.listLayers) for (const w of style.drawing.warnings) console.error(`  note: ${path.basename(file)}: ${w}`);
  }
  if (opts.listLayers) return listLayers(drawings);
  if (opts.listStyles) return listStyles(drawings);
  if (opts.listPalettes) return listPalettes();
  if (opts.listFx) return listFx();
  if (!input) program.help();
  if (opts.watch) return watch(input, opts);
  opts.fx ??= {};
  if (BATCH_EXT.has(path.extname(input).toLowerCase())) return runBatch(input);

  const given = (name) => program.getOptionValueSource(name) === 'cli';
  if (opts.hook !== undefined && (given('start') || opts.end !== undefined)) program.error('--hook picks the start itself, so leave out --start / --end');
  if (opts.snap && !['bar', 'beat'].includes(opts.snap)) program.error('--snap takes bar or beat');
  const hookLead = opts.hook === true ? 2 : opts.hook;
  const loop = opts.loop === true ? 1.5 : opts.loop ?? 0;

  for (const [flag, file] of [['--image', opts.image], ['--cover', opts.cover]]) {
    if (file) await stat(file).catch(() => program.error(`${flag}: can't find ${file}`));
  }
  // --svg / --image on their own pick the svg / photo style, which can't do
  // without one. -s svg means the (first) drawing.
  if (drawings.length) {
    if (!given('style') || opts.style === 'svg') opts.style = drawings[0].name;
    for (const sc of opts.scene) if (sc.style === 'svg') sc.style = drawings[0].name;
  } else if (opts.image && !given('style')) opts.style = 'photo';
  if (!drawings.length && (opts.style === 'svg' || opts.scene.some((sc) => sc.style === 'svg') || /(^|,)svg(\/|,|$)/.test(typeof opts.auto === 'string' ? opts.auto : ''))) {
    program.error('the svg style needs a drawing: add --svg logo.svg');
  }
  if (!opts.image && !opts.cover && (opts.style === 'photo' || opts.scene.some((sc) => sc.style === 'photo') || /(^|,)photo(\/|,|$)/.test(typeof opts.auto === 'string' ? opts.auto : ''))) {
    program.error('the photo style needs a picture: add --image photo.jpg');
  }

  let randomSeed = null;
  if (opts.random !== undefined) {
    randomSeed = opts.random === true ? 1 + Math.floor(Math.random() * 99999) : Number(opts.random);
    if (!Number.isInteger(randomSeed)) program.error('--random takes a whole number seed, e.g. --random 42');
    randomLook(input, opts, randomSeed, given, drawings);
  }

  // The -s style (and -p palette) is the opening scene; --scene entries follow it.
  const checkStyle = (name) => styles[name] ?? program.error(`Unknown style "${name}". Available: ${Object.keys(styles).join(', ')}`);
  const checkPalette = (name) => {
    if (name && name !== 'auto' && !palettes[name]) program.error(`Unknown palette "${name}". Available: ${Object.keys(palettes).join(', ')}, auto`);
    return name;
  };
  const checkTransition = (name) => (transitions.includes(name) ? name : program.error(`Unknown transition "${name}". Available: ${transitions.join(', ')}`));
  // Flashes, glitches and the like should be short and punchy unless a length was asked for.
  const blendSet = program.getOptionValueSource('blend') !== 'default';
  const transitionSet = program.getOptionValueSource('transition') !== 'default';
  const toScene = (start) => (sc) => {
    const transition = checkTransition(sc.transition ?? opts.transition);
    return {
      ...sc,
      time: sc.relative ? start + sc.time : sc.time,
      style: checkStyle(sc.style),
      palette: checkPalette(sc.palette ?? opts.palette),
      params: { ...opts.param, ...sc.params },
      blend: sc.blend ?? (quickBlend[transition] && !blendSet ? quickBlend[transition] : opts.blend),
      transition,
    };
  };
  const opening = (name, palette, params = {}) => ({ time: -Infinity, style: checkStyle(name), palette: checkPalette(palette ?? opts.palette), params: { ...opts.param, ...params } });
  checkStyle(opts.style);
  opts.scene.forEach(toScene(0)); // check names before any analysis

  // --auto calm,drop[,build]: each may carry a palette, e.g. vines/verdant.
  let roles;
  if (opts.auto || opts.analyze) {
    if (opts.auto && opts.scene.length) program.error('--auto picks the scenes itself, so leave out --scene (or drop --auto)');
    const list = (typeof opts.auto === 'string' ? opts.auto : 'vines,occult').split(',').map((x) => {
      const [style, palette] = x.trim().split('/');
      checkStyle(style);
      checkPalette(palette);
      return { style, palette };
    });
    if (list.length < 2 || list.length > 3) program.error('--auto takes 2 or 3 styles: calm,drop[,build], e.g. --auto vines,occult');
    roles = { calm: list[0], drop: list[1], build: list[2] ?? list[0] };
  }

  let { width, height } = formats[opts.format] ?? program.error(`Unknown format "${opts.format}". Available: ${Object.keys(formats).join(', ')}`);
  if (opts.size) {
    const m = opts.size.match(/^(\d+)x(\d+)$/);
    if (!m) program.error('--size must look like 1080x1920');
    [width, height] = [Number(m[1]), Number(m[2])];
  }

  let duration = opts.end !== undefined ? opts.end - opts.start : opts.duration;
  if (duration === Infinity) duration = undefined;
  // Auto scenes only make sense over a whole track, unless a length (or a hook) was asked for.
  if ((opts.auto || opts.analyze) && opts.hook === undefined && opts.end === undefined && program.getOptionValueSource('duration') === 'default') duration = undefined;
  if (duration !== undefined && duration <= 0) program.error('--end must be after --start');
  if (!(opts.minSection >= 1)) program.error('--min-section takes a number of bars, e.g. --min-section 8');
  if (opts.hw && process.platform !== 'darwin') program.error('--hw uses the Mac video encoder, so it only works on macOS');
  let preset = 'veryfast';
  if (opts.preview) {
    width = Math.round(width / 4) * 2;
    height = Math.round(height / 4) * 2;
    if (!opts.auto && !opts.scene.length) duration = Math.min(duration ?? 5, 5); // keep the full clip so scene changes are visible
    preset = 'ultrafast';
  }

  const ascii = opts.ascii === undefined ? 0 : opts.ascii === true ? 10 : Number(opts.ascii);
  if (Number.isNaN(ascii) || ascii < 0) program.error('--ascii takes a character size in px, e.g. --ascii 8');

  const inputs = (await stat(input)).isDirectory()
    ? (await readdir(input)).filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase())).sort().map((f) => path.join(input, f))
    : [input];
  if (!inputs.length) program.error(`No audio files found in ${input}`);
  if (inputs.length > 1 && opts.output) program.error('--output can only be used with a single input file');
  if (inputs.length > 1 && opts.drums) program.error('--drums goes with a single track, not a folder');

  for (const file of inputs) {
    // Sections and the track's beat grid, when something needs them.
    let structure = null;
    if (opts.auto || opts.analyze || opts.hook !== undefined || opts.snap) {
      console.error(`\n▶ ${path.basename(file)}: finding sections…`);
      structure = await analyzeStructure(file, { minBars: opts.minSection });
      printStructure(structure);
    }

    let start = opts.start;
    if (opts.hook !== undefined) {
      const drop = findHook(structure);
      start = Math.max(0, drop.start - hookLead);
      console.error(`  Hook: ${drop.label} at ${fmtTime(drop.start)} → clip starts at ${fmtTime(start)} (--start ${start.toFixed(1)})`);
    }

    let scenes = [opening(opts.style), ...opts.scene.map(toScene(start))];
    if (opts.auto || opts.analyze) {
      const auto = autoScenes(structure.sections, roles, start, duration, { blendSet, transitionSet, blend: opts.blend, transition: opts.transition });
      if (opts.analyze) {
        printSuggestion(file, auto, roles);
        continue;
      }
      scenes = [opening(auto.opening.style, auto.opening.palette), ...auto.changes.map(toScene(start))];
    }
    if (opts.snap) {
      if (!structure.grid) console.error('  --snap: no steady beat found, scene times left as they are');
      else scenes = scenes.map((sc) => (sc.time === -Infinity ? sc : { ...sc, time: snapTime(sc.time, structure.grid, opts.snap) }));
    }

    const base = path.join(path.dirname(file), path.basename(file, path.extname(file)));
    const name = [...new Set(scenes.map((sc) => sc.style.name))].join('-');
    const tags = [ascii && 'ascii', loop && 'loop', randomSeed && `r${randomSeed}`, opts.preview && 'preview'].filter(Boolean).map((t) => `_${t}`).join('');
    const output = opts.output ?? `${base}_${name}${tags}.mp4`;
    const extras = [opts.grayscale && 'grayscale', ascii && `ascii ${ascii}px`, Object.keys(opts.fx).length && `fx ${fxString(opts.fx)}`, loop && `loop ${loop}s`, opts.drums && `drums: ${path.basename(opts.drums)}`].filter(Boolean);
    console.error(`\n▶ ${path.basename(file)} → ${output}`);
    console.error(`  ${scenes[0].style.name}${extras.length ? ` (${extras.join(', ')})` : ''} · ${width}x${height} @ ${opts.fps}fps · from ${fmtTime(start)}, ${duration === undefined ? 'to the end' : `${duration}s`}`);
    for (const sc of scenes.slice(1)) console.error(`  ${fmtTime(sc.time)} → ${sc.style.name}${sc.palette ? `/${sc.palette}` : ''} (${sc.transition}${['cut', 'kick'].includes(sc.transition) ? '' : ` ${sc.blend}s`})`);

    const t0 = Date.now();
    const result = await render({
      input: file, output, scenes, width, height, duration, preset,
      fps: opts.fps, start, cover: opts.cover, image: opts.image, background: opts.bg,
      title: opts.title, subtitle: opts.subtitle, font: opts.font,
      fade: opts.fade, crf: opts.crf, ascii, seed: opts.seed, gpu: opts.gpu, hw: opts.hw, grayscale: opts.grayscale, grain: opts.grain,
      fx: opts.fx, loop, drums: opts.drums, grid: structure?.grid,
      onStage: (s) => s !== 'Rendering' && console.error(`  ${s}…`),
      onProgress: progressBar,
    });
    process.stderr.write('\n');
    const loopNote = loop ? ` (loops${result.loopBars ? ` on ${result.loopBars} bar${result.loopBars > 1 ? 's' : ''}` : ''})` : '';
    console.error(`✔ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s · ${result.duration.toFixed(1)}s clip${loopNote} · ${result.bpm ? `${result.bpm.toFixed(1)} BPM · ` : ''}${result.stats.onsets} onsets, ${result.stats.kicks} kicks detected`);
    if (opts.open) openVideo(output);
  }
}

function openVideo(file) {
  // In --watch mode QuickTime would keep showing the old render, so close it first.
  if (process.env.VIZ_WATCH && process.platform === 'darwin') {
    const abs = path.resolve(file).replace(/["\\]/g, '\\$&');
    spawnSync('osascript', ['-e', `if application "QuickTime Player" is running then tell application "QuickTime Player" to close (every document whose path is "${abs}")`], { stdio: 'ignore' });
  }
  spawn('open', [file], { stdio: 'ignore', detached: true }).unref();
}

// The drop the clip should open on: the biggest jump up into a loud section,
// favouring earlier ones a little (the first drop is usually the hook).
function findHook({ sections, duration }) {
  let best = null;
  sections.forEach((s, i) => {
    if (i === 0) return;
    const jump = s.energy - sections[i - 1].energy;
    const score = jump + 0.5 * s.energy + (s.label === 'drop' ? 0.5 : 0) - 0.25 * (s.start / duration);
    if (jump > 0 && (!best || score > best.score)) best = { ...s, score };
  });
  if (!best) program.error('--hook: couldn\'t find a drop in this track. Use --start instead');
  return best;
}

// --random: fills in whatever wasn't given on the command line, then prints
// the full command so a look you like can be rendered again.
function randomLook(input, opts, seed, given, drawings) {
  const random = rng(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const chosen = [];
  const argv = process.argv.slice(2);
  // Without a picture the photo style has nothing to work on; with one, keep it.
  // Drawings are listed under their own names, so 'svg' would only repeat one.
  const pool = Object.keys(styles).filter((n) => n !== 'svg' && (n !== 'photo' || opts.image));
  // A bare --auto would fall back to vines,occult, so pick its styles instead.
  // The settings below belong to one style, so they're left alone here.
  if (opts.auto === true) {
    const list = [];
    for (let k = random() < 0.3 ? 3 : 2; list.length < k;) {
      const name = pick(pool);
      if (!list.includes(name)) list.push(name);
    }
    opts.auto = list.join(',');
    argv.splice(argv.indexOf('--auto') + 1, 0, opts.auto);
  }
  let style = null;
  if (typeof opts.auto !== 'string') {
    if (!given('style') && !opts.image && !drawings.length) opts.style = pick(pool);
    chosen.push('-s', opts.style);
    style = styles[opts.style];
    if (!style) return; // reported by the caller
  }
  // A style with named presets (photo) gets one picked too.
  if (style?.presets && !('preset' in opts.param)) {
    opts.param.preset = pick(style.presets);
    chosen.push('-P', `preset=${opts.param.preset}`);
  }
  if (!given('palette') && random() < 0.5) opts.palette = pick(Object.keys(palettes));
  if (opts.palette && !given('palette')) chosen.push('-p', opts.palette);
  // Nudge about half the numeric settings, between half and double (inside
  // a pack param's limits).
  for (const [k, v] of Object.entries(style?.params ?? {})) {
    if (k in opts.param || typeof v !== 'number' || v === 0 || random() < 0.5) continue;
    const { min = -Infinity, max = Infinity } = style.paramInfo?.[k] ?? {};
    const value = Math.min(max, Math.max(min, Number.isInteger(v) && v > 1 ? Math.max(1, Math.round(v * (0.5 + random() * 1.3))) : +(v * 2 ** (random() * 2 - 1)).toFixed(3)));
    opts.param[k] = value;
    chosen.push('-P', `${k}=${value}`);
  }
  if (!given('fx') && random() < 0.6) {
    const names = Object.keys(effects).filter(() => random() < 0.3);
    for (const n of names.length ? names : [pick(Object.keys(effects))]) opts.fx[n] = +(0.5 + random()).toFixed(1);
    chosen.push('--fx', fxString(opts.fx));
  }
  if (!given('grain') && !opts.grayscale && random() < 0.3) {
    opts.grain = Math.round(4 + random() * 14);
    chosen.push('--grain', String(opts.grain));
  }
  // The command as typed, minus --random, plus what was picked.
  const at = argv.indexOf('--random');
  argv.splice(at, /^\d+$/.test(argv[at + 1] ?? '') ? 2 : 1);
  const quote = (a) => (/^[\w./:=,+@-]+$/.test(a) ? a : `"${a.replace(/(["\\$`])/g, '\\$1')}"`);
  console.error(`\n🎲 Random look (seed ${seed}). To render it again:\n`);
  console.log(['viz', ...argv, ...chosen].map(quote).join(' '));
}

// --watch: re-runs the same command in a fresh process (so edited style files
// are reloaded) whenever something it uses changes.
async function watch(input, opts) {
  const args = process.argv.slice(2).filter((a) => a !== '--watch');
  if (!opts.preview) args.push('--preview');
  // A pack's SVG and an SVG's .viz.json are watched too.
  const drawn = [];
  for (const file of opts.svg) drawn.push(...(await loadDrawing(file, styles.svg).then((s) => s.files, () => [file])));
  const watched = [...new Set([SRC_DIR, input, opts.cover, opts.image, opts.drums, ...drawn].filter(Boolean))];
  let child = null, timer = null;
  const run = (reason) => {
    if (reason) console.error(`\n↻ ${reason} changed, rendering again…`);
    if (child) child.kill('SIGTERM');
    const proc = (child = spawn(process.execPath, [BIN, ...args], { stdio: 'inherit', env: { ...process.env, VIZ_WATCH: '1' } }));
    proc.on('exit', (code, signal) => {
      if (child !== proc) return; // replaced by a newer run
      child = null;
      if (!signal) console.error(code ? '\n  (failed — fix it and save to try again)' : '\n  Watching for changes… (ctrl+c to stop)');
    });
  };
  for (const p of watched) {
    watchPath(p, { recursive: p === SRC_DIR }, (_event, name) => {
      clearTimeout(timer);
      timer = setTimeout(() => run(name ? path.basename(name) : path.basename(p)), 250);
    });
  }
  process.on('SIGINT', () => {
    child?.kill('SIGTERM');
    process.exit(130);
  });
  run();
}

// Batch files: one row per video. Columns (CSV) or keys (JSON) are option
// names, e.g. input,start,style,title. Options given on the command line
// apply to every row; a row's own values win.
async function runBatch(file) {
  const dir = path.dirname(file);
  const text = await readFile(file, 'utf8');
  let rows;
  if (path.extname(file).toLowerCase() === '.json') {
    const data = JSON.parse(text);
    rows = Array.isArray(data) ? data : (data.tracks ?? []).map((t) => ({ ...data.defaults, ...t }));
  } else rows = parseCsv(text);
  if (!rows.length) program.error(`No rows in ${file}`);

  const common = process.argv.slice(2);
  common.splice(common.indexOf(file), 1);
  const failed = [];
  for (const [i, row] of rows.entries()) {
    const track = row.input ?? row.file ?? row.track;
    if (!track) program.error(`Row ${i + 1} of ${file} has no input (add an "input" column)`);
    const args = [path.resolve(dir, track), ...common, ...rowArgs(row, dir)];
    console.error(`\n━━ ${i + 1}/${rows.length}: ${path.basename(track)} ━━`);
    const code = await new Promise((resolve) => spawn(process.execPath, [BIN, ...args], { stdio: 'inherit' }).on('exit', resolve));
    if (code) failed.push(`${i + 1}: ${track}`);
  }
  console.error(`\n${failed.length ? `✖ ${failed.length} of ${rows.length} failed:\n  ${failed.join('\n  ')}` : `✔ All ${rows.length} done`}`);
  if (failed.length) process.exitCode = 1;
}

const TRUE = /^(yes|y|true|x|1|on)$/i, FALSE = /^(no|n|false|0|off|)$/i;
const YES = /^(yes|y|true|x|on)$/i; // for options with an optional number, where 1 means 1
const PATH_KEYS = new Set(['cover', 'c', 'image', 'i', 'svg', 'output', 'o', 'drums']);
// Repeatable options; in a CSV cell, separate several with ;
const LIST_KEYS = new Set(['param', 'P', 'scene', 'svg']);

function rowArgs(row, dir) {
  const args = [];
  for (const [key, raw] of Object.entries(row)) {
    if (['input', 'file', 'track'].includes(key) || raw === undefined || raw === null) continue;
    const opt = program.options.find((o) => o.long === `--${key}` || o.short === `-${key}`);
    if (!opt) {
      const negated = program.options.find((o) => o.long === `--no-${key}`);
      if (negated && (raw === false || FALSE.test(String(raw)))) args.push(negated.long);
      else if (!negated) program.error(`Unknown column "${key}" in the batch file (use option names like style, start, title)`);
      continue;
    }
    const flag = opt.long;
    let values = Array.isArray(raw) ? raw : [raw];
    if (typeof raw === 'object' && !Array.isArray(raw)) values = Object.entries(raw).map(([k, v]) => `${k}=${v}`); // "param": { "glow": 2 }
    if (typeof raw === 'string' && LIST_KEYS.has(key)) values = raw.split(';').map((v) => v.trim()).filter(Boolean);
    for (const v of values) {
      const str = String(v).trim();
      if (!opt.required && !opt.optional) {
        if (v === true || TRUE.test(str)) args.push(flag); // plain switch, e.g. open
      } else if (opt.optional && (v === true || YES.test(str))) {
        args.push(flag); // e.g. "hook": true → --hook with its default
      } else if (str !== '' && v !== false) {
        args.push(flag, PATH_KEYS.has(key) ? path.resolve(dir, str) : str);
      }
    }
  }
  return args;
}

// Minimal CSV: header row, commas, "quoted, fields" with "" for a quote,
// blank lines and lines starting with # skipped.
function parseCsv(text) {
  const records = [];
  let field = '', record = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { record.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      field = '';
      record = [];
    } else field += ch;
  }
  if (field || record.length) records.push([...record, field]);
  const rows = records.filter((r) => r.some((f) => f.trim()) && !r[0].trim().startsWith('#'));
  const [header, ...body] = rows;
  const keys = (header ?? []).map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]?.trim()]).filter(([k, v]) => k && v !== undefined && v !== '')));
}

// Which style each section gets, and the scene changes between them.
const ROLE = { drop: 'drop', build: 'build', groove: 'build' };

function autoScenes(sections, roles, start, duration, { blendSet, transitionSet, blend, transition }) {
  const end = duration === undefined ? Infinity : start + duration;
  const roleOf = (s) => ROLE[s.label] ?? 'calm';
  const at = (t) => sections.findLast((s) => s.start <= t) ?? sections[0];
  const opening = roles[roleOf(at(start))];
  const changes = [];
  let current = opening;
  for (const s of sections) {
    if (s.start <= start || s.start >= end) continue;
    const role = roleOf(s), next = roles[role];
    if (next === current) continue;
    // Snap into drops with a flash; ease out of them.
    const tr = transitionSet ? transition : role === 'drop' ? 'flash' : 'fade';
    changes.push({
      time: Number(s.start.toFixed(2)), style: next.style, palette: next.palette, params: {},
      transition: tr, blend: blendSet ? blend : tr === 'flash' ? 0.8 : role === 'build' ? 2 : 3,
      label: s.label,
    });
    current = next;
  }
  return { opening, changes };
}

function printStructure({ duration, bpm, sections }) {
  console.error(`  ${fmtTime(duration)} · ${bpm ? `${bpm.toFixed(1)} BPM` : 'no steady beat found'}\n`);
  console.error('    start    length  energy      section');
  for (const s of sections) {
    console.error(`    ${fmtTime(s.start).padStart(7)}  ${`${s.length.toFixed(1)}s`.padStart(6)}  ${energyBar(s.energy)}  ${s.label}`);
  }
  console.error('');
}

function printSuggestion(file, { opening, changes }, roles) {
  const name = (r) => r.style + (r.palette ? `/${r.palette}` : '');
  // -p would apply to every scene, so when the opening has a palette the
  // others need theirs spelled out.
  const sceneName = (r) => (opening.palette && !r.palette ? `${r.style}/${styles[r.style].palette ?? 'neon'}` : name(r));
  const lines = [`viz ${path.basename(file).includes(' ') ? `"${path.basename(file)}"` : path.basename(file)} -d all -s ${opening.style}${opening.palette ? ` -p ${opening.palette}` : ''}`];
  for (const c of changes) {
    lines.push(`  --scene ${fmtTime(c.time)}=${sceneName(c)},transition=${c.transition}${c.transition === 'flash' ? '' : `,blend=${c.blend}`}`);
  }
  console.error(`  Scene changes (${name(roles.calm)} for calm parts, ${name(roles.drop)} for drops${roles.build !== roles.calm ? `, ${name(roles.build)} for builds` : ''}):\n`);
  console.log(lines.join(' \\\n'));
  console.error(`\n  Copy and tweak that, or render it directly with: --auto ${[roles.calm, roles.drop, ...(roles.build !== roles.calm ? [roles.build] : [])].map(name).join(',')}\n`);
}

function listStyles(drawings = []) {
  for (const s of Object.values(styles)) {
    console.log(`\n  ${s.name}  —  ${s.description}`);
    for (const [k, v] of Object.entries(s.params ?? {})) {
      const info = s.paramInfo?.[k];
      const range = info && (info.min !== undefined || info.max !== undefined) ? ` (${info.min ?? ''}–${info.max ?? ''})` : '';
      console.log(`      --param ${k}=${v}${range}${info?.description ? `   ${info.description}` : ''}`);
    }
  }
  if (!drawings.length) console.log('\n  (add --svg logo.svg or --svg pack.json to see a drawing\'s own settings)');
  console.log('');
}

function listLayers(drawings) {
  if (!drawings.length) program.error('--list-layers shows what\'s in a drawing: add --svg logo.svg');
  for (const s of drawings) {
    const { drawing } = s;
    const v = drawing.view;
    console.log(`\n  ${path.basename(drawing.file)}  ·  ${+v.width.toFixed(2)}×${+v.height.toFixed(2)}  ·  ${drawing.nodes.filter((n) => n.path).length} shapes  ·  style "${s.name}"\n`);
    for (const line of describeTree(drawing)) console.log(line);
    for (const w of drawing.warnings) console.log(`\n  note: ${w}`);
    if (s.rules.length) console.log(`\n  Rigged by ${s.rules.length} rule${s.rules.length > 1 ? 's' : ''}${Object.keys(s.paramInfo).length ? `, with params: ${Object.keys(s.paramInfo).join(', ')}` : ''}.`);
  }
  console.log('\n  Properties (in data-viz="rotate: beat*360; glow: high*20" or a pack\'s "layers"):\n');
  for (const [k, d] of Object.entries(PROPS)) console.log(`      ${k.padEnd(8)} ${d}`);
  console.log(`\n  Besides the signals and LFOs of --list-fx, expressions can use the style's\n  params (amount, intro, and a pack's own) and, for each shape:\n`);
  for (const [k, d] of Object.entries(SHAPE_VARS)) console.log(`      ${k.padEnd(8)} ${d}`);
  console.log('');
}

function listFx() {
  console.log('\n  Post-effects  (--fx name or name=amount, comma-separated; 1 = normal strength)\n');
  for (const [k, v] of Object.entries(effects)) console.log(`      ${k.padEnd(10)} ${v}`);
  console.log(`\n  Transitions  (--transition, or transition= in a --scene)\n\n      ${transitions.join(', ')}`);
  console.log(`\n  Signals for -P expressions, e.g. -P glow=1+bass*2\n\n      ${Object.keys(signals).join(', ')}`);
  console.log('      functions: sin cos abs min max floor round sqrt pow clamp, and pi');
  console.log(`\n  LFOs, synced to the beat: ${lfos.map((l) => `${l}(bars)`).join(' ')}, all 0 → 1`);
  console.log('      e.g. -P "glow=1+2*sine(4)" (one slow swell every 4 bars), square(1/2) flips every beat');
  console.log('\n  Automation: time=value points, ramped in between');
  console.log('      e.g. -P "glow=0:50=0.5 0:55.8=3 1:10=1"   (+12=… means 12s into the clip)\n');
}

function listPalettes() {
  const swatch = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return `\x1b[48;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m   \x1b[0m`;
  };
  console.log('');
  for (const [name, p] of Object.entries(palettes)) {
    console.log(`  ${name.padEnd(8)} ${[...p.bg, ...p.colors].map(swatch).join('')}`);
  }
  console.log(`  ${'auto'.padEnd(8)} pulled from --cover art\n`);
}

try {
  await program.parseAsync();
} catch (err) {
  console.error(`\n✖ ${err.message}`);
  process.exit(1);
}
