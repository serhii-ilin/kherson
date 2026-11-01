import { describe, expect, it } from "vitest";
import { BBOX } from "../tools/bake/config.ts";
import {
  DEFAULT_SNAPSHOT_DATE, GEOFABRIK_UKRAINE_220101_DATE, RELEASE_JSON, RELEASE_PBF, RELEASE_SHA,
  buildQuery, expandBBox, formatChecksums, ghReleaseCommand, matchesOverpassFilter, parseChecksums,
  parseFetchArgs, parseOplLine, pbfSnapshotMeta, pointInBBox, releaseAssetUrl, selectSnapshot,
  tileCacheDir, type OsmEl,
} from "../tools/osm-snapshot.ts";

describe("fetch-osm options", () => {
  it("defaults to a live fetch, and --date still builds an attic query", () => {
    const args = parseFetchArgs(["node", "tools/fetch-osm.ts"]);
    expect(args.date).toBeNull();
    expect(args.live).toBe(true);
    expect(args.outExplicit).toBe(false);
    const dated = parseFetchArgs(["node", "x", "--date", DEFAULT_SNAPSHOT_DATE]);
    const q = buildQuery("46.6,32.5,46.7,32.6", dated.date);
    expect(q.startsWith('[out:json][timeout:300][maxsize:536870912][date:"2022-02-01T00:00:00Z"];')).toBe(true);
    expect(q).toContain('nwr(46.6,32.5,46.7,32.6)["building"]');
    expect(q).toContain('["bridge"="yes"]');
    expect(q).toContain("out skel qt;");
  });

  it("omits the attic setting for a live fetch and rejects a bad date", () => {
    const live = parseFetchArgs(["node", "x", "--live"]);
    expect(live.date).toBeNull();
    expect(buildQuery("1,2,3,4", null)).not.toContain("[date:");
    expect(() => parseFetchArgs(["node", "x", "--date", "2022-02-01"])).toThrow(/YYYY-MM-DD/);
    expect(() => parseFetchArgs(["node", "x", "--live", "--date", "2022-02-01T00:00:00Z"])).toThrow(/cannot be combined/);
  });

  it("accepts an offline pbf, the Geofabrik shortcut, and the release fallback", () => {
    expect(parseFetchArgs(["node", "x", "--pbf", "data/osm/upstream/ukraine-220101.osm.pbf"]).pbf).toContain("220101");
    expect(parseFetchArgs(["node", "x", "--geofabrik"]).geofabrik).toBe(true);
    expect(parseFetchArgs(["node", "x", "--from-release"]).fromRelease).toBe(true);
    expect(() => parseFetchArgs(["node", "x", "--from-release", "--geofabrik"])).toThrow(/from-release/);
    expect(tileCacheDir(DEFAULT_SNAPSHOT_DATE)).toBe("data/osm/tiles/2022-02-01T00-00-00Z");
    expect(tileCacheDir(null)).toBe("data/osm/tiles/live");
  });

  it("labels the Geofabrik file as 2022-01-01 unless a date was passed explicitly", () => {
    const geo = parseFetchArgs(["node", "x", "--geofabrik"]);
    expect(pbfSnapshotMeta(geo, "data/osm/upstream/ukraine-220101.osm.pbf").snapshot_date).toBe(GEOFABRIK_UKRAINE_220101_DATE);
    const dated = parseFetchArgs(["node", "x", "--pbf", "local.osm.pbf", "--date", "2022-02-01T00:00:00Z"]);
    expect(pbfSnapshotMeta(dated, "local.osm.pbf").snapshot_date).toBe("2022-02-01T00:00:00Z");
    const bare = parseFetchArgs(["node", "x", "--pbf", "local.osm.pbf"]);
    expect(pbfSnapshotMeta(bare, "local.osm.pbf").snapshot_date).toBe("unspecified");
  });

  it("points the release fallback at the frozen asset and round-trips checksums", () => {
    expect(releaseAssetUrl(RELEASE_JSON)).toBe(
      "https://github.com/serhii-ilin/kherson/releases/download/osm-base/kherson.json.gz",
    );
    const text = formatChecksums([
      { name: RELEASE_JSON, sha256: "a".repeat(64) },
      { name: RELEASE_PBF, sha256: "b".repeat(64) },
    ]);
    const parsed = parseChecksums(text);
    expect(parsed.get(RELEASE_JSON)).toBe("a".repeat(64));
    expect(parsed.get(RELEASE_PBF)).toBe("b".repeat(64));
    expect(parseChecksums(`# comment\n${"c".repeat(64)}  ${RELEASE_SHA}\n`).get(RELEASE_SHA)).toBe("c".repeat(64));
    const cmd = ghReleaseCommand("data/osm/release");
    expect(cmd).toContain("gh release create osm-base");
    expect(cmd).toContain("data/osm/release/kherson.json.gz");
    expect(cmd).toContain("data/osm/release/SHA256SUMS");
    expect(cmd).not.toContain("curl");
  });
});

