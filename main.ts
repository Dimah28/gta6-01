// Solmar Bay — a gta6-01 entry (Node 22, standard library only): the game is
// this directory's game/ folder, plain static files a desktop browser loads
// offline (game/index.html and its ES modules, with Three.js and GSAP vendored
// locally — no library and no network request), and the program hands it in.
// It copies game/ and screenshots/ from beside this file to /output and writes
// a dossier.json describing the entry for the make.fun platform.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const OUT = resolve('/output');
const SHOTS = JSON.parse(readFileSync(join(DIR, 'shots.json'), 'utf8'));

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

function countFiles(dir) {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countFiles(join(dir, entry.name));
    else if (entry.isFile()) count += 1;
  }
  return count;
}

function totalBytes(dir) {
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) bytes += totalBytes(p);
    else if (entry.isFile()) bytes += statSync(p).size;
  }
  return bytes;
}

const gameOut = join(OUT, 'game');
const shotsOut = join(OUT, 'screenshots');
copyTree(join(DIR, 'game'), gameOut);
if (existsSync(join(DIR, 'screenshots'))) copyTree(join(DIR, 'screenshots'), shotsOut);

const shots = SHOTS.map((shot) => {
  const p = join(shotsOut, shot.name);
  const size = existsSync(p) ? statSync(p).size : 0;
  return { name: shot.name, query: shot.query, bytes: size };
});

const dossier = {
  name: 'Solmar Bay',
  slug: 'gta6-01',
  description: 'An open-world crime game: steal cars, dodge a 1–5 star wanted system, and run six story missions across the city of Solmar Bay.',
  entryPoint: 'game/index.html',
  gameFiles: countFiles(gameOut),
  gameBytes: totalBytes(gameOut),
  screenshots: shots,
};

writeFileSync(join(OUT, 'dossier.json'), JSON.stringify(dossier, null, 2) + '\n');
console.log(JSON.stringify(dossier, null, 2));
