import { Path2D } from 'skia-canvas';
import { mix, rgba, rampAt } from '../palettes.js';
import { clamp } from '../util.js';

const TAU = Math.PI * 2;

// A right hand in 3D, in hand units (wrist → middle fingertip ≈ 1).
// Fingers point up (-y), the palm faces the viewer (+z), x is the thumb side.
const FINGERS = [
  { base: [0.165, -0.5], spread: 0.13, len: [0.25, 0.15, 0.11], w: 0.088 },   // index
  { base: [0.055, -0.53], spread: 0.03, len: [0.28, 0.17, 0.12], w: 0.092 },  // middle
  { base: [-0.055, -0.51], spread: -0.07, len: [0.26, 0.16, 0.115], w: 0.087 }, // ring
  { base: [-0.16, -0.46], spread: -0.17, len: [0.2, 0.125, 0.1], w: 0.075 },  // pinky
];
const FLEX = [1.15, 1.5, 0.8]; // joint bend at full curl (knuckle, middle, tip)
const TAPER = [1, 0.95, 0.88, 0.78];
const THUMB = { base: [0.15, -0.1], len: [0.2, 0.16, 0.12], w: 0.11 };
const PALM = [[-0.17, 0.02], [-0.205, -0.2], [-0.2, -0.44], [-0.16, -0.49], [-0.06, -0.54], [0.06, -0.56], [0.17, -0.53], [0.21, -0.45], [0.21, -0.25], [0.17, -0.08], [0.12, 0.02]];
const CREASES = [ // palm lines as quadratic curves: start, control, end
  [[-0.19, -0.38], [0, -0.33], [0.16, -0.43]],
  [[0.17, -0.31], [0, -0.27], [-0.15, -0.22]],
  [[0.16, -0.3], [0.03, -0.16], [0.05, 0]],
];
const LIGHT = [-0.6, -0.8]; // light comes from the top left

// Tapered capsule from (x0, y0, r0) to (x1, y1, r1).
function addCapsule(path, x0, y0, r0, x1, y1, r1) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  if (d <= Math.abs(r1 - r0) + 0.5) { // pointing straight at the camera
    const r = Math.max(r0, r1);
    path.moveTo(x1 + r, y1);
    path.arc(x1, y1, r, 0, TAU);
    return path;
  }
  const a = Math.atan2(y1 - y0, x1 - x0);
  const nx = -Math.sin(a), ny = Math.cos(a);
  path.moveTo(x0 + nx * r0, y0 + ny * r0);
  path.lineTo(x1 + nx * r1, y1 + ny * r1);
  path.arc(x1, y1, r1, a + Math.PI / 2, a - Math.PI / 2, true);
  path.lineTo(x0 - nx * r0, y0 - ny * r0);
  path.arc(x0, y0, r0, a - Math.PI / 2, a + Math.PI / 2, true);
  path.closePath();
  return path;
}

