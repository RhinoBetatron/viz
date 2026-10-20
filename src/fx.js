// Post-effects that work on top of any style: --fx bloom,chroma=2,shake.
// Each takes an amount (1 = default strength) and reacts to the music.
// Randomness is seeded from the frame number, so renders stay repeatable.
import { flatten, rng } from './util.js';

export const effects = {
  bloom: 'glow bleeding out of the bright parts, swelling on the kick',
  chroma: 'lens-style colour fringing towards the edges, wider on the kick',
  vhs: 'worn tape: colour bleed, a rolling tracking band, glitches on hits',
  scanlines: 'CRT scanlines with a slow refresh bar',
  vignette: 'darkened corners, over the whole picture',
  shake: 'camera shake on the kicks, harder when the track is loud',
};

// "bloom,chroma=2" (repeatable) → { bloom: 1, chroma: 2 }
export function parseFx(value, prev = {}) {
  const out = { ...prev };
  for (const part of value.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [name, amount] = part.split('=');
    if (!(name in effects)) throw new Error(`Unknown effect "${name}". Available: ${Object.keys(effects).join(', ')}`);
    const n = amount === undefined ? 1 : Number(amount);
    if (Number.isNaN(n) || n < 0) throw new Error(`--fx ${name}= takes a number, got "${amount}"`);
    out[name] = n;
  }
  return out;
}

export const fxString = (fx) => Object.entries(fx).map(([k, v]) => (v === 1 ? k : `${k}=${+v.toFixed(2)}`)).join(',');

