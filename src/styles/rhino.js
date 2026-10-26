import { Path2D } from 'skia-canvas';
import { mix, rgba } from '../palettes.js';
import { clamp, sampleSpectrum } from '../util.js';
import { glowSprite } from '../sea.js';

const TAU = Math.PI * 2;

// The rhino in profile, facing right, in body units: x from the rump (−0.5)
// to the nose (0.72), y up is negative, the ground is y = 0. The head and the
// legs are separate so they can move; everything is filled as one silhouette.
const BODY = [
  ['M', -0.42, -0.5],
  ['C', -0.3, -0.56, -0.12, -0.5, 0.0, -0.53],    // back
  ['C', 0.07, -0.56, 0.12, -0.67, 0.19, -0.66],   // up onto the shoulder hump
  ['C', 0.26, -0.65, 0.3, -0.57, 0.31, -0.5],     // neck
  ['C', 0.36, -0.42, 0.35, -0.3, 0.29, -0.22],    // chest
  ['C', 0.18, -0.16, -0.05, -0.15, -0.2, -0.17],  // belly, sagging
  ['C', -0.32, -0.18, -0.38, -0.21, -0.44, -0.26],
  ['C', -0.5, -0.31, -0.52, -0.43, -0.42, -0.5],  // rump
  ['Z'],
];
const HEAD_PIVOT = [0.28, -0.47];
const HEAD = [
  ['M', 0.22, -0.57],
  ['C', 0.28, -0.6, 0.34, -0.58, 0.38, -0.55],    // crown
  ['C', 0.45, -0.51, 0.52, -0.46, 0.58, -0.41],   // forehead sloping down the long face
  ['C', 0.63, -0.38, 0.69, -0.34, 0.72, -0.29],   // snout
  ['C', 0.74, -0.26, 0.72, -0.22, 0.68, -0.21],   // square lip
  ['C', 0.6, -0.2, 0.52, -0.22, 0.45, -0.23],     // jaw
  ['C', 0.38, -0.25, 0.32, -0.28, 0.27, -0.34],   // throat
  ['C', 0.23, -0.4, 0.2, -0.5, 0.22, -0.57],
  ['Z'],
  // front horn, long and swept back
  ['M', 0.6, -0.39],
  ['C', 0.62, -0.47, 0.62, -0.58, 0.58, -0.68],
  ['C', 0.65, -0.6, 0.69, -0.46, 0.69, -0.33],
  ['Z'],
  // second horn
  ['M', 0.5, -0.45],
  ['C', 0.51, -0.5, 0.5, -0.54, 0.48, -0.57],
  ['C', 0.53, -0.53, 0.56, -0.48, 0.56, -0.42],
  ['Z'],
  // ears: tubes cupped forward
  ['M', 0.27, -0.58],
  ['C', 0.25, -0.64, 0.25, -0.68, 0.29, -0.71],
  ['C', 0.31, -0.67, 0.32, -0.63, 0.31, -0.58],
  ['Z'],
  ['M', 0.31, -0.58],
  ['C', 0.31, -0.63, 0.33, -0.67, 0.36, -0.69],
  ['C', 0.37, -0.65, 0.36, -0.61, 0.34, -0.57],
  ['Z'],
];
const EYE = [0.46, -0.41];
const NOSE = [0.71, -0.26];
const HORN_TIPS = [[0.58, -0.68], [0.48, -0.57]];
// Skin folds: shoulder, flank, hip, neck. Drawn as faint lines on the silhouette.
const FOLDS = [
  [['M', 0.14, -0.59], ['C', 0.1, -0.48, 0.1, -0.33, 0.15, -0.2]],
  [['M', 0.22, -0.56], ['C', 0.2, -0.47, 0.22, -0.38, 0.25, -0.3]],
  [['M', -0.24, -0.52], ['C', -0.29, -0.42, -0.29, -0.3, -0.25, -0.19]],
  [['M', -0.05, -0.2], ['C', 0.02, -0.23, 0.1, -0.23, 0.16, -0.21]],
];
// Legs: top (shoulder / hip) x, width, and which diagonal pair they trot in.
// Far legs are drawn first and a little darker.
const LEGS = [
  { x: 0.22, w: 0.1, pair: 1, far: true },
  { x: -0.33, w: 0.11, pair: 0, far: true },
  { x: 0.14, w: 0.12, pair: 0, far: false },
  { x: -0.39, w: 0.13, pair: 1, far: false },
];
const LEG_TOP = -0.32;

