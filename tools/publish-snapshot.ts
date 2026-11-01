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
  GEOFABRIK_UKRAINE_220101_DATE, GEOFABRIK_UKRAINE_220101_URL, RELEASE_JSON, RELEASE_PBF, RELEASE_SHA,
  RELEASE_TAG, formatChecksums, ghReleaseCommand,
} from "./osm-snapshot.ts";

const DIR = "data/osm/release";
const JSON_SRC = "data/osm/kherson.json.gz";
const PBF_SRC = "data/osm/kherson-bbox.osm.pbf";

function notes(): string {
  return [
    "Frozen pre-war OpenStreetMap extract for Voxel Kherson.",
    "",
    `- Snapshot date: ${GEOFABRIK_UKRAINE_220101_DATE} (Geofabrik ukraine-220101.osm.pbf, file written 2022-01-02).`,
    "- The 24 February 2022 invasion is not in this extract.",
    `- Source: ${GEOFABRIK_UKRAINE_220101_URL}`,
    "- kherson.json.gz is the filtered Overpass-shaped snapshot the bake reads.",
    "- kherson-bbox.osm.pbf is the osmium bbox clip (project bbox plus a 0.015 degree margin) before tag filtering.",
    "- Map data © OpenStreetMap contributors, ODbL.",
    "",
    "This release was prepared by tools/publish-snapshot.ts. It is a manual owner step and is not part of the GitHub Pages deploy.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  if (!fs.existsSync(JSON_SRC)) throw new Error(`missing ${JSON_SRC}; run npm run fetch-osm first`);
  if (!fs.existsSync(PBF_SRC)) {
    throw new Error(`missing ${PBF_SRC}; run npm run fetch-osm -- --geofabrik (or --pbf) so the bbox clip exists`);
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.copyFileSync(JSON_SRC, path.join(DIR, RELEASE_JSON));
  fs.copyFileSync(PBF_SRC, path.join(DIR, RELEASE_PBF));
  const entries = [];
  for (const name of [RELEASE_JSON, RELEASE_PBF]) {
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
