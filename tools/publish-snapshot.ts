// Prepare the frozen pre-war snapshot as a GitHub Release, without creating the release.
//
//   npm run publish-snapshot
//
// Writes data/osm/release/ (gitignored): kherson.json.gz, kherson-bbox.osm.pbf,
// SHA256SUMS, NOTES.md, and prints the `gh release create` command. Uploading is a
// separate owner step; see docs/DEPLOYMENT.md. The Pages deploy does not run this.
import fs from "node:fs";
import path from "node:path";
import { sha256File } from "./snapshot-fallback.ts";
import {
  GEOFABRIK_UKRAINE_220101_DATE, GEOFABRIK_UKRAINE_220101_URL, REFERENCE_PBF, RELEASE_JSON, RELEASE_PBF,
  RELEASE_RESTORATION, RELEASE_SHA, RELEASE_TAG, formatChecksums, ghReleaseCommand,
} from "./osm-snapshot.ts";

const DIR = "data/osm/release";
const JSON_SRC = "data/osm/kherson.json.gz";
const PBF_SRC = REFERENCE_PBF;
const TABLE_SRC = "data/osm/restoration.json";

function notes(): string {
  return [
    "Frozen base OpenStreetMap snapshot for Voxel Kherson, plus the pre-war restoration table.",
    "",
    "- kherson.json.gz is the current (full) OSM snapshot the bake starts from.",
    "- restoration.json undoes war damage on that snapshot: ruin tags, the Antonivskyi bridge, pre-war street names, deleted buildings, and war-related additions.",
    `- ${RELEASE_PBF} is the Geofabrik ukraine-220101 bbox clip (${GEOFABRIK_UKRAINE_220101_DATE}, ${GEOFABRIK_UKRAINE_220101_URL}) used to rebuild the table. It is not a substitute for the base snapshot.`,
    "- Map data © OpenStreetMap contributors, ODbL.",
    "",
    "Prepared by tools/publish-snapshot.ts. A manual owner step, not part of the GitHub Pages deploy.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  if (!fs.existsSync(JSON_SRC)) throw new Error(`missing ${JSON_SRC}; run npm run fetch-osm first`);
  if (!fs.existsSync(PBF_SRC)) {
    throw new Error(`missing ${PBF_SRC}; run npm run fetch-osm -- --geofabrik so the 2022 clip exists`);
  }
  if (!fs.existsSync(TABLE_SRC)) throw new Error(`missing ${TABLE_SRC}; run npm run build-restoration`);
  fs.mkdirSync(DIR, { recursive: true });
  fs.copyFileSync(JSON_SRC, path.join(DIR, RELEASE_JSON));
  fs.copyFileSync(PBF_SRC, path.join(DIR, RELEASE_PBF));
  fs.copyFileSync(TABLE_SRC, path.join(DIR, RELEASE_RESTORATION));
  const entries = [];
  for (const name of [RELEASE_JSON, RELEASE_PBF, RELEASE_RESTORATION]) {
    const sha256 = await sha256File(path.join(DIR, name));
    const size = fs.statSync(path.join(DIR, name)).size;
    entries.push({ name, sha256 });
    console.log(`${sha256}  ${name} (${size} bytes)`);
  }
  fs.writeFileSync(path.join(DIR, RELEASE_SHA), formatChecksums(entries));
  fs.writeFileSync(path.join(DIR, "NOTES.md"), notes());
  console.log("");
  console.log("Release files are in data/osm/release/. The release was NOT created.");
  console.log("When the owner wants it published, run:");
  console.log("");
  console.log(ghReleaseCommand(DIR));
  console.log("");
  console.log(`Tag: ${RELEASE_TAG}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
