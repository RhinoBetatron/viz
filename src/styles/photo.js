import { Path2D } from 'skia-canvas';
import { mix, rgba, hexToRgb } from '../palettes.js';
import { clamp, drawCover, flatten, sampleWaveform } from '../util.js';

const SORT_STEPS = 20; // pixel-sort thresholds, each sorted once and cached
const STRIPS = 48;     // melt columns
const ROWS = 90;       // wave-warp rows

// How hard each effect hits in each preset. Anything a preset leaves out is
// off; any -P setting overrides its preset value.
const PRESETS = {
  mix: { zoom: 1, rgb: 1, slices: 1, wave: 0.4, mosaic: 0.3, sort: 0.5, melt: 0.4, shatter: 0.7, burn: 0.5, invert: 0.3 },
  glitch: { zoom: 1, rgb: 1.6, slices: 1.6, wave: 0.3, mosaic: 0.8, invert: 0.7 },
  melt: { zoom: 0.5, rgb: 0.4, wave: 1.2, sort: 0.8, melt: 1.3 },
  shatter: { zoom: 1, rgb: 0.6, slices: 0.4, shatter: 1.6 },
  burn: { zoom: 0.6, rgb: 0.3, wave: 0.3, burn: 1.4, invert: 0.2 },
  sort: { zoom: 0.6, rgb: 0.4, slices: 0.3, sort: 1.6 },
  clean: { zoom: 1 },
};
export const photoPresets = Object.keys(PRESETS);
const EFFECTS = ['zoom', 'rgb', 'slices', 'wave', 'mosaic', 'sort', 'melt', 'shatter', 'burn', 'invert'];

// Smooth random field in 0–1 (a few octaves of value noise), for the burn.
function noiseField(w, h, random) {
  const out = new Float32Array(w * h);
  for (const [cell, weight] of [[24, 0.55], [9, 0.3], [4, 0.15]]) {
    const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
    const grid = Float32Array.from({ length: gw * gh }, random);
    for (let y = 0; y < h; y++) {
      const fy = y / cell, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < w; x++) {
        const fx = x / cell, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
        const a = grid[iy * gw + ix], b = grid[iy * gw + ix + 1], c = grid[(iy + 1) * gw + ix], d = grid[(iy + 1) * gw + ix + 1];
        out[y * w + x] += weight * (a + (b - a) * sx + (c - a + (a - b + d - c) * sx) * sy);
      }
    }
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of out) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo || 1);
  return out;
}

