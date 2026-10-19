import { Path2D } from 'skia-canvas';
import { mix, rgba } from '../palettes.js';
import { clamp, sampleWaveform } from '../util.js';

const TAU = Math.PI * 2;
const CHOP_POINTS = 48;   // waveform samples across the sea surface
const SEA_POINTS = 110;   // points per wave line

// The ship in ship units: length ≈ 1, origin on the waterline, -y is up.
const DECK = -0.12;
const MASTS = [
  { x: -0.22, h: 0.52, yards: [0.88, 0.58, 0.3], w: 0.1 },  // mizzen
  { x: 0.04, h: 0.7, yards: [0.9, 0.64, 0.36], w: 0.115 },  // main
  { x: 0.27, h: 0.5, yards: [0.86, 0.56, 0.28], w: 0.095 }, // fore
];
const BOWSPRIT = [[0.48, -0.19], [0.74, -0.34]];
const STERN_LANTERN = [-0.52, -0.3];
const BOW_LANTERN = [0.5, -0.25];

// Lantern / wisp glow, stamped with drawImage (cheaper than shadowBlur).
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

export default {
  name: 'ghostship',
  description: 'A translucent ghost galleon rocking on a moonlit sea whose surface is the soundwave itself',
  palette: 'spectral', // used when no -p is given
  params: {
    size: 1,        // ship size
    rock: 1,        // how much the ship pitches and bobs with the waves
    swell: 1,       // height of the slow swell (driven by the bass)
    chop: 1,        // how much of the raw waveform shows in the sea surface
    waves: 5,       // sea layers (2–6)
    speed: 1,       // how fast the swell rolls
    sails: 1,       // how tattered the sails are (0 = whole)
    flicker: 1,     // ghostly flicker and doubling on transients (0 = steady)
    echo: 1,        // fading ghosts of the ship rising off it on kicks (0 = off)
    wisps: 18,      // spirit lights rising from the deck (0 = off)
    spray: 1,       // spray thrown up on kicks (0 = off)
    fog: 1,         // fog banks drifting over the water (0 = off)
    moon: 1,        // moon size (0 = no moon)
    stars: 90,
    lightning: 1,   // chance of lightning on big hits (0 = off, 2 = stormy)
  },

  setup(ctx, env) {
    const { width, height, u, random, palette, params: p } = env;
    this.t = 0;
    this.phase = 0;
    this.chop = new Float32Array(CHOP_POINTS);
    this.peak = 0.05;
    this.S = Math.min(width * 0.44, height * 0.28) * p.size; // ship length in px
    this.ship = null; // position/angle springs, set on the first frame
    this.echoes = [];
    this.spray = [];
    this.wisps = [];
    this.glitch = 0;
    this.bolt = null;
    this.lastBolt = -10;
    this.stars = Array.from({ length: Math.round(p.stars) }, () => ({
      x: random(), y: random(), r: (0.6 + random() * 1.4) * u, phase: random() * TAU,
    }));
    this.fogBanks = Array.from({ length: 6 }, (_, i) => ({
      x: random() * 1.4 - 0.2, y: random(), speed: (0.008 + random() * 0.012) * (i % 2 ? 1 : -1), w: 1.6 + random() * 1.4,
    }));
    // Tatters: notches along the bottom of each sail and a few holes, fixed
    // per ship so they don't jump around.
    this.tatters = MASTS.map(() => [0, 1, 2].map(() => ({
      notches: Array.from({ length: 9 }, () => random()),
      holes: Array.from({ length: 3 }, () => ({ x: random() * 1.4 - 0.7, y: 0.25 + random() * 0.55, r: 0.05 + random() * 0.08, keep: random() })),
    })));
    this.jibNotches = Array.from({ length: 6 }, () => random());
    this.glow = glowSprite(env, palette.accent, 64 * u);
    this.mist = glowSprite(env, palette.colors[1], 128 * u);
  },

  // Height of sea layer `l` (0 = farthest) at screen x.
  seaY(l, x, env) {
    const { width, params: p } = env;
    const n = this.layers, d = n > 1 ? l / (n - 1) : 1;
    const k = this.shipLayer;
    // Far layers bunch up towards the horizon, near ones spread to the bottom.
    const base = l <= k
      ? this.waterY - (k - l) * this.S * 0.07
      : this.waterY + ((l - k) / Math.max(1, n - 1 - k)) ** 1.3 * Math.min(env.height * 0.92 - this.waterY, this.S * 0.85);
    const amp = this.S * 0.07 * (0.4 + 1.1 * d) * p.swell * (0.45 + 1.1 * this.bass);
    const ph = this.phase * (0.7 + 0.5 * d) + l * 1.9;
    const swell = Math.sin((x / width) * TAU * 1.1 + ph) * 0.6
      + Math.sin((x / width) * TAU * 2.3 - ph * 1.3 + l) * 0.3
      + Math.sin((x / width) * TAU * 4.7 + ph * 1.7 + l * 3) * 0.1;
    // The waveform itself, shifted per layer so the layers don't match.
    const cx = ((x / width) * (CHOP_POINTS - 1) + l * 11) % (CHOP_POINTS - 1);
    const i = Math.floor(cx);
    const wave = this.chop[i] + (this.chop[i + 1] - this.chop[i]) * (cx - i);
    const chopAmp = this.S * (l === this.shipLayer ? 0.1 : 0.04 + 0.06 * d) * p.chop;
    return base + swell * amp + wave * chopAmp;
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

    // Far water is paler (haze), near water darker but slightly see-through,
    // so the ghost ship shows faintly under the surface.
    const top = this.seaY(l, 0, env) - this.S * 0.15;
    const grad = ctx.createLinearGradient(0, top, 0, height);
    grad.addColorStop(0, rgba(mix(palette.bg[1], palette.colors[0], 0.75 - 0.4 * d), 0.97 - 0.1 * d));
    grad.addColorStop(1, rgba(palette.bg[0], 0.98));
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = grad;
    ctx.fill(body);

    // Glowing crest: a wide faint halo under a thin bright line.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    const crest = l === this.shipLayer ? palette.colors[2] : palette.colors[1];
    const lift = 0.5 + 0.5 * this.pulse;
    ctx.strokeStyle = rgba(crest, (0.05 + 0.08 * d) * lift);
    ctx.lineWidth = (10 + 8 * d) * u;
    ctx.stroke(line);
    ctx.strokeStyle = rgba(crest, (0.3 + 0.55 * d) * (0.6 + 0.4 * lift));
    ctx.lineWidth = (1.2 + 1.6 * d) * u;
    ctx.stroke(line);
  },

  // Builds the ship's paths for this frame (sails move, so they're rebuilt).
  buildShip(p, frame) {
    const t = this.t;
    const hull = new Path2D();
    hull.moveTo(-0.5, -0.26);
    hull.lineTo(-0.33, -0.24);
    hull.lineTo(-0.31, -0.14);
    hull.quadraticCurveTo(0, -0.1, 0.27, -0.13);
    hull.lineTo(0.36, -0.18);
    hull.lineTo(0.5, -0.21);
    hull.quadraticCurveTo(0.47, 0, 0.3, 0.09);
    hull.quadraticCurveTo(-0.05, 0.13, -0.38, 0.07);
    hull.lineTo(-0.45, 0);
    hull.closePath();

    // Lines: planks, rails, masts, yards, rigging, bowsprit.
    const lines = new Path2D();
    lines.moveTo(-0.46, -0.02); lines.quadraticCurveTo(0, 0.02, 0.45, -0.07);
    lines.moveTo(-0.42, 0.04); lines.quadraticCurveTo(0, 0.08, 0.38, 0.03);
    lines.moveTo(-0.5, -0.31); lines.lineTo(-0.33, -0.29);             // stern rail
    lines.moveTo(0.36, -0.22); lines.lineTo(0.5, -0.25);               // bow rail
    for (let x = -0.49; x <= -0.34; x += 0.05) { lines.moveTo(x, -0.255); lines.lineTo(x, -0.305); }
    lines.moveTo(...BOWSPRIT[0]); lines.lineTo(...BOWSPRIT[1]);
    const tops = MASTS.map((m) => [m.x, DECK - m.h]);
    for (const [i, m] of MASTS.entries()) {
      lines.moveTo(m.x, DECK + 0.02); lines.lineTo(m.x, DECK - m.h);
      for (const f of m.yards) {
        const y = DECK - m.h * f, w = m.w * (1.15 - f * 0.35);
        lines.moveTo(m.x - w, y); lines.lineTo(m.x + w, y);
      }
      // Shrouds down to the rails.
      lines.moveTo(m.x, DECK - m.h * 0.92); lines.lineTo(m.x - 0.07, DECK + 0.005);
      lines.moveTo(m.x, DECK - m.h * 0.92); lines.lineTo(m.x + 0.07, DECK + 0.005);
      // Stays to the next mast forward (or the bowsprit / stern).
      const fwd = i < MASTS.length - 1 ? [MASTS[i + 1].x, DECK - 0.03] : BOWSPRIT[1];
      lines.moveTo(...tops[i]); lines.lineTo(...fwd);
    }
    lines.moveTo(...tops[0]); lines.lineTo(-0.5, -0.27);

    // Sails, billowing with the mids and fluttering with the highs.
    const sails = new Path2D();
    const tatter = p.sails;
    for (const [i, m] of MASTS.entries()) {
      for (let j = 0; j < m.yards.length; j++) {
        const f = m.yards[j], fb = (m.yards[j + 1] ?? 0.04) + 0.03;
        const yt = DECK - m.h * f, yb = DECK - m.h * fb;
        const wt = m.w * (1.15 - f * 0.35), wb = m.w * (1.15 - fb * 0.35) * 1.05;
        const sway = 0.012 * Math.sin(t * 1.3 + i + j) + 0.025 * this.mid;
        const belly = 0.03 + 0.04 * this.mid;
        const tat = this.tatters[i][j];
        sails.moveTo(m.x - wt, yt);
        sails.lineTo(m.x + wt, yt);
        sails.quadraticCurveTo(m.x + wb + belly, (yt + yb) / 2, m.x + wb + sway, yb);
        // Ragged bottom edge.
        const N = tat.notches.length;
        for (let k = 1; k <= N; k++) {
          const a = k / (N + 1);
          const x = m.x + wb + sway - a * 2 * wb;
          const flutter = Math.sin(t * 9 + k * 1.7 + i * 3 + j) * 0.012 * frame.high;
          const notch = (k % 2 ? 1 : 0.35) * tat.notches[k - 1] * 0.09 * tatter * (yb - yt);
          sails.lineTo(x, yb - notch + flutter);
        }
        sails.lineTo(m.x - wb + sway, yb);
        sails.quadraticCurveTo(m.x - wb - belly * 0.4, (yt + yb) / 2, m.x - wt, yt);
        sails.closePath();
        // Holes (filled even-odd, so they cut through).
        for (const h of tat.holes) {
          if (h.keep > tatter * 0.8) continue;
          const hx = m.x + h.x * wt, hy = yt + h.y * (yb - yt), r = h.r * (yb - yt) * 0.7;
          sails.moveTo(hx + r, hy);
          for (let k = 1; k <= 5; k++) {
            const a = (k / 5) * TAU, rr = r * (0.6 + 0.4 * ((k * 7) % 3) / 2);
            sails.lineTo(hx + Math.cos(a) * rr, hy + Math.sin(a) * rr * 0.8);
          }
          sails.closePath();
        }
      }
    }
    // Jib from the foremast to the bowsprit.
    const fore = MASTS[2];
    const jibTop = [fore.x + 0.01, DECK - fore.h * 0.8];
    sails.moveTo(...jibTop);
    sails.quadraticCurveTo(0.6 + 0.03 * this.mid, -0.4, BOWSPRIT[1][0] - 0.02, BOWSPRIT[1][1] + 0.01);
    for (let k = 1; k <= this.jibNotches.length; k++) {
      const a = k / (this.jibNotches.length + 1);
      const x = BOWSPRIT[1][0] - 0.02 + (0.42 - BOWSPRIT[1][0] + 0.02) * a;
      const y = BOWSPRIT[1][1] + 0.01 + (-0.2 - BOWSPRIT[1][1]) * a;
      sails.lineTo(x - this.jibNotches[k - 1] * 0.03 * tatter * (k % 2), y - this.jibNotches[k - 1] * 0.02 * tatter);
    }
    sails.lineTo(0.42, -0.2);
    sails.closePath();

    // Torn pennant on the mainmast, streaming back.
    const flag = new Path2D();
    const [fx, fy] = tops[1];
    flag.moveTo(fx, fy);
    const segs = 8, len = 0.17;
    const wave = (k) => Math.sin(t * 6 - k * 0.9) * 0.012 * (k / segs) * (1 + frame.high);
    for (let k = 1; k <= segs; k++) flag.lineTo(fx - (k / segs) * len, fy + wave(k) - 0.004 * k);
    for (let k = segs; k >= 0; k--) flag.lineTo(fx - (k / segs) * len * (k === segs ? 0.85 : 1), fy + 0.035 * (1 - (k / segs) * 0.7) + wave(k));
    flag.closePath();

    // Gunports along the hull.
    const ports = new Path2D();
    for (let k = 0; k < 6; k++) {
      const x = -0.26 + k * 0.1, y = -0.07 + Math.abs(k - 2.5) * 0.004;
      ports.rect(x - 0.016, y - 0.014, 0.032, 0.028);
    }
    // Stern windows.
    for (let k = 0; k < 3; k++) ports.rect(-0.485 + k * 0.045, -0.215, 0.03, 0.04);

    return { hull, lines, sails, flag, ports };
  },

  drawShip(ctx, ship, env, alpha, outlineOnly = false) {
    const { u, palette } = env;
    const k = 1 / this.S; // px → ship units
    const ghost = palette.colors[2];
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (!outlineOnly) {
      // Hull: dark and mostly solid, lit from the moon side.
      ctx.globalCompositeOperation = 'source-over';
      const grad = ctx.createLinearGradient(0, -0.3, 0, 0.12);
      grad.addColorStop(0, rgba(mix(palette.bg[0], palette.colors[0], 0.6), 0.85 * alpha));
      grad.addColorStop(1, rgba(palette.bg[0], 0.75 * alpha));
      ctx.fillStyle = grad;
      ctx.fill(ship.hull);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(ghost, (0.07 + 0.08 * this.pulse) * alpha);
      ctx.fill(ship.sails, 'evenodd');
      ctx.fillStyle = rgba(ghost, 0.12 * alpha);
      ctx.fill(ship.flag);
      ctx.fillStyle = rgba(palette.accent, (0.35 + 0.5 * this.mid + 0.3 * this.pulse) * alpha);
      ctx.fill(ship.ports);
    }
    ctx.globalCompositeOperation = 'lighter';
    // Halo, then core, for every outline.
    for (const [w, a] of outlineOnly ? [[6, 0.1], [1.4, 0.6]] : [[12, 0.05], [5, 0.12], [1.6, 0.85]]) {
      ctx.lineWidth = w * u * k;
      ctx.strokeStyle = rgba(ghost, a * alpha);
      ctx.stroke(ship.hull);
      ctx.stroke(ship.sails);
      ctx.stroke(ship.flag);
      ctx.lineWidth = w * u * k * 0.6;
      ctx.stroke(ship.lines);
    }
  },

  // Ship-local point → screen.
  toWorld(lx, ly, pose) {
    const c = Math.cos(pose.a), s = Math.sin(pose.a);
    return [pose.x + (lx * c - ly * s) * pose.scale, pose.y + (lx * s + ly * c) * pose.scale];
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
    this.shipLayer = Math.max(0, Math.min(this.layers - 1, Math.round((this.layers - 1) * 0.4)));
    this.waterY = cy + S * 0.22;
    this.phase += dt * p.speed * (0.9 + 1.6 * frame.rms);

    // Sea surface from the waveform: normalised to its recent peak and eased
    // between frames so it rolls instead of buzzing.
    const raw = sampleWaveform(frame.waveform, CHOP_POINTS);
    let peak = 0;
    for (const v of raw) peak = Math.max(peak, Math.abs(v));
    this.peak = Math.max(this.peak * 0.995, peak, 0.02);
    for (let i = 0; i < CHOP_POINTS; i++) {
      const edge = Math.min(1, i / 4, (CHOP_POINTS - 1 - i) / 4);
      this.chop[i] += ((raw[i] / this.peak) * edge - this.chop[i]) * 0.45;
    }

    // Sky: stars and moon.
    const horizon = this.seaY(0, cx, env);
    for (const s of this.stars) {
      const y = s.y * horizon * 0.95;
      const tw = 0.35 + 0.35 * Math.sin(t * 2.2 + s.phase) + 0.4 * frame.high;
      ctx.fillStyle = rgba(palette.text, clamp(tw) * 0.8);
      ctx.fillRect(s.x * width, y, s.r, s.r);
    }
    const moonR = S * 0.11 * p.moon;
    const moonX = cx + Math.min(width * 0.3, S * 0.65);
    const moonY = Math.max(moonR * 2.2, cy - S * 0.78);
    if (moonR > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + 0.3 * frame.bass;
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
      ctx.fillStyle = rgba(palette.colors[0], 0.25);
      for (const [dx, dy, r] of [[-0.3, -0.2, 0.22], [0.25, 0.1, 0.16], [-0.05, 0.4, 0.12], [0.35, -0.35, 0.09]]) {
        ctx.beginPath();
        ctx.arc(moonX + dx * moonR, moonY + dy * moonR, r * moonR, 0, TAU);
        ctx.fill();
      }
    }

    // Lightning: a bolt behind the sea and a flash over everything.
    if (p.lightning > 0 && frame.onset && frame.onsetStrength > 0.6 && t - this.lastBolt > 5 / p.lightning && random() < 0.3 * p.lightning) {
      this.lastBolt = t;
      const pts = [];
      let x = width * (0.1 + random() * 0.8), y = 0;
      while (y < horizon) {
        pts.push([x, y]);
        y += (20 + random() * 50) * u;
        x += (random() - 0.5) * 70 * u;
      }
      pts.push([x, horizon]);
      this.bolt = { pts, life: 1 };
    }
    if (this.bolt) {
      const b = this.bolt;
      const on = b.life > 0.6 || Math.sin(b.life * 40) > 0;
      if (on) {
        const path = new Path2D();
        b.pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = rgba(palette.colors[2], 0.15 * b.life);
        ctx.lineWidth = 14 * u;
        ctx.stroke(path);
        ctx.strokeStyle = rgba('#ffffff', 0.9 * b.life);
        ctx.lineWidth = 2 * u;
        ctx.stroke(path);
      }
    }

    // Ship pose: springs towards the sea's height and slope under the hull,
    // with a kick knocking it down and over.
    const shipX = cx + Math.sin(t * 0.09) * width * 0.04;
    const half = S * 0.4;
    const yA = this.seaY(this.shipLayer, shipX - half, env), yB = this.seaY(this.shipLayer, shipX + half, env);
    const yMid = this.seaY(this.shipLayer, shipX, env);
    const targetY = (yA + yB + yMid * 2) / 4 - S * 0.015;
    const targetA = clamp(Math.atan2(yB - yA, half * 2) * 1.6 * p.rock, -0.5, 0.5);
    if (!this.ship) this.ship = { y: targetY, vy: 0, a: targetA, va: 0, side: 1 };
    const sh = this.ship;
    if (frame.kick) {
      sh.vy += frame.kickStrength * S * 0.5 * p.rock;
      sh.va += frame.kickStrength * 1.1 * p.rock * sh.side;
      sh.side = -sh.side;
    }
    sh.va += ((targetA - sh.a) * 22 - sh.va * 4) * dt;
    sh.a = clamp(sh.a + sh.va * dt, -0.6, 0.6);
    sh.vy += ((targetY - sh.y) * 30 - sh.vy * 6) * dt;
    sh.y += sh.vy * dt;
    const pose = { x: shipX, y: sh.y, a: sh.a, scale: S };

    // Water behind the ship.
    for (let l = 0; l < this.shipLayer; l++) this.drawLayer(ctx, l, env);

    // Fog behind the ship.
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
    drawFog(false);

    // Ghost ship: echoes, flicker, a doubled copy on transients.
    const shipPaths = this.buildShip(p, frame);
    if (frame.kick && p.echo > 0) {
      this.echoes.push({ x: pose.x, y: pose.y, a: pose.a, life: 1 });
      if (this.echoes.length > 3) this.echoes.shift();
    }
    for (const e of this.echoes) {
      e.life -= dt / 1.1;
      const age = 1 - e.life;
      ctx.save();
      ctx.translate(e.x, e.y - age * S * 0.35);
      ctx.rotate(e.a * (1 - age));
      ctx.scale(S * (1 + age * 0.15), S * (1 + age * 0.15));
      this.drawShip(ctx, shipPaths, env, e.life ** 2 * 0.22 * p.echo, true);
      ctx.restore();
    }
    this.echoes = this.echoes.filter((e) => e.life > 0);

    if (frame.onset) this.glitch = Math.max(this.glitch, frame.onsetStrength * p.flicker);
    this.glitch *= 0.82 ** (30 / fps);
    const flicker = 1 - p.flicker * (0.12 * (0.5 + 0.5 * Math.sin(t * 23) * Math.sin(t * 7.3)) + 0.35 * this.glitch);
    if (this.glitch > 0.05) {
      ctx.save();
      ctx.translate(pose.x + this.glitch * 28 * u, pose.y - this.glitch * 6 * u);
      ctx.rotate(pose.a);
      ctx.scale(S, S);
      this.drawShip(ctx, shipPaths, env, this.glitch * 0.5, true);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.a);
    ctx.scale(S, S);
    this.drawShip(ctx, shipPaths, env, flicker);
    ctx.restore();

    // Lanterns.
    ctx.globalCompositeOperation = 'lighter';
    for (const [lx, ly] of [STERN_LANTERN, BOW_LANTERN]) {
      const [x, y] = this.toWorld(lx, ly, pose);
      const r = S * (0.07 + 0.05 * frame.pulse);
      ctx.globalAlpha = clamp((0.6 + 0.4 * frame.mid) * flicker);
      ctx.drawImage(this.glow, x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;

    // Spirit wisps drifting up off the deck.
    if (p.wisps > 0 && this.wisps.length < p.wisps && random() < dt * p.wisps * (0.3 + frame.rms)) {
      const [x, y] = this.toWorld(-0.4 + random() * 0.8, DECK - random() * 0.1, pose);
      this.wisps.push({ x, y, vx: (random() - 0.5) * 20 * u, vy: -(25 + random() * 40) * u, life: 1, phase: random() * TAU, size: (8 + random() * 14) * u });
    }
    for (const w of this.wisps) {
      w.life -= dt / 4;
      w.x += (w.vx + Math.sin(t * 1.5 + w.phase) * 25 * u) * dt;
      w.y += w.vy * dt * (1 + frame.pulse);
      const r = w.size * (1 + 0.5 * frame.pulse);
      ctx.globalAlpha = clamp(Math.sin(w.life * Math.PI) * 0.8);
      ctx.drawImage(this.glow, w.x - r, w.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    this.wisps = this.wisps.filter((w) => w.life > 0);

    // Water at and in front of the ship.
    for (let l = this.shipLayer; l < this.layers; l++) this.drawLayer(ctx, l, env);

    // Moonlight on the water: broken streaks under the moon.
    if (moonR > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const rows = 16;
      for (let i = 0; i < rows; i++) {
        const a = i / rows;
        const y = horizon + S * 0.03 + a * (height - horizon) * 0.8;
        const wob = Math.sin(t * 2 + i * 1.7) * 10 * u + this.chop[(i * 3) % CHOP_POINTS] * 12 * u;
        const w = moonR * (0.4 + a * 1.6) * (0.6 + 0.4 * Math.sin(t * 3 + i * 2.3));
        ctx.fillStyle = rgba(palette.text, (0.1 + 0.12 * frame.bass) * (1 - a * 0.7));
        ctx.fillRect(moonX + wob - w / 2, y, w, (1.5 + a * 2.5) * u);
      }
    }

    // Spray off the bow and crest on kicks.
    if (frame.kick && p.spray > 0) {
      const n = Math.round(14 * p.spray * frame.kickStrength);
      for (let i = 0; i < n; i++) {
        const [x, y] = this.toWorld(0.2 + random() * 0.35, 0.02, pose);
        this.spray.push({ x, y, vx: (random() * 1.4 - 0.4) * S * 0.6, vy: -(0.4 + random() * 0.9) * S, life: 1, r: (1 + random() * 2.2) * u });
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.spray) {
      s.life -= dt / 1.1;
      s.vy += S * 2.4 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      ctx.fillStyle = rgba(palette.colors[2], clamp(s.life) * 0.8);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    this.spray = this.spray.filter((s) => s.life > 0 && s.y < height);

    drawFog(true);

    if (this.bolt) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(palette.colors[2], 0.22 * this.bolt.life ** 2);
      ctx.fillRect(0, 0, width, height);
      this.bolt.life -= dt / 0.45;
      if (this.bolt.life <= 0) this.bolt = null;
    }
    ctx.globalCompositeOperation = 'source-over';
  },
};
