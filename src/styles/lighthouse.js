import { Path2D } from 'skia-canvas';
import { hexToRgb, mix, rgba } from '../palettes.js';
import { clamp, sampleWaveform } from '../util.js';

const TAU = Math.PI * 2;
const CHOP_POINTS = 48;   // waveform samples across the sea surface
const SEA_POINTS = 110;   // points per wave line

// Soft glow dot, stamped with drawImage (cheaper than shadowBlur).
function glowSprite(env, color, size) {
  const s = Math.round(size);
  const c = env.createCanvas(s * 2, s * 2);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s, s, 0, s, s, s);
  grad.addColorStop(0, rgba(color, 1));
  grad.addColorStop(0.2, rgba(color, 0.4));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, s * 2, s * 2);
  return c;
}

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
    this.phase = 0;
    this.angle = 0.6; // beam direction around the tower, 0 = pointing right
    this.chop = new Float32Array(CHOP_POINTS);
    this.peak = 0.05;
    this.S = Math.min(width * 0.5, height * 0.34) * p.size;
    this.surge = 0;
    this.surgeV = 0;
    this.wet = 0;
    this.spray = [];
    this.puffs = [];
    this.stars = Array.from({ length: Math.round(p.stars) }, () => ({
      x: random(), y: random(), r: (0.6 + random() * 1.4) * u, phase: random() * TAU,
    }));
    this.fogBanks = Array.from({ length: 6 }, (_, i) => ({
      x: random() * 1.4 - 0.2, y: random(), speed: (0.008 + random() * 0.012) * (i % 2 ? 1 : -1), w: 1.6 + random() * 1.4,
    }));
    this.rain = Array.from({ length: Math.round(160 * p.rain) }, () => ({ x: random(), y: random(), v: 0.8 + random() * 0.6 }));

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

  // Height of sea layer `l` (0 = farthest) at screen x.
  seaY(l, x, env) {
    const { width, height, params: p } = env;
    const n = this.layers, d = n > 1 ? l / (n - 1) : 1, k = this.rockLayer;
    // Far layers bunch up towards the horizon, near ones spread to the bottom.
    const base = l <= k
      ? this.waterY - (k - l) * this.S * 0.07
      : this.waterY + ((l - k) / Math.max(1, n - 1 - k)) ** 1.3 * Math.min(height * 0.92 - this.waterY, this.S * 0.85);
    const amp = this.S * 0.07 * (0.4 + 1.1 * d) * p.swell * (0.45 + 1.1 * this.bass);
    const ph = this.phase * (0.7 + 0.5 * d) + l * 1.9;
    const swell = Math.sin((x / width) * TAU * 1.1 + ph) * 0.6
      + Math.sin((x / width) * TAU * 2.3 - ph * 1.3 + l) * 0.3
      + Math.sin((x / width) * TAU * 4.7 + ph * 1.7 + l * 3) * 0.1;
    // The waveform itself, shifted per layer so the layers don't match.
    const cx = ((x / width) * (CHOP_POINTS - 1) + l * 11) % (CHOP_POINTS - 1);
    const i = Math.floor(cx);
    const wave = this.chop[i] + (this.chop[i + 1] - this.chop[i]) * (cx - i);
    const chopAmp = this.S * (l === k ? 0.08 : 0.04 + 0.06 * d) * p.chop;
    // Water heaping up against the rock after a crash.
    const near = l >= k ? Math.exp(-(((x - this.rockX) / (this.rockW * (1.1 + 0.4 * (l - k)))) ** 2)) : 0;
    return base + swell * amp + wave * chopAmp - this.surge * near * this.S * 0.16 / (1 + (l - k) * 0.6);
  },

  drawLayer(ctx, l, env) {
    const { width, height, u, palette } = env;
    const n = this.layers, d = n > 1 ? l / (n - 1) : 1;
    const line = new Path2D();
    for (let i = 0; i <= SEA_POINTS; i++) {
      const x = (i / SEA_POINTS) * (width + 40 * u) - 20 * u;
      const y = this.seaY(l, x, env);
      i ? line.lineTo(x, y) : line.moveTo(x, y);
    }
    const body = new Path2D(line);
    body.lineTo(width + 20 * u, height);
    body.lineTo(-20 * u, height);
    body.closePath();

    const top = this.seaY(l, 0, env) - this.S * 0.15;
    const grad = ctx.createLinearGradient(0, top, 0, height);
    grad.addColorStop(0, rgba(mix(palette.bg[1], palette.colors[0], 0.75 - 0.4 * d), 0.97 - 0.06 * d));
    grad.addColorStop(1, rgba(palette.bg[0], 0.98));
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = grad;
    ctx.fill(body);

    // Glowing crest: a wide faint halo under a thin bright line.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    const crest = l === this.rockLayer ? palette.colors[2] : palette.colors[1];
    const lift = 0.5 + 0.5 * this.pulse;
    ctx.strokeStyle = rgba(crest, (0.05 + 0.08 * d) * lift);
    ctx.lineWidth = (10 + 8 * d) * u;
    ctx.stroke(line);
    ctx.strokeStyle = rgba(crest, (0.3 + 0.55 * d) * (0.6 + 0.4 * lift));
    ctx.lineWidth = (1.2 + 1.6 * d) * u;
    ctx.stroke(line);
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
      const y = this.seaY(this.rockLayer + 1 < this.layers ? this.rockLayer + 1 : this.rockLayer, x, env) + this.S * 0.03 * Math.sin(i * 2.1 + this.t * 3);
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
    this.layers = Math.max(2, Math.min(6, Math.round(p.waves)));
    this.rockLayer = Math.max(0, Math.min(this.layers - 1, Math.round((this.layers - 1) * 0.4)));
    this.rockX = cx;
    this.rockW = S * 0.55;
    this.rockH = S * 0.4;
    this.waterY = cy + S * 0.62;
    this.phase += dt * (0.9 + 1.6 * frame.rms);
    this.angle += dt * TAU * 0.16 * p.spin * (0.7 + 1.2 * frame.rms);
    this.intensity = p.light * (0.4 + 0.45 * frame.rms + 0.55 * frame.pulse);

    // Sea surface from the waveform, normalised to its recent peak and eased.
    const raw = sampleWaveform(frame.waveform, CHOP_POINTS);
    let peak = 0;
    for (const v of raw) peak = Math.max(peak, Math.abs(v));
    this.peak = Math.max(this.peak * 0.995, peak, 0.02);
    for (let i = 0; i < CHOP_POINTS; i++) {
      const edge = Math.min(1, i / 4, (CHOP_POINTS - 1 - i) / 4);
      this.chop[i] += ((raw[i] / this.peak) * edge - this.chop[i]) * 0.45;
    }

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
    const horizon = this.seaY(0, cx, env);
    for (const s of this.stars) {
      const tw = 0.35 + 0.35 * Math.sin(t * 2.2 + s.phase) + 0.4 * frame.high;
      ctx.fillStyle = rgba(palette.text, clamp(tw) * 0.8);
      ctx.fillRect(s.x * width, s.y * horizon * 0.95, s.r, s.r);
    }
    const moonR = S * 0.09 * p.moon;
    const moonX = cx - Math.min(width * 0.32, S * 0.75);
    const moonY = Math.max(moonR * 2.5, horizon - S * 1.25);
    if (moonR > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25 + 0.2 * frame.bass;
      const g = moonR * 7;
      ctx.drawImage(this.mist, moonX - g, moonY - g, g * 2, g * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      const mg = ctx.createRadialGradient(moonX - moonR * 0.3, moonY - moonR * 0.3, 0, moonX, moonY, moonR);
      mg.addColorStop(0, mix(palette.text, '#ffffff', 0.5));
      mg.addColorStop(1, mix(palette.text, palette.colors[1], 0.35));
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(moonX, moonY, moonR, 0, TAU);
      ctx.fill();
    }

    const drawFog = (front) => {
      if (p.fog <= 0) return;
      ctx.globalCompositeOperation = 'lighter';
      for (const [i, f] of this.fogBanks.entries()) {
        if ((i % 3 === 0) !== front) continue;
        f.x += f.speed * dt * (1 + frame.rms);
        if (f.x > 1.6) f.x = -0.6;
        if (f.x < -0.6) f.x = 1.6;
        const w = S * f.w, h = S * (front ? 0.22 : 0.3);
        const y = front ? height - (height - this.waterY) * (0.25 + f.y * 0.3) : horizon - S * 0.05 + f.y * S * 0.18;
        ctx.globalAlpha = clamp((front ? 0.12 : 0.18) * p.fog * (0.6 + 0.6 * frame.rms));
        ctx.drawImage(this.mist, f.x * width - w / 2, y - h / 2, w, h);
      }
      ctx.globalAlpha = 1;
    };

    // Water and fog behind the rock.
    for (let l = 0; l < this.rockLayer; l++) this.drawLayer(ctx, l, env);
    drawFog(false);

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
    for (let l = this.rockLayer; l < this.layers; l++) this.drawLayer(ctx, l, env);

    // Moonlight on the water.
    if (moonR > 0) {
      for (let i = 0; i < 14; i++) {
        const a = i / 14;
        const y = horizon + S * 0.03 + a * (height - horizon) * 0.8;
        const wob = Math.sin(t * 2 + i * 1.7) * 10 * u + this.chop[(i * 3) % CHOP_POINTS] * 12 * u;
        const w = moonR * (0.4 + a * 1.6) * (0.6 + 0.4 * Math.sin(t * 3 + i * 2.3));
        ctx.fillStyle = rgba(palette.text, (0.07 + 0.08 * frame.bass) * (1 - a * 0.7));
        ctx.fillRect(moonX + wob - w / 2, y, w, (1.5 + a * 2.5) * u);
      }
    }

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

    drawFog(true);

    // Rain, slanting and catching the light.
    if (this.rain.length) {
      ctx.strokeStyle = rgba(palette.text, 0.18 + 0.15 * this.intensity);
      ctx.lineWidth = 1.2 * u;
      ctx.beginPath();
      for (const r of this.rain) {
        r.y += dt * r.v * 1.6;
        r.x -= dt * r.v * 0.25;
        if (r.y > 1) { r.y -= 1; r.x = (r.x + 0.37) % 1; }
        if (r.x < 0) r.x += 1;
        const x = r.x * width, y = r.y * height;
        ctx.moveTo(x, y);
        ctx.lineTo(x + 6 * u, y - 26 * u);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  },
};
