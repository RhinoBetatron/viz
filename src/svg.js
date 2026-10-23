// Reads an SVG (and optionally a JSON pack that rigs it) into a tree of shapes
// the svg style can move, recolour and break apart with the music.
//
// What moves is described in the same expression language as -P, in three
// places, later ones winning:
//   1. a preset (-P preset=pulse), applied to the drawing's main parts
//   2. data-viz="rotate: beat*360; glow: high*20" attributes in the SVG
//   3. a pack file (logo.viz.json): its own params, plus CSS-like selectors
//      ("#wheel", ".petal", "g path") mapped to properties
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Canvas, DOMMatrix, Path2D } from 'skia-canvas';
import { compile, reserved } from './modulate.js';

// Every property a shape or group can have. `expr` ones are expressions
// evaluated every frame; the others are fixed words.
export const PROPS = {
  x: 'move sideways, in % of the drawing\'s size',
  y: 'move down, in % of the drawing\'s size',
  rotate: 'turn, in degrees',
  scale: 'size, 1 = as drawn',
  sx: 'stretch sideways, 1 = as drawn',
  sy: 'stretch up and down, 1 = as drawn',
  skew: 'slant, in degrees',
  opacity: '0 (gone) to 1',
  hue: 'shift the colours around the colour wheel, in degrees',
  blur: 'blur, in px at 1080p',
  glow: 'glow around the shape, in px at 1080p',
  outline: 'stroke width, 1 = as drawn (shapes without a stroke get a thin one)',
  draw: 'draw the outline on, 0 → 1 (the fill fades in at the end)',
  trace: 'a bright spark running round the outline, 0 → 1 is one lap',
  jitter: 'wobbly edges, in % of the drawing\'s size',
  explode: 'pieces fly apart from the centre, 1 = twice as far',
  echo: 'ripples of the outline spreading out, 0 → 1',
  split: 'red/blue split, in % of the drawing\'s size',
  origin: 'what it turns and scales around: center (default), top, bottom left, "50% 100%" or "120 45" (SVG units)',
  fill: 'colour: any CSS colour, a palette colour (accent, text, bg, color1, color2…), fill or none',
  stroke: 'outline colour, as fill; "fill" uses the shape\'s fill colour',
};
const WORDS = new Set(['origin', 'fill', 'stroke']);

// Variables only an SVG expression has, set for each shape.
export const SHAPE_VARS = {
  band: 'this shape\'s frequency band, 0 (as quiet as it gets in the clip) to 1 (as loud): early parts get the bass, later ones the highs',
  i: 'which one this is among its matches (or siblings), from 0',
  n: 'how many matches (or siblings) there are',
  rand: 'a fixed random number 0–1 for this shape',
  t: 'seconds since this scene started',
};

// ── XML ────────────────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENTITIES[e] ?? m;
});

