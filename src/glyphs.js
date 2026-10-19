// Vector glyphs drawn from paths (no fonts needed). Coordinates are in a unit
// box roughly -1..1, y pointing down.
//   lines:   polylines as flat [x0, y0, x1, y1, …] arrays
//   circles: [cx, cy, r]
//   arcs:    [cx, cy, r, startAngle, endAngle] (clockwise)
const PI = Math.PI;

// Elder Futhark, in order.
export const runes = [
  { lines: [[-0.3, -1, -0.3, 1], [-0.3, -0.3, 0.4, -0.9], [-0.3, 0.2, 0.4, -0.4]] },                  // fehu
  { lines: [[-0.4, 1, -0.4, -1, 0.4, -0.5, 0.4, 1]] },                                                  // uruz
  { lines: [[-0.3, -1, -0.3, 1], [-0.3, -0.5, 0.4, 0, -0.3, 0.5]] },                                    // thurisaz
  { lines: [[-0.3, -1, -0.3, 1], [-0.3, -1, 0.4, -0.5], [-0.3, -0.4, 0.4, 0.1]] },                      // ansuz
  { lines: [[-0.4, 1, -0.4, -1, 0.4, -0.5, -0.4, 0, 0.4, 1]] },                                         // raidho
  { lines: [[0.4, -0.8, -0.3, 0, 0.4, 0.8]] },                                                          // kenaz
  { lines: [[-0.6, -1, 0.6, 1], [0.6, -1, -0.6, 1]] },                                                  // gebo
  { lines: [[-0.3, 1, -0.3, -1, 0.4, -0.5, -0.3, 0]] },                                                 // wunjo
  { lines: [[-0.4, -1, -0.4, 1], [0.4, -1, 0.4, 1], [-0.4, -0.3, 0.4, 0.3]] },                          // hagalaz
  { lines: [[0, -1, 0, 1], [-0.5, -0.3, 0.5, 0.3]] },                                                   // nauthiz
  { lines: [[0, -1, 0, 1]] },                                                                           // isa
  { lines: [[-0.1, -0.7, -0.5, -0.2, -0.1, 0.3], [0.1, -0.3, 0.5, 0.2, 0.1, 0.7]] },                    // jera
  { lines: [[0, -1, 0, 1], [0, -1, 0.4, -0.6], [0, 1, -0.4, 0.6]] },                                    // eihwaz
  { lines: [[-0.4, -1, -0.4, 1], [-0.4, -1, 0.1, -0.5, 0.5, -1], [-0.4, 1, 0.1, 0.5, 0.5, 1]] },        // perthro
  { lines: [[0, 1, 0, -1], [-0.5, -0.6, 0, -0.1, 0.5, -0.6]] },                                         // algiz
  { lines: [[0.3, -1, -0.4, -0.2, 0.4, 0.2, -0.3, 1]] },                                                // sowilo
  { lines: [[0, -1, 0, 1], [-0.5, -0.5, 0, -1, 0.5, -0.5]] },                                           // tiwaz
  { lines: [[-0.4, -1, -0.4, 1], [-0.4, -1, 0.4, -0.5, -0.4, 0, 0.4, 0.5, -0.4, 1]] },                  // berkano
  { lines: [[-0.4, 1, -0.4, -1, 0, -0.4, 0.4, -1, 0.4, 1]] },                                           // ehwaz
  { lines: [[-0.4, 1, -0.4, -1, 0.4, -0.2], [0.4, 1, 0.4, -1, -0.4, -0.2]] },                           // mannaz
  { lines: [[-0.3, 1, -0.3, -1, 0.4, -0.4]] },                                                          // laguz
  { lines: [[0, -0.6, 0.5, 0, 0, 0.6, -0.5, 0, 0, -0.6]] },                                             // ingwaz
  { lines: [[-0.5, -1, -0.5, 1, 0.5, -1, 0.5, 1, -0.5, -1]] },                                          // dagaz
  { lines: [[-0.5, 1, 0.45, 0, 0, -0.5, -0.45, 0, 0.5, 1]] },                                           // othala
];

const crescent = (cx, flip = 1) => ({
  arcs: flip > 0
    ? [[cx, 0, 0.8, PI / 2, PI * 1.5], [cx + 0.45, 0, 0.918, 2.08, 4.2]]
    : [[cx, 0, 0.8, -PI / 2, PI / 2], [cx - 0.45, 0, 0.918, -1.06, 1.06]],
});

const eye = {
  lines: [[0, -0.95, 0.95, 0.7, -0.95, 0.7, 0, -0.95]],
  arcs: [[0, 0.5, 0.57, -2.48, -0.66], [0, -0.2, 0.57, 0.66, 2.48]],
  circles: [[0, 0.15, 0.12]],
};

const leviathan = {
  lines: [[0, -1, 0, 0.53], [-0.4, -0.6, 0.4, -0.6], [-0.3, -0.2, 0.3, -0.2]],
  circles: [[-0.22, 0.75, 0.22], [0.22, 0.75, 0.22]],
};

