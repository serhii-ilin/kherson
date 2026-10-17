export interface MoveAxis {
  forward: number;
  right: number;
  up: number;
}

export interface LookDelta {
  x: number;
  y: number;
}

import type { TouchControls } from './touch.ts';

const MOUSE_SENSITIVITY = 0.0022;

/** Keyboard state plus pointer-lock mouse deltas. Reuses its result objects (no per-frame allocation). */
export class Input {
  readonly keys = new Set<string>();
  locked = false;
  /** Called on key press (not repeats). */
  onPress: ((code: string) => void) | null = null;
  /** Optional on-screen controls, merged into axis/look/sprint/jump. */
  touch: TouchControls | null = null;

  private lookX = 0;
  private lookY = 0;
  private readonly moveOut: MoveAxis = { forward: 0, right: 0, up: 0 };
  private readonly lookOut: LookDelta = { x: 0, y: 0 };
  private el: HTMLElement | null = null;

  attach(el: HTMLElement): void {
    this.el = el;
    el.addEventListener('click', () => {
      if (!this.locked) void el.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked) this.keys.clear();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX * MOUSE_SENSITIVITY;
      this.lookY += e.movementY * MOUSE_SENSITIVITY;
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) {
        this.keys.add(e.code);
        this.onPress?.(e.code);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private down(a: string, b?: string): boolean {
    return this.keys.has(a) || (b !== undefined && this.keys.has(b));
  }

  axis(): MoveAxis {
    const o = this.moveOut;
    o.forward = (this.down('KeyW', 'ArrowUp') ? 1 : 0) - (this.down('KeyS', 'ArrowDown') ? 1 : 0);
    o.right = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    o.up = (this.jump ? 1 : 0) - (this.crouch ? 1 : 0);
    const t = this.touch;
    if (t !== null) {
      o.forward = Math.max(-1, Math.min(1, o.forward + t.forward));
      o.right = Math.max(-1, Math.min(1, o.right + t.right));
      o.up = Math.max(-1, Math.min(1, o.up + t.up));
    }
    return o;
  }

  get sprint(): boolean { return this.down('ShiftLeft', 'ShiftRight') || (this.touch?.sprint ?? false); }
  get jump(): boolean { return this.keys.has('Space') || (this.touch !== null && this.touch.up > 0); }
  get crouch(): boolean { return this.down('KeyC', 'KeyQ') || this.keys.has('ControlLeft'); }

  /** Mouse movement since the last call, in radians (x = yaw delta, y = pitch delta, screen-down positive). */
  consumeLook(): LookDelta {
    this.lookOut.x = this.lookX;
    this.lookOut.y = this.lookY;
    if (this.touch !== null) {
      const t = this.touch.consumeLook();
      this.lookOut.x += t.x;
      this.lookOut.y += t.y;
    }
    this.lookX = 0;
    this.lookY = 0;
    return this.lookOut;
  }
}
