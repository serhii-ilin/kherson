import { describe, expect, it } from 'vitest';
import { addBuildings, type SmoothSink } from '../src/fine/buildings';
import { BlockWindow } from '../src/fine/blocks';
import { meshSmooth, type SmoothBuilding } from '../src/fine/smooth';
import { MAT } from '../src/world/materials';
import { bld, flatCtx, rect } from './fine-buildings-util';

/** A 12 x 50 m slab centred at (cx, cz), turned by `deg`. */
function slab(cx: number, cz: number, deg: number): Array<[number, number]> {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-25, -6], [25, -6], [25, 6], [-25, 6]].map(([u, v]) => [cx + u! * c - v! * s, cz + u! * s + v! * c] as [number, number]);
}

function run(placed: ReturnType<typeof bld>[], owns = true) {
  const w = new BlockWindow(0, 0);
  const sink: SmoothSink = { tops: new Uint8Array(w.foot.length), list: [], owns: () => owns };
  addBuildings(w, placed, { ...flatCtx, roadDist: () => 30 }, w.foot, w.tint, sink);
  return { w, sink };
}

describe('true-angle buildings', () => {
  it('draws a skewed khrushchevka as walls, not blocks, and keeps its physics columns', () => {
    const { w, sink } = run([bld(slab(32, 32, 29))]);
    expect(w.mats.some((m) => m !== 0)).toBe(false);
    expect(sink.list.length).toBe(1);
    const c = 33 * 66 + 33;
    expect(w.foot[c]).toBe(1);
    expect(sink.tops[c]).toBe(sink.list[0]!.top);
    expect(sink.list[0]!.top).toBe(4 + 16);
  });

  it('keeps axis-aligned blocks, and only the owner chunk emits the mesh', () => {
    expect(run([bld(rect(4, 10, 60, 22))]).sink.list.length).toBe(0);
    const other = run([bld(slab(32, 32, 29))], false);
    expect(other.sink.list.length).toBe(0);
    expect(other.w.foot[33 * 66 + 33]).toBe(1);
  });

  it('winds every face outward and puts the entrances on one long wall', () => {
    const { sink } = run([bld(slab(32, 32, 29))]);
    const m = meshSmooth(sink.list as SmoothBuilding[], 0, 0);
    const p = m.positions, n = m.normals, ix = m.indices;
    let against = 0;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t]! * 3, b = ix[t + 1]! * 3, c = ix[t + 2]! * 3;
      const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
      const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      if (fx * n[a]! + fy * n[a + 1]! + fz * n[a + 2]! < -1e-9) against++;
    }
    expect(against).toBe(0);
    // walls: style + tint, top, base, 16 + contact + 2 * entrance code; and the run along the wall
    const codes = new Set<number>();
    for (let v = 0; v < m.walls.length / 4; v++) {
      if (Math.floor(m.walls[v * 4]! + 0.02) !== MAT.WALL_KHRUSH) continue;
      expect(m.walls[v * 4 + 3]!).toBeGreaterThanOrEqual(17);
      codes.add(m.walls[v * 4 + 3]!);
      expect(m.runs[v * 2 + 1]!).toBeGreaterThan(11);
    }
    expect([...codes].filter((c) => c > 17).length).toBe(1);
    // outward normals point away from the slab centre
    for (let v = 0; v < p.length / 3; v++) {
      if (Math.abs(n[v * 3 + 1]!) > 0.5 || Math.floor(m.walls[v * 4]! + 0.02) !== MAT.WALL_KHRUSH) continue;
      expect((p[v * 3]! - 32) * n[v * 3]! + (p[v * 3 + 2]! - 32) * n[v * 3 + 2]!).toBeGreaterThan(0);
    }
  });
});
