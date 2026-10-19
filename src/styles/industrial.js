import { Path2D } from 'skia-canvas';
import { mix, rgba } from '../palettes.js';
import { sampleSpectrum } from '../util.js';

const TAU = Math.PI * 2;
const BIG_TEETH = 36;

// Outline of a gear with trapezoid teeth. Tooth i is centred on angle + i * step.
function addGear(path, x, y, r, depth, teeth, angle) {
  const root = r - depth;
  const step = TAU / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = angle + i * step;
    const pts = [[root, a - step * 0.5], [root, a - step * 0.26], [r, a - step * 0.14], [r, a + step * 0.14], [root, a + step * 0.26]];
    pts.forEach(([rr, aa], j) => {
      const X = x + Math.cos(aa) * rr, Y = y + Math.sin(aa) * rr;
      i === 0 && j === 0 ? path.moveTo(X, Y) : path.lineTo(X, Y);
    });
  }
  path.closePath();
  return path;
}

function addCircle(path, x, y, r) {
  path.moveTo(x + r, y);
  path.arc(x, y, r, 0, TAU);
  return path;
}

function addPolygon(path, x, y, r, sides, angle) {
  for (let i = 0; i <= sides; i++) {
    const a = angle + (i / sides) * TAU;
    i ? path.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : path.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  return path;
}

// Annular sector — one block of the LED meter.
function addSegment(path, rIn, rOut, a, halfWidth) {
  path.moveTo(Math.cos(a - halfWidth) * rIn, Math.sin(a - halfWidth) * rIn);
  path.arc(0, 0, rOut, a - halfWidth, a + halfWidth);
  path.arc(0, 0, rIn, a + halfWidth, a - halfWidth, true);
  path.closePath();
}

export default {
  name: 'industrial',
  description: 'Interlocking gears that ratchet on the kick, hydraulic pistons, LED meters, sparks and hazard stripes',
  palette: 'hazard', // used when no -p is given
  params: {
    scale: 1,          // size of the gear assembly
    speed: 0.06,       // gear rotation in turns per second (scaled by loudness)
    ratchet: 1,        // teeth the big gear jumps forward on each kick (0 = smooth)
    pistons: 'auto',   // auto (on for tall formats), 1 = always, 0 = off
    meter: 1,          // LED spectrum meter inside the big gear
    sparks: 1,         // spark showers on kicks (scales amount, 0 = off)
    shake: 1,          // camera jolt on kicks (0 = steady)
    stripes: 1,        // hazard stripe bands top and bottom
    hud: 1,            // monospace readouts
    scanlines: 1,
    strobe: 0,         // white flash on hard kicks (0–1)
  },

  setup(ctx, env) {
    const { width, height, u, palette, createCanvas, params: p } = env;
    this.base = 0;
    this.ratchetPos = 0;
    this.ratchetTarget = 0;
    this.prevAngle = 0;
    this.scroll = 0;
    this.kicks = 0;
    this.sparks = [];

    // Blueprint grid and scanlines are static, so draw them once.
    this.grid = createCanvas(width, height);
    const g = this.grid.getContext('2d');
    const cell = 54 * u;
    for (let i = 0, x = 0; x <= width; i++, x += cell) {
      g.fillStyle = rgba(palette.text, i % 4 ? 0.035 : 0.07);
      g.fillRect(Math.round(x), 0, Math.max(1, u), height);
    }
    for (let i = 0, y = 0; y <= height; i++, y += cell) {
      g.fillStyle = rgba(palette.text, i % 4 ? 0.035 : 0.07);
      g.fillRect(0, Math.round(y), width, Math.max(1, u));
    }
    if (p.scanlines > 0) {
      this.lines = createCanvas(width, height);
      const l = this.lines.getContext('2d');
      l.fillStyle = 'rgba(0,0,0,0.22)';
      const gap = Math.max(2, Math.round(4 * u));
      for (let y = 0; y < height; y += gap) l.fillRect(0, y, width, Math.max(1, Math.round(gap / 2)));
    }
  },

  draw(ctx, frame, env) {
    const { width, height, cx, cy, u, fps, palette, params: p, random, analysis } = env;
    const dt = 1 / fps;
    const tall = height / width > 1.5;
    const size = Math.min(width, height);
    const R = size * 0.27 * p.scale;
    const depth = R * 0.1;
    const metal = palette.colors[0];
    const lit = palette.colors[1];
    const hot = palette.colors.at(-1);
    const edge = mix(metal, '#ffffff', 0.35);

    ctx.drawImage(this.grid, 0, 0);

    // --- Drive: continuous rotation plus a one-tooth ratchet jump per kick.
    if (frame.kick) {
      this.kicks++;
      this.ratchetTarget += (TAU / BIG_TEETH) * p.ratchet;
    }
    this.base += p.speed * (0.25 + frame.rms) * TAU * dt;
    this.ratchetPos += (this.ratchetTarget - this.ratchetPos) * (1 - 0.5 ** (30 / fps));
    const angle = this.base + this.ratchetPos;
    const rpm = ((angle - this.prevAngle) / dt / TAU) * 60;
    this.prevAngle = angle;

    // --- Camera jolt on kicks.
    ctx.save();
    if (p.shake > 0) {
      const j = 14 * u * p.shake * frame.pulse ** 2;
      ctx.translate((random() - 0.5) * j, (random() - 0.5) * j);
    }

    const drawGear = (x, y, r, teeth, a, kind) => {
      const path = addGear(new Path2D(), x, y, r, depth, teeth, a);
      if (kind === 'ring') addCircle(path, x, y, r * 0.78);
      else for (let i = 0; i < 5; i++) addCircle(path, x + Math.cos(a + (i / 5) * TAU) * r * 0.5, y + Math.sin(a + (i / 5) * TAU) * r * 0.5, r * 0.17);
      const grad = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
      grad.addColorStop(0, mix(metal, '#ffffff', 0.12));
      grad.addColorStop(1, mix(metal, '#000000', 0.55));
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = 24 * u;
      ctx.shadowOffsetY = 10 * u;
      ctx.fillStyle = grad;
      ctx.fill(path, 'evenodd');
      ctx.restore();
      ctx.strokeStyle = edge;
      ctx.lineWidth = 2 * u;
      ctx.stroke(path);

      const bolts = new Path2D();
      if (kind === 'ring') {
        for (let i = 0; i < 12; i++) {
          const b = a + (i / 12) * TAU;
          addCircle(bolts, x + Math.cos(b) * r * 0.835, y + Math.sin(b) * r * 0.835, r * 0.018);
        }
      } else {
        addCircle(bolts, x, y, r * 0.22);
      }
      ctx.fillStyle = mix(metal, '#000000', 0.3);
      ctx.fill(bolts);
      ctx.stroke(bolts);
      if (kind !== 'ring') {
        ctx.fillStyle = edge;
        ctx.fill(addPolygon(new Path2D(), x, y, r * 0.11, 6, a));
      }
    };

    // --- Side gears, meshed with the big one: tooth counts follow the pitch
    // radii, and the phase offsets so teeth sit in each other's gaps.
    const r = R * 0.5;
    const smallTeeth = Math.round((BIG_TEETH * (r - depth / 2)) / (R - depth / 2));
    const meshes = [Math.PI + 0.35, 0.35].map((phi) => {
      const D = R + r - depth;
      const x = cx + Math.cos(phi) * D, y = cy + Math.sin(phi) * D;
      const a = -(BIG_TEETH / smallTeeth) * (angle - phi) + phi + Math.PI + Math.PI / smallTeeth;
      drawGear(x, y, r, smallTeeth, a, 'spoked');
      return { x: cx + Math.cos(phi) * (R - depth / 2), y: cy + Math.sin(phi) * (R - depth / 2), phi };
    });

    drawGear(cx, cy, R, BIG_TEETH, angle, 'ring');

    // --- LED meter inside the big gear (stays still while the ring turns).
    if (p.meter > 0) {
      const bars = 40, blocks = 7;
      const values = sampleSpectrum(frame.spectrum, bars / 2);
      const rIn = R * 0.25, rOut = R * 0.7;
      const blockH = (rOut - rIn) / blocks;
      const paths = { off: new Path2D(), on: new Path2D(), peak: new Path2D() };
      for (let i = 0; i < bars; i++) {
        const v = values[i < bars / 2 ? i : bars - 1 - i];
        const a = (i / bars) * TAU - Math.PI / 2 + Math.PI / bars;
        const litCount = Math.round(v * blocks);
        for (let b = 0; b < blocks; b++) {
          const state = b >= litCount ? 'off' : b === blocks - 1 || (b === litCount - 1 && v > 0.8) ? 'peak' : 'on';
          addSegment(paths[state], rIn + b * blockH + blockH * 0.12, rIn + (b + 1) * blockH - blockH * 0.12, a, (Math.PI / bars) * 0.7);
        }
      }
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = rgba(lit, 0.08);
      ctx.fill(paths.off);
      ctx.shadowColor = lit;
      ctx.shadowBlur = (6 + 14 * frame.pulse) * u;
      ctx.fillStyle = lit;
      ctx.fill(paths.on);
      ctx.shadowColor = hot;
      ctx.fillStyle = hot;
      ctx.fill(paths.peak);
      ctx.restore();

      // Hub with a hex bolt.
      ctx.fillStyle = mix(metal, '#000000', 0.4);
      ctx.strokeStyle = edge;
      const hub = addCircle(new Path2D(), cx, cy, R * 0.19);
      ctx.fill(hub);
      ctx.stroke(hub);
      ctx.fillStyle = frame.pulse > 0.5 ? hot : edge;
      ctx.fill(addPolygon(new Path2D(), cx, cy, R * 0.09, 6, angle));
    }

    // --- Pistons above the gears, one per frequency band.
    const showPistons = p.pistons === 'auto' ? tall : Number(p.pistons) > 0;
    if (showPistons) {
      const count = 8;
      const values = sampleSpectrum(frame.spectrum, count);
      const span = R * 2;
      const slot = span / count;
      const top = cy - R * 1.78;
      const housingH = R * 0.3;
      for (let i = 0; i < count; i++) {
        const x = cx - span / 2 + slot * (i + 0.5);
        const v = Math.min(1, values[i] + (i < 2 ? frame.pulse * 0.25 : 0));
        const ext = (0.12 + 0.88 * v) * R * 0.3;
        const hw = slot * 0.3, rw = slot * 0.1, headW = slot * 0.26;

        const rod = ctx.createLinearGradient(x - rw, 0, x + rw, 0);
        rod.addColorStop(0, mix(metal, '#ffffff', 0.2));
        rod.addColorStop(0.5, mix(metal, '#ffffff', 0.75));
        rod.addColorStop(1, mix(metal, '#ffffff', 0.15));
        ctx.fillStyle = rod;
        ctx.fillRect(x - rw, top + housingH - 2 * u, rw * 2, ext + 2 * u);

        const head = top + housingH + ext;
        ctx.fillStyle = v > 0.75 ? hot : lit;
        ctx.globalAlpha = 0.45 + 0.55 * v;
        ctx.fillRect(x - headW, head, headW * 2, R * 0.07);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = edge;
        ctx.lineWidth = 1.5 * u;
        ctx.strokeRect(x - headW, head, headW * 2, R * 0.07);

        const housing = ctx.createLinearGradient(x - hw, 0, x + hw, 0);
        housing.addColorStop(0, mix(metal, '#000000', 0.5));
        housing.addColorStop(0.4, mix(metal, '#ffffff', 0.1));
        housing.addColorStop(1, mix(metal, '#000000', 0.6));
        ctx.fillStyle = housing;
        ctx.fillRect(x - hw, top, hw * 2, housingH);
        ctx.strokeRect(x - hw, top, hw * 2, housingH);
        ctx.fillStyle = edge;
        const rivets = new Path2D();
        for (const ry of [0.18, 0.82]) addCircle(rivets, x, top + housingH * ry, 2.2 * u);
        ctx.fill(rivets);
      }
      // Mounting beam the pistons hang from.
      ctx.fillStyle = mix(metal, '#000000', 0.3);
      ctx.fillRect(cx - span / 2 - slot * 0.3, top - R * 0.06, span + slot * 0.6, R * 0.06);
      ctx.strokeRect(cx - span / 2 - slot * 0.3, top - R * 0.06, span + slot * 0.6, R * 0.06);
    }

    // --- Sparks fly from where the gears mesh.
    if (p.sparks > 0 && frame.kick) {
      for (const m of meshes) {
        const n = Math.round(22 * p.sparks * (0.5 + frame.kickStrength));
        for (let i = 0; i < n; i++) {
          const a = m.phi + Math.PI * (random() < 0.5 ? -0.5 : 0.5) + (random() - 0.5) * 1.6;
          const s = (250 + random() * 650) * u;
          this.sparks.push({ x: m.x, y: m.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 250 * u, life: 0.35 + random() * 0.5, age: 0 });
        }
      }
    }
    if (this.sparks.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineWidth = 2.2 * u;
      const alive = [];
      for (const s of this.sparks) {
        s.age += dt;
        if (s.age > s.life) continue;
        s.vy += 1400 * u * dt;
        s.vx *= 0.98;
        const x0 = s.x, y0 = s.y;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        ctx.strokeStyle = rgba(mix(hot, '#ffffff', 0.5), 1 - s.age / s.life);
        ctx.beginPath();
        ctx.moveTo(x0 - s.vx * dt, y0 - s.vy * dt);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
        alive.push(s);
      }
      this.sparks = alive;
      ctx.restore();
    }
    ctx.restore(); // end of shake

    // --- Hazard stripe bands, scrolling faster when it's loud.
    if (p.stripes > 0) {
      const bandH = 30 * u, stripe = 30 * u;
      this.scroll = (this.scroll + (60 + 260 * frame.rms) * u * dt) % (stripe * 2);
      for (const y of [0, height - bandH]) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, y, width, bandH);
        ctx.clip();
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, y, width, bandH);
        ctx.fillStyle = rgba(lit, 0.85);
        const dir = y === 0 ? 1 : -1;
        for (let x = -bandH - stripe * 2 + dir * this.scroll; x < width + stripe * 2; x += stripe * 2) {
          ctx.beginPath();
          ctx.moveTo(x, y + bandH);
          ctx.lineTo(x + bandH, y);
          ctx.lineTo(x + bandH + stripe, y);
          ctx.lineTo(x + stripe, y + bandH);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // --- HUD readouts.
    if (p.hud > 0) {
      const peakBin = frame.spectrum.reduce((best, v, i, arr) => (v > arr[best] ? i : best), 0);
      const t = frame.time;
      const tc = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}:${String(Math.floor((t % 1) * fps)).padStart(2, '0')}`;
      const impact = frame.pulse > 0.55;
      const left = [
        ['UNIT-07 // DRIVE', 'ONLINE'],
        ['RPM ', String(Math.round(Math.abs(rpm) * 100)).padStart(4, '0')], // geared-up "motor" speed
        ['LOAD', `${String(Math.round(frame.rms * 100)).padStart(3, ' ')}%`],
        ['PSI ', String(Math.round(40 + frame.bass * 220)).padStart(4, '0')],
      ];
      const right = [
        ['T+', tc],
        ['FREQ', `${String(Math.round(analysis.binFreqs[peakBin])).padStart(5, '0')} HZ`],
        ['CYCLE', String(this.kicks).padStart(4, '0')],
        ['STATUS', impact ? 'IMPACT' : 'NOMINAL'],
      ];
      const fontSize = Math.round(19 * u);
      const lh = fontSize * 1.45;
      const margin = width * 0.06;
      const y0 = tall ? cy - R * 1.78 - R * 0.12 - lh * 4 : height * 0.05 + 30 * u;
      ctx.font = `${fontSize}px Menlo, "SF Mono", monospace`;
      ctx.textBaseline = 'top';
      const row = (label, value, x, y, align, alert) => {
        ctx.textAlign = align;
        const text = `${label} ${value}`;
        ctx.fillStyle = rgba(palette.text, 0.55);
        ctx.fillText(text, x, y);
        // Re-draw the value part in the accent colour.
        const valueW = ctx.measureText(value).width;
        ctx.fillStyle = alert ? hot : lit;
        ctx.textAlign = 'left';
        ctx.fillText(value, align === 'left' ? x + ctx.measureText(`${label} `).width : x - valueW, y);
      };
      left.forEach(([l, v], i) => row(l, v, margin, y0 + i * lh, 'left', false));
      right.forEach(([l, v], i) => row(l, v, width - margin, y0 + i * lh, 'right', l === 'STATUS' && impact));
    }

    if (this.lines) ctx.drawImage(this.lines, 0, 0);

    if (p.strobe > 0 && frame.kick && frame.kickStrength > 0.6) {
      ctx.fillStyle = `rgba(255,255,255,${0.25 * p.strobe})`;
      ctx.fillRect(0, 0, width, height);
    }
  },
};
