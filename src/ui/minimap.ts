import { onLangChange, t } from '../i18n.ts';

export interface MinimapOptions {
  worldW: number;
  worldH: number;
  size?: number;
}

export interface MinimapBackground {
  w: number;
  h: number;
  /** w*h*3 bytes: groundMat, maxHeight, topMat. */
  blocks: Uint8Array;
}

const DEFAULT_SIZE = 180;
const DEFAULT_VIEW_M = 1500;
export const ZOOM_STEPS_M = [400, 800, 1500, 4000] as const;
const MOVE_EPS_M = 2;
const YAW_EPS = 0.02;
const CLICK_EPS_PX = 4;
const MARKER_RADIUS_PX = 14;

/** Convert CSS-pixel coordinates on the minimap to world coordinates. */
export function canvasToWorld(px: number, py: number, size: number, viewMetres: number, playerX: number, playerZ: number): { x: number; z: number } {
  const metresPerPixel = viewMetres / size;
  return {
    x: playerX + (px - size / 2) * metresPerPixel,
    z: playerZ + (py - size / 2) * metresPerPixel,
  };
}

/** Clamp a world coordinate to the rectangular map bounds. */
export function clampWorld(x: number, z: number, worldW: number, worldH: number): { x: number; z: number } {
  return {
    x: Math.max(0, Math.min(worldW, x)),
    z: Math.max(0, Math.min(worldH, z)),
  };
}

/** Move one zoom step: dir 1 zooms in and dir -1 zooms out. */
export function nextZoom(steps: readonly number[], current: number, dir: 1 | -1): number {
  if (steps.length === 0) return current;
  let index = steps.indexOf(current);
  if (index < 0) {
    index = 0;
    let distance = Math.abs((steps[0] ?? current) - current);
    for (let i = 1; i < steps.length; i++) {
      const candidateDistance = Math.abs(steps[i]! - current);
      if (candidateDistance < distance) {
        index = i;
        distance = candidateDistance;
      }
    }
  }
  return steps[Math.max(0, Math.min(steps.length - 1, index - dir))]!;
}

/** Bottom-right overview minimap with a player arrow and teleport controls. */
export class Minimap {
  viewMetres = DEFAULT_VIEW_M;
  onTeleport: ((x: number, z: number) => void) | null = null;
  readonly canvas: HTMLCanvasElement;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private readonly worldW: number;
  private readonly worldH: number;
  private readonly dpr: number;
  private readonly zoomSteps: number[] = [...ZOOM_STEPS_M];
  private readonly zoomInButton: HTMLButtonElement;
  private readonly zoomOutButton: HTMLButtonElement;
  private bg: HTMLCanvasElement | null = null;
  private bgW = 0;
  private bgH = 0;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private lastYaw = Number.NaN;
  /** Set when the zoom, background or language changes; the last player pose stays valid for clicks. */
  private dirty = true;
  private lastView = Number.NaN;
  private dragging = false;
  private pointerId = -1;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private dragX = 0;
  private dragY = 0;

  constructor(parent: HTMLElement, opts: MinimapOptions) {
    this.worldW = opts.worldW;
    this.worldH = opts.worldH;
    this.size = opts.size ?? DEFAULT_SIZE;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);

    const wrap = document.createElement('div');
    wrap.className = 'vk-minimap-wrap';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vk-minimap';
    this.canvas.width = Math.round(this.size * this.dpr);
    this.canvas.height = Math.round(this.size * this.dpr);
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;

