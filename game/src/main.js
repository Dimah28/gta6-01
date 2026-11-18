// Solmar Bay — boot and the one loop: input is read every frame, the world
// advances in fixed 1/60 s steps (several in a slow frame, none in a fast
// one), and the renderer paints what is there. The game moves between seven
// screens: title, play, paused, brief (mission complete), shop, game over and
// victory. Progress saves to localStorage.
//
// ?seed=N fixes the city and traffic. ?shot=title|drive|chase|mission
// (with &seed=N) stages that scene instead of running the loop, paints it
// twice and sets window.__shotReady for a screenshot.

import { BEST_KEY, SAVE_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld, EVENT_MISSION, EVENT_OVER, EVENT_VICTORY } from './world.js';
import { ACTION_CONFIRM, ACTION_INTERACT, ACTION_MUTE, ACTION_PAUSE, ACTION_PUNCH, ACTION_SHOOT, createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_BRIEF, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_SHOP, SCREEN_TITLE, SCREEN_VICTORY } from './render3d.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed.
 * 0.5s: headless SwiftShader renders ~2fps, so a frame can be 0.45s — the cap must cover a
 * whole slow frame or the sim falls behind wall time and timed playtests starve. */
const MAX_FRAME = 0.5;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const audio = createAudio();

function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function makeWorld() {
  return createWorld(createRandom(seed), loadSave());
}

let world = makeWorld();
let renderer;
try {
  renderer = createRenderer(canvas, {
    onShopBuy(id) {
      if (world.buy(id)) audio.cash();
      else audio.fail();
    },
  });
} catch (err) {
  window.__shotError = 'renderer failed: ' + (err && err.message ? err.message : String(err));
  throw err;
}

// Debug hooks for automated playtests (console only, not part of the UI).
window.__solmar = {
  get state() { return world.state; },
  autopilot(on, target) {
    world.state.autopilot = !!on;
    if (target) world.state.autoTarget = target;
    else if (!on) world.state.autoTarget = null;
  },
  damage(n) {
    const s = world.state;
    s.player.hp -= n;
    if (s.player.hp <= 0) {
      s.player.hp = 0;
      s.over = true;
      s.overReason = 'WASTED';
    }
  },
  setWanted(n) { world.state.wanted = n; },
  seed,
  debugAutopilot() { return world.debugAutopilot(); },
  city() { return world.city; },
  jumpMission(n) {
    world.state.mission = n;
    world.setupMission(n);
    return world.state.mission;
  },
};

