import { Path2D } from 'skia-canvas';
import { mix, rgba, rampAt } from '../palettes.js';
import { clamp, ribbon, sampleSpectrum } from '../util.js';
import { glowSprite, makeStars, drawStars } from '../sea.js';

const TAU = Math.PI * 2;
const SPINE = 30; // points along each neck

export default {
  name: 'hydra',
  description: 'The hydra rising from the swamp at Lerna, a serpent queen with flowing tresses: one head for each slice of the spectrum, snapping and spitting venom on the kicks, and on the biggest hits two new heads grow',
  palette: 'lerna', // used when no -p is given
  // With --auto: settings scaled in calm parts, builds and drops (see modulate.js).
  sections: {
    calm: { snap: 0.5, sway: 0.8, mist: 1.3 },
    build: { sway: 1 },
    drop: { snap: 1.6, sway: 1.3, glow: 1.4, mist: 0.8 },
  },
  params: {
    heads: 5,     // heads it starts with (1–9)
    max: 11,      // most heads it can grow (0 = never grows more)
    snap: 1,      // how hard the heads lunge and snap on kicks (0 = calm)
    venom: 1,     // venom spat from the jaws (0 = none)
    sway: 1,      // how much the necks writhe
    size: 1,      // size of the hydra
    mist: 1,      // swamp mist (0 = clear)
    trees: 1,     // dead trees on the banks (0 = none)
    glow: 1,      // eyes and venom glow
  },

  setup(ctx, env) {
    const { width, height, u, cx, cy, random, palette, params: p } = env;
    const S = (this.S = Math.min(width, height));
    this.t = 0;
    this.waterY = cy + S * 0.3;
    this.lastGrow = -10;
    this.calm = 0;
    this.venom = [];
    this.ripples = [];
    this.necks = [];
    const n = Math.round(clamp(p.heads, 1, 9));
    for (let i = 0; i < n; i++) this.addNeck(random, n > 1 ? i / (n - 1) : 0.5, 1);
    this.stars = makeStars(random, 90, u);
    this.mist = Array.from({ length: 7 }, () => ({ x: random() * 1.4 - 0.2, y: random(), w: 1 + random(), speed: (random() - 0.5) * 0.03 }));
    this.trees = clamp(p.trees, 0, 2) > 0 ? [-1, 1].map((side) => ({
      x: cx + side * Math.min(width * 0.42, S * 0.62), side, h: S * (0.32 + random() * 0.1),
      branches: Array.from({ length: 6 }, () => [0.3 + random() * 0.6, (random() - 0.5) * 1.6, 0.2 + random() * 0.3]),
    })) : [];
    this.eye = glowSprite(env, palette.accent, 48 * u);
    this.moonGlow = glowSprite(env, palette.colors[2], 120 * u);
    this.mistSprite = glowSprite(env, palette.colors[1], 140 * u);
  },

  // A neck growing out of the body at position x (0–1 across it).
  addNeck(random, x, grown = 0) {
    this.necks.push({
      x, grow: grown, dying: false,
      len: 0.85 + random() * 0.3,
      phase: random() * TAU,
      speed: 1.3 + random() * 0.8,
      hook: 0.9 + random() * 0.6,
      level: 0, st: 0,
    });
    this.necks.sort((a, b) => a.x - b.x);
  },

  draw(ctx, frame, env) {
    const { width, height, fps, u, cx, palette, random, params: p } = env;
    const dt = 1 / fps;
    this.t += dt;
    const { t, S, waterY } = this;
    const dark = mix(palette.bg[0], '#000000', 0.4);
    const glowAmt = clamp(p.glow, 0, 3);
    const Z = S * clamp(p.size, 0.3, 2);

    // Growing: two new heads on a big hit, at most every few seconds.
    // In a long quiet stretch it sheds the extra heads one at a time.
    const alive = this.necks.filter((n) => !n.dying);
    if (frame.kick && frame.kickStrength > 0.75 && t - this.lastGrow > 5 && alive.length < p.max) {
      this.lastGrow = t;
      for (let k = 0; k < Math.min(2, p.max - alive.length); k++) {
        // Into the widest gap between necks.
        const xs = [0, ...alive.map((n) => n.x), 1].sort((a, b) => a - b);
        let best = 0;
        for (let i = 1; i < xs.length - 1; i++) if (xs[i + 1] - xs[i] > xs[best + 1] - xs[best]) best = i;
        const nx = (xs[best] + xs[best + 1]) / 2 + (random() - 0.5) * 0.05;
        this.addNeck(random, clamp(nx, 0.02, 0.98));
        alive.push(this.necks.find((n) => n.grow === 0 && !alive.includes(n)));
      }
      this.ripples.push({ r: 0, a: 1 });
    }
    this.calm = frame.rms < 0.2 ? this.calm + dt : 0;
    if (this.calm > 4 && alive.length > Math.round(clamp(p.heads, 1, 9))) {
      alive[Math.floor(random() * alive.length)].dying = true;
      this.calm = 0;
    }
    for (const n of this.necks) n.grow = clamp(n.grow + (n.dying ? -dt * 0.8 : dt * 0.7));
    this.necks = this.necks.filter((n) => !(n.dying && n.grow <= 0));

    // Snapping heads on kicks.
    if (frame.kick && p.snap > 0) {
      for (let k = 0; k < Math.ceil(frame.kickStrength * 2.5); k++) {
        const n = this.necks[Math.floor(random() * this.necks.length)];
        if (n && n.st < 0.3) n.st = 1;
      }
      this.ripples.push({ r: 0, a: 0.5 * frame.kickStrength });
    }

    // Sky and moon.
    const sky = ctx.createLinearGradient(0, 0, 0, waterY);
    sky.addColorStop(0, rgba(palette.bg[0], 0.95));
    sky.addColorStop(1, rgba(mix(palette.bg[1], palette.colors[0], 0.6), 0.95));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, waterY);
    drawStars(ctx, this.stars, env, waterY * 0.7, t, frame.high);
    const mx = cx - S * 0.28, my = waterY - S * 0.68, mr = S * 0.06;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.4;
    ctx.drawImage(this.moonGlow, mx - mr * 6, my - mr * 6, mr * 12, mr * 12);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = mix(palette.text, palette.colors[2], 0.3);
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, TAU);
    ctx.fill();

    // Far bank.
    ctx.fillStyle = mix(palette.colors[0], dark, 0.6);
    ctx.beginPath();
    ctx.moveTo(0, waterY);
    for (let i = 0; i <= 40; i++) {
      const f = i / 40;
      ctx.lineTo(f * width, waterY - S * (0.03 + 0.02 * Math.sin(f * 9) + 0.015 * Math.sin(f * 23)));
    }
    ctx.lineTo(width, waterY);
    ctx.fill();

    // Dead trees on the banks, swaying a little.
    ctx.strokeStyle = mix(palette.bg[0], '#000000', 0.5);
    ctx.lineCap = 'round';
    for (const tr of this.trees) {
      const sway = Math.sin(t * 0.7 + tr.side) * 0.03 + frame.mid * 0.03;
      const bx = tr.x, by = waterY + S * 0.01, tx = bx + sway * tr.h, ty = by - tr.h;
      ctx.lineWidth = tr.h * 0.05;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx - tr.side * tr.h * 0.1, by - tr.h * 0.5, tx, ty);
      ctx.stroke();
      for (const [f, a, l] of tr.branches) {
        const x0 = bx + (tx - bx) * f - tr.side * tr.h * 0.05 * (1 - f), y0 = by + (ty - by) * f;
        const ang = -Math.PI / 2 + a;
        ctx.lineWidth = tr.h * 0.02 * (1.2 - f);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        const x1 = x0 + Math.cos(ang) * tr.h * l, y1 = y0 + Math.sin(ang) * tr.h * l;
        ctx.quadraticCurveTo(x0 + Math.cos(ang + 0.4) * tr.h * l * 0.5, y0 + Math.sin(ang + 0.4) * tr.h * l * 0.5, x1, y1);
        ctx.lineTo(x1 + Math.cos(ang - 0.6) * tr.h * l * 0.3, y1 + Math.sin(ang - 0.6) * tr.h * l * 0.3);
        ctx.stroke();
      }
    }

    // Back mist.
    if (p.mist > 0) this.drawMist(ctx, false, env, dt);

    // Necks, back to front: centre necks (bass) are drawn last.
    const levels = sampleSpectrum(frame.spectrum, 24);
    const bodyW = Z * 0.32, bodyTop = waterY - Z * 0.1;
    const n = this.necks.length;
    const order = [...this.necks].sort((a, b) => Math.abs(b.x - 0.5) - Math.abs(a.x - 0.5));
    const heads = [];
    for (const neck of order) {
      const d = Math.abs(neck.x - 0.5) * 2;
      const target = levels[Math.min(23, Math.floor(d * 23))];
      neck.level += (target - neck.level) * (target > neck.level ? 0.4 : 0.08);
      neck.st *= Math.exp(-dt * 3.5);
      const st = neck.st * Math.min(2, p.snap);
      const g = neck.grow * neck.grow * (3 - 2 * neck.grow);
      const rx = cx + (neck.x - 0.5) * bodyW * 1.2, ry = waterY - Z * 0.03;
      const fan = (neck.x - 0.5) * 2; // −1 left … 1 right
      const L = Z * (0.32 + 0.2 * neck.level) * neck.len * g * (1 + 0.3 * st) * (n > 7 ? 0.9 : 1);
      const amp = (0.25 + 0.35 * frame.mid) * p.sway * (1 - 0.6 * clamp(st));
      const W = Z * 0.032;
      const pts = [];
      let x = rx, y = ry;
      for (let k = 0; k <= SPINE; k++) {
        const f = k / SPINE;
        pts.push({ x, y, w: W * (1.3 - 0.9 * f) * (0.4 + 0.6 * g) });
        // Rise and fan out, then the head hooks over forward.
        const ang = -Math.PI / 2 + fan * (0.12 + 0.45 * f) + amp * Math.sin(t * neck.speed + neck.phase - f * 5) * f
          + Math.sign(fan || 1) * neck.hook * f ** 4 * (1 - 0.6 * clamp(st));
        x += Math.cos(ang) * (L / SPINE);
        y += Math.sin(ang) * (L / SPINE);
      }
      const color = rampAt(palette.colors, 0.25 + 0.35 * (1 - d));
      const body = ribbon(pts);
      ctx.fillStyle = mix(color, dark, 0.35);
      ctx.fill(body);
      ctx.strokeStyle = rgba(dark, 0.7);
      ctx.lineWidth = 1.5 * u;
      ctx.stroke(body);
      // Moonlight along the upper-left edge of the neck.
      ctx.fillStyle = rgba(mix(color, palette.text, 0.3), 0.22);
      ctx.fill(ribbon(pts.map((q) => ({ x: q.x - q.w * 0.35, y: q.y - q.w * 0.2, w: q.w * 0.4 }))));
      // Belly plates down the front of the neck.
      ctx.strokeStyle = rgba(mix(color, palette.text, 0.35), 0.2);
      ctx.lineWidth = Math.max(1, W * 0.12);
      ctx.beginPath();
      for (let k = 2; k < SPINE - 1; k += 2) {
        const a = pts[k], b = pts[k + 1];
        const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
        ctx.moveTo(a.x - (dy / l) * a.w * 0.8, a.y + (dx / l) * a.w * 0.8);
        ctx.lineTo(a.x + (dy / l) * a.w * 0.8, a.y - (dx / l) * a.w * 0.8);
      }
      ctx.stroke();
      const end = pts.at(-1), prev = pts.at(-4);
      heads.push({ x: end.x, y: end.y, a: Math.atan2(end.y - prev.y, end.x - prev.x), size: W * 3.2 * (0.5 + 0.5 * g), st: clamp(st), color, phase: neck.phase });
    }
    for (const h of heads) this.drawHead(ctx, h, frame, palette, dark, glowAmt);

    // The body, half sunk in the water.
    const bg = ctx.createRadialGradient(cx, bodyTop, 0, cx, bodyTop, bodyW * 1.2);
    bg.addColorStop(0, mix(rampAt(palette.colors, 0.4), dark, 0.25));
    bg.addColorStop(1, mix(palette.colors[0], dark, 0.5));
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(cx, waterY + Z * 0.03, bodyW * (1 + 0.03 * frame.bass), Z * 0.15 * (1 + 0.05 * frame.bass), 0, Math.PI, TAU);
    ctx.fill();
    // Spines along its back.
    ctx.fillStyle = mix(palette.colors[0], dark, 0.3);
    for (let i = 0; i < 9; i++) {
      const f = i / 8, a = Math.PI + f * Math.PI;
      const x = cx + Math.cos(a) * bodyW * 0.85, y = waterY + Z * 0.03 + Math.sin(a) * Z * 0.14;
      const h = Z * 0.03 * (1 + Math.sin(f * Math.PI));
      ctx.beginPath();
      ctx.moveTo(x - h * 0.4, y + h * 0.3);
      ctx.lineTo(x + Math.cos(a) * h * 0.3, y - h);
      ctx.lineTo(x + h * 0.4, y + h * 0.3);
      ctx.fill();
    }

    // Water: dark, with moonlight and ripples spreading from the body.
    const water = ctx.createLinearGradient(0, waterY, 0, height);
    water.addColorStop(0, mix(palette.bg[1], palette.colors[0], 0.35));
    water.addColorStop(1, dark);
    ctx.fillStyle = water;
    ctx.fillRect(0, waterY, width, height - waterY);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 16; i++) {
      const a = i / 16, y = waterY + S * 0.008 + a * (height - waterY) * 0.7;
      const w = mr * (0.6 + a * 2) * (0.6 + 0.4 * Math.sin(t * 2 + i * 1.9));
      ctx.fillStyle = rgba(palette.text, 0.18 * (1 - a));
      ctx.fillRect(mx - w / 2 + Math.sin(t * 1.5 + i) * 8 * u, y, w, (1 + a * 2) * u);
    }
    // Reflected glow of the eyes.
    for (const h of heads) {
      ctx.globalAlpha = clamp(0.15 + 0.3 * h.st) * glowAmt;
      const r = h.size * 0.8;
      ctx.drawImage(this.eye, h.x - r, waterY + (waterY - h.y) * 0.25 - r * 0.3, r * 2, r * 0.6);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rgba(palette.colors[2], 0.4);
    ctx.lineWidth = 2 * u;
    for (const rp of this.ripples) {
      rp.r += dt * S * 0.35;
      rp.a *= Math.exp(-dt * 1.2);
      ctx.globalAlpha = clamp(rp.a);
      ctx.beginPath();
      ctx.ellipse(cx, waterY + S * 0.02, bodyW + rp.r, (bodyW + rp.r) * 0.12, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this.ripples = this.ripples.filter((r) => r.a > 0.03);
    ctx.globalCompositeOperation = 'source-over';

    // Venom: spat from the snapping jaws, glowing, falling into the water.
    if (p.venom > 0) {
      for (const h of heads) {
        if (h.st > 0.5 && random() < h.st * p.venom) {
          for (let k = 0; k < 3; k++) {
            const a = h.a + (random() - 0.5) * 0.5, sp = S * (0.25 + random() * 0.35) * h.st;
            this.venom.push({ x: h.x + Math.cos(h.a) * h.size, y: h.y + Math.sin(h.a) * h.size, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: 0.6 + random() * 0.6, r: (4 + random() * 6) * u });
          }
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      this.venom = this.venom.filter((v) => {
        v.age += dt;
        v.vy += S * 0.9 * dt;
        v.x += v.vx * dt;
        v.y += v.vy * dt;
        if (v.age > v.life || v.y > waterY) return false;
        const r = v.r * (1 + v.age);
        ctx.globalAlpha = clamp(1 - v.age / v.life) * glowAmt * 0.8;
        ctx.drawImage(this.eye, v.x - r, v.y - r, r * 2, r * 2);
        return true;
      }).slice(-400);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    if (p.mist > 0) this.drawMist(ctx, true, env, dt);
  },

  drawMist(ctx, front, { width, params: p }, dt) {
    const { S, waterY } = this;
    ctx.globalCompositeOperation = 'lighter';
    for (const [i, m] of this.mist.entries()) {
      if ((i % 3 === 0) !== front) continue;
      m.x += m.speed * dt;
      if (m.x > 1.4) m.x = -0.4;
      if (m.x < -0.4) m.x = 1.4;
      const w = S * m.w, h = S * 0.18;
      const y = waterY + (front ? S * 0.08 : -S * 0.04) + m.y * S * 0.06;
      ctx.globalAlpha = clamp((front ? 0.12 : 0.2) * p.mist);
      ctx.drawImage(this.mistSprite, m.x * width - w / 2, y - h / 2, w, h);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  },

  // A serpent queen's head pointing along h.a: a slender, smooth head with
  // flowing frills swept back like hair, a jewel on the brow, an almond eye
  // with lashes, and a jaw that drops open on a snap to show two slim fangs.
  drawHead(ctx, h, frame, palette, dark, glowAmt) {
    const s = h.size, gape = 0.05 + 0.5 * h.st, t = this.t;
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.a);
    if (Math.cos(h.a) < 0) ctx.scale(1, -1); // keep the frills on top
    const skin = mix(h.color, palette.colors[2], 0.15);
    const outline = rgba(dark, 0.55);

    // Tresses: long frills flowing back from the crown like hair, drooping
    // and rippling as she moves.
    const frills = new Path2D();
    for (let i = 0; i < 7; i++) {
      const f = i / 6;
      const bx = s * (0.18 - 0.5 * f), by = s * (-0.29 + 0.25 * f);
      const L = s * (1.25 - 0.3 * f), droop = s * (0.25 + 0.35 * f);
      const pts = [];
      for (let k = 0; k <= 10; k++) {
        const q = k / 10;
        const ripple = Math.sin(t * 3.2 + h.phase + i * 0.7 - q * 5) * s * 0.07 * q * (1 + frame.mid);
        pts.push({ x: bx - L * q, y: by - s * 0.12 * q * (1 - q) * 4 + droop * q * q + ripple, w: s * 0.075 * Math.sin(Math.PI * Math.min(1, q * 0.9 + 0.12)) });
      }
      frills.addPath(ribbon(pts));
    }
    const fg = ctx.createLinearGradient(0, 0, -s * 1.3, 0);
    fg.addColorStop(0, mix(h.color, palette.colors[2], 0.3));
    fg.addColorStop(1, rgba(mix(palette.colors[2], palette.accent, 0.2), 0.75));
    ctx.fillStyle = fg;
    ctx.fill(frills);
    ctx.strokeStyle = rgba(dark, 0.3);
    ctx.lineWidth = Math.max(1, s * 0.015);
    ctx.stroke(frills);

    // Lower jaw, slim, opening on the snap.
    ctx.save();
    ctx.translate(s * 0.1, s * 0.08);
    ctx.rotate(gape);
    ctx.fillStyle = mix(skin, dark, 0.3);
    ctx.beginPath();
    ctx.moveTo(s * 0.1, -s * 0.03);
    ctx.quadraticCurveTo(s * 0.5, -s * 0.01, s * 0.8, -s * 0.03);
    ctx.quadraticCurveTo(s * 0.75, s * 0.05, s * 0.45, s * 0.08);
    ctx.quadraticCurveTo(s * 0.2, s * 0.09, 0, s * 0.04);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.stroke();
    ctx.restore();
    if (h.st > 0.1) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = h.st * glowAmt * 0.6;
      ctx.drawImage(this.eye, s * 0.25, -s * 0.12, s * 0.7, s * 0.45);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      // Two slim fangs.
      ctx.fillStyle = rgba(palette.text, 0.9);
      for (const x of [0.62, 0.78]) {
        ctx.beginPath();
        ctx.moveTo(s * x, s * 0.05);
        ctx.quadraticCurveTo(s * (x + 0.01), s * (0.1 + 0.08 * h.st), s * (x + 0.035), s * (0.12 + 0.1 * h.st));
        ctx.lineTo(s * (x + 0.04), s * 0.05);
        ctx.fill();
      }
    }

    // Head: rounded crown, long elegant face, fine pointed snout.
    const head = new Path2D();
    head.moveTo(-s * 0.3, s * 0.12);
    head.bezierCurveTo(-s * 0.36, -s * 0.1, -s * 0.15, -s * 0.32, s * 0.15, -s * 0.3);
    head.bezierCurveTo(s * 0.45, -s * 0.28, s * 0.75, -s * 0.15, s * 0.98, -s * 0.03);
    head.quadraticCurveTo(s * 1.05, s * 0.01, s * 0.95, s * 0.05);
    head.lineTo(s * 0.3, s * 0.07);
    head.quadraticCurveTo(0, s * 0.13, -s * 0.3, s * 0.12);
    head.closePath();
    const hg = ctx.createLinearGradient(0, -s * 0.3, 0, s * 0.12);
    hg.addColorStop(0, mix(skin, palette.text, 0.25));
    hg.addColorStop(1, mix(skin, dark, 0.2));
    ctx.fillStyle = hg;
    ctx.fill(head);
    ctx.strokeStyle = outline;
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.stroke(head);
    // Lips: a pale line along the mouth.
    ctx.strokeStyle = rgba(mix(palette.colors[2], h.color, 0.4), 0.7);
    ctx.lineWidth = Math.max(1, s * 0.022);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s * 0.4, s * 0.065);
    ctx.quadraticCurveTo(s * 0.7, s * 0.05, s * 0.94, s * 0.04);
    ctx.stroke();

    // Almond eye, tilted up, with a lid line and lashes.
    ctx.save();
    ctx.translate(s * 0.42, -s * 0.1);
    ctx.rotate(-0.18);
    const ew = s * 0.12, eh = s * 0.052;
    const eye = new Path2D();
    eye.moveTo(-ew, 0);
    eye.quadraticCurveTo(0, -eh * 1.6, ew, 0);
    eye.quadraticCurveTo(0, eh * 1.2, -ew, 0);
    ctx.fillStyle = mix(palette.text, palette.accent, 0.35);
    ctx.fill(eye);
    ctx.save();
    ctx.clip(eye);
    ctx.fillStyle = palette.accent;
    ctx.beginPath();
    ctx.arc(s * 0.01, 0, eh * 0.95, 0, TAU);
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(s * 0.01, 0, eh * 0.18, eh * 0.85, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = rgba(dark, 0.9);
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.beginPath();
    ctx.moveTo(-ew * 1.05, eh * 0.1);
    ctx.quadraticCurveTo(0, -eh * 1.75, ew * 1.15, -eh * 0.15);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.beginPath();
    for (const x of [-0.6, -0.2, 0.2, 0.55]) {
      // Fanned out from the lid, curling back at the tips.
      const px = x * ew, py = -eh * 0.8 * (1 - 0.6 * x * x);
      const a = -Math.PI / 2 + 0.9 * x - 0.25, l = eh * 1.05;
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + Math.cos(a) * l * 0.6, py + Math.sin(a) * l * 0.6, px + Math.cos(a) * l - eh * 0.3, py + Math.sin(a) * l);
    }
    ctx.stroke();
    ctx.restore();

    // Jewel on the brow, and the eye's glow.
    ctx.fillStyle = mix(palette.accent, palette.text, 0.3);
    ctx.beginPath();
    const jx = s * 0.22, jy = -s * 0.27, jr = s * 0.045;
    ctx.moveTo(jx, jy - jr * 1.3);
    ctx.lineTo(jx + jr, jy);
    ctx.lineTo(jx, jy + jr * 1.1);
    ctx.lineTo(jx - jr, jy);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(0.3 + 0.7 * frame.pulse) * glowAmt * 0.7;
    ctx.drawImage(this.eye, jx - s * 0.15, jy - s * 0.15, s * 0.3, s * 0.3);
    ctx.globalAlpha = clamp(0.45 + 0.55 * Math.max(h.st, frame.pulse)) * glowAmt;
    const er = s * (0.15 + 0.12 * h.st);
    ctx.drawImage(this.eye, s * 0.43 - er, -s * 0.1 - er, er * 2, er * 2);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  },
};
