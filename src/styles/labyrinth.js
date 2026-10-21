import { Path2D } from 'skia-canvas';
import { mix, rgba, rampAt } from '../palettes.js';
import { clamp, sampleSpectrum } from '../util.js';
import { glowSprite } from '../sea.js';

const TAU = Math.PI * 2;
const SHADES = 10; // corridor brightness steps, one path each

// A perfect maze (one way between any two cells), carved by a random
// depth-first walk. open[i] is a bitmask of open sides: 1 right, 2 down,
// 4 left, 8 up.
function carve(cols, rows, random) {
  const open = new Uint8Array(cols * rows);
  const seen = new Uint8Array(cols * rows);
  const dirs = [[1, 0, 1, 4], [0, 1, 2, 8], [-1, 0, 4, 1], [0, -1, 8, 2]];
  const stack = [Math.floor(rows / 2) * cols + Math.floor(cols / 2)];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.at(-1), x = i % cols, y = Math.floor(i / cols);
    const next = dirs.filter(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[ny * cols + nx];
    });
    if (!next.length) { stack.pop(); continue; }
    const [dx, dy, bit, back] = next[Math.floor(random() * next.length)];
    const j = (y + dy) * cols + x + dx;
    open[i] |= bit;
    open[j] |= back;
    seen[j] = 1;
    stack.push(j);
  }
  return open;
}

// Distance (in cells) from `from` to every cell, and the step back towards it.
function walk(open, cols, from) {
  const dist = new Int32Array(open.length).fill(-1), prev = new Int32Array(open.length).fill(-1);
  const queue = [from];
  dist[from] = 0;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    for (const [bit, d] of [[1, 1], [2, cols], [4, -1], [8, -cols]]) {
      const j = i + d;
      if (open[i] & bit && dist[j] < 0) { dist[j] = dist[i] + 1; prev[j] = i; queue.push(j); }
    }
  }
  return { dist, prev };
}