// Alchemical / occult symbols that float in the background.
export const sigils = [
  { lines: [[0, -0.9, 0.8, 0.6, -0.8, 0.6, 0, -0.9]] },                                                // fire
  { lines: [[0, 0.9, 0.8, -0.6, -0.8, -0.6, 0, 0.9]] },                                                // water
  { lines: [[0, -0.9, 0.8, 0.6, -0.8, 0.6, 0, -0.9], [-0.55, 0.1, 0.55, 0.1]] },                       // air
  { lines: [[0, 0.9, 0.8, -0.6, -0.8, -0.6, 0, 0.9], [-0.55, -0.1, 0.55, -0.1]] },                     // earth
  { lines: [[0, -1, 0.6, 0, -0.6, 0, 0, -1], [0, 0, 0, 1], [-0.4, 0.5, 0.4, 0.5]] },                   // sulfur
  { lines: [[-0.7, 0, 0.7, 0]], circles: [[0, 0, 0.7]] },                                              // salt
  { circles: [[0, -0.1, 0.4]], arcs: [[0, -0.85, 0.35, 0, PI]], lines: [[0, 0.3, 0, 1], [-0.3, 0.65, 0.3, 0.65]] }, // mercury
  { circles: [[0, 0, 0.8], [0, 0, 0.12]] },                                                            // sun
  crescent(0),                                                                                          // moon
  { circles: [[0, -0.55, 0.32]], lines: [[0, -0.23, 0, 1], [-0.5, -0.05, 0.5, -0.05]] },              // ankh
  { lines: [[0, -1, 0, 1], [-0.45, 0.45, 0.45, 0.45]] },                                              // inverted cross
  eye,
  leviathan,
];

// Returns a copy of a glyph scaled around its origin.
export function scaleGlyph(g, k) {
  return {
    lines: (g.lines ?? []).map((l) => l.map((v) => v * k)),
    circles: (g.circles ?? []).map(([x, y, r]) => [x * k, y * k, r * k]),
    arcs: (g.arcs ?? []).map(([x, y, r, a0, a1]) => [x * k, y * k, r * k, a0, a1]),
  };
}

// Star polygon {n/k}, e.g. (5, 2) = pentagram. Handles compound stars like {6/2}.
export function star(n, k, { r = 0.95, rotation = -PI / 2, circle = true } = {}) {
  const pt = (i) => [Math.cos(rotation + (2 * PI * i) / n) * r, Math.sin(rotation + (2 * PI * i) / n) * r];
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const loops = gcd(n, k);
  const lines = [];
  for (let s = 0; s < loops; s++) {
    const line = [];
    for (let i = 0; i <= n / loops; i++) line.push(...pt(s + i * k));
    lines.push(line);
  }
  return { lines, circles: circle ? [[0, 0, 1]] : [] };
}

export const centerpieces = {
  pentagram: star(5, 2),
  inverted: star(5, 2, { rotation: PI / 2 }),
  hexagram: star(6, 2),
  heptagram: star(7, 3),
  octagram: star(8, 3),
  eye: (() => { const g = scaleGlyph(eye, 0.82); g.circles.push([0, 0, 1]); return g; })(),
  leviathan: { ...leviathan, circles: [...leviathan.circles] },
  triplemoon: {
    circles: [[0, 0, 0.38]],
    arcs: [
      [-0.62, 0, 0.42, PI / 2, PI * 1.5], [-0.62 + 0.24, 0, 0.48, 2.08, 4.2],
      [0.62, 0, 0.42, -PI / 2, PI / 2], [0.62 - 0.24, 0, 0.48, -1.06, 1.06],
    ],
  },
};

// Appends a glyph to a Path2D at (x, y), scaled by size and rotated.
export function addGlyph(path, glyph, x, y, size, rotation = 0) {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  const tx = (px, py) => x + (px * c - py * s) * size;
  const ty = (px, py) => y + (px * s + py * c) * size;
  for (const l of glyph.lines ?? []) {
    path.moveTo(tx(l[0], l[1]), ty(l[0], l[1]));
    for (let i = 2; i < l.length; i += 2) path.lineTo(tx(l[i], l[i + 1]), ty(l[i], l[i + 1]));
  }
  for (const [cx, cy, r] of glyph.circles ?? []) {
    const X = tx(cx, cy), Y = ty(cx, cy);
    path.moveTo(X + r * size, Y);
    path.arc(X, Y, r * size, 0, PI * 2);
  }
  for (const [cx, cy, r, a0, a1] of glyph.arcs ?? []) {
    const X = tx(cx, cy), Y = ty(cx, cy);
    path.moveTo(X + Math.cos(a0 + rotation) * r * size, Y + Math.sin(a0 + rotation) * r * size);
    path.arc(X, Y, r * size, a0 + rotation, a1 + rotation);
  }
  return path;
}
