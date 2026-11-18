// Solmar Bay — 3D renderer + HUD (fresh rewrite).
//
// Design (motion-design / Energetic archetype, ease-out-expo signature):
//   * Primary motion: chase camera with exponential damping, FOV kick by
//     speed, trauma-squared screen shake, snap on teleport.
//   * Secondary: GSAP panel entrances (expo.out), star pops (back.out),
//     toast slides, minimap camera-frustum, speedometer needle feel.
//   * Ambient: day/night sky + fog keyframes, drifting cloud sprites,
//     pulsing mission beacons, water shimmer, street-light glow at night.
//   * Post feel without a composer: ACES tone mapping + fog + vignette
//     overlay + additive glow sprites (react-postprocessing spirit).
//   * Particles: single GPU Points cloud (three.quarks spirit).
//
// World mapping: world (x, y) -> three (x, 0, y). A heading `a` in world
// space points along (cos a, 0, sin a) in 3D, so model rotation.y = -a.
import * as THREE from './vendor/three.module.min.js';
import {
  WORLD, CAMERA, MISSIONS, GARAGE, SAFEHOUSE,
  ROADS_X, ROADS_Y, ROAD_W, DISTRICTS, PALETTE,
} from './config.js';
import { districtAt } from './city.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_BRIEF = 'brief';
export const SCREEN_SHOP = 'shop';
export const SCREEN_VICTORY = 'victory';

const G = (typeof window !== 'undefined' && window.gsap) ? window.gsap : null;
const TAU = Math.PI * 2;

// ---------- easing (motion-design: entrance = decelerate) ----------
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => { const c = 1.70158; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
// Frame-rate independent exponential damping: damp(current, target, rate, dt).
const damp = (cur, tgt, rate, dt) => lerp(cur, tgt, 1 - Math.exp(-rate * dt));
const dampAngle = (cur, tgt, rate, dt) => {
  let d = tgt - cur;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return cur + d * (1 - Math.exp(-rate * dt));
};
const kmh = (speed) => Math.round(Math.abs(speed || 0) * 0.36);
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

// ---------- shared geometry / material caches ----------
const geoCache = new Map();
function boxGeo(w, h, d) {
  const k = `b${w}|${h}|${d}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(k);
}
function cylGeo(rt, rb, h, seg = 10) {
  const k = `c${rt}|${rb}|${h}|${seg}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(rt, rb, h, seg));
  return geoCache.get(k);
}
const matCache = new Map();
function flatMat(color, opts = {}) {
  const k = `${color}|${opts.transparent ? 't' : 'o'}|${opts.opacity ?? 1}|${opts.emissive ?? ''}`;
  if (!matCache.has(k)) {
    matCache.set(k, new THREE.MeshLambertMaterial({
      color, transparent: !!opts.transparent, opacity: opts.opacity ?? 1,
      emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 1,
    }));
  }
  return matCache.get(k);
}
function glowMat(color, opacity = 0.85) {
  const k = `g${color}|${opacity}`;
  if (!matCache.has(k)) {
    matCache.set(k, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    }));
  }
  return matCache.get(k);
}

// Soft radial dot texture (particles + glow sprites + blob shadows).
let dotTexture = null;
function getDotTexture() {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dotTexture = new THREE.CanvasTexture(c);
  return dotTexture;
}

// Text sprite (floating score popups). Cached by text+color.
const labelCache = new Map();
function textSprite(text, color = '#ffffff', scale = 1) {
  const k = `${text}|${color}`;
  if (labelCache.has(k)) return labelCache.get(k);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(text, 128, 32);
  g.fillStyle = color;
  g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(150 * scale, 37.5 * scale, 1);
  labelCache.set(k, spr);
  return spr;
}

// ---------- day / night keyframes ----------
const DAY_KEYS = [
  { t: 0.00, sky: 0x0a1026, fog: 0x0a1026, sun: 0x8fa3ff, sunI: 0.25, hemi: 0.25, amb: 0.18 },
  { t: 0.22, sky: 0x2c3a6e, fog: 0x2c3a6e, sun: 0xffb37a, sunI: 0.55, hemi: 0.4, amb: 0.3 },
  { t: 0.32, sky: 0x9fc8ee, fog: 0x9fc8ee, sun: 0xffe3b3, sunI: 1.15, hemi: 0.75, amb: 0.55 },
  { t: 0.55, sky: 0x87ceeb, fog: 0x87ceeb, sun: 0xffffff, sunI: 1.35, hemi: 0.85, amb: 0.6 },
  { t: 0.72, sky: 0xff9a5c, fog: 0xff9a5c, sun: 0xff7a2a, sunI: 0.9, hemi: 0.5, amb: 0.4 },
  { t: 0.82, sky: 0x2c2350, fog: 0x2c2350, sun: 0xff8a5c, sunI: 0.4, hemi: 0.32, amb: 0.24 },
  { t: 1.00, sky: 0x0a1026, fog: 0x0a1026, sun: 0x8fa3ff, sunI: 0.25, hemi: 0.25, amb: 0.18 },
];
const _cA = new THREE.Color();
const _cB = new THREE.Color();
function dayKey(timeOfDay) {
  const t = clamp(timeOfDay, 0, 1);
  let i = 0;
  while (i < DAY_KEYS.length - 2 && DAY_KEYS[i + 1].t < t) i += 1;
  const a = DAY_KEYS[i];
  const b = DAY_KEYS[i + 1];
  const f = clamp((t - a.t) / Math.max(0.0001, b.t - a.t), 0, 1);
  const e = easeOutCubic(f);
  return {
    sky: _cA.setHex(a.sky).lerp(_cB.setHex(b.sky), e).clone(),
    fog: _cA.setHex(a.fog).lerp(_cB.setHex(b.fog), e).clone(),
    sun: _cA.setHex(a.sun).lerp(_cB.setHex(b.sun), e).clone(),
    sunI: lerp(a.sunI, b.sunI, e),
    hemi: lerp(a.hemi, b.hemi, e),
    amb: lerp(a.amb, b.amb, e),
    night: t < 0.2 || t > 0.85 ? 1 : 0,
  };
}
const RADIO_STATIONS = ['SOLMAR FM 98.1', 'PALM BEACH 104.7', 'VICE CITY 91.3', 'NEON DRIVE 87.9', 'BAYWAVE 102.5'];

