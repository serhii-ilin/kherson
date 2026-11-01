import { describe, expect, it } from 'vitest';
import {
  FREGAT_HEIGHT_M, FREGAT_PALETTE, FREGAT_SAIL_TOP_M, FREGAT_WAY_ID, buildFregatMesh,
} from '../src/landmarks/fregat-model.ts';
import { HERO_WAY_IDS } from '../src/mesh/heroes.ts';

/** Footprint from v_21_19.bin, world metres. Kept here so the test does not need the bake. */
const RING: readonly (readonly [number, number])[] = [
  [10801.63, 9935.92], [10815.05, 9969.71], [10810.8, 9971.37], [10811.9, 9974.15],
  [10793.7, 9981.28], [10807.01, 10014.84], [10851.3, 9997.48], [10849.71, 9993.45],
  [10856.81, 9990.66], [10851.87, 9978.2], [10859.89, 9975.06], [10858.65, 9971.92],
  [10844.71, 9977.38], [10841.39, 9969.03], [10847.73, 9966.54], [10845.58, 9961.14],
  [10834.88, 9965.34], [10820.35, 9928.75], [10814.96, 9930.86], [10814.12, 9928.7],
  [10806.96, 9931.5], [10807.75, 9933.52],
];

describe('Hotel Fregat mesh', () => {
  const mesh = buildFregatMesh(RING);

  it('replaces the generic extrusion for this way', () => {
    expect(HERO_WAY_IDS.has(FREGAT_WAY_ID)).toBe(true);
  });

  it('stands on the footprint centroid and clears the sail above the slab', () => {
    expect(mesh.anchorX).toBeGreaterThan(10800);
    expect(mesh.anchorX).toBeLessThan(10860);
    expect(mesh.anchorZ).toBeGreaterThan(9930);
    expect(mesh.anchorZ).toBeLessThan(10010);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < mesh.positions.length; i += 3) {
      minY = Math.min(minY, mesh.positions[i]!);
      maxY = Math.max(maxY, mesh.positions[i]!);
    }
    expect(minY).toBeGreaterThanOrEqual(-0.01);
    expect(maxY).toBeGreaterThanOrEqual(FREGAT_SAIL_TOP_M - 1);
    expect(maxY).toBeGreaterThan(FREGAT_HEIGHT_M + 5);
  });

  it('carries yellow balcony bands and stays inside a hero budget', () => {
    const tris = mesh.indices.length / 3;
    expect(tris).toBeGreaterThan(400);
    expect(tris).toBeLessThan(20000);
    let yellow = 0;
    const [r, g, b] = FREGAT_PALETTE.balcony;
    for (let i = 0; i < mesh.colors.length; i += 3) {
      if (Math.abs(mesh.colors[i]! - r) < 0.02 && Math.abs(mesh.colors[i + 1]! - g) < 0.02 && Math.abs(mesh.colors[i + 2]! - b) < 0.02) yellow++;
    }
    expect(yellow).toBeGreaterThan(50);
    const maxIndex = Math.max(...mesh.indices);
    expect(maxIndex).toBeLessThan(mesh.positions.length / 3);
  });
});
