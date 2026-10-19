#!/usr/bin/env node
import { readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import { render, formats, transitions } from '../src/render.js';
import { palettes } from '../src/palettes.js';
import { analyzeStructure, energyBar } from '../src/structure.js';

const STYLES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/styles');
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

function parseParam(value, prev = {}) {
  const [key, ...rest] = value.split('=');
  if (!rest.length) throw new InvalidArgumentError(`--param expects key=value, got "${value}"`);
  const raw = rest.join('=');
  return { ...prev, [key]: raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw };
}

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

const fmtTime = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

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
  .version('0.1.0')
  .argument('[input]', 'audio file (.wav, .aiff, .flac, .mp3) or a folder of them')
  .option('-s, --style <name>', `visual style: ${Object.keys(styles).join(', ')}`, 'bars')
  .option('-o, --output <file>', 'output .mp4 (default: <input>_<style>.mp4 next to the input)')
  .option('-f, --format <name>', `canvas preset: ${Object.keys(formats).join(', ')}`, 'reel')
  .option('--size <WxH>', 'custom resolution, e.g. 1080x1920 (overrides --format)')
  .option('--start <time>', 'where the clip starts, e.g. 1:12', parseTime, 0)
  .option('-d, --duration <time>', 'clip length in seconds or m:ss ("all" = to the end)', parseTime, 15)
  .option('--end <time>', 'where the clip ends (instead of --duration)', parseTime)
  .option('-p, --palette <name>', `colours: ${Object.keys(palettes).join(', ')}, auto (from --cover)`)
  .option('-c, --cover <image>', 'cover art: blurred background + used by styles like radial')
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
  .option('--analyze', 'find the sections of the track (intro, drops, breakdowns…) and suggest scene changes, without rendering')
  .option('--auto [styles]', 'switch styles automatically at the detected sections: calm,drop[,build] (default vines,occult)')
  .option('--fps <n>', 'frames per second', Number, 30)
  .option('--crf <n>', 'video quality, lower = better/bigger (16–23)', Number, 18)
  .option('--seed <n>', 'random seed for styles with randomness', Number, 1)
  .option('--no-fade', 'disable the fade in/out on audio and video')
  .option('--preview', 'fast low-res 5s draft to check the look')
  .option('--gpu', 'render on the GPU (can be faster for heavy styles)')
  .option('--open', 'open the video when done')
  .option('--list-styles', 'show styles and their --param settings')
  .option('--list-palettes', 'show colour palettes')
  .showHelpAfterError()
  .action(main);

async function main(input, opts) {
  if (opts.listStyles) return listStyles();
  if (opts.listPalettes) return listPalettes();
  if (!input) program.help();

  // The -s style (and -p palette) is the opening scene; --scene entries follow it.
  const checkStyle = (name) => styles[name] ?? program.error(`Unknown style "${name}". Available: ${Object.keys(styles).join(', ')}`);
  const checkPalette = (name) => {
    if (name && name !== 'auto' && !palettes[name]) program.error(`Unknown palette "${name}". Available: ${Object.keys(palettes).join(', ')}, auto`);
    return name;
  };
  const checkTransition = (name) => (transitions.includes(name) ? name : program.error(`Unknown transition "${name}". Available: ${transitions.join(', ')}`));
  // A flash should be short and punchy unless a length was asked for.
  const blendSet = program.getOptionValueSource('blend') !== 'default';
  const transitionSet = program.getOptionValueSource('transition') !== 'default';
  const toScene = (sc) => {
    const transition = checkTransition(sc.transition ?? opts.transition);
    return {
      ...sc,
      time: sc.relative ? opts.start + sc.time : sc.time,
      style: checkStyle(sc.style),
      palette: checkPalette(sc.palette ?? opts.palette),
      params: { ...opts.param, ...sc.params },
      blend: sc.blend ?? (transition === 'flash' && !blendSet ? 0.8 : opts.blend),
      transition,
    };
  };
  const opening = (name, palette, params = {}) => ({ time: -Infinity, style: checkStyle(name), palette: checkPalette(palette ?? opts.palette), params: { ...opts.param, ...params } });

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
  const manualScenes = [opening(opts.style), ...opts.scene.map(toScene)];

  let { width, height } = formats[opts.format] ?? program.error(`Unknown format "${opts.format}". Available: ${Object.keys(formats).join(', ')}`);
  if (opts.size) {
    const m = opts.size.match(/^(\d+)x(\d+)$/);
    if (!m) program.error('--size must look like 1080x1920');
    [width, height] = [Number(m[1]), Number(m[2])];
  }

  let duration = opts.end !== undefined ? opts.end - opts.start : opts.duration;
  if (duration === Infinity) duration = undefined;
  // Auto scenes only make sense over a whole track, unless a length was asked for.
  if ((opts.auto || opts.analyze) && opts.end === undefined && program.getOptionValueSource('duration') === 'default') duration = undefined;
  if (duration !== undefined && duration <= 0) program.error('--end must be after --start');
  let preset = 'medium';
  if (opts.preview) {
    width = Math.round(width / 4) * 2;
    height = Math.round(height / 4) * 2;
    if (!opts.auto && manualScenes.length === 1) duration = Math.min(duration ?? 5, 5); // keep the full clip so scene changes are visible
    preset = 'ultrafast';
  }

  const ascii = opts.ascii === undefined ? 0 : opts.ascii === true ? 10 : Number(opts.ascii);
  if (Number.isNaN(ascii) || ascii < 0) program.error('--ascii takes a character size in px, e.g. --ascii 8');

  const inputs = (await stat(input)).isDirectory()
    ? (await readdir(input)).filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase())).sort().map((f) => path.join(input, f))
    : [input];
  if (!inputs.length) program.error(`No audio files found in ${input}`);
  if (inputs.length > 1 && opts.output) program.error('--output can only be used with a single input file');

  for (const file of inputs) {
    let scenes = manualScenes;
    if (opts.auto || opts.analyze) {
      console.error(`\n▶ ${path.basename(file)}: finding sections…`);
      const structure = await analyzeStructure(file);
      printStructure(structure);
      const auto = autoScenes(structure.sections, roles, opts.start, duration, { blendSet, transitionSet, blend: opts.blend, transition: opts.transition });
      if (opts.analyze) {
        printSuggestion(file, auto, roles);
        continue;
      }
      scenes = [opening(auto.opening.style, auto.opening.palette), ...auto.changes.map(toScene)];
    }
    const base = path.join(path.dirname(file), path.basename(file, path.extname(file)));
    const name = [...new Set(scenes.map((sc) => sc.style.name))].join('-');
    const output = opts.output ?? `${base}_${name}${ascii ? '_ascii' : ''}${opts.preview ? '_preview' : ''}.mp4`;
    console.error(`\n▶ ${path.basename(file)} → ${output}`);
    console.error(`  ${scenes[0].style.name}${opts.grayscale ? ' (grayscale)' : ''}${ascii ? ` (ascii ${ascii}px)` : ''} · ${width}x${height} @ ${opts.fps}fps · from ${opts.start}s, ${duration === undefined ? 'to the end' : `${duration}s`}`);
    for (const sc of scenes.slice(1)) console.error(`  ${fmtTime(sc.time)} → ${sc.style.name}${sc.palette ? `/${sc.palette}` : ''} (${sc.transition}${sc.transition === 'cut' ? '' : ` ${sc.blend}s`})`);

    const t0 = Date.now();
    const result = await render({
      input: file, output, scenes, width, height, duration, preset,
      fps: opts.fps, start: opts.start, cover: opts.cover, background: opts.bg,
      title: opts.title, subtitle: opts.subtitle, font: opts.font,
      fade: opts.fade, crf: opts.crf, ascii, seed: opts.seed, gpu: opts.gpu, grayscale: opts.grayscale, grain: opts.grain,
      onStage: (s) => s !== 'Rendering' && console.error(`  ${s}…`),
      onProgress: progressBar,
    });
    process.stderr.write('\n');
    console.error(`✔ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s · ${result.duration.toFixed(1)}s clip · ${result.stats.onsets} onsets, ${result.stats.kicks} kicks detected`);
    if (opts.open) spawn('open', [output], { stdio: 'ignore', detached: true }).unref();
  }
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

function listStyles() {
  for (const s of Object.values(styles)) {
    console.log(`\n  ${s.name}  —  ${s.description}`);
    for (const [k, v] of Object.entries(s.params ?? {})) console.log(`      --param ${k}=${v}`);
  }
  console.log('');
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