function runShot(name) {
  let scene;
  try {
    scene = stageShot(name, world);
  } catch (err) {
    window.__shotError = 'stageShot failed: ' + (err && err.message ? err.message : String(err));
    return;
  }
  let painted = 0;
  function paint() {
    try {
      renderer.draw(world.state, world.city, scene.screen, scene.best, world.shopItems());
    } catch (err) {
      window.__shotError = 'draw failed: ' + (err && err.message ? err.message : String(err));
      return;
    }
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let victoryShown = false;
  let shopKey = 0;
  let briefTimer = 0;
  let lastNos = false;
  window.__solmar.screen = () => screen;

  window.addEventListener('keydown', (event) => {
    if (screen === SCREEN_SHOP && /^Digit[1-6]$/.test(event.code)) {
      shopKey = Number(event.code.slice(5));
    }
    if (screen === SCREEN_OVER && event.code === 'KeyR') {
      restart();
    }
  });

  function announce(message) {
    status.textContent = message;
  }

  function restart() {
    world = makeWorld();
    victoryShown = false;
    screen = SCREEN_PLAY;
    announce('Playing. Mission ' + world.state.mission + '.');
  }

  function startGame() {
    if (world.state.over || world.state.victory) {
      world = makeWorld();
      victoryShown = false;
    }
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce('Playing. Mission ' + world.state.mission + '.');
  }

  function endGame() {
    screen = SCREEN_OVER;
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    announce(`${world.state.overReason}. Score ${world.state.score}. Best ${best}.`);
  }

  function showVictory() {
    victoryShown = true;
    screen = SCREEN_VICTORY;
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    world.save();
    announce(`Story complete. Grade ${world.state.grade}. Score ${world.state.score}.`);
  }

  function buildInput() {
    const keys = input.keys;
    const mouse = input.mouse();
    const mouseWorld = renderer.screenToWorld(mouse.x, mouse.y);
    return {
      x: (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
      y: (keys.down ? 1 : 0) - (keys.up ? 1 : 0),
      interact: false,
      punch: false,
      shoot: false,
      mouseWorld,
      shift: keys.shift || keys.nos,
      space: keys.space,
    };
  }

  function handleActions(ctl) {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) {
      const muted = audio.toggleMute();
      announce(muted ? 'Muted.' : 'Sound on.');
    }
    if (screen === SCREEN_SHOP) {
      if (shopKey > 0) {
        const items = world.shopItems();
        const item = items[shopKey - 1];
        if (item) {
          if (world.buy(item.id)) audio.cash();
          else audio.fail();
        }
        shopKey = 0;
      }
      if (actions & (ACTION_PAUSE | ACTION_INTERACT)) {
        world.state.shopOpen = false;
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
      return;
    }
    if (actions & ACTION_CONFIRM) {
      if (screen === SCREEN_TITLE) startGame();
      else if (screen === SCREEN_BRIEF) { screen = SCREEN_PLAY; announce('Playing.'); }
      else if (screen === SCREEN_OVER) screen = SCREEN_TITLE;
      else if (screen === SCREEN_VICTORY) { screen = SCREEN_PLAY; announce('Free roam.'); }
    }
    if (actions & ACTION_PAUSE) {
      if (screen === SCREEN_PLAY) { screen = SCREEN_PAUSED; announce('Paused.'); }
      else if (screen === SCREEN_PAUSED) { screen = SCREEN_PLAY; announce('Playing.'); }
    }
    if (screen !== SCREEN_PLAY) return;
    if (actions & ACTION_INTERACT) ctl.interact = true;
    if (actions & ACTION_PUNCH) ctl.punch = true;
    if (actions & ACTION_SHOOT) ctl.shoot = true;
  }

  function step() {
    const ctl = buildInput();
    if (screen === SCREEN_TITLE) {
      // The city lives behind the title; Enter/click starts the game.
      handleActions(ctl);
      if (screen === SCREEN_TITLE) {
        world.step(STEP, { x: 0, y: 0, interact: false, punch: false, shoot: false, mouseWorld: null, shift: false, space: false });
      }
      return;
    }
    if (screen !== SCREEN_PLAY) {
      // Brief, shop, paused, over and victory: only actions are handled.
      handleActions(ctl);
      // Autopilot: dismiss the mission-complete brief by itself after a
      // beat (the panel is still shown), then keep playing. Without this
      // the autopilot stalls on BRIEF forever — it never sends Enter.
      if (screen === SCREEN_BRIEF && world.state.autopilot) {
        briefTimer += 1;
        if (briefTimer > 90) {
          briefTimer = 0;
          screen = SCREEN_PLAY;
          announce('Playing.');
        }
      } else {
        briefTimer = 0;
      }
      return;
    }
    handleActions(ctl);
    if (screen !== SCREEN_PLAY) return;
    const events = world.step(STEP, ctl);
    if (events & EVENT_OVER) endGame();
    else if (events & EVENT_VICTORY) showVictory();
    else if (events & EVENT_MISSION) {
      world.save();
      audio.mission();
      screen = SCREEN_BRIEF;
      announce('Mission complete.');
    }
    if (world.state.shopOpen && screen === SCREEN_PLAY) {
      screen = SCREEN_SHOP;
      audio.click();
      announce('Garage shop.');
    }
    if (world.state.over && screen === SCREEN_PLAY) endGame();
    if (world.state.victory && !victoryShown && screen === SCREEN_PLAY) showVictory();
    // NOS whoosh on the edge of a boost.
    if (world.state.nosBoosting && !lastNos) audio.nos();
    lastNos = world.state.nosBoosting;
    audio.update(STEP, {
      driving: !world.state.player.onFoot,
      speed: world.state.player.speed || 0,
      wanted: world.state.wanted,
      policeNear: world.policeNear,
      nosBoosting: world.state.nosBoosting,
      heli: !!world.state.heli,
    });
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    let guard = 0;
    // 30 steps = 0.5s of sim per frame: the sim itself is cheap (a few dozen
    // cars/peds), the WebGL raster is what is slow headless, so the sim must
    // be allowed to catch up to wall time in one frame instead of capping at
    // 10 steps (0.17s) and running at ~40% speed.
    while (accumulator >= STEP && guard < 30) {
      step();
      accumulator -= STEP;
      guard += 1;
    }
    if (screen !== SCREEN_TITLE && screen !== SCREEN_PLAY) accumulator = 0;
    renderer.draw(world.state, world.city, screen, best, world.shopItems());
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Solmar Bay. Press Enter or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
