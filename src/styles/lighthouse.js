import { Path2D } from 'skia-canvas';
import { hexToRgb, mix, rgba } from '../palettes.js';
import { clamp } from '../util.js';
import { Sea, glowSprite, makeStars, drawStars, makeFog, drawFog, drawMoon, drawMoonlight, makeRain, drawRain } from '../sea.js';

const TAU = Math.PI * 2;

// The light beam, drawn once and stretched each frame: a wedge that widens
// and fades away from the lamp, with soft edges.
function beamSprite(env, palette) {
  const W = 512, H = 256;
  const c = env.createCanvas(W, H);
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const near = hexToRgb(palette.text), far = hexToRgb(palette.colors[2]);
  for (let x = 0; x < W; x++) {
    const f = x / (W - 1);
    const spread = 0.08 + 0.92 * f;
    const along = (1 - f) ** 1.1 * Math.min(1, f * 40);
    const rgb = near.map((v, i) => v + (far[i] - v) * Math.min(1, f * 1.6));
    for (let y = 0; y < H; y++) {
      const v = (y - H / 2) / (H / 2) / spread;
      const a = along * (0.6 * Math.exp(-v * v * 2.2) + 0.4 * Math.exp(-v * v * 14));
      const o = (y * W + x) * 4;
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2];
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export default {
  name: 'lighthouse',
  description: 'A lighthouse on a rock in a night sea: its sweeping beam pulses with the music and the waves crash into the rock on every kick',
  palette: 'spectral', // used when no -p is given
  params: {
    size: 1,        // size of the rock and lighthouse
    light: 1,       // beam brightness
    spin: 1,        // how fast the light turns (speeds up with loudness)
    beams: 2,       // beams on the lamp (1 or 2)
    crash: 1,       // how hard the waves break on the rock on kicks (0 = calm)
    swell: 1,       // height of the slow swell (driven by the bass)
    chop: 1,        // how much of the raw waveform shows in the sea surface
    waves: 5,       // sea layers (2–6)
    fog: 1,         // fog banks drifting over the water (0 = off)
    moon: 0.6,      // moon size (0 = no moon)
    stars: 90,
    rain: 0,        // rain streaks (try 1–2)
  },

  setup(ctx, env) {
    const { width, height, u, random, palette, params: p } = env;
    this.t = 0;
    this.angle = 0.6; // beam direction around the tower, 0 = pointing right
    this.S = Math.min(width * 0.5, height * 0.34) * p.size;
    this.rockX = env.cx;
    this.rockW = this.S * 0.55;
    this.rockH = this.S * 0.4;
    this.waterY = env.cy + this.S * 0.62;
    this.sea = new Sea(env, {
      size: this.S, waterY: this.waterY, seeThrough: 0.06, chopMain: 0.08,
      // Water heaping up against the rock after a crash.
      bump: (l, x) => {
        const k = this.sea.anchor;
        if (l < k) return 0;
        const near = Math.exp(-(((x - this.rockX) / (this.rockW * (1.1 + 0.4 * (l - k)))) ** 2));
        return -this.surge * near * this.S * 0.16 / (1 + (l - k) * 0.6);
      },
    });
    this.surge = 0;
    this.surgeV = 0;
    this.wet = 0;
    this.spray = [];
    this.puffs = [];
    this.stars = makeStars(random, p.stars, u);
    this.fogBanks = makeFog(random);
    this.rain = makeRain(random, p.rain);

    // Rock outline in rock units (half-width 1, height 1, origin at the
    // waterline centre), jagged but with a flat top for the tower.
    const pts = [[-1.15, 0.25]];
    const jag = (a, b, n, ya, yb) => {
      for (let i = 1; i <= n; i++) {
        const f = i / n;
        pts.push([a + (b - a) * f + (random() - 0.5) * 0.08, -(ya + (yb - ya) * f) - (i < n ? (random() - 0.4) * 0.14 : 0)]);
      }
    };
    jag(-1.15, -0.62, 5, -0.25, 0.55);
    jag(-0.62, -0.24, 3, 0.55, 1);
    pts.push([0.24, -1]);
    jag(0.24, 0.7, 4, 1, 0.48);
    jag(0.7, 1.2, 4, 0.48, -0.25);
    this.rockPts = pts;
    // Cracks: short broken lines down the face.
    this.cracks = Array.from({ length: 7 }, () => {
      let x = (random() - 0.5) * 1.3, y = -0.85 + random() * 0.3;
      const line = [[x, y]];
      for (let k = 0; k < 4; k++) line.push([(x += (random() - 0.5) * 0.18), (y += 0.1 + random() * 0.12)]);
      return line;
    });
    this.islets = [[-1.9, 0.18, 0.35], [1.75, 0.12, 0.22]].map(([x, h, w]) => ({ x, h, w, j: Array.from({ length: 5 }, () => random()) }));

    this.glow = glowSprite(env, mix(palette.accent, palette.text, 0.5), 96 * u);
    this.mist = glowSprite(env, palette.colors[1], 128 * u);
    this.foam = glowSprite(env, palette.colors[2], 64 * u);
    this.beam = beamSprite(env, palette);
  },

  // Halo, then core: the glowing linework shared with ghostship.
  glowStroke(ctx, path, color, u, alpha = 1) {
    for (const [w, a] of [[10, 0.05], [4, 0.12], [1.5, 0.8]]) {
      ctx.lineWidth = w * u;
      ctx.strokeStyle = rgba(color, a * alpha);
      ctx.stroke(path);
    }
  },

  drawRock(ctx, env) {
    const { u, palette } = env;
    const { rockX: x0, waterY: y0, rockW: W, rockH: H } = this;
    const at = ([x, y]) => [x0 + x * W, y0 + y * H];
    const rock = new Path2D();
    this.rockPts.forEach((pt, i) => (i ? rock.lineTo(...at(pt)) : rock.moveTo(...at(pt))));
    rock.closePath();
    for (const isl of this.islets) {
      const ix = x0 + isl.x * W, iw = isl.w * W, ih = isl.h * H;
      rock.moveTo(ix - iw, y0 + H * 0.2);
      for (let k = 0; k < 5; k++) rock.lineTo(ix - iw + ((k + 0.5) / 5) * iw * 2, y0 - ih * (0.5 + 0.5 * isl.j[k]) * Math.sin(((k + 0.5) / 5) * Math.PI));
      rock.lineTo(ix + iw, y0 + H * 0.2);
      rock.closePath();
    }
    ctx.globalCompositeOperation = 'source-over';
    const grad = ctx.createLinearGradient(0, y0 - H, 0, y0);
    grad.addColorStop(0, mix(palette.bg[0], palette.colors[0], 0.55));
    grad.addColorStop(1, palette.bg[0]);
    ctx.fillStyle = grad;
    ctx.fill(rock);

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    // Wet rock shines after a wave breaks over it.
    this.glowStroke(ctx, rock, palette.colors[1], u, 0.45 + 0.55 * this.wet);
    const cracks = new Path2D();
    for (const c of this.cracks) c.forEach((pt, i) => (i ? cracks.lineTo(...at(pt)) : cracks.moveTo(...at(pt))));
    ctx.lineWidth = 1.2 * u;
    ctx.strokeStyle = rgba(palette.colors[1], 0.25 + 0.4 * this.wet);
    ctx.stroke(cracks);
  },

  drawTower(ctx, env, lit) {
    const { u, palette } = env;
    const S = this.S;
    const x = this.rockX, base = this.waterY - this.rockH + S * 0.01;
    const T = S * 0.66, bw = S * 0.09, tw = S * 0.062;
    const top = base - T;
    const halfAt = (y) => bw + (tw - bw) * ((base - y) / T);

    // Tower body in bands, lit on the side the beam points to.
    ctx.globalCompositeOperation = 'source-over';
    const side = ctx.createLinearGradient(x - bw, 0, x + bw, 0);
    const dark = mix(palette.bg[0], palette.colors[0], 0.45), light = mix(palette.colors[0], palette.colors[1], 0.35 + 0.3 * this.pulse);
    side.addColorStop(0, lit < 0 ? light : dark);
    side.addColorStop(0.5, mix(dark, light, 0.4));
    side.addColorStop(1, lit > 0 ? light : dark);
    const bands = 5;
    for (let b = 0; b < bands; b++) {
      const ya = base - (b / bands) * T, yb = base - ((b + 1) / bands) * T;
      ctx.fillStyle = b % 2 ? rgba(palette.bg[0], 1) : side;
      ctx.beginPath();
      ctx.moveTo(x - halfAt(ya), ya);
      ctx.lineTo(x + halfAt(ya), ya);
      ctx.lineTo(x + halfAt(yb), yb);
      ctx.lineTo(x - halfAt(yb), yb);
      ctx.closePath();
      ctx.fill();
    }

    const lines = new Path2D();
    lines.moveTo(x - bw, base); lines.lineTo(x - tw, top); lines.lineTo(x + tw, top); lines.lineTo(x + bw, base);
    for (let b = 1; b < bands; b++) {
      const y = base - (b / bands) * T;
      lines.moveTo(x - halfAt(y), y); lines.lineTo(x + halfAt(y), y);
    }
    // Gallery and railing.
    const gw = tw * 1.55, gy = top - S * 0.012;
    lines.rect(x - gw, gy, gw * 2, S * 0.012);
    lines.moveTo(x - gw, gy - S * 0.035); lines.lineTo(x + gw, gy - S * 0.035);
    for (let k = 0; k <= 6; k++) { const px = x - gw + (k / 6) * gw * 2; lines.moveTo(px, gy); lines.lineTo(px, gy - S * 0.035); }
    // Lantern room, dome and finial.
    const lw = tw * 0.85, lh = S * 0.075, ly = gy - lh;
    lines.rect(x - lw, ly, lw * 2, lh);
    lines.moveTo(x - lw / 3, ly); lines.lineTo(x - lw / 3, gy);
    lines.moveTo(x + lw / 3, ly); lines.lineTo(x + lw / 3, gy);
    lines.moveTo(x - lw * 1.15, ly);
    lines.quadraticCurveTo(x, ly - S * 0.065, x + lw * 1.15, ly);
    lines.closePath();
    lines.moveTo(x, ly - S * 0.032); lines.lineTo(x, ly - S * 0.07);
    // Door.
    lines.moveTo(x - bw * 0.3, base); lines.lineTo(x - bw * 0.3, base - S * 0.05);
    lines.quadraticCurveTo(x, base - S * 0.07, x + bw * 0.3, base - S * 0.05);
    lines.lineTo(x + bw * 0.3, base);

    // Lantern glass filled with light, windows glowing up the tower.
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(palette.text, 0.35 + 0.5 * this.intensity);
    ctx.fillRect(x - lw, ly, lw * 2, lh);
    ctx.fillStyle = rgba(palette.accent, 0.3 + 0.5 * this.mid);
    for (let k = 1; k <= 3; k++) {
      const wy = base - T * (k / 4) - S * 0.012;
      ctx.fillRect(x - S * 0.008 + (k % 2 ? -1 : 1) * bw * 0.25, wy, S * 0.016, S * 0.026);
    }
    ctx.lineJoin = 'round';
    this.glowStroke(ctx, lines, palette.colors[2], u, 0.8);
    this.lamp = [x, ly + lh / 2];
  },

  // One beam of the lamp, at angle `a` around the tower (cos > 0 = right,
  // sin > 0 = towards the viewer).
  drawBeam(ctx, a, env) {
    const { width, palette } = env;
    const [lx, ly] = this.lamp;
    const dx = Math.cos(a), dz = Math.sin(a);
    const reach = Math.max(width, this.S * 3) * 0.75;
    const len = reach * Math.abs(dx);
    if (len < 4) return;
    const dir = Math.sign(dx);
    const ex = lx + dir * len, ey = ly + this.S * 0.04 * Math.abs(dx);
    const r1 = this.S * (0.26 + 0.14 * this.bass) * (0.4 + 0.6 * Math.abs(dx));
    // Brighter when it swings towards us.
    const a0 = this.intensity * (0.55 + 0.45 * Math.max(0, dz)) * (0.35 + 0.65 * Math.abs(dx));
    ctx.globalCompositeOperation = 'lighter';
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(Math.atan2(ey - ly, ex - lx));
    ctx.globalAlpha = clamp(a0 * 1.9);
    ctx.drawImage(this.beam, 0, -r1 * 1.5, Math.hypot(ex - lx, ey - ly), r1 * 3);
    ctx.restore();
    // Light on the water under the beam.
    const rows = 10;
    for (let i = 0; i < rows; i++) {
      const f = (i + 0.5) / rows;
      const x = lx + dir * len * (0.25 + 0.6 * f);
      const y = this.sea.y(Math.min(this.sea.anchor + 1, this.sea.layers - 1), x) + this.S * 0.03 * Math.sin(i * 2.1 + this.t * 3);
      const w = this.S * (0.08 + 0.2 * f) * (0.6 + 0.4 * Math.sin(this.t * 4 + i * 1.7));
      ctx.fillStyle = rgba(palette.text, a0 * 0.18 * (1 - f * 0.6));
      ctx.fillRect(x - w / 2, y, w, this.S * 0.006);
    }
  },

  draw(ctx, frame, env) {
    const { width, height, fps, u, cx, cy, palette, random, params: p } = env;
    const dt = 1 / fps;
    this.t += dt;
    const t = this.t;
    const S = this.S;
    this.pulse = frame.pulse;
    this.bass = frame.bass;
    this.mid = frame.mid;
    this.angle += dt * TAU * 0.16 * p.spin * (0.7 + 1.2 * frame.rms);
    this.intensity = p.light * (0.4 + 0.45 * frame.rms + 0.55 * frame.pulse);

    const sea = this.sea;
    sea.update(frame, dt);

    // A wave breaks on the rock: the water heaps up, spray and foam shoot up
    // the face, and the rock stays wet for a moment.
    const crash = frame.kick ? frame.kickStrength * p.crash : 0;
    if (crash > 0) {
      this.surgeV += crash * 6;
      this.wet = Math.min(1, this.wet + crash);
      const n = Math.round(90 * crash);
      for (let i = 0; i < n; i++) {
        const f = random() * 2 - 1;
        const x = this.rockX + f * this.rockW * 1.05;
        const up = (0.8 + random() * 1.4) * S * Math.sqrt(crash) * (1 - 0.45 * Math.abs(f));
        this.spray.push({ x, y: this.waterY, vx: (f * 0.7 + (random() - 0.5) * 0.6) * S * 0.6, vy: -up, life: 1, r: (1 + random() * 2.6) * u });
      }
      for (let i = 0; i < Math.round(14 * crash); i++) {
        const f = random() * 2 - 1;
        this.puffs.push({ x: this.rockX + f * this.rockW, y: this.waterY - random() * this.rockH * 0.4, vx: f * S * 0.15, vy: -(0.3 + random() * 0.7) * S * Math.sqrt(crash), r: S * (0.07 + random() * 0.09), life: 1 });
      }
    }
    this.surgeV += (-this.surge * 40 - this.surgeV * 7) * dt;
    this.surge += this.surgeV * dt;
    this.wet *= 0.9 ** (30 / fps);

    // Sky: stars and moon.
    const horizon = sea.y(0, cx);
    drawStars(ctx, this.stars, env, horizon, t, frame.high);
    const moonR = S * 0.09 * p.moon;
    const moonX = cx - Math.min(width * 0.32, S * 0.75);
    const moonY = Math.max(moonR * 2.5, horizon - S * 1.25);
    drawMoon(ctx, { x: moonX, y: moonY, r: moonR, halo: 0.25 + 0.2 * frame.bass, sprite: this.mist, palette });

    // Water and fog behind the rock.
    sea.drawBehind(ctx);
    const fog = { sprite: this.mist, size: S, horizon, waterY: this.waterY, amount: p.fog, rms: frame.rms, dt, env };
    drawFog(ctx, this.fogBanks, { ...fog, front: false });

    // The tower hides beams pointing away from us, so those go first.
    const beams = Array.from({ length: p.beams >= 2 ? 2 : 1 }, (_, i) => this.angle + i * Math.PI);
    this.lamp = [this.rockX, this.waterY - this.rockH - S * 0.66 - S * 0.06];
    for (const a of beams) if (Math.sin(a) < 0) this.drawBeam(ctx, a, env);
    this.drawRock(ctx, env);
    const lit = beams.reduce((s, a) => s + Math.cos(a) * (Math.sin(a) > 0 ? 1 : 0.4), 0);
    this.drawTower(ctx, env, lit);
    for (const a of beams) if (Math.sin(a) >= 0) this.drawBeam(ctx, a, env);

    // The lamp, flaring when a beam swings round to face us.
    const flare = Math.max(...beams.map((a) => Math.max(0, Math.sin(a)) ** 10));
    const [lx, ly] = this.lamp;
    ctx.globalCompositeOperation = 'lighter';
    for (const [r, alpha] of [[S * (0.1 + 0.08 * frame.pulse), 0.9], [S * (0.25 + 0.9 * flare), 0.35 + 0.5 * flare]]) {
      ctx.globalAlpha = clamp(alpha * this.intensity);
      ctx.drawImage(this.glow, lx - r, ly - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    if (flare > 0.05) {
      ctx.fillStyle = rgba(palette.colors[2], 0.12 * flare * this.intensity);
      ctx.fillRect(0, 0, width, height);
    }

    // Water at and in front of the rock.
    sea.drawFront(ctx);
    drawMoonlight(ctx, sea, { x: moonX, r: moonR, horizon, rows: 14, alpha: 0.07 + 0.08 * frame.bass, t, env });

    // Spray and foam from the breaking waves.
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.puffs) {
      f.life -= dt / 1.3;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += S * 0.5 * dt;
      const r = f.r * (1 + (1 - f.life) * 1.8);
      ctx.globalAlpha = clamp(f.life * 0.5);
      ctx.drawImage(this.foam, f.x - r, f.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    this.puffs = this.puffs.filter((f) => f.life > 0);
    for (const s of this.spray) {
      s.life -= dt / 1.4;
      s.vy += S * 2.2 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      ctx.fillStyle = rgba(palette.colors[2], clamp(s.life) * 0.85);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    this.spray = this.spray.filter((s) => s.life > 0 && s.y < this.waterY + S * 0.3);

    drawFog(ctx, this.fogBanks, { ...fog, front: true });

    // Rain, catching the light.
    drawRain(ctx, this.rain, env, dt, 0.18 + 0.15 * this.intensity);
    ctx.globalCompositeOperation = 'source-over';
  },
};
