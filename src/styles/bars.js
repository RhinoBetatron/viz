import { rampAt, rgba } from '../palettes.js';
import { Path2D } from 'skia-canvas';
import { sampleSpectrum } from '../util.js';

export default {
  name: 'bars',
  description: 'Mirrored spectrum bars with a glow that hits on the kick',
  // With --auto: settings scaled in calm parts, builds and drops (see modulate.js).
  sections: {
    calm: { height: 0.75, glow: 0.7 },
    build: { height: 0.9 },
    drop: { height: 1.2, glow: 1.5 },
  },
  params: {
    bars: 48,        // number of bars per side
    gap: 0.35,       // gap between bars as a fraction of bar width
    height: 0.3,     // max bar height as a fraction of canvas height
    width: 0.9,      // total width as a fraction of canvas width
    mirror: 1,       // 1 = low end in the centre spreading outwards, 0 = left-to-right
    glow: 1,         // glow intensity (0 to disable)
    reflect: 1,      // 1 = bars grow up and down, 0 = up only
  },

  draw(ctx, frame, { width, height, cx, cy, u, palette, params }) {
    const p = params;
    const count = Math.round(p.bars);
    const values = sampleSpectrum(frame.spectrum, count);
    const total = width * p.width;
    const slots = p.mirror ? count * 2 : count;
    const slot = total / slots;
    const barW = slot * (1 - p.gap);
    const maxH = height * p.height * (0.9 + 0.2 * frame.pulse);
    const left = cx - total / 2;

    const gradient = ctx.createLinearGradient(left, 0, left + total, 0);
    const stops = p.mirror ? [...palette.colors].reverse().concat(palette.colors.slice(1)) : palette.colors;
    stops.forEach((c, i) => gradient.addColorStop(i / (stops.length - 1), c));

    const path = new Path2D();
    const addBar = (x, v) => {
      const h = Math.max(barW * 0.6, v * maxH);
      const top = p.reflect ? cy - h / 2 : cy - h;
      path.roundRect(x, top, barW, h, barW / 2);
    };
    for (let i = 0; i < count; i++) {
      const v = values[i];
      if (p.mirror) {
        addBar(cx + i * slot + (slot - barW) / 2, v);
        addBar(cx - (i + 1) * slot + (slot - barW) / 2, v);
      } else {
        addBar(left + i * slot + (slot - barW) / 2, v);
      }
    }

    if (p.glow > 0) {
      ctx.shadowColor = rgba(rampAt(palette.colors, 0.5), 0.9);
      ctx.shadowBlur = (20 + 50 * frame.pulse) * u * p.glow;
    }
    ctx.fillStyle = gradient;
    ctx.fill(path);

    // A thin bright core line on top for definition.
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.35 + 0.4 * frame.high;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(left, cy - u, total, 2 * u);
  },
};
