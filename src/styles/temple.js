import { Path2D } from 'skia-canvas';
import { mix, rgba } from '../palettes.js';
import { clamp, sampleSpectrum } from '../util.js';
import { glowSprite, makeStars, drawStars } from '../sea.js';

const TAU = Math.PI * 2;
const DRUMS = 5; // stone drums per column shaft

// Greek key, one repeat in a 4×4 grid (y down). The last point is the first
// point of the next repeat, so repeats chain into one continuous line.
const MEANDER = [[0, 4], [0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 4], [4, 4]];

// Shaft width at height f (0 = foot, 1 = top): tapering, with a slight bulge.
const shaftWidth = (D, f) => D * (1 - 0.2 * f + 0.05 * Math.sin(Math.PI * f));

export default {
  name: 'temple',
  description: 'A Greek temple by moonlight: its column drums split apart on every kick with light pouring out of the cracks, the columns fill with light like a spectrum, braziers flare and a meander frieze runs with the beat',
  palette: 'aegean', // used when no -p is given
  params: {
    columns: 6,     // number of columns (2–12)
    order: 'doric', // doric (plain capitals) or ionic (scrolled capitals, moulded bases)
    split: 1,       // how far the stone drums fly apart on kicks (0 = solid)
    fill: 1,        // light rising in the columns with the spectrum (0 = off)
    light: 1,       // glow from the doorway and the statue inside
    fire: 1,        // braziers in front of the steps (0 = none)
    frieze: 1,      // speed of the meander frieze, one repeat per beat (0 = still)
    moon: 1,        // size of the moon (0 = no moon)
    stars: 1,       // stars (0 = none)
    ruin: 0,        // 0 = intact, up to 1 = broken columns, fallen drums, no roof
  },

  setup(ctx, env) {
    const { width, height, u, cx, cy, random, palette, params: p } = env;
    const S = (this.S = Math.min(width, height));
    this.t = 0;
    this.u = u;
    this.split = 0;
    this.splitV = 0;
    this.embers = [];
    this.grit = [];
    this.ionic = String(p.order).toLowerCase().startsWith('i');

    const n = Math.round(clamp(p.columns, 2, 12));
    const tw = (this.tw = Math.min(width * 0.86, S * 1.05)); // temple width
    this.H = S * 0.38;
    this.D = Math.min(this.H / (this.ionic ? 9 : 7.5), tw / (n * 2.2));
    this.y0 = cy + S * 0.22; // top of the steps, where the columns stand
    this.step = S * 0.028;
    this.horizon = this.y0 - this.H * 0.3;
    const span = tw - this.D * 2;
    this.cols = Array.from({ length: n }, (_, i) => {
      const broken = random() < clamp(p.ruin) * 0.75;
      return {
        x: cx - span / 2 + (n > 1 ? (span * i) / (n - 1) : span / 2),
        level: 0,
        keep: broken ? 1 + Math.floor(random() * (DRUMS - 1)) : DRUMS,
        jag: Array.from({ length: 6 }, () => random()),
      };
    });
    // Fallen drums lying in front of the broken columns.
    this.fallen = [];
    for (const c of this.cols) {
      for (let k = c.keep; k < DRUMS && c.keep < DRUMS; k++) {
        if (random() < 0.6) this.fallen.push({ x: c.x + (random() - 0.5) * this.D * 4, d: random(), tilt: (random() - 0.5) * 0.3 });
      }
    }
    this.fallen.sort((a, b) => a.d - b.d);

    this.stars = makeStars(random, 160 * clamp(p.stars, 0, 3), u);
    this.cypress = [-1, 1].flatMap((side) => [0, 1].map((j) => ({
      x: cx + side * (tw / 2 + S * (0.05 + j * 0.13 + random() * 0.04)),
      h: S * (0.26 + random() * 0.12) * (j ? 0.75 : 1),
      phase: random() * TAU,
    })));
    this.hills = Array.from({ length: 8 }, () => random());
    this.moonGlow = glowSprite(env, palette.text, 80 * u);
    this.fireGlow = glowSprite(env, palette.accent, 120 * u);
    this.ember = glowSprite(env, palette.accent, 10 * u);
  },

  draw(ctx, frame, env) {
    const { width, height, fps, u, cx, palette, random, params: p } = env;
    const dt = 1 / fps;
    this.t += dt;
    const { t, S, D, H, y0, horizon, tw, cols, ionic } = this;

    // Split: a spring kicked open on every kick, settling back shut.
    if (frame.kick) this.splitV += frame.kickStrength * 9;
    this.splitV += (-this.split * 60 - this.splitV * 9) * dt;
    this.split += this.splitV * dt;
    const g = Math.max(0, this.split) * S * 0.02 * p.split; // gap between drums, px
    this.fillAmount = clamp(p.fill, 0, 3);
    this.lightAmount = clamp(p.light, 0, 3);

    const dark = mix(palette.bg[0], '#000000', 0.5);
    const stoneLit = mix(palette.colors[1], palette.colors[2], 0.35);
    const stoneShade = mix(palette.colors[0], dark, 0.35);
    const glow = mix(palette.accent, palette.text, 0.25);

    // Sky.
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, rgba(palette.bg[0], 0.92));
    sky.addColorStop(1, rgba(mix(palette.bg[1], palette.colors[0], 0.5), 0.95));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizon);
    if (this.stars.length) drawStars(ctx, this.stars, env, horizon, t, frame.high);

    // Moon, high to one side of the pediment.
    const mr = S * 0.075 * p.moon;
    const mx = cx + tw * 0.36, my = y0 - H - S * 0.27;
    if (mr > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + 0.2 * frame.rms;
      const hr = mr * 6;
      ctx.drawImage(this.moonGlow, mx - hr, my - hr, hr * 2, hr * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      const mg = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, 0, mx, my, mr);
      mg.addColorStop(0, mix(palette.text, '#ffffff', 0.5));
      mg.addColorStop(1, mix(palette.text, palette.colors[1], 0.4));
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, TAU);
      ctx.fill();
    }

    // The sea below the horizon, with moonlight broken on it.
    const sea = ctx.createLinearGradient(0, horizon, 0, height);
    sea.addColorStop(0, mix(palette.bg[1], palette.colors[0], 0.4));
    sea.addColorStop(1, dark);
    ctx.fillStyle = sea;
    ctx.fillRect(0, horizon, width, height - horizon);
    if (mr > 0) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 14; i++) {
        const a = i / 14;
        const y = horizon + S * 0.006 + a * S * 0.12;
        const w = mr * (0.5 + a * 1.4) * (0.6 + 0.4 * Math.sin(t * 2.5 + i * 2.1)) * (1 + 0.4 * frame.mid);
        ctx.fillStyle = rgba(palette.text, 0.28 * (1 - a));
        ctx.fillRect(mx - w / 2 + Math.sin(t * 1.7 + i) * 6 * u, y, w, (1 + a * 2) * u);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // Hills on either side, then the hilltop the temple stands on.
    ctx.fillStyle = mix(palette.colors[0], dark, 0.6);
    ctx.beginPath();
    ctx.moveTo(0, horizon + S * 0.02);
    for (let i = 0; i <= 48; i++) {
      const f = i / 48, k = f * (this.hills.length - 1), j = Math.floor(k), e = k - j;
      const a = this.hills[j], b = this.hills[Math.min(this.hills.length - 1, j + 1)];
      const side = Math.abs(f - 0.5) * 2; // hills rise towards the edges
      ctx.lineTo(f * width, horizon - (a + (b - a) * e * e * (3 - 2 * e)) * S * 0.06 * side ** 1.5 + S * 0.01);
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();
    const gy = y0 + this.step * 3; // ground in front of the steps
    const ground = ctx.createLinearGradient(0, horizon + S * 0.05, 0, height);
    ground.addColorStop(0, mix(palette.colors[0], dark, 0.55));
    ground.addColorStop(1, dark);
    ctx.fillStyle = ground;
    ctx.beginPath();
    ctx.moveTo(cx - tw * 1.4, height);
    ctx.bezierCurveTo(cx - tw * 0.9, gy - S * 0.05, cx - tw * 0.6, horizon + S * 0.03, cx, horizon + S * 0.03);
    ctx.bezierCurveTo(cx + tw * 0.6, horizon + S * 0.03, cx + tw * 0.9, gy - S * 0.05, cx + tw * 1.4, height);
    ctx.closePath();
    ctx.fill();

    // Cypresses behind the temple, swaying a little with the mids.
    ctx.fillStyle = mix(palette.bg[0], '#000000', 0.3);
    for (const c of this.cypress) {
      const sway = (Math.sin(t * 0.8 + c.phase) * 0.03 + frame.mid * 0.04) * c.h;
      const base = gy - S * 0.01, w = c.h * 0.11;
      ctx.beginPath();
      ctx.moveTo(c.x - w, base);
      ctx.bezierCurveTo(c.x - w * 1.3, base - c.h * 0.5, c.x - w * 0.4 + sway * 0.6, base - c.h * 0.85, c.x + sway, base - c.h);
      ctx.bezierCurveTo(c.x + w * 0.4 + sway * 0.6, base - c.h * 0.85, c.x + w * 1.3, base - c.h * 0.5, c.x + w, base);
      ctx.closePath();
      ctx.fill();
    }

    // Paving in front of the steps, its joints running away from us.
    ctx.strokeStyle = rgba(stoneLit, 0.08);
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath();
    for (let i = -8; i <= 8; i++) {
      ctx.moveTo(cx + i * tw * 0.09, gy);
      ctx.lineTo(cx + i * tw * 0.3, height);
    }
    for (let k = 1; k < 6; k++) {
      const y = gy + (height - gy) * (k / 6) ** 1.6;
      ctx.moveTo(cx - tw * 1.5, y);
      ctx.lineTo(cx + tw * 1.5, y);
    }
    ctx.stroke();

    // Steps: three of them, each a lit tread over a shaded riser.
    for (let i = 2; i >= 0; i--) {
      const w = tw + D * 0.6 + (i + 1) * S * 0.035;
      const y = y0 + i * this.step;
      const riser = ctx.createLinearGradient(0, y, 0, y + this.step);
      riser.addColorStop(0, mix(stoneShade, stoneLit, 0.45));
      riser.addColorStop(1, stoneShade);
      ctx.fillStyle = riser;
      ctx.fillRect(cx - w / 2, y, w, this.step);
      ctx.fillStyle = rgba(stoneLit, 0.7);
      ctx.fillRect(cx - w / 2, y, w, 2 * u);
    }

    // The cella wall behind the columns, with a glowing doorway and the
    // statue of the god standing in it.
    const c0 = cols[0].x, c1 = cols.at(-1).x;
    const wallTop = y0 - H;
    ctx.fillStyle = mix(stoneShade, dark, 0.4);
    ctx.fillRect(c0, wallTop, c1 - c0, H);
    const dw = Math.min(S * 0.17, (c1 - c0) * 0.3), dh = H * 0.72;
    const light = clamp(p.light, 0, 3) * (0.45 + 0.55 * frame.bass + 0.3 * frame.pulse);
    if (p.light > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(cx, y0 - dh * 0.5, 0, cx, y0 - dh * 0.5, dh);
      halo.addColorStop(0, rgba(palette.accent, 0.25 * light));
      halo.addColorStop(1, rgba(palette.accent, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(c0, wallTop, c1 - c0, H);
      ctx.globalCompositeOperation = 'source-over';
    }
    const door = ctx.createLinearGradient(0, y0 - dh, 0, y0);
    door.addColorStop(0, mix(dark, palette.accent, clamp(0.35 * light)));
    door.addColorStop(1, mix(dark, glow, clamp(0.75 * light)));
    ctx.fillStyle = door;
    ctx.fillRect(cx - dw / 2, y0 - dh, dw, dh);
    ctx.fillStyle = rgba(stoneLit, 0.35);
    ctx.fillRect(cx - dw / 2 - D * 0.18, y0 - dh - D * 0.25, dw + D * 0.36, D * 0.25); // lintel
    this.drawStatue(ctx, cx, y0, dh * 0.86, frame, palette, dark);

    // Light from the doorway spilling down the steps towards us.
    if (p.light > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const spill = ctx.createLinearGradient(0, y0, 0, height);
      spill.addColorStop(0, rgba(palette.accent, 0.28 * clamp(light)));
      spill.addColorStop(1, rgba(palette.accent, 0));
      ctx.fillStyle = spill;
      ctx.beginPath();
      ctx.moveTo(cx - dw / 2, y0);
      ctx.lineTo(cx + dw / 2, y0);
      ctx.lineTo(cx + dw * 1.8, height);
      ctx.lineTo(cx - dw * 1.8, height);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    // Columns. Bass in the middle, highs at the ends.
    const levels = sampleSpectrum(frame.spectrum, 32);
    const baseH = ionic ? D * 0.24 : 0, capH = ionic ? D * 0.42 : D * 0.46;
    const shaftH = H - baseH - capH, dh2 = shaftH / DRUMS;
    const gaps = [0];
    for (let k = 1; k <= DRUMS; k++) gaps.push(gaps[k - 1] + g * (0.7 + 0.6 * (k / DRUMS)));
    const lift = gaps[DRUMS];
    const n = cols.length;
    for (const [i, col] of cols.entries()) {
      const d = n > 1 ? Math.abs(i - (n - 1) / 2) / ((n - 1) / 2) : 0;
      const b = Math.min(31, Math.floor(d * 26));
      const target = (levels[b] + levels[Math.min(31, b + 3)]) / 2;
      col.level += (target - col.level) * (target > col.level ? 0.5 : 0.1);
      this.drawColumn(ctx, col, i, { baseH, capH, dh: dh2, gaps, g, frame, palette, stoneLit, stoneShade, glow });
    }

    // Entablature and pediment, carried on the columns and lifting with them.
    const intact = cols.every((c) => c.keep === DRUMS);
    let top = y0 - H - lift;
    const runs = [];
    for (let i = 0; i < n; i++) {
      if (cols[i].keep < DRUMS) continue;
      let j = i;
      while (j + 1 < n && cols[j + 1].keep === DRUMS) j++;
      if (j > i) runs.push([cols[i].x - D * 0.75, cols[j].x + D * 0.75]);
      i = j;
    }
    if (runs.length) {
      const ah = S * 0.042, fh = S * 0.046, ch = S * 0.022;
      const layer = (y, h, x0, x1, f) => {
        const grad = ctx.createLinearGradient(0, y - h, 0, y);
        grad.addColorStop(0, mix(stoneLit, palette.text, 0.1 * f));
        grad.addColorStop(1, mix(stoneShade, stoneLit, 0.4));
        ctx.fillStyle = grad;
        ctx.fillRect(x0, y - h, x1 - x0, h);
      };
      const gapGlow = (y, x0, x1, gh) => {
        if (gh < 0.5) return;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba(glow, clamp(gh / (S * 0.008)) * 0.8);
        ctx.fillRect(x0, y - gh, x1 - x0, gh);
        ctx.globalCompositeOperation = 'source-over';
      };
      // Architrave (stepped bands on ionic).
      top -= g * 1.1;
      for (const [x0, x1] of runs) {
        gapGlow(top + g * 1.1, x0, x1, g * 1.1);
        layer(top, ah, x0, x1, 1);
        if (ionic) {
          ctx.fillStyle = rgba(stoneShade, 0.5);
          for (const f of [0.33, 0.66]) ctx.fillRect(x0, top - ah * f, x1 - x0, 1.5 * u);
        }
      }
      top -= ah + g * 1.2;
      // Frieze with the running meander.
      for (const [x0, x1] of runs) {
        gapGlow(top + g * 1.2, x0, x1, g * 1.2);
        layer(top, fh, x0, x1, 0.5);
        this.drawMeander(ctx, x0, top - fh, x1 - x0, fh, frame, p, palette, stoneShade);
      }
      top -= fh + g * 1.3;
      // Cornice, overhanging, with a row of dentils under it.
      const over = D * 0.25;
      for (const [x0, x1] of runs) {
        gapGlow(top + g * 1.3, x0 - over, x1 + over, g * 1.3);
        layer(top, ch, x0 - over, x1 + over, 1.5);
        ctx.fillStyle = rgba(stoneShade, 0.6);
        const dent = ch * 0.5;
        for (let x = x0 - over + dent * 0.5; x < x1 + over - dent; x += dent * 1.8) ctx.fillRect(x, top - dent * 0.9, dent, dent * 0.9);
      }
      top -= ch;
      if (intact) this.drawPediment(ctx, runs[0][0] - over, runs[0][1] + over, top - g * 1.4, g * 1.4, frame, p, palette, { stoneLit, stoneShade, glow, dark });
    }

    // Grit shaken loose from the stones on hard hits.
    if (frame.kick && g > 0) {
      for (let k = 0; k < 6 * frame.kickStrength * p.split; k++) {
        this.grit.push({ x: c0 - D + random() * (c1 - c0 + D * 2), y: y0 - H - lift, vy: random() * 40 * u, size: (1 + random() * 2.5) * u });
      }
    }
    ctx.fillStyle = rgba(stoneLit, 0.7);
    this.grit = this.grit.filter((s) => {
      s.vy += 900 * u * dt;
      s.y += s.vy * dt;
      ctx.fillRect(s.x, s.y, s.size, s.size);
      return s.y < y0;
    });

    // Fallen drums lying in front of the steps.
    for (const f of this.fallen) {
      const y = gy + S * 0.03 + f.d * (height - gy) * 0.35;
      const len = dh2 * (1 + f.d * 0.5), r = D * 0.5 * (1 + f.d * 0.5);
      ctx.save();
      ctx.translate(f.x, y);
      ctx.rotate(f.tilt);
      const side = ctx.createLinearGradient(0, -r * 2, 0, 0);
      side.addColorStop(0, stoneLit);
      side.addColorStop(1, stoneShade);
      ctx.fillStyle = side;
      ctx.fillRect(-len / 2, -r * 2, len, r * 2);
      ctx.fillStyle = mix(stoneShade, stoneLit, 0.3);
      ctx.beginPath();
      ctx.ellipse(len / 2, -r, r * 0.35, r, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // Braziers flanking the doorway, flaring with the highs and the kicks.
    if (p.fire > 0 && n > 1) {
      const bx = [(cols[0].x + cols[1].x) / 2, (cols[n - 2].x + cols[n - 1].x) / 2];
      for (const [k, x] of bx.entries()) this.drawBrazier(ctx, x, gy + S * 0.04, k, frame, env);
      const alive = [];
      ctx.globalCompositeOperation = 'lighter';
      for (const e of this.embers) {
        e.age += dt;
        if (e.age > e.life) continue;
        e.x += e.vx * dt + Math.sin(t * 3 + e.phase) * 12 * u * dt;
        e.y += e.vy * dt;
        const r = e.size * (1 - e.age / e.life);
        ctx.globalAlpha = clamp(1 - e.age / e.life);
        ctx.drawImage(this.ember, e.x - r, e.y - r, r * 2, r * 2);
        alive.push(e);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      this.embers = alive.slice(-300);
    }
  },

  drawColumn(ctx, col, i, { baseH, capH, dh, gaps, g, frame, palette, stoneLit, stoneShade, glow }) {
    const { D, y0, S, ionic } = this;
    const x = col.x, u = this.u;
    const shade = ctx.createLinearGradient(x - D * 0.75, 0, x + D * 0.75, 0);
    shade.addColorStop(0, stoneShade);
    shade.addColorStop(0.3, mix(stoneShade, stoneLit, 0.6));
    shade.addColorStop(0.62, stoneLit);
    shade.addColorStop(1, mix(stoneShade, stoneLit, 0.25));

    // Ionic base: a plinth and two round mouldings.
    if (ionic) {
      ctx.fillStyle = shade;
      ctx.fillRect(x - D * 0.68, y0 - baseH * 0.35, D * 1.36, baseH * 0.35);
      ctx.beginPath();
      ctx.roundRect(x - D * 0.62, y0 - baseH * 0.7, D * 1.24, baseH * 0.38, baseH * 0.19);
      ctx.roundRect(x - D * 0.55, y0 - baseH, D * 1.1, baseH * 0.32, baseH * 0.16);
      ctx.fill();
    }

    // Shaft, drum by drum, each lifted by the gaps below it.
    const body = new Path2D(), flutes = new Path2D();
    const drums = [];
    for (let k = 0; k < col.keep; k++) {
      const off = gaps[k];
      const wob = Math.sin(k * 2.3 + i * 1.7) * g * 0.3;
      const fb = k / DRUMS, ft = (k + 1) / DRUMS;
      const yb = y0 - baseH - k * dh - off, yt = yb - dh;
      const wb = shaftWidth(D, fb) / 2, wt = shaftWidth(D, ft) / 2;
      body.moveTo(x + wob - wb, yb);
      if (k === col.keep - 1 && col.keep < DRUMS) {
        // Broken top: a jagged edge.
        const jag = col.jag;
        for (let j = 0; j < jag.length; j++) {
          const f = j / (jag.length - 1);
          body.lineTo(x + wob - wt + f * wt * 2, yt + jag[j] * dh * 0.45);
        }
      } else {
        body.lineTo(x + wob - wt, yt);
        body.lineTo(x + wob + wt, yt);
      }
      body.lineTo(x + wob + wb, yb);
      body.closePath();
      for (let j = 1; j < 10; j++) {
        const s = Math.sin(-Math.PI / 2 + (j / 10) * Math.PI);
        flutes.moveTo(x + wob + s * wb * 0.92, yb);
        flutes.lineTo(x + wob + s * wt * 0.92, yt + (k === col.keep - 1 && col.keep < DRUMS ? dh * 0.3 : 0));
      }
      drums.push({ yb, yt, w: Math.max(wb, wt), wob });
    }
    ctx.fillStyle = shade;
    ctx.fill(body);
    ctx.strokeStyle = rgba(stoneShade, 0.45);
    ctx.lineWidth = Math.max(1, D * 0.025);
    ctx.stroke(flutes);

    // Light rising inside the column with its slice of the spectrum.
    const lvl = clamp(col.level) * this.fillAmount;
    if (lvl > 0.01) {
      const yb = y0 - baseH, yt = yb - (y0 - baseH - (drums.at(-1)?.yt ?? yb)) * lvl;
      ctx.save();
      ctx.clip(body);
      ctx.globalCompositeOperation = 'lighter';
      const fill = ctx.createLinearGradient(0, yb, 0, yt);
      fill.addColorStop(0, rgba(palette.accent, 0.4));
      fill.addColorStop(0.75, rgba(palette.accent, 0.18));
      fill.addColorStop(1, rgba(palette.accent, 0));
      ctx.fillStyle = fill;
      ctx.fillRect(x - D, yt, D * 2, yb - yt);
      ctx.strokeStyle = fill;
      ctx.lineWidth = Math.max(1, D * 0.03);
      ctx.stroke(flutes);
      ctx.restore();
    }

    // Light pouring out of the cracks between drums.
    if (g > 0.5) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = palette.accent;
      ctx.shadowBlur = 18 * u;
      for (let k = 1; k <= Math.min(col.keep, DRUMS - 1); k++) {
        const a = drums[k - 1], b = drums[k];
        if (!b) break;
        ctx.fillStyle = rgba(glow, clamp((a.yt - b.yb) / (S * 0.008)) * 0.85);
        ctx.fillRect(x - a.w * 1.05, b.yb, a.w * 2.1, a.yt - b.yb);
      }
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (col.keep < DRUMS) return;

    // Capital.
    const top = drums.at(-1);
    const yc = y0 - baseH - DRUMS * dh - gaps[DRUMS]; // capital sits on the last gap
    if (g > 0.5) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(glow, clamp((top.yt - yc) / (S * 0.008)) * 0.85);
      ctx.fillRect(x - top.w * 1.1, yc, top.w * 2.2, top.yt - yc);
      ctx.globalCompositeOperation = 'source-over';
    }
    const wt = shaftWidth(D, 1) / 2;
    ctx.fillStyle = shade;
    if (ionic) {
      ctx.fillRect(x - wt * 1.05, yc - capH * 0.2, wt * 2.1, capH * 0.2); // echinus band
      ctx.beginPath();
      ctx.roundRect(x - D * 0.72, yc - capH * 0.75, D * 1.44, capH * 0.55, capH * 0.2); // cushion
      ctx.fill();
      ctx.fillRect(x - D * 0.62, yc - capH, D * 1.24, capH * 0.25); // abacus
      // Volutes: a spiral rolled up at each end.
      const vr = capH * 0.42;
      ctx.strokeStyle = rgba(stoneShade, 0.8);
      ctx.lineWidth = Math.max(1, D * 0.04);
      for (const side of [-1, 1]) {
        const vx = x + side * D * 0.62, vy = yc - capH * 0.42;
        ctx.fillStyle = shade;
        ctx.beginPath();
        ctx.arc(vx, vy, vr, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        for (let a = 0; a <= 3 * TAU; a += 0.3) {
          const r = vr * 0.92 * (1 - a / (3.4 * TAU));
          const px = vx + side * Math.cos(a) * r, py = vy + Math.sin(a) * r;
          a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    } else {
      // Doric: a flared cushion under a square slab.
      const eh = capH * 0.5;
      ctx.beginPath();
      ctx.moveTo(x - wt, yc);
      ctx.quadraticCurveTo(x - wt, yc - eh * 0.7, x - D * 0.68, yc - eh);
      ctx.lineTo(x + D * 0.68, yc - eh);
      ctx.quadraticCurveTo(x + wt, yc - eh * 0.7, x + wt, yc);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - D * 0.7, yc - capH, D * 1.4, capH - eh);
      ctx.fillStyle = rgba(stoneShade, 0.5);
      ctx.fillRect(x - wt, yc - capH * 0.1, wt * 2, 1.5 * u); // necking groove
    }
  },

  // The god in the doorway: a backlit silhouette with spear and shield
  // whose eyes flash on the kicks.
  drawStatue(ctx, x, base, h, frame, palette, dark) {
    const p = (dx, dy) => [x + dx * h, base + dy * h];
    ctx.fillStyle = mix(dark, '#000000', 0.3);
    ctx.fillRect(...p(-0.2, -0.07), h * 0.4, h * 0.07); // pedestal
    const fig = new Path2D();
    fig.moveTo(...p(-0.17, -0.07));
    fig.bezierCurveTo(...p(-0.16, -0.35), ...p(-0.14, -0.6), ...p(-0.13, -0.7));
    fig.quadraticCurveTo(...p(-0.06, -0.76), ...p(-0.03, -0.77));
    fig.lineTo(...p(0.03, -0.77));
    fig.quadraticCurveTo(...p(0.06, -0.76), ...p(0.13, -0.7));
    fig.lineTo(...p(0.19, -0.5)); // arm out to the spear
    fig.lineTo(...p(0.2, -0.46));
    fig.lineTo(...p(0.14, -0.55));
    fig.bezierCurveTo(...p(0.14, -0.4), ...p(0.16, -0.2), ...p(0.17, -0.07));
    fig.closePath();
    fig.arc(...p(0, -0.83), h * 0.06, 0, TAU); // head
    // Crested helmet.
    fig.moveTo(...p(-0.07, -0.85));
    fig.quadraticCurveTo(...p(-0.06, -0.97), ...p(0.06, -0.95));
    fig.quadraticCurveTo(...p(-0.02, -0.92), ...p(-0.13, -0.8));
    fig.closePath();
    // Shield on the left arm.
    fig.ellipse(...p(-0.18, -0.4), h * 0.13, h * 0.15, 0, 0, TAU);
    ctx.fill(fig);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = h * 0.018;
    ctx.beginPath();
    ctx.moveTo(...p(0.2, -0.04));
    ctx.lineTo(...p(0.2, -1.04));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(...p(0.185, -1.02));
    ctx.lineTo(...p(0.2, -1.1));
    ctx.lineTo(...p(0.215, -1.02));
    ctx.fill();
    // Eyes.
    const e = clamp(0.25 + 1.2 * frame.pulse) * this.lightAmount;
    if (e > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = e;
      const r = h * 0.035 * (1 + frame.pulse);
      for (const s of [-1, 1]) {
        const [ex, ey] = p(s * 0.022, -0.835);
        ctx.drawImage(this.fireGlow, ex - r, ey - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  },

  // Greek key along the frieze, running one repeat per beat.
  drawMeander(ctx, x, y, w, h, frame, p, palette, stoneShade) {
    const m = h * 0.7, unit = m / 4, oy = y + (h - m) / 2;
    const shift = (((frame.bars ?? this.t / 2) * 4 * p.frieze) % 1) * m;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const key = new Path2D();
    for (let cx = x - m * 2 + shift; cx < x + w + m; cx += m) {
      for (const [j, [px, py]] of MEANDER.entries()) {
        if (j === 0) key.moveTo(cx + px * unit, oy + py * unit);
        else key.lineTo(cx + px * unit, oy + py * unit);
      }
    }
    ctx.lineWidth = unit * 0.55;
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = rgba(stoneShade, 0.75);
    ctx.stroke(key);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(palette.accent, 0.12 + 0.5 * frame.pulse);
    ctx.stroke(key);
    ctx.restore();
  },

  // Triangular pediment with a sunburst in the middle playing the spectrum,
  // palmettes at the corners. Lifts off the cornice by `gap` on kicks.
  drawPediment(ctx, x0, x1, base, gap, frame, p, palette, { stoneLit, stoneShade, glow, dark }) {
    const { S } = this;
    const w = x1 - x0, ph = w * 0.13, mid = (x0 + x1) / 2;
    if (gap > 0.5) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(glow, clamp(gap / (S * 0.008)) * 0.8);
      ctx.fillRect(x0, base, w, gap);
      ctx.globalCompositeOperation = 'source-over';
    }
    const tri = new Path2D();
    tri.moveTo(x0, base);
    tri.lineTo(mid, base - ph);
    tri.lineTo(x1, base);
    tri.closePath();
    const grad = ctx.createLinearGradient(0, base - ph, 0, base);
    grad.addColorStop(0, stoneLit);
    grad.addColorStop(1, mix(stoneShade, stoneLit, 0.5));
    ctx.fillStyle = grad;
    ctx.fill(tri);
    // Recessed tympanum.
    const inset = ph * 0.16, k = inset / ph;
    const tym = new Path2D();
    tym.moveTo(x0 + w * k * 0.9, base - inset * 0.4);
    tym.lineTo(mid, base - ph + inset);
    tym.lineTo(x1 - w * k * 0.9, base - inset * 0.4);
    tym.closePath();
    ctx.fillStyle = mix(stoneShade, dark, 0.3);
    ctx.fill(tym);

    // Sunburst: spokes for the spectrum, kept inside the tympanum.
    const r = ph * 0.26, sy = base - ph * 0.38;
    ctx.save();
    ctx.clip(tym);
    if (p.light > 0) {
      const n = 40, levels = sampleSpectrum(frame.spectrum, n / 2);
      const spokes = new Path2D();
      for (let i = 0; i < n; i++) {
        const v = levels[i < n / 2 ? i : n - 1 - i];
        const a = (i / n) * TAU - Math.PI / 2, wa = (TAU / n) * 0.25;
        const r1 = r * (1.15 + 2.2 * v);
        spokes.moveTo(mid + Math.cos(a - wa) * r * 1.08, sy + Math.sin(a - wa) * r * 1.08);
        spokes.lineTo(mid + Math.cos(a) * r1, sy + Math.sin(a) * r1);
        spokes.lineTo(mid + Math.cos(a + wa) * r * 1.08, sy + Math.sin(a + wa) * r * 1.08);
        spokes.closePath();
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(palette.accent, clamp((0.3 + 0.5 * frame.pulse) * this.lightAmount));
      ctx.fill(spokes);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    const disc = ctx.createRadialGradient(mid, sy, 0, mid, sy, r);
    disc.addColorStop(0, mix(stoneLit, palette.accent, clamp(0.2 + 0.6 * frame.pulse) * Math.min(1, this.lightAmount)));
    disc.addColorStop(1, stoneShade);
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(mid, sy, r, 0, TAU);
    ctx.fill();

    // Raking cornice along the two sloping edges.
    ctx.strokeStyle = mix(stoneLit, palette.text, 0.2);
    ctx.lineWidth = ph * 0.07;
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    ctx.moveTo(x0 - ph * 0.1, base + ph * 0.02);
    ctx.lineTo(mid, base - ph - ph * 0.04);
    ctx.lineTo(x1 + ph * 0.1, base + ph * 0.02);
    ctx.stroke();

    // Palmettes at the apex and the corners.
    for (const [px, py, s] of [[mid, base - ph * 1.06, 1], [x0, base - ph * 0.05, 0.75], [x1, base - ph * 0.05, 0.75]]) {
      const pr = ph * 0.26 * s;
      ctx.fillStyle = stoneLit;
      ctx.beginPath();
      for (let j = -2; j <= 2; j++) {
        const a = -Math.PI / 2 + j * 0.42;
        ctx.ellipse(px + Math.cos(a) * pr * 0.5, py + Math.sin(a) * pr * 0.5, pr * 0.5, pr * 0.14, a, 0, TAU);
      }
      ctx.fill();
    }
  },

  // Bronze tripod with a fire bowl.
  drawBrazier(ctx, x, base, k, frame, { u, fps, palette, random, params: p }) {
    const { S, t } = this;
    const dark = mix(palette.bg[0], '#000000', 0.5);
    const h = S * 0.11, bw = S * 0.045;
    const bronze = mix(palette.colors[0], palette.accent, 0.25);
    ctx.strokeStyle = mix(bronze, dark, 0.4);
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    for (const s of [-1, 0, 1]) {
      ctx.moveTo(x + s * bw * 0.4, base - h);
      ctx.lineTo(x + s * bw * 0.85, base);
    }
    ctx.stroke();
    ctx.fillStyle = bronze;
    ctx.beginPath();
    ctx.moveTo(x - bw, base - h);
    ctx.quadraticCurveTo(x, base - h * 0.55, x + bw, base - h);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - bw * 1.08, base - h - 3 * u, bw * 2.16, 4 * u);

    // Flames: three licking tongues, taller with the highs and the kicks.
    const f = clamp(p.fire, 0, 3);
    const fh = S * (0.05 + 0.07 * frame.high + 0.07 * frame.pulse) * f;
    const fy = base - h - 2 * u;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(0.3 + 0.4 * frame.pulse + 0.2 * frame.high) * Math.min(1, f);
    const gr = S * 0.22 * (0.8 + 0.5 * frame.pulse) * Math.min(1.5, f);
    ctx.drawImage(this.fireGlow, x - gr, fy - fh * 0.4 - gr, gr * 2, gr * 2);
    ctx.globalAlpha = 1;
    const tongues = [[-0.5, 0.7, palette.colors[1]], [0.45, 0.8, palette.colors[1]], [0, 1, palette.accent], [0, 0.55, palette.text]];
    for (const [j, [dx, s, color]] of tongues.entries()) {
      const flick = 0.8 + 0.2 * Math.sin(t * (11 + j * 3) + k * 2 + j) + 0.1 * Math.sin(t * 23 + j);
      const th = fh * s * flick, tw = bw * (0.45 + 0.25 * s);
      const sway = Math.sin(t * 5 + j + k) * tw * 0.4;
      const fx = x + dx * bw * 0.6;
      ctx.fillStyle = rgba(color, j === 3 ? 0.55 : 0.5);
      ctx.beginPath();
      ctx.moveTo(fx - tw, fy);
      ctx.bezierCurveTo(fx - tw, fy - th * 0.45, fx + sway - tw * 0.2, fy - th * 0.7, fx + sway, fy - th);
      ctx.bezierCurveTo(fx + sway + tw * 0.2, fy - th * 0.7, fx + tw, fy - th * 0.45, fx + tw, fy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // Embers drifting up.
    const rate = (6 + 30 * frame.high + (frame.kick ? 25 * frame.kickStrength : 0)) * f;
    const spawn = rate / fps;
    for (let i = 0; i < Math.floor(spawn) + (random() < spawn % 1 ? 1 : 0); i++) {
      this.embers.push({
        x: x + (random() - 0.5) * bw, y: fy - fh * 0.3,
        vx: (random() - 0.5) * 30 * u, vy: -(60 + random() * 120) * u,
        size: (3 + random() * 5) * u, life: 0.8 + random() * 1.4, age: 0, phase: random() * TAU,
      });
    }
  },
};
