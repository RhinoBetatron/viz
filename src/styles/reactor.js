import { Path2D } from 'skia-canvas';
import { mix, rgba } from '../palettes.js';
import { clamp } from '../util.js';
import { glowSprite } from '../sea.js';

const TAU = Math.PI * 2;

// Radiation trefoil: three blades and a hub.
function addTrefoil(path, x, y, r, angle) {
  for (let k = 0; k < 3; k++) {
    const a = angle + (k / 3) * TAU - Math.PI / 2;
    const a0 = a - Math.PI / 6, a1 = a + Math.PI / 6;
    path.moveTo(x + Math.cos(a0) * r * 0.3, y + Math.sin(a0) * r * 0.3);
    path.arc(x, y, r, a0, a1);
    path.arc(x, y, r * 0.3, a1, a0, true);
    path.closePath();
  }
  path.moveTo(x + r * 0.2, y);
  path.arc(x, y, r * 0.2, 0, TAU);
  return path;
}

export default {
  name: 'reactor',
  description: 'A reactor core in a hazard-lit hall: control rods slam in on every kick as the core flares, coolant races through the pipes, gauges swing and warning beacons turn',
  palette: 'hazard', // used when no -p is given
  // With --auto: settings scaled in calm parts, builds and drops (see modulate.js).
  sections: {
    calm: { slam: 0.5, flare: 0.6, geiger: 0.6 },
    build: { slam: 0.9 },
    drop: { slam: 1.4, flare: 1.6, geiger: 1.5 },
  },
  params: {
    scale: 1,       // size of the reactor
    rods: 7,        // control rods (2–12)
    slam: 1,        // how far the rods drop on kicks (0 = still)
    flare: 1,       // how hard the core flares on kicks
    trefoil: 1,     // rotating radiation symbol behind the core (0 = off)
    pipes: 1,       // coolant pipes with flowing coolant and steam (0 = off)
    gauges: 1,      // dials for bass / mids / highs (0 = off)
    beacons: 1,     // turning warning lights (0 = off)
    geiger: 1,      // radiation specks crackling with the highs (0 = off)
    stripes: 1,     // hazard stripe bands top and bottom
    hud: 1,         // monospace readouts
  },

  setup(ctx, env) {
    const { width, height, u, cx, cy, random, palette, params: p } = env;
    this.t = 0;
    this.kicks = 0;
    this.scroll = 0;
    this.flow = 0;
    const S = (this.S = Math.min(width, height) * p.scale);
    this.core = { x: cx, y: cy - S * 0.02, w: S * 0.16, h: S * 0.3 };
    const n = Math.round(clamp(p.rods, 2, 12));
    this.rods = Array.from({ length: n }, (_, i) => ({ f: (i + 0.5) / n, pos: 0.15, vel: 0, delay: random() * 0.12 }));
    this.needles = [0, 0, 0].map(() => ({ a: 0, v: 0 }));
    this.steam = [];
    this.glow = glowSprite(env, palette.accent, 64 * u);
    this.hot = glowSprite(env, palette.colors[2], 64 * u);
    this.smoke = glowSprite(env, palette.colors[0], 64 * u);
  },

  drawVessel(ctx, env, frame, power) {
    const { u, palette } = env;
    const { x, y, w, h } = this.core;
    const S = this.S;
    const lit = palette.colors[1], hot = palette.colors[2];

    // Glow of the core through everything.
    ctx.globalCompositeOperation = 'lighter';
    const g = S * (0.45 + 0.35 * power);
    ctx.globalAlpha = clamp(0.25 + 0.6 * power);
    ctx.drawImage(this.glow, x - g, y - g, g * 2, g * 2);
    ctx.globalAlpha = 1;

    // Pressure vessel: a capsule with a cutaway window onto the core.
    const vessel = new Path2D();
    vessel.roundRect(x - w * 1.25, y - h * 0.75, w * 2.5, h * 1.5, w * 0.9);
    ctx.globalCompositeOperation = 'source-over';
    const metal = ctx.createLinearGradient(x - w * 1.25, 0, x + w * 1.25, 0);
    metal.addColorStop(0, mix(palette.bg[0], palette.colors[0], 0.5));
    metal.addColorStop(0.35, mix(palette.bg[1], palette.colors[0], 0.9));
    metal.addColorStop(1, palette.bg[0]);
    ctx.fillStyle = metal;
    ctx.fill(vessel);
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = rgba(palette.text, 0.35);
    ctx.stroke(vessel);
    // Bolts round the flange.
    const bolts = new Path2D();
    for (let k = 0; k < 9; k++) {
      const bx = x - w * 1.1 + (k / 8) * w * 2.2;
      bolts.moveTo(bx + 3 * u, y - h * 0.56);
      bolts.arc(bx, y - h * 0.56, 3 * u, 0, TAU);
    }
    ctx.fillStyle = rgba(palette.text, 0.3);
    ctx.fill(bolts);

    // The core: fuel rods glowing, brighter with the power.
    const win = new Path2D();
    win.roundRect(x - w, y - h * 0.45, w * 2, h * 1.05, w * 0.15);
    ctx.fillStyle = mix(palette.bg[0], lit, 0.12 + 0.3 * power);
    ctx.fill(win);
    ctx.save();
    ctx.clip(win);
    ctx.globalCompositeOperation = 'lighter';
    const fuel = new Path2D();
    const cols = this.rods.length + 1;
    for (let k = 0; k < cols; k++) {
      const fx = x - w + ((k + 0.5) / cols) * w * 2;
      fuel.rect(fx - w * 0.05, y - h * 0.3, w * 0.1, h * 0.85);
    }
    const heat = ctx.createLinearGradient(0, y - h * 0.3, 0, y + h * 0.55);
    heat.addColorStop(0, rgba(hot, clamp(0.3 + 0.7 * power)));
    heat.addColorStop(1, rgba(lit, clamp(0.15 + 0.5 * power)));
    ctx.fillStyle = heat;
    ctx.fill(fuel);
    ctx.globalAlpha = clamp(power);
    ctx.drawImage(this.hot, x - w * 1.5, y - h * 0.6, w * 3, h * 1.4);
    ctx.globalAlpha = 1;

    // Control rods sliding down between the fuel.
    ctx.globalCompositeOperation = 'source-over';
    for (const [i, r] of this.rods.entries()) {
      const rx = x - w + ((i + 1) / cols) * w * 2;
      const bottom = y - h * 0.45 + h * 0.95 * r.pos;
      ctx.fillStyle = mix(palette.bg[0], palette.colors[0], 0.7);
      ctx.fillRect(rx - w * 0.035, y - h * 0.75, w * 0.07, bottom - (y - h * 0.75));
      ctx.fillStyle = rgba(hot, 0.9);
      ctx.fillRect(rx - w * 0.035, bottom - h * 0.03, w * 0.07, h * 0.03); // tip
    }
    ctx.restore();
    ctx.lineWidth = 1.5 * u;
    ctx.strokeStyle = rgba(lit, 0.7);
    ctx.stroke(win);

    // Drive mechanisms on top, one per rod, with hazard-striped housings.
    for (const [i, r] of this.rods.entries()) {
      const rx = x - w + ((i + 1) / cols) * w * 2;
      const top = y - h * 0.75 - S * 0.07 - (1 - r.pos) * S * 0.04;
      ctx.fillStyle = mix(palette.bg[1], palette.colors[0], 0.8);
      ctx.fillRect(rx - w * 0.06, top, w * 0.12, y - h * 0.75 - top);
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx - w * 0.06, top, w * 0.12, S * 0.025);
      ctx.clip();
      ctx.fillStyle = '#000000';
      ctx.fillRect(rx - w * 0.06, top, w * 0.12, S * 0.025);
      ctx.fillStyle = lit;
      for (let k = -2; k < 4; k++) {
        const sx = rx - w * 0.06 + k * S * 0.012;
        ctx.beginPath();
        ctx.moveTo(sx, top + S * 0.025);
        ctx.lineTo(sx + S * 0.025, top);
        ctx.lineTo(sx + S * 0.031, top);
        ctx.lineTo(sx + S * 0.006, top + S * 0.025);
        ctx.fill();
      }
      ctx.restore();
    }
  },

  drawPipes(ctx, env, frame) {
    const { width, u, palette } = env;
    const { x, y, w, h } = this.core;
    const S = this.S;
    const runs = [];
    for (const side of [-1, 1]) {
      for (const dy of [-0.18, 0.28]) {
        const yy = y + h * dy;
        runs.push([[x + side * w * 1.25, yy], [x + side * (w * 1.25 + S * 0.08), yy], [x + side * (w * 1.25 + S * 0.12), yy + side * dy * S * 0.3], [side < 0 ? -20 * u : width + 20 * u, yy + side * dy * S * 0.3]]);
      }
    }
    const pipes = new Path2D();
    for (const run of runs) run.forEach(([px, py], i) => (i ? pipes.lineTo(px, py) : pipes.moveTo(px, py)));
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round';
    ctx.lineWidth = S * 0.035;
    ctx.strokeStyle = mix(palette.bg[1], palette.colors[0], 0.7);
    ctx.stroke(pipes);
    ctx.lineWidth = S * 0.035 - 3 * u;
    ctx.strokeStyle = mix(palette.bg[0], palette.colors[0], 0.35);
    ctx.stroke(pipes);
    // Coolant racing through, faster when it's loud.
    ctx.globalCompositeOperation = 'lighter';
    ctx.setLineDash([S * 0.02, S * 0.03]);
    ctx.lineDashOffset = -this.flow;
    ctx.lineWidth = S * 0.01;
    ctx.strokeStyle = rgba(palette.colors[1], 0.35 + 0.4 * frame.rms);
    ctx.stroke(pipes);
    ctx.setLineDash([]);
    return runs;
  },

  drawGauges(ctx, env, frame) {
    const { u, cx, palette } = env;
    const S = this.S;
    const y = this.core.y + this.core.h * 0.75 + S * 0.11;
    const r = S * 0.055;
    const values = [frame.bass, frame.mid, frame.high];
    const labels = ['BASS', 'MID', 'HIGH'];
    ctx.font = `${Math.round(13 * u)}px Menlo, "SF Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let k = 0; k < 3; k++) {
      const x = cx + (k - 1) * r * 2.8;
      const n = this.needles[k];
      // Springy needle that overshoots.
      n.v += ((values[k] - n.a) * 120 - n.v * 12) / env.fps;
      n.a += n.v / env.fps;
      const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = mix(palette.bg[0], palette.colors[0], 0.35);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 2 * u;
      ctx.strokeStyle = rgba(palette.text, 0.4);
      ctx.stroke();
      ctx.lineWidth = 4 * u;
      ctx.strokeStyle = rgba(palette.colors[1], 0.7);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.8, a0, a0 + (a1 - a0) * 0.7);
      ctx.stroke();
      ctx.strokeStyle = rgba('#ff3b2f', 0.9);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.8, a0 + (a1 - a0) * 0.7, a1);
      ctx.stroke();
      const a = a0 + (a1 - a0) * clamp(n.a, -0.02, 1.04);
      ctx.strokeStyle = palette.text;
      ctx.lineWidth = 2.2 * u;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85);
      ctx.stroke();
      ctx.fillStyle = rgba(palette.text, 0.6);
      ctx.fillText(labels[k], x, y + r * 1.15);
    }
  },

  draw(ctx, frame, env) {
    const { width, height, fps, u, cx, cy, palette, random, params: p } = env;
    const dt = 1 / fps;
    this.t += dt;
    const t = this.t;
    const S = this.S;
    const lit = palette.colors[1], hot = palette.colors[2];

    // Rods slam in on the kick (each a moment apart), then crawl back out.
    if (frame.kick) {
      this.kicks++;
      for (const r of this.rods) r.drop = r.delay;
    }
    for (const r of this.rods) {
      if (r.drop !== undefined && (r.drop -= dt) <= 0) {
        r.vel = 4 * frame.kickStrength * p.slam + 1;
        r.drop = undefined;
      }
      r.pos += r.vel * dt;
      r.vel *= 0.8;
      r.pos += (0.15 - r.pos) * 0.04 * (30 / fps);
      r.pos = clamp(r.pos, 0, 0.9);
    }
    const power = clamp(0.25 + 0.45 * frame.rms + 0.6 * frame.pulse * p.flare);
    this.flow += S * (0.15 + 0.6 * frame.rms) * dt;

    // Radiation trefoil turning slowly behind the core.
    if (p.trefoil > 0) {
      const path = addTrefoil(new Path2D(), cx, this.core.y, S * 0.42, t * 0.15 + this.kicks * 0.05);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(lit, (0.06 + 0.1 * frame.pulse) * p.trefoil);
      ctx.fill(path);
      ctx.lineWidth = 2 * u;
      ctx.strokeStyle = rgba(lit, (0.25 + 0.3 * frame.pulse) * p.trefoil);
      ctx.stroke(path);
      // Dashed containment rings.
      for (const [k, rr] of [0.47, 0.52].entries()) {
        ctx.setLineDash([S * 0.02, S * 0.015]);
        ctx.lineDashOffset = (k ? -1 : 1) * t * S * 0.05;
        ctx.lineWidth = 2 * u;
        ctx.strokeStyle = rgba(lit, 0.3);
        ctx.beginPath();
        ctx.arc(cx, this.core.y, S * rr, 0, TAU);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    const runs = p.pipes > 0 ? this.drawPipes(ctx, env, frame) : [];
    this.drawVessel(ctx, env, frame, power);

    // Steam bursting from the pipe ends on kicks.
    if (frame.kick && runs.length) {
      for (const run of runs) {
        const [px, py] = run[2];
        for (let k = 0; k < 3; k++) this.steam.push({ x: px, y: py, vx: (random() - 0.5) * S * 0.1, vy: -(0.15 + random() * 0.2) * S, r: S * (0.02 + random() * 0.03), life: 1 });
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.steam) {
      s.life -= dt / 1.4;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.r += S * 0.06 * dt;
      ctx.globalAlpha = clamp(s.life * 0.5);
      ctx.drawImage(this.smoke, s.x - s.r * 2, s.y - s.r * 2, s.r * 4, s.r * 4);
    }
    ctx.globalAlpha = 1;
    this.steam = this.steam.filter((s) => s.life > 0);

    if (p.gauges > 0) this.drawGauges(ctx, env, frame);

    // Warning beacons in the top corners, turning faster when it's loud.
    if (p.beacons > 0) {
      for (const side of [-1, 1]) {
        const bx = cx + side * Math.min(width * 0.38, S * 0.42), by = height * 0.09 + 30 * u;
        const a = t * TAU * (0.5 + 0.8 * frame.rms) * side;
        const facing = Math.max(0, Math.cos(a)) ** 4;
        ctx.globalCompositeOperation = 'lighter';
        const len = S * 0.5 * Math.abs(Math.sin(a));
        const grad = ctx.createLinearGradient(bx, by, bx + Math.sign(Math.sin(a)) * len, by);
        grad.addColorStop(0, rgba(palette.accent, 0.5));
        grad.addColorStop(1, rgba(palette.accent, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(bx, by - 4 * u);
        ctx.lineTo(bx + Math.sign(Math.sin(a)) * len, by - S * 0.06);
        ctx.lineTo(bx + Math.sign(Math.sin(a)) * len, by + S * 0.06);
        ctx.lineTo(bx, by + 4 * u);
        ctx.fill();
        const gr = S * (0.04 + 0.12 * facing);
        ctx.globalAlpha = clamp(0.5 + 0.5 * facing);
        ctx.drawImage(this.glow, bx - gr, by - gr, gr * 2, gr * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = mix(palette.accent, '#000000', 0.3);
        ctx.fillRect(bx - S * 0.014, by - S * 0.01, S * 0.028, S * 0.022);
      }
    }

    // Geiger crackle.
    if (p.geiger > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(hot, 0.8);
      const n = Math.round((frame.high * 40 + (frame.onset ? 30 : 0)) * p.geiger);
      for (let k = 0; k < n; k++) {
        const a = random() * TAU, d = S * (0.2 + random() * 0.5);
        ctx.fillRect(cx + Math.cos(a) * d, this.core.y + Math.sin(a) * d, 2 * u, 2 * u);
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // Hazard stripe bands, as in industrial.
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

    // Readouts.
    if (p.hud > 0) {
      const critical = power > 0.8;
      const avgRod = this.rods.reduce((s, r) => s + r.pos, 0) / this.rods.length;
      const left = [
        ['CORE-02 // ', 'ONLINE'],
        ['TEMP ', `${String(Math.round(280 + power * 340)).padStart(4, '0')} C`],
        ['FLUX ', `${(power * 9.99).toFixed(2)}E14`],
      ];
      const right = [
        ['RODS ', `${String(Math.round(avgRod * 100)).padStart(3, ' ')}%`],
        ['SCRAM ', String(this.kicks).padStart(4, '0')],
        ['STATUS ', critical ? 'CRITICAL' : 'STABLE'],
      ];
      const fontSize = Math.round(19 * u);
      const lh = fontSize * 1.45;
      const margin = width * 0.06;
      const y0 = height - 30 * u - lh * 3 - height * 0.03;
      ctx.font = `${fontSize}px Menlo, "SF Mono", monospace`;
      ctx.textBaseline = 'top';
      const row = ([label, value], x, y, align, alert) => {
        ctx.textAlign = 'left';
        const w = ctx.measureText(label + value).width;
        const x0 = align === 'left' ? x : x - w;
        ctx.fillStyle = rgba(palette.text, 0.55);
        ctx.fillText(label, x0, y);
        ctx.fillStyle = alert ? '#ff3b2f' : lit;
        ctx.fillText(value, x0 + ctx.measureText(label).width, y);
      };
      left.forEach((r, i) => row(r, margin, y0 + i * lh, 'left', false));
      right.forEach((r, i) => row(r, width - margin, y0 + i * lh, 'right', r[0] === 'STATUS ' && critical));
    }
  },
};