export function makeFx(fx, { width, height, u, createCanvas }) {
  const on = (name) => (fx[name] ?? 0) > 0;
  const any = Object.values(fx).some((v) => v > 0);
  if (!any) return null;
  const layerA = createCanvas(width, height);
  const layerB = createCanvas(width, height);
  const fresh = (c, w = width) => { c.width = w; return c.getContext('2d'); }; // reset the recording, see util.flatten

  // Draws `src` into `dst` scaled about the centre and nudged sideways, then
  // keeps only one colour channel of it.
  const channel = (dst, src, colour, scale, dx) => {
    const c = fresh(dst);
    c.translate(width / 2 + dx, height / 2);
    c.scale(scale, scale);
    c.drawImage(src, -width / 2, -height / 2);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = colour;
    c.fillRect(0, 0, width, height);
    return dst;
  };
  // Rebuilds the frame from shifted red and green over the untouched blue.
  const splitChannels = (canvas, ctx, { rScale = 1, gScale = 1, rDx = 0, gDx = 0 }) => {
    channel(layerA, canvas, '#ff0000', rScale, rDx);
    channel(layerB, canvas, '#00ff00', gScale, gDx);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(layerA, 0, 0);
    ctx.drawImage(layerB, 0, 0);
    ctx.restore();
  };

  // Two blurred copies, quarter and eighth size: a tight glow and a wide haze.
  const blooms = [4, 8].map((div) => ({ div, c: createCanvas(Math.ceil(width / div), Math.ceil(height / div)) }));

  let scan = null;
  if (on('scanlines') || on('vhs')) {
    scan = createCanvas(width, height);
    const c = scan.getContext('2d');
    const gap = Math.max(2, Math.round(3 * u));
    const dark = Math.min(0.85, 0.3 * Math.max(fx.scanlines ?? 0, (fx.vhs ?? 0) * 0.6));
    c.fillStyle = `rgba(0,0,0,${dark})`;
    for (let y = 0; y < height; y += gap) c.fillRect(0, y, width, Math.max(1, gap / 2));
    flatten(scan); // one bitmap instead of a thousand rects per frame
  }

  let vignette = null;
  if (on('vignette')) {
    vignette = createCanvas(width, height);
    const c = vignette.getContext('2d');
    const g = c.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.2, width / 2, height / 2, Math.hypot(width, height) * 0.5);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0.95)');
    c.fillStyle = g;
    c.fillRect(0, 0, width, height);
    flatten(vignette);
  }

  return {
    // Camera shake, applied as a transform before the scenes are drawn.
    // Slightly zoomed in by however far it moves, so edges never show.
    shake(ctx, frame) {
      if (!on('shake')) return;
      const t = frame.time;
      const amp = fx.shake * 26 * u * frame.pulse ** 2 * (0.45 + 0.55 * frame.rms);
      const dx = amp * (Math.sin(t * 37.1) + 0.6 * Math.sin(t * 61.7 + 1.3)) / 1.6;
      const dy = amp * (Math.sin(t * 43.3 + 2.1) + 0.6 * Math.sin(t * 53.9 + 0.4)) / 1.6;
      const rot = fx.shake * 0.01 * frame.pulse ** 2 * Math.sin(t * 29.3 + 0.7);
      const s = 1 + (2.2 * Math.max(Math.abs(dx), Math.abs(dy))) / Math.min(width, height) + Math.abs(rot) * 1.1;
      ctx.translate(width / 2 + dx, height / 2 + dy);
      ctx.rotate(rot);
      ctx.scale(s, s);
      ctx.translate(-width / 2, -height / 2);
    },

    // Everything else, on the finished frame.
    apply(canvas, ctx, frame) {
      if (on('bloom')) {
        const lift = fx.bloom * (0.5 + 0.5 * frame.pulse);
        for (const { div, c } of blooms) {
          const bctx = fresh(c, c.width);
          bctx.filter = `brightness(${0.85 + 0.3 * frame.pulse}) contrast(2.4) blur(${(div === 4 ? 6 : 10) * u}px)`;
          bctx.drawImage(canvas, 0, 0, c.width, c.height);
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = Math.min(1, lift * (div === 4 ? 0.55 : 0.4));
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(c, 0, 0, width, height);
          ctx.restore();
        }
      }

      if (on('chroma')) {
        const k = fx.chroma * (0.003 + 0.012 * frame.pulse);
        splitChannels(canvas, ctx, { rScale: 1 + k, gScale: 1 + k / 2 });
      }

      if (on('vhs')) {
        const a = fx.vhs;
        const random = rng(frame.index * 7919 + 13);
        const bleed = a * (2.5 + 7 * frame.pulse) * u;
        const cover = 1 + (2.2 * bleed) / width; // zoomed in a touch so shifted edges stay covered
        splitChannels(canvas, ctx, { rDx: -bleed, gDx: bleed * 0.35, rScale: cover, gScale: cover });

        // Slices of the picture pushed sideways: one tracking band that rolls
        // down the screen, plus a few torn lines on hard hits.
        const src = fresh(layerA);
        src.drawImage(canvas, 0, 0);
        const bands = [];
        const bandH = height * 0.05;
        const y0 = ((frame.time * 0.11) % 1.2 - 0.1) * height;
        for (let i = 0; i < 6; i++) bands.push([y0 + (i * bandH) / 6, bandH / 6, a * (6 + 10 * random()) * u * (1 - Math.abs(i - 2.5) / 3)]);
        const hits = frame.kick || frame.onsetStrength > 0.6 ? Math.round(1 + 4 * a * Math.max(frame.kickStrength, frame.onsetStrength)) : 0;
        for (let i = 0; i < hits; i++) bands.push([random() * height, (4 + random() * 40) * u, (random() - 0.5) * 80 * a * u]);
        for (const [y, h, dx] of bands) ctx.drawImage(layerA, 0, y, width, h, dx, y, width, h);

        // Tape noise in the tracking band.
        ctx.save();
        ctx.fillStyle = `rgba(255,255,255,${0.08 * Math.min(1, a)})`;
        for (let i = 0; i < 14; i++) ctx.fillRect(random() * width, y0 + random() * bandH, (20 + random() * 120) * u, Math.max(1, u));
        ctx.restore();
      }

      if (scan) {
        ctx.drawImage(scan, 0, 0);
        // The refresh bar: a faint lighter band drifting down.
        const y = ((frame.time * 0.18) % 1) * (height * 1.3) - height * 0.15;
        const g = ctx.createLinearGradient(0, y - height * 0.08, 0, y + height * 0.08);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, `rgba(255,255,255,${0.035 * Math.min(1.5, Math.max(fx.scanlines ?? 0, fx.vhs ?? 0))})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, y - height * 0.08, width, height * 0.16);
      }

      if (vignette) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, fx.vignette * 0.85);
        ctx.drawImage(vignette, 0, 0);
        ctx.restore();
      }
      return ctx;
    },
  };
}
