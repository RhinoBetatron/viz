import { Path2D } from 'skia-canvas';
import { mix, rgba } from '../palettes.js';
import { clamp } from '../util.js';
import { Sea, Lightning, glowSprite, makeStars, drawStars, makeFog, drawFog, drawMoon, drawMoonlight, makeRain, drawRain } from '../sea.js';

const TAU = Math.PI * 2;
const SEGMENTS = 44; // points along each tentacle

export default {
  name: 'kraken',
  description: 'Tentacles rise out of a night sea made of the waveform, coiling with the music and lashing on every kick, while a great eye surfaces on the drops',
  palette: 'spectral', // used when no -p is given
  // With --auto: settings scaled in calm parts, builds and drops (see modulate.js).
  sections: {
    calm: { rise: 0.75, lash: 0.5, fog: 1.3, lightning: 0.4 },
    build: { rise: 0.95, lash: 0.9 },
    drop: { rise: 1.15, lash: 1.5, writhe: 1.3, fog: 0.8, lightning: 2 },
  },
  params: {
    tentacles: 7,   // how many tentacles (0–12)
    size: 1,        // size of the tentacles and eye
    rise: 1,        // how far the tentacles rise as the track gets louder
    curl: 1,        // how tightly the tips coil
    lash: 1,        // how hard they whip on kicks (0 = no lashing)
    writhe: 1,      // slow squirming
    suckers: 1,     // glowing suckers (0 = off)
    eye: 1,         // the eye that surfaces on loud parts (0 = never, 2 = always up)
    swell: 1,       // height of the slow swell (driven by the bass)
    chop: 1,        // how much of the raw waveform shows in the sea surface
    waves: 5,       // sea layers (2–6)
    spray: 1,       // spray thrown off lashing tentacles (0 = off)
    fog: 1,
    moon: 0.8,
    stars: 90,
    lightning: 1.5, // chance of lightning on big hits (0 = off)
    rain: 0,        // rain streaks (try 1–2)
  },

  setup(ctx, env) {
    const { width, height, u, random, palette, params: p } = env;
    this.t = 0;
    this.S = Math.min(width * 0.5, height * 0.38) * p.size;
    this.sea = new Sea(env, { size: this.S, waterY: env.cy + this.S * 0.5, anchor: 0.4, seeThrough: 0.03 });
    this.lightning = new Lightning(env);
    this.stars = makeStars(random, p.stars, u);
    this.fogBanks = makeFog(random);
    this.rain = makeRain(random, p.rain);
    this.energy = null;
    this.rise = 0.3;
    this.eyeUp = 0;
    this.blink = 0;
    this.spray = [];

    // Tentacles spread across the frame, some behind the anchor layer, some
    // in front. Nearer ones are bigger.
    const n = Math.round(clamp(p.tentacles, 0, 12));
    const span = Math.min(width * 0.46, this.S * 1.5);
    const layers = this.sea.layers, k = this.sea.anchor;
    this.tentacles = Array.from({ length: n }, (_, i) => {
      const f = n > 1 ? i / (n - 1) : 0.5;
      const side = f < 0.5 ? -1 : 1;
      const layer = Math.min(layers - 1, Math.max(0, k + [-1, 0, 1, 0, -1, 1, 0][i % 7]));
      const depth = (layer + 1) / layers;
      return {
        x: env.cx + (f - 0.5) * 2 * span + (random() - 0.5) * span * 0.15,
        layer,
        len: this.S * (1.05 + random() * 0.5) * (0.65 + 0.55 * depth),
        w: this.S * (0.07 + random() * 0.025) * (0.65 + 0.55 * depth),
        dir: side * (random() < 0.25 ? -1 : 1), // which way the tip coils
        lean: side * (0.15 + random() * 0.25),
        phase: random() * TAU,
        speed: 0.7 + random() * 0.6,
        lag: 0.3 + random() * 0.5, // rises a little after the others
        rise: 0.3,
        lash: 0,
        lashV: 0,
      };
    });
    this.tentacles.sort((a, b) => a.layer - b.layer);

    this.glow = glowSprite(env, palette.accent, 64 * u);
    this.mist = glowSprite(env, palette.colors[1], 128 * u);
    this.foam = glowSprite(env, palette.colors[2], 64 * u);
  },

  // Centre line of a tentacle, base to tip, as [x, y, width].
  spine(tn, p) {
    const sea = this.sea;
    const length = tn.len * (0.15 + 0.85 * tn.rise);
    const seg = length / SEGMENTS;
    let x = tn.x, y = sea.y(tn.layer, tn.x) + tn.w * 1.2; // base starts under water
    let a = -Math.PI / 2 + tn.lean * (1 - 0.4 * tn.rise);
    const pts = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const f = i / SEGMENTS;
      pts.push([x, y, tn.w * (1 - f) ** 0.85 + this.S * 0.004]);
      // Bends: a coil that tightens towards the tip, a slow squirm running up
      // the length, and the kick lash whipping the top half over.
      const coil = p.curl * 38 * f ** 5.5 * (0.7 + 0.3 * Math.sin(this.t * 0.7 * tn.speed + tn.phase));
      const squirm = p.writhe * 1.4 * Math.sin(this.t * 1.6 * tn.speed - f * 6 + tn.phase) * f;
      const whip = tn.lash * 4 * f ** 1.3;
      const sway = -tn.dir * 2.2 * Math.sin(f * Math.PI) * (1 - 0.5 * tn.rise); // S-bend below the coil
      const da = (tn.dir * coil + sway + squirm + whip * tn.dir) / SEGMENTS;
      a += da;
      x += Math.cos(a) * seg;
      y += Math.sin(a) * seg;
    }
    return pts;
  },

  drawTentacle(ctx, tn, env) {
    const { u, palette, params: p } = env;
    const pts = this.spine(tn, p);
    const left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
      const [x, y, w] = pts[i];
      const [x0, y0] = pts[Math.max(0, i - 1)], [x1, y1] = pts[Math.min(pts.length - 1, i + 1)];
      const a = Math.atan2(y1 - y0, x1 - x0);
      const nx = -Math.sin(a), ny = Math.cos(a);
      left.push([x + nx * w, y + ny * w]);
      right.push([x - nx * w, y - ny * w, nx, ny, w]);
    }
    const body = new Path2D();
    left.forEach(([x, y], i) => (i ? body.lineTo(x, y) : body.moveTo(x, y)));
    const [tx, ty] = pts.at(-1);
    body.lineTo(tx, ty);
    for (let i = right.length - 1; i >= 0; i--) body.lineTo(right[i][0], right[i][1]);
    body.closePath();

    // Dark flesh, lit along the top from the moon.
    ctx.globalCompositeOperation = 'source-over';
    const [bx, by] = pts[0];
    const grad = ctx.createLinearGradient(bx, by, tx, ty);
    grad.addColorStop(0, mix(palette.bg[0], palette.colors[0], 0.5));
    grad.addColorStop(1, mix(palette.bg[0], palette.colors[0], 0.9));
    ctx.fillStyle = grad;
    ctx.fill(body);

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    const lift = 0.6 + 0.4 * this.pulse;
    for (const [w, a] of [[10, 0.05], [4, 0.12], [1.5, 0.75]]) {
      ctx.lineWidth = w * u;
      ctx.strokeStyle = rgba(palette.colors[2], a * lift);
      ctx.stroke(body);
    }

    // Suckers down the inner (coiling) side, glowing with the beat.
    if (p.suckers > 0) {
      const suck = new Path2D();
      for (let i = 3; i < pts.length - 2; i += 2) {
        const [x, y, nx, ny, w] = right[i];
        const side = tn.dir > 0 ? -1 : 1; // inner side faces into the coil
        const r = w * 0.32;
        if (r < 1.2 * u) continue;
        const sx = pts[i][0] + side * nx * w * 0.55 * -1, sy = pts[i][1] + side * ny * w * 0.55 * -1;
        suck.moveTo(sx + r, sy);
        suck.arc(sx, sy, r, 0, TAU);
      }
      ctx.fillStyle = rgba(palette.accent, (0.12 + 0.35 * this.pulse) * p.suckers);
      ctx.fill(suck);
      ctx.lineWidth = 1.1 * u;
      ctx.strokeStyle = rgba(palette.colors[2], 0.55 * p.suckers);
      ctx.stroke(suck);
    }
    return pts;
  },

  // The eye: a dark mound breaking the surface with a slit-pupilled eye.
  drawEye(ctx, env, frame) {
    const { u, cx, palette } = env;
    const up = this.eyeUp;
    if (up < 0.02) return;
    const S = this.S;
    const water = this.sea.y(this.sea.anchor, cx);
    const W = S * 0.62, H = S * 0.42 * up;
    const top = water - H;
    const mound = new Path2D();
    mound.moveTo(cx - W, water + S * 0.05);
    mound.bezierCurveTo(cx - W * 0.8, top - H * 0.1, cx + W * 0.8, top - H * 0.1, cx + W, water + S * 0.05);
    mound.closePath();
    ctx.globalCompositeOperation = 'source-over';
    const grad = ctx.createLinearGradient(0, top, 0, water);
    grad.addColorStop(0, mix(palette.bg[0], palette.colors[0], 0.8));
    grad.addColorStop(1, palette.bg[0]);
    ctx.fillStyle = grad;
    ctx.fill(mound);
    ctx.globalCompositeOperation = 'lighter';
    for (const [w, a] of [[12, 0.05], [4, 0.12], [1.5, 0.7]]) {
      ctx.lineWidth = w * u;
      ctx.strokeStyle = rgba(palette.colors[2], a);
      ctx.stroke(mound);
    }

    // The eye opens once it's clear of the water, and blinks now and then.
    const open = clamp((up - 0.45) / 0.4) * (1 - this.blink);
    if (open <= 0.02) return;
    const ex = cx, ey = top + H * 0.42, ew = S * 0.2, eh = S * 0.085 * open;
    const lid = new Path2D();
    lid.moveTo(ex - ew, ey);
    lid.quadraticCurveTo(ex, ey - eh * 2, ex + ew, ey);
    lid.quadraticCurveTo(ex, ey + eh * 2, ex - ew, ey);
    lid.closePath();
    const r = S * 0.14;
    ctx.globalAlpha = clamp(0.5 + 0.5 * this.pulse) * open;
    ctx.drawImage(this.glow, ex - r * 3, ey - r * 3, r * 6, r * 6);
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.clip(lid);
    const iris = ctx.createRadialGradient(ex, ey, 0, ex, ey, ew);
    iris.addColorStop(0, palette.text);
    iris.addColorStop(0.35, palette.accent);
    iris.addColorStop(1, rgba(palette.colors[1], 0.6));
    ctx.fillStyle = iris;
    ctx.fillRect(ex - ew, ey - eh * 2, ew * 2, eh * 4);
    // Slit pupil, widening with the bass, glancing about.
    const look = Math.sin(this.t * 0.6) * ew * 0.25;
    const pw = S * (0.012 + 0.03 * frame.bass);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = palette.bg[0];
    ctx.beginPath();
    ctx.ellipse(ex + look, ey, pw, eh * 1.6, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = rgba(palette.text, 0.8);
    ctx.stroke(lid);
  },

  draw(ctx, frame, env) {
    const { width, height, fps, u, cx, cy, palette, random, params: p } = env;
    const dt = 1 / fps;
    this.t += dt;
    const t = this.t;
    const S = this.S;
    const sea = this.sea;
    this.pulse = frame.pulse;
    sea.update(frame, dt);

    // Slow loudness decides how far the tentacles are up.
    // (Loudness is relative to the clip, so on a whole track they come up on
    // the drops, and on a short clip in its louder moments.)
    this.energy = this.energy ?? frame.rms;
    this.energy += (frame.rms - this.energy) * (1 - 0.5 ** (dt / 1.2));
    const target = clamp((0.3 + 1.2 * this.energy + 0.25 * frame.pulse) * p.rise);
    for (const tn of this.tentacles) {
      tn.rise += (target - tn.rise) * (1 - 0.5 ** (dt / tn.lag));
      tn.lashV += (-tn.lash * 30 - tn.lashV * 5) * dt;
      tn.lash += tn.lashV * dt;
    }
    if (frame.kick && p.lash > 0 && this.tentacles.length) {
      // A couple of tentacles whip over on each kick.
      for (let k = 0; k < 2; k++) {
        const tn = this.tentacles[Math.floor(random() * this.tentacles.length)];
        tn.lashV += frame.kickStrength * 6 * p.lash * (random() < 0.5 ? 1 : -0.6);
      }
    }
    const eyeGoal = p.eye >= 2 ? 1 : clamp((this.energy - 0.36) * 5) * p.eye;
    this.eyeUp += (eyeGoal - this.eyeUp) * (1 - 0.5 ** (dt / 0.8));
    if (this.blink > 0) this.blink = Math.max(0, this.blink - dt * 6);
    else if (random() < dt * 0.15) this.blink = 1;

    // Sky.
    const horizon = sea.y(0, cx);
    drawStars(ctx, this.stars, env, horizon, t, frame.high);
    const moonR = S * 0.1 * p.moon;
    const moonX = cx + Math.min(width * 0.3, S * 0.75);
    const moonY = Math.max(moonR * 2.4, horizon - S * 1.15);
    drawMoon(ctx, { x: moonX, y: moonY, r: moonR, halo: 0.3 + 0.25 * frame.bass, craters: true, sprite: this.mist, palette });
    this.lightning.strike(frame, t, horizon, p.lightning);
    this.lightning.drawBolt(ctx);
    const fog = { sprite: this.mist, size: S, horizon, waterY: sea.waterY, amount: p.fog, rms: frame.rms, dt, env };
    drawFog(ctx, this.fogBanks, { ...fog, front: false });

    // Each sea layer covers the bases of the tentacles rising out of it.
    const tips = [];
    for (let l = 0; l < sea.layers; l++) {
      if (l === sea.anchor) this.drawEye(ctx, env, frame);
      for (const tn of this.tentacles) {
        if (tn.layer !== l) continue;
        const pts = this.drawTentacle(ctx, tn, env);
        if (Math.abs(tn.lashV) > 2 && p.spray > 0) tips.push([pts[Math.round(SEGMENTS * 0.7)], tn]);
      }
      sea.draw(ctx, l);
    }
    drawMoonlight(ctx, sea, { x: moonX, r: moonR, horizon, rows: 16, alpha: 0.08 + 0.1 * frame.bass, t, env });

    // Water streaming off lashing tentacles.
    for (const [[x, y], tn] of tips) {
      if (random() > 0.6) continue;
      for (let i = 0; i < 3 * p.spray; i++) {
        this.spray.push({ x: x + (random() - 0.5) * tn.w * 2, y, vx: (random() - 0.5) * S * 0.5, vy: -random() * S * 0.4, life: 1, r: (1 + random() * 2) * u });
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.spray) {
      s.life -= dt / 1.2;
      s.vy += S * 2.2 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      ctx.fillStyle = rgba(palette.colors[2], clamp(s.life) * 0.8);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    this.spray = this.spray.filter((s) => s.life > 0 && s.y < height);

    drawFog(ctx, this.fogBanks, { ...fog, front: true });
    drawRain(ctx, this.rain, env, dt, 0.2);
    this.lightning.drawFlash(ctx, dt);
    ctx.globalCompositeOperation = 'source-over';
  },
};
