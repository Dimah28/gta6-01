// The city of Solmar Bay: a seeded grid of roads, named districts, buildings,
// parks and the beach. Everything here is pure data derived from the seed, so
// the same seed always builds the same city.

import { DISTRICTS, PALETTE, ROADS_X, ROADS_Y, ROAD_W, WORLD } from './config.js';
import { pick, range } from './random.js';

export function districtAt(x, y) {
  for (const d of DISTRICTS) {
    if (x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) return d;
  }
  return DISTRICTS[0];
}

export function nearestRoadX(x) {
  let best = ROADS_X[0];
  for (const rx of ROADS_X) if (Math.abs(rx - x) < Math.abs(best - x)) best = rx;
  return best;
}

export function nearestRoadY(y) {
  let best = ROADS_Y[0];
  for (const ry of ROADS_Y) if (Math.abs(ry - y) < Math.abs(best - y)) best = ry;
  return best;
}

/** True when the point is on a road (or the beach strip, which is drivable). */
export function onRoad(x, y) {
  if (x < 200) return true; // beach strip
  for (const rx of ROADS_X) if (Math.abs(x - rx) < ROAD_W / 2) return true;
  for (const ry of ROADS_Y) if (Math.abs(y - ry) < ROAD_W / 2) return true;
  return false;
}

/** Snap a point to the centre of the nearest road. */
export function snapToRoad(x, y) {
  const dx = Math.abs(x - nearestRoadX(x));
  const dy = Math.abs(y - nearestRoadY(y));
  if (dx <= dy) return { x: nearestRoadX(x), y };
  return { x, y: nearestRoadY(y) };
}

/**
 * A new sidewalk stroll target on the SAME sidewalk as (x, y): keep the
 * offset axis and vary along the road within the current block, so a
 * pedestrian never jaywalks straight across a road into traffic (which was
 * feeding the wanted level every few seconds of driving).
 */
export function nextSidewalkPoint(random, x, y) {
  const rx = nearestRoadX(x);
  const ry = nearestRoadY(y);
  // The sidewalk is the axis whose offset is ~58px from its road; the other
  // axis is just "along the road". Comparing raw distances misclassifies
  // corners (a point 58px east of one road and 20px south of another is a
  // vertical-road sidewalk, not a horizontal one) and sends the ped walking
  // down the middle of a road.
  const dx = Math.abs(x - rx);
  const dy = Math.abs(y - ry);
  if (Math.abs(dx - 58) <= Math.abs(dy - 58)) {
    // Beside a vertical road (x = rx +/- 58): keep x, stroll in y.
    let iy = 0;
    for (let i = 0; i < ROADS_Y.length - 1; i += 1) {
      if (ROADS_Y[i] <= y) iy = i;
      else break;
    }
    const y0 = ROADS_Y[iy] + 70;
    const y1 = ROADS_Y[iy + 1] - 70;
    if (y1 <= y0) return { x, y };
    return { x, y: range(random, y0, y1) };
  }
  // Beside a horizontal road (y = ry +/- 58): keep y, stroll in x.
  let ix = 0;
  for (let i = 0; i < ROADS_X.length - 1; i += 1) {
    if (ROADS_X[i] <= x) ix = i;
    else break;
  }
  const x0 = ROADS_X[ix] + 70;
  const x1 = ROADS_X[ix + 1] - 70;
  if (x1 <= x0) return { x, y };
  return { x: range(random, x0, x1), y };
}

