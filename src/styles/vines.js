import { Path2D } from 'skia-canvas';
import { rgba, rampAt } from '../palettes.js';
import { clamp } from '../util.js';

const TAU = Math.PI * 2;
const STEP = 7;                       // px between vine points (at 1080p)
const WIDTHS = [1.5, 3, 5, 8, 12];    // stroke width buckets, so each layer is a handful of strokes
const LAYER_ALPHA = [0.5, 0.78, 1];   // far → near

const turnTowards = (target, current) => Math.atan2(Math.sin(target - current), Math.cos(target - current));

// Pointed leaf from (x, y) along angle a, length L. Adds the midrib to `veins`.
function addLeaf(path, veins, x, y, a, L) {
  const c = Math.cos(a), s = Math.sin(a);
  const at = (px, py) => [x + px * c - py * s, y + px * s + py * c];
  const [tx, ty] = at(L, 0);
  path.moveTo(x, y);
  path.quadraticCurveTo(...at(L * 0.45, L * 0.4), tx, ty);
  path.quadraticCurveTo(...at(L * 0.45, -L * 0.4), x, y);
  path.closePath();
  veins.moveTo(x, y);
  veins.lineTo(...at(L * 0.8, 0));
}

export default {
  name: 'vines',
  description: 'Saturated green vines creep in from the edges and wrap around each other, sprouting leaves, tendrils and blooms with the music',
  palette: 'verdant', // used when no -p is given
  // With --auto: settings scaled in calm parts, builds and drops (see modulate.js).
  sections: {
    calm: { growth: 0.7, branch: 0.5, blooms: 0.5, glow: 0.85 },
    build: { growth: 0.9 },
    drop: { growth: 1.3, branch: 1.6, blooms: 1.5, glow: 1.3 },
  },
  params: {
    vines: 7,        // main vines growing at once
    growth: 1,       // growth speed (scaled by loudness)
    branch: 2,       // side shoots sprouted per kick (0 = none)
    curl: 1,         // how tightly tendrils spiral
    weave: 1,        // how much vines cross in and out of each other
    leaves: 1,       // leaf size (0 = bare vines)
    blooms: 1,       // glowing flowers on transients (0 = off)
    spores: 40,      // drifting fireflies (0 = off)
    sway: 1,         // how much the vines move with the mids
    thickness: 1,
    thorns: 0,       // thorn density (try 1–2)
    heart: 1,        // glow inside the wreath (0 = off)
    glow: 1,
    pregrow: 2,      // seconds of growth before the first frame (0 = start from nothing)
    max: 7000,       // vine points before the oldest vines wither back
  },

  setup(ctx, env) {
    const { width, height, u, fps, random, params: p } = env;
    this.t = 0;
    this.vines = [];
    this.blooms = [];
    this.roots = 0;
    this.lastSpawn = 0;
    this.R = Math.min(width, height) * 0.3;
    this.spores = Array.from({ length: Math.round(p.spores) }, () => ({
      x: random() * width,
      y: random() * height,
      vx: (random() - 0.5) * 14 * u,
      vy: (-6 - random() * 12) * u,
      phase: random() * TAU,
      size: (1.5 + random() * 2.5) * u,
    }));
    // Soft glow dot, stamped with drawImage. Much cheaper than shadowBlur on
    // paths that are spread across the whole frame.
    const gs = Math.round(64 * u);
    this.glowSprite = env.createCanvas(gs * 2, gs * 2);
    const gctx = this.glowSprite.getContext('2d');
    const grad = gctx.createRadialGradient(gs, gs, 0, gs, gs, gs);
    grad.addColorStop(0, rgba(env.palette.accent, 1));
    grad.addColorStop(0.25, rgba(env.palette.accent, 0.35));
    grad.addColorStop(1, rgba(env.palette.accent, 0));
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, gs * 2, gs * 2);
    for (let i = 0; i < Math.round(p.vines); i++) this.spawnRoot(env);
    const quiet = { rms: 0.45, pulse: 0 };
    for (let f = 0; f < Math.round(p.pregrow * fps); f++) {
      if (f % Math.round(fps * 0.6) === 0) this.sprout(env);
      this.grow(env, quiet, 1 / fps);
    }
  },

  makeVine(env, o) {
    const { random, params: p } = env;
    const v = {
      pts: [{ x: o.x, y: o.y, a: o.heading }],
      heading: o.heading,
      depth: o.depth,
      width: o.width,
      maxLen: Math.round(o.len),
      dir: o.dir,
      targetR: this.R * (0.6 + random() * 0.75), // spread so the wreath has thickness
      phase: random() * TAU,
      wobble: 0.6 + random() * 0.8,
      curl: o.curl ?? 0,
      curlDir: random() < 0.5 ? -1 : 1,
      parent: o.parent ?? null,
      base: o.base ?? 0,                       // sway index offset, so branches move with their parent
      swayPhase: o.swayPhase ?? random() * TAU,
      kids: [],
      leaves: [],
      thorns: [],
      side: 1,
      dist: 0,
      nextLeaf: 4 + random() * 8,
      growing: true,
      withering: false,
      born: this.t,
    };
    if (p.leaves <= 0 || v.curl > 0) v.nextLeaf = Infinity; // tendrils stay bare
    o.parent?.kids.push(v);
    this.vines.push(v);
    return v;
  },

  // A new main vine creeping in from just outside the frame.
  spawnRoot(env) {
    const { width, height, cx, cy, u, random } = env;
    const m = 20 * u, side = random();
    const [x, y] = side < 0.4 ? [random() * width, height + m]
      : side < 0.65 ? [-m, random() * height]
      : side < 0.9 ? [width + m, random() * height]
      : [random() * width, -m];
    this.lastSpawn = this.t;
    return this.makeVine(env, {
      x, y,
      heading: Math.atan2(cy - y, cx - x) + (random() - 0.5) * 0.8,
      depth: Math.floor(random() * 3),
      width: (7 + random() * 6) * u * env.params.thickness,
      len: 260 + random() * 200,
      dir: this.roots++ % 2 ? 1 : -1, // alternate directions so they cross
    });
  },

  // A side shoot or curling tendril off an existing vine.
  sprout(env) {
    const { random, params: p } = env;
    const hosts = this.vines.filter((v) => !v.withering && v.pts.length > 30);
    if (!hosts.length || this.vines.length > 220) return;
    const host = hosts[Math.floor(random() * hosts.length)];
    const i = Math.floor(host.pts.length * (0.2 + random() * 0.7));
    const pt = host.pts[i];
    const tendril = random() < 0.5;
    this.makeVine(env, {
      x: pt.x, y: pt.y,
      heading: pt.a + (random() < 0.5 ? -1 : 1) * (0.5 + random() * 0.7),
      depth: host.depth,
      width: host.width * 0.55,
      len: tendril ? 40 + random() * 60 : 90 + random() * 120,
      dir: random() < 0.5 ? -1 : 1,
      curl: tendril ? (0.07 + random() * 0.06) * p.curl : 0,
      parent: host,
      base: host.base + i,
      swayPhase: host.swayPhase,
    });
  },

  // Withers a vine and everything growing off it.
  wither(v) {
    v.withering = true;
    v.kids.forEach((k) => this.wither(k));
  },

  extend(env, v) {
    const { cx, cy, u, random, params: p } = env;
    const last = v.pts.at(-1);
    const dx = last.x - cx, dy = last.y - cy;
    const r = Math.hypot(dx, dy) || 1;
    const n = v.pts.length;
    const progress = n / v.maxLen;

    // Orbit the centre at the vine's own radius. The radius wobbles around
    // the circle so neighbouring vines weave over and under each other.
    const target = v.targetR * (1 + 0.22 * p.weave * Math.sin(Math.atan2(dy, dx) * 3 + v.phase));
    const radial = clamp((target - r) / (0.35 * this.R), -2, 2) * (v.parent ? 0.6 : 1);
    const desired = Math.atan2(dx / r * v.dir + dy / r * radial, -dy / r * v.dir + dx / r * radial);

    // Tendrils spiral tighter towards the tip; main vines curl up at the end.
    const curl = v.curl ? v.curl * (1 + 3 * progress) : progress > 0.85 ? (progress - 0.85) / 0.15 * 0.25 * p.curl : 0;
    const steer = Math.max(0, 1 - curl * 8);
    v.heading += turnTowards(desired, v.heading) * 0.08 * steer
      + ((random() - 0.5) * 0.3 + Math.sin(n * 0.09 * v.wobble + v.phase) * 0.06) * steer
      + curl * v.curlDir;

    const pt = { x: last.x + Math.cos(v.heading) * STEP * u, y: last.y + Math.sin(v.heading) * STEP * u, a: v.heading };
    v.pts.push(pt);
    if (--v.nextLeaf <= 0) {
      v.side = -v.side;
      v.leaves.push({ i: n, side: v.side, size: (v.parent ? 0.7 : 1) * (22 + random() * 22) * u, band: Math.floor(random() * 110), born: this.t });
      v.nextLeaf = 8 + random() * 14;
    }
    if (p.thorns > 0 && random() < 0.1 * p.thorns) v.thorns.push({ i: n, side: random() < 0.5 ? -1 : 1 });
    if (n + 1 >= v.maxLen) v.growing = false;
  },

  grow(env, frame, dt) {
    const { u, params: p } = env;
    this.t += dt;
    const speed = (45 + 320 * frame.rms + 260 * frame.pulse) * u * p.growth;
    const step = STEP * u;
    for (const v of [...this.vines]) {
      if (v.withering) {
        if (v.kids.length) continue; // shoots go first so nothing is left floating
        v.pts.length = Math.max(0, v.pts.length - Math.ceil((speed * 2.5 * dt) / step) - 1);
        v.leaves = v.leaves.filter((l) => l.i < v.pts.length);
        v.thorns = v.thorns.filter((l) => l.i < v.pts.length);
        if (v.pts.length < 2) {
          this.vines.splice(this.vines.indexOf(v), 1);
          if (v.parent) v.parent.kids.splice(v.parent.kids.indexOf(v), 1);
        }
      } else if (v.growing) {
        v.dist += speed * dt * (v.parent ? 1.2 : 1);
        while (v.dist >= step && v.growing) {
          v.dist -= step;
          this.extend(env, v);
        }
      }
    }
    // Too much growth: the oldest main vine withers back.
    const living = this.vines.reduce((sum, v) => sum + (v.withering ? 0 : v.pts.length), 0);
    if (living > p.max) {
      const oldest = this.vines.find((v) => !v.parent && !v.withering);
      if (oldest) this.wither(oldest);
    }
  },

  stampGlow(ctx, x, y, r, alpha) {
    if (alpha <= 0.01 || r < 1) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(this.glowSprite, x - r, y - r, r * 2, r * 2);
  },

  draw(ctx, frame, env) {
    const { width, height, cx, cy, u, fps, palette, params: p, random } = env;
    const dt = 1 / fps;
    const bright = palette.colors.at(-1);

    if (frame.kick) {
      const count = Math.round(p.branch * (0.6 + frame.kickStrength));
      for (let i = 0; i < count; i++) this.sprout(env);
    }
    const growingRoots = this.vines.filter((v) => !v.parent && v.growing && !v.withering).length;
    if (growingRoots < p.vines && (frame.kick || this.t - this.lastSpawn > 3)) this.spawnRoot(env);
    if (frame.onset && p.blooms > 0) {
      const hosts = this.vines.filter((v) => !v.withering && v.pts.length > 10);
      for (let i = 0; hosts.length && i < 1 + Math.round(frame.onsetStrength * 2 * p.blooms); i++) {
        const v = hosts[Math.floor(random() * hosts.length)];
        const at = Math.floor(v.pts.length * (0.5 + random() * 0.5));
        this.blooms.push({ v, i: Math.min(at, v.pts.length - 1), age: 0, size: (10 + 14 * frame.onsetStrength) * u * (0.6 + v.depth * 0.25) });
      }
      if (this.blooms.length > 60) this.blooms.splice(0, this.blooms.length - 60);
    }
    this.grow(env, frame, dt);

    // Fireflies drift up behind the vines and flare with the highs.
    if (this.spores.length) {
      const dim = new Path2D(), lit = new Path2D();
      ctx.globalCompositeOperation = 'lighter';
      for (const s of this.spores) {
        s.x += (s.vx + Math.sin(this.t * 0.7 + s.phase) * 10 * u) * dt;
        s.y += s.vy * dt;
        if (s.y < -10 * u) { s.y = height + 10 * u; s.x = random() * width; }
        const on = 0.5 + 0.5 * Math.sin(this.t * 3 + s.phase * 5);
        const path = on * (0.3 + frame.high) > 0.6 ? lit : dim;
        if (p.glow > 0) this.stampGlow(ctx, s.x, s.y, s.size * (path === lit ? 9 : 5), (path === lit ? 0.5 : 0.15) * p.glow);
        path.moveTo(s.x + s.size, s.y);
        path.arc(s.x, s.y, s.size * (path === lit ? 1.3 : 1), 0, TAU);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = rgba(palette.accent, 0.25);
      ctx.fill(dim);
      ctx.fillStyle = rgba(bright, 0.85);
      ctx.fill(lit);
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.translate(cx, cy);
    const breathe = 1 + 0.015 * frame.pulse;
    ctx.scale(breathe, breathe);
    ctx.translate(-cx, -cy);

    if (p.heart > 0) {
      const r = this.R * 0.55 * (1 + 0.25 * frame.pulse);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, rgba(bright, (0.12 + 0.35 * frame.bass) * p.heart));
      g.addColorStop(0.4, rgba(palette.accent, (0.06 + 0.15 * frame.bass) * p.heart));
      g.addColorStop(1, rgba(palette.accent, 0));
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowBlur = 0;
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
    }

    // Swayed screen positions for every vine point. Offsets depend on the
    // index from the root, so a shoot moves exactly with the point it grows from.
    const A = (3 + 14 * frame.mid + 6 * frame.pulse) * u * p.sway;
    for (const v of this.vines) {
      const n = v.pts.length;
      if (!v.pos || v.pos.length < n * 2) v.pos = new Float32Array(Math.max(64, n * 2 + 64));
      for (let i = 0; i < n; i++) {
        const k = v.base + i, f = Math.min(1, k / 60);
        v.pos[i * 2] = v.pts[i].x + Math.sin(this.t * 1.3 + k * 0.045 + v.swayPhase) * A * f;
        v.pos[i * 2 + 1] = v.pts[i].y + Math.cos(this.t * 1.05 + k * 0.037 + v.swayPhase) * A * f * 0.7;
      }
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let d = 0; d < 3; d++) {
      const layer = this.vines.filter((v) => v.depth === d);
      const stems = WIDTHS.map(() => new Path2D());
      const thorns = new Path2D();
      for (const v of layer) {
        const n = v.pts.length, P = v.pos;
        let prev = -1;
        for (let i = 1; i < n; i++) {
          // Thick at the root, tapering to a fine tip.
          const w = v.width * (0.25 + 0.75 * Math.min(1, (n - 1 - i) / 35)) / u;
          let b = 0;
          while (b < WIDTHS.length - 1 && w > (WIDTHS[b] + WIDTHS[b + 1]) / 2) b++;
          if (b !== prev) stems[b].moveTo(P[i * 2 - 2], P[i * 2 - 1]);
          stems[b].lineTo(P[i * 2], P[i * 2 + 1]);
          prev = b;
        }
        for (const t of v.thorns) {
          const x = P[t.i * 2], y = P[t.i * 2 + 1], a = v.pts[t.i].a;
          const c = Math.cos(a), s = Math.sin(a), len = v.width * 0.5 + 9 * u;
          thorns.moveTo(x - c * 4 * u, y - s * 4 * u);
          thorns.lineTo(x - s * len * t.side, y + c * len * t.side);
          thorns.lineTo(x + c * 4 * u, y + s * 4 * u);
          thorns.closePath();
        }
      }

      const stemColor = rampAt(palette.colors, 0.1 + d * 0.22);
      ctx.shadowBlur = 0;
      // Halo for the near layer: wide faint strokes are far cheaper than
      // shadowBlur on paths this big.
      if (d === 2 && p.glow > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(palette.accent, (0.035 + 0.06 * frame.pulse) * p.glow);
        for (const k of [5, 2.5]) {
          stems.forEach((path, b) => {
            ctx.lineWidth = (WIDTHS[b] + 4 * k) * u;
            ctx.stroke(path);
          });
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = LAYER_ALPHA[d];
      ctx.strokeStyle = stemColor;
      ctx.fillStyle = stemColor;
      ctx.fill(thorns);
      stems.forEach((path, b) => {
        ctx.lineWidth = WIDTHS[b] * u;
        ctx.stroke(path);
      });
      // Glossy highlight along the top edge of each stem, flaring on kicks.
      if (d > 0) {
        ctx.strokeStyle = rgba(rampAt(palette.colors, 0.55 + d * 0.2), 0.3 + 0.5 * frame.pulse);
        stems.forEach((path, b) => {
          const o = WIDTHS[b] * 0.18 * u;
          ctx.save();
          ctx.translate(-o, -o);
          ctx.lineWidth = Math.max(1, WIDTHS[b] * 0.3) * u;
          ctx.stroke(path);
          ctx.restore();
        });
      }

      // Leaves grow in, and swell with their slice of the spectrum.
      if (p.leaves > 0) {
        const levels = [new Path2D(), new Path2D(), new Path2D()];
        const veins = new Path2D();
        for (const v of layer) {
          for (const l of v.leaves) {
            const val = frame.spectrum[l.band];
            const g = clamp((this.t - l.born) / 0.6);
            const L = l.size * p.leaves * (1 - (1 - g) ** 3) * (0.7 + 0.7 * val);
            if (L < u) continue;
            const a = v.pts[l.i].a + l.side * (0.75 + 0.15 * Math.sin(this.t * 2 + l.i));
            addLeaf(levels[Math.min(2, Math.floor(val * 3))], veins, v.pos[l.i * 2], v.pos[l.i * 2 + 1], a, L);
          }
        }
        levels.forEach((path, lv) => {
          ctx.fillStyle = rampAt(palette.colors, 0.15 + d * 0.2 + lv * 0.17);
          ctx.fill(path);
        });
        // The loudest near leaves light up.
        if (d === 2 && p.glow > 0) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = rgba(palette.accent, (0.12 + 0.3 * frame.pulse) * p.glow);
          ctx.fill(levels[2]);
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.strokeStyle = rgba(palette.bg[0], 0.55);
        ctx.lineWidth = 1.2 * u;
        ctx.stroke(veins);
      }
    }
    ctx.globalAlpha = 1;

    // Blooms open on transients, glow, then close again.
    this.blooms = this.blooms.filter((bl) => (bl.age += dt / 1.8) < 1 && bl.i < bl.v.pts.length);
    if (this.blooms.length) {
      const petals = new Path2D(), cores = new Path2D();
      for (const bl of this.blooms) {
        const x = bl.v.pos[bl.i * 2], y = bl.v.pos[bl.i * 2 + 1];
        const open = Math.sin(Math.min(1, bl.age * 3) * Math.PI / 2) * (1 - bl.age ** 4);
        const s = bl.size * open;
        if (s < u) continue;
        if (p.glow > 0) {
          ctx.globalCompositeOperation = 'lighter';
          this.stampGlow(ctx, x, y, s * (2.5 + 1.5 * frame.pulse), 0.55 * open * p.glow);
          ctx.globalCompositeOperation = 'source-over';
        }
        for (let k = 0; k < 5; k++) {
          const a = bl.v.pts[bl.i].a + this.t * 0.3 + (k / 5) * TAU;
          const px = x + Math.cos(a) * s * 0.55, py = y + Math.sin(a) * s * 0.55;
          petals.moveTo(px + s * 0.42, py);
          petals.ellipse(px, py, s * 0.42, s * 0.42, 0, 0, TAU);
        }
        cores.moveTo(x + s * 0.22, y);
        cores.arc(x, y, s * 0.22, 0, TAU);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(rampAt(palette.colors, 0.8), 0.55);
      ctx.fill(petals);
      ctx.fillStyle = rgba(palette.text, 0.9);
      ctx.fill(cores);
      ctx.globalCompositeOperation = 'source-over';
    }
  },
};