// ---------- HUD (DOM) ----------
// Built once from the ids/classes index.html's CSS expects. All updates go
// through updateHud() below; nothing here reads game state directly.
function buildHud(onShopBuy) {
  const $ = (id) => document.getElementById(id);
  // index.html ships only <canvas id="game"> + #status — the whole HUD
  // shell (styled by the page CSS) is created here, once.
  let hud = $('hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'hud';
    document.body.appendChild(hud);
    for (const id of ['hud-vignette', 'hud-tl', 'hud-tc', 'hud-tr', 'hud-bl', 'hud-br', 'hud-bc', 'hud-toast', 'hud-panel', 'hud-tune']) {
      const el = document.createElement('div');
      el.id = id;
      hud.appendChild(el);
    }
  }
  const vig = $('hud-vignette');
  const tl = $('hud-tl');
  const tc = $('hud-tc');
  const tr = $('hud-tr');
  const bl = $('hud-bl');
  const br = $('hud-br');
  const bc = $('hud-bc');
  const toast = $('hud-toast');
  const panel = $('hud-panel');
  const tune = $('hud-tune');

  // Top-left: wanted stars + health/armor bars.
  // CSS shape: .bar > span(label) + .track > div(fill).
  tl.innerHTML = '';
  const stars = document.createElement('div');
  stars.id = 'hud-stars';
  for (let i = 0; i < 5; i += 1) {
    const s = document.createElement('span');
    s.className = 'star';
    s.textContent = '★';
    stars.appendChild(s);
  }
  const hpWrap = document.createElement('div');
  hpWrap.className = 'bar hp';
  const hpLabel = document.createElement('span');
  hpLabel.textContent = 'HP';
  const hpTrack = document.createElement('div');
  hpTrack.className = 'track';
  const hpFill = document.createElement('div');
  hpFill.className = 'fill';
  hpFill.style.background = 'linear-gradient(90deg, #3fae5a, #7be495)';
  hpTrack.appendChild(hpFill);
  hpWrap.append(hpLabel, hpTrack);
  const armorWrap = document.createElement('div');
  armorWrap.className = 'bar armor thin';
  const armorLabel = document.createElement('span');
  armorLabel.textContent = 'ARMOR';
  const armorTrack = document.createElement('div');
  armorTrack.className = 'track';
  const armorFill = document.createElement('div');
  armorFill.className = 'fill';
  armorFill.style.background = 'linear-gradient(90deg, #2b7fb8, #4fc3f7)';
  armorTrack.appendChild(armorFill);
  armorWrap.append(armorLabel, armorTrack);
  tl.append(stars, hpWrap, armorWrap);

  // Top-center: mission name / objective / timer.
  tc.innerHTML = '';
  const mName = document.createElement('div');
  mName.id = 'hud-mission-name';
  const mObj = document.createElement('div');
  mObj.id = 'hud-mission-obj';
  const mTimer = document.createElement('div');
  mTimer.id = 'hud-mission-timer';
  tc.append(mName, mObj, mTimer);

  // Top-right: cash / score / ammo / NOS.
  tr.innerHTML = '';
  const cash = document.createElement('div');
  cash.id = 'hud-cash';
  const score = document.createElement('div');
  score.id = 'hud-score';
  const ammoRow = document.createElement('div');
  ammoRow.id = 'hud-ammo-row';
  const ammoLabel = document.createElement('span');
  ammoLabel.textContent = 'AMMO ';
  const ammo = document.createElement('span');
  ammo.id = 'hud-ammo';
  ammoRow.append(ammoLabel, ammo);
  const nosRow = document.createElement('div');
  nosRow.id = 'hud-nos-row';
  const nosLabel = document.createElement('span');
  nosLabel.textContent = 'NOS ';
  const nosBar = document.createElement('span');
  nosBar.id = 'hud-nos';
  nosBar.style.display = 'inline-block';
  nosBar.style.width = '80px';
  nosBar.style.height = '10px';
  nosBar.style.borderRadius = '5px';
  nosBar.style.verticalAlign = 'middle';
  nosRow.append(nosLabel, nosBar);
  tr.append(cash, score, ammoRow, nosRow);

  // Bottom-left: controls cheat-sheet.
  bl.innerHTML = '';
  const controls = document.createElement('div');
  controls.id = 'hud-controls';
  controls.textContent = 'WASD drive · SPACE brake · SHIFT NOS · E enter/exit · F interact · R respawn · T tune · M mute';
  bl.appendChild(controls);

  // Bottom-right: minimap + radio + district label.
  br.innerHTML = '';
  const mapLabel = document.createElement('div');
  mapLabel.id = 'hud-maplabel';
  mapLabel.textContent = 'SOLMAR BAY';
  const minimap = document.createElement('canvas');
  minimap.id = 'hud-minimap';
  minimap.width = 220;
  minimap.height = 160;
  const radio = document.createElement('div');
  radio.id = 'hud-radio';
  radio.textContent = RADIO_STATIONS[0];
  br.append(mapLabel, minimap, radio);

  // Bottom-center: speedometer + car HP.
  bc.innerHTML = '';
  const speed = document.createElement('div');
  speed.id = 'hud-speed';
  speed.textContent = '0';
  const speedUnit = document.createElement('span');
  speedUnit.className = 'unit';
  speedUnit.textContent = ' km/h';
  speed.appendChild(speedUnit);
  const carHpWrap = document.createElement('div');
  carHpWrap.className = 'bar carhp';
  const carHpLabel = document.createElement('span');
  carHpLabel.textContent = 'CAR';
  const carHpTrack = document.createElement('div');
  carHpTrack.className = 'track';
  const carHpFill = document.createElement('div');
  carHpFill.className = 'fill';
  carHpFill.style.background = 'linear-gradient(90deg, #d8912a, #f2c94c)';
  carHpTrack.appendChild(carHpFill);
  carHpWrap.append(carHpLabel, carHpTrack);
  bc.append(speed, carHpWrap);

  // Tune panel (T): camera + time-of-day sliders.
  tune.innerHTML = '';
  const tuneTitle = document.createElement('div');
  tuneTitle.className = 'tune-title';
  tuneTitle.textContent = 'CAMERA TUNE (T to close)';
  tune.appendChild(tuneTitle);
  const sliders = {};
  const sliderDefs = [
    ['dist', 'Distance', 140, 340, CAMERA.driveDist],
    ['height', 'Height', 60, 190, CAMERA.driveHeight],
    ['fov', 'FOV', 50, 78, 60],
    ['tod', 'Time of day', 0, 100, 32],
  ];
  for (const [key, label, min, max, val] of sliderDefs) {
    const row = document.createElement('label');
    row.className = 'tune-row';
    row.appendChild(document.createTextNode(label));
    const span = document.createElement('span');
    span.textContent = String(val);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.value = String(val);
    input.dataset.tune = key;
    row.append(span, input);
    tune.appendChild(row);
    sliders[key] = input;
  }
  return {
    hud, vig, bc, stars: [...stars.children], hpFill, armorFill,
    mName, mObj, mTimer, cash, score, ammo, nosBar, minimap, radio,
    mapLabel, speed, carHpFill, carHpWrap, toast, panel, tune, sliders,
    onShopBuy,
  };
}

// ---------- renderer ----------
const PARTICLE_CAP = 384;
const FLOAT_CAP = 24;

class SolmarRenderer {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.onShopBuy = (opts && opts.onShopBuy) || (() => {});
    this.hud = buildHud(this.onShopBuy);

