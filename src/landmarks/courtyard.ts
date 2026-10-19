import { fromLatLon } from './geo.ts';
import { FILATOVA_28_DATA } from './data.ts';
import { buildResult, LandmarkMeshBuilder, rgb, type Landmark, type LandmarkBuildContext } from './types.ts';
import { at, fbox, face, frameAt, tube, tubePath, type Color, type Frame, type Vec } from './shapes.ts';
import type { Bbox } from '../world/manifest.ts';

// Colours read off the owner's photos of the courtyard of Filatova 28 (EVIDENCE.md).
const TYRE_GREEN = rgb(0x4aa36a);
const TYRE_YELLOW = rgb(0xe0c23a);
const TYRE_PINK = rgb(0xe48aa0);
const TYRE_TEAL = rgb(0x4fbfa8);
const TYRE_BLUE = rgb(0x3f86cf);
const TYRE_RED = rgb(0xc2474f);
const TYRE_PURPLE = rgb(0x9c7bc9);
const TYRE_GREY = rgb(0xa6a9ab);
const TREAD_WHITE = rgb(0xcfd1d0);
const SOIL = rgb(0x4a382b);
const LEAF = rgb(0x4f7f3a);
const IVY = rgb(0x3d7a35);
const PIPE_GREEN = rgb(0x3f9a5a);
const PIPE_ORANGE = rgb(0xd98a3a);
const POST_PINK = rgb(0xd96f96);
const POST_RED = rgb(0xb83a32);
const ROOF = rgb(0xb7b3a8);
const BOTTLE = rgb(0x6b3a1e);
const PLANK = rgb(0x7b5a3a);
const PLANK_GREEN = rgb(0x4d8f6a);
const STEEL = rgb(0xaab0b5);
const BRASS = rgb(0xb98a3c);

const Y_AXIS: Vec = { x: 0, y: 1, z: 0 };

/**
 * A painted tyre: a torus section swept from angle `t0` to `t1` in the plane of `e1`/`e2`, axis `n`.
 * Inner face and sidewalls take `paint`, the tread takes `tread`. `ro` is the outer radius, `w` the half width,
 * `h` the sidewall height.
 */
function addTyre(
  b: LandmarkMeshBuilder, c: Vec, e1: Vec, e2: Vec, n: Vec, ro: number, w: number, h: number,
  paint: Color, tread: Color, t0: number, t1: number, segs: number,
): void {
  const ri = ro - h;
  const sec: [number, number][] = [
    [ri, -0.6 * w], [ri, 0.6 * w], [ri + 0.25 * h, w], [ro - 0.25 * h, w],
    [ro, 0.6 * w], [ro, -0.6 * w], [ro - 0.25 * h, -w], [ri + 0.25 * h, -w],
  ];
  const col = [paint, paint, paint, tread, tread, tread, paint, paint];
  const rc = (ro + ri) / 2;
  const pt = (t: number, k: number): Vec => {
    const [rho, s] = sec[k % 8]!;
    const ct = Math.cos(t), st = Math.sin(t);
    return {
      x: c.x + (e1.x * ct + e2.x * st) * rho + n.x * s,
      y: c.y + (e1.y * ct + e2.y * st) * rho + n.y * s,
      z: c.z + (e1.z * ct + e2.z * st) * rho + n.z * s,
    };
  };
  for (let i = 0; i < segs; i++) {
    const ta = t0 + ((t1 - t0) * i) / segs, tb = t0 + ((t1 - t0) * (i + 1)) / segs, tm = (ta + tb) / 2;
    const cm = Math.cos(tm), sm = Math.sin(tm);
    for (let k = 0; k < 8; k++) {
      const [r0, s0] = sec[k]!, [r1, s1] = sec[(k + 1) % 8]!;
      const dr = (r0 + r1) / 2 - rc, ds = (s0 + s1) / 2;
      const hint: Vec = {
        x: (e1.x * cm + e2.x * sm) * dr + n.x * ds,
        y: (e1.y * cm + e2.y * sm) * dr + n.y * ds,
        z: (e1.z * cm + e2.z * sm) * dr + n.z * ds,
      };
      face(b, pt(ta, k), pt(tb, k), pt(tb, k + 1), pt(ta, k + 1), hint, col[k]!);
    }
  }
}

/** A tyre half-buried on edge, its hole facing along the frame's v (a hoop in the a–y plane). */
function addTyreArch(b: LandmarkMeshBuilder, f: Frame, a: number, c: number, y: number, paint: Color, tread: Color, segs: number): void {
  const o = at(f, a, c, y);
  addTyre(b, o, { x: f.ux, y: 0, z: f.uz }, Y_AXIS, { x: f.vx, y: 0, z: f.vz }, 0.34, 0.11, 0.1, paint, tread, 0, Math.PI, segs);
}

/** A tyre lying flat; `ro` is its outer radius, `y` the ground under it. */
function addFlatTyre(b: LandmarkMeshBuilder, x: number, z: number, y: number, ro: number, w: number, paint: Color, tread: Color, segs: number): void {
  addTyre(b, { x, y: y + w, z }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, Y_AXIS, ro, w, ro * 0.3, paint, tread, 0, Math.PI * 2, segs);
}

