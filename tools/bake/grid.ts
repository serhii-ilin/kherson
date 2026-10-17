import { F_GROUND_H, F_GROUND_MAT, FIELDS, REGION } from "../../src/world/constants.ts";
import { MAT } from "../../src/world/materials.ts";
import type { Feature } from "../../src/world/format.ts";

const PLANE = REGION * REGION;

export function makeDefaultCells(): Uint8Array {
  const c = new Uint8Array(FIELDS * PLANE);
  c.fill(MAT.GRASS, F_GROUND_MAT * PLANE, (F_GROUND_MAT + 1) * PLANE);
  c.fill(2, F_GROUND_H * PLANE, (F_GROUND_H + 1) * PLANE);
  return c;
}
export const DEFAULT_CELLS = makeDefaultCells();

/** Lazily allocated world grid of regions. */
export class Grid {
  regionsX: number;
  regionsZ: number;
  cellsX: number;
  cellsZ: number;
  regions = new Map<number, Uint8Array>();
  features = new Map<number, Feature[]>();
  private lastKey = -1;
  private last: Uint8Array | null = null;

  constructor(cellsX: number, cellsZ: number) {
    this.cellsX = cellsX;
    this.cellsZ = cellsZ;
    this.regionsX = Math.ceil(cellsX / REGION);
    this.regionsZ = Math.ceil(cellsZ / REGION);
  }
  inside(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.regionsX * REGION && cz < this.regionsZ * REGION;
  }
  static key(rx: number, rz: number): number {
    return rx * 65536 + rz;
  }
  private region(cx: number, cz: number, create: boolean): Uint8Array | null {
    const rx = Math.floor(cx / REGION);
    const rz = Math.floor(cz / REGION);
    const k = rx * 65536 + rz;
    if (k === this.lastKey && this.last) return this.last;
    let r = this.regions.get(k) ?? null;
    if (!r && create) {
      r = makeDefaultCells();
      this.regions.set(k, r);
    }
    if (r) {
      this.lastKey = k;
      this.last = r;
    }
    return r;
  }
  get(field: number, cx: number, cz: number): number {
    if (!this.inside(cx, cz)) return 0;
    const r = this.region(cx, cz, false);
    if (!r) return field === F_GROUND_MAT ? MAT.GRASS : field === F_GROUND_H ? 2 : 0;
    const lx = cx & (REGION - 1);
    const lz = cz & (REGION - 1);
    return r[field * PLANE + lz * REGION + lx]!;
  }
  set(field: number, cx: number, cz: number, v: number): void {
    if (!this.inside(cx, cz)) return;
    const r = this.region(cx, cz, true)!;
    r[field * PLANE + (cz & (REGION - 1)) * REGION + (cx & (REGION - 1))] = v;
  }
  addFeature(type: number, param: number, cx: number, cz: number): void {
    if (!this.inside(cx, cz)) return;
    this.region(cx, cz, true);
    const k = Math.floor(cx / REGION) * 65536 + Math.floor(cz / REGION);
    let list = this.features.get(k);
    if (!list) this.features.set(k, (list = []));
    list.push({ type, param, x: cx & (REGION - 1), z: cz & (REGION - 1) });
  }
}
