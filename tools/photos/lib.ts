/**
 * Pure helpers for the facade-photo pipeline (CONSTITUTION Article 8.3,
 * docs/adr/0002-realistic-buildings.md). They do no I/O, so the manifest rules, ImageMagick
 * perspective arguments, the credits table and the generated runtime rows are unit-tested without
 * ImageMagick or the network. `fetch-photos.ts` and `rectify.ts` are the only callers.
 *
 * A photo row names a Wikimedia Commons original, the four source-pixel corners of the wall
 * rectangle (TL, TR, BR, BL), the output size, the real wall size and optional inpaint masks. The
 * private `evidence/` folder is never read by these helpers or tools.
 */

/** Licences allowed for photo-derived facade textures (Constitution 8.3). */
export const PHOTO_LICENCES = [
  'CC0',
  'CC0 1.0',
  'Public domain',
  'CC BY 2.0',
  'CC BY 3.0',
  'CC BY 4.0',
  'CC BY-SA 2.0',
  'CC BY-SA 3.0',
  'CC BY-SA 4.0',
] as const;

export type PhotoLicence = (typeof PHOTO_LICENCES)[number];

/** Canonical licence URLs. CC0 and public domain may leave `licenceUrl` empty. */
export const LICENCE_URLS: Readonly<Record<string, string>> = {
  CC0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC0 1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'Public domain': 'https://creativecommons.org/publicdomain/mark/1.0/',
  'CC BY 2.0': 'https://creativecommons.org/licenses/by/2.0/',
  'CC BY 3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC BY-SA 2.0': 'https://creativecommons.org/licenses/by-sa/2.0/',
  'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
};

export const PHOTOS_START_MARKER = '<!-- photos:start -->';
export const PHOTOS_END_MARKER = '<!-- photos:end -->';

/** Photos must predate the full-scale invasion (Constitution 8.3). */
export const PHOTO_DATE_CUTOFF = '2022-02-24';
/** Longest side of a texture, in pixels (ADR 0002). */
export const MAX_PHOTO_SIZE = 2048;

const PHOTO_ID = /^[a-z0-9-]+$/;
const BUILDING_KEY = /^[wr][1-9][0-9]*$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/i;
const WIKIMEDIA_HOSTS = new Set(['commons.wikimedia.org', 'upload.wikimedia.org']);
const CC_HOST = 'creativecommons.org';

export interface PhotoLevels {
  black: number;
  white: number;
  gamma: number;
}

/** Source-pixel rect `[x0, y0, x1, y1]` in the rectified output. */
export type PhotoMask = readonly [number, number, number, number];
export type PhotoPoint = readonly [number, number];

export interface PhotoEntry {
  /** File stem in `public/assets/facades/`, `[a-z0-9-]+`. */
  id: string;
  /** OSM key from `src/world/osm-ref.ts`, e.g. `w116810729`. */
  building: string;
  /** Commons title including the `File:` prefix. */
  title: string;
  /** Commons file page; the author link in the credits panel points here. */
  source: string;
  author: string;
  licence: string;
  /** Canonical licence deed; may be empty for public domain and CC0. */
  licenceUrl?: string;
  /** ISO `YYYY-MM-DD`, before 2022-02-24. */
  date: string;
  /** Empty until `fetch-photos --write-sha`, then 64 lower-case hex characters. */
  sha256: string;
  /** Source-pixel corners of the wall rectangle: TL, TR, BR, BL. */
  corners: readonly [PhotoPoint, PhotoPoint, PhotoPoint, PhotoPoint];
  /** Output width and height in pixels, each at most 2048. */
  size: readonly [number, number];
  /** Real width and height of the wall area, for docs and sanity checks. */
  wallMetres?: readonly [number, number];
  levels?: PhotoLevels;
  /** Output-pixel rects filled from their neighbours (wires, lamp posts). */
  masks?: readonly PhotoMask[];
}

export interface PhotoManifest {
  note?: string;
  userAgent: string;
  photos: PhotoEntry[];
}

/** One row of the runtime credits data, imported by the in-app panel via Vite. */
export interface PhotoCreditData {
  id: string;
  building: string;
  author: string;
  licence: string;
  licenceUrl: string;
  source: string;
  date: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(value: unknown): value is PhotoPoint {
  return Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber);
}

function isMask(value: unknown): value is PhotoMask {
  return (
    Array.isArray(value) && value.length === 4 && value.every(isFiniteNumber) &&
    value[0] >= 0 && value[1] >= 0 && value[2] > value[0] && value[3] > value[1]
  );
}