    // WebGL renderer: pixelRatio 1 (SwiftShader), no MSAA, ACES tone map.
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(1);
    this.gl.setSize(window.innerWidth, window.innerHeight, false);
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.12;
    if ('SRGBColorSpace' in THREE) this.gl.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 900, 4200);
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 8000);
    this.camera.position.set(1600, 900, 1600);
    this.camera.lookAt(1600, 0, 1200);

    // Lights: sun (directional) + hemisphere sky bounce.
    this.sun = new THREE.DirectionalLight(0xffffff, 1.3);
    this.sun.position.set(1200, 1800, 600);
    this.scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3a2f28, 0.85);
    this.scene.add(this.hemi);

    // Camera rig state.
    this.camPos = new THREE.Vector3(1600, 900, 1600);
    this.camLook = new THREE.Vector3(1600, 0, 1200);
    this.camFov = 60;
    this.trauma = 0;
    this.shakeT = 0;
    this.titleAngle = 0;
    this.time = 0;
    this.lastHurtAt = -99;
    this.lastHp = 100;
    this.lastWanted = 0;
    this.lastScreen = null;
    this.lastToast = '';
    this.toastUntil = 0;
    this.radioIdx = 0;
    this.radioAt = 0;
    this.tune = this.loadTune();

    // City / actor caches.
    this.cityRef = null;
    this.cityGroup = null;
    this.streetGlow = [];
    this.carPool = new Map();
    this.pedPool = new Map();
    this.playerFigure = null;
    this.heliGroup = null;
    this.heliRotor = null;
    this.heliBeam = null;
    this.markerRing = null;
    this.markerBeam = null;
    this.taxiRingA = null;
    this.taxiRingB = null;
    this.garageBeacon = null;
    this.safeBeacon = null;
    this.packageMeshes = new Map();
    this.floatSprites = [];
    this.floatIdx = 0;

    this.buildParticles();
    this.buildClouds();
    this.wireTuneKeys();
    window.addEventListener('resize', () => this.onResize());
  }

  loadTune() {
    const base = { dist: CAMERA.driveDist, height: CAMERA.driveHeight, fov: 60, tod: 0.32 };
    try {
      const raw = localStorage.getItem('solmar-bay.tune.v1');
      if (raw) Object.assign(base, JSON.parse(raw));
    } catch { /* defaults */ }
    return base;
  }
  saveTune() {
    try { localStorage.setItem('solmar-bay.tune.v1', JSON.stringify(this.tune)); } catch { /* ignore */ }
  }

  wireTuneKeys() {
    const { tune, sliders } = this.hud;
    const apply = () => {
      this.tune.dist = Number(sliders.dist.value);
      this.tune.height = Number(sliders.height.value);
      this.tune.fov = Number(sliders.fov.value);
      this.tune.tod = Number(sliders.tod.value) / 100;
      this.tuneTouched = true;
      const valSpans = tune.querySelectorAll('.tune-row span');
      const keys = ['dist', 'height', 'fov', 'tod'];
      valSpans.forEach((sp, i) => { sp.textContent = String(sliders[keys[i]].value); });
      this.saveTune();
    };
    for (const key of Object.keys(sliders)) sliders[key].addEventListener('input', apply);
    sliders.dist.value = String(this.tune.dist);
    sliders.height.value = String(this.tune.height);
    sliders.fov.value = String(this.tune.fov);
    sliders.tod.value = String(Math.round(this.tune.tod * 100));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT') tune.classList.toggle('open');
    });
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.gl.setSize(w, h, false);
  }

  // ---------- particles (single GPU Points cloud) ----------
  buildParticles() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLE_CAP * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PARTICLE_CAP * 3), 3));
    geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(PARTICLE_CAP), 1));
    const mat = new THREE.PointsMaterial({
      size: 14, map: getDotTexture(), vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  syncParticles(state) {
    const pos = this.points.geometry.attributes.position;
    const col = this.points.geometry.attributes.color;
    const size = this.points.geometry.attributes.size;
    const list = state.particles || [];
    for (let i = 0; i < PARTICLE_CAP; i += 1) {
      const p = list[i];
      if (p) {
        pos.setXYZ(i, p.x, (p.z || 0) + 2, p.y);
        const c = new THREE.Color(p.color || '#ffffff');
        col.setXYZ(i, c.r, c.g, c.b);
        size.setX(i, (p.size || 6) * (0.4 + 0.6 * (p.life / Math.max(0.01, p.max || 1))));
      } else {
        pos.setXYZ(i, 0, -100, 0);
        size.setX(i, 0);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    size.needsUpdate = true;
    this.points.geometry.setDrawRange(0, Math.min(PARTICLE_CAP, list.length));
  }

  // ---------- clouds (ambient drift) ----------
  buildClouds() {
    this.clouds = [];
    const tex = getDotTexture();
    for (let i = 0; i < 10; i += 1) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
      const spr = new THREE.Sprite(mat);
      const x = 200 + Math.random() * 2800;
      const z = 200 + Math.random() * 2000;
      spr.position.set(x, 700 + Math.random() * 250, z);
      spr.scale.set(500 + Math.random() * 500, 140 + Math.random() * 90, 1);
      spr.userData.drift = 6 + Math.random() * 10;
      this.scene.add(spr);
      this.clouds.push(spr);
    }
  }

  // ---------- static city (built once per city object) ----------
  // City schema (city.js createCity): { buildings, trees, parks, lots }.
  // Buildings/parks/lots are { x, y, width, height } corner rects; trees
  // are { x, y, r }. Roads + districts come from config (ROADS_X/Y,
  // DISTRICTS) — they are NOT on the city object. Building height is
  // derived: downtown towers (tall) rise high, the rest stay low.
  buildCity(city) {
    if (this.cityGroup) this.scene.remove(this.cityGroup);
    this.cityGroup = new THREE.Group();
    this.streetGlow = [];
    const g = this.cityGroup;
    const W = WORLD.width;
    const H = WORLD.height;
    const BEACH_X0 = 3050; // sand strip along the east edge
    const WATER_X0 = 3200; // open water east of the city

    // Ground base (grass) + sand strip + water.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 1400, H + 1400),
      flatMat(PALETTE.grass),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(W / 2, -0.5, H / 2);
    g.add(ground);
    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(WATER_X0 - BEACH_X0, H),
      flatMat(PALETTE.sand),
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.set((BEACH_X0 + WATER_X0) / 2, 0, H / 2);
    g.add(sand);
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(700, H + 1400),
      new THREE.MeshLambertMaterial({ color: PALETTE.water, transparent: true, opacity: 0.92 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(WATER_X0 + 350, 0.4, H / 2);
    g.add(water);
    this.waterMesh = water;

    // Roads: asphalt strips on the ROADS_X / ROADS_Y grid + center dashes.
    const roadMat = flatMat(PALETTE.road);
    const dashGeo = boxGeo(26, 0.4, 5);
    const dashMat = flatMat(PALETTE.roadLine);
    const dashes = [];
    for (const y of ROADS_Y) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(W, ROAD_W), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.set(W / 2, 0.2, y);
      g.add(road);
      for (let s = 60; s < W - 20; s += 120) dashes.push([s, y, 0]);
    }
    for (const x of ROADS_X) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, H), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.set(x, 0.2, H / 2);
      g.add(road);
      for (let s = 60; s < H - 20; s += 120) dashes.push([x, s, Math.PI / 2]);
    }
    const dashMesh = new THREE.InstancedMesh(dashGeo, dashMat, Math.max(1, dashes.length));
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    dashes.forEach(([x, y, rot], i) => {
      eul.set(0, rot, 0);
      q.setFromEuler(eul);
      m4.compose(new THREE.Vector3(x, 0.5, y), q, new THREE.Vector3(1, 1, 1));
      dashMesh.setMatrixAt(i, m4);
    });
    dashMesh.count = dashes.length;
    g.add(dashMesh);

    // Buildings: one InstancedMesh, per-instance color. x/y is the corner,
    // width/height the footprint; height derives from tall/windows.
    const list = city.buildings || [];
    const bGeo = boxGeo(1, 1, 1);
    const bMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const bMesh = new THREE.InstancedMesh(bGeo, bMat, Math.max(1, list.length));
    const col = new THREE.Color();
    list.forEach((b, i) => {
      const hgt = b.tall ? 150 + (b.windows % 40) : 48 + (b.windows % 30);
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      m4.compose(
        new THREE.Vector3(cx, hgt / 2 + 1, cy),
        q.identity(),
        new THREE.Vector3(b.width, hgt, b.height),
      );
      bMesh.setMatrixAt(i, m4);
      bMesh.setColorAt(i, col.set(b.color || '#8a8f9a'));
      // Rooftop beacon on tall towers (night landmark).
      if (b.tall) {
        const beacon = new THREE.Sprite(new THREE.SpriteMaterial({
          map: getDotTexture(), color: 0xff5566, transparent: true, opacity: 0.8, depthWrite: false,
        }));
        beacon.position.set(cx, hgt + 14, cy);
        beacon.scale.set(26, 26, 1);
        g.add(beacon);
      }
    });
    bMesh.count = list.length;
    if (bMesh.instanceColor) bMesh.instanceColor.needsUpdate = true;
    g.add(bMesh);

    // Trees: trunk cylinders + foliage cones, both instanced, scaled by r.
    const trees = city.trees || [];
    const trunkMesh = new THREE.InstancedMesh(cylGeo(3, 4.5, 18, 6), flatMat(0x6b4a2b), Math.max(1, trees.length));
    const leafMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(16, 34, 7), flatMat(PALETTE.tree), Math.max(1, trees.length));
    trees.forEach((t, i) => {
      const s = (t.r || 12) / 12;
      m4.compose(new THREE.Vector3(t.x, 9 * s, t.y), q.identity(), new THREE.Vector3(s, s, s));
      trunkMesh.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(t.x, 32 * s, t.y), q.identity(), new THREE.Vector3(s, s, s));
      leafMesh.setMatrixAt(i, m4);
    });
    trunkMesh.count = trees.length;
    leafMesh.count = trees.length;
    g.add(trunkMesh);
    g.add(leafMesh);

    // Parks (flat green) + parking lots (flat grey).
    for (const p of city.parks || []) {
      const park = new THREE.Mesh(new THREE.PlaneGeometry(p.width, p.height), flatMat(PALETTE.park));
      park.rotation.x = -Math.PI / 2;
      park.position.set(p.x + p.width / 2, 0.3, p.y + p.height / 2);
      g.add(park);
    }
    for (const lot of city.lots || []) {
      const slab = new THREE.Mesh(new THREE.PlaneGeometry(lot.width, lot.height), flatMat(PALETTE.sidewalk));
      slab.rotation.x = -Math.PI / 2;
      slab.position.set(lot.x + lot.width / 2, 0.25, lot.y + lot.height / 2);
      g.add(slab);
    }

    // Street-light glow sprites at every road-grid intersection (night).
    for (const x of ROADS_X) {
      for (const y of ROADS_Y) {
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({
          map: getDotTexture(), color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false,
        }));
        spr.position.set(x, 26, y);
        spr.scale.set(60, 60, 1);
        g.add(spr);
        this.streetGlow.push(spr);
      }
    }

    this.scene.add(g);
  }

  // ---------- actor builders ----------
  // Car: body + glass cabin + dark wheel base + optional police light bar.
  // Materials are cached by color; geometry is shared — only the group
  // transform changes per frame.
  makeCarGroup(car) {
    const grp = new THREE.Group();
    const isPolice = car.kind === 'police';
    const baseColor = isPolice ? 0x1d3fae : (car.color || '#c0c0c0');
    const body = new THREE.Mesh(boxGeo(46, 10, 22), flatMat(baseColor));
    body.position.y = 8;
    grp.add(body);
    const cabin = new THREE.Mesh(boxGeo(24, 8, 19), flatMat(0x101418));
    cabin.position.set(-2, 16, 0);
    grp.add(cabin);
    const wheels = new THREE.Mesh(boxGeo(44, 5, 24), flatMat(0x0a0a0a));
    wheels.position.y = 3;
    grp.add(wheels);
    // Blob shadow grounds the car.
    const shadow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getDotTexture(), color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false,
    }));
    shadow.scale.set(58, 30, 1);
    shadow.position.y = 1;
    shadow.material.rotation = Math.PI / 2;
    grp.add(shadow);
    let lightBar = null;
    let glowL = null;
    let glowR = null;
    if (isPolice) {
      lightBar = new THREE.Mesh(boxGeo(10, 3, 20), flatMat(0x222222));
      lightBar.position.set(-2, 21, 0);
      grp.add(lightBar);
      glowL = new THREE.Sprite(new THREE.SpriteMaterial({
        map: getDotTexture(), color: 0xff2222, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glowL.scale.set(18, 18, 1);
      glowL.position.set(-2, 24, -8);
      grp.add(glowL);
      glowR = new THREE.Sprite(new THREE.SpriteMaterial({
        map: getDotTexture(), color: 0x2244ff, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glowR.scale.set(18, 18, 1);
      glowR.position.set(-2, 24, 8);
      grp.add(glowR);
    }
    // Headlight glow (forward, +x local).
    const head = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getDotTexture(), color: 0xfff2b0, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    head.scale.set(26, 14, 1);
    head.position.set(26, 8, 0);
    grp.add(head);
    grp.userData = { lightBar, glowL, glowR, head, isPolice };
    this.scene.add(grp);
    return grp;
  }

  makePedGroup(ped) {
    const grp = new THREE.Group();
    const torso = new THREE.Mesh(boxGeo(9, 16, 6), flatMat(ped.color || '#dddddd'));
    torso.position.y = 18;
    grp.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(5, 10, 8), flatMat(0xd9a066));
    head.position.y = 31;
    grp.add(head);
    const legs = new THREE.Mesh(boxGeo(8, 12, 5), flatMat(0x222831));
    legs.position.y = 6;
    grp.add(legs);
    const shadow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getDotTexture(), color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false,
    }));
    shadow.scale.set(16, 9, 1);
    shadow.position.y = 1;
    grp.add(shadow);
    grp.userData = { torso, legs };
    this.scene.add(grp);
    return grp;
  }

  // Player on foot: red jacket (matches the mission key art), walk swing.
  makePlayerFigure() {
    const grp = new THREE.Group();
    const legL = new THREE.Mesh(boxGeo(4, 13, 5), flatMat(0x1c2733));
    legL.position.set(0, 7, -3);
    const legR = legL.clone();
    legR.position.z = 3;
    const torso = new THREE.Mesh(boxGeo(11, 17, 8), flatMat(0xc22e2e));
    torso.position.y = 22;
    const armL = new THREE.Mesh(boxGeo(3, 13, 4), flatMat(0xc22e2e));
    armL.position.set(0, 22, -6);
    const armR = armL.clone();
    armR.position.z = 6;
    const head = new THREE.Mesh(new THREE.SphereGeometry(5.5, 10, 8), flatMat(0xd9a066));
    head.position.y = 35;
    const cap = new THREE.Mesh(boxGeo(11, 3, 11), flatMat(0x111111));
    cap.position.y = 39;
    const shadow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getDotTexture(), color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false,
    }));
    shadow.scale.set(20, 11, 1);
    shadow.position.y = 1;
    grp.add(legL, legR, torso, armL, armR, head, cap, shadow);
    grp.userData = { legL, legR, armL, armR };
    this.scene.add(grp);
    return grp;
  }

  makeHeli() {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(boxGeo(34, 12, 18), flatMat(0x24344d));
    grp.add(body);
    const tail = new THREE.Mesh(boxGeo(30, 5, 5), flatMat(0x24344d));
    tail.position.set(-28, 2, 0);
    grp.add(tail);
    const skids = new THREE.Mesh(boxGeo(26, 2, 22), flatMat(0x111111));
    skids.position.y = -9;
    grp.add(skids);
    const rotor = new THREE.Group();
    const bladeA = new THREE.Mesh(boxGeo(64, 1, 4), flatMat(0x111111));
    const bladeB = new THREE.Mesh(boxGeo(4, 1, 64), flatMat(0x111111));
    rotor.add(bladeA, bladeB);
    rotor.position.y = 9;
    grp.add(rotor);
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(46, 260, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xfff6c0, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    beam.position.y = -130;
    beam.rotation.x = Math.PI;
    grp.add(beam);
    this.scene.add(grp);
    return { grp, rotor, beam };
  }

  makeRing(color, inner, outer) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 40),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 2;
    this.scene.add(mesh);
    return mesh;
  }

  makeBeam(color, radius, height) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 1.6, height, 14, 1, true),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    mesh.position.y = height / 2;
    this.scene.add(mesh);
    return mesh;
  }

  ensureMarkers() {
    if (this.markerRing) return;
    this.markerRing = this.makeRing(0xffc233, 26, 40);
    this.markerBeam = this.makeBeam(0xffc233, 14, 320);
    this.taxiRingA = this.makeRing(0x22d3ee, 20, 30);
    this.taxiRingB = this.makeRing(0x22d3ee, 20, 30);
    this.garageBeacon = this.makeBeam(0x39d353, 10, 200);
    this.safeBeacon = this.makeBeam(0x8b5cf6, 10, 200);
  }

  // ---------- per-frame actor sync ----------
  syncCars(state, dt) {
    const seen = new Set();
    for (const car of state.cars || []) {
      seen.add(car.id);
      let grp = this.carPool.get(car.id);
      if (!grp) {
        grp = this.makeCarGroup(car);
        this.carPool.set(car.id, grp);
      }
      grp.position.set(car.x, 0, car.y);
      grp.rotation.y = -car.angle;
      const u = grp.userData;
      if (u.isPolice && state.wanted > 0) {
        // Alternating red/blue strobe (urgency, 100-200ms phase).
        const phase = Math.floor(this.time * 6) % 2 === 0;
        u.glowL.material.opacity = phase ? 0.95 : 0.12;
        u.glowR.material.opacity = phase ? 0.12 : 0.95;
      } else if (u.glowL) {
        u.glowL.material.opacity = 0.12;
        u.glowR.material.opacity = 0.12;
      }
      // Headlights on at night.
      if (u.head) u.head.material.opacity = this.nightFactor > 0.5 ? 0.85 : 0.4;
      // Damage smoke puff: a particle burst is emitted by the sim; the car
      // itself just leans slightly when badly hurt.
      grp.rotation.z = car.hp !== undefined && car.hp < 35 ? Math.sin(this.time * 9 + car.id) * 0.02 : 0;
    }
    for (const [id, grp] of this.carPool) {
      if (!seen.has(id)) {
        this.scene.remove(grp);
        this.carPool.delete(id);
      }
    }
    // Gold ring under the player's current car.
    const p = state.player;
    if (p && p.car) {
      if (!this.playerRing) {
        this.playerRing = this.makeRing(0xffd166, 30, 36);
        this.playerRing.material.opacity = 0.55;
      }
      this.playerRing.visible = true;
      this.playerRing.position.set(p.x, 2, p.y);
    } else if (this.playerRing) {
      this.playerRing.visible = false;
    }
  }

  syncPeds(state) {
    const seen = new Set();
    for (const ped of state.peds || []) {
      seen.add(ped.id);
      let grp = this.pedPool.get(ped.id);
      if (!grp) {
        grp = this.makePedGroup(ped);
        this.pedPool.set(ped.id, grp);
      }
      grp.position.set(ped.x, 0, ped.y);
      grp.rotation.y = -ped.angle;
      // Walk bob + flee flail (secondary motion).
      const bob = Math.abs(Math.sin(this.time * 7 + ped.id * 1.7)) * 2.2;
      grp.position.y = bob * Math.min(1, Math.abs(ped.speed || 0) / 40);
      grp.userData.torso.rotation.x = (ped.flee > 0.3 ? Math.sin(this.time * 11 + ped.id) * 0.25 : 0);
    }
    for (const [id, grp] of this.pedPool) {
      if (!seen.has(id)) {
        this.scene.remove(grp);
        this.pedPool.delete(id);
      }
    }
  }

  syncPlayerFigure(state, dt) {
    const p = state.player;
    if (!p) return;
    if (p.onFoot) {
      if (!this.playerFigure) this.playerFigure = this.makePlayerFigure();
      const f = this.playerFigure;
      f.visible = true;
      f.position.set(p.x, 0, p.y);
      f.rotation.y = -p.angle;
      // Walk cycle: legs/arms swing opposite, amplitude by speed.
      const swing = clamp(Math.abs(p.speed || 0) / 160, 0, 1) * 0.7;
      const phase = this.time * 10;
      f.userData.legL.rotation.x = Math.sin(phase) * swing;
      f.userData.legR.rotation.x = -Math.sin(phase) * swing;
      f.userData.armL.rotation.x = -Math.sin(phase) * swing * 0.8;
      f.userData.armR.rotation.x = Math.sin(phase) * swing * 0.8;
    } else if (this.playerFigure) {
      this.playerFigure.visible = false;
    }
  }

  syncHeli(state) {
    const h = state.heli;
    if (!h) {
      if (this.heliGroup) this.heliGroup.visible = false;
      return;
    }
    if (!this.heliGroup) {
      const built = this.makeHeli();
      this.heliGroup = built.grp;
      this.heliRotor = built.rotor;
      this.heliBeam = built.beam;
    }
    this.heliGroup.visible = true;
    this.heliGroup.position.set(h.x, h.z || 260, h.y);
    this.heliGroup.rotation.y = -h.angle;
    this.heliRotor.rotation.y = h.rotor || 0;
    // Searchlight tracks the player.
    const p = state.player;
    if (p && this.heliBeam) {
      const dx = p.x - h.x;
      const dy = p.y - h.y;
      const dist = Math.hypot(dx, dy);
      this.heliBeam.visible = dist < 900;
    }
  }

  syncMarkers(state) {
    this.ensureMarkers();
    const tgt = (state.targets || []).find((t) => !t.done);
    const pulse = 0.75 + Math.sin(this.time * 3.2) * 0.25;
    if (tgt) {
      this.markerRing.visible = true;
      this.markerBeam.visible = true;
      this.markerRing.position.set(tgt.x, 2, tgt.y);
      this.markerBeam.position.set(tgt.x, 160, tgt.y);
      const s = 1 + Math.sin(this.time * 3.2) * 0.12;
      this.markerRing.scale.set(s, s, 1);
      this.markerRing.material.opacity = pulse;
      this.markerBeam.material.opacity = 0.14 + Math.sin(this.time * 3.2) * 0.06;
    } else {
      this.markerRing.visible = false;
      this.markerBeam.visible = false;
    }
    const taxi = state.taxi;
    if (taxi && taxi.px !== undefined) {
      this.taxiRingA.visible = true;
      this.taxiRingB.visible = true;
      this.taxiRingA.position.set(taxi.px, 2, taxi.py);
      this.taxiRingB.position.set(taxi.dx, 2, taxi.dy);
      this.taxiRingA.material.opacity = pulse;
      this.taxiRingB.material.opacity = pulse;
    } else {
      this.taxiRingA.visible = false;
      this.taxiRingB.visible = false;
    }
    const gar = state.garage || GARAGE;
    this.garageBeacon.position.set(gar.x, 100, gar.y);
    this.garageBeacon.material.opacity = 0.12 + Math.sin(this.time * 2.4) * 0.05;
    const safe = state.safehouse || SAFEHOUSE;
    this.safeBeacon.position.set(safe.x, 100, safe.y);
    this.safeBeacon.material.opacity = 0.12 + Math.sin(this.time * 2.4 + 1.5) * 0.05;
    // Packages: small gold boxes that bob and spin.
    const pkgs = state.packages || [];
    const seen = new Set();
    for (const pkg of pkgs) {
      if (pkg.done) continue;
      seen.add(pkg.id);
      let m = this.packageMeshes.get(pkg.id);
      if (!m) {
        m = new THREE.Mesh(boxGeo(16, 16, 16), flatMat(0xffc233, { emissive: 0x664400 }));
        this.scene.add(m);
        this.packageMeshes.set(pkg.id, m);
      }
      m.position.set(pkg.x, 14 + Math.sin(this.time * 3 + pkg.id) * 5, pkg.y);
      m.rotation.y = this.time * 1.4 + pkg.id;
    }
    for (const [id, m] of this.packageMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.packageMeshes.delete(id);
      }
    }
  }

  syncFloats(state) {
    const list = state.floats || [];
    // Recycle sprites round-robin; each float gets a sprite keyed by text.
    for (let i = 0; i < this.floatSprites.length; i += 1) {
      this.floatSprites[i].visible = false;
    }
    let slot = 0;
    for (const f of list.slice(0, FLOAT_CAP)) {
      if (!this.floatSprites[slot]) {
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
        this.scene.add(spr);
        this.floatSprites.push(spr);
      }
      const spr = this.floatSprites[slot];
      slot += 1;
      const base = textSprite(f.text, f.color || '#ffffff');
      spr.material.map = base.material.map;
      spr.material.needsUpdate = true;
      spr.scale.copy(base.scale);
      spr.position.set(f.x, (f.z || 0) + 30, f.y);
      spr.material.opacity = clamp(f.life / 1.4, 0, 1);
      spr.visible = true;
    }
  }

  // ---------- sky / lighting ----------
  updateSky(state) {
    const tod = this.tuneTouched ? this.tune.tod : (state.timeOfDay ?? 0.32);
    const k = dayKey(tod);
    this.scene.background.copy(k.sky);
    this.scene.fog.color.copy(k.fog);
    this.sun.color.copy(k.sun);
    this.sun.intensity = k.sunI;
    this.hemi.intensity = k.hemi;
    // Sun swings across the sky with time of day.
    const sunAng = Math.PI * (0.15 + tod * 0.7);
    this.sun.position.set(Math.cos(sunAng) * 2200, Math.sin(sunAng) * 2000 + 200, 900);
    // Night factor blends street lights, headlights and cloud dimming.
    const nf = clamp((0.26 - tod) / 0.1, 0, 1) + clamp((tod - 0.78) / 0.1, 0, 1);
    this.nightFactor = clamp(nf, 0, 1);
    for (const spr of this.streetGlow) spr.material.opacity = this.nightFactor * 0.85;
    for (const c of this.clouds) c.material.opacity = 0.35 - this.nightFactor * 0.22;
    if (this.waterMesh) this.waterMesh.material.opacity = 0.9 + Math.sin(this.time * 0.8) * 0.03;
    // Clouds drift with the wind (ambient layer).
    for (const c of this.clouds) {
      c.position.x += c.userData.drift * 0.016;
      if (c.position.x > 3600) c.position.x = -300;
    }
  }

  // ---------- camera rig ----------
  // Chase cam: exponential damping (ease-out-expo feel), FOV kick by speed,
  // trauma-squared shake, hard snap on teleport (>600 units).
  updateCamera(state, screen, dt) {
    const p = state.player;
    const tune = this.tune;
    if (screen === SCREEN_TITLE || !p) {
      this.titleAngle += dt * 0.045;
      const cx = WORLD.width / 2 + Math.cos(this.titleAngle) * 1500;
      const cz = WORLD.height / 2 + Math.sin(this.titleAngle) * 1100;
      const targetPos = new THREE.Vector3(cx, 950, cz);
      const targetLook = new THREE.Vector3(WORLD.width / 2, 0, WORLD.height / 2);
      this.camPos.lerp(targetPos, 1 - Math.exp(-1.2 * dt));
      this.camLook.lerp(targetLook, 1 - Math.exp(-1.2 * dt));
      this.camFov = damp(this.camFov, 55, 2, dt);
    } else {
      const onFoot = !!p.onFoot;
      const dist = onFoot ? CAMERA.footDist : tune.dist;
      const height = onFoot ? CAMERA.footHeight : tune.height;
      const fx = Math.cos(p.angle);
      const fz = Math.sin(p.angle);
      const px = p.x;
      const pz = p.y;
      const targetPos = new THREE.Vector3(px - fx * dist, height, pz - fz * dist);
      const targetLook = new THREE.Vector3(px + fx * CAMERA.lookAhead, 12, pz + fz * CAMERA.lookAhead);
      // Teleport snap: if the player jumped, don't sweep across the map.
      if (this.camPos.distanceTo(targetPos) > 600) {
        this.camPos.copy(targetPos);
        this.camLook.copy(targetLook);
      } else {
        this.camPos.x = damp(this.camPos.x, targetPos.x, 4.2, dt);
        this.camPos.y = damp(this.camPos.y, targetPos.y, 4.2, dt);
        this.camPos.z = damp(this.camPos.z, targetPos.z, 4.2, dt);
        this.camLook.x = damp(this.camLook.x, targetLook.x, 6, dt);
        this.camLook.y = damp(this.camLook.y, targetLook.y, 6, dt);
        this.camLook.z = damp(this.camLook.z, targetLook.z, 6, dt);
      }
      const speed = Math.abs(p.car ? p.car.speed : (p.speed || 0));
      const targetFov = tune.fov + clamp(speed / 680, 0, 1) * CAMERA.fovBoost + (state.nosBoosting ? 4 : 0);
      this.camFov = damp(this.camFov, targetFov, 3, dt);
    }
    // Trauma shake: offset ~ trauma^2 (Disney follow-through: shake decays).
    // Trauma sources: taking damage (HP drop) and NOS kick.
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const hpNow = state.player ? state.player.hp : 100;
    if (this._camHp !== undefined && hpNow < this._camHp) {
      this.trauma = Math.min(1, this.trauma + 0.45);
    }
    this._camHp = hpNow;
    if (state.nosBoosting && !this._wasBoosting) this.trauma = Math.min(1, this.trauma + 0.15);
    this._wasBoosting = !!state.nosBoosting;
    this.shakeT += dt * 34;
    const sh = this.trauma * this.trauma;
    const ox = sh * 16 * (Math.sin(this.shakeT * 1.13) + Math.sin(this.shakeT * 2.71) * 0.5);
    const oy = sh * 12 * (Math.sin(this.shakeT * 1.71 + 2) + Math.sin(this.shakeT * 3.13) * 0.5);
    this.camera.position.set(this.camPos.x + ox, this.camPos.y + oy, this.camPos.z);
    this.camera.lookAt(this.camLook.x + ox * 0.5, this.camLook.y + oy * 0.5, this.camLook.z);
    this.camera.rotation.z += sh * 0.02 * Math.sin(this.shakeT * 1.97);
    if (Math.abs(this.camera.fov - this.camFov) > 0.05) {
      this.camera.fov = this.camFov;
      this.camera.updateProjectionMatrix();
    }
  }

  // ---------- HUD ----------
  showToast(text, ms = 3000) {
    const { toast } = this.hud;
    if (this.lastToast === text && this.time < this.toastUntil) return;
    this.lastToast = text;
    this.toastUntil = this.time + ms / 1000;
    toast.textContent = text;
    toast.style.opacity = '1';
    if (G) G.fromTo(toast, { y: -14 }, { y: 0, duration: 0.35, ease: 'expo.out' });
    window.clearTimeout(this._toastTimer);
    this._toastTimer = window.setTimeout(() => { toast.style.opacity = '0'; }, ms);
  }

  updateHud(state, screen, best, shopItems) {
    const h = this.hud;
    const p = state.player;
    // Wanted stars (pop on change, back.out overshoot).
    const wanted = clamp(state.wanted || 0, 0, 5);
    h.stars.forEach((el, i) => el.classList.toggle('on', i < wanted));
    if (wanted !== this.lastWanted) {
      if (G && wanted > this.lastWanted) G.fromTo(h.stars[wanted - 1], { scale: 1.8 }, { scale: 1, duration: 0.4, ease: 'back.out(2)' });
      this.lastWanted = wanted;
    }
    // Health / armor bars + damage flash (vignette).
    const hp = clamp(p ? p.hp : 100, 0, 100);
    h.hpFill.style.width = `${hp}%`;
    h.armorFill.style.width = `${clamp(p ? p.armor : 0, 0, 100)}%`;
    if (hp < this.lastHp) this.lastHurtAt = this.time;
    this.lastHp = hp;
    const hurtFlash = Math.max(0, 1 - (this.time - this.lastHurtAt) * 1.6);
    const lowHp = hp < 30 ? ((30 - hp) / 30) * 0.35 * (0.6 + 0.4 * Math.sin(this.time * 6)) : 0;
    const wantedPulse = wanted >= 4 ? 0.1 + 0.06 * Math.sin(this.time * 5) : 0;
    h.vig.style.opacity = String(clamp(hurtFlash * 0.55 + lowHp + wantedPulse, 0, 0.75));
    // Mission block.
    const mission = MISSIONS[state.mission - 1];
    h.mName.textContent = mission ? `MISSION ${state.mission}: ${mission.name}` : 'FREE ROAM';
    const tgt = (state.targets || []).find((t) => !t.done);
    h.mObj.textContent = tgt ? tgt.label : (mission ? mission.brief : '');
    h.mTimer.textContent = state.missionTimer > 0
      ? `${Math.floor(state.missionTimer / 60)}:${String(Math.floor(state.missionTimer % 60)).padStart(2, '0')}`
      : '';
    // Money / score / ammo / NOS (gradient fill bar).
    h.cash.textContent = money(state.money || 0);
    h.score.textContent = `SCORE ${Math.round(state.score || 0)}`;
    h.ammo.textContent = String(state.ammo || 0);
    const nosPct = clamp(state.nos || 0, 0, 100);
    h.nosBar.style.background = `linear-gradient(90deg, #f2c94c ${nosPct}%, #333 ${nosPct}%)`;
    // Speedometer + car HP (bottom-center shows only while driving).
    const spd = p ? (p.car ? p.car.speed : (p.speed || 0)) : 0;
    h.speed.firstChild.nodeValue = String(kmh(spd));
    h.bc.style.display = (p && p.car) ? 'block' : 'none';
    if (p && p.car) {
      h.carHpWrap.style.display = 'flex';
      h.carHpFill.style.width = `${clamp(p.car.hp, 0, 100)}%`;
    } else {
      h.carHpWrap.style.display = 'none';
    }
    // District + radio (rotates every 20s of game time).
    if (p) {
      try { h.mapLabel.textContent = `${districtAt(p.x, p.y).name.toUpperCase()} · SOLMAR BAY`; } catch { /* keep */ }
    }
    if (state.time - this.radioAt > 20) {
      this.radioAt = state.time;
      this.radioIdx = (this.radioIdx + 1) % RADIO_STATIONS.length;
      h.radio.textContent = RADIO_STATIONS[this.radioIdx];
    }
    // Mission-change toast.
    if (state.mission !== this.lastMissionIdx && screen === SCREEN_PLAY) {
      this.lastMissionIdx = state.mission;
      if (mission) this.showToast(`MISSION ${state.mission}: ${mission.name}`);
    }
    // HUD visibility: title screen hides the in-game blocks (CSS).
    h.hud.classList.toggle('title-screen', screen === SCREEN_TITLE);
    this.updatePanel(state, screen, best, shopItems);
    this.drawMinimap(state, screen);
  }

  panelSignature(state, screen, best, shopItems) {
    if (screen !== SCREEN_SHOP) return `${screen}|${state.mission}|${state.score}|${state.money}`;
    return `shop|${state.money}|${(shopItems || []).map((i) => `${i.id}:${i.owned ? 1 : 0}`).join(',')}`;
  }

  updatePanel(state, screen, best, shopItems) {
    const { panel } = this.hud;
    const sig = this.panelSignature(state, screen, best, shopItems);
    if (sig === this._panelSig) return;
    const changed = this._panelScreen !== undefined && screen !== this._panelScreen;
    this._panelSig = sig;
    this._panelScreen = screen;
    if (screen === SCREEN_PLAY) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'flex';
    let html = '';
    if (screen === SCREEN_TITLE) {
      html = `<div class="panel"><h1 class="title">SOLMAR BAY</h1>
        <p class="subtitle">A tiny Grand Theft Auto VI — six missions, one city, zero mercy.</p>
        <p class="best">BEST SCORE ${Math.round(best?.score || 0)}${best?.grade ? ` · GRADE ${best.grade}` : ''}</p>
        <p class="prompt">Press ENTER to start</p>
        <p class="muted">WASD drive · SPACE brake · SHIFT NOS · E enter/exit · F interact · R respawn · T tune · M mute</p></div>`;
    } else if (screen === SCREEN_BRIEF) {
      const m = MISSIONS[state.mission - 1];
      const payLine = state.lastPay ? `<p class="cash">PAY ${money(state.lastPay)}</p>` : '';
      html = `<div class="panel"><h1>MISSION COMPLETE</h1>
        <p class="subtitle">${m ? m.name : ''}</p>${payLine}
        <p>SCORE ${Math.round(state.score || 0)} · <span class="green">CASH ${money(state.money || 0)}</span></p>
        <p class="prompt">Press ENTER to continue</p></div>`;
    } else if (screen === SCREEN_OVER) {
      html = `<div class="panel"><h1 class="${state.overReason === 'busted' ? 'gold' : 'red'}">${state.overReason === 'busted' ? 'BUSTED' : 'WASTED'}</h1>
        <p class="subtitle">${state.overReason === 'busted' ? 'The Solmar PD got you.' : 'Solmar Bay claimed another driver.'}</p>
        <p>SCORE ${Math.round(state.score || 0)} · MISSION ${state.mission}/6</p>
        <p class="prompt">Press ENTER to retry</p></div>`;
    } else if (screen === SCREEN_VICTORY) {
      html = `<div class="panel"><h1 class="gold">VICTORY</h1>
        <p class="subtitle">All six missions complete. Solmar Bay is yours.</p>
        <p>GRADE <span class="gold">${state.grade || '—'}</span> · SCORE ${Math.round(state.score || 0)}</p>
        <p class="cash">CASH ${money(state.money || 0)}</p>
        <p class="prompt">Press ENTER to play again</p></div>`;
    } else if (screen === SCREEN_PAUSED) {
      html = `<div class="panel"><h1>PAUSED</h1>
        <p class="subtitle">Take a breath. The city waits.</p>
        <p class="prompt">Press ESC or P to resume</p></div>`;
    } else if (screen === SCREEN_SHOP) {
      const rows = (shopItems || []).map((item, i) => {
        const afford = state.money >= item.price;
        const owned = !!item.owned;
        return `<button type="button" class="shop-row ${owned ? 'owned' : ''} ${afford || owned ? '' : 'cant'}" data-shop-id="${item.id}">
          <span class="key">${i + 1}</span>
          <span class="name">${item.name}</span>
          <span class="desc">${item.desc || ''}</span>
          <span class="price">${owned ? 'OWNED' : money(item.price)}</span>
        </button>`;
      }).join('');
      html = `<div class="panel"><h1>SOLMAR AUTO</h1>
        <p class="cash">Cash ${money(state.money || 0)} — click a row or press 1–6</p>
        ${rows}
        <p class="prompt">Press E to close</p></div>`;
    }
    panel.innerHTML = html;
    if (screen === SCREEN_SHOP) {
      for (const row of panel.querySelectorAll('.shop-row')) {
        row.addEventListener('click', () => this.onShopBuy(row.dataset.shopId));
      }
    }
    if (changed && G) {
      const inner = panel.querySelector('.panel');
      if (inner) G.fromTo(inner, { scale: 0.96, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.32, ease: 'expo.out' });
    }
    const status = document.getElementById('status');
    if (status) status.textContent = screen === SCREEN_TITLE ? 'Solmar Bay title screen' : `Solmar Bay — ${screen}`;
  }

  // ---------- minimap ----------
  drawMinimap(state, screen) {
    const cv = this.hud.minimap;
    const g = cv.getContext('2d');
    if (!g) return;
    const W = cv.width;
    const H = cv.height;
    const sx = W / WORLD.width;
    const sy = H / WORLD.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0e1a24';
    g.fillRect(0, 0, W, H);
    // Water + beach on the east edge (water east of x=3200).
    g.fillStyle = PALETTE.water;
    g.fillRect(WORLD.width * sx, 0, (W - WORLD.width * sx), H);
    g.fillStyle = PALETTE.sand;
    g.fillRect(3050 * sx, 0, 150 * sx, H);
    // Districts (tinted rects from config).
    for (const d of DISTRICTS) {
      g.fillStyle = d.tint || '#234';
      g.globalAlpha = 0.3;
      g.fillRect(d.x0 * sx, d.y0 * sy, (d.x1 - d.x0) * sx, (d.y1 - d.y0) * sy);
      g.globalAlpha = 1;
    }
    // Roads from the ROADS_X / ROADS_Y grid.
    g.strokeStyle = '#9aa3ad';
    g.lineWidth = 2;
    for (const y of ROADS_Y) {
      g.beginPath();
      g.moveTo(0, y * sy);
      g.lineTo(W, y * sy);
      g.stroke();
    }
    for (const x of ROADS_X) {
      g.beginPath();
      g.moveTo(x * sx, 0);
      g.lineTo(x * sx, H);
      g.stroke();
    }
    // Buildings (every 4th, cheap dots).
    g.fillStyle = '#c7cdd6';
    const bl = this.cityRef?.buildings || [];
    for (let i = 0; i < bl.length; i += 4) {
      g.fillRect((bl[i].x + bl[i].width / 2) * sx - 1, (bl[i].y + bl[i].height / 2) * sy - 1, 2, 2);
    }
    // Garage + safehouse.
    const gar = state.garage || GARAGE;
    const safe = state.safehouse || SAFEHOUSE;
    g.fillStyle = '#39d353';
    g.fillRect(gar.x * sx - 3, gar.y * sy - 3, 6, 6);
    g.fillStyle = '#8b5cf6';
    g.fillRect(safe.x * sx - 3, safe.y * sy - 3, 6, 6);
    // Targets.
    for (const t of state.targets || []) {
      if (t.done) continue;
      g.fillStyle = '#ffc233';
      g.beginPath();
      g.arc(t.x * sx, t.y * sy, 4, 0, TAU);
      g.fill();
    }
    // Police (blue dots), taxi (cyan).
    g.fillStyle = '#3b82f6';
    for (const c of state.cars || []) {
      if (c.kind === 'police') {
        g.beginPath();
        g.arc(c.x * sx, c.y * sy, 2.5, 0, TAU);
        g.fill();
      }
    }
    if (state.taxi && state.taxi.px !== undefined) {
      g.fillStyle = '#22d3ee';
      g.beginPath();
      g.arc(state.taxi.px * sx, state.taxi.py * sy, 3, 0, TAU);
      g.fill();
    }
    // Player arrow (white, rotated to heading).
    const p = state.player;
    if (p) {
      const px = p.x * sx;
      const py = p.y * sy;
      g.save();
      g.translate(px, py);
      g.rotate(p.angle);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(7, 0);
      g.lineTo(-5, -4);
      g.lineTo(-5, 4);
      g.closePath();
      g.fill();
      g.restore();
      // Camera view frame (gold outline around the player).
      g.strokeStyle = 'rgba(255,209,102,0.8)';
      g.lineWidth = 1;
      g.strokeRect(px - 26, py - 17, 52, 34);
    }
    void screen;
  }

  // ---------- main entry ----------
  draw(state, city, screen, best, shopItems) {
    const now = performance.now() / 1000;
    const dt = this._lastT ? clamp(now - this._lastT, 0.001, 0.1) : 0.016;
    this._lastT = now;
    this.time += dt;
    if (city && city !== this.cityRef) {
      this.cityRef = city;
      this.buildCity(city);
    }
    if (screen !== this.lastScreen) this.lastScreen = screen;
    this.updateSky(state);
    this.syncCars(state, dt);
    this.syncPeds(state);
    this.syncPlayerFigure(state, dt);
    this.syncHeli(state);
    this.syncMarkers(state);
    this.syncFloats(state);
    this.syncParticles(state);
    this.updateCamera(state, screen, dt);
    this.updateHud(state, screen, best, shopItems);
    this.gl.render(this.scene, this.camera);
  }

  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, hit)) return { x: hit.x, y: hit.z };
    return { x: 0, y: 0 };
  }
}

export function createRenderer(canvas, opts) {
  return new SolmarRenderer(canvas, opts);
}
