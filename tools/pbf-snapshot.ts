// Build the Overpass-shaped snapshot from a local .osm.pbf using osmium.
// The national file is clipped to the project bbox plus EXTRACT_MARGIN_DEG, then
// filtered to the same tags as the Overpass query. Bridge ways selected by
// selectAntonivskyiCorridor are kept even when they sit just outside the bbox.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { VOXEL } from "../src/world/constants.ts";
import { BBOX } from "./bake/config.ts";
import { selectAntonivskyiCorridor, type CorridorWay } from "./bake/bridge-corridor.ts";
import { toWorld } from "./bake/project.ts";
import {
  expandBBox, parseOplLine, selectSnapshot, snapshotDocument, type OsmEl, type SnapshotMeta,
} from "./osm-snapshot.ts";

export function assertOsmium(): void {
  const r = spawnSync("osmium", ["--version"], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error("osmium is not installed (package osmium-tool). It is required for the offline PBF snapshot.");
  }
}

/** Clip `source` to the project bbox plus margin. `dest` is the bbox extract kept for the release asset. */
export function extractBboxPbf(source: string, dest: string): void {
  assertOsmium();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const box = expandBBox(BBOX);
  const b = `${box.west},${box.south},${box.east},${box.north}`;
  const r = spawnSync("osmium", ["extract", "-b", b, "--strategy", "smart", "--overwrite", "-o", dest, source], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`osmium extract failed (${r.status ?? "no status"})`);
}

export async function readOpl(pbf: string): Promise<OsmEl[]> {
  assertOsmium();
  const child = spawn("osmium", ["cat", "-f", "opl", pbf], { stdio: ["ignore", "pipe", "inherit"] });
  const closed = new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
  const rl = readline.createInterface({ input: child.stdout! });
  const elements: OsmEl[] = [];
  for await (const line of rl) {
    const el = parseOplLine(line);
    if (el) elements.push(el);
    if (elements.length % 500_000 === 0) console.log(`  opl elements ${elements.length}`);
  }
  const code = await closed;
  if (code !== 0) throw new Error(`osmium cat failed (${code})`);
  return elements;
}

/** Way ids of the Antonivskyi corridor, projected with the bake's world transform. */
export function bridgeWayIds(elements: readonly OsmEl[]): Set<number> {
  const nodes = new Map<number, { lat: number; lon: number }>();
  for (const e of elements) if (e.type === "node" && e.lat !== undefined && e.lon !== undefined) nodes.set(e.id, { lat: e.lat, lon: e.lon });
  const ways: CorridorWay[] = [];
  const rels = [];
  for (const e of elements) {
    if (e.type === "way" && e.nodes && e.nodes.length >= 2) {
      const pts: [number, number][] = [];
      const nodeIds: number[] = [];
      for (const id of e.nodes) {
        const n = nodes.get(id);
        if (!n) continue;
        const [x, z] = toWorld(n.lat, n.lon);
        pts.push([x / VOXEL, z / VOXEL]);
        nodeIds.push(id);
      }
      if (pts.length >= 2) ways.push({ id: e.id, tags: e.tags ?? {}, nodeIds, pts });
    } else if (e.type === "relation") {
      rels.push({ id: e.id, tags: e.tags ?? {}, members: e.members ?? [] });
    }
  }
  const sel = selectAntonivskyiCorridor(ways, rels);
  console.log(
    `Antonivskyi ways in the extract: bridge ${sel.bridgeWayIds.join(",") || "(none)"} ` +
      `approaches ${sel.approachWayIds.join(",") || "(none)"} length ${sel.lengthM.toFixed(0)} m`,
  );
  return new Set([...sel.bridgeWayIds, ...sel.approachWayIds]);
}

export function elementsToJson(elements: readonly OsmEl[], meta: SnapshotMeta): string {
  const extra = bridgeWayIds(elements);
  const selected = selectSnapshot(elements, BBOX, extra);
  const nodes = selected.filter((e) => e.type === "node").length;
  const ways = selected.filter((e) => e.type === "way").length;
  const rels = selected.filter((e) => e.type === "relation").length;
  console.log(`snapshot elements nodes=${nodes} ways=${ways} relations=${rels} (from ${elements.length})`);
  return snapshotDocument(selected, meta).json;
}

export async function pbfToSnapshotJson(sourcePbf: string, clipPbf: string, meta: SnapshotMeta): Promise<string> {
  console.log(`osmium extract ${sourcePbf} -> ${clipPbf}`);
  extractBboxPbf(sourcePbf, clipPbf);
  console.log(`reading ${clipPbf}`);
  const elements = await readOpl(clipPbf);
  return elementsToJson(elements, meta);
}
