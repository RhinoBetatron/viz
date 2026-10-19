import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Canvas, loadImage } from 'skia-canvas';
import { analyze } from './audio.js';
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

function encoder({ input, output, width, height, fps, start, duration, fade, crf, preset, grayscale, grain }) {
  const args = [
    '-y', '-v', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0',
    '-ss', String(start), '-t', String(duration), '-i', input,
    '-map', '0:v', '-map', '1:a',
    '-vf', videoFilters({ grayscale, grain }),
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-profile:v', 'high',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '320k', '-ar', '48000',
  ];
  if (fade) args.push('-af', `afade=t=in:d=${FADE_IN},afade=t=out:st=${Math.max(0, duration - FADE_OUT)}:d=${FADE_OUT}`);
  args.push('-t', String(duration), '-movflags', '+faststart', output);

  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  ff.stderr.on('data', (c) => (stderr += c));
  const done = new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}:\n${stderr.trim()}`))));
  });
  ff.stdin.on('error', () => {}); // surfaced through `done` instead
  return { ff, done };
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

export const transitions = ['fade', 'black', 'flash', 'cut'];

const smoothstep = (x) => x * x * (3 - 2 * x);

// Works out which scene(s) are visible at track time t and how they mix.
// Returns { a, b, mix, overlay }: draw a, then b on top at opacity `mix`,
// then fill `overlay` (an rgba string) over both if set.
function mixScenes(scenes, t) {
  let i = 0;
  while (i + 1 < scenes.length && scenes[i + 1].time <= t) i++;
  const cur = scenes[i];
  const prev = scenes[i - 1];
  const x = prev && cur.blend > 0 ? (t - cur.time) / cur.blend : 1;
  if (!prev || x >= 1 || cur.transition === 'cut') return { a: cur };
  switch (cur.transition) {
    case 'black': // dip to black: old fades out, new fades in
      return x < 0.5
        ? { a: prev, overlay: `rgba(0,0,0,${smoothstep(x * 2)})` }
        : { a: cur, overlay: `rgba(0,0,0,${smoothstep((1 - x) * 2)})` };
    case 'flash': // hard cut with a white flash that decays
      return { a: cur, overlay: `rgba(255,255,255,${(1 - x) ** 2 * 0.9})` };
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

export async function render(opts) {
  const {
    input, output, width, height, fps = 30, start = 0, duration,
    cover: coverPath, background, title, subtitle, scenes: sceneSpecs,
    fade = true, crf = 18, preset = 'medium', seed = 1, grayscale = false, grain, ascii = 0,
    font = '"Helvetica Neue", Helvetica, Arial, sans-serif', gpu = false, onStage, onProgress,
  } = opts;

  onStage?.('Analysing audio');
  const analysis = await analyze(input, { start, duration, fps });
  const { frames } = analysis;
  const clipDuration = frames.length / fps;

  const cover = coverPath ? await loadImage(coverPath) : null;
  const createCanvas = (w, h) => Object.assign(new Canvas(w, h), { gpu });
  const canvas = createCanvas(width, height);
  let ctx = canvas.getContext('2d');
  const layer = createCanvas(width, height); // second scene during a crossfade
  const tall = height / width > 1.5;
  const asciiPass = ascii > 0 ? makeAscii(width, height, ascii * (Math.min(width, height) / 1080), createCanvas) : null;
  const bgMode = background ?? (cover ? 'cover' : 'gradient');

  // Each scene gets its own style instance (styles keep state on `this`),
  // palette, background and params.
  const scenes = [];
  for (const [i, spec] of [...sceneSpecs].sort((a, b) => a.time - b.time).entries()) {
    const palette = resolvePalette(spec.palette, { grayscale, style: spec.style, cover });
    const env = {
      width, height, fps,
      u: Math.min(width, height) / 1080, // 1 "unit" = 1px at 1080p; scale every size by this
      cx: width / 2,
      cy: height * (tall ? 0.44 : title || subtitle ? 0.45 : 0.5), // sits above the Reels caption area
      textY: height * (tall ? 0.72 : 0.86),
      palette,
      params: { ...spec.style.params, ...spec.params },
      cover,
      analysis,
      duration: clipDuration,
      random: rng(seed + i),
      createCanvas,
    };
    const style = Object.create(spec.style);
    await style.setup?.(ctx, env);
    scenes.push({
      ...spec, style, env, palette,
      bg: makeBackground(createCanvas(width, height), palette, cover, bgMode),
    });
  }

  const drawScene = (c, scene, frame) => {
    const { env, palette, bg } = scene;
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

  onStage?.('Rendering');
  const { ff, done } = encoder({
    input, output, width, height, fps, start, duration: clipDuration, fade, crf, preset,
    grayscale, grain: grain ?? (grayscale ? 10 : 0),
  });
  const startedAt = Date.now();

  for (const frame of frames) {
    // Resetting the size clears skia-canvas's recorded draw calls, so frame
    // cost stays constant instead of growing over the clip.
    canvas.width = width;
    ctx = canvas.getContext('2d');

    const { a, b, mix, overlay } = mixScenes(scenes, start + frame.time);
    drawScene(ctx, a, frame);
    if (b) {
      layer.width = width;
      drawScene(layer.getContext('2d'), b, frame);
      ctx.globalAlpha = mix;
      ctx.drawImage(layer, 0, 0);
      ctx.globalAlpha = 1;
    }
    if (overlay) {
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, width, height);
    }

    if (asciiPass) ctx = asciiPass(canvas);

    const textScene = b && mix > 0.5 ? b : a;
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

    if (!ff.stdin.write(canvas.toBufferSync('raw'))) {
      await Promise.race([once(ff.stdin, 'drain'), done]);
    }
    onProgress?.(frame.index + 1, frames.length, (Date.now() - startedAt) / 1000);
  }
  ff.stdin.end();
  onStage?.('Encoding');
  await done;
  return { frames: frames.length, duration: clipDuration, stats: analysis.stats };
}
