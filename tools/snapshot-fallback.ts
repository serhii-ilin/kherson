// Download the frozen pre-war snapshot from the GitHub release when the local file
// is missing or Overpass cannot be reached. The release is created by hand
// (tools/publish-snapshot.ts); this module only reads it.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  RELEASE_JSON, RELEASE_SHA, USER_AGENT, parseChecksums, releaseAssetUrl,
} from "./osm-snapshot.ts";

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  const rs = fs.createReadStream(file);
  for await (const chunk of rs) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export function downloadToFile(url: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.partial`;
  const r = spawnSync(
    "curl",
    ["-L", "--fail", "--retry", "4", "--retry-delay", "5", "-A", USER_AGENT, "-o", tmp, url],
    { stdio: "inherit" },
  );
  if (r.status !== 0) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`download failed (${r.status ?? "no status"}): ${url}`);
  }
  fs.renameSync(tmp, dest);
}

/** Download kherson.json.gz from the frozen release and check it against that release's SHA256SUMS. */
export async function downloadReleaseSnapshot(dest: string): Promise<void> {
  const sumsPath = `${dest}.sha256sums`;
  downloadToFile(releaseAssetUrl(RELEASE_SHA), sumsPath);
  const sums = parseChecksums(fs.readFileSync(sumsPath, "utf8"));
  const expected = sums.get(RELEASE_JSON);
  if (!expected) throw new Error(`${RELEASE_SHA} has no entry for ${RELEASE_JSON}`);
  downloadToFile(releaseAssetUrl(RELEASE_JSON), dest);
  const got = await sha256File(dest);
  if (got !== expected) {
    fs.rmSync(dest, { force: true });
    throw new Error(`checksum mismatch for ${RELEASE_JSON}: ${got} != ${expected}`);
  }
  console.log(`downloaded ${dest} from ${releaseAssetUrl(RELEASE_JSON)} (sha256 ${got})`);
}

/** No-op when the snapshot is already on disk (the deploy path). */
export async function ensureSnapshot(dest: string): Promise<void> {
  if (fs.existsSync(dest)) return;
  console.log(`missing ${dest}; trying the frozen release ${releaseAssetUrl(RELEASE_JSON)}`);
  await downloadReleaseSnapshot(dest);
}
