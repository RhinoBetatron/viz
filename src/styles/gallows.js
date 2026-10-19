import { Path2D } from 'skia-canvas';
import { mix, rgba } from '../palettes.js';
import { clamp } from '../util.js';
import hands from './hands.js';
import { Sea, Lightning, glowSprite, makeStars, drawStars, makeFog, drawFog, drawMoon, makeRain, drawRain } from '../sea.js';

const TAU = Math.PI * 2;

export default {
  name: 'gallows',
  description: 'Grey hands reach up out of a stormy sea towards a sinking mast, its yard hung with a swaying noose, clutching at it on every kick while crows circle',
  palette: 'gloom', // used when no -p is given
  params: {
    hands: 6,       // hands reaching out of the water (0–10)
    reach: 1,       // how far they rise out of the water
    grip: 1,        // how hard they clutch on kicks
    tremble: 1,     // finger twitching with the highs (0 = still)
    scale: 1,       // size of the hands
    mast: 1,        // the sinking mast and noose (0 = none)
    crows: 6,       // crows circling the mast (0 = none)
    swell: 1.2,
    chop: 1,
    waves: 5,
    rain: 1,        // rain streaks (0 = dry)
    lightning: 1,   // chance of lightning on big hits (0 = off)
    fog: 1,
    moon: 0.6,
    stars: 30,
  },

  // The hand model and its drawing come straight from the hands style.
  pose: hands.pose,
  drawHand: hands.drawHand,
  updateCurls: hands.updateCurls,

  setup(ctx, env) {
    const { width, height, u, cx, cy, random, palette, params: p } = env;
    this.t = 0;
    const S = (this.S = Math.min(width, height));
    this.sea = new Sea(env, { size: S * 0.5, waterY: cy + S * 0.22, seeThrough: 0.02 });
    this.lightning = new Lightning(env);
    this.stars = makeStars(random, p.stars, u);
    this.fogBanks = makeFog(random);
    this.rain = makeRain(random, p.rain);
    this.energy = null;
    this.mastX = cx + Math.min(width * 0.2, S * 0.22);
    this.swing = 0;
    this.swingV = 0;

    // Hands spread across the water, rising from different wave layers.
    const n = Math.round(clamp(p.hands, 0, 10));
    const layers = this.sea.layers, k = this.sea.anchor;
    this.hands = Array.from({ length: n }, (_, i) => {
      const f = n > 1 ? i / (n - 1) : 0.5;
      const layer = Math.min(layers - 1, k + (i % 3 === 1 ? 1 : i % 3 === 2 ? 2 : 0));
      const depth = (layer - k + 1) / (layers - k);
      return {
        bx: width * (0.08 + f * 0.84) + (random() - 0.5) * width * 0.06,
        layer, depth,
        size: S * 0.15 * (0.65 + 0.6 * depth) * p.scale,
        mirror: random() < 0.5 ? 1 : -1,
        back: random() < 0.35,
        phase: random() * TAU,
        speed: 0.3 + random() * 0.4,
        sens: 0.6 + random() * 0.4,
        lean: (random() - 0.5) * 0.5,
        rise: 0,
        grab: 0,
        curls: [0, 0, 0, 0, 0],
        twitch: random() * 10,
      };
    }).sort((a, b) => a.layer - b.layer);

    this.crows = Array.from({ length: Math.round(p.crows) }, () => ({
      a: random() * TAU, r: 0.6 + random() * 0.6, speed: (0.25 + random() * 0.25) * (random() < 0.3 ? -1 : 1),
      h: random(), flap: random() * TAU, size: 0.7 + random() * 0.6,
    }));
    this.mist = glowSprite(env, palette.colors[1], 128 * u);
  },

  // Sinking mast, leaning, bobbing with the swell, with a yard and a noose.
  drawMast(ctx, env, frame) {
    const { u, palette, params: p } = env;
    const S = this.S, sea = this.sea;
    const x = this.mastX;
    const water = sea.y(sea.anchor, x);
    const slope = (sea.y(sea.anchor, x + S * 0.1) - sea.y(sea.anchor, x - S * 0.1)) / (S * 0.2);
    const lean = -0.22 + slope * 0.4 + Math.sin(this.t * 0.5) * 0.03;
    const H = S * 0.62 * p.mast;
    ctx.save();
    ctx.translate(x, water + S * 0.05);
    ctx.rotate(lean);
    const wood = new Path2D();
    wood.rect(-S * 0.012, -H, S * 0.024, H + S * 0.1);                 // mast
    wood.rect(-S * 0.3, -H * 0.86, S * 0.38, S * 0.016);                // yard
    wood.rect(-S * 0.02, -H * 0.7, S * 0.04, S * 0.03);                 // fitting
    const rigging = new Path2D();
    rigging.moveTo(0, -H); rigging.lineTo(-S * 0.29, -H * 0.85);        // lift
    rigging.moveTo(0, -H * 0.98); rigging.lineTo(S * 0.2, -S * 0.02);   // stay down to the water
    // Rags of sail hanging off the yard.
    const rags = new Path2D();
    for (const [a, b, len] of [[-0.26, -0.18, 0.12], [-0.12, -0.02, 0.2], [0.0, 0.06, 0.08]]) {
      const flap = Math.sin(this.t * 3 + a * 20) * S * 0.01 * (1 + frame.high);
      rags.moveTo(S * a, -H * 0.86 + S * 0.016);
      rags.lineTo(S * b, -H * 0.86 + S * 0.016);
      rags.lineTo(S * b + flap, -H * 0.86 + S * len);
      rags.lineTo(S * (a + b) / 2 + flap * 1.5, -H * 0.86 + S * len * 0.7);
      rags.lineTo(S * a + flap, -H * 0.86 + S * len * 0.9);
      rags.closePath();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = mix(palette.bg[0], palette.colors[0], 0.6);
    ctx.fill(wood);
    ctx.fillStyle = rgba(palette.colors[0], 0.8);
    ctx.fill(rags);
    ctx.lineWidth = 1.4 * u;
    ctx.strokeStyle = rgba(palette.colors[1], 0.6);
    ctx.stroke(wood);
    ctx.stroke(rags);
    ctx.strokeStyle = rgba(palette.colors[1], 0.45);
    ctx.lineWidth = 1 * u;
    ctx.stroke(rigging);

    // The noose: a pendulum off the end of the yard, kicked by the beat.
    const len = S * 0.24;
    const ax = -S * 0.27, ay = -H * 0.86 + S * 0.016;
    const a = this.swing - lean;
    const nx = ax + Math.sin(a) * len, ny = ay + Math.cos(a) * len;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = rgba(palette.colors[2], 0.8);
    ctx.lineWidth = 2 * u;
    ctx.stroke();
    ctx.save();
    ctx.translate(nx, ny);
    ctx.rotate(-a);
    ctx.beginPath();
    for (let k = 0; k < 4; k++) ctx.rect(-S * 0.008, -S * 0.012 * k - S * 0.008, S * 0.016, S * 0.01); // the knot's coils
    ctx.moveTo(S * 0.025, S * 0.035);
    ctx.ellipse(0, S * 0.035, S * 0.025, S * 0.035, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
    // Where the noose hangs, so the hands can reach for it.
    const c = Math.cos(lean), s = Math.sin(lean);
    this.target = [x + nx * c - ny * s, water + S * 0.05 + nx * s + ny * c];
    this.top = [x + Math.sin(lean) * H, water - Math.cos(lean) * H];
  },

  drawCrows(ctx, env, frame) {
    if (!this.crows.length) return;
    const { u, palette } = env;
    const S = this.S;
    const [tx, ty] = this.top ?? [env.cx, env.cy - S * 0.4];
    const path = new Path2D();
    for (const c of this.crows) {
      // They scatter wider when it gets loud.
      c.a += c.speed * (0.7 + 0.8 * frame.rms) / 60 * (60 / env.fps);
      c.flap += (8 + 6 * frame.pulse) / env.fps;
      const r = S * 0.2 * c.r * (1 + 0.6 * frame.pulse);
      const x = tx + Math.cos(c.a) * r, y = ty + S * 0.06 + Math.sin(c.a) * r * 0.35 - c.h * S * 0.06;
      const w = S * 0.034 * c.size, up = Math.sin(c.flap) * w * 0.7;
      path.moveTo(x - w, y - up);
      path.quadraticCurveTo(x - w * 0.4, y - up * 0.2 - w * 0.2, x, y);
      path.quadraticCurveTo(x + w * 0.4, y - up * 0.2 - w * 0.2, x + w, y - up);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    ctx.lineWidth = 5 * u;
    ctx.strokeStyle = rgba(palette.colors[1], 0.4);
    ctx.stroke(path);
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = palette.bg[0];
    ctx.stroke(path);
  },

  draw(ctx, frame, env) {
    const { width, height, fps, u, cx, palette, params: p } = env;
    const dt = 1 / fps;
    this.t += dt;
    const t = this.t;
    const S = this.S, sea = this.sea;
    sea.update(frame, dt);
    this.energy = this.energy ?? frame.rms;
    this.energy += (frame.rms - this.energy) * (1 - 0.5 ** (dt / 1.2));
    if (frame.kick) this.swingV += frame.kickStrength * 0.45 * (Math.sin(t * 3) > 0 ? 1 : -1);
    this.swingV += (-this.swing * 6 - this.swingV * 1.6 + Math.sin(t * 0.7) * 0.3 * frame.mid) * dt;
    this.swing += this.swingV * dt;

    const horizon = sea.y(0, cx);
    drawStars(ctx, this.stars, env, horizon, t, frame.high);
    const moonR = S * 0.07 * p.moon;
    const moonX = cx - Math.min(width * 0.3, S * 0.35), moonY = Math.max(moonR * 2.5, horizon - S * 0.6);
    drawMoon(ctx, { x: moonX, y: moonY, r: moonR, halo: 0.2 + 0.15 * frame.bass, craters: true, sprite: this.mist, palette });
    this.lightning.strike(frame, t, horizon, p.lightning);
    this.lightning.drawBolt(ctx);
    const fog = { sprite: this.mist, size: S * 0.5, horizon, waterY: sea.waterY, amount: p.fog, rms: frame.rms, dt, env };
    drawFog(ctx, this.fogBanks, { ...fog, front: false });

    // Hands: rising with the loudness and their own slow sway, lunging up
    // and clutching on kicks, reaching towards the noose.
    for (let l = 0; l < sea.layers; l++) {
      if (l === sea.anchor && p.mast > 0) {
        this.drawMast(ctx, env, frame);
        this.drawCrows(ctx, env, frame);
      }
      for (const h of this.hands) {
        if (h.layer !== l) continue;
        if (frame.kick) h.grab = Math.max(h.grab, frame.kickStrength * h.sens * p.grip);
        h.grab *= 0.88 ** (30 / fps);
        const sway = 0.5 + 0.5 * Math.sin(t * h.speed + h.phase);
        const goal = clamp((0.15 + 0.6 * this.energy + 0.3 * sway + 0.35 * h.grab) * p.reach);
        h.rise += (goal - h.rise) * (goal > h.rise ? 0.15 : 0.05) * (30 / fps);
        const water = sea.y(h.layer, h.bx);
        h.x = h.bx + Math.sin(t * 0.4 + h.phase) * h.size * 0.15;
        h.y = water + h.size * 0.35 - h.size * 1.5 * h.rise;
        const [tx, ty] = this.target ?? [cx, horizon - S * 0.3];
        const aim = Math.atan2(ty - h.y, tx - h.x) + Math.PI / 2; // fingers towards the noose
        h.roll = clamp(aim * 0.5 + h.lean * 0.4, -0.7, 0.7) + 0.08 * Math.sin(t * 0.9 + h.phase);
        h.yaw = (h.back ? Math.PI : 0) + 0.45 * Math.sin(t * 0.3 + h.phase);
        h.pitch = -0.15 - 0.15 * h.grab;
        h.arm = (height - h.y) / h.size + 0.5;
        this.updateCurls(h, 0.1 + 0.15 * (1 - h.rise) + 0.75 * h.grab, frame, p);
        ctx.globalCompositeOperation = 'source-over'; // the sea leaves it on 'lighter'
        this.drawHand(ctx, h, env, (0.35 + 0.4 * h.depth) * (0.7 + 0.3 * h.rise) + 0.2 * h.grab);
      }
      sea.draw(ctx, l);
    }

    drawFog(ctx, this.fogBanks, { ...fog, front: true });
    drawRain(ctx, this.rain, env, dt, 0.18 + 0.1 * frame.rms);
    this.lightning.drawFlash(ctx, dt);
    ctx.globalCompositeOperation = 'source-over';
  },
};
