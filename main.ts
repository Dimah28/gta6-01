// Solmar Bay — a gta6-01 entry (Node 22, standard library only): the game is
// this directory's game/ folder, plain static files a desktop browser loads
// offline (game/index.html and its ES modules, with Three.js and GSAP vendored
// locally — no library and no network request), and the program hands it in.
// It copies game/ and screenshots/ from beside this file to /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored make.fun library.
//
// Solmar Bay is a complete 3D open-world crime game in the spirit of GTA 6,
// built from scratch: a named city (Solmar Bay) with six districts, a beach
// and a day/night cycle; driving and stealing cars with a NOS boost; traffic
// and pedestrians; a 1–5 star wanted system with police chases, roadblocks and
// a helicopter; six story missions plus taxi and courier side jobs; punching
// and shooting; an economy (cash, a garage shop with cars, armor and ammo);
// a HUD with a minimap, speedometer and radio; a title screen, a save in
// localStorage, pause, game over and a victory screen with a grade;
// generative WebAudio sound with a radio station; and deterministic
// screenshot scenes via ?shot=title|drive|chase|mission&seed=N.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
