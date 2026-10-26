import { Path2D } from 'skia-canvas';
import { clamp, rng } from '../util.js';
import { pieces, cssColor, compileProps } from '../svg.js';

// The drawing comes from --svg (see src/svg.js, which also reads data-viz
// attributes and pack files). Presets are written in the same language a pack
// uses: `holder` is the group the main parts sit in, `part` each main part
// (one frequency band each), `shape` every single shape.
const INTRO = 'clamp((t + 0.04 - i/n*intro*0.4) / max(intro*0.6, 0.01))'; // parts draw on one after another
const PRESETS = {
  pump: {
    holder: { scale: '1+pulse*0.06*amount' },
    part: { scale: '1+band*0.3*amount', glow: 'band*35*amount', draw: INTRO },
  },
  explode: {
    holder: { explode: 'pulse^2*0.9*amount', scale: '1+pulse*0.04*amount', rotate: '(sine(4)-0.5)*6*amount' },
    part: { explode: 'pulse^2*0.5*amount', rotate: 'pulse^2*(rand-0.5)*70*amount', glow: 'band*25*amount', draw: INTRO },
  },
  wire: {
    holder: { scale: '1+pulse*0.05*amount' },
    part: { draw: INTRO, glow: '8+band*30*amount', trace: 'bar*2+rand', echo: 'pulse*amount', jitter: 'high*0.35*amount' },
    shape: { fill: 'none', stroke: 'fill', outline: '0.8+band*1.2*amount' },
  },
  glitch: {
    holder: { skew: 'onset*(noise(1/8)-0.5)*24*amount', split: '(pulse*0.8+high*0.4)*amount' },
    part: {
      x: '(noise(1/16, rand*9)-0.5)*(onset+pulse*0.5)*22*amount',
      y: '(noise(1/16, rand*5+3)-0.5)*onset*6*amount',
      opacity: '1-onset*0.7*round(noise(1/16, rand*3))',
      jitter: 'high*0.3*amount',
      glow: 'band*15*amount',
      draw: INTRO,
    },
  },
  none: {},
};
export const svgPresets = Object.keys(PRESETS);
const COLORS = ['auto', 'original', 'palette', 'invert'];

// Passed down from groups to the shapes inside them.
const INHERIT = ['blur', 'glow', 'outline', 'draw', 'trace', 'jitter', 'echo', 'split', 'fill', 'stroke'];