/** Two stacked tyres with soil and a shrub on top (the planters in the photos). */
function addTyrePlanter(b: LandmarkMeshBuilder, x: number, z: number, y: number, lower: Color, upper: Color, big: boolean, segs: number): void {
  const ro = big ? 0.62 : 0.4, w = big ? 0.16 : 0.1;
  addFlatTyre(b, x, z, y, ro, w, lower, TREAD_WHITE, segs);
  let top = y + 2 * w;
  if (!big) { addFlatTyre(b, x, z, top, ro * 0.95, w, upper, TREAD_WHITE, segs); top += 2 * w; }
  b.addDisc(x, top - 0.02, z, ro * 0.6, SOIL, segs, 1);
  b.cylinder(x, top - 0.02, z, 0.16, 0.34, LEAF, 6);
}

/** Curved climbing ladder: two green arc rails over orange rungs, spanning `a0..a1` at width `wid` around c. */
function addClimbingArch(b: LandmarkMeshBuilder, f: Frame, a: number, c: number, y: number, quality: 'high' | 'low'): void {
  const span = 1.5, peak = 1.55, n = quality === 'high' ? 10 : 6, rails: Vec[][] = [[], []];
  [-0.42, 0.42].forEach((cc, k) => {
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * 2 - 1;
      rails[k]!.push(at(f, a + t * span, c + cc, y + peak * (1 - t * t) * (t < 0 ? 1 : 0.85)));
    }
    tubePath(b, rails[k]!, 0.03, PIPE_GREEN, 6);
    // legs
    for (const e of [rails[k]![0]!, rails[k]![n]!]) tube(b, { x: e.x, y, z: e.z }, e, 0.03, 0.03, PIPE_GREEN, 6, false);
  });
  for (let i = 1; i < n; i++) tube(b, rails[0]![i]!, rails[1]![i]!, 0.02, 0.02, PIPE_ORANGE, 5, false);
}

/** Board on three tyres with handlebars: the "scooter" ride, front wheel toward -a, two rear wheels at +a. */
function addBoardRide(b: LandmarkMeshBuilder, f: Frame, a: number, c: number, y: number, segs: number): void {
  const u: Vec = { x: f.ux, y: 0, z: f.uz }, v: Vec = { x: f.vx, y: 0, z: f.vz };
  const wheel = (aa: number, cc: number) => addTyre(b, at(f, a + aa, c + cc, y + 0.4), u, Y_AXIS, v, 0.4, 0.1, 0.13, TYRE_TEAL, TREAD_WHITE, 0, Math.PI * 2, segs);
  wheel(-1.2, 0);
  wheel(1.15, -0.55);
  wheel(1.15, 0.55);
  fbox(b, f, a - 1.2, a + 1.2, c - 0.19, c + 0.19, y + 0.5, y + 0.55, PLANK_GREEN);
  tube(b, at(f, a - 1.2, c, y + 0.5), at(f, a - 1.2, c, y + 1.0), 0.03, 0.03, BRASS, 6, false);
  tube(b, at(f, a - 1.2, c - 0.32, y + 1.0), at(f, a - 1.2, c + 0.32, y + 1.0), 0.02, 0.02, STEEL, 5, false);
}

/** Flat-roofed shelter on four painted posts with a table, benches and brown bottles hung under the roof. */
function addShelter(b: LandmarkMeshBuilder, f: Frame, a: number, c: number, y: number): void {
  const posts: [number, number, Color][] = [[-1.2, -1.2, POST_PINK], [1.2, -1.2, POST_RED], [-1.2, 1.2, POST_PINK], [1.2, 1.2, POST_RED]];
  for (const [pa, pc, col] of posts) fbox(b, f, a + pa - 0.06, a + pa + 0.06, c + pc - 0.06, c + pc + 0.06, y, y + 2.35, col, false);
  fbox(b, f, a - 1.5, a + 1.5, c - 1.5, c + 1.5, y + 2.35, y + 2.45, ROOF);
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1, t = -1.2 + (i * 2.4) / 9;
    const o = at(f, a + t, c + side * 1.35, y + 2.34);
    tube(b, { ...o, y: o.y - 0.28 }, o, 0.045, 0.045, BOTTLE, 5);
    tube(b, { ...o, y: o.y - 0.14 }, { ...o, y: o.y }, 0.02, 0.02, BOTTLE, 5, false);
  }
  fbox(b, f, a - 1.0, a + 1.0, c - 0.4, c + 0.4, y + 0.72, y + 0.78, PLANK);
  for (const cc of [-0.43, 0.43]) fbox(b, f, a - 1.0, a + 1.0, c + cc * 1.8 - 0.14, c + cc * 1.8 + 0.14, y + 0.44, y + 0.48, PLANK);
  for (const pa of [-0.9, 0.9]) {
    fbox(b, f, a + pa - 0.04, a + pa + 0.04, c - 0.3, c + 0.3, y, y + 0.72, POST_PINK, false);
    for (const cc of [-0.77, 0.77]) fbox(b, f, a + pa - 0.04, a + pa + 0.04, c + cc - 0.04, c + cc + 0.04, y, y + 0.44, POST_PINK, false);
  }
  // ivy climbing the first post
  for (let i = 0; i < 7; i++) {
    const h = 0.3 + i * 0.3, o = i % 2 ? 0.1 : -0.1;
    fbox(b, f, a - 1.2 + o - 0.22, a - 1.2 + o + 0.22, c - 1.2 - 0.2, c - 1.2 + 0.2, y + h, y + h + 0.34, IVY, false);
  }
}

