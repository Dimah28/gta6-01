// Solmar Bay — the rules and state, with no drawing and no browser in it:
// the player on foot and by car, traffic, pedestrians, police and the wanted
// system, six story missions, side jobs, combat, the economy and the save.
// step() advances one fixed step and returns what happened as bit flags.

import {
  BANK, CAR_MODELS, ECONOMY, GARAGE, MAX_POLICE, MISSIONS, PLAYER,
  SAFEHOUSE, SPAWN, TRAFFIC_COUNT, PED_COUNT, WANTED, WORLD,
} from './config.js';
import { collideBuildings, districtAt, nearestRoadX, nearestRoadY, onRoad, routeWaypoints, snapToRoad, createCity } from './city.js';
import { createRandom, pick, range } from './random.js';

export const EVENT_NONE = 0;
export const EVENT_MISSION = 1;
export const EVENT_WANTED = 2;
export const EVENT_CASH = 4;
export const EVENT_HIT = 8;
export const EVENT_OVER = 16;
export const EVENT_VICTORY = 32;
export const EVENT_SHOP = 64;

const TAU = Math.PI * 2;
const CAR_COLORS = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#ecf0f1', '#16a085', '#d35400', '#7f8c8d', '#b03a2e'];

function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

let nextCarId = 1;

function makeCar(model, x, y, angle, color, kind) {
  return {
    id: nextCarId += 1,
    model, name: model.name,
    x, y, angle, speed: 0, hp: model.hp, maxHp: model.hp,
    color: color || pick(Math.random, CAR_COLORS),
    kind: kind || 'parked', // parked | traffic | police | player | target
    tx: x, ty: y, // traffic waypoint
    cruise: 150 + Math.random() * 60,
    wait: 0,
    siren: false,
    dead: false,
  };
}

function makePed(random, x, y) {
  return {
    x, y, angle: random() * TAU, speed: 55 + random() * 35,
    tx: x, ty: y, hp: 50, flee: 0, dead: false,
    color: pick(random, ['#e74c3c', '#3498db', '#f1c40f', '#9b59b6', '#1abc9c', '#e67e22', '#ecf0f1']),
    down: 0,
  };
}