describe("pbf snapshot filter", () => {
  it("parses an OPL node, way and relation and skips deleted objects", () => {
    const node = parseOplLine("n10 v1 dV c1 t2022-01-01T00:00:00Z i1 uuser Tamenity=cafe,name=Антонівський%20%міст x32.60 y46.64");
    expect(node).toMatchObject({ type: "node", id: 10, lon: 32.6, lat: 46.64, tags: { amenity: "cafe", name: "Антонівський міст" } });
    const way = parseOplLine("w11 v1 dV c1 t2022-01-01T00:00:00Z i1 uuser Nn10,n12 Thighway=trunk,bridge=yes");
    expect(way).toMatchObject({ type: "way", id: 11, nodes: [10, 12], tags: { highway: "trunk", bridge: "yes" } });
    const rel = parseOplLine("r2175078 v1 dV c1 t2022-01-01T00:00:00Z i1 uuser Mw11@outer,w12@inner,n10@ Ttype=multipolygon,place=city");
    expect(rel?.type).toBe("relation");
    expect(rel?.members).toEqual([
      { type: "way", ref: 11, role: "outer" },
      { type: "way", ref: 12, role: "inner" },
      { type: "node", ref: 10, role: "" },
    ]);
    expect(parseOplLine("n9 v2 dD c1 t2022-01-01T00:00:00Z i1 uuser x32 y46")).toBeNull();
  });

  it("keeps the same tags as the Overpass query, including named amenities only", () => {
    expect(matchesOverpassFilter({ building: "yes" })).toBe(true);
    expect(matchesOverpassFilter({ building: "ruins" })).toBe(true);
    expect(matchesOverpassFilter({ railway: "tram" })).toBe(true);
    expect(matchesOverpassFilter({ railway: "abandoned" })).toBe(false);
    expect(matchesOverpassFilter({ amenity: "cafe" })).toBe(false);
    expect(matchesOverpassFilter({ amenity: "cafe", name: "A" })).toBe(true);
    expect(matchesOverpassFilter({ barrier: "fence" })).toBe(false);
    expect(matchesOverpassFilter({ barrier: "hedge" })).toBe(true);
    expect(matchesOverpassFilter({ man_made: "bridge" })).toBe(true);
    expect(matchesOverpassFilter({ natural: "tree_row" })).toBe(true);
    expect(matchesOverpassFilter(undefined)).toBe(false);
  });

  it("keeps a city relation's untagged member ways and drops features outside the bbox", () => {
    const elements: OsmEl[] = [
      { type: "node", id: 1, lat: 46.64, lon: 32.6 },
      { type: "node", id: 2, lat: 46.65, lon: 32.61 },
      { type: "node", id: 3, lat: 46.9, lon: 33.2 },
      { type: "node", id: 4, lat: 46.91, lon: 33.21 },
      { type: "way", id: 10, nodes: [1, 2], tags: { building: "yes" } },
      { type: "way", id: 11, nodes: [1, 2] },
      { type: "way", id: 12, nodes: [3, 4], tags: { building: "yes" } },
      { type: "relation", id: 2175078, tags: { place: "city", type: "multipolygon" }, members: [{ type: "way", ref: 11, role: "outer" }] },
    ];
    const selected = selectSnapshot(elements, BBOX);
    const ids = selected.map((e) => `${e.type}/${e.id}`);
    expect(ids).toContain("way/10");
    expect(ids).toContain("way/11");
    expect(ids).toContain("relation/2175078");
    expect(ids).not.toContain("way/12");
    expect(ids).not.toContain("node/3");
    expect(pointInBBox(46.64, 32.6, BBOX)).toBe(true);
    expect(expandBBox(BBOX).east).toBeGreaterThan(BBOX.east);
  });

  it("keeps an extra bridge way that lies outside the project bbox", () => {
    const elements: OsmEl[] = [
      { type: "node", id: 1, lat: 46.67, lon: 32.73 },
      { type: "node", id: 2, lat: 46.68, lon: 32.74 },
      { type: "way", id: 99, nodes: [1, 2], tags: { highway: "trunk", bridge: "yes", name: "Антонівський міст" } },
    ];
    const selected = selectSnapshot(elements, BBOX, new Set([99]));
    expect(selected.map((e) => e.id).sort()).toEqual([1, 2, 99]);
  });
});
