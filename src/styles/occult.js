import { Path2D } from 'skia-canvas';
import { rgba } from '../palettes.js';
import { sampleSpectrum } from '../util.js';
import { runes, sigils, centerpieces, addGlyph } from '../glyphs.js';

const CYCLE = ['pentagram', 'hexagram', 'eye', 'heptagram', 'triplemoon', 'inverted', 'octagram', 'leviathan'];

export default {
  name: 'occult',
  description: 'Glowing sigil inside a rotating rune circle, with occult symbols flickering in the dark',
  palette: 'blood', // used when no -p is given
  params: {
    symbol: 'pentagram', // pentagram inverted hexagram heptagram octagram eye leviathan triplemoon cycle
    cycle: 8,            // with symbol=cycle: how many kicks (or beats / bars, see `on`) between symbol changes
    on: 'kick',          // what symbol=cycle counts: kick, beat (steady through breakdowns) or bar
    scale: 1,            // overall size of the magic circle
    spin: 0.03,          // rotation speed in turns per second
    runes: 1,            // rune ring (0 to hide)
    ticks: 96,           // spectrum ticks inside the circle (0 to hide)
    floaters: 16,        // background symbols (0 to hide)
    glow: 1,
    echo: 1,             // expanding ghost of the centre symbol on each kick (0 to disable)
    flicker: 1,          // candle-like flicker (0 = steady)
  },

  setup(ctx, env) {
    const { width, height, u, random, params } = env;
    this.kicks = 0;
    this.turn = 0;
    this.floaters = Array.from({ length: Math.round(params.floaters) }, () => ({
      glyph: sigils[Math.floor(random() * sigils.length)],
      x: random() * width,
      y: random() * height,
      size: (30 + random() * 60) * u,
      rotation: random() * Math.PI * 2,
      spin: (random() - 0.5) * 0.3,
      vx: (random() - 0.5) * 12 * u,
      vy: (-4 - random() * 10) * u, // drift upwards like smoke
      flash: 0,
    }));
  },

  draw(ctx, frame, env) {
    const { width, height, cx, cy, u, fps, palette, params: p, random } = env;
    const dt = 1 / fps;
    const bright = palette.colors.at(-1);
    const mid = palette.colors[Math.floor(palette.colors.length / 2)];
    // Smoothed noise so it wavers like a candle instead of strobing.
    this.flick = (this.flick ?? 0) + (random() - (this.flick ?? 0)) * 0.25;
    const flicker = 1 - p.flicker * (0.15 * this.flick + 0.1 * (1 - frame.rms));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Background symbols drift up and flare on transients.
    if (frame.onset) {
      for (let i = 0; i < 3 && this.floaters.length; i++) {
        this.floaters[Math.floor(random() * this.floaters.length)].flash = 0.5 + 0.5 * frame.onsetStrength;
      }
    }
    for (const f of this.floaters) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rotation += f.spin * dt;
      if (f.y < -f.size * 2) { f.y = height + f.size * 2; f.x = random() * width; }
      if (f.x < -f.size * 2) f.x = width + f.size * 2;
      if (f.x > width + f.size * 2) f.x = -f.size * 2;
      f.flash *= 0.9 ** (30 / fps);
      ctx.strokeStyle = rgba(f.flash > 0.05 ? bright : palette.colors[0], (0.2 + 0.7 * f.flash) * flicker);
      ctx.lineWidth = 2 * u;
      ctx.stroke(addGlyph(new Path2D(), f.glyph, f.x, f.y, f.size, f.rotation));
    }

    const size = Math.min(width, height);
    const R = size * 0.42 * p.scale * (1 + 0.02 * frame.pulse);
    // Added up per frame (not time × spin) so an audio-driven spin stays smooth.
    const turn = this.turn * Math.PI * 2;
    this.turn += p.spin / env.fps;
    ctx.translate(cx, cy);
    ctx.globalAlpha = flicker;

    // Magic circle: two rings with runes between them.
    ctx.strokeStyle = mid;
    ctx.shadowColor = rgba(palette.accent, 0.8);
    ctx.shadowBlur = (10 + 25 * frame.pulse) * u * p.glow;
    ctx.lineWidth = 2.5 * u;
    const rings = new Path2D();
    for (const r of [R, R * 0.86, R * 0.62]) { rings.moveTo(r, 0); rings.arc(0, 0, r, 0, Math.PI * 2); }
    ctx.stroke(rings);

    if (p.runes > 0) {
      // Each rune lights up with its slice of the spectrum. Grouped by
      // brightness so there are only a few glowing strokes per frame.
      const levels = sampleSpectrum(frame.spectrum, runes.length);
      const buckets = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
      runes.forEach((glyph, i) => {
        const a = -turn * 0.5 + (i / runes.length) * Math.PI * 2 - Math.PI / 2;
        const b = Math.min(3, Math.floor(levels[i] * 4));
        addGlyph(buckets[b], glyph, Math.cos(a) * R * 0.93, Math.sin(a) * R * 0.93, R * 0.042, a + Math.PI / 2);
      });
      ctx.lineWidth = 2.5 * u;
      buckets.forEach((path, b) => {
        ctx.strokeStyle = rgba(b >= 2 ? bright : mid, 0.55 + 0.45 * (b / 3));
        ctx.shadowColor = bright;
        ctx.shadowBlur = b >= 2 ? (8 + 20 * frame.pulse) * u * p.glow : 0;
        ctx.stroke(path);
      });
    }

    if (p.ticks > 0) {
      const count = Math.round(p.ticks);
      const values = sampleSpectrum(frame.spectrum, Math.ceil(count / 2));
      const ticks = new Path2D();
      for (let i = 0; i < count; i++) {
        const half = i < count / 2 ? i : count - 1 - i; // mirrored, bass at the top
        const a = turn + (i / count) * Math.PI * 2 - Math.PI / 2;
        const r0 = R * 0.84, r1 = r0 - R * (0.015 + 0.17 * values[half]);
        ticks.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        ticks.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      }
      ctx.strokeStyle = mid;
      ctx.lineWidth = 3 * u;
      ctx.shadowColor = rgba(palette.accent, 0.7);
      ctx.shadowBlur = 6 * u * p.glow;
      ctx.stroke(ticks);
    }

    // Centre symbol.
    if (p.on === 'bar' ? frame.downbeat : p.on === 'beat' ? frame.beat : frame.kick) this.kicks++;
    const name = p.symbol === 'cycle' ? CYCLE[Math.floor(this.kicks / Math.max(1, p.cycle)) % CYCLE.length] : p.symbol;
    const glyph = centerpieces[name] ?? centerpieces.pentagram;
    const symbolSize = R * 0.56 * (1 + 0.07 * frame.pulse);
    const rotation = -turn * 0.3;

    if (p.echo > 0 && frame.pulse > 0.02) {
      ctx.globalAlpha = flicker * frame.pulse * 0.45 * p.echo;
      ctx.strokeStyle = bright;
      ctx.lineWidth = 2 * u;
      ctx.shadowBlur = 0;
      ctx.stroke(addGlyph(new Path2D(), glyph, 0, 0, symbolSize * (1 + 0.45 * (1 - frame.pulse)), rotation));
    }

    ctx.globalAlpha = Math.min(1, flicker * (0.75 + 0.4 * frame.rms));
    ctx.strokeStyle = bright;
    ctx.lineWidth = (3.5 + 2.5 * frame.pulse) * u;
    ctx.shadowColor = palette.accent;
    ctx.shadowBlur = (18 + 60 * frame.pulse) * u * p.glow;
    ctx.stroke(addGlyph(new Path2D(), glyph, 0, 0, symbolSize, rotation));
  },
};
