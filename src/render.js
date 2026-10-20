import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Canvas, loadImage } from 'skia-canvas';
import { analyze } from './audio.js';
import { trackGrid, tagFrames, BEATS_PER_BAR } from './beats.js';
import { makeFx } from './fx.js';
import { compileParams } from './modulate.js';
import { palettes, paletteFromImage, rgba } from './palettes.js';
import { drawCover, rng } from './util.js';

export const formats = {
  reel:      { width: 1080, height: 1920, label: '9:16 Reels / Stories' },
  feed:      { width: 1080, height: 1350, label: '4:5 feed post' },
  square:    { width: 1080, height: 1080, label: '1:1 feed / grid' },
  landscape: { width: 1920, height: 1080, label: '16:9 YouTube / X' },
};

const FADE_IN = 0.4;
const FADE_OUT = 0.8;

// Post-processing done by ffmpeg on the finished frames (after conversion to YUV).
function videoFilters({ grayscale, grain }) {
  const filters = ['scale=out_color_matrix=bt709:out_range=tv', 'format=yuv420p'];
  if (grayscale) filters.push('hue=s=0', 'eq=contrast=1.15:brightness=-0.03:gamma=0.9');
  if (grain > 0) filters.push(`noise=c0s=${grain}:c0f=t`); // luma-only, changes every frame
  return filters.join(',');
}

