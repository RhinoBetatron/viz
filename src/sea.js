// The night sea shared by ghostship, lighthouse and friends: layered waves
// whose crests carry the live waveform, plus the sky over them (stars, moon,
// fog banks, moonlight on the water).
import { Path2D } from 'skia-canvas';
import { mix, rgba } from './palettes.js';
import { clamp, sampleWaveform } from './util.js';

const TAU = Math.PI * 2;
const CHOP_POINTS = 48;   // waveform samples across the sea surface
const SEA_POINTS = 110;   // points per wave line

// Soft glow dot, stamped with drawImage (much cheaper than shadowBlur).
export function glowSprite(env, color, size) {
  const s = Math.round(size);
  const c = env.createCanvas(s * 2, s * 2);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s, s, 0, s, s, s);
  grad.addColorStop(0, rgba(color, 1));
  grad.addColorStop(0.2, rgba(color, 0.4));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, s * 2, s * 2);
  return c;
}

// Layered sea. Layer 0 is the farthest; `anchor` is the layer things float
// on, so a style draws layers below it, then its subject, then the rest.
//   size       the style's scale in px (wave heights and spacing follow it)
//   waterY     screen y of the anchor layer
//   seeThrough how transparent the near layers are (shows what's under them)
//   chopMain   waveform height on the anchor layer
//   bump(l, x) extra offset, e.g. water heaping up against a rock
export class Sea {
  constructor(env, { size, waterY, anchor = 0.4, seeThrough = 0.1, chopMain = 0.1, bump = null }) {
    const p = env.params;
    this.env = env;
    this.S = size;
    this.waterY = waterY;
    this.seeThrough = seeThrough;
    this.chopMain = chopMain;
    this.bump = bump;
    this.layers = Math.max(2, Math.min(6, Math.round(p.waves ?? 5)));
    this.anchor = Math.max(0, Math.min(this.layers - 1, Math.round((this.layers - 1) * anchor)));
    this.phase = 0;
    this.chop = new Float32Array(CHOP_POINTS);
    this.peak = 0.05;
    this.bass = 0;
    this.pulse = 0;
  }

  // Rolls the swell on and eases the waveform in, so it rolls instead of buzzing.
  update(frame, dt, speed = 1) {
    this.bass = frame.bass;
    this.pulse = frame.pulse;
    this.phase += dt * speed * (0.9 + 1.6 * frame.rms);
    const raw = sampleWaveform(frame.waveform, CHOP_POINTS);
    let peak = 0;
    for (const v of raw) peak = Math.max(peak, Math.abs(v));
    this.peak = Math.max(this.peak * 0.995, peak, 0.02);
    for (let i = 0; i < CHOP_POINTS; i++) {
      const edge = Math.min(1, i / 4, (CHOP_POINTS - 1 - i) / 4);
      this.chop[i] += ((raw[i] / this.peak) * edge - this.chop[i]) * 0.45;
    }
  }

  // Waveform sample i (wraps), for things that wobble with the water.
  wave(i) {
    return this.chop[((i % CHOP_POINTS) + CHOP_POINTS) % CHOP_POINTS];
  }

  // Height of layer `l` at screen x.
  y(l, x) {
    const { width, height, params: p } = this.env;
    const n = this.layers, d = n > 1 ? l / (n - 1) : 1, k = this.anchor;
    // Far layers bunch up towards the horizon, near ones spread to the bottom.
    const base = l <= k
      ? this.waterY - (k - l) * this.S * 0.07
      : this.waterY + ((l - k) / Math.max(1, n - 1 - k)) ** 1.3 * Math.min(height * 0.92 - this.waterY, this.S * 0.85);
    const amp = this.S * 0.07 * (0.4 + 1.1 * d) * (p.swell ?? 1) * (0.45 + 1.1 * this.bass);
    const ph = this.phase * (0.7 + 0.5 * d) + l * 1.9;
    const swell = Math.sin((x / width) * TAU * 1.1 + ph) * 0.6
      + Math.sin((x / width) * TAU * 2.3 - ph * 1.3 + l) * 0.3
      + Math.sin((x / width) * TAU * 4.7 + ph * 1.7 + l * 3) * 0.1;
    // The waveform itself, shifted per layer so the layers don't match.
    const cx = ((x / width) * (CHOP_POINTS - 1) + l * 11) % (CHOP_POINTS - 1);
    const i = Math.floor(cx);
    const wave = this.chop[i] + (this.chop[i + 1] - this.chop[i]) * (cx - i);
    const chopAmp = this.S * (l === k ? this.chopMain : 0.04 + 0.06 * d) * (p.chop ?? 1);
    return base + swell * amp + wave * chopAmp + (this.bump ? this.bump(l, x) : 0);
  }

