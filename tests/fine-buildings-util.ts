import { MAT } from '../src/world/materials';
import { ROOF, type VBuilding } from '../src/world/vector-format';
import { addBuildings, type BuildingContext, type PlacedBuilding } from '../src/fine/buildings';
import { BLOCK_PAD, BLOCK_WIN, BlockWindow, columnTops, meshBlocks } from '../src/fine/blocks';
import { VOL_Y, Volume } from '../src/fine/volume';

export const flatCtx: BuildingContext = { groundAt: () => 4 };

/** A building from a ring in world metres (tile origin 0, 0). */
export function bld(
  ring: ReadonlyArray<readonly [number, number]>,
  o: Partial<Pick<VBuilding, 'id' | 'heightCm' | 'minHeightCm' | 'levels' | 'wall' | 'roof' | 'roofShape'>> = {},
): PlacedBuilding {
  const r = new Int32Array(ring.length * 2);
  ring.forEach(([x, z], i) => { r[i * 2] = Math.round(x * 100); r[i * 2 + 1] = Math.round(z * 100); });
  const b: VBuilding = {
    id: o.id ?? 1001, rings: [r], heightCm: o.heightCm ?? 1600, minHeightCm: o.minHeightCm ?? 0, levels: o.levels ?? 5,
    wall: o.wall ?? MAT.WALL_KHRUSH, roof: o.roof ?? MAT.ROOF_GREY, roofShape: o.roofShape ?? ROOF.FLAT, name: -1,
  };
  return { b, ox: 0, oz: 0 };
}

export function rect(x0: number, z0: number, x1: number, z1: number): Array<[number, number]> {
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

export function volume(x0: number, z0: number, placed: PlacedBuilding[], ctx: BuildingContext = flatCtx): Volume {
  const v = new Volume(x0, z0);
  addBuildings(v, placed, ctx);
  return v;
}

export function window(chunkX0: number, chunkZ0: number, placed: PlacedBuilding[], ctx: BuildingContext = flatCtx): BlockWindow {
  const w = new BlockWindow(chunkX0, chunkZ0);
  addBuildings(w, placed, ctx, w.foot);
  return w;
}

export function groundFlat(h = 4): Uint8Array {
  return new Uint8Array(BLOCK_WIN * BLOCK_WIN).fill(h);
}

export function meshOf(w: BlockWindow, groundY?: Uint8Array) {
  return meshBlocks(w.mats, BLOCK_WIN, BLOCK_PAD, groundY);
}

export function topsOf(w: BlockWindow, h = 4): Uint8Array {
  return columnTops(w.mats, BLOCK_WIN, BLOCK_PAD, w.foot, groundFlat(h));
}

export { VOL_Y };