/** Green pipe-frame bench. */
function addPipeBench(b: LandmarkMeshBuilder, f: Frame, a: number, c: number, y: number): void {
  for (const pa of [-1.0, 1.0]) fbox(b, f, a + pa - 0.04, a + pa + 0.04, c - 0.22, c + 0.22, y, y + 0.46, PIPE_GREEN, false);
  fbox(b, f, a - 1.15, a + 1.15, c - 0.2, c + 0.2, y + 0.44, y + 0.5, PLANK_GREEN);
}

/** The tyre-art courtyard on the west side of Filatova 28, the side that faces school 28-А. */
export function createFilatovaCourtyard(bbox: Bbox): Landmark {
  const [wa, wb] = FILATOVA_28_DATA.westWall.map(([lat, lon]) => fromLatLon(bbox, lat, lon)) as [{ x: number; z: number }, { x: number; z: number }];
  const mx = (wa.x + wb.x) / 2, mz = (wa.z + wb.z) / 2;
  // frame: a runs along the facade (south end → north end), c > 0 toward the house, c < 0 into the yard
  const f = frameAt(mx, mz, Math.atan2(wa.z - wb.z, wa.x - wb.x));
  return {
    id: 'courtyard-filatova-28',
    name: 'Двір Філатова, 28',
    anchor: { lat: (FILATOVA_28_DATA.westWall[0][0] + FILATOVA_28_DATA.westWall[1][0]) / 2, lon: (FILATOVA_28_DATA.westWall[0][1] + FILATOVA_28_DATA.westWall[1][1]) / 2, x: mx, z: mz },
    footprint: [],
    ready: (ctx: LandmarkBuildContext) => ctx.groundAt(mx, mz) !== null,
    build: (ctx) => {
      const b = new LandmarkMeshBuilder();
      const hi = ctx.quality === 'high', segs = hi ? 12 : 8;
      const gy = (a: number, c: number): number => { const p = at(f, a, c, 0); return ctx.groundAt(p.x, p.z) ?? ctx.groundAt(mx, mz) ?? 0; };
      // the service drive runs along the wall at c ≈ -6.5; the beds sit between it and the wall, the rest out in the yard
      // half-buried tyre arcs: one row along the drive's yard edge, one behind the climbing arch
      const row1 = [TYRE_GREEN, TYRE_YELLOW, TYRE_PINK, TYRE_TEAL, TYRE_GREEN, TYRE_PINK];
      row1.forEach((col, i) => { const a = -8 + i * 0.75; addTyreArch(b, f, a, -10, gy(a, -10), col, col, hi ? 8 : 6); });
      const row2 = [TYRE_PINK, TYRE_TEAL, TYRE_GREEN, TYRE_YELLOW, TYRE_PINK, TYRE_BLUE, TYRE_GREEN];
      row2.forEach((col, i) => { const a = -10 + i * 0.75; addTyreArch(b, f, a, -19, gy(a, -19), col, col, hi ? 8 : 6); });
      // flat tyre beds along the far verge
      ([[2, TYRE_BLUE], [4.6, TYRE_BLUE], [7.2, TYRE_RED], [9.8, TYRE_BLUE], [12.4, TYRE_RED]] as const).forEach(([a, col]) => {
        const p = at(f, a, -2.5, 0); addFlatTyre(b, p.x, p.z, gy(a, -2.5), 0.46, 0.1, col, col, segs);
      });
      // stacked planters near the shelter, and one big grey tractor tyre in the foreground
      ([[8.5, -12.5, TYRE_BLUE, TYRE_PURPLE], [11, -14, TYRE_TEAL, TYRE_PINK], [13.5, -12.8, TYRE_BLUE, TYRE_GREY], [15.8, -15, TYRE_TEAL, TYRE_RED]] as const).forEach(([a, c, lo, up]) => {
        const p = at(f, a, c, 0); addTyrePlanter(b, p.x, p.z, gy(a, c), lo, up, false, segs);
      });
      const big = at(f, -12, -13, 0);
      addTyrePlanter(b, big.x, big.z, gy(-12, -13), TYRE_GREY, TYRE_GREY, true, segs);
      addClimbingArch(b, f, -1, -14, gy(-1, -14), ctx.quality);
      addBoardRide(b, f, -9.5, -14.5, gy(-9.5, -14.5), segs);
      addShelter(b, f, 4.5, -18, gy(4.5, -18));
      addPipeBench(b, f, 3, -12, gy(3, -12));
      return buildResult([b.finish('opaque')], [], undefined, { pavedAreaM2: 0, lamps: 0, benches: 2 });
    },
  };
}