/** A real calendar date in the manifest's exact `YYYY-MM-DD` form. */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** First ISO date in a Commons `DateTimeOriginal` value, or null when it is not a date. */
export function commonsDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (match === null) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return isIsoDate(date) ? date : null;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Strip the HTML that Commons wraps around `Artist` and `LicenseShortName`, keeping the text. */
export function stripHtml(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Canonical deed for a licence, or null when the licence has no single canonical URL. */
export function licenceUrlFor(licence: string): string | null {
  return LICENCE_URLS[licence] ?? null;
}

function checkUrl(
  value: unknown,
  label: string,
  hosts: ReadonlySet<string>,
  errors: string[],
): URL | null {
  if (typeof value !== 'string' || value === '') {
    errors.push(`${label}: missing or empty`);
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    errors.push(`${label}: not a valid URL`);
    return null;
  }
  if (url.protocol !== 'https:') errors.push(`${label}: must be https`);
  if (!hosts.has(url.hostname)) errors.push(`${label}: host must be one of ${[...hosts].join(', ')}`);
  return url;
}

function checkDate(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== 'string' || !isIsoDate(value)) {
    errors.push(`${label}: date must be a real ISO date (YYYY-MM-DD)`);
    return;
  }
  if (value >= PHOTO_DATE_CUTOFF) {
    errors.push(`${label}: date must be before ${PHOTO_DATE_CUTOFF}`);
  }
}

function checkLicence(entry: Record<string, unknown>, label: string, errors: string[]): void {
  const licence = entry.licence;
  if (typeof licence !== 'string' || !(PHOTO_LICENCES as readonly string[]).includes(licence)) {
    errors.push(`${label}: licence must be one of ${PHOTO_LICENCES.join(', ')}`);
    return;
  }
  const url = entry.licenceUrl;
  const canonical = licenceUrlFor(licence);
  const optional = licence === 'CC0' || licence === 'CC0 1.0' || licence === 'Public domain';
  if (url === undefined || url === '') {
    if (!optional) errors.push(`${label}: licenceUrl is required for ${licence}`);
    return;
  }
  if (typeof url !== 'string') {
    errors.push(`${label}: licenceUrl must be a string`);
    return;
  }
  const checked = checkUrl(url, `${label} licenceUrl`, new Set([CC_HOST]), errors);
  if (checked === null || canonical === null) return;
  if (checked.href !== canonical) {
    errors.push(`${label}: licenceUrl must be ${canonical} for ${licence}`);
  }
}

function checkEntry(entry: unknown, index: number, errors: string[]): void {
  const prefix = `photos[${index}]`;
  if (!isRecord(entry)) {
    errors.push(`${prefix}: expected an object`);
    return;
  }
  const id = entry.id;
  const label = typeof id === 'string' && id !== '' ? `${prefix} (${id})` : prefix;
  if (typeof id !== 'string' || !PHOTO_ID.test(id)) {
    errors.push(`${label}: id must match [a-z0-9-]+`);
  }
  if (typeof entry.building !== 'string' || !BUILDING_KEY.test(entry.building)) {
    errors.push(`${label}: building must be an OSM key like w123 or r123`);
  }
  if (typeof entry.title !== 'string' || !/^File:.+/.test(entry.title)) {
    errors.push(`${label}: title must start with "File:"`);
  }
  checkUrl(entry.source, `${label} source`, WIKIMEDIA_HOSTS, errors);
  if (!nonEmptyString(entry.author)) errors.push(`${label}: author missing or empty`);
  checkLicence(entry, label, errors);
  checkDate(entry.date, label, errors);

  const sha = entry.sha256;
  if (typeof sha !== 'string' || (sha !== '' && !HEX_SHA256.test(sha))) {
    errors.push(`${label}: sha256 must be empty or 64 hex characters`);
  } else if (sha !== '' && sha !== sha.toLowerCase()) {
    errors.push(`${label}: sha256 must be lower-case hex`);
  }

  const corners = entry.corners;
  if (!Array.isArray(corners) || corners.length !== 4 || !corners.every(isPoint)) {
    errors.push(`${label}: corners must be four [x, y] source-pixel points (TL, TR, BR, BL)`);
  }

  const size = entry.size;
  if (
    !Array.isArray(size) || size.length !== 2 ||
    !size.every((value) => isFiniteNumber(value) && Number.isInteger(value) && value >= 1 && value <= MAX_PHOTO_SIZE)
  ) {
    errors.push(`${label}: size must be two integers from 1 to ${MAX_PHOTO_SIZE}`);
  }

  if (entry.wallMetres !== undefined) {
    const wall = entry.wallMetres;
    if (!Array.isArray(wall) || wall.length !== 2 || !wall.every((value) => isFiniteNumber(value) && value > 0)) {
      errors.push(`${label}: wallMetres must be two positive numbers`);
    }
  }

  if (entry.levels !== undefined) {
    const levels = entry.levels;
    if (!isRecord(levels)) {
      errors.push(`${label}: levels must be an object`);
    } else {
      const { black, white, gamma } = levels;
      if (!isFiniteNumber(black) || !isFiniteNumber(white) || !isFiniteNumber(gamma)) {
        errors.push(`${label}: levels black, white and gamma must be numbers`);
      } else if (black < 0 || black >= white || gamma <= 0) {
        errors.push(`${label}: levels need 0 <= black < white and gamma > 0`);
      }
    }
  }

  if (entry.masks !== undefined) {
    if (!Array.isArray(entry.masks) || !entry.masks.every(isMask)) {
      errors.push(`${label}: masks must be [x0, y0, x1, y1] rects with x1 > x0 and y1 > y0`);
    }
  }
}