export default {
  name: 'hands',
  description: 'A grasping hand in the middle that clenches on every kick, with arms reaching in from the dark around it',
  palette: 'gloom', // used when no -p is given
  params: {
    hands: 6,       // reaching hands around the edge (0 = only the centre hand)
    grip: 1,        // how hard the hands clench on kicks
    reach: 1,       // how far the side hands reach in
    speed: 1,       // how fast the side hands move
    tremble: 1,     // finger twitching with the highs (0 = still)
    scale: 1,       // size of all hands
    center: 1,      // centre hand (0 = hide)
    palm: 'auto',   // centre hand: auto/front shows the palm, back shows the back of the hand
    echo: 1,        // ghost of the centre hand on each kick (0 = off)
    ash: 50,        // drifting ash specks (0 = off)
  },

  setup(ctx, env) {
    const { width, height, cx, cy, u, random, params: p } = env;
    const size = Math.min(width, height);
    this.t = 0;
    this.centre = {
      mirror: 1, size: Math.min(width * 0.52, height * 0.36) * p.scale, light: 1,
      curls: [0, 0, 0, 0, 0], twitch: random() * 10,
    };

    // Side hands come in from all round the frame except the bottom, where
    // the centre arm is.
    const n = Math.round(p.hands);
    const from = Math.PI / 2 + 0.5, span = TAU - 1;
    this.hands = Array.from({ length: n }, (_, i) => {
      const theta = from + (n > 1 ? (i / (n - 1)) * span : span / 2) + (random() - 0.5) * 0.3;
      const dir = [Math.cos(theta), Math.sin(theta)];
      // Where the ray from the centre leaves the frame.
      const tx = dir[0] > 0 ? (width - cx) / dir[0] : dir[0] < 0 ? -cx / dir[0] : Infinity;
      const ty = dir[1] > 0 ? (height - cy) / dir[1] : dir[1] < 0 ? -cy / dir[1] : Infinity;
      const depth = random();
      const hsize = Math.min(width * 0.24, height * 0.2) * (0.8 + 0.4 * depth) * p.scale;
      const edge = Math.min(tx, ty) + hsize * 0.15;
      const nearest = this.centre.size * 0.8 + hsize * 1.0; // wrist distance from the centre at full reach
      const reachMin = hsize * 0.35 + hsize * 0.15;
      return {
        dir, edge, depth, size: hsize,
        reachMin,
        reachMax: Math.max(reachMin + hsize * 0.3, edge - nearest),
        aim: (random() - 0.5) * 0.35,
        mirror: random() < 0.5 ? 1 : -1,
        back: random() < 0.4, // shows the back of the hand
        phase: random() * TAU,
        speed: 0.3 + random() * 0.4,
        sens: 0.5 + random() * 0.5,
        ext: random() * 0.5,
        grab: 0,
        curls: [0, 0, 0, 0, 0],
        twitch: random() * 10,
      };
    }).sort((a, b) => a.depth - b.depth);

    this.ash = Array.from({ length: Math.round(p.ash) }, () => ({
      x: random() * width, y: random() * height,
      vx: (random() - 0.5) * 8 * u, vy: (2 + random() * 8) * u,
      size: (0.8 + random() * 2.2) * u, phase: random() * TAU,
    }));
  },

  // Eases each finger towards the target curl, each at its own pace, with a
  // twitch from the highs.
  updateCurls(h, target, frame, p) {
    h.curls = h.curls.map((c, i) => {
      const twitch = Math.sin(this.t * 17 + i * 3.1 + h.twitch) * Math.sin(this.t * 7.3 + i) * 0.12 * frame.high * p.tremble;
      const goal = clamp(target + twitch + (i === 4 ? -0.05 : 0), 0, 0.95);
      return c + (goal - c) * (goal > c ? 0.55 - i * 0.05 : 0.22 - i * 0.02);
    });
  },

  // Builds the projected pieces of one hand: arm, palm, fingers, thumb.
  pose(h, extraScale = 1) {
    const cyw = Math.cos(h.yaw), syw = Math.sin(h.yaw);
    const cp = Math.cos(h.pitch), sp = Math.sin(h.pitch);
    const cr = Math.cos(h.roll), sr = Math.sin(h.roll);
    const size = h.size * extraScale;
    const project = ([x, y, z]) => {
      x *= h.mirror;
      const X = x * cyw + z * syw, Z = -x * syw + z * cyw;
      const Y2 = y * cp - Z * sp, Z2 = y * sp + Z * cp;
      const k = 1 / (1 - clamp(Z2 * 0.3, -0.5, 0.6));
      return { x: h.x + (X * cr - Y2 * sr) * size * k, y: h.y + (X * sr + Y2 * cr) * size * k, z: Z2, k };
    };
    const facing = cyw * cp; // > 0 when the palm faces the viewer
    const pieces = [];
    // Each finger is one piece, so it's outlined once with no seams at the joints.
    let group;
    const segment = (a, b, r0, r1, tip) => {
      const A = project(a), B = project(b);
      group.segs.push({ A, B, r0: r0 * size * A.k, r1: r1 * size * B.k, tip });
    };
    const finish = () => {
      group.z = mean(group.segs.map((g) => (g.A.z + g.B.z) / 2));
      pieces.push(group);
    };

    // Fingers: each joint bends towards the palm.
    FINGERS.forEach((f, i) => {
      const c = h.curls[i];
      const phi = f.spread * (1 - 0.6 * c);
      let p0 = [f.base[0], f.base[1], 0], theta = 0;
      group = { kind: 'finger', segs: [] };
      f.len.forEach((len, j) => {
        theta += FLEX[j] * c;
        const d = [Math.sin(phi) * Math.cos(theta), -Math.cos(phi) * Math.cos(theta), Math.sin(theta)];
        const p1 = [p0[0] + d[0] * len, p0[1] + d[1] * len, p0[2] + d[2] * len];
        segment(p0, p1, (f.w / 2) * TAPER[j] * 1.12, (f.w / 2) * TAPER[j + 1] * 1.12, j === 2);
        p0 = p1;
      });
      finish();
    });

    // Thumb swings across the palm as it closes.
    {
      const c = h.curls[4];
      const phi = 0.95 - 0.7 * c;
      let p0 = [THUMB.base[0], THUMB.base[1], 0], theta = 0.15;
      group = { kind: 'finger', segs: [] };
      THUMB.len.forEach((len, j) => {
        theta += [0.25, 0.45, 0.5][j] * c;
        const d = [Math.sin(phi) * Math.cos(theta), -Math.cos(phi) * Math.cos(theta), Math.sin(theta)];
        const p1 = [p0[0] + d[0] * len, p0[1] + d[1] * len, p0[2] + d[2] * len];
        segment(p0, p1, (THUMB.w / 2) * [1.15, 1, 0.9][j], (THUMB.w / 2) * [1, 0.9, 0.8][j], j === 2);
        p0 = p1;
      });
      finish();
    }

    const palm = PALM.map(([x, y]) => project([x, y, 0]));
    // Palm sits under the fingers when it faces us, over their bases when it doesn't.
    pieces.push({ kind: 'palm', pts: palm, z: mean(palm.map((q) => q.z)) - 0.02 * Math.sign(facing || 1), creases: facing > 0.2 ? CREASES.map((c) => c.map(([x, y]) => project([x, y, 0]))) : null });
    pieces.sort((a, b) => a.z - b.z);

    const arm = { A: project([-0.02, 0.0, 0]), B: project([-0.02, h.arm, 0]) };
    arm.r0 = 0.125 * size * arm.A.k;
    arm.r1 = 0.16 * size * arm.B.k;
    return { pieces, arm, facing, size };
  },

  drawHand(ctx, h, env, light) {
    const { u, palette } = env;
    const { pieces, arm, facing } = this.pose(h);
    const tone = (t) => rampAt(palette.colors, clamp(t));
    const hi = tone(0.45 + 0.55 * light), mid = tone(0.2 + 0.45 * light), lo = mix(palette.colors[0], '#000000', 0.55);
    ctx.lineJoin = 'round';

    // Forearm fades into the dark towards the edge of the frame.
    const armPath = addCapsule(new Path2D(), arm.A.x, arm.A.y, arm.r0, arm.B.x, arm.B.y, arm.r1);
    const along = ctx.createLinearGradient(arm.A.x, arm.A.y, arm.B.x, arm.B.y);
    along.addColorStop(0, mid);
    along.addColorStop(0.45, rgba(lo, 0.9));
    along.addColorStop(1, rgba(lo, 0));
    ctx.strokeStyle = rgba('#000000', 0.8);
    ctx.lineWidth = 3 * u;
    ctx.stroke(armPath);
    ctx.fillStyle = along;
    ctx.fill(armPath);
    // Darken the sides so it reads as round.
    const ax = (arm.A.x + arm.B.x) / 2, ay = (arm.A.y + arm.B.y) / 2, al = Math.hypot(arm.B.x - arm.A.x, arm.B.y - arm.A.y) || 1;
    const anx = -(arm.B.y - arm.A.y) / al * arm.r1, any = (arm.B.x - arm.A.x) / al * arm.r1;
    const across = ctx.createLinearGradient(ax + anx, ay + any, ax - anx, ay - any);
    across.addColorStop(0, rgba('#000000', 0.6));
    across.addColorStop(0.35, rgba('#000000', 0));
    across.addColorStop(0.65, rgba('#000000', 0.1));
    across.addColorStop(1, rgba('#000000', 0.7));
    ctx.fillStyle = across;
    ctx.fill(armPath);

    for (const pc of pieces) {
      if (pc.kind === 'palm') {
        const path = new Path2D();
        pc.pts.forEach((q, i) => (i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y)));
        path.closePath();
        const c = pc.pts[5], w = pc.pts[0];
        const g = ctx.createRadialGradient(c.x * 0.6 + w.x * 0.4, c.y * 0.6 + w.y * 0.4, 0, c.x * 0.5 + w.x * 0.5, c.y * 0.5 + w.y * 0.5, h.size * 0.42);
        g.addColorStop(0, hi);
        g.addColorStop(0.6, mid);
        g.addColorStop(1, lo);
        ctx.lineWidth = 3 * u;
        ctx.strokeStyle = rgba('#000000', 0.85);
        ctx.stroke(path);
        ctx.fillStyle = g;
        ctx.fill(path);
        if (pc.creases) {
          const lines = new Path2D();
          for (const [a, b, c2] of pc.creases) { lines.moveTo(a.x, a.y); lines.quadraticCurveTo(b.x, b.y, c2.x, c2.y); }
          ctx.strokeStyle = rgba('#000000', 0.35 * pc.creases.length / 3);
          ctx.lineWidth = 2 * u;
          ctx.stroke(lines);
        }
        continue;
      }
      const outline = new Path2D();
      for (const g of pc.segs) addCapsule(outline, g.A.x, g.A.y, g.r0, g.B.x, g.B.y, g.r1);
      ctx.lineWidth = 2.5 * u;
      ctx.strokeStyle = rgba('#000000', 0.85);
      ctx.stroke(outline);
      for (const { A, B, r0, r1, tip } of pc.segs) {
        const path = addCapsule(new Path2D(), A.x, A.y, r0, B.x, B.y, r1);
        // Round shading across the finger, lit from the top left.
        const r = Math.max(r0, r1), mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
        let nx = -(B.y - A.y) / len, ny = (B.x - A.x) / len;
        if (nx * LIGHT[0] + ny * LIGHT[1] < 0) { nx = -nx; ny = -ny; }
        const g = ctx.createLinearGradient(mx + nx * r, my + ny * r, mx - nx * r, my - ny * r);
        const lift = clamp((A.z + B.z) * 0.3); // nearer joints catch more light
        g.addColorStop(0, mid);
        g.addColorStop(0.3, tone(0.5 + 0.5 * light + lift * 0.3));
        g.addColorStop(0.65, mid);
        g.addColorStop(1, lo);
        ctx.fillStyle = g;
        ctx.fill(path);
        // Fingernails when we see the back of the hand.
        if (tip && facing < -0.2 && len > r) {
          const a = Math.atan2(B.y - A.y, B.x - A.x);
          ctx.beginPath();
          ctx.ellipse(A.x + (B.x - A.x) * 0.62, A.y + (B.y - A.y) * 0.62, len * 0.38, r * 0.62, a, 0, TAU);
          ctx.fillStyle = rgba(hi, 0.45);
          ctx.fill();
          ctx.strokeStyle = rgba('#000000', 0.4);
          ctx.lineWidth = 1.2 * u;
          ctx.stroke();
        }
      }
    }
  },

  draw(ctx, frame, env) {
    const { width, height, cx, cy, u, fps, palette, params: p, random } = env;
    const dt = 1 / fps;
    this.t += dt;
    const t = this.t;

    // Ash drifts down through the dark.
    if (this.ash.length) {
      const specks = new Path2D();
      for (const a of this.ash) {
        a.x += (a.vx + Math.sin(t * 0.6 + a.phase) * 6 * u) * dt;
        a.y += a.vy * dt;
        if (a.y > height + 5 * u) { a.y = -5 * u; a.x = random() * width; }
        specks.moveTo(a.x + a.size, a.y);
        specks.arc(a.x, a.y, a.size, 0, TAU);
      }
      ctx.fillStyle = rgba(palette.colors.at(-1), 0.12 + 0.3 * frame.high);
      ctx.fill(specks);
    }

    // Side hands: reach in and out, lunge and clench on kicks.
    for (const h of this.hands) {
      if (frame.kick) h.grab = Math.max(h.grab, frame.kickStrength * h.sens * p.grip);
      h.grab *= 0.9 ** (30 / fps);
      const sway = 0.5 + 0.5 * Math.sin(t * h.speed * p.speed + h.phase);
      const goal = clamp((0.15 + 0.45 * sway + 0.3 * frame.rms + 0.3 * h.grab) * p.reach);
      h.ext += (goal - h.ext) * (goal > h.ext ? 0.12 : 0.04) * (30 / fps);
      const dist = h.reachMin + (h.reachMax - h.reachMin) * h.ext;
      const ax = cx + h.dir[0] * h.edge, ay = cy + h.dir[1] * h.edge;
      h.x = ax - h.dir[0] * dist;
      h.y = ay - h.dir[1] * dist;
      const pointing = Math.atan2(-h.dir[1], -h.dir[0]) + h.aim + 0.12 * Math.sin(t * 0.7 + h.phase);
      h.roll = pointing + Math.PI / 2;
      h.yaw = (h.back ? Math.PI : 0) + 0.35 * Math.sin(t * 0.5 * p.speed + h.phase * 2);
      h.pitch = 0.15 * Math.sin(t * 0.4 + h.phase);
      h.arm = (dist + h.size * 0.6) / h.size / Math.max(0.5, Math.abs(Math.cos(h.yaw)));
      // Fingers open while reaching, claw when they grab.
      this.updateCurls(h, 0.1 + 0.25 * (1 - h.ext) + 0.7 * h.grab, frame, p);
      this.drawHand(ctx, h, env, (0.2 + 0.45 * h.depth) * (0.6 + 0.4 * h.ext) + 0.2 * h.grab);
    }

    if (p.center <= 0) return;
    const c = this.centre;
    // Three-quarter view, so the curl reads as a claw rather than foreshortening.
    c.yaw = (p.palm === 'back' ? Math.PI : 0) + 0.65 + 0.25 * Math.sin(t * 0.35);
    c.pitch = -0.2 + 0.08 * Math.sin(t * 0.3) - 0.12 * frame.pulse; // lunges towards us on the kick
    c.roll = 0.08 * Math.sin(t * 0.5);
    c.x = cx;
    c.y = cy + 0.3 * c.size;
    c.arm = (height - c.y) / c.size + 0.6;
    // Clench on the kick, let go well before the next one even on fast tracks.
    this.updateCurls(c, (0.08 + 0.9 * clamp((frame.pulse - 0.25) / 0.75)) * p.grip, frame, p);

    // Ghost of the hand expanding outward on each kick.
    if (p.echo > 0 && frame.pulse > 0.05) {
      const { pieces } = this.pose(c, 1 + 0.3 * (1 - frame.pulse));
      const ghost = new Path2D();
      for (const pc of pieces) {
        if (pc.kind === 'palm') {
          pc.pts.forEach((q, i) => (i ? ghost.lineTo(q.x, q.y) : ghost.moveTo(q.x, q.y)));
          ghost.closePath();
        } else for (const g of pc.segs) addCapsule(ghost, g.A.x, g.A.y, g.r0, g.B.x, g.B.y, g.r1);
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(palette.accent, 0.18 * frame.pulse * p.echo);
      ctx.fill(ghost);
      ctx.globalCompositeOperation = 'source-over';
    }
    this.drawHand(ctx, c, env, 0.75 + 0.25 * frame.pulse);
  },
};

function mean(a) {
  return a.reduce((s, v) => s + v, 0) / a.length;
}