export default {
  name: 'labyrinth',
  description: 'The labyrinth from above: light runs through its corridors with the spectrum and floods out from the centre on every kick, while the minotaur charges through it, trailed by Ariadne\'s glowing thread',
  palette: 'minoan', // used when no -p is given
  params: {
    size: 1,      // size of the corridors (bigger = fewer, wider)
    speed: 1,     // how fast the minotaur roams
    charge: 1,    // how hard it charges on the kicks (0 = steady)
    fill: 1,      // light in the corridors with the spectrum (0 = off)
    waves: 1,     // light flooding out from the centre on kicks (0 = off)
    thread: 1,    // Ariadne's thread from the entrance to the minotaur (0 = none)
    torches: 10,  // torches on the walls (0 = none)
    glow: 1,      // minotaur eyes, thread and torch glow
  },

  setup(ctx, env) {
    const { width, height, u, random, palette, params: p } = env;
    const S = (this.S = Math.min(width, height));
    this.u = u;
    this.t = 0;
    const c = (this.c = (S / 13) * clamp(p.size, 0.4, 3));
    const cols = (this.cols = Math.max(5, Math.floor(width / c) - 1 - ((Math.floor(width / c) - 1) % 2 === 0 ? 1 : 0)));
    const rows = (this.rows = Math.max(5, Math.floor(height / c) - 1 - ((Math.floor(height / c) - 1) % 2 === 0 ? 1 : 0)));
    this.ox = (width - cols * c) / 2;
    this.oy = (height - rows * c) / 2;
    this.open = carve(cols, rows, random);
    this.center = Math.floor(rows / 2) * cols + Math.floor(cols / 2);
    this.entrance = (rows - 1) * cols + Math.floor(cols / 2); // bottom middle
    this.open[this.entrance] |= 2;
    const fromCenter = walk(this.open, cols, this.center);
    this.dist = fromCenter.dist;
    this.dmax = Math.max(...this.dist);
    this.toEntrance = walk(this.open, cols, this.entrance).prev;
    this.waves = [];
    this.trail = [];

    // Walls, as one path of segments along the cell edges.
    const walls = (this.walls = new Path2D());
    const X = (x) => this.ox + x * c, Y = (y) => this.oy + y * c;
    walls.moveTo(X(0), Y(0)); walls.lineTo(X(cols), Y(0));
    walls.moveTo(X(0), Y(0)); walls.lineTo(X(0), Y(rows));
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const o = this.open[y * cols + x];
        if (!(o & 1)) { walls.moveTo(X(x + 1), Y(y)); walls.lineTo(X(x + 1), Y(y + 1)); }
        if (!(o & 2)) { walls.moveTo(X(x), Y(y + 1)); walls.lineTo(X(x + 1), Y(y + 1)); }
      }
    }

    // Torches at wall corners.
    this.torches = Array.from({ length: Math.round(clamp(p.torches, 0, 40)) }, () => ({
      x: X(1 + Math.floor(random() * (cols - 1))),
      y: Y(1 + Math.floor(random() * (rows - 1))),
      phase: random() * TAU,
    }));

    // The minotaur starts in the centre.
    this.beast = { path: [this.center], pos: 0, boost: 0, heading: -Math.PI / 2, x: 0, y: 0 };
    this.cellXY(this.center, this.beast);
    this.glowSprite = glowSprite(env, palette.accent, 64 * u);
    this.torchSprite = glowSprite(env, palette.colors[2], 64 * u);
  },

  cellXY(i, out = {}) {
    out.x = this.ox + ((i % this.cols) + 0.5) * this.c;
    out.y = this.oy + (Math.floor(i / this.cols) + 0.5) * this.c;
    return out;
  },

  // A new destination for the minotaur, and the path to it.
  roam(random) {
    const b = this.beast, from = b.path.at(-1);
    const target = Math.floor(random() * this.open.length);
    const { prev } = walk(this.open, this.cols, target);
    const path = [from];
    for (let i = from; i !== target && prev[i] >= 0; i = prev[i]) path.push(prev[i]);
    b.path = path.length > 1 ? path : [from, from];
    b.pos = 0;
  },

  draw(ctx, frame, env) {
    const { width, height, fps, u, palette, random, params: p } = env;
    const dt = 1 / fps;
    this.t += dt;
    const { t, S, c, cols, dist, dmax } = this;
    const dark = mix(palette.bg[0], '#000000', 0.4);
    const glowAmt = clamp(p.glow, 0, 3);

    // Floor.
    ctx.fillStyle = mix(palette.bg[1], palette.colors[0], 0.25);
    ctx.fillRect(this.ox, this.oy, cols * c, this.rows * c);

    // Corridor light: each cell lit by the band matching its distance from
    // the centre (bass in the middle, highs at the far ends), plus waves of
    // light that run out along the corridors on every kick.
    if (frame.kick && p.waves > 0) this.waves.push({ r: 0, a: clamp(frame.kickStrength * p.waves, 0, 2) });
    for (const w of this.waves) { w.r += dt * 22; w.a *= Math.exp(-dt * 1.2); }
    this.waves = this.waves.filter((w) => w.r < dmax + 6 && w.a > 0.03);
    const levels = sampleSpectrum(frame.spectrum, 24);
    const shades = Array.from({ length: SHADES }, () => new Path2D());
    for (let i = 0; i < dist.length; i++) {
      const d = dist[i] / dmax;
      let v = levels[Math.min(23, Math.floor(d * 23.99))] ** 1.4 * p.fill;
      for (const w of this.waves) v += w.a * Math.exp(-(((dist[i] - w.r) / 2.2) ** 2));
      const k = Math.min(SHADES - 1, Math.floor(clamp(v) * SHADES));
      if (k > 0) {
        const [x, y] = [this.ox + (i % cols) * c, this.oy + Math.floor(i / cols) * c];
        shades[k].rect(x, y, c, c);
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 1; k < SHADES; k++) {
      const v = k / (SHADES - 1);
      ctx.fillStyle = rgba(rampAt(palette.colors, 0.35 + 0.65 * v), 0.45 * v);
      ctx.fill(shades[k]);
    }
    ctx.globalCompositeOperation = 'source-over';

    // The minotaur's way: speed builds with the music, and kicks make it charge.
    const b = this.beast;
    if (frame.kick) b.boost += frame.kickStrength * 7 * p.charge;
    b.boost *= Math.exp(-dt * 3);
    const speed = ((1.2 + 2.5 * frame.rms) * p.speed + b.boost) * dt;
    b.pos += speed;
    while (b.pos >= b.path.length - 1) {
      const over = b.pos - (b.path.length - 1);
      this.roam(random);
      b.pos = over;
    }
    const i0 = b.path[Math.floor(b.pos)], i1 = b.path[Math.floor(b.pos) + 1];
    const A = this.cellXY(i0), B = this.cellXY(i1), f = b.pos - Math.floor(b.pos);
    const bx = A.x + (B.x - A.x) * f, by = A.y + (B.y - A.y) * f;
    if (B.x !== A.x || B.y !== A.y) {
      const target = Math.atan2(B.y - A.y, B.x - A.x);
      let d = target - b.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      b.heading += d * clamp(dt * 14);
    }
    b.x = bx; b.y = by;
    this.trail.push({ x: bx, y: by, age: 0 });
    for (const s of this.trail) s.age += dt;
    this.trail = this.trail.filter((s) => s.age < 1.2);

    // Ariadne's thread, from the entrance to wherever the beast is now.
    if (p.thread > 0) {
      const pts = [];
      const ent = this.cellXY(this.entrance);
      pts.push([ent.x, this.oy + this.rows * c + c * 0.6]);
      const route = [];
      for (let i = i0; i >= 0; i = this.toEntrance[i]) route.push(i);
      for (const i of route.reverse()) { const q = this.cellXY(i); pts.push([q.x, q.y]); }
      pts.push([bx, by]);
      // A slight sideways shimmer with the waveform.
      const wave = frame.waveform ?? [];
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const path = new Path2D();
      for (const [k, [x, y]] of pts.entries()) {
        const w = wave.length ? wave[Math.floor((k / pts.length) * (wave.length - 1))] * c * 0.12 : 0;
        k === 0 ? path.moveTo(x + w, y) : path.lineTo(x + w, y + w * 0.5);
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(palette.accent, 0.25 * glowAmt);
      ctx.lineWidth = c * (0.16 + 0.12 * frame.bass) * p.thread;
      ctx.stroke(path);
      ctx.strokeStyle = rgba(mix(palette.accent, palette.text, 0.4), 0.85);
      ctx.lineWidth = Math.max(1.5 * u, c * 0.045 * p.thread);
      ctx.stroke(path);
      ctx.restore();
    }

    // Walls: a shadow, the wall body, and a lit top edge.
    ctx.lineCap = 'square';
    ctx.strokeStyle = rgba('#000000', 0.45);
    ctx.lineWidth = c * 0.3;
    ctx.save();
    ctx.translate(c * 0.07, c * 0.1);
    ctx.stroke(this.walls);
    ctx.restore();
    ctx.strokeStyle = mix(palette.colors[0], palette.colors[1], 0.35);
    ctx.lineWidth = c * 0.28;
    ctx.stroke(this.walls);
    ctx.strokeStyle = rgba(mix(palette.colors[1], palette.colors[2], 0.4), 0.55 + 0.3 * frame.pulse);
    ctx.lineWidth = c * 0.12;
    ctx.save();
    ctx.translate(-c * 0.03, -c * 0.04);
    ctx.stroke(this.walls);
    ctx.restore();

    // Dust kicked up behind the minotaur.
    ctx.fillStyle = mix(palette.colors[1], palette.colors[0], 0.4);
    for (const s of this.trail) {
      const k = s.age / 1.2;
      ctx.globalAlpha = 0.25 * (1 - k);
      ctx.beginPath();
      ctx.arc(s.x, s.y, c * (0.12 + 0.25 * k), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    this.drawMinotaur(ctx, bx, by, b.heading, frame, palette, dark, glowAmt);

    // Torches flickering on the walls with the highs.
    if (this.torches.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (const tr of this.torches) {
        const fl = 0.7 + 0.15 * Math.sin(t * 13 + tr.phase) + 0.15 * Math.sin(t * 7.3 + tr.phase * 2);
        const r = c * (0.9 + 0.8 * frame.high) * fl * Math.min(1.5, glowAmt);
        ctx.globalAlpha = clamp(0.35 + 0.4 * frame.high) * fl;
        ctx.drawImage(this.torchSprite, tr.x - r, tr.y - r, r * 2, r * 2);
        ctx.fillStyle = rgba(palette.text, 0.9);
        ctx.fillRect(tr.x - 1.5 * u, tr.y - 1.5 * u, 3 * u, 3 * u);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Darkness closing in at the edges.
    const vig = ctx.createRadialGradient(width / 2, height / 2, S * 0.35, width / 2, height / 2, Math.hypot(width, height) * 0.6);
    vig.addColorStop(0, rgba(dark, 0));
    vig.addColorStop(1, rgba(dark, 0.75));
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, width, height);
  },

  // The minotaur from above: a bull's back and shoulders, head down, horns
  // swept forward, eyes glowing; it puts its head down on a charge.
  drawMinotaur(ctx, x, y, heading, frame, palette, dark, glowAmt) {
    const c = this.c;
    const L = c * 1.35; // nose to tail
    const charge = clamp(this.beast.boost / 6);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    // Glow under it.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(0.25 + 0.5 * charge + 0.3 * frame.pulse) * glowAmt;
    ctx.drawImage(this.glowSprite, -L, -L, L * 2, L * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const hide = mix(dark, palette.colors[0], 0.5);
    const walk = Math.sin(this.t * 14) * L * 0.04;
    // Legs (just the hooves showing beside the body).
    ctx.fillStyle = mix(hide, '#000000', 0.4);
    for (const [lx, ly] of [[0.18, 0.2], [0.18, -0.2], [-0.25, 0.18], [-0.25, -0.18]]) {
      const s = Math.sign(lx * ly);
      ctx.beginPath();
      ctx.ellipse(lx * L + s * walk, ly * L, L * 0.07, L * 0.05, 0, 0, TAU);
      ctx.fill();
    }
    // Tail, swishing.
    ctx.strokeStyle = hide;
    ctx.lineWidth = L * 0.04;
    ctx.beginPath();
    ctx.moveTo(-L * 0.38, 0);
    ctx.quadraticCurveTo(-L * 0.5, Math.sin(this.t * 6) * L * 0.12, -L * 0.62, Math.sin(this.t * 6 + 1) * L * 0.15);
    ctx.stroke();
    // Body and the big shoulder hump.
    const body = ctx.createRadialGradient(L * 0.05, -L * 0.05, 0, 0, 0, L * 0.45);
    body.addColorStop(0, mix(hide, palette.colors[1], 0.35));
    body.addColorStop(1, hide);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(-L * 0.08, 0, L * 0.34, L * 0.2, 0, 0, TAU);
    ctx.ellipse(L * 0.12, 0, L * 0.2, L * 0.25, 0, 0, TAU);
    ctx.fill();
    // Head, lowered further forward on a charge.
    const hx = L * (0.36 + 0.06 * charge);
    ctx.beginPath();
    ctx.ellipse(hx, 0, L * 0.13, L * 0.11, 0, 0, TAU);
    ctx.fill();
    // Horns sweeping out and forward.
    ctx.strokeStyle = mix(palette.text, palette.colors[2], 0.4);
    ctx.lineWidth = L * 0.055;
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(hx - L * 0.02, s * L * 0.08);
      ctx.quadraticCurveTo(hx + L * 0.02, s * L * 0.3, hx + L * 0.2, s * L * 0.24);
      ctx.stroke();
    }
    // Eyes.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(0.5 + 0.5 * Math.max(charge, frame.pulse)) * glowAmt;
    const er = L * (0.08 + 0.08 * charge);
    for (const s of [-1, 1]) ctx.drawImage(this.glowSprite, hx + L * 0.06 - er, s * L * 0.06 - er, er * 2, er * 2);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  },
};
