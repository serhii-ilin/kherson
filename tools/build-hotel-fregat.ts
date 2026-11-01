/**
 * Writes public/landmarks/hotel-fregat.glb from the baked footprint.
 * Vertex and index buffers are Meshopt-compressed (EXT_meshopt_compression).
 * The encoder is a dev dependency; the browser decodes with three's MeshoptDecoder.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { decodeVectorTile } from '../src/world/vector-format.ts';
import { buildFregatMesh, FREGAT_WAY_ID } from '../src/landmarks/fregat-model.ts';

const REGION_M = 512;

function ringOf(path: string): [number, number][] {
  const tile = decodeVectorTile(readFileSync(path));
  const building = tile.buildings.find((b) => b.id === FREGAT_WAY_ID);
  if (!building) throw new Error(`way ${FREGAT_WAY_ID} is not in ${path}`);
  const ox = tile.rx * REGION_M;
  const oz = tile.rz * REGION_M;
  const ring = building.rings[0];
  if (!ring) throw new Error('empty ring');
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i += 2) out.push([ox + ring[i]! / 100, oz + ring[i + 1]! / 100]);
  return out;
}

function pad4(n: number): number {
  return (n + 3) & ~3;
}

async function main(): Promise<void> {
  await MeshoptEncoder.ready;
  const mesh = buildFregatMesh(ringOf('public/world/v_21_19.bin'));
  const parts: { bytes: Uint8Array; count: number; stride: number; mode: string; target: number }[] = [
    { bytes: new Uint8Array(mesh.positions.buffer), count: mesh.positions.length / 3, stride: 12, mode: 'ATTRIBUTES', target: 34962 },
    { bytes: new Uint8Array(mesh.normals.buffer), count: mesh.normals.length / 3, stride: 12, mode: 'ATTRIBUTES', target: 34962 },
    { bytes: new Uint8Array(mesh.colors.buffer), count: mesh.colors.length / 3, stride: 12, mode: 'ATTRIBUTES', target: 34962 },
    { bytes: new Uint8Array(mesh.indices.buffer), count: mesh.indices.length, stride: 4, mode: 'TRIANGLES', target: 34963 },
  ];
  const compressed = parts.map((p) => MeshoptEncoder.encodeGltfBuffer(p.bytes, p.count, p.stride, p.mode));
  const bin = new Uint8Array(compressed.reduce((n, c) => n + pad4(c.length), 0));
  const views: unknown[] = [];
  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    const src = compressed[i]!;
    bin.set(src, offset);
    const part = parts[i]!;
    views.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: src.length,
      byteStride: part.stride,
      target: part.target,
      extensions: {
        EXT_meshopt_compression: {
          buffer: 0,
          byteOffset: offset,
          byteLength: src.length,
          byteStride: part.stride,
          count: part.count,
          mode: part.mode,
          filter: 'NONE',
        },
      },
    });
    offset += pad4(src.length);
  }
  const json = {
    asset: {
      version: '2.0',
      generator: 'voxel-kherson hotel-fregat',
      extras: { osmWay: FREGAT_WAY_ID, anchorX: mesh.anchorX, anchorZ: mesh.anchorZ },
    },
    extensionsUsed: ['EXT_meshopt_compression'],
    extensionsRequired: ['EXT_meshopt_compression'],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: parts[0]!.count, type: 'VEC3', max: max3(mesh.positions), min: min3(mesh.positions) },
      { bufferView: 1, componentType: 5126, count: parts[1]!.count, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: parts[2]!.count, type: 'VEC3' },
      { bufferView: 3, componentType: 5125, count: parts[3]!.count, type: 'SCALAR' },
    ],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
        indices: 3,
        material: 0,
      }],
    }],
    materials: [{
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.82 },
      doubleSided: false,
    }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (jsonBytes.length + 3) & ~3;
  const jsonChunk = new Uint8Array(jsonPad);
  jsonChunk.set(jsonBytes);
  jsonChunk.fill(0x20, jsonBytes.length);
  const binPad = pad4(bin.length);
  const total = 12 + 8 + jsonPad + 8 + binPad;
  const glb = new Uint8Array(total);
  const dv = new DataView(glb.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonPad, true);
  dv.setUint32(16, 0x4e4f534a, true);
  glb.set(jsonChunk, 20);
  const binAt = 20 + jsonPad;
  dv.setUint32(binAt, binPad, true);
  dv.setUint32(binAt + 4, 0x004e4942, true);
  glb.set(bin, binAt + 8);
  mkdirSync('public/landmarks', { recursive: true });
  const out = 'public/landmarks/hotel-fregat.glb';
  writeFileSync(out, glb);
  console.log(`${out} ${glb.length} bytes, ${mesh.indices.length / 3} tris, anchor ${mesh.anchorX.toFixed(1)} ${mesh.anchorZ.toFixed(1)}`);
}

function min3(a: Float32Array): [number, number, number] {
  let x = Infinity, y = Infinity, z = Infinity;
  for (let i = 0; i < a.length; i += 3) {
    x = Math.min(x, a[i]!); y = Math.min(y, a[i + 1]!); z = Math.min(z, a[i + 2]!);
  }
  return [x, y, z];
}

function max3(a: Float32Array): [number, number, number] {
  let x = -Infinity, y = -Infinity, z = -Infinity;
  for (let i = 0; i < a.length; i += 3) {
    x = Math.max(x, a[i]!); y = Math.max(y, a[i + 1]!); z = Math.max(z, a[i + 2]!);
  }
  return [x, y, z];
}

await main();