    this.zoomInButton = this.createZoomButton('vk-minimap-zoom-in', '+', 1);
    this.zoomOutButton = this.createZoomButton('vk-minimap-zoom-out', '−', -1);
    wrap.append(this.canvas, this.zoomInButton, this.zoomOutButton);
    parent.appendChild(wrap);
    this.bindPointerEvents();
    onLangChange(() => {
      this.dirty = true; // redraw the north label
      this.renderZoomButtons();
    });
    this.renderZoomButtons();
  }

  /** Paint the full-city background from the overview grid plus a material palette. */
  setBackground(data: MinimapBackground, palette: Uint8Array): void {
    const { w, h, blocks } = data;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) throw new Error('2d context unavailable');
    const img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const groundMat = blocks[i * 3] ?? 0;
      const maxHeight = blocks[i * 3 + 1] ?? 0;
      const topMat = blocks[i * 3 + 2] ?? 0;
      const built = maxHeight > 2;
      const mat = built ? topMat : groundMat;
      const f = built ? 0.85 : 1;
      img.data[i * 4] = Math.round((palette[mat * 3] ?? 0) * f);
      img.data[i * 4 + 1] = Math.round((palette[mat * 3 + 1] ?? 0) * f);
      img.data[i * 4 + 2] = Math.round((palette[mat * 3 + 2] ?? 0) * f);
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.bg = c;
    this.bgW = w;
    this.bgH = h;
    const wholeCity = Math.max(this.worldW, this.worldH);
    if (!this.zoomSteps.includes(wholeCity)) {
      this.zoomSteps.push(wholeCity);
      this.zoomSteps.sort((a, b) => a - b);
    }
    this.dirty = true; // force redraw
    this.renderZoomButtons();
  }

  setZoom(viewMetres: number): void {
    this.viewMetres = viewMetres;
    this.dirty = true;
    this.renderZoomButtons();
  }

  update(x: number, z: number, yaw: number): void {
    if (
      !this.dirty
      && !this.dragging
      && Number.isFinite(this.lastX)
      && Math.abs(x - this.lastX) <= MOVE_EPS_M
      && Math.abs(z - this.lastZ) <= MOVE_EPS_M
      && Math.abs(yaw - this.lastYaw) <= YAW_EPS
      && this.viewMetres === this.lastView
    ) {
      return;
    }
    this.dirty = false;
    this.lastX = x;
    this.lastZ = z;
    this.lastYaw = yaw;
    this.lastView = this.viewMetres;
    this.draw(x, z, yaw);
  }

  private createZoomButton(className: string, text: string, dir: 1 | -1): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `vk-minimap-zoom ${className}`;
    button.textContent = text;
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!button.disabled) {
        this.viewMetres = nextZoom(this.zoomSteps, this.viewMetres, dir);
        this.dirty = true;
        this.renderZoomButtons();
      }
    });
    return button;
  }

  private renderZoomButtons(): void {
    const inText = t('zoomIn');
    const outText = t('zoomOut');
    this.zoomInButton.title = inText;
    this.zoomInButton.setAttribute('aria-label', inText);
    this.zoomOutButton.title = outText;
    this.zoomOutButton.setAttribute('aria-label', outText);
    this.zoomInButton.disabled = nextZoom(this.zoomSteps, this.viewMetres, 1) === this.viewMetres;
    this.zoomOutButton.disabled = nextZoom(this.zoomSteps, this.viewMetres, -1) === this.viewMetres;
  }

  private bindPointerEvents(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.pointerId !== -1) return;
      const p = this.canvasPoint(e);
      this.pointerId = e.pointerId;
      this.pointerStartX = p.x;
      this.pointerStartY = p.y;
      this.dragX = p.x;
      this.dragY = p.y;
      this.dragging = Math.hypot(p.x - this.size / 2, p.y - this.size / 2) <= MARKER_RADIUS_PX;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      e.stopPropagation();
      if (e.pointerId !== this.pointerId) return;
      const p = this.canvasPoint(e);
      this.dragX = p.x;
      this.dragY = p.y;
      if (this.dragging && Number.isFinite(this.lastX)) this.draw(this.lastX, this.lastZ, this.lastYaw);
    });
    this.canvas.addEventListener('pointerup', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.pointerId !== this.pointerId) return;
      const p = this.canvasPoint(e);
      const moved = Math.hypot(p.x - this.pointerStartX, p.y - this.pointerStartY);
      const shouldTeleport = this.dragging || moved < CLICK_EPS_PX;
      if (shouldTeleport && Number.isFinite(this.lastX)) {
        const world = canvasToWorld(p.x, p.y, this.size, this.viewMetres, this.lastX, this.lastZ);
        const target = clampWorld(world.x, world.z, this.worldW, this.worldH);
        this.onTeleport?.(target.x, target.z);
      }
      this.endPointer(e.pointerId);
    });
    this.canvas.addEventListener('pointercancel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.pointerId === this.pointerId) this.endPointer(e.pointerId);
    });
    this.canvas.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  private canvasPoint(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? this.size / rect.width : 1;
    const scaleY = rect.height > 0 ? this.size / rect.height : 1;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  private endPointer(pointerId: number): void {
    if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
    this.pointerId = -1;
    this.dragging = false;
  }

  private draw(x: number, z: number, yaw: number): void {
    const ctx = this.ctx;
    const s = this.size;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = '#121a22';
    ctx.fillRect(0, 0, s, s);

    const bg = this.bg;
    if (bg && this.bgW > 0 && this.bgH > 0) {
      const sw = (this.viewMetres * this.bgW) / this.worldW;
      const sh = (this.viewMetres * this.bgH) / this.worldH;
      const sx = (x / this.worldW) * this.bgW - sw / 2;
      const sy = (z / this.worldH) * this.bgH - sh / 2;
      const cx0 = Math.max(0, sx);
      const cy0 = Math.max(0, sy);
      const cx1 = Math.min(this.bgW, sx + sw);
      const cy1 = Math.min(this.bgH, sy + sh);
      if (cx1 > cx0 && cy1 > cy0) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          bg,
          cx0, cy0, cx1 - cx0, cy1 - cy0,
          ((cx0 - sx) * s) / sw, ((cy0 - sy) * s) / sh,
          ((cx1 - cx0) * s) / sw, ((cy1 - cy0) * s) / sh,
        );
      }
    }

    if (this.dragging) {
      this.drawArrow(s / 2, s / 2, yaw, 0.35);
      this.drawArrow(this.dragX, this.dragY, yaw, 1);
    } else {
      this.drawArrow(s / 2, s / 2, yaw, 1);
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(t('north'), s / 2, 4);
  }

  private drawArrow(x: number, y: number, yaw: number, alpha: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(-yaw);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fillStyle = '#e03131';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }
}
