import { describe, expect, it } from "vitest";
import { selectAntonivskyiCorridor, CORRIDOR_RADIUS_M, APPROACH_MAX_M, type CorridorWay } from "../tools/bake/bridge-corridor.ts";
import { CityMask, stampCorridor } from "../tools/bake/city-mask.ts";
import { VOXEL } from "../src/world/constants.ts";

function way(id: number, tags: Record<string, string>, pts: [number, number][], nodeIds: number[]): CorridorWay {
  return { id, tags, pts, nodeIds };
}

describe("Antonivskyi bridge corridor", () => {
  const bridge = way(1, { name: "Антонівський міст", bridge: "yes", highway: "trunk", ref: "М-14" }, [[0, 0], [0, 100]], [10, 11]);
  // 600 m straight on from the north end (100 cells * 2 m).
  const approach = way(2, { highway: "trunk", ref: "М-14" }, [[0, 100], [0, 400]], [11, 12]);
  const side = way(3, { highway: "residential", name: "Антонівська вулиця" }, [[0, 100], [80, 100]], [11, 13]);
  const other = way(4, { name: "Панкратівський міст", bridge: "yes", highway: "tertiary" }, [[50, 50], [80, 50]], [20, 21]);

  it("includes the named span and a clipped trunk approach, not the side street or another bridge", () => {
    const sel = selectAntonivskyiCorridor([bridge, approach, side, other]);
    expect(sel.bridgeWayIds).toEqual([1]);
    expect(sel.approachWayIds).toEqual([2]);
    expect(sel.approachWayIds).not.toContain(3);
    const approachLine = sel.polylines[1]!;
    const end = approachLine[approachLine.length - 1]!;
    expect(end[0]).toBeCloseTo(0, 5);
    // 450 m past z=100 is 225 cells.
    expect(end[1]).toBeCloseTo(100 + APPROACH_MAX_M / VOXEL, 5);
    expect(end[1]).toBeLessThan(400);
  });

  it("does not treat Антонівська вулиця, the settlement, or the railway bridge as the road bridge", () => {
    const town = way(7, { landuse: "residential", name: "АНТОНІВСЬКЕ МІСТЕЧКО" }, [[0, 0], [10, 0], [10, 10]], [1, 2, 3]);
    const rail = way(8, { name: "Антонівський міст", bridge: "yes", railway: "rail", wikidata: "Q4067523" }, [[0, 0], [0, 40]], [4, 5]);
    const sel = selectAntonivskyiCorridor([side, town, rail]);
    expect(sel.bridgeWayIds).toEqual([]);
    expect(sel.polylines).toEqual([]);
  });

  it("pulls in carriageways that share a node and outline ways of the bridge relation", () => {
    const second = way(5, { bridge: "yes", highway: "trunk", ref: "М-14" }, [[2, 0], [2, 100]], [30, 11]);
    const outline = way(6, {}, [[0, 0], [4, 0], [4, 100]], [40, 41, 42]);
    const sel = selectAntonivskyiCorridor(
      [bridge, second, outline],
      [{ id: 9, tags: { name: "Антонівський міст", man_made: "bridge", wikidata: "Q4067525" }, members: [{ type: "way", ref: 6, role: "outer" }] }],
    );
    expect(sel.bridgeWayIds).toEqual([1, 5, 6]);
  });

  it("stamps a narrow corridor and leaves distant cells alone", () => {
    const mask = new CityMask(80, 80);
    const added = stampCorridor(mask, [[[10, 10], [10, 40]]], 3);
    expect(added).toBeGreaterThan(0);
    expect(mask.hasCell(10, 20)).toBe(true);
    expect(mask.hasCell(12, 20)).toBe(true);
    expect(mask.hasCell(14, 20)).toBe(false);
    expect(mask.hasCell(10, 70)).toBe(false);
    expect(CORRIDOR_RADIUS_M).toBeLessThan(50);
  });
});
