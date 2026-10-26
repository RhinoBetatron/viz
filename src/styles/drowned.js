import { Path2D } from 'skia-canvas';
import { mix, rgba } from '../palettes.js';
import { clamp } from '../util.js';
import { Sea, glowSprite } from '../sea.js';
import { runes, centerpieces, addGlyph } from '../glyphs.js';
import { drawSurface, shaftSprite, makeShafts, drawShafts, Bubbles, makeSnow, drawSnow } from '../underwater.js';

const TAU = Math.PI * 2;
const CYCLE = ['pentagram', 'eye', 'hexagram', 'leviathan', 'heptagram', 'triplemoon', 'inverted', 'octagram'];

// Gothic pointed arch from (x - w, base) up to its tip and back down.
function addArch(path, x, base, w, h, springAt = 0.55) {
  const spring = base - h * springAt; // where the sides start to curve in
  path.moveTo(x - w, base);
  path.lineTo(x - w, spring);
  path.quadraticCurveTo(x - w, base - h * 0.95, x, base - h);
  path.quadraticCurveTo(x + w, base - h * 0.95, x + w, spring);
  path.lineTo(x + w, base);
  return path;
}

export default {
  name: 'drowned',
  description: 'A sunken chapel under a blood-red sea: a sigil burns in the rose window, candles flicker on the altar underwater and runes light up with the spectrum',
  palette: 'blood', // used when no -p is given
  // With --auto: settings scaled in calm parts, builds and drops (see modulate.js).
  sections: {
    calm: { flame: 0.8, glow: 0.7, bubbles: 0.5 },
    build: { glow: 0.9 },
    drop: { flame: 1.3, glow: 1.5, bubbles: 1.5, runes: 1.2 },
  },
  params: {
    symbol: 'pentagram', // pentagram inverted hexagram heptagram octagram eye leviathan triplemoon cycle
    cycle: 8,       // with symbol=cycle: kicks between symbol changes
    candles: 7,     // candles on and around the altar (0 = none)
    flame: 1,       // flame size
    runes: 1,       // runes around the window lighting up with the spectrum (0 = off)
    shafts: 5,      // red light shafts from the surface (0 = off)
    chains: 2,      // hanging chains swaying with the mids (0 = none)
    bubbles: 1,     // bubbles rising from the flames on transients (0 = off)
    snow: 60,       // drifting specks (0 = off)
    glow: 1,        // sigil and window glow
    surface: 1,     // waveform on the surface above (0 = flat)
  },

  setup(ctx, env) {
    const { width, height, u, cx, random, palette, params: p } = env;
    this.t = 0;
    this.kicks = 0;
    const S = (this.S = Math.min(width, height));
    this.surfY = height * 0.05;
    this.floorY = env.cy + S * 0.28;
    this.win = { x: cx, base: this.floorY - S * 0.14, w: S * 0.17, h: S * 0.52 };
    this.rose = { x: cx, y: this.win.base - this.win.h * 0.62, r: this.win.w * 0.78 };
    this.sea = new Sea(env, { size: S, waterY: this.surfY });
    this.shafts = makeShafts(random, p.shafts);
    this.snow = makeSnow(random, p.snow, u);
    this.bubbles = new Bubbles(env);

    // Candles: a row on the altar, the rest on the floor either side.
    const n = Math.round(p.candles);
    const altarW = S * 0.17;
    this.candles = Array.from({ length: n }, (_, i) => {
      const onAltar = i < Math.min(5, n);
      const k = onAltar ? i - (Math.min(5, n) - 1) / 2 : (i % 2 ? 1 : -1) * (1.9 + Math.floor((i - 5) / 2) * 0.55);
      return {
        x: cx + k * (onAltar ? altarW * 0.38 : altarW),
        base: onAltar ? this.floorY - S * 0.1 : this.floorY + S * 0.02 + Math.abs(k) * S * 0.012,
        h: S * (onAltar ? 0.035 + random() * 0.045 : 0.06 + random() * 0.04),
        w: S * (onAltar ? 0.011 : 0.014),
        phase: random() * TAU,
      };
    });
    this.chains = Array.from({ length: Math.round(p.chains) }, (_, i) => ({
      x: cx + (i % 2 ? 1 : -1) * S * (0.32 + 0.08 * Math.floor(i / 2)), len: S * (0.3 + random() * 0.2), phase: random() * TAU,
    }));

    this.glow = glowSprite(env, palette.accent, 64 * u);
    this.flameGlow = glowSprite(env, mix(palette.text, palette.colors[2], 0.4), 64 * u);
    this.shaft = shaftSprite(env, palette.colors[2]);
    this.stone = this.buildStone(env);
  },

  // The architecture doesn't move, so it's drawn once.
  buildStone(env) {
    const { width, height, u, cx, palette } = env;
    const S = this.S, floorY = this.floorY, win = this.win, rose = this.rose;
    const c = env.createCanvas(width, height);
    const g = c.getContext('2d');
    const dark = mix(palette.bg[0], palette.colors[0], 0.35), darker = mix(palette.bg[0], palette.colors[0], 0.15);
    const edge = (path, a = 0.45, w = 1.4) => {
      a = Math.min(1, a * 1.7);
      g.globalCompositeOperation = 'lighter';
      g.lineJoin = 'round';
      g.lineWidth = 7 * u;
      g.strokeStyle = rgba(palette.colors[1], a * 0.12);
      g.stroke(path);
      g.lineWidth = w * u;
      g.strokeStyle = rgba(palette.colors[1], a);
      g.stroke(path);
      g.globalCompositeOperation = 'source-over';
    };

    // Back wall with the window cut out of it (even-odd).
    const wall = new Path2D();
    wall.rect(cx - S * 0.62, floorY - S * 0.95, S * 1.24, S * 0.95);
    addArch(wall, win.x, win.base, win.w, win.h);
    wall.closePath();
    g.fillStyle = darker;
    g.fill(wall, 'evenodd');
    const frame = addArch(new Path2D(), win.x, win.base, win.w, win.h);
    edge(frame, 0.6, 2);
    edge(addArch(new Path2D(), win.x, win.base, win.w * 1.12, win.h * 1.06), 0.35);
    // Stone courses on the wall.
    const courses = new Path2D();
    for (let y = floorY - S * 0.06; y > floorY - S * 0.95; y -= S * 0.06) {
      for (const [a, b] of [[cx - S * 0.62, win.x - win.w * 1.15], [win.x + win.w * 1.15, cx + S * 0.62]]) {
        courses.moveTo(a, y);
        courses.lineTo(b, y);
      }
    }
    edge(courses, 0.12, 1);

    // Tracery: mullions below the rose, the rose's spokes and lobes.
    const tracery = new Path2D();
    tracery.moveTo(win.x, win.base); tracery.lineTo(win.x, rose.y + rose.r);
    tracery.moveTo(win.x - win.w * 0.5, win.base); tracery.lineTo(win.x - win.w * 0.5, rose.y + rose.r * 0.7);
    tracery.moveTo(win.x + win.w * 0.5, win.base); tracery.lineTo(win.x + win.w * 0.5, rose.y + rose.r * 0.7);
    tracery.moveTo(rose.x + rose.r, rose.y); tracery.arc(rose.x, rose.y, rose.r, 0, TAU);
    tracery.moveTo(rose.x + rose.r * 0.32, rose.y); tracery.arc(rose.x, rose.y, rose.r * 0.32, 0, TAU);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      tracery.moveTo(rose.x + Math.cos(a) * rose.r * 0.32, rose.y + Math.sin(a) * rose.r * 0.32);
      tracery.lineTo(rose.x + Math.cos(a) * rose.r, rose.y + Math.sin(a) * rose.r);
      const lx = rose.x + Math.cos(a + TAU / 16) * rose.r * 0.7, ly = rose.y + Math.sin(a + TAU / 16) * rose.r * 0.7;
      tracery.moveTo(lx + rose.r * 0.16, ly);
      tracery.arc(lx, ly, rose.r * 0.16, 0, TAU);
    }
    g.strokeStyle = dark;
    g.lineWidth = 5 * u;
    g.stroke(tracery);
    edge(tracery, 0.35, 1.1);

    // Floor tiles in perspective, towards a point behind the window.
    const floor = new Path2D();
    floor.rect(0, floorY, width, height - floorY);
    g.fillStyle = darker;
    g.fill(floor);
    const tiles = new Path2D();
    const vx = cx, vy = floorY - S * 0.5;
    for (let k = -14; k <= 14; k++) {
      const x = cx + k * S * 0.12;
      const t = (height - floorY) / (height - vy);
      tiles.moveTo(vx + (x - vx) * ((floorY - vy) / (height - vy)) / t * t, floorY);
      tiles.moveTo(x + (vx - x) * (1 - (floorY - vy) / (height - vy)), floorY);
      tiles.lineTo(x, height);
    }
    for (let k = 0; k < 8; k++) {
      const y = floorY + (height - floorY) * (k / 8) ** 1.6;
      tiles.moveTo(0, y);
      tiles.lineTo(width, y);
    }
    edge(tiles, 0.13, 1);
    edge(new Path2D(`M0 ${floorY} L${width} ${floorY}`), 0.4);

    // Pillars either side, one of them broken off.
    for (const side of [-1, 1]) {
      for (const k of [0, 1]) {
        const x = cx + side * S * (0.36 + k * 0.2), w = S * (0.045 - k * 0.006);
        const top = floorY - S * (k === 1 && side > 0 ? 0.55 : 0.98);
        const pillar = new Path2D();
        pillar.moveTo(x - w, floorY);
        if (k === 1 && side > 0) { // broken: a jagged top
          pillar.lineTo(x - w, top + S * 0.03);
          pillar.lineTo(x - w * 0.3, top);
          pillar.lineTo(x + w * 0.2, top + S * 0.04);
          pillar.lineTo(x + w, top + S * 0.01);
        } else {
          pillar.lineTo(x - w, top);
          pillar.lineTo(x + w, top);
        }
        pillar.lineTo(x + w, floorY);
        pillar.closePath();
        const grad = g.createLinearGradient(x - w, 0, x + w, 0);
        grad.addColorStop(0, dark);
        grad.addColorStop(side < 0 ? 1 : 0, darker);
        g.fillStyle = grad;
        g.fill(pillar);
        edge(pillar, 0.5);
        const flutes = new Path2D();
        for (const f of [-0.45, 0, 0.45]) {
          flutes.moveTo(x + f * w, floorY - S * 0.05);
          flutes.lineTo(x + f * w, top + S * 0.06);
        }
        // Capital and base blocks.
        flutes.rect(x - w * 1.35, floorY - S * 0.04, w * 2.7, S * 0.04);
        if (!(k === 1 && side > 0)) flutes.rect(x - w * 1.4, top, w * 2.8, S * 0.035);
        edge(flutes, 0.25, 1);
      }
    }
    // A fallen drum of the broken pillar.
    const drum = new Path2D();
    const dx = cx + S * 0.66, dy = floorY + S * 0.09;
    drum.ellipse(dx, dy, S * 0.07, S * 0.04, -0.15, 0, TAU);
    g.fillStyle = dark;
    g.fill(drum);
    edge(drum, 0.45);

    // Altar.
    const altar = new Path2D();
    altar.rect(cx - S * 0.17, floorY - S * 0.1, S * 0.34, S * 0.1);
    g.fillStyle = dark;
    g.fill(altar);
    edge(altar, 0.55);
    edge(new Path2D(`M${cx - S * 0.19} ${floorY - S * 0.1} L${cx + S * 0.19} ${floorY - S * 0.1}`), 0.6, 2);
    return c;
  },

  drawCandles(ctx, env, frame) {
    const { u, palette, params: p } = env;
    const t = this.t;
    const wax = new Path2D();
    for (const c of this.candles) wax.rect(c.x - c.w, c.base - c.h, c.w * 2, c.h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = mix(palette.text, palette.colors[0], 0.55);
    ctx.fill(wax);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1 * u;
    ctx.strokeStyle = rgba(palette.text, 0.35);
    ctx.stroke(wax);

    for (const c of this.candles) {
      const fx = c.x, fy = c.base - c.h;
      const size = this.S * 0.022 * p.flame * (1 + 0.6 * frame.pulse);
      const lean = Math.sin(t * 7 + c.phase) * 0.25 * (0.4 + frame.high);
      const flicker = 0.75 + 0.25 * Math.sin(t * 13 + c.phase * 3) * Math.sin(t * 5.3 + c.phase);
      const g = size * (4 + 3 * frame.pulse);
      ctx.globalAlpha = clamp(0.55 * flicker);
      ctx.drawImage(this.flameGlow, fx - g, fy - size - g, g * 2, g * 2);
      ctx.globalAlpha = 1;
      const flame = new Path2D();
      flame.moveTo(fx - size * 0.45, fy);
      flame.quadraticCurveTo(fx - size * 0.6, fy - size * 1.2, fx + lean * size * 2, fy - size * 2.4 * flicker);
      flame.quadraticCurveTo(fx + size * 0.6, fy - size * 1.2, fx + size * 0.45, fy);
      flame.closePath();
      const fire = ctx.createLinearGradient(fx, fy, fx, fy - size * 2.4);
      fire.addColorStop(0, rgba(palette.colors[2], 0.9));
      fire.addColorStop(0.35, rgba(palette.text, 0.95));
      fire.addColorStop(1, rgba(palette.colors[2], 0.6));
      ctx.fillStyle = fire;
      ctx.fill(flame);
      ctx.strokeStyle = rgba(palette.colors[2], 0.8);
      ctx.lineWidth = 1.5 * u;
      ctx.stroke(flame);
    }
  },

  draw(ctx, frame, env) {
    const { width, height, fps, u, cx, palette, random, params: p } = env;
    const dt = 1 / fps;
    this.t += dt;
    const t = this.t;
    const S = this.S, rose = this.rose, win = this.win;
    this.sea.update(frame, dt);
    if (frame.kick) this.kicks++;

    // Red light behind the window, the sigil burning in the rose.
    ctx.globalCompositeOperation = 'lighter';
    const hall = S * (0.9 + 0.3 * frame.pulse);
    ctx.globalAlpha = clamp((0.25 + 0.4 * frame.rms + 0.3 * frame.pulse) * p.glow);
    ctx.drawImage(this.glow, rose.x - hall, rose.y - hall * 0.8, hall * 2, hall * 2);
    ctx.globalAlpha = 1;
    const name = p.symbol === 'cycle' ? CYCLE[Math.floor(this.kicks / Math.max(1, p.cycle)) % CYCLE.length] : p.symbol;
    const glyph = centerpieces[name] ?? centerpieces.pentagram;
    const sigil = addGlyph(new Path2D(), glyph, rose.x, rose.y, rose.r * 0.92 * (1 + 0.05 * frame.pulse), t * 0.1);
    ctx.lineJoin = 'round';
    for (const [w, a] of [[22, 0.07], [8, 0.18], [2.6, 0.95]]) {
      ctx.lineWidth = w * u;
      ctx.strokeStyle = rgba(w > 3 ? palette.accent : mix(palette.text, palette.colors[2], 0.5), a * clamp((0.6 + 0.6 * frame.pulse) * p.glow));
      ctx.stroke(sigil);
    }

    drawShafts(ctx, this.shafts, { sprite: this.shaft, top: this.surfY, amount: 0.8, t, high: frame.high, pulse: frame.pulse, env });

    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.stone, 0, 0);

    // Runes up around the window, each lit by its own slice of the spectrum.
    if (p.runes > 0) {
      const count = 13;
      for (let i = 0; i < count; i++) {
        const f = i / (count - 1);
        const a = Math.PI + f * Math.PI; // left, over the top, right
        const x = win.x + Math.cos(a) * win.w * 1.32;
        const y = win.base - win.h * 0.55 + Math.sin(a) * win.h * 0.55;
        const level = frame.spectrum[Math.floor(f * (frame.spectrum.length - 1) * 0.8)];
        const path = addGlyph(new Path2D(), runes[i % runes.length], x, y, S * 0.022, 0);
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineWidth = 1.6 * u;
        ctx.strokeStyle = rgba(palette.colors[2], clamp(0.15 + 0.9 * level * p.runes));
        ctx.stroke(path);
      }
    }

    // Chains hanging from the dark, swinging with the mids.
    for (const c of this.chains) {
      const swing = Math.sin(t * 0.8 + c.phase) * (0.06 + 0.12 * frame.mid);
      const path = new Path2D();
      const links = 14;
      for (let i = 0; i <= links; i++) {
        const f = i / links;
        const x = c.x + Math.sin(swing * f) * c.len, y = this.surfY + Math.cos(swing * f) * c.len * f;
        path.moveTo(x + 4 * u, y);
        path.ellipse(x, y, 3 * u, (c.len / links) * 0.55, swing * f, 0, TAU);
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 1.4 * u;
      ctx.strokeStyle = rgba(palette.colors[1], 0.55);
      ctx.stroke(path);
    }

    this.drawCandles(ctx, env, frame);

    if (frame.onset && p.bubbles > 0 && this.candles.length) {
      const c = this.candles[Math.floor(random() * this.candles.length)];
      this.bubbles.spawn(c.x, c.base - c.h - S * 0.05, Math.round((2 + 4 * frame.onsetStrength) * p.bubbles), 0.8);
    }
    this.bubbles.draw(ctx, { top: this.surfY, dt, t });
    drawSnow(ctx, this.snow, { dt, t, mid: frame.mid, env });
    drawSurface(ctx, this.sea, { y: this.surfY, amp: S * 0.02 * p.surface, env, pulse: frame.pulse });

    // Murky water over everything, thinning near the light.
    ctx.globalCompositeOperation = 'source-over';
    const murk = ctx.createRadialGradient(rose.x, rose.y, S * 0.2, rose.x, rose.y, Math.max(width, height) * 0.8);
    murk.addColorStop(0, rgba(palette.bg[0], 0));
    murk.addColorStop(1, rgba(palette.bg[0], 0.55));
    ctx.fillStyle = murk;
    ctx.fillRect(0, 0, width, height);
  },
};