export default {
  name: 'photo',
  presets: photoPresets,
  description: 'Your photo (--image), torn apart with the music: glitch slices, RGB split, pixel sorting, melting, shattering on the kicks, burning away through the clip, and more. Pick a preset or set each effect',
  params: {
    preset: 'mix',  // mix, glitch, melt, shatter, burn, sort or clean: which effects, and how hard
    fit: 'cover',   // cover (fill the frame) or contain (whole photo, blurred copy behind)
    decay: 0.5,     // how much the damage builds up over the clip (0 = full force from the start)
    zoom: 'auto',   // punch-in on the kicks and a slow drift
    rgb: 'auto',    // red/green/blue split, wider on the kicks
    slices: 'auto', // horizontal glitch tears on the hits
    wave: 'auto',   // rows rippling sideways with the waveform
    mosaic: 'auto', // pixelation pulsing with the bass
    sort: 'auto',   // pixel sorting: bright parts streak down, longer when it's loud
    melt: 'auto',   // the photo drips down when it's loud and recovers when it's quiet
    shatter: 'auto', // breaks into shards on big kicks, which spring back
    burn: 'auto',   // burns away from the inside, holes growing with the kicks (for good)
    invert: 'auto', // negative flashes on the hardest hits
    tint: 0,        // wash the photo in the palette's colours (0 = its own colours)
  },

  setup(ctx, env) {
    const { width: W, height: H, u, random, createCanvas, palette, params: p } = env;
    const img = env.image ?? env.cover;
    if (!img) throw new Error('the photo style needs a picture: add --image photo.jpg');
    if (!PRESETS[p.preset]) throw new Error(`unknown photo preset "${p.preset}". Try: ${photoPresets.join(', ')}`);
    if (!['cover', 'contain'].includes(p.fit)) throw new Error(`photo fit is cover or contain, not "${p.fit}"`);
    for (const k of EFFECTS) {
      if (typeof p[k] === 'string' && p[k] !== 'auto') throw new Error(`photo ${k} takes a number, an expression or auto, not "${p[k]}"`);
    }
    const S = (this.S = Math.min(W, H));
    this.u = u;
    this.t = 0;

    // The photo, fitted to the frame.
    this.base = createCanvas(W, H);
    const b = this.base.getContext('2d');
    if (p.fit === 'contain') {
      const blur = Math.round(S * 0.04);
      b.filter = `blur(${blur}px) brightness(45%)`;
      drawCover(b, img, -blur * 2, -blur * 2, W + blur * 4, H + blur * 4);
      b.filter = 'none';
      const s = Math.min(W / img.width, H / img.height);
      b.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
    } else drawCover(b, img, 0, 0, W, H);
    flatten(this.base);

    // Quarter-size copy for pixel sorting.
    this.sw = Math.max(8, Math.round(W / 4));
    this.sh = Math.max(8, Math.round(H / 4));
    const small = createCanvas(this.sw, this.sh);
    small.getContext('2d').drawImage(this.base, 0, 0, this.sw, this.sh);
    this.px = small.getContext('2d').getImageData(0, 0, this.sw, this.sh).data;
    this.lum = new Float32Array(this.sw * this.sh);
    for (let i = 0; i < this.lum.length; i++) this.lum[i] = (0.299 * this.px[i * 4] + 0.587 * this.px[i * 4 + 1] + 0.114 * this.px[i * 4 + 2]) / 255;
    this.sorted = new Map();
    this.lumOrder = Float32Array.from(this.lum).sort(); // for brightness percentiles

    // Working canvases.
    this.comp = createCanvas(W, H);    // the photo with this frame's effects
    this.out = createCanvas(W, H);     // shattered copy
    this.chan = createCanvas(W, H);    // one colour channel at a time
    this.split = createCanvas(W, H);   // channels added back together
    this.mw = Math.max(8, Math.round(W / 2));
    this.mh = Math.max(8, Math.round(H / 2));
    this.melt = createCanvas(this.mw, this.mh);
    this.meltTmp = createCanvas(this.mw, this.mh);
    this.meltFresh = true;
    this.drips = Array.from({ length: STRIPS }, () => 0.3 + random() * 0.7);
    this.tiny = createCanvas(8, 8);

    // Burn: a noise field; pixels burn when the damage passes their value.
    this.nw = Math.max(8, Math.round(W / 6));
    this.nh = Math.max(8, Math.round(H / 6));
    this.noise = noiseField(this.nw, this.nh, random);
    this.holes = createCanvas(this.nw, this.nh);
    this.scorch = createCanvas(this.nw, this.nh);
    this.embers = createCanvas(this.nw, this.nh);
    this.damage = 0;
    this.burnAt = -1;

    // Shards: a jittered grid of triangles.
    const cols = Math.max(3, Math.round((W / S) * 6)), rows = Math.max(3, Math.round((H / S) * 6));
    const pt = (i, j) => {
      const edgeX = i === 0 || i === cols, edgeY = j === 0 || j === rows;
      return [
        (i / cols) * W + (edgeX ? 0 : (random() - 0.5) * (W / cols) * 0.7),
        (j / rows) * H + (edgeY ? 0 : (random() - 0.5) * (H / rows) * 0.7),
      ];
    };
    const grid = Array.from({ length: rows + 1 }, (_, j) => Array.from({ length: cols + 1 }, (_, i) => pt(i, j)));
    this.shards = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const [a, b2, c, d] = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]];
        const tris = random() < 0.5 ? [[a, b2, c], [a, c, d]] : [[a, b2, d], [b2, c, d]];
        for (const tri of tris) {
          const path = new Path2D();
          path.moveTo(...tri[0]);
          path.lineTo(...tri[1]);
          path.lineTo(...tri[2]);
          path.closePath();
          this.shards.push({ path, cx: (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy: (tri[0][1] + tri[1][1] + tri[2][1]) / 3, ox: 0, oy: 0, vx: 0, vy: 0, a: 0, va: 0 });
        }
      }
    }
    this.lastShatter = -10;
    this.slices = [];
    this.flash = 0;
    this.accent = hexToRgb(palette.accent);
    this.hot = hexToRgb(mix(palette.accent, '#ffffff', 0.5));
  },

  // An effect's strength: its own -P setting, else the preset's.
  amount(p, key) {
    const v = p[key];
    if (v === 'auto' || v === undefined) return PRESETS[p.preset]?.[key] ?? 0;
    return Math.max(0, Number(v) || 0);
  },

  draw(ctx, frame, env) {
    const { width: W, height: H, fps, u, palette, random, params: p } = env;
    const dt = 1 / fps;
    this.t += dt;
    const { S, t } = this;
    const grow = 1 - clamp(p.decay) * (1 - (frame.progress ?? 0));
    const A = (k) => this.amount(p, k) * grow;

    // Melt: the half-size buffer drips down column by column when it's loud
    // and heals back towards the photo when it's quiet.
    const meltAmt = A('melt');
    let src = this.base;
    if (meltAmt > 0.01) {
      const { mw, mh } = this;
      if (this.meltFresh) {
        this.melt.getContext('2d').drawImage(this.base, 0, 0, mw, mh);
        this.meltFresh = false;
      }
      this.meltTmp.width = mw;
      this.meltTmp.getContext('2d').drawImage(this.melt, 0, 0);
      this.melt.width = mw;
      const m = this.melt.getContext('2d');
      m.drawImage(this.meltTmp, 0, 0);
      const sw = mw / STRIPS, push = meltAmt * (0.2 + 1.4 * frame.bass + 1.2 * frame.pulse) * mh * 0.006;
      for (let i = 0; i < STRIPS; i++) {
        const dy = push * this.drips[i];
        if (dy < 0.3) continue;
        m.drawImage(this.meltTmp, i * sw, 0, sw + 1, mh, i * sw, dy, sw + 1, mh);
      }
      m.globalAlpha = clamp(0.03 + 0.25 * (1 - clamp(meltAmt)) * (1 - frame.rms) + 0.05 * (1 - frame.rms));
      m.drawImage(this.base, 0, 0, mw, mh);
      m.globalAlpha = 1;
      flatten(this.melt);
      src = this.melt;
    } else this.meltFresh = true;
    const k = src.width / W;
    // Draws the W×H-space region (x, y, w, h) of the source, shifted by dx.
    const region = (c, x, y, w, h, dx = 0) => c.drawImage(src, x * k, y * k, w * k, h * k, x + dx, y, w, h);

    // Build this frame on `comp`, under a slow drift and a kick punch-in.
    this.comp.width = W;
    const c = this.comp.getContext('2d');
    const zoom = 1 + 0.04 * Math.min(1, A('zoom')) + 0.015 * Math.sin(t * 0.25) + 0.07 * A('zoom') * frame.pulse;
    c.save();
    c.translate(W / 2 + Math.sin(t * 0.17) * S * 0.01, H / 2 + Math.cos(t * 0.13) * S * 0.01);
    c.scale(zoom, zoom);
    c.translate(-W / 2, -H / 2);

    // Wave: rows slide sideways with the waveform.
    const waveAmt = A('wave');
    if (waveAmt > 0.01) {
      const wave = sampleWaveform(frame.waveform, ROWS);
      const rh = H / ROWS;
      for (let i = 0; i < ROWS; i++) {
        const dx = waveAmt * S * (0.03 * wave[i] + 0.012 * frame.mid * Math.sin(t * 2 + i * 0.25));
        region(c, 0, i * rh, W, rh + 1, dx);
      }
    } else region(c, 0, 0, W, H);

    // Pixel sorting: bright runs streak downwards, longer when it's loud.
    const sortAmt = A('sort');
    if (sortAmt > 0.01) {
      const level = Math.round(clamp(sortAmt * (0.25 + 0.5 * frame.bass + 0.35 * frame.pulse)) * SORT_STEPS);
      if (level > 0) {
        c.globalAlpha = clamp(0.4 + 0.6 * sortAmt);
        c.drawImage(this.sortedAt(level, env), 0, 0, W, H);
        c.globalAlpha = 1;
      }
    }

    // Slices: horizontal tears on the hits.
    const sliceAmt = A('slices');
    if (sliceAmt > 0.01 && frame.onset && frame.onsetStrength > 0.25) {
      const n = 1 + Math.floor(frame.onsetStrength * 4 * Math.min(2, sliceAmt));
      for (let i = 0; i < n; i++) {
        this.slices.push({ y: random() * H, h: H * (0.008 + random() * 0.07), dx: (random() - 0.5) * S * 0.3 * sliceAmt, life: 0.06 + random() * 0.22, age: 0 });
      }
    }
    for (const sl of this.slices) {
      sl.age += dt;
      region(c, 0, sl.y, W, sl.h, sl.dx * (1 - 0.5 * sl.age / sl.life));
    }
    this.slices = this.slices.filter((sl) => sl.age < sl.life);
    c.restore();

    // Mosaic: pixelated with the bass.
    const mosaicAmt = A('mosaic');
    const block = mosaicAmt * (0.6 * frame.bass + 0.8 * frame.pulse) * S * 0.05;
    if (block >= 3) {
      const tw = Math.ceil(W / block), th = Math.ceil(H / block);
      this.tiny.width = tw;
      this.tiny.height = th;
      this.tiny.getContext('2d').drawImage(this.comp, 0, 0, tw, th);
      c.imageSmoothingEnabled = false;
      c.globalAlpha = clamp(mosaicAmt * (0.4 + frame.pulse));
      c.drawImage(this.tiny, 0, 0, W, H);
      c.globalAlpha = 1;
      c.imageSmoothingEnabled = true;
    }

    // Burn: damage creeps up through the clip and jumps on kicks, for good.
    const burnAmt = A('burn');
    if (burnAmt > 0.01) {
      this.damage += dt * burnAmt * (0.006 + 0.02 * frame.rms) + (frame.kick ? frame.kickStrength * 0.012 * burnAmt : 0);
      this.damage = Math.min(0.92, this.damage);
    }
    if (this.damage > 0.005) {
      if (Math.abs(this.damage - this.burnAt) > 0.002) this.burnMask(this.damage);
      c.globalCompositeOperation = 'destination-out';
      c.drawImage(this.holes, 0, 0, W, H);
      c.globalCompositeOperation = 'source-over';
      c.drawImage(this.scorch, 0, 0, W, H);
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = clamp(0.6 + 0.4 * Math.sin(t * 9) * 0.3 + 0.5 * frame.pulse);
      c.drawImage(this.embers, 0, 0, W, H);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    }

    // Shatter: shards fly out from an impact on big kicks and spring back.
    let final = this.comp;
    const shatterAmt = A('shatter');
    if (shatterAmt > 0.01 && frame.kick && frame.kickStrength > 0.75 && t - this.lastShatter > 1.6 / Math.min(2, shatterAmt)) {
      this.lastShatter = t;
      const ix = W * (0.3 + 0.4 * random()), iy = H * (0.3 + 0.4 * random());
      for (const s of this.shards) {
        const dx = s.cx - ix, dy = s.cy - iy, d = Math.hypot(dx, dy) || 1;
        const force = Math.min(2, shatterAmt) * frame.kickStrength * S * (0.8 + random()) * 1.6 * Math.exp(-d / (S * 0.7));
        s.vx += (dx / d) * force;
        s.vy += (dy / d) * force;
        s.va += (random() - 0.5) * 5 * shatterAmt * frame.kickStrength * Math.exp(-d / (S * 0.7));
      }
    }
    let moving = 0;
    for (const s of this.shards) {
      s.vx += (-s.ox * 45 - s.vx * 8) * dt;
      s.vy += (-s.oy * 45 - s.vy * 8) * dt;
      s.va += (-s.a * 45 - s.va * 8) * dt;
      s.ox += s.vx * dt;
      s.oy += s.vy * dt;
      s.a += s.va * dt;
      moving = Math.max(moving, Math.abs(s.ox) + Math.abs(s.oy) + Math.abs(s.a) * S * 0.2);
    }
    if (moving > 1.5) {
      this.out.width = W;
      const o = this.out.getContext('2d');
      o.lineWidth = 1.5 * u;
      for (const s of this.shards) {
        o.save();
        o.translate(s.cx + s.ox, s.cy + s.oy);
        o.rotate(s.a);
        o.translate(-s.cx, -s.cy);
        o.save();
        o.clip(s.path);
        o.drawImage(this.comp, 0, 0);
        o.restore();
        const crack = clamp((Math.abs(s.ox) + Math.abs(s.oy)) / (S * 0.02));
        if (crack > 0.15) {
          o.strokeStyle = rgba(mix(palette.text, palette.accent, 0.4), 0.6 * crack);
          o.stroke(s.path);
        }
        o.restore();
      }
      final = this.out;
    }

    // RGB split: the three channels pulled apart, wider on the kicks.
    const off = A('rgb') * S * (0.003 + 0.016 * frame.pulse + 0.006 * frame.bass);
    if (off > 0.6) {
      this.split.width = W;
      const sp = this.split.getContext('2d');
      sp.globalCompositeOperation = 'lighter';
      for (const [color, dx, dy] of [['#ff0000', off, 0], ['#00ff00', 0, off * 0.3], ['#0000ff', -off, 0]]) {
        this.chan.width = W;
        const ch = this.chan.getContext('2d');
        ch.drawImage(final, 0, 0);
        ch.globalCompositeOperation = 'multiply';
        ch.fillStyle = color;
        ch.fillRect(0, 0, W, H);
        ch.globalCompositeOperation = 'destination-in';
        ch.drawImage(final, 0, 0);
        sp.drawImage(this.chan, dx, dy);
      }
      final = this.split;
    }
    ctx.drawImage(final, 0, 0);

    // Tint: the palette's colours over the photo's light and shade.
    if (p.tint > 0) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, palette.colors[0]);
      g.addColorStop(0.5, palette.colors[1]);
      g.addColorStop(1, palette.colors.at(-1));
      ctx.globalCompositeOperation = 'color';
      ctx.globalAlpha = clamp(p.tint);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Invert: a negative flash on the hardest hits.
    const invertAmt = A('invert');
    if (invertAmt > 0.01 && ((frame.onset && frame.onsetStrength > 0.8) || (frame.kick && frame.kickStrength > 0.9))) this.flash = 1;
    if (this.flash > 0.02 && invertAmt > 0.01) {
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = rgba('#ffffff', clamp(this.flash * invertAmt));
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }
    this.flash *= Math.exp(-dt * 14);
  },

  // The photo pixel-sorted at one level: in each column, runs among the
  // brightest pixels (the top 4% at level 1, up to 70% at the top level, so it
  // works on dark and bright photos alike) are sorted dark → bright
  // downwards. Transparent elsewhere, so it lies over the photo. Cached.
  sortedAt(level, env) {
    if (this.sorted.has(level)) return this.sorted.get(level);
    const { sw, sh, px, lum } = this;
    const cover = 0.04 + 0.66 * ((level - 1) / (SORT_STEPS - 1));
    const th = this.lumOrder[Math.floor((1 - cover) * (this.lumOrder.length - 1))];
    const canvas = env.createCanvas(sw, sh);
    const g = canvas.getContext('2d');
    const out = g.createImageData(sw, sh);
    const d = out.data;
    for (let x = 0; x < sw; x++) {
      let y = 0;
      while (y < sh) {
        if (lum[y * sw + x] <= th) { y++; continue; }
        const from = y;
        while (y < sh && lum[y * sw + x] > th) y++;
        if (y - from < 3) continue;
        const run = [];
        for (let k = from; k < y; k++) run.push(k * sw + x);
        const order = [...run].sort((a, b) => lum[a] - lum[b]);
        for (let k = 0; k < run.length; k++) {
          const to = run[k] * 4, fromPx = order[k] * 4;
          d[to] = px[fromPx];
          d[to + 1] = px[fromPx + 1];
          d[to + 2] = px[fromPx + 2];
          d[to + 3] = 255;
        }
      }
    }
    g.putImageData(out, 0, 0);
    this.sorted.set(level, canvas);
    return canvas;
  },

  // Rebuilds the burn masks for damage level `th`: holes (where the photo is
  // gone), a scorched ring around them and glowing embers on the edge.
  burnMask(th) {
    this.burnAt = th;
    const { nw, nh, noise } = this;
    const make = (canvas) => {
      canvas.width = nw;
      const g = canvas.getContext('2d');
      return [g, g.createImageData(nw, nh)];
    };
    const [hg, holes] = make(this.holes), [sg, scorch] = make(this.scorch), [eg, embers] = make(this.embers);
    const [ar, ag, ab] = this.accent, [hr, hgc, hb] = this.hot;
    for (let i = 0; i < noise.length; i++) {
      const n = noise[i], e = n - th, j = i * 4;
      holes.data[j + 3] = Math.round(255 * clamp(-e / 0.012));
      scorch.data[j + 3] = Math.round(220 * Math.exp(-((e / 0.05) ** 2)) * (e > 0 ? 1 : 0));
      const glow = Math.exp(-((e / 0.012) ** 2));
      const hot = Math.exp(-((e / 0.005) ** 2));
      embers.data[j] = ar + (hr - ar) * hot;
      embers.data[j + 1] = ag + (hgc - ag) * hot;
      embers.data[j + 2] = ab + (hb - ab) * hot;
      embers.data[j + 3] = Math.round(255 * glow);
    }
    hg.putImageData(holes, 0, 0);
    sg.putImageData(scorch, 0, 0);
    eg.putImageData(embers, 0, 0);
  },
};
