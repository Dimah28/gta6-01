// Keyboard and pointer input. Held keys give a steering vector; one-shot
// presses (confirm, pause, interact, punch, mute) are queued as bit flags and
// taken once by the loop, so a press between two frames is never lost and
// never counted twice. The mouse aims on foot and fires the pistol.
// Shift is sprint on foot and the NOS boost while driving; N is NOS too.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_INTERACT = 4;
export const ACTION_PUNCH = 8;
export const ACTION_MUTE = 16;
export const ACTION_SHOOT = 32;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const CONFIRM = new Set(['Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const INTERACT = new Set(['KeyE']);
const PUNCH = new Set(['KeyF']);
const MUTE = new Set(['KeyM']);

export function createInput(canvas) {
  const keys = { up: false, down: false, left: false, right: false, shift: false, space: false, nos: false };
  let actions = 0;
  let mouseX = 0;
  let mouseY = 0;
  let mouseDown = false;

  function codeOf(event) {
    return event.code;
  }

  window.addEventListener('keydown', (event) => {
    const code = codeOf(event);
    if (UP.has(code)) keys.up = true;
    else if (DOWN.has(code)) keys.down = true;
    else if (LEFT.has(code)) keys.left = true;
    else if (RIGHT.has(code)) keys.right = true;
    else if (code === 'ShiftLeft' || code === 'ShiftRight') { keys.shift = true; keys.nos = true; }
    else if (code === 'KeyN') keys.nos = true;
    else if (code === 'Space') { keys.space = true; if (!event.repeat) actions |= ACTION_CONFIRM; }
    else if (CONFIRM.has(code)) { if (!event.repeat) actions |= ACTION_CONFIRM; }
    else if (PAUSE.has(code)) { if (!event.repeat) actions |= ACTION_PAUSE; }
    else if (INTERACT.has(code)) { if (!event.repeat) actions |= ACTION_INTERACT; }
    else if (PUNCH.has(code)) { if (!event.repeat) actions |= ACTION_PUNCH; }
    else if (MUTE.has(code)) { if (!event.repeat) actions |= ACTION_MUTE; }
    else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    const code = codeOf(event);
    if (UP.has(code)) keys.up = false;
    else if (DOWN.has(code)) keys.down = false;
    else if (LEFT.has(code)) keys.left = false;
    else if (RIGHT.has(code)) keys.right = false;
    else if (code === 'ShiftLeft' || code === 'ShiftRight') { keys.shift = false; keys.nos = false; }
    else if (code === 'KeyN') keys.nos = false;
    else if (code === 'Space') keys.space = false;
  });
  window.addEventListener('blur', () => {
    keys.up = keys.down = keys.left = keys.right = keys.shift = keys.space = keys.nos = false;
  });
  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    mouseY = event.clientY - rect.top;
  });
  canvas.addEventListener('pointerdown', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    mouseY = event.clientY - rect.top;
    mouseDown = true;
    actions |= ACTION_SHOOT;
    actions |= ACTION_CONFIRM; // clicking also starts from a panel screen
  });
  window.addEventListener('pointerup', () => { mouseDown = false; });

  return {
    keys,
    mouse() { return { x: mouseX, y: mouseY, down: mouseDown }; },
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
