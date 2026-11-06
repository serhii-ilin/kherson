/**
 * Validation for Tier-K facade descriptors (`data/facades/*.json`, `FacadeProfile` in `facade-profile.ts`).
 *
 * The bake fails on any error here, so a typo in a researched row cannot silently ship a malformed building.
 * Values are checked against the kit's real capabilities: bay codes from `BAY`, window sizes the kit can cut,
 * colours as `#rrggbb`, PBR layers that exist in `PBR_LAYER`, and photo crops inside 0..1. Reviewer-only fields
 * such as `confidence` and `notes` are deliberately ignored, so research notes can stay next to a row.
 */
import { parseOsmKey } from '../world/osm-ref.ts';
import { PBR_LAYER } from '../world/pbr-layers.ts';
import { BAY, type FacadeProfile } from './facade-profile.ts';

const KEY_RE = /^[wr][1-9][0-9]*$/;
const COLOUR_RE = /^#[0-9a-fA-F]{6}$/;
const BAY_CODES = new Set<string>(Object.values(BAY));
const WINDOW_SHAPES = new Set(['rect', 'arched', 'segmental', 'paired']);
const WINDOW_SURROUNDS = new Set(['none', 'band', 'keystone', 'pediment', 'arch_moulding']);
const CORNICE_PROFILES = new Set(['none', 'simple', 'dentil', 'bracketed']);
const ATTIC_KINDS = new Set(['none', 'parapet', 'balustrade', 'pediment']);
const BALCONY_KINDS = new Set(['iron', 'stone', 'glazed']);
const ROOF_KINDS = new Set(['flat', 'gable', 'hip', 'mansard']);
const CAPITALS = new Set(['plain', 'ionic', 'corinthian']);

type Obj = Record<string, unknown>;

function isRecord(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function checkColour(errors: string[], path: string, value: unknown): void {
  if (typeof value !== 'string' || !COLOUR_RE.test(value)) errors.push(`${path}: expected a #rrggbb colour`);
}

function checkPbr(errors: string[], path: string, value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !hasOwn(PBR_LAYER, value)) {
    errors.push(`${path}: unknown PBR layer ${JSON.stringify(value)}`);
  }
}

function checkNumber(
  errors: string[], path: string, value: unknown, min: number, max: number, optional = false,
): void {
  if (value === undefined && optional) return;
  if (!isFiniteNumber(value) || value < min || value > max) {
    errors.push(`${path}: expected a number in ${min}..${max}`);
  }
}