  draw(ctx, l) {
    const { width, height, u, palette } = this.env;
    const n = this.layers, d = n > 1 ? l / (n - 1) : 1;
    const line = new Path2D();
    for (let i = 0; i <= SEA_POINTS; i++) {
      const x = (i / SEA_POINTS) * (width + 40 * u) - 20 * u;
      const y = this.y(l, x);
      i ? line.lineTo(x, y) : line.moveTo(x, y);
    }
    const body = new Path2D(line);
    body.lineTo(width + 20 * u, height);
    body.lineTo(-20 * u, height);
    body.closePath();

    // Far water is paler (haze), near water darker and slightly see-through.
    const top = this.y(l, 0) - this.S * 0.15;
    const grad = ctx.createLinearGradient(0, top, 0, height);
    grad.addColorStop(0, rgba(mix(palette.bg[1], palette.colors[0], 0.75 - 0.4 * d), 0.97 - this.seeThrough * d));
    grad.addColorStop(1, rgba(palette.bg[0], 0.98));
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = grad;
    ctx.fill(body);

    // Glowing crest: a wide faint halo under a thin bright line.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    const crest = l === this.anchor ? palette.colors[2] : palette.colors[1];
    const lift = 0.5 + 0.5 * this.pulse;
    ctx.strokeStyle = rgba(crest, (0.05 + 0.08 * d) * lift);
    ctx.lineWidth = (10 + 8 * d) * u;
    ctx.stroke(line);
    ctx.strokeStyle = rgba(crest, (0.3 + 0.55 * d) * (0.6 + 0.4 * lift));
    ctx.lineWidth = (1.2 + 1.6 * d) * u;
    ctx.stroke(line);
  }

  drawBehind(ctx) {
    for (let l = 0; l < this.anchor; l++) this.draw(ctx, l);
  }

  drawFront(ctx) {
    for (let l = this.anchor; l < this.layers; l++) this.draw(ctx, l);
  }
}

export function makeStars(random, n, u) {
  return Array.from({ length: Math.round(n) }, () => ({
    x: random(), y: random(), r: (0.6 + random() * 1.4) * u, phase: random() * TAU,
  }));
}

// Stars above `horizon`, twinkling with the highs.
export function drawStars(ctx, stars, env, horizon, t, high) {
  for (const s of stars) {
    const tw = 0.35 + 0.35 * Math.sin(t * 2.2 + s.phase) + 0.4 * high;
    ctx.fillStyle = rgba(env.palette.text, clamp(tw) * 0.8);
    ctx.fillRect(s.x * env.width, s.y * horizon * 0.95, s.r, s.r);
  }
}

export function makeFog(random) {
  return Array.from({ length: 6 }, (_, i) => ({
    x: random() * 1.4 - 0.2, y: random(), speed: (0.008 + random() * 0.012) * (i % 2 ? 1 : -1), w: 1.6 + random() * 1.4,
  }));
}

// Fog banks: the back ones hang at the horizon, the front ones low over the
// near water. Each bank is either front or back, so call this twice.
export function drawFog(ctx, banks, { front, sprite, size: S, horizon, waterY, amount, rms, dt, env }) {
  if (amount <= 0) return;
  const { width, height } = env;
  ctx.globalCompositeOperation = 'lighter';
  for (const [i, f] of banks.entries()) {
    if ((i % 3 === 0) !== front) continue;
    f.x += f.speed * dt * (1 + rms);
    if (f.x > 1.6) f.x = -0.6;
    if (f.x < -0.6) f.x = 1.6;
    const w = S * f.w, h = S * (front ? 0.22 : 0.3);
    const y = front ? height - (height - waterY) * (0.25 + f.y * 0.3) : horizon - S * 0.05 + f.y * S * 0.18;
    ctx.globalAlpha = clamp((front ? 0.12 : 0.18) * amount * (0.6 + 0.6 * rms));
    ctx.drawImage(sprite, f.x * width - w / 2, y - h / 2, w, h);
  }
  ctx.globalAlpha = 1;
}

