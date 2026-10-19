// Finds the sections of a track (intro, drops, breakdowns…) so styles can
// switch on their own. Steps:
//   1. tempo + beat grid from the onset envelope
//   2. one feature vector per beat (loudness, bands, spectrum shape, hits)
//   3. novelty curve: where the beats before and after a point stop sounding
//      alike (Foote's checkerboard kernel on the self-similarity matrix)
//   4. strongest novelty peaks become boundaries, snapped to bar lines
//   5. sections are rated by energy and split into calm / intense
import { analyze } from './audio.js';

const FPS = 40;           // analysis resolution (25ms)
const KERNEL = 16;        // beats each side of the novelty kernel (4 bars)
const BLOCKS = '▁▂▃▄▅▆▇█';

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

function smooth(arr, sigma) {
  const r = Math.ceil(sigma * 3);
  const w = Array.from({ length: r * 2 + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  return arr.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) if (arr[i + k] !== undefined) { s += arr[i + k] * w[k + r]; n += w[k + r]; }
    return s / n;
  });
}

// Beat period (in frames) and phase. Returns null when there's no steady pulse.
function findBeats(env, fps) {
  const n = env.length;
  const e = smooth(env, 1);
  const m = mean(e);
  const x = e.map((v) => v - m);
  const minLag = Math.floor((fps * 60) / 180), maxLag = Math.ceil((fps * 60) / 70);
  const ac = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    ac[lag] = s / (n - lag);
  }
  const zero = x.reduce((s, v) => s + v * v, 0) / n;
  // Lean towards ~120 BPM so we don't lock onto half or double time.
  let best = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (fps * 60) / lag;
    const score = ac[lag] * Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  if (ac[best] / (zero || 1) < 0.08) return null;

  // Fine search: the period and phase whose beat grid lands on the most hits.
  let period = best, phase = 0, top = -Infinity;
  for (let p = best * 0.97; p <= best * 1.03; p += 0.005) {
    for (let ph = 0; ph < p; ph += 0.5) {
      let s = 0;
      for (let t = ph; t < n; t += p) s += e[Math.round(t)] ?? 0;
      if (s > top) { top = s; period = p; phase = ph; }
    }
  }
  return { period, phase };
}

// Foote novelty on z-scored beat features.
function novelty(feats) {
  const n = feats.length, d = feats[0].length;
  const dist = Array.from({ length: n }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let s = 0;
      for (let k = 0; k < d; k++) s += (feats[i][k] - feats[j][k]) ** 2;
      dist[i][j] = dist[j][i] = Math.sqrt(s);
    }
  }
  const g = (a) => Math.exp(-0.5 * (a / (KERNEL / 2)) ** 2);
  const nov = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const L = Math.min(KERNEL, i, n - i);
    if (L < 4) continue;
    let cross = 0, within = 0, wc = 0, ww = 0;
    for (let a = -L; a < L; a++) {
      for (let b = -L; b < L; b++) {
        const w = g(a + 0.5) * g(b + 0.5);
        if ((a < 0) !== (b < 0)) { cross += w * dist[i + a][i + b]; wc += w; }
        else { within += w * dist[i + a][i + b]; ww += w; }
      }
    }
    nov[i] = Math.max(0, cross / wc - within / ww);
  }
  const top = Math.max(...nov) || 1;
  return nov.map((v) => v / top);
}

// Splits section energies into calm / intense (1D 2-means, length-weighted).
function splitEnergy(sections) {
  const sorted = [...sections].sort((a, b) => a.energy - b.energy);
  let best = null;
  for (let k = 1; k < sorted.length; k++) {
    const lo = sorted.slice(0, k), hi = sorted.slice(k);
    const wm = (g) => g.reduce((s, x) => s + x.energy * x.length, 0) / g.reduce((s, x) => s + x.length, 0);
    const mLo = wm(lo), mHi = wm(hi);
    const cost = lo.reduce((s, x) => s + x.length * (x.energy - mLo) ** 2, 0) + hi.reduce((s, x) => s + x.length * (x.energy - mHi) ** 2, 0);
    if (!best || cost < best.cost) best = { cost, threshold: (sorted[k - 1].energy + sorted[k].energy) / 2, gap: mHi - mLo };
  }
  return best && best.gap > 0.12 ? best.threshold : Infinity;
}

