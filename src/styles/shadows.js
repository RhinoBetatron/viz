import { Path2D } from 'skia-canvas';
import { mix, rgba } from '../palettes.js';
import { clamp, flatten } from '../util.js';
import hands from './hands.js';
import { glowSprite } from '../sea.js';

const TAU = Math.PI * 2;
const LOW = 4; // mist and smoke resolution divisor

// A lumpy smoke puff: a few overlapping soft blobs, so it doesn't read as a
// perfect circle.
function smokeSprite(env, color, size) {
  const s = Math.round(size);
  const c = env.createCanvas(s * 2, s * 2);
  const g = c.getContext('2d');
  for (let i = 0; i < 7; i++) {
    const a = env.random() * TAU, d = env.random() * s * 0.35, r = s * (0.4 + env.random() * 0.25);
    const x = s + Math.cos(a) * d, y = s + Math.sin(a) * d;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, rgba(color, 0.3));
    grad.addColorStop(0.5, rgba(color, 0.12));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, s * 2, s * 2);
  }
  flatten(c); // one bitmap instead of seven gradients replayed per draw
  return c;
}

export default {
  name: 'shadows',
  description: 'Shadowy hands reach in from the left and right out of the dark, grasping on every kick, wrapped in drifting gloom and smoke with a faint light between them',
  palette: 'gloom', // used when no -p is given
  // With --auto: settings scaled in calm parts, builds and drops (see modulate.js).
  sections: {
    calm: { reach: 0.85, grip: 0.6, rim: 0.7, gloom: 1.3 },
    build: { reach: 0.95 },
    drop: { reach: 1.15, grip: 1.5, tremble: 1.3, rim: 1.4, gloom: 0.8 },
  },
  params: {
    hands: 3,       // hands on each side
    reach: 1,       // how far they reach in
    grip: 1,        // how hard they grasp on kicks
    speed: 1,       // how fast they sway in and out
    tremble: 1,     // finger twitching with the highs (0 = still)
    scale: 1,       // size of the hands
    shadow: 1,      // how dark the hands are (0 = lit like hands, 1 = near silhouettes)
    rim: 1,         // pale rim light on their edges, brighter on kicks (0 = off)
    gloom: 1,       // smoke and mist around the hands (0 = clear)
    light: 1,       // the dim glow in the middle they reach for (0 = off)
    ash: 40,        // drifting ash specks (0 = off)
    rotate: 0,      // roll the hands around their arms, in turns per second
  },

  pose: hands.pose,
  drawHand: hands.drawHand,
  updateCurls: hands.updateCurls,

  setup(ctx, env) {
    const { width, height, cy, u, random, palette, params: p } = env;
    this.t = 0;
    this.spin = 0;
    this.flash = 0;
    const S = (this.S = Math.min(width, height));

    // Rows down each side, staggered so left and right hands interleave.
    const n = Math.max(0, Math.round(p.hands));
    const span = height * 0.7;
    this.hands = [];
    for (const side of [-1, 1]) {
      for (let j = 0; j < n; j++) {
        const f = n > 1 ? j / (n - 1) : 0.5;
        const ay = cy + (f - 0.5) * span * (n > 1 ? 1 : 0) + side * span / (n * 4) + (random() - 0.5) * height * 0.04;
        const depth = random();
        const size = Math.min(width * 0.3, height * 0.2) * (0.8 + 0.4 * depth) * p.scale;
        // Aim slightly towards the middle row.
        const slope = clamp((cy - ay) / width, -0.5, 0.5) * 0.5;
        const len = Math.hypot(1, slope);
        const reachMin = size * 0.5;
        this.hands.push({
          side, size, depth,
          ax: side < 0 ? -size * 0.15 : width + size * 0.15, ay,
          dir: [-side / len, slope / len], // pointing inwards
          reachMin,
          reachMax: Math.max(reachMin + size * 0.3, width * 0.5 - size * 0.45),
          aim: (random() - 0.5) * 0.3,
          mirror: side < 0 ? -1 : 1, // thumbs up on both sides
          back: random() < 0.5,
          phase: random() * TAU,
          speed: 0.3 + random() * 0.4,
          sens: 0.55 + random() * 0.45,
          ext: random() * 0.4,
          grab: 0,
          curls: [0, 0, 0, 0, 0],
          twitch: random() * 10,
          spinRate: (j % 2 ? 1 : -1) * (0.6 + random() * 0.5),
          puff: random(),
        });
      }
    }
    this.hands.sort((a, b) => a.depth - b.depth);

    this.ash = Array.from({ length: Math.round(p.ash) }, () => ({
      x: random() * width, y: random() * height,
      vx: (random() - 0.5) * 8 * u, vy: (2 + random() * 8) * u,
      size: (0.8 + random() * 2.2) * u, phase: random() * TAU,
    }));

    // Mist banks drifting across behind the hands.
    this.mist = Array.from({ length: 7 }, (_, i) => ({
      x: random(), y: random(), w: 0.7 + random() * 0.8,
      speed: (0.01 + random() * 0.015) * (i % 2 ? 1 : -1),
    }));
    this.smoke = [];
    this.glow = glowSprite(env, palette.colors[1], 160 * u);
    this.paleSmoke = smokeSprite(env, palette.colors[1], 96 * u);
    this.darkSmoke = smokeSprite(env, '#000000', 96 * u);
    // Mist and smoke are soft anyway, so they're drawn at quarter size and
    // scaled up (big soft sprites at full size are slow).
    this.back = env.createCanvas(Math.ceil(width / LOW), Math.ceil(height / LOW));
    this.front = env.createCanvas(Math.ceil(width / LOW), Math.ceil(height / LOW));
  },

  // Runs draw(ctx) on a low-res layer in full-size coordinates, then flattens it.
  lowres(layer, draw) {
    layer.width = layer.width; // resets the recording
    const c = layer.getContext('2d');
    c.scale(1 / LOW, 1 / LOW);
    draw(c);
    flatten(layer);
    return layer;
  },

  // Draws one hand dark against the gloom, with a pale rim on the side
  // facing the light in the middle.
  drawShadowHand(ctx, h, env, frame, lit) {
    const { u, cx, cy, palette, params: p } = env;
    const tones = (k) => ({ ...env, palette: { ...palette, colors: palette.colors.map((c) => mix(c, k > 0 ? palette.colors.at(-1) : palette.bg[0], Math.abs(k))) } });
    const x = h.x, y = h.y;

    // Rim: a pale copy nudged towards the light, added underneath (its black
    // outlines add nothing), so only a sliver shows past the dark hand.
    if (p.rim > 0) {
      const d = Math.hypot(cx - x, cy - y) || 1;
      const off = (3 + 3 * h.grab) * u;
      h.x = x + (cx - x) / d * off;
      h.y = y + (cy - y) / d * off;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp((0.3 + 0.3 * frame.rms + 0.5 * h.grab) * p.rim * (0.5 + 0.5 * h.depth));
      this.drawHand(ctx, h, tones(0.6), 1);
      ctx.globalAlpha = 1;
      h.x = x;
      h.y = y;
    }

    // Sunk into shadow: the same hand in tones pulled towards the dark,
    // lifting a little as it grabs.
    ctx.globalCompositeOperation = 'source-over';
    this.drawHand(ctx, h, tones(-clamp(0.75 * p.shadow - 0.2 * h.grab)), lit);
  },

  draw(ctx, frame, env) {
    const { width, height, cx, cy, u, fps, palette, params: p, random } = env;
    const dt = 1 / fps;
    this.t += dt;
    const t = this.t, S = this.S;
    this.spin += p.rotate * TAU * dt;
    if (frame.kick) this.flash = Math.max(this.flash, frame.kickStrength);
    this.flash *= 0.88 ** (30 / fps);

    // The dim light in the middle, breathing with the track.
    ctx.globalCompositeOperation = 'lighter';
    if (p.light > 0) {
      const r = S * (0.45 + 0.12 * frame.rms + 0.08 * this.flash);
      ctx.globalAlpha = clamp((0.1 + 0.18 * frame.rms + 0.15 * this.flash) * p.light);
      ctx.drawImage(this.glow, cx - r, cy - r, r * 2, r * 2);
    }

    // Mist drifting behind everything.
    if (p.gloom > 0) {
      ctx.globalAlpha = 1;
      ctx.drawImage(this.lowres(this.back, (c) => {
        c.globalCompositeOperation = 'lighter';
        for (const m of this.mist) {
          m.x += m.speed * dt * (1 + frame.rms);
          if (m.x > 1.5) m.x = -0.5;
          if (m.x < -0.5) m.x = 1.5;
          const w = S * m.w * 1.4, h = w * 0.55;
          c.globalAlpha = clamp((0.12 + 0.1 * frame.rms) * p.gloom);
          c.drawImage(this.paleSmoke, m.x * width - w / 2, m.y * height - h / 2, w, h);
        }
      }), 0, 0, width, height);
    }
    ctx.globalAlpha = 1;

    // Ash drifts down through the dark.
    if (this.ash.length) {
      const specks = new Path2D();
      for (const a of this.ash) {
        a.x += (a.vx + Math.sin(t * 0.6 + a.phase) * 6 * u) * dt;
        a.y += a.vy * dt;
        if (a.y > height + 5 * u) { a.y = -5 * u; a.x = random() * width; }
        specks.moveTo(a.x + a.size, a.y);
        specks.arc(a.x, a.y, a.size, 0, TAU);
      }
      ctx.fillStyle = rgba(palette.colors.at(-1), 0.1 + 0.25 * frame.high);
      ctx.fill(specks);
    }

    // The hands: reach in and out, lunge and grasp on kicks.
    for (const h of this.hands) {
      if (frame.kick) h.grab = Math.max(h.grab, frame.kickStrength * h.sens * p.grip);
      h.grab *= 0.9 ** (30 / fps);
      const sway = 0.5 + 0.5 * Math.sin(t * h.speed * p.speed + h.phase);
      const goal = clamp((0.15 + 0.45 * sway + 0.3 * frame.rms + 0.3 * h.grab) * p.reach);
      h.ext += (goal - h.ext) * (goal > h.ext ? 0.12 : 0.04) * (30 / fps);
      const dist = h.reachMin + (h.reachMax - h.reachMin) * h.ext;
      h.x = h.ax + h.dir[0] * dist;
      h.y = h.ay + h.dir[1] * dist + Math.sin(t * 0.6 + h.phase) * h.size * 0.08;
      const pointing = Math.atan2(h.dir[1], h.dir[0]) + h.aim + 0.12 * Math.sin(t * 0.7 + h.phase);
      h.roll = pointing + Math.PI / 2;
      h.yaw = (h.back ? Math.PI : 0) + 0.35 * Math.sin(t * 0.5 * p.speed + h.phase * 2) + this.spin * h.spinRate;
      h.pitch = 0.15 * Math.sin(t * 0.4 + h.phase);
      h.arm = (dist + h.size * 0.6) / h.size / Math.max(0.5, Math.abs(Math.cos(h.yaw)));
      // Fingers open while reaching, claw when they grab.
      this.updateCurls(h, 0.1 + 0.25 * (1 - h.ext) + 0.7 * h.grab, frame, p);

      const lit = (0.15 + 0.35 * h.depth) * (0.6 + 0.4 * h.ext) + 0.2 * h.grab;
      this.drawShadowHand(ctx, h, env, frame, lit);

      // Smoke curls off the hand and arm; a burst of it on each grab.
      if (p.gloom > 0) {
        h.puff += dt * (1.5 + 2.5 * frame.rms) * p.gloom;
        let n = Math.floor(h.puff);
        h.puff -= n;
        if (frame.kick) n += Math.round(4 * frame.kickStrength * h.sens * p.gloom);
        for (let i = 0; i < n; i++) {
          const f = random();
          const along = f * (dist + h.size * 0.3);
          this.smoke.push({
            x: h.ax + h.dir[0] * along + (random() - 0.5) * h.size * 0.3,
            y: h.ay + h.dir[1] * along + (random() - 0.5) * h.size * 0.3,
            vx: (random() - 0.5) * S * 0.03 + h.dir[0] * S * 0.02 * (1 - f),
            vy: -S * (0.015 + random() * 0.03),
            size: h.size * (0.25 + random() * 0.3), grow: 0.15 + random() * 0.2,
            life: 1, dur: 2 + random() * 1.5, dark: random() < 0.6,
            depth: h.depth,
          });
        }
      }
    }

    // Draw the smoke over the hands: dark puffs veil them, pale wisps catch the light.
    if (this.smoke.length) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.lowres(this.front, (c) => {
        for (const s of this.smoke) {
          s.life -= dt / s.dur;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          s.size *= 1 + s.grow * dt;
          const fade = Math.sin(Math.PI * clamp(1 - s.life)) * p.gloom;
          c.globalAlpha = clamp(s.dark ? fade * 0.7 : fade * (0.08 + 0.12 * frame.rms + 0.15 * this.flash));
          c.drawImage(s.dark ? this.darkSmoke : this.paleSmoke, s.x - s.size, s.y - s.size, s.size * 2, s.size * 2);
        }
      }), 0, 0, width, height);
      this.smoke = this.smoke.filter((s) => s.life > 0);
      if (this.smoke.length > 120) this.smoke.splice(0, this.smoke.length - 120);
    }

    // The arms come out of deep dark at the sides, and the frame closes in.
    ctx.globalCompositeOperation = 'source-over';
    const edge = width * 0.3;
    for (const [x0, x1] of [[0, edge], [width, width - edge]]) {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, rgba(palette.bg[0], 0.95));
      g.addColorStop(0.35, rgba(palette.bg[0], 0.55));
      g.addColorStop(1, rgba(palette.bg[0], 0));
      ctx.fillStyle = g;
      ctx.fillRect(Math.min(x0, x1), 0, edge, height);
    }
    const v = ctx.createRadialGradient(cx, cy, S * 0.35, cx, cy, Math.hypot(width, height) * 0.55);
    v.addColorStop(0, rgba('#000000', 0));
    v.addColorStop(1, rgba('#000000', 0.75 - 0.2 * this.flash));
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, width, height);
  },
};

