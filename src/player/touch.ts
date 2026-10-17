import { type LookDelta } from './input.ts';

/** Raw joystick sample: axes in [-1, 1] plus the dead-zone-rescaled magnitude. */
export interface JoystickAxes {
  forward: number;
  right: number;
  magnitude: number;
}

const STICK_RADIUS = 60;
const DEAD_ZONE = 0.15;
const SPRINT_AT = 0.95;
const LOOK_SENSITIVITY = 0.005;
const STYLE_ID = 'touch-controls-style';

const CSS = `
.touch-ui { position: fixed; inset: 0; z-index: 5; pointer-events: none; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
.touch-zone { position: absolute; top: 0; bottom: 0; width: 50%; pointer-events: auto; touch-action: none; }
.touch-zone-left { left: 0; }
.touch-zone-right { right: 0; }
.touch-stick { position: absolute; display: none; box-sizing: border-box; width: 120px; height: 120px; margin: -60px 0 0 -60px; border: 2px solid rgba(255, 255, 255, 0.5); border-radius: 50%; pointer-events: none; }
.touch-knob { position: absolute; left: 50%; top: 50%; width: 50px; height: 50px; margin: -25px 0 0 -25px; border-radius: 50%; background: rgba(255, 255, 255, 0.5); }
.touch-btn { position: absolute; box-sizing: border-box; width: 56px; height: 56px; padding: 0; border: 2px solid rgba(255, 255, 255, 0.5); border-radius: 50%; background: rgba(0, 0, 0, 0.35); color: #fff; font-size: 22px; line-height: 1; pointer-events: auto; touch-action: none; -webkit-tap-highlight-color: transparent; }
.touch-btn:active { background: rgba(255, 255, 255, 0.35); }
.touch-btn-up { right: 24px; bottom: 104px; }
.touch-btn-down { right: 24px; bottom: 40px; }
.touch-btn-fly { right: 96px; bottom: 40px; }
`;

/** Map a joystick displacement to movement axes. dy is positive when the finger moves
 * down (backward), so forward is negated. Magnitude is clamped to 1 and the dead zone
 * is rescaled: output is 0 at the dead-zone edge and 1 at the rim. */