// Soft, flat puff for dust (glowSprite is too bright in the middle).
function dustSprite(env, color, size) {
  const s = Math.round(size);
  const c = env.createCanvas(s * 2, s * 2);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s, s, 0, s, s, s);
  grad.addColorStop(0, rgba(color, 0.7));
  grad.addColorStop(0.5, rgba(color, 0.45));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, s * 2, s * 2);
  return c;
}

// Builds a path from commands, mapping every point through T.
function trace(path, cmds, T) {
  for (const [op, ...v] of cmds) {
    const p = [];
    for (let i = 0; i < v.length; i += 2) p.push(...T(v[i], v[i + 1]));
    if (op === 'M') path.moveTo(...p);
    else if (op === 'L') path.lineTo(...p);
    else if (op === 'C') path.bezierCurveTo(...p);
    else if (op === 'Q') path.quadraticCurveTo(...p);
    else if (op === 'Z') path.closePath();
  }
  return path;
}

// A thick leg: shoulder at the top, slight knee, wide round foot, swung by `a`.
function legCmds({ x, w }, a, lift) {
  const len = -LEG_TOP - lift;
  const s = Math.sin(a), c = Math.cos(a);
  const at = (dx, dy) => [x + dx * c - dy * s, LEG_TOP + dx * s + dy * c]; // rotate about the top
  const top = 0.02, knee = len * 0.55;
  return [
    ['M', ...at(-w / 2, -top)],
    ['C', ...at(-w * 0.55, knee * 0.5), ...at(-w * 0.42, knee), ...at(-w * 0.4, len * 0.85)],
    ['C', ...at(-w * 0.45, len), ...at(w * 0.45, len), ...at(w * 0.42, len * 0.85)],
    ['C', ...at(w * 0.4, knee), ...at(w * 0.55, knee * 0.5), ...at(w / 2, -top)],
    ['Z'],
  ];
}

