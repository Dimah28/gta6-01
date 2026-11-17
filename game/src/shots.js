// The screenshot scenes behind ?shot=title|drive|chase|mission. Each one plays
// the real rules forward from a fresh world for a fixed number of steps, steered
// by the game's own autopilot, so the frame is what a short game really looks
// like and the same seed always gives the same frame.

import { STEP } from './config.js';
import { SCREEN_BRIEF, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const TITLE_SECONDS = 5;
const DRIVE_SECONDS = 7;
const CHASE_SECONDS = 12;

function putPlayerInCar(world) {
  const state = world.state;
  const car = state.cars.find((c) => c.kind === 'player' && !c.dead) || state.cars[0];
  state.player.car = car;
  state.player.onFoot = false;
  state.player.x = car.x;
  state.player.y = car.y;
  state.player.angle = car.angle;
  car.speed = 0;
  return car;
}

function stepWorld(world, seconds) {
  const idle = { x: 0, y: 0, interact: false, punch: false, shoot: false, mouseWorld: null, shift: false, space: false };
  for (let i = 0; i < seconds / STEP; i += 1) world.step(STEP, idle);
}

/**
 * Set `world` to the named scene (title, drive, chase or mission; any other
 * name is title) and return the screen to draw over it and the best score.
 */
export function stageShot(name, world) {
  const state = world.state;
  if (name === 'drive') {
    const car = putPlayerInCar(world);
    car.x = 600;
    car.y = 1900;
    car.angle = Math.PI / 2;
    state.player.x = car.x;
    state.player.y = car.y;
    state.autopilot = true;
    stepWorld(world, DRIVE_SECONDS);
    state.autopilot = false;
    return { screen: SCREEN_PLAY, best: state.score };
  }
  if (name === 'chase') {
    const car = putPlayerInCar(world);
    car.x = 1600;
    car.y = 1100;
    car.angle = 0;
    state.player.x = car.x;
    state.player.y = car.y;
    world.addWanted(3, 'Police chase');
    // Three cruisers close in from three sides so the chase is in frame.
    world.spawnPoliceAt(1400, 1100);
    world.spawnPoliceAt(1800, 1100);
    world.spawnPoliceAt(1600, 1400);
    state.autoTarget = { x: 2900, y: 2100, r: 60, label: 'Escape' };
    state.autopilot = true;
    stepWorld(world, CHASE_SECONDS);
    state.autopilot = false;
    state.autoTarget = null;
    return { screen: SCREEN_PLAY, best: state.score };
  }
  if (name === 'mission') {
    const car = putPlayerInCar(world);
    car.x = 2360;
    car.y = 500;
    car.angle = 0;
    state.player.x = car.x;
    state.player.y = car.y;
    state.autopilot = true;
    // Drive the last stretch to the marker; the mission completes for real.
    for (let i = 0; i < 600 && state.missionDone === 0; i += 1) {
      world.step(STEP, { x: 0, y: 0, interact: false, punch: false, shoot: false, mouseWorld: null, shift: false, space: false });
    }
    state.autopilot = false;
    return { screen: state.missionDone > 0 ? SCREEN_BRIEF : SCREEN_PLAY, best: state.score };
  }
  // Title: let the city live for a few seconds behind the title panel.
  stepWorld(world, TITLE_SECONDS);
  return { screen: SCREEN_TITLE, best: 0 };
}