/**
 * Validate a parsed `data/photo-textures.json`. Returns human-readable errors; an empty list means
 * the manifest is usable. An empty `photos` list is valid (the maintainer adds rows later).
 */
export function validatePhotoManifest(manifest: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(manifest)) return ['manifest: expected a JSON object'];
  if (!nonEmptyString(manifest.userAgent)) errors.push('manifest userAgent: missing or empty');
  if (!Array.isArray(manifest.photos)) return [...errors, 'manifest photos: expected an array'];

  const seen = new Set<string>();
  manifest.photos.forEach((entry, index) => {
    checkEntry(entry, index, errors);
    if (isRecord(entry) && typeof entry.id === 'string' && PHOTO_ID.test(entry.id)) {
      if (seen.has(entry.id)) errors.push(`photos[${index}] (${entry.id}): duplicate id`);
      seen.add(entry.id);
    }
  });
  return errors;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('perspective corner must be a finite number');
  const rounded = Math.round(value * 1000) / 1000;
  if (Object.is(rounded, -0)) return '0';
  return String(rounded);
}

/**
 * The ImageMagick `-distort Perspective` argument: each source corner maps to the matching output
 * corner, in TL, TR, BR, BL order. Pairs are separated by two spaces for readability in logs.
 */
export function perspectiveArgs(
  corners: readonly [PhotoPoint, PhotoPoint, PhotoPoint, PhotoPoint],
  size: readonly [number, number],
): string {
  if (corners.length !== 4) throw new Error('perspective needs four corners');
  const width = size[0];
  const height = size[1];
  const destination: readonly PhotoPoint[] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  return corners
    .map((point, index) => {
      const target = destination[index]!;
      return `${formatNumber(point[0])},${formatNumber(point[1])} ${formatNumber(target[0])},${formatNumber(target[1])}`;
    })
    .join('  ');
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Deterministic markdown table of the facade-photo provenance. The author links to the Commons file
 * page and the licence to its deed; public-domain and CC0 rows may have no deed link.
 */
export function creditsMarkdown(photos: readonly PhotoEntry[]): string {
  const lines = [
    '| id | building | author | source | date | licence |',
    '|---|---|---|---|---|---|',
  ];
  for (const photo of photos) {
    const source = `[${markdownCell(photo.title)}](${photo.source})`;
    const url = photo.licenceUrl ?? '';
    const licence = url === '' ? markdownCell(photo.licence) : `[${markdownCell(photo.licence)}](${url})`;
    lines.push(
      `| \`${markdownCell(photo.id)}\` | ${markdownCell(photo.building)} | ${markdownCell(photo.author)} | ` +
      `${source} | ${photo.date} | ${licence} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Runtime JSON rows for `src/world/photo-credits.data.json`, in manifest order. */
export function photoCreditsData(photos: readonly PhotoEntry[]): PhotoCreditData[] {
  return photos.map((photo) => ({
    id: photo.id,
    building: photo.building,
    author: photo.author,
    licence: photo.licence,
    licenceUrl: photo.licenceUrl ?? '',
    source: photo.source,
    date: photo.date,
  }));
}

/**
 * Replace the text between two markers, keeping the markers and any text outside them. The body is
 * trimmed of surrounding newlines so regenerating an already-generated file is idempotent.
 */
export function replaceBetweenMarkers(text: string, start: string, end: string, body: string): string {
  const startAt = text.indexOf(start);
  if (startAt < 0) throw new Error(`missing start marker ${start}`);
  const endAt = text.indexOf(end, startAt + start.length);
  if (endAt < 0) throw new Error(`missing end marker ${end} after ${start}`);
  const trimmed = body.replace(/^\n+/, '').replace(/\n+$/, '');
  return `${text.slice(0, startAt + start.length)}\n${trimmed}\n${text.slice(endAt)}`;
}
