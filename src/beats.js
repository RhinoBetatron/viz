// Tempo and beat grid. Shared by the section finder (--analyze / --auto) and
// the renderer, which tags every frame with where it sits in the beat and bar.
//
// A grid is { bpm, period, offset } in seconds: beats fall at
// offset + k * period, and the ones where k is a multiple of 4 are downbeats.
// `offset` is in track time, so a grid found on the whole track lines up with
// any clip cut from it.

import { analyze } from './audio.js';

export const BEATS_PER_BAR = 4;

export const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

export function smooth(arr, sigma) {
  const r = Math.ceil(sigma * 3);
  const w = Array.from({ length: r * 2 + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  return arr.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) if (arr[i + k] !== undefined) { s += arr[i + k] * w[k + r]; n += w[k + r]; }
    return s / n;
  });
}

// Beat period (in frames) and phase. Returns null when there's no steady pulse.
//
// Each candidate tempo is scored by how well the onsets repeat after 1, 2, 4
// and 8 beats (a beat, half a bar, a bar, two bars), not just after one beat.
// Breakbeats repeat strongly every 1.5 beats, which on its own reads as 2/3 of
// the real tempo (drum & bass at 172 comes out as 115); the bar-level repeats
// sort that out. Half-time and full-time score alike, so the faster one wins
// when it's nearly as good (174 rather than 87).
export function findBeats(env, fps) {
  const n = env.length;
  const e = smooth(env, 1);
  const m = mean(e);
  const x = e.map((v) => v - m);
  const zero = x.reduce((s, v) => s + v * v, 0) / n || 1;
  const minLag = (fps * 60) / 180, maxLag = (fps * 60) / 70;
  if (n < maxLag * 4) return null; // too short to tell

  const ac = (lag) => {
    const a = Math.floor(lag), fr = lag - a;
    let s = 0, c = 0;
    for (let i = 0; i + a + 1 < n; i++, c++) s += x[i] * (x[i + a] * (1 - fr) + x[i + a + 1] * fr);
    return s / (c || 1) / zero;
  };
  const score = (lag) => {
    const ks = [1, 2, 4, 8].filter((k) => k * lag < n / 2);
    return ks.reduce((s, k) => s + ac(k * lag), 0) / ks.length;
  };
  let best = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 0.05) {
    const s = score(lag);
    if (s > bestScore) { bestScore = s; best = lag; }
  }
  if (ac(best) < 0.08 && bestScore < 0.1) return null;
  if (best / 2 >= minLag - 0.5) {
    let half = best / 2, halfScore = -Infinity;
    for (let d = -0.1; d <= 0.1; d += 0.05) {
      const s = score(best / 2 + d);
      if (s > halfScore) { halfScore = s; half = best / 2 + d; }
    }
    if (halfScore >= 0.75 * bestScore) best = half;
  }

  // Fine search: the period and phase whose beat grid lands on the most hits.
  let period = best, phase = 0, top = -Infinity;
  for (let p = best * 0.99; p <= best * 1.01; p += 0.002) {
    for (let ph = 0; ph < p; ph += 0.25) {
      let s = 0;
      for (let t = ph; t < n; t += p) s += e[Math.round(t)] ?? 0;
      if (s > top) { top = s; period = p; phase = ph; }
    }
  }
  return { period, phase };
}

// Which of the four beats in a bar is the downbeat. A best guess: the beat
// where new things tend to come in (crashes, louder hits, energy jumps).
export function downbeatOffset(beats, frames) {
  const score = [0, 0, 0, 0];
  for (let i = 0; i < beats.length; i++) {
    const f = Math.round(beats[i]);
    let s = 0;
    for (let k = f - 1; k <= f + 1; k++) {
      const fr = frames[k];
      if (fr) s += 0.5 * fr.onsetStrength + fr.kickStrength;
    }
    const before = frames[f - 4]?.rms, after = frames[f + 4]?.rms;
    if (before !== undefined && after !== undefined) s += 2 * Math.max(0, after - before);
    score[i % 4] += s;
  }
  return score.indexOf(Math.max(...score));
}

// Grid from analysed frames (`analyze()` output). `start` is the track time of
// frame 0, so the grid's offset comes out in track time.
export function gridFromFrames(frames, fps, start = 0) {
  const found = findBeats(frames.map((f) => f.onsetStrength + f.kickStrength), fps);
  if (!found) return null;
  const beats = [];
  for (let t = found.phase; t < frames.length; t += found.period) beats.push(t);
  const k = downbeatOffset(beats, frames);
  return {
    bpm: (fps * 60) / found.period,
    period: found.period / fps,
    offset: start + (beats[k] ?? found.phase) / fps,
  };
}

// Grid for a whole track (or a drum stem of it).
export async function trackGrid(file) {
  const fps = 40;
  const { frames } = await analyze(file, { fps, bins: 32 });
  return gridFromFrames(frames, fps, 0);
}

const mod = (a, n) => ((a % n) + n) % n;

// Adds beat / bar fields to every frame. `start` is the track time of frame 0.
//   beat, downbeat       true on the frame nearest a beat / the first beat of a bar
//   beatPhase, barPhase  0 → 1 through the current beat / bar
//   beatIndex, bar       beat and bar number in the track
//   bars                 position in bars since the grid's first downbeat,
//                        counting up smoothly (what LFOs run on)
//   trackTime            seconds into the track
export function tagFrames(frames, grid, fps, start = 0) {
  const h = 0.5 / fps;
  for (const f of frames) {
    const t = start + f.time;
    f.trackTime = t;
    if (!grid) {
      // No steady beat: bars tick at 120 BPM so LFOs still move.
      Object.assign(f, { beat: false, downbeat: false, beatPhase: 0, barPhase: 0, beatIndex: 0, bar: 0, bars: t / 2 });
      continue;
    }
    const b = (t - grid.offset) / grid.period;
    const lo = Math.floor((t - h - grid.offset) / grid.period);
    const hi = Math.floor((t + h - grid.offset) / grid.period);
    f.beat = hi !== lo;
    f.downbeat = f.beat && mod(hi, BEATS_PER_BAR) === 0;
    f.beatIndex = Math.floor(b);
    f.beatPhase = b - Math.floor(b);
    f.bar = Math.floor(b / BEATS_PER_BAR);
    f.barPhase = mod(b, BEATS_PER_BAR) / BEATS_PER_BAR;
    f.bars = b / BEATS_PER_BAR;
  }
  return frames;
}

// Nearest beat or bar line to track time t.
export function snapTime(t, grid, unit = 'bar') {
  const step = grid.period * (unit === 'bar' ? BEATS_PER_BAR : 1);
  return grid.offset + Math.round((t - grid.offset) / step) * step;
}
