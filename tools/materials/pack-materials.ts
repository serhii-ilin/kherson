/**
 * Pack the unpacked CC0 material sources into the small WebP texture sets the app loads:
 *   public/assets/materials/hi/<layer>_ar.webp  512 px  (albedo + roughness in alpha)
 *   public/assets/materials/hi/<layer>_na.webp  512 px  (OpenGL normal + AO in alpha)
 *   public/assets/materials/lo/...              256 px  (Lanczos)
 * It also writes layers.json and the generated credits table, and fails when the material set goes over
 * 5,000,000 bytes. ImageMagick 7 and cwebp are maintainer tools; CI never runs this script.
 *
 *   npm run pack-materials
 *   npm run pack-materials -- --only asphalt
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PBR_LAYER_NAMES, PBR_TILE_M } from '../../src/world/pbr-layers.ts';
import {
  bytesReport, creditsTable, normaliseFactor, pickMaps, replaceBetweenMarkers, validateManifest,
  type MaterialLayer, type MaterialsManifest, type SizeEntry,
} from './lib.ts';

const MANIFEST = 'data/materials.json';
const SOURCES = 'data/material-sources';
const TMP = path.join(SOURCES, 'tmp');
const OUT = 'public/assets/materials';
const CREDITS = 'docs/ASSET_CREDITS.md';
const START_MARKER = '<!-- materials:start -->';
const END_MARKER = '<!-- materials:end -->';
const BUDGET = 5_000_000;
const SEAM_LIMIT = 18 / 255;

const SIZES = [
  { name: 'hi', px: 512 },
  { name: 'lo', px: 256 },
] as const;

interface Arguments {
  only: string[];
}

interface PickedSourceMaps {
  color: string;
  roughness: string;
  normal: string;
  ao: string | null;
}

interface LayerResult {
  assetId: string;
  meanSrgb: [number, number, number];
}

interface LayersFileEntry {
  name: string;
  assetId: string;
  meanSrgb: [number, number, number];
  tileM: number;
}

function parseArgs(argv: readonly string[]): Arguments {
  const args: Arguments = { only: [] };
  let sawOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--only' || arg.startsWith('--only=')) {
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

function selectedLayers(manifest: MaterialsManifest, only: readonly string[]): MaterialLayer[] {
  if (only.length === 0) return manifest.layers;
  const known = new Set(PBR_LAYER_NAMES);
  const unknown = only.filter((name) => !known.has(name));
  if (unknown.length > 0) throw new Error(`unknown layer(s): ${unknown.join(', ')}`);
  const wanted = new Set(only);
  return manifest.layers.filter((layer) => wanted.has(layer.layer));
}

/** Run a tool with argv (never a shell), so file names with spaces and parentheses arguments stay intact. */
function run(command: string, args: readonly string[]): string {
  try {
    return execFileSync(command, [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error: unknown) {
    const failure = error as { stderr?: string | Buffer; message?: string };
    const stderr = failure.stderr === undefined ? '' : failure.stderr.toString().trim();
    throw new Error(`${command} failed${stderr ? `: ${stderr}` : `: ${failure.message ?? 'unknown error'}`}`);
  }
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function findMaps(layer: MaterialLayer): PickedSourceMaps {
  const dir = path.join(SOURCES, layer.assetId);
  if (!fs.existsSync(dir)) {
    throw new Error(`layer "${layer.layer}": missing ${dir}; run npm run fetch-materials -- --only ${layer.layer}`);
  }
  const { color, roughness, normal, ao } = pickMaps(walkFiles(dir));
  const missing: string[] = [];
  if (color === null) missing.push('_Color');
  if (roughness === null) missing.push('_Roughness');
  if (normal === null) missing.push('_NormalGL');
  if (color === null || roughness === null || normal === null || missing.length > 0) {
    throw new Error(`layer "${layer.layer}" (${layer.assetId}): missing ${missing.join(', ')} in ${dir}`);
  }
  return { color, roughness, normal, ao };
}

function resizeMaps(layer: MaterialLayer, maps: PickedSourceMaps, px: number, prefix: string): {
  color: string;
  roughness: string;
  normal: string;
  ao: string | null;
} {
  const resize = [px + 'x' + px + '!'];
  const color = `${prefix}_color.png`;
  run('magick', [maps.color, '-filter', 'Lanczos', '-resize', ...resize, '-alpha', 'off', '-depth', '8', '-strip', color]);

  const roughness = `${prefix}_roughness.png`;
  run('magick', [
    maps.roughness, '-colorspace', 'Gray', '-filter', 'Lanczos', '-resize', ...resize,
    '-alpha', 'off', '-depth', '8', '-strip', roughness,
  ]);

  const normal = `${prefix}_normal.png`;
  run('magick', [
    maps.normal, '-filter', 'Lanczos', '-resize', ...resize,
    '-alpha', 'off', '-depth', '8', '-strip', normal,
  ]);

  let ao: string | null = null;
  if (maps.ao !== null) {
    ao = `${prefix}_ao.png`;
    run('magick', [
      maps.ao, '-colorspace', 'Gray', '-filter', 'Lanczos', '-resize', ...resize,
      '-alpha', 'off', '-depth', '8', '-strip', ao,
    ]);
  }
  return { color, roughness, normal, ao };
}

/** Measure the resized albedo mean in sRGB 0..255 before normalising, for layers.json. */
function measureMean(color: string): [number, number, number] {
  const raw = run('magick', [color, '-format', '%[fx:mean.r] %[fx:mean.g] %[fx:mean.b]', 'info:']).trim();
  const values = raw.split(/\s+/).map(Number);
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`could not measure the albedo mean (got "${raw}")`);
  }
  return [values[0] * 255, values[1] * 255, values[2] * 255];
}

/** Scale every channel by one factor (hue and contrast stay), then apply the optional manifest tint. */
function normaliseAlbedo(layer: MaterialLayer, color: string, mean: readonly [number, number, number], dest: string): void {
  const factor = normaliseFactor(mean, 128);
  const tint = layer.tint ?? [1, 1, 1];
  const args: string[] = [color, '-alpha', 'off'];
  const channels = ['R', 'G', 'B'];
  for (let i = 0; i < channels.length; i++) {
    args.push('-channel', channels[i], '-evaluate', 'multiply', String(factor * tint[i]));
  }
  args.push('+channel', '-clamp', '-depth', '8', '-strip', dest);
  run('magick', args);
}

function combineAlpha(rgb: string, alpha: string | null, px: number, dest: string): void {
  const alphaSource = alpha === null ? ['(', '-size', `${px}x${px}`, 'xc:white', ')'] : [alpha];
  run('magick', [
    rgb, ...alphaSource, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite',
    '-depth', '8', '-strip', dest,
  ]);
}

function encodeWebp(png: string, webp: string, quality: number): void {
  fs.mkdirSync(path.dirname(webp), { recursive: true });
  run('cwebp', [
    '-quiet', '-q', String(quality), '-alpha_q', '92', '-exact', '-m', '6', '-sharp_yuv',
    png, '-o', webp,
  ]);
}

/** Mean absolute difference between opposite edge columns/rows of the 512 albedo, in 0..1. */
function seamDifference(albedo: string, px: number, prefix: string): { mean: number; column: number; row: number } {
  const edge = (suffix: string, crop: string): number => {
    const left = `${prefix}_seam_${suffix}_a.png`;
    const right = `${prefix}_seam_${suffix}_b.png`;
    run('magick', [albedo, '-crop', crop, '+repage', '-alpha', 'off', '-depth', '8', '-strip', left]);
    const other = suffix === 'column' ? `1x${px}+${px - 1}+0` : `${px}x1+0+${px - 1}`;
    run('magick', [albedo, '-crop', other, '+repage', '-alpha', 'off', '-depth', '8', '-strip', right]);
    const raw = run('magick', [left, right, '-compose', 'difference', '-composite', '-format', '%[fx:mean]', 'info:']).trim();
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`could not measure the ${suffix} seam (got "${raw}")`);
    return value;
  };
  const column = edge('column', `1x${px}+0+0`);
  const row = edge('row', `${px}x1+0+0`);
  return { mean: (column + row) / 2, column, row };
}

