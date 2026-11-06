/**
 * Pack the unpacked CC0 material sources into the small, alpha-free WebP texture sets the app loads:
 *   public/assets/materials/hi/<layer>_a.webp  512 px  (albedo x AO, tint and saturation)
 *   public/assets/materials/hi/<layer>_n.webp  512 px  (normal x/y in R/G, roughness in B)
 *   public/assets/materials/lo/...             256 px  (Lanczos)
 * No channel is an alpha channel: a 2D-canvas decode premultiplies alpha and would corrupt RGB data.
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
  bytesReport, creditsTable, normaliseFactor, pickMaps, replaceBetweenMarkers, validateManifest, webpSettings,
  type MaterialLayer, type MaterialsManifest, type SizeEntry, type WebpSettings,
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

/** Bake the AO map into the albedo (white AO means no change). */
function multiplyAo(color: string, ao: string | null, dest: string): void {
  if (ao === null) {
    run('magick', [
      color, '-alpha', 'off', '-define', 'png:color-type=2', '-depth', '8', '-strip', dest,
    ]);
    return;
  }
  run('magick', [
    color, ao, '-compose', 'Multiply', '-composite', '-alpha', 'off',
    '-define', 'png:color-type=2', '-depth', '8', '-strip', dest,
  ]);
}

/** Measure the AO-multiplied albedo mean in sRGB 0..255 before normalising, for layers.json. */
function measureMean(color: string): [number, number, number] {
  const raw = run('magick', [color, '-format', '%[fx:mean.r] %[fx:mean.g] %[fx:mean.b]', 'info:']).trim();
  const values = raw.split(/\s+/).map(Number);
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`could not measure the albedo mean (got "${raw}")`);
  }
  return [values[0] * 255, values[1] * 255, values[2] * 255];
}

/**
 * Scale every channel by one factor (hue and contrast stay), apply the optional manifest tint, then
 * the optional saturation. All in one Magick pass, with no alpha channel.
 */
function normaliseAlbedo(
  layer: MaterialLayer,
  color: string,
  mean: readonly [number, number, number],
  dest: string,
): void {
  const factor = normaliseFactor(mean, 128);
  const tint = layer.tint ?? [1, 1, 1];
  const saturation = layer.saturation ?? 1;
  const args: string[] = [color, '-alpha', 'off'];
  const channels = ['R', 'G', 'B'];
  for (let i = 0; i < channels.length; i++) {
    args.push('-channel', channels[i], '-evaluate', 'multiply', String(factor * tint[i]));
  }
  args.push('+channel');
  if (saturation !== 1) args.push('-modulate', `100,${saturation * 100}`);
  // Keep three real RGB channels even when saturation makes the image grey, so measurement and the
  // browser decode both see RGB rather than a single-channel grey PNG.
  args.push('-clamp', '-define', 'png:color-type=2', '-depth', '8', '-strip', dest);
  run('magick', args);
}

/**
 * Tint and saturation can move the mean away from 128 (saturation 0 on the metal roofs is the case
 * here). Apply one final equal-channel correction so the packed albedo always meets the 128 ± 2 rule.
 */
function correctAlbedoMean(dest: string): void {
  const mean = measureMean(dest);
  const average = (mean[0] + mean[1] + mean[2]) / 3;
  if (Math.abs(average - 128) <= 0.5) return;
  const corrected = `${dest}.corrected.png`;
  run('magick', [
    dest, '-alpha', 'off', '-evaluate', 'multiply', String(128 / average),
    '-clamp', '-define', 'png:color-type=2', '-depth', '8', '-strip', corrected,
  ]);
  fs.renameSync(corrected, dest);
}

/** R/G keep the OpenGL normal's x/y exactly; B becomes the greyscale roughness. No alpha. */
function combineNormalRoughness(normal: string, roughness: string, dest: string): void {
  run('magick', [
    '(', normal, '-channel', 'R', '-separate', '+channel', ')',
    '(', normal, '-channel', 'G', '-separate', '+channel', ')',
    '(', roughness, '-colorspace', 'Gray', '-alpha', 'off', ')',
    '-combine', '-alpha', 'off', '-depth', '8', '-strip', dest,
  ]);
}

