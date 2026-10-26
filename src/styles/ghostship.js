import { Path2D } from 'skia-canvas';
import { mix, rgba } from '../palettes.js';
import { clamp } from '../util.js';
import { Sea, Lightning, glowSprite, makeStars, drawStars, makeFog, drawFog, drawMoon, drawMoonlight } from '../sea.js';

const TAU = Math.PI * 2;

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

export default {
  name: 'ghostship',
  description: 'A translucent ghost galleon rocking on a moonlit sea whose surface is the soundwave itself',
  palette: 'spectral', // used when no -p is given
  // With --auto: settings scaled in calm parts, builds and drops (see modulate.js).
  sections: {
    calm: { rock: 0.7, flicker: 0.4, echo: 0.5, spray: 0.5, fog: 1.3, lightning: 0.3 },
    build: { rock: 0.9, flicker: 0.8 },
    drop: { rock: 1.3, flicker: 1.5, echo: 1.5, spray: 1.6, fog: 0.8, lightning: 2 },
  },
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
    this.S = Math.min(width * 0.44, height * 0.28) * p.size; // ship length in px
    this.sea = new Sea(env, { size: this.S, waterY: env.cy + this.S * 0.22 });
    this.lightning = new Lightning(env);
    this.ship = null; // position/angle springs, set on the first frame
    this.echoes = [];
    this.spray = [];
    this.wisps = [];
    this.glitch = 0;
    this.stars = makeStars(random, p.stars, u);
    this.fogBanks = makeFog(random);
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
    this.mid = frame.mid;
    const sea = this.sea;
    sea.update(frame, dt, p.speed);

    // Sky: stars and moon.
    const horizon = sea.y(0, cx);
    drawStars(ctx, this.stars, env, horizon, t, frame.high);
    const moonR = S * 0.11 * p.moon;
    const moonX = cx + Math.min(width * 0.3, S * 0.65);
    const moonY = Math.max(moonR * 2.2, cy - S * 0.78);
    drawMoon(ctx, { x: moonX, y: moonY, r: moonR, halo: 0.35 + 0.3 * frame.bass, craters: true, sprite: this.mist, palette });

    // Lightning: a bolt behind the sea and a flash over everything.
    this.lightning.strike(frame, t, horizon, p.lightning);
    this.lightning.drawBolt(ctx);

    // Ship pose: springs towards the sea's height and slope under the hull,
    // with a kick knocking it down and over.
    const shipX = cx + Math.sin(t * 0.09) * width * 0.04;
    const half = S * 0.4;
    const yA = sea.y(sea.anchor, shipX - half), yB = sea.y(sea.anchor, shipX + half);
    const yMid = sea.y(sea.anchor, shipX);
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
    sea.drawBehind(ctx);
    const fog = { sprite: this.mist, size: S, horizon, waterY: sea.waterY, amount: p.fog, rms: frame.rms, dt, env };
    drawFog(ctx, this.fogBanks, { ...fog, front: false });

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
    sea.drawFront(ctx);
    drawMoonlight(ctx, sea, { x: moonX, r: moonR, horizon, rows: 16, alpha: 0.1 + 0.12 * frame.bass, t, env });

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

    drawFog(ctx, this.fogBanks, { ...fog, front: true });
    this.lightning.drawFlash(ctx, dt);
    ctx.globalCompositeOperation = 'source-over';
  },
};
