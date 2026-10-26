import { mix, rgba } from '../palettes.js';
import { clamp, lerp, sampleSpectrum } from '../util.js';

const TAU = Math.PI * 2;

// A crowd of little bean-shaped guys on a disco floor, each with googly eyes,
// noodle limbs and a hat, dancing their own quirky moves to the beat grid.
//
// Each guy is drawn in body units: height ≈ 1, feet on y = 0, y up is
// negative. A move turns the beat position into a pose: how far the body
// bobs up, squash and stretch, tilt, and the angles of the arms and legs.

const MOVES = ['bounce', 'chicken', 'wave', 'robot', 'spin', 'airguitar', 'shuffle', 'jacks', 'disco', 'noodle'];
const HATS = ['party', 'antenna', 'tuft', 'bow', 'tophat', 'none', 'party', 'antenna', 'beanie', 'sprout'];

// Integer hash → 0–1, so a pose picked per half-beat is the same on re-render.
function hash(a, b) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const ease = (x) => x * x * (3 - 2 * x);

// Arms: [shoulder angle, elbow bend]. 0 hangs down, π/2 points out sideways,
// π points straight up. The bend adds to it at the elbow.
function pose(move, beats, A, seed, t) {
  const bi = Math.floor(beats), ph = beats - bi;
  const dip = (1 + Math.cos(TAU * ph)) / 2; // 1 on the beat, 0 between
  const sway = Math.sin(Math.PI * beats);  // side to side over two beats
  const p = { up: 0, sx: 1, sy: 1, tilt: 0, dx: 0, flip: 1, armL: [0.35, 0.2], armR: [0.35, 0.2], footL: -0.13, footR: 0.13, liftL: 0, liftR: 0, look: 0 };
  switch (move) {
    case 'bounce':
      p.up = 0.09 * (1 - dip) * A;
      p.sy = 1 - 0.13 * dip * A;
      p.sx = 1 + 0.1 * dip * A;
      p.armL = p.armR = [lerp(0.5, 2.5, (1 - dip) * A), 0.7];
      break;
    case 'chicken': {
      const flap = (1 - dip) * A;
      p.armL = p.armR = [0.5 + 1.1 * flap, -2.1 + 0.5 * flap];
      p.tilt = 0.12 * sway * A;
      p.dx = 0.05 * sway * A;
      p.up = 0.04 * flap;
      p.liftL = sway > 0 ? 0.06 * A * Math.abs(sway) : 0;
      p.liftR = sway < 0 ? 0.06 * A * Math.abs(sway) : 0;
      break;
    }
    case 'wave':
      p.armL = [lerp(0.6, 2.75, A) - 0.25 * sway, 0.35 * sway];
      p.armR = [lerp(0.6, 2.75, A) + 0.25 * sway, 0.35 * sway];
      p.tilt = -0.16 * sway * A;
      p.dx = 0.05 * sway * A;
      p.sy = 1 - 0.06 * dip * A;
      break;
    case 'robot': {
      // A new stiff pose every half beat, snapped into place.
      const q = Math.floor(beats * 2), k = ease(clamp((beats * 2 - q) / 0.2));
      const at = (n, s) => [[0, 1.57, 3.14, 1.57][Math.floor(hash(n, s) * 4)], [0, 1.57, -1.57, 0][Math.floor(hash(n, s + 7) * 4)]];
      const [a0, a1] = [at(q - 1, seed), at(q, seed)], [b0, b1] = [at(q - 1, seed + 3), at(q, seed + 3)];
      p.armL = [lerp(a0[0], a1[0], k) * A, lerp(a0[1], a1[1], k) * A];
      p.armR = [lerp(b0[0], b1[0], k) * A, lerp(b0[1], b1[1], k) * A];
      p.dx = 0.03 * (hash(q, seed + 11) - 0.5) * A;
      p.look = Math.round(hash(q, seed + 5) * 2 - 1);
      break;
    }
    case 'spin': {
      // Turns once a bar, like a paper cut-out, arms out.
      const turn = (beats / 4) % 1;
      p.flip = Math.cos(TAU * turn);
      p.armL = p.armR = [lerp(0.4, 1.6, A), 0.2];
      p.up = 0.05 * (1 - dip) * A;
      break;
    }
    case 'airguitar':
      p.sy = 1 - 0.12 * dip * A;
      p.up = 0.03 * (1 - dip) * A;
      p.tilt = 0.1 * dip * A;
      p.armR = [0.55 + 0.6 * dip * A, 1.3];   // strumming
      p.armL = [1.2, -0.9];                     // holding the neck
      p.look = 1;
      break;
    case 'shuffle':
      p.footL = -0.13 + 0.11 * sway * A;
      p.footR = 0.13 + 0.11 * sway * A;
      p.liftL = 0.05 * Math.max(0, Math.sin(TAU * beats)) * A;
      p.liftR = 0.05 * Math.max(0, -Math.sin(TAU * beats)) * A;
      p.dx = 0.06 * sway * A;
      p.armL = [0.4 - 0.5 * sway * A, 0.9];
      p.armR = [0.4 + 0.5 * sway * A, 0.9];
      p.up = 0.025 * (1 - dip);
      break;
    case 'jacks': {
      const open = bi % 2 === 0 ? ease(clamp(ph * 2)) : 1 - ease(clamp(ph * 2));
      const o = open * A;
      p.armL = p.armR = [0.25 + 2.6 * o, 0.2 * o];
      p.footL = -0.1 - 0.15 * o;
      p.footR = 0.1 + 0.15 * o;
      p.up = 0.08 * Math.sin(Math.PI * clamp(ph * 2)) * A;
      break;
    }
    case 'disco': {
      // Point up across, point down across, hand on the hip.
      const upBeat = bi % 2 === 0, k = ease(clamp(ph / 0.25));
      const from = upBeat ? 0.5 : 2.6, to = upBeat ? 2.6 : 0.5;
      p.armR = [lerp(from, to, k) * A + 0.3 * (1 - A), 0];
      p.armL = [0.75, -2.2];
      p.tilt = (upBeat ? -0.12 : 0.1) * A;
      p.dx = 0.04 * sway * A;
      p.sy = 1 - 0.06 * dip * A;
      break;
    }
    case 'noodle': {
      // Wacky floppy tube man.
      const w = (f, o) => Math.sin(t * f + seed + o);
      p.tilt = 0.28 * w(5.1, 0) * A;
      p.dx = 0.05 * w(3.3, 1) * A;
      p.sy = 1 + 0.12 * w(7.7, 2) * A;
      p.sx = 1 - 0.08 * w(7.7, 2) * A;
      p.armL = [1.5 + 1.3 * w(6.3, 3) * A, 1.6 * w(9.1, 4) * A];
      p.armR = [1.5 + 1.3 * w(5.7, 5) * A, 1.6 * w(8.3, 6) * A];
      p.up = 0.04 * (1 - dip) * A;
      break;
    }
  }
  return p;
}

