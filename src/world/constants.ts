export const VOXEL = 2; // metres per voxel (x, y, z)
export const CHUNK = 32; // cells per chunk side
export const REGION_CHUNKS = 8; // chunks per region side
export const REGION = CHUNK * REGION_CHUNKS; // 256 cells per region side
export const FIELDS = 5; // bytes per cell

/** Field (plane) indices of the per-cell layout. */
export const F_GROUND_MAT = 0;
export const F_GROUND_H = 1;
export const F_STRUCT_H = 2;
export const F_STRUCT_MAT = 3;
export const F_ROOF_MAT = 4;
