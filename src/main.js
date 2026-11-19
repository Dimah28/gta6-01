// Solmar Bay — entry point.
//
// Boot: builds the world, wires keyboard + mouse + touch to the player
// controller, runs a fixed-step loop (60 Hz sim, render every frame) and
// hands each finished frame to the Three.js renderer. The screenshot stage
// (?shot=...) runs instead of the loop so capture is deterministic.
import { createWorld } from './world.js';
import { createRenderer, SCREEN_TITLE, SCREEN_PLAY, SCREEN_PAUSED, SCREEN_OVER, SCREEN_BRIEF, SCREEN_SHOP, SCREEN_VICTORY } from './render3d.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { stageShot } from './shots.js';
import { VIEW } from './config.js';

import { createRandom } from './random.js';

const canvas = document.getElementById('game');
const params = new URLSearchParams(window.location.search);
const seed = parseInt(params.get('seed') || '7', 10) || 7;

const world = createWorld(createRandom(seed));
let screen = SCREEN_TITLE;
let best = 0;
try {
  best = parseInt(localStorage.getItem('solmar-bay.best.v1') || '0', 10) || 0;
} catch (err) {
  best = 0;
}
world.load();

const audio = createAudio();
// audio.js exposes named one-shots (cash/alarm/mission) and a toggleMute;
// these tiny adapters keep the entry point readable.
function sfx(name) {
  if (name === 'cash') audio.cash();
  else if (name === 'siren') audio.alarm();
  else if (name === 'mission') audio.mission();
}
function syncMute() {
  if (audio.muted !== world.muted) audio.toggleMute();
}
syncMute();
const render = createRenderer(canvas, {
  onShopBuy: (id) => {
    if (screen === SCREEN_SHOP && world.buyShopItem(id)) sfx('cash');
  },
});

let shopItems = [];
function refreshShop() {
  shopItems = world.shopItems();
}

function startGame() {
  audio.ensure();
  screen = SCREEN_PLAY;
}

function showTitle() {
  screen = SCREEN_TITLE;
}

function togglePause() {
  if (screen === SCREEN_PLAY) screen = SCREEN_PAUSED;
  else if (screen === SCREEN_PAUSED) screen = SCREEN_PLAY;
}

function retry() {
  world.reset();
  refreshShop();
  screen = SCREEN_PLAY;
}

const input = createInput(canvas, {
  toWorld: (clientX, clientY) => render.screenToWorld(clientX, clientY),
  onConfirm: () => {
    if (screen === SCREEN_TITLE) {
      world.load();
      startGame();
    } else if (screen === SCREEN_BRIEF) {
      world.finishBrief();
      startGame();
    } else if (screen === SCREEN_OVER) showTitle();
    else if (screen === SCREEN_VICTORY) startGame();
  },
  onPause: () => {
    if (screen === SCREEN_SHOP) {
      world.closeShop();
      screen = SCREEN_PLAY;
    } else togglePause();
  },
  onMute: () => {
    world.muted = !world.muted;
    syncMute();
    world.save();
  },
  onReset: () => {
    if (screen === SCREEN_OVER) retry();
    else if (screen === SCREEN_TITLE) {
      world.clearSave();
      world.reset();
      startGame();
    }
  },
  onShop: () => {
    if (screen === SCREEN_SHOP) {
      // E closes the shop; clear the interact flag so the next step does
      // not immediately reopen it while the player still stands at the garage.
      world.closeShop();
      screen = SCREEN_PLAY;
      input.state.interact = false;
    }
  },
  onShopBuy: (indexOrId) => {
    if (screen !== SCREEN_SHOP) return;
    const id = typeof indexOrId === 'number'
      ? (shopItems[indexOrId] ? shopItems[indexOrId].id : null)
      : indexOrId;
    if (id && world.buyShopItem(id)) {
      sfx('cash');
      refreshShop();
    }
  },
  onShoot: (clientX, clientY) => {
    if (screen !== SCREEN_PLAY) return;
    const target = render.screenToWorld(clientX, clientY);
    world.shoot(target.x, target.y);
  },
  onTouchMove: (dx, dy) => {
    if (screen !== SCREEN_PLAY) return;
    world.setTouchMove(dx, dy);
  },
  onTouchButton: (name) => {
    if (screen !== SCREEN_PLAY) return;
    if (name === 'interact') world.interact();
    else if (name === 'punch') world.punch();
    else if (name === 'handbrake') world.setHandbrake(true);
    else if (name === 'boost') world.setBoost(true);
  },
  onTouchButtonUp: (name) => {
    if (name === 'handbrake') world.setHandbrake(false);
    else if (name === 'boost') world.setBoost(false);
  },
  onTouchTap: () => {
    if (screen === SCREEN_TITLE) {
      world.load();
      startGame();
    }
  },
});

