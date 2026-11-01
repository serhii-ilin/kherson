/**
 * Headless geometry report for the city-centre mesh prototype.
 * Reads the baked vector tiles (no WebGL) and extrudes every building whose centroid
 * lies in the neighbourhood. Run after `npm run bake`:
 *   node --experimental-strip-types tools/mesh-report.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { MESH_NEIGHBOURHOOD } from '../src/mesh/bounds.ts';
import { buildingsInChunk, buildChunkMesh } from '../src/mesh/chunk.ts';
import { meshByteSize, triangleCount } from '../src/mesh/extrude.ts';
import { CHUNK_M } from '../src/world/stream-math.ts';
import { decodeVectorTile, type VectorTile } from '../src/world/vector-format.ts';

const dir = 'public/world';
const box = MESH_NEIGHBOURHOOD;
const gx0 = Math.floor(box.x0 / CHUNK_M);
const gx1 = Math.floor((box.x1 - 1) / CHUNK_M);
const gz0 = Math.floor(box.z0 / CHUNK_M);
const gz1 = Math.floor((box.z1 - 1) / CHUNK_M);

const tiles = new Map<string, VectorTile>();
let tileBytes = 0;
let tileFiles = 0;
for (const name of readdirSync(dir)) {
  const m = /^v_(\d+)_(\d+)\.bin$/.exec(name);
  if (!m) continue;
  const rx = Number(m[1]);
  const rz = Number(m[2]);
  const regionTouches =
    rx * 512 < box.x1 + 512 && (rx + 1) * 512 > box.x0 - 512 &&
    rz * 512 < box.z1 + 512 && (rz + 1) * 512 > box.z0 - 512;
  if (!regionTouches) continue;
  const buf = readFileSync(`${dir}/${name}`);
  tileBytes += buf.byteLength;
  tileFiles++;
  tiles.set(`${rx},${rz}`, decodeVectorTile(buf));
}

function neighbourhood(gcx: number, gcz: number): VectorTile[] {
  const rx = Math.floor(gcx / 8);
  const rz = Math.floor(gcz / 8);
  const neigh: VectorTile[] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = tiles.get(`${rx + dx},${rz + dz}`);
      if (t !== undefined) neigh.push(t);
    }
  }
  return neigh;
}

let tris = 0;
let bytes = 0;
let chunks = 0;
const seen = new Set<number>();
const ground = (): number => 4;
for (let gcz = gz0; gcz <= gz1; gcz++) {
  for (let gcx = gx0; gcx <= gx1; gcx++) {
    const neigh = neighbourhood(gcx, gcz);
    for (const b of buildingsInChunk(neigh, gcx, gcz, ground)) seen.add(b.id);
    const mesh = buildChunkMesh(neigh, gcx, gcz, ground);
    const n = triangleCount(mesh);
    if (n === 0) continue;
    chunks++;
    tris += n;
    bytes += meshByteSize(mesh);
  }
}

const worldBytes = readdirSync(dir).reduce((s, n) => s + statSync(`${dir}/${n}`).size, 0);
console.log(JSON.stringify({
  neighbourhood: box,
  chunksWithMesh: chunks,
  chunksInBox: (gx1 - gx0 + 1) * (gz1 - gz0 + 1),
  buildings: seen.size,
  triangles: tris,
  gpuBytes: bytes,
  gpuMB: Number((bytes / 1e6).toFixed(3)),
  vectorTileFiles: tileFiles,
  vectorTileBytes: tileBytes,
  vectorTileMB: Number((tileBytes / 1e6).toFixed(3)),
  bakedWorldBytes: worldBytes,
  bakedWorldMB: Number((worldBytes / 1e6).toFixed(3)),
}, null, 2));
