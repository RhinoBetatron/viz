import { rampAt, rgba } from '../palettes.js';
import { sampleSpectrum, drawCover } from '../util.js';

export default {
  name: 'radial',
  description: 'Circular spectrum around the cover art (or a glowing orb), pulsing on the kick',
  // With --auto: settings scaled in calm parts, builds and drops (see modulate.js).
  sections: {
    calm: { length: 0.8, spin: 0.7, glow: 0.7 },
    build: { length: 0.9 },
    drop: { length: 1.2, spin: 1.5, glow: 1.5 },
  },
  params: {
    bars: 90,        // bars per half circle (mirrored left/right)
    radius: 0.23,    // inner radius as a fraction of canvas width/height (whichever is smaller)
    length: 0.17,    // max bar length, same units
    thickness: 0.5,  // bar thickness as a fraction of the spacing between bars
    spin: 0.08,      // rotation speed in turns per second (0 = still)
    glow: 1,
    ring: 1,         // outer ring that follows loudness
  },

  draw(ctx, frame, { cx, cy, width, height, u, fps, palette, params, cover }) {
    const p = params;
    const size = Math.min(width, height);
    const count = Math.round(p.bars);
    const values = sampleSpectrum(frame.spectrum, count);
    const r = size * p.radius * (1 + 0.06 * frame.pulse);
    const len = size * p.length;
    // Added up per frame (not time × spin) so an audio-driven spin stays smooth.
    const rotation = (this.turn ?? 0) * Math.PI * 2;
    this.turn = (this.turn ?? 0) + p.spin / fps;
    const step = Math.PI / count;

    ctx.translate(cx, cy);

    // Centre: the cover art clipped to a circle, or a gradient orb.
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.94, 0, Math.PI * 2);
    ctx.shadowColor = rgba(palette.accent, 0.8);
    ctx.shadowBlur = (30 + 60 * frame.pulse) * u * p.glow;
    if (cover) {
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.clip();
      ctx.rotate(rotation * 0.25);
      drawCover(ctx, cover, -r, -r, r * 2, r * 2);
    } else {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, rgba(palette.colors[0], 0.9));
      g.addColorStop(0.7, rgba(palette.colors.at(-1), 0.5));
      g.addColorStop(1, rgba(palette.colors.at(-1), 0.1));
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.restore();

    // Spectrum bars radiating outwards, mirrored so low end sits at the top.
    ctx.rotate(rotation);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, 2 * Math.PI * r / (count * 2) * p.thickness);
    if (p.glow > 0) {
      ctx.shadowBlur = (12 + 30 * frame.pulse) * u * p.glow;
    }
    // Bars are batched into colour groups: one glowing stroke per group is far
    // cheaper than a shadow blur per bar.
    const groups = Math.min(count, 12);
    for (let g = 0; g < groups; g++) {
      const color = rampAt(palette.colors, (g + 0.5) / groups);
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.beginPath();
      for (let i = Math.floor((g * count) / groups); i < Math.floor(((g + 1) * count) / groups); i++) {
        const l = len * values[i] + 4 * u;
        for (const side of [1, -1]) {
          const a = -Math.PI / 2 + side * (i + 0.5) * step;
          const cos = Math.cos(a), sin = Math.sin(a);
          ctx.moveTo(cos * (r + 6 * u), sin * (r + 6 * u));
          ctx.lineTo(cos * (r + 6 * u + l), sin * (r + 6 * u + l));
        }
      }
      ctx.stroke();
    }

    if (p.ring > 0) {
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.25 + 0.5 * frame.rms;
      ctx.strokeStyle = palette.text;
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.arc(0, 0, r + len * (0.45 + 0.35 * frame.rms), 0, Math.PI * 2);
      ctx.stroke();
    }
  },
};