function checkPattern(errors: string[], path: string, value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${path}: expected a non-empty bay pattern`);
    return;
  }
  for (const code of value) {
    if (!BAY_CODES.has(code)) errors.push(`${path}: unknown bay code ${JSON.stringify(code)}`);
  }
}

function checkTrimmed(errors: string[], path: string, value: unknown, kind: Set<string>): void {
  if (typeof value !== 'string' || !kind.has(value)) {
    errors.push(`${path}: expected one of ${[...kind].join(', ')}`);
  }
}

/** Validates one row. Returns human-readable errors, or an empty array when the row is usable. */
export function validateFacadeProfile(row: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(row)) return ['row: expected an object'];

  if (typeof row.key !== 'string' || !KEY_RE.test(row.key) || parseOsmKey(row.key) === null) {
    errors.push('key: expected w<id> or r<id>');
  }
  if (typeof row.label !== 'string' || row.label.trim().length === 0) {
    errors.push('label: expected a non-empty string');
  }
  if (!Array.isArray(row.sources) || row.sources.some((source) => typeof source !== 'string')) {
    errors.push('sources: expected an array of strings');
  }

  const storeys = isFiniteNumber(row.storeys) && Number.isInteger(row.storeys) && row.storeys >= 1 && row.storeys <= 20
    ? row.storeys
    : null;
  if (storeys === null) errors.push('storeys: expected an integer in 1..20');

  if (row.floorHeights !== undefined) {
    if (!Array.isArray(row.floorHeights) || row.floorHeights.length === 0) {
      errors.push('floorHeights: expected a non-empty array');
    } else {
      row.floorHeights.forEach((height, i) => checkNumber(errors, `floorHeights[${i}]`, height, 2.5, 6));
    }
  }
  checkNumber(errors, 'plinthM', row.plinthM, 0, 5, true);

  const wall = isRecord(row.wall) ? row.wall : null;
  if (wall === null) errors.push('wall: expected an object');
  else {
    checkColour(errors, 'wall.colour', wall.colour);
    checkPbr(errors, 'wall.pbr', wall.pbr);
  }

  const trim = isRecord(row.trim) ? row.trim : null;
  if (trim === null) errors.push('trim: expected an object');
  else {
    checkColour(errors, 'trim.colour', trim.colour);
    checkPbr(errors, 'trim.pbr', trim.pbr);
  }

  const roof = isRecord(row.roof) ? row.roof : null;
  if (roof === null) errors.push('roof: expected an object');
  else {
    checkTrimmed(errors, 'roof.kind', roof.kind, ROOF_KINDS);
    checkColour(errors, 'roof.colour', roof.colour);
    checkPbr(errors, 'roof.pbr', roof.pbr);
  }

  const windows = isRecord(row.windows) ? row.windows : null;
  if (windows === null) errors.push('windows: expected an object');
  else {
    checkTrimmed(errors, 'windows.shape', windows.shape, WINDOW_SHAPES);
    checkNumber(errors, 'windows.widthM', windows.widthM, 0.4, 3);
    checkNumber(errors, 'windows.heightM', windows.heightM, 0.6, 4.5);
    checkTrimmed(errors, 'windows.surround', windows.surround, WINDOW_SURROUNDS);
    checkColour(errors, 'windows.frame', windows.frame);
    if (windows.mixedFrames !== undefined && typeof windows.mixedFrames !== 'boolean') {
      errors.push('windows.mixedFrames: expected a boolean');
    }
    if (windows.ground !== undefined) {
      if (!isRecord(windows.ground)) errors.push('windows.ground: expected an object');
      else {
        checkTrimmed(errors, 'windows.ground.shape', windows.ground.shape, WINDOW_SHAPES);
        checkNumber(errors, 'windows.ground.widthM', windows.ground.widthM, 0.4, 3);
        checkNumber(errors, 'windows.ground.heightM', windows.ground.heightM, 0.6, 4.5);
      }
    }
  }

  if (row.rusticated !== undefined && typeof row.rusticated !== 'boolean') {
    errors.push('rusticated: expected a boolean');
  }
  if (row.stringCourses !== undefined && typeof row.stringCourses !== 'boolean') {
    errors.push('stringCourses: expected a boolean');
  }

  if (row.pilasters !== undefined) {
    if (!isRecord(row.pilasters)) errors.push('pilasters: expected an object');
    else {
      if (!isFiniteNumber(row.pilasters.everyBays) || !Number.isInteger(row.pilasters.everyBays) || row.pilasters.everyBays < 1) {
        errors.push('pilasters.everyBays: expected a positive integer');
      }
      checkTrimmed(errors, 'pilasters.capital', row.pilasters.capital, CAPITALS);
    }
  }

  if (!isRecord(row.cornice)) errors.push('cornice: expected an object');
  else {
    checkTrimmed(errors, 'cornice.profile', row.cornice.profile, CORNICE_PROFILES);
    checkNumber(errors, 'cornice.heightM', row.cornice.heightM, 0.05, 2);
    checkNumber(errors, 'cornice.projectionM', row.cornice.projectionM, 0, 1.5);
  }

  if (row.attic !== undefined) {
    if (!isRecord(row.attic)) errors.push('attic: expected an object');
    else {
      checkTrimmed(errors, 'attic.kind', row.attic.kind, ATTIC_KINDS);
      checkNumber(errors, 'attic.heightM', row.attic.heightM, 0, 5);
    }
  }

  if (row.balconies !== undefined) {
    if (!Array.isArray(row.balconies)) errors.push('balconies: expected an array');
    else {
      row.balconies.forEach((balcony, i) => {
        if (!isRecord(balcony)) {
          errors.push(`balconies[${i}]: expected an object`);
          return;
        }
        checkTrimmed(errors, `balconies[${i}].kind`, balcony.kind, BALCONY_KINDS);
        if (!Array.isArray(balcony.storeys) || balcony.storeys.length === 0) {
          errors.push(`balconies[${i}].storeys: expected a non-empty array`);
        } else {
          balcony.storeys.forEach((storey, j) => {
            if (!isFiniteNumber(storey) || !Number.isInteger(storey) || storey < 0 || (storeys !== null && storey >= storeys)) {
              errors.push(`balconies[${i}].storeys[${j}]: expected a storey index in 0..${storeys === null ? 'storeys-1' : storeys - 1}`);
            }
          });
        }
        if (!Array.isArray(balcony.bays) || balcony.bays.length === 0) {
          errors.push(`balconies[${i}].bays: expected a non-empty array`);
        } else {
          balcony.bays.forEach((bay, j) => {
            if (!isFiniteNumber(bay) || !Number.isInteger(bay) || bay < 0) {
              errors.push(`balconies[${i}].bays[${j}]: expected a non-negative integer`);
            }
          });
        }
      });
    }
  }

  if (!Array.isArray(row.edges) || row.edges.length === 0) {
    errors.push('edges: expected a non-empty array');
  } else {
    const seenEdges = new Set<number>();
    row.edges.forEach((edge, i) => {
      const path = `edges[${i}]`;
      if (!isRecord(edge)) {
        errors.push(`${path}: expected an object`);
        return;
      }
      if (!isFiniteNumber(edge.edge) || !Number.isInteger(edge.edge) || edge.edge < 0) {
        errors.push(`${path}.edge: expected a non-negative integer`);
      } else if (seenEdges.has(edge.edge)) {
        errors.push(`${path}.edge: duplicate edge index ${edge.edge}`);
      } else {
        seenEdges.add(edge.edge);
      }
      checkPattern(errors, `${path}.pattern`, edge.pattern);
      if (edge.groundPattern !== undefined) {
        checkPattern(errors, `${path}.groundPattern`, edge.groundPattern);
        if (typeof edge.pattern === 'string' && typeof edge.groundPattern === 'string'
          && edge.pattern.length !== edge.groundPattern.length) {
          errors.push(`${path}.groundPattern: length ${edge.groundPattern.length} does not match pattern length ${edge.pattern.length}`);
        }
      }
      checkNumber(errors, `${path}.bayM`, edge.bayM, 0.5, 20, true);
      if (edge.photo !== undefined) {
        const photo = edge.photo;
        if (!isRecord(photo)) errors.push(`${path}.photo: expected an object`);
        else {
          if (typeof photo.id !== 'string' || photo.id.length === 0) {
            errors.push(`${path}.photo.id: expected a non-empty string`);
          }
          for (const key of ['u0', 'u1', 'v0', 'v1'] as const) {
            checkNumber(errors, `${path}.photo.${key}`, photo[key], 0, 1);
          }
          if (isFiniteNumber(photo.u0) && isFiniteNumber(photo.u1) && photo.u0 >= photo.u1) {
            errors.push(`${path}.photo: expected u0 < u1`);
          }
          if (isFiniteNumber(photo.v0) && isFiniteNumber(photo.v1) && photo.v0 >= photo.v1) {
            errors.push(`${path}.photo: expected v0 < v1`);
          }
        }
      }
    });
  }

  return errors;
}

/** Validates a whole file: each row plus unique keys across the rows. */
export function validateFacadeFile(rows: unknown): string[] {
  if (!Array.isArray(rows)) return ['file: expected an array of facade rows'];
  const errors: string[] = [];
  const keys = new Map<string, number>();
  rows.forEach((row, i) => {
    for (const error of validateFacadeProfile(row)) errors.push(`rows[${i}]: ${error}`);
    if (isRecord(row) && typeof row.key === 'string') {
      const previous = keys.get(row.key);
      if (previous !== undefined) errors.push(`rows[${i}]: duplicate key ${JSON.stringify(row.key)} (also rows[${previous}])`);
      else keys.set(row.key, i);
    }
  });
  return errors;
}

/** Type-level confirmation that the validator accepts every field of the shared descriptor contract. */
export type ValidatedFacadeProfile = FacadeProfile;