export function createCity(random) {
  const buildings = [];
  const trees = [];
  const parks = [];
  const lots = [];
  const half = ROAD_W / 2 + 14;

  // Blocks are the rectangles between neighbouring roads.
  for (let ix = 0; ix < ROADS_X.length - 1; ix += 1) {
    for (let iy = 0; iy < ROADS_Y.length - 1; iy += 1) {
      const x0 = ROADS_X[ix] + half;
      const x1 = ROADS_X[ix + 1] - half;
      const y0 = ROADS_Y[iy] + half;
      const y1 = ROADS_Y[iy + 1] - half;
      const w = x1 - x0;
      const h = y1 - y0;
      if (w < 60 || h < 60) continue;
      const roll = random();
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const district = districtAt(cx, cy);
      // The docks block in Harbor is always a parking lot: the mission car waits there.
      const isDocks = ix === 0 && iy === 2;
      if (isDocks) {
        lots.push({ x: x0, y: y0, width: w, height: h });
        continue;
      }
      if (roll < 0.16) {
        // A park: grass, trees and a pond.
        parks.push({ x: x0, y: y0, width: w, height: h });
        const n = 4 + Math.floor(random() * 5);
        for (let i = 0; i < n; i += 1) {
          trees.push({ x: range(random, x0 + 14, x1 - 14), y: range(random, y0 + 14, y1 - 14), r: 9 + random() * 7 });
        }
        continue;
      }
      if (roll < 0.22) {
        // An empty lot: a parking area with painted bays.
        lots.push({ x: x0, y: y0, width: w, height: h });
        continue;
      }
      // One or two buildings per block.
      const split = random() < 0.45 && w > 200;
      const parts = split
        ? [
            { x: x0, y: y0, width: w / 2 - 8, height: h },
            { x: x0 + w / 2 + 8, y: y0, width: w / 2 - 8, height: h },
          ]
        : [{ x: x0, y: y0, width: w, height: h }];
      for (const p of parts) {
        const tall = district.name === 'DOWNTOWN' && random() < 0.5;
        buildings.push({
          x: p.x, y: p.y, width: p.width, height: p.height,
          color: pick(random, PALETTE.building),
          tall,
          windows: Math.floor(p.width / 26) * Math.floor(p.height / 30),
        });
      }
      // Street trees along the block edge.
      if (random() < 0.6) {
        trees.push({ x: x0 + 10, y: y0 + 10, r: 8 + random() * 5 });
        trees.push({ x: x1 - 10, y: y1 - 10, r: 8 + random() * 5 });
      }
    }
  }

  // Beach palms along the sand strip.
  for (let y = 120; y < WORLD.height; y += 130) {
    if (random() < 0.7) trees.push({ x: 130 + random() * 40, y: y + random() * 60, r: 10 + random() * 5, palm: true });
  }

  return { buildings, trees, parks, lots };
}

/** Push a circle out of every building it overlaps; returns true on a hit. */
export function collideBuildings(city, circle) {
  let hit = false;
  for (const b of city.buildings) {
    const nx = Math.max(b.x, Math.min(circle.x, b.x + b.width));
    const ny = Math.max(b.y, Math.min(circle.y, b.y + b.height));
    const dx = circle.x - nx;
    const dy = circle.y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 < circle.radius * circle.radius) {
      hit = true;
      if (d2 > 0.01) {
        const d = Math.sqrt(d2);
        circle.x = nx + (dx / d) * circle.radius;
        circle.y = ny + (dy / d) * circle.radius;
      } else {
        circle.x += circle.radius;
      }
    }
  }
  return hit;
}

/**
 * A route over the road grid: breadth-first search over the intersections,
 * so cars drive along roads instead of cutting through blocks. Returns the
 * intersections to drive through, ending at the exact destination.
 */
export function routeWaypoints(fx, fy, tx, ty) {
  const xs = ROADS_X;
  const ys = ROADS_Y;
  function nearestIndex(v, arr) {
    let best = 0;
    for (let i = 1; i < arr.length; i += 1) {
      if (Math.abs(arr[i] - v) < Math.abs(arr[best] - v)) best = i;
    }
    return best;
  }
  const sx = nearestIndex(fx, xs);
  const sy = nearestIndex(fy, ys);
  const gx = nearestIndex(tx, xs);
  const gy = nearestIndex(ty, ys);
  const key = (a, b) => `${a},${b}`;
  const prev = new Map();
  const queue = [[sx, sy]];
  prev.set(key(sx, sy), null);
  while (queue.length > 0) {
    const [cx, cy] = queue.shift();
    if (cx === gx && cy === gy) break;
    const neighbours = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
    for (const [nx, ny] of neighbours) {
      if (nx < 0 || ny < 0 || nx >= xs.length || ny >= ys.length) continue;
      if (prev.has(key(nx, ny))) continue;
      prev.set(key(nx, ny), [cx, cy]);
      queue.push([nx, ny]);
    }
  }
  if (!prev.has(key(gx, gy))) return [{ x: tx, y: ty }];
  const path = [];
  let cur = [gx, gy];
  while (cur) {
    path.unshift({ x: xs[cur[0]], y: ys[cur[1]] });
    cur = prev.get(key(cur[0], cur[1]));
  }
  path.push({ x: tx, y: ty });
  return path;
}