function encodeWebp(png: string, webp: string, quality: number, sharpYuv: boolean): void {
  fs.mkdirSync(path.dirname(webp), { recursive: true });
  const args = ['-quiet', '-q', String(quality), '-m', '6'];
  if (sharpYuv) args.push('-sharp_yuv');
  args.push(png, '-o', webp);
  run('cwebp', args);
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

function packLayer(layer: MaterialLayer, webp: WebpSettings): LayerResult {
  const maps = findMaps(layer);
  const prefix = path.join(TMP, layer.layer);
  let meanSrgb: [number, number, number] | null = null;

  // Drop any alpha-era outputs for this layer so they cannot linger in the size budget.
  for (const size of SIZES) {
    for (const suffix of ['ar', 'na']) {
      fs.rmSync(path.join(OUT, size.name, `${layer.layer}_${suffix}.webp`), { force: true });
    }
  }

  for (const size of SIZES) {
    const sizePrefix = `${prefix}_${size.px}`;
    const resized = resizeMaps(layer, maps, size.px, sizePrefix);

    const aoAlbedo = `${sizePrefix}_albedo_ao.png`;
    multiplyAo(resized.color, resized.ao, aoAlbedo);
    const mean = measureMean(aoAlbedo);
    if (size.name === 'hi') meanSrgb = mean;

    const albedo = `${sizePrefix}_albedo.png`;
    normaliseAlbedo(layer, aoAlbedo, mean, albedo);
    correctAlbedoMean(albedo);
    encodeWebp(albedo, path.join(OUT, size.name, `${layer.layer}_a.webp`), webp.albedoQ, true);

    const normalPng = `${sizePrefix}_normal_roughness.png`;
    combineNormalRoughness(resized.normal, resized.roughness, normalPng);
    encodeWebp(normalPng, path.join(OUT, size.name, `${layer.layer}_n.webp`), webp.normalQ, false);

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
    `${layer.layer}: AO albedo mean sRGB ${rounded.join(',')} -> normalised to 128` +
    `${layer.tint ? `, tint ${layer.tint.join('/')}` : ''}` +
    `${layer.saturation !== undefined ? `, saturation ${layer.saturation}` : ''}`,
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

function perLayerSizes(entries: readonly SizeEntry[]): string[] {
  const sizes = new Map<string, { total: number; hi: number; lo: number }>();
  for (const entry of entries) {
    const match = /^(hi|lo)\/(.+)_[an]\.webp$/.exec(entry.path);
    if (match === null) continue;
    const size = match[1] as 'hi' | 'lo';
    const layer = match[2];
    const current = sizes.get(layer) ?? { total: 0, hi: 0, lo: 0 };
    current.total += entry.bytes;
    current[size] += entry.bytes;
    sizes.set(layer, current);
  }
  const lines = ['size per layer:'];
  for (const name of PBR_LAYER_NAMES) {
    const size = sizes.get(name);
    if (size !== undefined) lines.push(`  ${name}: ${size.total} bytes (hi ${size.hi}, lo ${size.lo})`);
  }
  return lines;
}

function reportSize(): boolean {
  const entries: SizeEntry[] = walkFiles(OUT).map((file) => ({
    path: path.relative(OUT, file).split(path.sep).join('/'),
    bytes: fs.statSync(file).size,
  }));
  console.log(perLayerSizes(entries).join('\n'));
  const report = bytesReport(entries, BUDGET);
  console.log(report.text.trimEnd());
  return report.overLimit;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadManifest();
  const layers = selectedLayers(manifest, args.only);
  const webp = webpSettings(manifest);

  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  const results = new Map<string, LayerResult>();
  for (const layer of layers) {
    results.set(layer.layer, packLayer(layer, webp));
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
