import { Path2D } from 'skia-canvas';
import { hexToRgb, mix, rgba } from '../palettes.js';
import { clamp } from '../util.js';
import { Sea, glowSprite, makeStars, drawStars } from '../sea.js';

const TAU = Math.PI * 2;

// One ray of a curtain, drawn once and stretched: a sharp bright lower edge
// fading up into the sky, shifting colour as it goes.
function raySprite(env, low, high) {
  const W = 8, H = 256;
  const c = env.createCanvas(W, H);
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const a = hexToRgb(low), b = hexToRgb(high);
  for (let y = 0; y < H; y++) {
    const v = 1 - y / (H - 1); // 0 at the bottom edge, 1 at the top
    const alpha = Math.min(1, v * 25) * Math.exp(-v * 3.2);
    const rgb = a.map((ch, i) => ch + (b[i] - ch) * Math.min(1, v * 1.4));
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const edge = 1 - Math.abs(x - (W - 1) / 2) / (W / 2);
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2];
      img.data[o + 3] = Math.round(255 * alpha * (0.5 + 0.5 * edge));
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export default {
  name: 'aurora',
  description: 'Aurora curtains rippling over a mountain fjord, each fold rising with its slice of the spectrum and mirrored in the still water',
  palette: 'spectral', // used when no -p is given
  // With --auto: settings scaled in calm parts, builds and drops (see modulate.js).
  sections: {
    calm: { height: 0.8, shimmer: 0.7, speed: 0.7, flare: 0.5 },
    build: { height: 0.95 },
    drop: { height: 1.2, shimmer: 1.4, speed: 1.3, flare: 1.6 },
  },
  params: {
    curtains: 3,    // aurora bands (1–5)
    height: 1,      // how tall the curtains reach
    shimmer: 1,     // running ripples of brightness along the curtains
    speed: 1,       // how fast the curtains drift and fold
    flare: 1,       // brightness wave racing out from the middle on kicks
    mountains: 1,   // mountain ridges on the horizon (0 = open sea)
    reflection: 1,  // aurora mirrored in the water (0 = off)
    shooting: 1,    // shooting stars on big hits (0 = off)
    stars: 160,
    swell: 0.35,    // the sea is calm here
    chop: 0.6,
    waves: 3,
  },

  setup(ctx, env) {
    const { width, height, u, random, palette, params: p } = env;
    this.t = 0;
    this.S = Math.min(width, height);
    this.horizon = env.cy + this.S * 0.2;
    this.sea = new Sea(env, { size: this.S * 0.5, waterY: this.horizon + this.S * 0.02, anchor: 0, seeThrough: 0.15 });
    this.stars = makeStars(random, p.stars, u);
    this.sky = env.createCanvas(width, Math.ceil(this.horizon));
    this.mist = glowSprite(env, palette.colors[1], 128 * u);
    // Curtain colours run from the palette's bright end up into its accent.
    const looks = [[palette.colors[2], palette.colors[1]], [palette.text, palette.accent], [palette.colors[1], palette.accent]];
    this.rays = looks.map(([lo, hi]) => raySprite(env, lo, hi));
    this.curtains = Array.from({ length: Math.round(clamp(p.curtains, 1, 5)) }, (_, i) => ({
      y: 0.3 + random() * 0.28,       // lower edge, as a fraction of the sky
      patches: 1.2 + random() * 1.6,  // how many bright stretches along it
      size: 0.7 + random() * 0.6,
      f1: 0.6 + random() * 0.8, f2: 1.5 + random() * 1.5,
      s1: (0.05 + random() * 0.08) * (random() < 0.5 ? 1 : -1), s2: 0.1 + random() * 0.15,
      phase: random() * TAU,
      look: i % this.rays.length,
      offset: random(), // which part of the spectrum it listens to
    }));
    // Ridgelines by midpoint displacement: big shapes with rough detail.
    this.ridges = [1, 0.5].map((depth) => { // far peaks, then near hills
      let pts = [0.3 + random() * 0.4, 0.3 + random() * 0.4];
      for (let rough = 1.1; pts.length < 65; rough *= 0.5) {
        pts = pts.flatMap((v, i) => (i < pts.length - 1 ? [v, (v + pts[i + 1]) / 2 + (random() - 0.5) * rough] : [v]));
      }
      const lo = Math.min(...pts), hi = Math.max(...pts);
      return { depth, pts: pts.map((v) => 0.08 + 0.92 * (v - lo) / (hi - lo || 1)) };
    });
    this.flares = [];
    this.meteors = [];
  },

  drawAurora(env, frame) {
    const { width, u, params: p } = env;
    const H = this.horizon;
    this.sky.width = this.sky.width; // reset (skia-canvas keeps a recording otherwise)
    const g = this.sky.getContext('2d');
    g.globalCompositeOperation = 'lighter';
    const t = this.t * p.speed;
    const spec = frame.spectrum;
    const step = 5 * u;
    for (const c of this.curtains) {
      const ray = this.rays[c.look];
      for (let x = -step * 4; x < width + step * 4; x += step) {
        const fx = x / width;
        const base = H * c.y + Math.sin(fx * TAU * c.f1 + t * c.s1 * 6 + c.phase) * H * 0.09 + Math.sin(fx * TAU * c.f2 - t * c.s2 * 4) * H * 0.04;
        // Folds: the curtain swings sideways, bunching rays together.
        const fold = Math.sin(fx * TAU * 3.1 + t * 0.4 + c.phase) * 55 * u * (0.6 + 0.4 * Math.sin(fx * 7 + t * 0.2));
        // The curtain breaks into bright stretches with dark gaps between.
        const patch = clamp(0.25 + 0.95 * Math.sin(fx * TAU * c.patches + t * 0.25 + c.phase * 2)) ** 1.6;
        const bin = Math.floor(clamp((fx * 0.6 + c.offset * 0.4) ** 1.4) * (spec.length - 1));
        const level = spec[bin];
        const ripple = 0.75 + 0.25 * Math.sin(fx * 40 - t * 3.5 + c.phase) * p.shimmer;
        let flare = 0;
        for (const f of this.flares) flare += f.k * Math.exp(-(((Math.abs(x - width / 2) - f.r) / (60 * u)) ** 2));
        const h = H * (0.16 + 0.5 * level) * c.size * p.height * (1 + 0.3 * flare);
        g.globalAlpha = clamp(((0.1 + 0.5 * level ** 1.5) * ripple + 0.4 * flare * p.flare) * patch);
        g.drawImage(ray, x + fold, base - h, step * 1.8, h);
      }
    }
    g.globalAlpha = 1;
  },

  drawRidges(ctx, env) {
    const { width, u, palette, params: p } = env;
    if (p.mountains <= 0) return;
    for (const r of this.ridges) {
      const n = r.pts.length - 1;
      const path = new Path2D();
      path.moveTo(0, this.horizon + 2 * u);
      r.pts.forEach((v, i) => path.lineTo((i / n) * width, this.horizon - v ** 1.6 * this.S * 0.34 * p.mountains * r.depth));
      path.lineTo(width, this.horizon + 2 * u);
      path.closePath();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = r.depth === 1 ? mix(palette.bg[1], palette.colors[0], 0.3) : palette.bg[0];
      ctx.fill(path);
      // Snowy edges catching the aurora light.
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 1.3 * u;
      ctx.strokeStyle = rgba(palette.colors[2], r.depth === 1 ? 0.5 : 0.3);
      ctx.stroke(path);
    }
  },

  draw(ctx, frame, env) {
    const { width, height, fps, u, cx, palette, random, params: p } = env;
    const dt = 1 / fps;
    this.t += dt;
    const t = this.t;
    const H = this.horizon;
    this.sea.update(frame, dt, 0.5);

    if (frame.kick && p.flare > 0) this.flares.push({ r: 0, k: frame.kickStrength });
    for (const f of this.flares) {
      f.r += width * 0.9 * dt;
      f.k *= 0.93 ** (30 / fps);
    }
    this.flares = this.flares.filter((f) => f.k > 0.03 && f.r < width);

    drawStars(ctx, this.stars, env, H, t, frame.high);

    // Shooting stars on big hits.
    if (p.shooting > 0 && frame.onset && frame.onsetStrength > 0.7 && random() < 0.25 * p.shooting) {
      const dir = random() < 0.5 ? -1 : 1;
      this.meteors.push({ x: random() * width, y: random() * H * 0.4, vx: dir * (500 + random() * 400) * u, vy: (150 + random() * 150) * u, life: 1 });
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const m of this.meteors) {
      m.life -= dt / 0.7;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const grad = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 0.15, m.y - m.vy * 0.15);
      grad.addColorStop(0, rgba(palette.text, clamp(m.life)));
      grad.addColorStop(1, rgba(palette.text, 0));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - m.vx * 0.15, m.y - m.vy * 0.15);
      ctx.stroke();
    }
    this.meteors = this.meteors.filter((m) => m.life > 0);

    // A wide glow under the curtains, then the curtains themselves.
    ctx.globalAlpha = clamp(0.1 + 0.15 * frame.rms);
    ctx.drawImage(this.mist, cx - width * 0.7, H * 0.05, width * 1.4, H * 0.9);
    ctx.globalAlpha = 1;
    this.drawAurora(env, frame);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.sky, 0, 0);

    this.drawRidges(ctx, env);
    this.sea.drawFront(ctx);

    // The aurora mirrored in the water, broken up by the ripples.
    if (p.reflection > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const strip = 3 * u;
      for (let y = H; y < height; y += strip) {
        const d = (y - H) / (height - H);
        const sy = H * 0.85 - (y - H) * 2;
        if (sy < 0) break;
        const dx = (Math.sin(y * 0.045 + t * 2.2) * (3 + 10 * frame.bass) + this.sea.waveAt(width * d) * 6) * u * (0.4 + d);
        ctx.globalAlpha = clamp(0.75 * p.reflection * (1 - d) ** 1.3);
        ctx.drawImage(this.sky, 0, sy - strip * 2, width, strip * 2, dx, y, width, strip);
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  },
};
