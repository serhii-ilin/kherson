import { buildProp, PROP } from '../fine/prop-models.ts';
import { fromLatLon } from './geo.ts';
import { EMBANKMENT_DATA, PIER_AVENUE_END, type LatLon } from './data.ts';
import {
  addCannon, addCrookLamp, addFlowerBed, addFrigateMonument, addParkBench, addRailPost, addRails, addYacht,
  RAIL_BLUE, RAIL_WHITE,
} from './embankment-props.ts';
import { at, face, fbox, tube, toFrame, type Frame } from './shapes.ts';
import {
  buildResult, LandmarkMeshBuilder, pointInPolygon, polygonArea, rgb,
  type Landmark, type LandmarkBuildContext, type LandmarkSurface,
} from './types.ts';
import type { Bbox } from '../world/manifest.ts';

// Grey-beige concrete cobbles with a few lighter and warmer stones, red-brown border bands (2008 reconstruction).
const PAVE = rgb(0x9a958c);
const PAVE_ALT = rgb(0xaaa49a);
const PAVE_WARM = rgb(0x8f7f72);
const JOINT = rgb(0x85817a);
const BAND = rgb(0x8c5546);
const COPING = rgb(0xb4b0a6);
const KERB = rgb(0xa8a69e);
const QUAY = rgb(0x6e726e);
const WATER = rgb(0x5fb3ad);
const MOSAIC = rgb(0x3f9c97);
const RIM_RED = rgb(0x6e2f2c);
const RIM_TOP = rgb(0xe4e2dc);
const STEP = rgb(0xc9c5bb);
const PONTOON = rgb(0xb7b4ac);
const PONTOON_HULL = rgb(0x4a6378);

type Point = [number, number];
/** Half-length of the railing-free bathing steps along the quay (estimated from the owner's photos 13–15). */
const STEPS_HALF = 15;

export interface ShoreSegment { p: Point; q: Point; frame: Frame; length: number; s0: number; }
export interface EmbankmentLayout {
  polygon: Point[];
  holes: Point[][];
  monument: Point[];
  fountain: Point[];
  shore: ShoreSegment[];
  /** non-shore edges along the park, for the lamp/bench row and the kerb */
  parkEdges: ShoreSegment[];
  frame: Frame;
  bounds: { a0: number; a1: number; c0: number; c1: number };
  cannon: Point;
  ferry: Point;
  anchor: Point;
}

const project = (bbox: Bbox, pts: readonly LatLon[]): Point[] => pts.map(([lat, lon]) => { const p = fromLatLon(bbox, lat, lon); return [p.x, p.z]; });
const centroid = (poly: readonly Point[]): Point => {
  let x = 0, z = 0;
  for (const p of poly) { x += p[0]; z += p[1]; }
  return [x / poly.length, z / poly.length];
};

/** Edge frame with u along p→q and v (c > 0) pointing into the polygon. */
function edge(polygon: readonly Point[], p: Point, q: Point, s0: number): ShoreSegment {
  const dx = q[0] - p[0], dz = q[1] - p[1], length = Math.hypot(dx, dz) || 1;
  const ux = dx / length, uz = dz / length;
  let vx = -uz, vz = ux;
  const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
  if (!pointInPolygon(polygon, mx + vx * 0.4, mz + vz * 0.4)) { vx = -vx; vz = -vz; }
  return { p, q, length, s0, frame: { x: p[0], z: p[1], ux, uz, vx, vz } };
}

