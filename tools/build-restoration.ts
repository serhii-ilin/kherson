// Rebuild data/osm/restoration.json from the committed base snapshot and the
// Geofabrik 2022 reference. Does not modify the base snapshot.
//
//   npm run build-restoration
//
// Versions are filled from the reference .osm.pbf when osmium is installed.
import fs from "node:fs";
import zlib from "node:zlib";
import { buildRestoration, countRuinBuildings, type RestoreFile } from "./bake/restoration.ts";
import { readOpl } from "./pbf-snapshot.ts";
import { REFERENCE_JSON, REFERENCE_PBF, type OsmEl } from "./osm-snapshot.ts";

const BASE = "data/osm/kherson.json.gz";
const OUT = "data/osm/restoration.json";

function loadGz(file: string): OsmEl[] {
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as { elements: OsmEl[] };
  return data.elements;
}

async function versionsFromPbf(file: string): Promise<Map<string, number>> {
  const versions = new Map<string, number>();
  if (!fs.existsSync(file)) return versions;
  try {
    const elements = await readOpl(file);
    for (const e of elements) if (e.version !== undefined) versions.set(`${e.type}/${e.id}`, e.version);
    console.log(`versions from ${file}: ${versions.size}`);
  } catch (e) {
    console.error(`no versions from ${file}: ${(e as Error).message}`);
  }
  return versions;
}

function summarise(base: OsmEl[], file: RestoreFile): void {
  const byReason = new Map<string, number>();
  for (const row of file.rows) byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + 1);
  console.log(`rows ${file.rows.length}, additions ${file.additions.length}`);
  console.log([...byReason.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(" "));
  console.log(`building=ruins/destroyed/damaged on the base: ${countRuinBuildings(base)}`);
}

async function main(): Promise<void> {
  if (!fs.existsSync(BASE)) throw new Error(`missing ${BASE}`);
  if (!fs.existsSync(REFERENCE_JSON)) throw new Error(`missing ${REFERENCE_JSON}; run npm run fetch-osm -- --geofabrik`);
  const base = loadGz(BASE);
  const ref = loadGz(REFERENCE_JSON);
  const versions = await versionsFromPbf(REFERENCE_PBF);
  const file = buildRestoration(base, ref, versions);
  fs.writeFileSync(OUT, JSON.stringify(file, null, 2) + "\n");
  console.log(`wrote ${OUT} (${fs.statSync(OUT).size} bytes)`);
  summarise(base, file);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
