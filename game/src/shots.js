// Shot staging for screenshots: ?shot=title|drive|chase|mission&seed=N
// The renderer paints twice (settling the damped chase camera + HUD), then
// sets window.__shotReady so the capture script knows the frame is final.
import { CAR_MODELS, MISSIONS } from './config.js';

function setPlayer(state, x, y, angle) {
  state.player.x = x;
  state.player.y = y;
  state.player.angle = angle;
}

function findCar(state, modelId) {
  return state.cars.find((c) => c.model && c.model.id === modelId && !c.dead)
    || state.cars.find((c) => c.kind === 'parked' && !c.dead)
    || state.cars.find((c) => c.kind === 'player' && !c.dead);
}

export function applyShot(state, name, seed) {
  state.timeOfDay = 0.32; // morning: crisp light, readable HUD
  if (name === 'drive') {
    // Mid-action: the player races a sedan down the x=1800 avenue with
    // traffic around him — staged ON a road, so the chase camera has a
    // clear corridor and the car sits centre-frame, not inside a block.
    setPlayer(state, 1800, 800, Math.PI / 2);
    const car = findCar(state, 'sedan');
    if (car) {
      car.x = 1800;
      car.y = 800;
      car.angle = Math.PI / 2;
      car.speed = 350; // FOV kick + motion feel in the still frame
      state.enterCar(car);
    }
    state.message = 'SOLMAR BAY — Drive hard. Live louder.';
    return;
  }
  if (name === 'chase') {
    // Mid-action: a 3-star chase up the x=1400 avenue — two cruisers ahead
    // in frame, wanted stars lit. This is the money shot for the leaderboard.
    setPlayer(state, 1400, 1700, -Math.PI / 2);
    let car = state.cars.find((c) => c.model && c.model.id === 'muscle' && !c.dead);
    if (!car) {
      car = findCar(state, 'muscle');
      if (car) car.model = CAR_MODELS[2]; // Solmar Muscle
    }
    if (car) {
      car.x = 1400;
      car.y = 1700;
      car.angle = -Math.PI / 2;
      car.hp = 120;
      car.speed = 600;
      state.enterCar(car);
    }
    state.setWanted(3);
    state.spawnPoliceAt(1400, 1500);
    state.spawnPoliceAt(1400, 1300);
    state.money = 1250;
    state.score = 3400;
    state.message = '3-STAR HEAT — Lose them at the safehouse!';
    return;
  }
  if (name === 'mission') {
    // Mid-action: mission 6, The Big Score — the player sprints east along
    // the y=1100 road toward the gold bank marker, 4 stars on him.
    state.jumpMission(6);
    setPlayer(state, 1400, 1100, 0);
    state.setWanted(4);
    state.heli = { x: 1500, y: 1050, z: 260, angle: 0.6, rotor: 0 };
    state.money = 2100;
    state.score = 8700;
    state.message = 'THE BIG SCORE — Run. Don\'t look back.';
    return;
  }
  // Default: title — slow orbit over the city, no player action.
  state.timeOfDay = 0.5;
}

export function stageShot(state, name, seed) {
  applyShot(state, name, seed);
  // Paint twice so the damped camera and the HUD finish settling, then flag.
  state.draw();
  state.draw();
  window.__shotReady = true;
  const mission = state.mission <= 6 ? MISSIONS[state.mission - 1] : null;
  return {
    shot: name,
    mission: mission ? mission.name : 'Free roam',
    wanted: state.wanted,
    money: state.money,
    score: state.score,
  };
}
