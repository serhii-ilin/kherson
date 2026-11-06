/**
 * Rectify the downloaded facade photos into WebP wall textures and regenerate their credits:
 *
 *   public/assets/facades/<id>.webp
 *   docs/ASSET_CREDITS.md          (table between <!-- photos:start --> / <!-- photos:end -->)
 *   src/world/photo-credits.data.json
 *
 * Each source is perspective-corrected from its four wall corners, cropped to the manifest size,
 * colour-levelled, has the masked rects blurred out (wires, lamp posts) and is encoded with cwebp.
 * The script fails when public/assets/ (materials + facades) goes over the 15 MB Article 4 budget.
 *
 *   npm run rectify-photos
 *   npm run rectify-photos -- --only frehat-east
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  PHOTOS_END_MARKER,
  PHOTOS_START_MARKER,
  creditsMarkdown,
  perspectiveArgs,
  photoCreditsData,
  replaceBetweenMarkers,
  validatePhotoManifest,
  type PhotoEntry,
  type PhotoManifest,
} from './lib.ts';

const MANIFEST = 'data/photo-textures.json';
const SOURCES = 'data/photo-sources';
const TMP = path.join(SOURCES, 'tmp');
const OUT = 'public/assets/facades';
const ASSETS = 'public/assets';
const CREDITS = 'docs/ASSET_CREDITS.md';
const DATA = 'src/world/photo-credits.data.json';
const BUDGET = 15_000_000;

interface Arguments {
  only: string[];
}

function parseArgs(argv: readonly string[]): Arguments {
  const args: Arguments = { only: [] };
  let sawOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--only' || arg.startsWith('--only=')) {
      sawOnly = true;
      const value = arg === '--only' ? argv[++i] : arg.slice('--only='.length);
      if (!value) throw new Error('--only needs a comma-separated photo id list');
      args.only.push(...value.split(',').map((id) => id.trim()).filter(Boolean));
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }
  args.only = [...new Set(args.only)];
  if (sawOnly && args.only.length === 0) throw new Error('--only needs a photo id');
  return args;
}

function loadManifest(): PhotoManifest {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as PhotoManifest;
  const errors = validatePhotoManifest(manifest);
  if (errors.length > 0) throw new Error(`${MANIFEST} is invalid:\n${errors.join('\n')}`);
  return manifest;
}

function selectedPhotos(manifest: PhotoManifest, only: readonly string[]): PhotoEntry[] {
  if (only.length === 0) return manifest.photos;
  const known = new Set(manifest.photos.map((photo) => photo.id));
  const unknown = only.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`unknown photo id(s): ${unknown.join(', ')}`);
  const wanted = new Set(only);
  return manifest.photos.filter((photo) => wanted.has(photo.id));
}

/** Run a tool with argv (never a shell), so paths with spaces stay intact. */
function run(command: string, args: readonly string[]): void {
  try {
    execFileSync(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error: unknown) {
    const failure = error as { stderr?: string | Buffer; message?: string };
    const stderr = failure.stderr === undefined ? '' : failure.stderr.toString().trim();
    throw new Error(`${command} failed${stderr ? `: ${stderr}` : `: ${failure.message ?? 'unknown error'}`}`);
  }
}

function sourceFile(id: string): string {
  if (!fs.existsSync(SOURCES)) {
    throw new Error(`missing ${SOURCES}; run npm run fetch-photos first`);
  }
  const names = fs.readdirSync(SOURCES)
    .filter((name) => name.startsWith(`${id}.`) && !name.endsWith('.partial'))
    .sort();
  for (const name of names) {
    const file = path.join(SOURCES, name);
    if (fs.statSync(file).isFile()) return file;
  }
  throw new Error(`missing source for "${id}" in ${SOURCES}; run npm run fetch-photos -- --only ${id}`);
}

function rounded(value: number): number {
  return Math.round(value);
}

/** Refuse a cached download that does not match the manifest, so a texture is reproducible. */
function verifySource(photo: PhotoEntry, file: string): void {
  if (photo.sha256 === '') {
    console.warn(`${photo.id}: manifest sha256 is empty; run fetch-photos --write-sha to pin the source`);
    return;
  }
  const sha = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (sha !== photo.sha256.toLowerCase()) {
    throw new Error(`${photo.id}: source sha256 ${sha} does not match the manifest ${photo.sha256}`);
  }
}

function rectifyPhoto(photo: PhotoEntry, output: string): void {
  const source = sourceFile(photo.id);
  verifySource(photo, source);
  const [width, height] = photo.size;
  const temp = path.join(TMP, `${photo.id}.png`);
  const levels = photo.levels ?? { black: 0, white: 255, gamma: 1 };
  const args: string[] = [
    source,
    '-auto-orient',
    '-distort', 'Perspective', perspectiveArgs(photo.corners, photo.size),
    '-crop', `${width}x${height}+0+0`,
    '+repage',
    '-level', `${levels.black},${levels.white},${levels.gamma}`,
  ];
  for (const mask of photo.masks ?? []) {
    const [x0, y0, x1, y1] = mask.map(rounded) as [number, number, number, number];
    if (x1 <= x0 || y1 <= y0) continue;
    args.push('-region', `${x1 - x0}x${y1 - y0}+${x0}+${y0}`, '-blur', '0x8', '+region');
  }
  args.push('-alpha', 'off', '-strip', temp);
  run('magick', args);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  run('cwebp', ['-quiet', '-q', '82', '-m', '6', '-sharp_yuv', temp, '-o', output]);
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function reportAssetSize(): boolean {
  const entries = walkFiles(ASSETS).map((file) => ({
    path: path.relative(ASSETS, file).split(path.sep).join('/'),
    bytes: fs.statSync(file).size,
  }));
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  for (const entry of entries) console.log(`  ${entry.path}: ${entry.bytes} bytes`);
  const percent = (total / BUDGET) * 100;
  const over = total > BUDGET;
  console.log(
    `total ${total} bytes of ${BUDGET} (${percent.toFixed(1)}%)${over ? ' - OVER LIMIT' : ' - ok'}`,
  );
  return over;
}

function updateCredits(photos: readonly PhotoEntry[]): void {
  const text = fs.readFileSync(CREDITS, 'utf8');
  const updated = replaceBetweenMarkers(text, PHOTOS_START_MARKER, PHOTOS_END_MARKER, creditsMarkdown(photos));
  if (updated !== text) {
    fs.writeFileSync(CREDITS, updated);
    console.log(`updated ${CREDITS}`);
  }
}

function updateRuntimeData(photos: readonly PhotoEntry[]): void {
  const text = `${JSON.stringify(photoCreditsData(photos), null, 2)}\n`;
  const current = fs.existsSync(DATA) ? fs.readFileSync(DATA, 'utf8') : '';
  if (current !== text) {
    fs.writeFileSync(DATA, text);
    console.log(`updated ${DATA}`);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadManifest();
  const photos = selectedPhotos(manifest, args.only);

  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  for (const photo of photos) {
    const output = path.join(OUT, `${photo.id}.webp`);
    rectifyPhoto(photo, output);
    console.log(`rectified ${photo.id}: ${photo.size[0]}x${photo.size[1]} -> ${output} (${fs.statSync(output).size} bytes)`);
  }
  fs.rmSync(TMP, { recursive: true, force: true });

  updateCredits(manifest.photos);
  updateRuntimeData(manifest.photos);
  if (reportAssetSize()) {
    console.error(`public/assets exceeds the ${BUDGET} byte budget; reduce textures or amend Article 4`);
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