/** Promenade geometry straight from the OSM pedestrian multipolygon; cheap and worker-safe. */
export function resolveEmbankmentLayout(bbox: Bbox): EmbankmentLayout {
  const polygon = project(bbox, EMBANKMENT_DATA.promenade);
  const monument = project(bbox, EMBANKMENT_DATA.monument);
  const fountain = project(bbox, EMBANKMENT_DATA.fountain);
  const shore: ShoreSegment[] = [];
  let s = 0;
  for (let i = EMBANKMENT_DATA.shoreFrom; i < EMBANKMENT_DATA.shoreTo; i++) {
    const seg = edge(polygon, polygon[i]!, polygon[i + 1]!, s);
    if (seg.length < 0.05) continue;
    shore.push(seg); s += seg.length;
  }
  // park side: from the end of the quay round to the footway at the avenue (vertex 1); the west
  // edges (1→2→3) border the port fence
  const parkEdges: ShoreSegment[] = [];
  s = 0;
  for (let i: number = EMBANKMENT_DATA.shoreTo; i !== 1; i = (i + 1) % polygon.length) {
    const seg = edge(polygon, polygon[i]!, polygon[(i + 1) % polygon.length]!, s);
    if (seg.length < 0.05) continue;
    parkEdges.push(seg); s += seg.length;
  }
  const first = polygon[EMBANKMENT_DATA.shoreFrom]!, last = polygon[EMBANKMENT_DATA.shoreTo]!;
  const angle = Math.atan2(last[1] - first[1], last[0] - first[0]);
  const frame: Frame = { x: first[0], z: first[1], ux: Math.cos(angle), uz: Math.sin(angle), vx: -Math.sin(angle), vz: Math.cos(angle) };
  let a0 = Infinity, a1 = -Infinity, c0 = Infinity, c1 = -Infinity;
  for (const [x, z] of polygon) {
    const [a, c] = toFrame(frame, x, z);
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); c0 = Math.min(c0, c); c1 = Math.max(c1, c);
  }
  const cannon = fromLatLon(bbox, EMBANKMENT_DATA.cannon[0], EMBANKMENT_DATA.cannon[1]);
  const ferry = fromLatLon(bbox, EMBANKMENT_DATA.ferry[0], EMBANKMENT_DATA.ferry[1]);
  return {
    polygon, holes: [monument, fountain], monument, fountain, shore, parkEdges, frame,
    bounds: { a0, a1, c0, c1 }, cannon: [cannon.x, cannon.z], ferry: [ferry.x, ferry.z], anchor: centroid(polygon),
  };
}

function yAt(ctx: LandmarkBuildContext, x: number, z: number, fallback: number): number {
  const y = ctx.groundAt(x, z);
  return y !== null && Number.isFinite(y) ? y : fallback;
}

function nearestShore(layout: EmbankmentLayout, x: number, z: number): { seg: ShoreSegment; a: number; c: number } {
  let best = layout.shore[0]!, ba = 0, bc = 0, bd = Infinity;
  for (const seg of layout.shore) {
    const [a, c] = toFrame(seg.frame, x, z);
    const ac = Math.max(0, Math.min(seg.length, a));
    const d = Math.hypot(a - ac, c);
    if (d < bd) { bd = d; best = seg; ba = a; bc = c; }
  }
  return { seg: best, a: ba, c: bc };
}

/** Walks the polyline by arc length, calling `fn` every `step` metres starting at `offset`. */
function along(segs: readonly ShoreSegment[], step: number, offset: number, fn: (seg: ShoreSegment, a: number, s: number) => void): void {
  const total = segs.length === 0 ? 0 : segs[segs.length - 1]!.s0 + segs[segs.length - 1]!.length;
  for (let s = offset; s < total; s += step) {
    const seg = segs.find((g) => s >= g.s0 && s < g.s0 + g.length);
    if (seg !== undefined) fn(seg, s - seg.s0, s);
  }
}