export function joystickAxes(dx: number, dy: number, radius: number, deadZone: number): JoystickAxes {
  if (radius <= 0 || deadZone >= 1) return { forward: 0, right: 0, magnitude: 0 };
  const dz = deadZone < 0 ? 0 : deadZone;
  const dist = Math.hypot(dx, dy);
  if (dist <= 0) return { forward: 0, right: 0, magnitude: 0 };
  const raw = dist < radius ? dist / radius : 1;
  if (raw <= dz) return { forward: 0, right: 0, magnitude: 0 };
  const t = (raw - dz) / (1 - dz);
  const forward = -(dy / dist) * t;
  const right = (dx / dist) * t;
  return {
    forward: forward === 0 ? 0 : forward,
    right: right === 0 ? 0 : right,
    magnitude: t,
  };
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function makeDiv(className: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

function makeButton(className: string, label: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  return node;
}

/** Phone/tablet controls: floating left joystick, right-half look drag, action buttons. */
export class TouchControls {
  forward = 0;
  right = 0;
  up = 0;
  sprint = false;
  active = false;
  onToggleMode: (() => void) | null = null;

  private root: HTMLElement | null = null;
  private stick: HTMLElement | null = null;
  private knob: HTMLElement | null = null;
  private lookX = 0;
  private lookY = 0;
  private readonly lookOut: LookDelta = { x: 0, y: 0 };
  private stickId = -1;
  private stickX = 0;
  private stickY = 0;
  private lookId = -1;
  private lookPx = 0;
  private lookPy = 0;
  private upHeld = false;
  private downHeld = false;
  private flyId = -1;

  attach(parent: HTMLElement): void {
    if (this.root) return;
    injectStyle();
    const root = makeDiv('touch-ui');
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.pointerEvents = 'none';
    root.style.zIndex = '5';

    const leftZone = makeDiv('touch-zone touch-zone-left');
    const rightZone = makeDiv('touch-zone touch-zone-right');
    const stick = makeDiv('touch-stick');
    const knob = makeDiv('touch-knob');
    stick.appendChild(knob);
    const upBtn = makeButton('touch-btn touch-btn-up', '▲');
    const downBtn = makeButton('touch-btn touch-btn-down', '▼');
    const flyBtn = makeButton('touch-btn touch-btn-fly', '✈');
    root.append(leftZone, rightZone, stick, upBtn, downBtn, flyBtn);
    parent.appendChild(root);

    this.root = root;
    this.stick = stick;
    this.knob = knob;

    root.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.active = true;
    });

    leftZone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== -1) return;
      e.preventDefault();
      leftZone.setPointerCapture(e.pointerId);
      this.stickId = e.pointerId;
      const r = root.getBoundingClientRect();
      this.stickX = e.clientX - r.left;
      this.stickY = e.clientY - r.top;
      stick.style.left = `${this.stickX}px`;
      stick.style.top = `${this.stickY}px`;
      knob.style.transform = 'translate(0px, 0px)';
      stick.style.display = 'block';
    });

    leftZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      e.preventDefault();
      const r = root.getBoundingClientRect();
      const dx = e.clientX - r.left - this.stickX;
      const dy = e.clientY - r.top - this.stickY;
      const dist = Math.hypot(dx, dy);
      const k = dist > STICK_RADIUS ? STICK_RADIUS / dist : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const a = joystickAxes(dx, dy, STICK_RADIUS, DEAD_ZONE);
      this.forward = a.forward;
      this.right = a.right;
      this.sprint = dist / STICK_RADIUS > SPRINT_AT;
    });

    const stickEnd = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.forward = 0;
      this.right = 0;
      this.sprint = false;
      stick.style.display = 'none';
    };
    leftZone.addEventListener('pointerup', stickEnd);
    leftZone.addEventListener('pointercancel', stickEnd);

    rightZone.addEventListener('pointerdown', (e) => {
      if (this.lookId !== -1) return;
      e.preventDefault();
      rightZone.setPointerCapture(e.pointerId);
      this.lookId = e.pointerId;
      this.lookPx = e.clientX;
      this.lookPy = e.clientY;
    });

    rightZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      e.preventDefault();
      this.lookX += (e.clientX - this.lookPx) * LOOK_SENSITIVITY;
      this.lookY += (e.clientY - this.lookPy) * LOOK_SENSITIVITY;
      this.lookPx = e.clientX;
      this.lookPy = e.clientY;
    });

    const lookEnd = (e: PointerEvent): void => {
      if (e.pointerId === this.lookId) this.lookId = -1;
    };
    rightZone.addEventListener('pointerup', lookEnd);
    rightZone.addEventListener('pointercancel', lookEnd);

    this.bindHold(upBtn, (held) => {
      this.upHeld = held;
      this.syncUp();
    });
    this.bindHold(downBtn, (held) => {
      this.downHeld = held;
      this.syncUp();
    });

    flyBtn.addEventListener('pointerdown', (e) => {
      if (this.flyId !== -1) return;
      e.preventDefault();
      flyBtn.setPointerCapture(e.pointerId);
      this.flyId = e.pointerId;
    });
    flyBtn.addEventListener('pointerup', (e) => {
      if (e.pointerId !== this.flyId) return;
      this.flyId = -1;
      this.onToggleMode?.();
    });
    flyBtn.addEventListener('pointercancel', (e) => {
      if (e.pointerId === this.flyId) this.flyId = -1;
    });
  }

  /** Mouse/touch movement since the last call, in radians (x = yaw, y = pitch, screen-down positive). */
  consumeLook(): LookDelta {
    const o = this.lookOut;
    o.x = this.lookX;
    o.y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return o;
  }

  static isTouchDevice(): boolean {
    if (typeof window === 'undefined') return false;
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    return coarse || 'ontouchstart' in window;
  }

  private syncUp(): void {
    this.up = this.upHeld ? 1 : this.downHeld ? -1 : 0;
  }

  private bindHold(el: HTMLElement, onHeld: (held: boolean) => void): void {
    let id = -1;
    el.addEventListener('pointerdown', (e) => {
      if (id !== -1) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      id = e.pointerId;
      onHeld(true);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      id = -1;
      onHeld(false);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
}
