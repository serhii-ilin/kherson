import { describe, expect, it } from "vitest";
import {
  applyOverrides, applyToElement, buildRestoration, isWarAddition, type RestoreFile,
} from "../tools/bake/restoration.ts";
import type { OsmEl } from "../tools/osm-snapshot.ts";

function way(id: number, tags: Record<string, string>, nodes: number[] = [1, 2, 3]): OsmEl {
  return { type: "way", id, tags, nodes };
}
function node(id: number, lat: number, lon: number): OsmEl {
  return { type: "node", id, lat, lon };
}

describe("pre-war restoration", () => {
  const preCourt = way(10, { building: "yes", name: "Суд" });
  const curCourt = way(10, { building: "ruins", name: "Суд", ruins: "yes" });
  const preRuin = way(11, { building: "ruins", name: "Млин" });
  const curRuin = way(11, { building: "ruins", name: "Млин" });
  const newRuin = way(12, { building: "ruins", name: "Руины многоэтажки" }, [4, 5]);
  const preStreet = way(20, { highway: "primary", name: "Ушакова проспект", "name:uk": "Ушакова проспект" }, [1, 2]);
  const curStreet = way(20, { highway: "primary", name: "проспект Незалежності", "name:uk": "проспект Незалежності", old_name: "старе" }, [1, 2]);
  const preBridge = way(30, { name: "Антонівський міст", bridge: "yes", highway: "trunk" }, [1, 2, 3, 4]);
  const curBridge = way(30, { name: "Антонівський міст", bridge: "yes", highway: "trunk", ruins: "yes", destroyed: "yes", access: "no" }, [1, 4]);
  const proposed = way(31, { name: "Антонівський міст", bridge: "yes", highway: "proposed", destroyed: "yes", ruins: "yes" }, [1, 4]);
  const gone = way(40, { building: "apartments" }, [8, 9]);
  const redraw = way(41, { building: "apartments" }, [1, 2, 3]);
  const base: OsmEl[] = [
    node(1, 46.6, 32.6), node(4, 46.61, 32.61), node(8, 46.62, 32.62), node(9, 46.63, 32.63),
    curCourt, curRuin, newRuin, curStreet, curBridge, proposed,
    way(50, { military: "checkpoint", name: "Блокпост" }, [1, 4]),
    { type: "node", id: 60, lat: 46.64, lon: 32.64, tags: { historic: "memorial", memorial: "war_memorial", name: "Битва у Бузковому парку" } },
    { type: "node", id: 61, lat: 46.64, lon: 32.65, tags: { historic: "memorial", memorial: "statue", name: "Тарасові Шевченку" } },
  ];
  const ref: OsmEl[] = [
    node(1, 46.6, 32.6), node(2, 46.6, 32.6), node(3, 46.6, 32.61), node(4, 46.61, 32.61),
    node(8, 46.62, 32.62), node(9, 46.63, 32.63),
    preCourt, preRuin, preStreet, preBridge, gone, redraw,
  ];

  const file = buildRestoration(base, ref, new Map([["way/30", 19]]));

  function rows(id: number, field?: string) {
    return file.rows.filter((r) => r.id === id && (field === undefined || r.field === field));
  }

  it("restores a ruined building to its pre-war building tag and leaves a pre-war ruin", () => {
    expect(rows(10, "building")).toMatchObject([{ value: "yes", reason: "war-tag", source: "geofabrik:ukraine-220101" }]);
    expect(rows(10, "ruins")).toMatchObject([{ value: null }]);
    expect(rows(11, "building")).toEqual([]);
  });

  it("keeps a later-mapped ruin footprint as a building instead of deleting it", () => {
    expect(rows(12, "building")).toMatchObject([{ value: "yes", reason: "undo-ruin-tag", source: "inferred:keep-footprint" }]);
  });

  it("puts the current street name in old_name and restores the pre-war name", () => {
    expect(rows(20, "name")[0]?.value).toBe("Ушакова проспект");
    expect(rows(20, "old_name")[0]?.value).toBe("старе;проспект Незалежності");
    expect(rows(20, "old_name")[0]?.reason).toBe("keep-current-name");
  });

  it("restores the bridge geometry and drops the post-war proposed carriageway", () => {
    expect(rows(30, "nodes")[0]).toMatchObject({ value: "1,2,3,4", reason: "bridge-geometry", version: 19 });
    expect(rows(30, "ruins")[0]?.value).toBeNull();
    expect(rows(30, "destroyed")[0]?.value).toBeNull();
    expect(rows(30, "access")[0]?.value).toBeNull();
    expect(rows(31, "@drop")).toMatchObject([{ reason: "drop-war-addition" }]);
    expect(file.additions.map((e) => e.id).sort()).toEqual([2, 3, 40]);
  });

  it("re-adds a deleted building and skips one that was redrawn on the same nodes", () => {
    expect(file.additions.some((e) => e.id === 40)).toBe(true);
    expect(file.additions.some((e) => e.id === 41)).toBe(false);
  });

  it("drops war additions and keeps an ordinary monument mapped later", () => {
    expect(isWarAddition({ military: "checkpoint" })).toBe(true);
    expect(isWarAddition({ historic: "memorial", memorial: "statue", name: "Тарасові Шевченку" })).toBe(false);
    expect(rows(50, "@drop")).toHaveLength(1);
    expect(rows(60, "@drop")).toHaveLength(1);
    expect(rows(61, "@drop")).toHaveLength(0);
  });

  it("applies rows, and an override replaces one field", () => {
    const restored = applyToElement(curCourt, rows(10));
    expect(restored?.tags?.building).toBe("yes");
    expect(restored?.tags?.ruins).toBeUndefined();
    const overridden = applyOverrides(file, {
      rows: [{ type: "way", id: 10, field: "building", value: "public", source: "manual", version: null, reason: "owner" }],
    });
    expect(overridden.rows.find((r) => r.id === 10 && r.field === "building")?.value).toBe("public");
    const skipped = applyOverrides(file, { skip: [{ type: "way", id: 10, field: "building" }] });
    expect(skipped.rows.some((r) => r.id === 10 && r.field === "building")).toBe(false);
  });

  it("is deterministic", () => {
    const again = buildRestoration(base, ref, new Map([["way/30", 19]]));
    expect(JSON.stringify(again)).toBe(JSON.stringify(file));
  });
});

describe("restoration file shape", () => {
  it("sorts rows by type, id and field", () => {
    const file: RestoreFile = buildRestoration(
      [way(2, { building: "ruins" }), way(1, { highway: "residential", name: "Б" })],
      [way(1, { highway: "residential", name: "А" })],
    );
    const keys = file.rows.map((r) => `${r.id}/${r.field}`);
    expect(keys).toEqual([...keys].sort());
  });
});
