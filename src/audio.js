// Decodes audio with ffmpeg and pre-computes everything the styles react to,
// one entry per video frame.
import { spawn } from 'node:child_process';
import FFT from 'fft.js';

const FFT_SIZE = 4096;
const WAVE_SIZE = 2048;
const F_MIN = 30;
const F_MAX = 16000;
const DB_RANGE = 50;
const TILT_DB_PER_OCT = 3; // lifts highs so the spectrum doesn't slope off to nothing

export function decode(file, { start = 0, duration, sampleRate = 44100 } = {}) {
  const args = ['-v', 'error', '-ss', String(start), '-i', file];
  if (duration) args.push('-t', String(duration));
  args.push('-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1');

  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args);
    const chunks = [];
    let err = '';
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.stderr.on('data', (c) => (err += c));
    ff.on('error', (e) => reject(new Error(`Could not run ffmpeg (${e.message}). Install it with: brew install ffmpeg`)));
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg failed to decode ${file}:\n${err.trim()}`));
      const buf = Buffer.concat(chunks);
      resolve(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));
    });
  });
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function percentile(values, p) {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

// Fast rise, slow fall — what makes bars feel "musical" instead of jittery.
function smoother(attack, decay) {
  let v = 0;
  return (x) => (v += (x - v) * (x > v ? attack : decay));
}

// Peak-picks an onset envelope against a moving-average threshold.
function pickOnsets(flux, fps, minGapSec) {
  const n = flux.length;
  const p95 = percentile(flux, 0.95) || 1;
  const minGap = Math.max(1, Math.round(minGapSec * fps));
  const before = Math.round(0.35 * fps);
  const after = Math.round(0.1 * fps);
  const onsets = new Float32Array(n);
  let last = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - before); j <= Math.min(n - 1, i + after); j++) { sum += flux[j]; count++; }
    const threshold = (sum / count) * 1.35 + p95 * 0.08;
    if (flux[i] > threshold && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] && i - last >= minGap) {
      onsets[i] = clamp01(flux[i] / p95);
      last = i;
    }
  }
  return onsets;
}

export async function analyze(file, { start = 0, duration, fps = 30, bins = 128, sampleRate = 44100 } = {}) {
  const samples = await decode(file, { start, duration, sampleRate });
  const frameCount = Math.floor((samples.length / sampleRate) * fps);
  if (frameCount < 1) throw new Error(`No audio found in ${file} at --start ${start}s (is the track shorter than that?)`);

  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak > 0) for (let i = 0; i < samples.length; i++) samples[i] /= peak;

  const fft = new FFT(FFT_SIZE);
  const input = new Float64Array(FFT_SIZE);
  const out = fft.createComplexArray();
  const hann = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  const res = sampleRate / FFT_SIZE;
  const half = FFT_SIZE / 2;

  // Log-spaced bin edges, mapped to FFT bin index ranges.
  const binFreqs = new Float32Array(bins);
  const ranges = [];
  for (let k = 0; k < bins; k++) {
    const lo = F_MIN * (F_MAX / F_MIN) ** (k / bins);
    const hi = F_MIN * (F_MAX / F_MIN) ** ((k + 1) / bins);
    binFreqs[k] = Math.sqrt(lo * hi);
    const a = Math.min(half - 1, Math.floor(lo / res));
    ranges.push([a, Math.max(a + 1, Math.min(half, Math.ceil(hi / res)))]);
  }
  const bandRanges = { bass: [20, 150], mid: [150, 2000], high: [2000, 12000] };
  const bandIdx = Object.fromEntries(
    Object.entries(bandRanges).map(([k, [lo, hi]]) => [k, [Math.floor(lo / res), Math.ceil(hi / res)]]),
  );
  const bassBins = binFreqs.findIndex((f) => f > 150);

  const rawSpec = Array.from({ length: frameCount }, () => new Float32Array(bins));
  const bandDb = { bass: new Float32Array(frameCount), mid: new Float32Array(frameCount), high: new Float32Array(frameCount) };
  const rmsDb = new Float32Array(frameCount);
  const hop = sampleRate / fps;
  const mags = new Float64Array(half);

  for (let f = 0; f < frameCount; f++) {
    const center = Math.round((f + 0.5) * hop);
    const from = center - FFT_SIZE / 2;
    for (let i = 0; i < FFT_SIZE; i++) input[i] = (samples[from + i] ?? 0) * hann[i];
    fft.realTransform(out, input);
    for (let i = 0; i < half; i++) mags[i] = Math.hypot(out[2 * i], out[2 * i + 1]);

    for (let k = 0; k < bins; k++) {
      let m = 0;
      for (let i = ranges[k][0]; i < ranges[k][1]; i++) if (mags[i] > m) m = mags[i];
      rawSpec[f][k] = 20 * Math.log10(m + 1e-9) + TILT_DB_PER_OCT * Math.log2(binFreqs[k] / F_MIN);
    }
    for (const band in bandIdx) {
      const [a, b] = bandIdx[band];
      let p = 0;
      for (let i = a; i < b; i++) p += mags[i] * mags[i];
      bandDb[band][f] = 10 * Math.log10(p / (b - a) + 1e-12);
    }
    let sq = 0;
    const h = Math.round(hop);
    for (let i = center - h; i < center + h; i++) sq += (samples[i] ?? 0) ** 2;
    rmsDb[f] = 10 * Math.log10(sq / (2 * h) + 1e-12);
  }

  // Normalise spectrum globally so loud and quiet masters look the same.
  const all = new Float32Array(frameCount * bins);
  rawSpec.forEach((s, f) => all.set(s, f * bins));
  const ceil = percentile(all, 0.995);
  const floor = ceil - DB_RANGE;
  for (const s of rawSpec) for (let k = 0; k < bins; k++) s[k] = clamp01((s[k] - floor) / DB_RANGE) ** 1.5;

  const normalise = (arr, lo = 0.1, hi = 0.98) => {
    const a = percentile(arr, lo), b = percentile(arr, hi);
    return arr.map((v) => clamp01((v - a) / (b - a || 1)));
  };
  const bands = { bass: normalise(bandDb.bass), mid: normalise(bandDb.mid), high: normalise(bandDb.high) };
  const rms = normalise(rmsDb, 0.05, 0.99);

  // Spectral flux (positive change between frames) drives onset detection.
  const flux = new Float32Array(frameCount);
  const bassFlux = new Float32Array(frameCount);
  for (let f = 1; f < frameCount; f++) {
    for (let k = 0; k < bins; k++) {
      const d = Math.max(0, rawSpec[f][k] - rawSpec[f - 1][k]);
      flux[f] += d;
      if (k < bassBins) bassFlux[f] += d;
    }
  }
  const onsets = pickOnsets(flux, fps, 0.08);
  const kicks = pickOnsets(bassFlux, fps, 0.15);
  const pulseSource = kicks.some((v) => v > 0) ? kicks : onsets;

  // Smoothing constants are tuned at 30fps and rescaled for other frame rates.
  const rate = (c) => 1 - (1 - c) ** (30 / fps);
  const specSmooth = Array.from({ length: bins }, () => smoother(rate(0.65), rate(0.18)));
  const bandSmooth = { bass: smoother(rate(0.7), rate(0.2)), mid: smoother(rate(0.6), rate(0.15)), high: smoother(rate(0.7), rate(0.25)) };
  const rmsSmooth = smoother(rate(0.5), rate(0.12));
  const pulseDecay = 0.86 ** (30 / fps);
  let pulse = 0;

  const frames = new Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    const spectrum = new Float32Array(bins);
    for (let k = 0; k < bins; k++) spectrum[k] = specSmooth[k](rawSpec[f][k]);
    pulse = Math.max(pulse * pulseDecay, pulseSource[f]);
    const center = Math.round((f + 0.5) * hop);
    const w0 = Math.max(0, Math.min(samples.length - WAVE_SIZE, center - WAVE_SIZE / 2));
    frames[f] = {
      index: f,
      time: f / fps,
      progress: frameCount > 1 ? f / (frameCount - 1) : 0,
      spectrum,
      waveform: samples.subarray(w0, w0 + WAVE_SIZE),
      bass: bandSmooth.bass(bands.bass[f]),
      mid: bandSmooth.mid(bands.mid[f]),
      high: bandSmooth.high(bands.high[f]),
      rms: rmsSmooth(rms[f]),
      onset: onsets[f] > 0,
      onsetStrength: onsets[f],
      kick: kicks[f] > 0,
      kickStrength: kicks[f],
      pulse,
    };
  }

  return {
    frames,
    fps,
    sampleRate,
    duration: samples.length / sampleRate,
    binFreqs,
    stats: { onsets: onsets.filter((v) => v > 0).length, kicks: kicks.filter((v) => v > 0).length },
  };
}
