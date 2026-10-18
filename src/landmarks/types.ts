import type { Quality } from '../quality.ts';
import type { PropModel } from '../fine/prop-models.ts';

export type LandmarkMeshKind = 'opaque' | 'water' | 'lamp';

export interface LandmarkMeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  kind: LandmarkMeshKind;
}

export interface LandmarkSurface {
  /** Returns the walkable top at this x/z, or null outside this surface. */
  heightAt(x: number, z: number): number | null;
  /** A landmark deck/paving surface is not water even when the base world is water. */
  isWater?: boolean;
  /** Optional cheap solid obstacle test, used for pier railings. */
  blockedAt?(x: number, z: number, y: number, bodyH?: number): boolean;
}

export interface LandmarkPropExclusion {
  polygon: readonly [number, number][];
  /** Fine prop kinds replaced by the landmark. Other generic props remain eligible. */
  kinds: readonly number[];
}

export interface LandmarkReport {
  pavedAreaM2: number;
  pavedAreaBeforeM2?: number;
  pavedAreaAfterM2?: number;
  forecourtAreaM2?: number;
  forecourtPavedAreaM2?: number;
  orientationDeg?: number;
  lamps: number;
  benches: number;
  deckRoot?: [number, number];
  deckTip?: [number, number];
  shoreline?: [number, number];
}

export interface LandmarkBuild {
  meshes: readonly LandmarkMeshData[];
  surfaces: readonly LandmarkSurface[];
  triangleCount: number;
  materialCount: number;
  propExclusions?: readonly LandmarkPropExclusion[];
  report?: LandmarkReport;
}

export interface LandmarkBuildContext {
  groundAt(x: number, z: number): number | null;
  isWater?(x: number, z: number): boolean;
  quality: Quality;
}

export interface LandmarkAnchor {
  lat: number;
  lon: number;
  x: number;
  z: number;
}

export interface Landmark {
  id: string;
  name: string;
  anchor: LandmarkAnchor;
  /** Polygon in world x/z; generic fine-tier props are suppressed inside it. */
  footprint: readonly [number, number][];
  propExclusions?: readonly LandmarkPropExclusion[];
  /** Only actual treeless paving or tight hand-item clearances; never a broad landmark bbox. */
  vegetationExclusions?: readonly (readonly [number, number][])[];
  ready?(ctx: LandmarkBuildContext): boolean;
  build(ctx: LandmarkBuildContext): LandmarkBuild;
}

export function rgb(hex: number): [number, number, number] {
  return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
}

export function pointInPolygon(polygon: readonly [number, number][], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]![0], zi = polygon[i]![1], xj = polygon[j]![0], zj = polygon[j]![1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonArea(polygon: readonly [number, number][]): number {
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) area += polygon[j]![0] * polygon[i]![1] - polygon[i]![0] * polygon[j]![1];
  return Math.abs(area) / 2;
}

interface Vertex { x: number; y: number; z: number; nx: number; ny: number; nz: number; }