export function createPier(bbox: Bbox): Landmark {
  const layout = resolveEmbankmentLayout(bbox);
  const { polygon, holes, frame, bounds, shore, parkEdges } = layout;
  const anchor = layout.anchor;
  const inPaving = (x: number, z: number) => pointInPolygon(polygon, x, z) && !holes.some((h) => pointInPolygon(h, x, z));
  const propExclusions = [{ polygon, kinds: [PROP.LAMP, PROP.BENCH, PROP.BIN] }];
  const avenue = fromLatLon(bbox, PIER_AVENUE_END[0], PIER_AVENUE_END[1]);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of polygon) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  return {
    id: 'pier-ushakova',
    name: 'Набережна Ушакова',
    anchor: { lat: PIER_AVENUE_END[0], lon: PIER_AVENUE_END[1], x: anchor[0], z: anchor[1] },
    footprint: polygon,
    propExclusions,
    vegetationExclusions: [polygon],
    ready: (ctx) => ctx.groundAt(anchor[0], anchor[1]) !== null && ctx.groundAt(avenue.x, avenue.z) !== null,
    build: (ctx) => {
      const quality = ctx.quality === 'high' ? 'high' : 'low';
      const opaque = new LandmarkMeshBuilder(), paving = new LandmarkMeshBuilder(), lamp = new LandmarkMeshBuilder(), water = new LandmarkMeshBuilder();
      const surfaces: LandmarkSurface[] = [];

      // Promenade level: the ground under the paving, never dipping into the river bank cells.
      const samples: number[] = [];
      for (let i = 0; i < polygon.length; i++) {
        const p = polygon[i]!, q = centroid([p, anchor, anchor]);
        if (!ctx.isWater?.(q[0], q[1])) samples.push(yAt(ctx, q[0], q[1], NaN));
      }
      const finite = samples.filter(Number.isFinite).sort((x, y) => x - y);
      const base = finite.length > 0 ? finite[Math.floor(finite.length / 2)]! : yAt(ctx, anchor[0], anchor[1], 0);
      const groundY = (x: number, z: number): number => {
        const y = ctx.isWater?.(x, z) ? null : ctx.groundAt(x, z);
        return y === null || !Number.isFinite(y) ? base : Math.max(y, base - 0.8);
      };
      const paveY = (x: number, z: number): number => {
        let y = -Infinity;
        for (const [dx, dz] of [[0, 0], [0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]] as const) y = Math.max(y, groundY(x + dx, z + dz));
        return y + 0.04;
      };

      // Pavers on a mortar bed; boundary tiles split into thirds so the outline follows the OSM polygon.
      const tile = quality === 'high' ? 1.5 : 2.5, gap = 0.025;
      let pavedArea = 0;
      const lay = (a0: number, a1: number, c0: number, c1: number) => {
        // the bed sits on the highest ground under the tile, so no lawn shows through the joints
        let y = -Infinity;
        for (const [a, c] of [[a0, c0], [a1, c0], [a1, c1], [a0, c1], [(a0 + a1) / 2, (c0 + c1) / 2]] as const) {
          const p = at(frame, a, c, 0);
          y = Math.max(y, groundY(p.x, p.z));
        }
        y += 0.04;
        face(paving, at(frame, a0, c0, y), at(frame, a1, c0, y), at(frame, a1, c1, y), at(frame, a0, c1, y), { x: 0, y: 1, z: 0 }, JOINT);
        const h = Math.abs(Math.sin(Math.floor(a0 * 3.1) * 12.9898 + Math.floor(c0 * 2.3) * 78.233) * 43758.5453) % 1;
        fbox(paving, frame, a0 + gap, a1 - gap, c0 + gap, c1 - gap, y, y + 0.06, h < 0.08 ? PAVE_WARM : h < 0.3 ? PAVE_ALT : PAVE, false);
        pavedArea += (a1 - a0) * (c1 - c0);
      };
      const inside = (a: number, c: number) => { const p = at(frame, a, c, 0); return inPaving(p.x, p.z); };
      for (let a0 = Math.floor(bounds.a0 / tile) * tile; a0 < bounds.a1; a0 += tile) {
        for (let c0 = Math.floor(bounds.c0 / tile) * tile; c0 < bounds.c1; c0 += tile) {
          const a1 = a0 + tile, c1 = c0 + tile;
          const corners = [inside(a0, c0), inside(a1, c0), inside(a1, c1), inside(a0, c1), inside((a0 + a1) / 2, (c0 + c1) / 2)];
          const n = corners.filter(Boolean).length;
          if (n === 0) continue;
          if (n === 5) { lay(a0, a1, c0, c1); continue; }
          // edge tile: thirds across, merged into runs along a, so the outline steps by tile / 3
          const t = tile / 3;
          for (let j = 0; j < 3; j++) {
            const sc = c0 + j * t;
            let start = -1;
            for (let i = 0; i <= 3; i++) {
              const ok = i < 3 && inside(a0 + i * t + t / 2, sc + t / 2);
              if (ok && start < 0) start = i;
              if (!ok && start >= 0) { lay(a0 + start * t, a0 + i * t, sc, sc + t); start = -1; }
            }
          }
        }
      }
      surfaces.push({ heightAt: (x, z) => (x < minX || x > maxX || z < minZ || z > maxZ || !inPaving(x, z) ? null : paveY(x, z) + 0.06) });

      // Water level, sampled a little out from the quay.
      const fs = nearestShore(layout, layout.ferry[0], layout.ferry[1]);
      const out = at(fs.seg.frame, fs.a, -12, 0);
      const waterY = Math.min(ctx.isWater?.(out.x, out.z) ? yAt(ctx, out.x, out.z, base - 1.8) : base - 1.8, base - 0.9);
      const gangA = fs.a, gangSeg = fs.seg;
      const inGang = (seg: ShoreSegment, a: number) => seg === gangSeg && Math.abs(a - gangA) < 1.1;

      const monumentC = centroid(layout.monument), fountainC = centroid(layout.fountain);
      // Bathing steps: the quay in front of the fountain plaza has no railing and steps down into the
      // river (owner's photos 13–15), centred on the quay point nearest to the fountain.
      const fountainShore = nearestShore(layout, fountainC[0], fountainC[1]);
      const stepsS = fountainShore.seg.s0 + Math.max(0, Math.min(fountainShore.seg.length, fountainShore.a));
      const inSteps = (seg: ShoreSegment, a: number) => Math.abs(seg.s0 + a - stepsS) < STEPS_HALF;
      const STEP_N = 4, STEP_D = 0.75;

      // Quay edge: wall face, light coping, red-brown border band and the blue-and-white railing.
      const railY: number[] = [];
      for (const seg of shore) {
        const f = seg.frame;
        const pieces = Math.max(1, Math.ceil(seg.length / 3));
        let sum = 0;
        for (let k = 0; k < pieces; k++) {
          const a0 = (k / pieces) * seg.length, a1 = ((k + 1) / pieces) * seg.length;
          const m = at(f, (a0 + a1) / 2, 1.2, 0), y = paveY(m.x, m.z);
          sum += y;
          fbox(paving, f, a0, a1, 0.45, 1.05, y + 0.02, y + 0.085, BAND, false);
          if (inSteps(seg, (a0 + a1) / 2)) {
            // four broad concrete steps out over the water, the last one just under the surface
            fbox(opaque, f, a0, a1, -0.2, 0.45, y - 0.1, y + 0.1, STEP);
            for (let i = 1; i <= STEP_N; i++) {
              const top = y + 0.1 - (y + 0.1 - (waterY - 0.15)) * (i / STEP_N);
              fbox(opaque, f, a0, a1, -0.2 - i * STEP_D, -0.2 - (i - 1) * STEP_D, waterY - 0.8, top, STEP);
            }
            continue;
          }
          fbox(opaque, f, a0, a1, -0.5, -0.2, waterY - 0.8, y + 0.1, QUAY);
          fbox(opaque, f, a0, a1, -0.2, 0.45, y - 0.1, y + 0.14, COPING);
        }
        railY.push(sum / pieces);
        const n = Math.max(1, Math.round(seg.length / 2.1));
        let prev: { a: number; y: number } | null = null;
        for (let k = 0; k <= n; k++) {
          const a = (k / n) * seg.length;
          if (inGang(seg, a) || inSteps(seg, a)) { prev = null; continue; }
          const m = at(f, a, 0.15, 0), y = paveY(m.x, m.z) + 0.12;
          addRailPost(opaque, f, a, y);
          if (prev !== null) addRails(opaque, f, prev.a, a, prev.y, y);
          prev = { a, y };
        }
      }
      let sMinX = Infinity, sMaxX = -Infinity, sMinZ = Infinity, sMaxZ = -Infinity;
      for (const seg of shore) for (const p of [seg.p, seg.q]) { sMinX = Math.min(sMinX, p[0]); sMaxX = Math.max(sMaxX, p[0]); sMinZ = Math.min(sMinZ, p[1]); sMaxZ = Math.max(sMaxZ, p[1]); }
      surfaces.push({ heightAt: () => null, blockedAt: (x, z, y, bodyH = 1.8) => {
        if (x < sMinX - 1 || x > sMaxX + 1 || z < sMinZ - 1 || z > sMaxZ + 1) return false;
        for (let i = 0; i < shore.length; i++) {
          const seg = shore[i]!, [a, c] = toFrame(seg.frame, x, z);
          if (a < -0.2 || a > seg.length + 0.2 || Math.abs(c - 0.1) > 0.35 || inGang(seg, a) || inSteps(seg, a)) continue;
          if (y < railY[i]! + 1.25 && y + bodyH > railY[i]!) return true;
        }
        return false;
      } });

      // Red-brown bands fanning out from the fountain to the steps, and one along the quay (photo 13).
      {
        const band = (p: Point, q: Point, w: number) => {
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (len < 1) return;
          const f: Frame = { x: p[0], z: p[1], ux: (q[0] - p[0]) / len, uz: (q[1] - p[1]) / len, vx: -(q[1] - p[1]) / len, vz: (q[0] - p[0]) / len };
          const n = Math.ceil(len / 1.5);
          for (let k = 0; k < n; k++) {
            const a0 = (k / n) * len, a1 = ((k + 1) / n) * len, m = at(f, (a0 + a1) / 2, 0, 0);
            if (!inPaving(m.x, m.z)) continue;
            const y = paveY(m.x, m.z);
            fbox(paving, f, a0, a1, -w / 2, w / 2, y + 0.02, y + 0.088, BAND, false);
          }
        };
        const seg = fountainShore.seg, aMid = stepsS - seg.s0;
        const fc: Point = [fountainC[0], fountainC[1]];
        for (const da of [-STEPS_HALF, -STEPS_HALF / 3, STEPS_HALF / 3, STEPS_HALF]) {
          const q = at(seg.frame, aMid + da, 1.2, 0), d = Math.hypot(q.x - fc[0], q.z - fc[1]);
          const start: Point = [fc[0] + (q.x - fc[0]) * 6.5 / d, fc[1] + (q.z - fc[1]) * 6.5 / d];
          band(start, [q.x, q.z], 0.9);
        }
        const b0 = at(seg.frame, aMid - STEPS_HALF - 6, 7, 0), b1 = at(seg.frame, aMid + STEPS_HALF + 6, 7, 0);
        band([b0.x, b0.z], [b1.x, b1.z], 0.9);
      }

      // Walkable steps, and white parapets with a short railing where the railing stops (photo 15).
      {
        const seg = fountainShore.seg, f = seg.frame;
        const aMid = stepsS - seg.s0;
        const m = at(f, aMid, 1.2, 0), y = paveY(m.x, m.z);
        surfaces.push({ heightAt: (x, z) => {
          const [a, c] = toFrame(f, x, z);
          if (Math.abs(a - aMid) >= STEPS_HALF || c > -0.2 || c < -0.2 - STEP_N * STEP_D) return null;
          const i = Math.min(STEP_N, Math.floor((-0.2 - c) / STEP_D) + 1);
          return y + 0.1 - (y + 0.1 - (waterY - 0.15)) * (i / STEP_N);
        } });
        for (const end of [-1, 1]) {
          const a = aMid + end * STEPS_HALF, a0 = a - (end > 0 ? 0 : 0.5), a1 = a + (end > 0 ? 0.5 : 0);
          for (let i = 0; i <= STEP_N; i++) {
            const top = i === 0 ? y + 0.6 : y + 0.6 - (y + 0.1 - (waterY - 0.15)) * (i / STEP_N);
            fbox(opaque, f, a0, a1, -0.2 - i * STEP_D, -0.2 - (i - 1) * STEP_D + (i === 0 ? 0.65 : 0), waterY - 0.8, top, STEP);
          }
          const ra = a + end * 0.25;
          for (let i = 0; i < STEP_N; i++) {
            const c = -0.2 - (i + 0.5) * STEP_D, yy = y + 0.6 - (y + 0.1 - (waterY - 0.15)) * ((i + 1) / STEP_N);
            tube(opaque, at(f, ra, c, yy), at(f, ra, c, yy + 0.9), 0.03, 0.03, RAIL_BLUE, 5, false);
          }
          const yTop = y + 0.6 + 0.9, yLow = y + 0.6 - (y + 0.1 - (waterY - 0.15)) + 0.9;
          tube(opaque, at(f, ra, -0.2 - 0.5 * STEP_D, yTop - (yTop - yLow) / STEP_N), at(f, ra, -0.2 - (STEP_N - 0.5) * STEP_D, yLow), 0.03, 0.03, RAIL_WHITE, 6, false);
        }
      }

      // Lamps along the railing and along the park edge; benches facing the river between the park lamps.
      const lampPoints: Point[] = [];
      along(shore, 16, 6, (seg, a) => {
        const m = at(seg.frame, a, 1.7, 0);
        if (!inPaving(m.x, m.z) || inSteps(seg, a)) return;
        addCrookLamp(opaque, lamp, m.x, paveY(m.x, m.z) + 0.06, m.z, seg.frame.ux, seg.frame.uz, quality);
        lampPoints.push([m.x, m.z]);
      });
      const benchModelBin = buildProp(PROP.BIN, 0);
      let benches = 0;
      along(parkEdges, 18, 4, (seg, a) => {
        const m = at(seg.frame, a, 1.5, 0);
        if (inPaving(m.x, m.z)) {
          addCrookLamp(opaque, lamp, m.x, paveY(m.x, m.z) + 0.06, m.z, -seg.frame.ux, -seg.frame.uz, quality);
          lampPoints.push([m.x, m.z]);
        }
        for (const da of [6, 12]) {
          if (a + da > seg.length - 1) continue;
          const bp = at(seg.frame, a + da, 1.2, 0);
          if (!inPaving(bp.x, bp.z)) continue;
          const by = paveY(bp.x, bp.z) + 0.06;
          addParkBench(opaque, { ...seg.frame, x: bp.x, z: bp.z }, by); benches++;
          if (da === 12 && benches % 2 === 0) {
            const bin = at(seg.frame, a + da + 1.5, 0.9, 0);
            opaque.addProp(benchModelBin, bin.x, by, bin.z, 0);
          }
        }
      });
      // A low granite kerb where the paving meets the park lawn.
      for (const seg of parkEdges) {
        const pieces = Math.max(1, Math.ceil(seg.length / 4));
        for (let k = 0; k < pieces; k++) {
          const a0 = (k / pieces) * seg.length, a1 = ((k + 1) / pieces) * seg.length;
          const m = at(seg.frame, (a0 + a1) / 2, 0.15, 0), y = paveY(m.x, m.z);
          fbox(paving, seg.frame, a0, a1, 0, 0.3, y - 0.1, y + 0.16, KERB);
        }
      }

      // Long white-kerbed flower beds down the middle of the promenade.
      along(shore, 21, 9, (seg, a, s) => {
        let w = 0;
        for (let c = 2; c < 40; c += 0.5) { const p = at(seg.frame, a, c, 0); if (!pointInPolygon(polygon, p.x, p.z)) break; w = c; }
        if (w < 10) return;
        const centre = at(seg.frame, a, w * 0.5, 0);
        if (Math.hypot(centre.x - monumentC[0], centre.z - monumentC[1]) < 12 || Math.hypot(centre.x - fountainC[0], centre.z - fountainC[1]) < 9) return;
        const f = { ...seg.frame, x: centre.x, z: centre.z };
        const ok = [[-2.3, -0.9], [2.3, -0.9], [2.3, 0.9], [-2.3, 0.9]].every(([da, dc]) => { const p = at(f, da!, dc!, 0); return inPaving(p.x, p.z); });
        if (!ok) return;
        addFlowerBed(opaque, f, 4.4, 1.7, paveY(centre.x, centre.z) + 0.06, Math.round(s));
      });

      // The Frigate on its mapped pedestal, relief toward the park.
      {
        const m = layout.monument;
        const e0 = [m[1]![0] - m[0]![0], m[1]![1] - m[0]![1]], e1 = [m[2]![0] - m[1]![0], m[2]![1] - m[1]![1]];
        const l0 = Math.hypot(e0[0]!, e0[1]!), l1 = Math.hypot(e1[0]!, e1[1]!);
        const long = l0 >= l1 ? e0 : e1, len = Math.max(l0, l1), wid = Math.min(l0, l1);
        const ux = long[0]! / len, uz = long[1]! / len;
        let vx = -uz, vz = ux;
        if (vx * (layout.cannon[0] - monumentC[0]) + vz * (layout.cannon[1] - monumentC[1]) > 0) { vx = -vx; vz = -vz; }
        const f: Frame = { x: monumentC[0], z: monumentC[1], ux, uz, vx, vz };
        const my = Math.max(...m.map(([x, z]) => paveY(x, z)));
        addFrigateMonument(opaque, f, len, wid, my);
        const L = len / 2 + 0.9, W = wid / 2 + 0.9;
        surfaces.push({
          heightAt: (x, z) => { const [a, c] = toFrame(f, x, z); return Math.abs(a) <= L && Math.abs(c) <= W ? my + 0.32 : null; },
          blockedAt: (x, z, y, bodyH = 1.8) => { const [a, c] = toFrame(f, x, z); return Math.abs(a) <= len / 2 && Math.abs(c) <= wid / 2 && y < my + 16 && y + bodyH > my + 0.4; },
        });
      }

      // The cannon on the bastion tip, aimed at the river.
      {
        const dx = layout.cannon[0] - monumentC[0], dz = layout.cannon[1] - monumentC[1], d = Math.hypot(dx, dz) || 1;
        const p: Point = [layout.cannon[0] - (dx / d) * 2.6, layout.cannon[1] - (dz / d) * 2.6];
        addCannon(opaque, { x: p[0], z: p[1], ux: dx / d, uz: dz / d, vx: -dz / d, vz: dx / d }, paveY(p[0], p[1]) + 0.06);
      }

      // Fountain: granite rim along the mapped outline, water and jets.
      {
        const fy = paveY(fountainC[0], fountainC[1]);
        const ring = layout.fountain;
        // red-brown granite wall under a white coping, teal mosaic basin (photo 13)
        for (let i = 0; i < ring.length; i++) {
          const seg = edge(ring, ring[i]!, ring[(i + 1) % ring.length]!, 0);
          fbox(opaque, seg.frame, -0.05, seg.length + 0.05, 0, 0.3, fy - 0.1, fy + 0.5, RIM_RED);
          fbox(opaque, seg.frame, -0.08, seg.length + 0.08, -0.06, 0.36, fy + 0.5, fy + 0.58, RIM_TOP);
        }
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
          face(opaque, { x: fountainC[0], y: fy + 0.06, z: fountainC[1] }, { x: fountainC[0], y: fy + 0.06, z: fountainC[1] }, { x: p[0], y: fy + 0.06, z: p[1] }, { x: q[0], y: fy + 0.06, z: q[1] }, { x: 0, y: 1, z: 0 }, MOSAIC);
          face(water, { x: fountainC[0], y: fy + 0.32, z: fountainC[1] }, { x: fountainC[0], y: fy + 0.32, z: fountainC[1] }, { x: p[0], y: fy + 0.32, z: p[1] }, { x: q[0], y: fy + 0.32, z: q[1] }, { x: 0, y: 1, z: 0 }, WATER);
        }
        tube(water, { x: fountainC[0], y: fy + 0.32, z: fountainC[1] }, { x: fountainC[0], y: fy + 2.2, z: fountainC[1] }, 0.12, 0.05, WATER, 8);
        for (const p of ring.filter((_, i) => i % 6 === 2)) {
          const x = fountainC[0] + (p[0] - fountainC[0]) * 0.6, z = fountainC[1] + (p[1] - fountainC[1]) * 0.6;
          tube(water, { x, y: fy + 0.32, z }, { x, y: fy + 1.0, z }, 0.06, 0.03, WATER, 6);
        }
        surfaces.push({ heightAt: (x, z) => (pointInPolygon(ring, x, z) ? fy + 0.58 : null) });
      }

      // Floating landing at the «Центральна набережна» stop, with a gangway, a small canopy and moored yachts.
      {
        const f = fs.seg.frame, a = fs.a;
        const deckY = waterY + 0.55, c0 = -3.2, c1 = -7.2;
        const probe = at(f, a, (c0 + c1) / 2, 0);
        if (ctx.isWater?.(probe.x, probe.z) !== false) {
          fbox(opaque, f, a - 10, a + 10, c1, c0, waterY - 0.45, deckY - 0.08, PONTOON_HULL);
          fbox(opaque, f, a - 10, a + 10, c1, c0, deckY - 0.08, deckY, PONTOON);
          const gTop = at(f, a, 1, 0), gy0 = paveY(gTop.x, gTop.z) + 0.08;
          // gangway with handrails
          face(opaque, at(f, a - 0.8, 0.2, gy0), at(f, a + 0.8, 0.2, gy0), at(f, a + 0.8, c0, deckY), at(f, a - 0.8, c0, deckY), { x: 0, y: 1, z: 0 }, PONTOON);
          for (const da of [-0.8, 0.8]) {
            tube(opaque, at(f, a + da, 0.2, gy0 + 1.0), at(f, a + da, c0, deckY + 1.0), 0.03, 0.03, RAIL_WHITE, 5, false);
            for (const c of [0.2, (0.2 + c0) / 2, c0]) { const t = (0.2 - c) / (0.2 - c0); const y = gy0 + (deckY - gy0) * t; tube(opaque, at(f, a + da, c, y), at(f, a + da, c, y + 1.0), 0.035, 0.035, RAIL_BLUE, 5, false); }
          }
          // railings on the river side and the ends
          const pf: Frame = { ...f, x: at(f, 0, c1 + 0.2, 0).x, z: at(f, 0, c1 + 0.2, 0).z };
          let prev: number | null = null;
          for (let da = -10; da <= 10.01; da += 2) { addRailPost(opaque, pf, a + da, deckY); if (prev !== null) addRails(opaque, pf, prev, a + da, deckY, deckY); prev = a + da; }
          for (const end of [-9.8, 9.8]) for (let c = c1 + 0.2; c <= c0 - 0.5; c += 1.3) tube(opaque, at(f, a + end, c, deckY), at(f, a + end, c, deckY + 1.05), 0.03, 0.03, RAIL_BLUE, 5, false);
          // canopy at the downstream end
          for (const da of [5, 9]) for (const c of [c0 - 0.4, c1 + 0.6]) tube(opaque, at(f, a + da, c, deckY), at(f, a + da, c, deckY + 2.5), 0.05, 0.05, RAIL_WHITE, 6, false);
          fbox(opaque, f, a + 4.6, a + 9.4, c1 + 0.2, c0 - 0.1, deckY + 2.5, deckY + 2.68, RAIL_BLUE);
          surfaces.push({ heightAt: (x, z) => {
            const [la, lc] = toFrame(f, x, z);
            if (Math.abs(la - a) <= 10 && lc <= c0 && lc >= c1) return deckY;
            if (Math.abs(la - a) <= 0.8 && lc <= 0.2 && lc > c0) return gy0 + (deckY - gy0) * ((0.2 - lc) / (0.2 - c0));
            return null;
          } });
          const yf = (da: number, c: number, ang: number): Frame => { const p = at(f, a + da, c, 0); return { x: p.x, z: p.z, ux: f.ux * Math.cos(ang) + f.vx * Math.sin(ang), uz: f.uz * Math.cos(ang) + f.vz * Math.sin(ang), vx: f.vx * Math.cos(ang) - f.ux * Math.sin(ang), vz: f.vz * Math.cos(ang) - f.uz * Math.sin(ang) }; };
          addYacht(opaque, yf(-4.5, c1 - 2.3, 0.04), waterY, 11, false);
          addYacht(opaque, yf(7, c1 - 2.6, Math.PI - 0.05), waterY, 12, true);
          addYacht(opaque, yf(-18, -4.5, 0.02), waterY, 9.5, false);
        }
      }

      return buildResult([paving.finish('paving'), opaque.finish('opaque'), lamp.finish('lamp'), water.finish('water')], surfaces, propExclusions, {
        pavedAreaM2: pavedArea, forecourtAreaM2: polygonArea(polygon), lamps: lampPoints.length, benches,
      });
    },
  };
}
