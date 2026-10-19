// Shared by the styles set under the sea (abyss, drowned): the surface seen
// from below, light shafts, bubbles and drifting specks.
import { Path2D } from 'skia-canvas';
import { hexToRgb, rgba } from './palettes.js';
import { clamp } from './util.js';

const TAU = Math.PI * 2;

// The surface from below: a bright rippling line carrying the waveform, with
// the sky glowing through above it and fading caustic lines underneath.
export function drawSurface(ctx, sea, { y, amp, env, pulse }) {
  const { width, u, palette } = env;
  const line = new Path2D();
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * width;
    const yy = y + sea.waveAt(x) * amp + Math.sin(x * 0.01 + sea.phase * 2) * amp * 0.25;
    i ? line.lineTo(x, yy) : line.moveTo(x, yy);
  }
  const sky = new Path2D(line);
  sky.lineTo(width, 0);
  sky.lineTo(0, 0);
  sky.closePath();
  ctx.globalCompositeOperation = 'lighter';
  const grad = ctx.createLinearGradient(0, 0, 0, y + amp);
  grad.addColorStop(0, rgba(palette.colors[1], 0.08));
  grad.addColorStop(1, rgba(palette.colors[2], 0.22 + 0.15 * pulse));
  ctx.fillStyle = grad;
  ctx.fill(sky);
  ctx.lineJoin = 'round';
  for (const [w, a] of [[16, 0.06], [5, 0.15], [1.8, 0.8]]) {
    ctx.lineWidth = w * u;
    ctx.strokeStyle = rgba(palette.colors[2], a * (0.7 + 0.3 * pulse));
    ctx.stroke(line);
  }
  // Caustics: fainter copies of the surface just below it.
  for (let k = 1; k <= 3; k++) {
    ctx.save();
    ctx.translate(Math.sin(sea.phase * 1.3 + k) * 20 * u, k * amp * 1.6);
    ctx.lineWidth = 1.2 * u;
    ctx.strokeStyle = rgba(palette.colors[2], 0.22 / k);
    ctx.stroke(line);
    ctx.restore();
  }
}

// One light shaft, drawn once and stretched: bright at the top, soft at the
// sides, fading out downwards.
export function shaftSprite(env, color) {
  const W = 64, H = 256;
  const c = env.createCanvas(W, H);
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const rgb = hexToRgb(color);
  for (let y = 0; y < H; y++) {
    const fade = (1 - y / H) ** 1.6;
    for (let x = 0; x < W; x++) {
      const v = (x - W / 2) / (W / 2);
      const o = (y * W + x) * 4;
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2];
      img.data[o + 3] = Math.round(255 * fade * Math.exp(-v * v * 3));
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function makeShafts(random, n) {
  return Array.from({ length: Math.round(n) }, () => ({
    x: random(), w: 0.05 + random() * 0.1, angle: (random() - 0.5) * 0.35, len: 0.55 + random() * 0.4,
    phase: random() * TAU, speed: 0.2 + random() * 0.4,
  }));
}

// Shafts slanting down from the surface, swaying and shimmering with the highs.
export function drawShafts(ctx, shafts, { sprite, top, amount, t, high, pulse, env }) {
  if (amount <= 0) return;
  const { width, height } = env;
  ctx.globalCompositeOperation = 'lighter';
  for (const s of shafts) {
    const x = (s.x + Math.sin(t * s.speed * 0.3 + s.phase) * 0.04) * width;
    const flicker = 0.6 + 0.25 * Math.sin(t * 3 * s.speed + s.phase) + 0.35 * high;
    ctx.save();
    ctx.translate(x, top);
    ctx.rotate(s.angle + Math.sin(t * s.speed + s.phase) * 0.05);
    ctx.globalAlpha = clamp(0.22 * amount * flicker * (0.8 + 0.4 * pulse));
    const w = s.w * width;
    ctx.drawImage(sprite, -w / 2, 0, w, s.len * height);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// Bubbles: spawned in bursts, wobbling up and popping at the surface.
export class Bubbles {
  constructor(env) {
    this.env = env;
    this.list = [];
  }

  spawn(x, y, n, size = 1) {
    const { u, random } = this.env;
    for (let i = 0; i < n; i++) {
      this.list.push({ x: x + (random() - 0.5) * 20 * u, y, r: (1.5 + random() * 4) * u * size, vy: (40 + random() * 60) * u, phase: random() * TAU });
    }
  }

  draw(ctx, { top, dt, t, alpha = 1 }) {
    const { u, palette } = this.env;
    const path = new Path2D();
    for (const b of this.list) {
      b.y -= b.vy * dt * (1 + b.r / (6 * u));
      b.x += Math.sin(t * 5 + b.phase) * 18 * u * dt;
      b.r *= 1 + 0.08 * dt; // they swell as they rise
      path.moveTo(b.x + b.r, b.y);
      path.arc(b.x, b.y, b.r, 0, TAU);
    }
    this.list = this.list.filter((b) => b.y > top);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.2 * u;
    ctx.strokeStyle = rgba(palette.colors[2], 0.6 * alpha);
    ctx.stroke(path);
    ctx.fillStyle = rgba(palette.colors[2], 0.08 * alpha);
    ctx.fill(path);
  }
}

export function makeSnow(random, n, u) {
  return Array.from({ length: Math.round(n) }, () => ({
    x: random(), y: random(), r: (0.6 + random() * 1.6) * u, v: 0.004 + random() * 0.01, phase: random() * TAU,
  }));
}

// Marine snow: specks sinking slowly, swirling a little with the mids.
export function drawSnow(ctx, snow, { dt, t, mid, env }) {
  const { width, height, palette } = env;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = rgba(palette.text, 0.35);
  for (const s of snow) {
    s.y += s.v * dt * 3;
    s.x += Math.sin(t * 0.5 + s.phase) * 0.004 * dt * (1 + 3 * mid);
    if (s.y > 1) { s.y = 0; s.x = (s.x + 0.31) % 1; }
    ctx.fillRect(((s.x % 1) + 1) % 1 * width, s.y * height, s.r, s.r);
  }
}
