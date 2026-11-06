/**
 * Tier-K facade landmarks: loads `public/world/facades.json`, which the bake writes from `data/facades/*.json`
 * descriptors plus the real OSM footprints, and turns each row into a `Landmark`.
 *
 * The file is fetched once; deleting it is a valid "no researched facades yet" state and produces zero landmarks
 * without error noise. The maintainer adds the resulting list to the existing `LandmarkLayer` once `ready` resolves.
 */
import { versioned } from '../version.ts';
import { parseOsmKey } from '../world/osm-ref.ts';
import { buildFacadeBuilding, type FacadeBuildingRow } from './facade-building.ts';
import { DEFAULT_BBOX, toLatLon } from './geo.ts';
import type { Landmark, LandmarkBuildContext } from './types.ts';
import type { FacadeProfile } from '../mesh/facade-profile.ts';

export type FacadeFetchJson = (url: string) => Promise<unknown>;

interface FileRow {
  profile: FacadeProfile;
  ring: [number, number][];
  heightM: number;
  minHeightM: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);
  return response.json();
}

function parseRow(value: unknown): FileRow | null {
  if (!isRecord(value) || !isRecord(value.profile) || typeof value.profile.key !== 'string') return null;
  if (!Array.isArray(value.ring) || typeof value.heightM !== 'number') return null;
  const ring: [number, number][] = [];
  for (const point of value.ring) {
    if (!Array.isArray(point) || point.length < 2 || typeof point[0] !== 'number' || typeof point[1] !== 'number') return null;
    ring.push([point[0], point[1]]);
  }
  if (ring.length < 3) return null;
  return {
    profile: value.profile as unknown as FacadeProfile,
    ring,
    heightM: value.heightM,
    minHeightM: typeof value.minHeightM === 'number' ? value.minHeightM : 0,
  };
}

function centroid(ring: readonly [number, number][]): [number, number] {
  let x = 0, z = 0;
  for (const point of ring) {
    x += point[0];
    z += point[1];
  }
  return [x / ring.length, z / ring.length];
}

/** Lowest known ground height under the footprint vertices, falling back to the centroid. */
function groundUnder(ctx: LandmarkBuildContext, ring: readonly [number, number][], cx: number, cz: number): number {
  let lowest = Infinity;
  for (const [x, z] of ring) {
    const height = ctx.groundAt(x, z);
    if (height !== null && Number.isFinite(height)) lowest = Math.min(lowest, height);
  }
  if (Number.isFinite(lowest)) return lowest;
  return ctx.groundAt(cx, cz) ?? 0;
}

function landmarkFor(row: FileRow): Landmark | null {
  const key = row.profile.key;
  const ref = parseOsmKey(key);
  if (ref === null) return null;
  const [cx, cz] = centroid(row.ring);
  const [lat, lon] = toLatLon(DEFAULT_BBOX, cx, cz);
  return {
    id: `facade:${key}`,
    name: row.profile.label,
    anchor: { lat, lon, x: cx, z: cz },
    footprint: row.ring,
    replaces: [ref],
    ready(ctx: LandmarkBuildContext): boolean {
      return ctx.groundAt(cx, cz) !== null;
    },
    build(ctx: LandmarkBuildContext) {
      return buildFacadeBuilding(row, groundUnder(ctx, row.ring, cx, cz), ctx.lod ?? 'near');
    },
  };
}

/** Facade landmarks fetched once; `landmarks()` is empty until `ready` resolves. */
export class FacadeLandmarks {
  readonly ready: Promise<void>;
  private list: Landmark[] = [];

  constructor(base: string, fetchJson: FacadeFetchJson = defaultFetchJson) {
    this.ready = this.load(base, fetchJson);
  }

  landmarks(): Landmark[] {
    return this.list;
  }

  private async load(base: string, fetchJson: FacadeFetchJson): Promise<void> {
    try {
      const data = await fetchJson(versioned(`${base}world/facades.json`));
      if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.rows)) return;
      const list: Landmark[] = [];
      for (const value of data.rows) {
        const row = parseRow(value);
        if (row === null) continue;
        const landmark = landmarkFor(row);
        if (landmark !== null) list.push(landmark);
      }
      list.sort((a, b) => a.id.localeCompare(b.id));
      this.list = list;
    } catch {
      // No file (or an older deploy without facade rows): a valid state, not an error.
      this.list = [];
    }
  }
}