const frac = (x) => x - Math.floor(x);
const smooth = (x) => x * x * (3 - 2 * x);
const css = ([r, g, b, a = 1]) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+a.toFixed(3)})`;

// Same hue, lightness flipped: black line art turns white, white turns dark.
function invertLightness([r, g, b, a]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const L = 1 - l, C = (1 - Math.abs(2 * L - 1)) * s, X = C * (1 - Math.abs((h % 2 + 2) % 2 - 1)), m = L - C / 2;
  const [R, G, B] = h < 1 ? [C, X, 0] : h < 2 ? [X, C, 0] : h < 3 ? [0, C, X] : h < 4 ? [0, X, C] : h < 5 ? [X, 0, C] : [C, 0, X];
  return [(R + m) * 255, (G + m) * 255, (B + m) * 255, a];
}
const luma = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export default {
  name: 'svg',
  presets: svgPresets,
  description: 'Your SVG (--svg logo.svg), moved, recoloured and broken apart with the music. Presets for any drawing; rig it yourself with data-viz attributes or a pack file (see the README)',
  // With --auto: settings scaled in calm parts, builds and drops (see modulate.js).
  sections: {
    calm: { amount: 0.6 },
    build: { amount: 0.85 },
    drop: { amount: 1.4 },
  },
  params: {
    preset: 'pump',   // pump, explode, wire, glitch or none: how the main parts move (none for drawings you've rigged yourself)
    amount: 1,        // how hard the preset hits
    size: 0.75,       // how much of the frame the drawing fills
    colors: 'auto',   // original, palette, invert (flip light and dark), or auto (invert if it's mostly dark)
    intro: 1.5,       // seconds the parts take to draw themselves on (0 = there from the start)
  },

  setup(ctx, env) {
    const { params: p, palette, width: W, height: H } = env;
    const drawing = this.drawing;
    if (!drawing) throw new Error('the svg style needs a drawing: add --svg logo.svg');
    const preset = PRESETS[p.preset];
    if (!preset) throw new Error(`unknown svg preset "${p.preset}". Try: ${svgPresets.join(', ')}`);
    if (!COLORS.includes(p.colors)) throw new Error(`svg colors is ${COLORS.join(', ')}, not "${p.colors}"`);
    for (const [k, spec] of Object.entries(this.paramInfo ?? {})) {
      if (typeof spec.default === 'number' && typeof p[k] === 'string' && Number.isNaN(Number(p[k]))) throw new Error(`${this.name}: ${k} takes a number or an expression, not "${p[k]}"`);
    }
    const { root, view, parts, holder } = drawing;
    this.D = drawing.size;
    this.fit = (p.size > 0 ? p.size : 0.75) * Math.min(W / view.width, H / view.height);
    this.t0 = null;
    this.frames = env.analysis.frames;
    this.ranges = new Map();

    // Which part (and so which band) every node belongs to.
    const partOf = new Map();
    parts.forEach((part, k) => (function mark(n) {
      partOf.set(n, k);
      n.children.forEach(mark);
    })(part));
    const bandPos = (n) => (partOf.has(n) ? (partOf.get(n) + 0.5) / parts.length : -1); // -1: the whole mix
    const random = rng(env.random() * 1e9);
    const rand = new Map(drawing.nodes.map((n) => [n, random()]));

    // node → { prop: { v, vars } }; later sources win.
    this.bind = new Map();
    const add = (node, props, i, n, band) => {
      const b = this.bind.get(node) ?? {};
      for (const [k, v] of Object.entries(props)) b[k] = { v, vars: { i, n, band: 0, rand: rand.get(node) ?? 0, t: 0 }, band };
      this.bind.set(node, b);
    };
    const compiled = this.compilePreset(preset);
    if (compiled.holder) add(holder, compiled.holder, 0, 1, -1);
    if (compiled.part) parts.forEach((part, k) => add(part, compiled.part, k, parts.length, bandPos(part)));
    if (compiled.shape) {
      const shapes = drawing.nodes.filter((n) => n.path);
      shapes.forEach((s, k) => add(s, compiled.shape, k, shapes.length, bandPos(s)));
    }
    for (const rule of this.rules ?? []) {
      rule.nodes.forEach((node, k) => {
        if (rule.siblings) {
          const sib = node.parent?.children ?? [node];
          add(node, rule.props, Math.max(0, sib.indexOf(node)), sib.length, bandPos(node));
        } else {
          add(node, rule.props, k, rule.nodes.length, rule.nodes.length > 1 ? (k + 0.5) / rule.nodes.length : bandPos(node));
        }
      });
    }

    // Colours: as drawn, the palette, or light and dark flipped.
    let mode = p.colors;
    if (mode === 'auto') {
      let dark = 0, total = 0;
      for (const n of drawing.nodes) {
        if (!n.path) continue;
        const area = n.box.width * n.box.height * n.scale * n.scale + 1e-9;
        for (const paint of [n.paint.fill, n.paint.stroke]) {
          const c = paint?.color ?? paint?.gradient?.stops[0]?.color;
          if (!c) continue;
          total += area;
          if (luma(c) < 0.3) dark += area;
        }
      }
      mode = total && dark / total > 0.5 ? 'invert' : 'original';
    }
    const map = mode === 'invert' ? invertLightness : (c) => c;
    const solid = (paint) => (paint?.color ? map(paint.color) : paint?.gradient ? map(paint.gradient.stops.at(-1).color) : null);
    this.colors = new Map();
    for (const n of drawing.nodes) {
      if (!n.path) continue;
      let fill, stroke, glow;
      if (mode === 'palette') {
        const k = partOf.get(n) ?? 0;
        const c = palette.colors[k % palette.colors.length];
        fill = n.paint.fill ? c : null;
        stroke = n.paint.stroke ? (n.paint.fill ? palette.accent : c) : null;
        glow = c;
      } else {
        fill = this.paintStyle(ctx, n.paint.fill, n.box, map);
        stroke = this.paintStyle(ctx, n.paint.stroke, n.box, map);
        const c = solid(n.paint.fill) ?? solid(n.paint.stroke);
        glow = c ? css([c[0], c[1], c[2], 1]) : palette.accent;
      }
      this.colors.set(n, { fill, stroke, glow });
    }
    this.palette = palette;
    this.root = root;
  },

  compilePreset(preset) {
    // Presets are checked once, at load, the same way a pack is.
    this.presetCache ??= new Map();
    if (!this.presetCache.has(preset)) {
      const names = ['amount', 'intro', 'band', 'i', 'n', 'rand', 't'];
      const out = {};
      for (const [k, props] of Object.entries(preset)) out[k] = compileProps(props, names, 'preset');
      this.presetCache.set(preset, out);
    }
    return this.presetCache.get(preset);
  },

  paintStyle(ctx, paint, b, map) {
    if (!paint) return null;
    if (paint.color) return css(map(paint.color));
    const g = paint.gradient;
    // Points in the shape's own space: either as given, or 0–1 of its box.
    const at = (x, y) => {
      let pt = { x, y };
      if (g.transform) pt = g.transform.transformPoint(pt);
      return g.user ? pt : { x: b.left + pt.x * b.width, y: b.top + pt.y * b.height };
    };
    let grad;
    if (g.radial) {
      const c = at(g.cx, g.cy), f = at(g.fx, g.fy), e = at(g.cx + g.r, g.cy), e2 = at(g.cx, g.cy + g.r);
      const r = (Math.hypot(e.x - c.x, e.y - c.y) + Math.hypot(e2.x - c.x, e2.y - c.y)) / 2;
      grad = ctx.createRadialGradient(f.x, f.y, 0, c.x, c.y, Math.max(r, 1e-6));
    } else {
      const a = at(g.x1, g.y1), z = at(g.x2, g.y2);
      grad = ctx.createLinearGradient(a.x, a.y, z.x, z.y);
    }
    for (const s of g.stops) grad.addColorStop(s.offset, css(map(s.color)));
    return grad;
  },

  // A colour word from a pack or preset: palette names, "none", or CSS.
  word(value, n) {
    const pal = this.palette;
    if (value === 'none') return null;
    if (value === 'fill') {
      const c = this.colors.get(n);
      return c.fill ?? c.stroke;
    }
    if (value === 'accent' || value === 'text') return pal[value];
    if (value === 'bg') return pal.bg[1];
    const m = value.match(/^color(\d+)$/);
    if (m) return pal.colors[(Number(m[1]) - 1 + pal.colors.length) % pal.colors.length];
    this.wordCache ??= new Map();
    if (!this.wordCache.has(value)) this.wordCache.set(value, css(cssColor(value)));
    return this.wordCache.get(value);
  },

  // A band's raw level barely moves (most sit around 0.4–0.6), so `band` is
  // scaled to how that band moves over the clip: 0 at its quiet end, 1 at its
  // loud end.
  level(frame, pos) {
    const spec = frame.spectrum;
    if (pos < 0 || !spec?.length) return frame.rms;
    const x = pos * (spec.length - 1), a = Math.floor(x), b = Math.min(spec.length - 1, a + 1);
    return spec[a] + (spec[b] - spec[a]) * (x - a);
  },

  range(pos) {
    let r = this.ranges.get(pos);
    if (!r) {
      const v = this.frames.map((f) => this.level(f, pos)).sort((a, b) => a - b);
      const lo = v[Math.floor(v.length * 0.1)] ?? 0, hi = v[Math.floor(v.length * 0.95)] ?? 1;
      r = { lo, span: Math.max(hi - lo, 0.1) };
      this.ranges.set(pos, r);
    }
    return r;
  },

  draw(ctx, frame, env) {
    const { params: p, u, cx, cy } = env;
    this.t0 ??= frame.time;
    // Pack params with limits stay inside them, even when they're expressions.
    for (const [k, spec] of Object.entries(this.paramInfo ?? {})) {
      if (typeof p[k] === 'number') p[k] = clamp(p[k], spec.min ?? -Infinity, spec.max ?? Infinity);
    }
    const shared = { t: frame.time - this.t0 };
    for (const [k, v] of Object.entries(p)) if (typeof v === 'number') shared[k] = v;
    const bandAt = (pos) => {
      const r = this.range(pos);
      return clamp((this.level(frame, pos) - r.lo) / r.span);
    };
    this.frame = frame;
    this.values = (node) => {
      const b = this.bind.get(node);
      if (!b) return null;
      const out = {};
      for (const [k, e] of Object.entries(b)) {
        if (typeof e.v === 'string') {
          out[k] = e.v;
          continue;
        }
        Object.assign(e.vars, shared);
        e.vars.band = bandAt(e.band);
        out[k] = e.v(frame, e.vars);
      }
      return out;
    };
    this.u = u;

    const { view } = this.drawing;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(this.fit, this.fit);
    ctx.translate(-view.cx, -view.cy);
    ctx.lineCap = 'round';
    this.drawNode(ctx, this.root, {}, null);
    ctx.restore();
  },

  drawNode(ctx, node, inh, offset) {
    const v = this.values(node) ?? {};
    const pct = this.D / 100;
    ctx.save();
    if (offset) ctx.translate(offset.x, offset.y);
    if (v.x || v.y) {
      const s = node.parent?.scale ?? 1;
      ctx.translate(((v.x ?? 0) * pct) / s, ((v.y ?? 0) * pct) / s);
    }
    const m = node.matrix;
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    const scale = v.scale ?? 1, sx = scale * (v.sx ?? 1), sy = scale * (v.sy ?? 1);
    if (v.rotate || sx !== 1 || sy !== 1 || v.skew) {
      const o = this.origin(node, v.origin);
      ctx.translate(o.x, o.y);
      if (v.rotate) ctx.rotate((v.rotate * Math.PI) / 180);
      if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
      if (v.skew) ctx.transform(1, 0, Math.tan((clamp(v.skew, -80, 80) * Math.PI) / 180), 1, 0, 0);
      ctx.translate(-o.x, -o.y);
    }
    ctx.globalAlpha *= clamp(node.opacity * (v.opacity ?? 1));
    if (ctx.globalAlpha <= 0.002) {
      ctx.restore();
      return;
    }
    const next = { ...inh, hue: (inh.hue ?? 0) + (v.hue ?? 0) };
    for (const k of INHERIT) if (v[k] !== undefined) next[k] = v[k];

    if (node.path) this.drawShape(ctx, node, next, v.explode ?? 0);
    else {
      const ex = v.explode ?? 0;
      const b = node.box;
      for (const c of node.children) {
        let off = null;
        if (ex) {
          const cc = c.matrix.transformPoint({ x: c.box.cx, y: c.box.cy });
          off = { x: (cc.x - b.cx) * ex, y: (cc.y - b.cy) * ex };
        }
        this.drawNode(ctx, c, next, off);
      }
    }
    ctx.restore();
  },

  // The point a node turns and scales around, in its own coordinates.
  origin(node, spec) {
    const b = node.box;
    if (!spec || spec === 'center') return { x: b.cx, y: b.cy };
    const words = { left: [0, null], right: [1, null], top: [null, 0], bottom: [null, 1], center: [null, null] };
    const parts = spec.trim().split(/[\s,]+/);
    if (parts.every((w) => w in words)) {
      let fx = 0.5, fy = 0.5;
      for (const w of parts) {
        if (words[w][0] !== null) fx = words[w][0];
        if (words[w][1] !== null) fy = words[w][1];
      }
      return { x: b.left + fx * b.width, y: b.top + fy * b.height };
    }
    const at = (s, lo, size) => (s.endsWith('%') ? lo + (parseFloat(s) / 100) * size : parseFloat(s));
    return { x: at(parts[0], b.left, b.width), y: at(parts[1] ?? parts[0], b.top, b.height) };
  },

  drawShape(ctx, node, v, explode) {
    const P = node.paint, col = this.colors.get(node), u = this.u;
    const k = this.D / 100 / (node.scale || 1); // local units per % of the drawing
    let fill = col.fill, stroke = col.stroke, glow = col.glow;
    if (v.fill !== undefined) fill = this.word(v.fill, node);
    if (v.stroke !== undefined) stroke = this.word(v.stroke, node);
    if (v.fill !== undefined || v.stroke !== undefined) {
      const c = typeof fill === 'string' ? fill : typeof stroke === 'string' ? stroke : null;
      if (c) glow = c;
    }

    const filters = [];
    if (v.hue) filters.push(`hue-rotate(${v.hue.toFixed(1)}deg)`);
    if (v.blur > 0.05) filters.push(`blur(${(v.blur * u).toFixed(2)}px)`);
    if (filters.length) ctx.filter = filters.join(' ');

    const draw = clamp(v.draw ?? 1);
    const outline = Math.max(0, v.outline ?? 1);
    const base = P.stroke ? P.width : 0.4 * k; // stroke width in local units
    ctx.lineWidth = base * outline;
    ctx.lineJoin = P.join;
    ctx.lineCap = P.cap;
    ctx.miterLimit = P.miter;
    if (v.glow > 0.2) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = v.glow * u;
    }
    const alpha = ctx.globalAlpha;

    // Exploding shapes come apart into their separate outlines.
    let list = [{ path: node.path, box: node.box, r: 0 }];
    if (explode > 0.005) {
      node.pieces ??= pieces(node.path).map((pc, j) => ({ ...pc, r: rng(node.order * 7919 + j)() - 0.5 }));
      if (node.pieces.length > 1) list = node.pieces;
    }
    for (const pc of list) {
      ctx.save();
      if (list.length > 1) {
        const b = node.box;
        ctx.translate((pc.box.cx - b.cx) * explode, (pc.box.cy - b.cy) * explode);
        ctx.translate(pc.box.cx, pc.box.cy);
        ctx.rotate(pc.r * explode * 0.8);
        ctx.translate(-pc.box.cx, -pc.box.cy);
      }
      let path = pc.path;
      if (v.jitter > 0.01) {
        const amt = v.jitter * k;
        path = path.jitter(Math.max(amt * 2.5, 0.5 * k), amt, (this.frame.index >> 1) * 31 + Math.floor(node.order));
      }

      // While drawing on, shapes without an outline get one in their fill colour.
      const line = stroke ?? (draw < 1 || v.stroke === 'fill' ? fill : null);
      // Red and blue copies behind the shape, so only their edges show.
      if (v.split > 0.01) {
        const d = v.split * k;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.shadowBlur = 0;
        ctx.globalAlpha = alpha * 0.8;
        for (const [dx, c] of [[-d, 'rgb(255,30,70)'], [d, 'rgb(0,190,255)']]) {
          ctx.save();
          ctx.translate(dx, 0);
          if (fill && draw > 0.6) {
            ctx.fillStyle = c;
            ctx.fill(path, P.rule);
          } else if (line) {
            ctx.strokeStyle = c;
            ctx.stroke(path);
          }
          ctx.restore();
        }
        ctx.restore();
      }

      if (fill && draw > 0.6) {
        ctx.globalAlpha = alpha * P.fillOpacity * (draw >= 1 ? 1 : smooth((draw - 0.6) / 0.4));
        ctx.fillStyle = fill;
        ctx.fill(path, P.rule);
      }
      if (line && outline > 0 && draw > 0) {
        ctx.globalAlpha = alpha * (stroke ? P.strokeOpacity : 1);
        ctx.strokeStyle = line;
        ctx.stroke(draw < 1 ? path.trim(0, draw) : path);
      }

      if (v.echo > 0.01) {
        const e = Math.min(v.echo, 1.5), b = pc.box;
        ctx.save();
        ctx.strokeStyle = glow;
        for (let j = 1; j <= 3; j++) {
          const s = 1 + j * 0.07 * e;
          ctx.globalAlpha = alpha * Math.min(1, e) * (1 - j / 4) * 0.8;
          ctx.save();
          ctx.translate(b.cx, b.cy);
          ctx.scale(s, s);
          ctx.translate(-b.cx, -b.cy);
          ctx.lineWidth = (0.3 * k) / s;
          ctx.stroke(path);
          ctx.restore();
        }
        ctx.restore();
      }

      if (v.trace !== undefined) {
        const a = frac(v.trace), z = a + 0.12;
        const seg = z <= 1 ? path.trim(a, z) : new Path2D(path.trim(a, 1));
        if (z > 1) seg.addPath(path.trim(0, z - 1));
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = this.palette.text;
        ctx.shadowColor = this.palette.accent;
        ctx.shadowBlur = 18 * u;
        ctx.lineWidth = Math.min(Math.max(base * outline * 1.3, 0.6 * k), 1.2 * k);
        ctx.lineCap = 'round';
        ctx.stroke(seg);
        ctx.restore();
      }
      ctx.restore();
    }
    ctx.globalAlpha = alpha;
  },
};