// Moon with a halo (`sprite` is a glowSprite) and optional craters.
export function drawMoon(ctx, { x, y, r, halo, craters = false, sprite, palette }) {
  if (r <= 0) return;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = halo;
  const g = r * 7;
  ctx.drawImage(sprite, x - g, y - g, g * 2, g * 2);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const mg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
  mg.addColorStop(0, mix(palette.text, '#ffffff', 0.5));
  mg.addColorStop(1, mix(palette.text, palette.colors[1], 0.35));
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  if (!craters) return;
  ctx.fillStyle = rgba(palette.colors[0], 0.25);
  for (const [dx, dy, cr] of [[-0.3, -0.2, 0.22], [0.25, 0.1, 0.16], [-0.05, 0.4, 0.12], [0.35, -0.35, 0.09]]) {
    ctx.beginPath();
    ctx.arc(x + dx * r, y + dy * r, cr * r, 0, TAU);
    ctx.fill();
  }
}

// Broken streaks of moonlight on the water under the moon.
export function drawMoonlight(ctx, sea, { x, r, horizon, rows, alpha, t, env }) {
  if (r <= 0) return;
  const { height, u, palette } = env;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < rows; i++) {
    const a = i / rows;
    const y = horizon + sea.S * 0.03 + a * (height - horizon) * 0.8;
    const wob = Math.sin(t * 2 + i * 1.7) * 10 * u + sea.wave(i * 3) * 12 * u;
    const w = r * (0.4 + a * 1.6) * (0.6 + 0.4 * Math.sin(t * 3 + i * 2.3));
    ctx.fillStyle = rgba(palette.text, alpha * (1 - a * 0.7));
    ctx.fillRect(x + wob - w / 2, y, w, (1.5 + a * 2.5) * u);
  }
}

// Lightning on big hits: a bolt down to the horizon and a flash. Call
// `strike` and `drawBolt` behind the sea, `drawFlash` over everything.
export class Lightning {
  constructor(env) {
    this.env = env;
    this.bolt = null;
    this.last = -10;
  }

  strike(frame, t, horizon, amount) {
    const { width, u, random } = this.env;
    if (!(amount > 0 && frame.onset && frame.onsetStrength > 0.6 && t - this.last > 5 / amount && random() < 0.3 * amount)) return;
    this.last = t;
    const pts = [];
    let x = width * (0.1 + random() * 0.8), y = 0;
    while (y < horizon) {
      pts.push([x, y]);
      y += (20 + random() * 50) * u;
      x += (random() - 0.5) * 70 * u;
    }
    pts.push([x, horizon]);
    this.bolt = { pts, life: 1 };
  }

  drawBolt(ctx) {
    const b = this.bolt;
    if (!b || !(b.life > 0.6 || Math.sin(b.life * 40) > 0)) return;
    const { u, palette } = this.env;
    const path = new Path2D();
    b.pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba(palette.colors[2], 0.15 * b.life);
    ctx.lineWidth = 14 * u;
    ctx.stroke(path);
    ctx.strokeStyle = rgba('#ffffff', 0.9 * b.life);
    ctx.lineWidth = 2 * u;
    ctx.stroke(path);
  }

  drawFlash(ctx, dt) {
    if (!this.bolt) return;
    const { width, height, palette } = this.env;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(palette.colors[2], 0.22 * this.bolt.life ** 2);
    ctx.fillRect(0, 0, width, height);
    this.bolt.life -= dt / 0.45;
    if (this.bolt.life <= 0) this.bolt = null;
  }
}

export function makeRain(random, amount) {
  return Array.from({ length: Math.round(160 * amount) }, () => ({ x: random(), y: random(), v: 0.8 + random() * 0.6 }));
}

// Slanting rain streaks over the whole frame.
export function drawRain(ctx, drops, env, dt, alpha) {
  if (!drops.length) return;
  const { width, height, u, palette } = env;
  ctx.strokeStyle = rgba(palette.text, alpha);
  ctx.lineWidth = 1.2 * u;
  ctx.beginPath();
  for (const r of drops) {
    r.y += dt * r.v * 1.6;
    r.x -= dt * r.v * 0.25;
    if (r.y > 1) { r.y -= 1; r.x = (r.x + 0.37) % 1; }
    if (r.x < 0) r.x += 1;
    const x = r.x * width, y = r.y * height;
    ctx.moveTo(x, y);
    ctx.lineTo(x + 6 * u, y - 26 * u);
  }
  ctx.stroke();
}
