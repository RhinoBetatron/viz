import { Path2D } from 'skia-canvas';
import { mix, rgba } from '../palettes.js';
import { clamp } from '../util.js';
import { Sea, glowSprite } from '../sea.js';
import { drawSurface, shaftSprite, makeShafts, drawShafts, Bubbles, makeSnow, drawSnow } from '../underwater.js';

const TAU = Math.PI * 2;

export default {
  name: 'abyss',
  description: 'Under the sea: glowing jellyfish swim on the kicks under a surface made of the waveform, light shafts shimmer and a wreck rests on the floor',
  palette: 'spectral', // used when no -p is given
  params: {
    jellies: 7,     // jellyfish (0–14)
    size: 1,        // jellyfish size
    swim: 1,        // how hard they pulse and swim on kicks
    tentacles: 1,   // tentacle length (0 = none)
    shafts: 6,      // light shafts from the surface (0 = off)
    bubbles: 1,     // bubble bursts on transients (0 = off)
    snow: 70,       // drifting specks (0 = off)
    kelp: 12,       // kelp strands on the floor (0 = off)
    wreck: 1,       // sunken ship on the floor (0 = off)
    whale: 1,       // a huge shape passing in the dark on loud parts (0 = never)
    surface: 1,     // waveform on the surface above (0 = flat)
  },

  setup(ctx, env) {
    const { width, height, u, random, palette, params: p } = env;
    this.t = 0;
    this.S = Math.min(width, height);
    this.surfY = height * 0.08;
    this.floorY = height * 0.86;
    this.sea = new Sea(env, { size: this.S, waterY: this.surfY });
    this.shafts = makeShafts(random, p.shafts);
    this.snow = makeSnow(random, p.snow, u);
    this.bubbles = new Bubbles(env);
    this.energy = null;
    this.whale = null;
    this.lastWhale = -30;
    this.kicks = 0;

    this.jellies = Array.from({ length: Math.round(clamp(p.jellies, 0, 14)) }, (_, i) => {
      const depth = 0.45 + random() * 0.55; // 1 = nearest
      return {
        x: 0.1 + random() * 0.8, y: 0.25 + random() * 0.55,
        R: this.S * (0.035 + 0.06 * depth) * p.size,
        depth,
        band: Math.floor(random() * 6),
        phase: random() * TAU,
        vx: (random() - 0.5) * 0.01,
        vy: 0,
        squeeze: 0,
        group: i % 2, // half swim on one kick, half on the next
        trail: 0,
      };
    }).sort((a, b) => a.depth - b.depth);

    // Sea floor: low dunes, and kelp rooted along it.
    this.dunes = Array.from({ length: 7 }, () => random());
    this.kelp = Array.from({ length: Math.round(p.kelp) }, () => ({
      x: random(), h: 0.12 + random() * 0.22, phase: random() * TAU, lean: (random() - 0.5) * 0.3,
    }));
    this.wreckX = width * (random() < 0.5 ? 0.27 : 0.73);

    this.glow = glowSprite(env, palette.colors[2], 64 * u);
    this.warm = glowSprite(env, palette.accent, 64 * u);
    this.shaft = shaftSprite(env, palette.colors[2]);
  },

  floorAt(x) {
    const { width } = this.env;
    const f = (x / width) * (this.dunes.length - 1);
    const i = Math.min(this.dunes.length - 2, Math.floor(f)), k = f - i;
    const s = (1 - Math.cos(k * Math.PI)) / 2;
    return this.floorY + (this.dunes[i] + (this.dunes[i + 1] - this.dunes[i]) * s - 0.5) * this.S * 0.05;
  },

  drawFloor(ctx, env, frame) {
    const { width, height, u, palette, params: p } = env;
    const t = this.t;
    // Kelp, swaying with the mids.
    if (this.kelp.length) {
      const path = new Path2D();
      for (const k of this.kelp) {
        const x0 = k.x * width, y0 = this.floorAt(x0), h = k.h * height;
        path.moveTo(x0, y0);
        let x = x0, y = y0;
        for (let i = 1; i <= 10; i++) {
          const f = i / 10;
          x = x0 + (k.lean + Math.sin(t * 0.9 + k.phase - f * 2.5) * (0.12 + 0.25 * frame.mid)) * h * f;
          y = y0 - h * f;
          path.lineTo(x, y);
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const [w, a] of [[9, 0.05], [3, 0.25]]) {
        ctx.lineWidth = w * u;
        ctx.strokeStyle = rgba(palette.colors[1], a);
        ctx.stroke(path);
      }
    }

    // The wreck, half sunk in the sand.
    if (p.wreck > 0) {
      const S = this.S * 0.42 * p.wreck, x = this.wreckX, y = this.floorAt(x) + S * 0.04;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(this.wreckX < width / 2 ? 0.16 : -0.16);
      ctx.scale(S, S);
      const hull = new Path2D();
      hull.moveTo(-0.5, -0.22); hull.lineTo(-0.3, -0.13);
      hull.quadraticCurveTo(0, -0.1, 0.25, -0.15); hull.lineTo(0.5, -0.2);
      hull.quadraticCurveTo(0.45, 0, 0.3, 0.08); hull.lineTo(-0.4, 0.08); hull.closePath();
      const lines = new Path2D();
      lines.moveTo(-0.15, -0.12); lines.lineTo(-0.28, -0.55);            // broken mast
      lines.moveTo(0.12, -0.13); lines.lineTo(0.2, -0.38); lines.lineTo(0.27, -0.33);
      lines.moveTo(-0.28, -0.5); lines.lineTo(-0.12, -0.47);              // yard
      lines.moveTo(-0.45, -0.04); lines.quadraticCurveTo(0, 0, 0.42, -0.07);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = mix(palette.bg[0], palette.colors[0], 0.35);
      ctx.fill(hull);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = 'round';
      for (const [w, a] of [[8, 0.07], [1.5, 0.6]]) {
        ctx.lineWidth = (w * u) / S;
        ctx.strokeStyle = rgba(palette.colors[1], a);
        ctx.stroke(hull);
        ctx.stroke(lines);
      }
      // Portholes still glowing faintly.
      ctx.fillStyle = rgba(palette.accent, 0.2 + 0.5 * frame.bass);
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.arc(-0.25 + k * 0.14, -0.06, 0.015, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // Sand in front.
    const sand = new Path2D();
    sand.moveTo(0, height);
    for (let i = 0; i <= 40; i++) sand.lineTo((i / 40) * width, this.floorAt((i / 40) * width));
    sand.lineTo(width, height);
    sand.closePath();
    ctx.globalCompositeOperation = 'source-over';
    const grad = ctx.createLinearGradient(0, this.floorY - this.S * 0.05, 0, height);
    grad.addColorStop(0, mix(palette.bg[1], palette.colors[0], 0.4));
    grad.addColorStop(1, palette.bg[0]);
    ctx.fillStyle = grad;
    ctx.fill(sand);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.3 * u;
    ctx.strokeStyle = rgba(palette.colors[1], 0.35);
    ctx.stroke(sand);
  },

  // A whale-sized silhouette gliding across in the far dark.
  drawWhale(ctx, env, dt) {
    const w = this.whale;
    if (!w) return;
    const { width, height, u, palette } = env;
    w.t += dt / w.duration;
    if (w.t >= 1) { this.whale = null; return; }
    const L = this.S * 1.3;
    const x = w.dir > 0 ? -L + w.t * (width + 2 * L) : width + L - w.t * (width + 2 * L);
    const y = height * w.y + Math.sin(w.t * TAU) * this.S * 0.03;
    const fade = Math.sin(w.t * Math.PI);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(w.dir * L, L);
    const tail = Math.sin(this.t * 1.4) * 0.05;
    const body = new Path2D();
    body.moveTo(0.5, 0);
    body.bezierCurveTo(0.48, -0.12, 0.1, -0.15, -0.25, -0.06);
    body.quadraticCurveTo(-0.4, -0.02, -0.46, tail);
    body.lineTo(-0.56, tail - 0.08);
    body.quadraticCurveTo(-0.52, tail, -0.56, tail + 0.08);
    body.lineTo(-0.46, tail + 0.01);
    body.quadraticCurveTo(-0.4, 0.04, -0.25, 0.06);
    body.bezierCurveTo(0.05, 0.13, 0.42, 0.1, 0.5, 0);
    body.closePath();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(palette.bg[0], 0.55 * fade);
    ctx.fill(body);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = (1.5 * u) / L;
    ctx.strokeStyle = rgba(palette.colors[1], 0.25 * fade);
    ctx.stroke(body);
    ctx.restore();
  },

  drawJelly(ctx, j, env, frame) {
    const { width, height, u, palette, params: p } = env;
    const t = this.t;
    const x = j.x * width, y = j.y * height;
    const c = j.squeeze;
    const R = j.R;
    const bw = R * (1 - 0.28 * c), bh = R * (0.8 + 0.35 * c);
    const level = this.bands[j.band];
    const alpha = 0.45 + 0.55 * j.depth;

    // Glow behind the bell, with the jelly's own slice of the spectrum.
    ctx.globalCompositeOperation = 'lighter';
    const g = R * (2.2 + 1.5 * level);
    ctx.globalAlpha = clamp((0.2 + 0.6 * level) * alpha);
    ctx.drawImage(this.glow, x - g, y - bh * 0.5 - g, g * 2, g * 2);
    ctx.globalAlpha = 1;

    // Tentacles trail behind, lagging more while it swims.
    if (p.tentacles > 0) {
      const tent = new Path2D();
      const len = R * 3.2 * p.tentacles * (1 - 0.25 * c);
      for (let k = 0; k < 8; k++) {
        const f0 = k / 7 - 0.5;
        let px = x + f0 * bw * 1.6, py = y;
        tent.moveTo(px, py);
        for (let s = 1; s <= 12; s++) {
          const f = s / 12;
          px = x + f0 * bw * 1.6 * (1 - 0.4 * f) + Math.sin(t * 2.2 - f * 5 + j.phase + k) * R * 0.25 * f;
          py = y + len * f * (1 + j.trail * 0.4 * f);
          tent.lineTo(px, py);
        }
      }
      ctx.lineWidth = 1 * u;
      ctx.strokeStyle = rgba(palette.colors[2], 0.35 * alpha);
      ctx.stroke(tent);
      // Frilly oral arms down the middle.
      const arms = new Path2D();
      for (let k = -1; k <= 1; k++) {
        arms.moveTo(x + k * bw * 0.15, y);
        for (let s = 1; s <= 10; s++) {
          const f = s / 10;
          arms.lineTo(x + k * bw * 0.2 + Math.sin(t * 1.6 - f * 7 + k + j.phase) * R * 0.12, y + len * 0.45 * f);
        }
      }
      ctx.lineWidth = 2.6 * u;
      ctx.strokeStyle = rgba(palette.colors[2], 0.25 * alpha);
      ctx.stroke(arms);
    }

    // Bell: dome with a scalloped rim.
    const bell = new Path2D();
    bell.moveTo(x - bw, y);
    bell.bezierCurveTo(x - bw, y - bh * 1.25, x + bw, y - bh * 1.25, x + bw, y);
    const sc = 8;
    for (let k = 1; k <= sc; k++) {
      const xa = x + bw - (k / sc) * bw * 2;
      bell.quadraticCurveTo(xa + bw / sc, y + R * 0.1, xa, y);
    }
    bell.closePath();
    ctx.fillStyle = rgba(palette.colors[2], (0.08 + 0.18 * level) * alpha);
    ctx.fill(bell);
    ctx.lineJoin = 'round';
    for (const [w, a] of [[8, 0.06], [3, 0.15], [1.3, 0.8]]) {
      ctx.lineWidth = w * u;
      ctx.strokeStyle = rgba(palette.colors[2], a * alpha);
      ctx.stroke(bell);
    }
    // Four glowing loops inside the bell.
    ctx.strokeStyle = rgba(palette.accent, (0.3 + 0.6 * level) * alpha);
    ctx.lineWidth = 1.4 * u;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + j.phase;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * bw * 0.32, y - bh * 0.45 + Math.sin(a) * bh * 0.15, bw * 0.14, bh * 0.12, a, 0, TAU);
      ctx.stroke();
    }
  },

  draw(ctx, frame, env) {
    const { width, height, fps, u, palette, random, params: p } = env;
    const dt = 1 / fps;
    this.t += dt;
    const t = this.t;
    this.env = env;
    this.sea.update(frame, dt);
    this.energy = this.energy ?? frame.rms;
    this.energy += (frame.rms - this.energy) * (1 - 0.5 ** (dt / 1.5));
    // Six slices of the spectrum, one per jelly colour of light.
    const spec = frame.spectrum, per = Math.floor(spec.length / 6);
    this.bands = Array.from({ length: 6 }, (_, b) => {
      let s = 0;
      for (let k = b * per; k < (b + 1) * per; k++) s += spec[k];
      return clamp((s / per) * 1.3);
    });

    // Darker the deeper it gets.
    ctx.globalCompositeOperation = 'source-over';
    const depth = ctx.createLinearGradient(0, 0, 0, height);
    depth.addColorStop(0, rgba(palette.colors[0], 0.55));
    depth.addColorStop(0.5, rgba(palette.bg[1], 0.2));
    depth.addColorStop(1, rgba(palette.bg[0], 0.7));
    ctx.fillStyle = depth;
    ctx.fillRect(0, 0, width, height);

    // The leviathan passes on loud stretches, at most every half minute.
    if (p.whale > 0 && !this.whale && this.energy > 0.55 && t - this.lastWhale > 30 / p.whale) {
      this.lastWhale = t;
      this.whale = { t: 0, duration: 14, dir: random() < 0.5 ? 1 : -1, y: 0.4 + random() * 0.2 };
    }
    this.drawWhale(ctx, env, dt);

    drawShafts(ctx, this.shafts, { sprite: this.shaft, top: this.surfY, amount: 1, t, high: frame.high, pulse: frame.pulse, env });
    drawSnow(ctx, this.snow, { dt, t, mid: frame.mid, env });
    this.drawFloor(ctx, env, frame);

    // Jellyfish: on a kick, one group squeezes and shoots upwards.
    if (frame.kick) this.kicks++;
    for (const j of this.jellies) {
      if (frame.kick && (this.kicks % 2 === j.group || p.swim > 1.5)) {
        j.squeeze = Math.min(1, j.squeeze + frame.kickStrength * p.swim);
        j.vy -= 0.05 * frame.kickStrength * p.swim * (0.6 + 0.4 * j.depth);
      }
      j.squeeze *= 0.86 ** (30 / fps);
      j.vy += (0.015 - j.vy) * 1.5 * dt; // drag, settling to a slow sink
      // Keep clear of the surface and the floor.
      if (j.y < 0.25) j.vy += (0.25 - j.y) * 0.8 * dt;
      if (j.y > 0.7) j.vy -= (j.y - 0.7) * 0.8 * dt;
      j.trail += (Math.max(0, -j.vy) * 8 - j.trail) * 0.2;
      j.y += j.vy * dt;
      j.x += (j.vx + Math.sin(t * 0.2 + j.phase) * 0.006) * dt;
      if (j.x < -0.1) j.x = 1.1;
      if (j.x > 1.1) j.x = -0.1;
      this.drawJelly(ctx, j, env, frame);
    }

    // Bubbles from the wreck and the floor on transients.
    if (frame.onset && p.bubbles > 0) {
      const x = p.wreck > 0 && random() < 0.6 ? this.wreckX + (random() - 0.5) * this.S * 0.2 : random() * width;
      this.bubbles.spawn(x, this.floorAt(x) - 10 * u, Math.round((2 + 4 * frame.onsetStrength) * p.bubbles));
    }
    this.bubbles.draw(ctx, { top: this.surfY, dt, t });

    drawSurface(ctx, this.sea, { y: this.surfY, amp: this.S * 0.025 * p.surface, env, pulse: frame.pulse });
    ctx.globalCompositeOperation = 'source-over';
  },
};
