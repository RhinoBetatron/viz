// bg: two-stop background gradient (top → bottom)
// colors: the main ramp styles draw with (low → high frequencies)
// accent: glow / highlight colour
export const palettes = {
  neon:   { bg: ['#0b0221', '#1a0638'], colors: ['#ff2a6d', '#d300c5', '#05d9e8'], accent: '#05d9e8', text: '#ffffff' },
  sunset: { bg: ['#1a0b1e', '#3d1229'], colors: ['#ffb347', '#ff6f61', '#d63a7a'], accent: '#ffb347', text: '#fff4e6' },
  ice:    { bg: ['#020b18', '#0a2540'], colors: ['#3a86ff', '#7fdbff', '#e0f7ff'], accent: '#7fdbff', text: '#ffffff' },
  acid:   { bg: ['#050505', '#0d1a05'], colors: ['#00ffa3', '#39ff14', '#ccff00'], accent: '#ccff00', text: '#f4ffe0' },
  mono:   { bg: ['#000000', '#141414'], colors: ['#777777', '#bbbbbb', '#ffffff'], accent: '#ffffff', text: '#ffffff' },
  vapor:  { bg: ['#1b0f2e', '#2b1055'], colors: ['#ff71ce', '#b967ff', '#01cdfe', '#05ffa1'], accent: '#01cdfe', text: '#ffffff' },
  ember:  { bg: ['#0d0402', '#2a0a02'], colors: ['#e5383b', '#ff7b00', '#ffd166'], accent: '#ff7b00', text: '#fff1dc' },
  gloom:  { bg: ['#050505', '#0f0f0f'], colors: ['#3c3c3c', '#8c8c8c', '#d4d4d4'], accent: '#6e6e6e', text: '#cfcfcf' },
  blood:  { bg: ['#060102', '#170306'], colors: ['#4a0a0e', '#a3121c', '#ff3b2f'], accent: '#e0141f', text: '#e8d9c5' },
  candle: { bg: ['#050403', '#140e07'], colors: ['#5e4320', '#d9a441', '#fff1c1'], accent: '#ffad42', text: '#f3e6c8' },
  hazard: { bg: ['#0a0a0a', '#17150f'], colors: ['#4a4a48', '#f5a000', '#ffe14d'], accent: '#ff9500', text: '#e6e6e6' },
  steel:  { bg: ['#07090b', '#121820'], colors: ['#46525c', '#4fc3ff', '#e6f6ff'], accent: '#4fc3ff', text: '#dfe8ee' },
  spectral: { bg: ['#020608', '#071a1f'], colors: ['#0e3a42', '#2fa39a', '#a8fff0'], accent: '#7dffe3', text: '#e2fff9' },
  verdant: { bg: ['#010a04', '#03190b'], colors: ['#06451b', '#0b8a31', '#16d24f', '#8dff4a'], accent: '#22ff66', text: '#e2ffe6' },
};

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export function rgba(hex, alpha = 1) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t));
}

// Sample a colour along a palette ramp, t in 0–1.
export function rampAt(colors, t) {
  if (colors.length === 1) return colors[0];
  const x = Math.min(0.9999, Math.max(0, t)) * (colors.length - 1);
  const i = Math.floor(x);
  return mix(colors[i], colors[i + 1], x - i);
}

function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}

function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return toHex([f(5), f(3), f(1)].map((x) => x * 255));
}

// Builds a palette from the dominant saturated hues of the cover art.
export function paletteFromImage(ctx, image) {
  const size = 48;
  ctx.drawImage(image, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, s: 0, v: 0 }));
  let darkest = [255, 255, 255];
  for (let i = 0; i < data.length; i += 4) {
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const [h, s, v] = rgbToHsv(rgb);
    const w = s * s * v;
    const b = buckets[Math.floor(h / 30) % 12];
    b.w += w; b.s += s * w; b.v += v * w;
    if (rgb.reduce((a, c) => a + c) < darkest.reduce((a, c) => a + c)) darkest = rgb;
  }
  const top = buckets
    .map((b, i) => ({ ...b, h: i * 30 + 15 }))
    .filter((b) => b.w > 0)
    .sort((a, b) => b.w - a.w)
    .slice(0, 3);
  if (!top.length) return palettes.mono;
  const colors = top.map((b) => hsvToHex(b.h, Math.max(0.55, b.s / b.w), Math.max(0.85, b.v / b.w)));
  while (colors.length < 3) colors.push(mix(colors[0], '#ffffff', 0.5));
  const base = hsvToHex(top[0].h, 0.6, 0.12);
  return { bg: [mix(toHex(darkest), base, 0.5), base], colors, accent: colors[0], text: '#ffffff' };
}
