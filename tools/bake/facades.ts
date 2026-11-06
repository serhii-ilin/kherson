/**
 * Tier-K facade descriptors, baked: `data/facades/*.json` rows are validated, matched to the vector-tile building
 * with the same OSM key, and written to `public/world/facades.json` with the real footprint in world metres.
 *
 * The bake fails on a malformed row (a typo must not ship a broken building). An id that is absent from the
 * snapshot is a warning: the row is kept in the source file for a later snapshot, but skipped here.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FacadeBuildingRow } from '../../src/landmarks/facade-building.ts';
import type { FacadeProfile } from '../../src/mesh/facade-profile.ts';
import { validateFacadeFile, warnFacadeFile } from '../../src/mesh/facade-profile-validate.ts';
import { buildingKey } from '../../src/world/osm-ref.ts';
import type { VBuilding, VectorTile } from '../../src/world/vector-format.ts';
import { REGION_CM } from './vectors.ts';

export interface FacadeBakeResult {
  rows: FacadeBuildingRow[];
  unmatched: string[];
}

interface BuildingIndexEntry {
  tile: VectorTile;
  building: VBuilding;
}

/** Matches rows to buildings and returns the sorted world-metre rows. Throws when a descriptor is invalid. */
export function buildFacadeRows(
  profiles: readonly FacadeProfile[],
  tiles: Iterable<VectorTile>,
  warn: (message: string) => void = console.warn,
): FacadeBakeResult {
  const errors = validateFacadeFile(profiles);
  if (errors.length > 0) {
    throw new Error(`facade validation failed:\n${errors.join('\n')}`);
  }
  for (const warning of warnFacadeFile(profiles)) warn(warning);

  const index = new Map<string, BuildingIndexEntry>();
  for (const tile of tiles) {
    for (const building of tile.buildings) index.set(buildingKey(building.id, building.osmType), { tile, building });
  }

  const rows: FacadeBuildingRow[] = [];
  const unmatched: string[] = [];
  const edgeErrors: string[] = [];
  for (const profile of profiles) {
    const found = index.get(profile.key);
    const outer = found?.building.rings[0];
    if (!found || !outer || outer.length < 6) {
      unmatched.push(profile.key);
      continue;
    }
    // The vector bake keeps the OSM way node order (first node first, no rotation or reversal) and drops only the
    // closing node and consecutive duplicate points, so descriptor edge i is the i-th distinct ring vertex.
    const ring: [number, number][] = [];
    for (let i = 0; i + 1 < outer.length; i += 2) {
      ring.push([
        (outer[i]! + found.tile.rx * REGION_CM) / 100,
        (outer[i + 1]! + found.tile.rz * REGION_CM) / 100,
      ]);
    }
    profile.edges.forEach((edge, edgeIndex) => {
      if (edge.edge >= ring.length) {
        edgeErrors.push(
          `facade ${profile.key}: edges[${edgeIndex}].edge ${edge.edge} is outside the ${ring.length}-vertex outer ring`,
        );
      }
    });
    rows.push({
      profile,
      ring,
      heightM: found.building.heightCm / 100,
      minHeightM: found.building.minHeightCm / 100,
    });
  }

  if (edgeErrors.length > 0) throw new Error(`facade edge index check failed:\n${edgeErrors.join('\n')}`);

  rows.sort((a, b) => a.profile.key.localeCompare(b.profile.key));
  unmatched.sort();
  if (unmatched.length > 0) warn(`facades: ${unmatched.length} unmatched key(s): ${unmatched.join(', ')}`);
  return { rows, unmatched };
}

/** Writes `facades.json` deterministically and returns the count and matching warnings. */
export function writeFacades(
  outDir: string,
  profiles: readonly FacadeProfile[],
  tiles: Iterable<VectorTile>,
  warn: (message: string) => void = console.warn,
): FacadeBakeResult {
  const result = buildFacadeRows(profiles, tiles, warn);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'facades.json'), `${JSON.stringify({ version: 1, rows: result.rows })}\n`);
  return result;
}

/** Reads and validates every `*.json` file in `dir`, sorted by name. A missing directory is an empty set. */
export function readFacadeRows(dir = 'data/facades'): FacadeProfile[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  const all: FacadeProfile[] = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`${file}: invalid JSON: ${(error as Error).message}`);
    }
    const errors = validateFacadeFile(parsed);
    if (errors.length > 0) throw new Error(`${file}: facade validation failed:\n${errors.join('\n')}`);
    all.push(...(parsed as FacadeProfile[]));
  }
  const globalErrors = validateFacadeFile(all);
  if (globalErrors.length > 0) throw new Error(`facade files: validation failed:\n${globalErrors.join('\n')}`);
  return all;
}