const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>|<\?[\s\S]*?\?>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/gy;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseXml(text) {
  const root = { tag: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  TAG.lastIndex = 0;
  while (TAG.lastIndex < text.length) {
    const at = TAG.lastIndex;
    const m = TAG.exec(text);
    if (!m) throw new Error(`can't read the SVG near "${text.slice(at, at + 40).replace(/\s+/g, ' ')}"`);
    const top = stack.at(-1);
    if (m[1] !== undefined) top.text += m[1];
    else if (m[6] !== undefined) top.text += decode(m[6]);
    else if (m[2]) {
      // Close back to the matching tag (tolerates a missing close or two).
      const i = stack.findLastIndex((n) => n.tag === m[2]);
      if (i > 0) stack.length = i;
    } else if (m[3]) {
      const attrs = {};
      for (const a of m[4].matchAll(ATTR)) attrs[a[1]] = decode(a[2] ?? a[3]);
      const node = { tag: m[3].replace(/^svg:/, ''), attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    }
  }
  return root;
}

// ── CSS (<style> blocks and style="" attributes) ───────────────────────────

function parseDeclarations(text) {
  const out = {};
  for (const part of text.split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

function parseCss(text) {
  const rules = [];
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  for (const m of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decls = parseDeclarations(m[2]);
    for (const sel of m[1].split(',')) {
      const s = parseSelector(sel);
      if (s) rules.push({ selector: s, decls });
    }
  }
  return rules;
}

// Selectors: tag, #id, .class, *, and combinations like g.wing or "#bird path"
// (a space means "inside"). #name also matches Inkscape layer labels.
function parseSelector(text) {
  const steps = text.trim().split(/\s+/).filter((s) => s && s !== '>');
  if (!steps.length) return null;
  const out = [];
  for (const step of steps) {
    const m = step.match(/^([\w-]+|\*)?((?:[#.][\w-]+)*)$/);
    if (!m) return null; // :hover, [attr] and the like: not ours
    out.push({ tag: m[1] && m[1] !== '*' ? m[1] : null, ids: [...m[2].matchAll(/#([\w-]+)/g)].map((x) => x[1]), classes: [...m[2].matchAll(/\.([\w-]+)/g)].map((x) => x[1]) });
  }
  return out;
}

const stepMatches = (st, node) => (!st.tag || st.tag === node.tag)
  && st.ids.every((id) => node.id === id || node.label === id)
  && st.classes.every((c) => node.classes.includes(c));

function matches(selector, node) {
  if (!stepMatches(selector.at(-1), node)) return false;
  let k = selector.length - 2;
  for (let p = node.parent; p && k >= 0; p = p.parent) if (stepMatches(selector[k], p)) k--;
  return k < 0;
}

// ── Geometry ───────────────────────────────────────────────────────────────

const nums = (s) => (s ?? '').match(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
const len = (v, ref = 0) => {
  if (v === undefined || v === null || v === '') return 0;
  const s = String(v).trim();
  return s.endsWith('%') ? (parseFloat(s) / 100) * ref : parseFloat(s) || 0;
};

function parseTransform(text) {
  let m = new DOMMatrix();
  for (const [, fn, args] of (text ?? '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = nums(args);
    if (fn === 'matrix' && a.length === 6) m = m.multiply(new DOMMatrix(a));
    else if (fn === 'translate') m = m.translate(a[0] ?? 0, a[1] ?? 0);
    else if (fn === 'scale') m = m.scale(a[0] ?? 1, a[1] ?? a[0] ?? 1);
    else if (fn === 'rotate') m = a.length >= 3 ? m.translate(a[1], a[2]).rotate(a[0]).translate(-a[1], -a[2]) : m.rotate(a[0] ?? 0);
    else if (fn === 'skewX') m = m.skewX(a[0] ?? 0);
    else if (fn === 'skewY') m = m.skewY(a[0] ?? 0);
  }
  return m;
}

function shapePath(tag, a, view) {
  const p = new Path2D();
  switch (tag) {
    case 'path':
      return a.d ? new Path2D(a.d) : null;
    case 'rect': {
      const w = len(a.width, view.w), h = len(a.height, view.h);
      if (w <= 0 || h <= 0) return null;
      let rx = a.rx !== undefined ? len(a.rx, view.w) : undefined, ry = a.ry !== undefined ? len(a.ry, view.h) : undefined;
      rx ??= ry ?? 0;
      ry ??= rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      const x = len(a.x, view.w), y = len(a.y, view.h);
      if (rx > 0 || ry > 0) p.roundRect(x, y, w, h, [{ x: rx, y: ry }]);
      else p.rect(x, y, w, h);
      return p;
    }
    case 'circle': {
      const r = len(a.r, Math.hypot(view.w, view.h) / Math.SQRT2);
      if (r <= 0) return null;
      p.arc(len(a.cx, view.w), len(a.cy, view.h), r, 0, Math.PI * 2);
      p.closePath();
      return p;
    }
    case 'ellipse': {
      const rx = len(a.rx, view.w), ry = len(a.ry, view.h);
      if (rx <= 0 || ry <= 0) return null;
      p.ellipse(len(a.cx, view.w), len(a.cy, view.h), rx, ry, 0, 0, Math.PI * 2);
      p.closePath();
      return p;
    }
    case 'line':
      p.moveTo(len(a.x1, view.w), len(a.y1, view.h));
      p.lineTo(len(a.x2, view.w), len(a.y2, view.h));
      return p;
    case 'polyline':
    case 'polygon': {
      const v = nums(a.points);
      if (v.length < 4) return null;
      p.moveTo(v[0], v[1]);
      for (let i = 2; i + 1 < v.length; i += 2) p.lineTo(v[i], v[i + 1]);
      if (tag === 'polygon') p.closePath();
      return p;
    }
  }
  return null;
}

// Bounding box of a box after a transform.
function mapBox(m, b) {
  if (!b) return null;
  const pts = [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]].map(([x, y]) => m.transformPoint({ x, y }));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return box(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}
const box = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top, cx: (left + right) / 2, cy: (top + bottom) / 2 });
const union = (a, b) => (!a ? b : !b ? a : box(Math.min(a.left, b.left), Math.min(a.top, b.top), Math.max(a.right, b.right), Math.max(a.bottom, b.bottom)));

// The separate pieces of a path, for exploding: each outline, with any
// outlines inside it (the hole in an O) kept with it.
export function pieces(p) {
  const list = p.contours.map((c) => ({ path: c, b: c.bounds })).filter((c) => c.b.width > 0 || c.b.height > 0);
  list.sort((a, b) => b.b.width * b.b.height - a.b.width * a.b.height);
  const groups = [];
  for (const c of list) {
    const inside = (g) => c.b.left >= g.b.left - 1e-6 && c.b.right <= g.b.right + 1e-6 && c.b.top >= g.b.top - 1e-6 && c.b.bottom <= g.b.bottom + 1e-6;
    const host = groups.findLast(inside);
    if (host) host.path.addPath(c.path);
    else groups.push({ path: new Path2D(c.path), b: c.b });
  }
  return groups.map((g) => ({ path: g.path, box: box(g.b.left, g.b.top, g.b.right, g.b.bottom) }));
}

// ── Building the drawing ───────────────────────────────────────────────────

const INHERITED = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'color', 'visibility'];
const PRESENTATION = new Set([...INHERITED, 'opacity', 'display']);
const SKIP = new Set(['defs', 'clipPath', 'mask', 'symbol', 'linearGradient', 'radialGradient', 'pattern', 'marker', 'title', 'desc', 'metadata', 'style', 'filter', 'script', 'namedview', 'sodipodi:namedview']);
const CONTAINERS = new Set(['g', 'a', 'switch', 'svg']);
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const UNSUPPORTED = { text: 'text (convert it to outlines/paths in your editor)', image: 'embedded images', foreignObject: 'foreignObject' };

// Colours are normalised through skia (handles names, hsl(), …).
const probe = new Canvas(1, 1).getContext('2d');
export function cssColor(c) {
  probe.fillStyle = '#000';
  probe.fillStyle = c;
  const v = probe.fillStyle;
  if (v.startsWith('#')) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
  const n = nums(v);
  return [n[0], n[1], n[2], n[3] ?? 1];
}

export async function loadSvg(file) {
  const text = await readFile(file, 'utf8');
  if (!/<svg[\s>]/.test(text)) throw new Error(`${path.basename(file)} isn't an SVG (no <svg> tag)`);
  const doc = parseXml(text);
  const svg = doc.children.find((n) => n.tag === 'svg');
  if (!svg) throw new Error(`${path.basename(file)} isn't an SVG (no <svg> tag)`);

  // Index ids (for <use> and gradients) and gather <style> rules.
  const byId = new Map();
  const css = [];
  (function walk(n) {
    if (n.attrs?.id) byId.set(n.attrs.id, n);
    if (n.tag === 'style') css.push(...parseCss(n.text));
    n.children.forEach(walk);
  })(svg);

  const vb = nums(svg.attrs.viewBox);
  const warnings = new Set();
  const all = [];
  let order = 0;

  // Paint and opacity as the SVG would compute them: presentation attributes,
  // then <style> rules, then the style="" attribute.
  function styleOf(xml, node) {
    const own = {};
    for (const [k, v] of Object.entries(xml.attrs)) if (PRESENTATION.has(k)) own[k] = v;
    for (const r of css) if (matches(r.selector, node)) Object.assign(own, r.decls);
    if (xml.attrs.style) Object.assign(own, parseDeclarations(xml.attrs.style));
    return own;
  }

  function build(xml, parent, inherited, view, extra = null) {
    const tag = xml.tag;
    if (SKIP.has(tag) || tag.includes(':')) return null;
    if (UNSUPPORTED[tag]) {
      warnings.add(`skipped ${UNSUPPORTED[tag]}`);
      return null;
    }
    const isUse = tag === 'use';
    if (!CONTAINERS.has(tag) && !SHAPES.has(tag) && !isUse) return null;
    const a = xml.attrs;
    const node = {
      tag, parent, order: order++,
      id: a.id ?? null,
      label: a['inkscape:label'] ?? a['data-name'] ?? null,
      classes: (a.class ?? '').split(/\s+/).filter(Boolean),
      viz: a['data-viz'] ?? null,
      children: [],
    };
    const style = styleOf(xml, node);
    if (style.display === 'none') return null;
    if (a['clip-path'] || a.mask || a.filter || style['clip-path'] || style.mask || style.filter) warnings.add('clip paths, masks and filters are left out');
    const paint = { ...inherited };
    for (const k of INHERITED) if (style[k] !== undefined && style[k] !== 'inherit') paint[k] = style[k];
    node.opacity = Math.max(0, Math.min(1, style.opacity !== undefined ? parseFloat(style.opacity) : 1));

    let m = parseTransform(a.transform);
    if (extra) m = extra.multiply(m);
    if (tag === 'svg' && parent) m = m.translate(len(a.x, view.w), len(a.y, view.h)); // nested <svg>
    if (isUse) m = m.translate(len(a.x, view.w), len(a.y, view.h));
    node.matrix = m;

    if (isUse) {
      const ref = byId.get((a.href ?? a['xlink:href'] ?? '').replace(/^#/, ''));
      if (!ref) return null;
      // A <use> draws its target as if it were a child; a <symbol> as a group.
      const target = ref.tag === 'symbol' ? { ...ref, tag: 'g' } : ref;
      const child = build(target, node, paint, view);
      if (child) node.children.push(child);
      node.tag = 'g';
    } else if (SHAPES.has(tag)) {
      const p = shapePath(tag, a, view);
      if (!p || paint.visibility === 'hidden' || paint.visibility === 'collapse') return null;
      node.path = p;
      node.paint = paint;
      const b = p.bounds;
      node.box = box(b.left, b.top, b.right, b.bottom);
    } else {
      const inner = tag === 'svg' && parent ? { w: nums(a.viewBox)[2] ?? len(a.width, view.w), h: nums(a.viewBox)[3] ?? len(a.height, view.h) } : view;
      for (const c of xml.children) {
        const child = build(c, node, paint, inner);
        if (child) node.children.push(child);
      }
      if (!node.children.length) return null;
    }
    if (!node.path) node.box = node.children.reduce((acc, c) => union(acc, mapBox(c.matrix, c.box)), null);
    if (!node.box) return null;
    all.push(node);
    return node;
  }

  const w0 = vb[2] ?? (len(svg.attrs.width) || 0), h0 = vb[3] ?? (len(svg.attrs.height) || 0);
  const root = build(svg, null, { fill: 'black' }, { w: w0 || 100, h: h0 || 100 });
  if (!root) throw new Error(`${path.basename(file)} has nothing to draw (only paths, rects, circles, ellipses, lines and polygons are drawn)`);
  root.matrix = new DOMMatrix(); // the root's own x/y/size are the frame's business
  // The area to fit: the viewBox, or failing that what's actually drawn.
  const view = vb.length === 4 && vb[2] > 0 && vb[3] > 0
    ? box(vb[0], vb[1], vb[0] + vb[2], vb[1] + vb[3])
    : w0 > 0 && h0 > 0 ? box(0, 0, w0, h0) : root.box;

  // Scale of each node relative to the drawing (for sizes in % of it), and
  // its gradients.
  (function scale(n, s) {
    n.scale = s;
    for (const c of n.children) scale(c, s * Math.sqrt(Math.abs(c.matrix.a * c.matrix.d - c.matrix.b * c.matrix.c)) || s);
  })(root, 1);
  for (const n of all) if (n.path) n.paint = resolvePaint(n, byId, warnings);

  const { holder, parts } = findParts(root);
  const nodes = [];
  (function walk(n) {
    nodes.push(n);
    n.children.forEach(walk);
  })(root);
  return { file, root, view, size: Math.max(view.width, view.height), nodes, holder, parts, warnings: [...warnings] };
}

// fill/stroke as { color } or { gradient }, with opacities folded in.
function resolvePaint(node, byId, warnings) {
  const p = node.paint;
  const read = (v) => {
    if (!v || v === 'none' || v === 'transparent') return null;
    const url = v.match(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)\s*(.*)/);
    if (url) {
      const g = gradient(url[1], byId);
      if (g) return { gradient: g };
      warnings.add('a fill it couldn\'t read (pattern?) was drawn in a plain colour');
      return url[2] && url[2] !== 'none' ? read(url[2]) : { color: [128, 128, 128, 1] };
    }
    if (v === 'currentColor') return p.color ? read(p.color) : { color: [0, 0, 0, 1] };
    return { color: cssColor(v) };
  };
  return {
    fill: read(p.fill),
    stroke: read(p.stroke),
    fillOpacity: p['fill-opacity'] !== undefined ? parseFloat(p['fill-opacity']) : 1,
    strokeOpacity: p['stroke-opacity'] !== undefined ? parseFloat(p['stroke-opacity']) : 1,
    width: p['stroke-width'] !== undefined ? len(p['stroke-width']) : 1,
    rule: p['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero',
    cap: p['stroke-linecap'] ?? 'butt',
    join: p['stroke-linejoin'] ?? 'miter',
    miter: p['stroke-miterlimit'] !== undefined ? parseFloat(p['stroke-miterlimit']) : 4,
  };
}

// Linear and radial gradients, following href for stops and settings.
function gradient(id, byId) {
  let n = byId.get(id);
  if (!n || !/Gradient$/.test(n.tag)) return null;
  const attrs = {};
  let stops = null;
  for (let k = 0; n && k < 8; k++) {
    for (const [key, v] of Object.entries(n.attrs)) if (!(key in attrs)) attrs[key] = v;
    if (!stops) {
      const s = n.children.filter((c) => c.tag === 'stop');
      if (s.length) stops = s;
    }
    n = byId.get((n.attrs.href ?? n.attrs['xlink:href'] ?? '').replace(/^#/, ''));
  }
  if (!stops) return null;
  const tag = byId.get(id).tag;
  const user = attrs.gradientUnits === 'userSpaceOnUse';
  const frac = (v, d) => (v === undefined ? d : String(v).trim().endsWith('%') ? parseFloat(v) / 100 : parseFloat(v));
  const g = {
    radial: tag === 'radialGradient',
    user,
    transform: attrs.gradientTransform ? parseTransform(attrs.gradientTransform) : null,
    stops: stops.map((s) => {
      const st = { ...s.attrs, ...parseDeclarations(s.attrs.style ?? '') };
      const c = cssColor(st['stop-color'] ?? 'black');
      return { offset: Math.max(0, Math.min(1, frac(st.offset, 0))), color: [c[0], c[1], c[2], c[3] * (st['stop-opacity'] !== undefined ? parseFloat(st['stop-opacity']) : 1)] };
    }),
  };
  if (g.radial) {
    g.cx = frac(attrs.cx, 0.5); g.cy = frac(attrs.cy, 0.5); g.r = frac(attrs.r, 0.5);
    g.fx = frac(attrs.fx, g.cx); g.fy = frac(attrs.fy, g.cy);
  } else {
    g.x1 = frac(attrs.x1, 0); g.y1 = frac(attrs.y1, 0); g.x2 = frac(attrs.x2, 1); g.y2 = frac(attrs.y2, 0);
  }
  return g;
}

// ── Rigging: presets, data-viz and packs ───────────────────────────────────

// "rotate: beat*360; scale: 1+kick*0.3" → { rotate: …, scale: … }
export function parseViz(text) {
  const out = {};
  for (const part of text.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) {
      if (part.trim()) throw new Error(`can't read "${part.trim()}" (write property: value, separated by ;)`);
      continue;
    }
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// Checks and compiles one property map. Words (fill, stroke, origin) stay
// strings; everything else becomes fn(frame, vars).
export function compileProps(props, names, where) {
  const out = {};
  for (const [key, raw] of Object.entries(props)) {
    if (!(key in PROPS)) throw new Error(`${where}: unknown property "${key}". Properties: ${Object.keys(PROPS).join(', ')}`);
    if (WORDS.has(key)) {
      out[key] = String(raw).trim();
      continue;
    }
    if (typeof raw === 'number') {
      out[key] = () => raw;
      continue;
    }
    try {
      out[key] = compile(String(raw), { names, constant: true }).fn;
    } catch (err) {
      throw new Error(`${where}: ${key}: ${err.message}`);
    }
  }
  return out;
}

// The main parts of a drawing, which presets animate and which get a
// frequency band each: the children of the first group that splits into
// several things. A lone path with several separate outlines (an icon, a
// word) is split into its pieces.
function findParts(root) {
  let n = root;
  while (n.children.length === 1 && !n.children[0].path) n = n.children[0];
  if (n.children.length > 1) {
    // Too few to be interesting (a backdrop and one group of letters): open
    // up the groups among them, so each letter gets its own band.
    let parts = n.children;
    while (parts.length < 4) {
      const g = parts.filter((p) => p.children.length > 1).sort((a, b) => b.children.length - a.children.length)[0];
      if (!g || parts.length + g.children.length - 1 > 12) break;
      parts = parts.flatMap((p) => (p === g ? p.children : [p]));
    }
    return { holder: n, parts };
  }
  const leaf = n.children[0];
  const ps = pieces(leaf.path);
  if (ps.length < 2) return { holder: n, parts: [leaf] };
  // Turn the path into a group of its pieces (same paint), so each can move.
  const group = { ...leaf, tag: 'g', path: undefined, paint: undefined, children: [] };
  group.children = ps.map((p, k) => ({
    tag: 'path', parent: group, order: leaf.order + (k + 1) / (ps.length + 1), id: null, label: null, classes: [], viz: null,
    children: [], opacity: 1, matrix: new DOMMatrix(), path: p.path, box: p.box, paint: leaf.paint, scale: leaf.scale,
  }));
  const siblings = leaf.parent.children;
  siblings[siblings.indexOf(leaf)] = group;
  return { holder: group, parts: group.children };
}

// Builds the svg style for one drawing: a .svg on its own, or a pack (.json)
// that points at one and adds params and selectors.
export async function loadDrawing(file, base, taken = []) {
  const ext = path.extname(file).toLowerCase();
  let pack = null, svgFile = file, packFile = null;
  if (ext === '.json') {
    packFile = file;
  } else {
    // logo.svg picks up logo.viz.json next to it.
    const side = file.replace(/\.svg$/i, '') + '.viz.json';
    if (await stat(side).then(() => true, () => false)) packFile = side;
  }
  if (packFile) {
    try {
      pack = JSON.parse(await readFile(packFile, 'utf8'));
    } catch (err) {
      throw new Error(`${path.basename(packFile)}: ${err.message}`);
    }
    if (ext === '.json') {
      if (!pack.svg) throw new Error(`${path.basename(packFile)}: add "svg": "your-file.svg" to say which drawing it rigs`);
      svgFile = path.resolve(path.dirname(packFile), pack.svg);
    }
  }
  const where = path.basename(packFile ?? svgFile);
  const drawing = await loadSvg(svgFile).catch((err) => {
    if (err.code === 'ENOENT') throw new Error(`${where}: can't find ${svgFile}`);
    throw err;
  });

  // The pack's own params: plain defaults, or { default, min, max, description }.
  const params = {}, info = {};
  for (const [k, v] of Object.entries(pack?.params ?? {})) {
    if (!/^[a-z_]\w*$/i.test(k)) throw new Error(`${where}: param "${k}" needs a plain name (letters, digits, _)`);
    if (reserved.has(k) || k in SHAPE_VARS) throw new Error(`${where}: param "${k}" clashes with a built-in name, pick another`);
    const spec = v !== null && typeof v === 'object' ? v : { default: v };
    if (spec.default === undefined) throw new Error(`${where}: param "${k}" needs a default`);
    params[k] = spec.default;
    info[k] = spec;
  }
  const numeric = (o) => Object.keys(o).filter((k) => typeof o[k] === 'number');
  const names = [...new Set([...numeric(base.params), ...numeric(params), ...Object.keys(SHAPE_VARS)])];

  // data-viz attributes, then the pack's selectors.
  const rules = [];
  for (const node of drawing.nodes) {
    if (!node.viz) continue;
    const label = node.id ? `#${node.id}` : `<${node.tag}>`;
    let props;
    try {
      props = parseViz(node.viz);
    } catch (err) {
      throw new Error(`${path.basename(svgFile)}: data-viz on ${label}: ${err.message}`);
    }
    rules.push({ nodes: [node], props: compileProps(props, names, `${path.basename(svgFile)}: data-viz on ${label}`), siblings: true });
  }
  for (const [sel, props] of Object.entries(pack?.layers ?? {})) {
    const selectors = sel.split(',').map((s) => parseSelector(s));
    if (selectors.some((s) => !s)) throw new Error(`${where}: can't read the selector "${sel}" (use #id, .class, tag, * or "#group path")`);
    const hits = drawing.nodes.filter((n) => n.parent && selectors.some((s) => matches(s, n)));
    if (!hits.length) drawing.warnings.push(`"${sel}" in ${where} matches nothing (viz --svg ${path.basename(svgFile)} --list-layers shows what's there)`);
    rules.push({ nodes: hits, props: compileProps(props, names, `${where}: "${sel}"`) });
  }

  const rigged = rules.length > 0;
  const fileName = path.basename(svgFile, path.extname(svgFile)).toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'drawing';
  let name = pack?.name ?? fileName;
  if (!/^[\w-]+$/.test(name)) throw new Error(`${where}: "name" can only use letters, digits, - and _`);
  if (taken.includes(name)) {
    if (pack?.name) throw new Error(`${where}: there's already a style called "${name}", give the pack another name`);
    name = `svg-${name}`;
  }
  for (const k of Object.keys(pack ?? {})) {
    if (!['svg', 'name', 'description', 'palette', 'params', 'layers'].includes(k)) throw new Error(`${where}: unknown key "${k}" (a pack has svg, name, description, palette, params and layers)`);
  }
  return {
    ...base,
    name,
    description: pack?.description ?? `${path.basename(svgFile)}, animated with the music${rigged ? '' : ' (preset: pump, explode, wire, glitch)'}`,
    palette: pack?.palette ?? base.palette,
    // Rigged drawings move the way they're rigged; presets only when asked.
    params: { ...base.params, preset: rigged ? 'none' : base.params.preset, ...params },
    presets: rigged ? undefined : base.presets,
    paramInfo: info,
    files: [svgFile, packFile].filter(Boolean),
    drawing,
    rules,
  };
}

// For --list-layers: the tree, with what selectors would reach each node.
export function describeTree(drawing) {
  const lines = [];
  const { parts } = drawing;
  const partOf = new Map(parts.map((p, k) => [p, k]));
  const name = (n) => `${n.tag}${n.id ? `#${n.id}` : ''}${n.classes.map((c) => `.${c}`).join('')}${n.label && n.label !== n.id ? ` "${n.label}"` : ''}`;
  const count = (n) => (n.path ? 1 : n.children.reduce((s, c) => s + count(c), 0));
  const band = (k) => ['bass', 'low mids', 'mids', 'high mids', 'highs'][Math.min(4, Math.floor((k + 0.5) / parts.length * 5))];
  (function walk(n, prefix, last, depth) {
    const tags = [];
    if (!n.path) tags.push(`${count(n)} shape${count(n) === 1 ? '' : 's'}`);
    if (partOf.has(n)) tags.push(`part ${partOf.get(n) + 1} · ${band(partOf.get(n))}`);
    if (n.viz) tags.push(`data-viz: ${n.viz}`);
    lines.push(`${prefix}${depth ? (last ? '└─ ' : '├─ ') : ''}${name(n)}${tags.length ? `   (${tags.join(', ')})` : ''}`);
    const kids = n.children;
    const shown = kids.length > 12 ? kids.slice(0, 10) : kids;
    const next = prefix + (depth ? (last ? '   ' : '│  ') : '');
    shown.forEach((c, k) => walk(c, next, k === kids.length - 1, depth + 1));
    if (shown.length < kids.length) lines.push(`${next}└─ … ${kids.length - shown.length} more`);
  })(drawing.root, '  ', true, 0);
  return lines;
}