function blendPose(a, b, k) {
  if (k >= 1) return b;
  const out = {};
  for (const key in b) {
    out[key] = Array.isArray(b[key]) ? [lerp(a[key][0], b[key][0], k), lerp(a[key][1], b[key][1], k)] : lerp(a[key], b[key], k);
  }
  return out;
}

// Two-bone limb from `root` towards `end` (lengths l1 + l2), bending to `side`.
function knee(root, end, l, side) {
  const dx = end[0] - root[0], dy = end[1] - root[1];
  const d = Math.min(Math.hypot(dx, dy) || 1e-6, l * 2 * 0.999);
  const ux = dx / (Math.hypot(dx, dy) || 1), uy = dy / (Math.hypot(dx, dy) || 1);
  const foot = [root[0] + ux * d, root[1] + uy * d];
  const h = Math.sqrt(Math.max(0, l * l - (d / 2) ** 2));
  return [[root[0] + ux * d / 2 - uy * h * side, root[1] + uy * d / 2 + ux * h * side], foot];
}

export default {
  name: 'lilguys',
  description: 'A crowd of little googly-eyed guys dancing quirky moves on a disco floor: they bounce, flap, robot and noodle to the beat, hop on the kicks and sync up for the drops',
  palette: 'party', // used when no -p is given
  params: {
    guys: 14,       // how many lil guys (1–40)
    size: 1,        // size of the guys
    dance: 1,       // how wild the moves get (0 = just standing there)
    hop: 1,         // hops (and the odd flip) on the kicks (0 = none)
    sync: 1,        // the crowd syncing up into one move on loud parts (0 = never)
    confetti: 1,    // confetti bursts on big hits (0 = none)
    floor: 1,       // disco floor tiles lighting up with the spectrum
    disco: 1,       // mirror ball, light beams and sparkles (0 = off)
    googly: 1,      // how much the pupils wobble
  },

  setup(ctx, env) {
    const { width, height, u, cx, cy, random, palette, params: p } = env;
    const S = (this.S = Math.min(width, height));
    this.dt = 1 / env.fps;
    this.t = 0;
    const tall = height / width > 1.5;
    this.floorTop = cy - S * (tall ? 0.15 : 0.08);
    this.floorBottom = Math.min(height * 0.92, cy + S * 0.75); // where the front row can stand
    const D = this.floorBottom - this.floorTop;
    this.ballY = Math.max(S * 0.12, this.floorTop - S * 0.58);
    this.ballR = S * 0.07;
    this.confetti = [];
    this.loud = 0;
    this.syncMove = null;
    this.lastKey = null;

    // Rows: the back ones smaller (further away) and holding more guys.
    const n = Math.round(clamp(p.guys, 1, 40));
    const rows = n <= 5 ? 1 : n <= 11 ? 2 : tall ? 4 : 3;
    const rowInfo = Array.from({ length: rows }, (_, r) => {
      const f = rows === 1 ? 0.55 : r / (rows - 1); // 0 = back, 1 = front
      return { f, y: this.floorTop + D * lerp(0.16, 0.8, f), scale: lerp(0.6, 1, f) };
    });
    const weights = rowInfo.map((r) => 1 / r.scale);
    const counts = rowInfo.map((_, r) => Math.floor((n * weights[r]) / weights.reduce((a, b) => a + b, 0)));
    for (let r = rows - 1; counts.reduce((a, b) => a + b, 0) < n; r = (r + rows - 1) % rows) counts[r]++;

    const H = S * 0.17 * p.size * (n <= 2 ? 1.8 : n <= 5 ? 1.3 : 1); // a small crowd gets closer
    const colors = palette.colors;
    this.guys = [];
    let idx = 0;
    rowInfo.forEach((row, r) => {
      const c = counts[r];
      const spanW = width * lerp(0.62, 0.86, row.f);
      for (let i = 0; i < c; i++) {
        const slot = c === 1 ? 0.5 : (i + 0.5 + (r % 2 ? 0.25 : -0.25) * (c > 1 ? 1 : 0)) / c;
        const x = cx + (slot - 0.5) * spanW + (random() - 0.5) * (spanW / Math.max(c, 1)) * 0.35;
        const color = colors[(idx * 3 + r) % colors.length];
        this.guys.push({
          x, y: row.y + (random() - 0.5) * D * 0.06, H: H * row.scale * (0.85 + random() * 0.3),
          row: r, xn: x / width,
          color, dark: mix(color, '#000000', 0.6), light: mix(color, '#ffffff', 0.55),
          hat: HATS[Math.floor(random() * HATS.length)],
          hatColor: colors[(idx * 3 + r + 1 + Math.floor(random() * 2)) % colors.length],
          seed: Math.floor(random() * 100000),
          band: random(),
          move: MOVES[Math.floor(random() * MOVES.length)],
          prev: null, changedAt: -10,
          e: 0,
          jump: 0, vy: 0, flipRot: 0, flipping: false, land: 0,
          pupil: [0, 0], pupilV: [0, 0], lastPos: [0, 0], lastVel: [0, 0],
          blinkAt: 1 + random() * 4, blink: 0,
          antenna: 0, antennaV: 0,
          mouth: random() < 0.3 ? 'o' : 'smile',
          lookT: 0, lookX: 0,
        });
        idx++;
      }
    });
    this.guys.sort((a, b) => a.y - b.y);

    // Mirror ball facets and the light dots it throws on the back wall.
    this.dots = Array.from({ length: 60 }, () => ({ x: random(), y: random(), r: (1.5 + random() * 3) * u, c: Math.floor(random() * colors.length), tw: random() * TAU }));
  },

  draw(ctx, frame, env) {
    const { width, height, u, cx, palette, params: p } = env;
    const dt = this.dt;
    this.t += dt;
    const t = this.t;
    const colors = palette.colors;
    const beats = frame.bars * 4;
    const spec = sampleSpectrum(frame.spectrum, 24);
    this.loud += (frame.rms - this.loud) * 0.02; // slow: how loud this part is

    // Every two bars some guys change moves. On loud parts (drops) the whole
    // crowd may sync up into one move, rippling from left to right.
    const key = Math.floor(frame.bars / 2);
    if (key !== this.lastKey) {
      const first = this.lastKey === null;
      this.lastKey = key;
      const r = (n) => hash(key, n);
      this.syncMove = p.sync > 0 && this.loud > 0.62 - 0.12 * (p.sync - 1) && r(1) < 0.55 * p.sync ? MOVES[Math.floor(r(2) * MOVES.length)] : null;
      this.guys.forEach((g, i) => {
        const next = this.syncMove ?? (r(10 + i) < 0.55 ? MOVES[Math.floor(r(50 + i) * MOVES.length)] : g.move);
        if (next !== g.move && !first) {
          g.prev = g.move;
          g.changedAt = beats;
        }
        g.move = next;
      });
    }

    this.drawRoom(ctx, frame, env, beats, spec);

    // Kicks: hops, and on the big ones a flip or two, plus confetti.
    if (frame.kick && p.hop > 0) {
      for (const g of this.guys) {
        if (g.jump > 0.001 || hash(frame.index, g.seed) > 0.35 + 0.5 * frame.kickStrength) continue;
        const h = (0.1 + 0.22 * frame.kickStrength) * p.hop * (0.7 + 0.6 * hash(g.seed, frame.index + 1));
        g.vy = Math.sqrt(2 * 30 * h);
        g.flipping = frame.kickStrength > 0.75 && hash(g.seed + 9, frame.index) < 0.12 * p.hop;
        g.flipRot = 0;
        g.flipDir = hash(g.seed, 3) < 0.5 ? -1 : 1;
      }
    }
    if (p.confetti > 0 && frame.kick && frame.kickStrength > 0.7 && this.confetti.length < 500) {
      const n = Math.round(40 * p.confetti * frame.kickStrength);
      const sx = width * (0.15 + 0.7 * hash(frame.index, 77));
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (hash(frame.index, i) - 0.5) * 1.6;
        const v = (600 + 900 * hash(i, frame.index + 5)) * u;
        this.confetti.push({
          x: sx, y: this.floorTop + (this.floorBottom - this.floorTop) * 0.3,
          vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          rot: hash(i, 9) * TAU, vr: (hash(i, 11) - 0.5) * 20, spin: hash(i, 13) * TAU,
          w: (10 + 8 * hash(i, 15)) * u, h: (5 + 4 * hash(i, 17)) * u,
          c: colors[i % colors.length], life: 2.5 + hash(i, 19) * 1.5,
        });
      }
    }

    // Shadows first, so no guy's shadow lands on another guy.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (const g of this.guys) {
      const s = 1 / (1 + g.jump * 3);
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, g.H * 0.36 * s, g.H * 0.07 * s, 0, 0, TAU);
      ctx.fill();
    }
    for (const g of this.guys) this.drawGuy(ctx, g, frame, env, beats, spec);

    this.drawConfetti(ctx, dt, t);
  },

  drawRoom(ctx, frame, env, beats, spec) {
    const { width, height, u, cx, palette, params: p } = env;
    const colors = palette.colors;
    const { floorTop, floorBottom } = this;
    const D = floorBottom - floorTop;
    const bi = Math.floor(beats);

    // Light dots from the mirror ball drifting across the back wall.
    if (p.disco > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const drift = this.t * 0.04;
      for (const d of this.dots) {
        const x = (((d.x + drift) % 1) + 1) % 1 * width;
        const y = d.y * floorTop;
        const a = (0.15 + 0.6 * frame.high) * (0.5 + 0.5 * Math.sin(this.t * 3 + d.tw)) * p.disco;
        ctx.fillStyle = rgba(colors[d.c], Math.min(1, a));
        ctx.beginPath();
        ctx.arc(x, y, d.r, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // The floor: dark, then perspective tiles lit in a checker that moves on
    // every beat, each column by its slice of the spectrum.
    ctx.fillStyle = rgba(mix(palette.bg[1], '#000000', 0.4), 0.92);
    ctx.fillRect(0, floorTop, width, height - floorTop);
    if (p.floor > 0) {
      const R = 8, C = 9, FD = height - floorTop; // tiles run to the bottom edge
      const yAt = (j) => floorTop + FD * (j / R) ** 1.35;
      const halfW = (y) => width * lerp(0.42, 0.8, (y - floorTop) / FD);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let j = 0; j < R; j++) {
        const y0 = yAt(j), y1 = yAt(j + 1), w0 = halfW(y0), w1 = halfW(y1);
        for (let i = 0; i < C; i++) {
          const lit = (i + j + bi) % 2 === 0;
          const level = spec[Math.floor((i / C) * spec.length)];
          const a = (lit ? 0.06 + 0.4 * level * (0.6 + 0.4 * frame.pulse) : 0.025) * p.floor;
          const xa = (i / C - 0.5) * 2, xb = ((i + 1) / C - 0.5) * 2;
          const inset = 0.06;
          ctx.fillStyle = rgba(colors[(i + j * 2) % colors.length], Math.min(1, a));
          ctx.beginPath();
          ctx.moveTo(cx + lerp(xa, xb, inset) * w0, lerp(y0, y1, inset));
          ctx.lineTo(cx + lerp(xb, xa, inset) * w0, lerp(y0, y1, inset));
          ctx.lineTo(cx + lerp(xb, xa, inset) * w1, lerp(y1, y0, inset));
          ctx.lineTo(cx + lerp(xa, xb, inset) * w1, lerp(y1, y0, inset));
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    }
    // Floor edge.
    ctx.strokeStyle = rgba(palette.accent, 0.25);
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.moveTo(0, floorTop);
    ctx.lineTo(width, floorTop);
    ctx.stroke();

    if (p.disco <= 0) return;
    // Beams from the ball sweeping over the floor.
    const bx = cx, by = this.ballY, br = this.ballR * Math.sqrt(p.disco);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const sweep = Math.sin(this.t * (0.5 + 0.13 * i) + i * 1.7);
      const tx = cx + sweep * width * 0.6, ty = floorBottom;
      const spread = width * 0.05;
      const grad = ctx.createLinearGradient(bx, by, tx, ty);
      const a = (0.05 + 0.14 * frame.mid + 0.1 * frame.pulse) * p.disco;
      grad.addColorStop(0, rgba(colors[i % colors.length], Math.min(1, a * 1.6)));
      grad.addColorStop(1, rgba(colors[i % colors.length], 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(tx - spread, ty);
      ctx.lineTo(tx + spread, ty);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // The ball itself on its string: tiles turning past, glinting with the highs.
    ctx.strokeStyle = rgba(palette.text, 0.35);
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.moveTo(bx, 0);
    ctx.lineTo(bx, by - br);
    ctx.stroke();
    const body = ctx.createRadialGradient(bx - br * 0.3, by - br * 0.3, br * 0.1, bx, by, br);
    body.addColorStop(0, '#d8d8e0');
    body.addColorStop(1, '#3a3a48');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, TAU);
    ctx.clip();
    const rot = this.t * 0.8;
    const lats = 7, lons = 14;
    for (let a = 0; a < lats; a++) {
      const v0 = -Math.PI / 2 + (a / lats) * Math.PI, v1 = v0 + Math.PI / lats;
      for (let b = 0; b < lons; b++) {
        const l0 = ((b / lons) * TAU + rot) % TAU, l1 = l0 + TAU / lons;
        if (Math.cos(l0) < 0 && Math.cos(l1) < 0) continue; // back side
        const pt = (lat, lon) => [bx + br * Math.cos(lat) * Math.sin(lon), by + br * Math.sin(lat)];
        const g = hash(a * 31 + b, Math.floor(this.t * 6));
        const shine = 0.15 + 0.5 * g * (0.4 + frame.high);
        ctx.fillStyle = g > 0.9 ? rgba(colors[b % colors.length], 0.9) : `rgba(255,255,255,${Math.min(0.9, shine)})`;
        ctx.beginPath();
        const c = [pt(v0, l0), pt(v0, l1), pt(v1, l1), pt(v1, l0)];
        ctx.moveTo(...c[0]);
        for (const q of c.slice(1)) ctx.lineTo(...q);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
    // A glint on the hits.
    if (frame.onset) this.glint = 1;
    this.glint = (this.glint ?? 0) * 0.85;
    if (this.glint > 0.05) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,255,255,${this.glint})`;
      ctx.lineWidth = 3 * u;
      const gx = bx - br * 0.35, gy = by - br * 0.35, s = br * 0.8 * this.glint;
      ctx.beginPath();
      ctx.moveTo(gx - s, gy); ctx.lineTo(gx + s, gy);
      ctx.moveTo(gx, gy - s); ctx.lineTo(gx, gy + s);
      ctx.stroke();
      ctx.restore();
    }
  },

  drawGuy(ctx, g, frame, env, beats, spec) {
    const { params: p } = env;
    const dt = this.dt;

    // How into it this guy is: his own slice of the spectrum, plus loudness.
    const level = spec[Math.min(spec.length - 1, Math.floor(g.band * spec.length))];
    g.e += (0.5 * level + 0.5 * frame.rms - g.e) * 0.25;
    const A = clamp((0.3 + 0.8 * g.e) * p.dance, 0, 1.6);

    // In sync the moves ripple across the crowd, left to right.
    const myBeats = this.syncMove ? beats - g.xn * 0.75 : beats + (g.seed % 7) * 0.02;
    let ps = pose(g.move, myBeats, A, g.seed, this.t);
    const k = clamp((beats - g.changedAt) / 0.75);
    if (g.prev && k < 1) ps = blendPose(pose(g.prev, myBeats, A, g.seed, this.t), ps, ease(k));

    // Hop physics (units of body height, gravity 30/s²), with a squash on landing.
    if (g.vy !== 0 || g.jump > 0) {
      g.jump += g.vy * dt;
      g.vy -= 30 * dt;
      if (g.flipping) g.flipRot += g.flipDir * TAU * dt / Math.max(0.2, (2 * Math.sqrt(2 * 30 * 0.3)) / 30);
      if (g.jump <= 0) {
        g.land = Math.min(1, -g.vy / 6);
        g.jump = 0;
        g.vy = 0;
        g.flipping = false;
        g.flipRot = 0;
      }
    }
    g.land *= 0.8;
    const sy = ps.sy * (1 - 0.18 * g.land), sx = ps.sx * (1 + 0.14 * g.land);

    // Googly pupils: they lag behind the head's movement and wobble back.
    const headX = ps.dx + Math.sin(ps.tilt) * 0.5, headY = -ps.up - g.jump;
    const vel = [(headX - g.lastPos[0]) / dt, (headY - g.lastPos[1]) / dt];
    const acc = [(vel[0] - g.lastVel[0]) / dt, (vel[1] - g.lastVel[1]) / dt];
    g.lastPos = [headX, headY];
    g.lastVel = vel;
    // Glance around now and then (or where the move says).
    if (this.t > g.lookT) {
      g.lookT = this.t + 0.6 + hash(g.seed, Math.floor(this.t)) * 2.5;
      g.lookX = (hash(g.seed + 1, Math.floor(this.t * 3)) - 0.5) * 1.6;
    }
    const target = [(ps.look || g.lookX) * 0.035, 0.012];
    for (let i = 0; i < 2; i++) {
      const wob = clamp(-acc[i] * 0.0006 * p.googly, -6, 6);
      g.pupilV[i] += ((target[i] - g.pupil[i]) * 180 + wob) * dt;
      g.pupilV[i] *= Math.exp(-5 * dt / Math.max(0.2, p.googly));
      g.pupil[i] += g.pupilV[i] * dt;
    }
    const pr = Math.hypot(g.pupil[0], g.pupil[1]), maxR = 0.042;
    if (pr > maxR) {
      g.pupil[0] *= maxR / pr; g.pupil[1] *= maxR / pr;
      g.pupilV[0] *= -0.4; g.pupilV[1] *= -0.4;
    }
    // Antenna / sprout spring.
    g.antennaV += (-g.antenna * 120 - acc[0] * 0.02 - g.antennaV * 6) * dt;
    g.antenna += g.antennaV * dt;
    // Blinks.
    if (this.t > g.blinkAt) {
      g.blink = 1;
      g.blinkAt = this.t + 1.5 + hash(g.seed, Math.floor(this.t * 10)) * 4;
    }
    g.blink = Math.max(0, g.blink - dt / 0.14);

    ctx.save();
    ctx.translate(g.x, g.y - g.jump * g.H);
    ctx.scale(g.H, g.H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const lw = 0.065;

    const hipY = -0.3 - ps.up;
    const flip = ps.flip, side = Math.sign(flip) || 1, fa = Math.max(0.12, Math.abs(flip));
    const ry = 0.42 * sy, rx = 0.34 * sx;
    const bodyCY = hipY - ry * 0.92;

    // Legs: bow-legged noodles, knees bending out.
    ctx.strokeStyle = g.dark;
    ctx.lineWidth = lw * 1.1;
    const feet = [[ps.footL * fa, -ps.liftL, -1], [ps.footR * fa, -ps.liftR, 1]];
    for (const [fx, fy, s] of feet) {
      const hip = [ps.dx + s * 0.11 * sx * fa, hipY];
      const [kn, ft] = knee(hip, [fx, fy], 0.19, s);
      ctx.beginPath();
      ctx.moveTo(...hip);
      ctx.quadraticCurveTo(kn[0], kn[1], ft[0], ft[1]);
      ctx.stroke();
      ctx.fillStyle = g.dark;
      ctx.beginPath();
      ctx.ellipse(ft[0] + s * 0.035 * fa, ft[1] - 0.015, 0.065 * fa + 0.01, 0.035, 0, 0, TAU);
      ctx.fill();
    }

    // Body (and arms) tilt around the hips, flips spin around the middle.
    ctx.translate(ps.dx, hipY);
    ctx.rotate(ps.tilt);
    ctx.translate(-ps.dx, -hipY);
    if (g.flipRot) {
      ctx.translate(ps.dx, bodyCY);
      ctx.rotate(g.flipRot);
      ctx.translate(-ps.dx, -bodyCY);
    }

    const drawArm = (arm, s) => {
      const sh = [ps.dx + s * rx * fa * 0.9, bodyCY + 0.06];
      const a = arm[0], b = arm[0] + arm[1];
      const el = [sh[0] + s * Math.sin(a) * 0.19 * fa, sh[1] + Math.cos(a) * 0.19];
      const hd = [el[0] + s * Math.sin(b) * 0.17 * fa, el[1] + Math.cos(b) * 0.17];
      ctx.strokeStyle = g.dark;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(...sh);
      ctx.quadraticCurveTo(el[0], el[1], hd[0], hd[1]);
      ctx.stroke();
      ctx.fillStyle = g.light;
      ctx.beginPath();
      ctx.arc(hd[0], hd[1], 0.055, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = g.dark;
      ctx.lineWidth = lw * 0.5;
      ctx.stroke();
    };
    // Facing away, the arms go in front; facing us, behind the body edge.
    const armL = side > 0 ? ps.armL : ps.armR, armR = side > 0 ? ps.armR : ps.armL;
    if (side > 0) { drawArm(armL, -1); drawArm(armR, 1); }

    // The bean.
    const grad = ctx.createRadialGradient(ps.dx - rx * 0.35 * side, bodyCY - ry * 0.4, 0.02, ps.dx, bodyCY, ry * 1.1);
    grad.addColorStop(0, g.light);
    grad.addColorStop(0.45, g.color);
    grad.addColorStop(1, mix(g.color, '#000000', 0.35));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(ps.dx, bodyCY, rx * fa, ry, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = g.dark;
    ctx.lineWidth = lw * 0.8;
    ctx.stroke();

    // Face, when facing us.
    if (flip > 0.2) {
      const ex = 0.12 * fa, ey = bodyCY - 0.1 * sy, er = 0.085;
      for (const s of [-1, 1]) {
        const x = ps.dx + s * ex;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(x, ey, er * fa, er * (1 - 0.92 * g.blink), 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = g.dark;
        ctx.lineWidth = lw * 0.4;
        ctx.stroke();
        if (g.blink < 0.5) {
          ctx.fillStyle = '#111111';
          ctx.beginPath();
          ctx.arc(x + g.pupil[0] * fa, ey + g.pupil[1], 0.04, 0, TAU);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.beginPath();
          ctx.arc(x + g.pupil[0] * fa - 0.012, ey + g.pupil[1] - 0.014, 0.011, 0, TAU);
          ctx.fill();
        }
      }
      // Blush.
      ctx.fillStyle = 'rgba(255,110,150,0.35)';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(ps.dx + s * 0.2 * fa, ey + 0.1, 0.05 * fa, 0.025, 0, 0, TAU);
        ctx.fill();
      }
      // Mouth: a smile that opens up when it's loud, or a little "o".
      const open = clamp(frame.rms * 1.3 * (0.5 + g.e) - 0.25, 0, 1);
      const my = bodyCY + 0.09 * sy;
      ctx.fillStyle = '#3a0d1a';
      ctx.strokeStyle = g.dark;
      ctx.lineWidth = lw * 0.5;
      ctx.beginPath();
      if (g.mouth === 'o') ctx.ellipse(ps.dx, my + 0.01, (0.025 + 0.015 * open) * fa, 0.025 + 0.04 * open, 0, 0, TAU);
      else {
        ctx.moveTo(ps.dx - 0.07 * fa, my);
        ctx.quadraticCurveTo(ps.dx, my + 0.05 + 0.1 * open, ps.dx + 0.07 * fa, my);
        ctx.quadraticCurveTo(ps.dx, my + 0.02 + 0.03 * open, ps.dx - 0.07 * fa, my);
      }
      ctx.fill();
      ctx.stroke();
    }

    this.drawHat(ctx, g, ps.dx, bodyCY - ry, fa, side);
    if (side < 0) { drawArm(armL, -1); drawArm(armR, 1); }
    ctx.restore();
  },

  drawHat(ctx, g, x, top, fa, side) {
    const lw = 0.04;
    ctx.strokeStyle = g.dark;
    ctx.lineWidth = lw;
    ctx.fillStyle = g.hatColor;
    switch (g.hat) {
      case 'party': {
        ctx.beginPath();
        ctx.moveTo(x - 0.11 * fa, top + 0.04);
        ctx.lineTo(x + 0.04 * side * fa + g.antenna * 0.3, top - 0.27);
        ctx.lineTo(x + 0.11 * fa, top + 0.04);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x + 0.04 * side * fa + g.antenna * 0.3, top - 0.28, 0.04, 0, TAU);
        ctx.fill();
        break;
      }
      case 'antenna': {
        const tx = x + g.antenna * 0.6, ty = top - 0.24;
        ctx.beginPath();
        ctx.moveTo(x, top + 0.01);
        ctx.quadraticCurveTo(x, top - 0.14, tx, ty);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(tx, ty, 0.045, 0, TAU);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'sprout': {
        const tx = x + g.antenna * 0.5, ty = top - 0.16;
        ctx.strokeStyle = '#2f9e44';
        ctx.beginPath();
        ctx.moveTo(x, top + 0.01);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.fillStyle = '#51cf66';
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(tx + s * 0.06, ty - 0.01, 0.065, 0.03, s * -0.5, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'tuft': {
        ctx.strokeStyle = g.dark;
        ctx.lineWidth = lw * 0.9;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(x + i * 0.03 * fa, top + 0.015);
          ctx.quadraticCurveTo(x + i * 0.07 * fa + g.antenna * 0.3, top - 0.08, x + i * 0.11 * fa + g.antenna * 0.5, top - 0.06 - 0.03 * (1 - Math.abs(i)));
          ctx.stroke();
        }
        break;
      }
      case 'bow': {
        const by = top + 0.03, bx = x + 0.13 * fa * side;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - 0.09, by - 0.06);
        ctx.lineTo(bx - 0.09, by + 0.06);
        ctx.closePath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + 0.09, by - 0.06);
        ctx.lineTo(bx + 0.09, by + 0.06);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'tophat': {
        ctx.fillStyle = '#16131c';
        ctx.strokeStyle = '#000000';
        ctx.beginPath();
        ctx.rect(x - 0.1 * fa, top - 0.2, 0.2 * fa, 0.2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x, top + 0.005, 0.16 * fa, 0.03, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = g.hatColor;
        ctx.fillRect(x - 0.1 * fa, top - 0.06, 0.2 * fa, 0.035);
        break;
      }
      case 'beanie': {
        ctx.beginPath();
        ctx.ellipse(x, top + 0.07, 0.2 * fa, 0.13, 0, Math.PI, TAU);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x + g.antenna * 0.2, top - 0.07, 0.04, 0, TAU);
        ctx.fill();
        break;
      }
    }
  },

  drawConfetti(ctx, dt, t) {
    const { floorBottom } = this;
    const keep = [];
    for (const c of this.confetti) {
      c.vy += 1400 * dt * (this.S / 1080);
      c.vx *= Math.exp(-2.2 * dt);
      c.vy *= Math.exp(-2.6 * dt);
      c.x += (c.vx + Math.sin(t * 6 + c.spin) * 60) * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
      c.life -= dt;
      if (c.life <= 0 || c.y > floorBottom + 50) continue;
      keep.push(c);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.scale(1, Math.cos(t * 9 + c.spin));
      ctx.globalAlpha = clamp(c.life);
      ctx.fillStyle = c.c;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    }
    this.confetti = keep;
  },
};
