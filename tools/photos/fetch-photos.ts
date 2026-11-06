/**
 * Download the dated, licensed Wikimedia Commons originals listed in data/photo-textures.json into
 * the git-ignored data/photo-sources/ folder, re-checking the licence, author and date against the
 * Commons API and recording the SHA-256. Never uses Google services or the private evidence folder.
 *
 *   npm run fetch-photos                    # every photo
 *   npm run fetch-photos -- --only frehat-east
 *   npm run fetch-photos -- --write-sha     # record the downloaded hashes in the manifest
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  PHOTO_DATE_CUTOFF,
  PHOTO_LICENCES,
  commonsDate,
  stripHtml,
  validatePhotoManifest,
  type PhotoEntry,
  type PhotoManifest,
} from './lib.ts';

const MANIFEST = 'data/photo-textures.json';
const SOURCES = 'data/photo-sources';
const API = 'https://commons.wikimedia.org/w/api.php';
const UPLOAD_HOST = 'upload.wikimedia.org';

interface Arguments {
  only: string[];
  writeSha: boolean;
}

interface ImageInfo {
  url: string;
  sha1: string;
  extmetadata: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArgs(argv: readonly string[]): Arguments {
  const args: Arguments = { only: [], writeSha: false };
  let sawOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write-sha') {
      args.writeSha = true;
    } else if (arg === '--only' || arg.startsWith('--only=')) {
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

function writeManifest(manifest: PhotoManifest): void {
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

function selectedPhotos(manifest: PhotoManifest, only: readonly string[]): PhotoEntry[] {
  if (only.length === 0) return manifest.photos;
  const known = new Set(manifest.photos.map((photo) => photo.id));
  const unknown = only.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`unknown photo id(s): ${unknown.join(', ')}`);
  const wanted = new Set(only);
  return manifest.photos.filter((photo) => wanted.has(photo.id));
}

function apiUrl(photo: PhotoEntry): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'imageinfo',
    iiprop: 'url|sha1|extmetadata',
    titles: photo.title,
  });
  return `${API}?${params.toString()}`;
}

async function fetchJson(url: string, userAgent: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: 'application/json' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`Commons lookup failed: ${response.status} ${response.statusText}`);
  return response.json();
}

function firstPage(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body) || !isRecord(body.query)) return null;
  const pages = body.query.pages;
  if (Array.isArray(pages)) return isRecord(pages[0]) ? pages[0] : null;
  if (isRecord(pages)) {
    const first = Object.values(pages)[0];
    return isRecord(first) ? first : null;
  }
  return null;
}

function imageInfo(photo: PhotoEntry, body: unknown): ImageInfo {
  const page = firstPage(body);
  if (page === null) throw new Error(`${photo.id}: Commons returned no page for ${photo.title}`);
  const missing = Array.isArray(page.missing) || page.missing === true || page.missing === '';
  if (missing) throw new Error(`${photo.id}: Commons has no file ${photo.title}`);
  const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : undefined;
  if (!isRecord(info) || typeof info.url !== 'string') {
    throw new Error(`${photo.id}: Commons returned no imageinfo for ${photo.title}`);
  }
  return {
    url: info.url,
    sha1: typeof info.sha1 === 'string' ? info.sha1 : '',
    extmetadata: info.extmetadata,
  };
}

function metadataValue(metadata: unknown, key: string): string {
  if (!isRecord(metadata)) return '';
  const item = metadata[key];
  if (!isRecord(item) || typeof item.value !== 'string') return '';
  return stripHtml(item.value);
}

/** Re-check the API's licence, author and date against the manifest before downloading. */
function verifyPhoto(photo: PhotoEntry, info: ImageInfo): void {
  const licence = metadataValue(info.extmetadata, 'LicenseShortName');
  if (licence === '') throw new Error(`${photo.id}: Commons API did not give a licence`);
  if (!(PHOTO_LICENCES as readonly string[]).includes(licence)) {
    throw new Error(`${photo.id}: licence "${licence}" is not allowed (${PHOTO_LICENCES.join(', ')})`);
  }
  if (licence !== photo.licence) {
    throw new Error(`${photo.id}: licence disagrees with the manifest: API "${licence}", manifest "${photo.licence}"`);
  }

  const author = metadataValue(info.extmetadata, 'Artist');
  if (author === '') throw new Error(`${photo.id}: Commons API did not give an author`);
  if (author !== photo.author) {
    throw new Error(`${photo.id}: author disagrees with the manifest: API "${author}", manifest "${photo.author}"`);
  }

  const rawDate = metadataValue(info.extmetadata, 'DateTimeOriginal');
  const date = commonsDate(rawDate);
  if (date === null) throw new Error(`${photo.id}: Commons API date "${rawDate}" is not an ISO date`);
  if (date >= PHOTO_DATE_CUTOFF) {
    throw new Error(`${photo.id}: photo date ${date} is not before ${PHOTO_DATE_CUTOFF}`);
  }
  if (date !== photo.date) {
    throw new Error(`${photo.id}: date disagrees with the manifest: API "${date}", manifest "${photo.date}"`);
  }

  let url: URL;
  try {
    url = new URL(info.url);
  } catch {
    throw new Error(`${photo.id}: Commons returned an invalid file URL`);
  }
  if (url.protocol !== 'https:' || url.hostname !== UPLOAD_HOST) {
    throw new Error(`${photo.id}: original file must be https on ${UPLOAD_HOST}, got ${info.url}`);
  }
}

function fileExtension(url: string): string {
  const name = new URL(url).pathname.split('/').pop() ?? '';
  const match = /\.([a-z0-9]{2,5})$/i.exec(name);
  return match === null ? 'jpg' : match[1]!.toLowerCase();
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

function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sha1File(file: string): string {
  return createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadManifest();
  const photos = selectedPhotos(manifest, args.only);
  if (photos.length === 0) {
    console.log(`${MANIFEST} has no photos yet; nothing to fetch`);
    return;
  }

  let changed = false;
  for (const photo of photos) {
    const info = imageInfo(photo, await fetchJson(apiUrl(photo), manifest.userAgent));
    verifyPhoto(photo, info);

    const dest = path.join(SOURCES, `${photo.id}.${fileExtension(info.url)}`);
    await download(info.url, dest, manifest.userAgent);
    const sha = sha256File(dest);
    console.log(`${photo.id}: ${info.url}`);
    console.log(`${photo.id}: sha256 ${sha}${info.sha1 === '' ? '' : ` (Commons sha1 ${info.sha1})`} -> ${dest}`);
    if (info.sha1 !== '') {
      const sha1 = sha1File(dest);
      if (sha1.toLowerCase() !== info.sha1.toLowerCase()) {
        throw new Error(`${photo.id}: download sha1 ${sha1} does not match Commons ${info.sha1}`);
      }
      console.log(`${photo.id}: sha1 matches Commons`);
    }

    if (photo.sha256 !== '') {
      if (photo.sha256.toLowerCase() !== sha) {
        throw new Error(`${photo.id}: sha256 ${sha} does not match the manifest ${photo.sha256}`);
      }
      console.log(`${photo.id}: sha256 matches the manifest`);
    } else if (args.writeSha) {
      photo.sha256 = sha;
      changed = true;
      console.log(`${photo.id}: wrote sha256 to ${MANIFEST}`);
    } else {
      console.log(`${photo.id}: manifest sha256 is empty; rerun with --write-sha to record it`);
    }
  }

  if (changed) writeManifest(manifest);
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