export async function analyzeStructure(file, { minBars = 4 } = {}) {
  const { frames, duration } = await analyze(file, { fps: FPS });
  const n = frames.length;
  const grid = findBeats(frames.map((f) => f.onsetStrength + f.kickStrength), FPS);

  // Beat times in frames. Without a pulse, fall back to half-second steps.
  const period = grid?.period ?? FPS / 2;
  const beats = [];
  for (let t = grid?.phase ?? 0; t < n; t += period) beats.push(t);
  const beatsPerBar = grid ? 4 : 2;

  const feats = [], energy = [];
  for (let i = 0; i < beats.length; i++) {
    const a = Math.round(beats[i]), b = Math.min(n, Math.round(beats[i + 1] ?? n));
    const span = frames.slice(a, Math.max(a + 1, b));
    const avg = (key) => mean(span.map((f) => f[key]));
    const spec = Array.from({ length: 12 }, (_, k) => mean(span.map((f) => mean(f.spectrum.subarray(k * 10, k * 10 + 10)))));
    const kicks = Math.min(1, span.reduce((s, f) => s + f.kickStrength, 0));
    const hits = Math.min(1, span.reduce((s, f) => s + (f.onset ? 1 : 0), 0) / 3);
    const v = { rms: avg('rms'), bass: avg('bass'), mid: avg('mid'), high: avg('high'), kicks, hits };
    energy.push(0.55 * v.rms + 0.45 * v.bass);
    feats.push([v.rms * 1.5, v.bass * 1.5, kicks * 1.5, v.mid, v.high, hits, ...spec]);
  }
  // z-score every feature so none dominates by scale.
  const zfeats = feats.map((f) => [...f]);
  for (let k = 0; k < feats[0].length; k++) {
    const col = feats.map((f) => f[k]);
    const m = mean(col), sd = Math.sqrt(mean(col.map((v) => (v - m) ** 2))) || 1;
    zfeats.forEach((f) => (f[k] = (f[k] - m) / sd));
  }
  // Bar-smoothed energy also feeds the novelty, so level changes count even
  // when the sound itself stays similar.
  const barEnergy = smooth(energy, beatsPerBar);
  zfeats.forEach((f, i) => f.push(barEnergy[i] * 6));
  const nov = novelty(zfeats);

  // Peaks, strongest first, at least `minBars` apart.
  const minGap = minBars * beatsPerBar - 1; // peaks can land a beat early
  const peaks = [];
  for (let i = 1; i < nov.length - 1; i++) {
    let isPeak = nov[i] >= 0.2;
    for (let k = -4; k <= 4 && isPeak; k++) if (nov[i + k] > nov[i]) isPeak = false;
    if (isPeak) peaks.push(i);
  }
  peaks.sort((a, b) => nov[b] - nov[a]);
  let cuts = [];
  for (const p of peaks) if (cuts.every((c) => Math.abs(c - p) >= minGap) && p >= minGap / 2 && beats.length - p >= minGap / 2) cuts.push(p);

  // Snap to bar lines. The bar phase is whichever one most cuts agree on.
  let barPhase = 0;
  if (grid && cuts.length) {
    const votes = [0, 0, 0, 0];
    for (const c of cuts) for (let o = -1; o <= 1; o++) votes[(c + o + 400) % 4] += nov[c] * (o === 0 ? 1 : 0.4);
    barPhase = votes.indexOf(Math.max(...votes));
  }
  cuts = [...new Set(cuts.map((c) => Math.round((c - barPhase) / beatsPerBar) * beatsPerBar + barPhase))].sort((a, b) => a - b);

  const bounds = [0, ...cuts, beats.length];
  const sections = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i], b = bounds[i + 1];
    const start = i === 0 ? 0 : beats[a] / FPS;
    const end = b >= beats.length ? duration : beats[b] / FPS;
    const e = energy.slice(a, b);
    const half = Math.floor(e.length / 2);
    sections.push({
      start, end, length: end - start,
      energy: mean(e),
      rise: mean(e.slice(half)) - mean(e.slice(0, half)),
      strength: i === 0 ? 1 : nov[a],
    });
  }

  // Normalise energy across the track, then label.
  const lo = Math.min(...sections.map((s) => s.energy)), hi = Math.max(...sections.map((s) => s.energy));
  sections.forEach((s) => (s.energy = hi > lo ? (s.energy - lo) / (hi - lo) : 0.5));
  // Drops are the loudest group; "groove" is in between (e.g. an intro once
  // the kick comes in).
  const threshold = splitEnergy(sections);
  const dropAt = Math.max(threshold, 0.8);
  sections.forEach((s) => (s.level = s.energy >= dropAt ? 'drop' : s.energy >= threshold ? 'groove' : 'calm'));
  const firstDrop = sections.findIndex((s) => s.level === 'drop');
  const lastDrop = sections.findLastIndex((s) => s.level === 'drop');
  sections.forEach((s, i) => {
    s.label = s.level === 'drop' ? 'drop'
      : firstDrop < 0 || i < firstDrop ? 'intro'
      : i > lastDrop ? 'outro'
      : s.level === 'groove' ? 'groove'
      : 'breakdown';
  });
  // Builds: walk back from each drop while the energy keeps climbing.
  for (let i = sections.length - 1; i > 0; i--) {
    if (sections[i].level !== 'drop') continue;
    for (let j = i - 1; j > 0 && sections[j].level !== 'drop'; j--) {
      const s = sections[j], prev = sections[j - 1];
      if (s.rise > 0.08 || (s.energy - prev.energy > 0.1 && prev.level !== 'drop')) s.label = 'build';
      else break;
    }
  }

  // Merge neighbours that ended up the same.
  const merged = [];
  for (const s of sections) {
    const last = merged.at(-1);
    if (last && last.label === s.label && last.level === s.level) {
      last.energy = (last.energy * last.length + s.energy * s.length) / (last.length + s.length);
      last.end = s.end;
      last.length = last.end - last.start;
    } else merged.push({ ...s });
  }

  return { duration, bpm: grid ? (FPS * 60) / grid.period : null, sections: merged };
}

export const energyBar = (v, width = 8) => {
  const full = Math.round(v * width);
  return BLOCKS.at(-1).repeat(full) + '·'.repeat(width - full);
};
