import { rampAt, rgba } from '../palettes.js';

export default {
  name: 'particles',
  description: 'Particle bursts fired on every onset, swirling with the mids around a pulsing orb',
  // With --auto: settings scaled in calm parts, builds and drops (see modulate.js).
  sections: {
    calm: { burst: 0.5, ambient: 0.6, speed: 0.8 },
    build: { burst: 0.9 },
    drop: { burst: 1.6, speed: 1.3, swirl: 1.3 },
  },
  params: {
    burst: 90,       // particles per onset (scaled by how hard it hits)
    ambient: 3,      // particles per frame emitted continuously, scaled by loudness
    speed: 14,       // burst velocity
    drag: 0.955,     // 1 = no slowdown, lower = particles stop sooner
    swirl: 1,        // how much the mids spin particles around the centre
    size: 3.5,
    life: 2.2,       // seconds a particle lives
    orb: 1,          // glowing centre orb (0 to hide)
    max: 3000,       // particle cap
  },

  setup(ctx, env) {
    this.particles = [];
  },

  spawn(n, power, env) {
    const { cx, cy, u, random, palette, params: p, fps } = env;
    for (let i = 0; i < n && this.particles.length < p.max; i++) {
      const a = random() * Math.PI * 2;
      const s = (0.3 + random() * 0.7) * p.speed * power * u * (30 / fps);
      this.particles.push({
        x: cx + Math.cos(a) * 30 * u,
        y: cy + Math.sin(a) * 30 * u,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        age: 0,
        life: p.life * (0.5 + random() * 0.5),
        size: p.size * u * (0.4 + random() * 1.2),
        color: rampAt(palette.colors, random()),
      });
    }
  },

  draw(ctx, frame, env) {
    const { cx, cy, u, fps, palette, params: p, random } = env;
    const dt = 1 / fps;

    if (frame.onset) this.spawn(Math.round(p.burst * (0.4 + frame.onsetStrength)), 0.6 + frame.onsetStrength, env);
    if (frame.kick) this.spawn(Math.round(p.burst * 0.5 * frame.kickStrength), 1.3, env);
    const ambient = p.ambient * frame.rms;
    this.spawn(Math.floor(ambient) + (random() < ambient % 1 ? 1 : 0), 0.35, env);

    const drag = p.drag ** (30 / fps);
    const swirl = p.swirl * (0.002 + 0.02 * frame.mid) * (30 / fps);
    ctx.globalCompositeOperation = 'lighter';
    const alive = [];
    for (const pt of this.particles) {
      pt.age += dt;
      if (pt.age > pt.life) continue;
      // Rotate velocity a little around the centre for a swirling feel.
      const dx = pt.x - cx, dy = pt.y - cy;
      pt.vx = (pt.vx - dy * swirl * 0.05) * drag;
      pt.vy = (pt.vy + dx * swirl * 0.05) * drag;
      pt.x += pt.vx;
      pt.y += pt.vy;
      const fade = 1 - pt.age / pt.life;
      ctx.fillStyle = rgba(pt.color, fade * (0.5 + 0.5 * frame.high));
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * (0.6 + fade), 0, Math.PI * 2);
      ctx.fill();
      alive.push(pt);
    }
    this.particles = alive;

    if (p.orb > 0) {
      const r = (70 + 60 * frame.bass + 50 * frame.pulse) * u * p.orb;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.2);
      g.addColorStop(0, rgba('#ffffff', 0.9));
      g.addColorStop(0.25, rgba(palette.accent, 0.7));
      g.addColorStop(0.6, rgba(palette.colors[0], 0.15));
      g.addColorStop(1, rgba(palette.colors[0], 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};
