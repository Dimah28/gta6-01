// Solmar Bay in 3D — Three.js renderer + DOM HUD.
//
// The world sim still lives in 2D (x, y) coordinates; this file maps them to
// three.js as (x, 0, y) with Y up. Performance rules for headless SwiftShader:
// pixelRatio 1, no shadow maps, no EffectComposer (ACES tone mapping + fog +
// a CSS vignette + additive glow sprites do the filmic work instead), the
// whole ground painted into ONE canvas texture on ONE plane, buildings and
// trees as InstancedMesh, every car/ped merged into ONE mesh each.

import * as THREE from './vendor/three.module.min.js';
import { BANK, CAMERA, DISTRICTS, GARAGE, MISSIONS, PALETTE, ROADS_X, ROADS_Y, ROAD_W, SAFEHOUSE, VIEW, WORLD } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_BRIEF = 'brief';
export const SCREEN_SHOP = 'shop';
export const SCREEN_VICTORY = 'victory';

const MINI = { x: VIEW.width - 244, y: VIEW.height - 184, w: 220, h: 160 };
const MAX_PARTICLES = 400;
const TAU = Math.PI * 2;

// GSAP is loaded as a classic script before the module; every tween degrades
// to an instant set when it is missing, so the game never depends on it.
const G = (typeof window !== 'undefined' && window.gsap) || null;

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Day factor: 0 = noon, 1 = midnight. Day runs 0.25..0.70 of the cycle. */
function nightFactor(timeOfDay) {
  const t = timeOfDay;
  if (t >= 0.25 && t <= 0.7) return 0;
  if (t < 0.25) return Math.min(0.42, (0.25 - t) * 2.4);
  return Math.min(0.42, (t - 0.7) * 2.4);
}

const SKY_STOPS = [
  [0.0, '#0a0e28'], [0.2, '#1c2340'], [0.25, '#ff9a5c'], [0.32, '#87b5d6'],
  [0.6, '#8fc3e8'], [0.7, '#ff8a4d'], [0.78, '#141a38'], [1.0, '#0a0e28'],
];

function skyColor(timeOfDay) {
  let a = SKY_STOPS[0];
  let b = SKY_STOPS[SKY_STOPS.length - 1];
  for (let i = 0; i < SKY_STOPS.length - 1; i += 1) {
    if (timeOfDay >= SKY_STOPS[i][0] && timeOfDay <= SKY_STOPS[i + 1][0]) {
      a = SKY_STOPS[i];
      b = SKY_STOPS[i + 1];
      break;
    }
  }
  const t = (timeOfDay - a[0]) / Math.max(0.001, b[0] - a[0]);
  const ca = hexRgb(a[1]);
  const cb = hexRgb(b[1]);
  return new THREE.Color(lerp(ca.r, cb.r, t), lerp(ca.g, cb.g, t), lerp(ca.b, cb.b, t));
}

// ---- Geometry helpers: merge coloured boxes/cylinders into one mesh --------
function partBox(w, h, d, x, y, z, color, ry) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Matrix4();
  if (ry) m.makeRotationY(ry);
  m.setPosition(x, y, z);
  g.applyMatrix4(m);
  return { geo: g, color };
}

function partCyl(rt, rb, h, x, y, z, color, rx) {
  const g = new THREE.CylinderGeometry(rt, rb, h, 10);
  const m = new THREE.Matrix4();
  if (rx) m.makeRotationX(rx);
  m.setPosition(x, y, z);
  g.applyMatrix4(m);
  return { geo: g, color };
}

function partSphere(r, x, y, z, color, wSeg) {
  const g = new THREE.SphereGeometry(r, wSeg || 10, 8);
  const m = new THREE.Matrix4();
  m.setPosition(x, y, z);
  g.applyMatrix4(m);
  return { geo: g, color };
}

function mergeParts(parts) {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  let offset = 0;
  const color = new THREE.Color();
  for (const part of parts) {
    const geo = part.geo;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const idx = geo.index;
    color.set(part.color);
    for (let i = 0; i < pos.count; i += 1) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      colors.push(color.r, color.g, color.b);
    }
    for (let i = 0; i < idx.count; i += 1) indices.push(idx.getX(i) + offset);
    offset += pos.count;
    geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  out.setIndex(indices);
  return out;
}

