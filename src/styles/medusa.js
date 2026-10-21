import { Path2D } from 'skia-canvas';
import { mix, rgba, rampAt } from '../palettes.js';
import { clamp, ribbon, sampleSpectrum } from '../util.js';
import { glowSprite } from '../sea.js';

const TAU = Math.PI * 2;
const SPINE = 26; // points along each snake

export default {
  name: 'medusa',
  description: 'Medusa\'s face on a bronze shield: her snakes sway with the music and strike on the kicks, and on the biggest hits her gaze flashes out and turns the birds to stone',
  palette: 'gorgon', // used when no -p is given
  params: {
    snakes: 14,   // snakes in her hair (4–24)
    strike: 1,    // how many snakes strike on each kick, and how far (0 = none)
    sway: 1,      // how much the snakes writhe with the mids
    gaze: 1,      // her petrifying gaze on the biggest hits (0 = never)
    birds: 8,     // birds flying past, turned to stone by the gaze (0 = none)
    shield: 1,    // the bronze shield behind her, its rim playing the spectrum (0 = none)
    glow: 1,      // eye and gaze glow
  },

  setup(ctx, env) {
    const { width, height, u, random, palette, params: p } = env;
    const S = (this.S = Math.min(width, height));
    this.u = u;
    this.t = 0;
    this.gaze = 0;
    this.ring = -1;
    this.lastGaze = -10;
    this.F = S * 0.2; // half the face height
    const n = Math.round(clamp(p.snakes, 4, 24));
    // Roots around the top and sides of the head; back ones drawn first.
    this.snakes = Array.from({ length: n }, (_, i) => {
      const f = n > 1 ? i / (n - 1) : 0.5;
      const a = -Math.PI - 0.55 + f * (Math.PI + 1.1) + (random() - 0.5) * 0.12;
      return {
        a,
        band: Math.abs(f - 0.5) * 2, // bass at the crown, highs at the sides
        len: 0.85 + random() * 0.45,
        curl: (random() - 0.5) * 1.6,
        phase: random() * TAU,
        speed: 2 + random() * 1.5,
        width: 0.8 + random() * 0.35,
        depth: random(),
        hue: random(),
        st: 0,   // strike, 1 at the moment it lunges
        level: 0,
      };
    }).sort((a, b) => a.depth - b.depth);
    this.birds = Array.from({ length: Math.round(clamp(p.birds, 0, 30)) }, () => this.newBird(env, true));
    this.eyeGlow = glowSprite(env, palette.accent, 64 * u);
    this.haze = glowSprite(env, palette.colors[1], 160 * u);
  },

  newBird({ width, height, cy, random }, anywhere) {
    const dir = random() < 0.5 ? 1 : -1;
    return {
      x: anywhere ? random() * width : dir > 0 ? -40 : width + 40,
      y: cy - this.S * 0.45 + random() * this.S * 0.75,
      vx: dir * (60 + random() * 80) * this.u,
      vy: 0,
      flap: random() * TAU,
      size: (11 + random() * 8) * this.u,
      stone: false,
      rot: 0,
      spin: 0,
    };
  },

  draw(ctx, frame, env) {
    const { width, height, fps, u, cx, cy, palette, random, params: p } = env;
    const dt = 1 / fps;
    this.t += dt;
    const { t, S, F } = this;
    const dark = mix(palette.bg[0], '#000000', 0.5);
    const glowAmt = clamp(p.glow, 0, 3);
    const tilt = Math.sin((frame.bars ?? t / 2) * Math.PI / 2) * 0.04;

    // The gaze: on a big kick, at most about once every two seconds.
    if (p.gaze > 0 && frame.kick && frame.kickStrength > 0.7 && t - this.lastGaze > 2 / Math.max(0.25, p.gaze)) {
      this.gaze = 1;
      this.ring = 0;
      this.lastGaze = t;
    }
    this.gaze *= Math.exp(-dt * 2.5);
    if (this.ring >= 0) {
      this.ring += dt * S * 1.6;
      if (this.ring > Math.hypot(width, height)) this.ring = -1;
    }

    // Snakes strike on the kicks.
    if (frame.kick && p.strike > 0) {
      const k = Math.ceil(frame.kickStrength * 3 * Math.min(2, p.strike));
      for (let i = 0; i < k; i++) {
        const s = this.snakes[Math.floor(random() * this.snakes.length)];
        if (s.st < 0.3) s.st = 1;
      }
    }

    // Shield: bronze disc behind her, its rim ticking with the spectrum.
    if (p.shield > 0) {
      const R = S * 0.46 * p.shield * (1 + 0.02 * frame.bass);
      const bronze = mix(mix(palette.colors[0], palette.accent, 0.15), dark, 0.55);
      const disc = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, 0, cx, cy, R);
      disc.addColorStop(0, mix(bronze, palette.colors[1], 0.35));
      disc.addColorStop(0.7, bronze);
      disc.addColorStop(1, mix(bronze, dark, 0.6));
      ctx.fillStyle = disc;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba(mix(bronze, dark, 0.5), 0.8);
      ctx.lineWidth = 3 * u;
      for (const f of [0.78, 0.92]) {
        ctx.beginPath();
        ctx.arc(cx, cy, R * f, 0, TAU);
        ctx.stroke();
      }
      const n = 72, levels = sampleSpectrum(frame.spectrum, n / 2);
      const ticks = new Path2D();
      for (let i = 0; i < n; i++) {
        const v = levels[i < n / 2 ? i : n - 1 - i];
        const a = (i / n) * TAU - Math.PI / 2;
        const r0 = R * 0.925, r1 = r0 - R * (0.03 + 0.12 * v);
        ticks.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ticks.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(palette.accent, 0.35 + 0.4 * frame.pulse);
      ctx.lineWidth = 4 * u;
      ctx.lineCap = 'round';
      ctx.stroke(ticks);
      ctx.globalAlpha = 0.25 + 0.3 * frame.bass;
      const h = R * 1.4;
      ctx.drawImage(this.haze, cx - h, cy - h, h * 2, h * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Birds, behind her. Stone ones tumble out of the sky.
    const eyesY = cy - F * 0.1;
    for (const [i, b] of this.birds.entries()) {
      if (!b.stone && this.ring > 0) {
        const d = Math.hypot(b.x - cx, b.y - eyesY);
        if (d < this.ring && d > this.ring - S * 0.3) {
          b.stone = true;
          b.vy = -40 * u;
          b.spin = (random() - 0.5) * 6;
        }
      }
      if (b.stone) {
        b.vy += 700 * u * dt;
        b.y += b.vy * dt;
        b.x += b.vx * 0.3 * dt;
        b.rot += b.spin * dt;
      } else {
        b.x += b.vx * dt * (0.8 + 0.6 * frame.rms);
        b.y += Math.sin(t * 1.3 + b.flap) * 10 * u * dt;
        b.flap += dt * (10 + 8 * frame.high);
      }
      if (b.y > height + 40 || b.x < -60 || b.x > width + 60) this.birds[i] = this.newBird(env, false);
      const w = b.size;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.scale(Math.sign(b.vx) || 1, 1);
      if (b.stone) {
        ctx.scale(1.25, 1.25);
        ctx.fillStyle = mix(palette.text, palette.bg[1], 0.3);
        ctx.strokeStyle = rgba(dark, 0.8);
        ctx.lineWidth = 1.5 * u;
        ctx.beginPath();
        ctx.moveTo(-w, -w * 0.5);
        ctx.quadraticCurveTo(-w * 0.3, -w * 0.15, 0, 0);
        ctx.quadraticCurveTo(w * 0.3, -w * 0.15, w, -w * 0.5);
        ctx.quadraticCurveTo(w * 0.4, w * 0.25, 0, w * 0.3);
        ctx.quadraticCurveTo(-w * 0.4, w * 0.25, -w, -w * 0.5);
        ctx.fill();
        ctx.stroke();
      } else {
        const f = Math.sin(b.flap) * w * 0.7;
        ctx.strokeStyle = mix(palette.colors[1], palette.accent, 0.3);
        ctx.lineWidth = 2.5 * u;
        ctx.beginPath();
        ctx.moveTo(-w, -f);
        ctx.quadraticCurveTo(-w * 0.4, -w * 0.2 - f * 0.3, 0, 0);
        ctx.quadraticCurveTo(w * 0.4, -w * 0.2 - f * 0.3, w, -f);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);

    // Snakes: each sways as a wave running down its body, reaches further
    // with its slice of the spectrum, and lunges straight out on a strike.
    const levels = sampleSpectrum(frame.spectrum, 24);
    for (const s of this.snakes) {
      const target = levels[Math.min(23, Math.floor(s.band * 23))];
      s.level += (target - s.level) * (target > s.level ? 0.4 : 0.08);
      s.st *= Math.exp(-dt * 4);
      const st = s.st;
      const rootX = Math.cos(s.a) * F * 0.72, rootY = -F * 0.12 + Math.sin(s.a) * F * 0.88;
      const L = F * s.len * (0.85 + 0.45 * s.level) * (1 + 0.7 * st * Math.min(2, p.strike));
      const amp = (0.35 + 0.5 * frame.mid) * p.sway * (1 - 0.8 * st);
      const W = F * 0.075 * s.width;
      const pts = [];
      let x = rootX, y = rootY, ang = s.a;
      for (let k = 0; k <= SPINE; k++) {
        const f = k / SPINE;
        pts.push({ x, y, w: W * (1 - 0.6 * f) * (k === 0 ? 1.1 : 1) });
        ang = s.a + s.curl * f * (1 - st) + amp * Math.sin(t * s.speed + s.phase - f * 7) * (0.3 + f);
        x += Math.cos(ang) * (L / SPINE);
        y += Math.sin(ang) * (L / SPINE);
      }
      const body = ribbon(pts);
      const color = rampAt(palette.colors, 0.15 + 0.5 * s.hue);
      const shade = mix(color, dark, 0.3 - 0.25 * s.depth);
      ctx.fillStyle = shade;
      ctx.strokeStyle = rgba(dark, 0.8);
      ctx.lineWidth = 1.5 * u;
      ctx.fill(body);
      ctx.stroke(body);
      // Back markings: a zigzag down the spine.
      ctx.strokeStyle = rgba(mix(color, palette.text, 0.2), 0.55);
      ctx.lineWidth = W * 0.3;
      ctx.beginPath();
      for (let k = 1; k < SPINE - 1; k++) {
        const a = pts[k], b = pts[k + 1];
        const nx = -(b.y - a.y), ny = b.x - a.x, l = Math.hypot(nx, ny) || 1;
        const side = (k % 2 ? 1 : -1) * a.w * 0.4;
        const px = a.x + (nx / l) * side, py = a.y + (ny / l) * side;
        k === 1 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Head, with a mouth that gapes and a tongue that flicks on the strike.
      const end = pts.at(-1), prev = pts.at(-3);
      const ha = Math.atan2(end.y - prev.y, end.x - prev.x);
      const hl = W * 2.5, hw = W * 1.3;
      ctx.save();
      ctx.translate(end.x, end.y);
      ctx.rotate(ha);
      const gape = st * 0.6;
      if (st > 0.15) {
        ctx.strokeStyle = rgba(palette.accent, 0.9);
        ctx.lineWidth = Math.max(1, W * 0.12);
        const tl = hl * (1.2 + 0.4 * Math.sin(t * 40));
        ctx.beginPath();
        ctx.moveTo(hl * 0.8, 0);
        ctx.lineTo(hl * 0.8 + tl, 0);
        ctx.moveTo(hl * 0.8 + tl, 0);
        ctx.lineTo(hl * 0.8 + tl * 1.2, -tl * 0.15);
        ctx.moveTo(hl * 0.8 + tl, 0);
        ctx.lineTo(hl * 0.8 + tl * 1.2, tl * 0.15);
        ctx.stroke();
      }
      ctx.fillStyle = mix(color, dark, 0.3);
      for (const side of [-1, 1]) {
        // Upper and lower jaw, opening apart.
        ctx.save();
        ctx.rotate(side * gape * 0.5);
        ctx.beginPath();
        ctx.moveTo(-hl * 0.15, 0);
        ctx.quadraticCurveTo(hl * 0.1, side * hw, hl * 0.6, side * hw * 0.6);
        ctx.quadraticCurveTo(hl, side * hw * 0.25, hl, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      if (gape > 0.1) {
        ctx.fillStyle = rgba(palette.text, 0.9);
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(hl * 0.7, side * hw * 0.25);
          ctx.lineTo(hl * 0.78, side * hw * (0.25 - 0.35 * gape));
          ctx.lineTo(hl * 0.86, side * hw * 0.2);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(0.35 + 0.65 * Math.max(st, frame.pulse)) * glowAmt;
      const er = W * (0.5 + 0.4 * st);
      for (const side of [-1, 1]) ctx.drawImage(this.eyeGlow, hl * 0.35 - er, side * hw * 0.45 - er, er * 2, er * 2);
      ctx.restore();
    }

    // The face.
    const skin = mix(palette.colors[2], palette.colors[1], 0.4);
    const face = new Path2D();
    face.moveTo(0, -F);
    face.bezierCurveTo(F * 0.5, -F, F * 0.78, -F * 0.62, F * 0.78, -F * 0.12);
    face.bezierCurveTo(F * 0.78, F * 0.38, F * 0.5, F * 0.8, F * 0.16, F * 0.98);
    face.quadraticCurveTo(0, F * 1.05, -F * 0.16, F * 0.98);
    face.bezierCurveTo(-F * 0.5, F * 0.8, -F * 0.78, F * 0.38, -F * 0.78, -F * 0.12);
    face.bezierCurveTo(-F * 0.78, -F * 0.62, -F * 0.5, -F, 0, -F);
    face.closePath();
    const fg = ctx.createRadialGradient(-F * 0.15, -F * 0.2, F * 0.1, 0, 0, F * 1.05);
    fg.addColorStop(0, mix(skin, palette.text, 0.25 + 0.3 * this.gaze));
    fg.addColorStop(0.65, skin);
    fg.addColorStop(1, mix(skin, dark, 0.65));
    ctx.fillStyle = fg;
    ctx.fill(face);
    ctx.strokeStyle = rgba(dark, 0.6);
    ctx.lineWidth = 2 * u;
    ctx.stroke(face);
    // Hollows: eye sockets and under the cheekbones.
    ctx.save();
    ctx.clip(face);
    for (const [x, y, r, a] of [[-0.33, -0.12, 0.3, 0.35], [0.33, -0.12, 0.3, 0.35], [-0.5, 0.35, 0.35, 0.3], [0.5, 0.35, 0.35, 0.3]]) {
      const hg = ctx.createRadialGradient(x * F, y * F, 0, x * F, y * F, r * F);
      hg.addColorStop(0, rgba(dark, a));
      hg.addColorStop(1, rgba(dark, 0));
      ctx.fillStyle = hg;
      ctx.fillRect(-F, -F, F * 2, F * 2);
    }
    ctx.restore();

    const line = mix(skin, dark, 0.65);
    ctx.strokeStyle = line;
    ctx.lineCap = 'round';
    // Brows, knitted lower on the kicks.
    const knit = frame.pulse * 0.05 * F;
    ctx.lineWidth = F * 0.035;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * F * 0.12, -F * 0.24 + knit);
      ctx.quadraticCurveTo(side * F * 0.32, -F * 0.34, side * F * 0.55, -F * 0.24);
      ctx.stroke();
    }
    // Nose and nostrils.
    ctx.lineWidth = F * 0.022;
    ctx.beginPath();
    ctx.moveTo(-F * 0.03, -F * 0.12);
    ctx.quadraticCurveTo(-F * 0.07, F * 0.15, -F * 0.05, F * 0.28);
    ctx.moveTo(-F * 0.1, F * 0.28);
    ctx.quadraticCurveTo(0, F * 0.35, F * 0.1, F * 0.28);
    ctx.stroke();
    // Lips, parting on the gaze.
    const part = this.gaze * F * 0.05;
    ctx.fillStyle = mix(skin, dark, 0.6);
    ctx.beginPath();
    ctx.moveTo(-F * 0.2, F * 0.52);
    ctx.quadraticCurveTo(-F * 0.08, F * 0.45, 0, F * 0.49);
    ctx.quadraticCurveTo(F * 0.08, F * 0.45, F * 0.2, F * 0.52);
    ctx.quadraticCurveTo(F * 0.08, F * 0.56 + part, 0, F * 0.55 + part);
    ctx.quadraticCurveTo(-F * 0.08, F * 0.56 + part, -F * 0.2, F * 0.52);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-F * 0.18, F * 0.53 + part);
    ctx.quadraticCurveTo(0, F * 0.66 + part * 1.5, F * 0.18, F * 0.53 + part);
    ctx.quadraticCurveTo(0, F * 0.58 + part, -F * 0.18, F * 0.53 + part);
    ctx.fill();

    // Eyes: almond whites, glowing irises with slit pupils.
    const eyeA = clamp(0.35 + 0.5 * frame.pulse + 1.2 * this.gaze);
    for (const side of [-1, 1]) {
      const ex = side * F * 0.33, ey = -F * 0.1;
      const ew = F * 0.17, eh = F * 0.075 * (1 + 0.35 * this.gaze);
      const eye = new Path2D();
      eye.moveTo(ex - ew, ey);
      eye.quadraticCurveTo(ex, ey - eh * 2, ex + ew, ey);
      eye.quadraticCurveTo(ex, ey + eh * 1.6, ex - ew, ey);
      ctx.fillStyle = mix(palette.text, palette.accent, 0.3 + 0.5 * this.gaze);
      ctx.fill(eye);
      ctx.save();
      ctx.clip(eye);
      ctx.fillStyle = mix(palette.accent, palette.colors[1], 0.3);
      ctx.beginPath();
      ctx.arc(ex, ey, F * 0.065, 0, TAU);
      ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.ellipse(ex, ey, F * 0.012 * (1 - 0.5 * this.gaze), F * 0.055, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = line;
      ctx.lineWidth = F * 0.02;
      ctx.stroke(eye);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = eyeA * glowAmt * 0.8;
      const r = F * (0.18 + 0.5 * this.gaze);
      ctx.drawImage(this.eyeGlow, ex - r, ey - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // A mass of coiled snakes over the crown, hiding where they grow from.
    const cap = new Path2D();
    cap.moveTo(-F * 0.84, -F * 0.05);
    cap.bezierCurveTo(-F * 0.95, -F * 0.75, -F * 0.5, -F * 1.12, 0, -F * 1.12);
    cap.bezierCurveTo(F * 0.5, -F * 1.12, F * 0.95, -F * 0.75, F * 0.84, -F * 0.05);
    // Hairline: a row of curls hanging over the forehead.
    const curls = 7, hair = (x) => -F * (0.5 + 0.28 * (x / F) ** 2);
    for (let i = 0; i < curls; i++) {
      const x0 = F * 0.84 - (i / curls) * F * 1.68, x1 = F * 0.84 - ((i + 1) / curls) * F * 1.68;
      cap.lineTo(x0, hair(x0));
      cap.quadraticCurveTo((x0 + x1) / 2, hair((x0 + x1) / 2) + F * 0.16, x1, hair(x1));
    }
    cap.closePath();
    const cg = ctx.createLinearGradient(0, -F * 1.1, 0, -F * 0.3);
    const capColor = rampAt(palette.colors, 0.3);
    cg.addColorStop(0, mix(capColor, dark, 0.2));
    cg.addColorStop(1, mix(capColor, dark, 0.55));
    ctx.fillStyle = cg;
    ctx.fill(cap);
    ctx.save();
    ctx.clip(cap);
    ctx.strokeStyle = rgba(mix(capColor, palette.text, 0.3), 0.45);
    ctx.lineWidth = F * 0.025;
    for (const c of this.coils ?? (this.coils = Array.from({ length: 14 }, (_, i) => [((i * 0.618) % 1) * 1.6 - 0.8, -0.55 - ((i * 0.37) % 1) * 0.5, 0.09 + ((i * 0.29) % 1) * 0.07]))) {
      ctx.beginPath();
      for (let a = 0; a <= TAU * 2; a += 0.25) {
        const r = c[2] * F * (1 - a / (TAU * 2.4));
        const x = c[0] * F + Math.cos(a + c[0] * 5) * r, y = c[1] * F + Math.sin(a + c[0] * 5) * r;
        a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = rgba(dark, 0.7);
    ctx.lineWidth = 2 * u;
    ctx.stroke(cap);
    ctx.restore();

    // The gaze: a ring of light racing out from her eyes, and a flash.
    if (this.ring > 0) {
      const fade = clamp(1 - this.ring / Math.hypot(width, height));
      ctx.globalCompositeOperation = 'lighter';
      for (const [k, w] of [[0, 1], [1, 0.5]]) {
        const r = Math.max(1, this.ring - k * S * 0.08);
        const rg = ctx.createRadialGradient(cx, eyesY, r * 0.85, cx, eyesY, r);
        rg.addColorStop(0, rgba(palette.accent, 0));
        rg.addColorStop(1, rgba(palette.accent, 0.35 * w * fade * glowAmt));
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(cx, eyesY, r, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = rgba(palette.accent, 0.12 * this.gaze * glowAmt);
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';
    }
  },
};