function runFfmpeg(args, { stdin = false } = {}) {
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: [stdin ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
  let stderr = '';
  ff.stderr.on('data', (c) => (stderr += c));
  const done = new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}:\n${stderr.trim()}`))));
  });
  ff.stdin?.on('error', () => {}); // surfaced through `done` instead
  return { ff, done };
}

const rawInput = ({ width, height, fps }) => ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0'];
const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
const outputArgs = ({ crf, preset }) => [
  '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-profile:v', 'high', ...BT709,
  '-c:a', 'aac', '-b:a', '320k', '-ar', '48000',
];

// Frames in, finished MP4 out, with the audio cut from the track.
function encoder({ input, output, width, height, fps, start, duration, fade, crf, preset, grayscale, grain }) {
  const args = [
    ...rawInput({ width, height, fps }),
    '-ss', String(start), '-t', String(duration), '-i', input,
    '-map', '0:v', '-map', '1:a',
    '-vf', videoFilters({ grayscale, grain }),
    ...outputArgs({ crf, preset }),
  ];
  if (fade) args.push('-af', `afade=t=in:d=${FADE_IN},afade=t=out:st=${Math.max(0, duration - FADE_OUT)}:d=${FADE_OUT}`);
  args.push('-t', String(duration), '-movflags', '+faststart', output);
  return runFfmpeg(args, { stdin: true });
}

// --loop, pass 1: frames to a near-lossless temp file (video only).
function loopSource({ file, width, height, fps, preset }) {
  return runFfmpeg([
    ...rawInput({ width, height, fps }),
    '-vf', videoFilters({}), '-r', String(fps), '-c:v', 'libx264', '-preset', preset === 'ultrafast' ? 'ultrafast' : 'veryfast', '-crf', '8', ...BT709, file,
  ], { stdin: true });
}

// --loop, pass 2: the rendered source runs `out + overlap` frames. The last
// `overlap` frames are crossfaded into the first ones (picture and sound), so
// the clip's end flows straight back into its start.
function loopFinish({ file, input, output, fps, start, out, overlap, crf, preset, grayscale, grain }) {
  const D = out / fps, L = overlap / fps;
  const post = videoFilters({ grayscale, grain }).split(',').slice(1).join(','); // already BT.709 from pass 1
  const graph = [
    '[0:v]split=3[v0][v1][v2]',
    `[v0]trim=start_frame=0:end_frame=${overlap},setpts=PTS-STARTPTS[head]`,
    `[v1]trim=start_frame=${out}:end_frame=${out + overlap},setpts=PTS-STARTPTS[tail]`,
    `[v2]trim=start_frame=${overlap}:end_frame=${out},setpts=PTS-STARTPTS[mid]`,
    `[tail][head]blend=all_expr='A*(1-(N+0.5)/${overlap})+B*(N+0.5)/${overlap}'[x]`,
    `[x][mid]concat=n=2:v=1:a=0,${post}[v]`,
    '[1:a]asplit=3[a0][a1][a2]',
    `[a0]atrim=0:${L},asetpts=PTS-STARTPTS,afade=t=in:d=${L}:curve=qsin[ah]`,
    `[a1]atrim=${D}:${D + L},asetpts=PTS-STARTPTS,afade=t=out:d=${L}:curve=qsin[at]`,
    '[ah][at]amix=inputs=2:normalize=0:duration=longest[ax]',
    `[a2]atrim=${L}:${D},asetpts=PTS-STARTPTS[am]`,
    '[ax][am]concat=n=2:v=0:a=1[a]',
  ].join(';');
  return runFfmpeg([
    '-r', String(fps), '-i', file, '-ss', String(start), '-t', String(D + L), '-i', input,
    '-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-r', String(fps),
    ...outputArgs({ crf, preset }), '-t', String(D), '-movflags', '+faststart', output,
  ]).done;
}

function makeBackground(bg, palette, cover, mode) {
  const { width, height } = bg;
  const ctx = bg.getContext('2d');
  if (mode === 'black') {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
  } else if (mode === 'cover' && cover) {
    ctx.fillStyle = palette.bg[1];
    ctx.fillRect(0, 0, width, height);
    const blur = Math.round(Math.min(width, height) * 0.05);
    ctx.filter = `blur(${blur}px) brightness(40%) saturate(130%)`;
    drawCover(ctx, cover, -blur * 2, -blur * 2, width + blur * 4, height + blur * 4);
    ctx.filter = 'none';
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, palette.bg[0]);
    g.addColorStop(1, palette.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }
  // Vignette keeps edges dark so the visual pops in the middle.
  const v = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.3, width / 2, height / 2, Math.max(width, height) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, width, height);
  return bg;
}

function drawText(ctx, env, title, subtitle, font) {
  if (!title && !subtitle) return;
  const { width, u, palette, textY } = env;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = palette.text;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 18 * u;
  let y = textY;
  if (title) {
    ctx.font = `bold ${Math.round(76 * u)}px ${font}`;
    ctx.letterSpacing = `${Math.round(6 * u)}px`;
    ctx.fillText(title, width / 2, y, width * 0.9);
    y += 78 * u;
  }
  if (subtitle) {
    ctx.font = `${Math.round(38 * u)}px ${font}`;
    ctx.letterSpacing = `${Math.round(10 * u)}px`;
    ctx.globalAlpha = 0.85;
    ctx.fillText(subtitle, width / 2, y, width * 0.9);
  }
  ctx.restore();
}

// ASCII overlay: the finished frame is redrawn as characters, each cell's
// brightness picking a denser glyph and a lighter grey.
const ASCII_RAMP = ' .:-=+*#%@';
const ASCII_FONT = 'Menlo, monospace';

function makeAscii(width, height, cell, createCanvas) {
  const probe = createCanvas(10, 10).getContext('2d');
  probe.font = `100px ${ASCII_FONT}`;
  const fontSize = (cell / probe.measureText('M').width) * 100; // one character per cell
  const cellH = Math.round(fontSize * 1.05);
  const cols = Math.ceil(width / cell), rows = Math.ceil(height / cellH);
  const levels = ASCII_RAMP.length;
  const greys = Array.from({ length: levels }, (_, i) => {
    const v = Math.round(40 + 215 * (i / (levels - 1)) ** 0.8);
    return `rgb(${v},${v},${v})`;
  });
  const SUB = 3; // 3×3 samples per cell, so thin bright lines aren't averaged away
  const small = createCanvas(cols * SUB, rows * SUB);
  const lines = Array.from({ length: levels }, () => new Array(rows));
  const lums = new Float32Array(cols * rows);
  let blackPoint = null;
  return function apply(canvas) {
    small.width = cols * SUB; // reset the recording, see util.flatten
    const sctx = small.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(canvas, 0, 0, cols * SUB, rows * SUB);
    const { data } = sctx.getImageData(0, 0, cols * SUB, rows * SUB);
    const stride = cols * SUB * 4;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Brightness = mix of the cell's average and its brightest sample, so
        // thin lines survive. Luma/max blend so saturated colours still count.
        let sum = 0, peak = 0;
        for (let sy = 0; sy < SUB; sy++) {
          for (let sx = 0; sx < SUB; sx++) {
            const i = (r * SUB + sy) * stride + (c * SUB + sx) * 4;
            const R = data[i], G = data[i + 1], B = data[i + 2];
            const v = (0.5 * (0.2126 * R + 0.7152 * G + 0.0722 * B) + 0.5 * Math.max(R, G, B)) / 255;
            sum += v;
            if (v > peak) peak = v;
          }
        }
        lums[r * cols + c] = 0.45 * (sum / (SUB * SUB)) + 0.55 * peak;
      }
    }
    // The background (whatever most of the frame is) becomes empty space.
    // Smoothed over time so it doesn't pump.
    const median = Float32Array.from(lums).sort()[lums.length >> 1];
    const target = Math.max(0.09, median + 0.05);
    blackPoint = blackPoint === null ? target : blackPoint + (target - blackPoint) * 0.1;
    const range = 1 - blackPoint;

    // One string per row per brightness level: spaces everywhere else.
    const row = new Array(cols);
    for (let r = 0; r < rows; r++) {
      const lv = new Uint8Array(cols);
      for (let c = 0; c < cols; c++) {
        const x = Math.max(0, Math.min(1, ((lums[r * cols + c] - blackPoint) / range) * 1.1));
        lv[c] = Math.min(levels - 1, Math.floor(x ** 0.85 * levels));
      }
      for (let l = 1; l < levels; l++) {
        let any = false;
        for (let c = 0; c < cols; c++) {
          if (lv[c] === l) { row[c] = ASCII_RAMP[l]; any = true; } else row[c] = ' ';
        }
        lines[l][r] = any ? row.join('') : null;
      }
    }

    canvas.width = width;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.font = `${fontSize}px ${ASCII_FONT}`;
    ctx.textBaseline = 'top';
    for (let l = 1; l < levels; l++) {
      ctx.fillStyle = greys[l];
      for (let r = 0; r < rows; r++) if (lines[l][r]) ctx.fillText(lines[l][r], 0, r * cellH);
    }
    return ctx;
  };
}

export const transitions = ['fade', 'black', 'flash', 'cut', 'wipe', 'zoom', 'glitch', 'kick'];
// Blend lengths for transitions that should be quick unless asked otherwise.
export const quickBlend = { flash: 0.8, zoom: 0.8, glitch: 0.6, wipe: 1.2 };

const smoothstep = (x) => x * x * (3 - 2 * x);

// Works out which scene(s) are visible at track time t and how they mix.
// Returns { a, b, ... }: draw a, then b on top as described by one of
// `mix` (opacity), `wipe` (0 → 1 sweep) or `glitch` (0 → 1 through the
// glitch); `zoom` punches the picture in; `overlay` (an rgba string) goes over
// everything.
function mixScenes(scenes, t) {
  let i = 0;
  while (i + 1 < scenes.length && scenes[i + 1].time <= t) i++;
  const cur = scenes[i];
  const prev = scenes[i - 1];
  const x = prev && cur.blend > 0 ? (t - cur.time) / cur.blend : 1;
  if (!prev || x >= 1 || cur.transition === 'cut' || cur.transition === 'kick') return { a: cur };
  switch (cur.transition) {
    case 'black': // dip to black: old fades out, new fades in
      return x < 0.5
        ? { a: prev, overlay: `rgba(0,0,0,${smoothstep(x * 2)})` }
        : { a: cur, overlay: `rgba(0,0,0,${smoothstep((1 - x) * 2)})` };
    case 'flash': // hard cut with a white flash that decays
      return { a: cur, overlay: `rgba(255,255,255,${(1 - x) ** 2 * 0.9})` };
    case 'zoom': // hard cut that lands zoomed in and springs back
      return { a: cur, zoom: (1 - x) ** 2, overlay: `rgba(255,255,255,${(1 - x) ** 4 * 0.6})` };
    case 'wipe': // a slanted edge sweeps the new scene in from the left
      return { a: prev, b: cur, wipe: smoothstep(x) };
    case 'glitch': // torn slices of both scenes, settling on the new one
      return { a: prev, b: cur, glitch: x };
    default: // crossfade
      return { a: prev, b: cur, mix: smoothstep(x) };
  }
}

function resolvePalette(name, { grayscale, style, cover }) {
  if (!name && grayscale) return palettes.gloom;
  if (!name && style.palette) return palettes[style.palette];
  if (name === 'auto' || (!name && cover)) {
    if (!cover) throw new Error('--palette auto needs --cover <image> to pull colours from');
    return paletteFromImage(new Canvas(48, 48).getContext('2d'), cover);
  }
  const palette = palettes[name ?? 'neon'];
  if (!palette) throw new Error(`Unknown palette "${name}". Try: ${Object.keys(palettes).join(', ')}, auto`);
  return palette;
}


// Slanted edge sweeping left → right, new scene (`layer`) on its left.
function drawWipe(ctx, layer, w, { width, height, u, palette }) {
  const slant = height * 0.18;
  const edge = -slant + (width + slant) * w; // where the edge meets the bottom
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-1, -1);
  ctx.lineTo(edge + slant, -1);
  ctx.lineTo(edge, height + 1);
  ctx.lineTo(-1, height + 1);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = Math.sin(Math.PI * w);
  ctx.strokeStyle = palette.text;
  ctx.lineWidth = 4 * u;
  ctx.shadowColor = palette.accent;
  ctx.shadowBlur = 30 * u;
  ctx.beginPath();
  ctx.moveTo(edge + slant, 0);
  ctx.lineTo(edge, height);
  ctx.stroke();
  ctx.restore();
}

// Horizontal slices taken from the old frame (`copy`) or the new scene
// (`layer`), more of the new one as x goes 0 → 1, torn sideways mid-way.
function drawGlitch(ctx, copy, layer, x, frame, { width, height, u }) {
  const random = rng(frame.index * 104729 + 7);
  const p = smoothstep(x), chaos = Math.sin(Math.PI * x);
  for (let y = 0; y < height;) {
    const h = (6 + random() ** 2 * 160) * u;
    const fromNew = random() < p;
    const dx = random() < 0.5 ? (random() - 0.5) * 140 * u * chaos : 0;
    ctx.drawImage(fromNew ? layer : copy, 0, y, width, h, dx, y, width, h);
    if (random() < 0.15 * chaos) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = random() < 0.5 ? 'rgba(255,0,70,0.3)' : 'rgba(0,255,230,0.3)';
      ctx.fillRect(0, y, width, h);
      ctx.restore();
    }
    y += h;
  }
}

export async function render(opts) {
  const {
    input, output, width, height, fps = 30, start = 0, duration,
    cover: coverPath, background, title, subtitle, scenes: sceneSpecs,
    fade: wantFade = true, crf = 18, preset = 'medium', seed = 1, grayscale = false, grain, ascii = 0,
    fx = {}, loop = 0, drums, grid: givenGrid,
    font = '"Helvetica Neue", Helvetica, Arial, sans-serif', gpu = false, onStage, onProgress,
  } = opts;
  const fade = wantFade && !loop; // a loop has no start or end to fade

  onStage?.('Analysing audio');
  // A loop renders past the end to crossfade from, plus room to round the
  // length to whole bars.
  const want = duration === undefined ? undefined : duration + (loop ? loop + 4 : 0);
  const analysis = await analyze(input, { start, duration: want, fps });
  if (drums) {
    // Hits and the kick pulse come from the drum stem; everything else from the mix.
    onStage?.('Analysing drums');
    const d = await analyze(drums, { start, duration: want, fps }).catch((err) => {
      throw new Error(`--drums: ${err.message}`);
    });
    analysis.frames.forEach((f, i) => {
      const g = d.frames[i];
      if (g) Object.assign(f, { kick: g.kick, kickStrength: g.kickStrength, onset: g.onset, onsetStrength: g.onsetStrength, pulse: g.pulse });
      else Object.assign(f, { kick: false, kickStrength: 0, onset: false, onsetStrength: 0, pulse: 0 });
    });
    analysis.stats = d.stats;
  }
  // Beat grid from the whole track (a clip alone is too short to be sure of
  // the tempo), so it lines up with --snap and --hook too.
  const grid = givenGrid !== undefined ? givenGrid : await trackGrid(input);

  // Frames in the finished video, and (for --loop) how many more get rendered
  // past them to crossfade back into the start.
  const available = analysis.frames.length;
  let outFrames = duration === undefined ? available : Math.min(available, Math.round(duration * fps));
  let overlap = 0;
  if (loop) {
    overlap = Math.max(1, Math.round(loop * fps));
    outFrames = Math.min(outFrames, available - overlap);
    if (grid) {
      // Whole bars, so the beat doesn't stumble at the loop point.
      const bar = grid.period * BEATS_PER_BAR * fps;
      let bars = Math.max(1, Math.round(outFrames / bar));
      while (bars > 1 && Math.round(bars * bar) + overlap > available) bars--;
      outFrames = Math.min(Math.round(bars * bar), available - overlap);
    }
    if (outFrames < overlap * 2) throw new Error(`--loop ${loop}: the clip is too short to loop with a ${loop}s crossfade`);
  }
  const frames = analysis.frames.slice(0, outFrames + overlap);
  frames.forEach((f) => (f.progress = Math.min(1, outFrames > 1 ? f.index / (outFrames - 1) : 0)));
  tagFrames(frames, grid, fps, start);
  Object.assign(analysis, { frames, grid, bpm: grid?.bpm ?? null });
  const clipDuration = outFrames / fps;

  const cover = coverPath ? await loadImage(coverPath) : null;
  const createCanvas = (w, h) => Object.assign(new Canvas(w, h), { gpu });
  const canvas = createCanvas(width, height);
  let ctx = canvas.getContext('2d');
  const layer = createCanvas(width, height); // second scene during a transition
  const copy = createCanvas(width, height); // the old frame, for glitch transitions
  const tall = height / width > 1.5;
  const u = Math.min(width, height) / 1080;
  const asciiPass = ascii > 0 ? makeAscii(width, height, ascii * u, createCanvas) : null;
  const fxPass = makeFx(fx, { width, height, u, createCanvas });
  const bgMode = background ?? (cover ? 'cover' : 'gradient');

  // `kick` transitions wait for the first kick at (or just after) their time,
  // up to a bar late.
  const specs = sceneSpecs.map((sc) => {
    if (sc.transition !== 'kick') return sc;
    const late = grid ? grid.period * BEATS_PER_BAR : 1.5;
    const hit = frames.find((f) => f.kick && start + f.time >= sc.time - 0.05 && start + f.time <= sc.time + late);
    return hit ? { ...sc, time: start + hit.time } : sc;
  });

  // Each scene gets its own style instance (styles keep state on `this`),
  // palette, background and params. Params written as expressions
  // (spin=bass*0.1) are re-evaluated every frame.
  const scenes = [];
  for (const [i, spec] of specs.sort((a, b) => a.time - b.time).entries()) {
    const palette = resolvePalette(spec.palette, { grayscale, style: spec.style, cover });
    const params = { ...spec.style.params, ...spec.params };
    const mods = compileParams(params);
    for (const [k, fn] of mods) params[k] = fn(frames[0]);
    const env = {
      width, height, fps, u,
      cx: width / 2,
      cy: height * (tall ? 0.44 : title || subtitle ? 0.45 : 0.5), // sits above the Reels caption area
      textY: height * (tall ? 0.72 : 0.86),
      palette,
      params,
      cover,
      analysis,
      duration: clipDuration,
      random: rng(seed + i),
      createCanvas,
    };
    const style = Object.create(spec.style);
    await style.setup?.(ctx, env);
    scenes.push({
      ...spec, style, env, palette, mods,
      bg: makeBackground(createCanvas(width, height), palette, cover, bgMode),
    });
  }

  const drawScene = (c, scene, frame) => {
    const { env, palette, bg } = scene;
    for (const [k, fn] of scene.mods) env.params[k] = fn(frame);
    c.save();
    // Background breathes slightly with the kick.
    const zoom = 1 + 0.035 * frame.pulse;
    c.translate(width / 2, height / 2);
    c.scale(zoom, zoom);
    c.drawImage(bg, -width / 2, -height / 2);
    c.restore();

    if (bgMode !== 'black') {
      c.save();
      const glow = c.createRadialGradient(env.cx, env.cy, 0, env.cx, env.cy, Math.max(width, height) * 0.6);
      glow.addColorStop(0, rgba(palette.accent, 0.06 + 0.14 * frame.bass));
      glow.addColorStop(1, rgba(palette.accent, 0));
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = glow;
      c.fillRect(0, 0, width, height);
      c.restore();
    }

    c.save();
    scene.style.draw(c, frame, env);
    c.restore();
  };
  const drawLayer = (scene, frame) => {
    layer.width = width;
    drawScene(layer.getContext('2d'), scene, frame);
  };

  onStage?.('Rendering');
  let tmpDir = null;
  if (loop) tmpDir = await mkdtemp(path.join(os.tmpdir(), 'viz-loop-'));
  const loopFile = tmpDir && path.join(tmpDir, 'source.mkv');
  const sink = loop
    ? loopSource({ file: loopFile, width, height, fps, preset })
    : encoder({
      input, output, width, height, fps, start, duration: clipDuration, fade, crf, preset,
      grayscale, grain: grain ?? (grayscale ? 10 : 0),
    });
  const write = async (buf) => {
    if (!sink.ff.stdin.write(buf)) await Promise.race([once(sink.ff.stdin, 'drain'), sink.done]);
  };
  // Frames are drawn in order (styles keep state between frames), but turning
  // each drawing into pixels runs in the background on skia's thread pool,
  // several frames at a time. Output is identical to doing it one by one.
  const depth = Math.max(2, Math.min(8, os.availableParallelism?.() ?? 4));
  const pending = [];
  const startedAt = Date.now();

  try {
    for (const frame of frames) {
      // Resetting the size clears skia-canvas's recorded draw calls, so frame
      // cost stays constant instead of growing over the clip.
      canvas.width = width;
      ctx = canvas.getContext('2d');

      const { a, b, mix, overlay, wipe, zoom, glitch } = mixScenes(scenes, start + frame.time);
      ctx.save();
      fxPass?.shake(ctx, frame);
      if (zoom) {
        const s = 1 + 0.25 * zoom;
        ctx.translate(width / 2, height / 2);
        ctx.scale(s, s);
        ctx.translate(-width / 2, -height / 2);
      }
      drawScene(ctx, a, frame);
      if (b && glitch === undefined) {
        drawLayer(b, frame);
        if (wipe !== undefined) drawWipe(ctx, layer, wipe, b.env);
        else {
          ctx.globalAlpha = mix;
          ctx.drawImage(layer, 0, 0);
          ctx.globalAlpha = 1;
        }
      }
      if (overlay) {
        ctx.fillStyle = overlay;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
      if (glitch !== undefined) {
        copy.width = width;
        copy.getContext('2d').drawImage(canvas, 0, 0);
        drawLayer(b, frame);
        drawGlitch(ctx, copy, layer, glitch, frame, { width, height, u });
      }

      if (fxPass) ctx = fxPass.apply(canvas, ctx, frame);
      if (asciiPass) ctx = asciiPass(canvas);

      const newer = b && Math.max(mix ?? 0, wipe ?? 0, glitch ?? 0) > 0.5;
      const textScene = newer ? b : a;
      // Keep titles grey too in ASCII mode.
      const textEnv = asciiPass ? { ...textScene.env, palette: { ...textScene.env.palette, text: '#e6e6e6' } } : textScene.env;
      drawText(ctx, textEnv, title, subtitle, font);

      if (fade) {
        const t = frame.time;
        const f = Math.max(t < FADE_IN ? 1 - t / FADE_IN : 0, t > clipDuration - FADE_OUT ? (t - (clipDuration - FADE_OUT)) / FADE_OUT : 0);
        if (f > 0) {
          ctx.fillStyle = `rgba(0,0,0,${Math.min(1, f)})`;
          ctx.fillRect(0, 0, width, height);
        }
      }

      pending.push(canvas.toBuffer('raw'));
      if (pending.length >= depth) await write(await pending.shift());
      onProgress?.(frame.index + 1, frames.length, (Date.now() - startedAt) / 1000);
    }
    for (const p of pending.splice(0)) await write(await p);
    sink.ff.stdin.end();
    onStage?.('Encoding');
    await sink.done;
    if (loop) {
      onStage?.('Joining the loop');
      await loopFinish({
        file: loopFile, input, output, fps, start, out: outFrames, overlap, crf, preset,
        grayscale, grain: grain ?? (grayscale ? 10 : 0),
      });
    }
  } finally {
    sink.ff.stdin.destroy();
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  }
  return { frames: outFrames, duration: clipDuration, stats: analysis.stats, bpm: analysis.bpm, loopBars: loop && grid ? Math.round(clipDuration / (grid.period * BEATS_PER_BAR)) : null };
}