function packLayer(layer: MaterialLayer): LayerResult {
  const maps = findMaps(layer);
  const prefix = path.join(TMP, layer.layer);
  let meanSrgb: [number, number, number] | null = null;

  for (const size of SIZES) {
    const sizePrefix = `${prefix}_${size.px}`;
    const resized = resizeMaps(layer, maps, size.px, sizePrefix);
    const mean = measureMean(resized.color);
    if (size.name === 'hi') meanSrgb = mean;

    const albedo = `${sizePrefix}_albedo.png`;
    normaliseAlbedo(layer, resized.color, mean, albedo);

    const arPng = `${sizePrefix}_ar.png`;
    combineAlpha(albedo, resized.roughness, size.px, arPng);
    encodeWebp(arPng, path.join(OUT, size.name, `${layer.layer}_ar.webp`), 86);

    const naPng = `${sizePrefix}_na.png`;
    combineAlpha(resized.normal, resized.ao, size.px, naPng);
    encodeWebp(naPng, path.join(OUT, size.name, `${layer.layer}_na.webp`), 92);

    if (size.name === 'hi') {
      const seam = seamDifference(albedo, size.px, sizePrefix);
      const value = seam.mean * 255;
      if (seam.mean > SEAM_LIMIT) {
        console.warn(
          `warning: layer "${layer.layer}" seam difference ${value.toFixed(1)}/255 ` +
          `(column ${(seam.column * 255).toFixed(1)}, row ${(seam.row * 255).toFixed(1)}) exceeds 18/255`,
        );
      } else {
        console.log(`seam ${layer.layer}: ${value.toFixed(1)}/255`);
      }
    }
  }

  if (meanSrgb === null) throw new Error(`layer "${layer.layer}": no hi measurement`);
  const rounded: [number, number, number] = [
    Math.round(meanSrgb[0]), Math.round(meanSrgb[1]), Math.round(meanSrgb[2]),
  ];
  console.log(
    `${layer.layer}: mean sRGB ${rounded.join(',')} -> normalised to 128` +
    `${layer.tint ? `, tint ${layer.tint.join('/')}` : ''}`,
  );
  return { assetId: layer.assetId, meanSrgb: rounded };
}

