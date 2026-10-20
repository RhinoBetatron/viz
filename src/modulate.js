// Audio-driven style settings: -P spin=bass*0.1, -P glow=1+pulse*2.
// A value that mentions a signal becomes a small expression, evaluated every
// frame before the style draws. Plain words (symbol=eye) stay as they are.

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

const TOKEN = /\s*(?:(\d*\.?\d+(?:e[+-]?\d+)?)|([a-z_]\w*)|(\*\*|[-+*/%^(),]))/giy;

// Returns { fn, uses } for an expression, or null when the value is just a word.
// Throws on something that looks like an expression but can't be one.
export function compile(text) {
  if (typeof text !== 'string') return null;
  const src = text.trim();
  const tokens = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    const start = TOKEN.lastIndex;
    const m = TOKEN.exec(src);
    if (!m || m.index !== start) return null; // other characters: not an expression
    tokens.push(m[1] ? { num: m[1] } : m[2] ? { id: m[2] } : { op: m[3] });
  }
  const ids = tokens.filter((t) => t.id).map((t) => t.id);
  const used = ids.filter((id) => id in signals);
  if (!used.length) {
    // "eye" or "triple-moon" is a word; "1+bas*2" is a typo worth pointing out.
    if (tokens.some((t) => t.num || (t.op && t.op !== '-'))) throw new Error(`"${src}" doesn't use any of: ${Object.keys(signals).join(', ')}`);
    return null;
  }
  const unknown = ids.filter((id) => !(id in signals) && !(id in helpers));
  if (unknown.length) throw new Error(`unknown name "${unknown[0]}" in "${src}". Signals: ${Object.keys(signals).join(', ')}`);

  const js = tokens.map((t) => t.num ?? (t.id ? `$.${t.id}` : t.op === '^' ? '**' : t.op)).join(' ');
  let fn;
  try {
    fn = new Function('$', `return (${js});`);
    fn({ ...helpers, ...Object.fromEntries(Object.keys(signals).map((k) => [k, 0])) });
  } catch {
    throw new Error(`can't read "${src}" as an expression (try e.g. 1+bass*2)`);
  }
  const scope = { ...helpers };
  const names = [...new Set(used)];
  return {
    uses: names,
    fn: (frame) => {
      for (const k of names) scope[k] = signals[k](frame);
      const v = fn(scope);
      return Number.isFinite(v) ? v : 0;
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