// ---- Canvas textures --------------------------------------------------------
function makeGroundTexture(city) {
  const W = 2048;
  const H = 1536;
  const s = W / WORLD.width; // 0.64 px per world unit
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  const X = (wx) => wx * s;
  const Y = (wy) => wy * s;
  // Grass base with a little patch noise.
  c.fillStyle = PALETTE.grass;
  c.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i += 1) {
    const px = ((i * 7919) % W);
    const py = ((i * 104729) % H);
    c.fillStyle = i % 2 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.03)';
    c.fillRect(px, py, 26, 18);
  }
  // District tints.
  for (const d of DISTRICTS) {
    c.fillStyle = d.tint;
    c.globalAlpha = 0.16;
    c.fillRect(X(d.x0), Y(d.y0), X(d.x1 - d.x0), Y(d.y1 - d.y0));
    c.globalAlpha = 1;
  }
  // Parks (+ ponds in every other one).
  city.parks.forEach((park, i) => {
    c.fillStyle = PALETTE.park;
    c.fillRect(X(park.x), Y(park.y), X(park.width), Y(park.height));
    if (i % 2 === 0) {
      c.fillStyle = PALETTE.water;
      c.beginPath();
      c.ellipse(X(park.x + park.width / 2), Y(park.y + park.height / 2), X(park.width / 5), Y(park.height / 5), 0, 0, TAU);
      c.fill();
    }
  });
  // Parking lots with painted bays.
  for (const lot of city.lots || []) {
    c.fillStyle = '#3a3f45';
    c.fillRect(X(lot.x), Y(lot.y), X(lot.width), Y(lot.height));
    c.strokeStyle = 'rgba(242,240,230,0.5)';
    c.lineWidth = 1.5;
    const bays = Math.max(2, Math.floor(lot.width / 46));
    for (let i = 0; i <= bays; i += 1) {
      const bx = X(lot.x + (i * lot.width) / bays);
      c.beginPath();
      c.moveTo(bx, Y(lot.y + 8));
      c.lineTo(bx, Y(lot.y + lot.height - 8));
      c.stroke();
    }
  }
  // Water underlay (west) and sand strip.
  c.fillStyle = PALETTE.water;
  c.fillRect(0, 0, X(100), H);
  c.fillStyle = PALETTE.sand;
  c.fillRect(X(100), 0, X(100), H);
  // Roads.
  c.fillStyle = PALETTE.road;
  for (const rx of ROADS_X) c.fillRect(X(rx - ROAD_W / 2), 0, X(ROAD_W), H);
  for (const ry of ROADS_Y) c.fillRect(0, Y(ry - ROAD_W / 2), W, Y(ROAD_W));
  c.fillRect(X(120), 0, X(80), H); // beach road
  // Lane dashes.
  c.fillStyle = PALETTE.roadLine;
  for (const rx of ROADS_X) {
    for (let y = 0; y < WORLD.height; y += 64) c.fillRect(X(rx - 2), Y(y), X(4), Y(30));
  }
  for (const ry of ROADS_Y) {
    for (let x = 0; x < WORLD.width; x += 64) c.fillRect(X(x), Y(ry - 2), X(30), Y(4));
  }
  // Sidewalks.
  c.fillStyle = PALETTE.sidewalk;
  for (const rx of ROADS_X) {
    c.fillRect(X(rx - ROAD_W / 2 - 10), 0, X(8), H);
    c.fillRect(X(rx + ROAD_W / 2 + 2), 0, X(8), H);
  }
  // District labels, big and faint, like a GTA map.
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = '800 58px system-ui, sans-serif';
  for (const d of DISTRICTS) {
    c.fillStyle = 'rgba(255,255,255,0.16)';
    c.fillText(d.name, X((d.x0 + d.x1) / 2), Y((d.y0 + d.y1) / 2));
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeWindowTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, 256, 256);
  // Dense window grid: small panes, mostly mid-tone glass with a few warm
  // lit ones — from the chase cam they read as windows instead of a
  // checkerboard, and the facade keeps its own colour.
  for (let row = 0; row < 16; row += 1) {
    for (let col = 0; col < 12; col += 1) {
      const lit = (row * 7 + col * 13) % 4 === 0;
      c.fillStyle = lit ? '#ffd76a' : '#565c66';
      c.fillRect(6 + col * 21, 5 + row * 15, 12, 9);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeLabelSprite(text, color) {
  const cv = document.createElement('canvas');
  const c = cv.getContext('2d');
  c.font = '800 44px system-ui, sans-serif';
  const w = Math.ceil(c.measureText(text).width) + 36;
  cv.width = w;
  cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.font = '800 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(10,14,20,0.75)';
  ctx.beginPath();
  ctx.roundRect(2, 4, w - 4, 56, 14);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(w * 0.2, 64 * 0.2, 1);
  return sprite;
}

function parseColor(c) {
  if (!c) return { r: 1, g: 1, b: 1 };
  if (c[0] === '#') return hexRgb(c);
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) {
    const parts = m[1].split(',').map((v) => parseFloat(v));
    return { r: parts[0] / 255, g: parts[1] / 255, b: parts[2] / 255 };
  }
  return { r: 1, g: 1, b: 1 };
}

export function createRenderer(canvas, hooks) {
  const onShopBuy = (hooks && hooks.onShopBuy) || null;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch (err) {
    throw new Error('WebGL unavailable: ' + (err && err.message ? err.message : err));
  }
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#87b5d6');
  scene.fog = new THREE.Fog('#87b5d6', 700, 2400);

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, 1, 6000);
  camera.position.set(600, 400, 2400);

  // ---- Lights ----------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3a4a2f, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2cc, 1.9);
  sun.position.set(2000, 1200, 800);
  scene.add(sun);

  // The camera's ground-plane footprint, for the minimap viewport rectangle.
  const camFoot = { x: 0, y: 0 };

  // ---- Ground: one textured plane for the whole city --------------------------
  // (city is attached later in buildCity; the ground needs it for the texture)
  let groundTex = null;
  let winTex = null;
  let cityBuilt = false;
  const groundMat = new THREE.MeshLambertMaterial({ color: '#39543d' });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.width, WORLD.height), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(WORLD.width / 2, 0, WORLD.height / 2);
  scene.add(ground);

  // Animated water on the west edge.
  const waterMat = new THREE.MeshLambertMaterial({ color: '#2f6f8f', transparent: true, opacity: 0.92 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(100, WORLD.height), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(50, 1, WORLD.height / 2);
  scene.add(water);

  // Endless sea around the island city: beyond the ground plane the horizon
  // is ocean, never a hard world edge against the sky.
  const seaMat = new THREE.MeshLambertMaterial({ color: '#1d4e6b' });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(WORLD.width / 2, -2, WORLD.height / 2);
  scene.add(sea);

  const cityGroup = new THREE.Group();
  scene.add(cityGroup);

  function buildCity(city) {
    if (cityBuilt) return;
    cityBuilt = true;
    groundTex = makeGroundTexture(city);
    groundMat.map = groundTex;
    groundMat.color.set('#ffffff');
    groundMat.needsUpdate = true;
    winTex = makeWindowTexture();

    // Buildings: one InstancedMesh, per-instance colour, window texture.
    const bGeo = new THREE.BoxGeometry(1, 1, 1);
    bGeo.translate(0, 0.5, 0);
    const bMat = new THREE.MeshLambertMaterial({ map: winTex, emissive: 0xffca7a, emissiveMap: winTex, emissiveIntensity: 0 });
    const bMesh = new THREE.InstancedMesh(bGeo, bMat, city.buildings.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();
    const heights = [];
    city.buildings.forEach((b, i) => {
      const h = b.tall ? 70 + ((b.x * 7 + b.y * 13) % 40) : 24 + ((b.x * 3 + b.y * 11) % 18);
      heights.push(h);
      pos.set(b.x + b.width / 2, 0, b.y + b.height / 2);
      scl.set(b.width, h, b.height);
      m.compose(pos, q, scl);
      bMesh.setMatrixAt(i, m);
      bMesh.setColorAt(i, col.set(b.color));
    });
    if (bMesh.instanceColor) bMesh.instanceColor.needsUpdate = true;
    bMesh.instanceMatrix.needsUpdate = true;
    cityGroup.add(bMesh);
    // Roof caps: flat dark slabs on every roof, so the window texture never
    // shows on top and the skyline reads as rooftops, not checkerboards.
    const capGeo = new THREE.BoxGeometry(1, 2, 1);
    capGeo.translate(0, 1, 0);
    const capMesh = new THREE.InstancedMesh(capGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), city.buildings.length);
    city.buildings.forEach((b, i) => {
      pos.set(b.x + b.width / 2, heights[i], b.y + b.height / 2);
      scl.set(b.width + 2, 1, b.height + 2);
      m.compose(pos, q, scl);
      capMesh.setMatrixAt(i, m);
      capMesh.setColorAt(i, col.set(b.color).multiplyScalar(0.55));
    });
    if (capMesh.instanceColor) capMesh.instanceColor.needsUpdate = true;
    capMesh.instanceMatrix.needsUpdate = true;
    cityGroup.add(capMesh);
    // Antennas on the tall towers.
    const tallIdx = [];
    city.buildings.forEach((b, i) => { if (b.tall) tallIdx.push(i); });
    if (tallIdx.length > 0) {
      const aGeo = new THREE.BoxGeometry(2, 26, 2);
      aGeo.translate(0, 13, 0);
      const aMesh = new THREE.InstancedMesh(aGeo, new THREE.MeshLambertMaterial({ color: '#3a3f45' }), tallIdx.length);
      tallIdx.forEach((bi, j) => {
        const b = city.buildings[bi];
        pos.set(b.x + b.width / 2, heights[bi], b.y + b.height / 2);
        scl.set(1, 1, 1);
        m.compose(pos, q, scl);
        aMesh.setMatrixAt(j, m);
      });
      aMesh.instanceMatrix.needsUpdate = true;
      cityGroup.add(aMesh);
    }
    // Trees + palms: one InstancedMesh, trunk + canopy merged, vertex colours.
    const treeGeo = mergeParts([
      partCyl(3, 4.5, 18, 0, 9, 0, '#5a3d24'),
      partSphere(11, 0, 25, 0, '#2a7a35', 8),
    ]);
    const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const tMesh = new THREE.InstancedMesh(treeGeo, treeMat, city.trees.length);
    city.trees.forEach((t, i) => {
      const s = t.r / 10;
      pos.set(t.x, 0, t.y);
      scl.set(s, t.palm ? s * 1.6 : s, s);
      m.compose(pos, q, scl);
      tMesh.setMatrixAt(i, m);
      tMesh.setColorAt(i, col.set(t.palm ? '#8fb84a' : '#4a9a50'));
    });
    if (tMesh.instanceColor) tMesh.instanceColor.needsUpdate = true;
    tMesh.instanceMatrix.needsUpdate = true;
    cityGroup.add(tMesh);
    // Streetlights along every road.
    const lampSpots = [];
    for (const rx of ROADS_X) {
      for (let y = 150; y < WORLD.height; y += 300) lampSpots.push([rx + 58, y]);
    }
    for (const ry of ROADS_Y) {
      for (let x = 250; x < WORLD.width; x += 300) lampSpots.push([x, ry + 58]);
    }
    const poleGeo = new THREE.CylinderGeometry(1.5, 2, 26, 6);
    poleGeo.translate(0, 13, 0);
    const poleMesh = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: '#22242a' }), lampSpots.length);
    const headGeo = new THREE.SphereGeometry(3, 8, 6);
    headGeo.translate(0, 27, 0);
    const headMat = new THREE.MeshBasicMaterial({ color: '#5a5a5a' });
    const headMesh = new THREE.InstancedMesh(headGeo, headMat, lampSpots.length);
    lampSpots.forEach(([lx, ly], i) => {
      pos.set(lx, 0, ly);
      scl.set(1, 1, 1);
      m.compose(pos, q, scl);
      poleMesh.setMatrixAt(i, m);
      headMesh.setMatrixAt(i, m);
    });
    poleMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
    cityGroup.add(poleMesh);
    cityGroup.add(headMesh);
    cityGroup.userData.buildingMat = bMat;
    cityGroup.userData.headMat = headMat;
  }

  // ---- Shared geometries / materials -----------------------------------------
  const carMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const pedMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
  const shadowGeoCar = new THREE.CircleGeometry(26, 20);
  const shadowGeoPerson = new THREE.CircleGeometry(12, 16);
  const diamondGeo = new THREE.OctahedronGeometry(14);
  const beamGeo = new THREE.CylinderGeometry(4, 4, 140, 8, 1, true);
  const ringGeo = new THREE.RingGeometry(20, 27, 32);
  const labelTextures = new Map();
  function labelTexture(text, color) {
    const key = `${text}|${color}`;
    if (!labelTextures.has(key)) {
      const tex = makeLabelSprite(text, color).material.map;
      labelTextures.set(key, tex);
    }
    return labelTextures.get(key);
  }
  function labelSprite(text, color) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(text, color), transparent: true, depthWrite: false }));
    const tex = labelTexture(text, color);
    sprite.scale.set((tex.image.width || 200) * 0.2, 64 * 0.2, 1);
    return sprite;
  }

  function buildCarGeometry(car) {
    const isPolice = car.kind === 'police';
    const body = isPolice ? '#1a3a5c' : car.color;
    return mergeParts([
      partBox(44, 10, 24, 0, 5, 0, body),
      partBox(20, 8, 20, -2, 13, 0, '#141c26'),
      partBox(10, 2, 22, 2, 10.5, 0, isPolice ? '#f2f0e6' : body),
      partCyl(5, 5, 4, 14, 5, 11, '#111111', Math.PI / 2),
      partCyl(5, 5, 4, 14, 5, -11, '#111111', Math.PI / 2),
      partCyl(5, 5, 4, -14, 5, 11, '#111111', Math.PI / 2),
      partCyl(5, 5, 4, -14, 5, -11, '#111111', Math.PI / 2),
      partBox(2, 3, 5, 22, 6, 8, '#ffe9a8'),
      partBox(2, 3, 5, 22, 6, -8, '#ffe9a8'),
      partBox(2, 3, 5, -22, 6, 8, '#ff3b30'),
      partBox(2, 3, 5, -22, 6, -8, '#ff3b30'),
    ]);
  }

  function buildCarMesh(car) {
    const group = new THREE.Group();
    const shadow = new THREE.Mesh(shadowGeoCar, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.6;
    group.add(shadow);
    const body = new THREE.Mesh(buildCarGeometry(car), carMat);
    group.add(body);
    let lightBar = null;
    if (car.kind === 'police') {
      lightBar = new THREE.Group();
      const red = new THREE.Mesh(new THREE.BoxGeometry(7, 3, 6), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
      red.position.set(-2, 16, -7);
      const blue = new THREE.Mesh(new THREE.BoxGeometry(7, 3, 6), new THREE.MeshBasicMaterial({ color: 0x2f7bff }));
      blue.position.set(-2, 16, 7);
      lightBar.add(red);
      lightBar.add(blue);
      lightBar.userData.red = red;
      lightBar.userData.blue = blue;
      group.add(lightBar);
    }
    let outline = null;
    if (car.kind === 'target') {
      outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(48, 18, 28)),
        new THREE.LineBasicMaterial({ color: 0xf2c94c }),
      );
      outline.position.y = 9;
      group.add(outline);
    }
    scene.add(group);
    return { group, body, lightBar, outline, kind: car.kind, color: car.color };
  }

  const carMeshes = new Map(); // car.id -> mesh record
  function syncCars(state) {
    const seen = new Set();
    for (const car of state.cars) {
      if (car.dead) continue;
      seen.add(car.id);
      let rec = carMeshes.get(car.id);
      if (!rec) {
        rec = buildCarMesh(car);
        carMeshes.set(car.id, rec);
      } else if (rec.kind !== car.kind || rec.color !== car.color) {
        // Kind changed (stolen / target taken): rebuild the body.
        rec.group.remove(rec.body);
        rec.body.geometry.dispose();
        rec.body = new THREE.Mesh(buildCarGeometry(car), carMat);
        rec.group.add(rec.body);
        rec.kind = car.kind;
        rec.color = car.color;
      }
      rec.group.position.set(car.x, 0, car.y);
      rec.group.rotation.y = -car.angle;
      // Body roll on turns + pitch on accel/brake: cheap juice. Turn rate
      // comes from the angle change since the last frame.
      let dA = car.angle - (rec.lastAngle ?? car.angle);
      if (dA > Math.PI) dA -= TAU;
      if (dA < -Math.PI) dA += TAU;
      rec.lastAngle = car.angle;
      rec.body.rotation.x = clamp(dA * 6, -0.06, 0.06);
      rec.body.rotation.z = clamp(-car.speed * 0.00004, -0.03, 0.03);
      if (rec.lightBar) {
        const phase = Math.floor(state.time * 4) % 2 === 0;
        rec.lightBar.userData.red.visible = phase;
        rec.lightBar.userData.blue.visible = !phase;
      }
      if (rec.outline) rec.outline.visible = car.kind === 'target';
    }
    for (const [id, rec] of carMeshes) {
      if (!seen.has(id)) {
        scene.remove(rec.group);
        rec.body.geometry.dispose();
        carMeshes.delete(id);
      }
    }
  }

  // ---- Player on foot ---------------------------------------------------------
  const playerGroup = new THREE.Group();
  const playerShadow = new THREE.Mesh(shadowGeoPerson, shadowMat);
  playerShadow.rotation.x = -Math.PI / 2;
  playerShadow.position.y = 0.6;
  playerGroup.add(playerShadow);
  const legGeoL = mergeParts([partBox(6, 14, 6, 0, -7, 0, '#22242e')]);
  const legGeoR = mergeParts([partBox(6, 14, 6, 0, -7, 0, '#2a2d36')]);
  const legL = new THREE.Mesh(legGeoL, pedMat);
  const legR = new THREE.Mesh(legGeoR, pedMat);
  legL.position.set(-4, 14, 0);
  legR.position.set(4, 14, 0);
  playerGroup.add(legL);
  playerGroup.add(legR);
  const playerBodyGeo = mergeParts([
    partBox(16, 20, 10, 0, 24, 0, '#e5534b'), // red jacket
    partBox(5, 16, 5, -11, 26, 0, '#e5534b'), // arms
    partBox(5, 16, 5, 11, 26, 0, '#e5534b'),
    partBox(8, 3, 3, 12, 19, 6, '#222222'), // pistol in hand
    partSphere(6, 0, 40, 0, '#e8c39a', 10), // head
  ]);
  const playerBody = new THREE.Mesh(playerBodyGeo, pedMat);
  playerGroup.add(playerBody);
  const bustedRing = new THREE.Mesh(
    new THREE.RingGeometry(18, 23, 32),
    new THREE.MeshBasicMaterial({ color: 0xe5534b, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  );
  bustedRing.rotation.x = -Math.PI / 2;
  bustedRing.position.y = 1;
  bustedRing.visible = false;
  playerGroup.add(bustedRing);
  scene.add(playerGroup);

  // ---- Pedestrians ------------------------------------------------------------
  const pedGeos = new Map();
  function pedGeometry(color) {
    if (!pedGeos.has(color)) {
      pedGeos.set(color, mergeParts([
        partBox(14, 18, 9, 0, 21, 0, color),
        partBox(12, 12, 8, 0, 6, 0, '#22242e'),
        partSphere(5.5, 0, 34, 0, '#e8c39a', 10),
      ]));
    }
    return pedGeos.get(color);
  }
  const pedMeshes = new Map(); // ped object -> mesh
  function syncPeds(state) {
    const seen = new Set();
    for (const ped of state.peds) {
      seen.add(ped);
      let mesh = pedMeshes.get(ped);
      if (!mesh) {
        mesh = new THREE.Mesh(pedGeometry(ped.color), pedMat);
        const shadow = new THREE.Mesh(shadowGeoPerson, shadowMat);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = 0.6;
        mesh.add(shadow);
        scene.add(mesh);
        pedMeshes.set(ped, mesh);
      }
      mesh.position.set(ped.x, 0, ped.y);
      if (ped.down > 0) {
        mesh.rotation.set(-Math.PI / 2, 0, 0);
        mesh.position.y = 4;
      } else {
        const phase = state.time * 6 + ped.x * 0.05;
        mesh.rotation.set(0, -ped.angle, 0);
        mesh.position.y = Math.abs(Math.sin(phase)) * 1.5;
      }
    }
    for (const [ped, mesh] of pedMeshes) {
      if (!seen.has(ped)) {
        scene.remove(mesh);
        pedMeshes.delete(ped);
      }
    }
  }

  // ---- Police helicopter ------------------------------------------------------
  const heliGroup = new THREE.Group();
  const heliBodyGeo = mergeParts([
    partBox(44, 14, 20, 0, 0, 0, '#1a3a5c'),
    partBox(46, 4, 21, 0, 3, 0, '#f2f0e6'),
    partBox(36, 6, 6, -38, 2, 0, '#1a3a5c'),
    partBox(2, 14, 8, -54, 6, 0, '#1a3a5c'),
    partBox(30, 2, 2, 0, -10, 8, '#222222'),
    partBox(30, 2, 2, 0, -10, -8, '#222222'),
  ]);
  const heliBody = new THREE.Mesh(heliBodyGeo, carMat);
  heliGroup.add(heliBody);
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(96, 1.5, 7), new THREE.MeshLambertMaterial({ color: '#22242a' }));
  rotor.position.y = 10;
  heliGroup.add(rotor);
  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(1.5, 16, 2), new THREE.MeshLambertMaterial({ color: '#22242a' }));
  tailRotor.position.set(-54, 4, 12);
  heliGroup.add(tailRotor);
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xfff2cc, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(60, 150, 24, 1, true), coneMat);
  cone.position.y = -75;
  heliGroup.add(cone);
  const heliLight = new THREE.SpotLight(0xfff2cc, 0, 700, 0.32, 0.5, 1.2);
  heliLight.position.set(0, 0, 0);
  heliGroup.add(heliLight);
  scene.add(heliLight.target); // world-space target: the player, updated per frame
  heliGroup.visible = false;
  scene.add(heliGroup);

  // ---- Markers (pool of 10) ---------------------------------------------------
  const markerSlots = [];
  for (let i = 0; i < 10; i += 1) {
    const group = new THREE.Group();
    const diamond = new THREE.Mesh(diamondGeo, new THREE.MeshBasicMaterial({ color: 0xf2c94c }));
    diamond.position.y = 18;
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xf2c94c, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 70;
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xf2c94c, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1;
    ring.visible = false;
    const labelHolder = new THREE.Group();
    labelHolder.position.y = 46;
    group.add(diamond);
    group.add(beam);
    group.add(ring);
    group.add(labelHolder);
    group.visible = false;
    scene.add(group);
    markerSlots.push({ group, diamond, beam, ring, labelHolder, labelKey: '' });
  }
  // Fixed place markers: garage / safehouse / bank rings + labels.
  const placeMarkers = [
    { x: GARAGE.x, y: GARAGE.y, color: '#f2c94c', label: 'GARAGE' },
    { x: SAFEHOUSE.x, y: SAFEHOUSE.y, color: '#58c96b', label: 'SAFEHOUSE' },
    { x: BANK.x, y: BANK.y, color: '#e5534b', label: 'BANK' },
  ];
  for (const pm of placeMarkers) {
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(pm.color), transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pm.x, 1, pm.y);
    scene.add(ring);
    const label = labelSprite(pm.label, pm.color);
    label.position.set(pm.x, 44, pm.y);
    scene.add(label);
  }

  function syncMarkers(state) {
    const specs = [];
    for (const t of state.targets) {
      if (!t.done && t.x) specs.push({ x: t.x, y: t.y, color: '#f2c94c', label: t.label || '', beam: true, ring: false });
    }
    for (const pkg of state.packages) specs.push({ x: pkg.x, y: pkg.y, color: '#58c96b', label: '', beam: false, ring: false });
    if (state.taxi) {
      const tx = state.taxi.stage === 0 ? state.taxi.px : state.taxi.dx;
      const ty = state.taxi.stage === 0 ? state.taxi.py : state.taxi.dy;
      specs.push({ x: tx, y: ty, color: '#4fc3f7', label: state.taxi.stage === 0 ? 'FARE' : 'DROP-OFF', beam: true, ring: false });
    }
    markerSlots.forEach((slot, i) => {
      const spec = specs[i];
      if (!spec) {
        slot.group.visible = false;
        slot.labelKey = '';
        return;
      }
      slot.group.visible = true;
      slot.group.position.set(spec.x, 0, spec.y);
      slot.diamond.material.color.set(spec.color);
      slot.diamond.rotation.y = state.time * 1.5;
      slot.diamond.position.y = 18 + Math.sin(state.time * 3 + i) * 4;
      slot.beam.visible = spec.beam;
      slot.beam.material.color.set(spec.color);
      slot.ring.visible = spec.ring;
      const key = spec.label || '';
      if (key !== slot.labelKey) {
        slot.labelKey = key;
        while (slot.labelHolder.children.length > 0) slot.labelHolder.remove(slot.labelHolder.children[0]);
        if (key) slot.labelHolder.add(labelSprite(key, spec.color));
      }
    });
  }

  // ---- Particles: one GPU Points cloud (soft round dots, not squares) -------
  function makeDotTexture() {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 64;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  }
  const pPos = new Float32Array(MAX_PARTICLES * 3);
  const pCol = new Float32Array(MAX_PARTICLES * 3);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pMat = new THREE.PointsMaterial({ size: 6, map: makeDotTexture(), vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);

  function syncParticles(state) {
    const n = Math.min(state.particles.length, MAX_PARTICLES);
    for (let i = 0; i < n; i += 1) {
      const pt = state.particles[i];
      pPos[i * 3] = pt.x;
      pPos[i * 3 + 1] = pt.z || 0;
      pPos[i * 3 + 2] = pt.y;
      const fade = Math.min(1, pt.life * 2);
      const c = parseColor(pt.color);
      pCol[i * 3] = c.r * fade;
      pCol[i * 3 + 1] = c.g * fade;
      pCol[i * 3 + 2] = c.b * fade;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
    pGeo.setDrawRange(0, n);
  }

  // ---- Floating score text: sprite pool ---------------------------------------
  const floatPool = [];
  for (let i = 0; i < 8; i += 1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    s.visible = false;
    scene.add(s);
    floatPool.push({ sprite: s, key: '' });
  }
  function syncFloats(state) {
    floatPool.forEach((slot, i) => {
      const f = state.floats[i];
      if (!f) {
        slot.sprite.visible = false;
        slot.key = '';
        return;
      }
      const key = `${f.text}|${f.color}`;
      if (key !== slot.key) {
        slot.key = key;
        slot.sprite.material.map = labelSprite(f.text, f.color).material.map;
        slot.sprite.material.needsUpdate = true;
      }
      slot.sprite.visible = true;
      slot.sprite.position.set(f.x, (f.z || 26) + 14, f.y);
      slot.sprite.material.opacity = Math.max(0, Math.min(1, f.life / 1.4));
      // Floats are small score popups, not billboards: keep them ~35 units wide.
      const tex = slot.sprite.material.map;
      slot.sprite.scale.set((tex.image.width || 200) * 0.09, 64 * 0.09, 1);
    });
  }

  // ---- HUD (DOM overlay, GSAP-animated) ---------------------------------------
  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.innerHTML = `
    <div id="hud-vignette"></div>
    <div id="hud-tl">
      <div id="hud-stars"></div>
      <div class="bar"><div class="track"><div id="hud-hp-fill"></div></div><span id="hud-hp-text"></span></div>
      <div class="bar thin" id="hud-armor-row"><div class="track"><div id="hud-armor-fill"></div></div><span id="hud-armor-text"></span></div>
    </div>
    <div id="hud-tc">
      <div id="hud-mission-name"></div>
      <div id="hud-mission-obj"></div>
      <div id="hud-mission-timer"></div>
    </div>
    <div id="hud-tr">
      <div id="hud-cash"></div>
      <div id="hud-score"></div>
      <div id="hud-ammo-row">AMMO <span id="hud-ammo"></span></div>
      <div class="bar nos" id="hud-nos-row"><div class="track"><div id="hud-nos-fill"></div></div><span>NOS</span></div>
    </div>
    <div id="hud-bl"></div>
    <div id="hud-br">
      <canvas id="hud-minimap" width="220" height="160"></canvas>
      <div id="hud-radio"></div>
      <div id="hud-maplabel">SOLMAR BAY</div>
    </div>
    <div id="hud-bc">
      <div id="hud-speed"></div>
      <div class="bar carhp"><div class="track"><div id="hud-carhp-fill"></div></div><span id="hud-carhp-text"></span></div>
    </div>
    <div id="hud-toast"></div>
    <div id="hud-panel"></div>
    <div id="hud-tune">
      <div class="tune-title">TUNING — T to close</div>
      <label>Camera distance <input id="tune-dist" type="range" min="150" max="400" value="250"><span id="tune-dist-v">250</span></label>
      <label>Camera height <input id="tune-height" type="range" min="60" max="260" value="145"><span id="tune-height-v">145</span></label>
      <label>Field of view <input id="tune-fov" type="range" min="45" max="80" value="60"><span id="tune-fov-v">60</span></label>
      <label>Time of day <input id="tune-tod" type="range" min="0" max="100" value="32"><span id="tune-tod-v">morning</span></label>
    </div>`;
  document.body.appendChild(hud);
  const el = (id) => hud.querySelector('#' + id);
  const minimap = el('hud-minimap');
  const miniCtx = minimap.getContext('2d');

  // Tuning panel (Tweakpane spirit, hand-rolled): live sliders for the chase
  // camera and the time of day. Visual only — it never touches the sim.
  const tune = { dist: null, height: null, fov: null, tod: null };
  const tuneEl = el('hud-tune');
  function bindTune(id, key, fmt) {
    const input = el(id);
    const out = el(id + '-v');
    input.addEventListener('input', () => {
      const v = Number(input.value);
      tune[key] = v;
      out.textContent = fmt ? fmt(v) : String(v);
    });
  }
  bindTune('tune-dist', 'dist');
  bindTune('tune-height', 'height');
  bindTune('tune-fov', 'fov');
  bindTune('tune-tod', 'tod', (v) => (v < 25 ? 'night' : v < 35 ? 'morning' : v < 70 ? 'day' : v < 78 ? 'sunset' : 'night'));
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyT') {
      tuneEl.classList.toggle('open');
      if (!tuneEl.classList.contains('open')) tune.tod = null;
    }
  });

  const RADIO_TRACKS = ['Midnight Drive', 'Neon Coast', 'Sunset Run', 'Bay Nights'];
  const last = { screen: '', stars: -1, hp: -1, armor: -1, money: -1, score: -1, ammo: -1, nos: -1, mission: '', obj: '', timer: '', hints: '', toast: '', speed: '', carhp: -1, radio: '', shopSig: '', trauma: 0, lastHp: 100, lastCarHp: 100, chaseMix: 0 };
  let walkPhase = 0;
  let lastNow = performance.now();
  const camPos = new THREE.Vector3(600, 400, 2400);
  const camTarget = new THREE.Vector3(1600, 10, 1200);
  const desiredPos = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function setStars(wanted) {
    if (wanted === last.stars) return;
    last.stars = wanted;
    let html = '';
    for (let i = 0; i < 5; i += 1) html += `<span class="${i < wanted ? 'on' : ''}">★</span>`;
    el('hud-stars').innerHTML = html;
    // Star pop: a Lottie-style micro-animation, hand-rolled with GSAP.
    if (G && wanted > 0) G.fromTo('#hud-stars', { scale: 1.35 }, { scale: 1, duration: 0.25, ease: 'back.out(3)' });
  }

  function nearestCar(state) {
    const p = state.player;
    let best = null;
    let bestD = 80;
    for (const car of state.cars) {
      if (car.dead) continue;
      const d = Math.hypot(car.x - p.x, car.y - p.y);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  function drawMinimap(state) {
    const sx = 0;
    const sy = 0;
    const scaleX = MINI.w / WORLD.width;
    const scaleY = MINI.h / WORLD.height;
    miniCtx.clearRect(0, 0, MINI.w, MINI.h);
    miniCtx.fillStyle = 'rgba(10,14,20,0.88)';
    miniCtx.fillRect(sx, sy, MINI.w, MINI.h);
    miniCtx.fillStyle = PALETTE.water;
    miniCtx.fillRect(sx, sy, 100 * scaleX, MINI.h);
    miniCtx.fillStyle = PALETTE.sand;
    miniCtx.fillRect(sx + 100 * scaleX, sy, 100 * scaleX, MINI.h);
    miniCtx.fillStyle = '#24351f';
    miniCtx.fillRect(sx + 200 * scaleX, sy, MINI.w - 200 * scaleX, MINI.h);
    miniCtx.strokeStyle = '#5a6068';
    miniCtx.lineWidth = 3;
    for (const rx of ROADS_X) {
      miniCtx.beginPath();
      miniCtx.moveTo(sx + rx * scaleX, sy);
      miniCtx.lineTo(sx + rx * scaleX, sy + MINI.h);
      miniCtx.stroke();
    }
    for (const ry of ROADS_Y) {
      miniCtx.beginPath();
      miniCtx.moveTo(sx, sy + ry * scaleY);
      miniCtx.lineTo(sx + MINI.w, sy + ry * scaleY);
      miniCtx.stroke();
    }
    function dot(x, y, color, r) {
      miniCtx.fillStyle = color;
      miniCtx.beginPath();
      miniCtx.arc(sx + x * scaleX, sy + y * scaleY, r, 0, TAU);
      miniCtx.fill();
    }
    dot(GARAGE.x, GARAGE.y, '#f2c94c', 3);
    dot(SAFEHOUSE.x, SAFEHOUSE.y, '#58c96b', 3);
    for (const pkg of state.packages) dot(pkg.x, pkg.y, '#58c96b', 2.5);
    if (state.taxi) dot(state.taxi.px, state.taxi.py, '#4fc3f7', 3);
    for (const car of state.cars) {
      if (car.kind === 'police') dot(car.x, car.y, '#2f7bff', 3);
      else if (car.kind === 'target') dot(car.x, car.y, '#e5534b', 3.5);
    }
    const t = state.targets.find((tg) => !tg.done);
    if (t && t.x) {
      const pulse = 3 + Math.sin(state.time * 6) * 1.5;
      dot(t.x, t.y, '#f2c94c', pulse);
    }
    if (state.heli) dot(state.heli.x, state.heli.y, '#ff3b30', 3);
    miniCtx.strokeStyle = '#fff';
    miniCtx.lineWidth = 1.5;
    miniCtx.beginPath();
    miniCtx.arc(sx + state.player.x * scaleX, sy + state.player.y * scaleY, 5, 0, TAU);
    miniCtx.stroke();
    dot(state.player.x, state.player.y, '#fff', 3.5);
    miniCtx.strokeStyle = 'rgba(255,255,255,0.5)';
    miniCtx.lineWidth = 1;
    miniCtx.strokeRect(sx + camFoot.x * scaleX, sy + camFoot.y * scaleY, VIEW.width * scaleX, VIEW.height * scaleY);
  }

  function panelHtml(screen, state, best, shopItems) {
    if (screen === SCREEN_TITLE) {
      const hasSave = state.mission > 1 || state.money > 150;
      return `<div class="panel">
        <h1 class="title">SOLMAR BAY</h1>
        <div class="subtitle">AN OPEN-WORLD CRIME STORY · SIX MISSIONS · ONE CITY THAT NEVER SLEEPS</div>
        <p>GOAL — Run all six missions for Marisol Vega and pull off the Big Score.</p>
        <p>WIN — Finish mission 6 and lose the cops. LOSE — Get wasted or busted.</p>
        <p>Drive, steal cars, dodge a 1–5 star wanted system, take taxi fares,<br>collect courier packages, and spend your cash at the garage.</p>
        <p class="muted">WASD move/drive · SHIFT NOS boost · E enter car / interact · F punch · CLICK shoot · SPACE handbrake<br>P pause · M mute · T tuning · progress saves automatically</p>
        <div class="prompt">${hasSave ? 'ENTER — continue your story · R — start over' : 'Press ENTER or CLICK to start'}</div>
        <div class="best">BEST SCORE ${best.toLocaleString('en-US')}</div>
      </div>`;
    }
    if (screen === SCREEN_BRIEF) {
      const m = MISSIONS[Math.min(state.missionDone, 6) - 1] || MISSIONS[0];
      const next = state.mission <= 6
        ? `Next: ${MISSIONS[state.mission - 1].name} — ${MISSIONS[state.mission - 1].brief}`
        : 'Story complete — free roam unlocked.';
      return `<div class="panel"><h1 class="green">MISSION COMPLETE</h1>
        <p>${m.name} — done. Marisol paid you $${m.pay}.</p>
        <p class="muted">Cash $${state.money.toLocaleString('en-US')} · Score ${state.score.toLocaleString('en-US')} · Missions ${state.missionDone}/6</p>
        <p>${next}</p><div class="prompt">Press ENTER to continue</div></div>`;
    }
    if (screen === SCREEN_SHOP) {
      const items = shopItems || [];
      const rows = items.map((item, i) => `<button class="shop-row${item.owned ? ' owned' : ''}" data-buy="${item.id}">
        <span class="key">[${i + 1}]</span><span class="name">${item.name}</span><span class="desc">${item.desc}</span>
        <span class="price">${item.owned ? 'OWNED' : '$' + item.price}</span></button>`).join('');
      return `<div class="panel shop"><h1>SOLMAR GARAGE</h1>
        <div class="cash">Your cash: $${state.money.toLocaleString('en-US')}</div>
        ${rows}<div class="prompt">Press 1–6 to buy · E or ESC to leave</div></div>`;
    }
    if (screen === SCREEN_OVER) {
      return `<div class="panel"><h1 class="red">${state.overReason || 'WASTED'}</h1>
        <p>Missions ${state.missionDone}/6 · Cash $${state.money.toLocaleString('en-US')} · Score ${state.score.toLocaleString('en-US')}</p>
        <p class="muted">Cars stolen ${state.stats.carsStolen} · Taxis ${state.stats.taxisDone} · Packages ${state.stats.packages}</p>
        <p class="muted">Best score ${best.toLocaleString('en-US')}</p>
        <div class="prompt">Press R to retry · ENTER for the title screen</div></div>`;
    }
    if (screen === SCREEN_VICTORY) {
      return `<div class="panel"><h1 class="green">STORY COMPLETE</h1>
        <p class="gold">GRADE ${state.grade} — the Big Score is yours. Solmar Bay bows to no one.</p>
        <p>Final score ${state.score.toLocaleString('en-US')} · Cash $${state.money.toLocaleString('en-US')} · Time ${Math.floor(state.playSeconds / 60)}:${String(Math.floor(state.playSeconds % 60)).padStart(2, '0')}</p>
        <p class="muted">Cars stolen ${state.stats.carsStolen} · Cops lost ${state.stats.copsLost} · Taxis ${state.stats.taxisDone} · Deaths ${state.stats.deaths}</p>
        <p class="muted">Best score ${best.toLocaleString('en-US')}</p>
        <div class="prompt">Press ENTER to keep playing in free roam</div></div>`;
    }
    if (screen === SCREEN_PAUSED) {
      return `<div class="panel"><h1>PAUSED</h1><p>The city waits for you.</p><div class="prompt">Press P to resume</div></div>`;
    }
    return '';
  }

  el('hud-panel').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-buy]');
    if (btn && onShopBuy) onShopBuy(btn.getAttribute('data-buy'));
  });

  function updateHud(state, screen, best, shopItems, dropped) {
    // Title screen shows only the panel (like the old 2D title): the HUD
    // chrome stays hidden until the game starts.
    hud.classList.toggle('title-screen', screen === SCREEN_TITLE);
    const p = state.player;
    setStars(state.wanted);
    const hp = Math.ceil(p.hp);
    if (hp !== last.hp) {
      last.hp = hp;
      el('hud-hp-fill').style.width = `${clamp(p.hp, 0, 100)}%`;
      el('hud-hp-fill').style.background = p.hp > 30 ? '#58c96b' : '#e5534b';
      el('hud-hp-text').textContent = `HP ${hp}`;
    }
    const armor = Math.ceil(state.armor);
    if (armor !== last.armor) {
      last.armor = armor;
      el('hud-armor-row').style.display = state.armor > 0 ? 'flex' : 'none';
      el('hud-armor-fill').style.width = `${clamp(state.armor, 0, 100)}%`;
      el('hud-armor-text').textContent = `ARMOR ${armor}`;
    }
    const mission = state.mission <= 6 ? MISSIONS[state.mission - 1] : null;
    const target = state.targets.find((tg) => !tg.done);
    const mName = mission ? `MISSION ${mission.id} — ${mission.name.toUpperCase()}` : 'FREE ROAM — SOLMAR BAY IS YOURS';
    const mObj = mission ? (target ? target.label : mission.brief) : 'Side jobs: taxi fares (cyan) · courier packages (green) · garage (gold)';
    if (mName !== last.mission || mObj !== last.obj) {
      last.mission = mName;
      last.obj = mObj;
      el('hud-mission-name').textContent = mName;
      el('hud-mission-obj').textContent = mObj;
      if (G) G.fromTo('#hud-tc', { y: -14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'expo.out' });
    }
    const timer = state.mission === 3 && state.missionTimer > 0 ? `${Math.ceil(state.missionTimer)}s` : '';
    if (timer !== last.timer) {
      last.timer = timer;
      const tEl = el('hud-mission-timer');
      tEl.textContent = timer;
      tEl.style.color = state.missionTimer < 20 && timer ? '#e5534b' : '#f2f0e6';
    }
    if (state.money !== last.money) {
      last.money = state.money;
      el('hud-cash').textContent = `$${state.money.toLocaleString('en-US')}`;
    }
    if (state.score !== last.score) {
      last.score = state.score;
      el('hud-score').textContent = `SCORE ${state.score.toLocaleString('en-US')}`;
    }
    const ammoRow = el('hud-ammo-row');
    ammoRow.style.display = p.onFoot ? 'block' : 'none';
    if (p.onFoot && state.ammo !== last.ammo) {
      last.ammo = state.ammo;
      el('hud-ammo').textContent = state.ammo;
    }
    const nosRow = el('hud-nos-row');
    nosRow.style.display = !p.onFoot ? 'flex' : 'none';
    const nos = Math.round(state.nos);
    if (!p.onFoot && nos !== last.nos) {
      last.nos = nos;
      const fill = el('hud-nos-fill');
      fill.style.width = `${nos}%`;
      fill.style.background = state.nosBoosting ? '#ff9a3c' : '#4fc3f7';
    }
    // Hints, bottom-left.
    const hints = [];
    if (p.onFoot) {
      hints.push('WASD walk · SHIFT sprint · F punch · CLICK shoot');
      const near = nearestCar(state);
      if (near) hints.push(`E — ${near.kind === 'traffic' ? 'steal car (wanted +1)' : near.kind === 'police' ? 'steal cruiser!' : 'get in car'}`);
      if (Math.hypot(p.x - GARAGE.x, p.y - GARAGE.y) < 130) hints.push('E — open garage shop');
      if (state.taxi && state.taxi.stage === 0 && Math.hypot(p.x - state.taxi.px, p.y - state.taxi.py) < 70) hints.push('E — pick up fare');
    } else {
      hints.push('WASD drive · SPACE handbrake · SHIFT NOS boost · E exit car');
      if (p.car) hints.push(`${p.car.name} · HP ${Math.ceil(p.car.hp)}/${p.car.maxHp}`);
    }
    hints.push('P pause · M mute · T tuning');
    const hintsText = hints.join('\n');
    if (hintsText !== last.hints) {
      last.hints = hintsText;
      el('hud-bl').textContent = hintsText;
    }
    // Message toast.
    if (state.message !== last.toast) {
      last.toast = state.message;
      const toast = el('hud-toast');
      toast.textContent = state.message;
      toast.style.opacity = state.message ? '1' : '0';
      if (state.message && G) G.fromTo(toast, { scale: 0.9, y: 6 }, { scale: 1, y: 0, duration: 0.25, ease: 'back.out(2)' });
    }
    // Car HP + speedometer, bottom-centre.
    const bc = el('hud-bc');
    if (!p.onFoot && p.car) {
      bc.style.display = 'block';
      const spd = `${Math.round(Math.abs(p.car.speed) * 0.36)} km/h`;
      if (spd !== last.speed) {
        last.speed = spd;
        el('hud-speed').textContent = spd;
      }
      const carHp = Math.ceil(p.car.hp);
      if (carHp !== last.carhp) {
        last.carhp = carHp;
        el('hud-carhp-fill').style.width = `${clamp(p.car.hp / p.car.maxHp * 100, 0, 100)}%`;
        el('hud-carhp-fill').style.background = p.car.hp > 40 ? '#4fc3f7' : '#e5534b';
        el('hud-carhp-text').textContent = `${p.car.name} · ${carHp}/${p.car.maxHp}`;
      }
    } else {
      bc.style.display = 'none';
    }
    // Radio ticker while driving.
    const radio = !p.onFoot ? `SOLMAR FM ♪ ${RADIO_TRACKS[Math.floor(state.time / 20) % RADIO_TRACKS.length]}` : '';
    if (radio !== last.radio) {
      last.radio = radio;
      el('hud-radio').textContent = radio;
    }
    // Damage vignette: flash on HP loss, persistent pulse when critical.
    // `dropped` is computed once per frame in draw() (hpDropCheck owns lastHp).
    if (dropped) {
      const v = el('hud-vignette');
      if (G) G.fromTo(v, { opacity: 0.6 }, { opacity: p.hp < 30 ? 0.28 : 0, duration: 0.6, ease: 'expo.out' });
      else v.style.opacity = '0';
    }
    if (!G) el('hud-vignette').style.opacity = p.hp < 30 ? '0.25' : '0';
    drawMinimap(state);
    // Panels.
    const panel = el('hud-panel');
    if (screen !== last.screen) {
      last.screen = screen;
      const html = panelHtml(screen, state, best, shopItems);
      panel.innerHTML = html;
      panel.style.display = html ? 'flex' : 'none';
      if (html && G) G.fromTo('#hud-panel .panel', { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'expo.out' });
      last.shopSig = '';
    } else if (screen === SCREEN_SHOP) {
      const sig = `${state.money}|${(shopItems || []).map((i) => i.id + (i.owned ? '1' : '0')).join(',')}`;
      if (sig !== last.shopSig) {
        last.shopSig = sig;
        panel.innerHTML = panelHtml(screen, state, best, shopItems);
      }
    }
  }

  function draw(state, city, screen, best, shopItems) {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0.001, (now - lastNow) / 1000));
    lastNow = now;
    buildCity(city);
    const p = state.player;
    const tod = tune.tod !== null ? tune.tod / 100 : state.timeOfDay;
    const night = nightFactor(tod);

    // --- World entities ---
    syncCars(state);
    syncPeds(state);
    syncMarkers(state);
    syncParticles(state);
    syncFloats(state);

    // Player on foot: walk cycle (legs swing opposite, body bobs).
    if (p.onFoot) {
      playerGroup.visible = true;
      playerGroup.position.set(p.x, 0, p.y);
      playerGroup.rotation.y = -p.angle;
      const moving = p.speed > 10;
      if (moving) walkPhase += dt * p.speed * 0.045;
      const swing = moving ? Math.sin(walkPhase) * 0.55 : 0;
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      playerBody.position.y = moving ? Math.abs(Math.sin(walkPhase)) * 2 : 0;
      const blink = p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0;
      playerBody.visible = !blink;
      legL.visible = !blink;
      legR.visible = !blink;
      bustedRing.visible = p.busted > 0;
      if (p.busted > 0) {
        bustedRing.material.opacity = 0.5 + 0.35 * Math.sin(state.time * 10);
        bustedRing.scale.setScalar(1 + (1 - p.busted / 1.5) * 0.25);
      }
    } else {
      playerGroup.visible = false;
    }

    // Damage smoke from a wrecked player car (visual only).
    if (p.car && p.car.hp < p.car.maxHp * 0.4 && Math.random() < 0.25) {
      state.particles.push({
        x: p.car.x, y: p.car.y, z: 14, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, vz: 40,
        life: 0.8, max: 1, color: '#888888', size: 4,
      });
    }

    // Helicopter.
    if (state.heli) {
      const h = state.heli;
      heliGroup.visible = true;
      heliGroup.position.set(h.x, h.z + Math.sin(state.time * 2) * 4, h.y);
      heliGroup.rotation.y = -h.angle;
      rotor.rotation.y = h.rotor;
      tailRotor.rotation.x = h.rotor * 1.5;
      heliLight.intensity = 2.5;
      heliLight.target.position.set(p.x, 0, p.y);
      coneMat.opacity = 0.06 + night * 0.25;
    } else {
      heliGroup.visible = false;
      heliLight.intensity = 0;
    }

    // --- Lighting & sky ---
    const sky = skyColor(tod);
    scene.background.copy(sky);
    scene.fog.color.copy(sky);
    hemi.intensity = lerp(1.0, 0.35, night / 0.42);
    if (tod >= 0.25 && tod <= 0.7) {
      const dayAngle = ((tod - 0.25) / 0.45) * Math.PI;
      sun.position.set(1600 + Math.cos(dayAngle) * 1800, 300 + Math.sin(dayAngle) * 1400, 900);
      sun.color.set(dayAngle < 0.5 ? '#ff9a5c' : dayAngle > 2.6 ? '#ff8a4d' : '#fff2cc');
      sun.intensity = 1.9;
    } else {
      sun.position.set(1600, 1000, 400);
      sun.color.set('#8fa3ff');
      sun.intensity = 0.35;
    }
    if (cityGroup.userData.buildingMat) cityGroup.userData.buildingMat.emissiveIntensity = night * 1.8;
    if (cityGroup.userData.headMat) {
      cityGroup.userData.headMat.color.set(night > 0.05 ? '#ffe9a8' : '#5a5a5a');
    }
    water.position.y = 1 + Math.sin(state.time * 0.8) * 0.5;
    waterMat.color.set(night > 0.2 ? '#0e2233' : '#2f6f8f');
    seaMat.color.set(night > 0.2 ? '#0a1826' : '#1d4e6b');

    // --- Camera: damped chase + FOV kick + trauma shake ---
    const driving = !p.onFoot;
    // Dynamic chase camera: when the heat is on (2+ stars) the camera pulls
    // up and back so the whole scrum — player, cruisers, roadblocks — stays
    // in frame instead of hiding behind the nearest tower.
    const chaseTarget = state.wanted >= 2 ? 1 : 0;
    last.chaseMix += (chaseTarget - last.chaseMix) * Math.min(1, dt * 2);
    const dist = (tune.dist !== null ? tune.dist : (driving ? CAMERA.driveDist : CAMERA.footDist)) + last.chaseMix * 45;
    const height = (tune.height !== null ? tune.height : (driving ? CAMERA.driveHeight : CAMERA.footHeight)) + last.chaseMix * 55;
    if (screen === SCREEN_TITLE) {
      const a = state.time * 0.05;
      desiredPos.set(1600 + Math.cos(a) * 900, 520, 1200 + Math.sin(a) * 900);
      desiredTarget.set(1600, 0, 1200);
    } else {
      const fx = Math.cos(p.angle);
      const fy = Math.sin(p.angle);
      desiredPos.set(p.x - fx * dist, height, p.y - fy * dist);
      desiredTarget.set(p.x + fx * CAMERA.lookAhead * 0.6, 12, p.y + fy * CAMERA.lookAhead * 0.6);
    }
    const k = 1 - Math.exp(-dt * 3.5); // ease-out-expo-flavoured smoothing
    // Snap on big jumps (first frames, shot staging teleports, title orbit):
    // the shot script only paints two frames, so a lerping camera would
    // still be halfway from its spawn point when the screenshot is taken.
    if (camPos.distanceTo(desiredPos) > 600) camPos.copy(desiredPos);
    else camPos.lerp(desiredPos, k);
    if (camTarget.distanceTo(desiredTarget) > 900) camTarget.copy(desiredTarget);
    else camTarget.lerp(desiredTarget, 1 - Math.exp(-dt * 5));
    // Trauma shake (motion-design: shake strength = trauma squared).
    const dropped = hpDropCheck(state);
    if (dropped) last.trauma = Math.min(1, last.trauma + 0.4);
    last.trauma = Math.max(0, last.trauma - dt * 1.2);
    const sh = last.trauma * last.trauma * 12;
    camera.position.set(
      camPos.x + (Math.random() - 0.5) * sh,
      camPos.y + (Math.random() - 0.5) * sh,
      camPos.z + (Math.random() - 0.5) * sh,
    );
    camera.lookAt(camTarget);
    const speedFrac = driving && p.car ? Math.abs(p.car.speed) / p.car.model.maxSpeed : 0;
    const fovTarget = (tune.fov !== null ? tune.fov : CAMERA.fov) + speedFrac * CAMERA.fovBoost + (state.nosBoosting ? 4 : 0);
    if (Math.abs(camera.fov - fovTarget) > 0.05) {
      camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }
    camFoot.x = clamp(p.x - VIEW.width / 2, 0, WORLD.width - VIEW.width);
    camFoot.y = clamp(p.y - VIEW.height / 2, 0, WORLD.height - VIEW.height);

    renderer.render(scene, camera);
    updateHud(state, screen, best, shopItems, dropped);
  }

  function hpDropCheck(state) {
    const hp = Math.ceil(state.player.hp);
    const dropped = hp < last.lastHp;
    last.lastHp = hp;
    return dropped;
  }

  /** Convert canvas-relative (CSS px) coordinates to world coordinates. */
  function screenToWorld(cx, cy) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((cx) / rect.width) * 2 - 1, -((cy) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const origin = raycaster.ray.origin;
    const dir = raycaster.ray.direction;
    if (Math.abs(dir.y) < 1e-6) return { x: 0, y: 0 };
    const t = -origin.y / dir.y;
    if (t < 0) return { x: 0, y: 0 };
    return { x: origin.x + dir.x * t, y: origin.z + dir.z * t };
  }

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  return { draw, camera: camFoot, screenToWorld };
}