export function createWorld(random, saved) {
  const city = createCity(random);
  const state = {
    time: 0,
    timeOfDay: 0.32, // morning
    money: saved?.money ?? 150,
    totalEarned: saved?.totalEarned ?? 0,
    score: saved?.score ?? 0,
    hp: PLAYER.hp,
    armor: saved?.armor ?? 0,
    ammo: saved?.ammo ?? 12,
    wanted: 0,
    unseenTimer: 0,
    mission: saved?.mission ?? 1, // 1..6, 7 = story done (free roam)
    missionStage: 0,
    missionTimer: 0,
    missionDone: 0,
    targets: [],
    owned: saved?.owned ?? ['sedan'],
    cars: [],
    peds: [],
    particles: [],
    floats: [],
    player: {
      x: SPAWN.x, y: SPAWN.y, angle: -Math.PI / 2, radius: PLAYER.radius,
      hp: PLAYER.hp, onFoot: true, car: null, speed: 0, invuln: 0,
      lastHurt: -99, busted: 0,
    },
    stats: saved?.stats ?? { carsStolen: 0, pedsHit: 0, taxisDone: 0, packages: 0, shotsFired: 0, copsLost: 0, deaths: 0 },
    shopOpen: false,
    over: false,
    overReason: '',
    victory: false,
    victoryShown: false,
    taxi: null,
    taxiTimer: 0,
    packages: [],
    targetCar: null,
    message: '',
    messageUntil: 0,
    threat: null,
    autopilot: false,
    autoTarget: null,
    grade: '—',
    playSeconds: 0,
    roadblocks: 0,
    missionHeatReached: false,
    seedNote: '',
  };

  // The player's starter car, parked by the safehouse.
  const starter = makeCar(CAR_MODELS[0], SPAWN.x + 60, SPAWN.y + 10, 0, '#4fc3f7', 'player');
  starter.owned = true;
  state.cars.push(starter);

  // Parked cars around the city (free to take when nobody drives them).
  const parkedSpots = [
    [700, 500], [1500, 800], [2300, 1400], [1000, 2000], [2700, 500], [1800, 2200], [400, 1400], [2400, 2000],
  ];
  for (const [px, py] of parkedSpots) {
    const m = pick(random, CAR_MODELS.slice(0, 4));
    const c = makeCar(m, px, py, random() < 0.5 ? 0 : Math.PI / 2, null, 'parked');
    state.cars.push(c);
  }

  // Traffic.
  for (let i = 0; i < TRAFFIC_COUNT; i += 1) spawnTraffic(true);
  // Pedestrians.
  for (let i = 0; i < PED_COUNT; i += 1) {
    const p = randomSidewalkPoint();
    state.peds.push(makePed(random, p.x, p.y));
  }
  // Courier packages lying around.
  for (let i = 0; i < 3; i += 1) spawnPackage();

  function spawnTraffic(initial) {
    const ix = Math.floor(random() * 8);
    const iy = Math.floor(random() * 8);
    const x = [200, 600, 1000, 1400, 1800, 2200, 2600, 3000][ix];
    const y = [200, 500, 800, 1100, 1400, 1700, 2000, 2200][iy];
    if (!initial && dist(x, y, state.player.x, state.player.y) < 500) return;
    const model = pick(random, CAR_MODELS.slice(0, 4));
    const car = makeCar(model, x, y, 0, null, 'traffic');
    pickNextWaypoint(car, true);
    state.cars.push(car);
  }

  function pickNextWaypoint(car, first) {
    const xs = [200, 600, 1000, 1400, 1800, 2200, 2600, 3000];
    const ys = [200, 500, 800, 1100, 1400, 1700, 2000, 2200];
    let ix = xs.indexOf(nearestRoadX(car.x));
    let iy = ys.indexOf(nearestRoadY(car.y));
    if (ix < 0) ix = 0;
    if (iy < 0) iy = 0;
    const options = [];
    if (ix > 0) options.push([ix - 1, iy]);
    if (ix < xs.length - 1) options.push([ix + 1, iy]);
    if (iy > 0) options.push([ix, iy - 1]);
    if (iy < ys.length - 1) options.push([ix, iy + 1]);
    // Prefer not to reverse.
    const prev = [car.tx, car.ty];
    const forward = options.filter(([a, b]) => !(xs[a] === prev[0] && ys[b] === prev[1]));
    const [nx, ny] = pick(random, forward.length && !first ? forward : options);
    car.tx = xs[nx];
    car.ty = ys[ny];
  }

  function spawnPackage() {
    const p = snapToRoad(range(random, 300, WORLD.width - 100), range(random, 300, WORLD.height - 100));
    state.packages.push({ x: p.x, y: p.y, taken: false });
  }

  /** A point on a sidewalk corner: pedestrians walk the edges, not the lanes. */
  function randomSidewalkPoint() {
    const xs = [200, 600, 1000, 1400, 1800, 2200, 2600, 3000];
    const ys = [200, 500, 800, 1100, 1400, 1700, 2000, 2200];
    const x = xs[Math.floor(random() * xs.length)];
    const y = ys[Math.floor(random() * ys.length)];
    if (random() < 0.5) return { x: x + (random() < 0.5 ? 58 : -58), y: y + range(random, -58, 58) };
    return { x: x + range(random, -58, 58), y: y + (random() < 0.5 ? 58 : -58) };
  }

  function spawnPoliceAt(x, y) {
    const s = snapToRoad(x, y);
    const car = makeCar(CAR_MODELS[4], s.x, s.y, 0, '#1a3a5c', 'police');
    car.siren = true;
    car.cruise = 560;
    state.cars.push(car);
    return car;
  }

  function spawnPolice() {
    const angle = random() * TAU;
    const d = 650 + random() * 250;
    let x = state.player.x + Math.cos(angle) * d;
    let y = state.player.y + Math.sin(angle) * d;
    x = Math.max(120, Math.min(WORLD.width - 60, x));
    y = Math.max(120, Math.min(WORLD.height - 60, y));
    const s = snapToRoad(x, y);
    const car = makeCar(CAR_MODELS[4], s.x, s.y, 0, '#1a3a5c', 'police');
    car.siren = true;
    car.cruise = 560;
    state.cars.push(car);
    return car;
  }

  function addFloat(x, y, text, color) {
    state.floats.push({ x, y, text, color: color || '#f2c94c', life: 1.4 });
    if (state.floats.length > 24) state.floats.shift();
  }

  function addParticles(x, y, n, color, speed) {
    for (let i = 0; i < n; i += 1) {
      const a = random() * TAU;
      const s = (speed || 120) * (0.4 + random() * 0.8);
      state.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + random() * 0.5, max: 1, color, size: 2 + random() * 3 });
    }
    if (state.particles.length > 320) state.particles.splice(0, state.particles.length - 320);
  }

  function say(text, seconds) {
    state.message = text;
    state.messageUntil = state.time + (seconds || 4);
  }

  function earn(amount, label) {
    state.money += amount;
    state.totalEarned += amount;
    state.score += amount;
    addFloat(state.player.x, state.player.y - 30, `+$${amount}${label ? ' ' + label : ''}`, '#58c96b');
    return EVENT_CASH;
  }

  function addWanted(n, reason) {
    const before = state.wanted;
    state.wanted = Math.min(5, state.wanted + n);
    state.unseenTimer = 0;
    if (state.wanted !== before) {
      say(`WANTED ${'★'.repeat(state.wanted)} — ${reason}`, 3);
      return EVENT_WANTED;
    }
    return EVENT_NONE;
  }

  function missionTarget() {
    return state.targets.find((t) => !t.done) || null;
  }

  function setMissionTargets(list) {
    state.targets = list.map((t) => ({ ...t, done: false }));
  }

  // ---- Mission definitions -------------------------------------------------
  function setupMission(n) {
    state.missionStage = 0;
    state.missionTimer = 0;
    if (n === 1) {
      setMissionTargets([{ x: 2400, y: 500, r: 70, label: 'Deliver the package' }]);
      say('MISSION 1 — First Delivery: drive to the gold marker.', 5);
    } else if (n === 2) {
      // A red muscle car waits at the docks.
      const car = makeCar(CAR_MODELS[2], 460, 1060, Math.PI / 2, '#c0392b', 'target');
      state.cars.push(car);
      state.targetCar = car;
      setMissionTargets([
        { x: 460, y: 1060, r: 70, label: 'Steal the red Muscle car' },
        { x: GARAGE.x, y: GARAGE.y, r: 90, label: 'Bring it to the garage' },
      ]);
      say('MISSION 2 — Hot Wheels: steal the red car at the docks.', 5);
    } else if (n === 3) {
      setMissionTargets([
        { x: 2600, y: 1900, r: 70, label: 'Pick up the fare' },
        { x: 600, y: 400, r: 80, label: 'Drop off before the clock runs out' },
      ]);
      state.missionTimer = 75;
      say('MISSION 3 — Taxi Rush: pick up the fare, 75 seconds on the clock.', 5);
    } else if (n === 4) {
      setMissionTargets([
        { x: 0, y: 0, r: 0, label: 'Raise your wanted to 3 stars', special: 'wanted3' },
        { x: SAFEHOUSE.x, y: SAFEHOUSE.y, r: 150, label: 'Lose the cops at the safehouse', special: 'lose' },
      ]);
      say('MISSION 4 — Heat Run: get 3 stars, then vanish at the safehouse.', 5);
    } else if (n === 5) {
      setMissionTargets([
        { x: 2600, y: 1100, r: 60, label: 'Stash 1 of 3' },
        { x: 1000, y: 2000, r: 60, label: 'Stash 2 of 3' },
        { x: 1800, y: 300, r: 60, label: 'Stash 3 of 3' },
      ]);
      say('MISSION 5 — The Collection: grab 3 stashes across the city.', 5);
    } else if (n === 6) {
      setMissionTargets([
        { x: BANK.x, y: BANK.y, r: 90, label: 'Hit the Downtown bank' },
        { x: SAFEHOUSE.x, y: SAFEHOUSE.y, r: 150, label: 'Lose a 4-star wanted at the safehouse', special: 'lose4' },
      ]);
      say('MISSION 6 — The Big Score: rob the bank, then disappear.', 5);
    }
  }

  function completeMission() {
    const m = MISSIONS[state.mission - 1];
    state.missionDone += 1;
    state.score += 500;
    earn(m.pay, m.name);
    state.mission += 1;
    state.targets = [];
    state.targetCar = null;
    state.taxi = null;
    if (state.mission > 6) {
      state.victory = true;
      state.grade = gradeRun();
      return EVENT_MISSION | EVENT_VICTORY;
    }
    setupMission(state.mission);
    return EVENT_MISSION;
  }

  function gradeRun() {
    const deaths = state.stats.deaths;
    const t = state.playSeconds;
    if (deaths === 0 && t < 900) return 'S';
    if (deaths <= 1 && t < 1500) return 'A';
    if (deaths <= 3) return 'B';
    return 'C';
  }

  function failMission(reason) {
    say(`MISSION FAILED — ${reason}. Try again.`, 4);
    setupMission(state.mission);
  }

  function save() {
    try {
      window.localStorage.setItem('solmar-bay.save.v1', JSON.stringify({
        money: state.money, totalEarned: state.totalEarned, score: state.score,
        armor: state.armor, ammo: state.ammo, mission: Math.min(state.mission, 6),
        owned: state.owned, stats: state.stats,
      }));
    } catch { /* storage can be off */ }
  }

  // ---- Combat helpers ------------------------------------------------------
  function hurtPlayer(amount, source) {
    const p = state.player;
    if (p.invuln > 0 || state.over) return EVENT_NONE;
    let left = amount;
    if (state.armor > 0) {
      const absorbed = Math.min(state.armor, left);
      state.armor -= absorbed;
      left -= absorbed;
    }
    p.hp -= left;
    p.lastHurt = state.time;
    p.invuln = 0.35;
    addParticles(p.x, p.y, 6, '#e5534b', 140);
    if (p.hp <= 0) {
      p.hp = 0;
      state.over = true;
      state.overReason = source || 'WASTED';
      state.stats.deaths += 1;
      save();
      return EVENT_HIT | EVENT_OVER;
    }
    return EVENT_HIT;
  }

  function explodeCar(car) {
    if (car.kind === 'target') {
      // The mission car is too important to lose: it smokes but keeps going.
      car.hp = 30;
      car.dead = false;
      return;
    }
    car.dead = true;
    addParticles(car.x, car.y, 30, '#f39c12', 260);
    addParticles(car.x, car.y, 20, '#e5534b', 200);
    addFloat(car.x, car.y - 24, 'CAR DESTROYED', '#e5534b');
    if (state.player.car === car) {
      state.player.car = null;
      state.player.onFoot = true;
      state.player.x = car.x + 30;
      state.player.y = car.y;
      hurtPlayer(15, 'WASTED');
    }
  }

  // ---- Input actions -------------------------------------------------------
  function tryInteract() {
    const p = state.player;
    if (state.shopOpen) return EVENT_NONE;
    // Garage shop.
    if (dist(p.x, p.y, GARAGE.x, GARAGE.y) < 130) {
      state.shopOpen = true;
      return EVENT_SHOP;
    }
    // Taxi passenger pickup (mission 3 stage 0, or a side-job fare).
    const t = missionTarget();
    if (state.mission === 3 && state.missionStage === 0 && t && dist(p.x, p.y, t.x, t.y) < t.r) {
      t.done = true;
      state.missionStage = 1;
      say('Fare picked up! Get to the drop-off before the clock runs out.', 4);
      return EVENT_MISSION;
    }
    if (state.taxi && state.taxi.stage === 0 && dist(p.x, p.y, state.taxi.px, state.taxi.py) < 60) {
      state.taxi.stage = 1;
      say(`Fare aboard — drop them at the marker for $${state.taxi.fare}.`, 4);
      return EVENT_NONE;
    }
    if (p.onFoot) {
      // Enter the nearest car.
      let best = null;
      let bestD = 80;
      for (const car of state.cars) {
        if (car.dead) continue;
        const d = dist(p.x, p.y, car.x, car.y);
        if (d < bestD) { bestD = d; best = car; }
      }
      if (best) {
        if (best.kind === 'traffic') {
          // Steal it: the driver flees on foot.
          state.peds.push(makePed(random, best.x + 24, best.y + 24));
          state.stats.carsStolen += 1;
          best.kind = 'player';
          addWanted(1, 'Grand theft auto');
        } else if (best.kind === 'target') {
          best.kind = 'player';
          state.stats.carsStolen += 1;
          addWanted(1, 'Grand theft auto');
          const mt = missionTarget();
          if (mt) mt.done = true;
          state.missionStage = 1;
          say('Got the Muscle car — now bring it to the garage!', 4);
        } else if (best.kind === 'police') {
          best.kind = 'player';
          state.stats.carsStolen += 1;
          addWanted(2, 'Stole a police cruiser!');
        }
        p.car = best;
        p.onFoot = false;
        p.angle = best.angle;
        return EVENT_NONE;
      }
      return EVENT_NONE;
    }
    // Exit the car.
    const car = p.car;
    p.car = null;
    p.onFoot = true;
    p.x = car.x + Math.cos(car.angle + Math.PI / 2) * 34;
    p.y = car.y + Math.sin(car.angle + Math.PI / 2) * 34;
    p.angle = car.angle;
    return EVENT_NONE;
  }

  function tryPunch() {
    const p = state.player;
    if (!p.onFoot) return EVENT_NONE;
    let hit = null;
    let bestD = PLAYER.punchRange;
    for (const ped of state.peds) {
      if (ped.dead || ped.down > 0) continue;
      const d = dist(p.x, p.y, ped.x, ped.y);
      if (d < bestD) { bestD = d; hit = ped; }
    }
    if (hit) {
      hit.hp -= PLAYER.punchDamage;
      hit.down = 1.2;
      addParticles(hit.x, hit.y, 8, '#f2c94c', 160);
      if (hit.hp <= 0) {
        hit.dead = true;
        state.stats.pedsHit += 1;
      }
      addWanted(1, 'Assault');
      return EVENT_HIT;
    }
    return EVENT_NONE;
  }

  function tryShoot(mouseWorld) {
    const p = state.player;
    if (!p.onFoot || state.ammo <= 0) return EVENT_NONE;
    state.ammo -= 1;
    state.stats.shotsFired += 1;
    const angle = Math.atan2(mouseWorld.y - p.y, mouseWorld.x - p.x);
    const rangeMax = 520;
    const ex = p.x + Math.cos(angle) * rangeMax;
    const ey = p.y + Math.sin(angle) * rangeMax;
    state.threat = { x: p.x, y: p.y, until: state.time + 2 };
    addParticles(p.x + Math.cos(angle) * 20, p.y + Math.sin(angle) * 20, 4, '#ffd76a', 200);
    // Hit test: nearest person or car near the shot line.
    let bestT = 1;
    let hitKind = null;
    let hitObj = null;
    function testLine(ox, oy, radius) {
      const dx = ex - p.x;
      const dy = ey - p.y;
      const len2 = dx * dx + dy * dy;
      let t = ((ox - p.x) * dx + (oy - p.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = p.x + dx * t;
      const cy = p.y + dy * t;
      const d = Math.hypot(ox - cx, oy - cy);
      if (d < radius + 8 && t < bestT) { bestT = t; return true; }
      return false;
    }
    for (const ped of state.peds) {
      if (!ped.dead && testLine(ped.x, ped.y, 12)) { hitKind = 'ped'; hitObj = ped; }
    }
    for (const car of state.cars) {
      if (!car.dead && car !== p.car && testLine(car.x, car.y, 22)) { hitKind = 'car'; hitObj = car; }
    }
    if (hitKind === 'ped') {
      hitObj.hp -= 34;
      hitObj.down = 1.5;
      if (hitObj.hp <= 0) { hitObj.dead = true; state.stats.pedsHit += 1; }
      addWanted(1, 'Shooting in the streets');
      addParticles(hitObj.x, hitObj.y, 8, '#e5534b', 160);
    } else if (hitKind === 'car') {
      hitObj.hp -= 34;
      addParticles(hitObj.x, hitObj.y, 8, '#f39c12', 160);
      if (hitObj.kind === 'police') addWanted(1, 'Shot at the police');
      if (hitObj.hp <= 0) explodeCar(hitObj);
    }
    return EVENT_NONE;
  }

  function buy(itemId) {
    const items = shopItems();
    const item = items.find((i) => i.id === itemId);
    if (!item || item.owned) return false;
    if (state.money < item.price) {
      say('Not enough cash for that.', 3);
      return false;
    }
    state.money -= item.price;
    if (item.kind === 'repair') {
      const car = state.player.car;
      if (car) car.hp = car.maxHp;
      say('Car repaired.', 3);
    } else if (item.kind === 'armor') {
      state.armor = 100;
      say('Body armor fitted.', 3);
    } else if (item.kind === 'ammo') {
      state.ammo += ECONOMY.ammoPack;
      say(`+${ECONOMY.ammoPack} pistol rounds.`, 3);
    } else if (item.kind === 'car') {
      state.owned.push(item.model);
      const model = CAR_MODELS.find((m) => m.id === item.model);
      const car = makeCar(model, GARAGE.x + 40, GARAGE.y + 60, 0, null, 'player');
      car.owned = true;
      state.cars.push(car);
      say(`${model.name} is yours — parked outside the garage.`, 4);
    }
    save();
    return true;
  }

  function shopItems() {
    const car = state.player.car;
    const items = [
      { id: 'repair', kind: 'repair', name: 'Full repair', desc: 'Fix your current ride', price: ECONOMY.repair, owned: !car || car.hp >= car.maxHp },
      { id: 'armor', kind: 'armor', name: 'Body armor', desc: 'Absorbs 100 damage', price: ECONOMY.armor, owned: state.armor >= 100 },
      { id: 'ammo', kind: 'ammo', name: `Pistol ammo x${ECONOMY.ammoPack}`, desc: 'For the streets', price: ECONOMY.ammo, owned: false },
    ];
    for (const model of CAR_MODELS.slice(1, 4)) {
      items.push({
        id: `car-${model.id}`, kind: 'car', model: model.id,
        name: model.name, desc: `Top speed ${model.maxSpeed} · ${model.hp} HP`,
        price: model.price, owned: state.owned.includes(model.id),
      });
    }
    return items;
  }

  // ---- Autopilot (screenshots + playtests) ---------------------------------
  function computeAutopilot() {
    const p = state.player;
    const input = { x: 0, y: 0, interact: false, punch: false, shoot: false, mouseWorld: null };
    let t = state.autoTarget || missionTarget();
    if (!t) return input;
    // Special mission targets resolve to a real place or a real car.
    if (t.special === 'wanted3' || t.special === 'lose' || t.special === 'lose4') {
      if (t.special === 'lose' || t.special === 'lose4') {
        t = { x: SAFEHOUSE.x, y: SAFEHOUSE.y, r: 120, label: 'Safehouse' };
      } else {
        // Steal the nearest traffic car to raise heat (parked cars are free).
        let best = null;
        let bestD = Infinity;
        for (const car of state.cars) {
          if (car.dead || car.kind !== 'traffic') continue;
          const d = dist(p.x, p.y, car.x, car.y);
          if (d < bestD) { bestD = d; best = car; }
        }
        if (!best) return input;
        if (p.onFoot && bestD < 70) { input.interact = true; return input; }
        t = { x: best.x, y: best.y, r: 60, label: 'Steal a car' };
      }
    }
    // Missions that need a key press at the marker: get out of the car first.
    const needsFoot = (state.mission === 2 && state.missionStage === 0)
      || (state.mission === 3 && state.missionStage === 0)
      || t.label === 'Steal a car';
    if (needsFoot && !p.onFoot && dist(p.x, p.y, t.x, t.y) < 130) {
      input.interact = true;
      return input;
    }
    if (p.onFoot && t.label === 'Steal a car') {
      let best = null;
      let bestD = 80;
      for (const car of state.cars) {
        if (car.dead || car.kind !== 'traffic' || car === p.car) continue;
        const cd = dist(p.x, p.y, car.x, car.y);
        if (cd < bestD) { bestD = cd; best = car; }
      }
      if (best) { input.interact = true; return input; }
    }
    // Missions that need a key press at the marker (pickup, steal).
    if (p.onFoot && ((state.mission === 3 && state.missionStage === 0) || state.mission === 2) && dist(p.x, p.y, t.x, t.y) < (t.r || 70)) {
      input.interact = true;
      return input;
    }
    const tx = t.x;
    const ty = t.y;
    const d = dist(p.x, p.y, tx, ty);
    if (d < 40) return input;
    if (p.onFoot) {
      // Walk toward the target; hop into a nearby car when the trip is long.
      if (d > 300) {
        let best = null;
        let bestD = 90;
        for (const car of state.cars) {
          if (car.dead || car.kind === 'police') continue;
          const cd = dist(p.x, p.y, car.x, car.y);
          if (cd < bestD) { bestD = cd; best = car; }
        }
        if (best) { input.interact = true; return input; }
      }
      const a = Math.atan2(ty - p.y, tx - p.x);
      input.x = Math.cos(a);
      input.y = Math.sin(a);
      return input;
    }
    // Driving: follow the road grid to the target, waypoint by waypoint.
    const car = p.car;
    const key = `${Math.round(tx / 50)},${Math.round(ty / 50)}`;
    if (state.autoRouteKey !== key || !state.autoRoute || state.autoRouteIdx >= state.autoRoute.length) {
      state.autoRoute = routeWaypoints(car.x, car.y, tx, ty);
      state.autoRouteIdx = 0;
      state.autoRouteKey = key;
    }
    let wp = state.autoRoute[state.autoRouteIdx];
    while (wp && dist(car.x, car.y, wp.x, wp.y) < 50 && state.autoRouteIdx < state.autoRoute.length - 1) {
      state.autoRouteIdx += 1;
      wp = state.autoRoute[state.autoRouteIdx];
    }
    const wx = wp ? wp.x : tx;
    const wy = wp ? wp.y : ty;
    const desired = Math.atan2(wy - car.y, wx - car.x);
    const diff = angleDiff(car.angle, desired);
    input.y = -1; // throttle (forward)
    input.x = Math.max(-1, Math.min(1, diff * 2.2));
    if (Math.abs(diff) > 2.4) input.y = 0.4;
    // Brake for the car ahead instead of rear-ending it.
    for (const other of state.cars) {
      if (other === car || other.dead) continue;
      const ox = other.x - car.x;
      const oy = other.y - car.y;
      const along = ox * Math.cos(car.angle) + oy * Math.sin(car.angle);
      const side = Math.abs(-ox * Math.sin(car.angle) + oy * Math.cos(car.angle));
      if (along > 0 && along < 110 && side < 30) { input.y = 0.5; break; }
    }
    if (dist(car.x, car.y, tx, ty) < 120) input.y = 0.2;
    return input;
  }

  // ---- The step -------------------------------------------------------------
  function step(dt, input) {
    let events = EVENT_NONE;
    state.time += dt;
    state.playSeconds += dt;
    state.timeOfDay = (state.timeOfDay + dt / 240) % 1;
    const p = state.player;
    if (p.invuln > 0) p.invuln -= dt;

    if (state.shopOpen) {
      // The world waits while the player shops.
      return events;
    }

    const ctl = state.autopilot ? computeAutopilot() : input;

    // --- Player on foot ---
    if (p.onFoot) {
      const speed = ctl.shift ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
      const mag = Math.hypot(ctl.x, ctl.y);
      if (mag > 0.01) {
        const nx = p.x + (ctl.x / Math.max(1, mag)) * speed * dt;
        const ny = p.y + (ctl.y / Math.max(1, mag)) * speed * dt;
        p.x = nx;
        p.y = ny;
        p.angle = Math.atan2(ctl.y, ctl.x);
        p.speed = speed;
      } else {
        p.speed = 0;
      }
      collideBuildings(city, p);
      p.x = Math.max(16, Math.min(WORLD.width - 16, p.x));
      p.y = Math.max(16, Math.min(WORLD.height - 16, p.y));
      if (ctl.interact) events |= tryInteract();
      if (ctl.punch) { tryPunch(); }
      if (ctl.shoot && ctl.mouseWorld) { tryShoot(ctl.mouseWorld); }
      // Busted: a cruiser sits on you.
      if (state.wanted >= 2) {
        let near = false;
        for (const car of state.cars) {
          if (car.kind === 'police' && !car.dead && dist(p.x, p.y, car.x, car.y) < 40) { near = true; break; }
        }
        p.busted = near ? p.busted + dt : 0;
        if (p.busted > 1.5) {
          state.over = true;
          state.overReason = 'BUSTED';
          state.stats.deaths += 1;
          save();
          events |= EVENT_OVER;
          return events;
        }
      } else {
        p.busted = 0;
      }
    } else {
      // --- Player driving ---
      const car = p.car;
      if (!car || car.dead) {
        p.car = null;
        p.onFoot = true;
      } else {
        const model = car.model;
        const offroad = onRoad(car.x, car.y) ? 1 : 0.55;
        const accel = model.accel * offroad;
        // ctl.y: -1 forward, +1 brake/reverse. ctl.x: steering -1..1.
        if (ctl.y < 0) car.speed += accel * dt;
        else if (ctl.y > 0) {
          if (car.speed > 20) car.speed -= accel * 1.6 * dt;
          else car.speed -= accel * 0.5 * dt;
        }
        if (ctl.space) car.speed -= car.speed * 2.2 * dt; // handbrake
        car.speed -= car.speed * 0.35 * dt; // drag
        car.speed = Math.max(-170, Math.min(model.maxSpeed * offroad, car.speed));
        const steer = ctl.x * model.turn * (car.speed >= 0 ? 1 : -1) * Math.min(1, Math.abs(car.speed) / 120);
        car.angle += steer * dt;
        const nx = car.x + Math.cos(car.angle) * car.speed * dt;
        const ny = car.y + Math.sin(car.angle) * car.speed * dt;
        car.x = nx;
        car.y = ny;
        p.x = car.x;
        p.y = car.y;
        p.angle = car.angle;
        p.speed = Math.abs(car.speed);
        const hitWall = collideBuildings(city, { x: car.x, y: car.y, radius: 20 });
        if (hitWall && Math.abs(car.speed) > 120) {
          car.hp -= 6;
          car.speed *= -0.35;
          addParticles(car.x, car.y, 6, '#f39c12', 140);
          events |= hurtPlayer(0, 'WASTED'); // no-op damage, keeps invuln logic simple
          if (car.hp <= 0) explodeCar(car);
        }
        car.x = Math.max(20, Math.min(WORLD.width - 20, car.x));
        car.y = Math.max(20, Math.min(WORLD.height - 20, car.y));
        p.x = car.x;
        p.y = car.y;
        if (ctl.interact) events |= tryInteract();
        // Exhaust puffs while moving.
        if (Math.abs(car.speed) > 60 && Math.random() < 0.3) {
          addParticles(car.x - Math.cos(car.angle) * 22, car.y - Math.sin(car.angle) * 22, 1, 'rgba(200,200,200,0.5)', 30);
        }
      }
    }

    // --- Traffic ---
    for (const car of state.cars) {
      if (car.dead || car.kind !== 'traffic') continue;
      const dx = car.tx - car.x;
      const dy = car.ty - car.y;
      const d = Math.hypot(dx, dy);
      if (d < 8) {
        pickNextWaypoint(car);
        continue;
      }
      // Slow down for the car ahead.
      let ahead = false;
      for (const other of state.cars) {
        if (other === car || other.dead) continue;
        const ox = other.x - car.x;
        const oy = other.y - car.y;
        const along = ox * Math.cos(car.angle) + oy * Math.sin(car.angle);
        const side = Math.abs(-ox * Math.sin(car.angle) + oy * Math.cos(car.angle));
        if (along > 0 && along < 64 && side < 26) { ahead = true; break; }
      }
      const targetSpeed = ahead ? 0 : car.cruise;
      car.speed += (targetSpeed - car.speed) * Math.min(1, dt * 1.5);
      const desired = Math.atan2(dy, dx);
      car.angle += angleDiff(car.angle, desired) * Math.min(1, dt * 4);
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      collideBuildings(city, { x: car.x, y: car.y, radius: 18 });
    }

    // --- Pedestrians ---
    for (const ped of state.peds) {
      if (ped.dead) continue;
      if (ped.down > 0) { ped.down -= dt; continue; }
      let tx = ped.tx;
      let ty = ped.ty;
      let speed = ped.speed;
      if (ped.flee > 0) {
        ped.flee -= dt;
        if (state.threat) {
          const a = Math.atan2(ped.y - state.threat.y, ped.x - state.threat.x);
          tx = ped.x + Math.cos(a) * 100;
          ty = ped.y + Math.sin(a) * 100;
          speed = 170;
        }
      } else {
        // Flee fast cars and gunfire.
        if (state.threat && state.time < state.threat.until && dist(ped.x, ped.y, state.threat.x, state.threat.y) < 260) {
          ped.flee = 2;
        }
        const pc = state.player.car;
        if (pc && Math.abs(pc.speed) > 200 && dist(ped.x, ped.y, pc.x, pc.y) < 90) ped.flee = 1.5;
      }
      const dx = tx - ped.x;
      const dy = ty - ped.y;
      const d = Math.hypot(dx, dy);
      if (d < 10) {
        const np = randomSidewalkPoint();
        ped.tx = np.x;
        ped.ty = np.y;
        continue;
      }
      ped.angle = Math.atan2(dy, dx);
      ped.x += (dx / d) * speed * dt;
      ped.y += (dy / d) * speed * dt;
      collideBuildings(city, { x: ped.x, y: ped.y, radius: 10 });
    }
    state.peds = state.peds.filter((ped) => !ped.dead || ped.down > 0);
    // Top the pedestrians back up.
    while (state.peds.length < PED_COUNT) {
      const np = randomSidewalkPoint();
      if (dist(np.x, np.y, p.x, p.y) > 500) state.peds.push(makePed(random, np.x, np.y));
      else break;
    }

    // --- Car vs car / car vs ped collisions ---
    const cars = state.cars;
    for (let i = 0; i < cars.length; i += 1) {
      const a = cars[i];
      if (a.dead) continue;
      for (let j = i + 1; j < cars.length; j += 1) {
        const b = cars[j];
        if (b.dead) continue;
        const d = dist(a.x, a.y, b.x, b.y);
        if (d < 40 && d > 0.01) {
          const push = (40 - d) / 2;
          const nx = (b.x - a.x) / d;
          const ny = (b.y - a.y) / d;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
          const impact = Math.abs(a.speed - b.speed);
          if (impact > 200) {
            a.hp -= 4;
            b.hp -= 4;
            addParticles((a.x + b.x) / 2, (a.y + b.y) / 2, 6, '#f39c12', 120);
            if (a === p.car || b === p.car) events |= hurtPlayer(4, 'WASTED');
            if (a.hp <= 0) explodeCar(a);
            if (b.hp <= 0) explodeCar(b);
          }
          const tmp = a.speed;
          a.speed = b.speed * 0.4;
          b.speed = tmp * 0.4;
        }
      }
      // Player car vs pedestrians.
      if (a === p.car && Math.abs(a.speed) > 60) {
        for (const ped of state.peds) {
          if (ped.dead || ped.down > 0) continue;
          if (dist(a.x, a.y, ped.x, ped.y) < 30) {
            ped.dead = true;
            ped.down = 2;
            addParticles(ped.x, ped.y, 10, '#e5534b', 180);
            state.stats.pedsHit += 1;
            events |= addWanted(1, 'Hit a pedestrian');
          }
        }
      }
    }
    state.cars = state.cars.filter((c) => !c.dead);
    // Keep traffic topped up.
    let trafficCount = state.cars.filter((c) => c.kind === 'traffic').length;
    while (trafficCount < TRAFFIC_COUNT) {
      spawnTraffic(false);
      trafficCount += 1;
    }

    // --- Police ---
    const police = state.cars.filter((c) => c.kind === 'police' && !c.dead);
    const wantPolice = state.wanted === 0 ? 0 : Math.min(MAX_POLICE, state.wanted + (state.wanted >= 4 ? 1 : 0));
    if (police.length < wantPolice) spawnPolice();
    // Roadblocks at 3+ stars: two cruisers parked across the road ahead.
    if (state.wanted >= 3 && state.roadblocks < state.wanted - 2) {
      state.roadblocks = state.wanted - 2;
      const ahead = p.angle;
      const bx = p.x + Math.cos(ahead) * 420;
      const by = p.y + Math.sin(ahead) * 420;
      const s = snapToRoad(bx, by);
      for (const off of [-30, 30]) {
        const car = makeCar(CAR_MODELS[4], s.x + off, s.y, ahead + Math.PI / 2, '#1a3a5c', 'police');
        car.speed = 0;
        state.cars.push(car);
      }
      say('ROADBLOCK AHEAD!', 3);
    }
    if (state.wanted === 0) state.roadblocks = 0;
    let policeNear = false;
    for (const cop of police) {
      const d = dist(cop.x, cop.y, p.x, p.y);
      if (d < WANTED.sightRange) policeNear = true;
      if (cop.ramCd > 0) cop.ramCd -= dt;
      if (d < 700) {
        // Chase along the road grid; steer straight at the player only up close.
        let desired;
        if (d < 170) {
          desired = Math.atan2(p.y - cop.y, p.x - cop.x);
        } else {
          if (!cop.route || state.time - (cop.routeAt || 0) > 1.5 || cop.routeIdx >= cop.route.length) {
            cop.route = routeWaypoints(cop.x, cop.y, p.x, p.y);
            cop.routeIdx = 0;
            cop.routeAt = state.time;
          }
          let wp = cop.route[cop.routeIdx];
          while (wp && dist(cop.x, cop.y, wp.x, wp.y) < 50 && cop.routeIdx < cop.route.length - 1) {
            cop.routeIdx += 1;
            wp = cop.route[cop.routeIdx];
          }
          desired = Math.atan2((wp ? wp.y : p.y) - cop.y, (wp ? wp.x : p.x) - cop.x);
        }
        cop.angle += angleDiff(cop.angle, desired) * Math.min(1, dt * 3.2);
        const targetSpeed = Math.min(cop.model.maxSpeed, (p.car ? Math.abs(p.car.speed) : 0) + 60);
        cop.speed += (targetSpeed - cop.speed) * Math.min(1, dt * 1.2);
        cop.x += Math.cos(cop.angle) * cop.speed * dt;
        cop.y += Math.sin(cop.angle) * cop.speed * dt;
        collideBuildings(city, { x: cop.x, y: cop.y, radius: 18 });
        // Ram damage: one hit per cooldown, not a per-second drain.
        if (d < 42 && p.car && cop.ramCd <= 0) {
          cop.ramCd = 1.2;
          p.car.hp -= 4;
          events |= hurtPlayer(2, 'WASTED');
          if (p.car.hp <= 0) explodeCar(p.car);
        }
        // Cops shoot at 3+ stars.
        if (state.wanted >= 3 && d < 420 && Math.random() < dt * 0.45) {
          addParticles(p.x, p.y, 3, '#ffd76a', 120);
          if (Math.random() < 0.25) events |= hurtPlayer(5, 'WASTED');
        }
      } else {
        // Too far: cruise toward the player's neighbourhood along the roads.
        if (!cop.route || state.time - (cop.routeAt || 0) > 1.5 || cop.routeIdx >= cop.route.length) {
          cop.route = routeWaypoints(cop.x, cop.y, p.x, p.y);
          cop.routeIdx = 0;
          cop.routeAt = state.time;
        }
        let wp = cop.route[cop.routeIdx];
        while (wp && dist(cop.x, cop.y, wp.x, wp.y) < 50 && cop.routeIdx < cop.route.length - 1) {
          cop.routeIdx += 1;
          wp = cop.route[cop.routeIdx];
        }
        const desired = Math.atan2((wp ? wp.y : p.y) - cop.y, (wp ? wp.x : p.x) - cop.x);
        cop.angle += angleDiff(cop.angle, desired) * Math.min(1, dt * 2);
        cop.speed += (300 - cop.speed) * Math.min(1, dt);
        cop.x += Math.cos(cop.angle) * cop.speed * dt;
        cop.y += Math.sin(cop.angle) * cop.speed * dt;
        collideBuildings(city, { x: cop.x, y: cop.y, radius: 18 });
      }
    }
    state.policeNear = policeNear;

    // --- Wanted decay ---
    const inSafehouse = dist(p.x, p.y, SAFEHOUSE.x, SAFEHOUSE.y) < 170;
    if (state.wanted > 0) {
      const seen = policeNear && !inSafehouse;
      if (seen) {
        state.unseenTimer = 0;
      } else {
        state.unseenTimer += dt * (inSafehouse ? 3 : 1);
        if (state.unseenTimer > WANTED.decayDelay) {
          const drop = Math.floor((state.unseenTimer - WANTED.decayDelay) / WANTED.decayPerStar);
          if (drop > 0) {
            const before = state.wanted;
            state.wanted = Math.max(0, state.wanted - drop);
            state.unseenTimer = WANTED.decayDelay;
            if (state.wanted < before) {
              if (state.wanted === 0) {
                state.stats.copsLost += 1;
                say('You lost the cops.', 3);
              }
              events |= EVENT_WANTED;
            }
          }
        }
      }
    }

    // --- Health regen ---
    if (state.wanted === 0 && state.time - p.lastHurt > 5 && p.hp < PLAYER.hp) {
      p.hp = Math.min(PLAYER.hp, p.hp + 2 * dt);
    }

    // --- Mission progress ---
    if (state.mission <= 6 && !state.over && !state.victory) {
      const t = missionTarget();
      if (state.mission === 3 && state.missionTimer > 0) {
        state.missionTimer -= dt;
        if (state.missionTimer <= 0) {
          failMission('Out of time on the Taxi Rush');
          return events;
        }
      }
      if (t) {
        if (t.special === 'wanted3') {
          if (state.wanted >= 3) {
            t.done = true;
            state.missionStage = 1;
            say('3 stars! Now lose them at the safehouse.', 4);
          }
        } else if (t.special === 'lose' || t.special === 'lose4') {
          const need = t.special === 'lose4' ? 4 : 3;
          if (state.missionStage === 1 && state.wanted === 0 && inSafehouse && state.stats.copsLost >= 0) {
            // Only counts once the heat was actually raised this mission.
            if (state.missionHeatReached) {
              t.done = true;
              events |= completeMission();
              return events;
            }
          }
          if (state.wanted >= need) state.missionHeatReached = true;
        } else if (dist(p.x, p.y, t.x, t.y) < t.r) {
          t.done = true;
          if (state.mission === 3 && state.missionStage === 0) {
            // Pickup handled by interact; reaching the marker alone does nothing.
            t.done = false;
          } else if (state.mission === 2 && state.missionStage === 0) {
            t.done = false; // must steal the car with E
          } else {
            state.missionStage += 1;
            if (state.mission === 6 && state.missionStage === 1) {
              // Bank hit: grab the cash, heat jumps to 4.
              state.wanted = 4;
              state.missionHeatReached = true;
              earn(500, 'bank cash');
              say('BANK HIT! 4 stars — lose them at the safehouse!', 4);
              return events;
            }
            if (!missionTarget()) {
              events |= completeMission();
              return events;
            }
            if (state.mission === 5) say(`Stash ${state.missionStage} of 3 collected.`, 3);
          }
        }
      }
    }

    // --- Side jobs: taxi fares and courier packages ---
    if (!state.taxi && state.mission !== 3 && Math.random() < dt * 0.04) {
      const np = snapToRoad(range(random, 300, WORLD.width - 100), range(random, 300, WORLD.height - 100));
      const dest = snapToRoad(range(random, 300, WORLD.width - 100), range(random, 300, WORLD.height - 100));
      if (dist(np.x, np.y, dest.x, dest.y) > 600) {
        state.taxi = { px: np.x, py: np.y, dx: dest.x, dy: dest.y, fare: ECONOMY.taxiFareMin + Math.floor(random() * (ECONOMY.taxiFareMax - ECONOMY.taxiFareMin)), stage: 0 };
        say('A fare is waiting — look for the cyan marker.', 4);
      }
    }
    if (state.taxi && state.taxi.stage === 1 && dist(p.x, p.y, state.taxi.dx, state.taxi.dy) < 80) {
      const fare = state.taxi.fare;
      state.taxi = null;
      state.stats.taxisDone += 1;
      events |= earn(fare, 'taxi fare');
      say(`Fare delivered: +$${fare}.`, 3);
    }
    for (const pkg of state.packages) {
      if (!pkg.taken && dist(p.x, p.y, pkg.x, pkg.y) < 46) {
        pkg.taken = true;
        state.stats.packages += 1;
        events |= earn(ECONOMY.packagePay, 'courier');
        spawnPackage();
      }
    }
    state.packages = state.packages.filter((pkg) => !pkg.taken);

    // --- Particles and floats ---
    for (const pt of state.particles) {
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.96;
      pt.vy *= 0.96;
    }
    state.particles = state.particles.filter((pt) => pt.life > 0);
    for (const f of state.floats) {
      f.life -= dt;
      f.y -= 24 * dt;
    }
    state.floats = state.floats.filter((f) => f.life > 0);

    if (state.time > state.messageUntil) state.message = '';
    return events;
  }

  setupMission(Math.min(state.mission, 6));

  return {
    state, city, step, save, buy, shopItems, setupMission, spawnPoliceAt,
    missionTarget, districtAt, addWanted, say, earn,
    get policeNear() { return !!state.policeNear; },
  };
}
