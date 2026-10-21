// Small helpers shared by styles.
import { Path2D } from 'skia-canvas';

// Resample a spectrum to n values (linear interpolation).
export function sampleSpectrum(spectrum, n) {
  const out = new Float32Array(n);
  const last = spectrum.length - 1;
  for (let i = 0; i < n; i++) {
    const x = (i / Math.max(1, n - 1)) * last;
    const a = Math.floor(x);
    const b = Math.min(last, a + 1);
    out[i] = spectrum[a] + (spectrum[b] - spectrum[a]) * (x - a);
  }
  return out;
}

// Downsample a waveform to n points by averaging, for smooth lines.
export function sampleWaveform(wave, n) {
  const out = new Float32Array(n);
  const step = wave.length / n;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const a = Math.floor(i * step), b = Math.max(a + 1, Math.floor((i + 1) * step));
    for (let j = a; j < b; j++) sum += wave[j];
    out[i] = sum / (b - a);
  }
  return out;
}

// Deterministic RNG so the same command always renders the same video.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Draws an image scaled to cover a box (like CSS object-fit: cover).
export function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

// skia-canvas records draw calls and replays them on every read. A canvas that
// is drawn on across frames (trails, feedback) gets slower each frame unless
// it's flattened back to plain pixels. Returns the fresh context.
export function flatten(canvas) {
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = canvas.width; // resets the recording
  const ctx = canvas.getContext('2d');
  ctx.putImageData(pixels, 0, 0);
  return ctx;
}

// A tapered body (snake, neck, tentacle) along `pts`, each { x, y, w } with
// w the half-width there, as one closed path.
export function ribbon(pts) {
  const path = new Path2D();
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l, w = pts[i].w;
    left.push([pts[i].x + nx * w, pts[i].y + ny * w]);
    right.push([pts[i].x - nx * w, pts[i].y - ny * w]);
  }
  path.moveTo(...left[0]);
  for (const p of left.slice(1)) path.lineTo(...p);
  for (const p of right.reverse()) path.lineTo(...p);
  path.closePath();
  return path;
}
