import { FIELDS, REGION } from './constants';
import {
  FEATURE_BRIDGE_DECK,
  FEATURE_TREE,
  cellIndex,
  type Feature,
  type RegionData,
} from './format';
import { MAT } from './materials';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WALLS = [MAT.WALL_HOUSE, MAT.WALL_APART, MAT.WALL_INDUSTRIAL, MAT.WALL_PUBLIC, MAT.WALL_CHURCH];
const ROOFS = [MAT.ROOF_RED, MAT.ROOF_GREY, MAT.ROOF_DARK, MAT.ROOF_GREEN, MAT.ROOF_GOLD];
const GROUND_H = 2;
const WATER_H = 1;
const RIVER_Z0 = 100;
const RIVER_Z1 = 130;
const ROAD_PERIOD = 32;
const ROAD_WIDTH = 4;

/** Builds a deterministic demo region: grass, a river, a road grid, buildings and trees. */
export function buildSyntheticRegion(rx = 0, rz = 0, seed = 1337): RegionData {
  const rand = mulberry32(seed);
  const cells = new Uint8Array(FIELDS * REGION * REGION);
  const features: Feature[] = [];
  const set = (field: number, x: number, z: number, v: number): void => {
    cells[cellIndex(field, x, z)] = v;
  };
  const isRoad = (x: number, z: number): boolean =>
    x % ROAD_PERIOD < ROAD_WIDTH || z % ROAD_PERIOD < ROAD_WIDTH;

  for (let z = 0; z < REGION; z++) {
    for (let x = 0; x < REGION; x++) {
      if (z >= RIVER_Z0 && z < RIVER_Z1) {
        set(0, x, z, MAT.WATER);
        set(1, x, z, WATER_H);
        if (x % ROAD_PERIOD < ROAD_WIDTH) {
          features.push({ type: FEATURE_BRIDGE_DECK, param: GROUND_H, x, z });
        }
      } else if (isRoad(x, z)) {
        set(0, x, z, MAT.ASPHALT);
        set(1, x, z, GROUND_H);
      } else {
        set(0, x, z, MAT.GRASS);
        set(1, x, z, GROUND_H);
      }
    }
  }

  // Buildings: split each block into lots.
  const LOT = 8;
  for (let z = 0; z + LOT <= REGION; z += LOT) {
    for (let x = 0; x + LOT <= REGION; x += LOT) {
      const bx0 = x + (x % ROAD_PERIOD === 0 ? ROAD_WIDTH : 0);
      const bz0 = z + (z % ROAD_PERIOD === 0 ? ROAD_WIDTH : 0);
      const bx1 = x + LOT;
      const bz1 = z + LOT;
      if (bz1 > RIVER_Z0 - 1 && bz0 < RIVER_Z1 + 1) continue;
      if (rand() < 0.3) continue;
      const bx = bx0 + 1;
      const bz = bz0 + 1;
      const w = bx1 - 1 - bx;
      const d = bz1 - 1 - bz;
      if (w < 2 || d < 2) continue;
      const h = 3 + Math.floor(rand() * 10);
      const wall = WALLS[Math.floor(rand() * WALLS.length)]!;
      const roof = ROOFS[Math.floor(rand() * ROOFS.length)]!;
      for (let zz = bz; zz < bz + d; zz++) {
        for (let xx = bx; xx < bx + w; xx++) {
          set(2, xx, zz, h);
          set(3, xx, zz, wall);
          set(4, xx, zz, roof);
        }
      }
    }
  }

  // Trees on free grass.
  for (let i = 0; i < 600; i++) {
    const x = 2 + Math.floor(rand() * (REGION - 4));
    const z = 2 + Math.floor(rand() * (REGION - 4));
    if (cells[cellIndex(0, x, z)] !== MAT.GRASS || cells[cellIndex(2, x, z)] !== 0) continue;
    features.push({ type: FEATURE_TREE, param: 5 + Math.floor(rand() * 3), x, z });
  }

  return { rx, rz, cells, features };
}
