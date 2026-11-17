// Drawing only: the world's state and the current screen in, pixels out.
// The camera follows the player over the 3200x2400 city; the HUD, minimap
// and panels are drawn in 1280x720 logical space on top.

import { BANK, DISTRICTS, FONT, GARAGE, MISSIONS, PALETTE, ROADS_X, ROADS_Y, ROAD_W, SAFEHOUSE, VIEW, WORLD } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_BRIEF = 'brief';
export const SCREEN_SHOP = 'shop';
export const SCREEN_VICTORY = 'victory';

const MINI = { x: VIEW.width - 244, y: VIEW.height - 184, w: 220, h: 160 };

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const camera = { x: 0, y: 0 };
  const fonts = new Map();

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
  }

  function text(value, x, y, size, color, align, weight) {
    const key = `${size}:${weight || ''}`;
    if (!fonts.has(key)) fonts.set(key, `${weight || ''} ${size}px ${FONT}`);
    context.font = fonts.get(key);
    context.fillStyle = color;
    context.textAlign = align || 'left';
    context.textBaseline = 'alphabetic';
    context.fillText(value, x, y);
  }

  function rr(x, y, w, h, r) {
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r);
    context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r);
    context.arcTo(x, y, x + w, y, r);
    context.closePath();
  }

  function nightFactor(timeOfDay) {
    // 0 = noon, 1 = midnight. Day runs 0.25..0.75 of the cycle.
    const t = timeOfDay;
    if (t >= 0.25 && t <= 0.7) return 0;
    if (t < 0.25) return Math.min(0.42, (0.25 - t) * 2.4);
    return Math.min(0.42, (t - 0.7) * 2.4);
  }

  function drawCity(state, city) {
    const cam = camera;
    // Ground.
    context.fillStyle = PALETTE.grass;
    context.fillRect(cam.x - 40, cam.y - 40, VIEW.width + 80, VIEW.height + 80);
    // Water (west) and sand.
    context.fillStyle = PALETTE.water;
    context.fillRect(-cam.x - 40, -cam.y - 40, 140, VIEW.height + 80);
    context.fillStyle = PALETTE.sand;
    context.fillRect(100 - cam.x, -cam.y - 40, 100, VIEW.height + 80);
    // Parks.
    for (const park of city.parks) {
      context.fillStyle = PALETTE.park;
      context.fillRect(park.x - cam.x, park.y - cam.y, park.width, park.height);
    }
    // Parking lots: asphalt with painted bays.
    for (const lot of city.lots || []) {
      context.fillStyle = '#3a3f45';
      context.fillRect(lot.x - cam.x, lot.y - cam.y, lot.width, lot.height);
      context.strokeStyle = 'rgba(242,240,230,0.5)';
      context.lineWidth = 2;
      const bays = Math.max(2, Math.floor(lot.width / 46));
      for (let i = 0; i <= bays; i += 1) {
        const bx = lot.x + (i * lot.width) / bays - cam.x;
        context.beginPath();
        context.moveTo(bx, lot.y + 8 - cam.y);
        context.lineTo(bx, lot.y + lot.height - 8 - cam.y);
        context.stroke();
      }
    }
    // District tints (subtle) + labels.
    for (const d of DISTRICTS) {
      context.fillStyle = d.tint;
      context.globalAlpha = 0.16;
      context.fillRect(d.x0 - cam.x, d.y0 - cam.y, d.x1 - d.x0, d.y1 - d.y0);
      context.globalAlpha = 1;
    }
    // Roads.
    context.fillStyle = PALETTE.road;
    for (const rx of ROADS_X) context.fillRect(rx - ROAD_W / 2 - cam.x, 0 - cam.y, ROAD_W, WORLD.height);
    for (const ry of ROADS_Y) context.fillRect(0 - cam.x, ry - ROAD_W / 2 - cam.y, WORLD.width, ROAD_W);
    // Beach road.
    context.fillRect(120 - cam.x, 0 - cam.y, 80, WORLD.height);
    // Lane dashes.
    context.fillStyle = PALETTE.roadLine;
    for (const rx of ROADS_X) {
      for (let y = 0; y < WORLD.height; y += 64) {
        context.fillRect(rx - 2 - cam.x, y - cam.y, 4, 30);
      }
    }
    for (const ry of ROADS_Y) {
      for (let x = 0; x < WORLD.width; x += 64) {
        context.fillRect(x - cam.x, ry - 2 - cam.y, 30, 4);
      }
    }
    // Sidewalks.
    context.fillStyle = PALETTE.sidewalk;
    for (const rx of ROADS_X) {
      context.fillRect(rx - ROAD_W / 2 - 10 - cam.x, 0 - cam.y, 8, WORLD.height);
      context.fillRect(rx + ROAD_W / 2 + 2 - cam.x, 0 - cam.y, 8, WORLD.height);
    }
    // Buildings.
    for (const b of city.buildings) {
      context.fillStyle = 'rgba(0,0,0,0.35)';
      context.fillRect(b.x + 6 - cam.x, b.y + 8 - cam.y, b.width, b.height);
      context.fillStyle = b.color;
      context.fillRect(b.x - cam.x, b.y - cam.y, b.width, b.height);
      context.fillStyle = 'rgba(255,255,255,0.10)';
      context.fillRect(b.x - cam.x, b.y - cam.y, b.width, 6);
      // Windows.
      context.fillStyle = 'rgba(255, 220, 120, 0.55)';
      const cols = Math.max(1, Math.floor(b.width / 26));
      const rows = Math.max(1, Math.floor(b.height / 30));
      for (let cx = 0; cx < cols; cx += 1) {
        for (let cy = 0; cy < rows; cy += 1) {
          if ((cx * 7 + cy * 13 + b.x) % 3 === 0) continue;
          context.fillRect(b.x + 8 + cx * 26 - cam.x, b.y + 10 + cy * 30 - cam.y, 12, 14);
        }
      }
      if (b.tall) {
        context.fillStyle = 'rgba(255,255,255,0.16)';
        context.fillRect(b.x + b.width / 2 - 4 - cam.x, b.y - 26 - cam.y, 8, 26);
      }
    }
    // Trees.
    for (const tree of city.trees) {
      context.fillStyle = 'rgba(0,0,0,0.3)';
      context.beginPath();
      context.arc(tree.x + 3 - cam.x, tree.y + 4 - cam.y, tree.r, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = tree.palm ? '#3f9e4d' : PALETTE.tree;
      context.beginPath();
      context.arc(tree.x - cam.x, tree.y - cam.y, tree.r, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = 'rgba(255,255,255,0.18)';
      context.beginPath();
      context.arc(tree.x - tree.r * 0.3 - cam.x, tree.y - tree.r * 0.3 - cam.y, tree.r * 0.45, 0, Math.PI * 2);
      context.fill();
    }
    // District labels.
    for (const d of DISTRICTS) {
      const cx = (d.x0 + d.x1) / 2 - cam.x;
      const cy = (d.y0 + d.y1) / 2 - cam.y;
      if (cx < -100 || cx > VIEW.width + 100 || cy < -40 || cy > VIEW.height + 40) continue;
      text(d.name, cx, cy, 30, 'rgba(255,255,255,0.20)', 'center', '800');
    }
    // Key places.
    drawPlace(GARAGE.x, GARAGE.y, 'GARAGE', '#f2c94c');
    drawPlace(SAFEHOUSE.x, SAFEHOUSE.y, 'SAFEHOUSE', '#58c96b');
    drawPlace(BANK.x, BANK.y, 'BANK', '#e5534b');
  }

  function drawPlace(x, y, label, color) {
    const sx = x - camera.x;
    const sy = y - camera.y;
    if (sx < -80 || sx > VIEW.width + 80 || sy < -40 || sy > VIEW.height + 40) return;
    context.fillStyle = color;
    context.beginPath();
    context.arc(sx, sy, 16, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#11141b';
    text(label[0], sx, sy + 6, 16, '#11141b', 'center', '800');
    text(label, sx, sy + 34, 13, color, 'center', '700');
  }

  function drawCar(car, time) {
    const sx = car.x - camera.x;
    const sy = car.y - camera.y;
    if (sx < -60 || sx > VIEW.width + 60 || sy < -60 || sy > VIEW.height + 60) return;
    context.save();
    context.translate(sx, sy);
    context.rotate(car.angle);
    // Shadow.
    context.fillStyle = 'rgba(0,0,0,0.35)';
    rr(-21, -11 + 4, 44, 26, 8);
    context.fill();
    // Body.
    context.fillStyle = car.color;
    rr(-22, -12, 44, 24, 8);
    context.fill();
    // Cabin + windshield.
    context.fillStyle = 'rgba(20,28,38,0.9)';
    rr(-6, -10, 16, 20, 5);
    context.fill();
    context.fillStyle = 'rgba(180,220,255,0.5)';
    rr(8, -10, 6, 20, 3);
    context.fill();
    // Headlights.
    context.fillStyle = '#ffe9a8';
    context.fillRect(20, -10, 3, 5);
    context.fillRect(20, 5, 3, 5);
    // Police livery.
    if (car.kind === 'police') {
      context.fillStyle = '#f2f0e6';
      context.fillRect(-14, -12, 10, 24);
      text('PD', 0, 5, 11, '#11141b', 'center', '800');
      // Flashing light bar.
      const on = Math.floor(time * 4) % 2 === 0;
      context.fillStyle = on ? '#ff3b30' : '#2f7bff';
      context.fillRect(-2, -13, 8, 5);
      context.fillStyle = on ? '#2f7bff' : '#ff3b30';
      context.fillRect(-2, 8, 8, 5);
    }
    if (car.kind === 'target') {
      context.strokeStyle = '#f2c94c';
      context.lineWidth = 2;
      context.strokeRect(-24, -14, 48, 28);
    }
    context.restore();
    // Damage smoke.
    if (car.hp < car.maxHp * 0.4) {
      context.fillStyle = 'rgba(120,120,120,0.6)';
      context.beginPath();
      context.arc(sx - Math.cos(car.angle) * 18, sy - Math.sin(car.angle) * 18, 6 + Math.sin(time * 6) * 2, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawPed(ped) {
    const sx = ped.x - camera.x;
    const sy = ped.y - camera.y;
    if (sx < -30 || sx > VIEW.width + 30 || sy < -30 || sy > VIEW.height + 30) return;
    if (ped.down > 0) {
      context.fillStyle = ped.color;
      context.beginPath();
      context.arc(sx, sy, 10, 0, Math.PI * 2);
      context.fill();
      return;
    }
    context.fillStyle = 'rgba(0,0,0,0.3)';
    context.beginPath();
    context.arc(sx + 2, sy + 3, 9, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = ped.color;
    context.beginPath();
    context.arc(sx, sy, 9, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#e8c39a';
    context.beginPath();
    context.arc(sx + Math.cos(ped.angle) * 3, sy + Math.sin(ped.angle) * 3, 5, 0, Math.PI * 2);
    context.fill();
  }

  function drawPlayer(state) {
    const p = state.player;
    const sx = p.x - camera.x;
    const sy = p.y - camera.y;
    if (p.onFoot) {
      if (p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0) return; // blink
      context.fillStyle = 'rgba(0,0,0,0.35)';
      context.beginPath();
      context.arc(sx + 2, sy + 4, 11, 0, Math.PI * 2);
      context.fill();
      // Body.
      context.fillStyle = '#f2f0e6';
      context.beginPath();
      context.arc(sx, sy, 11, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#e5534b';
      context.beginPath();
      context.arc(sx, sy, 11, 0, Math.PI * 2);
      context.fill();
      // Head + direction tick.
      context.fillStyle = '#e8c39a';
      context.beginPath();
      context.arc(sx + Math.cos(p.angle) * 4, sy + Math.sin(p.angle) * 4, 6, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = '#11141b';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(sx + Math.cos(p.angle) * 10, sy + Math.sin(p.angle) * 10);
      context.lineTo(sx + Math.cos(p.angle) * 18, sy + Math.sin(p.angle) * 18);
      context.stroke();
      // Pistol in hand.
      context.fillStyle = '#222';
      context.fillRect(sx + Math.cos(p.angle) * 12 - 3, sy + Math.sin(p.angle) * 12 - 2, 7, 4);
    }
    // Busted progress ring.
    if (p.busted > 0) {
      context.strokeStyle = '#e5534b';
      context.lineWidth = 4;
      context.beginPath();
      context.arc(sx, sy, 22, -Math.PI / 2, -Math.PI / 2 + (p.busted / 1.5) * Math.PI * 2);
      context.stroke();
    }
  }

  function drawMarker(x, y, color, label, pulse) {
    const sx = x - camera.x;
    const sy = y - camera.y;
    if (sx < -100 || sx > VIEW.width + 100 || sy < -100 || sy > VIEW.height + 100) return;
    const r = 16 + Math.sin(pulse * 5) * 4;
    // Beam.
    const grad = context.createLinearGradient(sx, sy - 140, sx, sy);
    grad.addColorStop(0, 'rgba(242,201,76,0)');
    grad.addColorStop(1, color);
    context.fillStyle = grad;
    context.globalAlpha = 0.5;
    context.fillRect(sx - 3, sy - 140, 6, 140);
    context.globalAlpha = 1;
    // Diamond.
    context.save();
    context.translate(sx, sy);
    context.rotate(Math.PI / 4);
    context.fillStyle = color;
    context.fillRect(-r / 1.4, -r / 1.4, r * 1.4, r * 1.4);
    context.restore();
    context.fillStyle = '#11141b';
    context.beginPath();
    context.arc(sx, sy, 7, 0, Math.PI * 2);
    context.fill();
    if (label) text(label, sx, sy - 150, 15, color, 'center', '800');
  }

  function drawMinimap(state) {
    const sx = MINI.x;
    const sy = MINI.y;
    const scaleX = MINI.w / WORLD.width;
    const scaleY = MINI.h / WORLD.height;
    context.fillStyle = 'rgba(10,14,20,0.88)';
    rr(sx - 6, sy - 6, MINI.w + 12, MINI.h + 12, 8);
    context.fill();
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 1.5;
    rr(sx - 6, sy - 6, MINI.w + 12, MINI.h + 12, 8);
    context.stroke();
    context.save();
    context.beginPath();
    context.rect(sx, sy, MINI.w, MINI.h);
    context.clip();
    // Water + sand.
    context.fillStyle = PALETTE.water;
    context.fillRect(sx, sy, 100 * scaleX, MINI.h);
    context.fillStyle = PALETTE.sand;
    context.fillRect(sx + 100 * scaleX, sy, 100 * scaleX, MINI.h);
    context.fillStyle = '#24351f';
    context.fillRect(sx, sy, MINI.w, MINI.h);
    // Roads.
    context.strokeStyle = '#5a6068';
    context.lineWidth = 3;
    for (const rx of ROADS_X) {
      context.beginPath();
      context.moveTo(sx + rx * scaleX, sy);
      context.lineTo(sx + rx * scaleX, sy + MINI.h);
      context.stroke();
    }
    for (const ry of ROADS_Y) {
      context.beginPath();
      context.moveTo(sx, sy + ry * scaleY);
      context.lineTo(sx + MINI.w, sy + ry * scaleY);
      context.stroke();
    }
    function dot(x, y, color, r) {
      context.fillStyle = color;
      context.beginPath();
      context.arc(sx + x * scaleX, sy + y * scaleY, r, 0, Math.PI * 2);
      context.fill();
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
    // Player.
    context.strokeStyle = '#fff';
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(sx + state.player.x * scaleX, sy + state.player.y * scaleY, 5, 0, Math.PI * 2);
    context.stroke();
    dot(state.player.x, state.player.y, '#fff', 3.5);
    // Viewport rectangle.
    context.strokeStyle = 'rgba(255,255,255,0.5)';
    context.lineWidth = 1;
    context.strokeRect(sx + camera.x * scaleX, sy + camera.y * scaleY, VIEW.width * scaleX, VIEW.height * scaleY);
    context.restore();
    text('SOLMAR BAY', sx + MINI.w / 2, sy + MINI.h + 22, 12, PALETTE.muted, 'center', '700');
  }

  function drawHud(state, screen) {
    const p = state.player;
    // Top-left: wanted stars + HP + armor.
    context.fillStyle = 'rgba(10,14,20,0.75)';
    rr(16, 14, 250, 86, 10);
    context.fill();
    let stars = '';
    for (let i = 0; i < 5; i += 1) stars += i < state.wanted ? '★' : '☆';
    text(stars, 28, 44, 26, state.wanted > 0 ? '#ffb02e' : '#8b93a3', 'left', '800');
    // HP bar.
    context.fillStyle = '#222';
    rr(28, 56, 150, 12, 6);
    context.fill();
    context.fillStyle = p.hp > 30 ? '#58c96b' : '#e5534b';
    rr(28, 56, 150 * (p.hp / 100), 12, 6);
    context.fill();
    text(`HP ${Math.ceil(p.hp)}`, 186, 68, 14, PALETTE.text, 'left', '700');
    if (state.armor > 0) {
      context.fillStyle = '#222';
      rr(28, 74, 150, 8, 4);
      context.fill();
      context.fillStyle = '#4fc3f7';
      rr(28, 74, 150 * (state.armor / 100), 8, 4);
      context.fill();
      text(`ARMOR ${Math.ceil(state.armor)}`, 186, 82, 12, '#4fc3f7', 'left', '700');
    }
    // Top-centre: mission banner.
    const mission = state.mission <= 6 ? MISSIONS[state.mission - 1] : null;
    const target = state.targets.find((tg) => !tg.done);
    context.fillStyle = 'rgba(10,14,20,0.75)';
    rr(VIEW.width / 2 - 300, 14, 600, 66, 10);
    context.fill();
    if (mission) {
      text(`MISSION ${mission.id} — ${mission.name.toUpperCase()}`, VIEW.width / 2, 40, 18, PALETTE.gold, 'center', '800');
      text(target ? target.label : mission.brief, VIEW.width / 2, 64, 15, PALETTE.text, 'center');
      if (state.mission === 3 && state.missionTimer > 0) {
        text(`${Math.ceil(state.missionTimer)}s`, VIEW.width / 2 + 320, 44, 22, state.missionTimer < 20 ? '#e5534b' : PALETTE.text, 'left', '800');
      }
    } else {
      text('FREE ROAM — SOLMAR BAY IS YOURS', VIEW.width / 2, 40, 18, PALETTE.gold, 'center', '800');
      text('Side jobs: taxi fares (cyan) · courier packages (green) · garage (gold)', VIEW.width / 2, 64, 15, PALETTE.text, 'center');
    }
    // Top-right: cash + score + ammo.
    context.fillStyle = 'rgba(10,14,20,0.75)';
    rr(VIEW.width - 266, 14, 250, 86, 10);
    context.fill();
    text(`$${state.money.toLocaleString('en-US')}`, VIEW.width - 28, 46, 26, '#58c96b', 'right', '800');
    text(`SCORE ${state.score.toLocaleString('en-US')}`, VIEW.width - 28, 70, 14, PALETTE.muted, 'right', '700');
    if (p.onFoot) text(`AMMO ${state.ammo}`, VIEW.width - 28, 90, 14, PALETTE.text, 'right', '700');
    // Bottom-left: contextual controls.
    const hints = [];
    if (p.onFoot) {
      hints.push('WASD walk · SHIFT sprint · F punch · CLICK shoot');
      const near = nearestCar(state);
      if (near) hints.push(`E — ${near.kind === 'traffic' ? 'steal car (wanted +1)' : near.kind === 'police' ? 'steal cruiser!' : 'get in car'}`);
      if (dist2(p.x, p.y, GARAGE.x, GARAGE.y) < 130) hints.push('E — open garage shop');
      if (state.taxi && state.taxi.stage === 0 && dist2(p.x, p.y, state.taxi.px, state.taxi.py) < 70) hints.push('E — pick up fare');
    } else {
      hints.push('WASD drive · SPACE handbrake · E exit car');
      if (p.car) hints.push(`${p.car.name} · HP ${Math.ceil(p.car.hp)}/${p.car.maxHp}`);
    }
    hints.push('P pause · M mute');
    context.fillStyle = 'rgba(10,14,20,0.6)';
    rr(16, VIEW.height - 24 - hints.length * 20, 430, hints.length * 20 + 12, 8);
    context.fill();
    hints.forEach((h, i) => text(h, 28, VIEW.height - 24 - (hints.length - 1 - i) * 20, 13, PALETTE.muted, 'left'));
    // Message toast.
    if (state.message) {
      context.fillStyle = 'rgba(10,14,20,0.85)';
      const w = Math.min(720, 40 + state.message.length * 8);
      rr(VIEW.width / 2 - w / 2, 96, w, 34, 8);
      context.fill();
      text(state.message, VIEW.width / 2, 119, 16, PALETTE.gold, 'center', '700');
    }
    // Car HP bar when driving.
    if (!p.onFoot && p.car) {
      const w = 260;
      context.fillStyle = 'rgba(10,14,20,0.75)';
      rr(VIEW.width / 2 - w / 2, VIEW.height - 40, w, 22, 8);
      context.fill();
      context.fillStyle = '#222';
      rr(VIEW.width / 2 - w / 2 + 8, VIEW.height - 34, w - 16, 10, 5);
      context.fill();
      context.fillStyle = p.car.hp > 40 ? '#4fc3f7' : '#e5534b';
      rr(VIEW.width / 2 - w / 2 + 8, VIEW.height - 34, (w - 16) * (p.car.hp / p.car.maxHp), 10, 5);
      context.fill();
    }
    drawMinimap(state);
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

  function dist2(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  function drawPanel(title, lines, prompt, accent) {
    const width = 640;
    const height = 150 + lines.length * 32;
    const x = (VIEW.width - width) / 2;
    const y = (VIEW.height - height) / 2;
    context.fillStyle = PALETTE.panel;
    rr(x, y, width, height, 14);
    context.fill();
    context.strokeStyle = accent || PALETTE.panelEdge;
    context.lineWidth = 2;
    rr(x, y, width, height, 14);
    context.stroke();
    text(title, VIEW.width / 2, y + 62, 44, PALETTE.text, 'center', '800');
    lines.forEach((line, i) => {
      text(line.text, VIEW.width / 2, y + 116 + i * 32, line.size || 20, line.color || PALETTE.muted, 'center', line.weight || '');
    });
    if (prompt) text(prompt, VIEW.width / 2, y + height - 26, 20, PALETTE.gold, 'center', '700');
  }

  function drawTitle(state, best, hasSave) {
    // City backdrop already drawn; darken it.
    context.fillStyle = 'rgba(8,10,16,0.55)';
    context.fillRect(0, 0, VIEW.width, VIEW.height);
    text('SOLMAR BAY', VIEW.width / 2, 108, 84, PALETTE.gold, 'center', '800');
    text('AN OPEN-WORLD CRIME STORY  ·  SIX MISSIONS  ·  ONE CITY THAT NEVER SLEEPS', VIEW.width / 2, 142, 17, PALETTE.text, 'center', '700');
    const lines = [
      { text: 'GOAL — Run all six missions for Marisol Vega and pull off the Big Score.', size: 19, color: PALETTE.text },
      { text: 'WIN — Finish mission 6 and lose the cops. LOSE — Get wasted or busted.', size: 19, color: PALETTE.text },
      { text: 'Drive, steal cars, dodge a 1–5 star wanted system, take taxi fares,', size: 19, color: PALETTE.muted },
      { text: 'collect courier packages, and spend your cash at the garage.', size: 19, color: PALETTE.muted },
      { text: 'WASD move/drive · E enter car / interact · F punch · CLICK shoot · SPACE handbrake', size: 18, color: PALETTE.muted },
      { text: 'P pause · M mute · progress saves automatically', size: 18, color: PALETTE.muted },
    ];
    drawPanel('', lines, hasSave ? 'ENTER — continue your story · R — start over' : 'Press ENTER or CLICK to start', PALETTE.gold);
    // Re-draw the title above the panel (panel is centred, title sits above it).
    text(`BEST SCORE ${best.toLocaleString('en-US')}`, VIEW.width / 2, VIEW.height - 36, 18, PALETTE.muted, 'center', '700');
  }

  function drawBrief(state) {
    const m = MISSIONS[Math.min(state.missionDone, 6) - 1] || MISSIONS[0];
    const next = state.mission <= 6
      ? `Next: ${MISSIONS[state.mission - 1].name} — ${MISSIONS[state.mission - 1].brief}`
      : 'Story complete — free roam unlocked.';
    const nextLines = wrap(next, 62).map((line) => ({ text: line, size: 18, color: PALETTE.text }));
    const lines = [
      { text: `${m.name} — done. Marisol paid you $${m.pay}.`, size: 21, color: PALETTE.text },
      { text: `Cash $${state.money.toLocaleString('en-US')} · Score ${state.score.toLocaleString('en-US')} · Missions ${state.missionDone}/6`, size: 19, color: PALETTE.muted },
      ...nextLines,
    ];
    drawPanel('MISSION COMPLETE', lines, 'Press ENTER to continue', '#58c96b');
  }

  /** Split a long line into lines of at most `max` characters, on word breaks. */
  function wrap(value, max) {
    const words = value.split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
      if ((current + ' ' + word).trim().length > max && current) {
        lines.push(current);
        current = word;
      } else {
        current = (current + ' ' + word).trim();
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function drawShop(state, items) {
    context.fillStyle = 'rgba(8,10,16,0.6)';
    context.fillRect(0, 0, VIEW.width, VIEW.height);
    const width = 680;
    const height = 130 + items.length * 44;
    const x = (VIEW.width - width) / 2;
    const y = (VIEW.height - height) / 2;
    context.fillStyle = PALETTE.panel;
    rr(x, y, width, height, 14);
    context.fill();
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    rr(x, y, width, height, 14);
    context.stroke();
    text('SOLMAR GARAGE', VIEW.width / 2, y + 52, 36, PALETTE.gold, 'center', '800');
    text(`Your cash: $${state.money.toLocaleString('en-US')}`, VIEW.width / 2, y + 84, 18, '#58c96b', 'center', '700');
    items.forEach((item, i) => {
      const iy = y + 116 + i * 44;
      text(`[${i + 1}]`, x + 28, iy, 19, PALETTE.gold, 'left', '800');
      text(item.name, x + 70, iy, 19, item.owned ? PALETTE.muted : PALETTE.text, 'left', '700');
      text(item.desc, x + 300, iy, 15, PALETTE.muted, 'left');
      text(item.owned ? 'OWNED' : `$${item.price}`, x + width - 28, iy, 19, item.owned ? PALETTE.muted : '#58c96b', 'right', '800');
    });
    text('Press 1–6 to buy · E or ESC to leave', VIEW.width / 2, y + height - 24, 18, PALETTE.gold, 'center', '700');
  }

  function drawOver(state, best) {
    const lines = [
      { text: `Missions ${state.missionDone}/6 · Cash $${state.money.toLocaleString('en-US')} · Score ${state.score.toLocaleString('en-US')}`, size: 20, color: PALETTE.text },
      { text: `Cars stolen ${state.stats.carsStolen} · Taxis ${state.stats.taxisDone} · Packages ${state.stats.packages}`, size: 18, color: PALETTE.muted },
      { text: `Best score ${best.toLocaleString('en-US')}`, size: 18, color: PALETTE.muted },
    ];
    drawPanel(state.overReason || 'WASTED', lines, 'Press R to retry · ENTER for the title screen', '#e5534b');
  }

  function drawVictory(state, best) {
    const lines = [
      { text: `GRADE ${state.grade} — the Big Score is yours. Solmar Bay bows to no one.`, size: 21, color: PALETTE.gold, weight: '800' },
      { text: `Final score ${state.score.toLocaleString('en-US')} · Cash $${state.money.toLocaleString('en-US')} · Time ${Math.floor(state.playSeconds / 60)}:${String(Math.floor(state.playSeconds % 60)).padStart(2, '0')}`, size: 19, color: PALETTE.text },
      { text: `Cars stolen ${state.stats.carsStolen} · Cops lost ${state.stats.copsLost} · Taxis ${state.stats.taxisDone} · Deaths ${state.stats.deaths}`, size: 18, color: PALETTE.muted },
      { text: `Best score ${best.toLocaleString('en-US')}`, size: 18, color: PALETTE.muted },
    ];
    drawPanel('STORY COMPLETE', lines, 'Press ENTER to keep playing in free roam', '#58c96b');
  }

  function draw(state, city, screen, best, shopItems) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / VIEW.width, canvas.height / VIEW.height);
    const ox = (canvas.width - VIEW.width * scale) / 2;
    const oy = (canvas.height - VIEW.height * scale) / 2;
    context.setTransform(scale, 0, 0, scale, ox, oy);
    // Camera follows the player, clamped to the city.
    camera.x = Math.max(0, Math.min(WORLD.width - VIEW.width, state.player.x - VIEW.width / 2));
    camera.y = Math.max(0, Math.min(WORLD.height - VIEW.height, state.player.y - VIEW.height / 2));

    drawCity(state, city);
    // Mission + side-job markers.
    for (const t of state.targets) {
      if (!t.done && t.x) drawMarker(t.x, t.y, '#f2c94c', t.label, state.time);
    }
    for (const pkg of state.packages) drawMarker(pkg.x, pkg.y, '#58c96b', '', state.time);
    if (state.taxi) {
      const tx = state.taxi.stage === 0 ? state.taxi.px : state.taxi.dx;
      const ty = state.taxi.stage === 0 ? state.taxi.py : state.taxi.dy;
      drawMarker(tx, ty, '#4fc3f7', state.taxi.stage === 0 ? 'FARE' : 'DROP-OFF', state.time);
    }
    // Entities.
    for (const car of state.cars) {
      if (car === state.player.car) continue;
      drawCar(car, state.time);
    }
    if (state.player.car) drawCar(state.player.car, state.time);
    for (const ped of state.peds) drawPed(ped);
    drawPlayer(state);
    // Particles + floats.
    for (const pt of state.particles) {
      context.globalAlpha = Math.max(0, pt.life / pt.max);
      context.fillStyle = pt.color;
      context.beginPath();
      context.arc(pt.x - camera.x, pt.y - camera.y, pt.size, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    for (const f of state.floats) {
      context.globalAlpha = Math.max(0, f.life / 1.4);
      text(f.text, f.x - camera.x, f.y - camera.y, 17, f.color, 'center', '800');
    }
    context.globalAlpha = 1;
    // Night tint.
    const night = nightFactor(state.timeOfDay);
    if (night > 0) {
      context.fillStyle = `rgba(8, 14, 40, ${night})`;
      context.fillRect(0, 0, VIEW.width, VIEW.height);
      // Headlight glow around the player at night.
      const px = state.player.x - camera.x;
      const py = state.player.y - camera.y;
      const glow = context.createRadialGradient(px, py, 10, px, py, 190);
      glow.addColorStop(0, 'rgba(255, 230, 150, 0.20)');
      glow.addColorStop(1, 'rgba(255, 230, 150, 0)');
      context.fillStyle = glow;
      context.fillRect(px - 190, py - 190, 380, 380);
    }
    // Screens on top.
    if (screen === SCREEN_TITLE) {
      drawTitle(state, best, state.mission > 1 || state.money > 150);
    } else {
      drawHud(state, screen);
      if (screen === SCREEN_PAUSED) drawPanel('PAUSED', [{ text: 'The city waits for you.', size: 20, color: PALETTE.text }], 'Press P to resume');
      else if (screen === SCREEN_BRIEF) drawBrief(state);
      else if (screen === SCREEN_SHOP) drawShop(state, shopItems || []);
      else if (screen === SCREEN_OVER) drawOver(state, best);
      else if (screen === SCREEN_VICTORY) drawVictory(state, best);
    }
  }

  /** Convert canvas-relative (CSS px) coordinates to world coordinates. */
  function screenToWorld(cx, cy) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / VIEW.width, rect.height / VIEW.height);
    const ox = (rect.width - VIEW.width * scale) / 2;
    const oy = (rect.height - VIEW.height * scale) / 2;
    return { x: (cx - ox) / scale + camera.x, y: (cy - oy) / scale + camera.y };
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, camera, screenToWorld };
}
