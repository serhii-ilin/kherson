import { describe, it, expect } from "vitest";
import { bufferLine, fillPolygon, type Pt } from "../tools/bake/rasterize.ts";
import { BBOX } from "../tools/bake/config.ts";
import { toLatLon, toWorld } from "../tools/bake/project.ts";

function collect(run: (set: (x: number, z: number) => void) => void): Set<string> {
  const s = new Set<string>();
  run((x, z) => s.add(`${x},${z}`));
  return s;
}

describe("fillPolygon", () => {
  it("fills a square exactly", () => {
    const sq: Pt[] = [[2, 3], [12, 3], [12, 13], [2, 13]];
    const cells = collect((set) => fillPolygon([sq], set));
    expect(cells.size).toBe(100);
    expect(cells.has("2,3")).toBe(true);
    expect(cells.has("11,12")).toBe(true);
    expect(cells.has("12,12")).toBe(false);
  });

  it("respects holes", () => {
    const outer: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const hole: Pt[] = [[3, 3], [7, 3], [7, 7], [3, 7]];
    const cells = collect((set) => fillPolygon([outer, hole], set));
    expect(cells.size).toBe(100 - 16);
    expect(cells.has("5,5")).toBe(false);
    expect(cells.has("1,1")).toBe(true);
  });

  it("fills a triangle approximately by area", () => {
    const tri: Pt[] = [[0, 0], [40, 0], [0, 40]];
    const n = collect((set) => fillPolygon([tri], set)).size;
    expect(Math.abs(n - 800)).toBeLessThan(40);
  });
});

describe("bufferLine", () => {
  it("covers endpoints and has about the right width on a diagonal", () => {
    const a: Pt = [5.5, 5.5];
    const b: Pt = [45.5, 45.5];
    const hw = 2;
    const cells = collect((set) => bufferLine([a, b], hw, set));
    expect(cells.has("5,5")).toBe(true);
    expect(cells.has("45,45")).toBe(true);
    const len = Math.hypot(40, 40);
    const area = 2 * hw * len + Math.PI * hw * hw;
    expect(Math.abs(cells.size - area) / area).toBeLessThan(0.15);
    expect(cells.has("5,45")).toBe(false);
  });

  it("handles a single point", () => {
    const cells = collect((set) => bufferLine([[10.5, 10.5]], 1, set));
    expect(cells.has("10,10")).toBe(true);
  });
});

describe("projection", () => {
  it("round-trips within 0.5 m", () => {
    const [x, z] = toWorld(46.65, 32.6);
    const [lat, lon] = toLatLon(x, z);
    const [x2, z2] = toWorld(lat, lon);
    expect(Math.hypot(x - x2, z - z2)).toBeLessThan(0.5);
    expect(lat).toBeGreaterThan(BBOX.south);
  });
});
