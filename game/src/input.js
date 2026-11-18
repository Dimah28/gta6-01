// Keyboard, mouse and touch input for Solmar Bay.
//
// Held keys give a steering vector in `state` (x, y, shift, space); one-shot
// presses (interact, punch) are set on keydown and consumed by exactly one
// sim step, so a press between two frames is never lost and never counted
// twice. The mouse aims on foot and fires the pistol; a touch drag on the
// canvas is a virtual joystick. Screen transitions (confirm, pause, shop,
// mute, reset) go out through callbacks — this file never decides them.
const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);

export function createInput(canvas, hooks) {
  const h = hooks || {};
  const keys = { up: false, down: false, left: false, right: false, shift: false, space: false };
  const touchVec = { x: 0, y: 0 };
  let touchStart = null;
  let mouseDown = false;

  const state = {
    x: 0, y: 0, shift: false, space: false,
    interact: false, punch: false, shoot: false, mouseWorld: null,
  };

  function recompute() {
    const kx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const ky = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    state.x = Math.max(-1, Math.min(1, kx + touchVec.x));
    state.y = Math.max(-1, Math.min(1, ky + touchVec.y));
    state.shift = keys.shift;
    state.space = keys.space;
  }

  function toWorld(clientX, clientY) {
    if (typeof h.toWorld !== 'function') return null;
    return h.toWorld(clientX, clientY);
  }

  window.addEventListener('keydown', (event) => {
    const code = event.code;
    if (UP.has(code)) keys.up = true;
    else if (DOWN.has(code)) keys.down = true;
    else if (LEFT.has(code)) keys.left = true;
    else if (RIGHT.has(code)) keys.right = true;
    else if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'KeyN') keys.shift = true;
    else if (code === 'Space') keys.space = true;
    else if (code === 'Enter') { if (!event.repeat && h.onConfirm) h.onConfirm(); }
    else if (code === 'KeyP' || code === 'Escape') { if (!event.repeat && h.onPause) h.onPause(); }
    else if (code === 'KeyE') {
      if (!event.repeat) {
        state.interact = true;
        if (h.onShop) h.onShop();
      }
    } else if (code === 'KeyF') { if (!event.repeat) state.punch = true; }
    else if (code === 'KeyM') { if (!event.repeat && h.onMute) h.onMute(); }
    else if (code === 'KeyR') { if (!event.repeat && h.onReset) h.onReset(); }
    else if (/^Digit[1-6]$/.test(code)) {
      if (!event.repeat && h.onShopBuy) h.onShopBuy(Number(code.slice(5)) - 1);
    } else return;
    recompute();
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    const code = event.code;
    if (UP.has(code)) keys.up = false;
    else if (DOWN.has(code)) keys.down = false;
    else if (LEFT.has(code)) keys.left = false;
    else if (RIGHT.has(code)) keys.right = false;
    else if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'KeyN') keys.shift = false;
    else if (code === 'Space') keys.space = false;
    recompute();
  });
  window.addEventListener('blur', () => {
    keys.up = keys.down = keys.left = keys.right = keys.shift = keys.space = false;
    touchVec.x = 0;
    touchVec.y = 0;
    touchStart = null;
    mouseDown = false;
    state.shoot = false;
    recompute();
  });

  canvas.addEventListener('pointermove', (event) => {
    state.mouseWorld = toWorld(event.clientX, event.clientY);
  });
  canvas.addEventListener('pointerdown', (event) => {
    state.mouseWorld = toWorld(event.clientX, event.clientY);
    state.shoot = true;
    mouseDown = true;
    if (h.onShoot) h.onShoot(event.clientX, event.clientY);
    if (h.onConfirm) h.onConfirm();
  });
  window.addEventListener('pointerup', () => {
    state.shoot = false;
    mouseDown = false;
  });

  // Touch: a drag anywhere on the canvas is a virtual joystick (direction
  // from the touch start point, capped at one tile); a quick tap starts the
  // game from the title screen.
  canvas.addEventListener('touchstart', (event) => {
    const t = event.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY, time: performance.now() };
    event.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (event) => {
    if (!touchStart) return;
    const t = event.changedTouches[0];
    touchVec.x = Math.max(-1, Math.min(1, (t.clientX - touchStart.x) / 60));
    touchVec.y = Math.max(-1, Math.min(1, (t.clientY - touchStart.y) / 60));
    recompute();
    if (h.onTouchMove) h.onTouchMove(touchVec.x, touchVec.y);
    event.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', (event) => {
    if (touchStart && performance.now() - touchStart.time < 250 && Math.hypot(touchVec.x, touchVec.y) < 0.2) {
      if (h.onTouchTap) h.onTouchTap();
    }
    touchStart = null;
    touchVec.x = 0;
    touchVec.y = 0;
    recompute();
    if (h.onTouchMove) h.onTouchMove(0, 0);
    event.preventDefault();
  }, { passive: false });

  return { state };
}
