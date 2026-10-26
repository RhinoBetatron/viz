// Whole-track results (beat grid, sections) cached on disk, so rendering the
// same track again skips analysing all of it. Keyed by the file's path, size
// and modification time, plus the analysis code itself: editing a track or
// the code that reads it starts afresh. Any trouble with the cache just means
// working it out again.
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DIR = process.env.VIZ_CACHE ?? path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'viz');
const CODE = ['audio.js', 'beats.js', 'structure.js'].map((f) => new URL(f, import.meta.url));
let codeHash;

async function key(kind, file) {
  codeHash ??= Promise.all(CODE.map((u) => readFile(u))).then((bufs) => {
    const h = createHash('sha1');
    for (const b of bufs) h.update(b);
    return h.digest('hex');
  });
  const s = await stat(file);
  return createHash('sha1').update(JSON.stringify([kind, path.resolve(file), s.size, s.mtimeMs, await codeHash])).digest('hex');
}

export async function cached(kind, file, compute) {
  if (process.env.VIZ_CACHE === 'off') return compute();
  const at = await key(kind, file).then((k) => path.join(DIR, `${kind}-${k}.json`), () => null);
  if (at) {
    try {
      return JSON.parse(await readFile(at, 'utf8')).value;
    } catch {}
  }
  const value = await compute();
  if (at) await mkdir(DIR, { recursive: true }).then(() => writeFile(at, JSON.stringify({ value }))).catch(() => {});
  return value;
}
