export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface Manifest {
  version: number;
  voxel: number;
  chunk: number;
  region: number;
  regionsX: number;
  regionsZ: number;
  bbox: Bbox;
  /** "rx,rz" -> file name, or "empty" for all-default regions. */
  regions: Record<string, string>;
  /** World x, z in metres. */
  spawn: [number, number];
  /** True when the bake wrote `v_<rx>_<rz>.bin` vector tiles; a region without items has no file (404 = empty). */
  vectors?: boolean;
}
