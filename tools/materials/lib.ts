/**
 * Pure helpers for the CC0 material tools (docs/adr/0002-realistic-buildings.md). They do no I/O, so the
 * manifest, map picking, albedo normalisation, credits table and size budget are unit-tested without
 * ImageMagick or the network. `fetch-materials.ts` and `pack-materials.ts` are the only callers.
 */

/** The licence the material sources must carry (Constitution 8.2; CC0 only, no attribution required). */
export const MATERIAL_LICENCES = ['CC0-1.0'] as const;

export interface MaterialLayer {
  /** Stem from `PBR_LAYER_NAMES`, e.g. `stucco_smooth`. */
  layer: string;
  /** Archive source, e.g. `ambientcg`. */
  source: string;
  /** Source asset id, e.g. `Plaster001`. */
  assetId: string;
  /** Download variant, e.g. `1K-JPG`. */
  resolution: string;
  url: string;
  page: string;
  licence: string;
  /** Lower-case hex SHA-256 of the downloaded zip, or empty until `--write-sha`. */
  sha256: string;
  /** Optional per-channel multiplier applied after albedo normalisation. */
  tint?: readonly [number, number, number];
}

export interface MaterialsManifest {
  note?: string;
  userAgent: string;
  layers: MaterialLayer[];
}

/** Source maps found in an unpacked material folder. Required maps are non-null after `requireMaps`. */
export interface PickedMaps {
  color: string | null;
  roughness: string | null;
  normal: string | null;
  ao: string | null;
}

export interface SizeEntry {
  path: string;
  bytes: number;
}

export interface BytesReport {
  total: number;
  limit: number;
  overLimit: boolean;
  text: string;
}

const TEXT_FIELDS = ['source', 'assetId', 'resolution', 'url', 'page'] as const;
const HEX_SHA256 = /^[0-9a-f]{64}$/i;
const HTTPS_URL = /^https:\/\/[^\s]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Validate a parsed `data/materials.json` against the shared layer contract.
 * Returns a list of human-readable errors; an empty list means the manifest is usable.
 */
export function validateManifest(m: unknown, names: readonly string[]): string[] {
  const errors: string[] = [];
  if (!isRecord(m)) {
    return ['manifest: expected a JSON object'];
  }
  if (!nonEmptyString(m.userAgent)) errors.push('manifest userAgent: missing or empty');
  if (!Array.isArray(m.layers)) {
    return [...errors, 'manifest layers: expected an array'];
  }

  const layers = m.layers;
  for (let i = 0; i < Math.max(layers.length, names.length); i++) {
    const expected = names[i];
    const entry = layers[i];
    if (expected === undefined) {
      const got = isRecord(entry) && typeof entry.layer === 'string' ? ` "${entry.layer}"` : '';
      errors.push(`layers[${i}]: unexpected extra layer${got}`);
      continue;
    }
    const label = `layers[${i}] (${expected})`;
    if (entry === undefined) {
      errors.push(`${label}: missing; expected "${expected}"`);
      continue;
    }
    if (!isRecord(entry)) {
      errors.push(`${label}: expected an object`);
      continue;
    }
    if (typeof entry.layer !== 'string') {
      errors.push(`${label}: layer must be a string`);
    } else if (entry.layer !== expected) {
      errors.push(`${label}: expected layer "${expected}", got "${entry.layer}"`);
    }
    for (const field of TEXT_FIELDS) {
      if (!nonEmptyString(entry[field])) {
        errors.push(`${label}: ${field} missing or empty`);
      }
    }
    if (typeof entry.licence !== 'string' || !(MATERIAL_LICENCES as readonly string[]).includes(entry.licence)) {
      errors.push(`${label}: licence must be one of ${MATERIAL_LICENCES.join(', ')}`);
    }
    if (typeof entry.url !== 'string' || !HTTPS_URL.test(entry.url)) {
      errors.push(`${label}: url must be an https URL`);
    }
    if (typeof entry.sha256 !== 'string' || (entry.sha256 !== '' && !HEX_SHA256.test(entry.sha256))) {
      errors.push(`${label}: sha256 must be empty or 64 hex characters`);
    }
    if (entry.tint !== undefined) {
      const tint = entry.tint;
      if (
        !Array.isArray(tint) || tint.length !== 3 ||
        tint.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
      ) {
        errors.push(`${label}: tint must be three positive numbers`);
      }
    }
  }
  return errors;
}

/**
 * Pick the maps a packed layer needs by the ambientCG suffixes. Only jpg/png files count, and the first
 * matching name after sorting wins so the result does not depend on directory listing order.
 */
export function pickMaps(fileNames: readonly string[]): PickedMaps {
  const sorted = [...fileNames].sort();
  const find = (suffix: string): string | null =>
    sorted.find((name) => new RegExp(`_${suffix}\\.(?:jpg|png)$`, 'i').test(name)) ?? null;
  return {
    color: find('Color'),
    roughness: find('Roughness'),
    normal: find('NormalGL'),
    ao: find('AmbientOcclusion'),
  };
}

/**
 * Scale that brings the mean of R, G and B to `target` (sRGB 0..255) while keeping hue and contrast,
 * because every channel is multiplied by the same factor. A black image has no hue to keep, so it
 * stays as it is.
 */
export function normaliseFactor(mean: readonly [number, number, number], target = 128): number {
  const average = (mean[0] + mean[1] + mean[2]) / 3;
  if (!Number.isFinite(average) || average <= 0) return 1;
  return target / average;
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

/** Deterministic markdown table of the material provenance, with the asset linked to its page. */
export function creditsTable(manifest: MaterialsManifest): string {
  const lines = [
    '| Layer | Asset | Source | Licence |',
    '|---|---|---|---|',
  ];
  for (const layer of manifest.layers) {
    const asset = `[${markdownCell(layer.assetId)}](${layer.page})`;
    lines.push(
      `| \`${markdownCell(layer.layer)}\` | ${asset} | ${markdownCell(layer.source)} | ${markdownCell(layer.licence)} |`,
    );
  }
  return `${lines.join('\n')}\n`;
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

/** Total up a directory's files against a byte limit, with a stable report for the console. */
export function bytesReport(entries: readonly SizeEntry[], limit: number): BytesReport {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const total = sorted.reduce((sum, entry) => sum + entry.bytes, 0);
  const percent = limit > 0 ? (total / limit) * 100 : 0;
  const lines = sorted.map((entry) => `  ${entry.path}: ${entry.bytes} bytes`);
  const overLimit = total > limit;
  lines.push(
    `total ${total} bytes of ${limit} (${percent.toFixed(1)}%)${overLimit ? ' - OVER LIMIT' : ' - ok'}`,
  );
  return { total, limit, overLimit, text: `${lines.join('\n')}\n` };
}
