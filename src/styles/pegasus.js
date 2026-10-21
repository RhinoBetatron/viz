import { Path2D } from 'skia-canvas';
import { mix, rgba } from '../palettes.js';
import { clamp, sampleSpectrum } from '../util.js';
import { glowSprite } from '../sea.js';

const TAU = Math.PI * 2;

// Pegasus in profile, facing right, in body units (y down, origin mid-body).
const BODY = [
  ['M', -0.5, -0.02],
  ['C', -0.35, -0.12, -0.05, -0.08, 0.15, -0.1],   // back to the withers
  ['C', 0.25, -0.2, 0.35, -0.38, 0.46, -0.5],      // crest of the neck
  ['C', 0.48, -0.56, 0.52, -0.58, 0.55, -0.53],    // poll
  ['C', 0.63, -0.47, 0.72, -0.4, 0.79, -0.33],     // face
  ['C', 0.82, -0.29, 0.8, -0.24, 0.75, -0.24],     // muzzle
  ['C', 0.68, -0.24, 0.62, -0.27, 0.57, -0.3],     // jaw
  ['C', 0.52, -0.26, 0.48, -0.15, 0.42, 0.0],      // throat
  ['C', 0.4, 0.1, 0.3, 0.16, 0.15, 0.17],          // chest
  ['C', 0.0, 0.18, -0.2, 0.17, -0.35, 0.14],       // belly
  ['C', -0.48, 0.12, -0.56, 0.06, -0.5, -0.02],    // quarters
  ['Z'],
  ['M', 0.49, -0.52], ['L', 0.46, -0.64], ['L', 0.54, -0.55], ['Z'], // ear
];
const EYE = [0.6, -0.43];
const SHOULDER = [0.1, -0.1];
// Legs: hip/shoulder, upper and lower length, which way they fold.
const LEGS = [
  { x: 0.3, y: 0.08, a: 0.9, b: -1.9, l1: 0.2, l2: 0.2, far: true, ph: 0.4 },
  { x: -0.36, y: 0.06, a: -0.7, b: 0.5, l1: 0.22, l2: 0.22, far: true, ph: 2.6 },
  { x: 0.26, y: 0.1, a: 1.1, b: -2.1, l1: 0.2, l2: 0.2, far: false, ph: 0 },
  { x: -0.32, y: 0.08, a: -0.9, b: 0.6, l1: 0.22, l2: 0.22, far: false, ph: 2.2 },
];

function trace(path, cmds, T) {
  for (const [op, ...v] of cmds) {
    const p = [];
    for (let i = 0; i < v.length; i += 2) p.push(...T(v[i], v[i + 1]));
    if (op === 'M') path.moveTo(...p);
    else if (op === 'L') path.lineTo(...p);
    else if (op === 'C') path.bezierCurveTo(...p);
    else if (op === 'Z') path.closePath();
  }
  return path;
}

// A feather (or any leaf) from (x0, y0) to (x1, y1), w wide.
function leaf(path, x0, y0, x1, y1, w) {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * w, ny = (dx / l) * w;
  const mx = x0 + dx * 0.45, my = y0 + dy * 0.45;
  path.moveTo(x0, y0);
  path.quadraticCurveTo(mx + nx, my + ny, x1, y1);
  path.quadraticCurveTo(mx - nx, my - ny, x0, y0);
  path.closePath();
}