// ---- Main loop: fixed 1/60 s sim steps, render each frame -------------------
let last = performance.now();
let accumulator = 0;
const STEP = 1 / 60;
const MAX_FRAME = 0.5; // sim runs ~100% of wall speed even after tab lag spikes
const MAX_STEPS = 30;
let briefFrames = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > MAX_FRAME) dt = MAX_FRAME;
  // The mission-complete brief waits for ENTER from a human — but the
  // autopilot (playtests, screenshot runs) has no hands, so it dismisses
  // itself after ~90 frames and drives on to the next mission.
  if (screen === SCREEN_BRIEF) {
    briefFrames += 1;
    if (world.state.autopilot && briefFrames > 90) {
      world.finishBrief();
      screen = SCREEN_PLAY;
      briefFrames = 0;
    }
  } else {
    briefFrames = 0;
  }
  accumulator += dt;
  let steps = 0;
  while (accumulator >= STEP && steps < MAX_STEPS) {
    if (screen === SCREEN_PLAY) {
      world.setInput(input.state);
      world.step();
      if (world.busted) {
        screen = SCREEN_OVER;
        sfx('siren');
      } else if (world.dead) {
        screen = SCREEN_OVER;
        sfx('siren');
      } else if (world.victory) {
        screen = SCREEN_VICTORY;
        sfx('mission');
      } else if (world.missionComplete) {
        screen = SCREEN_BRIEF;
        sfx('mission');
      } else if (world.shopOpen) {
        refreshShop();
        screen = SCREEN_SHOP;
      }
    }
    accumulator -= STEP;
    steps += 1;
  }
  if (steps >= MAX_STEPS) accumulator = 0;
  world.draw(render, screen, best, shopItems);
  const st = world.state;
  const pl = st.player;
  audio.update(dt, {
    driving: !pl.onFoot,
    speed: pl.car ? Math.abs(pl.car.speed) : pl.speed,
    wanted: st.wanted,
    policeNear: world.policeNear,
    nosBoosting: st.nosBoosting,
    heli: !!st.heli,
  });
  if (world.score > best) {
    best = world.score;
    try { localStorage.setItem('solmar-bay.best.v1', String(best)); } catch (err) { /* storage unavailable */ }
  }
}

world.state.draw = () => {
  // Draws the current frame without stepping the sim (used by shot staging).
  world.draw(render, screen, best, shopItems);
};

// Debug hooks for the playtest / capture scripts (read-only state + actions).
window.__solmar = {
  state: world.state,
  autopilot: (on, target) => world.setAutopilot(on, target),
  damage: (n) => world.damage(n),
  setWanted: (n) => world.setWanted(n),
  seed,
  debugAutopilot: () => world.debugAutopilot(),
  city: () => world.city,
  jumpMission: (n) => world.jumpMission(n),
  screen: () => screen,
};

const shot = params.get('shot');
if (shot) {
  // Screenshot staging: place the scene, paint twice, flag readiness.
  // No main loop, no input — the capture script decides the frame.
  // Gameplay shots stage on the PLAY screen (HUD visible, no title panel);
  // only the title shot keeps the title screen.
  if (shot !== 'title') screen = SCREEN_PLAY;
  const info = stageShot(world.state, shot, seed);
  world.state.draw();
  window.__shotInfo = info;
  document.title = 'Solmar Bay — shot ' + shot;
} else {
  refreshShop();
  requestAnimationFrame(frame);
}
