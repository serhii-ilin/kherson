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
const ZOOM_STEPS_M = [800, 1500, 4000];
const MOVE_EPS_M = 2;
const YAW_EPS = 0.02;

/** Bottom-right overview minimap with a player arrow; click cycles the zoom level. */
export class Minimap {
  viewMetres = DEFAULT_VIEW_M;
  readonly canvas: HTMLCanvasElement;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private readonly worldW: number;
  private readonly worldH: number;
  private readonly dpr: number;
  private bg: HTMLCanvasElement | null = null;
  private bgW = 0;
  private bgH = 0;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private lastYaw = Number.NaN;
  private lastView = Number.NaN;

  constructor(parent: HTMLElement, opts: MinimapOptions) {
    this.worldW = opts.worldW;
    this.worldH = opts.worldH;
    this.size = opts.size ?? DEFAULT_SIZE;
    onLangChange(() => {
      this.lastX = Number.NaN; // redraw the north label
    });
    this.dpr = Math.max(1, window.devicePixelRatio || 1);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vk-minimap';
    this.canvas.width = Math.round(this.size * this.dpr);
    this.canvas.height = Math.round(this.size * this.dpr);
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.canvas.addEventListener('click', () => this.cycleZoom());
    parent.appendChild(this.canvas);
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
    this.lastX = Number.NaN; // force redraw
  }

  setZoom(viewMetres: number): void {
    this.viewMetres = viewMetres;
    this.lastX = Number.NaN;
  }

  update(x: number, z: number, yaw: number): void {
    if (
      Number.isFinite(this.lastX)
      && Math.abs(x - this.lastX) <= MOVE_EPS_M
      && Math.abs(z - this.lastZ) <= MOVE_EPS_M
      && Math.abs(yaw - this.lastYaw) <= YAW_EPS
      && this.viewMetres === this.lastView
    ) {
      return;
    }
    this.lastX = x;
    this.lastZ = z;
    this.lastYaw = yaw;
    this.lastView = this.viewMetres;
    this.draw(x, z, yaw);
  }

  private cycleZoom(): void {
    const whole = Math.max(this.worldW, this.worldH);
    const steps = this.bg ? [...ZOOM_STEPS_M, whole] : ZOOM_STEPS_M;
    const i = steps.indexOf(this.viewMetres);
    this.viewMetres = steps[(i + 1) % steps.length] ?? DEFAULT_VIEW_M;
    this.lastX = Number.NaN;
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

    // player arrow: yaw 0 faces north (up), positive yaw turns left → screen rotation -yaw
    ctx.save();
    ctx.translate(s / 2, s / 2);
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

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(t('north'), s / 2, 4);
  }
}
