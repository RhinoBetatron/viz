// Style settings that move: -P spin=bass*0.1, -P glow=1+2*sine(4),
// -P glow="0:50=0.5 0:55.8=3 1:10=1".
// A value that mentions a signal or an LFO becomes a small expression, and a
// list of time=value pairs becomes automation. Both are evaluated every frame
// before the style draws. Plain words (symbol=eye) stay as they are.

// What an expression can react to, read from the current frame.
export const signals = {
  bass: (f) => f.bass,
  mid: (f) => f.mid,
  high: (f) => f.high,
  rms: (f) => f.rms,
  pulse: (f) => f.pulse,          // 1 on a kick, decaying after
  kick: (f) => f.kickStrength,    // only on the kick frame
  onset: (f) => f.onsetStrength,  // only on the hit frame
  beat: (f) => f.beatPhase,       // 0 → 1 through each beat
  bar: (f) => f.barPhase,         // 0 → 1 through each bar
  time: (f) => f.time,            // seconds into the clip
  progress: (f) => f.progress,    // 0 → 1 through the clip
};

const helpers = {
  sin: Math.sin, cos: Math.cos, abs: Math.abs, min: Math.min, max: Math.max,
  floor: Math.floor, round: Math.round, sqrt: Math.sqrt, pow: Math.pow,
  clamp: (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v)),
  pi: Math.PI,
};

// LFOs, synced to the beat grid: shape(period in bars, phase 0–1), all 0 → 1.
// Every cycle starts on a downbeat of the track, so the same command always
// lines up the same way, whatever --start is.
const frac = (x) => x - Math.floor(x);
const hash = (n) => {
  let x = Math.imul(n ^ 0x5bd1e995, 0x27d4eb2d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x165667b1);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
};
const shapes = {
  sine: (x) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x), // low on the downbeat, peak halfway
  tri: (x) => 1 - Math.abs(2 * frac(x) - 1),
  saw: (x) => frac(x),                                  // ramps up, drops on the downbeat
  square: (x) => (frac(x) < 0.5 ? 1 : 0),
  noise: (x) => {                                       // a new smooth random value each period
    const i = Math.floor(x), t = frac(x), s = t * t * (3 - 2 * t);
    return hash(i) + (hash(i + 1) - hash(i)) * s;
  },
};
export const lfos = Object.keys(shapes);

const TOKEN = /\s*(?:(\d*\.?\d+(?:e[+-]?\d+)?)|([a-z_]\w*)|(\*\*|[-+*/%^(),]))/giy;

// Returns { fn, uses } for an expression or automation, or null when the
// value is just a word. Throws on something that looks like one but can't be.
// `names` are extra variables it may use (an SVG pack's params, a shape's
// band…), handed to fn(frame, vars) on each call. With `constant`, numbers and
// sums like 2*3 count as expressions too instead of being rejected.
export function compile(text, { names = [], constant = false } = {}) {
  if (typeof text !== 'string') return null;
  const src = text.trim();
  if (src.includes('=')) return compileKeyframes(src);
  const tokens = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    const start = TOKEN.lastIndex;
    const m = TOKEN.exec(src);
    if (!m || m.index !== start) return null; // other characters: not an expression
    tokens.push(m[1] ? { num: m[1] } : m[2] ? { id: m[2] } : { op: m[3] });
  }
  const extra = new Set(names);
  const ids = tokens.filter((t) => t.id).map((t) => t.id);
  const used = ids.filter((id) => id in signals);
  const vars = [...new Set(ids.filter((id) => extra.has(id) && !(id in signals)))];
  const moving = used.length || vars.length || ids.some((id) => id in shapes);
  if (!moving && !constant) {
    // "eye" or "triple-moon" is a word; "1+bas*2" is a typo worth pointing out.
    if (tokens.some((t) => t.num || (t.op && t.op !== '-'))) throw new Error(`"${src}" doesn't use any of: ${[...Object.keys(signals), ...lfos].join(', ')}`);
    return null;
  }
  const unknown = ids.filter((id) => !(id in signals) && !(id in helpers) && !(id in shapes) && !extra.has(id));
  if (unknown.length) {
    const more = names.length ? `. Also: ${names.join(', ')}` : '';
    throw new Error(`unknown name "${unknown[0]}" in "${src}". Signals: ${Object.keys(signals).join(', ')}. LFOs: ${lfos.join(', ')}${more}`);
  }

  const js = tokens.map((t) => t.num ?? (t.id ? `$.${t.id}` : t.op === '^' ? '**' : t.op)).join(' ');
  // The LFOs read the bar position of whichever frame is being evaluated.
  const scope = { ...helpers, bars: 0 };
  for (const [name, shape] of Object.entries(shapes)) {
    scope[name] = (period = 1, phase = 0) => (period > 0 ? shape(scope.bars / period + phase) : 0);
  }
  let fn;
  try {
    fn = new Function('$', `return (${js});`);
    fn({ ...scope, ...Object.fromEntries([...Object.keys(signals), ...vars].map((k) => [k, 0])) });
  } catch {
    throw new Error(`can't read "${src}" as an expression (try e.g. 1+bass*2 or 1+2*sine(4))`);
  }
  const sigs = [...new Set(used)];
  return {
    uses: [...sigs, ...vars],
    fn: (frame, values) => {
      scope.bars = frame.bars ?? frame.time / 2;
      for (const k of sigs) scope[k] = signals[k](frame);
      for (const k of vars) scope[k] = values?.[k] ?? 0;
      const v = fn(scope);
      return Number.isFinite(v) ? v : 0;
    },
  };
}

// Names an expression can't take for its own variables.
export const reserved = new Set([...Object.keys(signals), ...Object.keys(helpers), ...Object.keys(shapes)]);

// Automation: "0:50=0.5 0:55.8=3 1:10=1". Times are track times like --scene
// (a leading + means seconds into the clip). The value ramps in a straight
// line between points and holds before the first and after the last.
const KEY = /^(\+?)(\d+(?::\d+)*(?:\.\d+)?)=(-?\d*\.?\d+)$/;

function compileKeyframes(src) {
  const parts = src.split(/\s+/);
  const keys = parts.map((p) => {
    const m = p.match(KEY);
    if (!m) throw new Error(`can't read "${p}" in "${src}": automation is time=value pairs separated by spaces, e.g. "0:50=0.5 0:55.8=3 1:10=1"`);
    return { relative: m[1] === '+', t: m[2].split(':').map(Number).reduce((a, n) => a * 60 + n, 0), v: Number(m[3]) };
  });
  let points = null; // track times, worked out on the first frame (needs the clip start)
  return {
    uses: ['automation'],
    fn: (frame) => {
      const now = frame.trackTime ?? frame.time;
      if (!points) {
        const clipStart = now - frame.time;
        points = keys.map((k) => ({ t: k.relative ? clipStart + k.t : k.t, v: k.v })).sort((a, b) => a.t - b.t);
      }
      if (now <= points[0].t) return points[0].v;
      const i = points.findIndex((p) => p.t > now);
      if (i < 0) return points.at(-1).v;
      const a = points[i - 1], b = points[i];
      return a.v + ((b.v - a.v) * (now - a.t)) / (b.t - a.t || 1);
    },
  };
}

// Splits params into fixed values and per-frame expressions.
export function compileParams(params) {
  const mods = [];
  for (const [key, value] of Object.entries(params)) {
    const expr = compile(value);
    if (expr) mods.push([key, expr.fn]);
  }
  return mods;
}