export default {
  name: 'pegasus',
  description: 'Pegasus flying over a sea of clouds towards Olympus, wings beating in time with the beat, while Zeus throws lightning on the kicks and the cloud tops rise with the spectrum',
  palette: 'olympus', // used when no -p is given
  params: {
    flap: 0.5,      // wing beats per beat (0.5 = one every two beats)
    size: 1,        // size of the horse
    lightning: 1,   // Zeus's bolts on the kicks (0 = none)
    clouds: 1,      // how much the cloud tops rise with the spectrum
    speed: 1,       // how fast the clouds rush past
    sparkle: 1,     // golden dust trailing from the wings (0 = none)
    mountain: 1,    // Olympus in the distance (0 = none)
    glow: 1,        // glow on the horse, the bolts and the sparkle
  },

  setup(ctx, env) {
    const { width, height, u, cy, random, palette } = env;
    const S = (this.S = Math.min(width, height));
    this.u = u;
    this.t = 0;
    this.scroll = 0;
    this.horizon = cy + S * 0.18;
    this.bolts = [];
    this.flash = 0;
    this.sparks = [];
    this.streaks = Array.from({ length: 40 }, () => ({ x: random(), y: random(), l: 0.5 + random(), v: 0.6 + random() * 0.8 }));
    // Cloud layers, far to near: puffs along each, wrapping round.
    // Cloud layers, far to near, down to the bottom of the frame (more of
    // them in tall formats): puffs along each, wrapping round.
    const nl = Math.max(3, Math.ceil((height - this.horizon) / (S * 0.1)));
    this.layers = Array.from({ length: nl }, (_, l) => ({
      y: this.horizon + (l * 0.09 + 0.02) * S,
      depth: l / (nl - 1),
      speed: 0.04 + Math.min(l, 4) * 0.07,
      puffs: Array.from({ length: 22 + l * 4 }, (_, i) => ({ x: (i + random() * 0.6) / (22 + l * 4), r: (0.035 + random() * 0.045) * (1 + Math.min(l, 3) * 0.35), band: random() })),
    }));
    this.storm = Array.from({ length: 16 }, (_, i) => ({ x: i / 15, r: 0.05 + random() * 0.06 }));
    this.sunGlow = glowSprite(env, palette.colors[2], 160 * u);
    this.spark = glowSprite(env, palette.accent, 16 * u);
    this.boltGlow = glowSprite(env, palette.text, 60 * u);
  },

  draw(ctx, frame, env) {
    const { width, height, fps, u, cx, palette, random, params: p } = env;
    const dt = 1 / fps;
    this.t += dt;
    const { t, S, horizon } = this;
    const dark = mix(palette.bg[0], '#000000', 0.4);
    const glowAmt = clamp(p.glow, 0, 3);
    this.scroll += dt * p.speed * (0.6 + 0.8 * frame.rms);

    // Sky: storm-dark overhead, warm towards the horizon, a sun low behind.
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, rgba(palette.bg[0], 0.95));
    sky.addColorStop(0.55, rgba(mix(palette.bg[1], palette.colors[0], 0.5), 0.95));
    sky.addColorStop(1, mix(palette.colors[1], palette.colors[2], 0.3));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizon);
    const sunX = cx - S * 0.25, sunY = horizon - S * 0.02;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.45 + 0.2 * frame.bass;
    ctx.drawImage(this.sunGlow, sunX - S * 0.5, sunY - S * 0.5, S, S);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = mix(palette.text, palette.colors[2], 0.4);
    ctx.beginPath();
    ctx.arc(sunX, sunY, S * 0.07, 0, TAU);
    ctx.fill();

    // Olympus: a far peak above the clouds, a little temple glowing on top.
    if (p.mountain > 0) {
      const mx = width * 0.5 + S * 0.38 - ((this.scroll * 0.01) % 1) * S * 0.2, my = horizon;
      const mh = S * 0.42 * p.mountain, mw = S * 0.45 * p.mountain;
      const haze = mix(palette.colors[0], palette.colors[1], 0.35);
      const mg = ctx.createLinearGradient(mx - mw, 0, mx + mw * 0.3, 0);
      mg.addColorStop(0, mix(haze, palette.colors[2], 0.35));
      mg.addColorStop(1, mix(haze, dark, 0.3));
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.moveTo(mx - mw, my);
      ctx.bezierCurveTo(mx - mw * 0.55, my - mh * 0.45, mx - mw * 0.25, my - mh * 0.85, mx - mw * 0.06, my - mh);
      ctx.lineTo(mx + mw * 0.08, my - mh * 0.98);
      ctx.bezierCurveTo(mx + mw * 0.3, my - mh * 0.8, mx + mw * 0.6, my - mh * 0.4, mx + mw, my);
      ctx.closePath();
      ctx.fill();
      // Snow.
      ctx.fillStyle = rgba(palette.text, 0.55);
      ctx.beginPath();
      ctx.moveTo(mx - mw * 0.2, my - mh * 0.8);
      ctx.lineTo(mx - mw * 0.06, my - mh);
      ctx.lineTo(mx + mw * 0.08, my - mh * 0.98);
      ctx.lineTo(mx + mw * 0.22, my - mh * 0.78);
      ctx.lineTo(mx + mw * 0.05, my - mh * 0.86);
      ctx.lineTo(mx - mw * 0.08, my - mh * 0.8);
      ctx.closePath();
      ctx.fill();
      // Temple.
      const tx = mx + mw * 0.01, ty = my - mh * 0.99, tw = mw * 0.12;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(0.4 + 0.6 * frame.pulse) * glowAmt;
      ctx.drawImage(this.boltGlow, tx - tw * 2, ty - tw * 1.5, tw * 4, tw * 3);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = mix(palette.text, palette.accent, 0.3);
      ctx.beginPath();
      ctx.moveTo(tx - tw * 0.6, ty - tw * 0.55);
      ctx.lineTo(tx, ty - tw * 0.85);
      ctx.lineTo(tx + tw * 0.6, ty - tw * 0.55);
      ctx.fill();
      for (let k = 0; k < 5; k++) ctx.fillRect(tx - tw * 0.5 + k * tw * 0.23, ty - tw * 0.5, tw * 0.08, tw * 0.5);
      ctx.fillRect(tx - tw * 0.6, ty - tw * 0.02, tw * 1.2, tw * 0.08);
    }

    // Lightning: bolts from the storm overhead down into the clouds.
    if (p.lightning > 0 && frame.kick && frame.kickStrength > 0.45) {
      const branch = (x, y, len, depth) => {
        const pts = [[x, y]];
        let a = Math.PI / 2 + (random() - 0.5) * 0.4;
        while (pts.length < len) {
          a = Math.PI / 2 + (a - Math.PI / 2) * 0.6 + (random() - 0.5) * 0.9;
          x += Math.cos(a) * S * 0.035;
          y += Math.sin(a) * S * 0.035;
          pts.push([x, y]);
          if (depth < 2 && random() < 0.12) this.bolts.push({ pts: branch(x, y, Math.floor(len * 0.4), depth + 1), life: 1, w: 0.5 });
          if (y > horizon + S * 0.05) break;
        }
        return pts;
      };
      const n = Math.ceil(frame.kickStrength * 1.5 * Math.min(2, p.lightning));
      for (let k = 0; k < n; k++) {
        const x = width * (0.08 + random() * 0.84);
        this.bolts.push({ pts: branch(x, S * 0.05, 40, 0), life: 1, w: 1 });
      }
      this.flash = Math.min(1, this.flash + frame.kickStrength * 0.7 * p.lightning);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    for (const b of this.bolts) {
      if (b.life < 0.6 && Math.sin(b.life * 50) < 0) continue; // flicker as it dies
      const path = new Path2D();
      b.pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
      ctx.strokeStyle = rgba(palette.accent, 0.25 * b.life * glowAmt);
      ctx.lineWidth = 16 * u * b.w;
      ctx.stroke(path);
      ctx.strokeStyle = rgba(palette.text, 0.95 * b.life);
      ctx.lineWidth = 2.5 * u * b.w;
      ctx.stroke(path);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const b of this.bolts) b.life -= dt / 0.35;
    this.bolts = this.bolts.filter((b) => b.life > 0);

    // Storm clouds hanging over the top, lit from inside by the flash.
    ctx.fillStyle = mix(palette.bg[0], palette.colors[0], 0.25 + 0.5 * this.flash);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (const s of this.storm) {
      const x = ((s.x + this.scroll * 0.015) % 1.07) * width * 1.07 - width * 0.03;
      ctx.moveTo(x + S * s.r, S * 0.02);
      ctx.arc(x, S * 0.02, S * s.r, 0, TAU);
    }
    ctx.fill();
    ctx.fillRect(0, 0, width, S * 0.03);

    // Wind streaks rushing past.
    ctx.strokeStyle = rgba(palette.text, 0.12 + 0.25 * frame.rms);
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath();
    for (const s of this.streaks) {
      s.x -= dt * s.v * p.speed * (0.8 + 2 * frame.rms);
      if (s.x < -0.2) { s.x = 1.1; s.y = random(); }
      const x = s.x * width, y = S * 0.08 + s.y * (horizon - S * 0.08), l = s.l * S * 0.08 * (0.5 + frame.rms);
      ctx.moveTo(x, y);
      ctx.lineTo(x + l, y);
    }
    ctx.stroke();

    // Pegasus.
    this.drawPegasus(ctx, frame, env, dark, glowAmt);

    // Sea of clouds, far layer first; puff tops rise with their band.
    const levels = sampleSpectrum(frame.spectrum, 24);
    for (const [l, layer] of this.layers.entries()) {
      const lit = mix(mix(palette.text, palette.colors[2], 0.5), palette.colors[1], 0.1 + 0.3 * Math.min(1, l / 2));
      const shade = mix(palette.colors[0], dark, 0.2 + 0.5 * layer.depth);
      const g = ctx.createLinearGradient(0, layer.y - S * 0.07, 0, layer.y + S * 0.06);
      g.addColorStop(0, mix(lit, palette.text, 0.2 + 0.4 * this.flash));
      g.addColorStop(1, shade);
      ctx.fillStyle = g;
      const shift = (this.scroll * layer.speed) % 1;
      const path = new Path2D();
      for (const pf of layer.puffs) {
        let x = (pf.x - shift) % 1;
        if (x < 0) x += 1;
        const px = x * width * 1.2 - width * 0.1;
        const v = levels[Math.min(23, Math.floor(pf.band * 23))];
        const r = S * pf.r * (1 + 0.6 * v * p.clouds);
        path.moveTo(px + r, layer.y - r * 0.15);
        path.ellipse(px, layer.y - r * 0.15, r, r * 0.6, 0, 0, TAU);
      }
      path.rect(0, layer.y, width, height - layer.y);
      ctx.fill(path);
    }

    // Lightning flash over everything.
    if (this.flash > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(palette.text, 0.18 * this.flash * this.flash);
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';
    }
    this.flash *= Math.exp(-dt * 7);
  },

  drawPegasus(ctx, frame, env, dark, glowAmt) {
    const { fps, u, cx, cy, palette, random, params: p } = env;
    const { t, S } = this;
    const dt = 1 / fps;
    const U = S * 0.34 * clamp(p.size, 0.3, 2);
    // Wing beat locked to the beat grid: the downstroke lands on the beat.
    // Advanced frame by frame, so a flap driven by an expression speeds up
    // and slows down smoothly instead of jumping.
    const beats = (frame.bars ?? t / 2) * 4;
    const step = beats - (this.lastBeats ?? beats);
    this.wing = this.wing === undefined ? beats * p.flap : this.wing + (step >= 0 && step < 1 ? step : 0) * p.flap;
    this.lastBeats = beats;
    const ph = this.wing * TAU;
    const wingY = 0.12 + 0.88 * Math.cos(ph); // 1 = up, −0.76 = down
    const bob = Math.sin(ph) * U * 0.04;
    const ox = cx - U * 0.12 + Math.sin(t * 0.35) * S * 0.03;
    const oy = cy - S * 0.1 + bob + Math.sin(t * 0.5) * S * 0.015;
    const T = (x, y) => [ox + x * U, oy + y * U];
    const coat = mix(palette.text, palette.colors[2], 0.25);
    const coatShade = mix(coat, palette.colors[0], 0.55);

    // Glow around the horse.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(0.2 + 0.3 * frame.pulse) * glowAmt;
    ctx.drawImage(this.sunGlow, ox - U * 0.9, oy - U * 0.9, U * 1.8, U * 1.8);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    const wing = (far) => {
      const [sx, sy] = T(...SHOULDER);
      ctx.save();
      ctx.translate(sx + (far ? U * 0.05 : 0), sy);
      ctx.scale(1, far ? wingY * 0.92 + 0.04 : wingY);
      const fill = far ? mix(coatShade, dark, 0.25) : coat;
      const line = rgba(far ? dark : coatShade, 0.6);
      const feathers = new Path2D(), coverts = new Path2D();
      // Primaries hanging back from the wrist, secondaries along the
      // trailing edge, two rows of coverts over their roots.
      const along = (f) => (f < 0.5
        ? [0.02 + (-0.16 - 0.02) * f * 2, -0.52 + (-0.3 + 0.52) * f * 2]
        : [-0.16 + (-0.2 + 0.16) * (f - 0.5) * 2, -0.3 + 0.3 * (f - 0.5) * 2]);
      for (let k = 0; k < 16; k++) {
        const f = k / 15, [bx, by] = along(f);
        const a = f < 0.5 ? -1.95 - f * 1.5 : -2.7 - (f - 0.5) * 0.7;
        const L = U * (f < 0.5 ? 0.52 - f * 0.25 : 0.38 - (f - 0.5) * 0.25);
        leaf(feathers, bx * U, by * U, bx * U + Math.cos(a) * L, by * U + Math.sin(a) * L, U * 0.05);
      }
      for (const [row, len, back] of [[0, 0.24, 0.0], [1, 0.15, 0.05]]) {
        for (let k = 0; k < 9; k++) {
          const f = k / 8;
          const bx = 0.04 - 0.02 * f + back * (1 - f) - row * 0.02, by = -0.5 * (1 - f) - 0.02;
          const a = -2.5 - f * 0.4;
          leaf(coverts, bx * U, by * U, bx * U + Math.cos(a) * len * U, by * U + Math.sin(a) * len * U, U * 0.045);
        }
      }
      ctx.fillStyle = fill;
      ctx.strokeStyle = line;
      ctx.lineWidth = 1.2 * u;
      ctx.fill(feathers);
      ctx.stroke(feathers);
      ctx.fillStyle = far ? mix(fill, dark, 0.1) : mix(coat, palette.text, 0.25);
      ctx.fill(coverts);
      ctx.stroke(coverts);
      // Leading edge.
      ctx.beginPath();
      ctx.moveTo(0.07 * U, 0.02 * U);
      ctx.quadraticCurveTo(0.12 * U, -0.3 * U, 0.03 * U, -0.54 * U);
      ctx.quadraticCurveTo(-0.02 * U, -0.45 * U, -0.02 * U, -0.25 * U);
      ctx.lineTo(-0.06 * U, 0.02 * U);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      if (!far && p.sparkle > 0) {
        // Golden dust shed from the wing tips, more on the downstroke.
        const down = Math.max(0, -Math.sin(ph));
        const tipX = sx - U * 0.4, tipY = sy - U * 0.9 * wingY;
        const n = (2 + 8 * down + (frame.kick ? 10 * frame.kickStrength : 0)) * p.sparkle * dt * 30;
        for (let i = 0; i < n; i++) {
          this.sparks.push({ x: tipX + (random() - 0.5) * U * 0.3, y: tipY + (random() - 0.5) * U * 0.3, vx: -(80 + random() * 160) * u, vy: (random() - 0.3) * 40 * u, age: 0, life: 0.8 + random() * 0.8, r: (4 + random() * 5) * u });
        }
      }
    };

    // Far wing and legs behind the body.
    wing(true);
    const gallop = t * 3;
    const legs = (far) => {
      for (const L of LEGS.filter((l) => l.far === far)) {
        const a = L.a + Math.sin(gallop + L.ph) * 0.25, b = L.b + Math.sin(gallop + L.ph + 1) * 0.3;
        const [hx, hy] = T(L.x, L.y);
        const kx = hx + Math.sin(a) * L.l1 * U, ky = hy + Math.cos(a) * L.l1 * U;
        const fx = kx + Math.sin(a + b) * L.l2 * U, fy = ky + Math.cos(a + b) * L.l2 * U;
        ctx.strokeStyle = far ? mix(coatShade, dark, 0.3) : coatShade;
        ctx.lineCap = 'round';
        ctx.lineWidth = U * 0.055;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(kx, ky);
        ctx.stroke();
        ctx.lineWidth = U * 0.035;
        ctx.beginPath();
        ctx.moveTo(kx, ky);
        ctx.lineTo(fx, fy);
        ctx.stroke();
        ctx.fillStyle = mix(palette.accent, dark, 0.3);
        ctx.beginPath();
        ctx.arc(fx, fy, U * 0.025, 0, TAU);
        ctx.fill();
      }
    };
    legs(true);

    // Locks of mane and tail, streaming back in the wind.
    const locks = (x0, y0, n, len, spread, ang, w) => {
      const path = new Path2D();
      for (let i = 0; i < n; i++) {
        const f = i / Math.max(1, n - 1);
        const [sx, sy] = T(x0(f), y0(f));
        const a = ang + (f - 0.5) * spread + Math.sin(t * 5 + i * 0.9) * 0.12 * (1 + frame.mid);
        leaf(path, sx, sy, sx + Math.cos(a) * len, sy + Math.sin(a) * len, w);
      }
      return path;
    };
    const hair = mix(coat, palette.accent, 0.45);
    ctx.fillStyle = hair;
    ctx.fill(locks(() => -0.49, (f) => -0.03 + f * 0.04, 6, U * 0.5, 0.45, Math.PI + 0.2, U * 0.05));
    // Body.
    const body = trace(new Path2D(), BODY, T);
    const bg = ctx.createLinearGradient(0, oy - U * 0.5, 0, oy + U * 0.2);
    bg.addColorStop(0, coat);
    bg.addColorStop(1, coatShade);
    ctx.fillStyle = bg;
    ctx.fill(body);
    ctx.strokeStyle = rgba(coatShade, 0.8);
    ctx.lineWidth = 1.5 * u;
    ctx.stroke(body);
    legs(false);
    // Mane along the crest of the neck.
    ctx.fillStyle = hair;
    ctx.fill(locks((f) => 0.14 + f * 0.33, (f) => -0.1 - f * 0.42, 10, U * 0.22, 0.25, Math.PI - 0.35, U * 0.035));
    // Eye.
    const [ex, ey] = T(...EYE);
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(ex, ey, U * 0.018, 0, TAU);
    ctx.fill();

    wing(false);

    // Sparkle trail.
    ctx.globalCompositeOperation = 'lighter';
    this.sparks = this.sparks.filter((s) => {
      s.age += dt;
      if (s.age > s.life) return false;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const r = s.r * (1 - s.age / s.life);
      ctx.globalAlpha = clamp(1 - s.age / s.life) * Math.min(1, glowAmt);
      ctx.drawImage(this.spark, s.x - r, s.y - r, r * 2, r * 2);
      return s.x > -20;
    }).slice(-500);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  },
};
