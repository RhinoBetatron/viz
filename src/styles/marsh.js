import { Path2D } from 'skia-canvas';
import { mix, rgba } from '../palettes.js';
import { clamp } from '../util.js';
import { Sea, glowSprite, makeStars, drawStars, makeFog, drawFog, drawMoon, drawMoonlight } from '../sea.js';

const TAU = Math.PI * 2;

export default {
  name: 'marsh',
  description: 'A swamp at night: will-o\'-wisps drift over black water, flaring on kicks and blinking away on transients, among dead trees, hanging moss and reeds swaying with the mids',
  palette: 'verdant', // used when no -p is given
  params: {
    wisps: 7,       // will-o'-wisps (0–14)
    blink: 1,       // how often wisps vanish and reappear elsewhere on transients (0 = never)
    trees: 3,       // dead trees standing in the water (0–5)
    moss: 1,        // hanging moss (0 = none)
    reeds: 1,       // reeds and cattails in front (0 = none)
    fireflies: 40,  // (0 = off)
    ripples: 1,     // rings on the water on kicks (0 = off)
    fog: 1,
    moon: 1,
    stars: 60,
    swell: 0.3,     // still water
    chop: 0.5,
    waves: 3,
  },

  setup(ctx, env) {
    const { width, height, u, cx, cy, random, palette, params: p } = env;
    this.t = 0;
    const S = (this.S = Math.min(width, height));
    this.waterY = cy + S * 0.2;
    this.sea = new Sea(env, { size: S * 0.5, waterY: this.waterY, anchor: 0, seeThrough: 0.05 });
    this.stars = makeStars(random, p.stars, u);
    this.fogBanks = makeFog(random);
    this.ripples = [];

    this.wisps = Array.from({ length: Math.round(clamp(p.wisps, 0, 14)) }, () => this.placeWisp({ trail: [] }, random, env));
    this.fireflies = Array.from({ length: Math.round(p.fireflies) }, () => ({
      x: random(), y: random(), phase: random() * TAU, speed: 0.5 + random(),
    }));
    this.reeds = Array.from({ length: Math.round(70 * p.reeds) }, () => {
      const side = random() < 0.5 ? random() * 0.32 : 1 - random() * 0.32; // clumps at the sides
      return { x: side, h: (0.12 + random() * 0.22) * height, lean: (random() - 0.5) * 0.5, phase: random() * TAU, head: random() < 0.25 };
    });

    this.moss = [];
    this.trees = this.buildTrees(env);
    this.glow = glowSprite(env, palette.accent, 64 * u);
    this.mist = glowSprite(env, palette.colors[1], 128 * u);
    this.bug = glowSprite(env, palette.colors[3] ?? palette.colors[2], 16 * u);
  },

  placeWisp(w, random, { width }) {
    w.x = (0.1 + random() * 0.8) * width;
    w.h = (0.04 + random() * 0.24) * this.S; // height above the water
    w.vx = (random() - 0.5) * 30;
    w.phase = random() * TAU;
    w.fade = 0;
    w.trail.length = 0;
    return w;
  },

  // Dead trees and the far treeline don't move, so they're drawn once.
  buildTrees(env) {
    const { width, height, u, random, palette, params: p } = env;
    const S = this.S, waterY = this.waterY;
    const c = env.createCanvas(width, height);
    const g = c.getContext('2d');
    const dark = mix(palette.bg[0], palette.colors[0], 0.25);

    // Far treeline on the horizon.
    const line = new Path2D();
    line.moveTo(0, waterY);
    for (let x = 0; x <= width; x += 6 * u) line.lineTo(x, waterY - S * (0.03 + 0.04 * random() ** 3 + 0.02 * Math.sin(x * 0.01)));
    line.lineTo(width, waterY);
    line.closePath();
    g.fillStyle = mix(palette.bg[1], palette.colors[0], 0.35);
    g.fill(line);

    const n = Math.round(clamp(p.trees, 0, 5));
    const branch = (x, y, a, len, w, depth) => {
      const bend = (random() - 0.5) * 0.6;
      const mx = x + Math.cos(a + bend) * len * 0.5, my = y + Math.sin(a + bend) * len * 0.5;
      const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(mx, my, ex, ey);
      g.stroke();
      if (depth >= 2 && random() < 0.7) this.moss.push({ x: ex, y: ey, len: S * (0.04 + random() * 0.1), phase: random() * TAU });
      if (depth >= 6 || len < 6 * u) return;
      const kids = depth < 2 ? 2 : 2 + (random() < 0.4 ? 1 : 0);
      for (let k = 0; k < kids; k++) {
        const spread = (k - (kids - 1) / 2) * (0.55 + random() * 0.4) + (random() - 0.5) * 0.3;
        branch(ex, ey, a + spread - 0.08 * Math.sign(Math.cos(a)), len * (0.62 + random() * 0.18), w * 0.62, depth + 1);
      }
    };
    g.strokeStyle = dark;
    g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const f = n > 1 ? i / (n - 1) : 0.5;
      const x = width * (0.08 + f * 0.84) + (random() - 0.5) * width * 0.08;
      const near = 0.7 + random() * 0.5;
      branch(x, waterY + S * 0.06, -Math.PI / 2 + (random() - 0.5) * 0.3, S * 0.2 * near, S * 0.03 * near, 0);
    }
    // A faint green rim on everything, as if lit by the wisps.
    const rim = env.createCanvas(width, height);
    const rg = rim.getContext('2d');
    rg.drawImage(c, -1.5 * u, -1.5 * u);
    rg.globalCompositeOperation = 'destination-out';
    rg.drawImage(c, 0, 0);
    rg.globalCompositeOperation = 'source-in';
    rg.fillStyle = rgba(palette.colors[2], 0.55);
    rg.fillRect(0, 0, width, height);
    g.drawImage(rim, 0, 0);
    return c;
  },

  draw(ctx, frame, env) {
    const { width, height, fps, u, cx, palette, random, params: p } = env;
    const dt = 1 / fps;
    this.t += dt;
    const t = this.t;
    const S = this.S, sea = this.sea;
    sea.update(frame, dt, 0.4);
    const horizon = this.waterY;

    drawStars(ctx, this.stars, env, horizon * 0.8, t, frame.high);
    const moonR = S * 0.055 * p.moon;
    const moonX = cx - Math.min(width * 0.25, S * 0.3), moonY = Math.max(moonR * 2.5, horizon - S * 0.5);
    drawMoon(ctx, { x: moonX, y: moonY, r: moonR, halo: 0.18 + 0.12 * frame.bass, craters: true, sprite: this.mist, palette });
    const fog = { sprite: this.mist, size: S * 0.5, horizon, waterY: this.waterY, amount: p.fog, rms: frame.rms, dt, env };
    drawFog(ctx, this.fogBanks, { ...fog, front: false });

    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.trees, 0, 0);

    // Moss hanging off the branches.
    if (p.moss > 0 && this.moss.length) {
      const path = new Path2D();
      for (const m of this.moss) {
        const sway = Math.sin(t * 0.9 + m.phase) * (0.06 + 0.15 * frame.mid) * m.len;
        path.moveTo(m.x, m.y);
        path.quadraticCurveTo(m.x + sway * 0.3, m.y + m.len * 0.5 * p.moss, m.x + sway, m.y + m.len * p.moss);
      }
      ctx.lineWidth = 1.2 * u;
      ctx.strokeStyle = rgba(palette.colors[1], 0.45);
      ctx.stroke(path);
    }

    sea.drawFront(ctx);
    drawMoonlight(ctx, sea, { x: moonX, r: moonR, horizon, rows: 12, alpha: 0.06 + 0.06 * frame.bass, t, env });

    // Ripples spreading on the water.
    if (frame.kick && p.ripples > 0) {
      const w = this.wisps.length ? this.wisps[Math.floor(random() * this.wisps.length)] : null;
      const x = w ? w.x : random() * width;
      this.ripples.push({ x, y: sea.y(0, x) + S * (0.01 + random() * 0.05), r: 0, life: 1 });
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const r of this.ripples) {
      r.life -= dt / 1.6;
      r.r += S * 0.12 * dt;
      ctx.strokeStyle = rgba(palette.colors[2], 0.4 * r.life * p.ripples);
      ctx.lineWidth = 1.2 * u;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.r * 0.18, 0, 0, TAU);
      ctx.stroke();
    }
    this.ripples = this.ripples.filter((r) => r.life > 0);

    // Will-o'-wisps: drifting, bobbing, flaring on kicks, and blinking out on
    // transients to reappear somewhere else.
    for (const w of this.wisps) {
      if (frame.onset && p.blink > 0 && random() < 0.15 * p.blink * frame.onsetStrength) w.out = 1;
      if (w.out > 0) {
        w.out -= dt / 0.25;
        if (w.out <= 0) this.placeWisp(w, random, env);
      }
      w.fade = Math.min(1, w.fade + dt * 2);
      w.x += w.vx * u * dt + Math.sin(t * 0.4 + w.phase) * 12 * u * dt;
      if (w.x < -20 * u || w.x > width + 20 * u) w.vx = -w.vx;
      const water = sea.y(0, w.x);
      const y = water - w.h - Math.sin(t * 1.3 + w.phase) * S * 0.015;
      w.trail.unshift([w.x, y]);
      if (w.trail.length > 14) w.trail.pop();
      const vis = w.fade * (w.out > 0 ? w.out : 1);
      const bright = clamp((0.55 + 0.25 * Math.sin(t * 9 + w.phase) * frame.high + 0.6 * frame.pulse) * vis);
      const r = S * (0.035 + 0.035 * frame.pulse);
      // Trail, reflection, halo, core.
      w.trail.forEach(([tx, ty], i) => {
        const k = 1 - i / w.trail.length;
        ctx.globalAlpha = bright * 0.25 * k;
        ctx.drawImage(this.glow, tx - r * k, ty - r * k, r * 2 * k, r * 2 * k);
      });
      ctx.globalAlpha = bright * 0.35;
      ctx.drawImage(this.glow, w.x - r, water + (water - y) - r * 1.6, r * 2, r * 3.2);
      ctx.globalAlpha = bright * 0.5;
      ctx.drawImage(this.mist, w.x - r * 4, y - r * 4, r * 8, r * 8);
      ctx.globalAlpha = bright;
      ctx.drawImage(this.glow, w.x - r * 1.4, y - r * 1.4, r * 2.8, r * 2.8);
      ctx.fillStyle = rgba(palette.text, bright);
      ctx.beginPath();
      ctx.arc(w.x, y, r * 0.12, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawFog(ctx, this.fogBanks, { ...fog, front: true });

    // Reeds and cattails in front, swaying with the mids.
    if (this.reeds.length) {
      const blades = new Path2D(), heads = new Path2D();
      for (const r of this.reeds) {
        const x0 = r.x * width, y0 = height + 4 * u;
        const sway = r.lean + Math.sin(t * 1.1 + r.phase + r.x * 4) * (0.05 + 0.18 * frame.mid);
        const tx = x0 + sway * r.h, ty = y0 - r.h;
        blades.moveTo(x0, y0);
        blades.quadraticCurveTo(x0 + sway * r.h * 0.2, y0 - r.h * 0.6, tx, ty);
        if (r.head) {
          const hx = x0 + sway * r.h * 0.85, hy = y0 - r.h * 0.88;
          heads.moveTo(hx + 4 * u, hy);
          heads.ellipse(hx, hy, 4 * u, S * 0.028, sway * 0.8, 0, TAU);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'round';
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = palette.bg[0];
      ctx.stroke(blades);
      ctx.fillStyle = palette.bg[0];
      ctx.fill(heads);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 1 * u;
      ctx.strokeStyle = rgba(palette.colors[1], 0.35);
      ctx.stroke(blades);
      ctx.stroke(heads);
    }

    // Fireflies.
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.fireflies) {
      const x = ((f.x + Math.sin(t * 0.13 * f.speed + f.phase) * 0.05) % 1) * width;
      const y = this.waterY - S * 0.35 + f.y * S * 0.6 + Math.sin(t * 0.7 * f.speed + f.phase) * S * 0.02;
      const on = clamp(Math.sin(t * 2 * f.speed + f.phase) * 2 - 0.6 + frame.high);
      if (on <= 0) continue;
      ctx.globalAlpha = on;
      ctx.drawImage(this.bug, x - 8 * u, y - 8 * u, 16 * u, 16 * u);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  },
};