/** Keep entries from an earlier layers.json when packing only a few layers. */
function previousLayers(): Map<string, LayersFileEntry> {
  const file = path.join(OUT, 'layers.json');
  const previous = new Map<string, LayersFileEntry>();
  if (!fs.existsSync(file)) return previous;
  let document: unknown;
  try {
    document = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return previous;
  }
  const layers = typeof document === 'object' && document !== null && Array.isArray((document as { layers?: unknown }).layers)
    ? (document as { layers: unknown[] }).layers
    : [];
  for (const entry of layers) {
    if (typeof entry !== 'object' || entry === null) continue;
    const value = entry as Record<string, unknown>;
    if (typeof value.name !== 'string' || typeof value.assetId !== 'string' || typeof value.tileM !== 'number') continue;
    const mean = value.meanSrgb;
    if (!Array.isArray(mean) || mean.length !== 3 || mean.some((v) => typeof v !== 'number' || !Number.isFinite(v))) continue;
    previous.set(value.name, {
      name: value.name,
      assetId: value.assetId,
      meanSrgb: [mean[0], mean[1], mean[2]],
      tileM: value.tileM,
    });
  }
  return previous;
}

function writeLayersJson(results: Map<string, LayerResult>): void {
  const previous = previousLayers();
  const layers: LayersFileEntry[] = [];
  for (let i = 0; i < PBR_LAYER_NAMES.length; i++) {
    const name = PBR_LAYER_NAMES[i];
    const result = results.get(name);
    if (result !== undefined) {
      layers.push({ name, assetId: result.assetId, meanSrgb: result.meanSrgb, tileM: PBR_TILE_M[i] });
      continue;
    }
    const kept = previous.get(name);
    if (kept !== undefined) layers.push({ ...kept, tileM: PBR_TILE_M[i] });
  }
  if (layers.length < PBR_LAYER_NAMES.length) {
    console.warn(
      `warning: layers.json describes ${layers.length} of ${PBR_LAYER_NAMES.length} layers; ` +
      'run pack-materials without --only for the complete set',
    );
  }
  fs.mkdirSync(OUT, { recursive: true });
  const document = { version: 1, size: { hi: 512, lo: 256 }, layers };
  fs.writeFileSync(path.join(OUT, 'layers.json'), `${JSON.stringify(document, null, 2)}\n`);
  console.log(`wrote ${path.join(OUT, 'layers.json')} (${layers.length} layers)`);
}

function updateCredits(manifest: MaterialsManifest): void {
  const text = fs.readFileSync(CREDITS, 'utf8');
  const updated = replaceBetweenMarkers(text, START_MARKER, END_MARKER, creditsTable(manifest));
  if (updated !== text) {
    fs.writeFileSync(CREDITS, updated);
    console.log(`updated ${CREDITS}`);
  }
}

function reportSize(): boolean {
  const entries: SizeEntry[] = walkFiles(OUT).map((file) => ({
    path: path.relative(OUT, file).split(path.sep).join('/'),
    bytes: fs.statSync(file).size,
  }));
  const report = bytesReport(entries, BUDGET);
  console.log(report.text.trimEnd());
  return report.overLimit;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadManifest();
  const layers = selectedLayers(manifest, args.only);

  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  const results = new Map<string, LayerResult>();
  for (const layer of layers) {
    results.set(layer.layer, packLayer(layer));
  }

  writeLayersJson(results);
  updateCredits(manifest);
  if (reportSize()) {
    console.error(`materials exceed the ${BUDGET} byte budget; reduce layers or raise quality only with a plan change`);
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
