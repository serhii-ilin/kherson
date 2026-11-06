/**
 * Download the CC0 material archives listed in data/materials.json into the git-ignored
 * data/material-sources/ directory, verify their SHA-256 and unpack them for pack-materials.ts.
 *
 *   npm run fetch-materials                       # every layer
 *   npm run fetch-materials -- --only asphalt     # one or more layers
 *   npm run fetch-materials -- --write-sha        # record the downloaded hashes in the manifest
 *   npm run fetch-materials -- --resolve          # ask ambientCG for the download urls first
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PBR_LAYER_NAMES } from '../../src/world/pbr-layers.ts';
import { validateManifest, type MaterialLayer, type MaterialsManifest } from './lib.ts';

const MANIFEST = 'data/materials.json';
const SOURCES = 'data/material-sources';
const API = 'https://ambientcg.com/api/v2/full_json';

interface Arguments {
  only: string[];
  writeSha: boolean;
  resolve: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArgs(argv: readonly string[]): Arguments {
  const args: Arguments = { only: [], writeSha: false, resolve: false };
  let sawOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write-sha') {
      args.writeSha = true;
    } else if (arg === '--resolve') {
      args.resolve = true;
    } else if (arg === '--only' || arg.startsWith('--only=')) {
      sawOnly = true;
      const value = arg === '--only' ? argv[++i] : arg.slice('--only='.length);
      if (!value) throw new Error('--only needs a comma-separated layer list');
      args.only.push(...value.split(',').map((name) => name.trim()).filter(Boolean));
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }
  args.only = [...new Set(args.only)];
  if (sawOnly && args.only.length === 0) throw new Error('--only needs a layer name');
  return args;
}

function loadManifest(): MaterialsManifest {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as MaterialsManifest;
  const errors = validateManifest(manifest, PBR_LAYER_NAMES);
  if (errors.length > 0) throw new Error(`${MANIFEST} is invalid:\n${errors.join('\n')}`);
  return manifest;
}

function writeManifest(manifest: MaterialsManifest): void {
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

function selectedLayers(manifest: MaterialsManifest, only: readonly string[]): MaterialLayer[] {
  if (only.length === 0) return manifest.layers;
  const known = new Set(PBR_LAYER_NAMES);
  const unknown = only.filter((name) => !known.has(name));
  if (unknown.length > 0) throw new Error(`unknown layer(s): ${unknown.join(', ')}`);
  const wanted = new Set(only);
  return manifest.layers.filter((layer) => wanted.has(layer.layer));
}

function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function zipPath(layer: MaterialLayer): string {
  return path.join(SOURCES, `${layer.assetId}_${layer.resolution}.zip`);
}

function unpackDir(layer: MaterialLayer): string {
  return path.join(SOURCES, layer.assetId);
}

async function download(url: string, dest: string, userAgent: string): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const partial = `${dest}.partial`;
  const response = await fetch(url, {
    headers: { 'User-Agent': userAgent },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`download failed: ${response.status} ${response.statusText} ${url}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0) throw new Error(`download returned an empty file: ${url}`);
  fs.writeFileSync(partial, body);
  fs.renameSync(partial, dest);
}

/** The ambientCG API returns download folders as nested maps; accept every folder and zip category. */
function resolvedUrl(asset: unknown, resolution: string): string | null {
  if (!isRecord(asset)) return null;
  const folders = asset.downloadFolders;
  if (!isRecord(folders)) return null;
  for (const folder of Object.values(folders)) {
    if (!isRecord(folder)) continue;
    const categories = folder.downloadFiletypeCategories;
    if (!isRecord(categories)) continue;
    for (const category of Object.values(categories)) {
      if (!isRecord(category) || !Array.isArray(category.downloads)) continue;
      for (const download of category.downloads) {
        if (!isRecord(download)) continue;
        if (typeof download.attribute !== 'string') continue;
        if (download.attribute.toLowerCase() !== resolution.toLowerCase()) continue;
        const url = download.fullDownloadPath ?? download.downloadLink;
        if (typeof url === 'string' && url !== '') return url;
      }
    }
  }
  return null;
}

async function resolveLayer(layer: MaterialLayer, userAgent: string): Promise<string> {
  const url = `${API}?id=${encodeURIComponent(layer.assetId)}&include=downloadData`;
  const response = await fetch(url, { headers: { 'User-Agent': userAgent } });
  if (!response.ok) throw new Error(`ambientCG lookup failed: ${response.status} ${response.statusText} (${layer.layer})`);
  const body = (await response.json()) as unknown;
  const assets = isRecord(body) && Array.isArray(body.foundAssets) ? body.foundAssets : [];
  const asset = assets.find(
    (entry) => isRecord(entry) && typeof entry.assetId === 'string' &&
      entry.assetId.toLowerCase() === layer.assetId.toLowerCase(),
  );
  if (asset === undefined) throw new Error(`ambientCG has no asset "${layer.assetId}" for layer "${layer.layer}"`);
  const found = resolvedUrl(asset, layer.resolution);
  if (found === null) {
    throw new Error(`ambientCG asset "${layer.assetId}" has no ${layer.resolution} download for layer "${layer.layer}"`);
  }
  return found;
}

function unzip(zip: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  try {
    execFileSync('unzip', ['-o', '-q', zip, '-d', dest], { stdio: 'inherit' });
  } catch {
    throw new Error(`unzip failed for ${zip}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadManifest();
  const layers = selectedLayers(manifest, args.only);
  let dirty = false;

  for (const layer of layers) {
    if (args.resolve) {
      const url = await resolveLayer(layer, manifest.userAgent);
      if (url !== layer.url) {
        layer.url = url;
        dirty = true;
        console.log(`resolved ${layer.layer}: ${url}`);
      }
    }
    if (!layer.url) throw new Error(`layer "${layer.layer}" has no url; use --resolve`);

    const zip = zipPath(layer);
    let present = fs.existsSync(zip);
    if (present && layer.sha256) {
      if (sha256File(zip) === layer.sha256) {
        console.log(`cached ${zip} (sha256 matches)`);
      } else {
        console.log(`cached ${zip} has the wrong sha256; downloading again`);
        present = false;
      }
    } else if (present) {
      console.log(`${zip} sha256 ${sha256File(zip)} (manifest is empty; pass --write-sha to record it)`);
    }

    if (!present) {
      console.log(`downloading ${layer.layer}: ${layer.url}`);
      await download(layer.url, zip, manifest.userAgent);
    }

    const actual = sha256File(zip);
    if (layer.sha256 && actual !== layer.sha256) {
      fs.rmSync(zip, { force: true });
      throw new Error(`sha256 mismatch for layer "${layer.layer}": ${actual} != ${layer.sha256}`);
    }
    if (!layer.sha256) console.log(`${layer.layer}: sha256 ${actual}`);
    if (args.writeSha && layer.sha256 !== actual) {
      layer.sha256 = actual;
      dirty = true;
    }

    const dest = unpackDir(layer);
    unzip(zip, dest);
    console.log(`${layer.layer}: ${zip} -> ${dest}/`);
  }

  if (dirty) {
    writeManifest(manifest);
    console.log(`updated ${MANIFEST}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
