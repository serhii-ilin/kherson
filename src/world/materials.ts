export const MAT = {
  AIR: 0,
  WATER: 1,
  GRASS: 2,
  ASPHALT: 3,
  SIDEWALK: 4,
  SAND: 5,
  DIRT: 6,
  RAIL: 7,
  PARK: 8,
  FOREST: 9,
  PLAZA: 10,
  WALL_HOUSE: 20,
  WALL_APART: 21,
  WALL_INDUSTRIAL: 22,
  WALL_CHURCH: 23,
  WALL_PUBLIC: 24,
  ROOF_RED: 40,
  ROOF_GREY: 41,
  ROOF_DARK: 42,
  ROOF_GOLD: 43,
  ROOF_GREEN: 44,
  LEAVES: 60,
  TRUNK: 61,
  BRIDGE: 62,
} as const;

const COLORS: Record<number, number> = {
  [MAT.WATER]: 0x3b78b8,
  [MAT.GRASS]: 0x5fa845,
  [MAT.ASPHALT]: 0x4a4d52,
  [MAT.SIDEWALK]: 0xb4b2ab,
  [MAT.SAND]: 0xe0cf8f,
  [MAT.DIRT]: 0x8a6a45,
  [MAT.RAIL]: 0x6b5a4a,
  [MAT.PARK]: 0x4f9a3c,
  [MAT.FOREST]: 0x2f6b32,
  [MAT.PLAZA]: 0xd2c9b4,
  [MAT.WALL_HOUSE]: 0xe8dcc0,
  [MAT.WALL_APART]: 0xc9c4bb,
  [MAT.WALL_INDUSTRIAL]: 0x9a9fa3,
  [MAT.WALL_CHURCH]: 0xf2efe6,
  [MAT.WALL_PUBLIC]: 0xd9c08a,
  [MAT.ROOF_RED]: 0xb5472f,
  [MAT.ROOF_GREY]: 0x808589,
  [MAT.ROOF_DARK]: 0x45484d,
  [MAT.ROOF_GOLD]: 0xe2b93b,
  [MAT.ROOF_GREEN]: 0x3f7f5a,
  [MAT.LEAVES]: 0x3e8e3a,
  [MAT.TRUNK]: 0x6b4a2b,
  [MAT.BRIDGE]: 0x9b9486,
};

/** RGB bytes, 3 per material id; unknown ids are magenta. */
export const PALETTE: Uint8Array = (() => {
  const p = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const c = COLORS[i] ?? 0xff00ff;
    p[i * 3] = (c >> 16) & 255;
    p[i * 3 + 1] = (c >> 8) & 255;
    p[i * 3 + 2] = c & 255;
  }
  return p;
})();

/** Material colour as 0..1 floats. */
export function materialColor(id: number): [number, number, number] {
  const o = (id & 255) * 3;
  return [PALETTE[o]! / 255, PALETTE[o + 1]! / 255, PALETTE[o + 2]! / 255];
}
