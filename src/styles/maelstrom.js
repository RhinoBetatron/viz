import { Path2D } from 'skia-canvas';
import { mix, rgba } from '../palettes.js';
import { clamp } from '../util.js';
import { Sea, glowSprite } from '../sea.js';

const TAU = Math.PI * 2;
const STEPS = 70; // points along each spiral arm

export default {
  name: 'maelstrom',
  description: 'A whirlpool seen from above: spiral currents carrying the waveform race inwards faster as the track gets louder, dragging wreckage and a ghost ship down, and the eye tears open on kicks',
  palette: 'spectral', // used when no -p is given
  params: {
    arms: 9,        // spiral currents
    twist: 1,       // how tightly the arms wind
    speed: 1,       // how fast it turns (also speeds up with loudness)
    rings: 9,       // dashed foam rings (0 = off)
    eye: 1,         // size of the hole in the middle
    tear: 1,        // how much the eye gapes on kicks
    wave: 1,        // how much the waveform ripples the currents
    debris: 40,     // planks, barrels and lanterns being pulled in (0 = none)
    ship: 1,        // a little ghost ship circling the drain (0 = none)
    spray: 1,       // spray flung off the rim on kicks (0 = off)
  },

  setup(ctx, env) {
    const { width, height, u, random, palette, params: p } = env;
    this.t = 0;
    this.spin = 0;
    this.S = Math.min(width, height);
    this.R = Math.hypot(width, height) / 2 * 1.05;
    this.sea = new Sea(env, { size: this.S, waterY: 0 });
    this.gape = 0;
    this.gapeV = 0;
    this.bass = null;
    this.spray = [];
    this.debris = Array.from({ length: Math.round(p.debris) }, () => this.spawnDebris(random, true));
    this.ship = { r: this.R * 0.7, a: random() * TAU };
    this.glow = glowSprite(env, palette.accent, 64 * u);
    this.mist = glowSprite(env, palette.colors[1], 128 * u);
  },

  spawnDebris(random, anywhere = false) {
    const kind = random();
    return {
      r: this.R * (anywhere ? 0.2 + random() * 0.8 : 0.9 + random() * 0.15),
      a: random() * TAU,
      kind: kind < 0.6 ? 'plank' : kind < 0.85 ? 'barrel' : 'lantern',
      size: (6 + random() * 10) * this.S / 1080,
      spin: (random() - 0.5) * 4,
      rot: random() * TAU,
    };
  },

  // Angular speed at radius r: the closer to the drain, the faster.
  omega(r) {
    return 0.35 * (this.S * 0.25 / Math.max(r, this.S * 0.05)) ** 0.9;
  },

  draw(ctx, frame, env) {
    const { width, height, fps, u, cx, cy, palette, random, params: p } = env;
    const dt = 1 / fps;
    this.t += dt;
    const S = this.S, R = this.R;
    const sea = this.sea;
    sea.update(frame, dt);
    const drive = p.speed * (0.6 + 1.6 * frame.rms);
    this.spin += dt * drive;
    this.bass = this.bass ?? frame.bass;
    this.bass += (frame.bass - this.bass) * 0.1;
    if (frame.kick) this.gapeV += frame.kickStrength * 5 * p.tear;
    this.gapeV += (-this.gape * 50 - this.gapeV * 7) * dt;
    this.gape += this.gapeV * dt;
    const rh = S * 0.075 * p.eye * (1 + 0.6 * this.bass + Math.max(-0.3, this.gape) * 0.8);

    // Water darkening down into the drain.
    ctx.globalCompositeOperation = 'source-over';
    const bg = ctx.createRadialGradient(cx, cy, rh, cx, cy, R);
    bg.addColorStop(0, palette.bg[0]);
    bg.addColorStop(0.3, mix(palette.bg[0], palette.colors[0], 0.35));
    bg.addColorStop(1, mix(palette.bg[1], palette.colors[0], 0.6));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Dashed foam rings, each turning at its own speed.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const rings = Math.round(p.rings);
    for (let k = 1; k <= rings; k++) {
      const r = rh * (R / rh) ** (k / (rings + 1));
      const path = new Path2D();
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * TAU;
        const rr = r + sea.wave(i + k * 7) * S * 0.012 * p.wave * (r / R + 0.3);
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        i ? path.lineTo(x, y) : path.moveTo(x, y);
      }
      ctx.setLineDash([r * 0.18, r * 0.3]);
      ctx.lineDashOffset = -this.spin * this.omega(r) * r * 6;
      ctx.lineWidth = (1 + 2 * (r / R)) * u;
      ctx.strokeStyle = rgba(palette.colors[1], 0.25 + 0.2 * frame.pulse);
      ctx.stroke(path);
    }
    ctx.setLineDash([]);

    // Spiral currents. A log spiral turning as a whole looks like water
    // pouring inwards (and doesn't wind itself up over time).
    const arms = Math.round(p.arms);
    for (let m = 0; m < arms; m++) {
      const path = new Path2D();
      for (let i = 0; i <= STEPS; i++) {
        const f = i / STEPS;
        const r = rh * (R / rh) ** f;
        const a = (m / arms) * TAU + 1.6 * p.twist * Math.log(r / rh) - this.spin * 2.2;
        const rr = r + sea.wave(i + m * 5) * S * 0.02 * p.wave * f;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        i ? path.lineTo(x, y) : path.moveTo(x, y);
      }
      const lift = 0.6 + 0.4 * frame.pulse;
      for (const [w, a, c] of [[14, 0.05, palette.colors[1]], [5, 0.12, palette.colors[2]], [1.6, 0.6, palette.colors[2]]]) {
        ctx.lineWidth = w * u;
        ctx.strokeStyle = rgba(c, a * lift);
        ctx.stroke(path);
      }
    }

    // Wreckage being dragged round and down.
    for (const d of this.debris) {
      const w = this.omega(d.r) * drive * 6;
      d.a += w * dt;
      d.r -= S * 0.05 * drive * (R / Math.max(d.r, rh)) ** 0.4 * dt;
      d.rot += d.spin * dt;
      if (d.r < rh * 0.8) Object.assign(d, this.spawnDebris(random));
      const x = cx + Math.cos(d.a) * d.r, y = cy + Math.sin(d.a) * d.r;
      const shrink = clamp((d.r - rh * 0.8) / (rh * 1.5));
      const s = d.size * shrink;
      if (d.kind === 'lantern') {
        ctx.globalAlpha = clamp((0.5 + 0.5 * frame.pulse) * shrink);
        ctx.drawImage(this.glow, x - s * 2.5, y - s * 2.5, s * 5, s * 5);
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(d.a + Math.PI / 2 + d.rot * 0.3);
      ctx.strokeStyle = rgba(palette.colors[2], 0.7 * shrink);
      ctx.lineWidth = 1.3 * u;
      ctx.beginPath();
      if (d.kind === 'plank') ctx.rect(-s * 1.4, -s * 0.25, s * 2.8, s * 0.5);
      else ctx.arc(0, 0, s * 0.6, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    // The little ghost ship, spiralling slowly in, then back out at the edge.
    if (p.ship > 0) {
      const sh = this.ship;
      sh.a += this.omega(sh.r) * drive * 6 * dt;
      sh.r -= S * 0.012 * drive * dt;
      if (sh.r < rh * 1.2) sh.r = R * 0.75;
      const shrink = clamp((sh.r - rh) / (rh * 2));
      const L = S * 0.11 * p.ship * shrink;
      ctx.save();
      ctx.translate(cx + Math.cos(sh.a) * sh.r, cy + Math.sin(sh.a) * sh.r);
      ctx.rotate(sh.a + Math.PI / 2 + 0.25); // bow along the current, heeling inwards
      const hull = new Path2D();
      hull.moveTo(L * 0.55, 0);
      hull.quadraticCurveTo(L * 0.2, -L * 0.17, -L * 0.45, -L * 0.12);
      hull.lineTo(-L * 0.45, L * 0.12);
      hull.quadraticCurveTo(L * 0.2, L * 0.17, L * 0.55, 0);
      hull.closePath();
      const rig = new Path2D();
      for (const mx of [-0.22, 0.04, 0.27]) {
        rig.moveTo(L * mx, -L * 0.24); rig.lineTo(L * mx, L * 0.24); // yards across the deck
      }
      rig.moveTo(L * 0.55, 0); rig.lineTo(L * 0.8, 0);                 // bowsprit
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rgba(palette.bg[0], 0.7);
      ctx.fill(hull);
      ctx.globalCompositeOperation = 'lighter';
      for (const [w, a] of [[8, 0.08], [1.6, 0.85]]) {
        ctx.lineWidth = w * u;
        ctx.strokeStyle = rgba(palette.colors[2], a);
        ctx.stroke(hull);
        ctx.stroke(rig);
      }
      ctx.globalAlpha = clamp(0.5 + 0.5 * frame.mid);
      ctx.drawImage(this.glow, -L * 0.6, -L * 0.15, L * 0.3, L * 0.3);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // The eye: a black hole with a glowing, waveform-ragged rim.
    const rim = new Path2D();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * TAU;
      const rr = rh * (1 + sea.wave(i) * 0.08 * p.wave);
      const x = cx + Math.cos(a - this.spin * 2) * rr, y = cy + Math.sin(a - this.spin * 2) * rr;
      i ? rim.lineTo(x, y) : rim.moveTo(x, y);
    }
    rim.closePath();
    ctx.globalCompositeOperation = 'source-over';
    const hole = ctx.createRadialGradient(cx, cy, 0, cx, cy, rh);
    hole.addColorStop(0, '#000000');
    hole.addColorStop(1, palette.bg[0]);
    ctx.fillStyle = hole;
    ctx.fill(rim);
    ctx.globalCompositeOperation = 'lighter';
    for (const [w, a] of [[24, 0.06], [8, 0.15], [2.2, 0.9]]) {
      ctx.lineWidth = w * u;
      ctx.strokeStyle = rgba(palette.colors[2], a * (0.6 + 0.4 * frame.pulse));
      ctx.stroke(rim);
    }

    // Spray flung off the rim on kicks.
    if (frame.kick && p.spray > 0) {
      for (let i = 0; i < Math.round(30 * p.spray * frame.kickStrength); i++) {
        const a = random() * TAU, v = S * (0.3 + random() * 0.5);
        this.spray.push({ x: cx + Math.cos(a) * rh, y: cy + Math.sin(a) * rh, vx: Math.cos(a) * v - Math.sin(a) * v * 0.6, vy: Math.sin(a) * v + Math.cos(a) * v * 0.6, life: 1, r: (1 + random() * 2) * u });
      }
    }
    for (const s of this.spray) {
      s.life -= dt / 0.9;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.96;
      s.vy *= 0.96;
      ctx.fillStyle = rgba(palette.colors[2], clamp(s.life) * 0.8);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    this.spray = this.spray.filter((s) => s.life > 0);
    ctx.globalCompositeOperation = 'source-over';
  },
};