export default {
  name: 'rhino',
  description: 'A rhino silhouetted against a huge savanna sun: it trots in time with the beat, charges and headbutts on the kicks, kicking up dust, while the sun\'s rays play the spectrum',
  palette: 'savanna', // used when no -p is given
  // With --auto: settings scaled in calm parts, builds and drops (see modulate.js).
  sections: {
    calm: { trot: 0.7, charge: 0.4, dust: 0.5, glow: 0.85 },
    build: { trot: 0.9 },
    drop: { trot: 1.2, charge: 1.5, dust: 1.5, glow: 1.3 },
  },
  params: {
    size: 1,        // size of the rhino
    trot: 1,        // how much it trots in time with the beat (0 = stands still)
    charge: 1,      // how hard it lunges and headbutts on kicks (0 = calm)
    dust: 1,        // dust kicked up by the hooves and snorts (0 = none)
    sun: 1,         // size of the sun (0 = no sun)
    rays: 1,        // spectrum rays around the sun (0 = off)
    grass: 1,       // foreground grass swaying with the music (0 = none)
    trees: 3,       // acacia trees on the horizon (0–6)
    birds: 9,       // birds circling in the sky, scattering on hard hits (0 = none)
    glow: 1,        // rim light and horn glow
  },

  setup(ctx, env) {
    const { width, height, u, cx, cy, random, palette, params: p } = env;
    const S = (this.S = Math.min(width, height));
    this.t = 0;
    this.horizon = cy + S * 0.1;
    this.lunge = 0;
    this.lungeV = 0;
    this.scatter = 0;
    this.energy = null;
    this.dust = [];
    this.sunGlow = glowSprite(env, palette.colors[2], 160 * u);
    this.dustSprite = dustSprite(env, mix(palette.colors[0], palette.colors[1], 0.55), 64 * u);
    this.eyeSprite = glowSprite(env, palette.accent, 32 * u);

    // Far hills along the horizon, and one big mountain off to the side.
    this.hills = Array.from({ length: 9 }, () => random());
    this.mountainX = width * (random() < 0.5 ? 0.22 : 0.78);

    // Acacias on the horizon, kept clear of the middle where the rhino stands.
    const n = Math.round(clamp(p.trees, 0, 6));
    this.trees = Array.from({ length: n }, (_, i) => {
      const left = i % 2 === 0;
      const f = Math.floor(i / 2) / 3 + random() * 0.12;
      return {
        x: left ? width * (0.04 + f * 0.6) * 0.5 : width * (1 - (0.04 + f * 0.6) * 0.5),
        size: S * (0.07 + random() * 0.06),
        lean: (random() - 0.5) * 0.2,
        phase: random() * TAU,
        blobs: Array.from({ length: 5 }, () => [random() - 0.5, random()]),
      };
    });

    this.birds = Array.from({ length: Math.round(p.birds) }, () => ({
      a: random() * TAU,
      r: 0.6 + random() * 0.6,
      y: (random() - 0.5) * 0.5,
      speed: 0.25 + random() * 0.2,
      flap: random() * TAU,
      size: (5 + random() * 5) * u,
    }));

    // Grass blades along the front, each tied to a slice of the spectrum.
    this.blades = Array.from({ length: Math.round(260 * clamp(p.grass, 0, 2)) }, () => ({
      x: random(),
      y: random() ** 1.6, // depth: 0 at the rhino's feet, 1 right in front of the camera
      h: 0.4 + random() * 0.6,
      bend: (random() - 0.5) * 0.5,
      phase: random() * TAU,
    })).sort((a, b) => a.y - b.y);
  },

  draw(ctx, frame, env) {
    const { width, height, fps, u, cx, palette, random, params: p } = env;
    const dt = 1 / fps;
    this.t += dt;
    const t = this.t, S = this.S, horizon = this.horizon;
    this.energy = this.energy ?? frame.rms;
    this.energy += (frame.rms - this.energy) * 0.05;

    // Lunge: a spring kicked forward on every kick.
    if (frame.kick) this.lungeV += frame.kickStrength * 9 * p.charge;
    this.lungeV += (-this.lunge * 60 - this.lungeV * 9) * dt;
    this.lunge += this.lungeV * dt;
    if (frame.kick && frame.kickStrength > 0.6) this.scatter = Math.min(1.5, this.scatter + frame.kickStrength);
    this.scatter *= 0.97 ** (30 / fps);

    const dark = mix(palette.bg[0], '#000000', 0.55);
    const skyLow = mix(palette.colors[1], palette.colors[2], 0.35);

    // Sky: dusk overhead, burning towards the horizon.
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, rgba(palette.bg[0], 0.9));
    sky.addColorStop(0.55, rgba(mix(palette.bg[1], palette.colors[0], 0.6), 0.95));
    sky.addColorStop(1, skyLow);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizon);

    // The sun, low and huge, with spectrum rays behind it.
    const sunR = S * 0.26 * p.sun * (1 + 0.05 * frame.bass);
    const sunX = cx + S * 0.04, sunY = horizon - S * 0.06;
    if (p.sun > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const halo = sunR * (3.2 + 0.8 * frame.bass);
      ctx.globalAlpha = 0.35 + 0.25 * frame.rms;
      ctx.drawImage(this.sunGlow, sunX - halo, sunY - halo, halo * 2, halo * 2);
      ctx.globalAlpha = 1;
      if (p.rays > 0) {
        const n = 72;
        const levels = sampleSpectrum(frame.spectrum, n / 2);
        const rays = new Path2D();
        const turn = t * 0.02;
        for (let i = 0; i < n; i++) {
          const v = levels[i < n / 2 ? i : n - 1 - i]; // bass at the top, mirrored
          const a = turn + (i / n) * TAU - Math.PI / 2;
          const r0 = sunR * 1.06, r1 = r0 + S * 0.32 * p.rays * v ** 1.3;
          const w = (TAU / n) * 0.22;
          rays.moveTo(sunX + Math.cos(a - w) * r0, sunY + Math.sin(a - w) * r0);
          rays.lineTo(sunX + Math.cos(a) * r1, sunY + Math.sin(a) * r1);
          rays.lineTo(sunX + Math.cos(a + w) * r0, sunY + Math.sin(a + w) * r0);
          rays.closePath();
        }
        ctx.fillStyle = rgba(palette.colors[2], 0.16 + 0.2 * frame.pulse);
        ctx.fill(rays);
      }
      ctx.globalCompositeOperation = 'source-over';
      const disc = ctx.createRadialGradient(sunX, sunY - sunR * 0.3, sunR * 0.1, sunX, sunY, sunR);
      disc.addColorStop(0, mix(palette.text, palette.colors[2], 0.3));
      disc.addColorStop(0.6, palette.colors[2]);
      disc.addColorStop(1, mix(palette.colors[2], palette.colors[1], 0.6));
      ctx.fillStyle = disc;
      ctx.beginPath();
      ctx.arc(sunX, sunY, sunR, 0, TAU);
      ctx.fill();
      // Thin cloud bands drifting across the lower half of the sun.
      ctx.save();
      ctx.beginPath();
      ctx.arc(sunX, sunY, sunR + 1, 0, TAU);
      ctx.clip();
      ctx.fillStyle = rgba(mix(palette.colors[0], palette.bg[1], 0.5), 0.55);
      for (let k = 0; k < 4; k++) {
        const y = sunY + sunR * (0.15 + k * 0.2) + Math.sin(t * 0.3 + k) * sunR * 0.02;
        const h = sunR * (0.03 + 0.02 * k) * (1 + 0.5 * frame.mid);
        ctx.fillRect(sunX - sunR, y, sunR * 2, h);
      }
      ctx.restore();
    }

    // Distant mountain and hills, hazy with the light behind them.
    const haze = mix(palette.colors[0], skyLow, 0.45);
    const mx = this.mountainX, mw = S * 0.5, mh = S * 0.2;
    ctx.fillStyle = rgba(haze, 0.75);
    ctx.beginPath();
    ctx.moveTo(mx - mw, horizon);
    ctx.bezierCurveTo(mx - mw * 0.5, horizon - mh * 0.4, mx - mw * 0.2, horizon - mh, mx - mw * 0.05, horizon - mh * 1.02);
    ctx.lineTo(mx + mw * 0.08, horizon - mh);
    ctx.bezierCurveTo(mx + mw * 0.25, horizon - mh * 0.95, mx + mw * 0.55, horizon - mh * 0.35, mx + mw, horizon);
    ctx.closePath();
    ctx.fill();
    // Snow on the flat top, lit by the sun.
    ctx.fillStyle = rgba(mix(palette.text, skyLow, 0.4), 0.5);
    ctx.beginPath();
    ctx.moveTo(mx - mw * 0.16, horizon - mh * 0.86);
    ctx.lineTo(mx - mw * 0.05, horizon - mh * 1.02);
    ctx.lineTo(mx + mw * 0.08, horizon - mh);
    ctx.lineTo(mx + mw * 0.18, horizon - mh * 0.88);
    ctx.lineTo(mx + mw * 0.06, horizon - mh * 0.92);
    ctx.lineTo(mx - mw * 0.04, horizon - mh * 0.87);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = mix(palette.colors[0], dark, 0.55);
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    for (let i = 0; i <= 64; i++) {
      const f = i / 64, k = f * (this.hills.length - 1), j = Math.floor(k), e = k - j;
      const a = this.hills[j], b = this.hills[Math.min(this.hills.length - 1, j + 1)];
      const h = (a + (b - a) * (e * e * (3 - 2 * e))) * S * 0.035;
      ctx.lineTo(f * width, horizon - h);
    }
    ctx.lineTo(width, horizon);
    ctx.closePath();
    ctx.fill();

    // Ground.
    const ground = ctx.createLinearGradient(0, horizon, 0, height);
    ground.addColorStop(0, mix(palette.colors[0], dark, 0.45));
    ground.addColorStop(0.25, mix(palette.colors[0], dark, 0.75));
    ground.addColorStop(1, dark);
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizon, width, height - horizon);
    // Sunlight streaking across the ground towards us.
    ctx.globalCompositeOperation = 'lighter';
    const streak = ctx.createRadialGradient(sunX, horizon, 0, sunX, horizon, S * 0.7);
    streak.addColorStop(0, rgba(palette.colors[1], 0.22 + 0.15 * frame.bass));
    streak.addColorStop(1, rgba(palette.colors[1], 0));
    ctx.fillStyle = streak;
    ctx.save();
    ctx.translate(sunX, horizon);
    ctx.scale(1.6, 0.35);
    ctx.translate(-sunX, -horizon);
    ctx.fillRect(sunX - S, horizon, S * 2, S * 2);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';

    // Acacias: a forked trunk under a flat umbrella crown.
    ctx.fillStyle = mix(palette.colors[0], dark, 0.7);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineCap = 'round';
    for (const tr of this.trees) {
      const sway = Math.sin(t * 0.6 + tr.phase) * 0.02 + frame.mid * 0.02;
      const h = tr.size, x = tr.x, base = horizon + S * 0.005;
      const topX = x + (tr.lean + sway) * h, topY = base - h;
      ctx.lineWidth = h * 0.06;
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.quadraticCurveTo(x + tr.lean * h * 0.3, base - h * 0.5, topX - h * 0.25, topY);
      ctx.moveTo(x + tr.lean * h * 0.15, base - h * 0.45);
      ctx.quadraticCurveTo(x + h * 0.15, base - h * 0.7, topX + h * 0.3, topY + h * 0.02);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(topX, topY - h * 0.04, h * 0.7, h * 0.13, 0, 0, TAU);
      for (const [bx, by] of tr.blobs) ctx.ellipse(topX + bx * h * 1.1, topY - h * 0.08 - by * h * 0.06, h * 0.28, h * 0.1, 0, 0, TAU);
      ctx.fill();
    }

    // Birds wheeling overhead, flung outwards by hard hits.
    if (this.birds.length) {
      const fx = cx - S * 0.1, fy = horizon - S * 0.55;
      ctx.strokeStyle = mix(palette.bg[0], '#000000', 0.3);
      ctx.lineWidth = 2 * u;
      const flock = new Path2D();
      for (const b of this.birds) {
        b.a += dt * b.speed * (0.7 + 0.8 * this.energy + this.scatter);
        b.flap += dt * (9 + 10 * this.scatter);
        const r = S * 0.22 * b.r * (1 + 0.8 * this.scatter);
        const x = fx + Math.cos(b.a) * r, y = fy + Math.sin(b.a) * r * 0.35 + b.y * S * 0.12;
        const w = b.size * (1 + 0.3 * this.scatter), f = Math.sin(b.flap) * w * 0.6;
        flock.moveTo(x - w, y - f);
        flock.quadraticCurveTo(x - w * 0.4, y - w * 0.2 - f * 0.3, x, y);
        flock.quadraticCurveTo(x + w * 0.4, y - w * 0.2 - f * 0.3, x + w, y - f);
      }
      ctx.stroke(flock);
    }

    // The rhino.
    const U = S * 0.62 * p.size;
    const groundY = horizon + S * 0.15;
    // Trot: diagonal pairs swing in turn, one stride every two beats, more
    // when the track is louder. frame.bars runs smoothly with the beat grid.
    const stride = (frame.bars ?? t / 2) * 2 * TAU;
    const gait = p.trot * (0.12 + 0.3 * this.energy);
    const bob = Math.abs(Math.sin(stride)) * U * 0.012 * gait * 3;
    const lunge = this.lunge * U * 0.14;
    const ox = cx - U * 0.11 + lunge, oy = groundY - bob;
    const T = (x, y) => [ox + x * U, oy + y * U];
    // The head drops into a headbutt as it lunges, then swings back up.
    const nod = 0.14 + clamp(this.lunge, -0.6, 1.2) * 0.45 + Math.sin(stride) * 0.03 * gait; // head carried low
    const [hx, hy] = HEAD_PIVOT;
    const hc = Math.cos(nod), hs = Math.sin(nod);
    const TH = (x, y) => {
      const dx = x - hx, dy = y - hy;
      return T(hx + dx * hc - dy * hs, hy + dx * hs + dy * hc);
    };
    const legPaths = LEGS.map((leg) => {
      const swing = Math.sin(stride + leg.pair * Math.PI) * gait;
      const lift = Math.max(0, Math.sin(stride + leg.pair * Math.PI + Math.PI / 2)) * 0.03 * gait * 3;
      return { leg, path: trace(new Path2D(), legCmds(leg, swing, lift), T) };
    });
    const body = trace(new Path2D(), BODY, T);
    const head = trace(new Path2D(), HEAD, TH);

    // Contact shadow.
    ctx.fillStyle = rgba('#000000', 0.3);
    ctx.beginPath();
    ctx.ellipse(ox - 0.08 * U, groundY + U * 0.005, U * 0.5, U * 0.03, 0, 0, TAU);
    ctx.fill();

    // Rim light: the whole outline stroked with a glow, then the silhouette
    // filled over it, so only the outer edge shows (no seams between parts).
    // The sun is behind, so it's brightest along the back and fades out
    // before the hooves.
    const all = [...legPaths.map((l) => l.path), body, head];
    const rim = mix(palette.colors[2], palette.text, 0.3);
    const rimA = clamp(0.55 + 0.35 * frame.rms, 0, 1);
    const rimFade = ctx.createLinearGradient(0, oy - U * 0.7, 0, oy - U * 0.12);
    rimFade.addColorStop(0, rgba(rim, rimA));
    rimFade.addColorStop(0.6, rgba(rim, rimA * 0.6));
    rimFade.addColorStop(1, rgba(rim, 0));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, oy - U * 0.1);
    ctx.clip();
    ctx.strokeStyle = rimFade;
    ctx.lineWidth = (4 + 3 * frame.pulse) * u * p.glow;
    ctx.lineJoin = 'round';
    ctx.shadowColor = palette.colors[2];
    ctx.shadowBlur = (14 + 26 * frame.pulse) * u * p.glow;
    for (const path of all) ctx.stroke(path);
    ctx.restore();

    const hide = ctx.createLinearGradient(0, oy - U * 0.7, 0, oy);
    hide.addColorStop(0, mix(dark, palette.colors[0], 0.35));
    hide.addColorStop(1, dark);
    for (const { leg, path } of legPaths) {
      ctx.fillStyle = leg.far ? mix(dark, '#000000', 0.4) : hide;
      ctx.fill(path);
    }
    ctx.fillStyle = hide;
    ctx.fill(body);
    ctx.fill(head);

    // Folds in the hide, catching a little light.
    ctx.strokeStyle = rgba(mix(palette.colors[1], dark, 0.5), 0.5);
    ctx.lineWidth = 2 * u;
    for (const fold of FOLDS) ctx.stroke(trace(new Path2D(), fold, T));

    // Horns light up with the music; the eye glows.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const hornGlow = clamp(0.25 + 0.75 * frame.pulse, 0, 1) * p.glow;
    for (const [i, [x, y]] of HORN_TIPS.entries()) {
      const [px, py] = TH(x, y);
      const r = U * (i === 0 ? 0.16 : 0.1) * (0.6 + 0.6 * frame.pulse);
      ctx.globalAlpha = hornGlow * (i === 0 ? 0.9 : 0.6);
      ctx.drawImage(this.sunGlow, px - r, py - r, r * 2, r * 2);
    }
    const [ex, ey] = TH(...EYE);
    const er = U * 0.04 * (1 + 0.6 * frame.pulse);
    ctx.globalAlpha = clamp(0.6 + 0.4 * frame.pulse, 0, 1);
    ctx.drawImage(this.eyeSprite, ex - er, ey - er, er * 2, er * 2);
    ctx.restore();

    // Dust: hooves scuff it up while trotting, kicks throw up clouds, and a
    // snort blasts out of the nose.
    if (p.dust > 0) {
      const spawn = (x, y, vx, vy, size, life) => this.dust.push({ x, y, vx, vy, size, life, age: 0 });
      for (const { leg } of legPaths) {
        if (random() < dt * 10 * gait * p.dust) {
          const [fx, fy] = T(leg.x, 0);
          spawn(fx, fy, -(20 + random() * 50) * u, -(10 + random() * 25) * u, U * (0.04 + random() * 0.05), 1.5 + random());
        }
      }
      if (frame.kick) {
        const n = Math.round((6 + 14 * frame.kickStrength) * p.dust);
        for (let i = 0; i < n; i++) {
          const leg = LEGS[i % LEGS.length];
          const [fx, fy] = T(leg.x + (random() - 0.5) * 0.1, 0);
          spawn(fx, fy, -(60 + random() * 160) * u * frame.kickStrength, -(20 + random() * 80) * u, U * (0.05 + random() * 0.08), 1.2 + random() * 1.5);
        }
        const [nx, ny] = TH(...NOSE);
        for (let i = 0; i < 3 * p.dust; i++) spawn(nx, ny, (60 + random() * 80) * u, (10 + random() * 30) * u, U * (0.03 + random() * 0.03), 0.6 + random() * 0.4);
      }
      ctx.save();
      const alive = [];
      for (const d of this.dust) {
        d.age += dt;
        if (d.age > d.life) continue;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.vx *= 0.98 ** (30 / fps);
        d.vy = d.vy * 0.97 ** (30 / fps) - 6 * u * dt;
        const k = d.age / d.life, r = d.size * (1 + 2.5 * k);
        ctx.globalAlpha = 0.3 * Math.sin(Math.PI * Math.min(1, k * 1.5 + 0.15)) * (1 - k);
        ctx.drawImage(this.dustSprite, d.x - r, d.y - r, r * 2, r * 2);
        alive.push(d);
      }
      this.dust = alive.slice(-400);
      ctx.restore();
    }

    // Grass from the rhino's feet down to the camera, taller and darker the
    // nearer it is, each blade rising with its slice of the spectrum.
    if (this.blades.length) {
      const levels = sampleSpectrum(frame.spectrum, 24);
      const rows = 4;
      const paths = Array.from({ length: rows }, () => new Path2D());
      for (const b of this.blades) {
        const near = 1 + 3.5 * b.y;
        const x = b.x * width;
        const y = groundY + b.y * (height - groundY) * 0.95;
        const band = levels[Math.min(23, Math.floor(Math.abs(b.x - 0.5) * 2 * 24))];
        const h = S * (0.025 + 0.07 * band) * b.h * p.grass * near;
        const sway = (Math.sin(t * 1.4 + b.phase + b.x * 3) * 0.3 + frame.mid * 0.6 + b.bend) * h * 0.4;
        const w = 1.6 * u * near;
        const path = paths[Math.min(rows - 1, Math.floor(b.y * rows))];
        path.moveTo(x - w, y);
        path.quadraticCurveTo(x + sway * 0.3, y - h * 0.6, x + sway, y - h);
        path.quadraticCurveTo(x + sway * 0.3 + w, y - h * 0.6, x + w, y);
      }
      paths.forEach((path, i) => {
        ctx.fillStyle = mix(mix(palette.colors[0], dark, 0.5), mix(dark, '#000000', 0.4), i / (rows - 1));
        ctx.fill(path);
      });
    }
  },
};
