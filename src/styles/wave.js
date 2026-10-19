import { rgba } from '../palettes.js';
import { sampleWaveform, flatten } from '../util.js';

export default {
  name: 'wave',
  description: 'Neon oscilloscope line with motion trails and colour-split echoes',
  params: {
    amp: 0.22,       // amplitude as a fraction of canvas height
    lines: 3,        // number of colour-split copies (1 = single line)
    split: 10,       // pixel offset between copies, grows with the bass
    thickness: 5,
    trail: 0.8,      // 0 = no trail, 0.95 = long smear
    points: 240,     // resolution of the line (lower = smoother)
    shape: 'line',   // line | circle
    radius: 0.28,    // circle radius (shape=circle), fraction of canvas size
  },

  setup(ctx, env) {
    this.trail = env.createCanvas(env.width, env.height);
  },

  draw(ctx, frame, { width, height, cx, cy, u, palette, params }) {
    const p = params;
    const t = flatten(this.trail);

    // Fade the previous frames out instead of clearing them — that's the trail.
    // (shadowBlur must be off here or it blurs the whole canvas every frame.)
    t.shadowBlur = 0;
    t.globalCompositeOperation = 'destination-out';
    t.fillStyle = `rgba(0,0,0,${1 - p.trail})`;
    t.fillRect(0, 0, width, height);
    t.globalCompositeOperation = 'lighter';

    const pts = sampleWaveform(frame.waveform, Math.round(p.points));
    const lines = Math.max(1, Math.round(p.lines));
    const size = Math.min(width, height);
    const amp = (p.shape === 'circle' ? size * 0.5 : height) * p.amp * (0.85 + 0.3 * frame.pulse);

    t.lineCap = 'round';
    t.lineJoin = 'round';
    for (let l = 0; l < lines; l++) {
      const color = palette.colors[l % palette.colors.length];
      const offset = (l - (lines - 1) / 2) * p.split * u * (1 + 2.5 * frame.bass);
      t.strokeStyle = rgba(color, lines > 1 ? 0.85 : 1);
      t.shadowColor = color;
      t.shadowBlur = (14 + 30 * frame.pulse) * u;
      t.lineWidth = p.thickness * u * (1 + 0.6 * frame.pulse);
      t.beginPath();
      if (p.shape === 'circle') {
        const r = size * p.radius;
        for (let i = 0; i <= pts.length; i++) {
          const v = pts[i % pts.length];
          const a = (i / pts.length) * Math.PI * 2 - Math.PI / 2;
          const rr = r + v * amp + offset;
          const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
          i ? t.lineTo(x, y) : t.moveTo(x, y);
        }
      } else {
        const margin = width * 0.06;
        const span = width - margin * 2;
        for (let i = 0; i < pts.length; i++) {
          // Taper the ends to zero so the line doesn't stop abruptly.
          const edge = Math.sin((i / (pts.length - 1)) * Math.PI);
          const x = margin + (i / (pts.length - 1)) * span;
          const y = cy + offset + pts[i] * amp * edge;
          i ? t.lineTo(x, y) : t.moveTo(x, y);
        }
      }
      t.stroke();
    }

    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.trail, 0, 0);
  },
};
