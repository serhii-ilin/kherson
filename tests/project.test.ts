import { describe, it, expect } from "vitest";
import { BBOX } from "../tools/bake/config.ts";
import { toWorld, toLatLon, WORLD_W, WORLD_H } from "../tools/bake/project.ts";

describe("projection", () => {
  it("NW corner is origin", () => {
    expect(toWorld(BBOX.north, BBOX.west)).toEqual([0, 0]);
  });

  it("round trips within 0.5 m", () => {
    const points: [number, number][] = [
      [BBOX.north, BBOX.west],
      [BBOX.south, BBOX.east],
      [46.65, 32.6],
      [46.6, 32.55],
      [46.7, 32.65],
      [46.59, 32.49],
    ];
    for (const [lat, lon] of points) {
      const [x, z] = toWorld(lat, lon);
      const [lat2, lon2] = toLatLon(x, z);
      const [x2, z2] = toWorld(lat2, lon2);
      expect(Math.hypot(x2 - x, z2 - z)).toBeLessThan(0.5);
    }
  });

  it("world size is plausible", () => {
    expect(WORLD_W).toBeGreaterThan(17000);
    expect(WORLD_W).toBeLessThan(19500);
    expect(WORLD_H).toBeGreaterThan(15000);
    expect(WORLD_H).toBeLessThan(16000);
  });
});