/** Small raw-buffer builder shared by both hand-authored landmark meshes. */
export class LandmarkMeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];

  addQuad(vertices: readonly [Vertex, Vertex, Vertex, Vertex], color: readonly [number, number, number]): void {
    const start = this.positions.length / 3;
    for (const v of vertices) {
      this.positions.push(v.x, v.y, v.z);
      this.normals.push(v.nx, v.ny, v.nz);
      this.colors.push(color[0]!, color[1]!, color[2]!);
    }
    this.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  /** Axis-aligned box; `bottom = false` skips the never-seen underside (pavers on a mortar bed). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: readonly [number, number, number], bottom = true): void {
    this.addQuad([
      { x: x0, y: y1, z: z1, nx: 0, ny: 1, nz: 0 }, { x: x1, y: y1, z: z1, nx: 0, ny: 1, nz: 0 },
      { x: x1, y: y1, z: z0, nx: 0, ny: 1, nz: 0 }, { x: x0, y: y1, z: z0, nx: 0, ny: 1, nz: 0 },
    ], color);
    if (bottom) {
      this.addQuad([
        { x: x0, y: y0, z: z0, nx: 0, ny: -1, nz: 0 }, { x: x1, y: y0, z: z0, nx: 0, ny: -1, nz: 0 },
        { x: x1, y: y0, z: z1, nx: 0, ny: -1, nz: 0 }, { x: x0, y: y0, z: z1, nx: 0, ny: -1, nz: 0 },
      ], color);
    }
    this.addQuad([
      { x: x0, y: y0, z: z1, nx: 0, ny: 0, nz: 1 }, { x: x1, y: y0, z: z1, nx: 0, ny: 0, nz: 1 },
      { x: x1, y: y1, z: z1, nx: 0, ny: 0, nz: 1 }, { x: x0, y: y1, z: z1, nx: 0, ny: 0, nz: 1 },
    ], color);
    this.addQuad([
      { x: x1, y: y0, z: z0, nx: 0, ny: 0, nz: -1 }, { x: x0, y: y0, z: z0, nx: 0, ny: 0, nz: -1 },
      { x: x0, y: y1, z: z0, nx: 0, ny: 0, nz: -1 }, { x: x1, y: y1, z: z0, nx: 0, ny: 0, nz: -1 },
    ], color);
    this.addQuad([
      { x: x1, y: y0, z: z1, nx: 1, ny: 0, nz: 0 }, { x: x1, y: y0, z: z0, nx: 1, ny: 0, nz: 0 },
      { x: x1, y: y1, z: z0, nx: 1, ny: 0, nz: 0 }, { x: x1, y: y1, z: z1, nx: 1, ny: 0, nz: 0 },
    ], color);
    this.addQuad([
      { x: x0, y: y0, z: z0, nx: -1, ny: 0, nz: 0 }, { x: x0, y: y0, z: z1, nx: -1, ny: 0, nz: 0 },
      { x: x0, y: y1, z: z1, nx: -1, ny: 0, nz: 0 }, { x: x0, y: y1, z: z0, nx: -1, ny: 0, nz: 0 },
    ], color);
  }

  /** Upward-facing flat quad (e.g. the mortar bed showing in the joints between pavers). */
  topQuad(x0: number, z0: number, x1: number, z1: number, y: number, color: readonly [number, number, number]): void {
    this.addQuad([
      { x: x0, y, z: z1, nx: 0, ny: 1, nz: 0 }, { x: x1, y, z: z1, nx: 0, ny: 1, nz: 0 },
      { x: x1, y, z: z0, nx: 0, ny: 1, nz: 0 }, { x: x0, y, z: z0, nx: 0, ny: 1, nz: 0 },
    ], color);
  }

  cylinder(cx: number, y0: number, cz: number, radius: number, height: number, color: readonly [number, number, number], segments = 8): void {
    const y1 = y0 + height;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * radius, z0 = cz + Math.sin(a0) * radius;
      const x1 = cx + Math.cos(a1) * radius, z1 = cz + Math.sin(a1) * radius;
      const n0x = Math.cos(a0), n0z = Math.sin(a0), n1x = Math.cos(a1), n1z = Math.sin(a1);
      this.addQuad([
        // counter-clockwise seen from outside (a1 before a0), so the side faces are not culled
        { x: x1, y: y0, z: z1, nx: n1x, ny: 0, nz: n1z }, { x: x0, y: y0, z: z0, nx: n0x, ny: 0, nz: n0z },
        { x: x0, y: y1, z: z0, nx: n0x, ny: 0, nz: n0z }, { x: x1, y: y1, z: z1, nx: n1x, ny: 0, nz: n1z },
      ], color);
    }
    this.addDisc(cx, y1, cz, radius, color, segments, 1);
    this.addDisc(cx, y0, cz, radius, color, segments, -1);
  }

  addDisc(cx: number, y: number, cz: number, radius: number, color: readonly [number, number, number], segments = 12, direction = 1): void {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const c = { x: cx, y, z: cz, nx: 0, ny: direction, nz: 0 };
      const p0 = { x: cx + Math.cos(a0) * radius, y, z: cz + Math.sin(a0) * radius, nx: 0, ny: direction, nz: 0 };
      const p1 = { x: cx + Math.cos(a1) * radius, y, z: cz + Math.sin(a1) * radius, nx: 0, ny: direction, nz: 0 };
      this.addQuad(direction > 0 ? [c, p1, p0, c] : [c, p0, p1, c], color);
    }
  }

  /** Adds one of the existing fine-tier detailed props, transformed into landmark world space. */
  addProp(model: PropModel, x: number, y: number, z: number, yaw = 0): void {
    const start = this.positions.length / 3;
    const s = Math.sin(yaw), c = Math.cos(yaw);
    for (let i = 0; i < model.positions.length; i += 3) {
      const px = model.positions[i]!, py = model.positions[i + 1]!, pz = model.positions[i + 2]!;
      this.positions.push(x + px * c + pz * s, y + py, z - px * s + pz * c);
      const nx = model.normals[i]!, ny = model.normals[i + 1]!, nz = model.normals[i + 2]!;
      this.normals.push(nx * c + nz * s, ny, -nx * s + nz * c);
      this.colors.push(model.colors[i]!, model.colors[i + 1]!, model.colors[i + 2]!);
    }
    for (const index of model.indices) this.indices.push(start + index);
  }

  finish(kind: LandmarkMeshKind): LandmarkMeshData {
    return {
      positions: Float32Array.from(this.positions),
      normals: Float32Array.from(this.normals),
      colors: Float32Array.from(this.colors),
      indices: Uint32Array.from(this.indices),
      kind,
    };
  }
}

export function buildResult(
  meshes: readonly LandmarkMeshData[], surfaces: readonly LandmarkSurface[],
  propExclusions?: readonly LandmarkPropExclusion[], report?: LandmarkReport,
): LandmarkBuild {
  let triangles = 0;
  for (const mesh of meshes) triangles += mesh.indices.length / 3;
  return { meshes, surfaces, triangleCount: triangles, materialCount: meshes.length, propExclusions, report };
}
