// Solmar Bay — tuning numbers, palette and city layout in one place.
// The viewport is a fixed 1280x720 logical area; the camera scrolls over a
// 3200x2400 city. The simulation runs in fixed 1/60 s steps.

export const STEP = 1 / 60;
export const VIEW = { width: 1280, height: 720 };

export const WORLD = { width: 3200, height: 2400 };
export const ROAD_W = 96;
export const ROADS_X = [200, 600, 1000, 1400, 1800, 2200, 2600, 3000];
export const ROADS_Y = [200, 500, 800, 1100, 1400, 1700, 2000, 2200];

export const DISTRICTS = [
  { name: 'NORTHSIDE', x0: 200, y0: 200, x1: 3000, y1: 800, tint: '#3d4a63' },
  { name: 'HARBOR', x0: 200, y0: 800, x1: 1000, y1: 1400, tint: '#4a5a6e' },
  { name: 'DOWNTOWN', x0: 1000, y0: 800, x1: 2200, y1: 1700, tint: '#565064' },
  { name: 'INDUSTRIAL', x0: 2200, y0: 800, x1: 3200, y1: 1700, tint: '#5c5648' },
  { name: 'MARINA', x0: 200, y0: 1700, x1: 1400, y1: 2400, tint: '#3f5a55' },
  { name: 'PALM COURT', x0: 1400, y0: 1700, x1: 3200, y1: 2400, tint: '#5a5240' },
];

export const PLAYER = {
  radius: 13,
  walkSpeed: 230,
  sprintSpeed: 320,
  hp: 100,
  punchDamage: 25,
  punchRange: 46,
};

export const CAR_MODELS = [
  { id: 'sedan', name: 'Marina Sedan', price: 0, maxSpeed: 420, accel: 300, turn: 3.1, hp: 100 },
  { id: 'taxi', name: 'Bay Taxi', price: 800, maxSpeed: 460, accel: 340, turn: 3.3, hp: 110 },
  { id: 'muscle', name: 'Solmar Muscle', price: 2500, maxSpeed: 560, accel: 420, turn: 3.0, hp: 130 },
  { id: 'sport', name: 'Vortex GT', price: 6000, maxSpeed: 680, accel: 520, turn: 3.6, hp: 140 },
  { id: 'police', name: 'SBPD Interceptor', price: 0, maxSpeed: 600, accel: 480, turn: 3.5, hp: 160 },
];

export const TRAFFIC_COUNT = 26;
export const PED_COUNT = 34;
export const MAX_POLICE = 6;

export const WANTED = {
  decayDelay: 6, // seconds unseen before a star starts fading
  decayPerStar: 4, // seconds per star after the delay
  sightRange: 520,
};

export const ECONOMY = {
  repair: 60,
  armor: 400,
  ammo: 100,
  ammoPack: 24,
  taxiFareMin: 40,
  taxiFareMax: 90,
  packagePay: 25,
};

export const MISSIONS = [
  { id: 1, name: 'First Delivery', brief: 'Marisol needs a package across town. Drive to the gold marker.', pay: 300 },
  { id: 2, name: 'Hot Wheels', brief: 'Steal the red Muscle car at the docks and bring it to the garage.', pay: 450 },
  { id: 3, name: 'Taxi Rush', brief: 'Pick up the fare at Palm Court and drop them off before the clock runs out.', pay: 350 },
  { id: 4, name: 'Heat Run', brief: 'The cops are onto you. Get 3 stars, then lose them at the safehouse.', pay: 600 },
  { id: 5, name: 'The Collection', brief: 'Pick up 3 stashes around the city. Stay sharp — the streets are watching.', pay: 700 },
  { id: 6, name: 'The Big Score', brief: 'Hit the Downtown bank, grab the cash, and lose a 4-star wanted at the safehouse.', pay: 1500 },
];

export const PALETTE = {
  backdrop: '#0d1117',
  grass: '#39543d',
  sand: '#c2a878',
  water: '#1d4e6b',
  road: '#33373d',
  roadLine: '#c8b45a',
  sidewalk: '#4a4d52',
  building: ['#5a5f6b', '#6b5a4a', '#4a5a6b', '#6b4a5a', '#555f4a', '#7a6a4a'],
  park: '#2f5a33',
  tree: '#2a7a35',
  text: '#f2f0e6',
  muted: '#a8a89a',
  gold: '#f2c94c',
  red: '#e5534b',
  blue: '#4fc3f7',
  green: '#58c96b',
  panel: 'rgba(16, 20, 28, 0.92)',
  panelEdge: '#f2c94c',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export const SAVE_KEY = 'solmar-bay.save.v1';
export const BEST_KEY = 'solmar-bay.best.v1';

export const SPAWN = { x: 560, y: 1860 };
export const GARAGE = { x: 1180, y: 980 };
export const SAFEHOUSE = { x: 520, y: 1900 };
export const BANK = { x: 1600, y: 1250 };
